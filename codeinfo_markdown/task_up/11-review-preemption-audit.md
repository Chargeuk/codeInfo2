# Goal

Audit the draft task list against the shared review-hotspot checklist and force in any missing implementation or proof work before the final readability and finalize passes.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md"`.
- Read and apply `"$CODEINFO_ROOT/codeinfo_markdown/shared/review-preemption-checklist.md"` before editing tasks.
- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md"`; place newly discovered implementation and proof-authoring work in substantive tasks, not in the dedicated final task.
- Treat missing review-preemption coverage as a tasking defect, not a note for later review.
- Do not leave a likely review hotspot implicit if it can be expressed as a concrete subtask or proof obligation now.
  </instruction_priority>

<review_preemption_audit_rules>

- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md` and run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` before editing tasks.
- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- For each applicable checklist category, check whether the current tasks already include:
  - concrete implementation work;
  - concrete proof-authoring work;
  - realistic testing steps.
- When persisted artifacts, locks, caches, cleanup paths, or stale-state deletion are touched, ensure the tasks name both the writer and reader surfaces plus cleanup ownership and partial-state handling proof.
- When lifecycle-sensitive orchestration is touched, ensure the tasks include cancel, retry, failure, teardown, or crash-recovery proof when those paths are relevant.
- When lifecycle-sensitive orchestration is touched, ensure at least one proof obligation targets the exact ordering boundary that would otherwise be covered only by adjacent before/after proof.
- When launchers, selectors, wrappers, startup paths, CI paths, or feature flags are touched, ensure the tasks include proof that the changed behavior runs through the default path.
- When contracts, error vocabularies, or wrapped-vs-raw errors are touched, ensure the tasks include explicit producer and consumer proof rather than only one side.
- When tests rely on shared state, ports, files, caches, retries, or negative assertions, ensure the tasks make deterministic boundaries, teardown behavior, and worker or parallel-safety explicit.
- When broad wrappers, Compose, Docker, browser runtimes, or shared services are required for proof, ensure the tasks distinguish task-owned failures from shared baseline, harness, or environment failures and add prerequisite ownership where the baseline is known to be unhealthy or unproved.
- When later manual/runtime proof is likely, ensure the tasks or final manual guidance name the current supported runtime contract: stack, env files, mounted path namespace, ports, readiness checks, seed/setup source, and artifact location.
- When a proposed review-created task explicitly carries `Scope Impact: cleanup_preference` and would change a known-working runtime contract, ensure the task names the reproduced defect that justifies the change. If no reproduced defect exists, treat that proposal as a tasking defect and do not let portability or neatness alone drive the task.
- Missing or malformed `Scope Impact` metadata must not block the task by itself; treat it as `unknown_scope_impact` and continue the normal tasking audit.
- Add or rewrite subtasks in the owning substantive tasks where needed so a later implementer does not have to infer these review hotspots from broad task wording. Preserve the final task's two permitted initial subtask types per repository—supported lint then supported formatting—with either unsupported command omitted independently.
- When a likely review hotspot would benefit from manual browser validation, express that as optional `Manual Testing Guidance`, not as a required subtask or testing checklist item.
- When a hotspot needs proof, prefer proof-authoring subtasks plus automated `Testing` coverage wherever realistic.
  </review_preemption_audit_rules>

<verification_loop>

- Check whether any likely review hotspot from the checklist would still be discovered for the first time only after code is written.
- Check whether any likely blocker family would still be discovered for the first time only during broad-wrapper proof or manual runtime validation.
- Check whether each applicable hotspot now has a concrete implementation home and a named proof home in the task list.
- Check whether the final validation task lists each worked-on repository's full build, applicable startup, every repository-supported full suite for every affected component including supported end-to-end suites, matching shutdown, supported lint, and supported formatting in order, omitting unsupported commands rather than inventing targeted routes or placeholders.
  </verification_loop>

<output_contract>

- Update tasks, subtasks, proof references, and testing steps directly.
- Keep the task list concrete, repository-specific, and executable by a junior developer.
  </output_contract>
