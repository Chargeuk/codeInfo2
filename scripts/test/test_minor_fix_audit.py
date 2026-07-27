#!/usr/bin/env python3
"""Focused tests for deterministic minor-fix pass audit state."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control.minor_fix_audit import sync_minor_fix_audit, validate_minor_fix_audits


class MinorFixAuditTests(unittest.TestCase):
    def source(self) -> dict[str, object]:
        return {
            "instance_id": "current_repository--codex_review",
            "flow_name": "codex_review",
            "review_phase": "fast",
            "target_id": "current_repository",
            "repo_alias": "current_repository",
            "review_name": "Codex Review",
            "severity": "should_fix",
        }

    def state(self) -> dict[str, object]:
        return {
            "story_number": 64,
            "plan_path": "planning/0000064-review.md",
            "review_cycle_id": "64-rc-20260715T000000Z-aabbccdd",
            "review_pass_id": "64-fast-pass-1",
            "review_phase": "fast",
            "unresolved_minor_batchable_findings": [],
            "unresolved_task_required_findings": [],
            "resolved_minor_findings": [],
            "operationally_blocked_minor_findings": [],
            "rejected_or_non_actionable_findings": [],
        }

    def result(
        self,
        status: str,
        *,
        finding_id: str = "finding-1",
        repository: str = "current_repository",
    ) -> dict[str, object]:
        return {
            "schema_version": 1,
            "generated_at_utc": "2026-07-15T00:00:00Z",
            "story_number": "64",
            "plan_path": "planning/0000064-review.md",
            "review_pass_id": "64-fast-pass-1",
            "finding_id": finding_id,
            "repository": repository,
            "status": status,
            "summary": "Fix the review contract",
            "changed_files": ["src/a.ts", "src/a.test.ts", "src/a.ts"],
            "targeted_proof": [
                {
                    "command": "npm test -- a",
                    "result": "failed",
                    "notes": "initial failure",
                },
                {
                    "command": "npm test -- a",
                    "result": "passed",
                    "notes": "passed after repair",
                },
                {"command": None, "result": "not_run", "notes": "not needed"},
            ],
            "commit_sha": "a" * 40 if status == "fixed" else None,
            "reclassification_reason": (
                "Needs a wider repair" if status == "reclassify_task_required" else None
            ),
            "blocker": "Provider unavailable" if status == "blocked" else None,
            "blocker_scope": "finding_only" if status == "blocked" else None,
        }

    def routed_state(self, status: str) -> dict[str, object]:
        state = self.state()
        finding = {
            "id": "finding-1",
            "repository": "current_repository",
            "summary": "Fix the review contract",
            "review_sources": [self.source()],
        }
        if status == "fixed":
            state["resolved_minor_findings"] = [finding]
        elif status in {"reclassify_task_required", "skipped"}:
            state["unresolved_task_required_findings"] = [finding]
        elif status == "blocked":
            state["operationally_blocked_minor_findings"] = [finding]
        elif status == "out_of_scope_current_story":
            state["rejected_or_non_actionable_findings"] = [finding]
        return state

    def test_fixed_result_preserves_structured_evidence_and_final_retry(self) -> None:
        updated = sync_minor_fix_audit(
            self.routed_state("fixed"), self.result("fixed")
        )

        audit = updated["minor_fix_pass_audits"][0]
        self.assertEqual(audit["fixed_finding_ids"], ["finding-1"])
        self.assertEqual(audit["escalated_finding_ids"], [])
        self.assertEqual(
            audit["attempts"][0]["changed_files"],
            ["src/a.test.ts", "src/a.ts"],
        )
        self.assertEqual(audit["attempts"][0]["review_sources"], [self.source()])
        self.assertEqual(
            audit["executed_tests"],
            [
                {
                    "repository": "current_repository",
                    "command": "npm test -- a",
                    "result": "passed",
                    "notes": "passed after repair",
                }
            ],
        )
        self.assertEqual(validate_minor_fix_audits(updated), (True, "minor_fix_pass_audits_valid"))

    def test_every_terminal_outcome_is_recorded_idempotently(self) -> None:
        for status in (
            "fixed",
            "reclassify_task_required",
            "skipped",
            "blocked",
            "out_of_scope_current_story",
        ):
            with self.subTest(status=status):
                state = self.routed_state(status)
                result = self.result(status)
                once = sync_minor_fix_audit(state, result)
                twice = sync_minor_fix_audit(once, result)
                audit = twice["minor_fix_pass_audits"][0]
                self.assertEqual(len(audit["attempts"]), 1)
                self.assertEqual(audit["attempts"][0]["status"], status)
                self.assertEqual(
                    audit["escalated_finding_ids"],
                    ["finding-1"]
                    if status in {"reclassify_task_required", "skipped"}
                    else [],
                )
                self.assertTrue(validate_minor_fix_audits(twice)[0])

    def test_identical_commands_in_different_repositories_remain_distinct(self) -> None:
        first = sync_minor_fix_audit(
            self.routed_state("fixed"), self.result("fixed")
        )
        second_state = copy.deepcopy(first)
        second_state["resolved_minor_findings"].append(
            {
                "id": "finding-2",
                "repository": "repo-b",
                "summary": "Fix repo B",
                "review_sources": [self.source()],
            }
        )
        second = sync_minor_fix_audit(
            second_state,
            self.result("fixed", finding_id="finding-2", repository="repo-b"),
        )

        tests = second["minor_fix_pass_audits"][0]["executed_tests"]
        self.assertEqual(len(tests), 2)
        self.assertEqual(
            {(item["repository"], item["command"]) for item in tests},
            {
                ("current_repository", "npm test -- a"),
                ("repo-b", "npm test -- a"),
            },
        )

    def test_fast_audit_survives_slow_pass_synchronization(self) -> None:
        fast = sync_minor_fix_audit(
            self.routed_state("fixed"), self.result("fixed")
        )
        slow_state = copy.deepcopy(fast)
        slow_state["review_phase"] = "slow"
        slow_state["review_pass_id"] = "64-slow-pass-1"
        slow_state["resolved_minor_findings"].append(
            {
                "id": "finding-2",
                "repository": "repo-b",
                "summary": "Fix repo B",
                "review_sources": [self.source()],
            }
        )
        slow_result = self.result("fixed", finding_id="finding-2", repository="repo-b")
        slow_result["review_pass_id"] = "64-slow-pass-1"

        updated = sync_minor_fix_audit(slow_state, slow_result)

        self.assertEqual(
            [audit["review_pass_id"] for audit in updated["minor_fix_pass_audits"]],
            ["64-fast-pass-1", "64-slow-pass-1"],
        )
        self.assertTrue(validate_minor_fix_audits(updated)[0])

    def test_legacy_state_is_valid_and_cross_cycle_audit_is_rejected(self) -> None:
        legacy = self.state()
        self.assertEqual(
            validate_minor_fix_audits(legacy), (True, "legacy_audit_state_absent")
        )
        updated = sync_minor_fix_audit(
            self.routed_state("fixed"), self.result("fixed")
        )
        updated["minor_fix_pass_audits"][0]["review_cycle_id"] = "older-cycle"
        self.assertEqual(
            validate_minor_fix_audits(updated),
            (False, "minor_fix_pass_audit_cross_cycle"),
        )


if __name__ == "__main__":
    unittest.main()
