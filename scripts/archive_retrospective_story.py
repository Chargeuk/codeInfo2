#!/usr/bin/env python3
"""Archive all top-level stories belonging to the fresh current branch.

The ignored receipt retains archive mappings across retries and source-path
reuse, so later steps recover ownership without an agent conversation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

from flow_state_utils import (
    branch_matches_story,
    branch_story_number,
    current_branch,
    run_git_command,
    story_number_from_plan_name,
)


RECEIPT = Path("codeInfoStatus/flow-state/retrospective-archive.json")


def verified_archive_entry(root: Path, branch: str, entry: object) -> bool:
    """Verify one mapping independently, including its allocated numeric suffix."""
    if not isinstance(entry, dict):
        return False
    source_raw = entry.get("source_path")
    archive_raw = entry.get("archive_path")
    if not isinstance(source_raw, str) or not isinstance(archive_raw, str):
        return False
    source, archive = Path(source_raw), Path(archive_raw)
    number = story_number_from_plan_name(source.name)
    if (
        source.parent != Path("planning")
        or source.suffix != ".md"
        or source.as_posix() != source_raw
        or number is None
        or not branch_matches_story(branch, number)
        or archive.parent != Path("planning/one-shot")
        or archive.as_posix() != archive_raw
        or not re.fullmatch(
            rf"one-shot-{re.escape(source.stem)}(?:-[1-9]\d*)?\.md", archive.name
        )
        or (root / "planning").is_symlink()
        or (root / archive).parent.is_symlink()
        or (root / archive).is_symlink()
        or not (root / archive).is_file()
    ):
        return False
    return (
        hashlib.sha256((root / archive).read_bytes()).hexdigest()
        == entry.get("content_sha256")
    )


def archive_story(repo_root: Path | None = None) -> dict[str, object]:
    root = (repo_root or Path.cwd()).resolve()
    # A nested working folder must never archive a different checkout's plans.
    top = Path(run_git_command(root, ["rev-parse", "--show-toplevel"]).stdout.strip())
    if top.resolve() != root:
        raise ValueError("Run from the target repository root")
    branch = current_branch(root)
    head = run_git_command(root, ["rev-parse", "HEAD"]).stdout.strip()
    receipt = root / RECEIPT
    entries: list[dict[str, object]] = []
    warnings: list[str] = []
    result: dict[str, object] = {
        "branch": branch,
        "initial_head_commit": head,
        "status": "no_op",
        "reason": "no_matching_story",
        "entries": entries,
        "warnings": warnings,
    }

    def save() -> dict[str, object]:
        successful = any(entry.get("status") == "archived" for entry in entries)
        has_archives = any(entry.get("archive_path") is not None for entry in entries)
        limited = bool(warnings) or any(entry.get("status") != "archived" for entry in entries)
        if limited:
            result.update(status="partial" if has_archives else "no_op", reason="archive_evidence_limits")
        elif successful:
            result.update(status="archived", reason="matching_stories_archived")
        try:
            if receipt.is_symlink() or not receipt.resolve().is_relative_to(root):
                raise ValueError("Unsafe receipt path")
            receipt.parent.mkdir(parents=True, exist_ok=True)
            receipt.write_text(json.dumps(result, indent=2) + "\n")
        except (OSError, ValueError) as error:
            warning = f"warning: archive receipt persistence unavailable ({error.__class__.__name__})"
            if warning not in warnings:
                warnings.append(warning)
            result.update(status="partial" if has_archives else "no_op", reason="archive_evidence_limits")
        return result

    story_number = branch_story_number(branch)
    if story_number is None:
        result["reason"] = "detached_or_unnumbered_branch"
        return save()
    planning = root / "planning"
    if planning.is_symlink():
        warnings.append("warning: planning directory is a symlink")
        return save()

    matches = sorted(
        (
            path for path in planning.glob("*.md")
            if (number := story_number_from_plan_name(path.name)) is not None
            and branch_matches_story(branch, number)
        ),
        key=lambda path: path.name,
    )
    present_sources = {str(path.relative_to(root)) for path in matches}

    # Receipts prove prior mappings, never permission to leave a present source.
    # Keep verified pending archives even if HEAD advanced on this numbered branch.
    if receipt.exists():
        try:
            if receipt.is_symlink() or not receipt.resolve().is_relative_to(root):
                raise ValueError("Unsafe receipt path")
            previous = json.loads(receipt.read_text())
            if not isinstance(previous, dict) or not isinstance(previous.get("entries"), list):
                raise ValueError("Malformed archive receipt")
            previous_branch = previous.get("branch")
            if not branch_matches_story(
                previous_branch if isinstance(previous_branch, str) else None,
                story_number,
            ):
                warnings.append("warning: prior archive receipt belongs to another story identity")
            else:
                prior_warnings = previous.get("warnings", [])
                if isinstance(prior_warnings, list):
                    warnings.extend(
                        warning for warning in prior_warnings
                        if isinstance(warning, str) and warning not in warnings
                    )
                else:
                    warnings.append("warning: prior archive warning list was malformed")
                seen: set[str] = set()
                for index, entry in enumerate(previous["entries"]):
                    try:
                        verified = verified_archive_entry(root, branch, entry)
                    except OSError:
                        verified = False
                    if verified:
                        destination = entry["archive_path"]
                        if destination not in seen:
                            entries.append(dict(entry))
                            seen.add(destination)
                        else:
                            warnings.append(f"warning: duplicate prior archive mapping at entry {index + 1} discarded")
                    elif (
                        isinstance(entry, dict)
                        and entry.get("status") == "error"
                        and entry.get("archive_path") is None
                        and isinstance(entry.get("source_path"), str)
                        and Path(entry["source_path"]).parent == Path("planning")
                        and (number := story_number_from_plan_name(Path(entry["source_path"]).name)) is not None
                        and branch_matches_story(branch, number)
                    ):
                        # A failed source is rediscovered below, not suppressed.
                        if entry.get("source_path") not in present_sources:
                            entries.append(dict(entry))
                    else:
                        warnings.append(f"warning: prior archive mapping at entry {index + 1} could not be verified")
        except (OSError, ValueError):
            warnings.append("warning: archive receipt unavailable or malformed")

    for source in matches:
        entry: dict[str, object] = {
            "source_path": str(source.relative_to(root)),
            "archive_path": None,
            "content_sha256": None,
            "status": "error",
            "reason": "warning: archive move unavailable",
        }
        destination_dir = planning / "one-shot"
        try:
            if source.is_symlink() or not source.is_file() or destination_dir.is_symlink():
                raise ValueError("Unsafe archive path")
            destination_dir.mkdir(exist_ok=True)
            suffix = 0
            while True:
                tail = f"-{suffix}" if suffix else ""
                destination = destination_dir / f"one-shot-{source.stem}{tail}.md"
                try:
                    # Exclusive creation handles occupied names and allocation
                    # races without overwriting or skipping this matching file.
                    os.link(source, destination, follow_symlinks=False)
                    break
                except FileExistsError:
                    suffix += 1
            entry["archive_path"] = str(destination.relative_to(root))
            entry["content_sha256"] = hashlib.sha256(destination.read_bytes()).hexdigest()
            source.unlink()
            entry.update(status="archived", reason="matching_story_archived")
        except (OSError, ValueError) as error:
            entry["reason"] = f"warning: archive move unavailable ({error.__class__.__name__}); inspect source and destination"
        entries.append(entry)
        # Persist each outcome so another agent can salvage a partial batch.
        save()
    return save()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        print(json.dumps(archive_story(), separators=(",", ":")))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        # No safe scope remains, but archive failure must not stop this flow.
        print(json.dumps({
            "status": "no_op",
            "reason": f"warning: archive unavailable ({error.__class__.__name__})",
            "entries": [],
        }))


if __name__ == "__main__":
    main()
