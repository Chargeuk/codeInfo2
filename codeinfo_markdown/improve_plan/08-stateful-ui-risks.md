# Goal

If the story changes any user-visible or stateful interaction surface, make the state-transition rules explicit in the plan before tasking begins.

<instruction_priority>

- Follow the shared workflow contract from `improve_plan/01-shared-contract.md`.
- Only add detail when the story actually touches UI state, selection state, mode switches, form inputs, draft state, or persisted client-visible state.
- If the story has no such surface, record that this pass is not applicable and do not bloat the plan.
- Prefer precise behavioral rules over generic UI commentary.
  </instruction_priority>

<stateful_risk_checks>

- Check whether the story changes create-vs-reuse, new-vs-existing, run-vs-resume, archive-vs-restore, or any similar mode branch.
- Check whether the story changes hidden, disabled, read-only, auto-populated, restored, or draft-backed fields.
- Check whether stale local state could still be submitted, persisted, restored, or inferred after the UI says it is no longer active.
- Check whether the story needs to say if stale state must be cleared, retained locally, or merely excluded from payloads and persistence.
- Check whether a user can move between states in a way that creates contradictory mixed inputs, such as selecting an old entity while triggering a fresh-create action.
- Check whether the server contract needs to tolerate, reject, ignore, or log contradictory UI state explicitly.
  </stateful_risk_checks>

<required_plan_updates>

- Update the Description, Acceptance Criteria, Implementation Ideas, and Edge Cases and Failure Modes sections where needed so the intended state behavior is explicit.
- Add failure-mode language when the story could otherwise leave stale state, hidden state, or mode-gated state ambiguous.
- Add proof expectations when a later tasking pass will need to distinguish between clearing stale state and excluding stale state from submission.
- Do not create tasks in this pass.
  </required_plan_updates>

<verification_loop>

- Check whether stateful-risk clarification is genuinely needed or genuinely not applicable.
- Check whether any added state rule is specific enough for a later tasking pass to create separate stale-state and mixed-state proof obligations.
  </verification_loop>

<output_contract>

- Update the plan directly when stateful-risk clarification is needed.
- If no update is needed, leave the plan alone and report that the pass was not applicable.
  </output_contract>
