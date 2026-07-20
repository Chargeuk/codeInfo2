# Goal

Perform a deep repair pass only for a live implementation blocker on the bound current task, and keep the plan honest without adding no-op noise.

<critical_rules>

- When repair requires a fresh `two_phase_review_cycle`, use `npm run review:cycle:summary -- --working-folder <repository-path>` and wait for its terminal result. Do not replace it with direct HTTP 202 polling, do not impose an arbitrary poll limit, and do not stop Compose while the wrapper reports an active run.

- Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/current-task.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/current-task.json`, and determine the bound task from what it contains rather than depending on an exact JSON shape.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile blocker-repair --task current` before doing anything else.
- Use fresh disk reads and current git state, not conversational memory.
- If `current-task.json` does not clearly resolve one task for this loop pass, stop and say the task handoff must be regenerated before deep implementation repair continues.
- Do not rediscover a different story or a different task independently.
- Do not rewrite task order, split tasks, renumber the plan, or perform planner-style story repair in this step.

</critical_rules>

<exact_step_order>

1. Read `current-plan.json` from disk.
2. Read `current-task.json` from disk and determine the exact bound task.
3. Use the fresh bounded blocker-repair packet for the bound task, especially `Subtasks`, `Task Exit Criteria`, and `Implementation Notes`.
4. Run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <bound-task-number>`.
5. If there is no live blocker for that bound task, stop immediately, make no edits, and do not append any implementation note.
6. If there is a live blocker but it is clearly not an implementation-local blocker for the bound task, stop immediately, preserve the blocker unchanged, and do not append a no-op note.
7. If there is an applicable implementation blocker, perform a bounded deeper diagnose-fix-verify pass on the bound task only.
8. If that deeper pass resolves the blocker, retire the live `**BLOCKER**` note honestly and record the outcome.
9. If that deeper pass does not resolve the blocker, preserve a live blocker only when the task is still honestly blocked after the deeper pass.

</exact_step_order>

<applicability_rules>

- This step is only for a live blocker caused by implementation-local work on the currently bound task.
- Applicable examples include:
  - task-owned code defects;
  - task-owned config defects;
  - task-owned proof-authoring or wrapper-invocation mistakes that are part of implementing the current task;
  - narrow repository or harness issues that are still realistically repairable without changing task ownership or plan shape.
- Do not use this step for:
  - missing prerequisite tasks;
  - wrong task ordering;
  - vague or oversized task shape;
  - manual-testing findings;
  - contradictions that require planner repair;
  - blockers whose honest fix is to split, reorder, or re-own tasks.
- Do not perform manual testing in this step.

</applicability_rules>

<repair_rules>

- Before deciding whether the blocker is real, read `$CODEINFO_ROOT/codeinfo_markdown/shared/blocker-detection.md`.
- Use `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <bound-task-number>` as the source of truth for blocker state.
- Treat only `selected_task.live_blockers` as active blockers for this step.
- If `selected_task` is null or `selected_task.live_blockers` is empty, this step is a no-op: make no edits and append no note.
- Inspect the concrete blocker evidence first: the exact blocker text, recent implementation notes, relevant code, wrapper output, or local command evidence.
- Perform a deeper analysis than the normal implementation step by tracing the blocker to the owning code, config, proof obligation, harness usage, or contract before deciding what to change.
- Prefer fixing the underlying task-owned issue rather than widening scope or writing more blocker prose.
- Continue the diagnose-fix-verify cycle while there is a credible in-scope next fix and the blocker remains task-owned.
- Use the minimum honest verification needed to confirm the blocker repair. Do not run the full task `Testing` section in this step unless that exact proof is the only honest way to verify the implementation blocker is gone.
- If you use a narrow verification command in this step, record only the honest result it proved and leave the later full automated-proof pass to run the task's listed testing gates.
- If the repair requires external contract confirmation, use current official documentation and repository evidence before changing code.
- When a blocker concerns a missing `$CODEINFO_ROOT` asset or runtime mapping, inspect the Compose file named by `CODEINFO_RUNTIME_COMPOSE_FILE` and the relevant Dockerfile before classifying it as external. A missing mapping in the active checked-in Compose file is repository-owned config work when the current task permits that repair; another Compose variant is not evidence that the active runtime is correctly provisioned.
- Implement an in-scope checked-in Compose repair when possible, but never stop or restart `compose:local` from this step. Record the required later container recreation as a runtime handoff rather than claiming the current container changed immediately.

</repair_rules>

<section_ownership_rules>

- Any task structure added or rewritten by this step MUST follow this section contract:
  - `Subtasks` for implementation work, proof-authoring work, documentation updates, config changes, and explicitly allowed code-hygiene work that the coding agent can complete before formal proof runs.
  - `Testing` for automated proof execution only.
  - `Manual Testing Guidance` for optional, non-blocking guidance for the later `manual_testing_agent` pass only when useful.
- Do not add manual-testing work to `Subtasks` or `Testing`.
- Do not add subtasks that run automated proof commands or that depend on later screenshots, logs, manual-testing-agent reruns, or other future proof outputs in order to become complete.

</section_ownership_rules>

<plan_update_rules>

- If there is no applicable live blocker, do not edit the plan and do not append a no-op note.
- If you resolve the blocker, retire the live `**BLOCKER**` note and preserve the outcome as `**RESOLVED ISSUE**` or `**BLOCKING ANSWER**`, whichever is the honest fit for the task history.
- Keep blocker-history updates concise and avoid appending repeated essays when the same failure mode has already been documented.
- If the deeper pass discovers new in-scope implementation work that must be tracked explicitly, add only concise unchecked implementation or proof-authoring subtasks to the same task before continuing.
- Do not append a note that only says this step ran. Every new note must capture a real repair, a real proof result, or an honest remaining blocker.
- Do not leave the task blocked if the deeper pass actually repaired the owning issue.

</plan_update_rules>

<stop_conditions>

- Stop with no edits when there is no live blocker or no applicable implementation blocker.
- Stop with a resolved state when the owning issue is repaired and the blocker history has been updated honestly.
- Stop with a preserved blocker only when the failure now clearly depends on missing prerequisite capability, out-of-scope contract contradiction, planner-owned task-shape problems, or an exhausted bounded repair path with no credible next in-scope fix.
- Do not preserve a live blocker for an ordinary in-scope implementation issue unless you can explain why the deeper pass still could not close it honestly.

</stop_conditions>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. whether an applicable live implementation blocker existed;
2. whether this step made no changes or performed deep repair;
3. what was fixed, if anything;
4. whether the blocker was resolved or remains honestly blocked.

</output_contract>

<verification_loop>

- confirm you used a fresh bounded blocker-repair packet;
- confirm you re-read `current-task.json` from disk and used the bound task from it;
- confirm you used `selected_task.live_blockers` as the blocker source of truth;
- confirm you made no edits and appended no note when no applicable live blocker existed;
- confirm you kept this step limited to implementation-local blocker repair rather than planner-style task rewriting;
- confirm you performed a real diagnose-fix-verify cycle before leaving an ordinary in-scope issue blocked;
- confirm any resolved blocker was retired from live blocker state honestly;
- confirm any newly added subtasks stayed within implementation, proof-authoring, documentation, config, or explicitly allowed code-hygiene work;
- confirm you did not add manual-testing work to `Subtasks` or `Testing`;
- confirm you did not add subtasks that run automated proof commands or depend on future manual-testing-agent or automated-proof outputs;
- confirm tracked changes were committed if any were made.

</verification_loop>
