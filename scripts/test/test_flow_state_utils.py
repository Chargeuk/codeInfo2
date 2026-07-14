#!/usr/bin/env python3
"""Focused tests for flow_state_utils.py."""

from __future__ import annotations

import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import flow_state_utils


class FlowStateUtilsTests(unittest.TestCase):
    def test_canonical_story_id_preserves_padding_for_artifact_identity(self) -> None:
        self.assertEqual(
            flow_state_utils.canonical_story_id_from_plan_name(
                "0000013-example.md"
            ),
            "0000013",
        )
        self.assertIsNone(
            flow_state_utils.canonical_story_id_from_plan_name("13-example.md")
        )
        self.assertEqual(
            flow_state_utils.normalize_story_number_token("0000013"), "13"
        )

    def test_branch_matches_story_with_exact_story_number(self) -> None:
        self.assertTrue(
            flow_state_utils.branch_matches_story(
                "feature/0000058-improve-flows", "0000058"
            )
        )

    def test_branch_does_not_match_overlapping_story_number(self) -> None:
        self.assertFalse(
            flow_state_utils.branch_matches_story(
                "feature/0000158-improve-flows", "0000058"
            )
        )

    def test_branch_does_not_match_missing_story_number(self) -> None:
        self.assertFalse(
            flow_state_utils.branch_matches_story("feature/improve-flows", "0000058")
        )

    def test_branch_does_not_match_empty_or_missing_branch(self) -> None:
        self.assertFalse(flow_state_utils.branch_matches_story("", "0000058"))
        self.assertFalse(flow_state_utils.branch_matches_story(None, "0000058"))

    def test_review_cycle_id_is_valid_for_matching_story(self) -> None:
        self.assertTrue(
            flow_state_utils.review_cycle_id_is_valid(
                "0000058-rc-20260428T161530Z-1eb771da",
                story_number="0000058",
            )
        )

    def test_review_cycle_id_rejects_wrong_shape(self) -> None:
        self.assertFalse(
            flow_state_utils.review_cycle_id_is_valid(
                "cycle-1",
                story_number="0000058",
            )
        )

    def test_review_cycle_id_rejects_wrong_story_prefix(self) -> None:
        self.assertFalse(
            flow_state_utils.review_cycle_id_is_valid(
                "0000158-rc-20260428T161530Z-1eb771da",
                story_number="0000058",
            )
        )


if __name__ == "__main__":
    unittest.main()
