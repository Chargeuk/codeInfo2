# Story 0000049 – Respect Plan Testing Exclusions Without Skipping Reviews

## Description

Plans can explicitly exclude agent-run testing for a task or story. The implementation workflow must honor that narrow restriction without turning it into a reason to skip implementation review, independent review, review repair, task generation, or closeout. When there is no explicit exclusion, normal testing expectations remain in force, including cases where the plan says tests do not yet exist.

This story updates the CodeInfo2 workflow and its corresponding Kadshow implementation. The review process must continue after task completion, and an assigned review plan/task is authoritative for review scope even if the persisted current-task pointer still names an earlier task. Product testing and review-protocol work (review calls, findings, artifact bookkeeping, and settlement) are distinct activities.

Kadshow Tasks 5 and 6 exclude CodeInfo2 implementation. They remain the separate Kadshow work items; this plan tracks the CodeInfo2 implementation and its cross-workflow propagation.

## Acceptance Criteria

- A flow obtains the selected task's complete Testing section and applicable approved story testing restrictions through the existing `plan_sections.py` structured extraction path. Python extracts context; the agent interprets explicit no-testing language semantically and decides whether agent testing is excluded.
- Only an explicit testing exclusion authorizes skipping agent-run product tests. Absence of an exclusion, including “no tests exist,” preserves normal testing. Missing/empty Testing or “no tests exist” is not an exclusion. First recover and interpret permission from current authoritative task and story plan evidence. If required testing authority remains genuinely conflicting or unreadable, do not perform potentially excluded proof; leave it unchecked, keep the task `__in_progress__`, and record a parser-visible `**BLOCKER**` with the affected item, evidence/conflict, and exact clarification needed through the existing caller/planner route. Continue safe independent source, audit, and review work; do not claim the item excluded or passed.
- Exclusion applies only to agent-run product testing for the stated task/story scope. It does not skip a child task, implementation or review audits, independent review calls, review repairs, review settlement, task generation, or closeout. Reviews happen after task completion; their assigned review plan/task overrides a stale current-task pointer.
- Review protocol operations and artifact bookkeeping are not product testing. Required review calls, reviewer independence, original task IDs/history/mappings, and exact remote review triggers remain intact.
- Explicit no-agent-testing guidance is plain prose in each applicable Testing section. No test checkbox or fabricated pass is added. Human acceptance remains external and pending.
- Do not claim provider-side enforcement without evidence. Preserve the exact remote trigger contract.
- No engine/schema/dependency/framework changes, new handoffs, or standalone classifier are introduced. Reuse existing extraction and workflow structures; add a small helper only if implementation verifies a specific gap that cannot be handled by existing code.
- Deployment/catalog reload for the human-controlled installed harness is a prerequisite: the installed harness is under `/app`, distinct from this checkout, and has no hot reload or autorestart.

## Out Of Scope

- Skipping, reducing, or combining mandatory reviews or reviewer independence.
- General testing-policy changes beyond explicit plan-authorized exclusions.
- Changes to flow engine schemas, dependencies, frameworks, persistent handoffs, or provider enforcement absent concrete evidence and approval.
- Performing human acceptance or deploying/reloading the installed harness as part of implementation.

## Questions

None.

# Tasks

### Task 1. Honor explicit testing exclusions in implementation flows

- Repository Name: Current Repository
- Task Dependencies: None
- Task Status: `__done__`
- Git Commits: Pending main-owned commit

#### Overview

Update the existing activity guides used by `implement_current_plan`, `pr_current_plan`, `implement_next_plan`, `implement_next_plan_github_review`, `task_and_implement_plan`, `improve_task_implement_plan`, and `improve_task_implement_current_plan` so they retrieve complete task Testing sections and applicable approved story restrictions through existing `plan_sections.py` extraction. Do not add flow-level testing conditionals or inline repair branches. The agent makes the semantic decision; do not encode keyword policy in Python. An explicit exclusion omits only the covered activity, while missing/empty testing content preserves otherwise-required proof.

#### Task Exit Criteria

- Testing decisions use the complete applicable plan restrictions and task Testing text, with semantic agent interpretation and no Python keyword classifier.
- Explicit exclusions do not suppress safe implementation audits or required review calls.

#### Subtasks

- [x] Trace testing eligibility and test execution decision points in the seven named flows and identify the minimal shared prompt changes.
- [x] Update applicable activity guides to retrieve complete task Testing and applicable approved story restrictions through existing `plan_sections.py` extraction.
- [x] Apply explicit-exclusion-only semantic interpretation, including ambiguous/unreadable limitations, without skipping safe review work.
- [x] Keep every new subtask in this plan pending until implemented.

#### Testing

No agent testing, test authoring/repair, testing-infrastructure work, builds, typechecks, lint, formatting, static/syntax/contract/JSON validation, browser/runtime/live-flow execution, or test execution is authorized for this change. Human testing remains external and pending. Source/documentation/Git review and all required review cycles remain permitted. This restriction applies only to this implementation assignment and does not establish a blanket policy for future stories. No agent-run tests or validation were performed for this implementation assignment; this is not a pass claim.

#### Implementation Notes

- Task 1 source-review repair: corrected only the older GitHub inline product-proof condition context, which still used the generic implementation-task pointer. Before either branch it now pins review assignment/disposition plan, pass, finding and repository, requests the explicit plan task index/story restrictions, and retrieves full Testing/story text with --plan/--task-number for every actual finding owner, including completed tasks. Story-only scope requires evidence that no owning task applies; missing ownership never permits a stale/default task or implicit-plan substitution. The original inline repair/outcome labels, branches, trigger and existing blocked/not_run reporting remain intact, with safe non-testing work retained and no stale fixed result reused on uncertainty. No tests, syntax/static/contract checks, builds, validation, runtime/flows, engine changes, commits, push or Jira actions were performed.


- Task 1 bookkeeping: source subtasks were checked only after the corresponding source trace or flow edits. No new subtasks or testing checkboxes were introduced, and no test/validation result is claimed. Tasks 2–4 guide work was pending at this point; its completion is recorded in those tasks below. Its handoff should align mixed prompt defaults, uncertainty/completion semantics and manual-proof promotion with the flow guards, and account for this plan's parser-incompatible task/section heading format. The installed `/app` catalog has not been deployed or restarted.

- Task 1 semantic guards implemented for visual runtime preflight, automated proof, test-failure repair, testing-only continuation, and manual runtime/proof in all seven flows. Yes retains permitted required testing; no requires an explicit activity-scoped exclusion; absent/empty Testing or “no tests exist” is not an exclusion. Ambiguous permission uses existing failed-decision/incomplete reporting rather than either permission or a valid no-test pass. The original proof-loop exit now leaves excluded/unresolved dependent testing without implying success. Mixed preflight retains source refinement, and older GitHub inline review repair retains its native repair/result path with not_run proof; unresolved review context writes the existing blocked outcome instead of consuming stale success. Task selection, source-context loads, implementation/subtask continuations, audits, native local/PR review calls, settlement and closeout remain present. No testing, validation, runtime, or publication was performed.

- Task 1 extraction implemented in all seven flows: fresh `plan_sections.py --task current --section Testing` plus task context and named story restrictions, with path/number/title matching and bounded requests for additional authoritative headings. Review-owned inline proof uses explicit verified review plan/task arguments rather than a stale current task. Existing extraction interfaces suffice; no Python helper, classifier, schema, state, or dependency was added. This is source implementation, not executed validation.

- Initial plan setup status: implementation was pending at this point; subsequent source work is recorded below.
- Task 1 source trace: all seven named execution flows dispatch visual preflight, automated proof, proof repair, automated retry, and manual runtime/proof directly. Audits, task selection, context loads, implementation repairs, and native review calls must remain active. The older GitHub flow also embeds focused testing in its mixed minor-review repair prompt; the assigned-plan qualification for that repair and its outcome bookkeeping is recorded under Task 4. No checks were run. The explicit-plan helper query could not resolve this plan's noncanonical task headings, so only the bounded story contract and Task 1 section were read as fallback; no handoffs or other plans were used.
- 2026-11-03 final-scope correction: the seven flow JSON conditionals and inline repair branch added during earlier implementation were removed from the candidate by restoring those files to verified `main`; they are not part of this change. The activity guides now request complete task Testing and approved story-scope sections before potentially excluded proof, and leave ambiguous proof pending while safe review work continues. Earlier source notes remain historical evidence, not current flow changes.


### Task 2. Preserve scope and completion semantics in shared implementation and proof prompts

- Repository Name: Current Repository
- Task Dependencies: 1
- Task Status: `__done__`
- Git Commits: Pending main-owned commit

#### Overview

Update shared implementation, audit, blocker, and manual-testing prompts so exclusions are interpreted against the current activity and selected task/story scope. A clear exclusion prevents only covered agent-run product testing; ambiguity is reported as a limitation. Do not create loops or treat excluded proof as an implementation blocker that prevents safe reviews from proceeding.

#### Task Exit Criteria

- Applicable prompts preserve explicit exclusion scope for authoring, repair, execution, and related checks only as actually covered.
- Permitted source, implementation, visual, and review audits remain active, with no false pass or exclusion-only blocker.

#### Subtasks

- [x] Identify shared implementation, audit, blocker, and manual-proof prompts that instruct product testing or determine task completion.
- [x] State the scoped explicit-exclusion semantics and preserve review/audit work and honest limitation reporting.
- [x] Ensure no false clean result or completion claim is made when required context is ambiguous or unavailable.

#### Testing

No agent testing, test authoring/repair, testing-infrastructure work, builds, typechecks, lint, formatting, static/syntax/contract/JSON validation, browser/runtime/live-flow execution, or test execution is authorized for this change. Human testing remains external and pending. Source/documentation/Git review and all required review cycles remain permitted. This restriction applies only to this implementation assignment and does not establish a blanket policy for future stories. No agent-run tests or validation were performed for this implementation assignment; this is not a pass claim.

#### Implementation Notes

- Updated `codeinfo_markdown/implement_next_task_subtasks.md`, `run_automated_proof_and_fix_issues.md`, `audit_after_implementation.md`, and `audit_after_automated_proof.md` to interpret exclusions by task and activity while retaining permitted review, proof, and honest completion reporting.
- Updated `codeinfo_markdown/deep_test_failure_repair.md`, `research_implementation_blocker_repair.md`, `preflight_visual_diagnosis_current_task.md`, `manual_test_runtime_research.md`, and `manual_test_latest_completed_task.md` to keep excluded activities out of repair, preflight, runtime setup, and manual execution without suppressing safe source review.
- Updated `codeinfo_markdown/promote_story_manual_proof.md` to preserve external acceptance as pending and prevent promotion of nonexistent proof. No checks or runtime actions were run.
- Corrected the blocker-repair prompts to keep explicitly excluded proof and external human acceptance non-blocking while treating failed or unavailable permitted required proof as incomplete and routed through genuine blocker/repair handling.
- Updated `deep_implementation_blocker_repair.md` to require full assigned Testing/story context before proof or worker requests, scope shutdown/retry and verification to permitted activities, and keep causal source repair active. Updated `normalize_inconsistent_active_task.md` to preserve explicit exclusions as prose, reconcile only contradictory excluded checklists, and allow honest task completion after permitted work without synthetic proof tasks or passes.
- 2026-11-03 guide clarification: added bounded task/story extraction and ordinary partial-outcome handling for ambiguous testing permission in the visual preflight, automated-proof, runtime-research, latest-completed-task manual-proof, and deep-repair guides. `fix_next_minor_review_finding.md` retains its existing explicit task Testing/story extraction and scoped `not_run` handling; JSON validation remains permitted-only, and no workspace checks or deferred reviewer suggestions were restored. The six-line `server/src/flows/service.ts` correction remains: failed status is no longer converted to stopped from response content, while genuine error/stop handling and bounded retry behavior remain. No checks or runtime actions were performed.
- Task 2 permission clarification: updated automated-proof, deep-repair, and post-proof audit guidance plus the current ambiguity acceptance criterion so genuinely unresolved testing authority is recovered from plan evidence first, then recorded as a parser-visible blocker and routed through existing planner clarification; explicit exclusions remain non-blocking. No tests or validation were run.


### Task 3. Preserve review repair, settlement, and task-generation behavior

- Repository Name: Current Repository
- Task Dependencies: 1, 2
- Task Status: `__done__`
- Git Commits: Pending main-owned commit

#### Overview

Propagate scoped exclusions through review repair and settlement, retrospective task generation, `task_up2`, and shared final-task creation. A testing exclusion must not hide actionable review findings or stop reviews. Review-generated work retains normal permitted testing expectations, with excluded scope recorded as plain Testing prose.

#### Task Exit Criteria

- Required review calls, findings, source repairs, settlement, task generation, task history, and mappings remain active and attributable.
- A final testing/revalidation task is created or required only when permitted required proof remains; excluded or external human acceptance is never represented as agent proof or a synthetic task.

#### Subtasks

- [x] Trace and update review batch, two-phase, PR review, review repair, and settlement paths without removing required review calls or reviewer independence.
- [x] Preserve original task IDs, history, and mappings through finding disposition, repair, settlement, and reconciliation.
- [x] Update retrospective and task-generation prompts, including `task_up2` and shared final-task creation, to retain only valid scoped exclusions and otherwise preserve normal testing.
- [x] Ensure assigned review plan/task scope takes precedence over a stale current-task pointer after task completion.

#### Testing

No agent testing, test authoring/repair, testing-infrastructure work, builds, typechecks, lint, formatting, static/syntax/contract/JSON validation, browser/runtime/live-flow execution, or test execution is authorized for this change. Human testing remains external and pending. Source/documentation/Git review and all required review cycles remain permitted. This restriction applies only to this implementation assignment and does not establish a blanket policy for future stories. No product tests or validation were run for this assignment; no pass is claimed.

#### Implementation Notes

- Updated `codeinfo_markdown/implement_review_batch_direct_fixes.md`, `implement_review_batch_remaining_fixes.md`, `research_and_fix_repeated_review_findings.md`, `fix_next_minor_review_finding.md`, `record_review_batch_outcome.md`, `shared/completed-review-fix-task.md`, `settle_agent_native_review_pass.md`, `apply_agent_native_review_settlement.md`, and `audit_agent_native_review_settlement.md`. Repair workers receive affected-task Testing scope; authoring, execution, lint, and formatting exclusions remain activity-specific. Permitted required proof remains mandatory; excluded proof is not a pass or blocker. Failed or unavailable permitted proof remains incomplete, and a partial commit cannot establish acceptance. The inline-review result schema and finding repair outcomes remain intact.
- Updated retrospective guidance in `codeinfo_markdown/retrospective_story/tasking/03-final-validation.md`, `04-check.md`, and `05-repair.md`, plus `task_up/09-proof-and-testing.md` and `shared/final-task-creation.md`. Existing task identity/history requirements remain. Final validation is conditional on permitted required proof and is not synthesized for excluded proof. No checks were run.
- Follow-up repair clarified that unavailable or failed permitted proof remains incomplete; only explicit exclusions remove that activity from its gate. Partial commits cannot establish finding acceptance.
- 2026-11-03 settlement wording: final testing/revalidation tasks are required or ordered last only when permitted required proof remains for affected work. Mandatory review, audit, repair, and settlement remain required; excluded or external human acceptance does not create a synthetic agent-test task. No testing or validation was run.
- Follow-up bookkeeping correction: restored the review workspace input paragraph and result-artifact verification wording to their original instructions, removing only the added permission-gated bookkeeping requirements. No tests or flow execution were performed; prior notes remain historical.


### Task 4. Propagate reviewer inputs and closeout guidance

- Repository Name: Current Repository
- Task Dependencies: 1, 2, 3
- Task Status: `__done__`
- Git Commits: Pending main-owned commit

#### Overview

Preserve the exclusion and review distinction across native Codex, OpenCode, Copilot, multi-agent, cross-repository, and remote-PR reviewer inputs through final closeout. Keep the exact remote review trigger behavior. Do not claim provider enforcement without evidence.

#### Task Exit Criteria

- Applicable restrictions and affected task scopes are carried in supported reviewer inputs and PR requirements context.
- Review calls and closeout remain active, while excluded execution and external human acceptance are reported honestly.
- The installed `/app` catalog deployment/reload prerequisite is documented without claiming it occurred.
- Final-push lint, formatting, and related repair are scoped to the latest approved story and each affected task, including completed tasks; ordinary in-scope Git inspection, commit, and push remain available.

#### Subtasks

- [x] Trace reviewer-input and closeout paths for all listed providers and review modes.
- [x] Propagate scoped exclusion context in reviewer inputs, PR requirements, and final-push lint/format decisions while retaining independent required reviews and exact remote trigger behavior.
- [x] Keep human acceptance external and pending; avoid fabricated test results and unverified provider-enforcement claims.
- [x] Document the installed harness deployment/catalog reload prerequisite for human-controlled rollout.

#### Testing

No agent testing, test authoring/repair, testing-infrastructure work, builds, typechecks, lint, formatting, static/syntax/contract/JSON validation, browser/runtime/live-flow execution, or test execution is authorized for this change. Human testing remains external and pending. Source/documentation/Git review and all required review cycles remain permitted. This restriction applies only to this implementation assignment and does not establish a blanket policy for future stories. No provider enforcement, installed-harness rollout, or human acceptance is claimed.

#### Implementation Notes

- Updated `codeinfo_markdown/review_job_workspace_contract.md`, `run_codex_review_workspace.md`, `run_open_code_review_workspace.md`, `copilot_review_instructions.md`, `run_deep_review_visual_workspace.md`, and `prepare_pr_agent_review.md` to pass assigned restrictions and scope into reviewer inputs and preserve supported remote triggers. Provider enforcement remains unverified.
- Updated closeout/manual-proof guidance in `codeinfo_markdown/promote_story_manual_proof.md`. The installed harness is under `/app`, is separate from this checkout, and requires human-controlled deployment/catalog loading; it was not updated or restarted. No live workflow, test, or human acceptance was performed.

## Verified Source Map

- Flow entry points: `flows/implement_current_plan.json`, `flows/pr_current_plan.json`, `flows/implement_next_plan.json`, `flows/implement_next_plan_github_review.json`, `flows/task_and_implement_plan.json`, `flows/improve_task_implement_plan.json`, and `flows/improve_task_implement_current_plan.json` contain automated/manual proof stages and testing eligibility decisions.
- Structured plan context: `scripts/plan_sections.py` supplies bounded plan/task sections; `scripts/manual_testing_guidance_status.py` is an existing focused story-level guidance helper. Semantic policy belongs in agent instructions, not a Python keyword classifier.
- Review paths: `flows/review_batch.json`, `flows/two_phase_review_cycle.json`, and `flows/pr_review_cycle.json` compose review, repair, and settlement stages; review and task-up prompts live under `codeinfo_markdown/`, including `codeinfo_markdown/task_up/`.
- Separate Kadshow tasks 5 and 6 exclude CodeInfo2 implementation; this plan owns the CodeInfo2 changes and must not absorb those Kadshow task records.
- Installed-harness deployment/catalog reload is human-controlled under `/app`, a distinct checkout without hot reload/autorestart; this is a later rollout prerequisite, not an implementation-time service restart.

## Human Acceptance

External human acceptance is pending. Do not add agent-run product-test checkboxes to represent it or claim it passed.
- 2026-11-03 finalization guidance: `final_push.md` now extracts approved story scope and each affected task Testing section by explicit plan/task identity, including completed tasks, before lint/format. It runs only permitted lint/format/related repair and defers only ambiguous or excluded activities while retaining independent Git finalization. No lint, format, or other validation was run.

