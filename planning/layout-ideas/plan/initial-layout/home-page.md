# Home Page

## Deliverable

- Generate a polished `Home` page design for the utility shell.
- Use [home-page.svg](home-page.svg) as the structural source of truth.
- This should become the real purpose of the `Home` page, not just a version placeholder.

## Intent

- Turn `Home` into the app-wide system and status page.
- Fold the current `LM Studio` page into `Home` as one section.
- Move the current provider `Logon` action off `Chat` and onto `Home`.
- Make `Home` the place users go to understand global readiness before entering `Chat`, `Agents`, or `Flows`.

## Real App Context

Current implementation locations:

- `HomePage.tsx` currently only shows version info.
- `LmStudioPage.tsx` currently shows LM Studio status, base URL controls, and the model list.
- provider status data currently comes from `useChatModel.ts` and `/chat/providers`.
- the current device-auth dialog lives in `CodexDeviceAuthDialog.tsx` and is triggered from `ChatPage.tsx`.

This design assumes those concerns are moved together into `Home`.

## High-Level Layout

The page should keep the utility-shell structure:

1. slim left app rail
2. compact page intro/header area
3. top summary cards
4. provider logon-status section
5. LM Studio section

This page should feel like a purposeful system dashboard, not a placeholder landing page.

## App Rail

- use the same left rail as the final shell designs
- same destinations:
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
- no oversized hero treatment

Suggested copy direction:

- `Home`
- `Global system status, provider logon state, and LM Studio runtime details.`

## Top Summary Cards

The first row should summarize the most important global state.

Suggested cards:

### Versions

- client version
- server version
- if runtime config is broken, a banner or visible error state should appear here or above it

### Provider Status Summary

- short status summary for `Codex`, `Copilot`, and `LM Studio`
- use believed readiness/auth wording that matches current system signals more closely
- example visible states:
  - `Codex: Authentication required`
  - `Copilot: Available`
  - `LM Studio: No login required`

### Quick Actions

- app-wide refresh and setup actions
- examples:
  - refresh provider state
  - check LM Studio status
  - refresh model list

## Provider Logon Status Section

This is the most important new section.

Requirements:

- show one row or card per provider
- each provider row includes:
  - provider icon
  - provider name
  - current believed logon/readiness state
  - action button

Provider list:

- `OpenAI Codex`
- `GitHub Copilot`
- `LM Studio`

Status examples:

- `Authentication required`
- `Available`
- `Unknown`
- `No login required`
- `Unavailable`

Action behavior:

- for auth-based providers, show the `Logon` action here instead of on `Chat`
- for LM Studio, show a more appropriate action such as `Check status` rather than pretending it uses the same auth flow

Important:

- the current device-auth button behavior from `Chat` should move to this page
- the page should present believed state clearly even if it may sometimes be stale or uncertain
- avoid over-claiming exact login truth unless the current provider contract explicitly proves it

## LM Studio Section

This section replaces the need for a separate top-level `LM Studio` page.

Requirements:

- LM Studio base URL control
- `Check status`
- `Reset`
- `Refresh models`
- visible status text
- visible active base URL
- model list table or stacked list

Suggested visible data:

- `Connected to http://127.0.0.1:1234 · 12 models`
- model rows with:
  - display name
  - model key
  - type / format
  - architecture
  - size

Implementation note:

- this section should be visually part of `Home`, not a mini-page embedded inside it

## Desktop Behavior

- provider row actions can open standard dialogs or popovers depending on the flow
- the device-auth flow can still use a dialog
- the LM Studio controls stay inline on the page
- the model list should render as a table on larger screens

## Mobile Behavior

- no conversations trigger on this page
- sections stack vertically
- provider status may become individual cards rather than rows
- LM Studio controls may stack into multiple rows
- model list may switch from table to stacked cards
- auth flows and logon flows should open as full-screen or near-fullscreen dialogs where appropriate

## Visual Style

- match the final utility-shell direction
- bright light mode
- calm operational feel
- compact but readable
- more useful than decorative

## Suggested React Structure

- `HomePage`
- `HomeSummaryCards`
- `VersionStatusCard`
- `ProviderStatusOverviewCard`
- `HomeQuickActionsCard`
- `ProviderLogonSection`
- `ProviderStatusRow`
- `HomeLmStudioSection`
- reuse `useLmStudioStatus`
- reuse provider data from `useChatModel` or extract a shared provider-status hook
- move or reuse `CodexDeviceAuthDialog` from this page

## Developer Watchouts

- avoid duplicating provider-status logic separately on `Home` and `Chat`
- `Home` should become the source of the visible logon CTA, and `Chat` should stop carrying that global auth chrome
- LM Studio is a provider but not a normal auth provider; its action model is different
- provider status can be believed state, not guaranteed truth, so wording should avoid overstating certainty
- ensure the page still works if one provider is unavailable while others are healthy
- runtime-config API-base-url issues should still surface clearly on `Home`

## Hard Constraints

- keep `Home` compact and status-oriented
- remove the need for a top-level `LM Studio` nav item
- move the current `Logon` CTA off the `Chat` page
- keep the left rail consistent with the final shell designs
- do not introduce conversation-style UI here

## Avoid

- no giant marketing hero
- no decorative empty space
- no conversation transcript patterns
- no duplicated `LM Studio` top-level destination after this page exists
- no provider auth controls split confusingly between `Home` and `Chat`
