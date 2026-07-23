#!/usr/bin/env python3
"""Focused tests for the stateless pull-request task batch selector."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import pr_tasks


def task(
    task_id: int,
    *,
    state: str | None = "UNRESOLVED",
    resolved: bool | None = None,
    body: str = "Fix the review issue",
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "id": task_id,
        "content": {"raw": body},
        "created_on": "2026-07-23T10:00:00+00:00",
        "creator": {"display_name": "Reviewer"},
    }
    if state is not None:
        value["state"] = state
    if resolved is not None:
        value["resolved"] = resolved
    return value


class FakeGitRunner:
    def __init__(
        self,
        *,
        remotes: dict[str, list[str]] | None = None,
        branch: str = "feature/pr-fixes",
    ) -> None:
        self.remotes = remotes or {
            "origin": ["git@bitbucket.org:marex-prod/io-api.git"]
        }
        self.branch = branch
        self.calls: list[list[str]] = []

    def __call__(self, arguments):
        args = list(arguments)
        self.calls.append(args)
        if args == ["remote"]:
            return "\n".join(self.remotes) + "\n"
        if args[:3] == ["remote", "get-url", "--all"]:
            return "\n".join(self.remotes[args[3]]) + "\n"
        if args == ["branch", "--show-current"]:
            return f"{self.branch}\n"
        raise AssertionError(f"unexpected git arguments: {args}")


class FakeGtRunner:
    def __init__(
        self,
        *,
        pr_state: str = "OPEN",
        source_branch: str = "feature/pr-fixes",
        task_pages: list[list[dict[str, Any]]] | None = None,
    ) -> None:
        self.pr_state = pr_state
        self.source_branch = source_branch
        self.task_pages = task_pages or [[]]
        self.calls: list[list[str]] = []

    def __call__(self, arguments):
        args = list(arguments)
        self.calls.append(args)
        if args[2] == "get":
            return {
                "id": int(args[3]),
                "state": self.pr_state,
                "source": {"branch": {"name": self.source_branch}},
            }
        if args[2:5] != ["tasks", "list", args[4]]:
            raise AssertionError(f"unexpected gt arguments: {args}")
        page = int(args[args.index("--page") + 1])
        values = self.task_pages[page - 1]
        return {
            "page": page,
            "pagelen": 50,
            "size": sum(len(item) for item in self.task_pages),
            "values": values,
            "next": "next-page" if page < len(self.task_pages) else None,
        }


class PrTaskFlowControlTests(unittest.TestCase):
    def write_list(self, body: str | None = None) -> tuple[tempfile.TemporaryDirectory, Path]:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        path = Path(tempdir.name) / "prs.md"
        path.write_text(
            body
            or (
                "- https://bitbucket.org/marex-prod/io-api/pull-requests/527\n"
                "- https://bitbucket.org/marex-prod/io-api/pull-requests/528 "
                "**IN_SCOPE**\n"
            ),
            encoding="utf-8",
        )
        return tempdir, path

    def select(
        self,
        *,
        git_runner: FakeGitRunner | None = None,
        gt_runner: FakeGtRunner | None = None,
    ) -> pr_tasks.PullRequestTaskBatch:
        _, path = self.write_list()
        return pr_tasks.select_open_pr_task_batch(
            pr_list_path=path,
            working_folder=Path("/work/io-api"),
            git_runner=git_runner or FakeGitRunner(),
            gt_runner=gt_runner or FakeGtRunner(),
        )

    def test_remote_parser_supports_common_bitbucket_urls(self) -> None:
        for remote in [
            "git@bitbucket.org:marex-prod/io-api.git",
            "ssh://git@bitbucket.org/marex-prod/io-api.git",
            "https://bitbucket.org/marex-prod/io-api.git",
            "https://user@bitbucket.org/marex-prod/io-api",
        ]:
            with self.subTest(remote=remote):
                self.assertEqual(
                    pr_tasks.parse_bitbucket_remote(remote),
                    ("marex-prod", "io-api"),
                )

        self.assertIsNone(
            pr_tasks.parse_bitbucket_remote(
                "https://github.com/marex-prod/io-api.git"
            )
        )

    def test_selects_all_unresolved_tasks_across_pages_in_id_order(self) -> None:
        batch = self.select(
            gt_runner=FakeGtRunner(
                task_pages=[
                    [task(30), task(10, state="RESOLVED")],
                    [
                        task(20, state=None, resolved=False, body="Second fix"),
                        task(40, state=None, resolved=True),
                    ],
                ]
            )
        )

        self.assertEqual(batch.reference.pr_id, 528)
        self.assertEqual(batch.reference.repo, "io-api")
        self.assertEqual(batch.source_branch, "feature/pr-fixes")
        self.assertEqual([item.task_id for item in batch.tasks], [20, 30])
        self.assertEqual(batch.tasks[0].body, "Second fix")
        self.assertEqual(batch.tasks[1].author["display_name"], "Reviewer")

    def test_repository_mismatch_skips_without_calling_bitbucket(self) -> None:
        gt_runner = FakeGtRunner(task_pages=[[task(1)]])
        with self.assertRaisesRegex(
            pr_tasks.PrTaskNotWorkable,
            "working_repository_mismatch",
        ):
            self.select(
                git_runner=FakeGitRunner(
                    remotes={
                        "origin": [
                            "https://bitbucket.org/marex-prod/another-repo.git"
                        ]
                    }
                ),
                gt_runner=gt_runner,
            )

        self.assertEqual(gt_runner.calls, [])

    def test_non_open_pr_and_branch_mismatch_are_not_workable(self) -> None:
        with self.assertRaisesRegex(
            pr_tasks.PrTaskNotWorkable,
            "pull_request_not_open",
        ):
            self.select(gt_runner=FakeGtRunner(pr_state="MERGED"))

        with self.assertRaisesRegex(
            pr_tasks.PrTaskNotWorkable,
            "working_branch_mismatch",
        ):
            self.select(
                git_runner=FakeGitRunner(branch="feature/other"),
                gt_runner=FakeGtRunner(source_branch="feature/pr-fixes"),
            )

    def test_unknown_task_state_fails_closed(self) -> None:
        _, path = self.write_list()
        payload = pr_tasks.get_open_pr_task_batch_payload(
            pr_list_path=path,
            working_folder=Path("/work/io-api"),
            git_runner=FakeGitRunner(),
            gt_runner=FakeGtRunner(
                task_pages=[[task(1, state="IN_PROGRESS")]]
            ),
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reason"], "selection_unavailable")
        self.assertEqual(payload["error_type"], "PrTaskGateError")

    def test_payload_contains_complete_bounded_batch(self) -> None:
        _, path = self.write_list()
        payload = pr_tasks.get_open_pr_task_batch_payload(
            pr_list_path=path,
            working_folder=Path("/work/io-api"),
            git_runner=FakeGitRunner(),
            gt_runner=FakeGtRunner(task_pages=[[task(8, body="Fix eight")]]),
        )

        self.assertEqual(payload["status"], "ready")
        self.assertIsNone(payload["reason"])
        self.assertEqual(payload["connection"], "default")
        self.assertEqual(payload["pull_request"]["pr_id"], 528)
        self.assertEqual(
            payload["pull_request"]["source_branch"], "feature/pr-fixes"
        )
        self.assertEqual(payload["tasks"][0]["id"], 8)
        self.assertEqual(payload["tasks"][0]["body"], "Fix eight")

    def test_gate_breaks_when_empty_or_unworkable_and_continues_for_tasks(self) -> None:
        _, path = self.write_list()
        common = {
            "pr_list_path": path,
            "working_folder": Path("/work/io-api"),
            "git_runner": FakeGitRunner(),
        }

        ready = pr_tasks.evaluate_pr_tasks_empty(
            **common,
            gt_runner=FakeGtRunner(task_pages=[[task(1)]]),
        )
        empty = pr_tasks.evaluate_pr_tasks_empty(
            **common,
            gt_runner=FakeGtRunner(task_pages=[[]]),
        )
        merged = pr_tasks.evaluate_pr_tasks_empty(
            **common,
            gt_runner=FakeGtRunner(pr_state="MERGED"),
        )

        self.assertEqual(ready.answer, "no")
        self.assertEqual(ready.reason_code, "unresolved_pr_tasks_present")
        self.assertEqual(ready.details["task_count"], 1)
        self.assertEqual(empty.answer, "yes")
        self.assertEqual(empty.reason_code, "no_unresolved_pr_tasks")
        self.assertEqual(merged.answer, "yes")
        self.assertEqual(merged.reason_code, "pull_request_not_open")

    def test_entrypoints_use_current_working_repository_and_exact_gate_json(
        self,
    ) -> None:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        root = Path(tempdir.name)
        subprocess.run(
            ["git", "init", "-b", "feature/pr-fixes"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                "git",
                "remote",
                "add",
                "origin",
                "git@bitbucket.org:marex-prod/io-api.git",
            ],
            cwd=root,
            check=True,
        )

        pr_list = root / "prs.md"
        pr_list.write_text(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/528 "
            "**IN_SCOPE**\n",
            encoding="utf-8",
        )
        fake_gt = root / "gt"
        fake_gt.write_text(
            textwrap.dedent(
                """
                #!/usr/bin/env python3
                import json
                import sys
                if "get" in sys.argv:
                    print(json.dumps({
                        "id": 528,
                        "state": "OPEN",
                        "source": {"branch": {"name": "feature/pr-fixes"}}
                    }))
                else:
                    print(json.dumps({
                        "page": 1,
                        "pagelen": 50,
                        "size": 1,
                        "values": [{
                            "id": 77,
                            "state": "UNRESOLVED",
                            "content": {"raw": "Fix task 77"}
                        }]
                    }))
                """
            ).lstrip(),
            encoding="utf-8",
        )
        fake_gt.chmod(fake_gt.stat().st_mode | stat.S_IXUSR)
        env = os.environ.copy()
        env["CODEINFO_PR_COMMENTS_FILE"] = str(pr_list)
        env["CODEINFO_GT_BIN"] = str(fake_gt)

        gate = subprocess.run(
            [
                "python3",
                str(
                    REPO_ROOT
                    / "scripts"
                    / "flow_control"
                    / "check_pr_tasks_empty.py"
                ),
            ],
            cwd=root,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        selector = subprocess.run(
            [
                "python3",
                str(
                    REPO_ROOT
                    / "scripts"
                    / "flow_control"
                    / "get_open_pr_task_batch.py"
                ),
            ],
            cwd=root,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertEqual(gate.stdout, '{"answer":"no"}\n')
        self.assertEqual(gate.stderr, "")
        payload = json.loads(selector.stdout)
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["tasks"][0]["id"], 77)
        self.assertEqual(selector.stderr, "")


if __name__ == "__main__":
    unittest.main()
