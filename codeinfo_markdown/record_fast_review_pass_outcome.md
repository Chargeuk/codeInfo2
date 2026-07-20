# Goal

Record one successfully classified fast-review pass and snapshot the accepted minor-finding count immediately before the Minor Review Fix Path.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Read `codeInfoStatus/flow-state/active-review-cycle.json` second and require its in-progress final-review cycle, story, and plan to match the disposition state and current review set exactly.
- Then read `codeInfoStatus/flow-state/review-disposition-state.json` and the exact current `review_pass_id` stored there.
- When `codeInfoTmp/reviews/<story-number>-current-review-set.json` exists, read it and the matching `current-review-wave-validation.json`; otherwise read the legacy `current-review-validation.json`.
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
8. In wave mode, require exact `story_id`, `review_cycle_id`, `review_wave_id`, `targets_sha256`, and `review_phase: "fast"` agreement between the finalized review set and wave validation. Also require the validation's `story_id`, `plan_path`, and `review_cycle_id` to match current-plan and disposition state. Require unique `expected_jobs` and exactly one `job_results` entry for each expected `instance_id`. The expected count comes from the manifest, so a normal wave is `2N + 1`, including the required cross-repository job.
9. A wave job is complete only when its result has `status: "completed"`; `partial`, `failed`, `missing`, `stale`, or `invalid` results are incomplete coverage. In legacy mode, map the exact Codex and OpenCode validation results to two jobs and retain their existing exact-identity checks.
10. Set `fast_current_pass_expected_job_count`, `fast_current_pass_completed_job_count`, `fast_current_pass_partial_job_count`, `fast_current_pass_failed_job_count`, and `fast_current_pass_missing_job_count`. Count `stale` and `invalid` results with failed jobs. Set `fast_current_pass_coverage_complete` only when every expected job completed, and set `fast_current_pass_coverage_trusted` only when the complete artifact identity and one-to-one job set are trustworthy.
11. Missing, stale, or malformed coverage evidence must fail forward: record zero completed jobs, `fast_current_pass_coverage_complete: false`, and `fast_current_pass_coverage_trusted: false` instead of stopping. Use a trustworthy manifest's expected count when available; otherwise use zero without claiming completion.
12. Set `fast_review_coverage_exhausted` to true only when coverage is incomplete on pass five; otherwise set it to false. Set `fast_phase_complete` to false. The deterministic post-fix checker owns deciding whether the phase may advance.
13. Set `needs_review_rerun_before_close` to true only when the captured minor count is greater than zero or `deferred_review_candidates` is non-empty, provided `fast_review_pass_count` is less than 5. Provider or coverage failure is durable blocker evidence, not by itself a reason to spend all five passes; usable sibling findings must still be fixed and a new pass follows only after that fix attempt. Otherwise set it to false. Deferred candidates are not clean convergence.
14. Keep `needs_final_minor_fix_revalidation_task` false until both fast and slow phases are complete.
15. Keep `safe_to_exit_review_loop_without_tasking` false while the two-phase review cycle is active.
16. Preserve all finding arrays, counts, review identity, cumulative minor-fix history, `minor_fix_audit_schema_version`, every existing `minor_fix_pass_audits` entry, task-up state, final-revalidation ownership fields, and any legacy reviewer-coverage fields from a resumable pre-wave state.

</state_update_rules>

<failure_modes>

- If review decisions are not durably recorded for the exact current pass, make no changes and report that the existing decision-recording retry gate must run.
- If active-cycle identity does not match, make no changes. Preserve every current reviewer candidate as deferred routing state and require another pass while the five-pass budget remains.
- If adding the current pass would exceed five distinct fast-review pass IDs, make no changes and report invalid fast-phase control state.
- If the count is missing, non-integer, negative, or disagrees with `unresolved_minor_batchable_findings`, make no changes and report the contradiction.
- Do not stop merely because validation data is missing, stale, or malformed. Record incomplete job coverage so the deterministic loop retries while passes remain.

</failure_modes>

<output_contract>

- Report the review pass ID, fast pass count, captured pre-fix minor count, completed and expected job counts, coverage trust/completeness, coverage exhaustion, and whether another fast review will be required after the current minor queue is drained.
- Confirm the updated state remains valid JSON and no other file changed.

</output_contract>
