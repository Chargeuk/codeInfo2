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


- **BLOCKING ANSWER** Fresh blocker research proves this is a proof/test-harness seam owned by Task 28 Subtask 5, not a product, shared-baseline, runtime-handoff, or task-shape defect. Current disk artifacts are non-closeable: `0000064-current-review.json` is `preparing` for wave `0000064-rw-20260716T100443Z-d54e553f` with no findings; its matching review set is `prepared` with `coverage.missing_jobs: 3`; and the versioned wave validation is `completed_partial` with one completed job, two failed/stale jobs, and `closeout_allowed: false`. Checked-in precedents establish the intended boundary: `service.ts` and `codexReview.ts` preserve running versus terminal child states, closed stdin, timeout, and abort handling; `reviewWaveValidation.ts` requires matching wave identity and all expected jobs completed before closeout; `reviewArtifacts.ts::readValidatedFindings()` accepts only inline findings or a JSON `findings_file`; and `review-wave-validation.test.ts` plus `flows.run.subflow.test.ts` cover missing/stale/partial waves, cancellation, failure, and terminal recovery. The `open-code-review` ingested-repository precedent likewise validates and filters review results before publishing them rather than reporting incomplete work.

  External confirmation matches the local contract: Context7's official Node.js documentation says `execFile` callbacks run when the child terminates and aborts surface as `AbortError`; DeepWiki's `openai/codex` lifecycle distinguishes progress events such as `turn/started` and `item/started` from terminal `turn/completed` states (`completed`, `interrupted`, or `failed`). Targeted issue research confirms timeout-without-verdict ambiguity in [Codex issue #14335](https://github.com/openai/codex/issues/14335) and a separate non-TTY stdin hang in [Codex issue #20919](https://github.com/openai/codex/issues/20919); the local `execFileWithClosedStdin()` already addresses the latter, so it is not the remaining fix. The chosen solution is to preserve the incomplete wave as blocker evidence, create a fresh immutable target snapshot and wave/review-set identity at the current HEAD/base, rerun the supported fast/slow publication path, and reconcile only after terminal child outcomes plus matching pointer, review-set, validation, structured-findings, and server-owned source identities agree. This fits the current repository because the validator and runner already implement those gates and the artifacts show the exact non-terminal/stale state. Arbitrary longer waits, retrying the same wave, treating silence or HTTP 202 as completion, parsing Markdown downstream, fabricating JSON, or changing resume/product code are rejected because they bypass the existing terminal, coverage, and provenance contracts. No prerequisite task or plan split is justified; the live blocker remains until supported reviewer execution produces terminal artifacts.

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
- Review pass `0000064-20260715T235743Z-8f7623b0a4-0551069e` -> exact current-pass plan block, disposition-state identity, and final whole-story revalidation in Task 28.

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

Normal-system startup and shutdown are not repeated in this task: Task 26 changes server review-artifact validation internals without changing startup, environment, Compose ownership, or runtime routing; Task 28 owns the supported main-stack lifecycle and full regression proof.

1. [x] In `codeInfo2`, run `npm run build:summary:server`; if a failure is outside the review-artifact surfaces owned by Task 26, record it as a shared baseline or harness result rather than widening this repair task.
2. [x] In `codeInfo2`, run the targeted server-unit wrapper with `npm run test:summary:server:unit -- --skip-build --file server/src/test/unit/review-wave-validation.test.ts --file server/src/test/unit/review-set.test.ts --file server/src/test/unit/review-target-contract.test.ts --file server/src/test/unit/review-artifacts.test.ts`; use these four proof files to validate successful ingestion, stale or mismatched identity rejection, source-preserving aggregation, missing or malformed artifact handling, and `closeout_allowed: false` for incomplete coverage.
3. [x] Run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` and verify the current-pass findings block appears exactly once, Task 26 retains `aggregated-findings-mismatch` coverage, and Task 28 remains the only final revalidation owner.

#### Implementation Notes

- Created as the bounded incomplete-review follow-up required by the valid disposition state's `aggregated-findings-mismatch` blocker. The state reported `needs_task_up_path: true` and `has_unresolved_task_required_findings: true` while its routed arrays and counts were zero; this mismatch is preserved for repair rather than treated as a clean no-findings outcome.
- Added server-owned validated-findings transport from pointer ingestion into wave aggregation, with versioned-only writes for incomplete validation so newer stable artifacts remain untouched.
- Extended wave, review-set, target-contract, and review-artifact fixtures for source preservation, incomplete-closeout boundaries, isolated preparation, abort cleanup, identity gates, and JSON findings-pointer ingestion.
- Rechecked the active disposition and review-tasking state: the authoritative slow-wave aggregate remains unreconciled, `closeout_allowed: false` is preserved for incomplete coverage, the single findings block remains authoritative, and Task 28 remains the sole final revalidation owner.
- Focused proof passed: the four Task 26 server-unit files passed 58 tests, Codex pointer publication passed 18 tests, and the OpenCode publisher passed 12 Python tests.
- Automated proof passed: `npm run build:summary:server` completed cleanly with zero warnings.
- Implementation-plus-automated-proof audit passed: all six subtasks and three testing checks are evidenced, no live task blocker remains, and the review-artifact-only changes introduced no story-caused user-facing behavior drift. The authoritative review state still preserves incomplete coverage and `closeout_allowed: false` for the later final revalidation task.
- Manual testing assessed as not applicable (task-scoped): Task 26's exit criteria cover server-owned review artifacts and focused automated proof only, and its Testing section explicitly assigns main-stack lifecycle proof to Task 28. No runtime was started and no manual-proof artifacts were required.

### Task 27. Complete Story 64 Review Target Identity Chips

- Task Status: `__done__`
- Repository Name: `codeInfo2`
- Review Task Role: `implementation`
- Prerequisite: Task 26 is complete; Task 28 final revalidation follows this task.

#### Overview

This bounded implementation task owns the independent client target-chip seam that was previously held inside the provider-blocked final revalidation task. Complete the approved Story 64 target/run identity display without changing unrelated Chat or Agents behavior. Task 28 must not resume final whole-story proof until this task is complete.

#### Non-Goals

- Do not change review execution, artifact publication, resume behavior, or approved interaction contracts.
- Do not add a second final task or a second repository owner.

#### Task Exit Criteria

- Root review rows render `conversation-wave-target-chip` from `flags.flow.input.target.target_id`.
- Child rows retain `flags.flowChild.targetId`.
- Target and run chips remain independent of clipped conversation titles at desktop and mobile widths.
- The implementation is ready for Task 28's final full-story proof.

#### Subtasks

1. [x] In `client/src/components/chat/ConversationList.tsx`, render each persisted review target as the existing `conversation-wave-target-chip` beside `conversation-run-chip`: source root rows from `flags.flow.input.target.target_id` and retain `flags.flowChild.targetId` for child rows. Do not rely on clipped `conversation-title`; preserve independent target/run chips at desktop rail width and in the mobile conversations drawer.

#### Testing

1. [x] Run `npm run build:summary:client` after the target-chip implementation and record the result as the automated compilation proof for this bounded task.

#### Implementation Notes

- Planner repair split the independent client target-chip implementation out of provider-blocked Task 28 so the next implementation pass has a concrete owner. Task 28 remains `__to_do__` until this task completes and the external review artifacts become closeable.
- Implemented root target-chip extraction from `flags.flow.input.target.target_id` and added focused coverage while preserving child `flags.flowChild.targetId` chips.
- `npm run build:summary:client` passed typecheck and production build; Vite reported the repository's existing large-chunk warning.
- Implementation-only audit confirmed commit `7aaa1812` changes only the approved ConversationList/API typing/test surfaces: root rows use the persisted `flags.flow.input.target.target_id`, child rows retain `flags.flowChild.targetId`, and the target chip remains separate from the clipped title. The parser reports no live blocker and both checklist items are complete from the implementation evidence; no story-caused preserved-behavior regression or unrelated user-facing drift was found. Task 27 remains `__in_progress__` for the normal proof and closeout path; this audit does not claim additional automated-proof completion.
- Implementation-plus-automated-proof audit confirmed the checked implementation and recorded `npm run build:summary:client` evidence are complete, with no live blocker, unchecked checklist item, or story-caused behavior drift. Task 27 is now honestly `__done__`; manual validation and whole-story final closeout remain owned by the later Task 28 path.
- Task-scoped manual proof restarted the freshness-unknown main Compose stack, passed `http://localhost:5010/health` and `http://localhost:5001`, and then stopped it cleanly. Desktop and 390px mobile conversation drawers both rendered independent `conversation-wave-target-chip` and `conversation-run-chip` values for root review rows, including long persisted target identifiers, without console warnings/errors; scratch proof is in `codeInfoTmp/manual-testing/0000064/27/` (`proof-01-desktop-target-run-chips.png`, `proof-02-mobile-target-run-chips.png`, and console/network captures). The aborted turn fetches occurred during conversation switching and were followed by a successful selected-conversation request, so they did not invalidate this chip-only contract. No additional subtasks were needed; whole-story final proof remains Task 28-owned.

### Task 28. Re-Validate Story 64 After Review Outcome Reconciliation

- Task Status: `__in_progress__`
- Repository Name: `codeInfo2`
- Review Task Role: `final_revalidation`
- Prerequisite: Task 27 is complete; the final revalidation and its automated proof must not start before the target-chip implementation is delivered.
- Review Pass ID: `0000064-20260715T235743Z-8f7623b0a4-0551069e`
- Review Cycle ID: `0000064-rc-20260715T234622Z-3ff7dd09`

#### Overview

This is the sole final revalidation task for the current review cycle. After Task 26, Task 27, and any later routed review repair are complete, revalidate the whole Story 64 implementation, the exact current-pass `Code Review Findings` block, and the `aggregated-findings-mismatch` disposition outcome. There are no `resolved_minor_findings` in the active disposition state, so no separate minor-fix final task may be created. Do not close the story while the authoritative review artifacts remain unreconciled or while any current-pass task-required finding lacks proof.

#### Non-Goals

- Do not create a second final task for review cycle `0000064-rc-20260715T234622Z-3ff7dd09`.
- Do not turn unresolved review evidence into clean closeout, change approved Story 64 behavior, or add repositories outside the stored scope.

#### Addresses Findings

- `aggregated-findings-mismatch` and every current-pass finding that becomes server-routed after reconciliation -> whole-story review revalidation and matching disposition state.
- Review cycle `0000064-rc-20260715T234622Z-3ff7dd09` -> this task is the single final revalidation owner for the cycle.

#### Task Exit Criteria

- Task 26, Task 27, and every newly routed current-pass repair are complete and their proof is included in the final validation.
- The whole Story 64 acceptance contract, the current-pass `Code Review Findings` block, and any resolved minor fixes from this same cycle are revalidated; the active state currently lists no resolved minor fixes.
- Every worked-on repository has its discovered supported build, applicable startup, full automated suites including e2e when supported, matching shutdown, lint, and formatting checks recorded in the required order.
- The disposition state names this exact task title as the owner of final revalidation, preserves the exact review cycle ID, and does not permit a second final task for the cycle.
- At `390x844`, the mobile `Flows` conversations drawer keeps each persisted long review target visually distinguishable in its own `conversation-wave-target-chip`; the differentiating suffix (for example `additional-1` versus `additional-2`) must remain readable without relying on the title clamp, a hover tooltip, or opening the row.

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
5. [x] Regenerate the authoritative Story 64 `current-review` pointer and slow-wave/review-set artifacts with the repaired main-review producer and runtime handoff, then reconcile `aggregated_findings` and the disposition state so the 15 validated Markdown findings are represented in server-owned structured findings with matching source identity; retain the Markdown artifact and leave the mismatch visibly blocked if the generated pair still disagrees.
6. [x] In `client/src/components/chat/ConversationList.tsx`, repair the `conversation-run-chip`/`conversation-wave-target-chip` metadata row so a narrow (`390px`) drawer preserves a separate, uniquely identifying visible target label for long root and child review rows. Keep the root source as `flags.flow.input.target.target_id` and the child source as `flags.flowChild.targetId`; constrain or abbreviate the non-target chips before the target chip, and render a deterministic target representation that retains the differentiating final segment (such as `additional-1` or `additional-2`) rather than ellipsizing both targets to the same prefix. Preserve the desktop row layout and existing chip test IDs.
7. [x] Add a generic `startLoop.maxIterations` contract whose limit exit follows the same normal `ok` continuation path as an early break, configure the fast review loop for five iterations, and preserve diagnostic exit metadata without creating a failure or stop outcome.
8. [x] Make the fast-to-slow transition best-effort and deterministic so already-complete, contradictory, incomplete, or limit-exhausted fast state exits the loop and continues through the same slow-phase steps with warnings rather than livelocking.
9. [x] Add review-cycle single-flight attachment and wrapper lifecycle ownership so duplicate Story 64 starts attach to one server run, every heartbeat exposes the conversation identity, wrapper loss does not cancel server-owned work, explicit cancellation remains available, and reattachment never affects `compose:local`.
10. [x] Make review artifact and disposition publication execution-owned: keep working outputs versioned, promote stable `current-*` pointers only for the active review execution, and skip superseded publications or state writes without failing the flow.
11. [x] Reconcile interrupted review runs on server startup by releasing stale active ownership, preserving terminal diagnostics, and allowing an explicit best-effort resume from the next safe checkpoint without automatically duplicating reviewer work.
12. [x] Address the seven unresolved current-pass `should_fix` findings in the bounded Story 64 surfaces: `stable-review-artifact-stale-writer-race`, `retry-ownership-post-success-crash-window`, `resume-input-silent-normalization-bypass`, `review-launch-source-working-folder-mismatch`, `codex-pointer-unowned-preflight-deletion`, `resume-input-stale-precedence-without-hash`, and `fixed-delay-negative-subflow-proof`. Keep each repair within the accepted finding's cited seam, add or update focused regression coverage, and do not broaden the work into the rejected or non-actionable findings.

#### Testing

Final-task repair scope: the whole approved story is in scope for failures found by these checks. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected check. Do not reopen older tasks solely because their implementation is implicated.

1. [ ] In `codeInfo2`, run `npm run build:summary:server`.
2. [ ] In `codeInfo2`, run `npm run build:summary:client`.
3. [ ] In `codeInfo2`, run `npm run compose:build:summary`.
4. [ ] Start the supported main stack with `npm run compose:up`.
5. [ ] Stop the supported main stack with `npm run compose:down`.
6. [ ] In `codeInfo2`, run `npm run lint`.
7. [ ] In `codeInfo2`, run `npm run format:check`.
8. [ ] Run focused loop, review-wrapper, run-admission, cancellation, artifact-promotion, disposition-state, and restart-reconciliation tests covering early exit, fifth-iteration normal exit, impossible sixth iteration, duplicate attachment, superseded publication, and best-effort continuation.
9. [ ] Run the full parallel automated suite with `npm run test:summary:all:parallel`, covering the client, server unit, server cucumber, and e2e suites.

#### Manual Testing Guidance

- Use the supported main stack only through the repository wrappers: `npm run compose:up` after the supported build and `npm run compose:down` afterward. The wrapper-managed main compose contract uses `server/.env`, `server/.env.local`, `client/.env`, and `client/.env.local`, exposes the client at `http://localhost:5001` and server health at `http://localhost:5010/health`, mounts `manual_testing/codeinfo_agents` at `/app/codeinfo_agents` and `manual_testing/codex_agents` at `/app/codex_agents`, seeds Copilot from `/seed/copilot`, and exposes the host working-folder namespace at `/data`; wait for the server and client health checks before interaction. Confirm the review catalog loads, one-target and three-target waves preserve target and wave identity, cancellation/resume does not duplicate child work, target artifacts remain isolated, cross-repository finding behavior remains covered, and the plan does not claim clean closeout while the blocker is unresolved.
- Visual revalidation seam: on `Flows`, inspect the persisted one-target and three-target Story 64 review entries at desktop (`1440x960`) and mobile (`390x844`). In `client/src/components/chat/ConversationList.tsx`, verify every review row has a separate `conversation-run-chip` and `conversation-wave-target-chip`: root rows must use `flags.flow.input.target.target_id`, while child rows retain `flags.flowChild.targetId`. The target must not appear only inside `conversation-title`, where the rail/drawer line clamp clips `data-codeinfo2-codeInfoTmp-story64-main-proof-three-additional-1` and `-2`. On mobile, open the collapsed conversations drawer and verify that the target chip itself—not a tooltip or the clipped title—shows the differentiating suffix for both long target values (`additional-1` and `additional-2`); shared-prefix ellipsis that makes those two rows visually identical is a failure. Then confirm the selected transcript's target-validation and review-step status remain readable above the fixed composer in `client/src/pages/FlowsPage.tsx`. Treat missing, swapped, duplicated, or clipped target/run identity, or an off-screen/overlapping composer control, as a Story 64 repair signal; do not start a new flow, edit a persisted title, or absorb unrelated Chat or Agents layout work.
- If browser screenshots are needed, capture each screenshot first to a relative path such as `/tmp/playwright-output/<relative-path>` inside the local Playwright MCP runtime; on the host this normally appears as `$CODEINFO_ROOT/playwright-output-local/<relative-path>`. Treat that host-visible location as staging, keep the screenshot-producing runtime distinct from the app-under-test runtime when they differ, then transfer the file to `codeInfoTmp/manual-testing/0000064/28/` for non-committed task proof. Inspect runtime handoff JSON by meaning for artifact source, fallback runtime, and destination rather than relying on exact property names. The latest final-task screenshots are the primary durable proof for visual surfaces this task re-covers; retain earlier screenshots only when uniquely necessary, and record any transfer limitation honestly instead of halting the proof loop.
- Confirm the completed repair path does not duplicate final tasks or alter the approved Story 64 interaction contract. If provider authentication requires human-controlled two-factor authentication, follow repository guidance and document the allowed skip without attempting re-authentication.

#### Implementation Notes

- Subtask 12 complete: repaired stable publication guards, retry completion ordering, resume-input trust and normalization, launch source identity validation, Codex pointer ownership, and fixed-delay subflow proof; focused review-set, wave-validation, wrapper, resume-identity, retry, and subflow suites passed.

- **BLOCKING ANSWER** The blocker is confirmed and remains live: `review-disposition-state.json` still reports the seven unresolved current-pass `should_fix` findings, `needs_minor_fix_path: true`, and no incomplete-review blocker; `plan_status.py --task-number 28` reports Subtask 12 unchecked, all nine automated validation items unchecked, and this standalone blocker. The smallest proven solution is one bounded repair pass owned by Task 28 Subtask 12, followed by the reopened automated validation: (1) keep the existing versioned review artifacts but add a final current-snapshot/identity compare immediately before each stable review-set and wave-validation promotion, with an interleaving test proving an older wave cannot overwrite a newer stable artifact; (2) make retry ownership completion durable before releasing ownership, with an explicit post-success/response-loss crash-boundary test so the same `retryOwnershipId` replays the saved result rather than launching a duplicate; (3) fail closed when persisted resume input cannot be normalized, instead of silently falling back to the new request while retaining the persisted hash; (4) reject or reconcile a wrapper `--working-folder` and explicit `--source-id` mismatch before POSTing the review launch; (5) only remove the Codex stable pointer when its wave/target/pass identity proves that the current run owns it; (6) treat legacy persisted resume input without an input hash as an untrusted pair and reject or explicitly reconcile it with the fresh request rather than silently preferring stale state; and (7) replace the two fixed-delay negative subflow assertions with a deterministic child latch/observable terminal boundary that asserts before and after release. Repository proof is present in `server/src/flows/reviewSet.ts` and `reviewWaveValidation.ts` (versioned writes plus a read-before-write currentness check but no final write-time guard), `server/src/flows/service.ts` (completion persistence occurs in `finally` after success and resume precedence currently accepts a missing hash), `server/src/flows/flowInput.ts` (`tryNormalizeFlowInput` swallows errors), `scripts/review-cycle-summary.mjs` (explicit source IDs bypass mismatch reconciliation), `server/src/flows/codexReview.ts` (unconditional pointer removal), and `server/src/test/integration/flows.run.subflow.test.ts` (40 ms sleeps). Existing focused tests in `review-set.test.ts`, `review-wave-validation.test.ts`, `flows.run.basic.test.ts`, the resume identity/backfill suites, `review-cycle-summary.test.mjs`, and the subflow suite provide the local seams for regression coverage; the challenge artifact independently records the same stale-publication and fixed-delay proof gaps. External precedents agree with this design: MCO's `runtime/review_engine.py` separates progress from terminal state, stores structured `findings.json` separately from Markdown summaries, and versions artifacts per task; Codex's guardian review-session tests ignore stale prior-turn completion. Node documents that `fs.rename` overwrites the destination and refers atomicity to the OS, while concurrent filesystem modifications require care, so rename alone is not a stale-writer guard; Node's child-process docs define completion at process termination/`close` and distinguish abort errors. MongoDB documents single-document `findOneAndUpdate` as atomic and recommends uniquely indexed filters for safe upserts, supporting an ownership/completion compare-and-set rather than separate read/write steps. These references are [MCO's review-engine patterns](https://deepwiki.com/mco-org/mco#3.1), [Codex guardian review-session source](https://github.com/openai/codex/blob/main/codex-rs/core/src/guardian/review_session.rs), [Node child-process documentation](https://nodejs.org/api/child_process.html), [Node filesystem documentation](https://nodejs.org/api/fs.html), [MongoDB atomic update documentation](https://www.mongodb.com/docs/manual/reference/method/db.collection.findoneandupdate/), [MongoDB retryable writes](https://www.mongodb.com/docs/manual/core/retryable-writes/), and the [idempotent-receiver failure-mode reference](https://martinfowler.com/articles/patterns-of-distributed-systems/idempotent-receiver.html). The findings classify as three product/story seams (retry and two resume contracts), three shared-wrapper/baseline seams (stable publication, launch identity, pointer ownership), and one proof/test-harness seam (fixed-delay ordering); none is a manual/runtime-environment or task-shape blocker, and Task 28 owns the final bounded repair because its accepted finding explicitly requires an inline resolution attempt before closeout. Rejected alternatives are broad lifecycle refactoring, Markdown-derived truth, unconditional pointer deletion, simply retrying the review wrapper, increasing sleeps, or waiting for manual runtime evidence: they either leave the race/crash/precedence defect intact, weaken the established identity contract, or move ownership outside the cited seam. The live `**BLOCKER**` line remains intentionally unchanged because a proven retry recipe does not make the required repairs and fresh proof available.

- **RESOLVED ISSUE** Implementation-plus-automated-proof audit found seven unresolved current-pass `should_fix` findings after the recorded terminal review run: `stable-review-artifact-stale-writer-race`, `retry-ownership-post-success-crash-window`, `resume-input-silent-normalization-bypass`, `review-launch-source-working-folder-mismatch`, `codex-pointer-unowned-preflight-deletion`, `resume-input-stale-precedence-without-hash`, and `fixed-delay-negative-subflow-proof`. The evidence checked was `codeInfoStatus/flow-state/review-disposition-state.json` (`unresolved_minor_batchable_findings: 7`, `needs_minor_fix_path: true`, `needs_review_rerun_before_close: false`, and no incomplete-review blockers), the completed current review/review-set/wave-validation artifacts, and the current-pass accepted findings block. Subtask 12 remained open after audit normalization because these story-owned repairs were not implemented; all nine final validation items were reopened because the repairs will make the prior proof stale. The blocking answer proves this is bounded actionable work owned by Task 28, not a missing prerequisite, runtime handoff, baseline, or task-shape repair; implementation may continue on the existing task, while automated proof remains pending.

- **RESOLVED ISSUE** `npm run review:cycle:summary -- --working-folder /Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2` reached terminal `ok` for conversation `0c6c65e7-800e-4e3e-a6ac-190320bfdf47`. The regenerated current review and matching review set share wave `0000064-rw-20260718T110435Z-126b394e`; the pointer is `completed` with 13 structured findings plus its retained Markdown artifact, and the review set is `completed` with 1/1 jobs and no missing or failed coverage. The disposition state reports trusted fast-pass coverage (3/3), zero incomplete review blockers, and no unresolved task-required findings, so the prior preparation-only artifact blocker is retired.

- User-directed closeout removed the final live Task 28 blocker after the bounded-loop, duplicate-attachment, execution-owned publication, and restart-reconciliation repairs were committed as `515edaa0` and pushed to the Story 64 feature branch. Task 28 now has no live blocker: Subtask 5 remains an unchecked, executable provider-backed artifact-regeneration and reconciliation step, not a prerequisite or implementation impasse. The completed proof remains client 900/900, server unit 2643/2643, server Cucumber 138/138, e2e 77/77, plus successful builds, lint, formatting, and supported main-stack startup/shutdown with `compose:local` untouched.

- The heartbeat identity refinement was followed by another canonical full-suite run: client 900/900, server unit 2643/2643, server Cucumber 138/138, and e2e 77/77 all passed, as did the shared server, client, main Compose, and e2e Compose builds.

- Restart reconciliation was tightened after final review so it preserves the persisted child identities while marking the parent interrupted; the existing resume path can therefore accept already-terminal children and fail forward past children that lost process ownership, without relaunching either set. The focused restart/reattachment tests passed 2/2, server build, lint, and format passed, and the final full parallel rerun again passed client 900/900, server unit 2643/2643, server Cucumber 138/138, and e2e 77/77.

- Testing items 4-5 are complete: `npm run compose:up` started the supported main stack healthy, `/health` confirmed Mongo connectivity, `/flows` exposed the repository-backed `two_phase_review_cycle` as enabled, and the baked flow reported `maxIterations: 5`. `npm run compose:down` then removed only the main stack; port 5010 is down while the `compose:local` server remains healthy on port 5510 with all local containers untouched.

- Testing item 9 is complete: the first full parallel run exposed one fixture catalog expectation that did not include the new `loop-max-iterations` fixture; its focused `/flows` suite then passed 26/26. The required full rerun passed client 900/900, server unit 2643/2643, server Cucumber 138/138, and e2e 77/77, with all shared builds successful.

- Testing item 3 is complete: `npm run compose:build:summary` built both supported main-stack images successfully, including the updated flow assets and server startup reconciliation; the wrapper reported clean success and required no log inspection.

- Testing item 2 is complete: `npm run build:summary:client` passed its typecheck and production build; log inspection confirmed the only warning is the existing Vite large-chunk advisory for the 1,730.31 kB main bundle.

- Testing item 6 is complete: the first lint run found two import-order warnings in the startup hook and its focused test; after ordering those imports, `npm run lint` passed with zero warnings.

- Testing item 7 is complete: the first formatting check identified only the changed review wrapper, Prettier rewrote it mechanically, the repository-wide rerun passed, and the two new untracked test fixtures were separately formatted and checked.

- Subtasks 10-11 and Testing item 8 are complete. Review-wave validation always retains versioned evidence but now promotes stable review-set and validation pointers only while the exact wave, parent execution, and target digest still own `current-review-targets`; superseded completion is a clean skip. Server startup recognizes that process-local ownership is gone, records interruption diagnostics and the saved safe step path, and preserves tracked child identities so an explicit `--resume-orphaned` can accept terminal children and fail forward past interrupted children without launching duplicate reviewer work; reconciliation errors warn and do not block startup. Focused server coverage passes 109/109, wrapper coverage passes 6/6, and review-control coverage passes 36/36.

- Testing item 1 is complete: the first server build exposed the new status response field missing from one route fixture; after adding the expected nullable resume checkpoint, `npm run build:summary:server` passed cleanly with no warnings.

- Subtasks 7-9 are implemented. `startLoop.maxIterations` persists a diagnostic `lastLoopExit` and leaves the loop through the ordinary continuation path; `two_phase_review_cycle` caps the fast loop at five and its phase gate treats already-advanced state as complete. The review summary wrapper now supplies a deterministic retry-ownership identity, so a repeated launch reuses the accepted server conversation, supports direct `--conversation-id` attachment, and includes that identity on continuing heartbeat output; its only automatic stop request remains the explicitly selected no-progress cancellation option. Focused wrapper tests pass 6/6 and focused Python review-control tests pass 36/36.

- User-authorized incident repair is now modeled in Task 28 Subtasks 7-11 and Testing items 8-9. The repair preserves the flow contract that recoverable work continues best-effort: the fifth loop iteration exits through the same normal continuation path as early convergence, duplicate launches attach, superseded writes skip, and only explicit cancellation stops the owning run. The existing Subtask 5 authoritative artifact reconciliation remains open until the repaired main-stack cycle completes.

- Testing item 8 is complete: the first `npm run format:check` identified the earlier Story 64 `ConversationList.tsx` target-chip work, Prettier applied a mechanical rewrite to that file, and the repository-wide rerun passed.

- Testing item 7 is complete: `npm run lint` passed with zero warnings.

- Testing item 5 is complete: after correcting two fixture expectations exposed by the stricter review contract, `npm run test:summary:all:parallel` passed client 900/900, server unit 2637/2637, server Cucumber 138/138, and e2e 77/77. The same run rebuilt the server, client, main Compose images, and e2e Compose images successfully; the client retained only the existing chunk-size warning.

- The supported live `review:cycle:summary` proof remained attached for 31 minutes, observed both fast reviewer jobs complete, and returned only when server state became terminal `failed`; it did not permit early workflow continuation. The terminal failure exposed an independent LLM-formatted fast-loop break response, so `two_phase_review_cycle` now executes its authoritative Python phase checker directly through a path-confined `scripts/flow_control/*.py` decision hook; focused server coverage passes 150/150 and runner coverage passes 3/3. Subtask 5 remains open because that live run did not reach the slow wave or publish final reconciled structured artifacts.

- Fresh `npm run compose:build:summary` completed successfully for both images with the repaired review runtime and terminal runner baked into the supported main stack, so Testing item 3 is complete. The build wrapper reported clean success and required no log inspection.

- Implemented the coordinated terminal-review repair: main-review validation now rejects Markdown-only completion without an explicit structured findings declaration; flow runs expose terminal status and stop endpoints; `review:cycle:summary` waits without an arbitrary timeout and only cancels on an explicit stall threshold; implementation flows halt on a still-live durable blocker instead of retrying it; and focused runner/server coverage passes. Fresh `npm run build:summary:server` passed, the focused server files passed 148/148, the runner tests passed 2/2, and `npm run build:summary:client` passed with only the existing Vite chunk-size warning, so Testing item 2 is complete. The authoritative Story 64 artifact regeneration remains open until the rebuilt main stack runs the new terminal wrapper.

- **RESOLVED ISSUE** The prior live Task 28 blocker was retired after the bounded-loop, deterministic phase-exit, duplicate-attachment, stable-publication ownership, and restart-reconciliation repairs were implemented and fully validated. Fresh provider-backed artifact regeneration remains the normal unchecked Subtask 5 execution path; it is no longer classified as an implementation blocker, and its terminal identity-matching artifacts are still required before that subtask can be checked.

- Preflight visual refinement pass ran against the supported main stack: the desktop `Flows` drawer kept separate run/target chips and the mobile transcript/composer remained readable, but the `390x844` long target chips ellipsized the shared prefix and hid the only distinguishing `additional-1`/`additional-2` suffix. Task 28 now explicitly owns that `ConversationList.tsx` repair seam and its mobile proof; no code was changed in this step.

- Planner repair renumbered this final task to Task 28 and moved the independent target-chip implementation to Task 27; Task 28 is `__to_do__` until Task 27 completes, while this task retains provider-blocked final proof ownership.
- Implementation-only audit marked Testing item 1 complete from the latest repository evidence: commit `002e7c7c` records the review-base fix, focused review-base/target/review-set tests passing 25/25, and a successful `npm run build:summary:server`. No other testing item has equivalent fresh evidence, and no product or user-facing behavior drift was introduced. Subtask 5 remains open because the latest supported publication attempt left the authoritative pointer without structured findings and the review set with one missing job; its live blocker is preserved.
- Implementation-only audit found no additional subtask or `Testing` completion beyond the existing four checked subtasks and two checked lifecycle steps. Fresh artifacts show the current pointer remains `incomplete_review` with a Markdown findings file, while the stable wave-validation artifact belongs to a different wave identity and disposition still reports `current-wave-validation-identity-mismatch`; Subtask 5 therefore remains genuinely open. The latest pass changed no product or review-flow source files and introduced no Story 64 user-facing behavior drift, so Task 28 remains `__in_progress__` with the existing publication blocker and automated proof still incomplete.
- Implementation-only audit normalized Subtask 4 and Testing items 4 and 6 from repository evidence: commit `9b862e58` records the insert-only Story 64 conversation-family handoff into main Mongo, verification of the root and slow-review child state, and healthy supported-stack startup/shutdown. No product or review-flow source files changed in this pass, so no story-caused preserved-behavior regression or user-facing drift was introduced. Subtask 5 remains the sole unchecked implementation item because the supported review-agent command did not publish the authoritative findings artifact; the live blocker remains in place and automated proof is not complete.
- Planner plan-impact review confirms the latest `**BLOCKING ANSWER**` is a manual/runtime environment seam owned by Task 28 subtask 4. The existing subtask 4 runtime-handoff owner and subtask 5 artifact-reconciliation owner provide the correct order, bounded stopping points, and final-task ownership; no prerequisite task, task split, renumbering, or story-scope change is needed. The active blocker is therefore retired as resolved context so the loop can execute the proven Mongo handoff and artifact reconciliation on Task 28, which remains `__in_progress__` with final automated validation still open.
- **BLOCKING ANSWER** Current blocker research proves a manual/runtime environment seam owned by Task 28 subtask 4: the supported main proof stack cannot see the persisted Story 64 Mongo conversation, while the existing application resume contract is already correct. Repository evidence shows `docker-compose.yml` configures the main server for `mongodb://host.docker.internal:27517/db` and its own `mongo_data` volume, while `docker-compose.local.yml` configures the local server for port `27417` and a separate local Mongo volume; live Docker state confirms `mongo_db_CodeInfo-local` is serving `27417` and exposes distinct `codeinfo2-local_mongo_data` and `codeinfo2_mongo_data` volumes. The local `db.conversations` collection contains the Story 64 root document `c8198aae-61b2-488a-8792-8868a329b7c0` with `flowName: review_artifacts_main` and saved `flags.flow.stepPath: [6]`, whereas the main stack has no access to that document. The existing code resolves conversations with `ConversationModel.findById()` in `server/src/flows/service.ts`, requires an existing `conversationId` plus persisted `flags.flow` for `resumeStepPath`, and persists that state with the existing `flags.flow` `$set` writer in `server/src/mongo/repo.ts`; no new lookup or application-level resume path is needed. The repository's only Mongo bootstrap, `mongo/init-mongo.js`, initializes the replica set and does not import flow state; the closest repository precedent is test-only conversation seeding through `withMockedMongoConversationPersistence()` and explicit seeded flow/child conversations in the resume tests, not a supported-stack runtime import.

  The chosen fix is an explicit proof-runtime data handoff: export the Story 64 root conversation and any child conversation documents referenced by its saved flow state from the local Mongo instance with the supported Mongo Database Tools query/archive workflow, restore only those `db.conversations` documents into the main Mongo instance on port `27517`, verify the exact root identifier and `flags.flow` are visible through the main server, then resume the flow and regenerate/reconcile the authoritative review artifacts. MongoDB's official tools document query-limited `mongodump`, archive output, `mongorestore` namespace selection, and the requirement to use compatible source/destination versions; Docker's official Compose documentation confirms that named volumes persist independently and that explicit external volume names or bind mounts are required to reuse a backing store, while `docker compose config` verifies the resolved environment and mounts. This fits the local state because the two stacks intentionally use separate ports and volumes, preserves the supported main stack's isolation, and transfers only the persisted state needed by the bounded proof rather than changing the flow runtime. DeepWiki could not index `Chargeuk/codeInfo2`; that absence does not weaken the direct repository evidence or the official Docker/Mongo guidance. Rejected alternatives are changing `getConversation()` or `resumeStepPath` downstream, parsing or trusting review artifacts to bypass the missing conversation, sharing an active raw `/data/db` volume, or permanently pointing the main proof server at the local `27417` URI: each bypasses the existing persistence contract, risks cross-stack corruption/isolation loss, or makes the supported main stack depend on the development runtime. References: `https://docs.docker.com/reference/compose-file/volumes/`, `https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/`, `https://www.mongodb.com/docs/database-tools/mongodump/`, `https://www.mongodb.com/docs/database-tools/mongorestore/`, and `https://www.mongodb.com/docs/database-tools/mongodump/mongodump-examples/`.
- Planner normalization converted the runtime-handoff requirement from blocker prose into explicit ownership: Task 28 subtask 4 now repairs access to the persisted Story 64 conversation, and subtask 5 owns the resulting artifact regeneration and reconciliation. All final validation checks were reopened because the handoff repair makes earlier proof stale; Task 28 remains the sole `__in_progress__` owner with a live blocker until the handoff and artifact pair are both resolved.
- Implementation-only audit confirmed the latest bounded regeneration attempt changed no product or review-flow source files and introduced no Story 64 behavior drift. The recorded healthy stack startup and shutdown remain honestly checked; no other `Testing` items were marked complete because this pass did not establish final automated proof. Subtask 4 remains unchecked, and the existing review-flow harness blocker is preserved while Task 28 remains `__in_progress__` for the bounded regeneration work.
- Planner impact review found no missing prerequisite, task split, runtime handoff, or task-shape defect: Task 28 remains the dedicated final revalidation owner, and its bounded reconciliation subtask is the correct next executable work. The proof/test-harness blocker is therefore retired as historical context so the implementation loop can continue on this task; the task remains `__in_progress__` with its explicit reconciliation and final validation work still open.
- **BLOCKING ANSWER** Fresh blocker research confirms this is a proof/test-harness contract seam owned by Task 28's final revalidation, not a product, runtime, baseline, or task-shape blocker. Repository evidence shows `server/src/flows/reviewArtifacts.ts::readValidatedFindings()` accepts inline `findings` or a JSON `findings_file`, `server/src/flows/reviewWaveValidation.ts` aggregates only those validated structured findings with server-owned source identity, the integration production-loop fixture publishes `findings.json`, and the focused review-artifact and slow-wave tests prove the same path; the fallback Markdown writer is explicitly a human-readable coverage artifact and is not an aggregation input. Context7's official JSON Schema specification and use-case guidance limit schema validation to a JSON instance's structural constraints and leave cross-artifact consistency to application logic, while MDN's `JSON.parse()` reference confirms that non-JSON Markdown cannot be parsed as the machine-readable findings payload; the external MCO review-artifact precedent likewise separates `summary.md` from aggregated `findings.json`. Code-intelligence cross-repository search found only structured review-comment documentation in the related `open-code-review` repository, not an equivalent wave aggregator, and DeepWiki could not index `Chargeuk/codeInfo2`; these limitations do not contradict the local precedent. The chosen fix remains upstream: regenerate the Story 64 `current-review` pointer with the structured findings inline or in a sibling JSON findings artifact, retain the Markdown disposition artifact, rerun wave validation, and reconcile the authoritative review-set and disposition state so the 15 findings carry matching server-owned source identities. Downstream Markdown parsing, trusting handoff counts, manually editing generated JSON, or repeating broad wrappers are rejected because they would bypass the existing validated producer/consumer contract rather than repair the artifact seam. References: `https://json-schema.org/overview/use-cases`, `https://json-schema.org/draft/2020-12/json-schema-validation`, `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse`, and `https://github.com/mco-org/mco/blob/main/README.md`.
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
- Automated-proof audit confirmed all listed builds, main-stack lifecycle steps, full client/server/Cucumber/e2e suites, lint, and formatting checks were recorded as successful, with no implementation files changed in the proof pass. Task 28 remains `__in_progress__` because the authoritative review outcome is still incomplete, not because of missing automated proof.
- **BLOCKING ANSWER** The blocker is a proof/validation contract seam caused by an upstream review-artifact shape mismatch, not a product behavior or runtime-environment issue. Repository tracing proved that `server/src/flows/reviewWaveValidation.ts` adds findings to `aggregateFindings()` only from each usable job's server-owned `pointerValidation.validated_findings`, while `server/src/flows/reviewArtifacts.ts::readValidatedFindings()` returns findings only from inline `findings` or a JSON `findings_file`; the current `0000064-current-review.json` points to `0000064-20260715T235743Z-8f7623b0a4-0551069e-findings.md`, so the validator correctly supplies an empty array and the finalized wave records `aggregated_findings: []` even though that Markdown contains 15 actionable findings. The chosen fix is upstream: make the `target_code_review_findings`/main-review publication seam emit the validated findings as inline JSON or a sibling `.json` `findings_file` in the `current-review` pointer, while retaining the Markdown artifact for human-readable disposition; then rerun the focused review-artifact/wave-validation tests and the final proof so `validateReviewWave()` produces the canonical findings and source identities before disposition runs. This fits the local contract because `readValidatedFindings()` already supports both machine-readable forms, `aggregateFindings()` already deduplicates and preserves reviewer provenance, and existing tests in `server/src/test/unit/review-wave-validation.test.ts` cover sibling aggregation, partial-result preservation, slow-wave closeout, and cross-repository gating. The external-library precedent is the official JSON Schema guidance, confirmed through Context7 and `https://json-schema.org/overview/use-cases`, which separates structural document validation from semantic consistency; that supports fixing the producer/consumer contract rather than pretending schema-valid or Markdown text proves cross-artifact agreement. Targeted web research found no external project-specific match for this private workflow; the JSON Schema validation specification at `https://github.com/json-schema-org/json-schema-spec/blob/main/specs/jsonschema-validation.md` likewise supports document-local validation, not maintaining state across separate artifacts. DeepWiki could not provide a repository precedent because `Chargeuk/codeInfo2` is not indexed. The current final task owns the closeout gate and must rerun proof after repair, but the technical repair belongs at the upstream review-artifact producer seam; changing disposition to parse Markdown or trust handoff counts, adding a bespoke Markdown parser downstream, manually editing generated review state, or repeating broad wrappers would preserve the mismatch and violate the server-owned wave-consumer contract, so those alternatives are rejected. No implementation repair was performed in this research step.
- Planner repair converts the proven producer seam into bounded same-task ownership because Task 28 is the dedicated whole-story final repair and revalidation owner. The new implementation/proof-authoring subtask makes the next stopping point explicit, and all prior automated proof is unchecked because the repair can make those results stale; the task remains `__in_progress__` for the normal implementation and proof loop.
- Updated the main findings contract so the `current-review` pointer keeps the Markdown `findings_file` for disposition and publishes the same structured findings inline for server-owned wave validation. Added review-artifact and slow-wave regressions for inline finding ingestion and `Main Review` target/source identity; both focused server-unit files passed (44 and 7 tests).
- Re-ran `npm run build:summary:server` successfully with exit code 0; the wrapper reported a clean success with no warnings.
- Re-ran `npm run build:summary:client` successfully with exit code 0; the wrapper reported the known large-chunk warning and no build failure.
- Re-ran `npm run compose:build:summary` successfully with exit code 0; both compose image builds passed.
- Started the supported main stack with `CODEINFO_HOST_INGEST_DIR=/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2 npm run compose:up` after rebuilding the images, so the repaired producer was mounted at `/data`; the stack became healthy and was stopped with `npm run compose:down` after the bounded regeneration attempt.
- **RESOLVED ISSUE** An explicit resume from an earlier step reattached terminal child-wave records from the later saved step, so wave validation could report success against stale artifacts. The flow runtime now clears child-wave tracking on an explicit rewind, while ordinary same-step resumes still reattach active work.
- Re-started the supported main stack with `npm run compose:up`; all services started and the server reported healthy.
- Re-ran `npm run test:summary:all:parallel` successfully; client (899), server unit (2629), server cucumber (138), and e2e (77) tests all passed.
- Stopped the supported main stack with `npm run compose:down`; all started containers and the compose network were removed successfully.
- **RESOLVED ISSUE** The implementation-plus-automated-proof audit found that Task 28 subtask 4 remained unchecked after normalization: the current authoritative `current-review` pointer still publishes the Markdown findings artifact without structured findings, the final slow-wave review set still reports `aggregated_findings: []`, and `review-disposition-state.json` still reports `aggregated-findings-mismatch` with `safe_to_exit_review_loop_without_tasking=false`. The producer contract change, focused regressions, and prior full-suite results were checked, but they do not prove the generated authoritative artifact pair was regenerated at the repaired HEAD. The exact remaining work is to regenerate and reconcile that pair while preserving the Markdown artifact; the issue is now actionable within Task 28's bounded reconciliation subtask, so the live blocker is retired rather than preserved as an active prerequisite. All eight final validation checks remain open because the unresolved artifact repair can make their earlier results stale.
- Repaired explicit flow rewinds to discard stale child-wave tracking and added a focused regression; `npm run test:summary:server:unit -- --file src/test/integration/flows.run.subflow.test.ts` passed 48 tests. The supported main stack rebuilt and started successfully, but its Mongo instance has no persisted Story 64 root-flow conversation, while the stored conversation exists only in the local development Mongo instance; direct resume therefore returns `resumeStepPath requires saved flow state`.
- **RESOLVED ISSUE** Subtasks 4 and 5 remained open after normalization. Evidence checked: the code-level stale-child resume defect is fixed, the supported main proof stack starts and stops successfully, but its Mongo service could not access the persisted Story 64 review-flow conversation in the local development Mongo instance; the authoritative `current-review` pointer and slow-wave/review-set pair therefore remained stale and mismatched. The proven bounded Mongo data-handoff solution and existing Task 28 ownership now make the next implementation step actionable; no product behavior change is authorized or required.
- Repaired Subtask 4's supported runtime handoff by query-dumping the Story 64 two-phase conversation family from local Mongo and restoring it insert-only into the main Mongo service. Verified root `001fd33d-f902-482b-93d1-8a195d5fc279` and slow-review child `c8198aae-61b2-488a-8792-8868a329b7c0`, including the persisted root execution and flow state, are visible to the main service; no unrelated main conversations were dropped.
- Started and stopped the supported main stack while executing the runtime handoff and regeneration attempt; the server became healthy and `npm run compose:down` removed the started services and network.
- **RESOLVED ISSUE** The restored review conversation retained `/data` and a stale `98fc20d` target after handoff. Resuming the parent with the supported `/data/codeinfo2/codeInfo2` source and predecessor path regenerated the slow target at `865614e`; a cancelled source root then blocked the required re-embed, so a fresh supported ingestion was completed (1,519 files and 5,366 chunks). Re-running the wave passed target validation and re-ingest, and the slow-review child advanced to its evidence command. Subtask 5 remains open for that command's normal publication and artifact reconciliation, but no live implementation blocker remains.
- **RESOLVED ISSUE** The review-agent execution state was cleared on the supported main stack and a fresh `6a7341a` slow wave passed target validation, re-ingest, and every evidence-gate command item; it published a completed canonical `current-review` handoff with the new wave identity. The deeper findings pass exposed that review targets pinned only `HEAD`, allowing the comparison base to move between target preparation and base publication. Target snapshots now carry the resolved base commit and `prepareReviewBase()` rejects a drifted base; focused review-base, target, and review-set unit tests passed (25/25) and `npm run build:summary:server` passed. Subtask 5 remains open for a fresh post-commit wave and final artifact reconciliation, but no live implementation blocker remains.
- **RESOLVED ISSUE** Subtask 5, “Regenerate the authoritative Story 64 `current-review` pointer and slow-wave/review-set artifacts ...,” remained open. The supported main stack was started successfully, and the persisted root `001fd33d-f902-482b-93d1-8a195d5fc279` plus child `e022dd2a-9452-40ed-b074-10ce9f2c43eb` were visible. The root resume attempt was rejected because its saved flow state was not resumable; a direct child resume was accepted with HTTP 202 and launched Codex, but the child terminated without advancing the wave. The authoritative pointer remains `completed` with no `findings_file` and zero structured findings, while review set `0000064-rw-20260716T060452Z-d31ef833` remains `prepared` with `missing_jobs: 1`; no finalized wave validation or reconciliation of the 15 findings was produced. The main stack was stopped cleanly. The blocker research proves that Task 28 remains the correct owner and that continuation must use a fresh slow-wave snapshot with terminal artifact validation rather than another root/child resume; no prerequisite, task split, renumbering, re-ownership, or story-scope repair is required.
- **BLOCKING ANSWER** Fresh blocker research proves a proof/test-harness seam owned by Task 28's final revalidation, with no product-code or new runtime-path repair justified. Direct repository evidence shows `server/src/flows/service.ts` accepts a resume only when the existing conversation has parseable `flags.flow` state, validates saved child ownership/execution identity, and backfills only missing child execution IDs; `server/src/routes/flowsRun.ts` returns HTTP 202 immediately after accepting `startFlowRun()`, so the accepted child request is not evidence that background review work completed. The current artifacts confirm the failure: `codeInfoTmp/reviews/0000064-current-review.json` is `completed` for `0000064-rw-20260716T060452Z-d31ef833` but has no `findings_file` or structured findings, `0000064-current-review-set.json` is still `prepared` with `coverage.missing_jobs: 1`, and the disposition state keeps `safe_to_exit_review_loop_without_tasking: false` because the stable wave-validation identity does not match the current slow wave. Repository precedents in `server/src/test/integration/flows.run.resume.identity.test.ts` cover legitimate persisted resumes and reject missing/conflicting child state; `server/src/test/unit/review-wave-validation.test.ts` covers complete, partial, and slow-wave closeout. The shared `codeinfo_markdown/shared/review-wave-consumer-contract.md` and `docs/subflow-waves-and-review-sets.md` require a fresh target snapshot, wave ID, HEAD/base pair, and pointers after fixes, and require every expected slow job to be usable before closeout. `server/src/flows/reviewArtifacts.ts::readValidatedFindings()` accepts only inline structured findings or a JSON `findings_file`, while `reviewWaveValidation.ts` aggregates those validated findings with server-owned source identity; the Markdown artifact remains human-readable evidence, not an aggregation input.

  The chosen solution is to abandon the non-resumable root and the already-accepted child attempt, prepare a fresh supported slow-wave snapshot and review set at the current HEAD/base, launch the normal target-local review flow, and wait for terminal child evidence rather than treating HTTP 202 as completion. Only after the new wave's target validation is usable and its finalized review set and matching wave-validation artifact agree on `story_id`, `review_wave_id`, `parent_execution_id`, target hash, and server-owned source identities should Task 28 reconcile the 15 findings and disposition state; retain the Markdown findings artifact beside the structured JSON findings. This fits the local repository because the persisted conversation is already visible, the existing resume contract correctly rejected unusable saved state, and the consumer contract explicitly defines fresh-wave retry and missing-job closeout behavior.

  External confirmation supports the same boundary. The official HTTP Semantics specification defines `202 Accepted` as accepted for processing but not completed and intentionally noncommittal: [RFC 9110 §15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-202-accepted). Context7's Express documentation confirms the route/response construction but provides no completion guarantee; completion must therefore come from the persisted flow and review artifacts. DeepWiki's `mco-org/mco` precedent separates machine-readable `findings.json`/run metadata from Markdown summaries and represents asynchronous and partial work with terminal state, decision, and provider results. Rejected alternatives are resuming the rejected root, retrying the accepted child or repeatedly waiting on its 202 response, parsing Markdown downstream, trusting handoff counts, manually editing generated review JSON, reusing the stale wave identity, or changing `getConversation()`/resume logic: each either bypasses the proven persisted-flow contract, treats admission as completion, loses server-owned provenance, or violates the fresh-wave artifact contract. The blocker family is therefore proof/test-harness, and Task 28 owns the bounded fresh-wave publication and reconciliation gate while the failed external child execution remains visibly blocked if no terminal artifact pair is produced.
- **RESOLVED ISSUE** Subtask 5, “Regenerate the authoritative Story 64 `current-review` pointer and slow-wave/review-set artifacts ...,” remains open. The required fresh root run was launched through the supported stack as conversation `cc05231c-1096-4085-99a1-86f309e0bb83`, producing fresh wave `0000064-rw-20260716T071459Z-27f127a7` at HEAD `17f85a354d7800615078bbdd295281374be1fd02`. Its normal fast phase stalled with both target reviewers still `running` and no child turn updates for roughly three minutes; the fresh pointer remains `preparing` with zero findings and the fresh review set remains `prepared` with `coverage.missing_jobs: 3`, so the required slow-wave terminal artifacts were never reached. The stack was stopped cleanly after the bounded wait. This is the required external review-agent/provider capability; the proven fresh-wave continuation remains owned by Task 28 and does not require a prerequisite, split, reorder, re-ownership, or task-shape rewrite.
- **BLOCKING ANSWER** Fresh blocker research classifies the stalled fast wave as a proof/test-harness seam owned by Task 28's final revalidation gate, not a product regression or a missing repository runtime path. The current evidence is bounded and reproducible: wave `0000064-rw-20260716T071459Z-27f127a7` has both target reviewers still `running`, no child turn updates after the bounded wait, a `preparing` `current-review` pointer with no findings, and a `prepared` review set with three missing jobs. Repository tracing shows the generic wave runner in `server/src/flows/service.ts` persists `running/completed/failed/stopped/notApplicable` progress and waits for terminal child status; it converts a child to `failed` only when the process has errored or when resume finds no active run and no terminal result, and converts it to `stopped` on cancellation. `server/src/flows/codexReview.ts` already closes stdin before invoking `codex exec`, has an explicit 1,800,000 ms child-process timeout, and maps abort/error through the existing terminal flow path. `reviewWaveValidation.ts` and `reviewSet.ts` correctly retain missing jobs and allow closeout only when every expected job is completed. Existing `flows.run.subflow.test.ts` cases cover crash-to-failed, cancellation-to-stopped, stale-child failure, and terminal parallel-child recovery; review-artifact and wave-validation tests cover missing/stale jobs and fresh-wave identity.

  The chosen solution is to keep the incomplete wave visibly blocked until each provider reaches a real terminal outcome under the existing timeout/abort contract, then prepare a new immutable target snapshot and wave/review-set identity and rerun the supported fast/slow publication path. A quiet three-minute interval is not a valid completion signal and should not be converted to success; if the provider exits by timeout, abort, or error, preserve that terminal failure/stop in coverage and keep `closeout_allowed: false` until a later fresh wave produces usable artifacts. Once all expected jobs are terminal and the new pointer, review set, wave validation, structured findings, and server-owned identities agree, Task 28 can reconcile the 15 findings and disposition state. The current task owns that final artifact gate; the underlying provider execution capability is an external harness boundary, so no product-code, `getConversation()`, downstream Markdown parser, or manual review-set edit is justified.

  External confirmation supports this boundary. Node's official `child_process` documentation states that `execFile` aborts through `AbortSignal` as an `AbortError` and terminates only when the process is killed or exits ([Node.js child process API](https://nodejs.org/api/child_process.html)). The official Codex app-server contract defers a command response until process exit and exposes explicit timeout/termination controls ([Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)); DeepWiki's `openai/codex` precedent likewise distinguishes started JSONL events from completed turns and exit status. Codex issue [#14335](https://github.com/openai/codex/issues/14335) documents the real automation hazard of a review timeout ending without a distinct timeout result, while [#20919](https://github.com/openai/codex/issues/20919) documents a separate non-TTY stdin hang; the local `execFileWithClosedStdin()` already addresses the latter, so adding another stdin workaround is not suitable. Rejected alternatives are treating missing updates as success, adding arbitrary longer waits, repeatedly rerunning broad wrappers, reusing the stale wave, or manually fabricating completed findings: each either hides a still-running provider, bypasses the existing terminal/coverage contract, or destroys server-owned provenance. No new prerequisite or task split is proven by this evidence; Task 28 remains the bounded owner while the provider capability remains visibly blocked.
- **BLOCKING ANSWER** Fresh bounded blocker research re-confirmed a proof/test-harness seam owned by Task 28 Subtask 5. Current repository evidence is the live `0000064-rw-20260716T071459Z-27f127a7` wave: `0000064-current-review.json` remains `preparing` with no findings, the matching review set remains `prepared` with `coverage.missing_jobs: 3`, and `0000064-current-review-wave-validation.json` is a different older wave, so disposition correctly keeps `safe_to_exit_review_loop_without_tasking: false`. Repository precedents establish the intended fix: `server/src/flows/service.ts` and `server/src/flows/codexReview.ts` preserve explicit child terminal states and timeout/abort handling; `reviewSet.ts` and `reviewWaveValidation.ts` preserve missing-job coverage and only allow closeout after expected jobs are usable; `reviewArtifacts.ts::readValidatedFindings()` consumes only inline structured findings or a JSON `findings_file`; and `flows.run.subflow.test.ts` plus `review-wave-validation.test.ts` cover crash, cancellation, stale-child, partial, and fresh-wave identity cases. The exact resolution is therefore to leave this incomplete wave blocked, then create a fresh immutable target snapshot and wave/review-set identity, rerun the supported fast/slow publication path, and reconcile findings only after every child has a terminal result and the pointer, review set, validation artifact, structured findings, and server-owned identities agree. This is not a product, baseline, runtime-handoff, or task-shape defect, so Task 28 remains the owner and no prerequisite or split is justified. External confirmation agrees: the official Node.js `execFile` contract invokes its callback when the child terminates and maps abort to `AbortError`; the official Codex app-server README defines `turn/started`/`item/started` as progress and `turn/completed`/`exitedReviewMode` as terminal review output; DeepWiki's `openai/codex` guidance requires clients to wait for `turn/completed`; and Codex issues [#14335](https://github.com/openai/codex/issues/14335) and [#20919](https://github.com/openai/codex/issues/20919) document timeout-without-verdict and non-TTY stdin hangs. Treating silence or HTTP 202 as success, extending waits arbitrarily, retrying the same wave, parsing Markdown downstream, or fabricating JSON would bypass those contracts and destroy provenance, so those alternatives are rejected.
- Preflight visual refinement pass ran on the supported main stack; it clarified the persisted root-review target-chip seam in `ConversationList.tsx` at the desktop rail and mobile conversations drawer. No code was changed in this step.
- **BLOCKING ANSWER** Fresh repository and external confirmation preserves the current solution: `service.ts`/`codexReview.ts` and `flows.run.subflow.test.ts` already model running children, terminal `failed`/`stopped` outcomes, cancellation, crash recovery, and resume without duplicate work; `reviewWaveValidation.ts`/`reviewSet.ts` keep `missing_jobs` and `closeout_allowed=false` until every expected job is usable. Node’s official `execFile` contract invokes its callback only when the child terminates and maps `AbortSignal` cancellation to `AbortError`; Codex’s app-server contract distinguishes progress (`turn/started`, `enteredReviewMode`) from terminal (`turn/completed`, `exitedReviewMode`) events, and RFC 9110 defines HTTP 202 as accepted but not completed. Codex issues [#14335](https://github.com/openai/codex/issues/14335) and [#20919](https://github.com/openai/codex/issues/20919) independently document timeout-without-verdict and non-TTY stdin hangs, while the local runner already closes stdin and has an explicit timeout. Therefore the chosen fix remains a fresh immutable target/wave/review-set run followed by terminal-artifact validation and findings reconciliation; silence, 202 admission, arbitrary longer waits, same-wave retries, Markdown parsing, or fabricated findings are rejected. This is a proof/test-harness seam owned by Task 28 Subtask 5, not a product, baseline, runtime-handoff, or task-shape defect, so no prerequisite or task split is justified.
- **RESOLVED ISSUE** Historical Subtask 5 blocker evidence from a fresh supported `two_phase_review_cycle` attempt is superseded by the completion of Task 27 and the current Task 28 selection. The cycle created wave `0000064-rw-20260716T100443Z-d54e553f` and entered the normal fast review wave, but after roughly three minutes its persisted run still reported two reviewer jobs running, zero completed or failed jobs, and one not-applicable job; the authoritative pointer remained `preparing` with no findings and the matching review set remained `prepared` with three missing jobs. A persisted-root continuation was also attempted and correctly rejected with `INVALID_REQUEST` because that conversation had no saved flow state; no alternate runtime path or manual artifact fabrication was justified. The current provider limitation and the remaining Subtask 5 work are represented by the later live blocker below.
- Implementation-only audit of the latest provider pass found no newly completed subtask or `Testing` item. Commit `1fa63f97` changed only the plan note; current artifacts still show wave `0000064-rw-20260716T100443Z-d54e553f` as `preparing`, its review set as `prepared` with three missing jobs, and the stable validation artifact belonging to a different wave. Repository source still has the target chip only for child rows via `flags.flowChild.targetId`, so Subtask 6 remains open for the root-row target chip; no story-caused preserved-behavior regression or unrelated user-facing drift was introduced. Task 28 remains `__in_progress__` with the existing provider blocker, Subtasks 5 and 6, and five unchecked automated proof steps still open.
- **BLOCKING ANSWER** Current-pass revalidation preserves the same proven resolution. The persisted pair remains wave `0000064-rw-20260716T100443Z-d54e553f` with `current-review.status=preparing`, review-set `completed_jobs=0`, `failed_jobs=0`, `missing_jobs=3`, and validation for an older wave; local `service.ts`/`codexReview.ts` and `reviewWaveValidation.test.ts` explicitly distinguish running, failed/stopped, missing, and terminal closeout states. The official Node child-process contract waits for termination and reports abort as `AbortError`; the Codex app-server README makes `turn/completed` and `exitedReviewMode` terminal, while issue #14335 documents timeout-without-verdict ambiguity. Therefore the fix is a fresh immutable target/wave/review-set run followed by terminal-artifact and server-owned identity validation; silence, HTTP 202, arbitrary extra waiting, same-wave retry, Markdown parsing, and fabricated JSON are rejected. This remains a proof/test-harness seam owned by Task 28 Subtask 5; the repository-query, DeepWiki, and Context7 calls timed out in this pass, so the local precedents and official web references are the usable evidence. No prerequisite, baseline, runtime-handoff, product, or task-shape repair is indicated.
- **BLOCKING ANSWER** Fresh disk recheck confirms no state change: the same wave remains `preparing`, its review set still has three missing jobs, and the validation artifact still belongs to another wave. The checked-in `service.ts`, `codexReview.ts`, `reviewSet.ts`, `reviewWaveValidation.ts`, and flow/validation tests prove that running or missing children cannot be treated as closeout; the official Node `execFile` and Codex app-server contracts, plus Codex issue #14335, support waiting for terminal outcomes and preserving timeout ambiguity as a blocker. The proven owner remains Task 28 Subtask 5 and the proven remedy remains a fresh immutable wave with terminal artifact/identity validation; no prerequisite or plan repair is indicated.
- **BLOCKING ANSWER** Fresh blocker research proves the same proof/test-harness seam and confirms that Task 28 Subtask 5 owns the final artifact gate. Current disk evidence is still non-closeable: `0000064-current-review.json` is `preparing` with no structured findings, the stable review set is `prepared` with three missing jobs, and the versioned wave artifacts are at best `completed_partial` with one completed and two failed jobs, no findings, and `closeout_allowed: false`; these artifacts cannot honestly reconcile the 15 findings or server-owned source identities. Repository precedents establish the supported resolution: `service.ts` and `codexReview.ts` persist explicit running/completed/failed/stopped/not-applicable outcomes and already close stdin plus enforce timeout/abort handling; `reviewSet.ts` initializes missing coverage and `reviewWaveValidation.ts` permits closeout only when every expected job is completed; `reviewArtifacts.ts::readValidatedFindings()` accepts only inline structured findings or a JSON `findings_file`; `flows.run.subflow.test.ts` and `review-wave-validation.test.ts` cover terminal child outcomes, partial waves, missing jobs, and immutable wave identity. The code-index query was unavailable after a bounded wait, so these checked-in source and test precedents are the repository evidence used.

  External confirmation matches that contract. Context7's official Node.js documentation says `execFile` callbacks run when the child terminates and that abort delivers `AbortError`; Node's official API also distinguishes a running child (`exitCode === null`) from a terminated process. The official Codex app-server README defines `turn/started`/`enteredReviewMode` as progress and `turn/completed`/`exitedReviewMode` as terminal review output, while Codex issue [#14335](https://github.com/openai/codex/issues/14335) documents timeout-without-verdict ambiguity and issue [#20919](https://github.com/openai/codex/issues/20919) documents non-TTY stdin hangs; the local `execFileWithClosedStdin()` already addresses the latter. The chosen fix is therefore to preserve the current wave as failed/partial evidence, prepare a fresh immutable target snapshot and wave/review-set identity at the current HEAD/base, rerun the supported fast/slow publication path, and reconcile findings only after terminal child outcomes plus matching pointer, review-set, validation, structured-findings, and server-owned identity artifacts agree. This blocker is not a product, shared-baseline, runtime-handoff, or task-shape defect; Task 28 owns the bounded proof gate, and rejected alternatives are treating silence or HTTP 202 as success, adding arbitrary waits, retrying the same wave, parsing Markdown downstream, manually fabricating JSON, or changing resume logic because each bypasses terminal/coverage/provenance contracts.
- **BLOCKING ANSWER** Fresh current-pass research revalidates the existing proof/test-harness classification and Task 28 Subtask 5 ownership. Disk artifacts remain non-closeable: the stable pointer is `preparing` with no structured findings, the stable review set is `prepared` with three missing jobs, and the versioned wave is only `completed_partial` with one completed and two failed jobs and `closeout_allowed: false`. Checked-in precedents in `service.ts`, `codexReview.ts`, `reviewSet.ts`, `reviewWaveValidation.ts`, `reviewArtifacts.ts`, `flows.run.subflow.test.ts`, and `review-wave-validation.test.ts` establish explicit terminal child states, closed-stdin/timeout handling, missing-job coverage, JSON-only machine findings, fresh-wave identity, and all-completed closeout; the code-index query timed out again, so these direct source and test precedents are the usable repository evidence. Context7's official Node contract and the official Codex app-server contract confirm that process callbacks and `turn/completed`/`exitedReviewMode` are terminal, while issues [#14335](https://github.com/openai/codex/issues/14335) and [#20919](https://github.com/openai/codex/issues/20919) document timeout-without-verdict and non-TTY stdin failure modes. The chosen fix remains a fresh immutable snapshot/wave/review-set run followed by terminal artifact, structured-findings, and server-owned identity reconciliation; silence, arbitrary waits, same-wave retries, downstream Markdown parsing, fabricated JSON, and resume-path changes are rejected because they bypass the local coverage and provenance contracts. No prerequisite, split, renumbering, baseline, runtime-handoff, or product repair is justified.
- **BLOCKING ANSWER** Fresh bounded research proves the current blocker is a proof/test-harness seam owned by Task 28 Subtask 5, not a product, baseline, runtime-handoff, or task-shape defect. Current disk evidence is non-closeable for wave `0000064-rw-20260716T100443Z-d54e553f`: `0000064-current-review.json` is `preparing` with no findings, the matching review set is `prepared` with `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`, and the versioned validation/review-set artifacts remain partial with `closeout_allowed: false`. Repository precedents prove the intended boundary: `reviewArtifacts.ts::readValidatedFindings()` accepts only inline findings or a JSON `findings_file`; `reviewWaveValidation.ts` aggregates only validated findings with server-owned source identity and allows closeout only when every expected job is completed; `service.ts`/`codexReview.ts` preserve running and terminal child outcomes, close stdin, and enforce timeout/abort handling; and `flows.run.subflow.test.ts` plus `review-wave-validation.test.ts` cover resume identity, stale/missing children, partial waves, and fresh-wave identity. The existing Mongo handoff is not the current owner: `service.ts` requires an existing conversation and saved `flags.flow` for resume, while the checked-in Compose files intentionally point local and main stacks at separate ports/volumes; MongoDB's official Database Tools support bounded `mongodump --query`/archive and `mongorestore --nsInclude`/`--nsFrom`/`--nsTo` transfers with matching-version requirements and post-restore verification, and Docker's official Compose contract confirms named-volume persistence and project isolation. Those references prove the earlier data handoff is an explicit, verifiable seam rather than justification for changing resume logic.

  The chosen solution is to preserve this incomplete wave as blocker evidence, abandon the non-terminal attempt, create a fresh immutable target snapshot and review-set/wave identity at the current HEAD/base, run the supported fast/slow publication flow, and wait for terminal reviewer outcomes. Only after matching pointer, review-set, wave-validation, structured-findings, and server-owned source-identity artifacts agree should Task 28 reconcile the 15 findings and disposition state. Official Node child-process semantics distinguish a running child from a terminated process and report abort separately; Codex issue [#14335](https://github.com/openai/codex/issues/14335) documents timeout-without-verdict ambiguity, and issue [#20919](https://github.com/openai/codex/issues/20919) documents non-TTY stdin hangs; the local closed-stdin runner addresses the latter. The MongoDB restore references are [mongodump](https://www.mongodb.com/docs/database-tools/mongodump/), [mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/), and [restore examples](https://www.mongodb.com/docs/database-tools/mongorestore/mongorestore-examples/); DeepWiki's `mongodb/mongo-tools` precedent likewise requires checking restore failures and verifying restored counts. Rejected alternatives are arbitrary longer waits, same-wave retries, treating HTTP 202 or silence as completion, parsing Markdown downstream, fabricating JSON, reusing stale wave identity, or changing application resume logic: each bypasses the repository's terminal, coverage, or provenance contracts. No prerequisite, split, renumbering, or plan repair is justified; the live blocker remains until the supported external reviewer execution produces terminal artifacts.
- **RESOLVED ISSUE** Earlier same-class blocker-research generations were exhausted or superseded; they established the same terminal-outcome, coverage, wave-identity, and structured-findings boundary. They are compressed here so the current blocker remains the only active state.
- **BLOCKING ANSWER** Fresh blocker-repair research reconfirms a proof/test-harness seam owned by Task 28 Subtask 5. The current wave `0000064-rw-20260716T100443Z-d54e553f` remains `preparing` with no findings; its matching review set remains `prepared` with `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`; matching validation remains `blocked`; and no current-wave terminal artifact exists. Checked-in `service.ts`/`codexReview.ts` preserve running versus `ok`/`failed`/`stopped`/`not_applicable` outcomes and closed-stdin/abort handling; `reviewWaveValidation.ts` requires exact snapshot/review-set identity and allows closeout only when every expected job is completed; `reviewArtifacts.ts` accepts only inline findings or a JSON findings file; and the lifecycle and validation tests cover missing, partial, terminal, and fresh-wave cases. Context7’s Node contract ties `execFile` completion to child termination and maps abort to `AbortError`; DeepWiki’s Codex lifecycle distinguishes in-progress review events from terminal decisions and fails closed on timeout, abort, parse failure, or missing verdict. Targeted issue research confirms the concrete automation hazards in [#14335](https://github.com/openai/codex/issues/14335) (timeout without a distinct review result) and [#20919](https://github.com/openai/codex/issues/20919) (non-TTY stdin hang); the local runner already closes stdin, so that workaround is not the current fix. The chosen solution remains a fresh immutable snapshot/wave/review set, supported reviewer execution, and reconciliation only after terminal, wave-matching, server-owned structured findings exist. Silence, arbitrary longer waits, same-wave retries, HTTP-202 admission, Markdown parsing, fabricated findings, and resume-path changes are rejected because they bypass local coverage or provenance. No prerequisite, baseline, runtime-handoff, product, or task-shape repair is proven; the blocker remains active until reviewer execution produces terminal artifacts.
- **BLOCKING ANSWER** Fresh bounded repository and external re-check reconfirms the proof/test-harness seam owned by Task 28 Subtask 5. Current disk state remains non-terminal for wave `0000064-rw-20260716T100443Z-d54e553f`: the pointer is `preparing` with no findings, the matching review set is `prepared` with `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`, and matching validation is `blocked`; no current-wave terminal artifact exists. Checked-in `service.ts`/`codexReview.ts` preserve running versus terminal child outcomes and closed-stdin/abort handling; `reviewWaveValidation.ts` requires exact snapshot/review-set identity and all expected jobs completed before closeout; `reviewArtifacts.ts` consumes only inline or JSON findings; and the lifecycle/validation tests cover missing, partial, terminal, and fresh-wave cases. Context7’s Node contract ties `execFile` completion to child termination and maps abort to `AbortError`; DeepWiki’s Codex lifecycle fails closed on timeout, abort, parse failure, or missing verdict. Targeted issue research confirms timeout-without-verdict in [#14335](https://github.com/openai/codex/issues/14335) and non-TTY stdin hangs in [#20919](https://github.com/openai/codex/issues/20919); the local runner already closes stdin. The chosen solution is a fresh immutable snapshot/wave/review set, supported reviewer execution, and reconciliation only after terminal, identity-matching, server-owned structured findings exist. Silence, arbitrary waits, same-wave retries, HTTP-202 admission, Markdown parsing, fabricated findings, and resume-path changes are rejected because they bypass local coverage/provenance. No prerequisite, baseline, runtime-handoff, product, or task-shape repair is proven; the blocker remains active until reviewer execution produces terminal artifacts.
- **BLOCKING ANSWER** Fresh bounded repository and external research reconfirms a proof/test-harness seam owned by Task 28 Subtask 5. For wave `0000064-rw-20260716T100443Z-d54e553f`, the current-review pointer is `preparing` with no findings, the matching review set is `prepared` with `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`, and the same-wave validation artifact is only `completed_partial` with one completed job, two failed/stale jobs, and `closeout_allowed: false`. Checked-in `service.ts`/`codexReview.ts` preserve explicit running and terminal child outcomes plus timeout/abort and closed-stdin handling; `reviewSet.ts` records missing coverage; `reviewWaveValidation.ts` requires exact identity and all expected jobs before closeout; `reviewArtifacts.ts::readValidatedFindings()` accepts only inline or JSON findings; and the lifecycle/validation tests cover missing, stale, partial, cancellation, and fresh-wave cases. The indexed `open-code-review` precedent validates and filters findings before publishing. Context7's official Node contract ties `execFile` completion to child termination and maps abort to `AbortError`; DeepWiki's Codex lifecycle distinguishes progress from terminal `turn/completed`/`exitedReviewMode`; and [Codex issue #14335](https://github.com/openai/codex/issues/14335) documents timeout-without-verdict while [#20919](https://github.com/openai/codex/issues/20919) documents non-TTY stdin hangs, which the local closed-stdin runner already addresses. The supported fix is to preserve this incomplete wave, create a fresh immutable target/wave/review-set identity, rerun the supported reviewer path, and reconcile only after terminal, identity-matching, structured-findings, and server-owned artifacts agree. Arbitrary waits, same-wave retries, HTTP-202 admission, downstream Markdown parsing, fabricated JSON, resume-path changes, and product edits are rejected because they bypass terminal, coverage, or provenance contracts. No prerequisite, baseline, runtime-handoff, product, or task-shape repair is indicated; Task 28 remains the owner and the blocker remains active.
- Planner plan-impact repair supersedes the earlier no-repair conclusion: the blocker remains a proof/test-harness seam owned by Task 28 Subtask 5, but the repeated final-task passes also held independent root-row target-chip implementation behind that provider gate. The former final task is now Task 28 with `__to_do__` status and an explicit Task 27 prerequisite; the target-chip work is a new bounded Task 27 with the sole `__in_progress__` status. This changes execution order only, preserves the live provider blocker for Task 28, and keeps the story scope and final proof ownership intact.
- Implemented Subtask 6 in `ConversationList.tsx`: long root and child target IDs now render a deterministic final two-segment suffix and target chips do not shrink, while existing target sources and test IDs remain unchanged. Added focused sidebar coverage for distinct `additional-1` and `additional-2` labels; `npm run test:summary:client -- --file client/src/test/chatSidebar.test.tsx` passed 21/21.
- **RESOLVED ISSUE** Earlier artifact recheck recorded the same provider-blocked state: the current pointer was `preparing`, the review set had missing coverage, and the versioned validation was partial with `closeout_allowed: false`; no credible in-scope repair or terminal reviewer result existed. This historical note is superseded by the later live blocker below, with no implementation or task-ownership change.
- Implementation-only audit normalized Task 28 after fresh bounded review: Subtask 6 was already honestly complete in commit `90c5cde8`, and no `Testing` item was newly completed in this pass. The approved target-chip behavior, root/child source paths, and existing test IDs remain aligned with the story, so no story-caused preserved-behavior regression or unapproved user-facing drift was found. The stale historical blocker was retired while the current Subtask 5 provider blocker remains authoritative; Task 28 stays `__in_progress__` and is not ready for automated proof.
- **BLOCKING ANSWER** Fresh blocker research reconfirms that Subtask 5 is a proof/test-harness seam owned by Task 28, not a product, runtime-handoff, shared-baseline, or task-shape defect. Current disk artifacts are non-closeable for wave `0000064-rw-20260716T100443Z-d54e553f`: `0000064-current-review.json` is `preparing` with `findings_file: null`, no review output, and zero findings; the stable review set is `prepared` with three expected jobs and `missing_jobs: 3`; the versioned final review set is only `completed_partial` with one completed cross-repository job and two stale target jobs; and the matching wave validation has `closeout_allowed: false`, while the stable validation pointer still belongs to an older wave. This is the exact blocker state reported by `plan_status.py`, not an inferred provider symptom.

  Repository precedents establish the intended upstream contract. `server/src/flows/reviewArtifacts.ts::readValidatedFindings()` accepts inline structured findings or a JSON `findings_file` and deliberately does not parse Markdown; `server/src/flows/reviewWaveValidation.ts` validates exact story/plan/target/wave/HEAD identity, attaches server-owned source identity, aggregates only validated findings, and allows closeout only when every expected job is completed; `server/src/flows/reviewSet.ts` correctly initializes a prepared set with all expected jobs missing; `server/src/test/integration/review-production-loop.test.ts`, `server/src/test/unit/review-artifacts.test.ts`, and `server/src/test/unit/review-wave-validation.test.ts` prove the structured findings, stale/missing coverage, partial-wave, and identity paths; and `scripts/publish_open_code_review.py` plus `scripts/test/test_publish_open_code_review.py` atomically publish a canonical JSON pointer beside Markdown and explicitly preserve partial coverage. The strongest related-ingested-repository precedent found by `code_info` is that OpenCode publisher: it validates per-bundle `comments-*.json`/`validation-*.json` before publishing `current-open-code-review.json` and `open-code-review.md`, permits a visibly partial publication, and does not treat that partial state as clean completion.

  External confirmation matches the local boundary. Context7's official Node.js contract says `execFile` invokes its callback when the child terminates and reports `AbortError` when an `AbortSignal` aborts it; the official Codex app-server README distinguishes progress (`turn/started`, `enteredReviewMode`) from terminal `exitedReviewMode`/`item/completed` and `turn/completed` events, and DeepWiki's `openai/codex` lifecycle guidance gives the same terminal-event rule. DeepWiki's `mco-org/mco` precedent separates machine-readable `findings.json` and `run.json` from human-readable `summary.md`/`decision.md` and waits for provider outcomes before final artifact publication. Codex issue [#14335](https://github.com/openai/codex/issues/14335) documents timeout-without-verdict ambiguity, issue [#20919](https://github.com/openai/codex/issues/20919) documents non-TTY stdin hangs, and the local `execFileWithClosedStdin()` path already addresses the latter; the official Node reference is [child_process.execFile](https://nodejs.org/api/child_process.html), and the app-server reference is [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

  The chosen fix is therefore to preserve this incomplete wave as evidence, abandon the stale/non-terminal attempt, create a fresh immutable target snapshot plus review-set/wave identity at the current HEAD/base, run the supported fast/slow publication path, and wait for terminal reviewer outcomes. After terminal target artifacts exist, the producer must publish the validated 15 findings inline or through a sibling JSON `findings_file` while retaining the Markdown artifact; then `reviewWaveValidation` must verify matching identity and server-owned sources before Task 28 reconciles `aggregated_findings` and disposition. Partial reviewer artifacts may be published as partial evidence, but they must retain `closeout_allowed: false` until every expected job and the cross-repository requirement are satisfied. Arbitrary longer waits, treating HTTP 202 or silence as completion, retrying the same wave, parsing Markdown downstream, manually fabricating JSON, reusing stale identity, changing resume logic, or sharing the development Mongo volume are rejected because each bypasses the repository's terminal, coverage, isolation, or provenance contracts. No prerequisite, task split, re-ownership, or product behavior change is justified; the live blocker remains until the supported reviewer execution produces terminal, identity-matching, structured artifacts.
- **RESOLVED ISSUE** Subtask 5 was the first unchecked subtask after a fresh artifact and repository-contract recheck. The current pointer remained `preparing` with no findings, the matching review set remained `prepared` with missing reviewer coverage, and the versioned validation remained partial with `closeout_allowed: false`; the existing producer/consumer repair could not manufacture terminal external reviewer results. The blocker-repair research now provides the supported fresh-wave, terminal-outcome, identity-matching regeneration path owned by this task, so this prior provider-capability state is preserved as resolved context rather than an active plan blocker.
- Implementation-only audit normalized the duplicate same-class blocker history after reviewing commit `c212b212`: no product or review-flow source files changed, no subtask or `Testing` item was newly completed, and no story-caused preserved-behavior regression or unapproved user-facing drift was found. Task 28 remains `__in_progress__` with Subtask 5 and the existing automated proof items open; only the later provider-capability blocker remains live.
- **BLOCKING ANSWER** Fresh blocker-repair research confirms that Task 28 Subtask 5 owns a proof/test-harness seam, not a product, shared-baseline, runtime-handoff, or task-shape defect. Current disk evidence is non-closeable for wave `0000064-rw-20260716T100443Z-d54e553f`: `codeInfoTmp/reviews/0000064-current-review.json` is `preparing` with `findings_file: null` and no structured findings; the matching fast `current-review-set.json` has three expected jobs, `cross_repository_required: true`, and coverage `completed_jobs: 0`, `failed_jobs: 0`, `missing_jobs: 3`; and the versioned final wave artifact is `completed_partial` with one completed cross-repository job, two stale target-review jobs, and `closeout_allowed: false`. The stable `current-review-wave-validation.json` points to a different older slow wave, so it cannot validate this current attempt.

  Repository precedents prove the intended upstream contract. `server/src/flows/reviewArtifacts.ts::readValidatedFindings()` consumes only inline structured findings or a repository-contained JSON `findings_file`; it does not parse Markdown. `server/src/flows/reviewWaveValidation.ts` requires matching wave/set identity, aggregates only validated job findings with server-owned source identity, and sets `closeout_allowed` only when every expected job is completed. `codeinfo_markdown/shared/review-wave-consumer-contract.md` treats missing, stale, failed, and invalid jobs as coverage failures rather than no findings and requires fresh identity after a retry. The same repository's `scripts/publish_open_code_review.py` precedent publishes canonical JSON beside Markdown and preserves partial outcomes instead of presenting them as clean completion; the healthy Story 64 proof fixture contains a completed fast wave with all expected jobs and `closeout_allowed: true`. The focused `review-artifacts` and `review-wave-validation` tests cover structured findings, stale/missing jobs, partial waves, and identity validation.

  External confirmation matches the local boundary. Context7's official Node.js documentation says `execFile` invokes its callback when the child terminates and reports `AbortError` when an `AbortSignal` aborts it. The official Codex app-server README distinguishes progress (`turn/started`, `enteredReviewMode`) from terminal `exitedReviewMode` and `turn/completed`, with interrupted/failed terminal statuses; DeepWiki's `openai/codex` lifecycle summary gives the same rule. DeepWiki's `mco-org/mco` precedent separates machine-readable `findings.json`/`run.json` from human-readable Markdown and uses terminal state plus provider-result validity for closeability. Targeted issue research confirms the exact automation hazards: Codex issue [#14335](https://github.com/openai/codex/issues/14335) documents timeout-without-verdict ambiguity, and [#20919](https://github.com/openai/codex/issues/20919) documents non-TTY stdin hangs; the local closed-stdin runner already addresses the latter. References: [Node child_process](https://nodejs.org/api/child_process.html) and [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

  The supported solution is to preserve this incomplete wave as evidence, abandon the stale/non-terminal attempt, prepare a fresh immutable target snapshot and new wave/review-set identity at the current HEAD/base, run the supported fast/slow reviewer publication path, and wait for terminal reviewer outcomes. Only then should the producer publish the validated findings inline or through a sibling JSON `findings_file` while retaining Markdown, after which wave validation must verify exact identity and server-owned sources before Subtask 5 reconciles the 15 findings and disposition. Longer waits, same-wave retries, treating HTTP 202 or silence as completion, downstream Markdown parsing, fabricated JSON, stale identity reuse, resume-path changes, or broad wrapper reruns are rejected because they bypass terminal, coverage, or provenance contracts. No prerequisite or plan repair is indicated; the blocker remains until terminal, identity-matching, structured artifacts exist.
- Planner plan-impact review rehydrated the latest blocker answer and story scope: the proof/test-harness seam remains owned by Task 28 Subtask 5, whose existing checklist already gives the fresh-wave regeneration and reconciliation work a bounded owner and stopping condition. No prerequisite, task split, renumbering, runtime-handoff repair, or testing-gate change is required. The active blocker marker was retired as resolved context so the supported same-task execution can continue; Subtask 5 and the remaining automated checks stay open, and Task 28 remains `__in_progress__`.
- **RESOLVED ISSUE** The persisted-conversation handoff is valid. Main Mongo contains root `c8198aae-61b2-488a-8792-8868a329b7c0` for `review_artifacts_main` with saved `flags.flow.stepPath: [6]`; posting that exact flow with `resumeStepPath: [6]`, its source ID, and `/data` returned the same conversation ID. That flow has steps `0` through `6`, so the saved final-step path has no remaining work; a new `two_phase_review_cycle` intentionally receives a fresh conversation rather than resuming this completed root. No runtime or product-source repair is needed.
- **RESOLVED ISSUE** Subtask 5 was blocked only on terminal external reviewer output. Fresh wave `0000064-rw-20260716T180451Z-4749ed1a` remained `preparing` with `completed_jobs: 0`, `failed_jobs: 0`, `missing_jobs: 3`, no findings, and no current-wave validation artifact. The existing producer and the verified resume contract could not create provider results; fabricating findings or accepting partial coverage would violate the task contract. The blocking research now provides the supported fresh-wave, terminal, identity-matching structured-artifact path owned by Task 28 Subtask 5.
- Implementation-only audit of commit `9a6756cb` found a plan-only change recording the fresh supported-stack attempt; no product or review-flow source files changed, and no story-caused preserved-behavior regression or unapproved user-facing drift was introduced. The successful stack startup/health check and shutdown correspond to already checked lifecycle items, while the new attempt produced no terminal reviewer artifact and therefore completed no additional subtask or `Testing` item. Subtask 5 remains genuinely open, and the live blocker is local to its bounded persisted-conversation/reviewer-artifact seam; Task 28 remains `__in_progress__` and is not ready for automated proof.
- **BLOCKING ANSWER** Fresh evidence confirms the live blocker is a proof/test-harness seam owned by Task 28 Subtask 5. The current `0000064-rw-20260716T180451Z-4749ed1a` pointer is `preparing` with no findings or findings file, and its matching prepared review set expects three jobs with `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`; the older stable validation artifact is a different wave and cannot certify this attempt. Repository precedents prove the intended boundary: `reviewArtifacts.ts` accepts only inline structured findings or a JSON `findings_file`, `reviewSet.ts` records missing expected jobs, `reviewWaveValidation.ts` requires exact identity and all expected terminal jobs before closeout, the focused artifact/validation tests cover partial and stale coverage, and `publish_open_code_review.py` keeps canonical JSON findings beside human-readable Markdown while preserving partial outcomes. External confirmation agrees: the official [Node child_process contract](https://nodejs.org/api/child_process.html) completes `execFile` only when the child terminates, the [Codex app-server lifecycle](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) separates progress from terminal review events, and Codex issues [#14335](https://github.com/openai/codex/issues/14335) and [#20919](https://github.com/openai/codex/issues/20919) document timeout-without-verdict and non-TTY stdin hazards; the local runner already closes stdin. The supported solution is to preserve this incomplete attempt, create a fresh immutable target/wave/review-set identity, run the supported reviewers to terminal outcomes, publish the validated findings inline or through a JSON `findings_file` while retaining Markdown, then validate identity and reconcile the 15 findings. Longer waits, same-wave retries, HTTP-202 or silence as success, Markdown parsing, fabricated findings, stale identity reuse, resume-path changes, and broad wrapper retries are rejected because they bypass terminal, coverage, or provenance contracts. The persisted conversation handoff is not the owner of this blocker: exact root `c8198aae-61b2-488a-8792-8868a329b7c0` plus `resumeStepPath: [6]` resolves correctly, and that completed flow intentionally yields a fresh conversation for a new review cycle; no prerequisite, baseline, runtime-handoff, product, or task-shape repair is indicated.

- **RESOLVED ISSUE** Subtask 5 was the first unchecked subtask after the current pointer and matching review-set artifact were re-read. The pointer remained `preparing` for wave `0000064-rw-20260716T180451Z-4749ed1a` with no findings or evidence file, while the prepared set reported three missing jobs. The supported reviewer capability had not produced terminal, identity-matching structured findings, so reconciling the 15 findings would have required fabricated or stale evidence. The blocking research now provides the supported fresh-wave, terminal, identity-matching regeneration path, so no task split, reordering, re-ownership, or scope widening is required.
- **BLOCKING ANSWER** Fresh blocker-repair research confirms a proof/test-harness seam owned by Task 28 Subtask 5. Current artifacts show `0000064-current-review.json` is `preparing` for wave `0000064-rw-20260716T180451Z-4749ed1a` with no inline findings or `findings_file`, while the matching prepared fast review set expects three jobs and reports `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`; a validation artifact for another wave cannot certify this attempt. Repository precedents prove the supported boundary: `server/src/flows/codexReview.ts` closes child stdin and uses `execFile` timeout/abort handling, `service.ts` waits for child terminal statuses, `reviewArtifacts.ts` accepts only inline structured findings or a JSON `findings_file`, `reviewSet.ts` initializes missing coverage, and `reviewWaveValidation.ts` requires exact identity plus every expected job completed before closeout. The focused review-artifact and wave-validation tests prove JSON/inline findings, stale or missing coverage, partial waves, and closeout rejection; `scripts/publish_open_code_review.py` validates per-bundle JSON before publishing a canonical pointer beside Markdown. Context7's official Node contract says `execFile` callbacks run on child termination and aborts surface as `AbortError`; DeepWiki's Codex lifecycle separates progress from terminal review events, while its MCO precedent separates machine-readable findings/run metadata from Markdown and preserves partial terminal states. The official [Node child_process reference](https://nodejs.org/api/child_process.html), [Codex app-server lifecycle](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md), [Codex timeout-without-verdict issue #14335](https://github.com/openai/codex/issues/14335), and [Codex non-TTY stdin issue #20919](https://github.com/openai/codex/issues/20919) confirm the exact automation hazards; the local closed-stdin runner already addresses the latter. The chosen solution is to preserve this incomplete attempt, create a fresh immutable target snapshot and wave/review-set identity, execute the supported reviewers to terminal outcomes, publish validated structured findings while retaining Markdown, then validate identity and reconcile the 15 findings; partial evidence must remain non-closeable. Longer waits, same-wave retries, HTTP-202 or silence as success, Markdown parsing, fabricated findings, stale identity reuse, resume-path changes, and broad wrapper retries are rejected because they bypass terminal, coverage, or provenance contracts. The persisted conversation handoff is already proven valid, so no prerequisite baseline, shared wrapper, runtime-handoff, product, or task-shape repair is indicated; Task 28 remains the owner until terminal identity-matching artifacts exist.
- Planner plan-impact review retires the duplicate current-wave blocker notes as `**RESOLVED ISSUE**`: the proven solution is actionable on Task 28 Subtask 5, whose checklist already owns fresh-wave regeneration and reconciliation with a bounded stopping condition. No prerequisite, task split, renumbering, runtime-handoff repair, or story-scope change is needed. Task 28 remains `__in_progress__` with Subtask 5 and five automated testing items open for the normal implementation and proof path.

- **RESOLVED ISSUE** Subtask 5 remained the first unchecked subtask after the supported fresh-wave attempt. I ran `npm run compose:up`, verified server health and Mongo connectivity, invoked `two_phase_review_cycle` with the persisted Story 64 source, and waited through six bounded polls; fresh wave `0000064-rw-20260716T190849Z-20d6c99c` remained `preparing`, its review set remained `prepared` with `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`, and the current pointer had no findings or evidence file. I stopped the stack with `npm run compose:down`; authoritative terminal structured findings were still unavailable, so reconciling the 15 findings would have required fabricated or stale evidence. The blocker-repair answer proves the existing Task 28 Subtask 5 owner and fresh-wave stopping point are correct, so no split, reorder, re-ownership, or scope widening is required.
- Implementation-only audit of commit `30ee2f45` found a plan-only fresh supported-wave attempt: server health/Mongo connectivity and stack shutdown correspond to the already checked lifecycle items, while no terminal reviewer artifact or structured findings were produced. No subtask or `Testing` item was newly completed, no product or review-flow source changed, and no Story 64 preserved-behavior regression or unapproved user-facing drift was introduced. Subtask 5 remains genuinely open with the live reviewer-output blocker preserved; Task 28 remains `__in_progress__` and final automated proof is incomplete.
- **BLOCKING ANSWER** Fresh blocker research confirms the current wave is a proof/test-harness seam owned by Task 28 Subtask 5, not a product, shared-baseline, runtime-handoff, or task-shape defect. Current disk artifacts for wave `0000064-rw-20260716T190849Z-20d6c99c` show `0000064-current-review.json` still `preparing` with no `findings`/`findings_file`, and the matching review set is `prepared` with three expected jobs and coverage `completed_jobs: 0`, `failed_jobs: 0`, `missing_jobs: 3`; no identity-matching terminal validation artifact exists. Repository precedents establish the supported boundary: `server/src/flows/codexReview.ts` closes child stdin and publishes the completed pointer only after `execFile` returns, `server/src/flows/service.ts` reports completion only after that producer returns, `server/src/flows/reviewSet.ts` models all expected jobs as missing at preparation, `server/src/flows/reviewArtifacts.ts::readValidatedFindings()` accepts only inline structured findings or a repository-contained JSON `findings_file` (the fallback Markdown is coverage context, not machine-readable findings), and `server/src/flows/reviewWaveValidation.ts` attaches server-owned source identity, preserves partial/missing/stale results, and allows closeout only when every expected job is `completed`. The focused review-set, review-artifact, and wave-validation tests prove those missing/partial/identity rules; the local Open Code Review publishing and merge guidance likewise preserves partial pointers, consumes only validated JSON bundle findings, and never merges partial coverage as clean completion. External confirmation matches: Context7's official Node documentation says `execFile`'s callback runs when the child terminates, aborts surface as `AbortError`, and a child waiting for input continues until stdin is closed; the official Codex app-server README separates progress (`turn/started`, `enteredReviewMode`) from terminal `exitedReviewMode` and `turn/completed` events; DeepWiki's `openai/codex` lifecycle and `mco-org/mco` precedent likewise require terminal provider state and separate machine-readable findings/run metadata from Markdown summaries. Targeted issue research in [Codex issue #14335](https://github.com/openai/codex/issues/14335) documents timeout-without-verdict ambiguity, while [Codex issue #20919](https://github.com/openai/codex/issues/20919) documents non-TTY stdin deadlocks; the local closed-stdin runner already addresses the latter. The chosen solution is to preserve this non-closeable wave as evidence, abandon it only through the supported flow, create a fresh immutable target snapshot and review-set/wave identity, run the supported reviewers until terminal success/failure/interruption is observable, publish validated findings inline or through a JSON `findings_file` while retaining Markdown, then rerun identity validation and reconcile the 15 findings and disposition. Longer waits, broad-wrapper retries, treating `preparing`/HTTP 202/silence as completion, parsing Markdown, fabricating JSON, reusing an older validation artifact, changing resume logic, or sharing another runtime's state are rejected because they bypass terminal, coverage, identity, or provenance contracts. The persisted conversation handoff is not the owner of this current blocker, and no prerequisite, task split, re-ownership, or story-scope change is indicated; Task 28 remains the bounded owner until terminal, identity-matching, structured artifacts exist.
- Planner plan-impact review rehydrated the latest blocker answer and story scope: the proof/test-harness seam remains owned by Task 28 Subtask 5, whose existing checklist already gives the fresh-wave regeneration and reconciliation work a bounded owner and stopping condition. No prerequisite, task split, renumbering, runtime-handoff repair, or story-scope change is required. The live blocker was converted to `**RESOLVED ISSUE**` so the supported same-task execution can continue; Task 28 remains `__in_progress__` with Subtask 5 and five automated testing items open.

- **RESOLVED ISSUE** Subtask 5 remains the first unchecked subtask after another supported fresh-wave attempt. I ran `npm run compose:up`, verified the supported server/Mongo health, invoked `two_phase_review_cycle` with the persisted Story 64 source, and waited through six bounded polls; fresh wave `0000064-rw-20260716T194026Z-73fc624a` remained `preparing`, its review set remained `prepared` with `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`, and the current pointer had no findings or evidence file. I stopped the stack with `npm run compose:down`; terminal identity-matching structured findings remain unavailable, so reconciling the 15 findings would require fabricated or stale evidence. Keep Task 28 `__in_progress__`; do not split, reorder, re-own, or widen the task before a supported reviewer run publishes terminal artifacts.
- Implementation-only audit of commit `f8abd447` found a plan-only fresh supported-wave attempt: the commit records supported server/Mongo health and matching stack shutdown, but no terminal reviewer artifacts or structured findings. No subtask or `Testing` item was newly completed, no product or review-flow source changed, and no Story 64 preserved-behavior regression or unapproved user-facing drift was introduced. The new live blocker is preserved for the exact unchecked Subtask 5 and its terminal-artifact boundary; Task 28 remains `__in_progress__` and automated proof is still incomplete.
- **BLOCKING ANSWER** Fresh bounded research confirms wave `0000064-rw-20260716T194026Z-73fc624a` is a proof/test-harness seam owned by Task 28 Subtask 5. Current disk evidence is non-closeable: the pointer remains `preparing` with no findings or evidence file, the matching review set is `prepared` with three expected jobs and `completed_jobs: 0`, `failed_jobs: 0`, `missing_jobs: 3`, and no identity-matching terminal validation artifact exists. Repository precedents establish the fix boundary: `codexReview.ts` closes child stdin and publishes only after `execFile` returns, `reviewArtifacts.ts` accepts inline structured findings or a JSON `findings_file` but not Markdown, `reviewWaveValidation.ts` requires exact identity and all expected completed jobs before closeout, and the focused review-set/artifact/wave-validation tests cover missing, partial, stale, and provenance cases; the Open Code Review publisher similarly keeps canonical JSON beside human-readable Markdown and preserves partial outcomes. Context7's Node contract says `execFile` completes on child termination and aborts as `AbortError`; the official Codex app-server lifecycle separates progress from terminal review events; DeepWiki's Codex/MCO precedents likewise require terminal provider state and separate machine-readable findings from Markdown. Exact issue research confirms timeout-without-verdict ambiguity ([#14335](https://github.com/openai/codex/issues/14335)) and non-TTY stdin hangs ([#20919](https://github.com/openai/codex/issues/20919)); the local closed-stdin runner already addresses the latter. The chosen solution is to preserve this incomplete wave, create a fresh immutable target/review-set/wave identity, run supported reviewers until terminal success/failure/interruption, publish validated structured findings inline or through a JSON `findings_file` while retaining Markdown, then validate identity and reconcile the 15 findings. Longer waits, same-wave retries, `preparing`/HTTP-202/silence as success, Markdown parsing, fabricated JSON, stale identity reuse, resume-path changes, shared runtime state, and broad-wrapper retries are rejected because they bypass terminal, coverage, isolation, or provenance contracts. The persisted conversation handoff is already proven valid, so no prerequisite, baseline, runtime-handoff, product, task-shape, split, or re-ownership repair is indicated; the live blocker remains until terminal identity-matching structured artifacts exist.

- **RESOLVED ISSUE** Subtask 5 remains the first unchecked subtask after repeated supported fresh-wave attempts. The current pointer remains `preparing` for wave `0000064-rw-20260716T194026Z-73fc624a`, with no findings or evidence file; the matching review set remains `prepared` with `completed_jobs: 0`, `failed_jobs: 0`, and `missing_jobs: 3`. The supported stack, persisted source handoff, producer contract, and bounded reviewer flow have been exercised repeatedly, but no terminal identity-matching structured findings exist, so reconciling the 15 findings would require fabricated or stale evidence. Keep Task 28 `__in_progress__`; do not split, reorder, re-own, or widen the task—external reviewer execution must publish terminal artifacts before work can continue.
- **BLOCKING ANSWER** Fresh blocker-repair research confirms a proof/test-harness seam owned by Task 28 Subtask 5, not a product, shared-baseline, runtime-handoff, or task-shape defect. The current wave pointer is still `preparing` with no findings artifact and its matching prepared review set is `0/3` completed with `3` missing jobs. Repository evidence proves the intended boundary: `reviewSet.ts` initializes missing coverage, `reviewArtifacts.ts::readValidatedFindings()` accepts only inline findings or JSON, `reviewWaveValidation.ts` requires exact wave/target identity and every expected job completed before `closeout_allowed`, and focused wave/artifact/disposition tests preserve partial and stale coverage as non-clean; `scripts/publish_open_code_review.py` provides the same JSON-pointer/Markdown separation. The ingested `open-code-review-chergeuk` precedent separately models machine-readable `ValidationResult`/`ScanManifest` and JSON reports from Markdown rendering, and preserves partial scope and validation mismatches as invalid or partial rather than success. Context7's official Node contract confirms `execFile` completes its callback only on child termination, reports `AbortError` on cancellation, and can wait indefinitely when child stdin is not closed; the official Codex app-server lifecycle distinguishes `exitedReviewMode` from terminal `turn/completed`; exact issue research documents timeout-without-verdict ambiguity in [Codex #14335](https://github.com/openai/codex/issues/14335) and non-TTY stdin hangs in [Codex #20919](https://github.com/openai/codex/issues/20919), while the local runner already closes stdin. The chosen fix fits the local contracts: preserve this incomplete wave, create a fresh immutable target/review-set/wave identity, run supported reviewers until terminal success/failure/interruption, publish validated findings inline or through a JSON `findings_file` while retaining Markdown, then validate identity and reconcile the 15 findings. Longer waits, same-wave retries, treating `preparing`/HTTP 202/silence as completion, parsing Markdown, fabricating JSON, reusing stale artifacts, changing resume logic, sharing runtime state, or broad-wrapper retries are rejected because they bypass terminal, coverage, isolation, or provenance guarantees; no prerequisite or plan repair is indicated.

## Code Review Findings

- Review pass: `0000064-20260718T110435Z-667918bd32-4f07756e`
- Review cycle: `0000064-rc-20260715T234622Z-3ff7dd09`
- Comparison context: local `HEAD` `667918bd3279c9f47da1e9bcbbc19c26fb560703` versus resolved base `origin/main@00ced5bb15524d12395dfc5c0d427b3c65eb7f97` from the stored review handoff, with comparison rule `local_head_vs_resolved_base`, resolved base source `remote`, and remote fetch status `success`.
- Wave coverage and target ownership: slow wave `0000064-rw-20260718T110435Z-126b394e` completed its one expected `current_repository` target job with usable server-owned validation; no jobs failed, were missing, or were partial, cross-repository review was not required, and closeout was allowed. Every aggregated finding is owned by target `current_repository` at `/data/codeinfo2/codeInfo2`.
- Severity conflicts: the validated aggregate contains 13 findings and records zero severity conflicts; every finding has one validated `Main Review` source.
- Provenance note: the saturation and challenge passes added no actionable finding. The ignored list retains the six routed current-pass rejections plus 18 explicitly non-adopted current-pass risk or challenge candidates under their existing artifact references.

### Accepted

#### 1. Malformed saved resume input can bypass immutable-input validation

- Finding ID: `resume-input-silent-normalization-bypass`
- Found by: Main Review
- Description: Resume parsing can discard a malformed saved `flow.input` and then use newly requested input while retaining the saved input hash.
- Example: A persisted run with malformed input can restart with the request input even though its stored hash still represents the original immutable input.
- Why accepted: This is a current-story regression in the resume contract. The bounded parser and service seam can receive one inline repair attempt without redefining the contract.

#### 2. Review launch can mix one source catalog with another working folder

- Finding ID: `review-launch-source-working-folder-mismatch`
- Found by: Main Review
- Description: A review command can select flows from one source while running them against a different working folder.
- Example: `--working-folder A --source-id B` can load source B's review catalog while targeting repository A.
- Why accepted: The story introduced this launch path and requires a consistent source-to-repository binding. Restoring that established binding is bounded current-story work.

#### 3. Codex retry cleanup can delete a pointer it does not own

- Finding ID: `codex-pointer-unowned-preflight-deletion`
- Found by: Main Review
- Description: Retry cleanup can remove the stable Codex pointer before provider and model preflight proves that the retry owns the pointer.
- Example: An old retry can delete the current stable pointer and then skip because its provider or model is unavailable.
- Why accepted: Pointer ownership is part of the story's retry isolation contract. The cleanup helper or pointer seam can receive one bounded inline repair attempt.

#### 4. An older review wave can overwrite newer stable artifacts

- Finding ID: `stable-review-artifact-stale-writer-race`
- Found by: Main Review
- Description: An older wave can pass its currency check and later overwrite newer stable review-set, wave-validation, or target-validation artifacts.
- Example: A newer wave publishes its current artifacts after the older wave checks currency but before the older wave performs its final writes.
- Why accepted: The in-scope issue is limited to Story 64's stable review-set, wave-validation, and target-validation publication. It was initially task-required and is promoted for one honest inline attempt; the original coordination concern remains a constraint and does not permit a broader artifact-system refactor.

#### 5. Legacy saved input can override an explicit resume request without a hash

- Finding ID: `resume-input-stale-precedence-without-hash`
- Found by: Main Review
- Description: A legacy persisted input that has no hash can silently take precedence over explicit input supplied for a resumed run.
- Example: A caller supplies new resume input, but the service chooses the older saved input because there is no saved hash with which to detect the conflict.
- Why accepted: This violates the story's established input and hash precedence contract. The bounded resume seam can receive one inline repair attempt.

#### 6. A post-success crash can duplicate a parent review wave

- Finding ID: `retry-ownership-post-success-crash-window`
- Found by: Main Review
- Description: A crash after the parent flow succeeds but before durable completion ownership is recorded can let a retry launch the same parent wave again.
- Example: `runFlowUnlocked` completes, the process stops before writing the completion marker, and the next retry starts a duplicate parent review wave.
- Why accepted: The in-scope issue is the new review-cycle launcher and its `retryOwnershipId`, not a generalized retry redesign. It was initially task-required and is promoted for one honest inline attempt while that original durability constraint remains binding.

#### 7. Fixed-delay negative subflow proof is scheduler-dependent

- Finding ID: `fixed-delay-negative-subflow-proof`
- Found by: Main Review
- Description: A negative subflow test relies on a fixed 40 ms delay rather than an observable synchronization point.
- Example: A slow scheduler can make the assertion run before the intended parent-terminal condition has actually been demonstrated.
- Why accepted: This is a localized proof gap in story-owned tests. Replacing the delay with a deterministic latch and explicit compatibility or parent-terminal proof is bounded inline work.

### Ignored for This Story

#### 8. Review polling interval has no upper bound

- Finding ID or Review reference: `review-poll-interval-unbounded`
- Found by: Main Review
- Description: The review CLI accepts arbitrarily large polling intervals.
- Example: A very large interval can make status updates and cancellation observation appear stalled.
- Why ignored: Rejection gate 8 applies: this is general CLI-duration hardening rather than a Story 64 requirement. It is ignored for this story and may be captured as separate follow-up work.

#### 9. Blank review summary base URL has no explicit policy

- Finding ID or Review reference: `review-summary-empty-base-url`
- Found by: Main Review
- Description: The wrapper does not define a new default-or-error policy for a blank summary base URL.
- Example: An empty configured base URL leaves generated review links without a newly selected fallback behavior.
- Why ignored: Rejection gate 7 applies: choosing a fallback or error would change visible wrapper behavior that this story did not approve. It is ignored for this story and may be captured separately if a product decision is made.

#### 10. Codex validation warnings are not surfaced by the adapter

- Finding ID or Review reference: `codex-agent-warning-dropped`
- Found by: Main Review
- Description: The Codex adapter does not expose every validation warning to callers.
- Example: A non-fatal agent validation warning can remain available in lower-level validation data without appearing in the adapter response.
- Why ignored: Rejection gate 5 applies: this is a pre-existing optional proof gap, and the review did not reproduce a current-story failure. It is ignored for this story only.

#### 11. Flow-step validation does not surface every warning

- Finding ID or Review reference: `validation-warnings-dropped-at-flow-step`
- Found by: Main Review
- Description: The flow step retains validation warnings in artifacts but does not add a new user-visible warning channel.
- Example: A warning can be preserved in validation output without being copied into the flow-step result.
- Why ignored: Rejection gates 5 and 7 apply: this is pre-existing behavior, and expanding the visible result contract was not approved. It is ignored for this story only.

#### 12. Startup reconciliation query is not bounded

- Finding ID or Review reference: `startup-reconciliation-unbounded-query`
- Found by: Main Review
- Description: Startup reconciliation can inspect all interrupted runs without new paging or readiness limits.
- Example: A very large backlog could make reconciliation take longer before normal startup work proceeds.
- Why ignored: Rejection gate 8 applies: backlog indexing, paging, and readiness hardening are outside the story's bounded recovery scenarios. It is ignored for this story and may be captured as separate follow-up work.

#### 13. OpenCode log-root construction repeats a path segment

- Finding ID or Review reference: `opencode-log-root-duplicated`
- Found by: Main Review
- Description: The OpenCode log-root path construction repeats a literal path segment even though the resulting paths currently agree.
- Example: The base and current-path literals both resolve to the same established mounted layout.
- Why ignored: Rejection gate 8 applies: this is a cleanup and portability preference with no proven current-head failure. It is ignored for this story only.

#### 14. Additional subflow-wave orchestration edge cases

- Finding ID or Review reference: `Rejected Risk Notes: runSubflowJobs / runSubflowWaveStep orchestration edge cases`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged duplicate admission, terminal waiting, cancellation, and stale ownership beyond the canonical findings.
- Example: No concrete example was recorded in the validated review evidence.
- Why ignored: Direct guards cover the challenged paths; provider silence remains a real scheduling state, and the distinct actionable ownership risks are already recorded above. No additional finding was adopted.

#### 15. Additional review-target and review-set preparation edge cases

- Finding ID or Review reference: `Rejected Risk Notes: prepareReviewTargets / prepareReviewSet edge cases`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged duplicate roots, invalid branches, partial preparation, and large target sets.
- Example: No concrete example was recorded in the validated review evidence.
- Why ignored: Existing guards and tests cover these cases, and the one distinct stable-publication race is already accepted. No separate current-story issue was adopted.

#### 16. Additional review-wave validation edge cases

- Finding ID or Review reference: `Rejected Risk Notes: validateReviewWave edge cases`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged missing, partial, stale, and malformed validation pointers beyond the canonical findings.
- Example: No concrete example was recorded in the validated review evidence.
- Why ignored: The validation gates and tests cover the challenged cases; the distinct stale-writer and warning observations are already represented by recorded decisions. No additional finding was adopted.

#### 17. Additional startup-reconciliation malformed and bulk cases

- Finding ID or Review reference: `Rejected Risk Notes: reconcileInterruptedFlowRunsForStartup edge cases`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged zero, malformed, high-volume, and recovery startup-reconciliation inputs.
- Example: A malformed interrupted-run record is skipped by the existing reconciliation guard.
- Why ignored: Malformed records already have a direct skip path, and the separate unbounded-query concern is already ignored above. No additional current-story issue was adopted.

#### 18. Mocked route and orchestrator seams

- Finding ID or Review reference: `Rejected Risk Notes: changed route/orchestrator tests and mocked seams`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged whether route tests mocked away status and stop behavior that should be proven in production.
- Example: The tests mock mapping seams while the production route still performs validation and delegation.
- Why ignored: The production route retains the relevant validation and delegation behavior, so the review did not establish a separate defect.

#### 19. Premature routing or provider fallback failure

- Finding ID or Review reference: `Rejected Risk Notes: routing-selection and early-failure paths`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged whether routing failures made later valid candidates unreachable.
- Example: A pinned provider branch intentionally does not cross-fallback to a different provider.
- Why ignored: The fallback paths were traced and later eligible candidates remain reachable; the pinned-provider behavior is intentional. No finding was adopted.

#### 20. Already-aborted helper side effects

- Finding ID or Review reference: `Rejected Risk Notes: already-aborted helper handling`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged whether helpers could perform side effects after receiving an already-aborted signal.
- Example: The reviewed helpers inspect the abort signal around their side-effect boundaries.
- Why ignored: The existing before-and-after signal checks address the challenged risk, so no separate defect was established.

#### 21. Missing additional repositories or retained design assets

- Finding ID or Review reference: `Rejected Risk Notes: additional repositories and design assets`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review checked whether the story omitted an additional repository or retained visual design asset.
- Example: The validated scope names no additional repository and the story retains no screenshots or other design artifacts.
- Why ignored: The absence matches the approved repository and artifact scope and does not establish an issue.

#### 22. Narrow consistency and portability observations

- Finding ID or Review reference: `Rejected Risk Notes: narrow consistency and portability checks`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review checked documentation links and cancellation-aware test doubles for a narrow consistency defect.
- Example: Reviewed documentation contains no absolute local link, and cancellation mocks observe abort signals.
- Why ignored: The challenged consistency and portability defects were not present, so no issue was adopted.

#### 23. Untrusted-boundary injection or path traversal

- Finding ID or Review reference: `Rejected Risk Notes: untrusted-boundary audit`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review audited command arguments, script restrictions, artifact containment, output allowlists, and working-folder validation.
- Example: External commands use argument arrays and artifact outputs are constrained to allowed paths.
- Why ignored: The audit did not establish injection or traversal; the distinct source-to-working-folder mismatch is already accepted above.

#### 24. Additional idempotency or replay defect

- Finding ID or Review reference: `Rejected Risk Notes: idempotency and replay pass`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged ordinary same-process replay and duplicate-execution guards beyond the canonical findings.
- Example: Same-process replay paths retain explicit ownership and completion checks.
- Why ignored: The distinct crash-window, stable-publication, and resume defects are already recorded above; no additional replay issue was adopted.

#### 25. Additional time-coordination defect

- Finding ID or Review reference: `Rejected Risk Notes: time-coordination audit`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review challenged polling and a short cancellation grace period as possible timing correctness dependencies.
- Example: The grace path rechecks cancellation and persisted state before making its decision.
- Why ignored: Polling is the authoritative boundary and the grace path rechecks state; the broader polling-domain concern is already ignored above. No extra finding was adopted.

#### 26. Additional changed-test weakness

- Finding ID or Review reference: `Rejected Risk Notes: changed-test audit`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review checked Cucumber step roles, cleanup, and abort-aware fakes for another false-positive proof path.
- Example: The reviewed fakes observe abort signals and the scenario cleanup is explicit.
- Why ignored: Those test paths remained honest; the distinct fixed-delay proof gap is already accepted above.

#### 27. UI affordance parity mismatch

- Finding ID or Review reference: `Rejected Risk Notes: UI affordance parity`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review checked whether new repository and flow chips disrupted existing row actions or selection behavior.
- Example: The chips are read-only while row actions and selection remain unchanged.
- Why ignored: The reviewed UI preserves the existing affordances, so no parity defect was established.

#### 28. Field-role or identity conflation

- Finding ID or Review reference: `Rejected Risk Notes: field-role stability`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review checked whether instance, target, and display identities were conflated.
- Example: `instanceId`, `targetId`, and display labels remain separate fields in the reviewed paths.
- Why ignored: The field roles remain distinct, and all concrete identity issues found by the pass are already represented above.

#### 29. Redundant bulk side effects

- Finding ID or Review reference: `Rejected Risk Notes: bulk side-effect cardinality`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-findings.md` — Rejected Risk Notes
- Description: The review checked whether bulk paths repeated side effects unnecessarily.
- Example: Per-target and per-job writes correspond to distinct target and job records, and their failures remain explicit.
- Why ignored: The observed cardinality is intentional and no redundant bulk side effect was established.

#### 30. Challenge pass found no dishonest step-role mutation

- Finding ID or Review reference: `Challenge pass 2: Step-role honesty`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-remaining-blind-spot-challenge.md` — Challenge pass 2
- Description: The challenge checked whether assertion steps secretly mutated scenario state.
- Example: `Then` steps assert only; state changes remain in `Given`, `When`, or cleanup hooks.
- Why ignored: The challenge found the step roles honest and did not adopt a finding.

#### 31. Challenge pass found no stale-hint precedence defect

- Finding ID or Review reference: `Challenge pass 7: Stale-hint precedence`
- Found by: `codeInfoTmp/reviews/0000064-20260718T110435Z-667918bd32-4f07756e-remaining-blind-spot-challenge.md` — Challenge pass 7
- Description: The challenge checked whether an older degraded or cancelled hint could override a fresher prepared comparison base.
- Example: The plan-host hint is used only as a fallback, and freshness checks reject mismatched identities.
- Why ignored: The challenge found the precedence and freshness checks safe and did not adopt a finding.
