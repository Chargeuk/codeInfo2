#!/usr/bin/env python3
"""Report the current plan Questions-section state."""

from __future__ import annotations

import argparse
import difflib
import json
import re
from pathlib import Path
from typing import Any

from flow_state_utils import ScopeResolutionError, load_plan_scope, read_head_version


QUESTION_HEADING_RE = re.compile(r"^(#{2,6})\s+Questions\s*$", re.IGNORECASE)
GENERIC_HEADING_RE = re.compile(r"^(#{2,6})\s+")
NUMBERED_ITEM_RE = re.compile(r"^\s*\d+\.\s+(.*\S)\s*$")


def normalize_question_text(question: str) -> str:
    return " ".join(question.lower().split())


def compare_questions(
    current_questions: list[str], baseline_questions: list[str]
) -> tuple[list[str], list[str]]:
    unmatched_baseline = [
        (index, question, normalize_question_text(question))
        for index, question in enumerate(baseline_questions)
    ]
    unmatched_current: list[tuple[str, str]] = []

    for question in current_questions:
        normalized = normalize_question_text(question)
        exact_match_index = next(
            (
                index
                for index, (_, _, baseline_normalized) in enumerate(unmatched_baseline)
                if baseline_normalized == normalized
            ),
            None,
        )
        if exact_match_index is not None:
            unmatched_baseline.pop(exact_match_index)
            continue
        unmatched_current.append((question, normalized))

    added_questions: list[str] = []
    edited_questions: list[str] = []
    for question, normalized in unmatched_current:
        best_match_index = None
        best_ratio = 0.0
        for index, (_, _, baseline_normalized) in enumerate(unmatched_baseline):
            ratio = difflib.SequenceMatcher(
                None, normalized, baseline_normalized
            ).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_match_index = index
        if best_match_index is not None and best_ratio >= 0.75:
            unmatched_baseline.pop(best_match_index)
            edited_questions.append(question)
            continue
        added_questions.append(question)

    return added_questions, edited_questions


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
            "edited_existing_questions": [],
            "has_edited_existing_questions": False,
        }

    plan_path = Path(scope["plan_path"])
    repo_root = Path(scope["repo_root"])
    current = extract_questions_section(plan_path.read_text())
    plan_path_for_git = str(plan_path.relative_to(repo_root))
    head_text = read_head_version(repo_root, plan_path_for_git)
    head = extract_questions_section(head_text) if head_text is not None else None
    baseline_questions = head["numbered_questions"] if head is not None else []
    added_numbered_questions, edited_existing_questions = compare_questions(
        current["numbered_questions"], baseline_questions
    )
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
        "edited_existing_questions": edited_existing_questions,
        "has_edited_existing_questions": bool(edited_existing_questions),
    }


def main() -> int:
    args = parse_args()
    output = get_questions_section_status(handoff=args.handoff)
    json.dump(output, fp=__import__("sys").stdout, indent=2)
    __import__("sys").stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
