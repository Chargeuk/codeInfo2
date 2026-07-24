#!/usr/bin/env python3
"""Focused tests for factual, format-agnostic review workspace checks."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from check_review_workspace import check_workspace


class ReviewWorkspaceCheckTests(unittest.TestCase):
    def make_batch(self, root: Path) -> Path:
        batch = root / "batch"
        (batch / "inputs" / "target").mkdir(parents=True)
        (batch / "reconciliation").mkdir()
        job = batch / "jobs" / "reviewer-a"
        for name in ("work", "output", "verification"):
            (job / name).mkdir(parents=True)
        (job / "job.md").write_text("# Agent-readable job\n", encoding="utf-8")
        (batch / "batch-launch.md").write_text("# Launch\n", encoding="utf-8")
        return batch

    def test_accepts_empty_and_flexible_review_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            batch = self.make_batch(Path(tmpdir))
            empty = check_workspace(batch)
            self.assertEqual(empty["status"], "passed")
            self.assertTrue(empty["facts"]["jobs"][0]["output_empty"])

            output = batch / "jobs" / "reviewer-a" / "output"
            (output / "notes written however the reviewer chose.md").write_text(
                "finding", encoding="utf-8"
            )
            flexible = check_workspace(batch)
            self.assertEqual(flexible["status"], "passed")
            self.assertFalse(flexible["facts"]["jobs"][0]["output_empty"])

    def test_reports_missing_workspace_structure(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            batch = Path(tmpdir) / "batch"
            batch.mkdir()
            result = check_workspace(batch)
            self.assertEqual(result["status"], "failed")
            self.assertTrue(any("missing directory" in item for item in result["errors"]))

    def test_rejects_job_boundary_redirected_to_a_sibling(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            batch = self.make_batch(Path(tmpdir))
            sibling = batch / "jobs" / "reviewer-b"
            for name in ("work", "output", "verification"):
                (sibling / name).mkdir(parents=True)
            (sibling / "job.md").write_text("# Sibling job\n", encoding="utf-8")

            redirected_output = batch / "jobs" / "reviewer-a" / "output"
            redirected_output.rmdir()
            redirected_output.symlink_to(sibling / "output", target_is_directory=True)

            result = check_workspace(batch)
            self.assertEqual(result["status"], "failed")
            self.assertIn(
                "job reviewer-a output/ escapes its job root", result["errors"]
            )

    def test_checks_git_head_as_a_fact(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            batch = self.make_batch(root)
            repository = root / "repo"
            repository.mkdir()
            subprocess.run(["git", "-C", str(repository), "init", "-q"], check=True)
            subprocess.run(
                ["git", "-C", str(repository), "config", "user.email", "test@example.com"],
                check=True,
            )
            subprocess.run(
                ["git", "-C", str(repository), "config", "user.name", "Test User"],
                check=True,
            )
            (repository / "file.txt").write_text("content\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(repository), "add", "file.txt"], check=True)
            subprocess.run(["git", "-C", str(repository), "commit", "-qm", "fixture"], check=True)
            head = subprocess.run(
                ["git", "-C", str(repository), "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            self.assertEqual(
                check_workspace(batch, [(repository, head)])["status"], "passed"
            )
            self.assertEqual(
                check_workspace(batch, [(repository, "0" * 40)])["status"], "failed"
            )


if __name__ == "__main__":
    unittest.main()
