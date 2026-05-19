"""Current-task loop-control decisions built from deterministic workflow scripts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import check_current_task_handoff
import plan_status
from flow_control.decision import DecisionOutcome, no, yes
from flow_state_utils import ScopeResolutionError, load_json_file, resolve_path


DEFAULT_HANDOFF = "codeInfoStatus/flow-state/current-plan.json"
DEFAULT_CURRENT_TASK = "codeInfoStatus/flow-state/current-task.json"


def _load_current_task_payload(
    *, current_task: str = DEFAULT_CURRENT_TASK
) -> tuple[dict[str, Any] | None, Path | None, str | None]:
    current_task_path = resolve_path(current_task)
    try:
        payload = load_json_file(current_task_path)
    except ScopeResolutionError as exc:
        return None, current_task_path, str(exc)
    return payload, current_task_path, None


def _bound_task_number(payload: dict[str, Any] | None) -> int | None:
    if not isinstance(payload, dict):
        return None
    selected_task = payload.get("selected_task")
    if not isinstance(selected_task, dict):
        return None
    number = selected_task.get("number")
    if isinstance(number, int) and number > 0:
        return number
    if isinstance(number, str) and number.isdigit():
        return int(number)
    return None


def _plan_status_for_bound_task(
    bound_task_number: int, *, handoff: str = DEFAULT_HANDOFF
) -> dict[str, Any] | None:
    try:
        return plan_status.get_plan_status(
            handoff=handoff,
            selector="active_or_done",
            task_number=bound_task_number,
            include_tasks=False,
        )
    except SystemExit:
        return None


def _selected_task(status: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(status, dict):
        return None
    selected_task = status.get("selected_task")
    if isinstance(selected_task, dict):
        return selected_task
    return None


def _has_live_blockers(task: dict[str, Any]) -> bool:
    live_blockers = task.get("live_blockers")
    if isinstance(live_blockers, list):
        return len(live_blockers) > 0
    return bool(task.get("has_live_blocker"))


def _task_context(
    payload: dict[str, Any] | None,
    status: dict[str, Any] | None,
    bound_task_number: int | None,
) -> dict[str, Any]:
    selected_task = _selected_task(status)
    return {
        "bound_task_number": bound_task_number,
        "current_task_selection_status": (
            payload.get("selection_status") if isinstance(payload, dict) else None
        ),
        "current_task_selection_reason": (
            payload.get("selection_reason") if isinstance(payload, dict) else None
        ),
        "selected_task": selected_task,
    }


def check_current_task_handoff_invalid() -> DecisionOutcome:
    status = check_current_task_handoff.get_current_task_handoff_status(
        handoff=DEFAULT_HANDOFF,
        current_task=DEFAULT_CURRENT_TASK,
    )
    has_valid = status.get("has_valid_current_task_handoff") is True
    if has_valid:
        return no(
            "current_task_handoff_valid",
            handoff_status=status,
        )
    return yes(
        "current_task_handoff_invalid",
        handoff_status=status,
    )


def check_current_task_implementation_complete() -> DecisionOutcome:
    payload, _path, error = _load_current_task_payload()
    if error:
        return no("current_task_unreadable", error=error)
    bound_task_number = _bound_task_number(payload)
    if bound_task_number is None:
        return no("bound_task_missing", current_task=payload)
    status = _plan_status_for_bound_task(bound_task_number)
    selected_task = _selected_task(status)
    if selected_task is None:
        return no(
            "selected_task_missing",
            **_task_context(payload, status, bound_task_number),
        )
    if selected_task.get("has_unchecked_subtasks") is False and not _has_live_blockers(
        selected_task
    ):
        return yes(
            "implementation_complete",
            **_task_context(payload, status, bound_task_number),
        )
    return no(
        "implementation_incomplete",
        **_task_context(payload, status, bound_task_number),
    )


def check_current_task_has_blocker() -> DecisionOutcome:
    payload, _path, error = _load_current_task_payload()
    if error:
        return yes("current_task_unreadable", error=error)
    bound_task_number = _bound_task_number(payload)
    if bound_task_number is None:
        return yes("bound_task_missing", current_task=payload)
    status = _plan_status_for_bound_task(bound_task_number)
    selected_task = _selected_task(status)
    if selected_task is None:
        return yes(
            "selected_task_missing",
            **_task_context(payload, status, bound_task_number),
        )
    if _has_live_blockers(selected_task):
        return yes(
            "live_blockers_present",
            **_task_context(payload, status, bound_task_number),
        )
    return no(
        "no_live_blockers",
        **_task_context(payload, status, bound_task_number),
    )


def check_current_task_ready_for_manual_testing() -> DecisionOutcome:
    payload, _path, error = _load_current_task_payload()
    if error:
        return no("current_task_unreadable", error=error)
    bound_task_number = _bound_task_number(payload)
    if bound_task_number is None:
        return no("bound_task_missing", current_task=payload)
    status = _plan_status_for_bound_task(bound_task_number)
    selected_task = _selected_task(status)
    if selected_task is None:
        return no(
            "selected_task_missing",
            **_task_context(payload, status, bound_task_number),
        )
    is_ready = (
        selected_task.get("has_unchecked_subtasks") is False
        and selected_task.get("has_unchecked_testing") is False
        and not _has_live_blockers(selected_task)
    )
    if is_ready:
        return yes(
            "ready_for_manual_testing",
            **_task_context(payload, status, bound_task_number),
        )
    return no(
        "manual_testing_not_ready",
        **_task_context(payload, status, bound_task_number),
    )


def check_current_task_has_unchecked_subtasks() -> DecisionOutcome:
    payload, _path, error = _load_current_task_payload()
    if error:
        return no("current_task_unreadable", error=error)
    bound_task_number = _bound_task_number(payload)
    if bound_task_number is None:
        return no("bound_task_missing", current_task=payload)
    status = _plan_status_for_bound_task(bound_task_number)
    selected_task = _selected_task(status)
    if selected_task is None:
        return no(
            "selected_task_missing",
            **_task_context(payload, status, bound_task_number),
        )
    has_unchecked_subtasks = selected_task.get("has_unchecked_subtasks") is True
    if has_unchecked_subtasks and not _has_live_blockers(selected_task):
        return yes(
            "unchecked_subtasks_present",
            **_task_context(payload, status, bound_task_number),
        )
    if has_unchecked_subtasks:
        return no(
            "unchecked_subtasks_blocked",
            **_task_context(payload, status, bound_task_number),
        )
    return no(
        "unchecked_subtasks_absent",
        **_task_context(payload, status, bound_task_number),
    )


def check_current_task_has_unchecked_testing() -> DecisionOutcome:
    payload, _path, error = _load_current_task_payload()
    if error:
        return no("current_task_unreadable", error=error)
    bound_task_number = _bound_task_number(payload)
    if bound_task_number is None:
        return no("bound_task_missing", current_task=payload)
    status = _plan_status_for_bound_task(bound_task_number)
    selected_task = _selected_task(status)
    if selected_task is None:
        return no(
            "selected_task_missing",
            **_task_context(payload, status, bound_task_number),
        )
    has_unchecked_testing = (
        selected_task.get("has_unchecked_subtasks") is False
        and selected_task.get("has_unchecked_testing") is True
        and not _has_live_blockers(selected_task)
    )
    if has_unchecked_testing:
        return yes(
            "unchecked_testing_present",
            **_task_context(payload, status, bound_task_number),
        )
    return no(
        "unchecked_testing_absent",
        **_task_context(payload, status, bound_task_number),
    )


def check_current_task_has_manual_testing_blocker() -> DecisionOutcome:
    payload, _path, error = _load_current_task_payload()
    if error:
        return no("current_task_unreadable", error=error)
    bound_task_number = _bound_task_number(payload)
    if bound_task_number is None:
        return no("bound_task_missing", current_task=payload)
    status = _plan_status_for_bound_task(bound_task_number)
    selected_task = _selected_task(status)
    if selected_task is None:
        return no(
            "selected_task_missing",
            **_task_context(payload, status, bound_task_number),
        )
    if _has_live_blockers(selected_task):
        return yes(
            "manual_testing_blocker_present",
            **_task_context(payload, status, bound_task_number),
        )
    return no(
        "manual_testing_blocker_absent",
        **_task_context(payload, status, bound_task_number),
    )
