#!/usr/bin/env python3
"""Focused tests for agent_work_context.py."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "agent_work_context.py"
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import agent_work_context


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )


class AgentWorkContextTests(unittest.TestCase):
    def make_repo(
        self,
        *,
        branch: str = "feature/0000123-sample-story",
        review_state: bool = True,
    ) -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name) / "repo"
        repo.mkdir()
        git(repo, "init", "-b", branch)
        git(repo, "config", "user.name", "Test User")
        git(repo, "config", "user.email", "test@example.com")

        plan_path = repo / "planning" / "0000123-sample-story.md"
        plan_path.parent.mkdir(parents=True)
        plan_path.write_text(
            textwrap.dedent(
                """
                ### Task 1. Implement sample

                - Task Status: `__in_progress__`

                #### Subtasks

                1. [x] Finished
                2. [ ] Remaining

                #### Testing

                1. [ ] Run proof

                #### Implementation Notes

                - Work started.
                """
            ).lstrip()
        )
        flow_state = repo / "codeInfoStatus" / "flow-state"
        flow_state.mkdir(parents=True)
        plan_relative = "planning/0000123-sample-story.md"
        (flow_state / "current-plan.json").write_text(
            json.dumps({"plan_path": plan_relative}, indent=2)
        )
        (flow_state / "current-task.json").write_text(
            json.dumps(
                {
                    "plan_path": plan_relative,
                    "selection_status": "resolved",
                    "selection_reason": "reused_single_in_progress",
                    "selected_task": {
                        "number": 1,
                        "title": "Implement sample",
                        "status": "__in_progress__",
                    },
                },
                indent=2,
            )
        )
        if review_state:
            (flow_state / "review-disposition-state.json").write_text(
                json.dumps(
                    {
                        "story_number": "0000123",
                        "plan_path": plan_relative,
                        "review_cycle_id": "0000123-rc-20260711T120000Z-12345678",
                        "review_created_tasks_added_or_updated": False,
                        "needs_review_rerun_before_close": True,
                        "needs_final_minor_fix_revalidation_task": False,
                        "safe_to_exit_review_loop_without_tasking": False,
                    },
                    indent=2,
                )
            )
        git(repo, "add", ".")
        git(repo, "commit", "-m", "initial")
        return repo

    def test_current_task_view_is_compact_and_task_specific(self) -> None:
        repo = self.make_repo()

        output = agent_work_context.build_agent_work_context(
            view="current_task",
            agent_type="coding_agent_lite",
            identifier="lite_coder",
            repo_root=repo,
        )

        self.assertTrue(output["context_valid"])
        self.assertEqual(output["repository"]["dirty"], False)
        self.assertEqual(output["story"]["number"], "0000123")
        self.assertEqual(output["task"]["number"], 1)
        self.assertEqual(output["task"]["unchecked_subtasks"], 1)
        self.assertEqual(output["task"]["unchecked_testing"], 1)
        self.assertEqual(output["task"]["blocked"], False)
        self.assertNotIn("schema_version", output)
        self.assertNotIn("next", output)
        self.assertNotIn("additional_repositories", output)
        self.assertNotIn("review", output)

    def test_git_output_handles_success_failure_and_timeout(self) -> None:
        repo = self.make_repo()

        self.assertTrue(agent_work_context.git_output(repo, "rev-parse", "HEAD"))
        self.assertIsNone(
            agent_work_context.git_output(repo, "rev-parse", "missing-ref")
        )
        with mock.patch.object(
            agent_work_context.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(cmd="git", timeout=10),
        ) as run:
            self.assertIsNone(agent_work_context.git_output(repo, "status"))
        self.assertEqual(
            run.call_args.kwargs["timeout"],
            agent_work_context.GIT_COMMAND_TIMEOUT_SECONDS,
        )

    def test_story_view_omits_task_and_review_state(self) -> None:
        repo = self.make_repo()

        output = agent_work_context.build_agent_work_context(
            view="story",
            agent_type="planning_agent",
            identifier="planner",
            repo_root=repo,
        )

        self.assertTrue(output["context_valid"])
        self.assertNotIn("task", output)
        self.assertNotIn("review", output)

    def test_review_view_reports_only_compact_review_flags(self) -> None:
        repo = self.make_repo()

        output = agent_work_context.build_agent_work_context(
            view="review",
            agent_type="planning_agent",
            identifier="planner",
            repo_root=repo,
        )

        self.assertTrue(output["context_valid"])
        self.assertEqual(
            output["review"],
            {
                "cycle_id": "0000123-rc-20260711T120000Z-12345678",
                "state_path": agent_work_context.DEFAULT_REVIEW_STATE,
                "state_valid": True,
                "tasks_added_or_updated": False,
                "needs_rerun": True,
                "needs_final_revalidation": False,
                "safe_to_exit_without_tasking": False,
            },
        )
        self.assertNotIn("task", output)

    def test_invalid_scope_explains_mismatch_without_exposing_a_task(self) -> None:
        repo = self.make_repo(branch="feature/0000999-wrong-story")

        output = agent_work_context.build_agent_work_context(
            view="current_task",
            agent_type="coding_agent",
            identifier="coder",
            repo_root=repo,
        )

        self.assertFalse(output["context_valid"])
        self.assertEqual(
            output["context_error"], {"reason": "repository_branch_mismatch"}
        )
        self.assertEqual(output["repository"]["story_number_matches"], False)
        self.assertNotIn("task", output)

    def test_cli_emits_json_and_keeps_invalid_context_non_fatal(self) -> None:
        repo = self.make_repo(review_state=False)

        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--view",
                "review",
                "--agent-type",
                "review_agent",
                "--identifier",
                "reviewer",
            ],
            cwd=repo,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0)
        output = json.loads(result.stdout)
        self.assertFalse(output["context_valid"])
        self.assertEqual(
            output["context_error"], {"reason": "review_state_missing"}
        )


if __name__ == "__main__":
    unittest.main()
