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
        REPO_ROOT / "flows" / "implement_next_plan.json",
        REPO_ROOT / "flows" / "task_and_implement_plan.json",
        REPO_ROOT / "flows" / "improve_task_implement_plan.json",
        REPO_ROOT / "flows" / "review_plan.json",
        REPO_ROOT / "flows" / "ingest_external_review_plan.json",
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
        "Exit Review Loop After Serious Review Work Was Tasked Up",
        "Exit Review Loop When No Further Minor Rerun Is Needed",
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

        self.assertGreater(len(found), 20)
        for node in found:
            question = node["question"]
            if node["label"] == "Exit Task-Up Path After Encoding Review Findings":
                continue
            self.assertIn("scripts/flow_control/", question)
            self.assertIn(self.FRESHNESS_TEXT, question)
            self.assertIn(self.STDOUT_TEXT, question)
            self.assertIn("Do not recompute the answer.", question)


if __name__ == "__main__":
    unittest.main()
