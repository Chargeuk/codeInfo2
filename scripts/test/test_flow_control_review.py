#!/usr/bin/env python3
"""Focused tests for review-loop deterministic flow control."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import review


class FlowControlReviewTests(unittest.TestCase):
    REVIEW_PASS_ID = "0000001-20260714T000000Z-decision"

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

    def write_plan_handoff(
        self,
        repo: Path,
        *,
        plan_text: str,
        commit: bool = True,
    ) -> Path:
        plan_path = Path("planning/0000001-review-decisions.md")
        resolved_plan = repo / plan_path
        resolved_plan.parent.mkdir(parents=True, exist_ok=True)
        resolved_plan.write_text(plan_text)
        flow_state = repo / "codeInfoStatus" / "flow-state"
        (flow_state / "current-plan.json").write_text(
            json.dumps({"plan_path": str(plan_path)}, indent=2)
        )

        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        subprocess.run(
            ["git", "config", "user.email", "tests@example.com"],
            cwd=repo,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Flow Tests"], cwd=repo, check=True
        )
        subprocess.run(["git", "add", "."], cwd=repo, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "fixture"], cwd=repo, check=True
        )
        if not commit:
            resolved_plan.write_text(plan_text + "\nUncommitted change.\n")
        return resolved_plan

    def structured_review_block(self) -> str:
        return f"""# Story

## Code Review Findings

- Review pass: `{self.REVIEW_PASS_ID}`
- Review cycle: `0000001-rc-20260714T000000Z-decision`
- Comparison context: local `HEAD` `abc` versus resolved base `origin/main@def`.

### Accepted

#### 1. Example

### Ignored for This Story

- None.
"""

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
                "review_pass_id": self.REVIEW_PASS_ID,
            }
        )
        self.write_plan_handoff(repo, plan_text=self.structured_review_block())

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "minor_fix_path_still_needed")

    def test_minor_fix_path_exits_when_current_pass_block_is_missing(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": True,
                "review_pass_id": self.REVIEW_PASS_ID,
            }
        )
        self.write_plan_handoff(repo, plan_text="# Story\n")

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "review_decisions_not_recorded_before_minor_fix"
        )
        self.assertEqual(
            outcome.details["block_reason"], "current_pass_review_block_missing"
        )

    def test_minor_fix_path_exits_when_current_pass_block_is_incomplete(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": True,
                "review_pass_id": self.REVIEW_PASS_ID,
            }
        )
        self.write_plan_handoff(
            repo,
            plan_text=f"""# Story

## Code Review Findings

- Review pass: `{self.REVIEW_PASS_ID}`
""",
        )

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"], "structured_categories_missing"
        )

    def test_minor_fix_path_exits_when_current_pass_block_is_uncommitted(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": True,
                "review_pass_id": self.REVIEW_PASS_ID,
            }
        )
        self.write_plan_handoff(
            repo, plan_text=self.structured_review_block(), commit=False
        )

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"],
            "structured_review_block_not_committed",
        )

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
