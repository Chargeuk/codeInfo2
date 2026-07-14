# Goal

Verify that the current review pass's accepted and ignored issue decisions were durably recorded in the canonical story plan before any minor review fix or task-up implementation begins, and repair one missing block idempotently when safe.

This is a bounded pre-fix recovery step. It runs immediately after `Record Review Issue Decisions In Plan` and immediately before the Minor Review Fix Path.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first and use only its stored `plan_path` and `additional_repositories` as plan selection and repository scope.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` and the exact stored review handoff after `current-plan.json`.
- Read and follow `$CODEINFO_ROOT/codeinfo_markdown/record_review_issue_decisions_in_plan.md` in full. Reuse its identity, current-pass source, section, idempotency, commit, and output contracts without weakening them.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` before deciding whether repair is needed.
- Do not implement findings, change their routing, create tasks, run proof, or push.
- Do not treat a genuine identity conflict as a clean no-findings result. Report the conflict and continue without an unsafe plan edit so the autonomous flow can retain visible incomplete review state.

</critical_rules>

<verification_and_recovery_rules>

1. Determine from the validated current-pass disposition state and artifacts whether the recorder contract requires a structured `## Code Review Findings` block.
2. If no accepted, ignored, rejected, or non-adopted current-pass item exists, make no edit and report a genuine no-decisions result.
3. If the exact current-pass structured block already exists once and satisfies the recorder contract, make no edit.
4. If a required current-pass block is missing or incomplete and identity is safe, apply `record_review_issue_decisions_in_plan.md` once in this step and commit only the canonical plan when it changes.
5. Re-open the bounded review-tasking packet after any repair and confirm the required block exists exactly once before returning.
6. Never append a duplicate current-pass block, recreate the retired terse summary, or alter an earlier review pass's block.
7. This pre-fix verifier must finish before the Minor Review Fix Path can consume any unresolved finding. Late task-up recovery remains only a final interrupted-execution safety net.

</verification_and_recovery_rules>

<output_contract>

- Report the plan path, review pass ID, whether decisions required a block, whether the block was already valid or repaired, and the plan commit SHA when repair created a commit.
- Finish without a plan edit only for a genuine no-decisions result, an already-valid current-pass block, or a reported identity conflict that makes an honest edit unsafe.

</output_contract>
