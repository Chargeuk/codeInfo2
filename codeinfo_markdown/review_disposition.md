## Task

Finish the current story review using ONLY the handoff file and findings file referenced by that handoff. Decide what the plan must do with the findings.

## Critical Rules

- Do NOT rediscover review artifacts by timestamp.
- First read `codeInfoStatus/flow-state/current-plan.json` and normalize it using the same two-shape rule as the evidence and findings steps.
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

### Current-Plan Handoff Shapes

- Legacy single-repository shape:

```json
{ "plan_path": "planning/<story-file>.md" }
```

- Multi-repository shape:

```json
{ "story_id": "<story-number>", "review_mode": "single_repo" | "multi_repo", "repos": [ ... ] }
```

### Current-Plan Normalization Rules

- If the legacy single-repository shape is present, treat it as a single repo entry rooted at the current repository.
- If the `repos` array shape is present, use ONLY those repo entries.

### Review Handoff Requirements

Read `codeInfoStatus/reviews/<story-number>-current-review.json`, derived from the shared story number, and verify that its:

- `story_id`
- `review_pass_id`
- `evidence_file`
- `findings_file`
- `repos` entries

still match the normalized review scope and current repository state for every selected repository.

## Validation And Stop Conditions

Before deciding disposition, validate all of the following:

- every selected plan exists;
- every selected plan filename carries the same story number;
- each participating repository branch matches that story number;
- the review handoff is complete and still matches the normalized review scope and current repository state.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review handoff is stale or incomplete, stop and say the review must be rerun.

## Disposition Rules

1. If any `must_fix` or `should_fix` findings exist, reopen the story in every affected plan.
2. Add a `Code Review Findings` summary section to the END of each affected plan file.
3. Add explicit follow-up tasks using the same structure as previous tasks AFTER the newly added `Code Review Findings`.
4. Add a fresh full re-test/final validation task after those review-fix tasks so the story must be revalidated against the acceptance criteria.
5. Update numbering and cross-references if needed.
6. If a finding is in an allowed support file, any follow-up task for that file may only request spelling, grammar, or wording corrections.
7. For cross-repository findings, add follow-up tasks to every impacted repository plan and make the sequencing between those repositories explicit so the fix order is unambiguous.
8. If only `optional_simplification` findings exist, reopen the affected plan or plans when the simplification is localized to files already changed by the story, low-risk, objectively testable, and improves a shared contract such as logging vocabulary, marker schema, configuration consistency, or cross-repository compatibility.
9. Only defer an `optional_simplification` when the cleanup is speculative, broad, or not worth the churn.
10. If an `optional_simplification` is deferred, record it in a short review note instead of reopening.
11. This `optional_simplification` rule does not permit reopening an allowed support file for anything other than spelling, grammar, or wording corrections.
12. If there are no findings, append a `Post-Implementation Code Review` section to the end of each reviewed plan detailing:
    - the branch-vs-main checks performed;
    - the acceptance-evidence checks performed;
    - the files inspected;
    - why that repository remains complete.
13. For multi-repository stories with no findings, also record why the cross-repository integration evidence was sufficient.
14. When the review is assessing the planned work, it MUST explicitly state whether each acceptance criterion has direct proof, indirect proof, or missing proof, and whether the implemented code is appropriately succinct for the required behavior or contains simplification opportunities.
15. Even when there are no findings, the `Post-Implementation Code Review` section MUST state whether the generic adversarial checklist had direct proof, indirect proof, or missing proof for:
    - execution-routing or harness dependence;
    - default launcher, wrapper, dispatcher, CI, or startup-path inclusion;
    - shared-state or concurrency safety;
    - reader and writer atomicity or partial-write tolerance;
    - cleanup ownership or stale-state safety;
    - lifecycle ordering;
    - test isolation.
16. If any of those areas remain weakly proven, record that residual risk explicitly rather than implying the review was exhaustive.
17. The current pass `evidence_file` and `findings_file` are durable review artifacts and MUST be added to the commit history alongside any plan changes so a human can inspect them later.
18. The transient handoff file should not be treated as the durable artifact; once it has been consumed successfully, either remove it before committing or leave it untracked so later review passes do not rely on stale committed handoff state.
19. If this review mutates more than one repository, commit the changed plan file or files and any durable review artifacts in each affected repository, but do not push.
20. If only one repository changed, keep the normal single-repository commit behavior.

## Output Contract

Produce the correct plan mutations for the findings outcome:

- reopen plans and add review-fix tasks when `must_fix` or `should_fix` findings exist;
- reopen or defer localized `optional_simplification` findings according to the rules above;
- append `Post-Implementation Code Review` when there are no findings.

If this review mutates plans, include the durable review artifacts in the resulting commit history alongside those plan changes.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff and review handoff still match the current repository state;
- every affected plan was updated consistently with the findings severity and repository scope;
- cross-repository findings produced explicit sequencing across impacted plans;
- no allowed support file was reopened for anything other than spelling, grammar, or wording corrections;
- the no-findings path, if used, explicitly recorded acceptance proof and generic adversarial proof/residual risk;
- durable artifacts are treated as commit-worthy and the transient handoff is not treated as the durable artifact.
