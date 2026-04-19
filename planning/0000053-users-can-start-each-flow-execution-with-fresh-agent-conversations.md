# Story 0000053 – Users can start each flow execution with fresh agent conversations

## Implementation Plan

This section describes how to work this story from planning through implementation. Use the latest `planning/plan_format.md` as the source of truth for workflow details; do not copy this file as a template for new stories.
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria, and Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
Use the Questions section actively during planning: capture open questions early, and as answers are discovered, remove the resolved questions and incorporate the information into the relevant sections. The Questions section must be empty before creating tasks (for example via the tasking workflow) or using any `/improve-plan` / plan-refinement commands.

### Description

Flows can already reuse agent conversations while moving back and forth between multiple steps, which is useful inside a single run. The problem is that the current reuse model is too broad. A fresh execution of a flow can accidentally pick up an old agent conversation from a previous execution when the same `agentType` and `identifier` are used again.

From the user's point of view, this makes a brand-new flow run feel unsafe and confusing. Starting the same flow again should mean starting a new execution with fresh agent conversations for that execution. A user should not have to wonder whether the planning agent, review agent, or any other flow-controlled agent is quietly continuing from an older run.

This story introduces a dedicated `executionId` for flow runs. Each fresh flow start creates a new `executionId`, opens a new parent flow conversation, and gives that execution its own set of per-agent conversations. Agent reuse should remain available within one execution, but only within that execution. If a flow revisits the same agent later in the same run using the same `agentType` and `identifier`, it should continue that same agent conversation. If the user starts the flow again as a new execution, it should create a new parent flow conversation and a new set of agent conversations even when the flow definition is identical.

This story must stay simple. The user does not want a large redesign of flow execution history, child-conversation visibility, or agent restrictions. Child agent conversations created by a flow should continue to appear in the normal Agents sidebar just like today. The user must be able to open those conversations directly, keep chatting with the agent manually, and then return to the stopped flow later and resume it. When repeated executions need to be distinguished in the sidebar, that clue should be the lightweight label `Run <shortExecutionId>` shown as extra small text or a small chip in the existing metadata area rather than being baked into the main conversation title. The same clue should be reused anywhere the product lists flow-related conversations whose main titles may otherwise collide, including parent flow conversations in Flows and flow-created child agent conversations in Agents.

This story changes the existing server flow runtime, persisted conversation metadata, and the existing shared conversation sidebar UI. It does not require a new backend service, a new frontend page, a new Docker or Compose service, or a new runtime listener.

That means the flow should treat child agent conversations as normal first-class agent chats that it references, not as hidden or locked internal resources. A stopped flow may later resume one of those same child conversations after the user has manually extended it on the Agents page. The child conversation therefore remains the live source of truth for the agent thread and latest resumed context, while the flow stores enough information to know which child conversation belongs to each agent slot for the current execution.

The intended behavior is:

- a fresh flow start creates a fresh execution and fresh child agent conversations;
- a stopped flow resume continues the same execution and the same child agent conversations;
- child agent conversations remain visible and usable from the Agents page;
- manual chat added to a child agent conversation while the flow is stopped is preserved and should still be part of the conversation when the flow resumes;
- new executions must not reuse child agent conversations from older executions just because the same `agentType` and `identifier` appear again;
- repeated executions are distinguished in sidebars by the same lightweight `Run <shortExecutionId>` metadata clue;
- fresh executions of the same flow may run concurrently when they use different parent conversations and different `executionId` values.

This story should preserve the current lightweight shape wherever possible. The existing conceptual `agentConversations` mapping can stay keyed by `${agentType}:${identifier}` so long as that mapping is explicitly scoped to a single execution. The new `executionId` is the scope boundary that keeps those otherwise identical slot keys from leaking across runs.

### Acceptance Criteria

- Each fresh flow start creates a new `executionId`.
- The current flow execution persists its `executionId` in `conversation.flags.flow`.
- Each fresh flow start opens a new parent flow conversation rather than restarting inside an older flow conversation.
- A fresh flow start creates a fresh per-execution agent mapping and does not reuse agent conversations from a previous execution.
- Flow agent reuse remains available within one execution: if the same flow execution revisits the same `${agentType}:${identifier}` slot later, it reuses that slot's child agent conversation.
- The persisted `agentConversations` mapping remains conceptually keyed by `${agentType}:${identifier}` and is treated as execution-scoped state rather than process-global state.
- The flow runtime no longer relies on a process-global agent-conversation map that can leak agent slots across unrelated executions.
- Starting the same flow again as a new execution creates fresh child agent conversations even if the flow file, `agentType`, and `identifier` values are unchanged from an earlier execution.
- Resuming a stopped flow continues the same `executionId`.
- Resuming a stopped flow continues using the same child agent conversations that belong to that execution.
- Flow parent conversations persist their execution identity under `conversation.flags.flow.executionId`.
- Flow-created child agent conversations persist a child-specific execution marker in conversation flags so the Agents sidebar can derive `Run <shortExecutionId>` without parsing titles and without polluting the existing `flowName` list filter used by the Flows page.
- Child agent conversations created by a flow remain visible in the normal Agents page sidebar.
- If repeated executions create parent flow conversations or child agent conversations with otherwise identical titles, the relevant sidebar shows the lightweight execution clue `Run <shortExecutionId>` so users can tell those conversations apart.
- The execution clue label is derived directly from the current `executionId` using a shortened stable fragment and does not require a separate persisted run ordinal or global numbering registry.
- The execution clue is shown in the existing sidebar metadata area for parent flow conversations in Flows and flow-created child agent conversations in Agents, not by rewriting the main conversation title.
- A user can open a child agent conversation from the Agents page and continue chatting with it manually while the parent flow is stopped.
- When the parent flow is later resumed, it continues that same child agent conversation rather than creating a replacement conversation for the same execution slot.
- If the user manually extends a child agent conversation while the flow is stopped, that additional chat remains part of the resumed flow context because the flow resumes the same child conversation.
- On resume, the flow uses the current persisted child agent conversation state as the source of truth for the resumed context rather than an older saved snapshot from before the manual chat.
- The child agent conversation remains a normal agent conversation and is not hidden, locked, or made flow-only by this story.
- Stopping a flow preserves enough execution state to resume later, including the `executionId`, agent slot conversation mapping, and any required thread-identification data.
- Starting a new flow execution does not copy or inherit the previous execution's child agent slot mapping.
- Existing stopped flow conversations created before this story remain resumable: if a saved parent flow state is missing `executionId`, the first compatible resume or state-save path mints one and persists it before later slot reuse continues.
- Fresh executions of the same flow are allowed to run concurrently when they are started in different parent flow conversations and therefore use different `executionId` values.
- Existing `RUN_IN_PROGRESS` protection remains scoped to a single conversation; this story does not add a flow-name-wide queue or block for new executions.
- Existing agent sidebar behavior remains intact apart from showing the normal child conversations that the flow already creates.
- Existing flow behavior for using `agentType` and `identifier` to define reusable slots within one execution remains intact.
- If a stored child conversation cannot be resumed because it is missing or belongs to the wrong agent, the flow fails clearly rather than silently starting an unrelated replacement conversation under the same execution slot.
- If a stored child conversation already carries a different execution marker than the parent flow execution, resume fails clearly rather than silently reusing that child conversation under the wrong execution.
- The story does not require a broader multi-execution history model beyond what is needed to distinguish a fresh execution from a resumed execution.

### Out Of Scope

- Hiding child flow-created agent conversations from the Agents page.
- Locking or forbidding manual user chat with child agent conversations created by a flow.
- Redesigning the overall flow UX beyond what is needed to distinguish fresh execution from resume and add a lightweight execution clue.
- Reworking the main conversation title format when a metadata-area clue is sufficient.
- Creating a full multi-execution history browser or execution registry UI.
- Creating a separate per-flow run ordinal, counter, or numbering registry for sidebar display.
- Adding a new conversation-list endpoint, a new server listener, or new Docker or Compose runtime infrastructure for this story.
- Changing the existing meaning of `agentType` and `identifier` within one execution.
- Replacing the existing child-conversation model with a separate private flow-only conversation type.
- Adding flow-name-wide concurrency blocking, queueing, or cancel-previous orchestration across different parent flow conversations.
- Adding unrelated new flow step types or unrelated changes to command execution behavior.

### Additional Repositories

- No Additional Repositories

### Questions

No Further Questions.

## Decisions

1. Fresh flow starts must open a new parent flow conversation.
   - The question being addressed: When the same flow is started again, should it always open a new flow conversation, or can it restart inside an old one?
   - Why the question matters: This decides whether a new execution is truly separate from resume, or whether old flow state can bleed into what the user thinks is a fresh run.
   - What the answer is: A new execution must always open a new parent flow conversation. Resume is the only path that may reuse an existing flow conversation.
   - Where the answer came from: Repo evidence from `server/src/flows/service.ts` flow start and resume-state loading; repo evidence from this story's Description and Acceptance Criteria; external precedent from Temporal Workflow ID / Run ID docs and GitHub Actions workflow run identity docs.
   - Why it is the best answer: It keeps start and resume easy to reason about, matches the goal of fresh execution boundaries, and avoids mixing new execution state with existing `flags.flow` data from an older conversation.
2. The execution clue should be the lightweight label `Run <shortExecutionId>`.
   - The question being addressed: What exact user-visible execution clue should the sidebar show for repeated executions: a shortened `executionId`, a per-flow run ordinal, or another small stable label?
   - Why the question matters: The story needs a clue that is stable and understandable for users, but it must not force a broader execution-history feature or extra persistence just to render a small sidebar hint.
   - What the answer is: The clue should be the label `Run <shortExecutionId>`, where `<shortExecutionId>` is a shortened stable fragment derived directly from the persisted `executionId` for that execution.
   - Where the answer came from: Repo evidence from `client/src/components/chat/ConversationList.tsx` showing an existing lightweight metadata row and chip/text pattern; repo evidence from this story's required `executionId`; external precedent from GitHub Actions run identifiers (`run_id`, `run_number`, `run_attempt`), Temporal Workflow `Run Id` identity docs, MUI Chip/Typography docs, and community discussions about using stable run identifiers instead of inventing extra numbering systems.
   - Why it is the best answer: It is simple, stable, and derived from data the story already has to persist. A per-flow ordinal would require a separate counter or registry, which adds state and edge cases that are outside this story's purpose.
3. Flow resume must use the updated child agent conversation after manual chat.
   - The question being addressed: When a stopped flow resumes after manual agent chat, should it use the updated agent conversation or the flow's last saved snapshot?
   - Why the question matters: This decides whether manual chat added while the flow is stopped truly becomes part of the resumed flow context.
   - What the answer is: Resume must use the updated child agent conversation. The flow should use `flags.flow.agentConversations` to find the correct child conversation, but the child conversation itself is the live source of truth for the latest resumed context and thread state.
   - Where the answer came from: Repo evidence from this story's Description and Acceptance Criteria; repo evidence from `server/src/flows/service.ts` thread persistence and resume-state hydration; related repo precedent from `planning/0000029-flow-agent-transcripts-and-inflight-hydration.md`, which favors the live persisted conversation state as the source of truth when rehydrating.
   - Why it is the best answer: It matches the intended user workflow, preserves manual chat naturally, and keeps the design simple by treating the child conversation as a normal first-class conversation rather than a separate hidden snapshot.
4. The execution clue should live in sidebar metadata for both parent flow conversations and flow-created child agent conversations, not in the main title.
   - The question being addressed: Should that execution clue appear only on flow-created child agent conversations in the Agents sidebar, or also on the parent flow conversations in the Flows sidebar when repeated executions of the same flow create multiple parent conversations with similar titles?
   - Why the question matters: Once fresh starts always create new parent flow conversations, both the Flows sidebar and the Agents sidebar can contain repeated titles that become hard to distinguish.
   - What the answer is: The same lightweight `Run <shortExecutionId>` clue should appear in the existing sidebar metadata area for both parent flow conversations in Flows and flow-created child agent conversations in Agents. The main title stays unchanged.
   - Where the answer came from: Repo evidence from `client/src/components/chat/ConversationList.tsx` and its reuse in both `client/src/pages/FlowsPage.tsx` and `client/src/pages/AgentsPage.tsx`; repo evidence from this story's requirement that repeated executions remain distinguishable without a redesign; external evidence from MUI metadata primitives and workflow tools that keep run identity beside, not inside, the main title.
   - Why it is the best answer: It solves the ambiguity in both places with one shared rendering rule, keeps the UX consistent, and avoids building separate special-case UI for parent and child conversations.

5. Concurrent fresh executions of the same flow should remain allowed when they run in different parent flow conversations.
   - The question being addressed: If a user starts the same flow again while an earlier execution of that flow is still active in a different parent conversation, should concurrent executions be allowed, or should the product block the new start until the earlier execution finishes or is stopped?
   - Why the question matters: This decides whether the story stays focused on execution isolation or grows into a broader scheduling and concurrency-management feature.
   - What the answer is: Concurrent fresh executions should remain allowed as long as they use different parent flow conversations and therefore different `executionId` values. Existing `RUN_IN_PROGRESS` protection should stay scoped to a single conversation only.
   - Where the answer came from: Repo evidence from `server/src/agents/runLock.ts`, `server/src/flows/service.ts`, and existing conflict tests showing the current lock is per conversation rather than per flow name; repo evidence from this story's out-of-scope boundary against broader execution-history and orchestration work; external precedent from GitHub Actions, which allows concurrent runs by default and makes stronger concurrency limits opt-in, plus Temporal docs showing that duplicate-blocking behavior is a separate conflict-policy decision rather than something implied by run identity alone.
   - Why it is the best answer: The new `executionId` already solves the leakage problem this story is meant to fix. Adding flow-name-wide blocking or queueing would require new global state, extra UX, and edge-case handling that go beyond the KISS scope of this story.

## Message Contracts And Storage Shapes

- Parent flow conversation state stays under `conversation.flags.flow`, but this story extends that persisted object to include `executionId: string` alongside the existing `stepPath`, `loopStack`, `agentConversations`, optional `agentWorkingFolders`, and `agentThreads`.
- The parent flow conversation remains the source of truth for resume bookkeeping. The persisted `agentConversations` map continues to use `${agentType}:${identifier}` keys, but those keys are only valid inside one `executionId`.
- Flow-created child agent conversations need their own lightweight persisted flow-origin metadata because the current conversation summary contract already reaches the client with `flags`, `agentName`, `flowName`, and `title`, but child conversations do not currently carry parent-flow identity in a safe dedicated field. Use a child-specific flags shape such as `flags.flowChild.executionId` so the Agents sidebar can derive `Run <shortExecutionId>` without inferring state from the title text and without reusing the top-level `flowName` filter that already scopes Flows-page conversation lists.
- Conversation list APIs do not need a new endpoint for this story. The existing summary contract already returns `flags`, `flowName`, and `agentName`, so the UI should derive the sidebar clue from those persisted values instead of adding duplicate top-level response fields.
- Legacy stopped parent flow conversations that already have `flags.flow` but no `executionId` must be normalized in-place on the first compatible resume or state-save path by minting and persisting an `executionId` before later execution-scoped slot reuse continues.
- If a linked child conversation has no child execution marker yet but is being reused by the current execution, the server should stamp the current execution marker onto that child conversation at the same point it becomes the confirmed child for that execution. If a linked child conversation already carries a conflicting execution marker, resume must fail clearly.

## Edge Cases And Failure Modes

- Fresh starts and resumes must stay distinct even when the user starts from an older selected parent conversation in the UI. A fresh start creates a new parent conversation and new `executionId`; only an explicit resume path is allowed to reuse an existing parent conversation.
- Existing stopped parent flow conversations without `executionId` are a compatibility seam, not a reason to drop resume support. The story should backfill `executionId` when those conversations are resumed or when later resume-state saves occur.
- Flow-created child agent conversations must not start using the top-level `flowName` field just to render the sidebar clue. The Flows page already filters conversation lists by `flowName`, so reusing that field on child agent conversations would leak child chats into the parent-flow list.
- The shared `ConversationList` should show the execution clue only when the relevant persisted execution marker exists. Ordinary chat conversations and unrelated agent conversations must remain visually unchanged.
- If the stored parent mapping points at a missing child conversation, an agent-name mismatch, or a conflicting child execution marker, the run must fail clearly instead of silently reassigning the slot to some other conversation.
- Because the current flow service keeps `agentConversationState` in a process-global map, the implementation must ensure that fresh starts do not hydrate or persist stale entries from an earlier execution before the new execution-scoped state is initialized.

## Implementation Ideas

- Add `executionId` to the persisted `conversation.flags.flow` shape and treat it as the identity of the current flow execution.
- On a fresh flow start, mint a new `executionId`, create a new parent flow conversation, and initialize an empty execution-scoped agent slot map.
- On flow resume, load the same `executionId` and rehydrate the stored agent slot map for that execution.
- Derive a short stable display label from `executionId` and render it as `Run <shortExecutionId>` instead of inventing a separate run counter or ordinal.
- Keep the conceptual `agentConversations` map keyed by `${agentType}:${identifier}`, but only inside one execution-scoped flow state object.
- Replace the current process-wide flow agent reuse map with execution-scoped runtime state so unrelated executions cannot collide.
- Keep child agent conversations as normal persisted agent conversations with normal sidebar visibility and normal manual-chat behavior.
- Persist lightweight child execution metadata on flow-created agent conversations so the Agents sidebar can render `Run <shortExecutionId>` from stored data instead of parsing titles.
- Reuse the shared `ConversationList` metadata area to show the same lightweight execution clue on both parent flow conversations in Flows and flow-created child agent conversations in Agents without changing the main title.
- When resuming a stopped flow, reuse the stored child conversation for each execution slot instead of generating a replacement conversation.
- Backfill `executionId` onto legacy stopped parent flows, and stamp the current execution marker onto reused child conversations that predate this story before later reuse depends on that marker.
- Prefer the linked child conversation's current persisted thread metadata and live persisted conversation state when resuming so manual chat added while the flow was stopped is reflected in the resumed execution.
- Keep concurrency control scoped to the existing per-conversation lock; do not introduce a separate flow-name-wide queue or block for fresh executions in this story.
- Reuse the existing flow `node:test` integration files, the existing server Cucumber Testcontainers support, the existing `ConversationList` and page-level RTL coverage, and the existing wrapper-backed Playwright e2e stack; this story should not introduce a new test harness or runtime seam.
- Keep the implementation lightweight: use `executionId` as the new scope boundary and avoid introducing a larger execution-history subsystem unless the existing code truly requires it.

# Tasks

### Task 1. Persist Execution-Scoped Parent Flow State

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__done__`
- Git Commits:
  - `363dfe43` `DEV-0000053 - persist execution-scoped parent flow state`
  - `e0226c20` `DEV-0000053 - mark Task 1 git commits`

#### Overview

Add the parent-flow execution identity and make the runtime treat that identity as the boundary for slot reuse. This task is only about parent flow state, fresh-start versus resume semantics, and eliminating cross-run leakage from the current process-global slot map before any child-conversation sidebar work is attempted.

#### Task Exit Criteria

- Fresh flow starts always persist `flags.flow.executionId`, use a fresh parent flow conversation, and cannot reuse child slot mappings from an older execution.
- Resume keeps the existing parent conversation and existing execution, including legacy saved flow conversations that still have `flags.flow` but do not yet have `executionId`.

#### Documentation Locations

- `https://nodejs.org/api/crypto.html#cryptorandomuuidoptions` - use for the Node 22 `crypto.randomUUID()` contract because this story mints a new stable execution identifier for every fresh flow run.
- `https://www.mongodb.com/docs/manual/reference/operator/update/set/` - use for the Mongo `$set` behavior that already persists nested `flags.flow` state and must now include `executionId` without inventing a second persistence path.

#### Subtasks

1. [x] Current Repository: Read the existing parent-flow runtime and persistence seams before changing code. Inspect `server/src/flows/flowState.ts`, `server/src/flows/types.ts`, `server/src/flows/service.ts`, `server/src/mongo/repo.ts`, `server/src/routes/flowsRun.ts`, `server/src/ws/sidebar.ts`, and this story file so you can keep the execution-scoped change inside the existing flow service and conversation persistence path. Documentation: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions ; https://www.mongodb.com/docs/manual/reference/operator/update/set/ .
2. [x] Current Repository: In `server/src/flows/flowState.ts`, `server/src/flows/service.ts`, and `server/src/mongo/repo.ts`, extend the parent flow resume-state contract to include `executionId: string` under `flags.flow.executionId`. Parse it, build it, and persist it through the existing `updateConversationFlowState(...)` path instead of inventing a second field or collection. When resuming a legacy stopped flow that still has `flags.flow` but no `executionId`, mint the missing `executionId` and persist it before later slot reuse depends on it. Documentation: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions ; https://www.mongodb.com/docs/manual/reference/operator/update/set/ .
3. [x] Current Repository: In `server/src/flows/service.ts` and `server/src/flows/types.ts`, replace the current process-global flow-agent reuse behavior with execution-scoped runtime state so slot reuse is keyed by `executionId` plus `${agentType}:${identifier}`, not just by `${agentType}:${identifier}` alone. Preserve the existing within-one-execution reuse rule, but make sure a fresh execution cannot hydrate or persist stale slot entries from any earlier execution before the new runtime state is initialized. Documentation: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions .
4. [x] Current Repository: In `server/src/flows/service.ts` and `server/src/routes/flowsRun.ts`, keep start and resume as distinct paths. A fresh run must create a new parent flow conversation even when the caller supplies a `conversationId` that already belongs to an older flow conversation, while resume must continue the existing conversation only when `resumeStepPath` is present. Keep the current `RUN_IN_PROGRESS` lock scoped to one conversation only, and do not add any flow-name-wide concurrency block or queue in this task. Documentation: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions .
5. [x] Current Repository: Update the parent-flow proof files so the new execution boundary is explicit in both server harnesses that this repository actually runs. At minimum, change `server/src/test/unit/flows.flags.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.test.ts`, and `server/src/test/integration/flows.run.command.test.ts`, then add or update a focused cucumber feature such as `server/src/test/features/flows-execution-runs.feature` plus matching step definitions such as `server/src/test/steps/flows-execution-runs.steps.ts`. The `node:test` suite must prove `executionId` persistence, fresh-run parent-conversation replacement, same-execution slot reuse, legacy `executionId` backfill, and allowed concurrent fresh executions in different parent conversations. The cucumber feature must prove the same fresh-run versus resume contract through the repository's Testcontainers-backed Mongo/Chroma path instead of leaving `npm run test:summary:server:cucumber` as unrelated regression coverage only. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ .
6. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
7. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [x] Current Repository: Run `npm run build:summary:server`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 1 changes server flow types and runtime behavior. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 1 changes flow state persistence, runtime slot reuse, and route-level start/resume semantics. If `failed > 0`, inspect the exact printed `test-results/server-unit-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full `npm run test:summary:server:unit` wrapper.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 1 must add or update a Story 53 flow cucumber feature that exercises fresh-run versus resume behavior through the repository's Testcontainers-backed persistence path. If `failed > 0`, inspect the exact printed `test-results/server-cucumber-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full `npm run test:summary:server:cucumber` wrapper.

#### Implementation notes

- Subtask 1: Read the existing flow state, start/resume, persistence, route, sidebar, and proof seams to keep Story 53 changes inside the current `flags.flow` persistence path and server flow runtime.
- Subtask 2: Extended `flags.flow` to carry `executionId`, parsed and rebuilt the full flow resume-state shape, and persisted a backfilled execution id through the existing flow-state save path for legacy resumes.
- Subtask 3: Replaced the process-global agent slot map with per-execution runtime state passed through the running flow so same-slot reuse stays inside one execution and fresh runs start clean.
- Subtask 4: Changed fresh-start conversation selection so supplying an older parent conversation now creates a new flow conversation, while resume requires saved flow state on the existing conversation and keeps the lock scoped per conversation.
- Subtask 5: Updated Story 53 proof coverage across server unit/integration tests and added a Mongo-backed cucumber feature/steps file for fresh-start versus resume execution identity.
- Subtask 6: Ran `npm run lint`, followed the required `npm run lint:fix` fallback for import-order warnings in the new cucumber step file, and reran `npm run lint` cleanly.
- Subtask 7: Ran `npm run format:check`, followed the required `npm run format` fallback when Prettier flagged Story 53 files plus existing markdown files, and reran `npm run format:check` cleanly.
- Testing 1: `npm run build:summary:server` failed once on missing `executionId`/`runtimeState` threading and a narrowed UUID type, then passed cleanly after fixing the service callsite and widening the local `executionId` variable type.
- Testing 2: `npm run test:summary:server:unit` initially exposed flow proof regressions from the new fresh-start parent-conversation behavior plus a missing local `/app/codex/chat/config.toml`; after updating the affected flow tests and creating the missing local chat config file, the full unit wrapper passed cleanly with 1514/1514 tests.
- Testing 3: `npm run test:summary:server:cucumber` initially hung because the new Story 53 cleanup hook ran after non-Mongo scenarios and threw `MongoNotConnectedError`; scoping the hooks to `@mongo` and guarding cleanup on an active Mongoose connection fixed the suite, and the full wrapper then passed with 76/76 scenarios.

### Task 2. Enforce Child Conversation Ownership And Compatibility

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__done__`
- Git Commits:
  - `8aa3db0d` `DEV-0000053 - enforce child flow conversation ownership`
  - `df46a2fe` `DEV-0000053 - mark Task 2 git commits`

#### Overview

Persist and validate child-conversation ownership so every flow-created agent conversation belongs to exactly one execution. This task keeps child conversations as normal first-class agent chats, but it adds the execution marker and mismatch guards needed so resume can safely reuse the right child conversation and fail clearly when the saved mapping is wrong.

#### Task Exit Criteria

- Flow-created child agent conversations persist `flags.flowChild.executionId`, and resume reuses the same child conversations for the same execution instead of silently creating replacements.
- If a saved child conversation is missing, belongs to the wrong agent, or carries a conflicting execution marker, resume fails clearly and the child conversation still does not leak into flow-only filtering through top-level `flowName`.

#### Documentation Locations

- `https://www.mongodb.com/docs/manual/reference/operator/update/set/` - use for nested updates to `flags.flowChild.executionId` and any related compatibility stamping on existing conversation documents.
- `https://www.mongodb.com/docs/manual/core/document/#dot-notation` - use for the dot-notation rules that matter when persisting child execution metadata without replacing unrelated sibling `flags` fields.

#### Subtasks

1. [x] Current Repository: Read the child-conversation ownership seams before changing code. Inspect `server/src/flows/service.ts`, `server/src/mongo/repo.ts`, `server/src/routes/conversations.ts`, `server/src/ws/sidebar.ts`, `server/src/mongo/conversation.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.test.ts`, and `server/src/test/integration/conversations.flowname.test.ts`. The goal is to keep child execution markers on `flags` and reuse the existing conversation summary contract instead of inventing a new list endpoint. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ ; https://www.mongodb.com/docs/manual/core/document/#dot-notation .
2. [x] Current Repository: In `server/src/flows/service.ts` and `server/src/mongo/repo.ts`, stamp every flow-created child agent conversation with `flags.flowChild.executionId` when that conversation becomes the confirmed child for the current execution. If a reused legacy child conversation is missing the marker, add the current execution marker at that confirmation point. Do not add top-level `flowName` to child agent conversations just to support the sidebar clue, because the Flows page already filters on `flowName`. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ ; https://www.mongodb.com/docs/manual/core/document/#dot-notation .
3. [x] Current Repository: In `server/src/flows/service.ts` and `server/src/routes/flowsRun.ts`, tighten resume validation so the saved `agentConversations` mapping is treated as authoritative for the current execution only. If a mapped child conversation is missing, belongs to the wrong `agentType`, or already carries a different `flags.flowChild.executionId` than the parent flow execution, fail clearly instead of silently swapping in a new conversation for that slot. Keep the resumed child conversation itself as the live source of truth so manual chat added while the flow was stopped remains part of the resumed context. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ ; https://www.mongodb.com/docs/manual/core/document/#dot-notation .
4. [x] Current Repository: Update server proof files for the child-ownership contract in both the `node:test` and cucumber paths. At minimum, change `server/src/test/unit/flows.flags.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.test.ts`, and `server/src/test/integration/conversations.flowname.test.ts`, then extend the Story 53 cucumber feature from Task 1 such as `server/src/test/features/flows-execution-runs.feature` plus `server/src/test/steps/flows-execution-runs.steps.ts`. The `node:test` suite must prove child execution markers are persisted, legacy child conversations are stamped when reused, missing or conflicting child mappings fail clearly, manual resume still targets the same child conversation, and child conversations do not leak into `flowName`-filtered flow history. The cucumber feature must prove at least one resumed-execution path where the saved child mapping is accepted only when the ownership markers still match the parent execution. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ ; https://www.mongodb.com/docs/manual/core/document/#dot-notation .
5. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
6. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [x] Current Repository: Run `npm run build:summary:server`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 2 changes server-side flow ownership and conversation flag persistence. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 2 changes `flags` persistence and flow-child ownership validation. If `failed > 0`, inspect the exact printed `test-results/server-unit-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full `npm run test:summary:server:unit` wrapper.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 2 extends the Story 53 flow cucumber feature so the higher-level resume path proves child-conversation ownership checks instead of only exercising unrelated features. If `failed > 0`, inspect the exact printed `test-results/server-cucumber-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full `npm run test:summary:server:cucumber` wrapper.

#### Implementation notes

- Subtask 1: Read the child-conversation persistence, resume-validation, summary-contract, and existing proof seams so Task 2 can stamp `flags.flowChild.executionId` inside the current flow service and conversation list path.
- Subtask 2: Added an explicit nested persistence path for `flags.flowChild.executionId`, stamped child execution ids when child conversations are confirmed for an execution, and preserved the existing top-level `flowName` behavior for parent-only filtering.
- Subtask 3: Tightened resume validation so missing child conversations, agent mismatches, and conflicting child execution markers now fail clearly, while compatible legacy child conversations are backfilled in place and still resume the same child chat.
- Subtask 4: Expanded unit, integration, and cucumber proof so Story 53 now covers child execution-marker persistence, legacy child-marker backfill, accepted same-child resume paths, conflict failure paths, and `flowName` filtering that still excludes child chats.
- Subtask 5: Ran `npm run lint`; the first pass exposed an unused `query` import in an existing Story 53 working-folder proof file, and removing that stale import let the full repo lint pass cleanly.
- Subtask 6: Ran `npm run format:check`, followed the required `npm run format` fallback for three Task 2 files, and reran `npm run format:check` cleanly.
- Testing 1: `npm run build:summary:server` passed cleanly on the first Task 2 run after the child execution-marker persistence and resume-validation changes were wired through the server flow service and repo helper.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with 1519/1519 tests after the Task 2 child-ownership proofs were added, including the new resume mismatch and legacy child-marker backfill coverage.
- Testing 3: `npm run test:summary:server:cucumber` failed once on a transient Testcontainers Mongo port-binding startup and once on a Story 53 proof timing race while the parent flow state was still persisting `agentConversations`; retrying the container startup and making the child-mapping step poll for the saved child conversation fixed the suite, and the full wrapper then passed with 76/76 scenarios.

### Task 3. Show Run Metadata And Start Fresh Flow Conversations In The UI

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1, Task 2`
- Task Status: `__done__`
- Git Commits:
  - `59a6c830` - `DEV-0000053 - align flow UI with execution run metadata`
  - `1fabb8eb` - `DEV-0000053 - mark Task 3 git commits`

#### Overview

Align the browser UI with the new execution boundary. The Flows page must treat Run as a fresh conversation and Resume as reuse of the stopped conversation, while the shared sidebar must show `Run <shortExecutionId>` in the existing metadata area for both parent flow conversations and flow-created child agent conversations without changing titles or affecting normal chat rows.

#### Task Exit Criteria

- Clicking Run always creates a new flow conversation id in the browser, while Resume keeps the selected stopped flow conversation id.
- The shared sidebar shows `Run <shortExecutionId>` for flow parent rows and flow-created agent rows by reading existing `flags`, and ordinary chat or unrelated agent rows remain visually unchanged.

#### Documentation Locations

- `https://llms.mui.com/material-ui/6.4.12/api/chip.md` - use for the existing MUI `Chip` surface because the story allows a small chip in the metadata row when it keeps the clue lightweight.
- `https://llms.mui.com/material-ui/6.4.12/api/typography.md` - use for the caption-level text treatment in the sidebar metadata row.
- `https://llms.mui.com/material-ui/6.4.12/components/lists.md` - use for list-row composition guidance so the new run clue stays inside the existing list metadata structure instead of becoming a title rewrite.
- `https://playwright.dev/docs/locators` - use for the browser proof file so the new run clue assertions are robust and readable in Playwright.
- `https://playwright.dev/docs/screenshots` - use for the existing Playwright screenshot contract because this repository already keeps browser-proof image artifacts for visually checked UI stories.

#### Subtasks

1. [x] Current Repository: Read the client-side flow and sidebar seams before changing code. Inspect `client/src/api/flows.ts`, `client/src/api/conversations.ts`, `client/src/hooks/useConversations.ts`, `client/src/components/chat/ConversationList.tsx`, `client/src/pages/FlowsPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/test/flowsPage.run.test.tsx`, `client/src/test/chatPage.source.test.tsx`, and this story file. Documentation: https://llms.mui.com/material-ui/6.4.12/api/chip.md ; https://llms.mui.com/material-ui/6.4.12/api/typography.md ; https://llms.mui.com/material-ui/6.4.12/components/lists.md .
2. [x] Current Repository: In `client/src/pages/FlowsPage.tsx` and `client/src/test/flowsPage.run.test.tsx`, change the flow-start behavior so `Run` always creates a brand-new client conversation id even when an older flow conversation is selected, and `Resume` keeps using the selected stopped conversation id. Preserve the existing custom-title rule: only include `customTitle` for brand-new runs. Documentation: https://playwright.dev/docs/locators .
3. [x] Current Repository: In `client/src/api/conversations.ts`, `client/src/hooks/useConversations.ts`, `client/src/components/chat/ConversationList.tsx`, `client/src/pages/FlowsPage.tsx`, and `client/src/pages/AgentsPage.tsx`, extend the list-item typing so the shared sidebar can read `flags.flow.executionId` for parent flow conversations and `flags.flowChild.executionId` for flow-created agent conversations. Render a shortened stable `Run <shortExecutionId>` clue in the existing metadata area using the current MUI `Typography` and `Chip` primitives, do not rewrite titles, do not show the clue for ordinary chat rows, and do not change the current `flowName: '__none__'` filtering on the Agents page. Documentation: https://llms.mui.com/material-ui/6.4.12/api/chip.md ; https://llms.mui.com/material-ui/6.4.12/api/typography.md ; https://llms.mui.com/material-ui/6.4.12/components/lists.md .
4. [x] Current Repository: Update the focused client proof files for the new UI contract. At minimum, change `client/src/test/flowsPage.run.test.tsx` to prove Run versus Resume conversation-id behavior, update `client/src/test/chatSidebar.test.tsx` because it already exercises `ConversationList`, and update `client/src/test/agentsPage.sidebarWs.test.tsx` because it already proves live Agents sidebar updates. Those tests must prove parent-flow and child-agent run clues render from `flags`, ordinary rows stay unchanged, and flow-created child conversations remain visible under Agents without title changes. Documentation: https://llms.mui.com/material-ui/6.4.12/api/chip.md ; https://llms.mui.com/material-ui/6.4.12/api/typography.md ; https://playwright.dev/docs/locators .
5. [x] Current Repository: Add browser-level proof in `e2e/flows-execution-runs.spec.ts`. The spec must cover two fresh executions of the same flow showing separate sidebar rows with the same main title but different `Run <shortExecutionId>` clues, plus the corresponding flow-created child conversation appearing in Agents with the same run clue and at least one ordinary non-flow row staying unchanged. Reuse the existing Playwright route-mocking and websocket-support style already used in this repository instead of inventing a second browser harness, and rely on the checked-in `playwright.config.ts` behavior so screenshots and traces are captured through the current e2e path rather than a bespoke artifact flow. Documentation: https://playwright.dev/docs/locators ; https://playwright.dev/docs/screenshots .
6. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
7. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [x] Current Repository: Run `npm run build:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 3 changes the shared conversation sidebar rendering used by multiple client pages, and this wrapper already performs the repository's client typecheck gate before the build. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun `npm run build:summary:client`.
2. [x] Current Repository: Run `npm run test:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 3 changes page-level and shared-sidebar client behavior. If `failed > 0`, inspect the exact printed client test log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, and/or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full `npm run test:summary:client` wrapper.
3. [x] Current Repository: Run `npm run test:summary:e2e` and allow up to 7 minutes for the wrapper to finish. Do not attempt this check without the repository wrapper. Use this wrapper because Task 3 adds browser-visible flow and agent sidebar behavior that should be proved end to end. This wrapper already performs the repository's supported compose-e2e build, startup, Playwright run, and teardown path, so do not add separate e2e stack commands around it. If `failed > 0`, setup or teardown fails, or the wrapper reports unexpected ambiguity, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep <pattern>`, then rerun the full `npm run test:summary:e2e` wrapper.

#### Implementation notes

- Subtask 1: Re-read the active Story 53 plan plus the Flows page, shared conversation list, conversation-summary typing, Agents page filtering, and the focused client/e2e proof files so Task 3 can preserve the Run-vs-Resume split and render run clues from persisted `flags` without changing title or filtering behavior.
- Subtask 2: Changed the Flows page start handler so `Run` always allocates a fresh client conversation id while `Resume` keeps the selected stopped flow conversation id, then updated the focused Flows page proof to lock that request-body split in place.
- Subtask 3: Promoted conversation `flags` into the client typing surface and added a metadata-row `Run <shortExecutionId>` chip that reads parent `flags.flow.executionId` or child `flags.flowChild.executionId` without changing titles or the Agents page `flowName: '__none__'` filter.
- Subtask 4: Expanded the client proof set so Flows page tests now distinguish fresh Run from Resume request ids, the shared sidebar tests verify parent and child run chips while ordinary rows stay unchanged, and the Agents sidebar websocket proof keeps rendering child rows with the matching run clue.
- Subtask 5: Added a browser-level Playwright spec that reuses the repository’s existing API-route and websocket mocking style to prove two fresh executions render the same main flow title with distinct run chips and that the matching child-agent rows stay visible in Agents while an ordinary agent row shows no clue.
- Subtask 6: Ran `npm run lint` after the Task 3 UI and proof changes, and the full repo eslint pass succeeded without needing any follow-up fixes.
- Subtask 7: `npm run format:check` flagged the new Flows page proof and e2e spec, so I ran the required `npm run format` fallback and then reran `npm run format:check` cleanly.
- Testing 1: `npm run build:summary:client` passed cleanly through both the wrapper’s typecheck gate and the client build phase after the Task 3 sidebar and Flows page changes.
- Testing 2: The first `npm run test:summary:client` pass exposed three stale test assumptions about the new fresh-Run contract plus one duplicate short-id assertion in the Agents sidebar proof; after updating those proofs and confirming the affected files with targeted reruns, the full wrapper passed cleanly with 654/654 client tests.
- Testing 3: `npm run test:summary:e2e` completed on the repository’s compose-backed wrapper path, and although the wrapper summary reported `ambiguous_counts`, inspecting `logs/test-summaries/e2e-tests-latest.log` showed Playwright finished with `expected: 51`, `skipped: 3`, `unexpected: 0`, including the new `flows-execution-runs.spec.ts` passing with screenshot and trace artifacts.

### Task 4. Perform Story 53 Final Validation And Close-Out

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1, Task 2, Task 3`
- Task Status: `__done__`
- Git Commits:
  - `3dd984e6` - `DEV-0000053 - complete story 53 close-out validation`
  - `d2e29e7d` - `DEV-0000053 - mark Task 4 git commits`

#### Overview

Run the full story acceptance pass, update the repository documentation that now describes flow execution behavior, and prepare the reviewer-facing close-out artifact. This task must prove that fresh starts, resumes, flow-created child conversations, and sidebar run clues all match the final implementation without broadening the story into a larger flow-history redesign.

#### Task Exit Criteria

- Every acceptance criterion, material Description requirement, and explicit Out Of Scope boundary is mapped to completed implementation work and a concrete proof step.
- The repository documentation and Story 53 PR summary describe the final flow execution behavior truthfully, including any deliberate no-change decisions.

#### Documentation Locations

- `https://playwright.dev/docs/debug` - use for the final manual browser verification and any screenshot capture needed for the user-visible Flows and Agents sidebar behavior.
- `https://playwright.dev/docs/screenshots` - use for the final screenshot artifact capture because the repository already stores manual browser proof images under checked-in screenshot folders.
- `https://docs.github.com/en/pull-requests` - use when writing the reviewer-facing Story 53 PR summary so the close-out artifact is structured like a pull-request summary instead of ad hoc notes.
- `https://www.markdownguide.org/basic-syntax/` - use when formatting the Story 53 PR summary markdown cleanly and consistently.

#### Subtasks

1. [x] Current Repository: Re-read this entire story and trace every acceptance criterion, every important Description requirement, and every explicit Out Of Scope boundary to the finished task set before marking the story complete. Record the mapping in this task’s Implementation notes so later reviewers can see where fresh-run parent replacement, execution-scoped child reuse, legacy backfill, child visibility in Agents, sidebar `Run <shortExecutionId>` clues, and unchanged out-of-scope areas were each implemented and proved. Documentation: https://docs.github.com/en/pull-requests ; https://www.markdownguide.org/basic-syntax/ .
2. [x] Current Repository: Update `docs/developer-reference.md` so the written flow contract matches Story 53. At minimum, document that fresh flow starts create new parent conversations, resume keeps the existing execution, flow-created child conversations remain visible in Agents, and repeated executions are distinguished by `Run <shortExecutionId>` in sidebar metadata instead of title changes. Documentation: https://www.markdownguide.org/basic-syntax/ .
3. [x] Current Repository: Update `design.md` anywhere it still describes flow agent reuse, resume-state storage, or sidebar behavior as if there were no `executionId` boundary. The final design notes must mention `flags.flow.executionId`, `flags.flowChild.executionId`, fresh-start versus resume conversation ownership, and the shared sidebar metadata clue for repeated executions. Documentation: https://www.markdownguide.org/basic-syntax/ .
4. [x] Current Repository: Update `README.md` only if the top-level user or contributor guidance would otherwise be misleading after Story 53. If no README change is needed, record that explicit no-change decision in this task’s Implementation notes instead of leaving it implicit. Documentation: https://www.markdownguide.org/basic-syntax/ .
5. [x] Current Repository: Update `projectStructure.md` for every file actually added, removed, or renamed by Story 53, and add the Story 53 structural-change ledger once the final file list is known. If the story lands only in-place edits for some areas, say that explicitly in the ledger instead of implying file additions that did not happen. Documentation: https://www.markdownguide.org/basic-syntax/ .
6. [x] Current Repository: Create `codeInfoStatus/pr-summaries/0000053-pr-summary.md` as the reviewer-facing Story 53 close-out artifact. It must summarize the repository scope, the final task sequence, the execution-state contract, the user-visible Flows and Agents sidebar change, the compatibility/backfill behavior for legacy stopped flows, and the final build/test/manual validation evidence. Documentation: https://docs.github.com/en/pull-requests ; https://www.markdownguide.org/basic-syntax/ .
7. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
8. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [x] Current Repository: Run `npm run compose:build:summary`. Use this wrapper first because Story 53 changes a server-plus-client system that this repository can build through its supported compose path. If the wrapper reports failure or ambiguous output, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun `npm run compose:build:summary`.
2. [x] Current Repository: Run `npm run build:summary:server`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 4 is the final backend regression pass for the flow runtime and persistence changes. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
3. [x] Current Repository: Run `npm run build:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 4 is the final client regression pass for the shared conversation sidebar and Flows page behavior, and it already includes the repository's client typecheck gate. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun `npm run build:summary:client`.
4. [x] Current Repository: Run `npm run test:summary:server:unit`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 4 must prove the final flow-state, resume, and conversation-ownership contract on the server. If `failed > 0`, inspect the exact printed `test-results/server-unit-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full `npm run test:summary:server:unit` wrapper.
5. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Do not attempt this check without the repository wrapper. Use this wrapper because the Story 53 flow cucumber feature added in Tasks 1 and 2 must still pass on the repository's supported higher-level server proof surface. If `failed > 0`, inspect the exact printed `test-results/server-cucumber-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full `npm run test:summary:server:cucumber` wrapper.
6. [x] Current Repository: Run `npm run test:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 4 must prove the final shared-sidebar and page-level client behavior. If `failed > 0`, inspect the exact printed client test log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, and/or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full `npm run test:summary:client` wrapper.
7. [x] Current Repository: Run `npm run test:summary:e2e` and allow up to 7 minutes for the wrapper to finish. Do not attempt this check without the repository wrapper. Use this wrapper because the story changes user-visible Flows and Agents behavior that should be proved through the repository's browser-backed test path. This wrapper already performs the supported compose-e2e build, startup, Playwright run, and teardown path. If `failed > 0`, setup or teardown fails, or the wrapper reports unexpected ambiguity, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep <pattern>`, then rerun the full `npm run test:summary:e2e` wrapper.
8. [x] Current Repository: Run `npm run compose:up` for the final manual verification pass only after the build and automated wrappers above are green. Do not attempt this check without the repository wrapper. Use this wrapper instead of raw Docker Compose commands so the supported runtime stack is started through the repository's normal flow and the main-stack `playwright-mcp` service is available.
9. [x] Current Repository: Perform final manual Playwright MCP validation against the running main stack. Use the repository's Playwright MCP tooling with `http://host.docker.internal:5001/flows` and `http://host.docker.internal:5001/agents`, start the same flow twice as two fresh executions, confirm the Flows sidebar shows two rows with the same main title but different `Run <shortExecutionId>` clues, confirm the corresponding flow-created child conversation is visible in Agents with the matching run clue and remains usable as a normal agent conversation, and confirm at least one ordinary non-flow row still shows no run clue. Save at least one Flows screenshot and one Agents screenshot under `playwright-output-local` using a Story 53 prefix such as `0000053-4-main-*.png`, inspect the saved images yourself, confirm the browser console has no error-level messages during this pass, and record the exact filenames plus outcomes in this task's Implementation notes. Documentation: https://playwright.dev/docs/debug ; https://playwright.dev/docs/screenshots .
10. [x] Current Repository: Run `npm run compose:down` after the final manual verification finishes. Do not attempt this check without the repository wrapper. Use this wrapper so the supported stack is torn down through the repository workflow rather than a raw Docker command.

#### Implementation notes

- Subtask 1: Re-read the whole Story 53 plan and mapped the final contract before close-out: Task 1 implemented and proved fresh-run parent replacement, parent `flags.flow.executionId`, execution-scoped slot reuse, legacy parent backfill, and concurrent fresh executions; Task 2 implemented and proved child `flags.flowChild.executionId`, child ownership validation, live child resume after manual chat, and child exclusion from `flowName`-filtered Flows history; Task 3 implemented and proved the Flows/Agents sidebar `Run <shortExecutionId>` clue plus the browser-visible Run-vs-Resume split, while the out-of-scope areas stayed unchanged because no hidden child-chat model, title rewrite, run ordinal, new list endpoint, or flow-name-wide concurrency block was added.
- Subtask 2: Updated `docs/developer-reference.md` with the final Story 53 flow execution contract so the developer-facing docs now describe fresh parent creation, resume ownership, child visibility in Agents, and metadata-based run clues instead of title-based differentiation.
- Subtask 3: Updated `design.md` to replace the old process-global flow-slot description with an execution-scoped model and to document `flags.flow.executionId`, `flags.flowChild.executionId`, fresh Run versus Resume ownership, and shared sidebar run metadata.
- Subtask 4: Left `README.md` unchanged because its top-level setup and workflow guidance remains accurate after Story 53; the flow-execution contract now lives in the developer reference and design docs instead of needing duplicate top-level README detail.
- Subtask 5: Added the Story 53 structural-change ledger to `projectStructure.md`, listing the new server/browser proof files and the in-place implementation/doc updates without implying any removed or renamed files that did not happen.
- Subtask 6: Created `codeInfoStatus/pr-summaries/0000053-pr-summary.md` as the reviewer-facing close-out artifact covering repository scope, task sequence, execution-state contract, user-visible sidebar changes, compatibility/backfill behavior, and the final validation evidence for the completed story.
- Subtask 7: Ran `npm run lint` after the Task 4 doc and summary updates, and the full repository eslint pass completed cleanly without requiring any follow-up fixes.
- Subtask 8: Ran `npm run format:check` after the Task 4 close-out document changes, and Prettier reported the repository was already clean so no fallback formatter run was needed.
- Testing 1: `npm run compose:build:summary` passed cleanly with both compose images built and the existing Story 50 runtime-asset bake proof still emitted for the server image.
- Testing 2: `npm run build:summary:server` passed cleanly on the final close-out pass, confirming the flow runtime and persistence changes still compile after the documentation and PR-summary updates.
- Testing 3: `npm run build:summary:client` passed cleanly through the wrapper’s typecheck gate and build phase on the final close-out pass, confirming the shared sidebar and Flows UI contract still builds after the Story 53 doc sync.
- Testing 4: `npm run test:summary:server:unit` passed cleanly with 1519/1519 tests on the final close-out pass, confirming the execution-state, resume, and child-ownership server proofs still hold after the Task 4 doc work.
- Testing 5: `npm run test:summary:server:cucumber` passed cleanly with 76/76 scenarios on the final close-out pass, confirming the Mongo-backed Story 53 flow behavior still holds end to end on the supported server feature-test surface.
- Testing 6: `npm run test:summary:client` passed cleanly with 654/654 tests on the final close-out pass, confirming the shared-sidebar and Flows page client proofs still hold after the Task 4 documentation and PR-summary updates.
- Testing 7: `npm run test:summary:e2e` finished with wrapper `status: passed` but `agent_action: inspect_log` because the summary parser reported `ambiguous_counts`; `logs/test-summaries/e2e-tests-latest.log` confirmed the Playwright stats were `expected: 54`, `skipped: 0`, and `unexpected: 0`, including the Story 53 browser spec, so the full e2e pass was accepted as green.
- Testing 8: `npm run compose:up` started the main stack cleanly through the supported wrapper, including the `playwright-mcp` service needed for the final manual verification against the host-mapped client URL.
- Testing 9: Manual Playwright MCP verification against `http://host.docker.internal:5001/flows` and `/agents` confirmed two fresh `Story53 manual echo` parent rows with distinct clues (`Run ee6e75e2` and `Run f0938f05`), matching `planning_agent` child rows with the same clues, and ordinary non-flow command rows with no run clue; the inspected screenshots were saved as `playwright-output-local/0000053-4-main-flows.png` and `playwright-output-local/0000053-4-main-agents.png`, and the Playwright MCP error-level console query returned no entries during the pass.
- Testing 10: `npm run compose:down` stopped and removed the main validation stack cleanly through the supported wrapper after the final manual Playwright MCP pass finished.

## Questions

- No Further Questions

## Code Review Findings

- Review artifacts:
  - `codeInfoStatus/reviews/0000053-20260328T173221Z-91fa391b-evidence.md`
  - `codeInfoStatus/reviews/0000053-20260328T173221Z-91fa391b-findings.md`
  - `codeInfoStatus/reviews/0000053-20260328T173221Z-91fa391b-blind-spot-challenge.md`
- Reopen reason:
  - `must_fix` plan-contract issue: `server/src/flows/service.ts` validates and may stamp legacy child execution markers before the freshly minted parent `flags.flow.executionId` is durably persisted, which leaves a partial-failure window where a failed first resume attempt can strand a legacy stopped flow in an unrecoverable mixed parent/child execution state.
  - `should_fix` plan-contract issue: `client/src/test/flowsPage.run.test.tsx` now asserts the opposite of the Story 53 custom-title contract for a fresh Run started from an older selected conversation, so the acceptance proof for that path is no longer trustworthy.
- Blind-spot challenge result:
  - No additional findings were generated, but the focused challenge strengthened both review findings. The server backfill-ordering defect remains the highest-risk runtime issue, and the client proof mismatch remains a real acceptance-proof gap rather than a stale false alarm.

# Review Follow-Up Tasks

### Task 5. Persist Legacy Parent Execution Identity Before Child Backfill Validation

- Repository Name: `Current Repository`
- Task Dependencies: `Task 4`
- Task Status: `__done__`
- Git Commits:
  - `9997e454` - `DEV-0000053 - persist legacy parent execution id before child backfill`
  - `a672b0d9` - `DEV-0000053 - mark Task 5 git commits`

#### Overview

Close the server-side review finding by removing the partial-failure window in legacy resume backfill. A compatible legacy stopped flow must never stamp or validate child execution ownership against a newly minted execution id until that same execution id is already durably persisted on the parent flow conversation.

#### Task Exit Criteria

- For resume paths on legacy parent flow conversations that are missing `flags.flow.executionId`, the code persists the minted parent execution id before child ownership validation or child marker backfill can depend on it.
- A failure after that point no longer leaves the parent and child conversations in a mixed execution-identity state that makes the next resume attempt unrecoverable.
- Existing non-legacy resume behavior, same-execution child reuse, and conflict failure behavior remain unchanged apart from the ordering fix.

#### Documentation Locations

- `https://nodejs.org/api/crypto.html#cryptorandomuuidoptions` - use for the execution-id minting contract so the ordering fix does not introduce a second identity source.
- `https://www.mongodb.com/docs/manual/reference/operator/update/set/` - use for the nested `$set` behavior because the fix still needs to persist `flags.flow.executionId` and `flags.flowChild.executionId` through the existing conversation document update paths.

#### Subtasks

1. [x] Current Repository: Re-read the review artifacts plus the current server flow runtime around `parseFlowResumeState(...)`, `validateResumeAgentConversations(...)`, `persistFlowResumeState(...)`, and `ensureFlowChildConversationOwnership(...)` in `server/src/flows/service.ts`, along with the nested persistence helpers in `server/src/mongo/repo.ts`. Confirm exactly where the parent execution id becomes durable today and where child backfill can mutate state before that point.
2. [x] Current Repository: In `server/src/flows/service.ts`, change the legacy resume ordering so a missing parent `flags.flow.executionId` is persisted before any child validation or child execution-marker stamping can depend on that execution id. Keep the fix inside the existing flow-state persistence path; do not add a second collection, a second parent identity field, or a story-broad transaction system.
3. [x] Current Repository: Preserve the existing conflict behavior for bad child mappings. After the ordering fix, a missing child conversation, wrong-agent child conversation, or conflicting child execution marker must still fail clearly, but a compatible legacy child marker backfill must no longer be able to outrun the parent backfill.
4. [x] Current Repository: Add focused regression proof for the review finding in the server suites that already cover Story 53. At minimum, extend `server/src/test/integration/flows.run.resume.test.ts` with a scenario that forces a failure after legacy parent execution-id minting would previously have been only in memory and then retries resume to prove the parent and child state remain recoverable. If a narrower unit seam is helpful, extend `server/src/test/unit/flows.flags.test.ts` or another existing Story 53 server proof file, but keep the final proof on the supported `node:test` path.
5. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on.
6. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on.

#### Testing

1. [x] Current Repository: Run `npm run build:summary:server`. Do not attempt this check without the repository wrapper. Use this wrapper because the review finding is in the server flow runtime and persistence path. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Do not attempt this check without the repository wrapper. Use this wrapper because the review finding requires direct regression proof on the server `node:test` path. If `failed > 0`, inspect the exact printed `test-results/server-unit-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full `npm run test:summary:server:unit` wrapper.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Do not attempt this check without the repository wrapper. Use this wrapper because the Story 53 resume path must still hold on the supported higher-level server feature surface after the ordering fix. If `failed > 0`, inspect the exact printed `test-results/server-cucumber-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full `npm run test:summary:server:cucumber` wrapper.

#### Implementation notes

- Subtask 1: Re-read the review findings plus the Task 5 server seams and confirmed the partial-failure window: `startFlowRun(...)` was still calling `validateResumeAgentConversations(...)` on legacy resume state before `persistFlowResumeState(...)` had durably written the minted parent `flags.flow.executionId`, so child backfill could mutate state ahead of parent persistence.
- Subtask 2: Updated `server/src/flows/service.ts` so a legacy parent missing `flags.flow.executionId` now persists the minted parent execution id through the existing resume-state save path before any resume-time child ownership validation can depend on that id.
- Subtask 3: Kept the existing child-conflict contract intact by changing only the parent-backfill ordering; missing child conversations, wrong-agent mappings, and conflicting child execution markers still fail through the same ownership checks once the parent execution id is durable.
- Subtask 4: Extended `server/src/test/integration/flows.run.resume.test.ts` with a regression that reproduces the old mixed legacy-parent/child failure window, then retries resume after fixing the bad child mapping to prove the parent and child state remain recoverable on the supported `node:test` path.
- Subtask 5: Ran `npm run lint` after the Task 5 server changes and focused regression proof, and the full repository eslint pass completed cleanly without needing follow-up fixes.
- Subtask 6: `npm run format:check` first flagged the new integration proof and an existing review artifact, so I ran the required `npm run format` fallback and then reran `npm run format:check` cleanly.
- Testing 1: `npm run build:summary:server` passed cleanly with `warning_count: 0`, confirming the Task 5 server ordering fix still compiles on the supported build wrapper.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with `1520/1520` tests, confirming the new legacy-parent ordering regression proof and the existing Story 53 server suite both stay green on the supported `node:test` wrapper.
- Testing 3: `npm run test:summary:server:cucumber` passed cleanly with `76/76` scenarios, confirming the higher-level Story 53 resume behavior still holds on the supported cucumber surface after the ordering fix.

### Task 6. Restore Accurate Fresh-Run Custom-Title Acceptance Proof

- Repository Name: `Current Repository`
- Task Dependencies: `Task 4`
- Task Status: `__done__`
- Git Commits:
  - `75723985` - `DEV-0000053 - restore fresh run custom title behavior`
  - `26ea7e47` - `DEV-0000053 - mark Task 6 git commits`

#### Overview

Close the client-side review finding by making the Story 53 proof match the intended fresh-run contract. A fresh Run started from an older selected flow conversation must still use a new conversation id and must still preserve the normal new-run `customTitle` behavior unless the product code is intentionally changed to another explicit contract.

#### Task Exit Criteria

- The Story 53 client proof no longer asserts that `customTitle` is omitted for a fresh Run from an older selected conversation.
- The runtime behavior and the proof agree on one clear contract: a fresh Run keeps the new conversation-id semantics and preserves the intended custom-title behavior for brand-new runs.
- The updated proof still distinguishes fresh Run from Resume and does not weaken the existing Story 53 run-clue assertions.

#### Documentation Locations

- `https://playwright.dev/docs/locators` - use for browser-proof assertions if the focused proof is extended beyond RTL.

#### Subtasks

1. [x] Current Repository: Re-read the review findings plus the fresh-run code path in `client/src/pages/FlowsPage.tsx`, the request-shaping logic in `client/src/api/flows.ts`, and the focused proof file `client/src/test/flowsPage.run.test.tsx`. Confirm the intended Story 53 custom-title contract for a fresh Run from an older selected conversation before changing either the proof or runtime.
2. [x] Current Repository: Update `client/src/test/flowsPage.run.test.tsx` so the fresh-run proof from an older selected conversation asserts the correct Story 53 behavior: the request uses a new conversation id and preserves the intended `customTitle` semantics for a brand-new run. If that proof exposes a real runtime mismatch, fix the runtime in `client/src/pages/FlowsPage.tsx` and/or `client/src/api/flows.ts` so the product matches the canonical plan before closing this task.
3. [x] Current Repository: Keep the existing Run-versus-Resume split explicit. The updated proof must still show that Resume reuses the selected stopped conversation id while Run does not, and it must not accidentally collapse those two cases back together while fixing the custom-title assertion.
4. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on.
5. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on.

#### Testing

1. [x] Current Repository: Run `npm run build:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because the review finding is in the client run-start proof surface and may require a small runtime correction in the Flows page or flow API helper. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun `npm run build:summary:client`.
2. [x] Current Repository: Run `npm run test:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because the review finding is specifically about incorrect client acceptance proof and the Run-versus-Resume payload contract. If `failed > 0`, inspect the exact printed client test log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, and/or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full `npm run test:summary:client` wrapper.

#### Implementation notes

- Subtask 1: Re-read the review finding plus the current fresh-run code path in `FlowsPage.tsx`, `flows.ts`, and `flowsPage.run.test.tsx`, and confirmed the intended Story 53 contract is fresh Run plus preserved `customTitle` even when an older flow conversation is selected.
- Subtask 2: Updated the focused Story 53 proof in `client/src/test/flowsPage.run.test.tsx`, then fixed the real runtime mismatch in `FlowsPage.tsx` by keeping the custom-title input enabled for fresh runs from older selected conversations while leaving resume-time omission rules unchanged in `flows.ts`.
- Subtask 3: Kept the Run-versus-Resume split explicit by narrowing the UI fix to the fresh-run input gating; Resume coverage remains separate and still proves Resume reuses the selected stopped conversation id while Run does not.
- Subtask 4: Ran `npm run lint` after the Task 6 proof and runtime correction and the full repository eslint pass completed cleanly without follow-up fixes.
- Subtask 5: `npm run format:check` passed cleanly after the Task 6 proof and runtime correction, so no formatter fallback was needed for this task.
- Testing 1: `npm run build:summary:client` passed cleanly with `warning_count: 0`, confirming the Task 6 proof-and-runtime correction leaves the supported client typecheck-and-build wrapper green.
- Testing 2: Re-ran the full `npm run test:summary:client` wrapper after fixing the Flows-page custom-title input gating; the full client suite passed cleanly with `654/654` green after the focused Story 53 proof also passed in isolation.

### Task 7. Revalidate Story 53 After Review Fixes

- Repository Name: `Current Repository`
- Task Dependencies: `Task 5, Task 6`
- Task Status: `__done__`
- Git Commits:
  - `02e698f9` - `DEV-0000053 - revalidate story 53 after review fixes`
  - `54b62bab` - `DEV-0000053 - mark Task 7 git commits`

#### Overview

Run a fresh Story 53 close-out pass after the review-fix tasks land. This task revalidates the acceptance criteria, confirms the review findings are closed, and refreshes the durable review and proof trail before the story is treated as complete again.

#### Task Exit Criteria

- The review findings are either fully fixed in code/proof or demonstrably resolved by the changed acceptance proof.
- The full Story 53 automated validation path passes again after the review-fix tasks.
- The final implementation notes for this task explicitly record that the review findings were rechecked and closed.

#### Documentation Locations

- `https://playwright.dev/docs/debug` - use for the final manual browser verification if the review-fix path touches visible Flows or Agents behavior.
- `https://playwright.dev/docs/screenshots` - use for final screenshot capture when the manual browser pass is rerun.

#### Subtasks

1. [x] Current Repository: Re-read the canonical Story 53 plan plus the durable review artifacts `codeInfoStatus/reviews/0000053-20260328T173221Z-91fa391b-evidence.md`, `codeInfoStatus/reviews/0000053-20260328T173221Z-91fa391b-findings.md`, and `codeInfoStatus/reviews/0000053-20260328T173221Z-91fa391b-blind-spot-challenge.md`. Record in this task’s Implementation notes exactly how Task 5 and Task 6 closed the `must_fix` and `should_fix` findings.
2. [x] Current Repository: If the Task 5 server fix changed the runtime path or persisted state shape in any user-visible way, refresh `codeInfoStatus/pr-summaries/0000053-pr-summary.md`, `design.md`, `docs/developer-reference.md`, or `projectStructure.md` only where the final truth changed. If no document change is needed, record that explicit no-change result in this task’s Implementation notes.
3. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by the review-fix tasks before moving on.
4. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by the review-fix tasks before moving on.

#### Testing

1. [x] Current Repository: Run `npm run compose:build:summary`. Do not attempt this check without the repository wrapper. Use this wrapper first because the reopened work still spans the server-plus-client Story 53 system and the final review disposition must be backed by the repository’s supported compose build path. If the wrapper reports `failed`, or item counts indicate failures or unknown results in a failure run, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun `npm run compose:build:summary`.
2. [x] Current Repository: Run `npm run build:summary:server`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 5 changes the server flow runtime and resume ordering path, and server/common checks are mandatory for this final regression pass. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
3. [x] Current Repository: Run `npm run build:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 6 may touch the Flows page proof or flow-run request helper path, and client/common checks are mandatory for this final regression pass. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun `npm run build:summary:client`.
4. [x] Current Repository: Run `npm run test:summary:server:unit`. Do not attempt this check without the repository wrapper. Use this wrapper because the reopened `must_fix` finding is a server lifecycle and persistence-ordering defect that needs direct regression proof. If `failed > 0`, inspect the exact printed `test-results/server-unit-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full `npm run test:summary:server:unit` wrapper.
5. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Do not attempt this check without the repository wrapper. Use this wrapper because the Story 53 resume path must still hold on the supported higher-level server feature surface after the review-fix work. If `failed > 0`, inspect the exact printed `test-results/server-cucumber-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full `npm run test:summary:server:cucumber` wrapper.
6. [x] Current Repository: Run `npm run test:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because the reopened `should_fix` finding is a client acceptance-proof problem and the Story 53 Run-versus-Resume client proof must still pass cleanly after correction. If `failed > 0`, inspect the exact printed client test log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, and/or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full `npm run test:summary:client` wrapper.
7. [x] Current Repository: Run `npm run test:summary:e2e` and allow up to 7 minutes for the wrapper to finish. Do not attempt this check without the repository wrapper. Use this wrapper because Story 53 still changes user-visible Flows and Agents behavior that should remain green on the supported browser-backed path after the review-fix work. If `failed > 0`, setup or teardown fails, or the wrapper reports unexpected ambiguity, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep <pattern>`, then rerun the full `npm run test:summary:e2e` wrapper.
8. [x] Current Repository: Run `npm run compose:up`. Do not attempt this check without the repository wrapper. Use this wrapper because this task is the final regression check and the manual Playwright MCP pass must run against the supported main stack.
9. [x] Current Repository: Perform final manual Playwright MCP validation against `http://host.docker.internal:5001/flows` and `http://host.docker.internal:5001/agents`. Confirm the Story 53 behavior and surrounding regressions, confirm there are no error-level console messages during the pass, and save fresh screenshots under `playwright-output-local` with the Story 53 prefix when the visible proof changed or the earlier screenshots are no longer representative. If the review-fix work stayed server-internal or proof-only and the earlier visible Story 53 proof is still representative, record that explicit no-repeat-screenshot decision in this task’s Implementation notes instead of silently skipping the manual verification.
10. [x] Current Repository: Run `npm run compose:down`. Do not attempt this check without the repository wrapper. Use this wrapper after the manual Playwright MCP validation so the supported stack is torn down through the repository workflow.

#### Implementation notes

- Subtask 1: Re-read the canonical Story 53 plan plus the durable review artifacts and recorded that Task 5 closed the `must_fix` finding by persisting legacy parent `flags.flow.executionId` before child validation/backfill, while Task 6 closed the `should_fix` finding by aligning the fresh-run custom-title proof with the corrected Flows-page input gating and preserving the Run-versus-Resume contract.
- Subtask 2: Re-checked `codeInfoStatus/pr-summaries/0000053-pr-summary.md`, `design.md`, `docs/developer-reference.md`, and `projectStructure.md` after the Task 5 and Task 6 fixes and confirmed no additional documentation change is needed because those review-fix tasks restored the existing final Story 53 contract rather than changing it.
- Subtask 3: `npm run lint` first caught one leftover unused local in `client/src/pages/FlowsPage.tsx` from the Task 6 custom-title gating change; after removing that dead variable, the full repository eslint pass completed cleanly.
- Subtask 4: `npm run format:check` passed cleanly after the Task 7 review-closeout notes and the one-line Flows-page cleanup, so no formatter fallback was needed in this task.
- Testing 1: `npm run compose:build:summary` passed cleanly with `items passed: 2` and `items failed: 0`, confirming the supported main-stack images still build after the Task 5 and Task 6 review fixes.
- Testing 2: `npm run build:summary:server` passed cleanly with `warning_count: 0`, confirming the Task 5 server ordering fix and Story 53 runtime still compile on the supported server build wrapper.
- Testing 3: `npm run build:summary:client` passed cleanly with `warning_count: 0`, confirming the Task 6 Flows-page fix and acceptance proof still compile on the supported client build wrapper.
- Testing 4: `npm run test:summary:server:unit` passed cleanly with `1520/1520` tests, confirming the Task 5 legacy-parent ordering regression proof and the broader Story 53 server suite still hold on the supported `node:test` wrapper.
- Testing 5: `npm run test:summary:server:cucumber` passed cleanly with `76/76` scenarios, confirming the supported higher-level Story 53 flow surface still holds after the review-fix tasks.
- Testing 6: `npm run test:summary:client` passed cleanly with `654/654` tests, confirming the Task 6 fresh-run custom-title correction and the wider Story 53 client proof surface stay green on the supported wrapper.
- Testing 7: `npm run test:summary:e2e` finished with wrapper `status: passed` but `agent_action: inspect_log` because of `ambiguous_counts`; `logs/test-summaries/e2e-tests-latest.log` confirmed the Playwright stats were `expected: 51`, `skipped: 3`, and `unexpected: 0`, so the supported browser-backed suite remained green.
- Testing 8: `npm run compose:up` started the supported main stack cleanly, including the `playwright-mcp` service needed for the final manual verification against the host-mapped client URLs.
- Testing 9: Manual Playwright MCP verification against `http://host.docker.internal:5001/flows` and `/agents` confirmed two `Story53 manual echo` rows with distinct clues (`Run ee6e75e2` and `Run f0938f05`) in Flows, matching `planning_agent` child rows with the same clues in Agents, and an ordinary `Command:` row with no run clue; fresh screenshots were saved as `playwright-output-local/0000053-7-main-flows.png` and `playwright-output-local/0000053-7-main-agents.png`, I inspected both saved images, and the Playwright console error query returned no entries during the pass.
- Testing 10: `npm run compose:down` stopped and removed the supported main validation stack cleanly after the final manual Playwright MCP pass.

### Task 8. Correct Post-Closure Flow Proof Semantics And Disabled Custom Title Submission

- Repository Name: `Current Repository`
- Task Dependencies: `Task 7`
- Task Status: `__done__`
- Git Commits:
  - `7094aca3` - `DEV-0000053 - correct stale run payload and proof semantics`
  - `80eba7df` - `DEV-0000053 - mark Task 8 git commits`
  - `a3a8eef8` - `DEV-0000053 - finalize Task 8 git commit ledger`

#### Overview

Address the three valid follow-up review comments without broadening Story 53. The client must stop sending a stale `customTitle` when a resumable conversation disables the input but the user still clicks `Run`, and the stale working-folder integration proofs must be rewritten so each test title matches the behavior it actually proves.

#### Task Exit Criteria

- `Run` from a resumable-selection state does not include a stale disabled `customTitle` in the client request payload.
- The stale working-folder integration tests in `server/src/test/integration/flows.run.working-folder.test.ts` no longer claim to prove stale-clear or stale-log behavior unless their assertions directly prove those invariants.
- Each changed or added proof file in this task has one subtask of its own so reviewers can trace the intended invariant to the exact file update.

#### Documentation Locations

- `https://testing-library.com/docs/react-testing-library/intro/` - use for the React Testing Library patterns needed when proving that a disabled Flows-page input no longer leaks stale state into the run payload.
- `https://nodejs.org/api/test.html` - use for the `node:test` structure already used by the server integration tests in this repository.

#### Subtasks

1. [x] Current Repository: Re-read the valid follow-up comments and inspect `client/src/pages/FlowsPage.tsx`, `client/src/test/flowsPage.run.test.tsx`, and `server/src/test/integration/flows.run.working-folder.test.ts` together before editing. Record in this task’s Implementation notes the exact three invariants being corrected: disabled stale `customTitle` must not leak into `Run`, the stale-rerun working-folder proof must match the fresh-run-no-inherit path it actually exercises, and the stale-log proof must either assert the log marker on a real stale-clear path or stop claiming that behavior.
1. [x] Current Repository: In `client/src/pages/FlowsPage.tsx`, update the `Run` payload-construction path so a resumable-selection state cannot submit a stale disabled `customTitle`. Keep the Story 53 contract that `Run` still starts a fresh conversation and `Resume` still reuses the stopped conversation; this task only hardens stale-state handling and must not broaden the page into a larger flow-reset redesign. Documentation: https://testing-library.com/docs/react-testing-library/intro/ .
1. [x] Current Repository: Update `client/src/test/flowsPage.run.test.tsx` in its own proof-focused change. Add or rewrite exactly one RTL test that types a custom title, selects a resumable flow conversation, confirms the custom-title input becomes disabled, clicks `Run`, and proves the resulting `/flows/<name>/run` request does not include `customTitle`. Keep this proof isolated in its own test case rather than burying it inside an unrelated Story 53 assertion block. Documentation: https://testing-library.com/docs/react-testing-library/intro/ .
1. [x] Current Repository: Update the stale-rerun proof inside `server/src/test/integration/flows.run.working-folder.test.ts` in its own proof-focused change. Rename or rewrite that one test so its title and assertions match the fresh-run path it actually exercises after Story 53, namely that a fresh run started from an older flow conversation gets a new parent conversation and does not inherit the stale saved working folder automatically. Do not let this test continue to claim it proves stale-clear-on-reuse unless its assertions are moved onto the real stale-clear path. Documentation: https://nodejs.org/api/test.html .
1. [x] Current Repository: Update the stale-log proof inside `server/src/test/integration/flows.run.working-folder.test.ts` in its own proof-focused change. Either restore direct assertions for `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION` on a real stale-clear path, including `recordType`, `stalePath`, and `conversationId`, or rename/rewrite the test so it no longer claims to prove stale-path logging. Keep this as a separate proof step from the stale-rerun test change so the semantics of the two integration proofs remain independently reviewable. Documentation: https://nodejs.org/api/test.html .
1. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
1. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [x] Current Repository: Run `npm run build:summary:server`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 8 changes server integration proof files and the current-repository wrapper is the supported build path for server validation. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run build:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 8 changes the Flows page request-building path and client/common checks are required before trusting the new stale-state proof. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun `npm run build:summary:client`.
3. [x] Current Repository: Run `npm run test:summary:server:unit`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 8 changes server `node:test` integration proof files and must prove the renamed or rewritten working-folder semantics cleanly on the supported server unit/integration path. If `failed > 0`, inspect the exact printed `test-results/server-unit-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full `npm run test:summary:server:unit` wrapper.
4. [x] Current Repository: Run `npm run test:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because Task 8 changes the Flows-page stale-state submission path and must prove the new disabled-custom-title assertion on the supported client test path. If `failed > 0`, inspect the exact printed client test log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, and/or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full `npm run test:summary:client` wrapper.

#### Implementation Notes

- Subtask 1: Re-read the Task 8 review follow-up context plus the current client and server proof files, and confirmed the three invariants to correct are disabled stale `customTitle` omission on fresh Run, honest fresh-run-no-inherit semantics for the stale-rerun working-folder proof, and honest stale-log coverage that only claims log assertions if the test actually checks them.
- Subtask 2: Updated `FlowsPage.tsx` so fresh Run omits `customTitle` whenever the selected conversation is resumable and the custom-title input is disabled, while preserving the existing fresh Run versus Resume routing.
- Subtask 3: Added a focused RTL proof in `flowsPage.run.test.tsx` that types a custom title, selects a resumable flow conversation, verifies the input is disabled, clicks Run, and confirms the `/flows/daily/run` payload omits `customTitle`.
- Subtask 4: Renamed the stale-rerun working-folder integration proof so it now truthfully describes the Story 53 fresh-run path it exercises: a new parent conversation is created and the stale saved working folder is not inherited automatically.
- Subtask 5: Corrected the stale-log proof semantics in `flows.run.working-folder.test.ts` so the final test no longer overclaims stale-log coverage on the fresh-run replacement path and instead truthfully proves that the replacement conversation starts without inheriting the stale saved working folder.
- Subtask 6: Ran `npm run lint` after the Task 8 client and proof updates, and the full repository eslint pass completed cleanly without needing the `lint:fix` fallback.
- Subtask 7: `npm run format:check` flagged only the active Story 53 plan file after the live checkbox updates, so I ran the required `npm run format` fallback and then reran `npm run format:check` cleanly.
- Testing 1: `npm run build:summary:server` passed cleanly with `warning_count: 0`, confirming the renamed working-folder proofs still compile on the supported server build wrapper.
- Testing 2: `npm run build:summary:client` passed cleanly with `warning_count: 0`, confirming the Flows-page stale-title payload guard and focused RTL proof still satisfy the supported client typecheck-and-build wrapper.
- Subtask 5: Adjusted the stale-log proof after the first server-unit run showed that the fresh-run replacement path does not emit the stale-clear marker on that route anymore, so the test now truthfully proves that the replacement conversation still starts without inheriting the stale saved working folder instead of overclaiming log coverage.
- Testing 3: The first `npm run test:summary:server:unit` run failed only on the new stale-log proof, so I inspected `test-results/server-unit-tests-2026-03-28T21-24-05-570Z.log`, confirmed the fresh-run replacement path no longer produced the claimed marker, reran the focused file with `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.working-folder.test.ts`, and then reran the full wrapper cleanly with `1520/1520` passing.
- Testing 4: `npm run test:summary:client` passed cleanly with `655/655` tests, confirming the new disabled-custom-title proof and the wider Flows-page client suite both stay green on the supported wrapper.

### Task 9. Revalidate Story 53 After Proof-Semantics Follow-Up

- Repository Name: `Current Repository`
- Task Dependencies: `Task 8`
- Task Status: `__done__`
- Git Commits:
  - `10630afc` - `DEV-0000053 - finish final story revalidation`
  - `0e8cbaf3` - `DEV-0000053 - mark Task 9 git commits`
  - `9b8ed2d0` - `DEV-0000053 - finalize Task 9 git commit ledger`

#### Overview

Re-run the full Story 53 validation path after Task 8 so the story closes again with the corrected client behavior and corrected proof semantics. This task is the final regression and close-out pass for the reopened Story 53 scope only.

#### Task Exit Criteria

- The Task 8 stale custom-title fix and server proof-semantic corrections are validated by the full relevant wrapper path.
- The final Story 53 notes explicitly record that the three follow-up review comments were rechecked and closed.
- No new Story 53 regression is introduced while correcting the reopened proof and stale-state issues.

#### Documentation Locations

- `https://playwright.dev/docs/debug` - use for the final manual browser verification if Task 8 changes any visible Flows behavior or if the fresh-run payload contract needs browser confirmation.
- `https://playwright.dev/docs/screenshots` - use for screenshot capture if fresh manual proof is needed after Task 8.

#### Subtasks

1. [x] Current Repository: Re-read Task 8 plus the valid follow-up comments before marking the story complete again. Record in this task’s Implementation notes exactly how each comment was closed and which wrapper or manual proof confirms the final result.
2. [x] Current Repository: Refresh `codeInfoStatus/pr-summaries/0000053-pr-summary.md`, `design.md`, `docs/developer-reference.md`, `projectStructure.md`, or this story file only if Task 8 changed the final truth described there. If no documentation update is needed, record that explicit no-change decision in this task’s Implementation notes instead of leaving it implicit.
3. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by Task 8 and this task before moving on. Documentation: Context7 `/eslint/eslint`.
4. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by Task 8 and this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [x] Current Repository: Run `npm run compose:build:summary`. Do not attempt this check without the repository wrapper. Use this wrapper first because Task 9 is the final regression pass for the server-plus-client Story 53 system. If the wrapper reports `failed`, or item counts indicate failures or unknown results in a failure run, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun `npm run compose:build:summary`.
2. [x] Current Repository: Run `npm run build:summary:server`. Do not attempt this check without the repository wrapper. Use this wrapper because the reopened work still touches server integration proof and flow-run behavior. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
3. [x] Current Repository: Run `npm run build:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because the reopened work changes Flows-page request construction and the final client/common regression pass must be clean. If the wrapper reports `failed`, unexpected warnings, or ambiguous output, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun `npm run build:summary:client`.
4. [x] Current Repository: Run `npm run test:summary:server:unit`. Do not attempt this check without the repository wrapper. Use this wrapper because the reopened work changes server `node:test` integration proof and the final Story 53 server regression path must stay green. If `failed > 0`, inspect the exact printed `test-results/server-unit-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun the full `npm run test:summary:server:unit` wrapper.
5. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Do not attempt this check without the repository wrapper. Use this wrapper because the Story 53 higher-level flow contract must remain green after the Task 8 follow-up corrections. If `failed > 0`, inspect the exact printed `test-results/server-cucumber-tests-*.log` path, diagnose only with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun the full `npm run test:summary:server:cucumber` wrapper.
6. [x] Current Repository: Run `npm run test:summary:client`. Do not attempt this check without the repository wrapper. Use this wrapper because the reopened work changes the Flows-page stale-state submission path and final Story 53 client regression proof must stay green. If `failed > 0`, inspect the exact printed client test log path under `test-results/client-tests-*.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset <pattern>`, and/or `npm run test:summary:client -- --test-name <pattern>`, then rerun the full `npm run test:summary:client` wrapper.
7. [x] Current Repository: Run `npm run test:summary:e2e` and allow up to 7 minutes for the wrapper to finish. Do not attempt this check without the repository wrapper. Use this wrapper because Story 53 still owns user-visible Flows and Agents behavior that must remain green after the Task 8 corrections. If `failed > 0`, setup or teardown fails, or the wrapper reports unexpected ambiguity, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose only with targeted wrapper reruns such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep <pattern>`, then rerun the full `npm run test:summary:e2e` wrapper.
8. [x] Current Repository: Run `npm run compose:up`. Do not attempt this check without the repository wrapper. Use this wrapper because this task is the final regression check and the manual Playwright MCP pass must run against the supported main stack.
9. [x] Current Repository: Perform final manual Playwright MCP validation against `http://host.docker.internal:5001/flows` and `http://host.docker.internal:5001/agents`. Confirm the corrected Story 53 behavior, confirm there are no error-level console messages during the pass, and save fresh screenshots under `playwright-output-local` with the Story 53 prefix if the visible proof changed or the earlier screenshots are no longer representative. If Task 8 stayed proof-only on the server side and the earlier visible Story 53 proof remains representative, record that explicit no-repeat-screenshot decision in this task’s Implementation notes instead of silently skipping the manual verification.
10. [x] Current Repository: Run `npm run compose:down`. Do not attempt this check without the repository wrapper. Use this wrapper after the manual Playwright MCP validation so the supported stack is torn down through the repository workflow.

#### Implementation Notes

- Subtask 1: Re-read Task 8 and the original follow-up findings, and confirmed the three comments are now closed by the Task 5 legacy-parent ordering proof, the Task 8 server proof-semantics correction plus final server-unit rerun, and the Task 8 stale-custom-title client proof plus wrapper-backed client regression pass.
- Subtask 2: Updated `codeInfoStatus/pr-summaries/0000053-pr-summary.md` because it still stopped at Task 4 and older manual-proof artifacts; no changes were needed in `design.md`, `docs/developer-reference.md`, `projectStructure.md`, or this story file because their described Story 53 contract already matched the Task 8 final truth.
- Subtask 3: Ran `npm run lint` after the Task 9 review-closeout note and PR-summary refresh, and the full repository eslint pass completed cleanly without needing the `lint:fix` fallback.
- Subtask 4: Ran `npm run format:check` after the Task 9 plan and PR-summary updates, and Prettier reported the repository was already clean so no formatter fallback was needed.
- Testing 1: `npm run compose:build:summary` passed cleanly with `items passed: 2` and `items failed: 0`, confirming the supported main-stack images still build after the Task 8 follow-up corrections and the Task 9 documentation refresh.
- Testing 2: `npm run build:summary:server` passed cleanly with `warning_count: 0`, confirming the Story 53 server runtime and proof surfaces still compile after the Task 9 close-out updates.
- Testing 3: `npm run build:summary:client` passed cleanly with `warning_count: 0`, confirming the Flows-page stale-title fix and Task 9 doc refresh still satisfy the supported client typecheck-and-build wrapper.
- Testing 4: `npm run test:summary:server:unit` passed cleanly with `1520/1520` tests, confirming the Task 8 proof-semantics corrections and the broader Story 53 server suite still hold on the supported `node:test` wrapper.
- Testing 5: `npm run test:summary:server:cucumber` passed cleanly with `76/76` scenarios, confirming the higher-level Story 53 flow behavior still holds on the supported cucumber surface after Task 8.
- Testing 6: `npm run test:summary:client` passed cleanly with `655/655` tests, confirming the final stale-custom-title proof and the wider Story 53 client suite remain green on the supported wrapper.
- Testing 7: `npm run test:summary:e2e` finished with wrapper `status: passed` but `agent_action: inspect_log` because of `ambiguous_counts`; `logs/test-summaries/e2e-tests-latest.log` confirmed Playwright stats `expected: 54`, `skipped: 0`, and `unexpected: 0`, so the final browser-backed regression path was accepted as green.
- Testing 8: `npm run compose:up` started the supported main stack cleanly, including the `playwright-mcp` service needed for the final manual verification against `http://host.docker.internal:5001`.
- Testing 9: Rechecked the final manual Story 53 browser proof against `http://host.docker.internal:5001/flows` and `/agents`, confirmed the two `Story53 manual echo` parent rows still render distinct `Run <shortExecutionId>` clues, confirmed the `planning_agent` child rows show the matching run clues while ordinary `Command:` rows do not gain one, and confirmed Playwright reported no error-level console messages during the pass; because Task 8 only changed stale payload submission plus proof semantics and the visible UI remained representative, no fresh screenshots were needed beyond the existing Task 7 artifacts.
- Testing 10: Ran `npm run compose:down` through the repository wrapper after the final manual Playwright pass, and the supported Story 53 validation stack shut down cleanly without needing extra log diagnosis.

## Post-Implementation Code Review

### Review Artifacts

- Evidence artifact: `codeInfoStatus/reviews/0000053-20260328T223501Z-f38414be-evidence.md`
- Findings artifact: `codeInfoStatus/reviews/0000053-20260328T223501Z-f38414be-findings.md`
- Blind-spot challenge artifact: `codeInfoStatus/reviews/0000053-20260328T223501Z-f38414be-blind-spot-challenge.md`
- Review handoff: `codeInfoStatus/reviews/0000053-current-review.json`

### Scope And Base Checks

- Review scope was normalized from `codeInfoStatus/flow-state/current-plan.json`, which still points to this canonical plan and still lists `additional_repositories: []`.
- The current repository remained on `feature/53-fresh-flow-agent-conversations` during the review pass, and the story number still matched `planning/0000053-users-can-start-each-flow-execution-with-fresh-agent-conversations.md`.
- The review evidence and findings handoff for this pass used `origin/main` as the resolved base branch because `current-plan.json` preserved `branched_from: "main"` and the remote default branch resolves to `origin/main`.
- No cross-repository review work was required because Story 53 stayed single-repository all the way through the completed implementation and review-fix tasks, so no repository sequencing or integration repair was needed.

### Files Inspected

- Server runtime and persistence: `server/src/flows/service.ts`, `server/src/flows/flowState.ts`, `server/src/flows/types.ts`, `server/src/mongo/repo.ts`
- Client runtime and sidebar rendering: `client/src/pages/FlowsPage.tsx`, `client/src/components/chat/ConversationList.tsx`, `client/src/api/conversations.ts`, `client/src/hooks/useConversations.ts`
- Server proof: `server/src/test/unit/flows.flags.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.test.ts`, `server/src/test/integration/flows.run.command.test.ts`, `server/src/test/integration/flows.run.errors.test.ts`, `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/integration/flows.run.working-folder.test.ts`, `server/src/test/integration/conversations.flowname.test.ts`, `server/src/test/features/flows-execution-runs.feature`, `server/src/test/steps/flows-execution-runs.steps.ts`
- Client and browser proof: `client/src/test/flowsPage.run.test.tsx`, `client/src/test/flowsPage.stop.test.tsx`, `client/src/test/chatSidebar.test.tsx`, `client/src/test/agentsPage.sidebarWs.test.tsx`, `e2e/flows-execution-runs.spec.ts`
- Supporting default-path selectors and consumers reviewed for honest reachability checks: `package.json`, `playwright.config.ts`, `server/src/routes/flowsRun.ts`, `server/src/routes/conversations.ts`, `server/src/ws/sidebar.ts`, `server/src/mongo/conversation.ts`, `server/src/agents/runLock.ts`

### Acceptance Criteria Proof Status

1. Fresh flow start creates a new `executionId`: `direct`
2. The current flow execution persists its `executionId` in `conversation.flags.flow`: `direct`
3. Each fresh flow start opens a new parent flow conversation: `direct`
4. A fresh flow start creates a fresh per-execution agent mapping and does not reuse older execution child conversations: `direct`
5. Flow agent reuse remains available within one execution: `direct`
6. The persisted `agentConversations` mapping remains `${agentType}:${identifier}` but execution-scoped: `direct`
7. The runtime no longer relies on a process-global agent-conversation map for cross-execution reuse: `direct`
8. Starting the same flow again as a new execution creates fresh child conversations even with the same identifiers: `direct`
9. Resuming a stopped flow continues the same `executionId`: `direct`
10. Resuming a stopped flow continues using the same child conversations for that execution: `direct`
11. Flow parent conversations persist execution identity under `conversation.flags.flow.executionId`: `direct`
12. Flow-created child conversations persist `flags.flowChild.executionId`: `direct`
13. Flow-created child conversations remain visible in the normal Agents page sidebar: `direct`
14. Repeated executions show the lightweight `Run <shortExecutionId>` clue: `direct`
15. The clue is derived directly from `executionId` rather than a separate ordinal: `direct`
16. The clue is shown in existing sidebar metadata rather than the main title: `direct`
17. A user can open a child conversation and continue chatting manually while the parent flow is stopped: `indirect`
18. Resume continues the same child conversation rather than creating a replacement: `direct`
19. Manual chat added while stopped remains part of resumed context: `direct`
20. Resume uses the current persisted child state rather than an old snapshot: `direct`
21. The child agent conversation remains a normal conversation and is not hidden, locked, or made flow-only: `direct`
22. Stopping a flow preserves enough execution state to resume later: `direct`
23. Starting a new flow execution does not copy or inherit the previous slot mapping: `direct`
24. Existing stopped flows without `executionId` remain resumable through backfill: `direct`
25. Fresh executions of the same flow may run concurrently in different parent conversations: `direct`
26. Existing `RUN_IN_PROGRESS` protection remains scoped to a single conversation: `direct`
27. Existing agent sidebar behavior remains intact apart from showing the normal child conversations and run clue: `direct`
28. Existing within-execution `agentType`/`identifier` slot semantics remain intact: `direct`
29. Missing or wrong-agent stored child conversations fail clearly on resume: `direct`
30. Conflicting child execution markers fail clearly on resume: `direct`
31. The story does not add a broader multi-execution history subsystem: `direct`

### Why The Repository Remains Complete

- The current repository remains complete because the final branch diff satisfies the planned server runtime, client UI, persistence, compatibility, and validation work without requiring any additional repository changes.
- Acceptance evidence is sufficient for closure: the implementation has direct proof for the core execution-isolation, resume-safety, sidebar-clue, and run-vs-resume contract, with only a small number of explicitly recorded indirect areas.
- The code remains appropriately succinct for the required behavior. The two largest changed areas are `server/src/flows/service.ts` and `server/src/test/integration/flows.run.resume.test.ts`, but the review did not find a concrete simplification that was localized, objectively testable, and worth reopening after the completed review-fix tasks.
- The changed docs (`design.md`, `docs/developer-reference.md`, and `projectStructure.md`) stay aligned with the implemented Story 53 contract, and no further repository-owned follow-up work is required by the final no-findings review disposition.
- Because there are no additional repositories in scope, cross-repository integration evidence was not required beyond confirming that the story stayed inside one repository and did not create an unstated producer/consumer seam elsewhere.

### Generic Adversarial Checklist Status

- Execution-routing or harness dependence: `indirect`
  - I re-checked `package.json` and `playwright.config.ts` so the changed server/client/e2e proof remains in the default wrapper and Playwright discovery paths, but the wrappers themselves were not re-run during this review step.
- Default launcher, wrapper, dispatcher, CI, or startup-path inclusion: `indirect`
  - The completed Task 7 and Task 9 notes record successful wrapper-backed regression runs, and the review confirmed the changed files still sit behind the same default selectors.
- Shared-state or concurrency safety: `direct`
  - The server review covered per-conversation lock scope, execution-scoped runtime state, and retry-after-failure flow behavior with direct integration/unit proof.
- Reader/writer atomicity or partial-write tolerance: `indirect`
  - Parent and child execution markers use existing nested `$set` update paths and the reviewed retry proof covers the most important parent-before-child ordering issue, but the review did not prove every possible partial-write or crash point.
- Cleanup ownership or stale-state safety: `indirect`
  - The changed tests include cleanup coverage and the review checked the relevant cleanup paths, but crash-recovery and stale-state handling still rely partly on reasoning from the existing runtime design rather than a new exhaustive proof matrix.
- Lifecycle ordering: `direct`
  - The review directly checked fresh start versus resume routing, legacy parent backfill ordering, child ownership validation, and final Run-versus-Resume UI behavior.
- Test isolation: `indirect`
  - The changed test code includes cleanup and temp-file teardown, but the review did not add new worker-stress or parallel-interference proof beyond the existing suite structure.

### Rejected-Risk Carryforward

- `startFlowRun(...)` in `server/src/flows/service.ts`: the findings pass rejected the risk that a legacy parent without `executionId` could still leave parent and child state mixed after a failed resume. The blind-spot challenge strengthened that conclusion by separately checking the fresh-run replacement path against the stale-working-folder proofs.
- `ensureFlowChildConversationOwnership(...)` in `server/src/flows/service.ts`: the findings pass rejected the risk that missing, wrong-agent, or conflicting child mappings could be silently reused. The blind-spot challenge left one residual weak-proof concern for a whitespace-only or otherwise malformed child execution marker because the code trims and treats that case as missing, but there is not a dedicated branch-local test just for that variant.
- `startFlowRun(...)` in `client/src/pages/FlowsPage.tsx`: the findings pass rejected the risk that `Run` from an older selected conversation could still reuse the selected conversation or leak a stale hidden `customTitle`. The blind-spot challenge strengthened that conclusion by matching the final callback logic directly against the focused RTL assertions.

### Residual Risks

- The screenshot portion of the final manual proof remains `indirect` because Task 9 explicitly relied on the earlier representative Task 7 artifacts instead of capturing a new screenshot set after the proof-semantics-only follow-up.
- The changed workflow configuration under `flows/improve_task_implement_plan.json` now references `improve_plan2` and `task_up2`. The review confirmed the unchanged flow command loader resolves command files dynamically and that both new command JSON files exist, so no defect was endorsed, but the exact workflow path still has only indirect proof in this branch.

## Final Summary

1. Story 53 changed the current repository only. On the server side, flow runs now persist `flags.flow.executionId`, keep agent-slot reuse scoped to one execution instead of a process-global map, backfill legacy parent and child execution markers on compatible resume paths, and fail clearly when a saved child mapping is missing, points to the wrong agent, or belongs to a different execution. On the client side, the Flows page now treats `Run` as a fresh parent conversation and `Resume` as reuse of the stopped conversation, while the shared sidebar renders `Run <shortExecutionId>` from persisted flags for both parent flow rows and flow-created child agent rows without changing conversation titles. The story also added and updated the matching unit, integration, cucumber, RTL, e2e, documentation, PR-summary, and review artifacts needed to prove and describe the final contract.

2. These changes were needed because a fresh execution of the same flow could previously reuse an older child agent conversation whenever the same `agentType` and `identifier` appeared again, which made a new run feel unsafe and blurred the boundary between a true fresh start and a resume. The fix keeps the design simple by introducing `executionId` as the scope boundary instead of building a larger execution-history subsystem. It also preserves the existing product model that flow-created child conversations remain normal visible agent chats, so users can still open them in Agents, chat manually, and later resume the parent flow against that same child conversation.

3. The most complex logic is in the flow runtime’s ordering and ownership checks. A resume now has to make sure the parent flow conversation has a durable `flags.flow.executionId` before any child execution-marker backfill can depend on it, otherwise a failed resume could leave parent and child state out of sync. After that, child ownership validation must accept the compatible legacy case where a child conversation is missing its execution marker and needs to be stamped, while still rejecting the incompatible cases where the saved conversation is missing, belongs to the wrong agent, or already carries a conflicting execution marker. On the client side, the subtle part was keeping `Run` and `Resume` separate even when an older flow conversation is selected, so a fresh run still gets a new conversation id and keeps the intended `customTitle` behavior.

4. A reviewer should look most closely at `server/src/flows/service.ts`, especially the `startFlowRun(...)` ordering around legacy parent backfill and the `ensureFlowChildConversationOwnership(...)` checks, because those two paths preserve the core execution-isolation and resume-safety contract. The other main hotspot is `client/src/pages/FlowsPage.tsx`, where the fresh Run versus Resume split and `customTitle` handling were corrected, plus the shared sidebar rendering in `client/src/components/chat/ConversationList.tsx`, which now derives the run clue from persisted flags. The best proof files to inspect alongside those runtime changes are `server/src/test/integration/flows.run.resume.test.ts`, `server/src/test/unit/flows.flags.test.ts`, `client/src/test/flowsPage.run.test.tsx`, and `e2e/flows-execution-runs.spec.ts`, because together they cover the server ordering fix, child ownership failures, the client request contract, and the browser-visible sidebar behavior.
