#!/usr/bin/env python3
"""Focused tests for compact review-context preparation."""

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
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import prepare_review_context


class PrepareReviewContextTests(unittest.TestCase):
    def make_repo(self, story: str = "0000123") -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        plan_path = repo / "planning" / f"{story}-review-context.md"
        plan_path.parent.mkdir(parents=True)
        plan_path.write_text(
            textwrap.dedent(
                """
                # Story

                ## Description

                Preserve the intended behavior.

                ## Acceptance Criteria

                - The behavior is proven.

                ## Out Of Scope

                - Unrelated redesign work.

                ## Implementation Plan

                ### Task 1. Large task body

                #### Overview

                TASK_SENTINEL must not enter compact context.
                """
            ).lstrip()
        )
        handoff = repo / "codeInfoStatus" / "flow-state" / "current-plan.json"
        handoff.parent.mkdir(parents=True)
        handoff.write_text(
            json.dumps({"plan_path": str(plan_path.relative_to(repo))})
        )
        return repo

    def test_writes_only_compact_story_contract_with_fixed_exclusion(self) -> None:
        repo = self.make_repo()

        path, artifact = prepare_review_context.prepare_review_context(
            repo_root=repo,
            branch="feature/0000123-review-context",
        )

        self.assertEqual(
            path,
            repo
            / "codeInfoTmp"
            / "reviews"
            / "0000123-current-review-context.json",
        )
        self.assertEqual(artifact["schema_version"], "codeinfo-review-context/v1")
        self.assertEqual(artifact["excluded_paths"], ["planning/**"])
        self.assertEqual(
            artifact["sections"]["overview"]["source_heading"], "Description"
        )
        encoded = json.dumps(artifact)
        self.assertIn("Preserve the intended behavior", encoded)
        self.assertIn("The behavior is proven", encoded)
        self.assertIn("Unrelated redesign work", encoded)
        self.assertNotIn("TASK_SENTINEL", encoded)
        self.assertEqual(json.loads(path.read_text()), artifact)

    def test_prefers_overview_and_falls_back_to_non_goals(self) -> None:
        repo = self.make_repo()
        plan = repo / "planning" / "0000123-review-context.md"
        plan.write_text(
            textwrap.dedent(
                """
                # Story

                ## Description

                Description fallback.

                ## Overview

                Preferred overview.

                ## Acceptance Criteria

                - It works.

                ## Non-Goals

                - Do not redesign it.
                """
            ).lstrip()
        )

        _, artifact = prepare_review_context.prepare_review_context(
            repo_root=repo,
            branch="feature/0000123-review-context",
        )

        self.assertEqual(
            artifact["sections"]["overview"]["source_heading"], "Overview"
        )
        self.assertEqual(
            artifact["sections"]["out_of_scope"]["source_heading"], "Non-Goals"
        )
        self.assertNotIn("Description fallback", json.dumps(artifact))

    def test_requires_acceptance_criteria(self) -> None:
        repo = self.make_repo()
        plan = repo / "planning" / "0000123-review-context.md"
        plan.write_text("# Story\n\n## Overview\n\nOnly overview.\n")

        with self.assertRaisesRegex(SystemExit, "requires Acceptance Criteria"):
            prepare_review_context.prepare_review_context(
                repo_root=repo,
                branch="feature/0000123-review-context",
            )

    def test_rejects_branch_story_mismatch(self) -> None:
        repo = self.make_repo()

        with self.assertRaisesRegex(SystemExit, "does not match plan story"):
            prepare_review_context.prepare_review_context(
                repo_root=repo,
                branch="feature/0000999-wrong-story",
            )

    def test_rejects_noncanonical_plan_story_identity(self) -> None:
        repo = self.make_repo(story="123")

        with self.assertRaisesRegex(SystemExit, "canonical seven-digit story_id"):
            prepare_review_context.prepare_review_context(
                repo_root=repo,
                branch="feature/0000123-review-context",
            )

    def test_git_branch_returns_the_current_branch(self) -> None:
        repo = self.make_repo()

        with mock.patch.object(
            prepare_review_context.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                args=["git"], returncode=0, stdout="feature/0000123-review-context\n"
            ),
        ):
            self.assertEqual(
                prepare_review_context._git_branch(repo),
                "feature/0000123-review-context",
            )

    def test_git_branch_reports_git_command_failures(self) -> None:
        repo = self.make_repo()

        with mock.patch.object(
            prepare_review_context.subprocess,
            "run",
            side_effect=subprocess.CalledProcessError(128, ["git"]),
        ):
            with self.assertRaisesRegex(
                SystemExit, "current branch could not be resolved"
            ):
                prepare_review_context._git_branch(repo)

    def test_git_branch_reports_when_git_is_unavailable(self) -> None:
        repo = self.make_repo()

        with mock.patch.object(
            prepare_review_context.subprocess,
            "run",
            side_effect=FileNotFoundError("git not found"),
        ):
            with self.assertRaisesRegex(
                SystemExit, "current branch could not be resolved"
            ):
                prepare_review_context._git_branch(repo)


if __name__ == "__main__":
    unittest.main()
