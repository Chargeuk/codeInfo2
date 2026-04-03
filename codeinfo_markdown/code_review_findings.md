# Goal

Continue the current story review using ONLY the stored review handoff, perform the findings pass for every repository in review scope, and produce findings only.

<critical_rules>

- Do NOT discover the latest review artifact by timestamp.
- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` from disk and determine the canonical `plan_path`, then extract repository paths from `additional_repositories` and re-open the exact relative `plan_path` from disk.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- Then re-read `codeInfoStatus/reviews/<story-number>-current-review.json` from disk, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit the plan.
- If the review handoff checks fail, stop and say the review handoff is stale and must be regenerated. Do not edit the plan.
- This step MUST produce findings only and MUST NOT edit the plan yet.
- Do not commit in this step unless you were forced to make tracked changes to repair the review artifacts themselves.
- Treat `flows/**` as approved workflow-support paths. Do not raise findings solely because those paths changed without being named in the active plan, but continue to review them normally for workflow semantics and instruction safety.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- For those allowed support files, review ONLY for spelling, grammar, and obvious wording mistakes.

</critical_rules>

<scope_rules>

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus the repository paths extracted from `additional_repositories`.
- Read `codeInfoStatus/reviews/<story-number>-current-review.json` and verify that:
  - its `story_id` matches the story number derived from the canonical current-plan `plan_path` filename;
  - its `review_pass_id` is present;
  - its referenced evidence file exists;
  - its `repos` entries still match the selected repositories, current branch names, resolved base branches, and current HEAD commits.
- Treat each stored `resolved_base_branch` as the already-resolved review base chosen by the evidence step. Do not re-resolve a different base unless the review handoff is stale and must be regenerated.

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

<review_rules>

- For all changed files outside the allowed support-file set, review:
  - correctness against the story plan;
  - acceptance criteria coverage;
  - code quality;
  - maintainability;
  - performance;
  - security;
  - configuration/runtime correctness;
  - user-facing documentation portability;
  - documentation drift;
  - scope creep;
  - whether the code is more verbose or complex than needed.
- For multi-repository stories, you MUST also perform an explicit cross-repository integration pass after the per-repository review.
- Perform the plan-based review against the planned work and the branch diff for every repository in scope.
- After the plan-based review, perform a second pass that is not limited by the acceptance criteria and look for generic engineering defects in the changed code even if the canonical plan did not mention them.
- In that second pass, use the repository's current required adversarial checklist, including malformed-input handling, dropped diagnostics, wrapped-error mismatch, stale-hint precedence, dependency-before-proof fast paths, config-domain drift, leaked registrations, scale-shape growth, harness/execution-routing reachability, lifecycle ordering, shared-state interference, and before/after contract comparisons.
- For every changed API route, config shape, persisted artifact, wrapper output, or shared log marker/event schema outside the allowed support-file set, perform a before/after contract comparison and state whether the change is backward compatible, intentionally breaking, or unclear.
- Inspect the top 3 changed helpers/functions by review risk from the evidence artifact and explicitly challenge their most likely contradictory inputs or semantic mismatches.
- Write a `Rejected Risk Notes` section after the main findings list.
- If `codeInfoStatus/reviews/<review_pass_id>-blind-spot-challenge.md` already exists for this pass, read it and reconcile it with the findings output.
- For each risky path, state whether it has direct proof, indirect proof, or missing proof, and raise a finding when a risky path is only protected by happy-path coverage or is otherwise weakly proven.
- After the main correctness and adversarial review, run a narrow consistency and portability scan on changed non-support implementation files plus changed user-facing docs such as `README.md` or `docs/**`.

</review_rules>

<output_contract>

Write the findings to `codeInfoStatus/reviews/<review_pass_id>-findings.md`.

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

Update the same handoff file so `findings_file` points to the exact findings artifact, and include any useful counts or disposition hints.

This findings file is a durable review artifact that MUST be committed later so a human can inspect it after the story completes.

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
- Confirm no finding was raised against allowed support files for anything other than spelling, grammar, or obvious wording mistakes.
- Confirm the findings file path and the handoff `findings_file` field match.

</verification_loop>
