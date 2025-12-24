# Story 0000019 – Chat page UX improvements (bulk conversation actions + live streaming across conversations)

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):
- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Right now, the Chat page conversation sidebar is optimized for single-conversation workflows. Users can only archive/restore one conversation at a time, and filtering is limited to a single “Show archived” toggle. This makes common housekeeping (cleaning up many chats, focusing only on archived items, restoring multiple items) unnecessarily slow.

Separately, live streaming in the GUI is scoped to the active request that started the chat. If a conversation is streaming in one browser window and the user views the same conversation in another window (or switches between conversations while multiple runs are in progress), the other view does not receive the live token/tool/final updates in real time. This prevents a “multi-conversation dashboard” workflow and makes agent/MCP-initiated runs feel second-class when viewed in the UI.

This story improves the Chat page UX in two ways:

1. **Bulk conversation management**: allow multi-select and bulk actions (archive / restore / permanent delete) with a clearer 3-state conversation filter (`Active`, `Active & Archived`, `Archived`).
2. **Live updates (transcript + sidebar)**: live updates are available across browser windows for both the active transcript and the conversation sidebar. The transcript streams only for the currently visible conversation, while the sidebar receives updates so new conversations appear (and removals/archives/restores reflect) without manual refresh.

The intended approach for “catch-up” is:
- The client continues to load the persisted snapshot (existing “load turns for a conversation” mechanism).
- While a conversation is actively streaming, the server provides incremental updates for the current in-flight turn from in-memory state.
- The UI merges persisted turns with the in-memory streaming turn so the transcript reflects “so far” content without requiring the server to retain full histories in memory.
- Catch-up must include **both** partial assistant text **and** interim tool-call progress/events so the viewed transcript looks identical to watching the stream in the originating tab.
- When a client subscribes to a conversation mid-stream (for example by switching to it, or opening it in another tab), the server sends a **full in-flight turn snapshot** (assistant text so far + tool progress history so far) before streaming further incremental updates.
- If a WebSocket reconnect occurs (network hiccup / laptop sleep), the client treats itself as potentially out of sync and reuses the existing snapshot mechanisms:
  - it refreshes the conversation list snapshot,
  - it re-fetches the visible conversation turns snapshot,
  - then re-subscribes to the sidebar stream and the visible conversation stream.
- If the user navigates away from the Chat page (for example to the Ingest page), the client stops **receiving** streaming updates by unsubscribing from the transcript and sidebar streams. This does **not** cancel the underlying run on the server; the run continues unless the user explicitly stops it (existing Stop button).
  - When the user returns to the Chat page, the client resumes viewing by re-snapshotting and re-subscribing, using the same catch-up approach as reconnects.

### Realtime transport choice (v1)

We will use **WebSockets** (one connection per browser tab) rather than SSE for fan-out of realtime events, because we need:
- Dynamic subscriptions: only the **visible** conversation transcript should stream (subscribe on view, unsubscribe on switch).
- Always-on sidebar updates: the conversation list should update in real time when conversations are created/updated/archived/restored/deleted from another browser window.
- Near-term reuse: a follow-up story is expected to apply the same realtime + management model to the **Agents** tab, so the transport should support multiple “channels” (chat list, agents list, active conversation) over a single connection.

WebSockets keep this as a single long-lived connection with explicit `subscribe`/`unsubscribe` messages, and allow us to add new event types later without creating additional long-lived HTTP streams.

### Future direction (planned reuse for Agents tab)

The Conversations sidebar should be reusable in a later story for the Agents tab by introducing an optional “agent filter” input:
- The shared Conversations component accepts an optional `agentName` (or equivalent) prop.
- When `agentName` is omitted, it behaves exactly like the current Chat sidebar (shows non-agent chat history).
- When `agentName` is provided, it filters the conversations list to only those associated with that agent (matching the existing server-side `agentName` concept used by the Agents page).
- The Agents page will supply the selected agent to this shared Conversations component based on the user’s agent selection in the Agents panel.

This story does not need to implement the Agents UI reuse, but the Chat sidebar/streaming design should avoid assumptions that would block it (for example, it should be possible to filter the list snapshot and live sidebar updates by `agentName` on the client).

---

## Acceptance Criteria

### Conversation sidebar – filter + multi-select

- Users can switch the conversation list view between:
  - `Active` (default)
  - `Active & Archived`
  - `Archived`
- Users can select multiple conversations in the sidebar (multi-select).
- When viewing `Active` or `Active & Archived`, users can bulk archive the selected conversations.
- When viewing `Archived`, users can bulk restore the selected conversations.
- When viewing `Archived`, users can bulk **permanently delete** the selected conversations:
  - Deletion is a **hard delete** (no retention window / audit log requirement in v1).
  - Deletion removes **both** the conversation record and all stored turns/tool calls for that conversation.
  - Deletion requires an explicit user confirmation (simple confirmation dialog) before the server is called.
  - The server enforces a hard guardrail: only **archived** conversations may be permanently deleted (reject delete attempts for non-archived conversations).
- Bulk actions are **all-or-nothing**: if any selected conversation cannot be processed, the server rejects the entire bulk request and no changes are applied.
- For v1, bulk actions apply to the currently loaded conversations in the list (no “select all matches across pagination”).
- Selection UX:
  - Multi-select is driven by checkboxes.
  - Selection is cleared when the user changes the view filter (`Active` / `Active & Archived` / `Archived`).
  - Selection is retained while streaming sidebar updates arrive (for example, new conversations appearing or re-sorting by `lastMessageAt`).
- Bulk action UX when the active/open conversation is included:
  - The conversation is removed/moved in the sidebar as usual, and the user sees a toast confirming the change.
  - The main transcript does not force-refresh mid-view; any already-rendered content remains visible until the user navigates away or selects another conversation.

### Chat streaming – snapshot + live updates across conversations/windows

- When a conversation is opened in the Chat page, the UI shows a snapshot of the conversation so far (existing persisted turns behaviour).
- If that conversation is currently streaming, the UI shows live updates (tokens/tool events/final) for the in-progress turn.
- A user can switch between conversations and see the correct live stream for whichever conversation is actively streaming.
- If the same conversation is viewed in multiple browser windows, both windows receive the same live updates while the run is in progress.
- In-progress MCP conversations stream in the UI the same way as REST/Web conversations (without changing MCP message formats or MCP tooling behaviour).
- When switching to a conversation that is already mid-stream, catch-up renders the in-flight state so the transcript matches the originating tab, including interim tool-call progress/events.
- Transcript streaming is scoped to the currently visible conversation only: when the user switches conversations, the client unsubscribes from the prior conversation stream and subscribes to the newly visible one.
- Starting a run in the Chat page and then navigating away does not cancel generation; the run continues to completion unless the user explicitly stops it using the existing Stop button.
- Conversation sidebar updates stream in real time:
  - new conversations appear automatically when created elsewhere,
  - conversations move between views when archived/restored elsewhere,
  - deleted conversations disappear automatically when deleted elsewhere.
- Sidebar live updates scope is intentionally minimal in v1:
  - conversation create/update/archive/restore/delete,
  - `lastMessageAt` changes and resorting.
- When `mongoConnected === false`, live streaming (sidebar + transcript subscriptions) is disabled and the UI surfaces a clear message explaining that persistence is required for realtime updates/catch-up (the user can still explicitly Stop an in-flight run).
- When `mongoConnected === false`, bulk archive/restore/permanent delete actions are also disabled, and the UI surfaces a clear error message explaining that persistence is required for safe conversation management.

### Reliability/consistency

- Live streaming updates are tied to a `conversationId` so updates are routed to the correct transcript.
- v1 assumes a single in-flight turn per `conversationId`. Starting a second run for the same conversation while one is active should be rejected with a stable 409 `RUN_IN_PROGRESS` error so events and persistence cannot interleave.
- The server only retains in-memory streaming state for conversations that are currently streaming, and it is released promptly after completion/abort.
- If the user loads a conversation that is not streaming, the UI does not show a streaming placeholder (snapshot-only).
- Streaming events include sequence identifiers (at least per-conversation) so clients can ignore stale/out-of-order events during rapid conversation switching and safely reconcile subscriptions.
- The sidebar uses a single always-on subscription that streams updates for all conversations; the client applies the current view filter locally (`Active` / `Active & Archived` / `Archived`). On disconnect/reconnect, the client refreshes the list snapshot before resuming stream updates.

---

## WebSocket protocol (proposal – to finalize before tasking)

This story will introduce a single WebSocket connection per browser tab. The protocol below is the intended shape so the work can be task-sized consistently.

Status: **accepted for v1** (no further protocol decisions required before tasking, aside from selecting concrete URL path + naming during implementation).

### Connection

- Endpoint: `GET /ws`.
- Client opens one socket on app load (or on Chat page mount); this story’s UX requires:
  - sidebar stream subscription while on Chat page,
  - transcript stream subscription for the currently visible conversation while on Chat page.
- On leaving the Chat route, the client unsubscribes from both sidebar + transcript streams. On returning, it re-snapshots then re-subscribes.

### Client → Server messages

All messages are JSON objects with `type` and a client-generated `requestId` for debugging.

- `type: "subscribe_sidebar"`
  - `{ type, requestId }`
- `type: "unsubscribe_sidebar"`
  - `{ type, requestId }`
- `type: "subscribe_conversation"`
  - `{ type, requestId, conversationId: string }`
- `type: "unsubscribe_conversation"`
  - `{ type, requestId, conversationId: string }`
- `type: "cancel_inflight"`
  - Used by the existing Stop button to cancel the currently running turn without relying on HTTP request abort.
  - `{ type, requestId, conversationId: string, inflightId: string }`
  - `inflightId` is stable for the lifetime of a single in-progress turn. For turns started in the Chat UI, the client generates it and includes it in `POST /chat`. For turns started elsewhere (e.g. MCP), the client learns it from `inflight_snapshot`/`assistant_delta` and caches it for Stop.

### Server → Client events

All events are JSON objects with `type`. Events include sequence identifiers to support dedupe/out-of-order guarding.

- Sidebar events (single global stream)
  - `type: "sidebar_snapshot"` – optional, but may be useful for debugging; primary snapshot remains the existing REST list fetch.
  - `type: "conversation_upsert"`
    - `{ type, seq: number, conversation: { conversationId, title, provider, model, source, lastMessageAt, archived, agentName? } }`
  - `type: "conversation_delete"`
    - `{ type, seq: number, conversationId: string }`

- Transcript events (scoped to a `conversationId`)
  - `type: "inflight_snapshot"`
    - Sent immediately after `subscribe_conversation` when a run is currently in progress, and broadcast to existing subscribers when a new in-flight turn starts (snapshot may be empty until the first delta/tool event arrives).
    - `{ type, conversationId, seq: number, inflight: { inflightId: string, assistantText: string, analysisText: string, toolEvents: unknown[], startedAt: string } }`
  - `type: "assistant_delta"`
    - `{ type, conversationId, seq: number, inflightId: string, delta: string }`
  - `type: "analysis_delta"`
    - Mirrors the existing SSE `analysis` channel used by Codex/Harmony and the current Chat UI reasoning renderer.
    - `{ type, conversationId, seq: number, inflightId: string, delta: string }`
  - `type: "tool_event"`
    - Interim tool progress/events (so viewers match the originating tab).
    - `event` payload is the same shape as the existing Chat SSE tool frames (`tool-request` / `tool-result`) so the client can reuse existing mapping logic.
    - `{ type, conversationId, seq: number, inflightId: string, event: unknown }`
  - `type: "turn_final"`
    - Marks completion of the in-flight turn and carries any final metadata needed by the UI.
    - `{ type, conversationId, seq: number, inflightId: string, status: "ok" | "stopped" | "failed" }`

### Sequence IDs (minimum)

- Sidebar events use a monotonically increasing `seq` per socket (or per server process) so the client can ignore stale/out-of-order list updates.
- Transcript events use a monotonically increasing `seq` per `conversationId` so the client can ignore stale/out-of-order deltas/events during rapid switching.

Note: the persisted transcript remains the source of truth; sequence IDs are primarily to prevent UI glitches from late-arriving events rather than to enable full replay.

---

## Pre-tasking investigation findings (repo facts)

These findings are based on the current repository implementation and are included here to reduce risk when tasking and implementing Story 0000019.

### Current streaming behavior (today)

- The Chat page currently streams via **SSE** from `POST /chat` in `server/src/routes/chat.ts`. The server passes an `AbortSignal` into the provider execution and **aborts provider generation on client disconnect** (`req.on('close'|'aborted')` / `res.on('close')` → `AbortController.abort()`).
- The client’s `useChatStream.stop()` aborts the in-flight fetch via `AbortController.abort()` (`client/src/hooks/useChatStream.ts`), and `ChatPage` calls `stop()` both when switching conversations and on unmount (`client/src/pages/ChatPage.tsx` cleanup effect).
- Net effect: **navigating away from Chat currently cancels the run**, which conflicts with this story’s requirement that leaving Chat only unsubscribes from WS updates while the run continues server-side.

### In-flight state availability (today)

- The server does not currently maintain any shared/global in-flight turn state suitable for late subscribers. In-flight buffers (tokens/tool results) are request-local inside the chat interface/run and are discarded after completion. This story therefore requires introducing an explicit in-memory in-flight registry keyed by `conversationId` + `inflightId`.

### Existing realtime infrastructure (today)

- There is no existing reusable WebSocket server/publisher in the repo. Long-lived communication currently consists of:
  - `POST /chat` SSE streaming, and
  - MCP HTTP JSON-RPC servers (not streaming, no HTTP upgrade).
- Implementing this story’s WebSocket design requires adding a new WebSocket endpoint and a server-side publish/subscribe layer.

### Ingest page updates (today)

- The Ingest page does **not** use SSE today. It uses client-side **polling** via `GET /ingest/status/:runId` on an interval (~2s while active) implemented in `client/src/hooks/useIngestStatus.ts`, and served by `server/src/routes/ingestStart.ts`.
- There is SSE used elsewhere (for example `GET /logs/stream` in `server/src/routes/logs.ts` consumed via `EventSource` in `client/src/hooks/useLogs.ts`), but ingest status updates are plain JSON polling.
- Story 19 must **not** change the ingest polling mechanism or break it; ingest status polling must continue to work exactly as-is.

### Conversation management API gaps (today)

- The REST API currently supports single-item archive/restore (`POST /conversations/:id/archive|restore`) and list/turn endpoints (`GET /conversations`, `GET /conversations/:id/turns`). There are **no** bulk endpoints and **no** permanent delete endpoints. Story 19 will need to add these.
- `GET /conversations` only supports a boolean archived mode (active-only vs active+archived). There is no archived-only list mode today, so the 3-state filter requires extending the list API.

### Mongo transactions / atomicity risk (today)

- Docker Compose runs Mongo as a single-node replica set (`--replSet rs0` and `mongo/init-mongo.js` calls `rs.initiate(...)`), which is capable of transactions.
- The current replica-set initiation uses `host: 'localhost:27017'`. In Docker Desktop environments this causes a common client issue: when connecting as a replica set without `directConnection=true`, the driver attempts to connect to the advertised host (`127.0.0.1:27017`) and fails.
- Verified in this repo on **2025-12-24**: Mongoose transactions work with the current URI form **using `directConnection=true`** (with or without `replicaSet=rs0`), but fail when using `replicaSet=rs0` without `directConnection=true`.
- Therefore, this story’s bulk operations should:
  - use a Mongoose session transaction for all-or-nothing semantics, and
  - keep `directConnection=true` in default URIs (optionally adding `replicaSet=rs0` explicitly).

### Existing tests that will be impacted

- Server Cucumber cancellation tests currently assert that aborting the HTTP request cancels provider execution (`server/src/test/steps/chat_cancellation.steps.ts`).
- Client tests for the Stop button and “New conversation” behavior assume aborting the in-flight fetch cancels the run (`client/src/test/chatPage.stop.test.tsx`, `client/src/test/chatPage.newConversation.test.tsx`).
- Because Story 19 decouples “view subscription” from “run lifetime”, these tests will need to be updated (Stop will use `cancel_inflight`; navigation/unsubscribe must not cancel the run).

---

## Out Of Scope

- “Select all” across the entire result set (server-side bulk operations over all matches).
- Complex selection gestures (shift-click ranges, keyboard navigation) beyond basic checkbox multi-select.
- Editing conversation titles, tagging, folders, or search within conversations.
- Cross-instance fan-out or locking (multi-server coordination). v1 assumes a single server process for live fan-out.
- Changing the MCP tool request/response formats or the persisted MCP turn schema. This story only improves how those existing turns/streams are displayed in the browser.
- Introducing a public “cancel run” API beyond the existing Stop button semantics (Stop will cancel the in-flight run via `cancel_inflight`; leaving the page/unsubscribing must not cancel).
- Sidebar “extra” live indicators (typing/streaming badges, token previews, tool-progress badges) beyond minimal create/update/delete + resorting.

---

## Questions

(none – ready for tasking once the WebSocket protocol above is reviewed and accepted as final for v1.)

---

# Tasks

### 1. WebSocket foundation + in-flight registry (server)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Introduce a WebSocket endpoint and server-side in-flight registry so the chat UI can subscribe to live sidebar updates and in-progress transcript streams across tabs. This task establishes the pub/sub backbone, sequence IDs, and snapshot/delta event flow without changing client UX yet.

#### Documentation Locations

- MDN WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- ws (Node WebSocket server) docs: Context7 `/websockets/ws/8_18_3`
- Node.js net/http upgrade basics: https://nodejs.org/api/http.html#event-upgrade
- Mongoose sessions/transactions (v9.0.1): Context7 `/automattic/mongoose/9.0.1` (transactions)

#### Subtasks

1. [ ] Files to read: `server/src/index.ts`, `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/chat/interfaces/ChatInterface.ts`, `server/src/chat/interfaces/ChatInterfaceCodex.ts`, `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, `server/src/chatStream.ts`, `server/src/routes/chatValidators.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/agents/service.ts`, `server/src/agents/runLock.ts`, `server/src/mongo/repo.ts`
   - Reuse/reference patterns from: `server/src/logStore.ts` (sequence + subscribe/unsubscribe pub-sub), `server/src/routes/logs.ts` (SSE stream heartbeats + replay), `server/src/ingest/lock.ts` (TTL lock/release pattern)
2. [ ] Add WebSocket server dependency (`ws`) to the `server` workspace (and any required types)
3. [ ] Define the WS protocol types + runtime validation (client message union + server event union)
   - Recommended: a small `server/src/ws/types.ts` plus Zod validators for inbound client messages so malformed payloads never crash the server
4. [ ] Create the WS server bootstrap (e.g., `server/src/ws/server.ts`) and wire it into `server/src/index.ts` using a configurable path (default `/ws`)
   - Prefer `WebSocketServer({ server, path: '/ws' })` or `noServer + server.on('upgrade')` patterns supported by ws v8.x (Context7 `/websockets/ws/8_18_3`)
5. [ ] Implement per-socket connection state (requestId logging, subscriptions, and safe JSON send) and add minimal server-side logging for connect/disconnect and message validation errors
6. [ ] Implement the in-flight registry data model (e.g., `server/src/ws/inflightRegistry.ts`) keyed by `conversationId` + `inflightId`:
   - start an in-flight record at run start (even before first token)
   - append assistant text deltas
   - append analysis deltas
   - append tool events (`tool-request` / `tool-result`) with bounded history
   - track timestamps and final status
7. [ ] Define bounded in-flight retention (max tool events, any max chars/TTL) and ensure prompt cleanup on completion/abort/socket close to avoid memory leaks
8. [ ] Implement the WS hub/pubsub backbone (e.g., `server/src/ws/hub.ts`) using a logStore-style architecture:
   - `subscribe_sidebar` / `unsubscribe_sidebar` (global sidebar stream with a monotonic `seq`)
   - `subscribe_conversation` / `unsubscribe_conversation` (per-conversation transcript stream with a monotonic `seq` per `conversationId`)
   - `cancel_inflight` routing into the in-flight registry cancel handle
9. [ ] Implement WS message handling + error responses (invalid JSON, unknown `type`, missing required fields) and ensure the server never crashes on malformed messages
10. [ ] Implement domain-safe `cancel_inflight` handling (unknown `conversationId`/`inflightId`, already-finalized inflight) with stable, non-crashing error responses
11. [ ] Extend the REST chat request contract:
   - accept an optional client-provided `inflightId` in `POST /chat` (validated in `chatValidators`)
   - accept an optional `cancelOnDisconnect` boolean in `POST /chat` (default `true` for backward compatibility)
12. [ ] Update `POST /chat` to register a run in the in-flight registry at start (creating `inflightId` server-side when missing), attach a cancel handle, and broadcast an immediate `inflight_snapshot` to existing subscribers
13. [ ] Update `POST /chat` disconnect behavior to respect `cancelOnDisconnect`:
   - if `cancelOnDisconnect === true` (default), preserve today’s behavior (abort underlying run on disconnect)
   - if `cancelOnDisconnect === false`, stop writing SSE frames for that response **without aborting** the underlying run (only `cancel_inflight` should abort)
14. [ ] Emit transcript events from **REST Chat** (`POST /chat`) into the hub while preserving existing SSE responses:
   - Codex provider: `token` → `assistant_delta`, `analysis` → `analysis_delta`, tool events → `tool_event`, completion → `turn_final`
   - LM Studio provider: same mapping (including tool events)
15. [ ] Emit transcript events from **MCP v2 tools** that call `ChatInterface.run` (e.g. `codebase_question`) into the hub
   - Ensure `inflightId` is generated server-side (because there is no `POST /chat` payload) and an `inflight_snapshot` is broadcast before the first delta/tool event so late subscribers can cancel and catch up
16. [ ] Emit transcript events from **Agents runs** (REST + MCP) that call `ChatInterface.run` into the hub (so MCP/Agents-initiated runs stream live in Chat)
   - Ensure `inflightId` is generated server-side and an `inflight_snapshot` is broadcast before the first delta/tool event
17. [ ] Enforce a single in-flight run per conversation across Chat + MCP + Agents:
   - reuse `server/src/agents/runLock.ts` (`tryAcquireConversationLock` / `releaseConversationLock`)
   - return a stable 409 `RUN_IN_PROGRESS` error for conflicts
18. [ ] Ensure assistant turn persistence remains exactly-once for Codex + LM Studio (including with memory persistence), and ensure conversation meta updates do not double-trigger WS `conversation_upsert`
19. [ ] Emit sidebar events on conversation create/update/archive/restore/delete (including bulk ops) and ensure emission covers **all** call sites (REST Chat, MCP, Agents, archive/restore routes, bulk routes)
20. [ ] Add server unit/integration/Cucumber tests for WS hub routing, sequence IDs, inflight snapshots (including mid-stream subscribe catch-up), WS lifecycle, and the updated disconnect/stop semantics
21. [ ] Update docs: `design.md`, `projectStructure.md` (new ws/inflight modules and protocol notes, plus updated Stop semantics)
22. [ ] Run full linting (`npm run lint --workspaces`)

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Ensure docker compose starts (`npm run compose:up`)
5. [ ] Run server tests covering WS hub + inflight registry (`npm run test --workspace server`)

#### Implementation notes

- 

---

### 2. Bulk conversation APIs + hard delete (server)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add bulk archive/restore/delete APIs with archived-only delete guardrails and all-or-nothing semantics, plus deletion of associated turns/tool calls. This enables the client to perform multi-select actions safely and keeps persistence consistent.

#### Documentation Locations

- Mongoose sessions/transactions: https://mongoosejs.com/docs/transactions.html
- MongoDB transactions overview: https://www.mongodb.com/docs/manual/core/transactions/
- Express routing: https://expressjs.com/en/guide/routing.html

#### Subtasks

1. [ ] Files to read: `server/src/routes/conversations.ts`, `server/src/mongo/repo.ts`, `server/src/mongo/conversation.ts`, `server/src/mongo/turn.ts`, `server/.env`, `docker-compose.yml`, `README.md`
2. [ ] Extend the conversations list API to support the 3-state sidebar filter:
   - Active (default)
   - Active & Archived (`archived=true`)
   - Archived-only (`archived=only`)
   - Keep existing `archived=true` behavior for active+archived; add archived-only without breaking older clients
3. [ ] Update the repo query logic to support archived-only mode (without relying on client-side filtering)
4. [ ] Add/adjust server tests covering list pagination across all three modes
5. [ ] Add request validation for bulk operations (conversationId list, max size, dedupe/normalize, reject empty)
6. [ ] Implement `POST /conversations/bulk/archive` with all-or-nothing semantics
7. [ ] Implement `POST /conversations/bulk/restore` with all-or-nothing semantics
8. [ ] Implement `POST /conversations/bulk/delete` with all-or-nothing semantics:
   - enforce archived-only delete (reject non-archived IDs)
   - delete conversations and turns in a single transaction
   - return structured errors
   - Important (Mongoose v9): avoid parallel operations inside the transaction executor (no Promise.all); prefer single `updateMany`/`deleteMany` calls or sequential awaits (Context7 `/automattic/mongoose/9.0.1` transactions)
9. [ ] Update persistence helpers in `server/src/mongo/repo.ts` to support bulk operations + delete-by-conversationId
10. [ ] Emit corresponding `conversation_upsert` / `conversation_delete` WS events only after a successful bulk transaction commit
11. [ ] Update default Mongo URI(s) used by server + Compose to settings needed for transactions:
   - audit and update at least: `server/.env`, `.env.docker.example`, `.env.e2e`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, `README.md`
   - Important: keep `directConnection=true` (transactions work with it; replica-set discovery fails without it due to the current rs member host being `localhost:27017`). Optionally add `replicaSet=rs0` explicitly alongside `directConnection=true`.
12. [ ] Add server unit/Cucumber tests covering bulk archive/restore/delete success and failure cases (including all-or-nothing rejection cases)
13. [ ] Update docs: `design.md`, `projectStructure.md`, `README.md`
14. [ ] Run full linting (`npm run lint --workspaces`)

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Ensure docker compose starts (`npm run compose:up`)
5. [ ] Run server tests for bulk conversation APIs (`npm run test --workspace server`)

#### Implementation notes

- 

---

### 3. Conversation sidebar filter + multi-select + bulk actions (client)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add a 3-state filter, checkbox multi-select, and bulk archive/restore/delete UI to the Chat sidebar with proper confirmation and persistence gating. This enables efficient conversation management without leaving the Chat page.

#### Documentation Locations

- MUI Lists/Checkboxes/Dialogs/ToggleButtonGroup (MUI MCP docs, repo uses `@mui/material@^6.4.1`): @mui/material
- React state + effects: https://react.dev/learn

#### Subtasks

1. [ ] Files to read: `client/src/components/chat/ConversationList.tsx`, `client/src/hooks/useConversations.ts`, `client/src/hooks/usePersistenceStatus.ts`, `client/src/pages/ChatPage.tsx`, `client/src/api/*`
   - Reuse/reference patterns from: `client/src/components/ingest/RootsTable.tsx` (checkbox multi-select + bulk action toolbar + indeterminate select-all)
   - Note: the existing chat sidebar is already implemented in `client/src/components/chat/ConversationList.tsx` using MUI `List` + a `Switch` filter; extend/refactor this component rather than introducing a new sidebar list implementation
2. [ ] Implement 3-state filter UI (`Active`, `Active & Archived`, `Archived`) and ensure selection clears on filter change
3. [ ] Refactor the conversations list fetch logic to support all 3 filter modes (Active default, `archived=true`, `archived=only`) without breaking pagination
4. [ ] Add checkbox multi-select per conversation row and an indeterminate select-all control for the current view (reuse RootsTable patterns)
5. [ ] Add a bulk action toolbar with context-appropriate actions:
   - Active / Active & Archived: bulk archive
   - Archived: bulk restore + bulk permanent delete
6. [ ] Implement a permanent delete confirmation dialog (explicit user confirmation before calling the server)
7. [ ] Ensure selection is retained across sidebar live updates (upserts/resorts) and that bulk actions do not force-refresh the currently visible transcript mid-view
8. [ ] Add API helpers for bulk endpoints and wire optimistic UI updates + toast/error handling (ensure all-or-nothing rejection leaves UI unchanged)
9. [ ] Confirm UX for “open conversation included in bulk action”:
   - conversation is removed/moved in the sidebar, toast confirms action
   - transcript remains stable (no forced refresh) until user navigates
10. [ ] Disable bulk actions and show clear messaging when `mongoConnected === false`
11. [ ] Add/update client RTL tests for filter modes, selection behavior, “open conversation included in bulk action” behavior, all-or-nothing error paths, and disabled state
12. [ ] Update docs: `design.md`, `projectStructure.md`
13. [ ] Run full linting (`npm run lint --workspaces`)

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Ensure docker compose starts (`npm run compose:up`)
5. [ ] Run client tests (`npm run test --workspace client`)

#### Implementation notes

- 

---

### 4. Live sidebar + transcript streaming subscriptions (client)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add WebSocket connection management on the Chat page, including sidebar live updates and transcript catch-up/subscription for the active conversation. Update Stop behavior to cancel in-flight runs without relying on HTTP aborts and ensure navigation away only unsubscribes.

#### Documentation Locations

- MDN WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React Router (repo uses `react-router-dom@7.9.6`): Context7 `/remix-run/react-router/react-router_7.9.4` (hooks + navigation)

#### Subtasks

1. [ ] Files to read: `client/src/hooks/useChatStream.ts`, `client/src/hooks/useConversations.ts`, `client/src/hooks/useConversationTurns.ts`, `client/src/pages/ChatPage.tsx`, `client/src/api/*`
   - Reuse/reference patterns from: `client/src/logging/transport.ts` (backoff/retry pacing) and `client/src/hooks/useLogs.ts` (SSE reconnect + subscription lifecycle patterns, even though WS is different)
2. [ ] Create a WebSocket hook/service (e.g., `client/src/hooks/useChatWs.ts`) with connect/disconnect, requestId generation, and safe JSON send
3. [ ] Add reconnect strategy (backoff + jitter) and ensure event handlers are resilient to reconnect storms (reuse `client/src/logging/transport.ts` pacing patterns)
4. [ ] Implement subscribe/unsubscribe helpers for `subscribe_sidebar`, `unsubscribe_sidebar`, `subscribe_conversation`, `unsubscribe_conversation`
5. [ ] Gate realtime features on persistence: when `mongoConnected === false`, do not subscribe to sidebar/transcript updates; surface a clear message that realtime updates/catch-up require persistence (keep cancellation working for the active run)
6. [ ] Implement sidebar subscription lifecycle tied to Chat route mount/unmount:
   - subscribe on mount
   - unsubscribe on unmount
   - on reconnect: refresh the list snapshot before resubscribing
7. [ ] Implement transcript subscription lifecycle for the active conversation:
   - unsubscribe previous conversationId when switching
   - subscribe newly visible conversationId
   - on reconnect: re-fetch visible conversation turns snapshot before resubscribing
8. [ ] Implement inflight snapshot merge logic so the transcript merges persisted turns + one in-flight turn (including tool events)
9. [ ] Handle `assistant_delta` and `tool_event` updates while subscribed so the transcript matches the originating tab
10. [ ] Handle `analysis_delta` updates so Codex reasoning state renders identically when a user switches tabs mid-run
11. [ ] Apply client-side sequence guards:
   - sidebar events: ignore out-of-order `seq` updates
   - transcript events: ignore out-of-order `seq` per conversationId
12. [ ] Update `useChatStream.send()` to generate a client-side `inflightId` per turn, include it in `POST /chat` payloads, and pass `cancelOnDisconnect=false`; store `inflightId` for cancellation
13. [ ] Cache `inflightId` for the visible conversation from inbound WS events (`inflight_snapshot` / deltas / tool events) so Stop can cancel runs started outside the current tab
14. [ ] Update Stop behavior to send `cancel_inflight` over WS (conversationId + inflightId)
15. [ ] Refactor non-Stop flows so they do not cancel generation:
   - switching conversations unsubscribes from the prior transcript stream and subscribes to the new one
   - leaving the Chat route unsubscribes from sidebar/transcript streams
   - any SSE abort used to detach should not send `cancel_inflight` (only explicit Stop should cancel)
16. [ ] Update “New conversation” behavior: if a run is in-flight, cancel it via `cancel_inflight` (not HTTP abort), then clear transcript state while keeping the existing model/provider rules
17. [ ] Restore Codex `threadId` from persisted conversation flags when selecting/hydrating an existing conversation so continuation works across reloads/tabs (the list API already returns `flags`)
18. [ ] Ensure Chat sidebar realtime updates remain scoped correctly (e.g., ignore `agentName` conversations if Chat view is `agentName=__none__`)
19. [ ] Add client tests for WS subscription, inflight catch-up (including analysis), persistence-gating, Stop semantics, “New conversation” semantics, and Codex threadId restore (update existing tests to new behavior)
20. [ ] Update docs: `design.md`, `projectStructure.md`
21. [ ] Run full linting (`npm run lint --workspaces`)

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Ensure docker compose starts (`npm run compose:up`)
5. [ ] Run client tests (`npm run test --workspace client`)

#### Implementation notes

- 

---

### 5. Final Task – Full verification + documentation + PR summary

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Verify the story end-to-end against the acceptance criteria, perform full clean builds and tests, update documentation, and generate a PR comment summarizing all changes.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] Perform a clean docker build
4. [ ] Ensure `README.md` is updated with any required description changes and with any new commands that have been added as part of this story
5. [ ] Ensure `design.md` is updated with any required description changes including mermaid diagrams that have been added as part of this story
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
8. [ ] Ensure Playwright coverage includes (or is updated to include) at least: (a) starting a run then navigating away does not cancel it, and (b) a second tab can subscribe and see inflight catch-up/live updates

#### Testing

1. [ ] Run the client jest tests
2. [ ] Run the server cucumber tests
3. [ ] Restart the docker environment
4. [ ] Run the e2e tests
5. [ ] Use the playwright mcp tool to manually check the application, saving screenshots to `./test-results/screenshots/` - Each screenshot should be named with the plan index including the preceding zeroes, then a dash, then the task number, then a dash and the name of the screenshot

#### Implementation notes

- 
