# Goal

Start a fresh active review-loop state before a standalone `Review Findings Disposition Loop` begins.

This step exists to prevent stale review-loop memory from an earlier completed review cycle from leaking into the next fresh review cycle for the same story.

The two-phase final-review flow owns this lifecycle natively through `initializeReviewCycle`; callers of that subflow must not run this LLM reset as a second owner.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Treat `codeInfoStatus/flow-state/review-disposition-state.json` and `codeInfoStatus/flow-state/minor-review-fix-result.json` as generated scratch state for one active review loop only.
- If either of those scratch files exists, remove it before the new review loop starts.
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
3. Remove `codeInfoStatus/flow-state/review-disposition-state.json` when it exists.
4. Remove `codeInfoStatus/flow-state/minor-review-fix-result.json` when it exists.
5. Re-check whether both files are now absent.

</reasoning_steps>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop and say the current-plan handoff must be regenerated.
- If one of the scratch state files cannot be removed because of filesystem or permission issues, stop and report the exact file that could not be reset.
- If the step would need to modify anything outside those two scratch state files, stop and report that the reset scope was exceeded.

</failure_modes>

<output_contract>

- Remove only:
  - `codeInfoStatus/flow-state/review-disposition-state.json`
  - `codeInfoStatus/flow-state/minor-review-fix-result.json`
- Report whether each file was removed or was already absent.
- Report that the next classifier pass must build fresh state for the new active review loop from the current review handoff and artifacts, including a fresh `review_cycle_id` in the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read first.
- Confirm no canonical plan file was edited.
- Confirm no review artifacts were edited.
- Confirm `review-disposition-state.json` is absent after this step.
- Confirm `minor-review-fix-result.json` is absent after this step.
- Confirm this step did not commit or push.

</verification_loop>
