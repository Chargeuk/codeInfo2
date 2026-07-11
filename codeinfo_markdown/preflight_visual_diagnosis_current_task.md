# Goal

Before implementation starts on the current task, inspect the live supported UI surface for that task and, only when the task truly owns visual or interaction-facing work, refine the current task in the plan so its existing implementation guidance describes the real visual work concretely enough for a weak implementation agent to execute it correctly without further human interpretation.

<critical_rules>

- Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` first.
- If the immediately preceding step just ran `python3 "$CODEINFO_ROOT/scripts/select_current_task.py"`, treat that selector's stdout JSON as the primary just-written task result before reading the file back from disk.
- Read `codeInfoStatus/flow-state/current-task.json` after `current-plan.json`.
- When selector stdout JSON is available, treat the `current-task.json` disk read as a persistence check and stop if the two disagree.
- Determine the meaning of `current-task.json` from what it contains rather than depending on an exact JSON shape.
- Run `python3 "$CODEINFO_ROOT/scripts/check_current_task_handoff.py"` and use its JSON output to validate whether the persisted handoff is currently valid.
- In this step, a `validator-cleared bound task` means a task that `current-task.json` clearly resolves and that `check_current_task_handoff.py` does not invalidate.
- If `current-task.json` clearly resolves a task and `check_current_task_handoff.py` does not invalidate the persisted handoff, use that persisted task as the authoritative bound task for this step.
- If `check_current_task_handoff.py` reports an `active_selected_task`, you may mention it as freshness or diagnostic context, but do not let it override a clearly resolved persisted task from `current-task.json`.
- Treat the stored `plan_path` and `additional_repositories` as the primary scope for this step.
- Expand beyond that primary scope only when needed to inspect a supporting repository for honest visual diagnosis, and report any such scope expansion in the response.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile manual-proof --task current` before deciding what to inspect or edit.
- If a `validator-cleared bound task` was resolved, use the complete requested sections in the bounded manual-proof packet, including:
  - `Overview`
  - `Non-Goals`
  - `Task Exit Criteria`
  - `Documentation Locations`
  - `Task Design Packet`
  - `Subtasks`
  - `Manual Testing Guidance`
- If a `validator-cleared bound task` was resolved, treat every listed subtask as in scope for this refinement pass.
- Do not rewrite task ownership.
- Do not create a different candidate task.
- Do not narrow task scope.
- Do not mark subtasks complete.
- Do not implement code in this step.
- Do not run implementation tests in this step.
- This is a plan-refinement step, not an implementation step.

</critical_rules>

<early_exit_rules>

- If `current-task.json` says the story is complete, stop further investigation, but still return the full `output_contract`.
- For that story-complete case:
  - state `no task is available for this step because the story is complete`
  - set `Applicability` to `story complete`
  - in `Task`, state explicitly that no bound task was available because the story is complete
  - fill every remaining required output-contract section with `not run` or `n/a` as appropriate
- If `current-task.json` does not clearly resolve a bound task for any reason other than story complete, or if `check_current_task_handoff.py` shows the persisted handoff is no longer valid, stop further investigation, but still return the full `output_contract`.
- For that stale-handoff case:
  - state `current-task handoff is stale and must be regenerated`
  - set `Applicability` to `current-task handoff stale`
  - in `Task`, state explicitly that no `validator-cleared bound task` was available because the current-task handoff was stale
  - fill every remaining required output-contract section with `not run` or `n/a` as appropriate
- If the bound task has no browser-visible, layout-visible, or otherwise visually inspectable surface of its own, stop further visual refinement work, but still return the full `output_contract`.
- For that visual-not-applicable case:
  - set `Applicability` to `visual refinement not applicable`
  - include in `Task` a one-sentence reason tied to the current task's own exit criteria
  - fill the remaining required output-contract sections honestly, using `not run` or `n/a` where appropriate
- Only use this early exit when the task truly has no visual or interaction-facing surface to inspect.
- Do not use the early exit just because the task is difficult, broad, or shared.

</early_exit_rules>

<scope_and_runtime_rules>

- Before using browser tools, read:
  - `AGENTS.md`
  - `README.md`
  - `codeinfo_markdown/repository_information.md` if it exists
- When the task has a visual surface, determine the supported startup path and proof surfaces from those files plus the active plan first.
- Unless those sources or fresher current repository evidence explicitly define a different supported path, use the supported main stack for this refinement:
  - `npm run compose:build`
  - `npm run compose:up`
- Verify the supported surfaces named by the active repository guidance before diagnosis.
- For this repository's default supported path, verify:
  - `http://localhost:5010/health`
  - `http://localhost:5001`
- If the stack was already running, treat it as stale unless freshness is explicitly proven from current repository evidence.
- If you started the stack in this step, leave it running unless repository guidance says otherwise.
- If the task's visible surface lives in a declared additional repository, you may inspect that repository too.
- Do not treat a supporting repository outside `additional_repositories` as a blocker by itself when honest diagnosis needs it.

</scope_and_runtime_rules>

<browser_tool_rules>

- Use Chrome DevTools MCP first for diagnosis:
  - pixel-level alignment
  - spacing and padding ownership
  - flex wrapping
  - clipping
  - z-index and layering
  - scroll-container ownership
  - visible control state
  - console and network sanity when directly relevant
- Use Playwright after diagnosis for:
  - clean desktop and mobile viewport confirmation
  - retained screenshots only when they materially help the refinement
- Prefer Playwright screenshots as kept artifacts for this step when screenshots are useful.
- Save any kept artifacts under `codeInfoTmp/manual-testing/<story-number>/<task-number>/` relative to the target repository that owns `plan_path`.
- Do not treat that artifact path as relative to `CODEINFO_ROOT`; use `CODEINFO_ROOT` only for harness-owned assets unless repository guidance explicitly tells you otherwise.
- If screenshot export is not honestly available, do not invent a saved path.

</browser_tool_rules>

<refinement_rules>

- Diagnose only what the current task owns.
- Use the task's `Non-Goals` to avoid drifting into later-task work.
- Read the current UI against the task's exact contract first, then against the story-level design references named by that task.
- If the current task is visual, update the current task in the plan so its implementation guidance reflects the actual visible work more concretely.
- Allowed edit targets inside the current task only:
  - `Overview`
  - `Task Exit Criteria`
  - `Subtasks`
  - `Manual Testing Guidance`
  - `Task Design Packet` only when a missing design/source reference is needed
  - `Implementation Notes` only to record that this preflight refinement happened
- Do not edit other tasks.
- Do not renumber tasks.
- Do not add blockers.
- Do not add testing checkboxes.
- Do not mark any checkbox complete.
- Do not add vague subtasks such as `investigate`, `debug`, or `review layout`.
- Convert visual findings into concrete implementation guidance:
  - exact files when known
  - exact components when known
  - exact layout seam when known
  - exact behavior mismatch when known
- Prefer sharpening existing subtasks over adding many new ones.
- Add a new subtask only when the current task truly lacks a necessary visual implementation step.
- De-duplicate against the existing task text.
- Preserve the existing task intent and scope.
- Do not rewrite the whole task unless the current wording is too vague to execute honestly.
- When a visible issue belongs to a later task, do not edit the current task to absorb it.
- If a current task subtask is too weak for a junior agent to implement from, rewrite that subtask into a concrete file-owning instruction.
- If the current task already describes the visual work concretely enough, do not make cosmetic plan edits just to say you changed something.

</refinement_rules>

<implementation_note_rule>

- If you refine the task text, add one concise `Implementation Notes` bullet at the end of the current task stating:
  - that a preflight visual refinement pass was run
  - which visible seams were clarified
  - that no code was changed in this step

</implementation_note_rule>

<output_contract>

Return a concise report with these exact sections:

1. `Task`
   - task number and title
   - or an explicit statement that no bound task was available because the story is complete
   - or an explicit statement that no `validator-cleared bound task` was available because the current-task handoff was stale
   - when `Applicability` is `visual refinement not applicable`, include the one-sentence reason tied to the current task's own exit criteria here

2. `Applicability`
   - one of:
     - `visual refinement applied`
     - `visual refinement not applicable`
     - `story complete`
     - `current-task handoff stale`

3. `Runtime`
   - whether you restarted the main stack
   - whether health and app checks passed
   - whether the stack was left running

4. `Surfaces Inspected`
   - desktop
   - mobile
   - any supporting repository surface if one was needed
   - note any scope expansion beyond the stored `plan_path` and `additional_repositories`

5. `Plan Changes`
   - list exactly what changed in the current task
   - include which sections were updated
   - include which subtasks were sharpened or added

6. `Key Visual Findings`
   - a flat list of the task-owned visual mismatches that drove the refinement
   - each item must include:
     - the visible issue
     - why it conflicts with the task contract
     - the likely owning file(s) or component seam reflected in the updated task text

7. `Artifacts`
   - list any kept screenshots or support artifacts saved under the target repository's `codeInfoTmp/manual-testing/<story-number>/<task-number>/`
   - if none were kept, say so

8. `No-Code-Change Confirmation`
   - confirm that you did not edit code
   - confirm that you did not run implementation tests
   - confirm that you did not change task scope beyond sharpening the current task’s visual implementation guidance

</output_contract>

<verification_loop>

- Confirm you read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` first.
- Confirm you used the stored current-plan and current-task handoff.
- Confirm you ran `check_current_task_handoff.py`.
- Confirm you used the persisted task from `current-task.json` as the bound task only when it clearly resolved one and the validator did not invalidate the persisted handoff.
- Confirm you loaded a fresh bounded manual-proof packet.
- Confirm you treated every existing subtask as in scope when a `validator-cleared bound task` was resolved.
- Confirm you returned the full `output_contract` even when an early-exit condition applied.
- Confirm you reported `story complete` separately from `current-task handoff stale` when `current-task.json` indicated that no task was available because the story was complete.
- Confirm you exited early without plan edits if the task had no visual surface.
- Confirm you used Chrome DevTools first for diagnosis and Playwright for retained screenshots when useful.
- Confirm you treated stored `plan_path` and `additional_repositories` as primary scope and disclosed any scope expansion beyond them.
- Confirm you treated artifact paths as relative to the target repository that owns `plan_path`, not to `CODEINFO_ROOT`.
- Confirm you edited only the current task.
- Confirm you did not change task ownership or scope.
- Confirm you did not mark any checklist item complete.
- Confirm you did not add vague subtasks.
- Confirm you did not edit code.
- Confirm you did not run implementation tests.

</verification_loop>
