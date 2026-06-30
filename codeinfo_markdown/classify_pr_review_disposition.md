# Goal

Classify the current GitHub PR review outcome into the normal review-loop state file so the main implementation flow can decide whether to fix remote review findings inline, loop back through full story revalidation, or finish cleanly with the PR left open.

This step is a traffic controller only. It must not fix findings, task up findings, or mutate the canonical plan.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact canonical plan from disk before classifying the review.
- Derive the story number from `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk.
- Do not discover review artifacts by timestamp.
- Use the stored review handoff plus the artifacts it references as the sole source of review outcome.
- Read `"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md"` and follow it strictly.
- Do not edit the canonical plan, review artifacts, code, tests, docs, or configuration in this step.
- The only file this step may create or update is `codeInfoStatus/flow-state/review-disposition-state.json`.
- Treat `codeInfoStatus/flow-state/review-disposition-state.json` as generated flow state. Do not commit it unless a later human explicitly asks to persist runtime state.

</critical_rules>

<classification_contract>

- This is the post-local-review PR-review loop. All surviving actionable findings in this path are fixed inline.
- Do not route any current-story actionable PR-review finding into `unresolved_task_required_findings`.
- `unresolved_task_required_findings` must remain empty unless a truly unusable review basis leaves no safe way to continue and an `incomplete_review_blocker` is unavoidable.
- Every endorsed finding that is:
  - within current story scope,
  - actionable on the current branch,
  - and not already resolved or stale
  must be routed into `unresolved_minor_batchable_findings`.
- Stale, already-resolved, out-of-scope, behavior-widening, or otherwise non-actionable findings must be routed into `rejected_or_non_actionable_findings`.
- If the review outcome cannot be interpreted safely because required artifacts are missing or malformed, write an `incomplete_review_blockers` entry instead of claiming a clean result.
- Preserve same-cycle history already stored in:
  - `review_cycle_id`
  - `minor_fixes_made_in_review_loop`
  - `minor_fix_commit_shas`
  - `resolved_minor_findings`
  - `minor_fix_revalidation_cycle_closed`
  - `final_revalidation_owned_by_task_up_path`
  - `task_up_owned_final_revalidation_task_title`
  when that history clearly belongs to the same story and canonical plan.

</classification_contract>

<scope_rules>

1. Read `current-plan.json` from disk and extract `plan_path` plus `additional_repositories`.
2. Re-open the exact `plan_path` from disk.
3. Verify the current repository branch story number matches the selected plan story number.
4. Read `codeInfoTmp/reviews/<story-number>-current-review.json`.
5. Read the `findings_file` referenced by that handoff directly from disk.
6. Read `saturation_file` and `challenge_file` when present.
7. Read the previous `review-disposition-state.json` when it exists so same-cycle state can be preserved honestly.

</scope_rules>

<routing_rules>

- Start from the endorsed findings in the findings artifact.
- For each endorsed finding:
  - reject it if it would widen story scope, require an unapproved user-facing behavior change, address a pre-existing unrelated issue, or otherwise fail the story-behavior-lock rules;
  - reject it if repository evidence already shows the issue is resolved on the current branch;
  - otherwise, route it into `unresolved_minor_batchable_findings`.
- Prefer rejection over scope expansion when scope is ambiguous.
- Do not classify any actionable PR-review finding as task-up work in this path.
- Keep `needs_task_up_path` false unless an `incomplete_review_blocker` is present.
- Preserve same-cycle `resolved_minor_findings` and `minor_fix_commit_shas` exactly when they still belong to this review cycle so later PR-fix revalidation coverage remains durable.
- Recompute:
  - `counts`
  - `has_unresolved_task_required_findings`
  - `has_unresolved_minor_batchable_findings`
  - `only_minor_batchable_findings`
  - `needs_minor_fix_path`
  - `needs_task_up_path`
  - `needs_review_rerun_before_close`
  - `needs_final_minor_fix_revalidation_task`
  - `safe_to_exit_review_loop_without_tasking`

</routing_rules>

<state_expectations>

- `needs_minor_fix_path` is true whenever actionable PR-review findings remain.
- `needs_task_up_path` is false for ordinary actionable PR-review findings in this path.
- `needs_review_rerun_before_close` should stay false in this classifier step unless same-cycle carry-forward state already proves a rerun is still required.
- `needs_final_minor_fix_revalidation_task` is true when all of these are true:
  - `minor_fixes_made_in_review_loop` is already true from the same active `review_cycle_id`;
  - the current classification leaves no unresolved actionable findings and no incomplete-review blockers;
  - `minor_fix_revalidation_cycle_closed` is not true;
  - `final_revalidation_owned_by_task_up_path` is not true.
- Otherwise keep `needs_final_minor_fix_revalidation_task` false in this classifier step.
- `review_created_tasks_added_or_updated` must remain false in this classifier step.
- `safe_to_exit_review_loop_without_tasking` is true only when there are no unresolved actionable findings, no blocked findings, no incomplete-review blockers, no rerun requirement, and no final revalidation task still needed for the same cycle.
- When same-cycle carry-forward state already shows a previous PR-fix rerun was spent and the current pass still cannot converge cleanly, preserve that unresolved condition honestly instead of silently clearing it.

</state_expectations>

<output_contract>

- Update only `codeInfoStatus/flow-state/review-disposition-state.json`.
- Leave the state in a shape where downstream PR-review fix steps can:
  - keep fixing actionable remote findings inline,
  - skip stale/non-actionable findings,
  - or finish cleanly when no actionable remote findings remain.
- Do not create tasks in this step.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read first.
- Confirm the exact canonical plan was re-opened from disk.
- Confirm the review handoff and referenced findings artifact were read.
- Confirm every endorsed finding was routed into exactly one state bucket.
- Confirm no actionable PR-review finding was left in `unresolved_task_required_findings`.
- Confirm no finding was treated as actionable solely because a behavior change would make the product cleaner or easier to prove.
- Confirm stale or already-resolved findings were not left actionable.
- Confirm the updated state file is valid JSON after writing.
- Confirm counts and derived booleans match the state arrays.
- Confirm this step did not edit the canonical plan, review artifacts, code, tests, docs, or config.

</verification_loop>
