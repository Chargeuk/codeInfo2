# Goal

Start the multi-step review sequence for the current story by gathering evidence only. This step does not produce findings and does not mutate the plan except for a tiny unblock note if absolutely necessary.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` from disk and treat it as the SOLE source of review scope for this flow.
- Resolve the active `plan_path`, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-evidence`. Use its repository scope, story contract, task index, and final-task proof packet before continuing.
- After deriving the story number from that canonical `plan_path`, check for `codeInfoTmp/reviews/<story-number>-current-review-base.json`. When that artifact exists, treat it as the authoritative current-repository comparison contract for this flow. Do not re-fetch or re-resolve the current repository base branch once that artifact has been loaded.
- The prepared review base is also the server-owned review-session contract. Require its exact seven-digit `story_id`, `review_session_id`, `review_pass_id`, `parent_execution_id`, `plan_path`, full `head_commit`, and `comparison_base_commit`. The bounded helper's `story_id` must match it exactly. Never use numeric `story_number` in an artifact path or generate a replacement session/pass ID.
- Never infer, normalize, repair, or substitute story/session/pass/HEAD/base identity.
- Before publishing the stable current-review handoff, re-read the prepared base and require the complete identity tuple to remain unchanged. Write the handoff atomically. If the active session changed, stop without overwriting the newer pointer.
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
- When changed non-support files include `.env*`, `docker-compose*`, entrypoints, startup env loaders, mounted-path mapping, or working-folder routing, record a `Runtime Contract Preservation Matrix` in the evidence summary. That matrix must name:
  - the current known-working behavior;
  - the new contract being asserted by the diff;
  - the user-visible/runtime behaviors that must stay preserved;
  - what proof exists for preservation and what proof is still weak or missing.
- For those runtime-contract surfaces, do not treat healthchecks, env dumps, or container-inspect output as sufficient preserved-behavior proof by themselves.

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

0. For the current repository only, if `codeInfoTmp/reviews/<story-number>-current-review-base.json` exists, use its stored `logical_base_branch`, `resolved_base_branch`, `resolved_base_source`, `remote_name`, `remote_fetch_status`, optional sanitized `remote_fetch_error`, optional `remote_fetch_exit_code`, `local_fallback_reason`, `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, and `comparison_rule` exactly as written. Treat that artifact as the sole source of truth for current-repository comparison context, and do not run another `git fetch` or recompute mergedness for that repository in this step.

1. The review comparison is always the local working branch against the resolved base: use local `HEAD` as the comparison head and never compare `origin/<current-story-branch>` against the base.
2. Use `remote_name: "origin"` for this flow. Do not select a different remote unless a future prompt explicitly defines a remote-selection policy.
3. First attempt to refresh the repository's `origin` remote, for example with `git -C <repo_root> fetch --prune origin`. If `origin` is missing or fetch fails, continue with local fallback resolution and record the exact failure reason.
4. First try to determine where the current story branch was originally branched from by using the information available in `codeInfoStatus/flow-state/current-plan.json`. Treat that ancestry information as a helpful hint, not as absolute truth.
5. Resolve the repository default branch as a logical branch name. Prefer `origin/HEAD` or equivalent default-branch metadata, but normalize it to the target branch name such as `main`, not the symbolic ref `origin/HEAD`. If Git cannot provide a default branch, fall back in order to `main`, `master`, then `develop`.
6. If you can confidently determine a branched-from branch or ref for that repository, determine whether it has already been merged into the repository's default branch by comparing remote-tracking refs where possible, such as `origin/feature/example` against `origin/main`.
7. Use local refs for the mergedness check only when the needed remote-tracking ref is unavailable because `origin` fetch failed, `origin` is unavailable, or the matching remote-tracking ref does not exist. Record that remote-unavailable reason if it affects the final base.
8. If the branched-from branch has already been merged into the repository's default branch, choose the default branch as the logical review base.
9. If the branched-from branch has NOT been merged into the repository's default branch, choose the branched-from branch itself as the logical review base.
10. If you cannot confidently determine the branched-from branch, or the ref is missing, unreadable, or otherwise unusable, choose the normalized default branch as the logical review base.
11. Resolve the actual comparison base from that logical review base by preferring the remote-tracking ref when it exists, such as `origin/main` for logical base `main` or `origin/feature/example` for logical base `feature/example`.
12. Use a local branch or local ref as the comparison base only when the `origin` fetch failed, `origin` is unavailable, or the matching remote-tracking ref does not exist. Record that as a `local_fallback` with the concrete fallback reason.

Record the final per-repository `resolved_base_branch`, `resolved_base_source`, `logical_base_branch`, `remote_name`, `remote_fetch_status`, optional fetch-failed-only sanitized `remote_fetch_error`, optional fetch-failed-only `remote_fetch_exit_code`, `local_fallback_reason`, `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, and `comparison_rule`, and use that pinned comparison base commit for all review diffs and later review-step interpretation.

`remote_fetch_status` is a required string enum describing the remote/ref availability result for the final `comparison_base_ref` lookup only. Earlier candidate refs inspected during base resolution do not change `remote_fetch_status`; record those candidate-ref details in the evidence summary instead, unless they caused the final comparison base to fall back locally. `remote_fetch_status` must be exactly one of:

- `success`: the final `comparison_base_ref` is a remote-tracking ref from `origin`, such as `origin/main`.
- `missing_remote`: `origin` does not exist or is unavailable, so the final `comparison_base_ref` had to use a local fallback.
- `fetch_failed`: an attempted fetch from `origin` failed while resolving the final `comparison_base_ref`, so the final base had to use a local fallback.
- `missing_remote_ref`: `origin` exists, but the remote-tracking ref corresponding to the final logical base does not exist after inspection, so the final `comparison_base_ref` had to use a local fallback.

When `remote_fetch_status` is `fetch_failed`, the handoff may include `remote_fetch_error` only as a short categorized or sanitized summary of the fetch failure, plus `remote_fetch_exit_code` when available. Do not store raw `git fetch` stderr in the JSON handoff. Any `remote_fetch_error` value must redact URL credentials, userinfo, access tokens, and query strings before inclusion. For every other `remote_fetch_status`, omit both `remote_fetch_error` and `remote_fetch_exit_code`; record any non-failing diagnostic details in the evidence summary instead of the JSON handoff.

`resolved_base_source` must be `remote` when a remote-tracking ref such as `origin/main` is used, and `local_fallback` when a local branch or ref is used because the remote path was unavailable. When `resolved_base_source` is `remote`, `remote_fetch_status` must be `success`, `comparison_base_ref` must be the remote-tracking ref used for review, and `local_fallback_reason` must be `null`. When `resolved_base_source` is `local_fallback`, `remote_fetch_status` must be one of `missing_remote`, `fetch_failed`, or `missing_remote_ref`, `comparison_base_ref` must be the local branch or ref used for review, and `local_fallback_reason` must exactly match `remote_fetch_status` so the flow can continue without human interpretation. If `remote_fetch_status` is `fetch_failed` and `remote_fetch_error` is present, it must satisfy the sanitization requirements above. `comparison_base_ref` must match `resolved_base_branch`, `comparison_base_commit` must be the full commit object ID that `comparison_base_ref` resolved to when the evidence step selected the base, `comparison_head_ref` must be `HEAD`, and `comparison_rule` must be `local_head_vs_resolved_base`.

</base_branch_rules>

<step_order>

1. Rerun `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-evidence` so the bounded review contract is fresh.
2. Re-check current repository branch state directly from git, for example with `git branch --show-current`, and re-check each additional repository branch directly from git, for example with `git -C <repo_root> branch --show-current`.
3. Inspect each repository in review scope using the local `HEAD` against its resolved comparison base. For the current repository, prefer the stored prepared-base artifact when present. For additional repositories, continue to prefer a remote-tracking base ref and use local fallback only when recorded by the base-branch rules.
4. Extract the Description, Acceptance Criteria, Out of Scope, and final-task proof details from the bounded review-evidence packet.
5. Inspect `git -C <repo_root> diff --name-status <comparison_base_commit>...HEAD` plus recent local branch commits for every repository in scope, using direct git commands such as `git log --oneline -3` or `git -C <repo_root> log --oneline -3`. Do not substitute `origin/<current-story-branch>` for local `HEAD`, and do not let a moving remote-tracking ref change the comparison after `comparison_base_commit` has been recorded.
6. Group changed files by repository, then within each repository group them into:
   - planned implementation files;
   - planned docs/tests;
   - allowed spelling/grammar-only support files;
   - allowed support files with hygiene/security review required;
   - approved workflow configuration under `flows/**`;
   - formatting-only spillover outside planned work;
   - suspicious or out-of-scope files.
7. Do not place allowed support files in the suspicious or out-of-scope bucket solely because they are absent from the active plan.
8. Before classifying a changed file outside the allowed support-file set as suspicious or out of scope, inspect its diff directly. If the change is formatting-only spillover with no semantic effect, classify it into the formatting-only spillover bucket instead.
9. Treat formatting-only spillover narrowly. It applies only when the diff changes layout or formatter-owned style without changing identifiers, literals, comments with behavioral meaning, commands, config values, selectors, control flow, assertions, import order with possible execution effect, or any other semantic content. If there is any doubt whether the change is semantic, do not use the formatting-only spillover bucket.
10. Keep formatting-only spillover files in review scope for hygiene and security checks, but do not treat them as suspicious or scope creep solely because the active plan did not name them.
11. Record any formatting-only spillover files explicitly in the evidence summary so later review steps can interpret them consistently.
12. Run a repository-wide hygiene sweep across the tracked diff for every repository in scope. Explicitly compare changed files against `.gitignore` and call out:
    - ignored-but-tracked files;
    - tracked temp/runtime/generated artifacts;
    - local config checked into the branch;
    - hard-coded secrets or credential-like values.

13. Treat the hygiene sweep as first-class evidence even when the affected files are support files or formatting-only spillover.
14. For multi-repository stories, add a dedicated cross-repository evidence section and compatibility comparison using the later proof-and-risk rules in this command sequence.
15. Call out any implementation area that looks more complex or verbose than the planned work actually required, even if it may still be correct.
16. Use the exact `review_pass_id` and `review_session_id` minted by the prepared review base. Do not generate or sanitize a replacement identity.
17. Record the per-repository stable aliases, local HEAD short SHA values, logical base branches, resolved base branches, resolved base sources, remote names, remote fetch statuses, optional fetch-failed-only sanitized remote fetch errors, optional fetch-failed-only exit codes, local fallback reasons, comparison base refs, pinned comparison base commit IDs, comparison head refs, and comparison rules separately in the evidence summary and handoff.
18. When a `Runtime Contract Preservation Matrix` is required, include at least one concrete preserved-behavior proof source or one explicit weak-proof note for each affected behavior, such as startup, folder browsing, working-folder persistence, or default-path reachability.

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
- `review_session_id`
- `review_pass_id`
- `parent_execution_id`
- top-level `head_commit` and `comparison_base_commit` copied exactly from the prepared review base
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
  - optional sanitized `remote_fetch_error` only when `remote_fetch_status` is `fetch_failed` and a safe summary is available
  - optional `remote_fetch_exit_code` only when `remote_fetch_status` is `fetch_failed` and an exit code is available
  - `local_fallback_reason`, set to `null` for `remote_fetch_status: success` and otherwise exactly matching `remote_fetch_status`
  - `comparison_base_ref`
  - `comparison_base_commit`
  - `comparison_head_ref`
  - `comparison_rule`
  - `head_commit`

Set `status` to `completed`. Preserve the exact server-owned identity tuple, use the seven-digit `story_id` in the stable pointer path, and write the JSON atomically.

Use a stable `repo_alias` for each repository so later review artifacts do not have to rely on raw absolute paths alone. Use `current_repository` for the current repository and a stable directory-name-based alias for each additional repository unless the bounded review-evidence packet already defines a clearer repository name.

This handoff file is the ONLY review file the next step may use. Do not rely on timestamps or `latest file` discovery. Treat the handoff file as transient workflow state, not as a repository deliverable.

- Report the evidence summary path and the exact handoff file path when done.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff was normalized correctly.
- Confirm the canonical plan exists in the current repository.
- Confirm every repository in scope is on the correct story branch.
- Confirm every repository was reviewed as local `HEAD` against its resolved comparison base.
- Confirm every repository attempted remote-first base resolution for the comparison base and used a local fallback only when the remote path was unavailable.
- Confirm no repository was reviewed as `origin/<current-story-branch>` against the base.
- Confirm any local fallback recorded the concrete fetch failure, missing remote, or missing remote-tracking ref that forced it.
- Confirm every repository recorded the pinned `comparison_base_commit` used for review diffs.
- Confirm the generated review handoff `plan_path` matches the canonical plan path.
- Confirm every repository in scope has a stable alias recorded in the handoff.
- Confirm every acceptance criterion has a proof source or an explicit weak/missing-proof note.
- Confirm cross-repository evidence was added when the story spans multiple repositories.
- Confirm the tracked-diff hygiene sweep covered ignored-but-tracked files, temp artifacts, local config, and secret-like values.
- Confirm any required `Runtime Contract Preservation Matrix` was captured and that preserved behavior was not credited solely from healthchecks, env dumps, or container-inspect output.
- Confirm queued/admission-vs-execution validation gaps and mocked-seam false confidence were recorded as hotspots when present.
- Confirm the evidence summary contains a `Risk-Invariant Matrix` for the top risky helpers/functions.
- Confirm the top 3 risky helpers/functions were named.
- Confirm the generic adversarial review checklist was recorded.
- Confirm the evidence file path and handoff file path are correct and consistent with the current HEAD commits.

</verification_loop>
