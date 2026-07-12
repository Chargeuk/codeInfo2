# Goal

Split bundled subtasks into smaller, more detailed units so each subtask expresses one concrete action or one proof obligation.

<instruction_priority>

- Preserve the task boundaries that already group coherent repository-owned work.
- Prefer more detailed subtasks over broader bundled subtasks when that improves execution clarity.
- Do not remove valid context that a weak implementer needs.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Do not split, expand, or add to the dedicated final task's two initial lint and formatting subtasks.
  </instruction_priority>

<subtask_granularity_rules>

- Re-read the active plan from disk before editing.
- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- Keep each substantive implementation task focused on one primary seam, but split its subtasks until each one usually performs one implementation action or one proof-authoring action. Exclude the dedicated final validation task from this expansion pass.
- Split any subtask that changes multiple unrelated files, multiple distinct invariants, or multiple separate acceptance paths unless those changes are inseparable.
- If a subtask says “A and B and C,” split it unless all three changes are required to express one inseparable behavior.
- Prefer one subtask per implementation seam and one subtask per proof seam, even when they point to the same file.
- If `Design Contract Present` is true, prefer subtasks tied to concrete visual surfaces such as shell, rail, pane, composer, row chrome, or mobile overlay behavior instead of broad wording such as `improve layout` or `match the redesign`, and make those subtasks cite the exact design file or file subset they implement.
- Do not split a task into subtasks that create a future-output dependency such as “prepare X now, then consume the result of later Testing step Y”.
- Each subtask must still be executable and honestly completable before the formal `Testing` section begins.
- Name the exact local file, folder, function, class, config, runtime asset, or proof artifact to update in each subtask.
- Add a short `Purpose` sentence wherever omitting it would force the implementer to infer why the step exists.
- Keep build and test execution commands in `Testing`, not in `Subtasks`, unless the task is specifically creating or repairing a harness or wrapper.
- Treat the required final lint subtask and final prettier or format-check subtask as explicit allowed exceptions to the general no-execution-in-subtasks rule, and keep them as the last two subtasks in that order.
  </subtask_granularity_rules>

<verification_loop>

- Check whether any subtask still requires senior-level decomposition judgment to know what to do first.
- Check whether any subtask still bundles docs, code, tests, configs, or runtime wiring that should be split for honesty and traceability.
- Check whether each subtask remains understandable in isolation for a junior developer who may read only that one item.
  </verification_loop>

<mini_example>

- Before: “Update `server/src/ingest/ingestJob.ts` and `server/src/test/unit/ingest-reembed.test.ts` to handle delete-only and zero-work re-embeds.”
- After:
  - “Update `server/src/ingest/ingestJob.ts` to defer provider initialization until embedding work exists. Purpose: preserve provider-free metadata-only fast paths.”
  - “Update `server/src/ingest/ingestJob.ts` root-dimension fallback logic so delete-only completion uses already-known local metadata instead of provider bootstrap.”
  - “Extend `server/src/test/unit/ingest-reembed.test.ts` with a provider-failure proof for zero-work delta re-embed.”
  - “Extend `server/src/test/unit/ingest-reembed.test.ts` with a provider-failure proof for delete-only re-embed.”
    </mini_example>

<output_contract>

- Update subtasks directly.
- Keep the plan specific and executable.
- Do not create filler subtasks whose only job is to restate the task title.
  </output_contract>
