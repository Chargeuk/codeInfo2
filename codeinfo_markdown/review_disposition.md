## Task

Finish the current story review using ONLY the handoff file and findings file referenced by that handoff. Decide what the canonical plan must do with the findings.

## Critical Rules

- Do NOT rediscover review artifacts by timestamp.
- First read `codeInfoStatus/flow-state/current-plan.json` and normalize only the canonical `plan_path` plus `additional_repositories`.
- Then read `codeInfoStatus/reviews/<story-number>-current-review.json`, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit any plan.
- If the review handoff is stale or incomplete, stop and say the review must be rerun. Do not edit any plan.
- Treat `flows/**` as approved workflow configuration. Do not reopen the story or record scope-creep findings solely because those files changed without being named in the active plan.
- Only reopen if the review shows those `flows/**` changes introduced incorrect workflow behavior, broke repository contracts, or require explicit follow-up validation work.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not reopen the story, request reverts, or record scope-creep findings solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, only spelling, grammar, and obvious wording findings are actionable.
- This is the only review step allowed to mutate plans.

## Scope And Inputs

### Current-Plan Handoff Shapes

- Legacy single-repository shape:

```json
{ "plan_path": "planning/<story-file>.md" }
```

- Single-plan multi-repository shape:

```json
{
  "plan_path": "planning/<story-file>.md",
  "additional_repositories": [
    "/abs/path/to/repo-b"
  ]
}
```

### Current-Plan Normalization Rules

- If the legacy single-repository shape is present, treat it as an empty `additional_repositories` list.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus every path in `additional_repositories`.

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

- the canonical plan exists;
- every repository in scope is still on the shared story branch;
- the review handoff is complete and still matches the normalized review scope and current repository state.

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
8. If only `optional_simplification` findings exist, reopen the canonical plan when the simplification is localized to files already changed by the story, low-risk, objectively testable, and worth the churn.
9. Only defer an `optional_simplification` when the cleanup is speculative, broad, or not worth the churn.
10. If there are no findings, append a `Post-Implementation Code Review` section to the end of the canonical plan detailing:
    - the branch-vs-base checks performed across all repositories in scope;
    - the acceptance-evidence checks performed;
    - the files inspected;
    - why the story remains complete.
11. For multi-repository stories with no findings, also record why the cross-repository integration evidence was sufficient.
12. The current pass `evidence_file` and `findings_file` are durable review artifacts and MUST be added to the commit history alongside any plan changes so a human can inspect them later.
13. The transient handoff file should not be treated as the durable artifact; once it has been consumed successfully, either remove it before committing or leave it untracked so later review passes do not rely on stale committed handoff state.

## Output Contract

Produce the correct plan mutations for the findings outcome:

- reopen the canonical plan and add review-fix tasks when `must_fix` or `should_fix` findings exist;
- reopen or defer localized `optional_simplification` findings according to the rules above;
- append `Post-Implementation Code Review` when there are no findings.

If this review mutates plans, include the durable review artifacts in the resulting commit history alongside those plan changes.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff and review handoff still match the current repository state;
- every affected repository has been reflected correctly in the canonical plan updates;
- cross-repository findings produced explicit sequencing in the canonical plan;
- the no-findings path, if used, explicitly recorded acceptance proof and residual risk across all repositories in scope;
- durable artifacts are treated as commit-worthy and the transient handoff is not treated as the durable artifact.
