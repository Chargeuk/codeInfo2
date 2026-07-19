# Goal

Finalize the combined fast-plus-slow review disposition so task-up and final revalidation run exactly once after both phases.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first, then `codeInfoStatus/flow-state/review-disposition-state.json`.
- Update only `codeInfoStatus/flow-state/review-disposition-state.json`.
- Do not edit the plan, review artifacts, code, tests, or configuration.
- Do not commit or push.
- Preserve `review_cycle_id`, cumulative fixed-finding history, and exact full commit SHAs.
- Preserve `minor_fix_audit_schema_version` and every fast or slow `minor_fix_pass_audits` entry exactly; finalization routes accumulated work but does not rewrite historical attempts.

</critical_rules>

<finalization_rules>

1. Require `review_phase: "slow"` and require the slow review pass to have been classified, recorded, and fully drained by the Minor Review Fix Path.
2. Set `slow_review_completed` to true and `needs_review_rerun_before_close` to false. The slow reviewer runs once in this cycle.
3. If `unresolved_minor_batchable_findings` is non-empty, do not finalize. Report that the slow minor-fix queue was not drained.
4. Convert any remaining `operationally_blocked_minor_findings` into explicit `incomplete_review_blockers` that preserve the finding ID, repository, summary, and blocker reason. Clear the operational bucket only after that durable blocker is recorded.
5. When `fast_review_coverage_exhausted` is true, add one deduplicated `incomplete_review_blockers` entry describing the expected, completed, partial, failed, and missing fast jobs. Preserve the coverage fields so task-up and final reporting cannot describe the cycle as fully covered.
6. Recompute every count and routing boolean from the final arrays.
7. If unresolved task-required findings or incomplete-review blockers exist:
   - set `needs_task_up_path` to true;
   - set `needs_final_minor_fix_revalidation_task` to false because the task-up path owns one shared final revalidation task;
   - set `safe_to_exit_review_loop_without_tasking` to false.
8. Otherwise, when `minor_fixes_made_in_review_loop` is true, require `minor_fix_commit_shas` to be non-empty and valid, then:
   - set `needs_task_up_path` to false;
   - set `needs_final_minor_fix_revalidation_task` to true unless `final_revalidation_owned_by_task_up_path` is already true;
   - set `safe_to_exit_review_loop_without_tasking` to false.
9. Otherwise no actionable review work changed the story:
   - set `needs_task_up_path` to false;
   - set `needs_final_minor_fix_revalidation_task` to true unless `final_revalidation_owned_by_task_up_path` is already true;
   - set `safe_to_exit_review_loop_without_tasking` to false. A clean review still requires exactly one final whole-story revalidation task.
10. Rejected, duplicate, out-of-scope, or non-actionable findings alone must not create repair tasks, but the cycle still creates its one final revalidation task.
11. Keep `review_created_tasks_added_or_updated` false in this step. The existing task-up and final-task generators own changing it.

</finalization_rules>

<failure_modes>

- If the slow phase is not current, review decisions are not recorded, or the minor queue remains non-empty, make no changes and report the exact incomplete transition.
- If `minor_fixes_made_in_review_loop` is true but no valid full commit SHA is recorded, preserve a blocker instead of claiming final revalidation is ready.

</failure_modes>

<output_contract>

- Report exactly one next action: `task_up` or `generate_final_revalidation`; review-cycle finalization never has a taskless clean-closeout branch.
- Report cumulative fixed, task-required, rejected, blocker, and fast-coverage counts across the active review cycle, including whether coverage was exhausted.
- Confirm state is valid JSON and no other file changed.

</output_contract>
