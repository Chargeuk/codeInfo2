# Mobile Workspace Shell Main Final

## Purpose

This is the chosen mobile target for the shared `Common` workspace used by:

- `Chat`
- `Agents`
- `Flows`

The goal is to keep the active workspace as the main screen, maximize transcript space, and avoid stuffing desktop controls into mobile chrome.

## Visual Target

Match:

- `mobile-workspace-shell-main-final.png`

This image is the source of truth for layout direction and interaction hierarchy.

## High-Level Layout

The mobile view is split into three vertical regions:

1. a thin edge-flush top bar
2. a continuous transcript surface
3. a bottom composer near the safe-area edge

The transcript is the main mobile surface.

## Top Bar

Requirements:

- flush to the top and side edges
- separated from the transcript by only a thin divider
- left control opens the conversations view
- right control opens the application menu
- no floating card treatment

Implementation notes:

- the left control should read clearly as a conversations trigger
- the right control should read clearly as a menu trigger
- keep the bar visually light and compact

## Transcript Surface

Requirements:

- no rounded outer transcript container
- assistant outputs span the full available mobile transcript width
- assistant slices touch or nearly touch vertically
- user replies remain right-aligned dark bubbles
- the whole area feels dense and efficient rather than decorative

Critical rule:

- assistant outputs must not look like inset panels or oversized cards

## Assistant Output

Requirements:

- full-width document-style slice
- light cool-gray background
- no title bar
- no top-left icon
- no top-right metadata
- content should read like plain answer text, not named sections

Content style:

- may begin with slightly stronger text
- must still feel like body content
- should preserve meaningful detail from the desktop concept

Do not render visible prefixes like:

- `Layout approach:`
- `Shell patterns confirmed:`
- `Recommended direction`

## Assistant Footer

Footer layout is required.

Left side order:

- `Info` button
- response time
- status chip

Right side order:

- completion date or relative time
- `Copy`

Rules:

- no provider or model in the visible footer
- no extra controls in this footer

## Assistant Status Chip

Supported target labels:

- `Working`
- `Complete`
- `Failed`
- `Stopped`

Status presentation:

- `Working` uses a spinner/progress icon
- `Complete` uses a check-circle icon
- `Failed` uses an error icon
- `Stopped` uses an hourglass icon

Do not use:

- `Ready`
- generic colored-dot chips

## Assistant Info Popup

Requirements:

- opened from the assistant footer `Info` button
- visually attached to that button
- compact enough for mobile
- should not overpower the transcript visually

Popup content:

- `Provider`
- `Model`
- `Tokens in`
- `Tokens out`
- `Cached`
- `Total`

Implementation notes:

- use a compact anchored popover or a tightly attached mini-panel
- it should feel like attached detail, not a separate floating card

## User Bubble

Requirements:

- dark charcoal or black bubble
- right-aligned
- no title bar
- no top-right metadata

Footer layout:

- acknowledgement tick
- completion date or relative time
- `Copy`

Tick meaning:

- grey tick means not yet acknowledged by the server
- blue tick means acknowledged by the server

## Composer

Requirements:

- wide white composer near the bottom edge
- almost full safe width
- one rounded surface

For the `Common` view, show only:

- working path on the left
- circular send button with up-arrow on the right

Do not show:

- model picker
- runtime picker
- tools
- agent options
- flow options
- file upload
- paperclip

## Suggested React Structure

Suggested components:

- `MobileWorkspaceHeader`
- `WorkspaceTranscript`
- `AssistantMessageSection`
- `UserMessageBubble`
- `AssistantInfoPopover` or compact mobile equivalent
- `CommonComposer`

Suggested page composition:

- `WorkspaceShellMobile`
  - `MobileWorkspaceHeader`
  - `WorkspaceTranscript`
  - `CommonComposer`

Related overlay surfaces:

- `MobileConversationsView`
- `MobileAppMenuView`

These are separate full-screen views and are not part of this main-screen image.

## Mobile Behavior Notes

- selecting a conversation should return the user to this main workspace view
- opening the app menu should not replace the current workspace permanently
- this screen is the default active workspace state for mobile

## Non-Goals For This Story

Do not add yet:

- page-specific composer menus
- inline desktop-style conversation pane
- transcript header actions
- file attachments
- page-specific flow or agent controls

## Acceptance Summary

The mobile implementation is correct when:

- the top bar is compact and edge-flush
- assistant outputs take the full width of the mobile transcript area
- assistant and user metadata appear only in footers
- the info popup reads as attached to the footer `Info` button
- the composer remains minimal
- the implementation feels structurally like the final PNG
