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

---

## Acceptance Criteria

- The Agents page uses the same layout structure as the Chat page (drawer sidebar + controls + transcript column).
- The Agents transcript uses the same WebSocket transcript logic as Chat (no custom inflight aggregation on the client).
- Agents show the same transcript UI features as Chat, including tool blocks, status chips, and citations.
- The Agents sidebar updates via WebSocket conversation upserts/deletes the same way as Chat, scoped to the active agent.
- Agent-specific controls (agent selection, command execution, working folder) replace the Chat provider/model controls without regressing functionality.

---

## Out Of Scope

- Redesigning the Chat page UI.
- Changing backend agent execution semantics beyond what is needed for WS parity.
- Introducing new provider types or non-Codex agents.
- Adding new agent commands or altering existing command content.

---

## Questions

- Should agent runs publish a `user_turn` WS event (server-side) so the unified transcript logic renders the user bubble without a client-side workaround?
- Should command execution display be treated as a special tool segment or continue to render command metadata as a separate note?
- Do we need to support citations for agent runs that do not call vector search tools, or should citations render only when tool results include them?
- How should “Stop” behave for agent runs once we unify WS logic (abort fetch only, cancel inflight, or both)?
- Are there any agent-specific banners/warnings that must remain in the controls area (e.g., disabled agent warnings)?

---

# Implementation Plan

## Instructions

Tasks will be added after the above questions are resolved and the exact scope is confirmed.
