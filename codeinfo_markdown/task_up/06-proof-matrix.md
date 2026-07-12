# Goal

Make every task traceable by forcing a requirement-to-proof matrix before the wrapper-focused testing pass.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md"`.
- Keep the matrix lightweight, but do not allow proof to remain implied.
- Preserve the repository-specific task structure already created in earlier steps.
- Do not replace wrapper-first testing with narrow execution commands.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Earlier substantive tasks own proof authoring; the dedicated final task owns full-suite execution and must retain only its two initial lint and formatting subtasks.
  </instruction_priority>

<proof_matrix_rules>

- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- For each substantive implementation task, identify every acceptance path, important edge case, and meaningful failure mode that task is responsible for. For the dedicated final validation task, verify the story-wide affected-surface and full-suite inventory instead of adding proof-matrix subtasks.
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
  3. the exact existing or new proof-owning files, log markers, fixtures, harness files, or prepared proof surfaces that must be created or updated.
- If `Design Contract Present` is true, require a visual proof map for each design-driven task that names:
  1. the controlling comparison or contract source(s) for the surface: name the current task's explicit visual requirements first when they exist for that surface; if the task is silent on a disputed point, then use the story plan or `Design Contract`, then paired design markdown when it exists, and finally any paired visual design asset such as `*.png` or `*.svg` as supporting reference;
  2. the owned visual invariant;
  3. the implementation files;
  4. the proof owner;
  5. the later screenshot views that manual proof must capture and compare.
- If design-driven visual sources exist for the same surface, require the visual proof map to say whether the owned visual invariant came from an explicit task override, the story plan or `Design Contract`, paired design markdown, the visual asset, or a combination, and follow that same precedence order when they differ.
- If `Design Contract Present` is true, keep the story-wide visual proof map in the earlier design-driven tasks or optional final-task `Manual Testing Guidance`; do not add it as a final-task subtask.
- Do not allow grouped proof instructions like “update these tests” unless each file and invariant is still listed separately in the task.
- When one task changes multiple proof files, use separate numbered subtasks or clearly separated proof bullets so a reviewer can see which file proves which invariant.
- Keep wrapper commands in the `Testing` section. Keep exact test-file references in subtasks.
- Do not name manual-test-only outputs or later executed artifacts as required subtask deliverables.
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
