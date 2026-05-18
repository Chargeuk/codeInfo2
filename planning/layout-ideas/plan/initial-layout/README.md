# Initial Layout Set

This folder contains low-fidelity layout mockups for the next GUI redesign pass.

Purpose:

- capture structure before visual styling;
- provide stable source images that can be fed into later image-generation work;
- separate interaction/layout decisions from color, texture, typography, and polish decisions.

Artifacts:

- `*.svg`: editable low-fidelity source layout files;
- `*.md`: matching layout key/spec files for each concept.

Notes:

- PNG previews were intentionally removed after review because the screenshot export path cropped them and made them misleading.
- Treat the SVG files as the source of truth for the initial-layout phase.

Concepts included:

- `desktop-workspace-shell`
- `mobile-workspace-shell-main`
- `mobile-workspace-shell-conversations`
- `mobile-app-menu`
- `utility-page-shell`

Shared color key used in the initial-layout set:

- `#20354A`: global application navigation rail
- `#E7EDF2`: conversation list / list-oriented support panel
- `#DCE7F2`: top header / page header region
- `#FFFFFF`: main transcript or main utility content area
- `#D9F2E6`: bottom composer / input surface
- `#F2E8FF`: contextual settings popover or sheet
- `#F5D98E`: quick actions / highlighted operational controls
- `#F8FAFC`: full-screen overlay menu surface

Design intent:

- `Chat`, `Agents`, and `Flows` should converge on one reusable workspace shell.
- `Home`, `Ingest`, and `Logs` should share a simpler utility-oriented shell.
- desktop should use a left icon rail for app-level navigation.
- mobile should use full-screen slide-in panels:
  - conversations from the left for workspace pages only;
  - app navigation from the right for all pages.

These files are intentionally low fidelity and should be treated as structural references, not visual targets.
