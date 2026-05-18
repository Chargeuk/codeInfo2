# Ingest Page

## Deliverable

- Generate a polished desktop `Ingest` page for the utility shell.
- Use [ingest-page.svg](ingest-page.svg) as the structural source of truth.
- Preserve the current system behavior and data shape. This redesign should reorganize and restyle the page, not invent new ingest functionality.

## Intent

- Keep the current ingest workflow because it is already functionally strong.
- Reformat it so it feels consistent with the new `Home` and utility-shell pages.
- Make the page efficient on wide screens without looking like a dense legacy admin table.
- Preserve a clear path from starting a new ingest, to monitoring the active run, to reviewing and managing embedded roots.

## Real App Context

Current implementation locations:

- `client/src/pages/IngestPage.tsx`
- `client/src/components/ingest/IngestForm.tsx`
- `client/src/components/ingest/ActiveRunCard.tsx`
- `client/src/components/ingest/RootsTable.tsx`
- `client/src/components/ingest/RootDetailsDrawer.tsx`
- `client/src/hooks/useIngestModels.ts`
- `client/src/hooks/useIngestRoots.ts`
- `client/src/hooks/useIngestStatus.ts`

The design should preserve the current page structure:

- top-level ingest and model/root loading alerts
- model-lock notice
- `Start a new ingest` form
- active ingest card when a run is in progress
- embedded roots table with refresh, selection, bulk actions, row actions, and inline messages
- right-side details drawer for a selected root

## High-Level Layout

The desktop page should use the same utility-shell language as the new `Home` page:

1. slim left app rail
2. compact page header with title and short subtitle
3. slim alert/banner lane under the header
4. two-column operational row
5. full-width embedded-roots management section
6. contextual root-details drawer from the right

This page should feel operational and information-dense, but still calm and modern.

## App Rail

- use the same left rail as the final shell designs
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
- short descriptive subtitle
- no large hero section
- no persistent page-level action row here unless a future feature requires it

Suggested copy direction:

- `Ingest`
- `Start new ingests, monitor active progress, and manage embedded roots in a responsive utility-shell layout.`

## Alert And Banner Lane

The narrow banner lane under the header exists because the real page can show several transient notices.

It should support:

- model-loading errors
- roots-loading errors
- terminal ingest errors
- realtime websocket connecting or unavailable state
- AST skipped-file info
- AST failed-file warning

Behavior:

- stack multiple alerts vertically when needed
- keep them visually compact
- do not consume more vertical space than necessary when no alerts are present
- do not imply a backend-provided structured `View details` surface unless the frontend is only revealing already available text

## Start A New Ingest Card

This card should preserve the current `IngestForm` functionality.

Required visible controls:

- section title: `Start a New Ingest`
- `Refresh models` action
- model-lock notice using the current wording pattern: `Embedding model locked to ...`
- `Folder path` field
- `Choose folder…` action
- `Display name` field
- `Description (optional)` multiline field
- `Embedding model` selector
- `Dry run` toggle
- `Start ingest` primary action
- inline submit error when the current API returns one

Important constraints:

- do not add new ingest form fields
- do not add file uploads
- do not add new advanced settings not already represented in the current form
- keep the model-lock notice visible when lock data exists

## Active Ingest Card

This card should stay visible when `useIngestStatus` reports a non-terminal run.

Required content:

- section title: `Active Ingest`
- status chip using the existing ingest states
- current file
- file index / total
- percent complete
- ETA
- metrics:
  - files
  - chunks
  - embedded
  - skipped
- AST metrics:
  - supported
  - skipped
  - failed
  - last indexed time
- message text when present
- terminal or transient error text when present
- `Cancel ingest` action when allowed
- `View logs for this run` action
- run ID

Status wording:

- use the real current ingest states from the existing app contract:
  - `queued`
  - `scanning`
  - `embedding`
  - `completed`
  - `cancelled`
  - `error`
  - `skipped`
  - `cleanup-blocked`
- do not replace these with new backend-dependent states

Layout intent:

- keep it visually parallel to the start form
- make it easy to scan from left to right
- avoid making it look like a marketing progress card

## Embedded Folders Section

This is the main management area and should remain full-width.

Header requirements:

- title: `Embedded Folders`
- model-lock chip when present using existing lock wording rather than `admin` language
- `Refresh` action

Bulk-selection row requirements:

- selected count
- `Re-embed selected`
- `Remove selected`
- inline bulk result message

Table requirements:

- preserve the dense tabular format on desktop
- do not add table pagination controls such as `Rows per page` because the current table is not paginated
- columns should cover the real current data:
  - selection checkbox
  - name
  - path
  - embedding
  - status
  - last ingest
  - counts
  - actions

Row requirements:

- checkbox selection
- root name
- full path
- provider/model embedding display
- status chip with queue or phase-aware text
- last ingest timestamp
- counts block containing:
  - files
  - chunks
  - embedded
  - AST supported
  - AST skipped
  - AST failed
- row actions:
  - `Re-embed`
  - `Remove`
  - `Details`
- optional inline last-error text
- optional inline row-action result text

Important:

- keep the table list-like and efficient, not card-like
- preserve status distinctions such as queued position and cleanup-blocked
- do not remove bulk actions

## Root Details Drawer

The right-side details view should stay contextual, not become a separate page.

Required content:

- root name
- root status chip
- description
- path
- model
- model lock
- last ingest
- request ID if present
- run ID
- queue state / queue position
- counts
- AST counts
- last error when present
- include extensions list
- exclude patterns list

Behavior:

- open from the row-level `Details` action
- stay visually attached to the right side of the page
- feel like an inspection panel, not a modal takeover

## Desktop Behavior

- use the wide two-column arrangement for the top operational row
- keep the embedded-roots section full-width below it
- keep the details view as a right drawer
- preserve dense table scanning on larger screens
- keep actions inline and easy to reach without scrolling away from the table context

## Visual Style

- match the new utility-shell pages
- bright light mode
- soft neutral surfaces
- restrained accent colors
- compact spacing
- operational, not decorative

## Suggested React Structure

- `IngestPage`
- `IngestHeader`
- `IngestBannerStack`
- `IngestStartCard`
- `ActiveIngestCard`
- `EmbeddedRootsSection`
- `EmbeddedRootsToolbar`
- `EmbeddedRootsTable`
- `RootDetailsDrawer`

Reuse the current hooks and contracts rather than creating a parallel ingest state model.

## Developer Watchouts

- do not invent new ingest actions that the backend does not support
- preserve the model-lock behavior and wording because it is part of the current ingest contract
- preserve the websocket state and terminal error surfacing
- keep queue position and queue-state visibility in the roots area
- do not imply an admin-managed lock source unless that information actually exists in the current contract
- avoid making the top cards so tall that the roots table gets pushed too far below the fold
- keep the details panel contextual and non-destructive

## Hard Constraints

- preserve existing ingest features and actions
- preserve the full roots-management workflow
- keep the page consistent with the new `Home` and utility-shell designs
- do not introduce conversation-style UI patterns
- do not hide important ingest state behind extra navigation

## Avoid

- no giant dashboard hero
- no fake analytics widgets unrelated to ingest
- no removal of bulk actions
- no replacement of the desktop table with oversized desktop cards
- no new backend-dependent features
