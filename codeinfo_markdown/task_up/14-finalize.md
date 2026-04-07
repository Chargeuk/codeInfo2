# Goal

Perform the final tasking audit, synchronize repository ownership, and create one coherent commit if the command changed files.

<instruction_priority>

- Follow the shared workflow contract from `task_up/01-shared-contract.md`.
- Use fresh disk reads for the final pass.
- Keep the final task list concrete, traceable, and in scope.
- Prefer one coherent commit over many small commits.
  </instruction_priority>

<verification_loop>

- Re-read the active plan from disk before finalizing.
- Check that every Acceptance Criterion, important Description requirement, and explicit Out Of Scope boundary is correctly represented by the final task list.
- Check that each task, subtask, testing step, and final validation step names exactly one repository and does not mix repositories.
- Check that the plan's `Additional Repositories` section exactly matches every non-current repository that the final tasks will change.
- Check that no task has drifted beyond the story's intended scope.
- Check that every task is specific enough for a junior developer and does not depend on hidden senior knowledge.
- Check that every subtask is understandable in isolation for a weak, junior, forgetful developer and does not require them to infer missing instructions from elsewhere in the story.
- Check that each task has realistic exit criteria, dependencies, proof steps, and runnable validation.
- Check that the final validation task proves the whole story rather than only isolated task-level behavior.
- Check that the applicable categories from `shared/review-preemption-checklist.md` are represented honestly in the final task list or explicitly not applicable.
  </verification_loop>

<final_edit_rules>

- Preserve the standard named planning sections used by this planning system when they are relevant, such as `Feasibility Proof Pass`, `Message Contracts And Storage Shapes`, `Test Harnesses`, `Edge Cases And Failure Modes`, and `Log Or Proof Markers`.
- Add further relevant sections only when they are genuinely helpful for the selected plan.
- If the plan needs a `Task Exit Criteria`, `Task Dependencies`, or similar task-structure sections to support the final task list truthfully, add or update them.
- Remove contradictions, stale repository references, and stale proof steps.
- Do not leave TODO placeholders or open review comments in the task list.
  </final_edit_rules>

<commit_policy>

- If this command changed files, create one commit after the final verification pass.
- Follow the repository's commit-message and branch conventions from `AGENTS.md` or other repository-specific instructions when they exist.
- If no repository-specific commit convention exists, use a concise commit subject and a short explanatory body.
- If nothing changed, do not create an empty commit.
  </commit_policy>

<output_contract>

- Report briefly what changed, what was verified, and whether a commit was created.
  </output_contract>
