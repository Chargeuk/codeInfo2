# Story 0000028 - Agents + Chat GUI consistency

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

The Agents and Chat pages currently waste vertical space and feel inconsistent with other pages (Chat, Agents, LM Studio, Ingest). Controls vary in size, alignment, and button styling, and the conversation view stops above the bottom of the screen leaving unused space. This story will reorganize the Agents controls to reclaim space, align inline controls to the same size and baseline, and make the conversation view fill the available height. It also introduces a reusable “Choose Folder” picker for Agents so folder selection behaves the same way as the Ingest page (Chat does not add a working-folder picker in this story). The end result should be a tighter, more consistent UI that feels aligned across pages, with primary and secondary actions clearly distinguished and better use of screen real estate.

---

## Acceptance Criteria

- Agents page removes the inline description block and replaces it with a small info icon next to the Agent selector; clicking it opens a popover that renders the agent description as Markdown and lists any warnings.
  - When no description or warnings exist, the popover shows a friendly empty-state message (e.g., “No description or warnings are available for this agent yet.”).
- Agents controls are re-laid out to reclaim vertical space:
  - The Command selector and the “Execute command” button appear on the same row, with the button to the right of the selector.
  - The Instruction input and the Send/Stop action share a single row on desktop; Send and Stop use the same width so the row does not shift when toggling.
- Chat and Agents conversation panels stretch to the bottom of the viewport (beneath the top navigation) with no visible blank gap below the transcript card; resizing the window stretches the transcript area instead of leaving empty whitespace.
- Agents include a “Choose folder…” button next to the working-folder input that reuses the Ingest directory picker dialog:
  - Clicking “Choose folder…” opens the same dialog title and folder list as Ingest.
  - Selecting a folder fills the working-folder input with the chosen absolute host path.
  - Cancel closes the dialog without changing the input value.
- Chat does not add a working-folder input or picker in this story.
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

None.

## Decisions

- Send/Stop buttons use a fixed width matching the larger label to prevent layout jitter when swapping.
- The info popover shows a friendly empty-state message when no description or warnings are available (e.g., “No description or warnings are available for this agent yet.”).
- Use `size="small"` for all form inputs and action buttons to establish the shared sizing baseline across Chat, Agents, LM Studio, and Ingest.
- Reuse the existing Ingest directory picker (`client/src/components/ingest/DirectoryPickerDialog.tsx`) rather than duplicating logic; if it needs to be shared, move it to a common components location and update Ingest imports.
- Chat working-folder support is explicitly out of scope for this story.

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
  - Chat requests do **not** currently accept `working_folder`—if the open question is resolved in favor of a Chat working-folder, that would require a new request field and validation updates. (Keep this out of scope unless explicitly approved.)
- No new WebSocket event types or MongoDB document shape changes are expected for this story.

---

## Edge Cases and Failure Modes

- **Agents with missing metadata**: If an agent has no description and no warnings, the info popover should render the empty-state message and not crash.
- **Agents fetch errors**: If the agents list fails to load, the info icon should remain disabled or hidden and the page should still render error messaging without layout breaking.
- **Directory picker empty results**: If the directory picker returns no folders or errors, the dialog should show the existing error/empty state and should not overwrite the working-folder input.
- **Working-folder validation errors**: If a chosen folder fails server validation (non-absolute path or missing directory), the existing error messaging should remain intact and the UI should not lose the user’s last value.
- **Responsive layout**: On small screens, the stacked layout should remain usable (no overlap, no clipped buttons) when the control rows collapse to columns.
- **Stop/Send toggling**: Send/Stop swapping should not shift layout; fixed widths prevent jitter when Stop appears/disappears.

---

# Implementation Plan

## Instructions

These instructions will be followed during implementation.

# Tasks

### 1. Client: Chat/Agents transcript fills viewport

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Ensure the Chat and Agents transcript panels stretch to the bottom of the viewport with no blank gap. This task is limited to layout/flex changes only.

#### Documentation Locations

- MUI Box API: https://llms.mui.com/material-ui/6.4.12/api/box.md (layout container + `sx` flex controls)
- MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md (row/column stacking + spacing)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (running build/test scripts + passing args)
- Node.js test runner: https://nodejs.org/api/test.html (server `node:test` execution reference)
- Jest docs: Context7 `/jestjs/jest` (client test runner usage)
- Playwright docs: Context7 `/microsoft/playwright` (e2e runs + screenshots)
- Docker/Compose docs: Context7 `/docker/docs` (compose build/up/down)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Review layout containers and locate the height break:
   - Documentation to read (repeat):
     - MUI Box API: https://llms.mui.com/material-ui/6.4.12/api/box.md
     - MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md
   - Files to read:
     - `client/src/App.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/test/chatPage.layoutWrap.test.tsx`
   - Story requirements to repeat here so they are not missed:
     - Chat and Agents conversation panels must stretch to the bottom of the viewport with no blank gap below the transcript card.
     - Resizing the window should expand the transcript area, not add whitespace.
   - Goal:
     - Identify which container(s) need `flex: 1` and `minHeight: 0` so the transcript can grow and scroll.
     - Confirm whether `Container` bottom padding or `overflow: auto` is creating a visible gap.
   - Notes:
     - Keep existing spacing and padding intact; this is layout-only.

2. [ ] Implement flex/minHeight adjustments for full-height layout:
   - Documentation to read (repeat):
     - MUI Box API: https://llms.mui.com/material-ui/6.4.12/api/box.md
     - MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md
   - Files to edit:
     - `client/src/App.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - Ensure the app shell uses a full-height flex column.
     - Ensure the main content area and transcript container use `flex: 1` with `minHeight: 0`.
     - Remove or reduce bottom padding/overflow behavior that causes a visible blank gap below the transcript card.
     - Prefer page-level tweaks first; only adjust the App shell if the gap cannot be resolved locally.
     - Do not change control sizes or button variants (handled in Tasks 6-7).

3. [ ] Test (unit/client): Chat transcript inline styles
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/chatPage.layoutWrap.test.tsx`
   - Description:
     - Add an assertion that the Chat transcript container uses inline styles `flex: 1 1 0%`, `minHeight: 0`, and `overflowY: auto` on `data-testid="chat-transcript"`.
   - Purpose:
     - Proves the transcript can stretch/scroll and the viewport gap fix is in place for Chat.

4. [ ] Test (unit/client): Agents transcript inline styles
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layout.test.tsx`
   - Description:
     - Add the same inline style assertions for the Agents transcript `data-testid="chat-transcript"`.
   - Purpose:
     - Proves the transcript can stretch/scroll and the viewport gap fix is in place for Agents.
   - Note:
     - Use inline style assertions to avoid brittle CSS class checks.

5. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Use Playwright MCP to capture:
     - Chat page full-height transcript.
     - Agents page full-height transcript.
   - Move files into `planning/0000028-agents-chat-gui-consistency-data/` with names:
     - `0000028-1-chat-height.png`
     - `0000028-1-agents-height.png`

6. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - `design.md`: add a short note if the layout behavior is described for Chat/Agents.
   - `projectStructure.md`: update only if any files were added/removed/renamed.

7. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check: verify Chat and Agents transcripts stretch to the bottom of the viewport without a blank gap.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

### 2. Client: Agents description/warnings popover

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Replace the inline agent description block with an info icon and popover that renders Markdown plus warnings, including an empty-state message when nothing is available.

#### Documentation Locations

- MUI Popover component: https://llms.mui.com/material-ui/6.4.12/components/popover.md (popover behavior + positioning)
- MUI Popover API: https://llms.mui.com/material-ui/6.4.12/api/popover.md (props: `open`, `anchorEl`, `onClose`)
- MUI IconButton API: https://llms.mui.com/material-ui/6.4.12/api/icon-button.md (info icon button sizing)
- Jest docs: Context7 `/jestjs/jest` (client test updates for popover)
- Playwright docs: Context7 `/microsoft/playwright` (popover screenshot capture)
- Docker/Compose docs: Context7 `/docker/docs` (compose checks in testing steps)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test scripts)
- Node.js test runner: https://nodejs.org/api/test.html (server test command reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Review the current Agents description block and Markdown rendering:
   - Documentation to read (repeat):
     - MUI Popover component: https://llms.mui.com/material-ui/6.4.12/components/popover.md
     - MUI IconButton API: https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/Markdown.tsx`
     - `client/src/api/agents.ts`
   - Story requirements to repeat here so they are not missed:
     - Info icon sits next to the Agent selector; clicking opens a popover.
     - Popover renders Markdown description and lists warnings.
     - Empty-state message appears when both description and warnings are missing.
     - If the agents list fails to load, the info icon should be hidden/disabled and the error UI should still render cleanly.

2. [ ] Implement the info icon + popover UI:
   - Documentation to read (repeat):
     - MUI Popover component: https://llms.mui.com/material-ui/6.4.12/components/popover.md
     - MUI Popover API: https://llms.mui.com/material-ui/6.4.12/api/popover.md
     - MUI IconButton API: https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - Add an IconButton next to the Agent selector and anchor a Popover to it.
     - Use `Popover` props `open`, `anchorEl`, and `onClose` per MUI 6.4.x API.
     - Set the IconButton `size="small"` for alignment; do not add a `variant` prop (IconButton does not use variants in MUI core).
     - Reuse the existing `Markdown` renderer for the description text.
     - Render warnings as a simple list under the description.
     - Show the friendly empty-state message when both description and warnings are empty.
     - Ensure the info icon does not render (or renders disabled) when agents fail to load.
     - Remove the inline warnings alert and inline description `Paper` so metadata is only in the popover.
     - Keep layout spacing compact; avoid introducing a new full-width block.

3. [ ] Test (unit/client): Info icon renders for selected agent
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (extend existing test file)
   - Description:
     - Add a test that renders the Agents page with a selected agent and asserts the info icon button exists.
   - Purpose:
     - Confirms the popover entry point appears on the happy path.

4. [ ] Test (unit/client): Popover shows Markdown description
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx` if the file grows too large)
   - Description:
     - Trigger the info icon and assert Markdown description content is rendered inside the popover.
   - Purpose:
     - Validates the description rendering moved from inline to popover.

5. [ ] Test (unit/client): Warnings list renders in popover
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx`)
   - Description:
     - Provide an agent with warnings and assert they appear in the popover content.
   - Purpose:
     - Confirms warning display is preserved after moving to popover.

6. [ ] Test (unit/client): Empty-state message
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx`)
   - Description:
     - Use an agent with no description and no warnings; open the popover and assert the empty-state message.
   - Purpose:
     - Covers the empty metadata edge case required by acceptance criteria.

7. [ ] Test (unit/client): Agents fetch error hides or disables info icon
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx`)
   - Description:
     - Simulate `/agents` failure and assert the error UI renders while the info icon is hidden or disabled.
   - Purpose:
     - Ensures error states do not expose a broken popover trigger.

8. [ ] Test (unit/client): Inline warnings/description removed
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx`)
   - Description:
     - Assert that inline warning alerts and description panel are not present when the popover is closed.
   - Purpose:
     - Guarantees the UI change removed the previous inline block.

9. [ ] Documentation update: `projectStructure.md` (if a new test file was added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure any newly added test file is reflected in the repo tree.

10. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Use Playwright MCP to capture the Agents page with the info popover open.
   - Move the screenshot into `planning/0000028-agents-chat-gui-consistency-data/` as `0000028-2-agents-popover.png`.

11. [ ] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add a short note if agent metadata display behavior is described.

12. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client -- agentsPage.descriptionPopover`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check: open the info popover, verify Markdown renders, warnings list displays, and empty-state appears for agents without metadata.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

### 3. Client: Agents control rows layout

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Align Agents controls so the Command selector and Execute button share a row, and the Instruction input shares a row with the Send/Stop action slot. This task focuses on row structure only.

#### Documentation Locations

- MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md (row/column layout + spacing)
- MUI Box API: https://llms.mui.com/material-ui/6.4.12/api/box.md (flex container layout)
- MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md (action buttons)
- MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md (input sizing/props)
- Jest docs: Context7 `/jestjs/jest` (layout test updates)
- Playwright docs: Context7 `/microsoft/playwright` (layout screenshots)
- Docker/Compose docs: Context7 `/docker/docs` (compose checks in testing steps)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test scripts)
- Node.js test runner: https://nodejs.org/api/test.html (server test command reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Review current Agents controls layout:
   - Documentation to read (repeat):
     - MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
   - Story requirements to repeat here so they are not missed:
     - Command selector and Execute command button are on the same row.
     - Instruction input and the Send/Stop action share the same row.

2. [ ] Implement the control row layout changes:
   - Documentation to read (repeat):
     - MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md
     - MUI Box API: https://llms.mui.com/material-ui/6.4.12/api/box.md
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
     - MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - Restructure controls into two horizontal rows (Stack or Box with `display: 'flex'`).
     - Row 1: Command selector on the left and Execute command button on the right.
     - Keep the command description text below the row so it still renders.
     - Row 2: Instruction input on the left and an action slot on the right.
     - Move the Stop button out of the Agent selector row into the instruction row.
     - Ensure the rows collapse to a single column on small screens without overlap.
     - Do not implement fixed widths or send/stop toggling in this task (handled in Task 4).
     - Keep existing sizes/variants unchanged in this task (standardization happens in Tasks 6-7).

3. [ ] Test (unit/client): Command row layout
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layout.test.tsx` (update if it already exists; otherwise create)
   - Description:
     - Assert the Command selector and Execute button render in the same row container.
   - Purpose:
     - Ensures the top control row matches the acceptance criteria layout.

4. [ ] Test (unit/client): Stop button moved to instruction row
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layout.test.tsx`
   - Description:
     - Assert Stop renders in the instruction row and is not present in the header row.
   - Purpose:
     - Ensures the row re-layout removed the Stop button from the header area.

5. [ ] Documentation update: `projectStructure.md` (if a new test file was added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure any newly added test file is reflected in the repo tree.

6. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Use Playwright MCP to capture the Agents controls area showing the new two-row layout.
   - Capture a second screenshot at a small viewport width to show the stacked layout.
   - Move screenshots into `planning/0000028-agents-chat-gui-consistency-data/` as:
     - `0000028-3-agents-controls.png`
     - `0000028-3-agents-controls-mobile.png`

7. [ ] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add a short note if control layout is described for Agents.

8. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client -- agentsPage.layout`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check: verify the two-row layout and stacked layout on a small viewport.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

### 4. Client: Agents send/stop width stability

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Ensure the Send/Stop action slot keeps a stable width so the row does not shift when toggling between Send and Stop.

#### Documentation Locations

- MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md (action row layout)
- MUI Box API: https://llms.mui.com/material-ui/6.4.12/api/box.md (fixed-width slot container)
- MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md (Send/Stop buttons)
- Jest docs: Context7 `/jestjs/jest` (layout test updates)
- Playwright docs: Context7 `/microsoft/playwright` (Send/Stop screenshot)
- Docker/Compose docs: Context7 `/docker/docs` (compose checks in testing steps)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test scripts)
- Node.js test runner: https://nodejs.org/api/test.html (server test command reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Review Send/Stop rendering conditions and current button layout:
   - Documentation to read (repeat):
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
   - Story requirements to repeat here so they are not missed:
     - Send/Stop use the same width so the row does not shift when toggling.
     - Only one of Send/Stop is shown at a time in the action slot.

2. [ ] Implement fixed-width Send/Stop slot:
   - Documentation to read (repeat):
     - MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md
     - MUI Box API: https://llms.mui.com/material-ui/6.4.12/api/box.md
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - Set a fixed `minWidth` (or similar) for the action slot so Send/Stop occupy the same width.
     - Render only one action button at a time (Send when idle, Stop when streaming) to avoid layout jitter.
     - Keep existing sizes/variants unchanged in this task (standardization happens in Tasks 6-7).

3. [ ] Test (unit/client): Action slot fixed width
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layout.test.tsx` (extend existing layout test)
   - Description:
     - Assert the Send/Stop action slot applies a fixed width style (`minWidth` or equivalent).
   - Purpose:
     - Prevents layout jitter when toggling between Send and Stop.

4. [ ] Test (unit/client): Single action rendered
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layout.test.tsx`
   - Description:
     - Assert only one of Send or Stop is rendered at a time in the action slot.
   - Purpose:
     - Confirms the toggle behavior required for stable layout.

5. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Use Playwright MCP to capture the instruction row showing the fixed-width Send/Stop slot.
   - Move the screenshot into `planning/0000028-agents-chat-gui-consistency-data/` as `0000028-4-agents-send-stop-width.png`.

6. [ ] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add a short note if the Send/Stop stability behavior is described.

7. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client -- agentsPage.layout`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check: toggle between Send/Stop and confirm the row width stays stable.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

### 5. Client: Agents working-folder picker reuse

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add a “Choose folder…” button next to the Agents working-folder input and reuse the existing Ingest directory picker dialog to populate the field.

#### Documentation Locations

- MUI Dialogs component: https://llms.mui.com/material-ui/6.4.12/components/dialogs.md (dialog behavior and structure)
- MUI Dialog API: https://llms.mui.com/material-ui/6.4.12/api/dialog.md (dialog props for open/close)
- MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md (Choose folder button)
- MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md (working-folder input)
- Jest docs: Context7 `/jestjs/jest` (picker test updates)
- Playwright docs: Context7 `/microsoft/playwright` (picker screenshot)
- Docker/Compose docs: Context7 `/docker/docs` (compose checks in testing steps)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test scripts)
- Node.js test runner: https://nodejs.org/api/test.html (server test command reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Review the existing directory picker implementation:
   - Documentation to read (repeat):
     - MUI Dialogs component: https://llms.mui.com/material-ui/6.4.12/components/dialogs.md
   - Files to read:
     - `client/src/components/ingest/DirectoryPickerDialog.tsx`
     - `client/src/components/ingest/ingestDirsApi.ts`
     - `client/src/components/ingest/IngestForm.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Story requirements to repeat here so they are not missed:
     - Clicking “Choose folder…” opens the same dialog title and folder list as Ingest.
     - Selecting a folder fills the working-folder input with the absolute host path.
     - Cancel closes the dialog without changing the input value.

2. [ ] Reuse the picker for Agents:
   - Documentation to read (repeat):
     - MUI Dialogs component: https://llms.mui.com/material-ui/6.4.12/components/dialogs.md
     - MUI Dialog API: https://llms.mui.com/material-ui/6.4.12/api/dialog.md
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
     - MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/ingest/DirectoryPickerDialog.tsx` (only if a small prop tweak is needed for reuse)
   - Implementation details:
     - Import and reuse `DirectoryPickerDialog` and `ingestDirsApi` directly from the ingest components (do not move files unless necessary).
    - Add a “Choose folder…” button next to the working-folder input that opens the dialog.
    - Update the working-folder state when a folder is selected; cancel should be a no-op.
    - Ensure server-side validation errors (e.g., `WORKING_FOLDER_INVALID`) do not clear the current working-folder value.
     - Do not add a working-folder picker to Chat (explicitly out of scope).

3. [ ] Test (unit/client): Picker opens
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx` (new)
   - Description:
     - Click “Choose folder…” and assert the directory picker dialog opens.
   - Purpose:
     - Validates the happy-path trigger for the picker.

4. [ ] Test (unit/client): Select folder updates input
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
   - Description:
     - Simulate selecting a folder and assert the working-folder input updates to the selected path.
   - Purpose:
     - Confirms the primary selection path updates state.

5. [ ] Test (unit/client): Cancel keeps input value
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
   - Description:
     - Open the picker, cancel, and assert the working-folder input value stays unchanged.
   - Purpose:
     - Covers the cancel path with no state mutation.

6. [ ] Test (unit/client): Picker error does not wipe value
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
   - Description:
     - Simulate `/ingest/dirs` error payload and ensure the existing working-folder value remains.
   - Purpose:
     - Protects against error-state regressions.

7. [ ] Test (unit/client): Run validation error does not wipe value
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx` or `client/src/test/agentsPage.run.test.tsx`
   - Description:
     - Simulate `WORKING_FOLDER_INVALID` or `WORKING_FOLDER_NOT_FOUND` from run endpoint and ensure the input value is preserved.
   - Purpose:
     - Ensures validation errors do not clear user input.

8. [ ] Documentation update: `projectStructure.md` (new test file added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Add the new `agentsPage.workingFolderPicker.test.tsx` file to the repo tree.

9. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Use Playwright MCP to capture the Agents page with the picker dialog open.
   - Move the screenshot into `planning/0000028-agents-chat-gui-consistency-data/` as `0000028-5-agents-folder-picker.png`.

10. [ ] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add a short note describing the Agents working-folder picker.

11. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client -- agentsPage.workingFolderPicker`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check: open the Agents working-folder picker, select a folder, cancel, and confirm value persistence.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

### 6. Client: Control sizing + variant consistency (Chat + Agents)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Standardize sizing and button variants across Chat and Agents so all controls use `size="small"`, primary actions are contained, secondary actions are outlined, and Stop is contained error.

#### Documentation Locations

- MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md (variants + sizing)
- MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md (input sizing)
- MUI Select API: https://llms.mui.com/material-ui/6.4.12/api/select.md (select variant behavior)
- Jest docs: Context7 `/jestjs/jest` (client test updates)
- Playwright docs: Context7 `/microsoft/playwright` (sizing screenshots)
- Docker/Compose docs: Context7 `/docker/docs` (compose checks in testing steps)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test scripts)
- Node.js test runner: https://nodejs.org/api/test.html (server test command reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Inventory current control sizes and variants on each page:
   - Documentation to read (repeat):
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
     - MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md
   - Files to read:
    - `client/src/pages/ChatPage.tsx`
    - `client/src/pages/AgentsPage.tsx`
   - Story requirements to repeat here so they are not missed:
     - All dropdowns and text inputs use `size="small"`.
     - Buttons on the same row use `size="small"` and align to input height.
     - Primary actions are `variant="contained"`.
     - Secondary actions are `variant="outlined"`.
     - Stop uses `variant="contained"` with `color="error"`.

2. [ ] Apply size and variant updates across Chat and Agents:
   - Documentation to read (repeat):
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
     - MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md
     - MUI Select API: https://llms.mui.com/material-ui/6.4.12/api/select.md
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - Set `size="small"` on all TextField/Select controls.
     - Update primary actions (Send, Execute command, Run/Start) to `contained`.
     - Update secondary actions (Choose folder, New conversation, Clear, Refresh models) to `outlined`.
     - Ensure Stop uses `contained` + `color="error"` consistently.

3. [ ] Test (unit/client): Chat control sizes/variants
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/chatPage.*.test.tsx` (update the most relevant existing test)
   - Description:
     - Add assertions for Chat inputs/selects using `size="small"` and buttons using expected variants.
   - Purpose:
     - Confirms the sizing/variant baseline for Chat controls.
   - Note:
     - If no tests assert size/variant props today, prefer screenshots and skip adding new assertions.

4. [ ] Test (unit/client): Agents control sizes/variants
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layout.test.tsx`
   - Description:
     - Add assertions for Agents inputs/selects using `size="small"` and buttons using expected variants.
   - Purpose:
     - Confirms the sizing/variant baseline for Agents controls.
   - Note:
     - If no tests assert size/variant props today, prefer screenshots and skip adding new assertions.

5. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Use Playwright MCP to capture:
     - Chat controls sizing.
     - Agents controls sizing.
   - Move files into `planning/0000028-agents-chat-gui-consistency-data/` with names:
     - `0000028-6-chat-sizing.png`
     - `0000028-6-agents-sizing.png`

6. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - `design.md`: add a short note describing the shared sizing + variant baseline.
   - `projectStructure.md`: update only if files were added/removed/renamed.

7. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check: verify Chat/Agents controls use `size="small"`, primary/secondary variants match the rules, and Stop uses `contained` + `error`.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

---

### 7. Client: Control sizing + variant consistency (LM Studio + Ingest)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Standardize sizing and button variants across LM Studio and Ingest so controls use `size="small"`, primary actions are contained, and secondary actions are outlined.

#### Documentation Locations

- MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md (variants + sizing)
- MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md (input sizing)
- MUI Select API: https://llms.mui.com/material-ui/6.4.12/api/select.md (select variant behavior)
- Jest docs: Context7 `/jestjs/jest` (client test updates)
- Playwright docs: Context7 `/microsoft/playwright` (sizing screenshots)
- Docker/Compose docs: Context7 `/docker/docs` (compose checks in testing steps)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test scripts)
- Node.js test runner: https://nodejs.org/api/test.html (server test command reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Inventory current control sizes and variants on each page:
   - Documentation to read (repeat):
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
     - MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md
   - Files to read:
     - `client/src/pages/LmStudioPage.tsx`
     - `client/src/components/ingest/IngestForm.tsx`
   - Story requirements to repeat here so they are not missed:
     - All dropdowns and text inputs use `size="small"`.
     - Buttons on the same row use `size="small"` and align to input height.
     - Primary actions are `variant="contained"`.
     - Secondary actions are `variant="outlined"`.

2. [ ] Apply size and variant updates across LM Studio and Ingest:
   - Documentation to read (repeat):
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
     - MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md
     - MUI Select API: https://llms.mui.com/material-ui/6.4.12/api/select.md
   - Files to edit:
     - `client/src/pages/LmStudioPage.tsx`
     - `client/src/components/ingest/IngestForm.tsx`
   - Implementation details:
     - Set `size="small"` on all TextField/Select controls.
     - Update primary actions (Check status, Start ingest) to `contained`.
     - Update secondary actions (Reset, Refresh models, Choose folder) to `outlined`.

3. [ ] Test (unit/client): LM Studio control sizes/variants
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/lmstudio.test.tsx`
   - Description:
     - Add assertions for LM Studio inputs using `size="small"` and buttons using expected variants.
   - Purpose:
     - Confirms the sizing/variant baseline for LM Studio.
   - Note:
     - If no tests assert size/variant props today, prefer screenshots and skip adding new assertions.

4. [ ] Test (unit/client): Ingest control sizes/variants
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/ingestForm.test.tsx`
   - Description:
     - Add assertions for Ingest inputs using `size="small"` and buttons using expected variants.
   - Purpose:
     - Confirms the sizing/variant baseline for Ingest.
   - Note:
     - If no tests assert size/variant props today, prefer screenshots and skip adding new assertions.

5. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Use Playwright MCP to capture:
     - LM Studio controls sizing.
     - Ingest controls sizing.
   - Move files into `planning/0000028-agents-chat-gui-consistency-data/` with names:
     - `0000028-7-lmstudio-sizing.png`
     - `0000028-7-ingest-sizing.png`

6. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - `design.md`: add a short note describing the shared sizing + variant baseline.
   - `projectStructure.md`: update only if files were added/removed/renamed.

7. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check: verify LM Studio and Ingest controls use `size="small"` and primary/secondary variants match the rules.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

### 8. Final: Verify acceptance criteria + full regression

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Validate the full story requirements end-to-end and capture final evidence, including builds, tests, screenshots, and documentation updates.

#### Documentation Locations

- Docker/Compose docs: Context7 `/docker/docs` (clean builds + compose restart)
- Playwright docs: Context7 `/microsoft/playwright` (manual verification + screenshots)
- Husky docs: https://typicode.github.io/husky/get-started.html (pre-commit hook behavior reference)
- Mermaid docs: Context7 `/mermaid-js/mermaid` (diagram updates in design docs)
- Jest docs: Context7 `/jestjs/jest` (client test runner)
- Cucumber guides: https://cucumber.io/docs/guides/ (server cucumber test guidance)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test script execution)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (README/design/projectStructure updates)

#### Subtasks

1. [ ] Build the server
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] Build the client
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] Perform a clean docker build
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
4. [ ] Ensure `README.md` is updated with any required description changes and with any new commands added as part of this story
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
5. [ ] Ensure `design.md` is updated with any required description changes including mermaid diagrams that have been added as part of this story
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid: Context7 `/mermaid-js/mermaid`
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Testing

1. [ ] Run the client Jest tests
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
2. [ ] Run the server cucumber tests
   - Documentation to read (repeat):
     - Cucumber guides https://cucumber.io/docs/guides/
3. [ ] Restart the docker environment
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
4. [ ] Run the e2e tests
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
5. [ ] Use the Playwright MCP tool to manually check the application, saving screenshots to `./test-results/screenshots/`.
   - Each screenshot should be named `0000028-8-<short-name>.png`.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

#### Implementation notes

- (fill in during execution)

---
