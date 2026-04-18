# Goal

Expand proof obligations into smaller proof-authoring subtasks so each important invariant has an explicit home.

<instruction_priority>

- Keep wrapper-first validation in `Testing`.
- Make proof-authoring work explicit in `Subtasks`.
- Prefer one proof obligation per proof subtask when that keeps the work honest and reviewable.
- Keep proof-authoring work explicit in `Subtasks`, but do not require executed proof output for subtask completion.
  </instruction_priority>

<test_case_expansion_rules>

- Re-read the active plan from disk before editing.
- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- For each acceptance path, important edge case, error path, recovery path, and mixed-state path, add or refine a proof-authoring subtask that names the exact proof file or artifact to create or edit.
- When a task changes env/config parsing, add separate proof subtasks for blank input, whitespace-only input, out-of-range values, and the accepted in-range path whenever those behaviors affect correctness.
- When a task changes query/filter/bulk-selector logic in a large-repository or large-file path, add a proof subtask that explicitly verifies the implementation uses a bounded strategy rather than one unbounded request or filter.
- When a task changes reader/writer behavior over a persisted artifact, add proof subtasks for partial-state tolerance, stale-state cleanup ownership, and reader/writer compatibility whenever those behaviors affect correctness.
- When a task changes cancellation, teardown, or other lifecycle-sensitive logic, add proof subtasks that name the failure-ordering or cleanup-ordering invariant rather than only the happy-path outcome.
- When a task changes async coordination helpers or test-support utilities that register shared waiters, listeners, callbacks, subscriptions, or queue entries, add proof subtasks for timeout, rejection, cancellation, and early-return cleanup whenever those exits exist.
- When a task changes fallback or precedence helpers that can see both stale persisted hints and fresh observed values, add proof subtasks that explicitly cover both conditions rather than only the stale-only or fresh-only path.
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
