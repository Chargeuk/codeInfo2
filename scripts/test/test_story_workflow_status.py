#!/usr/bin/env python3
"""Focused tests for story_workflow_status.py."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import story_workflow_status


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=check,
        capture_output=True,
        text=True,
    )


class StoryWorkflowStatusTests(unittest.TestCase):
    def make_repo(
        self,
        *,
        plan_content: str,
        branch: str = "feature/0000123-sample-story",
        additional_repo_branch: str = "feature/0000123-sample-story",
        add_review_state: bool = False,
        review_state: dict[str, object] | None = None,
        create_additional_repo: bool = False,
    ) -> tuple[Path, str]:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        root = Path(tmpdir.name)
        repo = root / "working-repo"
        repo.mkdir()
        git(repo, "init", "-b", branch)
        git(repo, "config", "user.name", "Test User")
        git(repo, "config", "user.email", "test@example.com")

        plan_path = repo / "planning" / "0000123-sample-story.md"
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(textwrap.dedent(plan_content).lstrip())
        (repo / "README.md").write_text("sample\n")
        git(repo, "add", ".")
        git(repo, "commit", "-m", "initial")

        additional_repositories = []
        if create_additional_repo:
            additional_repo = root / "other-repo"
            additional_repo.mkdir()
            git(additional_repo, "init", "-b", additional_repo_branch)
            git(additional_repo, "config", "user.name", "Test User")
            git(additional_repo, "config", "user.email", "test@example.com")
            (additional_repo / "README.md").write_text("other\n")
            git(additional_repo, "add", "README.md")
            git(additional_repo, "commit", "-m", "initial")
            additional_repositories.append({"path": str(additional_repo)})

        flow_state = repo / "codeInfoStatus" / "flow-state"
        flow_state.mkdir(parents=True, exist_ok=True)
        handoff_path = flow_state / "current-plan.json"
        handoff_path.write_text(
            json.dumps(
                {
                    "plan_path": "planning/0000123-sample-story.md",
                    "additional_repositories": additional_repositories,
                },
                indent=2,
            )
        )

        if add_review_state:
            review_state_payload = {
                "story_number": "0000123",
                "plan_path": "planning/0000123-sample-story.md",
                "review_cycle_id": "0000123-rc-20260428T161530Z-1eb771da",
            }
            if review_state is not None:
                review_state_payload.update(review_state)
            (flow_state / "review-disposition-state.json").write_text(
                json.dumps(review_state_payload, indent=2)
            )

        return repo, str(handoff_path.relative_to(repo))

    def test_reports_story_complete_with_matching_scope(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done
            """
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["scope_valid"])
        self.assertTrue(status["all_tasks_done"])
        self.assertTrue(status["story_complete"])
        self.assertEqual(status["final_task_status"], "__done__")
        self.assertEqual(status["current_repository"]["branch"], "feature/0000123-sample-story")

    def test_reports_branch_mismatch_as_scope_invalid(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__in_progress__`
            """,
            branch="feature/not-the-story",
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["scope_valid"])
        self.assertEqual(status["scope_failure_reason"], "repository_branch_mismatch")
        self.assertTrue(status["repair_needed"])
        self.assertEqual(
            status["repair_action"], "normalize_scope_then_refresh_handoff"
        )

    def test_reports_overlapping_story_number_as_scope_invalid(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__in_progress__`
            """,
            branch="feature/0000158-not-the-story",
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["scope_valid"])
        self.assertEqual(status["scope_failure_reason"], "repository_branch_mismatch")
        self.assertEqual(
            status["current_repository"]["parsed_branch_story_number"], "0000158"
        )

    def test_reports_additional_repository_scope_drift(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__in_progress__`
            """,
            create_additional_repo=True,
            additional_repo_branch="feature/not-the-story",
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["scope_valid"])
        self.assertEqual(status["scope_failure_reason"], "repository_branch_mismatch")
        self.assertEqual(len(status["additional_repositories"]), 1)

    def test_missing_review_state_requires_review_repair_only(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__in_progress__`
            """
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["scope_valid"])
        self.assertFalse(status["repair_needed"])
        self.assertTrue(status["review_state_repair_needed"])
        self.assertEqual(
            status["review_state_repair_action"], "rebuild_review_disposition_state"
        )

    def test_malformed_handoff_requires_handoff_regeneration(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__in_progress__`
            """
        )
        (repo / handoff).write_text("{ not json")

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["scope_valid"])
        self.assertTrue(status["repair_needed"])
        self.assertEqual(status["repair_action"], "regenerate_current_plan_handoff")
        self.assertEqual(status["repair_reason"], "handoff_invalid")

    def test_missing_plan_requires_handoff_refresh(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__in_progress__`
            """
        )
        (repo / "planning" / "0000123-sample-story.md").unlink()

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["scope_valid"])
        self.assertTrue(status["repair_needed"])
        self.assertEqual(status["repair_action"], "refresh_current_plan_handoff")
        self.assertEqual(status["repair_reason"], "plan_missing")

    def test_uses_review_state_to_drive_review_loop_flags(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`

            #### Subtasks

            1. [x] Done

            #### Testing

            1. [x] Done
            """,
            add_review_state=True,
            review_state={
                "review_created_tasks_added_or_updated": True,
                "needs_review_rerun_before_close": False,
                "needs_final_minor_fix_revalidation_task": False,
                "safe_to_exit_review_loop_without_tasking": False,
            },
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["review_state_present"])
        self.assertTrue(status["review_state_valid"])
        self.assertTrue(status["should_exit_review_loop_to_main_loop"])
        self.assertFalse(status["should_finish_review_loop_cleanly"])

    def test_review_loop_clean_exit_requires_safe_to_exit_flag(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`
            """,
            add_review_state=True,
            review_state={
                "review_created_tasks_added_or_updated": False,
                "needs_review_rerun_before_close": False,
                "needs_final_minor_fix_revalidation_task": False,
                "safe_to_exit_review_loop_without_tasking": False,
            },
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertFalse(status["should_finish_review_loop_cleanly"])

        review_state_path = (
            repo / "codeInfoStatus" / "flow-state" / "review-disposition-state.json"
        )
        payload = json.loads(review_state_path.read_text())
        payload["safe_to_exit_review_loop_without_tasking"] = True
        review_state_path.write_text(json.dumps(payload, indent=2))

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["should_finish_review_loop_cleanly"])

    def test_review_state_story_mismatch_requires_rebuild(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`
            """,
            add_review_state=True,
            review_state={"story_number": "0000999"},
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["scope_valid"])
        self.assertTrue(status["review_state_repair_needed"])
        self.assertEqual(
            status["review_state_repair_reason"], "review_state_story_mismatch"
        )
        self.assertFalse(status["review_state_valid"])

    def test_review_state_plan_mismatch_requires_rebuild(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`
            """,
            add_review_state=True,
            review_state={"plan_path": "planning/0000124-other-story.md"},
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["scope_valid"])
        self.assertTrue(status["review_state_repair_needed"])
        self.assertEqual(
            status["review_state_repair_reason"], "review_state_plan_mismatch"
        )
        self.assertFalse(status["review_state_valid"])

    def test_invalid_review_cycle_id_requires_rebuild(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`
            """,
            add_review_state=True,
            review_state={"review_cycle_id": "cycle-1"},
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["scope_valid"])
        self.assertTrue(status["review_state_repair_needed"])
        self.assertEqual(status["review_state_repair_reason"], "review_cycle_id_invalid")
        self.assertFalse(status["review_state_valid"])

    def test_non_boolean_review_flags_require_rebuild(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`
            """,
            add_review_state=True,
            review_state={
                "review_created_tasks_added_or_updated": "false",
                "needs_review_rerun_before_close": False,
                "needs_final_minor_fix_revalidation_task": False,
                "safe_to_exit_review_loop_without_tasking": False,
            },
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["scope_valid"])
        self.assertTrue(status["review_state_repair_needed"])
        self.assertEqual(
            status["review_state_repair_reason"], "review_state_flag_type_invalid"
        )
        self.assertFalse(status["review_state_valid"])

    def test_missing_review_flags_require_rebuild(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__done__`
            """,
            add_review_state=True,
            review_state={
                "review_created_tasks_added_or_updated": False,
                "needs_review_rerun_before_close": False,
                "needs_final_minor_fix_revalidation_task": False,
                "safe_to_exit_review_loop_without_tasking": False,
            },
        )

        review_state_path = repo / "codeInfoStatus" / "flow-state" / "review-disposition-state.json"
        payload = json.loads(review_state_path.read_text())
        del payload["safe_to_exit_review_loop_without_tasking"]
        review_state_path.write_text(json.dumps(payload, indent=2))

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["scope_valid"])
        self.assertTrue(status["review_state_repair_needed"])
        self.assertEqual(
            status["review_state_repair_reason"], "review_state_flag_type_invalid"
        )
        self.assertFalse(status["review_state_valid"])

    def test_malformed_review_state_requires_rebuild(self) -> None:
        repo, handoff = self.make_repo(
            plan_content="""
            ### Task 1. First

            - Task Status: `__in_progress__`
            """,
            add_review_state=True,
        )
        (repo / "codeInfoStatus" / "flow-state" / "review-disposition-state.json").write_text(
            "{ not json"
        )

        status = story_workflow_status.get_story_workflow_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["scope_valid"])
        self.assertTrue(status["review_state_repair_needed"])
        self.assertEqual(
            status["review_state_repair_action"], "rebuild_review_disposition_state"
        )


if __name__ == "__main__":
    unittest.main()
