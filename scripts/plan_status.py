#!/usr/bin/env python3
"""Report canonical story-plan status for the selected task and the whole plan."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


TASK_HEADING_RE = re.compile(r"^### Task (\d+)\.\s*(.*)$")
TASK_STATUS_RE = re.compile(r"^- Task Status:\s*`?(__[a-z_]+__)`?\s*$")
SECTION_HEADING_RE = re.compile(r"^####\s+(.*)$")
CHECKBOX_RE = re.compile(r"^\s*(?:[-*]|\d+\.)\s+\[([ xX])\]\s+")
LIVE_BLOCKER_RE = re.compile(r"^- \*\*BLOCKER\*\*(?:\s|$)")
STORY_NUMBER_RE = re.compile(r"^(\d+)-")
CANONICAL_STORY_ID_RE = re.compile(r"^(\d{7})-")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Report canonical task and blocker status for a story plan. By default, "
            "the plan is loaded from codeInfoStatus/flow-state/current-plan.json."
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
    parser.add_argument(
        "--include-tasks",
        action="store_true",
        help="Include the full per-task status list in the JSON output.",
    )
    return parser.parse_args()


def load_handoff(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SystemExit(f"handoff file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"handoff file is not valid JSON: {path}") from exc


def resolve_plan_path(plan: str | None, handoff: str) -> tuple[Path, Path | None]:
    if plan:
        return Path(plan), None

    handoff_path = Path(handoff)
    handoff_data = load_handoff(handoff_path)
    plan_path_raw = handoff_data.get("plan_path")
    if not isinstance(plan_path_raw, str) or not plan_path_raw:
        raise SystemExit(f"handoff does not contain a valid plan_path: {handoff_path}")

    return Path(plan_path_raw), handoff_path


def normalise_section_name(raw_name: str) -> str | None:
    name = raw_name.strip().lower()
    if name == "subtasks":
        return "subtasks"
    if name == "testing":
        return "testing"
    if name == "implementation notes":
        return "implementation_notes"
    return None


def story_number_from_path(plan_path: Path) -> int | None:
    match = STORY_NUMBER_RE.match(plan_path.name)
    if not match:
        return None
    return int(match.group(1))


def story_id_from_path(plan_path: Path) -> str | None:
    match = CANONICAL_STORY_ID_RE.match(plan_path.name)
    if not match:
        return None
    return match.group(1)


def parse_plan(plan_path: Path) -> list[dict[str, Any]]:
    try:
        lines = plan_path.read_text().splitlines()
    except FileNotFoundError as exc:
        raise SystemExit(f"plan file not found: {plan_path}") from exc

    tasks: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_section: str | None = None

    for line_no, line in enumerate(lines, start=1):
        task_match = TASK_HEADING_RE.match(line)
        if task_match:
            if current is not None:
                current["end_line"] = line_no - 1
                finalise_task(current)
            current = {
                "number": int(task_match.group(1)),
                "title": task_match.group(2).strip(),
                "start_line": line_no,
                "end_line": len(lines),
                "status": None,
                "subtasks_total": 0,
                "subtasks_checked": 0,
                "subtasks_unchecked": 0,
                "testing_total": 0,
                "testing_checked": 0,
                "testing_unchecked": 0,
                "live_blockers": [],
            }
            current_section = None
            tasks.append(current)
            continue

        if current is None:
            continue

        status_match = TASK_STATUS_RE.match(line)
        if status_match:
            current["status"] = status_match.group(1)
            continue

        section_match = SECTION_HEADING_RE.match(line)
        if section_match:
            current_section = normalise_section_name(section_match.group(1))
            continue

        checkbox_match = CHECKBOX_RE.match(line)
        if checkbox_match and current_section in {"subtasks", "testing"}:
            checked = checkbox_match.group(1).lower() == "x"
            total_key = f"{current_section}_total"
            checked_key = f"{current_section}_checked"
            unchecked_key = f"{current_section}_unchecked"
            current[total_key] += 1
            if checked:
                current[checked_key] += 1
            else:
                current[unchecked_key] += 1

        if LIVE_BLOCKER_RE.match(line):
            current["live_blockers"].append(
                {
                    "line": line_no,
                    "text": line,
                }
            )

    if current is not None:
        finalise_task(current)

    return tasks


def finalise_task(task: dict[str, Any]) -> None:
    task["has_unchecked_subtasks"] = task["subtasks_unchecked"] > 0
    task["has_unchecked_testing"] = task["testing_unchecked"] > 0
    task["has_live_blocker"] = bool(task["live_blockers"])


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


def summarise_task(task: dict[str, Any] | None) -> dict[str, Any] | None:
    if task is None:
        return None
    return {
        "number": task["number"],
        "title": task["title"],
        "status": task["status"],
        "start_line": task["start_line"],
        "end_line": task["end_line"],
        "subtasks_total": task["subtasks_total"],
        "subtasks_checked": task["subtasks_checked"],
        "subtasks_unchecked": task["subtasks_unchecked"],
        "has_unchecked_subtasks": task["has_unchecked_subtasks"],
        "testing_total": task["testing_total"],
        "testing_checked": task["testing_checked"],
        "testing_unchecked": task["testing_unchecked"],
        "has_unchecked_testing": task["has_unchecked_testing"],
        "live_blockers": task["live_blockers"],
        "has_live_blocker": task["has_live_blocker"],
    }


def build_output(
    plan_path: Path,
    handoff_path: Path | None,
    selector: str,
    explicit_task_number: int | None,
    include_tasks: bool,
    tasks: list[dict[str, Any]],
    selected_task: dict[str, Any] | None,
) -> dict[str, Any]:
    highest_in_progress = select_task(tasks, "active", None)
    highest_done_or_in_progress = select_task(tasks, "active_or_done", None)
    todo_tasks = [task for task in tasks if task["status"] == "__to_do__"]
    inconsistent_done_tasks = [
        task
        for task in tasks
        if task["status"] == "__done__"
        and (
            task["has_unchecked_subtasks"]
            or task["has_unchecked_testing"]
            or task["has_live_blocker"]
        )
    ]
    earliest_todo = min(todo_tasks, key=lambda task: task["number"]) if todo_tasks else None
    final_task = max(tasks, key=lambda task: task["number"]) if tasks else None
    all_tasks_done = bool(tasks) and all(task["status"] == "__done__" for task in tasks)
    story_complete = (
        all_tasks_done
        and not any(task["has_unchecked_subtasks"] for task in tasks)
        and not any(task["has_unchecked_testing"] for task in tasks)
        and not any(task["has_live_blocker"] for task in tasks)
    )

    return {
        "handoff_path": str(handoff_path) if handoff_path else None,
        "plan_path": str(plan_path),
        "story_id": story_id_from_path(plan_path),
        "story_number": story_number_from_path(plan_path),
        "selector": selector,
        "task_number_arg": explicit_task_number,
        "task_count": len(tasks),
        "tasks": [summarise_task(task) for task in tasks] if include_tasks else None,
        "highest_in_progress_task": summarise_task(highest_in_progress),
        "highest_done_or_in_progress_task": summarise_task(highest_done_or_in_progress),
        "earliest_todo_task": summarise_task(earliest_todo),
        "final_task": summarise_task(final_task),
        "final_task_status": final_task["status"] if final_task else None,
        "all_tasks_done": all_tasks_done,
        "story_complete": story_complete,
        "selected_task": summarise_task(selected_task),
        "tasks_with_live_blockers": [
            summarise_task(task) for task in tasks if task["has_live_blocker"]
        ],
        "inconsistent_done_tasks": [summarise_task(task) for task in inconsistent_done_tasks],
        "tasks_with_unchecked_subtasks": [
            summarise_task(task) for task in tasks if task["has_unchecked_subtasks"]
        ],
        "tasks_with_unchecked_testing": [
            summarise_task(task) for task in tasks if task["has_unchecked_testing"]
        ],
    }


def get_plan_status(
    *,
    plan: str | None = None,
    handoff: str = "codeInfoStatus/flow-state/current-plan.json",
    selector: str = "active_or_done",
    task_number: int | None = None,
    include_tasks: bool = False,
) -> dict[str, Any]:
    plan_path, handoff_path = resolve_plan_path(plan, handoff)
    tasks = parse_plan(plan_path)
    selected_task = select_task(tasks, selector, task_number)
    return build_output(
        plan_path=plan_path,
        handoff_path=handoff_path,
        selector=selector,
        explicit_task_number=task_number,
        include_tasks=include_tasks,
        tasks=tasks,
        selected_task=selected_task,
    )


def main() -> int:
    args = parse_args()
    output = get_plan_status(
        plan=args.plan,
        handoff=args.handoff,
        selector=args.selector,
        task_number=args.task_number,
        include_tasks=args.include_tasks,
    )
    json.dump(output, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
