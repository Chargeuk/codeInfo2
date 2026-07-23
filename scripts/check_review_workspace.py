#!/usr/bin/env python3
"""Check factual review-workspace invariants without interpreting review content."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


def _contained(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


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
            for name in ("work", "output", "verification"):
                directory = job_root / name
                if not directory.is_dir():
                    errors.append(f"job {job_root.name} is missing {name}/")
            if not (job_root / "job.md").is_file():
                errors.append(f"job {job_root.name} is missing job.md")
            output = job_root / "output"
            output_entries = sorted(path.name for path in output.iterdir()) if output.is_dir() else []
            job["output_entries"] = output_entries
            job["output_empty"] = not output_entries
            if not output_entries:
                warnings.append(f"job {job_root.name} currently has no output")
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


def _repository_head(value: str) -> tuple[Path, str]:
    repository, separator, expected_head = value.rpartition("=")
    if not separator or not repository or not expected_head:
        raise argparse.ArgumentTypeError("expected REPOSITORY=COMMIT")
    return Path(repository), expected_head


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check review workspace paths and optional Git HEAD facts without parsing review output.",
    )
    parser.add_argument("--batch-root", type=Path, required=True)
    parser.add_argument(
        "--repository-head",
        action="append",
        default=[],
        type=_repository_head,
        metavar="REPOSITORY=COMMIT",
    )
    args = parser.parse_args()
    result = check_workspace(args.batch_root, args.repository_head)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
