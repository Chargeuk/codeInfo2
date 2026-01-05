# Story 0000022 - Ingest WS streaming + full‑width layout

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):
- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today the ingest experience is inconsistent: when a user starts an ingest run, then navigates away and returns, the page does not reliably show the current run because progress is polled only after the user returns. In addition, the Ingest page layout is narrower than other pages, so the embedded roots table is clipped and horizontally scrolls, which is a poor UX.

We want the Ingest page to stream ingest progress over WebSockets so **any open browser tab** can immediately see the current ingest state when on `/ingest`, and we want the Ingest page layout to be full width to match the rest of the app.

The experience should mirror Chat/Agents: updates only flow while the page is mounted/subscribed, and a snapshot of the current ingest state is delivered on subscribe so the page is accurate immediately. There is **no polling fallback**; if WS is unavailable, the page shows an explicit error state. When there is no active run, only the roots list is shown (no “last run” summary).

---

## Acceptance Criteria

- **Live updates via WS only:** the Ingest page does **not** call `/ingest/status/:runId` on a timer. All progress updates come from WebSocket messages.
- **Snapshot on subscribe:** when a user opens `/ingest` (or the page re‑subscribes after a reconnect), the page receives an **ingest_snapshot** with the current state (or `status: null` if no run is active) and renders it immediately.
- **Page‑scoped updates:** only browser tabs that are currently on `/ingest` receive ingest updates; navigating away stops updates until the user returns.
- **WS unavailable = error:** if the WS connection cannot be established or drops, the page shows a clear error state (no polling fallback).
- **No “last run” summary:** when there is no active ingest, the “Active run” UI is hidden/empty; the page shows only the roots list.
- **Single global stream:** the subscription is **not** filtered by `runId`; all Ingest pages receive the same global ingest updates.
- **Full‑width layout:** the Ingest page uses a full‑width layout consistent with other pages (no centered/narrow container), and the embedded roots table no longer requires horizontal scrolling due to page width.

---

## Out Of Scope

- Changing ingest backend logic or persistence formats.
- Redesigning ingest UI beyond layout width and live progress updates.
- Adding new ingest features (filters, grouping, etc.).

---

## Questions

- None (discussion decisions captured below).

---

## Research Findings (code‑confirmed)

- WebSocket infrastructure already exists on `/ws` with subscription routing and seq handling; client hook `useChatWs` opens/closes the socket based on page mount and subscribes to specific channels. This is the desired behavior to mirror for ingest.
- Ingest progress is currently polled from `/ingest/status/:runId` in `client/src/hooks/useIngestStatus.ts`, which drives the `ActiveRunCard` UI.
- Ingest status is stored in memory in `server/src/ingest/ingestJob.ts` and exposed via `GET /ingest/status/:runId` in `server/src/routes/ingestStart.ts`. There is no existing ingest WebSocket broadcast or event bus; polling is the only live update path today.
- The Ingest page uses a MUI `Container` with default props (`maxWidth="lg"` by default), in `client/src/pages/IngestPage.tsx`. This is the root cause of the constrained width and table clipping.
- DeepWiki is not indexed for this repo (no DeepWiki data available yet).
- External confirmation: common WS server practice is to use ping/pong heartbeats, and browser WebSocket APIs do not expose ping/pong frames directly (so reconnection/heartbeat logic must be handled at the app level if needed).

---

## Scope Assessment

This story is well‑scoped for a single iteration: it focuses on two user‑visible problems (live ingest visibility across tabs and page width/layout) and reuses existing infra (shared `/ws` stack + existing ingest status model). The scope stays tightly bound to the Ingest page and does not require changes to ingest backend logic or data models.

**Scope boundaries (explicit)**
- **Will change:** Ingest progress delivery switches from polling to WS; Ingest page layout becomes full‑width.
- **Will not change:** ingest backend logic, persistence formats, or feature set (no new ingest capabilities).
- **Single path:** the only realtime path is WS (polling is removed, no fallback branch).

---

## Discussion Decisions (recorded)

- WS unavailable → show an error state (no polling fallback).
- Show only live runs + roots list (no last-run summary when idle).
- Use a single global ingest stream (no runId filters).
- Prefer KISS: single path, minimal branching, fix issues at the upstream source rather than downstream workarounds.

---

## Contracts & Storage Changes (explicit)

- **New WS message contracts:** `subscribe_ingest`, `unsubscribe_ingest`, `ingest_snapshot`, `ingest_update` (defined in the section below).
- **No new persistence/storage shapes:** ingest status remains in the existing in‑memory `ingestJob.ts` map; no database changes.
- **No changes to existing REST response shapes** (other than removing client polling usage).

---

## Message Contracts & State Shapes (exact)

### Client → Server (WebSocket v1)

```json
{ "protocolVersion": "v1", "requestId": "<uuid>", "type": "subscribe_ingest" }
```

```json
{ "protocolVersion": "v1", "requestId": "<uuid>", "type": "unsubscribe_ingest" }
```

### Server → Client (WebSocket v1)

**Snapshot on subscribe**

```json
{
  "protocolVersion": "v1",
  "type": "ingest_snapshot",
  "seq": 1,
  "status": {
    "runId": "r1",
    "state": "embedding",
    "counts": { "files": 3, "chunks": 12, "embedded": 4 },
    "currentFile": "/repo/file-2.txt",
    "fileIndex": 2,
    "fileTotal": 3,
    "percent": 66.7,
    "etaMs": 12000,
    "message": "Embedding",
    "lastError": null
  }
}
```

If there is **no active run**, `status` is `null`:

```json
{ "protocolVersion": "v1", "type": "ingest_snapshot", "seq": 1, "status": null }
```

**Progress updates**

```json
{
  "protocolVersion": "v1",
  "type": "ingest_update",
  "seq": 2,
  "status": {
    "runId": "r1",
    "state": "completed",
    "counts": { "files": 3, "chunks": 12, "embedded": 12 },
    "message": "Completed",
    "lastError": null
  }
}
```

**Notes for implementers (clarity):**
- `ingest_snapshot` is sent immediately after `subscribe_ingest` is processed.
- `ingest_update` is sent whenever the server’s ingest status changes.
- `seq` is monotonically increasing for the ingest stream on a given socket (same rule as chat events).
- There is **one** global ingest stream (no `runId` filters in the subscribe message).

### Status shape (shared with `/ingest/status/:runId`)

```ts
type IngestStatusPayload = {
  runId: string;
  state:
    | 'queued'
    | 'scanning'
    | 'embedding'
    | 'completed'
    | 'cancelled'
    | 'error'
    | 'skipped';
  counts: {
    files?: number;
    chunks?: number;
    embedded?: number;
  };
  currentFile?: string;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
  message?: string;
  lastError?: string | null;
};
```

---

## Tasks

### 1. Server: WS protocol + ingest subscription + snapshot-on-subscribe

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add new WebSocket v1 message types for ingest (`subscribe_ingest`, `unsubscribe_ingest`) and implement the server-side subscription + snapshot behavior so an Ingest page can subscribe and immediately receive `ingest_snapshot` (or `status: null` when no run is active).

This task does **not** broadcast ingest progress changes yet (that is Task 2). It only establishes the protocol, validation/parsing, per-socket subscription tracking, and snapshot sending.

#### Documentation Locations

- `ws` (WebSocket server for Node): Context7 `/websockets/ws/8_18_3`
- Node.js test runner (node:test) (server tests use this runner): https://nodejs.org/api/test.html
- WebSocket browser API (for understanding client expectations): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

#### Subtasks

1. [ ] Read existing WS server patterns so changes mirror Chat/Agents:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/ws/types.ts` (parse/validation + event type shapes)
     - `server/src/ws/registry.ts` (subscription state)
     - `server/src/ws/server.ts` (message handler + connection lifecycle)
     - `server/src/test/unit/ws-server.test.ts` (existing WS unit tests)

2. [ ] Extend WS client message parsing for ingest subscriptions:
   - Files to edit:
     - `server/src/ws/types.ts`
   - Requirements:
     - Add `WsClientSubscribeIngest` and `WsClientUnsubscribeIngest` message types.
     - Update `WsClientKnownMessage` union to include them.
     - Update `parseClientMessage(...)` to accept both message types with no extra payload fields.

3. [ ] Add WS server event shapes for ingest snapshot + updates:
   - Files to edit:
     - `server/src/ws/types.ts`
   - Requirements:
     - Add `WsIngestSnapshotEvent` and `WsIngestUpdateEvent` types matching the “Message Contracts & State Shapes (exact)” section of this story.
     - Ensure both event types include `{ protocolVersion: 'v1', type, seq, status }`.
     - `status` must be `IngestJobStatus | null` (same shape as REST `/ingest/status/:runId`).

4. [ ] Add ingest subscription tracking in the WS registry:
   - Files to edit:
     - `server/src/ws/registry.ts`
   - Requirements:
     - Extend per-socket state to include a boolean `subscribedIngest`.
     - Add `subscribeIngest(ws)`, `unsubscribeIngest(ws)`, and `socketsSubscribedToIngest()` helpers.
     - Ensure `unregisterSocket(ws)` clears state (existing behavior) and does not leak subscriptions.

5. [ ] Add a small WS helper for ingest seq + safe sends (to avoid circular imports later):
   - Files to add:
     - `server/src/ws/ingest.ts`
   - Requirements:
     - Implement a per-socket `seq` counter for ingest events (monotonic on a given socket).
     - Export helpers like:
       - `sendIngestSnapshot(ws, statusOrNull)`
       - `broadcastIngestUpdate(status)` (this will be used in Task 2 but can be stubbed or left unused until then)
     - Do **not** import `server/src/ingest/ingestJob.ts` from this new file (keep it WS-only to prevent cycles).

6. [ ] Implement “snapshot on subscribe” in the WS server:
   - Files to edit:
     - `server/src/ws/server.ts`
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Add a new export in `server/src/ingest/ingestJob.ts`: `getActiveStatus(): IngestJobStatus | null`.
       - “Active” means: an ingest run is currently in progress (lock held). If no run is active, return `null` (no last-run summary).
     - In `server/src/ws/server.ts`, handle `subscribe_ingest`:
       - Mark the socket as subscribed via the registry.
       - Immediately send `ingest_snapshot` using `getActiveStatus()` (can be `null`).
       - Use the helper in `server/src/ws/ingest.ts` so `seq` is per-socket.
     - Handle `unsubscribe_ingest` by clearing the socket’s ingest subscription.

7. [ ] Server unit tests for ingest snapshot behavior:
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ws-server.test.ts`
   - Requirements:
     - Add a test: sending `subscribe_ingest` yields an `ingest_snapshot` message.
     - Add a test: when no run is active, the snapshot contains `status: null`.
     - Add a test: when a run is active, the snapshot contains `status.runId === <runId>`.
       - Use existing test-only helpers in ingest (`__setStatusForTest`, `__resetIngestJobsForTest`) and the real ingest lock to simulate “active”.

8. [ ] Run repo lint/format checks for this change:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in after implementation)

---

### 2. Server: broadcast ingest progress/status changes over WS (`ingest_update`)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Broadcast `ingest_update` messages whenever the server-side ingest status changes, so any subscribed Ingest page receives progress updates in real time.

This task completes the server-side realtime path for ingest by wiring status updates in `ingestJob.ts` into the WS ingest stream created in Task 1.

#### Documentation Locations

- `ws` (WebSocket server for Node): Context7 `/websockets/ws/8_18_3`
- Node.js test runner (node:test): https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Read the ingest status lifecycle to identify every status update point:
   - Files to read:
     - `server/src/ingest/ingestJob.ts` (all `jobs.set(...)` call sites)
     - `server/src/routes/ingestStart.ts` and `server/src/routes/ingestCancel.ts` (existing REST control surface)

2. [ ] Implement WS broadcasting helper usage:
   - Files to edit:
     - `server/src/ws/ingest.ts`
   - Requirements:
     - Ensure `broadcastIngestUpdate(status)` sends `{ type: 'ingest_update', status, seq }` to all sockets returned by `socketsSubscribedToIngest()`.
     - `seq` must be bumped per socket (monotonic per socket) the same way `sendIngestSnapshot(...)` does.

3. [ ] Centralize ingest status writes to guarantee WS updates are emitted:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Introduce a tiny helper (example name): `setStatusAndPublish(runId, nextStatus)`.
       - It must call `jobs.set(runId, nextStatus)`.
       - It must call `broadcastIngestUpdate(nextStatus)`.
     - Replace every `jobs.set(runId, ...)` that represents a user-visible status/progress change with the helper.
       - This includes progress updates inside `progressSnapshot(...)`.
       - This includes terminal states: `completed`, `skipped`, `cancelled`, `error`.
     - Keep existing REST behavior unchanged.

4. [ ] Ensure cancel flows publish a final update:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts` (`cancelRun`)
   - Requirements:
     - When cancellation sets the state to `cancelled`, an `ingest_update` must be broadcast.

5. [ ] Add server unit/integration test coverage for ingest updates:
   - Test type:
     - node:test unit test (server)
   - Test location:
     - Prefer adding a focused test in `server/src/test/unit/ws-server.test.ts`.
   - Requirements:
     - Connect a WS client, send `subscribe_ingest`, then mutate ingest status using test helpers.
     - Assert an `ingest_update` message is received with the updated `status.state`.
     - Assert `seq` increases on subsequent updates.

6. [ ] Run repo lint/format checks for this change:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in after implementation)

---

### 3. Client: ingest WS hook (`useIngestWs`) with explicit error state

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Create a dedicated client hook that connects to `/ws`, subscribes to ingest, and exposes `status` from `ingest_snapshot`/`ingest_update` plus connection/error state. This hook will be used by the Ingest page in Task 4.

#### Documentation Locations

- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React hooks (useEffect patterns): https://react.dev/reference/react/useEffect
- Jest fake timers (if needed in hook tests): https://jestjs.io/docs/timer-mocks

#### Subtasks

1. [ ] Read existing WS client patterns and test utilities:
   - Files to read:
     - `client/src/hooks/useChatWs.ts` (connect/reconnect/subscription patterns)
     - `client/src/test/support/mockWebSocket.ts` (WS mocking)
     - `client/src/test/useChatWs.test.ts` (hook tests)

2. [ ] Add a new ingest WS hook:
   - Files to add:
     - `client/src/hooks/useIngestWs.ts`
   - Requirements:
     - On mount: open a WebSocket to `${VITE_API_URL}/ws` (same base rule as `useChatWs`).
      - On open: send `{ protocolVersion: 'v1', requestId: <id>, type: 'subscribe_ingest' }`.
      - On unmount: send `unsubscribe_ingest` and close the socket.
     - Parse inbound JSON and support:
       - `ingest_snapshot` → set status (can be `null`).
       - `ingest_update` → set status (object).
      - Track `connectionState` (`connecting` | `open` | `closed`).
      - Reconnect behavior (required to satisfy snapshot-on-resubscribe acceptance criteria):
        - If the socket closes unexpectedly (not an intentional unmount), attempt to reconnect with a small backoff (reuse the approach from `useChatWs`, keeping it simple).
        - After reconnect, automatically re-send `subscribe_ingest` and expect a fresh `ingest_snapshot`.
      - If WS cannot be established initially or drops: expose an explicit error message suitable for UI display (no polling fallback). The UI may still attempt reconnection, but the error state must be visible while disconnected.
      - Ignore unknown inbound message types safely.
      - Implement `seq` gating similar to `useChatWs` (ignore stale/out-of-order frames).

3. [ ] Add hook tests:
   - Files to add/edit:
     - Add a new test file `client/src/test/useIngestWs.test.ts`.
   - Requirements:
     - Test: hook sends `subscribe_ingest` on connect.
     - Test: receiving `ingest_snapshot` sets `status`.
     - Test: receiving `ingest_update` updates `status`.
     - Test: WS close transitions to `closed` and sets an error flag/message.
     - Test: after an unexpected close, the hook reconnects and re-sends `subscribe_ingest`.
     - Test: out-of-order `seq` is ignored.

4. [ ] Run repo lint/format checks for this change:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 4. Client: switch Ingest page to WS-only progress (remove polling + “last run” UI)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Make `/ingest` use WebSockets only for ingest progress and status. Remove timer polling entirely and update UI rules so the “Active run” card only appears while a run is active.

#### Documentation Locations

- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React Router (route mount/unmount semantics): https://reactrouter.com/start/library/routing

#### Subtasks

1. [ ] Read current ingest page + polling hook usage:
   - Files to read:
     - `client/src/pages/IngestPage.tsx`
     - `client/src/hooks/useIngestStatus.ts`
     - `client/src/components/ingest/ActiveRunCard.tsx`

2. [ ] Update Ingest page to use the WS hook:
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Replace `useIngestStatus(activeRunId)` with the new `useIngestWs()`.
     - Remove the `activeRunId` state from the page. The ingest run ID must come from WebSocket `status.runId` (global stream; no runId filters).
     - The page must render ingest progress from WS only.
     - If WS is unavailable / closes, show a clear error UI state (and do not start polling).
     - “No last run summary” rule:
       - When there is no active run (`status === null`), hide/omit the “Active ingest / Active run” card entirely.
       - When a terminal state is received (`completed`, `cancelled`, `error`, `skipped`), immediately treat the run as inactive for rendering (do not keep a last-run summary panel).
     - Keep cancel functionality working using the existing REST endpoint (`POST /ingest/cancel/:runId`) using the WS status’ `runId`.
     - Preserve existing “refresh roots/models after completion” behavior:
       - When a terminal state is received, call `refetchRoots()` and `refresh()` (models) once.
       - After scheduling refresh, clear/hide the active run UI (consistent with “no last run summary”).

3. [ ] Remove polling usage so it cannot regress:
   - Files to edit/delete:
     - `client/src/hooks/useIngestStatus.ts` (delete if unused)
     - Any imports/usages in `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Ensure no code path starts a timer that calls `/ingest/status/:runId`.

4. [ ] Replace polling-based tests with WS-based tests:
   - Files to edit/delete/add:
     - `client/src/test/ingestStatus.test.tsx`
     - `client/src/test/ingestStatus.progress.test.tsx`
     - (Add a focused IngestPage WS test if needed)
   - Requirements:
     - Remove tests that assert polling/timers.
     - Add tests that assert:
       - Snapshot renders immediately when received.
       - No “Active ingest” UI is rendered when `status === null`.
       - WS closed/error shows the explicit error state.
       - Terminal state triggers a roots/models refresh once and then the active run UI is hidden.

5. [ ] Run repo lint/format checks for this change:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 5. Client: full-width Ingest layout

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Make the Ingest page layout full-width (matching Chat/Agents) by removing the constrained/narrow container behavior so the roots table isn’t clipped.

#### Documentation Locations

- MUI Container docs (use MUI MCP tool): `@mui/material` Container (pick the matching version from MUI MCP)

#### Subtasks

1. [ ] Read how other pages achieve full width:
   - Files to read:
     - `client/src/pages/ChatPage.tsx` (Container usage)
     - `client/src/pages/AgentsPage.tsx` (Container usage)
     - `client/src/pages/IngestPage.tsx` (current constrained Container)

2. [ ] Update Ingest page container width:
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Ensure the page is full-width (no centered/narrow maxWidth).
     - Keep spacing consistent with the rest of the app.
     - Do not redesign components; width-only change.

3. [ ] Add/update a focused UI test to prevent regression:
   - Files to edit/add:
     - Update or add a test that asserts the Ingest page no longer uses the default `Container` maxWidth behavior.
       - Practical approach: assert the rendered container does not include the `MuiContainer-maxWidthLg` class.

4. [ ] Run repo lint/format checks for this change:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 6. Final verification: acceptance criteria, full test/build matrix, docs, PR comment

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Run the full validation checklist, confirm every acceptance criterion, update documentation, and produce a PR-ready summary comment.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Confirm the acceptance criteria explicitly (write down results in Implementation notes):
   - Live updates via WS only (no polling timers)
   - Snapshot on subscribe
   - Page-scoped updates (unsubscribes when navigating away)
   - WS unavailable shows explicit error
   - No last-run summary when idle
   - Single global stream
   - Full-width Ingest layout

2. [ ] Ensure docs are up to date:
   - Files to edit:
     - `README.md` (only if behavior/commands changed)
     - `design.md` (add ingest WS notes/diagram if missing)
     - `projectStructure.md` (add/remove files created/deleted in this story)

3. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

4. [ ] Create a PR summary comment:
   - Include server WS protocol changes, ingest WS stream behavior, and client Ingest UX changes.
   - Mention what was removed (polling), and what the explicit failure mode is (WS error state).

#### Testing

1. [ ] Build the server: `npm run build --workspace server`
2. [ ] Build the client: `npm run build --workspace client`
3. [ ] Run server tests: `npm run test --workspace server`
4. [ ] Run client tests: `npm run test --workspace client`
5. [ ] Perform a clean docker build: `npm run compose:build`
6. [ ] Start docker compose: `npm run compose:up`
7. [ ] Run e2e tests: `npm run e2e`
8. [ ] Manual multi-tab verification:
   - Open `/ingest` in two browser tabs.
   - Start an ingest run in tab A.
   - Confirm tab B immediately receives a snapshot + subsequent progress updates (no refresh required).
   - Navigate tab B away from `/ingest` and confirm it stops receiving ingest updates.
   - Return tab B to `/ingest` and confirm it receives a fresh snapshot.
   - Confirm the UI shows an explicit error if the WS connection is down (no polling fallback).
9. [ ] Shut down compose: `npm run compose:down`

#### Implementation notes

- (fill in after implementation)
