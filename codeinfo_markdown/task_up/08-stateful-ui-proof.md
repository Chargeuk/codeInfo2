# Goal

Harden tasks that touch stateful UI or stateful interaction flows so mixed-state bugs are explicitly tasked and proved.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md"`.
- Run this pass only where the story affects UI state, mode switches, restored fields, or any client-visible state machine.
- If the story has no such surface, leave the plan unchanged and record that this pass is not applicable.
- Prefer concrete state transitions over generic UX wording.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Put stateful-UI implementation and proof-authoring subtasks in substantive tasks, not in the dedicated final task.
  </instruction_priority>

<stateful_ui_rules>

- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- For each affected substantive task, check whether a user can move between contradictory states such as:
  - create vs reuse;
  - run vs resume;
  - new item vs selected old item;
  - disabled or hidden field vs still-populated local state.
- Add explicit subtasks for stale-state handling whenever a hidden, disabled, restored, or mode-gated value could still influence a request, persisted draft, or derived payload.
- Add explicit proof subtasks that name the exact test files or proof artifacts needed to cover those mixed states.
- Make tasks say whether the correct behavior is to clear the stale state, retain it locally, or exclude it from submission.
- If the server must ignore or reject contradictory payloads coming from these states, make that proof explicit too.
- If `Design Contract Present` is true, require the affected task to state how the redesigned control, pane, overlay, or footer surface must still conform to the named design assets while preserving the mixed-state behavior above.
- When UI work benefits from later browser checks, keep required automated browser proof in `Testing` and place optional manual or browser follow-up only in `Manual Testing Guidance`.
- Do not create manual testing checklist items or subtasks for stateful UI flows.
  </stateful_ui_rules>

<verification_loop>

- Check whether mixed-state proof is explicit anywhere the story changes create-vs-reuse, run-vs-resume, or hidden/disabled state.
- Leave the plan unchanged when this pass is not applicable instead of adding boilerplate.
  </verification_loop>

<output_contract>

- Update the task list directly where stateful UI proof is needed.
- Do not add stateful-UI boilerplate to tasks that have no UI or mixed-state risk.
  </output_contract>
