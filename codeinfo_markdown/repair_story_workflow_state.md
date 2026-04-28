# Goal

Repair broken story-scope flow state for the current story so downstream steps can continue using fresh, trustworthy handoff data.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk when it exists.
- Run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` and use its JSON output as the source of truth for what needs repair.
- This step repairs story scope only. It must not rebuild review-loop routing state.
- If the status output says no repair is needed, make no file changes and report a no-op.
- Do not switch to a different story unless the current handoff is missing or unusable and there is no safe way to preserve the same selected story.
- Use fresh disk reads and current git state, not conversational memory.

</critical_rules>

<repair_rules>

1. When `repair_action` is `regenerate_current_plan_handoff`, recreate `codeInfoStatus/flow-state/current-plan.json` using the same story when it can still be identified safely. If the existing handoff is missing or malformed beyond repair, rebuild the handoff using the current in-progress story selection rules.
2. When `repair_action` is `refresh_current_plan_handoff`, re-read the canonical plan and refresh `current-plan.json` in place so `plan_path`, `additional_repositories`, and branch ancestry hints match the current on-disk truth.
3. When `repair_action` is `normalize_scope_then_refresh_handoff`, first normalize the active story scope against the current branch and current plan, then refresh `current-plan.json` so the selected story and repository scope line up again.
4. Ignore `review_state_repair_needed` in this step. Review-loop routing repair belongs to the dedicated review-state repair step.
5. Never pretend broken state is the same as incomplete story work. The result of this step must be repaired story scope or an explicit report that safe repair was not possible.

</repair_rules>

<verification_loop>

- Re-run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` after the repair attempt.
- Confirm `repair_needed` is false before leaving this step.
- Report which handoff or scope files were repaired, refreshed, rebuilt, or left unchanged.

</verification_loop>
