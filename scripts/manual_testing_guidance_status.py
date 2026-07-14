#!/usr/bin/env python3
"""Extract story-level and task-level manual testing guidance from a plan."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from flow_state_utils import (
    ScopeResolutionError,
    canonical_story_id_from_plan_name,
    load_plan_scope,
    story_number_from_plan_name,
)


TASK_HEADING_RE = re.compile(r"^### Task (\d+)\.\s*(.*)$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
ITEM_RE = re.compile(r"^\s*(?:[-*]|\d+\.)\s+(.*\S)\s*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract optional story-level and task-level manual testing guidance "
            "from a story plan."
        )
    )
    parser.add_argument(
        "--handoff",
        default="codeInfoStatus/flow-state/current-plan.json",
        help="Path to the current-plan handoff JSON file.",
    )
    parser.add_argument(
        "--plan",
        help="Direct path to a plan markdown file. Overrides --handoff for plan resolution.",
    )
    parser.add_argument(
        "--task-number",
        type=int,
        help="Extract task-level guidance from the specified task number.",
    )
    return parser.parse_args()


def resolve_plan_path(plan: str | None, handoff: str) -> tuple[str, Path]:
    if plan:
        return plan, Path(plan)
    try:
        scope = load_plan_scope(handoff=handoff)
    except ScopeResolutionError as exc:
        raise SystemExit(str(exc)) from exc
    return scope["plan_path_raw"], Path(scope["plan_path"])


def load_lines(plan_path: Path) -> list[str]:
    try:
        return plan_path.read_text().splitlines()
    except FileNotFoundError as exc:
        raise SystemExit(f"plan file not found: {plan_path}") from exc


def heading_info(line: str) -> tuple[int, str] | None:
    match = HEADING_RE.match(line)
    if match is None:
        return None
    return len(match.group(1)), match.group(2).strip()


def find_tasks_start(lines: list[str]) -> int:
    for idx, line in enumerate(lines):
        info = heading_info(line)
        if info is not None and info[1].lower() == "tasks":
            return idx
    return len(lines)


def section_end(lines: list[str], start_idx: int, level: int, limit: int) -> int:
    idx = start_idx + 1
    while idx < limit:
        info = heading_info(lines[idx])
        if info is not None and info[0] <= level:
            return idx
        idx += 1
    return limit


def collect_items(section_lines: list[str]) -> list[str]:
    items: list[str] = []
    for line in section_lines:
        match = ITEM_RE.match(line)
        if match is not None:
            items.append(match.group(1).strip())
    return items


def empty_guidance(
    *, task_number: int | None = None, lookup_error: str | None = None
) -> dict[str, Any]:
    return {
        "task_number": task_number,
        "present": False,
        "section_name": None,
        "source_kind": None,
        "start_line": None,
        "end_line": None,
        "markdown": "",
        "items": [],
        "lookup_error": lookup_error,
    }


def build_guidance(
    *,
    lines: list[str],
    start_idx: int,
    end_idx: int,
    section_name: str,
    source_kind: str,
    task_number: int | None = None,
) -> dict[str, Any]:
    body_lines = lines[start_idx + 1 : end_idx]
    markdown = "\n".join(body_lines).strip()
    return {
        "task_number": task_number,
        "present": True,
        "section_name": section_name,
        "source_kind": source_kind,
        "start_line": start_idx + 1,
        "end_line": end_idx,
        "markdown": markdown,
        "items": collect_items(body_lines),
        "lookup_error": None,
    }


def find_story_guidance(lines: list[str]) -> dict[str, Any]:
    story_limit = find_tasks_start(lines)

    for idx in range(story_limit):
        info = heading_info(lines[idx])
        if info is None:
            continue
        level, name = info
        if name.lower() == "story manual testing guidance":
            end_idx = section_end(lines, idx, level, story_limit)
            return build_guidance(
                lines=lines,
                start_idx=idx,
                end_idx=end_idx,
                section_name=name,
                source_kind="story",
            )
    return empty_guidance()


def find_task_bounds(lines: list[str], task_number: int) -> tuple[int, int] | None:
    task_start: int | None = None
    for idx, line in enumerate(lines):
        match = TASK_HEADING_RE.match(line)
        if match is None:
            continue
        number = int(match.group(1))
        if number == task_number:
            task_start = idx
            continue
        if task_start is not None and number != task_number:
            return task_start, idx

    if task_start is None:
        return None
    return task_start, len(lines)


def find_task_guidance(lines: list[str], task_number: int | None) -> dict[str, Any]:
    if task_number is None:
        return empty_guidance()

    task_bounds = find_task_bounds(lines, task_number)
    if task_bounds is None:
        return empty_guidance(task_number=task_number, lookup_error="task_not_found")
    task_start, task_end = task_bounds
    for idx in range(task_start + 1, task_end):
        info = heading_info(lines[idx])
        if info is None:
            continue
        level, name = info
        if level == 4 and name.strip().lower() == "manual testing guidance":
            end_idx = section_end(lines, idx, level, task_end)
            return build_guidance(
                lines=lines,
                start_idx=idx,
                end_idx=end_idx,
                section_name=name,
                source_kind="task",
                task_number=task_number,
            )

    return empty_guidance(task_number=task_number)


def build_status(plan_path_raw: str, resolved_plan: Path, task_number: int | None) -> dict[str, Any]:
    resolved_plan = resolved_plan.resolve()
    lines = load_lines(resolved_plan)
    story_number = story_number_from_plan_name(resolved_plan.name)
    story_guidance = find_story_guidance(lines)
    task_guidance = find_task_guidance(lines, task_number)
    return {
        "plan_path": plan_path_raw,
        "resolved_plan_path": str(resolved_plan),
        "story_id": canonical_story_id_from_plan_name(resolved_plan.name),
        "story_number": int(story_number) if story_number is not None else None,
        "requested_task_number": task_number,
        "story_guidance": story_guidance,
        "task_guidance": task_guidance,
    }


def main() -> int:
    args = parse_args()
    plan_path_raw, resolved_plan = resolve_plan_path(args.plan, args.handoff)
    status = build_status(plan_path_raw, resolved_plan, args.task_number)
    json.dump(status, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
