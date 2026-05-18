# Agents Composer Final

## Purpose

This is the chosen composer target for the `Agents` page.

It should be used together with:

- `desktop-workspace-shell-final.png`
- `mobile-workspace-shell-main-final.png`

The shell stays shared across `Chat`, `Agents`, and `Flows`. The page-specific difference for `Agents` is the footer control set below the text input.

## Visual Target

Match:

- `agents-composer-final.png`

This image is the source of truth for the `Agents` composer layout and footer hierarchy.

## High-Level Structure

The composer has three parts:

1. one rounded outer composer surface
2. one main text input row
3. one compact footer row below the input

The send button remains visually attached to the right side of the input row.

## Main Input Row

Requirements:

- wide text input
- realistic prompt-style placeholder or draft text
- visually dominant compared with the footer
- dark circular send button with up-arrow on the far right

## Footer Row

Footer controls must appear in this order:

1. `Info`
2. working path selector
3. agent selector
4. command selector
5. step selector

The row should remain compact and scannable.

## Control Requirements

### Info

- render as a small `i` icon button
- opens a summary of all current selections

Summary content should include:

- selected agent
- selected command
- selected step
- selected working path
- provider or model information if relevant to the current agent execution

### Working Path

- render as a folder icon plus selected folder name
- show only the final folder name in the footer
- do not show the full path inline

### Agent Selector

- compact footer control
- shows the selected agent inline
- opens a list of available agents

### Command Selector

- compact footer control
- shows the selected command inline
- opens a list of commands available for the selected agent

### Step Selector

- compact footer control
- shows the selected step inline
- opens a list of steps for the selected command

## Desktop Behavior

Desktop interaction pattern:

- all selectors open as anchored popovers near the pressed control
- the `Info` popup should feel attached to the `i` button
- command and step controls should read like compact popover-driven selectors

Desktop implementation notes:

- make the dependency chain visually understandable
- command options must clearly belong to the selected agent
- step options must clearly belong to the selected command

## Mobile Behavior

The visible composer layout remains the same on mobile.

Mobile interaction pattern:

- each footer control opens a large dialog or sheet-style view
- do not use tiny anchored popovers on mobile
- agent, command, and step each become focused mobile selection views

## React Implementation Notes

Suggested components:

- `CommonComposerShell`
- `AgentsComposer`
- `AgentsComposerFooter`
- `ComposerInfoButton`
- `WorkingPathButton`
- `AgentSelectorButton`
- `CommandSelectorButton`
- `StepSelectorButton`

Suggested overlays:

- `AgentsComposerInfoPopover`
- `AgentSelectorPopover`
- `CommandSelectorPopover`
- `StepSelectorPopover`
- mobile equivalents as dialog or sheet components

## Developer Watchouts

- changing the selected agent may invalidate the selected command
- changing the selected command may invalidate the selected step
- when invalidation happens, the UI must reset dependent values clearly and predictably
- command names may be long, so truncation needs to be handled gracefully
- avoid overloading the footer with extra runtime or provider controls unless explicitly required later
- the `Info` popup should be a summary, not a replacement for the selectors themselves

## Hard Constraints

- no paperclip
- no full path shown inline in the footer
- no hidden dependency resets
- no page header controls inside the composer
- no wide text send button

## Acceptance Summary

The `Agents` composer is correct when:

- it clearly matches `agents-composer-final.png`
- the footer order is preserved
- desktop uses anchored popovers
- mobile uses large dialog or sheet views
- dependency relationships between agent, command, and step are understandable and stable
