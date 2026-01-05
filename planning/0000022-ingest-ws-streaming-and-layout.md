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

- Dependency versions relevant to this story (from repo `package.json` files):
  - Client: React `^19.2.0`, React Router DOM `7.9.6`, MUI `@mui/material` `^6.4.1`, Jest `30.2.0`, TypeScript `~5.9.3`.
  - Server: `ws` `8.18.3`, Express `^5.0.0`, Mongoose `9.0.1`.
  - Root tooling: TypeScript `5.9.3`, Playwright `1.56.1`.

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

### 1. Server: ingest WS message types + subscribe/unsubscribe + placeholder snapshot

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add new WebSocket v1 message types for ingest (`subscribe_ingest`, `unsubscribe_ingest`) and implement server-side subscription handling so an Ingest page can subscribe and immediately receive an `ingest_snapshot`.

This task intentionally starts with a **placeholder snapshot** (`status: null` always) so the protocol/parsing/subscription plumbing can be implemented and tested in isolation. Task 2 will make the snapshot accurately reflect the active ingest run.

This task does **not** broadcast ingest progress changes yet (that is Task 3).

#### Documentation Locations

- `ws` (WebSocket server for Node, version `8.18.3`): Context7 `/websockets/ws/8_18_3`
- `ws` DeepWiki (`noServer` / `handleUpgrade` patterns): DeepWiki `websockets/ws`
- Node.js test runner (node:test): https://nodejs.org/api/test.html
- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

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
     - `server/src/test/support/wsClient.ts` (WS client helper for tests)

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

5. [ ] Add per-socket ingest `seq` and a snapshot send helper:
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - Reuse existing `safeSend(ws, event)` in `server/src/ws/server.ts`.
     - Add a per-socket `seq` counter for ingest events (monotonic per socket), e.g. `WeakMap<WebSocket, number>` scoped to the WS server.
     - Add a small helper to send `ingest_snapshot` with per-socket `seq`.

6. [ ] Handle `subscribe_ingest` / `unsubscribe_ingest` in the WS server:
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - On `subscribe_ingest`:
       - Mark the socket as subscribed via the registry.
       - Immediately send `ingest_snapshot` with `status: null` (placeholder; Task 2 replaces this).
     - On `unsubscribe_ingest`:
       - Clear the socket’s ingest subscription.

7. [ ] Server unit test: subscribe yields placeholder snapshot:
   - Test type:
     - node:test unit test (server)
   - Test location:
     - Prefer adding to `server/src/test/unit/ws-server.test.ts`.
   - Requirements:
     - Add a test: sending `subscribe_ingest` yields an `ingest_snapshot` message.
     - Assert the snapshot contains `status: null`.
   - Concrete implementation guidance:
     - Reuse `server/src/test/support/wsClient.ts` helpers: `connectWs(...)`, `sendJson(...)`, `waitForEvent(...)`, `closeWs(...)`.

8. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in after implementation)

---

### 2. Server: determine active ingest status for snapshots (`getActiveStatus`)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement `getActiveStatus()` so `ingest_snapshot` reflects the current active ingest run (and returns `null` if no run is active). Update the WS subscribe handler to use this function.

This task is deliberately separate from WS protocol plumbing (Task 1) and from broadcasting updates (Task 3).

#### Documentation Locations

- Node.js test runner (node:test): https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Read the ingest job state storage and lock behavior:
   - Files to read:
     - `server/src/ingest/ingestJob.ts` (in-memory `jobs` map + states)
     - `server/src/ingest/lock.ts` (lock owner + TTL)

2. [ ] Implement `getActiveStatus()`:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Export `getActiveStatus(): IngestJobStatus | null`.
     - “Active” means: any run currently in a non-terminal state (`queued` | `scanning` | `embedding`).
     - Do **not** rely only on the ingest lock being held, because the lock has a TTL and may expire while a long ingest is still running.
     - Implementation guidance (KISS + deterministic):
       - If the lock is held and `currentOwner()` maps to a non-terminal status, return that first.
       - Otherwise, scan the `jobs` map and return the first non-terminal status (Map iteration order is stable).
     - If no run is active, return `null` (no last-run summary).

3. [ ] Update WS subscribe handler to use `getActiveStatus()`:
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - On `subscribe_ingest`, send `ingest_snapshot` with `status: getActiveStatus()`.

4. [ ] Update server unit tests:
   - Files to edit:
     - `server/src/test/unit/ws-server.test.ts`
   - Requirements:
     - Keep the `status: null` snapshot test (no active run).
     - Add a test: when a non-terminal status is seeded, the snapshot contains that `status.runId`.
       - Use existing helpers in `server/src/ingest/ingestJob.ts`: `__resetIngestJobsForTest()` + `__setStatusForTest()`.

5. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in after implementation)

---

### 3. Server: broadcast ingest progress/status changes over WS (`ingest_update`)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Broadcast `ingest_update` messages whenever the server-side ingest status changes, so any subscribed Ingest page receives progress updates in real time.

This task completes the server-side realtime path for ingest by wiring status updates in `ingestJob.ts` into the WS ingest stream created in Tasks 1–2.

#### Documentation Locations

- `ws` (WebSocket server for Node, version `8.18.3`): Context7 `/websockets/ws/8_18_3`
- Node.js test runner (node:test): https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Read the ingest status lifecycle to identify every status update point:
   - Files to read:
     - `server/src/ingest/ingestJob.ts` (all `jobs.set(...)` call sites)
     - `server/src/routes/ingestStart.ts` and `server/src/routes/ingestCancel.ts` (existing REST control surface)

2. [ ] Implement WS broadcast helper:
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - Add a `broadcastIngestUpdate(status)` implementation (follow the existing `publish*` patterns in `server/src/ws/server.ts`).
     - It must send `{ type: 'ingest_update', status, seq }` to all sockets returned by `socketsSubscribedToIngest()`.
     - `seq` must be bumped per socket (monotonic per socket) the same way `ingest_snapshot` is sent.

3. [ ] Centralize ingest status writes so WS updates are emitted:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Introduce a tiny helper (example name): `setStatusAndPublish(runId, nextStatus)`.
       - It must call `jobs.set(runId, nextStatus)`.
       - It must call `broadcastIngestUpdate(nextStatus)`.
     - Replace every `jobs.set(runId, ...)` that represents a user-visible status/progress change with the helper.
       - This includes the initial `queued` status set in `startIngest(...)`.
       - This includes progress updates inside `progressSnapshot(...)`.
       - This includes terminal states: `completed`, `skipped`, `cancelled`, `error`.
     - Keep existing REST behavior unchanged.

4. [ ] Ensure cancel flows publish a final update:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts` (`cancelRun`)
   - Requirements:
     - When cancellation sets the state to `cancelled`, an `ingest_update` must be broadcast.

5. [ ] Add server unit test coverage for ingest updates:
   - Test type:
     - node:test unit test (server)
   - Test location:
     - Prefer adding a focused test in `server/src/test/unit/ws-server.test.ts`.
   - Requirements:
     - Connect a WS client, send `subscribe_ingest`, then mutate ingest status using test helpers.
     - Assert an `ingest_update` message is received with the updated `status.state`.
     - Assert `seq` increases on subsequent updates.

   - Concrete implementation guidance:
     - Add a new test-only helper in `server/src/ingest/ingestJob.ts` to avoid coupling tests to internal functions:
       - `__setStatusAndPublishForTest(runId: string, status: IngestJobStatus)`
       - It should be guarded like existing helpers: only allowed when `NODE_ENV === 'test'`.
       - It must use the same implementation path as production (i.e., call the same internal `setStatusAndPublish(...)` helper).
     - In the WS test, call `__setStatusAndPublishForTest(...)` twice and assert that two `ingest_update` frames arrive with increasing `seq`.

6. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill in after implementation)

---

### 4. Client: extend `useChatWs` with ingest subscription + ingest event types

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend the existing `useChatWs` WebSocket transport so it can subscribe to ingest and pass ingest events through the same socket/reconnect/seq-gating pipeline.

This task intentionally does **not** change the Ingest page or ingest status hook yet; it only makes the shared WS transport capable of ingest.

#### Documentation Locations

- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React hooks (cleanup/unmount semantics via `useEffect`): https://react.dev/reference/react/useEffect
- Jest timer mocks (fake timers + advancing timers):
  - Context7 `/websites/jestjs_io_next` (Timer Mocks)
  - https://jestjs.io/docs/timer-mocks

#### Subtasks

1. [ ] Read existing WS client patterns and test utilities:
   - Files to read:
     - `client/src/hooks/useChatWs.ts` (connect/reconnect/subscription patterns)
     - `client/src/test/support/mockWebSocket.ts` (WS mocking)
     - `client/src/test/useChatWs.test.ts` (hook tests)

2. [ ] Extend `useChatWs` outbound API for ingest:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
   - Requirements:
     - Add new outbound helpers:
       - `subscribeIngest(): void`
       - `unsubscribeIngest(): void`
     - Track ingest subscription state in a ref (mirrors sidebar subscription handling).
     - On reconnect (socket re-open), if ingest is subscribed, automatically re-send `subscribe_ingest`.

3. [ ] Add ingest event typing + seq gating:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
   - Requirements:
     - Extend the inbound event typing to include `ingest_snapshot` and `ingest_update` events.
     - Update the seq-gating key logic so ingest events use a stable key (e.g. `'ingest'`) and are gated.
     - Reset seq gating for the ingest key when a new socket is created (so `seq: 1` snapshots after reconnect are accepted), without changing chat transcript seq behavior.
     - Ensure Chat/Agents behavior remains unchanged.

4. [ ] Add/adjust `useChatWs` tests:
   - Files to edit:
     - `client/src/test/useChatWs.test.ts`
   - Requirements:
     - Add a test: calling `subscribeIngest()` sends an outbound `subscribe_ingest` message.
     - Add a test: after a reconnect, if ingest was subscribed, a new socket re-sends `subscribe_ingest`.
     - Add a test: ingest events are seq-gated on a stable key (e.g. `'ingest'`) and stale/out-of-order frames are ignored.

5. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 5. Client: refactor `useIngestStatus` to be WS-driven (remove polling)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Refactor the existing ingest status hook to use WebSocket `ingest_snapshot` / `ingest_update` events instead of polling `/ingest/status/:runId`.

This task does not change the Ingest page layout yet; it only changes how status is sourced.

#### Documentation Locations

- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React hooks (cleanup/unmount semantics via `useEffect`): https://react.dev/reference/react/useEffect

#### Subtasks

1. [ ] Read current polling hook behavior:
   - Files to read:
     - `client/src/hooks/useIngestStatus.ts`
     - `client/src/components/ingest/ActiveRunCard.tsx` (data it expects)

2. [ ] Update `useIngestStatus` API and implementation:
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Requirements:
     - Remove polling/timers and any fetches to `/ingest/status/:runId`.
     - Remove the `runId` parameter from the hook.
     - Use `useChatWs` with an `onEvent` handler to capture `ingest_snapshot` / `ingest_update` and store the latest status.
     - Subscribe to ingest only while the hook is mounted (call `subscribeIngest()` in an effect and `unsubscribeIngest()` in cleanup).
     - Expose:
       - `status: IngestStatusPayload | null` (null means no active run)
       - `connectionState`
       - `isError` / `error` for “WS unavailable” UI.
     - Keep `cancel()` using existing REST `POST /ingest/cancel/:runId`.
       - It must use the current WS `status?.runId`.

3. [ ] Update existing ingest status tests to WS-driven behavior:
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
     - `client/src/test/ingestStatus.progress.test.tsx`
   - Requirements:
     - Remove polling assertions and fetch mocking.
     - Replace with WS event assertions using `client/src/test/support/mockWebSocket.ts`.
     - Ensure cancel still calls the REST endpoint with the current `status.runId`.

4. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 6. Client: switch Ingest page to WS-only run UI (no last-run summary)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Make `/ingest` use the WS-based `useIngestStatus()` output and enforce the story’s UI rules: show only an active run (no last-run summary), and show an explicit error when WS is unavailable.

#### Documentation Locations

- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- React Router (route mount/unmount semantics): https://reactrouter.com/start/library/routing

#### Subtasks

1. [ ] Read current ingest page behavior:
   - Files to read:
     - `client/src/pages/IngestPage.tsx`
     - `client/src/hooks/useIngestStatus.ts`
     - `client/src/components/ingest/ActiveRunCard.tsx`

2. [ ] Update Ingest page to use the WS-based `useIngestStatus()`:
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
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
     - Ensure page-scoped updates:
       - Only subscribe while `/ingest` is mounted (this should naturally happen if only `IngestPage` mounts `useIngestStatus()`).

3. [ ] Add/update Ingest page tests (page-level):
   - Files to edit/add:
     - Add a focused `IngestPage` test file if one does not exist yet.
   - Requirements:
     - Add tests that assert:
       - Snapshot renders immediately when received.
       - No “Active ingest” UI is rendered when `status === null`.
       - WS closed/error shows the explicit error state.
       - Terminal state triggers a roots/models refresh once and then the active run UI is hidden.

4. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 7. Client: full-width Ingest layout

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Make the Ingest page layout full-width (matching Chat/Agents) by removing the constrained/narrow container behavior so the roots table isn’t clipped.

#### Documentation Locations

- MUI Container API (repo uses `@mui/material ^6.4.1`; closest MUI MCP docs version is `6.4.12`):
  - MUI MCP `@mui/material@6.4.12` → Container API (includes `MuiContainer-maxWidthLg` CSS class info)

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
       - Note: `MuiContainer-maxWidthLg` is the documented global class for `maxWidth="lg"` in MUI Container API (v6.4.x).

4. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 8. Final verification: acceptance criteria, full test/build matrix, docs, PR comment

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
