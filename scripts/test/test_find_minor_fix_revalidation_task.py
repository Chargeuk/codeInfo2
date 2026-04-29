#!/usr/bin/env python3
"""Focused tests for find_minor_fix_revalidation_task.py."""

from __future__ import annotations

import json
import tempfile
import textwrap
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import find_minor_fix_revalidation_task


CYCLE_ONE = "0000123-rc-20260428T161530Z-1eb771da"
CYCLE_OLD = "0000123-rc-20260428T161530Z-aaaaaaaa"
CYCLE_NEW = "0000123-rc-20260428T161530Z-bbbbbbbb"


class FindMinorFixRevalidationTaskTests(unittest.TestCase):
    def make_repo(
        self,
        plan_content: str,
        *,
        review_state: dict[str, object] | None = None,
    ) -> tuple[Path, str]:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        plan_path = repo / "planning" / "0000123-sample-story.md"
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(textwrap.dedent(plan_content).lstrip())
        handoff = repo / "codeInfoStatus" / "flow-state" / "current-plan.json"
        handoff.parent.mkdir(parents=True, exist_ok=True)
        handoff.write_text(
            json.dumps(
                {
                    "plan_path": "planning/0000123-sample-story.md",
                    "additional_repositories": [],
                }
            )
        )
        if review_state is not None:
            review_state_payload = {
                "story_number": "0000123",
                "plan_path": "planning/0000123-sample-story.md",
                "review_cycle_id": "0000123-rc-20260428T161530Z-1eb771da",
            }
            review_state_payload.update(review_state)
            (handoff.parent / "review-disposition-state.json").write_text(
                json.dumps(review_state_payload)
            )
        return repo, str(handoff.relative_to(repo))

    def test_finds_task_by_role_marker(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-1eb771da`
            """,
            review_state={"review_cycle_id": CYCLE_ONE},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertTrue(status["cycle_match_found"])
        self.assertTrue(status["should_reuse_existing_task"])
        self.assertFalse(status["should_reopen_task"])
        self.assertEqual(status["selected_task"]["number"], 4)

    def test_marks_done_task_for_reopen(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 9. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__done__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-1eb771da`
            """,
            review_state={"review_cycle_id": CYCLE_ONE},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertTrue(status["should_reopen_task"])

    def test_ignores_older_review_cycle_task(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 7. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__done__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-aaaaaaaa`

            ### Task 10. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-bbbbbbbb`
            """,
            review_state={"review_cycle_id": CYCLE_NEW},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertEqual(status["selected_task"]["number"], 10)
        self.assertEqual(status["selected_task"]["review_cycle_id"], CYCLE_NEW)

    def test_flags_non_last_task_only_as_warning(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-1eb771da`

            ### Task 5. Follow-up Task

            - Task Status: `__to_do__`
            """,
            review_state={"review_cycle_id": CYCLE_ONE},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertFalse(status["selected_task_is_last_task"])
        self.assertEqual(
            status["plan_order_warning"], "selected_revalidation_task_is_not_last_task"
        )

    def test_safe_single_legacy_task_can_be_backfilled(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            """,
            review_state={"review_cycle_id": CYCLE_NEW},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertFalse(status["cycle_match_found"])
        self.assertTrue(status["should_reuse_existing_task"])
        self.assertTrue(status["needs_cycle_id_backfill"])
        self.assertEqual(status["selected_task"]["number"], 4)

    def test_in_progress_legacy_task_can_be_backfilled(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__in_progress__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            """,
            review_state={"review_cycle_id": CYCLE_NEW},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertFalse(status["cycle_match_found"])
        self.assertTrue(status["should_reuse_existing_task"])
        self.assertTrue(status["needs_cycle_id_backfill"])
        self.assertEqual(status["selected_task"]["number"], 4)

    def test_done_legacy_task_is_ignored_for_backfill(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__done__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            """,
            review_state={"review_cycle_id": CYCLE_NEW},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["match_found"])
        self.assertFalse(status["cycle_match_found"])
        self.assertFalse(status["should_reuse_existing_task"])
        self.assertFalse(status["needs_cycle_id_backfill"])

    def test_duplicate_current_cycle_tasks_require_repair(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-1eb771da`

            ### Task 7. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__done__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-1eb771da`
            """,
            review_state={"review_cycle_id": CYCLE_ONE},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["repair_needed"])
        self.assertEqual(
            status["repair_reason"], "duplicate_current_cycle_revalidation_tasks"
        )
        self.assertFalse(status["match_found"])
        self.assertEqual(len(status["candidate_tasks"]), 2)

    def test_does_not_reuse_historical_cycle_task_for_new_cycle(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 7. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__done__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-aaaaaaaa`
            """,
            review_state={"review_cycle_id": CYCLE_NEW},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["match_found"])
        self.assertFalse(status["should_reuse_existing_task"])
        self.assertFalse(status["needs_cycle_id_backfill"])

    def test_does_not_backfill_legacy_task_when_historical_cycle_task_exists(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`

            ### Task 7. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__done__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            - Review Cycle Id: `0000123-rc-20260428T161530Z-aaaaaaaa`
            """,
            review_state={"review_cycle_id": CYCLE_NEW},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["match_found"])
        self.assertFalse(status["should_reuse_existing_task"])
        self.assertFalse(status["needs_cycle_id_backfill"])

    def test_requests_review_state_repair_when_state_scope_mismatches(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            """,
            review_state={
                "story_number": "0000999",
                "review_cycle_id": CYCLE_OLD,
            },
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["repair_needed"])
        self.assertEqual(status["repair_reason"], "review_state_story_mismatch")

    def test_requests_repair_when_cycle_id_is_invalid(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            """,
            review_state={"review_cycle_id": "cycle-1"},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["repair_needed"])
        self.assertEqual(status["repair_reason"], "review_cycle_id_invalid")

    def test_requests_repair_when_cycle_id_is_missing_but_legacy_task_exists(self) -> None:
        repo, handoff = self.make_repo(
            """
            ### Task 4. Re-Validate Story 123 After Inline Minor Review Fixes

            - Task Status: `__to_do__`

            #### Implementation Notes

            - Review Task Role: `final_minor_fix_revalidation`
            """,
            review_state={"review_cycle_id": ""},
        )

        status = find_minor_fix_revalidation_task.get_revalidation_task_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["match_found"])
        self.assertTrue(status["repair_needed"])
        self.assertEqual(
            status["repair_action"], "rebuild_review_disposition_state"
        )
        self.assertTrue(status["needs_cycle_id_backfill"])


if __name__ == "__main__":
    unittest.main()
