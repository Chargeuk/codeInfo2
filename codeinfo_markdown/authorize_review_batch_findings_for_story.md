# Positively authorize the current review batch findings for this story

This is an autonomous flow execution step, not a planning interview. Do not ask the user questions, offer choices, wait for confirmation, or finish with a question. Continue with best effort and preserve uncertainty honestly.

Read `codeInfoStatus/flow-state/current-plan.json` only to identify the story and exact canonical `plan_path`, preserving its padded story identifier. Resolve the current immutable batch through `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`. Copy batch identity, repository identity, and reviewed commits directly from the authoritative handoff, `batch-launch.md`, and assigned inputs.

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` for the exact selected plan. Read `$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md`. Read the audited reconciliation, the current actionable reconciliation, and `reconciliation/scope-filtered-findings.md`; reopen immutable job evidence only when needed.

This is a separate positive authorization gate after negative filtering. Technical validity and positive story authorization are different decisions. A finding may be factually correct, caused by story-added code, and worth separate follow-up while still being unauthorized for implementation in this story.

For every finding that remains actionable after negative filtering, independently establish all of the following in ordinary evidence-based prose:

1. Identify the exact statement in the current top-level story Description or Overview, Acceptance Criteria, or Out Of Scope contract that authorizes changing implementation behavior; identify a later user-approved expansion only after it has been incorporated into those top-level sections; or identify comparison-base repository evidence proving restoration of behavior that predated the story.
2. Explain the direct causal chain from the finding to violation of that exact requirement or preserved behavior.
3. Apply the counterfactual test: explain why leaving the finding unresolved would keep the story incomplete or leave a story-caused regression in place.
4. Explain why the smallest authorized repair restores the cited behavior without inventing a new product or runtime policy.

Historical `Code Review Findings`, `Accepted`, `Ignored for This Story`, tasks, subtasks, implementation notes, testing instructions, reconciliation, disposition, scope, repair, outcome, commit, test, and agent-authored records are evidence and decision history only. They are never authorization sources, even when an older record accepted, implemented, or proved the identical finding. Never interpret a historical `Accepted` section as an explicit story decision, a user-approved expansion, or proof of preserved behavior. Historical records may help locate evidence or prevent duplication, but each current authorization decision must stand without them.

The following are never sufficient positive authorization by themselves:

- the finding is technically plausible or severe;
- the story added or edited the affected code;
- the same file, module, subsystem, or general feature is in scope;
- the finding can be associated with a vague paraphrase of story wording;
- the change is defensive, safer, cleaner, more robust, or useful general hardening; or
- an implementation agent could choose a reasonable policy without asking the user.

For preserved-behavior restoration, cite comparison-base code, tests, documentation, or another repository-owned source that establishes the behavior before the current story changed it. A prior review decision or an implementation commit cannot establish preserved behavior by itself.

Treat a newly introduced or tightened cap, quota, threshold, timeout, retry count, default, fallback, validation failure, error path, concurrency limit, skipping rule, truncation rule, or similar policy as unauthorized unless the exact policy is explicitly requested by the current top-level story contract or it is the minimum policy-free restoration of comparison-base behavior. Do not select arbitrary values or rejection behavior on the user's behalf.

When authorization is ambiguous or cannot be demonstrated from authoritative evidence, prefer non-authorization over scope expansion. Remove that finding only from the derived actionable reconciliation, preserve its complete meaning and technical evidence, and record whether it may deserve separately approved follow-up work. Never delete or rewrite job `input/`, `work/`, `output/`, or `verification/` evidence.

Always write `reconciliation/scope-authorized-findings.md`, even when every survivor is authorized or the gate is partial or unavailable. Keep it self-describing rather than conforming to a rigid schema. Account for every negative-gate survivor, the exact allowed authority source used for each positive decision, the counterfactual result, any policy choice implicated by the remedy, every historical record considered only as evidence, every unauthorized removal, and all uncertainty. Confirm that immutable job evidence was unchanged.

If the exact batch or bounded story scope cannot be established safely, leave the actionable reconciliation unchanged and write an honest partial or unavailable authorization artifact. Missing authorization must never be described as approval; the later independent audit and disposition will recover the decision and keep unproven work non-actionable while the flow continues.

Before returning, reopen the reconciliation, `scope-filtered-findings.md`, and `scope-authorized-findings.md`; confirm every negative-gate survivor is accounted for and no unauthorized item remains actionable under another heading or duplicate description. Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" --batch-root <batch-directory>` and repair only factual derived-workspace issues this step owns. Return a concise execution summary and artifact paths, not questions.
