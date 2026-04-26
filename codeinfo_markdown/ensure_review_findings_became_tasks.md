# Goal

Repair the canonical plan so the stored review outcome is definitely encoded into executable plan state before downstream review-task enhancement continues.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact canonical plan from disk before making any decision.
- Derive the story number from the stored `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json`.
- Use the stored review handoff plus the artifacts it references as the source of review evidence, and use `review-disposition-state.json` as the preferred routing source when it exists and is valid.
- Do not fail this step because a previous disposition pass underperformed. Repair the plan instead.
- Do not rediscover the story, review pass, or review comments independently.
- Interpret the review handoff semantically instead of as a brittle exact schema. If optional or newer comparison metadata is missing or shaped differently, use the referenced artifacts, current-plan handoff, and direct git state to infer the safest usable meaning.
- Do not repeatedly rerun or ask to regenerate review artifacts solely to satisfy handoff formatting. If the review outcome cannot be determined even after safe inference, repair the plan with a visible incomplete-review follow-up instead of claiming no findings.

</critical_rules>

<scope_rules>

1. Validate that the stored handoff plan exists and that the current repository branch story number still matches the selected plan filename.
2. Validate that every additional repository in scope still exists, is readable, and remains on a branch whose story number matches the selected plan filename.
3. Read `codeInfoStatus/flow-state/review-disposition-state.json` when it exists and is valid. Treat it as the preferred task-up routing state for resolved minor findings, unresolved task-required findings, and incomplete-review blockers.
4. Read the stored review handoff and identify the story, plan path, review pass, evidence artifact, findings artifact, and repository scope either from named handoff fields or by safe inference from the handoff path, canonical `plan_path`, artifact filenames, artifact content, and current git state.
5. For every repository entry, combine the handoff, referenced artifacts, disposition state when present, and current git state to confirm enough context to understand the repository scope, current branch, current local `HEAD`, and the local-HEAD-vs-resolved-base comparison used by the review.
6. Prefer stored comparison metadata when present, including `resolved_base_branch`, `resolved_base_source`, `logical_base_branch`, `remote_name`, `remote_fetch_status`, `local_fallback_reason`, `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, and `comparison_rule`. If some of these fields are missing, infer only the pieces needed to encode the review outcome honestly, record the inference in the plan text when it affects confidence, and ignore unknown extra fields.
7. When present, treat `remote_fetch_error` and `remote_fetch_exit_code` as optional fetch-failure diagnostics. Do not copy raw `remote_fetch_error` text into plan output unless it is already sanitized or can be safely categorized without credentials, userinfo, access tokens, or query strings.
8. Read the findings artifact identified from the handoff or safe inference. Read the challenge artifact when present or safely inferable.
9. Re-open the canonical plan from disk immediately before deciding whether repair is needed.

</scope_rules>

<review_disposition_state_rules>

- When `review-disposition-state.json` exists and is valid, use its `unresolved_task_required_findings` and `incomplete_review_blockers` arrays as the only findings that may become numbered review-fix tasks in this step.
- Every review-created task must still keep exactly one `Repository Name` implementation owner.
- A review-created task's single `Repository Name` controls where code and owner-scoped subtasks belong, but does not by itself limit `Testing` or optional `Manual Testing Guidance` when compatibility proof needs another repository.
- Treat `resolved_minor_findings` as already handled inline. Do not create numbered tasks for those finding IDs, even if the original findings artifact still lists them as `should_fix`.
- Treat `unresolved_minor_batchable_findings` as owned by the minor-fix path, not this task-up path. Do not create numbered tasks for them unless they have been reclassified into `unresolved_task_required_findings`.
- If the disposition state says `needs_task_up_path` is false, make no plan changes in this step and report that no unresolved task-required findings remain for task-up.
- If the disposition state is missing, unreadable, malformed, or for a different story/plan, fall back to the existing findings-artifact behavior and record that fallback in the output.
- If state counts disagree with state arrays, trust the arrays and record the mismatch before deciding task-up work.
- If a finding appears in both `resolved_minor_findings` and `unresolved_task_required_findings`, treat the unresolved task-required bucket as authoritative only when the state includes an explicit reclassification reason; otherwise stop and say the review disposition state must be repaired.

</review_disposition_state_rules>

<decision_rules>

1. Determine the task-up outcome primarily from `review-disposition-state.json` when it is present and valid; otherwise determine the review outcome from the findings artifact. Use any `finding_counts` values in the handoff only as helpful summary hints; if the counts disagree with the chosen source of truth, trust the chosen source and record the mismatch in the repair notes.
2. If the chosen source of truth communicates unresolved task-required findings or incomplete-review blockers, the plan must visibly encode that unresolved review outcome on disk before this step finishes.
3. A task-required findings-present plan is considered correctly encoded only when all of the following are true:
   - the plan contains a new `Code Review Findings` section for the current `review_pass_id`;
   - the plan contains at least one newly added review-created `Task Status: __to_do__` task after that section;
   - the plan contains a fresh final re-test or revalidation task after those new review-fix tasks;
   - each newly added review-created repair task names exactly one repository and follows the existing task structure;
   - each new review-created task records durable finding coverage in the plan itself, such as an `Addresses Findings` section or equivalent inline wording;
   - the fresh final revalidation task explicitly states that it revalidates the current review-created findings block for this `review_pass_id`, owns full relevant regression proof for every affected repository, and may remain cross-repository when that is the honest story-wide validation scope;
   - no newly added review-created task hides runnable build, test, compose, browser, or wrapper commands inside `Subtasks`, unless that task is specifically creating, repairing, or proving a harness or wrapper;
   - the new review-created task block is not unnecessarily fragmented across the same repository plus a shared repair seam, root cause, contract or lifecycle surface, prerequisite chain, or coherent proof story;
   - no review-created task was grouped only because findings share a repository or likely implementation owner;
   - no new review-created task was improperly absorbed into an older pre-existing story task;
   - tiny unrelated cleanup-only findings are not left as a trail of micro-tasks when they could be absorbed into a nearby substantive task or grouped into one cleanup task honestly.
4. If the chosen source of truth communicates no unresolved task-required findings, no unresolved minor-batchable findings, no incomplete-review blockers, and no final minor-fix revalidation need, make no plan change in this task-up step.
5. If the chosen source of truth is the findings artifact and it communicates no actionable findings after a complete review, the plan must instead contain the required no-findings close-out for the current `review_pass_id`, including the stored or safely inferred local-HEAD-vs-resolved-base comparison details for every repository in scope.
6. If the findings artifact is missing, unreadable, or ambiguous even after safe inference, the plan must contain a bounded incomplete-review follow-up task instead of a no-findings close-out.
7. If the current plan already satisfies the correct postcondition for the chosen source of truth, make no plan change.
8. If the plan does not satisfy the correct postcondition, repair it in this step instead of reporting the gap and stopping.

</decision_rules>

<repair_rules>

1. When findings are present and the plan is missing review-fix tasks, add them directly to the end of the canonical plan in the repository's existing review-task format.
2. Add one or more review-fix tasks that respond to the unresolved task-required findings from the chosen source of truth, with explicit repository ownership, compact subtasks, proof homes, and wrapper-first testing.
3. Add a fresh final re-test or revalidation task after the new review-fix tasks so the story cannot close without re-running proof. This final task may remain one task with one implementation owner while still validating multiple repositories. It must name the affected repositories and the repository-supported broad build, test, browser, Compose, Docker, smoke, or wrapper proof it owns for the current review-created findings block, or state why a category is not applicable.
4. If the repaired or newly added review-created tasks still mix execution commands into `Subtasks`, rewrite them so runnable wrapper or test commands live in `Testing` while `Subtasks` keep implementation work, proof-authoring work, retained proof-home updates, screenshots, and logs.
4a. Do not reject or rewrite a review-created task solely because its `Testing` references another repository for compatibility proof. Only implementation ownership and owner-scoped subtasks must stay single-repository.
5. Treat routine `Implementation Notes` refreshes as plan-maintenance that happens after the related subtask or testing step completes, not as standalone or future-dependent subtask items.
6. Allow execution commands to remain in `Subtasks` only when the task is specifically creating, repairing, or proving a harness or wrapper itself.
7. If adjacent review-created tasks inside the newly appended review-created block share repository ownership plus the same repair seam, root cause, contract or lifecycle surface, prerequisite chain, or coherent proof story, merge them into one substantive review-fix task unless a split is required for clarity, sequencing, ownership, or proof honesty.
8. Do not preserve separate review-created tasks solely because the grouped fix needs multiple proof files, wrappers, assertions, or documentation-visible proof surfaces when the implementation repair is one coherent seam.
9. Do not merge findings solely because they share a repository or likely implementation owner.
10. Tiny unrelated low-risk cleanup-only tasks may be absorbed only into another newly created substantive review-fix task inside that same appended block when that keeps the plan clearer and does not blur the proof story.
11. If several tiny unrelated cleanup-only findings have no natural parent task inside that same block, collapse them into one small cleanup task inside that block instead of preserving one task per trivial fix.
12. Never let merge or cleanup grouping create a junk-drawer task. If a merged review-created task becomes vague, bloated, or loses a clear seam, ownership boundary, stopping rule, or proof story, split it back apart before finishing this step.
13. Before keeping a merged or grouped review-created task, verify that it has one clear stopping point, one coherent proof story, and no finding that was grouped only because it shares a repository or likely implementer.
14. If uncertainty remains about whether a merged or collapsed task is still honest and concrete, prefer a slightly more explicit split over an unclear combined task.
15. Do not repair over-fragmentation by rewriting older pre-existing story tasks. Keep the findings response self-contained in the new review-created block.
16. Ensure each review-created task and the fresh final revalidation task preserve durable finding-to-task coverage in the plan itself.
17. Keep the repair concrete and executable by a junior developer. If a finding is still too unclear for a direct code-change task, create a bounded diagnostic task with an explicit stopping rule rather than leaving the finding un-tasked.
18. When no findings are present and the required close-out section is missing, append the required `Post-Implementation Code Review` section for the current `review_pass_id`.
19. If a no-findings close-out section exists but lacks stored or safely inferred comparison metadata, repair it instead of treating it as complete.
20. Any repaired no-findings close-out must state, for every repository in scope:
    - that the review compared local `HEAD` against `comparison_base_ref`;
    - the stored or inferred `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, and `comparison_rule`;
    - whether `resolved_base_source` was `remote`, `local_fallback`, or unavailable from the artifacts;
    - `remote_name` and `remote_fetch_status` when available;
    - the fallback reason when `resolved_base_source` is `local_fallback` and that reason is available;
    - that `origin/<current-story-branch>` was not used as the review head.
21. If the stored review outcome cannot be interpreted safely enough to choose the findings-present or no-findings path, add a bounded incomplete-review follow-up task that names the missing context, the artifacts inspected, and the minimum evidence needed to complete the review.
22. After repairing the plan, re-open it from disk and verify that the required postcondition now exists before finishing this step.

</repair_rules>

<behavior_rules>

- Prefer deterministic checks based on the stored review handoff, the findings file, and the on-disk plan state.
- Do not treat artifact capture, support-file wording cleanup, or unrelated plan polish as sufficient when the stored review handoff still says actionable findings are present.
- Do not broaden scope beyond encoding the stored review outcome honestly into the canonical plan.
- If a previous disposition pass added only partial review text without executable tasks, keep that text only when it remains accurate and then add the missing tasks after it.

</behavior_rules>

<output_contract>

- Leave the canonical plan in a state that matches the stored review outcome:
  - unresolved task-required findings present => review-fix tasks plus final revalidation task;
  - valid disposition state says no task-up work remains => no plan mutation in this step;
  - no findings => required post-review close-out section;
  - outcome unclear after safe inference => bounded incomplete-review follow-up task.
- Make no plan changes only when the current plan already satisfies the correct postcondition.

</output_contract>

<verification_loop>

- Confirm you re-read `current-plan.json` first.
- Confirm you read `review-disposition-state.json` when it existed, and either used it as the task-up source of truth or recorded why fallback to findings artifacts was required.
- Confirm you re-opened the exact canonical plan from disk before deciding whether repair was needed.
- Confirm you read the stored review handoff and findings artifact for the same story.
- Confirm resolved minor findings from disposition state were not converted into numbered tasks.
- Confirm unresolved minor-batchable findings were left for the minor-fix path rather than converted into numbered tasks.
- Confirm the stored review handoff and referenced artifacts were interpreted semantically, including local-HEAD-vs-resolved-base comparison context and any remote/fallback uncertainty that affects confidence.
- Confirm that an unresolved task-required findings-present handoff or disposition state did not leave the plan without new review-created `__to_do__` tasks and a final revalidation task.
- Confirm that those new review-created tasks still carry durable finding coverage in the plan itself.
- Confirm that the fresh final revalidation task explicitly covers the current review-created findings block for this `review_pass_id`, owns full relevant regression proof for the affected repositories, and was not forced into bogus single-repository ownership.
- Confirm that every review-created task kept one `Repository Name` implementation owner while still allowing cross-repository `Testing` when the finding needs compatibility proof.
- Confirm that newly added review-created tasks do not hide runnable wrapper or test commands in `Subtasks`, except for harness or wrapper tasks.
- Confirm that newly added review-created tasks do not encode routine `Implementation Notes` refreshes as standalone or future-dependent subtasks.
- Confirm that no obvious same-seam or same-root-cause cluster of adjacent micro-tasks remains in the new review-created block.
- Confirm that no review-created tasks remain split only because their shared repair uses multiple proof files or assertions.
- Confirm that no review-created task was grouped only because findings share a repository or likely implementation owner.
- Confirm that no work was improperly absorbed into older pre-existing story tasks.
- Confirm that no needless trail of tiny cleanup-only tasks remains when they could have been absorbed or grouped honestly.
- Confirm that no merged review-created task has become an unfocused catch-all or vague cleanup bucket.
- Confirm that no collapsed cleanup task hides materially different ownership or proof.
- Confirm that a no-findings handoff did not leave the plan without the required close-out section.
- Confirm that any repaired no-findings close-out preserves the stored or safely inferred `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, `comparison_rule`, `remote_name`, `remote_fetch_status`, and any local fallback reason for every repository in scope.
- Confirm the repaired plan now matches the stored review outcome on disk.

</verification_loop>
