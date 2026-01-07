# Story 0000023 - Conversation sidebar fixes

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today, the Conversations sidebar on Chat and Agents has several UX and layout issues. The Agents sidebar lacks the same filters and archive/delete controls that exist on Chat, the content is cramped against the left edge, a horizontal scrollbar is always visible, and when the list grows it doesn’t provide a usable way to access older conversations. These issues make the sidebar feel inconsistent and hard to use.

We want the Chat and Agents sidebars to behave identically, with consistent padding, the same filter and archive/restore/delete capabilities, and a clean layout that never shows a horizontal scrollbar. The sidebar should also support viewing older items using the existing list paging controls so users can navigate beyond the initial viewport.

---

## Acceptance Criteria

- **Feature parity:** The Agents Conversations sidebar provides the same controls and behavior as Chat: filter tabs (Active / Active & Archived / Archived), per-row Archive/Restore buttons, bulk Archive/Restore actions, and Bulk Delete **only** when the filter is set to Archived.
- **Delete rule consistency:** Agent-scoped conversations follow the same rule as Chat: delete is only available when viewing Archived conversations.
- **Padding/spacing:** Conversation rows and the sidebar header/filter area use the **same left/right padding** so content aligns. Target **12px (MUI spacing 1.5 at the default 8px grid)** on both rows and header/filter containers, matching current Chat row padding. Text and controls must not be flush against the drawer edge.
- **No horizontal scroll:** The Drawer and its contents never show a left/right scrollbar at any viewport size (desktop or mobile), even with long titles or metadata.
- **Access to older items:** When conversations exceed the available vertical space, the **list panel** (the bordered list area) scrolls vertically. The “Load more” button is reachable at the bottom after scrolling and loads older conversations using the existing behavior.
- **No backend changes:** All fixes are client-side only; no server API or persistence behavior changes are required.

---

## Out Of Scope

- New backend endpoints or changes to conversation storage.
- Introducing a new pagination strategy (e.g., infinite scroll) beyond the existing “Load more” behavior.
- Redesigning the overall chat/agents layout beyond sidebar spacing and overflow fixes.

---

## Questions

- None.

---

## Contracts & Storage Changes (explicit)

- **No new message contracts.** This story only changes client-side rendering and wiring.
- **No new storage shapes.** Conversation persistence, filtering, and pagination data stay unchanged.
- **No changes to existing REST/WS payloads.** The sidebar uses existing conversation list endpoints and WS updates as-is.

---

## Research Findings (code-confirmed)

- **ConversationList layout:** The list container uses a Box with `overflow: 'hidden'`, `flex: 1`, `minHeight: 240`, and a column flex layout. The List itself uses `disablePadding` and each ListItem uses `disableGutters`, with row padding set on the ListItemButton (`py: 1.25`, `px: 1.5`). This explains the “squashed” look and why horizontal overflow is controlled by child widths rather than list padding.  
- **Pagination behavior:** ConversationList already renders a “Load more” button and expects `hasMore` + `onLoadMore`. There is no infinite-scroll implementation.  
- **Chat vs Agents differences:** Chat passes full archive/restore/bulk handlers and shows filters; Agents passes `variant="agents"` with no-op archive/restore and no bulk handlers, which disables filters/bulk actions in the shared component.  
- **Drawer layout:** Both Chat and Agents render the sidebar in a 320px MUI Drawer with a measured top offset and fixed height, and the content wrapper inside is set to `width: drawerWidth` and `height: '100%'`.

## Research Findings (docs/standards)

- **MUI Drawer & Paper slot:** MUI recommends using `slotProps.paper` (rather than deprecated `PaperProps`) to control the Drawer paper element, which is the correct place to set width/overflow behavior and prevent horizontal scrolling.  
- **MUI List/ListItem padding:** `disableGutters` removes left/right padding on ListItem; `disablePadding` removes padding on List. If these are used, explicit padding must be added back to avoid cramped content.  
- **MUI Stack/nowrap overflow:** MUI recommends `minWidth: 0` on the parent container when child text uses `noWrap`, preventing unintended horizontal overflow.  
- **General overflow guidance:** MUI system docs show `overflow` control via `sx`, and community guidance suggests using `overflowX: 'hidden'` when only vertical scrolling is desired (with a preference to fix the underlying width/padding cause rather than masking).

## Scope Assessment

The story is well scoped: it is confined to the client-side sidebar layout and feature parity between Chat and Agents, without any API changes. The existing list already supports “Load more,” so the work is primarily UI wiring and layout/overflow fixes rather than new functionality. This should fit in a single iteration.

## Improvements to Scope Clarity

- Make the **scroll container** explicit: the list area should scroll vertically (not the entire page), and the “Load more” control must remain reachable at the bottom of the list.
- Reaffirm **no new pagination mechanism** (no infinite scroll)—we reuse the existing button.
- Specify that **padding values should match Chat** once Agents is aligned (target 12px left/right for header + rows).

## Known Unknowns / Risks

- **Horizontal scrollbar root cause:** Likely caused by child width + padding (e.g., `noWrap` text inside a flex row without `minWidth: 0`) or by fixed-width wrappers inside the Drawer. This needs a quick visual check or DOM inspection once we implement changes.
- **Vertical scroll location:** Because the list container uses `overflow: hidden` and the Drawer paper height is fixed, we need to choose the exact element that will own vertical scrolling so the list area scrolls and the “Load more” control remains reachable, per acceptance criteria.
- **DeepWiki:** The repo is not indexed on DeepWiki yet, so we cannot rely on DeepWiki references for this story.

## Implementation Ideas

- **Unify Agents with Chat behavior:** In `client/src/pages/AgentsPage.tsx`, pass the same ConversationList props that Chat provides (archive/restore callbacks, bulk handlers, filter state, refresh/retry) and render the same UI variant as Chat so the Agents sidebar matches Chat exactly.
- **Align sidebar container styling:** Keep Drawer width and top-offset behavior consistent with Chat. Ensure the drawer paper and inner wrapper use `boxSizing: 'border-box'` and avoid fixed-width children that exceed the Drawer. Prefer `slotProps.paper` for overflow/width adjustments to follow MUI v6 guidance.
- **Fix left padding density:** ConversationList uses `List disablePadding` + `ListItem disableGutters` with small `px` values. Increase row padding and/or add container padding so content is not flush against the drawer edge, matching Chat’s current spacing.
- **Prevent horizontal scroll:** Add `minWidth: 0` to any Stack/Box that contains `noWrap` text (title + metadata) to avoid overflow. Only if needed, set `overflowX: 'hidden'` on the Drawer paper or list container after addressing width causes.
- **Ensure vertical scrolling and “Load more” reachability:** Make the list region the scroll container (e.g., `overflowY: 'auto'` on the list wrapper) so the footer bar remains reachable at the bottom. Keep the “Load more” button; do not add infinite scroll.
- **Tests to expect:** Update existing chat sidebar and agents sidebar tests to assert filters and bulk actions appear in Agents, plus verify padding/overflow behavior and that “Load more” is reachable when the list is long.

## Tasks

### 1. Client: ConversationList control parity (filters, row actions, bulk UI)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Update the shared `ConversationList` component so filter tabs, refresh, row-level archive/restore, and bulk actions are enabled based on available handlers rather than the `variant` prop. This keeps the UI reusable for both Chat and Agents without duplicating components.

#### Documentation Locations

- MUI ToggleButton/ToggleButtonGroup (filter tabs): https://llms.mui.com/material-ui/6.4.12/components/toggle-button.md
- MUI Lists (List, ListItem, ListItemButton): https://llms.mui.com/material-ui/6.4.12/components/lists.md
- MUI Stack (alignment + `minWidth: 0` guidance): https://llms.mui.com/material-ui/6.4.12/components/stack.md
- MUI Box (padding layout + `sx` usage): https://llms.mui.com/material-ui/6.4.12/components/box.md

#### Subtasks

1. [ ] Read current ConversationList usage and server constraints:
   - Files to read:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useConversations.ts`
     - `client/src/api/conversations.ts`
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
   - What to identify:
     - Where `variant === 'chat'` hides filters/refresh/bulk UI.
     - Which handlers Chat passes that Agents currently does not.
     - Confirm server list/bulk endpoints already support `agentName` and enforce archived-only delete (no server changes required).

2. [ ] Update `ConversationList` control gating:
   - Documentation to read:
     - MUI ToggleButtonGroup: https://llms.mui.com/material-ui/6.4.12/components/toggle-button.md
     - MUI Lists: https://llms.mui.com/material-ui/6.4.12/components/lists.md
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
   - Requirements:
     - Show filter ToggleButtonGroup and Refresh when handlers are supplied (not only when `variant === 'chat'`).
     - Enable bulk-selection UI when bulk handlers are supplied, regardless of variant.
     - Compute `enableBulkUi` from handler presence (`onBulkArchive`/`onBulkRestore`/`onBulkDelete`).
     - Allow per-row archive/restore actions for Agents (remove `variant === 'agents'` short-circuit).
     - Keep bulk delete strictly gated to `filterState === 'archived'`.
     - Preserve existing `data-testid` values for test stability.
     - Reuse existing bulk-selection logic (no new component).

3. [ ] Run formatting/linting and resolve any failures:
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed, apply fixes with `npm run lint:fix` and/or `npm run format --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)

---

### 2. Client: Agents sidebar wiring for archive/restore + bulk actions

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Wire AgentsPage to pass the full set of conversation handlers so the shared ConversationList renders filters and archive/bulk controls. Ensure persistence-disabled states mirror Chat.

#### Documentation Locations

- MUI Box (layout + `sx`): https://llms.mui.com/material-ui/6.4.12/components/box.md
- MUI Stack (layout + spacing): https://llms.mui.com/material-ui/6.4.12/components/stack.md

#### Subtasks

1. [ ] Update AgentsPage conversation props:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Pass `onArchive`, `onRestore`, `onBulkArchive`, `onBulkRestore`, `onBulkDelete` from `useConversations`.
     - Keep `filterState` + `setFilterState` wired (same as Chat).
     - Disable conversation actions when persistence is unavailable (match Chat’s `disabled` rule).
     - Keep `variant` as-is unless required for styling; controls should appear via handler presence.

2. [ ] Run formatting/linting and resolve any failures:
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed, apply fixes with `npm run lint:fix` and/or `npm run format --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)

---

### 3. Client: Sidebar parity tests (ConversationList + Agents)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Extend existing conversation sidebar tests and add Agents-specific coverage to ensure filter tabs, bulk actions, and persistence-disabled states work in both Chat and Agents.

#### Documentation Locations

- Jest (client unit tests): Context7 `/jestjs/jest`
- Testing Library (React): Context7 `/testing-library/testing-library-docs`

#### Subtasks

1. [ ] Extend ConversationList tests:
   - Files to edit:
     - `client/src/test/chatSidebar.test.tsx`
   - Requirements:
     - Reuse existing bulk-selection and delete confirmation patterns.
     - Add any missing assertions needed for new control gating.

2. [ ] Add Agents sidebar parity tests:
   - Files to edit/add:
     - `client/src/test/agentsPage.sidebarActions.test.tsx` (new)
   - Requirements:
     - Assert filter tabs render on Agents and toggle filter state.
     - Assert row selection checkboxes render and can be toggled.
     - Assert bulk archive/restore buttons appear and enable when selections match the filter state.
     - Assert bulk delete appears only when the filter is Archived.
     - Assert per-row archive/restore icon buttons render based on the row’s `archived` flag.
     - Assert conversation filters/actions are disabled when persistence is unavailable.

3. [ ] Update persistence banner test if needed:
   - Files to edit:
     - `client/src/test/chatPersistenceBanner.test.tsx`
   - Requirements:
     - Ensure persistence-disabled behavior still disables conversation controls when mongo is down.

4. [ ] Run formatting/linting and resolve any failures:
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed, apply fixes with `npm run lint:fix` and/or `npm run format --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)

---

### 4. Client: Drawer paper overflow guard (Chat + Agents)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Update Drawer paper styling to prevent horizontal scrollbars and ensure the Drawer width does not exceed 320px in both Chat and Agents.

#### Documentation Locations

- MUI Drawer (paper sizing + overflow control): https://llms.mui.com/material-ui/6.4.12/components/drawers.md
- MUI Drawer API (slotProps vs PaperProps): https://llms.mui.com/material-ui/6.4.12/api/drawer.md

#### Subtasks

1. [ ] Apply Drawer paper overflow guard:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Apply `boxSizing: 'border-box'` and `overflowX: 'hidden'` to the Drawer paper using `slotProps.paper` (MUI 6.4.x supports both `slotProps.paper` and `PaperProps`).
     - Ensure the Drawer paper width never exceeds the 320px drawer width.

2. [ ] Run formatting/linting and resolve any failures:
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed, apply fixes with `npm run lint:fix` and/or `npm run format --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)

---

### 5. Client: List panel padding + vertical scroll behavior

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Align header/row padding to 12px and move vertical scrolling into the list panel, with “Load more” inside the bordered panel for both Chat and Agents.

#### Documentation Locations

- MUI Lists (List + ListItem padding): https://llms.mui.com/material-ui/6.4.12/components/lists.md
- MUI Stack (nowrap + `minWidth: 0` guidance): https://llms.mui.com/material-ui/6.4.12/components/stack.md
- MUI Box (layout + `sx`): https://llms.mui.com/material-ui/6.4.12/components/box.md

#### Subtasks

1. [ ] Adjust ConversationList padding + scroll container:
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
   - Requirements:
     - Apply consistent 12px left/right padding (`px: 1.5`) to the header/filter area and list rows.
     - Move the “Load more” row into the bordered list panel so it scrolls with the list.
     - Make the list panel the vertical scroll container (e.g., `overflowY: 'auto'` on the list wrapper) while keeping the header outside the scroll area.
     - Add `minWidth: 0` to any Stack/Box wrapping `Typography noWrap` to prevent horizontal overflow.

2. [ ] Run formatting/linting and resolve any failures:
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed, apply fixes with `npm run lint:fix` and/or `npm run format --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)

---

### 6. Client: Layout tests for scroll + overflow

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Extend layout tests to assert vertical scrolling in the list panel, “Load more” placement, and Drawer overflow guards without duplicating coverage unnecessarily.

#### Documentation Locations

- Jest (client unit tests): Context7 `/jestjs/jest`
- Testing Library (React): Context7 `/testing-library/testing-library-docs`

#### Subtasks

1. [ ] Update Chat layout tests:
   - Files to edit:
     - `client/src/test/chatPage.layoutWrap.test.tsx`
   - Requirements:
     - Assert the conversation list container uses vertical scrolling (`overflowY: 'auto'` or equivalent).
     - Assert the “Load more” button is rendered inside the bordered list panel.
     - Assert the Drawer paper uses `overflowX: hidden` (or equivalent) to prevent horizontal scroll.
     - Validate header and row padding use the same `px` value.

2. [ ] Add Agents layout test only if needed:
   - Files to edit/add:
     - `client/src/test/agentsPage.layoutWrap.test.tsx` (new, only if Chat tests can’t cover Agents-specific layout)

3. [ ] Run formatting/linting and resolve any failures:
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If needed, apply fixes with `npm run lint:fix` and/or `npm run format --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)

---

### 7. Final verification (acceptance criteria, clean builds, docs, PR summary)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Validate the story end-to-end: Agents and Chat sidebars match, scrolling/padding issues are resolved, and documentation is accurate. Produce a PR-ready summary of all changes.

#### Documentation Locations

- Docker/Compose:
  - Context7 `/docker/docs`
  - https://docs.docker.com/reference/cli/docker/compose/
- Playwright:
  - Context7 `/microsoft/playwright`
  - https://playwright.dev/docs/intro
- Husky:
  - Context7 `/typicode/husky`
  - https://typicode.github.io/husky
- Mermaid:
  - Context7 `/mermaid-js/mermaid`
  - https://mermaid.js.org/intro/syntax-reference.html
- Jest:
  - Context7 `/jestjs/jest`
  - https://jestjs.io/docs/getting-started
- Cucumber:
  - https://cucumber.io/docs/guides/
  - https://cucumber.io/docs/guides/10-minute-tutorial/
  - https://cucumber.io/docs/gherkin/reference/
- Markdown syntax (PR summary + docs edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Re-check Acceptance Criteria and confirm each bullet is demonstrably satisfied.

2. [ ] Build + test validation (clean):
   - `npm run build --workspace server`
   - `npm run build --workspace client`
   - `npm run test --workspace server`
   - `npm run test --workspace client`
   - `npm run e2e`
   - `npm run compose:build`
   - `npm run compose:up`
   - `npm run compose:down`

3. [ ] Manual Playwright-MCP verification:
   - Visit `/chat` and `/agents`.
   - Confirm filter tabs, per-row archive/restore, and bulk actions appear in both sidebars.
   - Confirm bulk delete only appears when Archived is selected.
   - Scroll the list panel to verify “Load more” is reachable and no horizontal scrollbar appears.
   - Save screenshots to `./test-results/screenshots/` named `0000023-3-<short-name>.png`.

4. [ ] Documentation updates:
   - `README.md` (user-facing behavior updates, if any)
   - `design.md` (layout/padding or flow notes, if any)
   - `projectStructure.md` (new/changed files)

5. [ ] Create a PR summary comment covering all story changes.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP verification + screenshots (see subtasks).
9. [ ] `npm run compose:down`

#### Implementation notes

- (fill in after implementation)
