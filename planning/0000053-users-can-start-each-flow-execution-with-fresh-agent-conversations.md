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
- Fresh executions of the same flow are allowed to run concurrently when they are started in different parent flow conversations and therefore use different `executionId` values.
- Existing `RUN_IN_PROGRESS` protection remains scoped to a single conversation; this story does not add a flow-name-wide queue or block for new executions.
- Existing agent sidebar behavior remains intact apart from showing the normal child conversations that the flow already creates.
- Existing flow behavior for using `agentType` and `identifier` to define reusable slots within one execution remains intact.
- If a stored child conversation cannot be resumed because it is missing or belongs to the wrong agent, the flow fails clearly rather than silently starting an unrelated replacement conversation under the same execution slot.
- The story does not require a broader multi-execution history model beyond what is needed to distinguish a fresh execution from a resumed execution.

### Out Of Scope

- Hiding child flow-created agent conversations from the Agents page.
- Locking or forbidding manual user chat with child agent conversations created by a flow.
- Redesigning the overall flow UX beyond what is needed to distinguish fresh execution from resume and add a lightweight execution clue.
- Reworking the main conversation title format when a metadata-area clue is sufficient.
- Creating a full multi-execution history browser or execution registry UI.
- Creating a separate per-flow run ordinal, counter, or numbering registry for sidebar display.
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

## Implementation Ideas

- Add `executionId` to the persisted `conversation.flags.flow` shape and treat it as the identity of the current flow execution.
- On a fresh flow start, mint a new `executionId`, create a new parent flow conversation, and initialize an empty execution-scoped agent slot map.
- On flow resume, load the same `executionId` and rehydrate the stored agent slot map for that execution.
- Derive a short stable display label from `executionId` and render it as `Run <shortExecutionId>` instead of inventing a separate run counter or ordinal.
- Keep the conceptual `agentConversations` map keyed by `${agentType}:${identifier}`, but only inside one execution-scoped flow state object.
- Replace the current process-wide flow agent reuse map with execution-scoped runtime state so unrelated executions cannot collide.
- Keep child agent conversations as normal persisted agent conversations with normal sidebar visibility and normal manual-chat behavior.
- Reuse the shared `ConversationList` metadata area to show the same lightweight execution clue on both parent flow conversations in Flows and flow-created child agent conversations in Agents without changing the main title.
- When resuming a stopped flow, reuse the stored child conversation for each execution slot instead of generating a replacement conversation.
- Prefer the linked child conversation's current persisted thread metadata and live persisted conversation state when resuming so manual chat added while the flow was stopped is reflected in the resumed execution.
- Keep concurrency control scoped to the existing per-conversation lock; do not introduce a separate flow-name-wide queue or block for fresh executions in this story.
- Keep the implementation lightweight: use `executionId` as the new scope boundary and avoid introducing a larger execution-history subsystem unless the existing code truly requires it.

## Questions
- No Further Questions
