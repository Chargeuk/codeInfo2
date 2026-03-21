## Task

Start the 3-step review sequence for the current story. This step is the evidence gate only. It is not the findings pass and it is not the plan-editing pass.

## Critical Rules

- First read `codeInfoStatus/flow-state/current-plan.json` and treat it as the SOLE source of review scope for this flow.
- Use ONLY the repositories and plan files defined by that handoff. Do not invent additional repositories or plan files.
- If any handoff validation rule fails, stop and say the current-plan handoff is stale and must be regenerated.
- For multi-repository stories, you MUST gather cross-repository integration evidence rather than treating each repository in isolation.
- Treat `flows/**` as approved workflow configuration. Changes under `flows/**` must not be classified as suspicious, out-of-scope, or scope creep solely because they are absent from the active plan, but they should still be reviewed normally for workflow behavior, instruction safety, and other engineering concerns.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes. These files must not be classified as suspicious, out-of-scope, scope creep, or unwanted solely because they changed outside the active story.
- For the allowed support files above, review ONLY for spelling, grammar, and obvious wording mistakes. Do NOT review them for workflow-contract correctness, artifact hygiene, path usage, instruction/runtime safety, plan-selection rules, story-scope alignment, or revert-worthiness.
- Do not edit any plan in this step unless a tiny note is absolutely required to unblock the review.
- Do not commit in this step unless you had to make tracked changes for that unblock.

## Scope And Inputs

### Current-Plan Handoff Shapes

This handoff file supports two shapes:

- Legacy single-repository shape:

```json
{ "plan_path": "planning/<story-file>.md" }
```

- Multi-repository shape:

```json
{
  "story_id": "<story-number>",
  "review_mode": "single_repo" | "multi_repo",
  "repos": [
    {
      "repo_id": "<name>",
      "repo_root": "/abs/path/to/repo",
      "plan_path": "planning/<story-file>.md",
      "branch": "feature/<story-number>-...",
      "base_branch": "main"
    }
  ]
}
```

### Normalization Rules

- If the legacy `plan_path` shape is present, treat this as a single-repository review whose sole repo entry is the current repository root, the current branch, base branch `main`, and the selected relative `plan_path`.
- If the `repos` array shape is present, use ONLY those repo entries and do not invent additional repositories or plan files.

## Validation And Stop Conditions

Before doing review work, validate all of the following:

- Every selected `plan_path` must exist inside its repository.
- Every selected plan filename must carry the same story number.
- For the legacy single-repository shape, verify that the story number in the current branch name matches the story number in the selected plan filename.
- For the multi-repository shape, verify that each repo entry's `branch` either matches the currently checked-out branch in that repository or, if omitted, can be derived by reading the branch currently checked out at `repo_root`. In either case, the story number in that branch name must match the story number in the selected plan filename for that repository.

If any of those checks fail, stop and say the current-plan handoff is stale and must be regenerated.

## Exact Step Order

1. Re-read every active plan from disk.
2. Inspect each selected repository branch against its `base_branch` using `main` when `base_branch` is omitted.
3. Re-read the full active planning document for every selected repository and extract the Description, Acceptance Criteria, Out of Scope, and the final completed tasks.
4. Inspect `git -C <repo_root> diff --name-status <base_branch>...HEAD` plus the recent branch commits for every selected repository.
5. Group changed files by repository, then within each repository group them into:
   - planned implementation files;
   - planned docs/tests;
   - allowed spelling/grammar-only support files;
   - approved workflow configuration under `flows/**`;
   - suspicious or out-of-scope files.
6. Do not place allowed support files in the suspicious or out-of-scope bucket solely because they are absent from the active plan.
7. For every acceptance criterion in every selected plan, identify the current proof source:
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
12. Note where backward-compatibility risk exists and where the active plan explicitly permits an edge-case deviation from generic best practice.
13. Name the top 3 changed helpers/functions by review risk from the non-support-file changes across the whole review scope, and record the worst malformed or contradictory input each one should reject or survive, plus whether that path currently has direct proof, indirect proof, or missing proof.
14. Record a generic adversarial review checklist for the findings pass. For every non-support-file change, note whether the findings pass MUST inspect:
    - execution-routing or harness-selection rules that may live in unchanged files, including `testMatch`/`testIgnore`, filename or suffix conventions, tags, worker-count or project assignment, startup registration, feature flags, and env wiring;
    - shared-state surfaces touched by the change, including lock files or directories, temp paths, caches, singleton resources, ports, persisted artifacts, and cross-test fixtures;
    - reader and writer pairs over the same file, directory, or persisted artifact, including whether writes are atomic, whether readers tolerate partial writes, and whether cleanup or delete paths can remove a live resource owned by another actor;
    - lifecycle transitions and cleanup paths, including create or acquire, in-progress or partially written state, steady-state, retry, cancel, release, teardown, and crash recovery;
    - tests that mutate shared state or rely on serialization, including what prevents interference with parallel suites, other projects, retries, or stateful variants;
    - malformed, missing, incomplete, or contradictory state that could be transient rather than stale, including partially written files, half-created directories, and delayed metadata visibility.
15. For any risky area above, record the controlling unchanged files, helpers, or configs that must be opened during findings even if they are outside the branch diff, and note whether current proof is direct, indirect, or missing.
16. If a changed test file is being used as acceptance proof, also record whether that test itself introduces review risk through shared paths, shared fixtures, cleanup side effects, runner-project selection, worker-safety assumptions, or cross-suite interference.
17. Generate a unique `review_pass_id` using the shared story number, a UTC timestamp, and the current repository short SHA for the coordinating repository running this flow.
18. Record the per-repository HEAD short SHA values separately in the evidence summary and handoff.

## Output Contract

You MUST produce both of these artifacts:

1. Write the evidence summary to `codeInfoStatus/reviews/<review_pass_id>-evidence.md`.
2. Write or overwrite a handoff file at `codeInfoStatus/reviews/<story-number>-current-review.json`.

The evidence file is a durable review artifact that MUST be committed later so a human can inspect it after the story completes.

The handoff file MUST contain at least:

- `story_id`
- `review_mode`
- `review_pass_id`
- `evidence_file`
- `findings_file` set to `null`
- a `repos` array where each entry contains at least:
  - `repo_id`
  - `repo_root`
  - `plan_path`
  - `branch`
  - `base_branch`
  - `head_commit`

This handoff file is the ONLY review file the next step may use. Do not rely on timestamps or `latest file` discovery. Treat the handoff file as transient workflow state, not as the durable review artifact.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff was normalized using the correct two-shape rule;
- every selected plan exists;
- every selected plan filename and branch story number match;
- every repository was reviewed against the correct `base_branch`;
- every acceptance criterion has a proof source or an explicit weak/missing-proof note;
- cross-repository evidence was added when the story spans multiple repositories;
- the top 3 risky helpers/functions were named;
- the generic adversarial review checklist was recorded;
- the evidence file path and handoff file path are correct and consistent with the current HEAD commits.

## Final Response

Report the evidence summary and the exact handoff file path when done.
