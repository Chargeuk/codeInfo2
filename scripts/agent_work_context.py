#!/usr/bin/env python3
"""Emit compact, read-only story context for a freshly reset flow agent."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import check_current_task_handoff
import story_workflow_status


DEFAULT_HANDOFF = "codeInfoStatus/flow-state/current-plan.json"
DEFAULT_CURRENT_TASK = "codeInfoStatus/flow-state/current-task.json"
DEFAULT_REVIEW_STATE = "codeInfoStatus/flow-state/review-disposition-state.json"
GIT_COMMAND_TIMEOUT_SECONDS = 10


def non_empty(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise argparse.ArgumentTypeError("value must not be empty")
    return normalized


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Report compact story, task, or review context for a flow agent."
    )
    parser.add_argument(
        "--view",
        choices=("current_task", "review", "story"),
        required=True,
        help="Select the smallest context shape required by the flow step.",
    )
    parser.add_argument("--agent-type", type=non_empty, required=True)
    parser.add_argument("--identifier", type=non_empty, required=True)
    parser.add_argument("--handoff", default=DEFAULT_HANDOFF)
    parser.add_argument("--current-task", default=DEFAULT_CURRENT_TASK)
    parser.add_argument("--review-state", default=DEFAULT_REVIEW_STATE)
    return parser.parse_args()


def git_output(repo_path: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_path), *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=GIT_COMMAND_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def repository_context(repository: dict[str, Any]) -> dict[str, Any]:
    repo_path = Path(str(repository.get("path", "")))
    head_commit = git_output(repo_path, "rev-parse", "--short=8", "HEAD")
    porcelain = git_output(repo_path, "status", "--porcelain")
    result: dict[str, Any] = {
        "path": str(repo_path),
        "branch": repository.get("branch"),
        "head_commit": head_commit,
        "dirty": bool(porcelain) if porcelain is not None else None,
    }
    if repository.get("story_number_matches") is False:
        result["story_number_matches"] = False
    return without_none(result)


def task_context(task: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "number": task.get("number"),
        "title": task.get("title"),
        "status": task.get("status"),
        "unchecked_subtasks": task.get("subtasks_unchecked"),
        "unchecked_testing": task.get("testing_unchecked"),
        "blocked": task.get("has_live_blocker"),
    }
    start_line = task.get("start_line")
    end_line = task.get("end_line")
    if isinstance(start_line, int) and isinstance(end_line, int):
        result["lines"] = [start_line, end_line]
    return without_none(result)


def without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def build_agent_work_context(
    *,
    view: str,
    agent_type: str,
    identifier: str,
    handoff: str = DEFAULT_HANDOFF,
    current_task: str = DEFAULT_CURRENT_TASK,
    review_state: str = DEFAULT_REVIEW_STATE,
    repo_root: str | Path | None = None,
) -> dict[str, Any]:
    root = Path(repo_root).resolve() if repo_root is not None else Path.cwd().resolve()
    workflow = story_workflow_status.get_story_workflow_status(
        handoff=handoff,
        review_state=review_state,
        repo_root=root,
    )
    scope_valid = workflow.get("scope_valid") is True
    context_valid = scope_valid
    context_error_reason = workflow.get("scope_failure_reason")

    current_repository = workflow.get("current_repository")
    if not isinstance(current_repository, dict):
        current_repository = {
            "path": str(root),
            "branch": git_output(root, "branch", "--show-current"),
        }

    output: dict[str, Any] = {
        "context_valid": context_valid,
        "context_for": {
            "agent_type": agent_type,
            "identifier": identifier,
            "view": view,
        },
        "repository": repository_context(current_repository),
    }

    story = without_none(
        {
            "number": workflow.get("story_number"),
            "plan_path": workflow.get("plan_path"),
            "complete": workflow.get("story_complete"),
        }
    )
    if story:
        output["story"] = story

    additional_repositories = workflow.get("additional_repositories")
    if isinstance(additional_repositories, list) and additional_repositories:
        output["additional_repositories"] = [
            repository_context(repository)
            for repository in additional_repositories
            if isinstance(repository, dict)
        ]

    if view == "current_task":
        handoff_status = check_current_task_handoff.get_current_task_handoff_status(
            handoff=handoff,
            current_task=current_task,
            repo_root=root,
        )
        task_handoff_valid = handoff_status.get("has_valid_current_task_handoff") is True
        context_valid = scope_valid and task_handoff_valid
        if not task_handoff_valid and scope_valid:
            context_error_reason = handoff_status.get("reason")
        selected_task = workflow.get("selected_task")
        if context_valid and isinstance(selected_task, dict):
            output["task"] = task_context(selected_task)
    elif view == "review":
        review_valid = workflow.get("review_state_valid") is True
        context_valid = scope_valid and review_valid
        if not review_valid and scope_valid:
            context_error_reason = workflow.get("review_state_repair_reason")
        review: dict[str, Any] = {
            "state_path": review_state,
            "state_valid": review_valid,
        }
        if review_valid:
            review.update(
                without_none(
                    {
                        "cycle_id": workflow.get("review_cycle_id"),
                        "tasks_added_or_updated": workflow.get(
                            "review_created_tasks_added_or_updated"
                        ),
                        "needs_rerun": workflow.get(
                            "needs_review_rerun_before_close"
                        ),
                        "needs_final_revalidation": workflow.get(
                            "needs_final_minor_fix_revalidation_task"
                        ),
                        "safe_to_exit_without_tasking": workflow.get(
                            "safe_to_exit_review_loop_without_tasking"
                        ),
                    }
                )
            )
        output["review"] = review

    output["context_valid"] = context_valid
    if not context_valid:
        output["context_error"] = {
            "reason": context_error_reason or "context_invalid"
        }
    return output


def main() -> int:
    args = parse_args()
    output = build_agent_work_context(
        view=args.view,
        agent_type=args.agent_type,
        identifier=args.identifier,
        handoff=args.handoff,
        current_task=args.current_task,
        review_state=args.review_state,
    )
    json.dump(output, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
