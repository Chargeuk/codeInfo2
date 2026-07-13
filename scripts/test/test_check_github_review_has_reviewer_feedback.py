#!/usr/bin/env python3
"""Focused tests for GitHub review feedback flow-control helper."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = (
    REPO_ROOT / "scripts/flow_control/check_github_review_has_reviewer_feedback.py"
)
PLAN_PATH = (
    "planning/"
    "0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md"
)


class GitHubReviewFeedbackHelperTests(unittest.TestCase):
    def make_repo(self) -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        (repo / "codeInfoStatus/flow-state").mkdir(parents=True, exist_ok=True)
        (repo / "codeInfoTmp/reviews").mkdir(parents=True, exist_ok=True)
        (repo / "codeInfoStatus/flow-state/current-plan.json").write_text(
            json.dumps({"plan_path": PLAN_PATH}, indent=2),
            encoding="utf-8",
        )
        return repo

    def run_helper(
        self, repo: Path, *, env_overrides: dict[str, str] | None = None
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        if env_overrides:
            env.update(env_overrides)
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
            env=env,
        )

    def write_selector_and_handoff(
        self,
        repo: Path,
        *,
        execution_id: str = "exec-1",
        review_count: int = 0,
        comment_count: int = 0,
    ) -> None:
        handoff_path = (
            repo
            / "codeInfoTmp/reviews"
            / f"0000060-github-review-{execution_id}-current.json"
        )
        handoff_path.write_text(
            json.dumps(
                {
                    "handoff_kind": "github-review-handoff-v1",
                    "execution_id": execution_id,
                    "plan_path": PLAN_PATH,
                    "story_number": "0000060",
                    "repository_root": str(repo),
                    "branch_name": "feature/0000060-demo",
                    "head_sha": "deadbeef",
                    "raw_review_artifact_path": str(
                        repo
                        / "codeInfoTmp/reviews"
                        / f"0000060-github-review-{execution_id}-pr-45.json"
                    ),
                    "filtered_review_count": review_count,
                    "filtered_review_comment_count": comment_count,
                    "pull_request": {
                        "number": 45,
                        "url": "https://github.com/example/repo/pull/45",
                        "headRefName": "feature/0000060-demo",
                        "baseRefName": "main",
                    },
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        (
            repo / "codeInfoTmp/reviews/0000060-github-review-current.json"
        ).write_text(
            json.dumps(
                {
                    "selector_kind": "github-review-selector-v1",
                    "execution_id": execution_id,
                    "plan_path": PLAN_PATH,
                    "story_number": "0000060",
                    "repository_root": str(repo),
                    "branch_name": "feature/0000060-demo",
                    "handoff_path": str(handoff_path),
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    def test_uses_selector_owned_execution_scoped_handoff_when_feedback_exists(
        self,
    ) -> None:
        repo = self.make_repo()
        self.write_selector_and_handoff(
            repo, execution_id="exec-1", review_count=1, comment_count=1
        )

        result = self.run_helper(repo)

        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {"answer": "yes"})

    def test_generic_current_review_handoff_is_not_accepted_as_a_fallback(self) -> None:
        repo = self.make_repo()
        (repo / "codeInfoTmp/reviews/0000060-current-review.json").write_text(
            json.dumps(
                {
                    "filtered_review_count": 3,
                    "filtered_review_comment_count": 2,
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        result = self.run_helper(repo)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "0000060-github-review-current.json",
            result.stderr,
        )

    def test_rejects_selector_that_points_at_a_foreign_execution_scoped_handoff(
        self,
    ) -> None:
        repo = self.make_repo()
        self.write_selector_and_handoff(
            repo, execution_id="exec-2", review_count=0, comment_count=1
        )
        (
            repo / "codeInfoTmp/reviews/0000060-github-review-current.json"
        ).write_text(
            json.dumps(
                {
                    "selector_kind": "github-review-selector-v1",
                    "execution_id": "exec-1",
                    "plan_path": PLAN_PATH,
                    "story_number": "0000060",
                    "repository_root": str(repo),
                    "branch_name": "feature/0000060-demo",
                    "handoff_path": str(
                        repo
                        / "codeInfoTmp/reviews/0000060-github-review-exec-2-current.json"
                    ),
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        result = self.run_helper(repo)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ownership contract", result.stderr)

    def test_persisted_execution_scoped_handoff_env_overrides_foreign_selector_state(
        self,
    ) -> None:
        repo = self.make_repo()
        self.write_selector_and_handoff(
            repo, execution_id="exec-new", review_count=0, comment_count=0
        )
        (
            repo / "codeInfoTmp/reviews/0000060-github-review-exec-old-current.json"
        ).write_text(
            json.dumps(
                {
                    "handoff_kind": "github-review-handoff-v1",
                    "execution_id": "exec-old",
                    "plan_path": PLAN_PATH,
                    "story_number": "0000060",
                    "repository_root": str(repo),
                    "branch_name": "feature/0000060-demo",
                    "head_sha": "deadbeef",
                    "raw_review_artifact_path": str(
                        repo
                        / "codeInfoTmp/reviews"
                        / "0000060-github-review-exec-old-pr-45.json"
                    ),
                    "filtered_review_count": 1,
                    "filtered_review_comment_count": 0,
                    "pull_request": {
                        "number": 45,
                        "url": "https://github.com/example/repo/pull/45",
                        "headRefName": "feature/0000060-demo",
                        "baseRefName": "main",
                    },
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        result = self.run_helper(
            repo,
            env_overrides={
                "CODEINFO_GITHUB_REVIEW_EXECUTION_ID": "exec-old",
                "CODEINFO_GITHUB_REVIEW_PR_NUMBER": "45",
                "CODEINFO_GITHUB_REVIEW_HANDOFF_PATH": str(
                    repo
                    / "codeInfoTmp/reviews/0000060-github-review-exec-old-current.json"
                ),
            },
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {"answer": "yes"})

    def test_env_provided_foreign_handoff_path_is_rejected_before_any_json_read(
        self,
    ) -> None:
        repo = self.make_repo()
        self.write_selector_and_handoff(
            repo, execution_id="exec-1", review_count=1, comment_count=0
        )
        foreign_dir = repo / "foreign-handoff"
        foreign_dir.mkdir()

        result = self.run_helper(
            repo,
            env_overrides={
                "CODEINFO_GITHUB_REVIEW_EXECUTION_ID": "exec-1",
                "CODEINFO_GITHUB_REVIEW_PR_NUMBER": "45",
                "CODEINFO_GITHUB_REVIEW_HANDOFF_PATH": str(foreign_dir),
            },
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("canonical execution-scoped ownership contract", result.stderr)
        self.assertNotIn("Is a directory", result.stderr)

    def test_env_provided_generic_current_review_fallback_remains_rejected(
        self,
    ) -> None:
        repo = self.make_repo()
        self.write_selector_and_handoff(
            repo, execution_id="exec-1", review_count=0, comment_count=0
        )
        generic_current_review = repo / "codeInfoTmp/reviews/0000060-current-review.json"
        generic_current_review.write_text(
            json.dumps(
                {
                    "filtered_review_count": 3,
                    "filtered_review_comment_count": 1,
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        result = self.run_helper(
            repo,
            env_overrides={
                "CODEINFO_GITHUB_REVIEW_EXECUTION_ID": "exec-1",
                "CODEINFO_GITHUB_REVIEW_HANDOFF_PATH": str(generic_current_review),
            },
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("canonical execution-scoped ownership contract", result.stderr)

    def test_canonical_malformed_handoff_stays_on_read_only_parse_failure_path(
        self,
    ) -> None:
        repo = self.make_repo()
        handoff_path = (
            repo / "codeInfoTmp/reviews/0000060-github-review-exec-1-current.json"
        )
        handoff_path.write_text("{not-json\n", encoding="utf-8")

        result = self.run_helper(
            repo,
            env_overrides={
                "CODEINFO_GITHUB_REVIEW_EXECUTION_ID": "exec-1",
                "CODEINFO_GITHUB_REVIEW_HANDOFF_PATH": str(handoff_path),
            },
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Expecting property name enclosed in double quotes", result.stderr)
        self.assertNotIn("ownership contract", result.stderr)

    def test_skipped_review_returns_no_without_requiring_scratch_state(self) -> None:
        repo = self.make_repo()

        result = self.run_helper(
            repo,
            env_overrides={"CODEINFO_GITHUB_REVIEW_SKIPPED": "1"},
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {"answer": "no"})


if __name__ == "__main__":
    unittest.main()
