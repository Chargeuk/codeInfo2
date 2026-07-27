#!/usr/bin/env python3
"""Check factual review-workspace invariants without interpreting review content."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


HANDOFF_FIELDS = {
    "- Story:": "story_id",
    "- Review cycle:": "review_cycle_id",
    "- Batch:": "batch_id",
    "- Batch directory:": "batch_root",
    "- Inputs directory:": "inputs_root",
    "- Jobs directory:": "jobs_root",
    "- Reconciliation directory:": "reconciliation_root",
}


def _contained(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def resolve_batch_handoff(handoff_path: Path) -> dict[str, Any]:
    handoff = handoff_path.resolve()
    if not handoff.is_file():
        raise ValueError(f"current-batch handoff does not exist: {handoff}")

    values: dict[str, str] = {}
    scheduled_jobs: list[str] = []
    reading_jobs = False
    for raw_line in handoff.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line == "## Scheduled job directories":
            reading_jobs = True
            continue
        if reading_jobs and line.startswith("## "):
            reading_jobs = False
        for prefix, key in HANDOFF_FIELDS.items():
            if line.startswith(f"{prefix} "):
                values[key] = line.removeprefix(prefix).strip()
                break
        else:
            if reading_jobs and line.startswith("- ") and ": " in line:
                _, job_path = line.rsplit(": ", 1)
                scheduled_jobs.append(job_path.strip())

    missing = [key for key in HANDOFF_FIELDS.values() if not values.get(key)]
    if missing:
        raise ValueError(
            "current-batch handoff is missing runtime-owned fields: "
            + ", ".join(sorted(missing))
        )

    review_root = handoff.parent
    story_id = values["story_id"]
    if handoff.name != f"{story_id}-current-review-batch.md":
        raise ValueError(
            "current-batch handoff filename does not match its story identity"
        )
    batch_root = Path(values["batch_root"])
    inputs_root = Path(values["inputs_root"])
    jobs_root = Path(values["jobs_root"])
    reconciliation_root = Path(values["reconciliation_root"])
    if not batch_root.is_absolute():
        raise ValueError("current-batch handoff batch directory must be absolute")
    resolved_batch = batch_root.resolve()
    try:
        batch_relative = resolved_batch.relative_to(review_root)
    except ValueError as error:
        raise ValueError(
            f"current-batch handoff batch directory escapes review root: {resolved_batch}"
        ) from error
    if len(batch_relative.parts) != 3 or batch_relative.parts[1] != "batches":
        raise ValueError(
            "current-batch handoff batch directory does not have the expected "
            "<review-cycle>/batches/<batch> boundary"
        )
    if batch_relative.parts[0] != values["review_cycle_id"]:
        raise ValueError(
            "current-batch handoff batch directory does not match its review-cycle identity"
        )

    expected_directories = {
        "inputs directory": (inputs_root, resolved_batch / "inputs"),
        "jobs directory": (jobs_root, resolved_batch / "jobs"),
        "reconciliation directory": (
            reconciliation_root,
            resolved_batch / "reconciliation",
        ),
    }
    for description, (declared, expected) in expected_directories.items():
        if not declared.is_absolute() or declared.resolve() != expected.resolve():
            raise ValueError(
                f"current-batch handoff {description} does not match canonical batch root"
            )

    batch_id = values["batch_id"]
    if not resolved_batch.name.startswith(f"{batch_id}--head-"):
        raise ValueError(
            "current-batch handoff batch directory does not match its batch identity"
        )

    resolved_jobs: list[str] = []
    seen_jobs: set[str] = set()
    for scheduled_job in scheduled_jobs:
        job_path = Path(scheduled_job)
        if not job_path.is_absolute():
            raise ValueError("current-batch handoff scheduled job path must be absolute")
        resolved_job = job_path.resolve()
        if resolved_job.parent != (resolved_batch / "jobs").resolve():
            raise ValueError(
                f"current-batch handoff scheduled job escapes canonical jobs directory: {resolved_job}"
            )
        normalized = str(resolved_job)
        if normalized in seen_jobs:
            raise ValueError(
                f"current-batch handoff repeats scheduled job path: {resolved_job}"
            )
        seen_jobs.add(normalized)
        resolved_jobs.append(normalized)

    if not resolved_jobs:
        raise ValueError("current-batch handoff has no scheduled job directories")

    return {
        "handoff_path": str(handoff),
        "review_root": str(review_root),
        "story_id": story_id,
        "review_cycle_id": values["review_cycle_id"],
        "batch_id": batch_id,
        "batch_root": str(resolved_batch),
        "inputs_root": str((resolved_batch / "inputs").resolve()),
        "jobs_root": str((resolved_batch / "jobs").resolve()),
        "reconciliation_root": str((resolved_batch / "reconciliation").resolve()),
        "scheduled_jobs": resolved_jobs,
    }


def _git_head(repository: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repository), "rev-parse", "HEAD^{commit}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def check_workspace(
    batch_root: Path,
    repository_heads: list[tuple[Path, str]] | None = None,
) -> dict[str, Any]:
    root = batch_root.resolve()
    errors: list[str] = []
    warnings: list[str] = []
    facts: dict[str, Any] = {"batch_root": str(root)}

    required_directories = [root / "inputs", root / "jobs", root / "reconciliation"]
    for directory in required_directories:
        if not directory.is_dir():
            errors.append(f"missing directory: {directory}")
        elif not _contained(root, directory):
            errors.append(f"directory escapes batch root: {directory}")

    launch = root / "batch-launch.md"
    if not launch.is_file():
        errors.append(f"missing launch handoff: {launch}")

    jobs_root = root / "jobs"
    jobs: list[dict[str, Any]] = []
    if jobs_root.is_dir():
        for job_root in sorted(path for path in jobs_root.iterdir() if path.is_dir()):
            job: dict[str, Any] = {"name": job_root.name, "path": str(job_root)}
            if not _contained(root, job_root):
                errors.append(f"job escapes batch root: {job_root}")
            for name in ("input", "work", "output", "verification"):
                directory = job_root / name
                if not _contained(job_root, directory):
                    errors.append(f"job {job_root.name} {name}/ escapes its job root")
                elif not directory.is_dir():
                    errors.append(f"job {job_root.name} is missing {name}/")
            job_handoff = job_root / "job.md"
            if not _contained(job_root, job_handoff):
                errors.append(f"job {job_root.name} job.md escapes its job root")
            elif not job_handoff.is_file():
                errors.append(f"job {job_root.name} is missing job.md")
            output = job_root / "output"
            output_entries: list[str] = []
            if output.is_dir():
                for entry in sorted(output.rglob("*")):
                    if not _contained(output, entry):
                        errors.append(
                            f"job {job_root.name} output entry escapes its output directory: {entry.name}"
                        )
                        continue
                    if (
                        entry.is_symlink()
                        or not entry.is_file()
                        or entry.stat().st_size == 0
                    ):
                        continue
                    output_entries.append(str(entry.relative_to(output)))
            job["output_entries"] = output_entries
            job["output_empty"] = not output_entries
            if not output_entries:
                warnings.append(
                    f"job {job_root.name} currently has no non-empty regular-file output"
                )
            jobs.append(job)
    facts["jobs"] = jobs

    repositories: list[dict[str, str]] = []
    for repository, expected_head in repository_heads or []:
        resolved_repository = repository.resolve()
        try:
            actual_head = _git_head(resolved_repository)
        except (OSError, subprocess.CalledProcessError) as error:
            errors.append(f"could not resolve Git HEAD for {resolved_repository}: {error}")
            continue
        repositories.append(
            {
                "repository": str(resolved_repository),
                "expected_head": expected_head,
                "actual_head": actual_head,
            }
        )
        if actual_head != expected_head:
            errors.append(
                f"Git HEAD mismatch for {resolved_repository}: expected {expected_head}, found {actual_head}"
            )
    facts["repositories"] = repositories

    return {
        "status": "passed" if not errors else "failed",
        "facts": facts,
        "errors": errors,
        "warnings": warnings,
    }


def check_workspace_handoff(
    handoff_path: Path,
    repository_heads: list[tuple[Path, str]] | None = None,
) -> dict[str, Any]:
    try:
        handoff = resolve_batch_handoff(handoff_path)
    except (OSError, ValueError) as error:
        return {
            "status": "failed",
            "facts": {"handoff_path": str(handoff_path.resolve())},
            "errors": [str(error)],
            "warnings": [],
        }

    result = check_workspace(Path(handoff["batch_root"]), repository_heads)
    result["facts"]["handoff"] = handoff
    discovered_jobs = {
        str(Path(job["path"]).resolve()) for job in result["facts"]["jobs"]
    }
    scheduled_jobs = set(handoff["scheduled_jobs"])
    for missing_job in sorted(scheduled_jobs - discovered_jobs):
        result["errors"].append(f"scheduled job directory is missing: {missing_job}")
    for unexpected_job in sorted(discovered_jobs - scheduled_jobs):
        result["errors"].append(
            f"job directory is not declared by current-batch handoff: {unexpected_job}"
        )
    result["status"] = "passed" if not result["errors"] else "failed"
    return result


def _repository_head(value: str) -> tuple[Path, str]:
    repository, separator, expected_head = value.rpartition("=")
    if not separator or not repository or not expected_head:
        raise argparse.ArgumentTypeError("expected REPOSITORY=COMMIT")
    return Path(repository), expected_head


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Resolve and check factual review workspace paths from the existing "
            "current-batch handoff without interpreting review output."
        ),
    )
    commands = parser.add_subparsers(dest="command", required=True)
    resolve_parser = commands.add_parser(
        "resolve", help="print the canonical batch root from the current-batch handoff"
    )
    resolve_parser.add_argument("--batch-handoff", type=Path, required=True)
    check_parser = commands.add_parser(
        "check", help="check the canonical batch selected by the current-batch handoff"
    )
    check_parser.add_argument("--batch-handoff", type=Path, required=True)
    check_parser.add_argument(
        "--repository-head",
        action="append",
        default=[],
        type=_repository_head,
        metavar="REPOSITORY=COMMIT",
    )
    args = parser.parse_args()
    if args.command == "resolve":
        try:
            handoff = resolve_batch_handoff(args.batch_handoff)
        except (OSError, ValueError) as error:
            parser.exit(1, f"{error}\n")
        print(handoff["batch_root"])
        return 0

    result = check_workspace_handoff(args.batch_handoff, args.repository_head)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
