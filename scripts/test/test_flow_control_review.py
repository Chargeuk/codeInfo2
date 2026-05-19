#!/usr/bin/env python3
"""Focused tests for review-loop deterministic flow control."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import review


class FlowControlReviewTests(unittest.TestCase):
    def make_repo(
        self,
        *,
        review_state: dict[str, object] | None,
        minor_fix_result: dict[str, object] | None = None,
    ) -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        flow_state = repo / "codeInfoStatus" / "flow-state"
        flow_state.mkdir(parents=True, exist_ok=True)

        if review_state is not None:
            (flow_state / "review-disposition-state.json").write_text(
                json.dumps(review_state, indent=2)
            )
        if minor_fix_result is not None:
            (flow_state / "minor-review-fix-result.json").write_text(
                json.dumps(minor_fix_result, indent=2)
            )
        return repo

    def run_in_repo(self, repo: Path, fn):
        original_cwd = Path.cwd()
        self.addCleanup(os.chdir, original_cwd)
        os.chdir(repo)
        return fn()

    def test_missing_review_state_exits_minor_fix_path_conservatively(self) -> None:
        repo = self.make_repo(review_state=None)

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "review_state_unreadable")

    def test_minor_fix_path_continues_when_unresolved_findings_remain(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": False,
            }
        )

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "minor_fix_path_still_needed")

    def test_after_sync_uses_current_review_state_and_keeps_minor_result_as_context(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": False,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": False,
            },
            minor_fix_result={"attempted_finding_id": "minor-1", "outcome": "fixed"},
        )

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear_after_sync)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "minor_fix_path_clear_after_sync")
        self.assertEqual(outcome.details["minor_fix_result"]["outcome"], "fixed")

    def test_task_up_path_continues_only_when_needed(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": False,
                "needs_task_up_path": True,
                "needs_review_rerun_before_close": False,
            }
        )

        outcome = self.run_in_repo(repo, review.check_review_task_up_path_clear)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "task_up_path_still_needed")


if __name__ == "__main__":
    unittest.main()
