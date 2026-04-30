#!/usr/bin/env python3
"""Focused tests for story/task manual testing guidance extraction."""

from __future__ import annotations

import json
import os
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

    def make_temp_repo(self) -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        return Path(tmpdir.name)

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

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), None
        )

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

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), None
        )

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

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), None
        )

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

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), 2
        )

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

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), 1
        )

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

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), None
        )

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

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), 1
        )

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

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), 3
        )

        self.assertEqual(status["story_guidance"]["items"], ["Shared startup"])
        self.assertEqual(status["task_guidance"]["items"], ["Task-specific override"])

    def test_returns_structured_absent_task_guidance_when_task_number_missing(self) -> None:
        plan_path = self.write_plan(
            """
            ### Task 1. First

            #### Manual Testing Guidance

            - Task 1 proof
            """
        )

        status = manual_testing_guidance_status.build_status(
            plan_path, Path(plan_path), 99
        )

        self.assertFalse(status["task_guidance"]["present"])
        self.assertEqual(status["task_guidance"]["task_number"], 99)
        self.assertEqual(status["task_guidance"]["lookup_error"], "task_not_found")

    def test_preserves_raw_handoff_plan_path_and_exposes_resolved_path(self) -> None:
        repo_root = self.make_temp_repo()
        planning_dir = repo_root / "planning"
        handoff_dir = repo_root / "codeInfoStatus" / "flow-state"
        planning_dir.mkdir(parents=True)
        handoff_dir.mkdir(parents=True)
        plan_rel_path = "planning/0000123-sample-plan.md"
        plan_path = repo_root / plan_rel_path
        plan_path.write_text("# Story 0000123 - Sample\n")
        handoff_path = handoff_dir / "current-plan.json"
        handoff_path.write_text(json.dumps({"plan_path": plan_rel_path}))

        original_cwd = Path.cwd()
        os.chdir(repo_root)
        self.addCleanup(os.chdir, original_cwd)

        raw_path, resolved_path = manual_testing_guidance_status.resolve_plan_path(
            None, str(handoff_path.relative_to(repo_root))
        )
        status = manual_testing_guidance_status.build_status(raw_path, resolved_path, None)

        self.assertEqual(status["plan_path"], plan_rel_path)
        self.assertEqual(status["resolved_plan_path"], str(plan_path.resolve()))


if __name__ == "__main__":
    unittest.main()
