#!/usr/bin/env python3
"""Regression tests for review prompt guardrails."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def read_text(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text()


class ReviewPromptContractTests(unittest.TestCase):
    def test_core_findings_prompt_defines_scope_impact_taxonomy(self) -> None:
        text = read_text("codeinfo_markdown/code_review_findings/01-core.md")
        self.assertIn("Scope Impact", text)
        self.assertIn("behavioral_regression", text)
        self.assertIn("correctness_bug", text)
        self.assertIn("proof_gap", text)
        self.assertIn("cleanup_preference", text)

    def test_config_contract_prompt_discourages_behavior_changing_cleanup(self) -> None:
        text = read_text(
            "codeinfo_markdown/code_review_findings/generic_adversarial/03-config-compatibility-and-contracts.md"
        )
        self.assertIn("known to work", text)
        self.assertIn("cleanup_preference", text)
        self.assertIn("working-folder selection", text)

    def test_evidence_gate_requires_runtime_contract_preservation_matrix(self) -> None:
        text = read_text("codeinfo_markdown/review_evidence_gate/01-core.md")
        self.assertIn("Runtime Contract Preservation Matrix", text)
        self.assertIn("folder browsing", text)
        self.assertIn("healthchecks, env dumps, or container-inspect output", text)

    def test_blind_spot_command_includes_changed_hunk_runtime_scan(self) -> None:
        command = json.loads(
            read_text("codex_agents/review_agent/commands/review_blind_spot_challenge.json")
        )
        markdown_files = [item["markdownFile"] for item in command["items"]]
        self.assertIn(
            "review_blind_spot_challenge/focused_challenge/05-changed-hunk-runtime-regressions.md",
            markdown_files,
        )

    def test_changed_hunk_runtime_scan_covers_expected_regression_types(self) -> None:
        text = read_text(
            "codeinfo_markdown/review_blind_spot_challenge/focused_challenge/05-changed-hunk-runtime-regressions.md"
        )
        self.assertIn("drop preserved identifiers", text)
        self.assertIn("malformed input", text)
        self.assertIn("shell, launcher, or runtime feature", text)
        self.assertIn("label honestly describes", text)
        self.assertIn("lazy resolution", text)

    def test_disposition_and_tasking_prompts_gate_cleanup_only_runtime_rewrites(self) -> None:
        classify_text = read_text("codeinfo_markdown/classify_review_disposition.md")
        disposition_text = read_text("codeinfo_markdown/review_disposition.md")
        task_up_text = read_text("codeinfo_markdown/task_up/02-preflight.md")

        self.assertIn("cleanup_preference", classify_text)
        self.assertIn("known-working runtime contract", classify_text)
        self.assertIn("cleanup_preference", disposition_text)
        self.assertIn("known-working behavior", disposition_text)
        self.assertIn("known-working runtime contract", task_up_text)
        self.assertIn("explicit reproduced defect", task_up_text)

    def test_testing_prompts_reject_contract_shape_only_proof(self) -> None:
        ensure_text = read_text(
            "codeinfo_markdown/ensure_task_testing_matches_current_contract.md"
        )
        compact_text = read_text(
            "codeinfo_markdown/review_task_enhancement/09-compact-proof-and-testing.md"
        )
        self.assertIn("contract-shape assertions alone", ensure_text)
        self.assertIn("preserved behavior proof", ensure_text)
        self.assertIn("contract-shape assertions", compact_text)


if __name__ == "__main__":
    unittest.main()
