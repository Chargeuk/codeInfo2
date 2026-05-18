# Mobile App Menu Final

## Purpose

This is the chosen mobile target for the full-screen app navigation menu.

Use it together with:

- `mobile-app-menu-final.png`

This view is the mobile counterpart to the finalized desktop app rail.

## Visual Target

Match:

- `mobile-app-menu-final.png`

This image is the source of truth for the mobile app-menu layout and interaction hierarchy.

## Core Role Of The View

This surface should let users:

- navigate between top-level pages
- leave the current page without exposing a cramped drawer
- use the same destination set as the desktop rail

This is not a settings page and not an account/profile menu.

## High-Level Layout

The mobile app menu is split into these regions:

1. edge-flush top bar
2. short explanatory text
3. full-screen destination list

It should appear as a temporary full-screen layer that slides in from the right.

## Top Bar

Requirements:

- full-width top bar touching the mobile frame edges
- title: `Menu`
- close/back affordance on the right
- simple divider line below

## Destination List

The list must match the finalized desktop app rail exactly.

Required destinations:

- `Home`
- `Chat`
- `Agents`
- `Flows`
- `Ingest`
- `Logs`

Each destination row should include:

- small icon
- destination name
- concise secondary description

Recommended meanings:

- `Home`
  - system status and provider readiness
- `Chat`
  - direct provider/model conversations
- `Agents`
  - named agents, commands, and steps
- `Flows`
  - multi-step workflow conversations
- `Ingest`
  - repository ingest and embedding operations
- `Logs`
  - live operational logs and diagnostics

## Interaction Behavior

- this view slides in from the right
- tapping a destination navigates to that page and dismisses the panel
- it should be available from both workspace and utility pages
- it should behave like temporary navigation, not like a persistent sidebar

## Supported Current Scope

This design should only represent app-level navigation that already exists in the redesigned shell structure.

Important:

- keep the destination set aligned to the desktop rail
- do not add extra profile/settings areas
- do not add account-specific features here

## Suggested React Structure

Suggested components:

- `MobileAppMenu`
- `MobileAppMenuHeader`
- `MobileAppMenuList`
- `MobileAppMenuRow`

Suggested shared logic:

- reuse the same destination config used by the desktop app rail
- keep labels, order, and active-state logic consistent with desktop

## Developer Watchouts

- do not let this turn into a general settings sheet
- keep the destination list identical to the desktop rail
- avoid adding account/profile sections not present in the final navigation model
- keep the layout full-screen rather than partial-width
- keep the active destination subtle and consistent with the rest of the design system

## Hard Constraints

- destination set must exactly match the finalized desktop app rail
- no `Account`
- no `Profile`
- no `Settings`
- no conversation-specific controls
- no partial-width drawer treatment

## Acceptance Summary

The mobile app-menu implementation is correct when:

- it matches `mobile-app-menu-final.png`
- it reads as the mobile full-screen counterpart to the desktop app rail
- it contains exactly the same top-level destinations as desktop
- it feels like temporary navigation rather than a settings surface
