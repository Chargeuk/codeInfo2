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
  - its `repos` entries still match the selected repositories, current branch names, resolved base branches, and current HEAD commits.
- Treat each stored `resolved_base_branch` as the already-resolved review base chosen by the evidence step. It may come either from the repository default branch or from branch ancestry hinted by `current-plan.json`, so do not re-resolve a different base in this step unless the review handoff is stale and must be regenerated.

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

Cross-repository findings are valid when the issue only becomes visible when comparing two or more repositories together, even if each repository looks individually plausible.

If no findings exist:

- state that explicitly;
- still include the `Rejected Risk Notes` section;
- also record any residual risks or weak-proof areas.

Update the same handoff file so `findings_file` points to the exact findings artifact, and include any useful counts or disposition hints, including repo-local versus cross-repository grouping when relevant.

This findings file is a high-quality local review artifact for the active flow run. It MUST NOT be committed.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff was normalized correctly.
- Confirm the canonical plan and story branch still match the scope.
- Confirm the review handoff still matches the current scope and HEAD commits.
- Confirm the plan-based review was completed for every repository in scope.
- Confirm the cross-repository integration pass was completed when required.
- Confirm the generic engineering pass and the adversarial review were both completed.
- Confirm the top 3 risky helpers/functions from the evidence artifact were inspected.
- Confirm the findings artifact includes `Rejected Risk Notes` for those risky helpers/functions.
- Confirm all findings include severity, issue type, and affected repository scope.
- Confirm any finding raised against allowed support files was either a wording issue or an explicit secret/artifact-hygiene issue.
- Confirm the findings file path and the handoff `findings_file` field match.

</verification_loop>

<final_response_rule>

- Never recommend reverting or removing the allowed support-file changes merely because they exist.
- Only call out spelling, grammar, obvious wording mistakes, or explicit secret/artifact-hygiene defects in those files.
- If no findings exist, still say that explicitly.

</final_response_rule>
