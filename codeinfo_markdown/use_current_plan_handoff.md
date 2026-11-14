# Goal

Use the stored current-plan handoff as the only source of plan scope for this step and summarize the active story without changing files.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do NOT use `code_info` tools for this step.
- Do NOT independently search for, infer, or select a different plan.
- Do NOT make file changes in this step.

</critical_rules>

<scope_validation_rules>

- If `additional_repositories` is missing or empty, treat that as none.
- Treat the current repository as always in scope.
- If the current repository also appears inside `additional_repositories`, ignore that duplicate entry.
- Resolve the exact stored `plan_path` against the current working repository root (absolute paths remain absolute; relative paths may contain `../`) and re-open that exact file before continuing. Actual read failures limit the affected plan read; location outside the current repository is not a failure.
- Verify that the story number in the current repository branch name matches the story number in the selected plan filename.
- Verify that every explicitly listed additional repository path is readable. The plan-storage directory does not imply additional repository scope.
- Verify that every additional repository is either already on a branch whose story number matches the selected plan filename or can safely create or reuse such a branch without overwriting local changes.

</scope_validation_rules>

<failure_contract>

If validation fails, do not guess or continue with a normal summary. Instead, clearly report exactly one of these outcomes:

- `current-plan handoff is stale and must be regenerated`
- `repository branch setup is blocked by local changes`

</failure_contract>

<output_contract>

When validation succeeds, return a concise response that includes:

1. The selected story number and title.
2. The participating repositories when there is more than one.
3. A short overview of the story.
4. What is still remaining to be done.

</output_contract>

<verification_loop>

- Confirm your response is based only on the stored handoff, direct disk reads, direct git checks, and readable repository state in scope.
- Confirm you did not rediscover a different plan.
- Confirm you did not make file changes.

</verification_loop>
