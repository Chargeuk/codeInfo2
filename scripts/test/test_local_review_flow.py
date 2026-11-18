#!/usr/bin/env python3
"""Local review flow structure; these tests do not execute agent decisions."""
import copy
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def flow(name):
    return json.loads((ROOT / "flows" / f"{name}.json").read_text())


def labeled(steps, label):
    return next(step for step in steps if step.get("label") == label)


class LocalReviewFlowTests(unittest.TestCase):
    def test_parent_receipt_and_original_task_guard(self):
        parent = flow("codeinfo2_implement_story")
        local = next(s for s in parent["steps"] if s.get("label", "").startswith("23a."))
        self.assertEqual(local["failureMode"], "best_effort")
        self.assertEqual(local["groups"][0]["id"], "codeinfo2_implement_current_plan")
        self.assertEqual(local["groups"][0]["flowName"], "local_review_current_plan")
        local_steps = flow("local_review_current_plan")["steps"]
        guarded = labeled(local_steps, "Execute Only Genuine Remaining Original Work")
        self.assertEqual(guarded["steps"][0]["type"], "break")
        self.assertEqual(guarded["steps"][1]["groups"][0]["flowName"], "local_review_implementation")
        original = flow("implement_current_plan")["steps"][0]["steps"][:7]
        extracted = copy.deepcopy(flow("local_review_implementation")["steps"])
        current_task = extracted[6]["steps"][0]["steps"]
        self.assertEqual(current_task.pop(2)["exitFlow"], True)
        proof = labeled(current_task, "Proof Loop")["steps"]
        for label in (
            "Reset coder before proof repair",
            "Load coder current task context before proof repair",
            "Deep repair automated-proof test blocker",
        ):
            step = labeled(proof, label)
            self.assertEqual(step["agentType"], "coding_agent_heavy")
            self.assertEqual(step["identifier"], "coder")
            step["agentType"] = "coding_agent"
        self.assertEqual(extracted, original)
        self.assertNotIn('"two_phase_review_cycle"', json.dumps(extracted))
        remote = next(s for s in parent["steps"] if s.get("label", "").startswith("23b-pr."))
        self.assertEqual(remote["groups"][0]["flowName"], "pr_current_plan")

    def test_two_phases_proof_and_checkpoint_boundaries(self):
        steps = flow("local_review_current_plan")["steps"]
        labels = [s["label"] for s in steps]
        for before, after in (
            ("Run Initial Whole Story Proof", "Checkpoint Initial Proof Candidate Locally"),
            ("Whole Story Proof After Standard Local Review", "Checkpoint Post-Standard Proof Candidate Locally"),
            ("Close Out Local Review", "Checkpoint Local Closeout Changes Locally"),
        ):
            self.assertEqual(labels.index(after), labels.index(before) + 1)
            checkpoint = labeled(steps, after)
            self.assertEqual(checkpoint["identifier"], "local_candidate_checkpoint")
            self.assertIn("do not push", json.dumps(checkpoint).lower())
        phases = [s for s in steps if s.get("maxIterations") == 20]
        self.assertEqual(len(phases), 2)
        for phase in phases:
            self.assertEqual(phase["steps"][0]["groups"][0]["flowName"], "local_review_batch")
            self.assertEqual(phase["steps"][1]["type"], "break")
            proof = labeled(steps, "Whole Story Proof After " + phase["label"])
            self.assertEqual(proof["steps"][1]["groups"][0]["flowName"], "local_whole_story_proof")
            self.assertTrue(proof["steps"][0]["continueOnFailure"])

    def test_batch_plans_before_one_persistent_repair_conversation(self):
        batch = flow("local_review_batch")["steps"]
        repair = labeled(batch, "Plan And Repair Accepted Local Findings")
        gate, plan, reset, loop, _ = repair["steps"]
        self.assertEqual(gate["breakOn"], "yes")
        self.assertEqual(plan["markdownFile"], "local_review_plan_batch.md")
        self.assertEqual(reset["agentType"], "coding_agent_heavy")
        fixer, stop = loop["steps"]
        self.assertEqual(fixer["identifier"], reset["identifier"])
        self.assertEqual(stop["identifier"], reset["identifier"])
        self.assertNotIn("maxIterations", loop)
        self.assertNotIn('"type": "reset"', json.dumps(loop))
        self.assertIn("local_review_record_batch.md", json.dumps(batch[-1]))

    def test_reviewer_groups_and_shared_batch_prefix(self):
        steps = flow("local_review_current_plan")["steps"]
        standard = labeled(steps, "Standard Local Review")["steps"][0]
        values = standard["groups"][0]["bindings"]["inputValues"]
        self.assertEqual(values["review_groups"][0]["flowNames"], ["codex_review", "open_code_review"])
        self.assertEqual(values["review_groups"][1]["flowName"], "cross_repository_review")
        self.assertNotIn("copilot_reviews_enabled", values)
        deep = labeled(steps, "Deep Local Review")["steps"][0]
        values = deep["groups"][0]["bindings"]["inputValues"]
        self.assertEqual(values["review_groups"][0]["flowNames"], ["review_artifacts_main"])
        self.assertIs(values["copilot_reviews_enabled"], False)
        shared = flow("review_batch")["steps"]
        local = flow("local_review_batch")["steps"]
        index = next(i for i, s in enumerate(shared) if s.get("label") == "Optional Review Repair")
        self.assertEqual(local[:index], shared[:index])


if __name__ == "__main__":
    unittest.main()
