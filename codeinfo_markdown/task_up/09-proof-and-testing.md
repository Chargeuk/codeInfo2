# Goal

Audit the generated task list so every task has realistic proof, testing, and coverage requirements that match the affected repositories and projects.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md"`.
- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md"` for the dedicated final task's generic affected-surface discovery, two-subtask shape, and exhaustive full-suite testing rules.
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
- For the dedicated final task, inventory every application, service, workspace, package, or component changed across the whole story and list every repository-supported full automated suite for those surfaces. Include every supported end-to-end suite and do not use targeted filters.
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
- If manual testing for the task will write task-level proof artifacts into `codeInfoTmp/` and the current repository does not already ignore that scratch path, add the minimal `.gitignore` update needed before later proof depends on it.
- When a task needs manual-testing proof guidance, direct any manual-testing screenshots, logs, or similar proof artifacts to `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and state that those artifacts must not be committed because `codeInfoTmp/` is ignored.
- For Playwright MCP screenshots, Manual Testing Guidance should name both steps: capture to the Playwright output directory first, then transfer into the target repository's `codeInfoTmp/manual-testing/<story-number>/<task-number>/` scratch destination.
- For the codeInfo2 local harness workflow, when Playwright MCP artifacts are relevant, Manual Testing Guidance should say that any artifact saved under `/tmp/playwright-output/<relative-path>` inside the local Playwright MCP runtime will normally appear at `$CODEINFO_ROOT/playwright-output-local/<relative-path>` on the host. Generated guidance should use that host-visible path as the normal first lookup before transfer into `codeInfoTmp/manual-testing/<story-number>/<task-number>/`. If current runtime evidence points to a different artifact source or fallback runtime, tell the reader to inspect any available runtime handoff JSON for the needed artifact-source, fallback, and destination information by meaning rather than by exact property names. If screenshot transfer still fails, tell the later manual tester to record that limitation honestly and continue the proof pass with the best available evidence.
- If `Design Contract Present` is true and the task changes a browser-visible surface, Manual Testing Guidance must name:
  - the screenshot views to capture;
  - any explicit current-task visual requirements those screenshots must be compared against first, with the story plan or `Design Contract`, paired design markdown, and then supporting visual assets used only as fallbacks when the task is silent;
  - that screenshot capture alone is not sufficient and comparison notes are part of the proof;
  - that paired design markdown is canonical only relative to the supporting visual asset when paired markdown and visual design assets such as `*.png` or `*.svg` both exist for the same surface.
- If `Design Contract Present` is true and the task is the final task in the story, its `Manual Testing Guidance` must request screenshots for all implemented frontend surfaces across the whole story that can honestly be observed, along with the design assets those screenshots should later be compared against.
- When the final task re-covers the relevant visual surfaces in their current final state, its Manual Testing Guidance should treat those screenshots as the primary closeout screenshots for durable story proof. Earlier task screenshots should be retained in durable proof only when they remain uniquely necessary.
- Except for the dedicated final validation task, end each task's `Testing` section with these two separate final steps in this order:
  - a lint step that names the exact repository-supported lint command and says to fix any issues found, using any supported auto-fix path before manual cleanup when available;
  - a prettier or format-check step that names the exact repository-supported prettier or formatting command and says to fix any issues found, using any supported auto-fix path before manual cleanup when available.
- Lint or prettier fixes that go beyond the narrow story scope are allowed when they are required to leave the repository in an honestly passing state.
- In the dedicated final task, lint and formatting are the only two initial `Subtasks` and must not be duplicated in `Testing`.
- When the final task in the story has a runnable, browser-visible, or otherwise externally observable manual-proof surface, its `Manual Testing Guidance` must include story-specific startup and access guidance for the later `manual_testing_agent` pass.
- When the story includes a `Story Manual Testing Guidance` section above `# Tasks`, ensure the relevant story QA or final validation task explicitly covers any applicable story-level manual-proof expectations from that section.
- When `Design Contract Present` is true, ensure the final story-validation task explicitly carries forward the story-wide screenshot capture and design-comparison expectations even if earlier design-driven tasks already had narrower task-level guidance.
- When a task's honest manual proof depends on a paired or supporting repository, name that repository in `Story Manual Testing Guidance` or task-level `Manual Testing Guidance` when known so the later manual-testing pass can find the real proof surface quickly.
- This guidance should accelerate manual proof, not act as a hard repository allowlist.
- That guidance should name:
  - which system surfaces to start or use;
  - which prerequisite services or helpers must already be running;
  - the required startup order when multiple surfaces matter;
  - the supported login, seed, or setup path if one is needed for proof;
  - where credentials, seeded accounts, helper scripts, or env-backed access come from without inlining secrets.
- When `AGENTS.md` or `codeinfo_markdown/repository_information.md` defines repository-specific conditions that allow manual proof to be narrowed or skipped for certain surfaces, reflect the relevant condition explicitly in the final task's `Manual Testing Guidance` when that task could hit it during proof.
- For the final task, keep task-level manual-testing artifacts in `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and state that later story closeout promotes a curated durable bundle into `codeInfoStatus/manual-proof/<story-number>/`.
- When manual testing is applicable, prefer the unmodified human Docker stack whenever repository evidence shows it is runnable, especially when supported access or credentials already exist for that normal stack.
- Only if the normal human Docker stack is not enough should the plan introduce the absolute minimum test-only harness or configuration needed for the `manual_testing_agent` to log on and prove the behavior, and that enablement must stay out of the shipped production code path.
- When manual or live-runtime validation is applicable, require guidance to name the supported stack, env files, mounted path namespace, ports, readiness checks, seed/setup source, and artifact destination. If those facts are not known during tasking, add a prerequisite runtime-handoff task or proof-authoring subtask instead of leaving the manual tester to discover them by failure.
  </proof_and_testing_rules>

<coverage_rules>

- Discover test categories from each participating repository rather than assuming back-end, front-end, Cucumber, Testcontainers, Playwright, or any other framework. Include every supported full unit, integration, contract, behavior, component, system, end-to-end, or equivalent suite that exists for an affected surface.
- Keep automated browser or system proof in `Testing` when the repository defines it as a supported suite, and put optional agent-driven manual scenarios in `Manual Testing Guidance`.
- If a story requires a proof category whose harness is missing, add the harness work to an earlier substantive task before the final task relies on it. Do not add harness-authoring subtasks to the final task.
- Ensure the task list covers the happy path, error paths, recovery behavior, and meaningful corner cases where the story requires them.
- When a task changes constrained env/config parsing, ensure the proof covers valid input, blank or whitespace-only input, and out-of-range input where those cases affect runtime safety or correctness.
- When a task changes query/filter/bulk-selector logic in a large-repository or large-file path, ensure the proof covers the bounded strategy directly rather than only the small happy-path case.
- When a task changes persisted artifacts, cleanup paths, or stale-state handling, ensure the proof covers reader and writer compatibility, partial-state tolerance where relevant, and who is allowed to delete or reset state.
- When a task changes selectors, wrappers, startup paths, CI routing, or feature flags, ensure the proof demonstrates the changed behavior still runs through the repository's normal execution path instead of only a targeted or manual route.
- When a task changes lifecycle-sensitive orchestration, ensure the proof covers cancellation, retry, failure, or teardown behavior when those paths are relevant to the story.
- When a task changes ordering-sensitive lifecycle behavior, ensure the proof covers the exact transition ordering in one scenario, not only adjacent before-state and after-state assertions.
- When a task changes async coordination helpers or test-support utilities that register shared waiters, listeners, callbacks, subscriptions, or queue entries, ensure the proof covers timeout, rejection, cancellation, or early-return cleanup rather than only the successful resolution path.
- When a task changes fallback or precedence helpers that may compare stale persisted hints against fresh observed values, ensure the proof covers both the degraded-history path and the later successful path.
- Add explicit test-authoring subtasks to the owning substantive tasks when code must be written or updated to create the proof. Those subtasks must name the exact existing or new test files, proof artifacts, or screenshots to update for each acceptance path and important edge case. Do not add them to the dedicated final validation task.
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
- Check whether each substantive task's implementation subtasks name the exact proof files that must be added or updated. For the dedicated final task, check the affected-surface and full-suite inventory instead of expecting proof-authoring subtasks.
- Check whether broad wrapper, Compose, Docker, browser, or runtime proof has an explicit task-owned versus shared-baseline ownership boundary.
- Check whether manual/runtime guidance has enough current env, mount, port, seed, and artifact facts to avoid stale-handoff blockers.
- Check whether the necessary runtime, harness, dependencies, scripts, and repos will exist by the point each proof step is reached.
- Check whether each task's testing section reflects the task's repository and affected projects rather than copying a generic list blindly.
- Check whether the generated testing order matches the repository's primary proof workflow, including Docker or Compose build steps where those are the primary build mechanism.
- Check whether the generated testing order actually reaches the changed behavior through the repository's default launcher, wrapper, startup path, CI path, or selector flow when one exists.
- Check whether each subtask is specific enough for a weak developer to execute without guessing file targets, commands, documentation, or expected outcomes.
- Check whether mode-specific or stateful UI behavior has explicit proof for contradictory mixed states such as create-vs-reuse, run-vs-resume, and disabled or hidden field submission.
- Check whether required lint, format, and static-analysis subtasks are explicit, separate, and placed at the end of the subtask list when the repository workflow expects them there.
- Check whether each non-final task's `Testing` section ends with explicit separate lint and prettier or format-check steps in that order, and whether the dedicated final task keeps those commands only as its two initial subtasks.
- Check whether any planned auth or login test-enablement seam stays in test-owned harnesses or configuration rather than in the shipped production path.
- Check whether any automated screenshot or browser artifact path points only to ignored artifact storage rather than tracked repository files.
- Check whether any task that writes manual-testing proof artifacts into `codeInfoTmp/` also includes the required `.gitignore` update when that scratch path was not already ignored.
- Check whether any task-level manual-testing proof guidance uses `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and states that those artifacts must not be committed.
- Check whether any Manual Testing Guidance that mentions Playwright MCP screenshots distinguishes the Playwright output staging path from the final target repository artifact destination.
- Check whether any final-task screenshot guidance makes it clear which story-owned surfaces its latest screenshots are expected to supersede for durable closeout proof, while still leaving room to retain earlier screenshots that remain uniquely necessary.
- If `Design Contract Present` is true, check whether each design-driven task's manual-proof guidance requires screenshot-to-design comparison rather than screenshot capture alone.
- If `Design Contract Present` is true, check whether the final task's `Manual Testing Guidance` asks for story-wide screenshots that cover the whole implemented frontend surface area governed by the named design assets.
- Check whether manual-testing guidance prefers the normal human Docker stack whenever repository evidence supports it.
- Check whether the final task's manual-testing proof guidance still uses `codeInfoTmp/manual-testing/<story-number>/<task-number>/` for task-scoped artifacts and truthfully points durable story proof at `codeInfoStatus/manual-proof/<story-number>/`.
  </verification_loop>

<output_contract>

- Update tasks, subtasks, testing steps, and documentation references directly.
- Keep the testing sections wrapper-first and specific in the commands and tooling that repository evidence supports, while keeping exact test-file references in the subtasks and proof map rather than stripping them out.
  </output_contract>
