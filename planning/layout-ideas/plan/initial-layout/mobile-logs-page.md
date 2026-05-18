# Mobile Logs Page

## Deliverable

- Generate a polished mobile `Logs` page for the utility shell.
- Use [mobile-logs-page.svg](/home/d_a_s/code/codeInfo2/planning/layout-ideas/plan/initial-layout/mobile-logs-page.svg:1) as the structural source of truth.
- Preserve the current logs functionality exactly. This redesign should adapt the existing page to small screens, not introduce new features.

## Intent

- Keep the current `Logs` feature set.
- Make the page feel consistent with the mobile `Home` and other utility pages.
- Preserve the current mobile direction of using log cards instead of the desktop table.
- Keep all existing filters and actions visible and usable on a narrow screen.

## Real App Context

Current implementation locations:

- `client/src/pages/LogsPage.tsx`
- `client/src/hooks/useLogs.ts`

The design must preserve:

- page header
- text search
- level filter chips
- source filter chips
- `Live` toggle
- `Refresh now`
- `Send sample log`
- inline loading/error/empty states
- mobile log cards

Do not add new logging capabilities.

## High-Level Layout

The mobile page should follow the same utility-page pattern as `mobile-home-page`:

1. edge-flush top bar
2. short intro text
3. stacked filters/actions card
4. inline status surface
5. stacked log cards

No conversations trigger should appear on this page.

## Top Bar

Requirements:

- full-width top bar touching the mobile frame edges
- title: `Logs`
- app menu trigger on the right
- divider line below

## Intro Text

Requirements:

- compact explanatory copy
- no hero block

Suggested meaning:

- `Live feed of client and server events with filters, manual refresh, and a sample emitter.`

## Filters And Actions Card

This card should keep the current controls, stacked for mobile.

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
- do not add date filters, export, saved views, or clear-all actions unless they already exist
- keep the controls tap-friendly and compact

## Inline Status Surface

The current loading/error/empty states should appear inline above the log cards.

Requirements:

- support loading
- support error
- support empty state
- do not convert these into separate pages or full-screen takeovers

## Log Cards

Mobile should keep the current card/list approach.

Each card should include:

- level chip
- source chip
- formatted timestamp
- message text
- rendered context JSON when present

Important:

- keep the cards compact
- preserve context visibility
- do not hide context behind extra interactions unless absolutely necessary
- keep the card content aligned to the current contract of one visible `message` plus optional rendered context
- do not imply a second derived summary line unless the frontend is intentionally deriving it from existing fields

## Mobile Behavior

- stack the filter/action controls cleanly
- allow chip rows to wrap
- keep the list scrollable and readable
- preserve live refresh behavior and manual refresh behavior

## Visual Style

- match the mobile utility-shell direction
- bright light mode
- soft neutral cards
- compact operational spacing
- no decorative dashboard feel

## Suggested React Structure

- `MobileLogsPage`
- `MobileLogsHeader`
- `LogsFilterCard`
- `LogsStatusSurface`
- `LogsCardList`
- reuse `LevelChip`
- reuse `useLogs`

## Developer Watchouts

- preserve the current `useLogs` live SSE behavior
- preserve the current sample-log POST behavior
- preserve the current context JSON rendering
- keep mobile cards instead of forcing the desktop table onto phones
- keep all current filters visible
- do not imply a separate live-status banner or an `auto-scroll` indicator unless the frontend explicitly adds that using existing client-side state only

## Hard Constraints

- no new logging features
- no conversation UI
- no desktop table on mobile
- no hidden current actions
- no export/share surfaces

## Avoid

- no fake analytics widgets
- no oversize hero treatment
- no stripped-down design that removes the existing filters
