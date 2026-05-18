# Chat Composer

## Deliverable

- Generate a polished composer design for the `Chat` page.
- Use [chat-composer.svg](/home/d_a_s/code/codeInfo2/planning/layout-ideas/plan/initial-layout/chat-composer.svg:1) as the structural source of truth.
- This is a composer-only design, not a full page design.

## Intent

- Keep the main text entry stable across desktop and mobile.
- Put page-specific controls into a small footer below the text input.
- Make `Chat` the richest composer of the three page types without making it visually heavy.

## Shared Layout

- One rounded main composer surface.
- One large text input row.
- Circular send button on the right of the input row.
- One compact footer row under the input row.

Footer control order:

1. `Info`
2. working path selector
3. provider selector
4. model selector
5. `Options`

## Footer Controls

### Info

- Render as a small `i` icon button.
- Opens a summary of everything selected.
- Summary must include:
  - provider
  - model
  - thinking mode
  - working path
  - any active options

### Working Path

- Render as a small folder icon button followed by the selected final folder name.
- Show only the final folder name in the footer, not the full path.
- Example:
  - full path: `/home/d_a_s/code/codeInfo2`
  - visible footer label: `codeInfo2`

### Provider Selector

- Opens a provider-selection menu.
- Should clearly show the selected provider in the footer.
- Example providers:
  - `Codex`
  - `Copilot`
  - `LM Studio`

### Model Selector

- Opens one menu, not nested submenus.
- Top section of the menu:
  - available thinking modes
- Separator
- Bottom section:
  - all models for the selected provider

Important:

- do not use nested submenus for this control
- keep the list flat and scannable

### Options

- Opens a menu showing only the options relevant to the selected model
- if the chosen model has no extra options, the menu can show a compact empty-state message

## Desktop Behavior

- Menus open as small anchored popovers near the pressed footer control.
- The `Info` popup should feel attached to the `i` button.
- The `Model` popup can be taller than the others but should still read as a popover, not a modal.

## Mobile Behavior

- The footer layout remains the same.
- Pressing a footer control opens a large dialog or sheet that takes most of the screen.
- Treat each selector as a focused mobile selection view rather than a tiny popover.

## Visual Style

- Match the final common workspace designs.
- White composer surface.
- Light inner border.
- Tight spacing.
- Calm, premium, production-tool look.

## Hard Constraints

- Keep the send button as a dark circular up-arrow button.
- Keep the working path, provider, model, and options in the footer, not inside the main input row.
- Do not show the full folder path in the footer.
- Do not use nested model submenus.

## Suggested React Structure

- `ChatComposer`
- `CommonComposerShell`
- `ChatComposerFooter`
- `ComposerInfoButton`
- `WorkingPathButton`
- `ProviderSelectorButton`
- `ModelSelectorButton`
- `OptionsButton`

## Avoid

- no paperclip
- no page header controls leaking back into the transcript area
- no desktop-only layout differences in the base footer structure
- no wide text buttons for send
