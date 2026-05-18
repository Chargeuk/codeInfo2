# Mobile Workspace Conversations View

Matching image files:

- `mobile-workspace-shell-conversations.svg`

Use this concept for:

- `Chat`
- `Agents`
- `Flows`

Image-generation intent:

- generate a polished mobile conversation-switching screen based on this SVG;
- this should feel like a dedicated full-screen panel that slides in from the left over the active workspace;
- it should be the mobile full-screen counterpart to the finalized desktop conversation pane, not a separate inbox-style model.

Goal:

- make conversation switching a dedicated full-screen mobile action;
- keep the list easy to scan and operate without competing with the active transcript view;
- mirror the same information model and controls as the finalized desktop conversation pane.

Regions:

- top bar in `#DCE7F2`
  - full-screen panel header
  - closes or slides away back to the active workspace
  - leading control should be a back arrow
- `Conversation List` in `#FFFFFF`
  - full-screen conversation list matching desktop pane behavior
- `Active`, `Archived`, and `Refresh` controls
  - same top controls as the desktop conversation pane
- conversation rows in `#FFFFFF`
  - stand-ins for real list rows
  - show title, provider icon, model icon/model name, `REST` or `MCP`, last updated time, and `Archive`

Conversation data guidance:

- rows should look like real product work, not generic lorem ipsum
- example rows:
  - `Rework flow rerun semantics`
    - preview: `Open in place with current agent set and reuse the same workspace thread.`
    - timestamp: `2m`
    - provider/model: `Codex` + `gpt-5`
    - transport: `REST`
  - `Copilot provider readiness`
    - preview: `Auth state should be visible without blocking provider/model loading.`
    - timestamp: `18m`
    - provider/model: `Copilot` + `gpt-4.1`
    - transport: `MCP`
  - `docs-maintainer prompt run`
    - preview: `Added implementation notes and marked testing steps complete.`
    - timestamp: `43m`
    - provider/model: `Codex` + `gpt-5`
    - transport: `MCP`
  - `Ingest UI follow-up`
    - preview: `Model lock banner still needs better compact spacing.`
    - timestamp: `1h`
    - provider/model: `LM Studio` + `qwen-coder-14b`
    - transport: `REST`

Behavior notes:

- this view slides in from the left;
- selecting a conversation returns to the main mobile workspace view;
- non-workspace pages should not expose this view at all;
- `Active` and `Archived` are independent toggles;
- enabling both shows both active and archived items;
- search is intentionally not shown yet.

Visual direction for final render:

- clean full-screen conversation browser
- lightweight, fast, easy to scan
- mobile-first and touch-friendly
- list-like and compact rather than oversized-card driven

Color and surface guidance:

- header should use a cool pale tint, visually related to the main mobile workspace top bar
- overall page surface should match the desktop conversation-pane family:
  - pale neutral page background
  - pale blue-gray list container
  - soft gray borders
  - subtle pale blue active row emphasis
- list background should be very light and calm
- non-active conversation rows should not read as bright white cards; they should sit on soft blue-gray surfaces closer to the desktop sidebar
- conversation rows should feel like compact list rows rather than chunky inbox cards
- selected or active conversation can have a very subtle emphasis, but avoid loud highlight colors

Color fidelity rule:

- keep the mobile conversation view visually aligned with the conversation sidebar shown in `desktop-workspace-shell-final.png`
- this update is about matching that sidebar palette more closely, not changing the information model or layout
- specifically:
  - darker navy active toggle
  - softer blue-gray row surfaces
  - lower-contrast borders
  - less bright white overall
  - a flatter, calmer sidebar feel rather than a stack of white cards

Typography guidance:

- title text should be strong and legible
- row titles should be bold enough to scan quickly
- preview text should be softer and secondary
- timestamps should be compact and understated

Layout guidance for final render:

- keep the panel full-screen and edge-aware
- prioritize vertical density without feeling cramped
- include believable mobile affordances:
  - `Active`
  - `Archived`
  - `Refresh`
  - provider icons
  - model labels
  - `REST` / `MCP`
  - timestamps
- the panel should clearly read as temporary navigation, not a permanent second screen

Content guidance:

- show a realistic mix of longer and shorter conversation titles
- use previews that suggest AI/agent work rather than personal texting
- include one active or current conversation state
- show subtle metadata such as provider icon, model, and transport chip

Hard constraints:

- the information model must match the finalized desktop conversation pane
- include `Active`, `Archived`, and `Refresh`
- do not include search yet
- rows must show provider icon, model, `REST` or `MCP`, last updated time, and `Archive`
- this view is only for `Chat`, `Agents`, and `Flows`

Avoid:

- no desktop-looking sidebars
- no oversized card padding
- no generic admin-list styling
- no separate mobile-only conversation metadata model
