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

- The Flows sidebar and transcript stay visible during live `conversation_upsert` updates; the active conversation is never cleared and no refresh is required to recover the list or transcript.
- When applying `conversation_upsert` updates in the Flows page state, preserve the existing `flowName` if the update omits it so the conversation still matches the active flow filter and remains in the sidebar.
- The working folder control sits on its own row beneath the flow selector and includes the same labeled text field plus **Choose folder…** button used on Agents/Ingest.
- The working folder picker reuses the shared dialog component and `GET /ingest/dirs` endpoint so the flow picker has identical loading, error, and “Use this folder” UX to Agents/Ingest.
- An info (“i”) icon button appears directly next to the flow selector. Clicking it opens a popover anchored bottom-left that shows (1) a **Warnings** section when warnings exist, (2) the flow description rendered as Markdown inside an outlined panel, and (3) the fallback copy: “No description or warnings are available for this flow yet.”
- A **New Flow** button clears: selected flow, active conversation, transcript state, working folder override, and custom name input. After clicking it, the screen shows the empty transcript/blank state and the Run button stays disabled until a flow is selected.
- A **Custom name** input (helper text “Optional: name for this run”) is available before starting a run. When populated, the flow conversation title in the sidebar uses this value; when empty it remains the default `Flow: <flowName>` title.
- The custom name applies to the main flow conversation and to any per-agent flow conversations created during that run.
- The custom name is only captured when starting a new flow run and is not editable once the run begins or when resuming an existing conversation.

## Out Of Scope

- Redesigning the Flows page layout beyond the items above.
- Changing flow execution semantics, step logic, or server-side flow orchestration.
- New persistence layers or changes to Mongo schemas beyond storing a custom title.

## Questions


---
## Message Contracts & Storage Impact

- Add an optional `customTitle` field to `POST /flows/:flowName/run` requests (UI sends it only when starting a new run, never when resuming).
- Server uses `customTitle` (when provided) as the conversation title for the main flow run; otherwise the title remains `Flow: <flowName>`.
- Server also applies `customTitle` to any per-agent flow conversations created during the same run.
- Conversation documents still store `flowName` separately and flow filtering continues to rely on that field; `customTitle` only affects the displayed title.

---
## Edge Cases & Failure Modes

- `conversation_upsert` arrives without `flowName`: keep the last known `flowName` for that conversation to avoid it disappearing from the filtered sidebar.
- New Flow state (no selected flow): Run is disabled and must show validation prompting the user to select a flow before starting.
- Custom title supplied but the flow run fails early: if a conversation is created, the sidebar still shows the custom title.
- Directory picker errors (network, OUTSIDE_BASE, NOT_FOUND, NOT_DIRECTORY): display the same inline error UI as Agents/Ingest and keep the rest of the flow form usable.

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
