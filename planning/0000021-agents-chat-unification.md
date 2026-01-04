# Story 0000021 – Agents page parity with Chat layout + WS

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):
- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today the Chat page and the Agents page serve similar purposes (history sidebar, options controls, transcript) but are implemented with different UI and streaming logic. The Chat page uses the newer WebSocket-driven transcript handling and has proven more stable. The Agents page uses bespoke state handling and a separate layout, which has led to inconsistencies and bugs.

We want the Agents page to use the same layout, components, and WebSocket transcript logic as the Chat page so the user experience is consistent and stable. Agent-specific controls (agent selection, command execution, working folder) should replace the Chat provider/model controls, but the transcript rendering, tool/citation handling, and sidebar behavior should mirror Chat.

We also plan to unify the backend execution/streaming path so both Chat and Agents runs flow through the same server-side orchestration for WebSocket events (including `user_turn`, `inflight_snapshot`, tool events, and `turn_final`). This avoids maintaining two nearly identical pipelines and prevents drift where one path emits events or state updates the other does not. Once the new Agents page is in place, the legacy Agents UI logic and any legacy server-side Agents run path that bypasses the unified streaming flow will be removed so there is only one end-to-end path to maintain.

**Approach (preferred):** Rebuild the Agents page by reusing the Chat page layout/components and the shared chat WebSocket transcript logic, and route agent runs through the same server orchestration used by `/chat`. This keeps the UI/WS behavior identical and allows removal of the legacy Agents UI state handling and any duplicate agent-run server paths.

**Output clarity:** The new Agents page should look and behave exactly like Chat (same layout + transcript UI), with only the controls swapped to agent-specific inputs. The old Agents UI implementation and any server code paths that bypass the unified run orchestration should be deleted.

---

## Acceptance Criteria

- The Agents page uses the same layout structure as the Chat page: a left Drawer sidebar (mobile = temporary, desktop = persistent, width 320), a controls area above the transcript, and a transcript column inside a scrolling panel.
- The Agents transcript uses the same WebSocket transcript logic as Chat (the same WS handler/hooks such as `useChatWs` + `useChatStream.handleWsEvent` or a shared equivalent), with no bespoke inflight aggregation state on the client.
- Agents show the same transcript UI features as Chat: status chip (Processing/Complete/Failed), tool blocks with parameters + result accordions, and citations rendered in the same citations accordion under assistant bubbles.
- The Agents sidebar updates via WebSocket `conversation_upsert` / `conversation_delete` events the same way as Chat (subscribed with `subscribe_sidebar`), filtered to the active agent and sorted in the same order.
- Agent-specific controls replace Chat provider/model controls without losing functionality: agent dropdown, command dropdown + execute, working folder input, Send/Stop, and New conversation all behave as they do today on the Agents page.
- The legacy Agents UI logic (custom inflight aggregation, bespoke transcript rendering) is removed, and the Agents page uses the same Chat transcript components/hooks.
- Any server-side Agents run path that bypasses the shared run orchestration is removed; both `/chat` and `/agents` use the same orchestration for WS events.

---

## Out Of Scope

- Redesigning the Chat page UI.
- Changing Chat view behavior or visuals (Agents must inherit Chat behavior without modifying it unless absolutely necessary).
- Changing backend agent execution semantics beyond what is needed for WS parity.
- Introducing new provider types or non-Codex agents.
- Adding new agent commands or altering existing command content.

---

## Research Findings (MCP + Web)

- **Server parity gap:** agent runs already use `ChatInterface` + `attachChatStreamBridge` but do not emit `user_turn` (and do not set up chat-style inflight metadata) in `server/src/agents/service.ts`; `/chat` explicitly creates inflight state and publishes `user_turn` in `server/src/routes/chat.ts`. This is the primary upstream gap to close for WS parity.
- **Client divergence:** the Agents UI currently builds its own inflight aggregation and transcript rendering in `client/src/pages/AgentsPage.tsx`, while Chat uses `useChatStream` + `useChatWs` + `useConversationTurns`. This is the main source of duplicate logic and drift.
- **Abort/stop semantics:** client-side aborts rely on `AbortController` (fetch rejects with `AbortError`), so server-side cancellation must still be explicit via the unified WS `cancel_inflight` flow.
- **WebSocket health:** the `ws` library recommends ping/pong + termination to detect dead connections; our WS server already uses a heartbeat, which aligns with keeping a single WS path for both Chat and Agents.
- **Protocol choice:** WebSockets are bidirectional while SSE is server-to-client only; maintaining WS for both Chat and Agents keeps cancel-inflight and tool event flows unified.
- **DeepWiki note:** the repo is not indexed in DeepWiki yet (“Repository not found”), so code references are confirmed locally; once indexed, re-check for any agent-specific design notes.
- **CodeInfo note:** the code-info MCP appears to be indexed against a different repo namespace (“CodeInfo2Planning”) and returned mismatched paths, so local files are treated as the source of truth for this story.

---

## Message Contracts & Storage Shapes

- **No new storage shapes are required.** Existing conversation/turn persistence remains unchanged.
- **No new WS event types are required.** Agents will emit the same existing WS v1 events as Chat (`user_turn`, `inflight_snapshot`, `assistant_delta`, `analysis_delta`, `tool_event`, `turn_final`).
- **No new REST fields are required.** `/agents/:agentName/run` continues to accept `instruction`, optional `conversationId`, and optional `working_folder` and returns `segments` for fallback/non-WS use (the UI should not depend on these segments).

---

## Questions

- Should we create a shared server-side “run orchestration” helper used by both `/chat` and `/agents`, so WS event emission and inflight handling are identical? **Answer:** Yes — unify both paths behind a single run-orchestration flow to avoid drift and duplicate maintenance.
- Should agent runs publish a `user_turn` WS event (server-side) so the unified transcript logic renders the user bubble without client-side workarounds? **Answer:** Yes — reusing the chat run flow means `user_turn` should be emitted as part of the unified server path.
- After unification, should the Agents UI rely exclusively on WS transcript events, with the REST `segments` response kept only as a non-UI fallback? **Answer:** Yes — render from WS only; keep REST segments as a fallback for non-WS clients/tests.
- Given the chat view must remain unchanged, how should agent-specific command metadata be represented without UI changes (drop it, or map it into existing tool/event data)? **Answer:** Drop the bespoke command metadata UI entirely (simplest; aligns with “Chat view unchanged”).
- How should “Stop” behave for agent runs once the unified WS path is in place (match Chat: cancel inflight + abort fetch)? **Answer:** Match Chat — cancel inflight via WS and abort the HTTP request for immediate UI response.
- Which legacy Agents server path code is intended to be removed once the unified flow is live (UI-only cleanup vs removal of any duplicate orchestration code paths)? **Answer:** Remove any agent-run server path that does not go through the shared run orchestration (single path/KISS).
- Are there any agent-specific banners/warnings that must remain in the controls area (e.g., disabled agent warnings)? **Answer:** Keep only what exists today (disabled agent + warnings), placed within the new Chat-based layout.

---

# Implementation Plan

## Instructions

Tasks will be added after the above questions are resolved and the exact scope is confirmed.
