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
- **External confirmation:** WebSocket-vs-SSE comparisons confirm SSE is unidirectional while WebSockets are bidirectional, reinforcing the WS-only unification decision:
  - MDN: Server-sent events (SSE): https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
  - MDN: WebSockets: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
  - LogRocket: SSE vs WebSockets: https://blog.logrocket.com/server-sent-events-vs-websockets/
- **Legacy streaming helper:** `server/src/chatStream.ts` still exists for older streaming paths; ensure Agents does not use it once WS unification is complete.
- **DeepWiki note:** the repo is not indexed in DeepWiki yet (“Repository not found”), so code references are confirmed locally; once indexed, re-check for any agent-specific design notes.
- **CodeInfo note (updated):** code_info MCP indexing is incomplete and can miss key server files (and occasionally surfaces results from a separate `CodeInfo2Planning` ingest). Treat local `rg`/file reads as the source of truth for implementation details.
- **Mermaid docs note:** the repo uses Mermaid `11.12.1`, but Context7’s Mermaid versions only include `v11_0_0`. Tasks that require Mermaid diagrams include both Context7 (required) and the official Mermaid syntax pages.
- **MUI docs note:** the repo installs MUI `6.5.0`, but the MUI MCP server currently exposes `6.4.12` as the nearest available v6 docs. Tasks reference those MUI MCP URLs for component APIs.

---

## Message Contracts & Storage Shapes

- **No new storage shapes are required.** Existing conversation/turn persistence remains unchanged.
- **No new WS event types are required.** Agents will emit the same existing WS v1 events as Chat (`user_turn`, `inflight_snapshot`, `assistant_delta`, `analysis_delta`, `tool_event`, `turn_final`).
- **No new REST fields are required.** `/agents/:agentName/run` continues to accept `instruction`, optional `conversationId`, and optional `working_folder` and returns `segments` for fallback/non-WS use (the UI should not depend on these segments).
- **Important server behavior:** when `conversationId` is supplied for Agents runs, the server must create the conversation if it does not exist (matching `/chat` semantics), so the client can safely generate an id up front for early WS subscription.

---

# Tasks

### 1. Server: allow client-supplied `conversationId` for new Agents runs

- Task Status: **__done__**
- Git Commits: ccd9772

#### Overview

Enable the Agents UI to generate a `conversationId` up front (so it can subscribe to WS early) by ensuring that providing `conversationId` does **not** force the conversation to already exist. This must apply to both single instruction runs and multi-step command runs.

#### Documentation Locations

- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Markdown guide (basic syntax, for updating docs/tree): https://www.markdownguide.org/basic-syntax/
- Supertest (Express route testing): Context7 `/ladjs/supertest`
- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official):
  - https://mermaid.js.org/syntax/sequenceDiagram.html
  - https://mermaid.js.org/syntax/flowchart.html
- Mermaid docs (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Flowchart Diagrams / Sequence Diagrams

#### Subtasks

1. [x] Read how agent runs and command runs decide whether a conversation must exist:
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

2. [x] Update agent run orchestration to allow “new conversation with provided id”:
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

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add a server log entry that appears in the in-app Logs page (`/logs`) by appending to the log store.
       - Files to read:
         - `server/src/logStore.ts`
       - Files to edit:
         - `server/src/agents/service.ts`
       - Requirements:
         - Import `append` from `../logStore.js` and emit an info-level entry **once per run** (right after `conversationId` is resolved and before invoking `runAgentInstructionUnlocked(...)`).
         - Use **this exact** message string so tests can search it reliably:
           - `DEV-0000021[T1] agents.run mustExist resolved`
         - Include a context object containing at least:
           - `agentName`
           - `source`
           - `conversationId`
           - `clientProvidedConversationId` (boolean)
           - `mustExist` (the exact value being passed into `runAgentInstructionUnlocked(...)`)


3. [x] Update agent command orchestration to allow “new conversation with provided id”:
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

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add a server log entry that appears in the in-app Logs page (`/logs`) by appending to the log store.
       - Files to read:
         - `server/src/logStore.ts`
       - Files to edit:
         - `server/src/agents/commandsRunner.ts`
       - Requirements:
         - Import `append` from `../logStore.js` and emit an info-level entry **once per command-run** (before the first command step is executed).
         - Use **this exact** message string so tests can search it reliably:
           - `DEV-0000021[T1] agents.commands mustExist resolved`
         - Include a context object containing at least:
           - `agentName`
           - `commandName`
           - `conversationId`
           - `clientProvidedConversationId` (boolean)
           - `mustExist` (the exact value passed down into `runAgentInstructionUnlocked(...)`)


4. [x] Server integration test: client-supplied `conversationId` works even when the conversation does not exist yet:
   - Test type:
     - node:test integration test (server)
   - Test location:
     - `server/src/test/integration/agents-run-client-conversation-id.test.ts`
   - Description:
     - Calls `runAgentInstruction(...)` with a client-supplied `conversationId` that is not yet stored, and expects the run to succeed.
   - Purpose:
     - Proves the key prerequisite for the Agents UI: the client can generate an id up front, subscribe to WS, then start the synchronous REST run.
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

5. [x] Server unit test (node:test + Supertest): `/agents/:agentName/run` maps `CONVERSATION_ARCHIVED` to `410`:
   - Description:
     - When the service returns `{ code: 'CONVERSATION_ARCHIVED' }`, the router must respond with `410 { error: 'archived' }`.
   - Purpose:
     - Prevent regressions when Task 1 changes conversation id semantics.
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Supertest (Express route testing): Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Requirements:
     - Use the existing `buildApp({ runAgentInstruction })` helper and stub `runAgentInstruction` to throw `{ code: 'CONVERSATION_ARCHIVED' }`.
     - Assert `res.status === 410` and `res.body` deep-equals `{ error: 'archived' }`.

6. [x] Server unit test (node:test + Supertest): `/agents/:agentName/run` maps `AGENT_MISMATCH` to `400`:
   - Description:
     - When the service returns `{ code: 'AGENT_MISMATCH' }`, the router must respond with `400 { error: 'agent_mismatch' }`.
   - Purpose:
     - Ensure wrong-agent conversation ids can’t be reused across agents.
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Supertest (Express route testing): Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Requirements:
     - Stub `runAgentInstruction` to throw `{ code: 'AGENT_MISMATCH' }`.
     - Assert `res.status === 400` and `res.body` deep-equals `{ error: 'agent_mismatch' }`.

7. [x] Server unit test (node:test + Supertest): `/agents/:agentName/run` maps `CODEX_UNAVAILABLE` to `503`:
   - Description:
     - When the service returns `{ code: 'CODEX_UNAVAILABLE', reason }`, the router must respond with `503 { error: 'codex_unavailable', reason }`.
   - Purpose:
     - Ensure the UI can show a stable, actionable disabled-state when Codex is missing.
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Supertest (Express route testing): Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Requirements:
     - Stub `runAgentInstruction` to throw `{ code: 'CODEX_UNAVAILABLE', reason: 'no auth.json' }`.
     - Assert `res.status === 503` and `res.body` contains `{ error: 'codex_unavailable', reason: 'no auth.json' }`.

8. [x] Server change: align `/agents/:agentName/commands/run` error mapping with `/agents/:agentName/run`:
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

9. [x] Server unit test (node:test + Supertest): `/agents/:agentName/commands/run` maps `CONVERSATION_ARCHIVED` to `410`:
   - Description:
     - When `runAgentCommand` throws `{ code: 'CONVERSATION_ARCHIVED' }`, the router must respond with `410 { error: 'archived' }`.
   - Purpose:
     - Keep commands-run parity with normal Agents runs.
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Supertest (Express route testing): Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/agents-commands-router-run.test.ts`
   - Requirements:
     - Stub `runAgentCommand` to throw `{ code: 'CONVERSATION_ARCHIVED' }`.
     - Assert `res.status === 410` and `res.body` deep-equals `{ error: 'archived' }`.

10. [x] Server unit test (node:test + Supertest): `/agents/:agentName/commands/run` maps `AGENT_MISMATCH` to `400`:
    - Description:
      - When `runAgentCommand` throws `{ code: 'AGENT_MISMATCH' }`, the router must respond with `400 { error: 'agent_mismatch' }`.
    - Purpose:
      - Ensure commands can’t be executed against a conversation owned by another agent.
    - Documentation to read:
      - Node.js test runner (node:test): https://nodejs.org/api/test.html
      - Supertest (Express route testing): Context7 `/ladjs/supertest`
    - Files to edit:
      - `server/src/test/unit/agents-commands-router-run.test.ts`
    - Requirements:
      - Stub `runAgentCommand` to throw `{ code: 'AGENT_MISMATCH' }`.
      - Assert `res.status === 400` and `res.body` deep-equals `{ error: 'agent_mismatch' }`.

11. [x] Server unit test (node:test + Supertest): `/agents/:agentName/commands/run` maps `CODEX_UNAVAILABLE` to `503`:
    - Description:
      - When `runAgentCommand` throws `{ code: 'CODEX_UNAVAILABLE', reason }`, the router must respond with `503 { error: 'codex_unavailable', reason }`.
    - Purpose:
      - Ensure commands-run failures surface as an actionable 503, not an opaque 500.
    - Documentation to read:
      - Node.js test runner (node:test): https://nodejs.org/api/test.html
      - Supertest (Express route testing): Context7 `/ladjs/supertest`
    - Files to edit:
      - `server/src/test/unit/agents-commands-router-run.test.ts`
    - Requirements:
      - Stub `runAgentCommand` to throw `{ code: 'CODEX_UNAVAILABLE', reason: 'missing codex config' }`.
      - Assert `res.status === 503` and `res.body` contains `{ error: 'codex_unavailable', reason: 'missing codex config' }`.

12. [x] Server unit test (node:test): command runs must allow a client-supplied `conversationId` to be *new*:
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agent-commands-runner.test.ts`
   - Description:
     - Ensures the command runner does not turn a provided `conversationId` into a “must exist” requirement.
   - Purpose:
     - Prevents a regression where the UI passes a pre-generated id (for early WS subscription) but server rejects it as not-yet-created.
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/agent-commands-runner.test.ts`
   - Requirements:
     - Add a test that calls `runAgentCommandRunner({ conversationId: 'c1', ... })` and captures the params passed into `runAgentInstructionUnlocked(...)`.
     - Assert the runner does **not** set `mustExist: true` just because `conversationId` was provided (it should be omitted or `false`), so a new conversation id can be created on first use.

13. [x] Update `design.md` with the new Agents conversationId flow and why the server must accept client-provided ids:
   - Documentation to read:
     - Mermaid diagrams (Markdown code block + sequence diagrams): Context7 `/mermaid-js/mermaid/v11_0_0`
     - Mermaid sequence diagram syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html
     - Mermaid diagrams (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Sequence Diagrams
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add or update a short “Agents run (conversationId contract)” section that states:
       - client may generate `conversationId` up front
       - server must create the conversation when a new id is provided (do not require pre-existence)
       - reason: Agents REST run is synchronous; WS must be subscribed before the request starts
     - Add a Mermaid `sequenceDiagram` showing:
       - client connects WS → `subscribe_conversation(conversationId)`
       - client POSTs `/agents/:agentName/run` with the same `conversationId`
       - server creates conversation if missing, then streams via WS.

14. [x] Update `projectStructure.md` with the new/updated server test files:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add:
       - `server/src/test/integration/agents-run-client-conversation-id.test.ts`
     - Remove:
       - (none)

15. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Start a new Agents conversation and send an instruction with a client-supplied `conversationId` (new id not yet persisted).
   - Confirm the run completes successfully (no `archived`/`agent_mismatch`/`agent_run_failed` error) and the transcript renders.
   - Execute an Agent command run from the same new conversation id and confirm it also completes.
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T1] agents.run mustExist resolved`
     - `DEV-0000021[T1] agents.commands mustExist resolved`
   - Confirm the log entries include the same `conversationId`/`inflightId` you just exercised (where applicable).
9. [x] `npm run compose:down`

#### Implementation notes

- Testing 2: `npm run build --workspace client` passed (`vite build`).
- Testing 1: `npm run build --workspace server` passed (`tsc -b`).
- Subtask 26: Ran `npm run lint --workspaces` (warnings only) and `npm run format:check --workspaces` (clean after `npm run format --workspaces`).
- Subtask 25: Updated `projectStructure.md` to include the new Agents page test files and refreshed outdated test descriptions impacted by WS-only async runs.
- Subtask 24: Updated `README.md` Agents REST API section to document `202 started` responses, background execution, and explicit cancellation (Stop / WS `cancel_inflight`).
- Subtask 23: Updated `design.md` with async Agents REST diagrams (202 start + background WS streaming) and added an async command-run section showing multi-step execution and cancellation via `cancel_inflight`.
- Subtask 22: Added `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx` to assert navigating away does not send `cancel_inflight`, and that returning + resubscribing resumes transcript updates via WS events.
- Subtask 21: Updated `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx` to assert WS-only behavior (shows a realtime banner and disables Send on WS disconnect) instead of rendering REST segment fallbacks.
- Subtask 20: Updated `client/src/test/agentsPage.commandsRun.abort.test.tsx` to align with async starts: Stop no longer aborts the HTTP request; it only sends WS `cancel_inflight` once an inflight id is known.
- Subtask 19: Added `client/src/test/agentsPage.run.commandError.test.tsx` to cover command start failures (404/409) rendering an error banner and leaving the run stopped.
- Subtask 18: Added `client/src/test/agentsPage.run.instructionError.test.tsx` to cover instruction start failures (404/409) rendering an error banner and leaving the run stopped.
- Subtask 17: Updated `client/src/test/agentsPage.run.test.tsx` mocks for `202 { status:'started', inflightId }` and kept assertions WS events drive transcript rendering (no REST segments).
- Subtasks 10-16: Verified start-error mapping coverage via the updated router unit tests (`agents-router-run` + `agents-commands-router-run`), ensuring these errors return 4xx/409 instead of `202 started`.
- Subtask 9: Added unit coverage for multi-step command cancellation via `abortAgentCommandRun(...)` in `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`.
- Subtasks 7-8: Updated server route unit tests to match async REST behavior: `server/src/test/unit/agents-router-run.test.ts` and `server/src/test/unit/agents-commands-router-run.test.ts` now assert `202` + `status:'started'` payloads and no longer assert request-bound abort semantics.
- Subtask 6: Refactored `client/src/pages/AgentsPage.tsx` to be WS-only for transcript updates: removed REST `segments` fallback and all request-bound AbortController logic; start requests are short-lived and do not cancel server runs. Send/Execute now require an open WebSocket connection, and Stop cancels via WS `cancel_inflight` only.
- Subtask 5: Updated `client/src/api/agents.ts` to parse the new async `202` start payloads: instruction runs now return `{ status:'started', conversationId, inflightId, modelId }` (no `segments`), and command runs return `{ status:'started', conversationId, commandName, modelId }`.
- Subtask 4: Added command-level cancellation: `server/src/agents/commandsRunner.ts` now tracks a per-conversation `AbortController` for command runs and checks it before each step; `server/src/ws/server.ts` calls `abortAgentCommandRun(conversationId)` when `cancel_inflight` succeeds so remaining command steps stop (in addition to aborting the current inflight step).
- Subtask 3: Implemented async start for command runs: `server/src/routes/agentsCommands.ts` now returns `202 { status:'started', agentName, commandName, conversationId, modelId }` and no longer binds the run to request abort/close; `server/src/agents/service.ts` adds `startAgentCommand(...)` which preflights command + conversation errors, acquires the conversation lock, then starts `runAgentCommandRunner(...)` in the background while keeping the lock held until completion.
- Subtask 2: Implemented async start for instruction runs: `server/src/routes/agentsRun.ts` now returns `202 { status:'started', agentName, conversationId, inflightId, modelId }` and no longer wires request abort/close into an AbortController; `server/src/agents/service.ts` adds `startAgentInstruction(...)` which holds the conversation lock while kicking off `runAgentInstructionUnlocked(...)` in the background.
- Current behavior: `runAgentInstruction(...)` sets `mustExist: Boolean(params.conversationId)` when calling `runAgentInstructionUnlocked(...)`, which causes a client-supplied-but-new id to throw `AGENT_NOT_FOUND` via `if (params.mustExist && isNewConversation)` in `server/src/agents/service.ts`.
- Current behavior: `runAgentCommandRunner(...)` sets `const mustExist = Boolean(params.conversationId);` and passes it to `runAgentInstructionUnlocked(...)` for each command step, so a new client-supplied id is rejected the same way.
- Change: `server/src/agents/service.ts` now always passes `mustExist: false` into `runAgentInstructionUnlocked(...)` so a client-supplied id can create a new conversation (archived + agent mismatch protections remain enforced inside `runAgentInstructionUnlocked(...)`).
- Added required logs: `server/src/agents/service.ts` appends `DEV-0000021[T1] agents.run mustExist resolved` once per run with `{ agentName, source, conversationId, clientProvidedConversationId, mustExist }`.
- Change: `server/src/agents/commandsRunner.ts` now always uses `mustExist = false` so a client-supplied id can be new on first command run.
- Added required logs: `server/src/agents/commandsRunner.ts` appends `DEV-0000021[T1] agents.commands mustExist resolved` once per command run with `{ agentName, commandName, conversationId, clientProvidedConversationId, mustExist }`.
- Added integration coverage: `server/src/test/integration/agents-run-client-conversation-id.test.ts` calls `runAgentInstruction(...)` with a client-supplied conversation id that does not exist yet (memory persistence) and asserts the run succeeds and returns the same id.
- Added unit coverage: `server/src/test/unit/agents-router-run.test.ts` now asserts `CONVERSATION_ARCHIVED` maps to `410 { error: 'archived' }`.
- Added unit coverage: `server/src/test/unit/agents-router-run.test.ts` now asserts `AGENT_MISMATCH` maps to `400 { error: 'agent_mismatch' }`.
- Added unit coverage: `server/src/test/unit/agents-router-run.test.ts` now asserts `CODEX_UNAVAILABLE` maps to `503 { error: 'codex_unavailable', reason }`.
- Change: `server/src/routes/agentsCommands.ts` now maps `CONVERSATION_ARCHIVED` → 410, `AGENT_MISMATCH` → 400, and `CODEX_UNAVAILABLE` → 503 to match `/agents/:agentName/run`.
- Added unit coverage: `server/src/test/unit/agents-commands-router-run.test.ts` now asserts `CONVERSATION_ARCHIVED` maps to `410 { error: 'archived' }`.
- Added unit coverage: `server/src/test/unit/agents-commands-router-run.test.ts` now asserts `AGENT_MISMATCH` maps to `400 { error: 'agent_mismatch' }`.
- Added unit coverage: `server/src/test/unit/agents-commands-router-run.test.ts` now asserts `CODEX_UNAVAILABLE` maps to `503 { error: 'codex_unavailable', reason }`.
- Added unit coverage: `server/src/test/unit/agent-commands-runner.test.ts` now asserts a client-supplied `conversationId` does not force `mustExist: true` in `runAgentInstructionUnlocked(...)`.
- Docs: `design.md` now documents the Agents “conversationId contract” (client generates id up front, server creates conversation on first use) and includes a WS-first sequence diagram.
- Docs: `projectStructure.md` now includes `server/src/test/integration/agents-run-client-conversation-id.test.ts`.
- Validation: `npm run lint --workspaces` passes (existing import-order warnings remain in unrelated files).
- Validation: `npm run format:check --workspaces` passes after running `npm run format --workspace server`.
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server`.
- Testing: `npm run test --workspace client`.
- Testing: `npm run e2e`.
- Testing: `npm run compose:build`.
- Testing: `npm run compose:up`.
- Testing: `npm run compose:down`.
- Manual verification (host.docker.internal): subscribed to `ws://host.docker.internal:5010/ws` for a new id, then called `POST /agents/planning_agent/run` with `conversationId=manual-t1-1767548777522-264683146fda4` and observed `turn_final { status: 'ok' }`.
- Manual verification (host.docker.internal): executed `POST /agents/planning_agent/commands/run` with `{ commandName: 'smoke', conversationId: manual-t1-1767548777522-264683146fda4 }` and confirmed `/logs?text=DEV-0000021[T1]` contains both required log entries with `clientProvidedConversationId: true` and `mustExist: false`.
- Testing: `npm run compose:down`.

---

### 2. Server: emit chat-parity run-start WS events for agent runs

- Task Status: **__done__**
- Git Commits: 7d91851

#### Overview

Make agent runs follow the same run-start contract as `/chat`: create inflight state with full metadata, publish a `user_turn` WS event immediately, and propagate `inflightId` into `chat.run(...)` flags so persistence bookkeeping remains consistent.

#### Documentation Locations

- Node.js `AbortController` / `AbortSignal` (how abort flows propagate through async work): https://nodejs.org/api/globals.html#class-abortcontroller
- `ws` (WebSocket server for Node): Context7 `/websockets/ws/8_18_3`
- Node.js test runner (node:test) (server tests use this runner): https://nodejs.org/api/test.html
- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official):
  - https://mermaid.js.org/syntax/sequenceDiagram.html
  - https://mermaid.js.org/syntax/flowchart.html
- Mermaid docs (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Flowchart Diagrams / Sequence Diagrams

#### Subtasks

1. [x] Read the current Chat vs Agents run-start flow so changes are minimal and consistent:
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

2. [x] Create inflight state with chat-style metadata:
   - Documentation to read:
     - Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller
     - WebSocket server publish helpers (where `publishUserTurn` is defined): Context7 `/websockets/ws/8_18_3`
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
     - Replace the existing inflight creation call:
       ```ts
       createInflight({ conversationId, inflightId, externalSignal: params.signal });
       ```
       with a chat-parity call (keep the same `externalSignal` wiring):
       ```ts
       createInflight({
         conversationId,
         inflightId,
         provider: 'codex',
         model: modelId,
         source: params.source,
         userTurn: { content: params.instruction, createdAt: nowIso },
         externalSignal: params.signal,
       });
       ```

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add a server log entry that appears in the in-app Logs page (`/logs`) by appending to the log store.
       - Files to read:
         - `server/src/logStore.ts`
       - Files to edit:
         - `server/src/agents/service.ts`
       - Requirements:
         - Immediately after `createInflight(...)`, emit an info-level entry with:
           - `message: 'DEV-0000021[T2] agents.inflight created'`
           - `context` containing at least: `conversationId`, `inflightId`, `provider`, `model`, `source`, and `userTurnCreatedAt` (the same `nowIso`).

3. [x] Publish `user_turn` at run start:
   - Documentation to read:
     - `ws` docs (message send patterns): Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/agents/service.ts`
   - Files to read:
     - `server/src/ws/server.ts`
   - Requirements:
     - Call `publishUserTurn(...)` immediately after inflight creation (and before attaching the stream bridge), using the same `createdAt` stored in `userTurn`.
   - Concrete implementation guidance:
     - Add a direct import (keep `.js` extension to match the repo’s ESM style):
       ```ts
       import { publishUserTurn } from '../ws/server.js';
       ```
     - Immediately after `createInflight(...)`, add:
       ```ts
       publishUserTurn({
         conversationId,
         inflightId,
         content: params.instruction,
         createdAt: nowIso,
       });
       ```
   - Expected behavior:
     - A WS client subscribed to the conversation should receive a `user_turn` event before the first `assistant_delta`.

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add a server log entry that appears in the in-app Logs page (`/logs`) by appending to the log store.
       - Files to read:
         - `server/src/logStore.ts`
       - Files to edit:
         - `server/src/agents/service.ts`
       - Requirements:
         - Immediately after `publishUserTurn(...)`, emit an info-level entry with:
           - `message: 'DEV-0000021[T2] agents.ws user_turn published'`
           - `context` containing at least: `conversationId`, `inflightId`, and `createdAt` (the same `nowIso`).

4. [x] Propagate `inflightId` into `chat.run(...)` flags:
   - Documentation to read:
     - None (repo-local semantics).
   - Files to read:
     - `server/src/chat/interfaces/ChatInterface.ts`
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

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add a server log entry that appears in the in-app Logs page (`/logs`) by appending to the log store.
       - Files to read:
         - `server/src/logStore.ts`
       - Files to edit:
         - `server/src/agents/service.ts`
       - Requirements:
         - Immediately before invoking `chat.run(...)`, emit an info-level entry with:
           - `message: 'DEV-0000021[T2] agents.chat.run flags include inflightId'`
           - `context` containing at least: `conversationId`, `inflightId`, and `flagsInflightId` (the exact value passed into the flags object).

5. [x] Server integration test: agent run publishes `user_turn` over WS before deltas:
   - Test type:
     - node:test integration test (server)
   - Test location:
     - `server/src/test/integration/agents-run-ws-stream.test.ts`
   - Description:
     - Extends the existing Agents WS stream test to assert that a `user_turn` event is published immediately at run start.
   - Purpose:
     - Ensures Agents matches Chat’s run-start WS contract so the client transcript can render the user bubble before deltas.
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

6. [x] Server integration test: agent run passes `inflightId` into `chat.run(...)` flags:
   - Test type:
     - node:test integration test (server)
   - Test location:
     - `server/src/test/integration/agents-run-ws-stream.test.ts`
   - Description:
     - Ensures the Agents run path includes `inflightId` in the flags object passed to `ChatInterface.run(...)`.
   - Purpose:
     - Prevents regressions where turn persistence cannot call `markInflightPersisted(...)` because `inflightId` was not provided.
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/integration/agents-run-ws-stream.test.ts`
   - Requirements:
     - Add a separate test case (do not overload the existing WS transcript test).
     - Use a `ChatInterface` test double that captures the `flags` parameter passed into `execute(...)`.
     - Start an agent run with a known deterministic `inflightId`.
     - Assert the captured flags contain:
       - `inflightId` equal to the requested inflight id.
       - `source` equal to the provided source (e.g. `'REST'`).
     - Keep the test fast: no WS server is required for this check; it only validates the `chat.run(...)` call contract.

7. [x] Remove any legacy Agents-only server path that bypasses the shared run orchestration:
   - Documentation to read:
     - None (repo-local audit).
   - Files to scan:
     - `server/src/agents/`
     - `server/src/routes/`
     - `server/src/chat/`
   - Requirements:
     - Search for any Agents-only streaming or transcript plumbing that does **not** use the shared `chat.run(...)` + `chatStreamBridge` path (for example: bespoke SSE handlers, duplicate WS emitters, or standalone transcript aggregators).
     - If any such code exists and is now redundant after Tasks 1–2, remove it and update any imports/tests.
     - If no such code exists, note that explicitly in this task’s Implementation notes.

8. [x] Update `design.md` with the Agents run-start WS contract (Chat parity):
   - Documentation to read:
     - Mermaid diagrams (sequence diagram syntax): Context7 `/mermaid-js/mermaid/v11_0_0`
     - Mermaid sequence diagram syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html
     - Mermaid diagrams (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Sequence Diagrams
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid `sequenceDiagram` titled like “Agents run (WS start events)” showing:
       - `createInflight` occurs first
       - server publishes `user_turn` immediately
       - then `inflight_snapshot` / deltas / `turn_final`.

9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

9. [x] Update `projectStructure.md` for new files added in this task:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add `server/src/test/integration/agents-run-ws-stream.test.ts` after the file is created.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Open Agents in two browser contexts (two tabs or two windows).
   - Start an Agents run in context A and confirm context B shows the initiating user message immediately (run-start parity) and then receives streaming transcript updates.
   - Confirm the final assistant status transitions to the correct completed state and the conversation appears in the sidebar.
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T2] agents.inflight created`
     - `DEV-0000021[T2] agents.ws user_turn published`
     - `DEV-0000021[T2] agents.chat.run flags include inflightId`
   - Confirm the log entries include the same `conversationId`/`inflightId` you just exercised (where applicable).
9. [x] `npm run compose:down`

#### Implementation notes

- Docs used: `ws` heartbeat guidance (ping/pong + `terminate()` for dead peers) to align any WS publish/start-ordering assumptions.
- Gotchas: publish `user_turn` before the first `assistant_delta` (and ideally before stream bridge attaches) and reuse a single `createdAt` for inflight + WS event so client transcript ordering is deterministic.
- Gotchas: pass `inflightId` into `chat.run(..., flags)` so `ChatInterface` can mark inflight persistence (`markInflightPersisted`) and keep run bookkeeping consistent.
- Current Chat run-start: `/chat` calls `createInflight(...)` → `publishUserTurn(...)` → `attachChatStreamBridge(...)` → `chat.run(...)`.
- Server change: `server/src/agents/service.ts` now mirrors `/chat` run-start ordering and metadata.
- Added required logs (for manual check): `DEV-0000021[T2] agents.inflight created`, `DEV-0000021[T2] agents.ws user_turn published`, `DEV-0000021[T2] agents.chat.run flags include inflightId`.
- Tests: `server/src/test/integration/agents-run-ws-stream.test.ts` now asserts `user_turn` (including `seq` ordering vs the first `assistant_delta`) and includes a fast flags-only test for `inflightId` propagation.
- Audit: no additional Agents-only streaming/transcript plumbing exists outside `chat.run(...)` + `attachChatStreamBridge(...)`.
- Docs: `design.md` now includes an “Agents run (WS start events)” Mermaid sequence diagram documenting the createInflight → user_turn → snapshot/deltas/final ordering.
- Validation: `npm run lint --workspaces` (warnings only) and `npm run format:check --workspaces` pass.
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server`.
- Testing: `npm run test --workspace client`.
- Testing: `npm run e2e`.
- Testing: `npm run compose:build`.
- Testing: `npm run compose:up`.
- Manual verification (host.docker.internal): created conversation `manual-t2-1767551049587-a3a7742c0c96e`, observed `user_turn` (seq 1) before first `assistant_delta` (seq 4) across two independent subscribers, then `turn_final { status: 'ok' }` with `inflightId=e2fd4a3e-d58c-4111-9a6b-4e2eca536845`.
- Manual verification (host.docker.internal): confirmed `/logs?text=DEV-0000021[T2]` contains `DEV-0000021[T2] agents.inflight created`, `DEV-0000021[T2] agents.ws user_turn published`, and `DEV-0000021[T2] agents.chat.run flags include inflightId` for the same `conversationId`/`inflightId`.
- Testing: `npm run compose:down`.

---

### 3. Server: cancellation test coverage for Agents (`cancel_inflight`)

- Task Status: **__done__**
- Git Commits: da3a93d

#### Overview

Agent runs already share the same cancellation mechanism as Chat (`cancel_inflight` → `abortInflight` → inflight `AbortController.signal` passed into `chat.run(...)`, then the stream bridge publishes `turn_final: stopped`). This task adds missing agent-specific integration coverage so we don’t regress.

#### Documentation Locations

- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html

- Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller
- `ws` (WebSocket server for Node): Context7 `/websockets/ws/8_18_3`
- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Cucumber guides (Gherkin + steps overview): https://cucumber.io/docs/guides/
- Markdown guide (only for updating docs/tree): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Read the existing WS cancellation logic and the chat cancellation test patterns:
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

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add server log entries that appear in the in-app Logs page (`/logs`) by appending to the log store.
       - Files to read:
         - `server/src/logStore.ts`
       - Files to edit:
         - `server/src/ws/server.ts`
         - `server/src/chat/inflightRegistry.ts`
       - Requirements:
         - When a WS `cancel_inflight` message is received and validated, emit:
           - `message: 'DEV-0000021[T3] ws cancel_inflight received'`
           - `context` containing at least: `conversationId`, `inflightId`
         - When `abortInflight(...)` actually aborts the inflight controller, emit:
           - `message: 'DEV-0000021[T3] inflight aborted'`
           - `context` containing at least: `conversationId`, `inflightId`

2. [x] Add server integration coverage for cancelling an agent run via WS:
   - Test type:
     - node:test integration test (server)
   - Test location:
     - `server/src/test/integration/agents-run-ws-cancel.test.ts`
   - Description:
     - Starts an Agents run, sends a WS `cancel_inflight` message, and expects a `turn_final` event with `status: 'stopped'`.
   - Purpose:
     - Locks in Agents stop/cancel parity with Chat and prevents hangs/regressions in abort handling.
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

3. [x] Update `projectStructure.md` with the new server test file:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file path:
       - `server/src/test/integration/agents-run-ws-cancel.test.ts`
     - Remove:
       - (none)

4. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Start an Agents run and click Stop while the run is still streaming.
   - Confirm the run stops promptly and the transcript shows a stopped final state (not a generic failure).
   - Confirm starting a new run after stopping works (no stuck “RUN_IN_PROGRESS” state).
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T3] ws cancel_inflight received`
     - `DEV-0000021[T3] inflight aborted`
   - Confirm the log entries include the same `conversationId`/`inflightId` you just exercised (where applicable).
9. [x] `npm run compose:down`

#### Implementation notes

- Added T3 log lines: `DEV-0000021[T3] ws cancel_inflight received` (WS handler) and `DEV-0000021[T3] inflight aborted` (AbortController aborted).
- Added `server/src/test/integration/agents-run-ws-cancel.test.ts` to cover cancelling an agent run via WS and asserting `turn_final.status === 'stopped'`.
- Updated `projectStructure.md` to list the new integration test.
- Validation: `npm run lint --workspaces` (warnings only) and `npm run format:check --workspaces` pass (after `npm run format --workspace server`).
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server` (took ~5m).
- Testing: `npm run test --workspace client`.
- Testing: `npm run e2e`.
- Testing: `npm run compose:build`.
- Testing: `npm run compose:up`.
- Manual verification (host.docker.internal): started `/agents/coding_agent/run` with `conversationId=manual-t3-1767552898649-24f1a37a`, observed WS `inflight_snapshot.inflightId=2729172a-308c-46b6-850c-2e0945e9f83d`, sent `cancel_inflight`, and observed `turn_final.status === 'stopped'` plus both required log messages in `/logs?text=DEV-0000021[T3]`.
- 
---

### 4. Client: switch Agents transcript state to the Chat WS pipeline

- Task Status: **__done__**
- Git Commits: a6605c4

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
- Markdown guide (basic syntax, for updating docs/tree): https://www.markdownguide.org/basic-syntax/
- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official):
  - https://mermaid.js.org/syntax/sequenceDiagram.html
  - https://mermaid.js.org/syntax/flowchart.html
- Mermaid docs (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Flowchart Diagrams / Sequence Diagrams

#### Subtasks

1. [x] Read the Chat WS transcript pipeline end-to-end:
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

2. [x] Refactor AgentsPage to use `useChatStream` for transcript state (messages/tools/citations):
   - Documentation to read:
     - React hooks patterns: https://react.dev/learn/you-might-not-need-an-effect
     - WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Instantiate `useChatStream` with fixed `provider='codex'` and a safe fallback `model` string (Agents should not expose provider/model controls).
     - Replace the “safe fallback” once the real model is known:
       - Store `agentModelId` in state.
       - When a run or command response returns `modelId`, update `agentModelId` and pass it into `useChatStream`.
       - Reset `agentModelId` when the selected agent changes or when “New conversation” is clicked.
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
     - WS-unavailable fallback (must keep existing functionality):
       - When WS is unavailable (either `realtimeEnabled === false` **or** the WS `connectionState` is not `open`), keep using the existing segment-based rendering for Send (`result.segments` → assistant bubble) because WS transcript events will not arrive.
       - Commands are already disabled in this mode; ensure that remains true.
     - Realtime-enabled behavior (must avoid duplicate assistant bubbles):
       - When realtime is enabled **and** the WS connection is `open`, do **not** append an assistant message from `result.segments`.
       - Treat the REST response as a completion signal only; the transcript should come entirely from WS events.
   - Concrete implementation guidance (high level):
     - Replace bespoke `messages/liveInflight` state with `useChatStream(...).messages`.
     - Replace bespoke WS `onEvent` reducer with `handleWsEvent(event)` and `hydrateInflightSnapshot(...)`.
     - Keep the existing REST call functions (`runAgentInstruction`, `runAgentCommand`) but change the post-response behavior:
       - realtime enabled: do not append assistant bubble from `segments`
       - realtime disabled: continue to append assistant bubble from `segments`

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add client log entries (forwarded to `/logs`) to confirm the Agents page is using the Chat WS pipeline.
       - Files to read:
         - `client/src/logging/logger.ts`
       - Files to edit:
         - `client/src/pages/AgentsPage.tsx`
       - Requirements:
       - Use `createLogger('client')` (as used elsewhere in the repo) and emit these **exact** messages during a realtime-enabled run:
         - `DEV-0000021[T4] agents.ws subscribe_conversation` (when subscribing to WS for the conversation id)
          - `DEV-0000021[T4] agents.ws event user_turn` (when receiving `user_turn`)
          - `DEV-0000021[T4] agents.ws event inflight_snapshot` (when receiving `inflight_snapshot`)
          - `DEV-0000021[T4] agents.ws event turn_final` (when receiving `turn_final`)
        - Each log must include `conversationId` in `context`, and the transcript events must also include `inflightId` (where present).
        - Include `modelId` in the log context (use the same model id passed into `useChatStream`).

3. [x] Update client tests: realtime-enabled mode relies on WS events (and ignores REST `segments`):
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.run.test.tsx`
   - Description:
     - Reworks the existing Agents “run” test to model the realtime-enabled contract: REST is a completion signal, WS events are the transcript.
   - Purpose:
     - Prevent duplicate transcript bubbles by ensuring REST `segments` are ignored when WS is enabled.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to edit:
     - `client/src/test/agentsPage.run.test.tsx`
   - Files to read:
     - `client/src/test/agentsPage.streaming.test.tsx`
     - `client/src/test/chatPage.stream.test.tsx`
   - Requirements:
     - Change the test to explicitly model the new contract:
       - `mongoConnected: true`
       - sending calls the Agents REST endpoint but transcript comes from WS.
     - Emit `user_turn`/`assistant_delta`/`turn_final` and assert the transcript renders.
       - Explicitly assert the user bubble renders from `user_turn` (if `user_turn` is ignored, the test must fail).
     - Assert the outgoing `POST /agents/:agentName/run` request body includes a non-empty `conversationId`.
     - Ensure the test would fail if the page incorrectly appended `result.segments` in realtime mode:
       - include a distinctive `segments: [{ type: 'answer', text: 'SEGMENT_SHOULD_NOT_RENDER' }]` in the REST response.
       - assert `SEGMENT_SHOULD_NOT_RENDER` is **not** visible after the run completes.

4. [x] Client RTL test (Jest + Testing Library): ignore WS transcript events for other conversations:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Description:
     - When the active conversation is `c1`, WS transcript events for `c2` must not affect the transcript UI.
   - Purpose:
     - Prevent cross-contamination when the server emits multiple conversation streams.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Select conversation `c1`.
     - Emit an `assistant_delta` event for conversation `c2`.
     - Assert the `c2` delta text never appears.

5. [x] Client RTL test (Jest + Testing Library): late `turn_final` for an older inflight must not overwrite a newer run:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Description:
     - If run A starts, then run B starts, a late `turn_final` for run A must not override the status/content shown for run B.
   - Purpose:
     - Prevent incorrect status chips (Complete/Failed/Stopped) due to late/out-of-order frames.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Start run A (emit `inflight_snapshot` with `inflightId: 'i1'` for conversation `c1`).
     - Start run B (emit `inflight_snapshot` with `inflightId: 'i2'` for conversation `c1`).
     - Emit a late `turn_final` for `inflightId: 'i1'`.
     - Assert the UI still reflects run B’s inflight id/status.

6. [x] Client RTL test (Jest + Testing Library): WS-unavailable mode still renders REST segments (fallback path):
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx`
   - Description:
     - When WS is unavailable (realtime disabled or connection not open), Agents should still render the REST response `segments` for single-instruction runs.
   - Purpose:
     - Preserve the non-realtime fallback UX after switching Agents to the Chat WS pipeline.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx`
   - Files to read:
     - `client/src/test/agentsPage.run.test.tsx`
   - Requirements:
     - Force WS to be unavailable:
       - Either mock `GET /health` → `{ mongoConnected: false }` (disables realtime), **or**
       - Configure the WS mock to never reach `connectionState: 'open'` (if the harness supports this).
     - Mock `POST /agents/:agentName/run` to return a response containing a distinctive segment answer like `SEGMENT_FALLBACK_OK`.
     - Assert the segment content renders in the transcript even though no WS events are emitted.

7. [x] Client RTL test (Jest + Testing Library): multiple inflight snapshots in a single command run create separate assistant bubbles:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Description:
     - Simulate a multi-step command run where the server emits more than one inflight snapshot (`inflightId: i1` then `inflightId: i2`).
   - Purpose:
     - Ensures the transcript does not clobber earlier steps and that `useChatStream` correctly resets for each inflight.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Requirements:
     - Start with a selected conversation.
     - Emit `inflight_snapshot` for `i1`, then `assistant_delta`, then `turn_final`.
     - Emit a second `inflight_snapshot` for `i2` and a second `assistant_delta`.
     - Assert the transcript shows **two** assistant bubbles (one per inflight).

8. [x] Client RTL test (Jest + Testing Library): command Execute includes a client-generated `conversationId` when none is selected (realtime-enabled mode):
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Description:
     - When `mongoConnected: true` and there is no active/selected conversation, clicking Execute must still send `conversationId` in the request body.
   - Purpose:
     - Ensures command runs can subscribe to WS early and receive `user_turn`/deltas even though the REST endpoint responds only after completion.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Files to read:
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Requirements:
     - Use a realtime-enabled setup (`GET /health` → `{ mongoConnected: true }`).
     - Do not pre-populate any conversation selection before clicking Execute.
     - Capture the JSON request body sent to `POST /agents/:agentName/commands/run`.
     - Assert it includes:
       - `commandName: <selected command>`
       - `conversationId: <non-empty string>`

9. [x] Update `projectStructure.md` with files added/removed in this task:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add:
       - `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx`
     - Remove:
       - (none)

10. [x] Update `design.md` to document the Agents client transcript pipeline (Chat WS reuse):
   - Documentation to read:
     - Mermaid diagrams (flowchart syntax): Context7 `/mermaid-js/mermaid/v11_0_0`
     - Mermaid flowchart syntax (official): https://mermaid.js.org/syntax/flowchart.html
     - Mermaid diagrams (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Flowchart Diagrams
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid `flowchart` describing the client decision path:
       - if `mongoConnected === false`: render REST `segments` (single instruction only)
       - else: use WS transcript events only and ignore REST `segments`.
     - Include the key hooks/components by name:
       - `useChatWs` (transport)
       - `useChatStream` (state/merge)
       - `useConversationTurns` (history hydration)

11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Start an Agents run and confirm the transcript renders using the Chat WS pipeline (user turn appears, then streaming assistant output, then final).
   - Refresh the page mid-run (or open another tab) and confirm the transcript is recoverable via WS snapshot/hydration (no duplicated/missing bubbles).
   - With WS unavailable (realtime disabled or WS disconnected), confirm sending still works via REST segments and archive controls remain disabled.
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T4] agents.ws subscribe_conversation`
     - `DEV-0000021[T4] agents.ws event user_turn`
     - `DEV-0000021[T4] agents.ws event inflight_snapshot`
     - `DEV-0000021[T4] agents.ws event turn_final`
   - Confirm the log entries include the same `conversationId`/`inflightId` you just exercised (where applicable).
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed the Chat WS pipeline (`useChatWs` + `useChatStream.handleWsEvent`) and the history hydration flow (`useConversationTurns` → `useChatStream.hydrateHistory` / `hydrateInflightSnapshot`) to mirror the same contract in Agents.
- `client/src/pages/AgentsPage.tsx` now uses `useChatStream` for transcript state and WS event merging, generates a client-side `conversationId` before runs, and avoids rendering REST `segments` when WS is open (realtime mode).
- Updated `client/src/test/agentsPage.run.test.tsx` to model realtime mode: it asserts the client sends a non-empty `conversationId`, renders user/assistant bubbles from WS frames, and does not render REST `segments`.
- Extended `client/src/test/agentsPage.streaming.test.tsx` to assert cross-conversation WS transcript frames are ignored by Agents.
- Added WS ordering coverage in `client/src/test/agentsPage.streaming.test.tsx` so a late `turn_final` for an older inflight does not clobber a newer in-progress inflight.
- Added `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx` to prove WS-unavailable (mongoConnected=false) mode still renders REST `segments` for single instruction runs.
- Expanded `client/src/test/agentsPage.streaming.test.tsx` to cover multi-inflight runs emitting multiple `inflight_snapshot` events and asserting the transcript shows separate assistant bubbles.
- Updated `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx` to assert command Execute includes a non-empty client-generated `conversationId` when no conversation is selected.
- Updated `projectStructure.md` to include `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx` and refreshed the description for `client/src/test/agentsPage.run.test.tsx`.
- Updated `design.md` with an Agents transcript pipeline flowchart covering WS vs REST segments behavior and calling out `useChatWs`, `useChatStream`, and `useConversationTurns`.
- Ran `npm run lint --workspaces` (clean) and `npm run format:check --workspaces` (fixed via `npm run format --workspace client`).
- Testing: `npm run test --workspace client`.
- Testing: `npm run e2e`.
- Testing: `npm run compose:build`.
- Testing: `npm run compose:up`.
- Testing: `npm run compose:down`.
- Manual check: used `http://host.docker.internal:5001/agents` and verified the Logs page shows the required Task 4 WS pipeline log lines; verified `inflight_snapshot` by subscribing from a second tab during an in-flight run.
- Fix: hardened `client/src/logging/transport.ts` to flush any queued logs that were added while a previous `/logs` POST was in flight.

---

### 5. Client: align Agents transcript UI with Chat transcript UI

- Task Status: **__done__**
- Git Commits: 4fa7e20, 4851457

#### Overview

Make Agents transcript rendering match Chat: same status chip behavior, same tool Parameters/Result accordions, same default-closed citations accordion, and the same “Thought process” accordion. Remove the Agents-only command metadata note while keeping `turn.command` persistence unchanged.

#### Documentation Locations

- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html

- MUI MCP docs (accordions used by the chat transcript UI):
  - https://llms.mui.com/material-ui/6.4.12/components/accordion.md
- MUI MCP docs (status chip used by the chat transcript UI):
  - https://llms.mui.com/material-ui/6.4.12/api/chip.md
- Jest (test runner + mocking): Context7 `/jestjs/jest`
- Testing Library (React): https://testing-library.com/docs/react-testing-library/intro/
- Testing Library queries: https://testing-library.com/docs/queries/about/
- Testing Library user events: https://testing-library.com/docs/user-event/intro/
- Markdown guide (basic syntax, for updating docs/tree): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Read the Chat transcript UI patterns to copy into Agents:
   - Documentation to read:
     - MUI Accordion docs: https://llms.mui.com/material-ui/6.4.12/components/accordion.md
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - What to identify:
     - The exact JSX blocks that render:
       - tool accordions (Parameters/Result + status)
       - citations accordion (`data-testid="citations-accordion"`)
       - thought process accordion

2. [x] Update Agents transcript rendering to use the same tool + citations UI as Chat:
   - Documentation to read:
     - MUI Accordion docs: https://llms.mui.com/material-ui/6.4.12/components/accordion.md
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Do not change ChatPage transcript UI in this story. Instead, copy the Chat transcript UI patterns into AgentsPage and keep test ids consistent with Chat where applicable (e.g., `data-testid="citations-accordion"`, `data-testid="citations-toggle"`, `data-testid="citations"`).
     - Tool blocks must render with the same Parameters + Result accordions and the same status chip semantics.
     - Citations must render inside the same default-closed citations accordion used by Chat.
     - The “Thought process” (think/reasoning) accordion must behave the same way as Chat.

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add client log entries (forwarded to `/logs`) to confirm tool/citation events are being received and processed for Agents.
       - Files to read:
         - `client/src/logging/logger.ts`
       - Files to edit:
         - `client/src/pages/AgentsPage.tsx`
       - Requirements:
         - Use `createLogger('client')` and emit these **exact** messages:
           - `DEV-0000021[T5] agents.ws event tool_event` (when receiving a WS `tool_event`)
           - `DEV-0000021[T5] agents.transcript citations ready` (when the transcript state contains at least 1 citation for the current conversation)
         - Include `conversationId` and `inflightId` in `context` where available; for tool events include `toolName`/`stage` if present.

   - De-risk guidance:
     - Prefer copying the existing ChatPage JSX in small blocks and wiring it to the `ChatMessage` shape produced by `useChatStream`.
     - Avoid creating new shared components in this story unless necessary to keep changes small.

3. [x] Remove the Agents-only command metadata transcript note:
   - Documentation to read:
     - None (repo-local change).
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Files to edit or delete:
     - `client/src/test/agentsPage.commandMetadataRender.test.tsx`
   - Requirements:
     - Remove the “Command run: … (step/total)” note from the transcript UI.
     - Keep persistence/storage of `turn.command` unchanged (other consumers may rely on it).

4. [x] Client test: citations accordion renders under assistant bubbles (Agents parity with Chat):
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.citations.test.tsx`
   - Description:
     - Asserts the citations accordion is present, collapsed by default, and renders citation rows after WS tool-result events.
   - Purpose:
     - Ensures Agents transcript UI matches Chat for citations (critical to “tools parity”).
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to add:
     - `client/src/test/agentsPage.citations.test.tsx`
   - Files to read:
     - `client/src/test/chatPage.citations.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
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

5. [x] Client test: thought process (analysis_delta / assistantThink) accordion behavior matches Chat:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.reasoning.test.tsx`
   - Description:
     - Confirms the reasoning accordion is collapsed by default and toggles open to show analysis content.
   - Purpose:
     - Ensures Agents reasoning UX matches Chat and avoids accidental always-open “thinking” disclosure.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.reasoning.test.tsx`
   - Files to read:
     - `client/src/test/chatPage.reasoning.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Copy the approach from `client/src/test/chatPage.reasoning.test.tsx`, but mount `AgentsPage`.
     - Emit an inflight snapshot with `assistantThink` and/or emit `analysis_delta` events.
     - Assert `think-toggle` exists, is closed by default, and reveals `think-content` when clicked.

6. [x] Client test: tool Parameters/Result accordions render for tool events:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.toolsUi.test.tsx`
   - Description:
     - Emits a tool event and checks the Parameters/Result accordions exist and are collapsed by default.
   - Purpose:
     - Ensures Agents tool block UI matches Chat, including default collapsed state.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.toolsUi.test.tsx`
   - Files to read:
     - `client/src/test/chatPage.toolDetails.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Emit a `tool_event` with a `tool-result` including `parameters` and `result`.
     - Assert `data-testid="tool-params-accordion"` and `data-testid="tool-result-accordion"` render and are collapsed by default.

7. [x] Client test: status chip shows Failed when `turn_final.status === 'failed'`:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.statusChip.test.tsx`
   - Description:
     - Emits a `turn_final` event with `status: 'failed'` and verifies the status chip renders as Failed.
   - Purpose:
     - Prevents regressions where failed runs appear as Complete/Processing and confuse users.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.statusChip.test.tsx`
   - Files to read:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Emit an inflight snapshot + assistant delta, then emit `turn_final` with `status: 'failed'`.
     - Assert the visible status chip contains `Failed` (and does not contain `Complete`).

8. [x] Update `projectStructure.md` with files added/removed in this task:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add:
       - `client/src/test/agentsPage.citations.test.tsx`
       - `client/src/test/agentsPage.reasoning.test.tsx`
       - `client/src/test/agentsPage.toolsUi.test.tsx`
       - `client/src/test/agentsPage.statusChip.test.tsx`
     - Remove (if deleted by this task):
       - `client/src/test/agentsPage.commandMetadataRender.test.tsx`

9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Run an Agent instruction that triggers tool calls and confirm tools render with the same Parameters/Result accordions as Chat.
   - Confirm citations render in the same default-closed citations accordion under assistant bubbles (and are stable across refresh).
   - Confirm assistant status chips match Chat behavior (Processing → Complete, or Failed/Stopped when applicable).
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T5] agents.ws event tool_event`
     - `DEV-0000021[T5] agents.transcript citations ready`
   - Confirm the log entries include the same `conversationId`/`inflightId` you just exercised (where applicable).
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed `client/src/pages/ChatPage.tsx` transcript rendering blocks for tool details toggling, the default-collapsed citations accordion (`citations-accordion`/`citations-toggle`/`citations`), and the “Thought process” Collapse+toggle pattern.
- `client/src/pages/AgentsPage.tsx` now renders tool rows using the Chat-style “Show details” toggle + Collapse, adds the citations accordion under assistant bubbles (Chat test ids), and aligns the thought process section to the Chat Collapse pattern (including `think-spinner`).
- Added Agents client log lines required for manual verification: logs `DEV-0000021[T5] agents.ws event tool_event` when receiving WS tool events and `DEV-0000021[T5] agents.transcript citations ready` when citations first appear for the active conversation.
- Removed the obsolete `client/src/test/agentsPage.commandMetadataRender.test.tsx` coverage after confirming the command-metadata bubble note is no longer rendered (while preserving `turn.command` hydration in transcript state).
- Added new RTL parity tests for Agents transcript UI: citations accordion (`client/src/test/agentsPage.citations.test.tsx`), reasoning toggle (`client/src/test/agentsPage.reasoning.test.tsx`), tool params/result accordions (`client/src/test/agentsPage.toolsUi.test.tsx`), and failed status chip (`client/src/test/agentsPage.statusChip.test.tsx`).
- Updated `projectStructure.md` to include the new Agents transcript tests and to remove the deleted `client/src/test/agentsPage.commandMetadataRender.test.tsx` entry.
- Ran `npm run lint --workspaces` (warnings only) and `npm run format:check --workspaces` (fixed via `npm run format --workspace client`, then clean).
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server`.
- Testing: `npm run test --workspace client`.
- Testing: `npm run e2e`.
- Testing: `npm run compose:build`.
- Testing: `npm run compose:up`.
- Manual check: exercised Agents transcript UI against `http://host.docker.internal:5001/agents` and confirmed tool rows + Parameters/Result accordions render, citations accordion renders (default closed), and `/logs` contains `DEV-0000021[T5] agents.ws event tool_event` + `DEV-0000021[T5] agents.transcript citations ready`.
- Extended `client/src/hooks/useChatStream.ts` citation extraction to support tool payloads that provide `segments` with `vector_summary.files` (e.g., `codebase_question` tool results), enabling citations parity for Agents runs even when `VectorSearch` isn’t available.
- Testing: `npm run compose:down`.

---

### 6. Client: Agents Stop uses WS `cancel_inflight` + abort request (Chat parity)

- Task Status: **__done__**
- Git Commits: 7472ebd

#### Overview

Update the Agents Stop behavior to match Chat: always abort the in-flight HTTP request, and when possible also send `cancel_inflight` over WebSocket using the active conversation + inflight id.

#### Documentation Locations

- React hooks (refs + effects for request lifecycle): https://react.dev/reference/react/useRef and https://react.dev/reference/react/useEffect
- WebSocket (client message contract): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- AbortController (fetch abort semantics): https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Jest (test runner + mocking): Context7 `/jestjs/jest`
- Testing Library (React): https://testing-library.com/docs/react-testing-library/intro/
- Testing Library user events: https://testing-library.com/docs/user-event/intro/
- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official):
  - https://mermaid.js.org/syntax/sequenceDiagram.html
  - https://mermaid.js.org/syntax/flowchart.html
- Mermaid docs (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Flowchart Diagrams / Sequence Diagrams

#### Subtasks

1. [x] Read ChatPage Stop behavior and how it gets the inflight id:
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

2. [x] Update AgentsPage Stop to send WS `cancel_inflight` in addition to aborting fetch:
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

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add client log entries (forwarded to `/logs`) to confirm Stop triggers both HTTP abort and WS cancel when possible.
       - Files to read:
         - `client/src/logging/logger.ts`
       - Files to edit:
         - `client/src/pages/AgentsPage.tsx`
       - Requirements:
         - Use `createLogger('client')` and emit these **exact** messages on Stop:
           - `DEV-0000021[T6] agents.stop clicked`
           - `DEV-0000021[T6] agents.http abort signaled`
           - `DEV-0000021[T6] agents.ws cancel_inflight sent` (only when both ids are available)
         - Include `conversationId` in `context`; include `inflightId` when known.

3. [x] Client test: Stop sends a `cancel_inflight` WS message:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Description:
     - Runs a command, then clicks Stop after the inflight id exists, and asserts the WS mock received `cancel_inflight`.
   - Purpose:
     - Ensures Agents stop behavior matches Chat stop behavior (abort + WS cancel).
   - Documentation to read:
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Requirements:
     - Assert the WS mock recorded a message `{ type: 'cancel_inflight', conversationId, inflightId }`.

4. [x] Client test: Stop clicked before inflight id is known does not send `cancel_inflight` (but still aborts HTTP):
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Description:
     - Clicks Stop immediately after starting a command (before any WS snapshot/user_turn supplies an inflight id).
   - Purpose:
     - Ensures the early-stop edge case remains safe: we must always abort HTTP, and we must not send malformed cancel messages.
   - Documentation to read:
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Requirements:
     - Trigger a command execute request and immediately click Stop *before* emitting any WS `inflight_snapshot`/`user_turn` that would populate an inflight id.
     - Assert the request abort signal becomes aborted.
     - Assert the WS mock recorded **no** `{ type: 'cancel_inflight', ... }` messages.

5. [x] Update `design.md` with the Stop/cancel flow (Agents parity with Chat):
   - Documentation to read:
     - Mermaid diagrams (sequence diagrams): Context7 `/mermaid-js/mermaid/v11_0_0`
     - Mermaid sequence diagram syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html
     - Mermaid diagrams (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Sequence Diagrams
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid `sequenceDiagram` showing:
       - user clicks Stop
       - client aborts fetch via `AbortController`
       - if `conversationId` + `inflightId` exist, client sends WS `cancel_inflight`
       - server aborts inflight and emits `turn_final: stopped`.

6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Start an Agents run and click Stop immediately; confirm the HTTP request aborts and the WS `cancel_inflight` also fires (no long tail streaming).
   - Confirm Stop is still enabled/functional even when Mongo is disconnected (WS cancel should not be gated on persistence).
   - Confirm the UI returns to an idle state after stopping and the user can Send again.
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T6] agents.stop clicked`
     - `DEV-0000021[T6] agents.http abort signaled`
     - `DEV-0000021[T6] agents.ws cancel_inflight sent`
   - Confirm the log entries include the same `conversationId`/`inflightId` you just exercised (where applicable).
9. [x] `npm run compose:down`

#### Implementation notes

- 2026-01-04: Reviewed Chat stop flow (`ChatPage.tsx` + `useChatWs.cancelInflight` + `useChatStream.getInflightId`). Chat sends `cancel_inflight` only when both `conversationId` and `inflightId` exist, then updates UI via `stop({ showStatusBubble: true })`.
- 2026-01-04: Updated Agents Stop click handler to always abort the in-flight HTTP request first, then (when both ids are available) send WS `cancel_inflight` and emit the required log lines (`DEV-0000021[T6] ...`).
- 2026-01-04: Added Jest coverage for Stop sending `cancel_inflight` when an inflight id exists, and for the early-stop case where only the HTTP abort fires.
- 2026-01-04: Added a Mermaid sequence diagram in `design.md` documenting the Agents Stop flow (HTTP abort first, optional WS `cancel_inflight`, and server `turn_final: stopped`).
- 2026-01-04: Ran `npm run lint --workspaces` (clean; server has existing import/order warnings) and `npm run format:check --workspaces` (fixed via `npm run format --workspace client`).
- 2026-01-04: Verified server builds outside Docker (`npm run build --workspace server`).
- 2026-01-04: Verified client builds outside Docker (`npm run build --workspace client`).
- 2026-01-04: Ran server test suite (`npm run test --workspace server`).
- 2026-01-04: Ran client test suite (`npm run test --workspace client`).
- 2026-01-04: Ran end-to-end Playwright suite (`npm run e2e`).
- 2026-01-04: Verified Docker Compose images build (`npm run compose:build`).
- 2026-01-04: Verified Docker Compose stack starts (`npm run compose:up`).
- 2026-01-04: Manual check (headless Playwright): ran an Agents instruction, clicked Stop after `Processing` appeared, and confirmed `/logs` contains the required `DEV-0000021[T6]` entries with matching `conversationId`/`inflightId`. Also repeated with Mongo stopped (`mongoConnected=false`) to confirm Stop still aborts and returns UI to idle.
- 2026-01-04: Shut down the Docker Compose stack after verification (`npm run compose:down`).

---

### 7. Client: Agents sidebar updates via WS (`subscribe_sidebar`)

- Task Status: **__done__**
- Git Commits: 7992b39

#### Overview

Bring Agents sidebar behavior to parity with Chat by subscribing to the sidebar WS feed and applying `conversation_upsert` / `conversation_delete` events to the Agents conversation list, filtered to the currently selected agent.

#### Documentation Locations

- React hooks (useEffect patterns for subscriptions): https://react.dev/reference/react/useEffect
- WebSocket (event-driven UI): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Jest (test runner + mocking): Context7 `/jestjs/jest`
- Testing Library (React): https://testing-library.com/docs/react-testing-library/intro/
- Testing Library queries: https://testing-library.com/docs/queries/about/
- Markdown guide (basic syntax, for updating docs/tree): https://www.markdownguide.org/basic-syntax/
- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official):
  - https://mermaid.js.org/syntax/sequenceDiagram.html
  - https://mermaid.js.org/syntax/flowchart.html
- Mermaid docs (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Flowchart Diagrams / Sequence Diagrams

#### Subtasks

1. [x] Read how ChatPage wires sidebar WS updates and filters out agent conversations:
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

2. [x] Update AgentsPage to subscribe to sidebar events and apply them to the agent-scoped conversation list:
   - Documentation to read:
     - React `useEffect`: https://react.dev/reference/react/useEffect
     - Jest (for WS message assertions in later subtasks): Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Call `subscribeSidebar()` on mount (when persistence is available), and `unsubscribeSidebar()` on unmount.
     - On WS `conversation_upsert`, apply the event only when `event.conversation.agentName === selectedAgentName`.
     - On WS `conversation_delete`, remove the conversation by id.
     - Use `useConversations(...).applyWsUpsert` / `applyWsDelete` rather than rebuilding list logic.

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add client log entries (forwarded to `/logs`) to confirm sidebar WS subscription and updates are happening.
       - Files to read:
         - `client/src/logging/logger.ts`
       - Files to edit:
         - `client/src/pages/AgentsPage.tsx`
       - Requirements:
         - Use `createLogger('client')` and emit these **exact** messages:
           - `DEV-0000021[T7] agents.ws subscribe_sidebar` (when subscribing)
           - `DEV-0000021[T7] agents.sidebar conversation_upsert` (when applying an upsert for the active agent)
           - `DEV-0000021[T7] agents.sidebar conversation_delete` (when applying a delete)
         - Include `selectedAgentName` and `conversationId` (where applicable) in `context`.

3. [x] Client test: Agents sidebar reflects WS `conversation_upsert` events for the active agent:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.sidebarWs.test.tsx`
   - Description:
     - Emits `conversation_upsert` events and asserts the sidebar updates (including filtering by agentName and sorting).
   - Purpose:
     - Ensures Agents sidebar stays in sync with server-side conversation updates (Chat parity).
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to add:
     - `client/src/test/agentsPage.sidebarWs.test.tsx`
   - Files to read:
     - `client/src/test/chatSidebar.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Mock an Agents page session.
     - Emit a `conversation_upsert` WS event with `agentName: 'a1'` and confirm it appears in the sidebar.
     - Emit a second `conversation_upsert` for a different `agentName` and confirm it is ignored.
     - Emit an upsert with a newer `lastMessageAt` and confirm it reorders to the top.

4. [x] Client test: Agents sidebar removes items on WS `conversation_delete`:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.sidebarWs.test.tsx`
   - Description:
     - Emits `conversation_delete` and asserts the deleted conversation disappears from the sidebar.
   - Purpose:
     - Prevents stale/phantom conversations after deletions.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.sidebarWs.test.tsx`
   - Files to read:
     - `client/src/test/chatSidebar.test.tsx`
   - Requirements:
     - Emit a `conversation_upsert` for an agent conversation and assert it renders.
     - Emit a `conversation_delete` for that `conversationId` and assert it is removed from the sidebar.

5. [x] Update `design.md` with the sidebar WS subscription flow (Chat parity):
   - Documentation to read:
     - Mermaid diagrams (sequence diagrams): Context7 `/mermaid-js/mermaid/v11_0_0`
     - Mermaid sequence diagram syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html
     - Mermaid diagrams (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Sequence Diagrams
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid `sequenceDiagram` that shows:
       - client WS `subscribe_sidebar`
       - server emits `conversation_upsert` and `conversation_delete`
       - client filters by `agentName` before applying to Agents sidebar.

6. [x] Update `projectStructure.md` with any new test files added:
   - Documentation to read:
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add:
       - `client/src/test/agentsPage.sidebarWs.test.tsx`
     - Remove:
       - (none)

7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Open two browser contexts for the same agent; create/run a conversation in context A.
   - Confirm the Agents sidebar in context B updates via WS (`conversation_upsert`/`conversation_delete`) without refresh and remains filtered to the selected agent.
   - Confirm deleting/archiving (where supported) updates the sidebar live and does not break selection.
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T7] agents.ws subscribe_sidebar`
     - `DEV-0000021[T7] agents.sidebar conversation_upsert`
     - `DEV-0000021[T7] agents.sidebar conversation_delete`
   - Confirm the log entries include the same `conversationId`/`inflightId` you just exercised (where applicable).
9. [x] `npm run compose:down`

#### Implementation notes

- 2026-01-04: Read Chat sidebar WS wiring: `useChatWs.subscribeSidebar()` on mount (when persistence enabled), `unsubscribeSidebar()` on unmount; `conversation_upsert` applies via `useConversations.applyWsUpsert` while ignoring agent-scoped conversations; `conversation_delete` applies via `applyWsDelete`.
- 2026-01-04: Updated `AgentsPage` to subscribe/unsubscribe sidebar WS feed when persistence is available, apply `conversation_upsert` only when `agentName === selectedAgentName`, apply `conversation_delete` by id, and emit required client log lines (`DEV-0000021[T7] ...`).
- 2026-01-04: Added Jest coverage for Agents sidebar WS events (`conversation_upsert` filtering + ordering, `conversation_delete` removal) in `client/src/test/agentsPage.sidebarWs.test.tsx`.
- 2026-01-04: Updated `design.md` with an Agents sidebar WS subscription sequence diagram showing `subscribe_sidebar` and `conversation_upsert`/`conversation_delete` handling with agent-name filtering.
- 2026-01-04: Updated `projectStructure.md` to include the new client test file `client/src/test/agentsPage.sidebarWs.test.tsx`.
- 2026-01-04: Ran `npm run lint --workspaces` (clean; server has existing import/order warnings) and `npm run format:check --workspaces` (fixed via `npm run format --workspace client`).
- 2026-01-04: Testing: `npm run build --workspace server`.
- 2026-01-04: Testing: `npm run build --workspace client`.
- 2026-01-04: Testing: `npm run test --workspace server`.
- 2026-01-04: Testing: `npm run test --workspace client`.
- 2026-01-04: Testing: `npm run e2e`.
- 2026-01-04: Testing: `npm run compose:build`.
- 2026-01-04: Testing: `npm run compose:up`.
- 2026-01-04: Manual check (Playwright, using `http://host.docker.internal:5001` + `http://host.docker.internal:5010`): verified Agents sidebar receives `conversation_upsert` + `conversation_delete` over `subscribe_sidebar` (agent-filtered), and `/logs` contains the required `DEV-0000021[T7]` client log lines including the exercised `conversationId`.
- 2026-01-04: Testing: `npm run compose:down`.

---

### 8. Client: rebuild Agents page layout to match Chat (Drawer + controls + transcript)

- Task Status: **__done__**
- Git Commits: af10adb

#### Overview

Rebuild the Agents page to match the Chat page layout exactly: left Drawer conversation sidebar (temporary on mobile, persistent on desktop, width 320), a controls area above the transcript, and the transcript in a scrolling panel. Only the control inputs should differ (agent + command + working_folder vs provider/model).

#### Documentation Locations

- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html
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
- Jest (test runner + mocking): Context7 `/jestjs/jest`
- Testing Library (React): https://testing-library.com/docs/react-testing-library/intro/
- Testing Library queries: https://testing-library.com/docs/queries/about/
- Testing Library user events: https://testing-library.com/docs/user-event/intro/

#### Subtasks

0. [x] Update `design.md` if any UI flow diagrams reference Agents layout:
   - Documentation to read:
     - Mermaid: Context7 `/mermaid-js/mermaid/v11_0_0`
     - Mermaid syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html
   - Files to edit:
     - `design.md`
   - Requirements:
     - Ensure any UI flow diagrams show the Drawer + transcript layout parity between Chat and Agents.

1. [x] Read the current ChatPage layout and the current AgentsPage layout:
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

2. [x] Rebuild the AgentsPage outer layout to mirror Chat:
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

   - Log lines to add (required for Manual Playwright-MCP check):
     - Add client log entries (forwarded to `/logs`) to confirm layout parity behaviors (Drawer variant and toggling).
       - Files to read:
         - `client/src/logging/logger.ts`
       - Files to edit:
         - `client/src/pages/AgentsPage.tsx`
       - Requirements:
         - Use `createLogger('client')` and emit these **exact** messages:
           - `DEV-0000021[T8] agents.layout drawer variant` (when computing the Drawer `variant`, include `isMobile` and `variant` in context)
           - `DEV-0000021[T8] agents.layout drawer toggle` (when the user opens/closes the Drawer on mobile, include `open` boolean in context)

3. [x] Client RTL test update (Jest + Testing Library): commands list still renders and is selectable after layout change:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsList.test.tsx`
   - Description:
     - Update selectors/queries in the existing commands list test to match the new Drawer-based layout.
   - Purpose:
     - Ensure agent command selection remains functional after moving controls into the new Chat-parity layout.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.commandsList.test.tsx`
   - Requirements:
     - Update DOM queries to find the command select + options and confirm selection still updates the description.

4. [x] Client RTL test update (Jest + Testing Library): command run refresh-turns flow still works after layout change:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Description:
     - Update selectors/queries in the existing refresh-turns test to match the new Drawer-based layout.
   - Purpose:
     - Ensure the post-command “refresh turns” behavior still happens after the layout refactor.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Requirements:
     - Keep behavioral assertions unchanged; update only selectors/element locations.

5. [x] Client RTL test update (Jest + Testing Library): RUN_IN_PROGRESS conflict still shows the friendly message after layout change:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
   - Description:
     - Ensure the conflict alert remains visible and uses the same text after controls move.
   - Purpose:
     - Prevent regressions in the multi-tab conflict UX.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
   - Requirements:
     - Update selectors for the execute/send buttons if their DOM placement changed.

6. [x] Client RTL test update (Jest + Testing Library): persistence disabled mode still disables Execute after layout change:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx`
   - Description:
     - Ensure the persistence-disabled banner/note and disabled state still render when `mongoConnected === false`.
   - Purpose:
     - Prevent commands from becoming clickable when history is unavailable.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx`
   - Requirements:
     - Update selectors only; keep test semantics unchanged.

7. [x] Client RTL test update (Jest + Testing Library): abort/Stop behavior test still finds Stop button after layout change:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Description:
     - The Stop button should still be clickable and abort the request; only selectors should change.
   - Purpose:
     - Prevent regressions in stopping multi-step command runs.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library user events: https://testing-library.com/docs/user-event/intro/
   - Files to edit:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Requirements:
     - Update selectors/queries to locate Stop in its new position (if moved).

8. [x] Client RTL test update (Jest + Testing Library): WS transcript test still finds transcript area after layout change:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Description:
     - Update selectors in the existing Agents WS streaming test to match the new transcript container.
   - Purpose:
     - Ensure WS transcript rendering stays functional after layout refactor.
   - Documentation to read:
     - Jest: Context7 `/jestjs/jest`
     - Testing Library queries: https://testing-library.com/docs/queries/about/
   - Files to edit:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Requirements:
     - Update the expected transcript container test id if it changes (prefer keeping Chat-parity ids).

9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Desktop: confirm left Drawer is persistent at width 320 and the transcript/controls match the Chat layout.
   - Mobile viewport: confirm Drawer switches to temporary, can be opened/closed, and content remains usable.
   - Confirm “New conversation”, “Send”, “Stop”, agent selection, and command execution are accessible and do not cause layout overflow.
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T8] agents.layout drawer variant`
     - `DEV-0000021[T8] agents.layout drawer toggle`
   - Confirm the log entries include the same `conversationId`/`inflightId` you just exercised (where applicable).
9. [x] `npm run compose:down`

#### Implementation notes

- 2026-01-04: Reviewed `ChatPage.tsx` and `AgentsPage.tsx` to identify the Chat drawer parity pattern (mobile temporary vs desktop persistent), expected width (320), and test ids (`conversation-drawer-toggle`).
- 2026-01-04: Rebuilt `client/src/pages/AgentsPage.tsx` outer layout to match Chat: responsive `Drawer` sidebar (320px) + `conversation-drawer-toggle` control + transcript panel separated from controls; added required client log markers for drawer variant + mobile toggle.
- 2026-01-04: Updated Agents RTL tests for layout parity; main change was aligning transcript selector from `agent-transcript` to Chat-parity `chat-transcript` in `client/src/test/agentsPage.streaming.test.tsx`.
- 2026-01-04: Verified formatting + linting for this task (`npm run lint --workspaces`, `npm run format:check --workspaces`); fixed a JSX wrapper mismatch and ran Prettier on `client/src/pages/AgentsPage.tsx`.
- 2026-01-04: Testing: `npm run build --workspace server` passed.
- 2026-01-04: Testing: `npm run build --workspace client` passed.
- 2026-01-04: Testing: `npm run test --workspace server` passed.
- 2026-01-04: Testing: `npm run test --workspace client` passed.
- 2026-01-04: Testing: `npm run e2e` passed.
- 2026-01-04: Testing: `npm run compose:build` passed.
- 2026-01-04: Testing: `npm run compose:up` passed.
- 2026-01-04: Manual UI verification against Compose (`http://host.docker.internal:5001/agents`) confirmed Drawer width 320 on desktop and temporary Drawer behavior on mobile; `/logs` shows `DEV-0000021[T8] agents.layout drawer variant` + `DEV-0000021[T8] agents.layout drawer toggle`. Evidence: `test-results/screenshots/0000021-08-agents-desktop.png`, `test-results/screenshots/0000021-08-agents-mobile.png`.
- 2026-01-04: Testing: `npm run compose:down` passed.

### 9. Final verification (acceptance criteria, clean builds, docs, and PR summary)

- Task Status: **__done__**
- Git Commits: cd7bd8e, 2068188, 4c2e3bf

#### Overview

De-risk the story by doing a full end-to-end verification pass once all other tasks are complete. This task must confirm the acceptance criteria explicitly, run clean builds, run tests, validate Docker startup, ensure docs are consistent, and produce a PR summary.

#### Documentation Locations

- Docker (images/build): Context7 `/docker/docs`
- Docker Compose (service lifecycle): Context7 `/docker/compose`
- Playwright: Context7 `/microsoft/playwright.dev`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid diagrams (spec + examples for design.md): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official):
  - https://mermaid.js.org/syntax/sequenceDiagram.html
  - https://mermaid.js.org/syntax/flowchart.html
- Mermaid docs (DeepWiki): `mermaid-js/mermaid` → Diagram Types → Flowchart Diagrams / Sequence Diagrams
- Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/

#### Subtasks

0. [x] Update `design.md` if any UI flow diagrams reference Agents layout:
   - Documentation to read:
     - Mermaid: Context7 `/mermaid-js/mermaid/v11_0_0`
     - Mermaid syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html
   - Files to edit:
     - `design.md`
   - Requirements:
     - Ensure any UI flow diagrams show the Drawer + transcript layout parity between Chat and Agents.

1. [x] Verify the story’s Acceptance Criteria line-by-line and note any gaps.
   - Documentation to read:
     - This story’s Acceptance Criteria section (at the top of this file).
2. [x] Update documentation: `README.md`
   - Document:
     - `README.md` (repo root)
   - Purpose:
     - Ensure setup/run instructions still match the final implementation after Agents/Chat unification.
   - Description:
     - Update any sections that reference Agents UI behavior, WS streaming, stop/cancel behavior, or prerequisites.

3. [x] Update documentation: `design.md`
   - Document:
     - `design.md` (repo root)
   - Purpose:
     - Ensure architecture + flows remain accurate after implementing the story.
   - Description:
     - Validate all Mermaid diagrams added/updated in earlier tasks are present, render, and reflect the final code.
     - Add any missing diagram(s) only if the implementation diverged.

4. [x] Update documentation: `projectStructure.md`
    - Document:
      - `projectStructure.md` (repo root)
    - Purpose:
      - Keep the file tree and test listings accurate after adding/removing files in this story.
    - Description:
      - Ensure every new/removed file referenced in Tasks 1–8 is reflected in the tree.

5. [x] Capture UI verification screenshots under `test-results/screenshots/` (see `planning/plan_format.md` naming convention).
6. [x] Write a pull request summary comment covering all tasks and major changes.

7. [x] Add a final client log marker so QA can confirm the unified Agents page is running:
   - Files to read:
     - `client/src/logging/logger.ts`
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Use `createLogger('client')` and emit **this exact** message once on Agents page mount:
       - `DEV-0000021[T9] agents.unification ready`
     - Include `selectedAgentName` (if available) and `activeConversationId` (if available) in `context`.

8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Verify every Acceptance Criteria item directly in the UI (Agents layout parity, transcript parity, sidebar live updates, stop/cancel behavior).
   - Regression pass: verify Chat page still behaves identically (sidebar, transcript rendering, tool/citation accordions, stop/cancel).
   - Capture any required screenshots in `test-results/screenshots/` per `planning/plan_format.md`.
   - Open `/logs` and search for these entries (copy/paste the message text):
     - `DEV-0000021[T9] agents.unification ready`
   - Confirm the entry appears when navigating to Agents (proves the unified AgentsPage build is running).
9. [x] `npm run compose:down`

#### Implementation notes

- (T9.1) Verified Acceptance Criteria against the current Agents/Chat implementation; no gaps found (layout parity via Drawer + transcript column, WS transcript handling via shared `useChatWs` + `useChatStream`, sidebar updates via WS upsert/delete filtered by `agentName`, stop/cancel parity).
- (T9.2) Updated `README.md` Client section to include an explicit Agents page description (layout parity + WS-driven transcript + agent-scoped history).
- (T9.3) Reviewed `design.md` for Agents/Chat unification coverage (WS transcript pipeline, REST routes, and Mermaid diagrams); no changes required for Task 9.
- (T9.4) Verified `projectStructure.md` already reflects the new Agents/WS files and server tests added in Tasks 1–8; no tree updates required for Task 9.
- (T9.7) Added final Agents-page mount log marker `DEV-0000021[T9] agents.unification ready` (once per page load) with `selectedAgentName` + `activeConversationId` context.
- (T9.8) Ran `npm run lint --workspaces` (warnings only in untouched files) and `npm run format:check --workspaces` (clean).
- (T9.test.1) `npm run build --workspace server` succeeded.
- (T9.test.2) `npm run build --workspace client` succeeded.
- (T9.test.3) `npm run test --workspace server` succeeded (node:test + Cucumber).
- (T9.test.4) `npm run test --workspace client` succeeded (Jest).
- (T9.test.5) `npm run e2e` succeeded (36 Playwright specs passed via `docker-compose.e2e.yml`).
- (T9.test.6) `npm run compose:build` succeeded (clean Compose image build).
- (T9.test.7) `npm run compose:up` succeeded (containers healthy).
- (T9.test.8) Manual UI verification completed and screenshots captured: `test-results/screenshots/0000021-9-agents.png`, `test-results/screenshots/0000021-9-chat.png`, `test-results/screenshots/0000021-9-logs.png`. Log marker verified via `GET /logs?text=DEV-0000021[T9] agents.unification ready` on the e2e server (browser-in-container requires `host.docker.internal` API URLs).
- (T9.test.9) `npm run compose:down` succeeded (also stopped the e2e stack after screenshots).
- (T9.6) PR summary comment drafted (copy/paste):

  ```
  ## Story 0000021 – Agents chat unification

  ### What changed
  - Rebuilt the Agents page to reuse the Chat page layout patterns (Drawer sidebar, shared transcript column layout) so the two surfaces look and behave consistently.
  - Switched Agents transcript streaming to the same WebSocket-driven transcript pipeline as Chat (shared WS event handling + inflight snapshots), removing bespoke inflight aggregation.
  - Unified the server-side agent run orchestration with the existing chat orchestration so Agents runs emit the same WS transcript event types (`user_turn`, deltas, tool events, `turn_final`) and participate in the same cancellation semantics.
  - Implemented Stop parity for Agents: client aborts the HTTP request and also sends `cancel_inflight` so the server publishes a `turn_final` of `stopped`.
  - Ensured Agents history behaves like Chat: sidebar updates live via `conversation_upsert` / `conversation_delete` events, scoped to the selected agent (`agentName=<agent>`).

  ### Key correctness/contract changes
  - Agents runs now accept a client-supplied `conversationId` even if it does not exist yet, enabling the UI to subscribe to WS first then start the synchronous REST run.
  - Route error mappings were made consistent between `/agents/:agentName/run` and `/agents/:agentName/commands/run` (stable HTTP/status payloads for archived, mismatch, codex unavailable, etc.).

  ### Tests / verification
  - Added/updated server unit + integration coverage around Agents WS streaming, cancellation, and router error mapping.
  - Updated client tests around Agents transcript status chip + parity expectations.
  - Ran full verification: server/client builds, server/client test suites, Playwright e2e suite, compose build/up/down, and manual UI smoke check with screenshots.
  
  ### Screenshots
  - `test-results/screenshots/0000021-9-agents.png`
  - `test-results/screenshots/0000021-9-chat.png`
  - `test-results/screenshots/0000021-9-logs.png`
  ```

---

### 10. Simplify snapshots: always full history + inflight (no pagination), client replace-only

- Task Status: **__done__**
- Git Commits: 2aa8a84

#### Overview

Eliminate partial snapshot behavior by making the turns snapshot API return the full persisted conversation history plus any in-flight data on every request. The client should always replace transcript state from that full snapshot and should not maintain separate “append/prepend” branching. This removes the current class of bugs where re-entering during a stream shows only the latest in-flight response.

#### Documentation Locations

- Express routes + pagination patterns (reference only): https://expressjs.com/en/guide/routing.html
- React hooks (useEffect/useMemo consistency): https://react.dev/reference/react
- Jest (test runner + mocking): Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/
- Testing Library (React): https://testing-library.com/docs/react-testing-library/intro/
- Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Confirm current turns snapshot logic and pagination usage (server path + tests):
   - Documentation to read (repeat even if already read):
     - Express routing: https://expressjs.com/en/guide/routing.html
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to read (open these exact files):
     - `server/src/routes/conversations.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/test/integration/conversations.turns.test.ts`
   - What to locate (use `rg` for these exact strings):
     - `includeInflight` (query parsing + response shape)
     - `nextCursor` (pagination response)
     - `listTurns(` (DB pagination)
   - Output required in Implementation notes:
     - Summarize the current response shape (items + optional inflight + nextCursor) and where the merge/dedupe happens.

2. [x] Server: remove pagination and ALWAYS return full DB history + inflight:
   - Documentation to read (repeat even if already read):
     - Express routing: https://expressjs.com/en/guide/routing.html
     - Markdown guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
   - Concrete implementation guidance (copy‑paste targets):
     - Replace the existing turns query schema usage so **limit/cursor are ignored**.
       - Today you’ll see something like:
         ```ts
         const { limit, cursor, includeInflight } = listTurnsQuerySchema.parse(req.query);
         ```
       - Target change: ignore `limit`, `cursor`, and `includeInflight`.
     - Replace `listTurns({ conversationId, limit, cursor })` with a “full history” query.
       - If there’s no helper, add a `listAllTurns(conversationId)` in `server/src/mongo/repo.ts`.
       - Ensure ordering matches the UI (newest-first) or explicitly sort after merge.
     - Always attach inflight:
       - Merge `snapshotInflightTurns(conversationId)` into `items` in all cases.
       - Always include top-level `inflight` when one exists (remove the `includeInflight` gate).
     - Response shape:
       - Remove `nextCursor` entirely or set it to `null` consistently.
   - Required acceptance check:
     - The response must include **full DB history + inflight** for every call (no partial page).

3. [x] Client: simplify to replace‑only full snapshot hydration:
   - Documentation to read (repeat even if already read):
     - React hooks: https://react.dev/reference/react
     - Testing Library (React): https://testing-library.com/docs/react-testing-library/intro/
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Concrete implementation guidance:
     - In `useConversationTurns.ts`, remove any `cursor`, `limit`, or `includeInflight` query params.
     - Remove “load older”/prepend logic:
       - Search for `mode === 'prepend'`, `loadOlder`, `nextCursor`, `hasMore`, or `cursor`.
     - Ensure `refresh()` always replaces with the full snapshot from the server:
       - `hydrateHistory(conversationId, fullItems, 'replace')` (no append path).
     - Keep inflight hydration:
       - Still call `hydrateInflightSnapshot(conversationId, inflight)` when present.
   - Required UI behavior:
     - Navigating away/back during streaming should retain all prior turns plus the current inflight.

4. [x] Server integration test update: turns snapshot always returns full history + inflight:
   - Test type:
     - node:test integration (server)
   - Test location:
     - `server/src/test/integration/conversations.turns.test.ts`
   - Description:
     - Update the turns snapshot tests to remove pagination expectations (`limit`, `cursor`, `nextCursor`) and assert full history + inflight are always present.
   - Purpose:
     - Ensures the server snapshot contract is full-history + inflight with no pagination.
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Cucumber guides: https://cucumber.io/docs/guides/
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

5. [x] Server integration test: inflight-only snapshot (no persisted turns):
   - Test type:
     - node:test integration (server)
   - Test location:
     - `server/src/test/integration/conversations.turns.test.ts`
   - Description:
     - Add a case where there are **zero DB turns** but an inflight run exists; assert `items` contains the inflight user + assistant turns and `inflight` is present.
   - Purpose:
     - Covers the corner case where the snapshot is inflight-only.
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Cucumber guides: https://cucumber.io/docs/guides/
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

6. [x] Server integration test: no inflight, full history (multi-turn):
   - Test type:
     - node:test integration (server)
   - Test location:
     - `server/src/test/integration/conversations.turns.test.ts`
   - Description:
     - Add a case with **multiple persisted turns** and **no inflight**; assert all turns are returned and `inflight` is omitted.
   - Purpose:
     - Covers the happy path for full-history snapshots without inflight.
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Cucumber guides: https://cucumber.io/docs/guides/
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

7. [x] Server integration test: inflight + persisted dedupe/order:
   - Test type:
     - node:test integration (server)
   - Test location:
     - `server/src/test/integration/conversations.turns.test.ts`
   - Description:
     - Add a case where persisted turns overlap with inflight snapshot turns; assert no duplicates and newest-first ordering.
   - Purpose:
     - Covers the corner case for dedupe + ordering when inflight merges into full history.
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Cucumber guides: https://cucumber.io/docs/guides/
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

8. [x] Client unit test update: refresh always replaces with full snapshot:
   - Test type:
     - Jest (client)
   - Test location:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Remove pagination assumptions and assert refresh returns full history + inflight (no cursor/nextCursor).
   - Purpose:
     - Confirms client refresh uses full snapshot and replace-only behavior.
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

9. [x] Client test update/removal: remove pagination “load older” behavior:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/chatTurnsLazyLoad.test.tsx`
   - Description:
     - Delete this test or rewrite it to confirm no pagination/load-older is exposed.
   - Purpose:
     - Ensures client no longer exposes paginated lazy-load when snapshots are full-history.
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

10. [x] Client RTL test: navigate away/back during inflight retains full history:
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/chatPage.stream.test.tsx` (or create `client/src/test/chatPage.inflightNavigate.test.tsx`)
   - Description:
     - Simulate an inflight run, unmount/remount the page (or trigger refresh), and assert that earlier persisted turns remain visible alongside the inflight message.
   - Purpose:
     - Covers the original bug: re-entry mid-stream must keep full history.
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

11. [x] Client unit test: turns fetch error does not clear transcript:
   - Test type:
     - Jest (client)
   - Test location:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Force a turns fetch error and assert the hook reports an error without wiping existing transcript state.
   - Purpose:
     - Covers the error case for snapshot refresh.
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

12. [x] Update docs to match the new snapshot contract **and add/adjust Mermaid flow diagrams when architecture/flow changes**:
   - Documentation to read (repeat even if already read):
     - Markdown guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams (spec + examples): Context7 `/mermaid-js/mermaid/v11_0_0`
   - Files to edit:
     - `design.md`
     - `README.md`
   - Required edits:
     - State that `/conversations/:id/turns` returns **full history + inflight** always.
     - Remove all references to pagination/cursors/nextCursor for turns snapshots.
     - Add/update a Mermaid diagram in `design.md` that reflects the new full-snapshot flow (client refresh → server full history + inflight → client replace-only hydration).

13. [x] Update `projectStructure.md` for any test additions/removals **after all add/remove-file subtasks (4–11) are complete**:
   - Documentation to read (repeat even if already read):
     - Markdown guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add any new tests you create.
     - Remove any deleted pagination-related tests.

14. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`:
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
   - If either fails, rerun with:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual UI check: navigate away/back during an in-flight run; full prior transcript should remain visible.
9. [x] `npm run compose:down`

#### Implementation notes

- Docs used: Express routing docs for endpoint contract shape; React hooks docs to keep snapshot hydration effects stable; Jest/RTL docs for updating tests once pagination is removed.
- Gotchas: keep inflight tool/think streaming working while removing pagination (full history items must not create duplicate inflight assistant bubbles); update existing tests that stub `nextCursor`/`includeInflight` so they match the new full-snapshot contract.
- Current snapshot contract (pre-change): `GET /conversations/:id/turns` returns `{ items, nextCursor?, inflight? }` where `items` is newest-first paginated DB turns (`listTurns({ conversationId, limit, cursor })`) merged with `snapshotInflightTurns(conversationId)` via `mergeInflightTurns(...)` in `server/src/chat/inflightRegistry.ts`. The route sorts merged results newest-first with deterministic tie-breakers; `nextCursor` is present only when the page is "full"; top-level `inflight` is only included when `includeInflight=true`.
- Server snapshot contract (post-change): `GET /conversations/:id/turns` now ignores query params entirely and always returns `{ items, inflight? }` where `items` includes the full newest-first DB history via `listAllTurns(conversationId)` plus `snapshotInflightTurns(conversationId)` merged/deduped and then stably sorted; `inflight` is always included when an inflight run exists.
- Client snapshot hydration (post-change): `useConversationTurns` now performs a single fetch of `/conversations/:id/turns` (no query params) and always replaces local turn state from the returned full snapshot; ChatPage/AgentsPage remove load-older/prepend behavior and always call `hydrateHistory(..., 'replace')` with the full turn list.
- Server integration tests updated/added in `server/src/test/integration/conversations.turns.test.ts` to assert (a) full-history responses ignore pagination query params, (b) inflight-only snapshots include both merged items and top-level inflight payload, (c) multi-turn persisted history returns without inflight, and (d) inflight merge dedupes by turnId while preserving newest-first ordering.
- Client tests updated: `client/src/test/useConversationTurns.refresh.test.ts` now asserts replace-only refresh + no query params and adds an error-retains-transcript case; removed pagination test `client/src/test/chatTurnsLazyLoad.test.tsx`; added `client/src/test/chatPage.inflightNavigate.test.tsx` to cover the mid-stream navigate-away/back bug.
- Docs updated: `design.md` and `README.md` now describe the turns snapshot API as full-history + inflight (no pagination) and include a Mermaid diagram showing replace-only hydration + inflight snapshot application.
- `projectStructure.md` updated to include `client/src/test/chatPage.inflightNavigate.test.tsx` and refresh-test description changes.
- Verified formatting with `npm run format:check --workspaces` (after running `npm run format --workspaces`) and ran `npm run lint --workspaces`.
- Testing: `npm run build --workspace server` OK.
- Testing: `npm run build --workspace client` OK.
- Testing: `npm run test --workspace server` OK.
- Testing: `npm run test --workspace client` OK.
- Testing: `npm run e2e` OK.
- Testing: `npm run compose:build` OK.
- Testing: `npm run compose:up` OK.
- Manual UI check: used a headless Playwright script against `http://host.docker.internal:5001` to send two messages, navigate away/back mid-run, re-select the conversation, and confirm both user turns remained visible (`MANUAL_UI_CHECK_OK`).
- Testing: `npm run compose:down` OK.

---

### 11. Agents: decouple run lifecycle from HTTP request (async 202 + background)

- Task Status: **__done__**
- Git Commits: **__to_do__**

#### Overview

Agents runs are still tied to a long-lived HTTP request, which means navigating away (or any network interruption) aborts the run. This task changes both instruction runs and command runs to behave like Chat: return `202` immediately and continue processing in the background. The REST “segments” fallback becomes invalid under async runs, so it must be removed entirely and the Agents page must be WS-only for transcript updates. The only cancellation path should be explicit (`cancel_inflight`), and multiple browsers should be able to observe the same run without stopping it.

#### Documentation Locations

- Express routing (response lifecycle + 202 responses): https://expressjs.com/en/guide/routing.html
- Node.js HTTP request/response lifecycle (aborted/close semantics): Context7 `/websites/nodejs_api`
- WebSocket API (browser): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React hooks (useEffect/useMemo): https://react.dev/reference/react
- Jest (test runner + mocking): Context7 `/jestjs/jest`
- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Mermaid diagrams (spec + examples): Context7 `/mermaid-js/mermaid/v11_0_0`
- Mermaid syntax (official): https://mermaid.js.org/syntax/sequenceDiagram.html

#### Subtasks

1. [x] Read current Agents run lifecycle and abort wiring (server + client):
   - Documentation to read (repeat even if already read):
     - Express routing: https://expressjs.com/en/guide/routing.html
     - Node.js HTTP lifecycle: Context7 `/websites/nodejs_api`
   - Files to read:
     - `server/src/routes/agentsRun.ts`
     - `server/src/routes/agentsCommands.ts`
     - `server/src/agents/service.ts`
     - `server/src/agents/commandsRunner.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/api/agents.ts`
   - What to locate (do not skip):
     - `AbortController` wiring (`req.on('aborted')` / `res.on('close')`).
     - The current REST response shapes (instruction run returns `segments`, command run does not).
     - Where `cancel_inflight` is sent from the client.
     - Where `createInflight(...)` is called for Agents runs.
   - Output required in Implementation notes:
     - Summarize the current “sync” behavior and why it stops on navigation.
     - Paste the current response shapes (example JSON) so the delta is obvious.

2. [x] Server: make `/agents/:agentName/run` async (return 202, continue in background):
   - Documentation to read (repeat even if already read):
     - Express routing: https://expressjs.com/en/guide/routing.html
     - Node.js HTTP lifecycle: Context7 `/websites/nodejs_api`
   - Files to edit:
     - `server/src/routes/agentsRun.ts`
     - `server/src/agents/service.ts`
   - Requirements:
     - Return immediately with HTTP `202` and a payload similar to `/chat`:
       ```json
       {
         "status": "started",
         "agentName": "planning_agent",
         "conversationId": "<uuid>",
         "inflightId": "<uuid>",
         "modelId": "<modelId>"
       }
       ```
     - **Do not** abort the run when the client disconnects (remove `req.on('aborted')` / `res.on('close')` AbortController wiring for this route).
     - Start the actual run in the background (fire-and-forget) and log errors if it fails.
     - Keep the existing `RUN_IN_PROGRESS`, `AGENT_NOT_FOUND`, `AGENT_MISMATCH`, `CONVERSATION_ARCHIVED` semantics intact.
   - Concrete implementation guidance (copy/paste friendly outline):
     - Introduce a `startAgentInstruction(...)` helper in `server/src/agents/service.ts` that:
       - Creates inflight state + publishes `user_turn` (same as today).
       - Returns `{ conversationId, inflightId, modelId }` immediately.
       - Kicks off `runAgentInstructionUnlocked(...)` in an async `void` task that logs failures and cleans up inflight.
     - Update `routes/agentsRun.ts` to call `startAgentInstruction(...)` instead of awaiting `runAgentInstruction(...)`.

3. [x] Server: make `/agents/:agentName/commands/run` async (return 202, continue in background):
   - Documentation to read (repeat even if already read):
     - Express routing: https://expressjs.com/en/guide/routing.html
     - Node.js HTTP lifecycle: Context7 `/websites/nodejs_api`
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
     - `server/src/agents/commandsRunner.ts`
     - `server/src/agents/service.ts`
   - Requirements:
     - Return immediately with HTTP `202` and a payload:
       ```json
       {
         "status": "started",
         "agentName": "planning_agent",
         "commandName": "improve_plan",
         "conversationId": "<uuid>",
         "modelId": "<modelId>"
       }
       ```
     - **Do not** abort the command run when the client disconnects.
     - The command runner must continue across multiple steps even if no client is subscribed.
     - Ensure the conversation lock is still held until the command finishes (release in `finally`).
   - Concrete implementation guidance:
     - Add a `startAgentCommand(...)` helper that starts `runAgentCommandRunner(...)` in the background and returns the start payload immediately.
     - Keep the current per-step command metadata (`stepIndex`, `totalSteps`) intact so WS transcripts remain correct.

4. [x] Server: ensure explicit cancellation stops command runs (no implicit HTTP abort):
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
     - WebSocket API (browser): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `server/src/agents/commandsRunner.ts`
     - `server/src/ws/server.ts`
     - `server/src/chat/inflightRegistry.ts`
   - Requirements:
     - When the user clicks Stop (WS `cancel_inflight`), the **current step** should stop (already true).
     - The **remaining steps** must also stop (this requires a command-level abort flag, because `params.signal` will no longer be a request signal).
   - Concrete implementation guidance (copy/paste friendly outline):
     - In `commandsRunner.ts`, add a module-level map:
       ```ts
       const commandAbortByConversationId = new Map<string, AbortController>();
       export function abortAgentCommandRun(conversationId: string) { ... }
       ```
     - When a command run starts, create and store its AbortController; clear it in `finally`.
     - In `runAgentCommandRunner(...)`, check `commandAbortController.signal.aborted` before **each** step and break if true.
     - In `server/src/ws/server.ts`, when handling `cancel_inflight`, call `abortAgentCommandRun(conversationId)` so remaining command steps are stopped.
     - Keep `cancel_inflight` behavior for non-command runs unchanged.

5. [x] Client: update Agents REST API response shapes (async 202 start payloads):
   - Documentation to read (repeat even if already read):
     - React hooks: https://react.dev/reference/react
   - Files to edit:
     - `client/src/api/agents.ts`
   - Requirements:
     - `runAgentInstruction(...)` must accept the new `{ status:'started', conversationId, inflightId, modelId }` payload.
     - `runAgentCommand(...)` must accept `{ status:'started', conversationId, agentName, commandName, modelId }`.
     - Remove any dependence on `segments` from REST responses (REST segments are no longer returned).

6. [x] Client: Agents page should be WS-only and no longer cancel on navigation:
   - Documentation to read (repeat even if already read):
     - React hooks: https://react.dev/reference/react
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Remove the REST “segments fallback” branch (always rely on WS transcript).
     - REST fallback must be fully removed (no legacy segments rendering or tests).
     - Do not abort a run when navigating away or switching conversations; only Stop should cancel (via WS `cancel_inflight`).
     - `isRunning` must be derived from WS/inflight state, not from REST request completion.
     - Disable Send/Execute when WS is unavailable, and display a clear error banner (matching Chat’s realtime behavior).
   - Concrete implementation guidance:
     - Remove `runControllerRef` usage for instruction/command starts (the request returns immediately).
     - Delete `extractSegments(...)` and any `hydrateHistory(...segments...)` calls.
     - Ensure `stop()` only clears local UI state and sends `cancel_inflight` when requested.

7. [x] Server unit test: `/agents/:agentName/run` returns 202 immediately and is not aborted by disconnect:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Description:
     - Update tests to assert a `202` response and a `status: 'started'` payload.
     - Remove/replace any test that expects abort on request close.
   - Purpose:
     - Confirms instruction runs are decoupled from HTTP lifecycle.

8. [x] Server unit test: `/agents/:agentName/commands/run` returns 202 immediately and is not aborted by disconnect:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-commands-router-run.test.ts`
   - Description:
     - Update tests to assert a `202` response and a `status: 'started'` payload.
     - Remove/replace any test that expects abort on request close.
   - Purpose:
     - Confirms command runs are decoupled from HTTP lifecycle.

9. [x] Server unit test: command runner stops remaining steps when WS cancel is sent:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`
   - Description:
     - Update/extend the test to verify a command run halts future steps after cancellation (not just the current step).
   - Purpose:
     - Ensures explicit WS cancellation stops multi-step command runs.

10. [x] Server unit test: instruction run error `AGENT_NOT_FOUND` returns 4xx and does not start a background run:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Description:
     - Add a test case that asserts `AGENT_NOT_FOUND` returns the expected 4xx + error payload.
     - Verify no background task is started for this error.
   - Purpose:
     - Covers the missing-agent error path for instruction runs.

11. [x] Server unit test: instruction run error `CONVERSATION_ARCHIVED` returns 4xx and does not start a background run:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Description:
     - Add a test case that asserts `CONVERSATION_ARCHIVED` returns the expected 4xx + error payload.
     - Verify no background task is started for this error.
   - Purpose:
     - Covers the archived-conversation error path for instruction runs.

12. [x] Server unit test: instruction run error `RUN_IN_PROGRESS` returns 4xx and does not start a background run:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Description:
     - Add a test case that asserts `RUN_IN_PROGRESS` returns the expected 4xx + error payload.
     - Verify no background task is started for this error.
   - Purpose:
     - Covers the concurrent-run error path for instruction runs.

13. [x] Server unit test: command run error `AGENT_NOT_FOUND` returns 4xx and does not start a background run:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-commands-router-run.test.ts`
   - Description:
     - Add a test case that asserts `AGENT_NOT_FOUND` returns the expected 4xx + error payload.
     - Verify no background task is started for this error.
   - Purpose:
     - Covers the missing-agent error path for command runs.

14. [x] Server unit test: command run error `COMMAND_NOT_FOUND` returns 4xx and does not start a background run:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-commands-router-run.test.ts`
   - Description:
     - Add a test case that asserts `COMMAND_NOT_FOUND` returns the expected 4xx + error payload.
     - Verify no background task is started for this error.
   - Purpose:
     - Covers the missing-command error path for command runs.

15. [x] Server unit test: command run error `CONVERSATION_ARCHIVED` returns 4xx and does not start a background run:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-commands-router-run.test.ts`
   - Description:
     - Add a test case that asserts `CONVERSATION_ARCHIVED` returns the expected 4xx + error payload.
     - Verify no background task is started for this error.
   - Purpose:
     - Covers the archived-conversation error path for command runs.

16. [x] Server unit test: command run error `RUN_IN_PROGRESS` returns 4xx and does not start a background run:
   - Documentation to read (repeat even if already read):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/agents-commands-router-run.test.ts`
   - Description:
     - Add a test case that asserts `RUN_IN_PROGRESS` returns the expected 4xx + error payload.
     - Verify no background task is started for this error.
   - Purpose:
     - Covers the concurrent-run error path for command runs.

17. [x] Client Jest test: Agents run uses async start response + WS-only transcript:
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.run.test.tsx`
   - Description:
     - Update mocks to return `{ status:'started', conversationId, inflightId, modelId }`.
     - Assert the UI waits for WS transcript events instead of REST segments.
   - Purpose:
     - Ensures the new start response is handled correctly and transcript is WS-driven.

18. [x] Client Jest test: instruction start error shows a visible error state:
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - Add `client/src/test/agentsPage.run.instructionError.test.tsx`
   - Description:
     - Mock `runAgentInstruction` to return 4xx errors (`AGENT_NOT_FOUND`, `RUN_IN_PROGRESS`).
     - Assert the Agents page shows an error banner/toast and `isRunning` remains false.
   - Purpose:
     - Covers client-side error handling for instruction start failures.

19. [x] Client Jest test: command start error shows a visible error state:
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - Add `client/src/test/agentsPage.run.commandError.test.tsx`
   - Description:
     - Mock `runAgentCommand` to return 4xx errors (`COMMAND_NOT_FOUND`, `RUN_IN_PROGRESS`).
     - Assert the Agents page shows an error banner/toast and `isRunning` remains false.
   - Purpose:
     - Covers client-side error handling for command start failures.

20. [x] Client Jest test: Stop sends `cancel_inflight` but does not abort the start request:
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - Description:
     - Update expectations so the HTTP request is **not** aborted (it returns immediately).
     - Assert `cancel_inflight` is still sent on Stop.
   - Purpose:
     - Confirms explicit cancellation still works without request-bound abort.

21. [x] Client Jest test: remove REST segments fallback coverage (WS-only):
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx`
   - Description:
     - Replace fallback assertions with “WS required” behavior (expect an error banner when WS is unavailable).
   - Purpose:
     - Keeps the test suite aligned with the WS-only design.

22. [x] Client Jest test: navigating away does not stop command execution:
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Test type:
     - Jest + React Testing Library (client)
   - Test location:
     - Add `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`
   - Description:
     - Start a command run, unmount the component, then re-mount and verify the WS transcript continues and the run still completes.
   - Purpose:
     - Guarantees the “navigate away and come back” parity with Chat.

23. [x] Documentation update: design + flow diagram for async Agents runs:
   - Documentation to read (repeat even if already read):
     - Mermaid: Context7 `/mermaid-js/mermaid/v11_0_0`
     - Mermaid syntax: https://mermaid.js.org/syntax/sequenceDiagram.html
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add/update a Mermaid sequence diagram showing:
       - `POST /agents/:agent/run` returns `202` immediately.
       - Background run continues and publishes WS events.
       - `cancel_inflight` is the **only** cancellation path.
     - Explicitly call out command-run multi-step behavior and cancellation signal.

24. [x] Documentation update: note async Agents run behavior in README:
   - Documentation to read (repeat even if already read):
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `README.md`
   - Requirements:
     - Update the Agents REST API section to note `202` responses and background execution.
     - Mention that navigation away does not cancel runs; cancellation is explicit via Stop.

25. [x] Update `projectStructure.md` if any new files are added:
   - Documentation to read (repeat even if already read):
     - Markdown guide (basic syntax): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - If you add `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx` (or any other new files), add them here **after** the file is created.

26. [x] Run lint/format checks (must be last subtask):
   - Documentation to read (repeat even if already read):
     - Jest: Context7 `/jestjs/jest`
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, rerun with:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Manually resolve any remaining issues.
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual UI check: start a command run, navigate away, return, and verify it continues without interruption (no “operation aborted”).
9. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Confirmed Agents REST runs are request-bound today: both `POST /agents/:agentName/run` and `POST /agents/:agentName/commands/run` wire `req.on('aborted')`/`res.on('close')` into an `AbortController`, pass `signal` into the service, and `createInflight({ externalSignal })` aborts the inflight when the request closes (e.g. navigation away).
- Testing: `npm run compose:down` OK.

- Manual UI check: ran a headless Playwright script inside `codeinfo2-server-1` against `http://host.docker.internal:5001/agents`, executed `planning_agent/improve_plan`, navigated away/back, and confirmed no “operation aborted” message (`MANUAL_UI_CHECK_OK`).

- Testing: `npm run compose:up` OK.

- Testing: `npm run compose:build` OK.

- Testing: `npm run e2e` OK.

- Testing: `npm run test --workspace client` OK.

- Testing: `npm run test --workspace server` OK.

- Current success response shapes (sync):
  - Instruction run (`200`):
    ```json
    {
      "agentName": "coding_agent",
      "conversationId": "<uuid>",
      "modelId": "<modelId>",
      "segments": [{ "type": "answer", "text": "..." }]
    }
    ```
  - Command run (`200`):
    ```json
    {
      "agentName": "coding_agent",
      "commandName": "improve_plan",
      "conversationId": "<uuid>",
      "modelId": "<modelId>"
    }
    ```
