# Mobile Home Page

## Deliverable

- Generate a polished mobile `Home` page design for the utility shell.
- Use [mobile-home-page.svg](/home/d_a_s/code/codeInfo2/planning/layout-ideas/plan/initial-layout/mobile-home-page.svg:1) as the structural source of truth.
- This is the mobile stacked version of the `Home` page, not a shrunk desktop dashboard.

## Intent

- Keep the same information architecture as the desktop `Home` page.
- Present it as a stacked mobile operational status screen.
- Fold `LM Studio` into `Home`.
- Move the current provider `Logon` action off `Chat` and into `Home`.

## Relationship To Desktop Home

This page is the mobile version of:

- `home-page.svg`
- `home-page.md`

It should use the same sections and same meaning, but arranged in one vertical scroll column.

## High-Level Layout

The page should stack vertically in this order:

1. compact top bar
2. short explanatory intro
3. versions card
4. quick actions card
5. provider logon-status section
6. LM Studio section

The page should feel like a mobile system-status or settings screen rather than a dashboard squeezed into a phone.

## Top Bar

Requirements:

- edge-flush top bar
- page title `Home`
- app menu trigger on the right
- no conversations trigger
- only a thin divider below the top bar

## Intro

- short explanatory text
- no giant hero section
- immediately tells the user this page is for global status and setup

Suggested direction:

- `Global system status, provider logon state, and LM Studio runtime details.`

## Versions Card

Requirements:

- show client version
- show server version
- if runtime configuration is broken, the error/banner should surface here or above it

## Quick Actions

Requirements:

- keep this compact
- should allow users to refresh or re-check global status

Examples:

- `Refresh`
- `LM status`
- `Provider auth`

## Provider Logon Status Section

This is the most important new mobile section.

Requirements:

- one stacked card per provider
- each card includes:
  - provider icon
  - provider name
  - current believed state
  - primary action button

Provider list:

- `OpenAI Codex`
- `GitHub Copilot`
- `LM Studio`

State examples:

- `Authentication required`
- `Available`
- `Unknown`
- `No login required`
- `Unavailable`

Action behavior:

- auth-based providers should show `Logon`
- `LM Studio` should show a runtime action such as `Check status`

Important:

- the device-auth action currently shown on `Chat` should move to this page
- users should be able to understand provider readiness without entering a workspace page
- use believed readiness/auth wording instead of overstating exact login truth when the current contract does not prove it

## LM Studio Section

Requirements:

- visible base URL
- `Check`
- `Reset`
- `Refresh models`
- connection summary
- stacked model list rows instead of a large desktop table

Suggested data:

- `Connected to http://127.0.0.1:1234 · 12 models`
- compact stacked rows for model information

## Desktop vs Mobile Behavior

Desktop:

- provider actions can use standard dialogs or popovers
- LM Studio content can use table-based layouts

Mobile:

- provider actions should open full-screen or near-full-screen dialogs where appropriate
- LM Studio controls may wrap into multiple rows
- model list should switch to stacked rows or compact cards
- avoid tiny desktop-style popovers

## Visual Style

- same family as the final mobile workspace shell
- bright light mode
- calm operational feel
- compact spacing
- stacked cards with modest rounding

## Suggested React Structure

- `MobileHomePage`
- `MobileHomeHeader`
- `VersionStatusCard`
- `HomeQuickActionsCard`
- `ProviderLogonSection`
- `ProviderStatusCard`
- `HomeLmStudioSection`
- reuse `useLmStudioStatus`
- reuse provider status data from shared provider-status logic
- open auth flows from this page rather than `Chat`

## Developer Watchouts

- mobile should not try to preserve the desktop three-card row layout
- provider cards must remain readable even when status text gets long
- `Logon` actions need to remain visually obvious without dominating the page
- `LM Studio` is a provider but not a normal auth provider, so do not force it into the same exact action model
- ensure the `Home` page stays useful even if one provider is unavailable and others are healthy

## Hard Constraints

- no conversations trigger on this page
- no transcript or conversation UI
- no separate top-level `LM Studio` destination once this page exists
- keep provider auth actions on `Home`, not `Chat`
- keep the page as a stacked operational status screen

## Avoid

- no shrunk desktop dashboard
- no giant hero
- no empty decorative space
- no conversation-first layout patterns
- no confusing split of auth actions between `Home` and `Chat`
