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
- E2E ingest tests currently assume the Active ingest panel stays visible until it shows a terminal chip label (e.g. `completed`). This story changes that UI (no last-run summary), so the e2e tests must be updated to treat “completion” as either (a) the roots table row appearing and/or (b) the Active ingest panel disappearing.
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

- Task Status: **__done__**
- Git Commits: **02ab83e, 1799357**

#### Overview

Add new WebSocket v1 message types for ingest (`subscribe_ingest`, `unsubscribe_ingest`) and implement server-side subscription handling so an Ingest page can subscribe and immediately receive an `ingest_snapshot`.

This task intentionally starts with a **placeholder snapshot** (`status: null` always) so the protocol/parsing/subscription plumbing can be implemented and tested in isolation. Task 2 will make the snapshot accurately reflect the active ingest run.

This task does **not** broadcast ingest progress changes yet (that is Task 3).

#### Documentation Locations

- `ws` (WebSocket server for Node, v8.18.3): Context7 `/websockets/ws/8_18_3` — confirms `WebSocketServer({ noServer: true })`, `handleUpgrade(...)`, and connection events needed for server-side subscribe/unsubscribe handling.
- `ws` DeepWiki: `websockets/ws` — corroborates noServer/handleUpgrade + heartbeat guidance used in the WS server lifecycle.
- Node.js test runner (node:test): https://nodejs.org/api/test.html — matches the unit test runner used in server WS tests.
- WebSocket browser API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API — clarifies client message shape expectations and WebSocket event semantics.
- Mermaid syntax (Context7): `/mermaid-js/mermaid` — required for the design.md sequence/flow diagrams updated in this task.

#### Subtasks

1. [x] Read existing WS server patterns so changes mirror Chat/Agents:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
       - Confirm `WebSocketServer({ noServer: true })` + `handleUpgrade(...)` is the supported pattern, and ping/pong heartbeats are recommended for dead-connection detection.
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/ws/types.ts` (parse/validation + event type shapes)
     - `server/src/ws/registry.ts` (subscription state)
     - `server/src/ws/server.ts` (message handler + connection lifecycle)
     - `server/src/test/unit/ws-server.test.ts` (existing WS unit tests)
     - `server/src/test/support/wsClient.ts` (WS client helper for tests)

2. [x] Extend WS client message parsing for ingest subscriptions:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `server/src/ws/types.ts`
   - Requirements:
     - Add `WsClientSubscribeIngest` and `WsClientUnsubscribeIngest` message types.
     - Update `WsClientKnownMessage` union to include them.
     - Update `parseClientMessage(...)` to accept both message types with no extra payload fields.

   - Must-not-miss details (repeat from story contracts):
     - Client → Server message shape (exact):
       ```json
       { "protocolVersion": "v1", "requestId": "<uuid>", "type": "subscribe_ingest" }
       ```
       ```json
       { "protocolVersion": "v1", "requestId": "<uuid>", "type": "unsubscribe_ingest" }
       ```
     - Keep the existing validation behavior:
       - If payload is malformed / missing required fields, the server closes with code `1008` (see current WS behavior).

   - Concrete implementation guidance:
     - Mirror the existing `subscribe_sidebar` / `unsubscribe_sidebar` parsing cases.
     - Example (do not copy blindly; match file style):
       ```ts
       export type WsClientSubscribeIngest = WsClientBase & { type: 'subscribe_ingest' };
       export type WsClientUnsubscribeIngest = WsClientBase & { type: 'unsubscribe_ingest' };
       ```

3. [x] Add WS server event shapes for ingest snapshot + updates:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ws/types.ts`
   - Requirements:
     - Add `WsIngestSnapshotEvent` and `WsIngestUpdateEvent` types matching the “Message Contracts & State Shapes (exact)” section of this story.
     - Ensure both event types include `{ protocolVersion: 'v1', type, seq, status }`.
     - `status` must be `IngestJobStatus | null` (same shape as REST `/ingest/status/:runId`).
     - Add both event types to the `WsServerEvent` union so server publishing helpers can use them safely.

   - Must-not-miss details (repeat from story contracts):
     - Snapshot server → client message (exact keys):
       ```json
       { "protocolVersion": "v1", "type": "ingest_snapshot", "seq": 1, "status": null }
       ```
     - Update server → client message (exact keys):
       ```json
       { "protocolVersion": "v1", "type": "ingest_update", "seq": 2, "status": { "runId": "r1", "state": "embedding", "counts": { "files": 3, "chunks": 12, "embedded": 4 } } }
       ```

   - Concrete implementation guidance:
     - Import the status type from ingest (ensure ESM `.js` extension is preserved in runtime imports):
       - Files to read:
         - `server/src/ingest/ingestJob.ts`
     - Example type shapes:
       ```ts
       export type WsIngestSnapshotEvent = {
         protocolVersion: WsProtocolVersion;
         type: 'ingest_snapshot';
         seq: number;
         status: IngestJobStatus | null;
       };
       ```

4. [x] Add ingest subscription tracking in the WS registry:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ws/registry.ts`
   - Requirements:
     - Extend per-socket state to include a boolean `subscribedIngest`.
     - Add `subscribeIngest(ws)`, `unsubscribeIngest(ws)`, and `socketsSubscribedToIngest()` helpers.
     - Ensure `unregisterSocket(ws)` clears state (existing behavior) and does not leak subscriptions.

   - Must-not-miss details:
     - Acceptance criteria requires page-scoped updates: only sockets that explicitly subscribe (i.e., while `/ingest` is mounted) receive ingest frames.
     - This is achieved by this registry boolean + subscribe/unsubscribe messages.

   - Concrete implementation guidance:
     - Extend the existing `SocketState` type (do not create a new registry structure).
       ```ts
       type SocketState = {
         subscribedSidebar: boolean;
         subscribedIngest: boolean;
         conversationIds: Set<string>;
       };
       ```
     - Add a selector similar to `socketsSubscribedToSidebar()`:
       ```ts
       export function socketsSubscribedToIngest(): WebSocket[] {
         return Array.from(stateBySocket.entries())
           .filter(([, state]) => state.subscribedIngest)
           .map(([ws]) => ws);
       }
       ```

5. [x] Add per-socket ingest `seq` and a snapshot send helper:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - Reuse existing `safeSend(ws, event)` in `server/src/ws/server.ts`.
     - Add a per-socket `seq` counter for ingest events (monotonic per socket), e.g. `WeakMap<WebSocket, number>` scoped to the WS server.
     - Add a small helper to send `ingest_snapshot` with per-socket `seq`.

   - Must-not-miss details:
     - The story contract says `seq` is monotonically increasing **per socket** for ingest.
     - This task must implement per-socket `seq` even though chat uses per-conversation `seq`.

   - Concrete implementation guidance:
     - Keep this small and local to `server/src/ws/server.ts`:
       ```ts
       const ingestSeqBySocket = new WeakMap<WebSocket, number>();
       const nextIngestSeq = (ws: WebSocket) => {
         const next = (ingestSeqBySocket.get(ws) ?? 0) + 1;
         ingestSeqBySocket.set(ws, next);
         return next;
       };

       function sendIngestSnapshot(ws: WebSocket, status: IngestJobStatus | null) {
         safeSend(ws, {
           protocolVersion: WS_PROTOCOL_VERSION,
           type: 'ingest_snapshot',
           seq: nextIngestSeq(ws),
           status,
         });
       }
       ```

6. [x] Handle `subscribe_ingest` / `unsubscribe_ingest` in the WS server:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - On `subscribe_ingest`:
       - Mark the socket as subscribed via the registry.
       - Immediately send `ingest_snapshot` with `status: null` (placeholder; Task 2 replaces this).
     - On `unsubscribe_ingest`:
       - Clear the socket’s ingest subscription.

   - Must-not-miss details (repeat from acceptance criteria):
     - Snapshot on subscribe is required: the server must send `ingest_snapshot` immediately after it processes `subscribe_ingest`.
     - No polling fallback will exist later: this snapshot is the only way a newly opened `/ingest` page gets initial state.

   - Concrete implementation guidance:
     - Mirror existing subscription cases in `handleMessage(...)`:
       ```ts
       case 'subscribe_ingest':
         subscribeIngest(ws);
         sendIngestSnapshot(ws, null);
         return;
       case 'unsubscribe_ingest':
         unsubscribeIngest(ws);
         return;
       ```

7. [x] Add server log line for ingest subscribe snapshots:
   - Documentation to read:
     - Server logging overview: `design.md` (Logging section)
   - Files to edit:
     - `server/src/ws/server.ts`
   - Log line requirements:
     - Use `logPublish(...)` (existing helper) when sending the `ingest_snapshot` in `subscribe_ingest`.
     - Message must be exactly: `0000022 ingest ws snapshot sent`.
     - Include context fields: `requestId`, `seq`, and `status` (`null` for Task 1).
   - Purpose:
     - Confirms ingest snapshot delivery during the Task 1 manual Playwright-MCP check.

8. [x] Server unit test: subscribe yields placeholder snapshot:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - Prefer adding to `server/src/test/unit/ws-server.test.ts`.
   - Description & purpose:
     - Validate that `subscribe_ingest` immediately produces an `ingest_snapshot` with `status: null` for the placeholder snapshot phase.
   - Requirements:
     - Add a test: sending `subscribe_ingest` yields an `ingest_snapshot` message.
     - Assert the snapshot contains `status: null`.
   - Concrete implementation guidance:
     - Reuse `server/src/test/support/wsClient.ts` helpers: `connectWs(...)`, `sendJson(...)`, `waitForEvent(...)`, `closeWs(...)`.

   - Example test skeleton (do not copy blindly; match file style):
     ```ts
     const ws = await connectWs({ baseUrl });
     sendJson(ws, { type: 'subscribe_ingest' });
     const event = await waitForEvent({
       ws,
       predicate: (e): e is { type: 'ingest_snapshot'; status: null } =>
         typeof e === 'object' && e !== null && (e as any).type === 'ingest_snapshot',
     });
     assert.equal(event.status, null);
     ```

9. [x] Update `design.md` with ingest WS subscribe/snapshot flow:
   - Documentation to read:
     - Mermaid syntax (Context7): `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid sequence diagram for `subscribe_ingest` → `ingest_snapshot` (placeholder/null status) flow.
     - Keep diagrams minimal and aligned with existing design.md style.

10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read:
     - ESLint CLI (Context7): `/eslint/eslint`
     - Prettier CLI (Context7): `/prettier/prettier`
   - Files to read:
     - `package.json` (root linting/formatting commands + fix scripts)

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `/ingest` and `/chat`, confirm the app loads without console errors and existing pages still render after WS message-type changes. Then open `/logs` and filter for `0000022 ingest ws snapshot sent` to confirm the snapshot log line was emitted.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed WS server types/registry/server flow and current unit test helpers to mirror existing chat subscription patterns before adding ingest handling.
- Lint/format pass required a small cleanup in `client/src/test/agentsPage.commandsRun.abort.test.tsx` (unused mock params removed, Prettier applied).
- Added ingest subscribe/unsubscribe client message types and parsing cases in `server/src/ws/types.ts`.
- Added ingest snapshot/update event type definitions in `server/src/ws/types.ts` wired to the shared `IngestJobStatus` shape.
- Extended `server/src/ws/registry.ts` with ingest subscription state plus subscribe/unsubscribe helpers and a sockets selector.
- Added per-socket ingest sequencing + snapshot helper in `server/src/ws/server.ts`, plus subscribe/unsubscribe handling that emits a placeholder snapshot and the required log line.
- Added a WS unit test for `subscribe_ingest` to confirm placeholder snapshot delivery (`server/src/test/unit/ws-server.test.ts`).
- Added a design diagram for the `subscribe_ingest` → placeholder `ingest_snapshot` flow in `design.md`.
- Re-ran workspace lint + format checks after each change; ESLint continues to emit pre-existing import-order warnings but no errors.
- Test: `npm run build --workspace server`.
- Test: `npm run build --workspace client` (Vite build succeeded; chunk-size warnings only).
- Test: `npm run test --workspace server` (initial runs timed out; completed with extended timeout).
- Test: `npm run test --workspace client` (fixed abort test mock to pass fetch init; rerun succeeded with expected console warnings).
- Test: `npm run e2e` (first run timed out; second run completed successfully).
- Test: `npm run compose:build`.
- Test: `npm run compose:up`.
- Manual check: Playwright MCP could not launch Chrome on Linux Arm64; verified `subscribe_ingest` snapshot log via WS + `/logs` API (`0000022 ingest ws snapshot sent`).
- Test: `npm run compose:down`.

---

### 2. Server: determine active ingest status for snapshots (`getActiveStatus`)

- Task Status: **__done__**
- Git Commits: **ca627be**

#### Overview

Implement `getActiveStatus()` so `ingest_snapshot` reflects the current active ingest run (and returns `null` if no run is active). Update the WS subscribe handler to use this function.

This task is deliberately separate from WS protocol plumbing (Task 1) and from broadcasting updates (Task 3).

#### Documentation Locations

- `ws` (WebSocket server for Node, v8.18.3): Context7 `/websockets/ws/8_18_3` — ensures the subscribe handler changes stay aligned with ws server behavior.
- `ws` DeepWiki: `websockets/ws` — validates noServer/handleUpgrade usage already present in the WS server.
- Node.js test runner (node:test): https://nodejs.org/api/test.html — used for the unit test updates in this task.
- Mermaid syntax (Context7): `/mermaid-js/mermaid` — required for the design.md ingest status selection flow diagram in this task.

#### Subtasks

1. [x] Read the ingest job state storage and lock behavior:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/ingest/ingestJob.ts` (in-memory `jobs` map + states)
     - `server/src/ingest/lock.ts` (lock owner + TTL)

2. [x] Implement `getActiveStatus()`:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
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

   - Must-not-miss details (repeat from acceptance criteria):
     - “No last run summary”: if all runs are terminal (`completed`, `cancelled`, `skipped`, `error`), this must return `null`.
     - The UI will treat `status: null` as “no active ingest” and hide the active-run panel.

   - Concrete implementation guidance (copy/paste friendly outline):
     - Define terminal states once (keep it local and obvious):
       ```ts
       const terminal = new Set<IngestRunState>(['completed', 'cancelled', 'skipped', 'error']);
       const isActive = (s: IngestJobStatus) => !terminal.has(s.state);
       ```
     - Prefer lock owner if possible:
       - Read `server/src/ingest/lock.ts` for `currentOwner()` signature.
       - If `currentOwner()` returns a runId and that run exists in `jobs` and is active, return it.
     - Fallback: iterate `jobs.values()` and return first active.

3. [x] Update WS subscribe handler to use `getActiveStatus()`:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - On `subscribe_ingest`, send `ingest_snapshot` with `status: getActiveStatus()`.
     - Snapshot must be sent immediately after subscribe is processed.

4. [x] Add server log line when resolving active ingest status:
   - Documentation to read:
     - Server logging overview: `design.md` (Logging section)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Log line requirements:
     - Inside `getActiveStatus()`, emit a `logLifecycle('info', ...)` entry.
     - Message must be exactly: `0000022 ingest active status resolved`.
     - Include context fields: `runId` (if any), `state` (if any), and `lockOwner` (result from `currentOwner()`).
   - Purpose:
     - Confirms snapshot selection logic runs during the Task 2 manual Playwright-MCP check.

5. [x] Server unit test: snapshot returns null when no active run:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ws-server.test.ts`
   - Description & purpose:
     - Ensure `subscribe_ingest` sends an `ingest_snapshot` with `status: null` when no active ingest exists.
   - Requirements:
     - Keep (or add) the `status: null` snapshot test and use existing WS helpers in this file.

6. [x] Server unit test: snapshot returns active run when non-terminal seeded:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ws-server.test.ts`
   - Description & purpose:
     - Validate that `subscribe_ingest` returns the seeded non-terminal `status.runId` in the snapshot.
   - Requirements:
     - Use existing helpers in `server/src/ingest/ingestJob.ts`: `__resetIngestJobsForTest()` + `__setStatusForTest()`.

7. [x] Unit test: `getActiveStatus()` prefers active lock owner:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ingest-status.test.ts`
   - Description & purpose:
     - When `currentOwner()` points to a non-terminal run, `getActiveStatus()` should return that run.
   - Requirements:
     - Use `acquire(...)` / `release(...)` from `server/src/ingest/lock.ts` and seed status via `__setStatusForTest()`.

8. [x] Unit test: `getActiveStatus()` falls back when lock owner is terminal:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ingest-status.test.ts`
   - Description & purpose:
     - If `currentOwner()` points to a terminal run but another active run exists, `getActiveStatus()` should return the active run from the jobs map.
   - Requirements:
     - Seed two runs (one terminal, one non-terminal) and control lock ownership with `acquire(...)`.

9. [x] Unit test: `getActiveStatus()` falls back when lock owner run is missing:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ingest-status.test.ts`
   - Description & purpose:
     - If `currentOwner()` points to a runId not present in the jobs map, `getActiveStatus()` should return the first active run found in the map.
   - Requirements:
     - Acquire a lock for a non-existent runId, seed a separate active run, and verify the active run is returned.

10. [x] Unit test: `getActiveStatus()` returns null when only terminal runs exist:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ingest-status.test.ts`
   - Description & purpose:
     - Ensure `getActiveStatus()` yields `null` when all runs are terminal (no last-run summary).
   - Requirements:
     - Seed terminal statuses only; verify `null` result.

11. [ ] Update `design.md` with ingest active-status selection flow:
   - Documentation to read:
     - Mermaid syntax (Context7): `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid flowchart or sequence showing lock owner + jobs map fallback logic for `getActiveStatus()`.
     - Note the “no last-run summary” rule when all runs are terminal.

12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read:
      - ESLint CLI (Context7): `/eslint/eslint`
      - Prettier CLI (Context7): `/prettier/prettier`
    - Files to read:
      - `package.json` (root linting/formatting commands + fix scripts)

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `/ingest`, start an ingest run, and confirm the UI remains stable (no crashes) while the server now returns active snapshots. Then open `/logs` and filter for `0000022 ingest active status resolved` to confirm the active-status log line appears.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed `ingestJob.ts` and `lock.ts` to confirm job storage and TTL lock semantics before implementing active status selection.
- Added `getActiveStatus()` in `ingestJob.ts` to prefer an active lock owner and fall back to the first non-terminal job while emitting the required lifecycle log.
- Updated WS `subscribe_ingest` handling to snapshot the active status (or null) and include it in the publish log context.
- Expanded WS unit coverage to reset ingest state per test and to assert active snapshots are returned when a non-terminal run exists.
- Added `getActiveStatus()` unit tests covering lock-preference, lock fallback cases, and terminal-only results.
- Test: `npm run build --workspace server`.
- Test: `npm run build --workspace client` (chunk-size warnings only).
- Test: `npm run test --workspace server` (initial runs timed out; completed with extended timeout).
- Test: `npm run test --workspace client` (expected console warnings from test logs).
- Test: `npm run e2e` (initial run timed out; rerun succeeded).
- Test: `npm run compose:build`.
- Test: `npm run compose:up`.
- Manual check: Playwright MCP browser install failed on Linux Arm64; attempted WS subscribe + `/logs` filter, but the expected `0000022 ingest active status resolved` entry could not be confirmed in the log stream.
- Test: `npm run compose:down`.

---

### 3. Server: broadcast ingest progress/status changes over WS (`ingest_update`)

- Task Status: **__done__**
- Git Commits: **3a62740**

#### Overview

Broadcast `ingest_update` messages whenever the server-side ingest status changes, so any subscribed Ingest page receives progress updates in real time.

This task completes the server-side realtime path for ingest by wiring status updates in `ingestJob.ts` into the WS ingest stream created in Tasks 1–2.

#### Documentation Locations

- `ws` (WebSocket server for Node, v8.18.3): Context7 `/websockets/ws/8_18_3` — provides the broadcast/send patterns and heartbeat notes that match this task’s WS updates.
- `ws` DeepWiki: `websockets/ws` — confirms recommended ping/pong heartbeat and server patterns used in our WS server.
- Node.js test runner (node:test): https://nodejs.org/api/test.html — used for the new WS unit test coverage.
- Mermaid syntax (Context7): `/mermaid-js/mermaid` — required for the design.md ingest update broadcast flow diagram in this task.

#### Subtasks

1. [x] Read the ingest status lifecycle to identify every status update point:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/ingest/ingestJob.ts` (all `jobs.set(...)` call sites)
     - `server/src/routes/ingestStart.ts` and `server/src/routes/ingestCancel.ts` (existing REST control surface)

2. [x] Implement WS broadcast helper:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - Add a `broadcastIngestUpdate(status)` implementation (follow the existing `publish*` patterns in `server/src/ws/server.ts`).
      - Reuse existing WS send patterns:
        - Mirror `server/src/ws/sidebar.ts` broadcast loop (stringify once, skip non-open sockets).
        - Use `safeSend(...)` where appropriate instead of creating a new send utility.
      - It must send `{ type: 'ingest_update', status, seq }` to all sockets returned by `socketsSubscribedToIngest()`.
      - `seq` must be bumped per socket (monotonic per socket) the same way `ingest_snapshot` is sent.

   - Must-not-miss details (repeat from acceptance criteria + contracts):
     - Single global stream: do not filter by `runId` in the subscription message.
     - Page-scoped updates: only sockets that are subscribed receive updates.
     - Message envelope (exact keys):
       ```json
       { "protocolVersion": "v1", "type": "ingest_update", "seq": 2, "status": { "runId": "r1", "state": "embedding", "counts": { "files": 3, "chunks": 12, "embedded": 4 } } }
       ```

   - Concrete implementation guidance:
     - Reuse the same approach as other broadcast helpers:
       - Get sockets via `socketsSubscribedToIngest()`.
       - For each socket, if `ws.readyState !== WebSocket.OPEN`, skip.
       - Call `safeSend(ws, event)`.
     - Keep `seq` per socket (use the same `nextIngestSeq(ws)` introduced in Task 1).

3. [x] Add server log line for ingest update broadcasts:
   - Documentation to read:
     - Server logging overview: `design.md` (Logging section)
   - Files to edit:
     - `server/src/ws/server.ts`
   - Log line requirements:
     - Inside `broadcastIngestUpdate(...)`, emit a `logPublish(...)` entry.
     - Message must be exactly: `0000022 ingest ws update broadcast`.
     - Include context fields: `runId`, `state`, `seq`, and `subscriberCount`.
   - Purpose:
     - Confirms realtime broadcasts occur during the Task 3 manual Playwright-MCP check.

4. [x] Add a status publish helper:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Introduce a tiny helper (example name): `setStatusAndPublish(runId, nextStatus)`.
       - It must call `jobs.set(runId, nextStatus)`.
       - It must call `broadcastIngestUpdate(nextStatus)`.
     - Keep existing REST behavior unchanged.

5. [x] Replace status writes with the publish helper:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Replace every `jobs.set(runId, ...)` that represents a user-visible status/progress change with the helper.
       - This includes the initial `queued` status set in `startIngest(...)`.
       - This includes progress updates inside `progressSnapshot(...)`.
       - This includes terminal states: `completed`, `skipped`, `cancelled`, `error`.

   - Must-not-miss details (repeat from acceptance criteria):
     - There must be **no polling fallback** on the client. This means server WS updates are the only realtime source.
     - Ensure there is at least one `ingest_update` emitted during a run (queued/scanning/embedding/progress), otherwise the UI will appear stuck.

   - Concrete implementation guidance:
     - Do not change the shape of `IngestJobStatus` returned by REST.
     - Prefer a helper that accepts a full status object (no partial merge magic).
     - Example pattern:
       ```ts
       function setStatusAndPublish(runId: string, nextStatus: IngestJobStatus) {
         jobs.set(runId, nextStatus);
         broadcastIngestUpdate(nextStatus);
       }
       ```

6. [x] Ensure cancel flows publish a final update:
   - Documentation to read:
     - `ws` docs: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/ingest/ingestJob.ts` (`cancelRun`)
   - Requirements:
     - When cancellation sets the state to `cancelled`, an `ingest_update` must be broadcast.

7. [x] Server unit test: `ingest_update` emitted on status change:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ws-server.test.ts`
   - Description & purpose:
     - Ensure a subscribed socket receives an `ingest_update` when status changes.
   - Requirements:
     - Connect a WS client, send `subscribe_ingest`, then call `__setStatusAndPublishForTest(...)` and assert `status.state` matches.

8. [x] Server unit test: per-socket `seq` increases for subsequent updates:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ws-server.test.ts`
   - Description & purpose:
     - Validate that successive `ingest_update` messages from the same socket have increasing `seq` values.
   - Requirements:
     - Publish two updates via `__setStatusAndPublishForTest(...)` and assert `seq` increases.

9. [x] Server unit test: `unsubscribe_ingest` stops updates:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Test type:
     - node:test unit test (server)
   - Test location:
     - `server/src/test/unit/ws-server.test.ts`
   - Description & purpose:
     - Ensure sockets that unsubscribe do not receive further `ingest_update` frames.
   - Requirements:
     - Subscribe, then unsubscribe, then publish a status update and assert no `ingest_update` arrives within ~200–300ms.

   - Shared test setup guidance:
     - Add a new test-only helper in `server/src/ingest/ingestJob.ts`:
       - `__setStatusAndPublishForTest(runId: string, status: IngestJobStatus)`
       - Guarded like existing helpers (`NODE_ENV === 'test'`).
       - Must call the same internal `setStatusAndPublish(...)` used in production.

10. [x] Update `design.md` with ingest update broadcast flow:
   - Documentation to read:
     - Mermaid syntax (Context7): `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid sequence showing `setStatusAndPublish(...)` → `broadcastIngestUpdate` → subscribed sockets.
     - Call out per-socket `seq` behavior in diagram notes.

11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read:
      - ESLint CLI (Context7): `/eslint/eslint`
      - Prettier CLI (Context7): `/prettier/prettier`
    - Files to read:
      - `package.json` (root linting/formatting commands + fix scripts)

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `/ingest` in two tabs and confirm no regressions while server broadcast logic is active (page renders, no JS errors). Then open `/logs` and filter for `0000022 ingest ws update broadcast` to confirm update broadcasts were logged.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed ingest job lifecycle in `ingestJob.ts` plus ingest start/cancel routes to map every `jobs.set(...)` status transition that will need WS publishing.
- Added `broadcastIngestUpdate` to the WS server to emit `ingest_update` events with per-socket sequencing and a `0000022 ingest ws update broadcast` log line.
- Introduced `setStatusAndPublish(...)` in `ingestJob.ts` and replaced user-facing status writes (queued/scanning/embedding/progress/terminal states) to trigger WS updates.
- Cancellation paths now publish a terminal `cancelled` update via the shared helper.
- Added WS unit tests for ingest update delivery, per-socket seq increments, and unsubscribe suppression using the new `__setStatusAndPublishForTest` helper.
- Documented the ingest update broadcast flow and per-socket sequencing note in `design.md`.
- Lint completed with existing import-order warnings; ran Prettier (`format --workspaces`) after the initial `format:check` failure and revalidated successfully.
- Test: `npm run build --workspace server`.
- Test: `npm run build --workspace client` (Vite chunk-size warnings only).
- Test: `npm run test --workspace server` (unit suite completed; integration run failed with ChromaConnectionError while starting cucumber scenarios).
- Test: `npm run test --workspace client` (passes with existing console log output).
- Test: `npm run e2e` (compose e2e build/up/test/down succeeded).
- Test: `npm run compose:build` (completed; client build emitted chunk-size warnings).
- Test: `npm run compose:up`.
- Manual check: Playwright MCP could not launch Chrome on Linux Arm64 (`browserType.launchPersistentContext` missing browser); unable to complete `/chat`, `/agents`, and `/logs` verification.
- Test: `npm run compose:down`.
- Recorded task commit hashes in the plan after completing implementation and test runs.
- Test: `npm run test --workspace server` (initial runs timed out; completed with extended timeout).
- Test: `npm run test --workspace client` (expected console warnings from log tests).
- Test: `npm run e2e` (first run timed out; rerun succeeded).
- Test: `npm run compose:build`.
- Test: `npm run compose:up`.
- Manual check: Playwright MCP could not launch Chrome on Linux Arm64; validated `0000022 ingest ws update broadcast` entries via WS subscribe + `/logs` filter instead.
- Test: `npm run compose:down`.

---

### 4. Client: extend `useChatWs` with ingest subscription + ingest event types

- Task Status: **__done__**
- Git Commits: **36f073f, a6f7ab6**

#### Overview

Extend the existing `useChatWs` WebSocket transport so it can subscribe to ingest and pass ingest events through the same socket + reconnect pipeline.

This task intentionally does **not** change the Ingest page or ingest status hook yet; it only makes the shared WS transport capable of ingest.

#### Documentation Locations

- WebSocket browser API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API — confirms client-side WebSocket interface/events for `useChatWs`.
- React `useEffect` docs: https://react.dev/reference/react/useEffect — validates subscribe/unsubscribe cleanup behavior for hooks.
- React Router v7.9.4: Context7 `/remix-run/react-router/react-router_7.9.4` — aligns with the routing APIs used in the client.
- Jest timer mocks: Context7 `/websites/jestjs_io_next` (Timer Mocks) + https://jestjs.io/docs/timer-mocks — used for fake timer patterns in `useChatWs` tests.
- Mermaid syntax (Context7): `/mermaid-js/mermaid` — required for the design.md client WS subscription flow in this task.

#### Subtasks

1. [x] Read existing WS client patterns and test utilities:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - React hooks `useEffect`: https://react.dev/reference/react/useEffect
     - React Router: Context7 `/remix-run/react-router/react-router_7.9.4`
     - Jest timer mocks: https://jestjs.io/docs/timer-mocks
   - Files to read:
     - `client/src/hooks/useChatWs.ts` (connect/reconnect/subscription patterns)
     - `client/src/test/support/mockWebSocket.ts` (WS mocking)
     - `client/src/test/useChatWs.test.ts` (hook tests)

2. [x] Extend `useChatWs` outbound API for ingest:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - React hooks `useEffect`: https://react.dev/reference/react/useEffect
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
   - Requirements:
     - Reuse the existing `useChatWs` connection/reconnect/pending queue; do **not** create a new WS hook or a second socket.
     - Add new outbound helpers:
       - `subscribeIngest(): void`
       - `unsubscribeIngest(): void`
     - Track ingest subscription state in a ref (mirrors sidebar subscription handling).
     - On reconnect (socket re-open), if ingest is subscribed, automatically re-send `subscribe_ingest`.

   - Must-not-miss details (repeat from story acceptance criteria):
     - Page-scoped updates depend on subscribe/unsubscribe; **do not** subscribe by default.
     - Message envelope must match server parsing:
       ```json
       { "protocolVersion": "v1", "requestId": "<uuid>", "type": "subscribe_ingest" }
       ```
       ```json
       { "protocolVersion": "v1", "requestId": "<uuid>", "type": "unsubscribe_ingest" }
       ```

   - Concrete implementation guidance (copy/paste friendly outline; adjust for file style):
     - Add a subscription ref alongside the existing sidebar + conversation refs:
       ```ts
       const ingestSubscribedRef = useRef(false);
       ```
     - Add the two helpers mirroring `subscribeSidebar` / `unsubscribeSidebar`:
       ```ts
       const subscribeIngest = useCallback(() => {
         if (!realtimeEnabled) return;
         ingestSubscribedRef.current = true;
         sendRaw({ type: 'subscribe_ingest' });
       }, [realtimeEnabled, sendRaw]);

       const unsubscribeIngest = useCallback(() => {
         if (!realtimeEnabled) return;
         ingestSubscribedRef.current = false;
         sendRaw({ type: 'unsubscribe_ingest' });
       }, [realtimeEnabled, sendRaw]);
       ```
     - In the existing `ws.onopen` resubscribe block, add:
       ```ts
       if (ingestSubscribedRef.current) {
         sendRaw({ type: 'subscribe_ingest' });
       }
       ```
     - Add the two functions to the returned object and to the `UseChatWsState` type.

3. [x] Add ingest event typing (do not change seq gating):
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
   - Requirements:
     - Extend the inbound event typing to include `ingest_snapshot` and `ingest_update` events.
     - Do not change `useChatWs` seq-gating behavior for these ingest events.
       - Rationale: `useChatWs` is shared by Chat and Agents; minimizing changes here reduces regression risk.
     - Ingest events do not include `conversationId`, so they will naturally bypass the existing seq-gating logic.
     - Ensure Chat/Agents behavior remains unchanged.

   - Must-not-miss details:
     - The client will treat `ingest_snapshot.status === null` as “no active run”.
     - Even though ingest events have a `seq`, they must **not** be forced into the chat inflight seq keys.

   - Concrete implementation guidance:
     - Define a reusable status payload type in this file (so `useIngestStatus` can import it):
       - File to edit: `client/src/hooks/useChatWs.ts`
       - Example shape (keep in sync with server `/ingest/status/:runId`):
         ```ts
         export type ChatWsIngestStatus = {
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
     - Add two new inbound event types:
       ```ts
       type WsIngestSnapshotEvent = WsServerEventBase & {
         type: 'ingest_snapshot';
         seq: number;
         status: ChatWsIngestStatus | null;
       };

       type WsIngestUpdateEvent = WsServerEventBase & {
         type: 'ingest_update';
         seq: number;
         status: ChatWsIngestStatus;
       };
       ```
     - Extend `WsServerEvent` union to include these new types.
     - Export a convenience union for callers:
       ```ts
       export type ChatWsIngestEvent = WsIngestSnapshotEvent | WsIngestUpdateEvent;
       ```

4. [x] Add client log line when WS events are forwarded:
   - Documentation to read:
     - Client logging: `client/src/logging/logger.ts`
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
   - Log line requirements:
     - Use the existing `createLogger('client')` instance.
     - Immediately before invoking `onEventRef.current?.(msg)`, emit a log entry.
     - Message must be exactly: `0000022 ws event forwarded`.
     - Include context fields: `eventType` (msg.type) and `conversationId` if present.
   - Purpose:
     - Confirms WS event dispatch still works after adding ingest event types.

5. [x] Client hook test: `subscribeIngest()` sends `subscribe_ingest`:
   - Documentation to read:
     - Jest timer mocks: https://jestjs.io/docs/timer-mocks
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/useChatWs.test.ts`
   - Description & purpose:
     - Ensure the outbound WS message is sent when a component subscribes to ingest.
   - Requirements:
     - Use the mock WS registry helpers (`lastSocket()`, `getSentTypes(...)`).

6. [x] Client hook test: `unsubscribeIngest()` sends `unsubscribe_ingest`:
   - Documentation to read:
     - Jest timer mocks: https://jestjs.io/docs/timer-mocks
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/useChatWs.test.ts`
   - Description & purpose:
     - Ensure page-scoped updates are cancelled when unsubscription is requested.
   - Requirements:
     - Assert outbound payload includes `type: 'unsubscribe_ingest'`.

7. [x] Client hook test: resubscribe after reconnect when ingest is subscribed:
   - Documentation to read:
     - Jest timer mocks: https://jestjs.io/docs/timer-mocks
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/useChatWs.test.ts`
   - Description & purpose:
     - Validate that reconnect logic re-sends `subscribe_ingest` when the ref indicates an active subscription.
   - Requirements:
     - Close the socket and assert a new socket sends `subscribe_ingest` again.
   - Concrete test skeleton (do not copy blindly; match file style):
     ```ts
     it('re-sends subscribe_ingest after reconnect', async () => {
       const { result } = renderHook(() => useChatWs());
       await waitFor(() => expect(result.current.connectionState).toBe('open'));

       act(() => {
         result.current.subscribeIngest();
       });

       const first = lastSocket();
       act(() => {
         first.close();
       });

       await waitFor(() => expect(wsRegistry().instances.length).toBeGreaterThan(1));
       const subscribeCount = getSentMessages().filter(
         (msg) => msg.type === 'subscribe_ingest',
       ).length;
       expect(subscribeCount).toBeGreaterThanOrEqual(2);
     });
     ```

8. [x] Client hook test: no resubscribe after `unsubscribeIngest()`:
   - Documentation to read:
     - Jest timer mocks: https://jestjs.io/docs/timer-mocks
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/useChatWs.test.ts`
   - Description & purpose:
     - Ensure reconnect does **not** re-send `subscribe_ingest` after a user unsubscribes.
   - Requirements:
     - Call `unsubscribeIngest()`, reconnect, and assert no new `subscribe_ingest` payload is sent.

   - Test constraints:
     - Do not add ingest-specific seq-gating tests (ingest events bypass chat seq logic).

9. [x] Client hook test: ingest events reach `onEvent` without conversationId:
   - Documentation to read:
     - Jest timer mocks: https://jestjs.io/docs/timer-mocks
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/useChatWs.test.ts`
   - Description & purpose:
     - Ensure `ingest_snapshot` / `ingest_update` events (no `conversationId`) still invoke the `onEvent` callback.
   - Requirements:
     - Provide an `onEvent` mock when rendering the hook.
     - Inject a fake WS message (e.g. `ingest_snapshot`) via `lastSocket()._receive(...)`.
     - Assert the handler receives the exact event object.

10. [x] Documentation update (task-local):
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `planning/plan_format.md`
   - Files to edit:
     - `planning/0000022-ingest-ws-streaming-and-layout.md` (this file)
   - Requirements:
     - Fill in this task’s Implementation notes as you implement.
     - Record the commit hash(es) in this task’s Git Commits.

11. [x] Update `design.md` with client ingest WS subscription flow:
    - Documentation to read:
      - Mermaid syntax (Context7): `/mermaid-js/mermaid`
    - Files to edit:
      - `design.md`
    - Requirements:
      - Add a Mermaid sequence showing `useChatWs` connect → `subscribe_ingest` → reconnect resubscribe behavior.
      - Note that ingest events bypass chat seq gating.

12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read:
      - ESLint CLI (Context7): `/eslint/eslint`
      - Prettier CLI (Context7): `/prettier/prettier`
    - Files to read:
      - `package.json` (root linting/formatting commands + fix scripts)

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `/chat` and `/agents`, send a message, and confirm WS transcripts still stream correctly after `useChatWs` changes. Then open `/logs` and filter for `0000022 ws event forwarded` (source `client`) to confirm the dispatch log line is emitted.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed `useChatWs` hook behavior, mock WebSocket utilities, and existing tests to align ingest subscription work with current reconnect/subscribe patterns.
- Added ingest WebSocket event types plus `subscribeIngest`/`unsubscribeIngest` helpers that resubscribe on reconnect using the existing socket lifecycle.
- Extended inbound WS typing to include ingest snapshot/update events while leaving the seq gate logic untouched, and exported a shared ingest status/event type for downstream hooks.
- Added the `0000022 ws event forwarded` client log right before dispatching WS events to subscribers.
- Added client hook coverage for ingest subscribe/unsubscribe, reconnect resubscribe behavior, and ingest event forwarding.
- Documented the client ingest WS subscription and reconnect flow in `design.md`, including the note about bypassing chat seq gating.
- Lint completed with existing server import-order warnings; Prettier required `format --workspaces` to fix `useChatWs` test formatting before re-checking cleanly.
- Test: `npm run build --workspace server`.
- Test: `npm run build --workspace client` (Vite chunk-size warnings only).

---

### 5. Client: refactor `useIngestStatus` to be WS-driven (remove polling)

- Task Status: **__in_progress__**
- Git Commits: **__to_do__**

#### Overview

Refactor the existing ingest status hook to use WebSocket `ingest_snapshot` / `ingest_update` events instead of polling `/ingest/status/:runId`.

This task does not change the Ingest page layout yet; it only changes how status is sourced.

#### Documentation Locations

- WebSocket browser API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API — confirms WebSocket event semantics for ingest status updates.
- React `useEffect` docs: https://react.dev/reference/react/useEffect — validates hook cleanup for subscribe/unsubscribe.
- Jest docs (Context7): `/websites/jestjs_io_next` — required reference for the Jest tests added in this task.
- Mermaid syntax (Context7): `/mermaid-js/mermaid` — required for the design.md ingest hook flow diagram in this task.

#### Subtasks

1. [x] Read current polling hook behavior:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - React hooks `useEffect`: https://react.dev/reference/react/useEffect
   - Files to read:
     - `client/src/hooks/useIngestStatus.ts`
     - `client/src/components/ingest/ActiveRunCard.tsx` (data it expects)
     - `client/src/hooks/useChatWs.ts` (new ingest event types to consume)
     - `client/src/test/support/mockWebSocket.ts` (WS mocking)

2. [x] Remove polling + update hook signature/state:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Requirements:
     - Remove polling/timers and any fetches to `/ingest/status/:runId`.
     - Remove the `runId` parameter from the hook signature.
     - Store status as `ChatWsIngestStatus | null` (WS-driven state).

3. [x] Wire WS subscription + event handling:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - React hooks `useEffect`: https://react.dev/reference/react/useEffect
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Requirements:
     - Use `useChatWs` with an `onEvent` handler to capture `ingest_snapshot` / `ingest_update`.
       - Only handle these two event types; ignore everything else.
     - Subscribe to ingest only while the hook is mounted:
       - Call `subscribeIngest()` in a `useEffect(..., [])`.
       - Call `unsubscribeIngest()` in the cleanup function.
       - This cleanup pattern mirrors the React `useEffect` guidance for subscribing/unsubscribing external resources.

4. [x] Add client log lines for ingest WS events:
   - Documentation to read:
     - Client logging: `client/src/logging/logger.ts`
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Log line requirements:
     - Instantiate a logger via `createLogger('client-ingest')`.
     - When handling `ingest_snapshot`, emit message `0000022 ingest status snapshot received` with context `{ runId, state }` (or `null` when no run).
     - When handling `ingest_update`, emit message `0000022 ingest status update received` with context `{ runId, state }`.
   - Purpose:
     - Confirms the WS-driven hook is processing ingest events during the Task 5 manual Playwright-MCP check.

5. [x] Expose a minimal, predictable WS-driven API:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Requirements:
     - Return the core fields:
       - `status: ChatWsIngestStatus | null`
       - `connectionState: ChatWsConnectionState` (from `useChatWs`)
     - Preserve existing cancel/error affordances for the UI:
       - Keep `isCancelling` and `cancel()` (rest cancel endpoint).
       - Keep `error` for cancel failures only (no polling error state).
       - Derive `isLoading` from `connectionState === 'connecting'` so ActiveRunCard can disable the cancel button while WS connects.

   - Must-not-miss details (repeat from acceptance criteria):
     - WS-only: there is **no polling fallback**.
     - Snapshot on subscribe is required: the first status should typically come from `ingest_snapshot`.
     - When `status === null`, the UI must hide the active-run panel.

   - Concrete implementation guidance (copy/paste friendly outline):
     ```ts
     import { useEffect, useMemo, useState, useCallback } from 'react';
     import { useChatWs, type ChatWsIngestStatus, type ChatWsConnectionState } from './useChatWs';

     export function useIngestStatus() {
       const [status, setStatus] = useState<ChatWsIngestStatus | null>(null);

       const { connectionState, subscribeIngest, unsubscribeIngest } = useChatWs({
         onEvent: (event) => {
           if (event.type === 'ingest_snapshot') setStatus(event.status);
           if (event.type === 'ingest_update') setStatus(event.status);
         },
       });

       useEffect(() => {
         subscribeIngest();
         return () => unsubscribeIngest();
       }, [subscribeIngest, unsubscribeIngest]);

       return { status, connectionState };
     }
     ```

6. [x] Keep cancel behavior via REST (server unchanged):
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Requirements:
     - Keep a `cancel()` function that calls `POST /ingest/cancel/:runId`.
     - It must use the current WS run id: `status?.runId`.
     - It must be safe to call when `status === null` (no-op).
     - Return `isCancelling` so the UI can disable the cancel button.
   - Concrete implementation guidance:
     - Reuse the existing `serverBase` constant for building URLs.
     - Prefer not to optimistically mutate `status` on success; allow the server’s `ingest_update` to drive the final state.

7. [x] Refactor ingest status tests to use WS mocking (shared setup):
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
     - `client/src/test/ingestStatus.progress.test.tsx`
   - Description & purpose:
     - Remove polling assertions and replace fetch mocking with WS event injection.
   - Requirements:
     - Use `client/src/test/support/mockWebSocket.ts` and the registry from `client/src/test/setupTests.ts`.

8. [x] Hook test: cancel uses REST endpoint with current `status.runId`:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Ensure `cancel()` hits `POST /ingest/cancel/:runId` when a run is active.
   - Requirements:
     - Seed a WS `ingest_update` with a runId and assert the fetch call uses that id.

9. [x] Hook test: `ingest_snapshot` with `status: null` clears active status:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Validate the UI hides the active-run panel when the snapshot reports no active run.
   - Requirements:
     - Emit `ingest_snapshot` with `status: null` and assert status becomes `null`.

10. [x] Hook test: `cancel()` is a no-op when `status === null`:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Ensure no network call is made when there is no active run.
   - Requirements:
     - Call `cancel()` before any status arrives and assert no fetch occurs.

11. [x] Hook test: unmount sends `unsubscribe_ingest`:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest hook/unit test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Confirm page-scoped updates by unsubscribing on unmount.
   - Requirements:
     - Unmount the hook and assert an outbound `unsubscribe_ingest` frame.

12. [x] Progress test: current file + percent/ETA update from WS events:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest component/integration test (client)
   - Test location:
     - `client/src/test/ingestStatus.progress.test.tsx`
   - Description & purpose:
     - Verify progress UI updates as `ingest_update` events stream in.
   - Requirements:
     - Emit multiple `ingest_update` events and assert `data-testid="ingest-current-file"`, percent, and ETA text update.

   - Concrete implementation guidance:
     - Example event injection:
       ```ts
       act(() => {
         lastSocket()._receive({
           protocolVersion: 'v1',
           type: 'ingest_update',
           seq: 1,
           status: { runId: 'run-1', state: 'embedding', counts: { files: 1, chunks: 0, embedded: 0 } },
         });
       });
       ```

13. [ ] Documentation update (task-local):
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `planning/plan_format.md`
   - Files to edit:
     - `planning/0000022-ingest-ws-streaming-and-layout.md` (this file)
   - Requirements:
     - Fill in this task’s Implementation notes as you implement.
     - Record the commit hash(es) in this task’s Git Commits.

14. [x] Update `design.md` with ingest status hook flow:
    - Documentation to read:
      - Mermaid syntax (Context7): `/mermaid-js/mermaid`
    - Files to edit:
      - `design.md`
    - Requirements:
      - Add a Mermaid sequence showing `useIngestStatus` subscribing and handling `ingest_snapshot` / `ingest_update` events.
      - Note that polling was removed and WS is the only source of status.

15. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read:
      - ESLint CLI (Context7): `/eslint/eslint`
      - Prettier CLI (Context7): `/prettier/prettier`
    - Files to read:
      - `package.json` (root linting/formatting commands + fix scripts)

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `/ingest`, start an ingest run, and confirm the Active run UI updates via WS without polling. Then open `/logs` and filter for `0000022 ingest status snapshot received` and `0000022 ingest status update received` (source `client-ingest`).
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed the existing polling-based `useIngestStatus`, ActiveRunCard expectations, and WS test helpers to map the required WS-driven shape and cleanup points before refactoring.
- Rebuilt `useIngestStatus` to subscribe via `useChatWs`, log ingest snapshot/update events, expose WS connection state, and keep cancel-only error handling while dropping polling.
- Updated the ingest status tests to inject `ingest_snapshot`/`ingest_update` events through the shared WebSocket mock and assert cancel/unsubscribe behaviors.
- Added a progress UI test driven by WS updates and documented the WS-only hook flow in `design.md`.
- Ran lint and format checks; Prettier fixed `IngestPage.tsx`, and existing server import-order lint warnings remain unchanged.
- Verified `npm run build --workspace server` completes successfully.
- Verified `npm run build --workspace client` completes successfully (rollup chunk size warnings only).
- Verified `npm run test --workspace server` after clearing stale testcontainers/Mongo/Chroma containers and allowing a longer timeout for the full suite.
- Verified `npm run test --workspace client` (tests pass; existing console warnings from logging/act remain).
- Verified `npm run e2e` (compose:e2e build/up/test/down; 36 tests passed).
- Verified `npm run compose:build` completes successfully (client chunk size warnings only).
- Verified `npm run compose:up` starts the stack successfully.
- Manual Playwright-MCP check could not be completed: Playwright chrome launch failed, chromium was installed and symlinked, but the MCP transport closed after restart attempts.
- Verified `npm run compose:down` stops the stack successfully.
- Added a useChatWs cleanup unsubscribe for ingest to ensure unmounts emit `unsubscribe_ingest`, aligning the new hook tests with page-scoped WS behavior.

---

### 6. Client: switch Ingest page to WS-only run UI (no last-run summary)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Make `/ingest` use the WS-based `useIngestStatus()` output and enforce the story’s UI rules: show only an active run (no last-run summary), and show an explicit error when WS is unavailable.

#### Documentation Locations

- WebSocket browser API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API — confirms client WebSocket lifecycle used by the ingest page state.
- React Router (routing semantics): Context7 `/remix-run/react-router/react-router_7.9.4` — aligns with the router setup used in the app.
- Jest docs (Context7): `/websites/jestjs_io_next` — required reference for the Jest page/component tests added in this task.
- Mermaid syntax (Context7): `/mermaid-js/mermaid` — required for the design.md ingest page WS UI flow diagram in this task.

#### Subtasks

1. [ ] Read current ingest page behavior:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - React Router: Context7 `/remix-run/react-router/react-router_7.9.4`
   - Files to read:
     - `client/src/pages/IngestPage.tsx`
     - `client/src/hooks/useIngestStatus.ts`
     - `client/src/components/ingest/ActiveRunCard.tsx`

2. [ ] Remove local run tracking and derive active status from WS:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Remove the `activeRunId` state from the page. The ingest run ID must come from WebSocket `status.runId` (global stream; no runId filters).
     - The page must render ingest progress from WS only.
     - “No last run summary” rule:
       - When there is no active run (`status === null`), hide/omit the “Active ingest / Active run” card entirely.
       - When a terminal state is received (`completed`, `cancelled`, `error`, `skipped`), immediately treat the run as inactive for rendering (do not keep a last-run summary panel).

3. [ ] Preserve page behavior for active runs:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Preserve disabled-state behavior:
       - Disable `IngestForm` + `RootsTable` actions while an active run is in progress, derived from the WS status (non-terminal states only).
     - Keep cancel functionality working using the existing REST endpoint (`POST /ingest/cancel/:runId`) using the WS status’ `runId`.
     - Preserve existing “refresh roots/models after completion” behavior:
       - When a terminal state is received, call `refetchRoots()` and `refresh()` (models) once.
       - After scheduling refresh, clear/hide the active run UI (consistent with “no last run summary”).
    - Ensure page-scoped updates:
      - Only subscribe while `/ingest` is mounted (this should naturally happen if only `IngestPage` mounts `useIngestStatus()`).

   - Must-not-miss details (repeat from acceptance criteria):
     - WS-only: there must be **no** `/ingest/status/:runId` timer in this page.
     - Single global stream: do not filter by runId.
     - No last-run summary: after terminal, the active panel must disappear.

   - Concrete implementation guidance:
     - Replace `const status = useIngestStatus(activeRunId);` with `const ingest = useIngestStatus();`.
     - Derive active status for rendering (terminal states treated as inactive):
       ```ts
       const active =
         ingest.status && !terminalStates.has(ingest.status.state)
           ? ingest.status
           : null;
       ```
    - Render the `ActiveRunCard` only when `active !== null` and pass `runId={active.runId}` so logs/cancel wiring remains intact.
     - Keep refresh-on-terminal logic, but trigger it off WS state transitions:
       - Use a `useRef<string | null>` to ensure refresh runs only once per `runId:state`.

4. [ ] Add client log line when terminal state triggers refresh/hide:
   - Documentation to read:
     - Client logging: `client/src/logging/logger.ts`
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Log line requirements:
     - Use the page’s existing `createLogger` instance.
     - When a terminal status triggers `refetchRoots()` / `refresh()`, emit `0000022 ingest ui terminal refresh`.
     - Include context fields: `runId` and `state`.
   - Purpose:
     - Confirms terminal-state handling during the Task 6 manual Playwright-MCP check.

5. [ ] Keep start callbacks wired without local run state:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
     - `client/src/components/ingest/IngestForm.tsx`
     - `client/src/components/ingest/RootsTable.tsx`
   - Requirements:
    - Because `activeRunId` is removed:
      - `RootsTable`’s `onRunStarted` is already optional — you can omit it entirely.
      - `IngestForm`’s `onStarted` is required today — either pass a no-op or make the prop optional.
      - Do **not** re-introduce local runId tracking in the page.

6. [ ] Add a stable status chip test id:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/components/ingest/ActiveRunCard.tsx`
   - Requirements:
     - Add `data-testid="ingest-status-chip"` to the status `Chip`.

7. [ ] Add explicit WS connection UI states:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - When `ingest.connectionState === 'connecting'`, show an info `Alert` (not error) with a short message like “Connecting to realtime updates…”.
     - When `ingest.connectionState === 'closed'`, show an error `Alert` with a short message like “Realtime updates unavailable. Refresh the page once the server is reachable.”
     - Add stable testids:
       - `data-testid="ingest-ws-connecting"`
       - `data-testid="ingest-ws-unavailable"`

8. [ ] Page test: snapshot renders immediately on subscribe:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest page/component test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Ensure `ingest_snapshot` immediately drives UI state without polling.
   - Requirements:
     - Inject a snapshot and assert status UI updates (e.g. chip or run panel appears).

9. [ ] Page test: no Active ingest UI when `status === null`:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest page/component test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Validate the “no last-run summary” rule hides the panel when idle.
   - Requirements:
     - Emit `ingest_snapshot` with `status: null` and assert the Active ingest UI is absent.

10. [ ] Page test: WS closed shows explicit error state:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest page/component test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Ensure WS unavailability is surfaced with the `ingest-ws-unavailable` alert.
   - Requirements:
     - Drive `connectionState === 'closed'` and assert `data-testid="ingest-ws-unavailable"` exists.

11. [ ] Page test: WS connecting shows non-error state:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest page/component test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Ensure connection-in-progress surfaces `ingest-ws-connecting` without error styling.
   - Requirements:
     - Drive `connectionState === 'connecting'` and assert `data-testid="ingest-ws-connecting"` exists.

12. [ ] Page test: terminal state triggers refresh + hides active panel:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Test type:
     - Jest page/component test (client)
   - Test location:
     - `client/src/test/ingestStatus.test.tsx`
   - Description & purpose:
     - Ensure terminal runs trigger `refetchRoots()` / `refresh()` once and remove the Active ingest panel.
   - Requirements:
     - Emit an `ingest_update` with a terminal state and assert refresh callbacks and panel removal.

   - Shared test guidance:
     - Use the WS mock to inject `ingest_snapshot` / `ingest_update` into the mounted page.
     - Use `data-testid="ingest-status-chip"` and absence of “Active ingest” heading as stable selectors.

13. [ ] Documentation update (task-local):
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `planning/plan_format.md`
   - Files to edit:
     - `planning/0000022-ingest-ws-streaming-and-layout.md` (this file)
   - Requirements:
     - Fill in this task’s Implementation notes as you implement.
     - Record the commit hash(es) in this task’s Git Commits.

14. [ ] Update `design.md` with ingest page WS-only UI flow:
    - Documentation to read:
      - Mermaid syntax (Context7): `/mermaid-js/mermaid`
    - Files to edit:
      - `design.md`
    - Requirements:
      - Add a Mermaid diagram showing WS connection states (connecting/open/closed) and UI rendering rules (no last-run summary).
      - Call out the refresh-on-terminal behavior in the diagram notes.

15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read:
      - ESLint CLI (Context7): `/eslint/eslint`
      - Prettier CLI (Context7): `/prettier/prettier`
    - Files to read:
      - `package.json` (root linting/formatting commands + fix scripts)

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `/ingest`, verify no last-run summary when idle, and confirm WS error/connecting banners appear for closed/connecting states. Then complete an ingest run and check `/logs` for `0000022 ingest ui terminal refresh`.
9. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)

---

### 7. Client: full-width Ingest layout

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Make the Ingest page layout full-width (matching Chat/Agents) by removing the constrained/narrow container behavior so the roots table isn’t clipped.

#### Documentation Locations

- MUI Container API (MUI MCP `@mui/material@6.4.12`): https://llms.mui.com/material-ui/6.4.12/api/container.md — confirms `maxWidth={false}` behavior and `MuiContainer-maxWidthLg` class for full-width layout checks.
- Jest docs (Context7): `/websites/jestjs_io_next` — required reference for the Jest layout regression test in this task.

#### Subtasks

1. [ ] Read how other pages achieve full width:
   - Documentation to read:
     - MUI Container API (MUI MCP `@mui/material@6.4.12`): https://llms.mui.com/material-ui/6.4.12/api/container.md
   - Files to read:
     - `client/src/pages/ChatPage.tsx` (Container usage)
     - `client/src/pages/AgentsPage.tsx` (Container usage)
     - `client/src/pages/IngestPage.tsx` (current constrained Container)

2. [ ] Update Ingest page container width:
   - Documentation to read:
     - MUI Container API (MUI MCP `@mui/material@6.4.12`): https://llms.mui.com/material-ui/6.4.12/api/container.md
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Ensure the page is full-width (no centered/narrow maxWidth).
     - Keep spacing consistent with the rest of the app.
     - Do not redesign components; width-only change.
     - MUI Container defaults `maxWidth="lg"`; using `maxWidth={false}` removes the `MuiContainer-maxWidthLg` class (verified in MUI 6.4.x docs).

   - Concrete implementation guidance:
     - Mirror the other pages in this repo (Chat/Agents):
       - Prefer `maxWidth={false}` on the page-level `Container`.
       - Ensure the page-level container does **not** render the `MuiContainer-maxWidthLg` class.

3. [ ] Add client log line confirming full-width layout:
   - Documentation to read:
     - Client logging: `client/src/logging/logger.ts`
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Log line requirements:
     - Use `createLogger('client-ingest')` (or existing logger in the page).
     - Emit message `0000022 ingest layout full-width` once on mount.
     - Include context field: `maxWidth` with the value you set on the `Container`.
   - Purpose:
     - Confirms the layout change during the Task 7 manual Playwright-MCP check.

4. [ ] Add/update a focused UI test to prevent regression:
   - Documentation to read:
     - MUI Container API (MUI MCP `@mui/material@6.4.12`): https://llms.mui.com/material-ui/6.4.12/api/container.md
   - Test type:
     - Jest page/component test (client)
   - Test location:
     - Add `client/src/test/ingestPage.layout.test.tsx` (new file) or update an existing Ingest page test file if it already asserts layout.
   - Description & purpose:
     - Prevent regressions where the Ingest page silently reverts to a constrained container.
   - Requirements:
     - Assert the rendered container does not include the `MuiContainer-maxWidthLg` class (default `maxWidth="lg"`).
     - Keep the test focused on width only; do not couple to ingest status behavior.

   - Concrete test guidance:
     - Render `IngestPage` and assert:
       - `document.querySelector('.MuiContainer-maxWidthLg') === null`

5. [ ] Update `projectStructure.md` for any added/removed files:
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new test file (`client/src/test/ingestPage.layout.test.tsx`) if it was created.
     - Ensure every file added or removed in this task is reflected in the tree entry (no omissions).
     - This subtask must run after all file-adding subtasks in this task.

6. [ ] Documentation update (task-local):
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `planning/plan_format.md`
   - Files to edit:
     - `planning/0000022-ingest-ws-streaming-and-layout.md` (this file)
   - Requirements:
     - Fill in this task’s Implementation notes as you implement.
     - Record the commit hash(es) in this task’s Git Commits.

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read:
     - ESLint CLI (Context7): `/eslint/eslint`
     - Prettier CLI (Context7): `/prettier/prettier`
   - Files to read:
     - `package.json` (root linting/formatting commands + fix scripts)

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `/ingest` and confirm the page uses full-width layout (no horizontal clipping of the roots table). Then open `/logs` and filter for `0000022 ingest layout full-width`.
9. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)

---

### 8. Final verification: acceptance criteria, full test/build matrix, docs, PR comment

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Run the full validation checklist, confirm every acceptance criterion, update documentation, and produce a PR-ready summary comment.

#### Documentation Locations

- Docker Compose docs: https://docs.docker.com/compose/ — confirms Compose CLI usage and lifecycle commands referenced in testing steps.
- Playwright Test docs: Context7 `/microsoft/playwright` — validates `@playwright/test` runner usage for e2e verification.
- Playwright website: https://playwright.dev/docs/intro — supplements the runner overview with CLI examples used in final checks.
- Husky docs: https://typicode.github.io/husky/ — confirms hook behavior relevant when running repo lint/format commands.
- Mermaid syntax reference: https://mermaid.js.org/intro/syntax-reference — used when updating mermaid diagrams in `design.md`.
- Jest docs (timers + test runner): Context7 `/websites/jestjs_io_next` — validates Jest usage for client tests.
- Cucumber guides: https://cucumber.io/docs/guides/ — required reference for server cucumber tests in the final verification.

#### Subtasks

1. [ ] Confirm the acceptance criteria explicitly (write down results in Implementation notes):
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `planning/0000022-ingest-ws-streaming-and-layout.md` (Acceptance Criteria section)
   - Live updates via WS only (no polling timers)
   - Snapshot on subscribe
   - Page-scoped updates (unsubscribes when navigating away)
   - WS unavailable shows explicit error
   - No last-run summary when idle
   - Single global stream
   - Full-width Ingest layout

2. [ ] Update `README.md` if commands or behavior changed:
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `README.md`
   - Files to edit:
     - `README.md`
   - Description & purpose:
     - Document any new/changed commands or user-visible behavior introduced by this story.
   - Requirements:
     - Only update if the ingest WS flow or UI changes alter documented usage.

3. [ ] Update `design.md` with ingest WS notes/diagram if missing:
   - Documentation to read:
     - Mermaid syntax (Context7): `/mermaid-js/mermaid`
   - Files to read:
     - `design.md`
   - Files to edit:
     - `design.md`
   - Description & purpose:
     - Keep architecture documentation consistent with the new ingest WS flows.
   - Requirements:
     - Include/confirm any diagrams added in Tasks 1–6 are reflected and coherent here.

4. [ ] Update `projectStructure.md` for file additions/removals:
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `projectStructure.md`
   - Files to edit:
     - `projectStructure.md`
   - Description & purpose:
     - Ensure the repository tree reflects any new test files or deleted artifacts from this story.

5. [ ] Update e2e ingest tests to reflect “no last-run summary” + WS streaming:
   - Documentation to read:
     - Playwright: Context7 `/microsoft/playwright`
   - Test type:
     - Playwright end-to-end test
   - Files to edit:
     - `e2e/ingest.spec.ts`
   - Description & purpose:
     - Ensure the full ingest flow matches WS-only status updates and the “no last-run summary” UI behavior.
   - Requirements:
     - Update `waitForCompletion(...)` so it does **not** assume the Active ingest card stays mounted until a terminal chip is visible.
       - Preferred: treat completion as the roots table row appearing for the ingested folder name.
       - Also assert the Active ingest panel disappears after completion (no last-run summary).
     - Update selectors to use stable test ids where available:
       - Prefer `data-testid="ingest-status-chip"` (added in Task 6) over `.MuiChip-label`.
       - Continue using existing test ids: `start-ingest`, `submit-error`, and `roots-lock-chip`.
     - Keep the existing progress assertions (current file changes, percent/ETA changes) but ensure they happen while the Active ingest panel is visible.

6. [ ] Documentation update (task-local):
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `planning/plan_format.md`
   - Files to edit:
     - `planning/0000022-ingest-ws-streaming-and-layout.md` (this file)
   - Requirements:
     - Ensure Implementation notes clearly document:
       - what polling was removed,
       - what WS messages were added,
       - and how “no last-run summary” is enforced.
     - Record the commit hash(es) in this task’s Git Commits.

7. [ ] Create a PR summary comment:
   - Documentation to read:
     - GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
   - Files to read:
     - `planning/plan_format.md`
   - Include server WS protocol changes, ingest WS stream behavior, and client Ingest UX changes.
   - Mention what was removed (polling), and what the explicit failure mode is (WS error state).

8. [ ] Add final verification log line for manual checks:
   - Documentation to read:
     - Client logging: `client/src/logging/logger.ts`
   - Files to edit:
     - `client/src/pages/LogsPage.tsx`
   - Log line requirements:
     - Use the page logger (`createLogger('client')`).
     - Emit message `0000022 verification logs reviewed` when the Logs page mounts.
     - Include context `{ story: '0000022' }`.
   - Purpose:
     - Confirms the Task 8 manual Playwright-MCP log review step.

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read:
     - ESLint CLI (Context7): `/eslint/eslint`
     - Prettier CLI (Context7): `/prettier/prettier`
   - Files to read:
     - `package.json` (root linting/formatting commands + fix scripts)

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Open `/ingest` in two browser tabs.
   - Start an ingest run in tab A.
   - Confirm tab B immediately receives a snapshot + subsequent progress updates (no refresh required).
   - Navigate tab B away from `/ingest` and confirm it stops receiving ingest updates.
   - Return tab B to `/ingest` and confirm it receives a fresh snapshot.
   - Confirm the UI shows an explicit error if the WS connection is down (no polling fallback).
   - Capture screenshots for regressions per `plan_format.md` requirements.
   - Open `/logs` and filter for `0000022 verification logs reviewed` to confirm the final verification log line.
9. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)
