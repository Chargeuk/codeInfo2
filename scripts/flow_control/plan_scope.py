"""Plan-scope final completion decisions for flow loop control."""

from __future__ import annotations

import re
import subprocess
from typing import Any

import story_workflow_status
from flow_control.decision import DecisionOutcome, no, yes


def check_plan_scope_story_complete() -> DecisionOutcome:
    status = story_workflow_status.get_story_workflow_status(include_tasks=False)
    context: dict[str, Any] = {
        "repair_needed": status.get("repair_needed"),
        "scope_valid": status.get("scope_valid"),
        "all_tasks_done": status.get("all_tasks_done"),
        "story_complete": status.get("story_complete"),
        "final_task_status": status.get("final_task_status"),
        "review_state_valid": status.get("review_state_valid"),
        "review_state_repair_needed": status.get("review_state_repair_needed"),
        "review_cycle_id": status.get("review_cycle_id"),
        "active_review_cycle_id": status.get("active_review_cycle_id"),
        "review_created_tasks_added_or_updated": status.get(
            "review_created_tasks_added_or_updated"
        ),
        "needs_review_rerun_before_close": status.get(
            "needs_review_rerun_before_close"
        ),
        "safe_to_exit_review_loop_without_tasking": status.get(
            "safe_to_exit_review_loop_without_tasking"
        ),
        "should_finish_review_loop_cleanly": status.get(
            "should_finish_review_loop_cleanly"
        ),
        "active_review_cycle_status": status.get("active_review_cycle_status"),
        "review_settlement_complete": status.get("review_settlement_complete"),
    }
    review_cycle_matches_active = (
        isinstance(status.get("review_cycle_id"), str)
        and status.get("review_cycle_id") == status.get("active_review_cycle_id")
    )
    context["review_cycle_matches_active"] = review_cycle_matches_active
    is_complete = (
        status.get("repair_needed") is False
        and status.get("scope_valid") is True
        and status.get("all_tasks_done") is True
        and status.get("story_complete") is True
        and status.get("review_state_valid") is True
        and status.get("review_state_repair_needed") is False
        and review_cycle_matches_active
        and status.get("review_created_tasks_added_or_updated") is False
        and status.get("needs_review_rerun_before_close") is False
        and status.get("safe_to_exit_review_loop_without_tasking") is True
        and status.get("should_finish_review_loop_cleanly") is True
        and status.get("review_settlement_complete") is True
    )
    if is_complete:
        return yes("plan_scope_story_complete", **context)
    return no("plan_scope_story_incomplete", **context)


_GITHUB_HOST_RE = re.compile(r"(^|\.)github\.com$", re.IGNORECASE)
_GHE_HOST_RE = re.compile(r"(^|\.)ghe\.com$", re.IGNORECASE)


def _extract_remote_host(remote_url: str) -> str | None:
    trimmed = remote_url.strip()
    ssh_match = re.match(r"^(?:ssh://)?git@([^:/]+)[:/].+$", trimmed)
    if ssh_match:
        return ssh_match.group(1).strip().lower()
    https_match = re.match(r"^https?://([^/]+)/.+$", trimmed)
    if https_match:
        return https_match.group(1).strip().lower()
    return None


def _host_supports_github_review(host: str | None) -> bool:
    if not host:
        return False
    return bool(_GITHUB_HOST_RE.search(host) or _GHE_HOST_RE.search(host))


def _git_stdout(*args: str) -> str | None:
    result = subprocess.run(
        ["git", *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def check_plan_scope_supports_github_pr_review() -> DecisionOutcome:
    upstream_ref = _git_stdout(
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
    )
    if not upstream_ref:
        return no(
            "plan_scope_github_pr_review_unsupported",
            reason="missing_upstream",
        )
    slash_index = upstream_ref.find("/")
    if slash_index <= 0 or slash_index == len(upstream_ref) - 1:
        return no(
            "plan_scope_github_pr_review_unsupported",
            reason="unparseable_upstream",
            upstream_ref=upstream_ref,
        )
    upstream_remote = upstream_ref[:slash_index]
    remote_url = _git_stdout("remote", "get-url", upstream_remote)
    remote_host = _extract_remote_host(remote_url or "")
    if not remote_url or not _host_supports_github_review(remote_host):
        return no(
            "plan_scope_github_pr_review_unsupported",
            reason="remote_not_github",
            upstream_remote=upstream_remote,
            remote_url=remote_url,
            remote_host=remote_host,
        )
    return yes(
        "plan_scope_github_pr_review_supported",
        upstream_ref=upstream_ref,
        upstream_remote=upstream_remote,
        remote_url=remote_url,
        remote_host=remote_host,
    )
