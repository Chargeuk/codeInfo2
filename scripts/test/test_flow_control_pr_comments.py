#!/usr/bin/env python3
"""Focused tests for the stateless pull-request comment queue gate."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from flow_control import pr_comments


NOW = datetime(2026, 7, 22, 12, 0, tzinfo=UTC)


def comment(
    comment_id: int,
    *,
    created_on: datetime,
    raw: str,
    parent_id: int | None = None,
    deleted: bool = False,
) -> dict[str, Any]:
    return {
        "id": comment_id,
        "created_on": created_on.isoformat(),
        "deleted": deleted,
        "parent": {"id": parent_id} if parent_id is not None else None,
        "content": {"raw": raw},
    }


class FakeGtRunner:
    def __init__(
        self,
        *,
        comments_by_pr: dict[int, list[dict[str, Any]]],
        in_scope_state: str = "OPEN",
        page_size: int = 50,
    ) -> None:
        self.comments_by_pr = comments_by_pr
        self.in_scope_state = in_scope_state
        self.page_size = page_size
        self.calls: list[list[str]] = []

    def __call__(self, arguments):
        args = list(arguments)
        self.calls.append(args)
        if args[2] == "get":
            return {"id": int(args[3]), "state": self.in_scope_state}
        if args[2:5] != ["comments", "list", args[4]]:
            raise AssertionError(f"unexpected gt arguments: {args}")
        pr_id = int(args[4])
        page = int(args[args.index("--page") + 1])
        values = self.comments_by_pr.get(pr_id, [])
        start = (page - 1) * self.page_size
        selected = values[start : start + self.page_size]
        has_next = start + self.page_size < len(values)
        return {
            "page": page,
            "pagelen": self.page_size,
            "size": len(values),
            "values": selected,
            "next": "next-page" if has_next else None,
        }


class PrCommentFlowControlTests(unittest.TestCase):
    def write_list(self, body: str) -> Path:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        path = Path(tempdir.name) / "prs.md"
        path.write_text(textwrap.dedent(body).lstrip(), encoding="utf-8")
        return path

    def test_checked_in_inventory_contains_supplied_prs_without_in_scope(self) -> None:
        path = REPO_ROOT / "codeinfo_markdown" / "handle_pr_comments_prs.md"
        references = pr_comments.parse_pr_list(path.read_text(encoding="utf-8"))

        self.assertEqual(
            [reference.pr_id for reference in references],
            [505, 507, 509, 510, 512, 515, 518, 519, 520, 521, 522, 525, 527],
        )
        with self.assertRaisesRegex(
            pr_comments.PrCommentGateError,
            "exactly one IN_SCOPE pull request; found 0",
        ):
            pr_comments.require_in_scope_pr(references)

    def test_parser_deduplicates_urls_and_promotes_marked_duplicate(self) -> None:
        references = pr_comments.parse_pr_list(
            "\n".join(
                [
                    "- https://bitbucket.org/marex-prod/io-api/pull-requests/527",
                    "- https://bitbucket.org/marex-prod/io-api/pull-requests/527 **IN_SCOPE**",
                ]
            )
        )

        self.assertEqual(len(references), 1)
        self.assertTrue(references[0].in_scope)

    def test_parser_rejects_malformed_and_multiple_marked_entries(self) -> None:
        with self.assertRaisesRegex(pr_comments.PrCommentGateError, "line 1"):
            pr_comments.parse_pr_list("https://example.com/not-a-list")

        references = pr_comments.parse_pr_list(
            "\n".join(
                [
                    "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**",
                    "- https://bitbucket.org/marex-prod/io-api/pull-requests/601 **IN_SCOPE**",
                ]
            )
        )
        with self.assertRaisesRegex(
            pr_comments.PrCommentGateError,
            "exactly one IN_SCOPE pull request; found 2",
        ):
            pr_comments.require_in_scope_pr(references)

    def test_recent_human_leaf_returns_no(self) -> None:
        path = self.write_list(
            """
            - https://bitbucket.org/marex-prod/io-api/pull-requests/505
            - https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**
            """
        )
        runner = FakeGtRunner(
            comments_by_pr={
                505: [
                    comment(
                        1,
                        created_on=NOW - timedelta(minutes=5),
                        raw="Please explain this.",
                    )
                ]
            }
        )

        outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path, runner=runner, now=NOW
        )

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "eligible_pr_leaves_present")

    def test_old_leaf_is_not_eligible(self) -> None:
        comments = [
            comment(
                1,
                created_on=NOW - timedelta(hours=24, microseconds=1),
                raw="Old question",
            )
        ]

        self.assertFalse(pr_comments.has_eligible_leaves(comments, now=NOW))

    def test_exact_24_hour_boundary_remains_eligible(self) -> None:
        comments = [
            comment(
                1,
                created_on=NOW - timedelta(hours=24),
                raw="Boundary question",
            )
        ]

        self.assertTrue(pr_comments.has_eligible_leaves(comments, now=NOW))

    def test_recent_ai_leaf_handles_its_branch(self) -> None:
        comments = [
            comment(
                1,
                created_on=NOW - timedelta(hours=30),
                raw="Old root",
            ),
            comment(
                2,
                parent_id=1,
                created_on=NOW - timedelta(minutes=20),
                raw="Recent follow-up",
            ),
            comment(
                3,
                parent_id=2,
                created_on=NOW - timedelta(minutes=10),
                raw="#AI Response: This is handled.",
            ),
        ]

        self.assertFalse(pr_comments.has_eligible_leaves(comments, now=NOW))

    def test_human_reply_after_ai_creates_new_eligible_leaf(self) -> None:
        comments = [
            comment(
                1,
                created_on=NOW - timedelta(hours=2),
                raw="Question",
            ),
            comment(
                2,
                parent_id=1,
                created_on=NOW - timedelta(hours=1),
                raw="#AI Response: Initial answer.",
            ),
            comment(
                3,
                parent_id=2,
                created_on=NOW - timedelta(minutes=5),
                raw="Can you clarify?",
            ),
        ]

        self.assertTrue(pr_comments.has_eligible_leaves(comments, now=NOW))

    def test_marker_accepts_canonical_newline_and_colon_only_forms(self) -> None:
        for raw in [
            "#AI Response: Handled.",
            "#AI Response:\nHandled.",
            "#AI Response:",
        ]:
            with self.subTest(raw=raw):
                comments = [
                    comment(
                        1,
                        created_on=NOW - timedelta(minutes=5),
                        raw=raw,
                    )
                ]

                self.assertFalse(
                    pr_comments.has_eligible_leaves(comments, now=NOW)
                )

    def test_deleted_recent_comments_do_not_create_an_eligible_leaf(self) -> None:
        comments = [
            comment(
                1,
                created_on=NOW - timedelta(minutes=5),
                raw="Deleted",
                deleted=True,
            )
        ]

        self.assertFalse(pr_comments.has_eligible_leaves(comments, now=NOW))

    def test_each_visible_fork_leaf_is_evaluated_independently(self) -> None:
        comments = [
            comment(
                1,
                created_on=NOW - timedelta(hours=30),
                raw="Root review comment",
            ),
            comment(
                2,
                parent_id=1,
                created_on=NOW - timedelta(minutes=20),
                raw="#AI Response: This branch is handled.",
            ),
            comment(
                3,
                parent_id=1,
                created_on=NOW - timedelta(minutes=10),
                raw="What about the other case?",
            ),
        ]

        paths = pr_comments.eligible_leaf_paths(comments, now=NOW)

        self.assertEqual(
            [[item["id"] for item in path] for path in paths],
            [[1, 3]],
        )

    def test_two_human_fork_leaves_are_both_returned_oldest_first(self) -> None:
        comments = [
            comment(1, created_on=NOW - timedelta(hours=30), raw="Root"),
            comment(
                3,
                parent_id=1,
                created_on=NOW - timedelta(minutes=5),
                raw="Newer branch",
            ),
            comment(
                2,
                parent_id=1,
                created_on=NOW - timedelta(minutes=10),
                raw="Older branch",
            ),
        ]

        paths = pr_comments.eligible_leaf_paths(comments, now=NOW)

        self.assertEqual(
            [[item["id"] for item in path] for path in paths],
            [[1, 2], [1, 3]],
        )

    def test_all_ai_fork_leaves_handle_the_tree(self) -> None:
        comments = [
            comment(1, created_on=NOW - timedelta(hours=1), raw="Root"),
            comment(
                2,
                parent_id=1,
                created_on=NOW - timedelta(minutes=20),
                raw="#AI Response: First branch handled.",
            ),
            comment(
                3,
                parent_id=1,
                created_on=NOW - timedelta(minutes=10),
                raw="#AI Response: Second branch handled.",
            ),
        ]

        self.assertFalse(pr_comments.has_eligible_leaves(comments, now=NOW))

    def test_old_ancestors_are_retained_in_recent_leaf_path(self) -> None:
        comments = [
            comment(1, created_on=NOW - timedelta(days=10), raw="Old root"),
            comment(
                2,
                parent_id=1,
                created_on=NOW - timedelta(days=2),
                raw="Old middle",
            ),
            comment(
                3,
                parent_id=2,
                created_on=NOW - timedelta(minutes=5),
                raw="Recent leaf",
            ),
        ]

        paths = pr_comments.eligible_leaf_paths(comments, now=NOW)

        self.assertEqual(
            [[item["id"] for item in path] for path in paths],
            [[1, 2, 3]],
        )

    def test_old_leaf_is_ignored_while_recent_sibling_is_eligible(self) -> None:
        comments = [
            comment(1, created_on=NOW - timedelta(days=3), raw="Root"),
            comment(
                2,
                parent_id=1,
                created_on=NOW - timedelta(days=2),
                raw="Old leaf",
            ),
            comment(
                3,
                parent_id=1,
                created_on=NOW - timedelta(minutes=5),
                raw="Recent leaf",
            ),
        ]

        paths = pr_comments.eligible_leaf_paths(comments, now=NOW)

        self.assertEqual(
            [[item["id"] for item in path] for path in paths],
            [[1, 3]],
        )

    def test_empty_or_non_question_leaf_is_still_eligible(self) -> None:
        for raw in ["", "Thanks", "This seems out of scope"]:
            with self.subTest(raw=raw):
                comments = [
                    comment(
                        1,
                        created_on=NOW - timedelta(minutes=5),
                        raw=raw,
                    )
                ]
                self.assertTrue(
                    pr_comments.has_eligible_leaves(comments, now=NOW)
                )

    def test_deleted_structural_comment_does_not_hide_visible_descendant(self) -> None:
        comments = [
            comment(1, created_on=NOW - timedelta(days=2), raw="Root"),
            comment(
                2,
                parent_id=1,
                created_on=NOW - timedelta(hours=1),
                raw="Deleted middle",
                deleted=True,
            ),
            comment(
                3,
                parent_id=2,
                created_on=NOW - timedelta(minutes=5),
                raw="Visible leaf",
            ),
        ]

        paths = pr_comments.eligible_leaf_paths(comments, now=NOW)

        self.assertEqual(
            [[item["id"] for item in path] for path in paths],
            [[1, 2, 3]],
        )

    def test_malformed_comment_graphs_are_rejected(self) -> None:
        cases = {
            "duplicate ids": [
                comment(1, created_on=NOW, raw="One"),
                comment(1, created_on=NOW, raw="Two"),
            ],
            "missing parent": [
                comment(1, parent_id=99, created_on=NOW, raw="Orphan")
            ],
            "cycle": [
                comment(1, parent_id=2, created_on=NOW, raw="One"),
                comment(2, parent_id=1, created_on=NOW, raw="Two"),
            ],
        }

        for message, comments in cases.items():
            with self.subTest(message=message):
                with self.assertRaises(pr_comments.PrCommentGateError):
                    pr_comments.eligible_leaf_paths(comments, now=NOW)

    def test_visible_leaf_requires_a_text_body(self) -> None:
        malformed = comment(1, created_on=NOW, raw="placeholder")
        malformed["content"] = None

        with self.assertRaisesRegex(
            pr_comments.PrCommentGateError,
            "visible leaf comment has no text body",
        ):
            pr_comments.eligible_leaf_paths([malformed], now=NOW)

    def test_malformed_comment_graph_makes_gate_fail_closed(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        runner = FakeGtRunner(
            comments_by_pr={
                600: [
                    comment(1, created_on=NOW, raw="One"),
                    comment(1, created_on=NOW, raw="Duplicate"),
                ]
            }
        )

        outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "pr_comment_queue_blocked")

    def test_comment_pagination_is_drained(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        runner = FakeGtRunner(
            comments_by_pr={
                600: [
                    comment(1, created_on=NOW - timedelta(hours=30), raw="Old"),
                    comment(2, created_on=NOW - timedelta(minutes=1), raw="New"),
                ]
            },
            page_size=1,
        )

        outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path, runner=runner, now=NOW
        )

        self.assertEqual(outcome.answer, "no")
        comment_calls = [call for call in runner.calls if "comments" in call]
        self.assertEqual(len(comment_calls), 2)

    def test_closed_target_and_gt_failures_fail_closed(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        closed = FakeGtRunner(comments_by_pr={}, in_scope_state="MERGED")

        closed_outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path, runner=closed, now=NOW
        )

        self.assertEqual(closed_outcome.answer, "yes")
        self.assertEqual(closed_outcome.reason_code, "pr_comment_queue_blocked")

        def failing_runner(_arguments):
            raise pr_comments.PrCommentGateError("network unavailable")

        failed_outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path, runner=failing_runner, now=NOW
        )
        self.assertEqual(failed_outcome.answer, "yes")

    def test_entrypoint_stdout_is_exact_json(self) -> None:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        root = Path(tempdir.name)
        pr_list = root / "prs.md"
        pr_list.write_text(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n",
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
                    print(json.dumps({"id": 600, "state": "OPEN"}))
                else:
                    print(json.dumps({"page": 1, "pagelen": 50, "size": 0, "values": []}))
                """
            ).lstrip(),
            encoding="utf-8",
        )
        fake_gt.chmod(fake_gt.stat().st_mode | stat.S_IXUSR)
        env = os.environ.copy()
        env["CODEINFO_PR_COMMENTS_FILE"] = str(pr_list)
        env["CODEINFO_GT_BIN"] = str(fake_gt)

        result = subprocess.run(
            [
                "python3",
                str(
                    REPO_ROOT
                    / "scripts"
                    / "flow_control"
                    / "check_pr_comment_threads_empty.py"
                ),
            ],
            cwd=REPO_ROOT,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.stdout, '{"answer":"yes"}\n')
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
