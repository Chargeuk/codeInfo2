#!/usr/bin/env python3
"""Focused tests for review-loop deterministic flow control."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import review


class FlowControlReviewTests(unittest.TestCase):
    REVIEW_PASS_ID = "0000001-20260714T000000Z-decision"
    REVIEW_CYCLE_ID = "0000001-rc-20260714T000000Z-decision"

    def make_repo(
        self,
        *,
        review_state: dict[str, object] | None,
        minor_fix_result: dict[str, object] | None = None,
        active_cycle: dict[str, object] | None = None,
    ) -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        flow_state = repo / "codeInfoStatus" / "flow-state"
        flow_state.mkdir(parents=True, exist_ok=True)

        if review_state is not None:
            (flow_state / "review-disposition-state.json").write_text(
                json.dumps(review_state, indent=2)
            )
        if minor_fix_result is not None:
            (flow_state / "minor-review-fix-result.json").write_text(
                json.dumps(minor_fix_result, indent=2)
            )
        if active_cycle is not None:
            (flow_state / "active-review-cycle.json").write_text(
                json.dumps(active_cycle, indent=2)
            )
        return repo

    def write_plan_handoff(
        self,
        repo: Path,
        *,
        plan_text: str,
        commit: bool = True,
    ) -> Path:
        plan_path = Path("planning/0000001-review-decisions.md")
        resolved_plan = repo / plan_path
        resolved_plan.parent.mkdir(parents=True, exist_ok=True)
        resolved_plan.write_text(plan_text)
        flow_state = repo / "codeInfoStatus" / "flow-state"
        (flow_state / "current-plan.json").write_text(
            json.dumps({"plan_path": str(plan_path)}, indent=2)
        )

        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        subprocess.run(
            ["git", "config", "user.email", "tests@example.com"],
            cwd=repo,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Flow Tests"], cwd=repo, check=True
        )
        subprocess.run(["git", "add", "."], cwd=repo, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "fixture"], cwd=repo, check=True
        )
        if not commit:
            resolved_plan.write_text("Uncommitted change.\n\n" + plan_text)
        return resolved_plan

    def structured_review_block(self) -> str:
        return f"""# Story

## Code Review Findings

- Review pass: `{self.REVIEW_PASS_ID}`
- Review cycle: `{self.REVIEW_CYCLE_ID}`
- Comparison context: local `HEAD` `abc` versus resolved base `origin/main@def`.

### Accepted

#### 1. Example

- Finding ID: `finding-1`
- Found by: Codex Review (current_repository), Open Code Review (current_repository)
- Description: A simple problem.
- Example: The example demonstrates the problem.
- Why accepted: The issue belongs to this story.

### Ignored for This Story

- None.
"""

    def ignored_only_review_block(self) -> str:
        return f"""# Story

## Code Review Findings

- Review pass: `{self.REVIEW_PASS_ID}`
- Review cycle: `{self.REVIEW_CYCLE_ID}`
- Comparison context: local `HEAD` `abc` versus resolved base `origin/main@def`.

### Accepted

- None.

### Ignored for This Story

#### 1. Out-of-scope suggestion

- Finding ID or Review reference: `ignored-1`
- Found by: `external-review-note-1`
- Description: The suggestion changes unrelated behavior.
- Example: It asks for a separate user interface change.
- Why ignored: That behavior is outside this story.
"""

    def update_review_state(self, repo: Path, **updates: object) -> None:
        state_path = (
            repo / "codeInfoStatus" / "flow-state" / "review-disposition-state.json"
        )
        payload = json.loads(state_path.read_text())
        payload.update(updates)
        state_path.write_text(json.dumps(payload, indent=2))

    def plan_commit_sha(self, repo: Path) -> str:
        return subprocess.run(
            [
                "git",
                "log",
                "-1",
                "--format=%H",
                "--",
                "planning/0000001-review-decisions.md",
            ],
            cwd=repo,
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        ).stdout.strip()

    def run_in_repo(self, repo: Path, fn):
        original_cwd = Path.cwd()
        self.addCleanup(os.chdir, original_cwd)
        os.chdir(repo)
        return fn()

    def test_missing_review_state_exits_minor_fix_path_conservatively(self) -> None:
        repo = self.make_repo(review_state=None)

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "review_state_unreadable")

    def test_fast_review_exits_early_when_current_pass_had_no_minor_findings(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 2,
                "fast_reviewed_pass_ids": ["pass-1", "pass-2"],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_reviewer_count": 2,
                "fast_current_pass_passed_reviewer_count": 2,
                "fast_current_pass_reviewers_complete": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "fast_review_converged_without_minor_findings"
        )

    def test_fast_review_does_not_claim_convergence_from_non_fast_phase(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "slow",
                "fast_phase_complete": True,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "fast_review_phase_not_active")

    def test_fast_review_requires_current_cycle_and_recorded_current_pass(self) -> None:
        repo = self.make_repo(
            review_state={
                "story_number": "0000001",
                "plan_path": "planning/0000001-story.md",
                "review_phase": "fast",
                "fast_review_pass_count": 1,
                "fast_reviewed_pass_ids": [self.REVIEW_PASS_ID],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_job_count": 1,
                "fast_current_pass_completed_job_count": 1,
                "fast_current_pass_partial_job_count": 0,
                "fast_current_pass_failed_job_count": 0,
                "fast_current_pass_missing_job_count": 0,
                "fast_current_pass_coverage_complete": True,
                "fast_current_pass_coverage_trusted": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "review_decision_recording": {
                    "review_pass_id": self.REVIEW_PASS_ID,
                    "outcome": "retry_required",
                },
            },
            active_cycle={
                "review_mode": "final",
                "story_id": "0000001",
                "plan_path": "planning/0000001-story.md",
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            },
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "fast_review_counter_state_invalid")

    def test_fast_review_repeats_before_fifth_pass_after_draining_findings(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 4,
                "fast_reviewed_pass_ids": ["pass-1", "pass-2", "pass-3", "pass-4"],
                "fast_current_pass_minor_count_before_fix": 3,
                "fast_current_pass_expected_reviewer_count": 2,
                "fast_current_pass_passed_reviewer_count": 2,
                "fast_current_pass_reviewers_complete": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "fast_review_requires_another_pass")

    def test_fast_review_exits_after_draining_fifth_pass(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 5,
                "fast_reviewed_pass_ids": [
                    "pass-1",
                    "pass-2",
                    "pass-3",
                    "pass-4",
                    "pass-5",
                ],
                "fast_current_pass_minor_count_before_fix": 2,
                "fast_current_pass_expected_reviewer_count": 2,
                "fast_current_pass_passed_reviewer_count": 2,
                "fast_current_pass_reviewers_complete": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "fast_review_fifth_pass_drained")

    def test_fast_review_does_not_exit_while_minor_queue_remains(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 5,
                "fast_reviewed_pass_ids": [
                    "pass-1",
                    "pass-2",
                    "pass-3",
                    "pass-4",
                    "pass-5",
                ],
                "fast_current_pass_minor_count_before_fix": 1,
                "fast_current_pass_expected_reviewer_count": 2,
                "fast_current_pass_passed_reviewer_count": 2,
                "fast_current_pass_reviewers_complete": True,
                "needs_minor_fix_path": True,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "fast_review_minor_findings_not_drained")

    def test_fast_review_repeats_while_candidates_are_deferred(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 1,
                "fast_reviewed_pass_ids": ["pass-1"],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_reviewer_count": 2,
                "fast_current_pass_passed_reviewer_count": 2,
                "fast_current_pass_reviewers_complete": True,
                "needs_minor_fix_path": False,
                "deferred_review_candidates": [
                    {"id": "candidate-1", "summary": "Deferred candidate"}
                ],
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "fast_review_candidates_deferred")

    def test_fast_review_retries_incomplete_reviewer_coverage(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 4,
                "fast_reviewed_pass_ids": ["pass-1", "pass-2", "pass-3", "pass-4"],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_reviewer_count": 2,
                "fast_current_pass_passed_reviewer_count": 1,
                "fast_current_pass_reviewers_complete": False,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(
            outcome.reason_code, "fast_review_requires_complete_job_coverage"
        )

    def test_fast_review_stops_retrying_incomplete_coverage_after_fifth_pass(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 5,
                "fast_reviewed_pass_ids": [
                    "pass-1",
                    "pass-2",
                    "pass-3",
                    "pass-4",
                    "pass-5",
                ],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_reviewer_count": 2,
                "fast_current_pass_passed_reviewer_count": 0,
                "fast_current_pass_reviewers_complete": False,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "fast_review_fifth_pass_coverage_exhausted"
        )

    def test_fast_review_rejects_inconsistent_reviewer_coverage_state(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 1,
                "fast_reviewed_pass_ids": ["pass-1"],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_reviewer_count": 2,
                "fast_current_pass_passed_reviewer_count": 1,
                "fast_current_pass_reviewers_complete": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "fast_review_counter_state_invalid")

    def test_fast_review_accepts_complete_manifest_driven_wave_coverage(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 2,
                "fast_reviewed_pass_ids": ["pass-1", "pass-2"],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_job_count": 5,
                "fast_current_pass_completed_job_count": 5,
                "fast_current_pass_partial_job_count": 0,
                "fast_current_pass_failed_job_count": 0,
                "fast_current_pass_missing_job_count": 0,
                "fast_current_pass_coverage_complete": True,
                "fast_current_pass_coverage_trusted": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "fast_review_converged_without_minor_findings"
        )

    def test_fast_review_retries_incomplete_manifest_driven_wave_coverage(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 4,
                "fast_reviewed_pass_ids": ["pass-1", "pass-2", "pass-3", "pass-4"],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_job_count": 5,
                "fast_current_pass_completed_job_count": 4,
                "fast_current_pass_partial_job_count": 0,
                "fast_current_pass_failed_job_count": 0,
                "fast_current_pass_missing_job_count": 1,
                "fast_current_pass_coverage_complete": False,
                "fast_current_pass_coverage_trusted": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(
            outcome.reason_code, "fast_review_requires_complete_job_coverage"
        )

    def test_fast_review_retries_untrusted_wave_coverage(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 1,
                "fast_reviewed_pass_ids": ["pass-1"],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_job_count": 0,
                "fast_current_pass_completed_job_count": 0,
                "fast_current_pass_partial_job_count": 0,
                "fast_current_pass_failed_job_count": 0,
                "fast_current_pass_missing_job_count": 0,
                "fast_current_pass_coverage_complete": False,
                "fast_current_pass_coverage_trusted": False,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(
            outcome.reason_code, "fast_review_requires_complete_job_coverage"
        )

    def test_fast_review_exits_after_fifth_incomplete_wave_with_exhaustion(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 5,
                "fast_reviewed_pass_ids": [
                    "pass-1",
                    "pass-2",
                    "pass-3",
                    "pass-4",
                    "pass-5",
                ],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_job_count": 5,
                "fast_current_pass_completed_job_count": 4,
                "fast_current_pass_partial_job_count": 0,
                "fast_current_pass_failed_job_count": 1,
                "fast_current_pass_missing_job_count": 0,
                "fast_current_pass_coverage_complete": False,
                "fast_current_pass_coverage_trusted": True,
                "fast_review_coverage_exhausted": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "fast_review_fifth_pass_coverage_exhausted"
        )

    def test_fast_review_rejects_inconsistent_wave_job_counts(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_phase": "fast",
                "fast_review_pass_count": 1,
                "fast_reviewed_pass_ids": ["pass-1"],
                "fast_current_pass_minor_count_before_fix": 0,
                "fast_current_pass_expected_job_count": 5,
                "fast_current_pass_completed_job_count": 5,
                "fast_current_pass_partial_job_count": 0,
                "fast_current_pass_failed_job_count": 0,
                "fast_current_pass_missing_job_count": 1,
                "fast_current_pass_coverage_complete": True,
                "fast_current_pass_coverage_trusted": True,
                "needs_minor_fix_path": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )

        outcome = self.run_in_repo(repo, review.check_fast_review_phase_complete)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "fast_review_counter_state_invalid")

    def test_minor_fix_path_continues_when_unresolved_findings_remain(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": False,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )
        self.write_plan_handoff(repo, plan_text=self.structured_review_block())

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "minor_fix_path_still_needed")

    def test_minor_fix_path_exits_when_current_pass_block_is_missing(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": True,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )
        self.write_plan_handoff(repo, plan_text="# Story\n")

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "review_decisions_not_recorded_before_minor_fix"
        )
        self.assertEqual(
            outcome.details["block_reason"], "current_pass_review_block_missing"
        )

    def test_minor_fix_path_exits_when_current_pass_block_is_incomplete(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": True,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )
        self.write_plan_handoff(
            repo,
            plan_text=f"""# Story

## Code Review Findings

- Review pass: `{self.REVIEW_PASS_ID}`
- Review cycle: `{self.REVIEW_CYCLE_ID}`
- Comparison context: local `HEAD` `abc` versus resolved base `origin/main@def`.
""",
        )

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"], "structured_categories_missing"
        )

    def test_minor_fix_path_exits_when_finding_provenance_is_missing(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": True,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )
        plan_text = self.structured_review_block().replace(
            "- Found by: Codex Review (current_repository), Open Code Review (current_repository)\n",
            "",
        )
        self.write_plan_handoff(repo, plan_text=plan_text)

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"], "accepted_issue_detail_missing"
        )

    def test_minor_fix_path_exits_when_current_pass_block_is_uncommitted(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": True,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": True,
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
            }
        )
        self.write_plan_handoff(
            repo, plan_text=self.structured_review_block(), commit=False
        )

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"],
            "structured_review_block_not_committed",
        )

    def test_review_decisions_retry_when_recording_outcome_is_missing(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "review_decision_recording_missing")

    def test_review_decisions_continue_for_confirmed_no_decisions(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [],
                "unresolved_task_required_findings": [],
                "resolved_minor_findings": [{"id": "resolved-earlier-pass"}],
                "rejected_or_non_actionable_findings": [],
                "review_decision_recording": {
                    "review_pass_id": self.REVIEW_PASS_ID,
                    "outcome": "no_decisions",
                    "accepted_count": 0,
                    "ignored_count": 0,
                    "plan_commit_sha": None,
                },
            }
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "review_no_decisions_confirmed")

    def test_review_decisions_retry_when_no_decisions_conflicts_with_ignored_state(
        self,
    ) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [{"id": "ignored-1"}],
                "review_decision_recording": {
                    "review_pass_id": self.REVIEW_PASS_ID,
                    "outcome": "no_decisions",
                    "accepted_count": 0,
                    "ignored_count": 0,
                    "plan_commit_sha": None,
                },
            }
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "review_no_decisions_conflicts_with_state"
        )

    def test_review_decisions_continue_for_committed_ignored_only_block(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [{"id": "ignored-1"}],
            }
        )
        self.write_plan_handoff(repo, plan_text=self.ignored_only_review_block())
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 0,
                "ignored_count": 1,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "review_decisions_ready")

    def test_review_decisions_retry_when_ignored_finding_id_is_duplicated(
        self,
    ) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [{"id": "ignored-1"}],
            }
        )
        duplicate_issue = """

#### 2. Duplicate out-of-scope suggestion

- Finding ID or Review reference: `ignored-1`
- Found by: `external-review-note-1`
- Description: This repeats an earlier ignored entry.
- Example: One rejected suggestion appears twice in the plan.
- Why ignored: The recorder incorrectly duplicated it.
"""
        self.write_plan_handoff(
            repo, plan_text=self.ignored_only_review_block() + duplicate_issue
        )
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 0,
                "ignored_count": 2,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "ignored_review_finding_ids_not_unique"
        )

    def test_review_decisions_retry_for_incomplete_issue_details(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "finding-1"}],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )
        plan_text = self.structured_review_block().replace(
            "- Example: The example demonstrates the problem.\n", ""
        )
        self.write_plan_handoff(repo, plan_text=plan_text)
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 1,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"], "accepted_issue_detail_missing"
        )

    def test_review_decisions_retry_for_unnumbered_issue_title(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "finding-1"}],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )
        plan_text = self.structured_review_block().replace(
            "#### 1. Example", "#### Example"
        )
        self.write_plan_handoff(repo, plan_text=plan_text)
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 1,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"], "accepted_numbered_issue_title_missing"
        )

    def test_review_decisions_retry_for_duplicate_current_pass_blocks(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "finding-1"}],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )
        block = self.structured_review_block()
        self.write_plan_handoff(repo, plan_text=f"{block}\n{block}")
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 1,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"], "duplicate_current_pass_review_blocks"
        )

    def test_review_decisions_retry_for_recording_count_mismatch(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "finding-1"}],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )
        self.write_plan_handoff(repo, plan_text=self.structured_review_block())
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 2,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "review_decision_recording_count_mismatch"
        )

    def test_review_decisions_retry_for_wrong_cycle_metadata(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "finding-1"}],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )
        plan_text = self.structured_review_block().replace(
            self.REVIEW_CYCLE_ID, "0000001-rc-20260714T000000Z-wrong"
        )
        self.write_plan_handoff(repo, plan_text=plan_text)
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 1,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"], "review_cycle_metadata_mismatch"
        )

    def test_review_decisions_retry_when_state_finding_id_is_missing_from_plan(
        self,
    ) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "different-id"}],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )
        self.write_plan_handoff(repo, plan_text=self.structured_review_block())
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 1,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "accepted_review_findings_mismatch_with_plan"
        )

    def test_review_decisions_retry_when_plan_has_extra_accepted_finding(
        self,
    ) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "finding-1"}],
                "unresolved_task_required_findings": [],
                "resolved_minor_findings": [{"id": "finding-resolved"}],
                "rejected_or_non_actionable_findings": [],
            }
        )
        extra_issue = """#### 2. Extra accepted finding

- Finding ID: `finding-extra`
- Found by: Codex Review (current_repository)
- Description: This finding is absent from disposition state.
- Example: The plan lists work that the flow cannot route.
- Why accepted: The recorder incorrectly added it.

"""
        plan_text = self.structured_review_block().replace(
            "### Ignored for This Story", extra_issue + "### Ignored for This Story"
        )
        self.write_plan_handoff(repo, plan_text=plan_text)
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 2,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "accepted_review_findings_mismatch_with_plan"
        )

    def test_review_decisions_allow_resolved_minor_finding_in_recovered_block(
        self,
    ) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [],
                "unresolved_task_required_findings": [],
                "resolved_minor_findings": [{"id": "finding-1"}],
                "rejected_or_non_actionable_findings": [],
            }
        )
        self.write_plan_handoff(repo, plan_text=self.structured_review_block())
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 1,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "review_decisions_ready")

    def test_review_decisions_retry_when_accepted_finding_id_is_duplicated(
        self,
    ) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "finding-1"}],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )
        duplicate_issue = """#### 2. Duplicate accepted finding

- Finding ID: `finding-1`
- Found by: Codex Review (current_repository)
- Description: This finding repeats an earlier accepted entry.
- Example: One routed issue appears twice in the plan.
- Why accepted: The recorder incorrectly duplicated it.

"""
        plan_text = self.structured_review_block().replace(
            "### Ignored for This Story",
            duplicate_issue + "### Ignored for This Story",
        )
        self.write_plan_handoff(repo, plan_text=plan_text)
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 2,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code, "accepted_review_finding_ids_not_unique"
        )

    def test_review_decisions_retry_for_uncommitted_block(self) -> None:
        repo = self.make_repo(
            review_state={
                "review_pass_id": self.REVIEW_PASS_ID,
                "review_cycle_id": self.REVIEW_CYCLE_ID,
                "unresolved_minor_batchable_findings": [{"id": "finding-1"}],
                "unresolved_task_required_findings": [],
                "rejected_or_non_actionable_findings": [],
            }
        )
        self.write_plan_handoff(
            repo, plan_text=self.structured_review_block(), commit=False
        )
        self.update_review_state(
            repo,
            review_decision_recording={
                "review_pass_id": self.REVIEW_PASS_ID,
                "outcome": "recorded",
                "accepted_count": 1,
                "ignored_count": 0,
                "plan_commit_sha": self.plan_commit_sha(repo),
            },
        )

        outcome = self.run_in_repo(repo, review.check_review_decisions_need_retry)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.details["block_reason"],
            "structured_review_block_not_committed",
        )

    def test_after_sync_uses_current_review_state_and_keeps_minor_result_as_context(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": False,
                "needs_task_up_path": False,
                "needs_review_rerun_before_close": False,
            },
            minor_fix_result={"attempted_finding_id": "minor-1", "outcome": "fixed"},
        )

        outcome = self.run_in_repo(repo, review.check_review_minor_fix_path_clear_after_sync)

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "minor_fix_path_clear_after_sync")
        self.assertEqual(outcome.details["minor_fix_result"]["outcome"], "fixed")

    def test_task_up_path_continues_only_when_needed(self) -> None:
        repo = self.make_repo(
            review_state={
                "needs_minor_fix_path": False,
                "needs_task_up_path": True,
                "needs_review_rerun_before_close": False,
            }
        )

        outcome = self.run_in_repo(repo, review.check_review_task_up_path_clear)

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "task_up_path_still_needed")


if __name__ == "__main__":
    unittest.main()
