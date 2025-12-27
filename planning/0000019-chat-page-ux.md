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

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Extend `GET /conversations` to support a 3-state filter (`active`, `archived`, `all`) while preserving backward compatibility for the existing `archived=true` query. This powers the new sidebar filter and keeps existing callers stable.

#### Documentation Locations

- Express 5 query parsing + routing: Context7 `/expressjs/express/v5.1.0`
- Mongoose query filters: Context7 `/automattic/mongoose/9.0.1`
- HTTP 400 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
- URLSearchParams / query strings: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- SuperTest: Context7 `/ladjs/supertest`
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Read the current conversations list route and repo query implementation (do not assume filter behavior):
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0`
     - Context7 `/automattic/mongoose/9.0.1`
     - https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Files to read:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/conversation.ts`

2. [ ] Add the new 3-state list filter query (`state=active|archived|all`) with backward compatibility:
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

3. [ ] Update server integration tests for list filtering (prove the API contract is stable):
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Required test cases:
     - `state=active`, `state=archived`, `state=all`
     - `archived=true` backward compatibility
     - Invalid `state` returns 400

4. [ ] Update docs so the contract is discoverable (a junior dev should not need to infer it from code):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid` (only if adding diagrams)
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a short bullet describing the new `state` query and default behavior.

5. [ ] Update project documentation if new files were introduced by this task:
   - Docs to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add any new files introduced by this task (if none, mark this subtask complete with “no changes”).

6. [ ] Run repo-wide lint/format checks after the task (do not skip):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server to ensure types and imports still compile:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `server/package.json` (build script)
   - Command to run:
     - `npm run build --workspace server`

2. [ ] Run server tests to ensure filtering is covered:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to verify:
     - `server/src/test/integration/conversations.list.test.ts`
   - Command to run:
     - `npm run test --workspace server`

#### Implementation notes

- (fill in during implementation)

---

### 2. Conversation bulk endpoints

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Add bulk archive/restore/delete endpoints with strong validation and archived-only delete guardrails (validate-first + idempotent writes; no transaction requirement in v1).

#### Documentation Locations

- Express 5 routing/request lifecycle: Context7 `/expressjs/express/v5.1.0`
- Mongoose bulk updates/deletes: Context7 `/automattic/mongoose/9.0.1`
- HTTP 409 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- SuperTest: Context7 `/ladjs/supertest`
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Read the existing conversation archive/restore/delete plumbing:
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0`
     - Context7 `/automattic/mongoose/9.0.1`
   - Files to read:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/turn.ts`

2. [ ] Add bulk endpoints and request validation:
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

3. [ ] Implement repo-layer bulk operations without transactions (validate-first + idempotent writes):
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

4. [ ] Add server tests for bulk endpoints:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/integration/conversations.archive.test.ts`
     - `server/src/test/integration/conversations.create.test.ts`
     - Add new test file if cleaner (document in `projectStructure.md`).

5. [ ] Update design documentation describing the new endpoints and guardrails:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid` (only if adding diagrams)
   - Files to edit:
     - `design.md`

6. [ ] Update project documentation for any added/changed files:
   - Docs to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`

7. [ ] Run repo-wide lint/format checks after the task (do not skip):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
   - Files to verify:
     - `package.json` (root scripts)
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `server/package.json` (build script)
   - Command to run:
     - `npm run build --workspace server`

2. [ ] Run server tests (including the new bulk endpoint tests):
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to verify:
     - `server/src/test/integration/*`
   - Command to run:
     - `npm run test --workspace server`

#### Implementation notes

- (fill in during implementation)

---

### 3. WebSocket server foundation

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Introduce the `/ws` WebSocket server on the existing Express port with protocol versioning, ping/pong heartbeats, and subscription tracking for sidebar and conversation streams.

#### Documentation Locations

- `ws` server docs: https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
- Node.js HTTP server upgrade: https://nodejs.org/api/http.html#event-upgrade
- `ws` (server): Context7 `/websockets/ws/8_18_3`
- WebSocket protocol basics: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Confirm where the HTTP server is created and how to attach WebSocket upgrade handling:
   - Docs to read:
     - https://nodejs.org/api/http.html#event-upgrade
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to read:
     - `server/src/index.ts`
   - Requirements:
     - Identify the exact place where `app.listen(...)` is called so it can be replaced with an explicit Node `http` server (needed to listen for the `upgrade` event).

2. [ ] Add `ws` as a server runtime dependency (do not rely on transitive lockfile deps):
   - Docs to read:
     - Context7 `/websockets/ws/8_18_3`
   - Commands to run:
     - `npm install --workspace server ws`
   - Files to verify:
     - `server/package.json` (should list `ws` under `dependencies`)
     - `package-lock.json` (should include `node_modules/ws`)

3. [ ] Create a minimal `/ws` server module and wire it into the Node HTTP server upgrade flow:
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

4. [ ] Define WS protocol types and JSON shapes in one place so client/tests can mirror them:
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

5. [ ] Implement subscription tracking (registry) with explicit data structures:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - Create `server/src/ws/registry.ts`
   - Requirements:
     - Track which sockets have sidebar subscription enabled.
     - Track which sockets are subscribed to which `conversationId`.
     - Provide helpers like `subscribeSidebar(ws)`, `unsubscribeSidebar(ws)`, `subscribeConversation(ws, id)` etc.

6. [ ] Implement sidebar publisher wiring (repo events bus → WS broadcast) with explicit event payloads:
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

7. [ ] Add unit tests proving the WS server accepts connections and enforces protocolVersion:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websockets/ws/8_18_3`
   - Files to add/edit:
     - `server/src/test/unit/ws-server.test.ts`
   - Test sketch:
     ```ts
     // connect with ws client, send invalid protocolVersion, assert server closes or ignores
     ```

8. [ ] Update docs and run verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to edit:
     - `projectStructure.md`
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (WS wiring often breaks type imports):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `server/src/index.ts`
   - Command to run:
     - `npm run build --workspace server`

2. [ ] Run server tests (ensure the new WS unit test passes):
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to verify:
     - `server/src/test/unit/ws-server.test.ts`
   - Command to run:
     - `npm run test --workspace server`

#### Implementation notes

- (fill in during implementation)

---

### 4. Chat WebSocket streaming publisher

- Task Status: **__to_do__**
- Git Commits: **to_do**
#### Overview

Refactor chat execution so `POST /chat` is a non-streaming start request, then publish all chat deltas/tool events/finals over WebSockets using an in-flight registry and per-conversation run lock. Remove chat SSE from the server.

#### Documentation Locations

- `ws` server docs: https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
- Node.js `AbortController`: https://nodejs.org/api/globals.html#class-abortcontroller
- Express 5 request lifecycle: Context7 `/expressjs/express/v5.1.0`
- HTTP 202 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
- HTTP 409 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
- Mongoose: Context7 `/automattic/mongoose/9.0.1`

#### Subtasks

1. [ ] Locate the current chat SSE implementation and identify which parts must change to “start-run + WS stream”:
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/routes/chat.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Requirements:
     - Identify where `/chat` currently sets `Content-Type: text/event-stream` and writes SSE frames.

2. [ ] Enforce one in-flight run per conversation by reusing the existing shared run lock:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to read/edit:
     - `server/src/agents/runLock.ts`
     - `server/src/routes/chat.ts`
   - Required error response (example):
     ```json
     { "status":"error", "code":"RUN_IN_PROGRESS", "message":"Conversation already has an active run." }
     ```

3. [ ] Implement an in-flight registry (single authoritative in-memory store for streaming state):
   - Docs to read:
     - https://nodejs.org/api/globals.html#class-abortcontroller
   - Files to edit:
     - Create `server/src/chat/inflightRegistry.ts`
   - Required state to track per `conversationId`:
     - `inflightId`
     - `assistantText` (so late subscribers can catch up)
     - `toolEvents` (so late subscribers see interim tool progress)
     - `startedAt` (ISO string)
     - `abortController`
     - `seq` counter (monotonic, per conversation)

4. [ ] Define exact transcript event payloads for WS publishing and implement publisher helpers:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - `server/src/ws/server.ts`
   - Required outbound transcript events (examples):
     ```json
     { "protocolVersion":"v1", "type":"inflight_snapshot", "conversationId":"...", "seq": 1, "inflight": { "inflightId":"...", "assistantText":"", "toolEvents": [], "startedAt":"2025-01-01T00:00:00.000Z" } }
     ```
     ```json
     { "protocolVersion":"v1", "type":"assistant_delta", "conversationId":"...", "seq": 2, "inflightId":"...", "delta":"hello" }
     ```
     ```json
     { "protocolVersion":"v1", "type":"tool_event", "conversationId":"...", "seq": 3, "inflightId":"...", "event": { "type":"tool-request", "callId":"1", "name":"vector_search", "parameters": {} } }
     ```
     ```json
     { "protocolVersion":"v1", "type":"turn_final", "conversationId":"...", "seq": 4, "inflightId":"...", "status":"ok", "threadId": null }
     ```

5. [ ] Bridge provider-emitted events (`ChatInterface` events) into the in-flight registry and publisher:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/chat/inflightRegistry.ts`
   - Requirements:
     - On first token/tool event, begin publishing to any subscribed clients.
     - Always publish `turn_final` exactly once at completion (ok/stopped/failed).

6. [ ] Refactor `POST /chat` to be non-streaming (start only) and return a `202` JSON acknowledgement:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/routes/chatValidators.ts`
   - Required success response (example):
     ```json
     { "status":"started", "conversationId":"...", "inflightId":"...", "provider":"codex", "model":"gpt-5.1-codex-max" }
     ```
   - Requirements:
     - The run must execute in the background (do not block the HTTP response).
     - The run must continue even if the browser navigates away or unsubscribes.

7. [ ] Implement WS inbound `cancel_inflight` handling and map it to provider abortion:
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

8. [ ] Ensure threadId continuity (Codex) is reflected in WS final events and sidebar upserts:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/mongo/repo.ts` (ensure flags updated on persist)
   - Requirements:
     - `turn_final.threadId` must be sent when available.
     - `conversation_upsert.conversation.flags.threadId` must be updated so new tabs can continue a thread.

9. [ ] Ensure sidebar updates are emitted from persistence (repo) so they apply to Chat + Agents + MCP runs:
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/mongo/events.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/ws/sidebar.ts`

10. [ ] Remove chat SSE response handling (but keep `/logs/stream` SSE untouched):
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/chatStream.ts` (only if it becomes unused by chat)
   - Requirements:
     - After this story, chat must not depend on SSE anywhere in client or server code.

11. [ ] Add server-side WS + streaming logs (explicit names and throttling):
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

12. [ ] Update docs and run verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to edit:
     - `design.md`
     - `projectStructure.md`
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (chat route refactors are high-risk):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `server/src/routes/chat.ts`
   - Command to run:
     - `npm run build --workspace server`

2. [ ] Run server tests (expect chat tests to fail until Task 5 is completed):
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to verify:
     - `server/src/test/features/*`
   - Command to run:
     - `npm run test --workspace server`
   - Note:
     - If chat Cucumber steps fail due to transport changes, proceed to Task 5 to update them.

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
- `ws` client docs: https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
- Cucumber guides: https://cucumber.io/docs/guides/
- Playwright (for later e2e references only): Context7 `/microsoft/playwright.dev`

#### Subtasks

1. [ ] Identify exactly which server tests currently assume chat SSE streaming:
   - Docs to read:
     - https://cucumber.io/docs/guides/
   - Files to read:
     - `server/src/test/features/chat_stream.feature`
     - `server/src/test/steps/chat_stream.steps.ts`
     - `server/src/test/features/chat_cancellation.feature`
     - `server/src/test/steps/chat_cancellation.steps.ts`
   - Requirements:
     - Write down which steps parse SSE frames vs which steps just assert final persisted turns.

2. [ ] Update the chat streaming feature description to match the new transport contract:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202
   - Files to edit:
     - `server/src/test/features/chat_stream.feature`
   - Required contract text (must be reflected in scenarios):
     - HTTP: `POST /chat` returns `202` JSON `{ status:"started", conversationId, inflightId, provider, model }`.
     - Streaming: tokens/tool events/final arrive via `/ws` transcript events.

3. [ ] Add a reusable WS test client helper for server-side tests (so step defs do not re-implement WS parsing):
   - Docs to read:
     - Context7 `/websockets/ws/8_18_3`
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to add/edit:
     - Add `server/src/test/support/wsClient.ts` (or similar)
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

4. [ ] Rewrite chat streaming step defs to use `POST /chat` and WS events:
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - `server/src/test/steps/chat_stream.steps.ts`
   - Requirements:
     - Start the run via HTTP and assert the `202` JSON body shape.
     - Subscribe via WS and assert at least one transcript event arrives and a `turn_final` arrives.
     - Do not attempt detailed `seq` ordering checks in Cucumber (those are validated in node:test).

5. [ ] Rewrite cancellation feature to match “unsubscribe does not cancel; cancel_inflight cancels”:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to edit:
     - `server/src/test/features/chat_cancellation.feature`
   - Requirements:
     - Remove any assumption that aborting an HTTP request cancels generation.
     - Ensure the scenario asserts `cancel_inflight` is required.

6. [ ] Rewrite cancellation step defs to send `cancel_inflight` and assert the final status:
   - Docs to read:
     - https://github.com/websockets/ws/blob/8.18.3/doc/ws.md
   - Files to edit:
     - `server/src/test/steps/chat_cancellation.steps.ts`
   - Required cancel message (example):
     ```json
     { "protocolVersion":"v1", "requestId":"<uuid>", "type":"cancel_inflight", "conversationId":"...", "inflightId":"..." }
     ```

7. [ ] Update node:test coverage for `/chat` responses so it is transport-accurate:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/chat-unsupported-provider.test.ts`
     - `server/src/test/integration/chat-codex.test.ts`
     - `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`
   - Requirements:
     - Assert `POST /chat` returns `202` JSON, not `text/event-stream`.
     - Assert conflict errors are `409` with `code:"RUN_IN_PROGRESS"`.

8. [ ] Add focused node:test coverage for transcript `seq` ordering and stale-event ignoring:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/unit/ws-chat-stream.test.ts`
   - Requirements:
     - Use the WS test client helper to subscribe to a conversation and verify `seq` increases monotonically for a single stream.

9. [ ] Ensure WS connections are closed during teardown so test runs do not leak handles:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/support/*`
   - Requirements:
     - Explicitly close sockets in `afterEach`/`after` hooks.

10. [ ] Update docs and run verification commands:
    - Docs to read:
      - https://docs.npmjs.com/cli/v10/commands/npm-run-script
    - Files to edit:
      - `projectStructure.md`
    - Commands to run:
      - `npm run lint --workspaces`
      - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `server/package.json`
   - Command to run:
     - `npm run build --workspace server`

2. [ ] Run all server tests (Cucumber + node:test):
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://cucumber.io/docs/guides/
   - Files to verify:
     - `server/src/test/features/*`
     - `server/src/test/integration/*`
   - Command to run:
     - `npm run test --workspace server`

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
- MUI v6.5.0 release notes: https://github.com/mui/material-ui/releases/tag/v6.5.0
- React 19 docs: https://react.dev/learn
- HTTP status codes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status

#### Subtasks

1. [ ] Review current Chat sidebar implementation and conversation hooks:
   - Docs to read:
     - https://react.dev/learn
     - MUI MCP: `@mui/material@6.4.12`
   - Files to read:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
     - `client/src/hooks/usePersistenceStatus.ts`
     - `client/src/components/ingest/RootsTable.tsx` (selection pattern to reuse)

2. [ ] Implement the 3-state filter UI only (no bulk controls yet):
   - Docs to read:
     - MUI MCP: `@mui/material@6.4.12`
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
   - Requirements:
     - Filter options map to `state=active|all|archived`.
     - Clear selection on filter change.

3. [ ] Add Set-based selection and per-row checkbox rendering:
   - Docs to read:
     - MUI MCP: `@mui/material@6.4.12` (Checkbox)
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
   - Requirements:
     - Use `Set<string>` selection like `RootsTable`.
     - Selection must not be reset by list reordering.

4. [ ] Add select-all checkbox + bulk toolbar UI (buttons can be disabled until wiring is complete):
   - Docs to read:
     - MUI MCP: `@mui/material@6.4.12`
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`

5. [ ] Implement delete confirmation dialog:
   - Docs to read:
     - MUI MCP: `@mui/material@6.4.12` (Dialog)
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`

6. [ ] Implement Snackbar success/failure toasts:
   - Docs to read:
     - MUI MCP: `@mui/material@6.4.12` (Snackbar)
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`

7. [ ] Disable bulk actions when `mongoConnected === false` and show a clear message:
   - Docs to read:
     - https://react.dev/learn
   - Files to edit:
     - `client/src/hooks/usePersistenceStatus.ts`
     - `client/src/components/chat/ConversationList.tsx`

8. [ ] Wire bulk API calls into `useConversations`:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Files to edit:
     - `client/src/hooks/useConversations.ts`

9. [ ] Validate edge cases:
   - Docs to read:
     - https://react.dev/learn
   - Files to verify:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Do not force-refresh transcript mid-view if selected conversation changes state.

10. [ ] Update `design.md` with the sidebar bulk action UX:
    - Docs to read:
      - Context7 `/mermaid-js/mermaid` (only if adding diagrams)
    - Files to edit:
      - `design.md`

11. [ ] Update `projectStructure.md` if any new UI modules are added:
    - Docs to read:
      - `projectStructure.md`
    - Files to edit:
      - `projectStructure.md`

12. [ ] Run repo-wide lint/format checks:
    - Docs to read:
      - https://docs.npmjs.com/cli/v10/commands/npm-run-script
    - Files to verify:
      - `package.json`
    - Commands to run:
      - `npm run lint --workspaces`
      - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the client so TypeScript + bundling errors are caught immediately:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `client/package.json`
   - Command to run:
     - `npm run build --workspace client`

2. [ ] Defer Jest + e2e test updates to Task 9 (do not attempt to update all mocks in this UI task):
   - Docs to read:
     - Context7 `/jestjs/jest`
     - Context7 `/microsoft/playwright.dev`
   - Files to verify:
     - `planning/0000019-chat-page-ux.md` (Task 9 scope)

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

1. [ ] Read the current SSE-based client streaming code so you understand what must be replaced:
   - Docs to read:
     - https://react.dev/learn
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`

2. [ ] Create a WS hook that owns the connection and JSON codec (no shared WS abstraction exists yet):
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

3. [ ] Add explicit connection lifecycle + reconnect/backoff logic:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
   - Requirements:
     - Use a simple backoff (e.g., 250ms → 500ms → 1000ms → 2000ms max) and reconnect automatically.
     - On reconnect, re-send active subscriptions (sidebar + current conversation) after refreshing the sidebar list snapshot via REST.

4. [ ] Implement transcript subscribe/unsubscribe tied to “currently visible conversation only”:
   - Docs to read:
     - https://react.dev/learn
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - When the user switches conversations, unsubscribe from the old conversation stream and subscribe to the new one.
     - Unsubscribing must NOT cancel the run (it only stops local viewing).

5. [ ] Apply WS transcript events to the UI state (snapshot → deltas/tool events → final):
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
     - Cache the latest `inflightId` for Stop.
     - Render tool events using the existing UI expectations (tool-request/tool-result shapes).

6. [ ] Add sidebar WS subscription (Chat page only) and merge `conversation_upsert` / `conversation_delete` into list state:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useConversations.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts` (if the WS connection is shared)
   - Requirements:
     - Keep checkbox selection stable during list resorting (selection keyed by `conversationId`).
     - Filter out sidebar events with a non-empty `agentName` (Chat list is `agentName=__none__`).

7. [ ] Replace the SSE run-start logic with a `POST /chat` start request (no streaming) + WS transcript updates:
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

8. [ ] Implement Stop using WS `cancel_inflight` (no fetch abort):
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/pages/ChatPage.tsx`
   - Required cancel message example:
     ```json
     { "protocolVersion":"v1", "requestId":"<uuid>", "type":"cancel_inflight", "conversationId":"...", "inflightId":"..." }
     ```

9. [ ] Enforce the “mongoConnected === false” behaviour explicitly (this is easy to miss):
   - Docs to read:
     - https://react.dev/learn
   - Files to edit:
     - `client/src/hooks/usePersistenceStatus.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatWs.ts`
   - Requirements:
     - When persistence is unavailable, disable live streaming (do not connect/subscribe) and show a clear banner/message explaining why.
     - The user must still be able to Stop an in-flight run (if they have `conversationId` + `inflightId`).

10. [ ] Update docs and run verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to edit:
     - `design.md`
     - `projectStructure.md`
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the client:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `client/src/hooks/useChatWs.ts`
   - Command to run:
     - `npm run build --workspace client`

2. [ ] Defer Jest + Playwright test rewrites to Task 9 (WS mocking touches many files):
   - Docs to read:
     - Context7 `/jestjs/jest`
     - Context7 `/microsoft/playwright.dev`
   - Files to verify:
     - `planning/0000019-chat-page-ux.md` (Task 9 scope)

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

4. [ ] Update docs and run verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to edit:
     - `projectStructure.md`
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the client:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `client/src/logging/logger.ts`
     - `client/src/hooks/useChatWs.ts`
   - Command to run:
     - `npm run build --workspace client`

2. [ ] Defer log assertions and WS-mocked e2e changes to Task 9:
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to verify:
     - `planning/0000019-chat-page-ux.md` (Task 9 scope)

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
- Playwright: Context7 `/microsoft/playwright.dev`
- WebSocket API (browser): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

#### Subtasks

1. [ ] Create WS mocking helpers so tests do not re-implement subscriptions and event emission:
   - Docs to read:
     - Context7 `/microsoft/playwright.dev` (routeWebSocket)
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to add/edit:
     - Add `e2e/support/mockChatWs.ts` (or similar)
     - Add `client/src/test/support/mockWebSocket.ts` (or similar)
   - Requirements:
     - The helper must be able to send deterministic sequences of events (`seq` increments) to the client.

2. [ ] Update common fixtures so both Jest and Playwright can reuse the same WS event examples:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to edit:
     - `common/src/fixtures/chatStream.ts`
   - Requirements:
     - Export WS-shaped fixtures for: `inflight_snapshot`, `assistant_delta`, `tool_event`, `turn_final`.
     - Keep existing exports that other tests rely on, or update import sites in the same subtask.

3. [ ] Add unit tests for the WS hook itself (it is new behavior and easy to break):
   - Docs to read:
     - Context7 `/jestjs/jest`
     - https://testing-library.com/docs/react-testing-library/intro/
   - Files to add/edit:
     - Add `client/src/test/useChatWs.test.ts` (or similar)
     - `client/src/hooks/useChatWs.ts` (as needed)

4. [ ] Update the chat page tests that assert streaming/stop/new-conversation semantics:
   - Docs to read:
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/chatPage.stop.test.tsx`
     - `client/src/test/chatPage.newConversation.test.tsx`
   - Requirements:
     - Replace fetch-abort expectations with WS `cancel_inflight` expectations.
     - Ensure tests assert “navigate away does not cancel run”.

5. [ ] Update all remaining chat page tests that depend on streaming state:
   - Docs to read:
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/useChatStream.reasoning.test.tsx`
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
     - `client/src/test/chatPage.citations.test.tsx`
     - `client/src/test/chatPage.toolDetails.test.tsx`
     - `client/src/test/chatPage.reasoning.test.tsx`
     - `client/src/test/chatPage.markdown.test.tsx`
     - `client/src/test/chatPage.mermaid.test.tsx`
     - `client/src/test/chatPage.noPaths.test.tsx`

6. [ ] Update provider/flags tests to reflect the new `POST /chat` 202 start-run contract:
   - Docs to read:
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/chatPage.provider.test.tsx`
     - `client/src/test/chatPage.provider.conversationSelection.test.tsx`
     - `client/src/test/chatPage.source.test.tsx`
     - `client/src/test/chatPage.models.test.tsx`
     - `client/src/test/chatPage.flags.*.test.tsx` (all of them)

7. [ ] Update bulk sidebar tests to account for selection + filter + new disabled states:
   - Docs to read:
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
     - `client/src/test/chatPersistenceBanner.test.tsx`

8. [ ] Update Playwright e2e mocks: replace SSE route fulfill with WS routing (keep `POST /chat` mocked as `202` JSON):
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to edit:
     - `e2e/chat.spec.ts`
     - `e2e/chat-tools.spec.ts`
     - `e2e/chat-tools-visibility.spec.ts`
     - `e2e/chat-reasoning.spec.ts`
     - `e2e/chat-provider-history.spec.ts`
     - `e2e/chat-mermaid.spec.ts`
     - `e2e/chat-codex-trust.spec.ts`
     - `e2e/chat-codex-reasoning.spec.ts`
     - `e2e/chat-codex-mcp.spec.ts`
   - Example Playwright WS routing sketch:
     ```ts
     await page.routeWebSocket("**/ws", ws => {
       ws.onMessage(msg => { /* parse subscribe_* and respond */ });
       // ws.send(JSON.stringify({ protocolVersion:"v1", type:"inflight_snapshot", ... }))
     });
     ```
   - Requirements:
     - Remove any remaining `contentType: text/event-stream` mocks for `/chat`.
     - Ensure e2e asserts streamed UI updates that originate from WS events.

9. [ ] Update docs and run verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to edit:
     - `projectStructure.md`
   - Commands to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the client:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `client/package.json`
   - Command to run:
     - `npm run build --workspace client`

2. [ ] Run client unit tests:
   - Docs to read:
     - Context7 `/jestjs/jest`
   - Files to verify:
     - `client/src/test/*`
   - Command to run:
     - `npm run test --workspace client`

3. [ ] Run Playwright e2e tests:
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to verify:
     - `playwright.config.ts`
     - `e2e/*`
   - Command to run:
     - `npm run e2e`

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
- Playwright: Context7 `/microsoft/playwright.dev`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `server/package.json`
   - Command to run:
     - `npm run build --workspace server`

2. [ ] Build the client:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Files to verify:
     - `client/package.json`
   - Command to run:
     - `npm run build --workspace client`

3. [ ] Perform a clean Docker build (ensures Compose flows still work):
   - Docs to read:
     - Context7 `/docker/docs`
   - Files to verify:
     - `docker-compose.yml`
     - `server/Dockerfile`
     - `client/Dockerfile`
   - Commands to run:
     - `docker compose build --no-cache`

4. [ ] Update `README.md` with any new commands or behavioral changes:
   - Docs to read:
     - `README.md`
   - Files to edit:
     - `README.md`

5. [ ] Update `design.md` with any new diagrams or architecture changes:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`

6. [ ] Update `projectStructure.md` with any updated/added/removed files:
   - Docs to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`

7. [ ] Create a PR summary comment (what changed, why, and how to verify):
   - Docs to read:
     - `planning/0000019-chat-page-ux.md`
   - Files to edit:
     - `planning/0000019-chat-page-ux.md` (Implementation notes section)

#### Testing

1. [ ] Run the client Jest tests:
   - Docs to read:
     - Context7 `/jestjs/jest`
   - Files to verify:
     - `client/src/test/*`
   - Command to run:
     - `npm run test --workspace client`

2. [ ] Run the server tests (node:test + Cucumber):
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://cucumber.io/docs/guides/
   - Files to verify:
     - `server/src/test/*`
   - Command to run:
     - `npm run test --workspace server`

3. [ ] Restart Docker environment and run e2e tests:
   - Docs to read:
     - Context7 `/docker/docs`
     - Context7 `/microsoft/playwright.dev`
   - Files to verify:
     - `docker-compose.yml`
     - `playwright.config.ts`
   - Commands to run:
     - `docker compose down -v`
     - `docker compose up --build -d`
     - `npm run e2e`

4. [ ] Manual verification with Playwright MCP and screenshots:
   - Docs to read:
     - Context7 `/microsoft/playwright.dev`
   - Files to verify:
     - `test-results/` (output folder exists and is writable)
   - Output location:
     - `./test-results/screenshots/`

#### Implementation notes

- (fill in during implementation)
