# Goal

Generate or update exactly one normal plan task that owns final automated revalidation after inline GitHub PR review fixes.

This is a post-review-loop step. It runs only after the PR-review loop has finished deciding whether more inline PR-fix reruns are needed. It must update an existing final PR-fix revalidation task when one already exists, not append duplicates.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`.
- Use only the stored `plan_path`, `additional_repositories`, and review disposition state as the active scope.
- Re-open the exact canonical plan from disk before deciding whether to edit it.
- Run `python3 "$CODEINFO_ROOT/scripts/find_minor_fix_revalidation_task.py"` before deciding whether an existing final revalidation task should be reused.
- Treat the helper's `review_cycle_id` match as the primary identity for the task.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.
- Do not rediscover review artifacts by timestamp.
- Do not create a final PR-fix revalidation task when no inline PR-review fixes were made in the review loop.
- Do not create a final PR-fix revalidation task while unresolved actionable PR findings or incomplete-review blockers remain.
- Do not run automated proof in this step.
- Do not perform manual testing.
- If tracked files are changed, commit them before finishing this step.
- Do not push.

</critical_rules>

<generation_rules>

- If `needs_final_minor_fix_revalidation_task` is not true:
  - make no plan change;
  - if no unresolved work remains, update the ignored state file so `safe_to_exit_review_loop_without_tasking` is true;
  - report the no-op reason.
- If `needs_final_minor_fix_revalidation_task` is true, add or update one normal numbered task in the canonical plan.
- Only create or update this task when inline PR-review fixes were made in the just-finished review cycle, no unresolved work remains, and `minor_fix_revalidation_cycle_closed` is not true.
- The task title must be `Re-Validate Story <story-number> After PR Review Fixes`.
- The task status must be `__to_do__`.
- The task must include exactly one `Repository Name` field.
- The task section order must be:
  - `Repository Name`
  - `Affected Repositories`
  - `Addresses Findings`
  - `Subtasks`
  - `Testing`
  - `Implementation Notes`
  - optional `Manual Testing Guidance`
- The task must include the exact line `- Review Task Role: \`final_minor_fix_revalidation\`` in `Implementation Notes` so the existing helper can still recognize it.
- The task must include the exact line `- Review Cycle Id: \`<review_cycle_id>\`` in `Implementation Notes`.
- `Subtasks` must describe implementation-free proof preparation only.
- `Testing` must contain automated wrapper-level proof only.
- The task must explain that PR-review fixes were already made inline and this task owns the broad full-story proof before the branch is considered complete again.

</generation_rules>

<state_update_rules>

After adding or updating the final PR-fix revalidation task:

- Set `review_created_tasks_added_or_updated` to true.
- Keep `minor_fix_revalidation_cycle_closed` false.
- Set `needs_final_minor_fix_revalidation_task` to false.
- Set `needs_review_rerun_before_close` to false.
- Set `safe_to_exit_review_loop_without_tasking` to false.
- Add a concise `classification_notes` entry naming the task heading that was added or updated.
- Preserve `review_cycle_id` exactly as-is for this active review loop.

When no task is needed and no unresolved work remains:

- Set `review_created_tasks_added_or_updated` to false.
- Set `safe_to_exit_review_loop_without_tasking` to true.
- Leave finding arrays unchanged.

</state_update_rules>

<idempotency_rules>

- Reuse the existing helper output to decide whether a same-cycle revalidation task already exists.
- If such a task exists, update it instead of adding a duplicate.
- Do not append a second same-cycle final revalidation task.
- If the existing task is `__done__` but new resolved PR fixes must be added to it, reopen it to `__to_do__`.
- Preserve completed proof notes that remain true, but uncheck or rewrite any testing item whose proof is no longer honest after adding new resolved PR fixes.

</idempotency_rules>

<output_contract>

- Add or update at most one normal numbered final revalidation task.
- Update `review-disposition-state.json` so downstream flow steps can return to task execution when a task was added.
- Commit tracked plan changes when a task was added or updated.
- Report whether a task was added, updated, or skipped, the task heading when present, and the state booleans after the update.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before `review-disposition-state.json`.
- Confirm the exact canonical plan was re-opened from disk before editing.
- Confirm no unresolved actionable PR findings or incomplete-review blockers remained before generating the task.
- Confirm the task is a normal numbered task with `Task Status: __to_do__`.
- Confirm the selected or created task carries the same `review_cycle_id` as `review-disposition-state.json`.
- Confirm the task has an `Affected Repositories` section that covers every repository represented in `resolved_minor_findings`.
- Confirm runnable commands live only in `Testing`.
- Confirm no manual-testing work was added to `Subtasks` or `Testing`.
- Confirm the state file is valid JSON after updating.
- Confirm tracked changes were committed if the plan changed.

</verification_loop>
