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
    def test_internal_review_prompts_bind_to_server_owned_identity(self) -> None:
        prompt_paths = (
            "codeinfo_markdown/review_evidence_gate/01-core.md",
            "codeinfo_markdown/code_review_findings/01-core.md",
            "codeinfo_markdown/review_findings_saturation.md",
            "codeinfo_markdown/review_blind_spot_challenge/01-core.md",
        )
        for prompt_path in prompt_paths:
            with self.subTest(prompt_path=prompt_path):
                text = read_text(prompt_path)
                self.assertIn("review_session_id", text)
                self.assertIn("parent_execution_id", text)
                self.assertIn("seven-digit", text)
                self.assertRegex(text, r"(?i)(never|may not|do not).*infer")

        merge_text = read_text(
            "codeinfo_markdown/merge_codex_review_findings_into_canonical_review.md"
        )
        classify_text = read_text(
            "codeinfo_markdown/classify_review_disposition.md"
        )
        self.assertIn("current-review-validation.json", merge_text)
        for identity_field in (
            "story_id",
            "plan_path",
            "review_session_id",
            "review_pass_id",
            "parent_execution_id",
            "head_commit",
            "comparison_base_commit",
        ):
            self.assertIn(identity_field, merge_text)
        self.assertIn("current-review-validation.json", classify_text)
        self.assertIn("review_session_id", classify_text)

    def test_review_prompts_never_infer_machine_identity(self) -> None:
        findings_text = read_text(
            "codeinfo_markdown/code_review_findings/01-core.md"
        )
        for forbidden_inference in (
            "Never derive a missing comparison-base identity",
            "`review_pass_id` is explicitly present",
            "explicitly identifies the head and comparison-base commits",
        ):
            self.assertIn(forbidden_inference, findings_text)

        for prompt_path in (
            "codeinfo_markdown/review_findings_saturation.md",
            "codeinfo_markdown/review_blind_spot_challenge/01-core.md",
        ):
            with self.subTest(prompt_path=prompt_path):
                text = read_text(prompt_path)
                self.assertIn(
                    "Never infer, normalize, or repair an identity field or prepared base",
                    text,
                )
                self.assertIn("descriptive remote/fallback context", text)

    def test_repair_and_visual_prompts_require_complete_review_scope(self) -> None:
        repair_text = read_text(
            "codeinfo_markdown/repair_review_workflow_state.md"
        )
        self.assertIn(
            "Before rebuilding review-disposition state from review artifacts",
            repair_text,
        )
        self.assertIn("preserve the blocker", repair_text)

        visual_text = read_text(
            "codeinfo_markdown/review_visual_design_conformance.md"
        )
        for scope_field in (
            "`repo_root`",
            "`branch`",
            "`branched_from`",
            "`comparison_base_ref`",
            "`review_context_sha256`",
            "`review_excluded_paths`",
        ):
            self.assertIn(scope_field, visual_text)

    def test_open_code_review_and_merge_preserve_validated_session_lineage(self) -> None:
        review_text = read_text("codeinfo_markdown/run_open_code_review.md")
        merge_text = read_text(
            "codeinfo_markdown/merge_open_code_review_findings_into_canonical_review.md"
        )
        for required in (
            "review_session_id",
            "canonical_review_pass_id",
            "parent_execution_id",
            "planning/**",
            "current-open-code-review.json",
        ):
            self.assertIn(required, review_text)
            self.assertIn(required, merge_text)
        self.assertIn("current-review-validation.json", merge_text)
        self.assertIn("Origin: open_code_review", merge_text)
        self.assertIn("independently regenerate the exact manifest", review_text)
        self.assertIn("later joined-review validation artifact", review_text)
        self.assertIn("only OCR candidate-finding source", merge_text)
        self.assertIn("coverage and navigation context only", merge_text)

    def test_partial_reviewer_coverage_fails_forward_without_tasking(self) -> None:
        classify_text = read_text(
            "codeinfo_markdown/classify_review_disposition.md"
        )
        disposition_text = read_text("codeinfo_markdown/review_disposition.md")

        self.assertIn("non-blocking entry in `classification_notes`", classify_text)
        self.assertIn(
            "do not create an `incomplete_review_blockers` entry solely for that lost coverage",
            classify_text,
        )
        self.assertIn("only when no reviewer is usable", classify_text)
        self.assertIn("rather than creating plan work", disposition_text)

    def test_missing_review_pass_ids_use_session_scoped_skip_artifacts(self) -> None:
        codex_text = read_text(
            "codeinfo_markdown/merge_codex_review_findings_into_canonical_review.md"
        )
        ocr_text = read_text(
            "codeinfo_markdown/merge_open_code_review_findings_into_canonical_review.md"
        )

        self.assertIn(
            "<review_session_id>-codex-review-merge-skipped.md", codex_text
        )
        self.assertIn(
            "<review_session_id>-open-code-review-merge-skipped.md", ocr_text
        )
        for text in (codex_text, ocr_text):
            self.assertIn("do not infer or invent it", text)
            self.assertIn("finish cleanly without updating either pointer", text)

    def test_codex_identity_mismatches_use_session_scoped_skip_artifacts(self) -> None:
        text = read_text(
            "codeinfo_markdown/merge_codex_review_findings_into_canonical_review.md"
        )

        self.assertIn(
            "present `codex_review_pass_id` with any identity-tuple mismatch",
            text,
        )
        self.assertIn(
            "<review_session_id>-codex-review-merge-skipped.md", text
        )
        self.assertIn(
            "leave the canonical handoff and Codex pointer unchanged", text
        )
        self.assertIn("continue later flow steps", text)

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
            read_text("codeinfo_agents/review_agent/commands/review_blind_spot_challenge.json")
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

    def test_external_review_findings_keep_existing_top_level_outcomes(self) -> None:
        external_text = read_text("codeinfo_markdown/external_review_findings.md")
        saturation_text = read_text("codeinfo_markdown/external_review_findings_saturation.md")

        self.assertIn("an endorsed finding", external_text)
        self.assertIn("a partially valid but non-reopening concern", external_text)
        self.assertIn("a rejected comment", external_text)
        self.assertIn("Do not replace them with a new top-level taxonomy", external_text)
        self.assertIn("endorsed, partially valid, and rejected external-comment reasoning", saturation_text)

    def test_external_review_findings_split_issue_validity_from_remedy_compatibility(self) -> None:
        external_text = read_text("codeinfo_markdown/external_review_findings.md")
        preserve_text = read_text(
            "codeinfo_markdown/preserve_external_review_adjudication_trail.md"
        )

        self.assertIn('follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md"`', external_text)
        self.assertIn("External Issue Validity", external_text)
        self.assertIn("External Remedy Compatibility", external_text)
        self.assertIn("Story Scope Handling", external_text)
        self.assertIn("endorse_but_constrain_fix", external_text)
        self.assertIn("Fix Constraint:", external_text)
        self.assertIn(
            'Do not describe an endorsed finding with a rejected remedy as "not accepted as a finding."',
            external_text,
        )
        self.assertIn(
            "comments kept as endorsed findings whose suggested remedy was rejected as out-of-scope",
            external_text,
        )
        self.assertNotIn("why they were not accepted as findings", external_text)
        self.assertIn("underlying issue was adopted as an endorsed finding but whose suggested remedy was rejected as out-of-scope", preserve_text)

    def test_classifier_and_follow_up_prompts_preserve_constrained_external_findings(self) -> None:
        classify_text = read_text("codeinfo_markdown/classify_review_disposition.md")
        minor_fix_text = read_text("codeinfo_markdown/fix_next_minor_review_finding.md")
        task_up_text = read_text("codeinfo_markdown/ensure_review_findings_became_tasks.md")
        document_minor_text = read_text("codeinfo_markdown/document_minor_review_fix.md")

        self.assertIn("suggested fix is outside approved story scope", classify_text)
        self.assertIn("preserving the fix constraint in the finding's routing reason", classify_text)
        self.assertIn("routed `reason` as the binding downstream contract", minor_fix_text)
        self.assertIn("Do not go back to the findings artifact or external-review adjudication trail", minor_fix_text)
        self.assertIn("attempt that alternative fix first", minor_fix_text)
        self.assertIn("Do not use this out-of-scope path merely because the reviewer's preferred remedy is out-of-scope", minor_fix_text)
        self.assertIn("preserve that constraint when writing the escalated task-required entry", document_minor_text)
        self.assertIn("treat that routed `reason` as the authoritative downstream wording", task_up_text)
        self.assertIn("external reviewer's proposed remedy is out-of-scope but the underlying issue remains current-story actionable", task_up_text)
        self.assertIn("must not restate the out-of-scope remedy as the implementation contract", task_up_text)

    def test_external_review_saturation_preserves_constraint_metadata(self) -> None:
        saturation_text = read_text(
            "codeinfo_markdown/external_review_findings_saturation.md"
        )

        self.assertIn("Preserve any external-review constraint metadata", saturation_text)
        self.assertIn("`External Issue Validity`", saturation_text)
        self.assertIn("`External Remedy Compatibility`", saturation_text)
        self.assertIn("`Story Scope Handling`", saturation_text)
        self.assertIn("`Fix Constraint`", saturation_text)
        self.assertIn("carry forward an equivalent `Fix Constraint`", saturation_text)

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

        self.assertIn("at most one fresh rerun", classify_text)
        self.assertIn("previous same-cycle state already had `needs_review_rerun_before_close: true`", classify_text)
        self.assertIn("the current pass is the one allowed rerun", classify_text)
        self.assertIn("do not leave any still-unresolved condition on the minor-fix rerun path", classify_text)
        self.assertIn("do not leave the remaining issue only in `unresolved_minor_batchable_findings` or `operationally_blocked_minor_findings`", classify_text)
        self.assertIn("needs_task_up_path", classify_text)
        self.assertIn("unresolved_task_required_findings", classify_text)
        self.assertIn("incomplete_review_blockers", classify_text)
        self.assertIn("review did not converge after one allowed rerun", classify_text)
        self.assertNotIn("review_rerun_count", classify_text)
        self.assertNotIn("review_rerun_count", document_minor_text)
        self.assertNotIn("review_rerun_count", task_up_text)
        self.assertNotIn("exhausted-rerun", task_up_text)

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

    def test_internal_review_stacks_use_bounded_plan_profiles(self) -> None:
        evidence = read_text("codeinfo_markdown/review_evidence_gate/01-core.md")
        findings = read_text("codeinfo_markdown/code_review_findings/01-core.md")
        saturation = read_text("codeinfo_markdown/review_findings_saturation.md")
        blind_spot = read_text(
            "codeinfo_markdown/review_blind_spot_challenge/01-core.md"
        )

        self.assertIn("shared/bounded-plan-read.md", evidence)
        self.assertIn('plan_sections.py" --profile review-evidence', evidence)
        self.assertIn("Runtime Contract Preservation Matrix", evidence)
        self.assertIn("final-task proof details", evidence)

        self.assertIn("shared/bounded-plan-read.md", findings)
        self.assertIn('plan_sections.py" --profile review-findings', findings)
        self.assertIn("--task-number <number>", findings)
        self.assertIn("perform the actual review", findings)

        self.assertIn("shared/bounded-plan-read.md", saturation)
        self.assertIn('plan_sections.py" --profile review-findings', saturation)
        self.assertIn("same-class sibling", saturation)

        self.assertIn("shared/bounded-plan-read.md", blind_spot)
        self.assertIn('plan_sections.py" --profile review-findings', blind_spot)
        self.assertIn("blind-spot challenge", blind_spot)

        for text in (evidence, findings, saturation, blind_spot):
            self.assertNotIn("re-open that exact plan", text.lower())
            self.assertNotIn("re-open the exact relative `plan_path`", text.lower())

    def test_review_created_task_scope_prompt_requires_disk_rereads_and_section_gates(
        self,
    ) -> None:
        text = read_text("codeinfo_markdown/repair_review_created_task_scope.md")

        self.assertIn("Read `codeInfoStatus/flow-state/current-plan.json` from disk first", text)
        self.assertIn("Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`", text)
        self.assertIn("shared/bounded-plan-read.md", text)
        self.assertIn("plan_sections.py\" --profile review-tasking", text)
        self.assertIn("Do not answer from conversational memory", text)
        self.assertIn("After making any repair edit, rerun the same bounded review-tasking query", text)
        self.assertIn("This step runs only after a separate loop preflight", text)
        self.assertIn("If the context became unusable after the loop preflight", text)
        self.assertIn("Task Exit Criteria", text)
        self.assertIn("Addresses Findings", text)
        self.assertIn("Risk Ownership", text)
        self.assertIn("Owner Map", text)
        self.assertIn("Requirement-To-Proof Mapping", text)
        self.assertIn("Testing", text)
        self.assertIn("Manual Testing Guidance", text)
        self.assertIn("Implementation Notes", text)
        self.assertIn("restores previously approved or preserved behavior", text)

    def test_review_findings_scope_filter_prompt_repairs_stale_blocker_state(self) -> None:
        text = read_text("codeinfo_markdown/filter_review_findings_to_story_scope.md")

        self.assertIn("Read `codeInfoStatus/flow-state/current-plan.json` from disk first", text)
        self.assertIn("Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`", text)
        self.assertIn("shared/bounded-plan-read.md", text)
        self.assertIn("plan_sections.py\" --profile review-scope", text)
        self.assertIn("Read `\"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md\"`", text)
        self.assertIn("make no edits and treat this step as a clean skip", text)
        self.assertIn("optional evidence inputs", text)
        self.assertIn("Do not preserve an `incomplete_review_blocker`", text)
        self.assertIn("Remove or reclassify any blocker entry", text)
        self.assertIn("needs_task_up_path` remains true only because an `incomplete_review_blocker` tied solely to a rejected finding was preserved", text)
        self.assertIn("safe_to_exit_review_loop_without_tasking` remains false only because a blocker tied solely to a rejected finding was preserved", text)
        self.assertIn("no `incomplete_review_blocker` or `operationally_blocked_minor_finding` remains solely because a rejected finding used to justify it", text)

    def test_actionable_review_findings_are_promoted_for_one_inline_attempt(self) -> None:
        promote_text = read_text(
            "codeinfo_markdown/promote_actionable_review_findings_to_minor_path.md"
        )
        fix_text = read_text("codeinfo_markdown/fix_next_minor_review_finding.md")
        document_text = read_text("codeinfo_markdown/document_minor_review_fix.md")

        self.assertIn(
            "after story-scope filtering and immediately before the Minor Review Fix Path",
            promote_text,
        )
        self.assertIn(
            "Move each current-story actionable entry that has not already received an inline attempt",
            promote_text,
        )
        self.assertIn(
            "initial classifier disposition was task-required", promote_text
        )
        self.assertIn(
            "Do not promote any entry from `rejected_or_non_actionable_findings`",
            promote_text,
        )
        self.assertIn(
            "an inline attempt already occurred and ended in `reclassify_task_required`",
            promote_text,
        )
        self.assertIn("internally create a one-shot resolution plan", fix_text)
        self.assertIn(
            "diagnose the failure, revise the plan or implementation, and retry",
            fix_text,
        )
        self.assertIn(
            "Do not stop merely because the first approach failed", fix_text
        )
        self.assertIn(
            "Do not repeat the same failed code change and proof command without new evidence",
            fix_text,
        )
        self.assertIn("makes a materially different safe change", fix_text)
        self.assertIn("If no new safe action remains", fix_text)
        self.assertIn(
            "Confirm no failed approach was repeated without new evidence", fix_text
        )
        self.assertIn(
            "attempted every safe bounded action it identified", document_text
        )
        self.assertIn(
            "cannot promote the same durable follow-up into a repeat attempt",
            document_text,
        )
        self.assertIn("When a skipped finding is escalated", document_text)
        self.assertIn("cannot promote it into a repeat attempt", document_text)

    def test_active_task_normalization_does_not_require_a_selected_task(self) -> None:
        text = read_text("codeinfo_markdown/normalize_inconsistent_active_task.md")

        self.assertIn('plan_status.py" --include-tasks', text)
        self.assertIn("without depending on `current-task.json` having a selection", text)
        self.assertIn("--task-number <inconsistent-task-number>", text)
        self.assertIn('plan_sections.py" --profile current-task --task current', text)

    def test_select_current_task_example_matches_required_bounded_profile(self) -> None:
        text = read_text("codeinfo_markdown/select_current_task.md")
        command = 'plan_sections.py" --profile current-task --task current'

        self.assertGreaterEqual(text.count(command), 2)
        self.assertNotIn("--task-number 12 --section", text)

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
