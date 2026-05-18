# Mobile App Menu

Matching image files:

- `mobile-app-menu.svg`

Use this concept for:

- all pages

Image-generation intent:

- generate a polished full-screen mobile app-navigation panel from this SVG;
- this should feel like the right-side slide-in version of the finalized desktop app rail;
- it should complement the workspace and utility pages rather than turning into a broader settings or account menu.

Goal:

- provide a full-screen mobile application navigation surface;
- clearly separate app-level navigation from conversation-level navigation;
- match the same destination set as the desktop rail exactly.

Regions:

- top bar in `#DCE7F2`
  - full-screen panel header
  - closes or slides away back to the current page
  - the visible close/back affordance should be obvious and touch-friendly
- `Application Destinations` in `#FFFFFF`
  - full-screen destination list
- `Home`, `Chat`, `Agents`, `Flows`, `Ingest`, `Logs` rows
  - tappable application destinations matching the desktop rail

Navigation item guidance:

- `Home`
  - icon: house
  - purpose: system overview, versions, LM Studio summary, quick status
- `Chat`
  - icon: speech bubble
  - purpose: direct provider/model chat with transcript history
- `Agents`
  - icon: robot head, spark, or specialist tool icon
  - purpose: run named agents, commands, and prompts
- `Flows`
  - icon: branching path or connected nodes
  - purpose: orchestrated multi-step workflows and reruns
- `Ingest`
  - icon: tray-in, import arrow, or database-down icon
  - purpose: repository ingest and embedding operations
- `Logs`
  - icon: list, terminal lines, or activity feed icon
  - purpose: live operational logs and diagnostics

Behavior notes:

- this view slides in from the right;
- it appears on both workspace and utility pages;
- it should be a single-purpose navigation screen, not a partial drawer;
- it is the mobile full-screen counterpart to the desktop app rail.

Visual direction for final render:

- elegant, minimal, product-level navigation surface
- clear destination list with strong hierarchy
- calm, premium styling rather than loud menu design

Color and surface guidance:

- header should share the same family as the mobile workspace top bar
- background should be pale and clean
- destination rows should be simple, readable, and touch-friendly
- active or current section can be highlighted subtly

Typography guidance:

- large, readable destination names
- confident but not bulky
- concise secondary descriptions are acceptable

Layout guidance for final render:

- keep the menu full-screen
- provide a clear close/back affordance at the top
- show destinations as well-spaced rows
- this should look like a product navigation layer, not a settings sheet

Content guidance:

- include exactly these destinations:
  - Home
  - Chat
  - Agents
  - Flows
  - Ingest
  - Logs

Hard constraints:

- the destination set must exactly match the finalized desktop app rail
- no `Account`
- no profile or settings section
- no extra destinations not present in the desktop rail
- no conversation-specific controls here

Avoid:

- no partial-width drawer treatment
- no cluttered icon grid
- no excessive color coding per destination
- no account/profile destination
