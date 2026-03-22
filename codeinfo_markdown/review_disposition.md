## Task

Finish the current story review using ONLY the handoff file and findings file referenced by that handoff. Decide what the canonical plan must do with the findings.

## Critical Rules

- Do NOT rediscover review artifacts by timestamp.
- First read `codeInfoStatus/flow-state/current-plan.json` and determine the canonical `plan_path` plus any `additional_repositories` in scope.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- Then read `codeInfoStatus/reviews/<story-number>-current-review.json`, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit any plan.
- If the review handoff is stale or incomplete, stop and say the review must be rerun. Do not edit any plan.
- Treat `flows/**` as approved workflow configuration. Do not reopen the story or record scope-creep findings solely because those files changed without being named in the active plan.
- Only reopen if the review shows those `flows/**` changes introduced incorrect workflow behavior, broke repository contracts, or require explicit follow-up validation work.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not reopen the story, request reverts, or record scope-creep findings solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, only spelling, grammar, and obvious wording findings are actionable.
- Do not add revert tasks, scope-cleanup tasks, or workflow-correctness tasks for those files.
- This is the only review step allowed to mutate plans.

## Scope And Inputs

### Current-Plan Scope Resolution

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus every path in `additional_repositories`.

### Review Handoff Requirements

Read `codeInfoStatus/reviews/<story-number>-current-review.json`, derived from the shared story number, and verify that its:

- `story_id`
- `plan_path`
- `review_pass_id`
- `evidence_file`
- `findings_file`
- `repos` entries, including stable `repo_alias`, `repo_root`, `branch`, `resolved_base_branch`, and `head_commit`

still match the normalized review scope and current repository state for every selected repository.

## Validation And Stop Conditions

Before deciding disposition, validate all of the following:

- the canonical plan exists;
- the canonical plan filename story number still matches the shared story branch;
- every repository in scope is still on the shared story branch;
- the review handoff is complete and still matches the normalized review scope, canonical `plan_path`, and current repository state.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review handoff is stale or incomplete, stop and say the review must be rerun.

## Disposition Rules

1. If any `must_fix` or `should_fix` findings exist, reopen the story in the canonical plan.
2. Add a `Code Review Findings` summary section to the END of the canonical plan file.
3. Add explicit follow-up tasks using the same structure as previous tasks AFTER the newly added `Code Review Findings`.
4. Add a fresh full re-test/final validation task after those review-fix tasks so the story must be revalidated against the acceptance criteria.
5. Update numbering and cross-references if needed.
6. Every new review-fix task MUST name exactly one repository using `Repository Name`.
7. For cross-repository findings, keep the work in the one canonical plan but split it into repository-specific tasks and make sequencing explicit.
8. If a finding is in an allowed support file, any follow-up task for that file may only request spelling, grammar, or wording corrections.
9. If only `optional_simplification` findings exist, reopen the canonical plan when the simplification is localized to files already changed by the story, low-risk, objectively testable, and improves a shared contract such as logging vocabulary, marker schema, configuration consistency, or cross-repository compatibility.
10. Only defer an `optional_simplification` when the cleanup is speculative, broad, or not worth the churn.
11. If an `optional_simplification` is deferred, record it in a short review note instead of reopening.
12. This `optional_simplification` rule does not permit reopening an allowed support file for anything other than spelling, grammar, or wording corrections.
13. If there are no findings, append a `Post-Implementation Code Review` section to the end of the canonical plan detailing:
    - the branch-vs-base checks performed across all repositories in scope;
    - the acceptance-evidence checks performed;
    - the files inspected;
    - why each repository in scope remains complete;
    - why the story remains complete.
14. For multi-repository stories with no findings, also record why the cross-repository integration evidence was sufficient.
15. When the review is assessing the planned work, it MUST explicitly state whether each acceptance criterion has direct proof, indirect proof, or missing proof, and whether the implemented code is appropriately succinct for the required behavior or contains simplification opportunities.
16. Even when there are no findings, the `Post-Implementation Code Review` section MUST state whether the generic adversarial checklist had direct proof, indirect proof, or missing proof for:
    - execution-routing or harness dependence;
    - default launcher, wrapper, dispatcher, CI, or startup-path inclusion;
    - shared-state or concurrency safety;
    - reader and writer atomicity or partial-write tolerance;
    - cleanup ownership or stale-state safety;
    - lifecycle ordering;
    - test isolation.
17. If any of those areas remain weakly proven, record that residual risk explicitly rather than implying the review was exhaustive.
18. The current pass `evidence_file` and `findings_file` are durable review artifacts and MUST be added to the commit history alongside any plan changes so a human can inspect them later.
## Output Contract

Produce the correct plan mutations for the findings outcome:

- reopen the canonical plan and add review-fix tasks when `must_fix` or `should_fix` findings exist;
- reopen or defer localized `optional_simplification` findings according to the rules above;
- append `Post-Implementation Code Review` when there are no findings.

If this review mutates plans, include the durable review artifacts in the resulting commit history alongside those plan changes.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff and review handoff still match the current repository state;
- every affected repository has been reflected correctly in the canonical plan updates with explicit repository ownership;
- cross-repository findings produced explicit sequencing in the canonical plan and final validation;
- no allowed support file was reopened for anything other than spelling, grammar, or wording corrections;
- the no-findings path, if used, explicitly recorded acceptance proof and residual risk across all repositories in scope;
- the no-findings path, if used, explicitly recorded generic adversarial proof or residual risk across all repositories in scope;
- durable artifacts are treated as commit-worthy and the current-plan handoff is not mistaken for the durable review artifact.
