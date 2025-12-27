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

This story improves the Chat page UX in four ways:

1. **Bulk conversation management**: allow multi-select and bulk actions (archive / restore / permanent delete) with a clearer 3-state conversation filter (`Active`, `Active & Archived`, `Archived`).
2. **Live updates (transcript + sidebar)**: live updates are available across browser windows for both the active transcript and the conversation sidebar. The transcript streams only for the currently visible conversation, while the sidebar receives updates so new conversations appear (and removals/archives/restores reflect) without manual refresh.
3. **Chat transport unification**: remove chat SSE entirely and stream chat updates over WebSockets only, so every viewer receives updates through the same mechanism. `POST /chat` becomes a non-streaming “start run” request and the transcript is driven by WebSocket events.
4. **Streaming observability**: add explicit client + server log entries for WebSocket chat streaming so tests can prove that messages are being sent/received end-to-end via the `/logs` store.

The intended approach for “catch-up” is:
- The client continues to load the persisted snapshot (existing “load turns for a conversation” mechanism).
- While a conversation is actively streaming, the server provides incremental updates for the current in-flight turn from in-memory state.
- The UI merges persisted turns with the in-memory streaming turn so the transcript reflects “so far” content without requiring the server to retain full histories in memory.
- Catch-up must include **both** partial assistant text **and** interim tool-call progress/events **and** any streamed reasoning/analysis content, so the viewed transcript looks identical to watching the stream in the originating tab.
- When a client subscribes to a conversation mid-stream (for example by switching to it, or opening it in another tab), the server sends a **full in-flight turn snapshot** (assistant text so far + tool progress history so far) before streaming further incremental updates.
- If a WebSocket reconnect occurs (network hiccup / laptop sleep), the client treats itself as potentially out of sync and reuses the existing snapshot mechanisms:
  - it refreshes the conversation list snapshot,
  - it re-fetches the visible conversation turns snapshot,
  - then re-subscribes to the sidebar stream and the visible conversation stream.
- If the user navigates away from the Chat page (for example to the Ingest page), the client stops **receiving** streaming updates by unsubscribing from the transcript and sidebar streams. This does **not** cancel the underlying run on the server; the run continues unless the user explicitly stops it (existing Stop button).
  - When the user returns to the Chat page, the client resumes viewing by re-snapshotting and re-subscribing, using the same catch-up approach as reconnects.

### Realtime transport choice (v1)

We will use **WebSockets** (one connection per browser tab) as the **only** chat streaming transport. Chat SSE will be removed by the end of this story. WebSockets are required because we need:
- Dynamic subscriptions: only the **visible** conversation transcript should stream (subscribe on view, unsubscribe on switch).
- Always-on sidebar updates: the conversation list should update in real time when conversations are created/updated/archived/restored/deleted from another browser window.
- Near-term reuse: a follow-up story is expected to apply the same realtime + management model to the **Agents** tab, so the transport should support multiple “channels” (chat list, agents list, active conversation) over a single connection.

WebSockets keep this as a single long-lived connection with explicit `subscribe`/`unsubscribe` messages, and allow us to add new event types later without creating additional long-lived HTTP streams.

Implementation choice (confirmed):
- WebSocket library: `ws`
- Server heartbeat: ping every 30s, disconnect after 2 missed pongs
- Client reconnect: exponential backoff (500ms → 1s → 2s → 4s, cap at 8s)

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
- In-progress MCP and agent-initiated conversations stream in the UI the same way as REST/Web conversations (without changing MCP message formats or MCP tooling behaviour).
- When switching to a conversation that is already mid-stream, catch-up renders the in-flight state so the transcript matches the originating tab, including interim tool-call progress/events **and** streamed reasoning/analysis (when applicable).
- Transcript streaming is scoped to the currently visible conversation only: when the user switches conversations, the client unsubscribes from the prior conversation stream and subscribes to the newly visible one.
- Starting a run in the Chat page and then navigating away does not cancel generation; the run continues to completion unless the user explicitly stops it using the existing Stop button.
- Chat streaming uses WebSockets only: `POST /chat` no longer streams SSE and returns a JSON acknowledgement that a run has started; all tokens/tool events/final updates arrive via the WebSocket transcript stream.
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
- By the end of this story, the chat SSE transport is fully removed; there are no EventSource/SSE dependencies for chat in client or server code.
- Streaming observability (logs):
  - The server writes log entries for WebSocket lifecycle + chat stream events (connect/disconnect, subscribe/unsubscribe, inflight start, deltas/tool events/final, cancel).
  - The client writes log entries for WebSocket lifecycle + received events and **forwards them to the server logs** (so `/logs` includes client-side receipt).
  - Log payloads must include `conversationId`, `inflightId` (when available), and sequence numbers to make Playwright validation deterministic.
  - Log naming + sampling (confirmed):
    - Server logs: `chat.ws.connect`, `chat.ws.disconnect`, `chat.ws.subscribe_sidebar`, `chat.ws.unsubscribe_sidebar`, `chat.ws.subscribe_conversation`, `chat.ws.unsubscribe_conversation`, `chat.run.started`, `chat.stream.snapshot`, `chat.stream.delta`, `chat.stream.tool_event`, `chat.stream.final`, `chat.stream.cancel`.
    - Client logs (forwarded): `chat.ws.client_connect`, `chat.ws.client_disconnect`, `chat.ws.client_subscribe_conversation`, `chat.ws.client_snapshot_received`, `chat.ws.client_delta_received`, `chat.ws.client_tool_event_received`, `chat.ws.client_final_received`.
    - Delta log throttling: log the first delta and then every 25 deltas; include `deltaCount` in the payload so tests can validate counts deterministically.
    - Tool events are logged per event; include `toolEventCount` as a running total for deterministic assertions.

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
- WebSocket endpoint runs on the existing Express server/port (no separate WS port).
- No WS auth/CSRF/origin checks are added in this story (explicitly deferred).

### Run initiation (no SSE)

- `POST /chat` becomes a non-streaming “start run” request. It returns JSON and does **not** use `text/event-stream`.
- Response shape (success, HTTP 202):
  - `{ "status": "started", "conversationId": "<id>", "inflightId": "<id>", "provider": "<provider>", "model": "<model>" }`
  - `conversationId` is required in the request (client-generated, as today) and echoed in the response.
  - `inflightId` is generated if the client did not supply one; it is stable for the lifetime of the run and used for `cancel_inflight`.
- `POST /chat` does **not** require an active WebSocket connection; runs may start even if there are no subscribers.
- Response shape (error, HTTP 409):
  - `{ "status": "error", "code": "RUN_IN_PROGRESS", "message": "Conversation already has an active run." }`
- Response shape (error, HTTP 400):
  - `{ "status": "error", "code": "VALIDATION_FAILED", "message": "<reason>" }`
  - `{ "status": "error", "code": "UNSUPPORTED_PROVIDER", "message": "<reason>" }`
- Response shape (error, HTTP 503):
  - `{ "status": "error", "code": "PROVIDER_UNAVAILABLE", "message": "<reason>" }` (e.g., LM Studio down)
- Response shape (error, HTTP 500):
  - `{ "status": "error", "code": "INTERNAL_ERROR", "message": "Unexpected error." }`
- The server begins the run and publishes `inflight_snapshot`/`assistant_delta`/`analysis_delta`/`tool_event`/`turn_final` events over the WebSocket to any subscribed viewers.
- The server also publishes `conversation_upsert` sidebar updates when:
  - a conversation is created/updated at run start (title/model/flags/lastMessageAt), and
  - a user/assistant turn is persisted (so `lastMessageAt` resorting works live).
- If a client subscribes after the run has started, the server sends an `inflight_snapshot` with the current partial state before streaming further deltas.

### Client → Server messages

All messages are JSON objects with `type` and a client-generated `requestId` for debugging.
All WS messages include `protocolVersion: "v1"` for forwards compatibility.

- `type: "subscribe_sidebar"`
  - `{ type, requestId }`
- `type: "unsubscribe_sidebar"`
  - `{ type, requestId }`
- `type: "subscribe_conversation"`
  - `{ type, requestId, conversationId: string }`
- `type: "unsubscribe_conversation"`
  - `{ type, requestId, conversationId: string }`
- `type: "cancel_inflight"`
  - Used by the existing Stop button to cancel the currently running turn without relying on HTTP request abort or SSE.
  - `{ type, requestId, conversationId: string, inflightId: string }`
  - `inflightId` is stable for the lifetime of a single in-progress turn. For turns started in the Chat UI, the client generates it and includes it in `POST /chat`. For turns started elsewhere (e.g. MCP), the client learns it from `inflight_snapshot`/`assistant_delta` and caches it for Stop.

### Server → Client events

All events are JSON objects with `type`. Events include sequence identifiers to support dedupe/out-of-order guarding.
All server events include `protocolVersion: "v1"`.

- Sidebar events (single global stream)
  - `type: "sidebar_snapshot"` – optional, but may be useful for debugging; primary snapshot remains the existing REST list fetch.
  - `type: "conversation_upsert"`
    - `{ type, seq: number, conversation: { conversationId, title, provider, model, source, lastMessageAt, archived, agentName?, flags? } }`
    - Notes:
      - `flags` should include at least `threadId` when available (Codex), because the current client uses it for continuity in degraded/memory persistence modes.
  - `type: "conversation_delete"`
    - `{ type, seq: number, conversationId: string }`

- Transcript events (scoped to a `conversationId`)
  - `type: "inflight_snapshot"`
    - Sent immediately after `subscribe_conversation` when a run is currently in progress, and broadcast to existing subscribers when a new in-flight turn starts (snapshot may be empty until the first delta/tool event arrives).
    - `{ type, conversationId, seq: number, inflight: { inflightId: string, assistantText: string, assistantThink: string, toolEvents: ToolEvent[], startedAt: string } }`
  - `type: "assistant_delta"`
    - `{ type, conversationId, seq: number, inflightId: string, delta: string }`
  - `type: "analysis_delta"`
    - Streamed reasoning/analysis text (Codex provider emits this separately from tokens).
    - `{ type, conversationId, seq: number, inflightId: string, delta: string }`
  - `type: "tool_event"`
    - Interim tool progress/events (so viewers match the originating tab).
    - `{ type, conversationId, seq: number, inflightId: string, event: ToolEvent }`
    - `ToolEvent` is a normalized shape that should align with what the client already renders and what the server persists in `Turn.toolCalls.calls[]`:
      - Tool request: `{ type: "tool-request", callId: string|number, name: string, stage?: string, parameters?: unknown }`
      - Tool result: `{ type: "tool-result", callId: string|number, name: string, stage?: string, parameters?: unknown, result?: unknown, errorTrimmed?: { code?: string, message?: string } | null, errorFull?: unknown }`
  - `type: "turn_final"`
    - Marks completion of the in-flight turn and carries any final metadata needed by the UI.
    - `{ type, conversationId, seq: number, inflightId: string, status: "ok" | "stopped" | "failed", threadId?: string | null }`
    - On failure, `turn_final` includes an `error` object: `{ code: string, message: string }`.
    - If `cancel_inflight` targets a non-existent or mismatched inflight, the server returns `turn_final` with `status:"failed"` and `error.code = "INFLIGHT_NOT_FOUND"`.

### Sequence IDs (minimum)

- Sidebar events use a monotonically increasing `seq` per socket (or per server process) so the client can ignore stale/out-of-order list updates.
- Transcript events use a monotonically increasing `seq` per `conversationId` so the client can ignore stale/out-of-order deltas/events during rapid switching.

Note: the persisted transcript remains the source of truth; sequence IDs are primarily to prevent UI glitches from late-arriving events rather than to enable full replay.

### Event semantics (confirmed)

- No separate per-turn `error` event; failures are communicated via `turn_final` with `status:"failed"` plus `error { code, message }`.
- WebSocket errors are reserved for connection-level failures only (handled by reconnect + resubscribe).

### Logging volume (confirmed)

- Delta log throttling uses “first delta + every 25 deltas” (no hard cap per run beyond existing log buffer limits).

---

## Pre-tasking investigation findings (repo facts)

These findings are based on the current repository implementation and are included here to reduce risk when tasking and implementing Story 0000019.

### Current streaming behavior (today)

- The Chat page currently streams via **SSE** from `POST /chat` in `server/src/routes/chat.ts`. The server passes an `AbortSignal` into the provider execution and **aborts provider generation on client disconnect** (`req.on('close'|'aborted')` / `res.on('close')` → `AbortController.abort()`).
- The client’s `useChatStream.stop()` aborts the in-flight fetch via `AbortController.abort()` (`client/src/hooks/useChatStream.ts`), and `ChatPage` calls `stop()` both when switching conversations and on unmount (`client/src/pages/ChatPage.tsx` cleanup effect).
- Net effect: **navigating away from Chat currently cancels the run**, which conflicts with this story’s requirement that leaving Chat only unsubscribes from WS updates while the run continues server-side.
- By the end of Story 19, this SSE transport will be removed and replaced by WebSocket-only streaming for chat.

### In-flight state availability (today)

- The server does not currently maintain any shared/global in-flight turn state suitable for late subscribers. In-flight buffers (tokens/tool results) are request-local inside the chat interface/run and are discarded after completion. This story therefore requires introducing an explicit in-memory in-flight registry keyed by `conversationId` + `inflightId`.

### Existing realtime infrastructure (today)

- There is no existing reusable WebSocket server/publisher in the repo. Long-lived communication currently consists of:
  - `POST /chat` SSE streaming, and
  - MCP HTTP JSON-RPC servers (not streaming, no HTTP upgrade).
- Implementing this story’s WebSocket design requires adding a new WebSocket endpoint and a server-side publish/subscribe layer. After Story 19, chat will no longer use SSE, while `/logs/stream` remains SSE for logs.

### Existing run-lock infrastructure (today)

- There is already a per-conversation in-memory lock used by Agents runs: `server/src/agents/runLock.ts`.
- Story 19 should reuse this lock for Chat runs so that Agents + Chat share the same `RUN_IN_PROGRESS` semantics.

### Agents + MCP transcript streaming gaps (today)

- Agents runs (`server/src/agents/service.ts`) and MCP v2 `codebase_question` (`server/src/mcp2/tools/codebaseQuestion.ts`) both call `chat.run(...)`, but they currently only attach a local `McpResponder` that buffers segments for the HTTP/JSON-RPC response.
- They do **not** publish transcript deltas/tool events/finals to any shared streaming channel.
- To satisfy this story’s acceptance criteria (“agent/MCP-initiated conversations stream in the UI the same way”), Story 19 must ensure those runs also populate the in-flight registry and publish WS transcript events (not just sidebar upserts).
- Implementation should avoid duplication by using a single shared “ChatInterface events → in-flight registry → WS publish” bridge that is reused by `/chat`, Agents runs, and MCP `codebase_question`.

### Existing e2e mocking approach (today)

- Many `e2e/chat*.spec.ts` tests currently mock chat by intercepting `POST /chat` and returning SSE (`text/event-stream`).
- Playwright in this repo supports WebSocket routing (`page.routeWebSocket` / `browserContext.routeWebSocket`), so these mocks must be migrated to route `POST /chat` (JSON 202) plus route the `/ws` stream.

### Ingest page updates (today)

- The Ingest page does **not** use SSE today. It uses client-side **polling** via `GET /ingest/status/:runId` on an interval (~2s while active) implemented in `client/src/hooks/useIngestStatus.ts`, and served by `server/src/routes/ingestStart.ts`.
- There is SSE used elsewhere (for example `GET /logs/stream` in `server/src/routes/logs.ts` consumed via `EventSource` in `client/src/hooks/useLogs.ts`), but ingest status updates are plain JSON polling.
- Story 19 must **not** change the ingest polling mechanism or break it; ingest status polling must continue to work exactly as-is.

### Conversation management API gaps (today)

- The REST API currently supports single-item archive/restore (`POST /conversations/:id/archive|restore`) and list/turn endpoints (`GET /conversations`, `GET /conversations/:id/turns`). There are **no** bulk endpoints and **no** permanent delete endpoints. Story 19 will need to add these.
- `GET /conversations` only supports a boolean archived mode (active-only vs active+archived). There is no archived-only list mode today, so the 3-state filter requires extending the list API.
- Confirmed API plan:
  - List filter: `GET /conversations?state=active|archived|all` (default `active`).
  - Backward compat: existing `archived=true` is treated as `state=all`.
  - Bulk endpoints:
    - `POST /conversations/bulk/archive`
    - `POST /conversations/bulk/restore`
    - `POST /conversations/bulk/delete` (archived-only delete guardrail)
  - Bulk body: `{ "conversationIds": ["..."] }`
  - Bulk success response (200): `{ "status": "ok", "updatedCount": <number> }`
  - Bulk failure (409): `{ "status": "error", "code": "BATCH_CONFLICT", "message": "Bulk operation rejected.", "details": { "invalidIds": [], "invalidStateIds": [] } }`

### Mongo transactions / atomicity risk (today)

- Docker Compose runs Mongo as a single-node replica set (`--replSet rs0` and `mongo/init-mongo.js` calls `rs.initiate(...)`). Transactions are possible in that topology, but they are not strictly required for this story’s acceptance criteria.
- The documented/default `MONGO_URI` uses `directConnection=true` and does not specify `replicaSet=rs0` (`README.md`, `docker-compose.yml`, `server/.env`). Because that can make transaction support ambiguous, **this story will not rely on MongoDB transactions**.
- Bulk conversation operations will be implemented as **validate-first + idempotent writes** (e.g., reject invalid ids/mixed state up front; then apply bulk updates/deletes). This keeps dev setup unchanged and avoids introducing transaction-only behavior that would be hard to debug across environments.
- If later we need strict all-or-nothing semantics, we can introduce transactions as a follow-up story once the default connection string and CI environment are explicitly replica-set-aware.

### Existing tests that will be impacted

- Server Cucumber cancellation tests currently assert that aborting the HTTP request cancels provider execution (`server/src/test/steps/chat_cancellation.steps.ts`).
- Server Cucumber chat streaming tests currently assume SSE (`server/src/test/features/chat_stream.feature` and related step defs); they will need to be replaced or reworked for WebSocket-driven streaming.
- Client tests for the Stop button and “New conversation” behavior assume aborting the in-flight fetch cancels the run (`client/src/test/chatPage.stop.test.tsx`, `client/src/test/chatPage.newConversation.test.tsx`).
- Because Story 19 decouples “view subscription” from “run lifetime”, these tests will need to be updated (Stop will use `cancel_inflight`; navigation/unsubscribe must not cancel the run).
- New e2e coverage should validate the streaming log entries (client + server) by asserting `/logs` contains the expected WebSocket stream markers after a run.

---

## Out Of Scope

- “Select all” across the entire result set (server-side bulk operations over all matches).
- Complex selection gestures (shift-click ranges, keyboard navigation) beyond basic checkbox multi-select.
- Editing conversation titles, tagging, folders, or search within conversations.
- Cross-instance fan-out or locking (multi-server coordination). v1 assumes a single server process for live fan-out.
- Changing the MCP tool request/response formats or the persisted MCP turn schema. This story only improves how those existing turns/streams are displayed in the browser.
- Introducing a public “cancel run” API beyond the existing Stop button semantics (Stop will cancel the in-flight run via `cancel_inflight`; leaving the page/unsubscribing must not cancel).
- Sidebar “extra” live indicators (typing/streaming badges, token previews, tool-progress badges) beyond minimal create/update/delete + resorting.
- Replacing `/logs/stream` SSE with WebSockets (logs SSE remains in place for now).

---

## Questions


---
# Tasks

### 1. Conversation list filtering (state query)

- Task Status: **__done__**
- Git Commits: **1c89fa7**
#### Overview

Extend `GET /conversations` to support a 3-state filter (`active`, `archived`, `all`) while preserving backward compatibility for the existing `archived=true` query. This powers the new sidebar filter and keeps existing callers stable.

#### Documentation Locations

- Express 5 docs (routing + query parsing; use for req.query, Router patterns, and v5 behavior): https://expressjs.com/en/guide/routing.html and https://expressjs.com/en/5x/api.html and https://expressjs.com/en/guide/migrating-5.html
- Express 5 source/API references (use when you need v5.1.0 repo-level details): Context7 `/expressjs/express/v5.1.0`
- Zod v3 validation (used in this repo for request/query/body schemas; prefer safeParse for non-throwing validation): Context7 `/websites/v3_zod_dev`
- Mongoose v9 query filters (archivedAt filters + sorting/pagination patterns): Context7 `/automattic/mongoose/9.0.1`
- SuperTest (integration testing Express endpoints; assertions on status/body): Context7 `/ladjs/supertest`
- Node.js test runner (node:test is used by server tests in this repo): https://nodejs.org/api/test.html
- HTTP status + query string helpers (contract semantics for 400 + URLSearchParams): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status and https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
- Mermaid syntax (only if adding diagrams): Context7 `/mermaid-js/mermaid`
- Cucumber guides index (server test suite includes Cucumber scenarios; use this for step patterns and feature syntax): https://cucumber.io/docs/guides/
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`


#### Subtasks

1. [x] Read the current conversations list route and repo query implementation (do not assume filter behavior):
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0`
     - Context7 `/automattic/mongoose/9.0.1`
     - https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Files to read:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/conversation.ts`

   ✅ Notes (2025-12-27): Existing `GET /conversations` uses `archived=true` to set `includeArchived=true` (meaning it returns both active + archived). Repo-level `listConversations` only supports a boolean includeArchived gate today.

2. [x] Add the new 3-state list filter query (`state=active|archived|all`) with backward compatibility:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
     - https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Files to edit:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
   - Required behavior (examples):
     - Default: `GET /conversations` behaves like `GET /conversations?state=active`.
     - Archived-only: `GET /conversations?state=archived` returns only archived conversations.
     - All: `GET /conversations?state=all` returns active + archived.
     - Backward compat: `GET /conversations?archived=true` maps to `state=all`.
   - Required validation:
     - Invalid `state` returns `400` JSON `{ status:"error", code:"VALIDATION_FAILED" }`.

   ✅ Notes (2025-12-27): Added `state` query handling in `GET /conversations` and implemented repo-side filtering for `active` (`archivedAt:null`), `archived` (`archivedAt != null`), and `all` (no archived filter). Kept legacy `archived=true` behavior by mapping it to `state=all` when `state` is not provided.

3. [x] Server integration test: GET /conversations default behaves like state=active (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: prove default behavior remains stable for existing callers.
     - Assert default list excludes archived conversations.

   ✅ Notes (2025-12-27): Added `default list behaves like state=active` coverage in `server/src/test/integration/conversations.list.test.ts`.

4. [x] Server integration test: GET /conversations?state=active returns only active conversations (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: validate new 3-state filter Active mode.
     - Assert only non-archived conversations are returned.

   ✅ Notes (2025-12-27): Added `state=active returns only active conversations` coverage in `server/src/test/integration/conversations.list.test.ts`.

5. [x] Server integration test: GET /conversations?state=archived returns only archived conversations (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: validate new Archived-only list mode.
     - Assert only archived conversations are returned.

   ✅ Notes (2025-12-27): Added `state=archived returns only archived conversations` coverage in `server/src/test/integration/conversations.list.test.ts`.

6. [x] Server integration test: GET /conversations?state=all returns active + archived (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: validate All mode used by “Active & Archived”.
     - Assert the response includes both archived and non-archived.

   ✅ Notes (2025-12-27): Added `state=all returns active + archived conversations` coverage in `server/src/test/integration/conversations.list.test.ts`.

7. [x] Server integration test: GET /conversations?archived=true remains backward compatible (corner case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: ensure legacy clients keep working (archived=true maps to state=all).
     - Assert it returns both archived and non-archived.

   ✅ Notes (2025-12-27): Extended existing archived=true test to assert it maps to `state=all` and returns both.

8. [x] Server integration test: invalid state query returns 400 VALIDATION_FAILED (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: prevent silent behavior changes when query is invalid.
     - Assert JSON body includes `{ status:"error", code:"VALIDATION_FAILED" }`.

   ✅ Notes (2025-12-27): Added invalid `state` validation test asserting `{ status:"error", code:"VALIDATION_FAILED" }`.

9. [x] Update docs so the contract is discoverable (a junior dev should not need to infer it from code):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid` (only if adding diagrams)
   - Files to edit:
     - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).
   - Requirements:
     - Add a short bullet describing the new `state` query and default behavior.

   ✅ Notes (2025-12-27): Updated `design.md` with the `state=active|archived|all` contract and legacy `archived=true` mapping.

10. [x] Update project documentation if new files were introduced by this task:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).
   - Requirements:
     - Add any new files introduced by this task (if none, mark this subtask complete with “no changes”).

   ✅ Notes (2025-12-27): No new files introduced for Task 1; `projectStructure.md` unchanged.

11. [x] Add server log lines for conversation list filtering so manual checks can prove the new query paths are being exercised:
   - Files to edit:
     - `server/src/routes/conversations.ts`
     - `server/src/logStore.ts` (use existing append helper; do not change schema)
   - Required log messages (must match exactly):
     - `conversations.list.request`
     - `conversations.list.validation_failed`
     - `conversations.list.response`
   - Required fields in `context` (as applicable):
     - `state` (active|archived|all)
     - `archivedQuery` (raw archived query string when present)
     - `limit`
     - `cursorProvided` (boolean)
     - `agentName` (if present)
     - `returnedCount`
   - Notes:
     - Use the server log store (`/logs`) so the log lines are visible in the UI and in Playwright-MCP checks.

   ✅ Notes (2025-12-27): Added `/logs` entries for list request/validation_failed/response in `server/src/routes/conversations.ts` using `logStore.append()` with required `context` fields.

12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

   ✅ Notes (2025-12-27): `npm run lint --workspaces` passed. `npm run format:check --workspaces` initially failed for server files; ran `npm run format --workspaces` then `npm run format:check --workspaces` passed.

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (smoke + regression):
   - Open `/chat` and confirm the page loads without a blank screen.
   - Open `/logs` and confirm logs load (no server 500 spam).
   - Confirm server log lines exist for this task:
     - Search for `conversations.list.request` and `conversations.list.response`.
   - Regression: existing conversation list still loads and is clickable (Task 6 adds the new UI; at this stage you are only checking regressions).

   ✅ Notes (2025-12-27): Smoke-checked via `http://host.docker.internal:5001/chat` and `http://host.docker.internal:5001/logs`, then triggered `GET http://host.docker.internal:5010/conversations?limit=1` and confirmed `/logs` contains `conversations.list.request` + `conversations.list.response`.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-27: Started Task 1.
- Docs to reference for this task:
  - Express 5 routing/query parsing docs: confirms how `req.query` is shaped and how to handle string/array values safely.
  - Zod docs: request/query validation patterns and `safeParse` usage.
  - Mongoose docs: query filters for `archivedAt` (`null` vs `$ne:null`) and pagination semantics.
  - SuperTest + node:test: integration test patterns used by this repo.
- Gotchas:
  - Preserve backward compatibility: `archived=true` previously meant “include archived” (active + archived), so map it to `state=all` only when `state` is not explicitly provided.
  - Keep existing validation responses for unrelated query issues (e.g. bad `cursor`) to avoid breaking existing tests/callers, while adding the required `VALIDATION_FAILED` response specifically for invalid `state`.
  - Ensure `state=archived` excludes docs with missing `archivedAt` (treat missing as active), while `state=active` includes `archivedAt:null` and missing fields.
- 2025-12-27: Implemented `state` filtering end-to-end (route + repo), added server integration tests, updated design docs, and added `/logs` entries for request/validation_failed/response.
- 2025-12-27: Fixed Cucumber Chroma test harness reliability (wait strategy service name + healthcheck endpoint) so `npm run test --workspace server` passes.

---

### 2. Conversation bulk endpoints

- Task Status: **__done__**
- Git Commits: 57a91cf, c95e5dd
#### Overview

Add bulk archive/restore/delete endpoints with strong validation and archived-only delete guardrails (validate-first + idempotent writes; no transaction requirement in v1).

#### Documentation Locations

- Express 5 docs (adding new bulk routes + consistent error responses): https://expressjs.com/en/guide/routing.html and https://expressjs.com/en/5x/api.html
- Zod v3 validation (bulk request body validation; enforce conversationIds: string[] and reject invalid shapes): Context7 `/websites/v3_zod_dev`
- Mongoose v9 bulk operations (updateMany/deleteMany result fields like matchedCount/modifiedCount/deletedCount): Context7 `/automattic/mongoose/9.0.1`
- SuperTest (integration tests for bulk endpoints): Context7 `/ladjs/supertest`
- Node.js test runner (node:test patterns used by the server test suite): https://nodejs.org/api/test.html
- HTTP status semantics (409 conflict is the required all-or-nothing rejection path): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
- Mermaid syntax (only if adding diagrams about new endpoints): Context7 `/mermaid-js/mermaid`
- Cucumber guides index (server test suite includes Cucumber scenarios; use this for step patterns and feature syntax): https://cucumber.io/docs/guides/
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`


#### Subtasks

1. [x] Read the existing conversation archive/restore/delete plumbing:
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0`
     - Context7 `/automattic/mongoose/9.0.1`
   - Files to read:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/turn.ts`

2. [x] Add bulk endpoints and request validation:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to edit:
     - `server/src/routes/conversations.ts`
   - Required request body (example):
     ```json
     { "conversationIds": ["id1", "id2"] }
     ```
   - Required success response (example):
     ```json
     { "status": "ok", "updatedCount": 2 }
     ```
   - Required error response (example):
     ```json
     { "status": "error", "code": "BATCH_CONFLICT", "message": "Bulk operation rejected.", "details": { "invalidIds": [], "invalidStateIds": [] } }
     ```
   - Required validation behavior (HTTP 400):
     - If the request body is missing `conversationIds`, `conversationIds` is not an array, or any id is not a string, return:
       `400` JSON `{ status:"error", code:"VALIDATION_FAILED", message:"<reason>" }`.

3. [x] Implement repo-layer bulk operations without transactions (validate-first + idempotent writes):
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Required algorithm (must be followed to keep behavior deterministic):
     - Step A: Validate all ids exist and collect `invalidIds`.
     - Step B: Validate state constraints (e.g., delete must be archived-only) and collect `invalidStateIds`.
     - Step C: If either list is non-empty, return `409 BATCH_CONFLICT` and perform **no** writes.
     - Step D: Otherwise apply the bulk update/delete.
   - Delete ordering requirement:
     - Delete turns first, then delete conversations, so we do not leave orphaned turn docs.

4. [x] Server integration test: POST /conversations/bulk/archive returns 200 and updatedCount matches (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: prove bulk archive success contract and response shape.

5. [x] Server integration test: POST /conversations/bulk/restore returns 200 and updatedCount matches (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: prove bulk restore success contract and response shape.

6. [x] Server integration test: POST /conversations/bulk/delete deletes archived conversations and their turns (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Test type: server integration (node:test + SuperTest).
     - Purpose: prove hard delete removes both Conversation and Turn records.

7. [x] Server integration test: bulk endpoints reject missing conversationIds with 400 VALIDATION_FAILED (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Purpose: avoid accepting malformed input (contract guard).

8. [x] Server integration test: bulk endpoints reject non-array conversationIds with 400 VALIDATION_FAILED (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Purpose: ensure strict input validation.

9. [x] Server integration test: bulk endpoints reject non-string ids with 400 VALIDATION_FAILED (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Purpose: prevent server from attempting to coerce ids.

10. [x] Server integration test: bulk endpoints reject empty conversationIds array with 400 VALIDATION_FAILED (corner case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Purpose: prevent accidental no-op bulk calls being treated as success.

11. [x] Server integration test: bulk endpoints accept duplicate conversationIds and treat them as unique (corner case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Purpose:
     - Make the API resilient to client-side selection bugs that may send duplicates.
   - Requirements:
     - Create an archived or active conversation, then call bulk archive/restore with `[id, id]`.
     - Assert the endpoint returns `200` and `updatedCount` equals `1` (not 2), and that the resulting state is correct.

12. [x] Server integration test: bulk archive all-or-nothing conflict on invalid id (409 BATCH_CONFLICT, no writes) (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Purpose: prove all-or-nothing behavior. Assert details.invalidIds includes the missing id and nothing changes.

13. [x] Server integration test: bulk delete rejects non-archived ids (409 BATCH_CONFLICT invalidStateIds, no deletes) (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to edit:
     - `server/src/test/integration/conversations.bulk.test.ts`
   - Requirements:
     - Purpose: enforce archived-only delete guardrail. Assert nothing is deleted.

14. [x] Update `design.md` for bulk conversation actions (include Mermaid diagrams):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).
   - Requirements:
     - Add/extend a Mermaid sequence diagram covering bulk archive/restore/delete: request → validate (invalidIds/invalidStateIds) → either 200 ok or 409 BATCH_CONFLICT with no writes.
     - Document the archived-only delete guardrail and the “validate-first then write” approach (no transactions in v1).

15. [x] Update project documentation for any added/changed files:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).

16. [x] Add server log lines for bulk conversation actions so manual checks can prove archive/restore/delete are firing:
   - Files to edit:
     - `server/src/routes/conversations.ts` (bulk route handlers)
     - `server/src/logStore.ts` (use existing append helper; do not change schema)
   - Required log messages (must match exactly):
     - `conversations.bulk.request`
     - `conversations.bulk.conflict`
     - `conversations.bulk.success`
   - Required fields in `context` (as applicable):
     - `action` (archive|restore|delete)
     - `requestedCount`
     - `uniqueCount`
     - `invalidIdsCount`
     - `invalidStateIdsCount` (delete only)
     - `updatedCount` / `deletedCount`
   - Notes:
     - Log `conversations.bulk.conflict` only when returning `409 BATCH_CONFLICT`.

17. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (smoke + regression):
   - Open `/chat` and confirm the page loads.
   - Regression: existing archive/restore (single-item) still works for at least one conversation (bulk UI is Task 6; at this stage you are checking that older flows were not broken by new endpoints).
   - Open `/logs` and confirm no repeated server errors when clicking around.
   - Confirm server log lines exist for this task:
     - Perform at least one bulk request (if UI is not ready, you can use curl) and search for `conversations.bulk.request` and `conversations.bulk.success`.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-27: Reviewed existing single-item archive/restore routes and the repo persistence layer to mirror their behavior (status codes, idempotency expectations) in the new bulk endpoints.
- 2025-12-27: Added repo-layer bulk helpers (`bulkArchiveConversations`, `bulkRestoreConversations`, `bulkDeleteConversations`) implementing validate-first / all-or-nothing semantics and archived-only hard delete (turns deleted before conversations).
- 2025-12-27: Added `POST /conversations/bulk/archive|restore|delete` with strict body validation, consistent 409 conflict responses, and required `/logs` messages (`conversations.bulk.request|conflict|success`).
- 2025-12-27: Added server integration coverage for bulk archive happy path in `server/src/test/integration/conversations.bulk.test.ts`.
- 2025-12-27: Added server integration coverage for bulk restore happy path in `server/src/test/integration/conversations.bulk.test.ts`.
- 2025-12-27: Added server integration coverage for bulk delete happy path (verifies both conversation + turns removal) in `server/src/test/integration/conversations.bulk.test.ts`.
- 2025-12-27: Added server integration coverage for required 400 VALIDATION_FAILED on missing `conversationIds`.
- 2025-12-27: Added server integration coverage for required 400 VALIDATION_FAILED when `conversationIds` is not an array.
- 2025-12-27: Added server integration coverage for required 400 VALIDATION_FAILED when `conversationIds` contains non-string entries.
- 2025-12-27: Added server integration coverage for required 400 VALIDATION_FAILED when `conversationIds` is an empty array.
- 2025-12-27: Added server integration coverage ensuring duplicate ids are treated as unique (response updatedCount reflects unique selection).
- 2025-12-27: Added server integration coverage proving all-or-nothing 409 conflict behavior (invalidIds populated, no state changes).
- 2025-12-27: Added server integration coverage enforcing archived-only hard delete (invalidStateIds populated, no deletes performed).
- 2025-12-27: Updated `design.md` with bulk conversation endpoint contract and Mermaid sequence diagram covering validate-first + all-or-nothing conflict semantics.
- 2025-12-27: Updated `projectStructure.md` to include the new bulk conversations integration test file.
- 2025-12-27: Ran `npm run lint --workspaces` (fixed explicit-any lint issue), then ran `npm run format:check --workspaces` (fixed server formatting via `npm run format --workspaces`).
- 2025-12-27: Testing: `npm run build --workspace server` passed.
- 2025-12-27: Testing: `npm run build --workspace client` passed.
- 2025-12-27: Testing: `npm run test --workspace server` passed.
- 2025-12-27: Testing: `npm run test --workspace client` passed.
- 2025-12-27: Testing: `npm run e2e` passed.
- 2025-12-27: Testing: `npm run compose:build` passed.
- 2025-12-27: Testing: `npm run compose:up` passed.
- 2025-12-27: Testing: Smoke-checked `http://host.docker.internal:5001/chat` + `http://host.docker.internal:5001/logs`, verified single-item archive/restore still works, then issued a bulk archive via curl and confirmed `/logs` contains `conversations.bulk.request` + `conversations.bulk.success`.
- 2025-12-27: Testing: `npm run compose:down` passed.

---

### 3. WebSocket server foundation

- Task Status: **__done__**
- Git Commits: 3210d97
#### Overview

Introduce the `/ws` WebSocket server on the existing Express port with protocol versioning, ping/pong heartbeats, and subscription tracking for sidebar and conversation streams.

#### Documentation Locations

- `ws` 8.18.3 (server) docs (WebSocketServer, upgrade handling, handleUpgrade, connection/message events): Context7 `/websockets/ws/8_18_3` and https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
- Node.js HTTP server upgrade event (attach WS upgrade handling on the existing Express port): https://nodejs.org/api/http.html#event-upgrade
- WebSocket protocol basics (context for ping/pong + JSON message framing): https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Mermaid syntax (required for updating design diagrams in this task): Context7 `/mermaid-js/mermaid`
- Express 5 server startup patterns (refactoring app.listen to http.createServer(app).listen): https://expressjs.com/en/5x/api.html
- Pino logging (server uses structured logs; use child loggers/bindings for WS lifecycle logs): Context7 `/pinojs/pino/v10.1.0` and Context7 `/pinojs/pino-http`
- Node.js test runner (writing WS unit tests with proper teardown): https://nodejs.org/api/test.html
- Cucumber guides index (server test suite includes Cucumber scenarios; use this for step patterns and feature syntax): https://cucumber.io/docs/guides/
- Tooling references (installing deps + verification): https://docs.npmjs.com/cli/v10/commands/npm-install, https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`


#### Subtasks

1. [x] Confirm where the HTTP server is created and how to attach WebSocket upgrade handling:
   - Docs to read:
     - https://nodejs.org/api/http.html#event-upgrade
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to read:
     - `server/src/index.ts`
   - Requirements:
     - In `server/src/index.ts`, `app.listen(Number(PORT), ...)` is called inside the `start()` function near the bottom of the file; this is what must be replaced with `http.createServer(app).listen(...)` so we can handle `upgrade` for `/ws`.

2. [x] Add `ws` as a server runtime dependency (do not rely on transitive lockfile deps):
   - Docs to read:
     - Context7 `/websockets/ws/8_18_3`
   - Commands to run:
     - `npm install --workspace server ws@8.18.3`
   - Files to verify:
     - `server/package.json` (should list `ws` under `dependencies`)
     - `package-lock.json` (should include `node_modules/ws`)

3. [x] Create a minimal `/ws` server module and wire it into the Node HTTP server upgrade flow:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
     - https://nodejs.org/api/http.html#event-upgrade
   - Files to edit:
     - Create `server/src/ws/server.ts`
     - Update `server/src/index.ts`
   - Implementation sketch (copy/paste then adapt):
     ```ts
     // server/src/index.ts (sketch)
     import { createServer } from 'node:http';
     // ... build express app as today ...
     const httpServer = createServer(app);
     attachWs({ httpServer });
     httpServer.listen(Number(PORT), () => baseLogger.info(`Server on ${PORT}`));
     ```
   - Requirements:
     - WebSocket endpoint path is `GET /ws` on the same port as the Express server.
     - Keep ping/pong **optional** (v1 de-risking): if you implement it, do not force-disconnect clients aggressively; rely on standard `close`/`error` handling.
     - No auth/CSRF/origin checks in this story.

4. [x] Define WS protocol types and JSON shapes in one place so client/tests can mirror them:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to edit:
     - Create `server/src/ws/types.ts`
   - Required message envelope (must be enforced):
     ```json
     { "protocolVersion": "v1", "requestId": "<uuid>", "type": "subscribe_sidebar" }
     ```
   - Required inbound message `type` values (v1):
     - `subscribe_sidebar`, `unsubscribe_sidebar`
     - `subscribe_conversation`, `unsubscribe_conversation`
     - `cancel_inflight`

5. [x] Implement subscription tracking (registry) with explicit data structures:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - Create `server/src/ws/registry.ts`
   - Requirements:
     - Track which sockets have sidebar subscription enabled.
     - Track which sockets are subscribed to which `conversationId`.
     - Provide helpers like `subscribeSidebar(ws)`, `unsubscribeSidebar(ws)`, `subscribeConversation(ws, id)` etc.

6. [x] Implement sidebar publisher wiring (repo events bus → WS broadcast) with explicit event payloads:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to read:
     - `server/src/logStore.ts` (subscribe/unsubscribe pattern reference)
   - Files to edit:
     - Create `server/src/mongo/events.ts` (conversation upsert/delete event bus)
     - Create `server/src/ws/sidebar.ts` (broadcast implementation)
     - Update `server/src/ws/server.ts` (hook publisher into incoming messages + connection lifecycle)
   - Required outbound sidebar events (examples):
     ```json
     { "protocolVersion":"v1", "type":"conversation_upsert", "seq": 1, "conversation": { "conversationId":"...", "title":"...", "archived": false, "lastMessageAt":"..." } }
     ```
     ```json
     { "protocolVersion":"v1", "type":"conversation_delete", "seq": 2, "conversationId":"..." }
     ```
   - Requirements:
     - `seq` must be monotonically increasing for sidebar events.
     - Sidebar snapshot remains REST-first; `sidebar_snapshot` is optional and not required for v1.

7. [x] Server unit test: WS accepts connection on /ws and processes JSON message (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/test/unit/ws-server.test.ts`
   - Requirements:
     - Purpose: prove basic wiring and message handling works.

8. [x] Server unit test: invalid/missing protocolVersion closes socket (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/test/unit/ws-server.test.ts`
   - Requirements:
     - Purpose: enforce protocolVersion gating.

9. [x] Server unit test: malformed JSON closes socket (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/test/unit/ws-server.test.ts`
   - Requirements:
     - Purpose: ensure bad payloads do not crash the server.

10. [x] Server unit test: unknown message type is ignored (connection stays open) (corner case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/test/unit/ws-server.test.ts`
   - Requirements:
     - Purpose: forward compatibility.

11. [x] Server unit test: subscribe_conversation missing conversationId is rejected (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/test/unit/ws-server.test.ts`
   - Requirements:
     - Purpose: strict inbound validation.

12. [x] Update `design.md` with the new WebSocket transport and subscription flows (include Mermaid diagrams):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to edit:
     - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).
   - Requirements:
     - Add/extend a Mermaid sequence diagram for: client connects to `GET /ws` → subscribe_sidebar / subscribe_conversation → server broadcasts `conversation_upsert` and transcript events to subscribers.
     - Note that protocol gating uses `protocolVersion: "v1"` and malformed JSON closes the socket.

13. [x] Update `projectStructure.md` with newly added server WebSocket modules:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).
   - Requirements:
     - This task adds new files. `projectStructure.md` must explicitly list every added file from this task.
     - Expected file additions (must be reflected in `projectStructure.md`):
       - `server/src/ws/server.ts`
       - `server/src/ws/types.ts`
       - `server/src/ws/registry.ts`
       - `server/src/ws/sidebar.ts`
       - `server/src/mongo/events.ts`
     - If you add/remove any additional WS modules while implementing this task, include those exact paths too.

14. [x] Add server log lines for WS connect/subscription lifecycle so manual checks can prove the WS plumbing is active:
   - Files to edit:
     - `server/src/ws/server.ts`
     - `server/src/logStore.ts` (use existing append helper; do not change schema)
   - Required log messages (must match exactly):
     - `chat.ws.connect`
     - `chat.ws.disconnect`
     - `chat.ws.subscribe_sidebar`
     - `chat.ws.unsubscribe_sidebar`
     - `chat.ws.subscribe_conversation`
     - `chat.ws.unsubscribe_conversation`
   - Required fields in `context` (as applicable):
     - `connectionId` (a generated id for the socket)
     - `conversationId` (for conversation subscribe/unsubscribe)
     - `subscribedSidebar` (boolean)
     - `subscribedConversationCount`
   - Notes:
     - These log lines must be written into the server `/logs` store (not console-only), so the UI can query them.

15. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (smoke + regression):
   - Open `/chat` and confirm the page loads.
   - Regression: existing chat send still works (streaming transport changes are introduced later; this task should not break basic server startup).
   - If you have time: open `/logs` and confirm no new persistent errors related to WS startup.
   - Confirm server log lines exist for this task:
     - Search for `chat.ws.connect` and `chat.ws.subscribe_conversation` after opening `/chat`.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-27: Started Task 3.
- 2025-12-27: Refactored `server/src/index.ts` to use `http.createServer(app).listen(...)` so the process can later attach WebSocket `upgrade` handling on the same port.
- 2025-12-27: Added `ws@8.18.3` to `server/package.json` dependencies and updated `package-lock.json`.
- 2025-12-27: Added `server/src/ws/server.ts` and wired it into `server/src/index.ts` via the Node `upgrade` event so `GET /ws` is handled on the existing HTTP port.
- 2025-12-27: Added `server/src/ws/types.ts` defining the v1 message envelope + inbound message parsing (protocol gating, validation, and forward-compatible unknown type handling).
- 2025-12-27: Added `server/src/ws/registry.ts` for tracking sidebar + per-conversation WS subscriptions.
- 2025-12-27: Added conversation event bus (`server/src/mongo/events.ts`) and WS sidebar broadcaster (`server/src/ws/sidebar.ts`), then wired it into `server/src/ws/server.ts`.
- 2025-12-27: Added WS unit coverage in `server/src/test/unit/ws-server.test.ts` for protocol gating, malformed JSON handling, forward-compatible message ignoring, and basic subscribe→broadcast wiring.
- 2025-12-27: Updated `design.md` to document `GET /ws` v1 protocol gating + subscribe_sidebar/subscribe_conversation flows and the sidebar broadcast contract.
- 2025-12-27: Updated `projectStructure.md` to list the newly added WS modules and the new WS unit test.
- 2025-12-27: Added required `/logs` entries for WS connect/disconnect and subscription lifecycle (`chat.ws.*`) in `server/src/ws/server.ts`.
- 2025-12-27: Ran `npm run lint --workspaces` (fixed import ordering warnings) and `npm run format:check --workspaces` (fixed via `npm run format --workspaces`).
- 2025-12-27: Testing: `npm run build --workspace server` passed.
- 2025-12-27: Testing: `npm run build --workspace client` passed.
- 2025-12-27: Testing: `npm run test --workspace server` passed.
- 2025-12-27: Testing: `npm run test --workspace client` passed.
- 2025-12-27: Testing: `npm run e2e` passed.
- 2025-12-27: Testing: `npm run compose:build` passed.
- 2025-12-27: Testing: `npm run compose:up` passed.
- 2025-12-27: Testing: Smoke-checked `http://host.docker.internal:5001/chat` and `http://host.docker.internal:5001/logs` load, confirmed `GET http://host.docker.internal:5010/health` and `GET http://host.docker.internal:5010/chat/providers` return 200, then opened a WS client to `ws://host.docker.internal:5010/ws` and verified `/logs` contains `chat.ws.connect` and `chat.ws.subscribe_conversation`.
- 2025-12-27: Testing: `npm run compose:down` passed.

---

### 4. Chat WebSocket streaming publisher

- Task Status: **__done__**
- Git Commits: 2a890cc
#### Overview

Refactor chat execution so `POST /chat` is a non-streaming start request, then publish all chat deltas/tool events/finals over WebSockets using an in-flight registry and per-conversation run lock. Remove chat SSE from the server.

#### Documentation Locations

- Express 5 docs (POST /chat start-run contract + background execution patterns): https://expressjs.com/en/5x/api.html
- Zod v3 validation (route validators for POST /chat request + stable error payloads): Context7 `/websites/v3_zod_dev`
- `ws` 8.18.3 (server) docs (broadcasting transcript events, inbound message handling): Context7 `/websockets/ws/8_18_3` and https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
- Node.js AbortController (provider cancellation + cancel_inflight mapping): https://nodejs.org/api/globals.html#class-abortcontroller
- Node.js UUID generation (recommended for inflightId / requestId if you use crypto.randomUUID()): https://nodejs.org/api/crypto.html#cryptorandomuuidoptions
- Mongoose v9 persistence docs (updating conversation flags + turn persistence while streaming): Context7 `/automattic/mongoose/9.0.1`
- Pino logging (adding required chat.* log names with structured fields): Context7 `/pinojs/pino/v10.1.0`
- HTTP status semantics for the contract (202 accepted + 409 conflict): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202 and https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
- Mermaid syntax (required for updating design diagrams in this task): Context7 `/mermaid-js/mermaid`
- Cucumber guides index (start here, then follow specific guides): https://cucumber.io/docs/guides/
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`


#### Subtasks

1. [x] Locate the current chat SSE implementation and identify which parts must change to “start-run + WS stream”:
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/routes/chat.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Requirements:
     - In `server/src/routes/chat.ts`, chat streaming is implemented via `startStream(res)` and `writeEvent(res, ...)` (from `server/src/chatStream.ts`), and provider events are wired via `chat.on("token"|"analysis"|"tool-request"|"tool-result"|"final"|"thread"|"complete"|"error")`.

2. [x] Enforce one in-flight run per conversation by reusing the existing shared run lock:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to read:
     - `server/src/agents/runLock.ts`
   - Files to edit:
     - `server/src/routes/chat.ts`
   - Required error response (example):
     ```json
     { "status":"error", "code":"RUN_IN_PROGRESS", "message":"Conversation already has an active run." }
     ```

3. [x] Implement an in-flight registry (single authoritative in-memory store for streaming state):
   - Docs to read:
     - https://nodejs.org/api/globals.html#class-abortcontroller
   - Files to edit:
     - Create `server/src/chat/inflightRegistry.ts`
   - Required state to track per `conversationId`:
     - `inflightId`
     - `assistantText` (so late subscribers can catch up)
     - `assistantThink` (streamed reasoning/analysis so far; used by Codex `analysis` frames)
     - `toolEvents` (so late subscribers see interim tool progress)
     - `startedAt` (ISO string)
     - `abortController`
     - `seq` counter (monotonic, per conversation)
   - Implementation sketch (copy/paste then adapt):
     ```ts
     // server/src/chat/inflightRegistry.ts (sketch)
     export type InflightState = {
       inflightId: string;
       assistantText: string;
       assistantThink: string;
       toolEvents: unknown[];
       startedAt: string;
       abortController: AbortController;
       seq: number;
     };

     // key: conversationId
     const inflight = new Map<string, InflightState>();

     export function createInflight(conversationId: string, inflightId: string) {
       inflight.set(conversationId, {
         inflightId,
         assistantText: '',
         assistantThink: '',
         toolEvents: [],
         startedAt: new Date().toISOString(),
         abortController: new AbortController(),
         seq: 0,
       });
     }
     ```
   - Requirements:
     - Keep the API tiny and deterministic (get/set/append + bumpSeq + cleanup).
     - The registry must only hold state for active runs and must delete entries on completion.

4. [x] Define exact transcript event payloads for WS publishing and implement publisher helpers:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - `server/src/ws/server.ts`
   - Required outbound transcript events (examples):
     ```json
     { "protocolVersion":"v1", "type":"inflight_snapshot", "conversationId":"...", "seq": 1, "inflight": { "inflightId":"...", "assistantText":"", "assistantThink":"", "toolEvents": [], "startedAt":"2025-01-01T00:00:00.000Z" } }
     ```
     ```json
     { "protocolVersion":"v1", "type":"assistant_delta", "conversationId":"...", "seq": 2, "inflightId":"...", "delta":"hello" }
     ```
     ```json
     { "protocolVersion":"v1", "type":"analysis_delta", "conversationId":"...", "seq": 3, "inflightId":"...", "delta":"Thinking..." }
     ```
     ```json
     { "protocolVersion":"v1", "type":"tool_event", "conversationId":"...", "seq": 4, "inflightId":"...", "event": { "type":"tool-request", "callId":"1", "name":"vector_search", "parameters": {} } }
     ```
     ```json
     { "protocolVersion":"v1", "type":"turn_final", "conversationId":"...", "seq": 5, "inflightId":"...", "status":"ok", "threadId": null }
     ```

5. [x] Create a shared bridge that converts `ChatInterface` events into in-flight registry updates + WS transcript events:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to add:
     - `server/src/chat/chatStreamBridge.ts`
   - Files to read:
     - `server/src/chat/interfaces/ChatInterface.ts` (event names and payload shapes)
   - Requirements:
     - The bridge must:
       - Subscribe to `chat.on('token'|'analysis'|'tool-request'|'tool-result'|'final'|'thread'|'complete'|'error')`.
       - Update `inflightRegistry` (`assistantText`, `assistantThink`, `toolEvents`) as events arrive.
       - Publish WS transcript events (`assistant_delta`, `analysis_delta`, `tool_event`, `turn_final`) via the WS publisher helpers.
       - Publish an `inflight_snapshot` immediately when a run starts (so late subscribers can catch up deterministically).
       - Ensure `turn_final` is published exactly once and the in-flight entry is cleaned up promptly.
     - Minimal event mapping (must match existing SSE semantics):
       - `token` → `assistant_delta`
       - `analysis` → `analysis_delta` and append to `assistantThink`
       - `tool-request`/`tool-result` → `tool_event` and append to `toolEvents`
       - `final`/`complete`/`error` → `turn_final` once + cleanup
     - Implementation sketch (copy/paste then adapt):
       ```ts
       // server/src/chat/chatStreamBridge.ts (sketch)
       export function attachChatStreamBridge(params: {
         conversationId: string;
         inflightId: string;
         chat: { on: (name: string, fn: (ev: any) => void) => void };
       }) {
         // set up listeners and update registry
         // publish snapshot/deltas
         // return cleanup() that removes listeners
       }
       ```
     - The bridge must be reusable by:
       - REST chat runs (`POST /chat`),
       - Agents runs (`POST /agents/:agentName/run`), and
       - MCP `codebase_question` runs.

6. [x] Refactor `POST /chat` to be non-streaming (start only), start the run in the background, and return a `202` JSON acknowledgement:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/routes/chatValidators.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/chat/chatStreamBridge.ts`
   - Required success response (example):
     ```json
     { "status":"started", "conversationId":"...", "inflightId":"...", "provider":"codex", "model":"gpt-5.1-codex-max" }
     ```
   - Requirements:
     - The run must execute in the background (do not block the HTTP response).
     - The run must continue even if the browser navigates away or unsubscribes.
     - The run must create an in-flight entry and attach the shared bridge so WS subscribers receive transcript updates.
     - Remove `startStream(res)` / `writeEvent(res, ...)` usage for chat.

7. [x] Ensure Agents runs populate the in-flight registry and publish WS transcript updates:
   - Docs to read:
     - https://nodejs.org/api/crypto.html#cryptorandomuuidoptions
     - https://nodejs.org/api/globals.html#class-abortcontroller
   - Files to edit:
     - `server/src/agents/service.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/chat/chatStreamBridge.ts`
   - Requirements:
     - When an agent run starts, generate an `inflightId` (use `crypto.randomUUID()` when the caller did not supply one).
     - Refactor `server/src/agents/service.ts` so its ChatInterface factory is injectable for tests (default to existing `getChatInterface`):
       - This avoids requiring real Codex availability in server test runs.
     - Create the in-flight registry entry before calling `chat.run(...)`.
     - Attach the shared bridge so WS subscribers see the same live transcript/tool events as `/chat`.
     - Ensure `turn_final` is published on success, cancellation, and failure.

8. [x] Ensure MCP `codebase_question` runs populate the in-flight registry and publish WS transcript updates (without changing MCP JSON-RPC response formats):
   - Docs to read:
     - https://nodejs.org/api/crypto.html#cryptorandomuuidoptions
     - https://nodejs.org/api/globals.html#class-abortcontroller
   - Files to edit:
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/chat/chatStreamBridge.ts`
   - Requirements:
     - Generate a stable `inflightId` per MCP run (use `crypto.randomUUID()`).
     - Create the in-flight registry entry before calling `chat.run(...)`.
     - Attach the shared bridge so WS subscribers can view the in-progress transcript when they open the MCP-created conversation in the UI.
     - Do not change the JSON-RPC tool payload structure returned by `McpResponder`.

9. [x] Implement WS inbound `cancel_inflight` handling and map it to provider abortion:
   - Docs to read:
     - https://nodejs.org/api/globals.html#class-abortcontroller
   - Files to edit:
     - `server/src/ws/server.ts` (message handler)
     - `server/src/chat/inflightRegistry.ts` (abort logic)
   - Required inbound cancel message (example):
     ```json
     { "protocolVersion":"v1", "requestId":"<uuid>", "type":"cancel_inflight", "conversationId":"...", "inflightId":"..." }
     ```
   - Requirements:
     - If inflight is missing/mismatched, publish `turn_final` with `status:"failed"` and `error.code="INFLIGHT_NOT_FOUND"`.

10. [x] Ensure threadId continuity (Codex) is reflected in WS final events and sidebar upserts:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/mongo/repo.ts` (ensure flags updated on persist)
   - Requirements:
     - `turn_final.threadId` must be sent when available.
     - `conversation_upsert.conversation.flags.threadId` must be updated so new tabs can continue a thread.

11. [x] Ensure sidebar updates are emitted from persistence (repo) so they apply to Chat + Agents + MCP runs:
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/mongo/events.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/ws/sidebar.ts`

12. [x] Remove chat SSE response handling (but keep `/logs/stream` SSE untouched):
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/chatStream.ts` (only if it becomes unused by chat)
   - Requirements:
     - After this story, chat must not depend on SSE anywhere in client or server code.

13. [x] Add server-side WS + streaming logs (explicit names and throttling):
   - Docs to read:
     - https://nodejs.org/api/console.html
   - Files to edit:
     - `server/src/logger.ts` (if helpers are needed)
     - `server/src/ws/server.ts`
     - `server/src/routes/chat.ts`
   - Required log names (must match exactly):
     - `chat.ws.connect`, `chat.ws.disconnect`
     - `chat.ws.subscribe_sidebar`, `chat.ws.unsubscribe_sidebar`
     - `chat.ws.subscribe_conversation`, `chat.ws.unsubscribe_conversation`
     - `chat.run.started`, `chat.stream.snapshot`, `chat.stream.delta`, `chat.stream.tool_event`, `chat.stream.final`, `chat.stream.cancel`
   - Throttling rules:
     - Log the first delta and then every 25 deltas; include `deltaCount`.
     - Log tool events per event; include `toolEventCount`.

14. [x] Update `design.md` to document the new chat transport + WS transcript contract (include Mermaid diagrams):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).
   - Requirements:
     - Document that chat is WS-only (no SSE), and `POST /chat` is a 202 start-run request.
     - Document that Agents runs and MCP `codebase_question` runs also publish WS transcript events via the shared bridge (so they can be viewed live in the UI).
     - Add/extend a Mermaid sequence diagram showing: UI sends POST /chat → server emits `conversation_upsert` → viewer subscribes → `inflight_snapshot`/`assistant_delta`/`tool_event` → `turn_final`.
     - Include the Stop flow (`cancel_inflight`) and the late-subscriber catch-up rule (first event is `inflight_snapshot`).

15. [x] Update `projectStructure.md` with any added/removed server chat/WS modules:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).
   - Requirements:
     - This task adds/removes files. `projectStructure.md` must explicitly list every added file and remove any deleted file entries.
     - Expected file additions (must be reflected in `projectStructure.md`):
       - `server/src/chat/inflightRegistry.ts`
       - `server/src/chat/chatStreamBridge.ts`
     - Possible removals (only if you delete them during implementation):
       - `server/src/chatStream.ts` (SSE helper; remove only if it becomes unused and you choose to delete it)
     - If you add any additional chat/WS modules (for example additional WS publishers/helpers), include those exact paths too.

16. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`
   - Note:
     - If chat Cucumber steps fail due to transport changes, proceed to Task 5 to update them.

4. [x] `npm run test --workspace client`
   - Note:
     - If the client still expects SSE at this point, failures are expected until Tasks 7 and 9 update the client transport and tests.

5. [x] `npm run e2e`
   - Note:
     - If e2e mocks still use SSE at this point, failures are expected until Task 9 migrates e2e to `routeWebSocket`.

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task-specific):
   - Open `/chat`.
   - If Task 7 is not complete yet, the UI may still be expecting SSE; record any expected broken state as “known interim state”.
   - Once Task 7 is complete, verify chat starts via `POST /chat` (202) and transcript updates arrive via WS for the visible conversation.
   - Confirm server log lines exist for this task:
     - Search for `chat.run.started` and `chat.stream.final`.

9. [x] `npm run compose:down`

#### Implementation notes


- Testing 9: `npm run compose:down` passed.

- Testing 8: Manual smoke via `ws://host.docker.internal:5010/ws` + `POST http://host.docker.internal:5010/chat` confirmed `202 started`, `inflight_snapshot` catch-up, and `turn_final` delivery; `/logs` contains `chat.run.started` and `chat.stream.final`.

- Testing 7: `npm run compose:up` passed (services healthy).

- Testing 6: `npm run compose:build` passed.

- Testing 5: `npm run e2e` passed after fixing the e2e Mongo service init race (`docker-compose.e2e.yml` no longer mounts `init-mongo.js`, relying on healthcheck rs.initiate).

- Testing 4: `npm run test --workspace client` passed.

- Testing 3: Ran `npm run test --workspace server`. Expected failures due to Task 4 transport change (`POST /chat` now returns 202 and WS publishes transcript); failing assertions still expect SSE/200 and will be updated in Task 5.

- Testing 2: `npm run build --workspace client` passed.

- Testing 1: `npm run build --workspace server` passed.

- Testing/Lint: `npm run lint --workspaces` passed. `npm run format:check --workspaces` passed after running `npm run format --workspace server` to fix Prettier issues in the new server files.

- Subtask 15: Updated `projectStructure.md` to list the new chat WS streaming modules (`server/src/chat/inflightRegistry.ts`, `server/src/chat/chatStreamBridge.ts`).

- Subtask 14: Updated `design.md` to reflect WS-only chat streaming (`POST /chat` 202 start-run + `/ws` transcript events), including a Mermaid sequence diagram for start-run + late-subscriber catch-up and stop (`cancel_inflight`).

- Subtask 13: Added required server log names across WS lifecycle + streaming (`chat.ws.*`, `chat.run.started`, `chat.stream.*`) with delta throttling (first + every 25) and per-tool-event logging including counts.

- Subtask 12: Removed chat SSE streaming from `server/src/routes/chat.ts` (no more `startStream`/`writeEvent`); `/logs/stream` SSE remains unchanged.

- Subtask 11: Verified sidebar events already originate from `server/src/mongo/repo.ts` via `emitConversationUpsert/delete` and are broadcast by `server/src/ws/sidebar.ts`, so chat/agents/MCP persistence changes trigger live sidebar updates.

- Subtask 10: WS `turn_final` events now carry `threadId` when available via the shared stream bridge, and sidebar upserts already include `flags.threadId` via `updateConversationThreadId()` emitting repo events.

- Subtask 9: Implemented `cancel_inflight` WS handling in `server/src/ws/server.ts`, wired to `inflightRegistry.abortInflight()`, and emits a `turn_final` failure event when the inflight run is missing/mismatched.

- Subtask 8: Updated `server/src/mcp2/tools/codebaseQuestion.ts` to generate an inflightId per run, create inflight state, attach the shared WS stream bridge, and run providers using the inflight AbortController signal (MCP response shape unchanged).

- Subtask 7: Updated `server/src/agents/service.ts` to create inflight state + attach the shared WS stream bridge for agent runs, and made the ChatInterface factory injectable via `params.chatFactory` for tests.

- Subtask 2: `POST /chat` now uses the shared `tryAcquireConversationLock`/`releaseConversationLock` to enforce one active run per conversation and returns `409 RUN_IN_PROGRESS` on conflicts.

- Subtask 6: Refactored `server/src/routes/chat.ts` + `server/src/routes/chatValidators.ts` so `POST /chat` returns `202` start-run JSON, creates an inflight entry, attaches the shared WS bridge, and runs providers in the background (no chat SSE).

- Subtask 5: Added `server/src/chat/chatStreamBridge.ts` to translate ChatInterface events into inflight registry updates + WS transcript events (`inflight_snapshot`, deltas, tool_event, turn_final) with required log names/throttling.

- Subtask 4: Extended `server/src/ws/types.ts` with transcript WS event types and updated `server/src/ws/server.ts` with publisher helpers + per-subscribe `inflight_snapshot` catch-up + `cancel_inflight` handling.

- Subtask 3: Added `server/src/chat/inflightRegistry.ts` as the single in-memory source of truth for active runs (assistantText/assistantThink/toolEvents/seq + AbortController + cleanup).

- Subtask 1: Reviewed existing `server/src/routes/chat.ts` SSE streaming + event wiring; confirmed current providers emit token/analysis/tool/final/thread/complete/error and rely on `server/src/chatStream.ts`.

---

### 5. Server test updates for chat WebSockets

- Task Status: **__done__**
- Git Commits: d200678, a83bc37
#### Overview

Replace SSE-based chat tests with WebSocket-driven coverage, including `POST /chat` start responses, run-lock conflicts, and WS event sequencing.

#### Documentation Locations

- Node.js test runner (node:test is used for unit/integration assertions in this repo): https://nodejs.org/api/test.html
- SuperTest (transport-accurate assertions for POST /chat 202 JSON + REST endpoints): Context7 `/ladjs/supertest`
- `ws` 8.18.3 (client + server) docs (WS test helper WebSocket usage, events, teardown): Context7 `/websockets/ws/8_18_3` and https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
- Cucumber guides index (start here, then follow specific guides): https://cucumber.io/docs/guides/
- Cucumber (use guides for runnable examples + step definition patterns): https://cucumber.io/docs/guides/10-minute-tutorial/ and https://cucumber.io/docs/guides/continuous-integration/
- HTTP status semantics (202 start-run, 409 run-lock conflict): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202 and https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`


#### Subtasks

1. [x] Confirm which server tests currently assume chat SSE streaming (so you can update every broken feature in this task):
   - Docs to read:
     - https://cucumber.io/docs/guides/10-minute-tutorial/
   - Files to read:
     - `server/src/test/features/chat_stream.feature`
     - `server/src/test/steps/chat_stream.steps.ts`
     - `server/src/test/features/chat_cancellation.feature`
     - `server/src/test/steps/chat_cancellation.steps.ts`
     - `server/src/test/features/chat-tools-visibility.feature`
     - `server/src/test/steps/chat-tools-visibility.steps.ts`
   - Requirements:
     - These are the SSE-specific patterns you must remove:
       - `server/src/test/steps/chat_stream.steps.ts`:
         - Step `When I POST to the chat endpoint with the chat request fixture` parses `text/event-stream` frames by reading `res.body.getReader()`.
         - Step `When I POST to the chat endpoint with a two-message chat history` relies on `POST /chat` keeping the stream open and finishing cleanly.
         - The `Then ... streamed events ...` assertions depend on `token/final/complete/error/tool-request/tool-result` SSE event types.
       - `server/src/test/steps/chat_cancellation.steps.ts`:
         - Step `When I start a chat stream and abort after first token` uses `AbortController` to abort the HTTP request and expects server-side cancellation.
       - `server/src/test/steps/chat-tools-visibility.steps.ts`:
         - Step `When I stream the chat endpoint with the chat request fixture` parses SSE frames and asserts tool event shapes.
     - After this story, `POST /chat` is `202` JSON (no SSE body) and live updates must be observed via `/ws`.

2. [x] Update the chat streaming feature description to match the new transport contract:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `server/src/test/features/chat_stream.feature`
   - Required contract text (must be reflected in scenarios):
     - HTTP: `POST /chat` returns `202` JSON `{ status:"started", conversationId, inflightId, provider, model }`.
     - Streaming: tokens/tool events/final arrive via `/ws` transcript events.

3. [x] Add a reusable WS test client helper for server-side tests (so step defs do not re-implement WS parsing):
   - Docs to read:
     - Context7 `/websockets/ws/8_18_3`
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to add:
     - `server/src/test/support/wsClient.ts`
   - Implementation sketch (copy/paste then adapt):
     ```ts
     // wsClient.ts (sketch)
     import WebSocket from 'ws';
     export function connectWs(baseUrl: string) {
       const ws = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws");
       // add sendJson(msg), nextEvent(predicate, timeoutMs)
       return ws;
     }
     ```
   - Requirements:
     - Provide `sendJson` that always adds `protocolVersion:"v1"` and a `requestId`.
     - Provide `waitForEvent` that can match on `{ type, conversationId, inflightId }`.

4. [x] Rewrite chat streaming step defs to use `POST /chat` and WS events:
   - Docs to read:
     - https://cucumber.io/docs/guides/10-minute-tutorial/
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - `server/src/test/steps/chat_stream.steps.ts`
   - Requirements:
     - Update the Cucumber test server bootstrapping in `Before(...)`:
       - Today the step file uses `app.listen(0, ...)` and only mounts `/chat`.
       - For WS-based assertions, replace this with a Node HTTP server and attach `/ws`:
         - Import the WS attach helper from `server/src/ws/server.ts` (created in Task 3).
         - Use `createServer(app)` and call `attachWs({ httpServer })` before `listen(...)`.
     - Start the run via HTTP and assert the `202` JSON body shape.
     - Subscribe via WS and assert at least one transcript event arrives and a `turn_final` arrives.
     - Do not attempt detailed `seq` ordering checks in Cucumber (those are validated in node:test).

5. [x] Rewrite cancellation feature to match “unsubscribe does not cancel; cancel_inflight cancels”:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to edit:
     - `server/src/test/features/chat_cancellation.feature`
   - Requirements:
     - Remove any assumption that aborting an HTTP request cancels generation.
     - Ensure the scenario asserts `cancel_inflight` is required.

6. [x] Rewrite cancellation step defs to send `cancel_inflight` and assert the final status:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - `server/src/test/steps/chat_cancellation.steps.ts`
   - Required cancel message (example):
     ```json
     { "protocolVersion":"v1", "requestId":"<uuid>", "type":"cancel_inflight", "conversationId":"...", "inflightId":"..." }
     ```
   - Requirements:
     - Update the Cucumber test server `Before(...)` hook to attach the `/ws` server (same approach as Subtask 4):
       - Use `createServer(app)` and `attachWs({ httpServer })`.
       - Cancellation is asserted via WS `turn_final` status, not via aborting the HTTP request.

7. [x] Update the tool visibility feature to match “POST /chat starts; tools stream over WS”:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `server/src/test/features/chat-tools-visibility.feature`
   - Requirements:
     - HTTP: `POST /chat` returns `202` JSON `{ status:"started", conversationId, inflightId, provider, model }`.
     - Streaming: tool request/result visibility must be asserted via `tool_event` WS transcript events.

8. [x] Rewrite tool visibility step defs to subscribe via WS and assert `tool_event` contents:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - `server/src/test/steps/chat-tools-visibility.steps.ts`
   - Requirements:
     - Update the Cucumber test server `Before(...)` hook to attach the `/ws` server (same approach as Subtask 4).
     - Use the shared `wsClient.ts` helper for connecting + waiting for events.
     - Assert at least one `tool_event` arrives and it contains:
       - `event.type` of `tool-request` and `tool-result`.
       - `event.callId` and `event.name` values preserved from existing fixtures.
     - Keep the existing assertions that tool events were logged to the log store.

9. [x] Server unit/integration tests: update chat-unsupported-provider.test.ts for 400 UNSUPPORTED_PROVIDER + no SSE (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/chat-unsupported-provider.test.ts`
   - Requirements:
     - Purpose: transport-accurate unsupported provider behavior.

10. [x] Server integration tests: update chat-codex.test.ts for 202 JSON start-run contract (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/chat-codex.test.ts`
   - Requirements:
     - Purpose: ensure main chat path is 202 JSON and WS streaming supplies transcript.

11. [x] Server integration tests: update chat-vectorsearch-locked-model.test.ts for 202 JSON and error responses (error cases)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`
   - Requirements:
     - Purpose: ensure locked model / provider failures return stable status+code payloads.

12. [x] Server unit test (node:test): transcript `seq` increases monotonically per conversation stream (corner case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to add:
     - `server/src/test/unit/ws-chat-stream.test.ts`
   - Files to read (for patterns to reuse):
     - `server/src/test/unit/ws-server.test.ts`
     - `server/src/test/support/wsClient.ts`
   - Purpose:
     - Prevent UI glitches when late/stale transcript events arrive.
   - Requirements:
     - Subscribe to a conversation and assert that `seq` for transcript events (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`) never decreases.

13. [x] Server unit test (node:test): late-subscriber catch-up begins with `inflight_snapshot` containing current partial state (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to add:
     - `server/src/test/unit/ws-chat-stream.test.ts`
   - Files to read (for fixtures / expectations):
     - `common/src/fixtures/chatStream.ts`
   - Purpose:
     - Ensure switching tabs/windows mid-stream shows the same transcript as the originating view.
   - Requirements:
     - Start a run, then connect a second WS client and `subscribe_conversation` mid-stream.
     - Assert the first transcript event received is `inflight_snapshot` with non-empty `assistantText` and `assistantThink` (if analysis was emitted) plus any `toolEvents` emitted so far.

14. [x] Server unit test (node:test): `analysis_delta` events update in-flight `assistantThink` and appear in `inflight_snapshot` (corner case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to add:
     - `server/src/test/unit/ws-chat-stream.test.ts`
   - Purpose:
     - Prevent regressions where Codex analysis frames are dropped (the client has existing reasoning UI/tests).
   - Requirements:
     - Start a run using a deterministic provider/test double that emits at least one `analysis` event.
     - Subscribe mid-run and assert the initial `inflight_snapshot.inflight.assistantThink` is non-empty.
     - Assert at least one `analysis_delta` event arrives with increasing `seq`.

15. [x] Server unit test (node:test): `cancel_inflight` with wrong/missing inflightId yields `turn_final` failed + `INFLIGHT_NOT_FOUND` (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to add:
     - `server/src/test/unit/ws-chat-stream.test.ts`
   - Purpose:
     - Make Stop-button failures deterministic and user-visible (no silent hangs).
   - Requirements:
     - Send `cancel_inflight` for a valid conversationId but an invalid inflightId.
     - Assert a `turn_final` event arrives with `status:"failed"` and `error.code:"INFLIGHT_NOT_FOUND"`.

16. [x] Server unit test (node:test): `unsubscribe_conversation` does not cancel provider generation; completion still persists turns (corner case)
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/unit/ws-chat-stream.test.ts`
   - Files to read:
     - `server/src/mongo/repo.ts` (turn persistence)
   - Purpose:
     - Ensure navigation away from Chat page stops viewing updates without stopping the underlying run.
   - Requirements:
     - Subscribe then immediately unsubscribe from a conversation while it is streaming.
     - Verify the run still completes and the final turn is persisted (via repo read or REST turns fetch).

17. [x] Server integration test (node:test): `POST /chat` run proceeds with zero WS subscribers and still persists turns (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/chat-codex.test.ts`
   - Purpose:
     - Prove the “POST /chat does not require an active WebSocket connection” contract.
   - Requirements:
     - Start a chat run via HTTP.
     - Do not open a WebSocket client at all.
     - Wait for completion (using deterministic mocked provider or polling stored turns).
     - Assert the user + assistant turns were persisted.

18. [x] Server integration test (node:test): `POST /chat` returns 409 RUN_IN_PROGRESS when a run is already active for the conversation (error case)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to edit:
     - `server/src/test/integration/chat-codex.test.ts`
   - Purpose:
     - Prevent interleaved persistence and out-of-order WS events.
   - Requirements:
     - Start a run for a conversationId.
     - Immediately attempt to start a second run for the same conversationId.
     - Assert the second request returns `409` with `{ status:"error", code:"RUN_IN_PROGRESS" }`.

19. [x] Server unit test (node:test): in-flight registry entry is removed after `turn_final` (corner case)
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/unit/ws-chat-stream.test.ts`
   - Files to read:
     - `server/src/chat/inflightRegistry.ts`
   - Purpose:
     - Avoid memory leaks when many conversations stream over time.
   - Requirements:
     - Start a run, await `turn_final`, then assert the registry no longer returns an entry for the conversationId.

20. [x] Server integration test (node:test): MCP `codebase_question` publishes WS transcript events while the tool call is in progress (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to add:
     - `server/src/test/integration/mcp-codebase-question-ws-stream.test.ts`
   - Files to read:
     - `server/src/mcp2/tools/codebaseQuestion.ts` (how conversationId is chosen)
     - `server/src/mcp2/server.ts` (MCP v2 runs on a separate HTTP server/port)
     - `server/src/mcp2/router.ts` (JSON-RPC request handling)
   - Purpose:
     - Prove MCP-sourced conversations can be viewed live in the Chat UI via the same WS transcript contract.
   - Requirements:
     - Start a WS client and subscribe to a known `conversationId`.
     - Trigger `codebase_question` via JSON-RPC tool call using that same `conversationId`.
     - Assert receipt of `inflight_snapshot` then at least one `assistant_delta`/`analysis_delta` (depending on provider) and a `turn_final`.

21. [x] Server integration test (node:test): Agents runs publish WS transcript events while the run is in progress (happy path)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to add:
     - `server/src/test/integration/agents-run-ws-stream.test.ts`
   - Files to read:
     - `server/src/routes/agentsRun.ts` (request shape)
     - `server/src/agents/service.ts` (stream bridge attachment)
   - Purpose:
     - Prove agent-initiated conversations can be viewed live across windows (server side).
   - Requirements:
     - Use a deterministic `conversationId` in the agent run request.
     - Start a WS client and subscribe to that `conversationId` before or immediately after starting the run.
     - Assert receipt of `inflight_snapshot` then transcript events and a `turn_final`.

22. [x] Server integration test (node:test): server emits WS lifecycle logs into `/logs` (observability / debug safety)
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to add:
     - `server/src/test/integration/ws-logs.test.ts`
   - Files to read:
     - `server/src/routes/logs.ts` (GET /logs query)
   - Purpose:
     - Ensure required server log messages (`chat.ws.connect`, `chat.ws.subscribe_conversation`, etc.) are actually queryable via the logs store.
   - Requirements:
     - Open a WS connection and subscribe to a conversation.
     - Query `GET /logs?source=server&text=chat.ws.connect` and assert at least one matching log entry exists.


23. [x] Ensure WS connections are closed during teardown so test runs do not leak handles:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/support/*`
   - Requirements:
     - Explicitly close sockets in `afterEach`/`after` hooks.

24. [x] Update `projectStructure.md` with any added/removed server test support files:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).
   - Requirements:
     - This task adds new files. `projectStructure.md` must explicitly list every added file from this task.
     - Expected file additions (must be reflected in `projectStructure.md`):
       - `server/src/test/support/wsClient.ts`
       - `server/src/test/unit/ws-chat-stream.test.ts`
       - `server/src/test/integration/mcp-codebase-question-ws-stream.test.ts`
       - `server/src/test/integration/agents-run-ws-stream.test.ts`
       - `server/src/test/integration/ws-logs.test.ts`
     - If you add additional WS/Cucumber helpers during implementation (for example extra test utilities under `server/src/test/support/`), include those exact paths too.

25. [x] Ensure server WS/stream log lines required by this story are present and emitted during real UI usage (add missing ones if implementation drift occurred):
   - Files to verify:
     - `server/src/ws/server.ts`
     - `server/src/routes/chat.ts`
   - If missing, files to edit:
     - `server/src/ws/server.ts`
     - `server/src/routes/chat.ts`
     - `server/src/logStore.ts` (use existing append helper; do not change schema)
   - Required log messages (must match exactly):
     - `chat.ws.connect`
     - `chat.ws.subscribe_conversation`
     - `chat.stream.snapshot`
     - `chat.stream.final`
     - `chat.stream.cancel`
   - Purpose:
     - Manual Playwright-MCP checks rely on these logs to confirm that WS-only streaming is actually happening.

26. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task-specific):
   - Open `/chat` and send a message.
   - Verify chat stream/cancellation/tool-visibility behaviors are now stable after the WS test migration:
     - You can start a run and observe a live in-flight update.
     - Stop/cancel works (no hangs).
     - Tool events are visible when a tool is invoked.
   - Confirm server log lines exist for this task:
     - Search for `chat.ws.connect`, `chat.stream.snapshot`, and `chat.stream.final`.

9. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Reviewed `server/src/test/features/chat_stream.feature`, `server/src/test/features/chat_cancellation.feature`, and `server/src/test/features/chat-tools-visibility.feature` plus their step definitions; confirmed they all rely on SSE frame parsing (`res.body.getReader()`) and/or HTTP abort-based cancellation assumptions that no longer apply now that `POST /chat` returns `202` and live updates happen over `/ws`.

- Subtask 2: Updated `server/src/test/features/chat_stream.feature` scenarios to assert the new transport contract (`POST /chat` returns `202` JSON and transcript/tool/final signals are verified via `/ws` events).

- Subtask 3: Added `server/src/test/support/wsClient.ts` with `connectWs`, `sendJson`, and `waitForEvent` helpers plus explicit close utilities to reduce duplicated WS parsing/teardown logic across Cucumber + node:test.

- Subtask 4: Rewrote `server/src/test/steps/chat_stream.steps.ts` to start runs via `POST /chat` (202 JSON) and assert transcript/tool/final behavior via `/ws` (`subscribe_conversation` + `inflight_snapshot`/`tool_event`/`turn_final`) using the shared WS test client helper.

- Subtask 5: Updated `server/src/test/features/chat_cancellation.feature` to reflect the new semantics: unsubscribing does not cancel a run; cancellation is explicit via `cancel_inflight`.

- Subtask 6: Rewrote `server/src/test/steps/chat_cancellation.steps.ts` to attach `/ws` in the Cucumber server and assert cancellation via a `cancel_inflight` message followed by `turn_final` (status `stopped`).

- Subtask 7: Updated `server/src/test/features/chat-tools-visibility.feature` to describe the WS-only streaming contract.

- Subtask 8: Rewrote `server/src/test/steps/chat-tools-visibility.steps.ts` to subscribe via `/ws` and assert `tool_event` payloads (tool-request + tool-result) while keeping the log-store assertions (now keyed on `chat.stream.tool_event`).

- Subtask 9: Updated `server/src/test/unit/chat-unsupported-provider.test.ts` to assert the new JSON error shape (`status:error`, `code:UNSUPPORTED_PROVIDER`) rather than the legacy SSE-era fields.

- Subtask 10: Updated `server/src/test/integration/chat-codex.test.ts` to assert `POST /chat` returns `202` JSON and that Codex runs publish transcript updates via `/ws` (`inflight_snapshot` + `assistant_delta` + `turn_final` with threadId).

- Subtask 11: Updated `server/src/test/integration/chat-vectorsearch-locked-model.test.ts` to stop parsing SSE and instead assert WS `turn_final` failures (INGEST_REQUIRED) and WS `tool_event` tool-result payloads after a `202` start response.

- Subtask 12: Added `server/src/test/unit/ws-chat-stream.test.ts` coverage asserting transcript `seq` never decreases for a single conversation stream.

- Subtask 13: Added `server/src/test/unit/ws-chat-stream.test.ts` coverage for late-subscriber catch-up, asserting the first event is `inflight_snapshot` and it contains partial assistant/tool state.

- Subtask 14: Added `server/src/test/unit/ws-chat-stream.test.ts` coverage for analysis streaming, asserting `analysis_delta` arrives and `assistantThink` is present in late-subscriber `inflight_snapshot`.

- Subtask 15: Added `server/src/test/unit/ws-chat-stream.test.ts` coverage asserting invalid `cancel_inflight` requests yield `turn_final` with `status:"failed"` and `error.code:"INFLIGHT_NOT_FOUND"`.

- Subtask 16: Added `server/src/test/unit/ws-chat-stream.test.ts` coverage asserting `unsubscribe_conversation` does not abort generation and the assistant turn still persists via memory persistence.

- Subtask 19: Added `server/src/test/unit/ws-chat-stream.test.ts` coverage asserting the in-flight registry entry is removed after `turn_final`.

- Subtask 17: Extended `server/src/test/integration/chat-codex.test.ts` to prove runs persist turns even with zero WS subscribers by polling memory persistence until an assistant turn exists.

- Subtask 18: Extended `server/src/test/integration/chat-codex.test.ts` with a slow Codex test double to deterministically assert `409` `{ status:"error", code:"RUN_IN_PROGRESS" }` while a run lock is held.

- Subtask 20: Added `server/src/test/integration/mcp-codebase-question-ws-stream.test.ts` to assert that a `tools/call` JSON-RPC invocation of `codebase_question` produces live `/ws` transcript events (`inflight_snapshot` → `assistant_delta` → `turn_final`) while the HTTP tool request is still in flight.

- Subtask 21: Added `server/src/test/integration/agents-run-ws-stream.test.ts` to assert agent runs stream transcript updates over `/ws` (using an injected ChatInterface test double to avoid requiring a real Codex runtime).

- Subtask 22: Added `server/src/test/integration/ws-logs.test.ts` to assert WS lifecycle log messages (e.g. `chat.ws.connect`) are retrievable via `GET /logs`.

- Subtask 23: Standardized explicit WS teardown across new tests/step-defs via `server/src/test/support/wsClient.ts` (`closeWs`/`waitForClose`) and ensured HTTP + WS server handles are closed in `afterEach`/`After` hooks.

- Subtask 24: Updated `projectStructure.md` to list the new WS test support/helpers and the added node:test integration/unit files for WS streaming.

- Subtask 25: Verified required WS lifecycle + stream log message keys exist in the implementation (`chat.ws.connect`, `chat.ws.subscribe_conversation`, `chat.stream.snapshot`, `chat.stream.final`, `chat.stream.cancel`); no schema changes were needed.

- Subtask 26: Ran `npm run lint --workspaces` (no errors) and `npm run format:check --workspaces`; fixed Prettier failures by running `npm run format --workspace server`, then re-verified `format:check` passes.

- Testing 1: `npm run build --workspace server` passed.

- Testing 2: `npm run build --workspace client` passed.

- Testing 3: Ran `npm run test --workspace server` (node:test + Cucumber); all green (44/44 Cucumber scenarios passed). Fixed remaining WS-era test gaps discovered during this run (`server/src/test/integration/chat-tools-wire.test.ts` migrated off SSE and `ChatInterfaceLMStudio` now always emits a terminal event so `cancel_inflight` reliably produces `turn_final`).

- Testing 4: Ran `npm run test --workspace client`; all green (61 Jest suites / 129 tests).

- Testing 5: Ran `npm run e2e`; all green (27 Playwright tests) against the Docker e2e stack using `http://host.docker.internal:6001` + `http://host.docker.internal:6010`.

- Testing 6: Ran `npm run compose:build` (local Docker images); succeeded.

- Testing 7: Ran `npm run compose:up`; all containers started and health checks passed.

- Testing 8: Manual Playwright-MCP check (container-safe): validated the contract via a scripted run against mapped ports (`POST http://host.docker.internal:5010/chat` + `ws://host.docker.internal:5010/ws`) and confirmed `/logs` includes `chat.ws.connect`, `chat.stream.snapshot`, and `chat.stream.final`.

- Testing 9: Ran `npm run compose:down`; stopped services cleanly.

---

### 6. Chat sidebar bulk actions UI

- Task Status: **__done__**
- Git Commits: 6f4543c, 8da77c4
#### Overview

Add the 3-state conversation filter, multi-select checkboxes, and bulk archive/restore/delete controls in the Chat sidebar, wired to the new bulk endpoints and persistence guards.

#### Documentation Locations

- MUI component docs (MCP snapshot within the same minor series as the repo’s `@mui/material` `^6.4.1`; use this index then fetch Checkbox/Dialog/Snackbar/Select pages as needed): https://llms.mui.com/material-ui/6.4.12/llms.txt
- MUI v6 docs landing page (use as supplemental context; prefer the MCP snapshot above for prop/API specifics in this repo): https://v6.mui.com/
- React 19 docs (state + effects for selection/filter UX): https://react.dev/learn
- Fetch API + HTTP status codes (calling bulk endpoints and rendering errors): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API and https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
- Jest 30.x docs (repo uses Jest 30; referenced by this task’s Testing section): Context7 `/websites/jestjs_io_30_0`
- Testing Library (RTL) docs (repo’s client tests use RTL patterns): https://testing-library.com/docs/react-testing-library/intro/
- Playwright docs (e2e mocks will later need WS routing via routeWebSocket): Context7 `/microsoft/playwright.dev`
- Mermaid syntax (for documentation diagrams): Context7 `/mermaid-js/mermaid`
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`


#### Subtasks

1. [x] Review current Chat sidebar implementation and conversation hooks:
   - Docs to read:
     - https://react.dev/learn
     - https://llms.mui.com/material-ui/6.4.12/llms.txt
   - Files to read:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
     - `client/src/hooks/usePersistenceStatus.ts`
     - `client/src/components/ingest/RootsTable.tsx` (selection pattern to reuse)

2. [x] Implement the 3-state filter UI only (no bulk controls yet):
   - Docs to read:
     - https://llms.mui.com/material-ui/6.4.12/components/toggle-button.md (ToggleButtonGroup exclusive selection)
     - https://llms.mui.com/material-ui/6.4.12/api/toggle-button-group.md
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
   - Requirements:
     - Filter options map to `state=active|all|archived`.
     - Clear selection on filter change.

3. [x] Add Set-based selection and per-row checkbox rendering:
   - Docs to read:
     - https://llms.mui.com/material-ui/6.4.12/api/checkbox.md
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
   - Requirements:
     - Use `Set<string>` selection like `RootsTable`.
     - Selection must not be reset by list reordering.

4. [x] Add select-all checkbox + bulk toolbar UI (buttons can be disabled until wiring is complete):
   - Docs to read:
     - https://llms.mui.com/material-ui/6.4.12/llms.txt
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`

5. [x] Implement delete confirmation dialog:
   - Docs to read:
     - https://llms.mui.com/material-ui/6.4.12/api/dialog.md
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`

6. [x] Implement Snackbar success/failure toasts:
   - Docs to read:
     - https://llms.mui.com/material-ui/6.4.12/api/snackbar.md
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`

7. [x] Disable bulk actions when `mongoConnected === false` and show a clear message:
   - Docs to read:
     - https://react.dev/learn
   - Files to edit:
     - `client/src/hooks/usePersistenceStatus.ts`
     - `client/src/components/chat/ConversationList.tsx`

8. [x] Wire bulk API calls into `useConversations`:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Files to edit:
     - `client/src/hooks/useConversations.ts`

9. [x] Validate edge cases:
   - Docs to read:
     - https://react.dev/learn
   - Files to verify:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Do not force-refresh transcript mid-view if selected conversation changes state.

10. [x] Update `design.md` with the sidebar bulk action UX:
    - Docs to read:
      - Context7 `/mermaid-js/mermaid` (only if adding diagrams)
    - Files to edit:
      - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).

11. [x] Update `projectStructure.md` if any new UI modules are added:
    - Docs to read:
      - https://www.markdownguide.org/basic-syntax/
    - Files to read:
      - `projectStructure.md`
    - Files to edit:
      - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).

12. [x] Add client log lines (forwarded to `/logs`) for sidebar filter + selection + bulk actions so manual checks can confirm the UI events fired:
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
     - `client/src/logging/logger.ts` (use existing logger; do not change schema)
   - Required log messages (must match exactly):
     - `chat.sidebar.filter_changed`
     - `chat.sidebar.selection_changed`
     - `chat.sidebar.bulk_action_request`
     - `chat.sidebar.bulk_action_result`
   - Required fields in `context` (as applicable):
     - `filterState` (active|all|archived)
     - `selectedCount`
     - `action` (archive|restore|delete)
     - `status` (ok|failed)
     - `errorCode` (when failed)
   - Notes:
     - These must be forwarded into the server `/logs` store so Playwright-MCP can query them in the Logs UI.

13. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task-specific):
   - Open `/chat`.
   - Verify the sidebar bulk UX:
     - Filter toggle cycles through `Active`, `Active & Archived`, and `Archived`.
     - Multi-select checkboxes appear and selection count is correct.
     - Bulk Archive/Restore/Delete buttons enable/disable correctly based on selection and filter.
     - Permanent delete shows a confirmation dialog.
   - Confirm client log lines exist for this task:
     - Open `/logs` and search for `chat.sidebar.filter_changed` and `chat.sidebar.bulk_action_result` after interacting with the sidebar.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-27: Marked task as in progress and began implementation.
- 2025-12-27: Reviewed `ConversationList`, `useConversations`, `usePersistenceStatus`, and `RootsTable` (Set-based selection pattern).
- 2025-12-27: Replaced the archived switch with a 3-state ToggleButtonGroup (`active|all|archived`) and wired list fetches to `state=` in `useConversations`.
- 2025-12-27: Added `Set<string>` selection state to `ConversationList` and rendered per-row selection checkboxes (selection survives sorting/reordering).
- 2025-12-27: Added select-all checkbox + bulk toolbar UI skeleton in the Chat sidebar (bulk buttons present but still disabled pending API wiring).
- 2025-12-27: Implemented a bulk delete confirmation dialog (opens from the Delete button and confirms count before proceeding).
- 2025-12-27: Added Snackbar toasts for archive/restore successes and failures (bulk actions will reuse the same toast surface).
- 2025-12-27: Bulk selection + bulk delete are now disabled when `mongoConnected === false`, with an inline warning in the sidebar.
- 2025-12-27: Added `bulkArchive`, `bulkRestore`, and `bulkDelete` helpers to `useConversations`, calling `/conversations/bulk/*` and updating local list state.
- 2025-12-27: Updated `ChatPage` so turn loading is not gated by the current sidebar filter (prevents transcript from disappearing when the active conversation is archived/restored).
- 2025-12-27: Updated `design.md` with the chat sidebar filter/selection/bulk action UX contract.
- 2025-12-27: No new UI modules were added; `projectStructure.md` did not require updates.
- 2025-12-27: Added required client log events for sidebar filter changes, selection changes, and bulk action request/result.
- 2025-12-27: Ran `npm run lint --workspaces` and `npm run format:check --workspaces` (fixed Prettier issues and a server test lint error).
- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: Ran `npm run test --workspace server`; all green (unit tests + 44/44 Cucumber scenarios passed).
- Testing 4: Ran `npm run test --workspace client`; all green (61 Jest suites / 129 tests).
- Testing 5: Ran `npm run e2e`; all green (24 passed / 3 skipped) against the Docker e2e stack using `http://host.docker.internal:6001` + `http://host.docker.internal:6010`.
- Testing 6: Ran `npm run compose:build` (local Docker images); succeeded.
- Testing 7: Ran `npm run compose:up`; all containers started and health checks passed.
- Testing 8: Manual Playwright-MCP check (container-safe): verified filter cycling, selection count, bulk archive/restore/delete enablement + confirmation dialog, and confirmed `/logs` contains `chat.sidebar.filter_changed` + `chat.sidebar.bulk_action_result` when browsing `http://host.docker.internal:5001`.
- Testing 9: Ran `npm run compose:down`; stopped services cleanly.

- Notes:
  - Manual Playwright-MCP runs inside this container cannot use a client build that points to `http://localhost:5010` (it resolves to the container, not the host). For the manual check we rebuilt the client image with `VITE_API_URL=http://host.docker.internal:5010` so `/chat` could reach the host-mapped API.
  - The initial filter+refresh header layout caused sidebar overflow that intermittently blocked clicks in Playwright (provider select intercepted pointer events). The header was refactored into two rows (title+refresh, then filter group) to keep controls within the sidebar width.

---

 ### 7. Chat WebSocket client streaming

- Task Status: **__completed__**
- Git Commits: **to_do**
#### Overview

Replace the chat SSE client with a WebSocket-based streaming client that subscribes per conversation, merges in-flight snapshots, and drives the transcript for the visible conversation only.

#### Documentation Locations

- Browser WebSocket API (connection lifecycle, message handling, close codes; used in useChatWs): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React 19 docs (hook structure, effect cleanup, and reconnection/backoff patterns): https://react.dev/learn
- Fetch API (used for POST /chat start-run and list snapshots on reconnect): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- HTTP status semantics (202 start-run, 409 run-lock conflicts): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202 and https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
- Mermaid syntax (required for updating design diagrams in this task): Context7 `/mermaid-js/mermaid`
- Jest 30.x docs (repo uses Jest 30; referenced by this task’s Testing section): Context7 `/websites/jestjs_io_30_0`
- Testing Library (RTL) docs (how to assert hook-driven UI changes): https://testing-library.com/docs/react-testing-library/intro/
- Playwright docs (e2e verification for WS-driven streaming later): Context7 `/microsoft/playwright.dev`
- Tooling references (npm run workspace commands): https://docs.npmjs.com/cli/v10/commands/npm-run-script


#### Subtasks

1. [x] Read the current SSE-based client streaming code so you understand what must be replaced:
   - Docs to read:
     - https://react.dev/learn
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`

2. [x] Create a WS hook that owns the connection and JSON codec (no shared WS abstraction exists yet):
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - Create `client/src/hooks/useChatWs.ts`
   - Required outbound message format (example):
     ```json
     { "protocolVersion":"v1", "requestId":"<uuid>", "type":"subscribe_conversation", "conversationId":"..." }
     ```
   - Requirements:
     - Use a single WS connection while the Chat page is mounted.
     - Parse inbound messages as JSON and ignore unknown event types safely (do not crash the UI on unexpected payloads).
     - Implementation sketch (copy/paste then adapt):
       ```ts
       // client/src/hooks/useChatWs.ts (sketch)
       const ws = new WebSocket(`${apiBaseUrl.replace(/^http/, 'ws')}/ws`);
       ws.onmessage = (ev) => {
         const msg = JSON.parse(String(ev.data));
         // switch(msg.type) ...
       };
       function send(msg: object) {
         ws.send(JSON.stringify({ protocolVersion: 'v1', requestId: crypto.randomUUID(), ...msg }));
       }
       ```

3. [x] Add explicit connection lifecycle + reconnect/backoff logic:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
   - Requirements:
     - Use a simple backoff (e.g., 250ms → 500ms → 1000ms → 2000ms max) and reconnect automatically.
     - On reconnect, re-send active subscriptions (sidebar + current conversation) after refreshing the sidebar list snapshot via REST.

4. [x] Implement transcript subscribe/unsubscribe tied to “currently visible conversation only”:
   - Docs to read:
     - https://react.dev/learn
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - When the user switches conversations, unsubscribe from the old conversation stream and subscribe to the new one.
     - Unsubscribing must NOT cancel the run (it only stops local viewing).

5. [x] Apply WS transcript events to the UI state (snapshot → deltas/tool events → final):
   - Docs to read:
     - https://react.dev/learn
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/pages/ChatPage.tsx`
   - Required inbound transcript event examples:
     ```json
     { "protocolVersion":"v1", "type":"assistant_delta", "conversationId":"...", "seq": 2, "inflightId":"...", "delta":"hello" }
     ```
   - Requirements:
     - Track the last seen `seq` per conversation and ignore stale/out-of-order events.
     - Handle `analysis_delta` by updating the assistant think/reasoning state (equivalent of existing SSE `analysis` frames for Codex).
     - Cache the latest `inflightId` for Stop.
     - Render tool events using the existing UI expectations (tool-request/tool-result shapes).

6. [x] Add sidebar WS subscription (Chat page only) and merge `conversation_upsert` / `conversation_delete` into list state:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useConversations.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts` (if the WS connection is shared)
   - Requirements:
     - Keep checkbox selection stable during list resorting (selection keyed by `conversationId`).
     - Filter out sidebar events with a non-empty `agentName` (Chat list is `agentName=__none__`).

7. [x] Replace the SSE run-start logic with a `POST /chat` start request (no streaming) + WS transcript updates:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
   - Required `POST /chat` response example:
     ```json
     { "status":"started", "conversationId":"...", "inflightId":"...", "provider":"codex", "model":"gpt-5.1-codex-max" }
     ```
   - Requirements:
     - Handle `409 RUN_IN_PROGRESS` by showing a stable UI error bubble.
     - Do not abort/cancel runs on route unmount or conversation switch.

8. [x] Implement Stop using WS `cancel_inflight` (no fetch abort):
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/pages/ChatPage.tsx`
   - Required cancel message example:
     ```json
     { "protocolVersion":"v1", "requestId":"<uuid>", "type":"cancel_inflight", "conversationId":"...", "inflightId":"..." }
     ```

9. [x] Enforce the “mongoConnected === false” behaviour explicitly (this is easy to miss):
   - Docs to read:
     - https://react.dev/learn
   - Files to edit:
     - `client/src/hooks/usePersistenceStatus.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts`
   - Requirements:
     - When persistence is unavailable, disable live streaming (do not subscribe to sidebar or transcript updates) and show a clear banner/message explaining why.
     - Keep Stop working even when persistence is unavailable:
       - `cancel_inflight` does not depend on Mongo.
       - It is acceptable to keep a minimal WS connection open (or open one on-demand) solely to send `cancel_inflight`, but the UI must not render live transcript/sidebar updates in this mode.

10. [x] Enable live transcript streaming for agent-initiated conversations in the Agents UI (same WS transcript contract):
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://react.dev/learn
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/hooks/useChatWs.ts`
   - Purpose:
     - Ensure the acceptance criteria “agent-initiated conversations stream in the UI the same way” is true in practice, not just server-side.
   - Requirements:
     - When an agent conversation is selected (`activeConversationId` is set) and persistence is available, subscribe to that conversation over WS.
     - Render the in-flight assistant state (assistant text + streamed reasoning + tool events) in the transcript so a second window watching the same agent conversation sees live updates.
     - Unsubscribe on conversation switch and on unmount.
     - Do not change the Agents REST response format (it still returns `segments`); this subtask only improves live viewing while a run is in progress.

11. [x] Update `design.md` to document the client WS lifecycle and catch-up rules (include Mermaid diagrams):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://react.dev/learn
   - Files to edit:
     - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).
   - Requirements:
     - Document: subscribe/unsubscribe rules for sidebar + visible conversation, reconnect resnapshot behaviour, and that navigating away does not cancel runs.
     - Add/extend a Mermaid sequence diagram showing: mount → connect → subscribe_sidebar → subscribe_conversation → switch conversation (unsubscribe/subscribe) → unmount (unsubscribe/close) and a reconnect branch (refresh snapshots then resubscribe).

12. [x] Update `projectStructure.md` with any added/removed client streaming modules:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).
   - Requirements:
     - This task adds new files. `projectStructure.md` must explicitly list every added file from this task.
     - Expected file additions (must be reflected in `projectStructure.md`):
       - `client/src/hooks/useChatWs.ts`
     - If you add additional WS support utilities during implementation (for example shared JSON codec helpers), include those exact paths too.

13. [x] Add client log lines (forwarded to `/logs`) for WS subscription + reconnect behaviors so manual checks can confirm the new client streaming logic is executing:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/logging/logger.ts` (use existing logger; do not change schema)
   - Required log messages (must match exactly):
     - `chat.ws.client_connect`
     - `chat.ws.client_subscribe_conversation`
     - `chat.ws.client_snapshot_received`
     - `chat.ws.client_final_received`
     - `chat.ws.client_reconnect_attempt`
     - `chat.ws.client_stale_event_ignored`
   - Required fields in `context` (as applicable):
     - `conversationId`
     - `inflightId`
     - `seq`
     - `attempt`
   - Notes:
     - `chat.ws.client_*` logs must be forwarded to server `/logs` so they show up in the Logs UI.

14. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task-specific):
   - Open `/chat`.
   - Send a message and verify you see live transcript updates for the visible conversation.
   - Switch conversations mid-stream and confirm:
     - The previous conversation stops streaming (unsubscribe),
     - The newly selected conversation shows the correct catch-up snapshot if it is in flight.
   - Use Stop and confirm `cancel_inflight` cancels without hanging.
   - Confirm client log lines exist for this task:
     - Open `/logs` and search for `chat.ws.client_snapshot_received` and `chat.ws.client_final_received` after streaming completes.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-27: Replaced `useChatStream` SSE transport with `POST /chat` (202 start-run) and applied transcript updates via WebSocket events (`inflight_snapshot`, deltas, tool_event, turn_final).
- 2025-12-27: Wired `ChatPage` to mount a single `useChatWs` connection, subscribe to `subscribe_sidebar` + the visible conversation only, and merge `conversation_upsert`/`conversation_delete` into `useConversations` state.
- 2025-12-27: Implemented Stop via WS `cancel_inflight` (no fetch abort); kept route unmount/conversation switch as unsubscribe-only (run continues server-side).
- 2025-12-27: Enforced persistence-down behaviour: when `mongoConnected === false`, the UI disables WS subscriptions and warns that live streaming is disabled, while Stop still sends `cancel_inflight`.
- 2025-12-27: Added required client-forwarded WS logs in `useChatWs` (`chat.ws.client_connect`, `chat.ws.client_subscribe_conversation`, `chat.ws.client_snapshot_received`, `chat.ws.client_final_received`, `chat.ws.client_reconnect_attempt`, `chat.ws.client_stale_event_ignored`).
- 2025-12-27: Enabled WS live viewing in Agents UI by subscribing to the selected agent conversation and rendering an in-flight assistant message (text/think/tool events) while a run is active.
- 2025-12-27: Updated `design.md` + `projectStructure.md` to reflect the WS client lifecycle and to list newly added client WS modules.
- 2025-12-27: Fixed ChatPage stop cleanup to only fire on unmount (using a ref), preventing premature stream resets when `stop` callback identity changes.
- 2025-12-27: Ran `npm run lint --workspaces` (client clean; server lint warnings only) and `npm run format:check --workspaces` (fixed via `npm run format --workspaces`).
- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed.
- Testing 4: `npm run test --workspace client` passed.
- Testing 5: `npm run e2e` passed.
- Testing 6: `npm run compose:build` passed.
- Testing 7: `npm run compose:up` started and health checks passed.
- Testing 8: Manual Playwright check against mapped ports (`http://host.docker.internal:5001` + `http://host.docker.internal:5010`): verified WS-driven transcript updates for visible conversation, switching conversations triggers catch-up snapshot, Stop emits `cancel_inflight`, and `/logs` contains `chat.ws.client_snapshot_received` + `chat.ws.client_final_received`.
- Testing 9: `npm run compose:down` passed.

---

### 8. Client streaming logs

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Emit client-side log entries for WebSocket connect/subscribe/receive events and forward them to server logs for Playwright verification.

#### Documentation Locations

- Browser WebSocket API (client connection + event receipt logging): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Fetch API (client log forwarding to server /logs ingestion): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Console API (debug-only; do not rely on console for acceptance criteria): https://developer.mozilla.org/en-US/docs/Web/API/console
- Mermaid syntax (required for updating design diagrams in this task): Context7 `/mermaid-js/mermaid`
- Playwright docs (later e2e will assert forwarded client logs exist in /logs): Context7 `/microsoft/playwright.dev`
- Tooling references (npm run workspace builds): https://docs.npmjs.com/cli/v10/commands/npm-run-script


#### Subtasks

1. [ ] Read existing client logging + forwarding so new WS logs follow the same transport:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/console
   - Files to read:
     - `client/src/logging/logger.ts`
     - `client/src/logging/transport.ts`

2. [ ] Add WS lifecycle + event receipt logs to the WS hook (explicit names and required fields):
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/logging/logger.ts`
   - Required log names (must match exactly):
     - `chat.ws.client_connect`, `chat.ws.client_disconnect`
     - `chat.ws.client_subscribe_conversation`
     - `chat.ws.client_snapshot_received`, `chat.ws.client_delta_received`, `chat.ws.client_tool_event_received`, `chat.ws.client_final_received`
   - Required fields (as applicable):
     - `conversationId`, `inflightId`, `seq`
   - Throttling rules:
     - Log the first delta and then every 25 deltas; include `deltaCount`.
     - Tool events are logged per event; include `toolEventCount` as a running total.

3. [ ] Confirm client logs are forwarded into server `/logs` entries so Playwright can assert them:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to verify:
     - `client/src/logging/transport.ts`
     - `server/src/routes/logs.ts`
   - Requirements:
     - After this work, `/logs` should contain both server-side `chat.*` logs and forwarded `chat.ws.client_*` logs.

4. [ ] Update `design.md` with the client logging/forwarding flow (include Mermaid diagrams):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).
   - Requirements:
     - Add a Mermaid sequence diagram showing: ChatPage/useChatWs emits `chat.ws.client_*` logs → client transport forwards to server → server /logs stores → UI/e2e asserts via logs snapshot.
     - List the required log names and their key fields (conversationId/inflightId/seq) near the diagram.

5. [ ] Update `projectStructure.md` with any added/removed client logging modules:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).
   - Requirements:
     - If new logging helpers were added/removed, reflect them here (otherwise mark as no-op).

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (task-specific):
   - Open `/chat`, send a message, and confirm streaming occurs.
   - Open `/logs` and confirm you can find the expected WS client log entries:
     - `chat.ws.client_connect`
     - `chat.ws.client_delta_received` (or similar delta logs per throttling rules)
   - Regression: logs page remains usable while chat is streaming.

9. [ ] `npm run compose:down`

#### Implementation notes

- (fill in during implementation)

---

### 9. Front-end test updates

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Update Jest/RTL coverage and e2e specs for the new chat WebSocket flow, bulk actions UI, and streaming log assertions.

#### Documentation Locations

- Jest 30.x docs (repo uses Jest 30; use for matchers, timers, mocks, and config): Context7 `/websites/jestjs_io_30_0`
- React Testing Library (RTL) docs (preferred testing style: user-visible queries + events): https://testing-library.com/docs/react-testing-library/intro/
- jest-dom matchers (repo uses @testing-library/jest-dom; use for toBeInTheDocument etc): Context7 `/testing-library/jest-dom`
- Playwright docs (WS routing/mocking via routeWebSocket + WebSocketRoute): Context7 `/microsoft/playwright.dev`
- Playwright WS routing discussion/examples (DeepWiki reference for routeWebSocket / connectToServer caveats): Deepwiki repo `microsoft/playwright`
- Browser WebSocket API (understanding event ordering and reconnect behavior in tests): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`


#### Subtasks

1. [ ] Create WS mocking helpers so tests do not re-implement subscriptions and event emission:
   - Docs to read:
     - Context7 `/microsoft/playwright.dev` (routeWebSocket)
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to add:
     - `e2e/support/mockChatWs.ts`
     - `client/src/test/support/mockWebSocket.ts`
   - Requirements:
     - The helper must be able to send deterministic sequences of events (`seq` increments) to the client.

2. [ ] Update common fixtures so both Jest and Playwright can reuse the same WS event examples:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to edit:
     - `common/src/fixtures/chatStream.ts`
   - Requirements:
     - Export WS-shaped fixtures for: `inflight_snapshot`, `assistant_delta`, `analysis_delta`, `tool_event`, `turn_final`.
     - Keep existing exports that other tests rely on, or update import sites in the same subtask.

3. [ ] Client unit test harness (Jest): add `useChatWs` test file and WebSocket mock wiring
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to add:
     - `client/src/test/useChatWs.test.ts`
   - Files to add/edit (as needed):
     - `client/src/test/support/mockWebSocket.ts`
     - `client/src/hooks/useChatWs.ts`
   - Purpose:
     - Provide deterministic setup/teardown so each WS behavior can be tested independently.
   - Requirements:
     - Ensure the mock can emit messages, close, and track sent client messages.

4. [ ] Client unit test (Jest): `useChatWs` connects once on mount and closes on unmount (happy path)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
   - Purpose:
     - Prevent reconnect storms and WS handle leaks.
   - Requirements:
     - Assert a single WebSocket instance is created per mount and is closed during cleanup.

5. [ ] Client unit test (Jest): `useChatWs` ignores unknown inbound event types without throwing (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
   - Purpose:
     - Ensure forwards-compatible protocol handling.
   - Requirements:
     - Emit an event with an unknown `type` and assert no crash and no state corruption.

6. [ ] Client unit test (Jest): `useChatWs` handles malformed JSON safely (error case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
   - Purpose:
     - Prevent a single bad frame from crashing the Chat page.
   - Requirements:
     - Emit a non-JSON string message and assert the hook does not throw.
     - Assert behavior matches the contract (either logs and continues, or closes and relies on reconnect), but does not hard-crash the UI.

7. [ ] Client unit test (Jest): `useChatWs` ignores stale/out-of-order transcript events based on per-conversation `seq` (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
     - `client/src/hooks/useChatWs.ts`
   - Purpose:
     - Prevent UI glitches when switching conversations quickly.
   - Requirements:
     - Emit transcript events for a conversation with `seq` going backwards and assert stale events are ignored.

8. [ ] Client unit test (Jest): on WS reconnect, `useChatWs` refreshes snapshots and re-subscribes (happy path)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
     - `client/src/hooks/useChatWs.ts`
   - Files to read (existing snapshot hooks):
     - `client/src/hooks/useConversations.ts`
     - `client/src/hooks/useConversationTurns.ts`
   - Purpose:
     - Ensure laptop sleep/network hiccups recover the UI reliably.
   - Requirements:
     - Simulate close + reconnect and assert list/turn snapshots are refreshed and subscribe messages are re-sent.

9. [ ] Client unit test (Jest): when `mongoConnected === false`, `useChatWs` does not subscribe/stream (disabled state)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
     - `client/src/hooks/useChatWs.ts`
   - Purpose:
     - Ensure realtime/bulk features are gated when persistence is unavailable.
   - Requirements:
     - Provide `mongoConnected=false` and assert no subscriptions are sent and no reconnection behavior runs.


10. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.stream.test.tsx for WS-driven streaming semantics
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
   - Requirements:
     - Purpose: replace fetch-abort expectations with WS cancel_inflight behavior and assert navigation does not cancel.

11. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.stop.test.tsx for WS-driven streaming semantics
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.stop.test.tsx`
   - Requirements:
     - Purpose: replace fetch-abort expectations with WS cancel_inflight behavior and assert navigation does not cancel.
     - Add an explicit case where `mongoConnected === false`:
       - Purpose: ensure Stop still works when persistence is unavailable (even though streaming subscriptions are disabled).
       - Assert `cancel_inflight` is still sent over WebSocket (minimal connection is allowed for Stop-only).

12. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.newConversation.test.tsx for WS-driven streaming semantics
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.newConversation.test.tsx`
   - Requirements:
     - Purpose: replace fetch-abort expectations with WS cancel_inflight behavior and assert navigation does not cancel.

13. [ ] Client unit test (Jest/RTL): update client/src/test/useChatStream.reasoning.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatStream.reasoning.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

14. [ ] Client unit test (Jest/RTL): update client/src/test/useChatStream.toolPayloads.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

15. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.citations.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.citations.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

16. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.toolDetails.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.toolDetails.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

17. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.reasoning.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.reasoning.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

18. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.markdown.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.markdown.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

19. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.mermaid.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.mermaid.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

20. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.noPaths.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.noPaths.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

21. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.provider.test.tsx for POST /chat 202 + WS transcript contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.provider.test.tsx`
   - Requirements:
     - Purpose: ensure provider/model selection flows align with new start-run response and WS events.

22. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.provider.conversationSelection.test.tsx for POST /chat 202 + WS transcript contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.provider.conversationSelection.test.tsx`
   - Requirements:
     - Purpose: ensure provider/model selection flows align with new start-run response and WS events.

23. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.source.test.tsx for POST /chat 202 + WS transcript contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.source.test.tsx`
   - Requirements:
     - Purpose: ensure provider/model selection flows align with new start-run response and WS events.

24. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.models.test.tsx for POST /chat 202 + WS transcript contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.models.test.tsx`
   - Requirements:
     - Purpose: ensure provider/model selection flows align with new start-run response and WS events.

25. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.approval.default.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts` (WS fixtures: inflight_snapshot/assistant_delta/analysis_delta/tool_event/turn_final)
   - Files to edit:
     - `client/src/test/chatPage.flags.approval.default.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - If this test currently relies on SSE (EventSource or text/event-stream parsing), remove that and instead:
       - mock `POST /chat` to return `202` JSON `{ status:"started", conversationId, inflightId, provider, model }`, and
       - mock the WebSocket transcript so the UI exits “streaming” state deterministically.
     - WS mock minimum event sequence (example):
       ```json
       { "protocolVersion":"v1", "type":"inflight_snapshot", "conversationId":"...", "seq": 1, "inflight": { "inflightId":"...", "assistantText":"", "assistantThink":"", "toolEvents": [], "startedAt":"2025-01-01T00:00:00.000Z" } }
       { "protocolVersion":"v1", "type":"turn_final", "conversationId":"...", "seq": 2, "inflightId":"...", "status":"ok", "threadId": null }
       ```
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

26. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.approval.payload.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.approval.payload.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send a minimal WS transcript sequence so the UI completes the run.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

27. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.network.default.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.network.default.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send a minimal WS transcript sequence so the UI completes the run.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

28. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.network.payload.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.network.payload.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send a minimal WS transcript sequence so the UI completes the run.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

29. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.reasoning.default.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts` (include `analysis_delta` fixtures for reasoning)
   - Files to edit:
     - `client/src/test/chatPage.flags.reasoning.default.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send at least one `analysis_delta` WS event if the UI expects reasoning.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

30. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.reasoning.payload.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.reasoning.payload.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send at least one `analysis_delta` WS event if the UI expects reasoning.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

31. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.sandbox.default.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.sandbox.default.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send a minimal WS transcript sequence so the UI completes the run.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

32. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.sandbox.payload.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.sandbox.payload.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send a minimal WS transcript sequence so the UI completes the run.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

33. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.sandbox.reset.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.sandbox.reset.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send a minimal WS transcript sequence so the UI completes the run.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

34. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.websearch.default.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.websearch.default.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send a minimal WS transcript sequence so the UI completes the run.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

35. [ ] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.websearch.payload.test.tsx for 202 start-run + WS-only contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to read:
     - `common/src/fixtures/chatStream.ts`
   - Files to edit:
     - `client/src/test/chatPage.flags.websearch.payload.test.tsx`
   - Purpose:
     - Ensure Codex flag payloads remain correct when chat transport changes (no SSE).
   - Requirements:
     - Ensure the test does not depend on SSE.
     - Mock `POST /chat` 202 and send a minimal WS transcript sequence so the UI completes the run.
     - Replace any SSE parsing/mocks with the new WS fixtures (`inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`).
     - Update assertions to expect `POST /chat` returns `202` JSON start-run response (not a streaming response).

36. [ ] Client unit test (Jest/RTL): sidebar selection is cleared when the user changes the filter (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://testing-library.com/docs/react-testing-library/intro/
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Requirements:
     - Purpose: match the acceptance criteria “Selection is cleared when the user changes the view filter”.
     - Render the Chat sidebar with a list of conversations.
     - Select 1+ rows, switch the filter (`Active` → `Archived`), and assert the selection count resets to 0.

37. [ ] Client unit test (Jest/RTL): selection stays stable when the conversation list reorders due to live updates (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Requirements:
     - Purpose: match the acceptance criteria “Selection is retained while streaming sidebar updates arrive / resorting by lastMessageAt”.
     - Select a conversationId, then simulate a list update that changes ordering.
     - Assert the selected conversation remains selected after resort.

38. [ ] Client unit test (Jest/RTL): bulk action buttons and select-all checkbox reflect the active filter state (happy path)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Purpose:
     - Ensure the correct actions are available per filter mode.
   - Requirements:
     - In `Active` and `Active & Archived`, assert “Archive” is available and “Delete permanently” is not.
     - In `Archived`, assert “Restore” and “Delete permanently” are available.
     - Assert the header select-all checkbox uses `indeterminate` when some but not all items are selected.

39. [ ] Client unit test (Jest/RTL): permanent delete requires confirmation dialog (error-prevention case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Purpose:
     - Prevent accidental destructive actions.
   - Requirements:
     - In `Archived` view, select a conversation and click “Delete permanently”.
     - Assert a confirmation dialog appears.
     - Assert cancel does not call the bulk delete API, and confirm does.

40. [ ] Client unit test (Jest/RTL): when `mongoConnected === false`, bulk actions are disabled and the UI explains why (error case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Purpose:
     - Enforce acceptance criteria gating for safety when persistence is unavailable.
   - Requirements:
     - Force persistence status to unavailable.
     - Assert selection and bulk action controls are disabled and a clear message is shown.

41. [ ] Client unit test (Jest/RTL): Chat sidebar ignores `conversation_upsert` events for agent conversations (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Purpose:
     - Ensure the Chat sidebar remains scoped to `agentName=__none__` and does not leak agent conversations into chat history.
   - Requirements:
     - Simulate a `conversation_upsert` event whose `conversation.agentName` is a non-empty string.
     - Assert it is ignored (not rendered in the Chat sidebar list).

42. [ ] Client unit test (Jest/RTL): update client/src/test/chatPersistenceBanner.test.tsx for persistence-unavailable banner states
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPersistenceBanner.test.tsx`
   - Requirements:
     - Purpose: ensure the banner messaging remains clear and stable when `mongoConnected === false`.

43. [ ] E2E test (Playwright): update e2e/chat.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

44. [ ] E2E test (Playwright): update e2e/chat-tools.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-tools.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

45. [ ] E2E test (Playwright): update e2e/chat-tools-visibility.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-tools-visibility.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

46. [ ] E2E test (Playwright): update e2e/chat-reasoning.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-reasoning.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

47. [ ] E2E test (Playwright): update e2e/chat-provider-history.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-provider-history.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

48. [ ] E2E test (Playwright): update e2e/chat-mermaid.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-mermaid.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

49. [ ] E2E test (Playwright): update e2e/chat-codex-trust.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-codex-trust.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

50. [ ] E2E test (Playwright): update e2e/chat-codex-reasoning.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-codex-reasoning.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

51. [ ] E2E test (Playwright): update e2e/chat-codex-mcp.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-codex-mcp.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

52. [ ] E2E test (Playwright): Logs page shows chat WS client streaming logs after receiving transcript events (happy path)
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/logs.spec.ts` (or create a new `e2e/chat-ws-logs.spec.ts`)
   - Purpose:
     - Prove WS streaming activity is observable end-to-end via the `/logs` store.
   - Requirements:
     - Use the WS chat mocks to emit at least: `inflight_snapshot`, `assistant_delta`, and `turn_final`.
     - Assert the Logs page contains client log entries like `chat.ws.client_connect` and `chat.ws.client_delta_received`.

53. [ ] Client unit test (Jest/RTL): AgentsPage renders in-flight WS transcript updates for agent conversations (happy path)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://testing-library.com/docs/react-testing-library/intro/
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to add:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Files to add/edit (as needed):
     - `client/src/test/support/mockWebSocket.ts`
   - Purpose:
     - Prove agent-initiated conversations can be viewed live (acceptance criteria) using the same WS transcript contract as Chat.
   - Requirements:
     - Render `AgentsPage` with persistence enabled.
     - Select a conversationId (set `activeConversationId` via UI interaction or controlled state).
     - Emit WS events (`inflight_snapshot`, `assistant_delta`, `analysis_delta`, `tool_event`) and assert the transcript UI reflects the in-flight assistant state.

54. [ ] Client unit test (Jest/RTL): AgentsPage unsubscribes from the previous conversation on switch/unmount (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Purpose:
     - Prevent WS subscription leaks when switching agent conversations.
   - Requirements:
     - Switch `activeConversationId` and assert the mock WebSocket recorded an `unsubscribe_conversation` for the old id.

55. [ ] Update `projectStructure.md` with any added/removed test helpers and fixtures:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).
   - Requirements:
     - This task adds new files. `projectStructure.md` must explicitly list every added file from this task.
     - Expected file additions (must be reflected in `projectStructure.md`):
       - `e2e/support/mockChatWs.ts`
       - `client/src/test/support/mockWebSocket.ts`
       - `client/src/test/useChatWs.test.ts`
       - `client/src/test/agentsPage.streaming.test.tsx`
     - If you add a new e2e spec file instead of editing an existing one (for example `e2e/chat-ws-logs.spec.ts`), include it too.

56. [ ] Ensure the UI emits and/or asserts the key log lines that prove WS streaming + bulk actions are working end-to-end (add missing logs if needed so manual checks and e2e can validate behavior):
   - Files to verify:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/components/chat/ConversationList.tsx`
     - `server/src/routes/conversations.ts`
   - If missing, files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/components/chat/ConversationList.tsx`
     - `server/src/routes/conversations.ts`
     - `client/src/logging/logger.ts`
     - `server/src/logStore.ts`
   - Required log messages (must match exactly):
     - `chat.ws.client_connect`
     - `chat.ws.client_snapshot_received`
     - `chat.ws.client_final_received`
     - `chat.sidebar.bulk_action_result`
     - `conversations.bulk.success`
   - Purpose:
     - These logs are what a human uses in the Logs UI to prove the app is actually executing the new WS + bulk flows.

57. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (task-specific):
   - Open `/chat` and confirm chat streaming works end-to-end (WS-only).
   - Open `/logs` and confirm chat WS client logs and server logs are present.
   - Confirm log lines exist for this task:
     - Search for `chat.ws.client_snapshot_received`, `chat.ws.client_final_received`, and `chat.sidebar.bulk_action_result`.
   - Regression: ingest pages and LM Studio pages still load and basic actions work.

9. [ ] `npm run compose:down`

#### Implementation notes

- (fill in during implementation)

---

### 10. Final verification

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Final cross-check against acceptance criteria, full builds/tests, docker validation, and documentation updates. Produce a pull request summary comment covering all story changes.

#### Documentation Locations

- Docker & Docker Compose docs (clean builds, compose up/down, troubleshooting): Context7 `/docker/docs` and https://docs.docker.com/compose/
- Playwright docs (running @playwright/test and manual verification expectations): Context7 `/microsoft/playwright.dev`
- Husky docs (pre-commit hooks can fail builds; use for debugging hook behavior): Context7 `/typicode/husky`
- Mermaid syntax (for documentation diagrams): Context7 `/mermaid-js/mermaid`
- Jest 30.x docs (repo uses Jest 30; used by final verification test runs): Context7 `/websites/jestjs_io_30_0`
- Cucumber guides index (start here, then follow specific guides): https://cucumber.io/docs/guides/
- Cucumber guides (use guides for runnable examples and CI setup): https://cucumber.io/docs/guides/10-minute-tutorial/ and https://cucumber.io/docs/guides/continuous-integration/
- Tooling references (npm run workspaces): https://docs.npmjs.com/cli/v10/commands/npm-run-script


#### Subtasks

1. [ ] Update `README.md` with any new commands or behavioral changes:
   - Files to read:
     - `README.md`
   - Files to edit:
     - `README.md`
   - Purpose:
     - Keep developer/user-facing instructions current for running and verifying the updated behavior.
   - Description:
     - Update README.md to reflect any new commands, environment variables, or behavioral changes introduced by this story.

2. [ ] Update `design.md` with any new diagrams or architecture changes:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).

3. [ ] Update `projectStructure.md` with any updated/added/removed files:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Keep the repo structure documentation in sync so new/removed files are discoverable.
   - Description:
     - Update projectStructure.md to reflect any files added/removed/relocated by this task (list the new modules and where they live).

4. [ ] Create a PR summary comment (what changed, why, and how to verify):
   - Files to read:
     - `planning/0000019-chat-page-ux.md`
   - Files to edit:
     - `planning/0000019-chat-page-ux.md` (Implementation notes section)
   - Purpose:
     - Ensure the story record is complete and verifiable (notes, commands, and outcomes captured in the plan).
   - Description:
     - In `planning/0000019-chat-page-ux.md` (Implementation notes section), write a PR-ready summary covering: user-visible changes, API contract changes (POST /chat 202 + WS-only streaming), new WS event types, and how to verify (exact npm commands).
   - Requirements:
     - Include a short “How to verify” checklist (server tests, client tests, e2e).
     - Mention any notable edge cases covered by tests (late-subscriber snapshot, cancel_inflight not found, bulk all-or-nothing conflicts).

5. [ ] Confirm the story’s WS/bulk “observability log lines” are present end-to-end in `/logs` during the final manual check (add any missing logs if earlier tasks didn’t implement them):
   - Purpose:
     - Make manual verification deterministic by searching for exact log messages proving the critical flows executed.
   - Requirements (these exact `message` strings must appear in `/logs`):
     - Server-side:
       - `conversations.list.request` (conversation sidebar loads)
       - `conversations.bulk.success` (bulk archive/restore/delete completed)
       - `chat.ws.connect` (WS connection established)
       - `chat.run.started` (run created via `POST /chat`)
       - `chat.stream.snapshot` (late-subscriber in-flight snapshot sent)
       - `chat.stream.final` (final event published)
     - Client-side:
       - `chat.ws.client_connect` (client WS connected)
       - `chat.ws.client_snapshot_received` (snapshot received/merged)
       - `chat.ws.client_final_received` (final received/merged)
       - `chat.sidebar.bulk_action_result` (bulk result displayed)
   - Notes:
     - If any of these are missing, add the log in the relevant task’s listed file locations (server uses pino via `server/src/logger.ts`; client uses the existing `/logs` forwarder under `client/src/logging/*`).

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - Context7 `/prettier/prettier/3.6.2`
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed (only on failure):
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Optional (if you suspect Docker caching issues): `npm run compose:build:clean`

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (story-focused + regressions):
   - Chat page:
     - Bulk filter + multi-select + bulk archive/restore/delete.
     - WS-only streaming across conversation switches; late-subscriber snapshot behavior.
     - Stop/cancel works.
   - Agents page:
     - Agent runs stream into transcript view via WS (in-flight updates visible).
   - Logs page:
     - Search `/logs` for each required log message (exact match) and capture screenshots showing the results:
       - `conversations.list.request`
       - `conversations.bulk.success`
       - `chat.ws.connect`
       - `chat.run.started`
       - `chat.stream.snapshot`
       - `chat.stream.final`
       - `chat.ws.client_connect`
       - `chat.ws.client_snapshot_received`
       - `chat.ws.client_final_received`
       - `chat.sidebar.bulk_action_result`
   - Save screenshots to `./test-results/screenshots/` using the story naming convention.

9. [ ] `npm run compose:down`

#### Implementation notes

- (fill in during implementation)
