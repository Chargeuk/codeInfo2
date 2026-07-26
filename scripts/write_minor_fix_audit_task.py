#!/usr/bin/env python3
"""Create or refresh completed per-pass minor-fix audit tasks in a story plan."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import plan_status
from flow_control.minor_fix_audit import validate_minor_fix_audits
from flow_state_utils import ScopeResolutionError, load_json_file, load_plan_scope


ROLE_MARKER = "- Review Task Role: `minor_fix_loop_audit`"
CYCLE_RE = re.compile(r"^- Review Cycle Id: `([^`]+)`$")
PASS_RE = re.compile(r"^- Review Pass Id: `([^`]+)`$")
ADDRESSES_HEADING_RE = re.compile(r"^#{4,6}\s+Addresses Findings\s*$", re.I)
SECTION_HEADING_RE = re.compile(r"^#{4,6}\s+")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--handoff", default="codeInfoStatus/flow-state/current-plan.json"
    )
    parser.add_argument(
        "--review-state",
        default="codeInfoStatus/flow-state/review-disposition-state.json",
    )
    parser.add_argument("--all-passes", action="store_true")
    return parser.parse_args()


def _task_block(lines: list[str], task: dict[str, Any]) -> list[str]:
    return lines[task["start_line"] - 1 : task["end_line"]]


def _audit_identity(block: list[str]) -> tuple[str, str] | None:
    if ROLE_MARKER not in {line.strip() for line in block}:
        return None
    cycle = next(
        (match.group(1) for line in block if (match := CYCLE_RE.match(line.strip()))),
        None,
    )
    review_pass = next(
        (match.group(1) for line in block if (match := PASS_RE.match(line.strip()))),
        None,
    )
    if cycle is None or review_pass is None:
        return None
    return cycle, review_pass


def _task_addresses_findings(block: list[str]) -> set[str]:
    start = next(
        (index for index, line in enumerate(block) if ADDRESSES_HEADING_RE.match(line)),
        None,
    )
    if start is None:
        return set()
    end = len(block)
    for index in range(start + 1, len(block)):
        if SECTION_HEADING_RE.match(block[index]):
            end = index
            break
    return set(re.findall(r"`([^`]+)`", "\n".join(block[start + 1 : end])))


def _coverage_map(
    lines: list[str], tasks: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    coverage: dict[str, list[dict[str, Any]]] = {}
    for task in tasks:
        block = _task_block(lines, task)
        if _audit_identity(block) is not None:
            continue
        for finding_id in _task_addresses_findings(block):
            coverage.setdefault(finding_id, []).append(task)
    return coverage


def _display_sources(sources: Any) -> str:
    if not isinstance(sources, list) or not sources:
        return "No validated review name was recorded."
    counts: dict[str, int] = {}
    for source in sources:
        if isinstance(source, dict) and isinstance(source.get("review_name"), str):
            name = source["review_name"]
            counts[name] = counts.get(name, 0) + 1
    labels: set[str] = set()
    for source in sources:
        if not isinstance(source, dict):
            continue
        name = source.get("review_name")
        if not isinstance(name, str) or not name:
            continue
        label = name
        if counts.get(name, 0) > 1 and source.get("repo_alias"):
            label = f"{name} ({source['repo_alias']})"
        if label in labels and source.get("instance_id"):
            label = f"{label} [{source['instance_id']}]"
        labels.add(label)
    return ", ".join(sorted(labels)) or "No validated review name was recorded."


def _format_files(files: Any) -> str:
    if not isinstance(files, list) or not files:
        return "no changed files recorded"
    return ", ".join(f"`{item}`" for item in files)


def render_audit_task(
    audit: dict[str, Any],
    *,
    task_number: int,
    coverage: dict[str, list[dict[str, Any]]],
) -> str:
    review_pass_id = audit["review_pass_id"]
    lines = [
        f"### Task {task_number}. Record Minor Review Fixes From Pass {review_pass_id}",
        "",
        "- Task Status: `__done__`",
        "",
        "#### Overview",
        "",
        "This completed audit records the terminal inline outcomes for this review pass.",
        "",
        "Escalated review items requiring combined task-up:",
        "",
    ]
    escalated_ids = audit.get("escalated_finding_ids", [])
    attempts_by_id = {
        attempt.get("finding_id"): attempt
        for attempt in audit.get("attempts", [])
        if isinstance(attempt, dict) and attempt.get("finding_id") is not None
    }
    if escalated_ids:
        for finding_id in escalated_ids:
            attempt = attempts_by_id[finding_id]
            covered_by = coverage.get(finding_id, [])
            coverage_text = (
                ", ".join(
                    f"Task {task['number']} ({task['title']})" for task in covered_by
                )
                if covered_by
                else "Pending combined task-up after slow-phase finalization."
            )
            lines.append(
                f"- `{finding_id}` — {attempt['summary']} "
                f"(`{attempt.get('repository') or 'unknown repository'}`). "
                f"Found by: {_display_sources(attempt.get('review_sources'))} "
                f"Task coverage: {coverage_text}"
            )
    else:
        lines.append("- None.")

    lines.extend(["", "#### Subtasks", ""])
    fixed_ids = audit.get("fixed_finding_ids", [])
    if fixed_ids:
        for index, finding_id in enumerate(fixed_ids, start=1):
            attempt = attempts_by_id[finding_id]
            lines.append(
                f"{index}. [x] Fixed `{finding_id}` — {attempt['summary']} "
                f"(`{attempt.get('repository') or 'unknown repository'}`); "
                f"modified {_format_files(attempt.get('changed_files'))}."
            )
    else:
        lines.append("- No findings were fixed inline in this pass.")

    lines.extend(["", "#### Testing", ""])
    executed_tests = audit.get("executed_tests", [])
    if executed_tests:
        for index, proof in enumerate(executed_tests, start=1):
            notes = f" {proof['notes']}" if proof.get("notes") else ""
            lines.append(
                f"{index}. [x] `{proof['command']}` in `{proof['repository']}` — "
                f"{proof['result']}.{notes}".rstrip()
            )
    else:
        lines.append("- No automated tests were executed during this minor-fix pass.")

    lines.extend(
        [
            "",
            "#### Implementation Notes",
            "",
            ROLE_MARKER,
            f"- Review Cycle Id: `{audit['review_cycle_id']}`",
            f"- Review Pass Id: `{review_pass_id}`",
            f"- Review Phase: `{audit['review_phase']}`",
            "- This task is a completed historical audit and does not replace final story revalidation.",
        ]
    )
    return "\n".join(lines)


def upsert_audit_task(plan_path: Path, audit: dict[str, Any]) -> dict[str, Any]:
    lines = plan_path.read_text(encoding="utf-8").splitlines()
    tasks = plan_status.parse_plan(plan_path)
    identity = (audit["review_cycle_id"], audit["review_pass_id"])
    matches = [
        task
        for task in tasks
        if _audit_identity(_task_block(lines, task)) == identity
    ]
    if len(matches) > 1:
        raise ValueError("duplicate_minor_fix_audit_tasks")
    coverage = _coverage_map(lines, tasks)
    if matches:
        task = matches[0]
        task_number = task["number"]
        rendered = render_audit_task(
            audit, task_number=task_number, coverage=coverage
        ).splitlines()
        start = task["start_line"] - 1
        end = task["end_line"]
        updated_lines = lines[:start] + rendered + lines[end:]
        action = "updated"
    else:
        task_number = max((task["number"] for task in tasks), default=0) + 1
        rendered = render_audit_task(
            audit, task_number=task_number, coverage=coverage
        ).splitlines()
        updated_lines = lines + ([""] if lines and lines[-1] else []) + rendered
        action = "created"
    new_text = "\n".join(updated_lines).rstrip() + "\n"
    old_text = "\n".join(lines).rstrip() + "\n"
    if new_text == old_text:
        action = "unchanged"
    else:
        temporary = plan_path.with_suffix(f"{plan_path.suffix}.tmp")
        temporary.write_text(new_text, encoding="utf-8")
        temporary.replace(plan_path)
    return {
        "action": action,
        "task_number": task_number,
        "review_cycle_id": audit["review_cycle_id"],
        "review_pass_id": audit["review_pass_id"],
    }


def main() -> int:
    args = parse_args()
    try:
        scope = load_plan_scope(handoff=args.handoff)
        review_state = load_json_file(Path(scope["repo_root"]) / args.review_state)
    except ScopeResolutionError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        return 1
    valid, reason = validate_minor_fix_audits(review_state)
    if not valid:
        print(json.dumps({"status": "error", "error": reason}))
        return 1
    audits = review_state.get("minor_fix_pass_audits", [])
    if not isinstance(audits, list):
        print(json.dumps({"status": "error", "error": "audit_state_invalid"}))
        return 1
    selected = (
        audits
        if args.all_passes
        else [
            audit
            for audit in audits
            if audit.get("review_pass_id") == review_state.get("review_pass_id")
        ]
    )
    selected = [audit for audit in selected if audit.get("attempts")]
    results = [upsert_audit_task(Path(scope["plan_path"]), audit) for audit in selected]
    print(
        json.dumps(
            {
                "status": "updated" if results else "no_non_empty_pass_audit",
                "audit_tasks": results,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
