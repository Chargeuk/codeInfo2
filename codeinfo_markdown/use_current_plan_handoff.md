Use the stored current-plan handoff as the only source of plan scope for this step.

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- If `additional_repositories` is missing or empty, treat that as none.
- Treat the current repository as always in scope.
- If the current repository also appears inside `additional_repositories`, ignore that duplicate entry.
- Re-open the exact relative `plan_path` from disk before continuing.
- Verify that the selected plan file exists in the current repository.
- Verify that the story number in the current repository branch name matches the story number in the selected plan filename.
- Verify that every additional repository path is readable.
- Verify that every additional repository is either already on a branch whose story number matches the selected plan filename or can safely create or reuse such a branch without overwriting local changes.
- Do NOT use `code_info` tools for this step.
- Do NOT independently search for, infer, or select a different plan.
- Do NOT make file changes in this step.

If validation fails, do not guess or continue with a normal summary. Instead, clearly report one of the following outcomes:

- `current-plan handoff is stale and must be regenerated`
- `repository branch setup is blocked by local changes`

When validation succeeds, return a concise response that includes:

1. The selected story number and title.
2. The participating repositories when there is more than one.
3. A short overview of the story.
4. What is still remaining to be done.

Before finalizing, check that your response is based only on the stored handoff, direct disk reads, direct git checks, and readable repository state in scope.
