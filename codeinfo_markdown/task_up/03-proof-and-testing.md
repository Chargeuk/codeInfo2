# Goal

Audit the generated task list so every task has realistic proof, testing, and coverage requirements that match the affected repositories and projects.

<instruction_priority>
- Make proof paths realistic, runnable, and wrapper-first where possible.
- Do not invent commands, services, health checks, runtimes, or harnesses that are not supported by repository evidence.
- Keep testing proportional to the actual change surface.
</instruction_priority>

<source_priority>
- Read `AGENTS.md` first for repository-specific build, test, compose, and wrapper rules.
- If `repository_information.md` exists, use it to understand the product surfaces and runnable system shape.
- Inspect repository scripts and runtime files directly, including `package.json`, `docker-compose*`, Dockerfiles, Makefiles, justfiles, CI workflows, and test directories.
- Use `code_info` first for reusable testing patterns, harnesses, wrappers, and file locations.
- Use Context7, DeepWiki, and official web docs only when local evidence is not enough.
</source_priority>

<proof_and_testing_rules>
- For each affected repository or project, define proof in this order when applicable:
  1. build the relevant project or projects using the repository's primary Docker or Compose build path when the repository supports containerized builds;
  2. run the relevant automated tests;
  3. start the runnable system or required services if proof needs them;
  4. perform manual Playwright or browser automation only if the change has a user-visible or browser-accessible surface and the tooling exists;
  5. stop the system or services that were started for validation.
- Prefer wrapper scripts and wrapper-first workflows over low-level direct commands.
- If `AGENTS.md` defines wrapper-first workflows, use those.
- If no wrapper guidance exists, use the highest-level safe commands discoverable from the repository itself.
- If the repository already has a more specific testing-policy helper or documented proof order, generate the task testing steps to match that order rather than inventing a new one.
- If a proof step is not applicable, state why instead of inventing it.
- If a new harness is required, create an earlier task for that harness and include at least one proof step that demonstrates the harness itself is runnable.
- If a task changes behavior that needs explicit logs, screenshots, or other observable signals to prove, add those proof expectations.
</proof_and_testing_rules>

<coverage_rules>
- For back-end systems, plan unit tests plus Cucumber integration tests using Testcontainers as the primary integration-test path.
- For front-end systems, plan unit tests plus Playwright end-to-end tests, and include screenshot evidence where the UI can be checked visually.
- For systems where a back end is paired with a front end, include the Playwright end-to-end path plus manual Playwright MCP validation when the tooling exists.
- If any of those expected harnesses are missing for the system being changed, add the harness work early in the story before later tasks rely on it.
- Ensure the task list covers the happy path, error paths, recovery behavior, and meaningful corner cases where the story requires them.
- Add explicit test subtasks when code must be written or updated to create the proof.
- Ensure each relevant external library referenced by the tasking has an appropriate `Documentation Locations` entry, such as Context7, DeepWiki, or an official URL.
- Ensure cleanup, migration, compatibility, env/config, deployment, and observability work is covered when the story needs it.
- Ensure no task relies on a missing prerequisite capability; if one is missing, create or move the prerequisite task earlier.
- Ensure the regression surface is considered, not only the direct happy-path behavior.
</coverage_rules>

<verification_loop>
- Before finishing this pass, check whether each task's exit criteria can actually be proved by its testing steps.
- Check whether the necessary runtime, harness, dependencies, scripts, and repos will exist by the point each proof step is reached.
- Check whether each task's testing section reflects the task's repository and affected projects rather than copying a generic list blindly.
- Check whether the generated testing order matches the repository's primary proof workflow, including Docker or Compose build steps where those are the primary build mechanism.
</verification_loop>

<output_contract>
- Update tasks, subtasks, testing steps, and documentation references directly.
- Keep the testing sections generic in policy but specific in the commands and tooling that repository evidence supports.
</output_contract>
