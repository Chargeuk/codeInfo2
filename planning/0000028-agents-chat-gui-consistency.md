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
- **Directory picker reuse**: Extract or reuse `client/src/components/ingest/DirectoryPickerDialog.tsx` plus `client/src/components/ingest/ingestDirsApi.ts` for Agents only. Wire “Choose folder…” next to the working-folder input and update state on selection.
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
  - Chat requests do **not** currently accept `working_folder`—adding this would require a new request field and validation updates, so it remains out of scope.
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

- Task Status: **__done__**
- Git Commits: **c939d4a, 5f2ff38**

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

1. [x] Review layout containers and locate the height break:
   - Documentation to read (repeat):
     - MUI Box API: https://llms.mui.com/material-ui/6.4.12/api/box.md
     - MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md
   - Files to read:
     - `client/src/App.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/test/chatPage.layoutWrap.test.tsx`
   - Snippet to locate (transcript container):
     - `data-testid="chat-transcript"` with `style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto' }}`
   - Story requirements to repeat here so they are not missed:
     - Chat and Agents conversation panels must stretch to the bottom of the viewport with no blank gap below the transcript card.
     - Resizing the window should expand the transcript area, not add whitespace.
   - Goal:
     - Identify which container(s) need `flex: 1` and `minHeight: 0` so the transcript can grow and scroll.
     - Confirm whether `Container` bottom padding or `overflow: auto` is creating a visible gap.
   - Notes:
     - Keep existing spacing and padding intact; this is layout-only.

2. [x] Implement flex/minHeight adjustments for full-height layout:
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
     - Add log lines after layout is applied:
       - `DEV-0000028[T1] chat transcript layout ready` (include `{ page: 'chat' }`)
       - `DEV-0000028[T1] agents transcript layout ready` (include `{ page: 'agents' }`)
   - Snippet to apply (example):
     - `sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}` on the page shell
     - `style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto' }}` on the transcript container

3. [x] Test (unit/client): Chat transcript inline styles
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/chatPage.layoutWrap.test.tsx`
   - Description:
     - Add an assertion that the Chat transcript container uses inline styles `flex: 1 1 0%`, `minHeight: 0`, and `overflowY: auto` on `data-testid="chat-transcript"`.
   - Purpose:
     - Proves the transcript can stretch/scroll and the viewport gap fix is in place for Chat.
   - Snippet example:
     - `expect(screen.getByTestId('chat-transcript')).toHaveStyle({ flex: '1 1 0%', minHeight: '0px', overflowY: 'auto' });`

4. [x] Test (unit/client): Agents transcript inline styles
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layoutWrap.test.tsx`
   - Description:
     - Add the same inline style assertions for the Agents transcript `data-testid="chat-transcript"`.
   - Purpose:
     - Proves the transcript can stretch/scroll and the viewport gap fix is in place for Agents.
   - Note:
     - Use inline style assertions to avoid brittle CSS class checks.
   - Snippet example:
     - `expect(screen.getByTestId('chat-transcript')).toHaveStyle({ flex: '1 1 0%', minHeight: '0px', overflowY: 'auto' });`

5. [x] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-1-chat-height.png`
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-1-agents-height.png`
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-1-chat-height.png`
   - Use Playwright MCP to capture:
     - Chat page full-height transcript.
     - Agents page full-height transcript.
   - Move files into `planning/0000028-agents-chat-gui-consistency-data/` with names:
     - `0000028-1-chat-height.png`
     - `0000028-1-agents-height.png`

6. [x] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `design.md`
   - Description:
     - Add a short note describing the Chat/Agents transcript full-height behavior.
   - Purpose:
     - Keeps architecture/design notes aligned with the layout change.
   - Snippet example:
     - `- Chat/Agents transcript panels use flex + minHeight: 0 to fill the viewport.`

7. [x] Documentation update: `projectStructure.md` (if screenshots were added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include the new screenshots:
      - `planning/0000028-agents-chat-gui-consistency-data/0000028-1-chat-height.png`
      - `planning/0000028-agents-chat-gui-consistency-data/0000028-1-agents-height.png`
   - Purpose:
     - Keeps the repo map accurate.
  - Snippet example:
    - `planning/0000028-agents-chat-gui-consistency-data/0000028-1-chat-height.png`

8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, verify Chat and Agents transcripts stretch to the bottom without blank gaps, resize to confirm flex growth, and confirm the debug console shows no errors.
   - Capture Playwright MCP screenshots that show the full-height transcript on Chat and Agents; confirm the images live under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (docker-compose.local.yml mapping) before moving/recording them.
   - Expected log lines (debug console):
     - `DEV-0000028[T1] chat transcript layout ready` appears at least once.
     - `DEV-0000028[T1] agents transcript layout ready` appears at least once.
9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed App, Chat, and Agents layout containers; main flex chain uses App `Container` + page `Container` with `pb` likely causing the visual gap, while transcript already has inline flex + minHeight.
- Set Chat/Agents page `pb` to `0` and added layout-ready log lines for both pages to confirm the transcript container can fill the remaining flex height.
- Added a Chat layout test asserting the transcript container retains `flex: 1 1 0%`, `minHeight: 0`, and `overflowY: auto` inline styles.
- Added an Agents layout test to confirm the transcript container keeps the same inline flex + minHeight + overflow styles.
- Captured Task 1 screenshots for Chat and Agents transcript height and moved them into the planning data folder.
- Documented the Chat/Agents full-height transcript behavior in `design.md`.
- Updated `projectStructure.md` with the new Task 1 screenshots (and the current planning entries).
- Ran lint + format checks; lint reported existing server import-order warnings, but formatting passed cleanly.
- `npm run build --workspace server` completed successfully.
- `npm run build --workspace client` completed successfully (build warning about large chunks only).
- Server tests initially failed on `flows.list` expecting no flows; updated the test to set `FLOWS_DIR` to a missing folder and the full `npm run test --workspace server` run then passed.
- Client tests failed on minHeight style strictness; relaxed the assertions to accept `'0'` or `'0px'` and the full `npm run test --workspace client` run then passed.
- `npm run e2e` completed successfully.
- `npm run compose:build` completed successfully.
- `npm run compose:up` completed successfully.
- Manual Playwright check confirmed the transcript fills the viewport on Chat/Agents after resizing, and console logs included `DEV-0000028[T1] chat transcript layout ready` and `DEV-0000028[T1] agents transcript layout ready`; updated Task 1 screenshots accordingly.
- `npm run compose:down` completed successfully.

---

### 2. Client: Agents description/warnings popover

- Task Status: **__done__**
- Git Commits: **391df14, f2d5def**

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

1. [x] Review the current Agents description block and Markdown rendering:
   - Documentation to read (repeat):
     - MUI Popover component: https://llms.mui.com/material-ui/6.4.12/components/popover.md
     - MUI IconButton API: https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/Markdown.tsx`
     - `client/src/api/agents.ts`
   - Snippet to locate (current inline block):
     - `data-testid="agent-description"` and `data-testid="agent-warnings"`
   - Story requirements to repeat here so they are not missed:
     - Info icon sits next to the Agent selector; clicking opens a popover.
     - Popover renders Markdown description and lists warnings.
     - Empty-state message appears when both description and warnings are missing.
     - If the agents list fails to load, the info icon should be hidden/disabled and the error UI should still render cleanly.

2. [x] Implement the info icon + popover UI:
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
     - Add `aria-label="Agent info"` and `data-testid="agent-info"` to the IconButton for accessibility and test selection.
     - Reuse the existing `Markdown` renderer for the description text.
     - Render warnings as a simple list under the description.
    - Show the friendly empty-state message when both description and warnings are empty.
    - Ensure the info icon does not render (or renders disabled) when agents fail to load.
    - Remove the inline warnings alert and inline description `Paper` so metadata is only in the popover.
    - Keep layout spacing compact; avoid introducing a new full-width block.
    - Add a log line when the popover opens so the interaction can be confirmed in manual checks:
      - `DEV-0000028[T2] agent info popover opened` (include `{ agentName, hasDescription, warningsCount }`).
   - Snippet to apply (example):
     - `<IconButton size="small" aria-label="Agent info" data-testid="agent-info" onClick={...} />`
     - `<Popover open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={handleClose}>...</Popover>`

3. [x] Test (unit/client): Info icon renders for selected agent
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (extend existing test file)
   - Description:
     - Add a test that renders the Agents page with a selected agent and asserts the info icon button (`data-testid="agent-info"`) exists.
   - Purpose:
     - Confirms the popover entry point appears on the happy path.
   - Snippet example:
     - `expect(await screen.findByTestId('agent-info')).toBeInTheDocument();`

4. [x] Test (unit/client): Popover shows Markdown description
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx` if the file grows too large)
   - Description:
     - Trigger the info icon (`data-testid="agent-info"`) and assert Markdown description content is rendered inside the popover.
   - Purpose:
     - Validates the description rendering moved from inline to popover.
   - Snippet example:
     - `await user.click(screen.getByTestId('agent-info'));`
     - `expect(screen.getByText('Hello')).toBeInTheDocument();`

5. [x] Test (unit/client): Warnings list renders in popover
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx`)
   - Description:
     - Provide an agent with warnings and assert they appear in the popover content after clicking `data-testid="agent-info"`.
   - Purpose:
     - Confirms warning display is preserved after moving to popover.
   - Snippet example:
     - `expect(screen.getByText('Warning text')).toBeInTheDocument();`

6. [x] Test (unit/client): Empty-state message
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx`)
   - Description:
     - Use an agent with no description and no warnings; open the popover via `data-testid="agent-info"` and assert the empty-state message.
   - Purpose:
     - Covers the empty metadata edge case required by acceptance criteria.
   - Snippet example:
     - `expect(screen.getByText('No description or warnings are available')).toBeInTheDocument();`

7. [x] Test (unit/client): Agents fetch error hides or disables info icon
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx`)
   - Description:
     - Simulate `/agents` failure and assert the error UI renders while `data-testid="agent-info"` is hidden or disabled.
   - Purpose:
     - Ensures error states do not expose a broken popover trigger.
   - Snippet example:
     - `expect(screen.queryByTestId('agent-info')).toBeNull();`

8. [x] Test (unit/client): Inline warnings/description removed
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.description.test.tsx` (or new `agentsPage.descriptionPopover.test.tsx`)
   - Description:
     - Assert that inline warning alerts and description panel are not present when the popover is closed.
   - Purpose:
     - Guarantees the UI change removed the previous inline block.
   - Snippet example:
     - `expect(screen.queryByTestId('agent-description')).toBeNull();`

9. [x] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-2-agents-popover.png`
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-2-agents-popover.png`
   - Use Playwright MCP to capture the Agents page with the info popover open.
   - Move the screenshot into `planning/0000028-agents-chat-gui-consistency-data/` as `0000028-2-agents-popover.png`.

10. [x] Documentation update: `projectStructure.md` (after new files are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include:
       - `client/src/test/agentsPage.descriptionPopover.test.tsx` (only if created)
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-2-agents-popover.png`
   - Purpose:
     - Keeps the repo map accurate after new test/screenshot files are added.
   - Snippet example:
     - `client/src/test/agentsPage.descriptionPopover.test.tsx`

11. [x] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add a short note if agent metadata display behavior is described.
   - Snippet example:
     - `- Agents page uses an info popover to show agent description + warnings.`

12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [x] `npm run test --workspace client -- agentsPage.descriptionPopover`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
6. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
7. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
9. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, open the info popover, verify Markdown renders, warnings list displays, empty-state appears for agents without metadata, and confirm the debug console shows no errors.
   - Capture a Playwright MCP screenshot of the open popover and confirm the image is stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording it.
   - Expected log lines (debug console):
     - `DEV-0000028[T2] agent info popover opened` appears when the info popover is opened.
10. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed `AgentsPage.tsx` for the inline description/warnings panel and current Markdown usage to replace with a popover.
- Added an info icon next to the Agent selector, wired it to a Popover, and moved description/warnings content into the popover with empty-state messaging and logging.
- Updated Agents description tests to cover info icon rendering, popover description/warnings, empty-state messaging, error handling, and removal of inline content.
- Captured the Agents info popover screenshot and moved it into the planning data folder.
- Updated `projectStructure.md` with the Task 2 popover screenshot.
- Renamed the description test file to `agentsPage.descriptionPopover.test.tsx` to align with the focused Jest run.
- Added an Agents UI note in `design.md` describing the info popover behavior.
- Ran lint + format checks; lint reported existing server import-order warnings, and Prettier required formatting updates which were applied and rechecked.
- `npm run build --workspace server` completed successfully for Task 2.
- `npm run build --workspace client` completed successfully for Task 2 (chunk size warning only).
- `npm run test --workspace server` completed successfully for Task 2.
- `npm run test --workspace client` completed successfully for Task 2.
- `npm run test --workspace client -- agentsPage.descriptionPopover` completed successfully.
- `npm run e2e` completed successfully for Task 2.
- `npm run compose:build` completed successfully for Task 2.
- `npm run compose:up` completed successfully for Task 2.
- Manual Playwright check at `http://host.docker.internal:5001/agents` confirmed the info popover renders agent descriptions, with `DEV-0000028[T2] agent info popover opened` in the console and no console errors.
- Captured a fresh Task 2 popover screenshot and moved it into `planning/0000028-agents-chat-gui-consistency-data/0000028-2-agents-popover.png`.
- All available agents had descriptions, so the empty-state message was not visible during manual verification; unit coverage still asserts the empty-state rendering path.
- `npm run compose:down` completed successfully for Task 2.

---

### 3. Client: Agents control rows layout

- Task Status: **__done__**
- Git Commits: **cc80949, 637ee94**

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

1. [x] Review current Agents controls layout:
   - Documentation to read (repeat):
     - MUI Stack API: https://llms.mui.com/material-ui/6.4.12/api/stack.md
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
   - Snippet to locate (current layout wrapper):
     - `Stack spacing={1}` wrapping command/execute/instruction blocks
   - Story requirements to repeat here so they are not missed:
     - Command selector and Execute command button are on the same row.
     - Instruction input and the Send/Stop action share the same row.

2. [x] Implement the control row layout changes:
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
    - Add a log line when the layout mode is resolved so manual checks can confirm responsive behavior:
      - `DEV-0000028[T3] agents controls layout mode` (include `{ mode: 'row' | 'stacked' }`).
   - Snippet to apply (example row):
     - `<Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="center">...`)

3. [x] Test (unit/client): Command row layout
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layoutWrap.test.tsx` (extend existing layout test)
   - Description:
     - Assert the Command selector and Execute button render in the same row container.
   - Purpose:
     - Ensures the top control row matches the acceptance criteria layout.
   - Snippet example:
     - `expect(commandRow).toContainElement(screen.getByTestId('agent-command-execute'));`

4. [x] Test (unit/client): Instruction row layout
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layoutWrap.test.tsx`
   - Description:
     - Assert the Instruction input and the Send/Stop action slot render within the same row container.
   - Purpose:
     - Ensures the instruction row matches the acceptance criteria layout.
   - Snippet example:
     - `expect(instructionRow).toContainElement(screen.getByTestId('agent-send'));`

5. [x] Test (unit/client): Stop button moved to instruction row
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layoutWrap.test.tsx`
   - Description:
     - Assert Stop renders in the instruction row and is not present in the header row.
   - Purpose:
     - Ensures the row re-layout removed the Stop button from the header area.
   - Snippet example:
     - `expect(headerRow.querySelector('[data-testid="agent-stop"]')).toBeNull();`

6. [x] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-3-agents-controls.png`
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-3-agents-controls-mobile.png`
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-3-agents-controls.png`
   - Use Playwright MCP to capture the Agents controls area showing the new two-row layout.
   - Capture a second screenshot at a small viewport width to show the stacked layout.
   - Move screenshots into `planning/0000028-agents-chat-gui-consistency-data/` as:
     - `0000028-3-agents-controls.png`
     - `0000028-3-agents-controls-mobile.png`

7. [x] Documentation update: `projectStructure.md` (after screenshots are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include:
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-3-agents-controls.png`
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-3-agents-controls-mobile.png`
   - Purpose:
     - Keeps the repo map accurate after new screenshots are added.
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-3-agents-controls-mobile.png`

8. [x] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add a short note if control layout is described for Agents.
   - Snippet example:
     - `- Agents controls are arranged as two rows on desktop, stacked on mobile.`

9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [x] `npm run test --workspace client -- agentsPage.layoutWrap`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
6. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
7. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
9. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, verify the two-row layout on desktop, stacked layout on small viewport, and confirm the debug console shows no errors.
   - Capture Playwright MCP screenshots for desktop and small viewport layouts; confirm the images are stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording them.
   - Expected log lines (debug console):
     - `DEV-0000028[T3] agents controls layout mode` appears with `mode: 'row'` on desktop.
     - `DEV-0000028[T3] agents controls layout mode` appears with `mode: 'stacked'` after resizing to a small viewport.
10. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed `AgentsPage.tsx` control stacks to locate the command/execute and instruction/send layout blocks to reflow into rows.
- Restructured Agents command and instruction controls into responsive row/stack layouts, moving Stop into the instruction action slot and logging `DEV-0000028[T3] agents controls layout mode`.
- Expanded `agentsPage.layoutWrap.test.tsx` to assert the command row, instruction row, and Stop button relocation.
- Captured Task 3 desktop and mobile Agents control layout screenshots and moved them into the planning data folder.
- Updated `projectStructure.md` with the Task 3 control layout screenshots.
- Documented the Agents control row layout behavior in `design.md`.
- Ran `npm run lint --workspaces` (existing server import-order warnings only) and `npm run format --workspaces` followed by `npm run format:check --workspaces`.
- `npm run build --workspace server` completed successfully for Task 3.
- `npm run build --workspace client` completed successfully for Task 3 (chunk size warning only).
- `npm run test --workspace server` completed successfully for Task 3.
- `npm run test --workspace client` completed successfully for Task 3.
- `npm run test --workspace client -- agentsPage.layoutWrap` completed successfully.
- `npm run e2e` completed successfully for Task 3.
- `npm run compose:build` completed successfully for Task 3.
- `npm run compose:up` completed successfully for Task 3.
- Manual Playwright check at `http://host.docker.internal:5001/agents` confirmed the desktop two-row controls and stacked mobile layout; console logs showed `DEV-0000028[T3] agents controls layout mode` during resize with no console errors.
- Captured fresh Task 3 desktop and mobile control layout screenshots and moved them into `planning/0000028-agents-chat-gui-consistency-data/`.
- `npm run compose:down` completed successfully for Task 3.

---

### 4. Client: Agents send/stop width stability

- Task Status: **__done__**
- Git Commits: **673006a, 48786af**

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

1. [x] Review Send/Stop rendering conditions and current button layout:
   - Documentation to read (repeat):
     - MUI Button API: https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
   - Snippet to locate (action buttons):
     - `data-testid="agent-send"` and `data-testid="agent-stop"`
   - Story requirements to repeat here so they are not missed:
     - Send/Stop use the same width so the row does not shift when toggling.
     - Only one of Send/Stop is shown at a time in the action slot.

2. [x] Implement fixed-width Send/Stop slot:
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
    - Add a log line when the action slot state changes so manual checks can confirm toggling:
      - `DEV-0000028[T4] agents action slot state` (include `{ showStop: boolean, minWidth }`).
   - Snippet to apply (example):
     - `<Box sx={{ minWidth: 120 }}>...</Box>` wrapping the Send/Stop slot

3. [x] Test (unit/client): Action slot fixed width
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layoutWrap.test.tsx` (extend existing layout test)
   - Description:
     - Assert the Send/Stop action slot applies a fixed width style (`minWidth` or equivalent).
   - Purpose:
     - Prevents layout jitter when toggling between Send and Stop.
   - Snippet example:
     - `expect(actionSlot).toHaveStyle({ minWidth: '120px' });`

4. [x] Test (unit/client): Single action rendered
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layoutWrap.test.tsx`
   - Description:
     - Assert only one of Send or Stop is rendered at a time in the action slot.
   - Purpose:
     - Confirms the toggle behavior required for stable layout.
   - Snippet example:
     - `expect(screen.queryByTestId('agent-stop')).toBeNull();`

5. [x] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-4-agents-send-stop-width.png`
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-4-agents-send-stop-width.png`
   - Use Playwright MCP to capture the instruction row showing the fixed-width Send/Stop slot.
   - Move the screenshot into `planning/0000028-agents-chat-gui-consistency-data/` as `0000028-4-agents-send-stop-width.png`.

6. [x] Documentation update: `projectStructure.md` (after screenshots are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include:
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-4-agents-send-stop-width.png`
   - Purpose:
     - Keeps the repo map accurate after the screenshot is added.
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-4-agents-send-stop-width.png`

7. [x] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add a short note if the Send/Stop stability behavior is described.
   - Snippet example:
     - `- Agents Send/Stop uses a fixed-width action slot to prevent layout shift.`

8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [x] `npm run test --workspace client -- agentsPage.layoutWrap`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
6. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
7. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
9. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, toggle between Send/Stop, confirm row width stays stable, and confirm the debug console shows no errors.
   - Capture a Playwright MCP screenshot showing the fixed-width Send/Stop slot; confirm the image is stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording it.
   - Expected log lines (debug console):
     - `DEV-0000028[T4] agents action slot state` appears with `showStop: false` when idle.
     - `DEV-0000028[T4] agents action slot state` appears with `showStop: true` after triggering Stop.
10. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed the Send/Stop rendering logic and action slot container in `AgentsPage.tsx`.
- Added a fixed-width action slot, single-button rendering, and `DEV-0000028[T4] agents action slot state` logging.
- Expanded `agentsPage.layoutWrap.test.tsx` with action slot width and single-action assertions.
- Captured the Task 4 Send/Stop width screenshot and moved it into the planning data folder.
- Updated `projectStructure.md` with the Task 4 Send/Stop width screenshot entry.
- Documented the fixed-width Send/Stop action slot in `design.md`.
- Ran `npm run lint --workspaces` (existing server import-order warnings only) and `npm run format --workspaces` followed by `npm run format:check --workspaces`.
- `npm run build --workspace server` completed successfully for Task 4.
- `npm run build --workspace client` completed successfully for Task 4 (chunk size warning only).
- `npm run test --workspace server` completed successfully for Task 4.
- `npm run test --workspace client` completed successfully for Task 4.
- `npm run test --workspace client -- agentsPage.layoutWrap` completed successfully.
- `npm run e2e` completed successfully for Task 4.
- `npm run compose:build` completed successfully for Task 4.
- `npm run compose:up` completed successfully for Task 4.
- Manual Playwright-MCP check completed; Send/Stop toggled via the planning agent command and the action-slot log appeared for both idle and inflight states.
- Updated the Task 4 Send/Stop width screenshot from `playwright-output-local/playwright-output-local/0000028-4-agents-send-stop-width.png`.
- `npm run compose:down` completed successfully for Task 4.

---

### 5. Client: Agents working-folder picker reuse

- Task Status: **__done__**
- Git Commits: **e098241**

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

1. [x] Review the existing directory picker implementation:
   - Documentation to read (repeat):
     - MUI Dialogs component: https://llms.mui.com/material-ui/6.4.12/components/dialogs.md
   - Files to read:
     - `client/src/components/ingest/DirectoryPickerDialog.tsx`
     - `client/src/components/ingest/ingestDirsApi.ts`
     - `client/src/components/ingest/IngestForm.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Snippet to locate (Ingest usage):
     - `<DirectoryPickerDialog open={dirPickerOpen} onPick={...} onClose={...} />`
   - Story requirements to repeat here so they are not missed:
     - Clicking “Choose folder…” opens the same dialog title and folder list as Ingest.
     - Selecting a folder fills the working-folder input with the absolute host path.
     - Cancel closes the dialog without changing the input value.

2. [x] Reuse the picker for Agents:
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
    - Add log lines for picker interactions so manual checks can confirm each step:
      - `DEV-0000028[T5] agents folder picker opened` (include `{ source: 'agents' }`).
      - `DEV-0000028[T5] agents folder picker picked` (include `{ path }`).
      - `DEV-0000028[T5] agents folder picker cancelled` (no payload required).
   - Snippet to apply (example):
     - `<Button variant="outlined" size="small" onClick={() => setDirPickerOpen(true)}>Choose folder…</Button>`
     - `<DirectoryPickerDialog open={dirPickerOpen} path={workingFolder} onClose={...} onPick={(path) => setWorkingFolder(path)} />`

3. [x] Test (unit/client): Picker opens
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx` (new)
   - Description:
     - Click “Choose folder…” and assert the directory picker dialog opens.
   - Purpose:
     - Validates the happy-path trigger for the picker.
   - Snippet example:
     - `await user.click(screen.getByRole('button', { name: /choose folder/i }));`

4. [x] Test (unit/client): Select folder updates input
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
   - Description:
     - Simulate selecting a folder and assert the working-folder input updates to the selected path.
   - Purpose:
     - Confirms the primary selection path updates state.
   - Snippet example:
     - `expect(screen.getByTestId('agent-working-folder')).toHaveValue('/data/repo');`

5. [x] Test (unit/client): Cancel keeps input value
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
   - Description:
     - Open the picker, cancel, and assert the working-folder input value stays unchanged.
   - Purpose:
     - Covers the cancel path with no state mutation.
   - Snippet example:
     - `await user.click(screen.getByRole('button', { name: /cancel/i }));`

6. [x] Test (unit/client): Picker error does not wipe value
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
   - Description:
     - Simulate `/ingest/dirs` error payload and ensure the existing working-folder value remains.
   - Purpose:
     - Protects against error-state regressions.
   - Snippet example:
     - `mockFetch.mockResolvedValueOnce(mockErrorResponse({ status: 'error', code: 'NOT_FOUND' }));`

7. [x] Test (unit/client): Run validation error does not wipe value
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx` or `client/src/test/agentsPage.run.test.tsx`
   - Description:
     - Simulate `WORKING_FOLDER_INVALID` or `WORKING_FOLDER_NOT_FOUND` from run endpoint and ensure the input value is preserved.
   - Purpose:
     - Ensures validation errors do not clear user input.
   - Snippet example:
     - `expect(screen.getByTestId('agent-working-folder')).toHaveValue('/data/repo');`

8. [x] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-5-agents-folder-picker.png`
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-5-agents-folder-picker.png`
   - Use Playwright MCP to capture the Agents page with the picker dialog open.
   - Move the screenshot into `planning/0000028-agents-chat-gui-consistency-data/` as `0000028-5-agents-folder-picker.png`.

9. [x] Documentation update: `projectStructure.md` (after new files are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include:
       - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-5-agents-folder-picker.png`
   - Purpose:
     - Keeps the repo map accurate after new test/screenshot files are added.
   - Snippet example:
     - `client/src/test/agentsPage.workingFolderPicker.test.tsx`

10. [x] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add a short note describing the Agents working-folder picker.
   - Snippet example:
     - `- Agents page reuses the Ingest directory picker for working_folder selection.`

11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [x] `npm run test --workspace client -- agentsPage.workingFolderPicker`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
6. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
7. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
9. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, open the Agents working-folder picker, select a folder, cancel, confirm value persistence, and confirm the debug console shows no errors.
   - Capture a Playwright MCP screenshot with the folder picker dialog open; confirm the image is stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording it.
   - Expected log lines (debug console):
     - `DEV-0000028[T5] agents folder picker opened` appears when the dialog opens.
     - `DEV-0000028[T5] agents folder picker picked` appears after choosing a folder and includes the selected path.
     - `DEV-0000028[T5] agents folder picker cancelled` appears after canceling the dialog.
10. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed `DirectoryPickerDialog`, `ingestDirsApi`, `IngestForm`, and the Agents working_folder field to confirm dialog reuse and current state management.
- `npm run lint --workspaces` completed with existing server import-order warnings only.
- `npm run format:check --workspaces` completed successfully.
- Reused the ingest directory picker in Agents with a new Choose folder button, open/pick/cancel handlers, and T5 log lines.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the picker wiring.
- `npm run format:check --workspaces` completed successfully after the picker wiring.
- Added a working-folder picker test to verify the dialog opens from the Agents page.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the picker-open test.
- `npm run format:check --workspaces` completed successfully after the picker-open test.
- Added a picker navigation test to ensure selecting a folder updates the working_folder input.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the picker selection test.
- `npm run format --workspaces` fixed formatting, followed by a clean `npm run format:check --workspaces`.
- Added a picker close-path test to ensure cancel keeps the working_folder value unchanged.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the cancel test.
- `npm run format:check --workspaces` completed successfully after the cancel test.
- Added a picker error test to ensure ingest/dirs failures do not clear the working_folder value.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the error test.
- `npm run format --workspaces` fixed formatting, followed by a clean `npm run format:check --workspaces`.
- Added a run validation test to confirm WORKING_FOLDER_INVALID errors preserve the working_folder value.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the run validation test.
- `npm run format:check --workspaces` completed successfully after the run validation test.
- Captured the Task 5 folder picker screenshot with the dialog open and copied it to the planning data folder.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the screenshot capture.
- `npm run format:check --workspaces` completed successfully after the screenshot capture.
- Updated `projectStructure.md` with the new working-folder picker test and screenshot entries.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the project structure update.
- `npm run format:check --workspaces` completed successfully after the project structure update.
- Documented the Agents working-folder picker reuse in `design.md`.
- `npm run lint --workspaces` completed with existing server import-order warnings only after the design update.
- `npm run format:check --workspaces` completed successfully after the design update.
- `npm run lint --workspaces` completed with existing server import-order warnings only for the final Task 5 lint pass.
- `npm run format:check --workspaces` completed successfully for the final Task 5 format check.
- `npm run build --workspace server` completed successfully for Task 5 testing.
- `npm run build --workspace client` completed successfully for Task 5 testing (chunk size warning only).
- `npm run test --workspace server` completed successfully for Task 5 testing (needed extended timeout).
- Updated the working-folder picker test to wait for agent selection and enabled state before opening the dialog, then asserted the dialog role.
- `npm run test --workspace client` completed successfully for Task 5 testing.
- `npm run test --workspace client -- agentsPage.workingFolderPicker` completed successfully for Task 5 testing (existing act warnings logged).
- `npm run e2e` completed successfully for Task 5 testing.
- `npm run compose:build` completed successfully for Task 5 testing.
- `npm run compose:up` completed successfully for Task 5 testing.
- Manual Playwright-MCP check completed: opened the folder picker, selected `/Users/danielstapleton/Documents/dev/codeinfo2`, cancelled on the second open to confirm persistence, and captured `planning/0000028-agents-chat-gui-consistency-data/0000028-5-agents-folder-picker.png` with the dialog open.
- `npm run compose:down` completed successfully for Task 5 testing.
- Pending: build/test/e2e/compose steps for Task 5 are still outstanding.

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
   - Snippet to locate (current buttons):
     - `data-testid="agent-send"`, `data-testid="agent-stop"`, `data-testid="agent-command-execute"`

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
    - Update secondary actions (Choose folder, New conversation) to `outlined`.
    - Ensure Stop uses `contained` + `color="error"` consistently.
    - Add log lines when sizing/variants are applied so manual checks can confirm each page:
      - `DEV-0000028[T6] chat controls sizing applied` (include `{ page: 'chat' }`).
      - `DEV-0000028[T6] agents controls sizing applied` (include `{ page: 'agents' }`).
   - Snippet to apply (example):
     - `<Button variant="contained" size="small" data-testid="agent-send">Send</Button>`
     - `<Button variant="contained" color="error" size="small" data-testid="agent-stop">Stop</Button>`

3. [ ] Test (unit/client): Chat control sizes/variants
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/chatPage.*.test.tsx` (update the most relevant existing test)
   - Description:
     - Add assertions for at least one Chat TextField and Select using `size="small"`, plus primary/secondary buttons using expected variants (include Stop `contained` + `error` when streaming).
   - Purpose:
     - Confirms the sizing/variant baseline for Chat controls.
   - Snippet example:
     - `expect(sendButton).toHaveClass('MuiButton-contained');`
     - `expect(stopButton).toHaveClass('MuiButton-contained', { exact: false });`

4. [ ] Test (unit/client): Agents control sizes/variants
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/agentsPage.layoutWrap.test.tsx`
   - Description:
     - Add assertions that agent selectors/inputs use `size="small"` and buttons (Execute, Send, New conversation, Choose folder) use the expected variants; include Stop using `contained` + `error`.
   - Purpose:
     - Confirms the sizing/variant baseline for Agents controls.
   - Snippet example:
     - `expect(executeButton).toHaveClass('MuiButton-contained');`

5. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-6-chat-sizing.png`
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-6-agents-sizing.png`
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-6-chat-sizing.png`
   - Use Playwright MCP to capture:
     - Chat controls sizing.
     - Agents controls sizing.
   - Move files into `planning/0000028-agents-chat-gui-consistency-data/` with names:
     - `0000028-6-chat-sizing.png`
     - `0000028-6-agents-sizing.png`

6. [ ] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `design.md`
   - Description:
     - Add a short note describing the shared sizing + variant baseline for Chat and Agents controls.
   - Purpose:
     - Keeps the design reference aligned with the UI consistency work.
   - Snippet example:
     - `- Chat/Agents controls use size="small" and contained/outlined variants.`

7. [ ] Documentation update: `projectStructure.md` (after screenshots are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include:
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-6-chat-sizing.png`
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-6-agents-sizing.png`
   - Purpose:
     - Keeps the repo map accurate after layout changes.
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-6-agents-sizing.png`

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

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
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, verify Chat/Agents controls use `size="small"`, primary/secondary variants match the rules, Stop uses `contained` + `error`, and confirm the debug console shows no errors.
   - Capture Playwright MCP screenshots for Chat and Agents controls and confirm the images are stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording them.
   - Expected log lines (debug console):
     - `DEV-0000028[T6] chat controls sizing applied` appears after the Chat page renders.
     - `DEV-0000028[T6] agents controls sizing applied` appears after the Agents page renders.
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
   - Snippet to locate (current buttons):
     - `data-testid="ingest-run"` (or Start ingest button) and LM Studio action buttons

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
    - Add log lines when sizing/variants are applied so manual checks can confirm each page:
      - `DEV-0000028[T7] lmstudio controls sizing applied` (include `{ page: 'lmstudio' }`).
      - `DEV-0000028[T7] ingest controls sizing applied` (include `{ page: 'ingest' }`).
   - Snippet to apply (example):
     - `<Button variant="contained" size="small">Start ingest</Button>`

3. [ ] Test (unit/client): LM Studio control sizes/variants
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/lmstudio.test.tsx`
   - Description:
     - Add assertions for LM Studio inputs using `size="small"` and buttons using expected primary/secondary variants.
   - Purpose:
     - Confirms the sizing/variant baseline for LM Studio.
   - Snippet example:
     - `expect(resetButton).toHaveClass('MuiButton-outlined');`

4. [ ] Test (unit/client): Ingest control sizes/variants
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/ingestForm.test.tsx`
   - Description:
     - Add assertions for Ingest inputs using `size="small"` and buttons using expected primary/secondary variants (e.g., Start ingest contained, Choose folder outlined).
   - Purpose:
     - Confirms the sizing/variant baseline for Ingest.
   - Snippet example:
     - `expect(chooseFolderButton).toHaveClass('MuiButton-outlined');`

5. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-7-lmstudio-sizing.png`
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-7-ingest-sizing.png`
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-7-lmstudio-sizing.png`
   - Use Playwright MCP to capture:
     - LM Studio controls sizing.
     - Ingest controls sizing.
   - Move files into `planning/0000028-agents-chat-gui-consistency-data/` with names:
     - `0000028-7-lmstudio-sizing.png`
     - `0000028-7-ingest-sizing.png`

6. [ ] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `design.md`
   - Description:
     - Add a short note describing the shared sizing + variant baseline for LM Studio and Ingest controls.
   - Purpose:
     - Keeps the design reference aligned with the UI consistency work.
   - Snippet example:
     - `- LM Studio/Ingest controls use size="small" with contained/outlined variants.`

7. [ ] Documentation update: `projectStructure.md` (after screenshots are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include:
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-7-lmstudio-sizing.png`
       - `planning/0000028-agents-chat-gui-consistency-data/0000028-7-ingest-sizing.png`
   - Purpose:
     - Keeps the repo map accurate after layout changes.
   - Snippet example:
     - `planning/0000028-agents-chat-gui-consistency-data/0000028-7-lmstudio-sizing.png`

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

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
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, verify LM Studio and Ingest controls use `size="small"`, primary/secondary variants match the rules, and confirm the debug console shows no errors.
   - Capture Playwright MCP screenshots for LM Studio and Ingest controls and confirm the images are stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording them.
   - Expected log lines (debug console):
     - `DEV-0000028[T7] lmstudio controls sizing applied` appears after the LM Studio page renders.
     - `DEV-0000028[T7] ingest controls sizing applied` appears after the Ingest page renders.
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

1. [ ] Documentation update: `README.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `README.md`
   - Description:
     - Add/adjust any README guidance introduced by this story (UI consistency notes, new screenshots if relevant).
   - Snippet example:
     - `- Agents page uses an info popover for agent metadata.`
2. [ ] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid: Context7 `/mermaid-js/mermaid`
   - Location:
     - `design.md`
   - Description:
     - Add/adjust design notes and mermaid diagrams impacted by UI consistency changes.
   - Snippet example:
     - `- Agents layout now groups command + execute and instruction + send rows.`
3. [ ] Documentation update: `projectStructure.md` (after test screenshots are captured)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - After Testing step 8, update the repo tree to include any new screenshots:
       - `test-results/screenshots/0000028-8-<short-name>.png`
   - Purpose:
     - Keeps the repo map accurate after final verification artifacts are added.
   - Snippet example:
     - `test-results/screenshots/0000028-8-chat-final.png`
4. [ ] Add a regression-baseline log line used for final verification:
   - Files to edit:
     - `client/src/App.tsx`
   - Implementation details:
     - Add a log entry when the app shell mounts so manual checks can confirm the final regression baseline loaded.
     - Log line to add:
       - `DEV-0000028[T8] regression baseline ready` (include `{ page: 'app-shell' }`).
   - Snippet example:
     - `logInfo('DEV-0000028[T8] regression baseline ready', { page: 'app-shell' });`

5. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit: none (comment only)
   - Snippet example:
     - `- Updated Agents info popover, working-folder picker, and control sizing consistency.`

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Snippet to run:
     - `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Snippet to run:
     - `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Snippet to run:
     - `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Snippet to run:
     - `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Snippet to run:
     - `npm run e2e`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Snippet to run:
     - `npm run compose:build`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Snippet to run:
     - `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, verify all acceptance criteria, run a quick regression sweep, capture screenshots to `./test-results/screenshots/`, and confirm the debug console shows no errors.
   - Each screenshot should be named `0000028-8-<short-name>.png`.
   - Capture Playwright MCP screenshots for every acceptance-criteria UI state and confirm the images are stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording them.
   - Expected log lines (debug console):
     - `DEV-0000028[T8] regression baseline ready` appears once on initial load.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `test-results/screenshots/0000028-8-<short-name>.png`
   - Snippet example:
     - `test-results/screenshots/0000028-8-agents-final.png`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---
