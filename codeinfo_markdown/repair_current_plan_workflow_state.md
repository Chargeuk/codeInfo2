# Goal

Repair story-scope flow state for the plan already selected by `codeInfoStatus/flow-state/current-plan.json`, without discovering, selecting, or switching to another plan.

<critical_rules>

- Re-read `codeInfoStatus/flow-state/current-plan.json` before making any repair decision and retain its exact `plan_path` as the immutable selected-plan identity for this flow.
- Never run next-plan discovery or current-story selection rules.
- Never replace `plan_path` with another plan, even when the current handoff or plan is complete, stale, missing, malformed, unreadable, or otherwise cannot be repaired safely.
- If the handoff does not provide a usable existing `plan_path`, report that current-plan-only repair cannot continue and make no plan-selection change.
- Run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` when the handoff provides a usable `plan_path`, and use its fresh JSON output as the source of truth for repair needs.
- This step repairs story scope only. It must not rebuild review-loop routing state.
- If no repair is needed, make no file changes and report a no-op.
- Use fresh disk reads and current Git state, not conversational memory.

</critical_rules>

<repair_rules>

1. Repair only facts associated with the exact stored `plan_path`, such as repository scope, branch ancestry hints, or matching-story branch state.
2. Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md` and use `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile story-scope` to refresh bounded scope for that stored plan.
3. If repository branches drifted, normalize them only to the story number of the stored plan. Never use branch repair as a reason to select another plan.
4. You may update `branched_from` and `additional_repositories` in `current-plan.json` when fresh facts for the same stored plan require it, but the exact `plan_path` value must remain unchanged.
5. If the stored plan or an in-scope repository is unavailable and cannot be repaired without selecting another plan, leave the handoff pointed at the same plan and report the unresolved condition. The surrounding flow must continue with best effort.
6. Ignore `review_state_repair_needed`; review routing has its own repair step.

</repair_rules>

<verification_loop>

- Re-read `codeInfoStatus/flow-state/current-plan.json` after any repair attempt.
- Confirm its `plan_path` is exactly the value captured at the start of this step.
- Re-run `python3 "$CODEINFO_ROOT/scripts/story_workflow_status.py"` when possible.
- Report what was repaired, what remains unresolved, and explicitly confirm that no different plan was selected.

</verification_loop>
