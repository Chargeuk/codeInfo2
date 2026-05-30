#!/usr/bin/env python3
"""Regression tests for review prompt guardrails."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "scripts" / "test" / "fixtures" / "review_prompt_contracts"


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
        self.assertIn("unknown_scope_impact", text)
        self.assertIn("must not stop", text)

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

        checklist_text = read_text(
            "codeinfo_markdown/review_evidence_gate/proof_and_risk/05-test-proof-and-adversarial-checklist.md"
        )
        self.assertIn("non-default representative value", checklist_text)
        self.assertIn("validator, discovery route, provider flag sanitizer, execution route, or provider interface", checklist_text)
        self.assertIn("runtime-config overlay or an explicit contract narrowing", checklist_text)

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
        self.assertIn("lost preserved identifiers", text)
        self.assertIn("malformed TOML", text)
        self.assertIn("non-POSIX features such as `local`", text)
        self.assertIn("silently dropped, narrowed, or translated differently", text)
        self.assertIn("validator, discovery route, provider flag sanitizer, execution route, or provider interface", text)
        self.assertIn("non-default enum-like provider flag value, such as `cached`", text)
        self.assertIn("Do not use this check as permission to reopen unrelated env, compose, or startup cleanup", text)

    def test_disposition_and_tasking_prompts_gate_cleanup_only_runtime_rewrites(self) -> None:
        classify_text = read_text("codeinfo_markdown/classify_review_disposition.md")
        disposition_text = read_text("codeinfo_markdown/review_disposition.md")
        task_up_text = read_text("codeinfo_markdown/task_up/02-preflight.md")
        task_audit_text = read_text(
            "codeinfo_markdown/task_up/11-review-preemption-audit.md"
        )

        self.assertIn("cleanup_preference", classify_text)
        self.assertIn("known-working runtime contract", classify_text)
        self.assertIn("unknown_scope_impact", classify_text)
        self.assertIn("normalize it to `unknown_scope_impact`", classify_text)
        self.assertIn("cleanup_preference", disposition_text)
        self.assertIn("known-working behavior", disposition_text)
        self.assertIn("must not be absorbed", disposition_text)
        self.assertIn("do not suppress the finding", disposition_text)
        self.assertIn("known-working runtime contract", task_up_text)
        self.assertIn("explicit reproduced defect", task_up_text)
        self.assertIn("continue task-up normally", task_up_text)
        self.assertIn("Missing or malformed `Scope Impact` metadata", task_audit_text)

    def test_only_exact_cleanup_preference_gets_the_narrowing_behavior(self) -> None:
        classify_text = read_text("codeinfo_markdown/classify_review_disposition.md")
        disposition_text = read_text("codeinfo_markdown/review_disposition.md")

        self.assertIn("Only when a finding explicitly says `Scope Impact: cleanup_preference`", classify_text)
        self.assertIn("exact `Scope Impact` is `cleanup_preference`", disposition_text)
        self.assertIn("If `Scope Impact` is missing, malformed, or unrecognized", disposition_text)

    def test_review_classifier_caps_reruns_before_forcing_durable_follow_up(self) -> None:
        classify_text = read_text("codeinfo_markdown/classify_review_disposition.md")
        document_minor_text = read_text("codeinfo_markdown/document_minor_review_fix.md")
        task_up_text = read_text("codeinfo_markdown/ensure_review_findings_became_tasks.md")

        self.assertIn("review_rerun_count", classify_text)
        self.assertIn("at most one fresh rerun", classify_text)
        self.assertIn("do not request a second rerun", classify_text)
        self.assertIn("needs_task_up_path", classify_text)
        self.assertIn("review rerun did not converge", classify_text)
        self.assertIn("review_rerun_count", document_minor_text)
        self.assertIn("Do not increment `review_rerun_count` in this step", document_minor_text)
        self.assertIn("needs_review_rerun_before_close: true", task_up_text)
        self.assertIn("review_rerun_count >= 1", task_up_text)
        self.assertIn("exhausted-rerun", task_up_text)

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

    def test_regression_fixtures_cover_real_runtime_miss_patterns(self) -> None:
        self.assertTrue(FIXTURES_DIR.is_dir())
        expected = {
            "lost-thread-id.md": "thread id",
            "malformed-toml-discovery.md": "malformed TOML",
            "posix-sh-local.md": "non-POSIX shell features such as `local`",
        }
        for filename, needle in expected.items():
            path = FIXTURES_DIR / filename
            self.assertTrue(path.is_file(), f"missing fixture {filename}")
            self.assertIn(needle, path.read_text())


if __name__ == "__main__":
    unittest.main()
