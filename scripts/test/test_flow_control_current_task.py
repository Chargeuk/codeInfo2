#!/usr/bin/env python3
"""Focused tests for deterministic current-task flow control."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import current_task


class FlowControlCurrentTaskTests(unittest.TestCase):
    def make_repo(
        self,
        *,
        plan_content: str,
        current_task_payload: dict[str, object] | None,
    ) -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        plan_path = repo / "planning" / "0000123-sample-story.md"
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(textwrap.dedent(plan_content).lstrip())

        flow_state = repo / "codeInfoStatus" / "flow-state"
        flow_state.mkdir(parents=True, exist_ok=True)
        (flow_state / "current-plan.json").write_text(
            json.dumps(
                {
                    "plan_path": "planning/0000123-sample-story.md",
                    "additional_repositories": [],
                },
                indent=2,
            )
        )

        if current_task_payload is not None:
            (flow_state / "current-task.json").write_text(
                json.dumps(current_task_payload, indent=2)
            )

        return repo

    def run_in_repo(self, repo: Path, fn):
        original_cwd = Path.cwd()
        self.addCleanup(os.chdir, original_cwd)
        os.chdir(repo)
        return fn()

    def test_stale_current_task_payload_does_not_override_live_plan_status(self) -> None:
        repo = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done

            ### Task 2. Second

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done

            ### Task 3. Third

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done
            """,
            current_task_payload={
                "selection_status": "resolved",
                "selection_reason": "active_in_progress",
                "selected_task": {
                    "number": 3,
                    "status": "__in_progress__",
                    "has_unchecked_subtasks": True,
                    "has_unchecked_testing": True,
                    "has_live_blocker": True,
                },
            },
        )

        implementation = self.run_in_repo(
            repo, current_task.check_current_task_implementation_complete
        )
        blocker = self.run_in_repo(repo, current_task.check_current_task_has_blocker)
        manual_testing = self.run_in_repo(
            repo, current_task.check_current_task_ready_for_manual_testing
        )

        self.assertEqual(implementation.answer, "yes")
        self.assertEqual(implementation.reason_code, "implementation_complete")
        self.assertEqual(blocker.answer, "no")
        self.assertEqual(blocker.reason_code, "no_live_blockers")
        self.assertEqual(manual_testing.answer, "yes")
        self.assertEqual(manual_testing.reason_code, "ready_for_manual_testing")

    def test_missing_current_task_fails_conservatively_per_gate(self) -> None:
        repo = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__in_progress__`
            """,
            current_task_payload=None,
        )

        implementation = self.run_in_repo(
            repo, current_task.check_current_task_implementation_complete
        )
        blocker = self.run_in_repo(repo, current_task.check_current_task_has_blocker)
        unchecked_subtasks = self.run_in_repo(
            repo, current_task.check_current_task_has_unchecked_subtasks
        )

        self.assertEqual(implementation.answer, "no")
        self.assertEqual(implementation.reason_code, "current_task_unreadable")
        self.assertEqual(blocker.answer, "yes")
        self.assertEqual(blocker.reason_code, "current_task_unreadable")
        self.assertEqual(unchecked_subtasks.answer, "no")
        self.assertEqual(unchecked_subtasks.reason_code, "current_task_unreadable")

    def test_unchecked_testing_gate_only_trips_after_subtasks_are_clear(self) -> None:
        repo = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [ ] Pending automated proof
            """,
            current_task_payload={
                "selection_status": "resolved",
                "selection_reason": "active_in_progress",
                "selected_task": {"number": 1},
            },
        )

        implementation = self.run_in_repo(
            repo, current_task.check_current_task_implementation_complete
        )
        unchecked_testing = self.run_in_repo(
            repo, current_task.check_current_task_has_unchecked_testing
        )
        unchecked_subtasks = self.run_in_repo(
            repo, current_task.check_current_task_has_unchecked_subtasks
        )

        self.assertEqual(implementation.answer, "yes")
        self.assertEqual(unchecked_testing.answer, "yes")
        self.assertEqual(unchecked_testing.reason_code, "unchecked_testing_present")
        self.assertEqual(unchecked_subtasks.answer, "no")

    def test_entrypoint_stdout_is_exact_json(self) -> None:
        repo = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done
            """,
            current_task_payload={
                "selection_status": "resolved",
                "selection_reason": "active_in_progress",
                "selected_task": {"number": 1},
            },
        )

        result = subprocess.run(
            [
                "python3",
                str(
                    REPO_ROOT
                    / "scripts"
                    / "flow_control"
                    / "check_current_task_has_blocker.py"
                ),
            ],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.stdout, '{"answer":"no"}\n')
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
