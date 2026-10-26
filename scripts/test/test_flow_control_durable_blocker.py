#!/usr/bin/env python3
"""Disk-backed regression tests for the post-repair durable story exit."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_story_workflow_status as workflow_fixtures
from flow_control import story


class DurableStoryBlockerTests(unittest.TestCase):
    def task(
        self, number=1, status="__in_progress__", *, blocker=False, notes="", dependencies=None
    ):
        """Render task metadata and obligations for a disk-backed story fixture."""
        checked = "x" if status == "__done__" else " "
        return (
            f"### Task {number}. Work {number}\n\n"
            f"- Task Status: `{status}`\n\n"
            + (f"- Task Dependencies: {dependencies}\n\n" if dependencies is not None else "")
            + f"#### Subtasks\n\n1. [{checked}] Implement\n\n"
            f"#### Testing\n\n1. [{checked}] Required proof\n\n"
            "#### Implementation Notes\n\n"
            + (
                "- **BLOCKER** External provider requires human authority.\n"
                if blocker else ""
            )
            + notes + "\n"
        )

    def make_repo(self, content=None, **kwargs):
        """Create an isolated repository using the shared workflow fixture."""
        repo, _ = workflow_fixtures.StoryWorkflowStatusTests.make_repo(
            self,
            plan_content=content if content is not None else self.task(blocker=True),
            **kwargs,
        )
        return repo

    def wrapper(self, repo, script="check_story_has_durable_blocker.py", answer="no"):
        """Assert the script answer and return its diagnostic reason and details."""
        debug_dir = repo / "debug"
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "flow_control" / script)],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "CODEINFO_FLOW_CONTROL_DEBUG_DIR": str(debug_dir)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(result.stdout, f'{{"answer":"{answer}"}}\n')
        return json.loads((debug_dir / f"{Path(script).stem}.json").read_text())

    def test_all_complete_without_current_task_continues_even_with_pending_review(self):
        repo = self.make_repo(self.task(status="__done__"))
        self.assertFalse((repo / "codeInfoStatus/flow-state/current-task.json").exists())
        self.assertEqual(self.wrapper(repo)["reason_code"], "story_complete")
        # Pending review settlement cannot turn completed implementation into a blocker.
        (repo / "codeInfoStatus/flow-state/active-review-cycle.json").write_text(
            json.dumps({
                "schema_version": "codeinfo-active-review-cycle/v2",
                "review_cycle_id": "0000123-rc-20260721T120000Z-aabbccdd",
                "review_mode": "final",
                "story_id": "0000123",
                "plan_path": "planning/0000123-sample-story.md",
                "status": "incomplete",
                "created_at": "2026-07-21T12:00:00Z",
                "completed_at": "2026-07-21T12:05:00Z",
                "incomplete_reason": "Settlement pending.",
            })
        )
        status = story.story_workflow_status.get_story_workflow_status(repo_root=repo)
        self.assertTrue(status["story_complete"])
        self.assertFalse(status["review_settlement_complete"])
        self.assertEqual(self.wrapper(repo)["reason_code"], "story_complete")

    def test_no_blocker_and_historical_or_resolved_markers_continue(self):
        for notes in (
            "", "- **RESOLVED ISSUE** Former blocker.\n",
            "- **BLOCKING ANSWER** Repair is actionable.\n",
            "> - **BLOCKER** Historical quotation.\n",
        ):
            with self.subTest(notes=notes):
                repo = self.make_repo(self.task(notes=notes))
                self.assertEqual(self.wrapper(repo)["reason_code"], "no_live_blockers")

    def test_genuine_retained_blockers_preserve_unchecked_obligations(self):
        for content in (
            self.task(blocker=True),
            self.task(status="__done__") + self.task(2, blocker=True),
            self.task(blocker=True) + self.task(2, "__to_do__", blocker=True),
        ):
            with self.subTest(content=content):
                repo = self.make_repo(content)
                plan = repo / "planning/0000123-sample-story.md"
                before = plan.read_bytes()
                result = self.wrapper(repo, answer="yes")
                self.assertEqual(result["reason_code"], "story_durably_blocked_after_repair")
                self.assertTrue(all(
                    task["testing_unchecked"] for task in result["details"]["tasks"]
                ))
                self.assertEqual(plan.read_bytes(), before)

    def test_independent_unfinished_or_repaired_prerequisite_prevents_exit(self):
        for content, reason in (
            (self.task(blocker=True) + self.task(2, "__to_do__"),
             "unfinished_unblocked_tasks_remain"),
            (self.task() + self.task(2, "__to_do__", blocker=True),
             "unfinished_unblocked_tasks_remain"),
            (self.task(notes="- **RESOLVED ISSUE** Same-task repair is executable.\n"),
             "no_live_blockers"),
        ):
            with self.subTest(content=content):
                repo = self.make_repo(content)
                self.assertEqual(self.wrapper(repo)["reason_code"], reason)

    def test_blocked_dependencies_allow_exit_without_duplicate_blocker_markers(self):
        """Direct, chained and multiple dependencies inherit a retained blocker."""
        for content in (
            self.task(blocker=True) + self.task(2, "__to_do__", dependencies="`1`"),
            # Reverse dependency order requires more than one propagation pass.
            self.task(blocker=True)
            + self.task(2, "__to_do__", dependencies="Task 3")
            + self.task(3, "__to_do__", dependencies="Task 1"),
            self.task(blocker=True) + self.task(2, "__done__")
            + self.task(3, "__to_do__", dependencies="`Task 1`, `Task 2`"),
        ):
            with self.subTest(content=content):
                repo = self.make_repo(content)
                plan = repo / "planning/0000123-sample-story.md"
                before = plan.read_bytes()
                result = self.wrapper(repo, answer="yes")
                self.assertEqual(result["reason_code"], "story_durably_blocked_after_repair")
                self.assertEqual(plan.read_bytes(), before)

    def test_dependencies_do_not_hide_independent_or_ready_work(self):
        """Independent work and work with completed prerequisites prevent exit."""
        for content in (
            self.task(blocker=True)
            + self.task(2, "__to_do__", dependencies="1") + self.task(3, "__to_do__"),
            self.task(blocker=True) + self.task(2, "__done__")
            + self.task(3, "__to_do__", dependencies="Task 2"),
            self.task(blocker=True) + self.task(2, "__to_do__", dependencies="None"),
            self.task(blocker=True) + self.task(2, "__to_do__", dependencies="3")
            + self.task(3, "__to_do__", dependencies="2"),
        ):
            with self.subTest(content=content):
                repo = self.make_repo(content)
                self.assertEqual(
                    self.wrapper(repo)["reason_code"], "unfinished_unblocked_tasks_remain"
                )

    def test_unverified_dependencies_require_repair_instead_of_exit(self):
        """Unknown task references and ambiguous dependency text cannot prove blocking."""
        for dependencies in ("99", "1, 99", "Task 1 or Task 2", "previous tasks", "0"):
            with self.subTest(dependencies=dependencies):
                repo = self.make_repo(
                    self.task(blocker=True)
                    + self.task(2, "__to_do__", dependencies=dependencies)
                )
                result = self.wrapper(repo)
                self.assertEqual(result["reason_code"], "story_task_state_repair_needed")
                self.assertEqual(result["details"]["issue"], "task_dependencies_unreadable")

    def test_missing_malformed_handoff_plan_and_task_state_need_repair(self):
        mutations = (
            ("codeInfoStatus/flow-state/current-plan.json", None),
            ("codeInfoStatus/flow-state/current-plan.json", "{"),
            ("codeInfoStatus/flow-state/current-plan.json", "[]"),
            ("codeInfoStatus/flow-state/current-plan.json", '{"plan_path":42}'),
            ("codeInfoStatus/flow-state/current-plan.json", json.dumps({
                "plan_path": "planning/0000123-sample-story.md",
                "additional_repositories": [{}],
            })),
            ("planning/0000123-sample-story.md", None),
            ("planning/0000123-sample-story.md", "# No tasks\n"),
            ("planning/0000123-sample-story.md", "### Task 1. No status\n- **BLOCKER** External\n"),
            ("planning/0000123-sample-story.md", self.task(status="__unknown__", blocker=True)),
            ("planning/0000123-sample-story.md", self.task(blocker=True) * 2),
            ("planning/0000123-sample-story.md", self.task(0, blocker=True)),
        )
        for relative_path, content in mutations:
            with self.subTest(path=relative_path, content=content):
                repo = self.make_repo()
                target = repo / relative_path
                if content is None:
                    target.unlink()
                else:
                    target.write_text(content)
                result = self.wrapper(repo)
                self.assertIn("repair_needed", result["reason_code"])

    def test_invalid_repository_scope_is_not_a_blocker(self):
        repo = self.make_repo(branch="feature/0000999-other-story")
        result = self.wrapper(repo)
        self.assertEqual(result["reason_code"], "story_scope_repair_needed")
        self.assertEqual(result["details"]["repair_reason"], "repository_branch_mismatch")

    def test_done_task_with_open_obligations_is_contradictory(self):
        for done in (
            self.task(status="__done__", blocker=True),
            self.task(status="__done__").replace("[x] Required proof", "[ ] Required proof"),
            self.task(status="__done__").replace("[x] Implement", "[ ] Implement"),
        ):
            with self.subTest(done=done):
                # Cover an all-done plan with open obligations as well as a
                # contradictory completed task alongside retained blocked work.
                for content in (done, done + self.task(2, blocker=True)):
                    repo = self.make_repo(content)
                    result = self.wrapper(repo)
                    self.assertEqual(result["reason_code"], "story_task_state_repair_needed")
                    self.assertEqual(result["details"]["issue"], "done_task_has_open_obligations")

    def test_task_level_helper_still_treats_missing_current_task_as_blocked(self):
        repo = self.make_repo(self.task(status="__done__"))
        self.wrapper(repo)
        result = self.wrapper(repo, "check_current_task_has_blocker.py", answer="yes")
        self.assertEqual(result["reason_code"], "current_task_unreadable")
        current_task = repo / "codeInfoStatus/flow-state/current-task.json"
        current_task.write_text("{")
        self.wrapper(repo)
        self.wrapper(repo, "check_current_task_has_blocker.py", answer="yes")
        current_task.write_text(json.dumps({"selected_task": {"number": 1}}))
        self.wrapper(repo, "check_current_task_has_blocker.py", answer="no")
        (repo / "planning/0000123-sample-story.md").write_text(self.task(blocker=True))
        self.wrapper(repo, "check_current_task_has_blocker.py", answer="yes")


if __name__ == "__main__":
    unittest.main()
