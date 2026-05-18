# Mobile Ingest Page Final

## Purpose

This is the chosen mobile target for the `Ingest` page.

Use it together with:

- `mobile-ingest-page-final.png`

This page preserves the same ingest workflow as desktop, but reformats it into a narrow-screen operational layout.

## Visual Target

Match:

- `mobile-ingest-page-final.png`

This image is the source of truth for the mobile `Ingest` page layout and interaction hierarchy.

## Core Role Of The Page

The mobile `Ingest` page should let users:

- start a new ingest
- monitor the active ingest run
- manage embedded roots
- inspect a root in a focused mobile details surface

It should feel like a clean operational status page, not a squeezed desktop table.

## High-Level Layout

The mobile page is split into these major regions:

1. edge-flush top bar
2. short intro text
3. compact alert lane
4. stacked operational cards
5. stacked embedded-root cards

There is no conversations trigger on this page.

## Top Bar

Requirements:

- full-width top bar touching the sides of the mobile frame
- page title: `Ingest`
- app menu trigger on the right
- simple divider line below

## Intro And Alert Lane

The top of the page should explain the purpose briefly, then allow compact notice stacking.

Alert lane support:

- model/root load errors
- websocket state
- terminal ingest errors
- AST skipped or failed notices

Important:

- keep it compact
- do not show unsupported detail actions in alert rows

## Start A New Ingest Card

Preserve the same current ingest form behavior as desktop, but stack fields for narrow width.

Required controls:

- `Refresh models`
- model-lock notice using the current wording pattern:
  - `Embedding model locked to ...`
- `Folder path`
- `Choose folder…`
- `Display name`
- `Embedding model`
- `Dry run`
- `Start ingest`

Notes:

- `Description (optional)` may be included when space allows, but the mobile visual target prioritizes the higher-frequency controls
- do not add new fields
- keep the form finger-friendly and compact

## Active Ingest Card

This card should expose the same current ingest information as desktop, but in a compressed vertical arrangement.

Required content:

- section title: `Active Ingest`
- real current ingest state chip
- current file
- file index / total
- percent
- ETA
- counts summary
- AST summary
- message text
- `Cancel ingest`
- `View logs`
- run ID

Status wording rule:

- use current supported ingest states
- examples:
  - `queued`
  - `scanning`
  - `embedding`
  - `completed`
  - `cancelled`
  - `error`
  - `skipped`
  - `cleanup-blocked`

## Embedded Folders Section

On mobile, replace the dense desktop table with stacked root cards.

### Section Header

Include:

- `Embedded Folders`
- `Refresh`
- selected count
- `Re-embed selected`
- `Remove selected`

### Root Cards

Each root card should include:

- selection state
- root name
- full path
- embedding provider/model
- status chip or short status label
- compact counts summary
- row actions:
  - `Re-embed`
  - `Remove`
  - `Details`
- inline error text when present

Important:

- keep actions visible
- do not require a hidden overflow menu for basic row actions
- preserve queue position, error state, and completion state

## Mobile Details Behavior

Desktop uses a right-side details drawer. Mobile should adapt that into a near-fullscreen sheet or full-screen dialog.

Required content stays the same:

- root name
- root status
- description
- path
- embedding model
- lock summary
- last ingest
- request ID
- run ID
- queue state / queue position
- counts
- AST counts
- last error
- include defaults
- exclude defaults

Important:

- this should feel focused and readable on mobile
- do not keep the narrow desktop drawer behavior on phones

## Mobile Interaction Behavior

- stack all sections vertically
- avoid horizontal scrolling
- keep root actions finger-friendly
- allow long paths and model names to truncate cleanly
- preserve the same page-specific actions as desktop

## Suggested React Structure

Suggested components:

- `MobileIngestPage`
- `MobileIngestHeader`
- `IngestBannerStack`
- `MobileIngestStartCard`
- `MobileActiveIngestCard`
- `MobileEmbeddedRootsSection`
- `MobileEmbeddedRootCard`
- `MobileRootDetailsSheet`

Suggested reused logic:

- reuse the same ingest hooks as desktop
- reuse the same API routes and row action handlers
- adapt the desktop details drawer data source into a mobile sheet view

## Developer Watchouts

- preserve the current supported ingest workflow
- avoid a horizontally scrollable table on phones
- keep lock wording aligned with the real app contract
- do not imply an `admin` source for lock state
- keep bulk actions visible
- keep row actions reachable even when root names and paths are long
- preserve queue position, error context, and AST counts

## Hard Constraints

- no conversation UI patterns
- no transcript surface
- no backend-dependent new features
- no squeezed desktop table
- no hidden bulk actions
- no unsupported ingest-state labels

## Acceptance Summary

The mobile `Ingest` implementation is correct when:

- the existing ingest workflow works without horizontal scrolling
- the form, active ingest view, and roots management all remain on the page
- embedded roots are presented as stacked cards rather than a desktop table
- details open in a focused mobile surface
- the page feels consistent with the mobile `Home` page and utility-shell direction
