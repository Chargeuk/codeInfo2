# Goal

Expand proof obligations into smaller proof-authoring subtasks so each important invariant has an explicit home.

<instruction_priority>

- Keep wrapper-first validation in `Testing`.
- Make proof-authoring work explicit in `Subtasks`.
- Prefer one proof obligation per proof subtask when that keeps the work honest and reviewable.
  </instruction_priority>

<test_case_expansion_rules>

- Re-read the active plan from disk before editing.
- For each acceptance path, important edge case, error path, recovery path, and mixed-state path, add or refine a proof-authoring subtask that names the exact proof file or artifact to create or edit.
- If one proof file will cover multiple distinct invariants, create separate subtasks that point to the same file but use different `Purpose` language.
- Require each proof subtask to make these four details explicit when they are not already obvious from the plan format:
  1. Test type or proof type.
  2. Exact location or file.
  3. Description of the scenario or invariant.
  4. Purpose: why this proof matters.
- When a changed test title or description would become misleading, add a separate proof-maintenance subtask to rename, split, or rewrite the test so its stated invariant still matches its assertions.
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
    </mini_example>

<output_contract>

- Update subtasks and proof references directly.
- Keep testing commands in `Testing`.
- Do not collapse distinct proof obligations back into one generic bullet.
  </output_contract>
