# Story 0000064 - Parallel subflows

## Description

The flow engine currently supports a `subflow` step that launches one child flow, waits for it to finish, and then resumes the parent flow. This story extends that contract so one `subflow` step can launch multiple child flows in parallel and wait for all of them to reach a terminal state before the parent continues.

This story intentionally does not preserve the old single-string `flowName` contract because the repository does not currently use it. The new `subflow` shape should therefore require an array-based contract, keep the runtime design simple, and reuse the existing child-flow ownership, resume, stop, and cycle-detection behavior wherever possible.

Nested subflows must continue to work. Each flow conversation should track only its direct child subflows, while deeper descendants continue to be tracked by their immediate parent flow conversations. Final validation must also confirm that the main Docker Compose stack still builds and runs successfully after the change.

## Acceptance Criteria

- Flow schema validation requires `subflow` steps to use a non-empty `flowNames` string array.
- The flow runner launches all child flows listed in a `subflow` step and waits for every child to finish before resuming the parent flow.
- Parent flow stop requests cascade to every still-running child flow for the active parallel `subflow` step.
- Resume reattaches to already-running child subflows for the active step instead of launching duplicate child runs.
- Stale remembered child subflows fail the parent step explicitly when they have no active run and no terminal result.
- Nested subflows continue to work by tracking direct children recursively per flow conversation rather than flattening the whole descendant tree into one parent state blob.
- Duplicate flow names inside one `subflow` step are rejected for v1.
- Automated server proof covers successful, failed, stopped, resumed, nested, and cycle-detection parallel-subflow scenarios.
- The repository-supported Compose stack build and startup wrappers succeed after the implementation lands.

## Out Of Scope

- Adding a new flow-step type distinct from `subflow`.
- Preserving compatibility with the unused `flowName` single-string contract.
- Changing the REST flow-run request payload shape.
- Redesigning transcript UX beyond the runtime metadata already emitted today unless the new runtime behavior forces a minimal correction.

## Additional Repositories

- No Additional Repositories

## Questions

None. The implementation direction is fixed: replace the unused singular subflow contract with a required array-based contract and wait for all launched children before continuing.

## Decisions

1. Subflow contract
   - The question being addressed: Should the new behavior preserve the old single-flow shape or replace it?
   - Why the question matters: Compatibility work would add validation and executor branching even though the repository does not currently use the old shape.
   - What the answer is: Replace the current singular `flowName` contract with a required `flowNames` array contract.
   - Where the answer came from: User direction during this implementation discussion.
   - Why it is the best answer: It keeps the implementation smaller, the schema clearer, and the executor free from compatibility branches.
2. Child tracking model
   - The question being addressed: Should a parent flow track the full recursive subflow tree or only its direct children?
   - Why the question matters: Recursive snapshots would complicate persistence, resume, and stop propagation significantly.
   - What the answer is: Each flow conversation tracks only its direct child subflows, while nested child flows track their own direct children recursively.
   - Where the answer came from: Existing subflow architecture plus the implementation discussion.
   - Why it is the best answer: It composes naturally with the existing flow ownership model and keeps state local to each flow conversation.
3. Aggregate outcome rule
   - The question being addressed: How should one parent `subflow` step resolve mixed child outcomes?
   - Why the question matters: The parent flow must reduce multiple child terminal states into one deterministic parent step result.
   - What the answer is: The parent step fails if any child fails, otherwise stops if any child stops, otherwise succeeds only when all children succeed.
   - Where the answer came from: Implementation discussion.
   - Why it is the best answer: It is conservative, deterministic, and easy to explain and test.

## Message Contracts And Storage Shapes

- Flow step schema:
  - Old shape to remove:
    - `{ "type": "subflow", "label"?: string, "flowName": string }`
  - New required shape:
    - `{ "type": "subflow", "label"?: string, "flowNames": string[] }`
- Resume state:
  - Replace `activeSubflow` with `activeSubflows`.
  - Each entry stores only direct child identity:
    - `stepPath`
    - `flowName`
    - `conversationId`
    - `runToken`
    - optional `title`

## Edge Cases And Failure Modes

- Reject empty `flowNames` arrays during flow-schema validation.
- Reject duplicate flow names inside one `subflow` step during flow-schema validation.
- Persist parent resume state after each child launch so a crash between launches does not lose already-started child ownership.
- On resume, fail explicitly when a remembered child conversation has neither an active run nor a terminal assistant result.
- When a parent stop request arrives while some children are already terminal and others are still running, stop every still-running child and keep the parent result as `stopped`.
- Preserve existing cycle detection for recursive flow references.

# Tasks

### Task 1. Replace the singular subflow contract with a parallel child-tracking model

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__done__`
- Git Commits: `38d7b3d6`

#### Overview

This task replaces the old unused single-child `subflow` shape with the new required array-based contract and updates the persisted parent flow state so direct child subflows can be tracked as a list. It belongs first because the executor and tests need a stable schema and runtime state shape before they can implement fan-out and resume behavior.

#### Task Exit Criteria

- Flow schema parsing accepts only `subflow` steps that provide a non-empty `flowNames` array with no duplicates.
- Flow resume state stores `activeSubflows` instead of `activeSubflow`, and the runtime can parse and persist that list shape.

#### Documentation Locations

- No external documentation is required; this task is defined by the existing local flow runtime contracts.

#### Subtasks

1. [x] Read `AGENTS.md`, this story plan, `server/src/flows/flowSchema.ts`, `server/src/flows/flowState.ts`, and the flow resume-state parse/persist helpers in `server/src/flows/service.ts` so the schema and persisted state changes match the current runtime design.
2. [x] Update `server/src/flows/flowSchema.ts` so `FlowSubflowStep` requires `flowNames: string[]`, the Zod schema enforces a non-empty array of trimmed names, and duplicate names inside one step are rejected with a clear validation failure.
3. [x] Update `server/src/flows/flowState.ts` and the related parse/persist/runtime-copy helpers in `server/src/flows/service.ts` so `activeSubflow` becomes `activeSubflows` and each entry preserves `stepPath`, `flowName`, `conversationId`, `runToken`, and optional `title`.
4. [x] Update any flow-runtime helpers or local types that still assume one active subflow so later executor work can consume the plural state without compatibility branches.
5. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` first when safe.
6. [x] Run `npm run format` followed by `npm run format:check` for this task's surface and fix any remaining formatting issues.

#### Testing

1. [x] Run `npm run test:summary:server:unit` after the schema and state-shape changes land to confirm the server test harness still loads the updated contracts.
2. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` first when safe.
3. [x] Run `npm run format:check` for this task's surface and fix any issues found, using `npm run format` first when needed.

#### Implementation notes

- 2026-06-23: Marked Task 1 in progress and created the story plan on `manual_work/0000022-parallel-subflows` so the schema, state, executor, proof, and compose-validation work can be tracked under the repository workflow.
- 2026-06-23: Replaced the unused singular `subflow` contract with required `flowNames`, added duplicate-name rejection in the schema, and pluralized persisted parent child-tracking state to `activeSubflows`.
- 2026-06-23: Focused server wrapper proof passed for `server/src/test/unit/flows-schema.test.ts` and `server/src/test/integration/flows.run.subflow.test.ts`, and repo `lint`, `format`, and `format:check` completed cleanly for the touched surface.

---

### Task 2. Implement parallel subflow execution, stop propagation, and resume fan-in

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__done__`
- Git Commits: `38d7b3d6`

#### Overview

This task changes the subflow executor from a one-child blocking wait to a multi-child fan-out and wait-for-all join. It must also preserve the existing ownership, stop, and cycle-detection mechanics while applying them consistently to every direct child in the active step.

#### Task Exit Criteria

- The executor launches all child flows in a `subflow` step, persists their identities, waits for all terminal states, and resolves the parent step with the agreed aggregate rule.
- Parent stop and resume both work correctly for parallel and nested subflow scenarios without launching duplicate children.

#### Documentation Locations

- No external documentation is required; the existing local flow execution code defines the relevant runtime seams.

#### Subtasks

1. [x] Read this story plan plus the subflow execution, child-status polling, stop handling, cycle detection, and async launcher code in `server/src/flows/service.ts`, including `runSubflowStep(...)`, `getFlowConversationTerminalStatus(...)`, and `startFlowRun(...)`.
2. [x] Refactor `runSubflowStep(...)` in `server/src/flows/service.ts` so it launches one child run per `flowNames` entry, persists `activeSubflows` after each successful launch, and waits for every direct child conversation to reach a terminal result before returning control to the parent flow.
3. [x] Update resume logic in `server/src/flows/service.ts` so the active step reattaches to remembered child runs for the same `stepPath`, skips relaunching already-running children, and fails explicitly when any remembered child is stale.
4. [x] Update stop handling in `server/src/flows/service.ts` so a parent stop request fans out to every still-running child subflow for the active step and keeps the parent result deterministic when some children are already terminal.
5. [x] Preserve the existing recursive flow cycle detection and immediate-parent-only tracking model while adapting any helper code that still assumes one active child.
6. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` first when safe.
7. [x] Run `npm run format` followed by `npm run format:check` for this task's surface and fix any remaining formatting issues.

#### Testing

1. [x] Run `npm run test:summary:server:unit` after the executor changes land to prove the updated runtime behavior with the full server unit and integration wrapper.
2. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` first when safe.
3. [x] Run `npm run format:check` for this task's surface and fix any issues found, using `npm run format` first when needed.

#### Implementation notes

- 2026-06-23: Reworked `runSubflowStep(...)` into a fan-out and join flow that launches one child per `flowNames` entry, persists each child launch immediately, waits for every child to reach terminal state, and reduces the final result with the story's conservative aggregate-status rule.
- 2026-06-23: Stop propagation now fans out to all direct children for the active step, and resume avoids launching missing children when a pending parent stop is already queued.
- 2026-06-23: The broad `npm run test:summary:server:unit` wrapper reached the end of the suite and failed only in unrelated `server/src/test/integration/flows.run.working-folder.test.ts` and `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts` cases outside the subflow files touched in this story.

---

### Task 3. Extend automated proof for parallel, resumed, nested, and failure-path subflows

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2`
- Task Status: `__done__`
- Git Commits: `38d7b3d6`

#### Overview

This task expands the existing subflow integration coverage so the new parallel contract is protected end to end. It belongs after the runtime changes because the tests need the final aggregate rules, stop behavior, and resume shape to be stable.

#### Task Exit Criteria

- Automated server proof covers successful, failed, stopped, resumed, nested, stale, and recursive-cycle parallel-subflow behavior.
- Existing subflow test helpers and fixtures remain readable enough to support future maintenance.

#### Documentation Locations

- No external documentation is required; the existing local integration harness is the source of truth for proof structure.

#### Subtasks

1. [x] Read `server/src/test/integration/flows.run.subflow.test.ts` and any directly related helpers it uses so the new proof stays aligned with existing subflow harness conventions.
2. [x] Update `server/src/test/integration/flows.run.subflow.test.ts` to cover parallel subflow success, aggregate failure, aggregate stop, wait-for-slowest-child behavior, post-join parent continuation, parent stop fan-out, stale resume, nested subflows, and recursive cycle detection under the new `flowNames` contract.
3. [x] Update any test helpers or inline flow fixtures in `server/src/test/integration/flows.run.subflow.test.ts` that still build singular `subflow` steps so the whole test file exercises the new array-based shape consistently.
4. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` first when safe.
5. [x] Run `npm run format` followed by `npm run format:check` for this task's surface and fix any remaining formatting issues.

#### Testing

1. [x] Run `npm run test:summary:server:unit` and confirm the parallel-subflow scenarios pass within the repository-supported wrapper.
2. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` first when safe.
3. [x] Run `npm run format:check` for this task's surface and fix any issues found, using `npm run format` first when needed.

#### Implementation notes

- 2026-06-23: Converted the existing subflow proof file to the new array contract, added helper coverage for active child arrays, and added focused scenarios for parallel success, aggregate failure, stop fan-out, nested recursion, and duplicate-name schema rejection.
- 2026-06-23: The focused server wrapper passed all 61 selected schema and subflow tests after the new parallel waits were adjusted to observe the full child set before asserting counts.

---

### Task 4. Final Story Validation And Close-Out

- Repository Name: `Current Repository`
- Task Dependencies: `1, 2, 3`
- Task Status: `__done__`
- Git Commits: `38d7b3d6`
- Notes: This final validation task depends on the runtime, schema, and automated proof work completing first.

#### Overview

This task validates the whole story against the acceptance criteria and confirms that the main Compose stack still builds and starts successfully after the parallel subflow work lands. It also closes out the branch with the required git commit and push workflow.

#### Task Exit Criteria

- Every acceptance criterion for parallel subflows is implemented and proved.
- The main Compose build and startup wrappers succeed after the change.
- The branch contains committed story work and is pushed to origin.

#### Documentation Locations

- No external documentation is required; the repository wrapper scripts and local runtime contracts are the sources of truth for final validation.

#### Subtasks

1. [x] Re-read the full story plan and trace the acceptance criteria, description requirements, and out-of-scope boundaries against the final implementation.
2. [x] Update this planning file with the final implementation notes, testing notes, and git commit hashes so the repo workflow stays accurate.
3. [x] Create one or more git commits for this story using the required `DEV-[64] - ...` message format and a 4-5 sentence body, committing only the files touched for this story.
4. [x] Push `manual_work/0000022-parallel-subflows` to origin.
5. [x] Run `npm run lint` for the final validation surface and fix any issues found, using `npm run lint:fix` first when safe.
6. [x] Run `npm run format` followed by `npm run format:check` for the final validation surface and fix any remaining formatting issues.

#### Testing

1. [x] Run `npm run build:summary:server` and inspect the wrapper result according to the repository's wrapper-first workflow.
2. [x] Run `npm run test:summary:server:unit` and inspect the wrapper result according to the repository's wrapper-first workflow.
3. [x] Run `npm run compose:build` and confirm the main Compose stack images build successfully.
4. [x] Run `npm run compose:up` and confirm the main Compose stack starts successfully.
5. [x] Run `npm run compose:down` after automated final validation.
6. [x] Run `npm run lint` for the final validation surface and fix any issues found, using `npm run lint:fix` first when safe.
7. [x] Run `npm run format:check` for the final validation surface and fix any issues found, using `npm run format` first when needed.

#### Implementation notes

- 2026-06-23: Re-read the story against the final implementation and confirmed the delivered scope matches the array-based `subflow` contract, direct-child recursive tracking model, and aggregate child-status rule described above.
- 2026-06-23: `npm run build:summary:server` passed cleanly, the focused selected server wrapper passed all 61 schema and subflow tests, and the broad `npm run test:summary:server:unit` wrapper finished with three unrelated pre-existing failures in `flows.run.working-folder.test.ts` and `codebaseQuestion.unavailable.test.ts`.
- 2026-06-23: `npm run compose:build` built the main `codeinfo2-server` and `codeinfo2-client` images successfully, `npm run compose:up` started the main stack successfully, and `npm run compose:down` stopped it cleanly afterward.
- 2026-06-23: Committed the story as `38d7b3d6` with message `DEV-[64] - implement parallel subflows` and pushed branch `manual_work/0000022-parallel-subflows` to `origin`.
