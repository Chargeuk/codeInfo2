# Goal

Reload the current-task handoff from disk and re-open the bound task from the plan before a task-oriented flow step continues.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/current-task.json` from disk next, for example with `cat codeInfoStatus/flow-state/current-task.json`.
- Determine the meaning of `current-task.json` from what it contains rather than depending on an exact JSON shape.
- If `current-task.json` clearly resolves a task, determine that bound task number, then re-open the exact `plan_path` from disk with explicit shell reads such as `sed`, `cat`, or `rg`.
- After reopening the plan, re-read the bound task from disk before relying on its details, because another agent may have edited it.
- If `current-task.json` is missing, unreadable, or no longer clearly resolves a task, stop and say the current task handoff must be regenerated, unless the current step explicitly defines how to handle a repair-needed fallback state instead.
- If `current-task.json` says the story is complete, stop and say no task is available for this step, unless the current step explicitly owns story-complete handling.

</critical_rules>

<verification_loop>

- confirm you read `current-plan.json` from disk first;
- confirm you read `current-task.json` from disk after that;
- confirm you re-opened the plan from disk after reading the handoff files when a task was resolved;
- confirm you re-read the bound task from the current plan file rather than relying on memory;
- confirm you did not invent a different task when the handoff was missing, unreadable, unresolved, or story-complete unless the current step explicitly told you how to handle that exception.

</verification_loop>
