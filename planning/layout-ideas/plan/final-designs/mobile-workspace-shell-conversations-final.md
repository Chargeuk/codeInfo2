# Mobile Workspace Conversations Final

## Purpose

This is the chosen mobile target for the full-screen conversations view used by:

- `Chat`
- `Agents`
- `Flows`

Use it together with:

- `mobile-workspace-shell-conversations-final.png`

This view is the mobile full-screen counterpart to the finalized desktop conversation pane.

## Visual Target

Match:

- `mobile-workspace-shell-conversations-final.png`

This image is the source of truth for layout and interaction hierarchy.

Important:

- the implementation should follow the intended palette rules in this Markdown even if the generated image reads slightly lighter than desired
- the layout and information model from the image are accepted
- the color palette should be aligned more closely to the desktop conversation pane

## Core Role Of The View

This surface should let users:

- open the conversation list from `Chat`, `Agents`, or `Flows`
- switch conversations in a dedicated full-screen mobile surface
- use the same conversation metadata model as desktop
- return to the active workspace after selecting a conversation

This is not a separate inbox product and not a generic mobile list page.

## High-Level Layout

The screen is split into these major regions:

1. edge-flush top bar
2. short explanatory text
3. compact controls row
4. full-screen conversation list

This panel slides in from the left and behaves as temporary navigation.

## Top Bar

Requirements:

- full-width top bar touching the mobile frame edges
- title: `Conversations`
- back affordance on the right
- simple divider line below

## Controls Row

This row must mirror the desktop conversation-pane controls.

Required controls:

- `Active`
- `Archived`
- `Refresh`

Behavior:

- `Active` and `Archived` are independent toggles
- enabling both shows both sets
- search is intentionally not present yet

## Conversation Rows

Each row should use the same information model as the desktop conversation pane.

Required content:

- provider icon
- title
- model name
- `REST` or `MCP` chip
- last updated time
- row-level `Archive` action
- compact secondary preview text

Provider rules:

- provider icons must represent model/runtime providers such as `Codex`, `Copilot`, and `LM Studio`
- do not use git or source-control branding

Example row types:

- active `Codex` / `gpt-5` conversation
- active `Copilot` / `gpt-4.1` conversation
- active `LM Studio` / `qwen-coder-14b` conversation
- archived conversation visible when `Archived` is enabled

## Mobile Interaction Behavior

- this panel slides in from the left
- selecting a conversation closes the panel and returns to the active workspace
- non-workspace pages should not expose this view
- row actions should remain visible without extra overflow menus

## Intended Color Palette

This section is important and should override any ambiguity in the PNG.

The mobile conversations view should inherit the desktop conversation-pane color family.

Use these target colors and relationships:

- overall page/background:
  - `#F4F6F8`
- top bar:
  - `#DCE7F2`
- divider and border system:
  - `#D9E2EC`
- main conversation list container:
  - `#EEF2F6`
- non-active conversation row surfaces:
  - `#EEF2F6`
  - these should not read as bright white floating cards
- active conversation row emphasis:
  - `#E8F1FB`
  - subtle pale cool-blue tint only
- active toggle background:
  - `#20354A`
- primary dark text:
  - `#1F2933`
- secondary text:
  - `#52606D`

Palette rules:

- the whole screen should feel flatter, cooler, and calmer than a typical bright-white mobile inbox
- row borders should be soft and low-contrast
- avoid a strong white-card-on-white-page look
- the result should feel like the desktop conversation sidebar expanded to full-screen mobile

## Visual Style

- modern light-mode utility/workspace navigation surface
- compact, list-like, touch-friendly
- understated and premium
- closer to a calm sidebar than to a colorful chat inbox

## Suggested React Structure

Suggested components:

- `MobileWorkspaceConversationsView`
- `MobileWorkspaceConversationsHeader`
- `MobileWorkspaceConversationFilters`
- `MobileWorkspaceConversationList`
- `MobileWorkspaceConversationRow`

Suggested shared logic:

- reuse the same conversation metadata model as the desktop conversation pane
- reuse the same provider icon mapping
- reuse the same `Active` / `Archived` filter behavior
- reuse the same refresh behavior

## Developer Watchouts

- do not introduce search yet
- do not change the information model from desktop
- keep rows compact and list-like
- preserve `REST` / `MCP` transport chips
- keep the archive action visible
- follow the palette values in this document more strictly than the rendered PNG if they ever conflict

## Hard Constraints

- only for `Chat`, `Agents`, and `Flows`
- no search
- include `Active`, `Archived`, `Refresh`
- use the desktop conversation-pane metadata model
- no mobile-only alternate conversation schema
- no oversized white floating cards

## Acceptance Summary

The mobile conversations implementation is correct when:

- it matches the final image structurally
- it behaves like a left-slide full-screen mobile version of the desktop conversation pane
- it uses the same row metadata model as desktop
- it uses the cooler desktop-derived palette described above
