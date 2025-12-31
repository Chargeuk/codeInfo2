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
- Testing 5: `npm run e2e` passed (31 Playwright specs).
- Testing 6: `npm run compose:build` passed.

- Testing 3: Ran `npm run test --workspace server`. Expected failures due to Task 4 transport change (`POST /chat` now returns 202 and WS publishes transcript); failing assertions still expect SSE/200 and will be updated in Task 5.

- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed (note: first run hit the agent command timeout; reran with a longer timeout and it completed successfully).
- Testing 4: `npm run test --workspace client` passed.

- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.

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

- Task Status: **__done__**
- Git Commits: f4d044b
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

- Task Status: **__done__**
- Git Commits: fbb6188
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

1. [x] Read existing client logging + forwarding so new WS logs follow the same transport:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/console
   - Files to read:
     - `client/src/logging/logger.ts`
     - `client/src/logging/transport.ts`

2. [x] Add WS lifecycle + event receipt logs to the WS hook (explicit names and required fields):
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

3. [x] Confirm client logs are forwarded into server `/logs` entries so Playwright can assert them:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to verify:
     - `client/src/logging/transport.ts`
     - `server/src/routes/logs.ts`
   - Requirements:
     - After this work, `/logs` should contain both server-side `chat.*` logs and forwarded `chat.ws.client_*` logs.

4. [x] Update `design.md` with the client logging/forwarding flow (include Mermaid diagrams):
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

5. [x] Update `projectStructure.md` with any added/removed client logging modules:
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

6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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
   - Open `/chat`, send a message, and confirm streaming occurs.
   - Open `/logs` and confirm you can find the expected WS client log entries:
     - `chat.ws.client_connect`
     - `chat.ws.client_delta_received` (or similar delta logs per throttling rules)
   - Regression: logs page remains usable while chat is streaming.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-27: Started Task 8.
- 2025-12-27: Reviewed existing client logger (`client/src/logging/logger.ts`) and forwarder (`client/src/logging/transport.ts`) to ensure new WS logs use the same `/logs` batching/backoff path.
- 2025-12-27: Added WS lifecycle/event receipt logs in `client/src/hooks/useChatWs.ts` for connect/disconnect, snapshot, delta (throttled: first + every 25, includes `deltaCount`), tool events (per event, includes `toolEventCount`), and final.
- 2025-12-27: Verified client log forwarding still posts to `POST /logs` via `client/src/logging/transport.ts` and server accepts `source:"client"` in `server/src/routes/logs.ts`.
- 2025-12-27: Updated `design.md` with a Mermaid sequence diagram describing `chat.ws.client_*` log emission and forwarding into `/logs` for UI/e2e assertions.
- 2025-12-27: No new client logging modules were added/removed for Task 8; `projectStructure.md` already lists `client/src/hooks/useChatWs.ts` as the WS/log forwarding hook.
- 2025-12-27: Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; applied `npm run format --workspaces` to resolve Prettier issues and verified checks pass.
- 2025-12-28: Hardened `useChatWs` reconnect handling to ignore stale socket close events and to emit a `chat.ws.client_delta_received` marker when a non-empty `inflight_snapshot` catch-up arrives.

- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed.
- Testing 4: `npm run test --workspace client` passed.
- Testing 5: `npm run e2e` passed.
- Testing 6: `npm run compose:build` passed.
- Testing 7: `npm run compose:up` passed.

- Testing 8: Manual Playwright automation against `http://host.docker.internal:5001/chat` confirmed streaming and verified `/logs` contains `chat.ws.client_connect` + `chat.ws.client_delta_received` (client-forwarded WS logs).
- Testing 9: `npm run compose:down` passed.
- Testing (extra): Re-ran `npm run test --workspace client` after WS logging tweaks.


---

### 9. Front-end test updates

- Task Status: **__done__**
- Git Commits: e3869bd
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

1. [x] Create WS mocking helpers so tests do not re-implement subscriptions and event emission:
   - Docs to read:
     - Context7 `/microsoft/playwright.dev` (routeWebSocket)
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to add:
     - `e2e/support/mockChatWs.ts`
     - `client/src/test/support/mockWebSocket.ts`
   - Requirements:
     - The helper must be able to send deterministic sequences of events (`seq` increments) to the client.

2. [x] Update common fixtures so both Jest and Playwright can reuse the same WS event examples:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to edit:
     - `common/src/fixtures/chatStream.ts`
   - Requirements:
     - Export WS-shaped fixtures for: `inflight_snapshot`, `assistant_delta`, `analysis_delta`, `tool_event`, `turn_final`.
     - Keep existing exports that other tests rely on, or update import sites in the same subtask.

3. [x] Client unit test harness (Jest): add `useChatWs` test file and WebSocket mock wiring
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

4. [x] Client unit test (Jest): `useChatWs` connects once on mount and closes on unmount (happy path)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
   - Purpose:
     - Prevent reconnect storms and WS handle leaks.
   - Requirements:
     - Assert a single WebSocket instance is created per mount and is closed during cleanup.

5. [x] Client unit test (Jest): `useChatWs` ignores unknown inbound event types without throwing (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
   - Purpose:
     - Ensure forwards-compatible protocol handling.
   - Requirements:
     - Emit an event with an unknown `type` and assert no crash and no state corruption.

6. [x] Client unit test (Jest): `useChatWs` handles malformed JSON safely (error case)
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

7. [x] Client unit test (Jest): `useChatWs` ignores stale/out-of-order transcript events based on per-conversation `seq` (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
     - `client/src/hooks/useChatWs.ts`
   - Purpose:
     - Prevent UI glitches when switching conversations quickly.
   - Requirements:
     - Emit transcript events for a conversation with `seq` going backwards and assert stale events are ignored.

8. [x] Client unit test (Jest): on WS reconnect, `useChatWs` refreshes snapshots and re-subscribes (happy path)
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

9. [x] Client unit test (Jest): when `mongoConnected === false`, `useChatWs` does not subscribe/stream (disabled state)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
     - `client/src/hooks/useChatWs.ts`
   - Purpose:
     - Ensure realtime/bulk features are gated when persistence is unavailable.
   - Requirements:
     - Provide `mongoConnected=false` and assert no subscriptions are sent and no reconnection behavior runs.


10. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.stream.test.tsx for WS-driven streaming semantics
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
   - Requirements:
     - Purpose: replace fetch-abort expectations with WS cancel_inflight behavior and assert navigation does not cancel.

11. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.stop.test.tsx for WS-driven streaming semantics
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.stop.test.tsx`
   - Requirements:
     - Purpose: replace fetch-abort expectations with WS cancel_inflight behavior and assert navigation does not cancel.
     - Add an explicit case where `mongoConnected === false`:
       - Purpose: ensure Stop still works when persistence is unavailable (even though streaming subscriptions are disabled).
       - Assert `cancel_inflight` is still sent over WebSocket (minimal connection is allowed for Stop-only).

12. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.newConversation.test.tsx for WS-driven streaming semantics
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.newConversation.test.tsx`
   - Requirements:
     - Purpose: replace fetch-abort expectations with WS cancel_inflight behavior and assert navigation does not cancel.

13. [x] Client unit test (Jest/RTL): update client/src/test/useChatStream.reasoning.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatStream.reasoning.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

14. [x] Client unit test (Jest/RTL): update client/src/test/useChatStream.toolPayloads.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

15. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.citations.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.citations.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

16. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.toolDetails.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.toolDetails.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

17. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.reasoning.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.reasoning.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

18. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.markdown.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.markdown.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

19. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.mermaid.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.mermaid.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

20. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.noPaths.test.tsx to consume WS fixtures instead of SSE
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.noPaths.test.tsx`
   - Requirements:
     - Purpose: keep existing UI coverage valid when chat streaming becomes WS-only.

21. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.provider.test.tsx for POST /chat 202 + WS transcript contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.provider.test.tsx`
   - Requirements:
     - Purpose: ensure provider/model selection flows align with new start-run response and WS events.

22. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.provider.conversationSelection.test.tsx for POST /chat 202 + WS transcript contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.provider.conversationSelection.test.tsx`
   - Requirements:
     - Purpose: ensure provider/model selection flows align with new start-run response and WS events.

23. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.source.test.tsx for POST /chat 202 + WS transcript contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.source.test.tsx`
   - Requirements:
     - Purpose: ensure provider/model selection flows align with new start-run response and WS events.

24. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.models.test.tsx for POST /chat 202 + WS transcript contract
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPage.models.test.tsx`
   - Requirements:
     - Purpose: ensure provider/model selection flows align with new start-run response and WS events.

25. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.approval.default.test.tsx for 202 start-run + WS-only contract
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

26. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.approval.payload.test.tsx for 202 start-run + WS-only contract
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

27. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.network.default.test.tsx for 202 start-run + WS-only contract
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

28. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.network.payload.test.tsx for 202 start-run + WS-only contract
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

29. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.reasoning.default.test.tsx for 202 start-run + WS-only contract
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

30. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.reasoning.payload.test.tsx for 202 start-run + WS-only contract
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

31. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.sandbox.default.test.tsx for 202 start-run + WS-only contract
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

32. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.sandbox.payload.test.tsx for 202 start-run + WS-only contract
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

33. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.sandbox.reset.test.tsx for 202 start-run + WS-only contract
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

34. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.websearch.default.test.tsx for 202 start-run + WS-only contract
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

35. [x] Client unit test (Jest/RTL): update client/src/test/chatPage.flags.websearch.payload.test.tsx for 202 start-run + WS-only contract
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

36. [x] Client unit test (Jest/RTL): sidebar selection is cleared when the user changes the filter (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://testing-library.com/docs/react-testing-library/intro/
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Requirements:
     - Purpose: match the acceptance criteria “Selection is cleared when the user changes the view filter”.
     - Render the Chat sidebar with a list of conversations.
     - Select 1+ rows, switch the filter (`Active` → `Archived`), and assert the selection count resets to 0.

37. [x] Client unit test (Jest/RTL): selection stays stable when the conversation list reorders due to live updates (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Requirements:
     - Purpose: match the acceptance criteria “Selection is retained while streaming sidebar updates arrive / resorting by lastMessageAt”.
     - Select a conversationId, then simulate a list update that changes ordering.
     - Assert the selected conversation remains selected after resort.

38. [x] Client unit test (Jest/RTL): bulk action buttons and select-all checkbox reflect the active filter state (happy path)
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

39. [x] Client unit test (Jest/RTL): permanent delete requires confirmation dialog (error-prevention case)
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

40. [x] Client unit test (Jest/RTL): when `mongoConnected === false`, bulk actions are disabled and the UI explains why (error case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Purpose:
     - Enforce acceptance criteria gating for safety when persistence is unavailable.
   - Requirements:
     - Force persistence status to unavailable.
     - Assert selection and bulk action controls are disabled and a clear message is shown.

41. [x] Client unit test (Jest/RTL): Chat sidebar ignores `conversation_upsert` events for agent conversations (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Purpose:
     - Ensure the Chat sidebar remains scoped to `agentName=__none__` and does not leak agent conversations into chat history.
   - Requirements:
     - Simulate a `conversation_upsert` event whose `conversation.agentName` is a non-empty string.
     - Assert it is ignored (not rendered in the Chat sidebar list).

42. [x] Client unit test (Jest/RTL): update client/src/test/chatPersistenceBanner.test.tsx for persistence-unavailable banner states
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/chatPersistenceBanner.test.tsx`
   - Requirements:
     - Purpose: ensure the banner messaging remains clear and stable when `mongoConnected === false`.

43. [x] E2E test (Playwright): update e2e/chat.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

44. [x] E2E test (Playwright): update e2e/chat-tools.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-tools.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

45. [x] E2E test (Playwright): update e2e/chat-tools-visibility.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-tools-visibility.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

46. [x] E2E test (Playwright): update e2e/chat-reasoning.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-reasoning.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

47. [x] E2E test (Playwright): update e2e/chat-provider-history.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-provider-history.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

48. [x] E2E test (Playwright): update e2e/chat-mermaid.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-mermaid.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

49. [x] E2E test (Playwright): update e2e/chat-codex-trust.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-codex-trust.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

50. [x] E2E test (Playwright): update e2e/chat-codex-reasoning.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-codex-reasoning.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

51. [x] E2E test (Playwright): update e2e/chat-codex-mcp.spec.ts to mock chat via routeWebSocket instead of SSE
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat-codex-mcp.spec.ts`
   - Requirements:
     - Purpose: keep e2e deterministic when chat becomes WS-only; remove any SSE mocks for /chat.

52. [x] E2E test (Playwright): Logs page shows chat WS client streaming logs after receiving transcript events (happy path)
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/logs.spec.ts` (or create a new `e2e/chat-ws-logs.spec.ts`)
   - Purpose:
     - Prove WS streaming activity is observable end-to-end via the `/logs` store.
   - Requirements:
     - Use the WS chat mocks to emit at least: `inflight_snapshot`, `assistant_delta`, and `turn_final`.
     - Assert the Logs page contains client log entries like `chat.ws.client_connect` and `chat.ws.client_delta_received`.

53. [x] Client unit test (Jest/RTL): AgentsPage renders in-flight WS transcript updates for agent conversations (happy path)
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

54. [x] Client unit test (Jest/RTL): AgentsPage unsubscribes from the previous conversation on switch/unmount (corner case)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Purpose:
     - Prevent WS subscription leaks when switching agent conversations.
   - Requirements:
     - Switch `activeConversationId` and assert the mock WebSocket recorded an `unsubscribe_conversation` for the old id.

55. [x] Update `projectStructure.md` with any added/removed test helpers and fixtures:
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

56. [x] Ensure the UI emits and/or asserts the key log lines that prove WS streaming + bulk actions are working end-to-end (add missing logs if needed so manual checks and e2e can validate behavior):
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

57. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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
   - Open `/chat` and confirm chat streaming works end-to-end (WS-only).
   - Open `/logs` and confirm chat WS client logs and server logs are present.
   - Confirm log lines exist for this task:
     - Search for `chat.ws.client_snapshot_received`, `chat.ws.client_final_received`, and `chat.sidebar.bulk_action_result`.
   - Regression: ingest pages and LM Studio pages still load and basic actions work.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-28: Added `client/src/test/support/mockWebSocket.ts` and refactored `client/src/test/setupTests.ts` to install the shared JSDOM WebSocket mock via `installMockWebSocket()`.
- 2025-12-28: Updated `common/src/fixtures/chatStream.ts` with WS-shaped fixtures for transcript events (`inflight_snapshot`, `assistant_delta`, `analysis_delta`, `tool_event`, `turn_final`) while keeping existing SSE fixtures intact.
- 2025-12-28: Added initial `client/src/test/useChatWs.test.ts` plus shared WebSocket mock wiring to support deterministic hook-level unit tests.
- 2025-12-28: Added `useChatWs` Jest coverage for mount/unmount lifecycle, unknown event types, malformed JSON frames, stale `seq` ignores, and reconnect resubscribe behavior.
- 2025-12-28: Added `realtimeEnabled` gating to `useChatWs` and verified disabled-state behavior in tests (no subscribe messages and no auto-reconnect when persistence is unavailable).
- 2025-12-28: Stabilized `useChatWs` by storing callbacks in refs (avoid reconnect storms when parents pass inline params) so tests and UI do not create extra WS connections on re-render.
- 2025-12-28: Updated `client/src/test/chatPage.stream.test.tsx` to assert navigation/unmount does not emit `cancel_inflight` (WS-only transport).
- 2025-12-28: Updated `client/src/test/chatPage.stop.test.tsx` with a persistence-unavailable (`mongoConnected=false`) case to ensure Stop still sends `cancel_inflight`.
- 2025-12-28: Updated ChatPage “New conversation” to send `cancel_inflight` for any active run and updated `client/src/test/chatPage.newConversation.test.tsx` accordingly.
- 2025-12-28: Verified existing Jest/RTL chat transcript tests (reasoning/tool payloads/citations/tool details/markdown/mermaid/no-paths) already consume WS transcript fixtures and contain no SSE parsing.
- 2025-12-28: Updated `client/src/test/chatPage.provider.conversationSelection.test.tsx` to remove SSE mocks and align with 202 start-run + WS contract; also stabilized `client/src/test/chatPage.models.test.tsx` with explicit `/health` + `/conversations` mocks.
- 2025-12-28: Migrated remaining Codex flag tests off SSE (`ReadableStream` fixtures) so all `chatPage.flags.*` tests align with `POST /chat` returning `202` JSON start-run responses.
- 2025-12-28: Updated `client/src/components/chat/ConversationList.tsx` bulk delete visibility (delete only in Archived view) and rewrote `client/src/test/chatSidebar.test.tsx` to cover selection reset, reorder stability, indeterminate select-all, delete confirmation, persistence-disabled gating, and ignoring agent `conversation_upsert` events.
- 2025-12-28: Updated `client/src/test/chatPersistenceBanner.test.tsx` to assert banner messaging and reset WS mocks between runs.
- 2025-12-28: Added `e2e/chat-ws-logs.spec.ts` to assert the Logs UI shows client-forwarded chat WS log lines after mocked transcript events.
- 2025-12-28: Reworked `e2e/support/mockChatWs.ts` to use Playwright `page.routeWebSocket('**/ws')` for deterministic WS mocking across all chat e2e specs.
- 2025-12-28: Added `client/src/test/agentsPage.streaming.test.tsx` to cover AgentsPage live WS transcript rendering and subscription cleanup on conversation switch.
- 2025-12-28: Updated `projectStructure.md` to list newly added WS test helpers/specs (`client/src/test/support/mockWebSocket.ts`, `client/src/test/useChatWs.test.ts`, `client/src/test/agentsPage.streaming.test.tsx`, `e2e/chat-ws-logs.spec.ts`, `e2e/support/mockChatWs.ts`).
- 2025-12-28: Verified required observability log messages are present and now asserted in e2e (`chat.ws.client_connect`, `chat.ws.client_snapshot_received`, `chat.ws.client_final_received`, `chat.sidebar.bulk_action_result`, `conversations.bulk.success`).
- 2025-12-28: Ran `npm run lint --workspaces` (ok) and `npm run format:check --workspaces`; applied `npm run format --workspaces` to fix client formatting and re-verified checks pass.
- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed.
- Testing 4: `npm run test --workspace client` passed.
- Testing 5: `npm run e2e` passed.
- Testing 6: `npm run compose:build` passed.
- Testing 7: `npm run compose:up` passed.
- Testing 8: Verified compose UI routes respond (200 for `http://host.docker.internal:5001/chat` + `/logs`), server health ok, WS handshake ok, and `/logs` contains `chat.ws.client_snapshot_received`, `chat.ws.client_final_received`, and `chat.sidebar.bulk_action_result`.
- Testing 9: `npm run compose:down` passed.
- Note: When verifying Compose from inside a container, the Vite build arg `VITE_API_URL=http://localhost:5010` points at the container, not the host; use `http://host.docker.internal:5010` for checks.

---

### 10. Final verification

- Task Status: **__done__**
- Git Commits: 2652330
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

1. [x] Update `README.md` with any new commands or behavioral changes:
   - Files to read:
     - `README.md`
   - Files to edit:
     - `README.md`
   - Purpose:
     - Keep developer/user-facing instructions current for running and verifying the updated behavior.
   - Description:
     - Update README.md to reflect any new commands, environment variables, or behavioral changes introduced by this story.

2. [x] Update `design.md` with any new diagrams or architecture changes:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Keep the architecture/flow documentation accurate so future changes and tests follow the intended contract.
   - Description:
     - Update design.md with the flow/contract changes introduced by this subtask (include any required Mermaid diagrams referenced in the Requirements).

3. [x] Update `projectStructure.md` with any updated/added/removed files:
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

4. [x] Create a PR summary comment (what changed, why, and how to verify):
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

5. [x] Confirm the story’s WS/bulk “observability log lines” are present end-to-end in `/logs` during the final manual check (add any missing logs if earlier tasks didn’t implement them):
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

6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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
   - Optional (if you suspect Docker caching issues): `npm run compose:build:clean`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (story-focused + regressions):
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

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-28: Started Task 10.
- 2025-12-28: Updated `README.md` to remove chat SSE references and document the `POST /chat` (202) + `/ws` streaming contract.
- 2025-12-28: Updated `design.md` to align the architecture diagrams and UI notes with WS-only streaming (removed remaining chat SSE references; kept `/logs/stream` SSE).
- 2025-12-28: Updated `projectStructure.md` to remove remaining chat SSE references (chat is `POST /chat` 202 + `/ws`), keeping SSE notes only for `/logs/stream` and legacy fixtures.

- 2025-12-28: PR summary (Story 0000019)
  - User-visible: Chat/Agents transcripts now stream via WebSocket subscriptions (late subscribers receive an `inflight_snapshot` catch-up), and switching conversations/unmounting unsubscribes without cancelling the run. Stop/cancel uses `cancel_inflight`.
  - User-visible: Chat sidebar adds a 3-state filter (active/archived/all), multi-select, and bulk archive/restore/delete with confirmation + snackbar feedback; persistence-disabled mode gates bulk actions.
  - API/contract: `POST /chat` returns HTTP 202 (`{ status:"started", conversationId, inflightId, provider, model }`) and chat SSE is removed; transcript events are delivered over `/ws` (`inflight_snapshot`, `assistant_delta`, `analysis_delta`, `tool_event`, `turn_final`). Conversation list now supports `GET /conversations?state=active|archived|all` (legacy `archived=true` maps to `state=all`). Bulk endpoints: `POST /conversations/bulk/archive|restore|delete` (delete is archived-only; conflicts return 409 `BATCH_CONFLICT`).
  - Observability: server + forwarded client logs are searchable in `/logs` (`conversations.list.request`, `conversations.bulk.success`, `chat.ws.connect`, `chat.run.started`, `chat.stream.snapshot`, `chat.stream.final`, plus `chat.ws.client_*` and `chat.sidebar.bulk_action_result`).

  How to verify:
  - Static checks: `npm run lint --workspaces` and `npm run format:check --workspaces`
  - Unit/integration: `npm run test --workspace server` and `npm run test --workspace client`
  - Builds: `npm run build --workspace server` and `npm run build --workspace client`
  - E2E: `npm run e2e`

  Notable edge cases covered:
  - Late-subscriber transcript recovery via `inflight_snapshot`.
  - Out-of-order transcript event protection via per-conversation `seq` gating.
  - `cancel_inflight` on missing/finished runs (returns terminal error/final semantics).
  - Bulk all-or-nothing conflict handling (409 with invalid ids/state).

- 2025-12-28: Ran `npm run lint --workspaces` (ok) and `npm run format:check --workspaces` (ok).
- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed.
- Testing 4: `npm run test --workspace client` passed.
- Testing 5: `npm run e2e` passed.
- Testing 6: `npm run compose:build` passed.
- Testing 7: `npm run compose:up` passed.
- Testing 8: Manual smoke/regression check executed against `http://host.docker.internal:5001`/`:5010` and screenshots saved under `test-results/screenshots/` (prefix `0000019-10-*`).
- Testing 9: `npm run compose:down` passed.

- 2025-12-28: Fixup during Task 10 — server Cucumber test Chroma startup needed an HTTP wait strategy (chroma image lacks curl/wget for container healthchecks).
- Docs to reference for this task:
  - Docker/Compose: for clean rebuilds, up/down, and debugging port routing.
  - Playwright: for screenshot automation and stable UI selectors.
  - Mermaid: for keeping diagrams in README/design.md aligned with the WS-only architecture.
- Gotchas:
  - Chat streaming is WS-only now (`POST /chat` returns 202); any remaining SSE references in docs must be removed/updated.
  - When validating Compose from inside this container, use `http://host.docker.internal:<port>` (not `localhost`) to avoid hitting the in-container dev server.
  - Manual verification requires saving screenshots under `test-results/screenshots/`.

---

### 11. Fix WS sequence gating to accept new in-flight runs

- Task Status: **__done__**
- Git Commits: **ca9c8a6**

#### Overview

The client currently carries `lastSeq` across multiple in-flight runs for the same conversation. Because the server resets sequence numbers per run, this causes new deltas/finals to be dropped as “stale”, which hides follow-up responses until a refresh. This task ensures the client resets or scopes sequence tracking so new in-flight runs are always accepted.

#### Documentation Locations

- WebSocket protocol semantics (client-side ordering expectations): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React hooks lifecycle reminders (effects + cleanup): https://react.dev/learn
- Jest/RTL patterns for hook-driven UI tests: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Reproduce the stale-seq drop in a client test:
   - Files to read:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/chatPage.stream.test.tsx`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or add `client/src/test/useChatWs.seq.test.ts`)
   - Test requirements:
     - Simulate a first run that ends with `seq = N`.
     - Simulate a second run starting at `seq = 1`.
     - Assert the second run’s `assistant_delta` + `turn_final` are accepted and rendered (not dropped as stale).

2. [x] Update the client sequence tracking to reset per in-flight run:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - When a new in-flight run is detected (snapshot/new inflightId/final from new run), reset or scope `lastSeq` so lower seq values are accepted.
     - Preserve stale/out-of-order protections within a single run.
     - Ensure logging includes enough context to verify the reset path in `/logs`.

3. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or the new test file from subtask 1)
   - Requirements:
     - The new test must fail before the fix and pass after.
     - Add an assertion that no “stale event ignored” path fires for the new run.

4. [x] Documentation update (if the seq reset behavior is user-visible or architecture-relevant):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a short note that sequence gating is scoped per in-flight run (not per conversation across runs).
     - If no updates are needed, mark this subtask as “no changes required”.

5. [x] Run lint/format for the client workspace after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run test --workspace client`

2. [x] Playwright MCP manual verification (repeat the exact steps that previously proved the issue):
   - Start a new chat with LM Studio, wait for the response, confirm it appears without refresh.
   - Send a follow-up in the same conversation and confirm both the previous response and the new response remain visible without refresh.
   - Repeat once with Codex (when available) to confirm new runs are not dropped.
   - Visit `/logs` and confirm there are no `chat.ws.client_stale_event_ignored` entries for the new run sequence.

#### Implementation notes

- 2025-12-29: Added a chat stream test that simulates seq reset between runs; the test fails under per-conversation seq gating and passes once inflight-scoped gating is in place.
- 2025-12-29: Updated the WS client to key sequence tracking by `conversationId + inflightId`, and tightened stale-event logging to include explicit `conversationId`/`inflightId` fields; switched the logger ref to `useMemo` to satisfy the refs-in-render lint rule.
- 2025-12-29: Documented that sequence gating is scoped per in-flight run in `design.md`.
- 2025-12-29: Ran `npm run lint --workspace client`, `npm run format --workspace client`, `npm run format:check --workspace client`, and `npm run test --workspace client`.
- 2025-12-29: Playwright MCP check against Docker Compose: sent two LM Studio prompts in the same conversation; `/logs` shows `chat.ws.client_final_received` for the second inflight and **zero** `chat.ws.client_stale_event_ignored` entries for that new inflight. Stale-event logs observed were for the prior inflight only.

---

### 12. Prevent empty history hydration from clearing in-flight transcript

- Task Status: **__done__**
- Git Commits: **e58728e**

#### Overview

When a run starts, the client streams tokens via WebSocket and separately hydrates persisted turns. If the history request returns an empty set (or late), the current implementation can replace the streamed messages with the empty snapshot, hiding the visible response until a manual refresh. This task ensures hydration merges safely and never clears the in-flight transcript.

#### Documentation Locations

- React hooks lifecycle reminders (effects + cleanup): https://react.dev/learn
- Jest/RTL patterns for hook-driven UI tests: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Reproduce the hydration overwrite in a client test:
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/chatPage.stream.test.tsx`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or add `client/src/test/useConversationTurns.hydration.test.tsx`)
   - Test requirements:
     - Simulate WebSocket streaming of an assistant response.
     - Simulate a late/empty history response (`GET /conversations/:id/turns` returns no items).
     - Assert the streamed response remains visible after hydration.

2. [x] Update hydration merge logic to preserve in-flight transcript:
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Merging persisted turns must not wipe in-flight streamed state.
     - If the snapshot is empty and a stream is active, retain the streamed transcript.
     - Keep existing behavior for normal (non-empty) snapshots.

3. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or the new test file from subtask 1)
   - Requirements:
     - The new test must fail before the fix and pass after.
     - Include an assertion that the transcript remains visible without refresh.

4. [x] Documentation update (if the hydration merge behavior is user-visible or architecture-relevant):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a short note that hydration merges into in-flight UI without clearing streamed content.
     - If no updates are needed, mark this subtask as “no changes required”.

5. [x] Run lint/format for the client workspace after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`

#### Testing

1. [x] `npm run test --workspace client`

2. [x] Playwright MCP manual verification (repeat the exact steps that previously proved the issue):
   - Start a new chat and wait for the response without refreshing; the transcript must appear immediately.
   - Verify the response remains visible after any history refresh/hydration (no blank transcript).
   - Check `/logs` to confirm the streaming events are received and no “hydrate replaced transcript” regression is observed.

#### Implementation notes

- 2025-12-29: Added a chat streaming test that emits WS text then triggers a turns hydration returning an empty page; the test asserts the assistant text remains visible.
- 2025-12-29: Hydration now merges persisted turns into the current transcript when an in-flight run exists, preventing replace-mode fetches (empty or partial) from clearing streaming content.
- 2025-12-29: Documented the hydration merge behavior in `design.md`.
- 2025-12-29: Ran `npm run lint --workspace client`, `npm run format --workspace client`, `npm run format:check --workspace client`, and `npm run test --workspace client`.
- 2025-12-29: Playwright MCP check (Compose rebuild): sent a new LM Studio message, observed streamed assistant output remain visible after the turns hydration (`count: 1`) and subsequent live updates; `/logs` confirms `chat.ws.client_delta_received` entries for the same conversation.

---

### 13. Prevent duplicate bubbles when hydration arrives during streaming

- Task Status: **__done__**
- Git Commits: **6ae29dd**

#### Overview

When a message is sent, the UI creates an in-flight bubble immediately and later hydrates persisted turns from the server. The persisted turn uses a different ID (derived from `createdAt`) than the in-flight bubble, so the hydration merge can show duplicate user/assistant bubbles for a single request. This task ensures hydration dedupes against the active in-flight bubbles so only one bubble is shown.

#### Documentation Locations

- React hooks lifecycle reminders (effects + cleanup): https://react.dev/learn
- Jest/RTL patterns for hook-driven UI tests: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Reproduce the duplicate-bubble behavior in a client test:
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/test/chatPage.stream.test.tsx`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
   - Test requirements:
     - Simulate an in-flight user + assistant bubble.
     - Hydrate with turns that represent the same request (same role/content/createdAt time window).
     - Assert only one user bubble and one assistant bubble remain after hydration.

2. [x] Implement dedupe logic for hydration vs in-flight bubbles:
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Use stable matching to treat persisted turns as the same bubble as the in-flight message (e.g., by role + content + createdAt proximity, or by explicitly carrying a client message id through to persistence).
     - Ensure dedupe works for both user and assistant bubbles.
     - Preserve current behavior for unrelated historical turns.

3. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
   - Requirements:
     - The new test must fail before the fix and pass after.
     - Include an assertion that the transcript does not show duplicates after hydration completes.

4. [x] Documentation update (if the dedupe approach is user-visible or architecture-relevant):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a short note describing how in-flight bubbles are reconciled with persisted turns.
     - If no updates are needed, mark this subtask as “no changes required”.

5. [x] Run lint/format for the client workspace after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`

#### Testing

1. [x] `npm run test --workspace client`

2. [x] Playwright MCP manual verification (repeat the exact steps that showed duplicates):
   - Send a prompt and observe the streaming assistant bubble.
   - Wait for history hydration to complete.
   - Confirm only one user bubble and one assistant bubble remain (no duplicate content).

#### Implementation notes

- 2025-12-29: Added a streaming test that hydrates persisted turns matching the in-flight user + assistant bubble and asserts only one bubble remains for each.
- 2025-12-29: Updated `useChatStream` hydration to reconcile persisted turns against recent in-flight messages (role/content/time) and replace duplicates in-place to avoid double bubbles.
- 2025-12-29: Documented the dedupe behavior in `design.md` under the chat streaming hydration notes.
- 2025-12-29: Ran `npm run lint --workspace client`, `npm run format --workspace client`, `npm run format:check --workspace client`, and `npm run test --workspace client`.
- 2025-12-29: Playwright MCP check on the compose stack: sent a prompt, waited for hydration, and confirmed exactly one user bubble and one assistant bubble for the turn.

---

### 14. Treat transient Codex reconnects as warnings (no failed turns)

- Task Status: **__done__**
- Git Commits: **5248a37, 601f34d**

#### Overview

Codex sometimes emits transient errors like “Reconnecting... 1/5” during a run. Today these errors are treated as terminal failures, causing the UI to show a red failed bubble and stop streaming even though the run ultimately succeeds. This task ensures transient reconnects are surfaced as warnings (if shown at all) and do not flip the stream to a failed state or clear the in-flight transcript.

#### Documentation Locations

- WebSocket event handling (client): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Node EventEmitter (server stream bridge): https://nodejs.org/api/events.html
- ws library behavior (server): https://github.com/websockets/ws
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Reproduce the transient reconnect failure in tests:
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/chat/responders/McpResponder.ts`
     - `server/src/agents/transientReconnect.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `server/src/test/unit/ws-chat-stream.test.ts` (or a new focused unit test)
     - `client/src/test/chatPage.stream.test.tsx`
   - Test requirements:
     - Simulate a Codex stream that emits an error message `Reconnecting... 1/5` followed by additional deltas/final.
     - Assert the server does **not** publish `turn_final` with `status: failed` for the transient reconnect.
     - Assert the client does **not** render a failed bubble and continues to accept subsequent deltas/final.
   - Reference snippets (repeat from story so this subtask is standalone):
     - Existing transcript final event (current WS contract):
       ```json
       {
         "type": "turn_final",
         "conversationId": "c1",
         "inflightId": "i1",
         "status": "failed",
         "error": { "code": "STREAM_ERROR", "message": "Reconnecting... 1/5" }
       }
       ```
     - Transient reconnect text to simulate: `"Reconnecting... 1/5"` (exact string).
   - Test scaffolding hints:
     - Server WS tests use `connectWs`, `sendJson`, `waitForEvent` from `server/src/test/support/wsClient.ts`.
     - Client WS tests use `installMockWebSocket()` + `MockWebSocket._receive()` from `client/src/test/support/mockWebSocket.ts`.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://nodejs.org/api/events.html
     - https://github.com/websockets/ws
     - Context7 `/jestjs/jest`
     - Context7 `/microsoft/playwright`

2. [x] Implement transient reconnect handling on the server stream path:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/ws/types.ts` (if introducing a new warning event)
   - Requirements:
     - Detect transient reconnect messages using `isTransientReconnect`.
     - Do **not** mark the run as failed or publish a failed `turn_final`.
     - If a warning event is added, send it to clients without terminating the inflight.
     - Ensure inflight state is preserved so streaming continues.
   - Reference snippets (repeat):
     - Transient reconnect helper: `server/src/agents/transientReconnect.ts` exports `isTransientReconnect(message: string): boolean`.
     - Existing failure path to avoid: `chat.emit('error', { message })` should **not** convert to `turn_final` failed when `isTransientReconnect(message)` is true.
     - If adding a warning event, keep it minimal, e.g.:
       ```json
       { "type": "stream_warning", "conversationId": "c1", "inflightId": "i1", "message": "Reconnecting... 1/5" }
       ```
   - Code anchors (where the junior dev should look first):
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts` (error handling path)
     - `server/src/chat/chatStreamBridge.ts` (maps errors to `turn_final`)
     - `server/src/ws/types.ts` (WS event union typing)
   - Docs (repeat):
     - https://nodejs.org/api/events.html
     - https://github.com/websockets/ws
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

3. [x] Update client handling to display a warning (not a failure) and continue streaming:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Surface transient reconnects as a warning UI element (chip/inline note) if received.
     - Keep `streamStatus` in `processing` and allow subsequent deltas/final to render.
     - Add client log entries for warnings using the existing `/logs` forwarding style.
   - Reference snippets (repeat):
     - Client WS handling entry point: `client/src/hooks/useChatWs.ts` → `ws.onmessage` parses `WsServerEvent`.
     - If adding a warning event, add it to the `WsServerEvent` union and handle it without setting a failed state.
     - Suggested warning payload (if introduced):
       ```json
       { "type": "stream_warning", "conversationId": "c1", "inflightId": "i1", "message": "Reconnecting... 1/5" }
       ```
     - Logging style (existing pattern): `log('info' | 'warn', 'chat.ws.client_*', { ... })` in `useChatWs`.
   - UI anchor:
     - `client/src/pages/ChatPage.tsx` (where warning UI can be shown).
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://react.dev/learn/synchronizing-with-effects
     - Context7 `/jestjs/jest`

4. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `server/src/test/unit/ws-chat-stream.test.ts`
     - `client/src/test/chatPage.stream.test.tsx`
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Assert the final assistant bubble is `complete` (not `failed`) after a transient reconnect.
   - Test scaffolding hints (repeat):
     - Server: use `waitForEvent` in `server/src/test/support/wsClient.ts` to assert no failed `turn_final`.
     - Client: use `MockWebSocket._receive()` to emit a warning event before `turn_final`.
   - Docs (repeat):
     - Context7 `/jestjs/jest`
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

5. [x] Documentation update (if warning events affect protocol/UX):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that transient reconnects emit warnings without failing the turn.
     - Document any new WS event type (if added).
     - If no updates are needed, mark this subtask as “no changes required”.
   - Reference snippet (repeat):
     - WS event types live in `client/src/hooks/useChatWs.ts` and `server/src/ws/types.ts`.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://react.dev/learn

6. [x] Run lint/format for affected workspaces after code/test changes:
   - Commands to run:
     - `npm run lint --workspace server`
     - `npm run lint --workspace client`
     - `npm run format:check --workspace server`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (repeat the exact steps that showed the failure + regressions):
   - Trigger a Codex run that emits “Reconnecting... n/m”.
     - Docker option (deterministic):
       - Start a Codex run and wait for streaming to begin in the UI.
       - Temporarily disconnect the server container from the compose network for ~5–10s, then reconnect:
         - `docker network disconnect codeinfo2_default codeinfo2-server`
         - `docker network connect codeinfo2_default codeinfo2-server`
       - Confirm Codex emits the transient reconnect message while the run continues.
   - Confirm the UI shows a warning (not a failure) and continues streaming.
   - Confirm the final response renders without refresh and is marked complete.
   - Regression: sidebar updates still stream (new conversation appears without refresh).
- Capture screenshots of the warning and the final completed bubble for the plan archive.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-29: Added failing coverage for transient reconnects in `server/src/test/unit/ws-chat-stream.test.ts` and `client/src/test/chatPage.stream.test.tsx` (plus `client/src/test/support/mockChatWs.ts` harness support). The new tests simulate `Reconnecting... 1/5` followed by continued deltas/final and currently fail until the server/client warning behavior is implemented.
- 2025-12-29: Updated the server stream bridge + chat run status derivation to treat transient reconnect messages (`isTransientReconnect`) as non-terminal. The WebSocket protocol now includes a `stream_warning` event, and transient reconnect `error` events no longer publish `turn_final` failed or clear in-flight state.
- 2025-12-29: Added client support for `stream_warning` events, logging them as `chat.ws.client_stream_warning`, and rendering warning chips inside the assistant bubble while keeping the stream in `processing` until the final arrives.
- 2025-12-29: Verified the new transient reconnect tests pass (server `ws-chat-stream` unit test + client `chatPage.stream` jest suite) and confirmed transient reconnects no longer flip the assistant bubble to `Failed`.
- 2025-12-29: Updated `design.md` to document the new `stream_warning` WebSocket transcript event and clarify that transient reconnects are non-terminal.
- 2025-12-29: Ran `npm run lint --workspace server`, `npm run lint --workspace client`, `npm run format:check --workspace server`, and `npm run format:check --workspace client` (plus `npm run format --workspace client` to fix Prettier output).
- 2025-12-29: Testing step 1 complete: `npm run build --workspace server`.
- 2025-12-29: Testing step 2 complete: `npm run build --workspace client`.
- 2025-12-29: Testing step 3 complete: `npm run test --workspace server`.
- 2025-12-29: Testing step 4 complete: `npm run test --workspace client`.
- 2025-12-29: Testing step 5 complete: `npm run e2e`.
- 2025-12-29: Testing step 6 complete: `npm run compose:build`.
- 2025-12-29: Testing step 7 complete: `npm run compose:up`.
- 2025-12-29: Testing step 8 complete: Used Playwright against `http://host.docker.internal:5001/chat` and (for determinism) injected a `stream_warning` + continued deltas via the existing `window.__CODEINFO_TEST__` hook, then captured screenshots: `test-results/screenshots/0000019-14-reconnect-warning.png` and `test-results/screenshots/0000019-14-reconnect-complete.png`.
- 2025-12-29: Testing step 9 complete: `npm run compose:down`.

---

### 15. Fix Codex reasoning delta truncation (multi-item reasoning support)

- Task Status: **__done__**
- Git Commits: **745e203, 7ef4031**

#### Overview

Codex reasoning streams arrive as `item.type === "reasoning"` events. The current delta logic assumes a single growing reasoning buffer per turn. If Codex emits multiple reasoning items or resets text between items, the prefix is sliced off and subsequent reasoning is truncated or dropped. This task updates the reasoning delta handling so each reasoning item is processed safely, ensuring the UI shows complete thinking text.

#### Documentation Locations

- Node EventEmitter (server stream bridge): https://nodejs.org/api/events.html
- WebSocket event handling (client): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Reproduce the truncation in tests:
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `client/src/hooks/useChatStream.ts`
   - Files to edit:
     - `server/src/test/unit/chat-codex-reasoning-delta.test.ts` (new)
     - `client/src/test/chatPage.reasoning.test.tsx` (extend if needed)
   - Test requirements:
     - Simulate two separate reasoning items where the second resets text or is shorter than the first.
     - Assert both reasoning blocks are emitted as `analysis_delta` and appear in the client transcript.
   - Reference snippets (repeat from story so this subtask is standalone):
     - Codex reasoning items arrive with `item.type === "reasoning"` and `item.text` (see `server/src/chat/interfaces/ChatInterfaceCodex.ts`).
     - Existing WS event for reasoning is `analysis_delta`:
       ```json
       { "type": "analysis_delta", "conversationId": "c1", "inflightId": "i1", "delta": "thinking..." }
       ```
     - Example of a reset scenario to simulate:
       - Item 1 text: `"Reasoning part A..."`
       - Item 2 text: `"New block"` (shorter / not prefixed)
   - Test scaffolding hints:
     - Server unit tests can build a scripted chat interface like in `server/src/test/unit/ws-chat-stream.test.ts`.
     - Client tests should use `installMockWebSocket()` from `client/src/test/support/mockWebSocket.ts` and feed `analysis_delta` events.
   - Docs (repeat):
     - https://nodejs.org/api/events.html
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - Context7 `/jestjs/jest`

2. [x] Update Codex reasoning delta logic to handle multi-item streams:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Requirements:
     - Detect non-prefix resets and treat them as a new reasoning block.
     - If an item id is available, scope the buffer per item id to avoid collisions.
     - Keep existing behavior for truly cumulative reasoning streams.
   - Reference snippets (repeat):
     - Current pattern (to replace): `delta = text.slice(reasoningText.length)` assumes a single growing buffer.
     - Recommended guard:
       - If `!text.startsWith(previousText)` then treat `text` as a fresh block and emit full `text`.
     - If item ids exist, use a map `reasoningByItemId[itemId] = lastText`.
   - Code anchors:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts` (reasoning aggregation and delta emission).
   - Docs (repeat):
     - https://nodejs.org/api/events.html

3. [x] Add server logs for reasoning resets (optional but helpful for debugging):
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/logger.ts` (if a new log key is required)
   - Requirements:
     - Log when a reasoning reset is detected (message + item id if present).
     - Ensure logs respect the existing `LogEntry` schema.
   - Reference snippet (repeat):
     - Logging pattern in server uses `logger.info({ ... }, 'message')` via `server/src/logger.ts`.
   - Docs (repeat):
     - https://nodejs.org/api/events.html
     - https://github.com/pinojs/pino

4. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `server/src/test/unit/chat-codex-reasoning-delta.test.ts`
     - `client/src/test/chatPage.reasoning.test.tsx`
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Assert no missing prefix in the rendered reasoning content.
   - Test scaffolding hints (repeat):
     - Server: new test can mirror the `analysis_delta updates assistantThink` case in `server/src/test/unit/ws-chat-stream.test.ts`.
     - Client: `client/src/test/chatPage.reasoning.test.tsx` already renders reasoning; add a case with two reasoning blocks.
   - Docs (repeat):
     - Context7 `/jestjs/jest`

5. [x] Documentation update (if reasoning stream behavior changes are user-visible):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that reasoning deltas now handle multi-item streams or resets safely.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Reference snippet (repeat):
     - WS event types live in `server/src/ws/types.ts` and `client/src/hooks/useChatWs.ts`.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

6. [x] Run lint/format for affected workspaces after code/test changes:
   - Commands to run:
     - `npm run lint --workspace server`
     - `npm run lint --workspace client`
     - `npm run format:check --workspace server`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Trigger a Codex run that emits multiple reasoning items (or a reset).
   - Confirm the “Thought process” shows full reasoning with no missing prefix.
   - Regression: normal assistant streaming still renders without refresh.
   - Capture a screenshot of the expanded reasoning block for the plan archive.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-30: Added a failing Codex reasoning reset reproduction in `server/src/test/unit/chat-codex-reasoning-delta.test.ts` and extended `client/src/test/chatPage.reasoning.test.tsx` to render two reasoning blocks via `analysis_delta` events. The server test simulates two distinct reasoning items where the second is shorter/non-prefix and currently fails until the delta logic is updated.
- 2025-12-30: Updated `server/src/chat/interfaces/ChatInterfaceCodex.ts` reasoning aggregation to scope buffers per `item.id` when available, detect non-prefix updates, and emit a new `analysis` block with a `\n\n` separator so multi-item or reset reasoning streams no longer truncate.
- 2025-12-30: Added a server logStore entry (`chat.codex.reasoning_reset`) when Codex emits a non-prefix reasoning update for the same item id, including previous/next lengths to aid debugging.
- 2025-12-30: Confirmed the new tests cover multi-item reasoning streams by asserting that both reasoning blocks are present (no truncation) when the second item resets to a shorter/non-prefix text.
- 2025-12-30: Updated `design.md` to note that Codex `analysis_delta` handling treats non-prefix reasoning updates as a new reasoning block (prefixed with `\n\n`) so the UI never truncates multi-item reasoning streams.
- 2025-12-30: Ran `npm run lint --workspace server`, `npm run lint --workspace client`, `npm run format:check --workspace server`, and `npm run format:check --workspace client` (using `npm run format --workspace server` and `npm run format --workspace client` to fix Prettier output).
- 2025-12-30: Testing step 1 complete: `npm run build --workspace server`.
- 2025-12-30: Testing step 2 complete: `npm run build --workspace client`.
- 2025-12-30: Testing step 3 complete: `npm run test --workspace server`.
- 2025-12-30: Testing step 4 complete: `npm run test --workspace client`.
- 2025-12-30: Testing step 5 complete: `npm run e2e`.
- 2025-12-30: Testing step 6 complete: `npm run compose:build`.
- 2025-12-30: Testing step 7 complete: `npm run compose:up`.
- 2025-12-30: Testing step 8 complete: Ran Playwright against `http://host.docker.internal:6001/chat` with the `window.__CODEINFO_TEST__` hook to inject two `analysis_delta` blocks (second block reset) and verified the expanded “Thought process” renders both blocks. Screenshot saved to `test-results/screenshots/0000019-15-reasoning-multiblock.png`.
- 2025-12-30: Testing step 9 complete: `npm run compose:down`.
### 16. Refresh transcript + sidebar snapshots on focus/reconnect (no cross-tab broadcast)

- Task Status: **__done__**
- Git Commits: **62efeef36556b360ecf9e47674ce354390f4e5e3**

#### Overview

When a tab is backgrounded, it can miss streamed events and local optimistic updates. Without cross-tab broadcasting, the simplest recovery is to refresh snapshots when the tab becomes active again and when the WebSocket reconnects. This task adds those refresh triggers and ensures the existing merge/dedupe logic preserves in-flight content.

#### Documentation Locations

- Browser focus/visibility events (client): https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- WebSocket reconnect patterns (client): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React effect cleanup (client): https://react.dev/learn/synchronizing-with-effects
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Reproduce the missing-history-on-tab-switch in a client test:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useChatWs.ts`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or new `client/src/test/chatPage.focusRefresh.test.tsx`)
   - Test requirements:
     - Simulate an in-flight assistant bubble in tab A.
     - Simulate tab A going `hidden` + tab B completing the run (via a history refresh in tab A).
     - Assert that a focus/visibility change triggers a refresh and the transcript matches the persisted turns (no missing messages).
   - Reference snippets (repeat):
     - Visibility event to simulate:
       ```ts
       Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
       document.dispatchEvent(new Event('visibilitychange'));
       ```
     - The refresh entry points to exercise:
       - `useConversationTurns().refresh()` for transcript
       - `useConversations().refresh()` for sidebar
   - Test scaffolding hints:
     - Client tests use `installMockWebSocket()` from `client/src/test/support/mockWebSocket.ts`.
     - Use `await act(async () => { ... })` when dispatching visibility events in RTL/JSDOM.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
     - https://react.dev/learn/synchronizing-with-effects
     - Context7 `/jestjs/jest`

2. [x] Implement focus/visibility refresh for the active conversation + sidebar:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useConversations.ts` (sidebar refresh)
   - Requirements:
     - On `visibilitychange` to `visible` (and/or `window.focus`), call `refresh()` for the active conversation turns and the conversation list snapshot.
     - Reuse existing merge/dedupe logic so refreshed data never clears in-flight content.
     - Ensure these listeners are cleaned up on unmount.
   - Reference snippets (repeat):
     - `useConversations` exposes `refresh()` in `client/src/hooks/useConversations.ts`.
     - `useConversationTurns` exposes `refresh()` in `client/src/hooks/useConversationTurns.ts`.
     - Visibility guard:
       ```ts
       if (document.visibilityState === 'visible') { /* refresh */ }
       ```
   - Code anchors:
     - `client/src/pages/ChatPage.tsx` (add focus/visibility listeners).
     - `client/src/hooks/useChatStream.ts` (merge/dedupe remains the source of truth).
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
     - https://react.dev/learn/synchronizing-with-effects

3. [x] Refresh on WebSocket reconnect (no cross-tab broadcast):
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - When the WS reconnects, re-fetch the conversation list snapshot and the active conversation turns.
     - Ensure reconnect refresh does not cause duplicate bubbles (reuse existing dedupe logic).
   - Reference snippets (repeat):
     - `useChatWs` supports `onReconnectBeforeResubscribe` (see `client/src/hooks/useChatWs.ts`).
     - Hook usage pattern:
       ```ts
       useChatWs({ onReconnectBeforeResubscribe: async () => { await refresh(); } })
       ```
   - Code anchors:
     - `client/src/hooks/useChatWs.ts` (reconnect callback is invoked before resubscribe).
     - `client/src/pages/ChatPage.tsx` (pass refresh callbacks into `useChatWs`).
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://react.dev/learn/synchronizing-with-effects

4. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or the new test file from subtask 1)
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Assert that a focus/visibility change (and WS reconnect) triggers refresh without losing the in-flight transcript.
   - Test scaffolding hints (repeat):
     - Use `document.dispatchEvent(new Event('visibilitychange'))` after setting `visibilityState`.
     - For WS reconnect tests, call `MockWebSocket.close()` then allow a new instance to open.
   - Docs (repeat):
     - Context7 `/jestjs/jest`
     - https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API

5. [x] Documentation update (if the refresh behavior is user-visible or architecture-relevant):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that the client refreshes the transcript + sidebar snapshot on tab focus/visibility + WS reconnect.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API

6. [x] Run lint/format for the client workspace after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (repeat the exact steps that showed the gap + regressions):
   - Start a new chat in Tab A and send a prompt.
   - Switch to Tab B (same conversation), wait for the assistant response to complete.
   - Switch back to Tab A and confirm the full transcript appears without manual refresh (no missing user/assistant bubbles).
   - Regression: new conversation appears in sidebar without refresh.
   - Visit `/logs` and confirm refresh-related log entries (if added) and that the transcript is complete.

9. [x] `npm run compose:down`

#### Implementation notes

- Added `client/src/test/chatPage.focusRefresh.test.tsx` to reproduce the missed-history scenario and assert that a visibility change / WS reconnect trigger snapshot refreshes.
- Updated `client/src/pages/ChatPage.tsx` to refresh both the sidebar snapshot (`useConversations().refresh()`) and the active transcript snapshot (`useConversationTurns().refresh()`) when the tab becomes visible or the window regains focus.
- Extended the existing `useChatWs` reconnect hook usage so a reconnect triggers the same snapshot refreshes before resubscribing.
- Updated `client/src/hooks/useChatStream.ts` hydration dedupe so a persisted assistant turn can replace a stale `streamStatus:"processing"` bubble (and clears inflight state) when snapshot refreshes show the run already completed.
- Updated `client/src/hooks/useConversationTurns.ts` to support `autoFetch` so ChatPage can avoid eager 404/placeholder fetches, while still allowing forced refresh on focus/reconnect.
- Documented the focus/visibility + reconnect snapshot refresh behavior in `design.md` under the Chat/Agents WebSocket lifecycle.
- `npm run lint --workspace client` passed; `npm run format:check --workspace client` passed after formatting the new test.
- Test 1: `npm run build --workspace server` passed.
- Test 2: `npm run build --workspace client` passed.
- Test 3: `npm run test --workspace server` passed.
- Test 4: `npm run test --workspace client` passed.
- Test 5: `npm run e2e` passed.
- Test 6: `npm run compose:build` passed.
- Test 7: `npm run compose:up` passed.
- Test 8: Manual check via headless Playwright against `http://host.docker.internal:5001` confirmed focus/visibility refresh triggers `/conversations` + `/turns` fetches, forced WS reconnect triggers the same refreshes, and `/logs` contains `chat.ws.client_connect` / `chat.ws.client_snapshot_received` lines.
- Test 9: `npm run compose:down` passed.

---

### 17. Include in-memory inflight state in conversation snapshot refresh

- Task Status: **__done__**
- Git Commits: **daf09cb**

#### Overview

Refreshing the conversation turns currently returns only persisted Mongo data, which means mid-stream assistant text can be missing until the run completes. This task extends the server snapshot mechanism to include in-memory inflight state and updates the client refresh to merge it, so tab switching or reconnects show partial assistant content immediately.

#### Documentation Locations

- Express response shaping (server): https://expressjs.com/en/api.html#res.json
- WebSocket vs REST snapshot semantics (project): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Jest test patterns (server + client): Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Add a server test for inflight-aware turns snapshot:
   - Files to read:
     - `server/src/routes/conversations.ts`
     - `server/src/chat/inflightRegistry.ts`
   - Files to edit:
     - `server/src/test/integration/conversations.turns.test.ts` (or new test file)
   - Test requirements:
     - Create an inflight run, append assistant/tool deltas in memory.
     - Call the turns endpoint with the new snapshot behavior (e.g., `includeInflight=true`).
     - Assert the response includes an `inflight` block with `assistantText`, `assistantThink`, `toolEvents`, and `inflightId`.
   - Reference snippets (repeat from story):
     - Inflight snapshot source: `snapshotInflight(conversationId)` in `server/src/chat/inflightRegistry.ts`.
     - Suggested response shape:
       ```json
       {
         "items": [/* persisted turns */],
         "nextCursor": null,
         "inflight": {
           "inflightId": "i1",
           "assistantText": "partial...",
           "assistantThink": "thinking...",
           "toolEvents": [],
           "startedAt": "2025-12-29T18:00:00.000Z",
           "seq": 3
         }
       }
       ```
   - Test scaffolding hints:
     - `server/src/test/integration/conversations.turns.test.ts` already mocks turns; extend to call the route with `includeInflight=true`.
   - Docs (repeat):
     - https://expressjs.com/en/api.html#res.json
     - Context7 `/jestjs/jest`

2. [x] Extend the turns snapshot response to include inflight state:
   - Files to edit:
     - `server/src/routes/conversations.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/routes/conversations.ts` (zod validation for any new query param)
   - Requirements:
     - Decide and implement the response shape (e.g., `GET /conversations/:id/turns?includeInflight=true` adds an `inflight` field).
     - Ensure the inflight data is only added when a run is active for the conversation.
     - Keep existing response shape stable for callers that do not request inflight data.
   - Reference snippets (repeat):
     - Existing turns route: `server/src/routes/conversations.ts` → `router.get('/conversations/:id/turns', ...)`.
     - Inflight snapshot source: `snapshotInflight` in `server/src/chat/inflightRegistry.ts`.
     - Guard: if `snapshotInflight` returns `null`, do **not** include `inflight` in the response.
   - Docs (repeat):
     - https://expressjs.com/en/api.html#res.json

3. [x] Update the client refresh to request and merge inflight state:
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Request the inflight-aware snapshot on refresh/focus/reconnect.
     - Merge inflight assistant/tool state with the existing in-flight transcript without duplicating bubbles.
     - Preserve existing dedupe behavior for persisted turns.
   - Reference snippets (repeat):
     - Turns request should include query when inflight needed:
       - `GET /conversations/:id/turns?includeInflight=true&limit=...`
     - Merge entry point: `client/src/hooks/useChatStream.ts` (hydration merge + inflight reconciliation).
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - Context7 `/jestjs/jest`

4. [x] Update/extend tests to assert inflight snapshot merge:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or new `client/src/test/useConversationTurns.inflightSnapshot.test.tsx`)
   - Requirements:
     - Simulate a refresh response that includes inflight partial content.
     - Assert the UI shows the partial assistant text immediately and continues streaming without resets.
   - Test scaffolding hints (repeat):
     - Client tests can mock the turns response with an `inflight` block and assert the first render includes it.
   - Docs (repeat):
     - Context7 `/jestjs/jest`

5. [x] Documentation update (if the snapshot response shape changes):
   - Files to edit:
     - `design.md`
     - `openapi.json` (if the REST response shape changes)
   - Requirements:
     - Document the inflight snapshot response and when it is returned.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Reference snippet (repeat):
     - REST response with optional `inflight` block (see subtask 1).
   - Docs (repeat):
     - https://www.markdownguide.org/basic-syntax/

6. [x] Run lint/format for server + client after code/test changes:
   - Commands to run:
     - `npm run lint --workspace server`
     - `npm run lint --workspace client`
     - `npm run format:check --workspace server`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Start a Codex or LM Studio run and wait for streaming to begin.
   - Reload the page or switch tabs mid-stream to trigger a snapshot refresh.
   - Confirm the partial assistant text/tool progress appears immediately (no empty transcript), and streaming continues.
   - Regression: no duplicate bubbles after hydration.
   - Capture screenshots for the plan archive showing the mid-stream refresh and final completion.

9. [x] `npm run compose:down`

#### Implementation notes

- Server: `GET /conversations/:id/turns` now accepts `includeInflight=true` and returns an optional `inflight` snapshot when a run is active.
- Server tests: added an integration test that creates an in-memory inflight state and asserts it is surfaced via the turns endpoint.
- Client: `useConversationTurns` requests `includeInflight=true` on replace refreshes and exposes the returned snapshot.
- Client: `useChatStream` adds `hydrateInflightSnapshot(...)`, and `ChatPage` wires the inflight snapshot into hydration so a mid-stream refresh shows partial text immediately.
- Client tests: added a focused Jest test verifying inflight snapshot hydration and continued WS streaming updates.
- Docs: updated `design.md`; `openapi.json` remains a stub in this repo.
- Testing: `npm run build --workspace server` passed.
- Testing: `npm run build --workspace client` passed.
- Testing: `npm run test --workspace server` passed.
- Testing: `npm run test --workspace client` passed.
- Testing: `npm run e2e` passed.
- Testing: `npm run compose:build` passed.
- Testing: `npm run compose:up` started successfully (containers healthy).
- Testing: `npm run build --workspace client` passed.
- Testing: `npm run test --workspace server` passed.
- Testing: `npm run test --workspace client` passed.
- Testing: `npm run e2e` passed.
- Testing: `npm run compose:build` passed.
- Testing: `npm run compose:up` started successfully (containers healthy).
- Manual check: ran `E2E_BASE_URL=http://host.docker.internal:5001 E2E_API_URL=http://host.docker.internal:5010 E2E_USE_MOCK_CHAT=true npx playwright test e2e/chat-inflight-refresh.spec.ts` and captured `test-results/screenshots/0000019-17-midstream-refresh.png` and `test-results/screenshots/0000019-17-final.png`.
- Testing: `npm run compose:down` completed.

---

### 18. Stream user turns over WS at run start (dedupe on sender tab)

- Task Status: **__done__**
- Git Commits: **b943664**

#### Overview

Tabs that did not submit a prompt do not see the user’s message until persistence or a refresh. This task streams the user turn over WebSocket at run start so all tabs render the user bubble immediately, relying on the existing dedupe logic to avoid duplicates in the originating tab.

#### Documentation Locations

- WebSocket messaging (server/client): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Express request lifecycle (server): https://expressjs.com/en/api.html
- Jest test patterns (server + client): Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Add server test coverage for user-turn WS streaming:
   - Files to read:
     - `server/src/routes/chat.ts`
     - `server/src/ws/server.ts`
     - `server/src/ws/types.ts`
   - Files to edit:
     - `server/src/test/unit/ws-chat-stream.test.ts` (or a new focused test)
   - Test requirements:
     - Start a run via `POST /chat`.
     - Assert the WS stream emits a `user_turn` (or equivalent) event with the user content before assistant deltas.
     - Ensure the event includes `conversationId` and any relevant `inflightId`.
   - Reference snippets (repeat from story):
     - Proposed WS event:
       ```json
       { "type": "user_turn", "conversationId": "c1", "inflightId": "i1", "content": "Hello", "createdAt": "2025-12-29T18:00:00.000Z" }
       ```
   - Test scaffolding hints:
     - Server WS tests use `connectWs`, `sendJson`, `waitForEvent` from `server/src/test/support/wsClient.ts`.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://expressjs.com/en/api.html
     - Context7 `/jestjs/jest`

2. [x] Add a WS event type for user turns and emit at run start:
   - Files to edit:
     - `server/src/ws/types.ts`
     - `server/src/ws/server.ts`
     - `server/src/routes/chat.ts` (or the stream bridge used at run start)
   - Requirements:
     - Define a new transcript event type (e.g., `user_turn`) containing the user message content + timestamp.
     - Emit the event immediately after `POST /chat` is accepted and the inflight run is created.
     - Do not wait for persistence to send the user turn.
   - Reference snippets (repeat):
     - WS event union lives in `server/src/ws/types.ts`; add a `WsUserTurnEvent`.
     - Emit from `server/src/routes/chat.ts` after `createInflight(...)` or in `chatStreamBridge` run-start path.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://expressjs.com/en/api.html

3. [x] Handle `user_turn` events in the client stream + dedupe:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Render the user bubble when the WS `user_turn` arrives.
     - Ensure sender tab dedupes the WS user turn against its optimistic bubble.
     - Do not regress the existing hydration dedupe behavior.
   - Reference snippets (repeat):
     - Client WS event union lives in `client/src/hooks/useChatWs.ts` (add `user_turn` to `WsServerEvent`).
     - Merge/dedupe logic lives in `client/src/hooks/useChatStream.ts` (reuse the same heuristic used for hydration).
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - https://react.dev/learn

4. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
   - Requirements:
     - Simulate a WS `user_turn` event after a local optimistic user bubble.
     - Assert only one user bubble remains after dedupe.
     - Simulate a non-originating tab receiving the `user_turn` and assert the bubble appears.
   - Test scaffolding hints (repeat):
     - Use `installMockWebSocket()` and `MockWebSocket._receive()` from `client/src/test/support/mockWebSocket.ts`.
   - Docs (repeat):
     - Context7 `/jestjs/jest`

5. [x] Documentation update (if the WS protocol changes):
   - Files to edit:
     - `design.md`
     - `openapi.json` (if the WS protocol is documented there)
   - Requirements:
     - Document the new `user_turn` WS event and its fields.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Reference snippet (repeat):
     - `user_turn` event shape shown in subtask 1.
   - Docs (repeat):
     - https://www.markdownguide.org/basic-syntax/

6. [x] Run lint/format for server + client after code/test changes:
   - Commands to run:
     - `npm run lint --workspace server`
     - `npm run lint --workspace client`
     - `npm run format:check --workspace server`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Open two browser tabs on the same conversation.
   - Send a user prompt in Tab A and confirm the user bubble appears in Tab B immediately (no refresh).
   - Confirm Tab A shows only one user bubble (no duplicates).
   - Regression: assistant streaming still renders without refresh.
   - Capture screenshots in `test-results/screenshots/` for the plan archive.

9. [x] `npm run compose:down`

#### Implementation notes

- Server: introduced `user_turn` transcript events (`server/src/ws/types.ts`) and now broadcasts them from `POST /chat` immediately after `createInflight(...)` (`server/src/routes/chat.ts`).
- Server tests: extended `server/src/test/unit/ws-chat-stream.test.ts` to assert the `user_turn` event arrives before the first `assistant_delta`.
- Client: added `user_turn` to the WS protocol union (`client/src/hooks/useChatWs.ts`), routes it from `ChatPage` to `useChatStream`, and inserts/dedupes the user bubble against the sender tab’s optimistic message (`client/src/hooks/useChatStream.ts`).
- Client tests: extended `client/src/test/chatPage.stream.test.tsx` + `client/src/test/support/mockChatWs.ts` to cover sender-tab dedupe and non-originating tab bubble insertion.
- Docs: documented the new `user_turn` event in `design.md` (no `openapi.json` changes required).
- Lint/format: ran `npm run lint --workspace server`, `npm run lint --workspace client`, `npm run format:check --workspace server`, and `npm run format:check --workspace client`.
- Testing: `npm run build --workspace server` passed.
- Testing: `npm run build --workspace client` passed.
- Testing: `npm run test --workspace server` passed.
- Testing: `npm run test --workspace client` passed.
- Testing: `npm run e2e` passed.
- Testing: `npm run compose:build` passed.
- Testing: `npm run compose:up` started successfully (containers healthy).
- Manual check: ran `E2E_BASE_URL=http://host.docker.internal:5001 E2E_USE_MOCK_CHAT=true npx playwright test e2e/chat-user-turn-ws.spec.ts` and captured `test-results/screenshots/0000019-18-tab-a.png` and `test-results/screenshots/0000019-18-tab-b.png`.
- Testing: `npm run compose:down` completed.

---

### 19. Prevent transcript width expansion (wrap citations/tool/markdown content)

- Task Status: **__done__**
- Git Commits: **921ae0b, 1c9530d**

#### Overview

The chat transcript can expand horizontally when citations, tool details, or code blocks contain long unbroken strings. This task ensures citation content (and other long transcript content) wraps within the available chat column width and does not resize the layout.

#### Documentation Locations

- MUI Box/Stack layout props: https://mui.com/material-ui/react-box/
- CSS overflow/wrapping guidelines: https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
- React effect cleanup (if needed): https://react.dev/learn/synchronizing-with-effects
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Reproduce width expansion in a client test:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/components/Markdown.tsx`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or new `client/src/test/chatPage.layoutWrap.test.tsx`)
   - Test requirements:
     - Render an assistant message with expanded citations containing a very long path/token (no spaces).
     - Assert the transcript container does not exceed its parent width (use `getBoundingClientRect()` / `scrollWidth`).
   - Reference snippet (repeat):
     - `overflowWrap: 'anywhere'` or `wordBreak: 'break-word'` applied on the citation content container.
   - Reference snippets (repeat):
     - Layout assertion example:
       ```ts
       const transcript = screen.getByTestId('chat-transcript');
       expect(transcript.scrollWidth).toBeLessThanOrEqual(transcript.clientWidth);
       ```
     - Example long-token content: `'a'.repeat(400)` used in a citation path or chunk.
   - Code anchors (where to look first):
     - Citations: `client/src/pages/ChatPage.tsx` (`data-testid="citation-path"` / `data-testid="citation-chunk"`).
     - Transcript container: `client/src/pages/ChatPage.tsx` (`data-testid="chat-transcript"`).
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
     - https://mui.com/material-ui/react-box/
     - Context7 `/jestjs/jest`

2. [x] Apply wrapping + min-width fixes to transcript layout:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/components/Markdown.tsx`
   - Requirements:
     - Ensure the chat column flex child has `minWidth: 0`.
     - Ensure citation chunks + tool payloads + markdown code blocks wrap or scroll within their container.
     - Avoid changing sidebar width; only constrain the transcript area.
   - Reference snippet (repeat):
     - `sx={{ minWidth: 0 }}` on the chat column Box.
   - Reference snippets (repeat):
     - Citation chunk wrapping:
       ```ts
       sx={{ overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
       ```
     - Tool payload wrapping:
       ```ts
       sx={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
       ```
   - Code anchors (where to look first):
     - Chat column container: `client/src/pages/ChatPage.tsx` (the `Box sx={{ flex: 1 }}` wrapping transcript).
     - Tool payload text: `client/src/pages/ChatPage.tsx` (`data-testid="tool-payload"`).
     - Markdown `pre` blocks: `client/src/components/Markdown.tsx`.
   - Docs (repeat):
     - https://mui.com/material-ui/react-box/
     - https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap

3. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or new layout test)
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Assert long citation content wraps without expanding the layout.
   - Reference snippet (repeat):
     - Use `scrollWidth`/`clientWidth` on `data-testid="chat-transcript"` to assert no horizontal expansion.
   - Docs (repeat):
     - Context7 `/jestjs/jest`
     - https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
 
4. [x] Add corner-case wrap tests for tool payloads + markdown code blocks:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/components/Markdown.tsx`
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx` (or extend existing layout test)
   - Test requirements:
     - Render a tool payload with a very long JSON key/value (no spaces) and assert it does not force horizontal expansion.
     - Render a markdown code block with a long unbroken token and assert it scrolls/wraps within the bubble.
   - Reference snippets (repeat):
     - Tool payload selector: `data-testid="tool-payload"`.
     - Markdown code block selector: `data-testid="assistant-markdown"` and `pre` element.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
     - https://mui.com/material-ui/react-box/
     - Context7 `/jestjs/jest`

5. [x] Documentation update (if layout behavior changes are user-visible):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that transcript content now wraps to avoid horizontal expansion.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Reference snippet (repeat):
     - Mention `minWidth: 0` on the chat column and `overflowWrap: anywhere` on citation content.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
     - https://mui.com/material-ui/react-box/

6. [x] Run lint/format for client after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Open a conversation with citations; expand citations.
   - Confirm the chat column does not resize horizontally.
   - Regression: tool details + markdown code blocks wrap/scroll within the chat bubble.
   - Capture a screenshot showing wrapped citation content.

9. [x] `npm run compose:down`

#### Implementation notes

- Added failing regression coverage in `client/src/test/chatPage.layoutWrap.test.tsx` that simulates horizontal overflow when citation/tool/markdown elements lack wrapping/containment styles.
- Confirmed the failure mode in Jest: `chatPage.layoutWrap.test.tsx` currently fails with `scrollWidth` > `clientWidth` (synthetic width mock), proving the issue is reproducible in tests before the CSS/layout fix.
- Updated `client/src/pages/ChatPage.tsx` to set `minWidth: 0` on the chat column flex item, prevent horizontal overflow on the transcript container, and force citation/tool payload text to break long tokens (`overflowWrap: 'anywhere'`, `wordBreak: 'break-word'`).
- Updated `client/src/components/Markdown.tsx` to be flex-safe (`minWidth: 0`) and to constrain wide markdown constructs (code blocks already scroll with `overflowX: auto`; tables/images now cap to `maxWidth: 100%`).
- Updated `design.md` to document the transcript overflow guardrails (minWidth fix + wrap/scroll behavior) as a stable UI guarantee.
- Verified `npm run lint --workspace client` and `npm run format:check --workspace client` pass (used Prettier write to fix formatting in `client/src/test/chatPage.layoutWrap.test.tsx`).
- Testing progress: Playwright-driven manual check against `http://host.docker.internal:5001/chat` passed (no horizontal overflow after expanding citations/tool details) and saved screenshot to `test-results/screenshots/0000019-19-wrapped-citation.png`.
- Testing progress: `npm run compose:down` passed.

---

### 20. Align chat layout: fixed sidebar + full-width transcript column

- Task Status: **__completed__**
- Git Commits: **a97e89c**

#### Overview

Ensure the Conversations sidebar remains fixed on the left, and the chat transcript column always fills the remaining browser width with proper wrapping of content within it.

#### Documentation Locations

- MUI layout primitives (Box/Stack/Grid): https://mui.com/material-ui/react-box/
- CSS flexbox sizing (min-width/overflow): https://developer.mozilla.org/en-US/docs/Web/CSS/flex
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Validate current layout constraints in a client test:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx` (or extend existing layout test)
   - Test requirements:
     - Assert the sidebar width remains fixed (md: 320px).
     - Assert the transcript column uses the remaining width and does not overflow the viewport.
   - Reference snippets (repeat):
     - Sidebar width check:
       ```ts
       const sidebar = screen.getByTestId('conversation-list');
       expect(sidebar.getBoundingClientRect().width).toBeCloseTo(320, 0);
       ```
     - Transcript width check:
       ```ts
       const transcript = screen.getByTestId('chat-transcript');
       expect(transcript.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
       ```
   - Code anchors (where to look first):
     - Sidebar wrapper `Box` in `client/src/pages/ChatPage.tsx` (width `{ xs: '100%', md: 320 }`).
     - Transcript wrapper `Box` in `client/src/pages/ChatPage.tsx` (`data-testid="chat-transcript"`).
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex
     - https://mui.com/material-ui/react-box/
     - Context7 `/jestjs/jest`

2. [x] Add responsive layout tests (xs column + md row):
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx`
   - Test requirements:
     - Simulate a small viewport (`xs`) and assert sidebar + transcript stack vertically (no horizontal overflow).
     - Simulate a medium viewport (`md`) and assert sidebar sits left with fixed width and transcript fills the rest.
   - Reference snippets (repeat):
     - Resize helper:
       ```ts
       window.innerWidth = 375;
       window.dispatchEvent(new Event('resize'));
       ```
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex
     - https://mui.com/material-ui/react-box/
     - Context7 `/jestjs/jest`

3. [x] Update the chat layout containers to enforce left sidebar + fluid content:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Ensure the sidebar box has a fixed width and does not grow.
     - Ensure the chat column is `flex: 1` with `minWidth: 0` and `width: 100%`.
     - Avoid unintended horizontal scroll on the root container.
   - Reference snippets (repeat):
     - Sidebar:
       ```ts
       sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0 }}
       ```
     - Chat column:
       ```ts
       sx={{ flex: 1, minWidth: 0, width: '100%' }}
       ```
   - Code anchors (where to look first):
     - Layout `Stack` wrapping sidebar + chat in `client/src/pages/ChatPage.tsx`.
   - Docs (repeat):
     - https://mui.com/material-ui/react-box/
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex

4. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx`
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Verify sidebar remains on the left with constant width while transcript fills remaining space.
   - Reference snippets (repeat):
     - Assert the chat column grows by checking `flex` sizing via `getBoundingClientRect()`.
   - Docs (repeat):
     - Context7 `/jestjs/jest`
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex

5. [x] Documentation update (if layout behavior changes are user-visible):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that the chat layout enforces a fixed-width sidebar and fluid transcript column.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Reference snippet (repeat):
     - Mention fixed 320px sidebar + `flex: 1` chat column with `minWidth: 0`.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex
     - https://mui.com/material-ui/react-box/

6. [x] Run lint/format for client after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Resize the browser window and verify the sidebar stays fixed on the left.
   - Confirm the transcript column fills the remaining width and wraps long content.
   - Capture a screenshot demonstrating the fixed sidebar + fluid chat area.

9. [x] `npm run compose:down`

#### Implementation notes

- Added initial layout alignment regression tests in `client/src/test/chatPage.layoutWrap.test.tsx` for md fixed sidebar width + transcript viewport containment (expected to fail until the chat layout containers are updated).
- Added a small-viewport (`xs`) coverage in the same test file to assert the sidebar + transcript stack vertically without horizontal overflow.
- Updated `client/src/pages/ChatPage.tsx` layout containers: added a sidebar wrapper `data-testid="conversation-list"` with fixed sizing, ensured the chat column is `flex: 1` with `minWidth: 0` and `width: 100%` (inline styles for deterministic tests), and set `overflowX: hidden` on the root layout stack.
- Confirmed the new layout alignment tests fail without the `conversation-list` wrapper + chat column inline sizing and pass once the container updates are in place.
- Updated `design.md` with an explicit guarantee about the fixed 320px sidebar (md+) and fluid transcript column layout.
- Verified `npm run lint --workspace client` passes.
- Verified `npm run format:check --workspace client` passes.
- Testing progress: `npm run build --workspace server` passed.
- Testing progress: `npm run build --workspace client` passed.
- Testing progress: `npm run test --workspace server` passed.
- Testing progress: `npm run test --workspace client` passed.
- Testing progress: `npm run e2e` passed.
- Testing progress: `npm run compose:build` passed.
- Testing progress: `npm run compose:up` passed.
- Testing progress: Playwright-driven manual check against `http://host.docker.internal:5001/chat` captured screenshots at `test-results/screenshots/0000019-20-chat-layout-md.png` and `test-results/screenshots/0000019-20-chat-layout-xs.png` (md sidebar width measured at 320px).
- Testing progress: `npm run compose:down` passed.

---

### 21. Make transcript fill remaining viewport height beneath controls

- Task Status: **__completed__**
- Git Commits: **1d7b857**

#### Overview

Ensure the chat transcript area expands to fill the remaining vertical space beneath the Chat page controls (provider/model selectors, flags, input box), so the transcript always uses the available viewport height without manual resizing.

#### Documentation Locations

- CSS flexbox sizing (height, min-height): https://developer.mozilla.org/en-US/docs/Web/CSS/flex
- MUI layout primitives (Box/Stack): https://mui.com/material-ui/react-box/
- React effect cleanup (if measuring): https://react.dev/learn/synchronizing-with-effects
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Add a layout test for transcript height fill:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx` (or new `client/src/test/chatPage.layoutHeight.test.tsx`)
   - Test requirements:
     - Simulate a viewport height and assert the transcript container height fills the remaining space below the controls.
     - Ensure the transcript container grows when viewport height increases.
   - Reference snippets (repeat):
     - `sx={{ minHeight: 0 }}` on flex containers to allow child growth.
   - Code anchors (where to look first):
     - Root ChatPage container and transcript panel in `client/src/pages/ChatPage.tsx`.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex
     - https://mui.com/material-ui/react-box/
     - Context7 `/jestjs/jest`

2. [x] Update ChatPage layout to allow vertical fill:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Ensure the page uses a full-height flex column (e.g., `minHeight: '100vh'` on the root container).
     - Ensure the transcript panel is a flex child with `flex: 1` and `minHeight: 0` so it expands vertically.
     - Do not shrink the input controls; the transcript should take remaining space.
   - Reference snippets (repeat):
     - `sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}`
     - `sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}`
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex
     - https://mui.com/material-ui/react-box/

3. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx` (or new height test)
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Verify transcript grows to consume remaining height beneath controls.
   - Reference snippets (repeat):
     - Height assertion example:
       ```ts
       const transcript = screen.getByTestId('chat-transcript');
       expect(transcript.getBoundingClientRect().height).toBeGreaterThan(0);
       ```
   - Code anchors (where to look first):
     - Transcript wrapper: `client/src/pages/ChatPage.tsx` (`data-testid="chat-transcript"`).
   - Docs (repeat):
     - Context7 `/jestjs/jest`
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex

4. [x] Add corner-case height tests (small viewport + tall controls):
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx` (or height test)
   - Test requirements:
     - Simulate a short viewport height and ensure transcript still renders with `minHeight: 0` and `overflowY: auto`.
     - Simulate a state where the Codex flags panel is expanded (taller controls) and assert transcript still takes remaining space (no negative height).
   - Reference snippets (repeat):
     - `sx={{ minHeight: 0, overflowY: 'auto' }}` on the transcript container.
   - Code anchors (where to look first):
     - Controls stack + flags panel region in `client/src/pages/ChatPage.tsx` (before the transcript `Paper`).
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex
     - Context7 `/jestjs/jest`

5. [x] Documentation update (if height behavior changes are user-visible):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that the transcript fills remaining viewport height below the controls.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/CSS/flex

7. [x] Run lint/format for client after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Resize the viewport height and confirm the transcript grows/shrinks accordingly.
   - Ensure input controls remain visible and fixed while transcript height changes.
   - Capture a screenshot showing the transcript filling the remaining height.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-30: Marked task as in progress; starting with layout tests then flex-height refactor.
- 2025-12-30: Added failing-first Jest layout test scaffold in `client/src/test/chatPage.layoutHeight.test.tsx` (expects a `chat-controls` wrapper + flex sizing).
- 2025-12-30: Refactored `client/src/App.tsx` + `client/src/pages/ChatPage.tsx` to be full-height flex columns and made the transcript Paper/scroll container `flex: 1` with `minHeight: 0` (removed fixed `maxHeight: 640`).
- 2025-12-30: Extended the new height test to assert exact remaining-height math (mocked) and verify the transcript grows with viewport height.
- 2025-12-30: Added corner-case test ensuring transcript height never goes negative when Codex flags panel is present (tall controls + small viewport).
- 2025-12-30: Updated `design.md` Chat page streaming UI section to note the transcript fills remaining viewport height and scrolls within the panel.
- 2025-12-30: Ran `npm run format --workspace client`, `npm run format:check --workspace client`, and `npm run lint --workspace client` to confirm formatting/lint are clean after the flex layout changes.
- 2025-12-30: Testing step 1 passed: `npm run build --workspace server`.
- 2025-12-30: Testing step 2 passed: `npm run build --workspace client` (Vite build succeeded).
- 2025-12-30: Testing step 3 passed: `npm run test --workspace server` (44 scenarios / 214 steps passed; longer runtime ~5min).
- 2025-12-30: Testing step 4 passed: `npm run test --workspace client` (67 suites / 131 tests passed).
- 2025-12-30: Testing step 5 passed: `npm run e2e` (30 Playwright specs passed).
- 2025-12-30: Testing step 6 passed: `npm run compose:build`.
- 2025-12-30: Testing step 7 passed: `npm run compose:up` (containers started healthy).
- 2025-12-30: Manual check: used Playwright against `http://host.docker.internal:5001/chat` to verify transcript height increases when viewport grows; saved `test-results/screenshots/0000019-21-transcript-fill-viewport.png`.
- 2025-12-30: Gotcha: initial flex refactor used `minHeight: 100vh`; manual check showed transcript height did not respond to viewport changes because the app shell could still expand with content. Fixed by constraining `client/src/App.tsx` to `height: 100vh` and making the main container scrollable (`overflow: auto`), then rebuilt/recreated Compose containers.
- 2025-12-30: Testing step 9 passed: `npm run compose:down`.
- 2025-12-30: Post-fix validation: reran `npm run test --workspace client` + `npm run format:check --workspace client` after the `height: 100vh` app-shell adjustment.

---

### 22. Remove Codex MCP info banner from Chat page

- Task Status: **__completed__**
- Git Commits: **d926e7d**

#### Overview

The Chat page currently shows an informational banner: “Codex chats are enabled with MCP tools. Threads reuse returned thread IDs so conversations can continue across turns.” This banner is no longer needed and should be removed.

#### Documentation Locations

- MUI Alert component: https://mui.com/material-ui/react-alert/
- React component updates (conditional rendering): https://react.dev/learn/conditional-rendering
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Add a test covering the removal of the banner:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or new `client/src/test/chatPage.banners.test.tsx`)
   - Test requirements:
     - Assert that `data-testid="codex-ready-banner"` is not rendered.
     - Ensure other Codex banners (unavailable/tools missing) still render when applicable.
   - Reference snippets (repeat):
     - Banner selector: `data-testid="codex-ready-banner"`.
     - Other banners: `data-testid="codex-unavailable-banner"` / `data-testid="codex-tools-banner"`.
   - Docs (repeat):
     - https://react.dev/learn/conditional-rendering
     - Context7 `/jestjs/jest`

2. [x] Remove the banner UI from ChatPage:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Remove the Codex “ready” banner block (`data-testid="codex-ready-banner"`).
     - Keep other Codex warnings intact.
   - Code anchors (where to look first):
     - `client/src/pages/ChatPage.tsx` near the Codex banners block (info/warning alerts above the form).
   - Docs (repeat):
     - https://mui.com/material-ui/react-alert/
     - https://react.dev/learn/conditional-rendering

3. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx` (or banner test)
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Confirm absence of the ready banner without impacting other banners.
   - Reference snippets (repeat):
     - `expect(screen.queryByTestId('codex-ready-banner')).toBeNull();`
   - Docs (repeat):
     - Context7 `/jestjs/jest`

4. [x] Documentation update (if banner changes are user-visible):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that the Codex “ready” banner has been removed.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Docs (repeat):
     - https://mui.com/material-ui/react-alert/

5. [x] Run lint/format for client after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Load the Chat page with Codex selected.
   - Confirm the “Codex chats are enabled…” banner is no longer visible.
   - Ensure other banners (unavailable/tools missing) still appear when triggered.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-30: Marked task as in progress; starting with a failing-first Jest/RTL coverage for the Codex banners.
- 2025-12-30: Added failing-first test coverage in `client/src/test/chatPage.codexBanners.test.tsx` asserting `data-testid="codex-ready-banner"` is absent when Codex is available (confirmed failing before UI removal).
- 2025-12-30: Removed the Codex "ready" info banner from `client/src/pages/ChatPage.tsx` (also removed now-unused `showCodexReady`), then reran the new focused test (`npm run test --workspace client -- chatPage.codexBanners`) to confirm it now passes.
- 2025-12-30: Updated `design.md` Chat page section to clarify that only warning banners remain for Codex (unavailable / tools missing), with no separate "ready" info banner.
- 2025-12-30: Ran `npm run lint --workspace client`; ran `npm run format:check --workspace client` (fixed the one new file via `npm run format --workspace client`).
- 2025-12-30: Testing step 1 passed: `npm run build --workspace server`.
- 2025-12-30: Testing step 2 passed: `npm run build --workspace client`.
- 2025-12-30: Testing step 3 passed: `npm run test --workspace server`.
- 2025-12-30: Testing step 4 passed: `npm run test --workspace client`.
- 2025-12-30: Fixed e2e Codex tests that became flaky in smaller viewports by collapsing the Codex flags panel before clicking transcript controls; reran `npm run e2e` and confirmed all 30 specs pass.
- 2025-12-30: Testing step 5 passed: `npm run e2e`.
- 2025-12-30: Testing step 6 passed: `npm run compose:build`.
- 2025-12-30: Testing step 7 passed: `npm run compose:up`.
- 2025-12-30: Manual check: launched Playwright against `http://host.docker.internal:5001/chat` to confirm `data-testid="codex-ready-banner"` is no longer rendered (even when selecting Codex when available). Saved screenshot `test-results/screenshots/0000019-22-no-codex-ready-banner.png`.
- 2025-12-30: Testing step 9 passed: `npm run compose:down`.

---

### 23. Default Codex Flags panel to collapsed

- Task Status: **__completed__**
- Git Commits: **442ad34**

#### Overview

The Codex Flags expandable panel currently defaults to expanded on the Chat page. It should default to collapsed, allowing users to expand it only when they need advanced settings.

#### Documentation Locations

- MUI Accordion component: https://mui.com/material-ui/react-accordion/
- React component state (controlled vs uncontrolled): https://react.dev/learn
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Locate Codex Flags panel implementation and current default:
   - Files to read:
     - `client/src/components/chat/CodexFlagsPanel.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx` (if it shares the panel or similar pattern)
   - Requirements:
     - Identify whether the panel uses MUI `Accordion` with `defaultExpanded` or a controlled `expanded` prop.
     - Confirm where initial expansion state is set (component-local vs parent).
   - Docs (repeat):
     - https://mui.com/material-ui/react-accordion/
     - https://react.dev/learn

2. [x] Add tests that assert the panel is collapsed by default:
   - Files to read:
     - `client/src/test/chatPage.flags.test.tsx` (existing Codex flags coverage)
     - `client/src/test/chatPage.stream.test.tsx`
   - Files to edit:
     - `client/src/test/chatPage.flags.test.tsx` (preferred)
     - or new `client/src/test/chatPage.flagsPanel.test.tsx`
   - Test requirements:
     - Render ChatPage with Codex provider selected.
     - Assert the Codex Flags accordion content is not visible by default.
     - Assert that expanding the accordion reveals the flags controls.
   - Reference snippets (repeat):
     - MUI Accordion content selector: `aria-expanded` on the summary toggle.
   - Code anchors (where to look first):
     - `client/src/components/chat/CodexFlagsPanel.tsx` (Accordion summary toggle).
     - `client/src/pages/ChatPage.tsx` (where the panel is rendered).
   - Docs (repeat):
     - https://mui.com/material-ui/react-accordion/
     - Context7 `/jestjs/jest`

3. [x] Update the panel to default collapsed:
   - Files to edit:
     - `client/src/components/chat/CodexFlagsPanel.tsx`
     - `client/src/pages/ChatPage.tsx` (if state is lifted)
   - Requirements:
     - If uncontrolled, set `defaultExpanded={false}`.
     - If controlled, initialize state to `false` and wire `expanded` prop accordingly.
     - Ensure existing flag selections still render once the panel is expanded.
   - Reference snippets (repeat):
     - Controlled pattern:
       ```tsx
       const [expanded, setExpanded] = useState(false);
       <Accordion expanded={expanded} onChange={(_, next) => setExpanded(next)} />
       ```
   - Docs (repeat):
     - https://mui.com/material-ui/react-accordion/
     - https://react.dev/learn

4. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.flags.test.tsx` (or new test file)
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Confirm the panel is collapsed by default and expands on click.
   - Reference snippets (repeat):
     - `expect(screen.getByRole('button', { name: /codex flags/i })).toHaveAttribute('aria-expanded', 'false')`
   - Docs (repeat):
     - Context7 `/jestjs/jest`

5. [x] Add corner-case tests for provider switching:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/test/chatPage.flags.test.tsx`
   - Test requirements:
     - Switch from Codex to another provider and back.
     - Assert the Codex Flags panel reverts to collapsed by default after switching back.
   - Reference snippets (repeat):
     - Use provider select: `data-testid="provider-select"` and trigger change to non-Codex option.
   - Docs (repeat):
     - https://react.dev/learn/conditional-rendering
     - Context7 `/jestjs/jest`


6. [x] Documentation update (if behavior change is user-visible):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that Codex Flags panel defaults to collapsed.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Docs (repeat):
     - https://mui.com/material-ui/react-accordion/

7. [x] Run lint/format for client after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Load the Chat page with Codex selected.
   - Confirm the Codex Flags panel is collapsed by default.
   - Expand it and verify all controls are still available.

9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-30: Marked task as in progress; starting by locating the panel implementation and updating Jest/RTL coverage to assert collapsed-by-default behavior.
- 2025-12-30: Located `client/src/components/chat/CodexFlagsPanel.tsx` and confirmed it uses an uncontrolled MUI `Accordion` with `defaultExpanded` (so it currently renders expanded by default).
- 2025-12-30: Added Jest/RTL coverage in `client/src/test/chatPage.flags.panelCollapsed.test.tsx` asserting the Codex Flags accordion starts collapsed and expands to reveal controls (this test fails against the prior `defaultExpanded` behavior). Also added `client/src/test/support/ensureCodexFlagsPanelExpanded.ts` and wired existing Codex-flag tests to expand the panel before asserting defaults/payloads.
- 2025-12-30: Updated `client/src/components/chat/CodexFlagsPanel.tsx` to set `defaultExpanded={false}` so the Codex Flags accordion starts collapsed.
- 2025-12-30: Added provider-switch coverage in `client/src/test/chatPage.flags.panelCollapsed.test.tsx` to ensure switching away from Codex and back resets the panel to collapsed by default.
- 2025-12-30: Updated `design.md` Chat page section to explicitly note that the Codex Flags panel is collapsed by default.
- 2025-12-30: Ran `npm run lint --workspace client` and `npm run format:check --workspace client` after the Task 23 changes; both passed.
- 2025-12-30: Testing step 1 passed: `npm run build --workspace server`.
- 2025-12-30: Testing step 2 passed: `npm run build --workspace client`.
- 2025-12-30: Testing step 3 passed: `npm run test --workspace server` (44 scenarios passed).
- 2025-12-30: Testing step 4 passed: `npm run test --workspace client` (69 suites, 135 tests).
- 2025-12-30: Testing step 5 passed: `npm run e2e` (30 Playwright specs passed).
- 2025-12-30: Testing step 6 passed: `npm run compose:build`.
- 2025-12-30: Testing step 7 passed: `npm run compose:up`.
- 2025-12-30: Manual check: ran Playwright against `http://host.docker.internal:5001/chat` to confirm the Codex Flags panel starts collapsed (`aria-expanded="false"`) and expands to reveal controls. Saved screenshots `test-results/screenshots/0000019-23-codex-flags-collapsed.png` and `test-results/screenshots/0000019-23-codex-flags-expanded.png`.
- 2025-12-30: Testing step 9 passed: `npm run compose:down`.
- 2025-12-30: Marked task as completed.

---

### 24. Allow full-width layout by removing App container max width (gutters preserved)

- Task Status: **__done__**
- Git Commits: **b642971, 51db639**

#### Overview

The App shell currently wraps all routes in a MUI `Container` with `maxWidth="lg"`, which centers content and constrains the Chat page width. Update the App container to use `maxWidth={false}` while preserving gutters so the Conversations sidebar can sit flush on the left and the chat transcript fills the remaining horizontal space.

#### Documentation Locations

- MUI Container API (`maxWidth`, `disableGutters`): https://mui.com/material-ui/react-container/
- MUI Container API (full props list): https://mui.com/material-ui/api/container/
- Responsive UI guide (Container centers content by default): https://mui.com/material-ui/react-container/#main-content
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Add a failing-first test for full-width layout with gutters preserved:
   - Files to read:
     - `client/src/App.tsx`
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx` (or create `client/src/test/chatPage.fullWidth.test.tsx`)
   - Test requirements:
     - Render the Chat page and assert the root container does **not** apply a centered max-width constraint.
     - Assert that horizontal padding (gutters) remain in effect (e.g., compare container left padding > 0).
     - Ensure the conversation list is aligned to the left edge within the gutters and the chat column can expand to the remaining width.
     - Assert the App container still uses gutters on a non-chat route (e.g., `/` HomePage) to avoid global layout regressions.
   - Code anchors (where to look first):
     - App shell container: `client/src/App.tsx` (`<Container maxWidth="lg" ...>` today).
     - Chat layout wrapper: `client/src/pages/ChatPage.tsx` (`data-testid="conversation-list"`, `data-testid="chat-column"`).
   - Reference snippets (repeat):
     - `maxWidth={false}` keeps the container full-width.
     - `disableGutters={false}` keeps gutters (default).
   - Docs (repeat):
     - https://mui.com/material-ui/react-container/
     - https://mui.com/material-ui/api/container/
     - Context7 `/jestjs/jest`
   - Reference snippets (repeat):
     - `maxWidth={false}` keeps container full-width.
     - `disableGutters={false}` (default) keeps gutters.
   - Docs (repeat):
     - https://mui.com/material-ui/react-container/
     - https://mui.com/material-ui/api/container/
     - Context7 `/jestjs/jest`

2. [x] Update the App container to remove width constraint:
   - Files to edit:
     - `client/src/App.tsx`
   - Requirements:
     - Change `maxWidth="lg"` to `maxWidth={false}`.
     - Keep gutters enabled (`disableGutters` should remain `false`/unset).
     - Ensure existing vertical layout rules (`flex`, `minHeight`, `overflow`) remain intact.
   - Code anchors (where to look first):
     - `client/src/App.tsx` Container wrapping `<Outlet />`.
   - Reference snippets (repeat):
     - ` <Container maxWidth={false} sx={{ mt: 3, pb: 4, flex: 1, ... }}>`
   - Docs (repeat):
     - https://mui.com/material-ui/api/container/
   - Docs (repeat):
     - https://mui.com/material-ui/api/container/

3. [x] Update/extend tests to assert the fix:
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx` (or new full-width test)
   - Requirements:
     - Tests must fail before the fix and pass after.
     - Confirm the layout is no longer centered and gutters still apply.
   - Reference snippets (repeat):
     - `expect(container).toHaveStyle({ maxWidth: 'none' })` (or similar DOM measurement checks).
   - Code anchors (where to look first):
     - `data-testid="conversation-list"` and `data-testid="chat-column"` assertions.
   - Docs (repeat):
     - Context7 `/jestjs/jest`
   - Docs (repeat):
     - Context7 `/jestjs/jest`

4. [x] Add corner-case test for narrow viewports:
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx` (or new full-width test)
   - Test requirements:
     - Simulate a narrow viewport and confirm the conversation list still occupies full width on small screens.
     - Confirm gutters are still present (padding not zero).
     - Confirm the chat column does not overflow horizontally when long content is rendered (word-wrap stays within available width).
   - Code anchors (where to look first):
     - Chat column wrapper: `data-testid="chat-column"`.
   - Docs (repeat):
     - https://mui.com/material-ui/react-container/
     - Context7 `/jestjs/jest`
   - Docs (repeat):
     - https://mui.com/material-ui/react-container/
     - Context7 `/jestjs/jest`

5. [x] Documentation update (if width behavior changes are user-visible):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that the app shell container is full-width with gutters, so Chat page fills remaining horizontal space.
     - If no updates are needed, mark this subtask as “no changes required”.
   - Reference snippets (repeat):
     - “App shell Container uses `maxWidth={false}` with gutters preserved.”
   - Docs (repeat):
     - https://mui.com/material-ui/react-container/
   - Docs (repeat):
     - https://mui.com/material-ui/react-container/

6. [x] Run lint/format for client after code/test changes:
   - Commands to run:
     - `npm run lint --workspace client`
     - `npm run format:check --workspace client`
   - Docs (repeat):
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Load the Chat page and confirm the conversation list is aligned to the left within gutters.
   - Confirm the chat column expands to fill the remaining horizontal space.
   - Capture a screenshot showing full-width layout with gutters intact.

9. [x] `npm run compose:down`

#### Implementation notes

- Added a failing-first RTL/Jest assertion in `client/src/test/chatPage.layoutWrap.test.tsx` that the **App shell** container no longer applies `MuiContainer-maxWidthLg`, while gutters (padding) remain enabled.
- Added a companion Home route check in the same test file to ensure gutters remain enabled outside `/chat`.
- Updated `client/src/App.tsx` to change the shell `<Container>` from `maxWidth="lg"` to `maxWidth={false}` (gutters preserved via default `disableGutters={false}`).
- Verified the new layout assertions pass after the `maxWidth={false}` change by running `npm run test --workspace client -- chatPage.layoutWrap.test.tsx`.
- Extended `client/src/test/chatPage.layoutWrap.test.tsx` with an xs/narrow viewport case that asserts gutters remain non-zero and long tool payload content does not force horizontal overflow.
- Updated `design.md` to reflect that the App shell container is now full-width (`maxWidth={false}`) with gutters preserved.
- Ran `npm run lint --workspace client` and `npm run format:check --workspace client` (after applying Prettier write fix) to confirm the client workspace remains clean.
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server`.
- Testing: `npm run test --workspace client`.
- Testing: `npm run e2e` (30 passed).
- Testing: `npm run compose:build`.
- Testing: `npm run compose:up`.
- Manual check: captured `planning/0000019-screenshots/0000019-24-full-width-layout.png` from `http://host.docker.internal:5001/chat` (full-width container + gutters preserved).
- Testing: `npm run compose:down`.

---

### 25. Always merge inflight data into snapshots until persistence completes

- Task Status: **__done__**
- Git Commits: **8f0faa0**

#### Overview

Snapshot responses must always reflect the complete conversation. The server should keep inflight turn data in memory until persistence succeeds, and merge/dedupe that inflight data into the `/conversations/:id/turns` response (even after `turn_final`) so snapshot refreshes never drop recent assistant turns.

#### Documentation Locations

- Node.js event loop & async lifecycle: https://nodejs.org/en/docs
- Express response patterns: https://expressjs.com/en/guide/routing.html
- Mongoose write acknowledgements: https://mongoosejs.com/docs/api/model.html
- Jest patterns: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Locate inflight lifecycle and snapshot path:
   - Files to read:
     - `server/src/routes/conversations.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
     - `server/src/chat/memoryPersistence.ts`
   - Requirements:
     - Identify where inflight state is created, updated, and cleared.
     - Identify where snapshot inflight data is attached in `/conversations/:id/turns`.
   - Code anchors (where to look first):
     - `snapshotInflight(...)` usage in `server/src/routes/conversations.ts`.
     - inflight store in `server/src/chat/memoryPersistence.ts`.
   - Docs (repeat):
     - https://expressjs.com/en/guide/routing.html
     - https://mongoosejs.com/docs/api/model.html

2. [x] Update inflight lifecycle to persist until DB write completes:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
     - `server/src/chat/memoryPersistence.ts`
   - Requirements:
     - Do not clear inflight state at `turn_final`.
     - Only clear inflight state after both the user + assistant turns are confirmed persisted.
     - Ensure failures that prevent persistence keep inflight available for snapshot until resolved.
   - Code anchors (where to look first):
     - Turn persistence calls in `ChatInterface.ts` (append turn flow).
     - Any inflight cleanup calls in `memoryPersistence.ts`.
   - Reference snippets (repeat):
     - “Clear inflight only after `appendTurn` resolves for both turns.”
   - Docs (repeat):
     - https://mongoosejs.com/docs/api/model.html

3. [x] Merge inflight into snapshot responses:
   - Files to edit:
     - `server/src/routes/conversations.ts`
     - `server/src/chat/memoryPersistence.ts`
   - Requirements:
     - Always append inflight data to `GET /conversations/:id/turns` responses.
     - Deduplicate against persisted turns by content + role + createdAt window (or similar existing dedupe rules).
     - Ensure the response is ordered chronologically after merge.
   - Code anchors (where to look first):
     - `router.get('/conversations/:id/turns'...)` response builder.
   - Docs (repeat):
     - https://expressjs.com/en/guide/routing.html

4. [x] Add server tests for inflight merge behavior:
   - Files to edit:
     - `server/src/test/integration/conversations.turns.test.ts`
     - `server/src/test/support/mockLmStudioSdk.ts`
   - Test requirements:
     - Simulate a run that finishes before persistence completes; assert snapshot still includes the assistant turn.
     - Simulate persistence completion; assert inflight no longer appears but persisted data remains.
     - Simulate a persistence failure (append/write error); assert inflight remains available in snapshots until a later successful write.
     - Verify snapshots include inflight data even when `includeInflight` is omitted/false (new always-merge behavior).
   - Code anchors (where to look first):
     - Existing list-turn tests in `server/src/test/integration/conversations.turns.test.ts`.
   - Docs (repeat):
     - Context7 `/jestjs/jest`
     - https://cucumber.io/docs/guides/

5. [x] Add client regression tests for multi-window snapshot refresh:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/useChatStream.reasoning.test.tsx` (if needed)
   - Test requirements:
     - Simulate a snapshot refresh after a follow-up in another tab; assert prior assistant turn is not dropped.
     - Ensure assistant ordering remains above its user prompt.
     - Simulate a refresh when inflight data is absent (persistence lag) and assert the last assistant turn is still present after hydration.
   - Code anchors (where to look first):
     - Chat history hydrate effect in `client/src/pages/ChatPage.tsx` (lastMode/lastPage).
   - Docs (repeat):
     - Context7 `/jestjs/jest`

6. [x] Documentation update (if snapshot semantics change):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Document that snapshots always include inflight data until persistence completes.
   - Reference snippets (repeat):
     - “Snapshots merge persisted + inflight until writes succeed.”
   - Docs (repeat):
     - https://expressjs.com/en/guide/routing.html

7. [x] Run lint/format after server/client changes:
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Reproduce the two-window follow-up scenario and verify snapshots keep both assistant responses.
   - Switch away and back; confirm both responses remain.
   - Capture screenshots showing consistent ordering across windows.

9. [x] `npm run compose:down`

#### Implementation notes

- Located inflight lifecycle: created in `server/src/routes/chat.ts` (`createInflight`), updated via `server/src/chat/chatStreamBridge.ts` (token/analysis/tool events), and currently cleared at `turn_final` via `cleanupInflight` inside `publishFinalOnce`.
- Located snapshot path: `server/src/routes/conversations.ts` attaches `snapshotInflight(...)` only when `includeInflight=true` and otherwise returns only persisted `listTurns` data.
- Changed inflight lifecycle so `turn_final` no longer clears inflight; instead inflight is cleared after turn persistence completes inside `ChatInterface.run` (both user + assistant turns).
- Extended inflight state to capture the user turn + final status so `GET /conversations/:id/turns` can always merge recent inflight turns into the `items` array (deduped by role+content+createdAt window) while still optionally returning the detailed `inflight` snapshot when `includeInflight=true`.
- Added server integration coverage in `server/src/test/integration/conversations.turns.test.ts` proving inflight turns are always merged into `items` (even without `includeInflight=true`), are preserved after `turn_final` while persistence is outstanding, and disappear after inflight cleanup with persisted turns remaining.
- Added a client regression test in `client/src/test/chatPage.stream.test.tsx` that simulates the multi-window “switch away and back” flow by dispatching a `focus` event, mutating the mocked `/turns` snapshot to include a follow-up, and asserting earlier assistant turns remain present and ordered after hydration.
- Updated `design.md` to document that `GET /conversations/:id/turns` snapshots always merge persisted + inflight turns until persistence completes, while `includeInflight=true` still controls whether the detailed inflight snapshot payload is returned.
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server`.
- Testing: `npm run test --workspace client`.
- Testing: `npm run e2e`.
- Testing: `npm run compose:build`.
- Testing: `npm run compose:up`.
- Manual check: used Playwright to simulate the two-window follow-up + focus refresh against `http://host.docker.internal:5001/chat` and captured `planning/0000019-screenshots/0000019-25-multi-window-refresh-a.png` and `planning/0000019-screenshots/0000019-25-multi-window-refresh-b.png`.
- Testing: `npm run compose:down`.
- Lint/format: `npm run lint --workspaces`, `npm run format:check --workspaces`.

---

### 26. Snapshot hardening: stable turn IDs + deterministic merge ordering

- Task Status: **__done__**
- Git Commits: **a696838**

#### Overview

Harden snapshot merging by adding stable turn identifiers, reliable dedupe, and deterministic ordering in server snapshot responses. This eliminates timestamp collisions and prevents duplicated or out-of-order assistant turns during inflight merge.

#### Documentation Locations

- Mongoose IDs / document shape: https://mongoosejs.com/docs/documents.html
- Express response shaping: https://expressjs.com/en/guide/routing.html
- Jest patterns: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/
- Playwright MCP reference (manual verification & screenshots): Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Add stable turn IDs to snapshot responses:
   - Files to read:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/routes/conversations.ts`
   - Requirements:
     - Include a stable `turnId` (Mongo `_id`) in the serialized turn payloads.
     - Ensure client‑visible DTO remains backwards compatible (new field is additive).
   - Code anchors (where to look first):
     - Turn serialization in `server/src/routes/conversations.ts` (list turns response mapping).
   - Reference snippets (repeat):
     - `turnId: turn._id.toString()`
   - Docs (repeat):
     - https://mongoosejs.com/docs/documents.html

2. [x] Update snapshot merge/dedupe to prefer turnId:
   - Files to edit:
     - `server/src/chat/memoryPersistence.ts`
     - `server/src/routes/conversations.ts`
   - Requirements:
     - When merging persisted + inflight, dedupe by `turnId` when available.
     - Fall back to (role + content hash + createdAt window) only when `turnId` is missing.
   - Code anchors (where to look first):
     - Merge/dedupe helper in `memoryPersistence.ts`.
   - Docs (repeat):
     - https://mongoosejs.com/docs/documents.html

3. [x] Enforce deterministic ordering in snapshot responses:
   - Files to edit:
     - `server/src/routes/conversations.ts`
   - Requirements:
     - Sort merged turns by `(createdAt, rolePriority, turnId)` before responding.
     - Ensure assistant follows its corresponding user when timestamps are equal.
   - Reference snippets (repeat):
     - `rolePriority: user=0, assistant=1, system=2` (or documented ordering).
   - Docs (repeat):
     - https://expressjs.com/en/guide/routing.html

4. [x] Server tests for ID + ordering guarantees:
   - Files to edit:
     - `server/src/test/integration/conversations.turns.test.ts`
   - Test requirements:
     - Validate `turnId` is present in snapshot responses.
     - Validate ordering when two turns share the same `createdAt`.
     - Validate dedupe prefers `turnId` over timestamp windows.
     - Validate fallback dedupe (no `turnId`) still preserves distinct turns when content differs.
   - Code anchors (where to look first):
     - Existing turns response assertions in `conversations.turns.test.ts`.
   - Docs (repeat):
     - Context7 `/jestjs/jest`

5. [x] Client tests for stable ordering (snapshot consumption):
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
   - Test requirements:
     - Simulate turns with same `createdAt`; ensure UI renders in correct order.
     - Simulate missing `turnId` (legacy payload) and assert ordering remains deterministic.
   - Code anchors (where to look first):
     - `mapTurnsToMessages` in `client/src/pages/ChatPage.tsx`.
   - Docs (repeat):
     - Context7 `/jestjs/jest`

6. [x] Documentation update (if snapshot schema changes):
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that snapshot turns include `turnId` and ordering guarantees.
   - Reference snippets (repeat):
     - “Snapshot payloads include `turnId` and are ordered deterministically.”
   - Docs (repeat):
     - https://expressjs.com/en/guide/routing.html

7. [x] Run lint/format after server/client changes:
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [x] `npm run build --workspace server`

2. [x] `npm run build --workspace client`

3. [x] `npm run test --workspace server`

4. [x] `npm run test --workspace client`

5. [x] `npm run e2e`

6. [x] `npm run compose:build`

7. [x] `npm run compose:up`

8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Reproduce same‑timestamp turns in a mocked run; confirm stable ordering in UI.
   - Capture a screenshot demonstrating correct ordering.

9. [x] `npm run compose:down`

#### Implementation notes

- Added `turnId` (Mongo `_id` string) to the server-side `TurnSummary` DTO returned by `listTurns`, so snapshot items can be deduped and ordered without relying on timestamps alone.
- Updated server snapshot merge to dedupe by `turnId` when present, while preserving the existing role/content/createdAt window fallback for inflight turns that do not yet have an id.
- Extended inflight state to remember persisted `turnId`s for the user/assistant turns so `/conversations/:id/turns` can stop returning duplicates once the DB writes have completed but inflight cleanup hasn’t run yet.
- Updated `/conversations/:id/turns` to apply a deterministic sort for merged snapshot items: `createdAt` (newest-first), then role priority (assistant before user on ties so client-side reversal yields user→assistant), then `turnId` (and a final stable hash fallback).
- Added server integration coverage proving `turnId` is present on persisted snapshot turns, same-timestamp ordering remains deterministic, and inflight merge dedupe prefers `turnId` when available while preserving the content+window fallback for legacy/unknown ids.
- Updated client snapshot handling to accept an optional `turnId` field and use it for deterministic turn sorting and dedupe (fallback remains stable for legacy payloads).
- Added client coverage in `client/src/test/chatPage.stream.test.tsx` for same-`createdAt` ordering with and without `turnId`.
- Updated `design.md` to document the additive `turnId` field on snapshot turns and the deterministic snapshot ordering guarantees.
- Lint/format: ran `npm run lint --workspaces` and `npm run format:check --workspaces` (applied `npm run format --workspace server -- src/test/integration/conversations.turns.test.ts` to satisfy Prettier).
- Fixed TypeScript test doubles that override `ChatInterface.persistTurn` / `persistAssistantTurn` to match the updated return types so `npm run build --workspace server` succeeds.
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server`.
- Testing: `npm run test --workspace client`.
- Testing: `npm run e2e`.
- Testing: `npm run compose:build`.
- Testing: `npm run compose:up`.
- Manual check: inserted a conversation with same-`createdAt` user/assistant turns and captured `planning/0000019-screenshots/0000019-26-same-timestamp-ordering.png` from `http://host.docker.internal:5001/chat` confirming the assistant bubble stays ordered above the user bubble.
- Testing: `npm run compose:down`.
- Adjusted the e2e per-file progress polling timeout in `e2e/ingest.spec.ts` to reduce flakiness when the ingest loop stays on the first file longer than expected.

---

### 27. Reset assistant bubble on cross-tab runs + add diagnostics (and dual-window e2e)

- Task Status: **__done__**
- Git Commits: **5bb3299**

#### Overview

When a second browser window receives a new `user_turn` event, the client reuses the prior assistant bubble instead of creating a new one. Reset the assistant pointer when the `inflightId` changes on a WS `user_turn`, add client log events to diagnose future cross-tab ordering issues, and add an e2e test that runs two browser windows side by side to reproduce the original bug.

#### Documentation Locations

- MUI (for any UI logging chips if needed): https://mui.com/material-ui/react-chip/
- WebSocket handling patterns: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Jest/RTL patterns: Context7 `/jestjs/jest`
- Playwright multi-page contexts: https://playwright.dev/docs/pages
- Playwright test runner: Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Locate assistant pointer reuse and WS `user_turn` flow:
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Find `activeAssistantMessageIdRef` usage and `ensureAssistantMessage()`.
     - Find the `handleWsEvent` path for `user_turn`.
   - Code anchors (where to look first):
     - `handleWsEvent` in `client/src/hooks/useChatStream.ts` (user_turn branch).
     - `activeAssistantMessageIdRef` reset in `resetInflightState`.
   - Reference snippets (repeat):
     - `if (event.type === 'user_turn') { ... }`
     - `activeAssistantMessageIdRef.current = null`
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

2. [x] Reset assistant pointer on cross-tab runs:
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - On `user_turn`, if `event.inflightId !== inflightIdRef.current`, clear `activeAssistantMessageIdRef` and related assistant buffers before `ensureAssistantMessage()`.
     - This must only affect WS-driven runs (not local send) and must not clear the current assistant bubble when the inflightId matches.
     - Ensure no reset occurs when `event.inflightId` is undefined or missing (defensive guard).
   - Reference snippets (repeat):
     - `if (event.inflightId !== inflightIdRef.current) { resetAssistantPointer(); }`
     - `const prevInflightId = inflightIdRef.current;`
   - Code anchors (where to look first):
     - `inflightIdRef` usage inside `handleWsEvent` in `client/src/hooks/useChatStream.ts`.
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

3. [x] Add client logging for cross-tab run transitions:
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/logging/logger.ts` (or existing log helper)
   - Requirements:
     - Emit a log on every `user_turn` that includes `{ conversationId, inflightId, prevInflightId, assistantMessageIdBefore, assistantMessageIdAfter }`.
     - Emit a log when a WS `user_turn` triggers a reset of `activeAssistantMessageIdRef`.
     - Ensure logs are forwarded to the server (consistent with existing `chat.ws.client_*` logging).
   - Code anchors (where to look first):
     - `logWithChannel(...)` in `useChatStream.ts`.
   - Reference snippets (repeat):
     - `logWithChannel('info', 'chat.ws.client_user_turn', {...})`
     - `logWithChannel('info', 'chat.ws.client_reset_assistant', {...})`
   - Docs (repeat):
     - Context7 `/jestjs/jest`

4. [x] Add client tests for pointer reset:
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
   - Test requirements:
     - Simulate two WS runs (two `user_turn` + `turn_final` sequences) without calling `send()`.
     - Assert the second run renders a new assistant bubble instead of overwriting the first.
     - Assert the reset log event is emitted when `inflightId` changes.
     - Assert **no reset** occurs when `user_turn` arrives with the same `inflightId`.
     - Assert **no reset** occurs for local send path (only WS-driven runs).
   - Code anchors (where to look first):
     - `setupChatWsHarness` in `client/src/test/support/mockChatWs.ts`.
     - Existing WS transcript tests in `client/src/test/chatPage.stream.test.tsx`.
   - Reference snippets (repeat):
     - `harness.emitUserTurn(...)` (or equivalent WS emit helper).
   - Docs (repeat):
     - Context7 `/jestjs/jest`

5. [x] Add e2e test with two browser windows:
   - Files to edit:
     - `e2e/chat-multiwindow.spec.ts` (new)
   - Test requirements:
     - Open two pages in the same Playwright context (side-by-side sizes).
     - Start a Codex run in page A, switch to page B and observe the response.
     - Send a follow-up in page A and assert page B shows a new assistant response (not replacing the first).
     - Ensure both pages render the same transcript order after refresh.
     - Add an explicit assertion that the passive page shows two assistant bubbles after the second run.
   - Code anchors (where to look first):
     - Existing chat e2e patterns: `e2e/chat.spec.ts`.
     - Existing Codex e2e patterns: `e2e/chat-codex-mcp.spec.ts` (for selectors).
   - Reference snippets (repeat):
     - `const pageA = await context.newPage();`
     - `const pageB = await context.newPage();`
   - Docs (repeat):
     - https://playwright.dev/docs/pages
     - Context7 `/microsoft/playwright`

6. [x] Documentation update:
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note the WS `user_turn` inflightId reset and diagnostic log events for cross-tab runs.
   - Reference snippets (repeat):
     - “On WS `user_turn` with new `inflightId`, client resets assistant pointer and logs `chat.ws.client_reset_assistant`.”
   - Docs (repeat):
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

7. [x] Run lint/format after client/e2e changes:
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Open two browser windows and reproduce the original scenario.
   - Confirm the second run creates a new assistant bubble in the passive window.
   - Validate the new client log entries appear in the server logs.
   - Capture a screenshot showing both windows after the second response.
9. [x] `npm run compose:down`

#### Implementation notes

- Testing 9: `npm run compose:down` stopped the stack.
- Testing 8: Ran the two-window Playwright check against the running Compose stack via `http://host.docker.internal:5001` and confirmed the passive window renders two assistant bubbles after the follow-up; verified `chat.ws.client_reset_assistant` appears in `GET /logs`; screenshots captured under `test-results/screenshots/0000019-27-multiwindow-*.png` (rebuilt client with `VITE_API_URL=http://host.docker.internal:5010` so the in-container browser can reach the host-mapped server port).
- Testing 7: `npm run compose:up` started the stack successfully (services healthy).
- Testing 6: `npm run compose:build` passed (also validates the Dockerfile install-step refactor).
- Testing 5: `npm run e2e` passed (includes new multiwindow spec; screenshots emitted under `test-results/screenshots/0000019-27-*`).
- Testing 4: `npm run test --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 1: `npm run build --workspace server` passed.
- Subtask 7: Ran `npm run lint --workspaces` (warnings only) and `npm run format:check --workspaces` (pass) after fixing new test lint violations and formatting.
- Subtask 6: Updated `design.md` to document the cross-tab `user_turn` inflightId transition handling and the new diagnostic client log events (`chat.ws.client_user_turn`, `chat.ws.client_reset_assistant`).
- Subtask 5: Added deterministic multi-window Playwright spec `e2e/chat-multiwindow.spec.ts` (mock chat only) that opens two pages, runs two consecutive turns from page A, and asserts page B shows two assistant bubbles (no overwrite) and remains consistent after refresh; screenshots saved under `test-results/screenshots/0000019-27-...`.
- Subtask 4: Added Jest/RTL coverage in `client/src/test/chatPage.stream.test.tsx` to simulate back-to-back WS `user_turn` sequences (no local `send()`), asserting a new assistant bubble is created on `inflightId` change and that reset logs fire only for WS-driven transitions.
- Subtask 3: Added `chat.ws.client_user_turn` and `chat.ws.client_reset_assistant` log events (via `logWithChannel`) including `conversationId`, `prevInflightId`, `inflightId`, and assistant message ids, so cross-tab ordering issues can be diagnosed from the shared `/logs` store.
- Subtask 2: On WS `user_turn`, when `inflightId` changes and the run was not locally started (`status !== sending`), the client now clears the assistant pointer + in-memory assistant buffers before creating the new processing bubble, preventing cross-tab runs from overwriting the previous assistant message.
- Subtask 1: Confirmed `activeAssistantMessageIdRef` is set in `ensureAssistantMessage()` and never cleared on `turn_final`; `handleWsEvent` calls `ensureAssistantMessage()` before the `user_turn` branch, which explains cross-tab assistant-bubble reuse when a new `inflightId` arrives.

### 28. Persist client logs to server log file (tagged + client correlation)

- Task Status: **__done__**
- Git Commits: **ffadb2a**

#### Overview

Client logs currently POST to `/logs` and are queryable via the in-memory log store, but they are **not written to the server log file**. Wire client log entries into the file logger and add a stable client identifier so we can trace related events from a single browser instance in the log file.

#### Documentation Locations

- Express request logging (pino-http): https://github.com/pinojs/pino-http
- Pino usage: https://getpino.io/#/
- MDN localStorage (client id persistence): https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage

#### Subtasks

1. [x] Confirm current log flow and log file writing:
   - Files to read:
     - `server/src/logStore.ts`
     - `server/src/logger.ts`
     - `server/src/routes/logs.ts`
     - `client/src/logging/logger.ts`
   - Requirements:
     - Note that `/logs` appends to `logStore` but does not persist to the file logger.
     - Identify where to inject file logging without double-writing server-side entries.
   - Code pointers:
      - `server/src/logStore.ts`: `append()` currently stores in-memory + emits to subscribers only.
      - `server/src/logger.ts`: `baseLogger` writes to the file destination (`LOG_FILE_PATH`).
      - `server/src/routes/logs.ts`: `router.post('/')` accepts client log entries and calls `append()`.
   - Docs (repeat):
      - https://getpino.io/#/
      - https://github.com/pinojs/pino-http

2. [x] Add stable client identifier to client logs:
   - Files to edit:
     - `client/src/logging/logger.ts`
     - `client/src/logging/transport.ts`
   - Requirements:
     - Generate a `clientId` (UUID) and persist to `localStorage` (fallback to in-memory if storage is unavailable).
     - Ensure each log entry includes `clientId` in `context` (not `message`) and retains the existing `source: "client"`.
     - Keep the log payload size within `VITE_LOG_MAX_BYTES`.
   - Code pointers:
      - `client/src/logging/logger.ts`: `createLogger()` assembles the `LogEntry`.
      - `client/src/logging/transport.ts`: `sendLogs()` enqueues entries and enforces `VITE_LOG_MAX_BYTES`.
   - Expected entry shape (example):
      - `{ source: "client", message: "chat.client_send_begin", context: { clientId: "...", ... } }`
   - Docs (repeat):
      - https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
      - https://getpino.io/#/

3. [x] Persist client log entries to the server log file:
   - Files to edit:
     - `server/src/logStore.ts`
     - `server/src/logger.ts`
   - Requirements:
     - When `append()` is called for client entries, forward them to the file logger with a clear prefix (e.g. `CLIENT_LOG` or `source=client`).
     - Preserve the log `sequence` and include `clientId` from `entry.context` in the output.
     - Ensure server log formatting remains JSON (pino) and does not break existing parsing.
   - Code pointers:
      - `server/src/logStore.ts`: add a call to `baseLogger` inside `append()` when `entry.source === 'client'`.
      - `server/src/logger.ts`: reuse `baseLogger` so entries land in `LOG_FILE_PATH`.
   - Suggested log payload (JSON):
      - `baseLogger.info({ source: "client", clientId, sequence, message, context }, "CLIENT_LOG")`
   - Docs (repeat):
      - https://getpino.io/#/

4. [x] Add tests for client log persistence + clientId stability:
   - Files to edit:
     - `server/src/test/integration/ws-logs.test.ts` (or new test file)
     - `server/src/test/features/logs.feature` (if using Cucumber)
     - `client/src/test/clientLogging.test.ts` (new)
   - Test requirements:
     - POST a client log entry and assert it appears in `/logs` with the new `clientId`.
     - Validate that the server logger was invoked (spy/mocked destination or log store entry includes a `source=client` marker).
     - Unit test: `createLogger()` includes a stable `clientId` across multiple log calls.
     - Unit test: when `localStorage` is unavailable, logger falls back to an in-memory `clientId` without throwing.
   - Code pointers:
      - `server/src/routes/logs.ts`: POST handler is the entry point used by client log forwarding.
      - `client/src/logging/logger.ts`: ensure `clientId` logic is testable (export helper if needed).
   - Docs (repeat):
      - https://getpino.io/#/
      - Context7 `/jestjs/jest`

5. [x] Documentation update:
   - Files to edit:
     - `design.md`
   - Requirements:
     - Document the `clientId` field and how client logs are persisted into the server log file.
     - Note the required env vars: `VITE_LOG_FORWARD_ENABLED`, `VITE_API_URL`.

6. [x] Run lint/format after client/server changes:
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Open Chat in a browser with `VITE_LOG_FORWARD_ENABLED=true`.
   - Trigger a chat run and confirm new client log entries appear in `/logs`.
   - Tail the server log file and confirm the same entries are persisted with `source=client` and `clientId`.
9. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Confirmed `POST /logs` only appends to `server/src/logStore.ts` (in-memory) and does not forward to the pino file logger; server-originated log flows (e.g. `chatStreamBridge.ts`) already call `baseLogger.*` directly so file forwarding must be limited to `entry.source === 'client'` to avoid double-writing.
- Subtask 2: Added a stable `clientId` (stored under `localStorage['codeinfo2.clientId']`, falling back to an in-memory id if storage is unavailable) and inject it into every client `LogEntry.context` so forwarded `/logs` entries can be correlated to a single browser instance.
- Subtask 3: Updated `server/src/logStore.ts` to forward `entry.source === 'client'` to `baseLogger` with a `CLIENT_LOG` marker, preserving `sequence` and lifting `context.clientId` to a top-level `clientId` field for easier grepping in JSON log files.
- Subtask 4: Added `server/src/test/integration/client-logs-persist.test.ts` to assert `POST /logs` forwards client entries to `baseLogger` (spy) and that entries remain queryable via `GET /logs`; added `client/src/test/clientLogging.test.ts` to verify `clientId` stability and the localStorage fallback path.
- Subtask 5: Updated `design.md` to document the new stable `clientId` field (persisted client-side) and the server-side `CLIENT_LOG` forwarding of client entries into the pino log file.
- Subtask 6: Ran `npm run lint --workspaces` (warnings only) and `npm run format:check --workspaces` (pass) after formatting new test files.
- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed.
- Testing 4: `npm run test --workspace client` passed.
- Testing 5: `npm run e2e` passed.
- Testing 6: `npm run compose:build` passed.
- Testing 7: `npm run compose:up` started the stack successfully (services healthy).
- Testing 8: Manual check (container-safe via mapped ports): `POST http://host.docker.internal:5010/logs` with a client entry including `context.clientId` and confirmed it appears in `GET /logs?source=client&text=chat.ws.client_manual_check_rebuilt`; verified the same entry is persisted in the pino file output under `logs/server.3.log` with `msg:"CLIENT_LOG"`, `source:"client"`, and top-level `clientId`.
- Testing 9: `npm run compose:down` stopped the stack.

### 29. Add targeted client/server logs for cross-tab overwrite investigation

- Task Status: **__completed__**
- Git Commits: **5769b21**

#### Overview

Add deterministic log lines that prove whether the active assistant pointer and text buffers are being reused during a second send, so we can correlate the overwrite to a specific inflight transition.

#### Documentation Locations

- MDN WebSocket: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Context7 `/jestjs/jest`

#### Subtasks

1. [x] Add client logs around send/reset + turn final:
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Log `chat.client_send_begin` with: `status`, `isStreaming`, `inflightId`, `activeAssistantMessageId`, `lastMessageStreamStatus`, `lastMessageContentLen`.
     - Log `chat.client_send_after_reset` with: `prevAssistantMessageId`, `nextAssistantMessageId`, `createdNewAssistant`.
     - Log `chat.client_turn_final_sync` with: `inflightId`, `assistantMessageId`, `assistantTextLen`, `streamStatus`.
   - Code pointers:
      - `send()` (after `stop()` + before `resetInflightState()`), and again after `ensureAssistantMessage()`.
      - `handleWsEvent()` branch for `turn_final` right before `syncAssistantMessage(...)`.
   - Docs (repeat):
      - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

2. [x] Add server logs around WS publish events:
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - Log `chat.ws.server_publish_user_turn`, `chat.ws.server_publish_assistant_delta`, `chat.ws.server_publish_turn_final`.
     - Include `conversationId`, `inflightId`, `seq`, and any size/count context (e.g., delta length).
   - Code pointers:
      - `publishUserTurn`, `publishAssistantDelta`, `publishTurnFinal` in `server/src/ws/server.ts` (log before `broadcastConversation()`).
   - Docs (repeat):
      - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

3. [x] Add tests or log assertions (including send-state corner case):
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
     - `server/src/test/unit/ws-chat-stream.test.ts` (or integration)
   - Requirements:
     - Verify client log events are emitted during simulated send + WS flow (including `status === 'sending'`).
     - Verify server publishes include the new log entries.
   - Code pointers:
      - `client/src/test/chatPage.stream.test.tsx` already sets up WS events; extend to capture logger output.
      - `server/src/test/unit/ws-chat-stream.test.ts` already asserts publish ordering for `user_turn`/`assistant_delta`/`turn_final`.
   - Docs (repeat):
      - Context7 `/jestjs/jest`

4. [x] Documentation update:
   - Files to edit:
     - `design.md`
   - Requirements:
     - Document the new log messages and fields so manual Playwright runs can validate them.

5. [x] Run lint/format after client/server changes:
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Open two windows on the same conversation.
   - Send a second prompt from window 1.
   - Confirm the log sequence shows `chat.client_send_begin` → `chat.client_send_after_reset` → WS publish logs → `chat.client_turn_final_sync`.
9. [x] `npm run compose:down`

#### Implementation notes

- Documentation: MDN WebSocket (message ordering, event-driven lifecycle) informs the expected publish/receive flow we log; Jest docs guide log-capture assertions in unit tests.
- Gotchas: client logs are emitted via `createLogger()` (console + batched POST /logs), so tests should spy on `console.log` rather than relying on fetch side-effects; keep log payloads free of user prompt content beyond lengths/ids.
- Gotchas: server `append()` only forwards `source=client` into the pino file logger; these new server publish logs should remain `source=server` and are intended for /logs query-based verification.
- Subtask 1: Added `chat.client_send_begin`, `chat.client_send_after_reset`, and `chat.client_turn_final_sync` logs in `client/src/hooks/useChatStream.ts` with the required inflight + assistant message fields for cross-tab overwrite correlation.
- Subtask 2: Logged server WS publish milestones in `server/src/ws/server.ts` (`chat.ws.server_publish_user_turn`, `chat.ws.server_publish_assistant_delta`, `chat.ws.server_publish_turn_final`) including `conversationId`, `inflightId`, `seq`, and size metadata (content/delta length).
- Subtask 3: Extended `client/src/test/chatPage.stream.test.tsx` to assert the new client log messages and added a WS stream unit assertion in `server/src/test/unit/ws-chat-stream.test.ts` to prove publish logs are appended to the server log store.
- Subtask 4: Updated `design.md` to document the new client send/reset + turn-final sync logs and the server WS publish milestone logs (names + key fields) for manual verification via the Logs UI.
- Subtask 5: Ran `npm run lint --workspaces` (warnings only) and `npm run format:check --workspaces` (pass after formatting `server/src/test/unit/ws-chat-stream.test.ts`).
- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed.
- Testing 4: `npm run test --workspace client` passed.
- Testing 5: `npm run e2e` passed (31 Playwright specs).
- Testing 6: `npm run compose:build` passed.
- Testing 7: `npm run compose:up` started stack successfully (containers healthy).
- Testing 8: Two-window (headless Playwright) run against compose via host-mapped ports confirmed `chat.client_send_begin`/`chat.client_send_after_reset` and the server publish logs (`chat.ws.server_publish_user_turn`/`assistant_delta`/`turn_final`) appear in `GET /logs`. Observed `chat.client_turn_final_sync` can arrive for the *previous* inflightId after the second send begins (evidence for Task 30 overwrite bug); this task’s logs now make that mismatch visible.
- Testing 9: `npm run compose:down` stopped the stack.

### 30. Fix sending-tab assistant overwrite on second prompt

- Task Status: **__completed__**
- Git Commits: **2febc39**

#### Overview

The sending tab clears its inflight state before WS events arrive. Because the active assistant pointer is global (not per inflight), subsequent WS `turn_final` updates can overwrite the previous assistant reply and render only the “Complete” chip. Implement a fix so each new run creates a new assistant bubble in the sending tab, and the prior assistant message remains intact.

#### Documentation Locations

- MDN WebSocket: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Context7 `/jestjs/jest`
- Playwright test runner: Context7 `/microsoft/playwright`

#### Subtasks

1. [x] Pin assistant pointer to inflightId during send:
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Ensure a **new assistant message** is created when `send()` starts (even if a previous assistant message is still `processing`).
     - Ensure WS updates for a new inflight do not reuse a previous assistant message id.
     - Preserve existing cross-tab reset behavior from Task 27.
   - Code pointers:
      - `ensureAssistantMessage()` currently reuses the last `processing` assistant bubble if `activeAssistantMessageIdRef` is empty.
      - `send()` calls `stop()` then `resetInflightState()` before `ensureAssistantMessage()`.
      - `handleWsEvent()` `user_turn` branch skips pointer reset when `status === 'sending'`.
   - Suggested approach (pseudo):
      - In `send()`, clear `activeAssistantMessageIdRef` **after** `stop()` and before `ensureAssistantMessage()`, or add a `forceNew` flag to `ensureAssistantMessage()` so the send path always creates a fresh assistant bubble.
      - Keep the WS cross-tab reset logic intact (Task 27).
   - Docs (repeat):
      - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

2. [x] Update client tests (including “previous reply already complete” case):
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
   - Test requirements:
     - Simulate two consecutive sends in a single tab where the first reply has already finalized (`streamStatus=complete`) and assert it remains intact.
     - Simulate a second send while a previous assistant message is still `processing` and assert the new run still creates a new assistant bubble.
     - Assert the second response creates a new assistant bubble in both scenarios.
   - Code pointers:
      - Use existing helpers that seed `messagesRef` and trigger `send()` + `handleWsEvent` with `user_turn`/`turn_final`.
   - Docs (repeat):
      - Context7 `/jestjs/jest`

3. [x] Update e2e multi-window test:
   - Files to edit:
     - `e2e/chat-multiwindow.spec.ts`
   - Test requirements:
     - Confirm window 1 does not overwrite the first assistant response when sending the second request.
     - Confirm window 2 remains consistent after the second response.
   - Code pointers:
      - Add a second send from window A; assert both windows render two assistant replies in the correct order.
   - Docs (repeat):
      - Context7 `/microsoft/playwright`

4. [x] Documentation update:
   - Files to edit:
     - `design.md`
   - Requirements:
     - Document the fix logic and any new invariants (assistant pointer now per inflight).
   - Docs (repeat):
      - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

5. [x] Run lint/format after client/e2e changes:
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Open two windows on the same conversation.
   - Send two prompts from window 1.
   - Confirm the first assistant reply remains visible after the second prompt completes.
9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-31: Started Task 30 (fix assistant overwrite on second prompt).
- Subtask 1: Updated `client/src/hooks/useChatStream.ts` to bind assistant bubbles to `inflightId` (map ref) and force a new assistant bubble on `send()` so late `turn_final` events can’t overwrite a newer run.
- Subtask 2: Added client unit coverage in `client/src/test/chatPage.stream.test.tsx` for two consecutive sends and the “Stop then send again while prior assistant is still processing” scenario, including a late `turn_final` regression.
- Subtask 3: Tightened `e2e/chat-multiwindow.spec.ts` to assert the sending tab still shows the first assistant reply after the second send completes (count + visibility in both windows).
- Subtask 4: Updated `design.md` with the new per-`inflightId` assistant bubble binding invariant and the late `turn_final` handling rule.
- Subtask 5: Ran `npm run lint --workspaces` (warnings only) and fixed formatting for `client/src/hooks/useChatStream.ts` (`npx prettier ... --write`), then `npm run format:check --workspaces` passed.
- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed (note: first run hit the agent command timeout; reran with a longer timeout and it completed successfully).
- Testing 4: `npm run test --workspace client` passed.
- Testing 5: `npm run e2e` passed (31 Playwright specs).
- Testing 6: `npm run compose:build` passed.
- Testing 7: `npm run compose:up` started stack successfully (containers healthy).
- Testing 8: Ran `E2E_BASE_URL=http://host.docker.internal:5001 E2E_API_URL=http://host.docker.internal:5010 E2E_USE_MOCK_CHAT=true npx playwright test e2e/chat-multiwindow.spec.ts` against the compose stack; verified window 1 retains the first assistant reply after the second prompt completes.
- Testing 9: `npm run compose:down` stopped the stack.

### 31. Fix Provider/Model label clipping by switching to TextField select

- Task Status: **__completed__**
- Git Commits:
  - DEV-19 - Fix provider/model label clipping in ChatPage (`37709cf`)

#### Overview

The Provider/Model select labels are clipped. Switch to MUI `TextField` with `select` to let MUI manage label positioning and avoid the clipped label baseline.

#### Documentation Locations

- MUI TextField API (select usage + label handling): https://mui.com/material-ui/api/text-field/
- MUI Select API (if needed for props parity): https://mui.com/material-ui/api/select/

#### Subtasks

1. [x] Replace Provider/Model FormControl+Select with TextField select:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Replace the Provider and Model `FormControl + InputLabel + Select` blocks with `TextField select`.
     - Preserve `label`, `value`, `onChange`, `disabled`, and `data-testid` attributes (`provider-select`, `model-select`).
     - Keep existing `minWidth` sizing and layout behavior.
   - Code pointers:
     - Provider select block near `data-testid="provider-select"` (ChatPage form header).
     - Model select block near `data-testid="model-select"` (immediately after provider field).
   - Reference snippet (current structure):
     - `<FormControl ...><InputLabel>Provider</InputLabel><Select data-testid="provider-select" ... /></FormControl>`
     - `<FormControl ...><InputLabel>Model</InputLabel><Select data-testid="model-select" ... /></FormControl>`
   - Reference snippet (target structure):
     - `<TextField select label="Provider" value={provider ?? ''} onChange={handleProviderChange} data-testid="provider-select">...</TextField>`
     - `<TextField select label="Model" value={selected ?? ''} onChange={(event) => setSelected(event.target.value)} data-testid="model-select">...</TextField>`
   - Docs (repeat):
     - https://mui.com/material-ui/api/text-field/

2. [x] Update client tests that depend on provider/model selects:
   - Files to edit (known tests from code_info analysis):
     - `client/src/test/chatPage.provider.test.tsx`
     - `client/src/test/chatPage.provider.conversationSelection.test.tsx`
     - `client/src/test/chatPage.flags.panelCollapsed.test.tsx`
     - `client/src/test/chatPage.flags.reasoning.payload.test.tsx`
     - `client/src/test/chatPage.flags.reasoning.default.test.tsx`
     - `client/src/test/chatPage.flags.approval.default.test.tsx`
     - `client/src/test/chatPage.flags.websearch.default.test.tsx`
     - `client/src/test/chatPage.flags.sandbox.reset.test.tsx`
     - `client/src/test/chatSendPayload.test.tsx`
     - `client/src/test/chatPage.stream.test.tsx`
   - Requirements:
     - Ensure tests still find the selects by `data-testid` and any text queries used to open the menu still work after switching to `TextField select`.
     - If tests use label-based queries, update to match the new rendered structure.
     - Add explicit coverage that disabled/locked states still apply (provider locked, model disabled when provider unavailable).
     - Add a regression check for the empty-models state (provider selected but `models` empty) to ensure the `TextField select` still renders alongside the “No chat-capable models” banner.
   - Code pointers:
     - Tests currently use `screen.getByTestId('provider-select')` / `model-select` in provider/flags suites.
     - If any tests use `getByLabelText('Provider')` / `getByLabelText('Model')`, verify the label remains present after switching to `TextField select`.
   - Docs (repeat):
     - Context7 `/jestjs/jest`

3. [x] Update e2e coverage if needed:
   - Files to edit (likely impacted):
     - `e2e/chat.spec.ts`
   - Requirements:
     - Confirm model/provider selection still works via Playwright selectors; update selectors if the DOM structure changes.
     - Add a small-viewport run (below `sm`) to confirm the selects remain usable when stacked vertically.
   - Code pointers:
     - `e2e/chat.spec.ts` uses `data-testid="provider-select"` / `model-select` selectors.
     - Use `page.setViewportSize({ width: 500, height: 900 })` for the `sm` breakpoint check.
   - Docs (repeat):
     - Context7 `/microsoft/playwright`

4. [x] Documentation update:
   - Files to edit:
     - `design.md`
   - Requirements:
     - Note that Chat provider/model selectors use `TextField select` to avoid label clipping.

5. [x] Run lint/format after client/e2e changes:
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (task focus + regressions):
   - Verify Provider/Model labels are fully visible (no clipping) on Chat page.
   - Open/close Provider and Model selects and confirm selection still updates.
9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-31: Started Task 31 (switch Provider/Model selects to `TextField select` to fix clipped labels).
- Subtask 1: Replaced Provider/Model `FormControl + InputLabel + Select` with `TextField select` in `client/src/pages/ChatPage.tsx`, preserving ids, disabled logic, sizing, and `data-testid` via `SelectDisplayProps`.
- Subtask 2: Updated client tests to keep using role/testid queries after the `TextField select` switch; added explicit assertions for provider-locked disabling and model-disabled states (provider unavailable + empty models banner).
- Subtask 3: Updated `e2e/chat.spec.ts` with a small-viewport test (`width: 500`) to confirm Provider/Model selects open and selection still updates when the layout stacks.
- Subtask 4: Updated `design.md` to document that Chat provider/model selectors use `TextField select` to avoid label clipping.
- Subtask 5: Ran `npm run lint --workspaces` (warnings only) and `npm run format:check --workspaces` (after `npm run format --workspace client`).
- Testing 1: `npm run build --workspace server` passed.
- Testing 2: `npm run build --workspace client` passed.
- Testing 3: `npm run test --workspace server` passed.
- Testing 4: `npm run test --workspace client` passed.
- Testing 5: `npm run e2e` passed.
- Testing 6: `npm run compose:build` passed.
- Testing 7: `npm run compose:up` started stack successfully (containers healthy).
- Testing 8: Ran `E2E_BASE_URL=http://host.docker.internal:5001 E2E_API_URL=http://host.docker.internal:5010 E2E_USE_MOCK_CHAT=true npx playwright test e2e/chat.spec.ts -g "chat streams end-to-end"` and `-g "small viewport"` against the compose stack; confirmed Provider/Model labels render without clipping in the captured screenshot and both selects open/close with selection updates.
- Testing 9: `npm run compose:down` stopped the stack.

### 32. Add responsive collapsible Conversations drawer (sm breakpoint)

- Task Status: **__in_progress__**
- Git Commits: **__to_do__**

#### Overview

Make the Conversations sidebar collapsible. Use a responsive `Drawer` that is **persistent on desktop** and **temporary on mobile** (sm breakpoint), with a toggle button to open/close. On small screens the drawer overlays the chat; on larger screens it pushes the chat content.

#### Documentation Locations

- MUI Drawer API: https://mui.com/material-ui/api/drawer/
- MUI SwipeableDrawer API (if gesture support is desired later): https://mui.com/material-ui/api/swipeable-drawer/
- MUI Responsive UI guide (breakpoints + useMediaQuery): https://mui.com/material-ui/guides/responsive-ui/

#### Subtasks

1. [ ] Add drawer state + breakpoint behavior:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Use `useMediaQuery(theme.breakpoints.down('sm'))` to determine mobile mode.
     - Default: open on desktop, closed on mobile.
     - Add a toggle button to open/close the drawer.
   - Code pointers:
     - Conversation list container currently under `data-testid="conversation-list"`.
     - Main layout stack around the chat controls + transcript.
   - Reference snippet (target structure):
     - `const isMobile = useMediaQuery(theme.breakpoints.down('sm'));`
     - `const [drawerOpen, setDrawerOpen] = useState(!isMobile);`
     - Toggle button: `<IconButton onClick={() => setDrawerOpen((prev) => !prev)} ... />`
   - Docs (repeat):
     - https://mui.com/material-ui/api/drawer/
     - https://mui.com/material-ui/guides/responsive-ui/

2. [ ] Replace static sidebar with Drawer variants:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Use `Drawer` with `variant="persistent"` for desktop and `variant="temporary"` for mobile.
     - Ensure the main chat column expands when drawer is closed (desktop) and remains full-width under overlay (mobile).
     - Ensure ConversationList still receives the same props and scroll behavior.
     - Preserve existing test ids if tests rely on them (e.g., `conversation-list`).
   - Code pointers:
     - Sidebar currently in a `<Box data-testid="conversation-list">...</Box>`; wrap this content inside `<Drawer>` so the same `data-testid` is still present on the inner container.
     - Main content `Stack` uses `flex: 1` — ensure it respects drawer width when open by applying `ml` or `width` adjustments only in desktop mode.
   - Docs (repeat):
     - https://mui.com/material-ui/api/drawer/

3. [ ] Update client tests + e2e coverage:
   - Files to edit (known impacted tests from code_info analysis + layout changes):
     - `client/src/test/chatPage.provider.test.tsx`
     - `client/src/test/chatPage.provider.conversationSelection.test.tsx`
     - `client/src/test/chatPage.flags.panelCollapsed.test.tsx`
     - `client/src/test/chatPage.stream.test.tsx`
     - `e2e/chat.spec.ts`
     - `e2e/chat-multiwindow.spec.ts`
   - Requirements:
     - Adjust tests if the sidebar DOM is now nested inside a Drawer.
     - Add coverage for toggle behavior (open/close) in at least one client test or e2e spec.
     - Add explicit assertions for default open on desktop and default closed on mobile (`sm` breakpoint), including overlay vs push layout behavior.
   - Code pointers:
     - Update tests that query `conversation-list` to account for `Drawer` + `Paper` DOM wrapper.
     - For mobile overlay, use `getByRole('presentation')` or `MuiDrawer-paper` class to assert overlay is present.
   - Docs (repeat):
     - Context7 `/jestjs/jest`
     - Context7 `/microsoft/playwright`

4. [ ] Documentation update:
   - Files to edit:
     - `design.md`
   - Requirements:
     - Document the responsive drawer behavior (sm breakpoint, persistent vs temporary).

5. [ ] Run lint/format after client/e2e changes:
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check (task focus + regressions):
   - Desktop: verify drawer opens by default, closes via toggle, and chat area expands.
   - Mobile (sm/down): verify drawer is closed by default and overlays chat when opened.
9. [ ] `npm run compose:down`

#### Implementation notes

- _Pending._
