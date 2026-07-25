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
        comments_by_pr: dict[int, list[Any]],
        in_scope_state: str = "OPEN",
        page_size: int = 50,
        failing_prs: set[int] | None = None,
        fail_on_page_by_pr: dict[int, int] | None = None,
    ) -> None:
        self.comments_by_pr = comments_by_pr
        self.in_scope_state = in_scope_state
        self.page_size = page_size
        self.failing_prs = failing_prs or set()
        self.fail_on_page_by_pr = fail_on_page_by_pr or {}
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
        if pr_id in self.failing_prs or self.fail_on_page_by_pr.get(pr_id) == page:
            raise pr_comments.PrCommentGateError(f"PR {pr_id} read failed")
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

    def test_checked_in_inventory_contains_supplied_prs_with_528_in_scope(self) -> None:
        path = REPO_ROOT / "codeinfo_markdown" / "handle_pr_comments_prs.md"
        references = pr_comments.parse_pr_list(path.read_text(encoding="utf-8"))

        self.assertEqual(
            [reference.pr_id for reference in references],
            [
                505,
                507,
                509,
                510,
                512,
                515,
                518,
                519,
                520,
                521,
                522,
                525,
                527,
                529,
                528,
            ],
        )
        self.assertEqual(pr_comments.require_in_scope_pr(references).pr_id, 528)

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

    def test_parser_tolerates_markdown_and_ignores_unusable_items(self) -> None:
        warnings: list[str] = []
        references = pr_comments.parse_pr_list(
            """
            # Pull requests

            This prose is intentionally ignored.
              * <https://bitbucket.org/marex-prod/io-api/pull-requests/505> source
            + [Aggregate](https://bitbucket.org/marex-prod/io-api/pull-requests/600) ** in_scope **
            - not a pull request
            """,
            warn=warnings.append,
        )

        self.assertEqual([reference.pr_id for reference in references], [505, 600])
        self.assertTrue(references[1].in_scope)
        self.assertTrue(any("without a PR URL" in warning for warning in warnings))

    def test_parser_rejects_only_missing_or_ambiguous_in_scope_configuration(self) -> None:
        with self.assertRaisesRegex(
            pr_comments.PrCommentGateError,
            "contains no pull requests",
        ):
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

    def test_parser_skips_ambiguous_multi_url_item(self) -> None:
        warnings: list[str] = []
        references = pr_comments.parse_pr_list(
            "\n".join(
                [
                    "- https://bitbucket.org/marex-prod/io-api/pull-requests/505 "
                    "https://bitbucket.org/marex-prod/io-api/pull-requests/507",
                    "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 "
                    "trailing text **IN_SCOPE**",
                ]
            ),
            warn=warnings.append,
        )

        self.assertEqual([reference.pr_id for reference in references], [600])
        self.assertTrue(any("ambiguous multi-URL" in warning for warning in warnings))

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

        paths = pr_comments.eligible_leaf_paths(comments, now=NOW)

        self.assertEqual(
            [[item["id"] for item in path] for path in paths],
            [[1, 2, 3]],
        )

    def test_marker_accepts_canonical_and_tolerant_forms(self) -> None:
        for raw in [
            "#AI Response: Handled.",
            "#AI Response:\nHandled.",
            "#AI Response:",
            "  #ai response : handled",
            "\n#AI   RESPONSE: handled",
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

    def test_marker_later_in_human_prose_does_not_handle_leaf(self) -> None:
        comments = [
            comment(
                1,
                created_on=NOW - timedelta(minutes=5),
                raw="The text #AI Response: is our automation marker.",
            )
        ]

        self.assertTrue(pr_comments.has_eligible_leaves(comments, now=NOW))

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

    def test_duplicate_ids_are_deduplicated_and_remain_eligible(self) -> None:
        warnings: list[str] = []
        comments = [
            comment(1, created_on=NOW, raw="First"),
            comment(1, created_on=NOW, raw="Duplicate"),
        ]

        paths = pr_comments.eligible_leaf_paths(
            comments,
            now=NOW,
            warn=warnings.append,
        )

        self.assertEqual([[item["id"] for item in path] for path in paths], [[1]])
        self.assertTrue(any("duplicate comment id 1" in warning for warning in warnings))

    def test_numeric_string_ids_and_parents_are_coerced(self) -> None:
        warnings: list[str] = []
        root = comment(1, created_on=NOW - timedelta(hours=1), raw="Root")
        leaf = comment(
            2,
            parent_id=1,
            created_on=NOW,
            raw="Leaf",
        )
        root["id"] = "1"
        leaf["id"] = "2"
        leaf["parent"] = {"id": "1"}

        paths = pr_comments.eligible_leaf_paths(
            [root, leaf],
            now=NOW,
            warn=warnings.append,
        )

        self.assertEqual(len(paths), 1)
        self.assertEqual([item["id"] for item in paths[0]], ["1", "2"])
        self.assertTrue(any("coerced string comment id" in warning for warning in warnings))
        self.assertTrue(any("coerced string parent id" in warning for warning in warnings))

    def test_missing_id_is_skipped_without_hiding_valid_leaf(self) -> None:
        warnings: list[str] = []
        missing_id = comment(1, created_on=NOW, raw="No id")
        missing_id.pop("id")
        valid = comment(2, created_on=NOW, raw="Valid")

        paths = pr_comments.eligible_leaf_paths(
            [missing_id, valid],
            now=NOW,
            warn=warnings.append,
        )

        self.assertEqual([[item["id"] for item in path] for path in paths], [[2]])
        self.assertTrue(any("without a usable positive id" in warning for warning in warnings))

    def test_unknown_timestamps_are_conservatively_eligible_and_sorted_first(self) -> None:
        warnings: list[str] = []
        missing = comment(1, created_on=NOW, raw="Missing time")
        missing.pop("created_on")
        invalid = comment(2, created_on=NOW, raw="Invalid time")
        invalid["created_on"] = "not-a-time"
        timezone_less = comment(3, created_on=NOW, raw="Timezone-less")
        timezone_less["created_on"] = "2026-07-22T11:00:00"
        known = comment(
            4,
            created_on=NOW - timedelta(minutes=5),
            raw="Known time",
        )

        paths = pr_comments.eligible_leaf_paths(
            [known, timezone_less, invalid, missing],
            now=NOW,
            warn=warnings.append,
        )

        self.assertEqual(
            [[item["id"] for item in path] for path in paths],
            [[1], [2], [3], [4]],
        )
        self.assertTrue(any("unknown creation time" in warning for warning in warnings))
        self.assertTrue(any("invalid creation time" in warning for warning in warnings))
        self.assertTrue(any("timezone-less" in warning for warning in warnings))

    def test_unrecognised_deleted_flag_is_treated_as_visible(self) -> None:
        warnings: list[str] = []
        leaf = comment(1, created_on=NOW, raw="Visible")
        leaf["deleted"] = "unknown"

        paths = pr_comments.eligible_leaf_paths(
            [leaf],
            now=NOW,
            warn=warnings.append,
        )

        self.assertEqual([[item["id"] for item in path] for path in paths], [[1]])
        self.assertTrue(any("deleted flag" in warning for warning in warnings))

    def test_missing_parent_becomes_a_provisional_root(self) -> None:
        warnings: list[str] = []
        comments = [
            comment(1, parent_id=99, created_on=NOW, raw="Orphan")
        ]

        paths = pr_comments.eligible_leaf_paths(
            comments,
            now=NOW,
            warn=warnings.append,
        )

        self.assertEqual([[item["id"] for item in path] for path in paths], [[1]])
        self.assertTrue(any("missing parent 99" in warning for warning in warnings))

    def test_parent_cycle_is_broken_without_hiding_other_branches(self) -> None:
        warnings: list[str] = []
        comments = [
            comment(1, parent_id=2, created_on=NOW, raw="One"),
            comment(2, parent_id=1, created_on=NOW, raw="Two"),
            comment(3, created_on=NOW, raw="Independent"),
        ]

        paths = pr_comments.eligible_leaf_paths(
            comments,
            now=NOW,
            warn=warnings.append,
        )

        self.assertEqual(
            [[item["id"] for item in path] for path in paths],
            [[1], [2], [3]],
        )
        self.assertTrue(any("cyclic comment parents" in warning for warning in warnings))

    def test_visible_leaf_without_text_body_remains_eligible(self) -> None:
        malformed = comment(1, created_on=NOW, raw="placeholder")
        malformed["content"] = None
        warnings: list[str] = []

        paths = pr_comments.eligible_leaf_paths(
            [malformed],
            now=NOW,
            warn=warnings.append,
        )

        self.assertEqual([[item["id"] for item in path] for path in paths], [[1]])
        self.assertTrue(any("without a text body" in warning for warning in warnings))

    def test_duplicate_comment_does_not_make_gate_fail_closed(self) -> None:
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

        self.assertEqual(outcome.answer, "no")
        self.assertEqual(outcome.reason_code, "eligible_pr_leaves_present")

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

    def test_failed_pr_blocks_selection_even_with_leaf_on_another_pr(self) -> None:
        path = self.write_list(
            """
            - https://bitbucket.org/marex-prod/io-api/pull-requests/505
            - https://bitbucket.org/marex-prod/io-api/pull-requests/507
            - https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**
            """
        )
        runner = FakeGtRunner(
            comments_by_pr={
                507: [comment(2, created_on=NOW, raw="Needs an answer")],
            },
            failing_prs={505},
        )

        outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "pr_comment_queue_blocked")
        self.assertEqual(outcome.details["failed_pr_ids"], [505])

    def test_failed_pr_blocks_empty_result_for_retry(self) -> None:
        path = self.write_list(
            """
            - https://bitbucket.org/marex-prod/io-api/pull-requests/505
            - https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**
            """
        )
        runner = FakeGtRunner(comments_by_pr={}, failing_prs={505})

        outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "pr_comment_queue_blocked")
        self.assertEqual(outcome.details["failed_pr_ids"], [505])

    def test_partial_pagination_failure_discards_pr_snapshot(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        runner = FakeGtRunner(
            comments_by_pr={
                600: [
                    comment(1, created_on=NOW, raw="First page"),
                    comment(2, created_on=NOW, raw="Second page"),
                ]
            },
            page_size=1,
            fail_on_page_by_pr={600: 2},
        )

        outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertEqual(outcome.answer, "yes")
        self.assertEqual(outcome.reason_code, "pr_comment_queue_blocked")

    def test_non_object_comment_is_skipped_without_blocking_valid_leaf(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        runner = FakeGtRunner(
            comments_by_pr={
                600: [None, comment(1, created_on=NOW, raw="Valid")]
            }
        )

        outcome = pr_comments.evaluate_pr_comment_leaves(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertEqual(outcome.answer, "no")

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

    def test_selector_picks_oldest_leaf_across_all_pull_requests(self) -> None:
        path = self.write_list(
            """
            - https://bitbucket.org/marex-prod/io-api/pull-requests/505
            - https://bitbucket.org/marex-prod/io-api/pull-requests/507
            - https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**
            """
        )
        runner = FakeGtRunner(
            comments_by_pr={
                505: [
                    comment(
                        10,
                        created_on=NOW - timedelta(minutes=10),
                        raw="Newer",
                    )
                ],
                507: [
                    comment(
                        20,
                        created_on=NOW - timedelta(minutes=20),
                        raw="Oldest across the queue",
                    )
                ],
                600: [
                    comment(
                        30,
                        created_on=NOW - timedelta(minutes=5),
                        raw="Newest",
                    )
                ],
            }
        )

        selection = pr_comments.select_next_pr_comment_leaf(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertIsNotNone(selection)
        assert selection is not None
        self.assertEqual(selection.reference.pr_id, 507)
        self.assertEqual(selection.leaf_id, 20)
        listed_prs = [
            int(call[4])
            for call in runner.calls
            if call[2:4] == ["comments", "list"]
        ]
        self.assertEqual(listed_prs, [505, 507, 600])

    def test_selector_returns_full_chain_including_old_and_ai_ancestors(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        runner = FakeGtRunner(
            comments_by_pr={
                600: [
                    comment(
                        1,
                        created_on=NOW - timedelta(days=10),
                        raw="Old root",
                    ),
                    comment(
                        2,
                        parent_id=1,
                        created_on=NOW - timedelta(days=5),
                        raw="#AI Response: Earlier answer.",
                    ),
                    comment(
                        3,
                        parent_id=2,
                        created_on=NOW - timedelta(minutes=5),
                        raw="Human follow-up",
                    ),
                ]
            }
        )

        selection = pr_comments.select_next_pr_comment_leaf(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertIsNotNone(selection)
        assert selection is not None
        self.assertEqual([item["id"] for item in selection.path], [1, 2, 3])
        self.assertEqual(selection.thread_root_id, 1)
        self.assertFalse(selection.must_fix)

    def test_must_fix_matches_case_insensitively_anywhere_in_root_thread(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        root = comment(
            1,
            created_on=NOW - timedelta(hours=2),
            raw="#ai_must_fix please preserve this",
        )
        root["user"] = {"display_name": "Root reviewer"}
        root["links"] = {"html": {"href": "https://example.test/comment/1"}}
        sibling = comment(
            2,
            parent_id=1,
            created_on=NOW - timedelta(minutes=10),
            raw="#AI Response: noted in the middle #Ai_MuSt_FiX of this reply",
        )
        sibling["user"] = {"display_name": "AI reviewer"}
        sibling["links"] = {"html": {"href": "https://example.test/comment/2"}}
        leaf = comment(
            3,
            parent_id=1,
            created_on=NOW - timedelta(minutes=20),
            raw="Please implement this ending with #AI_MUST_FIX",
        )
        leaf["user"] = {"display_name": "Leaf reviewer"}
        leaf["links"] = {"html": {"href": "https://example.test/comment/3"}}
        runner = FakeGtRunner(comments_by_pr={600: [root, sibling, leaf]})

        payload = pr_comments.get_next_pr_comment_leaf_payload(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["leaf_id"], 3)
        self.assertEqual(payload["thread_root_id"], 1)
        self.assertTrue(payload["must_fix"])
        self.assertEqual(
            [item["comment_id"] for item in payload["must_fix_evidence"]],
            [1, 2, 3],
        )
        self.assertEqual(
            [
                item["on_selected_path"]
                for item in payload["must_fix_evidence"]
            ],
            [True, False, True],
        )
        self.assertEqual(
            payload["must_fix_evidence"][1]["author"]["display_name"],
            "AI reviewer",
        )
        self.assertEqual(
            payload["must_fix_evidence"][1]["url"],
            "https://example.test/comment/2",
        )

    def test_must_fix_in_another_root_does_not_leak_or_change_queue_order(
        self,
    ) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        runner = FakeGtRunner(
            comments_by_pr={
                600: [
                    comment(
                        1,
                        created_on=NOW - timedelta(minutes=20),
                        raw="Older unmarked thread",
                    ),
                    comment(
                        2,
                        created_on=NOW - timedelta(minutes=10),
                        raw="#AI_MUST_FIX newer marked thread",
                    ),
                ]
            }
        )

        first = pr_comments.select_next_pr_comment_leaf(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.leaf_id, 1)
        self.assertEqual(first.thread_root_id, 1)
        self.assertFalse(first.must_fix)

    def test_must_fix_near_miss_does_not_trigger(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        runner = FakeGtRunner(
            comments_by_pr={
                600: [
                    comment(
                        1,
                        created_on=NOW - timedelta(minutes=5),
                        raw="This says #AI_MUST_FIXTURE, not the directive.",
                    )
                ]
            }
        )

        selection = pr_comments.select_next_pr_comment_leaf(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertIsNotNone(selection)
        assert selection is not None
        self.assertFalse(selection.must_fix)

    def test_must_fix_marker_on_later_page_applies_to_human_reply_after_ai(
        self,
    ) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        human_leaf = comment(
            3,
            parent_id=2,
            created_on=NOW - timedelta(minutes=5),
            raw="Human response after the AI",
        )
        root = comment(
            1,
            created_on=NOW - timedelta(days=4),
            raw="Root has #AI_MUST_FIX",
        )
        ai_parent = comment(
            2,
            parent_id=1,
            created_on=NOW - timedelta(days=2),
            raw="#AI Response: Earlier answer.",
        )
        runner = FakeGtRunner(
            comments_by_pr={600: [human_leaf, root, ai_parent]},
            page_size=1,
        )

        selection = pr_comments.select_next_pr_comment_leaf(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertIsNotNone(selection)
        assert selection is not None
        self.assertEqual([item["id"] for item in selection.path], [1, 2, 3])
        self.assertEqual(selection.leaf_id, 3)
        self.assertTrue(selection.must_fix)
        comment_calls = [
            call for call in runner.calls if call[2:4] == ["comments", "list"]
        ]
        self.assertEqual(len(comment_calls), 3)

    def test_deleted_structural_comment_body_can_carry_must_fix(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        deleted_root = comment(
            1,
            created_on=NOW - timedelta(days=2),
            raw="Deleted but returned #AI_MUST_FIX",
            deleted=True,
        )
        leaf = comment(
            2,
            parent_id=1,
            created_on=NOW - timedelta(minutes=5),
            raw="Visible leaf",
        )
        runner = FakeGtRunner(comments_by_pr={600: [deleted_root, leaf]})

        selection = pr_comments.select_next_pr_comment_leaf(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertIsNotNone(selection)
        assert selection is not None
        self.assertEqual(selection.thread_root_id, 1)
        self.assertTrue(selection.must_fix)
        self.assertEqual(
            [_comment["id"] for _comment in selection.must_fix_comments],
            [1],
        )

    def test_selector_orders_unknown_time_first_then_uses_stable_pr_ties(self) -> None:
        path = self.write_list(
            """
            - https://bitbucket.org/z-workspace/io-api/pull-requests/700
            - https://bitbucket.org/a-workspace/io-api/pull-requests/700
            - https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**
            """
        )
        unknown = comment(99, created_on=NOW, raw="Unknown timestamp")
        unknown.pop("created_on")
        runner = FakeGtRunner(
            comments_by_pr={
                700: [unknown],
                600: [comment(1, created_on=NOW, raw="Known timestamp")],
            }
        )

        selection = pr_comments.select_next_pr_comment_leaf(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertIsNotNone(selection)
        assert selection is not None
        self.assertEqual(selection.reference.workspace, "a-workspace")
        self.assertEqual(selection.leaf_id, 99)

    def test_selector_fails_closed_when_any_configured_pr_is_unavailable(self) -> None:
        path = self.write_list(
            """
            - https://bitbucket.org/marex-prod/io-api/pull-requests/505
            - https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**
            """
        )
        runner = FakeGtRunner(
            comments_by_pr={
                600: [comment(1, created_on=NOW, raw="Available leaf")]
            },
            failing_prs={505},
        )

        payload = pr_comments.get_next_pr_comment_leaf_payload(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["failed_pr_ids"], [505])

    def test_selection_payload_preserves_inline_source_and_destination_lines(self) -> None:
        path = self.write_list(
            "- https://bitbucket.org/marex-prod/io-api/pull-requests/600 **IN_SCOPE**\n"
        )
        inline_leaf = comment(1, created_on=NOW, raw="This was removed")
        inline_leaf["inline"] = {
            "path": "docs/example.md",
            "from": 12,
            "to": 9,
            "start_from": 10,
            "start_to": 7,
        }
        runner = FakeGtRunner(comments_by_pr={600: [inline_leaf]})

        payload = pr_comments.get_next_pr_comment_leaf_payload(
            pr_list_path=path,
            runner=runner,
            now=NOW,
        )

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(
            payload["path"][0]["inline"],
            {
                "path": "docs/example.md",
                "from": 12,
                "to": 9,
                "start_from": 10,
                "start_to": 7,
            },
        )

    def test_pr_528_duplicate_shape_has_no_eligible_ai_leaf(self) -> None:
        comments = [
            comment(
                830399446,
                created_on=NOW - timedelta(hours=1),
                raw="Human review comment",
            ),
            comment(
                830411168,
                parent_id=830399446,
                created_on=NOW - timedelta(minutes=20),
                raw="#AI Response: First answer.",
            ),
            comment(
                830498963,
                parent_id=830399446,
                created_on=NOW - timedelta(minutes=10),
                raw="#AI Response: Duplicate answer.",
            ),
        ]

        self.assertEqual(
            pr_comments.eligible_leaf_paths(comments, now=NOW),
            [],
        )

        comments.append(
            comment(
                830500000,
                parent_id=830411168,
                created_on=NOW - timedelta(minutes=5),
                raw="Human follow-up below the first answer",
            )
        )
        paths = pr_comments.eligible_leaf_paths(comments, now=NOW)
        self.assertEqual(
            [[item["id"] for item in item] for item in paths],
            [[830399446, 830411168, 830500000]],
        )

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

    def test_selector_entrypoint_returns_ready_context_json(self) -> None:
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
                    print(json.dumps({
                        "page": 1,
                        "pagelen": 50,
                        "size": 1,
                        "values": [{
                            "id": 77,
                            "created_on": "2099-01-01T00:00:00+00:00",
                            "deleted": False,
                            "parent": None,
                            "content": {"raw": "Selected review"},
                            "user": {"display_name": "Reviewer"},
                            "inline": {"path": "docs/example.md", "from": 12, "to": 9}
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

        result = subprocess.run(
            [
                "python3",
                str(
                    REPO_ROOT
                    / "scripts"
                    / "flow_control"
                    / "get_next_pr_comment_leaf.py"
                ),
            ],
            cwd=REPO_ROOT,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["connection"], "default")
        self.assertEqual(payload["source"]["pr_id"], 600)
        self.assertEqual(payload["in_scope_destination"]["pr_id"], 600)
        self.assertEqual(payload["leaf_id"], 77)
        self.assertEqual(payload["thread_root_id"], 77)
        self.assertFalse(payload["must_fix"])
        self.assertEqual(payload["must_fix_evidence"], [])
        self.assertEqual(payload["path"][0]["author"]["display_name"], "Reviewer")
        self.assertEqual(payload["path"][0]["inline"]["from"], 12)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
