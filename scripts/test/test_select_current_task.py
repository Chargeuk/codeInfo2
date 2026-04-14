#!/usr/bin/env python3
"""Focused tests for implementation-loop current task selection."""

from __future__ import annotations

import json
import tempfile
import textwrap
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import select_current_task


class SelectCurrentTaskTests(unittest.TestCase):
    def make_repo(self, plan_content: str) -> tuple[Path, Path, Path]:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        root = Path(tmpdir.name)
        plan_path = root / "planning" / "0000123-sample-plan.md"
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(textwrap.dedent(plan_content).lstrip())
        handoff_path = root / "codeInfoStatus" / "flow-state" / "current-plan.json"
        handoff_path.parent.mkdir(parents=True, exist_ok=True)
        handoff_path.write_text(
            json.dumps({"plan_path": str(plan_path), "additional_repositories": []})
        )
        output_path = handoff_path.parent / "current-task.json"
        return plan_path, handoff_path, output_path

    def invoke_selector(self, handoff_path: Path, output_path: Path) -> dict[str, object]:
        argv = sys.argv
        self.addCleanup(setattr, sys, "argv", argv)
        sys.argv = [
            "select_current_task.py",
            "--handoff",
            str(handoff_path),
            "--output",
            str(output_path),
        ]
        exit_code = select_current_task.main()
        self.assertEqual(exit_code, 0)
        return json.loads(output_path.read_text())

    def test_normalizes_fully_checked_in_progress_task_to_done(self) -> None:
        plan_path, handoff_path, output_path = self.make_repo(
            """
            ### Task 1. First

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done
            """
        )

        payload = self.invoke_selector(handoff_path, output_path)

        self.assertEqual(payload["selection_status"], "story_complete")
        self.assertEqual(payload["selection_reason"], "all_tasks_done")
        self.assertEqual(payload["normalized_tasks"][0]["task_number"], 1)
        self.assertIn("- Task Status: `__done__`", plan_path.read_text())

    def test_writes_repair_state_for_multiple_open_in_progress_tasks(self) -> None:
        _plan_path, handoff_path, output_path = self.make_repo(
            """
            ### Task 1. First

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [ ] Pending

            #### Testing

            1. [ ] Pending

            ### Task 2. Second

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [ ] Pending

            #### Testing

            1. [ ] Pending
            """
        )

        payload = self.invoke_selector(handoff_path, output_path)

        self.assertEqual(payload["selection_status"], "needs_plan_repair")
        self.assertEqual(payload["selection_reason"], "multiple_open_in_progress")
        self.assertEqual([task["number"] for task in payload["open_in_progress_tasks"]], [1, 2])

    def test_promotes_earliest_todo_task_when_no_active_task_exists(self) -> None:
        plan_path, handoff_path, output_path = self.make_repo(
            """
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done

            ### Task 2. Second

            - Task Status: `__to_do__`

            #### Subtasks

            1. [ ] Pending

            #### Testing

            1. [ ] Pending
            """
        )

        payload = self.invoke_selector(handoff_path, output_path)

        self.assertEqual(payload["selection_status"], "resolved")
        self.assertEqual(payload["selection_reason"], "promoted_earliest_todo")
        self.assertEqual(payload["selected_task"]["number"], 2)
        self.assertIn("- Task Status: `__in_progress__`", plan_path.read_text())

    def test_resolves_existing_active_in_progress_task_without_rewrite(self) -> None:
        plan_path, handoff_path, output_path = self.make_repo(
            """
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done

            ### Task 2. Second

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [ ] Pending

            #### Testing

            1. [ ] Pending
            """
        )
        original_plan = plan_path.read_text()

        payload = self.invoke_selector(handoff_path, output_path)

        self.assertEqual(payload["selection_status"], "resolved")
        self.assertEqual(payload["selection_reason"], "active_in_progress")
        self.assertEqual(payload["selected_task"]["number"], 2)
        self.assertEqual(payload["normalized_tasks"], [])
        self.assertEqual(plan_path.read_text(), original_plan)

    def test_does_not_auto_complete_in_progress_task_with_empty_checklists(self) -> None:
        plan_path, handoff_path, output_path = self.make_repo(
            """
            ### Task 1. First

            - Task Status: `__in_progress__`

            #### Subtasks

            #### Testing
            """
        )
        original_plan = plan_path.read_text()

        payload = self.invoke_selector(handoff_path, output_path)

        self.assertEqual(payload["selection_status"], "resolved")
        self.assertEqual(payload["selection_reason"], "active_in_progress")
        self.assertEqual(payload["selected_task"]["number"], 1)
        self.assertEqual(payload["normalized_tasks"], [])
        self.assertEqual(plan_path.read_text(), original_plan)


if __name__ == "__main__":
    unittest.main()
