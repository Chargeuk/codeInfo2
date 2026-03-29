# Goal

Make every task traceable by forcing a requirement-to-proof matrix before the wrapper-focused testing pass.

<instruction_priority>

- Follow the shared workflow contract from `task_up/01-shared-contract.md`.
- Keep the matrix lightweight, but do not allow proof to remain implied.
- Preserve the repository-specific task structure already created in earlier steps.
- Do not replace wrapper-first testing with narrow execution commands.
  </instruction_priority>

<proof_matrix_rules>

- For each task, identify every acceptance path, important edge case, and meaningful failure mode that task is responsible for.
- Treat invalid env/config inputs, blank or whitespace-only inputs, out-of-range numeric values, and large-input scale behavior as proof obligations whenever the task changes constrained config parsing or large-repository query/filter logic.
- Treat partial or in-progress state, cleanup ownership, reader/writer compatibility, and stale-vs-live state handling as proof obligations whenever the task changes persisted artifacts, caches, locks, files, or collections.
- Treat cancel, retry, teardown, crash-recovery, and destructive-cleanup ordering as proof obligations whenever the task changes lifecycle-sensitive orchestration.
- Treat default launcher, wrapper, startup, CI, selector, and feature-flag reachability as proof obligations whenever the task changes how behavior becomes runnable.
- Treat deterministic observable boundaries, teardown ordering, shared-state safety, and worker or parallel-safety as proof obligations whenever the task changes tests or harness code.
- Treat shared waiter, listener, callback, subscription, or queue cleanup on timeout, rejection, cancellation, and early return as proof obligations whenever the task changes async coordination helpers or test-support utilities.
- Treat stale persisted hints versus fresh observed values as proof obligations whenever the task changes precedence or fallback helpers that may be used in both degraded and successful paths.
- Rewrite or add subtasks so each proof obligation names:
  1. the requirement or invariant being proved;
  2. the implementation files that own the behavior;
  3. the exact existing or new test files, proof artifacts, screenshots, or logs that must be created or updated.
- Do not allow grouped proof instructions like “update these tests” unless each file and invariant is still listed separately in the task.
- When one task changes multiple proof files, use separate numbered subtasks or clearly separated proof bullets so a reviewer can see which file proves which invariant.
- Keep wrapper commands in the `Testing` section. Keep exact test-file references in subtasks.
  </proof_matrix_rules>

<verification_loop>

- Check that each task has no hidden proof obligations left outside the task body.
- Check that every named proof file is a plausible place to prove the stated invariant.
- Check that every important requirement in the task exit criteria appears in the proof mapping.
  </verification_loop>

<output_contract>

- Update tasks and subtasks directly.
- Do not add filler matrix tables if the existing task format already carries the same information cleanly.
  </output_contract>
