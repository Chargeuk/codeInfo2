# Story 0000028 - Agents + Chat GUI consistency

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

The Agents and Chat pages currently waste vertical space and feel inconsistent with other pages (Chat, Agents, LM Studio, Ingest). Controls vary in size, alignment, and button styling, and the conversation view stops above the bottom of the screen leaving unused space. This story will reorganize the Agents controls to reclaim space, align inline controls to the same size and baseline, and make the conversation view fill the available height. It also introduces a reusable “Choose Folder” picker for Agents and Chat so folder selection behaves the same way as the Ingest page. The end result should be a tighter, more consistent UI that feels aligned across pages, with primary and secondary actions clearly distinguished and better use of screen real estate.

---

## Acceptance Criteria

- Agents page removes the inline description block and replaces it with a small info icon next to the Agent selector; clicking it opens a popover that renders the agent description as Markdown and lists any warnings.
  - When no description or warnings exist, the popover shows a friendly empty-state message (e.g., “No description or warnings are available for this agent yet.”).
- Agents controls are re-laid out to reclaim vertical space:
  - The Command selector and the “Execute command” button appear on the same row, with the button to the right of the selector.
  - The Instruction input and the Send/Stop action share a single row on desktop; Send and Stop use the same width so the row does not shift when toggling.
- Chat and Agents conversation panels stretch to the bottom of the viewport (beneath the top navigation) with no visible blank gap below the transcript card; resizing the window stretches the transcript area instead of leaving empty whitespace.
- Chat and Agents include a “Choose folder…” button next to the working-folder input that reuses the Ingest directory picker dialog:
  - Clicking “Choose folder…” opens the same dialog title and folder list as Ingest.
  - Selecting a folder fills the working-folder input with the chosen absolute host path.
  - Cancel closes the dialog without changing the input value.
- All dropdowns, text inputs, and buttons across Chat, Agents, LM Studio, and Ingest use the same sizing rules:
  - Form controls (TextField, Select, Autocomplete) use `size="small"`.
  - Buttons on the same row use `size="small"` and align vertically with the adjacent input height.
- Button hierarchy is consistent across pages with shared sizing:
  - Primary actions use `variant="contained"` (e.g., Send, Execute command, Start/Run actions).
  - Secondary actions use `variant="outlined"` (e.g., Choose folder, New conversation, Clear).
  - Stop uses `variant="contained"` with `color="error"`.
- Each task in this story captures and reviews fresh UI screenshots to confirm the layout and sizing changes.

## Visual References

- Chat layout gaps + control sizing baseline: `planning/0000028-agents-chat-gui-consistency-data/chat-page.png`
- Agents layout issues (agent description line, command layout, Send placement, conversation gap): `planning/0000028-agents-chat-gui-consistency-data/agents-page.png`
- LM Studio control sizing/variant differences: `planning/0000028-agents-chat-gui-consistency-data/lmstudio-page.png`
- Ingest control sizing + existing “Choose folder…” behavior to mirror: `planning/0000028-agents-chat-gui-consistency-data/ingest-page.png`

## Screenshot Workflow (required for every task)

1. Use the Playwright MCP tool to take screenshots (e.g. `browser_take_screenshot`) with a **relative** filename under `planning/0000028-agents-chat-gui-consistency-data/`.
2. Playwright saves to `/tmp/playwright-output`, which is mapped to `./playwright-output-local` on the host when using `docker-compose.local.yml`.
3. Move the screenshot into the repo folder so it is tracked alongside the plan:
   - Example: `mv playwright-output-local/planning/0000028-agents-chat-gui-consistency-data/<file>.png planning/0000028-agents-chat-gui-consistency-data/<file>.png`
4. Record which screenshots were reviewed for the task’s UI changes in the task notes once tasks are created.

---

## Out Of Scope

- New server APIs or changes to ingest/agent/chat back-end behavior beyond reusing the existing directory picker endpoint.
- Adding Chat `working_folder` support or any new chat request fields (unless explicitly approved after answering the open question).
- Visual redesigns of navigation, sidebar behavior, or conversation rendering beyond spacing/height adjustments.
- Adding new feature pages or new command/agent functionality.

---

## Questions

- Chat currently has no working-folder input and the `/chat` API does not accept `working_folder` (only Agents/Flows do). Should this story add a new Chat working-folder field and server support for `workingDirectoryOverride`, or should the “Choose folder…” requirement be limited to Agents only?

## Decisions

- Send/Stop buttons use a fixed width matching the larger label to prevent layout jitter when swapping.
- The info popover shows a friendly empty-state message when no description or warnings are available (e.g., “No description or warnings are available for this agent yet.”).
- Use `size="small"` for all form inputs and action buttons to establish the shared sizing baseline across Chat, Agents, LM Studio, and Ingest.
- Reuse the existing Ingest directory picker (`client/src/components/ingest/DirectoryPickerDialog.tsx`) rather than duplicating logic; if it needs to be shared, move it to a common components location and update Ingest imports.

---

## Implementation Ideas

- **Agents layout + info popover**: In `client/src/pages/AgentsPage.tsx`, replace the inline description/warnings block with an `IconButton` (info icon) next to the Agent selector that opens a `Popover` anchored to the icon. Render Markdown + warnings inside the popover, and show the empty-state message when both are missing.
- **Agents control rows**: Rebuild the controls stack in `AgentsPage.tsx` so the Command selector and Execute button share one row, and the Instruction input shares a row with Send/Stop. Apply fixed widths to Send/Stop to avoid jitter.
- **Directory picker reuse**: Extract or reuse `client/src/components/ingest/DirectoryPickerDialog.tsx` plus `client/src/components/ingest/ingestDirsApi.ts` for Agents (and Chat if the open question is resolved in favor). Wire “Choose folder…” next to the working-folder input and update state on selection.
- **Chat transcript height**: Verify `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx` containers keep `flex: 1` + `minHeight: 0` from page root to transcript. If a parent container constrains height (e.g., Stack/Container in `client/src/App.tsx`), adjust to let the transcript stretch to the bottom of the viewport.
- **Sizing + variants alignment**:
  - `ChatPage.tsx`: add `size="small"` to Provider/Model selects, Message field, and action buttons; update Stop to `contained` + `color="error"` (per Acceptance Criteria).
  - `AgentsPage.tsx`: set all TextField/Select/Button sizes to `small` and align variants (primary contained, secondary outlined, Stop contained error).
  - `LMStudioPage.tsx`: update TextField + Buttons to `size="small"` and adjust variants to match primary/secondary guidance (e.g., “Refresh models” should be outlined, not text).
  - `client/src/components/ingest/IngestForm.tsx`: set all inputs and buttons to `size="small"` and keep “Choose folder…” as outlined secondary.

---

## Message Contracts & Storage Impact

- This story is UI-only, so **no new API contracts or storage schema changes are required**.
- Existing contracts already cover the needed data:
  - Agent metadata (name/description/warnings) comes from `GET /agents` and the `AgentSummary`/`DiscoveredAgent` types.
  - Working-folder values are already accepted by Agents/Flows (`working_folder` in `POST /agents/:agentName/run` and `POST /flows/:flowName/run`).
-  - Chat requests do **not** currently accept `working_folder`—if the open question is resolved in favor of a Chat working-folder, that would require a new request field and validation updates. (Keep this out of scope unless explicitly approved.)
- No new WebSocket event types or MongoDB document shape changes are expected for this story.

---

# Implementation Plan

Tasks will be added after the open questions are answered.
