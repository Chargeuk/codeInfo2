# Utility Page Shell

Matching image files:

- `utility-page-shell.svg`

Use this concept for:

- `Home`
- `Ingest`
- `Logs`

Image-generation intent:

- generate a polished desktop utility-page mockup using this SVG as the structural base;
- this should feel like the non-conversation companion shell to the workspace views;
- keep it visually related to the workspace shell but clearly optimized for dashboards, operations, and status-heavy pages.

Goal:

- keep non-conversation pages consistent with the new app shell;
- avoid forcing the conversation pattern onto pages that do not need it;
- absorb the current `LM Studio` page content into `Home`.

Regions:

- `App Rail` in `#20354A`
  - desktop application navigation
  - include these explicit nav items and icon directions:
    - `Home`: house icon
    - `Chat`: speech bubble icon
    - `Agents`: spark or bot-head icon
    - `Flows`: branching path icon
    - `Ingest`: import or tray-in icon
    - `Logs`: list or terminal-lines icon
- `Utility Header` in `#DCE7F2`
  - title, summary, and top-level page actions
- `Status Card A` in `#FFFFFF`
  - example slot for system, version, and LM Studio summary information
- `Status Card B` in `#FFFFFF`
  - example slot for recent activity or health information
- `Quick Actions` in `#F5D98E`
  - actions the user should reach quickly
- `Main Utility Content` in `#FFFFFF`
  - logs table, ingest controls, diagnostics, or other operational UI

Behavior notes:

- mobile utility pages should only expose the app menu view;
- they should not show the conversations trigger;
- `Home` should become the natural place for the current LM Studio page information.

Visual direction for final render:

- clean operational dashboard with premium light-mode styling
- denser and more useful than a marketing landing page
- calmer and softer than a traditional enterprise admin panel

Color and surface guidance:

- reuse the same deep app-rail color as the workspace shell
- keep the header pale and compact
- content cards should be soft white with subtle separation
- quick-actions region can be lightly emphasized, but should still feel cohesive with the rest of the interface

Typography guidance:

- same overall font family as the workspace shell
- strong but restrained hierarchy
- readable data-oriented labels and statuses

Layout guidance for final render:

- left app rail should visually match the workspace shell
- this page should not include any conversation pane
- header should be compact and functional
- top cards should feel useful and information-dense
- the main content region should be large enough for a logs table, ingest controls, or health diagnostics

Content guidance:

- `Home` version:
  - system version card
  - LM Studio status card
  - recent activity card
  - quick actions for setup / refresh / health checks
  - show actual useful data examples such as:
    - `Server version 0.0.1`
    - `LM Studio connected · 12 models`
    - `Last ingest completed 14m ago`
- `Ingest` version:
  - run status summaries
  - model lock summary
  - action buttons
  - large operational content area
  - example data:
    - `Embedding model locked to text-embedding-3-large`
    - `Current run 68% complete`
    - `3 files skipped for AST indexing`
- `Logs` version:
  - filters
  - status chips
  - large table or list area
  - example data:
    - `client-flows · info · run_in_place started`
    - `server · warn · copilot auth expired`
    - `client · info · conversation sidebar refreshed`

Avoid:

- no conversation-centric UI here
- no giant hero section
- no decorative empty space
- no harsh enterprise-grid aesthetic
