# Desktop Workspace Shell

## Deliverable

- Generate a polished desktop light-mode mockup for the shared `Common` workspace used by `Chat`, `Agents`, and `Flows`.
- Use [desktop-workspace-shell.svg](desktop-workspace-shell.svg) as the structural source of truth for placement, proportions, and information hierarchy.

## Intent

- Maximize vertical space for transcript-driven work.
- Remove the current top navigation bar and any transcript header row.
- Make the transcript the dominant workspace surface.
- Keep the composer intentionally minimal for this common-view phase.
- Keep the result closer to the Codex desktop app than to a generic enterprise dashboard.

## Canvas And Viewpoint

- Full desktop app screenshot or product mockup.
- Straight-on view, not isometric.
- Show the entire workspace shell, including left rail, conversation pane, transcript area, and bottom composer.
- Preserve the overall layout proportions from the SVG closely.

## Layout Hierarchy

- Far-left slim app rail.
- Desktop conversation pane immediately to the right of the rail.
- Main transcript pane as the dominant central workspace.
- Full-width bottom composer aligned with the transcript width.

## Navigation Rail

- Use only these destinations:
  - `Home`
  - `Chat`
  - `Agents`
  - `Flows`
  - `Ingest`
  - `Logs`
- Use small text labels under or beside simple monochrome icons.
- Icon direction:
  - `Home`: minimal house icon
  - `Chat`: speech bubble icon
  - `Agents`: spark or bot-head icon
  - `Flows`: branching path or connected-nodes icon
  - `Ingest`: tray-in or database-import icon
  - `Logs`: list or terminal-lines icon
- The rail must be narrow and flush to the page edge.
- Do not add `Help`.
- Do not add a product logo at the top.
- Do not add a user avatar at the bottom.

## Conversation Pane

- The conversation pane must read as part of the shell, not a floating card.
- Conversation rows should read as a compact list, not as separate inset cards.
- Include:
  - independent `Active` and `Archived` toggles
  - a top-right `Refresh` action
  - a slim collapse affordance on the right edge
- `Active` and `Archived` are plain toggles, not checkbox-like controls.
- Do not show a search field.
- Every conversation row should include:
  - a title
  - a model-provider icon only
  - a model icon plus model name
  - a compact `REST` or `MCP` chip
  - an updated time shown as `Xm ago` or `Xh ago` within 24 hours, otherwise exact date and time
  - a compact row-level `Archive` action
- Example row data:
  - `Rework flow rerun semantics`, provider `Codex`, model `gpt-4.1`, type `REST`, updated `2m ago`
  - `Copilot provider fallback rules`, provider `Copilot`, model `gpt-4o`, type `MCP`, updated `18m ago`
  - `docs-maintainer / execute prompt`, provider `LM Studio`, model `qwen-coder`, type `REST`, updated `9m ago`
  - `repo-review-flow`, provider `Codex`, model `gpt-4.1`, type `MCP`, updated `May 17, 2026 14:32`
- Keep the provider icons explicitly.
- Do not replace them with git-provider or source-control branding.

## Transcript Surface

- The transcript must read as one continuous borderless canvas.
- Do not add a top header row above transcript content.
- Assistant responses should be full-width document-like slices.
- Assistant slices must fill the full available transcript width.
- Do not inset assistant outputs like centered cards.
- The assistant background should reach the transcript column's invisible left and right edges.
- User messages should be compact dark bubbles aligned to the right.
- User bubbles should sit between assistant slices in the reading rhythm, not overlay them.
- Oldest content should appear higher in the transcript and newer content lower.

## Assistant Output

- Assistant outputs must not have a title bar.
- Assistant outputs must not have a top-left icon.
- Assistant outputs must not have top-right time or copy metadata.
- Assistant outputs should feel paragraph-first and document-like, not like titled cards.
- If bold text is used at the start, it should read like the first sentence of body content, not a standalone heading.
- Do not use standalone headings such as:
  - `Recommended direction`
  - `Layout approach`
  - `Shell patterns confirmed`
- All assistant slices should use the same light cool-gray surface color, ideally `#EEF2F6`.
- Use compact horizontal padding and long text lines that use most of the available width.

## Assistant Footer

- Use footer-only assistant metadata.
- Left-aligned footer content, in this order:
  - `Info` button
  - response time
  - status chip
- Right-aligned footer content, in this order:
  - completion date/time
  - `Copy`
- Do not show provider or model in the visible footer.
- The completion time should use `Xm ago` or `Xh ago` within 24 hours, otherwise exact date and time.

## Assistant Status Semantics

- The current application uses:
  - `Processing`
  - `Stopping`
  - `Complete`
  - `Failed`
  - `Stopped`
- For this design target, use `Working` instead of `Processing`.
- Do not show `Ready`.
- Use app-like iconography rather than generic dots:
  - `Working`: spinner/progress icon
  - `Complete`: check-circle icon
  - `Failed`: error icon
  - `Stopped`: hourglass icon

## Assistant Info Popup

- The `Info` button opens a popup showing:
  - `Provider`
  - `Model`
  - `Tokens in`
  - `Tokens out`
  - `Cached`
  - `Total`
- Example info dialog values:
  - `Provider: Codex`
  - `Model: gpt-4.1`
  - `Tokens in: 2,104`
  - `Tokens out: 684`
  - `Cached: 1,152`
  - `Total: 3,940`
- The popup must visibly emerge from the footer `Info` button.
- The popup should sit immediately above or near the `Info` button that triggered it.
- The popup must stay inside the transcript column.
- The popup should include a pointer/notch or clearly attached edge.
- Do not place the popup detached elsewhere in the transcript.

## User Bubbles

- User bubbles should be dark charcoal or near-black with white text.
- User bubbles must not have a title bar.
- User bubbles must not have top-right metadata.
- User bubble footer must be right-aligned in this order:
  - acknowledgement tick
  - completion date/time
  - `Copy`
- Tick semantics:
  - grey tick: not yet acknowledged by the server
  - blue tick: acknowledged by the server

## Composer

- The composer should be one full-width rounded input aligned to the transcript width.
- Keep the gap between the composer and the bottom of the viewport very small.
- For this `Common` view, show only:
  - left: working path
  - right: circular send arrow
- Do not show:
  - model controls
  - runtime controls
  - tools controls
  - agent controls
  - flow controls
  - file upload or paperclip

## Visual Style

- Bright light-mode interface.
- Calm, premium, understated AI workspace.
- Minimal chrome.
- No flashy gradients.
- No neon accents.
- Density should feel closer to a production tool than a glossy concept landing page.

## Typography

- Use a modern sans-serif in the spirit of the Codex app.
- Keep hierarchy crisp and editorial.
- Avoid default system-looking typography where possible.
- Message text should be highly readable with generous but not wasteful line height.

## Colors And Surfaces

- App rail: deep desaturated navy, similar to the SVG.
- Conversation pane: soft cool gray-blue.
- Transcript: near-white borderless background.
- Assistant slices: consistent `#EEF2F6` or very close.
- User bubbles: near-black or charcoal.
- Composer: white with subtle depth and light inner border.

## What Must Remain Unchanged From The SVG

- Slim left rail width.
- Conversation pane present on desktop.
- Collapse affordance between conversation pane and transcript.
- No transcript header row.
- Borderless transcript surface.
- Assistant slices spanning the full transcript width.
- User bubbles touching the right edge rhythmically between assistant slices.
- Footer-only metadata pattern.
- Info popup anchored to the footer `Info` button.
- Minimal composer with only working path and send arrow.

## Hard Constraints

- Preserve provider icons in the conversation list.
- Preserve `REST` and `MCP` chips in conversation rows.
- Preserve row-level `Archive` actions.
- Keep the left rail slimmer than a full sidebar.
- Remove all assistant and user top-right metadata.
- Keep assistant metadata in the footer only.
- Keep user bubble metadata in the footer only.
- Keep assistant content rich enough to feel like real AI output, not generic sample text.
- Keep spacing tight and space-efficient.

## Avoid

- No giant empty top header.
- No thick borders around the transcript.
- No floating card treatment for assistant slices.
- No overlay composition where user bubbles sit on top of assistant slices.
- No inconsistent assistant slice colors.
- No `Ready` status chip.
- No desktop transcript header row.
- No assistant title bar or top-left icon.
- No standalone assistant section headings.
- No literal placeholder labels such as `Assistant Section` or `User Bubble`.
- No visible provider or model in the assistant footer.
- No conversation search field.
- No detached token popup away from the footer `Info` button.
- No large unassigned white gaps.
- No purple-heavy palette.
- No dark mode for this concept.
