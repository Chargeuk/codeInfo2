# Goal

Repair the canonical plan so the stored review outcome is definitely encoded into executable plan state before downstream review-task enhancement continues.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` before making any decision about review-created tasks.
- Read and follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`, especially its review task-up ownership and duplicate-prevention rules.
- Read and follow `$CODEINFO_ROOT/codeinfo_markdown/record_review_issue_decisions_in_plan.md` for the current-pass `## Code Review Findings` structure, identity, and idempotency contract. The earlier pre-fix recorder owns that decision block; this task-up step must reuse it rather than create a second findings summary.
- Derive the story number from the stored `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
- Use the stored review handoff plus the artifacts it references as the source of review evidence, and use `review-disposition-state.json` as the preferred routing source when it exists and is valid.
- Do not fail this step because a previous disposition pass underperformed. Repair the plan instead.
- Do not rediscover the story, review pass, or review comments independently.
- Interpret the review handoff semantically instead of as a brittle exact schema. If optional or newer comparison metadata is missing or shaped differently, use the referenced artifacts, current-plan handoff, and direct git state to infer the safest usable meaning.
- Do not repeatedly rerun or ask to regenerate review artifacts solely to satisfy handoff formatting. If the review outcome cannot be determined even after safe inference, repair the plan with a visible incomplete-review follow-up instead of claiming no findings.

</critical_rules>

<scope_rules>

1. Validate that the stored handoff plan exists and that the current repository branch story number still matches the selected plan filename.
2. Validate that every additional repository in scope still exists, is readable, and remains on a branch whose story number matches the selected plan filename.
3. Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk when it exists and is valid, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`. Treat it as the preferred task-up routing state for resolved minor findings, unresolved task-required findings, and incomplete-review blockers.
4. Read the stored review handoff and identify the story, plan path, review pass, evidence artifact, findings artifact, and repository scope either from named handoff fields or by safe inference from the handoff path, canonical `plan_path`, artifact filenames, artifact content, and current git state.
5. For every repository entry, combine the handoff, referenced artifacts, disposition state when present, and current git state to confirm enough context to understand the repository scope, current branch, current local `HEAD`, and the local-HEAD-vs-resolved-base comparison used by the review.
6. Prefer stored comparison metadata when present, including `resolved_base_branch`, `resolved_base_source`, `logical_base_branch`, `remote_name`, `remote_fetch_status`, `local_fallback_reason`, `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, and `comparison_rule`. If some of these fields are missing, infer only the pieces needed to encode the review outcome honestly, record the inference in the plan text when it affects confidence, and ignore unknown extra fields.
7. When present, treat `remote_fetch_error` and `remote_fetch_exit_code` as optional fetch-failure diagnostics. Do not copy raw `remote_fetch_error` text into plan output unless it is already sanitized or can be safely categorized without credentials, userinfo, access tokens, or query strings.
8. Read the findings artifact identified from the handoff or safe inference directly from disk, for example with `cat <findings_file>`. Read the challenge artifact from disk too when present or safely inferable, for example with `cat <challenge_file>`.
9. Rerun `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` immediately before deciding whether repair is needed.

</scope_rules>

<review_disposition_state_rules>

- When `review-disposition-state.json` exists and is valid, use its `unresolved_task_required_findings` and `incomplete_review_blockers` arrays as the only findings that may become numbered review-fix tasks in this step.
- When one of those routed findings carries a constraint in its `reason`, treat that routed `reason` as the authoritative downstream wording for the constraint. Do not reopen the findings artifact to reinterpret the same external-review nuance unless state fallback is already required because the disposition state is missing, unreadable, malformed, or for a different story/plan.
- Every review-created task must still keep exactly one `Repository Name` implementation owner.
- A review-created task's single `Repository Name` controls where code and owner-scoped subtasks belong, but does not by itself limit `Testing` or optional `Manual Testing Guidance` when compatibility proof needs another repository.
- Treat this step as the serious-issue task-up path. If it adds numbered review-fix tasks, the review loop should stop and return to the main implementation loop rather than continuing minor reruns in the same review pass.
- Treat `resolved_minor_findings` as already handled inline. Do not create numbered tasks for those finding IDs, even if the original findings artifact still lists them as `must_fix` or `should_fix`.
- Treat `unresolved_minor_batchable_findings` as owned by the minor-fix path, not this task-up path. Do not create numbered tasks for them unless they have been reclassified into `unresolved_task_required_findings`.
- Do not create a numbered review-fix task solely because a finding required a small local automated test update or one or two new focused tests in the owning repository.
- If this step creates or updates the cycle's fresh final revalidation task, it becomes the one final review task for the whole current review cycle. Record that ownership in `review-disposition-state.json` so the inline-minor final-task path does not create a second final task later.
- Preserve `review_cycle_id` from `review-disposition-state.json`, keep its `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>` format unchanged, and make the fresh final revalidation task record that same cycle id.
- If the disposition state says `needs_task_up_path` is false, make no plan changes in this step and report that no unresolved task-required findings remain for task-up.
- If the disposition state is missing, unreadable, malformed, or for a different story/plan, fall back to the existing findings-artifact behavior and record that fallback in the output.
- If state counts disagree with state arrays, trust the arrays and record the mismatch before deciding task-up work.
- If a finding appears in both `resolved_minor_findings` and `unresolved_task_required_findings`, treat the unresolved task-required bucket as authoritative only when the state includes an explicit reclassification reason; otherwise stop and say the review disposition state must be repaired.

</review_disposition_state_rules>

<story_behavior_lock_rules>

- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md"`.
- Do not convert a review finding into a numbered task when the proposed fix would change established user-facing behavior that is not explicitly approved by the story or explicitly approved later by the user, unless the finding is describing a preserved-behavior regression introduced by the current story.
- If the current story introduced unapproved drift away from previously approved or preserved behavior, treat the restoration of that behavior as actionable current-story work rather than as out-of-scope redesign.
- When an actionable finding's routed reason says the external reviewer's proposed remedy is out-of-scope but the underlying issue remains current-story actionable, preserve that constraint in the task wording instead of treating the finding as rejected. The task must address the underlying issue while preserving approved story behavior and must not restate the out-of-scope remedy as the implementation contract.
- Do not create a review-created task merely because a behavior change would make the product contract cleaner, more consistent, easier to prove, easier to automate, or easier to implement.
- Do not create a review-created task merely to fix a pre-existing bug, awkward workflow, inconsistency, limitation, or surprise unless the story explicitly requires that fix.
- If honest proof cannot proceed without a separate behavior decision, preserve current behavior and treat the issue as out-of-scope for the current story instead of silently tasking the behavior change into the current story, unless the finding is restoring previously approved or preserved behavior that the current story itself drifted away from.
- Do not create a numbered task or blocker for that out-of-scope behavior change in this step. When this step owns or repairs review-state semantics, keep the issue in the non-actionable review bucket with a concise scope reason instead of turning it into current-story task-up work.
- Review-task-up may decompose approved scope, but it must not widen approved scope.

</story_behavior_lock_rules>

<decision_rules>

1. Determine the task-up outcome primarily from `review-disposition-state.json` when it is present and valid; otherwise determine the review outcome from the findings artifact. Use any `finding_counts` values in the handoff only as helpful summary hints; if the counts disagree with the chosen source of truth, trust the chosen source and record the mismatch in the repair notes.
2. If the chosen source of truth communicates unresolved task-required findings or incomplete-review blockers, the plan must visibly encode that unresolved review outcome on disk before this step finishes.
3. Task-up is for findings that exceed the minor-path guardrails, such as contract/schema/lifecycle changes, broad refactors, unclear implementation ownership, ambiguity, destructive public authority boundary changes, multi-surface error-taxonomy reinterpretation, or fixes that balloon during execution. It is not for otherwise bounded findings that only needed a small local test update or that merely restore an already intended same-repository contract.
4. Do not create a numbered review-fix task solely because the affected code lives in a queue, concurrency, lifecycle, or shared-caller helper when the reviewed finding is still one bounded same-repository repair with an already-settled intended contract.
5. Do not task up a finding solely because it restores validation ordering, returned-result parity, producer-consumer alignment, or dead-branch clarity inside one bounded same-repository seam.
6. A task-required findings-present plan is considered correctly encoded only when all of the following are true:
   - the plan contains exactly one structured `Code Review Findings` section for the current `review_pass_id`, recorded before implementation began and containing the required review identity, comparison context, accepted findings, and ignored-for-this-story findings;
   - the plan contains at least one newly added review-created `Task Status: __to_do__` task after that section;
   - the plan contains a fresh final re-test or revalidation task after those new review-fix tasks;
   - each newly added review-created repair task names exactly one repository and follows the existing task structure;
   - each new review-created task records durable finding coverage in the plan itself, such as an `Addresses Findings` section or equivalent inline wording;
   - the fresh final revalidation task explicitly states that it revalidates the whole story plus the current review-created findings block for this `review_pass_id`, also covers any `resolved_minor_findings` already recorded for this same active review cycle, starts with only each worked-on repository's supported lint and formatting item types with unsupported commands omitted, and ensures each such repository has its discovered supported full build when available, applicable startup, every relevant repository-supported full automated suite including supported end-to-end suites, matching shutdown, supported lint, and supported formatting, in that order, with unsupported or unavailable items omitted;
   - no newly added substantive review-created task hides runnable build, test, compose, browser, or wrapper commands inside `Subtasks`, unless that substantive task is specifically creating, repairing, or proving a harness or wrapper; the dedicated final task's per-repository lint and formatting checklist is the explicit exception;
   - the new review-created task block is not unnecessarily fragmented across the same repository plus a shared repair seam, root cause, contract or lifecycle surface, prerequisite chain, or coherent proof story;
   - no review-created task was grouped only because findings share a repository or likely implementation owner;
   - no new review-created task was improperly absorbed into an older pre-existing story task;
   - tiny unrelated cleanup-only findings are not left as a trail of micro-tasks when they could be absorbed into a nearby substantive task or grouped into one cleanup task honestly.
7. If the chosen source of truth communicates no unresolved task-required findings and no incomplete-review blockers, make no plan change in this task-up step.
8. If the findings artifact is missing, unreadable, or ambiguous even after safe inference, the plan must contain a bounded incomplete-review follow-up task instead of claiming the review is clean.
9. If the current plan already satisfies the correct postcondition for the chosen source of truth, make no plan change.
10. If the plan does not satisfy the correct postcondition, repair it in this step instead of reporting the gap and stopping.

</decision_rules>

<repair_rules>

1. When findings are present and the plan is missing review-fix tasks, locate the existing structured `Code Review Findings` block for the exact current `review_pass_id` and add the tasks in the repository's existing review-task format. Do not append another findings section.
2. Add one or more review-fix tasks that respond to the unresolved task-required findings from the chosen source of truth, with explicit repository ownership, compact subtasks, proof homes, and wrapper-first testing.
3. When a routed finding reason says the external reviewer's suggested remedy is out-of-scope, make the new review-created task explicitly preserve that constraint. Task wording must target the underlying defect and must not silently convert the external reviewer's broader behavior change into current-story scope.
4. Add a fresh dedicated final re-test or revalidation task after the new review-fix tasks, so the story cannot close without re-running proof. Give it one administrative `Repository Name`, name every worked-on repository and affected component from the whole story plus the current review cycle, add the shared contract's repair-scope note first in both `Subtasks` and `Testing`, generate only each repository's independently discovered supported lint and formatting items in `Subtasks`, and, for each worked-on repository, list its discovered supported full build when available, applicable startup, every relevant repository-supported full automated suite including supported end-to-end suites, matching shutdown, supported lint, and supported formatting, in that order, with unsupported or unavailable items omitted from `Testing` and no targeted filters or invented commands.
5. When `resolved_minor_findings` already exist in the active review disposition state, make that same fresh final revalidation task explicitly cover those inline-resolved minor fixes too instead of leaving them to a second final revalidation task later.
6. If the repaired or newly added substantive review-created tasks still mix execution commands into `Subtasks`, rewrite them so runnable wrapper or test commands live in `Testing` while `Subtasks` keep implementation and proof-authoring work. Preserve the dedicated final task's intentional exception: its only permitted initial subtask types are supported lint and formatting per worked-on repository, while builds, runtime lifecycle, full suites, shutdown, and repeated supported lint and formatting commands remain in `Testing`.
7. Do not reject or rewrite a review-created task solely because its `Testing` references another repository for compatibility proof. Only implementation ownership and owner-scoped subtasks must stay single-repository.
8. Treat routine `Implementation Notes` refreshes as plan-maintenance that happens after the related subtask or testing step completes, not as standalone or future-dependent subtask items.
9. In substantive review-created tasks, allow execution commands to remain in `Subtasks` only when the task is specifically creating, repairing, or proving a harness or wrapper itself. Do not apply this restriction to the dedicated final task's required per-repository lint and formatting checklist.
10. If adjacent review-created tasks inside the newly appended review-created block share repository ownership plus the same repair seam, root cause, contract or lifecycle surface, prerequisite chain, or coherent proof story, merge them into one substantive review-fix task unless a split is required for clarity, sequencing, ownership, or proof honesty.
11. Do not preserve separate review-created tasks solely because the grouped fix needs multiple proof files, wrappers, assertions, or documentation-visible proof surfaces when the implementation repair is one coherent seam.
12. Do not merge findings solely because they share a repository or likely implementation owner.
13. Tiny unrelated low-risk cleanup-only tasks may be absorbed only into another newly created substantive review-fix task inside that same appended block when that keeps the plan clearer and does not blur the proof story.
14. If several tiny unrelated cleanup-only findings have no natural parent task inside that same block, collapse them into one small cleanup task inside that block instead of preserving one task per trivial fix.
15. Never let merge or cleanup grouping create a junk-drawer task. If a merged review-created task becomes vague, bloated, or loses a clear seam, ownership boundary, stopping rule, or proof story, split it back apart before finishing this step.
16. Before keeping a merged or grouped review-created task, verify that it has one clear stopping point, one coherent proof story, and no finding that was grouped only because it shares a repository or likely implementer.
17. If uncertainty remains about whether a merged or collapsed task is still honest and concrete, prefer a slightly more explicit split over an unclear combined task.
18. Do not repair over-fragmentation by rewriting older pre-existing story tasks. Keep the findings response self-contained in the new review-created block.
19. Ensure each review-created task and the fresh final revalidation task preserve durable finding-to-task coverage in the plan itself.
20. Keep the repair concrete and executable by a junior developer. If a finding is still too unclear for a direct code-change task, create a bounded diagnostic task with an explicit stopping rule rather than leaving the finding un-tasked.
21. If the stored review outcome cannot be interpreted safely enough to choose the findings-present or incomplete-review path, add a bounded incomplete-review follow-up task that names the missing context, the artifacts inspected, and the minimum evidence needed to complete the review.
22. After repairing the plan, rerun `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` and verify that the required postcondition now exists before finishing this step.
23. If an interrupted or older execution reached task-up without a current-pass findings block, repair the missing prerequisite by applying `record_review_issue_decisions_in_plan.md` first, then reload the bounded `review-tasking` packet and continue task-up. In this late-recovery case, include a `resolved_minor_findings` entry as Accepted only when its stable ID exists in the exact validated current-pass findings artifact, and preserve explicitly rejected or non-adopted current-pass artifact candidates under Ignored. This recovery may create the one structured current-pass block; it must never recreate the retired terse summary format.
24. When review-fix tasks must form a contiguous end-of-file block, move the existing current-pass findings block as one unchanged unit immediately before those tasks. Do not rewrite its accepted or ignored decisions from post-implementation state, and do not move or alter historical review-pass blocks.

</repair_rules>

<state_update_rules>

- When this step adds or updates numbered review-created tasks plus the fresh final revalidation task for unresolved task-required findings, also update `review-disposition-state.json`.
- Set `final_revalidation_owned_by_task_up_path` to true.
- Set `task_up_owned_final_revalidation_task_title` to the exact title of the fresh final revalidation task that now owns the whole current review cycle.
- Set `needs_final_minor_fix_revalidation_task` to false because the cycle's final revalidation is already owned by the serious task-up path.
- Set `minor_fix_revalidation_cycle_closed` to false because that shared final revalidation task still needs to be completed later.
- Set `review_created_tasks_added_or_updated` to true.
- Set `safe_to_exit_review_loop_without_tasking` to false.
- Preserve `review_cycle_id` exactly as-is for this active review loop, keeping the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.
- If this step makes no plan change because no task-up work remains, do not invent or clear final-task ownership state here.

</state_update_rules>

<behavior_rules>

- Prefer deterministic checks based on the stored review handoff, the findings file, and the on-disk plan state.
- Do not treat artifact capture, support-file wording cleanup, or unrelated plan polish as sufficient when the stored review handoff still says actionable findings are present.
- Do not broaden scope beyond encoding the stored review outcome honestly into the canonical plan.
- If a previous disposition pass added only partial review text without executable tasks, normalize the exact current-pass block to the structured decision contract once, then add the missing tasks after it without creating another findings section.

</behavior_rules>

<output_contract>

- Leave the canonical plan in a state that matches the stored review outcome:
  - unresolved task-required findings present => review-fix tasks plus final revalidation task;
  - if review-fix tasks were added for serious issues => the review loop should exit and let the main implementation loop work those tasks before any later review pass;
  - valid disposition state says no task-up work remains => no plan mutation in this step;
  - outcome unclear after safe inference => bounded incomplete-review follow-up task.
- When this step creates the fresh final revalidation task for serious review work, update `review-disposition-state.json` so downstream steps know that this task already owns final revalidation for the whole current review cycle.
- Make no plan changes only when the current plan already satisfies the correct postcondition.

</output_contract>

<verification_loop>

- Confirm you re-read `current-plan.json` first.
- Confirm you read `review-disposition-state.json` when it existed, and either used it as the task-up source of truth or recorded why fallback to findings artifacts was required.
- Confirm you loaded a fresh bounded review-tasking packet before deciding whether repair was needed.
- Confirm you read the stored review handoff and findings artifact for the same story.
- Confirm resolved minor findings from disposition state were not converted into numbered tasks.
- Confirm unresolved minor-batchable findings were left for the minor-fix path rather than converted into numbered tasks.
- Confirm the stored review handoff and referenced artifacts were interpreted semantically, including local-HEAD-vs-resolved-base comparison context and any remote/fallback uncertainty that affects confidence.
- Confirm that an unresolved task-required findings-present handoff or disposition state did not leave the plan without new review-created `__to_do__` tasks and a final revalidation task.
- Confirm that those new review-created tasks still carry durable finding coverage in the plan itself.
- Confirm the current `review_pass_id` appears in exactly one structured `## Code Review Findings` block and that task-up did not append the retired terse summary format.
- Confirm that the fresh final revalidation task explicitly covers the current review-created findings block for this `review_pass_id`, also covers any inline-resolved minor fixes from the same review cycle, ensures each worked-on repository has its discovered supported full build when available, applicable startup, every relevant repository-supported full automated suite including supported end-to-end suites, matching shutdown, supported lint, and supported formatting, in that order, with unsupported or unavailable items omitted, and was not forced into bogus single-repository proof scope.
- Confirm that every review-created task kept one `Repository Name` implementation owner while still allowing cross-repository `Testing` when the finding needs compatibility proof.
- Confirm that newly added substantive review-created tasks do not hide runnable wrapper or test commands in `Subtasks`, except for harness or wrapper tasks, and confirm the dedicated final task retains its explicit per-repository lint and formatting exception.
- Confirm that newly added review-created tasks do not encode routine `Implementation Notes` refreshes as standalone or future-dependent subtasks.
- Confirm that no obvious same-seam or same-root-cause cluster of adjacent micro-tasks remains in the new review-created block.
- Confirm that no review-created tasks remain split only because their shared repair uses multiple proof files or assertions.
- Confirm that no review-created task was grouped only because findings share a repository or likely implementation owner.
- Confirm that no work was improperly absorbed into older pre-existing story tasks.
- Confirm no review-created task changes established user-facing behavior unless that behavior change is explicitly approved by the story or explicitly approved later by the user, or the task is restoring previously approved or preserved behavior that the current story itself regressed.
- Confirm no pre-existing bug or product inconsistency was silently absorbed into current-story scope merely because it was discovered during review.
- Confirm that no needless trail of tiny cleanup-only tasks remains when they could have been absorbed or grouped honestly.
- Confirm that no merged review-created task has become an unfocused catch-all or vague cleanup bucket.
- Confirm that no collapsed cleanup task hides materially different ownership or proof.
- Confirm the repaired plan now matches the stored review outcome on disk.
- Confirm that `review-disposition-state.json` now records the fresh final revalidation task as the one owner of final revalidation for this review cycle when serious task-up work was added.
- Confirm that the fresh final revalidation task and `review-disposition-state.json` still agree on the same `review_cycle_id`.

</verification_loop>
