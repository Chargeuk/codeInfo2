# Flows Composer

## Deliverable

- Generate a polished composer design for the `Flows` page.
- Use [flows-composer.svg](/home/d_a_s/code/codeInfo2/planning/layout-ideas/plan/initial-layout/flows-composer.svg:1) as the structural source of truth.
- This is a composer-only design, not a full page design.

## Intent

- Keep the base composer shape shared with `Chat` and `Agents`.
- Make `Flows` the simplest footer of the three page types.
- Let flow identity and optional title be the main page-specific footer elements.

## Shared Layout

- One rounded main composer surface.
- One large text input row.
- Circular send button on the right of the input row.
- One compact footer row under the input row.

Footer control order:

1. `Info`
2. working path selector
3. selected flow
4. title

## Footer Controls

### Info

- Render as a small `i` icon button.
- Opens a summary of everything selected.
- Summary should include:
  - selected flow
  - title state
  - selected working path
  - provider or model details if the flow run has those selections

### Working Path

- Render as a small folder icon button followed by the selected final folder name.
- Show only the final folder name in the footer, not the full path.

### Selected Flow

- Render as a compact selected value.
- Opens a menu of flows when clicked.
- The footer should make the selected flow obvious without taking excessive width.

### Title

- If no title is set, render the control as a clear button-like prompt such as `Set title`.
- If a title is set, render it as compact editable text or a button-like value.
- Clicking it opens the title editing interface.

## Desktop Behavior

- Menus open as small anchored popovers near the pressed control.
- The `Info` popup should feel attached to the `i` button.
- The title editor can open as a compact anchored popup or tiny dialog-like popover.

## Mobile Behavior

- The footer layout remains the same.
- Pressing a footer control opens a large dialog or sheet that takes most of the screen.
- Flow selection and title editing should each feel like focused mobile views.

## Visual Style

- Match the final common workspace designs.
- White composer surface.
- Light inner border.
- Tight spacing.
- Calm, premium, production-tool look.

## Hard Constraints

- Keep the send button as a dark circular up-arrow button.
- Keep flow and title in the footer, not in the main input row.
- Do not show the full folder path in the footer.
- Make the unset-title state clearly actionable.

## Suggested React Structure

- `FlowsComposer`
- `CommonComposerShell`
- `FlowsComposerFooter`
- `ComposerInfoButton`
- `WorkingPathButton`
- `FlowSelectorButton`
- `FlowTitleButton`

## Avoid

- no paperclip
- no page header controls leaking back into the transcript area
- no desktop-only layout differences in the base footer structure
- no hidden title state where the user cannot tell whether a title is set
