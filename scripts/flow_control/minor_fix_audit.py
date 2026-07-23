"""Deterministic per-pass audit state for terminal minor-review outcomes."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any


AUDIT_SCHEMA_VERSION = 1
TERMINAL_STATUSES = {
    "fixed",
    "skipped",
    "blocked",
    "reclassify_task_required",
    "out_of_scope_current_story",
}
PROOF_RESULTS = {"passed", "failed", "not_run"}
REVIEW_PHASES = {"fast", "slow", "standalone"}


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field}_missing")
    return value.strip()


def _normalize_review_sources(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("review_sources_invalid")
    required = (
        "instance_id",
        "flow_name",
        "review_phase",
        "review_name",
        "severity",
    )
    normalized: dict[tuple[Any, ...], dict[str, Any]] = {}
    for source in value:
        if not isinstance(source, dict):
            raise ValueError("review_source_invalid")
        for field in required:
            _required_text(source.get(field), f"review_source_{field}")
        if source.get("review_phase") not in REVIEW_PHASES:
            raise ValueError("review_source_phase_invalid")
        for nullable in ("target_id", "repo_alias"):
            if source.get(nullable) is not None and not isinstance(
                source.get(nullable), str
            ):
                raise ValueError(f"review_source_{nullable}_invalid")
        item = {
            "instance_id": source["instance_id"].strip(),
            "flow_name": source["flow_name"].strip(),
            "review_phase": source["review_phase"],
            "target_id": source.get("target_id"),
            "repo_alias": source.get("repo_alias"),
            "review_name": source["review_name"].strip(),
            "severity": source["severity"].strip(),
        }
        key = tuple(item[field] for field in item)
        normalized[key] = item
    return sorted(
        normalized.values(),
        key=lambda source: (
            source["review_name"],
            source.get("repo_alias") or "",
            source["instance_id"],
            source["severity"],
        ),
    )


def _normalize_changed_files(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("changed_files_invalid")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError("changed_files_entry_invalid")
    files = {item.strip() for item in value}
    return sorted(files)


def _normalize_targeted_proof(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("targeted_proof_invalid")
    normalized: dict[tuple[str | None, str], dict[str, Any]] = {}
    for proof in value:
        if not isinstance(proof, dict):
            raise ValueError("targeted_proof_entry_invalid")
        command = proof.get("command")
        if command is not None:
            command = _required_text(command, "targeted_proof_command")
        result = proof.get("result")
        if result not in PROOF_RESULTS:
            raise ValueError("targeted_proof_result_invalid")
        notes = proof.get("notes")
        if not isinstance(notes, str):
            raise ValueError("targeted_proof_notes_invalid")
        normalized[(command, result)] = {
            "command": command,
            "result": result,
            "notes": notes.strip(),
        }
    return list(normalized.values())


def _finding_sources(state: dict[str, Any], finding_id: str | None) -> list[dict[str, Any]]:
    if finding_id is None:
        return []
    for bucket in (
        "unresolved_minor_batchable_findings",
        "unresolved_task_required_findings",
        "resolved_minor_findings",
        "operationally_blocked_minor_findings",
        "rejected_or_non_actionable_findings",
    ):
        entries = state.get(bucket, [])
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, dict) and entry.get("id") == finding_id:
                return _normalize_review_sources(entry.get("review_sources", []))
    return []


def _recompute_pass(audit: dict[str, Any], state: dict[str, Any]) -> None:
    attempts = audit["attempts"]
    audit["repositories"] = sorted(
        {
            attempt["repository"]
            for attempt in attempts
            if isinstance(attempt.get("repository"), str)
            and attempt["repository"].strip()
        }
    )
    audit["fixed_finding_ids"] = sorted(
        {
            attempt["finding_id"]
            for attempt in attempts
            if attempt["status"] == "fixed" and attempt["finding_id"] is not None
        }
    )
    audit["escalated_finding_ids"] = sorted(
        {
            attempt["finding_id"]
            for attempt in attempts
            if attempt.get("escalated_to_task") is True
            and attempt["finding_id"] is not None
        }
    )
    executed: dict[tuple[str, str], dict[str, Any]] = {}
    for attempt in attempts:
        repository = attempt.get("repository")
        if not isinstance(repository, str) or not repository.strip():
            continue
        for proof in attempt["targeted_proof"]:
            command = proof.get("command")
            if not isinstance(command, str) or proof["result"] == "not_run":
                continue
            executed[(repository, command)] = {
                "repository": repository,
                "command": command,
                "result": proof["result"],
                "notes": proof["notes"],
            }
    audit["executed_tests"] = sorted(
        executed.values(), key=lambda proof: (proof["repository"], proof["command"])
    )


def sync_minor_fix_audit(
    state: dict[str, Any], result: dict[str, Any]
) -> dict[str, Any]:
    """Return state with one terminal result synchronized into its pass audit."""

    updated = copy.deepcopy(state)
    cycle_id = _required_text(updated.get("review_cycle_id"), "review_cycle_id")
    pass_id = _required_text(updated.get("review_pass_id"), "review_pass_id")
    if result.get("review_pass_id") != pass_id:
        raise ValueError("review_pass_id_mismatch")
    if str(result.get("story_number")) != str(updated.get("story_number")):
        raise ValueError("story_number_mismatch")
    if result.get("plan_path") != updated.get("plan_path"):
        raise ValueError("plan_path_mismatch")
    status = result.get("status")
    if status not in TERMINAL_STATUSES:
        raise ValueError("terminal_status_invalid")
    phase = updated.get("review_phase", "standalone")
    if phase not in REVIEW_PHASES:
        raise ValueError("review_phase_invalid")

    finding_id = result.get("finding_id")
    if finding_id is not None:
        finding_id = _required_text(finding_id, "finding_id")
    repository = result.get("repository")
    if repository is not None:
        repository = _required_text(repository, "repository")
    summary = _required_text(result.get("summary"), "summary")
    changed_files = _normalize_changed_files(result.get("changed_files"))
    targeted_proof = _normalize_targeted_proof(result.get("targeted_proof"))
    commit_sha = result.get("commit_sha")
    if commit_sha is not None and (
        not isinstance(commit_sha, str)
        or len(commit_sha) != 40
        or not all(char in "0123456789abcdef" for char in commit_sha.lower())
    ):
        raise ValueError("commit_sha_invalid")
    if status == "fixed" and commit_sha is None:
        raise ValueError("fixed_commit_sha_missing")

    reason = next(
        (
            value.strip()
            for value in (
                result.get("reclassification_reason"),
                result.get("blocker"),
            )
            if isinstance(value, str) and value.strip()
        ),
        None,
    )
    attempt = {
        "finding_id": finding_id,
        "repository": repository,
        "summary": summary,
        "status": status,
        "review_sources": _finding_sources(updated, finding_id),
        "changed_files": changed_files,
        "targeted_proof": targeted_proof,
        "commit_sha": commit_sha,
        "reason": reason,
        "escalated_to_task": finding_id
        in {
            entry.get("id")
            for entry in updated.get("unresolved_task_required_findings", [])
            if isinstance(entry, dict)
        }
        and status in {"reclassify_task_required", "skipped"},
    }

    audits = updated.get("minor_fix_pass_audits", [])
    if not isinstance(audits, list):
        raise ValueError("minor_fix_pass_audits_invalid")
    for audit in audits:
        if not isinstance(audit, dict) or audit.get("review_cycle_id") != cycle_id:
            raise ValueError("minor_fix_pass_audit_cross_cycle")
    matching = [audit for audit in audits if audit.get("review_pass_id") == pass_id]
    if len(matching) > 1:
        raise ValueError("minor_fix_pass_audit_duplicate")
    if matching:
        audit = matching[0]
        if audit.get("review_phase") != phase:
            raise ValueError("minor_fix_pass_audit_phase_mismatch")
    else:
        audit = {
            "schema_version": AUDIT_SCHEMA_VERSION,
            "review_cycle_id": cycle_id,
            "review_pass_id": pass_id,
            "review_phase": phase,
            "repositories": [],
            "attempts": [],
            "fixed_finding_ids": [],
            "escalated_finding_ids": [],
            "executed_tests": [],
        }
        audits.append(audit)
    attempts = audit.get("attempts")
    if not isinstance(attempts, list):
        raise ValueError("minor_fix_pass_attempts_invalid")
    attempt_key = finding_id or f"global:{status}"
    attempts[:] = [
        existing
        for existing in attempts
        if (existing.get("finding_id") or f"global:{existing.get('status')}")
        != attempt_key
    ]
    attempts.append(attempt)
    _recompute_pass(audit, updated)
    updated["minor_fix_audit_schema_version"] = AUDIT_SCHEMA_VERSION
    updated["minor_fix_pass_audits"] = audits
    return updated


def validate_minor_fix_audits(state: dict[str, Any]) -> tuple[bool, str]:
    """Validate audit state while accepting legacy state with no audit fields."""

    has_version = "minor_fix_audit_schema_version" in state
    has_audits = "minor_fix_pass_audits" in state
    if not has_version and not has_audits:
        return True, "legacy_audit_state_absent"
    if state.get("minor_fix_audit_schema_version") != AUDIT_SCHEMA_VERSION:
        return False, "minor_fix_audit_schema_invalid"
    audits = state.get("minor_fix_pass_audits")
    if not isinstance(audits, list):
        return False, "minor_fix_pass_audits_invalid"
    cycle_id = state.get("review_cycle_id")
    pass_ids: set[str] = set()
    try:
        for audit in audits:
            if not isinstance(audit, dict):
                return False, "minor_fix_pass_audit_invalid"
            if audit.get("schema_version") != AUDIT_SCHEMA_VERSION:
                return False, "minor_fix_pass_audit_schema_invalid"
            if audit.get("review_cycle_id") != cycle_id:
                return False, "minor_fix_pass_audit_cross_cycle"
            pass_id = _required_text(audit.get("review_pass_id"), "review_pass_id")
            if pass_id in pass_ids:
                return False, "minor_fix_pass_audit_duplicate"
            pass_ids.add(pass_id)
            if audit.get("review_phase") not in REVIEW_PHASES:
                return False, "minor_fix_pass_audit_phase_invalid"
            attempts = audit.get("attempts")
            if not isinstance(attempts, list):
                return False, "minor_fix_pass_attempts_invalid"
            keys: set[str] = set()
            for attempt in attempts:
                if not isinstance(attempt, dict):
                    return False, "minor_fix_pass_attempt_invalid"
                status = attempt.get("status")
                if status not in TERMINAL_STATUSES:
                    return False, "minor_fix_pass_attempt_status_invalid"
                if not isinstance(attempt.get("escalated_to_task"), bool):
                    return False, "minor_fix_pass_attempt_escalation_invalid"
                finding_id = attempt.get("finding_id")
                key = finding_id or f"global:{status}"
                if key in keys:
                    return False, "minor_fix_pass_attempt_duplicate"
                keys.add(key)
                _normalize_changed_files(attempt.get("changed_files"))
                _normalize_targeted_proof(attempt.get("targeted_proof"))
                _normalize_review_sources(attempt.get("review_sources", []))
            expected = copy.deepcopy(audit)
            _recompute_pass(expected, state)
            for field in (
                "repositories",
                "fixed_finding_ids",
                "escalated_finding_ids",
                "executed_tests",
            ):
                if audit.get(field) != expected.get(field):
                    return False, f"minor_fix_pass_{field}_invalid"
    except ValueError as exc:
        return False, str(exc)
    return True, "minor_fix_pass_audits_valid"


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")
    temporary.replace(path)
