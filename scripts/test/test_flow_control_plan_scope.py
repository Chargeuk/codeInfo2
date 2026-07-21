#!/usr/bin/env python3
"""Focused tests for final plan-scope deterministic flow control."""

from __future__ import annotations

import unittest
from pathlib import Path
import sys
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import plan_scope


class FlowControlPlanScopeTests(unittest.TestCase):
    def test_plan_scope_completion_requires_all_completion_flags(self) -> None:
        with mock.patch.object(
            plan_scope.story_workflow_status,
            "get_story_workflow_status",
            return_value={
                "repair_needed": False,
                "scope_valid": True,
                "all_tasks_done": True,
                "story_complete": True,
                "final_task_status": "__done__",
                "active_review_cycle_status": "completed",
                "review_settlement_complete": True,
            },
        ):
            outcome = plan_scope.check_plan_scope_story_complete()

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "plan_scope_story_complete")

    def test_plan_scope_completion_refuses_when_any_required_flag_is_missing(self) -> None:
        with mock.patch.object(
            plan_scope.story_workflow_status,
            "get_story_workflow_status",
            return_value={
                "repair_needed": False,
                "scope_valid": True,
                "all_tasks_done": False,
                "story_complete": False,
                "final_task_status": "__in_progress__",
                "active_review_cycle_status": "incomplete",
                "review_settlement_complete": False,
            },
        ):
            outcome = plan_scope.check_plan_scope_story_complete()

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "plan_scope_story_incomplete")

    def test_plan_scope_completion_refuses_an_incomplete_review_settlement(self) -> None:
        with mock.patch.object(
            plan_scope.story_workflow_status,
            "get_story_workflow_status",
            return_value={
                "repair_needed": False,
                "scope_valid": True,
                "all_tasks_done": True,
                "story_complete": True,
                "final_task_status": "__done__",
                "active_review_cycle_status": "incomplete",
                "review_settlement_complete": False,
            },
        ):
            outcome = plan_scope.check_plan_scope_story_complete()

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.details["active_review_cycle_status"], "incomplete")


if __name__ == "__main__":
    unittest.main()
