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
 - When `mongoConnected === false`, live streaming is disabled and the UI surfaces a clear error message explaining that persistence is required for realtime updates/catch-up.
- When `mongoConnected === false`, bulk archive/restore/permanent delete actions are also disabled, and the UI surfaces a clear error message explaining that persistence is required for safe conversation management.

### Reliability/consistency

- Live streaming updates are tied to a `conversationId` so updates are routed to the correct transcript.
- The server only retains in-memory streaming state for conversations that are currently streaming, and it is released promptly after completion/abort.
- If the user loads a conversation that is not streaming, the UI does not show a streaming placeholder (snapshot-only).
- Streaming events include sequence identifiers (at least per-conversation) so clients can ignore stale/out-of-order events during rapid conversation switching and safely reconcile subscriptions.
- The sidebar uses a single always-on subscription that streams updates for all conversations; the client applies the current view filter locally (`Active` / `Active & Archived` / `Archived`). On disconnect/reconnect, the client refreshes the list snapshot before resuming stream updates.

---

## WebSocket protocol (proposal – to finalize before tasking)

This story will introduce a single WebSocket connection per browser tab. The protocol below is the intended shape so the work can be task-sized consistently.

Status: **accepted for v1** (no further protocol decisions required before tasking, aside from selecting concrete URL path + naming during implementation).

### Connection

- Endpoint: `GET /ws` (exact path TBD in implementation).
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
    - Sent immediately after `subscribe_conversation` when a run is currently in progress.
    - `{ type, conversationId, seq: number, inflight: { assistantText: string, toolEvents: unknown[], startedAt: string } }`
  - `type: "assistant_delta"`
    - `{ type, conversationId, seq: number, delta: string }`
  - `type: "tool_event"`
    - Interim tool progress/events (so viewers match the originating tab).
    - `{ type, conversationId, seq: number, event: unknown }`
  - `type: "turn_final"`
    - Marks completion of the in-flight turn and carries any final metadata needed by the UI.
    - `{ type, conversationId, seq: number, status: "ok" | "stopped" | "failed" }`

### Sequence IDs (minimum)

- Sidebar events use a monotonically increasing `seq` per socket (or per server process) so the client can ignore stale/out-of-order list updates.
- Transcript events use a monotonically increasing `seq` per `conversationId` so the client can ignore stale/out-of-order deltas/events during rapid switching.

Note: the persisted transcript remains the source of truth; sequence IDs are primarily to prevent UI glitches from late-arriving events rather than to enable full replay.

---

## Out Of Scope

- “Select all” across the entire result set (server-side bulk operations over all matches).
- Complex selection gestures (shift-click ranges, keyboard navigation) beyond basic checkbox multi-select.
- Editing conversation titles, tagging, folders, or search within conversations.
- Cross-instance fan-out or locking (multi-server coordination). v1 assumes a single server process for live fan-out.
- Changing the MCP tool request/response formats or the persisted MCP turn schema. This story only improves how those existing turns/streams are displayed in the browser.
- Introducing an explicit “cancel run” endpoint for non-UI initiated runs (cancellation remains via existing abort/disconnect mechanisms where applicable).
- Sidebar “extra” live indicators (typing/streaming badges, token previews, tool-progress badges) beyond minimal create/update/delete + resorting.

---

## Questions

(none – ready for tasking once the WebSocket protocol above is reviewed and accepted as final for v1.)

---

# Tasks

(Not yet created — this story is still in the “Description/Acceptance Criteria/Out Of Scope/Questions” phase.)
