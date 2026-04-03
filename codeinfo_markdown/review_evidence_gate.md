# Goal

Start the multi-step review sequence for the current story by gathering evidence only. This step does not produce findings and does not mutate the plan except for a tiny unblock note if absolutely necessary.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` from disk and treat it as the SOLE source of review scope for this flow.
- Resolve the active `plan_path` and extract repository paths from `additional_repositories`, then re-open that exact relative `plan_path` from disk before continuing.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- The current repository is the canonical plan host and is implicitly in scope. If it also appears inside `additional_repositories`, treat that as redundant and ignore it.
- Use ONLY the current repository plus the repository paths extracted from `additional_repositories`.
- If any handoff validation rule fails, stop and say the current-plan handoff is stale and must be regenerated.
- For multi-repository stories, you MUST gather cross-repository integration evidence rather than treating each repository in isolation.
- Treat `flows/**` as approved workflow configuration. Changes there must not be classified as suspicious or out of scope solely because they are absent from the active plan, but they should still be reviewed normally for workflow behavior and instruction safety.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- For those allowed support files, review ONLY for spelling, grammar, and obvious wording mistakes.
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
- every additional repository is checked out to a branch whose story number matches the canonical plan filename;
- no additional repository duplicates the current repository path.

If any of those checks fail, stop and say the current-plan handoff is stale and must be regenerated.

</validation_rules>

<base_branch_rules>

For each repository in review scope, resolve the review base branch using this order:

1. First try to determine where the current story branch was originally branched from by using the information available in `codeInfoStatus/flow-state/current-plan.json`.
2. If you can confidently determine a branched-from branch or ref for that repository, determine whether it has already been merged into the repository's default branch.
3. If that branched-from branch has already been merged into the repository's default branch, use the default branch as the review base.
4. If that branched-from branch has NOT been merged into the repository's default branch, use the branched-from branch itself as the review base.
5. If you cannot confidently determine the branched-from branch, fall back to Git's configured remote default branch. Prefer `origin/HEAD` or equivalent default-branch metadata. If Git cannot provide a default branch, fall back in order to `main`, `master`, then `develop`.

Record the final per-repository resolved base branch and the reason it was chosen, and use that resolved base branch for all review diffs and later review-step validation.

</base_branch_rules>

<step_order>

1. Re-read the canonical plan from disk.
2. Re-check current repository branch state directly from git and re-check each additional repository branch directly from git.
3. Inspect each repository in review scope against its resolved base branch.
4. Extract the Description, Acceptance Criteria, Out of Scope, and final completed tasks from the canonical plan.
5. Inspect `git diff --name-status <resolved_base_branch>...HEAD` plus recent branch commits for every repository in scope.
6. Group changed files by repository, then within each repository group them into:
   - planned implementation files;
   - planned docs/tests;
   - allowed spelling/grammar-only support files;
   - approved workflow configuration under `flows/**`;
   - suspicious or out-of-scope files.
7. Do not place allowed support files in the suspicious or out-of-scope bucket solely because they are absent from the active plan.
8. For every acceptance criterion in the canonical plan, identify the current proof source:
   - code path;
   - tests;
   - wrapper/test logs;
   - screenshots/manual proof;
   - or note that the proof is weak/missing.
9. For multi-repository stories, add a dedicated cross-repository evidence section covering:
   - integration seams;
   - ownership boundaries;
   - dependency direction;
   - compatibility expectations;
   - any before/after contract comparison that only becomes visible when two or more repositories are considered together.
10. Call out any implementation area that looks more complex or verbose than the planned work required, even if it may still be correct.
11. Record the review hotspots that the findings pass must inspect explicitly, including the current hotspot list already used by this repository.
12. Identify changed external contract surfaces that need explicit before/after comparison in findings.
13. Note where backward-compatibility risk exists and where the canonical plan explicitly permits an edge-case deviation from generic best practice.
14. Name the top 3 changed helpers/functions by review risk and record the worst malformed or contradictory input each one should reject or survive, plus whether that path currently has direct proof, indirect proof, or missing proof.
15. Add the dependency-initialization, fast-path, env/config-domain, scale-shape, registration-cleanup, stale-hint, and unchanged-controller checks already required by this repository's review contract.
16. Add a `Risk-Invariant Matrix` section for the top risky helpers/functions.
17. Generate a unique `review_pass_id` using the shared story number, a UTC timestamp, and the current repository short SHA.
18. Record the per-repository stable aliases, HEAD short SHA values, and resolved base branches separately in the evidence summary and handoff.

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

Use a stable `repo_alias` for each repository. Use `current_repository` for the current repository and a stable directory-name-based alias for each additional repository unless the canonical plan already defines a clearer repository name.

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
- Confirm the evidence summary contains a `Risk-Invariant Matrix` for the top risky helpers/functions.
- Confirm the top 3 risky helpers/functions were named.
- Confirm the evidence file path and handoff file path are correct and consistent with the current HEAD commits.

</verification_loop>
