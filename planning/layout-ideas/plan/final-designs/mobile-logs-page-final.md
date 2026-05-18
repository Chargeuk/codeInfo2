# Mobile Logs Page Final

## Purpose

This is the chosen mobile target for the `Logs` page.

Use it together with:

- `mobile-logs-page-final.png`

This page preserves the same logs workflow as desktop, but adapts it to the mobile utility-shell pattern.

## Visual Target

Match:

- `mobile-logs-page-final.png`

This image is the source of truth for the mobile `Logs` page layout and interaction hierarchy.

## Core Role Of The Page

The mobile `Logs` page should let users:

- inspect recent logs
- filter by text, level, and source
- enable or disable live mode
- refresh manually
- emit a sample log

It should feel like a practical mobile utility page, not a squeezed desktop table.

## High-Level Layout

The mobile page is split into these major regions:

1. edge-flush top bar
2. short intro text
3. stacked filters/actions card
4. inline status surface
5. stacked log cards

There is no conversations trigger on this page.

## Top Bar

Requirements:

- full-width top bar touching the mobile frame edges
- title: `Logs`
- app menu trigger on the right
- simple divider line below

## Intro Text

Requirements:

- compact explanatory copy
- no hero block

Suggested meaning:

- `Live feed of client and server events. Filter by level and source, refresh manually, or send a sample emitter log.`

## Filters And Actions Card

This card should preserve the current controls and stack them for narrow screens.

Required controls:

- `Search text`
- level chips:
  - `ERROR`
  - `WARN`
  - `INFO`
  - `DEBUG`
- source chips:
  - `server`
  - `client`
  - `client-flows`
- `Live` toggle
- `Refresh now`
- `Send sample log`

Important:

- preserve these controls only
- do not add date filters, export, saved views, or clear-all controls
- keep the controls tap-friendly and compact

## Inline Status Surface

The current loading, error, and empty states should appear inline above the log cards.

Requirements:

- support loading
- support error
- support empty state
- do not turn these into separate pages or full-screen states

Developer note:

- avoid implying a separate persistent live-status banner unless the frontend intentionally adds it from existing client-side state

## Log Cards

Mobile should keep the current card-list approach from the existing page.

Each card should include:

- level chip
- source chip
- formatted timestamp
- one visible message line
- rendered context JSON when present

Important:

- keep cards compact
- preserve context visibility
- keep content aligned with the current contract:
  - one `message`
  - optional rendered context
- do not imply a second derived subtitle line unless the frontend intentionally derives it from existing data

## Mobile Interaction Behavior

- stack controls cleanly
- allow filter chips to wrap
- keep the page scrollable and readable
- preserve the current mobile-card behavior instead of forcing a desktop table
- preserve current live toggle and manual refresh behavior

## Supported Current Features Only

This design should be implemented using the current page contract in:

- `client/src/pages/LogsPage.tsx`
- `client/src/hooks/useLogs.ts`

That means:

- current filters only
- current live toggle only
- current sample-log action only
- mobile cards rather than a new custom log viewer
- current timestamp and context rendering rules

## Suggested React Structure

Suggested components:

- `MobileLogsPage`
- `MobileLogsHeader`
- `LogsFilterCard`
- `LogsStatusSurface`
- `LogsCardList`
- reuse `LevelChip`
- reuse `useLogs`

## Developer Watchouts

- preserve current `useLogs` live SSE behavior
- preserve current sample-log POST behavior
- preserve current timestamp formatting
- preserve current context JSON rendering
- keep mobile cards rather than forcing the desktop table onto phones
- keep all current filters visible

## Hard Constraints

- no new logging features
- no conversation UI
- no desktop table on mobile
- no export/share surfaces
- no date filters
- no hidden current actions

## Acceptance Summary

The mobile `Logs` implementation is correct when:

- the page keeps the current logs feature set
- the controls remain visible and usable on a narrow screen
- the cards remain the primary mobile presentation
- the page feels consistent with the redesigned mobile `Home` and other utility pages
