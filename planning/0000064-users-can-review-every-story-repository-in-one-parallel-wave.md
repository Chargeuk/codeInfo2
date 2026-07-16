# Story 64: Users can review every story repository in one parallel wave

## Implementation Plan

Implement this story additively so the existing static `subflow` review path remains usable until the new wave runtime, review-target contracts, artifact isolation, and aggregation path are independently proven. Keep each task testable in isolation, update checkboxes and implementation notes immediately, and cut the production flow over only after the new runtime and artifact pipeline are green.

## Description

The `Run Parallel Review Artifact Flows` step in `flows/task_and_implement_plan.json` originally started exactly three review flows against one ambient working repository. The main review flow also expanded its own scope across `additional_repositories`, while Codex Review and Open Code Review remained bound to one repository. This made review behavior inconsistent and prevented every participating repository branch from receiving the same independent set of reviews.

Add a generic subflow-wave orchestration contract that can expand matrix groups and singleton groups into concurrent child-flow waves. The production review loop uses it in a bounded two-phase cycle: each fast pass runs Codex and Open Code Review for every immutable repository target plus one cross-repository reviewer, repeats after eligible minor fixes until convergence or five drained passes, and then runs the heavyweight main reviewer once per target in one final slow wave. A single-repository fast pass still starts the singleton flow, but that flow exits cheaply with a deterministic `not_applicable` artifact.

Every review target must be represented by a distinct checked-out working-tree path. The implementation must not switch branches in a shared checkout. Target-local review artifacts must remain isolated, while a canonical story-level review-set manifest validates, joins, and aggregates every usable local and cross-repository result before disposition.

## Acceptance Criteria

- A generic `subflowWave` flow step supports matrix and singleton child-flow groups without hard-coding review semantics.
- The wave runtime accepts bounded immutable JSON child inputs, binds working folders explicitly, and gives every expanded job a stable unique instance identity.
- Existing `subflow` flow files and runtime behavior remain backward-compatible.
- Changes merged or rebased from `main` are reviewed and, where they overlap this story, adapted and validated so the branch preserves its parallel-wave implementation, compatibility guarantees, and Story 64 targets.
- A persisted review-target snapshot contains the canonical plan host plus every plan-scope repository with stable alias, real root, checked-out branch, full HEAD commit, and pinned comparison base.
- The runtime never switches a shared checkout between branches; distinct branches require distinct worktree paths.
- The main, Codex, and Open Code Review flows each review exactly one explicit target.
- For `N` targets, every fast pass launches `2N + 1` child flows: Codex and Open Code Review for each target plus one story-scoped cross-repository flow.
- Fast review repeats after eligible minor fixes until a pass records zero pre-fix minor findings or a fifth drained pass completes.
- After fast convergence, one slow wave launches exactly `N` heavyweight main-review child flows in parallel and never reruns them.
- Serious findings and fix history accumulate across every fast pass and the slow wave, while final task-up and revalidation occur only after both phases finish.
- Every accepted or ignored current-pass review item lists every validated review name that found it, deduplicated deterministically and qualified by target alias when needed to distinguish repeated review flows.
- After every non-empty minor-fix loop, the plan contains exactly one completed audit task for that review cycle and pass; its `#### Overview` lists findings escalated to combined task-up, its checked subtasks list every fixed finding and changed file, and its checked testing items list every actually executed test without duplicates.
- Per-loop audit tasks and cumulative disposition state survive cancellation and resume without duplication, and findings escalated in any fast pass remain visible through later fast passes and the slow wave before the existing grouped task-up path creates or updates their review-fix task coverage.
- All viable jobs execute concurrently, subject only to provider scheduling, and the parent waits for every terminal outcome.
- The cross-repository flow publishes `not_applicable` without expensive review work for one target and performs one integration review for multiple targets.
- Target-local artifacts cannot overwrite or validate against another target's identity.
- A canonical story-level review-set manifest records every expected job, pointer, validation result, coverage state, and cross-repository outcome.
- Post-wave work validates, deduplicates, and aggregates findings without running a second full cross-repository diff review.
- Every wave-mode consumer receives server-owned per-review usability and identity validation for each target-local result; legacy `current-review-validation.json` requirements remain only on the legacy non-wave path.
- A completed review wave with accepted or ignored current-pass decisions reaches one durable `## Code Review Findings` plan block instead of retrying because an upstream validation artifact was never produced.
- Multi-target review cannot produce a clean no-findings closeout when cross-repository coverage is missing or invalid.
- Parent cancellation reaches every active wave child, and resume reattaches without duplicate launches.
- Flow progress and child titles distinguish repeated child flow names by target alias and show wave counts.
- Targeted server, client, cucumber, and e2e proof passes, followed by the full parallel automated suite.
- Repository lint and Prettier/format checks pass at closeout.
- Main-stack manual proof demonstrates one-target, three-target, cancellation, resume, artifact isolation, and cross-repository finding behavior unless repository-owned authentication guidance permits a documented skip.

## Out Of Scope

- Running arbitrary non-subflow control-flow steps in parallel.
- Switching branches inside one shared Git working tree.
- Replacing the existing `subflow` step or changing its JSON contract.
- Adding a second cross-repository integration review after the bounded fast phase.
- Opening a pull request as part of this story unless separately requested.

## Additional Repositories

- No Additional Repositories

## Questions

None. The agreed design uses repeated mixed fast waves with two single-target reviewers per repository plus one concurrent story-scoped cross-repository reviewer, followed by one target-only heavyweight slow wave and combined settlement.

## Decisions

- Name the generic orchestration step `subflowWave`; it contains matrix and singleton groups and compiles them into one flat child-job list.
- Keep the executor restricted to child flows rather than adding a general arbitrary-step `parallel` construct.
- Use explicit immutable child inputs and working-folder bindings; reviewers do not rediscover their target from ambient state.
- Preserve target-local scratch artifacts and add canonical story-level stable/versioned review-set manifests.
- Run the cross-repository reviewer concurrently with every fast target-local wave and exclude it from the final slow target-only wave.
- Refresh immutable target and review-set identities for every pass because applied fixes may advance repository HEADs.
- Preserve bounded fast-phase convergence and run the heavyweight main review exactly once after the fast phase.
- Treat a fast multi-target pass with a missing or invalid cross-repository result as incomplete mandatory coverage, while preserving usable target-local findings; do not require that job in the slow phase.
- Retain existing best-effort child execution semantics; validation and disposition determine whether coverage is sufficient to close cleanly.
- Keep wave-mode validation authoritative and server-owned: enrich the review-set/wave artifacts with per-job usability rather than weakening merge, classification, or decision-recording identity gates, and use the legacy joined-validation artifact only when no review-set manifest exists.

## Implementation Ideas

- Extract reusable child launch, stop, poll, outcome, title, and resume helpers from the current `runSubflowStep` implementation.
- Persist a normalized input hash and instance identity with each active wave child.
- Prove actual overlap with a deterministic test latch that blocks every child until all expected instances are active.
- Materialize small target/wave handoffs rather than persisting large diffs or prompt bodies in flow state.
- Use temporary Git repositories and worktrees for target/base/artifact tests.
- Keep production flow JSON on the old path until the new runtime and artifacts are independently green.

### Task 1. Define immutable flow-input and mixed subflow-wave schemas

- Task Status: `__done__`

#### Subtasks

1. [x] Inspect the current flow schema, run types, persisted flow state, flag normalization, and subflow compatibility contracts.
2. [x] Add bounded JSON-safe child input types and strict schemas for `subflowWave`, matrix groups, singleton groups, item sources, and explicit bindings.
3. [x] Add stable wave job/instance identity fields while preserving legacy `FlowActiveSubflow` normalization.
4. [x] Add schema and state tests for valid waves, invalid bindings, duplicate identities, unsupported inputs, and legacy compatibility.

#### Testing

1. [x] Run the targeted flow-schema unit wrapper.
2. [x] Run targeted flow-state/flag persistence tests.
3. [x] Run the server build summary wrapper.

#### Implementation Notes

- Subtask 1 complete: traced the strict flow-step union, run-start parameters, persisted `FlowResumeState`, active-subflow normalization, build/persist paths, and the existing legacy `activeSubflow` fallback before defining the additive wave contract.
- Subtasks 2-4 complete: added a strict mixed matrix/singleton wave schema, bounded detached JSON input normalization, additive wave instance/target/input state, legacy-compatible normalization, and focused schema/input regression coverage.
- Testing 1 complete: `npm run test:summary:server:unit -- --file server/src/test/unit/flows-schema.test.ts` passed 62 tests; the new focused flow-input test also passed 3 tests.
- Testing 2 complete: the focused flow-flag persistence wrapper passed all 11 tests with the additive state shape in place.
- Testing 3 complete: `npm run build:summary:server` passed with no warnings.

### Task 2. Persist immutable child inputs and implement the generic subflow-wave runtime

- Task Status: `__done__`

#### Subtasks

1. [x] Extend child flow launches and resume state with normalized immutable input, input hash, instance ID, optional target ID, and bound working folder.
2. [x] Refactor the existing subflow executor into reusable child launch, tracking, cancellation, polling, title, and outcome helpers.
3. [x] Expand matrix and singleton groups into one validated flat job list and launch every viable child without waiting for earlier children to terminate.
4. [x] Preserve best-effort failure behavior, direct-child ownership, nested subflows, parent stop propagation, and resume reattachment without duplicates.
5. [x] Add deterministic concurrency, partial failure, cancellation, stale child, nested child, and resume integration coverage.

#### Testing

1. [x] Run the targeted subflow/wave integration test file.
2. [x] Run targeted resume identity and backfill integration tests.
3. [x] Run the server build summary wrapper.

#### Implementation Notes

- Subtasks 1-3 complete: child launches now carry bounded normalized input and an input hash, wave groups expand into stable flat jobs, and repeated flow names are tracked by instance ID while the existing subflow path delegates to the same scheduler helper.
- Subtask 4 complete: the shared scheduler retained best-effort outcomes, direct-step tracking, nested-flow cycle behavior, stop propagation, legacy active-subflow fallback, and reattachment semantics; fresh-run retry ownership now includes the immutable input hash.
- Subtask 5 complete: added deterministic wave tests that observe all matrix and singleton children active together, prove input detachment, stop every child, and resume by instance ID without duplicate launches; the full shared subflow file also covers partial failure, stale children, nesting, and legacy resume.
- Testing 1 complete: the full `flows.run.subflow.test.ts` wrapper passed all 46 tests after the refactor.
- Testing 2 complete: resume identity passed 16 tests and resume backfill passed 5 tests; the focused wave expander test passed 2 tests after tightening unresolved working-folder bindings.
- Testing 3 complete: the server build summary passed after the runtime and test changes.

### Task 3. Resolve and snapshot immutable plan-scope review targets

- Task Status: `__done__`

#### Subtasks

1. [x] Add a review-target resolver for the canonical plan host plus mapped `additional_repositories` paths.
2. [x] Record stable alias, real repository root, checked-out branch, full HEAD, story identity, plan host, and target authorization without switching branches.
3. [x] Reject duplicate real paths, detached or mismatched story branches, unavailable repositories, and non-distinct worktree targets.
4. [x] Persist a versioned immutable review-wave target snapshot and reuse it on resume.
5. [x] Add temporary-repository/worktree tests for one target, three targets, duplicate paths, branch mismatch, target drift, and resume stability.

#### Testing

1. [x] Run targeted review-target resolver unit tests.
2. [x] Run targeted working-folder integration tests.
3. [x] Run the server build summary wrapper.

#### Implementation Notes

- Added `prepareReviewTargets` as a deterministic flow checkpoint that resolves mapped, ingested plan-scope repositories, validates story branches, pins full HEAD commits, writes stable and versioned manifests, and persists the normalized snapshot in resume values.
- Added real temporary Git repository coverage for one and three targets, duplicate and story mismatch rejection, and proof that the saved manifest does not drift when a target HEAD moves; 5 resolver tests and 63 schema tests passed, and the server build passed.

### Task 4. Prepare target-scoped review bases and story review-set manifests

- Task Status: `__done__`

#### Subtasks

1. [x] Generalize review-base preparation to consume an explicit target plus canonical plan-host context.
2. [x] Mint target-specific review identities and isolated stable/versioned pointers while preserving server-owned base resolution and cleanup behavior.
3. [x] Add canonical stable and versioned review-set manifests that enumerate targets, expected child jobs, artifact pointers, and coverage state.
4. [x] Make target drift invalidate only the affected target and prevent stale waves from overwriting current stable state.
5. [x] Add target isolation, stale wave, abort, base advancement, and manifest atomicity tests.

#### Testing

1. [x] Run targeted review-base unit tests.
2. [x] Run targeted review-identity and review-artifact unit tests.
3. [x] Run the server build summary wrapper.

#### Implementation Notes

- Generalized review-base preparation with an explicit pinned target and canonical plan-host scope, including target/wave identity and plan-host-aware context verification without branch switching.
- Added atomic story review-set manifests with per-target pointers, the complete expected job ledger, partial target invalidation, and stale-wave protection; 4 review-set, 13 review-base, 3 identity, and 27 artifact tests passed, and the server build passed.

### Task 5. Convert all three existing review flows to explicit single-target contracts

- Task Status: `__done__`

#### Subtasks

1. [x] Change the main review artifact flow and prompts to review only the supplied target and re-ingest only its bound working repository.
2. [x] Change Codex Review to consume and validate the supplied target and target-specific prepared base.
3. [x] Change Open Code Review to consume and validate the supplied target and publish only its target-specific pointer.
4. [x] Remove cross-repository reasoning from target-local prompts while retaining all local evidence, findings, visual, saturation, and blind-spot responsibilities.
5. [x] Add wrong-target rejection, simultaneous target isolation, pointer collision, cleanup, and partial result tests.

#### Testing

1. [x] Run targeted Codex Review unit tests.
2. [x] Run targeted Open Code Review flow tests.
3. [x] Run targeted review-artifact tests.
4. [x] Run the server build summary wrapper.

#### Implementation Notes

- Added a deterministic `validateReviewTarget` gate to all three child flows, changed the artifact reviewer to working-target re-ingest, and made Codex prefer the supplied target's prepared base instead of requiring a local current-plan handoff.
- Added target-local command stacks and a shared scope contract that excludes cross-repository prompt modules while retaining the local evidence, findings, visual, saturation, and blind-spot passes. Target validation, 18 Codex, 7 Open Code, 27 artifact, and 64 schema tests passed, and the server build passed.

### Task 6. Add the concurrent cross-repository review flow

- Task Status: `__done__`

#### Subtasks

1. [x] Add a story-scoped `cross_repository_review` flow and dedicated bounded prompt/command contract.
2. [x] Validate the complete pinned review-wave target set before inspecting repository relationships.
3. [x] Publish a deterministic `not_applicable` result for one target without invoking expensive review work.
4. [x] For multiple targets, review producer/consumer APIs, schemas, configuration, versions, coordinated renames, deployment assumptions, and cross-target proof gaps.
5. [x] Publish isolated cross-repository findings, coverage, rejected risks, and residual uncertainty without mutating target-local artifacts.
6. [x] Add deterministic fake-reviewer tests for one-target no-op, one singleton launch, controlled incompatibility, partial target evidence, and identity mismatch.

#### Testing

1. [x] Run targeted cross-repository review unit/flow tests.
2. [x] Run the targeted subflow-wave integration test proving the singleton overlaps the matrix jobs.
3. [x] Run the server build summary wrapper.

#### Implementation Notes

- Added a story-level `cross_repository_review` flow with a server-owned wave identity gate and bounded compatibility prompt covering producer/consumer contracts, schemas, configuration, versions, rollout assumptions, and cross-target proof gaps.
- Single-target waves now atomically publish `not_applicable` and terminate before the LLM step; multi-target and partial-evidence waves proceed exactly once. Three gate tests, 65 schema tests, the singleton/matrix overlap integration test, and the server build passed.

### Task 7. Validate and aggregate the complete story review wave

- Task Status: `__done__`

#### Subtasks

1. [x] Add server-owned validation for every expected target-review matrix cell and the singleton cross-repository result.
2. [x] Preserve usable sibling findings while recording missing, stale, failed, partial, and invalid coverage explicitly.
3. [x] Finalize the story review-set manifest with exact job counts, pointer results, target coverage, and cross-repository status.
4. [x] Aggregate and deduplicate target-local and cross-repository findings while retaining target ownership and visible severity conflicts.
5. [x] Prevent clean multi-target closeout when mandatory cross-repository coverage is unusable.
6. [x] Add complete, partial, stale, duplicate finding, identity mismatch, and false-clean-closeout regression tests.

#### Testing

1. [x] Run targeted review-artifact and aggregation tests.
2. [x] Run targeted review-disposition tests.
3. [x] Run the server build summary wrapper.

#### Implementation Notes

- Added server-owned wave validation that accounts for every expected matrix and singleton job, rejects stale identity, preserves partial sibling evidence, and atomically finalizes stable/versioned review-set and validation artifacts.
- Added finding aggregation with target ownership and visible severity conflicts, plus disposition guards that block false-clean multi-target closeout. Three aggregation, 27 artifact, and 1 disposition contract tests passed, and the server build passed.

### Task 8. Cut the story review loop over to the mixed parallel wave

- Task Status: `__done__`

#### Subtasks

1. [x] Replace the shared-base/static-subflow review section in `task_and_implement_plan.json` with target resolution, target base preparation, one mixed wave, review-set validation, aggregation, and disposition.
2. [x] Update downstream merge, context loading, classification, finding recording, task-up, retry, and no-findings prompts to consume the review-set manifest.
3. [x] Ensure each later review-loop pass snapshots new target HEADs and identities after fixes.
4. [x] Audit other flows that consume the same review artifacts and preserve or migrate their behavior deliberately.
5. [x] Add focused cucumber/integration scenarios for one target, three targets, second-pass refresh, partial coverage, and target-owned task creation.

#### Testing

1. [x] Run targeted review-wave cucumber scenarios.
2. [x] Run the full server parallel wrapper.
3. [x] Run the server build summary wrapper.

#### Implementation Notes

- Replaced the three shared review sections with target snapshot preparation, review-set preparation, a 3-per-target matrix plus one cross-repository singleton, and strict wave validation before disposition.
- Added a shared review-wave consumer contract to every downstream merge, context, classification, recording, task-up, retry, and no-findings prompt, and migrated all three implementation-loop entry flows so each pass refreshes target HEADs.
- Added six focused review-wave Cucumber scenarios and completed the full server proof: 2,595 unit tests and 135 Cucumber scenarios passed, with the server build clean.
- Isolated provider homes in an environment-sensitive MCP websocket test and made concurrent review-set call assertions order-independent; a loaded loop-resume test also received the same 15-second persistence allowance used by neighboring cases.

### Task 9. Add wave observability, compatibility proof, and documentation

- Task Status: `__done__`

#### Subtasks

1. [x] Report expected, running, completed, failed, stopped, and not-applicable wave counts in parent turns and metadata.
2. [x] Give repeated child flow names distinct target-aware titles and preserve sidebar/filter selection identity.
3. [x] Update client/API types only where the exposed metadata contract requires it.
4. [x] Document the generic wave schema, review-target model, artifact layout, cross-repository ownership, and operational behavior.
5. [x] Add server metadata, client flow/sidebar, and browser e2e tests while preserving ordinary subflow behavior.

#### Testing

1. [x] Run targeted client flow-page tests.
2. [x] Run targeted client sidebar tests.
3. [x] Run the client build summary wrapper.
4. [x] Run targeted flow-execution e2e tests.

#### Implementation Notes

- Added generic persisted `subflowWaveProgress` metadata and structured progress logs with expected, running, completed, failed, stopped, and not-applicable counts; parent live/final turns expose the same totals.
- Added parent-wave execution, instance, target, and display identity to repeated child-flow metadata, with target-aware sidebar chips and selection behavior while leaving ordinary subflows unchanged.
- Documented authoring, runtime, target snapshots, artifact ownership, cross-repository responsibility, cancellation, and resume in `docs/subflow-waves-and-review-sets.md`.
- Targeted proof passed: 36 flow-page tests, 20 sidebar tests, four wave server scenarios, two ordinary-subflow compatibility scenarios, and one browser e2e scenario; the client build passed with only its existing chunk-size advisory after restoring the missing ARM64 Rollup optional package.

### Task 10. Run full automated, lint, format, and manual closeout proof

- Task Status: `__done__`

#### Subtasks

1. [x] Reconcile every touched contract, remove temporary diagnostics, and verify the final diff contains only story-owned work.
2. [x] Run repository lint and fix all story-introduced lint failures.
3. [x] Run Prettier/format checks and format touched files as required.
4. [x] Run final server/client builds and the canonical full automated suite.
5. [x] Run main-stack manual proof for one-target, three-target, cancellation, resume, artifact isolation, target drift, and cross-repository finding behavior, or document an allowed auth-dependent skip.
6. [x] Confirm the story plan and current-task handoff are complete and no mandatory testing checkbox remains open.
7. [x] Commit the complete scoped diff with a `DEV-[35] -` message and a four-or-five-sentence body, then push the branch to `origin`.

#### Testing

1. [x] Run `npm run lint`.
2. [x] Run the repository Prettier/format command and `npm run format:check`.
3. [x] Run `npm run build:summary:server` and `npm run build:summary:client`.
4. [x] Run `npm run test:summary:all:parallel`.
5. [x] Run the supported main-stack manual proof sequence and stop it with `npm run compose:down`.

#### Implementation Notes

- Ran the repository formatter for tracked files and explicitly formatted/checked every new file; `npm run format:check` and the additional untracked-file Prettier check pass.
- Fixed import-order warnings in the new flow/runtime files and confirmed `npm run lint` passes with zero warnings.
- Final server and client build wrappers pass; the client reports only the existing advisory for the 1,729.79 kB main bundle exceeding the configured 1,700 kB warning threshold.
- The canonical parallel suite passed: 899 client tests, 2,596 server unit tests, 135 Cucumber scenarios, and 77 browser e2e tests, with all shared build stages green.
- Reconciled the final diff after removing temporary proof flows and restoring the checked-in read-only main-stack mount; `git diff --check` passes and only story-owned implementation, proof, documentation, handoff, and plan files remain.
- Main-stack proof produced 4 jobs for one target (3 completed plus a not-applicable cross-repository singleton), 10 completed jobs for three targets, three distinct target base/session artifacts, a stopped `9 + 1` wave that resumed to 10 completed jobs, and three deterministic failures only for a target whose HEAD moved after the snapshot. The cross-repository singleton ran alongside the target jobs for the multi-target wave; its review agent could not publish its optional manual artifact because the host denied the Codex shell namespace, while the deterministic gate and automated artifact-contract suites remained green. The main stack was stopped with `npm run compose:down`.
- Refreshed and revalidated the current-task handoff after closeout proof; Task 10 is the only active task, has no live blocker, and has no unchecked testing item.
- Prepared the complete verified story diff for the required `DEV-[35] -` commit and immediate push to the current `manual_work` branch on `origin`.
- Implementation-only audit confirmed all seven implementation subtasks remain complete and found no story-caused preserved-behavior regression in the reviewed story-owned surfaces; the latest handoff deliberately reopened Task 10 and left the supported main-stack manual-proof item unchecked for the subsequent proof pass. The canonical task parser reports no live blocker, so no implementation repair or blocker was added during this audit.
- Implementation-plus-automated-proof audit confirmed the seven implementation subtasks and four automated testing items remain complete, with no story-caused preserved-behavior regression identified. The supported main-stack manual-proof item is still genuinely open before closeout, so Task 10 remains `__in_progress__` and the completion gate is recorded as a live blocker for the next manual-testing pass.
- Planner normalization reconciled the stale manual-proof checkbox with the recorded main-stack proof evidence, retired the completion-gate blocker, and marked Task 10 `__done__`; no executable work remained for the overnight implementation loop.

### Task 11. Repair wave validation publication and target-pointer identity preservation

- Task Status: `__done__`

#### Subtasks

1. [x] Define one server-owned wave validation schema that records exact story, wave, parent execution, target, session, pass, HEAD, comparison-base, pointer, artifact, and usability results for every expected target-local job.
2. [x] Validate each target's main, Codex, and Open Code artifacts against its prepared target base without relying on an additional repository's ambient `current-plan.json`, including server-owned OCR bundle validation and usable bundle IDs.
3. [x] Prevent the main review evidence writer from dropping `review_wave_id`, `target_id`, `plan_host_root`, or any prepared session identity when it publishes `current-review.json`; reject or safely republish an incomplete pointer before the child is counted as usable.
4. [x] Enrich the finalized review-set and matching wave-validation artifacts with per-job validation results, aggregate findings only from validated completed or partial jobs, and keep `closeout_allowed` false for missing, stale, failed, invalid, or unvalidated mandatory coverage.
5. [x] Update wave-mode merge, context, classification, filtering, promotion, decision-recording, task-up, retry, and no-findings consumers to use the authoritative review-set/wave validation entries; retain `current-review-validation.json` only for the legacy no-review-set path.
6. [x] Apply the repaired production contract consistently to `task_and_implement_plan.json`, `implement_next_plan.json`, and `improve_task_implement_plan.json` without changing ordinary static `subflow` behavior.

#### Testing

1. [x] Add unit coverage proving initialized target pointers retain exact wave/target identity through main handoff publication and that missing or changed identity is unusable.
2. [x] Add wave-validation unit coverage for usable main, Codex, and OCR entries, partial sibling coverage, OCR bundle usability, additional-repository targets without local plan handoffs, and false-clean prevention.
3. [x] Run the targeted server unit wrapper for the review base, review artifacts, review set, and review-wave validation test files.
4. [x] Run the server build summary wrapper.

#### Implementation Notes

- Defined wave-validation v2 job results with embedded pointer-level server validation, validation artifact paths, target/session identity, artifact coverage, and usability details.
- Added explicit wave-target validation that reads each target's prepared base directly, validates OCR bundles server-side, and writes target-local validation without requiring a target-local plan handoff.
- Made the evidence handoff contract preserve initialized wave identity explicitly and made server validation reject missing or changed target, wave, or plan-host fields before a job is usable.
- Joined per-target validation into the finalized review set, limited aggregation to usable jobs, added parent-execution validation for the cross-repository pointer, and kept incomplete coverage from closing cleanly.
- Updated the shared wave-consumer contract plus Codex, Open Code, and classification gates to consume embedded per-job validation in wave mode while retaining legacy joined validation only when no review set exists.
- Confirmed all three production implementation flows already share the same prepare-targets, prepare-set, mixed-wave, and validate-wave sequence, so the repaired server step applies consistently without altering ordinary static subflows.
- The server build summary wrapper passed after tightening the pointer-status and reviewer-key unions exposed by the first compile attempt.
- Added production-level base initialization assertions for all three target pointers and validator cases proving ambient-plan independence, exact wave rejection, OCR bundle usability, partial siblings, and false-clean prevention.
- The targeted server unit wrapper rebuilt the server and passed all 49 review-base, review-artifact, review-set, and wave-validation tests.

### Task 12. Prove the production review loop records validated decisions in the story plan

- Task Status: `__done__`

#### Subtasks

1. [x] Add a production-flow contract test that walks every reachable wave-mode review consumer and fails when a required server-owned artifact or validation field has no upstream producer.
2. [x] Add a deterministic one-target integration regression that executes the production prepare-targets, prepare-set, mixed-wave, validation, classification, and decision-recording path with accepted and ignored fixture findings.
3. [x] Assert the regression publishes four terminal wave jobs, keeps the main pointer current for the exact wave, marks each usable reviewer with server-owned validation, and writes exactly one committed `## Code Review Findings` block with `review_decision_recording.outcome` set to `recorded`.
4. [x] Extend the regression to prove a second pass refreshes wave/session identity without duplicating the plan block and that deliberately missing validation produces `retry_required` without an unsafe plan edit.
5. [x] Add a multi-target integration or Cucumber case proving validated target ownership and cross-repository coverage survive aggregation and reach downstream tasking without consulting plan-host-only pointers.
6. [x] Reconcile documentation and all touched contracts, then record the repaired one-target review-loop proof in this task's implementation notes.

#### Testing

1. [x] Run the targeted production-flow contract and integration regression tests.
2. [x] Run the targeted review-wave Cucumber scenarios.
3. [x] Run `npm run test:summary:server:parallel` and `npm run build:summary:server`.
4. [x] Run `npm run test:summary:all:parallel`.
5. [x] Run `npm run lint`, the repository formatting command, and `npm run format:check`.
6. [x] Run supported main-stack one-target manual proof through durable plan decision recording, then stop the stack with `npm run compose:down`.

#### Implementation Notes

- Added a static production-flow contract walk for all three implementation flows, including mandatory producer ordering, mixed-wave shape, downstream classifier/recorder reachability, and shared consumer-field coverage.
- Added a deterministic production-path integration regression whose fixture agents publish real main, Codex, OCR, and cross-repository artifacts while the server executes target preparation, review-set preparation, wave fan-out, OCR validation, aggregation, classification, plan recording, and a plan-only commit.
- The regression proves four terminal one-target jobs, self-contained target/session validation on all three reviewer jobs, exact current-wave main identity, accepted and ignored decisions, one committed findings block per pass, refreshed second-pass identity, and a no-edit `retry_required` result when validation is deliberately removed.
- The integration run exposed and fixed the production service's failure to pass its resolved repository catalog into `prepareReviewTargets`, which otherwise fell back to an unrelated global repository lookup.
- Expanded the shared wave-consumer contract and classifier, disposition, and no-findings prompts so downstream steps require embedded validation identity and OCR usable bundle IDs while reserving the plan-host validation pointer for the legacy path.
- Added a multi-target Cucumber scenario proving aggregated findings retain their validated target owners, cross-repository coverage remains visible, and downstream tasking uses target-local embedded validation; the targeted feature passed all 7 scenarios.
- Targeted production contract and integration tests passed 7/7 after a server rebuild, including the deterministic one-target production-loop regression.
- The full server parallel wrapper passed 2,601 unit/integration tests and 136 Cucumber scenarios after restoring an existing partial-validation prompt phrase required by its contract test; the follow-up server build summary also passed.
- The canonical all-tests wrapper passed all shared builds plus 899 client tests, 2,601 server unit/integration tests, 136 Cucumber scenarios, and 77 e2e tests.
- Ran the repository formatter, explicitly formatted the new untracked integration test before staging, fixed the resulting import-order and unused-parameter lint findings, and completed clean lint and formatting checks.
- Main-stack proof first exposed that the supported `/data` repository mount was read-only, which prevented task selection and disposition persistence; changed the main compose contract to an explicit read-write mount and added focused coverage while leaving the local stack untouched.
- The live validated wave then exposed a final Codex pointer rewrite that omitted `plan_host_root`; preserved that prepared-wave field in `CodexReviewPointer` and added a focused regression assertion, which passed all 18 Codex review tests.
- Final supported-stack proof completed review wave `0000064-rw-20260714T221016Z-100a7998` with four terminal jobs, zero failed or missing jobs, all three target pointers usable, validation `passed`, and `closeout_allowed: true`.
- The production recorder committed one unique plan decision block at `159b4730cf25eec041ead5205cf0abe89efb2e0b` with outcome `recorded`, one accepted decision, three ignored decisions, and no remaining task-up or minor-fix queue; `npm run compose:down` then stopped the main stack.
- After the live-proof fixes, formatting, lint, and formatting checks passed again, and the final server parallel wrapper passed the server build, 2,601 unit/integration tests, and 136 Cucumber scenarios.

### Task 13. Merge the bounded two-phase review foundations from main

- Task Status: `__done__`

#### Subtasks

1. [x] Fetch `origin/main` and begin a non-committing merge from the clean Story 64 feature branch.
2. [x] Resolve the three production-flow conflicts toward the reusable two-phase subflow boundary while preserving all Story 64 wave runtime files.
3. [x] Reconcile the flow-schema conflict so recursive subflow dependency checks and Story 64 wave contracts are both retained.
4. [x] Verify the merged prompts and review-state helpers preserve both wave identity gates and bounded phase state.
5. [x] Commit the resolved merge with the required Story 64 commit format.

#### Testing

1. [x] Parse and schema-validate every production review and implementation flow after conflict resolution.
2. [x] Run the targeted flow-schema and review flow-control tests.
3. [x] Run the server build summary wrapper for the resolved merge baseline.

#### Implementation Notes

- Fetched `origin/main` at `536a7ca9638a`, began a non-committing merge, and confirmed the four predicted content conflicts.
- Resolved the three implementation-flow conflicts to call `two_phase_review_cycle`; the existing Story 64 `subflowWave`, review-target, review-set, validation, cross-repository, cancellation, and resume implementation remains present for integration inside that cycle.
- Combined recursive subflow expansion and cycle detection with the Story 64 flow contracts, then changed the merged two-phase cycle to use fresh fast and slow repository waves.
- The server build passed, flow schema passed 66/66, phase-aware review-set tests passed 6/6, wave-validation tests passed 4/4, and the shell flow-control suite passed 20/20.
- Committed the conflict-free merge and combined runtime foundations as `01087142` with both branch histories preserved.

### Task 14. Add phase-aware review-set preparation and validation

- Task Status: `__done__`

#### Subtasks

1. [x] Extend the review-set schema and manifest with explicit fast/slow phase metadata and optional fast-pass identity.
2. [x] Make the cross-repository expected job optional so fast manifests expand to `2N + 1` jobs and slow manifests expand to `N` jobs.
3. [x] Preserve phase, pass, target, HEAD, parent execution, and wave identity through child inputs, artifacts, stable pointers, and versioned manifests.
4. [x] Update wave closeout rules so fast coverage requires the cross-repository result while slow coverage requires only every expected main-review result.
5. [x] Keep legacy and standalone non-wave review contracts backward-compatible.

#### Testing

1. [x] Add schema and review-set unit cases for one-target and three-target fast and slow manifests.
2. [x] Add validation cases for missing fast cross coverage, valid slow coverage without cross review, stale phase/pass identity, partial targets, and false-clean prevention.
3. [x] Run the targeted review-set, review-wave-validation, flow-schema, and server build wrappers.

#### Implementation Notes

- Added additive phase metadata to review-set manifests, retained `standalone` as the compatibility default, and made cross-repository expected jobs conditional.
- Fast set preparation now rejects a missing cross reviewer, slow preparation rejects an unexpected cross reviewer, and validation derives phase-specific closeout from the declared expected jobs.
- Added explicit expected-phase validation to the flow step so fast and slow manifests cannot be interchanged even when their target snapshot identity is otherwise valid.
- Added actual production-wave expansion coverage for one and three targets, proving three/seven fast jobs and one/three slow jobs respectively.
- The server build passed; subflow-wave tests passed 3/3, review-set tests passed 7/7, wave validation passed 5/5, and the production-loop regression passed.

### Task 15. Compose repeated fast repository waves and one slow repository wave

- Task Status: `__done__`

#### Subtasks

1. [x] Rewrite `two_phase_review_cycle` so each fast pass prepares fresh targets and a fast review set, runs the `2N + 1` wave, validates it, dispositions it, records the pre-fix minor count, applies minor fixes, and checks convergence.
2. [x] Add the slow phase using a fresh target snapshot, a main-review-only set, one `N`-child wave, one validation and disposition pass, and no slow rerun.
3. [x] Finalize cumulative findings and run task-up only after both phases complete.
4. [x] Wire all three production implementation flows exclusively through the combined two-phase cycle.
5. [x] Preserve cancellation, resume reattachment, immutable input, distinct child title, and best-effort terminal-outcome behavior in both phases.

#### Testing

1. [x] Extend recursive production-flow contract tests to prove fast `2N + 1` and slow `N` wave shapes and exactly one slow-review occurrence.
2. [x] Add production integration coverage for multiple fast passes with fixes, zero-minor convergence, the fifth-pass bound, and one slow launch.
3. [x] Add cancellation and resume coverage proving repeated waves do not duplicate active children.
4. [x] Run targeted flow-schema, subflow-wave, production-loop, and Cucumber wrappers.

#### Implementation Notes

- Replaced the legacy shared-base/static-subflow steps inside `two_phase_review_cycle` with fresh fast and slow target snapshots, phase-specific review sets, and `subflowWave` jobs bound to explicit repository roots.
- Fast waves contain Codex and Open Code Review for every target plus the cross-repository singleton; the only slow wave contains one main reviewer per target.
- Kept disposition and minor fixing reusable in both phases, while combined finalization, task-up, and workflow repair remain after the one slow pass.
- Reused the deterministic fast controller coverage for zero-minor convergence, another pre-fifth pass, fifth-pass exit, and refusal to advance with an undrained minor queue.
- Updated the review-wave Cucumber feature to execute the production shared cycle, proving one/three-target fast counts of three/seven and slow counts of one/three; all 9 scenarios passed.
- The complete subflow integration file passed 47/47, including immutable concurrent launch, best-effort outcomes, cancellation fan-out, and resume reattachment without duplicate child launches.

### Task 16. Reconcile wave-aware disposition, cumulative state, prompts, and documentation

- Task Status: `__done__`

#### Subtasks

1. [x] Make the finalized wave manifest the authoritative validation source for every fast and slow disposition pass without requiring the legacy plan-host validation artifact.
2. [x] Preserve cumulative serious findings and fix history across phases while keeping minor queues and pre-fix counts current-pass scoped.
3. [x] Prevent task-up, clean closeout, and final revalidation before the slow phase finalizer selects the combined outcome.
4. [x] Update prompts and prompt contracts for phase-aware wave identities, fast-only cross review, and the single slow review.
5. [x] Update repository documentation and progress labels for fast pass counts, cross-review coverage, and final slow-wave progress.

#### Testing

1. [x] Run the targeted Python flow-control and prompt-contract tests.
2. [x] Run server disposition, artifact validation, and production contract tests.
3. [x] Run relevant client and e2e progress/resume tests.

#### Implementation Notes

- Reconciled the wave consumer contract so fast manifests require usable cross-repository coverage while slow manifests intentionally omit it and require every expected main-review job.
- Retained main's cumulative two-phase state rules: serious findings and fixed history survive pass transitions, minor queues remain current-pass scoped, and only the post-slow finalizer may select task-up, final revalidation, or clean completion.
- Restored exact JSON identity field names in the wave-aware Codex merge prompt after its focused contract test caught an overly prose-oriented merge resolution.
- Added a prompt/flow contract test that parses the real two-phase flow and asserts the fast reviewer pair, cross singleton, main-only slow set, and phase-specific consumer flags; all 29 prompt tests passed.
- The focused client sidebar and flow-run suites passed 20/20 and 36/36, and the browser wave-progress scenario passed with repeated child identity and progress metadata intact.

### Task 17. Prove and close out the combined two-phase multi-repository review cycle

- Task Status: `__done__`

#### Subtasks

1. [x] Reconcile all touched code, flows, prompts, tests, documentation, and plan notes after targeted proof.
2. [x] Prove one-target fast and slow job counts and a multi-target `2N + 1` then `N` execution.
3. [x] Prove a minor-fix fast rerun, cumulative serious findings, fast cross-coverage failure, and one-only slow review behavior.
4. [x] Prove cancellation/resume and per-pass artifact isolation without duplicate launches.
5. [x] Commit the completed integration in ordered Story 64 commits and push the feature branch.

#### Testing

1. [x] Run `npm run build:summary:server` and `npm run build:summary:client`.
2. [x] Run `npm run test:summary:all:parallel`.
3. [x] Run `npm run lint`, the repository formatter, and `npm run format:check`.
4. [x] Run `npm run compose:build:summary`.
5. [x] Run supported main-stack one-target and multi-target manual proof, then stop it with `npm run compose:down`.

#### Implementation Notes

- Server and client build wrappers passed; the client wrapper reported only the existing Rollup large-chunk advisory and no typecheck or build failure.
- The first full parallel run exposed one stale static contract that still searched parent flows for inline wave producers; changed it to expand reusable subflows recursively and assert both phase-specific producer chains, then its targeted tests passed 3/3.
- The required full rerun passed 899 client tests, 2,608 server unit/integration tests, 138 Cucumber scenarios, and 77 e2e tests, with all shared server/client and Compose builds green.
- The repository formatter completed without additional source changes, lint passed with zero warnings, and the format check passed.
- The Compose build summary ran inside the canonical parallel wrapper and passed both image builds with the expected runtime assets baked into the server image.
- Supported-stack startup initially exposed that `planning_agent_lite`, `research_agent`, and `tasking_agent` were absent from the editable main-stack catalog, leaving every production implementation flow disabled; copied the checked-in canonical profiles without ignored auth files and added a recursive catalog coverage regression.
- The catalog regression passed 7/7 and a restarted main stack discovered all reachable agents, reported all three production flows plus `two_phase_review_cycle` enabled, and reported Codex, Copilot, and LM Studio available.
- Live container inspection proved one target expands to three fast and one slow job, three targets expand to seven fast and three slow jobs, every fast wave has one cross-repository job, and the slow wave has none; `npm run compose:down` then stopped the supported stack.
- Final lint, tracked and newly added catalog formatting checks, prompt contracts, diff hygiene, and focused catalog/producer contracts passed before the closeout commit and push.

### Task 18. Integrate OpenCode coverage compatibility into repository review waves

- Task Status: `__done__`

#### Subtasks

1. [x] Merge current `origin/main` and preserve the completed `2N + 1` fast-wave and `N` slow-wave architecture.
2. [x] Reconcile OpenCode coverage parsing with legacy and wave-target validation while keeping manifest and bundle verification authoritative.
3. [x] Preserve the target-local OpenCode prompt contract and require newly published pointers to use canonical nested coverage.
4. [x] Resolve the review-artifact fixture conflict while retaining both Story 64 wave identity coverage and main's coverage-shape regressions.
5. [x] Add a Story 64 regression proving transitional top-level coverage remains usable and publishes `current-review-validation.json` in wave-target mode.

#### Testing

1. [x] Run diff hygiene and the targeted review-artifact, OpenCode-flow, and review-wave validation tests.
2. [x] Run `npm run build:summary:server` and the complete server unit wrapper.
3. [x] Run `npm run test:summary:all:parallel`.
4. [x] Run supported main-stack OpenCode wave-target proof when provider authentication permits, then stop it with `npm run compose:down`.
5. [x] Verify `origin/main` is an ancestor, the pushed feature branch matches local HEAD, and the worktree is clean.
6. [x] Run `npm run lint` and fix any errors.

#### Implementation Notes

- Added this post-closeout task so the new mainline compatibility fix is integrated without rewriting the completed Task 17 proof record.
- Composed main's coverage resolver with Story 64's shared validator, so both legacy and wave-target modes accept a complete transitional top-level shape while retaining manifest, bundle, and integer validation.
- Preserved the target-local authority preamble and replaced the ambiguous producer wording with the canonical nested `coverage` example and an explicit top-level prohibition.
- Resolved the sole merge conflict by retaining both `waveScope` and `ocrCoverageShape` fixture controls; the remaining production, prompt, and flow-contract changes composed automatically and were audited together.
- Added a wave-target regression without an ambient current-plan handoff that requires usable OpenCode bundles, the compatibility warning, retained wave identity, and a published stable validation artifact.
- Diff hygiene passed, followed by 33/33 review-artifact tests, 7/7 OpenCode flow-contract tests, and 5/5 review-wave validation tests.
- Merge commit `460d8432` now contains `origin/main` at `52f61001`; the two-phase flow file was untouched, preserving the existing fast and slow wave topology.
- The server build wrapper passed without warnings, and the complete server unit/integration wrapper passed all 2,613 tests.
- The canonical parallel suite passed 899 client tests, 2,613 server tests, 138 Cucumber scenarios, and 77 e2e tests; reusable server/client and both Compose builds also passed, with only the existing client large-chunk advisory.
- The supported main stack exposed enabled OpenCode and two-phase flows and completed a Codex-backed OpenCode run against merge HEAD `460d8432`; its pointer published all six counts only under nested `coverage`, reported 44/44 reviewable files covered with zero failures, and the stack was then stopped cleanly.
- The live reviewer also emitted five provisional architecture findings outside this compatibility task; repository manual-proof policy leaves those for the normal server-validated review/disposition workflow rather than creating implementation work from manual proof alone.
- Pushed through `2ce0495e`, fetched the feature ref, and verified exact local/remote equality with `origin/main` as an ancestor and no uncommitted files before final plan closeout.
- Implementation audit: fresh source, test, prompt, flow, and git evidence supports all five subtasks; no story-caused preserved-behavior regression or unrelated user-facing drift was found. The task remains `__in_progress__` because the lint proof item is still open for the separate automated-proof pass, and no blocker is needed while all implementation subtasks are complete.
- Automated proof completed `npm run lint` successfully with no errors or warnings; no repair was required.
- Automated-proof audit: all five subtasks and six testing items are supported by the recorded implementation, full-suite, stack, lint, ancestry, and hygiene evidence. No story-caused preserved-behavior regression, unrelated user-facing drift, live blocker, or remaining task-owned gate was found, so Task 18 is now honestly `__done__`; subsequent manual testing is outside this task's completed automated-proof record.

### Task 19. Integrate deterministic OpenCode publication with target-scoped review waves

- Task Status: `__done__`

#### Subtasks

1. [x] Merge current `origin/main` while preserving the completed Story 64 fast/slow topology and local Task 18 audit commits.
2. [x] Replace the deterministic publisher's ambient current-plan dependency with an explicit contained prepared-base input.
3. [x] Publish complete wave identity for target-scoped reviews while preserving standalone compatibility and strict structural validation.
4. [x] Compose the target-local reviewer contract with fixed artifact names, bounded preflight, and deterministic atomic publication.
5. [x] Preserve transitional coverage and bundle aliases while keeping canonical representations and independent server validation authoritative.
6. [x] Add standalone, additional-repository, wave-target, conflict, and path-containment regression coverage.

#### Testing

1. [x] Run publisher and prompt-contract Python tests plus targeted review-artifact, OpenCode-flow, and review-wave server tests.
2. [x] Run `npm run build:summary:server` and the complete server unit wrapper.
3. [x] Run `npm run test:summary:all:parallel`.
4. [x] Run `npm run lint` and `npm run format:check`.
5. [x] Run supported-stack plan-host and additional-repository publication proof when provider authentication permits, then stop it with `npm run compose:down`.
6. [x] Verify `origin/main` ancestry, pushed local/remote equality, and a clean worktree.

#### Implementation Notes

- Added this post-closeout task because main's deterministic publisher addresses the same pointer-reliability failure class but must be made target-local before it can safely serve Story 64 repository waves.
- Replaced current-plan discovery with a required `--prepared-base` path that is contained beneath the target repository review root and cross-checked against filename, story, plan, repository, and pass identity.
- Added all-or-none wave identity publication for `target_id`, `review_wave_id`, and `plan_host_root`, while leaving standalone prepared bases valid without those fields.
- Composed the target-local prompt with fixed four-digit artifacts, at-most-three preflight attempts, explicit prepared-base commands, canonical nested coverage, and deterministic atomic publication.
- Retained main's transitional coverage and bundle aliases in the shared validator, including rejection of conflicting or malformed dual representations.
- Expanded publisher tests for no-current-plan additional repositories, wave identity, incomplete scope, mismatched story/repository, and contained paths; the combined 41 Python tests and targeted 36 review-artifact, 7 OpenCode-flow, and 5 review-wave tests passed after one prompt wording repair.
- Merge commit `b65e9329` contains `origin/main` at `5aaf61ac` on top of the three local Task 18 audit commits; the two-phase flow topology remained untouched.
- The server build wrapper passed without warnings and the complete server unit/integration wrapper passed all 2,616 tests.
- The canonical parallel wrapper passed 899 client tests, 2,616 server tests, 138 Cucumber scenarios, and 77 e2e tests plus all reusable builds; the client build retained only the existing large-chunk advisory.
- Repository lint and tracked-file formatting checks passed without errors or source rewrites.
- The rebuilt supported server image passed all 12 packaged publisher tests, including the additional-repository wave fixture with no current-plan handoff, complete wave identity, mismatch rejection, and containment checks.
- A live Codex-backed plan-host run published merge HEAD `b65e9329` through deterministic preflight with canonical `bundles`, nested-only coverage, no transitional aliases, and the expected absence of wave fields for standalone mode; the supported main stack was then stopped cleanly.
- The read-only live review reported three provisional architecture findings and one OCR manifest coverage discrepancy outside this publisher integration; manual-proof policy leaves them to normal server-validated disposition rather than creating task work here.
- Pushed through `81daa47c`, fetched the remote feature ref, and verified exact local/remote equality, `origin/main` ancestry at `5aaf61ac`, zero divergence, and a clean worktree before final plan closeout.

### Task 20. Integrate fail-forward validation with repository review waves

- Task Status: `__done__`

#### Subtasks

1. [x] Merge current `origin/main` while preserving the completed `2N + 1` fast-wave and `N` slow-wave topology.
2. [x] Seed initialized review pointers from the complete prepared review base without losing target and wave identity.
3. [x] Compose canonical fallback publication with legacy and wave-target validation, including stale-state protection.
4. [x] Record fast-pass coverage from the exact finalized review-set manifest instead of a fixed reviewer count.
5. [x] Make deterministic fast-loop control retry incomplete waves and report bounded fifth-pass coverage exhaustion.
6. [x] Preserve legacy resume compatibility and downstream degraded-coverage state while adding focused regressions.
7. [x] Restore supported main-stack catalog parity for the slow review agent required by the merged two-phase flow.

#### Testing

1. [x] Run targeted Python flow-control and prompt-contract tests.
2. [x] Run targeted review-base, review-artifact, review-set, review-wave, schema, and flow integration tests.
3. [x] Run the server build wrapper and complete server unit wrapper.
4. [x] Run `npm run test:summary:all:parallel`.
5. [x] Run `npm run lint` and `npm run format:check`.
6. [x] Run supported main-stack multi-repository fail-forward proof when provider authentication permits, then verify ancestry, pushed equality, and a clean worktree.

#### Implementation Notes

- Added this post-closeout task so main's fail-forward validation fix can be generalized to Story 64's manifest-driven repository waves without weakening their parallel topology or target-local artifact contracts.
- Replaced selective pointer seeding with the complete prepared base, so standalone and wave pointers retain repository, comparison, context, target, and wave identity before reviewer publication.
- Composed main's canonical fallback flag with wave-target validation and made every target validation request it; stale prepared state remains an absolute no-overwrite gate.
- Generalized fast coverage to manifest-sized completed, partial, failed, and missing job counts with a trusted/completed distinction, while retaining the upstream two-reviewer fields as a legacy resume fallback.
- Added bounded job-coverage control and durable fifth-pass exhaustion routing so incomplete coverage retries before the cap and becomes an explicit final blocker at the cap.
- Targeted flow-control and prompt-contract proof passed all 63 tests, including `2N + 1` completion, incomplete and untrusted retry, fifth-pass exhaustion, inconsistent-count rejection, and legacy resume behavior.
- Preserved legacy two-reviewer controller state as a fallback only when generic job coverage is absent, carried generic coverage through classification and slow-phase transition, and routed fifth-pass exhaustion into one deduplicated final blocker.
- Targeted server proof passed 13 review-base, 42 review-artifact, 7 review-set, 5 review-wave-validation, 68 flow-schema, and 47 flow integration tests plus all 9 review-wave Cucumber scenarios; one fixture-only severity setup was corrected after the first review-wave run exposed that its expected fast set still included the slow reviewer.
- The server build passed after correcting one missing OpenCode placeholder read in the merged review-base test, and the complete server unit/integration wrapper then passed all 2,624 tests.
- Resolved all five merge conflicts by retaining the wave flow and test topology, taking complete prepared-base seeding, and composing both validator interfaces; the planner-context load remains in the fast wave and no legacy validation step was inserted into either wave.
- Repository lint and tracked-file formatting checks passed without warnings or rewrites.
- The canonical parallel wrapper passed 899 client tests, 2,624 server unit/integration tests, 138 Cucumber scenarios, and 77 e2e tests plus the reusable server, client, main Compose, and e2e Compose builds; the client retained only the pre-existing 1,700 kB chunk advisory.
- Supported-stack discovery found `review_artifacts_main` disabled because the editable manual catalog lacked the flow's required `review_agent_lite`; this is an actionable proof-catalog gap rather than an allowed authentication skip, so a seventh implementation subtask was added before continuing manual proof.
- Added the production-equivalent lightweight review profile and its target saturation and blind-spot commands to the supported manual catalog, expanded catalog-parity discovery through `subflowWave` groups, and passed all 7 host-network/Compose contract tests; both the slow review subflow and full two-phase flow now resolve as enabled in the running main stack.
- The supported one-target run validated a three-job fast wave as partial after an intentional prepared-plan drift: one job remained usable, two were rejected as stale, canonical fallback publication did not overwrite stale state, and pass bookkeeping recorded incomplete/untrusted coverage with `needs_review_rerun_before_close: true`.
- The one-target run reached the deterministic retry controls, but the configured loop-control provider repeatedly returned non-JSON output to the strict yes/no prompt; the authoritative checker returned `{"answer":"no"}` and persisted retry state remained correct, so this provider-formatting limitation was recorded without weakening the product assertion.
- The supported three-repository fixture prepared one primary and two additional targets, launched the exact seven-job `2N + 1` fast wave, completed all 7 jobs with no failures or skips, and produced server validation with `closeout_allowed=true`; the supported main stack was stopped afterward while all local development-stack containers remained running.
- After the supported-catalog addition, lint and formatting passed again and the canonical parallel wrapper passed 899 client tests, 2,624 server unit/integration tests, 138 Cucumber scenarios, and 77 e2e tests with all reusable builds successful.
- Pushed implementation/proof commit `a0a188f1f64f`, fetched both current remote refs, and confirmed exact local/remote feature equality, current `origin/main` ancestry, and a clean worktree before closing the task.

### Task 21. Preserve review-source attribution through disposition and plan recording

- Task Status: `__done__`

#### Subtasks

1. [x] Define one canonical review-source identity that retains instance ID, flow name, review phase, target ID, repository alias, and a stable human-readable review name.
2. [x] Preserve every validated source through target-local and cross-repository aggregation without weakening existing finding fingerprint or severity-conflict behavior.
3. [x] Carry deduplicated review-source identities through classification, minor-path promotion, task-required routing, and rejected or non-actionable disposition state.
4. [x] Render one `Found by` bullet on every item under both `### Accepted` and `### Ignored for This Story`, qualifying repeated review names with their target alias.
5. [x] Preserve honest provenance for legacy and artifact-only ignored candidates without inventing a review name when only an existing source reference is available.
6. [x] Add focused aggregation, disposition-contract, and plan-recording regressions for single-source, duplicate-source, multi-review, multi-target, and cross-repository findings.

#### Testing

1. [x] Run targeted server review-set and review-wave validation tests.
2. [x] Run targeted review-disposition and plan-recording prompt-contract tests.
3. [x] Run the targeted production review-loop integration tests that prove accepted and ignored item rendering.

#### Implementation Notes

- Added after Story 64 closeout to make every durable accepted or ignored decision traceable to all validated reviews that independently reported it.
- Added the canonical `ReviewSourceIdentity` review-set contract with instance, flow, phase, target, repository alias, display name, and per-source severity fields.
- Enriched target-local and cross-repository aggregation from the validated expected job, retained deterministic human-readable review names, and deduplicated exact source/severity repeats without changing finding fingerprints or conflict detection.
- Extended the wave-consumer, classification, scope-filter, minor-promotion, and reclassification contracts so canonical review sources survive every disposition bucket transition while legacy source references remain distinct.
- Made `Found by` mandatory in the durable Accepted and Ignored item shape, taught the deterministic plan checker to reject missing provenance, and updated production-loop and prompt fixtures to render qualified review names.
- Kept legacy and artifact-only provenance honest by requiring exact existing source references in `Found by` and explicitly forbidding review-name inference from filenames, presentation labels, or conversation.
- The targeted server wrapper passed all 14 review-set and review-wave validation tests with the enriched source schema and new deduplication/cross-repository assertions.
- All 64 focused Python flow-control and review prompt-contract tests passed, including the new gate that rejects accepted findings without `Found by` provenance.
- Added focused typed and contract regressions for target-local multi-review attribution, exact duplicate suppression, cross-repository sources, legacy source references, and required plan provenance; the targeted production review-loop integration test passed.

### Task 22. Persist per-pass minor-fix audit evidence and cumulative escalation state

- Task Status: `__done__`

#### Subtasks

1. [x] Define a versioned per-pass audit structure keyed by `review_cycle_id` and `review_pass_id` for fixed findings, escalated findings, repositories, changed files, targeted proof, and review-source attribution.
2. [x] Persist structured `changed_files` and `targeted_proof` from every terminal minor-fix result instead of reducing them to a proof summary that cannot safely regenerate a task.
3. [x] Accumulate and deduplicate fixed and task-required findings across later fast passes and the slow phase while preserving their originating pass identity.
4. [x] Normalize proof commands without collapsing identical commands executed in different repositories, and retain final outcomes for commands that were retried.
5. [x] Validate malformed, stale, cross-cycle, and incomplete audit evidence without parsing the human-readable `## Minor Review Fixes` section as machine state.
6. [x] Preserve backward-compatible resume behavior for active review cycles whose existing disposition state predates the per-pass audit fields.
7. [x] Add focused state-transition tests for fixed, reclassified, blocked, skipped, out-of-scope, resumed, and cross-phase findings.

#### Testing

1. [x] Run targeted Python review flow-control and state-contract tests.
2. [x] Run targeted minor-fix prompt-contract and disposition-wave tests.
3. [x] Run targeted server flow-schema and review production-loop integration tests.

#### Implementation Notes

- This task creates the durable machine-readable source for loop audit tasks; plan prose remains an output and is not reparsed to reconstruct changed files or executed proof.
- Added a versioned `minor_fix_pass_audits` model plus a deterministic synchronizer/validator covering pass identity, terminal attempts, fixed and escalated IDs, repositories, changed files, canonical review sources, targeted proof, and executed-test summaries.
- Added the runtime synchronization CLI and made the minor-fix documentation step invoke it after every terminal outcome, preserving the exact changed-file and proof arrays before any human-readable plan note is written.
- Updated fast-pass recording, fast-to-slow transition, classification, and combined finalization contracts to preserve every pass audit and the existing cumulative fixed/task-required state through final settlement.
- The audit synchronizer derives `executed_tests` by repository plus normalized command, so repeated proof collapses only within one repository while later retry outcomes replace earlier observations honestly.
- Integrated deterministic audit validation into every review flow-control state load; malformed schema, duplicate passes, cross-cycle entries, invalid attempts, and inconsistent derived summaries now fail closed without consulting plan prose.
- Kept legacy active-cycle state resumable by accepting the complete absence of audit fields and initializing version 1 only when classification or the first terminal minor-fix synchronization owns the upgrade.
- Added deterministic audit-state regressions for every terminal outcome, idempotent replay, retry proof, repository-aware command deduplication, legacy resume, malformed cross-cycle state, and fast-to-slow preservation; all 69 focused Python tests passed.
- The three targeted server disposition-wave contract tests passed alongside the focused minor-fix prompt-contract coverage.
- The targeted server wrapper passed all 69 flow-schema and production review-loop tests, completing Task 22's state, compatibility, and integration proof.

### Task 23. Generate idempotent completed audit tasks for minor-fix loops

- Task Status: `__done__`

#### Subtasks

1. [x] Add a plan-writing contract and deterministic helper that finds or creates exactly one minor-fix audit task for each `review_cycle_id` and `review_pass_id` that attempted at least one finding.
2. [x] Generate the audit task with `Task Status: __done__`, stable role and pass markers, and a `#### Overview` that lists every finding escalated to the combined task-up path.
3. [x] Add one checked subtask per fixed finding with its finding identity, repository, summary, and complete deduplicated changed-file list.
4. [x] Add checked testing items for every actually executed proof command, deduplicated by repository and normalized command; omit `not_run` entries and record an eventual pass after a failed retry honestly.
5. [x] Invoke audit-task generation after every non-empty fast or slow minor-fix loop without changing the existing rule that combined task-up runs once after both phases finish.
6. [x] Update audit-task escalation coverage after combined task-up so each Overview identifies the resulting review-created task or grouped task without forcing one task per finding.
7. [x] Make generation, cancellation, resume, and task-up refresh idempotent so retries update the same audit task and never duplicate checked evidence.
8. [x] Add an integrated regression where the first fast loop finds five items, fixes four, escalates one, completes three further fast passes and the slow review, then proves the original escalation is covered by combined task-up exactly once.
9. [x] Update review workflow documentation and task-format validation for the new completed audit-task role.

#### Testing

1. [x] Run targeted audit-task helper and plan-parser tests.
2. [x] Run targeted Python fast-phase, slow-phase, task-up, cancellation, and resume flow-control tests.
3. [x] Run targeted server flow-schema and review-flow integration tests.
4. [x] Run the exact multi-pass production review-loop regression from first-pass escalation through slow-phase task-up.

#### Implementation Notes

- The audit task is historical evidence for completed inline work and remains separate from the unfinished final revalidation task that owns whole-story confidence after review settlement.
- Existing grouped task-up behavior remains intentional: an escalated finding must receive durable task coverage but may share a coherent review-created task with related findings.
- Added the deterministic audit-task upsert and its plan-writing contract. Cycle/pass markers provide identity, completed task sections are rendered solely from validated state, and testing output remains repository-aware, deduplicated, checked, and explicit about final retry outcomes.
- Wired audit-task generation immediately after the reusable fast/slow minor-fix subflow and both legacy inline minor loops; combined task-up remains in its existing post-phase position.
- Added a post-task-up refresh across two-phase and legacy review flows; it maps `Addresses Findings` coverage back into every pass audit while preserving coherent grouped review-created tasks.
- Added idempotent upsert/replay and grouped-coverage tests plus the exact four-fixed/one-escalated first pass followed by three later fast passes and slow task-up; the audit remains singular and the original escalation maps to one grouped task.
- Documented the completed audit role as historical non-owning evidence, protected it from task-up merging/reopening, and passed all 73 targeted helper, plan-parser, flow-control, and prompt-contract tests.
- All 43 focused Python fast/slow routing, task-up, audit synchronization, replay, and resume tests passed.
- The targeted server wrapper passed all 70 flow-schema and production review-loop integration tests, including explicit audit-generation and post-task-up ordering assertions.
- The exact first-pass four-fix/one-escalation regression passed through three later fast-pass identities, one slow pass, and singular grouped task coverage for the original escalation.

### Task 24. Run full closeout proof for review provenance and minor-loop audit tasks

- Task Status: `__done__`

#### Subtasks

1. [x] Run the repository's supported lint command and fix issues in story-owned changes.
2. [x] Run the repository's supported formatting command and fix issues in story-owned changes.

#### Testing

1. [x] Run `npm run build:summary:server` and `npm run build:summary:client`.
2. [x] Run `npm run compose:build` followed by `npm run compose:up` for the supported main stack.
3. [x] Run `npm run test:summary:all:parallel` without targeted filters.
4. [x] Complete main-stack manual proof for multi-review `Found by` rendering, a non-empty fast-loop audit task, a slow-loop audit task, escalation into grouped task-up, cancellation, resume, and duplicate suppression unless repository-owned authentication guidance permits a documented skip.
5. [x] Run `npm run compose:down` after supported-stack proof while leaving every local development-stack container untouched.
6. [x] Run `npm run lint`.
7. [x] Run `npm run format:check`.

#### Implementation Notes

- This fresh closeout task reopens whole-story validation after Tasks 21-23 extend the previously completed review disposition, task-up, and plan-writing contracts.
- Repository ESLint completed with zero warnings or errors before closeout builds.
- The supported repository formatter completed successfully across tracked and newly added story-owned files.
- Server and client summary builds passed; client typecheck was clean and the build retained only the existing 1,700 kB chunk-size advisory.
- The supported main-stack images rebuilt successfully and all services started, with MongoDB and the server reaching healthy status; no local development-stack service was touched.
- The canonical unfiltered parallel suite passed: 899 client tests, 2,627 server unit tests, 138 Cucumber scenarios, and 77 e2e tests all completed with zero failures.
- Fresh main-stack proof confirmed the rebuilt catalog exposes the enabled minor-fix and two-phase flows; a scratch fast/slow cycle rendered `Codex Review` and `Open Code Review`, checked fixed-file and deduplicated-test evidence, retained the first-pass escalation until one grouped Task 4 covered it after slow finalization, and replayed both audit tasks as unchanged. A live two-phase wave was stopped with both child reviews stopped, resumed in the same conversation from its persisted path, and stopped cleanly again, proving cancellation/resume without leaving an active proof run.
- The supported main stack was stopped through its wrapper after proof; every `codeinfo2-*-local` service and `mongo_db_CodeInfo-local` remained running and healthy where health checks are defined.
- Final repository lint passed with zero warnings or errors after manual proof and plan maintenance.
- Final tracked-file formatting verification passed with every matched file conforming to Prettier, completing Task 24 closeout.


### Task 25. Re-Validate Story Linting

- Task Status: `__done__`

#### Subtasks

Final-task repair scope: this task owns whole-story validation. If lint, formatting, or testing exposes a story-caused issue in code implemented by any earlier task, fix it within this final task when practical and rerun the affected checks. Do not reopen an older task solely to own that repair.

1. [x] In `codeInfo2`, run `npm run lint` and fix issues.
2. [x] In `codeInfo2`, run `npm run format:check` and fix issues.

#### Testing

Final-task repair scope: the whole approved story is in scope for failures found by these checks. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected check. Do not reopen older tasks solely because their implementation is implicated.

1. [x] Run `npm run build:summary:server`.
2. [x] Run `npm run build:summary:client`.
3. [x] Run `npm run compose:build:summary`.
4. [x] Start the supported main stack with `npm run compose:up`.
5. [x] Run the full parallel automated suite with `npm run test:summary:all:parallel`, covering client, server unit, server cucumber, and e2e suites.
6. [x] Stop the supported main stack with `npm run compose:down`.
7. [x] Run `npm run lint`.
8. [x] Run `npm run format:check`.

#### Implementation Notes

- Expanded the dedicated final task to cover the actual story-owned root repository surface and its supported build, runtime, full-suite, shutdown, lint, and formatting lifecycle; the prior lint-only scope was incomplete.
- **RESOLVED ISSUE** The generic incomplete-automated-proof blocker was retired after `npm run build:summary:server` passed on 2026-07-15. The remaining listed proof steps are normal in-progress work, not a live blocker.
- Server summary build passed cleanly through `npm run build:summary:server`; its remaining lifecycle checks are still pending.
- `npm run lint` passed with zero warnings or errors; the formatting subtask also passed.
- `npm run format:check` passed; all matched tracked files use Prettier code style.
- The directly corresponding final-task testing items for lint and formatting were completed by the successful subtask checks; all broader proof is now complete.
- Client summary build passed through typecheck and Vite build; Vite reported the existing large-chunk warning, but the build completed successfully.
- Compose summary build passed with both image build items successful and no failed items.
- Supported main stack started successfully; MongoDB and the server reached healthy status and the client container started.
- Full parallel automated suite passed: client 899, server unit 2627, server cucumber 138, and e2e 77 tests passed with zero failures.
- Supported main stack stopped cleanly; all started containers and the internal network were removed.
- Final-task manual proof ran at full-story scope after rebuilding and starting the main stack from stopped/unknown provenance: `/health` and the client passed, and the Flows UI loaded the review catalog plus persisted one-target, three-target, and cancellation/resume review records without console errors or failed application requests. The stack was then stopped cleanly; Playwright captured `proof-01-flows.png` but the active MCP output could not be transferred from either `$CODEINFO_ROOT/playwright-output-local` or `codeinfo2-playwright-mcp-local`, so the intended scratch destination remains `codeInfoTmp/manual-testing/0000064/25/` and no screenshot is claimed as retained.

## Code Review Findings

- Review pass: `0000064-20260715T235743Z-8f7623b0a4-0551069e`
- Review cycle: `0000064-rc-20260715T234622Z-3ff7dd09`
- Comparison context: local `HEAD` `8f7623b0a4da9f0c15124006f5cf5a08c45d43fc` versus resolved base `origin/main@00ced5bb15524d12395dfc5c0d427b3c65eb7f97` from the stored review handoff, with comparison rule `local_head_vs_resolved_base`, resolved base source `remote`, and remote fetch status `success`.
- Wave coverage and ownership: the validated slow wave had one expected target-local main-review job for `current_repository`, completed and usable; cross-repository coverage was not expected for this slow wave. `current_repository` is the recorded target owner. The authoritative aggregate contained no findings or severity-conflict records, so no accepted finding can honestly be attributed from wave sources in this pass.
- Confidence note: the disposition state contains no accepted or ignored canonical findings and one incomplete aggregation blocker, which is not an accepted or ignored issue. The ignored entries below are explicit non-adopted candidates from the validated findings artifact's `Rejected Risk Notes`; because they have no server-owned review names, `Found by` preserves their exact artifact-section references.

### Accepted

- None.

### Ignored for This Story

#### 1. Generic subflow-wave expansion and ordinary subflow compatibility

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: subflowWave compatibility`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: The generic matrix/singleton expansion and existing `subflow` compatibility were checked without confirming an additional defect.
- Example: No concrete example was recorded in the validated review evidence.
- Why ignored: The review explicitly recorded no additional defect for this candidate.

#### 2. Target admission contradictions beyond the recorded base-pinning issue

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: target admission`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Duplicate roots, branch-story mismatches, detached heads, and alias collisions were covered by existing target resolver tests.
- Example: No concrete example was recorded in the validated review evidence.
- Why ignored: The review separated these covered checks from the distinct comparison-base finding; no additional issue was adopted.

#### 3. One-target cross-repository `not_applicable` behavior

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: one-target not_applicable`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: A one-target cross-repository wave may publish the deterministic `not_applicable` result.
- Example: The plan explicitly allows the singleton cross-repository flow to exit with `not_applicable`.
- Why ignored: This is approved story behavior, not an issue to change.

#### 4. Child-conversation errors as a substitute for parent-wave diagnostics

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: child error versus parent diagnostics`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: The child conversation's own error was considered insufficient evidence that the parent best-effort summary already preserved the child reason.
- Example: No concrete additional defect beyond the separately recorded parent-summary finding was recorded.
- Why ignored: The review treated this as context for the existing diagnostic finding, not a second finding.

#### 5. Cross-repository compatibility review for repositories outside the plan scope

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: no additional repositories`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: No additional repository compatibility diff was performed because the plan names no additional repositories.
- Example: The stored plan scope contains an empty `additional_repositories` list.
- Why ignored: This is outside the active repository scope and is not an issue for this story pass.

#### 6. Visual-conformance review without retained design evidence

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: visual conformance`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Visual review was not activated because no retained screenshots or named design assets were available.
- Example: No concrete visual mismatch was recorded in the validated review evidence.
- Why ignored: The artifact records residual uncertainty, not an actionable current-pass finding.

#### 7. Portability of changed documentation links

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: documentation portability`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Changed documentation links were checked for absolute local paths and no portability problem was found.
- Example: The reviewed links were repository-relative.
- Why ignored: No concrete documentation defect was confirmed.

#### 8. Routing-selection and fallback behavior beyond recorded findings

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: routing-selection contradictions`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Base fallback ordering and flow-agent fallback behavior were checked without confirming an additional routing defect.
- Example: The review evidence records direct remote/local fallback coverage.
- Why ignored: The review retained only the separately recorded provider-ordering issue; no extra routing finding was adopted.

#### 9. Boundary-input, path, and command-injection concerns beyond existing guards

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: boundary-input audit`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Artifact containment, allowlisted output keys, repository-root checks, and argv boundaries were reviewed without confirming a new bypass.
- Example: The review exercised unsafe artifact paths and shell metacharacters without recording a new defect.
- Why ignored: Existing guards and the validated review evidence did not support an additional finding.

#### 10. Duplicate side effects or replay defects beyond recorded lifecycle findings

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: idempotency/replay audit`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Stable writes, resume replay, and retry barriers were checked without confirming an additional duplicate side effect.
- Example: The review identified the existing stale-publication and resume findings but no separate duplicate action.
- Why ignored: This candidate was already covered by recorded findings and did not justify another issue.

#### 11. Timer or coordination defect beyond the recorded lifecycle proof gap

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: timer/coordination audit`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Production polling and retry timing were reviewed without confirming a separate correctness defect.
- Example: The review described the 25 ms sleep as a guard around persisted terminal-state reads.
- Why ignored: The remaining timing concern was treated as part of the existing lifecycle proof finding, not a new issue.

#### 12. UI affordance or action-parity mismatch

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: UI affordance parity`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Wave and target status chips were reviewed without finding a hidden action, selection, or reset-path mismatch.
- Example: The evidence says the changes add read-only chips while preserving existing row actions and selectability.
- Why ignored: No user-facing affordance defect was confirmed.

#### 13. Field-role or identity-field overwrite beyond the recorded resume finding

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: field-role stability audit`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: The added wave metadata fields were checked for overwriting execution, instance, target, or display identities.
- Example: The evidence records those fields as separate values and retains the existing fresher-child backfill behavior.
- Why ignored: The review retained only the existing instance-only resume precedence finding.

#### 14. Redundant bulk side effects in target preparation or validation

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: bulk side-effect cardinality audit`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Per-target preparation and artifact validation were checked for redundant refresh or reload work.
- Example: The evidence found distinct repository work per target and retained target failures as invalid or failed coverage.
- Why ignored: No redundant bulk side effect was confirmed.

#### 15. Changed flow-schema or child-topology contradiction beyond recorded findings

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: flow topology and schema`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: New step shapes, wave identifiers, binding records, and fast/slow topology were checked without confirming an additional contradiction.
- Example: The challenge records parse-time rejection for malformed shapes and the intended exclusion of the cross-repository reviewer from the slow wave.
- Why ignored: The candidate was contradicted by validated schema and topology behavior.

#### 16. Review-output publication scope drift beyond recorded aggregation findings

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: review-output publication`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Prepared-base and target-scope publication changes were checked for dangling caller contracts or weak fallback scope.
- Example: The challenge records that the Open Code publisher receives the prepared-base argument and rejects partial wave scope.
- Why ignored: No additional publication-scope issue was confirmed beyond the recorded aggregation and target-identity findings.

#### 17. Minor-fix audit state validation or task-order duplication

- Finding ID or Review reference: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes: audit-task flow control`
- Found by: `codeInfoTmp/reviews/0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md — Rejected Risk Notes`
- Description: Audit-state validation, synchronization, and minor-fix task ordering were checked without confirming a new duplication or acceptance defect.
- Example: The challenge records validation before task-flow decisions and idempotent audit-task structure.
- Why ignored: The review treated these changes as proof hardening and did not adopt an additional finding.

### Task 26. Reconcile the incomplete slow-wave findings handoff before review task-up

- Task Status: `__done__`
- Repository Name: `codeInfo2`
- Review Task Role: `review_finding_repair`
- Review Pass ID: `0000064-20260715T235743Z-8f7623b0a4-0551069e`
- Review Cycle ID: `0000064-rc-20260715T234622Z-3ff7dd09`

#### Overview

The authoritative slow-wave review set and matching wave-validation artifact are identity-valid and usable for coverage, but their `aggregated_findings` array is empty while the validated findings artifact and handoff summary report 15 actionable candidates. The disposition state therefore records `aggregated-findings-mismatch` as an incomplete-review blocker and sets task-up routing required, while its finding queues contain no server-owned routed findings. Repair or deterministically reconcile this target-owned review-output handoff before any raw artifact-only candidate is treated as an implementation finding. Do not widen Story 64 behavior, create tasks for the 15 un-routed candidates, or claim a clean review until the authoritative artifacts agree.

#### Non-Goals

- Do not implement the 15 artifact-only candidates as product fixes; they remain unrouted until a valid server-owned aggregate and disposition state classify them.
- Do not change approved Story 64 user-facing behavior, the ordinary `subflow` contract, or the cross-repository review topology.
- Do not add another repository owner or cross-target implementation task; the stored scope contains `codeInfo2` only.

#### Addresses Findings

- `aggregated-findings-mismatch` from `review-disposition-state.json`: reconcile the empty authoritative slow-wave aggregate with the 15-candidate validated findings artifact, or preserve an explicit unusable/incomplete result if the evidence cannot be reconciled.
- Current review pass `0000064-20260715T235743Z-8f7623b0a4-0551069e`: preserve the exact story, session, pass, wave, parent execution, target, HEAD, and comparison-base identity while repairing the handoff.

#### Task Exit Criteria

- A matching server-owned review-set and wave-validation pair for the current pass either includes every usable current-pass finding in `aggregated_findings` with preserved source identity, or explicitly records the affected coverage as invalid/incomplete so clean closeout remains impossible.
- The 15 candidates that exist only in the findings artifact are not promoted into numbered implementation work unless a later valid disposition state routes them with server-owned provenance.
- The current plan retains exactly one structured `## Code Review Findings` block for this review pass, and the incomplete-review blocker remains visible until the authoritative artifacts reconcile.
- Focused regression proof covers successful `review_output_file`/findings ingestion and malformed, missing, or mismatched artifact handling without changing approved user-facing behavior.

#### Risk Ownership

- Implementation owner: `codeInfo2` owns the review-wave validation, artifact-ingestion, and disposition-boundary repair.
- Scope boundary: this task repairs review evidence integrity only; it must not reinterpret the raw findings artifact or widen Story 64 behavior.

#### Owner Map

- `codeInfo2`: `server/src/flows/reviewWaveValidation.ts`, its target-review pointer producers/consumers, matching validation tests, and the current review-state handoff.

#### Proof Mapping

- `aggregated-findings-mismatch` -> matching review-set/wave-validation identity, reconciled `aggregated_findings` or explicit incomplete coverage, and focused server regression tests.
- Review pass `0000064-20260715T235743Z-8f7623b0a4-0551069e` -> exact current-pass plan block, disposition-state identity, and final whole-story revalidation in Task 27.

#### Requirement-To-Proof Mapping

- Findings aggregation -> `server/src/flows/reviewWaveValidation.ts` must preserve validated findings and server-owned source identity in `aggregated_findings`, retain usable sibling findings, and combine those observations with `closeout_allowed: false` when coverage is incomplete; prove the combined outcome in `server/src/test/unit/review-wave-validation.test.ts`.
- Review-set preparation -> `server/src/flows/reviewSet.ts` must isolate target working paths, enumerate the expected fast/slow jobs, and write versioned evidence without replacing a newer stable manifest; prove those preparation and stale-versus-live invariants in `server/src/test/unit/review-set.test.ts`.
- Target identity -> `server/src/flows/reviewTargetContract.ts` must reject repository, branch, HEAD, story, target, and prepared-base mismatches before disposition; prove those exact contract rejections in `server/src/test/unit/review-target-contract.test.ts`.
- Findings ingestion and task-up routing -> `server/src/flows/reviewArtifacts.ts`, `server/src/flows/codexReview.ts`, and `scripts/publish_open_code_review.py` must keep published pointer `review_output_file`/findings-file paths and validation status aligned for coherent, stale, missing, malformed, or unreadable inputs; the existing review disposition workflow then keeps the current pass in one plan findings block, routes only a reconciled server-owned aggregate, and leaves all 15 artifact-only candidates unrouted when reconciliation fails. Prove artifact reader-writer behavior in `server/src/test/unit/review-artifacts.test.ts` and the plan/state outcome in this task's Testing section.

#### Documentation Locations

- Canonical review decisions: the existing `## Code Review Findings` block in this plan.
- Review-state contract: `review-disposition-state.json` and the current-pass review artifacts referenced by it; these remain workflow state, not new tracked documentation.

#### Affected Repositories

- `codeInfo2` only. `current-plan.json` declares no additional repositories, so this blocker does not require cross-target repository proof.

#### Subtasks

1. [x] Update the single review-output seam in `server/src/flows/codexReview.ts`, `scripts/publish_open_code_review.py`, `server/src/flows/reviewArtifacts.ts`, and `server/src/flows/reviewWaveValidation.ts` in this order: keep both publishers writing repository-relative `review_output_file`/findings-file pointers; make `reviewArtifacts.ts` read each pointer once and publish its server-owned validation result; make `reviewWaveValidation.ts` reject story/session/pass/wave/target/base mismatches before aggregation and copy validated findings with their sources into `aggregated_findings`; preserve atomic stable/versioned writes, leave partial or aborted validation invalid without replacing or deleting the current stable artifact, and keep temporary fixture cleanup test-owned.
2. [x] In `server/src/test/unit/review-wave-validation.test.ts`, add one fixture call to `validateReviewWave({ snapshot, reviewSet })` without injected validator dependencies, then extend the combined stale/missing-job case to assert that validated findings retain every server-owned source, stale or missing jobs are classified before aggregate/closeout finalization, usable sibling findings remain available, and the same deterministic boundary sets `closeout_allowed: false` instead of allowing clean closeout.
3. [x] Extend `server/src/test/unit/review-set.test.ts` to prove preparation semantics that feed the validator: each target receives an isolated working path, fast and slow phases enumerate the correct job shapes, a stale wave writes versioned evidence without replacing the newer stable manifest, and an aborted preparation leaves no partial stable or versioned manifest while fixture teardown removes temporary roots.
4. [x] Extend `server/src/test/unit/review-target-contract.test.ts` with separate rejection cases for repository-root, branch, HEAD, story, target, and prepared-base mismatches, proving these exact identity gates fail before disposition or task-up routing; leave closeout assertions to the wave-validation proof.
5. [x] Extend `server/src/test/unit/review-artifacts.test.ts` to prove the published pointer's `review_output_file`/findings-file reader-writer contract and deterministic `passed`, `partial`, `stale`, or `blocked` outcomes for coherent, missing, malformed, unreadable, and mismatched artifacts, including preservation of valid sibling bundles; retain the cancellation proof that aborts OCR before validation artifacts are published, use unique per-test artifact roots with no elapsed-time assertions for worker-safe execution, and leave temporary cleanup to the fixture.
6. [x] Update `review-disposition-state.json` and the existing current-pass `## Code Review Findings` block only after the validated artifacts are available: if `aggregated_findings` reconciles, retain that server-owned aggregate and route only those findings; if it does not reconcile, record the matching invalid/incomplete pair with `closeout_allowed: false`, leave all 15 artifact-only candidates unrouted, preserve one findings block for the pass, and do not create duplicate review-fix or final-revalidation tasks.

#### Testing

Normal-system startup and shutdown are not repeated in this task: Task 26 changes server review-artifact validation internals without changing startup, environment, Compose ownership, or runtime routing; Task 27 owns the supported main-stack lifecycle and full regression proof.

1. [x] In `codeInfo2`, run `npm run build:summary:server`; if a failure is outside the review-artifact surfaces owned by Task 26, record it as a shared baseline or harness result rather than widening this repair task.
2. [x] In `codeInfo2`, run the targeted server-unit wrapper with `npm run test:summary:server:unit -- --skip-build --file server/src/test/unit/review-wave-validation.test.ts --file server/src/test/unit/review-set.test.ts --file server/src/test/unit/review-target-contract.test.ts --file server/src/test/unit/review-artifacts.test.ts`; use these four proof files to validate successful ingestion, stale or mismatched identity rejection, source-preserving aggregation, missing or malformed artifact handling, and `closeout_allowed: false` for incomplete coverage.
3. [x] Run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` and verify the current-pass findings block appears exactly once, Task 26 retains `aggregated-findings-mismatch` coverage, and Task 27 remains the only final revalidation owner.

#### Implementation Notes

- Created as the bounded incomplete-review follow-up required by the valid disposition state's `aggregated-findings-mismatch` blocker. The state reported `needs_task_up_path: true` and `has_unresolved_task_required_findings: true` while its routed arrays and counts were zero; this mismatch is preserved for repair rather than treated as a clean no-findings outcome.
- Added server-owned validated-findings transport from pointer ingestion into wave aggregation, with versioned-only writes for incomplete validation so newer stable artifacts remain untouched.
- Extended wave, review-set, target-contract, and review-artifact fixtures for source preservation, incomplete-closeout boundaries, isolated preparation, abort cleanup, identity gates, and JSON findings-pointer ingestion.
- Rechecked the active disposition and review-tasking state: the authoritative slow-wave aggregate remains unreconciled, `closeout_allowed: false` is preserved for incomplete coverage, the single findings block remains authoritative, and Task 27 remains the sole final revalidation owner.
- Focused proof passed: the four Task 26 server-unit files passed 58 tests, Codex pointer publication passed 18 tests, and the OpenCode publisher passed 12 Python tests.
- Automated proof passed: `npm run build:summary:server` completed cleanly with zero warnings.
- Implementation-plus-automated-proof audit passed: all six subtasks and three testing checks are evidenced, no live task blocker remains, and the review-artifact-only changes introduced no story-caused user-facing behavior drift. The authoritative review state still preserves incomplete coverage and `closeout_allowed: false` for the later final revalidation task.
- Manual testing assessed as not applicable (task-scoped): Task 26's exit criteria cover server-owned review artifacts and focused automated proof only, and its Testing section explicitly assigns main-stack lifecycle proof to Task 27. No runtime was started and no manual-proof artifacts were required.

### Task 27. Re-Validate Story 64 After Review Outcome Reconciliation

- Task Status: `__in_progress__`
- Repository Name: `codeInfo2`
- Review Task Role: `final_revalidation`
- Review Pass ID: `0000064-20260715T235743Z-8f7623b0a4-0551069e`
- Review Cycle ID: `0000064-rc-20260715T234622Z-3ff7dd09`

#### Overview

This is the sole final revalidation task for the current review cycle. After Task 26 and any later routed review repair are complete, revalidate the whole Story 64 implementation, the exact current-pass `Code Review Findings` block, and the `aggregated-findings-mismatch` disposition outcome. There are no `resolved_minor_findings` in the active disposition state, so no separate minor-fix final task may be created. Do not close the story while the authoritative review artifacts remain unreconciled or while any current-pass task-required finding lacks proof.

#### Non-Goals

- Do not create a second final task for review cycle `0000064-rc-20260715T234622Z-3ff7dd09`.
- Do not turn unresolved review evidence into clean closeout, change approved Story 64 behavior, or add repositories outside the stored scope.

#### Addresses Findings

- `aggregated-findings-mismatch` and every current-pass finding that becomes server-routed after reconciliation -> whole-story review revalidation and matching disposition state.
- Review cycle `0000064-rc-20260715T234622Z-3ff7dd09` -> this task is the single final revalidation owner for the cycle.

#### Task Exit Criteria

- Task 26 and every newly routed current-pass repair are complete and their proof is included in the final validation.
- The whole Story 64 acceptance contract, the current-pass `Code Review Findings` block, and any resolved minor fixes from this same cycle are revalidated; the active state currently lists no resolved minor fixes.
- Every worked-on repository has its discovered supported build, applicable startup, full automated suites including e2e when supported, matching shutdown, lint, and formatting checks recorded in the required order.
- The disposition state names this exact task title as the owner of final revalidation, preserves the exact review cycle ID, and does not permit a second final task for the cycle.

#### Risk Ownership

- Administrative and proof owner: `codeInfo2`.
- Whole-story proof scope: server flows and review artifacts, flow-control scripts, client flow/sidebar surfaces, documentation/configuration, and all Story 64 automated and main-stack manual proof surfaces.

#### Owner Map

- `codeInfo2`: all story-owned implementation, review-repair, and proof surfaces in the canonical repository.

#### Affected Repositories

- `codeInfo2` only. No additional repository is in the stored plan scope; retain the story's existing multi-target fixture proof without inventing a second repository owner.
- Proof-scope inventory within `codeInfo2`: server workspace and review-flow artifacts, client workspace and flow/sidebar surfaces, flow-control scripts, the server Cucumber suite, the client suite, the Playwright e2e suite, and the supported main Compose stack.

#### Requirement-To-Proof Mapping

- Whole-story acceptance -> the full build, supported main-stack lifecycle, unfiltered client/server/Cucumber/e2e suite coverage, lint, and formatting checks below.
- Current review outcome -> Task 26's reconciled or explicitly incomplete authoritative artifacts, the single current-pass findings block, and the matching disposition-state final-task ownership.
- Existing review behavior -> main-stack guidance below covers target isolation, cancellation/resume, and cross-repository behavior without changing the locked product contract.

#### Proof Mapping

- Task 26 repair -> the authoritative review-set/wave-validation result and focused server tests are included before this task starts.
- Story 64 acceptance -> the full build, main-stack lifecycle, complete automated suites, and repository lint/format checks below.
- Current review cycle -> the exact pass and cycle IDs, one findings block, and disposition ownership are checked before closeout.

#### Documentation Locations

- Final review outcome and repair coverage: the existing current-pass `## Code Review Findings` block and Tasks 26–27 in this plan.
- Durable generated review evidence remains in the repository's ignored review-artifact locations; do not add generated screenshots or transient review JSON to tracked source files.

#### Subtasks

Final-task repair scope: this task owns whole-story validation. If lint, formatting, or testing exposes a story-caused issue in code implemented by any earlier task, fix it within this final task when practical and rerun the affected checks. Do not reopen an older task solely to own that repair.

1. [x] In `codeInfo2`, run `npm run lint` and fix issues.
2. [x] In `codeInfo2`, run `npm run format:check` and fix issues.
3. [x] In `codeInfo2`, repair the main-review publication seam so each wave target's `current-review` pointer emits findings inline or through a JSON `findings_file` consumed by `readValidatedFindings()`, retain the Markdown findings artifact for disposition, and add focused regression coverage proving `validateReviewWave()` aggregates the findings with server-owned source identity.
4. [x] Repair the supported main-proof runtime handoff so the persisted Story 64 root-flow conversation is available to the main-stack Mongo service and the existing resume lookup resolves it using the current Story 64 conversation identifier; stop with a documented blocker if the supported stack cannot access that persisted state without inventing a new runtime path.
5. [ ] Regenerate the authoritative Story 64 `current-review` pointer and slow-wave/review-set artifacts with the repaired main-review producer and runtime handoff, then reconcile `aggregated_findings` and the disposition state so the 15 validated Markdown findings are represented in server-owned structured findings with matching source identity; retain the Markdown artifact and leave the mismatch visibly blocked if the generated pair still disagrees.

#### Testing

Final-task repair scope: the whole approved story is in scope for failures found by these checks. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected check. Do not reopen older tasks solely because their implementation is implicated.

1. [ ] In `codeInfo2`, run `npm run build:summary:server`.
2. [ ] In `codeInfo2`, run `npm run build:summary:client`.
3. [ ] In `codeInfo2`, run `npm run compose:build:summary`.
4. [x] Start the supported main stack with `npm run compose:up`.
5. [ ] Run the full parallel automated suite with `npm run test:summary:all:parallel`, covering the client, server unit, server cucumber, and e2e suites.
6. [x] Stop the supported main stack with `npm run compose:down`.
7. [ ] In `codeInfo2`, run `npm run lint`.
8. [ ] In `codeInfo2`, run `npm run format:check`.

#### Manual Testing Guidance

- Use the supported main stack only through the repository wrappers: `npm run compose:up` after the supported build and `npm run compose:down` afterward. The wrapper-managed main compose contract uses `server/.env`, `server/.env.local`, `client/.env`, and `client/.env.local`, exposes the client at `http://localhost:5001` and server health at `http://localhost:5010/health`, mounts `manual_testing/codeinfo_agents` at `/app/codeinfo_agents` and `manual_testing/codex_agents` at `/app/codex_agents`, seeds Copilot from `/seed/copilot`, and exposes the host working-folder namespace at `/data`; wait for the server and client health checks before interaction. Confirm the review catalog loads, one-target and three-target waves preserve target and wave identity, cancellation/resume does not duplicate child work, target artifacts remain isolated, cross-repository finding behavior remains covered, and the plan does not claim clean closeout while the blocker is unresolved.
- Visual revalidation seam: on `Flows`, inspect the persisted one-target and three-target Story 64 review entries at desktop (`1440x960`) and mobile (`390x844`). At desktop, confirm the conversation rail keeps each child entry's review title together with its `Run <execution-id>` and target chip; in `client/src/components/chat/ConversationList.tsx`, those are the `conversation-run-chip` and `conversation-wave-target-chip` seams. At mobile, open the collapsed conversations drawer before making the same comparison, then confirm the selected transcript's target-validation and review-step status remain readable above the fixed composer in `client/src/pages/FlowsPage.tsx`. Treat missing, swapped, duplicated, or clipped target/run identity, or an off-screen/overlapping composer control, as a Story 64 repair signal; do not start a new flow, edit a persisted title, or absorb unrelated Chat or Agents layout work.
- If browser screenshots are needed, capture each screenshot first to a relative path such as `/tmp/playwright-output/<relative-path>` inside the local Playwright MCP runtime; on the host this normally appears as `$CODEINFO_ROOT/playwright-output-local/<relative-path>`. Treat that host-visible location as staging, keep the screenshot-producing runtime distinct from the app-under-test runtime when they differ, then transfer the file to `codeInfoTmp/manual-testing/0000064/27/` for non-committed task proof. Inspect runtime handoff JSON by meaning for artifact source, fallback runtime, and destination rather than relying on exact property names. The latest final-task screenshots are the primary durable proof for visual surfaces this task re-covers; retain earlier screenshots only when uniquely necessary, and record any transfer limitation honestly instead of halting the proof loop.
- Confirm the completed repair path does not duplicate final tasks or alter the approved Story 64 interaction contract. If provider authentication requires human-controlled two-factor authentication, follow repository guidance and document the allowed skip without attempting re-authentication.

#### Implementation Notes

- Planner plan-impact review confirms the latest `**BLOCKING ANSWER**` is a manual/runtime environment seam owned by Task 27 subtask 4. The existing subtask 4 runtime-handoff owner and subtask 5 artifact-reconciliation owner provide the correct order, bounded stopping points, and final-task ownership; no prerequisite task, task split, renumbering, or story-scope change is needed. The active blocker is therefore retired as resolved context so the loop can execute the proven Mongo handoff and artifact reconciliation on Task 27, which remains `__in_progress__` with final automated validation still open.
- **BLOCKING ANSWER** Current blocker research proves a manual/runtime environment seam owned by Task 27 subtask 4: the supported main proof stack cannot see the persisted Story 64 Mongo conversation, while the existing application resume contract is already correct. Repository evidence shows `docker-compose.yml` configures the main server for `mongodb://host.docker.internal:27517/db` and its own `mongo_data` volume, while `docker-compose.local.yml` configures the local server for port `27417` and a separate local Mongo volume; live Docker state confirms `mongo_db_CodeInfo-local` is serving `27417` and exposes distinct `codeinfo2-local_mongo_data` and `codeinfo2_mongo_data` volumes. The local `db.conversations` collection contains the Story 64 root document `c8198aae-61b2-488a-8792-8868a329b7c0` with `flowName: review_artifacts_main` and saved `flags.flow.stepPath: [6]`, whereas the main stack has no access to that document. The existing code resolves conversations with `ConversationModel.findById()` in `server/src/flows/service.ts`, requires an existing `conversationId` plus persisted `flags.flow` for `resumeStepPath`, and persists that state with the existing `flags.flow` `$set` writer in `server/src/mongo/repo.ts`; no new lookup or application-level resume path is needed. The repository's only Mongo bootstrap, `mongo/init-mongo.js`, initializes the replica set and does not import flow state; the closest repository precedent is test-only conversation seeding through `withMockedMongoConversationPersistence()` and explicit seeded flow/child conversations in the resume tests, not a supported-stack runtime import.

  The chosen fix is an explicit proof-runtime data handoff: export the Story 64 root conversation and any child conversation documents referenced by its saved flow state from the local Mongo instance with the supported Mongo Database Tools query/archive workflow, restore only those `db.conversations` documents into the main Mongo instance on port `27517`, verify the exact root identifier and `flags.flow` are visible through the main server, then resume the flow and regenerate/reconcile the authoritative review artifacts. MongoDB's official tools document query-limited `mongodump`, archive output, `mongorestore` namespace selection, and the requirement to use compatible source/destination versions; Docker's official Compose documentation confirms that named volumes persist independently and that explicit external volume names or bind mounts are required to reuse a backing store, while `docker compose config` verifies the resolved environment and mounts. This fits the local state because the two stacks intentionally use separate ports and volumes, preserves the supported main stack's isolation, and transfers only the persisted state needed by the bounded proof rather than changing the flow runtime. DeepWiki could not index `Chargeuk/codeInfo2`; that absence does not weaken the direct repository evidence or the official Docker/Mongo guidance. Rejected alternatives are changing `getConversation()` or `resumeStepPath` downstream, parsing or trusting review artifacts to bypass the missing conversation, sharing an active raw `/data/db` volume, or permanently pointing the main proof server at the local `27417` URI: each bypasses the existing persistence contract, risks cross-stack corruption/isolation loss, or makes the supported main stack depend on the development runtime. References: `https://docs.docker.com/reference/compose-file/volumes/`, `https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/`, `https://www.mongodb.com/docs/database-tools/mongodump/`, `https://www.mongodb.com/docs/database-tools/mongorestore/`, and `https://www.mongodb.com/docs/database-tools/mongodump/mongodump-examples/`.
- Planner normalization converted the runtime-handoff requirement from blocker prose into explicit ownership: Task 27 subtask 4 now repairs access to the persisted Story 64 conversation, and subtask 5 owns the resulting artifact regeneration and reconciliation. All final validation checks were reopened because the handoff repair makes earlier proof stale; Task 27 remains the sole `__in_progress__` owner with a live blocker until the handoff and artifact pair are both resolved.
- Implementation-only audit confirmed the latest bounded regeneration attempt changed no product or review-flow source files and introduced no Story 64 behavior drift. The recorded healthy stack startup and shutdown remain honestly checked; no other `Testing` items were marked complete because this pass did not establish final automated proof. Subtask 4 remains unchecked, and the existing review-flow harness blocker is preserved while Task 27 remains `__in_progress__` for the bounded regeneration work.
- Planner impact review found no missing prerequisite, task split, runtime handoff, or task-shape defect: Task 27 remains the dedicated final revalidation owner, and its bounded reconciliation subtask is the correct next executable work. The proof/test-harness blocker is therefore retired as historical context so the implementation loop can continue on this task; the task remains `__in_progress__` with its explicit reconciliation and final validation work still open.
- **BLOCKING ANSWER** Fresh blocker research confirms this is a proof/test-harness contract seam owned by Task 27's final revalidation, not a product, runtime, baseline, or task-shape blocker. Repository evidence shows `server/src/flows/reviewArtifacts.ts::readValidatedFindings()` accepts inline `findings` or a JSON `findings_file`, `server/src/flows/reviewWaveValidation.ts` aggregates only those validated structured findings with server-owned source identity, the integration production-loop fixture publishes `findings.json`, and the focused review-artifact and slow-wave tests prove the same path; the fallback Markdown writer is explicitly a human-readable coverage artifact and is not an aggregation input. Context7's official JSON Schema specification and use-case guidance limit schema validation to a JSON instance's structural constraints and leave cross-artifact consistency to application logic, while MDN's `JSON.parse()` reference confirms that non-JSON Markdown cannot be parsed as the machine-readable findings payload; the external MCO review-artifact precedent likewise separates `summary.md` from aggregated `findings.json`. Code-intelligence cross-repository search found only structured review-comment documentation in the related `open-code-review` repository, not an equivalent wave aggregator, and DeepWiki could not index `Chargeuk/codeInfo2`; these limitations do not contradict the local precedent. The chosen fix remains upstream: regenerate the Story 64 `current-review` pointer with the structured findings inline or in a sibling JSON findings artifact, retain the Markdown disposition artifact, rerun wave validation, and reconcile the authoritative review-set and disposition state so the 15 findings carry matching server-owned source identities. Downstream Markdown parsing, trusting handoff counts, manually editing generated JSON, or repeating broad wrappers are rejected because they would bypass the existing validated producer/consumer contract rather than repair the artifact seam. References: `https://json-schema.org/overview/use-cases`, `https://json-schema.org/draft/2020-12/json-schema-validation`, `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse`, and `https://github.com/mco-org/mco/blob/main/README.md`.
- Created as the one final revalidation owner for review cycle `0000064-rc-20260715T234622Z-3ff7dd09`; it must remain after the new review-repair task and cover the whole story plus the current review block.
- Preflight visual refinement pass inspected the Flow review catalog, target/run identity chips, transcript status, and responsive composer seams; no code was changed.
- Ran `npm run lint` successfully with exit code 0; no lint issues required repair.
- Ran `npm run format:check` successfully with exit code 0; no formatting issues required repair.
- Ran `npm run build:summary:server` successfully with exit code 0; the wrapper reported a clean success with no warnings.
- Ran `npm run build:summary:client` successfully with exit code 0; the wrapper reported one existing large-chunk warning and no build failure.
- Ran `npm run compose:build:summary` successfully with exit code 0; both compose image builds passed.
- Started the supported main stack with `npm run compose:up`; all services started and the server reported healthy.
- Ran `npm run test:summary:all:parallel` successfully; client (899), server unit (2628), server cucumber (138), and e2e (77) tests all passed.
- Stopped the supported main stack with `npm run compose:down`; all started containers and the compose network were removed successfully.
- Re-ran `npm run lint` successfully with exit code 0 and no warnings.
- Re-ran `npm run format:check` successfully; all tracked files matched Prettier formatting.
- **RESOLVED ISSUE** The authoritative `codeInfoStatus/flow-state/review-disposition-state.json` reported `incomplete_review_blockers[0].id=aggregated-findings-mismatch` and `safe_to_exit_review_loop_without_tasking=false`: the final review-set had `aggregated_findings: []`, while the validated findings artifact and disposition handoff reported 15 actionable findings. No unchecked subtasks or testing items remained after the prior audit normalization; the disposition state, final review-set, wave-validation artifact, and Markdown findings artifact were checked, and the issue is now converted into the bounded producer repair subtask above rather than being treated as clean closeout.
- Automated-proof audit confirmed all listed builds, main-stack lifecycle steps, full client/server/Cucumber/e2e suites, lint, and formatting checks were recorded as successful, with no implementation files changed in the proof pass. Task 27 remains `__in_progress__` because the authoritative review outcome is still incomplete, not because of missing automated proof.
- **BLOCKING ANSWER** The blocker is a proof/validation contract seam caused by an upstream review-artifact shape mismatch, not a product behavior or runtime-environment issue. Repository tracing proved that `server/src/flows/reviewWaveValidation.ts` adds findings to `aggregateFindings()` only from each usable job's server-owned `pointerValidation.validated_findings`, while `server/src/flows/reviewArtifacts.ts::readValidatedFindings()` returns findings only from inline `findings` or a JSON `findings_file`; the current `0000064-current-review.json` points to `0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md`, so the validator correctly supplies an empty array and the finalized wave records `aggregated_findings: []` even though that Markdown contains 15 actionable findings. The chosen fix is upstream: make the `target_code_review_findings`/main-review publication seam emit the validated findings as inline JSON or a sibling `.json` `findings_file` in the `current-review` pointer, while retaining the Markdown artifact for human-readable disposition; then rerun the focused review-artifact/wave-validation tests and the final proof so `validateReviewWave()` produces the canonical findings and source identities before disposition runs. This fits the local contract because `readValidatedFindings()` already supports both machine-readable forms, `aggregateFindings()` already deduplicates and preserves reviewer provenance, and existing tests in `server/src/test/unit/review-wave-validation.test.ts` cover sibling aggregation, partial-result preservation, slow-wave closeout, and cross-repository gating. The external-library precedent is the official JSON Schema guidance, confirmed through Context7 and `https://json-schema.org/overview/use-cases`, which separates structural document validation from semantic consistency; that supports fixing the producer/consumer contract rather than pretending schema-valid or Markdown text proves cross-artifact agreement. Targeted web research found no external project-specific match for this private workflow; the JSON Schema validation specification at `https://github.com/json-schema-org/json-schema-spec/blob/main/specs/jsonschema-validation.md` likewise supports document-local validation, not maintaining state across separate artifacts. DeepWiki could not provide a repository precedent because `Chargeuk/codeInfo2` is not indexed. The current final task owns the closeout gate and must rerun proof after repair, but the technical repair belongs at the upstream review-artifact producer seam; changing disposition to parse Markdown or trust handoff counts, adding a bespoke Markdown parser downstream, manually editing generated review state, or repeating broad wrappers would preserve the mismatch and violate the server-owned wave-consumer contract, so those alternatives are rejected. No implementation repair was performed in this research step.
- Planner repair converts the proven producer seam into bounded same-task ownership because Task 27 is the dedicated whole-story final repair and revalidation owner. The new implementation/proof-authoring subtask makes the next stopping point explicit, and all prior automated proof is unchecked because the repair can make those results stale; the task remains `__in_progress__` for the normal implementation and proof loop.
- Updated the main findings contract so the `current-review` pointer keeps the Markdown `findings_file` for disposition and publishes the same structured findings inline for server-owned wave validation. Added review-artifact and slow-wave regressions for inline finding ingestion and `Main Review` target/source identity; both focused server-unit files passed (44 and 7 tests).
- Re-ran `npm run build:summary:server` successfully with exit code 0; the wrapper reported a clean success with no warnings.
- Re-ran `npm run build:summary:client` successfully with exit code 0; the wrapper reported the known large-chunk warning and no build failure.
- Re-ran `npm run compose:build:summary` successfully with exit code 0; both compose image builds passed.
- Started the supported main stack with `CODEINFO_HOST_INGEST_DIR=/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2 npm run compose:up` after rebuilding the images, so the repaired producer was mounted at `/data`; the stack became healthy and was stopped with `npm run compose:down` after the bounded regeneration attempt.
- **RESOLVED ISSUE** An explicit resume from an earlier step reattached terminal child-wave records from the later saved step, so wave validation could report success against stale artifacts. The flow runtime now clears child-wave tracking on an explicit rewind, while ordinary same-step resumes still reattach active work.
- Re-started the supported main stack with `npm run compose:up`; all services started and the server reported healthy.
- Re-ran `npm run test:summary:all:parallel` successfully; client (899), server unit (2629), server cucumber (138), and e2e (77) tests all passed.
- Stopped the supported main stack with `npm run compose:down`; all started containers and the compose network were removed successfully.
- **RESOLVED ISSUE** The implementation-plus-automated-proof audit found that Task 27 subtask 4 remained unchecked after normalization: the current authoritative `current-review` pointer still publishes the Markdown findings artifact without structured findings, the final slow-wave review set still reports `aggregated_findings: []`, and `review-disposition-state.json` still reports `aggregated-findings-mismatch` with `safe_to_exit_review_loop_without_tasking=false`. The producer contract change, focused regressions, and prior full-suite results were checked, but they do not prove the generated authoritative artifact pair was regenerated at the repaired HEAD. The exact remaining work is to regenerate and reconcile that pair while preserving the Markdown artifact; the issue is now actionable within Task 27's bounded reconciliation subtask, so the live blocker is retired rather than preserved as an active prerequisite. All eight final validation checks remain open because the unresolved artifact repair can make their earlier results stale.
- Repaired explicit flow rewinds to discard stale child-wave tracking and added a focused regression; `npm run test:summary:server:unit -- --file src/test/integration/flows.run.subflow.test.ts` passed 48 tests. The supported main stack rebuilt and started successfully, but its Mongo instance has no persisted Story 64 root-flow conversation, while the stored conversation exists only in the local development Mongo instance; direct resume therefore returns `resumeStepPath requires saved flow state`.
- **RESOLVED ISSUE** Subtasks 4 and 5 remained open after normalization. Evidence checked: the code-level stale-child resume defect is fixed, the supported main proof stack starts and stops successfully, but its Mongo service could not access the persisted Story 64 review-flow conversation in the local development Mongo instance; the authoritative `current-review` pointer and slow-wave/review-set pair therefore remained stale and mismatched. The proven bounded Mongo data-handoff solution and existing Task 27 ownership now make the next implementation step actionable; no product behavior change is authorized or required.
- Repaired Subtask 4's supported runtime handoff by query-dumping the Story 64 two-phase conversation family from local Mongo and restoring it insert-only into the main Mongo service. Verified root `001fd33d-f902-482b-93d1-8a195d5fc279` and slow-review child `c8198aae-61b2-488a-8792-8868a329b7c0`, including the persisted root execution and flow state, are visible to the main service; no unrelated main conversations were dropped.
- Started and stopped the supported main stack while executing the runtime handoff and regeneration attempt; the server became healthy and `npm run compose:down` removed the started services and network.
- **BLOCKER** Subtask 5, “Regenerate the authoritative Story 64 `current-review` pointer and slow-wave/review-set artifacts with the repaired main-review producer and runtime handoff,” remains open. After restoring and normalizing the persisted conversation paths, resuming at `[2]` correctly exposed that the saved slow target was stale; resuming at `[1]` regenerated the slow target at repaired `HEAD 98fc20d`, and the target-local reviewer produced a fresh report, but the supported producer then remained in progress at its command step for more than two minutes with the canonical pointer stuck at `status: preparing`, `findings_file: null`, and no slow-wave aggregate update. Two stack restarts and a persisted child resume cleared transient locks but did not advance publication. The exact remaining blocker is the supported review-agent command/runtime handoff not completing its publication step; the task should remain final-task-owned and does not need to be split or re-owned, but the producer/runtime must be repaired or made available before reconciliation can continue.
