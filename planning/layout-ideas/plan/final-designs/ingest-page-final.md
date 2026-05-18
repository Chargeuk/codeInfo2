# Ingest Page Final

## Purpose

This is the chosen desktop target for the `Ingest` page.

Use it together with:

- `ingest-page-final.png`

This page keeps the existing ingest workflow, but reformats it into the new utility-shell system used by the rest of the redesign.

## Visual Target

Match:

- `ingest-page-final.png`

This image is the source of truth for the desktop `Ingest` page layout and information hierarchy.

## Core Role Of The Page

`Ingest` should let users:

- start a new ingest
- monitor the current active ingest run
- inspect current lock and realtime status
- manage embedded roots
- open contextual root details

This is an operational page, not a dashboard and not a workspace transcript page.

## High-Level Layout

The page is split into these major regions:

1. slim left app rail
2. compact page intro/header
3. slim alert/banner lane
4. two-column operational row
5. full-width embedded-roots section
6. contextual right-side details drawer

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
- visually slim and consistent with the other desktop pages

## Header / Intro

Requirements:

- compact page title
- short explanatory subtitle
- no hero treatment

Suggested meaning:

- `Ingest`
- `Start ingests, monitor progress, and manage embedded roots.`

## Alert Lane

This is a compact lane for current page notices.

It should support:

- ingest model-loading errors
- roots-loading errors
- terminal ingest errors
- websocket connecting or unavailable state
- AST skipped-file info
- AST failed-file warning

Important:

- keep this area thin when empty
- stack multiple alerts compactly when needed
- do not show backend-dependent detail actions that do not exist today

## Start A New Ingest Card

This card should preserve the current form behavior from the existing ingest implementation.

Required controls:

- `Refresh models`
- model-lock notice using the current wording pattern:
  - `Embedding model locked to ...`
- `Folder path`
- `Choose folder…`
- `Display name`
- `Description (optional)`
- `Embedding model`
- `Dry run`
- `Start ingest`
- inline submit error when the current API returns one

Important:

- do not add new form fields
- do not add file-upload behaviors
- keep the lock notice visible when lock data exists

## Active Ingest Card

This card should stay visible whenever an ingest run is active.

Required content:

- section title: `Active Ingest`
- real current ingest state chip
- current file
- file index / total
- percent
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
  - last indexed
- message text when present
- current error text when present
- `Cancel ingest`
- `View logs`
- run ID

Status wording rule:

- use the current supported ingest states
- examples:
  - `queued`
  - `scanning`
  - `embedding`
  - `completed`
  - `cancelled`
  - `error`
  - `skipped`
  - `cleanup-blocked`

Do not introduce new backend-dependent state names here.

## Embedded Folders Section

This is the main management surface on desktop and should remain full width.

### Header

Include:

- `Embedded Folders`
- lock chip when present
- `Refresh`

### Bulk Toolbar

Include:

- selected count
- `Re-embed selected`
- `Remove selected`
- inline bulk result message

### Table

Keep the desktop table dense and scan-friendly.

Required columns:

- selection
- name
- path
- embedding
- status
- last ingest
- counts
- actions

Required row content:

- checkbox selection
- root name
- full path
- provider/model embedding display using current supported ingest providers
- status chip or status label
- last ingest timestamp
- counts block with:
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
- inline last-error text when present
- inline row-action message when present

Important:

- do not add pagination controls or rows-per-page controls
- keep the table list-like, not card-like
- preserve queue position and queue-state distinctions

## Root Details Drawer

The right-side details drawer should stay contextual and attached to the page edge.

Required content:

- root name
- root status chip
- description
- path
- embedding model
- lock summary
- last ingest
- request ID when present
- run ID
- queue state / queue position
- counts
- AST counts
- last error when present
- include defaults
- exclude defaults

Important:

- this is an inspection surface, not a separate page
- keep it contextual and non-destructive

## Desktop Interaction Behavior

- use a two-column top row for the form and active-run card
- keep the roots section full-width underneath
- open root details from the row-level `Details` action
- keep bulk actions always visible
- keep row actions inline rather than hidden behind menus

## Suggested React Structure

Suggested components:

- `IngestPage`
- `IngestPageHeader`
- `IngestBannerStack`
- `IngestStartCard`
- `ActiveIngestCard`
- `EmbeddedRootsSection`
- `EmbeddedRootsToolbar`
- `EmbeddedRootsTable`
- `RootDetailsDrawer`

Suggested reused logic:

- reuse `useIngestModels`
- reuse `useIngestRoots`
- reuse `useIngestStatus`
- reuse existing `IngestForm`
- reuse existing row actions and current API routes

## Developer Watchouts

- preserve existing supported ingest actions only
- keep lock wording aligned with the current code contract
- do not imply an `admin` source for lock state
- do not add pagination unless product scope changes later
- preserve websocket and terminal-error visibility
- preserve queue position and cleanup-blocked visibility
- keep the roots section as the dominant management surface

## Hard Constraints

- no conversation UI patterns here
- no transcript surface
- no conversation pane
- no backend-dependent new features
- no fake analytics widgets
- no pagination controls in the table footer
- no unsupported ingest-state labels

## Acceptance Summary

The desktop `Ingest` implementation is correct when:

- the existing ingest form is preserved in the new utility-shell layout
- active ingest state is visible without leaving the page
- the roots table still supports refresh, selection, bulk actions, row actions, and status visibility
- the details drawer still exposes the current root metadata
- the page feels consistent with the redesigned `Home` and other utility pages
