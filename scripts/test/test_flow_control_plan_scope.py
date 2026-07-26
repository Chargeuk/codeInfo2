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
    @staticmethod
    def status(**overrides: object) -> dict[str, object]:
        return {
            "scope_valid": True,
            "story_complete": True,
            "final_task_status": "__done__",
            "active_review_cycle_status": "completed",
            "review_settlement_complete": True,
            **overrides,
        }

    def decide(self, **overrides: object):
        with mock.patch.object(
            plan_scope.story_workflow_status,
            "get_story_workflow_status",
            return_value=self.status(**overrides),
        ):
            return plan_scope.check_plan_scope_story_complete()

    def test_clean_agent_native_pass_exits_without_legacy_disposition(self) -> None:
        outcome = self.decide()
        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "plan_scope_story_complete")
        self.assertNotIn("review_state_valid", outcome.details)
        self.assertNotIn("review_cycle_id", outcome.details)

    def test_final_revalidation_task_continues_to_implementation(self) -> None:
        outcome = self.decide(
            story_complete=False,
            final_task_status="__in_progress__",
        )
        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "plan_scope_story_incomplete")

    def test_github_pr_review_support_requires_github_like_upstream_remote(self) -> None:
        with mock.patch.object(
            plan_scope.subprocess,
            "run",
            side_effect=[
                mock.Mock(returncode=0, stdout="origin/feature/0000060-demo\n"),
                mock.Mock(
                    returncode=0,
                    stdout="https://github.com/example/repo.git\n",
                ),
            ],
        ):
            outcome = plan_scope.check_plan_scope_supports_github_pr_review()

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "plan_scope_github_pr_review_supported"
        )

    def test_github_pr_review_support_rejects_non_github_upstream_remote(self) -> None:
        with mock.patch.object(
            plan_scope.subprocess,
            "run",
            side_effect=[
                mock.Mock(returncode=0, stdout="origin/feature/0000060-demo\n"),
                mock.Mock(
                    returncode=0,
                    stdout="https://bitbucket.org/example/repo.git\n",
                ),
            ],
        ):
            outcome = plan_scope.check_plan_scope_supports_github_pr_review()

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(
            outcome.reason_code, "plan_scope_github_pr_review_unsupported"
        )

    def test_unresolved_implementation_tasks_continue_to_implementation(self) -> None:
        outcome = self.decide(
            story_complete=False,
            final_task_status="__to_do__",
        )
        self.assertEqual(outcome.answer, "no")

    def test_incomplete_review_settlement_continues_best_effort(self) -> None:
        outcome = self.decide(
            active_review_cycle_status="incomplete",
            review_settlement_complete=False,
        )
        self.assertEqual(outcome.answer, "no")
        self.assertEqual(
            outcome.details["active_review_cycle_status"],
            "incomplete",
        )

    def test_invalid_story_scope_continues_best_effort(self) -> None:
        outcome = self.decide(scope_valid=False)
        self.assertEqual(outcome.answer, "no")


if __name__ == "__main__":
    unittest.main()
