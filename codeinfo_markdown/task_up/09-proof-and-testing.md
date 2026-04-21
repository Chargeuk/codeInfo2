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

- `Testing` must contain automated proof execution only.
- Manual Playwright, browser, or agent-driven validation does not belong in `Testing`; place optional later guidance in `Manual Testing Guidance` instead.
- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- When automated proof needs alternate auth, seeded identities, mocked providers, bypassed 2FA, or similar test-enablement seams, keep that enablement in test-only harnesses, fixtures, support code, or test configuration rather than in shipped production behavior.
- For each affected repository or project, define proof in this order when applicable:
  1. build the relevant project or projects using the repository's primary Docker or Compose build path when the repository supports containerized builds;
  2. run the relevant automated tests;
  3. if the automated proof path itself requires a running system or services, start only the runnable system or required services needed for that automated proof path;
  4. stop the system or services that were started for automated validation;
  5. when the task affects a runnable system, add an explicit smoke-proof step to start and then shut down the normal supported system path for that repository, using the non-agent-adjusted, non-e2e-adjusted runtime path unless repository evidence explicitly says a different normal path applies.
- Read `AGENTS.md` first for repository-specific wrapper, build, compose, startup, and shutdown guidance.
- Use `README.md` and `codeinfo_markdown/repository_information.md` as supporting evidence for the normal supported runtime path when they exist.
- Prefer wrapper scripts and wrapper-first workflows over low-level direct commands.
- If Docker or Compose wrapper paths are supported for the normal system, prefer those over local startup paths.
- If `AGENTS.md` defines wrapper-first workflows, use those.
- If no wrapper guidance exists, use the highest-level safe commands discoverable from the repository itself.
- If the repository already has a more specific testing-policy helper or documented proof order, generate the task testing steps to match that order rather than inventing a new one.
- If automated proof depends on starting a specific version, variant, mode, seeded environment, or test-support build of the system, state that explicitly and use the repository-supported path for doing so.
- Keep the normal-system smoke proof separate from any special runtime variant that may later be used for manual testing.
- If a proof step is not applicable, state why instead of inventing it.
- If a new harness is required, create an earlier task for that harness and include at least one proof step that demonstrates the harness itself is runnable.
- If a broad wrapper, Compose stack, Docker image, browser runtime, or shared service is known or likely to be an independent baseline dependency, separate its ownership from task-local proof. Add an earlier prerequisite task or explicit baseline proof step rather than letting unrelated baseline failures become ambiguous blockers inside every downstream task.
- For each task that includes full-suite or broad-wrapper validation, state the task-owned proof files or behavior that the wrapper is expected to cover. If failures outside those owners should become shared-baseline work, make that ownership boundary visible in the task wording.
- If a task changes behavior that needs explicit logs, screenshots, or other observable signals to prove, add:
  - proof-authoring subtasks for the code, tests, markers, or harness changes that make those signals available; and
  - automated `Testing` steps or optional `Manual Testing Guidance` entries that describe how those signals will later be observed.
- Automated screenshots, browser captures, and similar generated proof artifacts must be saved only under an ignored artifact location and must never be planned as checked-in repository files.
- If a task will rely on non-final manual-proof artifacts and the current repository does not already ignore `codeInfoTmp/`, add the minimal `.gitignore` update needed before later proof depends on that scratch path.
- When a non-final task needs manual-testing proof guidance, direct any manual-testing screenshots, logs, or similar proof artifacts to `codeInfoTmp/manual-testing/<story-number>/` and state that those artifacts must not be committed because `codeInfoTmp/` is ignored.
- End each task's `Testing` section with these two separate final steps in this order:
  - a lint step that names the exact repository-supported lint command and says to fix any issues found, using any supported auto-fix path before manual cleanup when available;
  - a prettier or format-check step that names the exact repository-supported prettier or formatting command and says to fix any issues found, using any supported auto-fix path before manual cleanup when available.
- Lint or prettier fixes that go beyond the narrow story scope are allowed when they are required to leave the repository in an honestly passing state.
- When the final task in the story has a runnable, browser-visible, or otherwise externally observable manual-proof surface, its `Manual Testing Guidance` must include story-specific startup and access guidance for the later `manual_testing_agent` pass.
- That guidance should name:
  - which system surfaces to start or use;
  - which prerequisite services or helpers must already be running;
  - the required startup order when multiple surfaces matter;
  - the supported login, seed, or setup path if one is needed for proof;
  - where credentials, seeded accounts, helper scripts, or env-backed access come from without inlining secrets.
- For the final task, direct any manual-testing screenshots, logs, or similar proof artifacts to `codeInfoStatus/manual-testing/<story-number>/` and state that those artifacts should be committed as durable final story proof.
- When manual testing is applicable, prefer the unmodified human Docker stack whenever repository evidence shows it is runnable, especially when supported access or credentials already exist for that normal stack.
- Only if the normal human Docker stack is not enough should the plan introduce the absolute minimum test-only harness or configuration needed for the `manual_testing_agent` to log on and prove the behavior, and that enablement must stay out of the shipped production code path.
- When manual or live-runtime validation is applicable, require guidance to name the supported stack, env files, mounted path namespace, ports, readiness checks, seed/setup source, and artifact destination. If those facts are not known during tasking, add a prerequisite runtime-handoff task or proof-authoring subtask instead of leaving the manual tester to discover them by failure.
  </proof_and_testing_rules>

<coverage_rules>

- For back-end systems, plan unit tests plus Cucumber integration tests using Testcontainers as the primary integration-test path.
- For front-end systems, plan automated unit tests plus automated Playwright end-to-end tests where supported.
- For systems where a back end is paired with a front end, keep automated browser proof in `Testing` and put any optional manual-testing-agent browser scenarios in `Manual Testing Guidance`.
- If any of those expected harnesses are missing for the system being changed, add the harness work early in the story before later tasks rely on them.
- Ensure the task list covers the happy path, error paths, recovery behavior, and meaningful corner cases where the story requires them.
- When a task changes constrained env/config parsing, ensure the proof covers valid input, blank or whitespace-only input, and out-of-range input where those cases affect runtime safety or correctness.
- When a task changes query/filter/bulk-selector logic in a large-repository or large-file path, ensure the proof covers the bounded strategy directly rather than only the small happy-path case.
- When a task changes persisted artifacts, cleanup paths, or stale-state handling, ensure the proof covers reader and writer compatibility, partial-state tolerance where relevant, and who is allowed to delete or reset state.
- When a task changes selectors, wrappers, startup paths, CI routing, or feature flags, ensure the proof demonstrates the changed behavior still runs through the repository's normal execution path instead of only a targeted or manual route.
- When a task changes lifecycle-sensitive orchestration, ensure the proof covers cancellation, retry, failure, or teardown behavior when those paths are relevant to the story.
- When a task changes ordering-sensitive lifecycle behavior, ensure the proof covers the exact transition ordering in one scenario, not only adjacent before-state and after-state assertions.
- When a task changes async coordination helpers or test-support utilities that register shared waiters, listeners, callbacks, subscriptions, or queue entries, ensure the proof covers timeout, rejection, cancellation, or early-return cleanup rather than only the successful resolution path.
- When a task changes fallback or precedence helpers that may compare stale persisted hints against fresh observed values, ensure the proof covers both the degraded-history path and the later successful path.
- Add explicit test-authoring subtasks when code must be written or updated to create the proof. Those subtasks must name the exact existing or new test files, proof artifacts, or screenshots to update for each acceptance path and important edge case.
- Explicit proof-authoring subtasks should describe creation or update of proof-owning files, screenshots, logs, or artifacts that are part of the implementation work.
- Do not create subtasks that depend on the results of those later automated testing steps.
- Do not turn routine `Implementation notes` refreshes into standalone subtasks.
- When a testing step produces a result that must be preserved in `Implementation notes`, express that as:
  - a requirement in the relevant `Testing` bullet; or
  - a task exit criterion that the note must be refreshed after the step completes.
- Do not create subtasks that are gated on "after Testing N finishes" unless the task is explicitly about authoring or repairing a harness or reporting workflow itself.
- When proof depends on renamed or repurposed tests, add an explicit subtask to rename or rewrite the proof so the test title and assertions still describe the same invariant.
- When UI state can become disabled, hidden, mode-gated, or resettable, require proof for stale-state behavior: whether the stale value must be cleared, retained locally, or merely excluded from submission.
- When caller behavior depends on the difference between raw SDK errors and wrapped or normalized errors, require proof for both paths and do not treat raw `AbortError` coverage as sufficient when production code may emit provider-specific wrapped abort codes instead.
- When automated proof relies on a repository-specific startup mode, seeded environment, test login helper, alternate config, or other test-support runtime path, ensure the task makes that setup explicit and routes proof through the repository's supported automated workflow rather than a one-off manual shortcut.
- Ensure each relevant external library referenced by the tasking has an appropriate `Documentation Locations` entry, such as Context7, DeepWiki, or an official URL.
- Ensure cleanup, migration, compatibility, env/config, deployment, and observability work is covered when the story needs it.
- Ensure no task relies on a missing prerequisite capability; if one is missing, create or move the prerequisite task earlier.
- Ensure the regression surface is considered, not only the direct happy-path behavior.
  </coverage_rules>

<verification_loop>

- Before finishing this pass, check whether each task's exit criteria can actually be proved by its testing steps.
- Check whether each task's implementation subtasks name the exact proof files that must be added or updated, instead of leaving the proof implied by only wrapper commands.
- Check whether broad wrapper, Compose, Docker, browser, or runtime proof has an explicit task-owned versus shared-baseline ownership boundary.
- Check whether manual/runtime guidance has enough current env, mount, port, seed, and artifact facts to avoid stale-handoff blockers.
- Check whether the necessary runtime, harness, dependencies, scripts, and repos will exist by the point each proof step is reached.
- Check whether each task's testing section reflects the task's repository and affected projects rather than copying a generic list blindly.
- Check whether the generated testing order matches the repository's primary proof workflow, including Docker or Compose build steps where those are the primary build mechanism.
- Check whether the generated testing order actually reaches the changed behavior through the repository's default launcher, wrapper, startup path, CI path, or selector flow when one exists.
- Check whether each subtask is specific enough for a weak developer to execute without guessing file targets, commands, documentation, or expected outcomes.
- Check whether mode-specific or stateful UI behavior has explicit proof for contradictory mixed states such as create-vs-reuse, run-vs-resume, and disabled or hidden field submission.
- Check whether required lint, format, and static-analysis subtasks are explicit, separate, and placed at the end of the subtask list when the repository workflow expects them there.
- Check whether each `Testing` section ends with explicit separate lint and prettier or format-check steps in that order.
- Check whether any planned auth or login test-enablement seam stays in test-owned harnesses or configuration rather than in the shipped production path.
- Check whether any automated screenshot or browser artifact path points only to ignored artifact storage rather than tracked repository files.
- Check whether any task that relies on non-final manual-proof artifacts also includes the required `.gitignore` update when `codeInfoTmp/` was not already ignored.
- Check whether any non-final-task manual-testing proof guidance uses `codeInfoTmp/manual-testing/<story-number>/` and states that those artifacts must not be committed.
- Check whether manual-testing guidance prefers the normal human Docker stack whenever repository evidence supports it.
- Check whether the final task's manual-testing proof guidance uses `codeInfoStatus/manual-testing/<story-number>/` and states that those artifacts should be committed.
  </verification_loop>

<output_contract>

- Update tasks, subtasks, testing steps, and documentation references directly.
- Keep the testing sections wrapper-first and specific in the commands and tooling that repository evidence supports, while keeping exact test-file references in the subtasks and proof map rather than stripping them out.
  </output_contract>
