# Goal

Repair broken review-loop flow state for the current story so review exit routing can rely on fresh, trustworthy handoff and review disposition data.

<critical_rules>

- Run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` and use its JSON output as the source of truth for what needs repair.
- Repair story scope first when `repair_needed` is true.
- Rebuild `codeInfoStatus/flow-state/review-disposition-state.json` when `review_state_repair_needed` is true after story scope has been repaired.
- If the status output says no repair is needed, make no file changes and report a no-op.
- Use fresh disk reads and current git state, not conversational memory.

</critical_rules>

<repair_rules>

1. When `repair_action` is `regenerate_current_plan_handoff`, recreate `codeInfoStatus/flow-state/current-plan.json` using the current story when it can be identified safely.
2. When `repair_action` is `refresh_current_plan_handoff`, refresh `current-plan.json` in place from the canonical plan and current repository scope.
3. When `repair_action` is `normalize_scope_then_refresh_handoff`, normalize story scope first and then refresh the handoff.
4. After story scope is healthy, rebuild `codeInfoStatus/flow-state/review-disposition-state.json` from the current review handoff and review artifacts when `review_state_repair_needed` is true.
5. Treat `review_state_story_mismatch` or `review_state_plan_mismatch` as stale review state for a different scope. Rebuild the file instead of trusting or partially preserving it.
6. When rebuilding review state, preserve the active story and canonical plan and mint or preserve the correct `review_cycle_id` for the active review loop using the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.

</repair_rules>

<verification_loop>

- Re-run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` after the repair attempt.
- Confirm `repair_needed` is false before leaving this step.
- Confirm `review_state_repair_needed` is false before leaving this step.
- Report which files were repaired, refreshed, rebuilt, or left unchanged.

</verification_loop>
