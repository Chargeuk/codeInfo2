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
  - Transport: primary implementation is WS (`cancel_inflight` message). De-risking fallback: also expose `POST /chat/cancel` that accepts the same `conversationId` + `inflightId` so Stop still works if the WS is temporarily disconnected.

### Server → Client events

All events are JSON objects with `type`. Events include sequence identifiers to support dedupe/out-of-order guarding.

- Sidebar events (single global stream)
  - `type: "sidebar_snapshot"` – optional (debug only). Simplification (de-risking): do not implement in v1 unless it becomes necessary; primary snapshot remains the existing REST list fetch.
  - `type: "conversation_upsert"`
    - `{ type, seq: number, conversation: { conversationId, title, provider, model, source, lastMessageAt, archived, agentName? } }`
  - `type: "conversation_delete"`
    - `{ type, seq: number, conversationId: string }`

- Transcript events (scoped to a `conversationId`)
  - `type: "inflight_snapshot"`
    - Sent immediately after `subscribe_conversation` when a run is currently in progress, and broadcast to existing subscribers when a new in-flight turn starts (snapshot may be empty until the first delta/tool event arrives).
    - Simplification (de-risking): snapshot carries **current tool state** (not raw tool event history). The UI only needs the current set of tool rows (requesting/done/error + latest stage/result) to look the same as the originating tab.
    - `{ type, conversationId, seq: number, inflight: { inflightId: string, assistantText: string, analysisText: string, tools: unknown[], startedAt: string } }`
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
  - Note: a `POST /chat/cancel` endpoint is allowed as a transport fallback for the existing Stop semantics (it is not a new “cancel product feature”; it is reliability plumbing for `cancel_inflight`).
- Sidebar “extra” live indicators (typing/streaming badges, token previews, tool-progress badges) beyond minimal create/update/delete + resorting.

---

## Questions

(none – ready for tasking once the WebSocket protocol above is reviewed and accepted as final for v1.)

## Ground rules for juniors (read before starting any subtask)

- Run commands from the repo root unless a subtask says otherwise. Use `npm` (not yarn/pnpm). Expected tooling: Node.js 22+, npm 10+, Docker + Docker Compose.
- Before coding, open the “Files to read” for your subtask and skim them end-to-end so you understand the local patterns (this repo has consistent test harness patterns per workspace).
- Server tests are split:
  - Node unit/integration tests: `npm run test:unit --workspace server` (uses `node:test` + `supertest`).
  - Cucumber BDD tests: `npm run test:integration --workspace server`.
- Client tests use Jest + React Testing Library: `npm run test --workspace client`.
- Chat streaming today is SSE from `POST /chat` and aborting the HTTP request currently cancels generation. In this story we intentionally decouple “viewing” from “generation”: leaving Chat or switching conversations must only unsubscribe (no implicit cancel).
- For this story, cancellation is explicit:
  - primary: WS `cancel_inflight` message
  - fallback: `POST /chat/cancel` (same payload) so Stop works even if WS is temporarily disconnected.
- Mongo matters: when `mongoConnected === false`, realtime subscriptions and bulk archive/restore/delete must be gated off in the UI because conversation routes don’t have the same in-memory fallback behavior as `POST /chat`.

---

# Tasks

### 1. WebSocket foundation + in-flight registry (server)

- Task Status: __done__
- Git Commits: 2178cd1, ce19a70

#### Overview

Introduce a WebSocket endpoint and server-side in-flight registry so the chat UI can subscribe to live sidebar updates and in-progress transcript streams across tabs. This task establishes the pub/sub backbone, sequence IDs, and snapshot/delta event flow without changing client UX yet.

#### Documentation Locations

- WebSockets (browser concepts + message lifecycle): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- ws (Node WebSocket server, `WebSocketServer({ server, path })`, connection/message events): Context7 `/websockets/ws/8_18_3`
- Node HTTP server upgrade event (only needed if we must manually route upgrades): https://nodejs.org/api/http.html#event-upgrade
- Node HTTP request/response lifecycle events (disconnect handling for SSE detaches): https://nodejs.org/api/http.html#event-close
- AbortController (server-side cancellation wiring; keep detach separate from cancel): https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Express Router/app structure (Express 5.x; understand how `app.listen()` returns an HTTP server to attach ws): Context7 `/expressjs/express/v5.1.0` (Router)
- Zod validation (use `z.discriminatedUnion('type', ...)` + `safeParse` to validate inbound WS messages without throwing): DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
- Mermaid (diagram syntax for WS architecture + event flow): Context7 `/mermaid-js/mermaid`
- Node test runner (WS protocol/inflight integration tests): https://nodejs.org/api/test.html
- npm run-script (workspace build/test commands referenced in this task): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Docker Compose (task verification commands): https://docs.docker.com/compose/

#### Subtasks

1. [x] Files to read: `server/src/index.ts`, `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/chat/interfaces/ChatInterface.ts`, `server/src/chat/interfaces/ChatInterfaceCodex.ts`, `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, `server/src/chatStream.ts`, `server/src/routes/chatValidators.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/agents/service.ts`, `server/src/agents/runLock.ts`, `server/src/mongo/repo.ts`
   - Reuse/reference patterns from: `server/src/logStore.ts` (sequence + subscribe/unsubscribe pub-sub), `server/src/routes/logs.ts` (SSE stream heartbeats + replay), `server/src/ingest/lock.ts` (TTL lock/release pattern)
   - Docs (read before coding):
     - MDN WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - ws docs: Context7 `/websockets/ws/8_18_3`
     - Node upgrade event: https://nodejs.org/api/http.html#event-upgrade
     - Mongoose transactions: https://mongoosejs.com/docs/transactions.html
2. [x] Add WebSocket server dependency (`ws`) to the `server` workspace (and any required types)
   - Files to edit: `server/package.json`
   - Docs (read before coding): Context7 `/websockets/ws/8_18_3` (install + server usage)
   - Implementation sketch:

     ```ts
     import { WebSocketServer } from 'ws';
     ```

   - Done when: `npm run build --workspace server` succeeds after installing `ws`
3. [x] Define the WS protocol types + runtime validation (client message union + server event union)
   - Files to create: `server/src/ws/types.ts`
   - Files to edit (if you split validators): `server/src/ws/types.ts` (or a dedicated `server/src/ws/validators.ts`)
   - Docs (read before coding): Zod (DeepWiki) `colinhacks/zod` https://deepwiki.com/colinhacks/zod (use `z.discriminatedUnion` + `safeParse` for inbound WS messages)
   - Critical constraints (do not skip): every inbound client message must be validated; invalid/malformed payloads must never crash the server
   - Implementation sketch:

     ```ts
     const clientMessageSchema = z.discriminatedUnion('type', [
       z.object({ type: z.literal('subscribe_sidebar'), requestId: z.string() }),
       z.object({ type: z.literal('unsubscribe_sidebar'), requestId: z.string() }),
       z.object({
         type: z.literal('subscribe_conversation'),
         requestId: z.string(),
         conversationId: z.string().min(1),
       }),
       // ...
     ]);
     ```
4. [x] Create the WS server bootstrap (e.g., `server/src/ws/server.ts`) and wire it into `server/src/index.ts` using a configurable path (default `/ws`)
   - Simplification (de-risking): prefer `WebSocketServer({ server, path: '/ws' })` and avoid manual `upgrade` routing unless there is a concrete need (Context7 `/websockets/ws/8_18_3`)
   - Files to create: `server/src/ws/server.ts`
   - Files to edit: `server/src/index.ts`
   - Docs (read before coding): Context7 `/websockets/ws/8_18_3` (WebSocketServer `server` + `path`)
   - Implementation sketch (wiring into existing Express server):

     ```ts
     // server/src/index.ts
     server = app.listen(Number(PORT), () => baseLogger.info(`Server on ${PORT}`));
     if (server) startChatWsServer({ server, path: '/ws' });
     ```

   - Done when: WS server starts without breaking existing REST endpoints
5. [x] Implement per-socket connection state (requestId logging, subscriptions, and safe JSON send) and add minimal server-side logging for connect/disconnect and message validation errors
   - Files to edit: `server/src/ws/server.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket, Context7 `/websockets/ws/8_18_3` (connection/message/close)
   - Critical constraints (do not skip): always wrap JSON.parse and JSON.stringify sends; one bad client must not break other clients
6. [x] Implement the in-flight registry data model (e.g., `server/src/ws/inflightRegistry.ts`) keyed by `conversationId` + `inflightId`:
   - start an in-flight record at run start (even before first token)
   - append assistant text deltas
   - append analysis deltas
   - maintain **current tool state** per callId (requesting/done/error + latest stage/result/error), bounded by a max tool count
   - track timestamps and final status
   - Files to create: `server/src/ws/inflightRegistry.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (needed for this subtask):
     - One in-flight record per `{ conversationId, inflightId }`.
     - The registry must be able to produce an `inflight_snapshot` for late subscribers that includes assistant text so far, analysis text so far, and current tool states.
     - Subsequent streaming updates are emitted as deltas (`assistant_delta`, `analysis_delta`) and tool updates (`tool_event`), then finalized with `turn_final`.
   - Implementation sketch (tool state, not history):

     ```ts
     type ToolState = { id: string; name?: string; status: 'requesting' | 'done' | 'error'; stage?: string };
     // Key by callIdOut string so you can update the same row when tool-result arrives.
     const toolsById = new Map<string, ToolState>();
     ```
7. [x] Define bounded in-flight retention (max tool count, max chars/TTL) and ensure prompt cleanup on completion/abort/socket close to avoid memory leaks
   - Files to edit: `server/src/ws/inflightRegistry.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (needed for this subtask): cleanup is triggered on `turn_final` and on explicit cancellation (`cancel_inflight` / `POST /chat/cancel`).
   - Critical constraints (do not skip): in-flight state must be removed on `turn_final` and on explicit cancellation
8. [x] Implement the WS hub/pubsub backbone (e.g., `server/src/ws/hub.ts`) with a simple subscribe/unsubscribe model:
   - `subscribe_sidebar` / `unsubscribe_sidebar` (global sidebar stream with a monotonic `seq`)
   - `subscribe_conversation` / `unsubscribe_conversation` (per-conversation transcript stream with a monotonic `seq` per `conversationId`)
   - `cancel_inflight` routing into the in-flight registry cancel handle
   - Simplification (de-risking): do **not** implement WS replay/backlog buffering in v1; rely on the existing REST snapshots on reconnect, and rely on `inflight_snapshot` for mid-stream catch-up
   - Files to create: `server/src/ws/hub.ts`
   - Docs (read before coding): Context7 `/websockets/ws/8_18_3` (broadcasting), MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Done when: multiple sockets can subscribe/unsubscribe without leaks, and events include `seq`
9. [x] Implement WS message handling + error responses (invalid JSON, unknown `type`, missing required fields) and ensure the server never crashes on malformed messages
   - Files to edit: `server/src/ws/server.ts`, `server/src/ws/types.ts`
   - Docs (read before coding): Zod (DeepWiki) `colinhacks/zod` https://deepwiki.com/colinhacks/zod
   - Implementation sketch:

     ```ts
     let msg: unknown;
     try { msg = JSON.parse(raw.toString()); } catch { /* send error */ }
     const parsed = clientMessageSchema.safeParse(msg);
     if (!parsed.success) { /* send error */ }
     ```
10. [x] Implement domain-safe `cancel_inflight` handling (unknown `conversationId`/`inflightId`, already-finalized inflight) with stable, non-crashing error responses
   - Files to edit: `server/src/ws/hub.ts`, `server/src/ws/inflightRegistry.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (client message): `{ type: 'cancel_inflight', requestId: string, conversationId: string, inflightId: string }`
   - Critical constraints (do not skip): cancellation must be idempotent (re-sending cancel should not crash)
11. [x] Add REST cancellation fallback for Stop: `POST /chat/cancel` that cancels by `conversationId` + `inflightId`
   - Why this exists: if the WS is temporarily disconnected, Stop must still be able to cancel the run (SSE abort no longer cancels when `cancelOnDisconnect=false`)
   - Files to create: `server/src/routes/chatCancel.ts`
   - Files to edit: `server/src/index.ts` (mount router)
   - Docs (read before coding): Express Router (Context7) `/expressjs/express/v5.1.0`, Zod (DeepWiki) `colinhacks/zod` https://deepwiki.com/colinhacks/zod
   - Acceptance criteria:
     - returns 200 `{ status: 'ok' }` when cancellation succeeds
     - returns 404 `{ error: 'not_found' }` when `conversationId`/`inflightId` does not match an active inflight
     - is idempotent: cancelling an already-cancelled inflight does not crash and returns a stable response
12. [x] Extend the REST chat request contract:
   - accept an optional client-provided `inflightId` in `POST /chat` (validated in `chatValidators`)
   - accept an optional `cancelOnDisconnect` boolean in `POST /chat` (default `true` for backward compatibility)
   - Files to edit: `server/src/routes/chatValidators.ts`, `server/src/routes/chat.ts`
   - Docs (read before coding): Zod (DeepWiki) `colinhacks/zod` https://deepwiki.com/colinhacks/zod, MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Critical constraints (do not skip): default behavior must remain unchanged for existing clients (`cancelOnDisconnect` defaults to true)
   - Implementation sketch (Zod add-ons):

     ```ts
     inflightId: z.string().min(1).optional(),
     cancelOnDisconnect: z.boolean().optional(),
     ```
13. [x] Update `POST /chat` to register a run in the in-flight registry at start (creating `inflightId` server-side when missing), attach a cancel handle, and broadcast an immediate `inflight_snapshot` to existing subscribers
   - Files to edit: `server/src/routes/chat.ts`
   - Files to edit/create: `server/src/ws/inflightRegistry.ts`, `server/src/ws/hub.ts`
   - Docs (read before coding): Context7 `/websockets/ws/8_18_3`
   - Critical constraints (do not skip): register and broadcast the `inflight_snapshot` before the first token/tool/analysis delta so late subscribers can catch up and Stop can work
14. [x] Update `POST /chat` disconnect behavior to respect `cancelOnDisconnect`:
   - if `cancelOnDisconnect === true` (default), preserve today’s behavior (abort underlying run on disconnect)
   - if `cancelOnDisconnect === false`, stop writing SSE frames for that response **without aborting** the underlying run (only `cancel_inflight` should abort)
   - Files to edit: `server/src/routes/chat.ts`
   - Docs (read before coding): Node HTTP request events https://nodejs.org/api/http.html#event-close
   - Critical constraints (do not skip): Chat UI detaches by aborting fetch, but must not implicitly cancel generation when `cancelOnDisconnect=false`
   - Implementation gotcha (current code bug to avoid repeating): Node/Express `res.on('close', handler)` does not pass a reason argument; do not pass a typed `handleDisconnect(reason)` directly or you will get `reason=undefined` and accidentally cancel. Use explicit wrappers (e.g. `() => handleDisconnect('close')`) and keep a separate `transportClosed` flag for “stop writing” vs “abort run”.
   - Implementation sketch (pattern):

     ```ts
     const handleDisconnect = () => {
       if (cancelOnDisconnect) controller.abort();
       endStream(res); // always stop writing to this response
     };
     ```
15. [x] Emit transcript events from **REST Chat** (`POST /chat`) into the hub while preserving existing SSE responses:
   - Codex provider: `token` → `assistant_delta`, `analysis` → `analysis_delta`, tool events → `tool_event`, completion → `turn_final`
   - LM Studio provider: same mapping (including tool events)
   - Files to edit: `server/src/routes/chat.ts`
   - Docs (read before coding): Context7 `/websockets/ws/8_18_3`, MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (server events): emit `inflight_snapshot` at run start, then stream deltas (`assistant_delta`, `analysis_delta`, `tool_event`) and finish with `turn_final`.
   - Critical constraints (do not skip): keep the existing SSE stream output unchanged so current client tests continue to pass while WS is added
16. [x] Emit transcript events from **MCP v2 tools** that call `ChatInterface.run` (e.g. `codebase_question`) into the hub
   - Ensure `inflightId` is generated server-side (because there is no `POST /chat` payload) and an `inflight_snapshot` is broadcast before the first delta/tool event so late subscribers can cancel and catch up
   - Files to edit: `server/src/mcp2/tools/codebaseQuestion.ts`
   - Files to edit/create: `server/src/ws/hub.ts`, `server/src/ws/inflightRegistry.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (server events): broadcast `inflight_snapshot` before any deltas, then `assistant_delta`/`analysis_delta`/`tool_event`, then `turn_final`.
17. [x] Emit transcript events from **Agents runs** (REST + MCP) that call `ChatInterface.run` into the hub (so MCP/Agents-initiated runs stream live in Chat)
   - Ensure `inflightId` is generated server-side and an `inflight_snapshot` is broadcast before the first delta/tool event
   - Files to edit: `server/src/agents/service.ts`
   - Files to edit/create: `server/src/ws/hub.ts`, `server/src/ws/inflightRegistry.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (server events): broadcast `inflight_snapshot` before any deltas, then `assistant_delta`/`analysis_delta`/`tool_event`, then `turn_final`.
18. [x] Enforce a single in-flight run per conversation across Chat + MCP + Agents:
   - reuse `server/src/agents/runLock.ts` (`tryAcquireConversationLock` / `releaseConversationLock`)
   - return a stable 409 `RUN_IN_PROGRESS` error for conflicts
   - Files to edit: `server/src/routes/chat.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`
   - Files to read: `server/src/agents/runLock.ts`
   - Docs (read before coding): story “Reliability/consistency” section in this doc
   - Critical constraints (do not skip): acquire lock before starting provider execution and always release in `finally`
   - Done when: concurrent runs for the same conversationId return 409 and do not interleave persistence/events
19. [x] Ensure assistant turn persistence remains exactly-once for Codex + LM Studio (including with memory persistence), and ensure conversation meta updates do not double-trigger WS `conversation_upsert`
   - Files to read: `server/src/routes/chat.ts` (`recordAssistantTurn`), `server/src/chat/interfaces/ChatInterface.ts`
   - Files to edit (as needed): `server/src/routes/chat.ts`, `server/src/ws/hub.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (sidebar events): do not emit duplicate `conversation_upsert` for the same logical update.
   - Critical constraints (do not skip): do not call `appendTurn` twice for the assistant (watch for new WS code accidentally re-persisting)
20. [x] Emit sidebar events on conversation create/update/archive/restore/delete (including bulk ops) and ensure emission covers **all** call sites (REST Chat, MCP, Agents, archive/restore routes, bulk routes)
   - Files to edit (likely): `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, `server/src/agents/service.ts`
   - Files to edit (later, bulk): `server/src/routes/conversations.ts` (bulk endpoints) and the repo helpers in `server/src/mongo/repo.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (server events):
     - `conversation_upsert`: `{ type: 'conversation_upsert', seq: number, conversation: { conversationId, title, provider, model, source, lastMessageAt, archived, agentName? } }`
     - `conversation_delete`: `{ type: 'conversation_delete', seq: number, conversationId: string }`
   - Critical constraints (do not skip): emit events only after persistence succeeds (and after transaction commit for bulk)
21. [x] Server integration test (Node): WebSocket connect + disconnect lifecycle
   - Files to create/edit: `server/src/test/integration/ws.lifecycle.connectDisconnect.test.ts`
   - Files to read: `server/src/test/integration/conversations.list.test.ts` (Node test + supertest patterns), `server/src/test/integration/chat-codex.test.ts` (streaming route test patterns), `server/src/ws/server.ts` (WS bootstrap), `server/src/index.ts` (HTTP server wiring)
   - Location: `server/src/test/integration/ws.lifecycle.connectDisconnect.test.ts`
   - Purpose: ensure multiple sockets can connect, subscribe, and close without crashing the server and without leaking subscription state
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
22. [x] Server integration test (Node): WebSocket message validation rejects invalid JSON
   - Files to create/edit: `server/src/test/integration/ws.validation.invalidJson.test.ts`
   - Files to read: `server/src/ws/types.ts` (Zod schemas), `server/src/ws/server.ts` (message parsing), `server/src/test/integration/conversations.list.test.ts` (Node test patterns)
   - Location: `server/src/test/integration/ws.validation.invalidJson.test.ts`
   - Purpose: ensure invalid JSON never crashes the server and produces a stable error response (or closes cleanly)
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
23. [x] Server integration test (Node): WebSocket message validation rejects unknown `type`
   - Files to create/edit: `server/src/test/integration/ws.validation.unknownType.test.ts`
   - Files to read: `server/src/ws/types.ts` (discriminated union), `server/src/ws/server.ts` (validation error handling)
   - Location: `server/src/test/integration/ws.validation.unknownType.test.ts`
   - Purpose: ensure unknown `type` does not crash the server and produces a stable error response
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod

24. [x] Server integration test (Node): WebSocket message validation rejects missing fields for subscribe_conversation
   - Files to create/edit: `server/src/test/integration/ws.validation.subscribeConversation.missingConversationId.test.ts`
   - Files to read: `server/src/ws/types.ts` (schema requirements), `server/src/ws/server.ts` (safeParse + response strategy)
   - Location: `server/src/test/integration/ws.validation.subscribeConversation.missingConversationId.test.ts`
   - Purpose: ensure `subscribe_conversation` without `conversationId` returns a stable error and never crashes the server
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
25. [x] Server integration test (Node): WebSocket message validation rejects missing fields for cancel_inflight
   - Files to create/edit: `server/src/test/integration/ws.validation.cancelInflight.missingInflightId.test.ts`
   - Files to read: `server/src/ws/types.ts` (schema requirements), `server/src/ws/server.ts`
   - Location: `server/src/test/integration/ws.validation.cancelInflight.missingInflightId.test.ts`
   - Purpose: ensure `cancel_inflight` without `inflightId` returns a stable error and never crashes the server
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
26. [x] Server integration test (Node): Sidebar subscribe/unsubscribe lifecycle
   - Files to create/edit: `server/src/test/integration/ws.sidebar.subscribeUnsubscribe.test.ts`
   - Files to read: `server/src/ws/hub.ts` (subscribe/unsubscribe), `server/src/logStore.ts` (subscribe/unsubscribe pattern), `server/src/ws/server.ts` (socket state)
   - Location: `server/src/test/integration/ws.sidebar.subscribeUnsubscribe.test.ts`
   - Purpose: ensure `subscribe_sidebar` begins delivery and `unsubscribe_sidebar` stops delivery for that socket
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, story WS protocol section in this doc
27. [x] Server integration test (Node): Transcript subscribe when idle (no inflight)
   - Files to create/edit: `server/src/test/integration/ws.conversation.subscribeIdle.test.ts`
   - Files to read: `server/src/ws/inflightRegistry.ts` (empty/idle semantics), `server/src/ws/hub.ts` (subscribe_conversation)
   - Location: `server/src/test/integration/ws.conversation.subscribeIdle.test.ts`
   - Purpose: ensure subscribing to a conversation with no inflight run does not emit an `inflight_snapshot`
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, story WS protocol section in this doc
28. [x] Server integration test (Node): Transcript subscribe mid-run catch-up snapshot
   - Files to create/edit: `server/src/test/integration/ws.conversation.catchupSnapshot.test.ts`
   - Files to read: `server/src/ws/inflightRegistry.ts` (snapshot fields), `server/src/ws/hub.ts` (subscribe_conversation sends immediate snapshot)
   - Location: `server/src/test/integration/ws.conversation.catchupSnapshot.test.ts`
   - Purpose: ensure `subscribe_conversation` immediately receives `inflight_snapshot` with current assistant text, analysis text, and current tool state when a run is already in progress
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, story WS protocol section in this doc
29. [x] Server integration test (Node): MCP codebase_question run emits inflight events to WS subscribers
   - Files to create/edit: `server/src/test/integration/ws.mcp2.codebaseQuestion.inflightBroadcast.test.ts`
   - Files to read: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` (existing MCP2 harness), `server/src/mcp2/tools/codebaseQuestion.ts` (tool implementation), `server/src/ws/hub.ts` (broadcast)
   - Location: `server/src/test/integration/ws.mcp2.codebaseQuestion.inflightBroadcast.test.ts`
   - Purpose: ensure WS `subscribe_conversation` receives `inflight_snapshot` and subsequent deltas/tool events when a run is started via MCP (no browser tab initiated it)
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
30. [x] Server integration test (Node): Agents run emits inflight events to WS subscribers
   - Files to create/edit: `server/src/test/integration/ws.agents.runInstruction.inflightBroadcast.test.ts`
   - Files to read: `server/src/test/unit/agents-router-run.test.ts` (agents route harness + conflict patterns), `server/src/agents/service.ts` (run implementation), `server/src/ws/hub.ts`
   - Location: `server/src/test/integration/ws.agents.runInstruction.inflightBroadcast.test.ts`
   - Purpose: ensure WS subscribers can observe in-flight progress when a conversation is run via Agents (future reuse of transport)
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
31. [x] Server integration test (Node): Sidebar `seq` monotonicity
   - Files to create/edit: `server/src/test/integration/ws.seq.sidebarMonotonic.test.ts`
   - Files to read: `server/src/ws/hub.ts` (seq assignment)
   - Location: `server/src/test/integration/ws.seq.sidebarMonotonic.test.ts`
   - Purpose: ensure sidebar events include a monotonically increasing `seq` so clients can ignore stale events
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, story WS protocol section in this doc
32. [x] Server integration test (Node): Transcript `seq` monotonicity per conversation
   - Files to create/edit: `server/src/test/integration/ws.seq.transcriptMonotonic.test.ts`
   - Files to read: `server/src/ws/hub.ts` (per-conversation seq assignment)
   - Location: `server/src/test/integration/ws.seq.transcriptMonotonic.test.ts`
   - Purpose: ensure transcript events for a conversation include a monotonically increasing `seq`
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, story WS protocol section in this doc
33. [x] Server integration test (Node): `cancel_inflight` happy path
   - Files to create/edit: `server/src/test/integration/ws.cancel.happyPath.test.ts`
   - Files to read: `server/src/ws/hub.ts` (cancel routing), `server/src/ws/inflightRegistry.ts` (cancel handle)
   - Location: `server/src/test/integration/ws.cancel.happyPath.test.ts`
   - Purpose: ensure `cancel_inflight` aborts the run and emits `turn_final` with status `stopped`
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, story WS protocol section in this doc
34. [x] Server integration test (Node): `cancel_inflight` idempotency
   - Files to create/edit: `server/src/test/integration/ws.cancel.idempotent.test.ts`
   - Files to read: `server/src/ws/hub.ts`, `server/src/ws/inflightRegistry.ts`
   - Location: `server/src/test/integration/ws.cancel.idempotent.test.ts`
   - Purpose: ensure sending `cancel_inflight` twice does not crash and does not emit duplicate finals
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
35. [x] Server integration test (Node): `cancel_inflight` invalid input handling
   - Files to create/edit: `server/src/test/integration/ws.cancel.invalid.test.ts`
   - Files to read: `server/src/ws/hub.ts` (error response shape)
   - Location: `server/src/test/integration/ws.cancel.invalid.test.ts`
   - Purpose: ensure unknown `conversationId` and mismatched `inflightId` return a stable error and do not crash
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
36. [x] Server integration test (Node): REST cancel fallback happy path (`POST /chat/cancel`)
   - Files to create/edit: `server/src/test/integration/chat.cancelEndpoint.happyPath.test.ts`
   - Files to read: `server/src/test/integration/chat-codex.test.ts` (supertest streaming patterns), `server/src/routes/chatCancel.ts` (endpoint)
   - Location: `server/src/test/integration/chat.cancelEndpoint.happyPath.test.ts`
   - Purpose: ensure the REST cancellation endpoint cancels a running inflight and the run ends as `stopped`
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
37. [x] Server integration test (Node): REST cancel fallback not found (`POST /chat/cancel`)
   - Files to create/edit: `server/src/test/integration/chat.cancelEndpoint.notFound.test.ts`
   - Files to read: `server/src/routes/chatCancel.ts`
   - Location: `server/src/test/integration/chat.cancelEndpoint.notFound.test.ts`
   - Purpose: ensure cancelling an unknown `conversationId`/`inflightId` returns 404 and does not crash
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
38. [x] Server integration test (Node): REST cancel fallback idempotency (`POST /chat/cancel`)
   - Files to create/edit: `server/src/test/integration/chat.cancelEndpoint.idempotent.test.ts`
   - Files to read: `server/src/routes/chatCancel.ts`
   - Location: `server/src/test/integration/chat.cancelEndpoint.idempotent.test.ts`
   - Purpose: ensure cancelling an already-cancelled inflight returns a stable response and does not crash
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
39. [x] Server integration test (Node): `POST /chat` rejects invalid `cancelOnDisconnect` types
   - Files to create/edit: `server/src/test/integration/chat.validators.cancelOnDisconnect.invalidType.test.ts`
   - Files to read: `server/src/routes/chatValidators.ts` (Zod request schema)
   - Location: `server/src/test/integration/chat.validators.cancelOnDisconnect.invalidType.test.ts`
   - Purpose: ensure request validation returns 400 and does not start a run when `cancelOnDisconnect` is not a boolean
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
40. [x] Server integration test (Node): `POST /chat` rejects invalid `inflightId`
   - Files to create/edit: `server/src/test/integration/chat.validators.inflightId.invalid.test.ts`
   - Files to read: `server/src/routes/chatValidators.ts`
   - Location: `server/src/test/integration/chat.validators.inflightId.invalid.test.ts`
   - Purpose: ensure request validation returns 400 for empty/invalid inflight IDs so cancellation cannot be spoofed or broken
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
41. [x] Server integration test (Node): REST cancel endpoint rejects invalid body (`POST /chat/cancel`)
   - Files to create/edit: `server/src/test/integration/chat.cancelEndpoint.validationError.test.ts`
   - Files to read: `server/src/routes/chatCancel.ts` (body schema)
   - Location: `server/src/test/integration/chat.cancelEndpoint.validationError.test.ts`
   - Purpose: ensure missing/invalid `conversationId`/`inflightId` returns 400 validation_error and does not crash
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
42. [x] Server integration test (Node): detach semantics when `cancelOnDisconnect=false`
   - Files to create/edit: `server/src/test/integration/chat.detach.cancelOnDisconnectFalse.test.ts`
   - Files to read: `server/src/routes/chat.ts` (disconnect handlers), `server/src/chatStream.ts` (SSE end)
   - Location: `server/src/test/integration/chat.detach.cancelOnDisconnectFalse.test.ts`
   - Purpose: ensure aborting the SSE response stops writing to that client but does not abort the underlying provider run
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Node HTTP close event https://nodejs.org/api/http.html#event-close
43. [x] Server integration test (Node): backward compatibility when `cancelOnDisconnect` is omitted
   - Files to create/edit: `server/src/test/integration/chat.detach.defaultCancels.test.ts`
   - Files to read: `server/src/routes/chat.ts`
   - Location: `server/src/test/integration/chat.detach.defaultCancels.test.ts`
   - Purpose: ensure today’s behavior remains: disconnect/abort cancels provider execution when `cancelOnDisconnect` is not provided
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
44. [x] Server unit test (Node): inflight registry cleanup
   - Files to create/edit: `server/src/test/unit/inflightRegistry.cleanup.test.ts`
   - Files to read: `server/src/ws/inflightRegistry.ts` (public API)
   - Location: `server/src/test/unit/inflightRegistry.cleanup.test.ts`
   - Purpose: ensure inflight entries are removed after `turn_final` and after explicit cancel to prevent memory growth
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html

45. [x] Server integration test (Node): REST chat run emits inflight events to WS subscribers
   - Files to create/edit: `server/src/test/integration/ws.restChat.inflightBroadcast.test.ts`
   - Files to read: `server/src/test/integration/chat-codex.test.ts` (chat harness), `server/src/routes/chat.ts` (SSE route), `server/src/ws/hub.ts` (broadcast)
   - Location: `server/src/test/integration/ws.restChat.inflightBroadcast.test.ts`
   - Purpose: ensure `POST /chat`-initiated runs broadcast `inflight_snapshot` then subsequent `assistant_delta`/`analysis_delta`/`tool_event` and a final `turn_final` to subscribed sockets
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
46. [x] Server integration test (Node): `POST /chat` run-lock conflict returns 409 `RUN_IN_PROGRESS`
   - Files to create/edit: `server/src/test/integration/chat.runLock.conflict.test.ts`
   - Files to read: `server/src/test/unit/agents-router-run.test.ts` (existing 409 conflict pattern), `server/src/agents/runLock.ts` (lock)
   - Location: `server/src/test/integration/chat.runLock.conflict.test.ts`
   - Purpose: ensure starting a second run for the same `conversationId` while one is in-flight returns 409 `{ error: 'conflict', code: 'RUN_IN_PROGRESS' }` and does not interleave persistence/events
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
47. [x] Server MCP2 test (Node): `codebase_question` run-lock conflict returns 409 `RUN_IN_PROGRESS`
   - Files to create/edit: `server/src/test/mcp2/tools/codebaseQuestion.runLock.conflict.test.ts`
   - Files to read: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` (existing MCP2 harness), `server/src/agents/runLock.ts`
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.runLock.conflict.test.ts`
   - Purpose: ensure MCP-initiated runs for a locked `conversationId` return a stable conflict and do not start streaming/persistence
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
48. [x] Server integration test (Node): sidebar `conversation_upsert` on REST chat create/update
   - Files to create/edit: `server/src/test/integration/ws.sidebar.upsert.onChatCreateUpdate.test.ts`
   - Files to read: `server/src/routes/chat.ts` (create/update conversation meta), `server/src/ws/hub.ts` (sidebar broadcast)
   - Location: `server/src/test/integration/ws.sidebar.upsert.onChatCreateUpdate.test.ts`
   - Purpose: ensure when `POST /chat` creates a new conversation or updates `lastMessageAt`, subscribed sidebar sockets receive `conversation_upsert` for that conversation
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
49. [x] Server integration test (Node): sidebar `conversation_upsert` on archive
   - Files to create/edit: `server/src/test/integration/ws.sidebar.upsert.onArchive.test.ts`
   - Files to read: `server/src/routes/conversations.ts` (archive endpoint), `server/src/ws/hub.ts`
   - Location: `server/src/test/integration/ws.sidebar.upsert.onArchive.test.ts`
   - Purpose: ensure `POST /conversations/:id/archive` emits `conversation_upsert` with `archived=true` to sidebar subscribers
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
50. [x] Server integration test (Node): sidebar `conversation_upsert` on restore
   - Files to create/edit: `server/src/test/integration/ws.sidebar.upsert.onRestore.test.ts`
   - Files to read: `server/src/routes/conversations.ts` (restore endpoint), `server/src/ws/hub.ts`
   - Location: `server/src/test/integration/ws.sidebar.upsert.onRestore.test.ts`
   - Purpose: ensure `POST /conversations/:id/restore` emits `conversation_upsert` with `archived=false` to sidebar subscribers
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
51. [x] Server unit test (Node): inflight registry tool state updates are in-place (no duplicates)
   - Files to create/edit: `server/src/test/unit/inflightRegistry.tools.currentState.test.ts`
   - Files to read: `server/src/ws/inflightRegistry.ts` (tool update behavior)
   - Location: `server/src/test/unit/inflightRegistry.tools.currentState.test.ts`
   - Purpose: ensure tool requests/results for the same `callId` update a single tool state row (current state), not an ever-growing history array
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
52. [x] Server unit test (Node): inflight registry enforces bounds (max tool count)
   - Files to create/edit: `server/src/test/unit/inflightRegistry.tools.maxCount.test.ts`
   - Files to read: `server/src/ws/inflightRegistry.ts` (bound constants)
   - Location: `server/src/test/unit/inflightRegistry.tools.maxCount.test.ts`
   - Purpose: ensure the registry enforces a maximum number of tracked tools so a malicious or buggy provider cannot cause unbounded memory growth
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
53. [x] Update docs: `design.md` (WS + inflight architecture + protocol flow diagrams)
   - Files to edit: `design.md`
   - Location: `design.md`
   - Description: add/update Mermaid diagrams and narrative describing WS hub + inflight registry + sequence IDs + snapshot/delta events
   - Purpose: document the new WS hub/inflight registry modules, sequence IDs, and the snapshot/delta event flows as Mermaid diagrams so future changes stay consistent
   - Docs (read before doing): Mermaid (Context7) `/mermaid-js/mermaid`, Markdown basics https://www.markdownguide.org/basic-syntax/
54. [x] Update docs: `projectStructure.md` (new `server/src/ws/*` modules and new test files)
   - Files to edit: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: add every new/moved/removed server file created in Task 1 (WS foundation + in-flight registry + Stop cancel fallback + tests)
   - Required file list (must be complete; update based on what you actually created):
     - New server modules: `server/src/ws/types.ts`, `server/src/ws/server.ts`, `server/src/ws/inflightRegistry.ts`, `server/src/ws/hub.ts`, `server/src/routes/chatCancel.ts`
     - New server Node integration tests:
       - `server/src/test/integration/ws.lifecycle.connectDisconnect.test.ts`
       - `server/src/test/integration/ws.validation.invalidJson.test.ts`
       - `server/src/test/integration/ws.validation.unknownType.test.ts`
       - `server/src/test/integration/ws.validation.subscribeConversation.missingConversationId.test.ts`
       - `server/src/test/integration/ws.validation.cancelInflight.missingInflightId.test.ts`
       - `server/src/test/integration/ws.sidebar.subscribeUnsubscribe.test.ts`
       - `server/src/test/integration/ws.conversation.subscribeIdle.test.ts`
       - `server/src/test/integration/ws.conversation.catchupSnapshot.test.ts`
       - `server/src/test/integration/ws.mcp2.codebaseQuestion.inflightBroadcast.test.ts`
       - `server/src/test/integration/ws.agents.runInstruction.inflightBroadcast.test.ts`
       - `server/src/test/integration/ws.seq.sidebarMonotonic.test.ts`
       - `server/src/test/integration/ws.seq.transcriptMonotonic.test.ts`
       - `server/src/test/integration/ws.cancel.happyPath.test.ts`
       - `server/src/test/integration/ws.cancel.idempotent.test.ts`
       - `server/src/test/integration/ws.cancel.invalid.test.ts`
       - `server/src/test/integration/ws.restChat.inflightBroadcast.test.ts`
       - `server/src/test/integration/chat.runLock.conflict.test.ts`
       - `server/src/test/integration/ws.sidebar.upsert.onChatCreateUpdate.test.ts`
       - `server/src/test/integration/ws.sidebar.upsert.onArchive.test.ts`
       - `server/src/test/integration/ws.sidebar.upsert.onRestore.test.ts`
       - `server/src/test/integration/chat.cancelEndpoint.happyPath.test.ts`
       - `server/src/test/integration/chat.cancelEndpoint.notFound.test.ts`
       - `server/src/test/integration/chat.cancelEndpoint.idempotent.test.ts`
       - `server/src/test/integration/chat.cancelEndpoint.validationError.test.ts`
       - `server/src/test/integration/chat.validators.cancelOnDisconnect.invalidType.test.ts`
       - `server/src/test/integration/chat.validators.inflightId.invalid.test.ts`
       - `server/src/test/integration/chat.detach.cancelOnDisconnectFalse.test.ts`
       - `server/src/test/integration/chat.detach.defaultCancels.test.ts`
     - New server Node unit tests:
       - `server/src/test/unit/inflightRegistry.cleanup.test.ts`
       - `server/src/test/unit/inflightRegistry.tools.currentState.test.ts`
       - `server/src/test/unit/inflightRegistry.tools.maxCount.test.ts`
       - `server/src/test/mcp2/tools/codebaseQuestion.runLock.conflict.test.ts`
     - Removed files: none expected (if you delete/move anything, list it explicitly)
   - Purpose: keep the repo structure map accurate and make WS/inflight/test additions discoverable for onboarding
   - Docs (read before doing): Markdown basics https://www.markdownguide.org/basic-syntax/
55. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix --workspaces`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Files to read: `package.json`, `client/package.json`, `server/package.json`, `eslint.config.js`, `.prettierrc`
   - Commands: `npm run lint --workspaces`, `npm run format:check --workspaces`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script, ESLint CLI https://eslint.org/docs/latest/use/command-line-interface, Prettier CLI https://prettier.io/docs/en/cli.html
#### Testing

1. [x] `npm run build --workspace server`
   - Files to read: `package.json`, `server/package.json`
   - Command: `npm run build --workspace server`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Files to read: `package.json`, `client/package.json`
   - Command: `npm run build --workspace client`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Files to read: `server/package.json`, `server/src/test/`
   - Command: `npm run test --workspace server`
   - Docs (read before doing): Node test runner https://nodejs.org/api/test.html, Cucumber guides https://cucumber.io/docs/guides/
4. [x] `npm run test --workspace client`
   - Files to read: `client/package.json`, `client/src/test/`
   - Command: `npm run test --workspace client`
   - Docs (read before doing): Jest (Context7) `/websites/jestjs_io_30_0`, Testing Library https://testing-library.com/docs/react-testing-library/intro/
5. [x] `npm run e2e`
   - Files to read: `package.json`, `playwright.config.ts`, `e2e/`, `.env.e2e`, `docker-compose.e2e.yml`
   - Command: `npm run e2e`
   - Docs (read before doing): Playwright (Context7) `/microsoft/playwright.dev`, Docker Compose https://docs.docker.com/compose/
6. [x] `npm run compose:build`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:build`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/, npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
7. [x] `npm run compose:up`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`, `README.md` (ports: client 5001, server 5010)
   - Command: `npm run compose:up`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/
8. [x] Manual Playwright-MCP check (Task 1 focus: WS connect + inflight events + cancellation semantics)
   - Files to read: `planning/0000019-chat-page-ux.md` (Acceptance Criteria), `README.md` (URLs/ports)
   - Manual checks (minimum):
     - Start the stack and open http://localhost:5001.
     - In Tab A, start a chat run; in Tab B, open the same conversation and confirm Tab B receives an initial catch-up snapshot then continues receiving deltas.
     - Click Stop in Tab A and confirm cancellation propagates to other tabs/viewers of that conversation.
     - Navigate away in Tab B (detach) and confirm it does not cancel the in-flight run.
     - Confirm the sidebar updates live (new conversation / lastMessageAt updates) without requiring a page refresh.
   - Docs (read before doing): Playwright https://playwright.dev/docs/intro
9. [x] `npm run compose:down`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:down`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/

#### Implementation notes

- 2025-12-25: Task 1 marked `__in_progress__`. Completed onboarding read-through of server chat streaming + persistence patterns and identified existing disconnect-cancels-run logic that must be split into `transportClosed` vs explicit cancel.
- 2025-12-25: Added `ws@8.18.3` to the server workspace and updated the root lockfile via `npm install`.
- 2025-12-25: Added `server/src/ws/types.ts` defining the v1 WS protocol runtime validators (Zod) and shared `ServerEvent`/`ClientMessage` types.
- 2025-12-25: Added `server/src/ws/server.ts` and wired it into `server/src/index.ts` (default WS path `/ws`, override via `WS_PATH`).
- 2025-12-25: `server/src/ws/server.ts` now tracks per-socket state (id + subscriptions + `sidebarSeq`) and uses guarded JSON send/error replies so malformed clients don’t crash the server.
- 2025-12-25: Added `server/src/ws/inflightRegistry.ts` with bounded (chars/tools) in-flight snapshots, cancellation hooks, and tombstones to make cancellation idempotent without leaking memory.
- 2025-12-25: In-flight retention bounds are enforced in `server/src/ws/inflightRegistry.ts` (max chars/tools + TTL) and entries are removed on `turn_final` and explicit cancel.
- 2025-12-25: Added `server/src/ws/hub.ts` implementing WS subscribe/unsubscribe, per-socket sidebar `seq`, per-conversation transcript `seq`, and `cancel_inflight` routing into the in-flight registry.
- 2025-12-25: `server/src/ws/server.ts` now validates inbound messages (JSON parse + Zod `safeParse`), routes subscribe/unsubscribe/cancel into the hub, and returns stable `error` events instead of throwing.
- 2025-12-25: `cancel_inflight` is domain-safe and idempotent via `server/src/ws/inflightRegistry.ts` tombstones and `server/src/ws/hub.ts` (not_found error on unknown ids; no duplicate finals).
- 2025-12-25: Added `POST /chat/cancel` in `server/src/routes/chatCancel.ts` and mounted it in `server/src/index.ts` as a WS-disconnect-safe cancellation fallback.
- 2025-12-25: Extended `POST /chat` request validation to accept `inflightId` and `cancelOnDisconnect` (default true) and threaded those values into the chat route handler.
- 2025-12-25: `POST /chat` now creates an in-flight entry (server-generated `inflightId` when absent), attaches an abort cancel handle, and broadcasts an initial `inflight_snapshot` via the WS hub.
- 2025-12-25: `POST /chat` disconnect handling now supports detach semantics: when `cancelOnDisconnect=false` we stop writing SSE and keep the underlying run alive; when omitted/true we preserve the legacy abort-on-disconnect behavior.
- 2025-12-25: `POST /chat` now mirrors its streaming events into WS (`assistant_delta`, `analysis_delta`, `tool_event`) and finalizes with `turn_final`, while keeping the SSE frames identical for the existing client.
- 2025-12-25: `server/src/mcp2/tools/codebaseQuestion.ts` now registers an in-flight entry, broadcasts snapshot + deltas/tool events, and finalizes via `turn_final` so MCP-initiated runs are observable from Chat WS subscribers.
- 2025-12-25: `server/src/agents/service.ts` now registers agent runs in the in-flight registry and broadcasts snapshot/deltas/tool events/final via the WS hub.
- 2025-12-25: Added conversation-level run locking for `POST /chat` and `codebase_question` using `server/src/agents/runLock.ts` and returning a stable 409 `RUN_IN_PROGRESS` conflict.
- 2025-12-25: Sidebar `conversation_upsert` emission is kept in one place per logical update (e.g. `POST /chat` ensureConversation) to avoid duplicate upserts from underlying persistence helpers.
- 2025-12-25: Added sidebar WS `conversation_upsert` broadcasts for REST chat create/update and conversation archive/restore; also emits upserts for MCP+Agents conversation activity so new/updated conversations appear without refresh.
- 2025-12-25: Added WS integration test coverage starting with `server/src/test/integration/ws.lifecycle.connectDisconnect.test.ts`.
- 2025-12-25: Fixed remaining ESLint issues (typed WS test helpers, removed `any`, fixed import ordering) and ran `npm run format --workspaces` to satisfy `npm run format:check --workspaces`.
- 2025-12-25: Task 1 testing step 1 complete: `npm run build --workspace server` (TypeScript build succeeded).
- 2025-12-25: Task 1 testing step 2 complete: `npm run build --workspace client` (Vite build succeeded).
- 2025-12-25: Task 1 testing step 3 complete: `npm run test --workspace server` (node:test + cucumber passed).
- 2025-12-25: Task 1 testing step 4 complete: `npm run test --workspace client` (Jest passed).
- 2025-12-25: Task 1 testing step 5 complete: `npm run e2e` (Playwright: 27 passed).
- 2025-12-25: Task 1 testing step 6 complete: `npm run compose:build` (Docker images built).
- 2025-12-25: Task 1 testing step 7 complete: `npm run compose:up` (stack started; server+client healthy).
- 2025-12-25: Task 1 testing step 8 complete: verified WS multi-tab semantics against the Compose stack using `ws://host.docker.internal:5010/ws` (Tab B catch-up snapshot; unsubscribe/resubscribe does not cancel; Stop propagates via `cancel_inflight` and both tabs receive `turn_final: stopped`).
- 2025-12-25: Task 1 testing step 9 complete: `npm run compose:down` (stack stopped).

---

### 2. Bulk conversation APIs + hard delete (server)

- Task Status: __done__
- Git Commits: 7a5a465

#### Overview

Add bulk archive/restore/delete APIs with archived-only delete guardrails and all-or-nothing semantics, plus deletion of associated turns/tool calls. This enables the client to perform multi-select actions safely and keeps persistence consistent.

#### Documentation Locations

- Mongoose transactions (atomic bulk updates/deletes; avoid Promise.all inside transaction): Context7 `/automattic/mongoose/9.0.1` (transactions)
- MongoDB transactions overview (transaction prerequisites + semantics): https://www.mongodb.com/docs/manual/core/transactions/
- Express routing (Express 5.x; bulk endpoints + error responses): Context7 `/expressjs/express/v5.1.0` (Router)
- Zod validation (request schemas; reject empty/oversized bulk requests safely): DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
- Mermaid (diagram syntax for bulk API flows and invariants): Context7 `/mermaid-js/mermaid`
- Node test runner (unit/integration tests for routes/repo): https://nodejs.org/api/test.html
- Docker Compose (local verification commands referenced in this task): https://docs.docker.com/compose/
- npm run-script (workspace build/test commands referenced in this task): https://docs.npmjs.com/cli/v10/commands/npm-run-script

#### Subtasks

1. [x] Files to read: `server/src/routes/conversations.ts`, `server/src/mongo/repo.ts`, `server/src/mongo/conversation.ts`, `server/src/mongo/turn.ts`, `server/.env`, `docker-compose.yml`, `README.md`
   - Docs (read before coding):
     - Express routing: https://expressjs.com/en/guide/routing.html
     - Mongoose transactions: https://mongoosejs.com/docs/transactions.html
     - MongoDB transactions: https://www.mongodb.com/docs/manual/core/transactions/
2. [x] Extend the conversations list API to support the 3-state sidebar filter:
   - Active (default)
   - Active & Archived (`archived=true`)
   - Archived-only (`archived=only`)
   - Keep existing `archived=true` behavior for active+archived; add archived-only without breaking older clients
   - Files to edit: `server/src/routes/conversations.ts` (query schema + handler)
   - Docs (read before coding): Express routing https://expressjs.com/en/guide/routing.html, Zod (DeepWiki) `colinhacks/zod` https://deepwiki.com/colinhacks/zod
   - Implementation sketch (query parsing):

     ```ts
     archived: z.union([z.literal('true'), z.literal('false'), z.literal('only')]).optional()
     ```

   - Done when: `GET /conversations?archived=only` returns only archived items, while `archived=true` keeps the old meaning (active + archived)
3. [x] Update the repo query logic to support archived-only mode (without relying on client-side filtering)
   - Files to edit: `server/src/mongo/repo.ts` (`listConversations`)
   - Files to read: `server/src/mongo/conversation.ts` (archivedAt field)
   - Docs (read before coding): Mongoose queries https://mongoosejs.com/docs/queries.html
   - Critical constraints (do not skip): filtering must happen server-side so pagination/cursors remain correct
4. [x] Server integration test (Node): list API default mode (Active)
   - Files to create/edit: `server/src/test/integration/conversations.list.active.test.ts`
   - Files to read: `server/src/test/integration/conversations.list.test.ts` (existing list route test harness), `server/src/routes/conversations.ts` (list route)
   - Location: `server/src/test/integration/conversations.list.active.test.ts`
   - Purpose: ensure default `GET /conversations` returns only non-archived conversations
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
5. [x] Server integration test (Node): list API include archived (`archived=true`)
   - Files to create/edit: `server/src/test/integration/conversations.list.includeArchived.test.ts`
   - Files to read: `server/src/test/integration/conversations.list.test.ts`, `server/src/routes/conversations.ts`
   - Location: `server/src/test/integration/conversations.list.includeArchived.test.ts`
   - Purpose: ensure `GET /conversations?archived=true` returns both active and archived conversations
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
6. [x] Server integration test (Node): list API archived-only (`archived=only`)
   - Files to create/edit: `server/src/test/integration/conversations.list.archivedOnly.test.ts`
   - Files to read: `server/src/test/integration/conversations.list.test.ts`, `server/src/routes/conversations.ts`, `server/src/mongo/repo.ts` (query)
   - Location: `server/src/test/integration/conversations.list.archivedOnly.test.ts`
   - Purpose: ensure `GET /conversations?archived=only` returns only archived conversations
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
7. [x] Server integration test (Node): list API `agentName=__none__` filters out agent conversations
   - Files to create/edit: `server/src/test/integration/conversations.list.agentNameNone.test.ts`
   - Files to read: `server/src/test/unit/conversations-router-agent-filter.test.ts` (existing agent filter patterns), `server/src/routes/conversations.ts`
   - Location: `server/src/test/integration/conversations.list.agentNameNone.test.ts`
   - Purpose: ensure the Chat page (which uses `agentName=__none__`) continues to hide agent conversations while still listing manual/MCP conversations
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
8. [x] Server integration test (Node): list API pagination/cursor
   - Files to create/edit: `server/src/test/integration/conversations.list.pagination.test.ts`
   - Files to read: `server/src/test/integration/conversations.list.test.ts` (cursor patterns), `server/src/routes/conversations.ts`
   - Location: `server/src/test/integration/conversations.list.pagination.test.ts`
   - Purpose: ensure cursor pagination works correctly (no duplicates/missing items) for list endpoints
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
9. [x] Add request validation for bulk operations (conversationId list, max size, dedupe/normalize, reject empty)
   - Files to edit: `server/src/routes/conversations.ts`
   - Docs (read before coding): Zod (DeepWiki) `colinhacks/zod` https://deepwiki.com/colinhacks/zod
   - Implementation sketch:

     ```ts
     const bulkSchema = z.object({ conversationIds: z.array(z.string().min(1)).min(1).max(100) }).strict();
     ```

   - Done when: empty lists are rejected with 400 and oversized requests fail fast
10. [x] Server unit test (Node): bulk validation rejects empty list
   - Files to create/edit: `server/src/test/unit/conversations.bulk.validation.empty.test.ts`
   - Files to read: `server/src/routes/conversations.ts` (bulk schema)
   - Location: `server/src/test/unit/conversations.bulk.validation.empty.test.ts`
   - Purpose: ensure `{ conversationIds: [] }` returns 400 and no DB changes occur
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, DeepWiki `colinhacks/zod` https://deepwiki.com/colinhacks/zod
11. [x] Server unit test (Node): bulk validation rejects oversized list
   - Files to create/edit: `server/src/test/unit/conversations.bulk.validation.maxSize.test.ts`
   - Files to read: `server/src/routes/conversations.ts` (max size)
   - Location: `server/src/test/unit/conversations.bulk.validation.maxSize.test.ts`
   - Purpose: ensure requests with too many IDs fail fast with 400
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
12. [x] Server unit test (Node): bulk validation handles duplicates
   - Files to create/edit: `server/src/test/unit/conversations.bulk.validation.duplicates.test.ts`
   - Files to read: `server/src/routes/conversations.ts` (dedupe/idempotency expectation)
   - Location: `server/src/test/unit/conversations.bulk.validation.duplicates.test.ts`
   - Purpose: ensure duplicate conversationIds are handled predictably (deduped or treated as idempotent no-ops)
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
13. [x] Implement `POST /conversations/bulk/archive` with all-or-nothing semantics
   - Files to edit: `server/src/routes/conversations.ts`, `server/src/mongo/repo.ts`
   - Docs (read before coding): Express routing https://expressjs.com/en/guide/routing.html
   - Critical constraints (do not skip):
     - if any conversationId is not found, reject the entire request and apply no changes
     - if a conversation is already archived, treat it as a valid no-op (idempotent) rather than failing the whole request
14. [x] Server integration test (Node): bulk archive success
   - Files to create/edit: `server/src/test/integration/conversations.bulk.archive.success.test.ts`
   - Files to read: `server/src/test/integration/conversations.archive.test.ts` (existing archive harness), `server/src/routes/conversations.ts`
   - Location: `server/src/test/integration/conversations.bulk.archive.success.test.ts`
   - Purpose: ensure all conversations are archived when all IDs exist
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
15. [x] Server integration test (Node): bulk archive idempotency
   - Files to create/edit: `server/src/test/integration/conversations.bulk.archive.idempotent.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.archive.success.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.archive.idempotent.test.ts`
   - Purpose: ensure including already-archived IDs still succeeds without double-updating timestamps incorrectly
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
16. [x] Server integration test (Node): bulk archive rejects unknown ID
   - Files to create/edit: `server/src/test/integration/conversations.bulk.archive.unknownIdRejects.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.archive.success.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.archive.unknownIdRejects.test.ts`
   - Purpose: ensure any unknown conversationId rejects the whole request and applies no changes
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
17. [x] Implement `POST /conversations/bulk/restore` with all-or-nothing semantics
   - Files to edit: `server/src/routes/conversations.ts`, `server/src/mongo/repo.ts`
   - Docs (read before coding): Express routing https://expressjs.com/en/guide/routing.html
   - Critical constraints (do not skip):
     - if any conversationId is not found, reject the entire request and apply no changes
     - if a conversation is already active (not archived), treat it as a valid no-op (idempotent) rather than failing the whole request
18. [x] Server integration test (Node): bulk restore success
   - Files to create/edit: `server/src/test/integration/conversations.bulk.restore.success.test.ts`
   - Files to read: `server/src/test/integration/conversations.archive.test.ts` (restore endpoint harness), `server/src/routes/conversations.ts`
   - Location: `server/src/test/integration/conversations.bulk.restore.success.test.ts`
   - Purpose: ensure all conversations are restored when all IDs exist
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
19. [x] Server integration test (Node): bulk restore idempotency
   - Files to create/edit: `server/src/test/integration/conversations.bulk.restore.idempotent.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.restore.success.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.restore.idempotent.test.ts`
   - Purpose: ensure including already-active IDs still succeeds without breaking list ordering
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
20. [x] Server integration test (Node): bulk restore rejects unknown ID
   - Files to create/edit: `server/src/test/integration/conversations.bulk.restore.unknownIdRejects.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.restore.success.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.restore.unknownIdRejects.test.ts`
   - Purpose: ensure any unknown conversationId rejects the whole request and applies no changes
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
21. [x] Implement `POST /conversations/bulk/delete` with all-or-nothing semantics:
   - enforce archived-only delete (reject non-archived IDs)
   - delete conversations and turns in a single transaction
   - return structured errors
   - Important (Mongoose v9): avoid parallel operations inside the transaction executor (no Promise.all); prefer single `updateMany`/`deleteMany` calls or sequential awaits (Context7 `/automattic/mongoose/9.0.1` transactions)
   - Files to edit: `server/src/routes/conversations.ts`, `server/src/mongo/repo.ts`
   - Files to read: `server/src/mongo/turn.ts` (turn deletion)
   - Docs (read before coding): Mongoose transactions https://mongoosejs.com/docs/transactions.html
   - Critical constraints (do not skip): enforce archived-only deletion in the server even if the UI is supposed to only send archived IDs
22. [x] Server integration test (Node): bulk delete success deletes turns
   - Files to create/edit: `server/src/test/integration/conversations.bulk.delete.successDeletesTurns.test.ts`
   - Files to read: `server/src/test/integration/conversations.turns.test.ts` (turn creation patterns), `server/src/routes/conversations.ts` (bulk delete)
   - Location: `server/src/test/integration/conversations.bulk.delete.successDeletesTurns.test.ts`
   - Purpose: ensure deleting archived conversations deletes the conversation record and all stored turns
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
23. [x] Server integration test (Node): bulk delete rejects non-archived IDs
   - Files to create/edit: `server/src/test/integration/conversations.bulk.delete.rejectsNonArchived.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.delete.successDeletesTurns.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.delete.rejectsNonArchived.test.ts`
   - Purpose: ensure including any non-archived conversationId rejects the entire request and deletes nothing
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
24. [x] Server integration test (Node): bulk delete rejects unknown ID
   - Files to create/edit: `server/src/test/integration/conversations.bulk.delete.unknownIdRejects.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.delete.successDeletesTurns.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.delete.unknownIdRejects.test.ts`
   - Purpose: ensure unknown conversationIds reject the entire request and delete nothing
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
25. [x] Server integration test (Node): bulk delete transaction rollback
   - Files to create/edit: `server/src/test/integration/conversations.bulk.delete.rollback.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.delete.successDeletesTurns.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.delete.rollback.test.ts`
   - Purpose: ensure if deleting turns fails, the transaction rolls back and conversations are not deleted
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html
26. [x] Update persistence helpers in `server/src/mongo/repo.ts` to support bulk operations + delete-by-conversationId
   - Files to edit: `server/src/mongo/repo.ts`
   - Docs (read before coding): Mongoose docs https://mongoosejs.com/
27. [x] Emit corresponding `conversation_upsert` / `conversation_delete` WS events only after a successful bulk transaction commit
   - Files to edit: `server/src/routes/conversations.ts`
   - Files to edit: `server/src/ws/hub.ts` (event emission API)
   - Docs (read before coding): Context7 `/websockets/ws/8_18_3`
   - Protocol reminder (ordering requirement): emit WS events only after the bulk transaction commits successfully; do not emit partial updates.
28. [x] Server integration test (Node): bulk archive emits WS upsert after commit
   - Files to create/edit: `server/src/test/integration/conversations.bulk.wsEvents.archiveAfterCommit.test.ts`
   - Files to read: `server/src/test/integration/ws.sidebar.subscribeUnsubscribe.test.ts` (WS harness), `server/src/routes/conversations.ts` (transaction boundary), `server/src/ws/hub.ts` (emit)
   - Location: `server/src/test/integration/conversations.bulk.wsEvents.archiveAfterCommit.test.ts`
   - Purpose: ensure WS `conversation_upsert` is emitted only after a successful bulk archive commit
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`

29. [x] Server integration test (Node): bulk restore emits WS upsert after commit
   - Files to create/edit: `server/src/test/integration/conversations.bulk.wsEvents.restoreAfterCommit.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.wsEvents.archiveAfterCommit.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.wsEvents.restoreAfterCommit.test.ts`
   - Purpose: ensure WS `conversation_upsert` is emitted only after a successful bulk restore commit
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
30. [x] Server integration test (Node): bulk delete emits WS delete after commit
   - Files to create/edit: `server/src/test/integration/conversations.bulk.wsEvents.deleteAfterCommit.test.ts`
   - Files to read: `server/src/test/integration/conversations.bulk.wsEvents.archiveAfterCommit.test.ts`
   - Location: `server/src/test/integration/conversations.bulk.wsEvents.deleteAfterCommit.test.ts`
   - Purpose: ensure WS `conversation_delete` is emitted only after a successful bulk delete commit
   - Docs (read before coding): Node test runner https://nodejs.org/api/test.html, Context7 `/websockets/ws/8_18_3`
31. [x] Update default Mongo URI(s) used by server + Compose to settings needed for transactions:
   - audit and update at least: `server/.env`, `.env.docker.example`, `.env.e2e`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, `README.md`
   - Important: keep `directConnection=true` (transactions work with it; replica-set discovery fails without it due to the current rs member host being `localhost:27017`). Optionally add `replicaSet=rs0` explicitly alongside `directConnection=true`.
   - Files to edit: `server/.env`, `.env.docker.example`, `.env.e2e`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, `README.md`
   - Docs (read before coding): MongoDB transactions https://www.mongodb.com/docs/manual/core/transactions/
   - Critical constraints (do not skip): do not remove `directConnection=true` until the replica-set host config is fixed
32. [x] Update docs: `design.md` (bulk archive/restore/delete flows + invariants as Mermaid diagrams)
   - Files to edit: `design.md`
   - Location: `design.md`
   - Description: add/update Mermaid diagrams describing bulk endpoints, transaction boundaries, invariants, and emitted WS list events
   - Purpose: document the new bulk APIs, all-or-nothing semantics, delete guardrails, and emitted WS list events as a Mermaid flow diagram
   - Docs (read before doing): Mermaid (Context7) `/mermaid-js/mermaid`, Markdown basics https://www.markdownguide.org/basic-syntax/
33. [x] Update docs: `README.md` (bulk endpoints + 3-state list query)
   - Files to edit: `README.md`
   - Location: `README.md`
   - Description: add/update README sections so developers can discover and use the new conversation list modes and bulk endpoints
   - Purpose: describe the new `GET /conversations?archived=only` mode and the bulk endpoints so developers can call the correct APIs
   - Docs (read before doing): Markdown basics https://www.markdownguide.org/basic-syntax/
34. [x] Update docs: `projectStructure.md` (new server bulk route/repo/test files)
   - Files to edit: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: add every new/moved/removed server file created in Task 2 (bulk routes, list query extensions, and tests)
   - Required file list (must be complete; update based on what you actually created):
     - New server Node integration tests:
       - `server/src/test/integration/conversations.list.active.test.ts`
       - `server/src/test/integration/conversations.list.includeArchived.test.ts`
       - `server/src/test/integration/conversations.list.archivedOnly.test.ts`
       - `server/src/test/integration/conversations.list.agentNameNone.test.ts`
       - `server/src/test/integration/conversations.list.pagination.test.ts`
       - `server/src/test/integration/conversations.bulk.archive.success.test.ts`
       - `server/src/test/integration/conversations.bulk.archive.idempotent.test.ts`
       - `server/src/test/integration/conversations.bulk.archive.unknownIdRejects.test.ts`
       - `server/src/test/integration/conversations.bulk.restore.success.test.ts`
       - `server/src/test/integration/conversations.bulk.restore.idempotent.test.ts`
       - `server/src/test/integration/conversations.bulk.restore.unknownIdRejects.test.ts`
       - `server/src/test/integration/conversations.bulk.delete.successDeletesTurns.test.ts`
       - `server/src/test/integration/conversations.bulk.delete.rejectsNonArchived.test.ts`
       - `server/src/test/integration/conversations.bulk.delete.unknownIdRejects.test.ts`
       - `server/src/test/integration/conversations.bulk.delete.rollback.test.ts`
       - `server/src/test/integration/conversations.bulk.wsEvents.archiveAfterCommit.test.ts`
       - `server/src/test/integration/conversations.bulk.wsEvents.restoreAfterCommit.test.ts`
       - `server/src/test/integration/conversations.bulk.wsEvents.deleteAfterCommit.test.ts`
     - New server Node unit tests:
       - `server/src/test/unit/conversations.bulk.validation.empty.test.ts`
       - `server/src/test/unit/conversations.bulk.validation.maxSize.test.ts`
       - `server/src/test/unit/conversations.bulk.validation.duplicates.test.ts`
     - Removed files: none expected (if you delete/move anything, list it explicitly)
   - Purpose: keep the repo structure map accurate and make bulk API/test additions discoverable for onboarding
   - Docs (read before doing): Markdown basics https://www.markdownguide.org/basic-syntax/
35. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix --workspaces`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Files to read: `package.json`, `client/package.json`, `server/package.json`, `eslint.config.js`, `.prettierrc`
   - Commands: `npm run lint --workspaces`, `npm run format:check --workspaces`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script, ESLint CLI https://eslint.org/docs/latest/use/command-line-interface, Prettier CLI https://prettier.io/docs/en/cli.html
#### Testing

1. [x] `npm run build --workspace server`
   - Files to read: `package.json`, `server/package.json`
   - Command: `npm run build --workspace server`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Files to read: `package.json`, `client/package.json`
   - Command: `npm run build --workspace client`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Files to read: `server/package.json`, `server/src/test/`
   - Command: `npm run test --workspace server`
   - Docs (read before doing): Node test runner https://nodejs.org/api/test.html, Cucumber guides https://cucumber.io/docs/guides/
4. [x] `npm run test --workspace client`
   - Files to read: `client/package.json`, `client/src/test/`
   - Command: `npm run test --workspace client`
   - Docs (read before doing): Jest (Context7) `/websites/jestjs_io_30_0`, Testing Library https://testing-library.com/docs/react-testing-library/intro/
5. [x] `npm run e2e`
   - Files to read: `package.json`, `playwright.config.ts`, `e2e/`, `.env.e2e`, `docker-compose.e2e.yml`
   - Command: `npm run e2e`
   - Docs (read before doing): Playwright (Context7) `/microsoft/playwright.dev`, Docker Compose https://docs.docker.com/compose/
6. [x] `npm run compose:build`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:build`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/, npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
7. [x] `npm run compose:up`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`, `README.md` (ports: client 5001, server 5010)
   - Command: `npm run compose:up`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/
8. [x] Manual Playwright-MCP check (Task 2 focus: bulk archive/restore/delete semantics + WS list updates)
   - Files to read: `planning/0000019-chat-page-ux.md` (Acceptance Criteria), `README.md` (URLs/ports)
   - Manual checks (minimum):
     - Start the stack and open http://localhost:5001.
     - In `Active` mode, create at least 2 conversations, then bulk-archive them and confirm they disappear from `Active` and appear in `Archived` views.
     - Bulk-restore from the `Archived` view and confirm they return to `Active`.
     - Attempt permanent delete on a non-archived conversation and confirm the server rejects it (no partial deletes).
     - Confirm the sidebar updates live (upsert/delete events) after bulk actions without a refresh.
   - Docs (read before doing): Playwright https://playwright.dev/docs/intro
9. [x] `npm run compose:down`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:down`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/

#### Implementation notes

- 2025-12-25: Marked Task 2 as __in_progress__ and began implementation.
- 2025-12-25: Reviewed existing conversations routes/repo/models, WS hub events, and Mongo URI configuration to align bulk APIs with current patterns.
- 2025-12-25: Extended `GET /conversations` to accept `archived=only` (archived-only mode) while preserving existing `archived=true` semantics; added server-side filtering support in `listConversations` so pagination remains correct.
- 2025-12-25: Added Node route-level tests covering the new list modes (active-only default, include archived, archived-only), `agentName=__none__`, and cursor pagination behavior.
- 2025-12-25: Added Zod validation + normalization for bulk endpoints (non-empty, max 100 IDs, dedupe) and unit tests for empty/oversized/duplicate requests.
- 2025-12-25: Added bulk conversation endpoints: `POST /conversations/bulk/archive`, `POST /conversations/bulk/restore`, `POST /conversations/bulk/delete` with all-or-nothing semantics (unknown IDs reject the whole request; delete enforces archived-only).
- 2025-12-25: Implemented Mongoose-transaction-backed repo helpers for bulk archive/restore/delete; delete removes associated turns before deleting conversation records.
- 2025-12-25: Added server tests for bulk archive/restore behavior, and repo-level tests ensuring delete removes turns and rejects non-archived/unknown IDs; added WS tests proving sidebar `conversation_upsert`/`conversation_delete` emit only after the bulk handler awaits the repo transaction.
- 2025-12-25: Audited Mongo URI defaults across `.env` and Compose files; they already retain `directConnection=true` and Compose runs Mongo as a replica set, so no additional URI changes were required for transactions.
- 2025-12-25: Updated `design.md` with Mermaid documentation for bulk list modes, transaction boundaries, invariants, and post-commit WS sidebar events.
- 2025-12-25: Updated `README.md` with the new 3-state conversation list query (`archived=true|only`) and the bulk archive/restore/delete endpoints.
- 2025-12-25: Updated `projectStructure.md` to include the new server bulk/list tests.
- 2025-12-25: Ran workspace lint + Prettier checks; fixed formatting issues via `npm run format --workspace server`.
- 2025-12-25: Testing: `npm run build --workspace server` passed.
- 2025-12-25: Testing: `npm run build --workspace client` passed.
- 2025-12-25: Testing: `npm run test --workspace server` passed.
- 2025-12-25: Testing: `npm run test --workspace client` passed.
- 2025-12-25: Testing: `npm run e2e` passed (fixed ingest cleanup to tolerate missing Chroma collections during root removal).
- 2025-12-25: Testing: `npm run compose:build` passed.
- 2025-12-25: Testing: `npm run compose:up` passed.
- 2025-12-25: Testing: manual bulk API + WS check passed against `http://host.docker.internal:5010` / `ws://host.docker.internal:5010/ws` (bulk archive/restore/delete + archived-only guardrail).
- 2025-12-25: Testing: `npm run compose:down` passed.

---

### 3. Conversation sidebar filter + multi-select + bulk actions (client)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add a 3-state filter, checkbox multi-select, and bulk archive/restore/delete UI to the Chat sidebar with proper confirmation and persistence gating. This enables efficient conversation management without leaving the Chat page.

#### Documentation Locations

- MUI List component (layout for conversation rows): https://llms.mui.com/material-ui/6.4.12/components/lists.md
- MUI Checkbox component (multi-select + indeterminate select-all): https://llms.mui.com/material-ui/6.4.12/components/checkboxes.md
- MUI Dialog component (permanent delete confirmation): https://llms.mui.com/material-ui/6.4.12/components/dialogs.md
- MUI ToggleButton/ToggleButtonGroup (3-state filter control): https://llms.mui.com/material-ui/6.4.12/components/toggle-button.md
- MUI Toolbar API (bulk action toolbar): https://llms.mui.com/material-ui/6.4.12/api/toolbar.md
- MUI Alert (error/success messaging): https://llms.mui.com/material-ui/6.4.12/components/alert.md
- MUI Snackbar (optional lightweight “toast” notifications): https://llms.mui.com/material-ui/6.4.12/components/snackbars.md
- React state + effects (selection state + filter transitions): https://react.dev/learn
- Fetch API (calling bulk endpoints): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- URLSearchParams (building the conversations list query string): https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
- Testing Library (RTL patterns for UI behavior tests): https://testing-library.com/docs/react-testing-library/intro/
- Jest (Jest 30 docs; test runner used by the client workspace): Context7 `/websites/jestjs_io_30_0`
- Mermaid (diagram syntax for sidebar/bulk UX flow): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Files to read: `client/src/components/chat/ConversationList.tsx`, `client/src/hooks/useConversations.ts`, `client/src/hooks/usePersistenceStatus.ts`, `client/src/pages/ChatPage.tsx`, `client/src/api/*`
   - Reuse/reference patterns from: `client/src/components/ingest/RootsTable.tsx` (checkbox multi-select + bulk action toolbar + indeterminate select-all)
   - Note: the existing chat sidebar is already implemented in `client/src/components/chat/ConversationList.tsx` using MUI `List` + a `Switch` filter; extend/refactor this component rather than introducing a new sidebar list implementation
   - Docs (read before coding):
     - Lists: https://llms.mui.com/material-ui/6.4.12/components/lists.md
     - Checkboxes: https://llms.mui.com/material-ui/6.4.12/components/checkboxes.md
     - Dialogs: https://llms.mui.com/material-ui/6.4.12/components/dialogs.md
     - ToggleButtonGroup: https://llms.mui.com/material-ui/6.4.12/components/toggle-button.md
     - React state/effects: https://react.dev/learn
2. [ ] Implement 3-state filter UI (`Active`, `Active & Archived`, `Archived`) and ensure selection clears on filter change
   - Files to edit: `client/src/components/chat/ConversationList.tsx`
   - Docs (read before coding):
     - ToggleButtonGroup: https://llms.mui.com/material-ui/6.4.12/components/toggle-button.md
     - React state: https://react.dev/learn/state-a-components-memory
   - Critical constraints (do not skip): selection must clear when switching the filter so bulk actions cannot apply to “hidden” items
3. [ ] Refactor the conversations list fetch logic to support all 3 filter modes (Active default, `archived=true`, `archived=only`) without breaking pagination
   - Files to edit: `client/src/hooks/useConversations.ts`
   - Docs (read before coding): URLSearchParams https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Critical constraints (do not skip): do not do client-side archived filtering for archived-only mode because it breaks cursor pagination
4. [ ] Add checkbox multi-select per conversation row and an indeterminate select-all control for the current view (reuse RootsTable patterns)
   - Files to edit: `client/src/components/chat/ConversationList.tsx`
   - Files to read: `client/src/components/ingest/RootsTable.tsx` (indeterminate select-all + selection set patterns)
   - Docs (read before coding): Checkboxes https://llms.mui.com/material-ui/6.4.12/components/checkboxes.md, Lists https://llms.mui.com/material-ui/6.4.12/components/lists.md
   - Critical constraints (do not skip): multi-select must not break single-select “open conversation” behavior
5. [ ] Add a bulk action toolbar with context-appropriate actions:
   - Active / Active & Archived: bulk archive
   - Archived: bulk restore + bulk permanent delete
   - Files to edit: `client/src/components/chat/ConversationList.tsx`
   - Docs (read before coding): MUI Toolbar https://llms.mui.com/material-ui/6.4.12/api/toolbar.md
   - Critical constraints (do not skip): only show actions that are valid for the current filter view
6. [ ] Implement a permanent delete confirmation dialog (explicit user confirmation before calling the server)
   - Files to edit: `client/src/components/chat/ConversationList.tsx` (or extract a small dialog component under `client/src/components/chat/`)
   - Docs (read before coding): Dialogs https://llms.mui.com/material-ui/6.4.12/components/dialogs.md
   - Critical constraints (do not skip): deleting must require explicit confirmation every time (no “silent delete”)
7. [ ] Ensure selection is retained across sidebar live updates (upserts/resorts) and that bulk actions do not force-refresh the currently visible transcript mid-view
   - Files to edit: `client/src/components/chat/ConversationList.tsx`, `client/src/pages/ChatPage.tsx`
   - Docs (read before coding): React state https://react.dev/learn/state-a-components-memory
   - Critical constraints (do not skip): selection should be keyed by `conversationId` (stable) not by array index
8. [ ] Add API helpers for bulk endpoints and wire optimistic UI updates + toast/error handling (ensure all-or-nothing rejection leaves UI unchanged)
   - Files to create: `client/src/api/conversations.ts`
   - Files to edit: `client/src/hooks/useConversations.ts` (expose bulk helpers or call helpers from Chat page)
   - Files to edit: `client/src/pages/ChatPage.tsx` (trigger bulk ops and surface success/error)
   - Docs (read before coding): Fetch API https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
   - Note (repo reality): there is no shared “toast” helper today; implement a simple MUI `Snackbar`+`Alert` in Chat page or ConversationList if you need transient confirmations
9. [ ] Confirm UX for “open conversation included in bulk action”:
   - conversation is removed/moved in the sidebar, toast confirms action
   - transcript remains stable (no forced refresh) until user navigates
   - Files to edit: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useConversationTurns.ts`
   - Docs (read before coding): React state https://react.dev/learn
   - Critical constraints (do not skip): do not automatically navigate away or clear the transcript when the selected conversation is archived/deleted by a bulk action
10. [ ] Disable bulk actions and show clear messaging when `mongoConnected === false`
   - Files to edit: `client/src/hooks/usePersistenceStatus.ts`, `client/src/components/chat/ConversationList.tsx`
   - Docs (read before coding): Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
   - Critical constraints (do not skip): when persistence is disabled, bulk operations must be disabled in the UI (and ideally avoided on the server too)
11. [ ] Client RTL test (Jest + Testing Library): filter default is `Active`
   - Files to edit/create: `client/src/test/chatSidebar.test.tsx`
   - Files to read: `client/src/components/chat/ConversationList.tsx` (UI under test), `client/src/test/chatSidebar.test.tsx` (existing harness)
   - Location: `client/src/test/chatSidebar.test.tsx`
   - Purpose: ensure initial filter state is `Active` and archived conversations are not shown
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/, Jest (Context7) `/websites/jestjs_io_30_0`
12. [ ] Client RTL test (Jest + Testing Library): changing filter clears selection
   - Files to edit/create: `client/src/test/chatSidebar.test.tsx`
   - Files to read: `client/src/components/chat/ConversationList.tsx`, `client/src/test/chatSidebar.test.tsx`
   - Location: `client/src/test/chatSidebar.test.tsx`
   - Purpose: prevent bulk actions from applying to “hidden” conversations after filter changes
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/, Jest (Context7) `/websites/jestjs_io_30_0`
13. [ ] Client RTL test (Jest + Testing Library): Archived view uses `archived=only` query
   - Files to edit/create: `client/src/test/chatSidebar.test.tsx`
   - Files to read: `client/src/hooks/useConversations.ts` (query building), `client/src/test/useConversations.source.test.ts` (hook test patterns)
   - Location: `client/src/test/chatSidebar.test.tsx`
   - Purpose: ensure the client fetches archived-only server-side (no client-side filtering that would break pagination)
   - Docs (read before coding): URLSearchParams https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams, Jest (Context7) `/websites/jestjs_io_30_0`
14. [ ] Client RTL test (Jest + Testing Library): Chat sidebar list request includes `agentName=__none__`
   - Files to edit/create: `client/src/test/chatSidebar.agentFilterQuery.test.tsx` (new) or extend `client/src/test/chatSidebar.test.tsx`
   - Files to read: `client/src/pages/ChatPage.tsx` (Chat uses `agentName=__none__`), `client/src/hooks/useConversations.ts` (query params)
   - Location: `client/src/test/chatSidebar.agentFilterQuery.test.tsx` (new) or extend `client/src/test/chatSidebar.test.tsx`
   - Purpose: ensure the Chat sidebar continues to exclude agent conversations by using the server-side `agentName=__none__` filter
   - Docs (read before coding): URLSearchParams https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams, Testing Library https://testing-library.com/docs/react-testing-library/intro/, Jest (Context7) `/websites/jestjs_io_30_0`
15. [ ] Client RTL test (Jest + Testing Library): checkbox selection + select-all + indeterminate state
   - Files to edit/create: `client/src/test/chatSidebar.test.tsx`
   - Files to read: `client/src/components/ingest/RootsTable.tsx` (indeterminate select-all pattern), `client/src/components/chat/ConversationList.tsx`
   - Location: `client/src/test/chatSidebar.test.tsx`
   - Purpose: verify multi-select behavior matches RootsTable patterns and stays consistent when list re-renders
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/, MUI Checkbox https://llms.mui.com/material-ui/6.4.12/components/checkboxes.md
16. [ ] Client RTL test (Jest + Testing Library): bulk archive success updates list and shows confirmation
   - Files to edit/create: `client/src/test/chatSidebar.test.tsx`
   - Files to read: `client/src/api/conversations.ts` (bulk API helper), `client/src/components/chat/ConversationList.tsx` (bulk UI)
   - Location: `client/src/test/chatSidebar.test.tsx`
   - Purpose: verify bulk archive action calls the bulk endpoint and the UI updates for the selected items
   - Docs (read before coding): Fetch API https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, MUI Snackbar https://llms.mui.com/material-ui/6.4.12/components/snackbars.md
17. [ ] Client RTL test (Jest + Testing Library): bulk action rejection leaves UI unchanged
   - Files to edit/create: `client/src/test/chatSidebar.test.tsx`
   - Files to read: `client/src/api/conversations.ts`, `client/src/test/chatSidebar.test.tsx`
   - Location: `client/src/test/chatSidebar.test.tsx`
   - Purpose: verify all-or-nothing failures do not partially update list state or clear selection
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
18. [ ] Client RTL test (Jest + Testing Library): permanent delete requires confirmation dialog
   - Files to edit/create: `client/src/test/chatSidebar.test.tsx`
   - Files to read: `client/src/components/chat/ConversationList.tsx` (dialog wiring)
   - Location: `client/src/test/chatSidebar.test.tsx`
   - Purpose: ensure delete is never triggered without explicit user confirmation
   - Docs (read before coding): MUI Dialog https://llms.mui.com/material-ui/6.4.12/components/dialogs.md
19. [ ] Client RTL test (Jest + Testing Library): open conversation included in bulk action does not clear transcript
   - Files to edit/create: `client/src/test/chatPage.provider.conversationSelection.test.tsx`
   - Files to read: `client/src/pages/ChatPage.tsx` (selection + transcript), `client/src/hooks/useConversationTurns.ts` (transcript fetch)
   - Location: `client/src/test/chatPage.provider.conversationSelection.test.tsx`
   - Purpose: ensure bulk archive/delete does not force-refresh or clear the transcript mid-view
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
20. [ ] Client RTL test (Jest + Testing Library): persistence gating disables bulk controls
   - Files to edit/create: `client/src/test/chatPersistenceBanner.test.tsx`
   - Files to read: `client/src/hooks/usePersistenceStatus.ts` (health fetch), `client/src/components/chat/ConversationList.tsx` (disabled UI state)
   - Location: `client/src/test/chatPersistenceBanner.test.tsx`
   - Purpose: ensure when `mongoConnected === false` the bulk UI is disabled and a clear message is shown
   - Docs (read before coding): MUI Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
21. [ ] Update docs: `design.md` (sidebar multi-select + 3-state filter UX flow as Mermaid diagrams)
   - Files to edit: `design.md`
   - Location: `design.md`
   - Description: add/update Mermaid diagrams describing the sidebar filter states, selection model, bulk actions, and confirmation flow
   - Purpose: document the client-side sidebar interaction flow (filter state, selection state, confirmation dialog, and bulk action calls) as Mermaid diagrams
   - Docs (read before doing): Mermaid (Context7) `/mermaid-js/mermaid`, Markdown basics https://www.markdownguide.org/basic-syntax/
22. [ ] Update docs: `projectStructure.md` (new client sidebar/bulk files and tests)
   - Files to edit: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: add every new/moved/removed client file created in Task 3 (sidebar 3-state filter + multi-select + bulk actions + tests)
   - Required file list (must be complete; update based on what you actually created):
     - New client API module (if created as planned): `client/src/api/conversations.ts`
     - New client Jest tests (if created as separate files): `client/src/test/chatSidebar.agentFilterQuery.test.tsx`
     - Removed files: none expected (if you delete/move anything, list it explicitly)
   - Purpose: keep the repo structure map accurate and make client bulk-sidebar additions discoverable for onboarding
   - Docs (read before doing): Markdown basics https://www.markdownguide.org/basic-syntax/
23. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix --workspaces`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Files to read: `package.json`, `client/package.json`, `server/package.json`, `eslint.config.js`, `.prettierrc`
   - Commands: `npm run lint --workspaces`, `npm run format:check --workspaces`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script, ESLint CLI https://eslint.org/docs/latest/use/command-line-interface, Prettier CLI https://prettier.io/docs/en/cli.html
#### Testing

1. [ ] `npm run build --workspace server`
   - Files to read: `package.json`, `server/package.json`
   - Command: `npm run build --workspace server`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Files to read: `package.json`, `client/package.json`
   - Command: `npm run build --workspace client`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Files to read: `server/package.json`, `server/src/test/`
   - Command: `npm run test --workspace server`
   - Docs (read before doing): Node test runner https://nodejs.org/api/test.html, Cucumber guides https://cucumber.io/docs/guides/
4. [ ] `npm run test --workspace client`
   - Files to read: `client/package.json`, `client/src/test/`
   - Command: `npm run test --workspace client`
   - Docs (read before doing): Jest (Context7) `/websites/jestjs_io_30_0`, Testing Library https://testing-library.com/docs/react-testing-library/intro/
5. [ ] `npm run e2e`
   - Files to read: `package.json`, `playwright.config.ts`, `e2e/`, `.env.e2e`, `docker-compose.e2e.yml`
   - Command: `npm run e2e`
   - Docs (read before doing): Playwright (Context7) `/microsoft/playwright.dev`, Docker Compose https://docs.docker.com/compose/
6. [ ] `npm run compose:build`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:build`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/, npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
7. [ ] `npm run compose:up`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`, `README.md` (ports: client 5001, server 5010)
   - Command: `npm run compose:up`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/
8. [ ] Manual Playwright-MCP check (Task 3 focus: sidebar filter + multi-select + bulk UI behavior)
   - Files to read: `planning/0000019-chat-page-ux.md` (Acceptance Criteria), `README.md` (URLs/ports)
   - Manual checks (minimum):
     - Start the stack and open http://localhost:5001.
     - Verify the 3-state filter changes the list correctly and clears selection when switching filter.
     - Verify multi-select: select-all/indeterminate behavior, and that bulk action buttons enable/disable correctly.
     - Verify permanent delete shows a confirmation dialog and never deletes without explicit confirmation.
     - Verify when persistence is unavailable (`mongoConnected=false` banner), bulk controls are disabled.
   - Docs (read before doing): Playwright https://playwright.dev/docs/intro
9. [ ] `npm run compose:down`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:down`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/

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
- React effects (subscribe/unsubscribe lifecycle): https://react.dev/learn/synchronizing-with-effects
- React Router (navigation + route scoping): Context7 `/remix-run/react-router/react-router_7.9.4` (hooks + navigation)
- Fetch API (POST /chat, bulk refreshes on reconnect): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- AbortController (detaching SSE without cancelling generation when `cancelOnDisconnect=false`): https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- MUI Alert (persistence gating messaging): https://llms.mui.com/material-ui/6.4.12/components/alert.md
- MUI Snackbar (optional lightweight “toast” confirmations): https://llms.mui.com/material-ui/6.4.12/components/snackbars.md
- Testing Library (WS subscription + UI behavior tests): https://testing-library.com/docs/react-testing-library/intro/
- Jest (Jest 30 docs; test runner used by the client workspace): Context7 `/websites/jestjs_io_30_0`
- Mermaid (diagram syntax for Chat WS subscribe/catch-up flow and Stop/detach semantics): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Files to read: `client/src/hooks/useChatStream.ts`, `client/src/hooks/useConversations.ts`, `client/src/hooks/useConversationTurns.ts`, `client/src/pages/ChatPage.tsx`, `client/src/api/*`
   - Reuse/reference patterns from: `client/src/logging/transport.ts` (backoff/retry pacing) and `client/src/hooks/useLogs.ts` (SSE reconnect + subscription lifecycle patterns, even though WS is different)
   - Docs (read before coding):
     - MDN WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - React effects: https://react.dev/learn/synchronizing-with-effects
     - React Router (repo uses `react-router-dom@7.9.6`): Context7 `/remix-run/react-router/react-router_7.9.4`
     - This story’s WS protocol section (in this file)
2. [ ] Create a WebSocket hook/service (e.g., `client/src/hooks/useChatWs.ts`) with connect/disconnect, requestId generation, and safe JSON send
   - Files to create: `client/src/hooks/useChatWs.ts`
   - Files to read: `client/src/hooks/useChatStream.ts` (serverBase URL pattern)
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Implementation sketch (derive ws URL from serverBase):

     ```ts
     const httpUrl = new URL('/ws', serverBase);
     httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
     const ws = new WebSocket(httpUrl.toString());
     ```

   - Critical constraints (do not skip): always guard JSON parse and keep the socket closed on unmount to prevent leaks
3. [ ] Add reconnect strategy (backoff + jitter) and ensure event handlers are resilient to reconnect storms (reuse `client/src/logging/transport.ts` pacing patterns)
   - Files to edit: `client/src/hooks/useChatWs.ts`
   - Files to read: `client/src/logging/transport.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Done when: temporary disconnects reconnect automatically without freezing the UI
4. [ ] Implement subscribe/unsubscribe helpers for `subscribe_sidebar`, `unsubscribe_sidebar`, `subscribe_conversation`, `unsubscribe_conversation`
   - Files to edit: `client/src/hooks/useChatWs.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (client messages):
     - Sidebar: `{ type: 'subscribe_sidebar', requestId }` / `{ type: 'unsubscribe_sidebar', requestId }`
     - Transcript: `{ type: 'subscribe_conversation', requestId, conversationId }` / `{ type: 'unsubscribe_conversation', requestId, conversationId }`
   - Implementation sketch:

     ```ts
     ws.send(JSON.stringify({ type: 'subscribe_sidebar', requestId }));
     ws.send(JSON.stringify({ type: 'subscribe_conversation', requestId, conversationId }));
     ```
5. [ ] Gate realtime features on persistence: when `mongoConnected === false`, do not subscribe to sidebar/transcript updates; surface a clear message that realtime updates/catch-up require persistence (keep cancellation working for the active run)
   - Files to edit: `client/src/pages/ChatPage.tsx`, `client/src/hooks/usePersistenceStatus.ts`
   - Docs (read before coding): Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
   - Critical constraints (do not skip): gating applies to both sidebar + transcript WS subscriptions
6. [ ] Implement sidebar subscription lifecycle tied to Chat route mount/unmount:
   - subscribe on mount
   - unsubscribe on unmount
   - on reconnect: refresh the list snapshot before resubscribing
   - Files to edit: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useConversations.ts`, `client/src/hooks/useChatWs.ts`
   - Docs (read before coding): React effects https://react.dev/learn/synchronizing-with-effects
   - Critical constraints (do not skip): on reconnect, always refresh REST list first, then apply WS deltas
7. [ ] Implement transcript subscription lifecycle for the active conversation:
   - unsubscribe previous conversationId when switching
   - subscribe newly visible conversationId
   - on reconnect: re-fetch visible conversation turns snapshot before resubscribing
   - Files to edit: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useConversationTurns.ts`, `client/src/hooks/useChatWs.ts`
   - Docs (read before coding): React effects https://react.dev/learn/synchronizing-with-effects
   - Critical constraints (do not skip): transcript subscription must be scoped to the currently visible conversation only
8. [ ] Implement inflight snapshot merge logic so the transcript merges persisted turns + one in-flight turn (including current tool state)
   - Files to edit: `client/src/pages/ChatPage.tsx` (render pipeline), `client/src/hooks/useChatStream.ts` (message/tool shaping helpers)
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (what you will receive while subscribed):
     - Initial catch-up: `inflight_snapshot` includes `{ conversationId, inflightId, assistantText, analysisText, tools: [...] }`.
     - Updates: `assistant_delta` / `analysis_delta` append text; `tool_event` updates current tool states; `turn_final` ends the inflight.
   - Implementation sketch (high level):
     - persisted turns come from `useConversationTurns`
     - WS inflight state becomes one synthetic “assistant” message at the end of the transcript
9. [ ] Handle `assistant_delta` and `tool_event` updates while subscribed so the transcript matches the originating tab
   - Files to edit: `client/src/hooks/useChatWs.ts`, `client/src/pages/ChatPage.tsx`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder: updates must be applied in-place to the current inflight UI for the active `{ conversationId, inflightId }`.
   - Critical constraints (do not skip): update the same in-flight message/tool rows in-place (don’t append a new message per event)
10. [ ] Handle `analysis_delta` updates so Codex reasoning state renders identically when a user switches tabs mid-run
   - Files to edit: `client/src/hooks/useChatWs.ts`, `client/src/hooks/useChatStream.ts` (reuse reasoning parser)
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder: `analysis_delta` should update the same analysis panel state used by SSE reasoning rendering.
   - Critical constraints (do not skip): analysis text must remain hidden/collapsible exactly like the current SSE reasoning renderer
11. [ ] Apply client-side sequence guards:
   - sidebar events: ignore out-of-order `seq` updates
   - transcript events: ignore out-of-order `seq` per conversationId
   - Files to edit: `client/src/hooks/useChatWs.ts`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder: every inbound server event includes a `seq` and the client must ignore events with `seq <= lastSeen` for that stream.
   - Done when: rapid switching does not cause “old events” to overwrite newer UI state
12. [ ] Update `useChatStream.send()` to generate a client-side `inflightId` per turn, include it in `POST /chat` payloads, and pass `cancelOnDisconnect=false`; store `inflightId` for cancellation
   - Files to edit: `client/src/hooks/useChatStream.ts`
   - Docs (read before coding): Fetch API https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Critical constraints (do not skip): `cancelOnDisconnect=false` must only be used for Chat UI streaming requests (so navigating away detaches without canceling)
13. [ ] Cache `inflightId` for the visible conversation from inbound WS events (`inflight_snapshot` / deltas / tool events) so Stop can cancel runs started outside the current tab
   - Files to edit: `client/src/hooks/useChatWs.ts`, `client/src/pages/ChatPage.tsx`
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder: every transcript event includes `conversationId` and `inflightId`; cache the latest inflightId per conversation so Stop can target it.
   - Done when: Stop works even if this tab did not start the run
14. [ ] Update Stop behavior to cancel via `conversationId` + `inflightId` without relying on SSE abort side-effects:
   - Primary: send `cancel_inflight` over WS
   - Fallback (de-risk): if WS is disconnected, call `POST /chat/cancel`
   - Files to edit: `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`, `client/src/pages/ChatPage.tsx`, `client/src/api/*`
   - Docs (read before coding): Fetch API https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (cancel payloads):
     - WS: `{ type: 'cancel_inflight', requestId, conversationId, inflightId }`
     - HTTP fallback: `POST /chat/cancel` body `{ conversationId, inflightId }`
   - Critical constraints (do not skip): Stop is the only user action that should cancel generation; switching/navigating must not cancel
15. [ ] Refactor non-Stop flows so they do not cancel generation:
   - switching conversations unsubscribes from the prior transcript stream and subscribes to the new one
   - leaving the Chat route unsubscribes from sidebar/transcript streams
   - any SSE abort used to detach should not send `cancel_inflight` (only explicit Stop should cancel)
   - Files to edit: `client/src/pages/ChatPage.tsx` (the unmount effect currently calls `stop()`), `client/src/hooks/useChatStream.ts` (`setConversation` currently calls `stop()`)
   - Docs (read before coding): story “Current streaming behavior (today)” section in this doc
   - Critical constraints (do not skip): detaching should abort the SSE fetch (to stop reading) but must not trigger cancellation unless the user pressed Stop
16. [ ] Update “New conversation” behavior: if a run is in-flight, cancel it (WS `cancel_inflight`, with REST `POST /chat/cancel` fallback) then clear transcript state while keeping the existing model/provider rules
   - Files to edit: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`
   - Docs (read before coding): Fetch API https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (cancel payloads):
     - WS: `{ type: 'cancel_inflight', requestId, conversationId, inflightId }`
     - HTTP fallback: `POST /chat/cancel` body `{ conversationId, inflightId }`
17. [ ] Restore Codex `threadId` from persisted conversation flags when selecting/hydrating an existing conversation so continuation works across reloads/tabs (the list API already returns `flags`)
   - Files to edit: `client/src/hooks/useChatStream.ts` (add a way to set threadId when selecting a conversation), `client/src/pages/ChatPage.tsx` (read `selectedConversation.flags.threadId`)
   - Files to read: `client/src/hooks/useConversations.ts` (flags already exist on list items)
   - Docs (read before coding): this story’s “Current streaming behavior (today)” section (in this file)
   - Critical constraints (do not skip): do not reset threadId to null when switching to an existing Codex conversation; the whole point is to resume the same Codex thread
18. [ ] Ensure Chat sidebar realtime updates remain scoped correctly (e.g., ignore `agentName` conversations if Chat view is `agentName=__none__`)
   - Files to edit: `client/src/hooks/useChatWs.ts`, `client/src/hooks/useConversations.ts`
   - Files to read: `server/src/mongo/repo.ts` (`agentName` query semantics)
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Protocol reminder (sidebar events): `conversation_upsert` may include `agentName`; Chat page must ignore upserts/deletes that do not match its `agentName=__none__` filter.
19. [ ] Client RTL test (Jest + Testing Library): sidebar ignores WS `conversation_upsert` for agent conversations when Chat uses `agentName=__none__`
   - Files to edit/create: `client/src/test/chatWs.sidebarAgentFilter.test.tsx` (new)
   - Purpose: ensure agent conversations do not appear in the Chat sidebar via realtime upserts (matches REST list filter)
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
20. [ ] Client RTL test (Jest + Testing Library): ChatPage subscribes to sidebar updates on mount when `mongoConnected === true`
   - Files to edit/create: `client/src/test/chatWs.sidebarSubscribe.test.tsx` (new) or extend existing `client/src/test/chatPage.*.test.tsx`
   - Purpose: ensure the sidebar live updates start when the Chat route mounts and persistence is available
   - Docs (read before coding): MDN WebSocket API https://developer.mozilla.org/en-US/docs/Web/API/WebSocket, Testing Library https://testing-library.com/docs/react-testing-library/intro/, Jest (Context7) `/websites/jestjs_io_30_0`
21. [ ] Client RTL test (Jest + Testing Library): ChatPage unsubscribes from sidebar updates on unmount without sending `cancel_inflight`
   - Files to edit/create: `client/src/test/chatWs.sidebarUnsubscribe.test.tsx` (new) or extend existing `client/src/test/chatPage.stop.test.tsx`
   - Purpose: ensure leaving Chat detaches from WS updates but does not cancel the run server-side
   - Docs (read before coding): React effects https://react.dev/learn/synchronizing-with-effects, Testing Library https://testing-library.com/docs/react-testing-library/intro/
22. [ ] Client RTL test (Jest + Testing Library): selecting a conversation subscribes to transcript updates for that `conversationId`
   - Files to edit/create: `client/src/test/chatWs.transcriptSubscribe.test.tsx` (new) or extend existing `client/src/test/chatPage.provider.conversationSelection.test.tsx`
   - Purpose: ensure the active transcript view receives live updates for the selected conversation
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
23. [ ] Client RTL test (Jest + Testing Library): switching conversations unsubscribes the old transcript and subscribes the new transcript
   - Files to edit/create: `client/src/test/chatWs.transcriptSwitching.test.tsx` (new) or extend existing `client/src/test/chatPage.provider.conversationSelection.test.tsx`
   - Purpose: ensure rapid switching does not leak subscriptions or merge deltas into the wrong transcript
   - Docs (read before coding): React effects https://react.dev/learn/synchronizing-with-effects, Testing Library https://testing-library.com/docs/react-testing-library/intro/
24. [ ] Client RTL test (Jest + Testing Library): `inflight_snapshot` renders assistant text + analysis + tool state as a single in-flight UI section
   - Files to edit/create: `client/src/test/chatWs.inflightSnapshotRendering.test.tsx` (new) or extend existing `client/src/test/chatPage.stream.test.tsx`
   - Purpose: ensure late subscribers see a correct “current in-flight” view that matches the originating tab
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
25. [ ] Client RTL test (Jest + Testing Library): `assistant_delta` updates in-place (no duplicate assistant message)
   - Files to edit/create: `client/src/test/chatWs.assistantDelta.test.tsx` (new)
   - Purpose: ensure streaming deltas append to the existing in-flight assistant message rather than creating new turns
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
26. [ ] Client RTL test (Jest + Testing Library): `analysis_delta` updates the analysis panel in-place
   - Files to edit/create: `client/src/test/chatWs.analysisDelta.test.tsx` (new) or extend existing `client/src/test/useChatStream.reasoning.test.tsx`
   - Purpose: ensure late subscribers can see reasoning/analysis streaming consistently with SSE behavior
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
27. [ ] Client RTL test (Jest + Testing Library): out-of-order `seq` events are ignored (sidebar + transcript)
   - Files to edit/create: `client/src/test/chatWs.seqGuards.test.tsx` (new)
   - Purpose: prevent UI glitches from late-arriving messages during reconnects and rapid switching
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
28. [ ] Client RTL test (Jest + Testing Library): Stop sends `cancel_inflight` over WS when `inflightId` is known (no reliance on HTTP abort)
   - Files to edit/create: `client/src/test/chatPage.stop.wsCancel.test.tsx` (new) or update `client/src/test/chatPage.stop.test.tsx`
   - Purpose: ensure Stop semantics match Story 19 (explicit cancel only) and do not depend on fetch abort side-effects
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
29. [ ] Client RTL test (Jest + Testing Library): Stop falls back to `POST /chat/cancel` when WS is disconnected
   - Files to edit/create: `client/src/test/chatPage.stop.httpCancelFallback.test.tsx` (new)
   - Purpose: ensure Stop still cancels even when the WS transport is temporarily unavailable
   - Docs (read before coding): Fetch API https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, Testing Library https://testing-library.com/docs/react-testing-library/intro/
30. [ ] Client RTL test (Jest + Testing Library): Stop works even if this tab did not start the run (inflightId learned from `inflight_snapshot`)
   - Files to edit/create: `client/src/test/chatWs.stopFromViewerTab.test.tsx` (new)
   - Purpose: ensure any viewer can stop a run (dashboard workflow) once it learns the inflightId
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
31. [ ] Client RTL test (Jest + Testing Library): leaving Chat/unmount and switching conversations does not cancel generation (detach semantics)
   - Files to edit/create: `client/src/test/chatWs.detachSemantics.test.tsx` (new) or update `client/src/test/chatPage.stream.test.tsx`
   - Purpose: ensure only explicit Stop triggers cancellation, while navigation/switching only unsubscribes
   - Docs (read before coding): React effects https://react.dev/learn/synchronizing-with-effects, Testing Library https://testing-library.com/docs/react-testing-library/intro/
32. [ ] Client RTL test (Jest + Testing Library): persistence gating disables WS subscriptions and shows a clear message when `mongoConnected === false`
   - Files to edit/create: `client/src/test/chatPersistenceBanner.wsGating.test.tsx` (new) or update `client/src/test/chatPersistenceBanner.test.tsx`
   - Purpose: ensure realtime subscriptions/catch-up are disabled when persistence is off, without breaking chat send/stop
   - Docs (read before coding): MUI Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
33. [ ] Client RTL test (Jest + Testing Library): “New conversation” cancels the in-flight run via `cancel_inflight` and clears transcript state
   - Files to edit/create: `client/src/test/chatPage.newConversation.wsCancel.test.tsx` (new) or update `client/src/test/chatPage.newConversation.test.tsx`
   - Purpose: ensure “New conversation” performs an explicit cancel (not just abort) before resetting local transcript state
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
34. [ ] Client RTL test (Jest + Testing Library): “New conversation” falls back to `POST /chat/cancel` when WS is disconnected
   - Files to edit/create: `client/src/test/chatPage.newConversation.httpCancelFallback.test.tsx` (new)
   - Purpose: ensure “New conversation” can still cancel the in-flight run when WS transport is unavailable
   - Docs (read before coding): Fetch API https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, Testing Library https://testing-library.com/docs/react-testing-library/intro/
35. [ ] Client RTL test (Jest + Testing Library): selecting an existing conversation restores Codex `threadId` from `flags.threadId` and next send includes it
   - Files to edit/create: `client/src/test/chatPage.codexThreadIdRestore.test.tsx` (new) or update `client/src/test/chatSendPayload.test.tsx`
   - Purpose: ensure Codex continuation works across reloads/tabs by restoring the persisted threadId
   - Docs (read before coding): Testing Library https://testing-library.com/docs/react-testing-library/intro/
36. [ ] Update docs: `design.md` (client WS subscribe/catch-up + Stop/detach flows as Mermaid diagrams)
   - Files to edit: `design.md`
   - Location: `design.md`
   - Description: add/update Mermaid diagrams describing connect/reconnect, subscribe/unsubscribe, snapshot refresh ordering, and Stop vs detach behavior
   - Purpose: document the client lifecycle (connect/reconnect, subscribe/unsubscribe, snapshot refresh ordering) and Stop vs detach semantics as Mermaid diagrams
   - Docs (read before doing): Mermaid (Context7) `/mermaid-js/mermaid`, Markdown basics https://www.markdownguide.org/basic-syntax/
37. [ ] Update docs: `projectStructure.md` (new client WS hook/tests)
   - Files to edit: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: add every new/moved/removed client file created in Task 4 (Chat WS hook + realtime subscriptions + Stop/detach changes + tests)
   - Required file list (must be complete; update based on what you actually created):
     - New client WS hook/service: `client/src/hooks/useChatWs.ts`
     - New client Jest tests (if created as separate files):
       - `client/src/test/chatWs.sidebarAgentFilter.test.tsx`
       - `client/src/test/chatWs.sidebarSubscribe.test.tsx`
       - `client/src/test/chatWs.sidebarUnsubscribe.test.tsx`
       - `client/src/test/chatWs.transcriptSubscribe.test.tsx`
       - `client/src/test/chatWs.transcriptSwitching.test.tsx`
       - `client/src/test/chatWs.inflightSnapshotRendering.test.tsx`
       - `client/src/test/chatWs.assistantDelta.test.tsx`
       - `client/src/test/chatWs.analysisDelta.test.tsx`
       - `client/src/test/chatWs.seqGuards.test.tsx`
       - `client/src/test/chatPage.stop.wsCancel.test.tsx`
       - `client/src/test/chatPage.stop.httpCancelFallback.test.tsx`
       - `client/src/test/chatWs.stopFromViewerTab.test.tsx`
       - `client/src/test/chatWs.detachSemantics.test.tsx`
       - `client/src/test/chatPersistenceBanner.wsGating.test.tsx`
       - `client/src/test/chatPage.newConversation.wsCancel.test.tsx`
       - `client/src/test/chatPage.newConversation.httpCancelFallback.test.tsx`
       - `client/src/test/chatPage.codexThreadIdRestore.test.tsx`
     - Removed files: none expected (if you delete/move anything, list it explicitly)
   - Purpose: keep the repo structure map accurate and make client realtime/WS additions discoverable for onboarding
   - Docs (read before doing): Markdown basics https://www.markdownguide.org/basic-syntax/
38. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix --workspaces`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Files to read: `package.json`, `client/package.json`, `server/package.json`, `eslint.config.js`, `.prettierrc`
   - Commands: `npm run lint --workspaces`, `npm run format:check --workspaces`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script, ESLint CLI https://eslint.org/docs/latest/use/command-line-interface, Prettier CLI https://prettier.io/docs/en/cli.html
#### Testing

1. [ ] `npm run build --workspace server`
   - Files to read: `package.json`, `server/package.json`
   - Command: `npm run build --workspace server`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Files to read: `package.json`, `client/package.json`
   - Command: `npm run build --workspace client`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Files to read: `server/package.json`, `server/src/test/`
   - Command: `npm run test --workspace server`
   - Docs (read before doing): Node test runner https://nodejs.org/api/test.html, Cucumber guides https://cucumber.io/docs/guides/
4. [ ] `npm run test --workspace client`
   - Files to read: `client/package.json`, `client/src/test/`
   - Command: `npm run test --workspace client`
   - Docs (read before doing): Jest (Context7) `/websites/jestjs_io_30_0`, Testing Library https://testing-library.com/docs/react-testing-library/intro/
5. [ ] `npm run e2e`
   - Files to read: `package.json`, `playwright.config.ts`, `e2e/`, `.env.e2e`, `docker-compose.e2e.yml`
   - Command: `npm run e2e`
   - Docs (read before doing): Playwright (Context7) `/microsoft/playwright.dev`, Docker Compose https://docs.docker.com/compose/
6. [ ] `npm run compose:build`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:build`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/, npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
7. [ ] `npm run compose:up`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`, `README.md` (ports: client 5001, server 5010)
   - Command: `npm run compose:up`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/
8. [ ] Manual Playwright-MCP check (Task 4 focus: WS reconnect + transcript subscription + Stop vs detach)
   - Files to read: `planning/0000019-chat-page-ux.md` (Acceptance Criteria), `README.md` (URLs/ports)
   - Manual checks (minimum):
     - Start the stack and open http://localhost:5001.
     - Verify sidebar live updates: create/archive/restore and confirm the list updates without refresh.
     - Verify transcript live updates: in Tab A run a chat, in Tab B view the same conversation and confirm it catches up and streams deltas.
     - Verify reconnect safety: reload during/after a run and confirm REST refresh happens before WS deltas apply (no duplicate/out-of-order transcript).
     - Verify Stop cancels, but navigating away just unsubscribes (does not cancel).
   - Docs (read before doing): Playwright https://playwright.dev/docs/intro
9. [ ] `npm run compose:down`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:down`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/

#### Implementation notes

- 

---

### 5. Final Task – Full verification + documentation + PR summary

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Verify the story end-to-end against the acceptance criteria, perform full clean builds and tests, update documentation, and generate a PR comment summarizing all changes.

#### Documentation Locations

- Docker Compose (rebuild/restart workflow and compose file reference): Context7 `/docker/docs` (Compose)
- Playwright (end-to-end tests and screenshots): Context7 `/microsoft/playwright.dev`
- Husky (git hook behavior if lint/test hooks are involved): Context7 `/typicode/husky`
- Mermaid (diagram syntax + security/sanitization considerations): Context7 `/mermaid-js/mermaid`
- Jest (Jest 30 docs; client unit tests + snapshot behavior): Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (all guides index; baseline reference for running/writing Cucumber in this repo): https://cucumber.io/docs/guides/
- Cucumber guide (basic workflow + step definitions): https://cucumber.io/docs/guides/10-minute-tutorial/
- Cucumber guide (CI usage patterns and exit codes): https://cucumber.io/docs/guides/continuous-integration/
- Cucumber reference (tags/filtering and “Running Cucumber” sections): https://cucumber.io/docs/cucumber/api/
- Gherkin reference (feature file syntax rules): https://cucumber.io/docs/gherkin/reference
- GitHub pull requests (PR summary/comment expectations): https://docs.github.com/en/pull-requests
- Markdown basics (docs updates in README/design/projectStructure): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Playwright e2e test: cross-tab inflight catch-up (Tab B joins mid-run and sees `inflight_snapshot` then continues receiving deltas)
   - Test type: e2e (Playwright)
   - Files to edit/create: `e2e/chat-live-updates.spec.ts`
   - Purpose: verify the “multi-conversation dashboard” workflow works across tabs
   - Docs (read before coding): Playwright https://playwright.dev/docs/intro
2. [ ] Playwright e2e test: detach vs Stop (navigating away does not cancel; explicit Stop cancels and transcript reflects stopped)
   - Test type: e2e (Playwright)
   - Files to edit/create: `e2e/chat-live-updates.spec.ts`
   - Purpose: verify Story 19’s detach semantics and explicit cancellation behavior end-to-end
   - Docs (read before coding): Playwright https://playwright.dev/docs/intro
3. [ ] Playwright e2e test: WS reconnect behavior (reload/network blip causes list + transcript REST refresh before resubscribe)
   - Test type: e2e (Playwright)
   - Files to edit/create: `e2e/chat-live-updates.spec.ts`
   - Purpose: prevent regressions where reconnect merges stale WS deltas into an out-of-date UI snapshot
   - Docs (read before coding): Playwright https://playwright.dev/docs/intro
4. [ ] Playwright e2e test: bulk archive (multi-select archive in `Active` view updates the list immediately)
   - Test type: e2e (Playwright)
   - Files to edit/create: `e2e/chat-bulk-actions.spec.ts`
   - Purpose: verify the bulk archive UX works end-to-end and list stays consistent
   - Docs (read before coding): Playwright https://playwright.dev/docs/intro
5. [ ] Playwright e2e test: bulk restore (restore in `Archived` view works)
   - Test type: e2e (Playwright)
   - Files to edit/create: `e2e/chat-bulk-actions.spec.ts`
   - Purpose: verify bulk restore and archived-only filtering works end-to-end
   - Docs (read before coding): Playwright https://playwright.dev/docs/intro
6. [ ] Playwright e2e test: permanent delete requires confirmation and removes items from the list
   - Test type: e2e (Playwright)
   - Files to edit/create: `e2e/chat-bulk-actions.spec.ts`
   - Purpose: ensure permanent deletion cannot happen without explicit confirmation
   - Docs (read before coding): Playwright https://playwright.dev/docs/intro
7. [ ] Ensure `README.md` is updated with any required description changes and with any new commands that have been added as part of this story
   - Files to edit: `README.md`
   - Location: `README.md`
   - Description: update README to reflect the new Story 19 user-visible behaviors (bulk actions, archived-only list mode, live WS updates) and any new run commands
   - Purpose: keep repo onboarding accurate so new developers know how to run/test the system and what features exist
   - Docs (read before doing): Markdown basics https://www.markdownguide.org/basic-syntax/
8. [ ] Ensure `design.md` is updated with any required description changes including Mermaid diagrams that have been added as part of this story
   - Files to edit: `design.md`
   - Location: `design.md`
   - Description: add/update Mermaid architecture + flow diagrams created during Tasks 1–4, and ensure the narrative matches the implemented behavior
   - Purpose: keep architectural documentation and flows aligned with the code to reduce future regressions
   - Docs (read before doing): Mermaid (Context7) `/mermaid-js/mermaid`
9. [ ] Ensure `projectStructure.md` is updated after all file additions/removals in this story (including new `e2e/*.spec.ts` files)
   - Files to edit: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: list every added/removed/moved file and any new folders introduced by this story (server WS modules, client hooks/tests, e2e specs)
   - Required file list (must be complete; update based on what you actually created):
     - Task 1 (server WS + cancel fallback + tests):
       - `server/src/ws/types.ts`, `server/src/ws/server.ts`, `server/src/ws/inflightRegistry.ts`, `server/src/ws/hub.ts`, `server/src/routes/chatCancel.ts`
       - `server/src/test/integration/ws.lifecycle.connectDisconnect.test.ts`
       - `server/src/test/integration/ws.validation.invalidJson.test.ts`
       - `server/src/test/integration/ws.validation.unknownType.test.ts`
       - `server/src/test/integration/ws.validation.subscribeConversation.missingConversationId.test.ts`
       - `server/src/test/integration/ws.validation.cancelInflight.missingInflightId.test.ts`
       - `server/src/test/integration/ws.sidebar.subscribeUnsubscribe.test.ts`
       - `server/src/test/integration/ws.conversation.subscribeIdle.test.ts`
       - `server/src/test/integration/ws.conversation.catchupSnapshot.test.ts`
       - `server/src/test/integration/ws.mcp2.codebaseQuestion.inflightBroadcast.test.ts`
       - `server/src/test/integration/ws.agents.runInstruction.inflightBroadcast.test.ts`
       - `server/src/test/integration/ws.seq.sidebarMonotonic.test.ts`
       - `server/src/test/integration/ws.seq.transcriptMonotonic.test.ts`
       - `server/src/test/integration/ws.cancel.happyPath.test.ts`
       - `server/src/test/integration/ws.cancel.idempotent.test.ts`
       - `server/src/test/integration/ws.cancel.invalid.test.ts`
       - `server/src/test/integration/ws.restChat.inflightBroadcast.test.ts`
       - `server/src/test/integration/chat.runLock.conflict.test.ts`
       - `server/src/test/mcp2/tools/codebaseQuestion.runLock.conflict.test.ts`
       - `server/src/test/integration/ws.sidebar.upsert.onChatCreateUpdate.test.ts`
       - `server/src/test/integration/ws.sidebar.upsert.onArchive.test.ts`
       - `server/src/test/integration/ws.sidebar.upsert.onRestore.test.ts`
       - `server/src/test/integration/chat.cancelEndpoint.happyPath.test.ts`
       - `server/src/test/integration/chat.cancelEndpoint.notFound.test.ts`
       - `server/src/test/integration/chat.cancelEndpoint.idempotent.test.ts`
       - `server/src/test/integration/chat.cancelEndpoint.validationError.test.ts`
       - `server/src/test/integration/chat.validators.cancelOnDisconnect.invalidType.test.ts`
       - `server/src/test/integration/chat.validators.inflightId.invalid.test.ts`
       - `server/src/test/integration/chat.detach.cancelOnDisconnectFalse.test.ts`
       - `server/src/test/integration/chat.detach.defaultCancels.test.ts`
       - `server/src/test/unit/inflightRegistry.cleanup.test.ts`
       - `server/src/test/unit/inflightRegistry.tools.currentState.test.ts`
       - `server/src/test/unit/inflightRegistry.tools.maxCount.test.ts`
     - Task 2 (server bulk + list modes + tests):
       - `server/src/test/integration/conversations.list.active.test.ts`
       - `server/src/test/integration/conversations.list.includeArchived.test.ts`
       - `server/src/test/integration/conversations.list.archivedOnly.test.ts`
       - `server/src/test/integration/conversations.list.agentNameNone.test.ts`
       - `server/src/test/integration/conversations.list.pagination.test.ts`
       - `server/src/test/unit/conversations.bulk.validation.empty.test.ts`
       - `server/src/test/unit/conversations.bulk.validation.maxSize.test.ts`
       - `server/src/test/unit/conversations.bulk.validation.duplicates.test.ts`
       - `server/src/test/integration/conversations.bulk.archive.success.test.ts`
       - `server/src/test/integration/conversations.bulk.archive.idempotent.test.ts`
       - `server/src/test/integration/conversations.bulk.archive.unknownIdRejects.test.ts`
       - `server/src/test/integration/conversations.bulk.restore.success.test.ts`
       - `server/src/test/integration/conversations.bulk.restore.idempotent.test.ts`
       - `server/src/test/integration/conversations.bulk.restore.unknownIdRejects.test.ts`
       - `server/src/test/integration/conversations.bulk.delete.successDeletesTurns.test.ts`
       - `server/src/test/integration/conversations.bulk.delete.rejectsNonArchived.test.ts`
       - `server/src/test/integration/conversations.bulk.delete.unknownIdRejects.test.ts`
       - `server/src/test/integration/conversations.bulk.delete.rollback.test.ts`
       - `server/src/test/integration/conversations.bulk.wsEvents.archiveAfterCommit.test.ts`
       - `server/src/test/integration/conversations.bulk.wsEvents.restoreAfterCommit.test.ts`
       - `server/src/test/integration/conversations.bulk.wsEvents.deleteAfterCommit.test.ts`
     - Task 3 (client bulk sidebar + tests):
       - `client/src/api/conversations.ts`
       - `client/src/test/chatSidebar.agentFilterQuery.test.tsx`
     - Task 4 (client WS hook + tests):
       - `client/src/hooks/useChatWs.ts`
       - `client/src/test/chatWs.sidebarAgentFilter.test.tsx`
       - `client/src/test/chatWs.sidebarSubscribe.test.tsx`
       - `client/src/test/chatWs.sidebarUnsubscribe.test.tsx`
       - `client/src/test/chatWs.transcriptSubscribe.test.tsx`
       - `client/src/test/chatWs.transcriptSwitching.test.tsx`
       - `client/src/test/chatWs.inflightSnapshotRendering.test.tsx`
       - `client/src/test/chatWs.assistantDelta.test.tsx`
       - `client/src/test/chatWs.analysisDelta.test.tsx`
       - `client/src/test/chatWs.seqGuards.test.tsx`
       - `client/src/test/chatPage.stop.wsCancel.test.tsx`
       - `client/src/test/chatPage.stop.httpCancelFallback.test.tsx`
       - `client/src/test/chatWs.stopFromViewerTab.test.tsx`
       - `client/src/test/chatWs.detachSemantics.test.tsx`
       - `client/src/test/chatPersistenceBanner.wsGating.test.tsx`
       - `client/src/test/chatPage.newConversation.wsCancel.test.tsx`
       - `client/src/test/chatPage.newConversation.httpCancelFallback.test.tsx`
       - `client/src/test/chatPage.codexThreadIdRestore.test.tsx`
     - Task 5 (e2e): `e2e/chat-live-updates.spec.ts`, `e2e/chat-bulk-actions.spec.ts`
     - Removed files: none expected (if you delete/move anything, list it explicitly)
   - Purpose: keep the repo structure map accurate for onboarding and for planning future work
   - Docs (read before doing): Markdown basics https://www.markdownguide.org/basic-syntax/
10. [ ] Create a pull request comment summarizing all changes made in this story (server + client + tests)
   - Files to read: `planning/0000019-chat-page-ux.md`, `README.md`, `design.md`, `projectStructure.md`
   - Command to run (for summary input): `git log --oneline --decorate -20`
   - Docs (read before doing): GitHub pull requests https://docs.github.com/en/pull-requests
11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix --workspaces`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Files to read: `package.json`, `client/package.json`, `server/package.json`, `eslint.config.js`, `.prettierrc`
   - Commands: `npm run lint --workspaces`, `npm run format:check --workspaces`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script, ESLint CLI https://eslint.org/docs/latest/use/command-line-interface, Prettier CLI https://prettier.io/docs/en/cli.html


#### Testing

1. [ ] `npm run build --workspace server`
   - Files to read: `package.json`, `server/package.json`
   - Command: `npm run build --workspace server`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Files to read: `package.json`, `client/package.json`
   - Command: `npm run build --workspace client`
   - Docs (read before doing): npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Files to read: `server/package.json`, `server/src/test/`
   - Command: `npm run test --workspace server`
   - Docs (read before doing): Node test runner https://nodejs.org/api/test.html, Cucumber guides https://cucumber.io/docs/guides/
4. [ ] `npm run test --workspace client`
   - Files to read: `client/package.json`, `client/src/test/`
   - Command: `npm run test --workspace client`
   - Docs (read before doing): Jest (Context7) `/websites/jestjs_io_30_0`, Testing Library https://testing-library.com/docs/react-testing-library/intro/
5. [ ] `npm run e2e`
   - Files to read: `package.json`, `playwright.config.ts`, `e2e/`, `.env.e2e`, `docker-compose.e2e.yml`
   - Command: `npm run e2e`
   - Docs (read before doing): Playwright (Context7) `/microsoft/playwright.dev`, Docker Compose https://docs.docker.com/compose/
6. [ ] `npm run compose:build`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:build`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/, npm run-script https://docs.npmjs.com/cli/v10/commands/npm-run-script
7. [ ] `npm run compose:up`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`, `README.md` (ports: client 5001, server 5010)
   - Command: `npm run compose:up`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/
8. [ ] Manual Playwright-MCP check (final verification: Story 19 acceptance + broad regression pass)
   - Files to read: `planning/0000019-chat-page-ux.md` (Acceptance Criteria), `README.md` (URLs/ports), `design.md` (flows), `e2e/` (Story 19 specs)
   - Manual checks (minimum):
     - Start the stack and open http://localhost:5001.
     - Verify archived-only filter mode works and selection clears on filter change.
     - Verify bulk archive/restore/delete flows end-to-end, including delete confirmation and no partial failures.
     - Verify 2-tab behavior: Tab B can subscribe mid-run, sees snapshot then continues receiving deltas.
     - Verify Stop cancels, detach (navigating away) does not cancel.
     - Verify reconnect safety: reload and confirm transcript/list remain consistent (no duplicates/out-of-order deltas).
   - Docs (read before doing): Playwright https://playwright.dev/docs/intro
9. [ ] `npm run compose:down`
   - Files to read: `package.json`, `docker-compose.yml`, `server/.env`, `server/.env.local`
   - Command: `npm run compose:down`
   - Docs (read before doing): Docker Compose https://docs.docker.com/compose/

#### Implementation notes

- 
