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


class FlowControlPromptContractTests(unittest.TestCase):
    FRESHNESS_TEXT = "Do not rely on any previous command output, prior run, cached result, or conversational memory"
    STDOUT_TEXT = "Return its current stdout exactly and nothing else."

    FLOW_FILES = [
        REPO_ROOT / "flows" / "implement_current_plan.json",
        REPO_ROOT / "flows" / "implement_next_plan.json",
        REPO_ROOT / "flows" / "task_and_implement_plan.json",
        REPO_ROOT / "flows" / "improve_task_implement_plan.json",
        REPO_ROOT / "flows" / "review_plan.json",
        REPO_ROOT / "flows" / "ingest_external_review_plan.json",
        REPO_ROOT / "flows" / "two_phase_review_cycle.json",
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
