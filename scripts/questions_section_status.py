#!/usr/bin/env python3
"""Report the current plan Questions-section state."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from flow_state_utils import ScopeResolutionError, load_plan_scope, read_head_version


QUESTION_HEADING_RE = re.compile(r"^(#{2,6})\s+Questions\s*$", re.IGNORECASE)
GENERIC_HEADING_RE = re.compile(r"^(#{2,6})\s+")
NUMBERED_ITEM_RE = re.compile(r"^\s*\d+\.\s+(.*\S)\s*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Report the current plan Questions-section status."
    )
    parser.add_argument(
        "--handoff",
        default="codeInfoStatus/flow-state/current-plan.json",
        help="Path to the current-plan handoff JSON file.",
    )
    return parser.parse_args()


def extract_questions_section(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    section_lines: list[str] = []
    heading_level = None
    for index, line in enumerate(lines):
        heading_match = QUESTION_HEADING_RE.match(line)
        if heading_match:
            heading_level = len(heading_match.group(1))
            for following in lines[index + 1 :]:
                generic_heading = GENERIC_HEADING_RE.match(following)
                if generic_heading and len(generic_heading.group(1)) <= heading_level:
                    break
                section_lines.append(following)
            break

    numbered_questions = []
    for line in section_lines:
        match = NUMBERED_ITEM_RE.match(line)
        if match:
            numbered_questions.append(match.group(1).strip())

    return {
        "questions_section_present": heading_level is not None,
        "section_lines": section_lines,
        "numbered_questions": numbered_questions,
        "has_no_further_questions_line": any(
            line.strip() == "- No Further Questions" for line in section_lines
        ),
    }


def get_questions_section_status(
    *, handoff: str = "codeInfoStatus/flow-state/current-plan.json", repo_root: str | Path | None = None
) -> dict[str, Any]:
    try:
        scope = load_plan_scope(handoff=handoff, repo_root=repo_root)
    except ScopeResolutionError as exc:
        return {
            "handoff_path": handoff,
            "plan_path": None,
            "error": str(exc),
            "questions_section_present": False,
            "has_no_further_questions_line": False,
            "numbered_questions": [],
            "has_real_questions": False,
            "added_numbered_questions": [],
            "has_added_numbered_questions": False,
        }

    plan_path = Path(scope["plan_path"])
    repo_root = Path(scope["repo_root"])
    current = extract_questions_section(plan_path.read_text())
    plan_path_for_git = str(plan_path.relative_to(repo_root))
    head_text = read_head_version(repo_root, plan_path_for_git)
    head = extract_questions_section(head_text) if head_text is not None else None
    baseline_questions = set(head["numbered_questions"]) if head is not None else set()
    added_numbered_questions = [
        question
        for question in current["numbered_questions"]
        if question not in baseline_questions
    ]
    return {
        "handoff_path": scope["handoff_path"],
        "plan_path": scope["plan_path_raw"],
        "error": None,
        "questions_section_present": current["questions_section_present"],
        "has_no_further_questions_line": current["has_no_further_questions_line"],
        "numbered_questions": current["numbered_questions"],
        "has_real_questions": bool(current["numbered_questions"]),
        "added_numbered_questions": added_numbered_questions,
        "has_added_numbered_questions": bool(added_numbered_questions),
    }


def main() -> int:
    args = parse_args()
    output = get_questions_section_status(handoff=args.handoff)
    json.dump(output, fp=__import__("sys").stdout, indent=2)
    __import__("sys").stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
