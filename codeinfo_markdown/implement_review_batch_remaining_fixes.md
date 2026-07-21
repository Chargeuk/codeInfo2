# Implement remaining findings with the stronger research agent

Read the current immutable batch target snapshot, filtered reconciliation, disposition, underlying job evidence, normal-repair audit when available, bounded story plan, current Git state, and repository instructions. Reconstruct every supported in-scope actionable finding that remains unresolved. Do not depend on one exact audit filename, heading layout, provider, reviewer count, or result schema. If the normal audit is missing or incomplete, recover the remaining work from the other self-describing batch evidence instead of assuming completion.

Your objective is to fix every remaining finding using the smallest focused evidence-backed repair for each one. The story implementation is complete, so work in strict repair-only mode. Do not defer a finding merely because it is complicated, spans many files or repositories, needs substantial investigation, was previously considered task-required, appears to require a product decision, or defeated an earlier implementation approach. Complexity permits deeper research and planning; it does not permit a broader implementation than the finding requires.

Create and execute an internal dependency-aware plan for the complete remaining set, revising that plan whenever evidence or test results disprove an assumption. Never restore scope-filtered, rejected, duplicate, disproved, or already-resolved work.

When intended behavior is uncertain, research and infer the most evidence-supported answer instead of stopping for human clarification. Consult the current story requirements and decisions, current behavior locks and tests, related past stories and implementation notes, relevant Git history, every affected repository, other ingested repositories containing related producers, consumers, contracts, or patterns, official documentation, and internet research. Give priority to explicit current-story requirements, established user-visible behavior, existing contracts, cross-repository compatibility, repository conventions, and the smallest reversible KISS solution.

Research may be broad, but implementation must remain narrow:

- Do not rewrite, reorganize, rename, modernize, simplify, clean up, or otherwise improve working surrounding code.
- Do not change working code merely because another design appears cleaner or better.
- Modify working code only when it directly causes the accepted finding or is necessarily coupled to the smallest correct repair.
- Being in the same file, class, module, repository, or subsystem is not sufficient justification for changing code.
- Change multiple files or repositories only when the repair cannot be correct and provable without those directly coupled changes.
- A producer-consumer change is justified only when both sides must change to resolve the accepted finding while preserving their established contract.
- Refactor only when the existing structure directly causes the finding and every narrower safe correction has been disproved. A broader refactor being cleaner is not evidence that it is necessary.
- Do not perform opportunistic cleanup, unrelated formatting, dependency upgrades, or optional improvements.
- Once the direct issue is fixed and focused proof passes, stop changing code for that finding.

For each finding, repeatedly diagnose the cause, plan a concrete minimal repair, implement it, run focused proof, inspect failures, and revise the diagnosis and plan. Do not stop after the first failed approach and do not repeat an unchanged edit or proof command without new evidence. Continue while any untried evidence source, hypothesis, diagnostic action, or materially different focused implementation remains. When revising an approach, search for a smaller correct repair before broadening the change.

If one finding becomes difficult, preserve its investigation, continue through every other finding, then return to it with the additional evidence gained from the full batch.

Group findings by owning target repository, choose a dependency-aware order, and process repositories sequentially. Before editing each target, confirm it belongs to the immutable batch, remains on its expected story branch, inspect its current HEAD and worktree, and read its repository instructions. Preserve unrelated changes and continue to later repositories when one finding or repository cannot be completed. Re-check only the cross-repository contracts directly affected by the repair.

Use the deeper research and implementation capabilities available to this agent to find and prove the smallest correct repair. Add diagnostics, logging, tests, documentation, refactors, or coordinated producer-consumer changes only when they are strictly necessary to resolve and prove the accepted finding. Remove temporary diagnostics before committing unless they are directly required as part of the lasting repair or proof.

Run proportionate focused repository-owned and directly relevant cross-repository proof. Do not rewrite unrelated tests or broaden testing code merely to improve it. Create separate commits in every changed repository with that repository's required story prefix; do not push or combine unrelated changes.

Stop work on a finding only when it is fixed and tested; investigation disproves it or confirms it is already resolved or out of scope; a required repository, dependency, authentication capability, provider, or infrastructure service is unavailable; the requested outcome is technically impossible in the available system; authoritative requirements remain genuinely irreconcilable after the full evidence search; every materially different focused evidence-backed approach is exhausted; or the invocation is approaching its practical execution limit after repeated materially different attempts.

Complexity, apparent need for a product decision, multi-repository scope, need for planning, broad testing, and failure of an earlier approach are not valid stopping reasons. These rules require persistent investigation, not speculative redesign or improvement.

Write one self-describing stronger-repair audit under the batch reconciliation directory. Account for every finding passed from the normal attempt, including the owning repository, evidence inspected, inferred requirement, direct cause, alternatives considered, approaches attempted, files changed, why every changed file was necessary, initial and final HEADs, exact commits, focused tests and results, resolved work, and the exact genuine blocker for anything unresolved. If there was genuinely nothing left to repair, record an honest no-work outcome. Do not create implementation tasks; complete-pass settlement is the only stage allowed to task the final remainder.
