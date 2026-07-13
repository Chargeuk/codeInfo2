# Goal

Expand proof obligations into smaller proof-authoring subtasks so each important invariant has an explicit home.

<instruction_priority>

- Keep wrapper-first validation in `Testing`.
- Make proof-authoring work explicit in `Subtasks`.
- Prefer one proof obligation per proof subtask when that keeps the work honest and reviewable.
- Keep proof-authoring work explicit in `Subtasks`, but do not require executed proof output for subtask completion.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Expand proof-authoring subtasks only in substantive tasks; never add them to the dedicated final validation task.
  </instruction_priority>

<test_case_expansion_rules>

- Re-read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, then re-open the exact relative `plan_path` from disk before editing, using explicit shell reads such as `sed`, `cat`, or `rg`.
- Do not answer from conversational memory or an earlier snapshot when the plan can be re-read from disk now.
- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- For each acceptance path, important edge case, error path, recovery path, and mixed-state path, add or refine a proof-authoring subtask in the owning substantive task that names the exact proof file or artifact to create or edit. Do not place this work in the dedicated final validation task.
- When a task changes env/config parsing, add separate proof subtasks for blank input, whitespace-only input, out-of-range values, and the accepted in-range path whenever those behaviors affect correctness.
- When a task changes query/filter/bulk-selector logic in a large-repository or large-file path, add a proof subtask that explicitly verifies the implementation uses a bounded strategy rather than one unbounded request or filter.
- When a task changes reader/writer behavior over a persisted artifact, add proof subtasks for partial-state tolerance, stale-state cleanup ownership, and reader/writer compatibility whenever those behaviors affect correctness.
- When a task changes cancellation, teardown, or other lifecycle-sensitive logic, add proof subtasks that name the failure-ordering or cleanup-ordering invariant rather than only the happy-path outcome.
- When a task changes a lifecycle or cleanup boundary, reject adjacent proof as sufficient. If success publication, response construction, logging, retry, cleanup, delete, or state transition ordering matters, add a proof subtask that proves the exact before/after boundary in one scenario rather than separate tests for each side.
- When a task changes async coordination helpers or test-support utilities that register shared waiters, listeners, callbacks, subscriptions, or queue entries, add proof subtasks for timeout, rejection, cancellation, and early-return cleanup whenever those exits exist.
- When a task changes fallback or precedence helpers that can see both stale persisted hints and fresh observed values, add proof subtasks that explicitly cover both conditions rather than only the stale-only or fresh-only path.
- When a task changes a shared producer-consumer contract, add proof subtasks for the producer, each meaningful consumer, and at least one wrapper or default-path route when caller-visible behavior depends on propagation through that path.
- When a task changes response, log, queue-position, schema, OpenAPI, or documentation-visible contract data after another runtime transition can happen, add proof subtasks that assert the value after the transition rather than only at initial construction time.
- When a task relies on a broad wrapper or running system for proof, add proof-authoring subtasks that make any needed baseline, harness, fixture, seeded state, env, mount, and teardown assumptions explicit before that wrapper appears in `Testing`.
- If one proof file will cover multiple distinct invariants, create separate subtasks that point to the same file but use different `Purpose` language.
- Require each proof subtask to make these four details explicit when they are not already obvious from the plan format:
  1. Test type or proof type.
  2. Exact location or file.
  3. Description of the scenario or invariant.
  4. Purpose: why this proof matters.
- When a changed test relies on proving that something has not happened yet, require the proof subtask to name the deterministic scheduler, resource, or state boundary it will use instead of leaving a fixed-delay sleep implicit.
- When a changed test touches shared state, ports, files, caches, or retries, require the proof subtask to state the teardown or isolation expectation explicitly.
- When a changed test title or description would become misleading, add a separate proof-maintenance subtask to rename, split, or rewrite the test so its stated invariant still matches its assertions.
- When a story changes error wrapping, normalization, retry helpers, provider adapters, or cancellation handling, add proof-authoring subtasks that explicitly cover both raw and wrapped error paths whenever caller behavior depends on that distinction.
- A proof subtask should describe the file, scenario, and invariant to author or update, not the later artifact that the test run will emit.
  </test_case_expansion_rules>

<verification_loop>

- Check that no meaningful acceptance path is proved only by a generic “update tests” instruction.
- Check that every important failure mode has a named proof home when the story requires it.
- Check that no meaningful invariant is covered only by adjacent proof when an exact interleaving, ordering, producer-consumer, or post-transition proof is needed.
- Check that proof homes for broad wrappers or runtime validation name the setup assumptions that prevent shared-baseline or stale-runtime blockers.
- Check that proof subtasks remain smaller and more concrete than the later wrapper execution steps.
  </verification_loop>

<mini_example>

- Before: “Update `server/src/test/unit/openai-provider.test.ts` to cover batching changes.”
- After:
  - “Test type: server unit. Location: `server/src/test/unit/openai-provider.test.ts`. Description: prove provider batching uses the canonical max-input constant. Purpose: prevent drift between the effective batch size and the provider guardrail.”
  - “Test type: server unit. Location: `server/src/test/unit/openai-provider.test.ts`. Description: prove overflow inputs still split into multiple provider calls. Purpose: preserve batching behavior while the constant source changes.”
- Bad: “Run the browser proof and save the screenshot for the disabled-state case.”
- Good: “Extend the relevant Playwright proof and screenshot naming so the disabled-state case can be captured during later automated or manual validation.”
  </mini_example>

<output_contract>

- Update subtasks and proof references directly.
- Keep testing commands in `Testing`.
- Do not collapse distinct proof obligations back into one generic bullet.
  </output_contract>
