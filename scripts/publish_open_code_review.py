#!/usr/bin/env python3
"""Build and publish the canonical OpenCode review pointer."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


POINTER_SCHEMA_VERSION = "codeinfo-open-code-review/v1"
CONTEXT_SCHEMA_VERSION = "codeinfo-review-context/v1"
MANIFEST_SCHEMA_VERSION = "codex-review-manifest/v1"
COMMENTS_SCHEMA_VERSION = "codex-review-comments/v1"
VALIDATION_SCHEMA_VERSION = "codex-review-validation/v1"
CANONICAL_STORY_PATTERN = re.compile(r"^(\d{7})-")
PREPARED_BASE_PATTERN = re.compile(r"^(\d{7})-current-review-base\.json$")
SAFE_PASS_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
OCR_LOG_ROOT = Path("/app/logs/open-code-review")
SCOPE_FIELDS = (
    "repo_alias",
    "repo_root",
    "branch",
    "branched_from",
    "logical_base_branch",
    "resolved_base_branch",
    "resolved_base_source",
    "remote_name",
    "remote_fetch_status",
    "remote_fetch_error",
    "remote_fetch_exit_code",
    "local_fallback_reason",
    "comparison_base_ref",
    "comparison_head_ref",
    "comparison_rule",
    "review_context_file",
    "review_context_sha256",
    "review_context_source_plan_sha256",
    "review_excluded_paths",
)
WAVE_SCOPE_FIELDS = ("target_id", "review_wave_id", "plan_host_root")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and publish an OpenCode review pointer."
    )
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--prepared-base", required=True)
    parser.add_argument("--pass-dir", required=True)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def _read_object(path: Path, label: str) -> dict[str, Any]:
    try:
        parsed: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} could not be read as JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return parsed


def _required_string(record: dict[str, Any], field: str, label: str) -> str:
    value = record.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label}.{field} is missing")
    return value.strip()


def _required_integer(record: dict[str, Any], field: str, label: str) -> int:
    value = record.get(field)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label}.{field} must be a non-negative integer")
    return value


def _assert_contained(root: Path, candidate: Path, label: str) -> Path:
    try:
        resolved_root = root.resolve(strict=True)
        resolved_candidate = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError(f"{label} is missing: {candidate}") from exc
    except OSError as exc:
        raise ValueError(f"{label} could not be resolved: {exc}") from exc
    if not resolved_candidate.is_relative_to(resolved_root):
        raise ValueError(f"{label} resolves outside {resolved_root}")
    return resolved_candidate


def _atomic_write_bytes(path: Path, contents: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    _atomic_write_bytes(
        path, (json.dumps(payload, indent=2) + "\n").encode("utf-8")
    )


def _selected_source_headings(context: dict[str, Any]) -> list[str]:
    if context.get("schema_version") != CONTEXT_SCHEMA_VERSION:
        raise ValueError("prepared review context has an unsupported schema")
    sections = context.get("sections")
    if not isinstance(sections, dict):
        raise ValueError("prepared review context sections are missing")
    headings: list[str] = []
    for key in ("overview", "acceptance_criteria", "out_of_scope"):
        section = sections.get(key)
        if section is None and key == "out_of_scope":
            continue
        if not isinstance(section, dict):
            raise ValueError(f"prepared review context section {key} is malformed")
        heading = section.get("source_heading")
        if not isinstance(heading, str) or not heading.strip():
            raise ValueError(
                f"prepared review context section {key} has no source heading"
            )
        headings.append(heading.strip())
    return headings


def _bundle_pointer(
    *, pass_dir: Path, bundle: dict[str, Any], index: int
) -> tuple[dict[str, str], int, bool, list[dict[str, Any]]]:
    label = f"manifest.bundles[{index}]"
    bundle_id = _required_string(bundle, "bundle_id", label)
    summary = bundle.get("summary")
    if not isinstance(summary, dict):
        raise ValueError(f"{label}.summary is missing")
    reviewable_files = _required_integer(summary, "reviewable_files", f"{label}.summary")

    comments_path = _assert_contained(
        pass_dir,
        pass_dir / f"comments-{index:04d}.json",
        f"bundle {bundle_id} comments",
    )
    validation_path = _assert_contained(
        pass_dir,
        pass_dir / f"validation-{index:04d}.json",
        f"bundle {bundle_id} validation",
    )
    report_path = _assert_contained(
        pass_dir,
        pass_dir / f"report-{index:04d}.md",
        f"bundle {bundle_id} report",
    )
    if not report_path.is_file():
        raise ValueError(f"bundle {bundle_id} report is not a file: {report_path}")
    comments = _read_object(comments_path, f"bundle {bundle_id} comments")
    validation = _read_object(validation_path, f"bundle {bundle_id} validation")
    if comments.get("schema_version") != COMMENTS_SCHEMA_VERSION:
        raise ValueError(f"bundle {bundle_id} comments have an unsupported schema")
    if comments.get("bundle_id") != bundle_id:
        raise ValueError(f"bundle {bundle_id} comments use a different bundle_id")
    comments_summary = comments.get("summary")
    if not isinstance(comments_summary, dict):
        raise ValueError(f"bundle {bundle_id} comments summary is missing")
    files_reviewed = _required_integer(
        comments_summary, "files_reviewed", f"bundle {bundle_id} comments.summary"
    )
    issues_found = _required_integer(
        comments_summary, "issues_found", f"bundle {bundle_id} comments.summary"
    )
    raw_comments = comments.get("comments")
    if not isinstance(raw_comments, list) or len(raw_comments) != issues_found:
        raise ValueError(
            f"bundle {bundle_id} comments must contain exactly {issues_found} entries"
        )
    structured_findings: list[dict[str, Any]] = []
    for comment_index, raw_comment in enumerate(raw_comments):
        if not isinstance(raw_comment, dict):
            raise ValueError(
                f"bundle {bundle_id} comments[{comment_index}] is malformed"
            )
        title = raw_comment.get("title")
        priority = raw_comment.get("priority")
        comment_path = raw_comment.get("path")
        if not isinstance(title, str) or not title.strip():
            raise ValueError(
                f"bundle {bundle_id} comments[{comment_index}].title is missing"
            )
        if not isinstance(priority, str) or not priority.strip():
            raise ValueError(
                f"bundle {bundle_id} comments[{comment_index}].priority is missing"
            )
        if not isinstance(comment_path, str) or not comment_path.strip():
            raise ValueError(
                f"bundle {bundle_id} comments[{comment_index}].path is missing"
            )
        line = raw_comment.get("line")
        if not isinstance(line, int) or isinstance(line, bool):
            line_range = raw_comment.get("line_range")
            line = (
                line_range.get("start")
                if isinstance(line_range, dict)
                and isinstance(line_range.get("start"), int)
                and not isinstance(line_range.get("start"), bool)
                else None
            )
        structured_findings.append(
            {
                **raw_comment,
                "bundle_id": bundle_id,
                "title": title.strip(),
                "severity": priority.strip(),
                "path": comment_path.strip(),
                "line": line,
            }
        )
    if files_reviewed != reviewable_files:
        raise ValueError(
            f"bundle {bundle_id} comments reviewed {files_reviewed} files; "
            f"the manifest requires {reviewable_files}"
        )
    if validation.get("schema_version") != VALIDATION_SCHEMA_VERSION:
        raise ValueError(f"bundle {bundle_id} validation has an unsupported schema")
    if validation.get("bundle_id") != bundle_id:
        raise ValueError(f"bundle {bundle_id} validation uses a different bundle_id")
    valid = validation.get("valid")
    if not isinstance(valid, bool):
        raise ValueError(f"bundle {bundle_id} validation.valid must be boolean")
    return (
        {
            "bundle_id": bundle_id,
            "comments_path": str(comments_path),
            "validation_path": str(validation_path),
            "report_path": str(report_path),
        },
        reviewable_files,
        valid,
        structured_findings,
    )


def build_open_code_review_pointer(
    *,
    repo_root: str | Path,
    prepared_base_path: str | Path,
    pass_dir: str | Path,
    ocr_log_root: str | Path = OCR_LOG_ROOT,
    completed_at: str | None = None,
) -> tuple[dict[str, Any], Path, Path]:
    root = Path(repo_root).resolve(strict=True)
    log_root = Path(ocr_log_root).resolve(strict=True)
    resolved_pass_dir = _assert_contained(
        log_root, Path(pass_dir), "OpenCode review pass directory"
    )
    pass_id = resolved_pass_dir.name
    if SAFE_PASS_ID_PATTERN.fullmatch(pass_id) is None:
        raise ValueError("OpenCode review pass directory name is not a safe pass ID")

    review_root = root / "codeInfoTmp" / "reviews"
    prepared_base_candidate = Path(prepared_base_path)
    if not prepared_base_candidate.is_absolute():
        prepared_base_candidate = root / prepared_base_candidate
    resolved_prepared_base = _assert_contained(
        review_root, prepared_base_candidate, "prepared review base"
    )
    prepared_name_match = PREPARED_BASE_PATTERN.fullmatch(
        resolved_prepared_base.name
    )
    if prepared_name_match is None:
        raise ValueError("prepared review base filename is not canonical")
    prepared_base = _read_object(resolved_prepared_base, "prepared review base")
    story_id = _required_string(prepared_base, "story_id", "prepared review base")
    if prepared_name_match.group(1) != story_id:
        raise ValueError("prepared review base story_id does not match its filename")
    plan_path = _required_string(prepared_base, "plan_path", "prepared review base")
    story_match = CANONICAL_STORY_PATTERN.match(Path(plan_path).name)
    if story_match is None:
        raise ValueError("prepared review base plan_path has no canonical story ID")
    if story_match.group(1) != story_id:
        raise ValueError("prepared review base plan_path does not match story_id")
    prepared_repo_root = Path(
        _required_string(prepared_base, "repo_root", "prepared review base")
    ).resolve(strict=True)
    if prepared_repo_root != root:
        raise ValueError("prepared review base repo_root does not match --repo-root")
    canonical_pass_id = _required_string(
        prepared_base, "review_pass_id", "prepared review base"
    )
    if not pass_id.startswith(f"{canonical_pass_id}-ocr-"):
        raise ValueError(
            "OpenCode review pass ID does not belong to the prepared review pass"
        )

    context_relative = _required_string(
        prepared_base, "review_context_file", "prepared review base"
    )
    context_path = _assert_contained(
        review_root, root / context_relative, "prepared review context"
    )
    context = _read_object(context_path, "prepared review context")
    selected_source_headings = _selected_source_headings(context)

    manifest_path = _assert_contained(
        resolved_pass_dir,
        resolved_pass_dir / "bundle-manifest.json",
        "OCR manifest",
    )
    manifest = _read_object(manifest_path, "OCR manifest")
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise ValueError("OCR manifest has an unsupported schema")
    manifest_bundles = manifest.get("bundles")
    if not isinstance(manifest_bundles, list):
        raise ValueError("OCR manifest bundles are missing")
    manifest_summary = manifest.get("summary")
    if not isinstance(manifest_summary, dict):
        raise ValueError("OCR manifest summary is missing")
    total_files = _required_integer(manifest_summary, "total_files", "manifest.summary")
    reviewable_files = _required_integer(
        manifest_summary, "reviewable_files", "manifest.summary"
    )
    excluded_files = _required_integer(
        manifest_summary, "excluded_files", "manifest.summary"
    )
    if total_files != reviewable_files + excluded_files:
        raise ValueError("OCR manifest summary counts conflict")
    skipped_file_entries = manifest.get("skipped_files")
    if not isinstance(skipped_file_entries, list):
        raise ValueError("OCR manifest skipped_files are missing")
    skipped_files = len(skipped_file_entries)
    if not isinstance(manifest.get("partial"), bool):
        raise ValueError("OCR manifest partial flag is missing")

    bundles: list[dict[str, str]] = []
    reviewed_files = 0
    seen_bundle_ids: set[str] = set()
    findings: list[dict[str, Any]] = []
    for index, raw_bundle in enumerate(manifest_bundles):
        if not isinstance(raw_bundle, dict):
            raise ValueError(f"manifest.bundles[{index}] is malformed")
        pointer_bundle, bundle_reviewable_files, valid, bundle_findings = _bundle_pointer(
            pass_dir=resolved_pass_dir, bundle=raw_bundle, index=index
        )
        bundle_id = pointer_bundle["bundle_id"]
        if bundle_id in seen_bundle_ids:
            raise ValueError(f"OCR manifest contains duplicate bundle {bundle_id}")
        seen_bundle_ids.add(bundle_id)
        bundles.append(pointer_bundle)
        if valid:
            reviewed_files += bundle_reviewable_files
            findings.extend(bundle_findings)
    if reviewed_files + skipped_files > reviewable_files:
        raise ValueError("OCR reviewed and skipped file counts exceed reviewable files")
    failed_files = reviewable_files - reviewed_files - skipped_files
    partial = (
        manifest["partial"]
        or skipped_files > 0
        or failed_files > 0
        or reviewed_files != reviewable_files
    )
    overall_status = (
        "invalid"
        if reviewable_files > 0 and reviewed_files == 0
        else "partial" if partial else "valid"
    )

    ocr_version_path = _assert_contained(
        resolved_pass_dir,
        resolved_pass_dir / "ocr-version.txt",
        "OCR version file",
    )
    try:
        ocr_version = ocr_version_path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise ValueError(f"OCR version file could not be read: {exc}") from exc
    if not ocr_version:
        raise ValueError("OCR version file is empty")
    aggregate_source = _assert_contained(
        resolved_pass_dir,
        resolved_pass_dir / "open-code-review.md",
        "OpenCode aggregate report",
    )
    if not aggregate_source.is_file():
        raise ValueError(
            f"OpenCode aggregate report is not a file: {aggregate_source}"
        )
    aggregate_target = review_root / f"{pass_id}-open-code-review.md"
    stable_pointer = review_root / f"{story_id}-current-open-code-review.json"

    for field in (
        "review_session_id",
        "parent_execution_id",
        "comparison_base_commit",
        "head_commit",
    ):
        _required_string(prepared_base, field, "prepared review base")
    missing_scope_fields = [field for field in SCOPE_FIELDS if field not in prepared_base]
    optional_scope_fields = {"remote_fetch_error", "remote_fetch_exit_code"}
    missing_required_scope = [
        field for field in missing_scope_fields if field not in optional_scope_fields
    ]
    if missing_required_scope:
        raise ValueError(
            "prepared review base is missing scope fields: "
            + ", ".join(missing_required_scope)
        )
    scope = {field: prepared_base[field] for field in SCOPE_FIELDS if field in prepared_base}
    present_wave_fields = [
        field for field in WAVE_SCOPE_FIELDS if field in prepared_base
    ]
    if present_wave_fields and len(present_wave_fields) != len(WAVE_SCOPE_FIELDS):
        missing_wave_fields = [
            field for field in WAVE_SCOPE_FIELDS if field not in prepared_base
        ]
        raise ValueError(
            "prepared review base has incomplete wave scope; missing: "
            + ", ".join(missing_wave_fields)
        )
    wave_scope = {
        field: _required_string(prepared_base, field, "prepared review base")
        for field in WAVE_SCOPE_FIELDS
        if field in prepared_base
    }
    pointer: dict[str, Any] = {
        "schema_version": POINTER_SCHEMA_VERSION,
        "story_id": story_id,
        "plan_path": plan_path,
        "review_session_id": prepared_base["review_session_id"],
        "canonical_review_pass_id": canonical_pass_id,
        "parent_execution_id": prepared_base["parent_execution_id"],
        "open_code_review_pass_id": pass_id,
        "comparison_base_commit": prepared_base["comparison_base_commit"],
        "head_commit": prepared_base["head_commit"],
        **scope,
        **wave_scope,
        "selected_source_headings": selected_source_headings,
        "ocr_version": ocr_version,
        "manifest_path": str(manifest_path),
        "bundles": bundles,
        "coverage": {
            "total_files": total_files,
            "reviewable_files": reviewable_files,
            "reviewed_files": reviewed_files,
            "excluded_files": excluded_files,
            "skipped_files": skipped_files,
            "failed_files": failed_files,
        },
        "overall_validation_status": overall_status,
        "partial": partial,
        "review_output_file": aggregate_target.relative_to(root).as_posix(),
        "findings": findings,
        "findings_file": None,
        "merged_into_canonical_findings": False,
        "merged_findings_file": None,
        "merge_output_file": None,
        "status": "completed",
        "completed_at": completed_at
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    return pointer, stable_pointer, aggregate_target


def publish_open_code_review(
    *,
    repo_root: str | Path,
    prepared_base_path: str | Path,
    pass_dir: str | Path,
    validate_only: bool = False,
    ocr_log_root: str | Path = OCR_LOG_ROOT,
    completed_at: str | None = None,
) -> dict[str, Any]:
    pointer, stable_pointer, aggregate_target = build_open_code_review_pointer(
        repo_root=repo_root,
        prepared_base_path=prepared_base_path,
        pass_dir=pass_dir,
        ocr_log_root=ocr_log_root,
        completed_at=completed_at,
    )
    pass_path = Path(pass_dir).resolve(strict=True)
    log_pointer = Path(ocr_log_root).resolve(strict=True) / "current-open-code-review.json"
    if not validate_only:
        _atomic_write_bytes(
            aggregate_target, (pass_path / "open-code-review.md").read_bytes()
        )
        _atomic_write_json(log_pointer, pointer)
        _atomic_write_json(stable_pointer, pointer)
    return {
        "valid": True,
        "mode": "validate-only" if validate_only else "published",
        "story_id": pointer["story_id"],
        "open_code_review_pass_id": pointer["open_code_review_pass_id"],
        "bundle_count": len(pointer["bundles"]),
        "partial": pointer["partial"],
        "pointer_file": str(stable_pointer),
        "log_pointer_file": str(log_pointer),
        "review_output_file": pointer["review_output_file"],
    }


def main() -> int:
    args = parse_args()
    try:
        result = publish_open_code_review(
            repo_root=args.repo_root,
            prepared_base_path=args.prepared_base,
            pass_dir=args.pass_dir,
            validate_only=args.validate_only,
        )
    except (OSError, ValueError) as exc:
        json.dump({"valid": False, "error": str(exc)}, sys.stderr)
        sys.stderr.write("\n")
        return 1
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
