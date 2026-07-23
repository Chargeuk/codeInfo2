#!/usr/bin/env python3
"""Focused tests for current-head PR pipeline failure intake."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import pr_pipelines, pr_tasks


REMOTE_COMMIT = "d7fdda251dbe"
LOCAL_COMMIT = "d7fdda251dbe7f656d2407e73b9fc123a3127e88"


def pipeline(
    build_number: int,
    *,
    commit: str = LOCAL_COMMIT,
    state: str = "COMPLETED",
    result: str | None = "FAILED",
    pr_id: int = 528,
) -> dict[str, Any]:
    state_payload: dict[str, Any] = {"name": state}
    if result is not None:
        state_payload["result"] = {"name": result}
    return {
        "build_number": build_number,
        "state": state_payload,
        "target": {
            "commit": {"hash": commit},
            "pullrequest": {"id": pr_id},
        },
    }


def step(
    name: str,
    *,
    result: str,
    uuid: str | None = None,
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "name": name,
        "state": {
            "name": "COMPLETED",
            "result": {"name": result},
        },
    }
    if uuid is not None:
        value["uuid"] = uuid
    return value


def task(task_id: int, *, body: str, state: str) -> dict[str, Any]:
    return {
        "id": task_id,
        "state": state,
        "content": {"raw": body},
    }


class FakeGitRunner:
    def __init__(
        self,
        *,
        head: str = LOCAL_COMMIT,
        branch: str = "feature/pr-fixes",
    ) -> None:
        self.head = head
        self.branch = branch
        self.calls: list[list[str]] = []

    def __call__(self, arguments):
        args = list(arguments)
        self.calls.append(args)
        if args == ["remote"]:
            return "origin\n"
        if args == ["remote", "get-url", "--all", "origin"]:
            return "git@bitbucket.org:marex-prod/io-api.git\n"
        if args == ["branch", "--show-current"]:
            return f"{self.branch}\n"
        if args == ["rev-parse", "HEAD"]:
            return f"{self.head}\n"
        raise AssertionError(f"unexpected git arguments: {args}")


class FakeGtRunner:
    def __init__(
        self,
        *,
        pipeline_pages: list[list[dict[str, Any]]] | None = None,
        steps_by_build: dict[int, list[dict[str, Any]]] | None = None,
        task_pages: list[list[dict[str, Any]]] | None = None,
        pr_state: str = "OPEN",
        source_commit: str = REMOTE_COMMIT,
    ) -> None:
        self.pipeline_pages = pipeline_pages or [[]]
        self.steps_by_build = steps_by_build or {}
        self.task_pages = task_pages or [[]]
        self.pr_state = pr_state
        self.source_commit = source_commit
        self.calls: list[list[str]] = []

    def __call__(self, arguments):
        args = list(arguments)
        self.calls.append(args)
        if args[:3] == ["bitbucket", "prs", "get"]:
            return {
                "id": 528,
                "state": self.pr_state,
                "source": {
                    "branch": {"name": "feature/pr-fixes"},
                    "commit": {"hash": self.source_commit},
                },
            }
        if args[:3] == ["bitbucket", "pipelines", "list"]:
            page = int(args[args.index("--page") + 1])
            return {
                "values": self.pipeline_pages[page - 1],
                "next": (
                    "next-page" if page < len(self.pipeline_pages) else None
                ),
            }
        if args[:3] == ["bitbucket", "pipelines", "get"]:
            build_number = int(args[3])
            return {
                "pipeline": pipeline(build_number),
                "steps": self.steps_by_build.get(build_number, []),
            }
        if args[:4] == ["bitbucket", "prs", "tasks", "list"]:
            page = int(args[args.index("--page") + 1])
            return {
                "values": self.task_pages[page - 1],
                "next": "next-page" if page < len(self.task_pages) else None,
            }
        raise AssertionError(f"unexpected gt arguments: {args}")


class PrPipelineFlowControlTests(unittest.TestCase):
    def write_list(self) -> Path:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        path = Path(tempdir.name) / "prs.md"
        path.write_text(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/528 "
            "**IN_SCOPE**\n",
            encoding="utf-8",
        )
        return path

    def inspect(
        self,
        *,
        gt_runner: FakeGtRunner,
        git_runner: FakeGitRunner | None = None,
    ) -> pr_pipelines.PipelineFailureInspection:
        return pr_pipelines.inspect_unrecorded_pr_pipeline_failure(
            pr_list_path=self.write_list(),
            working_folder=Path("/work/io-api"),
            gt_runner=gt_runner,
            git_runner=git_runner or FakeGitRunner(),
        )

    def test_selects_latest_completed_failure_for_current_head(self) -> None:
        runner = FakeGtRunner(
            pipeline_pages=[
                [
                    pipeline(3640, commit="45ef577fe8f00fb9"),
                    pipeline(3641),
                    pipeline(3639, result="SUCCESSFUL"),
                ]
            ],
            steps_by_build={
                3641: [
                    step("Code Quality", result="SUCCESSFUL"),
                    step(
                        "Execute developer-portal-server Tests",
                        result="FAILED",
                        uuid="{failed-step}",
                    ),
                ]
            },
        )

        inspection = self.inspect(gt_runner=runner)

        self.assertEqual(inspection.reason_code, "unrecorded_pipeline_failure")
        self.assertIsNotNone(inspection.failure)
        assert inspection.failure is not None
        self.assertEqual(inspection.failure.build_number, 3641)
        self.assertEqual(inspection.failure.commit, LOCAL_COMMIT)
        self.assertEqual(
            inspection.failure.failed_steps,
            (
                pr_pipelines.FailedPipelineStep(
                    uuid="{failed-step}",
                    name="Execute developer-portal-server Tests",
                ),
            ),
        )
        self.assertIn("bitbucket-pipeline:3641", inspection.failure.failure_key)

    def test_waits_for_current_pipeline_and_ignores_success(self) -> None:
        for candidate, expected in [
            (
                pipeline(3641, state="IN_PROGRESS", result=None),
                "current_pipeline_not_completed",
            ),
            (
                pipeline(3641, result="SUCCESSFUL"),
                "current_pipeline_not_failed",
            ),
        ]:
            with self.subTest(expected=expected):
                inspection = self.inspect(
                    gt_runner=FakeGtRunner(pipeline_pages=[[candidate]])
                )
                self.assertEqual(inspection.reason_code, expected)
                self.assertIsNone(inspection.failure)

    def test_ignores_stale_failures_and_follows_pipeline_pagination(self) -> None:
        inspection = self.inspect(
            gt_runner=FakeGtRunner(
                pipeline_pages=[
                    [pipeline(3640, commit="45ef577fe8f00fb9")],
                    [pipeline(3641, result="SUCCESSFUL")],
                ]
            )
        )

        self.assertEqual(inspection.reason_code, "current_pipeline_not_failed")
        self.assertIsNone(inspection.failure)

    def test_local_head_mismatch_skips_before_pipeline_reads(self) -> None:
        runner = FakeGtRunner(pipeline_pages=[[pipeline(3641)]])
        with self.assertRaisesRegex(
            pr_tasks.PrTaskNotWorkable,
            "working_head_mismatch",
        ):
            self.inspect(
                gt_runner=runner,
                git_runner=FakeGitRunner(head="aaaaaaaaaaaaaaaa"),
            )

        self.assertFalse(
            any(call[:3] == ["bitbucket", "pipelines", "list"] for call in runner.calls)
        )

    def test_open_or_resolved_matching_task_deduplicates_failure(self) -> None:
        key = pr_pipelines.pipeline_failure_key(3641, LOCAL_COMMIT)
        for state in ["UNRESOLVED", "RESOLVED"]:
            with self.subTest(state=state):
                inspection = self.inspect(
                    gt_runner=FakeGtRunner(
                        pipeline_pages=[[pipeline(3641)]],
                        task_pages=[
                            [
                                task(
                                    77,
                                    state=state,
                                    body=f"#AI Response: CI failure\n{key}",
                                )
                            ]
                        ],
                    )
                )
                self.assertEqual(
                    inspection.reason_code,
                    "pipeline_failure_already_recorded",
                )
                self.assertIsNone(inspection.failure)

    def test_payload_exposes_bounded_task_recording_context(self) -> None:
        path = self.write_list()
        payload = pr_pipelines.get_unrecorded_pr_pipeline_failure_payload(
            pr_list_path=path,
            working_folder=Path("/work/io-api"),
            git_runner=FakeGitRunner(),
            gt_runner=FakeGtRunner(
                pipeline_pages=[[pipeline(3641)]],
                steps_by_build={
                    3641: [step("Failed tests", result="FAILED")]
                },
            ),
        )

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["pull_request"]["pr_id"], 528)
        self.assertEqual(payload["pipeline"]["build_number"], 3641)
        self.assertEqual(
            payload["pipeline"]["failed_steps"][0]["name"],
            "Failed tests",
        )
        self.assertIn(
            "AI Pipeline Failure Key:",
            payload["pipeline"]["failure_key"],
        )

    def test_gate_enters_only_for_unrecorded_completed_failure(self) -> None:
        path = self.write_list()
        common = {
            "pr_list_path": path,
            "working_folder": Path("/work/io-api"),
            "git_runner": FakeGitRunner(),
        }
        actionable = pr_pipelines.evaluate_pr_pipeline_failures_recorded(
            **common,
            gt_runner=FakeGtRunner(
                pipeline_pages=[[pipeline(3641)]],
                steps_by_build={3641: []},
            ),
        )
        clear = pr_pipelines.evaluate_pr_pipeline_failures_recorded(
            **common,
            gt_runner=FakeGtRunner(
                pipeline_pages=[
                    [pipeline(3641, state="IN_PROGRESS", result=None)]
                ]
            ),
        )

        self.assertEqual(actionable.answer, "no")
        self.assertEqual(actionable.reason_code, "unrecorded_pipeline_failure")
        self.assertEqual(actionable.details["build_number"], 3641)
        self.assertEqual(clear.answer, "yes")
        self.assertEqual(clear.reason_code, "current_pipeline_not_completed")

    def test_malformed_pipeline_payload_fails_closed(self) -> None:
        path = self.write_list()
        payload = pr_pipelines.get_unrecorded_pr_pipeline_failure_payload(
            pr_list_path=path,
            working_folder=Path("/work/io-api"),
            git_runner=FakeGitRunner(),
            gt_runner=FakeGtRunner(
                pipeline_pages=[[{"build_number": 3641}]]
            ),
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reason"], "selection_unavailable")
        self.assertEqual(payload["error_type"], "PrPipelineGateError")


if __name__ == "__main__":
    unittest.main()
