#!/usr/bin/env python3
"""Focused tests for story-level flow control and migrated prompt contracts."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
import sys
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import story


class FlowControlStoryTests(unittest.TestCase):
    def test_story_complete_requires_valid_scope_and_no_repairs(self) -> None:
        with mock.patch.object(
            story.story_workflow_status,
            "get_story_workflow_status",
            return_value={
                "repair_needed": False,
                "scope_valid": True,
                "story_complete": True,
                "all_tasks_done": True,
                "review_state_repair_needed": False,
            },
        ):
            outcome = story.check_story_complete()

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "story_complete")

    def test_review_loop_exit_requires_clean_status(self) -> None:
        with mock.patch.object(
            story.story_workflow_status,
            "get_story_workflow_status",
            return_value={
                "repair_needed": False,
                "scope_valid": True,
                "story_complete": False,
                "all_tasks_done": False,
                "review_state_repair_needed": False,
                "should_exit_review_loop_to_main_loop": True,
            },
        ):
            outcome = story.check_review_should_exit_to_main_loop()

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "review_loop_should_exit_to_main")

    def test_review_loop_finish_refuses_when_review_state_needs_repair(self) -> None:
        with mock.patch.object(
            story.story_workflow_status,
            "get_story_workflow_status",
            return_value={
                "repair_needed": False,
                "scope_valid": True,
                "story_complete": True,
                "all_tasks_done": True,
                "review_state_repair_needed": True,
                "should_finish_review_loop_cleanly": True,
            },
        ):
            outcome = story.check_review_should_finish_cleanly()

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "review_loop_should_not_finish_cleanly")

    def test_no_findings_closeout_requires_completed_github_review_context(self) -> None:
        with mock.patch.dict(
            story.os.environ,
            {
                "CODEINFO_GITHUB_REVIEW_EXECUTION_ID": "execution-1",
                "CODEINFO_GITHUB_REVIEW_PR_NUMBER": "42",
                "CODEINFO_GITHUB_REVIEW_HANDOFF_PATH": "handoff.json",
            },
            clear=True,
        ), mock.patch.object(
            story,
            "check_review_should_finish_cleanly",
            return_value=story.yes("review_loop_should_finish_cleanly"),
        ):
            outcome = story.check_github_review_should_write_no_findings_closeout()

        self.assertEqual(outcome.answer, "yes")

    def test_no_findings_closeout_refuses_skipped_or_missing_github_review(self) -> None:
        with mock.patch.dict(
            story.os.environ,
            {"CODEINFO_GITHUB_REVIEW_SKIPPED": "1"},
            clear=True,
        ):
            skipped = story.check_github_review_should_write_no_findings_closeout()
        with mock.patch.dict(story.os.environ, {}, clear=True):
            missing = story.check_github_review_should_write_no_findings_closeout()

        self.assertEqual(skipped.answer, "no")
        self.assertEqual(skipped.reason_code, "github_review_was_skipped")
        self.assertEqual(missing.answer, "no")
        self.assertEqual(missing.reason_code, "github_review_context_missing")


class FlowControlPromptContractTests(unittest.TestCase):
    FRESHNESS_TEXT = "Do not rely on any previous command output, prior run, cached result, or conversational memory"
    STDOUT_TEXT = "Return its current stdout exactly and nothing else."

    FLOW_FILES = [
        REPO_ROOT / "flows" / "implement_current_plan.json",
        REPO_ROOT / "flows" / "improve_task_implement_current_plan.json",
        REPO_ROOT / "flows" / "implement_next_plan.json",
        REPO_ROOT / "flows" / "task_and_implement_plan.json",
        REPO_ROOT / "flows" / "improve_task_implement_plan.json",
        REPO_ROOT / "flows" / "review_plan.json",
        REPO_ROOT / "flows" / "ingest_external_review_plan.json",
        REPO_ROOT / "flows" / "two_phase_review_cycle.json",
        REPO_ROOT / "flows" / "review_batch.json",
        REPO_ROOT / "flows" / "review_disposition_current_artifacts.json",
        REPO_ROOT / "flows" / "minor_review_fix_path.json",
        REPO_ROOT / "flows" / "review_task_up_path.json",
    ]

    MIGRATED_LABELS = {
        "Exit if no valid implementation task handoff is available",
        "Proceed to automated proof if implementation is complete",
        "Implementation blocker remains",
        "Exit current task loop if implementation left a blocker",
        "Proceed to manual testing eligibility if automated proof is complete",
        "Return to implementation from proof loop",
        "Automated-proof blocker remains",
        "Exit current task loop if task is blocked after proof",
        "Return to the top of current task rework if proof added unchecked subtasks",
        "Return to the top of current task rework if automated proof still has unchecked testing",
        "Check for blocker after manual testing",
        "Exit task loop if story is complete",
        "Early exit check for completion",
        "Check for completion",
        "Exit Minor-Fix Path Unless Minor Findings Remain",
        "Exit Minor-Fix Path After Sync Unless Another Minor Finding Remains",
        "Exit Task-Up Path Unless Unresolved Findings Need Tasks",
        "Restart Review Pass Unless Issue Decisions Are Ready",
        "Exit Review Loop After Serious Review Work Was Tasked Up",
        "Exit Review Loop When No Further Minor Rerun Is Needed",
        "Exit Fast Review Phase When Converged Or Fifth Pass Was Drained",
        "Retry Review Decisions Against Current Artifacts Unless Ready",
    }

    def _find_nodes(self, node, found):
        if isinstance(node, dict):
            if node.get("label") in self.MIGRATED_LABELS and "question" in node:
                found.append(node)
            for value in node.values():
                self._find_nodes(value, found)
        elif isinstance(node, list):
            for item in node:
                self._find_nodes(item, found)

    def test_migrated_gates_use_wrapper_scripts_and_fresh_execution_contract(self) -> None:
        found = []
        for flow_path in self.FLOW_FILES:
            self._find_nodes(json.loads(flow_path.read_text()), found)

        # These approved gates assess executable work instead of blanket blocker counts.
        assessed_contracts = {
            "Exit current task loop if implementation left a blocker": (
                "no verified independent automated proof, independent manual proof or safe owned cleanup is executable",
                "Answer no when any such independent action remains",
                "Preserve all missing implementation and failed proof",
                "do not bypass genuine prerequisites or mandatory order",
            ),
            "Exit current task loop if task is blocked after proof": (
                "bounded blocker-repair packet",
                "no verified independent required manual proof or owned cleanup can safely run",
                "A blocked automated check alone does not prevent independent manual proof",
                "Answer no when there is no blocker or safe independent manual work remains",
                "Preserve blocked proof and task status",
            ),
            "Return to the top of current task rework if proof added unchecked subtasks": (
                "unchecked implementation subtasks have a safe authorized executable next action",
                "answer no for subtasks blocked by an unchanged external prerequisite",
                "following independent manual proof can proceed",
                "Preserve all unchecked work and blockers",
            ),
            "Return to the top of current task rework if automated proof still has unchecked testing": (
                "latest tester report",
                "unchecked automated proof has a safe executable next action or a materially changed repair to verify",
                "Answer no when the remaining automated checks depend on an unchanged blocker",
                "following independent manual proof and owned cleanup",
                "Never mark those checks complete or rerun unchanged failures",
            ),
        }
        self.assertGreater(len(found), 20)
        for node in found:
            question = node["question"]
            if node["label"] == "Exit Task-Up Path After Encoding Review Findings":
                continue
            if node["label"] in assessed_contracts:
                self.assertNotIn("decisionScript", node)
                self.assertIn("Use fresh persisted", question)
                self.assertIn("plan_status.py", question)
                self.assertIn('Return exactly {"answer":"yes"} or {"answer":"no"}', question)
                self.assertIn("no edits, tests or side effects", question.lower())
                self.assertEqual(node["type"], "break" if "breakOn" in node else "continue")
                self.assertEqual(node.get("breakOn", node.get("continueOn")), "yes")
                for clause in assessed_contracts[node["label"]]:
                    self.assertIn(clause, question)
            else:
                self.assertIn("scripts/flow_control/", question)
                self.assertIn(self.FRESHNESS_TEXT, question)
                self.assertIn(self.STDOUT_TEXT, question)
                self.assertIn("Do not recompute the answer.", question)


class PRReviewPollingContractTests(unittest.TestCase):
    # Static instruction contracts; these do not execute or predict agent decisions.
    def read_contracts(self):
        flow = json.loads((REPO_ROOT / "flows" / "pr_agent_review.json").read_text())
        poll_loop = next(step for step in flow["steps"] if step["type"] == "startLoop")
        question = next(
            step["question"] for step in poll_loop["steps"] if step["type"] == "break"
        )
        prompt = (REPO_ROOT / "codeinfo_markdown" / "poll_pr_agent_review.md").read_text()
        return poll_loop, {
            name: text.replace("`", "").casefold()
            for name, text in {"question": question, "prompt": prompt}.items()
        }

    def test_polling_retains_native_wait_without_a_general_iteration_cap(self):
        poll_loop, _ = self.read_contracts()
        self.assertNotIn("maxIterations", poll_loop)
        self.assertEqual(
            [step["type"] for step in poll_loop["steps"]],
            ["llm", "break", "wait"],
        )
        self.assertEqual(poll_loop["steps"][-1]["seconds"], 300)

    def test_ambiguous_delivery_requires_three_successful_attributable_readbacks(self):
        _, contracts = self.read_contracts()
        for name, contract in contracts.items():
            with self.subTest(contract=name):
                self.assertIn("ambiguous-delivery", contract)
                self.assertIn("three completed successful reconciliation/readback observations", contract)
                self.assertIn("300-second", contract)
                self.assertIn("request/trigger/comment/check/review", contract)
                self.assertIn("exact candidate/reviewer", contract)
                self.assertIn("failed api queries and empty reviewrequests alone do not count", contract)
                self.assertIn("existing assigned work evidence", contract)

    def test_confirmed_delivery_and_observable_siblings_remain_protected(self):
        _, contracts = self.read_contracts()
        for name, contract in contracts.items():
            with self.subTest(contract=name):
                self.assertIn("once delivery/acceptance or provider acknowledgement or pending/running is confirmed", contract)
                self.assertIn("this exception never applies", contract)
                self.assertIn("even if status later becomes unknown", contract)
                self.assertIn("while any sibling remains pending, running or unknown", contract)
                self.assertIn("answer no", contract)
                self.assertIn("never retry the review request", contract)
                self.assertIn("not a terminal review or a clean result", contract)


if __name__ == "__main__":
    unittest.main()
