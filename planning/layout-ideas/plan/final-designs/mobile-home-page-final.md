# Mobile Home Page Final

## Purpose

This is the chosen mobile target for the `Home` page.

It should be used together with:

- `mobile-workspace-shell-main-final.png`

The mobile `Home` page keeps the same meaning as desktop `Home`, but presents it as a stacked status screen rather than a dashboard grid.

## Visual Target

Match:

- `mobile-home-page-final.png`

This image is the source of truth for the mobile `Home` page layout and interaction hierarchy.

## Core Role Of The Page

`Home` should be the mobile place where users check:

- app version and runtime status
- provider readiness and authentication state
- global setup actions
- LM Studio runtime status and available models

It also replaces the need to visit a separate mobile `LM Studio` page.

## High-Level Layout

The mobile page should stack vertically in this order:

1. compact edge-flush top bar
2. short intro text
3. versions card
4. quick actions card
5. stacked provider status cards
6. stacked LM Studio section

This page should feel like a mobile control center or settings/status screen, not like a shrunk desktop dashboard.

## Top Bar

Requirements:

- edge-flush top bar
- page title `Home`
- app menu trigger on the right
- no conversations trigger
- only a thin divider below the top bar

## Intro

Requirements:

- short explanatory text
- no giant hero block
- immediately communicates that this page is for global setup and readiness

## Versions Card

Show:

- client version
- server version

If runtime configuration is broken:

- show an error banner or visible error state here or above this card

## Quick Actions Card

Show a compact set of global actions such as:

- `Refresh`
- `LM status`
- `Provider auth`

The quick actions card should remain compact and should not dominate the page.

## Provider Status Section

This is the most important mobile section.

Use one stacked card per provider.

Each card includes:

- provider icon
- provider name
- believed readiness/auth state
- primary action button

Provider cards:

- `OpenAI Codex`
- `GitHub Copilot`
- `LM Studio`

Recommended state examples:

- `Authentication required`
- `Available`
- `No login required`
- `Unavailable`
- `Unknown`

Recommended action behavior:

- auth-based providers show `Logon`
- LM Studio shows `Check status`

Important:

- the visible `Logon` action should move off `Chat` and onto these cards
- users should be able to understand provider readiness without entering a workspace page

## Provider State Wording

Use believed readiness/auth wording.

Avoid wording like:

- `Logged in`
- `Logged out`

unless the current contract explicitly proves exact login truth.

## LM Studio Section

This section folds the current LM Studio functionality into `Home`.

Required controls:

- base URL
- `Check`
- `Reset`
- `Refresh models`

Required status content:

- connection summary
- model list

Mobile model list behavior:

- do not use a large desktop-style table
- use stacked rows or compact cards instead

## Mobile Interaction Behavior

- no conversations trigger on this page
- provider actions should open full-screen or near-full-screen dialogs where appropriate
- LM Studio controls may wrap into multiple rows
- model list should remain stacked and scrollable
- avoid tiny desktop-style popovers

## Suggested React Structure

Suggested components:

- `MobileHomePage`
- `MobileHomeHeader`
- `VersionStatusCard`
- `HomeQuickActionsCard`
- `ProviderStatusSection`
- `ProviderStatusCard`
- `HomeLmStudioSection`

Suggested reused logic:

- reuse version fetch logic from the current `HomePage`
- reuse provider status data from shared provider-status logic based on `useChatModel` behavior or an extracted hook
- reuse `useLmStudioStatus`
- reuse or relocate `CodexDeviceAuthDialog`

## Developer Watchouts

- do not preserve the desktop three-card row layout on mobile
- provider cards must stay readable when state text becomes longer
- `Logon` actions should stay obvious without dominating the card
- LM Studio should not be forced into the same action model as auth providers
- the page must still read clearly when one provider is unavailable and others are healthy
- keep auth actions on `Home`, not split between `Home` and `Chat`

## Hard Constraints

- no transcript UI
- no conversation trigger
- no separate top-level `LM Studio` destination after this page exists
- keep the page as a stacked operational status screen
- keep state wording aligned with believed readiness/auth, not stronger claims than the code supports

## Acceptance Summary

The mobile `Home` implementation is correct when:

- it clearly matches `mobile-home-page-final.png`
- it feels like a stacked mobile system-status screen
- provider actions live here instead of on `Chat`
- LM Studio is folded into `Home`
- the page remains compact, readable, and operational rather than decorative
