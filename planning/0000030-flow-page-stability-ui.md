# Story 0000030 - Flow page stability + UI improvements

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

## Description

The Flows page intermittently drops the conversation sidebar and transcript during an active run, typically right after a server update (for example when a streamed message arrives). Refreshing restores the view. This story stabilizes the sidebar/transcript updates and adds several Flows page UX improvements: working-folder picker parity with Agents/Ingest, a flow info popover that mirrors the Agents “i” button, a “New Flow” reset action that clears the selected flow and transcript, and an optional custom name input that becomes the conversation title in the sidebar.

The custom name must apply to the main flow conversation and to per-agent flow conversations created during the run. The name is only set when starting a new flow (not editable afterward). The “New Flow” action should behave like the Agents/Chat “New conversation” button: it clears the current selection and shows the empty/blank transcript state ready for a new run.

## Investigation Notes (current behavior)

- Flow sidebar filtering relies on `flowName` being present in conversation summaries.
- The server emits `flowName` in `conversation_upsert` WS events.
- The Flows page WS handler applies `conversation_upsert` updates **without** copying `flowName`, so the updated conversation no longer matches the flow filter and is filtered out.
- When the active conversation disappears from the filtered list, the Flows page clears the active conversation and transcript state, which looks like the sidebar and main chat “disappeared” until refresh.

## Root Cause & Likely Fix

- **Root cause:** The Flows page drops `flowName` when applying `conversation_upsert` updates, causing the conversation to be filtered out and the page to reset its selection.
- **Likely fix:** Preserve or forward `flowName` during WS upsert handling so the flow conversation stays eligible for the active filter. If the WS payload ever omits `flowName`, keep the previously-known value for that conversation instead of dropping it.

## Acceptance Criteria

- The Flows sidebar no longer disappears during streamed updates; active conversations stay visible without requiring a refresh.
- `conversation_upsert` updates on the Flows page preserve `flowName` and do not cause the active flow conversation to be filtered out.
- The working folder input is on its own line and includes a “Choose folder…” button with the same UX as Agents/Ingest.
- The working folder picker uses a shared React component that can be reused by Agents, Flows, and Ingest (same dialog and endpoint).
- An info (“i”) button appears next to the flow selector and opens a popover showing the selected flow’s details, matching the Agents info UX (warnings section, description rendered as Markdown, and a fallback “no description” message).
- A “New Flow” button clears the selected flow and shows a blank/empty state ready for a new run (same mental model as Agents/Chat “New conversation”).
- A custom name input is available; when provided, the flow conversation title uses this name in the sidebar. When empty, the title remains the current default behavior.
- The custom name also applies to per-agent flow conversations created during the run.
- The custom name is only applied when starting a new flow run; it is not editable after the run begins.

## Out Of Scope

- Redesigning the Flows page layout beyond the items above.
- Changing flow execution semantics, step logic, or server-side flow orchestration.
- New persistence layers or changes to Mongo schemas beyond storing a custom title.

## Questions


---
## Message Contracts & Storage Impact

- Likely add an optional field on `POST /flows/:flowName/run` to carry the custom title (e.g. `customTitle`).
- Server should apply the custom title when creating/updating the flow conversation, defaulting to the existing `Flow: <flowName>` title when absent.
- The custom title should also be applied to per-agent flow conversations created during the run.
- The “New Flow” UI should pass the custom title only when starting a new run; resuming/continuing an existing flow should reuse the stored title.
- No change expected for `flowName` filtering; it remains a separate field used to scope flow history.

---
## Edge Cases & Failure Modes

- `conversation_upsert` arrives without `flowName`: the client should retain the last known `flowName` to avoid filtering the conversation out.
- Flow run starts while `flowName` is cleared (New Flow state): ensure the UI requires selecting a flow before run.
- Custom title supplied but flow run fails early: the title should still show in the sidebar if the conversation exists.
- Directory picker failures: show the same error handling as Agents/Ingest without breaking the Flows form.

---
## Implementation Plan

Tasks to be defined after questions are answered. Do **not** task up yet.

## Reference: Agents “i” button UX (must match)

- Shows **Warnings** header when warnings exist, listing each warning.
- Shows the agent description rendered as Markdown inside an outlined panel.
- If both warnings and description are missing, displays: “No description or warnings are available for this agent yet.”
- Uses a popover anchored to the info icon with left-bottom anchoring.

## Reference: Directory Picker UX (must match)

- Uses the existing `DirectoryPickerDialog` component and `GET /ingest/dirs` endpoint.
- Shows base path, current path, list of child directories, and “Use this folder” action.
- Includes loading and error states identical to the Ingest/Agents usage.
