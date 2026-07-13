#!/usr/bin/env python3
"""Return bounded story-plan sections without exposing the whole plan to an agent."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import plan_status


TASK_HEADING_RE = re.compile(r"^### Task (\d+)\.\s*(.*)$")
TASK_SECTION_RE = re.compile(r"^####\s+(.*)$")
STORY_SECTION_RE = re.compile(r"^#{2,3}\s+(?!Task \d+\.)(.*)$")

PROFILE_CONFIG: dict[str, dict[str, Any]] = {
    "current-task": {"task_sections": "*", "selector": "current"},
    "implementation": {
        "task_sections": [
            "Overview",
            "Non-Goals",
            "Task Exit Criteria",
            "Documentation Locations",
            "Task Design Packet",
            "Subtasks",
            "Implementation Notes",
        ],
        "selector": "current",
    },
    "automated-proof": {
        "task_sections": [
            "Overview",
            "Task Exit Criteria",
            "Subtasks",
            "Testing",
            "Implementation Notes",
        ],
        "selector": "current",
    },
    "manual-proof": {
        "task_sections": [
            "Overview",
            "Non-Goals",
            "Task Exit Criteria",
            "Documentation Locations",
            "Task Design Packet",
            "Subtasks",
            "Manual Testing Guidance",
            "Implementation Notes",
        ],
        "selector": "current",
    },
    "blocker-repair": {
        "task_sections": [
            "Overview",
            "Non-Goals",
            "Task Exit Criteria",
            "Subtasks",
            "Testing",
            "Implementation Notes",
        ],
        "selector": "current",
    },
    "story-scope": {
        "story_sections": [
            "Implementation Plan",
            "Overview",
            "Non-Goals",
            "Acceptance Criteria",
            "Out Of Scope",
            "Additional Repositories",
            "Questions",
            "Design Contract",
            "Story Manual Testing Guidance",
        ],
        "include_task_summaries": True,
    },
    "review-scope": {
        "story_sections": [
            "Implementation Plan",
            "Description",
            "Overview",
            "Non-Goals",
            "Acceptance Criteria",
            "Out Of Scope",
            "Additional Repositories",
            "Decisions",
            "Design Contract",
            "Code Review Findings",
            "Minor Review Fixes",
        ],
        "include_task_summaries": True,
    },
    "review-evidence": {
        "story_sections": [
            "Implementation Plan",
            "Description",
            "Overview",
            "Non-Goals",
            "Acceptance Criteria",
            "Out Of Scope",
            "Additional Repositories",
            "Decisions",
            "Design Contract",
            "Story Manual Testing Guidance",
        ],
        "task_sections": [
            "Overview",
            "Task Exit Criteria",
            "Review Cycle Coverage",
            "Risk Ownership",
            "Affected Repositories",
            "Requirement-To-Proof Mapping",
            "Proof Mapping",
            "Testing",
            "Implementation Notes",
        ],
        "select_final_task": True,
        "include_task_index": True,
    },
    "review-findings": {
        "story_sections": [
            "Implementation Plan",
            "Description",
            "Overview",
            "Non-Goals",
            "Acceptance Criteria",
            "Out Of Scope",
            "Additional Repositories",
            "Decisions",
            "Design Contract",
        ],
        "include_task_index": True,
    },
    "review-tasking": {
        "story_sections": [
            "Description",
            "Overview",
            "Acceptance Criteria",
            "Out Of Scope",
            "Decisions",
        ],
        "task_sections": [
            "Overview",
            "Non-Goals",
            "Task Exit Criteria",
            "Addresses Findings",
            "Risk Ownership",
            "Owner Map",
            "Requirement-To-Proof Mapping",
            "Proof Mapping",
            "Affected Repositories",
            "Documentation Locations",
            "Subtasks",
            "Testing",
            "Manual Testing Guidance",
            "Implementation Notes",
        ],
        "review_created_tasks": True,
    },
    "testing-audit": {
        "task_sections": [
            "Affected Repositories",
            "Testing",
        ],
        "all_tasks": True,
        "include_task_summaries": True,
    },
    "closeout": {
        "story_sections": [
            "Implementation Plan",
            "Code Review Findings",
            "Minor Review Fixes",
            "Final Summary",
        ],
        "include_task_summaries": True,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract only requested task or story sections from the active plan."
    )
    parser.add_argument(
        "--handoff", default="codeInfoStatus/flow-state/current-plan.json"
    )
    parser.add_argument("--plan")
    parser.add_argument(
        "--current-task", default="codeInfoStatus/flow-state/current-task.json"
    )
    parser.add_argument(
        "--review-state",
        default="codeInfoStatus/flow-state/review-disposition-state.json",
    )
    parser.add_argument("--task-number", type=int)
    parser.add_argument(
        "--task", choices=("current", "active", "active_or_done")
    )
    parser.add_argument("--all-tasks", action="store_true")
    parser.add_argument("--review-created-tasks", action="store_true")
    parser.add_argument("--section", action="append", default=[])
    parser.add_argument("--story-section", action="append", default=[])
    parser.add_argument("--include-task-summaries", action="store_true")
    parser.add_argument("--include-task-index", action="store_true")
    parser.add_argument("--profile", choices=tuple(PROFILE_CONFIG))
    return parser.parse_args()


def normalize_heading(value: str) -> str:
    return " ".join(value.strip().lower().split())


def resolve_paths(
    *, plan: str | None, handoff: str, repo_root: str | Path | None
) -> tuple[Path, Path | None, Path]:
    root = Path(repo_root).resolve() if repo_root is not None else Path.cwd().resolve()
    if plan:
        plan_path = Path(plan)
        if not plan_path.is_absolute():
            plan_path = root / plan_path
        return plan_path.resolve(), None, root

    handoff_path = Path(handoff)
    if not handoff_path.is_absolute():
        handoff_path = root / handoff_path
    payload = plan_status.load_handoff(handoff_path)
    plan_value = payload.get("plan_path")
    if not isinstance(plan_value, str) or not plan_value.strip():
        raise SystemExit(f"handoff does not contain a valid plan_path: {handoff_path}")
    plan_path = Path(plan_value)
    if not plan_path.is_absolute():
        plan_path = root / plan_path
    return plan_path.resolve(), handoff_path.resolve(), root


def current_task_number(path: Path) -> int:
    try:
        payload = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SystemExit(f"current-task handoff not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"current-task handoff is not valid JSON: {path}") from exc
    selected = payload.get("selected_task")
    number = selected.get("number") if isinstance(selected, dict) else None
    if not isinstance(number, int):
        raise SystemExit(f"current-task handoff has no selected task number: {path}")
    return number


def section_ranges(
    lines: list[str], *, start: int, end: int, heading_re: re.Pattern[str]
) -> list[dict[str, Any]]:
    headings: list[tuple[int, str]] = []
    for index in range(start - 1, end):
        match = heading_re.match(lines[index])
        if match:
            headings.append((index + 1, match.group(1).strip()))
    results: list[dict[str, Any]] = []
    for offset, (line_no, heading) in enumerate(headings):
        next_line = headings[offset + 1][0] if offset + 1 < len(headings) else end + 1
        results.append(
            {
                "name": heading,
                "start_line": line_no,
                "end_line": next_line - 1,
            }
        )
    return results


def render_range(lines: list[str], start: int, end: int) -> str:
    return "\n".join(lines[start - 1 : end]).rstrip()


def bounded_task_end(lines: list[str], task: dict[str, Any]) -> int:
    start = int(task["start_line"])
    end = int(task["end_line"])
    for line_no in range(start + 1, end + 1):
        if lines[line_no - 1].startswith("## "):
            return line_no - 1
    return end


def task_section_ranges(
    lines: list[str], task: dict[str, Any]
) -> list[dict[str, Any]]:
    return section_ranges(
        lines,
        start=int(task["start_line"]),
        end=bounded_task_end(lines, task),
        heading_re=TASK_SECTION_RE,
    )


def task_sections(
    lines: list[str], task: dict[str, Any], requested: list[str] | str
) -> dict[str, Any]:
    start = int(task["start_line"])
    end = bounded_task_end(lines, task)
    ranges = task_section_ranges(lines, task)
    first_section_line = ranges[0]["start_line"] if ranges else end + 1
    output: dict[str, Any] = {
        "number": task["number"],
        "title": task["title"],
        "status": task["status"],
        "start_line": start,
        "end_line": end,
        "metadata": {
            "start_line": start,
            "end_line": first_section_line - 1,
            "markdown": render_range(lines, start, first_section_line - 1),
        },
        "sections": [],
        "missing_sections": [],
    }
    wanted = None if requested == "*" else {normalize_heading(item) for item in requested}
    found: set[str] = set()
    for item in ranges:
        normalized = normalize_heading(item["name"])
        if wanted is not None and normalized not in wanted:
            continue
        found.add(normalized)
        output["sections"].append(
            {
                **item,
                "markdown": render_range(
                    lines, int(item["start_line"]), int(item["end_line"])
                ),
                "content_complete": True,
            }
        )
    if wanted is not None:
        output["missing_sections"] = [
            item for item in requested if normalize_heading(item) not in found
        ]
    return output


def section_items(lines: list[str], section: dict[str, Any]) -> list[str]:
    items: list[str] = []
    for line in lines[int(section["start_line"]) : int(section["end_line"])]:
        normalized = re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", line).strip()
        if normalized:
            items.append(normalized)
    return items


def task_index_entry(lines: list[str], task: dict[str, Any]) -> dict[str, Any]:
    start = int(task["start_line"])
    end = bounded_task_end(lines, task)
    ranges = task_section_ranges(lines, task)
    first_section = int(ranges[0]["start_line"]) if ranges else end + 1
    metadata: dict[str, str] = {}
    for line in lines[start:first_section - 1]:
        match = re.match(r"^-\s+([^:]+):\s*(.*)$", line)
        if match:
            metadata[normalize_heading(match.group(1))] = match.group(2).strip(" `")
    indexed_sections = {
        normalize_heading(section["name"]): section for section in ranges
    }
    result: dict[str, Any] = {
        "number": task["number"],
        "title": task["title"],
        "status": task["status"],
        "start_line": start,
        "end_line": end,
        "repository_name": metadata.get("repository name"),
        "task_dependencies": metadata.get("task dependencies"),
        "subtasks_unchecked": task.get("subtasks_unchecked"),
        "testing_unchecked": task.get("testing_unchecked"),
        "has_live_blocker": task.get("has_live_blocker"),
        "available_sections": [section["name"] for section in ranges],
    }
    for output_key, section_name in (
        ("affected_repositories", "affected repositories"),
        ("finding_ids", "addresses findings"),
    ):
        section = indexed_sections.get(section_name)
        if section:
            result[output_key] = section_items(lines, section)
    return {key: value for key, value in result.items() if value is not None}


def story_sections(
    lines: list[str], requested: list[str]
) -> tuple[list[dict[str, Any]], list[str]]:
    ranges = section_ranges(
        lines, start=1, end=len(lines), heading_re=STORY_SECTION_RE
    )
    wanted = {normalize_heading(item) for item in requested}
    found: set[str] = set()
    output: list[dict[str, Any]] = []
    for item in ranges:
        normalized = normalize_heading(item["name"])
        if normalized not in wanted:
            continue
        found.add(normalized)
        end = int(item["end_line"])
        for line_no in range(int(item["start_line"]) + 1, end + 1):
            if TASK_HEADING_RE.match(lines[line_no - 1]):
                end = line_no - 1
                break
        output.append(
            {
                **item,
                "end_line": end,
                "markdown": render_range(lines, int(item["start_line"]), end),
                "content_complete": True,
            }
        )
    missing = [item for item in requested if normalize_heading(item) not in found]
    return output, missing


def available_story_sections(lines: list[str]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for item in section_ranges(
        lines, start=1, end=len(lines), heading_re=STORY_SECTION_RE
    ):
        end = int(item["end_line"])
        for line_no in range(int(item["start_line"]) + 1, end + 1):
            if TASK_HEADING_RE.match(lines[line_no - 1]):
                end = line_no - 1
                break
        output.append({**item, "end_line": end})
    return output


def is_review_created_task(
    lines: list[str], task: dict[str, Any]
) -> bool:
    start = int(task["start_line"])
    end = int(task["end_line"])
    return any(
        normalize_heading(match.group(1)) == "addresses findings"
        for line in lines[start - 1 : end]
        if (match := TASK_SECTION_RE.match(line))
    )


def select_review_created_tasks(
    *, lines: list[str], tasks: list[dict[str, Any]], review_state_path: Path
) -> tuple[list[dict[str, Any]], str]:
    payload: dict[str, Any] = {}
    try:
        loaded = json.loads(review_state_path.read_text())
        if isinstance(loaded, dict):
            payload = loaded
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    marker_selectors = [
        payload.get("review_cycle_id"),
        payload.get("review_pass_id"),
    ]
    marker_selectors = [
        item for item in marker_selectors if isinstance(item, str) and item.strip()
    ]
    final_title = payload.get("task_up_owned_final_revalidation_task_title")
    final_index = next(
        (
            index
            for index, task in enumerate(tasks)
            if isinstance(final_title, str) and task.get("title") == final_title
        ),
        None,
    )
    matched_indexes: list[int] = []
    for index, task in enumerate(tasks):
        block = "\n".join(
            lines[int(task["start_line"]) - 1 : int(task["end_line"])]
        )
        if any(selector in block for selector in marker_selectors):
            matched_indexes.append(index)
    if final_index is not None:
        start = min(matched_indexes) if matched_indexes else final_index
        while start > 0 and is_review_created_task(lines, tasks[start - 1]):
            start -= 1
        return tasks[start : final_index + 1], "active_review_state_markers"
    if matched_indexes:
        first = min(matched_indexes)
        last = max(matched_indexes)
        return tasks[first : last + 1], "active_review_state_markers"
    return (
        [task for task in tasks if is_review_created_task(lines, task)],
        "addresses_findings_fallback",
    )


def build_plan_sections(
    *,
    plan: str | None = None,
    handoff: str = "codeInfoStatus/flow-state/current-plan.json",
    current_task: str = "codeInfoStatus/flow-state/current-task.json",
    review_state: str = "codeInfoStatus/flow-state/review-disposition-state.json",
    task_number: int | None = None,
    task_selector: str | None = None,
    all_tasks: bool = False,
    review_created_tasks: bool = False,
    sections: list[str] | None = None,
    requested_story_sections: list[str] | None = None,
    include_task_summaries: bool = False,
    include_task_index: bool = False,
    profile: str | None = None,
    repo_root: str | Path | None = None,
) -> dict[str, Any]:
    config = PROFILE_CONFIG.get(profile, {})
    plan_path, handoff_path, root = resolve_paths(
        plan=plan, handoff=handoff, repo_root=repo_root
    )
    lines = plan_path.read_text().splitlines()
    tasks = plan_status.parse_plan(plan_path)
    requested_sections: list[str] | str = list(sections or [])
    if "task_sections" in config:
        requested_sections = config["task_sections"]
    story_requested = list(requested_story_sections or [])
    story_requested.extend(config.get("story_sections", []))
    all_tasks = all_tasks or bool(config.get("all_tasks"))
    review_created_tasks = review_created_tasks or bool(
        config.get("review_created_tasks")
    )
    include_task_summaries = include_task_summaries or bool(
        config.get("include_task_summaries")
    )
    include_task_index = include_task_index or bool(config.get("include_task_index"))
    selector = task_selector or config.get("selector")
    if selector == "current":
        selector = None
        current_path = Path(current_task)
        if not current_path.is_absolute():
            current_path = root / current_path
        task_number = current_task_number(current_path)

    selected_tasks: list[dict[str, Any]] = []
    review_selection_basis: str | None = None
    if config.get("select_final_task"):
        if not tasks:
            raise SystemExit("final task could not be resolved")
        selected_tasks = [max(tasks, key=lambda task: task["number"])]
    elif all_tasks or review_created_tasks:
        selected_tasks = list(tasks)
        if review_created_tasks:
            review_path = Path(review_state)
            if not review_path.is_absolute():
                review_path = root / review_path
            selected_tasks, review_selection_basis = select_review_created_tasks(
                lines=lines, tasks=tasks, review_state_path=review_path
            )
    elif task_number is not None or selector is not None or requested_sections:
        selected = plan_status.select_task(
            tasks, selector or "active_or_done", task_number
        )
        if selected is None:
            raise SystemExit("requested task could not be resolved")
        selected_tasks = [selected]

    if requested_sections == [] and selected_tasks:
        requested_sections = "*"
    story_output, missing_story = story_sections(lines, story_requested)
    relative_plan = str(plan_path)
    try:
        relative_plan = str(plan_path.relative_to(root))
    except ValueError:
        pass
    output: dict[str, Any] = {
        "plan_path": relative_plan,
        "resolved_plan_path": str(plan_path),
        "story_number": plan_status.story_number_from_path(plan_path),
        "query": {
            "profile": profile,
            "task_number": task_number,
            "task_selector": task_selector,
            "all_tasks": all_tasks,
            "review_created_tasks": review_created_tasks,
            "sections": requested_sections,
            "story_sections": story_requested,
        },
        "story_sections": story_output,
        "available_story_sections": available_story_sections(lines),
        "missing_story_sections": missing_story,
        "tasks": [
            task_sections(lines, task, requested_sections)
            for task in selected_tasks
            if requested_sections
        ],
        "content_complete": True,
    }
    if include_task_summaries:
        output["task_summaries"] = [
            plan_status.summarise_task(task) for task in tasks
        ]
    if include_task_index:
        output["task_index"] = [task_index_entry(lines, task) for task in tasks]
    if review_selection_basis is not None:
        output["review_task_selection_basis"] = review_selection_basis
    if handoff_path is not None:
        output["handoff_path"] = str(handoff_path)
        handoff_payload = plan_status.load_handoff(handoff_path)
        output["repository_scope"] = {
            "additional_repositories": handoff_payload.get(
                "additional_repositories", []
            ),
            "branched_from": handoff_payload.get("branched_from"),
        }
    return output


def main() -> int:
    args = parse_args()
    if not any(
        (
            args.profile,
            args.task,
            args.task_number,
            args.all_tasks,
            args.review_created_tasks,
            args.section,
            args.story_section,
            args.include_task_summaries,
            args.include_task_index,
        )
    ):
        raise SystemExit("at least one bounded query option is required")
    output = build_plan_sections(
        plan=args.plan,
        handoff=args.handoff,
        current_task=args.current_task,
        review_state=args.review_state,
        task_number=args.task_number,
        task_selector=args.task,
        all_tasks=args.all_tasks,
        review_created_tasks=args.review_created_tasks,
        sections=args.section,
        requested_story_sections=args.story_section,
        include_task_summaries=args.include_task_summaries,
        include_task_index=args.include_task_index,
        profile=args.profile,
    )
    json.dump(output, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
