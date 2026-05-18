# Desktop Workspace Shell Final

## Purpose

This is the chosen desktop target for the shared `Common` workspace used by:

- `Chat`
- `Agents`
- `Flows`

The goal is to maximize transcript space, remove unnecessary top chrome, and establish one reusable desktop shell before page-specific controls are added later.

## Visual Target

Match:

- `desktop-workspace-shell-final.png`

This image is the source of truth for layout direction and information hierarchy.

## High-Level Layout

The page is split into four horizontal regions:

1. a slim left app rail
2. a desktop conversation pane
3. a main transcript workspace
4. a bottom composer aligned to the transcript width

The transcript is the dominant surface.

## App Rail

Requirements:

- fixed to the far left edge
- visually slim, more like a tool rail than a sidebar
- dark navy surface
- small icons with small labels
- no product logo at the top
- no user avatar at the bottom

Items:

- `Home`
- `Chat`
- `Agents`
- `Flows`
- `Ingest`
- `Logs`

Implementation notes:

- use one shared rail component for desktop utility and workspace pages
- keep the rail width intentionally narrow
- active state should be obvious but understated

## Conversation Pane

Requirements:

- always visible on desktop for workspace pages
- sits immediately to the right of the app rail
- reads as part of the shell, not as a stack of cards
- includes top controls for:
  - `Active`
  - `Archived`
  - `Refresh`
- includes a slim collapse affordance on its right edge
- does not include search yet

Conversation row requirements:

- title
- provider icon
- model icon and model name
- `REST` or `MCP` chip
- last updated time
- row-level `Archive` action

Behavior:

- `Active` and `Archived` are independent toggles
- enabling both shows both active and archived conversations
- collapse should hide the entire pane and return more width to the transcript

Implementation notes:

- rows should feel list-like and compact
- provider icons must represent model providers such as `Codex`, `Copilot`, and `LM Studio`
- do not use git or source-control provider branding

## Transcript Workspace

Requirements:

- no transcript header row
- no visible boxed transcript panel
- oldest messages higher in the page, newest lower
- assistant outputs span the full available transcript width
- user bubbles align to the right and sit between assistant outputs

Critical rule:

- assistant outputs must not look like inset cards
- the assistant background should extend to the invisible left and right bounds of the transcript column

## Assistant Output

Requirements:

- full-width document-style slice
- light cool-gray background
- no title bar
- no top-left icon
- no top-right metadata
- content should read like plain answer text, not named sections

Content style:

- may begin with a slightly bolder sentence
- must still read like body content, not a card heading
- should use most of the available readable width

Do not render visible prefixes like:

- `Recommended direction`
- `Layout approach`
- `Shell patterns confirmed`

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
- relative time should be used when recent, otherwise exact date and time

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
- shown inside the transcript column
- not detached in the middle of the page

Popup content:

- `Provider`
- `Model`
- `Tokens in`
- `Tokens out`
- `Cached`
- `Total`

Implementation notes:

- a popover or anchored floating panel is appropriate
- the popup should include a pointer/notch or otherwise read as attached to the trigger

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

- fixed at the bottom of the workspace
- aligned to transcript width, not to the full browser width
- minimal gap to the bottom edge
- one rounded white surface

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

- `AppShell`
- `DesktopAppRail`
- `DesktopConversationPane`
- `WorkspaceTranscript`
- `AssistantMessageSection`
- `UserMessageBubble`
- `AssistantInfoPopover`
- `CommonComposer`

Suggested page composition:

- `WorkspaceShellDesktop`
  - `DesktopAppRail`
  - `DesktopConversationPane`
  - `WorkspaceTranscript`
  - `CommonComposer`

## Non-Goals For This Story

Do not add yet:

- page-specific composer menus
- conversation search
- transcript header actions
- file attachments
- page-specific flow or agent controls

## Acceptance Summary

The desktop implementation is correct when:

- the transcript is clearly the main visual surface
- assistant outputs take the full width of the transcript column
- assistant and user metadata appear only in footers
- the conversation pane can collapse
- the composer remains minimal
- the implementation feels structurally like the final PNG
