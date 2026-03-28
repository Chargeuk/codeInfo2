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
- Task Status: `__to_do__`
- Git Commits:

#### Overview

Add the parent-flow execution identity and make the runtime treat that identity as the boundary for slot reuse. This task is only about parent flow state, fresh-start versus resume semantics, and eliminating cross-run leakage from the current process-global slot map before any child-conversation sidebar work is attempted.

#### Task Exit Criteria

- Fresh flow starts always persist `flags.flow.executionId`, use a fresh parent flow conversation, and cannot reuse child slot mappings from an older execution.
- Resume keeps the existing parent conversation and existing execution, including legacy saved flow conversations that still have `flags.flow` but do not yet have `executionId`.

#### Documentation Locations

- `https://nodejs.org/api/crypto.html#cryptorandomuuidoptions` - use for the Node 22 `crypto.randomUUID()` contract because this story mints a new stable execution identifier for every fresh flow run.
- `https://www.mongodb.com/docs/manual/reference/operator/update/set/` - use for the Mongo `$set` behavior that already persists nested `flags.flow` state and must now include `executionId` without inventing a second persistence path.

#### Subtasks

1. [ ] Current Repository: Read the existing parent-flow runtime and persistence seams before changing code. Inspect `server/src/flows/flowState.ts`, `server/src/flows/types.ts`, `server/src/flows/service.ts`, `server/src/mongo/repo.ts`, `server/src/routes/flowsRun.ts`, `server/src/ws/sidebar.ts`, and this story file so you can keep the execution-scoped change inside the existing flow service and conversation persistence path. Documentation: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions ; https://www.mongodb.com/docs/manual/reference/operator/update/set/ .
2. [ ] Current Repository: In `server/src/flows/flowState.ts`, `server/src/flows/service.ts`, and `server/src/mongo/repo.ts`, extend the parent flow resume-state contract to include `executionId: string` under `flags.flow.executionId`. Parse it, build it, and persist it through the existing `updateConversationFlowState(...)` path instead of inventing a second field or collection. When resuming a legacy stopped flow that still has `flags.flow` but no `executionId`, mint the missing `executionId` and persist it before later slot reuse depends on it. Documentation: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions ; https://www.mongodb.com/docs/manual/reference/operator/update/set/ .
3. [ ] Current Repository: In `server/src/flows/service.ts` and `server/src/flows/types.ts`, replace the current process-global flow-agent reuse behavior with execution-scoped runtime state so slot reuse is keyed by `executionId` plus `${agentType}:${identifier}`, not just by `${agentType}:${identifier}` alone. Preserve the existing within-one-execution reuse rule, but make sure a fresh execution cannot hydrate or persist stale slot entries from any earlier execution before the new runtime state is initialized. Documentation: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions .
4. [ ] Current Repository: In `server/src/flows/service.ts` and `server/src/routes/flowsRun.ts`, keep start and resume as distinct paths. A fresh run must create a new parent flow conversation even when the caller supplies a `conversationId` that already belongs to an older flow conversation, while resume must continue the existing conversation only when `resumeStepPath` is present. Keep the current `RUN_IN_PROGRESS` lock scoped to one conversation only, and do not add any flow-name-wide concurrency block or queue in this task. Documentation: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions .
5. [ ] Current Repository: Update the parent-flow proof files so the new execution boundary is explicit in both server harnesses that this repository actually runs. At minimum, change `server/src/test/unit/flows.flags.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.test.ts`, and `server/src/test/integration/flows.run.command.test.ts`, then add or update a focused cucumber feature such as `server/src/test/features/flows-execution-runs.feature` plus matching step definitions such as `server/src/test/steps/flows-execution-runs.steps.ts`. The `node:test` suite must prove `executionId` persistence, fresh-run parent-conversation replacement, same-execution slot reuse, legacy `executionId` backfill, and allowed concurrent fresh executions in different parent conversations. The cucumber feature must prove the same fresh-run versus resume contract through the repository's Testcontainers-backed Mongo/Chroma path instead of leaving `npm run test:summary:server:cucumber` as unrelated regression coverage only. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ .
6. [ ] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
7. [ ] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [ ] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 1 changes server flow types and runtime behavior. If the wrapper reports failure or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [ ] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper because Task 1 changes flow state persistence, runtime slot reuse, and route-level start/resume semantics. If it fails, inspect the printed `test-results/server-unit-tests-*.log` path, use targeted reruns only for diagnosis, then rerun the full wrapper.
3. [ ] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper because Task 1 must add or update a Story 53 flow cucumber feature that exercises fresh-run versus resume behavior through the repository's Testcontainers-backed persistence path. If it fails, inspect the printed `test-results/server-cucumber-tests-*.log` path, diagnose, and rerun the full wrapper.

#### Implementation notes

### Task 2. Enforce Child Conversation Ownership And Compatibility

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__to_do__`
- Git Commits:

#### Overview

Persist and validate child-conversation ownership so every flow-created agent conversation belongs to exactly one execution. This task keeps child conversations as normal first-class agent chats, but it adds the execution marker and mismatch guards needed so resume can safely reuse the right child conversation and fail clearly when the saved mapping is wrong.

#### Task Exit Criteria

- Flow-created child agent conversations persist `flags.flowChild.executionId`, and resume reuses the same child conversations for the same execution instead of silently creating replacements.
- If a saved child conversation is missing, belongs to the wrong agent, or carries a conflicting execution marker, resume fails clearly and the child conversation still does not leak into flow-only filtering through top-level `flowName`.

#### Documentation Locations

- `https://www.mongodb.com/docs/manual/reference/operator/update/set/` - use for nested updates to `flags.flowChild.executionId` and any related compatibility stamping on existing conversation documents.
- `https://www.mongodb.com/docs/manual/core/document/#dot-notation` - use for the dot-notation rules that matter when persisting child execution metadata without replacing unrelated sibling `flags` fields.

#### Subtasks

1. [ ] Current Repository: Read the child-conversation ownership seams before changing code. Inspect `server/src/flows/service.ts`, `server/src/mongo/repo.ts`, `server/src/routes/conversations.ts`, `server/src/ws/sidebar.ts`, `server/src/mongo/conversation.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.test.ts`, and `server/src/test/integration/conversations.flowname.test.ts`. The goal is to keep child execution markers on `flags` and reuse the existing conversation summary contract instead of inventing a new list endpoint. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ ; https://www.mongodb.com/docs/manual/core/document/#dot-notation .
2. [ ] Current Repository: In `server/src/flows/service.ts` and `server/src/mongo/repo.ts`, stamp every flow-created child agent conversation with `flags.flowChild.executionId` when that conversation becomes the confirmed child for the current execution. If a reused legacy child conversation is missing the marker, add the current execution marker at that confirmation point. Do not add top-level `flowName` to child agent conversations just to support the sidebar clue, because the Flows page already filters on `flowName`. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ ; https://www.mongodb.com/docs/manual/core/document/#dot-notation .
3. [ ] Current Repository: In `server/src/flows/service.ts` and `server/src/routes/flowsRun.ts`, tighten resume validation so the saved `agentConversations` mapping is treated as authoritative for the current execution only. If a mapped child conversation is missing, belongs to the wrong `agentType`, or already carries a different `flags.flowChild.executionId` than the parent flow execution, fail clearly instead of silently swapping in a new conversation for that slot. Keep the resumed child conversation itself as the live source of truth so manual chat added while the flow was stopped remains part of the resumed context. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ ; https://www.mongodb.com/docs/manual/core/document/#dot-notation .
4. [ ] Current Repository: Update server proof files for the child-ownership contract in both the `node:test` and cucumber paths. At minimum, change `server/src/test/unit/flows.flags.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.test.ts`, and `server/src/test/integration/conversations.flowname.test.ts`, then extend the Story 53 cucumber feature from Task 1 such as `server/src/test/features/flows-execution-runs.feature` plus `server/src/test/steps/flows-execution-runs.steps.ts`. The `node:test` suite must prove child execution markers are persisted, legacy child conversations are stamped when reused, missing or conflicting child mappings fail clearly, manual resume still targets the same child conversation, and child conversations do not leak into `flowName`-filtered flow history. The cucumber feature must prove at least one resumed-execution path where the saved child mapping is accepted only when the ownership markers still match the parent execution. Documentation: https://www.mongodb.com/docs/manual/reference/operator/update/set/ ; https://www.mongodb.com/docs/manual/core/document/#dot-notation .
5. [ ] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
6. [ ] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [ ] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 2 changes server-side flow ownership and conversation flag persistence. If the wrapper reports failure or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [ ] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper because Task 2 changes `flags` persistence and flow-child ownership validation. If it fails, inspect the printed `test-results/server-unit-tests-*.log` path, use targeted reruns only for diagnosis, then rerun the full wrapper.
3. [ ] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper because Task 2 extends the Story 53 flow cucumber feature so the higher-level resume path proves child-conversation ownership checks instead of only exercising unrelated features. If it fails, inspect the printed `test-results/server-cucumber-tests-*.log` path, diagnose, and rerun the full wrapper.

#### Implementation notes

### Task 3. Show Run Metadata And Start Fresh Flow Conversations In The UI

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1, Task 2`
- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Current Repository: Read the client-side flow and sidebar seams before changing code. Inspect `client/src/api/flows.ts`, `client/src/api/conversations.ts`, `client/src/hooks/useConversations.ts`, `client/src/components/chat/ConversationList.tsx`, `client/src/pages/FlowsPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/test/flowsPage.run.test.tsx`, `client/src/test/chatPage.source.test.tsx`, and this story file. Documentation: https://llms.mui.com/material-ui/6.4.12/api/chip.md ; https://llms.mui.com/material-ui/6.4.12/api/typography.md ; https://llms.mui.com/material-ui/6.4.12/components/lists.md .
2. [ ] Current Repository: In `client/src/pages/FlowsPage.tsx` and `client/src/test/flowsPage.run.test.tsx`, change the flow-start behavior so `Run` always creates a brand-new client conversation id even when an older flow conversation is selected, and `Resume` keeps using the selected stopped conversation id. Preserve the existing custom-title rule: only include `customTitle` for brand-new runs. Documentation: https://playwright.dev/docs/locators .
3. [ ] Current Repository: In `client/src/api/conversations.ts`, `client/src/hooks/useConversations.ts`, `client/src/components/chat/ConversationList.tsx`, `client/src/pages/FlowsPage.tsx`, and `client/src/pages/AgentsPage.tsx`, extend the list-item typing so the shared sidebar can read `flags.flow.executionId` for parent flow conversations and `flags.flowChild.executionId` for flow-created agent conversations. Render a shortened stable `Run <shortExecutionId>` clue in the existing metadata area using the current MUI `Typography` and `Chip` primitives, do not rewrite titles, do not show the clue for ordinary chat rows, and do not change the current `flowName: '__none__'` filtering on the Agents page. Documentation: https://llms.mui.com/material-ui/6.4.12/api/chip.md ; https://llms.mui.com/material-ui/6.4.12/api/typography.md ; https://llms.mui.com/material-ui/6.4.12/components/lists.md .
4. [ ] Current Repository: Update the focused client proof files for the new UI contract. At minimum, change `client/src/test/flowsPage.run.test.tsx` to prove Run versus Resume conversation-id behavior, update `client/src/test/chatSidebar.test.tsx` because it already exercises `ConversationList`, and update `client/src/test/agentsPage.sidebarWs.test.tsx` because it already proves live Agents sidebar updates. Those tests must prove parent-flow and child-agent run clues render from `flags`, ordinary rows stay unchanged, and flow-created child conversations remain visible under Agents without title changes. Documentation: https://llms.mui.com/material-ui/6.4.12/api/chip.md ; https://llms.mui.com/material-ui/6.4.12/api/typography.md ; https://playwright.dev/docs/locators .
5. [ ] Current Repository: Add browser-level proof in `e2e/flows-execution-runs.spec.ts`. The spec must cover two fresh executions of the same flow showing separate sidebar rows with the same main title but different `Run <shortExecutionId>` clues, plus the corresponding flow-created child conversation appearing in Agents with the same run clue and at least one ordinary non-flow row staying unchanged. Reuse the existing Playwright route-mocking and websocket-support style already used in this repository instead of inventing a second browser harness, and rely on the checked-in `playwright.config.ts` behavior so screenshots and traces are captured through the current e2e path rather than a bespoke artifact flow. Documentation: https://playwright.dev/docs/locators ; https://playwright.dev/docs/screenshots .
6. [ ] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
7. [ ] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [ ] Current Repository: Run `npm run build:summary:client`. Use this wrapper because Task 3 changes the shared conversation sidebar rendering used by multiple client pages, and this wrapper already performs the repository's client typecheck gate before the build. If the wrapper reports failure or ambiguous output, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun `npm run build:summary:client`.
2. [ ] Current Repository: Run `npm run test:summary:client`. Use this wrapper because Task 3 changes page-level and shared-sidebar client behavior. If it fails, inspect the printed client test log path, use targeted reruns only for diagnosis, then rerun the full wrapper.
3. [ ] Current Repository: Run `npm run test:summary:e2e`. Use this wrapper because Task 3 adds browser-visible flow and agent sidebar behavior that should be proved end to end. This wrapper already performs the repository's supported compose-e2e build, startup, Playwright run, and teardown path, so do not add separate e2e stack commands around it. If it fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose, and rerun the full wrapper.

#### Implementation notes

### Task 4. Perform Story 53 Final Validation And Close-Out

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1, Task 2, Task 3`
- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Current Repository: Re-read this entire story and trace every acceptance criterion, every important Description requirement, and every explicit Out Of Scope boundary to the finished task set before marking the story complete. Record the mapping in this task’s Implementation notes so later reviewers can see where fresh-run parent replacement, execution-scoped child reuse, legacy backfill, child visibility in Agents, sidebar `Run <shortExecutionId>` clues, and unchanged out-of-scope areas were each implemented and proved. Documentation: https://docs.github.com/en/pull-requests ; https://www.markdownguide.org/basic-syntax/ .
2. [ ] Current Repository: Update `docs/developer-reference.md` so the written flow contract matches Story 53. At minimum, document that fresh flow starts create new parent conversations, resume keeps the existing execution, flow-created child conversations remain visible in Agents, and repeated executions are distinguished by `Run <shortExecutionId>` in sidebar metadata instead of title changes. Documentation: https://www.markdownguide.org/basic-syntax/ .
3. [ ] Current Repository: Update `design.md` anywhere it still describes flow agent reuse, resume-state storage, or sidebar behavior as if there were no `executionId` boundary. The final design notes must mention `flags.flow.executionId`, `flags.flowChild.executionId`, fresh-start versus resume conversation ownership, and the shared sidebar metadata clue for repeated executions. Documentation: https://www.markdownguide.org/basic-syntax/ .
4. [ ] Current Repository: Update `README.md` only if the top-level user or contributor guidance would otherwise be misleading after Story 53. If no README change is needed, record that explicit no-change decision in this task’s Implementation notes instead of leaving it implicit. Documentation: https://www.markdownguide.org/basic-syntax/ .
5. [ ] Current Repository: Update `projectStructure.md` for every file actually added, removed, or renamed by Story 53, and add the Story 53 structural-change ledger once the final file list is known. If the story lands only in-place edits for some areas, say that explicitly in the ledger instead of implying file additions that did not happen. Documentation: https://www.markdownguide.org/basic-syntax/ .
6. [ ] Current Repository: Create `planning/0000053-pr-summary.md` as the reviewer-facing Story 53 close-out artifact. It must summarize the repository scope, the final task sequence, the execution-state contract, the user-visible Flows and Agents sidebar change, the compatibility/backfill behavior for legacy stopped flows, and the final build/test/manual validation evidence. Documentation: https://docs.github.com/en/pull-requests ; https://www.markdownguide.org/basic-syntax/ .
7. [ ] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Documentation: Context7 `/eslint/eslint`.
8. [ ] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Documentation: Context7 `/prettier/prettier`.

#### Testing

1. [ ] Current Repository: Run `npm run compose:build:summary`. Use this wrapper first because Story 53 changes a server-plus-client system that this repository can build through its supported compose path. If the wrapper reports failure or ambiguous output, inspect `logs/test-summaries/compose-build-latest.log`, fix the issue, and rerun `npm run compose:build:summary`.
2. [ ] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 4 is the final backend regression pass for the flow runtime and persistence changes. If the wrapper reports failure or ambiguous output, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
3. [ ] Current Repository: Run `npm run build:summary:client`. Use this wrapper because Task 4 is the final client regression pass for the shared conversation sidebar and Flows page behavior, and it already includes the repository's client typecheck gate. If the wrapper reports failure or ambiguous output, inspect `logs/test-summaries/build-client-latest.log`, fix the issue, and rerun `npm run build:summary:client`.
4. [ ] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper because Task 4 must prove the final flow-state, resume, and conversation-ownership contract on the server. If it fails, inspect the printed `test-results/server-unit-tests-*.log` path, diagnose with targeted reruns only as needed, then rerun the full wrapper.
5. [ ] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper because the Story 53 flow cucumber feature added in Tasks 1 and 2 must still pass on the repository's supported higher-level server proof surface. If it fails, inspect the printed `test-results/server-cucumber-tests-*.log` path, diagnose, and rerun the full wrapper.
6. [ ] Current Repository: Run `npm run test:summary:client`. Use this wrapper because Task 4 must prove the final shared-sidebar and page-level client behavior. If it fails, inspect the printed client test log path, diagnose with targeted reruns only as needed, then rerun the full wrapper.
7. [ ] Current Repository: Run `npm run test:summary:e2e`. Use this wrapper because the story changes user-visible Flows and Agents behavior that should be proved through the repository's browser-backed test path. This wrapper already performs the supported compose-e2e build, startup, Playwright run, and teardown path. If it fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose, and rerun the full wrapper.
8. [ ] Current Repository: Run `npm run compose:up` for the final manual verification pass only after the build and automated wrappers above are green. Use this wrapper instead of raw Docker Compose commands so the supported runtime stack is started through the repository's normal flow and the main-stack `playwright-mcp` service is available.
9. [ ] Current Repository: Perform final manual Playwright MCP validation against the running main stack. Use the repository's Playwright MCP tooling with `http://host.docker.internal:5001/flows` and `http://host.docker.internal:5001/agents`, start the same flow twice as two fresh executions, confirm the Flows sidebar shows two rows with the same main title but different `Run <shortExecutionId>` clues, confirm the corresponding flow-created child conversation is visible in Agents with the matching run clue and remains usable as a normal agent conversation, and confirm at least one ordinary non-flow row still shows no run clue. Save at least one Flows screenshot and one Agents screenshot under `playwright-output-local` using a Story 53 prefix such as `0000053-4-main-*.png`, inspect the saved images yourself, confirm the browser console has no error-level messages during this pass, and record the exact filenames plus outcomes in this task's Implementation notes. Documentation: https://playwright.dev/docs/debug ; https://playwright.dev/docs/screenshots .
10. [ ] Current Repository: Run `npm run compose:down` after the final manual verification finishes so the supported stack is torn down through the repository wrapper rather than a raw Docker command.

#### Implementation notes

## Questions
- No Further Questions
