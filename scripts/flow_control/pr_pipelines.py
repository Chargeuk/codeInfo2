"""Deterministic selection of unrecorded current-head PR pipeline failures."""

from __future__ import annotations

import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from flow_control.decision import DecisionOutcome, no, yes
from flow_control.pr_comments import (
    DEFAULT_PAGE_LIMIT,
    MAX_PAGES,
    GtRunner,
    make_subprocess_gt_runner,
    resolve_bitbucket_connection,
)
from flow_control.pr_tasks import (
    GitRunner,
    PrTaskGateError,
    PrTaskNotWorkable,
    WorkablePullRequest,
    commits_match,
    current_git_head,
    list_pull_request_tasks,
    make_subprocess_git_runner,
    select_workable_pull_request,
)


PIPELINE_FAILURE_KEY_PREFIX = "AI Pipeline Failure Key:"


class PrPipelineGateError(PrTaskGateError):
    """Raised when current pipeline state cannot be established safely."""


@dataclass(frozen=True)
class FailedPipelineStep:
    uuid: str | None
    name: str


@dataclass(frozen=True)
class PullRequestPipelineFailure:
    pull_request: WorkablePullRequest
    build_number: int
    commit: str
    failure_key: str
    failed_steps: tuple[FailedPipelineStep, ...]


@dataclass(frozen=True)
class PipelineFailureInspection:
    reason_code: str
    failure: PullRequestPipelineFailure | None = None


def pipeline_failure_key(build_number: int, commit: str) -> str:
    return (
        f"{PIPELINE_FAILURE_KEY_PREFIX} "
        f"bitbucket-pipeline:{build_number}:{commit.casefold()}"
    )


def _nested_mapping(
    payload: Mapping[str, Any],
    key: str,
) -> Mapping[str, Any] | None:
    value = payload.get(key)
    return value if isinstance(value, Mapping) else None


def _pipeline_build_number(payload: Mapping[str, Any]) -> int:
    build_number = payload.get("build_number")
    if (
        isinstance(build_number, bool)
        or not isinstance(build_number, int)
        or build_number < 1
    ):
        raise PrPipelineGateError("pipeline has no usable build number")
    return build_number


def _pipeline_commit(payload: Mapping[str, Any]) -> str:
    target = _nested_mapping(payload, "target")
    commit = _nested_mapping(target, "commit") if target is not None else None
    commit_hash = commit.get("hash") if commit is not None else None
    if not isinstance(commit_hash, str) or not commit_hash.strip():
        raise PrPipelineGateError("pipeline has no usable target commit")
    return commit_hash.strip()


def _pipeline_pr_id(payload: Mapping[str, Any]) -> int:
    target = _nested_mapping(payload, "target")
    pull_request = (
        _nested_mapping(target, "pullrequest") if target is not None else None
    )
    pr_id = pull_request.get("id") if pull_request is not None else None
    if isinstance(pr_id, bool) or not isinstance(pr_id, int) or pr_id < 1:
        raise PrPipelineGateError("pipeline has no usable pull-request id")
    return pr_id


def _pipeline_state(payload: Mapping[str, Any]) -> tuple[str, str | None]:
    state = _nested_mapping(payload, "state")
    name = state.get("name") if state is not None else None
    if not isinstance(name, str) or not name.strip():
        raise PrPipelineGateError("pipeline has no usable state")
    result = _nested_mapping(state, "result")
    result_name = result.get("name") if result is not None else None
    if result_name is not None and not isinstance(result_name, str):
        raise PrPipelineGateError("pipeline has no usable result")
    return name.strip().upper(), (
        result_name.strip().upper()
        if isinstance(result_name, str) and result_name.strip()
        else None
    )


def _list_all_pr_pipelines(
    pull_request: WorkablePullRequest,
    runner: GtRunner,
) -> tuple[Mapping[str, Any], ...]:
    pipelines: list[Mapping[str, Any]] = []
    page = 1
    while page <= MAX_PAGES:
        payload = runner(
            [
                "bitbucket",
                "pipelines",
                "list",
                "--repo",
                pull_request.reference.repo,
                "--pr",
                str(pull_request.reference.pr_id),
                "--limit",
                str(DEFAULT_PAGE_LIMIT),
                "--page",
                str(page),
            ]
        )
        values = payload.get("values")
        if not isinstance(values, list):
            raise PrPipelineGateError("gt pipelines payload has no values array")
        for value in values:
            if not isinstance(value, Mapping):
                raise PrPipelineGateError(
                    "gt pipelines payload contains a non-object pipeline"
                )
            if _pipeline_pr_id(value) != pull_request.reference.pr_id:
                raise PrPipelineGateError(
                    "gt pipelines payload contains a different pull request"
                )
            _pipeline_build_number(value)
            _pipeline_commit(value)
            _pipeline_state(value)
            pipelines.append(value)
        if not payload.get("next"):
            return tuple(pipelines)
        page += 1
    raise PrPipelineGateError("gt pipelines pagination exceeded safety limit")


def _failed_steps(
    pull_request: WorkablePullRequest,
    build_number: int,
    runner: GtRunner,
) -> tuple[FailedPipelineStep, ...]:
    payload = runner(
        [
            "bitbucket",
            "pipelines",
            "get",
            str(build_number),
            "--repo",
            pull_request.reference.repo,
        ]
    )
    steps = payload.get("steps")
    if not isinstance(steps, list):
        raise PrPipelineGateError("gt pipeline detail has no steps array")

    failed: list[FailedPipelineStep] = []
    for step in steps:
        if not isinstance(step, Mapping):
            raise PrPipelineGateError(
                "gt pipeline detail contains a non-object step"
            )
        _, result = _pipeline_state(step)
        if result != "FAILED":
            continue
        name = step.get("name")
        if not isinstance(name, str) or not name.strip():
            raise PrPipelineGateError("failed pipeline step has no usable name")
        uuid = step.get("uuid")
        if uuid is not None and not isinstance(uuid, str):
            raise PrPipelineGateError("failed pipeline step has no usable uuid")
        failed.append(
            FailedPipelineStep(
                uuid=uuid,
                name=name.strip(),
            )
        )
    return tuple(failed)


def inspect_unrecorded_pr_pipeline_failure(
    *,
    pr_list_path: Path | None = None,
    working_folder: Path | None = None,
    gt_runner: GtRunner | None = None,
    git_runner: GitRunner | None = None,
) -> PipelineFailureInspection:
    target_folder = (working_folder or Path.cwd()).resolve()
    active_gt_runner = gt_runner or make_subprocess_gt_runner()
    active_git_runner = git_runner or make_subprocess_git_runner(
        working_folder=target_folder
    )
    pull_request = select_workable_pull_request(
        pr_list_path=pr_list_path,
        working_folder=target_folder,
        gt_runner=active_gt_runner,
        git_runner=active_git_runner,
    )
    if not commits_match(
        current_git_head(active_git_runner),
        pull_request.source_commit,
    ):
        raise PrTaskNotWorkable("working_head_mismatch")

    matching = [
        pipeline
        for pipeline in _list_all_pr_pipelines(pull_request, active_gt_runner)
        if commits_match(_pipeline_commit(pipeline), pull_request.source_commit)
    ]
    if not matching:
        return PipelineFailureInspection("no_pipeline_for_current_head")

    latest = max(matching, key=_pipeline_build_number)
    state, result = _pipeline_state(latest)
    if state != "COMPLETED":
        return PipelineFailureInspection("current_pipeline_not_completed")
    if result != "FAILED":
        return PipelineFailureInspection("current_pipeline_not_failed")

    build_number = _pipeline_build_number(latest)
    commit = _pipeline_commit(latest)
    failure_key = pipeline_failure_key(build_number, commit)
    tasks = list_pull_request_tasks(
        pull_request.reference,
        active_gt_runner,
        unresolved_only=False,
    )
    if any(failure_key.casefold() in task.body.casefold() for task in tasks):
        return PipelineFailureInspection("pipeline_failure_already_recorded")

    return PipelineFailureInspection(
        reason_code="unrecorded_pipeline_failure",
        failure=PullRequestPipelineFailure(
            pull_request=pull_request,
            build_number=build_number,
            commit=commit,
            failure_key=failure_key,
            failed_steps=_failed_steps(
                pull_request,
                build_number,
                active_gt_runner,
            ),
        ),
    )


def pipeline_failure_payload(
    inspection: PipelineFailureInspection,
) -> Mapping[str, Any]:
    failure = inspection.failure
    if failure is None:
        return {"status": "clear", "reason": inspection.reason_code}
    reference = failure.pull_request.reference
    return {
        "status": "ready",
        "reason": inspection.reason_code,
        "connection": resolve_bitbucket_connection(),
        "pull_request": {
            "workspace": reference.workspace,
            "repo": reference.repo,
            "pr_id": reference.pr_id,
            "url": reference.url,
            "source_branch": failure.pull_request.source_branch,
            "source_commit": failure.pull_request.source_commit,
        },
        "working_folder": str(failure.pull_request.working_folder),
        "pipeline": {
            "build_number": failure.build_number,
            "commit": failure.commit,
            "failure_key": failure.failure_key,
            "failed_steps": [
                {"uuid": step.uuid, "name": step.name}
                for step in failure.failed_steps
            ],
        },
    }


def get_unrecorded_pr_pipeline_failure_payload(
    **kwargs: Any,
) -> Mapping[str, Any]:
    try:
        return pipeline_failure_payload(
            inspect_unrecorded_pr_pipeline_failure(**kwargs)
        )
    except PrTaskNotWorkable as error:
        return {"status": "skipped", "reason": error.reason_code}
    except (OSError, PrPipelineGateError, PrTaskGateError, UnicodeError) as error:
        print(f"PR pipeline selector blocked: {error}", file=sys.stderr)
        return {
            "status": "blocked",
            "reason": "selection_unavailable",
            "error_type": type(error).__name__,
        }


def evaluate_pr_pipeline_failures_recorded(**kwargs: Any) -> DecisionOutcome:
    try:
        inspection = inspect_unrecorded_pr_pipeline_failure(**kwargs)
        if inspection.failure is not None:
            return no(
                "unrecorded_pipeline_failure",
                build_number=inspection.failure.build_number,
            )
        return yes(inspection.reason_code)
    except PrTaskNotWorkable as error:
        return yes(error.reason_code)
    except (OSError, PrPipelineGateError, PrTaskGateError, UnicodeError) as error:
        print(f"PR pipeline queue check blocked: {error}", file=sys.stderr)
        return yes("pr_pipeline_queue_blocked", error_type=type(error).__name__)
