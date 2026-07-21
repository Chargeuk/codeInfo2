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
    def test_post_review_closeout_requires_completed_cycle_state(self) -> None:
        generator = read_text(
            "codeinfo_markdown/generate_or_update_minor_fix_revalidation_task.md"
        )
        closeout = read_text(
            "codeinfo_markdown/write_review_no_findings_closeout.md"
        )
        for text in (generator, closeout):
            self.assertIn("active-review-cycle.json", text)
            self.assertIn("review-initialization-failure.json", text)
            self.assertIn('status: "completed"', text)
            self.assertNotIn("parent_execution_id", text)
        self.assertIn("Recover Incomplete Story", generator)
        self.assertIn("one normal final whole-story revalidation task", generator)
        self.assertIn("not a no-findings review", closeout)

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
                self.assertNotIn("parent_execution_id", text)
                self.assertIn("seven-digit", text)
                self.assertRegex(text, r"(?i)(never|may not|do not).*infer")

        classify_text = read_text(
            "codeinfo_markdown/classify_review_disposition.md"
        )
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

    def test_open_code_review_uses_agent_owned_generic_workspace_output(self) -> None:
        review_text = read_text(
            "codeinfo_markdown/run_open_code_review_workspace.md"
        )
        contract_text = read_text(
            "codeinfo_markdown/review_job_workspace_contract.md"
        )
        for required in (
            "ocr agent prepare",
            "ocr agent validate-comments",
            "ocr agent report",
            "planning/**",
            "output/",
            "self-describing review",
        ):
            self.assertIn(required, review_text)
        self.assertIn("There is no required review-result schema", contract_text)
        self.assertIn("Do not run a publisher", contract_text)
        self.assertIn("Do not invoke `publish_open_code_review.py`", review_text)
        self.assertIn("do not write `current-open-code-review.json`", review_text)

    def test_multi_agent_review_stages_share_only_their_scheduler_job(self) -> None:
        contract_text = read_text(
            "codeinfo_markdown/review_job_workspace_contract.md"
        )

        self.assertIn("current-review_artifacts_main-review-job.md", contract_text)
        self.assertIn("Internal agent identifiers are stages", contract_text)
        for sibling in ("Codex", "OpenCode", "cross-repository"):
            self.assertIn(sibling, contract_text)

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

    def test_complete_cycle_uses_repeated_and_one_shot_generic_review_batches(self) -> None:
        cycle = json.loads(read_text("flows/two_phase_review_cycle.json"))
        repeated_loop = next(
            step
            for step in cycle["steps"]
            if step.get("label") == "Repeated Review Group"
        )
        initializer = cycle["steps"][0]
        repeated_wave = next(
            step
            for step in repeated_loop["steps"]
            if step["type"] == "subflowWave"
        )
        one_shot_waves = [
            step
            for step in cycle["steps"]
            if step.get("label") == "Run One-Shot Generic Review Batch"
        ]
        cycle_text = json.dumps(cycle)

        self.assertEqual(initializer["type"], "initializeReviewCycle")
        self.assertEqual(initializer["mode"], "final")
        self.assertEqual(repeated_loop["maxIterations"], 5)
        self.assertEqual(repeated_wave["groups"][0]["flowName"], "review_batch")
        repeated_groups = repeated_wave["groups"][0]["bindings"]["inputValues"][
            "review_groups"
        ]
        self.assertEqual(
            repeated_groups[0]["flowNames"], ["codex_review", "open_code_review"]
        )
        self.assertEqual(repeated_groups[1]["flowName"], "cross_repository_review")
        self.assertEqual(len(one_shot_waves), 1)
        one_shot_groups = one_shot_waves[0]["groups"][0]["bindings"][
            "inputValues"
        ]["review_groups"]
        self.assertEqual(one_shot_groups[0]["flowNames"], ["review_artifacts_main"])
        settlement_steps = [
            step
            for step in cycle["steps"]
            if step.get("identifier") == "review_settler"
        ]
        self.assertTrue(settlement_steps)
        self.assertTrue(
            all(step["agentType"] == "tasking_agent" for step in settlement_steps)
        )
        self.assertNotIn('"reviewPhase"', cycle_text)
        self.assertNotIn('"prepareReviewSet"', cycle_text)

    def test_settlement_auditor_records_only_explicit_cycle_control_state(self) -> None:
        audit_text = read_text(
            "codeinfo_markdown/audit_agent_native_review_settlement.md"
        )
        recorder_text = read_text("scripts/record_review_cycle_outcome.py")

        self.assertIn("record_review_cycle_outcome.py", audit_text)
        self.assertIn("--status completed", audit_text)
        self.assertIn("--status incomplete --reason", audit_text)
        self.assertIn("every supported finding", audit_text)
        self.assertNotIn("review-result schema", audit_text)
        self.assertNotIn("reviewer count", recorder_text)
        self.assertNotIn("output_dir", recorder_text)
        self.assertNotIn("reconciliation", recorder_text)

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

    def test_agent_native_batch_scope_filter_reuses_policy_and_preserves_removals(
        self,
    ) -> None:
        batch_filter = read_text(
            "codeinfo_markdown/filter_review_batch_findings_to_story_scope.md"
        )
        disposition = read_text("codeinfo_markdown/disposition_review_batch.md")

        self.assertIn(
            "codeinfo_markdown/filter_review_findings_to_story_scope.md",
            batch_filter,
        )
        for policy_section in (
            "<filter_purpose>",
            "<rejection_gates>",
            "<required_non_rejection_rule>",
            "<authoritative_findings_rule>",
            "<ambiguity_rules>",
            "<follow_up_capture_rule>",
        ):
            self.assertIn(policy_section, batch_filter)
        self.assertIn("shared/bounded-plan-read.md", batch_filter)
        self.assertIn("shared/story_behavior_lock.md", batch_filter)
        self.assertIn('plan_sections.py\" --profile review-scope', batch_filter)
        self.assertIn("scope-filtered-findings.md", batch_filter)
        self.assertIn("leave the reconciliation unchanged", batch_filter)
        self.assertIn("Do not modify anything under a job's", batch_filter)
        self.assertIn("Remove a fully out-of-scope finding only", batch_filter)
        self.assertIn("narrow the actionable reconciliation entry", batch_filter)
        self.assertIn("Always write", batch_filter)
        self.assertIn("every original actionable finding", batch_filter)
        self.assertIn("Do not assume a provider list, expected reviewer count", batch_filter)

        self.assertIn("scope-filtered-findings.md", disposition)
        self.assertIn("Never restore, direct-fix, or task up", disposition)
        self.assertIn("Ignored for This Story", disposition)
        self.assertIn("only surviving actionable findings", disposition)
        self.assertIn("Deduplicate by the finding's stable identity", disposition)

    def test_legacy_scope_filter_flows_keep_the_state_specific_prompt(self) -> None:
        for relative_path in (
            "flows/review_plan.json",
            "flows/review_disposition_current_artifacts.json",
            "flows/ingest_external_review_plan.json",
        ):
            flow_text = read_text(relative_path)
            self.assertIn("filter_review_findings_to_story_scope.md", flow_text)
            self.assertNotIn(
                "filter_review_batch_findings_to_story_scope.md", flow_text
            )

    def test_agent_native_batch_repairs_escalate_before_task_creation(self) -> None:
        disposition = read_text("codeinfo_markdown/disposition_review_batch.md")
        normal_fix = read_text(
            "codeinfo_markdown/implement_review_batch_direct_fixes.md"
        )
        stronger_fix = read_text(
            "codeinfo_markdown/implement_review_batch_remaining_fixes.md"
        )
        outcome = read_text("codeinfo_markdown/record_review_batch_outcome.md")
        settle = read_text("codeinfo_markdown/settle_agent_native_review_pass.md")
        apply = read_text("codeinfo_markdown/apply_agent_native_review_settlement.md")
        audit = read_text("codeinfo_markdown/audit_agent_native_review_settlement.md")
        batch = json.loads(read_text("flows/review_batch.json"))

        self.assertIn("Repair difficulty is advisory", disposition)
        self.assertIn("do not make a final implementation-task decision here", disposition)
        self.assertIn("Consider every supported in-scope actionable finding", normal_fix)
        self.assertIn("Group findings by owning target repository", normal_fix)
        self.assertIn("process repositories sequentially", normal_fix)
        self.assertIn("Create separate commits in every changed repository", normal_fix)
        self.assertIn("Do not require a rigid schema or exact audit filename", normal_fix)
        for repair_prompt in (normal_fix, stronger_fix):
            self.assertIn("strict repair-only mode", repair_prompt)
            self.assertIn("smallest focused evidence-backed", repair_prompt)
            self.assertIn("directly causes the accepted finding", repair_prompt)
            self.assertIn("necessarily coupled", repair_prompt)
            self.assertIn(
                "same file, class, module, repository, or subsystem",
                repair_prompt,
            )
            self.assertIn(
                "Once the direct issue is fixed and focused proof passes",
                repair_prompt,
            )
            self.assertIn("why every changed file was necessary", repair_prompt)
        self.assertIn("Reconstruct every supported in-scope actionable finding", stronger_fix)
        self.assertIn("If the normal audit is missing or incomplete", stronger_fix)
        self.assertIn("Your objective is to fix every remaining finding", stronger_fix)
        self.assertIn("Create and execute an internal dependency-aware plan", stronger_fix)
        self.assertIn("related past stories and implementation notes", stronger_fix)
        self.assertIn("other ingested repositories", stronger_fix)
        self.assertIn("official documentation, and internet research", stronger_fix)
        self.assertIn("materially different focused implementation remains", stronger_fix)
        self.assertIn("return to it with the additional evidence", stronger_fix)
        self.assertIn("process repositories sequentially", stronger_fix)
        self.assertIn("coordinated producer-consumer changes", stronger_fix)
        self.assertIn("are not valid stopping reasons", stronger_fix)
        self.assertIn("exact genuine blocker for anything unresolved", stronger_fix)
        self.assertIn("Do not create implementation tasks", stronger_fix)
        self.assertIn(
            "Research may be broad, but implementation must remain narrow",
            stronger_fix,
        )
        self.assertIn(
            "every narrower safe correction has been disproved",
            stronger_fix,
        )
        self.assertIn("not speculative redesign or improvement", stronger_fix)
        self.assertNotIn("multi-step refactors", stronger_fix)
        self.assertNotIn("Do not invent a product decision", stronger_fix)
        self.assertNotIn(
            "that can be resolved autonomously during this one invocation",
            stronger_fix,
        )
        self.assertIn("every target repository", outcome)
        self.assertIn("after both opportunities", outcome)
        self.assertIn("Do not create a task merely because disposition predicted", settle)
        self.assertIn("after the stronger repair opportunity", apply)
        self.assertIn("a disposition prediction was tasked before repair", audit)

        optional_loop = next(
            step
            for step in batch["steps"]
            if step.get("label") == "Optional Stronger Review Repair"
        )
        self.assertEqual(optional_loop["type"], "startLoop")
        self.assertEqual(optional_loop["maxIterations"], 1)
        completion_gate = optional_loop["steps"][0]
        self.assertEqual(completion_gate["agentType"], "coding_agent")
        self.assertEqual(completion_gate["identifier"], "batch_fixer")
        self.assertEqual(completion_gate["breakOn"], "yes")
        self.assertNotIn("breakOnFailure", completion_gate)
        stronger_step = next(
            step
            for step in optional_loop["steps"]
            if step.get("label") == "Implement Remaining Review Fixes"
        )
        self.assertEqual(stronger_step["agentType"], "research_agent")
        self.assertTrue(stronger_step["continueOnFailure"])
        self.assertEqual(
            stronger_step["markdownFile"],
            "implement_review_batch_remaining_fixes.md",
        )
        final_gate = optional_loop["steps"][-1]
        self.assertEqual(final_gate["agentType"], "loop_control_agent")
        self.assertEqual(final_gate["breakOn"], "yes")

        for text in (normal_fix, stronger_fix, outcome, settle):
            self.assertNotIn("reviewer count is", text)
            self.assertNotIn("provider pointer", text.lower())

    def test_actionable_review_findings_are_promoted_for_one_inline_attempt(self) -> None:
        promote_text = read_text(
            "codeinfo_markdown/promote_actionable_review_findings_to_minor_path.md"
        )
        filter_text = read_text(
            "codeinfo_markdown/filter_review_findings_to_story_scope.md"
        )
        fix_text = read_text("codeinfo_markdown/fix_next_minor_review_finding.md")
        document_text = read_text("codeinfo_markdown/document_minor_review_fix.md")

        self.assertIn(
            "after story-scope filtering and immediately before the review issue decisions are recorded in the plan",
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
        self.assertIn("`review_decision_recording` object unchanged", filter_text)
        self.assertIn("`review_decision_recording` object unchanged", promote_text)
        self.assertIn("When a skipped finding is escalated", document_text)
        self.assertIn("cannot promote it into a repeat attempt", document_text)

    def test_review_issue_decisions_are_recorded_before_implementation(self) -> None:
        record_text = read_text(
            "codeinfo_markdown/record_review_issue_decisions_in_plan.md"
        )
        ensure_text = read_text(
            "codeinfo_markdown/ensure_review_findings_became_tasks.md"
        )
        verify_text = read_text(
            "codeinfo_markdown/verify_review_issue_decisions_recorded.md"
        )
        closeout_text = read_text(
            "codeinfo_markdown/write_review_no_findings_closeout.md"
        )
        disposition_text = read_text("codeinfo_markdown/review_disposition.md")
        external_text = read_text(
            "codeinfo_markdown/external_review_disposition.md"
        )
        external_trail_text = read_text(
            "codeinfo_markdown/preserve_external_review_adjudication_trail.md"
        )

        for identity_field in (
            "story_id",
            "plan_path",
            "review_session_id",
            "review_pass_id",
            "review_cycle_id",
            "head_commit",
            "comparison_base_commit",
        ):
            with self.subTest(identity_field=identity_field):
                self.assertIn(identity_field, record_text)

        self.assertIn(
            "after story-scope filtering and actionable-finding promotion",
            record_text,
        )
        self.assertIn(
            "Use `review-disposition-state.json` as the sole source of actionable accepted-versus-rejected routing",
            record_text,
        )
        self.assertIn(
            "Treat `current-plan.json` only as the owner of `plan_path`, optional `branched_from`, and `additional_repositories`",
            record_text,
        )
        self.assertIn(
            "Do not require `story_id`, `review_session_id`, `review_pass_id`, `head_commit`, or `comparison_base_commit` to exist in `current-plan.json`",
            record_text,
        )
        self.assertIn(
            "Treat missing optional comparison-description metadata as recoverable",
            record_text,
        )
        self.assertIn("`resolved_minor_findings` as Accepted", record_text)
        self.assertIn("exact validated current-pass findings artifact", record_text)
        self.assertIn("`Rejected Risk Notes`", record_text)
        self.assertIn("`External Review Adjudication Trail`", record_text)
        self.assertIn("Deduplicate ignored entries", record_text)
        self.assertIn("Never manufacture a workflow finding ID", record_text)
        self.assertIn("### Accepted", record_text)
        self.assertIn("### Ignored for This Story", record_text)
        self.assertIn("- Review pass: `<review_pass_id>`", record_text)
        self.assertIn("- Review cycle: `<review_cycle_id>`", record_text)
        self.assertIn("- Comparison context:", record_text)
        self.assertIn("- Description:", record_text)
        self.assertIn("- Example:", record_text)
        self.assertIn("- Found by:", record_text)
        self.assertIn("- Why accepted:", record_text)
        self.assertIn("- Why ignored:", record_text)
        self.assertIn(
            "No concrete example was recorded in the validated review evidence",
            record_text,
        )
        self.assertIn(
            "Never append a second `## Code Review Findings` block for the same `review_pass_id`",
            record_text,
        )
        self.assertIn(
            "Never delete, rename, merge, or rewrite a block belonging to an earlier review pass",
            record_text,
        )
        self.assertIn(
            "exact `Review pass` metadata value matching the active `review_pass_id` inside a `## Code Review Findings` section",
            record_text,
        )
        self.assertNotIn(
            "`Review pass: \\`<review_pass_id>\\``metadata inside a`## Code Review Findings` section",
            record_text,
        )
        self.assertIn(
            "Do not describe an `incomplete_review_blockers` entry as accepted or ignored",
            record_text,
        )
        self.assertIn(
            "this task-up step must reuse it rather than create a second findings summary",
            ensure_text,
        )
        self.assertIn(
            "Do not append another findings section", ensure_text
        )
        self.assertIn("retired terse summary format", ensure_text)
        self.assertIn("`resolved_minor_findings` entry as Accepted", ensure_text)
        self.assertIn(
            "immediately after `Record Review Issue Decisions In Plan` and immediately before the Minor Review Fix Path",
            verify_text,
        )
        self.assertIn(
            "apply `record_review_issue_decisions_in_plan.md` once",
            verify_text,
        )
        self.assertIn("Never append a duplicate current-pass block", verify_text)
        self.assertIn("deterministic pre-fix gate", verify_text)
        self.assertIn("`needs_review_rerun_before_close` to true", record_text)
        self.assertIn("preserve every finding queue and `needs_task_up_path`", record_text)
        self.assertIn("Do not add an `incomplete_review_blockers` entry", record_text)
        self.assertIn("do not deliberately return a failed turn", record_text)
        self.assertNotIn("If committing fails, stop", record_text)
        self.assertIn('"review_decision_recording"', record_text)
        self.assertIn('"outcome": "<recorded|no_decisions|retry_required>"', record_text)
        self.assertIn("Never preserve `pending`", record_text)
        self.assertIn("exact latest full commit SHA", record_text)
        self.assertIn("Never leave `pending`", verify_text)
        self.assertIn("deterministic readiness control", verify_text)
        self.assertIn(
            "If that block exists, it is the durable outcome for this pass, including ignored-only decisions: do not append or repair a `Post-Implementation Code Review` section for the same pass",
            closeout_text,
        )
        self.assertIn("ignored-only decisions", closeout_text)
        self.assertIn("remove only that duplicate legacy section", closeout_text)
        self.assertIn("Confirm exactly one conditional outcome", closeout_text)
        self.assertNotIn(
            "When the review has ended cleanly, append or repair", closeout_text
        )
        self.assertNotIn(
            "Confirm the plan now has exactly one `Post-Implementation Code Review` section",
            closeout_text,
        )
        self.assertIn(
            "before generic classification, plan recording, or implementation begins",
            external_trail_text,
        )
        self.assertIn("report normally", external_trail_text)
        self.assertIn("Do not deliberately fail the turn", external_trail_text)
        self.assertIn("record_review_issue_decisions_in_plan.md", disposition_text)
        self.assertIn("retired terse findings summary", disposition_text)
        self.assertIn("ignored findings only", disposition_text)
        self.assertIn("no accepted or ignored current-pass findings", disposition_text)
        self.assertIn(
            "routed `must_fix` or `should_fix` findings exist", disposition_text
        )
        self.assertIn(
            "In orchestrated review loops, leave task creation to task-up",
            disposition_text,
        )
        self.assertIn(
            "For an ignored-only pass, preserve the structured findings block without creating tasks",
            disposition_text,
        )
        self.assertIn(
            "immediately after those review-fix tasks, so the story must be revalidated",
            disposition_text,
        )
        self.assertIn("accepted and ignored external-review decisions", external_text)

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

    def test_minor_fix_audit_task_contract_is_durable_and_non_owning(self) -> None:
        generate_text = read_text(
            "codeinfo_markdown/generate_or_update_minor_fix_audit_task.md"
        )
        refresh_text = read_text(
            "codeinfo_markdown/refresh_minor_fix_audit_task_coverage.md"
        )
        task_up_text = read_text(
            "codeinfo_markdown/ensure_review_findings_became_tasks.md"
        )

        self.assertIn("minor_fix_loop_audit", generate_text)
        self.assertIn("Task Status: __done__", generate_text)
        self.assertIn("deduplicated by repository plus command", generate_text)
        self.assertIn("--all-passes", refresh_text)
        self.assertIn("grouped task-up work", refresh_text)
        self.assertIn("minor_fix_loop_audit", task_up_text)
        self.assertIn("immutable historical evidence", task_up_text)
        self.assertIn("Addresses Findings", task_up_text)

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
