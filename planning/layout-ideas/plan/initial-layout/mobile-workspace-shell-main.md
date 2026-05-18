# Mobile Workspace Main

## Deliverable

- Generate a polished mobile light-mode mockup for the shared `Common` workspace used by `Chat`, `Agents`, and `Flows`.
- Use [mobile-workspace-shell-main.svg](/home/d_a_s/code/codeInfo2/planning/layout-ideas/plan/initial-layout/mobile-workspace-shell-main.svg:1) as the structural source of truth for placement, proportions, and information hierarchy.

## Intent

- Keep the active workspace as the only primary mobile view.
- Maximize transcript space.
- Avoid cramped drawers and excessive chrome.
- Keep the common composer intentionally minimal until the shared layout is finalized.
- Preserve a serious AI workspace feel rather than a casual messaging-app look.

## Canvas And Viewpoint

- Full mobile app screenshot or product mockup.
- Straight-on phone view.
- Show the entire active workspace state from top bar to bottom composer.
- Preserve the SVG layout closely rather than reinterpreting it as a generic polished chat app.

## Layout Hierarchy

- Edge-flush top bar.
- Borderless transcript surface as the dominant view.
- Full-width assistant slices.
- Right-aligned user bubbles.
- Bottom composer fixed near the safe-area edge.

## Top Bar

- Full width and flush to the top and side edges.
- Separated from the transcript only by a thin horizontal divider.
- Left action opens the conversations view.
- Right action opens the full-screen app menu.
- Icon direction:
  - left: back-style arrow or conversation-switch icon
  - right: hamburger/menu icon
- Do not render the top bar as a rounded floating card.

## Transcript Surface

- The transcript must read as a continuous mobile reading surface.
- Assistant sections should be full-width slices, not bubble cards.
- Assistant slices must span the full mobile transcript width.
- Do not render assistant outputs as inset panels.
- Assistant slices should touch or nearly touch vertically.
- User replies should remain compact dark bubbles.
- The transcript should feel dense and space-efficient.

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
- Preserve the richer desktop information hierarchy rather than simplifying the content into generic short chat text.
- All assistant slices should use the same light cool-gray fill, ideally `#EEF2F6`.
- Assistant text must read as plain answer content, not named sections.
- Avoid visible prefixes such as `Layout approach:` or `Shell patterns confirmed:`.

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
- The popup should be compact and should not visually overpower the transcript.
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

- The composer should stretch almost the full safe width of the viewport.
- Keep it wide and anchored near the bottom edge.
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

- Bright, premium, light-mode mobile AI workspace.
- Minimal top chrome.
- Subtle depth, not flat wireframe energy.
- Serious and productivity-focused, not playful.

## Typography

- Clean contemporary sans-serif.
- Compact but highly readable.
- Strong hierarchy without oversized headlines.
- Avoid playful or chatty fonts.

## Colors And Surfaces

- Top bar: soft cool tint integrated with the viewport edge.
- Assistant slices: consistent light cool-gray, ideally `#EEF2F6`.
- User bubbles: dark charcoal or black with white text.
- Background: light and uncluttered.
- Composer: white and subtly elevated.

## What Must Remain Unchanged From The SVG

- Edge-flush top bar.
- Thin divider under the top bar.
- No outer rounded transcript frame.
- Full-width assistant slices.
- Right-aligned user bubbles.
- Footer-only metadata pattern.
- Info popup anchored to the footer `Info` button.
- Minimal composer with only working path and send arrow.

## Hard Constraints

- Remove all assistant and user top-right metadata.
- Keep assistant metadata in the footer only.
- Keep user bubble metadata in the footer only.
- Keep assistant content as rich as the desktop concept.
- Use the same assistant section color for every slice.
- Keep assistant slices full-width and borderless.
- Keep spacing compact and efficient.

## Avoid

- No full-width user rectangles.
- No detached assistant bubbles.
- No thick rounded transcript frame.
- No rounded top header card.
- No card-like assistant panels separated by generous outer padding.
- No simplified assistant copy that drops the metadata or utility affordances shown on desktop.
- No inconsistent assistant section colors.
- No missing assistant status chip.
- No `Ready` status chip.
- No assistant title bar or top-left icon.
- No standalone assistant section headings.
- No literal placeholder labels such as `Assistant Section` or `User Bubble`.
- No visible provider or model in the assistant footer.
- No detached token popup away from the footer `Info` button.
- No excessive decorative elements.
- No page-specific composer controls yet.
