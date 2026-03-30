# Goal

Audit the generated task list so every task has realistic proof, testing, and coverage requirements that match the affected repositories and projects.

<instruction_priority>

- Follow the shared workflow contract from `task_up/01-shared-contract.md`.
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
- If any of those expected harnesses are missing for the system being changed, add the harness work early in the story before later tasks rely on them.
- Ensure the task list covers the happy path, error paths, recovery behavior, and meaningful corner cases where the story requires them.
- When a task changes constrained env/config parsing, ensure the proof covers valid input, blank or whitespace-only input, and out-of-range input where those cases affect runtime safety or correctness.
- When a task changes query/filter/bulk-selector logic in a large-repository or large-file path, ensure the proof covers the bounded strategy directly rather than only the small happy-path case.
- When a task changes persisted artifacts, cleanup paths, or stale-state handling, ensure the proof covers reader and writer compatibility, partial-state tolerance where relevant, and who is allowed to delete or reset state.
- When a task changes selectors, wrappers, startup paths, CI routing, or feature flags, ensure the proof demonstrates the changed behavior still runs through the repository's normal execution path instead of only a targeted or manual route.
- When a task changes lifecycle-sensitive orchestration, ensure the proof covers cancellation, retry, failure, or teardown behavior when those paths are relevant to the story.
- When a task changes async coordination helpers or test-support utilities that register shared waiters, listeners, callbacks, subscriptions, or queue entries, ensure the proof covers timeout, rejection, cancellation, or early-return cleanup rather than only the successful resolution path.
- When a task changes fallback or precedence helpers that may compare stale persisted hints against fresh observed values, ensure the proof covers both the degraded-history path and the later successful path.
- Add explicit test-authoring subtasks when code must be written or updated to create the proof. Those subtasks must name the exact existing or new test files, proof artifacts, or screenshots to update for each acceptance path and important edge case.
- When proof depends on renamed or repurposed tests, add an explicit subtask to rename or rewrite the proof so the test title and assertions still describe the same invariant.
- When UI state can become disabled, hidden, mode-gated, or resettable, require proof for stale-state behavior: whether the stale value must be cleared, retained locally, or merely excluded from submission.
- When caller behavior depends on the difference between raw SDK errors and wrapped or normalized errors, require proof for both paths and do not treat raw `AbortError` coverage as sufficient when production code may emit provider-specific wrapped abort codes instead.
- Ensure each relevant external library referenced by the tasking has an appropriate `Documentation Locations` entry, such as Context7, DeepWiki, or an official URL.
- Ensure cleanup, migration, compatibility, env/config, deployment, and observability work is covered when the story needs it.
- Ensure no task relies on a missing prerequisite capability; if one is missing, create or move the prerequisite task earlier.
- Ensure the regression surface is considered, not only the direct happy-path behavior.
  </coverage_rules>

<verification_loop>

- Before finishing this pass, check whether each task's exit criteria can actually be proved by its testing steps.
- Check whether each task's implementation subtasks name the exact proof files that must be added or updated, instead of leaving the proof implied by only wrapper commands.
- Check whether the necessary runtime, harness, dependencies, scripts, and repos will exist by the point each proof step is reached.
- Check whether each task's testing section reflects the task's repository and affected projects rather than copying a generic list blindly.
- Check whether the generated testing order matches the repository's primary proof workflow, including Docker or Compose build steps where those are the primary build mechanism.
- Check whether the generated testing order actually reaches the changed behavior through the repository's default launcher, wrapper, startup path, CI path, or selector flow when one exists.
- Check whether each subtask is specific enough for a weak developer to execute without guessing file targets, commands, documentation, or expected outcomes.
- Check whether mode-specific or stateful UI behavior has explicit proof for contradictory mixed states such as create-vs-reuse, run-vs-resume, and disabled or hidden field submission.
- Check whether required lint, format, and static-analysis subtasks are explicit, separate, and placed at the end of the subtask list when the repository workflow expects them there.
  </verification_loop>

<output_contract>

- Update tasks, subtasks, testing steps, and documentation references directly.
- Keep the testing sections wrapper-first and specific in the commands and tooling that repository evidence supports, while keeping exact test-file references in the subtasks and proof map rather than stripping them out.
  </output_contract>
