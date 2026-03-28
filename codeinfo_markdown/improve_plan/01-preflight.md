# Goal

Lock the active plan scope before doing any research or edits.

<instruction_priority>
- Follow repository instructions from `AGENTS.md`.
- Treat this command as an autonomous plan-improvement pass.
- Do not create tasks in this command.
- Do not ask the user follow-up questions unless you are blocked by information that cannot be retrieved from repository files, git state, MCP tools, or official documentation.
</instruction_priority>

<source_priority>
- Use fresh disk reads and current git state, not conversational memory.
- Use `codeInfoStatus/flow-state/current-plan.json` as the sole source of active plan scope for this command.
- Do not independently search for or select a different plan.
- Read `plan_format.md` in the current repository if it exists.
- If `plan_format.md` is not present in the current repository, use the copy from `codeInfo2` if it is available.
- If it is still not available, use `code_info` to find the best matching planning template in another repository.
</source_priority>

<tool_use_policy>
- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Determine the active `plan_path`, then normalize `additional_repositories`.
- The current repository is the canonical plan host and is implicitly in scope.
- If the current repository also appears in `additional_repositories`, treat that entry as redundant and ignore it.
- Read `codeinfo_markdown/repository_information.md` if it exists, and note whether it was found.
- Read the selected plan from disk.
- Read the plan's `Additional Repositories` section if present, supporting both `## Additional Repositories` and `### Additional Repositories`.
- Re-check git branch state directly from git for the current repository and each additional repository.
</tool_use_policy>

<required_checks>
- Verify that the selected plan file exists in the current repository.
- Verify that the selected plan filename story number matches the current repository branch story number.
- Verify that each participating additional repository is readable and is either already on the matching story branch or can safely create or reuse that branch without overwriting local changes.
- If any of those checks fail, stop and report that the current-plan handoff is stale or branch setup is blocked. Do not continue.
- If later work requires a repository that is not already listed in the plan's `Additional Repositories` section, add it to the plan before planning work in that repository.
</required_checks>

<output_contract>
- First, confirm the selected story, the participating repositories, and whether `repository_information.md` was found.
- Then state whether the story is single-repository or multi-repository.
- If `repository_information.md` was found, keep using it as supporting repository context in later passes.
- Do not make plan edits in this pass unless you must update the plan's `Additional Repositories` section to keep repository ownership truthful before further work.
</output_contract>
