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
- Before writing any review artifact under `codeInfoTmp/reviews/`, verify that the repository ignores `codeInfoTmp/`. If it does not, add or update `.gitignore` before later review steps rely on that scratch directory. Do not commit the scratch review artifacts themselves.

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

1. First attempt to refresh the repository's `origin` remote, for example with `git -C <repo_root> fetch --prune origin`. If `origin` is missing or fetch fails, continue with local fallback resolution and record the exact failure reason.
2. First try to determine where the current story branch was originally branched from by using the information available in `codeInfoStatus/flow-state/current-plan.json`. Treat that ancestry information as a helpful hint, not as absolute truth.
3. If you can confidently determine a branched-from branch or ref for that repository, then determine whether it has already been merged into the repository's default branch.
4. If that branched-from branch has already been merged into the repository's default branch, choose the default branch as the logical review base.
5. If that branched-from branch has NOT been merged into the repository's default branch, choose the branched-from branch itself as the logical review base.
6. If you cannot confidently determine the branched-from branch, or the ref is missing, unreadable, or otherwise unusable, choose Git's configured default branch as the logical review base. Prefer `origin/HEAD` or equivalent default-branch metadata. If Git cannot provide a default branch, fall back in order to `main`, `master`, then `develop`.
7. Resolve the actual diff base from that logical review base by preferring the remote-tracking ref when it exists, such as `origin/main` for logical base `main` or `origin/feature/example` for logical base `feature/example`.
8. Use a local branch or local ref only when the `origin` fetch failed, `origin` is unavailable, or the matching remote-tracking ref does not exist. Record that as a `local_fallback` with the concrete fallback reason.

Record the final per-repository `resolved_base_branch`, `resolved_base_source`, `logical_base_branch`, `remote_name`, `remote_fetch_status`, and `local_fallback_reason`, and use that resolved base branch for all review diffs and later review-step validation. `resolved_base_source` must be `remote` when a remote-tracking ref such as `origin/main` is used, and `local_fallback` when a local branch or ref is used because the remote path was unavailable.

</base_branch_rules>

<step_order>

1. Re-read the canonical plan from disk.
2. Re-check current repository branch state directly from git, for example with `git branch --show-current`, and re-check each additional repository branch directly from git, for example with `git -C <repo_root> branch --show-current`.
3. Inspect each repository in review scope against its resolved base branch, preferring the remote-tracking ref and using local fallback only when recorded by the base-branch rules.
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
10. For multi-repository stories, add a dedicated cross-repository evidence section and compatibility comparison using the later proof-and-risk rules in this command sequence.
11. Call out any implementation area that looks more complex or verbose than the planned work actually required, even if it may still be correct.
12. Generate a unique `review_pass_id` using the shared story number, a UTC timestamp, and the current repository short SHA.
13. Record the per-repository stable aliases, HEAD short SHA values, logical base branches, resolved base branches, resolved base sources, remote names, remote fetch statuses, and local fallback reasons separately in the evidence summary and handoff.

</step_order>

<output_contract>

You MUST produce both of these artifacts:

1. Write the evidence summary to `codeInfoTmp/reviews/<review_pass_id>-evidence.md`.
2. Write or overwrite a handoff file at `codeInfoTmp/reviews/<story-number>-current-review.json`.

These review files are high-quality local working artifacts for the active review flow. They should be thorough enough to support later review steps in the current run.

These files are scratch workflow artifacts and MUST NOT be committed.

The durable repository outcome of review is the resulting plan and code mutation, not these temporary review files.

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
  - `resolved_base_source`
  - `logical_base_branch`
  - `remote_name`
  - `remote_fetch_status`
  - `local_fallback_reason`
  - `head_commit`

Use a stable `repo_alias` for each repository so later review artifacts do not have to rely on raw absolute paths alone. Use `current_repository` for the current repository and a stable directory-name-based alias for each additional repository unless the canonical plan already defines a clearer repository name.

This handoff file is the ONLY review file the next step may use. Do not rely on timestamps or `latest file` discovery. Treat the handoff file as transient workflow state, not as a repository deliverable.

- Report the evidence summary path and the exact handoff file path when done.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff was normalized correctly.
- Confirm the canonical plan exists in the current repository.
- Confirm every repository in scope is on the correct story branch.
- Confirm every repository was reviewed against its resolved base branch.
- Confirm every repository attempted remote-first base resolution and used a local fallback only when the remote path was unavailable.
- Confirm any local fallback recorded the concrete fetch failure, missing remote, or missing remote-tracking ref that forced it.
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
