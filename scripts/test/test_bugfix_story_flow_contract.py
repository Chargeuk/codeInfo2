#!/usr/bin/env python3
"""Structural contracts for the Jira bugfix-story flow and prompts."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
FLOW_PATH = REPO_ROOT / "flows" / "implement_bugfix_story.json"
MARKDOWN_ROOT = REPO_ROOT / "codeinfo_markdown"


def walk(node: Any):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value)


class BugfixStoryFlowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.flow = json.loads(FLOW_PATH.read_text(encoding="utf-8"))
        cls.nodes = list(walk(cls.flow))

    def test_flow_has_expected_one_subtask_order(self) -> None:
        outer = self.flow["steps"][0]
        self.assertEqual(outer["type"], "startLoop")
        self.assertEqual(outer["label"], "Poll Jira Bugfix Story Forever")
        drain = outer["steps"][0]
        self.assertEqual(drain["type"], "startLoop")
        self.assertEqual(drain["label"], "Drain Jira Bugfix Story Subtasks")
        labels = [step["label"] for step in drain["steps"]]
        expected = [
            "Exit When No Unassigned To Do Bugfix Subtask Remains",
            "Re-ingest Working Repository Before Next Subtask",
            "Reset Bugfix Worker Before Next Subtask",
            "Claim Selected Jira Bugfix Subtask",
            "Gather Jira Bugfix Information And Attachments",
            "Create One-Shot Jira Bugfix Plan",
            "Implement And Test Jira Bugfix Plan",
            "Optional Stronger Jira Bugfix Repair",
            "Prove Or Assess Final Bugfix Components",
            "Optional Frontend Screenshot Proof",
            "Commit And Attempt Jira Bugfix Push",
            "Publish Jira Bugfix Result And Screenshots",
            "Close Completed Jira Bugfix Subtask",
            "Exit When Current Jira Bugfix Remains Blocked",
            "Wait Before Selecting Next Jira Bugfix Subtask",
        ]
        self.assertEqual(labels, expected)

    def test_gate_uses_fresh_authoritative_wrapper_contract(self) -> None:
        gate = self.flow["steps"][0]["steps"][0]["steps"][0]
        question = gate["question"]
        self.assertIn(
            "scripts/flow_control/check_bugfix_story_subtasks_empty.py",
            question,
        )
        self.assertIn(
            "Do not rely on any previous command output, prior run, "
            "cached result, or conversational memory",
            question,
        )
        self.assertIn(
            "Return its current stdout exactly and nothing else.",
            question,
        )
        self.assertIn("Do not recompute the answer.", question)
        self.assertTrue(gate["breakOnFailure"])

    def test_every_llm_step_is_best_effort(self) -> None:
        llm_steps = [
            node for node in self.nodes if node.get("type") == "llm"
        ]
        self.assertEqual(len(llm_steps), 10)
        for step in llm_steps:
            self.assertTrue(
                step.get("continueOnFailure"),
                step["label"],
            )

    def test_stronger_repair_can_run_only_once(self) -> None:
        loops = [
            node
            for node in self.nodes
            if node.get("label")
            == "Optional Stronger Jira Bugfix Repair"
        ]
        self.assertEqual(len(loops), 1)
        self.assertEqual(loops[0]["maxIterations"], 1)
        research_steps = [
            node
            for node in walk(loops[0])
            if node.get("type") == "llm"
            and node.get("agentType") == "research_agent"
        ]
        self.assertEqual(len(research_steps), 1)
        skip_gate = loops[0]["steps"][0]["question"]
        self.assertIn("single stronger repair attempt was already consumed", skip_gate)
        repair_text = (
            MARKDOWN_ROOT / "repair_bugfix_subtask.md"
        ).read_text(encoding="utf-8")
        self.assertIn("## Stronger repair attempt", repair_text)

    def test_all_referenced_markdown_contracts_exist(self) -> None:
        markdown_files = [
            node["markdownFile"]
            for node in self.nodes
            if node.get("type") == "llm"
        ]
        self.assertEqual(len(markdown_files), len(set(markdown_files)))
        for filename in markdown_files:
            self.assertTrue(
                (MARKDOWN_ROOT / filename).is_file(),
                filename,
            )

    def test_information_contract_downloads_every_attachment_best_effort(
        self,
    ) -> None:
        text = (
            MARKDOWN_ROOT / "gather_bugfix_subtask_information.md"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "codeInfoTmp/bugfixes/<storyId>/<subtaskId>/attachments/",
            text,
        )
        self.assertIn(
            "gt jira issues attachments list <subtask-key>",
            text,
        )
        self.assertIn(
            "gt jira issues attachments get <attachment-id>",
            text,
        )
        for field in ("`id`", "`filename`", "`mimeType`", "`size`"):
            self.assertIn(field, text)
        self.assertIn(
            "Missing fields must not exclude the record or fail the step",
            text,
        )
        self.assertIn("image-viewing capability", text)
        self.assertNotIn("/home/dastapleton/", text)

    def test_all_work_prompts_use_selection_then_durable_binding(
        self,
    ) -> None:
        claim_filename = "claim_bugfix_subtask.md"
        for node in self.nodes:
            filename = node.get("markdownFile")
            if not filename:
                continue
            text = (MARKDOWN_ROOT / filename).read_text(
                encoding="utf-8"
            )
            self.assertIn("AGENTS.md", text, filename)
            if filename == claim_filename:
                self.assertIn(
                    "bind_next_bugfix_subtask.py",
                    text,
                    filename,
                )
                self.assertIn("unassigned", text, filename)
                self.assertIn("To Do", text, filename)
            else:
                self.assertIn(
                    "get_bound_bugfix_subtask.py",
                    text,
                    filename,
                )
                self.assertNotIn(
                    "get_next_bugfix_subtask.py",
                    text,
                    filename,
                )

    def test_flow_controls_never_reselect_bound_work(self) -> None:
        stronger_gate = next(
            node
            for node in self.nodes
            if node.get("label")
            == "Skip Stronger Bugfix Repair When Unneeded Or Already Attempted"
        )
        blocker_gate = next(
            node
            for node in self.nodes
            if node.get("label")
            == "Exit When Current Jira Bugfix Remains Blocked"
        )
        for gate in (stronger_gate, blocker_gate):
            question = gate["question"]
            self.assertIn("get_bound_bugfix_subtask.py", question)
            self.assertIn("Never run the next-work selector", question)

    def test_commit_and_completion_require_remote_evidence(self) -> None:
        commit_text = (
            MARKDOWN_ROOT / "commit_push_bugfix_subtask.md"
        ).read_text(encoding="utf-8")
        complete_text = (
            MARKDOWN_ROOT / "complete_bugfix_subtask.md"
        ).read_text(encoding="utf-8")
        self.assertIn("Attempt one push", commit_text)
        self.assertIn("remote/upstream contains", complete_text)
        self.assertIn(
            "--status Closed --resolution Resolved",
            complete_text,
        )
        self.assertIn(
            "A local commit with a failed push is not sufficient",
            complete_text,
        )
        self.assertIn(
            "do not make a second push attempt",
            commit_text,
        )
        self.assertIn(
            "Never run the next-work selector or adopt a different issue",
            complete_text,
        )

    def test_dev_only_verification_is_narrow_and_non_blocking(self) -> None:
        flow_text = FLOW_PATH.read_text(encoding="utf-8")
        runtime_text = (
            MARKDOWN_ROOT / "prove_bugfix_subtask_runtime.md"
        ).read_text(encoding="utf-8")
        screenshot_text = (
            MARKDOWN_ROOT / "capture_bugfix_frontend_screenshot_proof.md"
        ).read_text(encoding="utf-8")
        publish_text = (
            MARKDOWN_ROOT / "publish_bugfix_subtask_result.md"
        ).read_text(encoding="utf-8")
        complete_text = (
            MARKDOWN_ROOT / "complete_bugfix_subtask.md"
        ).read_text(encoding="utf-8")

        self.assertIn("only Dev-environment verification remains", flow_text)
        self.assertIn("reasonable best-effort attempt", runtime_text)
        self.assertIn("Dev-only verification condition", screenshot_text)
        self.assertIn("exact verification still required in Dev", publish_text)
        self.assertIn(
            "the absence of that local proof alone must not keep the "
            "subtask In Progress",
            complete_text,
        )
        self.assertIn(
            "Do not accept Dev-only verification merely because local "
            "proof is slow, difficult, inconvenient, transiently failing, "
            "or uncertain.",
            complete_text,
        )


if __name__ == "__main__":
    unittest.main()
