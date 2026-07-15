# Goal

Advance one active two-phase review cycle from its bounded fast-review phase to its single slow-review phase without losing cumulative findings or fixes.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first, then `codeInfoStatus/flow-state/review-disposition-state.json`.
- Update only `codeInfoStatus/flow-state/review-disposition-state.json`.
- Do not edit the plan, review artifacts, code, tests, or configuration.
- Do not commit or push.
- Preserve the active `review_cycle_id` exactly.

</critical_rules>

<transition_rules>

1. Require `review_phase: "fast"`, a valid `fast_review_pass_count` from 1 through 5, matching unique `fast_reviewed_pass_ids`, and `needs_minor_fix_path: false`.
2. Require internally consistent manifest-driven job coverage. Advance with incomplete coverage only when `fast_review_pass_count` is 5 and `fast_review_coverage_exhausted` is true. Accept the legacy two-reviewer coverage fields only for a resumable state that has no generic job-coverage fields.
3. Set `review_phase` to `slow` and `fast_phase_complete` to true.
4. Set `slow_review_completed` to false.
5. Preserve cumulative `minor_fixes_made_in_review_loop`, `minor_fix_commit_shas`, and `resolved_minor_findings`.
6. Preserve unresolved task-required findings and incomplete-review blockers accumulated from usable fast-review passes so the shared post-phase task-up path can process them once.
7. Preserve every fast job-coverage count, trust/completeness flag, and exhaustion flag through the slow phase.
8. Preserve operationally blocked minor findings visibly. The combined finalizer must not allow clean completion while any remain.
9. Require `unresolved_minor_batchable_findings` to be empty before advancing. Do not silently discard a remaining minor finding.
10. Reset only current-pass identity and decision-recording fields that the next slow classifier will replace. Do not clear cumulative review-cycle history or task-up ownership fields.
11. Set `needs_review_rerun_before_close`, `needs_final_minor_fix_revalidation_task`, and `safe_to_exit_review_loop_without_tasking` to false while slow review is pending.

</transition_rules>

<failure_modes>

- If the fast phase is not active, its counters or coverage are invalid, incomplete coverage has not reached the fifth-pass bound, or minor findings remain undrained, make no changes and report the exact contradiction.
- If state belongs to a different story or plan than `current-plan.json`, make no changes and require review state repair.

</failure_modes>

<output_contract>

- Report the preserved review cycle, number of completed fast passes, final fast job coverage and any exhaustion, cumulative fixed-finding count, cumulative task-required count, and that the slow phase is now pending.
- Confirm no file other than review disposition state changed.

</output_contract>
