# Logs Page

## Deliverable

- Generate a polished desktop `Logs` page for the utility shell.
- Use [logs-page.svg](/home/d_a_s/code/codeInfo2/planning/layout-ideas/plan/initial-layout/logs-page.svg:1) as the structural source of truth.
- Preserve the current logs functionality exactly. This redesign should fix layout and responsiveness, not add new logging features.

## Intent

- Keep the current `Logs` feature set because it is already useful.
- Correct the current visual imbalance where the page feels offset and wastes too much space on the left.
- Center the usable logs surface within the utility-shell content area.
- Keep the page consistent with the new `Home` and `Ingest` utility pages.

## Real App Context

Current implementation locations:

- `client/src/pages/LogsPage.tsx`
- `client/src/hooks/useLogs.ts`

The design must preserve the current functional areas:

- page header
- text search
- level filter chips
- source filter chips
- `Live` toggle
- `Refresh now`
- `Send sample log`
- error/loading/empty states
- desktop logs table
- mobile card list

Do not add features beyond what is already implemented.

## High-Level Layout

The desktop page should use the same utility-shell language as `Home` and `Ingest`:

1. slim left app rail
2. compact page header
3. centered filter/action control surface
4. centered logs content surface

Important layout correction:

- the logs page content should sit in a centered, balanced column inside the available page space
- do not leave a large empty gutter on the left side of the main content area
- the table can still be wide, but the content block itself should feel deliberately placed

## App Rail

- use the same left rail as the final utility-shell pages
- destinations:
  - `Home`
  - `Chat`
  - `Agents`
  - `Flows`
  - `Ingest`
  - `Logs`
- no conversation pane on this page

## Header / Intro Area

Requirements:

- compact page title
- short explanatory subtitle
- no hero section

Suggested meaning:

- `Logs`
- `Live feed of client and server events with filters, manual refresh, and a sample emitter to verify end-to-end logging.`

## Filter And Actions Surface

This should be one centered control region near the top of the page.

Required controls:

- `Search text` field
- level filter chips for:
  - `ERROR`
  - `WARN`
  - `INFO`
  - `DEBUG`
- source filter chips for:
  - `server`
  - `client`
  - `client-flows`
- `Live` toggle
- `Refresh now`
- `Send sample log`

Important:

- preserve the current controls only
- do not add date range filters, export buttons, save views, or other new logging tools
- keep the controls compact and centered rather than spread awkwardly across the whole page

## Logs Content Surface

The main content surface should also be centered and balanced.

Desktop keeps the current table behavior:

- accessible table with `Logs table` label
- columns:
  - `Time`
  - `Level`
  - `Source`
  - `Message`
  - `Context`

Required row content:

- formatted timestamp
- level chip with current severity mapping
- source chip
- message text
- rendered JSON-like context block

Important:

- keep each row aligned to the current frontend contract of one visible `message` plus optional rendered context
- do not imply a second summary line or a distinct derived subtitle unless the frontend is intentionally deriving that from existing fields

State handling that must remain:

- inline loading state
- inline error alert
- inline empty state

Important:

- keep the table readable but efficient
- avoid turning it into oversized cards on desktop
- do not add pagination or batching controls because the current page does not have them

## Desktop Behavior

- use a centered content column within the utility-shell page body
- keep the filter/action surface directly above the logs table
- preserve the current table presentation on larger screens
- keep status states inline above the table surface

## Visual Style

- match the new utility-shell direction
- bright light mode
- soft neutral surfaces
- restrained chip colors
- compact operational spacing
- no decorative dashboard elements

## Suggested React Structure

- `LogsPage`
- `LogsPageHeader`
- `LogsFilterToolbar`
- `LogsStatusSurface`
- `LogsTable`
- reuse `LevelChip`
- reuse `useLogs`

## Developer Watchouts

- preserve the current `useLogs` contract and `refreshQuery` behavior
- preserve the current SSE live mode vs manual refresh behavior
- preserve the current `Send sample log` POST behavior
- do not add filters or actions not already supported
- keep the content centered and balanced in the new shell
- preserve the current timestamp formatting and context JSON rendering
- do not imply a separate live-status banner or an `auto-scroll` feature unless the frontend explicitly adds that behavior using existing state only

## Hard Constraints

- no new logging features
- no conversation-style UI
- no giant empty left-side gutter
- no pagination controls
- no export/share actions
- no redesign that hides current filters or current actions

## Avoid

- no dashboard widgets unrelated to logs
- no giant header hero
- no stretched, awkwardly left-biased page body
- no mobile-card treatment on desktop
