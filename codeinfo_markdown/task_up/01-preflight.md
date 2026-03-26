# Goal

Lock the active story, repository scope, and tasking format before generating or rewriting tasks.

<instruction_priority>
- Follow `AGENTS.md` for the current repository and any participating additional repository.
- Treat this command as an autonomous tasking pass.
- Do not ask the user follow-up questions unless blocked by information that cannot be retrieved from repository files, git state, MCP tools, or official documentation.
- Keep the work aligned to the KISS principle and do not future-plan beyond the selected story.
</instruction_priority>

<source_priority>
- Use fresh disk reads and current git state, not conversational memory.
- Use `codeInfoStatus/flow-state/current-plan.json` as the sole source of active plan scope.
- Do not independently search for or select a different plan.
- Read `codeinfo_markdown/repository_information.md` if it exists.
- Read `plan_format.md` in the current repository. If it is not present, use `code_info` to find the best matching format in `codeInfo2`, then another repository only if needed.
</source_priority>

<tool_use_policy>
- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Determine the active `plan_path`, then normalize `additional_repositories`.
- The current repository is the canonical plan host and is implicitly in scope.
- If the current repository also appears in `additional_repositories`, treat that entry as redundant and ignore it.
- Read the selected plan from disk.
- Read the plan's `Additional Repositories` section if present, supporting both `## Additional Repositories` and `### Additional Repositories`.
- Re-check git branch state directly from git for the current repository and each participating additional repository.
</tool_use_policy>

<required_checks>
- Verify that the selected plan file exists in the current repository.
- Verify that the selected plan filename story number matches the current repository branch story number.
- Verify that each participating additional repository is readable and is either already on the matching story branch or can safely create or reuse that branch without overwriting local changes.
- If any of those checks fail, stop and report that the current-plan handoff is stale or branch setup is blocked. Do not continue.
- Determine whether the story is single-repository or multi-repository before tasking.
- Determine whether the selected plan already contains tasks, and if so, whether those tasks already follow the current tasking format and repository-ownership rules.
</required_checks>

<output_contract>
- Confirm the selected story, participating repositories, whether `repository_information.md` was found, and whether the story is already partially or fully tasked.
- Do not create or rewrite tasks in this pass yet unless you must update the plan's `Additional Repositories` section to keep repository ownership truthful before later work.
</output_contract>
