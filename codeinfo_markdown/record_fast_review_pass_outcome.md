# Goal

Record one successfully classified fast-review pass and snapshot the accepted minor-finding count immediately before the Minor Review Fix Path.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Then read `codeInfoStatus/flow-state/review-disposition-state.json` and the exact current `review_pass_id` stored there.
- Update only `codeInfoStatus/flow-state/review-disposition-state.json`.
- Do not edit the plan, review artifacts, code, tests, or configuration.
- Do not commit or push.
- Count only `counts.unresolved_minor_batchable` after classification, story-scope filtering, actionable promotion, and successful review-decision recording. Raw, rejected, duplicate, incomplete, resolved, blocked, or task-required findings do not contribute to this count.

</critical_rules>

<state_update_rules>

1. Require the current state to contain a usable `review_cycle_id`, `review_pass_id`, and `review_decision_recording.outcome` of `recorded` or `no_decisions` for that exact pass.
2. Set `review_phase` to `fast` when it is absent. If it is present and is not `fast`, stop without changing state.
3. Treat `fast_reviewed_pass_ids` as the ordered identity set for successfully recorded fast-review passes.
4. If the exact current `review_pass_id` is not already present, append it once and increment `fast_review_pass_count` once.
5. If the pass ID is already present, do not increment the count. Refresh only the current-pass snapshot so a safe retry is idempotent.
6. Set `fast_review_pass_count` to the length of `fast_reviewed_pass_ids`; require it to be between 1 and 5 inclusive.
7. Set `fast_current_pass_minor_count_before_fix` to the current integer `counts.unresolved_minor_batchable` value.
8. Set `fast_phase_complete` to false. The deterministic post-fix checker owns deciding whether the phase may advance.
9. Set `needs_review_rerun_before_close` to true only when the captured minor count is greater than zero and `fast_review_pass_count` is less than 5. Otherwise set it to false.
10. Keep `needs_final_minor_fix_revalidation_task` false until both fast and slow phases are complete.
11. Keep `safe_to_exit_review_loop_without_tasking` false while the two-phase review cycle is active.
12. Preserve all finding arrays, counts, review identity, cumulative minor-fix history, task-up state, and final-revalidation ownership fields.

</state_update_rules>

<failure_modes>

- If review decisions are not durably recorded for the exact current pass, make no changes and report that the existing decision-recording retry gate must run.
- If adding the current pass would exceed five distinct fast-review pass IDs, make no changes and report invalid fast-phase control state.
- If the count is missing, non-integer, negative, or disagrees with `unresolved_minor_batchable_findings`, make no changes and report the contradiction.

</failure_modes>

<output_contract>

- Report the review pass ID, fast pass count, captured pre-fix minor count, and whether another fast review will be required after the current minor queue is drained.
- Confirm the updated state remains valid JSON and no other file changed.

</output_contract>
