# Goal

Continue the current story review using ONLY the stored review handoff, perform the findings pass for every repository in review scope, and produce findings only.

<critical_rules>

- Do NOT discover the latest review artifact by timestamp.
- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` from disk and determine the canonical `plan_path`, then extract repository paths from `additional_repositories` and re-open the exact relative `plan_path` from disk.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- Then re-read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit the plan.
- If the review handoff checks fail, stop and say the review handoff is stale and must be regenerated. Do not edit the plan.
- If the handoff is valid, perform the actual review against the planned work and the branch diff for every repository in scope.
- This step MUST produce findings only and MUST NOT edit the plan yet.
- Do not commit scratch review artifacts in this step. Only commit if a separate tracked repository change is genuinely required to repair the workflow state.
- Treat `flows/**` as approved workflow-support paths. Do not raise findings solely because those paths changed without being named in the active plan, but continue to review them normally for workflow semantics, instruction safety, stale-handoff handling, commit/push behavior, plan-selection rules, and other agent-control correctness.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not raise findings solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, default to spelling, grammar, and obvious wording review, but still raise findings for:
  - hard-coded secrets, tokens, credentials, or API keys;
  - tracked files that live under ignored paths;
  - checked-in local config that should remain template-only;
  - tracked temp, generated, or runtime artifact directories.
- Do NOT raise findings about scope creep, unwanted changes, workflow semantics, path usage, plan-selection rules, or revert recommendations for allowed support files unless the issue is one of those explicit hygiene or secret cases.

</critical_rules>

<scope_rules>

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus the repository paths extracted from `additional_repositories`.
- Read `codeInfoTmp/reviews/<story-number>-current-review.json` and verify that:
  - its `story_id` matches the story number derived from the canonical current-plan `plan_path` filename;
  - its `review_pass_id` is present;
  - its referenced evidence file exists;
  - its `repos` entries still match the selected repositories, current branch names, resolved base branches, resolved base sources, logical base branches, comparison base refs, comparison base commits, comparison head refs, comparison rules, and current HEAD commits.
  - each repo entry has `remote_name: "origin"`.
  - each repo entry has `remote_fetch_status` set to exactly one of `success`, `missing_remote`, `fetch_failed`, or `missing_remote_ref`.
  - each repo entry has `comparison_base_commit` set to a commit object that still exists in the repository.
  - each repo entry with `resolved_base_source: remote` has `remote_fetch_status: success`, `comparison_base_ref` set to the remote-tracking ref used for review, and `local_fallback_reason: null`.
  - each repo entry with `resolved_base_source: local_fallback` has `remote_fetch_status` set to one of `missing_remote`, `fetch_failed`, or `missing_remote_ref`, `comparison_base_ref` set to the local branch or ref used for review, and a non-empty `local_fallback_reason`.
  - each repo entry's recorded `remote_fetch_status`, `local_fallback_reason`, and any `remote_fetch_error` or `remote_fetch_exit_code` fields are present or omitted according to the evidence-step schema and internally consistent with `resolved_base_source`: `remote_fetch_error` is present only when `remote_fetch_status: fetch_failed`, must be a categorized or sanitized summary rather than raw `git fetch` stderr, and must not contain URL credentials, userinfo, access tokens, or query strings; `remote_fetch_exit_code` is present only when `remote_fetch_status: fetch_failed` and an exit code is available. Do not treat those fields as live repository state that must be re-fetched or revalidated.
- Treat each stored `comparison_base_ref` as the already-resolved review base chosen by the evidence step and each stored `comparison_base_commit` as the pinned base object for review diffs. The ref may come from the remote-tracking version of the logical review base, or from an explicit local fallback when the remote path was unavailable. Do not re-resolve a different base in this step unless the review handoff is stale and must be regenerated.
- Use `comparison_base_commit...HEAD` for review diffs after confirming that `comparison_base_commit` still exists in the repository. Do not let a moving remote-tracking ref change the comparison for this review pass.
- Treat each stored `comparison_head_ref` as local `HEAD`. Review the local working branch against the stored comparison base, and do not compare `origin/<current-story-branch>` against the base.
- If any repository has `resolved_base_source: local_fallback`, preserve that fact in the findings artifact's residual-risk or rejected-risk notes so the review does not silently imply it used a fresh remote base.

</scope_rules>

<validation_rules>

Before doing findings work, validate all of the following:

- the canonical plan exists;
- the current repository branch state still matches the canonical plan story number;
- every repository in scope is still on a branch whose story number matches the canonical plan filename;
- every additional repository branch state was re-checked directly from git;
- the current repository HEAD and each additional repository HEAD were re-checked directly from git;
- the review handoff still matches the normalized current-plan scope and current repository state.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review-handoff checks fail, stop and say the review handoff is stale and must be regenerated.

</validation_rules>

<output_contract>

Write the findings to `codeInfoTmp/reviews/<review_pass_id>-findings.md`.

The findings file MUST:

- use findings-first ordering by severity;
- include file references;
- classify each finding as `must_fix`, `should_fix`, or `optional_simplification`;
- state for each finding whether it is a `plan_contract_issue` or a `generic_engineering_issue`;
- identify the affected repository scope for every finding using the reviewed repository roots or aliases.
- for every `must_fix` or `should_fix` finding, name the defect class and the most likely same-class sibling surfaces that should be checked next, or state explicitly why no meaningful sibling surface exists for that finding;
- include a short `Finding Saturation Seeds` section that records the likely same-class sibling files, mirrored producers or consumers, lifecycle-adjacent seams, proof-owner chains, or support-file families that a later bounded saturation pass should check before disposition;
- when no actionable findings exist, include a `Checked Defect Families` section that lists the main same-class defect families actively ruled out during the findings pass rather than implying they were never considered.

Cross-repository findings are valid when the issue only becomes visible when comparing two or more repositories together, even if each repository looks individually plausible.

If no findings exist:

- state that explicitly;
- still include the `Rejected Risk Notes` section;
- also record any residual risks or weak-proof areas.

Update the same handoff file so `findings_file` points to the exact findings artifact, and include any useful counts or disposition hints, including repo-local versus cross-repository grouping when relevant.

When updating the handoff, preserve all existing top-level fields and every existing `repos[]` entry exactly unless this step explicitly owns the field being changed. In particular, preserve `resolved_base_branch`, `resolved_base_source`, `logical_base_branch`, `remote_name`, `remote_fetch_status`, fetch-failed-only sanitized `remote_fetch_error` and `remote_fetch_exit_code`, `local_fallback_reason`, `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, `comparison_rule`, and `head_commit`.

This findings file is a high-quality local review artifact for the active flow run. It MUST NOT be committed.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff was normalized correctly.
- Confirm the canonical plan and story branch still match the scope.
- Confirm the review handoff still matches the current scope and HEAD commits.
- Confirm the review handoff still includes the local-HEAD-vs-resolved-base comparison metadata, including `comparison_base_commit`, for every repository and that any local fallback is carried into residual-risk notes.
- Confirm the plan-based review was completed for every repository in scope.
- Confirm the cross-repository integration pass was completed when required.
- Confirm the generic engineering pass and the adversarial review were both completed.
- Confirm the top 3 risky helpers/functions from the evidence artifact were inspected.
- Confirm the findings artifact includes `Rejected Risk Notes` for those risky helpers/functions.
- Confirm all findings include severity, issue type, and affected repository scope.
- Confirm every actionable finding includes a defect class plus likely same-class sibling surfaces, or an explicit reason no meaningful sibling surface exists.
- Confirm the findings artifact includes `Finding Saturation Seeds`, or `Checked Defect Families` when no actionable findings exist.
- Confirm any finding raised against allowed support files was either a wording issue or an explicit secret/artifact-hygiene issue.
- Confirm the findings file path and the handoff `findings_file` field match.

</verification_loop>

<final_response_rule>

- Never recommend reverting or removing the allowed support-file changes merely because they exist.
- Only call out spelling, grammar, obvious wording mistakes, or explicit secret/artifact-hygiene defects in those files.
- If no findings exist, still say that explicitly.

</final_response_rule>
