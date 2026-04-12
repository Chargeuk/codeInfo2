#!/usr/bin/env python3
"""Report live blocker status for the selected task in a story plan."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


TASK_HEADING_RE = re.compile(r"^### Task (\d+)\.\s*(.*)$")
TASK_STATUS_RE = re.compile(r"^- Task Status:\s*`?(__[a-z_]+__)`?\s*$")
LIVE_BLOCKER_RE = re.compile(r"^- \*\*BLOCKER\*\*(?:\s|$)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Report live blocker status for a plan task. By default, the plan is "
            "loaded from codeInfoStatus/flow-state/current-plan.json and the "
            "selected task is the highest task that is __in_progress__ or __done__."
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
        "--selector",
        choices=("active", "active_or_done"),
        default="active_or_done",
        help="How to choose the selected task when --task-number is not provided.",
    )
    parser.add_argument(
        "--task-number",
        type=int,
        help="Select an explicit task number instead of using a selector.",
    )
    return parser.parse_args()


def load_handoff(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SystemExit(f"handoff file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"handoff file is not valid JSON: {path}") from exc


def resolve_plan_path(args: argparse.Namespace) -> tuple[Path, Path | None]:
    if args.plan:
        return Path(args.plan), None

    handoff_path = Path(args.handoff)
    handoff = load_handoff(handoff_path)
    plan_path_raw = handoff.get("plan_path")
    if not isinstance(plan_path_raw, str) or not plan_path_raw:
        raise SystemExit(f"handoff does not contain a valid plan_path: {handoff_path}")

    return Path(plan_path_raw), handoff_path


def parse_plan(plan_path: Path) -> list[dict[str, Any]]:
    try:
        lines = plan_path.read_text().splitlines()
    except FileNotFoundError as exc:
        raise SystemExit(f"plan file not found: {plan_path}") from exc

    tasks: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for line_no, line in enumerate(lines, start=1):
        task_match = TASK_HEADING_RE.match(line)
        if task_match:
            if current is not None:
                current["end_line"] = line_no - 1
            current = {
                "number": int(task_match.group(1)),
                "title": task_match.group(2).strip(),
                "start_line": line_no,
                "end_line": len(lines),
                "status": None,
                "live_blockers": [],
            }
            tasks.append(current)
            continue

        if current is None:
            continue

        status_match = TASK_STATUS_RE.match(line)
        if status_match:
            current["status"] = status_match.group(1)
            continue

        if LIVE_BLOCKER_RE.match(line):
            current["live_blockers"].append(
                {
                    "line": line_no,
                    "text": line,
                }
            )

    return tasks


def select_task(
    tasks: list[dict[str, Any]], selector: str, task_number: int | None
) -> dict[str, Any] | None:
    if task_number is not None:
        for task in tasks:
            if task["number"] == task_number:
                return task
        return None

    if selector == "active":
        candidates = [task for task in tasks if task["status"] == "__in_progress__"]
    else:
        candidates = [
            task
            for task in tasks
            if task["status"] in {"__in_progress__", "__done__"}
        ]

    if not candidates:
        return None

    return max(candidates, key=lambda task: task["number"])


def build_output(
    plan_path: Path,
    handoff_path: Path | None,
    selector: str,
    explicit_task_number: int | None,
    tasks: list[dict[str, Any]],
    selected_task: dict[str, Any] | None,
) -> dict[str, Any]:
    tasks_with_live_blockers = [
        {
            "number": task["number"],
            "status": task["status"],
            "start_line": task["start_line"],
            "live_blockers": task["live_blockers"],
        }
        for task in tasks
        if task["live_blockers"]
    ]

    return {
        "handoff_path": str(handoff_path) if handoff_path else None,
        "plan_path": str(plan_path),
        "selector": selector,
        "task_number_arg": explicit_task_number,
        "task_count": len(tasks),
        "selected_task": selected_task,
        "has_live_blocker": bool(selected_task and selected_task["live_blockers"]),
        "tasks_with_live_blockers": tasks_with_live_blockers,
    }


def main() -> int:
    args = parse_args()
    plan_path, handoff_path = resolve_plan_path(args)
    tasks = parse_plan(plan_path)
    selected_task = select_task(tasks, args.selector, args.task_number)
    output = build_output(
        plan_path=plan_path,
        handoff_path=handoff_path,
        selector=args.selector,
        explicit_task_number=args.task_number,
        tasks=tasks,
        selected_task=selected_task,
    )
    json.dump(output, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
