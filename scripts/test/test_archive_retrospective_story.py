#!/usr/bin/env python3
"""Archive behavior uses disposable repositories, never a live story."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from archive_retrospective_story import RECEIPT, archive_story, verified_archive_entry
from flow_state_utils import ScopeResolutionError, load_plan_scope


class ArchiveRetrospectiveStoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "feature/0000012-delivered")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Test")
        self.git("commit", "--allow-empty", "-m", "initial")
        self.planning = self.repo / "planning"
        self.planning.mkdir()
        self.source = self.planning / "0000012-original.md"
        self.destination = self.planning / "one-shot" / "one-shot-0000012-original.md"

    def git(self, *args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=self.repo, check=True, capture_output=True, text=True
        ).stdout

    def test_no_story_is_normal_no_op_and_does_not_create_archive_folder(self) -> None:
        # A stale selected plan cannot authorize archiving another story.
        other = self.planning / "0000099-other.md"
        other.write_text("unrelated story")
        handoff = self.repo / "codeInfoStatus/flow-state/current-plan.json"
        handoff.parent.mkdir(parents=True)
        handoff.write_text(json.dumps({"plan_path": "planning/0000099-other.md"}))
        result = archive_story(self.repo)
        self.assertEqual(result["status"], "no_op")
        self.assertEqual(result["reason"], "no_matching_story")
        self.assertEqual(result["entries"], [])
        self.assertFalse(self.destination.parent.exists())
        self.assertEqual(other.read_text(), "unrelated story")
        self.assertEqual(json.loads(handoff.read_text())["plan_path"], "planning/0000099-other.md")
        self.assertEqual(json.loads((self.repo / RECEIPT).read_text()), result)

    def test_tracked_story_preserves_dirty_and_staged_working_bytes(self) -> None:
        self.source.write_bytes(b"committed\n")
        self.git("add", "planning/0000012-original.md")
        self.git("commit", "-m", "original story")
        self.source.write_bytes(b"staged\n")
        self.git("add", "planning/0000012-original.md")
        content = b"dirty working content\r\n\x00unchanged bytes\n"
        self.source.write_bytes(content)
        staged_before = self.git("diff", "--cached")

        result = archive_story(self.repo)

        self.assertEqual(result["status"], "archived")
        self.assertFalse(self.source.exists())
        self.assertEqual(self.destination.read_bytes(), content)
        self.assertEqual(result["entries"][0]["content_sha256"], hashlib.sha256(content).hexdigest())
        self.assertEqual(self.git("diff", "--cached"), staged_before)
        self.assertEqual(result["entries"][0]["source_path"], "planning/0000012-original.md")
        self.assertEqual(result["entries"][0]["archive_path"], "planning/one-shot/one-shot-0000012-original.md")

    def test_untracked_story_creates_archive_folder_and_preserves_content(self) -> None:
        self.source.write_bytes(b"untracked proposal\n")
        self.assertFalse(self.destination.parent.exists())
        result = archive_story(self.repo)
        self.assertEqual(result["status"], "archived")
        self.assertEqual(self.destination.read_bytes(), b"untracked proposal\n")
        self.assertFalse(self.source.exists())
        self.assertEqual(self.git("diff", "--cached"), "")

    def test_occupied_suffixes_preserve_all_archives_and_move_source(self) -> None:
        self.source.write_text("current original")
        self.destination.parent.mkdir()
        occupied = [self.destination] + [
            self.destination.with_name(f"{self.destination.stem}-{number}.md")
            for number in (1, 2)
        ]
        for number, destination in enumerate(occupied):
            destination.write_text(f"existing archive {number}")

        result = archive_story(self.repo)

        self.assertEqual(result["status"], "archived")
        self.assertFalse(self.source.exists())
        allocated = self.destination.with_name(f"{self.destination.stem}-3.md")
        self.assertEqual(allocated.read_text(), "current original")
        self.assertEqual(result["entries"][0]["archive_path"], str(allocated.relative_to(self.repo)))
        for number, destination in enumerate(occupied):
            self.assertEqual(destination.read_text(), f"existing archive {number}")
        self.assertEqual(archive_story(self.repo), result)

    def test_all_numeric_matches_archive_in_filename_order_and_leave_other_scope(self) -> None:
        sources = [self.source, self.planning / "12-second.md", self.planning / "0000012-another.md"]
        for source in reversed(sources):
            source.write_text(source.name)
        unrelated = self.planning / "0000013-other.md"
        unrelated.write_text("different numeric identity")
        unnumbered = self.planning / "plan_format.md"
        unnumbered.write_text("template")

        result = archive_story(self.repo)

        self.assertEqual(result["status"], "archived")
        self.assertEqual(
            [entry["source_path"] for entry in result["entries"]],
            [str(source.relative_to(self.repo)) for source in sorted(sources)],
        )
        for entry in result["entries"]:
            self.assertEqual(entry["status"], "archived")
            self.assertEqual((self.repo / entry["archive_path"]).read_text(), Path(entry["source_path"]).name)
            self.assertFalse((self.repo / entry["source_path"]).exists())
        self.assertEqual(unrelated.read_text(), "different numeric identity")
        self.assertEqual(unnumbered.read_text(), "template")

    def test_unnumbered_and_detached_branches_do_not_archive(self) -> None:
        self.source.write_text("original")
        for args in [("switch", "-c", "main"), ("checkout", "--detach", "HEAD")]:
            with self.subTest(args=args):
                self.git(*args)
                result = archive_story(self.repo)
                self.assertEqual(result["reason"], "detached_or_unnumbered_branch")
                self.assertEqual(result["entries"], [])
                self.assertTrue(self.source.exists())
                self.assertFalse(self.destination.parent.exists())

    def test_numeric_convention_uses_final_branch_segment_and_normalized_number(self) -> None:
        self.git("switch", "-c", "manual_work/12-delivered")
        self.source.write_text("original")
        self.assertEqual(archive_story(self.repo)["status"], "archived")

    def test_no_source_rerun_recovers_entries_without_moving_archives(self) -> None:
        self.source.write_text("original")
        first = archive_story(self.repo)
        self.assertEqual(archive_story(self.repo), first)
        self.assertEqual(archive_story(self.repo), first)
        self.assertEqual(list(self.destination.parent.glob("*.md")), [self.destination])
        self.assertEqual(self.destination.read_text(), "original")

    def test_present_replacement_is_archived_with_suffix_and_prior_mapping_retained(self) -> None:
        self.source.write_text("original")
        first = archive_story(self.repo)
        self.source.write_text("new retrospective story at reused path")

        result = archive_story(self.repo)

        replacement = self.destination.with_name(f"{self.destination.stem}-1.md")
        self.assertFalse(self.source.exists())
        self.assertEqual(result["status"], "archived")
        self.assertEqual(result["entries"][0], first["entries"][0])
        self.assertEqual(result["entries"][1]["archive_path"], str(replacement.relative_to(self.repo)))
        self.assertEqual(replacement.read_text(), "new retrospective story at reused path")
        self.assertEqual(self.destination.read_text(), "original")
        self.assertEqual(archive_story(self.repo), result)
        # Even identical bytes at a newly present source must be moved again.
        self.source.write_text("original")
        third = archive_story(self.repo)
        self.assertEqual(len(third["entries"]), 3)
        self.assertFalse(self.source.exists())
        self.assertEqual((self.repo / third["entries"][2]["archive_path"]).name, f"{self.destination.stem}-2.md")

    def test_head_advance_retains_verified_pending_archive_mappings(self) -> None:
        self.source.write_text("original")
        first = archive_story(self.repo)
        self.git("commit", "--allow-empty", "-m", "advance same branch")
        self.source.write_text("replacement")
        result = archive_story(self.repo)
        self.assertEqual(result["entries"][0], first["entries"][0])
        self.assertEqual(len(result["entries"]), 2)
        self.assertNotEqual(result["initial_head_commit"], first["initial_head_commit"])
        self.assertFalse(self.source.exists())

    def test_fresh_branch_does_not_claim_another_storys_archive_receipt(self) -> None:
        self.source.write_text("original")
        archive_story(self.repo)
        self.git("switch", "-c", "feature/0000013-next")
        next_source = self.planning / "0000013-next.md"
        next_source.write_text("next original")
        result = archive_story(self.repo)
        self.assertEqual(result["status"], "partial")
        self.assertIn("another story identity", result["warnings"][0])
        self.assertEqual(result["entries"][0]["status"], "archived")
        self.assertEqual(result["entries"][0]["source_path"], "planning/0000013-next.md")
        self.assertEqual(len(result["entries"]), 1)
        self.assertEqual(self.destination.read_text(), "original")

    def test_changed_archive_is_reported_but_does_not_suppress_present_source(self) -> None:
        self.source.write_text("original")
        archive_story(self.repo)
        self.source.write_text("new plan")
        self.destination.write_text("changed by someone else")
        result = archive_story(self.repo)
        self.assertEqual(result["status"], "partial")
        self.assertIn("could not be verified", result["warnings"][0])
        self.assertFalse(self.source.exists())
        self.assertEqual((self.repo / result["entries"][0]["archive_path"]).read_text(), "new plan")
        self.assertEqual(self.destination.read_text(), "changed by someone else")
        self.assertEqual(archive_story(self.repo), result)

    def test_malformed_receipt_does_not_suppress_present_source(self) -> None:
        receipt = self.repo / RECEIPT
        receipt.parent.mkdir(parents=True)
        receipt.write_text("not JSON")
        self.source.write_text("original")
        result = archive_story(self.repo)
        self.assertEqual(result["status"], "partial")
        self.assertIn("unavailable or malformed", result["warnings"][0])
        self.assertEqual(result["entries"][0]["status"], "archived")
        self.assertFalse(self.source.exists())

    def test_recovery_validates_each_mapping_and_generated_suffix_relationship(self) -> None:
        self.source.write_text("original")
        first = archive_story(self.repo)
        self.source.write_text("replacement")
        result = archive_story(self.repo)
        valid_suffix = result["entries"][1]
        self.assertTrue(verified_archive_entry(self.repo, result["branch"], valid_suffix))
        bad_destination = self.destination.with_name(f"{self.destination.stem}-01.md")
        bad_destination.write_text("original")
        invalid = dict(first["entries"][0], archive_path=str(bad_destination.relative_to(self.repo)))
        self.assertFalse(verified_archive_entry(self.repo, result["branch"], invalid))
        (self.repo / RECEIPT).write_text(json.dumps(dict(result, entries=[invalid, valid_suffix])))
        recovered = archive_story(self.repo)
        self.assertEqual(recovered["entries"], [valid_suffix])
        self.assertIn("could not be verified", recovered["warnings"][0])
        self.assertEqual(bad_destination.read_text(), "original")

    def test_exclusive_allocation_race_advances_suffix_without_overwriting(self) -> None:
        self.source.write_text("original")
        real_link = os.link
        attempted = []

        def racing_link(source, destination, **kwargs):
            attempted.append(destination.name)
            if len(attempted) == 1:
                destination.write_text("racing archive")
                raise FileExistsError("destination claimed concurrently")
            return real_link(source, destination, **kwargs)

        with patch("archive_retrospective_story.os.link", side_effect=racing_link):
            result = archive_story(self.repo)
        self.assertEqual(attempted, [self.destination.name, f"{self.destination.stem}-1.md"])
        self.assertEqual(result["status"], "archived")
        self.assertEqual(self.destination.read_text(), "racing archive")
        self.assertEqual((self.repo / result["entries"][0]["archive_path"]).read_text(), "original")
        self.assertFalse(self.source.exists())

    def test_per_file_error_continues_remaining_sources_and_can_be_retried(self) -> None:
        failed = self.planning / "0000012-a-failed.md"
        failed.write_text("keep until retry")
        self.source.write_text("valid remaining story")
        real_link = os.link

        def failing_link(source, destination, **kwargs):
            if source == failed:
                raise PermissionError("injected file failure")
            return real_link(source, destination, **kwargs)

        with patch("archive_retrospective_story.os.link", side_effect=failing_link):
            result = archive_story(self.repo)
        self.assertEqual(result["status"], "partial")
        self.assertEqual([entry["status"] for entry in result["entries"]], ["error", "archived"])
        self.assertIn("PermissionError", result["entries"][0]["reason"])
        self.assertEqual(failed.read_text(), "keep until retry")
        self.assertFalse(self.source.exists())
        self.assertEqual(self.destination.read_text(), "valid remaining story")
        self.assertEqual(json.loads((self.repo / RECEIPT).read_text()), result)
        retried = archive_story(self.repo)
        self.assertEqual(retried["status"], "archived")
        self.assertEqual(len(retried["entries"]), 2)
        self.assertFalse(failed.exists())
        self.assertEqual(archive_story(self.repo), retried)

    def test_source_unlink_error_retains_created_mapping_and_continues(self) -> None:
        failed = self.planning / "0000012-a-failed.md"
        failed.write_text("preserved despite unlink failure")
        self.source.write_text("remaining source")
        real_unlink = Path.unlink

        def failing_unlink(path, *args, **kwargs):
            if path == failed:
                raise PermissionError("injected unlink failure")
            return real_unlink(path, *args, **kwargs)

        with patch("pathlib.Path.unlink", new=failing_unlink):
            result = archive_story(self.repo)
        self.assertEqual(result["status"], "partial")
        self.assertTrue(failed.exists())
        self.assertFalse(self.source.exists())
        partial = result["entries"][0]
        self.assertEqual(partial["status"], "error")
        self.assertTrue(verified_archive_entry(self.repo, result["branch"], partial))
        retried = archive_story(self.repo)
        self.assertEqual(retried["entries"][0], partial)
        self.assertEqual(len(retried["entries"]), 3)
        self.assertFalse(failed.exists())
        self.assertEqual((self.repo / retried["entries"][2]["archive_path"]).name, "one-shot-0000012-a-failed-1.md")

    def test_receipt_persistence_failure_does_not_stop_remaining_sources(self) -> None:
        second = self.planning / "12-second.md"
        self.source.write_text("first")
        second.write_text("second")
        real_write = Path.write_text

        def failing_write(path, *args, **kwargs):
            if path == self.repo / RECEIPT:
                raise PermissionError("injected receipt failure")
            return real_write(path, *args, **kwargs)

        with patch("pathlib.Path.write_text", new=failing_write):
            result = archive_story(self.repo)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["entries"]), 2)
        self.assertTrue(all(entry["status"] == "archived" for entry in result["entries"]))
        self.assertFalse(self.source.exists())
        self.assertFalse(second.exists())
        self.assertIn("persistence unavailable", result["warnings"][0])

    def test_symlink_source_or_archive_directory_is_safe_no_op(self) -> None:
        outside = self.repo.parent / "outside.md"
        outside.write_text("outside")
        self.source.symlink_to(outside)
        result = archive_story(self.repo)
        self.assertEqual(result["status"], "no_op")
        self.assertEqual(result["entries"][0]["status"], "error")
        self.assertEqual(outside.read_text(), "outside")
        self.source.unlink()
        self.source.write_text("inside")
        self.destination.parent.symlink_to(self.repo.parent, target_is_directory=True)
        result = archive_story(self.repo)
        self.assertEqual(result["status"], "no_op")
        self.assertEqual(self.source.read_text(), "inside")

    def test_nested_working_folder_is_rejected_before_mutation(self) -> None:
        self.source.write_text("original")
        with self.assertRaisesRegex(ValueError, "repository root"):
            archive_story(self.planning)
        self.assertTrue(self.source.exists())
        self.assertFalse((self.repo / RECEIPT).exists())

    def test_one_shot_filename_cannot_become_active_plan(self) -> None:
        self.source.write_text("original")
        result = archive_story(self.repo)
        handoff = self.repo / "codeInfoStatus/flow-state/current-plan.json"
        handoff.write_text(json.dumps({"plan_path": result["entries"][0]["archive_path"]}))
        with self.assertRaises(ScopeResolutionError):
            load_plan_scope(repo_root=self.repo)

    def assert_story_only_commit(self, reuse_source: bool) -> None:
        self.source.write_text("original")
        second = self.planning / "0000012-secondary.md"
        second.write_text("second tracked story")
        unrelated = self.repo / "unrelated.txt"
        unrelated.write_text("committed unrelated")
        self.git("add", "planning/0000012-original.md", "planning/0000012-secondary.md", "unrelated.txt")
        self.git("commit", "-m", "original stories and unrelated file")
        self.source.write_text("dirty original")
        untracked = self.planning / "12-third.md"
        untracked.write_text("untracked third story")
        first = archive_story(self.repo)
        self.source.write_text("another matching source")
        result = archive_story(self.repo)
        self.assertEqual(result["entries"][:3], first["entries"])
        self.assertEqual(len(result["entries"]), 4)
        new_plan = self.source if reuse_source else self.planning / "0000012-new.md"
        new_plan.write_text("new retrospective story")
        unrelated.write_text("unrelated staged change")
        self.git("add", "unrelated.txt")

        # Exercise Git's multi-file deletion and path-reuse semantics from the
        # commit prompt, including repeated sources and absent untracked paths.
        paths = [str(new_plan.relative_to(self.repo))]
        for entry in result["entries"]:
            self.assertTrue(verified_archive_entry(self.repo, result["branch"], entry))
            paths.append(entry["archive_path"])
            source = self.repo / entry["source_path"]
            if source == new_plan or (not source.exists() and self.git("ls-files", "--", entry["source_path"]).strip()):
                paths.append(entry["source_path"])
        paths = list(dict.fromkeys(paths))
        self.assertNotIn("planning/12-third.md", paths)
        self.assertEqual(paths.count(str(new_plan.relative_to(self.repo))), 1)
        self.git("add", "-A", "--", *paths)
        self.git("commit", "-m", "retrospective story only", "--only", "--", *paths)

        expected = ["dirty original", "second tracked story", "untracked third story", "another matching source"]
        for entry, content in zip(result["entries"], expected, strict=True):
            self.assertEqual(self.git("show", "HEAD:" + entry["archive_path"]), content)
        self.assertEqual(self.git("show", "HEAD:" + str(new_plan.relative_to(self.repo))), "new retrospective story")
        self.assertEqual(self.git("show", "HEAD:unrelated.txt"), "committed unrelated")
        self.assertIn("unrelated staged change", self.git("diff", "--cached", "--", "unrelated.txt"))
        tree = self.git("ls-tree", "-r", "--name-only", "HEAD").splitlines()
        self.assertNotIn("planning/0000012-secondary.md", tree)
        self.assertNotIn("planning/12-third.md", tree)
        if not reuse_source:
            self.assertNotIn("planning/0000012-original.md", tree)

    def test_final_multi_file_commit_includes_tracked_deletions_and_all_archives_only(self) -> None:
        self.assert_story_only_commit(reuse_source=False)

    def test_final_multi_file_commit_handles_reused_source_and_unrelated_index(self) -> None:
        self.assert_story_only_commit(reuse_source=True)


if __name__ == "__main__":
    unittest.main()
