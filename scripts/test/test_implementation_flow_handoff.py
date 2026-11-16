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
sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_story_workflow_status as workflow_fixtures


FLOW_NAMES = (
    "implement_current_plan",
    "pr_current_plan",
    "improve_task_implement_current_plan",
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
                        if step.get("label") == "Leave task execution for review while durable blocker remains":
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
                                    if name in ("implement_current_plan", "pr_current_plan", "improve_task_implement_current_plan")
                                    else "repair_story_workflow_state.md",
                                    "select_current_task.md",
                                ],
                            )
                            self.assertEqual(preparation[-1]["type"], "llm")
                            self.assertEqual(preparation[-1]["agentType"], "planning_agent")
                            self.assertEqual(preparation[-1]["identifier"], "planner")
                            if name in ("implement_current_plan", "pr_current_plan"):
                                self.assertEqual(step["decisionScript"], "scripts/flow_control/check_story_has_durable_blocker.py")
                                self.assertIn("Return its current stdout exactly and nothing else.", step["question"])
                                self.assertIn("Do not recompute the answer.", step["question"])
                            elif name == "implement_next_plan_github_review":
                                self.assertEqual(step["decisionScript"], "scripts/flow_control/check_current_task_has_blocker.py")
                            else:
                                self.assertNotIn("decisionScript", step)
                                question = step["question"]
                                for clause in (
                                    "Use fresh persisted handoffs, plan_status.py",
                                    "latest actual coder/tester/manual outcomes",
                                    'Return exactly {"answer":"yes"} or {"answer":"no"}',
                                    "exit INCOMPLETE only when a live blocker remains",
                                    "after the existing bounded repair/research route",
                                    "every safe independent required implementation, automated proof, manual proof and owned cleanup action",
                                    "has been attempted or has a verified dependency preventing it",
                                    "A blocker alone, an old failed check or unchanged helper count is insufficient",
                                    "Answer no while an authorized repair or untried safe independent action can make meaningful progress",
                                    "retain valid evidence",
                                    "do not ask an unavailable human or retry unchanged failures indefinitely",
                                    "Never claim story completion; report exact remaining obligations and external authority limits",
                                    "No edits, tests or side effects",
                                ):
                                    self.assertIn(clause, question)
                            self.assertEqual(step["breakOn"], "yes")
                            self.assertNotIn("exitFlow", step)
                self.assertEqual(len(gates), 1)
                story = next(step for step in flow["steps"] if step.get("label") == "Story Execution And Review Loop")
                outer = story["steps"]
                labels = [step.get("label") for step in outer]
                exit_index = labels.index("Exit story flow successfully while durable blocker remains")
                self.assertEqual(labels[exit_index + 1], "Exit Story Loop When Plan And Review Are Complete")
                review_label = "Run PR Review Cycle" if name == "pr_current_plan" else "Run Two-Phase Review Cycle"
                self.assertLess(labels.index(review_label), labels.index("Refresh Plan Handoff After Review Settlement"))
                self.assertLess(labels.index("Repair Story State After Review Settlement"), labels.index("Checkpoint Push Before Story Completion Check"))
                self.assertLess(labels.index("Checkpoint Push Before Story Completion Check"), exit_index)
                late = outer[exit_index]
                self.assertIs(late["exitFlow"], True)
                if name == "implement_next_plan_github_review":
                    sandbox = json.loads((REPO_ROOT / "flows-sandbox" / f"{name}.json").read_text())
                    self.assertEqual(flow, sandbox)
                    self.assertIn("check_current_task_has_blocker.py", gates[0]["question"])
                    self.assertEqual(late["decisionScript"], "scripts/flow_control/check_story_has_durable_blocker.py")
                    self.assertEqual(late["question"], gates[0]["question"].replace(
                        "check_current_task_has_blocker.py", "check_story_has_durable_blocker.py"
                    ))
                    self.assertEqual(
                        {k: v for k, v in late.items() if k not in ("label", "exitFlow", "question", "decisionScript")},
                        {k: v for k, v in gates[0].items() if k not in ("label", "question", "decisionScript")},
                    )
                else:
                    self.assertEqual({k: v for k, v in late.items() if k not in ("label", "exitFlow")},
                                     {k: v for k, v in gates[0].items() if k != "label"})
                if name == "implement_next_plan_github_review":
                    self.assertLess(labels.index("Run GitHub Review Only After Internal Story Completion"), exit_index)

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

    def test_legacy_final_gate_continues_after_review_adds_independent_work(self):
        blocked = textwrap.dedent("""\
            ### Task 1. Blocked work

            - Task Status: `__in_progress__`

            #### Subtasks

            1. [ ] Implement blocked work

            #### Testing

            1. [ ] Prove blocked work

            #### Implementation Notes

            - **BLOCKER** External authority is unavailable.
            """)
        repo, _ = workflow_fixtures.StoryWorkflowStatusTests.make_repo(
            self, plan_content=blocked
        )
        state = repo / "codeInfoStatus/flow-state/current-task.json"
        state.write_text(json.dumps({
            "selection_status": "resolved",
            "selected_task": {"number": 1, "status": "__in_progress__"},
        }))
        flow = json.loads((REPO_ROOT / "flows/implement_next_plan_github_review.json").read_text())
        story = next(step for step in flow["steps"] if step.get("label") == "Story Execution And Review Loop")
        gate = next(step for step in story["steps"] if step.get("label") == "Exit story flow successfully while durable blocker remains")
        script = gate["decisionScript"].removeprefix("scripts/")
        self.assertEqual(self.run_script(repo, script), {"answer": "yes"})
        plan = repo / "planning/0000123-sample-story.md"
        independent = textwrap.dedent("""\

            ### Task 2. Independent review work

            - Task Status: `__to_do__`

            #### Subtasks

            1. [ ] Implement review fix

            #### Testing

            1. [ ] Prove review fix

            #### Implementation Notes
            """)
        plan.write_text(blocked + independent)
        self.assertEqual(self.run_script(repo, "flow_control/check_current_task_has_blocker.py"), {"answer": "yes"})
        self.assertEqual(self.run_script(repo, script), {"answer": "no"})

        # Model the existing settlement's status update without changing proof or blockers.
        settled = (blocked.replace("__in_progress__", "__to_do__")
                   + independent.replace("__to_do__", "__in_progress__"))
        plan.write_text(settled)
        selection = self.run_script(repo, "select_current_task.py")
        self.assertEqual(selection["selection_status"], "resolved")
        self.assertEqual(selection["selected_task"]["number"], 2)
        self.assertEqual(json.loads(state.read_text()), selection)
        self.assertEqual(plan.read_text(), settled)

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
