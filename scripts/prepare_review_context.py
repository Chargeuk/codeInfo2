#!/usr/bin/env python3
"""Prepare compact, deterministic story context for code-review consumers."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import plan_sections


SCHEMA_VERSION = "codeinfo-review-context/v1"
EXCLUDED_PATHS = ["planning/**"]
BRANCH_STORY_PATTERN = re.compile(r"(\d{7})")
CANONICAL_STORY_ID_PATTERN = re.compile(r"^\d{7}$")
REQUESTED_SECTIONS = [
    "Overview",
    "Description",
    "Acceptance Criteria",
    "Out Of Scope",
    "Non-Goals",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Write compact story context for review agents."
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--handoff", default="codeInfoStatus/flow-state/current-plan.json"
    )
    parser.add_argument("--output")
    parser.add_argument("--branch")
    return parser.parse_args()


def _git_branch(repo_root: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root), "branch", "--show-current"],
        check=True,
        capture_output=True,
        text=True,
    )
    branch = result.stdout.strip()
    if not branch:
        raise SystemExit("current branch could not be resolved")
    return branch


def _section_by_name(
    sections: list[dict[str, Any]], *names: str
) -> dict[str, Any] | None:
    by_name: dict[str, dict[str, Any]] = {}
    for section in sections:
        normalized = plan_sections.normalize_heading(str(section.get("name", "")))
        by_name.setdefault(normalized, section)
    for name in names:
        match = by_name.get(plan_sections.normalize_heading(name))
        if match is not None:
            return match
    return None


def _compact_section(section: dict[str, Any]) -> dict[str, str]:
    return {
        "source_heading": str(section["name"]),
        "markdown": str(section["markdown"]).strip(),
    }


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def prepare_review_context(
    *,
    repo_root: str | Path,
    handoff: str = "codeInfoStatus/flow-state/current-plan.json",
    output: str | Path | None = None,
    branch: str | None = None,
) -> tuple[Path, dict[str, Any]]:
    root = Path(repo_root).resolve()
    packet = plan_sections.build_plan_sections(
        handoff=handoff,
        requested_story_sections=REQUESTED_SECTIONS,
        repo_root=root,
    )
    story_id = packet.get("story_id")
    if not isinstance(story_id, str) or CANONICAL_STORY_ID_PATTERN.fullmatch(
        story_id
    ) is None:
        raise SystemExit("review context requires a canonical seven-digit story_id")
    current_branch = branch or _git_branch(root)
    branch_match = BRANCH_STORY_PATTERN.search(current_branch)
    if branch_match is None or branch_match.group(1) != story_id:
        raise SystemExit(
            f'current branch "{current_branch}" does not match plan story {story_id}'
        )

    sections = list(packet["story_sections"])
    overview = _section_by_name(sections, "Overview", "Description")
    acceptance = _section_by_name(sections, "Acceptance Criteria")
    out_of_scope = _section_by_name(sections, "Out Of Scope", "Non-Goals")
    if overview is None:
        raise SystemExit("review context requires Overview or Description")
    if acceptance is None:
        raise SystemExit("review context requires Acceptance Criteria")

    selected_sections: dict[str, dict[str, str] | None] = {
        "overview": _compact_section(overview),
        "acceptance_criteria": _compact_section(acceptance),
        "out_of_scope": (
            _compact_section(out_of_scope) if out_of_scope is not None else None
        ),
    }
    context_markdown = "\n\n".join(
        section["markdown"]
        for section in selected_sections.values()
        if section is not None
    )
    plan_path = Path(str(packet["resolved_plan_path"]))
    plan_bytes = plan_path.read_bytes()
    warnings: list[str] = []
    if out_of_scope is None:
        warnings.append("Out Of Scope and Non-Goals were not present")

    artifact: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "story_id": story_id,
        "plan_path": str(packet["plan_path"]),
        "branch": current_branch,
        "source_plan_sha256": hashlib.sha256(plan_bytes).hexdigest(),
        "context_sha256": hashlib.sha256(
            context_markdown.encode("utf-8")
        ).hexdigest(),
        "sections": selected_sections,
        "excluded_paths": EXCLUDED_PATHS,
        "warnings": warnings,
        "status": "completed",
    }
    output_path = (
        Path(output)
        if output is not None
        else root
        / "codeInfoTmp"
        / "reviews"
        / f"{story_id}-current-review-context.json"
    )
    if not output_path.is_absolute():
        output_path = root / output_path
    output_path = output_path.resolve()
    _atomic_write_json(output_path, artifact)
    return output_path, artifact


def main() -> int:
    args = parse_args()
    output_path, artifact = prepare_review_context(
        repo_root=args.repo_root,
        handoff=args.handoff,
        output=args.output,
        branch=args.branch,
    )
    json.dump(
        {
            "artifact_path": str(output_path),
            "story_id": artifact["story_id"],
            "context_sha256": artifact["context_sha256"],
            "source_plan_sha256": artifact["source_plan_sha256"],
            "excluded_paths": artifact["excluded_paths"],
        },
        sys.stdout,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
