# Goal

Gather the minimum evidence needed to improve the active plan thoroughly and safely.

<instruction_priority>

- Do not create tasks.
- Keep the plan aligned to the KISS principle.
- Prefer upstream or shared fixes over downstream duplication when repository evidence supports that direction.
  </instruction_priority>

<source_priority>

- Use `code_info` first for repository facts, likely file locations, existing implementations, current contracts, reusable patterns, and how we or our company already solve similar problems across ingested repositories. Include the full repository path when asking about this repository.
- Inspect relevant local source files directly after `code_info`.
- If `repository_information.md` was found during preflight, use it as supporting product and repository context throughout this pass.
- Use DeepWiki for external GitHub repository architecture or documentation when relevant.
- Use Context7 for library, SDK, or framework documentation when relevant.
- Use web search only when repository evidence plus official docs do not settle an external-library, runtime, or deployment question.
  </source_priority>

<dependency_checks>

- Re-read the active plan from disk before researching so you are working from the current text.
- Determine whether the story is single-repository or multi-repository before applying cross-repository structure.
- If the story is single-repository, keep the normal single-repository style.
- If the story is multi-repository, gather evidence for provider and consumer responsibilities, dependency direction, sequencing, compatibility expectations, and repository ownership.
  </dependency_checks>

<research_checklist>

- Check whether the Description, Acceptance Criteria, and Out Of Scope sections are specific enough for a junior developer.
- Check whether any expected capability does not yet exist in the relevant codebases.
- Check for missing runtime seams, startup commands, HTTP listeners, readiness or health endpoints, environment-variable injection paths, deployment mappings, and Docker Compose prerequisites.
- Inspect every planned Docker, Dockerfile, and Docker Compose build/runtime path.
- Prefer code copied into Docker images over host-source bind mounts inside containers.
- Check whether the plan needs explicit Docker build-context ignore updates, explicit port choices, or Docker-managed volumes for generated artifacts.
- Check whether a new frontend or backend is actually required.
- If a backend is required or changed, ensure the plan expects unit tests and Cucumber integration tests that use Testcontainers as the primary integration-test path. If those harnesses are missing for the system being changed, add the prerequisite work early in the story before relying on them for new functionality.
- If a frontend is required or changed, ensure the plan expects frontend unit tests plus Playwright end-to-end tests with screenshot evidence where the UI can be checked visually, and manual validation using the Playwright MCP server when the tooling exists.
- If a backend is paired with a frontend, ensure the paired system includes the required Playwright end-to-end tests and manual Playwright MCP validation. If those harnesses are missing for the system being changed, add the prerequisite work early in the story before relying on them for new functionality.
- Check whether new message contracts or storage shapes are required.
- Check whether planned test types need new harnesses because the current repositories do not already support them.
- Check whether planned proof steps will be runnable at the point they are reached.
- Check for edge cases, failure modes, contradictions, and assumptions that are currently invalid.
  </research_checklist>

<classification_contract>

- For each major implementation area, classify findings internally as:
  - existing capability;
  - missing prerequisite capability;
  - invalid assumption;
  - not applicable.
- Do not dump raw notes into the plan unless they materially improve the plan.
  </classification_contract>

<completeness_contract>

- Treat this pass as incomplete until every relevant planning area above is either supported by evidence and ready to write into the plan, or explicitly marked not applicable.
- If a lookup returns empty, partial, or suspiciously narrow results, retry with at least one better-targeted fallback before concluding there is no evidence.
  </completeness_contract>

<output_contract>

- Make plan edits only when supported by evidence.
- Keep summaries concise and evidence-backed.
- Do not create tasks in this pass.
  </output_contract>
