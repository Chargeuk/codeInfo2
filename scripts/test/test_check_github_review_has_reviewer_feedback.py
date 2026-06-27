#!/usr/bin/env python3
"""Focused tests for GitHub review feedback flow-control helper."""

from __future__ import annotations

import json
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

    def run_helper(self, repo: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_uses_namespaced_handoff_when_feedback_exists(self) -> None:
        repo = self.make_repo()
        (
            repo / "codeInfoTmp/reviews/0000060-github-review-current.json"
        ).write_text(
            json.dumps(
                {
                    "filtered_review_count": 1,
                    "filtered_review_comment_count": 1,
                },
                indent=2,
            ),
            encoding="utf-8",
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


if __name__ == "__main__":
    unittest.main()
