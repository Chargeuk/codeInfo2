# Goal

Ensure `Subtasks` and `Testing` stay separated so implementation and proof-authoring work remain in `Subtasks` while wrapper or test execution stays in `Testing`.

<instruction_priority>

- Keep the task list honest and executable for a junior developer.
- Preserve wrapper-first proof rules from earlier passes.
- Do not let build or test execution commands leak into `Subtasks` unless the task is specifically creating or repairing a harness or wrapper.
  </instruction_priority>

<subtask_testing_separation_rules>

- Re-read the active plan from disk before editing.
- For each task, check whether any `Subtasks` bullet directly tells the implementer to run a build, test, compose, browser, or wrapper command.
- If a subtask mixes execution and proof-authoring, rewrite it so:
  - the execution command lives in `Testing`;
  - the subtask names the exact file, note, proof artifact, screenshot, or retained proof-home path that must be created, refreshed, or cited after that execution finishes.
- Keep exact proof-file and proof-artifact references in `Subtasks`.
- Keep runnable wrapper commands in `Testing`.
- Allow execution commands to remain in `Subtasks` only when the task is specifically creating, repairing, or proving a harness or wrapper itself.
- When one testing step produces outputs used by multiple subtasks, keep the single execution command in `Testing` and let each subtask describe the distinct proof-authoring or note-refresh work that depends on those outputs.
- Do not leave hybrid instructions such as “run wrapper X and update note Y” in one subtask when the same behavior can be separated cleanly.
- Preserve task order and dependencies while rewriting. Do not move proof work into a later task unless the current task can no longer complete honestly.
  </subtask_testing_separation_rules>

<verification_loop>

- Check that no task still hides wrapper or test execution commands inside `Subtasks` unless it is a harness or wrapper task.
- Check that each moved execution command now has a realistic home in `Testing`.
- Check that each task still has explicit proof-authoring subtasks naming the exact files, artifacts, screenshots, logs, or retained proof homes that later execution will support.
- Check that the final result still reads as one coherent plan rather than two disconnected lists of code work and tests.
  </verification_loop>

<output_contract>

- Update tasks, subtasks, and testing steps directly.
- Keep the rewritten task list concrete, repository-specific, and wrapper-first.
  </output_contract>
