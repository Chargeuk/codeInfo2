#!/usr/bin/env python3
"""Focused tests for deterministic OpenCode review pointer publishing."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import publish_open_code_review


class PublishOpenCodeReviewTests(unittest.TestCase):
    def make_fixture(
        self, *, bundle_count: int = 1, invalid_bundle_indexes: set[int] | None = None
    ) -> tuple[Path, Path, Path]:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        workspace = Path(tmpdir.name)
        repo = workspace / "repo"
        log_root = workspace / "open-code-review"
        review_root = repo / "codeInfoTmp" / "reviews"
        review_root.mkdir(parents=True)
        log_root.mkdir()
        story_id = "0000013"
        plan_path = "planning/0000013-review.md"
        canonical_pass_id = "0000013-20260715T130508Z-2fbf75b5ee-fbbb2692"
        pass_dir = log_root / f"{canonical_pass_id}-ocr-20260715T130616Z-b8073ccd"
        pass_dir.mkdir()
        handoff = repo / "codeInfoStatus" / "flow-state" / "current-plan.json"
        handoff.parent.mkdir(parents=True)
        handoff.write_text(json.dumps({"plan_path": plan_path}), encoding="utf-8")
        context_relative = f"codeInfoTmp/reviews/{story_id}-current-review-context.json"
        (repo / context_relative).write_text(
            json.dumps(
                {
                    "schema_version": "codeinfo-review-context/v1",
                    "sections": {
                        "overview": {
                            "source_heading": "Description",
                            "markdown": "Description text.",
                        },
                        "acceptance_criteria": {
                            "source_heading": "Acceptance Criteria",
                            "markdown": "Acceptance text.",
                        },
                        "out_of_scope": None,
                    },
                }
            ),
            encoding="utf-8",
        )
        prepared_base = {
            "schema_version": 2,
            "story_id": story_id,
            "plan_path": plan_path,
            "review_session_id": f"{story_id}-rs-session",
            "review_pass_id": canonical_pass_id,
            "parent_execution_id": "parent-execution",
            "comparison_base_commit": "a" * 40,
            "head_commit": "b" * 40,
            "repo_alias": "current_repository",
            "repo_root": str(repo),
            "branch": "feature/0000013-review",
            "branched_from": "main",
            "logical_base_branch": "main",
            "resolved_base_branch": "origin/main",
            "resolved_base_source": "remote",
            "remote_name": "origin",
            "remote_fetch_status": "succeeded",
            "local_fallback_reason": None,
            "comparison_base_ref": "origin/main",
            "comparison_head_ref": "HEAD",
            "comparison_rule": "local_head_vs_resolved_base",
            "review_context_file": context_relative,
            "review_context_sha256": "context-hash",
            "review_context_source_plan_sha256": "plan-hash",
            "review_excluded_paths": ["planning/**"],
            "status": "completed",
        }
        (review_root / f"{story_id}-current-review-base.json").write_text(
            json.dumps(prepared_base), encoding="utf-8"
        )

        invalid_indexes = invalid_bundle_indexes or set()
        manifest_bundles = []
        for index in range(bundle_count):
            bundle_id = f"sha256:{index + 1:064d}"
            manifest_bundles.append(
                {
                    "bundle_id": bundle_id,
                    "summary": {
                        "total_files": 1,
                        "reviewable_files": 1,
                        "excluded_files": 0,
                    },
                }
            )
            (pass_dir / f"comments-{index:04d}.json").write_text(
                json.dumps(
                    {
                        "schema_version": "codex-review-comments/v1",
                        "bundle_id": bundle_id,
                        "summary": {"files_reviewed": 1, "issues_found": 0},
                        "comments": [],
                    }
                ),
                encoding="utf-8",
            )
            (pass_dir / f"validation-{index:04d}.json").write_text(
                json.dumps(
                    {
                        "schema_version": "codex-review-validation/v1",
                        "bundle_id": bundle_id,
                        "valid": index not in invalid_indexes,
                        "errors": [],
                        "warnings": [],
                    }
                ),
                encoding="utf-8",
            )
            (pass_dir / f"report-{index:04d}.md").write_text(
                f"# Bundle {index}\n", encoding="utf-8"
            )
        (pass_dir / "bundle-manifest.json").write_text(
            json.dumps(
                {
                    "schema_version": "codex-review-manifest/v1",
                    "partial": bool(invalid_indexes),
                    "summary": {
                        "total_files": bundle_count,
                        "reviewable_files": bundle_count,
                        "excluded_files": 0,
                    },
                    "skipped_files": [],
                    "bundles": manifest_bundles,
                }
            ),
            encoding="utf-8",
        )
        (pass_dir / "ocr-version.txt").write_text(
            "open-code-review test-version\n", encoding="utf-8"
        )
        (pass_dir / "open-code-review.md").write_text(
            "# OpenCode Review\n\nNo findings.\n", encoding="utf-8"
        )
        return repo, log_root, pass_dir

    def test_publishes_canonical_pointer_and_aggregate(self) -> None:
        repo, log_root, pass_dir = self.make_fixture(bundle_count=2)

        result = publish_open_code_review.publish_open_code_review(
            repo_root=repo,
            pass_dir=pass_dir,
            ocr_log_root=log_root,
            completed_at="2026-07-15T13:07:00Z",
        )

        pointer_path = Path(result["pointer_file"])
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        log_pointer = json.loads(
            (log_root / "current-open-code-review.json").read_text(encoding="utf-8")
        )
        self.assertEqual(pointer, log_pointer)
        self.assertEqual(pointer["schema_version"], "codeinfo-open-code-review/v1")
        self.assertEqual(len(pointer["bundles"]), 2)
        self.assertNotIn("bundle_artifacts", pointer)
        self.assertEqual(
            pointer["bundles"][0],
            {
                "bundle_id": f"sha256:{1:064d}",
                "comments_path": str(pass_dir / "comments-0000.json"),
                "validation_path": str(pass_dir / "validation-0000.json"),
                "report_path": str(pass_dir / "report-0000.md"),
            },
        )
        self.assertEqual(pointer["coverage"]["reviewed_files"], 2)
        self.assertEqual(pointer["overall_validation_status"], "valid")
        self.assertFalse(pointer["partial"])
        aggregate_path = repo / pointer["review_output_file"]
        self.assertEqual(
            aggregate_path.read_bytes(), (pass_dir / "open-code-review.md").read_bytes()
        )

    def test_validate_only_performs_no_writes(self) -> None:
        repo, log_root, pass_dir = self.make_fixture()

        result = publish_open_code_review.publish_open_code_review(
            repo_root=repo,
            pass_dir=pass_dir,
            validate_only=True,
            ocr_log_root=log_root,
        )

        self.assertEqual(result["mode"], "validate-only")
        self.assertFalse(Path(result["pointer_file"]).exists())
        self.assertFalse((log_root / "current-open-code-review.json").exists())
        self.assertFalse((repo / result["review_output_file"]).exists())

    def test_derives_partial_coverage_from_invalid_bundles(self) -> None:
        repo, log_root, pass_dir = self.make_fixture(
            bundle_count=2, invalid_bundle_indexes={1}
        )

        pointer, _, _ = publish_open_code_review.build_open_code_review_pointer(
            repo_root=repo, pass_dir=pass_dir, ocr_log_root=log_root
        )

        self.assertEqual(pointer["coverage"]["reviewed_files"], 1)
        self.assertEqual(pointer["coverage"]["failed_files"], 1)
        self.assertEqual(pointer["overall_validation_status"], "partial")
        self.assertTrue(pointer["partial"])

    def test_rejects_bundle_identity_mismatch(self) -> None:
        repo, log_root, pass_dir = self.make_fixture()
        comments_path = pass_dir / "comments-0000.json"
        comments = json.loads(comments_path.read_text(encoding="utf-8"))
        comments["bundle_id"] = "sha256:wrong"
        comments_path.write_text(json.dumps(comments), encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "different bundle_id"):
            publish_open_code_review.build_open_code_review_pointer(
                repo_root=repo, pass_dir=pass_dir, ocr_log_root=log_root
            )

    def test_rejects_missing_fixed_name_artifact(self) -> None:
        repo, log_root, pass_dir = self.make_fixture()
        (pass_dir / "report-0000.md").unlink()

        with self.assertRaisesRegex(ValueError, "report is missing"):
            publish_open_code_review.build_open_code_review_pointer(
                repo_root=repo, pass_dir=pass_dir, ocr_log_root=log_root
            )

    def test_rejects_pass_directory_outside_log_root(self) -> None:
        repo, log_root, pass_dir = self.make_fixture()
        outside = log_root.parent / "outside"
        pass_dir.rename(outside)

        with self.assertRaisesRegex(ValueError, "resolves outside"):
            publish_open_code_review.build_open_code_review_pointer(
                repo_root=repo, pass_dir=outside, ocr_log_root=log_root
            )

    def test_rejects_bundle_artifact_symlink_outside_pass_directory(self) -> None:
        repo, log_root, pass_dir = self.make_fixture()
        outside_report = log_root.parent / "outside-report.md"
        outside_report.write_text("# Outside\n", encoding="utf-8")
        report_path = pass_dir / "report-0000.md"
        report_path.unlink()
        report_path.symlink_to(outside_report)

        with self.assertRaisesRegex(ValueError, "resolves outside"):
            publish_open_code_review.build_open_code_review_pointer(
                repo_root=repo, pass_dir=pass_dir, ocr_log_root=log_root
            )


if __name__ == "__main__":
    unittest.main()
