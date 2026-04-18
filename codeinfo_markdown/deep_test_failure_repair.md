# Goal

Perform a deep repair pass only for a live blocker caused by automated-proof test failure, and keep the plan honest without adding no-op noise.

<task>

Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
Read the stored current-plan handoff and use only that scope for this step.
Read `codeInfoStatus/flow-state/current-task.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/current-task.json`, and determine the bound task from what it contains rather than depending on an exact JSON shape.
Re-open the exact plan file from disk before doing anything else.
Check whether the current selected task has a live blocker caused by automated-proof test failure.
If there is no such blocker, stop immediately, make no edits, and do not append any implementation note.
If there is such a blocker, perform a deeper diagnose-fix-rerun pass until the failing proof passes or the failure is honestly still blocked.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Re-open the exact relative `plan_path` from disk before starting.
- If `current-task.json` does not clearly resolve a task for this loop pass, stop and say the task handoff must be regenerated before deep automated-proof repair continues.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<blocker_detection_rules>

- Before deciding whether this step applies, read `$CODEINFO_ROOT/codeinfo_markdown/shared/blocker-detection.md`.
- Determine the bound task number from `current-task.json`, then run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <that-number>`.
- Use the parser output, not visual scanning, as the source of truth for live blocker state.
- Treat only `selected_task.live_blockers` as active blockers for this step.
- If `selected_task` is null or `selected_task.live_blockers` is empty, this step is a no-op: state that no live blocker is present, make no edits, and do not append any implementation note.
- If a live blocker exists but it is clearly not about automated-proof test failure, state that this deep repair step is not applicable, make no edits, and do not append any implementation note.

</blocker_detection_rules>

<applicability_rules>

- This step is only for blockers caused by failing automated-proof test or build wrappers named in the task's `Testing` section.
- Do not use this step to solve generic implementation blockers, missing prerequisites, vague task shape, manual-testing findings, or planning contradictions. Those belong to planner repair.
- Despite the agent type used to run this prompt, do not perform browser/manual validation here. This is a deep automated-proof repair pass, not a manual testing pass.

</applicability_rules>

<repair_rules>

- Re-read the selected task's full text, especially `Subtasks`, `Testing`, `Task Exit Criteria`, and `Implementation Notes`, before changing code or the plan.
- Follow the repository's wrapper-first workflow and begin from the failing task-owned proof step or the smallest wrapper-backed rerun needed to diagnose the failure honestly.
- Inspect the concrete failure evidence first: the failing assertion, error, stack, wrapper summary, or saved log path.
- Perform a deeper analysis than the normal automated-proof step by tracing the failure to the owning code, test, config, harness, or contract before deciding what to change.
- Prefer fixing the underlying task-owned implementation or proof rather than papering over the failure with a weaker assertion or broader timeout unless the evidence shows that is the honest repair.
- Use targeted wrapper reruns for diagnosis when repository guidance supports them, then rerun the original task-listed proof step honestly after each repair checkpoint.
- Continue the diagnose-fix-rerun cycle while there is a credible in-scope next fix and the failure remains task-owned.
- If the repair requires explicit research on a library or framework contract, use official documentation and current repository evidence to confirm the intended behavior before changing code.

</repair_rules>

<section_ownership_rules>

- Any task structure added or rewritten by this step MUST follow this section contract:
  - `Subtasks` for implementation work, proof-authoring work, documentation updates, config changes, and explicitly allowed code-hygiene work that the coding agent can complete before formal proof runs.
  - `Testing` for automated proof execution only.
  - `Manual Testing Guidance` for optional, non-blocking guidance for the later `manual_testing_agent` pass only when useful.
- Do not add manual-testing checklist items in `Subtasks` or `Testing`.
- Do not add subtasks that depend on future screenshots, logs, later manual-testing-agent reruns, or later automated-proof outputs in order to become complete.
- Do not add subtasks that tell the coding agent to perform browser validation, Playwright MCP validation, screenshot review, or other manual-testing-agent proof work.

</section_ownership_rules>

<plan_update_rules>

- If there is no applicable live blocker, do not edit the plan and do not append a no-op note.
- If you resolve the failing-test blocker, retire the live `**BLOCKER**` note and preserve the outcome as `**RESOLVED ISSUE**` or `**BLOCKING ANSWER**`, whichever is the honest fit for the existing task history.
- Keep the blocker-history update concise and avoid appending repeated essays when the same failure mode has already been documented.
- Mark testing steps complete only when they honestly pass.
- Mark any proof-owned subtasks complete immediately when the passing proof now honestly closes them.
- If the deeper pass discovers new in-scope work that must be tracked explicitly, add only:
  - concise unchecked implementation or proof-authoring subtasks; or
  - concise unchecked automated-only testing steps.
- If optional later browser-visible, runtime-visible, or otherwise externally observable validation would still help after the repair, place that only in `Manual Testing Guidance`.
- Do not append a note that only says this step ran. Every new note must capture a real repair, a real proof result, or an honest remaining blocker.

</plan_update_rules>

<stop_conditions>

- Stop with no edits when there is no live blocker or no applicable failing-test blocker.
- Stop with a resolved state when the formerly failing proof now passes and the task history has been updated honestly.
- Stop with a preserved blocker only when the failure now clearly depends on missing prerequisite capability, task-shape contradiction, out-of-scope contract change, or an exhausted bounded repair path with no credible next in-scope fix.
- Do not preserve a live blocker for an ordinary failing test unless you can explain why deeper diagnosis and repair still could not close it honestly.

</stop_conditions>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. whether an applicable live blocker existed;
2. whether this step made no changes or performed deep repair;
3. which proof failed and what was fixed, if any;
4. whether the blocker was resolved or remains honestly blocked.

</output_contract>

<verification_loop>

Before finishing:

- confirm you re-read the plan from disk;
- confirm you re-read `current-task.json` from disk and used the bound task from it;
- confirm you used `selected_task.live_blockers` as the blocker source of truth;
- confirm you made no edits and appended no note when no applicable live blocker existed;
- confirm you kept this step limited to automated-proof test-failure blockers rather than generic task-shape repair;
- confirm you performed a real diagnose-fix-rerun cycle before leaving an ordinary failing test blocked;
- confirm any resolved blocker was retired from live blocker state honestly;
- confirm you did not add manual-testing checklist items in `Subtasks` or `Testing`;
- confirm you did not add subtasks that depend on future manual-testing-agent or automated-proof outputs;
- confirm any added `Testing` steps remain automated-only;
- confirm any added `Manual Testing Guidance` is optional and non-blocking;
- confirm tracked changes were committed if any were made.

</verification_loop>
