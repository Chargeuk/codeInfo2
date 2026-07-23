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


AI_RESPONSE_PATTERN = re.compile(r"^\s*#AI\s+Response\s*:", re.IGNORECASE)
DEFAULT_CONNECTION = "default"
DEFAULT_PAGE_LIMIT = 50
MAX_PAGES = 10_000
PR_LIST_ITEM_PATTERN = re.compile(r"^\s*[-+*]\s+(?P<body>.*?)\s*$")
PR_URL_PATTERN = re.compile(
    r"https://bitbucket\.org/(?P<workspace>[A-Za-z0-9._-]+)/"
    r"(?P<repo>[A-Za-z0-9._-]+)/pull-requests/(?P<pr_id>[1-9][0-9]*)",
    re.IGNORECASE,
)
IN_SCOPE_PATTERN = re.compile(r"\*\*\s*IN_SCOPE\s*\*\*", re.IGNORECASE)


class PrCommentGateError(RuntimeError):
    """Raised when the gate cannot safely establish remote queue state."""


class PrCommentQueueBlocked(PrCommentGateError):
    """Raised when one or more configured pull requests cannot be inspected."""

    def __init__(self, failed_pr_ids: Sequence[int]) -> None:
        self.failed_pr_ids = tuple(failed_pr_ids)
        super().__init__(
            "could not inspect pull requests "
            + ", ".join(str(pr_id) for pr_id in self.failed_pr_ids)
        )


@dataclass(frozen=True)
class PullRequestRef:
    url: str
    workspace: str
    repo: str
    pr_id: int
    in_scope: bool


@dataclass(frozen=True)
class EligibleLeafSelection:
    """One globally ordered eligible leaf and its complete ancestor path."""

    reference: PullRequestRef
    in_scope: PullRequestRef
    path: tuple[Mapping[str, Any], ...]

    @property
    def leaf_id(self) -> int:
        leaf_id = _comment_id(self.path[-1])
        if leaf_id is None:
            raise PrCommentGateError("selected leaf has no usable id")
        return leaf_id


GtRunner = Callable[[Sequence[str]], Mapping[str, Any]]
WarningSink = Callable[[str], None]


def _ignore_warning(_message: str) -> None:
    return None


def default_pr_list_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "codeinfo_markdown"
        / "handle_pr_comments_prs.md"
    )


def resolve_pr_list_path() -> Path:
    configured = os.environ.get("CODEINFO_PR_COMMENTS_FILE", "").strip()
    return Path(configured).expanduser() if configured else default_pr_list_path()


def parse_pr_list(
    content: str,
    *,
    warn: WarningSink = _ignore_warning,
) -> list[PullRequestRef]:
    references: dict[str, PullRequestRef] = {}
    for line_number, raw_line in enumerate(content.splitlines(), start=1):
        item_match = PR_LIST_ITEM_PATTERN.fullmatch(raw_line)
        if item_match is None:
            continue
        body = item_match.group("body")
        matches = list(PR_URL_PATTERN.finditer(body))
        unique_urls = {match.group(0).casefold() for match in matches}
        if not matches:
            warn(f"ignored list item without a PR URL on line {line_number}")
            continue
        if len(unique_urls) != 1:
            warn(f"ignored ambiguous multi-URL list item on line {line_number}")
            continue
        match = matches[0]
        reference = PullRequestRef(
            url=match.group(0),
            workspace=match.group("workspace"),
            repo=match.group("repo"),
            pr_id=int(match.group("pr_id")),
            in_scope=IN_SCOPE_PATTERN.search(body) is not None,
        )
        reference_key = reference.url.casefold()
        existing = references.get(reference_key)
        if existing is None:
            references[reference_key] = reference
        elif reference.in_scope and not existing.in_scope:
            references[reference_key] = reference

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


def resolve_bitbucket_connection(connection: str | None = None) -> str:
    return (
        connection
        or os.environ.get("CODEINFO_GT_BITBUCKET_CONNECTION", "").strip()
        or DEFAULT_CONNECTION
    )


def make_subprocess_gt_runner(
    *,
    gt_bin: Path | None = None,
    connection: str | None = None,
) -> GtRunner:
    executable = gt_bin or resolve_gt_bin()
    connection_name = resolve_bitbucket_connection(connection)

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
    state = payload.get("state")
    if not isinstance(state, str) or state.strip().upper() != "OPEN":
        raise PrCommentGateError("IN_SCOPE pull request is not open")


def _list_all_comments(
    reference: PullRequestRef,
    runner: GtRunner,
    *,
    warn: WarningSink = _ignore_warning,
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
        object_values = [value for value in values if isinstance(value, Mapping)]
        skipped_count = len(values) - len(object_values)
        if skipped_count:
            warn(
                f"PR {reference.pr_id} page {page} skipped "
                f"{skipped_count} non-object comments"
            )
        comments.extend(object_values)
        if not payload.get("next"):
            return comments
        page += 1
    raise PrCommentGateError("gt comments pagination exceeded safety limit")


def _parse_created_on(
    comment: Mapping[str, Any],
    *,
    warn: WarningSink = _ignore_warning,
) -> datetime | None:
    raw = comment.get("created_on")
    if not isinstance(raw, str):
        warn("comment with unknown creation time remains eligible")
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        warn("comment with invalid creation time remains eligible")
        return None
    if parsed.tzinfo is None:
        warn("comment with timezone-less creation time remains eligible")
        return None
    return parsed.astimezone(UTC)


def _coerce_positive_id(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        return parsed if parsed > 0 else None
    return None


def _comment_id(
    comment: Mapping[str, Any],
    *,
    warn: WarningSink = _ignore_warning,
) -> int | None:
    value = comment.get("id")
    parsed = _coerce_positive_id(value)
    if parsed is None:
        warn("skipped comment without a usable positive id")
    elif isinstance(value, str):
        warn(f"coerced string comment id {parsed}")
    return parsed


def _parent_id(
    comment: Mapping[str, Any],
    *,
    warn: WarningSink = _ignore_warning,
) -> int | None:
    parent = comment.get("parent")
    if parent is None:
        return None
    if not isinstance(parent, Mapping):
        warn("comment with malformed parent was treated as a root")
        return None
    value = parent.get("id")
    parsed = _coerce_positive_id(value)
    if parsed is None:
        warn("comment with unusable parent id was treated as a root")
        return None
    if isinstance(value, str):
        warn(f"coerced string parent id {parsed}")
    return parsed


def _is_deleted(
    comment: Mapping[str, Any],
    *,
    warn: WarningSink = _ignore_warning,
) -> bool:
    value = comment.get("deleted", False)
    if value is True or (
        isinstance(value, str) and value.strip().casefold() == "true"
    ):
        return True
    if value is not False and value is not None:
        warn("comment with an unrecognised deleted flag was treated as visible")
    return False


def _comment_raw(
    comment: Mapping[str, Any],
    *,
    warn: WarningSink = _ignore_warning,
) -> str:
    content = comment.get("content")
    raw = content.get("raw") if isinstance(content, Mapping) else None
    if not isinstance(raw, str):
        warn("visible leaf without a text body remains eligible")
        return ""
    return raw


def _index_comment_graph(
    comments: Sequence[Mapping[str, Any]],
    *,
    warn: WarningSink = _ignore_warning,
) -> tuple[dict[int, Mapping[str, Any]], dict[int, int | None]]:
    comments_by_id: dict[int, Mapping[str, Any]] = {}
    for comment in comments:
        comment_id = _comment_id(comment, warn=warn)
        if comment_id is None:
            continue
        if comment_id in comments_by_id:
            warn(f"ignored duplicate comment id {comment_id}")
            continue
        comments_by_id[comment_id] = comment

    parents: dict[int, int | None] = {}
    for comment_id, comment in comments_by_id.items():
        parent_id = _parent_id(comment, warn=warn)
        if parent_id is not None and parent_id not in comments_by_id:
            warn(
                f"comment {comment_id} missing parent {parent_id}; "
                "treated as a root"
            )
            parent_id = None
        parents[comment_id] = parent_id

    repaired_cycles: set[frozenset[int]] = set()
    for comment_id in comments_by_id:
        current_id: int | None = comment_id
        path: list[int] = []
        positions: dict[int, int] = {}
        while current_id is not None:
            if current_id in positions:
                cycle = frozenset(path[positions[current_id] :])
                if cycle and cycle not in repaired_cycles:
                    repaired_cycles.add(cycle)
                    warn(
                        "broke cyclic comment parents for ids "
                        + ",".join(str(value) for value in sorted(cycle))
                    )
                for cycle_id in cycle:
                    parents[cycle_id] = None
                break
            positions[current_id] = len(path)
            path.append(current_id)
            current_id = parents[current_id]

    return comments_by_id, parents


def _path_to_root(
    leaf_id: int,
    comments_by_id: Mapping[int, Mapping[str, Any]],
    parents: Mapping[int, int | None],
) -> tuple[Mapping[str, Any], ...]:
    path: list[Mapping[str, Any]] = []
    current_id: int | None = leaf_id
    while current_id is not None:
        path.append(comments_by_id[current_id])
        current_id = parents[current_id]
    path.reverse()
    return tuple(path)


def eligible_leaf_paths(
    comments: Sequence[Mapping[str, Any]],
    *,
    now: datetime,
    warn: WarningSink = _ignore_warning,
) -> list[tuple[Mapping[str, Any], ...]]:
    """Return eligible visible root-to-leaf paths, oldest leaf first.

    The 24-hour window applies only to each leaf. Older ancestors remain in the
    returned path so the review agent can understand the complete conversation.
    """
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    cutoff = now.astimezone(UTC) - timedelta(hours=24)
    comments_by_id, parents = _index_comment_graph(comments, warn=warn)

    visible_ids = {
        comment_id
        for comment_id, comment in comments_by_id.items()
        if not _is_deleted(comment, warn=warn)
    }
    ids_with_visible_descendants: set[int] = set()
    for comment_id in visible_ids:
        parent_id = parents[comment_id]
        while parent_id is not None:
            ids_with_visible_descendants.add(parent_id)
            parent_id = parents[parent_id]

    eligible: list[
        tuple[bool, datetime, int, tuple[Mapping[str, Any], ...]]
    ] = []
    for leaf_id in visible_ids - ids_with_visible_descendants:
        leaf = comments_by_id[leaf_id]
        created_on = _parse_created_on(leaf, warn=warn)
        raw = _comment_raw(leaf, warn=warn)
        if created_on is not None and created_on < cutoff:
            continue
        if AI_RESPONSE_PATTERN.match(raw):
            continue
        eligible.append(
            (
                created_on is not None,
                created_on or datetime.min.replace(tzinfo=UTC),
                leaf_id,
                _path_to_root(leaf_id, comments_by_id, parents),
            )
        )

    eligible.sort(key=lambda item: (item[0], item[1], item[2]))
    return [path for _, _, _, path in eligible]


def has_eligible_leaves(
    comments: Sequence[Mapping[str, Any]],
    *,
    now: datetime,
    warn: WarningSink = _ignore_warning,
) -> bool:
    return bool(eligible_leaf_paths(comments, now=now, warn=warn))


def _author_payload(comment: Mapping[str, Any]) -> Mapping[str, Any] | None:
    user = comment.get("user")
    if not isinstance(user, Mapping):
        return None
    return {
        key: user.get(key)
        for key in ("display_name", "nickname", "account_id", "uuid")
        if user.get(key) is not None
    }


def _inline_payload(comment: Mapping[str, Any]) -> Mapping[str, Any] | None:
    inline = comment.get("inline")
    if not isinstance(inline, Mapping):
        return None
    return {
        key: inline.get(key)
        for key in ("path", "from", "to", "start_from", "start_to")
        if key in inline
    }


def _comment_url(comment: Mapping[str, Any]) -> str | None:
    links = comment.get("links")
    html = links.get("html") if isinstance(links, Mapping) else None
    href = html.get("href") if isinstance(html, Mapping) else None
    return href if isinstance(href, str) else None


def serialize_comment_path(
    path: Sequence[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    """Return the bounded comment context supplied to the PR agent."""
    serialized: list[Mapping[str, Any]] = []
    for comment in path:
        serialized.append(
            {
                "id": _comment_id(comment),
                "parent_id": _parent_id(comment),
                "created_on": comment.get("created_on"),
                "updated_on": comment.get("updated_on"),
                "deleted": _is_deleted(comment),
                "author": _author_payload(comment),
                "body": _comment_raw(comment),
                "inline": _inline_payload(comment),
                "url": _comment_url(comment),
            }
        )
    return serialized


def _candidate_sort_key(
    reference: PullRequestRef,
    path: Sequence[Mapping[str, Any]],
    *,
    warn: WarningSink,
) -> tuple[bool, datetime, str, str, int, int]:
    leaf = path[-1]
    created_on = _parse_created_on(leaf, warn=warn)
    leaf_id = _comment_id(leaf, warn=warn)
    if leaf_id is None:
        raise PrCommentGateError("eligible leaf has no usable id")
    return (
        created_on is not None,
        created_on or datetime.min.replace(tzinfo=UTC),
        reference.workspace.casefold(),
        reference.repo.casefold(),
        reference.pr_id,
        leaf_id,
    )


def _collect_eligible_candidates(
    references: Sequence[PullRequestRef],
    runner: GtRunner,
    *,
    now: datetime,
    warn: WarningSink,
) -> tuple[
    list[tuple[PullRequestRef, tuple[Mapping[str, Any], ...]]],
    list[int],
]:
    candidates: list[
        tuple[PullRequestRef, tuple[Mapping[str, Any], ...]]
    ] = []
    failed_pr_ids: list[int] = []
    for reference in references:
        try:
            comments = _list_all_comments(reference, runner, warn=warn)
            candidates.extend(
                (reference, path)
                for path in eligible_leaf_paths(
                    comments,
                    now=now,
                    warn=warn,
                )
            )
        except (OSError, PrCommentGateError, UnicodeError) as error:
            failed_pr_ids.append(reference.pr_id)
            warn(f"PR {reference.pr_id} could not be inspected: {error}")
    candidates.sort(
        key=lambda candidate: _candidate_sort_key(
            candidate[0],
            candidate[1],
            warn=warn,
        )
    )
    return candidates, failed_pr_ids


def select_next_pr_comment_leaf(
    *,
    pr_list_path: Path | None = None,
    runner: GtRunner | None = None,
    now: datetime | None = None,
    warn: WarningSink = _ignore_warning,
) -> EligibleLeafSelection | None:
    """Select the globally oldest eligible leaf, failing closed on partial data."""
    target_path = pr_list_path or resolve_pr_list_path()
    references = parse_pr_list(
        target_path.read_text(encoding="utf-8"),
        warn=warn,
    )
    in_scope = require_in_scope_pr(references)
    active_runner = runner or make_subprocess_gt_runner()
    _ensure_in_scope_pr_is_open(in_scope, active_runner)
    candidates, failed_pr_ids = _collect_eligible_candidates(
        references,
        active_runner,
        now=now or datetime.now(UTC),
        warn=warn,
    )
    if failed_pr_ids:
        raise PrCommentQueueBlocked(failed_pr_ids)
    if not candidates:
        return None
    reference, path = candidates[0]
    return EligibleLeafSelection(
        reference=reference,
        in_scope=in_scope,
        path=path,
    )


def selection_payload(
    selection: EligibleLeafSelection | None,
) -> Mapping[str, Any]:
    if selection is None:
        return {"status": "empty"}
    reference = selection.reference
    in_scope = selection.in_scope
    return {
        "status": "ready",
        "connection": resolve_bitbucket_connection(),
        "source": {
            "workspace": reference.workspace,
            "repo": reference.repo,
            "pr_id": reference.pr_id,
            "url": reference.url,
        },
        "in_scope_destination": {
            "workspace": in_scope.workspace,
            "repo": in_scope.repo,
            "pr_id": in_scope.pr_id,
            "url": in_scope.url,
        },
        "leaf_id": selection.leaf_id,
        "path": serialize_comment_path(selection.path),
    }


def get_next_pr_comment_leaf_payload(
    *,
    pr_list_path: Path | None = None,
    runner: GtRunner | None = None,
    now: datetime | None = None,
    warn: WarningSink = _ignore_warning,
) -> Mapping[str, Any]:
    try:
        return selection_payload(
            select_next_pr_comment_leaf(
                pr_list_path=pr_list_path,
                runner=runner,
                now=now,
                warn=warn,
            )
        )
    except PrCommentQueueBlocked as error:
        return {
            "status": "blocked",
            "reason": "configured_pr_unavailable",
            "failed_pr_ids": list(error.failed_pr_ids),
        }
    except (OSError, PrCommentGateError, UnicodeError) as error:
        warn(f"selection blocked: {error}")
        return {
            "status": "blocked",
            "reason": "selection_unavailable",
            "error_type": type(error).__name__,
        }


def _warn_gate(message: str) -> None:
    print(f"PR comment queue warning: {message}", file=sys.stderr)


def evaluate_pr_comment_leaves(
    *,
    pr_list_path: Path | None = None,
    runner: GtRunner | None = None,
    now: datetime | None = None,
) -> DecisionOutcome:
    try:
        target_path = pr_list_path or resolve_pr_list_path()
        references = parse_pr_list(
            target_path.read_text(encoding="utf-8"),
            warn=_warn_gate,
        )
        in_scope = require_in_scope_pr(references)
        active_runner = runner or make_subprocess_gt_runner()
        _ensure_in_scope_pr_is_open(in_scope, active_runner)
        evaluated_at = now or datetime.now(UTC)
        candidates, failed_pr_ids = _collect_eligible_candidates(
            references,
            active_runner,
            now=evaluated_at,
            warn=_warn_gate,
        )
        if failed_pr_ids:
            return yes(
                "pr_comment_queue_blocked",
                failed_pr_ids=failed_pr_ids,
            )
        if candidates:
            return no("eligible_pr_leaves_present")
        return yes("no_eligible_pr_leaves")
    except (OSError, PrCommentGateError, UnicodeError) as error:
        print(f"PR comment queue check blocked: {error}", file=sys.stderr)
        return yes("pr_comment_queue_blocked", error_type=type(error).__name__)
