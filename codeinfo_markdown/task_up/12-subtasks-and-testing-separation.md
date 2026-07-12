# Goal

Ensure `Subtasks` and `Testing` stay separated so implementation and proof-authoring work remain in `Subtasks` while wrapper or test execution stays in `Testing`.

<instruction_priority>

- Keep the task list honest and executable for a junior developer.
- Preserve wrapper-first proof rules from earlier passes.
- Do not let build or test execution commands leak into `Subtasks` unless the task is specifically creating or repairing a harness or wrapper.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. The dedicated final validation task is the explicit exception whose only two initial subtasks run lint and formatting; all of its full suites remain in `Testing`.
  </instruction_priority>

<subtask_testing_separation_rules>

- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md` and run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` before editing.
- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- For each task, check whether any `Subtasks` bullet directly tells the implementer to run a build, test, compose, browser, or wrapper command.
- If a subtask mixes execution and proof-authoring, rewrite it so:
  - the execution command lives in `Testing`;
  - the subtask names the exact file, fixture, marker, harness file, or prepared proof surface that must be created or updated before testing runs.
- Do not create a subtask whose only purpose is to say "after Testing X, update `Implementation notes`".
- Treat `Implementation notes` refreshes as plan-maintenance that happens immediately after the related subtask or testing step is completed, following `AGENTS.md`; do not model that maintenance as a separate future-gated subtask.
- Keep exact proof-file and proof-artifact references in substantive tasks' `Subtasks`; do not add them to the dedicated final validation task.
- Keep runnable wrapper commands in `Testing`.
- Allow execution commands to remain in `Subtasks` only when the task is specifically creating, repairing, or proving a harness or wrapper itself.
- Also allow the required lint subtask and prettier or format-check subtask to remain in `Subtasks`. In the dedicated final validation task they must be the entire initially generated checklist, in that order, preceded only by the required non-checkbox final-task repair-scope note, and must not be duplicated in `Testing`.
- When one testing step later produces outputs used for validation, keep the execution command in `Testing` and do not make any subtask depend on those later outputs in order to become executable.
- A subtask may name a proof-owning file, marker, harness surface, or screenshot path convention to prepare, but it must not require the later generated artifact itself for completion.
- If a task needs alternate auth, seeded identities, mocked providers, bypassed 2FA, or similar test-enablement seams, keep those seams in test-owned code, fixtures, harnesses, or test configuration rather than in the shipped production path.
- When subtasks or testing mention screenshot output, ensure the planned path is an ignored artifact location rather than a tracked repository file.
- When manual-testing guidance or related proof notes mention manual-proof artifact locations, keep task-level artifacts in `codeInfoTmp/manual-testing/<story-number>/<task-number>/` as non-committed proof and point any durable story-closeout bundle at `codeInfoStatus/manual-proof/<story-number>/`.
- If manual-testing guidance mentions Playwright MCP screenshots, keep the screenshot capture and transfer as guidance only; do not turn the future screenshot file itself into a subtask dependency.
- If proof traceability after testing matters, express that in the `Testing` step wording or in `Manual Testing Guidance`, not as a later-dependent subtask.
- Do not leave hybrid instructions such as “run wrapper X and update note Y” in one subtask when the same behavior can be separated cleanly.
- Preserve task order and dependencies while rewriting. Do not move proof work into a later task unless the current task can no longer complete honestly.
- Do not create manual testing checklist items in either `Subtasks` or `Testing`.
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
