# Goal

Before implementation starts on the current task, inspect the live supported UI surface for that task, identify the concrete visual or interaction gaps that are already visible now, and map those gaps back to the most likely owning files and implementation seams without editing code or changing the plan.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Read `codeInfoStatus/flow-state/current-task.json` after `current-plan.json`.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact relative `plan_path` from disk before deciding what to inspect.
- Run `python3 "$CODEINFO_ROOT/scripts/check_current_task_handoff.py"` after reading the handoff files and treat its current JSON output as the authoritative current-task resolution for this step.
- Use the `active_selected_task` from that script output as the bound task when it is present.
- If that script reports `has_valid_current_task_handoff: false`, stop and say `current-task handoff is stale and must be regenerated`.
- Read the bound task's full task block from the plan, including:
  - `Overview`
  - `Non-Goals`
  - `Task Exit Criteria`
  - `Documentation Locations`
  - `Task Design Packet`
  - `Subtasks`
  - `Manual Testing Guidance`
- Treat every listed subtask as in scope for this diagnosis pass.
- Do not rewrite the plan, do not propose narrowing task scope, and do not mark any subtask as out of scope.
- Do not make file changes in this step.
- Do not run implementation tests in this step.
- This is a diagnosis-and-mapping pass only.

</critical_rules>

<early_exit_rules>

- If `current-task.json` does not clearly resolve a task and the handoff-validation script does not provide one, stop and say `current-task handoff is stale and must be regenerated`.
- If the bound task has no browser-visible, layout-visible, or otherwise visually inspectable surface of its own, stop early and return:
  - `visual diagnosis not applicable`
  - a one-sentence reason tied to the current task's own exit criteria
- Only use this early exit when the task truly has no visual surface to inspect.
- Do not use the early exit just because the task is hard, incomplete, or spans shared logic.

</early_exit_rules>

<scope_and_runtime_rules>

- Before using browser tools, read:
  - `AGENTS.md`
  - `README.md`
  - `codeinfo_markdown/repository_information.md` if it exists
- Use the supported main stack for this diagnosis when the task has a browser-visible surface:
  - `npm run compose:build`
  - `npm run compose:up`
- Verify the supported surfaces before diagnosis:
  - `http://localhost:5010/health`
  - `http://localhost:5001`
- If the stack was already running, treat it as stale unless freshness is explicitly proven from current repository evidence.
- If you started the stack in this step, leave it running unless repository guidance or the user says otherwise.
- If the task's visible proof surface lives in a declared additional repository, you may inspect that repository too.
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
  - basic console and network sanity
- Use Playwright after diagnosis for:
  - clean desktop and mobile viewport confirmation
  - retained screenshots
  - simple interaction confirmation
- Prefer Playwright screenshots as the kept proof images for this step.
- When screenshots are kept, save them under `codeInfoTmp/manual-testing/<story-number>/<task-number>/` with deterministic names such as:
  - `diagnosis-01-desktop-current.png`
  - `diagnosis-02-mobile-current.png`
  - `support-visual-diagnosis.json`
- If Playwright output is not directly host-visible, record that honestly and keep the diagnosis text-only rather than inventing a fake saved path.

</browser_tool_rules>

<diagnosis_rules>

- Diagnose only what the current task owns.
- Use the task's `Non-Goals` to avoid drifting into later-task work.
- Read the current UI against the task's exact contract first, then against the story-level design references named by that task.
- For each visible issue you identify:
  - state the issue plainly
  - state why it violates the current task's own contract
  - name the most likely owning file or files
  - name the most likely component seam
  - describe the likely kind of change needed
- Be concrete about likely seams, for example:
  - page adapter
  - shared shell wrapper
  - footer primitive
  - popover component
  - mobile dialog component
  - state resolver
  - handler branch
  - test seam
- When a likely fix spans both page logic and a shared component, say so explicitly.
- If a task-owned behavior is currently blocked by old architecture still being present, say that directly.
- If a visible issue actually belongs to a later task, record it separately as `visible but later-task-owned` and do not count it as a current-task finding.
- Do not invent speculative backend work when the visible problem is clearly frontend-owned.
- Do not mutate the task or add subtasks in this step.

</diagnosis_rules>

<output_contract>

Return a concise report with these exact sections:

1. `Task`
   - task number and title

2. `Applicability`
   - either `visual diagnosis ran` or `visual diagnosis not applicable`

3. `Runtime`
   - whether you restarted the main stack
   - whether health and app checks passed
   - whether the stack was left running

4. `Surfaces Inspected`
   - desktop
   - mobile
   - any supporting repository surface if one was needed

5. `Current-State Findings`
   - a flat list of task-owned visible issues
   - each item must include:
     - the issue
     - why it conflicts with the task contract
     - likely owning file(s)
     - likely seam
     - likely change direction

6. `Later-Task-Owned Observations`
   - only include this section if you saw visible issues that belong to later tasks

7. `Likely Proof Seams`
   - the most likely client-test and browser-test files that will need updates for this task

8. `Artifacts`
   - list any kept screenshots or support artifacts saved under `codeInfoTmp/manual-testing/<story-number>/<task-number>/`
   - if screenshots were attempted but could not be copied out honestly, say so

9. `No-Edit Confirmation`
   - confirm that you did not edit code, did not edit the plan, and did not change task scope

</output_contract>

<verification_loop>

- Confirm you used the stored current-plan and current-task handoff.
- Confirm you ran `check_current_task_handoff.py` and used its current output.
- Confirm you re-opened the plan from disk.
- Confirm you treated every subtask as in scope for diagnosis.
- Confirm you did not rewrite the task or narrow its scope.
- Confirm you used Chrome DevTools first for diagnosis and Playwright for retained screenshots when possible.
- Confirm you did not make file changes.
- Confirm you did not run implementation tests.
- Confirm any early exit was used only because there was no honest visual surface to inspect.

</verification_loop>
