#!/usr/bin/env python3
"""Focused tests for find_minor_fix_revalidation_task.py."""

from __future__ import annotations

import json
import tempfile
import textwrap
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import find_minor_fix_revalidation_task


class FindMinorFixRevalidationTaskTests(unittest.TestCase):
    def make_repo(self, plan_content: str) -> tuple[Path, str]:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        plan_path = repo / "planning" / "0000123-sample-story.md"
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(textwrap.dedent(plan_content).lstrip())
        handoff = repo / "codeInfoStatus" / "flow-state" / "current-plan.json"
        handoff.parent.mkdir(parents=True, exist_ok=True)
        handoff.write_text(
            json.dumps(
                {
                    "plan_path": "planning/0000123-sample-story.md",
                    "additional_repositories": [],
                }
            )
        )
        return repo, str(handoff.relative_to(repo))

    def test_finds_task_by_role_marker(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            """
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertTrue(status["should_reuse_existing_task"])
        self.assertFalse(status["should_reopen_task"])
        self.assertEqual(status["selected_task"]["number"], 4)

    def test_marks_done_task_for_reopen(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 9. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__done__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            """
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertTrue(status["should_reopen_task"])


if __name__ == "__main__":
    unittest.main()
