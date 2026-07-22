"""Deterministic, stateless pull-request comment queue checks."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from flow_control.decision import DecisionOutcome, no, yes


AI_RESPONSE_PREFIX = "#AI Response: "
DEFAULT_CONNECTION = "default"
DEFAULT_PAGE_LIMIT = 50
MAX_PAGES = 10_000
PR_LINE_PATTERN = re.compile(
    r"^-\s+"
    r"(?P<url>https://bitbucket\.org/(?P<workspace>[^/\s]+)/"
    r"(?P<repo>[^/\s]+)/pull-requests/(?P<pr_id>[1-9][0-9]*))"
    r"(?P<in_scope>\s+\*\*IN_SCOPE\*\*)?\s*$"
)


class PrCommentGateError(RuntimeError):
    """Raised when the gate cannot safely establish remote queue state."""


@dataclass(frozen=True)
class PullRequestRef:
    url: str
    workspace: str
    repo: str
    pr_id: int
    in_scope: bool


GtRunner = Callable[[Sequence[str]], Mapping[str, Any]]


def default_pr_list_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "codeinfo_markdown"
        / "handle_pr_comments_prs.md"
    )


def resolve_pr_list_path() -> Path:
    configured = os.environ.get("CODEINFO_PR_COMMENTS_FILE", "").strip()
    return Path(configured).expanduser() if configured else default_pr_list_path()


def parse_pr_list(content: str) -> list[PullRequestRef]:
    references: dict[str, PullRequestRef] = {}
    for line_number, raw_line in enumerate(content.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        match = PR_LINE_PATTERN.fullmatch(line)
        if not match:
            raise PrCommentGateError(
                f"invalid PR list entry on line {line_number}"
            )
        reference = PullRequestRef(
            url=match.group("url"),
            workspace=match.group("workspace"),
            repo=match.group("repo"),
            pr_id=int(match.group("pr_id")),
            in_scope=match.group("in_scope") is not None,
        )
        existing = references.get(reference.url)
        if existing is None:
            references[reference.url] = reference
        elif reference.in_scope and not existing.in_scope:
            references[reference.url] = reference

    if not references:
        raise PrCommentGateError("PR list contains no pull requests")
    return list(references.values())


def require_in_scope_pr(references: Sequence[PullRequestRef]) -> PullRequestRef:
    marked = [reference for reference in references if reference.in_scope]
    if len(marked) != 1:
        raise PrCommentGateError(
            f"PR list must contain exactly one IN_SCOPE pull request; found {len(marked)}"
        )
    return marked[0]


def _candidate_gt_paths() -> list[Path]:
    configured = os.environ.get("CODEINFO_GT_BIN", "").strip()
    candidates = [Path(configured).expanduser()] if configured else []
    candidates.extend(
        [
            Path(
                "/home/dastapleton/code/enterprise-gt/services/enterprise-gt/bin/gt"
            ),
            Path("/home/dastapleton/code/gt/gt"),
            Path("/data/enterprise-gt/services/enterprise-gt/bin/gt"),
            Path("/data/gt/gt"),
        ]
    )
    discovered = shutil.which("gt")
    if discovered:
        candidates.append(Path(discovered))
    return candidates


def resolve_gt_bin() -> Path:
    for candidate in _candidate_gt_paths():
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise PrCommentGateError(
        "gt executable not found; set CODEINFO_GT_BIN to an executable path"
    )


def make_subprocess_gt_runner(
    *,
    gt_bin: Path | None = None,
    connection: str | None = None,
) -> GtRunner:
    executable = gt_bin or resolve_gt_bin()
    connection_name = (
        connection
        or os.environ.get("CODEINFO_GT_BITBUCKET_CONNECTION", "").strip()
        or DEFAULT_CONNECTION
    )

    def run(arguments: Sequence[str]) -> Mapping[str, Any]:
        command = [str(executable), *arguments, "--connection", connection_name, "--json"]
        try:
            result = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise PrCommentGateError("gt command failed") from error
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise PrCommentGateError("gt returned invalid JSON") from error
        if not isinstance(payload, Mapping):
            raise PrCommentGateError("gt returned a non-object JSON payload")
        return payload

    return run


def _ensure_in_scope_pr_is_open(
    reference: PullRequestRef,
    runner: GtRunner,
) -> None:
    payload = runner(
        [
            "bitbucket",
            "prs",
            "get",
            str(reference.pr_id),
            "--repo",
            reference.repo,
        ]
    )
    if payload.get("state") != "OPEN":
        raise PrCommentGateError("IN_SCOPE pull request is not open")


def _list_all_comments(
    reference: PullRequestRef,
    runner: GtRunner,
) -> list[Mapping[str, Any]]:
    comments: list[Mapping[str, Any]] = []
    page = 1
    while page <= MAX_PAGES:
        payload = runner(
            [
                "bitbucket",
                "prs",
                "comments",
                "list",
                str(reference.pr_id),
                "--repo",
                reference.repo,
                "--limit",
                str(DEFAULT_PAGE_LIMIT),
                "--page",
                str(page),
            ]
        )
        values = payload.get("values")
        if not isinstance(values, list):
            raise PrCommentGateError("gt comments payload has no values array")
        if any(not isinstance(value, Mapping) for value in values):
            raise PrCommentGateError("gt comments payload contains a non-object comment")
        comments.extend(values)
        if not payload.get("next"):
            return comments
        page += 1
    raise PrCommentGateError("gt comments pagination exceeded safety limit")


def _parse_created_on(comment: Mapping[str, Any]) -> datetime:
    raw = comment.get("created_on")
    if not isinstance(raw, str):
        raise PrCommentGateError("comment has no created_on timestamp")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise PrCommentGateError("comment has an invalid created_on timestamp") from error
    if parsed.tzinfo is None:
        raise PrCommentGateError("comment created_on timestamp has no timezone")
    return parsed.astimezone(UTC)


def _comment_id(comment: Mapping[str, Any]) -> int:
    value = comment.get("id")
    if not isinstance(value, int):
        raise PrCommentGateError("comment has no integer id")
    return value


def _parent_id(comment: Mapping[str, Any]) -> int | None:
    parent = comment.get("parent")
    if parent is None:
        return None
    if not isinstance(parent, Mapping) or not isinstance(parent.get("id"), int):
        raise PrCommentGateError("comment has an invalid parent")
    return parent["id"]


def _root_id(
    comment_id: int,
    comments_by_id: Mapping[int, Mapping[str, Any]],
) -> int:
    current_id = comment_id
    visited: set[int] = set()
    while True:
        if current_id in visited:
            raise PrCommentGateError("comment parent graph contains a cycle")
        visited.add(current_id)
        comment = comments_by_id.get(current_id)
        if comment is None:
            return current_id
        parent_id = _parent_id(comment)
        if parent_id is None:
            return current_id
        current_id = parent_id


def has_eligible_threads(
    comments: Sequence[Mapping[str, Any]],
    *,
    now: datetime,
) -> bool:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    cutoff = now.astimezone(UTC) - timedelta(hours=24)
    comments_by_id = {_comment_id(comment): comment for comment in comments}
    eligible_threads: dict[int, list[Mapping[str, Any]]] = {}

    for comment in comments:
        if comment.get("deleted") is True or _parse_created_on(comment) < cutoff:
            continue
        root_id = _root_id(_comment_id(comment), comments_by_id)
        eligible_threads.setdefault(root_id, []).append(comment)

    for thread in eligible_threads.values():
        final_comment = max(
            thread,
            key=lambda comment: (_parse_created_on(comment), _comment_id(comment)),
        )
        content = final_comment.get("content")
        raw = content.get("raw") if isinstance(content, Mapping) else None
        if not isinstance(raw, str) or not raw.startswith(AI_RESPONSE_PREFIX):
            return True
    return False


def evaluate_pr_comment_threads(
    *,
    pr_list_path: Path | None = None,
    runner: GtRunner | None = None,
    now: datetime | None = None,
) -> DecisionOutcome:
    try:
        target_path = pr_list_path or resolve_pr_list_path()
        references = parse_pr_list(target_path.read_text(encoding="utf-8"))
        in_scope = require_in_scope_pr(references)
        active_runner = runner or make_subprocess_gt_runner()
        _ensure_in_scope_pr_is_open(in_scope, active_runner)
        comments_by_pr: list[list[Mapping[str, Any]]] = []
        for reference in references:
            comments_by_pr.append(_list_all_comments(reference, active_runner))
        evaluated_at = now or datetime.now(UTC)
        if any(
            has_eligible_threads(comments, now=evaluated_at)
            for comments in comments_by_pr
        ):
            return no("eligible_pr_threads_present")
        return yes("no_eligible_pr_threads")
    except (OSError, PrCommentGateError, UnicodeError) as error:
        print(f"PR comment queue check blocked: {error}", file=sys.stderr)
        return yes("pr_comment_queue_blocked", error_type=type(error).__name__)
