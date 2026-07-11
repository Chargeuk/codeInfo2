# Goal

Record the most recent minor-review outcome in the review state, review artifacts, and active plan without creating a numbered task.

This step runs after every terminal minor-fix attempt outcome. It records what the minor-fix coding step already did or why that path must now route differently. It does not implement code changes and does not run proof.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Read `codeInfoStatus/flow-state/minor-review-fix-result.json` from disk after the review disposition state, for example with `cat codeInfoStatus/flow-state/minor-review-fix-result.json`.
- Use only the stored `plan_path`, `additional_repositories`, review disposition state, and minor-fix result as the active scope.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` before editing the relevant review section.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.
- Do not rediscover review artifacts by timestamp.
- If the minor-fix result does not have `status: "fixed"`, do not mark any finding resolved. Update the state only when a skipped, blocked, reclassification, or out-of-scope outcome must steer the next loop step honestly.
- Do not create a numbered task for a resolved minor finding.
- Do not delete the original finding from the findings artifact.
- Do not perform manual testing.
- Do not run automated proof in this documentation step.
- If tracked files are changed, commit them before finishing this step.
- Do not push.

</critical_rules>

<state_update_rules>

When `minor-review-fix-result.json` has `status: "fixed"`:

1. Remove the matching `finding_id` from `unresolved_minor_batchable_findings`.
2. Add or update the matching entry in `resolved_minor_findings` with:
   - finding ID;
   - repository;
   - summary;
   - `resolution_commit` as the exact full 40-character git commit SHA;
   - proof summary.
3. Set `minor_fixes_made_in_review_loop` to true.
4. Append the exact full 40-character commit SHA to `minor_fix_commit_shas` if it is not already present.
5. Recompute all `counts` from the arrays.
6. Recompute booleans:
   - `has_unresolved_task_required_findings`
   - `has_unresolved_minor_batchable_findings`
   - `only_minor_batchable_findings`
   - `needs_minor_fix_path`
   - `needs_task_up_path`
7. Set `needs_review_rerun_before_close` to true unless unresolved task-required findings now take precedence.
8. Keep `needs_final_minor_fix_revalidation_task` false until a later clean review pass sees no unresolved findings after the minor fixes.
9. Set `minor_fix_revalidation_cycle_closed` to false because this cycle is still open until a later clean review pass confirms the final revalidation task has been completed.
10. Keep `review_created_tasks_added_or_updated` false in this step.
11. Set `safe_to_exit_review_loop_without_tasking` false.
12. Do not clear or overwrite `final_revalidation_owned_by_task_up_path` or `task_up_owned_final_revalidation_task_title` in this step.
13. Preserve `review_cycle_id` exactly as-is for this active review loop, keeping the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.

When the result has `status: "reclassify_task_required"`:

1. Move the matching finding from `unresolved_minor_batchable_findings` to `unresolved_task_required_findings`.
2. Record the reclassification reason.
3. If the original minor-batchable entry already carried a routed fix constraint in its `reason`, preserve that constraint when writing the escalated task-required entry instead of replacing it with a generic escalation note. The later task-up step must still be able to tell that the underlying issue is actionable while the reviewer-proposed remedy is not.
4. Recompute counts and booleans so `needs_task_up_path` is true, and keep `needs_minor_fix_path` true when other unresolved minor findings still remain.
5. Keep `review_created_tasks_added_or_updated` false in this step.
6. Set `safe_to_exit_review_loop_without_tasking` false.
7. Do not clear or overwrite `final_revalidation_owned_by_task_up_path` or `task_up_owned_final_revalidation_task_title` in this step.

When the result has `status: "out_of_scope_current_story"`:

1. Remove the matching finding from `unresolved_minor_batchable_findings`.
2. Add or update the matching entry in `rejected_or_non_actionable_findings` with a concise reason such as `Would require an unapproved user-facing behavior change; current behavior preserved for this story.`
3. Recompute counts and booleans so `needs_minor_fix_path` reflects whether any unresolved minor findings still remain, and `needs_task_up_path` reflects only actual unresolved task-required work or incomplete-review blockers.
4. Add a concise `classification_notes` entry explaining that the finding was treated as out-of-scope for the current story and that current behavior was preserved.
5. Keep `review_created_tasks_added_or_updated` false in this step.
6. Recompute `safe_to_exit_review_loop_without_tasking` from the current state arrays and existing closeout flags rather than forcing task-up.
7. Do not clear or overwrite `final_revalidation_owned_by_task_up_path` or `task_up_owned_final_revalidation_task_title` in this step.
8. Preserve `review_cycle_id` exactly as-is for this active review loop, keeping the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.

When the result has `status: "blocked"`:

1. A blocked result means the inline minor path could not proceed safely in this pass and must not be retried indefinitely from the same minor queue.
2. Remove the blocked finding from `unresolved_minor_batchable_findings` so the loop does not keep selecting the same temporarily blocked item as minor work in this pass.
3. Add or update the matching entry in `operationally_blocked_minor_findings` instead of `rejected_or_non_actionable_findings`, because the finding may still be real even though the inline fix attempt was temporarily unsafe. Record:
   - the `finding_id` when one exists, or `null` only for a pass-global interruption raised before one finding could be isolated;
   - repository;
   - summary;
   - a concise reason such as `Operationally blocked in this review pass; still unresolved and awaiting a fresh rerun after the interruption is cleared.`;
   - blocker text;
   - blocker scope.
4. If `blocker_scope` is `global`, also remove every remaining `unresolved_minor_batchable_findings` entry and add or update matching `operationally_blocked_minor_findings` entries explaining that a global operational blocker made further inline minor attempts unsafe in this pass.
5. If `blocker_scope` is missing or ambiguous, treat it as `global` rather than leaving any blocked minor finding stranded in the retry queue.
6. Set `needs_review_rerun_before_close` to true because the review cycle must be rerun after the operational interruption is repaired before the story can close honestly.
7. Add a concise `classification_notes` entry naming the blocker and whether it was treated as finding-only or global.
8. Recompute counts and booleans so `needs_minor_fix_path` reflects only remaining unresolved minor findings, `needs_task_up_path` reflects only actual unresolved task-required work or incomplete-review blockers, and the blocked finding stays visible as unresolved review state instead of disappearing into a non-actionable bucket.
9. Keep `review_created_tasks_added_or_updated` false in this step.
10. Recompute `safe_to_exit_review_loop_without_tasking` from the current state arrays and closeout flags. A non-empty `operationally_blocked_minor_findings` array must keep this false until a fresh rerun resolves or reclassifies the finding honestly.
11. Do not clear or overwrite `final_revalidation_owned_by_task_up_path` or `task_up_owned_final_revalidation_task_title` in this step.
12. Preserve `review_cycle_id` exactly as-is for this active review loop, keeping the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.

When the result has `status: "skipped"`:

1. If the skipped result clearly identifies stale or already-resolved state, remove that stale minor finding from `unresolved_minor_batchable_findings` and record the cleanup reason.
2. Otherwise, move the skipped finding from `unresolved_minor_batchable_findings` to `unresolved_task_required_findings` so the issue is not left hanging in the minor bucket.
3. Recompute counts and booleans so `needs_minor_fix_path` reflects whether any unresolved minor findings still remain, and `needs_task_up_path` reflects any escalated work.
4. Add a concise `classification_notes` entry explaining why the issue was cleaned up or escalated after the skipped outcome.
5. Do not clear or overwrite `final_revalidation_owned_by_task_up_path` or `task_up_owned_final_revalidation_task_title` in this step.
6. Preserve `review_cycle_id` exactly as-is for this active review loop, keeping the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.

</state_update_rules>

<plan_documentation_rules>

- Add or update a non-task section in the canonical plan named `## Minor Review Fixes`.
- Place the section near the end of the plan unless it already exists elsewhere.
- Do not create or modify `### Task` headings for minor fixes.
- For each fixed minor finding, add or update one bullet with:
  - review pass ID;
  - finding ID;
  - repository;
  - short summary;
  - changed files;
  - exact full 40-character git commit SHA;
  - targeted proof summary or `not run` with reason;
  - disposition text: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Keep the bullet compact enough for audit, not a full implementation narrative.
- If the finding already has a bullet, update that bullet rather than adding a duplicate.
- Resolved inline minor findings may include small local automated test updates or one or two new focused tests in the owning repository.

</plan_documentation_rules>

<review_artifact_rules>

- If the findings artifact from `review-disposition-state.json` exists and is writable, append or update a `Resolved Minor Findings` section.
- Do not remove or rewrite the original findings list.
- The artifact note must include finding ID, the exact full 40-character git commit SHA, proof summary, and the fact that the active plan also records the inline resolution.
- If the findings artifact is unavailable or ignored scratch state cannot be updated safely, continue after recording that fact in `classification_notes`.

</review_artifact_rules>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop and say the current-plan handoff must be regenerated.
- If `review-disposition-state.json` is missing, unreadable, malformed, or has incompatible `schema_version`, stop and say the review disposition state must be regenerated.
- If `minor-review-fix-result.json` is missing, unreadable, malformed, or has incompatible `schema_version`, stop and say the minor-fix result must be regenerated.
- If the result says `fixed` but has no `finding_id` or no `commit_sha`, do not mark anything resolved. Add or preserve an incomplete-review blocker in state and report the contradiction.
- If the result `commit_sha` is not a full 40-character git commit SHA, do not mark the finding resolved. Add a state note or blocker explaining that the fix commit format is invalid.
- If the result commit cannot be found in the target repository, do not mark the finding resolved. Add a state note or blocker explaining that the fix commit is missing.
- If the canonical plan already has a `## Minor Review Fixes` entry for the finding ID, update that entry rather than adding a duplicate.
- If updating the findings artifact fails because it is missing or ignored scratch state is unavailable, continue after recording the issue in `classification_notes`; the plan and state remain the required durable documentation.
- If the plan edit succeeds but commit fails, stop and report the failed commit command without pretending the documentation was committed.

</failure_modes>

<output_contract>

- Update `review-disposition-state.json` so downstream loop gates can decide whether to keep fixing minor findings, task up reclassified work, or rerun review.
- Update the canonical plan with a durable minor-fix audit note when a finding was fixed.
- Update the findings artifact with a resolved-minor note when safely possible.
- Commit tracked plan changes when they were made.
- Report the finding ID, state transition, plan documentation status, artifact documentation status, and the exact full 40-character commit SHA for any documentation commit.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read first.
- Confirm `review-disposition-state.json` and `minor-review-fix-result.json` were read after `current-plan.json`.
- Confirm a fresh bounded review-scope packet was loaded before editing.
- Confirm no numbered task was created for a resolved minor finding.
- Confirm the state file is valid JSON after updating.
- Confirm counts match the state arrays.
- Confirm `review_cycle_id` was preserved for the same active review loop.
- Confirm every stored fixed-result `commit_sha`, `resolution_commit`, and `minor_fix_commit_shas` value handled in this step is an exact full 40-character git commit SHA.
- Confirm the plan has exactly one audit entry for the fixed finding.
- Confirm no manual testing or automated proof was run in this documentation step.
- Confirm tracked changes were committed if the plan changed.

</verification_loop>
