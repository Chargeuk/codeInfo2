"""Story-level loop-control decisions built from story_workflow_status.py."""

from __future__ import annotations

import os
from typing import Any

import story_workflow_status
from flow_control.decision import DecisionOutcome, no, yes


def _status_context(status: dict[str, Any]) -> dict[str, Any]:
    return {
        "status_kind": status.get("status_kind"),
        "repair_needed": status.get("repair_needed"),
        "scope_valid": status.get("scope_valid"),
        "story_complete": status.get("story_complete"),
        "all_tasks_done": status.get("all_tasks_done"),
        "review_state_repair_needed": status.get("review_state_repair_needed"),
        "should_exit_review_loop_to_main_loop": status.get(
            "should_exit_review_loop_to_main_loop"
        ),
        "should_finish_review_loop_cleanly": status.get(
            "should_finish_review_loop_cleanly"
        ),
        "repair_action": status.get("repair_action"),
        "review_state_repair_action": status.get("review_state_repair_action"),
    }


def _workflow_status() -> dict[str, Any]:
    return story_workflow_status.get_story_workflow_status(include_tasks=False)


def check_story_complete() -> DecisionOutcome:
    status = _workflow_status()
    is_complete = (
        status.get("repair_needed") is False
        and status.get("scope_valid") is True
        and status.get("story_complete") is True
    )
    if is_complete:
        return yes("story_complete", **_status_context(status))
    return no("story_incomplete", **_status_context(status))


def check_review_should_exit_to_main_loop() -> DecisionOutcome:
    status = _workflow_status()
    should_exit = (
        status.get("repair_needed") is False
        and status.get("review_state_repair_needed") is False
        and status.get("should_exit_review_loop_to_main_loop") is True
    )
    if should_exit:
        return yes("review_loop_should_exit_to_main", **_status_context(status))
    return no("review_loop_should_not_exit_to_main", **_status_context(status))


def check_review_should_finish_cleanly() -> DecisionOutcome:
    status = _workflow_status()
    should_finish = (
        status.get("repair_needed") is False
        and status.get("review_state_repair_needed") is False
        and status.get("should_finish_review_loop_cleanly") is True
    )
    if should_finish:
        return yes("review_loop_should_finish_cleanly", **_status_context(status))
    return no("review_loop_should_not_finish_cleanly", **_status_context(status))


def check_github_review_should_write_no_findings_closeout() -> DecisionOutcome:
    if os.environ.get("CODEINFO_GITHUB_REVIEW_SKIPPED") == "1":
        return no("github_review_was_skipped")
    required_context = (
        "CODEINFO_GITHUB_REVIEW_EXECUTION_ID",
        "CODEINFO_GITHUB_REVIEW_PR_NUMBER",
        "CODEINFO_GITHUB_REVIEW_HANDOFF_PATH",
    )
    if any(not os.environ.get(name, "").strip() for name in required_context):
        return no("github_review_context_missing")
    return check_review_should_finish_cleanly()
