#!/usr/bin/env python3
"""Focused tests for story/task manual testing guidance extraction."""

from __future__ import annotations

import tempfile
import textwrap
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import manual_testing_guidance_status


class ManualTestingGuidanceStatusTests(unittest.TestCase):
    def write_plan(self, content: str) -> str:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        plan_path = Path(tmpdir.name) / "0000123-sample-plan.md"
        plan_path.write_text(textwrap.dedent(content).lstrip())
        return str(plan_path)

    def test_extracts_canonical_story_guidance_before_tasks(self) -> None:
        plan_path = self.write_plan(
            """
            # Story 0000123 - Sample

            ## Story Manual Testing Guidance

            - Use the normal compose stack
            - Cover the paired frontend in final story QA

            # Tasks
            """
        )

        status = manual_testing_guidance_status.build_status(Path(plan_path), None)

        self.assertTrue(status["story_guidance"]["present"])
        self.assertEqual(
            status["story_guidance"]["section_name"], "Story Manual Testing Guidance"
        )
        self.assertEqual(
            status["story_guidance"]["items"],
            ["Use the normal compose stack", "Cover the paired frontend in final story QA"],
        )
        self.assertFalse(status["task_guidance"]["present"])

    def test_does_not_treat_manual_testing_guidance_alias_as_story_section(self) -> None:
        plan_path = self.write_plan(
            """
            # Story 0000123 - Sample

            ## Manual Testing Guidance

            - This should not count as story guidance

            # Tasks
            """
        )

        status = manual_testing_guidance_status.build_status(Path(plan_path), None)

        self.assertFalse(status["story_guidance"]["present"])

    def test_returns_absent_story_guidance_when_missing(self) -> None:
        plan_path = self.write_plan(
            """
            # Story 0000123 - Sample

            ## Description

            - Nothing here

            # Tasks
            """
        )

        status = manual_testing_guidance_status.build_status(Path(plan_path), None)

        self.assertFalse(status["story_guidance"]["present"])
        self.assertEqual(status["story_guidance"]["items"], [])

    def test_extracts_task_guidance_for_selected_task_only(self) -> None:
        plan_path = self.write_plan(
            """
            ### Task 1. First

            #### Manual Testing Guidance

            - Task 1 proof

            #### Implementation notes

            - Note

            ### Task 2. Second

            #### Manual Testing Guidance

            - Task 2 proof
            """
        )

        status = manual_testing_guidance_status.build_status(Path(plan_path), 2)

        self.assertTrue(status["task_guidance"]["present"])
        self.assertEqual(status["task_guidance"]["task_number"], 2)
        self.assertEqual(status["task_guidance"]["items"], ["Task 2 proof"])

    def test_returns_absent_task_guidance_when_missing(self) -> None:
        plan_path = self.write_plan(
            """
            ### Task 1. First

            #### Overview

            - No manual guidance
            """
        )

        status = manual_testing_guidance_status.build_status(Path(plan_path), 1)

        self.assertFalse(status["task_guidance"]["present"])
        self.assertEqual(status["task_guidance"]["task_number"], 1)

    def test_ignores_manual_testing_guidance_after_tasks_as_story_section(self) -> None:
        plan_path = self.write_plan(
            """
            # Story 0000123 - Sample

            # Tasks

            ## Manual Testing Guidance

            - Not story guidance because it is below # Tasks
            """
        )

        status = manual_testing_guidance_status.build_status(Path(plan_path), None)

        self.assertFalse(status["story_guidance"]["present"])

    def test_ignores_story_guidance_heading_after_double_hash_tasks_section(self) -> None:
        plan_path = self.write_plan(
            """
            # Story 0000123 - Sample

            ## Tasks

            ## Story Manual Testing Guidance

            - Not story guidance because it is below ## Tasks

            ### Task 1. First

            #### Manual Testing Guidance

            - Task-scoped proof only
            """
        )

        status = manual_testing_guidance_status.build_status(Path(plan_path), 1)

        self.assertFalse(status["story_guidance"]["present"])
        self.assertEqual(status["task_guidance"]["items"], ["Task-scoped proof only"])

    def test_supports_story_and_task_guidance_together(self) -> None:
        plan_path = self.write_plan(
            """
            # Story 0000123 - Sample

            ## Story Manual Testing Guidance

            - Shared startup

            # Tasks

            ### Task 3. Third

            #### Manual Testing Guidance

            - Task-specific override
            """
        )

        status = manual_testing_guidance_status.build_status(Path(plan_path), 3)

        self.assertEqual(status["story_guidance"]["items"], ["Shared startup"])
        self.assertEqual(status["task_guidance"]["items"], ["Task-specific override"])


if __name__ == "__main__":
    unittest.main()
