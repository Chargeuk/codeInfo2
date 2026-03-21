## Task

Start the 3-step review sequence for the current story. This step is the evidence gate only. It is not the findings pass and it is not the plan-editing pass.

## Critical Rules

- First read `codeInfoStatus/flow-state/current-plan.json` and treat it as the SOLE source of review scope for this flow.
- Support both the legacy shape `{ "plan_path": "planning/<story-file>.md" }` and the newer shape `{ "plan_path": "planning/<story-file>.md", "additional_repositories": ["/abs/path/to/repo-b"] }`.
- If the legacy shape is present, treat it as an empty `additional_repositories` list.
- The current repository is the canonical plan host and is implicitly in scope. It must not appear inside `additional_repositories`.
- Use ONLY the repositories defined by the current repository plus `additional_repositories`. Do not invent additional repositories or plan files.
- If any handoff validation rule fails, stop and say the current-plan handoff is stale and must be regenerated.
- For multi-repository stories, you MUST gather cross-repository integration evidence rather than treating each repository in isolation.
- Treat `flows/**` as approved workflow configuration. Changes under `flows/**` must not be classified as suspicious, out-of-scope, or scope creep solely because they are absent from the active plan, but they should still be reviewed normally for workflow behavior, instruction safety, and other engineering concerns.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- For the allowed support files above, review ONLY for spelling, grammar, and obvious wording mistakes.
- Do not edit any plan in this step unless a tiny note is absolutely required to unblock the review.
- Do not commit in this step unless you had to make tracked changes for that unblock.

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

### Normalization Rules

- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is always the current repository plus every path in `additional_repositories`.
- The story number comes from the canonical plan filename.
- The story branch name comes from the current repository branch and must match the canonical plan story number.

## Validation And Stop Conditions

Before doing review work, validate all of the following:

- the canonical `plan_path` exists in the current repository;
- the story number in the current repository branch name matches the canonical plan filename;
- every additional repository path exists and is readable;
- every additional repository is on the same story branch, or the review stops because the scope is stale;
- no additional repository duplicates the current repository path.

If any of those checks fail, stop and say the current-plan handoff is stale and must be regenerated.

## Base Branch Resolution

For each repository in review scope, resolve the review base branch from Git's configured remote default branch. Prefer `origin/HEAD` or equivalent default-branch metadata. If Git cannot provide a default branch, fall back in order to `main`, `master`, then `develop`. Record the resolved base branch and use it for all review diffs and later review-step validation.

## Exact Step Order

1. Re-read the canonical plan from disk.
2. Inspect each repository in review scope against its resolved base branch.
3. Extract the Description, Acceptance Criteria, Out of Scope, and final completed tasks from the canonical plan.
4. Inspect `git -C <repo_root> diff --name-status <resolved_base_branch>...HEAD` plus the recent branch commits for every repository in scope.
5. Group changed files by repository, then within each repository group them into:
   - planned implementation files;
   - planned docs/tests;
   - allowed spelling/grammar-only support files;
   - approved workflow configuration under `flows/**`;
   - suspicious or out-of-scope files.
6. Do not place allowed support files in the suspicious or out-of-scope bucket solely because they are absent from the active plan.
7. For every acceptance criterion in the canonical plan, identify the current proof source:
   - code path;
   - tests;
   - wrapper/test logs;
   - screenshots/manual proof;
   - or note that the proof is weak/missing.
8. For multi-repository stories, add a dedicated cross-repository evidence section covering:
   - integration seams;
   - ownership boundaries;
   - dependency direction;
   - compatibility expectations;
   - any before/after contract comparison that only becomes visible when two or more repositories are considered together.
9. Call out any implementation area that looks more complex or verbose than the planned work actually required, even if it may still be correct.
10. For each changed file or helper outside the allowed support-file set, record any review hotspots that the findings pass must inspect explicitly.
11. Identify any changed external contract surfaces outside the allowed support-file set that need explicit before/after comparison in findings.
12. Name the top 3 changed helpers/functions by review risk from the non-support-file changes across the whole review scope, and record the worst malformed or contradictory input each one should reject or survive, plus whether that path currently has direct proof, indirect proof, or missing proof.
13. Generate a unique `review_pass_id` using the shared story number, a UTC timestamp, and the current repository short SHA.
14. Record the per-repository HEAD short SHA values and resolved base branches separately in the evidence summary and handoff.

## Output Contract

You MUST produce both of these artifacts:

1. Write the evidence summary to `codeInfoStatus/reviews/<review_pass_id>-evidence.md`.
2. Write or overwrite a handoff file at `codeInfoStatus/reviews/<story-number>-current-review.json`.

The evidence file is a durable review artifact that MUST be committed later so a human can inspect it after the story completes.

The handoff file MUST contain at least:

- `story_id`
- `plan_path`
- `review_pass_id`
- `evidence_file`
- `findings_file` set to `null`
- a `repos` array where each entry contains at least:
  - `repo_root`
  - `branch`
  - `resolved_base_branch`
  - `head_commit`

This handoff file is the ONLY review file the next step may use. Do not rely on timestamps or `latest file` discovery. Treat the handoff file as transient workflow state, not as the durable review artifact.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff was normalized correctly;
- the canonical plan exists in the current repository;
- every repository in scope is on the correct story branch;
- every repository was reviewed against its resolved base branch;
- every acceptance criterion has a proof source or an explicit weak/missing-proof note;
- cross-repository evidence was added when the story spans multiple repositories;
- the top 3 risky helpers/functions were named;
- the evidence file path and handoff file path are correct and consistent with the current HEAD commits.

## Final Response

Report the evidence summary and the exact handoff file path when done.
