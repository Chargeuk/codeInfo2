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

### 1. Server: allow client-supplied `conversationId` for new Agents runs

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Enable the Agents UI to generate a `conversationId` up front (so it can subscribe to WS early) by ensuring that providing `conversationId` does **not** force the conversation to already exist. This must apply to both single instruction runs and multi-step command runs.

#### Documentation Locations

- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Markdown guide (basic syntax, for updating docs/tree): https://www.markdownguide.org/basic-syntax/
- Supertest (Express route testing): Context7 `/ladjs/supertest`

#### Subtasks

1. [ ] Read how agent runs and command runs decide whether a conversation must exist:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/routes/agentsRun.ts`
     - `server/src/routes/agentsCommands.ts`
     - `server/src/agents/service.ts`
     - `server/src/agents/commandsRunner.ts`
   - What to look for:
     - In `server/src/agents/service.ts`, locate `runAgentInstruction(...)` and confirm it currently sets `mustExist` based on whether `conversationId` was provided.
     - In `server/src/agents/commandsRunner.ts`, locate `runAgentCommandRunner(...)` and confirm it derives `mustExist` from `Boolean(params.conversationId)`.
     - In `server/src/routes/agentsRun.ts`, confirm that the REST handler is synchronous (responds after the run is complete), which is why the UI must subscribe to WS before starting the run.
   - Output of this subtask:
     - A short note in this task’s Implementation notes summarizing the exact “mustExist” behavior you found and the functions/lines you’ll change.

2. [ ] Update agent run orchestration to allow “new conversation with provided id”:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - In `runAgentInstruction(...)`, stop passing `mustExist: Boolean(params.conversationId)` into `runAgentInstructionUnlocked(...)`.
       - Goal: a client-supplied `conversationId` should be allowed to create a new conversation (matching `/chat` semantics).
     - Keep existing protections:
       - archived conversations must still error (410)
       - agent mismatch must still error
   - Concrete implementation guidance:
     - After this change, a brand-new id should flow through the existing “new conversation” path in `runAgentInstructionUnlocked(...)` (the code that calls `ensureAgentConversation(...)` when there is no existing conversation).
     - Do not change the REST request/response shape.

3. [ ] Update agent command orchestration to allow “new conversation with provided id”:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/agents/commandsRunner.ts`
   - Requirements:
     - Stop deriving `mustExist` from `Boolean(params.conversationId)`.
     - Commands must be able to run with a client-supplied id that doesn’t exist yet.
   - Concrete implementation guidance:
     - Look for something like:
       ```ts
       const mustExist = Boolean(params.conversationId);
       ```
       and remove/neutralize it.
     - Ensure `runAgentInstructionUnlocked(...)` gets called with `mustExist` omitted or `false` for command steps.

4. [ ] Server integration test: client-supplied `conversationId` works even when the conversation does not exist yet:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/integration/agents-run-client-conversation-id.test.ts`
   - Requirements:
     - Call `runAgentInstruction(...)` (not `...Unlocked`) with a non-empty `conversationId` that does not exist.
     - Assert the run succeeds and returns the same `conversationId`.
   - Test scaffolding guidance:
     - Copy the environment setup pattern used by `server/src/test/integration/agents-run-ws-stream.test.ts` (it sets `CODEINFO_CODEX_AGENT_HOME` to the repo’s `codex_agents/` folder).
     - Provide a `chatFactory` test double so the test does not depend on real Codex.
       - Minimal: a `ChatInterface` subclass that emits `final` + `complete`.
     - Assert the returned object contains:
       - `result.conversationId === providedConversationId`
       - `result.agentName === agentName`

5. [ ] Server unit tests: keep existing Agents run error mappings stable (archived / agent mismatch / codex unavailable):
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Supertest (Express route testing): Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Requirements:
     - Add 3 focused tests that exercise the router’s error mapping (using the existing `buildApp({ runAgentInstruction })` pattern):
       - When the service throws `{ code: 'CONVERSATION_ARCHIVED' }`, assert HTTP `410` and `{ error: 'archived' }`.
       - When the service throws `{ code: 'AGENT_MISMATCH' }`, assert HTTP `400` and `{ error: 'agent_mismatch' }`.
       - When the service throws `{ code: 'CODEX_UNAVAILABLE', reason: '...' }`, assert HTTP `503` and `{ error: 'codex_unavailable', reason: '...' }`.
     - Keep these tests self-contained (no real agent discovery / no Codex).

6. [ ] Server: align `/agents/:agentName/commands/run` error mapping with `/agents/:agentName/run`:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Supertest (Express route testing): Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
     - `server/src/test/unit/agents-commands-router-run.test.ts`
   - Why this is needed (concrete):
     - `runAgentCommand(...)` ultimately calls `runAgentInstructionUnlocked(...)`, which can throw `CONVERSATION_ARCHIVED`, `AGENT_MISMATCH`, or `CODEX_UNAVAILABLE`.
     - Today the commands router does not include/match these codes in its error union, so these cases will fall through to a `500` and break parity.
   - Requirements:
     - Extend the commands router error union + mapping so these codes return the same HTTP + payload as `/agents/:agentName/run`:
       - `CONVERSATION_ARCHIVED` → `410 { error: 'archived' }`
       - `AGENT_MISMATCH` → `400 { error: 'agent_mismatch' }`
       - `CODEX_UNAVAILABLE` → `503 { error: 'codex_unavailable', reason }`
     - Add matching unit tests in `server/src/test/unit/agents-commands-router-run.test.ts` by stubbing `runAgentCommand` to throw those codes.

7. [ ] Server unit test: command runs must allow a client-supplied `conversationId` to be *new*:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/agent-commands-runner.test.ts`
   - Requirements:
     - Add a test that calls `runAgentCommandRunner({ conversationId: 'c1', ... })` and captures the params passed into `runAgentInstructionUnlocked(...)`.
     - Assert the runner does **not** set `mustExist: true` just because `conversationId` was provided (it should be omitted or `false`), so a new conversation id can be created on first use.

8. [ ] Update `projectStructure.md` with the new/updated server test files:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add any new server test file paths created in this task under the correct tree sections.

9. [ ] Run lint/format verification:
   - Documentation to read:
     - None (repo-local commands).
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- 

---

### 2. Server: emit chat-parity run-start WS events for agent runs

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Make agent runs follow the same run-start contract as `/chat`: create inflight state with full metadata, publish a `user_turn` WS event immediately, and propagate `inflightId` into `chat.run(...)` flags so persistence bookkeeping remains consistent.

#### Documentation Locations

- Node.js `AbortController` / `AbortSignal` (how abort flows propagate through async work): https://nodejs.org/api/globals.html#class-abortcontroller
- `ws` (WebSocket server for Node): Context7 `/websockets/ws/8_18_3`
- Node.js test runner (node:test) (server tests use this runner): https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Read the current Chat vs Agents run-start flow so changes are minimal and consistent:
   - Documentation to read:
     - Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller
     - `ws` docs (heartbeat / terminate vs close): Context7 `/websockets/ws/8_18_3`
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/routes/chat.ts`
     - `server/src/agents/service.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/ws/server.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/test/unit/ws-chat-stream.test.ts`
     - `server/src/test/integration/agents-run-ws-stream.test.ts`
   - What to copy exactly from `/chat`:
     - `createInflight({ provider, model, source, userTurn })`
     - `publishUserTurn({ conversationId, inflightId, content, createdAt })`
     - passing `inflightId` into `chat.run(..., flags)`

2. [ ] Create inflight state with chat-style metadata:
   - Documentation to read:
     - Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Mirror `/chat` run-start metadata in `createInflight(...)`:
       - `provider: 'codex'`
       - `model: modelId`
       - `source: params.source`
       - `userTurn: { content: params.instruction, createdAt: <iso string> }`
     - Keep existing `externalSignal` wiring (`params.signal`).
   - Concrete implementation guidance:
     - In `runAgentInstructionUnlocked(...)`, generate a single `nowIso = new Date().toISOString()` and use it for both `createInflight.userTurn.createdAt` and the later `publishUserTurn.createdAt`.
     - Use the agent run’s `modelId` (resolved from config) for the inflight `model` field.

3. [ ] Publish `user_turn` at run start:
   - Documentation to read:
     - `ws` docs (message send patterns): Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Call `publishUserTurn(...)` immediately after inflight creation (and before attaching the stream bridge), using the same `createdAt` stored in `userTurn`.
   - Expected behavior:
     - A WS client subscribed to the conversation should receive a `user_turn` event before the first `assistant_delta`.

4. [ ] Propagate `inflightId` into `chat.run(...)` flags:
   - Documentation to read:
     - None (repo-local semantics).
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Pass `inflightId` so `ChatInterface` can run `markInflightPersisted(...)` consistently with `/chat`.
   - Concrete implementation guidance:
     - Add `inflightId` to the flags object passed into `chat.run(...)`.
       - Example shape (do not copy blindly; match existing style):
         ```ts
         await chat.run(message, { provider: 'codex', inflightId, signal, source, ... }, conversationId, modelId);
         ```

5. [ ] Server integration test: agent run publishes `user_turn` over WS before deltas:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/integration/agents-run-ws-stream.test.ts`
   - Requirements:
     - Extend the existing test to assert `user_turn`:
       - `conversationId` matches
       - `inflightId` matches
       - `content` equals the submitted instruction
       - `createdAt` is a non-empty string
     - Assert ordering (corner case): the `user_turn` event is observed before the first `assistant_delta` for the same `(conversationId, inflightId)`.
     - Keep existing assertions for `inflight_snapshot`, `assistant_delta`, and `turn_final`.
   - Test authoring guidance:
     - In the test, start listening for events *before* starting the run (to avoid missing early frames).
     - Add a `waitForEvent` for `type === 'user_turn'` and assert it arrives.

6. [ ] Run lint/format verification:
   - Documentation to read:
     - None (repo-local commands).
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- 

---

### 3. Server: cancellation test coverage for Agents (`cancel_inflight`)

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Agent runs already share the same cancellation mechanism as Chat (`cancel_inflight` → `abortInflight` → inflight `AbortController.signal` passed into `chat.run(...)`, then the stream bridge publishes `turn_final: stopped`). This task adds missing agent-specific integration coverage so we don’t regress.

#### Documentation Locations

- Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller
- `ws` (WebSocket server for Node): Context7 `/websockets/ws/8_18_3`
- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Cucumber guides (Gherkin + steps overview): https://cucumber.io/docs/guides/
- Markdown guide (only for updating docs/tree): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Read the existing WS cancellation logic and the chat cancellation test patterns:
   - Documentation to read:
     - Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller
     - `ws` docs (heartbeat / terminate vs close): Context7 `/websockets/ws/8_18_3`
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Cucumber guides (feature files + steps): https://cucumber.io/docs/guides/10-minute-tutorial/
   - Files to read:
     - `server/src/ws/server.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/test/unit/ws-chat-stream.test.ts`
     - `server/src/test/features/chat_cancellation.feature`
     - `server/src/test/steps/chat_cancellation.steps.ts`
   - What to confirm:
     - `cancel_inflight` calls `abortInflight({ conversationId, inflightId })`.
     - When the provider sees the abort signal, the stream bridge publishes `turn_final` with `status: 'stopped'`.

2. [ ] Add server integration coverage for cancelling an agent run via WS:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/integration/agents-run-ws-cancel.test.ts`
   - Requirements:
     - Start an agent run via `runAgentInstructionUnlocked(...)` using a deterministic `inflightId`.
     - Subscribe to the conversation over WS and wait for an initial snapshot/delta.
     - Send `{ type: 'cancel_inflight', conversationId, inflightId }`.
     - Assert a `turn_final` event arrives with `status === 'stopped'`.
     - Assert the run promise resolves (no hang) and all servers/sockets are cleaned up.
   - Test scaffolding guidance:
     - Use the same `attachWs(...)` + `connectWs(...)` helpers as `agents-run-ws-stream.test.ts`.
     - Use a `ChatInterface` test double that:
       - emits a few deltas slowly, and
       - checks `flags.signal.aborted` and emits an `error` when aborted.
     - Expectation: after sending `cancel_inflight`, you should get `turn_final.status === 'stopped'`.

3. [ ] Update `projectStructure.md` with the new server test file:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file path:
       - `server/src/test/integration/agents-run-ws-cancel.test.ts`

4. [ ] Run lint/format verification:
   - Documentation to read:
     - None (repo-local commands).
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- 

---

### 4. Client: switch Agents transcript state to the Chat WS pipeline

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Remove bespoke inflight aggregation from the Agents page and reuse the same WebSocket transcript pipeline used by Chat (`useChatWs` + `useChatStream.handleWsEvent` + `useConversationTurns`). This makes transcript state (user turn, assistant deltas, tool events, status) consistent before the UI/layout parity refactors.

#### Documentation Locations

- React hooks (avoiding duplicated derived state): https://react.dev/learn/you-might-not-need-an-effect
- WebSocket (event-driven UI): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- `crypto.randomUUID()` (client-side conversation id generation): https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
- MUI MCP docs (accordions used by the chat transcript UI):
  - https://llms.mui.com/material-ui/6.4.12/components/accordion.md
- Jest (test runner + mocking): Context7 `/jestjs/jest`
- Testing Library (React): https://testing-library.com/docs/react-testing-library/intro/
- Testing Library queries: https://testing-library.com/docs/queries/about/
- Testing Library user events: https://testing-library.com/docs/user-event/intro/

#### Subtasks

1. [ ] Read the Chat WS transcript pipeline end-to-end:
   - Documentation to read:
     - React hooks patterns: https://react.dev/learn/you-might-not-need-an-effect
     - WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - MUI Accordion docs: https://llms.mui.com/material-ui/6.4.12/components/accordion.md
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
   - What to extract:
     - The exact `useChatStream` methods AgentsPage must call (`setConversation`, `hydrateHistory`, `hydrateInflightSnapshot`, `handleWsEvent`, `getInflightId`).
     - Which WS event types are forwarded to `handleWsEvent(...)`.

2. [ ] Refactor AgentsPage to use `useChatStream` for transcript state (messages/tools/citations):
   - Documentation to read:
     - React hooks patterns: https://react.dev/learn/you-might-not-need-an-effect
     - WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
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
   - Concrete implementation guidance (high level):
     - Replace bespoke `messages/liveInflight` state with `useChatStream(...).messages`.
     - Replace bespoke WS `onEvent` reducer with `handleWsEvent(event)` and `hydrateInflightSnapshot(...)`.
     - Keep the existing REST call functions (`runAgentInstruction`, `runAgentCommand`) but change the post-response behavior:
       - realtime enabled: do not append assistant bubble from `segments`
       - realtime disabled: continue to append assistant bubble from `segments`

3. [ ] Update client tests: realtime-enabled mode relies on WS events (and ignores REST `segments`):
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to edit:
     - `client/src/test/agentsPage.run.test.tsx`
   - Requirements:
     - Change the test to explicitly model the new contract:
       - `mongoConnected: true`
       - sending calls the Agents REST endpoint but transcript comes from WS.
     - Emit `user_turn`/`assistant_delta`/`turn_final` and assert the transcript renders.
     - Ensure the test would fail if the page incorrectly appended `result.segments` in realtime mode:
       - include a distinctive `segments: [{ type: 'answer', text: 'SEGMENT_SHOULD_NOT_RENDER' }]` in the REST response.
       - assert `SEGMENT_SHOULD_NOT_RENDER` is **not** visible after the run completes.

4. [ ] Update client tests: WS event handling edge cases (corner cases that must not regress):
   - Documentation to read:
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Add a test that confirms WS transcript events for a different `conversationId` are ignored (no cross-contamination).
       - Example: active conversation is `c1`; emit `assistant_delta` for `c2`; assert `c2` text never appears.
     - Add a test that confirms a late `turn_final` for an older `inflightId` does not overwrite a newer active run.
       - Use the same pattern as the Chat stream tests: start run A, then run B, then emit late final for A, ensure status/content reflect B.

5. [ ] Update client tests: persistence-unavailable mode still renders REST segments (fallback path):
   - Documentation to read:
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx`
   - Requirements:
     - Mock `GET /health` → `{ mongoConnected: false }`.
     - Mock `POST /agents/:agentName/run` to return a response containing a distinctive segment answer like `SEGMENT_FALLBACK_OK`.
     - Assert the segment content renders in the transcript even though no WS events are emitted.

6. [ ] Run full lint/format verification:
   - Documentation to read:
     - None (repo-local commands).
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 5. Client: align Agents transcript UI with Chat transcript UI

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Make Agents transcript rendering match Chat: same status chip behavior, same tool Parameters/Result accordions, same default-closed citations accordion, and the same “Thought process” accordion. Remove the Agents-only command metadata note while keeping `turn.command` persistence unchanged.

#### Documentation Locations

- MUI MCP docs (accordions used by the chat transcript UI):
  - https://llms.mui.com/material-ui/6.4.12/components/accordion.md
- MUI MCP docs (status chip used by the chat transcript UI):
  - https://llms.mui.com/material-ui/6.4.12/api/chip.md
- Jest (test runner + mocking): Context7 `/jestjs/jest`
- Testing Library (React): https://testing-library.com/docs/react-testing-library/intro/
- Testing Library queries: https://testing-library.com/docs/queries/about/
- Testing Library user events: https://testing-library.com/docs/user-event/intro/

#### Subtasks

1. [ ] Read the Chat transcript UI patterns to copy into Agents:
   - Documentation to read:
     - MUI Accordion docs: https://llms.mui.com/material-ui/6.4.12/components/accordion.md
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - What to identify:
     - The exact JSX blocks that render:
       - tool accordions (Parameters/Result + status)
       - citations accordion (`data-testid="citations-accordion"`)
       - thought process accordion

2. [ ] Update Agents transcript rendering to use the same tool + citations UI as Chat:
   - Documentation to read:
     - MUI Accordion docs: https://llms.mui.com/material-ui/6.4.12/components/accordion.md
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Do not change ChatPage transcript UI in this story. Instead, copy the Chat transcript UI patterns into AgentsPage and keep test ids consistent with Chat where applicable (e.g., `data-testid="citations-accordion"`, `data-testid="citations-toggle"`, `data-testid="citations"`).
     - Tool blocks must render with the same Parameters + Result accordions and the same status chip semantics.
     - Citations must render inside the same default-closed citations accordion used by Chat.
     - The “Thought process” (think/reasoning) accordion must behave the same way as Chat.
   - De-risk guidance:
     - Prefer copying the existing ChatPage JSX in small blocks and wiring it to the `ChatMessage` shape produced by `useChatStream`.
     - Avoid creating new shared components in this story unless necessary to keep changes small.

3. [ ] Remove the Agents-only command metadata transcript note:
   - Documentation to read:
     - None (repo-local change).
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Files to edit or delete:
     - `client/src/test/agentsPage.commandMetadataRender.test.tsx`
   - Requirements:
     - Remove the “Command run: … (step/total)” note from the transcript UI.
     - Keep persistence/storage of `turn.command` unchanged (other consumers may rely on it).

4. [ ] Client test: citations accordion renders under assistant bubbles (Agents parity with Chat):
   - Documentation to read:
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to add:
     - `client/src/test/agentsPage.citations.test.tsx`
   - Requirements:
     - Copy the approach from `client/src/test/chatPage.citations.test.tsx`, but mount `AgentsPage`.
     - Mock Agents fetch endpoints:
       - `GET /health` → `{ mongoConnected: true }`
       - `GET /agents` → one enabled agent
       - `GET /agents/:agentName/commands` → empty
       - `GET /conversations?agentName=...` and `GET /conversations/:id/turns` → minimal payloads
       - `POST /agents/:agentName/run` → success response (segments can be empty)
     - Emit WS events for an inflight tool-result that contains VectorSearch-style citations (same shape as Chat tests).
     - Assert:
       - `data-testid="citations-toggle"` shows `Citations (1)`
       - The accordion is collapsed by default
       - Expanding shows `data-testid="citation-path"` and `data-testid="citation-chunk"`.

5. [ ] Client test: thought process (analysis_delta / assistantThink) accordion behavior matches Chat:
   - Documentation to read:
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.reasoning.test.tsx`
   - Requirements:
     - Copy the approach from `client/src/test/chatPage.reasoning.test.tsx`, but mount `AgentsPage`.
     - Emit an inflight snapshot with `assistantThink` and/or emit `analysis_delta` events.
     - Assert `think-toggle` exists, is closed by default, and reveals `think-content` when clicked.

6. [ ] Client test: tool Parameters/Result accordions render for tool events:
   - Documentation to read:
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.toolsUi.test.tsx`
   - Requirements:
     - Emit a `tool_event` with a `tool-result` including `parameters` and `result`.
     - Assert `data-testid="tool-params-accordion"` and `data-testid="tool-result-accordion"` render and are collapsed by default.

7. [ ] Client test: status chip shows Failed when `turn_final.status === 'failed'`:
   - Documentation to read:
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.statusChip.test.tsx`
   - Requirements:
     - Emit an inflight snapshot + assistant delta, then emit `turn_final` with `status: 'failed'`.
     - Assert the visible status chip contains `Failed` (and does not contain `Complete`).

8. [ ] Run full lint/format verification:
   - Documentation to read:
     - None (repo-local commands).
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 6. Client: Agents Stop uses WS `cancel_inflight` + abort request (Chat parity)

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Update the Agents Stop behavior to match Chat: always abort the in-flight HTTP request, and when possible also send `cancel_inflight` over WebSocket using the active conversation + inflight id.

#### Documentation Locations

- React hooks (refs + effects for request lifecycle): https://react.dev/reference/react/useRef and https://react.dev/reference/react/useEffect
- WebSocket (client message contract): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- AbortController (fetch abort semantics): https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Testing Library user events: https://testing-library.com/docs/user-event/intro/

#### Subtasks

1. [ ] Read ChatPage Stop behavior and how it gets the inflight id:
   - Documentation to read:
     - React `useRef`: https://react.dev/reference/react/useRef
     - React `useEffect`: https://react.dev/reference/react/useEffect
     - WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - What to identify:
     - How Chat obtains `conversationId` and `inflightId` at stop time.
     - How Chat sends `cancel_inflight` and how it aborts requests.

2. [ ] Update AgentsPage Stop to send WS `cancel_inflight` in addition to aborting fetch:
   - Documentation to read:
     - WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Always abort the in-flight HTTP request via `AbortController` (immediate UI response and required to stop multi-step command runs).
     - Additionally, when `activeConversationId` and `getInflightId()` are both available, call `cancelInflight(activeConversationId, inflightId)`.
     - If the inflight id is not yet known (user clicks Stop immediately), aborting the request alone is still required.
   - Concrete implementation guidance:
     - Always call the existing `stop()` / abort logic first.
     - Only call `cancelInflight(conversationId, inflightId)` when both ids are non-empty.
       - Note: `useChatWs.cancelInflight(...)` is intentionally **not** gated by realtime/persistence, so it remains valid even when `mongoConnected === false`.

3. [ ] Client test: Stop sends a `cancel_inflight` WS message:
   - Documentation to read:
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Requirements:
     - Assert the WS mock recorded a message `{ type: 'cancel_inflight', conversationId, inflightId }`.

4. [ ] Client test: Stop clicked before inflight id is known does not send `cancel_inflight` (but still aborts HTTP):
   - Documentation to read:
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Requirements:
     - Trigger a command execute request and immediately click Stop *before* emitting any WS `inflight_snapshot`/`user_turn` that would populate an inflight id.
     - Assert the request abort signal becomes aborted.
     - Assert the WS mock recorded **no** `{ type: 'cancel_inflight', ... }` messages.

5. [ ] Run lint/format verification:
   - Documentation to read:
     - None (repo-local commands).
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 7. Client: Agents sidebar updates via WS (`subscribe_sidebar`)

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Bring Agents sidebar behavior to parity with Chat by subscribing to the sidebar WS feed and applying `conversation_upsert` / `conversation_delete` events to the Agents conversation list, filtered to the currently selected agent.

#### Documentation Locations

- React hooks (useEffect patterns for subscriptions): https://react.dev/reference/react/useEffect
- WebSocket (event-driven UI): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Testing Library queries: https://testing-library.com/docs/queries/about/
- Markdown guide (basic syntax, for updating docs/tree): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Read how ChatPage wires sidebar WS updates and filters out agent conversations:
   - Documentation to read:
     - React `useEffect`: https://react.dev/reference/react/useEffect
     - WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useConversations.ts`
     - `client/src/test/chatSidebar.test.tsx`
   - What to copy:
     - Calling `subscribeSidebar()` on mount and `unsubscribeSidebar()` on unmount.
     - Applying `conversation_upsert` / `conversation_delete` events via `applyWsUpsert` / `applyWsDelete`.

2. [ ] Update AgentsPage to subscribe to sidebar events and apply them to the agent-scoped conversation list:
   - Documentation to read:
     - React `useEffect`: https://react.dev/reference/react/useEffect
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Call `subscribeSidebar()` on mount (when persistence is available), and `unsubscribeSidebar()` on unmount.
     - On WS `conversation_upsert`, apply the event only when `event.conversation.agentName === selectedAgentName`.
     - On WS `conversation_delete`, remove the conversation by id.
     - Use `useConversations(...).applyWsUpsert` / `applyWsDelete` rather than rebuilding list logic.

3. [ ] Client test: Agents sidebar reflects WS `conversation_upsert` events for the active agent:
   - Documentation to read:
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.sidebarWs.test.tsx`
   - Requirements:
     - Mock an Agents page session.
     - Emit a `conversation_upsert` WS event with `agentName: 'a1'` and confirm it appears in the sidebar.
     - Emit a second `conversation_upsert` for a different `agentName` and confirm it is ignored.
     - Emit an upsert with a newer `lastMessageAt` and confirm it reorders to the top.

4. [ ] Client test: Agents sidebar removes items on WS `conversation_delete`:
   - Documentation to read:
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.sidebarWs.test.tsx`
   - Requirements:
     - Emit a `conversation_upsert` for an agent conversation and assert it renders.
     - Emit a `conversation_delete` for that `conversationId` and assert it is removed from the sidebar.

5. [ ] Update `projectStructure.md` with any new test files added:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`

6. [ ] Run lint/format verification:
   - Documentation to read:
     - None (repo-local commands).
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 8. Client: rebuild Agents page layout to match Chat (Drawer + controls + transcript)

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
  - Layout primitives:
    - `Paper` API: https://llms.mui.com/material-ui/6.4.12/api/paper.md
    - `Stack` API: https://llms.mui.com/material-ui/6.4.12/api/stack.md
    - `Container` API: https://llms.mui.com/material-ui/6.4.12/api/container.md
- React (components and hooks): https://react.dev/reference/react
- Testing Library queries: https://testing-library.com/docs/queries/about/

#### Subtasks

1. [ ] Read the current ChatPage layout and the current AgentsPage layout:
   - Documentation to read:
     - MUI Drawer API: https://llms.mui.com/material-ui/6.4.12/api/drawer.md
     - MUI useMediaQuery: https://llms.mui.com/material-ui/6.4.12/components/use-media-query.md
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - What to identify:
     - Which `Drawer` `variant` is used on mobile vs desktop.
     - The drawer width (expected 320).
     - The toggle test ids (e.g. `conversation-drawer-toggle`).

2. [ ] Rebuild the AgentsPage outer layout to mirror Chat:
   - Documentation to read:
     - MUI Drawer API: https://llms.mui.com/material-ui/6.4.12/api/drawer.md
     - MUI useMediaQuery: https://llms.mui.com/material-ui/6.4.12/components/use-media-query.md
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Remove the current “two column Paper” layout.
     - Implement the same Drawer open state behavior as Chat (mobile vs desktop) using `Drawer` variants (`temporary` on mobile, `persistent` on desktop) and `useMediaQuery(theme.breakpoints.down('sm'))`.
     - De-risk note: do not introduce additional “Drawer alignment” complexity (e.g. measuring dynamic top offsets) unless an existing test depends on it.
     - Render `ConversationList` inside the Drawer with `variant="agents"` and agent-scoped conversations.
     - Place agent-specific controls in the control bar area above the transcript.
     - Do not refactor ChatPage layout in this story; copy the layout pattern into AgentsPage.
   - Concrete implementation guidance:
     - Use `useMediaQuery(theme.breakpoints.down('sm'))` to set `isMobile`.
     - Use `<Drawer variant={isMobile ? 'temporary' : 'persistent'} ...>`.
     - Keep the sidebar inside the Drawer as `ConversationList`.

3. [ ] Update/extend client tests to match the new layout:
   - Documentation to read:
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.commandsList.test.tsx`
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Requirements:
     - Ensure the tests locate the conversation list and controls in their new positions.
     - Keep assertions focused on behavior (not pixel layout).

4. [ ] Validate all existing Agents control behaviors still work after the layout refactor:
   - Documentation to read:
     - None (repo-local semantics).
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

5. [ ] Run lint/format verification:
   - Documentation to read:
     - None (repo-local commands).
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

---

### 9. Final verification (acceptance criteria, clean builds, docs, and PR summary)

- Task Status: **__to_do__**
- Git Commits:

#### Overview

De-risk the story by doing a full end-to-end verification pass once all other tasks are complete. This task must confirm the acceptance criteria explicitly, run clean builds, run tests, validate Docker startup, ensure docs are consistent, and produce a PR summary.

#### Documentation Locations

- Docker (images/build): Context7 `/docker/docs`
- Docker Compose (service lifecycle): Context7 `/docker/compose`
- Playwright: Context7 `/microsoft/playwright.dev`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Verify the story’s Acceptance Criteria line-by-line and note any gaps.
   - Documentation to read:
     - This story’s Acceptance Criteria section (at the top of this file).
2. [ ] Run clean builds:
   - `npm run build --workspace server`
   - `npm run build --workspace client`
3. [ ] Run a clean Docker build and ensure Compose boots:
   - `npm run compose:build:clean`
   - `npm run compose:up`
4. [ ] Run automated tests:
   - `npm run test --workspace client`
   - `npm run test --workspace server`
   - `npm run e2e:test` (if environment supports it)
5. [ ] Update documentation (single pass to reduce merge conflicts):
   - `README.md`
   - `design.md`
   - `projectStructure.md`
6. [ ] Capture UI verification screenshots under `test-results/screenshots/` (see `planning/plan_format.md` naming convention).
7. [ ] Write a pull request summary comment covering all tasks and major changes.

#### Testing

1. [ ] Run the client Jest tests.
2. [ ] Run the server Cucumber tests.
3. [ ] Restart the Docker environment.
4. [ ] Run the e2e tests.

#### Implementation notes

- 
