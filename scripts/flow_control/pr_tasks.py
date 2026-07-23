"""Deterministic, stateless pull-request task batch selection."""

from __future__ import annotations

import re
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from flow_control.decision import DecisionOutcome, no, yes
from flow_control.pr_comments import (
    DEFAULT_PAGE_LIMIT,
    MAX_PAGES,
    GtRunner,
    PrCommentGateError,
    PullRequestRef,
    make_subprocess_gt_runner,
    parse_pr_list,
    require_in_scope_pr,
    resolve_bitbucket_connection,
    resolve_pr_list_path,
)


BITBUCKET_HOST = "bitbucket.org"
SCP_REMOTE_PATTERN = re.compile(
    r"^(?:[^@/\s]+@)?bitbucket\.org:(?P<path>[^?#]+)$",
    re.IGNORECASE,
)


class PrTaskGateError(PrCommentGateError):
    """Raised when the task selector cannot establish trustworthy state."""


class PrTaskNotWorkable(PrTaskGateError):
    """Raised when the configured PR is intentionally outside this checkout."""

    def __init__(self, reason_code: str) -> None:
        self.reason_code = reason_code
        super().__init__(reason_code)


GitRunner = Callable[[Sequence[str]], str]


@dataclass(frozen=True)
class PullRequestTask:
    task_id: int
    body: str
    state: str
    created_on: str | None
    updated_on: str | None
    author: Mapping[str, Any] | None


@dataclass(frozen=True)
class PullRequestTaskBatch:
    reference: PullRequestRef
    source_branch: str
    working_folder: Path
    tasks: tuple[PullRequestTask, ...]


def _normalize_repo_name(value: str) -> str:
    name = value.strip().strip("/")
    return name[:-4] if name.casefold().endswith(".git") else name


def parse_bitbucket_remote(url: str) -> tuple[str, str] | None:
    """Return the normalized Bitbucket workspace/repository for a Git URL."""
    raw = url.strip()
    if not raw:
        return None

    scp_match = SCP_REMOTE_PATTERN.fullmatch(raw)
    path = scp_match.group("path") if scp_match is not None else None
    if path is None:
        parsed = urlparse(raw)
        if (parsed.hostname or "").casefold() != BITBUCKET_HOST:
            return None
        path = parsed.path

    parts = [part for part in path.strip("/").split("/") if part]
    if len(parts) != 2:
        return None
    workspace = parts[0].casefold()
    repo = _normalize_repo_name(parts[1]).casefold()
    if not workspace or not repo:
        return None
    return workspace, repo


def make_subprocess_git_runner(*, working_folder: Path) -> GitRunner:
    def run(arguments: Sequence[str]) -> str:
        try:
            result = subprocess.run(
                ["git", *arguments],
                cwd=working_folder,
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise PrTaskGateError("git command failed") from error
        return result.stdout

    return run


def _working_bitbucket_repositories(runner: GitRunner) -> set[tuple[str, str]]:
    remote_names = [name.strip() for name in runner(["remote"]).splitlines()]
    identities: set[tuple[str, str]] = set()
    for remote_name in remote_names:
        if not remote_name:
            continue
        for remote_url in runner(
            ["remote", "get-url", "--all", remote_name]
        ).splitlines():
            identity = parse_bitbucket_remote(remote_url)
            if identity is not None:
                identities.add(identity)
    return identities


def _current_branch(runner: GitRunner) -> str:
    branch = runner(["branch", "--show-current"]).strip()
    if not branch:
        raise PrTaskGateError("working repository is not on a named branch")
    return branch


def _pull_request_source_branch(payload: Mapping[str, Any]) -> str:
    source = payload.get("source")
    branch = source.get("branch") if isinstance(source, Mapping) else None
    name = branch.get("name") if isinstance(branch, Mapping) else None
    if not isinstance(name, str) or not name.strip():
        raise PrTaskGateError("pull request has no source branch")
    return name.strip()


def _task_state(task: Mapping[str, Any]) -> str:
    state = task.get("state")
    if isinstance(state, str):
        normalized = state.strip().upper()
        if normalized in {"RESOLVED", "UNRESOLVED"}:
            return normalized
        raise PrTaskGateError("pull-request task has an unknown state")

    resolved = task.get("resolved")
    if isinstance(resolved, bool):
        return "RESOLVED" if resolved else "UNRESOLVED"
    raise PrTaskGateError("pull-request task has no usable state")


def _task_author(task: Mapping[str, Any]) -> Mapping[str, Any] | None:
    value = task.get("creator")
    if not isinstance(value, Mapping):
        value = task.get("user")
    if not isinstance(value, Mapping):
        return None
    author = {
        key: value.get(key)
        for key in ("display_name", "nickname", "account_id", "uuid")
        if value.get(key) is not None
    }
    return author or None


def _parse_task(task: Mapping[str, Any]) -> PullRequestTask:
    task_id = task.get("id")
    if isinstance(task_id, bool) or not isinstance(task_id, int) or task_id < 1:
        raise PrTaskGateError("pull-request task has no usable id")
    content = task.get("content")
    raw = content.get("raw") if isinstance(content, Mapping) else ""
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise PrTaskGateError("pull-request task body is not text")
    created_on = task.get("created_on")
    updated_on = task.get("updated_on")
    return PullRequestTask(
        task_id=task_id,
        body=raw,
        state=_task_state(task),
        created_on=created_on if isinstance(created_on, str) else None,
        updated_on=updated_on if isinstance(updated_on, str) else None,
        author=_task_author(task),
    )


def _list_all_tasks(
    reference: PullRequestRef,
    runner: GtRunner,
) -> tuple[PullRequestTask, ...]:
    tasks_by_id: dict[int, PullRequestTask] = {}
    page = 1
    while page <= MAX_PAGES:
        payload = runner(
            [
                "bitbucket",
                "prs",
                "tasks",
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
            raise PrTaskGateError("gt tasks payload has no values array")
        for value in values:
            if not isinstance(value, Mapping):
                raise PrTaskGateError("gt tasks payload contains a non-object task")
            task = _parse_task(value)
            if task.task_id in tasks_by_id:
                raise PrTaskGateError("gt tasks pagination returned a duplicate task")
            tasks_by_id[task.task_id] = task
        if not payload.get("next"):
            return tuple(
                task
                for task in sorted(
                    tasks_by_id.values(),
                    key=lambda candidate: candidate.task_id,
                )
                if task.state == "UNRESOLVED"
            )
        page += 1
    raise PrTaskGateError("gt tasks pagination exceeded safety limit")


def select_open_pr_task_batch(
    *,
    pr_list_path: Path | None = None,
    working_folder: Path | None = None,
    gt_runner: GtRunner | None = None,
    git_runner: GitRunner | None = None,
) -> PullRequestTaskBatch:
    """Select every unresolved task for the workable in-scope pull request."""
    target_path = pr_list_path or resolve_pr_list_path()
    references = parse_pr_list(target_path.read_text(encoding="utf-8"))
    in_scope = require_in_scope_pr(references)
    target_folder = (working_folder or Path.cwd()).resolve()
    active_git_runner = git_runner or make_subprocess_git_runner(
        working_folder=target_folder
    )

    expected_identity = (
        in_scope.workspace.casefold(),
        in_scope.repo.casefold(),
    )
    if expected_identity not in _working_bitbucket_repositories(active_git_runner):
        raise PrTaskNotWorkable("working_repository_mismatch")

    active_gt_runner = gt_runner or make_subprocess_gt_runner()
    pr_payload = active_gt_runner(
        [
            "bitbucket",
            "prs",
            "get",
            str(in_scope.pr_id),
            "--repo",
            in_scope.repo,
        ]
    )
    state = pr_payload.get("state")
    if not isinstance(state, str):
        raise PrTaskGateError("pull request has no usable state")
    if state.strip().upper() != "OPEN":
        raise PrTaskNotWorkable("pull_request_not_open")

    source_branch = _pull_request_source_branch(pr_payload)
    if _current_branch(active_git_runner) != source_branch:
        raise PrTaskNotWorkable("working_branch_mismatch")

    return PullRequestTaskBatch(
        reference=in_scope,
        source_branch=source_branch,
        working_folder=target_folder,
        tasks=_list_all_tasks(in_scope, active_gt_runner),
    )


def task_batch_payload(
    batch: PullRequestTaskBatch,
) -> Mapping[str, Any]:
    reference = batch.reference
    return {
        "status": "ready" if batch.tasks else "empty",
        "reason": None if batch.tasks else "no_unresolved_tasks",
        "connection": resolve_bitbucket_connection(),
        "pull_request": {
            "workspace": reference.workspace,
            "repo": reference.repo,
            "pr_id": reference.pr_id,
            "url": reference.url,
            "source_branch": batch.source_branch,
        },
        "working_folder": str(batch.working_folder),
        "tasks": [
            {
                "id": task.task_id,
                "body": task.body,
                "state": task.state,
                "created_on": task.created_on,
                "updated_on": task.updated_on,
                "author": task.author,
            }
            for task in batch.tasks
        ],
    }


def get_open_pr_task_batch_payload(
    **kwargs: Any,
) -> Mapping[str, Any]:
    try:
        return task_batch_payload(select_open_pr_task_batch(**kwargs))
    except PrTaskNotWorkable as error:
        return {"status": "skipped", "reason": error.reason_code}
    except (OSError, PrTaskGateError, UnicodeError) as error:
        print(f"PR task selector blocked: {error}", file=sys.stderr)
        return {
            "status": "blocked",
            "reason": "selection_unavailable",
            "error_type": type(error).__name__,
        }


def evaluate_pr_tasks_empty(**kwargs: Any) -> DecisionOutcome:
    try:
        batch = select_open_pr_task_batch(**kwargs)
        if batch.tasks:
            return no("unresolved_pr_tasks_present", task_count=len(batch.tasks))
        return yes("no_unresolved_pr_tasks")
    except PrTaskNotWorkable as error:
        return yes(error.reason_code)
    except (OSError, PrTaskGateError, UnicodeError) as error:
        print(f"PR task queue check blocked: {error}", file=sys.stderr)
        return yes("pr_task_queue_blocked", error_type=type(error).__name__)
