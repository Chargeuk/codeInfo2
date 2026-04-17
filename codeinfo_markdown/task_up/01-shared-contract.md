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

<portability_and_test_boundary_contract>

- Never write full absolute filesystem paths into tasks, subtasks, testing steps, manual-testing guidance, or documentation references.
- Use repository-relative paths, workspace-relative paths, repository aliases, command names, environment-variable names, or other portable lookup directions instead.
- Never plan production-code changes whose only purpose is to disable, bypass, mock, or weaken real production behavior so automated or manual tests can run.
- When tests need alternate auth, seeded identities, mocked providers, bypassed 2FA, or similar test-enablement seams, keep that enablement in test-only code, fixtures, harnesses, or test configuration rather than in the shipped production code path.
- Automated-test screenshots and similar generated proof artifacts must be written only to ignored artifact locations and must never be planned as checked-in repository files.
- Manual-testing proof paths must stay repository-relative and use this split:
  - for any non-final task, manual-testing screenshots, logs, and similar proof artifacts belong in `codeinfoTmp/manual-testing/<story-number>/` and must not be committed;
  - for the final task, manual-testing screenshots, logs, and similar proof artifacts belong in `codeinfoStatus/manual-testing/<story-number>/` and should be committed as durable story-closeout proof.

</portability_and_test_boundary_contract>

<section_ownership_contract>

- Use this section contract everywhere in this workflow:
  - `Subtasks` contain only implementation work, proof-authoring work, documentation updates, config changes, and explicitly allowed code-hygiene work that the coding agent can complete before formal proof runs.
  - `Testing` contains only automated proof execution steps that the coding agent can run with repository-supported wrappers, commands, or harnesses.
  - `Manual Testing Guidance` contains optional, non-blocking guidance for the manual testing agent. It must not contain checkboxes, pass/fail gating language, or any requirement that blocks task completion.

</section_ownership_contract>

<phase_dependency_contract>

- Never create a subtask or testing step that requires manual testing to have already happened.
- Never create a subtask that requires automated test execution results to become complete.
- Subtasks may name the exact proof-owning files, log markers, fixtures, screenshot paths, or harness surfaces that must be prepared, but the generated proof output itself belongs to the later `Testing` phase or to optional `Manual Testing Guidance`.
- Do not create subtasks that say or imply `run automated tests`, `after Testing step N`, or `capture proof from the later test run`.

</phase_dependency_contract>

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
- Good: “Subtask: Extend `client/src/test/...` and the related proof marker wiring so later automated or manual validation can prove the stale-state fix.”
- Bad: “Subtask: Run Playwright and attach screenshots for the stale-state fix.”
  </mini_example>
