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


def issue_get(
    key: str,
    *,
    status: str = "In Progress",
    assignee: str | None = "Current User",
) -> dict[str, Any]:
    return {
        "key": key,
        "summary": f"Fix {key}",
        "status": status,
        "assignee": assignee,
        "type": "DEVT Sub-task",
        "raw": {
            "fields": {
                "issuetype": {
                    "name": "DEVT Sub-task",
                    "subtask": True,
                }
            }
        },
    }


class FakeGtRunner:
    def __init__(
        self,
        *,
        story_payload: dict[str, Any] | None = None,
        children: list[dict[str, Any]] | None = None,
        mine: list[dict[str, Any]] | None = None,
        issue_payloads: dict[str, dict[str, Any]] | None = None,
        child_metadata: dict[str, Any] | None = None,
        mine_metadata: dict[str, Any] | None = None,
    ) -> None:
        self.story_payload = story_payload or story()
        self.children = children or []
        self.mine = mine or []
        self.issue_payloads = issue_payloads or {}
        self.child_metadata = child_metadata or {}
        self.mine_metadata = mine_metadata or {}
        self.calls: list[list[str]] = []

    def __call__(self, arguments):
        args = list(arguments)
        self.calls.append(args)
        if args[:3] == ["jira", "issues", "get"]:
            issue_key = args[3]
            if issue_key in self.issue_payloads:
                return self.issue_payloads[issue_key]
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

    def test_ignores_my_in_progress_subtask_and_selects_todo(self) -> None:
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
        self.assertEqual(payload["reason"], "next_todo")
        self.assertEqual(payload["subtask"]["key"], "DEVT-101")

    def test_selects_unassigned_todo_in_natural_key_order(self) -> None:
        runner = FakeGtRunner(
            children=[
                issue("DEVT-110"),
                issue("DEVT-102"),
            ]
        )
        payload = self.payload(runner)

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["reason"], "next_todo")
        self.assertEqual(payload["subtask"]["key"], "DEVT-102")
        self.assertEqual(
            payload["paths"]["root"],
            "codeInfoTmp/bugfixes/DEVT-100/DEVT-102",
        )
        self.assertEqual(payload["connection"], "test-jira")
        self.assertNotIn(
            "--mine",
            [argument for call in runner.calls for argument in call],
        )

    def test_ignores_todo_already_assigned_to_me(self) -> None:
        mine = issue("DEVT-102", assignee="Current User")
        payload = self.payload(
            FakeGtRunner(children=[mine], mine=[mine])
        )

        self.assertEqual(payload["status"], "empty")

    def test_ignores_another_users_subtask(self) -> None:
        another_users = issue("DEVT-102", assignee="Another User")
        payload = self.payload(
            FakeGtRunner(children=[another_users])
        )

        self.assertEqual(payload["status"], "empty")

    def test_any_non_null_assignee_object_counts_as_assigned(self) -> None:
        assigned = issue("DEVT-102")
        assigned["fields"]["assignee"] = {"accountId": "account-123"}

        payload = self.payload(FakeGtRunner(children=[assigned]))

        self.assertEqual(payload["status"], "empty")

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
            "no_unassigned_todo_subtasks",
        )

    def test_ignores_unrecognized_non_todo_status(self) -> None:
        payload = self.payload(
            FakeGtRunner(
                children=[issue("DEVT-101", status="Awaiting Triage")]
            )
        )

        self.assertEqual(payload["status"], "empty")

    def test_ignores_every_assigned_or_non_todo_subtask(self) -> None:
        payload = self.payload(
            FakeGtRunner(
                children=[
                    issue("DEVT-101", assignee="Current User"),
                    issue("DEVT-102", assignee="Another User"),
                    issue("DEVT-103", status="In Progress"),
                    issue(
                        "DEVT-104",
                        status="In Progress",
                        assignee="Current User",
                    ),
                    issue("DEVT-105", status="Closed"),
                    issue("DEVT-106", status="Awaiting Triage"),
                ]
            )
        )

        self.assertEqual(payload["status"], "empty")

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
                children=[issue("DEVT-101")],
                child_metadata={"nextPageToken": "next"},
            ),
        )

        self.assertEqual(ready.answer, "no")
        self.assertEqual(
            ready.reason_code,
            "eligible_unassigned_todo_bugfix_subtask_present",
        )
        self.assertEqual(empty.answer, "yes")
        self.assertEqual(
            empty.reason_code,
            "no_unassigned_todo_bugfix_subtasks",
        )
        self.assertEqual(blocked.answer, "yes")
        self.assertEqual(
            blocked.reason_code,
            "bugfix_story_selection_blocked",
        )

    def test_binding_preserves_exact_claimed_subtask(self) -> None:
        _, story_path = self.write_story()
        selection_runner = FakeGtRunner(
            children=[issue("DEVT-101"), issue("DEVT-102")]
        )
        selected = bugfix_story.bind_next_bugfix_subtask_payload(
            story_path=story_path,
            working_folder=story_path.parent,
            connection="test-jira",
            gt_runner=selection_runner,
        )

        bound = bugfix_story.get_bound_bugfix_subtask_payload(
            story_path=story_path,
            working_folder=story_path.parent,
            gt_runner=FakeGtRunner(
                mine=[
                    issue(
                        "DEVT-101",
                        status="In Progress",
                        assignee="Current User",
                    )
                ],
                issue_payloads={
                    "DEVT-101": issue_get("DEVT-101"),
                },
            ),
        )

        self.assertEqual(selected["subtask"]["key"], "DEVT-101")
        self.assertEqual(bound["status"], "ready")
        self.assertEqual(bound["subtask"]["key"], "DEVT-101")
        self.assertTrue(bound["assigned_to_current_user"])
        binding_path = bugfix_story.resolve_bound_subtask_path(
            working_folder=story_path.parent
        )
        self.assertTrue(binding_path.is_file())

    def test_non_ready_selection_clears_stale_binding(self) -> None:
        _, story_path = self.write_story()
        common = {
            "story_path": story_path,
            "working_folder": story_path.parent,
            "connection": "test-jira",
        }
        ready = bugfix_story.bind_next_bugfix_subtask_payload(
            **common,
            gt_runner=FakeGtRunner(children=[issue("DEVT-101")]),
        )
        empty = bugfix_story.bind_next_bugfix_subtask_payload(
            **common,
            gt_runner=FakeGtRunner(
                children=[issue("DEVT-101", status="In Progress")]
            ),
        )

        self.assertEqual(ready["status"], "ready")
        self.assertEqual(empty["status"], "empty")
        self.assertFalse(
            bugfix_story.resolve_bound_subtask_path(
                working_folder=story_path.parent
            ).exists()
        )

    def test_screenshot_decision_uses_bound_subtask(self) -> None:
        _, story_path = self.write_story()
        bugfix_story.bind_next_bugfix_subtask_payload(
            story_path=story_path,
            working_folder=story_path.parent,
            connection="test-jira",
            gt_runner=FakeGtRunner(children=[issue("DEVT-101")]),
        )
        decision_path = (
            story_path.parent
            / "codeInfoTmp/bugfixes/DEVT-100/DEVT-101/frontend-proof.json"
        )
        decision_path.parent.mkdir(parents=True)
        decision_path.write_text('{"required":false}\n', encoding="utf-8")

        outcome = bugfix_story.evaluate_bugfix_screenshot_proof_unneeded(
            story_path=story_path,
            working_folder=story_path.parent,
            gt_runner=FakeGtRunner(
                mine=[
                    issue(
                        "DEVT-101",
                        status="In Progress",
                        assignee="Current User",
                    )
                ],
                issue_payloads={
                    "DEVT-101": issue_get("DEVT-101"),
                },
            ),
        )

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(
            outcome.reason_code,
            "bugfix_frontend_screenshot_proof_unneeded",
        )

    def test_screenshot_decision_rejects_reassigned_bound_subtask(
        self,
    ) -> None:
        _, story_path = self.write_story()
        bugfix_story.bind_next_bugfix_subtask_payload(
            story_path=story_path,
            working_folder=story_path.parent,
            connection="test-jira",
            gt_runner=FakeGtRunner(children=[issue("DEVT-101")]),
        )

        outcome = bugfix_story.evaluate_bugfix_screenshot_proof_unneeded(
            story_path=story_path,
            working_folder=story_path.parent,
            gt_runner=FakeGtRunner(
                issue_payloads={
                    "DEVT-101": issue_get(
                        "DEVT-101",
                        assignee="Another User",
                    ),
                },
            ),
        )

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(
            outcome.reason_code,
            "bound_bugfix_subtask_not_active",
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
                    if sys.argv[4] == "DEVT-100":
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
                    else:
                        payload = {
                            "key": "DEVT-101",
                            "summary": "Fix bug",
                            "status": "In Progress",
                            "assignee": "Current User",
                            "type": "DEVT Sub-task",
                            "raw": {
                                "fields": {
                                    "issuetype": {
                                        "name": "DEVT Sub-task",
                                        "subtask": True
                                    }
                                }
                            }
                        }
                elif "--mine" in sys.argv:
                    payload = {
                        "issues": [{
                            "key": "DEVT-101",
                            "fields": {
                                "summary": "Fix bug",
                                "status": {"name": "In Progress"},
                                "assignee": {
                                    "displayName": "Current User"
                                },
                                "issuetype": {
                                    "name": "DEVT Sub-task",
                                    "subtask": True
                                }
                            }
                        }]
                    }
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
        binder = subprocess.run(
            [
                "python3",
                str(
                    REPO_ROOT
                    / "scripts"
                    / "flow_control"
                    / "bind_next_bugfix_subtask.py"
                ),
            ],
            cwd=root,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        bound = subprocess.run(
            [
                "python3",
                str(
                    REPO_ROOT
                    / "scripts"
                    / "flow_control"
                    / "get_bound_bugfix_subtask.py"
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
        self.assertEqual(json.loads(binder.stdout)["status"], "ready")
        bound_payload = json.loads(bound.stdout)
        self.assertEqual(bound_payload["status"], "ready")
        self.assertEqual(bound_payload["subtask"]["key"], "DEVT-101")
        self.assertTrue(bound_payload["assigned_to_current_user"])
        self.assertEqual(binder.stderr, "")
        self.assertEqual(bound.stderr, "")


if __name__ == "__main__":
    unittest.main()
