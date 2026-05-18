# Final Designs

These are the chosen target concepts for the shared `Common` workspace layout.

Files:

- `desktop-workspace-shell-final.png`
- `desktop-workspace-shell-final.md`
- `mobile-workspace-shell-main-final.png`
- `mobile-workspace-shell-main-final.md`
- `home-page-final.png`
- `home-page-final.md`
- `mobile-home-page-final.png`
- `mobile-home-page-final.md`
- `ingest-page-final.png`
- `ingest-page-final.md`
- `mobile-ingest-page-final.png`
- `mobile-ingest-page-final.md`
- `logs-page-final.png`
- `logs-page-final.md`
- `mobile-logs-page-final.png`
- `mobile-logs-page-final.md`
- `mobile-app-menu-final.png`
- `mobile-app-menu-final.md`
- `mobile-workspace-shell-conversations-final.png`
- `mobile-workspace-shell-conversations-final.md`
- `chat-composer-final.png`
- `chat-composer-final.md`
- `agents-composer-final.png`
- `agents-composer-final.md`
- `flows-composer-final.png`
- `flows-composer-final.md`

Purpose:

- use the PNG files as the visual target
- use the matching Markdown files as the implementation contract for a React story

Important:

- these designs define layout, hierarchy, metadata placement, and interaction patterns
- implementation should preserve the intent and structure even if spacing or typography needs small practical adjustments during development
- this is the `Common` workspace view only; page-specific controls for `Chat`, `Agents`, and `Flows` are intentionally deferred

Composer notes:

- the shell PNGs and Markdown files define the shared page layout
- the Home PNGs and Markdown files define the utility-shell landing and system-status page
- the Ingest PNGs and Markdown files define the utility-shell operational ingest surfaces for desktop and mobile
- the Logs PNGs and Markdown files define the utility-shell logs surfaces for desktop and mobile
- the mobile app-menu PNG and Markdown define the full-screen mobile counterpart to the desktop app rail
- the mobile conversations PNG and Markdown define the full-screen mobile counterpart to the desktop conversation pane
- the composer PNGs and Markdown files define the page-specific footer controls for `Chat`, `Agents`, and `Flows`
- the composer layouts are intentionally shared across desktop and mobile; the major platform difference is how selection UI opens:
  - desktop uses anchored popovers
  - mobile uses large dialog or sheet-style views
