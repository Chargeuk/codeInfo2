# Story 0000021 – Agents page parity with Chat layout + WS

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):
- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today the Chat page and the Agents page serve similar purposes (history sidebar, options controls, transcript) but are implemented with different UI and streaming logic. The Chat page uses the newer WebSocket-driven transcript handling and has proven more stable. The Agents page uses bespoke state handling and a separate layout, which has led to inconsistencies and bugs.

We want the Agents page to use the same layout, components, and WebSocket transcript logic as the Chat page so the user experience is consistent and stable. Agent-specific controls (agent selection, command execution, working folder) should replace the Chat provider/model controls, but the transcript rendering, tool/citation handling, and sidebar behavior should mirror Chat.

We also plan to unify the backend execution/streaming path so both Chat and Agents runs flow through the same server-side orchestration for WebSocket events (including `user_turn`, `inflight_snapshot`, tool events, and `turn_final`). This avoids maintaining two nearly identical pipelines and prevents drift where one path emits events or state updates the other does not. Once the new Agents page is in place, the legacy Agents UI logic and any legacy server-side Agents run path that bypasses the unified streaming flow will be removed so there is only one end-to-end path to maintain.

**Approach (preferred):** Rebuild the Agents page by reusing the Chat page layout/components and the shared chat WebSocket transcript logic, and route agent runs through the same server orchestration used by `/chat`. This keeps the UI/WS behavior identical and allows removal of the legacy Agents UI state handling and any duplicate agent-run server paths.

**Output clarity:** The new Agents page should look and behave exactly like Chat (same layout + transcript UI), with only the controls swapped to agent-specific inputs. The old Agents UI implementation and any server code paths that bypass the unified run orchestration should be deleted.

---

## Acceptance Criteria

- The Agents page uses the same layout structure as the Chat page: a left Drawer sidebar (mobile = temporary, desktop = persistent, width 320), a controls area above the transcript, and a transcript column inside a scrolling panel.
- The Agents transcript uses the same WebSocket transcript logic as Chat (the same WS handler/hooks such as `useChatWs` + `useChatStream.handleWsEvent` or a shared equivalent), with no bespoke inflight aggregation state on the client.
- Agents show the same transcript UI features as Chat: status chip (Processing/Complete/Failed), tool blocks with parameters + result accordions, and citations rendered in the same citations accordion under assistant bubbles.
- The Agents sidebar updates via WebSocket `conversation_upsert` / `conversation_delete` events the same way as Chat (subscribed with `subscribe_sidebar`), filtered to the active agent and sorted in the same order.
- Agent-specific controls replace Chat provider/model controls without losing functionality: agent dropdown, command dropdown + execute, working folder input, Send/Stop, and New conversation all behave as they do today on the Agents page.
- The legacy Agents UI logic (custom inflight aggregation, bespoke transcript rendering) is removed, and the Agents page uses the same Chat transcript components/hooks.
- Any server-side Agents run path that bypasses the shared run orchestration is removed; both `/chat` and `/agents` use the same orchestration for WS events.

---

## Out Of Scope

- Redesigning the Chat page UI.
- Changing Chat view behavior or visuals (Agents must inherit Chat behavior without modifying it unless absolutely necessary).
- Changing backend agent execution semantics beyond what is needed for WS parity.
- Introducing new provider types or non-Codex agents.
- Adding new agent commands or altering existing command content.

---

## Research Findings (MCP + Web)

- **Dependency versions (confirmed in repo install):** React `19.2.0`, React Router `7.9.6`, MUI `6.5.0`, Vite `7.2.4`, Node `22.21.1`, TypeScript `5.9.3`, Express `5.1.0`, Mongoose `9.0.1`, ws `8.18.3`.
- **Server parity gap (primary):** agent runs already use `ChatInterface` + `attachChatStreamBridge` and already create an inflight entry, but they do not emit the chat-style WS `user_turn` event and they create inflight state without the chat metadata (`provider`, `model`, `source`, `userTurn`). `/chat` explicitly sets inflight metadata and publishes `user_turn` in `server/src/routes/chat.ts`.
- **WS emission location:** `publishUserTurn` and related WS events are centralized in `server/src/ws/server.ts`.
- **Inflight snapshots:** WS `inflight_snapshot` is sourced from `server/src/chat/inflightRegistry.ts` and published by the WS server; agents already create inflight state today, but without a `user_turn` event the UI still can’t render a user bubble in a chat-parity transcript.
- **Cancel/stop:** WS `cancel_inflight` handling lives in `server/src/ws/server.ts` and chat cancellation tests; the Agents UI currently only aborts the REST call in `client/src/pages/AgentsPage.tsx` and does not issue `cancel_inflight`, so server-side runs won’t stop unless the UI is updated to send `cancel_inflight`.
- **Agents buffering:** agent runs return `segments` only when complete (via `McpResponder`), but the same runs already publish WS deltas via `attachChatStreamBridge`; the UI should treat REST `segments` as fallback only.
- **Client-generated `conversationId` prerequisite:** the Agents REST endpoints respond only once a run is complete, but WS transcript frames can start immediately. Therefore the Agents UI must know `conversationId` before starting a run so it can subscribe early. This requires the server to accept a client-supplied `conversationId` even when it does not exist yet (create it), rather than treating “conversationId present” as “conversation must already exist”.
- **Client divergence:** the Agents UI currently builds its own inflight aggregation and transcript rendering in `client/src/pages/AgentsPage.tsx`, while Chat uses `useChatStream` + `useChatWs` + `useConversationTurns`. This is the main source of duplicate logic and drift.
- **Abort/stop semantics:** client-side aborts rely on `AbortController` (fetch rejects with `AbortError`), so server-side cancellation must still be explicit via the unified WS `cancel_inflight` flow.
- **WebSocket health:** the `ws` library recommends ping/pong + termination to detect dead connections; our WS server already uses a heartbeat, which aligns with keeping a single WS path for both Chat and Agents.
- **Protocol choice:** WebSockets are bidirectional while SSE is server-to-client only; maintaining WS for both Chat and Agents keeps cancel-inflight and tool event flows unified.
- **External confirmation:** WebSocket-vs-SSE comparisons (WebSocket.org, LogRocket) confirm SSE is unidirectional while WebSockets are bidirectional, reinforcing the WS-only unification decision.
- **Legacy streaming helper:** `server/src/chatStream.ts` still exists for older streaming paths; ensure Agents does not use it once WS unification is complete.
- **DeepWiki note:** the repo is not indexed in DeepWiki yet (“Repository not found”), so code references are confirmed locally; once indexed, re-check for any agent-specific design notes.
- **CodeInfo note (updated):** code_info MCP can access the correct repo when given the explicit path; it confirms WS emission/inflight registry locations and the current Agents UI divergence.

---

## Message Contracts & Storage Shapes

- **No new storage shapes are required.** Existing conversation/turn persistence remains unchanged.
- **No new WS event types are required.** Agents will emit the same existing WS v1 events as Chat (`user_turn`, `inflight_snapshot`, `assistant_delta`, `analysis_delta`, `tool_event`, `turn_final`).
- **No new REST fields are required.** `/agents/:agentName/run` continues to accept `instruction`, optional `conversationId`, and optional `working_folder` and returns `segments` for fallback/non-WS use (the UI should not depend on these segments).
- **Important server behavior:** when `conversationId` is supplied for Agents runs, the server must create the conversation if it does not exist (matching `/chat` semantics), so the client can safely generate an id up front for early WS subscription.

---

# Tasks

### 1. Server: publish `user_turn` + full inflight metadata for agent runs

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Ensure agent runs emit the same WebSocket transcript “run start” signal as Chat by publishing a `user_turn` event and creating inflight state with the same metadata fields used by `/chat`. This is the upstream prerequisite for the Agents UI to reuse the Chat WS transcript logic without bespoke client-side workarounds.

#### Documentation Locations

- Node.js `AbortController` / `AbortSignal` (how abort flows propagate through async work): https://nodejs.org/api/globals.html#class-abortcontroller
- `ws` package docs (server-side WebSocket message handling patterns): https://github.com/websockets/ws
- Node.js test runner (node:test) (server tests use this runner): https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Read the current Chat vs Agents run-start flow so changes are minimal and consistent:
   - Files to read:
     - `server/src/routes/chat.ts`
     - `server/src/agents/service.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/ws/server.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/test/unit/ws-chat-stream.test.ts`
     - `server/src/test/integration/agents-run-ws-stream.test.ts`

2. [ ] Allow client-supplied `conversationId` to start a new agent conversation (required for early WS subscription):
   - Files to edit:
     - `server/src/agents/service.ts`
     - `server/src/agents/commandsRunner.ts`
   - Requirements:
     - Update `runAgentInstruction(...)` so it does **not** set `mustExist` based on “conversationId was provided”.
       - Agents must match `/chat`: if the provided `conversationId` does not exist yet, create it.
       - Keep the existing protections: archived conversations must still 410, and agent mismatch must still error.
       - Concrete change: stop passing `mustExist: Boolean(params.conversationId)` into `runAgentInstructionUnlocked(...)`.
     - Update command runs (`runAgentCommandRunner` → `runAgentInstructionUnlocked`) so a client-supplied `conversationId` can also start a new command conversation.
       - Concrete change: stop deriving `mustExist` from `Boolean(params.conversationId)`; omit `mustExist` entirely (or set it to `false`).

3. [ ] Update `runAgentInstructionUnlocked` to create inflight state with chat-style metadata:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Mirror the `/chat` run-start metadata in `createInflight(...)`:
       - `provider: 'codex'`
       - `model: modelId`
       - `source: params.source`
       - `userTurn: { content: params.instruction, createdAt: <iso string> }`
     - Keep existing `externalSignal` wiring (`params.signal`).

4. [ ] Publish `user_turn` for agent runs at run start (server-side), matching the Chat run contract:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Import and call `publishUserTurn(...)` from `server/src/ws/server.ts` immediately after inflight creation (and before attaching the stream bridge), using the same `createdAt` ISO timestamp stored in the inflight userTurn.
     - Ensure `createdAt` is an ISO string and non-empty.

5. [ ] Ensure the inflight id is propagated consistently into persistence bookkeeping:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Pass `inflightId` into `chat.run(...)` flags so `ChatInterface` can mark inflight persistence (`markInflightPersisted`) consistently with `/chat`.

6. [ ] Server integration test: agent runs publish `user_turn` over WS at run start:
   - Files to edit:
     - `server/src/test/integration/agents-run-ws-stream.test.ts`
   - Requirements:
     - Extend the existing test to wait for and assert a `user_turn` event:
       - `conversationId` matches
       - `inflightId` matches
       - `content` equals the submitted instruction
       - `createdAt` is a non-empty string
     - Keep the existing assertions for `inflight_snapshot`, `assistant_delta`, and `turn_final`.

7. [ ] Update documentation to reflect that agent runs emit `user_turn`:
   - Files to edit:
     - `design.md`
     - `readme.md`

8. [ ] Run lint/format verification:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- 

---

### 2. Server: `cancel_inflight` stops agent runs and yields `turn_final: stopped`

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Agent runs already share the same cancellation mechanism as Chat (`cancel_inflight` → `abortInflight` → inflight `AbortController.signal` passed into `chat.run(...)`, then the stream bridge publishes `turn_final: stopped`). This task adds missing agent-specific integration coverage so we don’t regress.

#### Documentation Locations

- Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller
- `ws` package docs: https://github.com/websockets/ws
- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Markdown guide (only for updating docs/tree): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Read the existing WS cancellation logic and the chat cancellation test patterns:
   - Files to read:
     - `server/src/ws/server.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/test/unit/ws-chat-stream.test.ts`
     - `server/src/test/features/chat_cancellation.feature`
     - `server/src/test/steps/chat_cancellation.steps.ts`

2. [ ] Add server integration coverage for cancelling an agent run via WS:
   - Files to add:
     - `server/src/test/integration/agents-run-ws-cancel.test.ts`
   - Requirements:
     - Start an agent run via `runAgentInstructionUnlocked(...)` using a deterministic `inflightId`.
     - Subscribe to the conversation over WS and wait for an initial snapshot/delta.
     - Send `{ type: 'cancel_inflight', conversationId, inflightId }`.
     - Assert a `turn_final` event arrives with `status === 'stopped'`.
     - Assert the run promise resolves (no hang) and all servers/sockets are cleaned up.

3. [ ] Update documentation to reflect Stop parity for Agents:
   - Files to edit:
     - `design.md`
     - `readme.md`

4. [ ] Update `projectStructure.md` with the new server test file:
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file path:
       - `server/src/test/integration/agents-run-ws-cancel.test.ts`

5. [ ] Run lint/format verification:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- 

---

### 3. Client: Agents transcript uses the Chat WS transcript pipeline (no bespoke inflight)

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Remove bespoke inflight aggregation from the Agents page and reuse the same WebSocket transcript pipeline used by Chat (`useChatWs` + `useChatStream.handleWsEvent` + `useConversationTurns`). This makes tool/citation rendering and status semantics match Chat and eliminates drift between the two pages.

#### Documentation Locations

- React hooks (avoiding duplicated derived state): https://react.dev/learn/you-might-not-need-an-effect
- WebSocket (event-driven UI): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- MUI MCP docs (accordions used by the chat transcript UI):
  - https://llms.mui.com/material-ui/6.4.12/components/accordion.md

#### Subtasks

1. [ ] Read the Chat WS transcript pipeline end-to-end:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
     - `client/src/test/useChatStream.toolPayloads.test.tsx`

2. [ ] Refactor AgentsPage to use `useChatStream` for transcript state (messages/tools/citations):
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Instantiate `useChatStream` with fixed `provider='codex'` and a safe fallback `model` string (Agents should not expose provider/model controls).
     - Important: Agents “Send” must continue to call the Agents REST endpoints (via `client/src/api/agents.ts`), not `useChatStream.send()` (which posts to `/chat`). `useChatStream` is used here only for WS transcript state + hydration helpers.
     - Important (realtime-enabled mode): Agents runs must have a known `conversationId` **before** starting the request so the page can subscribe to WS and receive early `user_turn`/deltas.
       - When `activeConversationId` is empty (new conversation), generate a client-side id (use the same `crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)` fallback the file already uses).
       - Immediately call `setConversation(newConversationId, { clearMessages: true })`, set it as `activeConversationId`, and subscribe to the conversation over WS, then include it in the request payload for both Send (`POST /agents/:agentName/run`) and Execute command (`POST /agents/:agentName/commands/run`).
       - Do not rely on the server generating a conversation id, because the Agents REST endpoints only respond once the run is complete; without a pre-known id, the UI cannot subscribe early and will miss the initial stream frames.
     - When selecting a conversation, call `setConversation(conversationId, { clearMessages: true })` and hydrate history using `hydrateHistory(...)` with turns from `useConversationTurns`.
     - Wire WebSocket transcript events into `useChatStream`:
       - Forward `user_turn`, `assistant_delta`, `analysis_delta`, `tool_event`, `stream_warning`, `turn_final` to `handleWsEvent(...)`.
       - Forward `inflight_snapshot` to `hydrateInflightSnapshot(...)`.
     - Remove `liveInflight` state and all logic that manually appends deltas/tool events.
     - Do not render any Agents-only transcript elements (e.g., command step metadata notes); transcript rendering must match Chat.
     - Persistence-unavailable fallback (must keep existing functionality):
       - When `mongoConnected === false` (realtime disabled), keep using the existing segment-based rendering for Send (`result.segments` → assistant bubble) because WS transcript events will not arrive.
       - Commands are already disabled in this mode; ensure that remains true.
     - Realtime-enabled behavior (must avoid duplicate assistant bubbles):
       - When realtime is enabled (`mongoConnected !== false`), do **not** append an assistant message from `result.segments`.
       - Treat the REST response as a completion signal only; the transcript should come entirely from WS events.

3. [ ] Update Agents transcript rendering to use the same tool + citations UI as Chat:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Do not change ChatPage transcript UI in this story. Instead, copy the Chat transcript UI patterns into AgentsPage and keep test ids consistent with Chat where applicable (e.g., `data-testid="citations-accordion"`, `data-testid="citations-toggle"`, `data-testid="citations"`).
     - Tool blocks must render with the same Parameters + Result accordions and the same status chip semantics.
     - Citations must render inside the same default-closed citations accordion used by Chat.
     - The “Thought process” (think/reasoning) accordion must behave the same way as Chat.

4. [ ] Remove the Agents-only command metadata transcript note:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Files to edit or delete:
     - `client/src/test/agentsPage.commandMetadataRender.test.tsx`
   - Requirements:
     - Remove the “Command run: … (step/total)” note from the transcript UI.
     - Keep persistence/storage of `turn.command` unchanged (other consumers may rely on it).

5. [ ] Update client tests for streaming parity:
   - Files to edit:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Emit a `user_turn` WS event and assert a user bubble renders.
     - Continue asserting deltas render.
     - Assert `turn_final` transitions the assistant status to complete/failed.

6. [ ] Update `projectStructure.md` for any new test/component files added in this story:
   - Files to edit:
     - `projectStructure.md`

7. [ ] Run full lint/format verification:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 4. Client: Agents Stop uses WS `cancel_inflight` + abort request (Chat parity)

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Update the Agents Stop behavior to match Chat: send `cancel_inflight` over WebSocket using the active conversation + inflight id, and also abort the in-flight HTTP request for immediate UI responsiveness.

#### Documentation Locations

- React hooks (refs + effects for request lifecycle): https://react.dev/reference/react/useRef and https://react.dev/reference/react/useEffect
- WebSocket (client message contract): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

#### Subtasks

1. [ ] Read ChatPage Stop behavior and how it gets the inflight id:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`

2. [ ] Update AgentsPage Stop to send WS `cancel_inflight` in addition to aborting fetch:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Always abort the in-flight HTTP request via `AbortController` (immediate UI response and required to stop multi-step command runs).
     - Additionally, when `activeConversationId` and `getInflightId()` are both available, call `cancelInflight(activeConversationId, inflightId)`.
     - If the inflight id is not yet known (user clicks Stop immediately), aborting the request alone is still required.
     - When realtime is disabled (`mongoConnected === false`), do not attempt to send `cancel_inflight` over WS.

3. [ ] Client test: Stop sends a `cancel_inflight` WS message:
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Requirements:
     - Assert the WS mock recorded a message `{ type: 'cancel_inflight', conversationId, inflightId }`.

4. [ ] Run lint/format verification:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 5. Client: Agents sidebar updates via WS (`subscribe_sidebar`)

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Bring Agents sidebar behavior to parity with Chat by subscribing to the sidebar WS feed and applying `conversation_upsert` / `conversation_delete` events to the Agents conversation list, filtered to the currently selected agent.

#### Documentation Locations

- React hooks (useEffect patterns for subscriptions): https://react.dev/reference/react/useEffect
- WebSocket (event-driven UI): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

#### Subtasks

1. [ ] Read how ChatPage wires sidebar WS updates and filters out agent conversations:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useConversations.ts`
     - `client/src/test/chatSidebar.test.tsx`

2. [ ] Update AgentsPage to subscribe to sidebar events and apply them to the agent-scoped conversation list:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Call `subscribeSidebar()` on mount (when persistence is available), and `unsubscribeSidebar()` on unmount.
     - On WS `conversation_upsert`, apply the event only when `event.conversation.agentName === selectedAgentName`.
     - On WS `conversation_delete`, remove the conversation by id.
     - Use `useConversations(...).applyWsUpsert` / `applyWsDelete` rather than rebuilding list logic.

3. [ ] Client test: Agents sidebar reflects WS `conversation_upsert` events for the active agent:
   - Files to add:
     - `client/src/test/agentsPage.sidebarWs.test.tsx`
   - Requirements:
     - Mock an Agents page session.
     - Emit a `conversation_upsert` WS event with `agentName: 'a1'` and confirm it appears in the sidebar.
     - Emit a second `conversation_upsert` for a different `agentName` and confirm it is ignored.
     - Emit an upsert with a newer `lastMessageAt` and confirm it reorders to the top.

4. [ ] Update `projectStructure.md` with any new test files added:
   - Files to edit:
     - `projectStructure.md`

5. [ ] Run lint/format verification:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 6. Client: rebuild Agents page layout to match Chat (Drawer + controls + transcript)

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Rebuild the Agents page to match the Chat page layout exactly: left Drawer conversation sidebar (temporary on mobile, persistent on desktop, width 320), a controls area above the transcript, and the transcript in a scrolling panel. Only the control inputs should differ (agent + command + working_folder vs provider/model).

#### Documentation Locations

- MUI MCP docs:
  - `Drawer` API (temporary/persistent variants + `ModalProps`)
    - https://llms.mui.com/material-ui/6.4.12/api/drawer.md
  - `useMediaQuery` (theme breakpoints + SSR notes)
    - https://llms.mui.com/material-ui/6.4.12/components/use-media-query.md
  - Layout primitives (`Paper`, `Stack`, `Container`)

#### Subtasks

1. [ ] Read the current ChatPage layout and the current AgentsPage layout:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`

2. [ ] Rebuild the AgentsPage outer layout to mirror Chat:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Remove the current “two column Paper” layout.
     - Implement the same Drawer open state behavior as Chat (mobile vs desktop).
     - Render `ConversationList` inside the Drawer with `variant="agents"` and agent-scoped conversations.
     - Place agent-specific controls in the control bar area above the transcript.
     - Do not refactor ChatPage layout in this story; copy the layout pattern into AgentsPage.

3. [ ] Update/extend client tests to match the new layout:
   - Files to edit:
     - `client/src/test/agentsPage.commandsList.test.tsx`
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Requirements:
     - Ensure the tests locate the conversation list and controls in their new positions.
     - Keep assertions focused on behavior (not pixel layout).

4. [ ] Validate all existing Agents control behaviors still work after the layout refactor:
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
   - Tests to run/update (selectors + expectations only; do not change semantics):
     - `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
     - `client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx`
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
     - `client/src/test/agentsPage.commandsList.test.tsx`
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Required behaviors (must match today’s Agents page):
     - Agent change refreshes commands and clears `working_folder`.
     - “New conversation” clears transcript state and clears `working_folder`.
     - Send/Execute are disabled when persistence is unavailable (`mongoConnected=false`).
     - RUN_IN_PROGRESS conflicts still surface the same friendly error.

5. [ ] Update documentation to match the new Agents UI layout:
   - Files to edit:
     - `design.md`
     - `readme.md`

6. [ ] Run lint/format verification:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 
