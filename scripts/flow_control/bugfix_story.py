"""Deterministic, stateless selection for the Jira bugfix-story flow."""

from __future__ import annotations

import json
import os
import re
import subprocess
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from flow_control.decision import DecisionOutcome, no, yes
from flow_control.pr_comments import PrCommentGateError, resolve_gt_bin


DEFAULT_JIRA_CONNECTION = "marex"
STORY_KEY_PATTERN = re.compile(
    r"(?<![A-Z0-9])([A-Z][A-Z0-9]+-\d+)(?![A-Z0-9-])",
    re.IGNORECASE,
)
TODO_STATUS = "to do"
IN_PROGRESS_STATUS = "in progress"
TERMINAL_STATUSES = {
    "cancelled",
    "canceled",
    "closed",
    "done",
    "resolved",
}


class BugfixStoryGateError(RuntimeError):
    """Raised when the selector cannot establish trustworthy Jira state."""


GtRunner = Callable[[Sequence[str]], Mapping[str, Any]]


@dataclass(frozen=True)
class JiraIssue:
    key: str
    summary: str
    status: str
    issue_type: str
    assignee: str | None
    is_subtask: bool


@dataclass(frozen=True)
class BugfixSelection:
    connection: str
    story: JiraIssue
    subtask: JiraIssue
    selection_reason: str


def resolve_jira_connection(connection: str | None = None) -> str:
    return (
        connection
        or os.environ.get("CODEINFO_GT_JIRA_CONNECTION", "").strip()
        or DEFAULT_JIRA_CONNECTION
    )


def resolve_bugfix_story_path(
    *,
    story_path: Path | None = None,
    working_folder: Path | None = None,
) -> Path:
    if story_path is not None:
        return story_path
    configured = os.environ.get("CODEINFO_BUGFIX_STORY_FILE", "").strip()
    if configured:
        return Path(configured).expanduser()
    return (working_folder or Path.cwd()) / "bugfix_story.md"


def parse_story_key(text: str) -> str:
    keys = {match.group(1).upper() for match in STORY_KEY_PATTERN.finditer(text)}
    if len(keys) != 1:
        raise BugfixStoryGateError(
            f"bugfix_story.md must identify exactly one Jira issue; found {len(keys)}"
        )
    return next(iter(keys))


def read_story_key(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise BugfixStoryGateError("bugfix_story.md could not be read") from error
    return parse_story_key(text)


def make_subprocess_gt_runner(
    *,
    connection: str | None = None,
    gt_bin: Path | None = None,
) -> GtRunner:
    try:
        executable = gt_bin or resolve_gt_bin()
    except PrCommentGateError as error:
        raise BugfixStoryGateError(str(error)) from error
    connection_name = resolve_jira_connection(connection)

    def run(arguments: Sequence[str]) -> Mapping[str, Any]:
        command = [
            str(executable),
            *arguments,
            "--connection",
            connection_name,
            "--json",
        ]
        try:
            result = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise BugfixStoryGateError("gt Jira command failed") from error
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise BugfixStoryGateError("gt returned invalid JSON") from error
        if not isinstance(payload, Mapping):
            raise BugfixStoryGateError(
                "gt returned a non-object JSON payload"
            )
        return payload

    return run


def _required_text(value: Any, description: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BugfixStoryGateError(f"Jira issue has no usable {description}")
    return value.strip()


def _issue_from_search(value: Mapping[str, Any]) -> JiraIssue:
    fields = value.get("fields")
    if not isinstance(fields, Mapping):
        raise BugfixStoryGateError("Jira child issue has no fields object")

    status = fields.get("status")
    issue_type = fields.get("issuetype")
    if not isinstance(status, Mapping) or not isinstance(issue_type, Mapping):
        raise BugfixStoryGateError(
            "Jira child issue has no usable status or issue type"
        )

    assignee = fields.get("assignee")
    assignee_name: str | None = None
    if assignee is not None:
        if not isinstance(assignee, Mapping):
            raise BugfixStoryGateError(
                "Jira child issue has an invalid assignee"
            )
        display_name = assignee.get("displayName")
        if display_name is not None:
            assignee_name = _required_text(display_name, "assignee name")

    type_name = _required_text(issue_type.get("name"), "issue type")
    subtask_flag = issue_type.get("subtask")
    is_subtask = (
        subtask_flag
        if isinstance(subtask_flag, bool)
        else "sub-task" in type_name.casefold()
        or "subtask" in type_name.casefold()
    )

    return JiraIssue(
        key=_required_text(value.get("key"), "key").upper(),
        summary=_required_text(fields.get("summary"), "summary"),
        status=_required_text(status.get("name"), "status"),
        issue_type=type_name,
        assignee=assignee_name,
        is_subtask=is_subtask,
    )


def _story_from_payload(
    payload: Mapping[str, Any],
    expected_key: str,
) -> JiraIssue:
    key = _required_text(payload.get("key"), "key").upper()
    if key != expected_key:
        raise BugfixStoryGateError("gt returned the wrong Jira story")

    issue_type = _required_text(payload.get("type"), "issue type")
    raw = payload.get("raw")
    raw_fields = raw.get("fields") if isinstance(raw, Mapping) else None
    raw_issue_type = (
        raw_fields.get("issuetype")
        if isinstance(raw_fields, Mapping)
        else None
    )
    subtask_flag = (
        raw_issue_type.get("subtask")
        if isinstance(raw_issue_type, Mapping)
        else None
    )
    is_subtask = subtask_flag is True
    normalized_type = issue_type.casefold()
    if is_subtask or not (
        normalized_type == "story" or normalized_type.endswith(" story")
    ):
        raise BugfixStoryGateError(
            f"{expected_key} is not a Jira story"
        )

    assignee = payload.get("assignee")
    return JiraIssue(
        key=key,
        summary=_required_text(payload.get("summary"), "summary"),
        status=_required_text(payload.get("status"), "status"),
        issue_type=issue_type,
        assignee=assignee.strip()
        if isinstance(assignee, str) and assignee.strip()
        else None,
        is_subtask=False,
    )


def _issues_from_search(
    payload: Mapping[str, Any],
) -> tuple[JiraIssue, ...]:
    next_page_token = payload.get("nextPageToken")
    if isinstance(next_page_token, str) and next_page_token.strip():
        raise BugfixStoryGateError(
            "Jira child issue results exceed one GT page"
        )
    if payload.get("isLast") is False:
        raise BugfixStoryGateError(
            "Jira child issue results exceed one GT page"
        )

    values = payload.get("issues")
    if not isinstance(values, list):
        raise BugfixStoryGateError(
            "gt Jira issue list has no issues array"
        )
    total = payload.get("total")
    if (
        isinstance(total, int)
        and not isinstance(total, bool)
        and total > len(values)
    ):
        raise BugfixStoryGateError(
            "Jira child issue results exceed one GT page"
        )

    issues: dict[str, JiraIssue] = {}
    for value in values:
        if not isinstance(value, Mapping):
            raise BugfixStoryGateError(
                "gt Jira issue list contains a non-object issue"
            )
        issue = _issue_from_search(value)
        if issue.key in issues:
            raise BugfixStoryGateError(
                "gt Jira issue list contains duplicate issue keys"
            )
        issues[issue.key] = issue
    return tuple(issues.values())


def _normalized_status(value: str) -> str:
    return " ".join(value.casefold().split())


def _issue_sort_key(issue: JiraIssue) -> tuple[str, int, str]:
    prefix, separator, suffix = issue.key.rpartition("-")
    if separator and suffix.isdigit():
        return prefix, int(suffix), issue.key
    return issue.key, 0, issue.key


def select_bugfix_subtask(
    *,
    story_path: Path | None = None,
    working_folder: Path | None = None,
    connection: str | None = None,
    gt_runner: GtRunner | None = None,
) -> BugfixSelection | None:
    target_path = resolve_bugfix_story_path(
        story_path=story_path,
        working_folder=working_folder,
    )
    story_key = read_story_key(target_path)
    connection_name = resolve_jira_connection(connection)
    runner = gt_runner or make_subprocess_gt_runner(
        connection=connection_name
    )

    story = _story_from_payload(
        runner(["jira", "issues", "get", story_key]),
        story_key,
    )
    child_issues = _issues_from_search(
        runner(["jira", "issues", "list", "--parent", story_key])
    )
    mine_issues = _issues_from_search(
        runner(
            [
                "jira",
                "issues",
                "list",
                "--parent",
                story_key,
                "--mine",
            ]
        )
    )

    subtasks = tuple(issue for issue in child_issues if issue.is_subtask)
    mine_keys = {issue.key for issue in mine_issues if issue.is_subtask}
    unknown_statuses = sorted(
        {
            issue.status
            for issue in subtasks
            if _normalized_status(issue.status)
            not in {TODO_STATUS, IN_PROGRESS_STATUS, *TERMINAL_STATUSES}
        },
        key=str.casefold,
    )
    if unknown_statuses:
        raise BugfixStoryGateError(
            "unrecognized Jira subtask statuses: "
            + ", ".join(unknown_statuses)
        )

    recoverable = sorted(
        (
            issue
            for issue in subtasks
            if _normalized_status(issue.status) == IN_PROGRESS_STATUS
            and issue.key in mine_keys
        ),
        key=_issue_sort_key,
    )
    if recoverable:
        return BugfixSelection(
            connection=connection_name,
            story=story,
            subtask=recoverable[0],
            selection_reason="recover_in_progress",
        )

    todo = sorted(
        (
            issue
            for issue in subtasks
            if _normalized_status(issue.status) == TODO_STATUS
            and (issue.assignee is None or issue.key in mine_keys)
        ),
        key=_issue_sort_key,
    )
    if todo:
        return BugfixSelection(
            connection=connection_name,
            story=story,
            subtask=todo[0],
            selection_reason="next_todo",
        )

    active_or_todo = [
        issue
        for issue in subtasks
        if _normalized_status(issue.status)
        in {TODO_STATUS, IN_PROGRESS_STATUS}
    ]
    if active_or_todo:
        raise BugfixStoryGateError(
            "active or To Do subtasks exist but none is safe to claim"
        )
    return None


def _issue_payload(issue: JiraIssue) -> Mapping[str, Any]:
    return {
        "key": issue.key,
        "summary": issue.summary,
        "status": issue.status,
        "type": issue.issue_type,
        "assignee": issue.assignee,
    }


def get_next_bugfix_subtask_payload(
    *,
    story_path: Path | None = None,
    working_folder: Path | None = None,
    connection: str | None = None,
    gt_runner: GtRunner | None = None,
) -> Mapping[str, Any]:
    try:
        selection = select_bugfix_subtask(
            story_path=story_path,
            working_folder=working_folder,
            connection=connection,
            gt_runner=gt_runner,
        )
    except (BugfixStoryGateError, OSError, UnicodeError) as error:
        return {
            "status": "blocked",
            "reason": "selection_unavailable",
            "error_type": type(error).__name__,
            "message": str(error),
        }

    if selection is None:
        return {
            "status": "empty",
            "reason": "no_active_or_todo_subtasks",
            "connection": resolve_jira_connection(connection),
        }

    root = (
        Path("codeInfoTmp")
        / "bugfixes"
        / selection.story.key
        / selection.subtask.key
    )
    return {
        "status": "ready",
        "reason": selection.selection_reason,
        "connection": selection.connection,
        "story": _issue_payload(selection.story),
        "subtask": _issue_payload(selection.subtask),
        "paths": {
            "root": root.as_posix(),
            "information": (root / "information.md").as_posix(),
            "plan": (root / "plan.md").as_posix(),
            "attachments": (root / "attachments").as_posix(),
            "proof": (root / "proof").as_posix(),
            "frontend_proof": (root / "frontend-proof.json").as_posix(),
            "jira_fix_comment": (root / "jira-fix-comment.json").as_posix(),
        },
    }


def evaluate_bugfix_story_subtasks_empty(
    *,
    story_path: Path | None = None,
    working_folder: Path | None = None,
    connection: str | None = None,
    gt_runner: GtRunner | None = None,
) -> DecisionOutcome:
    payload = get_next_bugfix_subtask_payload(
        story_path=story_path,
        working_folder=working_folder,
        connection=connection,
        gt_runner=gt_runner,
    )
    status = payload["status"]
    if status == "ready":
        subtask = payload["subtask"]
        return no(
            "workable_bugfix_subtask_present",
            story_key=payload["story"]["key"],
            subtask_key=subtask["key"],
        )
    if status == "empty":
        return yes("no_active_or_todo_bugfix_subtasks")
    return yes(
        "bugfix_story_selection_blocked",
        message=payload.get("message"),
    )


def evaluate_bugfix_screenshot_proof_unneeded(
    *,
    story_path: Path | None = None,
    working_folder: Path | None = None,
    connection: str | None = None,
    gt_runner: GtRunner | None = None,
) -> DecisionOutcome:
    """Return yes only when the selected subtask explicitly needs no proof."""

    target_folder = working_folder or Path.cwd()
    payload = get_next_bugfix_subtask_payload(
        story_path=story_path,
        working_folder=target_folder,
        connection=connection,
        gt_runner=gt_runner,
    )
    if payload.get("status") != "ready":
        return no(
            "bugfix_screenshot_requirement_unavailable",
            selector_status=payload.get("status"),
        )

    paths = payload.get("paths")
    frontend_proof = (
        paths.get("frontend_proof")
        if isinstance(paths, Mapping)
        else None
    )
    if not isinstance(frontend_proof, str) or not frontend_proof:
        return no("bugfix_frontend_proof_path_unavailable")

    decision_path = target_folder / frontend_proof
    try:
        decision = json.loads(decision_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return no("bugfix_frontend_proof_decision_unavailable")

    if (
        not isinstance(decision, Mapping)
        or set(decision) != {"required"}
        or not isinstance(decision.get("required"), bool)
    ):
        return no("bugfix_frontend_proof_decision_invalid")

    subtask = payload["subtask"]
    if decision["required"]:
        return no(
            "bugfix_frontend_screenshot_proof_required",
            subtask_key=subtask["key"],
        )
    return yes(
        "bugfix_frontend_screenshot_proof_unneeded",
        subtask_key=subtask["key"],
    )
