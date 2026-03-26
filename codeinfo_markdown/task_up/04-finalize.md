# Goal

Perform the final tasking audit, synchronize repository ownership, and create one coherent commit if the command changed files.

<instruction_priority>
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
- Check that each task has realistic exit criteria, dependencies, proof steps, and runnable validation.
- Check that the final validation task proves the whole story rather than only isolated task-level behavior.
</verification_loop>

<final_edit_rules>
- If the plan needs a `Feasibility Proof Pass`, `Log Or Proof Markers`, `Task Exit Criteria`, `Task Dependencies`, `Edge Cases and Failure Modes`, `Test Harnesses`, or similar sections to support the final task list truthfully, add or update them.
- Remove contradictions, stale repository references, and stale proof steps.
- Do not leave TODO placeholders or open review comments in the task list.
</final_edit_rules>

<commit_policy>
- If this command changed files, create one commit after the final verification pass.
- The commit message must start with `DEV-[Number] -`.
- Use the current repository branch story number for `[Number]` when available.
- Write a 4- or 5-sentence commit body that explains what changed and why.
- If nothing changed, do not create an empty commit.
</commit_policy>

<output_contract>
- Report briefly what changed, what was verified, and whether a commit was created.
</output_contract>
