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

---

## Acceptance Criteria

- The Agents page uses the same layout structure as the Chat page: a left Drawer sidebar (mobile = temporary, desktop = persistent, width 320), a controls area above the transcript, and a transcript column inside a scrolling panel.
- The Agents transcript uses the same WebSocket transcript logic as Chat (the same WS handler/hooks such as `useChatWs` + `useChatStream.handleWsEvent` or a shared equivalent), with no bespoke inflight aggregation state on the client.
- Agents show the same transcript UI features as Chat: status chip (Processing/Complete/Failed), tool blocks with parameters + result accordions, and citations rendered in the same citations accordion under assistant bubbles.
- The Agents sidebar updates via WebSocket `conversation_upsert` / `conversation_delete` events the same way as Chat (subscribed with `subscribe_sidebar`), filtered to the active agent and sorted in the same order.
- Agent-specific controls replace Chat provider/model controls without losing functionality: agent dropdown, command dropdown + execute, working folder input, Send/Stop, and New conversation all behave as they do today on the Agents page.

---

## Out Of Scope

- Redesigning the Chat page UI.
- Changing backend agent execution semantics beyond what is needed for WS parity.
- Introducing new provider types or non-Codex agents.
- Adding new agent commands or altering existing command content.

---

## Questions

- Should we create a shared server-side “run orchestration” helper used by both `/chat` and `/agents`, so WS event emission and inflight handling are identical?
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
