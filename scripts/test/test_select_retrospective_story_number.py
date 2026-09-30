#!/usr/bin/env python3
"""Number selection tests with a real local Git remote."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from select_retrospective_story_number import select_number


class SelectRetrospectiveStoryNumberTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.remote = self.root / "remote.git"
        self.repo.mkdir()
        self.run_git("init", "--bare", str(self.remote), cwd=self.root)
        self.run_git("init", "-b", "main", cwd=self.repo)
        self.run_git("config", "user.email", "test@example.invalid")
        self.run_git("config", "user.name", "Test")
        self.run_git("commit", "--allow-empty", "-m", "initial")
        self.run_git("remote", "add", "origin", str(self.remote))
        (self.repo / "planning").mkdir()
        self.previous_cwd = Path.cwd()
        os.chdir(self.repo)
        self.addCleanup(os.chdir, self.previous_cwd)

    def run_git(self, *args: str, cwd: Path | None = None) -> None:
        subprocess.run(
            ["git", *args], cwd=cwd or self.repo, check=True, capture_output=True
        )

    def test_new_number_uses_plans_and_only_current_branch_namespace(self) -> None:
        (self.repo / "planning" / "0000005-existing.md").touch()
        self.run_git("branch", "feature/0000007-other")
        self.run_git("push", "origin", "feature/0000007-other")
        self.run_git("branch", "manual_work/0000099-unrelated")
        self.run_git("push", "origin", "manual_work/0000099-unrelated")

        result = select_number()

        self.assertEqual(result["number"], "0000008")
        self.assertEqual(result["namespace"], "feature/")
        self.assertFalse(result["reuse_current_branch"])
        self.assertTrue(result["remote_verified"])

    def test_indexed_current_branch_reused_across_other_namespace(self) -> None:
        self.run_git("switch", "-c", "manual_work/0000012-own")
        self.run_git("branch", "feature/0000012-other")
        self.run_git("push", "origin", "feature/0000012-other")

        result = select_number()

        self.assertEqual(result["number"], "0000012")
        self.assertEqual(result["namespace"], "manual_work/")
        self.assertTrue(result["reuse_current_branch"])

    def test_same_namespace_remote_collision_requires_new_number(self) -> None:
        self.run_git("switch", "-c", "manual_work/0000012-own")
        self.run_git("branch", "manual_work/0000012-other")
        self.run_git("push", "origin", "manual_work/0000012-other")

        result = select_number()

        self.assertEqual(result["number"], "0000013")
        self.assertFalse(result["reuse_current_branch"])

    def test_owned_plan_and_exact_remote_branch_do_not_conflict(self) -> None:
        self.run_git("switch", "-c", "feature/0000012-own")
        self.run_git("push", "origin", "feature/0000012-own")
        plan = self.repo / "planning" / "0000012-own.md"
        plan.touch()

        self.assertEqual(select_number()["number"], "0000013")
        result = select_number(plan)
        self.assertEqual(result["number"], "0000012")
        self.assertTrue(result["reuse_current_branch"])

    def test_unavailable_remote_uses_cached_refs_and_warns(self) -> None:
        self.run_git("branch", "feature/0000007-other")
        self.run_git("update-ref", "refs/remotes/origin/feature/0000007-other", "HEAD")
        self.run_git("remote", "set-url", "origin", str(self.root / "missing.git"))

        result = select_number()

        self.assertEqual(result["number"], "0000008")
        self.assertFalse(result["remote_verified"])
        self.assertTrue(result["warnings"])


if __name__ == "__main__":
    unittest.main()
