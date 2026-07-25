"""Plan-scope final completion decisions for flow loop control."""

from __future__ import annotations

from typing import Any

import story_workflow_status
from flow_control.decision import DecisionOutcome, no, yes


def check_plan_scope_story_complete() -> DecisionOutcome:
    status = story_workflow_status.get_story_workflow_status(include_tasks=False)
    context: dict[str, Any] = {
        "repair_needed": status.get("repair_needed"),
        "scope_valid": status.get("scope_valid"),
        "all_tasks_done": status.get("all_tasks_done"),
        "story_complete": status.get("story_complete"),
        "final_task_status": status.get("final_task_status"),
        "review_state_valid": status.get("review_state_valid"),
        "review_state_repair_needed": status.get("review_state_repair_needed"),
        "review_cycle_id": status.get("review_cycle_id"),
        "active_review_cycle_id": status.get("active_review_cycle_id"),
        "review_created_tasks_added_or_updated": status.get(
            "review_created_tasks_added_or_updated"
        ),
        "needs_review_rerun_before_close": status.get(
            "needs_review_rerun_before_close"
        ),
        "safe_to_exit_review_loop_without_tasking": status.get(
            "safe_to_exit_review_loop_without_tasking"
        ),
        "should_finish_review_loop_cleanly": status.get(
            "should_finish_review_loop_cleanly"
        ),
        "active_review_cycle_status": status.get("active_review_cycle_status"),
        "review_settlement_complete": status.get("review_settlement_complete"),
    }
    review_cycle_matches_active = (
        isinstance(status.get("review_cycle_id"), str)
        and status.get("review_cycle_id") == status.get("active_review_cycle_id")
    )
    context["review_cycle_matches_active"] = review_cycle_matches_active
    is_complete = (
        status.get("repair_needed") is False
        and status.get("scope_valid") is True
        and status.get("all_tasks_done") is True
        and status.get("story_complete") is True
        and status.get("review_state_valid") is True
        and status.get("review_state_repair_needed") is False
        and review_cycle_matches_active
        and status.get("review_created_tasks_added_or_updated") is False
        and status.get("needs_review_rerun_before_close") is False
        and status.get("safe_to_exit_review_loop_without_tasking") is True
        and status.get("should_finish_review_loop_cleanly") is True
        and status.get("review_settlement_complete") is True
    )
    if is_complete:
        return yes("plan_scope_story_complete", **context)
    return no("plan_scope_story_incomplete", **context)
