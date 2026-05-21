# Goal

Establish the shared operating contract for the full `improve_plan2` workflow before any plan-specific work begins.

<instruction_priority>

- Follow `AGENTS.md` for the current repository and any participating additional repository.
- Treat this command as an autonomous plan-improvement pass that keeps the selected story in scope.
- Do not create tasks in this command.
- Do not ask the user follow-up questions unless you are blocked by information that cannot be retrieved from repository files, git state, MCP tools, or official documentation.
  </instruction_priority>

<workflow_contract>

- Use fresh disk reads and current git state, not conversational memory.
- Complete each pass before moving to the next one; do not skip later verification just because an earlier pass looked sufficient.
- Keep using tools until the pass is complete and verified. If a lookup returns empty, partial, or suspiciously narrow results, retry with at least one better-targeted fallback before concluding there is no evidence.
- Prefer repository evidence first, then official documentation, then broader web research when needed.
- Preserve the current plan's functionality, structure, and scope unless evidence shows a concrete improvement is required.
  </workflow_contract>

<portability_and_safety_contract>

- Outside the plan's `Additional Repositories` section, never write full absolute filesystem paths into the plan.
- Use repository-relative paths, workspace-relative paths, logical repository locations, command names, environment-variable names, or documented lookup locations instead.
- When the story truly spans more than one local repository, keep each `Additional Repositories` entry as a concrete local repository path so downstream branch and handoff automation can resolve it from disk.
- Never copy machine-specific checkout roots, usernames, home-directory paths, or other developer-specific path material into checked-in planning text.
  </portability_and_safety_contract>

<design_contract_rules>

- A story has `Design Contract Present` when the plan explicitly names design-target assets intended as implementation references, such as final `*.png`, `*.svg`, `*.md`, a `## Design Contract` section, or a task-scoped design packet.
- If `Design Contract Present` is false, do not add design-specific planning requirements.
- If `Design Contract Present` is true and paired design markdown plus visual design assets such as `*.png` or `*.svg` both exist for the same surface, treat the markdown as canonical, treat the visual asset as supporting visual reference, and follow the markdown when they conflict.
- If `Design Contract Present` is true, treat the workflow as incomplete until the plan converts the provided design assets into explicit implementation obligations rather than leaving them as loose visual references.
- If `Design Contract Present` is true, the plan must name the relevant design files explicitly and map them to the story surfaces they govern.

</design_contract_rules>

<completeness_contract>

- Treat the workflow as incomplete until the selected plan is specific enough for a later tasking pass without hidden senior knowledge.
- Treat the workflow as incomplete until every relevant planning area is either improved with evidence-backed edits or explicitly confirmed not applicable.
- Do not stop after improving only the Description or only the Acceptance Criteria; all relevant plan sections must remain mutually consistent.
- If `Design Contract Present` is true, treat the workflow as incomplete until every named design asset has a concrete planning home, explicit visual invariants, and a later proof expectation.
- If `Design Contract Present` is true, treat the workflow as incomplete until the later final validation path is expected to capture full-story screenshots for every implemented frontend surface that those assets govern.
  </completeness_contract>

<missing_context_policy>

- If required context is missing, gather it from repository files, git state, MCP tools, or official documentation before asking the user.
- If a prerequisite file, repository, or branch check fails, stop and report the exact blocker rather than guessing.
  </missing_context_policy>

<output_contract>

- Keep outputs concise, evidence-backed, and directly tied to the selected plan.
- Do not add filler text to the plan.
- Preserve the existing plan format unless repository evidence shows a better matching format is required.
  </output_contract>

<mini_example>

- Good: “The plan says ‘handle retries’, but the repo evidence shows a required readiness endpoint and a Docker Compose prerequisite. Update the plan sections that describe runtime setup, proof order, and failure handling so a later tasking pass does not have to infer them.”
- Bad: “Add more details wherever the plan seems vague.”
  </mini_example>
