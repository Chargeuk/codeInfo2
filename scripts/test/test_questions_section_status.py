#!/usr/bin/env python3
"""Focused tests for questions_section_status.py."""

from __future__ import annotations

import json
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import questions_section_status


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )


class QuestionsSectionStatusTests(unittest.TestCase):
    def make_repo(self, head_text: str, current_text: str) -> tuple[Path, str]:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        git(repo, "init", "-b", "feature/0000123-sample-story")
        git(repo, "config", "user.name", "Test User")
        git(repo, "config", "user.email", "test@example.com")

        plan_path = repo / "planning" / "0000123-sample-story.md"
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(textwrap.dedent(head_text).lstrip())
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
        git(repo, "add", ".")
        git(repo, "commit", "-m", "initial")

        plan_path.write_text(textwrap.dedent(current_text).lstrip())
        return repo, str(handoff.relative_to(repo))

    def test_reports_no_further_questions(self) -> None:
        repo, handoff = self.make_repo(
            """
            ## Questions
            - No Further Questions
            """,
            """
            ## Questions
            - No Further Questions
            """,
        )

        status = questions_section_status.get_questions_section_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["questions_section_present"])
        self.assertTrue(status["has_no_further_questions_line"])
        self.assertFalse(status["has_real_questions"])
        self.assertFalse(status["has_added_numbered_questions"])

    def test_reports_added_numbered_questions_vs_head(self) -> None:
        repo, handoff = self.make_repo(
            """
            ## Questions
            - No Further Questions
            """,
            """
            ## Questions
            1. Should this be clarified?
            """,
        )

        status = questions_section_status.get_questions_section_status(
            handoff=handoff,
            repo_root=repo,
        )

        self.assertTrue(status["has_real_questions"])
        self.assertTrue(status["has_added_numbered_questions"])
        self.assertEqual(status["added_numbered_questions"], ["Should this be clarified?"])


if __name__ == "__main__":
    unittest.main()
