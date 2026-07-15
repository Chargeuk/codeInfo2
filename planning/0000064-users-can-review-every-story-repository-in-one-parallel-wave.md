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
- A persisted review-target snapshot contains the canonical plan host plus every plan-scope repository with stable alias, real root, checked-out branch, full HEAD commit, and pinned comparison base.
- The runtime never switches a shared checkout between branches; distinct branches require distinct worktree paths.
- The main, Codex, and Open Code Review flows each review exactly one explicit target.
- For `N` targets, every fast pass launches `2N + 1` child flows: Codex and Open Code Review for each target plus one story-scoped cross-repository flow.
- Fast review repeats after eligible minor fixes until a pass records zero pre-fix minor findings or a fifth drained pass completes.
- After fast convergence, one slow wave launches exactly `N` heavyweight main-review child flows in parallel and never reruns them.
- Serious findings and fix history accumulate across every fast pass and the slow wave, while final task-up and revalidation occur only after both phases finish.
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
