#!/usr/bin/env python3
"""Focused tests for repo_freshness.py candidate inspection."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import repo_freshness


class RepoFreshnessTests(unittest.TestCase):
    def test_missing_deleted_and_dangling_tracked_candidates_are_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / ".git").mkdir()
            kept = root / "kept.py"
            kept.write_text("print('kept')\n", encoding="utf-8")
            deleted = root / "deleted.py"
            deleted.touch()
            deleted.unlink()
            (root / "dangling.py").symlink_to(root / "absent.py")
            errors = []
            with mock.patch.object(
                repo_freshness,
                "git",
                side_effect=[
                    os.fsencode(tmpdir),
                    b"missing.py\0deleted.py\0dangling.py\0kept.py\0",
                ],
            ):
                result = repo_freshness.scan(tmpdir, ["py"], [], errors)

            self.assertEqual(errors, [])
            self.assertTrue(result["complete"])
            self.assertEqual(result["discoveryMethod"], "git ls-files -z")
            self.assertEqual(result["eligibleFilesCount"], 1)
            self.assertEqual(result["latestEligibleFile"]["path"], str(kept))

    def test_candidate_vanishing_between_stat_and_open_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / ".git").mkdir()
            candidate = root / "vanishing.py"
            candidate.write_text("print('vanishing')\n", encoding="utf-8")
            errors = []
            with mock.patch.object(
                repo_freshness,
                "git",
                side_effect=[os.fsencode(tmpdir), b"vanishing.py\0"],
            ), mock.patch.object(
                repo_freshness,
                "open",
                side_effect=FileNotFoundError("Candidate vanished before open"),
                create=True,
            ) as open_candidate:
                result = repo_freshness.scan(tmpdir, ["py"], [], errors)

            open_candidate.assert_called_once_with(str(candidate), "rb")
            self.assertEqual(errors, [])
            self.assertTrue(result["complete"])
            self.assertEqual(result["eligibleFilesCount"], 0)
            self.assertIsNone(result["latestEligibleFile"])

    def test_other_candidate_errors_keep_scan_incomplete(self) -> None:
        for error_type in (PermissionError, OSError, ValueError, OverflowError):
            with self.subTest(error_type=error_type.__name__):
                with tempfile.TemporaryDirectory() as tmpdir:
                    root = Path(tmpdir)
                    (root / ".git").mkdir()
                    candidate = root / "unreadable.py"
                    candidate.write_text("print('unreadable')\n", encoding="utf-8")
                    errors = []
                    with mock.patch.object(
                        repo_freshness,
                        "git",
                        side_effect=[os.fsencode(tmpdir), b"unreadable.py\0"],
                    ), mock.patch.object(
                        repo_freshness,
                        "open",
                        side_effect=error_type("Candidate inspection failed"),
                        create=True,
                    ):
                        result = repo_freshness.scan(tmpdir, ["py"], [], errors)

                    self.assertFalse(result["complete"])
                    self.assertEqual(result["eligibleFilesCount"], 0)
                    self.assertEqual(
                        errors,
                        [
                            f"Cannot inspect eligible candidate {candidate}: "
                            "Candidate inspection failed"
                        ],
                    )


if __name__ == "__main__":
    unittest.main()
