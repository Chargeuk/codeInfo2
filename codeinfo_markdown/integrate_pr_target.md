# Integrate verified PR targets before the native review snapshot

This step runs after review-cycle initialization and before the native review snapshot. The caller's unchanged checkpoint remains before review, and a second unchanged checkpoint follows this integration step. Do not run this prompt during static validation.

Read the existing current-plan handoff, current task handoff, selected bounded plan scope, repository-owned integration guidance, and `$CODEINFO_ROOT/codeinfo_markdown/codeinfo2_implement_story/shared.md`. Use only the active story's current repository and explicitly scoped additional repositories. Preserve current user restrictions and applicable proof exclusions. Do not edit production/runtime/flow JSON. The narrowly authorized atomic write to only `active-review-cycle.json.pr_preparation` below is permitted. Do not switch branches, rebase, or force-push. Do not create a new flow root, ledger, dispatch mechanism, or inferred review operation identity.

## Operation and target identity

Find the enclosing operation from its existing `pr_current_plan` conversation and execution ancestry, or use the existing identity for a standalone `pr_review_cycle`. Reuse that operation on automatic re-entry. Do not treat a matching title or HEAD alone as proof that a new operation is the same attempt. An explicitly fresh user operation may begin a fresh bounded attempt. Record each target's integration task outcome and direct evidence references in the existing operation/task evidence, including source and target identity and whether integration completed, was already current, or was unavailable. Distinguish a completed attempt from a successful merge.

For each scoped target independently, verify canonical repository root, selected plan path, story branch, worktree/index/merge ownership, and full local HEAD. Confirm the remote/repository identity using current repository configuration and instructions; do not guess an owner, remote, branch, or default base. Do not touch another owner's merge or unrelated staged/worktree changes.

Determine the intended PR base from one matching open PR whose repository, head owner/repository, head branch, and target identify this exact story branch. Use that PR's actual base branch as `base_branch`, even when the plan's `branched_from` differs. If a successful, sufficiently scoped lookup confirms no matching PR exists, derive the intended target only from explicit repository guidance. A failed or denied lookup is not proof that no PR exists. One failed repository-provided source/access route makes only that route unavailable for this operation; do not retry it on re-entry. A separately documented, available alternative may be tried once, without becoming a prerequisite. A later administrative or checkpoint head does not authorize guessing the target.

## Preparation handoff

Before network access or merge work, atomically update only the owned `pr_preparation` member of the existing `active-review-cycle.json`. Re-read and verify the expected current `review_cycle_id` immediately before writing; preserve the top-level record identity, status, schema, and every other member. Do not replace the whole file. Initialize an honest `unavailable` entry for every scoped target before attempting network or merge work, then promote only independently verified targets. Retain one entry per target, including unavailable siblings.

The member shape is:

```json
{
  "review_cycle_id": "<exact current id>",
  "plan_path": "<exact selected path>",
  "targets": [
    {
      "repo_root": "<canonical root>",
      "branch": "<exact branch>",
      "status": "ready",
      "base_branch": "<actual PR or documented intended target>",
      "base_commit": "<full local 40-character commit>",
      "base_source": "pr",
      "integration": "behind",
      "evidence": ["<direct operation/task/evidence references>"]
    },
    {
      "repo_root": "<canonical root>",
      "branch": "<exact branch>",
      "status": "unavailable",
      "reason": "<specific failure>",
      "evidence": ["<direct operation/task/evidence references>"]
    }
  ]
}
```

For a ready entry, `base_source` is `pr` or `intended_target`, and `integration` is `behind` or `up_to_date`. `base_commit` is the full verified local commit used for the comparison. Evidence must point to direct evidence for this operation/target, not an inferred current pointer or sibling search. Keep an unavailable entry when identity or local base cannot be verified; explain the specific failure and cite available evidence. A ready entry records locally verified preparation even when the subsequent merge attempt fails; record that failed merge in the task outcome. Native review validates the cycle, plan, canonical repository, branch, full local commit, and evidence; it does not repeat PR lookup.

After every scoped target has an initialized unavailable entry and its intended base is safely established, make one bounded fetch of that exact verified target ref through the repository-supported remote procedure: the actual PR base when a matching PR exists, or the explicitly documented intended target after a successful lookup establishes that no PR exists. Verify target identity and the resulting full commit SHA locally, and record freshness/provenance. Do not fetch a guessed branch or use a generic fallback. If the fetch fails or access is denied, mark that route unavailable and do not retry it on re-entry; do not ask for repeated permission. Continue safe independent targets. Already available same-target local/cached evidence may be used only when its identity is independently verified and its freshness is reported honestly. Do not call stale/unknown evidence fresh, and do not treat fetch failure as evidence that the PR or branch is absent. A route failure is not a reason to wait indefinitely or repeatedly seek authorization; preserve the limitation and proceed with safe independent work.

Initializers/finalizers may intentionally reset or drop this transient preparation member. On every execution/re-entry, reconstitute it from matching durable attempt task/direct evidence before native snapshotting; do not mistake a reset for permission to repeat a failed access route or merge. The snapshot's `.target.pr_preparation` carries each target's nested preparation evidence, exact head/base, and references in the full target/review-wave bindings. Preserve those bindings and any actual head/base movement as provenance; do not silently restart integration because a pinned base advanced later.

## Safe integration

For a ready target, verify the exact current branch and fetched/verified base commit. If the base commit is already an ancestor of the story HEAD, record `up_to_date` and do not create a duplicate merge. Otherwise, before merging, create or reuse exactly one ordinary bounded attempt-and-report task for this target, anchored by the existing parent conversation and execution operation and scoped to exact repository, branch, and target. Preserve immutable existing tasks and IDs; do not fabricate a `completed-review-fix` task. The task must cover the attempt, preserving/recovering state, and reporting the outcome. Its attempt/report contract may be completed after a verified terminal failed attempt, but such completion is never a claim of successful integration. Record the task identity and direct evidence references in the durable operation evidence and preparation entry. Automatic re-entry reuses this task and its evidence; a fresh explicit user operation uses its own new anchor. Only after task creation/reuse, capture complete protected plan, task, review, handoff, progress, index, and worktree state, including presence/absence, content, and provenance. Account for clean incoming replacements as well as dirty changes. Preserve unrelated staged/worktree content and never stage another owner's changes. Use the repository's existing safe merge procedure (including `--no-commit --no-ff` where applicable); never rebase or force-push.

On conflict or proposed-tree changes, follow the existing CodeInfo subagent/worker rules in `codeinfo2_implement_story/shared.md`; do not define or create a new agent type. The coder owns all conflict resolution and implementation/config/test/file repairs. The automated testing agent owns authorized check execution and substantive task documentation, subject to the current user restrictions. The existing main integration coordinator owns only the integration commit after repairs and required proof are complete; do not substitute native integration or another agent's commit. Verify the complete merge tree and both parents against the captured state and exact source commit; confirm protected state, unrelated changes, and absence of unmerged entries or an owned pending merge. Do not run speculative repairs because of a possible failure. Do not waive or weaken a real test failure or user restriction. If new source changes invalidate required proof, leave the affected proof honestly open for the appropriate owner.

Abort only this invocation's own merge when ownership is verified and abort restores the captured baseline. If restoration cannot be established, preserve the actual state, mark that target unsafe/unavailable with evidence, and continue safe independent targets. Do not use reset, clean, forced checkout, stash, guessed targets, or destructive recovery.

Write a `ready` preparation entry only when target identity and base commit are locally verified, even if merge integration failed; the task outcome must explain the failure. Mark preparation unavailable when identity or safety is unknown. A ready target remains subject to the native review's exact branch/head verification. Record any later PR retarget or unexpected remote-head movement as a limitation; do not guess or repeat the merge. The subsequent unchanged checkpoint owns persistence/push of the final safe result.

Report per target: operation/task evidence references, repository and branch, PR or documented base source, full local base commit, integration result, merge commit if any, proof invalidated by source changes, and unresolved safety/access limitations. Continue independent targets when one target is unavailable. Do not claim a merge or review-ready result without its corresponding evidence.
