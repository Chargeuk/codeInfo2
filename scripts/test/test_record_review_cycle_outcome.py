#!/usr/bin/env python3
"""Focused tests for the agent-invoked review-cycle outcome recorder."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_state_utils import ScopeResolutionError
from record_review_cycle_outcome import record_review_cycle_outcome


class RecordReviewCycleOutcomeTests(unittest.TestCase):
    def make_repo(self) -> tuple[Path, Path]:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        plan_path = "planning/0000064-review.md"
        (root / "planning").mkdir()
        (root / plan_path).write_text("# Review\n")
        state_root = root / "codeInfoStatus" / "flow-state"
        state_root.mkdir(parents=True)
        (state_root / "current-plan.json").write_text(
            json.dumps({"plan_path": plan_path})
        )
        active_path = state_root / "active-review-cycle.json"
        active_path.write_text(
            json.dumps(
                {
                    "schema_version": "codeinfo-active-review-cycle/v2",
                    "review_cycle_id": "0000064-rc-20260721T120000Z-aabbccdd",
                    "review_mode": "final",
                    "story_id": "0000064",
                    "plan_path": plan_path,
                    "status": "in_progress",
                    "created_at": "2026-07-21T12:00:00.000Z",
                }
            )
        )
        return root, active_path

    def test_records_completed_without_reading_review_output(self) -> None:
        root, active_path = self.make_repo()

        result = record_review_cycle_outcome(
            repo_root=root,
            status="completed",
            expected_cycle_id="0000064-rc-20260721T120000Z-aabbccdd",
            completed_at=datetime(2026, 7, 21, 12, 5, tzinfo=timezone.utc),
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["completed_at"], "2026-07-21T12:05:00Z")
        self.assertEqual(json.loads(active_path.read_text()), result)

    def test_records_incomplete_with_reason(self) -> None:
        root, _ = self.make_repo()

        result = record_review_cycle_outcome(
            repo_root=root,
            status="incomplete",
            reason="Settlement evidence could not be repaired.",
        )

        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(
            result["incomplete_reason"],
            "Settlement evidence could not be repaired.",
        )

    def test_rejects_stale_cycle_id(self) -> None:
        root, active_path = self.make_repo()
        before = active_path.read_text()

        with self.assertRaisesRegex(ScopeResolutionError, "cycle changed"):
            record_review_cycle_outcome(
                repo_root=root,
                status="completed",
                expected_cycle_id="0000064-rc-20260721T130000Z-deadbeef",
            )

        self.assertEqual(active_path.read_text(), before)

    def test_incomplete_requires_reason(self) -> None:
        root, _ = self.make_repo()

        with self.assertRaisesRegex(ScopeResolutionError, "requires --reason"):
            record_review_cycle_outcome(repo_root=root, status="incomplete")


if __name__ == "__main__":
    unittest.main()
