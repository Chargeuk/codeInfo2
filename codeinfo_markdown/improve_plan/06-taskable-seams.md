# Goal

Rewrite broad implementation ideas into discrete, taskable seams without actually creating tasks yet.

<instruction_priority>

- Do not create tasks in this pass.
- Keep the plan aligned to the KISS principle.
- Prefer small, well-defined seams over broad bundled implementation areas.
  </instruction_priority>

<taskable_seam_rules>

- Re-read the active plan from disk before editing.
- Inspect `Description`, `Acceptance Criteria`, `Implementation Ideas`, `Edge Cases And Failure Modes`, and any contract sections together.
- Split broad implementation areas into discrete seams that a later tasking pass can map to one repository-owned task each.
- Separate implementation seams from proof seams when they would otherwise be bundled together.
- When one requirement spans provider and consumer code, describe the ownership boundary, dependency direction, and sequencing explicitly in the plan.
- When one requirement spans a writer and reader over the same persisted artifact or cleanup path, describe those seams separately so later tasking can assign ownership and proof to both sides.
- When one requirement spans steady-state behavior and destructive cleanup, cancellation, or crash-recovery behavior, describe those seams separately so later proof is not collapsed into one happy-path task.
- When one requirement spans selectors and the launcher, wrapper, startup, or CI path that consumes them, describe those seams separately so later tasking can prove default-path reachability.
- When one requirement has multiple meaningful invariants, list those invariants separately so a later tasking pass can create one proof subtask per invariant instead of one bundled “update tests” item.
- When the story changes contracts, storage, env/config, startup behavior, or migration sequencing, state those seams explicitly instead of leaving them implicit inside a larger implementation idea.
  </taskable_seam_rules>

<required_plan_updates>

- Update `Implementation Ideas` so each major bullet represents one coherent seam.
- Add or refine plan language so acceptance paths, edge cases, error handling, and proof surfaces are separable by a later tasking pass.
- Keep the plan junior-friendly: a later tasking pass should not need to infer the real units of work.
  </required_plan_updates>

<verification_loop>

- Check whether any remaining implementation bullet still bundles multiple unrelated changes.
- Check whether proof expectations are distinct enough that a later tasking pass can create separate proof-authoring subtasks rather than one generic proof step.
- Check whether repository ownership and sequencing are explicit anywhere shared contracts exist.
  </verification_loop>

<mini_example>

- Before: “Improve re-embed performance and update tests.”
- After: “Add chunk-boundary-preserving prose chunking for large text files; update provider batching limits for chunk submission; add dispatcher queue-cap semantics for controlled back-pressure; add proof for no-op and delete-only re-embed fast paths.”
  </mini_example>

<output_contract>

- Update the plan directly when clearer seams are needed.
- Do not create tasks.
- Keep edits structured, concise, and evidence-backed.
  </output_contract>
