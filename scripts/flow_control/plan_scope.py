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
        "active_review_cycle_status": status.get("active_review_cycle_status"),
        "review_settlement_complete": status.get("review_settlement_complete"),
    }
    is_complete = (
        status.get("repair_needed") is False
        and status.get("scope_valid") is True
        and status.get("all_tasks_done") is True
        and status.get("story_complete") is True
        and status.get("review_settlement_complete") is True
    )
    if is_complete:
        return yes("plan_scope_story_complete", **context)
    return no("plan_scope_story_incomplete", **context)
