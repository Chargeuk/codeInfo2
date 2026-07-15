# Goal

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/review-wave-consumer-contract.md` first and preserve the owning target for every promoted finding.

Give every current-story actionable review finding one honest opportunity for inline resolution before task-up.

This step runs after story-scope filtering and immediately before the review issue decisions are recorded in the plan; the Minor Review Fix Path follows that decision-recording step. It promotes actionable findings that have not yet received an inline attempt in the active review cycle into the existing minor-fix queue. It does not edit code, create tasks, or change which findings are in scope.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Use only the stored `plan_path`, `additional_repositories`, and review disposition state as the active scope.
- Do not read the findings artifact or re-adjudicate story scope. `filter_review_findings_to_story_scope.md` already established the actionable set for this pass.
- Do not promote any entry from `rejected_or_non_actionable_findings`, `incomplete_review_blockers`, `operationally_blocked_minor_findings`, or `resolved_minor_findings`.
- Do not create new findings, tasks, implementation scope, product decisions, or repository edits.
- Do not commit or push.

</critical_rules>

<promotion_rules>

1. Preserve every existing entry in `unresolved_minor_batchable_findings`.
2. Inspect every entry in `unresolved_task_required_findings`.
3. Move each current-story actionable entry that has not already received an inline attempt in this active review cycle into `unresolved_minor_batchable_findings`.
4. Preserve the finding ID, severity, repository, and summary exactly.
5. Preserve the original routing reason and add concise wording that:
   - its initial classifier disposition was task-required;
   - it was promoted so the coding agent must make one honest inline resolution attempt before task-up;
   - the original task-required reason remains a constraint, not permission to broaden scope.
6. Do not promote a durable follow-up entry whose reason or same-cycle state clearly records that:
   - an inline attempt already occurred and ended in `reclassify_task_required` or `skipped` escalation;
   - outside an active two-phase cycle, the issue remained unresolved after the one allowed same-cycle review rerun;
   - or the entry otherwise already represents the result of an inline attempt in this active review cycle.
7. Remove every successfully promoted entry from `unresolved_task_required_findings` so each finding remains in exactly one actionable queue.
8. Deduplicate by stable finding ID. If the same ID already exists in the minor queue, keep one minor entry containing the strongest preserved routing constraints and remove the duplicate task-required entry.
9. Preserve task-required entries that are not eligible for promotion under rule 6.

</promotion_rules>

<state_coherence_rules>

After promotion, recompute all counts and derived routing fields from the arrays:

- `counts`
- `has_unresolved_task_required_findings`
- `has_unresolved_minor_batchable_findings`
- `only_minor_batchable_findings`
- `needs_minor_fix_path`
- `needs_task_up_path`
- `safe_to_exit_review_loop_without_tasking`

Apply the existing state meanings:

- `has_unresolved_task_required_findings` is true when `unresolved_task_required_findings` or `incomplete_review_blockers` is non-empty.
- `has_unresolved_minor_batchable_findings` is true when `unresolved_minor_batchable_findings` is non-empty.
- `only_minor_batchable_findings` is true only when minor findings remain and neither task-required findings nor incomplete-review blockers remain.
- `needs_minor_fix_path` is true whenever `unresolved_minor_batchable_findings` is non-empty.
- `needs_task_up_path` is true whenever `unresolved_task_required_findings` or `incomplete_review_blockers` is non-empty.
- `safe_to_exit_review_loop_without_tasking` must be false whenever any unresolved, blocked, rerun, or final-revalidation condition remains.

Preserve every same-cycle field this step does not own, including two-phase review identity and counters, minor-fix history, commit SHAs, review-cycle identity, rerun state, final-revalidation state, and task-up ownership state.
Preserve the current-pass `review_decision_recording` object unchanged as `pending`; only the later recorder and verifier may replace that outcome.

</state_coherence_rules>

<failure_modes>

- If `current-plan.json` or `review-disposition-state.json` is missing, unreadable, malformed, or belongs to a different story or plan, make no edits and report that promotion could not be performed safely.
- If a task-required entry has no stable finding ID, leave it unchanged and report the state inconsistency instead of guessing.
- If same-cycle evidence is ambiguous about whether a finding already received an inline attempt, preserve it as task-required rather than creating an indefinite repeat attempt.

</failure_modes>

<output_contract>

- Update only `codeInfoStatus/flow-state/review-disposition-state.json`.
- Report the IDs promoted into the minor queue, the IDs retained as task-required, the resulting counts, and whether `needs_minor_fix_path` and `needs_task_up_path` are true.
- Do not claim that promotion fixed, attempted, or tasked up a finding. The coding step owns the attempt.

</output_contract>

<verification_loop>

- Confirm every pre-existing minor finding remained in the minor queue.
- Confirm every newly promoted finding was removed from the task-required queue.
- Confirm every scope-approved actionable finding that lacks a prior same-cycle inline attempt is now in the minor queue.
- Confirm rejected, blocked, resolved, and incomplete-review entries were not promoted.
- Confirm every moved finding preserved its original task-required reason and now records why it was promoted.
- Confirm all counts and routing booleans match the final arrays.
- Confirm the state file is valid JSON.
- Confirm no file other than `review-disposition-state.json` changed.

</verification_loop>
