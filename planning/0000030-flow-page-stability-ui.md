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
- The server sidebar WS payload includes `flowName` when present (`server/src/ws/sidebar.ts`), so the client can pass it through or retain the previous `flowName` on upsert.
- `client/src/hooks/useConversations.ts` treats an empty `flowName` as “no filter” (returns all conversations). Because “New Flow” should keep the selected flow, the UI must avoid clearing `selectedFlowName` and instead only reset the active conversation/transcript + custom name.
- Flow summary data comes from `server/src/flows/discovery.ts` and contains `{ name, description, disabled, error? }`. There is no warnings array today; the info popover must decide whether to treat `error` as a warning when `disabled === true`.
- Flow run conversations are created/titled in `server/src/flows/service.ts`: `Flow: <flowName>` for the main run and `Flow: <flowName> (<identifier>)` for per-agent flow conversations. This is the spot to apply a custom title for both.
- Per-agent flow conversations currently set `agentName` but do **not** set `flowName` in `server/src/flows/service.ts`; keep them agent-only for this story (no change to flow list visibility).
- `POST /flows/:flowName/run` validation lives in `server/src/routes/flowsRun.ts` and currently accepts `conversationId`, `working_folder`, and `resumeStepPath`. Custom title support should be added here as an optional, trimmed string.
- `server/src/routes/flowsRun.ts` uses manual string trimming/empty checks (not Zod), so `customTitle` should follow the same pattern: trim and treat empty as undefined.
- The working-folder picker dialog is already shared by Agents/Ingest (`client/src/components/ingest/DirectoryPickerDialog.tsx` + `ingestDirsApi.ts`); Flows should reuse these exact pieces for parity.
- Chat page conversation filtering uses `agentName=__none__` and `flowName=__none__`, but the server query currently overwrites `query.$or` in `server/src/mongo/repo.ts`, so the agent filter is lost. This explains agent conversations leaking into the Chat sidebar.
- The regression was introduced when `flowName` filtering was added in `DEV-0000027 - Add flowName filtering` (commit `f7d8180`, 2026-01-17). The flowName `__none__` branch reuses `query.$or`, overwriting the earlier agentName `__none__` clause added on 2025-12-14.

## Research Findings (docs)

- MUI Popover supports `anchorOrigin`/`transformOrigin` positions with `vertical`/`horizontal` values (including `bottom` + `left`); set both explicitly to match the required bottom-left anchor and top-left transform.
- Zod `optional()` allows `undefined` values, and `trim()` is a mutating string transform; if Zod were used for `customTitle`, `trim().min(1)` would reject whitespace-only inputs after trimming.
- Deepwiki has not indexed `Chargeuk/codeInfo2`, so no repository wiki is available through that tool.

## Message Contracts & Storage Shapes (Confirmed)

- **Flow run request:** `POST /flows/:flowName/run` currently accepts `conversationId`, `working_folder`, and `resumeStepPath`. Add optional `customTitle` (trimmed, non-empty string). Validation should follow the existing manual trim/empty checks in `server/src/routes/flowsRun.ts`.
- **Flow run response:** No response changes; keep `202 { status, flowName, conversationId, inflightId, modelId }`.
- **Conversation storage:** No new fields are required. Store the custom title in existing `Conversation.title`; keep `flowName` and `agentName` as-is for filtering, and `flags.flow` for resume state.
- **Conversation summary + WS:** REST summary and `conversation_upsert` payloads already include `title`, `agentName?`, and `flowName?`. Custom titles flow through `title` only; per-agent flow conversations remain agent-only without `flowName`.

## Acceptance Criteria

- During an active flow run, live conversation updates (for example websocket `conversation_upsert` events) never remove the active flow conversation from the Flows sidebar; the transcript stays visible without refresh.
- When a live update payload omits `flowName`, the Flows page keeps the previously known `flowName` so the conversation still matches the selected flow filter.
- The working folder control appears on its own row below the Flow selector with a labeled `Working folder` text field that remains manually editable.
- A **Choose folder…** button sits next to the working folder field and opens the same `DirectoryPickerDialog` used by Agents/Ingest; picking a folder updates the field, cancel leaves it unchanged, and loading/error states match the existing dialog UX.
- An info (“i”) icon button appears directly next to the Flow selector. Clicking it opens a popover anchored bottom-left that shows a **Warnings** section when the flow is disabled and has `error` (display the error text as the warning), the flow description rendered as Markdown inside an outlined panel, and the fallback copy “No description or warnings are available for this flow yet.” when both are missing.
- A **New Flow** button clears the active conversation, transcript state, working folder field, and custom name input (but keeps the selected flow). After clicking it, the empty transcript state is shown and the Run button remains enabled because a flow is still selected.
- A **Custom name** input with helper text “Optional: name for this run” is visible before starting a run; once a run starts or a resume is selected, the field is read-only/disabled and no longer editable.
- When a custom name is provided, the main flow conversation title uses that value; when empty it remains the default `Flow: <flowName>` title.
- The custom name applies to per-agent flow conversations using the title format `<customTitle> (<identifier>)` (default remains `Flow: <flowName> (<identifier>)`).
- The custom name is captured only when starting a new flow run and is not sent or changed when resuming.
- Per-agent flow conversations remain agent-only (no `flowName`) and do not appear in flow-filtered sidebars; only the main flow conversation is listed in Flows.
- The Chat page sidebar shows only chat conversations (no agent or flow conversations). The Agents page shows only agent conversations and the Flows page shows only flow conversations.

## Out Of Scope

- Redesigning the Flows page layout beyond the items above.
- Changing flow execution semantics, step logic, or server-side flow orchestration.
- New persistence layers or changes to Mongo schemas beyond storing a custom title.
- Changing per-agent flow conversation visibility (they remain agent-only in this story).

## Scope Notes

- Scope is reasonable but spans client UI, shared picker reuse, and server flow-run metadata. If delivery risk appears, split into two stories: (1) flow sidebar stability + flowName preservation, (2) UX enhancements (picker parity, info popover, custom title).
- Keep scope tight by reusing existing dialog/components and avoiding additional flow orchestration changes; the only server behavior changes should be flow run validation/title formatting plus the conversation list filter fix for chat-only sidebars.

## Scope Assessment

- The story is moderately sized but still coherent: one stability bug fix, one API extension, a few UI affordances, and focused test updates.
- Biggest risk is breadth across client + server + tests; splitting UI enhancements from stability (as noted above) is the cleanest reduction if timeline is tight.
- Avoid adding new data fields or flow execution changes to keep the story shippable in one pass.

## Implementation Ideas

- **Flows WS stability:** In `client/src/pages/FlowsPage.tsx`, pass through `event.conversation.flowName` to `applyWsUpsert` (the WS payload already includes it). If the payload omits `flowName`, merge the prior conversation’s `flowName` before filtering so the item stays in the flow list.
- **Flow info popover parity:** Mirror the Agents page popover structure from `client/src/pages/AgentsPage.tsx` (info icon + `Popover`, warnings list, Markdown description, empty-state copy). Reuse the same `Markdown` component and warning layout to keep copy/padding consistent.
- **Working folder picker parity:** Follow the Agents working-folder pattern: keep a controlled `workingFolder` field, add a “Choose folder…” button to open `DirectoryPickerDialog`, and reuse `ingestDirsApi.ts` for the `/ingest/dirs` fetch behavior. Cancel should keep the existing value; pick updates the field.
- **New Flow reset logic:** Copy the Agents `resetConversation()` pattern: clear `activeConversationId`, transcript/messages, `workingFolder`, and `customTitle`, but keep `selectedFlowName` intact so the flow list and Run button stay enabled.
- **Custom title propagation:** Extend `server/src/routes/flowsRun.ts` to parse `customTitle` with the same trim/empty rules as `conversationId` and `working_folder`, pass it to `startFlowRun`, and update `server/src/flows/service.ts` to use it for both memory and Mongo conversation titles (main flow + per-agent), keeping per-agent conversations agent-only (no `flowName`).
- **Client payloads:** Extend `client/src/api/flows.ts` and `FlowsPage` so `customTitle` is only sent when starting a new run (never on resume). Disable the input once a run starts or when resuming.
- **Conversation filtering regression:** Update `server/src/mongo/repo.ts` to combine `agentName=__none__` and `flowName=__none__` conditions using `$and` of each `$or` block so chat-only lists exclude both agents and flows.
- **Tests to adjust:**
  - Client: Flows page tests for WS upsert `flowName` retention, New Flow reset behavior, custom title payload, and popover warnings/empty state (patterned after Agents popover tests).
  - Server: flows run integration tests to assert `customTitle` affects main + per-agent titles, and listConversations filtering tests for chat/agent/flow isolation.

## Questions

Resolved:

- Flow info popover should follow the Agents UX; when a flow is disabled and `FlowSummary.error` exists, treat the error as a warning entry in the popover (same “Warnings” section layout as Agents).
- “New Flow” should keep the selected flow and sidebar list visible, but clear the active conversation/transcript and reset the custom name input.
- Per-agent flow conversations remain agent-only (no `flowName`) and do not appear in flow-filtered lists.

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
