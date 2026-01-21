# Story 0000030 - Flow page stability + UI improvements

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

## Description

The Flows page intermittently drops the conversation sidebar and transcript during an active run, typically right after a server update (for example when a streamed message arrives). Refreshing restores the view. This story stabilizes the sidebar/transcript updates and adds several Flows page UX improvements: working-folder picker parity with Agents/Ingest, a flow info popover that mirrors the Agents “i” button, a “New Flow” reset action that clears the active conversation/transcript while keeping the selected flow, and an optional custom name input that becomes the conversation title in the sidebar.

The custom name must apply to the main flow conversation and to per-agent flow conversations created during the run. The name is only set when starting a new flow (not editable afterward). The “New Flow” action should behave like the Agents/Chat “New conversation” button: it keeps the selected flow and list visible, but clears the active conversation/transcript for a fresh run and resets the custom name input.

## Investigation Notes (current behavior)

- Flow sidebar filtering relies on `flowName` being present in conversation summaries.
- The server emits `flowName` in `conversation_upsert` WS events.
- The Flows page WS handler applies `conversation_upsert` updates **without** copying `flowName`, so the updated conversation no longer matches the flow filter and is filtered out.
- When the active conversation disappears from the filtered list, the Flows page clears the active conversation and transcript state, which looks like the sidebar and main chat “disappeared” until refresh.

## Root Cause & Likely Fix

- **Root cause:** The Flows page drops `flowName` when applying `conversation_upsert` updates, causing the conversation to be filtered out and the page to reset its selection.
- **Likely fix:** Preserve or forward `flowName` during WS upsert handling so the flow conversation stays eligible for the active filter. If the WS payload ever omits `flowName`, keep the previously-known value for that conversation instead of dropping it.

## Research Findings (code touchpoints)

- Flows list + WS handling live in `client/src/pages/FlowsPage.tsx`; `conversation_upsert` currently forwards a payload to `applyWsUpsert` without `flowName`, so any update can drop the flow filter.
- `client/src/hooks/useConversations.ts` treats an empty `flowName` as “no filter” (returns all conversations). Because “New Flow” should keep the selected flow, the UI must avoid clearing `selectedFlowName` and instead only reset the active conversation/transcript + custom name.
- Flow summary data comes from `server/src/flows/discovery.ts` and contains `{ name, description, disabled, error? }`. There is no warnings array today; the info popover must decide whether to treat `error` as a warning when `disabled === true`.
- Flow run conversations are created/titled in `server/src/flows/service.ts`: `Flow: <flowName>` for the main run and `Flow: <flowName> (<identifier>)` for per-agent flow conversations. This is the spot to apply a custom title for both.
- `POST /flows/:flowName/run` validation lives in `server/src/routes/flowsRun.ts` and currently accepts `conversationId`, `working_folder`, and `resumeStepPath`. Custom title support should be added here as an optional, trimmed string.
- The working-folder picker dialog is already shared by Agents/Ingest (`client/src/components/ingest/DirectoryPickerDialog.tsx` + `ingestDirsApi.ts`); Flows should reuse these exact pieces for parity.
- Chat page conversation filtering uses `agentName=__none__` and `flowName=__none__`, but the server query currently overwrites `query.$or` in `server/src/mongo/repo.ts`, so the agent filter is lost. This explains agent conversations leaking into the Chat sidebar.

## Acceptance Criteria

- The Flows sidebar and transcript stay visible during live `conversation_upsert` updates; the active conversation is never cleared and no refresh is required to recover the list or transcript.
- When applying `conversation_upsert` updates in the Flows page state, preserve the existing `flowName` if the update omits it so the conversation still matches the active flow filter and remains in the sidebar.
- The working folder control sits on its own row beneath the flow selector and includes the same labeled text field plus **Choose folder…** button used on Agents/Ingest.
- The working folder picker reuses the shared dialog component and `GET /ingest/dirs` endpoint so the flow picker has identical loading, error, and “Use this folder” UX to Agents/Ingest.
- An info (“i”) icon button appears directly next to the flow selector. Clicking it opens a popover anchored bottom-left that shows (1) a **Warnings** section when warnings exist, (2) the flow description rendered as Markdown inside an outlined panel, and (3) the fallback copy: “No description or warnings are available for this flow yet.”
- A **New Flow** button clears: active conversation, transcript state, working folder override, and custom name input (but keeps the selected flow). After clicking it, the screen shows the empty transcript/blank state and the Run button remains enabled because a flow is still selected.
- A **Custom name** input (helper text “Optional: name for this run”) is available before starting a run. When populated, the flow conversation title in the sidebar uses this value; when empty it remains the default `Flow: <flowName>` title.
- The custom name applies to the main flow conversation and to any per-agent flow conversations created during that run.
- When a custom name is provided, per-agent flow conversations use the title format `<customTitle> (<identifier>)` (default remains `Flow: <flowName> (<identifier>)`).
- The custom name is only captured when starting a new flow run and is not editable once the run begins or when resuming an existing conversation.
- The Chat page sidebar shows only chat conversations (no agent or flow conversations). Agent conversations remain scoped to the Agents page and flow conversations remain scoped to the Flows page.

## Out Of Scope

- Redesigning the Flows page layout beyond the items above.
- Changing flow execution semantics, step logic, or server-side flow orchestration.
- New persistence layers or changes to Mongo schemas beyond storing a custom title.

## Scope Notes

- Scope is reasonable but spans client UI, shared picker reuse, and server flow-run metadata. If delivery risk appears, split into two stories: (1) flow sidebar stability + flowName preservation, (2) UX enhancements (picker parity, info popover, custom title).

## Message Contracts & Storage Shapes (Proposed)

- **New request field:** add optional `customTitle` to `POST /flows/:flowName/run` body, validated as trimmed non-empty (e.g., `z.string().trim().min(1).optional()`), and only sent for new runs (never for resume).
- **No new response shape:** the `202` response remains `{ status, flowName, conversationId, inflightId, modelId }`.
- **No new storage fields:** use the existing `Conversation.title` field for custom titles (and for per-agent flow titles). Keep `flowName` as-is for filtering and `agentName` for agent conversations.
- **Flows list contract unchanged:** `GET /flows` continues to return `{ name, description, disabled, error? }`; any warning display should be derived from the existing `error` field rather than adding a new warnings array.

## Implementation Ideas

- **Flows WS stability:** Update `client/src/pages/FlowsPage.tsx` to include `flowName` when calling `applyWsUpsert`, or preserve the existing `flowName` when an upsert payload omits it. This avoids `useConversations` filtering the conversation out on live updates.
- **New Flow empty state:** Keep the selected flow intact and clear only the active conversation/transcript. Do not clear the flow selector. Ensure the custom name input is reset.
- **Working folder picker parity:** Reuse `client/src/components/ingest/DirectoryPickerDialog.tsx` and `ingestDirsApi.ts` from the Ingest/Agents patterns. Add a “Choose folder…” button next to the working folder field, and keep the field editable; cancel should be a no-op, errors should match the existing dialog UX.
- **Flow info popover:** Add an info icon next to the Flow selector and open a MUI `Popover` with bottom-left anchoring (`anchorOrigin: bottom/left`, `transformOrigin: top/left`). Render warnings (decide if `FlowSummary.error` becomes warnings for disabled flows), Markdown description, and fallback copy.
- **Custom title propagation:** Extend `POST /flows/:flowName/run` to accept optional `customTitle` (validated as trimmed non-empty). Update `server/src/flows/service.ts` to apply the custom title to the main flow conversation and use `<customTitle> (<identifier>)` for per-agent flow conversations, falling back to the existing `Flow: <flowName>` format.
- **Client payloads:** Extend `client/src/api/flows.ts` and `FlowsPage` run/resume handlers to send `customTitle` only for new runs, never on resume. Ensure “New Flow” clears the input.
- **Conversation filtering regression:** In `server/src/mongo/repo.ts`, combine the `agentName=__none__` and `flowName=__none__` filters with `$and` instead of overwriting `query.$or` so the Chat sidebar excludes both agent and flow conversations.
- **Tests to adjust:** Update Flows page tests (`client/src/__tests__/flowsPage.*`) to cover flowName preservation, New Flow state behavior, and custom title payloads. Add/adjust server integration tests in `server/src/test/integration/flows.*` to validate new title handling and request schema.
- **Sidebar filter tests:** Add client tests to ensure conversation sidebars are filtered correctly on Chat, Agents, and Flows pages (chat-only, agent-only, and flow-only respectively). Add server tests (or adjust existing ones) to assert `agentName=__none__` + `flowName=__none__` returns only chat conversations.

## Questions

Resolved:

- Flow info popover should follow the Agents UX; when a flow is disabled and `FlowSummary.error` exists, treat the error as a warning entry in the popover (same “Warnings” section layout as Agents).
- “New Flow” should keep the selected flow and sidebar list visible, but clear the active conversation/transcript and reset the custom name input.

---
## Message Contracts & Storage Impact

- Add an optional `customTitle` field to `POST /flows/:flowName/run` requests (UI sends it only when starting a new run, never when resuming).
- Validation should trim whitespace and treat an empty/whitespace-only title as “not provided” (e.g., `z.string().trim().min(1).optional()`).
- Server uses `customTitle` (when provided) as the conversation title for the main flow run; otherwise the title remains `Flow: <flowName>`.
- Server also applies `customTitle` to any per-agent flow conversations created during the same run.
- Conversation documents still store `flowName` separately and flow filtering continues to rely on that field; `customTitle` only affects the displayed title.

---
## Edge Cases & Failure Modes

- `conversation_upsert` arrives without `flowName`: keep the last known `flowName` for that conversation to avoid it disappearing from the filtered sidebar.
- “New Flow” retains the selected flow; the empty state is scoped to the transcript + active conversation only. Run remains enabled because a flow is still selected.
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
- Use MUI Popover positioning (`anchorOrigin: { vertical: 'bottom', horizontal: 'left' }`, `transformOrigin: { vertical: 'top', horizontal: 'left' }`) so the popover behaves like other MUI info popovers.

## Reference: Directory Picker UX (must match)

- Uses the existing `DirectoryPickerDialog` component and `GET /ingest/dirs` endpoint.
- Shows base path, current path, list of child directories, and “Use this folder” action.
- Includes loading and error states identical to the Ingest/Agents usage.
