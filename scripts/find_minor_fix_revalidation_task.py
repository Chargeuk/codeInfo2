#!/usr/bin/env python3
"""Locate the final minor-fix revalidation task in the current plan."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import plan_status
from flow_state_utils import (
    ScopeResolutionError,
    load_json_file,
    load_plan_scope,
    normalize_story_number_token,
    review_cycle_id_is_valid,
    resolve_path,
    story_number_from_plan_name,
)


ROLE_MARKER_RE = re.compile(r"Review Task Role:\s*`final_minor_fix_revalidation`")
CYCLE_ID_RE = re.compile(r"Review Cycle Id:\s*`([^`]+)`")
TITLE_RE = re.compile(
    r"^Re-Validate Story (\d+) After Inline Minor Review Fixes$", re.IGNORECASE
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Locate the current story's final minor-fix revalidation task."
    )
    parser.add_argument(
        "--handoff",
        default="codeInfoStatus/flow-state/current-plan.json",
        help="Path to the current-plan handoff JSON file.",
    )
    parser.add_argument(
        "--review-state",
        default="codeInfoStatus/flow-state/review-disposition-state.json",
        help="Path to the review disposition state JSON file.",
    )
    return parser.parse_args()


def task_block(lines: list[str], task: dict[str, Any]) -> list[str]:
    start_index = task["start_line"] - 1
    end_index = task["end_line"]
    return lines[start_index:end_index]


def task_metadata(task: dict[str, Any], block: list[str], story_number: str) -> dict[str, Any]:
    has_role_marker = any(ROLE_MARKER_RE.search(line) for line in block)
    cycle_id_match = next((CYCLE_ID_RE.search(line) for line in block if CYCLE_ID_RE.search(line)), None)
    cycle_id = cycle_id_match.group(1).strip() if cycle_id_match else None
    title_match = TITLE_RE.match(task["title"])
    title_story_matches = bool(
        title_match and title_match.group(1) in {story_number, story_number.lstrip("0")}
    )
    normalized_title = task["title"].strip().lower()
    legacy_title_match = (
        normalized_title.startswith("re-validate story ")
        and "after inline minor review fixes" in normalized_title
    )
    return {
        "has_role_marker": has_role_marker,
        "review_cycle_id": cycle_id,
        "matches": has_role_marker or title_story_matches or legacy_title_match,
        "title_story_matches": title_story_matches,
        "legacy_title_match": legacy_title_match,
    }


def summarise_task(task: dict[str, Any] | None, *, metadata: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if task is None:
        return None
    return {
        "number": task["number"],
        "title": task["title"],
        "status": task["status"],
        "start_line": task["start_line"],
        "end_line": task["end_line"],
        "review_cycle_id": None if metadata is None else metadata.get("review_cycle_id"),
        "has_role_marker": False if metadata is None else metadata.get("has_role_marker", False),
    }


def load_review_cycle_id(
    review_state_path: Path,
    *,
    repo_root: Path,
    current_story_number: str,
    current_plan_path: Path,
) -> tuple[str | None, str | None]:
    if not review_state_path.exists():
        return None, "review_state_missing"
    try:
        payload = load_json_file(review_state_path)
    except ScopeResolutionError:
        return None, "review_state_invalid"
    state_story_number = payload.get("story_number")
    if not isinstance(state_story_number, str) or not state_story_number.strip():
        return None, "review_state_story_missing"
    if normalize_story_number_token(state_story_number) != normalize_story_number_token(
        current_story_number
    ):
        return None, "review_state_story_mismatch"
    state_plan_path_raw = payload.get("plan_path")
    if not isinstance(state_plan_path_raw, str) or not state_plan_path_raw.strip():
        return None, "review_state_plan_missing"
    state_plan_path = resolve_path(state_plan_path_raw, repo_root=repo_root)
    if state_plan_path.resolve() != current_plan_path.resolve():
        return None, "review_state_plan_mismatch"
    cycle_id = payload.get("review_cycle_id")
    if not review_cycle_id_is_valid(cycle_id, story_number=current_story_number):
        return None, "review_cycle_id_invalid"
    return cycle_id.strip(), None


def get_revalidation_task_status(
    *,
    handoff: str = "codeInfoStatus/flow-state/current-plan.json",
    review_state: str = "codeInfoStatus/flow-state/review-disposition-state.json",
    repo_root: str | Path | None = None,
) -> dict[str, Any]:
    try:
        scope = load_plan_scope(handoff=handoff, repo_root=repo_root)
    except ScopeResolutionError as exc:
        return {
            "handoff_path": handoff,
            "review_state_path": review_state,
            "plan_path": None,
            "story_id": None,
            "story_number": None,
            "review_cycle_id": None,
            "error": str(exc),
            "repair_needed": True,
            "repair_action": "regenerate_current_plan_handoff",
            "repair_reason": "handoff_invalid",
            "match_found": False,
            "cycle_match_found": False,
            "match_count": 0,
            "should_reuse_existing_task": False,
            "should_reopen_task": False,
            "selected_task_is_last_task": False,
            "needs_cycle_id_backfill": False,
            "plan_order_warning": None,
            "selected_task": None,
            "candidate_tasks": [],
        }

    root = Path(scope["repo_root"])
    plan_path = Path(scope["plan_path"])
    lines = plan_path.read_text().splitlines()
    tasks = plan_status.parse_plan(plan_path)
    story_number = story_number_from_plan_name(plan_path.name) or scope["story_number"]
    review_state_path = root / review_state
    review_cycle_id, cycle_id_error = load_review_cycle_id(
        review_state_path,
        repo_root=root,
        current_story_number=story_number,
        current_plan_path=plan_path,
    )

    candidate_pairs = []
    for task in tasks:
        metadata = task_metadata(task, task_block(lines, task), story_number)
        if metadata["matches"]:
            candidate_pairs.append((task, metadata))

    cycle_matches = [
        (task, metadata)
        for task, metadata in candidate_pairs
        if review_cycle_id is not None and metadata.get("review_cycle_id") == review_cycle_id
    ]
    legacy_candidates = [
        (task, metadata)
        for task, metadata in candidate_pairs
        if metadata.get("review_cycle_id") is None
    ]
    open_legacy_candidates = [
        (task, metadata)
        for task, metadata in legacy_candidates
        if task["status"] in {"__to_do__", "__in_progress__"}
    ]
    explicit_cycle_candidates = [
        (task, metadata)
        for task, metadata in candidate_pairs
        if metadata.get("review_cycle_id") is not None
    ]

    repair_needed = False
    repair_action = None
    repair_reason = None
    needs_cycle_id_backfill = False

    selected_pair: tuple[dict[str, Any], dict[str, Any]] | None = None
    if len(cycle_matches) > 1:
        repair_needed = True
        repair_action = "repair_revalidation_task_identity"
        repair_reason = "duplicate_current_cycle_revalidation_tasks"
    elif cycle_matches:
        selected_pair = max(cycle_matches, key=lambda item: item[0]["number"])
    elif (
        review_cycle_id is not None
        and len(open_legacy_candidates) == 1
        and len(candidate_pairs) == 1
    ):
        selected_pair = open_legacy_candidates[0]
        needs_cycle_id_backfill = True
    elif cycle_id_error is not None:
        repair_needed = True
        repair_action = "rebuild_review_disposition_state"
        repair_reason = cycle_id_error
        if len(open_legacy_candidates) == 1 and not explicit_cycle_candidates:
            selected_pair = open_legacy_candidates[0]
            needs_cycle_id_backfill = True

    selected_task = None if selected_pair is None else selected_pair[0]
    selected_metadata = None if selected_pair is None else selected_pair[1]
    highest_task_number = max((task["number"] for task in tasks), default=0)
    selected_task_is_last = bool(
        selected_task is not None and selected_task["number"] == highest_task_number
    )
    plan_order_warning = None
    if selected_task is not None and not selected_task_is_last:
        plan_order_warning = "selected_revalidation_task_is_not_last_task"
    return {
        "handoff_path": scope["handoff_path"],
        "review_state_path": str(review_state_path),
        "plan_path": scope["plan_path_raw"],
        "story_id": scope.get("story_id"),
        "story_number": story_number,
        "review_cycle_id": review_cycle_id,
        "error": None,
        "repair_needed": repair_needed,
        "repair_action": repair_action,
        "repair_reason": repair_reason,
        "match_found": selected_task is not None,
        "cycle_match_found": bool(cycle_matches),
        "match_count": len(candidate_pairs),
        "should_reuse_existing_task": selected_task is not None and not repair_needed,
        "should_reopen_task": bool(
            selected_task and selected_task["status"] == "__done__" and not repair_needed
        ),
        "selected_task_is_last_task": selected_task_is_last,
        "needs_cycle_id_backfill": needs_cycle_id_backfill,
        "plan_order_warning": plan_order_warning,
        "selected_task": summarise_task(selected_task, metadata=selected_metadata),
        "candidate_tasks": [
            summarise_task(task, metadata=metadata) for task, metadata in candidate_pairs
        ],
    }


def main() -> int:
    args = parse_args()
    output = get_revalidation_task_status(
        handoff=args.handoff,
        review_state=args.review_state,
    )
    json.dump(output, fp=__import__("sys").stdout, indent=2)
    __import__("sys").stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
