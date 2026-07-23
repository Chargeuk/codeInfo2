# Implement direct fixes from the current review batch

Read the current immutable batch target snapshot, filtered reconciliation, negative scope record, positive-authorization record, combined scope audit, disposition, underlying evidence, bounded story plan, and repository instructions. Consider every supported positively authorized actionable finding; disposition repair difficulty is useful guidance, not a final task boundary. Attempt every finding that fresh source inspection shows you can honestly complete and test during this invocation. Never restore a negatively filtered, positively unauthorized, rejected, duplicate, disproved, or already-resolved item.

Before editing for each finding, independently confirm the exact story requirement, approved expansion, or preserved behavior that authorizes the change. Technical validity, story-added code, severity, same-subsystem proximity, vague plan similarity, or general hardening value is insufficient. Do not introduce an unapproved cap, quota, threshold, timeout, retry, default, fallback, validation failure, error path, concurrency limit, skipping rule, truncation rule, or similar policy. If authorization cannot be demonstrated, make no implementation change for that finding, keep its evidence intact, and record the scope conflict in the repair audit so it cannot be mistaken for unresolved authorized work.

The story implementation is complete, so work in strict repair-only mode. For each finding, make the smallest focused evidence-backed change that directly resolves its cause. Research and inspect as broadly as necessary, but keep the implementation itself narrow.

- Do not rewrite, reorganize, rename, modernize, simplify, clean up, or otherwise improve working surrounding code.
- Do not change working code merely because another design appears cleaner or better.
- Modify working code only when it directly causes the accepted finding or is necessarily coupled to the smallest correct repair.
- Being in the same file, class, module, repository, or subsystem is not sufficient justification for changing code.
- Change multiple files or repositories only when the repair cannot be correct and provable without those directly coupled changes.
- Refactor only when the existing structure directly causes the finding and a narrower safe correction is not possible. Record why the refactor is necessary.
- Do not include opportunistic cleanup or unrelated formatting in a repair commit.
- Once the direct issue is fixed and focused proof passes, stop changing code for that finding.

Group findings by owning target repository, choose a dependency-aware order, and process repositories sequentially. Before editing each target, confirm it belongs to the immutable batch, remains on its expected story branch, inspect its current HEAD and worktree, and read its repository instructions. Preserve unrelated changes. Continue to later repositories when one finding or repository cannot be completed safely. Re-check only the cross-repository contracts directly affected by the repair.

Run proportionate focused repository-owned tests that prove the finding and its repair. Do not rewrite unrelated tests or broaden testing code merely to improve it. Remove temporary diagnostics before committing unless they are directly required as part of the repair or its lasting proof.

Create separate commits in every changed repository with that repository's required story prefix so a later batch can review each new immutable HEAD; do not push. Never mix unrelated changes into a fix commit. Update the canonical plan only when repository instructions require current-task maintenance for this repair.

Write one self-describing normal-repair audit under the batch reconciliation directory. For every target and finding, preserve identity and provenance, the owning repository, direct cause, inspected and changed files, why every changed file was necessary, initial and final HEADs, exact fix commits, focused tests and results, resolution status, unresolved work, uncertainty, and whether another review is useful. Do not require a rigid schema or exact audit filename. Do not create implementation tasks; the optional stronger repair and complete-pass settlement own the remaining work.
