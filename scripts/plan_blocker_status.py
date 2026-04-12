#!/usr/bin/env python3
"""Compatibility wrapper that exposes blocker-focused output from plan_status.py."""

from __future__ import annotations

import argparse
import json
import sys

import plan_status


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Report live blocker status for a plan task. This wrapper delegates to "
            "scripts/plan_status.py and keeps the older blocker-focused output shape."
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


def main() -> int:
    args = parse_args()
    status = plan_status.get_plan_status(
        plan=args.plan,
        handoff=args.handoff,
        selector=args.selector,
        task_number=args.task_number,
    )
    output = {
        "handoff_path": status["handoff_path"],
        "plan_path": status["plan_path"],
        "selector": status["selector"],
        "task_number_arg": status["task_number_arg"],
        "task_count": status["task_count"],
        "selected_task": status["selected_task"],
        "has_live_blocker": bool(
            status["selected_task"] and status["selected_task"]["live_blockers"]
        ),
        "tasks_with_live_blockers": status["tasks_with_live_blockers"],
    }
    json.dump(output, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
