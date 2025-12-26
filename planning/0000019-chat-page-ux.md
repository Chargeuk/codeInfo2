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
- Catch-up must include **both** partial assistant text **and** interim tool-call progress/events so the viewed transcript looks identical to watching the stream in the originating tab.
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
- When switching to a conversation that is already mid-stream, catch-up renders the in-flight state so the transcript matches the originating tab, including interim tool-call progress/events.
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
  - `conversationId` echoes the request when provided, or a new id when the conversation is created.
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
- The server begins the run and publishes `inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final` events over the WebSocket to any subscribed viewers.
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
    - `{ type, conversationId, seq: number, inflight: { inflightId: string, assistantText: string, toolEvents: ToolEvent[], startedAt: string } }`
  - `type: "assistant_delta"`
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

- Docker Compose runs Mongo as a single-node replica set (`--replSet rs0` and `mongo/init-mongo.js` calls `rs.initiate(...)`), which is capable of transactions.
- However, the documented/default `MONGO_URI` uses `directConnection=true` and does not specify `replicaSet=rs0` (`README.md`, `docker-compose.yml`, `server/.env`). With that URI, drivers typically treat the connection as standalone, and multi-document transactions may not be available.
- There are no existing Mongoose session/transaction patterns in the codebase today. To satisfy “all-or-nothing” bulk operations and “delete conversations + turns” atomically, this story should plan to:
  - enable replica-set-aware connections for dev (update default `MONGO_URI` to include `replicaSet=rs0` and drop `directConnection=true`), and
  - implement bulk operations using a Mongoose session transaction.

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

(none – ready for tasking once the WebSocket protocol above is reviewed and accepted as final for v1.)

---
# Tasks

### 1. Conversation list filtering (state query)

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Extend `GET /conversations` to support a 3-state filter (`active`, `archived`, `all`) while preserving backward compatibility for the existing `archived=true` query. This powers the new sidebar filter and keeps existing callers stable.

#### Documentation Locations

- Express 5 query parsing + routing: Context7 `/expressjs/express`
- Mongoose query filters: Context7 `/websites/mongoosejs`
- HTTP 400 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
- URLSearchParams / query strings: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- SuperTest: Context7 `/ladjs/supertest`
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Read the current conversations list flow and filter handling:
   - Docs to read:
     - Context7 `/expressjs/express`
     - Context7 `/websites/mongoosejs`
   - Files to read:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/conversation.ts`
2. [ ] Add `state` query handling (`active|archived|all`) with backward compatibility for `archived=true`:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Files to edit:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
   - Requirements:
     - Default is `state=active`.
     - `archived=true` maps to `state=all`.
     - Invalid `state` values return 400 with `{ status:"error", code:"VALIDATION_FAILED" }`.
3. [ ] Update server unit/integration tests for list filtering:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Requirements:
     - Add cases for `state=active`, `state=archived`, `state=all`, and `archived=true` compatibility.
4. [ ] Update `design.md` with the new list filter contract:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Required updates:
     - Add a short bullet describing the new `state` query and default behavior.
5. [ ] Update `projectStructure.md` if any new files are added (likely none for this task).
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix any issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in during implementation)

---

### 2. Conversation bulk endpoints

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Add bulk archive/restore/delete endpoints with all-or-nothing semantics, including archived-only delete guardrails and transaction-backed updates.

#### Documentation Locations

- Express 5 routing/request lifecycle: Context7 `/expressjs/express`
- Mongoose sessions/transactions: Context7 `/websites/mongoosejs`
- MongoDB transactions overview: https://www.mongodb.com/docs/manual/core/transactions/
- HTTP 409 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- SuperTest: Context7 `/ladjs/supertest`
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Read the existing conversation archive/restore/delete plumbing:
   - Docs to read:
     - Context7 `/expressjs/express`
     - Context7 `/websites/mongoosejs`
   - Files to read:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/turn.ts`
2. [ ] Add bulk endpoints and validation:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to edit:
     - `server/src/routes/conversations.ts`
   - Requirements:
     - Implement:
       - `POST /conversations/bulk/archive`
       - `POST /conversations/bulk/restore`
       - `POST /conversations/bulk/delete`
     - Body shape: `{ conversationIds: string[] }` (non-empty).
     - Errors:
       - `BATCH_CONFLICT` when any id is invalid or violates archived-only delete.
     - On success, emit sidebar events so other tabs update without refresh:
       - archive/restore → `conversation_upsert`
       - delete → `conversation_delete`
     - Ensure existing single-item `POST /conversations/:id/archive|restore` also emit `conversation_upsert` so old/new UI actions stay realtime-consistent.
3. [ ] Implement bulk operations in the repo layer with transactions:
   - Docs to read:
     - Context7 `/websites/mongoosejs`
     - https://www.mongodb.com/docs/manual/core/transactions/
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Requirements:
     - Use a Mongoose session transaction to ensure all-or-nothing behavior.
     - Enforce archived-only delete guardrail.
     - After a successful commit, publish `conversation_upsert` / `conversation_delete` events for each affected conversationId.
4. [ ] Update default Mongo connection string for replica-set transactions:
   - Docs to read:
     - https://www.mongodb.com/docs/manual/core/transactions/
   - Files to edit:
     - `server/.env`
     - `README.md`
     - `docker-compose.yml` (if needed to keep defaults aligned)
   - Requirements:
     - Use `replicaSet=rs0` and remove `directConnection=true`.
5. [ ] Add server tests for bulk endpoints:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.archive.test.ts`
     - `server/src/test/integration/conversations.create.test.ts`
     - Add new test file if cleaner (document in `projectStructure.md`).
   - Requirements:
     - Success: archive/restore/delete returns `{ status:"ok", updatedCount }`.
     - Failure: invalid/mixed states return `409 BATCH_CONFLICT` with `details`.
6. [ ] Update `design.md` with bulk endpoint behavior and guardrail notes.
7. [ ] Update `projectStructure.md` for any new files.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in during implementation)

---

### 3. WebSocket server foundation

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Introduce the `/ws` WebSocket server on the existing Express port with protocol versioning, ping/pong heartbeats, and subscription tracking for sidebar and conversation streams.

#### Documentation Locations

- `ws` server docs: https://github.com/websockets/ws/blob/master/doc/ws.md
- Node.js HTTP server upgrade: https://nodejs.org/api/http.html#event-upgrade
- WebSocket protocol basics: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Review server startup and existing route wiring:
   - Docs to read:
     - https://nodejs.org/api/http.html#event-upgrade
   - Files to read:
     - `server/src/index.ts`
2. [ ] Add WebSocket library dependency to the server workspace:
   - Docs to read:
     - https://github.com/websockets/ws/blob/master/doc/ws.md
   - Files to edit:
     - `server/package.json`
     - `package-lock.json`
   - Requirements:
     - Add `ws` as a runtime dependency for the server.
3. [ ] Add WebSocket server scaffolding with heartbeat:
   - Docs to read:
     - https://github.com/websockets/ws/blob/master/doc/ws.md
   - Files to edit:
     - Create `server/src/ws/server.ts`
     - Update `server/src/index.ts`
   - Requirements:
     - `/ws` endpoint on existing server/port.
     - Ping every 30s; drop after 2 missed pongs.
     - No auth/CSRF/origin checks in this story.
4. [ ] Add subscription registry + protocol version enforcement:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to edit:
     - Create `server/src/ws/registry.ts`
     - Create `server/src/ws/types.ts`
   - Requirements:
     - Track `subscribe_sidebar`, `unsubscribe_sidebar`, `subscribe_conversation`, `unsubscribe_conversation`.
     - Require `protocolVersion: "v1"` in all messages/events.
5. [ ] Add sidebar stream publishing primitives (event typing + sequencing):
   - Docs to read:
     - https://github.com/websockets/ws/blob/master/doc/ws.md
   - Files to read:
     - `server/src/logStore.ts` (existing EventEmitter + subscribe/unsubscribe pattern to mirror)
   - Files to edit:
     - `server/src/ws/server.ts`
     - `server/src/ws/registry.ts`
     - `server/src/ws/types.ts`
     - Create `server/src/ws/sidebar.ts` (or equivalent module)
     - Create `server/src/mongo/events.ts` (conversation upsert/delete event bus)
   - Requirements:
     - Maintain a monotonically increasing `seq` for sidebar events.
     - Broadcast `conversation_upsert` / `conversation_delete` to `subscribe_sidebar` sockets.
     - Keep `sidebar_snapshot` optional (REST list fetch remains primary).
     - Avoid circular dependencies by routing persistence-triggered updates through `server/src/mongo/events.ts` (repo emits → WS sidebar subscribes).
     - Mirror the `logStore` API shape (`subscribe(handler)` returning an unsubscribe function) to keep the pub-sub approach consistent across the server.
6. [ ] Add lightweight unit tests for WS connection + subscribe/unsubscribe parsing:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/unit/ws-server.test.ts`
7. [ ] Update `projectStructure.md` for new WS files.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in during implementation)

---

### 4. Chat WebSocket streaming publisher

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Refactor chat execution so `POST /chat` is a non-streaming start request, then publish all chat deltas/tool events/finals over WebSockets using an in-flight registry and per-conversation run lock. Remove chat SSE from the server.

#### Documentation Locations

- `ws` server docs: https://github.com/websockets/ws/blob/master/doc/ws.md
- Node.js `AbortController`: https://nodejs.org/api/globals.html#class-abortcontroller
- Express 5 request lifecycle: Context7 `/expressjs/express`
- HTTP 202 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
- HTTP 409 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
- Mongoose: Context7 `/websites/mongoosejs`

#### Subtasks

1. [ ] Review current chat SSE flow and interfaces:
   - Docs to read:
     - Context7 `/expressjs/express`
   - Files to read:
     - `server/src/routes/chat.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
2. [ ] Add a per-conversation run lock for chat (reuse existing lock):
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to read/edit:
     - `server/src/agents/runLock.ts`
     - `server/src/routes/chat.ts`
   - Requirements:
     - Reuse `tryAcquireConversationLock` / `releaseConversationLock` so Chat + Agents share the same lock semantics.
     - Return `RUN_IN_PROGRESS` when a conversation already has an in-flight run.
3. [ ] Implement in-flight registry + WS publishing:
   - Docs to read:
     - https://github.com/websockets/ws/blob/master/doc/ws.md
   - Files to edit:
     - Create `server/src/chat/inflightRegistry.ts`
     - Update `server/src/ws/server.ts` (publish helpers)
   - Requirements:
     - Maintain `inflightId`, assistant text so far, tool event history, and seq counters.
     - Publish `inflight_snapshot`, `assistant_delta`, `tool_event`, `turn_final` with `protocolVersion:"v1"`.
     - WS tool events must preserve the existing client rendering schema (`callId`, `name`, `parameters`, `result`, `stage`, `errorTrimmed`, `errorFull`).
     - Ensure `turn_final.threadId` is sent when available (Codex), and ensure `conversation_upsert.flags.threadId` is updated for continuity in degraded/memory persistence modes.
     - Ensure the sidebar updates in real time for other tabs/windows by emitting `conversation_upsert` when a run starts and when turns are persisted (so ordering by `lastMessageAt` refreshes without polling).
     - Prefer emitting sidebar updates from shared persistence points (for example `createConversation` / `appendTurn`) so agent/MCP-initiated runs also generate `conversation_upsert` events.
     - Implement this by emitting from the repo layer into `server/src/mongo/events.ts` (and have the WS sidebar layer translate those into `conversation_upsert` / `conversation_delete` payloads).
4. [ ] Refactor `POST /chat` to be non-streaming:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/routes/chatValidators.ts`
   - Requirements:
     - Return `{ status:"started", conversationId, inflightId, provider, model }`.
     - Start provider execution in the background and publish WS events.
     - Accept optional `inflightId` in the request body; generate one when omitted and echo it in the 202 response.
     - Remove SSE response handling entirely.
5. [ ] Add `cancel_inflight` handling:
   - Docs to read:
     - https://nodejs.org/api/globals.html#class-abortcontroller
   - Files to edit:
     - `server/src/ws/server.ts`
     - `server/src/chat/inflightRegistry.ts`
   - Requirements:
     - Abort provider execution for the matching `conversationId` + `inflightId`.
     - Return `turn_final` with `status:"failed"` and `error.code="INFLIGHT_NOT_FOUND"` when invalid.
6. [ ] Add server log events for WS streaming (per the plan logging contract).
7. [ ] Update `design.md` to reflect WS-only chat streaming and start-run flow.
8. [ ] Update `projectStructure.md` for new files.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in during implementation)

---

### 5. Server test updates for chat WebSockets

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Replace SSE-based chat tests with WebSocket-driven coverage, including `POST /chat` start responses, run-lock conflicts, and WS event sequencing.

#### Documentation Locations

- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- SuperTest: Context7 `/ladjs/supertest`
- `ws` client docs: https://github.com/websockets/ws/blob/master/doc/ws.md
- Cucumber guides: https://cucumber.io/docs/guides/
- Playwright (for later e2e references only): Context7 `/microsoft/playwright`

#### Subtasks

1. [ ] Update/replace Cucumber chat streaming scenarios:
   - Docs to read:
     - https://cucumber.io/docs/guides/
   - Files to edit:
     - `server/src/test/features/chat_stream.feature`
     - `server/src/test/steps/chat_stream.steps.ts`
   - Requirements:
     - Replace SSE assumptions with `POST /chat` start + WS event assertions.
2. [ ] Update Cucumber cancellation semantics (unsubscribe does not cancel; Stop does):
   - Docs to read:
     - https://cucumber.io/docs/guides/
   - Files to edit:
     - `server/src/test/features/chat_cancellation.feature`
     - `server/src/test/steps/chat_cancellation.steps.ts`
   - Requirements:
     - Remove SSE/disconnect-aborts-run assumptions.
     - Assert that `cancel_inflight` is required to stop a run (and that leaving/unsubscribing alone does not stop it).
3. [ ] Add unit/integration coverage for `/chat` start responses and `RUN_IN_PROGRESS`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/chat-unsupported-provider.test.ts`
     - `server/src/test/integration/chat-codex.test.ts`
     - `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`
4. [ ] Add WS event ordering tests:
   - Docs to read:
     - https://github.com/websockets/ws/blob/master/doc/ws.md
   - Files to add/edit:
     - `server/src/test/unit/ws-chat-stream.test.ts`
5. [ ] Update `projectStructure.md` for any new test files.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in during implementation)

---

### 6. Chat sidebar bulk actions UI

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Add the 3-state conversation filter, multi-select checkboxes, and bulk archive/restore/delete controls in the Chat sidebar, wired to the new bulk endpoints and persistence guards.

#### Documentation Locations

- MUI MCP: `@mui/material@6.4.12` (List, Checkbox, Button, Dialog, Select)
- React 19 docs: https://react.dev/learn
- HTTP status codes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status

#### Subtasks

1. [ ] Review current Chat sidebar implementation and conversation hooks:
   - Docs to read:
     - https://react.dev/learn
   - Files to read:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
     - `client/src/hooks/usePersistenceStatus.ts`
     - `client/src/components/ingest/RootsTable.tsx` (reuse multi-select + bulk action selection pattern)
2. [ ] Add filter UI (`Active`, `Active & Archived`, `Archived`) and clear selection on filter change:
   - Docs to read:
     - MUI MCP: `@mui/material@6.4.12`
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
3. [ ] Add multi-select checkboxes and bulk actions:
   - Docs to read:
     - MUI MCP: `@mui/material@6.4.12`
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
   - Requirements:
     - Bulk archive/restore/delete buttons and confirmation dialog for delete.
     - Reuse the `RootsTable` Set-based selection pattern (selected ids as `Set<string>`, indeterminate select-all logic, busy/disabled handling) rather than inventing a new approach.
     - There is no existing confirm dialog utility in the client today; implement the delete confirmation as a small local MUI `Dialog` next to the bulk controls.
     - Disable bulk actions when `mongoConnected === false`.
     - Show a toast (or equivalent lightweight feedback) confirming success/failure for bulk actions.
     - Implement toast feedback using MUI Snackbar (no existing toast utility in the client today).
     - Ensure `variant="agents"` rendering remains unchanged (bulk controls are Chat-only).
     - Keep checkbox selection stable while sidebar items reorder due to `lastMessageAt` changes.
     - If the currently open conversation is bulk archived/restored/deleted, do not force-refresh the transcript mid-view (already-rendered content stays visible until the user navigates away or selects another conversation).
4. [ ] Wire bulk API calls and error handling:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Files to edit:
     - `client/src/hooks/useConversations.ts`
     - `client/src/api/agents.ts` (if shared helpers are added)
5. [ ] Update `design.md` with the sidebar bulk action UX.
6. [ ] Update `projectStructure.md` if any new UI modules are added.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] Defer client tests to Task 9 (front-end test updates).

#### Implementation notes

- (fill in during implementation)

---

### 7. Chat WebSocket client streaming

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Replace the chat SSE client with a WebSocket-based streaming client that subscribes per conversation, merges in-flight snapshots, and drives the transcript for the visible conversation only.

#### Documentation Locations

- WebSocket API (browser): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React 19 docs: https://react.dev/learn
- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API

#### Subtasks

1. [ ] Review current chat streaming hook and page wiring:
   - Docs to read:
     - https://react.dev/learn
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
2. [ ] Add WS client hook and connection lifecycle:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - Create `client/src/hooks/useChatWs.ts`
     - Update `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Protocol version `v1` on all messages.
     - Subscribe/unsubscribe on conversation change and route unmount.
     - Reconnect with backoff and re-snapshot on reconnect.
3. [ ] Add sidebar WS subscription and live list updates:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useConversations.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts` (if the WS connection is shared)
   - Requirements:
     - `subscribe_sidebar` while Chat page is mounted; apply `conversation_upsert` / `conversation_delete` to the list state.
     - Preserve multi-select checkbox state while applying live updates (selection is keyed by conversationId and must not be cleared by background updates).
     - Ensure live sidebar updates do not require manual refresh to see newly created/archived/restored/deleted conversations from other tabs.
     - Ignore sidebar events that do not match the current list filter (Chat list uses `agentName=__none__`, so it must ignore `conversation_upsert` with a non-empty `agentName`).
4. [ ] Replace SSE start-run flow with `POST /chat` start + WS stream:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Handle `RUN_IN_PROGRESS` conflicts.
     - Use `cancel_inflight` for Stop.
     - Do not cancel runs on route unmount or conversation switch; unmount/switch only unsubscribes from WS updates (run continues until Stop/cancel).
5. [ ] Ensure MCP/agent-initiated runs render via WS the same as REST.
6. [ ] Update `design.md` for client-side WS flow.
7. [ ] Update `projectStructure.md` for new hooks.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] Defer client tests to Task 9 (front-end test updates).

#### Implementation notes

- (fill in during implementation)

---

### 8. Client streaming logs

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Emit client-side log entries for WebSocket connect/subscribe/receive events and forward them to server logs for Playwright verification.

#### Documentation Locations

- WebSocket API (browser): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Console API (for local debugging only): https://developer.mozilla.org/en-US/docs/Web/API/console

#### Subtasks

1. [ ] Review existing client logging utilities:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/console
   - Files to read:
     - `client/src/logging/logger.ts`
     - `client/src/logging/transport.ts`
2. [ ] Add WS streaming log events with throttling:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/logging/logger.ts`
   - Requirements:
     - Log names per plan (client_* events).
     - Delta throttling: first + every 25 deltas with `deltaCount`.
3. [ ] Ensure logs are forwarded to `/logs` and include `conversationId`, `inflightId`, and `seq` when applicable.
4. [ ] Update `projectStructure.md` if any logging files change.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] Defer client tests to Task 9 (front-end test updates).

#### Implementation notes

- (fill in during implementation)

---

### 9. Front-end test updates

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Update Jest/RTL coverage and e2e specs for the new chat WebSocket flow, bulk actions UI, and streaming log assertions.

#### Documentation Locations

- Jest: Context7 `/jestjs/jest`
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Playwright: Context7 `/microsoft/playwright`
- WebSocket API (browser): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

#### Subtasks

1. [ ] Update client unit tests for chat streaming and Stop behavior:
   - Docs to read:
     - Context7 `/jestjs/jest`
     - https://testing-library.com/docs/react-testing-library/intro/
   - Files to edit:
     - `client/src/test/chatPage.stop.test.tsx`
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/chatPage.newConversation.test.tsx`
     - `client/src/test/chatPage.reasoning.test.tsx` (if WS changes affect reasoning UI)
     - Add new `client/src/test/useChatWs.test.ts` (or similar) if needed for WS hook coverage
2. [ ] Add/adjust tests for sidebar bulk actions:
   - Docs to read:
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
     - `client/src/test/chatPersistenceBanner.test.tsx`
3. [ ] Update Playwright e2e coverage to assert `/logs` contains WS stream markers:
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Files to edit:
     - `e2e/chat.spec.ts`
     - `e2e/chat-tools.spec.ts`
     - `e2e/chat-tools-visibility.spec.ts`
     - `e2e/chat-reasoning.spec.ts`
     - `e2e/chat-provider-history.spec.ts`
     - Add new `e2e/chat-ws-logs.spec.ts` if clearer.
   - Requirements:
     - Remove any remaining SSE-only test assumptions; chat streaming assertions must observe WS-driven transcript updates.
     - When `E2E_USE_MOCK_CHAT=true`, replace SSE route mocks with a WS mock:
       - Route `POST /chat` to return `202` JSON `{ status:"started", conversationId, inflightId, provider, model }`.
       - Use Playwright WebSocket routing (`page.routeWebSocket` / `context.routeWebSocket`) to handle `/ws` subscriptions and send `inflight_snapshot`/`assistant_delta`/`tool_event`/`turn_final`.
     - Audit remaining `e2e/chat-*.spec.ts` files (including `e2e/chat-codex-*.spec.ts`) and update any that depend on SSE streaming behavior.
4. [ ] Update `projectStructure.md` for any new test files.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run e2e`

#### Implementation notes

- (fill in during implementation)

---

### 10. Final verification

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Final cross-check against acceptance criteria, full builds/tests, docker validation, and documentation updates. Produce a pull request summary comment covering all story changes.

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
4. [ ] Ensure `README.md` is updated with any new commands or behavioral changes
5. [ ] Ensure `design.md` is updated with any new diagrams or architecture changes
6. [ ] Ensure `projectStructure.md` is updated with any updated/added/removed files
7. [ ] Create a summary of all changes and produce a pull request comment

#### Testing

1. [ ] run the client jest tests
2. [ ] run the server cucumber tests
3. [ ] restart the docker environment
4. [ ] run the e2e tests
5. [ ] use the playwright mcp tool to manually verify the application and save screenshots to `./test-results/screenshots/`

#### Implementation notes

- (fill in during implementation)
