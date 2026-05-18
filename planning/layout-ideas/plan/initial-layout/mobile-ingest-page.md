# Mobile Ingest Page

## Deliverable

- Generate a polished mobile `Ingest` page design for the utility shell.
- Use [mobile-ingest-page.svg](mobile-ingest-page.svg) as the structural source of truth.
- Preserve the current ingest features while making the page genuinely usable on a narrow screen.

## Intent

- Keep the current ingest workflow intact on mobile.
- Reformat the desktop page into a vertical operational screen rather than a squeezed desktop layout.
- Preserve the same actions and core data while changing the arrangement:
  - form stays a form
  - active ingest stays a status card
  - roots table becomes stacked root cards
  - details drawer becomes a near-fullscreen details surface

## Real App Context

Current implementation locations:

- `client/src/pages/IngestPage.tsx`
- `client/src/components/ingest/IngestForm.tsx`
- `client/src/components/ingest/ActiveRunCard.tsx`
- `client/src/components/ingest/RootsTable.tsx`
- `client/src/components/ingest/RootDetailsDrawer.tsx`

The mobile design must preserve the same functional areas:

- alerts and realtime state
- `Start a new ingest`
- active ingest progress
- embedded roots selection and actions
- root details view

## High-Level Layout

The mobile page should follow the same mobile utility-page pattern as `mobile-home-page`:

1. edge-flush top bar
2. short intro copy
3. compact alert lane
4. stacked operational cards
5. stacked embedded-root cards

No conversations button should appear here.

## Top Bar

Requirements:

- full-width top bar touching the top and side edges of the page frame
- page title: `Ingest`
- app menu trigger on the right
- only a divider line between the top bar and the page body

## Alert Lane

Mobile still needs to surface the same transient states as desktop:

- model/root load errors
- terminal ingest errors
- websocket connecting or unavailable state
- AST skipped or failed banners

Requirements:

- alerts stack vertically when needed
- the default empty state should consume very little height
- avoid promising a dedicated backend-supported `View details` action for alert rows

## Start A New Ingest Card

Preserve the same current form controls, but stack them more aggressively.

Required visible controls:

- section title
- `Refresh models`
- model-lock notice using the current wording pattern: `Embedding model locked to ...`
- `Folder path`
- `Choose folder…`
- `Display name`
- `Embedding model`
- `Dry run`
- `Start ingest`

Design intent:

- do not try to keep desktop field pairs side-by-side unless they clearly fit
- prioritize tap comfort and scannability
- keep the card dense enough that it does not dominate the page

## Active Ingest Card

This card should keep the same information as desktop, but compressed into short stacked lines.

Required content:

- section title
- status chip
- current file
- file index / total
- percent complete
- ETA
- counts summary
- AST summary
- message text
- `Cancel ingest`
- `View logs`
- run ID

Status wording:

- use the current real ingest states instead of inventing new ones
- examples:
  - `queued`
  - `scanning`
  - `embedding`
  - `completed`
  - `cancelled`
  - `error`
  - `skipped`
  - `cleanup-blocked`

Important:

- preserve the action model
- do not hide logs or cancel behind an overflow menu

## Embedded Folders Section

On mobile, the dense desktop table should become stacked root cards.

Section header requirements:

- title: `Embedded Folders`
- `Refresh`
- selected count
- `Re-embed selected`
- `Remove selected`

Each root card should include:

- selection state
- root name
- full path
- embedding provider/model
- status text or status chip
- counts summary
- row actions:
  - `Re-embed`
  - `Remove`
  - `Details`
- optional short error or row-action message if needed

Important:

- keep the row actions visible on the card
- do not collapse them into a hidden menu unless the screen is too narrow even after truncation
- preserve queue position and error context where present

## Root Details Surface

The existing desktop details drawer should adapt on mobile into a near-fullscreen sheet or full-screen dialog.

Required content stays the same:

- name
- status
- description
- path
- model
- model lock
- last ingest
- request ID
- run ID
- queue state / queue position
- counts
- AST counts
- last error
- include extensions
- exclude patterns

Behavior:

- open from the `Details` action on a root card
- take most of the screen height
- feel like a focused inspect view, not a tiny popover

## Mobile Behavior

- stack all main sections vertically
- avoid desktop-style two-column regions
- keep actions finger-friendly
- allow model, path, and root names to truncate gracefully
- preserve the full existing workflow without requiring horizontal scrolling

## Visual Style

- match the mobile `Home` page and utility-shell direction
- bright light mode
- compact operational cards
- calm neutral surfaces
- no decorative hero treatment

## Suggested React Structure

- `MobileIngestPage`
- `MobileIngestHeader`
- `IngestBannerStack`
- `MobileIngestStartCard`
- `MobileActiveIngestCard`
- `MobileEmbeddedRootsSection`
- `MobileEmbeddedRootCard`
- `MobileRootDetailsSheet`

These can still reuse the same underlying hooks and API contracts as desktop.

## Developer Watchouts

- do not remove existing desktop functionality on mobile
- avoid creating a horizontal-scroll table on phones
- preserve model-lock visibility
- preserve selection and bulk actions
- ensure row-level actions remain reachable even with long names and paths
- details should not remain a narrow side drawer on phones
- do not imply admin-controlled lock metadata when the current app only exposes the lock itself

## Hard Constraints

- keep the same ingest features as the current app
- keep the same page-specific actions as desktop
- no new backend-dependent features
- no conversation-shell behaviors
- no giant cards that waste vertical space

## Avoid

- no squeezed desktop table
- no hidden bulk actions
- no decorative statistics unrelated to ingest
- no removal of logs or cancel actions
- no floating desktop popovers on mobile
