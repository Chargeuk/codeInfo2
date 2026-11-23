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
        local = next(
            s for s in parent["steps"]
            if any(g.get("flowName") == "local_review_current_plan" for g in s.get("groups", []))
        )
        self.assertEqual(local["failureMode"], "best_effort")
        self.assertEqual(local["groups"][0]["id"], "codeinfo2_implement_current_plan")
        self.assertEqual(local["groups"][0]["flowName"], "local_review_current_plan")
        remote = next(
            s for s in parent["steps"]
            if any(g.get("flowName") == "pr_review_current_plan" for g in s.get("groups", []))
        )
        self.assertEqual(remote["groups"][0]["flowName"], "pr_review_current_plan")
        self.assertFalse((ROOT / "flows" / "local_review_implementation.json").exists())
        for path in (ROOT / "flows").glob("*.json"):
            self.assertNotIn('"local_review_implementation"', path.read_text(), str(path))

    def test_pr_review_uses_shared_batch_without_standalone_proof(self):
        steps = flow("pr_review_current_plan")["steps"]
        old = flow("pr_review_cycle")["steps"]
        self.assertEqual(steps[:3], old[:3])
        self.assertEqual([step["type"] for step in steps], [
            "initializeReviewCycle", "llm", "llm", "startLoop", "llm",
        ])
        review, closeout = steps[3:]
        self.assertEqual(review["maxIterations"], 20)
        wave, reset, reply, decision = review["steps"]
        group = wave["groups"][0]
        self.assertEqual(group["flowName"], "local_review_batch")
        values = group["bindings"]["inputValues"]
        self.assertIs(values["parallel_automated_validation"], True)
        self.assertIs(values["copilot_reviews_enabled"], False)
        self.assertEqual(values["review_groups"][0]["flowNames"], ["pr_agent_review"])
        self.assertEqual([reset, reply], old[3]["steps"][1:3])
        for evidence in ("pr_review_batch:local_review_batch", "pr_target_reviews:",
                         "exact current-batch", "exact pushed HEAD", "source or test Git commit"):
            self.assertIn(evidence, decision["question"])
        text = json.dumps(closeout)
        for evidence in ("local_review_closeout.md", "record_review_cycle_outcome.py",
                         "exact pushed PR-reviewed heads", "completed-fix tasks", "unreviewed"):
            self.assertIn(evidence, text)
        self.assertNotIn("local_whole_story_proof", json.dumps(steps))
        for forbidden in ("select_current_task.md", "implement_next_task_subtasks.md",
                          "deep_implementation_blocker_repair.md", "research_blocker_solution_and_prove_it.md",
                          "settle_agent_native_review_pass.md", "apply_agent_native_review_settlement.md",
                          "audit_agent_native_review_settlement.md"):
            self.assertNotIn(forbidden, json.dumps(steps))
        self.assertEqual(flow("pr_current_plan")["steps"][0]["label"], "Story Execution And Review Loop")

    def test_local_phases_and_initial_publication(self):
        steps = flow("local_review_current_plan")["steps"]
        self.assertEqual([step["type"] for step in steps], [
            "subflowWave", "llm", "reingest", "initializeReviewCycle",
            "startLoop", "llm", "startLoop", "llm",
        ])
        self.assertEqual(steps[0]["groups"][0]["flowName"], "local_whole_story_proof")
        self.assertEqual(steps[1]["markdownFile"], "commit_attempt_push.md")
        self.assertEqual(steps[2]["target"], "working")
        phases = [s for s in steps if s.get("maxIterations") == 20]
        self.assertEqual(len(phases), 2)
        for phase in phases:
            group = phase["steps"][0]["groups"][0]
            self.assertEqual(group["flowName"], "local_review_batch")
            self.assertIs(group["bindings"]["inputValues"]["parallel_automated_validation"], True)
            self.assertEqual(phase["steps"][1]["type"], "break")
            self.assertTrue(phase["steps"][1]["breakOnFailure"])
        self.assertEqual(json.dumps(steps).count('"flowName": "local_whole_story_proof"'), 1)

    def test_batch_parallel_branches_and_combined_repair(self):
        batch = flow("local_review_batch")["steps"]
        self.assertEqual([step["type"] for step in batch], [
            "prepareReviewTargets", "prepareCopilotReviewGroups", "subflowWave", "startLoop", "llm",
        ])
        snapshot, groups, wave, repair, outcome = batch
        self.assertEqual(wave["failureMode"], "best_effort")
        branches = {group["flowName"]: group for group in wave["groups"]}
        self.assertEqual(set(branches), {"review_filter_branch", "review_automated_branch"})
        for branch in branches.values():
            self.assertEqual(branch["kind"], "singleton")
            self.assertEqual(branch["bindings"]["input"]["review_batch_targets"], snapshot["outputKey"])
        self.assertEqual(branches["review_filter_branch"]["bindings"]["input"]["effective_review_groups"],
                         groups["outputKey"])
        review = flow("review_filter_branch")["steps"]
        shared = flow("review_batch")["steps"]
        index = next(i for i, step in enumerate(shared) if step.get("label") == "Optional Review Repair")
        self.assertEqual(review, shared[2:index])
        self.assertEqual(review[0]["reviewWorkspace"]["snapshotFrom"], snapshot["outputKey"])
        automated, = flow("review_automated_branch")["steps"]
        self.assertEqual(automated["agentType"], "automated_testing_agent")
        self.assertTrue(automated["continueOnFailure"])
        automated_text = (ROOT / "codeinfo_markdown" / automated["markdownFile"]).read_text()
        for phrase in ("parallel_automated_validation", "exactly boolean `true`", "pinned", "failure"):
            self.assertIn(phrase, automated_text)
        self.assertEqual(repair["maxIterations"], 1)
        gate, reset, loop = repair["steps"]
        self.assertEqual(gate["type"], "break")
        self.assertEqual(gate["breakOn"], "yes")
        for phrase in ("accepted actionable review survivors", "actionable attributable automated failures",
                       "partial or unavailable coverage"):
            self.assertIn(phrase, gate["question"])
        self.assertEqual(reset["agentType"], "research_agent")
        coordinator, publish, reingest, stop = loop["steps"]
        self.assertEqual([s["type"] for s in loop["steps"]], ["llm", "llm", "reingest", "break"])
        self.assertEqual(coordinator["identifier"], reset["identifier"])
        self.assertEqual(stop["identifier"], reset["identifier"])
        repair_text = (ROOT / "codeinfo_markdown" / coordinator["markdownFile"]).read_text()
        for phrase in ("automated", "coding_agent", "automated_testing_agent", "focused"):
            self.assertIn(phrase, repair_text)
        self.assertEqual(publish["markdownFile"], "review_batch_commit_attempt_push.md")
        self.assertTrue(publish["continueOnFailure"])
        publication_text = (ROOT / "codeinfo_markdown" / publish["markdownFile"]).read_text()
        for phrase in ("commit_attempt_push.md", "current iteration repair evidence",
                       "secondary assigned targets", "each distinct repository",
                       "continue attempting the other repositories"):
            self.assertIn(phrase, publication_text)
        self.assertIn("actually changed in the current iteration", repair_text)
        self.assertEqual(reingest["target"], "plan_scope")
        self.assertTrue(stop["breakOnFailure"])
        outcome_text = (ROOT / "codeinfo_markdown" / outcome["markdownFile"]).read_text()
        self.assertIn("exactly one completed fix task", outcome_text)
        self.assertIn("No task for a batch without a fix", outcome_text)

    def test_proof_single_task_loop_and_conversation_ownership(self):
        proof = flow("local_whole_story_proof")["steps"]
        self.assertEqual([step["type"] for step in proof], [
            "reset", "llm", "reset", "startLoop", "llm",
        ])
        prepare_reset, prepare, manual_reset, loop, outcome = proof
        self.assertEqual(prepare["identifier"], prepare_reset["identifier"])
        self.assertEqual(prepare["agentType"], "research_agent")
        for phrase in ("all existing tasks are complete", "fresh final validation task once",
                       "any task is open", "keep the existing plan"):
            self.assertIn(phrase, json.dumps(prepare))
        self.assertEqual(manual_reset["agentType"], "manual_testing_agent")
        self.assertNotIn("maxIterations", loop)
        top, reset, work, reconcile, publish, reingest, halt, manual_if, publish_after_manual, reingest_after_manual = loop["steps"]
        self.assertEqual([step["type"] for step in loop["steps"]],
                         ["break", "reset", "llm", "llm", "llm", "reingest", "break", "if", "llm", "reingest"])
        self.assertEqual(reset["agentType"], "research_agent")
        self.assertEqual(reset["identifier"], work["identifier"])
        self.assertEqual(work["identifier"], reconcile["identifier"])
        self.assertEqual(outcome["identifier"], work["identifier"])
        self.assertIn("originally bound task", json.dumps(reconcile))
        self.assertIn("Do not select or start the next task", json.dumps(reconcile))
        work_text = json.dumps(work)
        for phrase in ("select_current_task.py", "at most one task", "subtasks first",
                       "targeted retests", "required full suite", "no safe progress",
                       "hung subprocesses", "owned by this work"):
            self.assertIn(phrase, work_text)
        for name in ("coding_agent_heavy", "automated_testing_agent", "manual_testing_agent"):
            self.assertNotIn(name, work_text)
        for step in (publish, publish_after_manual):
            self.assertEqual(step["markdownFile"], "commit_attempt_push.md")
            self.assertTrue(step["continueOnFailure"])
        for step in (reingest, reingest_after_manual):
            self.assertEqual(step["target"], "working")
        self.assertEqual(halt["breakOn"], "yes")
        self.assertTrue(halt["haltFlow"])
        self.assertIn("task remains incomplete", halt["question"])
        self.assertIn("no-safe-progress", halt["question"])
        self.assertNotIn("breakOnFailure", halt)
        self.assertNotIn("continueOnInvalidResponse", halt)

    def test_proof_completion_and_manual_transition(self):
        loop = labeled(flow("local_whole_story_proof")["steps"], "Whole-story task loop")
        top, _, _, _, _, _, _, manual_if, _, _ = loop["steps"]
        self.assertEqual(top["breakOn"], "yes")
        self.assertEqual(top["agentType"], "loop_control_agent")
        self.assertEqual(top["question"], manual_if["condition"])
        for decision in (top, manual_if):
            text = decision.get("question", decision.get("condition"))
            for phrase in ("plan_status.py", "story_complete", "exactly true", "exactly false",
                           "failed command", "fail this decision as unresolved"):
                self.assertIn(phrase, text)
            self.assertNotIn("decisionScript", decision)
            self.assertNotIn("breakOnFailure", decision)
            self.assertNotIn("continueOnFailure", decision)
        self.assertNotIn("else", manual_if)
        manual, = manual_if["then"]
        self.assertEqual(manual["agentType"], "manual_testing_agent")
        text = json.dumps(manual)
        for phrase in ("final task guidance", "same final task as __in_progress__",
                       "uncheck every Testing checkbox", "preserving notes",
                       "regression-test subtasks", "do not edit code",
                       "clean manual pass leave tasks complete",
                       "authorized exclusions and human-only scenarios separately",
                       "unavailable or inconclusive observations accurately",
                       "report the precise limitation and remaining obligations honestly",
                       "do not count missing proof as a pass"):
            self.assertIn(phrase, text)
        self.assertNotIn('"startLoop"', json.dumps(loop["steps"]))
        for step in (flow("local_whole_story_proof")["steps"][1], top,
                     *loop["steps"][2:4], loop["steps"][6], manual_if, manual,
                     flow("local_whole_story_proof")["steps"][-1]):
            self.assertIn("$CODEINFO_ROOT/codeinfo_markdown/local_review_whole_story_proof.md",
                          json.dumps(step))

    def test_round_decisions_use_attributable_evidence(self):
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
                    "actual successful applicable automated validation", "never retry an unchanged failure",
                ):
                    self.assertIn(evidence, round_question)

    def test_reviewer_groups(self):
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


if __name__ == "__main__":
    unittest.main()
