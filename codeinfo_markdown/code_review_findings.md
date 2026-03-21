## Task

Continue the current story review using ONLY the handoff file written by the previous review-evidence step. Perform the findings pass for every repository in review scope and produce findings only.

## Critical Rules

- Do NOT discover the latest review artifact by timestamp.
- First read `codeInfoStatus/flow-state/current-plan.json` and normalize only the canonical `plan_path` plus `additional_repositories`.
- Then read `codeInfoStatus/reviews/<story-number>-current-review.json`, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit the plan.
- If the review handoff checks fail, stop and say the review handoff is stale and must be regenerated. Do not edit the plan.
- If the handoff is valid, perform the actual review against the planned work and the branch diff for every repository in scope.
- This step MUST produce findings only and MUST NOT edit the plan yet.
- Do not commit in this step unless you were forced to make tracked changes to repair the review artifacts themselves.
- Treat `flows/**` as approved workflow-support paths. Do not raise findings solely because those paths changed without being named in the active plan, but continue to review them normally for workflow semantics, instruction safety, stale-handoff handling, commit/push behavior, plan-selection rules, and other agent-control correctness.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not raise findings solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, review ONLY for spelling, grammar, and obvious wording mistakes.

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

Read `codeInfoStatus/reviews/<story-number>-current-review.json` and verify that:

- its `story_id` matches the normalized current-plan handoff;
- its `review_pass_id` is present;
- its referenced evidence file exists;
- its `repos` entries still match the selected repositories, current branch names, resolved base branches, and current HEAD commits.

## Validation And Stop Conditions

Before doing findings work, validate all of the following:

- the canonical plan exists;
- every repository in scope is still on the shared story branch;
- the review handoff still matches the normalized current-plan scope and current repository state.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review-handoff checks fail, stop and say the review handoff is stale and must be regenerated.

## Required Review Areas

For all changed files outside the allowed support-file set, review:

- correctness against the story plan;
- acceptance criteria coverage;
- code quality;
- maintainability;
- performance;
- security;
- configuration/runtime correctness;
- documentation drift;
- scope creep;
- whether the code is more verbose or complex than needed and could be made more succinct without sacrificing quality.

For multi-repository stories, you MUST also perform an explicit cross-repository integration pass after the per-repository review. That cross-repository pass must inspect:

- shared APIs;
- shared types;
- shared message or storage contracts;
- env/config names;
- compatibility assumptions;
- dependency direction;
- migration sequencing;
- any producer/consumer mismatch that would not be visible when looking at one repository alone.

## Output Contract

Write the findings to `codeInfoStatus/reviews/<review_pass_id>-findings.md`.

The findings file MUST:

- use findings-first ordering by severity;
- include file references;
- classify each finding as `must_fix`, `should_fix`, or `optional_simplification`;
- state for each finding whether it is a `plan_contract_issue` or a `generic_engineering_issue`;
- identify the affected repository scope for every finding using the reviewed repository roots or aliases.

If no findings exist:

- state that explicitly;
- also record any residual risks or weak-proof areas.

Update the same handoff file so `findings_file` points to the exact findings artifact, and include any useful counts or disposition hints.

This findings file is a durable review artifact that MUST be committed later so a human can inspect it after the story completes.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff was normalized correctly;
- the canonical plan and story branch still match the scope;
- the review handoff still matches the current scope and HEAD commits;
- the plan-based review was completed for every selected repository;
- the cross-repository integration pass was completed when required;
- all findings include severity, issue type, and affected repository scope;
- the findings file path and the handoff `findings_file` field match.

## Final Response

Never recommend reverting or removing the allowed support-file changes merely because they exist. Only call out spelling, grammar, or obvious wording mistakes in those files.
