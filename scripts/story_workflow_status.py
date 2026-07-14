#!/usr/bin/env python3
"""Report combined story, repository-scope, and review-loop status."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import plan_status
from flow_state_utils import (
    ScopeResolutionError,
    branch_story_number,
    branch_matches_story,
    current_branch,
    is_git_repository,
    load_json_file,
    load_plan_scope,
    normalize_story_number_token,
    recent_commits,
    review_cycle_id_is_valid,
    resolve_path,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Report combined story completion, repository scope, and review-loop "
            "status for the current implementation handoff."
        )
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
    parser.add_argument(
        "--include-tasks",
        action="store_true",
        help="Include per-task detail from plan_status.py in the JSON output.",
    )
    return parser.parse_args()


def repository_status(
    *, repo_path: Path, story_number: str, label: str, branched_from: str | None = None
) -> dict[str, Any]:
    exists = repo_path.exists()
    readable = exists and repo_path.is_dir()
    git_repo = readable and is_git_repository(repo_path)
    branch = current_branch(repo_path) if git_repo else None
    commits = recent_commits(repo_path) if git_repo else []
    status = {
        "label": label,
        "path": str(repo_path),
        "exists": exists,
        "readable": readable,
        "is_git_repository": git_repo,
        "branch": branch,
        "parsed_branch_story_number": branch_story_number(branch),
        "story_number_matches": branch_matches_story(branch, story_number),
        "recent_commits": commits,
    }
    if branched_from is not None:
        status["branched_from"] = branched_from
    return status


def load_review_state(
    review_state_path: Path,
    *,
    repo_root: Path,
    current_story_number: str,
    current_plan_path: Path,
) -> dict[str, Any]:
    if not review_state_path.exists():
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": False,
            "review_state_valid": False,
            "review_state_error": "review disposition state missing",
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_state_missing",
        }
    try:
        payload = load_json_file(review_state_path)
    except ScopeResolutionError as exc:
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": True,
            "review_state_valid": False,
            "review_state_error": str(exc),
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_state_invalid",
        }

    schema_version = payload.get("schema_version")
    if schema_version is not None and schema_version != 1:
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": True,
            "review_state_valid": False,
            "review_state_error": f"incompatible review disposition schema_version: {schema_version}",
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_state_schema_mismatch",
        }

    state_story_number = payload.get("story_number")
    if not isinstance(state_story_number, str) or not state_story_number.strip():
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": True,
            "review_state_valid": False,
            "review_state_error": "review disposition state lacked a usable story_number",
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_state_story_missing",
        }
    if normalize_story_number_token(state_story_number) != normalize_story_number_token(
        current_story_number
    ):
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": True,
            "review_state_valid": False,
            "review_state_error": (
                "review disposition state story_number did not match the current story "
                f"({state_story_number!r} != {current_story_number!r})"
            ),
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_state_story_mismatch",
        }

    state_plan_path_raw = payload.get("plan_path")
    if not isinstance(state_plan_path_raw, str) or not state_plan_path_raw.strip():
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": True,
            "review_state_valid": False,
            "review_state_error": "review disposition state lacked a usable plan_path",
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_state_plan_missing",
        }

    state_plan_path = resolve_path(state_plan_path_raw, repo_root=repo_root)
    if state_plan_path.resolve() != current_plan_path.resolve():
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": True,
            "review_state_valid": False,
            "review_state_error": (
                "review disposition state plan_path did not match the current plan "
                f"({state_plan_path_raw!r} != {str(current_plan_path)!r})"
            ),
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_state_plan_mismatch",
        }

    review_cycle_id = payload.get("review_cycle_id")
    if not review_cycle_id_is_valid(
        review_cycle_id, story_number=current_story_number
    ):
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": True,
            "review_state_valid": False,
            "review_state_error": "review disposition state lacked a valid review_cycle_id",
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_cycle_id_invalid",
        }

    boolean_fields = {
        "review_created_tasks_added_or_updated": payload.get(
            "review_created_tasks_added_or_updated"
        ),
        "needs_review_rerun_before_close": payload.get(
            "needs_review_rerun_before_close"
        ),
        "needs_final_minor_fix_revalidation_task": payload.get(
            "needs_final_minor_fix_revalidation_task"
        ),
        "safe_to_exit_review_loop_without_tasking": payload.get(
            "safe_to_exit_review_loop_without_tasking"
        ),
    }
    invalid_boolean_fields = [
        field_name
        for field_name, value in boolean_fields.items()
        if not isinstance(value, bool)
    ]
    if invalid_boolean_fields:
        return {
            "review_state_path": str(review_state_path),
            "review_state_present": True,
            "review_state_valid": False,
            "review_state_error": (
                "review disposition state had non-boolean review flags: "
                + ", ".join(invalid_boolean_fields)
            ),
            "review_state_repair_action": "rebuild_review_disposition_state",
            "review_state_repair_reason": "review_state_flag_type_invalid",
        }

    review_created_tasks = boolean_fields["review_created_tasks_added_or_updated"]
    needs_review_rerun = boolean_fields["needs_review_rerun_before_close"]
    needs_final_minor = boolean_fields["needs_final_minor_fix_revalidation_task"]
    safe_to_exit = boolean_fields["safe_to_exit_review_loop_without_tasking"]
    return {
        "review_state_path": str(review_state_path),
        "review_state_present": True,
        "review_state_valid": True,
        "review_state_error": None,
        "review_state_repair_action": None,
        "review_state_repair_reason": None,
        "review_state_payload": payload,
        "review_created_tasks_added_or_updated": review_created_tasks,
        "needs_review_rerun_before_close": needs_review_rerun,
        "needs_final_minor_fix_revalidation_task": needs_final_minor,
        "safe_to_exit_review_loop_without_tasking": safe_to_exit,
        "review_cycle_id": review_cycle_id,
        "should_exit_review_loop_to_main_loop": review_created_tasks,
        "should_finish_review_loop_cleanly": (
            not needs_review_rerun and not review_created_tasks
        ),
    }


def scope_failure_reason(repositories: list[dict[str, Any]]) -> str | None:
    for repository in repositories:
        if not repository["exists"]:
            return "repository_missing"
        if not repository["readable"]:
            return "repository_unreadable"
        if not repository["is_git_repository"]:
            return "repository_not_git"
        if not repository["story_number_matches"]:
            return "repository_branch_mismatch"
    return None


def scope_repair_action_for_reason(reason: str) -> str:
    if reason == "handoff_invalid":
        return "regenerate_current_plan_handoff"
    if reason == "repository_branch_mismatch":
        return "normalize_scope_then_refresh_handoff"
    if reason in {
        "repository_missing",
        "repository_unreadable",
        "repository_not_git",
        "plan_missing",
        "plan_status_error",
    }:
        return "refresh_current_plan_handoff"
    return "refresh_current_plan_handoff"


def status_kind_for_scope(*, repair_needed: bool, story_complete: bool) -> str:
    if repair_needed:
        return "scope_repair_needed"
    if story_complete:
        return "story_complete"
    return "story_incomplete"


def get_story_workflow_status(
    *,
    handoff: str = "codeInfoStatus/flow-state/current-plan.json",
    review_state: str = "codeInfoStatus/flow-state/review-disposition-state.json",
    include_tasks: bool = False,
    repo_root: str | Path | None = None,
) -> dict[str, Any]:
    try:
        scope = load_plan_scope(handoff=handoff, repo_root=repo_root)
    except ScopeResolutionError as exc:
        return {
            "handoff_path": handoff,
            "review_state_path": str(Path(review_state)),
            "plan_path": None,
            "story_id": None,
            "story_number": None,
            "status_kind": "scope_repair_needed",
            "repair_needed": True,
            "repair_action": "regenerate_current_plan_handoff",
            "repair_reason": "handoff_invalid",
            "scope_valid": False,
            "scope_failure_reason": "handoff_invalid",
            "scope_error": str(exc),
            "repositories": [],
            "all_tasks_done": False,
            "story_complete": False,
            "final_task_status": None,
            "tasks": [] if include_tasks else None,
            "review_state_present": False,
            "review_state_valid": False,
            "review_state_error": "review disposition state unavailable until handoff is repaired",
            "review_state_repair_needed": False,
            "review_state_repair_action": None,
            "review_state_repair_reason": None,
            "review_cycle_id": None,
            "review_created_tasks_added_or_updated": False,
            "needs_review_rerun_before_close": False,
            "needs_final_minor_fix_revalidation_task": False,
            "safe_to_exit_review_loop_without_tasking": False,
            "should_exit_review_loop_to_main_loop": False,
            "should_finish_review_loop_cleanly": False,
        }

    root = Path(scope["repo_root"])
    current_repo_status = repository_status(
        repo_path=root,
        story_number=scope["story_number"],
        label="current_repository",
        branched_from=scope.get("branched_from"),
    )
    additional_statuses = [
        repository_status(
            repo_path=Path(entry["path"]),
            story_number=scope["story_number"],
            label=f"additional_repository_{index + 1}",
            branched_from=entry.get("branched_from"),
        )
        for index, entry in enumerate(scope["additional_repositories"])
    ]
    repositories = [current_repo_status, *additional_statuses]

    failure_reason = scope_failure_reason(repositories)
    plan_exists = Path(scope["plan_path"]).exists()
    if not plan_exists:
        failure_reason = failure_reason or "plan_missing"

    try:
        plan = plan_status.get_plan_status(
            plan=scope["plan_path"],
            include_tasks=include_tasks,
        )
        plan_error = None
    except SystemExit as exc:
        plan = None
        plan_error = str(exc)
        failure_reason = failure_reason or "plan_status_error"

    review_status = load_review_state(
        root / review_state,
        repo_root=root,
        current_story_number=scope["story_number"],
        current_plan_path=Path(scope["plan_path"]),
    )
    repair_needed = failure_reason is not None
    repair_action = (
        scope_repair_action_for_reason(failure_reason) if failure_reason is not None else None
    )
    story_complete = bool(plan and plan["story_complete"])
    status_kind = status_kind_for_scope(
        repair_needed=repair_needed,
        story_complete=story_complete,
    )

    return {
        "handoff_path": scope["handoff_path"],
        "review_state_path": review_status["review_state_path"],
        "plan_path": scope["plan_path_raw"],
        "story_id": scope.get("story_id"),
        "story_number": scope["story_number"],
        "status_kind": status_kind,
        "repair_needed": repair_needed,
        "repair_action": repair_action,
        "repair_reason": failure_reason,
        "scope_valid": failure_reason is None,
        "scope_failure_reason": failure_reason,
        "scope_error": plan_error,
        "repositories": repositories,
        "current_repository": current_repo_status,
        "additional_repositories": additional_statuses,
        "all_tasks_done": bool(plan and plan["all_tasks_done"]),
        "story_complete": story_complete,
        "final_task_status": plan["final_task_status"] if plan else None,
        "selected_task": plan["selected_task"] if plan else None,
        "highest_in_progress_task": plan["highest_in_progress_task"] if plan else None,
        "earliest_todo_task": plan["earliest_todo_task"] if plan else None,
        "tasks": plan["tasks"] if plan and include_tasks else ([] if include_tasks else None),
        "review_state_present": review_status["review_state_present"],
        "review_state_valid": review_status["review_state_valid"],
        "review_state_error": review_status["review_state_error"],
        "review_state_repair_needed": not review_status["review_state_valid"],
        "review_state_repair_action": review_status.get("review_state_repair_action"),
        "review_state_repair_reason": review_status.get("review_state_repair_reason"),
        "review_cycle_id": review_status.get("review_cycle_id"),
        "review_created_tasks_added_or_updated": review_status.get(
            "review_created_tasks_added_or_updated", False
        ),
        "needs_review_rerun_before_close": review_status.get(
            "needs_review_rerun_before_close", False
        ),
        "needs_final_minor_fix_revalidation_task": review_status.get(
            "needs_final_minor_fix_revalidation_task", False
        ),
        "safe_to_exit_review_loop_without_tasking": review_status.get(
            "safe_to_exit_review_loop_without_tasking", False
        ),
        "should_exit_review_loop_to_main_loop": review_status.get(
            "should_exit_review_loop_to_main_loop", False
        ),
        "should_finish_review_loop_cleanly": review_status.get(
            "should_finish_review_loop_cleanly", False
        ),
    }


def main() -> int:
    args = parse_args()
    output = get_story_workflow_status(
        handoff=args.handoff,
        review_state=args.review_state,
        include_tasks=args.include_tasks,
    )
    json.dump(output, fp=__import__("sys").stdout, indent=2)
    __import__("sys").stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
