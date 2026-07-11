# Goal

Repair broken story-scope flow state for the current story so downstream steps can continue using fresh, trustworthy handoff data.

<critical_rules>

- Run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` before making any repair decision, and use its JSON output as the source of truth for what needs repair when it returns usable output.
- Only if manual fallback is required may you inspect `codeInfoStatus/flow-state/current-plan.json` directly to determine repair state.
- Perform a manual fallback only if `story_workflow_status.py` is missing, unreadable, cannot be invoked because Python is unavailable, exits before producing usable JSON, or returns empty or malformed output.
- Do not use manual fallback to override valid script output, including a valid `repair_needed: false` result.
- This step repairs story scope only. It must not rebuild review-loop routing state.
- If the status output says no repair is needed, make no file changes and report a no-op.
- Do not switch to a different story unless the current handoff is missing or unusable and there is no safe way to preserve the same selected story.
- Use fresh disk reads and current git state, not conversational memory.

</critical_rules>

<manual_fallback_rules>

- Only after a permitted script failure may you determine story-scope repair manually from disk.
- In that manual fallback:
  - if `current-plan.json` is missing, unreadable, invalid, or lacks a usable current story or `plan_path`, treat the result as `repair_needed: true` with `repair_action: regenerate_current_plan_handoff`;
  - otherwise, resolve `plan_path` against the current repository and use `test -r <resolved-plan-path>` to verify only that the plan exists and is readable; do not open its contents;
  - verify the current repository plus every additional repository in the handoff with `test -d <repository-path>` and `git -C <repository-path> rev-parse --is-inside-work-tree`; do not read plan content for these checks;
  - if the plan file or any scoped repository is missing, unreadable, or no longer a git repository, treat the result as `repair_needed: true` with `repair_action: refresh_current_plan_handoff`;
  - if the scoped repositories still exist but any current branch no longer matches the handoff story number, treat the result as `repair_needed: true` with `repair_action: normalize_scope_then_refresh_handoff`;
  - if none of those repair conditions apply, treat the result as `repair_needed: false`.
- If the script failed and the on-disk state still does not let you distinguish safely between those repair actions, stop and report the unresolved script failure instead of guessing.

</manual_fallback_rules>

<repair_rules>

1. When `repair_action` is `regenerate_current_plan_handoff`, recreate `codeInfoStatus/flow-state/current-plan.json` using the same story when it can still be identified safely. If the existing handoff is missing or malformed beyond repair, rebuild the handoff using the current in-progress story selection rules.
2. When `repair_action` is `refresh_current_plan_handoff`, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile story-scope`, and refresh `current-plan.json` so `plan_path`, `additional_repositories`, and branch ancestry hints match that bounded on-disk truth.
3. When `repair_action` is `normalize_scope_then_refresh_handoff`, first normalize the active story scope against the current branch and current plan, then refresh `current-plan.json` so the selected story and repository scope line up again.
4. Ignore `review_state_repair_needed` in this step. Review-loop routing repair belongs to the dedicated review-state repair step.
5. Never pretend broken state is the same as incomplete story work. The result of this step must be repaired story scope or an explicit report that safe repair was not possible.

</repair_rules>

<verification_loop>

- Re-run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` after the repair attempt.
- Confirm `repair_needed` is false before leaving this step.
- Report which handoff or scope files were repaired, refreshed, rebuilt, or left unchanged.

</verification_loop>
