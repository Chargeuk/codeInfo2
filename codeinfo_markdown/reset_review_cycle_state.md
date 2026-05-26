# Goal

Start a fresh active review-loop state before a brand-new `Review Findings Disposition Loop` begins.

This step exists to prevent stale review-loop memory from an earlier completed review cycle from leaking into the next fresh review cycle for the same story.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Treat `codeInfoStatus/flow-state/review-disposition-state.json` and `codeInfoStatus/flow-state/minor-review-fix-result.json` as generated scratch state for one active review loop only.
- Treat `codeInfoStatus/flow-state/archived-operational-blocks.json` as scratch carry-forward state that may preserve finding-only operational minor blockers across one fresh review rerun for the same story.
- Before removing `review-disposition-state.json`, inspect it for `operationally_blocked_minor_findings`.
- If finding-only operationally blocked minor findings exist, preserve only those entries into `codeInfoStatus/flow-state/archived-operational-blocks.json` before the new review loop starts.
- Do not preserve `global` operational blockers in that archive file. A fresh classifier pass should rebuild the review state from artifacts after a pass-global interruption rather than blindly requeueing every earlier minor attempt.
- If no finding-only operationally blocked minor findings exist, remove `codeInfoStatus/flow-state/archived-operational-blocks.json` when it exists so stale parked findings do not leak into a future loop.
- If either `review-disposition-state.json` or `minor-review-fix-result.json` exists, remove it before the new review loop starts after any needed archive preservation is complete.
- If either scratch file is already absent, leave it absent and continue.
- Do not edit the canonical plan in this step.
- Do not edit review artifacts in `codeInfoTmp/reviews/` in this step.
- Do not edit code, tests, docs, or configuration in this step.
- Do not commit.
- Do not push.

</critical_rules>

<reasoning_steps>

1. Read `current-plan.json` from disk and confirm it contains a clear `plan_path`.
2. Treat this step as the start of a fresh review-loop state scope, not as a continuation of any earlier completed review cycle.
3. If `review-disposition-state.json` exists, read its `operationally_blocked_minor_findings` array and preserve only `finding_only` entries into `codeInfoStatus/flow-state/archived-operational-blocks.json`.
4. If no eligible finding-only entries exist, remove `codeInfoStatus/flow-state/archived-operational-blocks.json` when it exists.
5. Remove `codeInfoStatus/flow-state/review-disposition-state.json` when it exists.
6. Remove `codeInfoStatus/flow-state/minor-review-fix-result.json` when it exists.
7. Re-check whether the two active-loop scratch files are now absent and whether any archive file matches the preserved finding-only blockers exactly.

</reasoning_steps>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop and say the current-plan handoff must be regenerated.
- If one of the scratch state files cannot be removed because of filesystem or permission issues, stop and report the exact file that could not be reset.
- If the archived operational-block file cannot be written, updated, or removed when needed, stop and report the exact file problem.
- If the step would need to modify anything outside those two active-loop scratch state files plus the archived operational-block file, stop and report that the reset scope was exceeded.

</failure_modes>

<output_contract>

- Remove only:
  - `codeInfoStatus/flow-state/review-disposition-state.json`
  - `codeInfoStatus/flow-state/minor-review-fix-result.json`
- Preserve only:
  - `codeInfoStatus/flow-state/archived-operational-blocks.json` when finding-only operational blockers from the immediately preceding review loop must be requeued on the next fresh classifier pass
- Report whether each file was removed or was already absent.
- Report whether any finding-only operational blockers were preserved for one fresh rerun or whether the archive file was removed as stale.
- Report that the next classifier pass must build fresh state for the new active review loop from the current review handoff and artifacts, including a fresh `review_cycle_id` in the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`, then append any preserved finding-only blocked minors back into the active minor queue if those findings still exist in the fresh artifacts.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read first.
- Confirm no canonical plan file was edited.
- Confirm no review artifacts were edited.
- Confirm `review-disposition-state.json` is absent after this step.
- Confirm `minor-review-fix-result.json` is absent after this step.
- Confirm `archived-operational-blocks.json` exists only when finding-only blocked minors from the immediately preceding loop were preserved for the next fresh rerun.
- Confirm this step did not commit or push.

</verification_loop>
