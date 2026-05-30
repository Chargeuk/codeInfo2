"""Review-loop loop-control decisions from review-disposition state."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from flow_control.decision import DecisionOutcome, no, yes
from flow_state_utils import ScopeResolutionError, load_json_file, resolve_path


DEFAULT_REVIEW_STATE = "codeInfoStatus/flow-state/review-disposition-state.json"
DEFAULT_MINOR_FIX_RESULT = "codeInfoStatus/flow-state/minor-review-fix-result.json"


def _load_review_state(
    review_state: str = DEFAULT_REVIEW_STATE,
) -> tuple[dict[str, Any] | None, Path, str | None]:
    review_state_path = resolve_path(review_state)
    try:
        payload = load_json_file(review_state_path)
    except ScopeResolutionError as exc:
        return None, review_state_path, str(exc)
    return payload, review_state_path, None


def _load_optional_json(path: str) -> dict[str, Any] | None:
    try:
        payload = load_json_file(resolve_path(path))
    except ScopeResolutionError:
        return None
    return payload


def _review_context(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"review_state": None}
    return {
        "needs_minor_fix_path": payload.get("needs_minor_fix_path"),
        "needs_task_up_path": payload.get("needs_task_up_path"),
        "needs_review_rerun_before_close": payload.get(
            "needs_review_rerun_before_close"
        ),
        "review_created_tasks_added_or_updated": payload.get(
            "review_created_tasks_added_or_updated"
        ),
        "review_rerun_count": _review_rerun_count(payload),
    }


def _review_rerun_count(payload: dict[str, Any] | None) -> int:
    if not isinstance(payload, dict):
        return 0
    value = payload.get("review_rerun_count")
    if isinstance(value, int) and value >= 0:
        return value
    return 0


def _review_rerun_budget_exhausted(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return False
    return (
        payload.get("needs_review_rerun_before_close") is True
        and _review_rerun_count(payload) >= 1
        and payload.get("review_created_tasks_added_or_updated") is not True
    )


def check_review_minor_fix_path_clear() -> DecisionOutcome:
    payload, _path, error = _load_review_state()
    if error:
        return yes("review_state_unreadable", error=error)
    if payload.get("needs_minor_fix_path") is True:
        return no("minor_fix_path_still_needed", **_review_context(payload))
    return yes("minor_fix_path_clear", **_review_context(payload))


def check_review_minor_fix_path_clear_after_sync() -> DecisionOutcome:
    payload, _path, error = _load_review_state()
    minor_fix_result = _load_optional_json(DEFAULT_MINOR_FIX_RESULT)
    if error:
        return yes(
            "review_state_unreadable_after_sync",
            error=error,
            minor_fix_result=minor_fix_result,
        )
    if payload.get("needs_minor_fix_path") is True:
        return no(
            "minor_fix_path_still_needed_after_sync",
            **_review_context(payload),
            minor_fix_result=minor_fix_result,
        )
    return yes(
        "minor_fix_path_clear_after_sync",
        **_review_context(payload),
        minor_fix_result=minor_fix_result,
    )


def check_review_task_up_path_clear() -> DecisionOutcome:
    payload, _path, error = _load_review_state()
    if error:
        return yes("review_state_unreadable", error=error)
    if payload.get("needs_task_up_path") is True:
        return no("task_up_path_still_needed", **_review_context(payload))
    if _review_rerun_budget_exhausted(payload):
        return no("review_rerun_budget_exhausted", **_review_context(payload))
    return yes("task_up_path_clear", **_review_context(payload))
