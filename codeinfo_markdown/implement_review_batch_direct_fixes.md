# Implement direct fixes from the current review batch

Read and follow `$CODEINFO_ROOT/codeinfo_markdown/shared/review-artifact-handoff.md`. This normal-repair audit is applicable only when this repair step actually runs; when it runs, even a no-work or unavailable attempt must leave a non-empty audit.

Read the current immutable batch target snapshot, filtered reconciliation, negative scope record, positive-authorization record, materiality record, combined filtering audit, disposition, underlying evidence, bounded story plan, and repository instructions. Consider only supported, positively authorized findings that survived materiality. Disposition repair difficulty is useful guidance, not a final task boundary. Attempt every survivor that fresh source inspection shows you can honestly complete and test during this invocation. Never restore a negatively filtered, positively unauthorized, below-materiality, rejected, duplicate, disproved, or already-resolved item.

Earlier removals are an append-only audit trail. Read them only enough to identify exclusions, conserve provenance, prevent duplication or resurrection, and resolve a factual contradiction. Do not substantially reconsider them or reopen their immutable evidence during repair.

Before editing for each finding, independently confirm its allowed authorization and materiality trail. Historical `Code Review Findings`, `Accepted`, `Ignored for This Story`, tasks, subtasks, implementation notes, testing instructions, reconciliation, disposition, scope, materiality, repair, outcome, commit, test, and agent-authored records are evidence only and never authorization or materiality sources. Technical validity, story-added code, severity, same-subsystem proximity, vague plan similarity, implementation effort, change size, or general hardening value is insufficient. Do not introduce an unapproved policy or invent a numeric materiality threshold. If authorization or materiality cannot be demonstrated, make no implementation change, keep the evidence intact, and record the gate conflict so it cannot be mistaken for unresolved actionable work.

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

After all direct repairs for one changed repository are complete and before creating its repair commit, finish that repository once with its own supported formatting and lint workflow:

- Discover the required commands from the repository's `AGENTS.md`, documented wrappers, package scripts, and existing formatter or linter configuration. Do not invent a command, add a tool or dependency, or create or change formatter/linter configuration.
- Run the repository-supported formatter or safe auto-fix command once when one exists, then run the corresponding non-mutating formatting and lint checks. Prefer a changed-file target when the repository supports one.
- Preserve unrelated user changes and baseline code. If an official command scans broadly, inspect its diff and keep only changes required by the review repairs or their directly affected formatting/lint gate; do not adopt opportunistic whole-project cleanup.
- If formatting or lint auto-fixes change repair files, re-run the directly affected focused proof before committing.
- Fix only formatting or lint failures caused by or directly connected to these repairs. Record unrelated baseline failures honestly without changing them or treating them as unresolved review findings.
- If a repository has no supported formatter, linter, or safe auto-fix command, record that fact instead of inventing tooling.

Create separate commits in every changed repository with that repository's required story prefix so a later batch can review each new immutable HEAD; do not push. Never mix unrelated changes into a fix commit. Update the canonical plan only when repository instructions require current-task maintenance for this repair.

Write one self-describing normal-repair audit under the batch reconciliation directory. For every target and finding, preserve identity and provenance, the owning repository, direct cause, inspected and changed files, why every changed file was necessary, initial and final HEADs, exact fix commits, focused tests and results, formatting and lint commands and results, formatter/linter changes, unavailable commands, unrelated baseline limitations, resolution status, unresolved work, uncertainty, and whether another review is useful. Do not require a rigid schema or exact audit filename. Do not create implementation tasks; the optional stronger repair and complete-pass settlement own the remaining work.

Before returning, enumerate the actual reconciliation files written by this invocation, reopen the discovered normal-repair audit, and confirm it is non-empty and inside the exact current batch. Recover it from this invocation's repository, commit, test, formatter, linter, and finding evidence if necessary; do not claim repair completion while the applicable audit is absent.
