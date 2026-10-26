"""Story-level loop-control decisions built from story_workflow_status.py."""

from __future__ import annotations

import os
from pathlib import Path
import re
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


def check_story_has_durable_blocker() -> DecisionOutcome:
    """Exit incomplete only at the current-plan flows' post-repair boundary.

    Callers must first run bounded repair/research, planner impact repair,
    handoff refresh, workflow repair and task reselection. The upstream
    research_blocker_impact_on_plan.md contract owns live markers: it retires
    actionable blockers and exposes executable prerequisites as unfinished
    unblocked tasks. Explicit dependencies propagate retained blockers to
    unfinished downstream tasks without duplicating blocker markers.
    Intermediate gates and workers still own independent
    proof within a blocked task; counting markers does not prove exhaustion.
    Never use this predicate as a task-level proof eligibility gate.
    """
    try:
        status = story_workflow_status.get_story_workflow_status(include_tasks=True)
    except (OSError, ValueError, SystemExit) as exc:
        return no("story_state_repair_needed", error=str(exc))

    context = _status_context(status)
    if status.get("repair_needed") is not False or status.get("scope_valid") is not True:
        return no(
            "story_scope_repair_needed",
            repair_reason=status.get("repair_reason"),
            scope_error=status.get("scope_error"),
            **context,
        )

    tasks = status.get("tasks")
    if not tasks:
        return no("story_task_state_repair_needed", issue="missing_tasks", **context)

    numbers: set[int] = set()
    remaining: list[dict[str, Any]] = []
    for task in tasks:
        number = task["number"]
        task_status = task["status"]
        if (
            number <= 0
            or number in numbers
            or task_status not in ("__done__", "__in_progress__", "__to_do__")
        ):
            return no(
                "story_task_state_repair_needed",
                issue="task_identity_or_status",
                task_number=number,
                **context,
            )
        numbers.add(number)
        if task_status == "__done__":
            if (
                task["live_blockers"]
                or task["has_unchecked_subtasks"]
                or task["has_unchecked_testing"]
            ):
                return no(
                    "story_task_state_repair_needed",
                    issue="done_task_has_open_obligations",
                    task_number=number,
                    **context,
                )
        else:
            remaining.append(task)

    # Plan completion must continue to review, including when settlement is pending
    # and reselection deliberately leaves no current-task handoff.
    if not remaining:
        return no("story_complete", **context)
    if not any(task["live_blockers"] for task in remaining):
        return no("no_live_blockers", **context)
    blocked = {task["number"] for task in remaining if task["live_blockers"]}
    if len(blocked) != len(remaining):
        # Keep dependency reads local to this decision; other story/review checks
        # retain their existing inputs and behavior.
        from plan_sections import task_index_entry

        dependencies: dict[int, set[int]] = {}
        try:
            lines = Path(status["plan_path"]).read_text().splitlines()
            for task in remaining:
                if task["number"] in blocked:
                    continue
                raw = task_index_entry(lines, task).get("task_dependencies", "")
                raw = raw.replace("`", "").strip()
                if raw.lower() in ("", "none"):
                    required: set[int] = set()
                else:
                    if not re.fullmatch(
                        r"(?:Task\s+)?[1-9]\d*(?:\s*,\s*(?:Task\s+)?[1-9]\d*)*",
                        raw,
                        re.IGNORECASE,
                    ):
                        raise ValueError("Dependencies must be explicit task numbers")
                    required = {int(number) for number in re.findall(r"\d+", raw)}
                    if not required <= numbers:
                        raise ValueError("Dependency refers to an unknown task")
                dependencies[task["number"]] = required
        except (OSError, ValueError, IndexError) as exc:
            return no(
                "story_task_state_repair_needed",
                issue="task_dependencies_unreadable",
                error=str(exc),
                **context,
            )

        # Only propagate from proven blockers. Unseeded cycles stay unresolved,
        # completed tasks never propagate, and independent work prevents exit.
        while True:
            newly_blocked = {
                number for number, required in dependencies.items()
                if number not in blocked and required & blocked
            }
            if not newly_blocked:
                break
            blocked.update(newly_blocked)
        if len(blocked) != len(remaining):
            return no("unfinished_unblocked_tasks_remain", **context)
    return yes("story_durably_blocked_after_repair", tasks=remaining, **context)


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
