# Goal

Before implementation starts on the current task, inspect the live supported UI surface for that task and, only when the task truly owns visual or interaction-facing work, refine the current task in the plan so its existing implementation guidance describes the real visual work concretely enough for a weak implementation agent to execute it correctly without further human interpretation.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Read `codeInfoStatus/flow-state/current-task.json` after `current-plan.json`.
- Run `python3 "$CODEINFO_ROOT/scripts/check_current_task_handoff.py"` and use its `active_selected_task` as the authoritative bound task.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact relative `plan_path` from disk before deciding what to inspect or edit.
- Read the bound task's full task block from the plan, including:
  - `Overview`
  - `Non-Goals`
  - `Task Exit Criteria`
  - `Documentation Locations`
  - `Task Design Packet`
  - `Subtasks`
  - `Manual Testing Guidance`
- Treat every listed subtask as in scope for this refinement pass.
- Do not rewrite task ownership.
- Do not create a different candidate task.
- Do not narrow task scope.
- Do not mark subtasks complete.
- Do not implement code in this step.
- Do not run implementation tests in this step.
- This is a plan-refinement step, not an implementation step.

</critical_rules>

<early_exit_rules>

- If `check_current_task_handoff.py` does not clearly resolve an active task, stop and report `current-task handoff is stale and must be regenerated`.
- If the bound task has no browser-visible, layout-visible, or otherwise visually inspectable surface of its own, stop early and report:
  - `visual refinement not applicable`
  - a one-sentence reason tied to the current task's own exit criteria
- Only use this early exit when the task truly has no visual or interaction-facing surface to inspect.
- Do not use the early exit just because the task is difficult, broad, or shared.

</early_exit_rules>

<scope_and_runtime_rules>

- Before using browser tools, read:
  - `AGENTS.md`
  - `README.md`
  - `codeinfo_markdown/repository_information.md` if it exists
- When the task has a visual surface, use the supported main stack for this refinement:
  - `npm run compose:build`
  - `npm run compose:up`
- Verify the supported surfaces before diagnosis:
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
- Save any kept artifacts under `codeInfoTmp/manual-testing/<story-number>/<task-number>/`.
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

2. `Applicability`
   - either `visual refinement applied` or `visual refinement not applicable`

3. `Runtime`
   - whether you restarted the main stack
   - whether health and app checks passed
   - whether the stack was left running

4. `Surfaces Inspected`
   - desktop
   - mobile
   - any supporting repository surface if one was needed

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
   - list any kept screenshots or support artifacts saved under `codeInfoTmp/manual-testing/<story-number>/<task-number>/`
   - if none were kept, say so

8. `No-Code-Change Confirmation`
   - confirm that you did not edit code
   - confirm that you did not run implementation tests
   - confirm that you did not change task scope beyond sharpening the current task’s visual implementation guidance

</output_contract>

<verification_loop>

- Confirm you used the stored current-plan and current-task handoff.
- Confirm you ran `check_current_task_handoff.py`.
- Confirm you re-opened the plan from disk.
- Confirm you treated every existing subtask as in scope.
- Confirm you exited early without plan edits if the task had no visual surface.
- Confirm you used Chrome DevTools first for diagnosis and Playwright for retained screenshots when useful.
- Confirm you edited only the current task.
- Confirm you did not change task ownership or scope.
- Confirm you did not mark any checklist item complete.
- Confirm you did not add vague subtasks.
- Confirm you did not edit code.
- Confirm you did not run implementation tests.

</verification_loop>
