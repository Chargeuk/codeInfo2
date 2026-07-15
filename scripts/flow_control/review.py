"""Review-loop loop-control decisions from review-disposition state."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from flow_control.decision import DecisionOutcome, no, yes
from flow_control.minor_fix_audit import validate_minor_fix_audits
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
    audit_valid, audit_reason = validate_minor_fix_audits(payload)
    if not audit_valid:
        return None, review_state_path, audit_reason
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
        "review_phase": payload.get("review_phase"),
        "fast_review_pass_count": payload.get("fast_review_pass_count"),
        "fast_current_pass_minor_count_before_fix": payload.get(
            "fast_current_pass_minor_count_before_fix"
        ),
        "fast_current_pass_expected_job_count": payload.get(
            "fast_current_pass_expected_job_count"
        ),
        "fast_current_pass_completed_job_count": payload.get(
            "fast_current_pass_completed_job_count"
        ),
        "fast_current_pass_partial_job_count": payload.get(
            "fast_current_pass_partial_job_count"
        ),
        "fast_current_pass_failed_job_count": payload.get(
            "fast_current_pass_failed_job_count"
        ),
        "fast_current_pass_missing_job_count": payload.get(
            "fast_current_pass_missing_job_count"
        ),
        "fast_current_pass_coverage_complete": payload.get(
            "fast_current_pass_coverage_complete"
        ),
        "fast_current_pass_coverage_trusted": payload.get(
            "fast_current_pass_coverage_trusted"
        ),
        "fast_review_coverage_exhausted": payload.get(
            "fast_review_coverage_exhausted"
        ),
        "fast_current_pass_expected_reviewer_count": payload.get(
            "fast_current_pass_expected_reviewer_count"
        ),
        "fast_current_pass_passed_reviewer_count": payload.get(
            "fast_current_pass_passed_reviewer_count"
        ),
        "fast_current_pass_reviewers_complete": payload.get(
            "fast_current_pass_reviewers_complete"
        ),
        "review_pass_id": payload.get("review_pass_id"),
    }


def _structured_review_block_status(
    payload: dict[str, Any],
) -> tuple[bool, str, dict[str, Any]]:
    review_pass_id = payload.get("review_pass_id")
    if not isinstance(review_pass_id, str) or not review_pass_id.strip():
        return False, "review_pass_id_missing", {}

    review_cycle_id = payload.get("review_cycle_id")
    if not isinstance(review_cycle_id, str) or not review_cycle_id.strip():
        return False, "review_cycle_id_missing", {}

    try:
        current_plan = load_json_file(resolve_path(DEFAULT_CURRENT_PLAN))
    except ScopeResolutionError:
        return False, "current_plan_unreadable", {}

    plan_path = current_plan.get("plan_path")
    if not isinstance(plan_path, str) or not plan_path.strip():
        return False, "plan_path_missing", {}

    try:
        resolved_plan_path = resolve_path(plan_path)
        lines = resolved_plan_path.read_text(encoding="utf-8").splitlines()
    except (OSError, ScopeResolutionError):
        return False, "plan_unreadable", {}

    expected_pass_line = f"- Review pass: `{review_pass_id}`"
    matching_blocks: list[list[str]] = []
    for index, line in enumerate(lines):
        if line.strip() != "## Code Review Findings":
            continue
        end = len(lines)
        for candidate in range(index + 1, len(lines)):
            if lines[candidate].startswith("## "):
                end = candidate
                break
        block_lines = lines[index:end]
        if expected_pass_line in {candidate.strip() for candidate in block_lines}:
            matching_blocks.append(block_lines)

    if not matching_blocks:
        return False, "current_pass_review_block_missing", {}
    if len(matching_blocks) != 1:
        return False, "duplicate_current_pass_review_blocks", {}

    block_lines = matching_blocks[0]
    stripped_lines = [candidate.strip() for candidate in block_lines]
    if f"- Review cycle: `{review_cycle_id}`" not in stripped_lines:
        return False, "review_cycle_metadata_mismatch", {}
    comparison_lines = [
        candidate
        for candidate in stripped_lines
        if candidate.startswith("- Comparison context:")
    ]
    if not comparison_lines or any(
        "local `HEAD`" not in candidate or "resolved base" not in candidate
        for candidate in comparison_lines
    ):
        return False, "comparison_context_missing", {}

    accepted_indexes = [
        index
        for index, candidate in enumerate(stripped_lines)
        if candidate == "### Accepted"
    ]
    ignored_indexes = [
        index
        for index, candidate in enumerate(stripped_lines)
        if candidate == "### Ignored for This Story"
    ]
    if len(accepted_indexes) != 1 or len(ignored_indexes) != 1:
        return False, "structured_categories_missing", {}
    accepted_index = accepted_indexes[0]
    ignored_index = ignored_indexes[0]
    if accepted_index >= ignored_index:
        return False, "structured_category_order_invalid", {}

    def parse_category(
        category_lines: list[str],
        *,
        accepted: bool,
    ) -> tuple[bool, str, list[int], list[str]]:
        content = [
            candidate.strip() for candidate in category_lines if candidate.strip()
        ]
        if content == ["- None."]:
            return True, "category_empty", [], []
        if not content or "- None." in content:
            return False, "category_none_marker_invalid", [], []

        heading_pattern = re.compile(r"^####\s+(\d+)\.\s+(.+\S)$")
        heading_indexes = [
            index
            for index, candidate in enumerate(content)
            if heading_pattern.match(candidate)
        ]
        if not heading_indexes or heading_indexes[0] != 0:
            return False, "numbered_issue_title_missing", [], []

        numbers: list[int] = []
        finding_ids: list[str] = []
        id_prefix = (
            "- Finding ID:"
            if accepted
            else "- Finding ID or Review reference:"
        )
        reason_prefix = "- Why accepted:" if accepted else "- Why ignored:"
        required_prefixes = [
            id_prefix,
            "- Found by:",
            "- Description:",
            "- Example:",
            reason_prefix,
        ]
        for position, heading_index in enumerate(heading_indexes):
            match = heading_pattern.match(content[heading_index])
            if match is None:
                return False, "numbered_issue_title_missing", [], []
            numbers.append(int(match.group(1)))
            title = match.group(2).strip()
            if not title or title.startswith("<"):
                return False, "issue_title_missing", [], []
            end = (
                heading_indexes[position + 1]
                if position + 1 < len(heading_indexes)
                else len(content)
            )
            item_lines = content[heading_index + 1 : end]
            values: dict[str, str] = {}
            for prefix in required_prefixes:
                matches = [line for line in item_lines if line.startswith(prefix)]
                if len(matches) != 1:
                    return False, "issue_detail_missing", [], []
                value = matches[0][len(prefix) :].strip().strip("`").strip()
                if not value or value.startswith("<"):
                    return False, "issue_detail_missing", [], []
                values[prefix] = value
            finding_ids.append(values[id_prefix])
        return True, "category_valid", numbers, finding_ids

    accepted_ok, accepted_reason, accepted_numbers, accepted_ids = parse_category(
        block_lines[accepted_index + 1 : ignored_index], accepted=True
    )
    if not accepted_ok:
        return False, f"accepted_{accepted_reason}", {}
    ignored_ok, ignored_reason, ignored_numbers, ignored_ids = parse_category(
        block_lines[ignored_index + 1 :], accepted=False
    )
    if not ignored_ok:
        return False, f"ignored_{ignored_reason}", {}
    all_numbers = [*accepted_numbers, *ignored_numbers]
    if all_numbers != list(range(1, len(all_numbers) + 1)):
        return False, "issue_numbering_invalid", {}

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
        commit_lookup = subprocess.run(
            ["git", "log", "-1", "--format=%H", "--", plan_path],
            cwd=Path.cwd(),
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except OSError:
        return False, "structured_review_block_commit_unverifiable", {}
    if commit_check.returncode != 0 or commit_lookup.returncode != 0:
        return False, "structured_review_block_commit_unverifiable", {}
    if commit_check.stdout.strip():
        return False, "structured_review_block_not_committed", {}
    plan_commit_sha = commit_lookup.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{40}", plan_commit_sha):
        return False, "structured_review_block_commit_unverifiable", {}
    return (
        True,
        "structured_review_block_present",
        {
            "accepted_count": len(accepted_ids),
            "ignored_count": len(ignored_ids),
            "accepted_ids": accepted_ids,
            "ignored_ids": ignored_ids,
            "plan_commit_sha": plan_commit_sha,
        },
    )


def _state_finding_ids(payload: dict[str, Any], key: str) -> tuple[list[str], bool]:
    entries = payload.get(key)
    if not isinstance(entries, list):
        return [], False
    finding_ids: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            return [], False
        finding_id = entry.get("id")
        if not isinstance(finding_id, str) or not finding_id.strip():
            return [], False
        finding_ids.append(finding_id.strip())
    return finding_ids, True


def check_review_decisions_need_retry() -> DecisionOutcome:
    payload, _path, error = _load_review_state()
    if error:
        return yes("review_decision_state_unreadable", error=error)

    review_pass_id = payload.get("review_pass_id")
    review_cycle_id = payload.get("review_cycle_id")
    if not isinstance(review_pass_id, str) or not review_pass_id.strip():
        return yes("review_decision_pass_missing", **_review_context(payload))
    if not isinstance(review_cycle_id, str) or not review_cycle_id.strip():
        return yes("review_decision_cycle_missing", **_review_context(payload))

    recording = payload.get("review_decision_recording")
    if not isinstance(recording, dict):
        return yes("review_decision_recording_missing", **_review_context(payload))
    if recording.get("review_pass_id") != payload.get("review_pass_id"):
        return yes(
            "review_decision_recording_pass_mismatch", **_review_context(payload)
        )

    outcome = recording.get("outcome")
    accepted_count = recording.get("accepted_count")
    ignored_count = recording.get("ignored_count")
    if (
        not isinstance(accepted_count, int)
        or isinstance(accepted_count, bool)
        or accepted_count < 0
        or not isinstance(ignored_count, int)
        or isinstance(ignored_count, bool)
        or ignored_count < 0
    ):
        return yes(
            "review_decision_recording_counts_invalid", **_review_context(payload)
        )

    accepted_ids: list[str] = []
    for key in (
        "unresolved_minor_batchable_findings",
        "unresolved_task_required_findings",
    ):
        ids, valid = _state_finding_ids(payload, key)
        if not valid:
            return yes(
                "review_decision_state_findings_invalid", **_review_context(payload)
            )
        accepted_ids.extend(ids)
    ignored_ids, ignored_valid = _state_finding_ids(
        payload, "rejected_or_non_actionable_findings"
    )
    if not ignored_valid:
        return yes("review_decision_state_findings_invalid", **_review_context(payload))

    if outcome == "no_decisions":
        if (
            accepted_count != 0
            or ignored_count != 0
            or accepted_ids
            or ignored_ids
            or recording.get("plan_commit_sha") is not None
        ):
            return yes(
                "review_no_decisions_conflicts_with_state", **_review_context(payload)
            )
        return no("review_no_decisions_confirmed", **_review_context(payload))
    if outcome != "recorded":
        return yes(
            "review_decision_recording_retry_required", **_review_context(payload)
        )

    resolved_ids: list[str] = []
    if "resolved_minor_findings" in payload:
        resolved_ids, resolved_valid = _state_finding_ids(
            payload, "resolved_minor_findings"
        )
        if not resolved_valid:
            return yes(
                "review_decision_state_findings_invalid", **_review_context(payload)
            )

    block_ready, block_reason, block_details = _structured_review_block_status(payload)
    if not block_ready:
        return yes(
            "review_decisions_not_ready",
            block_reason=block_reason,
            **_review_context(payload),
        )
    if (
        block_details["accepted_count"] != accepted_count
        or block_details["ignored_count"] != ignored_count
    ):
        return yes(
            "review_decision_recording_count_mismatch", **_review_context(payload)
        )
    if (
        len(accepted_ids) != len(set(accepted_ids))
        or len(block_details["accepted_ids"])
        != len(set(block_details["accepted_ids"]))
        or len(resolved_ids) != len(set(resolved_ids))
    ):
        return yes(
            "accepted_review_finding_ids_not_unique", **_review_context(payload)
        )
    accepted_id_set = set(accepted_ids)
    block_accepted_id_set = set(block_details["accepted_ids"])
    allowed_accepted_id_set = accepted_id_set | set(resolved_ids)
    if not accepted_id_set.issubset(
        block_accepted_id_set
    ) or not block_accepted_id_set.issubset(allowed_accepted_id_set):
        return yes(
            "accepted_review_findings_mismatch_with_plan", **_review_context(payload)
        )
    if len(ignored_ids) != len(set(ignored_ids)) or len(
        block_details["ignored_ids"]
    ) != len(set(block_details["ignored_ids"])):
        return yes(
            "ignored_review_finding_ids_not_unique", **_review_context(payload)
        )
    if not set(ignored_ids).issubset(set(block_details["ignored_ids"])):
        return yes(
            "ignored_review_findings_missing_from_plan", **_review_context(payload)
        )
    if recording.get("plan_commit_sha") != block_details["plan_commit_sha"]:
        return yes(
            "review_decision_recording_commit_mismatch", **_review_context(payload)
        )
    return no("review_decisions_ready", **_review_context(payload))


def check_review_minor_fix_path_clear() -> DecisionOutcome:
    payload, _path, error = _load_review_state()
    if error:
        return yes("review_state_unreadable", error=error)
    if payload.get("needs_minor_fix_path") is True:
        block_ready, block_reason, _block_details = _structured_review_block_status(
            payload
        )
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


def check_fast_review_phase_complete() -> DecisionOutcome:
    payload, _path, error = _load_review_state()
    if error:
        return no("fast_review_state_unreadable", error=error)

    if payload.get("review_phase") != "fast":
        return no("fast_review_phase_not_active", **_review_context(payload))

    pass_count = payload.get("fast_review_pass_count")
    entry_minor_count = payload.get("fast_current_pass_minor_count_before_fix")
    reviewed_pass_ids = payload.get("fast_reviewed_pass_ids")
    generic_coverage_fields = (
        "fast_current_pass_expected_job_count",
        "fast_current_pass_completed_job_count",
        "fast_current_pass_partial_job_count",
        "fast_current_pass_failed_job_count",
        "fast_current_pass_missing_job_count",
        "fast_current_pass_coverage_complete",
        "fast_current_pass_coverage_trusted",
    )
    has_generic_coverage = any(field in payload for field in generic_coverage_fields)
    coverage_complete = False
    coverage_valid = True
    if has_generic_coverage:
        expected_job_count = payload.get("fast_current_pass_expected_job_count")
        completed_job_count = payload.get("fast_current_pass_completed_job_count")
        partial_job_count = payload.get("fast_current_pass_partial_job_count")
        failed_job_count = payload.get("fast_current_pass_failed_job_count")
        missing_job_count = payload.get("fast_current_pass_missing_job_count")
        coverage_complete = payload.get("fast_current_pass_coverage_complete")
        coverage_trusted = payload.get("fast_current_pass_coverage_trusted")
        coverage_exhausted = payload.get("fast_review_coverage_exhausted", False)
        count_values = (
            expected_job_count,
            completed_job_count,
            partial_job_count,
            failed_job_count,
            missing_job_count,
        )
        coverage_valid = (
            all(
                isinstance(value, int)
                and not isinstance(value, bool)
                and value >= 0
                for value in count_values
            )
            and isinstance(coverage_complete, bool)
            and isinstance(coverage_trusted, bool)
            and isinstance(coverage_exhausted, bool)
        )
        if coverage_valid and coverage_trusted:
            coverage_valid = (
                expected_job_count >= 1
                and completed_job_count
                + partial_job_count
                + failed_job_count
                + missing_job_count
                == expected_job_count
                and coverage_complete
                == (
                    completed_job_count == expected_job_count
                    and partial_job_count == 0
                    and failed_job_count == 0
                    and missing_job_count == 0
                )
            )
        elif coverage_valid:
            coverage_valid = coverage_complete is False
        if coverage_valid:
            coverage_valid = coverage_exhausted == (
                not coverage_complete and pass_count == 5
            )
    else:
        expected_reviewer_count = payload.get(
            "fast_current_pass_expected_reviewer_count"
        )
        passed_reviewer_count = payload.get(
            "fast_current_pass_passed_reviewer_count"
        )
        reviewers_complete = payload.get("fast_current_pass_reviewers_complete")
        coverage_valid = (
            expected_reviewer_count == 2
            and isinstance(passed_reviewer_count, int)
            and not isinstance(passed_reviewer_count, bool)
            and passed_reviewer_count >= 0
            and passed_reviewer_count <= expected_reviewer_count
            and isinstance(reviewers_complete, bool)
            and reviewers_complete
            == (passed_reviewer_count == expected_reviewer_count)
        )
        coverage_complete = reviewers_complete is True
    if (
        not isinstance(pass_count, int)
        or isinstance(pass_count, bool)
        or pass_count < 1
        or pass_count > 5
        or not isinstance(entry_minor_count, int)
        or isinstance(entry_minor_count, bool)
        or entry_minor_count < 0
        or not isinstance(reviewed_pass_ids, list)
        or len(reviewed_pass_ids) != pass_count
        or any(
            not isinstance(review_pass_id, str) or not review_pass_id.strip()
            for review_pass_id in reviewed_pass_ids
        )
        or len(set(reviewed_pass_ids)) != len(reviewed_pass_ids)
        or not coverage_valid
    ):
        return no("fast_review_counter_state_invalid", **_review_context(payload))

    if payload.get("needs_minor_fix_path") is True:
        return no("fast_review_minor_findings_not_drained", **_review_context(payload))

    if not coverage_complete:
        if pass_count >= 5:
            return yes(
                "fast_review_fifth_pass_coverage_exhausted",
                **_review_context(payload),
            )
        return no(
            "fast_review_requires_complete_job_coverage",
            **_review_context(payload),
        )

    if entry_minor_count == 0:
        return yes(
            "fast_review_converged_without_minor_findings",
            **_review_context(payload),
        )

    if pass_count >= 5:
        return yes("fast_review_fifth_pass_drained", **_review_context(payload))

    return no("fast_review_requires_another_pass", **_review_context(payload))
