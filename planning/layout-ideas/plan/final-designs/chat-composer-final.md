# Chat Composer Final

## Purpose

This is the chosen composer target for the `Chat` page.

It should be used together with:

- `desktop-workspace-shell-final.png`
- `mobile-workspace-shell-main-final.png`

The shell stays shared across `Chat`, `Agents`, and `Flows`. The page-specific difference for `Chat` is the footer control set below the text input.

## Visual Target

Match:

- `chat-composer-final.png`

This image is the source of truth for the `Chat` composer layout and footer hierarchy.

## High-Level Structure

The composer has three parts:

1. one rounded outer composer surface
2. one main text input row
3. one compact footer row below the input

The send button remains visually attached to the right side of the input row, not to the footer row.

## Main Input Row

Requirements:

- wide text input
- neutral placeholder or draft text
- large enough to feel like the primary action area
- dark circular send button with up-arrow on the far right

Rules:

- the main input row is visually dominant
- footer controls are secondary
- do not place page-specific controls inside the text input row

## Footer Row

Footer controls must appear in this order:

1. `Info`
2. working path selector
3. provider selector
4. model selector
5. `Options`

The row should feel compact, scannable, and clearly below the input area.

## Control Requirements

### Info

- render as a small `i` icon button
- opens a summary of all current selections

Summary content should include:

- provider
- model
- thinking mode
- selected working path
- active options

### Working Path

- render as a folder icon plus selected folder name
- show only the final folder name in the footer
- do not show the full path inline

Example:

- full path: `/workspace/codeInfo2`
- visible footer text: `codeInfo2`

### Provider Selector

- compact footer control
- shows the selected provider inline
- opens a provider-selection UI

Example providers:

- `Codex`
- `Copilot`
- `LM Studio`

### Model Selector

- compact footer control
- shows the selected thinking mode and model inline
- opens one flat menu

The menu must be structured as:

1. thinking modes at the top
2. a separator
3. models for the selected provider below

Important:

- do not use nested submenus
- keep the full model selection experience in one list surface

### Options

- compact footer control labeled `Options`
- opens a menu that only shows options relevant to the currently selected provider/model

If no options are available:

- still allow the control to open
- show a compact empty state instead of removing the control entirely

## Desktop Behavior

Desktop interaction pattern:

- all selectors open as anchored popovers near the pressed control
- the `Info` popup should feel attached to the `i` button
- the `Model` popup may be taller than the other popups, but it should still read as a popover rather than a full dialog

Desktop implementation notes:

- popovers should anchor to the footer control that opened them
- avoid large detached floating panels
- keep the controls close enough that the origin of the popup is always obvious

## Mobile Behavior

The visible composer layout remains the same on mobile.

Mobile interaction pattern:

- each footer control opens a large dialog or sheet-style view
- these mobile selection surfaces should take most of the screen
- do not try to use tiny anchored popovers on mobile

Mobile implementation notes:

- the footer still shows the same control order
- long values should truncate cleanly
- the model picker should remain one flat list, not nested navigation

## React Implementation Notes

Suggested components:

- `CommonComposerShell`
- `ChatComposer`
- `ChatComposerFooter`
- `ComposerInfoButton`
- `WorkingPathButton`
- `ProviderSelectorButton`
- `ModelSelectorButton`
- `OptionsButton`

Suggested overlays:

- `ChatComposerInfoPopover`
- `ChatProviderPopover`
- `ChatModelPopover`
- `ChatOptionsPopover`
- mobile equivalents as dialog or sheet components

## Developer Watchouts

- long model names may force truncation; plan for ellipsis in the footer
- provider changes should invalidate models that no longer apply
- model changes may invalidate options that no longer apply
- the `Info` summary must reflect current state consistently
- do not let the footer grow so tall that it competes visually with the main input row
- keep the send button in a fixed, predictable position

## Hard Constraints

- no paperclip
- no full path shown inline in the footer
- no nested model submenus
- no page header controls inside the composer
- no wide text send button

## Acceptance Summary

The `Chat` composer is correct when:

- it clearly matches `chat-composer-final.png`
- the footer order is preserved
- desktop uses anchored popovers
- mobile uses large dialog or sheet views
- the model picker remains one flat list with thinking modes first and models second
