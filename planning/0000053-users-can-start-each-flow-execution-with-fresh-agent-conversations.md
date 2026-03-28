# Story 0000053 – Users can start each flow execution with fresh agent conversations

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Flows can already reuse agent conversations while moving back and forth between multiple steps, which is useful inside a single run. The problem is that the current reuse model is too broad. A fresh execution of a flow can accidentally pick up an old agent conversation from a previous execution when the same `agentType` and `identifier` are used again.

From the user's point of view, this makes a brand-new flow run feel unsafe and confusing. Starting the same flow again should mean starting a new execution with fresh agent conversations for that execution. A user should not have to wonder whether the planning agent, review agent, or any other flow-controlled agent is quietly continuing from an older run.

This story introduces a dedicated `executionId` for flow runs. Each fresh flow start creates a new `executionId`, and that execution gets its own set of per-agent conversations. Agent reuse should remain available within one execution, but only within that execution. If a flow revisits the same agent later in the same run using the same `agentType` and `identifier`, it should continue that same agent conversation. If the user starts the flow again as a new execution, it should create a new set of agent conversations even when the flow definition is identical.

This story must stay simple. The user does not want a large redesign of flow execution history, child-conversation visibility, or agent restrictions. Child agent conversations created by a flow should continue to appear in the normal Agents sidebar just like today. The user must be able to open those conversations directly, keep chatting with the agent manually, and then return to the stopped flow later and resume it.

That means the flow should treat child agent conversations as normal first-class agent chats that it references, not as hidden or locked internal resources. A stopped flow may later resume one of those same child conversations after the user has manually extended it on the Agents page. The child conversation therefore remains the live source of truth for the agent thread, while the flow stores enough information to know which child conversation belongs to each agent slot for the current execution.

The intended behavior is:

- a fresh flow start creates a fresh execution and fresh child agent conversations;
- a stopped flow resume continues the same execution and the same child agent conversations;
- child agent conversations remain visible and usable from the Agents page;
- manual chat added to a child agent conversation while the flow is stopped is preserved and should still be part of the conversation when the flow resumes;
- new executions must not reuse child agent conversations from older executions just because the same `agentType` and `identifier` appear again.

This story should preserve the current lightweight shape wherever possible. The existing conceptual `agentConversations` mapping can stay keyed by `${agentType}:${identifier}` so long as that mapping is explicitly scoped to a single execution. The new `executionId` is the scope boundary that keeps those otherwise identical slot keys from leaking across runs.

### Acceptance Criteria

- Each fresh flow start creates a new `executionId`.
- The current flow execution persists its `executionId` in `conversation.flags.flow`.
- A fresh flow start creates a fresh per-execution agent mapping and does not reuse agent conversations from a previous execution.
- Flow agent reuse remains available within one execution: if the same flow execution revisits the same `${agentType}:${identifier}` slot later, it reuses that slot's child agent conversation.
- The persisted `agentConversations` mapping remains conceptually keyed by `${agentType}:${identifier}` and is treated as execution-scoped state rather than process-global state.
- The flow runtime no longer relies on a process-global agent-conversation map that can leak agent slots across unrelated executions.
- Starting the same flow again as a new execution creates fresh child agent conversations even if the flow file, `agentType`, and `identifier` values are unchanged from an earlier execution.
- Resuming a stopped flow continues the same `executionId`.
- Resuming a stopped flow continues using the same child agent conversations that belong to that execution.
- Child agent conversations created by a flow remain visible in the normal Agents page sidebar.
- A user can open a child agent conversation from the Agents page and continue chatting with it manually while the parent flow is stopped.
- When the parent flow is later resumed, it continues that same child agent conversation rather than creating a replacement conversation for the same execution slot.
- If the user manually extends a child agent conversation while the flow is stopped, that additional chat remains part of the resumed flow context because the flow resumes the same child conversation.
- The child agent conversation remains a normal agent conversation and is not hidden, locked, or made flow-only by this story.
- Stopping a flow preserves enough execution state to resume later, including the `executionId`, agent slot conversation mapping, and any required thread-identification data.
- Starting a new flow execution does not copy or inherit the previous execution's child agent slot mapping.
- Existing agent sidebar behavior remains intact apart from showing the normal child conversations that the flow already creates.
- Existing flow behavior for using `agentType` and `identifier` to define reusable slots within one execution remains intact.
- If a stored child conversation cannot be resumed because it is missing or belongs to the wrong agent, the flow fails clearly rather than silently starting an unrelated replacement conversation under the same execution slot.
- The story does not require a broader multi-execution history model beyond what is needed to distinguish a fresh execution from a resumed execution.

### Out Of Scope

- Hiding child flow-created agent conversations from the Agents page.
- Locking or forbidding manual user chat with child agent conversations created by a flow.
- Redesigning the overall flow UX beyond what is needed to distinguish fresh execution from resume.
- Creating a full multi-execution history browser or execution registry UI.
- Changing the existing meaning of `agentType` and `identifier` within one execution.
- Replacing the existing child-conversation model with a separate private flow-only conversation type.
- Adding unrelated new flow step types or unrelated changes to command execution behavior.

### Additional Repositories

- No Additional Repositories

### Questions

1. When the same flow is started again, should it always open a new flow conversation, or can it restart inside an old one?
   - Why this is important: This decides whether a "new execution" is truly separate from resume, or whether old conversation state can still bleed into a fresh run.
   - Best Answer: It should always open a new flow conversation for a new execution. Resume should be the only path that reuses an existing flow conversation. This is the safest and simplest behavior because the current runtime already loads flow resume state from the parent conversation flags, so reusing an old parent conversation for a new execution would blur the line between "resume" and "start again". Workflow systems such as Temporal and GitHub Actions also distinguish a logical workflow from a specific run by giving each run its own run identity.
   - Where this answer came from: Repo evidence from `server/src/flows/service.ts` flow start and resume-state loading, especially where `conversationId` defaults on start and where `flags.flow` is parsed and hydrated; repo evidence from this story's Description and Acceptance Criteria; external evidence from Temporal Workflow ID / Run ID docs and GitHub Actions workflow run ID docs.
2. If two executions create child chats with the same title, should the Agents sidebar show which execution each one came from?
   - Why this is important: Without a visible clue, users may not know which `planning_agent` or other child chat belongs to the flow run they want to inspect or continue.
   - Best Answer: Yes. The sidebar should show a lightweight execution clue for flow-created child conversations, but not a major UI redesign. The current child conversation titles are based on flow name and identifier, so multiple executions can produce chats that look identical even when they belong to different runs. A small execution label or equivalent metadata would keep the story usable without making it larger than necessary.
   - Where this answer came from: Repo evidence from `server/src/flows/service.ts` title-building for flow and child agent conversations; repo evidence from this story's requirement that child conversations remain visible and usable from the Agents page; external evidence from GitHub Actions workflow run history and run-number conventions, which separate repeated runs with lightweight run identifiers.
3. When a stopped flow resumes after manual agent chat, should it use the updated agent conversation or the flow's last saved snapshot?
   - Why this is important: This decides whether manual chat added while the flow is stopped actually changes what the resumed flow sees.
   - Best Answer: It should use the updated agent conversation. The story already says child agent chats remain normal conversations and that manual chat should still be part of the conversation when the flow resumes. That means the flow should treat `flags.flow.agentConversations` as the pointer to the correct child conversation, but treat the child conversation itself as the live source of truth for the latest thread state when resuming.
   - Where this answer came from: Repo evidence from this story's Description and Acceptance Criteria around manual child-chat preservation; repo evidence from `server/src/flows/service.ts` agent thread persistence and resume-state hydration; related repo precedent from `planning/0000029-flow-agent-transcripts-and-inflight-hydration.md`, which favors using the live persisted conversation data as the source of truth when rehydrating transcript state.

## Implementation Ideas

- Add `executionId` to the persisted `conversation.flags.flow` shape and treat it as the identity of the current flow execution.
- On a fresh flow start, mint a new `executionId` and initialize an empty execution-scoped agent slot map.
- On flow resume, load the same `executionId` and rehydrate the stored agent slot map for that execution.
- Keep the conceptual `agentConversations` map keyed by `${agentType}:${identifier}`, but only inside one execution-scoped flow state object.
- Replace the current process-wide flow agent reuse map with execution-scoped runtime state so unrelated executions cannot collide.
- Keep child agent conversations as normal persisted agent conversations with normal sidebar visibility and normal manual-chat behavior.
- When resuming a stopped flow, reuse the stored child conversation for each execution slot instead of generating a replacement conversation.
- Prefer the linked child conversation's current persisted thread metadata when resuming so manual chat added while the flow was stopped is reflected in the resumed execution.
- Keep the implementation lightweight: use `executionId` as the new scope boundary and avoid introducing a larger execution-history subsystem unless the existing code truly requires it.
