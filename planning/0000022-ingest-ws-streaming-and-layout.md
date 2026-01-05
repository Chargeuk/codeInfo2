# Story 0000022 – Ingest WS streaming + full‑width layout

## Implementation Plan Instructions

This story follows `planning/plan_format.md`. Tasks are intentionally **omitted** for now while options are discussed.

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
- **Will change:** Ingest progress delivery switches from polling to WS; Ingest page layout becomes full width.
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

Tasks are intentionally omitted until the options are finalized and approved.
