#!/usr/bin/env python3
"""Local review flow structure; these tests do not execute agent decisions."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def flow(name):
    return json.loads((ROOT / "flows" / f"{name}.json").read_text())


def labeled(steps, label):
    return next(step for step in steps if step.get("label") == label)


class LocalReviewFlowTests(unittest.TestCase):
    def test_parent_receipt_and_removed_implementation_flow(self):
        parent = flow("codeinfo2_implement_story")
        local = next(s for s in parent["steps"] if s.get("label", "").startswith("23a."))
        self.assertEqual(local["failureMode"], "best_effort")
        self.assertEqual(local["groups"][0]["id"], "codeinfo2_implement_current_plan")
        self.assertEqual(local["groups"][0]["flowName"], "local_review_current_plan")
        remote = next(s for s in parent["steps"] if s.get("label", "").startswith("23b-pr."))
        self.assertEqual(remote["groups"][0]["flowName"], "pr_current_plan")
        self.assertFalse((ROOT / "flows" / "local_review_implementation.json").exists())
        for path in (ROOT / "flows").glob("*.json"):
            self.assertNotIn('"local_review_implementation"', path.read_text(), str(path))

    def test_two_phases_proof_and_checkpoint_boundaries(self):
        steps = flow("local_review_current_plan")["steps"]
        labels = [s["label"] for s in steps]
        self.assertEqual(labels, [
            "Run Initial Whole Story Proof",
            "Checkpoint Initial Proof Candidate Locally",
            "Initialize Local Review Pass",
            "Standard Local Review",
            "Whole Story Proof After Standard Local Review",
            "Checkpoint Post-Standard Proof Candidate Locally",
            "Deep Local Review",
            "Whole Story Proof After Deep Local Review",
            "Close Out Local Review",
        ])
        self.assertEqual(steps[0]["groups"][0]["flowName"], "local_whole_story_proof")
        for label in ("Checkpoint Initial Proof Candidate Locally", "Checkpoint Post-Standard Proof Candidate Locally"):
            checkpoint = labeled(steps, label)
            self.assertEqual(checkpoint["identifier"], "local_candidate_checkpoint")
            self.assertIn("do not push", json.dumps(checkpoint).lower())
        phases = [s for s in steps if s.get("maxIterations") == 20]
        self.assertEqual(len(phases), 2)
        for phase in phases:
            self.assertEqual(phase["steps"][0]["groups"][0]["flowName"], "local_review_batch")
            self.assertEqual(phase["steps"][1]["type"], "break")
            self.assertTrue(phase["steps"][1]["breakOnFailure"])
            proof = labeled(steps, "Whole Story Proof After " + phase["label"])
            self.assertEqual(proof["maxIterations"], 1)
            self.assertEqual(proof["steps"][1]["groups"][0]["flowName"], "local_whole_story_proof")
            gate = proof["steps"][0]
            self.assertEqual(gate["breakOn"], "yes")
            self.assertNotIn("breakOnFailure", gate)
            self.assertTrue(gate["continueOnFailure"])
            self.assertTrue(gate["continueOnInvalidResponse"])

    def test_batch_repairs_disposition_without_a_planning_step(self):
        batch = flow("local_review_batch")["steps"]
        repair = labeled(batch, "Repair Accepted Local Findings")
        self.assertEqual(repair["maxIterations"], 1)
        gate, reset, loop = repair["steps"]
        self.assertEqual(gate["type"], "break")
        self.assertEqual(gate["breakOn"], "yes")
        self.assertEqual(reset["type"], "reset")
        self.assertEqual(reset["agentType"], "coding_agent_heavy")
        self.assertEqual(loop["type"], "startLoop")
        self.assertNotIn("maxIterations", loop)
        fixer, stop = loop["steps"]
        self.assertEqual([fixer["type"], stop["type"]], ["llm", "break"])
        self.assertEqual(fixer["identifier"], reset["identifier"])
        self.assertEqual(stop["identifier"], reset["identifier"])
        self.assertNotIn('"type": "reset"', json.dumps(loop))
        self.assertNotIn("local_review_plan_batch.md", json.dumps(batch))
        outcome, = batch[batch.index(repair) + 1:]
        self.assertEqual(outcome["label"], "Record Local Batch Outcome")
        self.assertIn("local_review_record_batch.md", json.dumps(outcome))
        instructions = (ROOT / "codeinfo_markdown" / "local_review_record_batch.md").read_text()
        self.assertIn("only that verified subset", instructions)
        self.assertIn("If zero fixes are verified, create no plan task", instructions)

    def test_proof_uses_existing_validation_roles(self):
        proof = flow("local_whole_story_proof")["steps"]
        automated = labeled(proof, "Reset automated proof worker")
        manual = labeled(proof, "Reset manual proof worker")
        self.assertEqual(automated["agentType"], "automated_testing_agent")
        self.assertEqual(manual["agentType"], "manual_testing_agent")
        outcome = labeled(proof, "Report whole-story proof outcome")
        self.assertEqual(outcome["identifier"], automated["identifier"])

    def test_proof_routes_candidate_repairs_without_start_handoff(self):
        proof = flow("local_whole_story_proof")["steps"]
        self.assertEqual([step["type"] for step in proof], [
            "reset", "reset", "reset", "startLoop", "llm",
        ])
        self.assertNotIn("Whole-story proof start #", json.dumps(proof))
        candidate = labeled(proof, "Whole-story candidate proof")
        automated, acceptance, manual, finish = candidate["steps"]
        self.assertEqual(automated["steps"][0]["label"], "Execute applicable whole-story automated proof")
        self.assertEqual(acceptance["type"], "startLoop")
        self.assertEqual(acceptance["maxIterations"], 1)
        gate, worker = acceptance["steps"]
        self.assertEqual(gate["type"], "break")
        self.assertEqual(gate["identifier"], "whole_story_proof_controller")
        self.assertEqual(gate["breakOn"], "no")
        self.assertTrue(gate["breakOnFailure"])
        self.assertIn("once per proof invocation", gate["question"])
        self.assertEqual(worker["type"], "llm")
        self.assertEqual(worker["label"], "Run whole-story acceptance proof or invalidated scenarios")
        self.assertEqual(worker["agentType"], "manual_testing_agent")
        self.assertEqual(worker["identifier"], "whole_story_manual_tester")
        self.assertEqual(proof[proof.index(candidate) + 1]["label"], "Report whole-story proof outcome")
        self.assertIn("fixer results", manual["steps"][2]["question"])
        self.assertIn("affected manual scenarios to retest", manual["steps"][2]["question"])
        self.assertEqual(manual["steps"][3]["label"], "Retest affected acceptance scenarios")
        self.assertIn("automated check or manual scenario", finish["question"])
        self.assertIn("including after a manual repair", finish["question"])
        self.assertIn("owned working-tree changes", finish["question"])

    def test_round_and_proof_decisions_use_attributable_evidence(self):
        steps = flow("local_review_current_plan")["steps"]
        for phase, prefix in (("Standard", "local_standard"), ("Deep", "local_deep")):
            with self.subTest(phase=phase):
                loop = labeled(steps, phase + " Local Review")
                self.assertEqual(loop["maxIterations"], 20)
                round_question = loop["steps"][1]["question"]
                for evidence in (
                    "subflowWaveProgress.jobs", prefix + "_batch", "flags.flowChild",
                    "flags.flow.values.review_batch_targets", "terminalOutcome",
                    "does not return flags", "exact current-batch", "new committed target HEAD",
                    "all accepted current-round fixes are verified", "zero accepted survivors",
                ):
                    self.assertIn(evidence, round_question)
                proof = labeled(steps, "Whole Story Proof After " + phase + " Local Review")
                question = proof["steps"][0]["question"]
                for evidence in (
                    "separate review coverage", "earlier fixes", "resumed work",
                    "staged and unstaged", "untracked source/tests", "failed launch",
                    "positively unchanged", "genuinely unknown", "proof must remain pending",
                    "fix was reverted", "round history",
                ):
                    self.assertIn(evidence, question)

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
