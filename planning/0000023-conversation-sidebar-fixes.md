# Story 0000023 - Conversation sidebar fixes

## Implementation Plan Instructions

This story follows `planning/plan_format.md`. Tasks are intentionally **omitted** for now while we align on scope and requirements.

---

## Description

Today, the Conversations sidebar on Chat and Agents has several UX and layout issues. The Agents sidebar lacks the same filters and archive/delete controls that exist on Chat, the content is cramped against the left edge, a horizontal scrollbar is always visible, and when the list grows it doesn’t provide a usable way to access older conversations. These issues make the sidebar feel inconsistent and hard to use.

We want the Chat and Agents sidebars to behave identically, with consistent padding, the same filter and archive/restore/delete capabilities, and a clean layout that never shows a horizontal scrollbar. The sidebar should also support viewing older items using the existing list paging controls so users can navigate beyond the initial viewport.

---

## Acceptance Criteria

- **Feature parity:** The Agents Conversations sidebar provides the same controls and behavior as Chat: filter tabs (Active / Active & Archived / Archived), per-row Archive/Restore buttons, bulk Archive/Restore actions, and Bulk Delete **only** when the filter is set to Archived.
- **Delete rule consistency:** Agent-scoped conversations follow the same rule as Chat: delete is only available when viewing Archived conversations.
- **Padding/spacing:** Conversation rows and the sidebar container have enough left/right padding so text and controls are not flush against the drawer edge; the visual spacing should match Chat’s current sidebar spacing.
- **No horizontal scroll:** The sidebar never shows a left/right scrollbar at any viewport size (desktop or mobile).
- **Access to older items:** When conversations exceed the available vertical space, the list scrolls vertically and users can reach the “Load more” control to fetch older items.
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
- Specify that **padding values should match Chat** once Agents is aligned (to avoid inventing new spacing).

## Known Unknowns / Risks

- **Horizontal scrollbar root cause:** Likely caused by child width + padding (e.g., `noWrap` text inside a flex row without `minWidth: 0`) or by fixed-width wrappers inside the Drawer. This needs a quick visual check or DOM inspection once we implement changes.
- **Vertical scroll location:** Because the list container uses `overflow: hidden` and the Drawer paper height is fixed, we need to confirm where vertical scrolling should live (Drawer paper vs list container) to guarantee the “Load more” control stays reachable.
- **DeepWiki:** The repo is not indexed on DeepWiki yet, so we cannot rely on DeepWiki references for this story.

## Tasks

Tasks are intentionally omitted until the description, acceptance criteria, and scope are confirmed to be final.
