# Goal

Use the stored current-plan handoff as the only source of plan scope for this step and summarize the active story for the manual tester without changing files.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use the stored `plan_path` and `additional_repositories` as the primary story context for this flow.
- For manual testing only, you may inspect and run other repositories when they are reasonably needed to perform honest proof for the active story.
- Do NOT use `code_info` tools for this step.
- Do NOT independently switch to a different story or plan.
- Do NOT make file changes in this step.
- After resolving the plan, run `python3 "$CODEINFO_ROOT/scripts/manual_testing_guidance_status.py"` and use its JSON output as the source of truth for whether story-level manual-testing guidance exists.

</critical_rules>

<scope_validation_rules>

- If `additional_repositories` is missing or empty, treat that as none.
- Treat the current repository as always in scope.
- If the current repository also appears inside `additional_repositories`, ignore that duplicate entry.
- Re-open the exact relative `plan_path` from disk before continuing.
- Verify that the selected plan file exists in the current repository.
- Verify that the story number in the current repository branch name matches the story number in the selected plan filename.
- Verify that every additional repository path is readable.
- Verify that every additional repository is either already on a branch whose story number matches the selected plan filename or can safely create or reuse such a branch without overwriting local changes.
- If manual proof appears to require another readable local repository that is not declared in `additional_repositories`, you may still investigate and use it for manual proof.

</scope_validation_rules>

<failure_contract>

If validation fails, do not guess or continue with a normal summary. Instead, clearly report exactly one of these outcomes:

- `current-plan handoff is stale and must be regenerated`
- `repository branch setup is blocked by local changes`

Do not use either outcome solely because manual proof may require a supporting repository outside `additional_repositories`.

</failure_contract>

<output_contract>

When validation succeeds, return a concise response that includes:

1. The selected story number and title.
2. The participating repositories when there is more than one.
3. A short overview of the story.
4. Whether story-level manual-testing guidance is present.
5. If story-level guidance is present, a short summary of its defaults.
6. What is still remaining to be done.
7. Any additional supporting repositories that manual proof may need beyond the declared story repositories, when that is already evident.

</output_contract>

<verification_loop>

- Confirm your response is based only on the stored handoff, direct disk reads, direct git checks, readable repository state in scope, and the `manual_testing_guidance_status.py` output.
- Confirm you did not rediscover a different plan.
- Confirm you did not make file changes.

</verification_loop>
