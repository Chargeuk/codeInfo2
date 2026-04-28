#!/usr/bin/env python3
"""Locate the final minor-fix revalidation task in the current plan."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import plan_status
from flow_state_utils import ScopeResolutionError, load_plan_scope, story_number_from_plan_name


ROLE_MARKER_RE = re.compile(r"Review Task Role:\s*`final_minor_fix_revalidation`")
TITLE_RE = re.compile(
    r"^Re-Validate Story (\d+) After Inline Minor Review Fixes$", re.IGNORECASE
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Locate the current story's final minor-fix revalidation task."
    )
    parser.add_argument(
        "--handoff",
        default="codeInfoStatus/flow-state/current-plan.json",
        help="Path to the current-plan handoff JSON file.",
    )
    return parser.parse_args()


def task_block(lines: list[str], task: dict[str, Any]) -> list[str]:
    start_index = task["start_line"] - 1
    end_index = task["end_line"]
    return lines[start_index:end_index]


def task_matches(task: dict[str, Any], block: list[str], story_number: str) -> bool:
    if any(ROLE_MARKER_RE.search(line) for line in block):
        return True
    title_match = TITLE_RE.match(task["title"])
    if title_match and title_match.group(1) in {story_number, story_number.lstrip("0")}:
        return True
    normalized_title = task["title"].strip().lower()
    return (
        normalized_title.startswith("re-validate story ")
        and "after inline minor review fixes" in normalized_title
    )


def summarise_task(task: dict[str, Any] | None) -> dict[str, Any] | None:
    if task is None:
        return None
    return {
        "number": task["number"],
        "title": task["title"],
        "status": task["status"],
        "start_line": task["start_line"],
        "end_line": task["end_line"],
    }


def get_revalidation_task_status(
    *, handoff: str = "codeInfoStatus/flow-state/current-plan.json", repo_root: str | Path | None = None
) -> dict[str, Any]:
    try:
        scope = load_plan_scope(handoff=handoff, repo_root=repo_root)
    except ScopeResolutionError as exc:
        return {
            "handoff_path": handoff,
            "plan_path": None,
            "story_number": None,
            "error": str(exc),
            "match_found": False,
            "match_count": 0,
            "should_reuse_existing_task": False,
            "should_reopen_task": False,
            "selected_task": None,
            "candidate_tasks": [],
        }

    plan_path = Path(scope["plan_path"])
    lines = plan_path.read_text().splitlines()
    tasks = plan_status.parse_plan(plan_path)
    story_number = story_number_from_plan_name(plan_path.name) or scope["story_number"]
    candidates = [
        task
        for task in tasks
        if task_matches(task, task_block(lines, task), story_number)
    ]
    selected = max(candidates, key=lambda task: task["number"]) if candidates else None
    return {
        "handoff_path": scope["handoff_path"],
        "plan_path": scope["plan_path_raw"],
        "story_number": story_number,
        "error": None,
        "match_found": selected is not None,
        "match_count": len(candidates),
        "should_reuse_existing_task": selected is not None,
        "should_reopen_task": bool(selected and selected["status"] == "__done__"),
        "selected_task": summarise_task(selected),
        "candidate_tasks": [summarise_task(task) for task in candidates],
    }


def main() -> int:
    args = parse_args()
    output = get_revalidation_task_status(handoff=args.handoff)
    json.dump(output, fp=__import__("sys").stdout, indent=2)
    __import__("sys").stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
