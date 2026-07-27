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

from check_review_workspace import (
    check_workspace,
    check_workspace_handoff,
    resolve_batch_handoff,
)


class ReviewWorkspaceCheckTests(unittest.TestCase):
    def populate_batch(self, batch: Path) -> Path:
        (batch / "inputs" / "target").mkdir(parents=True)
        (batch / "reconciliation").mkdir()
        job = batch / "jobs" / "reviewer-a"
        for name in ("input", "work", "output", "verification"):
            (job / name).mkdir(parents=True)
        (job / "job.md").write_text("# Agent-readable job\n", encoding="utf-8")
        (batch / "batch-launch.md").write_text("# Launch\n", encoding="utf-8")
        return batch

    def make_batch(self, root: Path) -> Path:
        return self.populate_batch(root / "batch")

    def make_handoff_batch(self, root: Path) -> tuple[Path, Path]:
        review_root = root / "project" / "codeInfoTmp" / "reviews"
        cycle_id = "0000064-rc-20260726T120000Z-cycle"
        batch_id = "0000064-rw-20260726T120001Z-batch"
        batch = self.populate_batch(
            review_root / cycle_id / "batches" / f"{batch_id}--head-0123456789ab"
        )
        handoff = review_root / "0000064-current-review-batch.md"
        handoff.write_text(
            "\n".join(
                (
                    "# Current review batch",
                    "",
                    "- Story: 0000064",
                    f"- Review cycle: {cycle_id}",
                    f"- Batch: {batch_id}",
                    f"- Batch directory: {batch}",
                    f"- Inputs directory: {batch / 'inputs'}",
                    f"- Jobs directory: {batch / 'jobs'}",
                    f"- Reconciliation directory: {batch / 'reconciliation'}",
                    "",
                    "## Scheduled job directories",
                    "",
                    f"- reviewer-a: {batch / 'jobs' / 'reviewer-a'}",
                    "",
                )
            ),
            encoding="utf-8",
        )
        return handoff, batch

    def test_accepts_empty_and_flexible_review_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            batch = self.make_batch(Path(tmpdir))
            empty = check_workspace(batch)
            self.assertEqual(empty["status"], "passed")
            self.assertTrue(empty["facts"]["jobs"][0]["output_empty"])

            output = batch / "jobs" / "reviewer-a" / "output"
            (output / "empty artifact.md").touch()
            (output / "empty artifact directory").mkdir()
            still_empty = check_workspace(batch)
            self.assertEqual(still_empty["status"], "passed")
            self.assertTrue(still_empty["facts"]["jobs"][0]["output_empty"])

            nested = output / "however the reviewer organized it"
            nested.mkdir()
            (nested / "notes written however the reviewer chose.md").write_text(
                "finding", encoding="utf-8"
            )
            flexible = check_workspace(batch)
            self.assertEqual(flexible["status"], "passed")
            self.assertFalse(flexible["facts"]["jobs"][0]["output_empty"])
            self.assertEqual(
                flexible["facts"]["jobs"][0]["output_entries"],
                [
                    str(
                        Path("however the reviewer organized it")
                        / "notes written however the reviewer chose.md"
                    )
                ],
            )

    def test_reports_missing_workspace_structure(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            batch = Path(tmpdir) / "batch"
            batch.mkdir()
            result = check_workspace(batch)
            self.assertEqual(result["status"], "failed")
            self.assertTrue(any("missing directory" in item for item in result["errors"]))

    def test_reports_a_missing_private_job_input_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            batch = self.make_batch(Path(tmpdir))
            (batch / "jobs" / "reviewer-a" / "input").rmdir()

            result = check_workspace(batch)

            self.assertEqual(result["status"], "failed")
            self.assertIn("job reviewer-a is missing input/", result["errors"])

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

    def test_rejects_output_entry_symlink_that_escapes_its_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            batch = self.make_batch(root)
            output = batch / "jobs" / "reviewer-a" / "output"
            external_output = root / "external-review.md"
            external_output.write_text("outside", encoding="utf-8")
            (output / "review.md").symlink_to(external_output)

            result = check_workspace(batch)

            self.assertEqual(result["status"], "failed")
            self.assertTrue(result["facts"]["jobs"][0]["output_empty"])
            self.assertIn(
                "job reviewer-a output entry escapes its output directory: review.md",
                result["errors"],
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

    def test_handoff_resolves_only_its_canonical_batch(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            handoff, canonical_batch = self.make_handoff_batch(root)
            lookalike_batch = self.populate_batch(
                root
                / "codeInfoTmp"
                / "reviews"
                / canonical_batch.parent.parent.parent.name
                / "batches"
                / canonical_batch.name
            )
            (
                lookalike_batch
                / "jobs"
                / "reviewer-a"
                / "output"
                / "misleading-review.md"
            ).write_text("wrong tree\n", encoding="utf-8")

            resolved = resolve_batch_handoff(handoff)
            checked = check_workspace_handoff(handoff)

            self.assertEqual(Path(resolved["batch_root"]), canonical_batch.resolve())
            self.assertEqual(checked["status"], "passed")
            self.assertTrue(checked["facts"]["jobs"][0]["output_empty"])

    def test_handoff_rejects_a_lookalike_declared_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            handoff, canonical_batch = self.make_handoff_batch(root)
            lookalike_inputs = root / "codeInfoTmp" / "reviews" / "inputs"
            handoff.write_text(
                handoff.read_text(encoding="utf-8").replace(
                    f"- Inputs directory: {canonical_batch / 'inputs'}",
                    f"- Inputs directory: {lookalike_inputs}",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ValueError, "inputs directory does not match canonical batch root"
            ):
                resolve_batch_handoff(handoff)

    def test_handoff_rejects_story_or_cycle_identity_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            handoff, _ = self.make_handoff_batch(root)
            wrong_filename = handoff.with_name("0000065-current-review-batch.md")
            handoff.rename(wrong_filename)
            with self.assertRaisesRegex(
                ValueError, "filename does not match its story identity"
            ):
                resolve_batch_handoff(wrong_filename)

            wrong_filename.rename(handoff)
            handoff.write_text(
                handoff.read_text(encoding="utf-8").replace(
                    "- Review cycle: 0000064-rc-20260726T120000Z-cycle",
                    "- Review cycle: 0000064-rc-20260726T120000Z-other",
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                ValueError, "does not match its review-cycle identity"
            ):
                resolve_batch_handoff(handoff)

    def test_handoff_check_rejects_scheduled_job_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            handoff, canonical_batch = self.make_handoff_batch(root)
            unexpected = canonical_batch / "jobs" / "reviewer-b"
            for name in ("input", "work", "output", "verification"):
                (unexpected / name).mkdir(parents=True)
            (unexpected / "job.md").write_text("# Unexpected\n", encoding="utf-8")

            result = check_workspace_handoff(handoff)

            self.assertEqual(result["status"], "failed")
            self.assertIn(
                f"job directory is not declared by current-batch handoff: {unexpected}",
                result["errors"],
            )

    def test_cli_resolves_and_checks_through_the_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            handoff, canonical_batch = self.make_handoff_batch(Path(tmpdir))
            script = REPO_ROOT / "scripts" / "check_review_workspace.py"

            resolved = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "resolve",
                    "--batch-handoff",
                    str(handoff),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            checked = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "check",
                    "--batch-handoff",
                    str(handoff),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            self.assertEqual(resolved.stdout.strip(), str(canonical_batch.resolve()))
            self.assertIn('"status": "passed"', checked.stdout)


if __name__ == "__main__":
    unittest.main()
