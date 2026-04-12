# Goal

Enhance only the newly added review-created `__to_do__` tasks so they meet the same task-quality and proof-quality bar as the main `task_up2` workflow without re-tasking the whole story.

<critical_rules>

- Follow `AGENTS.md` for the current repository and any participating additional repository.
- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this command.
- Re-open the exact relative `plan_path` from disk before editing.
- This command is scoped enhancement, not full story tasking. Do not rewrite the whole plan.
- Only enhance review-created tasks that are still `__to_do__` and were newly added by the immediately preceding review-disposition pass.
- Do not modify older `__done__` or `__in_progress__` tasks unless a minimal cross-reference, dependency, numbering, or testing-alignment update is required to keep the plan executable and honest.
- If no eligible new review-created `__to_do__` tasks exist, make no plan changes and say so.
- If task ownership or scope is ambiguous, inspect the current working-tree diff for the selected plan file. If eligibility is still ambiguous, stop and report that blocker instead of broadening scope.
- When later reused `task_up` guidance refers to the broader shared contract from `task_up/01-shared-contract.md`, use this scoped review-task-enhancement contract instead.

</critical_rules>

<scope_contract>

- When later reused `task_up` guidance says “task,” “task list,” “each task,” or similar, interpret that as applying only to the selected eligible review-created `__to_do__` tasks unless a narrow plan-wide reference update is genuinely required.
- Preserve valid wording and structure from review disposition where it is already concrete enough; improve it rather than rewriting for style.
- Keep review-created tasks in the story's normal execution order.
- If a review-created task depends on another new review-created task, make that dependency explicit in numbering, ordering, status, or wording so the implementation loop can execute it straight through.
- Do not leave a blocked or dependent older task active ahead of a newly inserted prerequisite review-created task.

</scope_contract>

<quality_contract>

- Make every eligible review-created task concrete enough for a weak, junior, forgetful implementer who may read one subtask at a time.
- Ensure each eligible task has explicit ownership, clear subtasks, honest proof homes, and realistic wrapper-first testing.
- Keep review-created tasks executable in order: no subtask may depend on a later `Testing` step to become runnable.
- Do not encode `Implementation notes` refreshes after testing as standalone subtasks.
- If final close-out needs retained proof homes, adjudication notes, or artifact-existence confirmations, place those expectations in `Task Exit Criteria`, `Testing`, or a bounded final validation task description rather than as post-testing subtasks.
- Treat vague review-fix wording as a defect to rewrite, not something to leave for later.
- If a review finding is still too unclear for concrete repair tasking, convert it into a bounded diagnostic task with an explicit stopping rule rather than a vague “investigate” task.

</quality_contract>

<output_contract>

- Update the selected plan directly in the repository's plan format.
- Keep wording concrete, scoped, and executable.
- Do not add filler commentary, narrative explanations, or generic “update tests” instructions that hide the real work.

</output_contract>

<verification_loop>

- Check that you are still enhancing only the selected eligible review-created `__to_do__` tasks.
- Check that any edits to older tasks are minimal dependency or reference updates rather than opportunistic rewrites.
- Check that the resulting task order still matches the next real executable work.

</verification_loop>
