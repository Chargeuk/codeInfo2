#!/usr/bin/env python3
"""Validate the current-task handoff without rewriting flow-state files."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import plan_status
from flow_state_utils import ScopeResolutionError, load_json_file, load_plan_scope, resolve_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check whether the persisted current-task handoff is still valid."
    )
    parser.add_argument(
        "--handoff",
        default="codeInfoStatus/flow-state/current-plan.json",
        help="Path to the current-plan handoff JSON file.",
    )
    parser.add_argument(
        "--current-task",
        default="codeInfoStatus/flow-state/current-task.json",
        help="Path to the persisted current-task handoff JSON file.",
    )
    return parser.parse_args()


def summarize_task(task: dict[str, Any] | None) -> dict[str, Any] | None:
    if task is None:
        return None
    return {
        "number": task.get("number"),
        "title": task.get("title"),
        "status": task.get("status"),
        "start_line": task.get("start_line"),
        "end_line": task.get("end_line"),
        "has_unchecked_subtasks": task.get("has_unchecked_subtasks"),
        "has_unchecked_testing": task.get("has_unchecked_testing"),
        "has_live_blocker": task.get("has_live_blocker"),
    }


def task_signature(task: dict[str, Any] | None) -> tuple[Any, ...] | None:
    if task is None:
        return None
    return (
        task.get("number"),
        task.get("title"),
        task.get("status"),
    )


def build_result(
    *,
    handoff_path: Path,
    current_task_path: Path,
    plan_path: str | None,
    has_valid_current_task_handoff: bool,
    reason: str,
    persisted_selection_status: str | None,
    persisted_selection_reason: str | None,
    persisted_selected_task: dict[str, Any] | None,
    active_selected_task: dict[str, Any] | None,
    story_complete: bool,
    open_in_progress_count: int | None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "handoff_path": str(handoff_path),
        "current_task_path": str(current_task_path),
        "plan_path": plan_path,
        "has_valid_current_task_handoff": has_valid_current_task_handoff,
        "reason": reason,
        "error": error,
        "persisted_selection_status": persisted_selection_status,
        "persisted_selection_reason": persisted_selection_reason,
        "persisted_selected_task": summarize_task(persisted_selected_task),
        "active_selected_task": summarize_task(active_selected_task),
        "story_complete": story_complete,
        "open_in_progress_count": open_in_progress_count,
    }


def get_current_task_handoff_status(
    *,
    handoff: str = "codeInfoStatus/flow-state/current-plan.json",
    current_task: str = "codeInfoStatus/flow-state/current-task.json",
    repo_root: str | Path | None = None,
) -> dict[str, Any]:
    try:
        scope = load_plan_scope(handoff=handoff, repo_root=repo_root)
    except ScopeResolutionError as exc:
        return build_result(
            handoff_path=Path(handoff),
            current_task_path=Path(current_task),
            plan_path=None,
            has_valid_current_task_handoff=False,
            reason="invalid_current_plan_handoff",
            persisted_selection_status=None,
            persisted_selection_reason=None,
            persisted_selected_task=None,
            active_selected_task=None,
            story_complete=False,
            open_in_progress_count=None,
            error=str(exc),
        )
 
    handoff_path = Path(scope["handoff_path"])
    current_task_path = resolve_path(current_task, repo_root=scope["repo_root"])
    try:
        current_task = load_json_file(current_task_path)
    except ScopeResolutionError as exc:
        return build_result(
            handoff_path=handoff_path,
            current_task_path=current_task_path,
            plan_path=scope["plan_path"],
            has_valid_current_task_handoff=False,
            reason="missing_or_invalid_current_task_handoff",
            persisted_selection_status=None,
            persisted_selection_reason=None,
            persisted_selected_task=None,
            active_selected_task=None,
            story_complete=False,
            open_in_progress_count=None,
            error=str(exc),
        )

    persisted_selection_status = current_task.get("selection_status")
    persisted_selection_reason = current_task.get("selection_reason")
    persisted_selected_task = current_task.get("selected_task")
    persisted_plan_path_raw = current_task.get("plan_path")
    persisted_plan_path = None
    if isinstance(persisted_plan_path_raw, str) and persisted_plan_path_raw.strip():
        persisted_plan_path = resolve_path(
            persisted_plan_path_raw, repo_root=scope["repo_root"]
        )

    try:
        status = plan_status.get_plan_status(
            plan=scope["plan_path"],
            selector="active",
            include_tasks=True,
        )
    except SystemExit as exc:
        return build_result(
            handoff_path=handoff_path,
            current_task_path=current_task_path,
            plan_path=scope["plan_path"],
            has_valid_current_task_handoff=False,
            reason="plan_status_failed",
            persisted_selection_status=(
                persisted_selection_status
                if isinstance(persisted_selection_status, str)
                else None
            ),
            persisted_selection_reason=(
                persisted_selection_reason
                if isinstance(persisted_selection_reason, str)
                else None
            ),
            persisted_selected_task=(
                persisted_selected_task if isinstance(persisted_selected_task, dict) else None
            ),
            active_selected_task=None,
            story_complete=False,
            open_in_progress_count=None,
            error=str(exc),
        )

    tasks = status.get("tasks") or []
    open_in_progress = [
        task
        for task in tasks
        if isinstance(task, dict) and task.get("status") == "__in_progress__"
    ]
    active_selected_task = status.get("selected_task")

    result_kwargs = {
        "handoff_path": handoff_path,
        "current_task_path": current_task_path,
        "plan_path": status.get("plan_path"),
        "persisted_selection_status": (
            persisted_selection_status
            if isinstance(persisted_selection_status, str)
            else None
        ),
        "persisted_selection_reason": (
            persisted_selection_reason
            if isinstance(persisted_selection_reason, str)
            else None
        ),
        "persisted_selected_task": (
            persisted_selected_task if isinstance(persisted_selected_task, dict) else None
        ),
        "active_selected_task": (
            active_selected_task if isinstance(active_selected_task, dict) else None
        ),
        "story_complete": bool(status.get("story_complete")),
        "open_in_progress_count": len(open_in_progress),
    }

    if persisted_plan_path is None or persisted_plan_path.resolve() != Path(
        status["plan_path"]
    ).resolve():
        reason = "plan_path_mismatch"
        return build_result(
            has_valid_current_task_handoff=False,
            reason=reason,
            error=None,
            **result_kwargs,
        )
    elif result_kwargs["story_complete"]:
        return build_result(
            has_valid_current_task_handoff=False,
            reason="story_complete",
            error=None,
            **result_kwargs,
        )
    elif persisted_selection_status != "resolved":
        return build_result(
            has_valid_current_task_handoff=False,
            reason="selection_not_resolved",
            error=None,
            **result_kwargs,
        )
    elif len(open_in_progress) != 1:
        return build_result(
            has_valid_current_task_handoff=False,
            reason="active_task_count_mismatch",
            error=None,
            **result_kwargs,
        )
    elif not isinstance(persisted_selected_task, dict):
        return build_result(
            has_valid_current_task_handoff=False,
            reason="persisted_selected_task_missing",
            error=None,
            **result_kwargs,
        )
    elif not isinstance(active_selected_task, dict):
        return build_result(
            has_valid_current_task_handoff=False,
            reason="active_selected_task_missing",
            error=None,
            **result_kwargs,
        )
    elif task_signature(persisted_selected_task) != task_signature(active_selected_task):
        return build_result(
            has_valid_current_task_handoff=False,
            reason="selected_task_mismatch",
            error=None,
            **result_kwargs,
        )
    return build_result(
        has_valid_current_task_handoff=True,
        reason="valid_resolved_current_task_handoff",
        error=None,
        **result_kwargs,
    )


def main() -> int:
    args = parse_args()
    result = get_current_task_handoff_status(
        handoff=args.handoff,
        current_task=args.current_task,
    )
    json.dump(result, fp=sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
