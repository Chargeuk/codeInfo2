#!/usr/bin/env python3
"""Shared helpers for Python flow-state utilities."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any


STORY_NUMBER_RE = re.compile(r"^(\d+)-")
CANONICAL_STORY_ID_RE = re.compile(r"^(\d{7})-")
BRANCH_STORY_NUMBER_RE = re.compile(r"^(\d+)(?:-|$)")
REVIEW_CYCLE_ID_RE = re.compile(
    r"^(?P<story>\d+)-rc-\d{8}T\d{6}Z-[0-9a-f]{8}$"
)


class ScopeResolutionError(Exception):
    """Raised when the current-plan handoff cannot be resolved safely."""


def repo_root_path(repo_root: str | Path | None = None) -> Path:
    if repo_root is None:
        return Path.cwd().resolve()
    return Path(repo_root).resolve()


def resolve_path(path: str | Path, *, repo_root: str | Path | None = None) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return repo_root_path(repo_root) / candidate


def load_json_file(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise ScopeResolutionError(f"json file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ScopeResolutionError(f"json file is not valid JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise ScopeResolutionError(f"json file did not contain an object: {path}")
    return payload


def story_number_from_plan_name(plan_name: str) -> str | None:
    match = STORY_NUMBER_RE.match(plan_name)
    if not match:
        return None
    return match.group(1)


def canonical_story_id_from_plan_name(plan_name: str) -> str | None:
    """Return the exact padded artifact identity from a canonical plan name."""
    match = CANONICAL_STORY_ID_RE.match(plan_name)
    if not match:
        return None
    return match.group(1)


def normalize_story_number_token(story_number: str | None) -> str | None:
    """Normalize only for comparisons; never use this value in artifact paths."""
    if story_number is None:
        return None
    normalized = story_number.lstrip("0")
    return normalized or "0"


def branch_story_number(branch: str | None) -> str | None:
    if branch is None:
        return None
    final_segment = branch.split("/")[-1].strip()
    if not final_segment:
        return None
    match = BRANCH_STORY_NUMBER_RE.match(final_segment)
    if not match:
        return None
    return match.group(1)


def normalize_additional_repositories(
    raw_value: Any, *, repo_root: str | Path | None = None
) -> list[dict[str, str]]:
    if raw_value is None:
        return []
    if not isinstance(raw_value, list):
        raise ScopeResolutionError(
            "current-plan handoff additional_repositories was not a usable list"
        )

    normalized: list[dict[str, str]] = []
    seen_paths: set[str] = set()
    for entry in raw_value:
        if not isinstance(entry, dict):
            raise ScopeResolutionError(
                "current-plan handoff additional_repositories entry was not an object"
            )
        raw_path = entry.get("path")
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise ScopeResolutionError(
                "current-plan handoff additional_repositories entry lacked a usable path"
            )
        path = str(resolve_path(raw_path, repo_root=repo_root))
        if path in seen_paths:
            continue
        seen_paths.add(path)
        normalized_entry = {"path": path}
        raw_branched_from = entry.get("branched_from")
        if isinstance(raw_branched_from, str) and raw_branched_from.strip():
            normalized_entry["branched_from"] = raw_branched_from.strip()
        normalized.append(normalized_entry)
    return normalized


def load_plan_scope(
    *, handoff: str = "codeInfoStatus/flow-state/current-plan.json", repo_root: str | Path | None = None
) -> dict[str, Any]:
    root = repo_root_path(repo_root)
    handoff_path = resolve_path(handoff, repo_root=root)
    payload = load_json_file(handoff_path)

    plan_path_raw = payload.get("plan_path")
    if not isinstance(plan_path_raw, str) or not plan_path_raw.strip():
        raise ScopeResolutionError(
            f"handoff does not contain a valid plan_path: {handoff_path}"
        )

    plan_path = resolve_path(plan_path_raw, repo_root=root)
    story_number = story_number_from_plan_name(plan_path.name)
    if story_number is None:
        raise ScopeResolutionError(
            f"plan filename did not start with a story number: {plan_path.name}"
        )

    additional_repositories = normalize_additional_repositories(
        payload.get("additional_repositories"), repo_root=root
    )

    result = {
        "repo_root": str(root),
        "handoff_path": str(handoff_path),
        "plan_path": str(plan_path),
        "plan_path_raw": plan_path_raw,
        "story_id": canonical_story_id_from_plan_name(plan_path.name),
        "story_number": story_number,
        "additional_repositories": additional_repositories,
    }
    branched_from = payload.get("branched_from")
    if isinstance(branched_from, str) and branched_from.strip():
        result["branched_from"] = branched_from.strip()
    return result


def run_git_command(
    repo_path: str | Path, args: list[str], *, check: bool = True
) -> subprocess.CompletedProcess[str]:
    command = ["git", "-C", str(repo_path), *args]
    return subprocess.run(
        command,
        check=check,
        capture_output=True,
        text=True,
    )


def is_git_repository(repo_path: str | Path) -> bool:
    try:
        result = run_git_command(repo_path, ["rev-parse", "--is-inside-work-tree"])
    except subprocess.CalledProcessError:
        return False
    return result.stdout.strip() == "true"


def current_branch(repo_path: str | Path) -> str | None:
    try:
        result = run_git_command(repo_path, ["branch", "--show-current"])
    except subprocess.CalledProcessError:
        return None
    branch = result.stdout.strip()
    return branch or None


def recent_commits(repo_path: str | Path, *, limit: int = 3) -> list[str]:
    try:
        result = run_git_command(
            repo_path, ["log", f"-{limit}", "--oneline"], check=False
        )
    except subprocess.CalledProcessError:
        return []
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]


def branch_matches_story(branch: str | None, story_number: str) -> bool:
    branch_number = branch_story_number(branch)
    if branch_number is None:
        return False
    return normalize_story_number_token(branch_number) == normalize_story_number_token(
        story_number
    )


def review_cycle_id_is_valid(
    review_cycle_id: str | None, *, story_number: str | None = None
) -> bool:
    if not isinstance(review_cycle_id, str):
        return False
    candidate = review_cycle_id.strip()
    if not candidate:
        return False
    match = REVIEW_CYCLE_ID_RE.fullmatch(candidate)
    if match is None:
        return False
    if story_number is None:
        return True
    return normalize_story_number_token(match.group("story")) == normalize_story_number_token(
        story_number
    )


def read_head_version(repo_path: str | Path, rel_path: str) -> str | None:
    try:
        result = run_git_command(repo_path, ["show", f"HEAD:{rel_path}"], check=False)
    except subprocess.CalledProcessError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout
