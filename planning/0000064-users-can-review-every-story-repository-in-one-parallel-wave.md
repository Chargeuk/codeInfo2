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

#### Manual Testing Guidance

- The supported main-stack manual proof sequence covered one-target, three-target, cancellation, resume, artifact isolation, target drift, and cross-repository finding behavior; stop the stack afterward with `npm run compose:down` through the manual-testing flow. Do not treat this manual scenario as an automated Testing item.

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

#### Manual Testing Guidance

- The supported main-stack one-target manual proof checked durable plan decision recording; the manual-testing flow stopped the stack with `npm run compose:down` afterward. Do not treat this scenario as an automated Testing item.

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

#### Manual Testing Guidance

- The supported main-stack one-target and multi-target manual proof covered the combined fast/slow review cycle; the manual-testing flow stopped the stack with `npm run compose:down` afterward. Do not treat this scenario as an automated Testing item.

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
4. [x] Verify `origin/main` is an ancestor, the pushed feature branch matches local HEAD, and the worktree is clean.
5. [x] Run `npm run lint` and fix any errors.

#### Manual Testing Guidance

- When provider authentication permitted it, the supported-stack OpenCode wave-target proof was run and the stack was stopped with `npm run compose:down` through the manual-testing flow. Authentication-dependent proof may be documented as skipped under repository guidance; do not treat it as an automated Testing item.

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
5. [x] Verify `origin/main` ancestry, pushed local/remote equality, and a clean worktree.

#### Manual Testing Guidance

- When provider authentication permitted it, the supported-stack plan-host and additional-repository publication proof was run and the stack was stopped with `npm run compose:down` through the manual-testing flow. Authentication-dependent proof may be documented as skipped under repository guidance; do not treat it as an automated Testing item.

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
6. [x] Verify ancestry, pushed equality, and a clean worktree.

#### Manual Testing Guidance

- When provider authentication permitted it, the supported main-stack multi-repository fail-forward proof was run through the manual-testing flow. Authentication-dependent proof may be documented as skipped under repository guidance; do not treat it as an automated Testing item.

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
4. [x] Run `npm run compose:down` after the automated suite while leaving every local development-stack container untouched.
5. [x] Run `npm run lint`.
6. [x] Run `npm run format:check`.

#### Manual Testing Guidance

- The supported main-stack manual proof covered multi-review `Found by` rendering, fast-loop and slow-loop audit tasks, grouped task-up escalation, cancellation, resume, and duplicate suppression unless repository-owned authentication guidance permitted a documented skip. This scenario remained separate from automated Testing.

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

- Task Status: `__done__`
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
13. [x] Make final story review lifecycle-safe: reject final review before story implementation and mandatory proof are complete, make every fresh two-phase cycle initialize execution-owned state while resumes preserve it, prevent non-fast or skipped disposition state from claiming fast convergence, retain every deferred reviewer candidate in explicit routing state, preserve normal fifth-pass completion without a sixth iteration, and add plan-contract plus end-to-end regression coverage for these invariants.

#### Testing

Final-task repair scope: the whole approved story is in scope for failures found by these checks. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected check. Do not reopen older tasks solely because their implementation is implicated.

1. [x] In `codeInfo2`, run `npm run build:summary:server`.
2. [x] In `codeInfo2`, run `npm run build:summary:client`.
3. [x] In `codeInfo2`, run `npm run compose:build:summary`.
4. [x] Start the supported main stack with `npm run compose:up`.
5. [x] Run focused loop, review-wrapper, run-admission, cancellation, artifact-promotion, disposition-state, and restart-reconciliation tests covering early exit, fifth-iteration normal exit, impossible sixth iteration, duplicate attachment, superseded publication, and best-effort continuation.
6. [x] Run the full parallel automated suite with `npm run test:summary:all:parallel`, covering the client, server unit, server cucumber, and e2e suites.
7. [x] Stop the supported main stack with `npm run compose:down`.
8. [x] In `codeInfo2`, run `npm run lint`.
9. [x] In `codeInfo2`, run `npm run format:check`.

#### Manual Testing Guidance

- Use the supported main stack only through the repository wrappers: `npm run compose:up` after the supported build and `npm run compose:down` afterward. The wrapper-managed main compose contract uses `server/.env`, `server/.env.local`, `client/.env`, and `client/.env.local`, exposes the client at `http://localhost:5001` and server health at `http://localhost:5010/health`, mounts `manual_testing/codeinfo_agents` at `/app/codeinfo_agents` and `manual_testing/codex_agents` at `/app/codex_agents`, seeds Copilot from `/seed/copilot`, and exposes the host working-folder namespace at `/data`; wait for the server and client health checks before interaction. Confirm the review catalog loads, one-target and three-target waves preserve target and wave identity, cancellation/resume does not duplicate child work, target artifacts remain isolated, cross-repository finding behavior remains covered, and the plan does not claim clean closeout while the blocker is unresolved.
- Visual revalidation seam: on `Flows`, inspect the persisted one-target and three-target Story 64 review entries at desktop (`1440x960`) and mobile (`390x844`). In `client/src/components/chat/ConversationList.tsx`, verify every review row has a separate `conversation-run-chip` and `conversation-wave-target-chip`: root rows must use `flags.flow.input.target.target_id`, while child rows retain `flags.flowChild.targetId`. The target must not appear only inside `conversation-title`, where the rail/drawer line clamp clips `data-codeinfo2-codeInfoTmp-story64-main-proof-three-additional-1` and `-2`. On mobile, open the collapsed conversations drawer and verify that the target chip itself—not a tooltip or the clipped title—shows the differentiating suffix for both long target values (`additional-1` and `additional-2`); shared-prefix ellipsis that makes those two rows visually identical is a failure. Then confirm the selected transcript's target-validation and review-step status remain readable above the fixed composer in `client/src/pages/FlowsPage.tsx`. Treat missing, swapped, duplicated, or clipped target/run identity, or an off-screen/overlapping composer control, as a Story 64 repair signal; do not start a new flow, edit a persisted title, or absorb unrelated Chat or Agents layout work.
- If browser screenshots are needed, capture each screenshot first to a relative path such as `/tmp/playwright-output/<relative-path>` inside the local Playwright MCP runtime; on the host this normally appears as `$CODEINFO_ROOT/playwright-output-local/<relative-path>`. Treat that host-visible location as staging, keep the screenshot-producing runtime distinct from the app-under-test runtime when they differ, then transfer the file to `codeInfoTmp/manual-testing/0000064/28/` for non-committed task proof. Inspect runtime handoff JSON by meaning for artifact source, fallback runtime, and destination rather than relying on exact property names. The latest final-task screenshots are the primary durable proof for visual surfaces this task re-covers; retain earlier screenshots only when uniquely necessary, and record any transfer limitation honestly instead of halting the proof loop.
- Confirm the completed repair path does not duplicate final tasks or alter the approved Story 64 interaction contract. If provider authentication requires human-controlled two-factor authentication, follow repository guidance and document the allowed skip without attempting re-authentication.

#### Implementation Notes

- Testing item 4 complete: after the user released the prior runtime, `npm run compose:build` rebuilt the checked-in main server and client images and `npm run compose:up` passed its fixed-port preflight. Mongo and the server reached healthy state and the client started without touching the separately running `codeinfo2:local` containers.
- Testing item 4 live lifecycle audit exposed and repaired a terminal-status projection gap: the incomplete-story gate correctly exited in about two seconds and persisted `not_applicable`, but `GET /flows/runs/:conversationId` omitted that field so the wrapper labeled the skip as generic success. After the API projection fix and image rebuild, the same live command reported `terminal_outcome: not_applicable` and `reason: terminal_review_skipped`, proving the flow exited normally without entering a review wave.
- Testing item 5 complete: `npm run compose:down` stopped and removed only the checked-in main-stack containers and network after both live proof passes. The separately named `codeinfo2-*-local` containers were not targeted and remained running.
- Post-repair automated proof complete: the full untargeted `npm run test:summary:server:unit` wrapper passed 2647/2647 after the terminal-outcome status projection change.
- Testing item 9 complete: `npm run test:summary:all:parallel` passed with client 900/900, server unit 2647/2647, server Cucumber 138/138, and e2e 77/77. Shared server/client and main/e2e Compose builds also passed; the client retained its known non-blocking 1.73 MB chunk-size warning.

- Subtask 13 complete: added a native `initializeReviewCycle` step and active-cycle marker/archive, made `two_phase_review_cycle` final-only with a normal incomplete-story skip, added an isolated `diagnostic_review_cycle`, propagated cycle identity through targets/sets/validation, made the fast gate reject non-fast, mismatched, unrecorded, or deferred-candidate state, published Codex and Open Code findings as structured candidates, and added the unfinished-task final-review contract checker.
- Subtask 13 ownership audit complete: removed the redundant LLM reset from all three implementation-flow callers so the two-phase subflow has one native lifecycle owner; standalone disposition-only flows retain their scoped legacy reset. Added server-side filtering and regression proof so structured Open Code findings from unusable bundles cannot enter disposition.
- Testing item 6 complete: `npm run lint` passed after correcting the existing import-order warning in the Story 64 subflow integration proof.
- Testing item 7 complete: `npm run format:check` passed after formatting the changed wrapper, lifecycle, prompt, flow, and test files.
- Testing item 8 complete: focused lifecycle, Codex, flow-schema, review-target, review-set, review-wave, wrapper, plan-contract, disposition, prompt-contract, run-admission/restart, and subflow/cancellation suites passed. The broader flow integration results were 28/28 for `flows.run.basic.test.ts` and 48/48 for `flows.run.subflow.test.ts`; the fast controller, wrapper, publisher, plan-contract, and prompt tests passed 83 Python tests plus 8 wrapper tests.

- Subtask 13 added from the user-directed review-loop investigation. The failed Story 64 run proved that an in-task wrapper launch bypassed the outer reset boundary, inherited a prior slow-phase disposition, skipped eight fast-review candidates, and then exited because the fast completion gate treated a non-fast phase as complete. The repair will keep final review distinct from diagnostic review and preserve best-effort continuation without allowing skipped work to masquerade as convergence.

- Subtask 12 complete: repaired stable publication guards, retry completion ordering, resume-input trust and normalization, launch source identity validation, Codex pointer ownership, and fixed-delay subflow proof; focused review-set, wave-validation, wrapper, resume-identity, retry, and subflow suites passed.

- Implementation-only audit of commit `1a6ef589` confirms the seven repairs are present in the cited review publication, retry/resume, launch identity, Codex pointer, and deterministic subflow-proof seams, with focused regression coverage changed alongside them. No `Subtasks` or `Testing` items were newly marked complete during this audit: Subtask 12 was already honestly checked by the implementation pass, while all nine broader automated-proof items remain open. The changed files preserve the approved Story 64 review and identity contracts; no story-caused preserved-behavior regression or unrelated user-facing drift was found under the story behavior lock. Task 28 remains `__in_progress__`, has no live blocker, and is ready for the separate automated-proof pass.

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

- Automated proof: `npm run build:summary:server` passed with zero warnings on 2026-07-18; the clean-success wrapper summary required no log inspection.
- Automated proof: `npm run build:summary:client` passed on 2026-07-18; the wrapper reported one non-blocking Rollup chunk-size warning (the diagnostic log confirms the build completed successfully).
- Automated proof: `npm run compose:build:summary` passed on 2026-07-18; both compose image builds passed with zero failures and the wrapper reported clean success.
- **BLOCKING ANSWER** Fresh blocker-repair research proves this is a manual/runtime environment seam owned by Task 28's automated-proof closeout, with the external runtime release—not product code, a shared baseline, the test harness, or task shape—as the missing prerequisite. Repository evidence is explicit: `scripts/docker-compose-with-env.sh` computes the fixed main-stack ports `5010`, `5011`, `5012`, and `8932` and fails its supported preflight when any required host port is occupied; `docker-compose.yml` binds the main server and Playwright services to that contract and health-checks `http://localhost:5010/health`; the read-only checks found `codeinfo2-server-1` and `codeinfo2-server-local` running on host networking, `5010` healthy with Mongo connected, and all four required ports occupied. The repository's wrapper-first guidance and prior Story 55/59 planning precedents require preserving an active runtime and only restarting the checked-in main stack after a safe handoff, then re-proving it.

  External confirmation agrees. The official [Docker port-allocation troubleshooting guidance](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/topics/) identifies `port is already allocated`/`bind: address is already in use` as a listener conflict and limits the remedy to identifying the owner and safely stopping it or choosing another application port. Official [Compose `ps` documentation](https://docs.docker.com/reference/cli/docker/compose/ps/) supports inspecting current container status and exposed ports, while [Compose `up`](https://docs.docker.com/reference/cli/docker/compose/up/) documents that existing services may be stopped and recreated when configuration changes and that `--no-recreate` only prevents that recreation. Official [Compose `run` documentation](https://docs.docker.com/reference/cli/docker/compose/run/) confirms that `run` avoids service ports by default and only publishes them with `--service-ports` or explicit mappings; that one-off behavior cannot prove this story's supported host-networked main stack. DeepWiki's Docker Compose review likewise confirms that Compose converges existing services and that collision avoidance is not a substitute for the required `up` lifecycle; Context7 resolved `/docker/compose` and surfaced the same official `ps`, `up`, and `run` contracts. Exact issue research therefore proves the proper resolution is to preserve the current runtime, wait for an explicitly safe external release of ports `5010`, `5011`, `5012`, and `8932`, rerun the supported `npm run compose:up`, verify health and container state, and continue Testing items 4–9; the existing lifecycle item may then stop only the supported main stack and leave the local runtime untouched.

  The rejected alternatives are not valid proof: changing application ports changes the story's supported surface; stopping `codeinfo2-*` containers risks terminating the active agent/runtime session; `CODEINFO_*` port-check bypasses suppress the repository's safety contract; `docker compose run` changes the service lifecycle and port behavior; `--no-recreate` is a Compose lifecycle option, not a way to make occupied host listeners available; and repeated broad-wrapper retries or longer waits cannot release a port held by a healthy active process. The blocker remains parser-visible because the external prerequisite and terminal proof run have not changed; this answer is a retry boundary, not blocker resolution.

- **RESOLVED ISSUE** The earlier Testing item 4 fixed-port blocker was cleared when the user stopped the prior CodeInfo instance. A fresh `npm run compose:build` and supported `npm run compose:up` then passed preflight on ports 5010, 5011, 5012, and 8932; the main Mongo and server became healthy and the client started while `codeinfo2:local` remained untouched.

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

### Task 29. Fix linting

- Task Status: `__done__`

#### Subtasks

Task to ONLY check the linting after some manual fixes

1. [x] In `codeInfo2`, run `npm run lint` and fix issues.

#### Testing

Testing step to ONLY check the linting after some manual fixes

1. [x] Run `npm run lint`.

#### Manual Testing Guidance

- No manual testing required or wanted for this task. it must stry minimal

#### Implementation Notes

- Subtask complete: ran `npm run lint`; ESLint passed with exit code 0 and no issues were reported, so no source changes were required.
- Audit complete: the implementation and automated lint proof are evidenced by the completed checklist and recorded successful run; no source changes or user-facing behavior drift were introduced, and no blocker remains.
- Manual testing assessed as not applicable: Task 29 only verifies static lint output and has no runnable, browser-visible, or network-visible behavior; as the final task, full-story manual proof remains not applicable for the same reason. No manual runtime was started.

## Code Review Findings

- Review pass: `0000064-20260719T100027Z-040c43d7f6-0e3d4ebc`
- Review cycle: `0000064-rc-20260719T100026Z-847d9186`
- Comparison context: local `HEAD` `040c43d7f650d74417699292f22830d73560f537` versus resolved base `origin/main@00ced5bb15524d12395dfc5c0d427b3c65eb7f97` from the stored review handoff, with comparison rule `local_head_vs_resolved_base`, resolved base source `remote`, and remote fetch status `success`.
- Wave coverage and ownership: fast wave `0000064-rw-20260719T100027Z-8573b46e` expected three jobs and completed all three with zero failed, missing, or invalid jobs. The sole prepared target and implementation owner is `current_repository` at `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2`; its cross-repository result is the validated singleton `not_applicable` outcome because the target count is one.
- Severity conflicts and provenance: the validated aggregate contains six findings and zero severity conflicts. The Codex Review and Open Code Review target-local validations match the exact story, session, pass, parent, wave, target, HEAD, and comparison-base identities. The main review was not requested in this validation phase, and the fallback findings artifact is the canonical merge target for the usable Codex and Open Code Review results; the referenced merge artifacts recorded no rejected or deferred current-pass candidates.

### Accepted

#### 1. Malformed cross-repository output can permit a clean multi-target closeout

- Finding ID: `f2dba913f06f2b7b54bdcc511b258d2f97410d0ca97426fcb9636a62e3941fbe`
- Found by: Codex Review
- Description: The validator can treat a cross-repository result as complete using only a few identity fields and `status: completed`, without checking the required schema, target coverage, relationships, or finding ownership.
- Example: An artifact can claim `completed` while omitting the inspected target set, allowing `closeout_allowed` to become true without proving multi-target coverage.
- Why accepted: Story 64 explicitly requires validated cross-repository coverage and prevents a clean multi-target closeout when that coverage is invalid.

#### 2. Partial or failed wave results are hidden from the canonical handoff

- Finding ID: `19c0ef365de42e2a27620308365de60dba67a22ae17c78e39b0782f38bc670ef`
- Found by: Codex Review
- Description: A partial wave can leave the stable review set at its earlier prepared state instead of publishing the finalized coverage and findings that validation produced.
- Example: If one child is partial, downstream disposition may see a prepared manifest and no matching finalized validation, so it cannot record the missing or invalid coverage honestly.
- Why accepted: Story 64 requires the canonical review-set manifest and coverage state to remain visible for every wave outcome.

#### 3. Restart recovery cannot resume interrupted wave children

- Finding ID: `b92320f553ab7922313614cb9c0c1753b08e92761bde701f886c19de9d9cc11a`
- Found by: Codex Review
- Description: After restart, interrupted children can retain remembered instance IDs that block relaunch, while earlier assistant activity can be mistaken for terminal completion.
- Example: A child interrupted before a terminal turn can be marked failed but still be skipped on resume because its old instance ID remains registered.
- Why accepted: Story 64 explicitly requires cancellation and resume to reattach active wave children without skipping interrupted review work or launching duplicates.

#### 4. Publish finalized partial waves to the stable review-set artifacts

- Finding ID: `65d50c0e704e6567f021c9a1a08a0c831b17e6469a311677e9252b0d6c247402`
- Found by: Open Code Review
- Description: Finalized review-set and validation artifacts are promoted only when closeout is allowed, so a partial wave can leave stale prepared artifacts in the stable locations.
- Example: A wave with a missing or failed child can have usable partial findings, but the stable paths still expose the earlier prepared manifest instead of that finalized partial result.
- Why accepted: Story 64 requires post-wave validation to preserve honest partial coverage and canonical artifact state even when closeout is not allowed.

#### 5. Do not run finalized review sets through the 64 KiB child-input limit

- Finding ID: `266a2007dfe8faf7f1864982cb056b28877da471218fcc240a3af25449237772`
- Found by: Open Code Review
- Description: The complete finalized review set is passed through a 64 KiB flow-input limit even though review outputs can legitimately be larger.
- Example: A valid wave with enough detailed findings can fail in `normalizeFlowInput` after validation has already produced its artifacts.
- Why accepted: Story 64 requires bounded child inputs while preserving complete validated review output, so finalized aggregate data must not be lost to the child-input ceiling.

#### 6. Reject manifests that silently omit committed diff paths

- Finding ID: `d5e614037a7d68afb59ddd0031c6305fa13d91106b1ae34dafaac9249534d8e2`
- Found by: Open Code Review
- Description: The publisher can report complete coverage from declared counts without proving that every committed path is represented or explicitly excluded.
- Example: The prepared diff contains 149 paths while the generated manifest accounts for 148 and omits `codeInfoStatus/flow-state/current-plan.json` from both reviewed and skipped paths.
- Why accepted: Story 64 explicitly requires target-local review coverage and canonical artifacts to account for the reviewed repository contents.

### Ignored for This Story

- None.

## Minor Review Fixes

- Review pass `0000064-20260719T100027Z-040c43d7f6-0e3d4ebc`; finding `d5e614037a7d68afb59ddd0031c6305fa13d91106b1ae34dafaac9249534d8e2`; repository `current_repository`; OpenCode manifests now reject bundle paths that do not exactly account for the prepared committed diff; changed files `scripts/publish_open_code_review.py`, `scripts/test/test_publish_open_code_review.py`; commit `7abf6fe296ac754a5ffec1d9cee291ab3a395baa`; targeted proof `python3 -m unittest scripts.test.test_publish_open_code_review` passed (14 focused publisher tests, including the committed-path omission regression); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T100027Z-040c43d7f6-0e3d4ebc`; finding `f2dba913f06f2b7b54bdcc511b258d2f97410d0ca97426fcb9636a62e3941fbe`; repository `current_repository`; malformed cross-repository output is now rejected before it can permit clean multi-target closeout; changed files `server/src/flows/reviewWaveValidation.ts`, `server/src/test/unit/review-wave-validation.test.ts`; commit `ccf250c18c6f9fa53158cf9a0983737c6768f6b6`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/review-wave-validation.test.ts` passed (all 9 focused review-wave validation tests); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T100027Z-040c43d7f6-0e3d4ebc`; finding `19c0ef365de42e2a27620308365de60dba67a22ae17c78e39b0782f38bc670ef`; repository `current_repository`; partial-wave handoffs are now published to stable review-set artifacts; changed files `server/src/flows/reviewWaveValidation.ts`, `server/src/test/unit/review-wave-validation.test.ts`; commit `c054336bd9ecfd8f9709ad40e4a2cf42e86b3aa7`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/review-wave-validation.test.ts` passed (all 9 focused review-wave validation tests, including canonical publication for a partial wave); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T100027Z-040c43d7f6-0e3d4ebc`; finding `b92320f553ab7922313614cb9c0c1753b08e92761bde701f886c19de9d9cc11a`; repository `current_repository`; interrupted wave children now resume without duplicate child conversations; changed files `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`; commit `13e8deff9b3a7cbc6500567ebcc4bf83a2b0c431`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts` passed (all 49 focused subflow integration tests, including restart recovery); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T100027Z-040c43d7f6-0e3d4ebc`; finding `65d50c0e704e6567f021c9a1a08a0c831b17e6469a311677e9252b0d6c247402`; repository `current_repository`; outcome `skipped` because stored state confirms partial-wave publication is already implemented and no tracked source change was needed; changed files `none`; commit `none`; stored targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/review-wave-validation.test.ts` passed (including the partial-and-stale canonical publication regression); stale finding removed from the minor queue without marking it resolved or creating a numbered task.
- Review pass `0000064-20260719T100027Z-040c43d7f6-0e3d4ebc`; finding `266a2007dfe8faf7f1864982cb056b28877da471218fcc240a3af25449237772`; repository `current_repository`; finalized review manifests remain artifact-backed instead of entering bounded flow state, and redundant raw finding detail is omitted from per-job validation metadata; changed files `server/src/flows/service.ts`, `server/src/flows/reviewWaveValidation.ts`, `server/src/test/integration/review-production-loop.test.ts`; commit `08891227e7442cbe91093e2644b9a723417139c0`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/review-production-loop.test.ts` passed (oversized finalized-manifest regression) and `npm run test:summary:server:unit -- --file server/src/test/unit/review-wave-validation.test.ts` passed (all 9 review-wave validation tests); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T212516Z-52af6cfac4-32769dc2`; finding `829f2dbe9adb33dd2a27976ed3965d3c5f9e1c2abac8309325a94bd1cb56bbbd`; repository `current_repository`; interrupted children with earlier completed steps are no longer classified as terminal while their persisted lifecycle remains running, orphaned, or explicitly interrupted; changed file `server/src/flows/service.ts`; commit `bbe5c3c85fcd68043eeac8a925ec57e4d4a43d0d`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts` passed (49 focused subflow integration tests passed); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T212516Z-52af6cfac4-32769dc2`; finding `63b72dde79951ac23ce584197326f258d12b7bada9aa81b53fff5f4b9f74594b`; repository `current_repository`; review initialization failures now fail the flow instead of silently skipping the review cycle; changed files `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`; commit `99bbf16308f271cfa77983e80d339fdd961bcae2`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name \"review initialization failures fail the flow instead of silently skipping the review cycle\"` passed (the focused regression test passed and records a failed marker); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T212516Z-52af6cfac4-32769dc2`; finding `1d7b6fd25a1781d1620eb1e549d1406520b5f31b1681e050be32b72b3ce35bc1`; repository `current_repository`; Open Code Review now uses the feature-side three-dot diff when base and head have diverged; changed files `scripts/publish_open_code_review.py`, `scripts/test/test_publish_open_code_review.py`; commit `e0b9fb999f3fd099e4076a3bb3adccd75c7828c6`; targeted proof `python3 -m unittest scripts/test/test_publish_open_code_review.py` passed (17 focused publisher tests, including the real-Git divergent-history regression); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T223932Z-95741e5d79-c6e7c46c`; finding `632874705e890b70ad33a672f3f588a9c65fe06eaba62b5ea3c49ac6cd699909`; repository `current_repository`; story-owned compose changes now restore the read-only `/app/codeinfo_markdown` bind mount required by packaged review flows; changed files `docker-compose.yml`, `server/src/test/unit/host-network-compose-contract.test.ts`; commit `7e7122f379ec79504c1329fd885216f3edeccdc5`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/host-network-compose-contract.test.ts` passed (7 focused compose contract tests, including the restored mount and source bind-mount count); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T223932Z-95741e5d79-c6e7c46c`; finding `f243a30a8eb7c868c137b9c0f30e0c358a01ecc64cb8cf99dd71e5bc9632dc7a`; repository `current_repository`; crash-window recovery now reattaches an already-launched wave child by execution and instance identity instead of launching a duplicate conversation; changed files `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`; commit `fd86090e12674a9ec5a54e2ccfa10f09d6e07c02`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name \"restart recovery reattaches a launched wave child when the parent crashed before persisting it\"` passed (focused crash-window recovery regression); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260719T223932Z-95741e5d79-c6e7c46c`; finding `c175ba2d0564cd6f46d156a35714f3ad84630b51ad481bb9ffe637f6e017911a`; repository `current_repository`; server readiness now follows startup reconciliation so resume traffic cannot arrive during the recovery gap; changed files `server/src/index.ts`, `server/src/test/unit/flows-startup-reconciliation.test.ts`; commit `e969b83ac1030bdbc5d471596ea1ba93cac2dca1`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/flows-startup-reconciliation.test.ts` passed (4 focused startup-reconciliation tests, including the listener-ordering regression guard); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-startup-pending-only-wave-not-selected`; repository `current_repository`; pending-only wave checkpoints are now included in startup reconciliation selection; changed files `server/src/flows/service.ts`, `server/src/test/unit/flows-startup-reconciliation.test.ts`; commit `d88842c280668914e6ddb08d565f22b51769ae2f`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/flows-startup-reconciliation.test.ts` passed (the focused wrapper built the server and passed all 5 startup-reconciliation tests, including the pending-only selector regression guard); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-malformed-wave-state-discarded`; repository `current_repository`; malformed persisted wave jobs are now rejected during resume normalization instead of being silently discarded; changed files `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`; commit `bdc0ed69ea78d32f212f3cb7db6a822e3c28160a`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name \"resume rejects malformed persisted wave progress instead of discarding its jobs\"; npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts` passed (the focused malformed-state regression passed, then the owning subflow integration file passed all 52 tests); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-resume-state-inputs-dropped`; repository `current_repository`; resume normalization now rejects malformed persisted child inputs and prior flow values at the existing recovery seam; changed files `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`; commit `46aad99366a860a865d64c95bdc7d4a733340027`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name \"resume rejects malformed persisted child inputs and prior flow values\"` passed (the focused regression passed after the server wrapper built the workspace and covers malformed persisted child input and prior flow values); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-wave-base-identity-not-checked`; repository `current_repository`; wave validation now enforces each target's pinned comparison base and rejects stale-base results; changed files `server/src/flows/reviewWaveValidation.ts`, `server/src/test/unit/review-wave-validation.test.ts`; commit `94fbd5990f0e7af2c6cf1236eda7909de15c43ec`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/review-wave-validation.test.ts` passed (the focused server-unit wrapper passed all 10 review-wave validation tests, including stale comparison-base rejection); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-implicit-source-fallback-cross-binds-working-folder`; repository `current_repository`; implicit review launch fallback now preserves the requested working-folder identity instead of binding a foreign flow source; changed files `scripts/review-cycle-summary.mjs`, `scripts/review-cycle-summary.test.mjs`; commit `c1022a7c2eaca9090dd42e7860dd2f5086d664d3`; targeted proof `node --test scripts/review-cycle-summary.test.mjs` passed (all 12 focused launcher tests, including the foreign singleton-source regression); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-cross-repository-stale-publication`; repository `current_repository`; singleton cross-repository not-applicable publication now revalidates the stable wave pointer before publishing; changed files `server/src/flows/crossRepositoryReview.ts`, `server/src/test/unit/cross-repository-review.test.ts`; commit `a2f248ee3f62aebfb4bc891e150c7e84c39a0aa4`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/cross-repository-review.test.ts` passed (the focused server-unit wrapper passed all 4 tests, including the stale singleton publication regression); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-cucumber-production-boundary-bypass`; repository `current_repository`; review-wave Cucumber closeout and downstream-tasking scenarios now consume finalized output from the production wave-validation boundary; changed files `server/src/test/features/review-wave.feature`, `server/src/test/steps/review-wave.steps.ts`; commit `25dfc207e08a5462fba81007d73be0a26b64ca26`; targeted proof `npm run test:summary:server:cucumber -- --feature src/test/features/review-wave.feature` passed (the focused server Cucumber wrapper built the server and passed all 9 review-wave scenarios); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-positional-second-pass-identity-proof`; repository `current_repository`; second-pass review-wave proof now compares complete child identity sets rather than matching jobs by position; changed file `server/src/test/steps/review-wave.steps.ts`; commit `d67fa565e476c0d95c2d2b14940db3080d8c6190`; targeted proof `npm run test:summary:server:cucumber -- --feature src/test/features/review-wave.feature` passed (the focused server Cucumber wrapper built the server and passed all 9 review-wave scenarios after asserting unique, disjoint (instanceId, inputHash) identity sets); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

- Review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`; finding `0000064-missing-three-target-proof`; repository `current_repository`; three-target production review-loop proof now verifies every target-local job and the cross-repository result complete before closeout; changed file `server/src/test/integration/review-production-loop.test.ts`; commit `afe2fb48e09a6333ebfe10ffff4bbe89175c5a7e`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/review-production-loop.test.ts` passed (the focused server-unit wrapper built the server and passed both production-loop integration tests, including the new three-target closeout case with nine target-local jobs and one completed cross-repository result); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

- Review pass `0000064-20260720T225340Z-94ba2b5d05-679531ae`; finding `2b9e2ecc862d6c13e4a7d977b455a6a23afdb3af182ff637a071b178c993bbe8`; repository `current_repository`; OpenCode publication now honors prepared review exclusions, accepting excluded committed paths and rejecting excluded manifest entries; changed files `scripts/publish_open_code_review.py`, `scripts/test/test_publish_open_code_review.py`; commit `b6076272e198b30bc2a1b24ae504baa87a42bd39`; targeted proof `python3 -m unittest scripts/test/test_publish_open_code_review.py` passed (19 focused publisher tests passed, including regression coverage for planning/** exclusions); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260720T225340Z-94ba2b5d05-679531ae`; finding `5603bf600021aca98871a81694cd179cf3be2b82faf0068a1b7b3bf3fb7d7c40`; repository `current_repository`; resumed cancelled waves now restart every stopped child in its existing conversation; changed files `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`; commit `3cecc416d089d7f42df21295162dfa054f4eae86`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name \"resuming a cancelled subflow wave restarts every stopped child in place\"` passed (the focused integration test verified all three stopped children completed after resume without duplicate conversations); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000064-20260720T225340Z-94ba2b5d05-679531ae`; finding `a5aee94e7e31e4d4999e85dea93176316a5647f82cf851b96677145b2c6e69d9`; repository `current_repository`; the standalone review wrapper now finalizes the final review cycle it initialized; changed files `server/src/flows/service.ts`, `server/src/test/integration/review-production-loop.test.ts`; commit `af5b23eba0fa77f6b1bc6f637ace78e033adf7ea`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/review-production-loop.test.ts` passed (the focused server integration wrapper passed both production-loop cases, including the new durable completed-cycle assertion); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

### Task 30. Record Minor Review Fixes From Pass 0000064-20260719T100027Z-040c43d7f6-0e3d4ebc

- Task Status: `__done__`

#### Overview

This completed audit records the terminal inline outcomes for this review pass.

Escalated review items requiring combined task-up:

- None.

#### Subtasks

1. [x] Fixed `19c0ef365de42e2a27620308365de60dba67a22ae17c78e39b0782f38bc670ef` — Partial or failed wave results are hidden from the canonical handoff (`current_repository`); modified `server/src/flows/reviewWaveValidation.ts`, `server/src/test/unit/review-wave-validation.test.ts`.
2. [x] Fixed `266a2007dfe8faf7f1864982cb056b28877da471218fcc240a3af25449237772` — Finalized review manifests remain in canonical artifacts instead of bounded flow state, and redundant raw finding detail is omitted from per-job validation metadata. (`current_repository`); modified `server/src/flows/reviewWaveValidation.ts`, `server/src/flows/service.ts`, `server/src/test/integration/review-production-loop.test.ts`.
3. [x] Fixed `b92320f553ab7922313614cb9c0c1753b08e92761bde701f886c19de9d9cc11a` — Restart recovery cannot resume interrupted wave children (`current_repository`); modified `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`.
4. [x] Fixed `d5e614037a7d68afb59ddd0031c6305fa13d91106b1ae34dafaac9249534d8e2` — Reject OpenCode manifests whose bundle paths do not exactly account for the prepared committed diff. (`current_repository`); modified `scripts/publish_open_code_review.py`, `scripts/test/test_publish_open_code_review.py`.
5. [x] Fixed `f2dba913f06f2b7b54bdcc511b258d2f97410d0ca97426fcb9636a62e3941fbe` — Malformed cross-repository output can permit a clean multi-target closeout (`current_repository`); modified `server/src/flows/reviewWaveValidation.ts`, `server/src/test/unit/review-wave-validation.test.ts`.

#### Testing

1. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts` in `current_repository` — passed. Focused server-unit wrapper passed all 49 subflow integration tests, including restart recovery without a duplicate child conversation.
2. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/review-production-loop.test.ts` in `current_repository` — passed. Focused production review-loop wrapper passed the oversized finalized-manifest regression.
3. [x] `npm run test:summary:server:unit -- --file server/src/test/unit/review-wave-validation.test.ts` in `current_repository` — passed. Focused server-unit wrapper passed all 9 review-wave validation tests.
4. [x] `python3 -m unittest scripts.test.test_publish_open_code_review` in `current_repository` — passed. 14 focused publisher tests passed, including the committed-path omission regression.

#### Implementation Notes

- Review Task Role: `minor_fix_loop_audit`
- Review Cycle Id: `0000064-rc-20260719T100026Z-847d9186`
- Review Pass Id: `0000064-20260719T100027Z-040c43d7f6-0e3d4ebc`
- Review Phase: `fast`
- This task is a completed historical audit and does not replace final story revalidation.

## Code Review Findings

- Review pass: `0000064-20260719T135300Z-05ceb47091-43e2cbc8`
- Review cycle: `0000064-rc-20260719T100026Z-847d9186`
- Comparison context: local `HEAD` `05ceb470914282402ab3e8f0f38650292e86b997` versus resolved base `origin/main@00ced5bb15524d12395dfc5c0d427b3c65eb7f97` from the stored review handoff, with comparison rule `local_head_vs_resolved_base`, resolved base source `remote`, remote `origin`, and remote fetch status `success`.
- Wave coverage and ownership: `current_repository` is the only stored target and implementation owner. The fast wave `0000064-rw-20260719T131929Z-3a41d405` is `completed_partial` with `closeout_allowed: false`; the slow wave `0000064-rw-20260719T135300Z-baa17781` is `invalid` with `closeout_allowed: false`. The current handoff is `partial`, its fallback findings artifact says the main review was unavailable, and no validated current-pass review source is available for routing.
- Confidence note: the disposition state has five `incomplete_review_blockers`, but its routed finding arrays and counts are zero while `needs_task_up_path` and `has_unresolved_task_required_findings` are true. This plan records the blocker bucket as incomplete review state only; it does not treat any fallback-artifact candidate as accepted or ignored.

### Accepted

- None.

### Ignored for This Story

- None.

### Task 31. Repair Lossless Review-Cycle Execution and Recover Flow F Findings

- Task Status: `__done__`
- Repository Name: `codeInfo2`
- Review Task Role: `review_finding_repair`
- Prerequisite: Tasks 1-30 remain historical story work; complete this bounded review-coverage repair before the fresh final revalidation task.
- Review Pass ID: `0000064-20260719T135300Z-05ceb47091-43e2cbc8`
- Review Cycle ID: `0000064-rc-20260719T100026Z-847d9186`

#### Overview

The stored Flow F outcome exposed loss of usable sibling findings, a non-terminal OpenCode pointer, an agent-owned slow-review pointer, incorrect fast-loop convergence, taskless clean settlement, mutable mixed-version runtime assets, and ordinary subflows orphaned by restart. Repair those contracts as one lossless review-cycle change: every provider and phase must publish an honest terminal result, versioned artifacts are authoritative, every candidate has one durable disposition, fast review repeats only after actual fix work and at most five times, slow review runs once, and every cycle creates exactly one final revalidation task. Recover the five usable fast findings and eleven slow findings from Flow F into explicit fixed, tasked, rejected, or deferred ownership without creating a second final task.

#### Non-Goals

- Do not implement the raw candidates mentioned by any fallback or challenge artifact; they have no validated current-pass routing identity.
- Do not change Story 64 user-facing behavior, the existing `subflow` contract, the review topology, or the single-repository scope.
- Do not reuse the failed fast or invalid slow wave identities, invent findings, or treat partial/invalid coverage as a clean result.

#### Addresses Findings

- `review-wave-identity-mismatch` -> produce or preserve a matching fast review-set and wave-validation pair for the exact story, phase, parent execution, target hash, HEAD, and comparison base.
- `missing-current-wave-coverage` -> obtain usable completed or partial target-local results plus the required singleton cross-repository result for the fast wave, or keep the missing coverage explicitly non-closeable.
- `current-slow-wave-identity-mismatch` -> produce a matching slow review-set and wave-validation pair for the exact current review session and pass.
- `missing-current-slow-wave-coverage` -> obtain the expected target-local slow result and aggregate its validated outcome, or keep the slow phase explicitly invalid/incomplete.
- `fast-review-coverage-exhausted` -> preserve the bounded exhaustion result and prevent the review loop from claiming convergence without the required terminal coverage.
- Current review pass `0000064-20260719T135300Z-05ceb47091-43e2cbc8` -> keep the one structured findings block above as the sole decision record; do not create a second findings summary.

#### Task Exit Criteria

- A fresh immutable target snapshot and fresh fast/slow wave identities use the stored Story 64 repository scope and current HEAD/base; older identities are not reused.
- The fast phase validates both target-local jobs and the singleton cross-repository result with server-owned usability and exact identity fields, while the slow phase validates its one target-local job with the same gates.
- If usable findings exist, only the matching server-owned aggregate and its complete source objects enter disposition; fallback Markdown and artifact-only candidates remain unrouted.
- If any expected job remains missing, failed, stale, or unusable, the plan and disposition state retain `closeout_allowed: false`, the relevant blocker, and an honest incomplete outcome rather than claiming no findings.
- The current review pass has exactly one structured `## Code Review Findings` block, and the next final task is the only final revalidation owner for this review cycle.

#### Risk Ownership

- Implementation owner: `codeInfo2` owns the target snapshot, review-set/wave validation, canonical artifact handoff, and disposition boundary.
- Scope boundary: this task repairs review evidence integrity and routing state only; it must not widen approved Story 64 behavior.

#### Owner Map

- `codeInfo2`: `server/src/flows/reviewSet.ts`, `server/src/flows/reviewWaveValidation.ts`, review pointer/validation producers and consumers, and the current review disposition handoff.

#### Requirement-To-Proof Mapping

- Fast coverage -> the review-set and wave-validation artifacts must enumerate the two target-local jobs and singleton cross-repository job, preserve usable results and sources, and reject clean closeout for missing or invalid cells.
- Slow coverage -> the final slow artifacts must enumerate the one heavyweight target-local job and reject closeout when its result is missing or invalid.
- Identity and provenance -> every consumed result must match story, phase, wave, pass/session, parent execution, target, HEAD, comparison base, and server-owned validation identity before aggregation.
- Disposition -> only validated server-owned findings are routed; incomplete coverage remains visible in state and in the single current-pass plan block.

#### Proof Mapping

- The five disposition blockers -> fresh matching fast/slow artifacts, server-owned per-job validation, and explicit non-closeable fallback state.
- Current review pass -> the exact findings block above, the matching disposition state, and Task 35's whole-story revalidation.

#### Affected Repositories

- `codeInfo2` only. `current-plan.json` declares no additional repositories, so no cross-target implementation owner or cross-repository proof task is required for this current finding.
- Affected proof surfaces are the server review-wave and artifact contracts, the review-cycle wrapper, canonical review artifacts, and the existing Story 64 plan/disposition state.

#### Documentation Locations

- Canonical review decisions: the single current-pass `## Code Review Findings` block in this plan.
- Review evidence and routing: `codeInfoTmp/reviews/0000064-current-review.json`, its fallback findings artifact, the referenced current-pass challenge/evidence artifacts, and `codeInfoStatus/flow-state/review-disposition-state.json`.

#### Subtasks

1. [x] Audit the failed Flow F artifacts and current source to map every observed failure to a deterministic regression test and implementation owner.
2. [x] Pin one immutable workflow-support/runtime version per running stack and remove the local mixed bind-mounted-assets versus baked-server contract.
3. [x] Make exact versioned review-set/validation artifacts authoritative, make OpenCode and slow review publish server-owned terminal outcomes, and keep fallback evidence separate from canonical pointers.
4. [x] Enforce candidate conservation across usable sibling results, fast and slow phases, minor-fix audits, task-up routing, and exactly one final revalidation task.
5. [x] Correct fast convergence so a provider failure does not discard usable sibling findings, reruns occur only after attempted fixes, clean convergence may exit before five, and the fifth pass uses the same terminal path.
6. [x] Recover ordinary subflows and pending-only waves after restart, persist truthful run lifecycle state, and retain stable target identities when target ordering changes.
7. [x] Reconcile all five usable fast findings and eleven slow findings from Flow F as fixed, covered by this repair task, explicitly rejected, or deferred with a durable reason; preserve Task 30 and Task 35 as the sole final owner.

#### Testing

1. [x] In `codeInfo2`, run `npm run build:summary:server` before the review-flow proof.
2. [x] In `codeInfo2`, run `npm run compose:build:summary`, then start the supported main stack with `npm run compose:up`.
3. [x] Run the focused publisher, fast-loop, wrapper, prompt-contract, slow-finalizer, restart, and lifecycle regression suites without starting a provider-dependent production review cycle.
4. [x] Run `npm run test:summary:server:unit -- --skip-build --file server/src/test/unit/review-wave-validation.test.ts --file server/src/test/unit/review-set.test.ts --file server/src/test/unit/review-target-contract.test.ts --file server/src/test/unit/review-artifacts.test.ts` to prove identity gates, coverage classification, source-preserving aggregation, and non-closeable incomplete results.
5. [x] Stop the supported main stack with `npm run compose:down` after the review-flow proof, without touching any `compose:local` services.
6. [x] Run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` and verify Task 30 plus Tasks 32-34 provide one audit per non-empty pass and Task 35 is the only final revalidation owner.

#### Manual Testing Guidance

- No separate browser proof is required for this review-evidence task. If the supported main stack is used, use only `npm run compose:up` and `npm run compose:down`, preserve any active local stack, and record an allowed authentication skip rather than attempting re-authentication when repository guidance requires human-controlled two-factor authentication.

#### Implementation Notes

- Created as the bounded incomplete-review follow-up for the five validated blockers in the current disposition state. The state reports task-up required while routed finding arrays remain empty; this task preserves that mismatch as incomplete review state instead of promoting fallback candidates.
- The task owns one repository only. No additional repository is in stored scope, so cross-target implementation proof is not required.
- Audited the exact Fast2, Fast3, and slow Flow F artifacts. They contain five usable Codex findings and eleven slow findings that were lost only at the mutable stable-pointer/disposition boundary; this repair uses those versioned artifacts as the recovery source.
- Removed workflow-support bind mounts from both Compose server definitions so scripts, Markdown, and flow definitions now share the baked server image revision. Provider catalogs remain the explicit editable surface.
- Added terminal OpenCode failure publication, tracked-but-ignored path accounting, server-owned slow finalization, non-destructive fallback evidence, versioned artifact consumption, and candidate-conservation rules.
- Updated fast convergence, exactly-one-final-task settlement, ordinary/pending restart recovery, persisted lifecycle status, per-target bases, stable target identities, diagnostics, and Flow F audit coverage.
- `npm run build:summary:server` passed twice. Focused Python tests passed 54/54, wrapper tests passed 11/11, and the focused server suites passed 117/117.
- The provider-dependent production cycle was deliberately not used as focused proof because the active plan still contains Tasks 31 and 35; final-review initialization correctly skips incomplete stories. Deterministic source-level and runtime integration regressions cover the repaired paths before final whole-story proof.
- Rebuilt and started the supported main stack from the immutable image, confirmed the client and server health endpoints and healthy Compose services, and stopped it cleanly without touching `compose:local`.
- The bounded review-tasking audit confirms Task 30 plus Tasks 32-34 retain one completed audit for every recovered non-empty Flow F pass and Task 35 is the sole final owner for the active review cycle.

### Task 32. Record Minor Review Fixes From Fast Pass 0000064-20260719T113948Z-05ceb47091-c546d0d5

- Task Status: `__done__`

#### Overview

This completed audit recovers the usable Codex findings that Flow F Fast2 produced even though OpenCode ended without a usable artifact. No finding is escalated: both are fixed by Task 31.

#### Subtasks

1. [x] Fixed `bd1d426c64707007ffc3dac9692132a7127d6252e919f8271cf5018d33e2d6e2` — Cross-repository coverage can be marked complete without evidence; modified `server/src/flows/reviewWaveValidation.ts` and its focused tests.
2. [x] Fixed `e294ef7e98329ae26b210cb57497cde94d7b051fc1361d4d6ccc09c0f5894579` — Re-running the summary command can reuse a completed review; modified `scripts/review-cycle-summary.mjs` and its tests.

#### Testing

1. [x] `npm run test:summary:server:unit -- --skip-build --file server/src/test/unit/review-wave-validation.test.ts` — passed as part of the 117-test focused server run.
2. [x] `node --test scripts/review-cycle-summary.test.mjs` — all 11 tests passed.

#### Implementation Notes

- Review Task Role: `minor_fix_loop_audit`
- Review Cycle Id: `0000064-rc-20260719T100026Z-847d9186`
- Review Pass Id: `0000064-20260719T113948Z-05ceb47091-c546d0d5`
- Review Phase: `fast`
- Recovered from the exact versioned Fast2 review-set rather than the stale stable pointer.

### Task 33. Record Minor Review Fixes From Fast Pass 0000064-20260719T121134Z-05ceb47091-bff35412

- Task Status: `__done__`

#### Overview

This completed audit recovers the three usable Codex findings that Flow F Fast3 produced while OpenCode failed. No finding is escalated: all three are fixed by Task 31.

#### Subtasks

1. [x] Fixed `d69999226d03aace244d0b280eef60778f3efb057721f2aca66f4858a0b3844d` — Review initialization fails open; unexpected initialization now leaves a terminal server-owned failure handoff while the best-effort flow exits explicitly.
2. [x] Fixed `e64dec55d41c151844924c2916423a90012d97561791f339acadba08c7a18840` — Additional repositories use the primary repository comparison base; each target now retains its declared `branched_from` value.
3. [x] Fixed `31923eca741335e3d219d28594a329f954863bfd79d1667c28b0001a999290aa` — A crash before the first child launch leaves a pending wave unreconciled; pending-only waves now enter restart reconciliation.

#### Testing

1. [x] `npm run build:summary:server` — passed.
2. [x] The focused 117-test server run passed, including startup reconciliation and subflow restart coverage.

#### Implementation Notes

- Review Task Role: `minor_fix_loop_audit`
- Review Cycle Id: `0000064-rc-20260719T100026Z-847d9186`
- Review Pass Id: `0000064-20260719T121134Z-05ceb47091-bff35412`
- Review Phase: `fast`
- Recovered from the exact versioned Fast3 review-set; the failed sibling provider did not invalidate these findings.

### Task 34. Record Review Fixes From Slow Pass 0000064-20260719T135300Z-05ceb47091-43e2cbc8

- Task Status: `__done__`

#### Overview

This completed audit recovers all eleven findings from the slow Flow F findings artifact. Every candidate is fixed by Task 31 and remains individually conserved below.

#### Subtasks

1. [x] Fixed `923dacb6bcde6bc1a398dbd40198ba16ed4dc3a2e870f264edfd9d8825913978` — validate cross-review inspected targets and finding target IDs against the pinned snapshot.
2. [x] Fixed `43daab9ea2d8584ea276bdc25ff43cb3ae315a413b07593404fb377a77c83f64` — versioned artifacts are authoritative and stable promotion is ownership guarded.
3. [x] Fixed `398cec2f2798bb2b6978a1b92e798f87602add2e472b468b6dbfd4e9a80e9995` — Codex provider readiness is checked before pointer cleanup and failure cannot delete sibling/newer evidence.
4. [x] Fixed `400efd37b1d4eeb57eefa8b3d9e32115cf7002b531c08257e760c3f61789f1a8` — HTTP readiness no longer waits for the full interrupted-flow reconciliation scan.
5. [x] Fixed `5319c420d3fa5bf06858757ae7c9a07e6790d25bde48db3e0a2ec5323811ca11` — blank base URLs use the documented default and non-HTTP URLs are rejected.
6. [x] Fixed `18a923e635b802288fc6e56d372088e688b2f13daa06992176bd95dba6556d03` — polling and stall durations are safe positive integers within the Node timer domain.
7. [x] Fixed `30b097360a6384e1b5d56307459e8fe2e44461fd537f1727befbec9d8176b823` — review-artifact warnings and aggregate errors appear in normal step diagnostics.
8. [x] Fixed `a2733d496db7ed0bd0f6f87045d74641723966899bea76a9dadf3bb70f9023ce` — wave validation reports every degraded job identity, status, and error.
9. [x] Fixed `ce63fd66774a9ddc83858850621ecb012b7929a2d1e723d9edbbca8d81529579` — unexpected Codex failures are explicit degraded-provider outcomes while best-effort sibling work continues.
10. [x] Fixed `f46de0b64e7f3854fce62afbb54e571a3c96d3464305042c3b974c025602f8ba` — Cucumber wording now proves expansion cardinality instead of falsely claiming scheduler overlap.
11. [x] Fixed `3f5246ae1a2fed0155ffbcb1d1f4b86281a9887a6016e95a708e256b822712b3` — matrix instance IDs use stable target identity rather than array position.

#### Testing

1. [x] Focused Python publisher and flow-control suites passed all 54 tests.
2. [x] Focused review-cycle wrapper tests passed all 11 tests.
3. [x] Focused server review/runtime/Compose contract suites passed all 117 tests.

#### Implementation Notes

- Review Task Role: `minor_fix_loop_audit`
- Review Cycle Id: `0000064-rc-20260719T100026Z-847d9186`
- Review Pass Id: `0000064-20260719T135300Z-05ceb47091-43e2cbc8`
- Review Phase: `slow`
- The slow artifact's agent-owned intermediate `findings` status is now accepted only by the server finalizer, which validates it before publishing `completed`.

### Task 35. Re-Validate Story 64 After Current Review Coverage Repair

- Task Status: `__done__`
- Repository Name: `codeInfo2`
- Review Task Role: `final_revalidation`
- Prerequisite: Task 31 is complete and its current-pass review artifacts and disposition state are durable before this task starts.
- Review Pass ID: `0000064-20260719T135300Z-05ceb47091-43e2cbc8`
- Review Cycle ID: `0000064-rc-20260719T100026Z-847d9186`

#### Overview

This is the sole final revalidation task for the active Story 64 review cycle. Revalidate the whole story, Task 31's repaired current-pass review outcome, the exact current-pass `Code Review Findings` block, and the five findings resolved inline during the same cycle: `d5e614037a7d68afb59ddd0031c6305fa13d91106b1ae34dafaac9249534d8e2`, `f2dba913f06f2b7b54bdcc511b258d2f97410d0ca97426fcb9636a62e3941fbe`, `19c0ef365de42e2a27620308365de60dba67a22ae17c78e39b0782f38bc670ef`, `b92320f553ab7922313614cb9c0c1753b08e92761bde701f886c19de9d9cc11a`, and `266a2007dfe8faf7f1864982cb056b28877da471218fcc240a3af25449237772`. Do not create another final task for the inline minor fixes, and do not close the story while the current review outcome is incomplete or any listed proof is stale.

#### Non-Goals

- Do not add product behavior, broaden Story 64, or turn the five resolved minor findings into new numbered tasks.
- Do not treat a successful build or test as permission to ignore invalid review coverage, missing provenance, or an incomplete current-pass outcome.

#### Addresses Findings

- Current pass `0000064-20260719T135300Z-05ceb47091-43e2cbc8` and blockers `review-wave-identity-mismatch`, `missing-current-wave-coverage`, `current-slow-wave-identity-mismatch`, `missing-current-slow-wave-coverage`, and `fast-review-coverage-exhausted` -> whole-story proof after Task 31.
- Resolved minor findings `d5e614037a7d68afb59ddd0031c6305fa13d91106b1ae34dafaac9249534d8e2`, `f2dba913f06f2b7b54bdcc511b258d2f97410d0ca97426fcb9636a62e3941fbe`, `19c0ef365de42e2a27620308365de60dba67a22ae17c78e39b0782f38bc670ef`, `b92320f553ab7922313614cb9c0c1753b08e92761bde701f886c19de9d9cc11a`, and `266a2007dfe8faf7f1864982cb056b28877da471218fcc240a3af25449237772` -> re-run their affected whole-story proof without creating duplicate tasks.

#### Task Exit Criteria

- Task 31 is complete, the current-pass findings block appears exactly once, and disposition state names this task as the only final revalidation owner for review cycle `0000064-rc-20260719T100026Z-847d9186`.
- The whole Story 64 implementation and all five inline-resolved minor repairs are covered by the full build, supported runtime lifecycle, all relevant full suites, lint, and formatting checks below.
- The final outcome is either a fully validated current review with honest routed findings or an explicitly incomplete non-closeable outcome; no clean closeout is claimed from missing or invalid coverage.

#### Risk Ownership

- Administrative owner: `codeInfo2` owns whole-story closeout proof and any practical story-caused repair found by these checks.
- This task may repair a story-caused failure exposed by final validation, but it must not widen approved behavior or reopen older tasks solely because their code is implicated.

#### Owner Map

- `codeInfo2`: server review-wave/runtime surfaces, client flow/sidebar surfaces, flow-control scripts, server Cucumber suite, client suite, Playwright e2e suite, and supported main Compose stack.

#### Requirement-To-Proof Mapping

- Story 64 acceptance criteria -> the full server/client/Compose builds, supported main-stack lifecycle, complete client/server/Cucumber/e2e suites, lint, and formatting below.
- Current review cycle and resolved minor findings -> Task 31's artifact/disposition outcome plus the same full proof after the latest repair.

#### Proof Mapping

- Task 31 -> current review identity, coverage, server-owned source validation, and non-closeable incomplete-state proof.
- Whole story -> full build, supported startup, all relevant full automated suites, matching shutdown, lint, and formatting.

#### Affected Repositories

- `codeInfo2` only. No additional repository is in the stored plan scope.
- Proof inventory: server workspace and review-flow artifacts, client workspace and flow/sidebar surfaces, flow-control scripts, server Cucumber suite, client suite, Playwright e2e suite, and the supported main Compose stack.

#### Documentation Locations

- Final review outcome: the current-pass `## Code Review Findings` block and `review-disposition-state.json`.
- Final proof: this task's checked Testing items and Implementation Notes.

#### Subtasks

Final-task repair scope: this task owns whole-story validation. If lint, formatting, or testing exposes a story-caused issue in code implemented by any earlier task, fix it within this final task when practical and rerun the affected checks. Do not reopen an older task solely to own that repair.

1. [x] In `codeInfo2`, run `npm run lint` and fix story-caused issues.
2. [x] In `codeInfo2`, run `npm run format:check` and fix story-caused issues.

#### Testing

Final-task repair scope: the whole approved story is in scope for failures found by these checks. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected check. Do not reopen older tasks solely because their implementation is implicated.

1. [x] In `codeInfo2`, run `npm run build:summary:server`.
2. [x] In `codeInfo2`, run `npm run build:summary:client`.
3. [x] In `codeInfo2`, run `npm run compose:build:summary`.
4. [x] Start the supported main stack with `npm run compose:up`.
5. [x] Run `npm run test:summary:all:parallel`, covering the full client suite, full server unit/integration suite, full server Cucumber suite, and full Playwright e2e suite.
6. [x] Stop the supported main stack with `npm run compose:down`.
7. [x] In `codeInfo2`, run `npm run lint`.
8. [x] In `codeInfo2`, run `npm run format:check`.

#### Manual Testing Guidance

- Use the supported main stack only through `npm run compose:up` and `npm run compose:down` after the supported builds. Recheck Story 64's one-target and three-target review identity, cancellation/resume behavior, target artifact isolation, cross-repository finding behavior, and the absence of duplicate final-task ownership. If provider authentication requires human-controlled two-factor authentication, document the allowed skip without attempting re-authentication.

#### Implementation Notes

- Created as the one fresh final revalidation owner for review cycle `0000064-rc-20260719T100026Z-847d9186`; it covers the whole story, Task 31, and all five inline-resolved minor findings.
- Final server, client, and Compose builds passed. The client build retained only the known Vite large-chunk warning; no build failed.
- The supported main stack started from the rebuilt immutable image, reported healthy client/server services and a healthy server `/health` response, and stopped cleanly without affecting `compose:local`.
- The final full parallel suite passed: client 900/900, server unit/integration 2651/2651, server Cucumber 138/138, and Playwright e2e 77/77. Two earlier full-suite attempts exposed and then verified repairs for structural loop checkpoint preservation and the exact final-task marker prompt contract.
- Final repository lint passed with zero warnings or errors; no further source repair was required.
- Final Prettier verification passed across every tracked supported file type; no formatting repair was required.

### Task 36. Fix linting

- Task Status: `__done__`

#### Subtasks

Final-task repair scope: this task owns whole-story validation. If lint, formatting, or testing exposes a story-caused issue in code implemented by any earlier task, fix it within this final task when practical and rerun the affected checks. Do not reopen an older task solely to own that repair.

Task to ONLY check the linting after some manual fixes

1. [x] In `codeInfo2`, run `npm run lint` and fix issues.

2. [x] In `codeInfo2`, run the supported formatting command `npm run format` and fix issues.

3. [x] In `server/src/flows/service.ts`, repair the `subflowWave` parent-cancellation teardown used by `diagnostic_review_cycle`: after `server/src/ws/server.ts` accepts the active parent run token, propagate the stop to every active child, reconcile the persisted wave progress to `running: 0` with stopped children, retain the resumable checkpoint, and emit exactly one terminal parent result with status `stopped`. That terminal result is the contract consumed by `client/src/pages/FlowsPage.tsx`: do not add a client-only timeout or state override; it must clear `showStop`/`isStopping` so the existing `ComposerSendButton` changes from the disabled red Stop control back to the enabled Send/run action while the transcript retains `Stopped` on desktop and at the 390px mobile layout.

4. [x] In `server/src/test/integration/flows.run.subflow.test.ts`, extend the `stopping a subflow wave stops every repeated matrix and singleton child` regression to assert the parent reaches one terminal `stopped` result, with no active jobs left in persisted `subflowWaveProgress`; cover the production cancellation lifecycle and client-visible terminal status rather than only child assistant statuses.

#### Testing

Testing step to ONLY check the linting after some manual fixes

Final-task repair scope: the whole approved story is in scope for failures found by these checks. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected check. Do not reopen older tasks solely because their implementation is implicated.

1. [x] In `codeInfo2`, run `npm run build:summary:server`.
2. [x] In `codeInfo2`, run `npm run build:summary:client`.
3. [x] In `codeInfo2`, run `npm run compose:build:summary`.
4. [x] In `codeInfo2`, start the supported main stack with `npm run compose:up`.
5. [x] In `codeInfo2`, run the full client, server unit, server cucumber, shell, host-network, and e2e automated suites with `npm run test:summary:all:parallel`, `npm run test:summary:shell`, and `npm run test:summary:host-network:main`.
6. [x] In `codeInfo2`, stop the main stack with `npm run compose:down`.
7. [x] Run `npm run lint`.
8. [x] Run `npm run format`.

#### Manual Testing Guidance

- No broad manual-test matrix is required for this final repair. After the server regression passes, use the existing `diagnostic_review_cycle` parent run only for a targeted desktop and 390px mobile confirmation: after Stop is requested, the red Stop control may remain disabled only while cancellation is pending; the single terminal `Stopped` parent result must restore the normal enabled Send/run action without losing the resumable checkpoint. Do not add a client-only visual workaround if that terminal lifecycle contract is absent.

#### Implementation Notes

- Repaired the dedicated final task to include the required formatting subtask and whole-story build, runtime, suite, shutdown, lint, and formatting proof; automated proof is deferred until the new unchecked formatting subtask is completed.
- Audit: the fresh Task 36 packet, current plan and task handoffs, current git state, and the final-task repair commit were checked. The only implementation subtask remains the supported `npm run format` repair, and the expanded build, stack startup, full automated suites, shutdown, lint, and formatting proof have not been recorded after that repair.
- **RESOLVED ISSUE** The generic incomplete-proof blocker is retired: `npm run build:summary:server` passed cleanly on 2026-07-19. Task 36 remains `__in_progress__` for the remaining listed subtask and automated proof steps.
- Formatting subtask complete: ran `npm run format`; Prettier reported every tracked supported file as unchanged, so no formatting repairs were needed.
- Audit: both implementation subtasks are complete from the recorded lint and formatting evidence, with no source-file changes or story-caused user-facing behavior drift found in the current implementation pass. Testing items 2-7 remain open for later automated proof, so Task 36 stays `__in_progress__`; no blocker is needed because all implementation subtasks are complete and this audit does not own automated-proof completion.
- Client build proof passed on 2026-07-19; typecheck and Vite production build completed successfully, with only the existing large-chunk warning.
- Compose build proof passed on 2026-07-19; both images built successfully with zero failed items.
- Main Compose stack startup passed on 2026-07-19; preflight succeeded and the server reached healthy readiness.
- Full automated proof passed on 2026-07-19: client 900/900, server unit 2651/2651, server Cucumber 138/138, e2e 77/77, shell 20/20, and the main-stack host-network probe passed.
- Main Compose stack shutdown passed on 2026-07-19; all started containers and the network were removed.
- Final lint proof passed on 2026-07-19 with zero warnings or errors.
- Automated proof is complete for Task 36: all eight testing items are checked, with no live blocker; the later audit may determine task completion status.
- Audit: the fresh bounded packet and parser confirm both subtasks and all eight testing items are complete with no live blocker. The implementation-plus-proof pass introduced no source-file changes or story-caused user-facing behavior drift, so Task 36 is honestly complete and ready for the manual-testing phase.
- Manual full-story proof restarted the supported main stack because no freshness marker could prove the prior runtime current. `diagnostic_review_cycle` created one immutable target snapshot and launched its two-child wave, but Stop for active parent `3fa621ce-216d-4442-905c-d517b116940f` remained disabled/stopping after the server logged the matching `cancel_inflight` and abort. The live wave still reported active work instead of a terminal stopped parent, so the concrete server reconciliation repair and regression coverage above were added; the full suite and final format checks were reopened before a later manual retest. Playwright screenshot staging was attempted at `manual-testing/0000064/36/proof-01-diagnostic-wave.png` but its runtime lacked that directory, so no scratch artifact was retained.
- Preflight visual refinement pass ran against the supported Flows surface: clarified the server-to-`FlowsPage` terminal-status seam, the existing `ComposerSendButton` Stop-to-Send recovery, and the matching 390px mobile behavior; no code was changed in this step.
- Explicit WebSocket cancellation now preserves the active parent run token after a successful inflight abort, allowing `subflowWave` to stop every child and finalize one server-owned stopped parent result. The integration regression now exercises that cancellation ordering and asserts the parent stopped turn, zero active children, zero persisted running jobs, and stopped child entries; targeted server unit checks passed for both the regression and WebSocket cancellation path.
- Implementation-only audit: fresh Task 36 handoffs, the bounded task packet, parser output, current git state, and the latest cancellation commit show all four implementation subtasks complete. The approved server cancellation and regression changes introduce no unapproved user-facing behavior drift; Testing items 5 and 8 remain intentionally unchecked for the later automated-proof pass, so Task 36 remains `__in_progress__` with no live blocker and is ready for automated proof.
- Automated proof item 5 passed on 2026-07-19: the full client, server unit, server Cucumber, e2e, shell, and main-stack host-network suites passed (900/900, 2651/2651, 138/138, 77/77, 20/20, and probe passed).
- Automated proof item 8 passed on 2026-07-19: `npm run format` completed successfully and Prettier reported all tracked supported files unchanged.
- Implementation-plus-automated-proof audit: the fresh bounded packet, current repository state, latest implementation/proof commits, and proof artifacts confirm all four subtasks and all eight testing items are complete. The cancellation change is within the approved story surface and automated proof confirms the existing client terminal-status behavior; no story-caused preserved-behavior regression or unapproved user-facing drift was found. Parser output reports no live blocker, so Task 36 is now honestly `__done__` and ready for manual testing.
- Final-task manual proof restarted the freshness-unknown main stack, then expanded to the story's currently available one-target scope. After archiving one stale orphaned diagnostic test conversation, a fresh `diagnostic_review_cycle` launched its two-child wave; Stop produced `running: 0, stopped: 2`, the terminal `Stopped` state, and the enabled Send action on desktop and 390px mobile. The initial new-conversation fetch returned one transient 404 before the server created the conversation; the subsequent Playwright desktop/mobile pass had no console errors. Health passed and the main stack shut down cleanly. The declared scope has no additional repositories, so three-target/cross-repository paths were not re-proven in this pass; prior proof remains necessary for those unavailable current-scope cases. Playwright staging `manual-testing/0000064/36/proof-01-desktop-stopped-wave.png` failed with `ENOENT` in its runtime and no scratch screenshot was retained under `codeInfoTmp/manual-testing/0000064/36/`; no additional subtasks were needed.

## Code Review Findings

- Review pass: `0000064-20260719T212516Z-52af6cfac4-32769dc2`
- Review cycle: `0000064-rc-20260719T212516Z-7280f8e7`
- Comparison context: local `HEAD` `52af6cfac4bc5cd3abd91e83cb18bf6eadf5ee66` versus resolved base `origin/main@00ced5bb15524d12395dfc5c0d427b3c65eb7f97` from the stored review handoff, with comparison rule `local_head_vs_resolved_base`, resolved base source `remote`, and remote fetch status `success`.
- Wave coverage and target ownership: fast wave `0000064-rw-20260719T212516Z-d2271003` expected 3 jobs and completed 2; the `current_repository--codex_review` target job completed with usable server-owned validation, the `current_repository--open_code_review` target job was stale because its coverage did not match the OCR manifest, and the singleton `story--cross_repository_review` job completed `not_applicable` without usable server-owned validation. `current_repository` at `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2` is the owner of all three findings. The review set requires cross-repository coverage and therefore remains `closeout_allowed: false`.
- Severity conflicts and provenance: the validated aggregate contains 3 current-pass findings and 0 severity conflicts; each finding has one validated `Codex Review` source. The fallback findings artifact contains no additional rejected or non-adopted candidates, so no current-pass item was added to the ignored category. The incomplete cross-repository coverage remains disposition state, not an accepted or ignored issue.

### Accepted

#### 1. Interrupted children with earlier completed steps are falsely treated as terminal

- Finding ID: `829f2dbe9adb33dd2a27976ed3965d3c5f9e1c2abac8309325a94bd1cb56bbbd`
- Found by: Codex Review
- Description: After restart, the wave can treat a child as terminal because it reads the latest assistant-step status instead of the child’s overall lifecycle, skipping the child’s remaining review steps.
- Example: A child interrupted after one successful intermediate step can be marked successful by the parent without resuming its remaining steps.
- Why accepted: The validated P1 finding is part of Story 64’s cancellation and resume lifecycle. Its routed reason requires planned lifecycle and restart proof, while the promoted minor path gives it one bounded inline resolution opportunity before task-up.

#### 2. Review initialization failures silently bypass the entire review cycle

- Finding ID: `63b72dde79951ac23ce584197326f258d12b7bada9aa81b53fff5f4b9f74594b`
- Found by: Codex Review
- Description: A non-cancellation initialization exception is emitted as successful and exits the flow, allowing the parent to continue without running the fast or slow review.
- Example: A review initialization failure can return `{ status: 'ok', exitFlow: true }`, so later closeout proceeds even though no review wave ran.
- Why accepted: The validated P1 finding affects Story 64’s review-cycle initialization, lifecycle failure propagation, and closeout authority. Its routed reason requires coordinated proof, while the promoted minor path gives it one bounded inline resolution opportunity before task-up.

#### 3. Open Code Review validates a different diff when base and head have diverged

- Finding ID: `1d7b6fd25a1781d1620eb1e549d1406520b5f31b1681e050be32b72b3ce35bc1`
- Found by: Codex Review
- Description: Open Code Review computes committed paths with a two-endpoint diff while the other review surfaces use a three-dot comparison, so the reviewed path set can differ when base and head diverge.
- Example: A path present only on the base can be included by `git diff <base> <head>` even though `git diff <base>...<head>` excludes it, causing OCR to validate a different manifest.
- Why accepted: The validated P2 finding is within Story 64’s target-scoped Open Code Review and artifact/diff identity contract. Its routed reason limits the inline work to the established same-repository publisher seam and focused divergent-history proof.

### Ignored for This Story

- None.

### Task 37. Record Minor Review Fixes From Pass 0000064-20260719T212516Z-52af6cfac4-32769dc2

- Task Status: `__done__`

#### Overview

This completed audit records the terminal inline outcomes for this review pass.

Escalated review items requiring combined task-up:

- None.

#### Subtasks

1. [x] Fixed `1d7b6fd25a1781d1620eb1e549d1406520b5f31b1681e050be32b72b3ce35bc1` — Open Code Review validates a different diff when base and head have diverged (`current_repository`); modified `scripts/publish_open_code_review.py`, `scripts/test/test_publish_open_code_review.py`.
2. [x] Fixed `63b72dde79951ac23ce584197326f258d12b7bada9aa81b53fff5f4b9f74594b` — Review initialization failures silently bypass the entire review cycle (`current_repository`); modified `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`.
3. [x] Fixed `829f2dbe9adb33dd2a27976ed3965d3c5f9e1c2abac8309325a94bd1cb56bbbd` — Interrupted children with earlier completed steps are no longer classified as terminal while their persisted lifecycle remains running, orphaned, or explicitly interrupted. (`current_repository`); modified `server/src/flows/service.ts`.

#### Testing

1. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts` in `current_repository` — passed. 49 focused subflow integration tests passed.
2. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name "review initialization failures fail the flow instead of silently skipping the review cycle"` in `current_repository` — passed. The focused regression test passed; malformed current-plan state now fails initialization, prevents subsequent steps, and records a failed marker.
3. [x] `python3 -m unittest scripts/test/test_publish_open_code_review.py` in `current_repository` — passed. 17 focused publisher tests passed, including a real-Git divergent-history regression proving that only the feature-side three-dot diff is required.

#### Implementation Notes

- Review Task Role: `minor_fix_loop_audit`
- Review Cycle Id: `0000064-rc-20260719T212516Z-7280f8e7`
- Review Pass Id: `0000064-20260719T212516Z-52af6cfac4-32769dc2`
- Review Phase: `fast`
- This task is a completed historical audit and does not replace final story revalidation.
### Task 38. Record Minor Review Fixes From Pass 0000064-20260719T223932Z-95741e5d79-c6e7c46c

- Task Status: `__done__`

#### Overview

This completed audit records the terminal inline outcomes for this review pass.

Escalated review items requiring combined task-up:

- None.

#### Subtasks

1. [x] Fixed `632874705e890b70ad33a672f3f588a9c65fe06eaba62b5ea3c49ac6cd699909` — Story-owned compose changes removed the built-in markdown bind mount needed by packaged review flows. (`current_repository`); modified `docker-compose.yml`, `server/src/test/unit/host-network-compose-contract.test.ts`.
2. [x] Fixed `c175ba2d0564cd6f46d156a35714f3ad84630b51ad481bb9ffe637f6e017911a` — The server accepted resume traffic before startup reconciliation completed. (`current_repository`); modified `server/src/index.ts`, `server/src/test/unit/flows-startup-reconciliation.test.ts`.
3. [x] Fixed `f243a30a8eb7c868c137b9c0f30e0c358a01ecc64cb8cf99dd71e5bc9632dc7a` — A crash between child launch and parent-state persistence can duplicate wave jobs during resume. (`current_repository`); modified `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`.

#### Testing

1. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name "restart recovery reattaches a launched wave child when the parent crashed before persisting it"` in `current_repository` — passed. The focused crash-window recovery regression passed; the parent reattaches the persisted child by execution and instance identity and does not launch a second conversation.
2. [x] `npm run test:summary:server:unit -- --file server/src/test/unit/flows-startup-reconciliation.test.ts` in `current_repository` — passed. The focused wrapper built the server and passed all 4 startup-reconciliation tests, including the listener-ordering regression guard.
3. [x] `npm run test:summary:server:unit -- --file server/src/test/unit/host-network-compose-contract.test.ts` in `current_repository` — passed. 7 focused compose contract tests passed, including the restored read-only codeinfo_markdown mount and its source bind-mount count.

#### Implementation Notes

- Review Task Role: `minor_fix_loop_audit`
- Review Cycle Id: `0000064-rc-20260719T212516Z-7280f8e7`
- Review Pass Id: `0000064-20260719T223932Z-95741e5d79-c6e7c46c`
- Review Phase: `fast`
- This task is a completed historical audit and does not replace final story revalidation.
### Task 39. Record Minor Review Fixes From Pass 0000064-20260720T002803Z-00f835bcb0-a40ed56f

- Task Status: `__done__`

#### Overview

This completed audit records the terminal inline outcomes for this review pass.

Escalated review items requiring combined task-up:

- None.

#### Subtasks

1. [x] Fixed `0000064-cross-repository-stale-publication` — Singleton cross-repository not-applicable publication can win a stale wave. (`current_repository`); modified `server/src/flows/crossRepositoryReview.ts`, `server/src/test/unit/cross-repository-review.test.ts`.
2. [x] Fixed `0000064-cucumber-production-boundary-bypass` — Review-wave Cucumber closeout and downstream-tasking scenarios now consume finalized output from the production wave-validation boundary. (`current_repository`); modified `server/src/test/features/review-wave.feature`, `server/src/test/steps/review-wave.steps.ts`.
3. [x] Fixed `0000064-implicit-source-fallback-cross-binds-working-folder` — Implicit review launch fallback could bind a foreign flow source to the requested working folder. (`current_repository`); modified `scripts/review-cycle-summary.mjs`, `scripts/review-cycle-summary.test.mjs`.
4. [x] Fixed `0000064-malformed-wave-state-discarded` — Malformed persisted wave jobs are silently discarded before recovery decisions. (`current_repository`); modified `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`.
5. [x] Fixed `0000064-missing-three-target-proof` — Three-target production review-loop proof now verifies every target-local job and the cross-repository result complete before closeout. (`current_repository`); modified `server/src/test/integration/review-production-loop.test.ts`.
6. [x] Fixed `0000064-positional-second-pass-identity-proof` — Second-pass review-wave proof now compares complete child identity sets rather than matching jobs by position. (`current_repository`); modified `server/src/test/steps/review-wave.steps.ts`.
7. [x] Fixed `0000064-resume-state-inputs-dropped` — Resume-state normalization drops malformed child inputs and prior flow values. (`current_repository`); modified `server/src/flows/service.ts`, `server/src/test/integration/flows.run.subflow.test.ts`.
8. [x] Fixed `0000064-startup-pending-only-wave-not-selected` — Pending-only wave checkpoints were excluded from startup reconciliation selection. (`current_repository`); modified `server/src/flows/service.ts`, `server/src/test/unit/flows-startup-reconciliation.test.ts`.
9. [x] Fixed `0000064-wave-base-identity-not-checked` — Wave validation did not enforce each target's pinned comparison base. (`current_repository`); modified `server/src/flows/reviewWaveValidation.ts`, `server/src/test/unit/review-wave-validation.test.ts`.

#### Testing

1. [x] `node --test scripts/review-cycle-summary.test.mjs` in `current_repository` — passed. All 12 focused launcher tests passed, including the foreign singleton-source regression.
2. [x] `npm run test:summary:server:cucumber -- --feature src/test/features/review-wave.feature` in `current_repository` — passed. The focused server Cucumber wrapper built the server and passed all 9 review-wave scenarios after asserting unique, disjoint (instanceId, inputHash) identity sets.
3. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name "resume rejects malformed persisted child inputs and prior flow values"` in `current_repository` — passed. The focused regression passed after the server wrapper built the workspace; it covers malformed persisted child input and prior flow values.
4. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --test-name "resume rejects malformed persisted wave progress instead of discarding its jobs"; npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts` in `current_repository` — passed. The focused malformed-state regression passed, then the owning subflow integration file passed all 52 tests.
5. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/review-production-loop.test.ts` in `current_repository` — passed. The focused server-unit wrapper built the server and passed both production-loop integration tests, including the new three-target closeout case with nine target-local jobs and one completed cross-repository result.
6. [x] `npm run test:summary:server:unit -- --file server/src/test/unit/cross-repository-review.test.ts` in `current_repository` — passed. The focused server-unit wrapper passed all 4 tests, including the stale singleton publication regression.
7. [x] `npm run test:summary:server:unit -- --file server/src/test/unit/flows-startup-reconciliation.test.ts` in `current_repository` — passed. The focused wrapper built the server and passed all 5 startup-reconciliation tests, including the pending-only selector regression guard.
8. [x] `npm run test:summary:server:unit -- --file server/src/test/unit/review-wave-validation.test.ts` in `current_repository` — passed. The focused server-unit wrapper passed all 10 review-wave validation tests, including stale comparison-base rejection.

#### Implementation Notes

- Review Task Role: `minor_fix_loop_audit`
- Review Cycle Id: `0000064-rc-20260719T212516Z-7280f8e7`
- Review Pass Id: `0000064-20260720T002803Z-00f835bcb0-a40ed56f`
- Review Phase: `slow`
- This task is a completed historical audit and does not replace final story revalidation.
### Task 40. Reconcile Incomplete Review Coverage and Recover Blocked Findings

- Task Status: `__done__`
- Repository Name: `codeInfo2`
- Review Task Role: `review_finding_repair`
- Prerequisite: Tasks 1-39 remain historical story work; complete this bounded review-state and evidence repair before final revalidation.
- Review Pass ID: `0000064-20260720T002803Z-00f835bcb0-a40ed56f`
- Review Cycle ID: `0000064-rc-20260719T212516Z-7280f8e7`

#### Overview

The stored disposition state for the current slow review pass is valid and records no unresolved task-required findings, but it still declares nine incomplete-review blockers from earlier fast-wave coverage, the consumer-contract interruption, and a blocked minor-fix audit. Execute this task in order: establish artifact and contract evidence in subtasks 1-3, repair or explicitly preserve the four candidate findings in subtasks 4-7, synchronize the plan/state handoff in subtask 8, then prepare the named proof files in subtasks 9-16 before running Testing. This task closes only when each blocker has either matching authoritative evidence and a synchronized disposition or an explicit preserved blocker with its minimum evidence still visible. Use the exact versioned review-set and wave-validation artifacts named by each stable locator, validate server-owned cross-repository coverage for every required fast wave, and route the four blocked candidates through the current-pass review path. Keep all implementation ownership in `codeInfo2`; cross-target compatibility evidence belongs in this task's proof and does not authorize another repository owner.

#### Non-Goals

- Do not create a second `## Code Review Findings` section or rewrite the existing current-pass decisions.
- Do not treat resolved minor findings as new tasks, reopen historical `minor_fix_loop_audit` tasks, or widen the story behavior lock.
- Do not add an additional repository, a second unconditional cross-repository review, or a new user-facing behavior contract.

#### Addresses Findings

- `required-cross-repository-coverage-unusable` — restore or honestly preserve the exact fast-wave cross-repository coverage result for wave `0000064-rw-20260719T223932Z-4aced681`.
- `current-wave-versioned-artifacts-missing` — reconcile the stable locator with the exact versioned review-set and wave-validation pair for wave `0000064-rw-20260719T234833Z-de3f84e0`.
- `current-wave-cross-repository-coverage-unusable` — validate the current fast-wave cross-repository result against the exact story, session, pass, parent, target snapshot, HEAD, and comparison base.
- `minor-fix-audit-review-pass-id-mismatch` — synchronize the terminal minor-fix audit to review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`.
- Review-state blocker — required harness review-wave consumer contract unavailable: clear or preserve the global contract-path interruption using the repository-owned contract and configured harness handoff without inventing a clean result.
- `0000064-blank-flow-run-fields-coerced` — re-evaluate the blocked request-admission finding after valid review evidence is available.
- `0000064-active-review-cycle-overwrite-race` — re-evaluate the blocked review-cycle ownership finding after valid review evidence is available.
- `0000064-malformed-status-response-opaque-failure` — re-evaluate the blocked status-response finding after valid review evidence is available.
- `0000064-retry-completion-persistence-loss` — re-evaluate the blocked retry-persistence finding after valid review evidence is available.

#### Task Exit Criteria

- The exact current-pass findings block remains unique, with its accepted and ignored decisions unchanged.
- For each blocked wave, the stable locator and exact versioned artifacts agree on story, wave, parent, target snapshot, review session, review pass, HEAD, and comparison base; a missing or invalid artifact remains an explicit blocker.
- Each required multi-target fast wave has a usable server-owned `cross_repository_review` result with matching identity and target coverage; singleton `not_applicable` output is never used as multi-target proof.
- The wave evidence also proves the stale-publication interleaving: a terminal result from an older wave cannot overwrite the newer stable locator or make incomplete newer coverage appear closeable.
- The consumer-contract and minor-audit blockers have either exact current-pass evidence or a preserved non-clean disposition, and each of the four blocked findings has one current-pass disposition.
- Each four-candidate review path proves producer-to-consumer propagation and the failure interleaving that matters: request admission through normal launch resolution, competing cycle initialization, malformed status through polling classification, and completion persistence failure through retry replay.
- Task 41 remains the only final revalidation owner for review cycle `0000064-rc-20260719T212516Z-7280f8e7`.

#### Risk Ownership

- Implementation owner: `codeInfo2`.
- Product/story seam: Task 40 owns the four confirmed code seams and their focused regressions; it restores only story-caused drift and preserves the approved behavior contract.
- Proof/harness seam: Task 40 owns exact versioned artifact identity, server-owned cross-repository validation, consumer-contract availability, and disposition synchronization; no blocker may be cleared from a reviewer pointer, singleton result, or missing contract.
- Shared wrapper/baseline seam: Task 40 owns only the targeted proof needed for these findings; Task 41 owns the full repository baseline, so a broad-wrapper failure is recorded and diagnosed there rather than retried blindly here.
- Manual/runtime environment seam: Task 41 owns supported main-stack startup, readiness, cross-target runtime proof, and artifact handoff; Task 40 must remain executable without manual or live-runtime proof.
- Task-shape/planning seam: the current-pass findings block remains unique, Tasks 40 and 41 remain ordered, and Task 41 remains the sole final revalidation owner.
- Review-state risk: the plan must remain visibly incomplete until every blocker has exact evidence or an explicit disposition.
- Behavior risk: preserve established behavior except for restoring story-caused drift; do not convert the reviewer's broader remedy into scope.

#### Owner Map

- `codeInfo2`: owns all implementation and plan-visible review-task work.
- Cross-target proof: remains in `codeInfo2` review-wave artifacts and `Testing`; no additional repository is in the stored plan scope.

#### Requirement-To-Proof Mapping

- Wave identity and comparison-base invariant: each versioned review-set, wave-validation, target snapshot, and cross-repository result must agree on story, wave, parent, target hash, review session/pass, target HEAD, and comparison base. Owners: `server/src/flows/reviewTargets.ts` and `server/src/flows/reviewWaveValidation.ts`. Proof: the named versioned artifacts, `server/src/test/unit/review-wave-validation.test.ts`, and `server/src/test/integration/review-production-loop.test.ts`.
- Persisted artifact lifecycle invariant: `server/src/flows/reviewSet.ts`, `server/src/flows/reviewWaveValidation.ts`, and `server/src/flows/crossRepositoryReview.ts` write versioned evidence and stable `current-*` pointers through `server/src/flows/reviewIdentity.ts`'s temporary-file-plus-rename `atomicWriteJson`; `reviewWaveValidation.ts`, `crossRepositoryReview.ts`, the production loop, and the review handoff read and validate those artifacts. Partial, in-progress, missing, or malformed artifacts must remain non-closeable; failed atomic writes clean only their temporary file, and a stale publisher must skip rather than delete or replace a newer stable pointer. Proof: `server/src/test/unit/review-identity.test.ts`, `server/src/test/unit/review-set.test.ts`, `server/src/test/unit/review-wave-validation.test.ts`, and `server/src/test/integration/review-production-loop.test.ts`.
- Mandatory multi-target coverage invariant: every required multi-target fast wave must have usable server-owned `cross_repository_review` output with complete target coverage; singleton `not_applicable` and reviewer-pointer inference do not satisfy it. Owners: `server/src/flows/reviewWaveValidation.ts` and `server/src/flows/crossRepositoryReview.ts`. Proof: `server/src/test/unit/review-wave-validation.test.ts`, `server/src/test/integration/review-production-loop.test.ts`, and `server/src/test/features/review-wave.feature`.
- Stale-publication ordering invariant: a terminal older wave cannot replace a newer stable locator or make incomplete newer coverage closeable. Owner: `server/src/flows/reviewWaveValidation.ts`. Proof: the `superseded complete wave keeps versioned evidence without replacing stable pointers` case in `server/src/test/unit/review-wave-validation.test.ts`, plus the production-loop identity assertions.
- Review-contract and pass-synchronization invariant: the consumer contract, terminal minor-fix result, disposition state, and exact current-pass findings block must either agree or preserve a visible non-clean blocker. Owners: `codeinfo_markdown/shared/review-wave-consumer-contract.md`, `scripts/flow_control/review.py`, `scripts/write_minor_fix_audit_task.py`, `codeInfoStatus/flow-state/review-disposition-state.json`, and the canonical plan. Proof: the exact versioned handoff artifacts, the current-pass findings block, `review-disposition-state.json`, and `python3 scripts/plan_sections.py --profile review-tasking`.
- `0000064-blank-flow-run-fields-coerced`: omitted versus explicit blank or whitespace-only admission semantics must survive `validateBody` into `startFlowRun` and normal source/working-folder resolution. Owner: `server/src/routes/flowsRun.ts`. Proof: the dedicated POST route case in `server/src/test/integration/flows.run.basic.test.ts` and the focused route testing item; the existing status/stop tests in `server/src/test/unit/flows-run-route.test.ts` are not sufficient for this finding.
- `0000064-active-review-cycle-overwrite-race`: competing `initializeReviewCycle` calls must leave one authoritative active cycle and matching disposition state. Owner: `server/src/flows/reviewCycleLifecycle.ts`. Proof: `server/src/test/unit/review-cycle-lifecycle.test.ts` and the competing-cycle testing item.
- `0000064-malformed-status-response-opaque-failure`: malformed successful responses must remain actionable from `readJsonResponse` through polling/fingerprint handling to `review_runner_failure`. Owner: `scripts/review-cycle-summary.mjs`. Proof: the dedicated malformed-success rejection in `scripts/review-cycle-summary.test.mjs`, the separate nonterminal-success case, and the wrapper `main` catch mapping.
- `0000064-retry-completion-persistence-loss`: retry ownership must survive successful completion, completion-write failure, process-local barrier loss, persisted reload, and fresh-run lookup/replay. Owner: `server/src/flows/service.ts`. Proof: `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.errors.test.ts`, and the retry testing item.
- Review handoff invariant: the current findings block remains unique, resolved-minor IDs remain historical, every blocker has a durable disposition, and Task 41 remains the sole final revalidation owner. Owners: the canonical plan and `codeInfoStatus/flow-state/review-disposition-state.json`. Proof: Task 40 subtask 8, the structural plan packet, and Task 41's active review-cycle identity.

#### Proof Mapping

- Review-wave validation and production closeout: `server/src/test/unit/review-wave-validation.test.ts`, `server/src/test/integration/review-production-loop.test.ts`, and `server/src/test/features/review-wave.feature`.
- Request and lifecycle seams: the dedicated POST route case in `server/src/test/integration/flows.run.basic.test.ts` and the dedicated concurrent-cycle case in `server/src/test/unit/review-cycle-lifecycle.test.ts`.
- Review launcher/status seam: `scripts/review-cycle-summary.test.mjs`, with separate malformed-success rejection and nonterminal-success cases, plus the wrapper `main` catch mapping to `review_runner_failure`.
- Request admission proof follows `validateBody` into `startFlowRun` and normal source/working-folder resolution; lifecycle proof follows `initializeReviewCycle` into active-cycle and disposition persistence; launcher proof follows `readJsonResponse` into `progressFingerprint`, status polling, and `review_runner_failure` classification; retry proof follows `persistFreshRunRetryOwnershipCompletion` into fresh-run lookup and replay after persistence loss. The named route, lifecycle, launcher, and flow integration tests are the proof homes for those producer-to-consumer paths and their failure interleavings.
- Proof-authoring ownership is explicit: subtasks 9-11 own the review-wave unit, production integration, and Cucumber surfaces; subtasks 12-14 own request-admission, cycle-lifecycle, and launcher assertions; subtasks 15-16 own the two retry integration proof branches. Testing remains responsible only for executing these prepared surfaces through the existing wrappers.

#### Affected Repositories

- `codeInfo2` only; affected surfaces are the server review lifecycle and validation flows, the review-cycle launcher scripts, persisted review artifacts, and their server/Cucumber proof.

#### Documentation Locations

- Canonical plan: `planning/0000064-users-can-review-every-story-repository-in-one-parallel-wave.md`.
- Review handoff and artifacts: `codeInfoTmp/reviews/0000064-current-review.json` and the exact files it names.
- Routing state: `codeInfoStatus/flow-state/review-disposition-state.json`.

#### Subtasks

1. [x] Start from `codeInfoTmp/reviews/0000064-current-review.json` and the active disposition state. For waves `0000064-rw-20260719T223932Z-4aced681` and `0000064-rw-20260719T234833Z-de3f84e0`, compare each stable locator with its exact versioned `review-set-final` and `review-wave-validation` artifacts, tracing writers in `server/src/flows/reviewSet.ts` and `server/src/flows/reviewWaveValidation.ts` to readers in `reviewWaveValidation.ts`, `crossRepositoryReview.ts`, and the production review handoff. Record agreement for `story_id`, `review_wave_id`, `parent_execution_id`, `targets_sha256`, `review_session_id`, `review_pass_id`, target HEAD, comparison base, and target snapshot; confirm versioned writes are atomic and partial, in-progress, missing, or malformed artifacts remain non-closeable. If the comparison proves a story-caused writer, reader, or cleanup defect, repair only the owning seam in `reviewSet.ts`, `reviewWaveValidation.ts`, `crossRepositoryReview.ts`, or `reviewIdentity.ts`; otherwise retain the blocker and its minimum evidence instead of substituting another wave. Leave the corresponding artifact assertions to subtask 9, and never delete evidence or a newer stable pointer as cleanup.
2. [x] Read the matching versioned `cross-repository-review` artifact and embedded job validation for each of the two waves named in subtask 1. For each wave, record whether the server-owned result has usable status, complete target coverage, and identity matching its review set; record singleton `not_applicable` or reviewer-pointer inference as insufficient for multi-target proof. Use `server/src/test/unit/review-wave-validation.test.ts` and `server/src/test/integration/review-production-loop.test.ts` in subtask 9 to capture the exact interleaving where an older terminal result cannot overwrite the newer locator or make incomplete newer coverage closeable, while retaining all usable target-local findings.
3. [x] Read `codeinfo_markdown/shared/review-wave-consumer-contract.md`, `codeInfoTmp/reviews/0000064-current-review.json`, and `codeInfoStatus/flow-state/review-disposition-state.json`. Reconcile the contract-availability result and synchronize the terminal minor-fix result to review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`. If the contract remains unavailable, preserve the blocker in the disposition state and Task 40 handoff, stop this branch, and make no production or findings-block changes; do not change review cycle `0000064-rc-20260719T212516Z-7280f8e7`.
4. [x] For `0000064-blank-flow-run-fields-coerced`, repair only a confirmed story-owned request-admission defect in `server/src/routes/flowsRun.ts`. Preserve omitted versus explicit blank or whitespace-only handling for the string fields `conversationId`, `retryOwnershipId`, `codexReviewModelId`, `sourceId`, `working_folder`, and `customTitle` as applicable to the finding, and preserve the resulting `startFlowRun` arguments and normal source/working-folder resolution. If current evidence does not confirm story-owned drift, write the finding's incomplete disposition to `codeInfoStatus/flow-state/review-disposition-state.json` and Task 40's handoff instead of changing behavior.
5. [x] For `0000064-active-review-cycle-overwrite-race`, repair only a confirmed story-owned ownership defect in `server/src/flows/reviewCycleLifecycle.ts`. At the `initializeReviewCycle` write boundary, preserve one authoritative `active-review-cycle.json`, archive or preserve the prior cycle's disposition under its cycle directory, and leave the losing initializer unable to delete or replace the winner's state. If current evidence does not confirm story-owned drift, record the finding's incomplete disposition in the same state and handoff files instead of changing behavior.
6. [x] For `0000064-malformed-status-response-opaque-failure`, repair only a confirmed story-owned launcher/status defect in `scripts/review-cycle-summary.mjs`. Keep `readJsonResponse` rejection actionable when a successful response has an invalid shape, prevent `progressFingerprint` from treating missing `status`, `latestAssistantAt`, or `subflowWaveProgress` as valid progress, and preserve the wrapper `main` catch mapping to `review_runner_failure`. If current evidence does not confirm story-owned drift, record the finding's incomplete disposition in the disposition state and Task 40 handoff instead of changing behavior.
7. [x] For `0000064-retry-completion-persistence-loss`, repair only a confirmed story-owned retry defect in `server/src/flows/service.ts`. Keep `persistFreshRunRetryOwnershipCompletion` ahead of releasing the accepted launch's ownership, preserve the durable completion in the conversation flow state, and ensure `getPersistedFreshRunRetryOwnershipCompletion` and the normal `startFlowRun` lookup replay the same result after process-local barrier loss or restart without a duplicate launch. If current evidence does not confirm story-owned drift, record the finding's incomplete disposition in the disposition state and Task 40 handoff instead of changing behavior.
8. [x] After subtasks 1-7 have produced their evidence or explicit incomplete outcomes, update `codeInfoStatus/flow-state/review-disposition-state.json` and this plan's current-pass handoff: keep exactly one current `Code Review Findings` block, preserve every resolved-minor ID as historical inline work, give each blocker or repair its named proof home, preserve review cycle `0000064-rc-20260719T212516Z-7280f8e7`, and leave Task 41 as the next executable task. Do not mark a blocker clean without the evidence required by subtasks 1-7.
9. [x] Prepare the persisted-artifact proof surfaces in `server/src/test/unit/review-identity.test.ts`, `server/src/test/unit/review-set.test.ts`, and `server/src/test/unit/review-wave-validation.test.ts`: retain the atomic JSON publication and `a stale wave writes versioned evidence without replacing the stable manifest` cases, add failure cleanup coverage showing a failed temporary-file write or rename leaves no temporary artifact, and extend the aligned `complete review wave finalizes exact coverage...` and `wave validation rejects target results with a stale comparison base` cases with field-by-field story, wave, parent, target hash, review session/pass, target HEAD, and comparison-base assertions. Keep dedicated missing/malformed/partial cross-repository coverage and `superseded complete wave keeps versioned evidence without replacing stable pointers` ordering assertions; prove that partial or malformed persisted state remains non-closeable and that stale cleanup cannot delete or replace newer stable evidence. Do not treat severity aggregation alone as identity proof.
10. [x] Prepare the production closeout proof in `server/src/test/integration/review-production-loop.test.ts`: extend the `production three-target review loop closes only after every target and cross-repository result is usable` case so one combined scenario asserts target-local isolation, usable cross-repository coverage, complete story/session/pass/parent/target/HEAD/base identity, and disposition recording only after all required results are usable.
11. [x] Prepare the review-wave Cucumber proof surface in `server/src/test/features/review-wave.feature` and `server/src/test/steps/review-wave.steps.ts`: keep the mixed-wave and second-pass scenarios bound to `flows/two_phase_review_cycle.json`, and keep the downstream-tasking scenario bound to `validateCurrentReviewSet`; assert default production-wave reachability, finalized-validation consumption, distinct child identity sets across passes, and the three-target target-local plus cross-repository closeout path rather than only expanding fixture objects.
12. [x] Prepare a dedicated POST route case in `server/src/test/integration/flows.run.basic.test.ts` for `0000064-blank-flow-run-fields-coerced`: assert omitted, blank, and whitespace-only values for each affected `validateBody` identifier field through `POST /flows/:flowName/run`, then assert the resulting `startFlowRun` arguments and normal source/working-folder resolution. Keep the existing `POST /flows/:flowName/run ignores whitespace customTitle` case as adjacent custom-title coverage; do not rename it to claim the broader finding.
13. [x] Prepare a dedicated concurrent-initialization case in `server/src/test/unit/review-cycle-lifecycle.test.ts` for `0000064-active-review-cycle-overwrite-race`: invoke competing `initializeReviewCycle` calls at a deterministic write boundary and assert one authoritative active-cycle record, matching disposition ownership, preservation or archival of the prior cycle, and the loser/cleanup outcome. Do not rely on `fresh final review archives stale disposition and resume preserves the cycle`, which proves sequential archival/resume rather than the race.
14. [x] Prepare a dedicated malformed-success case in `scripts/review-cycle-summary.test.mjs` for `0000064-malformed-status-response-opaque-failure`: return a deterministic successful HTTP response whose `json()` produces an invalid status shape, assert the exported `waitForReviewCycle` path rejects with an actionable status diagnostic at the `readJsonResponse`/polling boundary, and preserve the wrapper `main` catch mapping to `review_runner_failure`. Keep `review runner waits through nonterminal status until terminal success` as separate happy-path polling coverage.
15. [x] Prepare `server/src/test/integration/flows.run.basic.test.ts` for `0000064-retry-completion-persistence-loss`: retain `durable retryOwnershipId replay reuses the accepted launch after completed-cache loss` as persisted-reload/idempotent-replay coverage, using `__resetFreshRunRetryOwnershipCompletionForTests` as the deterministic process-local barrier-loss boundary. Assert successful ownership, persisted reload, and fresh-run replay without duplicate ownership; do not rename this cache-loss test to claim that the completion write itself failed.
16. [x] Prepare `server/src/test/integration/flows.run.errors.test.ts` for `0000064-retry-completion-persistence-loss`: add a dedicated error-path case using the existing `memoryConversations.set` failure-injection pattern to fail the post-success completion write, then clear the process-local barrier and re-enter through the normal flow-run entrypoint to assert the durable barrier/replay outcome. Keep `pre-launch persistence failure clears stale retry ownership...` and `same-process completed retryOwnershipId replay...` as adjacent coverage; neither may be renamed to claim completion-write failure followed by persisted reload.
17. [x] Restore the harness-owned `scripts`, `codeinfo_markdown`, `flows`, and `flows-sandbox` bind mounts in `docker-compose.local.yml`, restore the main-stack `scripts` bind mount, update source-bind counts, and preserve image copies only as non-Compose fallbacks. Add static contract coverage proving each local workflow mount appears exactly once and the shared review-wave contract exists at the mounted source path.
18. [x] Replace the three story implementation flows' durable-blocker `haltFlow` gates with a successful whole-flow `exitFlow` outcome that preserves incomplete state and skips review and closeout. Add schema/runtime support, terminal lifecycle coverage for both successful exit and explicit halt, and blocker-repair prompt rules that inspect `CODEINFO_RUNTIME_COMPOSE_FILE` rather than a different Compose variant and never restart `compose:local` from inside the flow.

#### Testing

Normal-system startup and shutdown are not repeated in this task: it changes review artifacts, server/script validation, and plan state without changing Compose ownership or runtime routing; Task 41 owns the supported main-stack lifecycle and full regression proof.

1. [x] In `codeInfo2`, run `npm run build:summary:server` before the focused proof.
2. [x] In `codeInfo2`, run `npm run test:summary:server:unit -- --skip-build --file server/src/test/integration/flows.run.basic.test.ts --file server/src/test/unit/review-cycle-lifecycle.test.ts`; cover the dedicated blank-field POST route case and competing review-cycle ownership without changing the approved behavior contract.
3. [x] In `codeInfo2`, run `npm run test:summary:server:unit -- --skip-build --file server/src/test/integration/flows.run.basic.test.ts --file server/src/test/integration/flows.run.errors.test.ts`; cover persisted reload/idempotent replay after process-local barrier loss and the dedicated post-success completion-write failure branch.
4. [x] In `codeInfo2`, run `node --test scripts/review-cycle-summary.test.mjs`; cover malformed successful status handling and preserve actionable protocol failure classification.
5. [x] In `codeInfo2`, run `npm run test:summary:server:unit -- --skip-build --file server/src/test/unit/review-identity.test.ts --file server/src/test/unit/review-set.test.ts --file server/src/test/unit/review-wave-validation.test.ts --file server/src/test/integration/review-production-loop.test.ts`; prove atomic temporary-file cleanup, versioned writer-to-reader identity, partial or malformed state blocking closeout, pinned-base identity, target-local results, cross-repository closeout identity, and that an older terminal publication cannot supersede or clean up newer stable evidence.
6. [x] In `codeInfo2`, run `npm run test:summary:server:cucumber -- --skip-build --feature src/test/features/review-wave.feature` to prove the production review-wave and downstream-tasking boundary.
7. [x] Run `python3 scripts/plan_sections.py --profile review-tasking`, then verify the current pass appears in exactly one structured findings block, every blocker above has durable plan/state coverage, and Task 41 is the only final revalidation owner.
8. [x] In `codeInfo2`, run the focused server unit coverage for `host-network-compose-contract.test.ts`, `runtime-blocker-prompt-contract.test.ts`, and `flows-schema.test.ts`.
9. [x] In `codeInfo2`, run the focused server integration coverage for `flows.run.loop.test.ts`, including successful best-effort `exitFlow` lifecycle persistence and truthful explicit-halt lifecycle persistence.

#### Manual Testing Guidance

- No provider-authenticated manual review is required for this state-reconciliation task. If manual proof is attempted, use only the supported main stack and document any authentication-permitted skip without changing scope.

#### Implementation Notes

- Review Task Role: `review_finding_repair`
- This task remained incomplete until the stored review outcome became executable and no blocker was silently treated as clean; those conditions are now satisfied for Task 40.
- Subtasks 1-2: Compared both named fast-wave versioned manifests, validations, and cross-repository artifacts. Both waves preserve matching story/wave/parent/target-hash identities but remain `completed_partial` with stale Open Code coverage and singleton `not_applicable` cross-repository output, so the existing non-closeable blockers were retained; no production seam was changed.
- Historical subtask 3 blocker (resolved): the stale result originally contained the review-cycle ID instead of the active review-pass ID. The producer result was regenerated from current state, synchronization passed, and the mismatch blocker was removed without weakening pass identity validation.
- Historical Compose diagnosis (resolved): Flow G inspected the main Compose file instead of the active local variant, whose required live harness mounts had been removed. The mounts were restored, the local stack was recreated externally, and the running container now exposes the mounted consumer contract.
- Subtasks 17-18: Corrected the ownership conclusion exposed by Flow G: the active `docker-compose.local.yml`, not the already-repaired main Compose file, had lost the required live harness mounts in `3b9cec3f`. Restored the live mount contract without adding a `codeinfo_markdown` image copy, introduced a successful whole-flow exit for exhausted durable blockers so incomplete work cannot fall through into review, taught future blocker repair to inspect the active Compose variant, and verified the recreated container exposes the mounted contract.
- Testing 8: The focused server unit wrapper passed all 83 tests covering the Compose mount/count contract, active-runtime blocker prompts, flow schema, and the three canonical story-flow definitions. The first attempt exposed a missing test-local `FlowStep` field and an over-specific prompt assertion; both test defects were corrected before the clean run.
- Testing 9: The focused flow-loop integration cases passed 2/2, proving `exitFlow` skips nested and outer remaining steps while persisting terminal `ok` plus `not_applicable`, and explicit `haltFlow` persists terminal `stopped`. The initial full-file attempt proved both new cases but had one unrelated existing continue-resume timing timeout (25/26); the focused rerun was clean. The failing lifecycle assertions first exposed that terminal state was written after runtime ownership cleanup, so the implementation now persists terminal lifecycle before cleanup and reserves the outer failure handler for exceptions that prevent normal terminal persistence.
- Validation follow-up: The combined changed-seam selection passed 6/6, the flow-control Python contract passed 4/4, changed TypeScript files passed ESLint with zero warnings, all changed JSON parsed, and `git diff --check` passed. A full server-unit attempt reported 2663/2665 before the new fixture inventory expectation was updated: that inventory case now passes in isolation, while the pre-existing `continue resume keeps its boundary marker until the next iteration makes progress` case still times out when run alone and does not execute the new `exitFlow` branch.
- Historical subtask 3 follow-up (resolved): The live container exposed the restored contract while the stale terminal result still carried the cycle ID. The active-pass result was subsequently regenerated and synchronized successfully before disposition state advanced.
- Subtasks 4-7: Confirmed all four current-pass findings against their owning seams and implemented bounded repairs: explicit blank flow-run identifiers now fail admission, competing final-review initializers preserve the first active owner, malformed successful polling responses retain actionable protocol diagnostics, and retry completion persistence is retried before ownership can be released.
- Testing 1: The required server build passed after correcting a missing test-only import exposed by the first build attempt.
- Subtasks 12-13 and Testing 2: Added dedicated request-admission and deterministic competing-cycle cases; the focused wrapper passed all 33 tests and proved omitted identifiers still reach normal resolution while blank values fail, and the losing cycle initializer cannot alter the winner or its archived predecessor.
- Subtasks 15-16 and Testing 3: Preserved the existing persisted-reload replay proof and added a one-shot post-success persistence failure case. The focused wrapper passed all 66 tests, proving the durable completion retry succeeds before lock release and a replay after clearing process-local completion memory does not launch duplicate work.
- Subtask 14 and Testing 4: Added explicit successful-response shape validation at the polling fingerprint boundary while preserving the wrapper's `review_runner_failure` catch. All 13 review-cycle summary tests passed, including the separate happy path and malformed-success diagnostic.
- Subtasks 9-10 and Testing 5: Added write/rename temporary-file cleanup proof, expanded field-by-field target identity assertions, and made the three-target production loop verify target-local validation ownership plus decision-recording order. The first focused run exposed an over-strong stale-job metadata assertion because stale identities are deliberately withheld; after aligning that assertion with the non-closeable contract, all 23 tests passed.
- Subtask 11 and Testing 6: Kept the scenarios on the production flow-expansion and wave-validation seams and raised downstream ownership proof to three targets. All 9 focused Cucumber scenarios passed with target-local ownership and cross-repository coverage retained through downstream tasking.
- Subtask 3: Regenerated the terminal no-op result from the freshly read active disposition, copied the exact slow-pass identity, and synchronized it into the preserved review cycle. The audit validator now reports three valid pass audits; the producer prompt also explicitly forbids substituting a cycle or session ID for `review_pass_id`.
- Subtask 8 and Testing 7: Synchronized the active disposition and plan handoff, removed only the resolved contract, audit-mismatch, and four repaired-finding blockers, retained the three historical incomplete fast-wave coverage blockers for Task 41, preserved all 15 resolved-minor records and the active cycle, and verified Task 41 remains the sole final revalidation owner.
- Task 40 closeout: All 18 subtasks and all 9 testing items are complete. Earlier blocker-analysis notes below are retained as historical diagnosis only; their pass-mismatch conclusion is superseded by the successful active-pass regeneration and audit synchronization recorded above.
- Final Task 40 audit: Added a repository-scoped filesystem lock with stale-lock recovery around the in-process cycle-initialization queue, preserving the same winner/loser semantics across server processes, and retained HTTP status diagnostics when a non-success response also has malformed JSON. The server build, all 33 route/cycle tests, and all 13 review-runner tests passed again after these hardening changes.
- Final formatting audit: Applied Prettier to the changed TypeScript files, confirmed every changed parseable source file passes targeted Prettier checking and `git diff --check`, rebuilt the server successfully, and reran the 33 route/cycle, 66 retry/route, 23 artifact/production-loop, and 13 runner tests successfully.
- Final implementation audit: Repository diff and generated-state evidence now match all checked Task 40 work. The active-pass audit is valid, all four current-pass repairs have named proof, the three historical fast-wave coverage gaps remain explicitly assigned to Task 41, and Task 40 has no live blocker or unchecked work.

### Task 41. Re-Validate Story 64 After Review Pass 0000064-20260720T002803Z-00f835bcb0-a40ed56f

- Task Status: `__done__`
- Repository Name: `codeInfo2`
- Review Task Role: `final_revalidation`
- Prerequisite: Task 40 must be complete and its current-pass review artifacts, blocker dispositions, and disposition state must be durable before this task starts.
- Review Pass ID: `0000064-20260720T002803Z-00f835bcb0-a40ed56f`
- Review Cycle ID: `0000064-rc-20260719T212516Z-7280f8e7`

#### Overview

This is the sole final revalidation task for the active Story 64 review cycle. Revalidate the whole story, the exact current-pass `Code Review Findings` block, Task 40's repaired or explicitly incomplete review outcome, and every finding already recorded under `resolved_minor_findings` for this cycle: `829f2dbe9adb33dd2a27976ed3965d3c5f9e1c2abac8309325a94bd1cb56bbbd`, `63b72dde79951ac23ce584197326f258d12b7bada9aa81b53fff5f4b9f74594b`, `1d7b6fd25a1781d1620eb1e549d1406520b5f31b1681e050be32b72b3ce35bc1`, `632874705e890b70ad33a672f3f588a9c65fe06eaba62b5ea3c49ac6cd699909`, `f243a30a8eb7c868c137b9c0f30e0c358a01ecc64cb8cf99dd71e5bc9632dc7a`, `c175ba2d0564cd6f46d156a35714f3ad84630b51ad481bb9ffe637f6e017911a`, `0000064-startup-pending-only-wave-not-selected`, `0000064-malformed-wave-state-discarded`, `0000064-resume-state-inputs-dropped`, `0000064-wave-base-identity-not-checked`, `0000064-implicit-source-fallback-cross-binds-working-folder`, `0000064-cross-repository-stale-publication`, `0000064-cucumber-production-boundary-bypass`, `0000064-positional-second-pass-identity-proof`, and `0000064-missing-three-target-proof`. Do not create another final task for these inline fixes, and do not close the story while Task 40's review state or any listed proof is stale.

#### Non-Goals

- Do not add repositories or change approved user-facing behavior during final proof.
- Do not use targeted commands as substitutes for the required full suites.
- Do not reopen older tasks solely because a final check finds a story-caused issue in their code; repair it here when practical.

#### Addresses Findings

- Whole current-pass findings block for review pass `0000064-20260720T002803Z-00f835bcb0-a40ed56f`.
- All `resolved_minor_findings` listed in the Overview for review cycle `0000064-rc-20260719T212516Z-7280f8e7`.
- All Task 40 incomplete-review blockers, including any required cross-target proof.

#### Task Exit Criteria

- Task 40 is complete and the active disposition state agrees with the current-pass plan block.
- Every worked-on surface has passed the supported full build, applicable startup, full automated suites, matching shutdown, lint, and formatting checks in the listed order.
- The one-target and required three-target/cross-repository proof is current, and no stale review artifact or unresolved blocker is hidden by a clean-looking result.

#### Owner Map

- Administrative and implementation owner: `codeInfo2`.
- Proof scope: `codeInfo2` client, server, common workspace, review-cycle scripts, main Compose stack, target-local review flows, and the in-repository cross-repository review path.

#### Risk Ownership

- `codeInfo2` owns final diagnosis and any story-caused repair exposed by the closeout checks.
- The final task must preserve the approved behavior lock and must not close while current-cycle review evidence is incomplete.

#### Requirement-To-Proof Mapping

- Review outcome: Task 40 completion, the exact current-pass findings block, and matching disposition state; proved by Task 40's handoff testing item and the final task's prerequisite that Task 40's state is durable before closeout.
- Server/common build: the supported server/common build in Testing item 1 proves the affected server and shared workspace compile before runtime or suite proof.
- Client build: the supported client build in Testing item 2 proves the client workspace remains buildable.
- Runtime lifecycle: Compose build and supported main-stack startup in Testing items 3-4, followed by matching shutdown in item 6, prove the runnable review surfaces use the supported environment.
- Full automated coverage: Testing item 5's `npm run test:summary:all:parallel` proves the full client, server unit/integration, Cucumber, and Playwright end-to-end suites, including the current review-cycle surfaces.
- Static quality: Task 41's lint and formatting subtasks and Testing items 7-8 prove the supported repository lint and formatting checks after runtime and full-suite proof.
- Story closeout behavior: the final automated suite plus the Manual Testing Guidance prove one-target cancellation/resume and terminal recovery, then three-target expansion, isolated artifacts, and cross-repository handoff; no targeted command substitutes for the final wrapper.

#### Proof Mapping

- Client and server workspaces: `npm run build:summary:client`, `npm run build:summary:server`, and `npm run test:summary:all:parallel`.
- Review-wave runtime and cross-target path: main Compose stack, server unit/integration, server Cucumber, and Playwright e2e coverage.
- Static quality: repository `npm run lint` followed by `npm run format:check`.

#### Affected Repositories

- `codeInfo2` only. `current-plan.json` declares no additional repositories; cross-target compatibility proof is therefore a proof surface inside this repository, not a second implementation owner.

#### Documentation Locations

- Canonical plan: `planning/0000064-users-can-review-every-story-repository-in-one-parallel-wave.md`.
- Active review handoff and state: `codeInfoTmp/reviews/0000064-current-review.json` and `codeInfoStatus/flow-state/review-disposition-state.json`.

#### Subtasks

Final-task repair scope: this task owns whole-story validation. If lint, formatting, or testing exposes a story-caused issue in code implemented by any earlier task, fix it within this final task when practical and rerun the affected checks. Do not reopen an older task solely to own that repair.

1. [x] In `codeInfo2`, run `npm run lint` and fix issues.
2. [x] In `codeInfo2`, run `npm run format:check` and fix issues.

#### Testing

Final-task repair scope: the whole approved story is in scope for failures found by these checks. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected check. Do not reopen older tasks solely because their implementation is implicated.

1. [x] In `codeInfo2`, run `npm run build:summary:server` for the server/common workspaces.
2. [x] In `codeInfo2`, run `npm run build:summary:client` for the client workspace.
3. [x] In `codeInfo2`, run `npm run compose:build:summary` for the supported main stack.
4. [x] Start the supported main stack with `npm run compose:up`.
5. [x] Run `npm run test:summary:all:parallel`, covering the full client suite, full server unit/integration suite, full server Cucumber suite, full Playwright end-to-end suite, and every Task 40 proof surface for the whole current review-created findings block: versioned artifact identity, multi-target cross-repository coverage, stale publication ordering, request admission, active-cycle ownership, malformed status classification, retry persistence/replay, and plan/disposition handoff.
6. [x] Stop the supported main stack with `npm run compose:down` after all runtime proof.
7. [x] In `codeInfo2`, run `npm run lint`.
8. [x] In `codeInfo2`, run `npm run format:check`.

#### Manual Testing Guidance

- Use the supported main stack, started with `npm run compose:build` followed by `npm run compose:up`, for browser-visible proof. It loads `server/.env` and `server/.env.local` for the server and `client/.env` and `client/.env.local` for the client; do not invent credentials or alter those ownership boundaries.
- Wait for the server readiness endpoint at `http://localhost:5010/health` and the client at `http://localhost:5001` before testing. The supported stack exposes server-side runtime ports 5010-5013 and the Playwright MCP service on port 8932; use the documented runtime handoff if readiness or service ownership differs.
- Use the mounted runtime namespace when reasoning about proof: repository `codeinfo_markdown` is mounted read-only at `/app/codeinfo_markdown`, the supported agent catalogs come from `manual_testing/codeinfo_agents` and `manual_testing/codex_agents`, the working-folder mount is `/data` from `CODEINFO_HOST_INGEST_DIR` (default `/tmp`), and server logs are under `/app/logs`. The supported seed/setup source is `./copilot`, mounted read-only at `/seed/copilot`.
- Verify one-target cancellation/resume and terminal Send recovery, then use the story's available multi-target fixtures or target catalog to verify three-target fast-wave expansion, isolated target artifacts, and the cross-repository finding handoff without adding another repository. Keep these scenarios manual-only; do not add them as automated `Testing` checklist items or substitute targeted checks for the full automated suite.
- On the `/flows` workspace, make the one-target and three-target proof observable in the parent and child conversation surfaces: confirm the parent row's `Wave <completed-or-not-applicable>/<expected>` chip and its running/failed/stopped/not-applicable breakdown, confirm each repeated child-flow row includes its target alias in the title, and after cancellation/resume confirm the transcript's `Stopped` state is terminal while the composer control returns to an enabled `Send`. Treat these as the UI contract implemented across `client/src/components/chat/ConversationList.tsx`, `client/src/pages/FlowsPage.tsx`, and `client/src/components/workspace/composer/ComposerSendButton.tsx`.
- Repeat the visible-state confirmation at a 390px-wide mobile viewport: use `Open conversations` to reveal the flow list, keep the target-qualified rows and wave chip legible, and confirm the 32px composer Send control remains reachable without horizontal overflow. The mobile shell seam is `client/src/components/workspace/WorkspaceMobileTopBar.tsx`; do not fold unrelated sidebar or navigation work into this task.
- If screenshots are needed, first capture them with a relative staging path under `/tmp/playwright-output/<relative-path>` in the Playwright MCP runtime. For the codeInfo2 local harness workflow, look first under `$CODEINFO_ROOT/playwright-output-local/<relative-path>`, then transfer the artifact to the target-relative `codeInfoTmp/manual-testing/0000064/41/` destination; inspect runtime handoff JSON by meaning for the actual source, fallback runtime, and destination. If transfer remains blocked, record that limitation honestly rather than treating it as a reason to halt the proof loop.
- Authentication-dependent provider actions may be skipped only under the repository's documented authentication guidance; record the skip and do not attempt autonomous re-authentication.

#### Implementation Notes

- Review Task Role: `final_revalidation`
- This task owns final proof for the whole story and the active review cycle; it does not complete until all required proof is current.
- Subtask 1: Ran `npm run lint`; ESLint completed successfully with zero warnings or errors, so no lint repairs were needed.
- Subtask 2: Ran `npm run format:check`; all tracked supported files matched Prettier style, so no formatting repairs were needed.
- Implementation audit: Audited the current implementation-only diff against Story 64's acceptance criteria and the behavior lock. The two subtasks remain complete from the recorded lint and format evidence; no Testing item was marked because the required build, runtime, full-suite, and manual proof are still pending. The changed request-admission, review-cycle ownership, retry persistence, malformed-status, artifact-identity, and production-closeout seams are story-owned review-wave work with matching test coverage, and no story-caused unapproved preserved-behavior drift was identified. Task 41 remains `__in_progress__`, has no live blocker, and is ready for automated proof.
- Testing item 1: Ran `npm run build:summary:server`; the server/common build passed with zero warnings.
- Testing item 2: Ran `npm run build:summary:client`; typecheck and Vite build passed. The wrapper reported one existing large-chunk warning, with no build failure.
- Testing item 3: Ran `npm run compose:build:summary`; both supported main-stack images built successfully with zero failed items.
- Testing item 4: Started the supported main stack with `npm run compose:up`; all declared services started and server/client health gates completed successfully.
- **RESOLVED ISSUE** At the focused-proof stage, Testing item 5 was still incomplete pending a fresh full-suite run. The focused loop-resume wrapper reproduced a stopped continuation that persisted its marker but discarded the active loop frame, so the next resume skipped the new iteration. Preserving that frame through the non-`ok` unwind restored the boundary contract; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --test-name "continue resume keeps its boundary marker until the next iteration makes progress"` passed.
- Testing item 6: Ran `npm run compose:down` after the failed full-suite attempt; the supported main stack was stopped for cleanup.
- Testing item 5: Ran `npm run test:summary:all:parallel`; all prerequisite builds and full suites passed: client 900/900, server unit 2669/2669, server Cucumber 138/138, and Playwright end-to-end 77/77.
- Testing item 7: Ran `npm run lint`; ESLint completed successfully with zero warnings or errors.
- Testing item 8: Ran `npm run format:check`; all tracked supported files matched Prettier style.
- Automated-proof audit: Audited the implementation and automated-proof evidence against the final-task lifecycle and behavior lock. The stopped-resume loop-frame repair is within Story 64's explicit cancellation/resume acceptance criterion, and the fresh full parallel suite passed across client (900/900), server unit (2669/2669), server Cucumber (138/138), and Playwright end-to-end (77/77), followed by successful lint and format checks. All subtasks and Testing items are complete, no live blocker remains, and Task 41 is honestly `__done__`; the checkbox-free Manual Testing Guidance remains available for the subsequent manual-testing pass.
- Preflight visual refinement: inspected the Story 64 Flow workspace at desktop and 390px mobile widths; clarified the parent wave-count, target-qualified child-title, terminal stopped-to-Send, and mobile composer seams in manual-proof guidance. No code was changed in this step.
- Manual proof: Expanded to full-story proof because Task 41 is final and fully checked. Restarted the stale main stack with `npm run compose:build` and `npm run compose:up`, confirmed `:5010/health` and `:5001`, and shut it down cleanly with `npm run compose:down`. Fresh UI hydration showed the one-target terminal `Stopped` state with enabled `Send`, and the persisted three-target proof showed seven prepared jobs across three targets, `Wave 7/7`, and successful wave validation; the referenced primary and two additional fixture worktrees still exist. At 390px the Flow shell had no horizontal overflow and the 32px Send control remained reachable; console warnings/errors were absent. Screenshot capture was attempted with Playwright staging `manual-testing/0000064/41/proof-01-one-target-stopped-send.png` and the task scratch destination `codeInfoTmp/manual-testing/0000064/41/`, but the Playwright runtime rejected the nested staging path and Chrome denied the target-repository path, so no retained screenshot was saved; this did not reveal a task-owned failure or require new subtasks.

### Task 42. Make Review Cycles Independent From Flow Executions

- Task Status: `__done__`
- Repository Name: `codeInfo2`

#### Overview

Remove durable review-state ownership by ephemeral flow execution IDs. A review cycle, wave, pass, target, and reviewed commit identify review work; concurrent top-level story flows are explicitly unsupported and do not require ownership negotiation. Preserve best-effort flow execution while preventing failed or incomplete review cycles from being reported as clean closeout.

#### Non-Goals

- Do not add locking, leasing, joining, or conflict resolution for concurrent top-level story flows.
- Do not remove runtime execution IDs from conversation/runtime diagnostics.
- Do not weaken cycle, wave, target, repository, or commit identity validation.

#### Task Exit Criteria

- Newly written durable review artifacts do not use a parent flow execution ID as ownership or validation identity.
- A stale or orphaned prior review cycle cannot block a new final review cycle.
- Review initialization and reviewer failures continue best-effort, but incomplete review cannot produce a clean no-findings closeout.
- Successful convergence and the five-pass limit route through the same final review-tasking outcome.

#### Subtasks

1. [x] Replace parent-execution ownership in review lifecycle initialization with durable review-cycle state.
2. [x] Replace parent-execution artifact joins with cycle, wave, pass, target, and commit identity.
3. [x] Add explicit cycle-level status for in-progress, completed, and incomplete review outcomes, while retaining a separate initialization-failure handoff.
4. [x] Gate post-review tasking and clean closeout on the current cycle's durable completion state while preserving best-effort flow continuation.
5. [x] Update review prompts, helpers, schemas, and legacy-read behavior to match the execution-independent contract.
6. [x] Add regression coverage for stale cycles, initialization/reviewer failure, clean convergence, iteration-limit convergence, and cross-cycle artifact rejection.

#### Testing

1. [x] Run focused server review lifecycle, review wave, production-loop, and subflow integration tests.
2. [x] Run focused Python review flow-control and publisher tests.
3. [x] Run `npm run build:summary:server`.
4. [x] Run `npm run build:summary:client`.
5. [x] Run `npm run test:summary:all:parallel`.
6. [x] Run `npm run lint`.
7. [x] Run `npm run format:check`.

#### Implementation Notes

- Task opened after run J exposed that an orphaned run G execution still owned `active-review-cycle.json`, preventing any reviewer from launching while the best-effort parent continued into clean closeout.
- Testing item 3: `npm run build:summary:server` passed after removing execution ownership from the production review lifecycle and updating the compiled TypeScript fixtures.
- Testing item 3 final rerun: the server summary build passed again after cycle-aware reviewer scope propagation and best-effort subflow outcome recording were complete.
- Testing item 2: `python3 -m unittest scripts.test.test_review_prompt_contracts scripts.test.test_publish_open_code_review scripts.test.test_flow_control_review` passed all 86 focused Python contract, publisher, and review-control tests after adding completed-cycle closeout assertions.
- Testing item 1: Focused server wrappers passed 5 review-cycle lifecycle tests, 10 review-wave validation tests, 2 production-loop tests, and all 56 subflow integration tests, including the orphaned G-style cycle, failed-review best-effort, and incomplete-story skip regressions.
- Testing item 1 regression rerun: Fixed four legacy wave fixtures that omitted `review_cycle_id`; all 46 review-artifact tests and both production-loop tests then passed with the semantic cycle contract.
- Subtask 1: Removed execution ownership and initialization locks; every eligible final review now creates a fresh cycle, archives prior disposition state, and replaces stale active state atomically.
- Subtask 2: Removed parent execution from durable review schemas and joins, carrying `review_cycle_id` through targets, prepared bases, reviewer pointers, review sets, cross-repository results, and wave validation instead.
- Subtask 3: Added durable `in_progress`, `completed`, and `incomplete` cycle status with completion time and an optional incomplete reason.
- Subtask 4: Kept subflows best-effort while making their parent record two-phase review completion before post-review routing; task generation now recovers incomplete review and clean closeout requires a completed cycle with no initialization failure.
- Subtask 4 final audit: A `not_applicable` child outcome now remains a true skip and leaves older cycle evidence unchanged, rather than being mistaken for a successful completed review.
- Subtask 5: Updated TypeScript, Python, and prompt contracts to ignore legacy execution fields, stop writing them, and validate semantic review identity instead.
- Subtask 6: Added regressions for the orphaned G-to-J handoff, failed-review continuation, cycle finalization, cycle-aware artifact validation, prompt closeout gates, and execution-free writers; existing convergence and five-pass flow-control coverage remains authoritative for identical exit routing.
- Testing item 4: `npm run build:summary:client` passed typecheck and production build; the wrapper reported only the existing large-chunk advisory.
- Testing item 5: The final `npm run test:summary:all:parallel` run passed client 900/900, server unit 2673/2673, server Cucumber 138/138, and e2e 77/77 on the exact completed implementation. An earlier attempt hit an unrelated temporary-directory cleanup race and one transient `ERR_NETWORK_CHANGED`; both failed cases passed targeted reruns before subsequent clean full-suite runs.
- Testing item 6: `npm run lint` passed after the new best-effort subflow regressions were strengthened to assert that their parent conversations reach terminal `ok`; the focused subflow suite subsequently passed 56/56 with the incomplete-story skip case.
- Testing item 7: `npm run format:check` passed; all tracked files matched the repository's Prettier formatting rules.
- Automated-proof audit: All six implementation subtasks and seven automated checks are complete on the committed implementation; the latest proof-only commit changed only this plan's formatting checkbox and note. No story-caused preserved-behavior regression or out-of-scope user-facing drift was found, so Task 42 is complete and ready for the separate manual-testing pass.
- Manual testing: Full-story proof restarted the previously stopped main Compose stack, then ran `two_phase_review_cycle` against the current Story 64 plan. The UI showed fresh cycle `0000064-rc-20260720T224551Z-3987c485`, one immutable target, and a three-job fast wave despite prior historical cycles; the supported Stop control then produced a visible/API `stopped` wave outcome (`failed 1`, `stopped 1`, `not applicable 1`) rather than clean no-findings closeout. The transcript remained readable at 390px, and the main stack passed `/health` plus UI checks before clean shutdown; no additional subtasks were needed. Playwright captured `proof-01-fresh-cycle-stopped-wave.png` in its runtime, but the documented harness bind was unavailable, so no screenshot could be transferred into `codeInfoTmp/manual-testing/0000064/42/`.

## Code Review Findings

- Review pass: `0000064-20260720T225340Z-94ba2b5d05-679531ae`
- Review cycle: `0000064-rc-20260720T225340Z-6831b239`
- Comparison context: local `HEAD` `94ba2b5d05180e55a0bdd22a0e28e8130c7291a9` versus resolved base `origin/main@00ced5bb15524d12395dfc5c0d427b3c65eb7f97` from the stored review handoff, with comparison rule `local_head_vs_resolved_base`, resolved base source `remote`, and remote fetch status `success`.
- Wave coverage and target ownership: the fast wave expected 3 jobs and completed 2, with 1 failed/stale job; the usable Codex Review result belongs to target owner `current_repository`, Open Code Review was stale and unusable, and the required cross-repository result was `not_applicable`. The validated wave has `closeout_allowed: false`, so the incomplete coverage blocker remains outside the issue decisions.
- Severity conflicts: the validated aggregate contains 5 findings and zero severity-conflict records; each accepted finding has one validated `Codex Review` source for `current_repository`.
- Confidence note: only the usable Codex aggregate supplied accepted findings for this pass. No separate current-pass rejected or non-adopted candidate with a safe artifact source reference was recorded; the incomplete coverage state is not treated as an accepted or ignored issue.

### Accepted

#### 1. OCR publication rejects the required `planning/**` exclusion

- Finding ID: `2b9e2ecc862d6c13e4a7d977b455a6a23afdb3af182ff637a071b178c993bbe8`
- Found by: Codex Review
- Description: Open Code Review publication compares bundled files with tracked files but does not honor the prepared review context's `planning/**` exclusion.
- Example: A story branch with tracked plan changes can be rejected as missing files during OCR publication even though `planning/**` was intentionally excluded from the review bundle.
- Why accepted: This is a current-pass, target-owned review artifact defect within Story 64's review publication and artifact pipeline. It remains bounded to the existing publisher seam and its focused proof.

#### 2. Resuming a cancelled wave skips all stopped children

- Finding ID: `5603bf600021aca98871a81694cd179cf3be2b82faf0068a1b7b3bf3fb7d7c40`
- Found by: Codex Review
- Description: Wave resume treats remembered stopped children as already handled and can finish without rerunning unfinished reviews.
- Example: After cancellation, a stopped child is present in the recovered execution; resume skips it, observes no incomplete children, and returns `ok` without performing that review.
- Why accepted: Cancellation and resume behavior is an explicit Story 64 acceptance criterion. The finding is target-owned and bounded to the existing wave-resume seam and focused integration proof.

#### 3. Diagnostic waves cannot produce usable target validations

- Finding ID: `ef304e0a4692d1bb1931fd6b227df9b0a48302dde0d2ef01eb5beb41d3be6fb6`
- Found by: Codex Review
- Description: Wave-target validation requires a review cycle ID even for diagnostic initialization, which intentionally has no final review cycle.
- Example: Diagnostic Codex or Open Code results fail with `Prepared wave-target review scope is incomplete` while the diagnostic flow itself can finish.
- Why accepted: Diagnostic wave identity and per-review validation are Story 64-owned review metadata. The finding was promoted for one honest inline attempt before task-up; its original shared-metadata and coordinated-contract constraints remain in force.

#### 4. Diagnostic runs can overwrite an active final cycle's artifacts

- Finding ID: `5f43331c587c485f40af99fbc0d1f5ea244f4dd332eeeba8178cf673498f19c3`
- Found by: Codex Review
- Description: Diagnostic target preparation can inherit the active final cycle and publish newer pointers that make the real final wave stale.
- Example: A diagnostic run overlaps an in-progress final review, reads the final cycle identity, and promotes its target or review-set pointers over the final wave's artifacts.
- Why accepted: Preventing diagnostic work from corrupting final cycle, wave, and target artifact identity is within Story 64's artifact-isolation contract. The finding was narrowed to that core and promoted for one honest inline attempt; the plan's non-goal against concurrent ownership negotiation excludes locking or conflict-resolution redesign.

#### 5. The standalone review wrapper never finalizes its cycle

- Finding ID: `a5aee94e7e31e4d4999e85dea93176316a5647f82cf851b96677145b2c6e69d9`
- Found by: Codex Review
- Description: Direct use of the standalone review wrapper can report terminal success without finalizing the durable active review cycle.
- Example: The wrapper observes a successful `two_phase_review_cycle`, returns success, and leaves `active-review-cycle.json` in `in_progress` because no parent flow performs finalization.
- Why accepted: Review-cycle execution and durable completion are part of Story 64's review-loop behavior. This target-owned wrapper issue has a bounded resolution and focused proof path.

### Ignored for This Story

- None.

### Task 43. Record Minor Review Fixes From Pass 0000064-20260720T225340Z-94ba2b5d05-679531ae

- Task Status: `__done__`

#### Overview

This completed audit records the terminal inline outcomes for this review pass.

Escalated review items requiring combined task-up:

- `5f43331c587c485f40af99fbc0d1f5ea244f4dd332eeeba8178cf673498f19c3` — Diagnostic runs can overwrite an active final cycle’s artifacts. (`current_repository`). Found by: Codex Review Task coverage: Pending combined task-up after slow-phase finalization.
- `ef304e0a4692d1bb1931fd6b227df9b0a48302dde0d2ef01eb5beb41d3be6fb6` — Diagnostic waves lack an independent review-cycle identity, so target snapshots either omit required wave identity or inherit the active final cycle. (`current_repository`). Found by: Codex Review Task coverage: Pending combined task-up after slow-phase finalization.

#### Subtasks

1. [x] Fixed `2b9e2ecc862d6c13e4a7d977b455a6a23afdb3af182ff637a071b178c993bbe8` — OpenCode publication now honors prepared review exclusions, accepting excluded committed paths and rejecting excluded manifest entries. (`current_repository`); modified `scripts/publish_open_code_review.py`, `scripts/test/test_publish_open_code_review.py`.
2. [x] Fixed `a5aee94e7e31e4d4999e85dea93176316a5647f82cf851b96677145b2c6e69d9` — The new standalone review wrapper now finalizes the final review cycle it initialized. (`current_repository`); modified `server/src/flows/service.ts`, `server/src/test/integration/review-production-loop.test.ts`.

#### Testing

1. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/review-production-loop.test.ts` in `current_repository` — passed. The focused server integration wrapper passed both production-loop cases, including the new durable completed-cycle assertion.
2. [x] `python3 -m unittest scripts/test/test_publish_open_code_review.py` in `current_repository` — passed. 19 focused publisher tests passed, including regression coverage for planning/** exclusions.

#### Implementation Notes

- Review Task Role: `minor_fix_loop_audit`
- Review Cycle Id: `0000064-rc-20260720T225340Z-6831b239`
- Review Pass Id: `0000064-20260720T225340Z-94ba2b5d05-679531ae`
- Review Phase: `fast`
- This task is a completed historical audit and does not replace final story revalidation.

## Code Review Findings

- Review pass: `0000064-20260721T002105Z-bde9e15d38-b68efb0a`
- Review cycle: `0000064-rc-20260720T225340Z-6831b239`
- Comparison context: local `HEAD` `bde9e15d38d8701e8bec359c6755a0d733ca45d5` versus resolved base `origin/main@00ced5bb15524d12395dfc5c0d427b3c65eb7f97` from the stored review handoff, with comparison rule `local_head_vs_resolved_base`, resolved base source `remote`, and remote fetch status `success`.
- Wave coverage and target ownership: the fast wave expected 3 jobs; 2 terminal outcomes completed and 1 target-local reviewer failed or remained stale. The usable target-local result came from Codex Review for `current_repository`; Open Code Review was unusable, and the singleton cross-repository result was `not_applicable`. Current-pass findings are owned by `current_repository` at `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2`; closeout remains disallowed because coverage is incomplete.
- Severity conflicts: the validated aggregate records zero current-pass severity conflicts; both current-pass routed candidates have one Codex Review source with severity `P1`. The review handoff has no findings file, so no additional conflict metadata was available.
- Provenance note: preserved same-cycle task-required findings `ef304e0a4692d1bb1931fd6b227df9b0a48302dde0d2ef01eb5beb41d3be6fb6` and `5f43331c587c485f40af99fbc0d1f5ea244f4dd332eeeba8178cf673498f19c3` belong to the earlier review pass and are not repeated as decisions for this current pass.

### Accepted

#### 1. Diagnostic review-wave validation cannot publish usable results

- Finding ID: `23b8db3c7f1ee97697d0ff6ec7ba5cb95082155ff47ba3b3183789297c154eed`
- Found by: Codex Review
- Description: Diagnostic review-wave results cannot become usable when the diagnostic cycle, wave, target, and artifact identity required by validation and publication is incomplete.
- Example: `review:diagnostic:summary` can report success with zero usable reviewers after an invalid finalized manifest is rejected during joined validation.
- Why accepted: The final routed reason narrows this to the diagnostic identity and validation/publication contract explicitly accepted in Story 64. It is owned by `current_repository`; broader diagnostic redesign and user-facing behavior changes remain excluded.

### Ignored for This Story

#### 2. Concurrent top-level review-cycle finalization can corrupt another cycle

- Finding ID: `ab0cbbf7b19f528164b50ac9bb407de01e5cbbf8f19862abd0ee0bc4e360a65d`
- Found by: Codex Review
- Description: Concurrent top-level review cycles could overwrite or finalize another cycle's shared state.
- Example: Run A can start, run B can replace the active cycle, and A can then finalize B's state as completed or incomplete.
- Why ignored: Task 42 explicitly excludes locking, leasing, joining, conflict resolution, and ownership negotiation for concurrent top-level story flows. The proposed compare-and-swap or repository-level ownership work would materially expand Story 64 scope; it is ignored for this story.
