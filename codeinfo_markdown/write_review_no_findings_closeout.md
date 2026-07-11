# Goal

Append or repair the durable `Post-Implementation Code Review` closeout when the current review loop has finished cleanly with no remaining findings or follow-up review work.

This step is the clean-closeout writer only. It must not create review-fix tasks, final revalidation tasks, or code changes.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` before deciding whether to edit the relevant closeout section.
- Derive the story number from `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
- Use the stored review handoff plus the artifacts it references as the source of review context.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.
- Do not discover review artifacts by timestamp.
- Do not create tasks in this step.
- Do not run proof in this step.
- Do not perform manual testing in this step.
- If tracked files are changed, commit them before finishing this step.
- Do not push.

</critical_rules>

<clean_closeout_rules>

- If any of these remain true, make no plan change and report that the review is not ready for clean closeout:
  - `unresolved_task_required_findings` is non-empty;
  - `unresolved_minor_batchable_findings` is non-empty;
  - `operationally_blocked_minor_findings` is non-empty;
  - `incomplete_review_blockers` is non-empty;
  - `needs_task_up_path` is true;
  - `needs_minor_fix_path` is true;
  - `needs_review_rerun_before_close` is true;
  - `needs_final_minor_fix_revalidation_task` is true;
  - `review_created_tasks_added_or_updated` is true;
  - `final_revalidation_owned_by_task_up_path` is true while the canonical plan still contains the recorded `task_up_owned_final_revalidation_task_title` as unfinished, or while that title is missing and the cycle therefore cannot yet be proven closed honestly;
  - `minor_fix_revalidation_cycle_closed` is false while the canonical plan still contains an unfinished task titled `Re-Validate Story <story-number> After Inline Minor Review Fixes`.
- If the review handoff or findings artifact is missing or cannot be interpreted safely enough to support a no-findings closeout, make no plan change and report that the closeout cannot yet be written honestly.
- Do not treat `needs_final_minor_fix_revalidation_task = false` as proof that the review cycle is complete. It only means the final minor-fix revalidation task no longer needs to be created.
- When the review has ended cleanly, append or repair a `Post-Implementation Code Review` section for the current `review_pass_id`.
- If the section already exists for this `review_pass_id`, update it instead of appending a duplicate.
- The closeout must state:
  - the branch-vs-base checks performed across every repository in scope;
  - the stored or safely inferred `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, and `comparison_rule` for every repository in scope;
  - whether each repository reviewed local `HEAD` against a remote-tracking base or a local fallback, including the fallback reason when available;
  - the acceptance-evidence checks performed;
  - the files or surfaces inspected at review time;
  - why each repository in scope remains complete;
  - why the overall story remains complete;
  - the residual-risk or rejected-risk notes carried forward from the findings artifact and challenge artifact when present.
- When the review scope spans multiple repositories, the closeout must also explain why the cross-repository integration evidence was sufficient.
- When the review artifacts make confidence limits visible, preserve those limits honestly instead of implying the review was exhaustive.
- Inline minor fixes may already have included bounded local automated test changes. This closeout should still treat broader cross-repository proof and manual validation as work owned by the final revalidation task when such work was required.

</clean_closeout_rules>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop and say the current-plan handoff must be regenerated.
- If `review-disposition-state.json` is missing, unreadable, malformed, or has incompatible `schema_version`, stop and say the review disposition state must be regenerated.
- If the canonical plan file is missing or branch story scope has drifted, stop and say the current-plan handoff is stale and must be regenerated.
- If tracked plan edits succeed but commit fails, stop and report the failed commit command without pretending the closeout was committed.

</failure_modes>

<output_contract>

- Write or repair only the durable no-findings review closeout in the canonical plan.
- Make no plan change when the review is not yet in a truly clean state.
- Commit tracked plan changes when the closeout section was added or updated.
- Report whether the closeout was added, updated, or skipped, and why.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before `review-disposition-state.json`.
- Confirm a fresh bounded review-scope packet was loaded before editing.
- Confirm no unresolved task-required findings, unresolved minor-batchable findings, incomplete-review blockers, rerun requirements, or final minor-fix revalidation requirements remained before writing the closeout.
- Confirm no fresh review-created work remained from the current review cycle.
- Confirm no unfinished task-up-owned final revalidation task remained for the current review cycle.
- Confirm the canonical plan did not still contain an unfinished `Re-Validate Story <story-number> After Inline Minor Review Fixes` task when the closeout was written.
- Confirm the plan now has exactly one `Post-Implementation Code Review` section for the current `review_pass_id`.
- Confirm the closeout preserves the stored or safely inferred comparison metadata for every repository in scope.
- Confirm the closeout records residual risk honestly instead of implying stronger proof than the artifacts support.
- Confirm no tasks were created or reopened in this step.
- Confirm tracked changes were committed if the plan changed.

</verification_loop>
