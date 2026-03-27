# Goal

Create or rewrite the task list so it is specific, sequenced, and executable by a junior developer without hidden assumptions.

<instruction_priority>
- Work from the active plan only.
- Do not leave investigation subtasks in the task list; investigations must be resolved now through repository evidence and documentation.
- Prefer the smallest set of tasks that fully implements the story without combining unrelated work.
</instruction_priority>

<source_priority>
- Use `code_info` first for repository facts, existing implementations, reusable patterns, contracts, likely file locations, cross-repository relationships, and how we or our company already solve similar problems across ingested repositories. Include the full repository path when asking about this repository.
- Inspect relevant local source files directly after `code_info`.
- If `repository_information.md` was found during preflight, use it as supporting product and repository context throughout this pass.
- Use DeepWiki for external GitHub repository architecture or docs when relevant.
- Use Context7 for library, SDK, and framework documentation when relevant.
- Use web search only when repository evidence plus official docs do not settle an external-library or runtime question.
</source_priority>

<task_generation_rules>
- If the story has no tasks, create them.
- If the story already has tasks, rewrite them where needed so they match the tasking rules below.
- Each task must implement exactly one change that can be tested as a coherent unit.
- Each task must belong to exactly one repository.
- If the story spans multiple repositories, split provider-repository and consumer-repository work into separate tasks and make the sequencing explicit.
- Add explicit task dependencies whenever a task relies on another task's output, contract, harness, migration, or shared library change.
- Keep prerequisite work earlier than downstream tasks that depend on it.
- Add cleanup or removal tasks when the story replaces or supersedes existing behavior.
- Add migration or compatibility tasks when the story changes contracts, storage, env vars, build/runtime wiring, or deployment behavior.
- Add observability or diagnosability work when the story would be difficult to prove or debug without it.
- Add documentation tasks only when the story actually changes documentation-relevant behavior, files, architecture, commands, contracts, or screenshots.
</task_generation_rules>

<task_shape_rules>
- Use the current `plan_format.md` structure.
- Every task must name its repository.
- Every task must include a concise Overview and a concrete Task Exit Criteria section.
- `Documentation Locations` must reference external docs, MCP docs, official URLs, or installed library code. Local repo files to inspect or change belong in Subtasks, not in Documentation Locations.
- Subtasks must name the relevant local files, folders, classes, functions, commands, configs, or runtime assets to inspect or update.
- Each documentation file update belongs in its own subtask.
- Each task should be detailed enough for a junior developer who may only read the current task and its subtasks.
- Do not put build or test execution commands in Subtasks unless the task is specifically creating or repairing a harness or wrapper.
</task_shape_rules>

<completeness_contract>
- Treat this pass as incomplete until every Acceptance Criterion, important Description requirement, and explicit Out Of Scope boundary has a plausible place in the task list or is explicitly marked out of scope by the story itself.
- If existing tasks are too large, split them only when the split improves clarity, sequencing, or proof without making the work more fragmented or less testable.
</completeness_contract>

<output_contract>
- Update the task list directly.
- Keep titles specific and sequencing explicit.
- Do not add filler sections or placeholder tasks.
</output_contract>
