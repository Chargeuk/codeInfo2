#!/usr/bin/env python3
"""Focused tests for bounded story-plan section extraction."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "plan_sections.py"
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import plan_sections


class PlanSectionsTests(unittest.TestCase):
    def make_repo(self) -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        repo = Path(tmpdir.name)
        plan = repo / "planning" / "0000123-bounded-plan.md"
        plan.parent.mkdir(parents=True)
        plan.write_text(
            textwrap.dedent(
                """
                # Story

                ## Description

                Preserve the agreed story behavior.

                ## Acceptance Criteria

                - The bounded review remains accurate.

                ## Out Of Scope

                - Unrelated redesign work.

                ## Implementation Plan

                Story overview text.

                ### Additional Repositories

                - No Additional Repositories

                ### Task 1. Current implementation

                - Task Status: `__in_progress__`
                - Repository Name: Current Repository

                #### Overview

                Implement the bounded feature.

                #### Subtasks

                1. [ ] Make the change.

                #### Testing

                1. [ ] Run focused proof.

                #### Implementation Notes

                - Work is pending.

                ## Code Review Findings

                Current review introduction.

                ### Task 2. Review-created repair

                - Task Status: `__to_do__`
                - Repository Name: secondary-repository
                - Task Dependencies: Task 1

                #### Overview

                Repair one finding.

                #### Addresses Findings

                - finding-1

                #### Affected Repositories

                - Current Repository
                - secondary-repository

                #### Testing

                1. [ ] Run review proof.

                #### Implementation Notes

                - Not started.

                ## Final Summary

                Existing closeout text.
                """
            ).lstrip()
        )
        state = repo / "codeInfoStatus" / "flow-state"
        state.mkdir(parents=True)
        (state / "current-plan.json").write_text(
            json.dumps(
                {
                    "plan_path": "planning/0000123-bounded-plan.md",
                    "additional_repositories": [{"path": "/tmp/secondary"}],
                }
            )
        )
        (state / "current-task.json").write_text(
            json.dumps({"selected_task": {"number": 1}})
        )
        return repo

    def test_implementation_profile_returns_only_requested_current_task_sections(
        self,
    ) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            profile="implementation", repo_root=repo
        )

        self.assertTrue(output["content_complete"])
        self.assertEqual(output["story_id"], "0000123")
        self.assertEqual(output["story_number"], 123)
        self.assertEqual([task["number"] for task in output["tasks"]], [1])
        markdown = json.dumps(output["tasks"])
        self.assertIn("Implement the bounded feature", markdown)
        self.assertIn("Make the change", markdown)
        self.assertNotIn("Run focused proof", markdown)
        self.assertNotIn("Repair one finding", markdown)
        self.assertNotIn("schema_version", output)

    def test_all_task_testing_query_excludes_unrequested_sections(self) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            all_tasks=True, sections=["Testing"], repo_root=repo
        )

        self.assertEqual([task["number"] for task in output["tasks"]], [1, 2])
        markdown = json.dumps(output["tasks"])
        self.assertIn("Run focused proof", markdown)
        self.assertIn("Run review proof", markdown)
        self.assertNotIn("Implement the bounded feature", markdown)
        self.assertNotIn("Repair one finding", markdown)

    def test_story_section_stops_before_nested_task_content(self) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            requested_story_sections=["Implementation Plan"], repo_root=repo
        )

        section = output["story_sections"][0]
        self.assertIn("Story overview text", section["markdown"])
        self.assertNotIn("Current implementation", section["markdown"])
        self.assertTrue(section["content_complete"])

    def test_story_subsection_is_resolved_without_task_content(self) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            requested_story_sections=["Additional Repositories"], repo_root=repo
        )

        section = output["story_sections"][0]
        self.assertIn("No Additional Repositories", section["markdown"])
        self.assertNotIn("Current implementation", section["markdown"])

    def test_available_heading_indexes_do_not_expose_unrequested_content(self) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            profile="review-findings", repo_root=repo
        )

        story_headings = [item["name"] for item in output["available_story_sections"]]
        self.assertIn("Additional Repositories", story_headings)
        task_two = next(item for item in output["task_index"] if item["number"] == 2)
        self.assertEqual(task_two["repository_name"], "secondary-repository")
        self.assertEqual(task_two["task_dependencies"], "Task 1")
        self.assertEqual(task_two["finding_ids"], ["finding-1"])
        self.assertEqual(
            task_two["affected_repositories"],
            ["Current Repository", "secondary-repository"],
        )
        self.assertIn("Testing", task_two["available_sections"])
        self.assertEqual(
            output["repository_scope"]["additional_repositories"],
            [{"path": "/tmp/secondary"}],
        )
        self.assertNotIn("Run review proof", json.dumps(output["task_index"]))

    def test_review_evidence_profile_returns_only_final_task_proof_packet(self) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            profile="review-evidence", repo_root=repo
        )

        self.assertEqual([task["number"] for task in output["tasks"]], [2])
        packet = json.dumps(output["tasks"])
        self.assertIn("Run review proof", packet)
        self.assertIn("Not started", packet)
        self.assertNotIn("Run focused proof", packet)
        self.assertEqual(len(output["task_index"]), 2)
        self.assertNotIn("task_summaries", output)

    def test_final_task_profile_omits_unused_review_selection_basis(self) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            profile="review-evidence",
            review_created_tasks=True,
            repo_root=repo,
        )

        self.assertEqual([task["number"] for task in output["tasks"]], [2])
        self.assertNotIn("review_task_selection_basis", output)

    def test_review_scope_and_tasking_profiles_include_story_scope_contract(self) -> None:
        repo = self.make_repo()

        for profile in ("review-scope", "review-tasking"):
            with self.subTest(profile=profile):
                output = plan_sections.build_plan_sections(
                    profile=profile, repo_root=repo
                )
                story = json.dumps(output["story_sections"])
                self.assertIn("Preserve the agreed story behavior", story)
                self.assertIn("The bounded review remains accurate", story)
                self.assertIn("Unrelated redesign work", story)
                self.assertNotIn("Existing closeout text", story)

    def test_review_created_query_selects_only_tasks_with_addresses_findings(
        self,
    ) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            review_created_tasks=True,
            sections=["Overview", "Addresses Findings"],
            repo_root=repo,
        )

        self.assertEqual([task["number"] for task in output["tasks"]], [2])
        self.assertIn("finding-1", json.dumps(output["tasks"]))
        self.assertNotIn("Existing closeout text", json.dumps(output["tasks"]))
        self.assertEqual(
            output["review_task_selection_basis"], "addresses_findings_fallback"
        )

    def test_review_created_query_prefers_active_review_state_markers(self) -> None:
        repo = self.make_repo()
        plan = repo / "planning" / "0000123-bounded-plan.md"
        plan.write_text(
            plan.read_text().replace(
                "- finding-1", "- finding-1 from 0000123-rc-current"
            )
        )
        state = repo / "codeInfoStatus" / "flow-state"
        (state / "review-disposition-state.json").write_text(
            json.dumps({"review_cycle_id": "0000123-rc-current"})
        )

        output = plan_sections.build_plan_sections(
            review_created_tasks=True,
            sections=["Overview", "Addresses Findings"],
            repo_root=repo,
        )

        self.assertEqual([task["number"] for task in output["tasks"]], [2])
        self.assertEqual(
            output["review_task_selection_basis"],
            "active_review_state_markers",
        )

    def test_review_created_query_includes_block_before_named_final_task(self) -> None:
        repo = self.make_repo()
        plan = repo / "planning" / "0000123-bounded-plan.md"
        final_task = textwrap.dedent(
            """
            ### Task 3. Final review revalidation

            - Task Status: `__to_do__`

            #### Overview

            Revalidate the review block.

            #### Testing

            1. [ ] Run full proof.

            """
        )
        plan.write_text(
            plan.read_text().replace(
                "## Final Summary", final_task + "## Final Summary"
            )
        )
        state = repo / "codeInfoStatus" / "flow-state"
        (state / "review-disposition-state.json").write_text(
            json.dumps(
                {
                    "task_up_owned_final_revalidation_task_title": (
                        "Final review revalidation"
                    )
                }
            )
        )

        output = plan_sections.build_plan_sections(
            review_created_tasks=True,
            sections=["Overview", "Testing"],
            repo_root=repo,
        )

        self.assertEqual([task["number"] for task in output["tasks"]], [2, 3])

    def test_missing_sections_are_reported_without_falling_back_to_whole_plan(
        self,
    ) -> None:
        repo = self.make_repo()

        output = plan_sections.build_plan_sections(
            task_number=1, sections=["Design Packet"], repo_root=repo
        )

        self.assertEqual(output["tasks"][0]["sections"], [])
        self.assertEqual(
            output["tasks"][0]["missing_sections"], ["Design Packet"]
        )
        self.assertTrue(output["content_complete"])

    def test_cli_outputs_json_for_bounded_query(self) -> None:
        repo = self.make_repo()

        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--task",
                "current",
                "--section",
                "Overview",
            ],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )

        output = json.loads(result.stdout)
        self.assertEqual(output["tasks"][0]["number"], 1)
        self.assertIn(
            "Implement the bounded feature",
            output["tasks"][0]["sections"][0]["markdown"],
        )


if __name__ == "__main__":
    unittest.main()
