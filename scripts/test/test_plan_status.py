#!/usr/bin/env python3
"""Focused tests for the canonical plan status parser."""

from __future__ import annotations

import tempfile
import textwrap
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import plan_status


class PlanStatusTests(unittest.TestCase):
    def write_plan(self, content: str) -> str:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        plan_path = Path(tmpdir.name) / "0000123-sample-plan.md"
        plan_path.write_text(textwrap.dedent(content).lstrip())
        return str(plan_path)

    def test_ignores_inline_mentions_and_history_notes(self) -> None:
        plan_path = self.write_plan(
            """
            ### Task 1. First

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [ ] Pending

            #### Implementation notes

            - This prose mentions **BLOCKER** but is not a live blocker.
            - **BLOCKING ANSWER** Historical context only.
            - **RESOLVED ISSUE** Also not a live blocker.
            """
        )

        status = plan_status.get_plan_status(plan=plan_path)

        self.assertEqual(status["selected_task"]["number"], 1)
        self.assertFalse(status["selected_task"]["has_live_blocker"])
        self.assertEqual(status["selected_task"]["live_blockers"], [])
        self.assertTrue(status["selected_task"]["has_unchecked_testing"])

    def test_detects_real_live_blocker(self) -> None:
        plan_path = self.write_plan(
            """
            ### Task 1. First

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done

            #### Implementation notes

            - **BLOCKER** This should count.
            """
        )

        status = plan_status.get_plan_status(plan=plan_path)

        self.assertTrue(status["selected_task"]["has_live_blocker"])
        self.assertEqual(len(status["selected_task"]["live_blockers"]), 1)
        self.assertEqual(status["tasks_with_live_blockers"][0]["number"], 1)

    def test_reports_active_todo_and_completion_state(self) -> None:
        plan_path = self.write_plan(
            """
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done

            #### Implementation notes

            - Note.

            ### Task 2. Second

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [x] Done
            2. [ ] Pending

            #### Testing

            1. [ ] Pending

            #### Implementation notes

            - Note.

            ### Task 3. Third

            - Task Status: `__to_do__`

            #### Subtasks

            1. [ ] Pending

            #### Testing

            1. [ ] Pending
            """
        )

        status = plan_status.get_plan_status(plan=plan_path, selector="active")

        self.assertEqual(status["story_id"], "0000123")
        self.assertEqual(status["story_number"], 123)
        self.assertEqual(status["highest_in_progress_task"]["number"], 2)
        self.assertEqual(status["highest_done_or_in_progress_task"]["number"], 2)
        self.assertEqual(status["earliest_todo_task"]["number"], 3)
        self.assertEqual(status["final_task"]["number"], 3)
        self.assertEqual(status["final_task_status"], "__to_do__")
        self.assertFalse(status["all_tasks_done"])
        self.assertFalse(status["story_complete"])
        self.assertTrue(status["selected_task"]["has_unchecked_subtasks"])
        self.assertTrue(status["selected_task"]["has_unchecked_testing"])

    def test_reports_todo_variants_canonically_without_rewriting_plan(self) -> None:
        for raw_status in (
            "__to_do__", "__todo__", "__TO_DO__", "__TODO__", "__To_Do__", "__ToDo__"
        ):
            with self.subTest(status=raw_status):
                plan_path = self.write_plan(
                    f"### Task 1. Pending\n\n- Task Status: `{raw_status}`\n"
                )
                original = Path(plan_path).read_bytes()

                status = plan_status.get_plan_status(plan=plan_path, include_tasks=True)

                self.assertEqual(status["tasks"][0]["status"], "__to_do__")
                self.assertEqual(status["earliest_todo_task"]["number"], 1)
                self.assertEqual(status["earliest_todo_task"]["status"], "__to_do__")
                self.assertEqual(status["final_task_status"], "__to_do__")
                self.assertIsNone(status["selected_task"])
                self.assertFalse(status["all_tasks_done"])
                self.assertFalse(status["story_complete"])
                self.assertEqual(Path(plan_path).read_bytes(), original)

    def test_normalizes_known_status_case_for_selection_and_completion(self) -> None:
        for raw_status, canonical in (
            ("__done__", "__done__"),
            ("__DONE__", "__done__"),
            ("__DoNe__", "__done__"),
            ("__in_progress__", "__in_progress__"),
            ("__IN_PROGRESS__", "__in_progress__"),
            ("__In_Progress__", "__in_progress__"),
        ):
            with self.subTest(status=raw_status):
                plan_path = self.write_plan(
                    f"### Task 1. Known status\n\n- Task Status: `{raw_status}`\n"
                )
                original = Path(plan_path).read_bytes()

                status = plan_status.get_plan_status(plan=plan_path, include_tasks=True)
                active = plan_status.get_plan_status(plan=plan_path, selector="active")

                self.assertEqual(status["tasks"][0]["status"], canonical)
                self.assertEqual(status["selected_task"]["status"], canonical)
                self.assertEqual(status["final_task_status"], canonical)
                self.assertEqual(status["all_tasks_done"], canonical == "__done__")
                self.assertEqual(status["story_complete"], canonical == "__done__")
                if canonical == "__in_progress__":
                    self.assertEqual(active["selected_task"]["status"], canonical)
                else:
                    self.assertIsNone(active["selected_task"])
                self.assertEqual(Path(plan_path).read_bytes(), original)

    def test_earliest_todo_uses_task_numbers_across_mixed_status_variants(self) -> None:
        plan_path = self.write_plan(
            """
            ### Task 9. Later canonical todo
            - Task Status: __to_do__

            ### Task 3. Earliest alias
            - Task Status: `__ToDo__`

            ### Task 7. Later uppercase todo
            - Task Status: __TO_DO__

            ### Task 1. Completed
            - Task Status: `__DONE__`
            """
        )
        original = Path(plan_path).read_bytes()

        status = plan_status.get_plan_status(plan=plan_path, include_tasks=True)

        self.assertEqual(status["earliest_todo_task"]["number"], 3)
        self.assertEqual(status["earliest_todo_task"]["status"], "__to_do__")
        self.assertEqual(status["final_task"]["number"], 9)
        self.assertEqual(status["final_task_status"], "__to_do__")
        self.assertEqual(
            [task["status"] for task in status["tasks"]],
            ["__to_do__", "__to_do__", "__to_do__", "__done__"],
        )
        self.assertEqual(Path(plan_path).read_bytes(), original)

    def test_unknown_statuses_are_not_normalized_into_known_statuses(self) -> None:
        for raw_status in ("__blocked__", "__BLOCKED__", "__ToDo_Later__"):
            with self.subTest(status=raw_status):
                plan_path = self.write_plan(
                    f"### Task 1. Unknown status\n\n- Task Status: `{raw_status}`\n"
                )
                original = Path(plan_path).read_bytes()

                status = plan_status.get_plan_status(plan=plan_path, include_tasks=True)

                self.assertEqual(status["tasks"][0]["status"], raw_status)
                self.assertIsNone(status["selected_task"])
                self.assertIsNone(status["earliest_todo_task"])
                self.assertFalse(status["all_tasks_done"])
                self.assertFalse(status["story_complete"])
                self.assertEqual(Path(plan_path).read_bytes(), original)

    def test_reports_done_tasks_with_incomplete_checklists_as_inconsistent(self) -> None:
        plan_path = self.write_plan(
            """
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done
            2. [ ] Pending

            #### Testing

            1. [x] Done

            #### Implementation notes

            - Note.
            """
        )

        status = plan_status.get_plan_status(plan=plan_path)

        self.assertTrue(status["all_tasks_done"])
        self.assertFalse(status["story_complete"])
        self.assertEqual(len(status["inconsistent_done_tasks"]), 1)
        self.assertEqual(status["inconsistent_done_tasks"][0]["number"], 1)
        self.assertTrue(status["inconsistent_done_tasks"][0]["has_unchecked_subtasks"])


if __name__ == "__main__":
    unittest.main()
