# Goal

Establish the shared operating contract for the full `task_up2` workflow before generating or rewriting tasks.

<instruction_priority>

- Follow `AGENTS.md` for the current repository and any participating additional repository.
- Treat this command as an autonomous tasking pass.
- Do not ask the user follow-up questions unless blocked by information that cannot be retrieved from repository files, git state, MCP tools, or official documentation.
- Keep the selected story in scope and aligned to the KISS principle.
  </instruction_priority>

<workflow_contract>

- Use fresh disk reads and current git state, not conversational memory.
- Complete each pass before moving to the next one; do not skip later traceability or testing audits because an earlier draft “looks good enough.”
- Keep using tools until the pass is complete and verified. If a lookup returns empty, partial, or suspiciously narrow results, retry with at least one better-targeted fallback before concluding there is no evidence.
- Prefer repository evidence first, then official documentation, then broader web research when needed.
- Preserve existing valid task structure and detail when rewriting; improve it rather than flattening it.
  </workflow_contract>

<completeness_contract>

- Treat the workflow as incomplete until every Acceptance Criterion, important Description requirement, and meaningful failure mode has a clear place in the task list or is explicitly kept out of scope by the story.
- Treat the workflow as incomplete until every important requirement has both an implementation home and a named proof home.
- Treat the workflow as incomplete until the final task list is understandable to a weak, junior, forgetful developer who may only read one subtask at a time.
  </completeness_contract>

<missing_context_policy>

- If required context is missing, gather it from repository files, git state, MCP tools, or official documentation before asking the user.
- If a prerequisite file, repository, or branch check fails, stop and report the exact blocker rather than guessing.
  </missing_context_policy>

<output_contract>

- Return tasks in the repository's plan format only.
- Keep wording concrete, scoped, and executable.
- Do not add filler sections, vague placeholders, or generic “update tests” instructions that hide the real work.
  </output_contract>

<mini_example>

- Good: “Subtask: Update `server/src/ingest/ingestJob.ts` to defer provider initialization until embedding work exists. Purpose: preserve metadata-only fast paths when provider bootstrap fails.”
- Bad: “Subtask: Fix ingest job behavior.”
  </mini_example>
