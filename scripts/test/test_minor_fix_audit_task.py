#!/usr/bin/env python3
"""Integration-focused tests for completed minor-fix audit task upserts."""

from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control.minor_fix_audit import sync_minor_fix_audit
from write_minor_fix_audit_task import upsert_audit_task


class MinorFixAuditTaskTests(unittest.TestCase):
    def make_plan(self) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        plan = Path(temporary.name) / "planning" / "0000064-audit.md"
        plan.parent.mkdir(parents=True)
        plan.write_text(
            """# Story 64

### Task 1. Existing implementation

- Task Status: `__done__`

#### Subtasks

1. [x] Existing work.

#### Testing

1. [x] Existing proof.

#### Implementation Notes

- Complete.
""",
            encoding="utf-8",
        )
        return plan

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

    def audit(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "review_cycle_id": "64-rc-20260715T000000Z-aabbccdd",
            "review_pass_id": "64-fast-pass-1",
            "review_phase": "fast",
            "repositories": ["current_repository"],
            "attempts": [
                {
                    "finding_id": "fixed-1",
                    "repository": "current_repository",
                    "summary": "Fix source attribution",
                    "status": "fixed",
                    "review_sources": [self.source()],
                    "changed_files": ["src/a.test.ts", "src/a.ts"],
                    "targeted_proof": [
                        {
                            "command": "npm test -- a",
                            "result": "passed",
                            "notes": "passed after repair",
                        }
                    ],
                    "commit_sha": "a" * 40,
                    "reason": None,
                    "escalated_to_task": False,
                },
                {
                    "finding_id": "escalated-1",
                    "repository": "current_repository",
                    "summary": "Repair the broader task-up seam",
                    "status": "reclassify_task_required",
                    "review_sources": [self.source()],
                    "changed_files": [],
                    "targeted_proof": [],
                    "commit_sha": None,
                    "reason": "Needs a broader repair",
                    "escalated_to_task": True,
                },
            ],
            "fixed_finding_ids": ["fixed-1"],
            "escalated_finding_ids": ["escalated-1"],
            "executed_tests": [
                {
                    "repository": "current_repository",
                    "command": "npm test -- a",
                    "result": "passed",
                    "notes": "passed after repair",
                }
            ],
        }

    def test_upsert_creates_one_completed_task_and_replays_idempotently(self) -> None:
        plan = self.make_plan()
        first = upsert_audit_task(plan, self.audit())
        second = upsert_audit_task(plan, self.audit())
        text = plan.read_text(encoding="utf-8")

        self.assertEqual(first["action"], "created")
        self.assertEqual(second["action"], "unchanged")
        self.assertEqual(text.count("Review Task Role: `minor_fix_loop_audit`"), 1)
        self.assertIn("- Task Status: `__done__`", text)
        self.assertIn(
            "1. [x] Fixed `fixed-1` — Fix source attribution", text
        )
        self.assertIn("`src/a.test.ts`, `src/a.ts`", text)
        self.assertIn("1. [x] `npm test -- a`", text)
        self.assertIn("Pending combined task-up", text)

    def test_refresh_maps_escalation_to_grouped_task_without_duplication(self) -> None:
        plan = self.make_plan()
        upsert_audit_task(plan, self.audit())
        with plan.open("a", encoding="utf-8") as handle:
            handle.write(
                """
### Task 3. Repair grouped review findings

- Task Status: `__to_do__`

#### Addresses Findings

- `escalated-1`
- `another-finding`

#### Subtasks

1. [ ] Repair the shared seam.

#### Testing

1. [ ] Run focused proof.

#### Implementation Notes

- Created by combined task-up.
"""
            )

        result = upsert_audit_task(plan, self.audit())
        replay = upsert_audit_task(plan, self.audit())
        text = plan.read_text(encoding="utf-8")

        self.assertEqual(result["action"], "updated")
        self.assertEqual(replay["action"], "unchanged")
        self.assertIn(
            "Task coverage: Task 3 (Repair grouped review findings)", text
        )
        self.assertEqual(text.count("Review Task Role: `minor_fix_loop_audit`"), 1)
        self.assertEqual(text.count("### Task 3. Repair grouped review findings"), 1)

    def test_first_pass_escalation_survives_four_fast_passes_and_slow_task_up(self) -> None:
        plan = self.make_plan()
        state: dict[str, object] = {
            "story_number": 64,
            "plan_path": "planning/0000064-audit.md",
            "review_cycle_id": "64-rc-20260715T000000Z-aabbccdd",
            "review_pass_id": "64-fast-pass-1",
            "review_phase": "fast",
            "unresolved_minor_batchable_findings": [],
            "unresolved_task_required_findings": [],
            "resolved_minor_findings": [],
            "operationally_blocked_minor_findings": [],
            "rejected_or_non_actionable_findings": [],
        }

        for index in range(1, 5):
            finding_id = f"fixed-{index}"
            state["resolved_minor_findings"].append(
                {
                    "id": finding_id,
                    "repository": "current_repository",
                    "summary": f"Fixed item {index}",
                    "review_sources": [self.source()],
                }
            )
            state = sync_minor_fix_audit(
                state,
                {
                    "story_number": "64",
                    "plan_path": "planning/0000064-audit.md",
                    "review_pass_id": "64-fast-pass-1",
                    "finding_id": finding_id,
                    "repository": "current_repository",
                    "status": "fixed",
                    "summary": f"Fixed item {index}",
                    "changed_files": [f"src/fixed-{index}.ts"],
                    "targeted_proof": [
                        {
                            "command": f"npm test -- fixed-{index}",
                            "result": "passed",
                            "notes": "passed",
                        }
                    ],
                    "commit_sha": f"{index}" * 40,
                    "reclassification_reason": None,
                    "blocker": None,
                },
            )

        escalated = {
            "id": "escalated-from-pass-1",
            "repository": "current_repository",
            "summary": "Requires combined task-up",
            "review_sources": [self.source()],
        }
        state["unresolved_task_required_findings"] = [escalated]
        state = sync_minor_fix_audit(
            state,
            {
                "story_number": "64",
                "plan_path": "planning/0000064-audit.md",
                "review_pass_id": "64-fast-pass-1",
                "finding_id": "escalated-from-pass-1",
                "repository": "current_repository",
                "status": "reclassify_task_required",
                "summary": "Requires combined task-up",
                "changed_files": [],
                "targeted_proof": [],
                "commit_sha": None,
                "reclassification_reason": "Needs a broader repair",
                "blocker": None,
            },
        )
        first_pass_audit = copy.deepcopy(state["minor_fix_pass_audits"][0])
        upsert_audit_task(plan, first_pass_audit)

        for later_pass in (2, 3, 4):
            state["review_pass_id"] = f"64-fast-pass-{later_pass}"
            self.assertEqual(
                state["unresolved_task_required_findings"][0]["id"],
                "escalated-from-pass-1",
            )
        state["review_phase"] = "slow"
        state["review_pass_id"] = "64-slow-pass-1"
        self.assertEqual(len(state["minor_fix_pass_audits"]), 1)

        with plan.open("a", encoding="utf-8") as handle:
            handle.write(
                """
### Task 3. Repair grouped slow-finalized findings

- Task Status: `__to_do__`

#### Addresses Findings

- `escalated-from-pass-1`
- `slow-finding`

#### Subtasks

1. [ ] Repair both findings through their shared seam.

#### Testing

1. [ ] Run grouped proof.

#### Implementation Notes

- Created once after slow finalization.
"""
            )
        upsert_audit_task(plan, first_pass_audit)
        text = plan.read_text(encoding="utf-8")

        self.assertIn(
            "Task coverage: Task 3 (Repair grouped slow-finalized findings)", text
        )
        self.assertEqual(text.count("Review Pass Id: `64-fast-pass-1`"), 1)
        self.assertEqual(
            text.count("### Task 3. Repair grouped slow-finalized findings"), 1
        )


if __name__ == "__main__":
    unittest.main()
