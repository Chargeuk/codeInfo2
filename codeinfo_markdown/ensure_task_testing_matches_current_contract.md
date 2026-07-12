# Goal

Re-audit the testing and proof sections for every task in the active plan so they match the current repository-aware testing contract rather than stale or repository-specific defaults.

<instruction_priority>

- Rework task testing sections to match the current proof contract.
- Keep the testing guidance repository-aware and wrapper-first.
- Do not add manual testing steps here; manual testing is handled separately by the implementation flows.
- Keep `Testing` automated-only and place any optional manual-testing-agent scenarios in `Manual Testing Guidance`.
- Keep testing proportional to the actual change surface.
- Prefer updating review-created `__to_do__` tasks and newly added revalidation tasks first.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md` for every dedicated final task, regardless of its title or whether initial task-up, serious review task-up, or minor-fix-only task-up created it.
- Ensure every dedicated final task begins both `Subtasks` and `Testing` with the shared contract's non-checkbox repair-scope note before any checklist item; repair or add the note without treating it as another subtask or testing step.
- For runtime-contract changes touching `.env*`, `docker-compose*`, startup env loading, entrypoints, mounted-path mapping, or working-folder routing, do not accept healthchecks, env dumps, or contract-shape assertions alone as sufficient proof. Require preserved behavior proof or an explicit weak-proof note.
- Do not let testing lock in a newly invented runtime contract unless the plan also proves the previously working user-visible/runtime behavior still holds or documents an explicit approved migration.
- For newly added review-created `__to_do__` tasks, keep targeted task-local proof compact when a fresh final revalidation task explicitly owns full relevant regression proof for the current review-created findings block.
- Only update older `__done__` or `__in_progress__` tasks when a minimal testing-ownership, proof-path, dependency, or sequencing correction is required to keep the plan honest.
- If you add any new unchecked testing step or proof-owning unchecked subtask to a task that is currently `__done__`, you must reopen that task to `__in_progress__` unless a different prerequisite task now owns the next real work and the repaired task should honestly return to `__to_do__`.

</instruction_priority>

<source_priority>

- Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile testing-audit` before editing testing sections. This returns the required sections for every task without exposing unrelated task prose.
- Read `AGENTS.md` first for each repository whose tasks appear in the plan.
- Use `README.md` and `codeinfo_markdown/repository_information.md` as supporting runtime and product context when they exist.
- Inspect repository-native runtime and test entry points directly, including `package.json`, `docker-compose*`, Dockerfiles, Makefiles, justfiles, CI workflows, and test directories.
- Use `code_info` first for reusable test patterns, harnesses, wrappers, and proof locations when repository evidence is not enough.

</source_priority>

<testing_derivation_rules>

- Derive each task's testing section from that task's `Repository Name`.
- Treat `Repository Name` as the implementation owner, not automatically as the only repository whose proof matters.
- Exception: for any dedicated final validation or revalidation task, derive `Testing` from the whole story's affected repositories and components rather than from `Repository Name` alone.
- If the task belongs to `Current Repository`, use this repository's wrapper-first build, test, compose, startup, and shutdown workflows from `AGENTS.md`.
- If the task belongs to an additional repository, read that repository's `AGENTS.md` first and use that repository's supported workflows.
- When story correctness depends on compatibility with another repository, `Testing` may include proof for that additional repository even though the task's `Repository Name` still identifies only one implementation owner.
- Do not copy this repository's wrapper commands into another repository unless repository evidence shows that the external repository actually uses the same commands.
- If no wrapper guidance exists for a repository, use the highest-level safe commands discoverable from that repository's evidence rather than inventing low-level direct commands.

</testing_derivation_rules>

<review_created_task_rules>

- When a task is a newly added review-created `__to_do__` task from the current review-created findings block, do not add full broad build, test, browser, Compose, Docker, smoke, or wrapper proof to that individual task solely because normal story tasks would carry it.
- Keep the individual review-created task's `Testing` focused on the narrowest repository-supported automated proof that honestly reaches that task's changed behavior.
- This compact treatment is allowed only when a fresh final revalidation task exists after the review-created tasks and explicitly owns full relevant regression proof for the current review-created findings block across every affected repository.
- The final revalidation task must name every worked-on repository and affected component from the whole story and current review cycle. For each repository, list its discovered full build, applicable startup, every relevant repository-supported full automated suite including supported end-to-end suites, matching shutdown, supported lint, and supported formatting in that order, with unsupported commands omitted and no targeted filters.
- Use the final task's affected-surface inventory as the source of truth for `Testing`, even when it carries one administrative `Repository Name` for plan-format compatibility.
- If the final revalidation task is missing, vague, too narrow, or fails to own full relevant regression proof, repair that final revalidation task instead of duplicating broad proof across every review-created task.
- If targeted task-local proof cannot directly reach a review fix, or if that review-created task changes wrappers, harnesses, startup paths, default routing, runtime lifecycle, shared state, or cross-repository behavior, add the broader task-local proof needed for that task.
- Do not reduce proof coverage. Reduce only duplicated placement of broad regression proof when the final revalidation task owns that proof explicitly.

</review_created_task_rules>

<proof_and_testing_rules>

- For each non-final task's affected repository or project, define automated proof in this order when applicable:
  1. build the relevant project or projects using the repository's primary Docker or Compose build path when the repository supports containerized builds;
  2. run the relevant automated tests;
  3. if the automated proof path itself requires a running system or services, start only the runnable system or required services needed for that automated proof path;
  4. stop the system or services that were started for automated validation;
  5. when the task affects a runnable system, add an explicit smoke-proof step to start and then shut down the normal supported system path for that repository, using the non-agent-adjusted, non-e2e-adjusted runtime path unless repository evidence explicitly says a different normal path applies.
- Prefer wrapper scripts and wrapper-first workflows over low-level direct commands.
- When `Testing` spans more than one repository, group the proof steps by repository so it is obvious which wrappers and runtime rules belong to which repository.
- If Docker or Compose wrapper paths are supported for the normal system, prefer those over local startup paths.
- If the repository already has a more specific testing-policy helper or documented proof order, generate the task testing steps to match that order rather than inventing a new one.
- If automated proof depends on starting a specific version, variant, mode, seeded environment, or test-support build of the system, state that explicitly and use the repository-supported path for doing so.
- Keep the normal-system smoke proof separate from any special runtime variant that may later be used for manual testing.
- If a proof step is not applicable, state why instead of inventing it.
- If a new harness is required, create or preserve earlier prerequisite work for that harness and include at least one proof step that demonstrates the harness itself is runnable.
- If a task changes behavior that needs explicit logs, screenshots, or other observable signals to prove, add those proof expectations.
- Do not add manual Playwright, browser, or agent-driven validation steps here.
- Do not create subtasks that depend on future automated or manual proof output in order to become complete.

</proof_and_testing_rules>

<coverage_rules>

- Discover test categories from each participating repository rather than assuming back-end, front-end, Cucumber, Testcontainers, Playwright, or another framework. For a dedicated final task, require every supported full unit, integration, contract, behavior, component, system, end-to-end, or equivalent suite for each affected component.
- Keep repository-supported automated browser or system suites in `Testing` and put optional agent-driven manual scenarios in `Manual Testing Guidance`.
- If a story requires a proof category whose harness is missing, add or preserve prerequisite work in an earlier substantive task before the final task relies on it.
- Ensure the task list covers the happy path, error paths, recovery behavior, and meaningful corner cases where the story requires them.
- When a task changes constrained env/config parsing, ensure the proof covers valid input, blank or whitespace-only input, and out-of-range input where those cases affect runtime safety or correctness.
- When a task changes query/filter/bulk-selector logic in a large-repository or large-file path, ensure the proof covers the bounded strategy directly rather than only the small happy-path case.
- When a task changes persisted artifacts, cleanup paths, or stale-state handling, ensure the proof covers reader and writer compatibility, partial-state tolerance where relevant, and who is allowed to delete or reset state.
- When a task changes selectors, wrappers, startup paths, CI routing, or feature flags, ensure the proof demonstrates the changed behavior still runs through the repository's normal execution path instead of only a targeted or manual route.
- When a task changes lifecycle-sensitive orchestration, ensure the proof covers cancellation, retry, failure, or teardown behavior when those paths are relevant to the story.
- When automated proof relies on a repository-specific startup mode, seeded environment, test login helper, alternate config, or other test-support runtime path, ensure the task makes that setup explicit and routes proof through the repository's supported automated workflow rather than a one-off manual shortcut.
- Add explicit test-authoring subtasks to substantive tasks when code must be written or updated to create the proof. Never add those pre-planned subtasks to the dedicated final task.
- Ensure each relevant external library referenced by the tasking has an appropriate `Documentation Locations` entry, such as Context7, DeepWiki, or an official URL.

</coverage_rules>

<current_repository_appendix>

- When a task belongs to `Current Repository`, prefer this repository's summary wrappers and compose wrappers where they are applicable, such as:
  - `npm run build:summary:server`
  - `npm run build:summary:client`
  - `npm run test:summary:server:unit`
  - `npm run test:summary:server:cucumber`
  - `npm run test:summary:client`
  - `npm run test:summary:e2e`
  - `npm run compose:build:summary`
  - `npm run compose:up`
  - `npm run compose:down`
- Do not add narrow individual test commands by default when this repository's wrapper guidance says to use broader summary wrappers, but still keep exact test-file references in subtasks when they define what proof must be authored.
- Keep this appendix as a current-repository supplement only, not a global default for other repositories.

</current_repository_appendix>

<verification_loop>

- Before finishing, check whether each task's exit criteria can actually be proved by its testing steps.
- Check whether each task's testing section reflects that task's repository and affected projects rather than copying one repository's defaults blindly.
- Check whether the generated testing order matches the repository's primary proof workflow, including Docker or Compose build steps where those are the primary build mechanism.
- Check whether the generated testing order reaches the changed behavior through the repository's default launcher, wrapper, startup path, CI path, or selector flow when one exists.
- Check whether the necessary runtime, harnesses, dependencies, scripts, and repos will exist by the point each proof step is reached.
- Check whether each substantive task's implementation subtasks name the exact proof files that must be added or updated. For the dedicated final task, verify its supported per-repository lint and formatting subtask shape plus each worked-on repository's build, runtime, full-suite, shutdown, supported lint, and supported formatting testing inventory instead.
- Check whether newly added review-created tasks rely on compact targeted proof only when a fresh final revalidation task explicitly owns full relevant regression proof for the current review-created findings block.
- Check whether manual testing steps were avoided here so that manual validation remains owned by the implementation flows.
- Check whether no subtask now depends on future automated or manual proof output.
- Check whether every repository named in `Affected Repositories`, or otherwise required for compatibility proof, has at least one automated proof step or an explicit not-applicable reason.

</verification_loop>

<output_contract>

- Update task testing steps, related subtasks, and documentation references directly where needed.
- Keep the testing sections wrapper-first, Docker-preferred when supported, and specific to repository evidence.
- Keep summaries concise.
- Do not broaden older completed work beyond the minimal testing-honesty corrections needed to keep the active plan executable and truthful.

</output_contract>
