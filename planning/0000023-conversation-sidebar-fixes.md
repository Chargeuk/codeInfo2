# Story 0000023 - Conversation sidebar fixes

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

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

### 1. Client: Agents sidebar feature parity (filters + archive/restore + bulk actions)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Enable full ConversationList controls in Agents so it matches Chat: filter tabs, per-row archive/restore buttons, and bulk archive/restore/delete actions (delete only on Archived filter).

This task is limited to wiring existing client hooks/components. It does not change server APIs or persistence rules.

#### Documentation Locations

- MUI Drawer + ToggleButtonGroup + List + IconButton: MUI MCP `@mui/material@6.4.12`
- React Testing Library queries/events: Context7 `/testing-library/react-testing-library`
- Jest DOM assertions: Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Review existing Chat vs Agents sidebar wiring:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`

2. [ ] Enable full sidebar controls in Agents:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Pass `archive`, `restore`, `bulkArchive`, `bulkRestore`, and `bulkDelete` from `useConversations` into `ConversationList`.
     - Remove the `variant="agents"` override so the component renders the same controls as Chat (default `chat` variant).
     - Keep `mongoConnected` and `filterState` behavior consistent with Chat.
     - Ensure the `disabled` prop matches Chat’s persistence rules (`persistenceUnavailable || persistenceLoading`).
   - Must-not-miss details:
     - Bulk Delete should remain visible **only** when `filterState === 'archived'` (handled by the component; ensure `onBulkDelete` is provided).

3. [ ] Add/update Agents sidebar tests:
   - Files to edit/add:
     - Prefer adding `client/src/test/agentsPage.sidebarControls.test.tsx`.
   - Requirements:
     - Mock `/conversations` to return at least one archived + one active conversation.
     - Assert filter tabs render (Active, Active & Archived, Archived).
     - Assert bulk actions render and the Delete button appears only when the filter is Archived.
     - Assert per-row archive/restore icon buttons render (use existing `data-testid` hooks).

4. [ ] Documentation update (task-local):
   - Files to edit:
     - `planning/0000023-conversation-sidebar-fixes.md` (this file)
   - Requirements:
     - Fill in this task’s Implementation notes as you implement.
     - Record the commit hash(es) in this task’s Git Commits.

5. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 2. Client: Align sidebar header/filter padding with row padding

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Align left/right padding across the sidebar header, filter tabs, and conversation rows so content lines up at **12px** (MUI spacing 1.5). This removes the “cramped against the edge” appearance.

#### Documentation Locations

- MUI Stack + Box + ToggleButtonGroup + List: MUI MCP `@mui/material@6.4.12`
- MUI spacing system: MUI MCP `@mui/material@6.4.12`
- Playwright element bounds: Context7 `/microsoft/playwright`

#### Subtasks

1. [ ] Review current sidebar spacing and padding usage:
   - Files to read:
     - `client/src/components/chat/ConversationList.tsx`

2. [ ] Update header/filter padding:
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
   - Requirements:
     - Apply `px: 1.5` to the header/filters container so it matches row padding.
     - Ensure bulk action bar uses the same left/right padding as rows.
     - Add a stable test id to the header container (e.g., `data-testid="conversation-header"`) to support layout assertions.

3. [ ] Add/update alignment checks in e2e:
   - Files to edit:
     - `e2e/chat.spec.ts`
   - Requirements:
     - Add a test (or extend an existing drawer layout test) that compares the left X position of the header container to the left X position of the first row (`conversation-row`).
     - Accept a small tolerance (1–2px) for layout rounding.

4. [ ] Documentation update (task-local):
   - Files to edit:
     - `planning/0000023-conversation-sidebar-fixes.md` (this file)
   - Requirements:
     - Fill in this task’s Implementation notes as you implement.
     - Record the commit hash(es) in this task’s Git Commits.

5. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 3. Client: Remove horizontal scrollbar in Drawer + list content

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Eliminate the horizontal scrollbar in the sidebar by fixing overflow at the correct container and ensuring row content can shrink (especially when titles use `noWrap`).

#### Documentation Locations

- MUI Drawer + Stack + ListItemText: MUI MCP `@mui/material@6.4.12`
- CSS overflow + min-width behavior: https://developer.mozilla.org/en-US/docs/Web/CSS/overflow
- Playwright DOM metrics: Context7 `/microsoft/playwright`

#### Subtasks

1. [ ] Inspect current overflow sources:
   - Files to read:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`

2. [ ] Update layout to prevent horizontal overflow:
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Add `minWidth: 0` to the row container(s) that wrap `noWrap` text (e.g., the Stack inside `ListItemText`).
     - Ensure the Drawer paper and inner container use `boxSizing: 'border-box'`.
     - If overflow persists after width fixes, apply `overflowX: 'hidden'` at the Drawer paper or list container level (prefer fixing the cause first).
     - Keep visual behavior identical between Chat and Agents.

3. [ ] Add an e2e horizontal overflow assertion:
   - Files to edit:
     - `e2e/chat.spec.ts`
   - Requirements:
     - Mock `/conversations` to return at least one long-titled conversation.
     - Assert `scrollWidth <= clientWidth` for the drawer paper and list panel (`data-testid="conversation-list"`).

4. [ ] Documentation update (task-local):
   - Files to edit:
     - `planning/0000023-conversation-sidebar-fixes.md` (this file)
   - Requirements:
     - Fill in this task’s Implementation notes as you implement.
     - Record the commit hash(es) in this task’s Git Commits.

5. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 4. Client: Make list panel vertically scrollable and ensure “Load more” reachability

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Move vertical scrolling into the bordered list panel so long conversation lists can be navigated without scrolling the entire page, and the “Load more” control is reachable at the bottom of the panel.

#### Documentation Locations

- MUI Box + List layout: MUI MCP `@mui/material@6.4.12`
- CSS overflow + flexbox min-height: https://developer.mozilla.org/en-US/docs/Web/CSS/overflow
- Playwright scrolling helpers: Context7 `/microsoft/playwright`

#### Subtasks

1. [ ] Review list container structure:
   - Files to read:
     - `client/src/components/chat/ConversationList.tsx`

2. [ ] Add a dedicated scroll container:
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
   - Requirements:
     - Wrap the list + divider + “Load more” row in a container with `flex: 1`, `minHeight: 0`, and `overflowY: 'auto'`.
     - Keep the header and bulk action bar outside the scroll container so they remain visible.
     - Add a stable test id for the scroll container (e.g., `data-testid="conversation-scroll"`).

3. [ ] Add an e2e scroll reachability check:
   - Files to edit:
     - `e2e/chat.spec.ts`
   - Requirements:
     - Mock `/conversations` with enough items to require scrolling.
     - Assert that the “Load more” button becomes visible after scrolling the list panel.

4. [ ] Documentation update (task-local):
   - Files to edit:
     - `planning/0000023-conversation-sidebar-fixes.md` (this file)
   - Requirements:
     - Fill in this task’s Implementation notes as you implement.
     - Record the commit hash(es) in this task’s Git Commits.

5. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill in after implementation)

---

### 5. Final verification: acceptance criteria, full test/build matrix, docs, PR comment

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Run the full validation checklist, confirm every acceptance criterion, update documentation, and produce a PR-ready summary comment.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Confirm the acceptance criteria explicitly (write down results in Implementation notes):
   - Agents sidebar has filters + archive/restore + bulk actions.
   - Delete is visible only when filter is Archived.
   - Header + row padding aligned at 12px.
   - No horizontal scrollbar in drawer/list at any viewport size.
   - List panel scrolls vertically and “Load more” is reachable.

2. [ ] Ensure docs are up to date:
   - Files to edit:
     - `README.md` (only if behavior/commands changed)
     - `design.md` (update sidebar layout notes if needed)
     - `projectStructure.md` (add/remove files created/deleted in this story)

3. [ ] Documentation update (task-local):
   - Files to edit:
     - `planning/0000023-conversation-sidebar-fixes.md` (this file)
   - Requirements:
     - Ensure Implementation notes summarize all UI/layout changes and test updates.
     - Record the commit hash(es) in this task’s Git Commits.

4. [ ] Run repo lint/format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

5. [ ] Create a PR summary comment:
   - Mention Agents/Chat sidebar parity, padding alignment, overflow fixes, scroll behavior, and test updates.

#### Testing

1. [ ] Build the server: `npm run build --workspace server`
2. [ ] Build the client: `npm run build --workspace client`
3. [ ] Run server tests: `npm run test --workspace server`
4. [ ] Run client tests: `npm run test --workspace client`
5. [ ] Perform a clean docker build: `npm run compose:build`
6. [ ] Start docker compose: `npm run compose:up`
7. [ ] Run e2e tests: `npm run e2e`
8. [ ] Manual verification:
   - Verify Chat sidebar shows filters/bulk actions and aligns padding.
   - Verify Agents sidebar shows the same controls and delete-only-on-archived behavior.
   - Confirm no horizontal scrollbar on desktop or mobile widths.
   - Scroll the list panel and confirm “Load more” appears at the bottom.
9. [ ] Shut down compose: `npm run compose:down`

#### Implementation notes

- (fill in after implementation)
