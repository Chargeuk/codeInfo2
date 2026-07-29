#!/usr/bin/env python3
"""Focused tests for deterministic Jira bugfix-story selection."""

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
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import bugfix_story


def story(
    key: str = "DEVT-100",
    *,
    issue_type: str = "Story",
    is_subtask: bool = False,
) -> dict[str, Any]:
    return {
        "key": key,
        "summary": "Bugfix story",
        "status": "In Progress",
        "assignee": None,
        "type": issue_type,
        "raw": {
            "fields": {
                "issuetype": {
                    "name": issue_type,
                    "subtask": is_subtask,
                }
            }
        },
    }


def issue(
    key: str,
    *,
    status: str = "To Do",
    assignee: str | None = None,
    issue_type: str = "DEVT Sub-task",
    is_subtask: bool = True,
) -> dict[str, Any]:
    return {
        "key": key,
        "fields": {
            "summary": f"Fix {key}",
            "status": {"name": status},
            "assignee": (
                {"displayName": assignee}
                if assignee is not None
                else None
            ),
            "issuetype": {
                "name": issue_type,
                "subtask": is_subtask,
            },
        },
    }


class FakeGtRunner:
    def __init__(
        self,
        *,
        story_payload: dict[str, Any] | None = None,
        children: list[dict[str, Any]] | None = None,
        mine: list[dict[str, Any]] | None = None,
        child_metadata: dict[str, Any] | None = None,
        mine_metadata: dict[str, Any] | None = None,
    ) -> None:
        self.story_payload = story_payload or story()
        self.children = children or []
        self.mine = mine or []
        self.child_metadata = child_metadata or {}
        self.mine_metadata = mine_metadata or {}
        self.calls: list[list[str]] = []

    def __call__(self, arguments):
        args = list(arguments)
        self.calls.append(args)
        if args[:3] == ["jira", "issues", "get"]:
            return self.story_payload
        if args[:3] == ["jira", "issues", "list"]:
            if "--mine" in args:
                return {"issues": self.mine, **self.mine_metadata}
            return {"issues": self.children, **self.child_metadata}
        raise AssertionError(f"unexpected gt arguments: {args}")


class BugfixStoryFlowControlTests(unittest.TestCase):
    def write_story(
        self,
        content: str = "https://marex.atlassian.net/browse/DEVT-100\n",
    ) -> tuple[tempfile.TemporaryDirectory, Path]:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        path = Path(tempdir.name) / "bugfix_story.md"
        path.write_text(content, encoding="utf-8")
        return tempdir, path

    def payload(
        self,
        runner: FakeGtRunner,
        *,
        content: str = "DEVT-100\n",
    ) -> dict[str, Any]:
        _, path = self.write_story(content)
        return dict(
            bugfix_story.get_next_bugfix_subtask_payload(
                story_path=path,
                working_folder=path.parent,
                connection="test-jira",
                gt_runner=runner,
            )
        )

    def test_story_file_accepts_one_unique_key_or_url(self) -> None:
        self.assertEqual(
            bugfix_story.parse_story_key(
                "Story: https://marex.atlassian.net/browse/devt-123\n"
                "Tracking: DEVT-123\n"
            ),
            "DEVT-123",
        )

    def test_story_file_rejects_missing_or_multiple_keys(self) -> None:
        for content in ["No Jira issue\n", "DEVT-100 and DEVT-101\n"]:
            with self.subTest(content=content):
                with self.assertRaisesRegex(
                    bugfix_story.BugfixStoryGateError,
                    "exactly one Jira issue",
                ):
                    bugfix_story.parse_story_key(content)

    def test_missing_story_file_returns_blocked_payload(self) -> None:
        payload = bugfix_story.get_next_bugfix_subtask_payload(
            story_path=Path("/missing/bugfix_story.md"),
            gt_runner=FakeGtRunner(),
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reason"], "selection_unavailable")

    def test_requires_the_input_issue_to_be_a_story(self) -> None:
        payload = self.payload(
            FakeGtRunner(
                story_payload=story(
                    issue_type="DEVT Sub-task",
                    is_subtask=True,
                )
            )
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertIn("is not a Jira story", payload["message"])

    def test_recovers_my_in_progress_subtask_before_todo(self) -> None:
        todo = issue("DEVT-101")
        active = issue(
            "DEVT-105",
            status="In Progress",
            assignee="Current User",
        )
        payload = self.payload(
            FakeGtRunner(
                children=[todo, active],
                mine=[active],
            )
        )

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["reason"], "recover_in_progress")
        self.assertEqual(payload["subtask"]["key"], "DEVT-105")

    def test_selects_unassigned_todo_in_natural_key_order(self) -> None:
        payload = self.payload(
            FakeGtRunner(
                children=[
                    issue("DEVT-110"),
                    issue("DEVT-102"),
                ]
            )
        )

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["reason"], "next_todo")
        self.assertEqual(payload["subtask"]["key"], "DEVT-102")
        self.assertEqual(
            payload["paths"]["root"],
            "codeInfoTmp/bugfixes/DEVT-100/DEVT-102",
        )
        self.assertEqual(payload["connection"], "test-jira")

    def test_selects_todo_already_assigned_to_me(self) -> None:
        mine = issue("DEVT-102", assignee="Current User")
        payload = self.payload(
            FakeGtRunner(children=[mine], mine=[mine])
        )

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["subtask"]["key"], "DEVT-102")

    def test_never_claims_another_users_subtask(self) -> None:
        another_users = issue("DEVT-102", assignee="Another User")
        payload = self.payload(
            FakeGtRunner(children=[another_users])
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertIn("none is safe to claim", payload["message"])

    def test_ignores_completed_and_non_subtask_children(self) -> None:
        payload = self.payload(
            FakeGtRunner(
                children=[
                    issue("DEVT-101", status="Closed"),
                    issue(
                        "DEVT-102",
                        issue_type="Task",
                        is_subtask=False,
                    ),
                ]
            )
        )

        self.assertEqual(payload["status"], "empty")
        self.assertEqual(
            payload["reason"],
            "no_active_or_todo_subtasks",
        )

    def test_unknown_subtask_status_fails_closed(self) -> None:
        payload = self.payload(
            FakeGtRunner(
                children=[issue("DEVT-101", status="Awaiting Triage")]
            )
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertIn("Awaiting Triage", payload["message"])

    def test_truncated_jira_results_fail_closed(self) -> None:
        payload = self.payload(
            FakeGtRunner(
                children=[issue("DEVT-101")],
                child_metadata={"nextPageToken": "next"},
            )
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertIn("exceed one GT page", payload["message"])

    def test_gate_continues_for_ready_and_exits_for_empty_or_blocked(
        self,
    ) -> None:
        _, path = self.write_story()
        common = {
            "story_path": path,
            "working_folder": path.parent,
            "connection": "test-jira",
        }

        ready = bugfix_story.evaluate_bugfix_story_subtasks_empty(
            **common,
            gt_runner=FakeGtRunner(
                children=[issue("DEVT-101")]
            ),
        )
        empty = bugfix_story.evaluate_bugfix_story_subtasks_empty(
            **common,
            gt_runner=FakeGtRunner(
                children=[issue("DEVT-101", status="Closed")]
            ),
        )
        blocked = bugfix_story.evaluate_bugfix_story_subtasks_empty(
            **common,
            gt_runner=FakeGtRunner(
                children=[issue("DEVT-101", status="Unknown")]
            ),
        )

        self.assertEqual(ready.answer, "no")
        self.assertEqual(
            ready.reason_code,
            "workable_bugfix_subtask_present",
        )
        self.assertEqual(empty.answer, "yes")
        self.assertEqual(
            empty.reason_code,
            "no_active_or_todo_bugfix_subtasks",
        )
        self.assertEqual(blocked.answer, "yes")
        self.assertEqual(
            blocked.reason_code,
            "bugfix_story_selection_blocked",
        )

    def test_connection_uses_environment_override(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"CODEINFO_GT_JIRA_CONNECTION": "jira-env"},
        ):
            self.assertEqual(
                bugfix_story.resolve_jira_connection(),
                "jira-env",
            )

    def test_entrypoints_use_current_repository_and_exact_json(self) -> None:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        root = Path(tempdir.name)
        (root / "bugfix_story.md").write_text(
            "DEVT-100\n",
            encoding="utf-8",
        )
        fake_gt = root / "gt"
        fake_gt.write_text(
            textwrap.dedent(
                """
                #!/usr/bin/env python3
                import json
                import sys

                if sys.argv[1:4] == ["jira", "issues", "get"]:
                    payload = {
                        "key": "DEVT-100",
                        "summary": "Bugfix story",
                        "status": "In Progress",
                        "assignee": None,
                        "type": "Story",
                        "raw": {
                            "fields": {
                                "issuetype": {
                                    "name": "Story",
                                    "subtask": False
                                }
                            }
                        }
                    }
                elif "--mine" in sys.argv:
                    payload = {"issues": []}
                else:
                    payload = {
                        "issues": [{
                            "key": "DEVT-101",
                            "fields": {
                                "summary": "Fix bug",
                                "status": {"name": "To Do"},
                                "assignee": None,
                                "issuetype": {
                                    "name": "DEVT Sub-task",
                                    "subtask": True
                                }
                            }
                        }]
                    }
                print(json.dumps(payload))
                """
            ).lstrip(),
            encoding="utf-8",
        )
        fake_gt.chmod(fake_gt.stat().st_mode | stat.S_IXUSR)
        env = os.environ.copy()
        env["CODEINFO_GT_BIN"] = str(fake_gt)
        env["CODEINFO_GT_JIRA_CONNECTION"] = "test-jira"

        gate = subprocess.run(
            [
                "python3",
                str(
                    REPO_ROOT
                    / "scripts"
                    / "flow_control"
                    / "check_bugfix_story_subtasks_empty.py"
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
                    / "get_next_bugfix_subtask.py"
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
        self.assertEqual(payload["connection"], "test-jira")
        self.assertEqual(payload["subtask"]["key"], "DEVT-101")
        self.assertEqual(selector.stderr, "")


if __name__ == "__main__":
    unittest.main()
