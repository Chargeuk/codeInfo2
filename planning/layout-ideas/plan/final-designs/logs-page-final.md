# Logs Page Final

## Purpose

This is the chosen desktop target for the `Logs` page.

Use it together with:

- `logs-page-final.png`

This page keeps the current logs workflow, but reformats it into the new utility-shell system and corrects the current left-side space imbalance.

## Visual Target

Match:

- `logs-page-final.png`

This image is the source of truth for the desktop `Logs` page layout and information hierarchy.

## Core Role Of The Page

`Logs` should let users:

- inspect current client and server log events
- filter by text, level, and source
- switch live mode on or off
- manually refresh results
- emit a sample log to verify end-to-end logging

This is a utility page, not a dashboard and not a transcript workspace.

## High-Level Layout

The page is split into these major regions:

1. slim left app rail
2. compact page intro/header
3. centered filter/action control surface
4. centered logs content surface

There is no conversation pane on this page.

## App Rail

Requirements:

- same left rail as the final shared shell
- same destinations:
  - `Home`
  - `Chat`
  - `Agents`
  - `Flows`
  - `Ingest`
  - `Logs`
- visually slim and consistent with the other utility pages

## Header / Intro

Requirements:

- compact page title
- short explanatory subtitle
- no hero treatment

Suggested meaning:

- `Logs`
- `Live feed of client and server events. Filter by level and source, refresh manually, or send a sample emitter log.`

## Centering Requirement

This is the most important layout correction from the current page.

Requirements:

- the main logs content should sit in a centered, balanced column inside the utility-shell content area
- do not leave a large empty gutter on the left side of the page body
- the filter/action surface and the logs surface should align with each other visually
- the table can still be wide, but the overall content block should feel centered and intentional

## Filters And Actions Surface

This should be one centered control card near the top of the page.

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
- do not add date filters, export, save views, or clear-all controls

## Logs Content Surface

Desktop keeps the current table behavior.

Required structure:

- inline area for loading, error, or empty states above the table
- accessible table surface
- columns:
  - `Time`
  - `Level`
  - `Source`
  - `Message`
  - `Context`

Required row content:

- formatted timestamp
- level chip using the current severity mapping
- source chip
- one visible message line
- context JSON rendered in a monospaced style when present

Important:

- keep the row content aligned to the current frontend contract:
  - one `message`
  - optional rendered context
- do not imply a second derived summary line unless that is intentionally added in the frontend using existing data
- do not add pagination controls

## Desktop Interaction Behavior

- keep the filter/action surface directly above the logs table
- keep the table on desktop rather than converting to cards
- preserve live-mode behavior from `useLogs`
- preserve manual refresh behavior from `refreshQuery`
- preserve current sample-log behavior

## Supported Current Features Only

This design should be implemented using the current page contract in:

- `client/src/pages/LogsPage.tsx`
- `client/src/hooks/useLogs.ts`

That means:

- keep current filters only
- keep current live toggle only
- keep current sample-log action only
- keep current desktop table only
- keep current timestamp and context rendering rules

Avoid implying unsupported additions such as:

- export actions
- date range filtering
- saved search views
- pagination
- separate auto-scroll controls

## Suggested React Structure

Suggested components:

- `LogsPage`
- `LogsPageHeader`
- `LogsFilterToolbar`
- `LogsStatusSurface`
- `LogsTable`
- reuse `LevelChip`
- reuse `useLogs`

## Developer Watchouts

- preserve the current `useLogs` contract and `refreshQuery` behavior
- preserve current SSE live mode vs manual refresh behavior
- preserve the current sample-log POST behavior
- preserve current timestamp formatting
- preserve current context JSON rendering
- center the content block within the utility shell instead of leaving the page visually offset
- avoid introducing a persistent live-status banner unless the frontend explicitly implements it from existing state

## Hard Constraints

- no new logging features
- no conversation UI patterns
- no pagination
- no export/share surfaces
- no date filters
- no giant empty left-side gutter
- desktop stays table-based

## Acceptance Summary

The desktop `Logs` implementation is correct when:

- the page keeps the existing logs feature set
- the main content feels centered and balanced
- the filter/action controls remain visible and compact
- the table remains the main desktop presentation
- the page feels consistent with the redesigned `Home` and `Ingest` utility pages
