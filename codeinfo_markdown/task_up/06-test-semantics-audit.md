# Goal

Audit the planned proof files so changed or reused tests still claim and prove the same invariant.

<instruction_priority>

- Treat misleading proof as a tasking defect, not a cosmetic issue.
- Keep the audit focused on proof semantics, not general test style.
- Do not remove valid proof; rename or rewrite it when semantics drift.
  </instruction_priority>

<test_semantics_rules>

- For every changed or newly referenced proof file, check whether the test title, inline description, and assertions still describe the same invariant after the planned implementation changes.
- If an existing test would become misleading, add an explicit subtask to rename it, split it, or rewrite it.
- Do not allow a task to rely on a proof file whose title claims one behavior while its assertions only verify adjacent behavior.
- When a planned proof file is reused for a new behavior, make the new invariant explicit in the task instead of assuming the old test name is “close enough”.
  </test_semantics_rules>

<verification_loop>

- Check that every acceptance-proof subtask points to a proof file whose semantics still match the claim.
- Check that changed tests proving stale-state, restore, fallback, or reuse behavior are especially explicit, because those areas drift easily.
  </verification_loop>

<output_contract>

- Update subtasks, proof references, and testing notes directly.
- Do not add filler commentary when the existing proof file names and semantics are already aligned.
  </output_contract>
