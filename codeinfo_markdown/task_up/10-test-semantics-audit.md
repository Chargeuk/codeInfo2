# Goal

Audit the planned proof files so changed or reused tests still claim and prove the same invariant.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md"`.
- Treat misleading proof as a tasking defect, not a cosmetic issue.
- Keep the audit focused on proof semantics, not general test style.
- Do not remove valid proof; rename or rewrite it when semantics drift.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Repair proof semantics in the owning substantive tasks; do not add proof-maintenance subtasks to the dedicated final task.
  </instruction_priority>

<test_semantics_rules>

- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- For every changed or newly referenced proof file, check whether the test title, inline description, and assertions still describe the same invariant after the planned implementation changes.
- If an existing test would become misleading, add an explicit subtask to the owning substantive task to rename it, split it, or rewrite it.
- Do not allow a task to rely on a proof file whose title claims one behavior while its assertions only verify adjacent behavior.
- Do not allow a task to rely on separate adjacent assertions when the claim is an ordering, interleaving, post-transition recomputation, producer-consumer propagation, or cleanup-before-success invariant. Require the planned proof to assert the exact combined scenario.
- When a planned proof file is reused for a new behavior, make the new invariant explicit in the task instead of assuming the old test name is “close enough”.
- When a planned proof depends on teardown or cancellation ordering, check whether the task also makes awaited teardown or cleanup completion explicit instead of assuming it.
- When a planned proof claims that something has not happened yet, check whether the task names a deterministic boundary instead of relying on arbitrary elapsed time.
- When a planned proof touches shared state or concurrency-sensitive behavior, check whether the task states the isolation or worker-safety assumption that keeps the proof honest.
- Check that proof subtasks still describe file changes and invariants to author, not later executed proof output to collect.
  </test_semantics_rules>

<verification_loop>

- Check that every acceptance-proof subtask points to a proof file whose semantics still match the claim.
- Check that changed tests proving stale-state, restore, fallback, or reuse behavior are especially explicit, because those areas drift easily.
- Check that ordering-sensitive proof cannot pass by observing only the earlier event or only the later state.
  </verification_loop>

<output_contract>

- Update subtasks, proof references, and testing notes directly.
- Do not add filler commentary when the existing proof file names and semantics are already aligned.
  </output_contract>
