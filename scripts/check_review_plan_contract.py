#!/usr/bin/env python3
"""Check that unfinished task work does not invoke the final story review cycle."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


FINAL_REVIEW_PATTERN = re.compile(
    r"(?:two_phase_review_cycle|review:cycle:summary)", re.IGNORECASE
)
TASK_PATTERN = re.compile(r"^### Task (\d+)\.[^\n]*$", re.MULTILINE)
CHECKBOX_PATTERN = re.compile(r"^\s*\d+\. \[ \] (.+)$", re.MULTILINE)


def inspect_plan(plan_text: str) -> dict[str, Any]:
    headings = list(TASK_PATTERN.finditer(plan_text))
    violations: list[dict[str, Any]] = []
    for index, heading in enumerate(headings):
        task_number = int(heading.group(1))
        end = headings[index + 1].start() if index + 1 < len(headings) else len(plan_text)
        task_text = plan_text[heading.start() : end]
        for checkbox in CHECKBOX_PATTERN.finditer(task_text):
            text = checkbox.group(1).strip()
            if FINAL_REVIEW_PATTERN.search(text):
                violations.append(
                    {
                        "task_number": task_number,
                        "text": text,
                        "reason": "unfinished_task_invokes_final_story_review",
                    }
                )
    return {
        "valid": not violations,
        "violations": violations,
        "rule": "final story review may run only after implementation and mandatory proof are complete; use diagnostic reviewer flows for in-task evidence",
    }


def main() -> int:
    repo_root = Path.cwd()
    handoff_path = repo_root / "codeInfoStatus" / "flow-state" / "current-plan.json"
    try:
        handoff = json.loads(handoff_path.read_text(encoding="utf-8"))
        plan_path = handoff["plan_path"]
        if not isinstance(plan_path, str) or not plan_path.strip():
            raise ValueError("plan_path is missing")
        result = inspect_plan((repo_root / plan_path).read_text(encoding="utf-8"))
        result["plan_path"] = plan_path
    except (OSError, KeyError, ValueError, json.JSONDecodeError) as exc:
        result = {
            "valid": False,
            "violations": [],
            "reason": "current_plan_unreadable",
            "error": str(exc),
        }
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
