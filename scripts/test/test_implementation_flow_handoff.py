#!/usr/bin/env python3
"""Regression coverage for task selection after blocker-driven plan repair."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
FLOW_NAMES = (
    "implement_current_plan",
    "implement_next_plan",
    "implement_next_plan_github_review",
    "improve_task_implement_plan",
    "task_and_implement_plan",
)


def step_lists(steps):
    yield steps
    for step in steps:
        if "steps" in step:
            yield from step_lists(step["steps"])


class ImplementationFlowHandoffTests(unittest.TestCase):
    def test_every_post_repair_exit_refreshes_and_reselects_first(self):
        for name in FLOW_NAMES:
            with self.subTest(flow=name):
                flow = json.loads((REPO_ROOT / "flows" / f"{name}.json").read_text())
                gates = []
                for steps in step_lists(flow["steps"]):
                    for index, step in enumerate(steps):
                        if step.get("label") == "Exit story flow successfully while durable blocker remains":
                            gates.append(step)
                            prior = steps[:index]
                            impact = next(
                                i for i, candidate in enumerate(prior)
                                if candidate.get("markdownFile") == "research_blocker_impact_on_plan.md"
                            )
                            preparation = prior[impact + 1:]
                            self.assertEqual(
                                [candidate.get("markdownFile") for candidate in preparation],
                                [
                                    "refresh_current_plan_handoff.md",
                                    "repair_current_plan_workflow_state.md"
                                    if name == "implement_current_plan"
                                    else "repair_story_workflow_state.md",
                                    "select_current_task.md",
                                ],
                            )
                            self.assertEqual(preparation[-1]["type"], "llm")
                            self.assertEqual(preparation[-1]["agentType"], "planning_agent")
                            self.assertEqual(preparation[-1]["identifier"], "planner")
                            self.assertEqual(step["decisionScript"], "scripts/flow_control/check_current_task_has_blocker.py")
                            self.assertEqual(step["breakOn"], "yes")
                            self.assertIs(step["exitFlow"], True)
                self.assertEqual(len(gates), 1)

    def make_repaired_repo(self, *, prerequisite_blocked=False, handoff="stale"):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        repo = Path(tmp.name)
        plan = repo / "planning" / "0000014-example.md"
        plan.parent.mkdir()
        plan.write_text(textwrap.dedent("""\
            ### Task 4. Repair shared baseline

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [ ] Repair baseline

            #### Testing

            1. [ ] Prove baseline

            #### Implementation Notes

            PREREQUISITE_NOTES

            ### Task 5. Prove textures

            - Task Dependencies: `4`
            - Task Status: `__to_do__`

            #### Subtasks

            1. [x] Implement proof

            #### Testing

            1. [ ] Run scheduler

            #### Implementation Notes

            - **BLOCKER** Shared baseline must be repaired by Task 4 first.
            """).replace(
                "PREREQUISITE_NOTES",
                "- **BLOCKER** Required external dependency is unavailable."
                if prerequisite_blocked else "- Reopened as the executable prerequisite.",
            ))
        state = repo / "codeInfoStatus" / "flow-state"
        state.mkdir(parents=True)
        (state / "current-plan.json").write_text(json.dumps({
            "plan_path": str(plan.relative_to(repo)),
            "additional_repositories": [],
        }))
        if handoff == "stale":
            (state / "current-task.json").write_text(json.dumps({
                "selection_status": "resolved",
                "selected_task": {"number": 5, "status": "__in_progress__"},
            }))
        elif handoff == "malformed":
            (state / "current-task.json").write_text("{invalid json")
        return repo

    def run_script(self, repo, script):
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / script)],
            cwd=repo, capture_output=True, text=True, check=True,
        )
        return json.loads(result.stdout)

    def reselect(self, repo):
        result = self.run_script(repo, "select_current_task.py")
        persisted = json.loads(
            (repo / "codeInfoStatus" / "flow-state" / "current-task.json").read_text()
        )
        self.assertEqual(result, persisted)
        self.assertEqual(result["selection_status"], "resolved")
        self.assertEqual(result["selected_task"]["number"], 4)
        validity = self.run_script(repo, "check_current_task_handoff.py")
        self.assertIs(validity["has_valid_current_task_handoff"], True)

    def test_reselection_releases_reopened_prerequisite_without_erasing_downstream_blocker(self):
        repo = self.make_repaired_repo()
        gate = "flow_control/check_current_task_has_blocker.py"
        self.assertEqual(self.run_script(repo, gate), {"answer": "yes"})
        self.reselect(repo)
        self.assertEqual(self.run_script(repo, gate), {"answer": "no"})
        plan = (repo / "planning" / "0000014-example.md").read_text()
        self.assertIn("- **BLOCKER** Shared baseline must be repaired by Task 4 first.", plan)
        self.assertIn("- Task Status: `__to_do__`", plan)

    def test_reselection_preserves_exit_for_a_blocked_prerequisite(self):
        repo = self.make_repaired_repo(prerequisite_blocked=True)
        self.reselect(repo)
        self.assertEqual(
            self.run_script(repo, "flow_control/check_current_task_has_blocker.py"),
            {"answer": "yes"},
        )

    def test_reselection_recovers_missing_or_malformed_task_handoff(self):
        for handoff in ("missing", "malformed"):
            with self.subTest(handoff=handoff):
                repo = self.make_repaired_repo(handoff=handoff)
                self.reselect(repo)
                self.assertEqual(
                    self.run_script(repo, "flow_control/check_current_task_has_blocker.py"),
                    {"answer": "no"},
                )


if __name__ == "__main__":
    unittest.main()
