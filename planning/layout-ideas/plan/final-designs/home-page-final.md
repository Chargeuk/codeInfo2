# Home Page Final

## Purpose

This is the chosen desktop target for the `Home` page.

It should be used together with:

- `desktop-workspace-shell-final.png`

The `Home` page is no longer just a version placeholder. It becomes the global system-status page for the app.

## Visual Target

Match:

- `home-page-final.png`

This image is the source of truth for the desktop `Home` page layout and information hierarchy.

## Core Role Of The Page

`Home` should be the place where users check:

- app version and runtime status
- provider readiness and authentication state
- global setup actions
- LM Studio runtime status and available models

This page should also absorb the current top-level `LM Studio` page content.

## High-Level Layout

The page is split into these major regions:

1. slim left app rail
2. compact page intro/header
3. top summary row
4. provider status section
5. LM Studio section

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
- visually slim and consistent with workspace pages

## Header / Intro

Requirements:

- compact page title
- short explanatory subtitle
- no hero layout

Suggested meaning:

- `Home`
- `Global system status, provider logon state, and LM Studio runtime details.`

## Top Summary Row

The first row should summarize global app state.

Recommended cards:

### Versions Card

Show:

- client version
- server version

If runtime configuration is broken:

- show a visible banner or error state here or above the card

### Provider Status Summary Card

Show short believed state summaries for:

- `Codex`
- `Copilot`
- `LM Studio`

Important wording rule:

- use believed readiness/auth wording
- avoid overstating exact login truth if the current contract does not prove it

Recommended state examples:

- `Authentication required`
- `Available`
- `No login required`
- `Unavailable`
- `Unknown`

### Quick Actions Card

Show app-wide setup and refresh actions such as:

- `Refresh`
- `LM status`
- `Provider auth`

These actions should affect global status, not a single transcript workspace.

## Provider Status Section

This is the most important new section.

Each provider row should include:

- provider icon
- provider name
- believed current readiness/auth state
- action button

Provider rows:

- `OpenAI Codex`
- `GitHub Copilot`
- `LM Studio`

Recommended action behavior:

- auth-based providers show `Logon`
- LM Studio shows `Check status`

Important:

- the current visible `Logon` action should move off `Chat` and onto this page
- this page becomes the visible home for provider-auth actions

## Provider State Wording

Use wording like:

- `Authentication required`
- `Available`
- `No login required`
- `Unavailable`
- `Unknown`

Avoid wording like:

- `Logged in`
- `Logged out`

unless the current contract explicitly proves that exact state.

## LM Studio Section

This section replaces the need for a separate top-level `LM Studio` page.

Required controls:

- base URL input
- `Check`
- `Reset`
- `Refresh models`

Required status content:

- current connected or error summary
- current effective base URL
- model list table

Suggested model table columns:

- `Name`
- `Key`
- `Type / Format`
- `Architecture`
- `Size`

Implementation note:

- this section should feel like part of `Home`, not a mini-page embedded inside it

## Desktop Interaction Behavior

- provider actions can open dialogs or other attached surfaces depending on the auth flow
- the existing shared auth dialog can be reused from `Home`
- LM Studio controls stay inline on the page
- model data should use a table on desktop

## Suggested React Structure

Suggested components:

- `HomePage`
- `HomePageHeader`
- `VersionStatusCard`
- `ProviderStatusOverviewCard`
- `HomeQuickActionsCard`
- `ProviderStatusSection`
- `ProviderStatusRow`
- `HomeLmStudioSection`

Suggested reused logic:

- reuse version fetch logic from the current `HomePage`
- reuse provider status data from shared provider-status logic based on `useChatModel` behavior or an extracted hook
- reuse `useLmStudioStatus`
- reuse or relocate `CodexDeviceAuthDialog`

## Developer Watchouts

- avoid duplicating provider-status fetching separately on `Home` and `Chat`
- `Home` should be the source of visible auth CTA placement
- `Chat` should stop carrying global auth chrome once this page exists
- LM Studio is a provider-like system dependency but not a normal auth provider
- one provider can be unhealthy while others are healthy; the page must handle mixed state cleanly
- runtime-config API-base-url issues should still surface on `Home`

## Hard Constraints

- no conversation UI patterns here
- no transcript surface
- no conversation pane
- no separate top-level `LM Studio` destination after this page exists
- keep the page compact and status-oriented
- keep state wording aligned with believed readiness/auth, not stronger claims than the code supports

## Acceptance Summary

The desktop `Home` implementation is correct when:

- it clearly matches `home-page-final.png`
- it feels like a system-status landing page
- provider actions live here instead of on `Chat`
- LM Studio is folded into `Home`
- the page uses compact operational cards and sections rather than a hero layout
