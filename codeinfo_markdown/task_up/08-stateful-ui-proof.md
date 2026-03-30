# Goal

Harden tasks that touch stateful UI or stateful interaction flows so mixed-state bugs are explicitly tasked and proved.

<instruction_priority>

- Follow the shared workflow contract from `task_up/01-shared-contract.md`.
- Run this pass only where the story affects UI state, mode switches, restored fields, or any client-visible state machine.
- If the story has no such surface, leave the plan unchanged and record that this pass is not applicable.
- Prefer concrete state transitions over generic UX wording.
  </instruction_priority>

<stateful_ui_rules>

- For each affected task, check whether a user can move between contradictory states such as:
  - create vs reuse;
  - run vs resume;
  - new item vs selected old item;
  - disabled or hidden field vs still-populated local state.
- Add explicit subtasks for stale-state handling whenever a hidden, disabled, restored, or mode-gated value could still influence a request, persisted draft, or derived payload.
- Add explicit proof subtasks that name the exact test files or proof artifacts needed to cover those mixed states.
- Make tasks say whether the correct behavior is to clear the stale state, retain it locally, or exclude it from submission.
- If the server must ignore or reject contradictory payloads coming from these states, make that proof explicit too.
  </stateful_ui_rules>

<verification_loop>

- Check whether mixed-state proof is explicit anywhere the story changes create-vs-reuse, run-vs-resume, or hidden/disabled state.
- Leave the plan unchanged when this pass is not applicable instead of adding boilerplate.
  </verification_loop>

<output_contract>

- Update the task list directly where stateful UI proof is needed.
- Do not add stateful-UI boilerplate to tasks that have no UI or mixed-state risk.
  </output_contract>
