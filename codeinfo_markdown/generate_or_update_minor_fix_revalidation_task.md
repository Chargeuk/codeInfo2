# Goal

Generate or update exactly one normal plan task that owns final automated revalidation after inline minor review fixes.

This is a post-review-loop step. It runs only after the review loop has finished deciding whether more minor reruns are needed or whether serious review work must be tasked up. It must update an existing final minor-fix revalidation task when one already exists, not append duplicates.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Use only the stored `plan_path`, `additional_repositories`, and review disposition state as the active scope.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` and `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --include-tasks` before deciding whether to edit the plan.
- Read and follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`, especially its minor-fix-only eligibility, identity, and duplicate-prevention rules.
- Run `python3 "$CODEINFO_ROOT/scripts/find_minor_fix_revalidation_task.py"` before deciding whether an existing final minor-fix revalidation task should be reused or reopened.
- Treat the helper's `review_cycle_id` match as the primary identity for the task. Use task order only as a sanity check, not as the identity rule.
- Treat `review_cycle_id` as the stable machine identity for the current review loop, using the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.
- Do not rediscover review artifacts by timestamp.
- Do not create a final minor-fix revalidation task when no minor fixes were made in the review loop.
- Do not create a final minor-fix revalidation task while unresolved task-required findings, unresolved minor-batchable findings, or incomplete-review blockers remain.
- Do not run automated proof in this step.
- Do not perform manual testing.
- If tracked files are changed, commit them before finishing this step.
- Do not push.

</critical_rules>

<generation_rules>

- If `needs_final_minor_fix_revalidation_task` is not true:
  - make no plan change;
  - if `final_revalidation_owned_by_task_up_path` is true, leave this step as a deliberate no-op because the serious task-up path already owns final revalidation for the current review cycle;
  - otherwise, if no unresolved work remains, update the ignored state file so `safe_to_exit_review_loop_without_tasking` is true;
  - report the no-op reason.
- If `needs_final_minor_fix_revalidation_task` is true, add or update one normal numbered task in the canonical plan.
- Only create or update this task when minor fixes were made in the just-finished review cycle, no serious task-up work remains, and `minor_fix_revalidation_cycle_closed` is not true.
- If `final_revalidation_owned_by_task_up_path` is true, do not create or update the special inline-minor final revalidation task. The cycle already has one shared final revalidation owner.
- The task title must be `Re-Validate Story <story-number> After Inline Minor Review Fixes` unless an existing equivalent final minor-fix revalidation task already uses a compatible title.
- The task must stay as exactly one dedicated final revalidation task even when the whole story or resolved minor fixes span multiple repositories.
- The task status must be `__to_do__`.
- The task must include exactly one `Repository Name` field so it still fits the normal task format, but that field is administrative ownership only for this special final revalidation task.
- The task section order must be: `Repository Name`, `Affected Repositories`, `Affected Applications Or Components`, `Addresses Findings`, `Subtasks`, `Testing`, `Implementation Notes`, and optional `Manual Testing Guidance`.
- The task must include an `Affected Repositories` section naming every repository represented in `resolved_minor_findings`.
- Expand `Affected Repositories` and `Affected Applications Or Components` from the whole approved story and its actual story-owned changes, not only from `resolved_minor_findings`, so final proof covers every application or component changed before or during the review cycle.
- If more than one repository is named in `Affected Repositories`, the task body must explicitly say that validation scope is driven by `Affected Repositories`, not by `Repository Name` alone.
- The task must include an `Addresses Findings` section naming every `resolved_minor_findings` ID, summary, repository, and resolution commit from the state.
- The task must include `Subtasks`, `Testing`, and `Implementation Notes`; include optional `Manual Testing Guidance` only when useful.
- The task must include the exact line `- Review Task Role: \`final_minor_fix_revalidation\``in`Implementation Notes` so the helper script can recognize it on later passes.
- The task must include the exact line `- Review Cycle Id: \`<review_cycle_id>\``in`Implementation Notes` so the helper script can bind the task to the active review cycle.
- At creation time, `Subtasks` must begin with the shared contract's non-checkbox final-task repair-scope note and then contain exactly two checklist bullets in this order: run every affected repository's supported lint command and fix issues; then run every affected repository's supported formatting command and fix issues. Name the discovered commands inside those two bullets without creating one subtask per repository.
- `Testing` must begin with the shared contract's non-checkbox final-task repair-scope note and then contain every repository-supported full automated suite for every application or component in `Affected Applications Or Components`. Include every supported end-to-end suite, use no targeting filters, and do not duplicate lint or formatting there.
- Group testing steps first by repository and then by application or component so every full suite and its ownership are obvious.
- Do not add manual-testing-only work to `Subtasks` or `Testing`.
- Do not add pre-planned subtasks that depend on future screenshots, logs, manual-testing-agent output, or automated-proof output. A later failure-repair pass may add a bounded story-level repair subtask to this same final task only under the runtime exception in the shared final-task contract.
- The task must explain that inline minor fixes were already made and documented, and this task owns final proof before story closure.
- This final task owns the whole story's full-suite confidence check after inline minor fixes, not merely proof local to the fixed findings.
- Do not treat the inline minor-fix step as responsible for full end-to-end story validation. Its job is bounded repair plus bounded local proof only.

</generation_rules>

<idempotency_rules>

- Before appending a new task, use the JSON output from `python3 "$CODEINFO_ROOT/scripts/find_minor_fix_revalidation_task.py"` as the source of truth for whether an existing unfinished or finished task already marks itself as the final revalidation task for inline minor review fixes in the current `review_cycle_id`.
- If such a task exists, update that task's finding coverage, affected repositories, affected applications or components, two initial subtasks, and full-suite testing obligations instead of adding a new task.
- Do not append a second final minor-fix revalidation task for the same story and same `review_cycle_id`.
- If the helper reports duplicate current-cycle tasks, do not update either task yet. Repair the plan so only one task remains for that `review_cycle_id`, then rerun the helper.
- If the helper reports a non-current-cycle historical task, do not reopen it for the current cycle.
- If the helper selected a legacy no-cycle-id task for `review_cycle_id` backfill, that task must still be open with `Task Status: __to_do__` or `Task Status: __in_progress__`. Do not backfill a legacy no-cycle-id task that is already `__done__`.
- If the helper does not find an exact current-cycle match, create a fresh current-cycle task unless it explicitly selected one safe open legacy task for `review_cycle_id` backfill.
- If the existing task is `__done__` but new resolved minor findings must be added to it, reopen it to `__to_do__` before adding unchecked work.
- If the helper reports `needs_cycle_id_backfill`, backfill the current `review_cycle_id` into the selected task while updating it.
- Preserve completed proof notes that remain true, but uncheck or rewrite every full-suite testing item made stale by new resolved minor findings or other later story-owned changes.
- Do not renumber existing tasks unless the plan already has a numbering collision that makes the new or updated task ambiguous.

</idempotency_rules>

<state_update_rules>

After adding or updating the final minor-fix revalidation task:

- Set `review_created_tasks_added_or_updated` to true.
- Keep `review_created_tasks_added_or_updated` true specifically so downstream clean-closeout steps know this review cycle still has open review-created work.
- Keep `minor_fix_revalidation_cycle_closed` false because creating the task does not itself prove the cycle is complete.
- Set `needs_final_minor_fix_revalidation_task` to false.
- Set `needs_review_rerun_before_close` to false.
- Set `safe_to_exit_review_loop_without_tasking` to false.
- Add a concise `classification_notes` entry naming the task heading that was added or updated.
- Preserve `review_cycle_id` exactly as-is for this active review loop.
- Recompute counts from the state arrays if any state bucket changed.

When no task is needed and no unresolved work remains:

- If `final_revalidation_owned_by_task_up_path` is true, leave `review_created_tasks_added_or_updated`, `safe_to_exit_review_loop_without_tasking`, and the task-up ownership fields unchanged in this step so later cycle-close logic can decide when that shared final revalidation task is actually finished.
- Otherwise set `review_created_tasks_added_or_updated` to false.
- Otherwise set `safe_to_exit_review_loop_without_tasking` to true.
- Leave finding arrays unchanged.
- Do not reopen a closed cycle just because older minor-fix history still exists in the ignored state.

</state_update_rules>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop and say the current-plan handoff must be regenerated.
- If `review-disposition-state.json` is missing, unreadable, malformed, or has incompatible `schema_version`, stop and say the review disposition state must be regenerated.
- If `review-disposition-state.json` lacks a usable `review_cycle_id`, repair that state before deciding whether to reuse or create the task.
- If the canonical plan is missing or branch story scope has drifted, stop and say the current-plan handoff is stale and must be regenerated.
- If state says final revalidation is needed but `resolved_minor_findings` is empty, do not create a task. Record a state note and report the contradiction.
- If unresolved task-required, minor-batchable, or incomplete-review items remain, do not create the final minor-fix revalidation task. Leave routing to the task-up or minor-fix path.
- If no repository-supported automated proof can be identified for the affected files, create a bounded proof-authoring subtask and an automated testing placeholder only when it remains concrete; otherwise stop and report that the final revalidation task cannot be generated honestly.
- If the plan edit succeeds but commit fails, stop and report the failed commit command without pretending the task was committed.

</failure_modes>

<output_contract>

- Add or update at most one normal numbered final revalidation task.
- Update `review-disposition-state.json` so downstream flow steps can return to task execution when a task was added.
- Commit tracked plan changes when a task was added or updated.
- Report whether a task was added, updated, or skipped, the task heading when present, and the state booleans after the update.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before `review-disposition-state.json`.
- Confirm fresh bounded review scope and task summaries were loaded before editing.
- Confirm no unresolved task-required findings, unresolved minor-batchable findings, or incomplete-review blockers remained before generating the task.
- Confirm exactly one special inline-minor final revalidation task exists for the current cycle only when the task-up path does not already own final revalidation for that cycle.
- Confirm this step did not create or update a special inline-minor final revalidation task when the task-up path already owned final revalidation for the same cycle.
- Confirm the task is a normal numbered task with `Task Status: __to_do__`.
- Confirm this step did not imply the review cycle was complete merely because the final revalidation task was created.
- Confirm the selected or created task carries the same `review_cycle_id` as `review-disposition-state.json`.
- Confirm the task has an `Affected Repositories` and `Affected Applications Or Components` inventory covering the whole story and every repository represented in `resolved_minor_findings`.
- Confirm the task includes durable coverage for every resolved minor finding.
- Confirm `Subtasks` and `Testing` each begin with the required non-checkbox repair-scope note, and that the initially generated `Subtasks` checklist contains exactly the lint and formatting bullets, in that order, with the discovered affected-repository commands.
- Confirm `Testing` is grouped clearly enough that every affected repository and component's complete full-suite inventory is easy to identify, including every supported end-to-end suite and no targeted filters.
- Confirm lint and formatting are not duplicated in `Testing`.
- Confirm no manual-testing work was added to `Subtasks` or `Testing`.
- Confirm a non-last selected task was treated only as a layout warning rather than as proof of wrong identity when the `review_cycle_id` matched.
- Confirm the state file is valid JSON after updating.
- Confirm tracked changes were committed if the plan changed.

</verification_loop>
