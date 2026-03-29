# Goal

Create or rewrite the task list so it is specific, sequenced, and executable by a junior developer without hidden assumptions.

<instruction_priority>

- Follow the shared workflow contract from `task_up/01-shared-contract.md`.
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
- Each task must implement exactly one primary seam that can be tested as a coherent unit.
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
- Every task must include a requirement-to-proof map in its subtasks: for each implemented acceptance path, name the exact code surface and the exact existing or new proof file(s) that will need to change.
- `Documentation Locations` must reference external docs, MCP docs, official URLs, or installed library code. Local repo files to inspect or change belong in Subtasks, not in Documentation Locations.
- Subtasks must name the relevant local files, folders, classes, functions, commands, configs, or runtime assets to inspect or update.
- Each subtask must be understandable in isolation for a very weak, junior, forgetful developer who may read only that one subtask and may not reliably cross-reference the rest of the plan.
- Repeat critical context, documentation references, commands, and expected outcomes inside a subtask when omitting them would force the implementer to infer missing information from other sections.
- Each documentation file update belongs in its own subtask.
- Each task should be detailed enough for a junior developer who may only read the current task and its subtasks.
- Add explicit proof-authoring subtasks whenever code must be written or updated to prove a requirement, edge case, error path, recovery path, or mixed-state path. Those subtasks must name the exact test file(s) or proof artifact(s) to create or edit.
- When a changed behavior could leave an existing test title misleading, add an explicit subtask to rename or rewrite that proof so the stated invariant still matches the assertions.
- When a UI surface changes enablement, visibility, mode gating, or create-vs-reuse behavior, add an explicit subtask for stale-state handling and proof that disabled or hidden state is either cleared or excluded from submission.
- Do not put build or test execution commands in Subtasks unless the task is specifically creating or repairing a harness or wrapper.
- When the repository workflow expects lint, format, or static-analysis checks as subtasks, add them as separate final subtasks with one explicit command per subtask. Each such subtask should state the exact command, the expected pass condition, and that any available auto-fix command should be tried before manual fixes.
  </task_shape_rules>

<verification_loop>

- Treat this pass as incomplete until every Acceptance Criterion, important Description requirement, and explicit Out Of Scope boundary has a plausible place in the task list or is explicitly marked out of scope by the story itself.
- Treat this pass as incomplete until each Acceptance Criterion, edge case, and meaningful failure mode has both implementation subtasks and named proof-authoring subtasks, even though the later Testing section may still execute only broad wrapper commands.
- If existing tasks are too large, split them only when the split improves clarity, sequencing, or proof without making the work more fragmented or less testable.
  </verification_loop>

<output_contract>

- Update the task list directly.
- Keep titles specific and sequencing explicit.
- Do not add filler sections or placeholder tasks.
  </output_contract>
