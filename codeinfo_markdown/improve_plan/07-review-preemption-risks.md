# Goal

Surface the review hotspots that are most likely to become late findings, then encode the relevant ones into the plan before tasking begins.

<instruction_priority>

- Follow the shared workflow contract from `improve_plan/01-shared-contract.md`.
- Read and apply `shared/review-preemption-checklist.md` before editing the plan.
- Do not create tasks in this pass.
- Prefer explicit plan language over hidden assumptions that would only appear during review.
  </instruction_priority>

<review_preemption_rules>

- Re-read the active plan from disk before editing.
- For each checklist category that applies, confirm whether the current plan already makes the requirement, ownership boundary, and proof expectation explicit enough for a later tasking pass.
- When persisted artifacts, locks, caches, or cleanup paths are touched, update the plan so it states:
  - who writes;
  - who reads;
  - whether writes must be atomic or otherwise safe to observe;
  - how partial or in-progress state must be handled;
  - and who owns cleanup or stale-state deletion.
- When orchestration or long-running work is touched, update the plan so it states lifecycle expectations across create, in-progress, steady-state, retry, cancel, teardown, and crash recovery where relevant.
- When selectors, launchers, wrappers, startup paths, CI paths, or feature-flag reachability matter, update the plan so the default execution path is explicit instead of implied.
- When shared contracts or error vocabularies change, update the plan so the producer and consumer sides are both named explicitly.
- When changed tests will need deterministic proof or shared-state safety, update the plan so later tasking can create explicit proof work instead of generic “update tests” subtasks.
  </review_preemption_rules>

<verification_loop>

- Check whether any likely review finding would still rely on a hidden invariant that the current plan does not name.
- Check whether the plan now gives later tasking enough detail to create explicit implementation and proof work for persistence safety, lifecycle behavior, default-path reachability, and test isolation when those areas apply.
- Check whether any checklist category is still only implied by broad wording such as “update cleanup,” “wire the selector,” or “add tests.”
  </verification_loop>

<output_contract>

- Update the plan directly when review-preemption clarification is needed.
- Keep the edits concise, evidence-backed, and specific.
- Do not create tasks in this pass.
  </output_contract>
