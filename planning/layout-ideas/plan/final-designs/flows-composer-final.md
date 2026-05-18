# Flows Composer Final

## Purpose

This is the chosen composer target for the `Flows` page.

It should be used together with:

- `desktop-workspace-shell-final.png`
- `mobile-workspace-shell-main-final.png`

The shell stays shared across `Chat`, `Agents`, and `Flows`. The page-specific difference for `Flows` is the footer control set below the text input.

## Visual Target

Match:

- `flows-composer-final.png`

This image is the source of truth for the `Flows` composer layout and footer hierarchy.

## High-Level Structure

The composer has three parts:

1. one rounded outer composer surface
2. one main text input row
3. one compact footer row below the input

The send button remains visually attached to the right side of the input row.

## Main Input Row

Requirements:

- wide text input
- realistic flow-run placeholder or draft text
- visually dominant compared with the footer
- dark circular send button with up-arrow on the far right

## Footer Row

Footer controls must appear in this order:

1. `Info`
2. working path selector
3. selected flow
4. title

This is the simplest of the three composer footers and should remain visually lighter than `Chat` and `Agents`.

## Control Requirements

### Info

- render as a small `i` icon button
- opens a summary of all current selections

Summary content should include:

- selected flow
- title state
- selected working path
- provider or model details if applicable for the current flow context

### Working Path

- render as a folder icon plus selected folder name
- show only the final folder name in the footer
- do not show the full path inline

### Selected Flow

- compact footer control
- shows the selected flow inline
- opens a menu of available flows

### Title

- if a title is not set, render the control as a clear button-like prompt such as `Set title`
- if a title is already set, render it as a compact editable value
- clicking it opens the title editing UI

## Desktop Behavior

Desktop interaction pattern:

- all selectors open as anchored popovers near the pressed control
- the `Info` popup should feel attached to the `i` button
- the title editor may be a compact anchored dialog-like popover rather than a tiny simple menu

Desktop implementation notes:

- title editing is more form-like than simple selection, so it can be slightly richer than other popovers
- keep it visually attached to the composer control that opened it

## Mobile Behavior

The visible composer layout remains the same on mobile.

Mobile interaction pattern:

- each footer control opens a large dialog or sheet-style view
- flow selection becomes a focused mobile selection view
- title editing becomes a focused mobile form view

## React Implementation Notes

Suggested components:

- `CommonComposerShell`
- `FlowsComposer`
- `FlowsComposerFooter`
- `ComposerInfoButton`
- `WorkingPathButton`
- `FlowSelectorButton`
- `FlowTitleButton`

Suggested overlays:

- `FlowsComposerInfoPopover`
- `FlowSelectorPopover`
- `FlowTitlePopover`
- mobile equivalents as dialog or sheet components

## Developer Watchouts

- long flow names need truncation in the footer
- the unset-title state must look obviously actionable
- the set-title state must remain editable
- avoid making the title editor so large on desktop that it stops feeling attached to the control
- the `Info` summary should reflect whether a title is set or not

## Hard Constraints

- no paperclip
- no full path shown inline in the footer
- no page header controls inside the composer
- no wide text send button
- no hidden title state

## Acceptance Summary

The `Flows` composer is correct when:

- it clearly matches `flows-composer-final.png`
- the footer order is preserved
- desktop uses anchored popovers
- mobile uses large dialog or sheet views
- the unset-title state is clearly actionable
- the set-title state remains compact and editable
