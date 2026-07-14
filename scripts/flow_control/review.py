"""Review-loop loop-control decisions from review-disposition state."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from flow_control.decision import DecisionOutcome, no, yes
from flow_state_utils import ScopeResolutionError, load_json_file, resolve_path


DEFAULT_REVIEW_STATE = "codeInfoStatus/flow-state/review-disposition-state.json"
DEFAULT_MINOR_FIX_RESULT = "codeInfoStatus/flow-state/minor-review-fix-result.json"
DEFAULT_CURRENT_PLAN = "codeInfoStatus/flow-state/current-plan.json"


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
        "review_pass_id": payload.get("review_pass_id"),
    }


def _structured_review_block_status(
    payload: dict[str, Any],
) -> tuple[bool, str]:
    review_pass_id = payload.get("review_pass_id")
    if not isinstance(review_pass_id, str) or not review_pass_id.strip():
        return False, "review_pass_id_missing"

    try:
        current_plan = load_json_file(resolve_path(DEFAULT_CURRENT_PLAN))
    except ScopeResolutionError:
        return False, "current_plan_unreadable"

    plan_path = current_plan.get("plan_path")
    if not isinstance(plan_path, str) or not plan_path.strip():
        return False, "plan_path_missing"

    try:
        resolved_plan_path = resolve_path(plan_path)
        lines = resolved_plan_path.read_text(encoding="utf-8").splitlines()
    except (OSError, ScopeResolutionError):
        return False, "plan_unreadable"

    expected_pass_line = f"- Review pass: `{review_pass_id}`"
    required_lines = {
        "### Accepted",
        "### Ignored for This Story",
    }
    for index, line in enumerate(lines):
        if line.strip() != "## Code Review Findings":
            continue
        end = len(lines)
        for candidate in range(index + 1, len(lines)):
            if lines[candidate].startswith("## "):
                end = candidate
                break
        block = {candidate.strip() for candidate in lines[index:end]}
        if expected_pass_line not in block:
            continue
        if not required_lines.issubset(block):
            return False, "structured_categories_missing"
        if not any(
            candidate.startswith("- Review cycle: `") for candidate in block
        ):
            return False, "review_cycle_metadata_missing"
        if not any(
            candidate.startswith("- Comparison context:") for candidate in block
        ):
            return False, "comparison_context_missing"
        try:
            commit_check = subprocess.run(
                [
                    "git",
                    "status",
                    "--porcelain",
                    "--untracked-files=all",
                    "--",
                    plan_path,
                ],
                cwd=Path.cwd(),
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        except OSError:
            return False, "structured_review_block_commit_unverifiable"
        if commit_check.returncode != 0:
            return False, "structured_review_block_commit_unverifiable"
        if commit_check.stdout.strip():
            return False, "structured_review_block_not_committed"
        return True, "structured_review_block_present"

    return False, "current_pass_review_block_missing"


def check_review_minor_fix_path_clear() -> DecisionOutcome:
    payload, _path, error = _load_review_state()
    if error:
        return yes("review_state_unreadable", error=error)
    if payload.get("needs_minor_fix_path") is True:
        block_ready, block_reason = _structured_review_block_status(payload)
        if not block_ready:
            return yes(
                "review_decisions_not_recorded_before_minor_fix",
                block_reason=block_reason,
                **_review_context(payload),
            )
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
    return yes("task_up_path_clear", **_review_context(payload))
