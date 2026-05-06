#!/usr/bin/env python3
"""Resolve the current loop task for implementation flows."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

import plan_status


TASK_HEADING_RE = re.compile(r"^### Task (\d+)\.\s*(.*)$")
TASK_STATUS_RE = re.compile(r"^(- Task Status:\s*`?)(__[a-z_]+__)(`?\s*)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Select the current task for the implementation loop using the stored "
            "current-plan handoff and write a flow-state handoff file."
        )
    )
    parser.add_argument(
        "--handoff",
        default="codeInfoStatus/flow-state/current-plan.json",
        help="Path to the current-plan handoff JSON file.",
    )
    parser.add_argument(
        "--output",
        default="codeInfoStatus/flow-state/current-task.json",
        help="Path to write the current-task handoff JSON file.",
    )
    return parser.parse_args()


def summarise_task(task: dict[str, Any] | None) -> dict[str, Any] | None:
    if task is None:
        return None
    return {
        "number": task["number"],
        "title": task["title"],
        "status": task["status"],
        "start_line": task["start_line"],
        "end_line": task["end_line"],
        "has_unchecked_subtasks": task["has_unchecked_subtasks"],
        "has_unchecked_testing": task["has_unchecked_testing"],
        "has_live_blocker": task["has_live_blocker"],
    }


def load_status(handoff: str) -> dict[str, Any]:
    return plan_status.get_plan_status(
        handoff=handoff,
        selector="active",
        include_tasks=True,
    )


def rewrite_task_statuses(
    *, plan_path: Path, updates: dict[int, str]
) -> list[dict[str, Any]]:
    original = plan_path.read_text()
    lines = original.splitlines()
    current_task_number: int | None = None
    applied: list[dict[str, Any]] = []

    for index, line in enumerate(lines):
        task_match = TASK_HEADING_RE.match(line)
        if task_match:
            current_task_number = int(task_match.group(1))
            continue

        if current_task_number is None or current_task_number not in updates:
            continue

        status_match = TASK_STATUS_RE.match(line)
        if not status_match:
            continue

        from_status = status_match.group(2)
        to_status = updates[current_task_number]
        if from_status == to_status:
            continue

        lines[index] = f"{status_match.group(1)}{to_status}{status_match.group(3)}"
        applied.append(
            {
                "task_number": current_task_number,
                "from_status": from_status,
                "to_status": to_status,
            }
        )

    if applied:
        updated = "\n".join(lines)
        if original.endswith("\n"):
            updated += "\n"
        plan_path.write_text(updated)

    return applied


def find_open_in_progress_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [task for task in tasks if task["status"] == "__in_progress__"]


def find_stale_in_progress_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        task
        for task in tasks
        if task["status"] == "__in_progress__"
        and (task["subtasks_total"] > 0 or task["testing_total"] > 0)
        and not task["has_unchecked_subtasks"]
        and not task["has_unchecked_testing"]
        and not task["has_live_blocker"]
    ]


def render_payload(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2) + "\n"


def write_output(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = render_payload(payload)
    try:
        output_mode = path.stat().st_mode & 0o777
    except FileNotFoundError:
        output_mode = 0o666
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        text=True,
    )
    tmp_path = Path(tmp_name)

    try:
        try:
            handle = os.fdopen(fd, "w", encoding="utf-8")
        except Exception:
            os.close(fd)
            raise

        with handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), output_mode)
        tmp_path.replace(path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def emit_output(payload: dict[str, Any]) -> None:
    sys.stdout.write(render_payload(payload))


def build_payload(
    *,
    status: dict[str, Any],
    selection_status: str,
    selection_reason: str,
    selected_task: dict[str, Any] | None,
    normalized_tasks: list[dict[str, Any]],
    open_in_progress_tasks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "plan_path": status["plan_path"],
        "selection_status": selection_status,
        "selection_reason": selection_reason,
        "selected_task": summarise_task(selected_task),
        "normalized_tasks": normalized_tasks,
        "open_in_progress_tasks": [
            summarise_task(task) for task in (open_in_progress_tasks or [])
        ],
        "final_task_status": status["final_task_status"],
        "story_complete": status["story_complete"],
    }


def main() -> int:
    args = parse_args()
    status = load_status(args.handoff)
    plan_path = Path(status["plan_path"])

    stale_in_progress = find_stale_in_progress_tasks(status["tasks"] or [])
    normalized_tasks: list[dict[str, Any]] = []
    if stale_in_progress:
        normalized_tasks = rewrite_task_statuses(
            plan_path=plan_path,
            updates={task["number"]: "__done__" for task in stale_in_progress},
        )
        status = load_status(args.handoff)

    tasks: list[dict[str, Any]] = status["tasks"] or []
    open_in_progress = find_open_in_progress_tasks(tasks)
    output_path = Path(args.output)
    payload: dict[str, Any]

    if len(open_in_progress) > 1:
        payload = build_payload(
            status=status,
            selection_status="needs_plan_repair",
            selection_reason="multiple_open_in_progress",
            selected_task=None,
            normalized_tasks=normalized_tasks,
            open_in_progress_tasks=open_in_progress,
        )
        write_output(output_path, payload)
        emit_output(payload)
        return 0

    if len(open_in_progress) == 1:
        payload = build_payload(
            status=status,
            selection_status="resolved",
            selection_reason="active_in_progress",
            selected_task=open_in_progress[0],
            normalized_tasks=normalized_tasks,
        )
        write_output(output_path, payload)
        emit_output(payload)
        return 0

    earliest_todo = status["earliest_todo_task"]
    if earliest_todo is not None:
        normalized_tasks.extend(
            rewrite_task_statuses(
                plan_path=plan_path,
                updates={earliest_todo["number"]: "__in_progress__"},
            )
        )
        status = load_status(args.handoff)
        tasks = status["tasks"] or []
        selected_task = next(
            (task for task in tasks if task["number"] == earliest_todo["number"]),
            None,
        )
        payload = build_payload(
            status=status,
            selection_status="resolved",
            selection_reason="promoted_earliest_todo",
            selected_task=selected_task,
            normalized_tasks=normalized_tasks,
        )
        write_output(output_path, payload)
        emit_output(payload)
        return 0

    selection_status = "story_complete" if status["story_complete"] else "needs_plan_repair"
    selection_reason = (
        "all_tasks_done" if status["story_complete"] else "no_open_or_todo_task_found"
    )
    payload = build_payload(
        status=status,
        selection_status=selection_status,
        selection_reason=selection_reason,
        selected_task=None,
        normalized_tasks=normalized_tasks,
        open_in_progress_tasks=open_in_progress,
    )
    write_output(output_path, payload)
    emit_output(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
