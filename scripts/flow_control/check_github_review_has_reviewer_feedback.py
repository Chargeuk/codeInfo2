#!/usr/bin/env python3
import json
import os
import re
from pathlib import Path


def _read_json(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise RuntimeError(f"{path.name} must be a JSON object")
    return raw


def _execution_file_token(execution_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", execution_id)


def _load_execution_scoped_handoff(
    repo_root: Path,
    *,
    execution_id: str,
    handoff_path_raw: str,
    expected_pr_number_raw: str,
) -> dict:
    handoff_path = Path(handoff_path_raw)
    if not handoff_path.is_absolute():
        handoff_path = repo_root / handoff_path
    handoff = _read_json(handoff_path)
    if str(handoff.get("handoff_kind", "")).strip() != "github-review-handoff-v1":
        raise RuntimeError(
            "GitHub review handoff is missing the supported Task 12 handoff marker"
        )
    if str(handoff.get("execution_id", "")).strip() != execution_id:
        raise RuntimeError(
            "GitHub review handoff execution_id does not match the persisted execution-scoped ownership contract"
        )
    if expected_pr_number_raw.strip():
        expected_pr_number = int(expected_pr_number_raw)
        actual_pr_number = (
            handoff.get("pull_request", {}).get("number")
            if isinstance(handoff.get("pull_request"), dict)
            else None
        )
        if actual_pr_number != expected_pr_number:
            raise RuntimeError(
                "GitHub review handoff pull_request.number does not match the persisted execution-scoped ownership contract"
            )
    return handoff


def main() -> int:
    repo_root = Path.cwd()
    current_plan_path = repo_root / "codeInfoStatus/flow-state/current-plan.json"
    current_plan = _read_json(current_plan_path)
    plan_path = str(current_plan.get("plan_path", "")).strip()
    story_number = Path(plan_path).name.split("-", 1)[0]
    if not story_number:
        raise RuntimeError("current-plan handoff does not expose a story number")

    reviews_dir = repo_root / "codeInfoTmp/reviews"
    persisted_execution_id = os.environ.get("CODEINFO_GITHUB_REVIEW_EXECUTION_ID", "")
    persisted_handoff_path = os.environ.get("CODEINFO_GITHUB_REVIEW_HANDOFF_PATH", "")
    persisted_pr_number = os.environ.get("CODEINFO_GITHUB_REVIEW_PR_NUMBER", "")
    if persisted_execution_id.strip() and persisted_handoff_path.strip():
        handoff = _load_execution_scoped_handoff(
            repo_root,
            execution_id=persisted_execution_id.strip(),
            handoff_path_raw=persisted_handoff_path.strip(),
            expected_pr_number_raw=persisted_pr_number,
        )
    else:
        selector_path = reviews_dir / f"{story_number}-github-review-current.json"
        selector = _read_json(selector_path)
        if selector.get("selector_kind") != "github-review-selector-v1":
            raise RuntimeError(
                "GitHub review selector is missing the supported Task 12 ownership marker"
            )

        execution_id = str(selector.get("execution_id", "")).strip()
        handoff_path_raw = str(selector.get("handoff_path", "")).strip()
        if not execution_id or not handoff_path_raw:
            raise RuntimeError(
                "GitHub review selector is missing the supported execution_id or handoff_path"
            )

        handoff_path = Path(handoff_path_raw)
        expected_handoff_path = (
            reviews_dir
            / f"{story_number}-github-review-{_execution_file_token(execution_id)}-current.json"
        )
        if handoff_path.resolve() != expected_handoff_path.resolve():
            raise RuntimeError(
                "GitHub review selector handoff_path does not match the supported execution-scoped ownership contract"
            )
        handoff = _load_execution_scoped_handoff(
            repo_root,
            execution_id=execution_id,
            handoff_path_raw=handoff_path_raw,
            expected_pr_number_raw="",
        )
    review_count = int(handoff.get("filtered_review_count", 0) or 0)
    comment_count = int(handoff.get("filtered_review_comment_count", 0) or 0)

    answer = "yes" if (review_count + comment_count) > 0 else "no"
    print(json.dumps({"answer": answer}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
