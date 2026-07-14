# Goal

Repair broken review-loop flow state for the current story so review exit routing can rely on fresh, trustworthy handoff and review disposition data.

<critical_rules>

- Treat canonical seven-digit story ID, review session, review pass, parent execution, HEAD, and comparison base as non-inferable identity. Do not guess between alternate prefixes or latest artifacts. Preserve a blocker state unless one exact server-validated session can be selected deliberately.

- Run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` before making any repair decision, and use its JSON output as the source of truth for what needs repair when it returns usable output.
- Only if manual fallback is required may you inspect `codeInfoStatus/flow-state/current-plan.json` or `codeInfoStatus/flow-state/review-disposition-state.json` directly to determine repair state.
- Perform a manual fallback only if `story_workflow_status.py` is missing, unreadable, cannot be invoked because Python is unavailable, exits before producing usable JSON, or returns empty or malformed output.
- Do not use manual fallback to override valid script output, including a valid `repair_needed: false` or `review_state_repair_needed: false` result.
- Repair story scope first when `repair_needed` is true.
- Rebuild `codeInfoStatus/flow-state/review-disposition-state.json` when `review_state_repair_needed` is true after story scope has been repaired.
- If the status output says no repair is needed, make no file changes and report a no-op.
- Use fresh disk reads and current git state, not conversational memory.

</critical_rules>

<manual_fallback_rules>

- Only after a permitted script failure may you determine repair state manually from disk.
- In that manual fallback, first determine story-scope repair exactly as follows:
  - if `current-plan.json` is missing, unreadable, invalid, or lacks a usable current story or `plan_path`, treat story scope as `repair_needed: true` with `repair_action: regenerate_current_plan_handoff`;
  - otherwise, resolve `plan_path` against the current repository and require both `test -f <resolved-plan-path>` and `test -r <resolved-plan-path>` to verify only that the plan is a regular readable file; do not open its contents;
  - verify the current repository plus every additional repository in the handoff with `test -d <repository-path>` and `git -C <repository-path> rev-parse --is-inside-work-tree`; do not read plan content for these checks;
  - if the plan file or any scoped repository is missing, unreadable, or no longer a git repository, treat story scope as `repair_needed: true` with `repair_action: refresh_current_plan_handoff`;
  - if the scoped repositories still exist but any current branch no longer matches the handoff story number, treat story scope as `repair_needed: true` with `repair_action: normalize_scope_then_refresh_handoff`;
  - otherwise, treat story scope as `repair_needed: false`.
- Only if story scope is healthy may you assess review-state repair manually.
- Before rebuilding review-disposition state from review artifacts, require `current-review-base.json` and `current-review.json` to match exactly on canonical seven-digit `story_id`, `plan_path`, `review_session_id`, `review_pass_id`, `parent_execution_id`, `head_commit`, and `comparison_base_commit`. If either artifact is missing or any identity field is absent or mismatched, preserve the blocker and do not rebuild review state from those artifacts.
- In that review-state fallback:
  - if `review-disposition-state.json` is missing, unreadable, invalid JSON, lacks a usable `story_number` or `plan_path`, has a mismatched story or plan, lacks a valid `review_cycle_id`, or contains non-boolean review flags, treat the result as `review_state_repair_needed: true` and rebuild the review disposition state;
  - otherwise, treat the result as `review_state_repair_needed: false`.
- If the script failed and the on-disk state still does not let you distinguish safely between those repair outcomes, stop and report the unresolved script failure instead of guessing.

</manual_fallback_rules>

<repair_rules>

1. When `repair_action` is `regenerate_current_plan_handoff`, recreate `codeInfoStatus/flow-state/current-plan.json` using the current story when it can be identified safely.
2. When `repair_action` is `refresh_current_plan_handoff`, refresh `current-plan.json` in place from the canonical plan and current repository scope.
3. When `repair_action` is `normalize_scope_then_refresh_handoff`, normalize story scope first and then refresh the handoff.
4. After story scope is healthy, rebuild `codeInfoStatus/flow-state/review-disposition-state.json` from the current review handoff and review artifacts when `review_state_repair_needed` is true only after their exact identity match has been validated; otherwise preserve the blocker state.
5. Treat `review_state_story_mismatch` or `review_state_plan_mismatch` as stale review state for a different scope. Rebuild the file instead of trusting or partially preserving it.
6. When rebuilding review state, preserve the active story and canonical plan and mint or preserve the correct `review_cycle_id` for the active review loop using the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.

</repair_rules>

<verification_loop>

- Re-run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` after the repair attempt.
- Confirm `repair_needed` is false before leaving this step.
- Confirm `review_state_repair_needed` is false before leaving this step.
- Report which files were repaired, refreshed, rebuilt, or left unchanged.

</verification_loop>
