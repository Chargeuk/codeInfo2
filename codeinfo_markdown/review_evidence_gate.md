# Goal

Start the multi-step review sequence for the current story by gathering evidence only. This step does not produce findings and does not mutate the plan except for a tiny unblock note if absolutely necessary.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` from disk and treat it as the SOLE source of review scope for this flow.
- Resolve the active `plan_path` and extract repository paths from `additional_repositories`, then re-open that exact relative `plan_path` from disk before continuing.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- The current repository is the canonical plan host and is implicitly in scope. If it also appears inside `additional_repositories`, treat that as redundant and ignore it.
- Use ONLY the current repository plus the repository paths extracted from `additional_repositories`. Do not invent additional repositories or plan files.
- If any handoff validation rule fails, stop and say the current-plan handoff is stale and must be regenerated.
- For multi-repository stories, you MUST gather cross-repository integration evidence rather than treating each repository in isolation.
- Treat `flows/**` as approved workflow configuration. Changes there must not be classified as suspicious or out of scope solely because they are absent from the active plan, but they should still be reviewed normally for workflow behavior, instruction safety, and other engineering concerns.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- For those allowed support files, default to spelling, grammar, and obvious wording review, but still run a narrow hygiene and security scan for:
  - hard-coded secrets, tokens, credentials, or API keys;
  - tracked files that live under ignored paths;
  - local-machine config that should remain template-only;
  - runtime, temp, generated, or artifact directories that should not be committed.
- These files must not be classified as suspicious, out-of-scope, scope creep, or unwanted solely because they changed outside the active story.
- Do NOT review them for workflow-contract correctness, instruction/runtime safety, plan-selection rules, or story-scope alignment unless the changed file itself is the direct owner of the issue being reported.
- Do not edit any plan in this step unless a tiny note is absolutely required to unblock the review.
- Do not commit in this step unless you had to make tracked changes for that unblock.

</critical_rules>

<scope_rules>

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is always the current repository plus the repository paths extracted from `additional_repositories`.
- The story number comes from the canonical plan filename.
- The story branch name comes from the current repository branch and must match the canonical plan story number.

</scope_rules>

<validation_rules>

Before doing review work, validate all of the following:

- the canonical `plan_path` exists in the current repository;
- the story number in the current repository branch name matches the canonical plan filename;
- every additional repository path exists and is readable;
- every additional repository is checked out to a branch whose story number matches the canonical plan filename; otherwise the review stops because the scope is stale;
- no additional repository duplicates the current repository path.

If any of those checks fail, stop and say the current-plan handoff is stale and must be regenerated.

</validation_rules>

<base_branch_rules>

For each repository in review scope, resolve the review base branch using this order:

1. First try to determine where the current story branch was originally branched from by using the information available in `codeInfoStatus/flow-state/current-plan.json`. Treat that ancestry information as a helpful hint, not as absolute truth.
2. If you can confidently determine a branched-from branch or ref for that repository, then determine whether it has already been merged into the repository's default branch.
3. If that branched-from branch has already been merged into the repository's default branch, use the default branch as the review base.
4. If that branched-from branch has NOT been merged into the repository's default branch, use the branched-from branch itself as the review base.
5. If you cannot confidently determine the branched-from branch, or the ref is missing, unreadable, or otherwise unusable, fall back to Git's configured remote default branch. Prefer `origin/HEAD` or equivalent default-branch metadata. If Git cannot provide a default branch, fall back in order to `main`, `master`, then `develop`.

Record the final per-repository resolved base branch and the reason it was chosen, and use that resolved base branch for all review diffs and later review-step validation.

</base_branch_rules>

<step_order>

1. Re-read the canonical plan from disk.
2. Re-check current repository branch state directly from git, for example with `git branch --show-current`, and re-check each additional repository branch directly from git, for example with `git -C <repo_root> branch --show-current`.
3. Inspect each repository in review scope against its resolved base branch.
4. Extract the Description, Acceptance Criteria, Out of Scope, and final completed tasks from the canonical plan.
5. Inspect `git -C <repo_root> diff --name-status <resolved_base_branch>...HEAD` plus recent branch commits for every repository in scope, using direct git commands such as `git log --oneline -3` or `git -C <repo_root> log --oneline -3`.
6. Group changed files by repository, then within each repository group them into:
   - planned implementation files;
   - planned docs/tests;
   - allowed spelling/grammar-only support files;
   - allowed support files with hygiene/security review required;
   - approved workflow configuration under `flows/**`;
   - suspicious or out-of-scope files.
7. Do not place allowed support files in the suspicious or out-of-scope bucket solely because they are absent from the active plan.
8. Run a repository-wide hygiene sweep across the tracked diff for every repository in scope. Explicitly compare changed files against `.gitignore` and call out:
   - ignored-but-tracked files;
   - tracked temp/runtime/generated artifacts;
   - local config checked into the branch;
   - hard-coded secrets or credential-like values.
9. Treat the hygiene sweep as first-class evidence even when the affected files are support files.
10. For every acceptance criterion in the canonical plan, identify the current proof source:

- code path;
- tests;
- wrapper/test logs;
- screenshots/manual proof;
- or note that the proof is weak/missing.

11. For multi-repository stories, add a dedicated cross-repository evidence section covering:

- integration seams;
- ownership boundaries;
- dependency direction;
- compatibility expectations;
- any before/after contract comparison that only becomes visible when two or more repositories are considered together.

12. Call out any implementation area that looks more complex or verbose than the planned work actually required, even if it may still be correct.
13. For each changed file or helper OUTSIDE the allowed spelling/grammar-only support-file set, record any review hotspots that the findings pass must inspect explicitly:
    - merge-before-validate logic;
    - normalization-before-validate logic;
    - provider, client, dispatcher, lock, or bootstrap setup that may happen before the code proves real work still exists on no-op, metadata-only, delete-only, or zero-work fast paths;
    - bootstrap or existence checks;
    - env/config parsers whose accepted domain is wider than the downstream code safely supports, especially empty-string handling, whitespace handling, and numeric ranges that should be clamped, rejected, or treated as unset;
    - helpers that return warnings/errors/reason metadata;
    - raw-to-wrapped error translation helpers plus any changed caller that branches on raw error names, SDK error classes, provider error codes, retryability, or cancel-vs-terminal semantics;
    - fallback or precedence helpers where stale persisted hints, cached values, collection-level metadata, or degraded fallback values may override fresher values observed during the current run;
    - shared waiter, listener, callback, queue, or subscription registrations that may survive timeout, rejection, cancellation, or early return without unregistering;
    - changed test titles or descriptions whose assertions may no longer match the invariant they claim to prove;
    - shared log markers or shared response fields;
    - query builders, delete filters, or bulk selectors whose size grows with repository, file, chunk, or symbol count, especially `$or`, `$in`, `$nin`, and per-file delete payloads;
    - fallback-selection logic;
    - duplicate/conflicting object keys;
    - deleted/moved/conditional validation;
    - partial-failure handling;
    - dead-field or dead-branch risk;
    - changed tests that prove "something did not happen yet" using fixed delays instead of a deterministic scheduler, resource, or state boundary;
    - UI enable/disable/visibility or mode-gating logic versus the payload, persistence, or submission path it is supposed to control;
    - any helper that could hide misconfiguration by defaulting too early;
    - any alias-migration or backward-compatibility helper where legacy and canonical fields can partially coexist in mixed-shape configs.
14. For any changed queued, deferred, retried, or promoted execution path, explicitly compare request-admission validation against execution-time validation. Record a hotspot whenever model-lock checks, allowlist checks, invalid-state checks, authorization checks, or equivalent preconditions are enforced on one path but skipped on another.
15. For any changed route, service, or orchestration boundary whose tests mock a downstream seam to produce the expected contract error, record whether there is also direct proof that the production boundary itself performs the validation. If not, mark that proof as indirect and add a review hotspot for mocked-seam false confidence.
16. Identify any changed external contract surfaces OUTSIDE the allowed spelling/grammar-only support-file set that need explicit before/after comparison in findings:
    - API routes;
    - config file shapes;
    - persisted artifacts;
    - wrapper outputs;
    - log marker/event schemas;
    - legacy alias/deprecated-input compatibility where old and new field shapes may coexist.
17. Note where backward-compatibility risk exists and where the canonical plan explicitly permits an edge-case deviation from generic best practice.
18. Name the top 3 changed helpers/functions by review risk from the non-support-file changes across the whole review scope, and record the worst malformed or contradictory input each one should reject or survive, plus whether that path currently has direct proof, indirect proof, or missing proof.
19. For each changed orchestration function that initializes external providers, clients, dispatchers, locks, or other runtime dependencies, record whether any no-op, metadata-only, delete-only, or zero-work fast path can complete before that initialization happens. If the answer is unclear, add that ordering question to the review hotspots and the Risk-Invariant Matrix.
20. When a fast path is intended to complete without embedding, network, model, or provider work, record the exact dependency-free invariant that the findings pass must challenge explicitly.
21. If an acceptance test proves only terminal status semantics for a fast path, but does not prove behavior under provider or bootstrap failure, mark that proof as indirect rather than direct.
22. For each changed env/config parser, record the value domain the downstream code expects, including empty-string or whitespace behavior, lower and upper bounds, and whether invalid values must clamp, fallback, or fail.
23. For each changed query/filter/bulk selector that scales with repository, file, chunk, or symbol count, record the growth dimension, whether the implementation batches or bounds request size, and whether the active story explicitly targets large-repository or large-file behavior.
24. If a changed helper registers waiters, listeners, callbacks, subscriptions, or queue entries into shared state, record whether every exit path unregisters them, including success, timeout, rejection, cancellation, and early-return paths.
25. If a changed helper chooses between persisted hints and freshly observed values, record whether the current-success path needs different precedence from zero-work or degraded fallback paths.
26. Record a generic adversarial review checklist for the findings pass. For every non-support-file change, note whether the findings pass MUST inspect:
    - execution-routing or harness-selection rules that may live in unchanged files, including `testMatch`/`testIgnore`, filename or suffix conventions, tags, worker-count or project assignment, startup registration, feature flags, and env wiring;
    - default launcher, wrapper, dispatcher, CI, or startup entrypoints to verify the changed behavior still runs in the standard path without manual overrides;
    - shared-state surfaces touched by the change, including lock files or directories, temp paths, caches, singleton resources, ports, persisted artifacts, and cross-test fixtures;
    - selector/consumer pairs that jointly determine reachability, inclusion, or routing, such as config files plus dispatcher scripts, wrapper scripts, CI jobs, npm scripts, startup code, or other launch-time selectors;
    - reader and writer pairs over the same file, directory, or persisted artifact, including whether writes are atomic, whether readers tolerate partial writes, and whether cleanup or delete paths can remove a live resource owned by another actor;
    - lifecycle transitions and cleanup paths, including create or acquire, in-progress or partially written state, steady-state, retry, cancel, release, teardown, and crash recovery;
    - tests that mutate shared state or rely on serialization, including what prevents interference with parallel suites, other projects, retries, or stateful variants;
    - malformed, missing, incomplete, or contradictory state that could be transient rather than stale, including partially written files, half-created directories, and delayed metadata visibility;
    - rename, ignore-rule, suffix, tag, project-assignment, or classification changes that may silently exclude tests, routes, jobs, or code paths from the default validation path.
27. For any risky area above, record the controlling unchanged files, helpers, or configs that must be opened during findings even if they are outside the branch diff, and note whether current proof is direct, indirect, or missing.
28. Add a `Risk-Invariant Matrix` section to the evidence summary for the top risky helpers/functions. For each one, record:
    - the helper/function name and repository scope;
    - the semantic invariant or contract it must preserve;
    - the highest-risk contradictory input, state, or mixed-shape condition that could break that invariant;
    - whether current proof is direct, indirect, or missing;
    - which later review step must challenge that invariant explicitly.
29. If a changed helper wraps, normalizes, or classifies errors, record the consumer branch that interprets those errors and note whether cancellation, retry, ignore, and terminal-failure semantics still depend on the old raw error shape.
30. If a changed test file is being used as acceptance proof, also record whether that test itself introduces review risk through shared paths, shared fixtures, cleanup side effects, runner-project selection, worker-safety assumptions, or cross-suite interference.
31. If a changed test file is being used as acceptance proof, also record whether the test name, inline description, and assertions still exercise the same invariant after the implementation changes rather than only adjacent behavior.
32. If a changed test file is being used as acceptance proof, also record whether any negative assertion depends on an arbitrary elapsed-time sleep instead of a deterministic scheduler, resource, or state boundary, and mark that proof as weak when no stronger boundary is demonstrated.
33. Generate a unique `review_pass_id` using the shared story number, a UTC timestamp, and the current repository short SHA.
34. Record the per-repository stable aliases, HEAD short SHA values, and resolved base branches separately in the evidence summary and handoff.

</step_order>

<output_contract>

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

- Report the evidence summary path and the exact handoff file path when done.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff was normalized correctly.
- Confirm the canonical plan exists in the current repository.
- Confirm every repository in scope is on the correct story branch.
- Confirm every repository was reviewed against its resolved base branch.
- Confirm the generated review handoff `plan_path` matches the canonical plan path.
- Confirm every repository in scope has a stable alias recorded in the handoff.
- Confirm every acceptance criterion has a proof source or an explicit weak/missing-proof note.
- Confirm cross-repository evidence was added when the story spans multiple repositories.
- Confirm the tracked-diff hygiene sweep covered ignored-but-tracked files, temp artifacts, local config, and secret-like values.
- Confirm queued/admission-vs-execution validation gaps and mocked-seam false confidence were recorded as hotspots when present.
- Confirm the evidence summary contains a `Risk-Invariant Matrix` for the top risky helpers/functions.
- Confirm the top 3 risky helpers/functions were named.
- Confirm the generic adversarial review checklist was recorded.
- Confirm the evidence file path and handoff file path are correct and consistent with the current HEAD commits.

</verification_loop>
