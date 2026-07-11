# Goal

Reload the current-task handoff from disk and load only the bound task's requested sections before a task-oriented flow step continues.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- If the immediately preceding step just ran `python3 "$CODEINFO_ROOT/scripts/select_current_task.py"`, treat that selector's stdout JSON as the primary just-written task result before reading the file back from disk.
- Read `codeInfoStatus/flow-state/current-task.json` from disk next, for example with `cat codeInfoStatus/flow-state/current-task.json`.
- When selector stdout JSON is available, treat the `current-task.json` disk read as a persistence check and stop if the two disagree.
- Determine the meaning of `current-task.json` from what it contains rather than depending on an exact JSON shape.
- If `current-task.json` clearly resolves a task, determine that bound task number, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, and use `plan_sections.py --task-number <number>` with the sections or profile required by the calling prompt.
- Use a fresh `plan_sections.py` result for the bound task before relying on its details, because another agent may have edited it.
- If `current-task.json` is missing, unreadable, or no longer clearly resolves a task, stop and say the current task handoff must be regenerated, unless the current step explicitly defines how to handle a repair-needed fallback state instead.
- If `current-task.json` says the story is complete, stop and say no task is available for this step, unless the current step explicitly owns story-complete handling.

</critical_rules>

<verification_loop>

- confirm you read `current-plan.json` from disk first;
- confirm you used selector stdout JSON first when the selector step just produced it;
- confirm you read `current-task.json` from disk after that;
- confirm you treated the disk reread as a persistence check when selector stdout JSON was available;
- confirm you loaded fresh bounded task sections after reading the handoff files when a task was resolved;
- confirm you used the bound task content returned by `plan_sections.py` rather than relying on memory;
- confirm you did not invent a different task when the handoff was missing, unreadable, unresolved, or story-complete unless the current step explicitly told you how to handle that exception.

</verification_loop>
