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
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes. These files must not be classified as suspicious, out-of-scope, scope creep, or unwanted solely because they changed outside the active story.
- For the allowed support files above, review ONLY for spelling, grammar, and obvious wording mistakes. Do NOT review them for workflow-contract correctness, artifact hygiene, path usage, instruction/runtime safety, plan-selection rules, story-scope alignment, or revert-worthiness.
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
- every additional repository is checked out to the same shared story branch as the current repository, and that branch story number matches the canonical plan filename; otherwise the review stops because the scope is stale;
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
10. For each changed file or helper OUTSIDE the allowed spelling/grammar-only support-file set, record any review hotspots that the findings pass must inspect explicitly:
    - merge-before-validate logic;
    - normalization-before-validate logic;
    - bootstrap or existence checks;
    - helpers that return warnings/errors/reason metadata;
    - shared log markers or shared response fields;
    - fallback-selection logic;
    - duplicate/conflicting object keys;
    - deleted/moved/conditional validation;
    - partial-failure handling;
    - dead-field or dead-branch risk;
    - any helper that could hide misconfiguration by defaulting too early;
    - any alias-migration or backward-compatibility helper where legacy and canonical fields can partially coexist in mixed-shape configs.
11. Identify any changed external contract surfaces OUTSIDE the allowed spelling/grammar-only support-file set that need explicit before/after comparison in findings:
    - API routes;
    - config file shapes;
    - persisted artifacts;
    - wrapper outputs;
    - log marker/event schemas;
    - legacy alias/deprecated-input compatibility where old and new field shapes may coexist.
12. Note where backward-compatibility risk exists and where the canonical plan explicitly permits an edge-case deviation from generic best practice.
13. Name the top 3 changed helpers/functions by review risk from the non-support-file changes across the whole review scope, and record the worst malformed or contradictory input each one should reject or survive, plus whether that path currently has direct proof, indirect proof, or missing proof.
14. Record a generic adversarial review checklist for the findings pass. For every non-support-file change, note whether the findings pass MUST inspect:
    - execution-routing or harness-selection rules that may live in unchanged files, including `testMatch`/`testIgnore`, filename or suffix conventions, tags, worker-count or project assignment, startup registration, feature flags, and env wiring;
    - default launcher, wrapper, dispatcher, CI, or startup entrypoints to verify the changed behavior still runs in the standard path without manual overrides;
    - shared-state surfaces touched by the change, including lock files or directories, temp paths, caches, singleton resources, ports, persisted artifacts, and cross-test fixtures;
    - selector/consumer pairs that jointly determine reachability, inclusion, or routing, such as config files plus dispatcher scripts, wrapper scripts, CI jobs, npm scripts, startup code, or other launch-time selectors;
    - reader and writer pairs over the same file, directory, or persisted artifact, including whether writes are atomic, whether readers tolerate partial writes, and whether cleanup or delete paths can remove a live resource owned by another actor;
    - lifecycle transitions and cleanup paths, including create or acquire, in-progress or partially written state, steady-state, retry, cancel, release, teardown, and crash recovery;
    - tests that mutate shared state or rely on serialization, including what prevents interference with parallel suites, other projects, retries, or stateful variants;
    - malformed, missing, incomplete, or contradictory state that could be transient rather than stale, including partially written files, half-created directories, and delayed metadata visibility;
    - rename, ignore-rule, suffix, tag, project-assignment, or classification changes that may silently exclude tests, routes, jobs, or code paths from the default validation path.
15. For any risky area above, record the controlling unchanged files, helpers, or configs that must be opened during findings even if they are outside the branch diff, and note whether current proof is direct, indirect, or missing.
16. If a changed test file is being used as acceptance proof, also record whether that test itself introduces review risk through shared paths, shared fixtures, cleanup side effects, runner-project selection, worker-safety assumptions, or cross-suite interference.
17. Generate a unique `review_pass_id` using the shared story number, a UTC timestamp, and the current repository short SHA.
18. Record the per-repository stable aliases, HEAD short SHA values, and resolved base branches separately in the evidence summary and handoff.

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
  - `repo_alias`
  - `repo_root`
  - `branch`
  - `resolved_base_branch`
  - `head_commit`

Use a stable `repo_alias` for each repository so later review artifacts do not have to rely on raw absolute paths alone. Use `current_repository` for the current repository and a stable directory-name-based alias for each additional repository unless the canonical plan already defines a clearer repository name.

This handoff file is the ONLY review file the next step may use. Do not rely on timestamps or `latest file` discovery. Treat the handoff file as transient workflow state, not as the durable review artifact.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff was normalized correctly;
- the canonical plan exists in the current repository;
- every repository in scope is on the correct story branch;
- every repository was reviewed against its resolved base branch;
- the generated review handoff `plan_path` matches the canonical plan path;
- every repository in scope has a stable alias recorded in the handoff;
- every acceptance criterion has a proof source or an explicit weak/missing-proof note;
- cross-repository evidence was added when the story spans multiple repositories;
- the top 3 risky helpers/functions were named;
- the generic adversarial review checklist was recorded;
- the evidence file path and handoff file path are correct and consistent with the current HEAD commits.

## Final Response

Report the evidence summary and the exact handoff file path when done.
