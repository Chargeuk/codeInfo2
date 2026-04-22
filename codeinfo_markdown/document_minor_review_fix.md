# Goal

Document the most recent minor review fix in the review state, review artifacts, and active plan without creating a numbered task.

This step records what the minor-fix coding step already did. It does not implement code changes and does not run proof.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` after `current-plan.json`.
- Read `codeInfoStatus/flow-state/minor-review-fix-result.json` after the review disposition state.
- Use only the stored `plan_path`, `additional_repositories`, review disposition state, and minor-fix result as the active scope.
- Re-open the exact canonical plan from disk before editing it.
- Do not rediscover review artifacts by timestamp.
- If the minor-fix result does not have `status: "fixed"`, do not mark any finding resolved. Update the state only when a skipped, blocked, or reclassification outcome must steer the next loop step honestly.
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
   - `resolution_commit`;
   - proof summary.
3. Set `minor_fixes_made_in_review_loop` to true.
4. Append the commit SHA to `minor_fix_commit_shas` if it is not already present.
5. Recompute all `counts` from the arrays.
6. Recompute booleans:
   - `has_unresolved_task_required_findings`
   - `has_unresolved_minor_batchable_findings`
   - `only_minor_batchable_findings`
   - `needs_minor_fix_path`
   - `needs_task_up_path`
7. Set `needs_review_rerun_before_close` to true unless unresolved task-required findings now take precedence.
8. Keep `needs_final_minor_fix_revalidation_task` false until a later clean review pass sees no unresolved findings after the minor fixes.
9. Keep `review_created_tasks_added_or_updated` false in this step.
10. Set `safe_to_exit_review_loop_without_tasking` false.

When the result has `status: "reclassify_task_required"`:

1. Move the matching finding from `unresolved_minor_batchable_findings` to `unresolved_task_required_findings`.
2. Record the reclassification reason.
3. Recompute counts and booleans so `needs_task_up_path` is true.

When the result has `status: "blocked"`:

1. Add an `incomplete_review_blockers` entry naming the finding and blocker.
2. Recompute counts and booleans so `needs_task_up_path` is true.

When the result has `status: "skipped"`:

1. Do not change finding buckets unless the result clearly identifies stale state that should be removed.
2. Add a concise `classification_notes` entry explaining why no documentation change was made.

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
  - commit SHA;
  - targeted proof summary or `not run` with reason;
  - disposition text: `Resolved inline during the review loop; no numbered review-fix task was created.`
- Keep the bullet compact enough for audit, not a full implementation narrative.
- If the finding already has a bullet, update that bullet rather than adding a duplicate.

</plan_documentation_rules>

<review_artifact_rules>

- If the findings artifact from `review-disposition-state.json` exists and is writable, append or update a `Resolved Minor Findings` section.
- Do not remove or rewrite the original findings list.
- The artifact note must include finding ID, commit SHA, proof summary, and the fact that the active plan also records the inline resolution.
- If the findings artifact is unavailable or ignored scratch state cannot be updated safely, continue after recording that fact in `classification_notes`.

</review_artifact_rules>

<output_contract>

- Update `review-disposition-state.json` so downstream loop gates can decide whether to keep fixing minor findings, task up reclassified work, or rerun review.
- Update the canonical plan with a durable minor-fix audit note when a finding was fixed.
- Update the findings artifact with a resolved-minor note when safely possible.
- Commit tracked plan changes when they were made.
- Report the finding ID, state transition, plan documentation status, artifact documentation status, and commit SHA for any documentation commit.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read first.
- Confirm `review-disposition-state.json` and `minor-review-fix-result.json` were read after `current-plan.json`.
- Confirm the exact canonical plan was re-opened from disk before editing.
- Confirm no numbered task was created for a resolved minor finding.
- Confirm the state file is valid JSON after updating.
- Confirm counts match the state arrays.
- Confirm the plan has exactly one audit entry for the fixed finding.
- Confirm no manual testing or automated proof was run in this documentation step.
- Confirm tracked changes were committed if the plan changed.

</verification_loop>
