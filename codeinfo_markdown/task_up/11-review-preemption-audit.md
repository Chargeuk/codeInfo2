# Goal

Audit the draft task list against the shared review-hotspot checklist and force in any missing implementation or proof work before the final readability and finalize passes.

<instruction_priority>

- Follow the shared workflow contract from `task_up/01-shared-contract.md`.
- Read and apply `shared/review-preemption-checklist.md` before editing tasks.
- Treat missing review-preemption coverage as a tasking defect, not a note for later review.
- Do not leave a likely review hotspot implicit if it can be expressed as a concrete subtask or proof obligation now.
  </instruction_priority>

<review_preemption_audit_rules>

- Re-read the active plan from disk before editing tasks.
- For each applicable checklist category, check whether the current tasks already include:
  - concrete implementation work;
  - concrete proof-authoring work;
  - realistic testing steps.
- When persisted artifacts, locks, caches, cleanup paths, or stale-state deletion are touched, ensure the tasks name both the writer and reader surfaces plus cleanup ownership and partial-state handling proof.
- When lifecycle-sensitive orchestration is touched, ensure the tasks include cancel, retry, failure, teardown, or crash-recovery proof when those paths are relevant.
- When launchers, selectors, wrappers, startup paths, CI paths, or feature flags are touched, ensure the tasks include proof that the changed behavior runs through the default path.
- When contracts, error vocabularies, or wrapped-vs-raw errors are touched, ensure the tasks include explicit producer and consumer proof rather than only one side.
- When tests rely on shared state, ports, files, caches, retries, or negative assertions, ensure the tasks make deterministic boundaries, teardown behavior, and worker or parallel-safety explicit.
- Add or rewrite subtasks where needed so a later implementer does not have to infer these review hotspots from broad task wording.
  </review_preemption_audit_rules>

<verification_loop>

- Check whether any likely review hotspot from the checklist would still be discovered for the first time only after code is written.
- Check whether each applicable hotspot now has a concrete implementation home and a named proof home in the task list.
- Check whether the final validation task still proves the story through the repository's normal execution path rather than only targeted routes.
  </verification_loop>

<output_contract>

- Update tasks, subtasks, proof references, and testing steps directly.
- Keep the task list concrete, repository-specific, and executable by a junior developer.
  </output_contract>
