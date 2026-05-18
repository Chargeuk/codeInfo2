# Agents Composer

## Deliverable

- Generate a polished composer design for the `Agents` page.
- Use [agents-composer.svg](/home/d_a_s/code/codeInfo2/planning/layout-ideas/plan/initial-layout/agents-composer.svg:1) as the structural source of truth.
- This is a composer-only design, not a full page design.

## Intent

- Keep the base composer shape shared with `Chat` and `Flows`.
- Put agent-specific controls into the footer below the input.
- Make the dependency between agent, command, and step obvious without making the footer visually crowded.

## Shared Layout

- One rounded main composer surface.
- One large text input row.
- Circular send button on the right of the input row.
- One compact footer row under the input row.

Footer control order:

1. `Info`
2. working path selector
3. agent selector
4. command selector
5. step selector

## Footer Controls

### Info

- Render as a small `i` icon button.
- Opens a summary of everything selected.
- Summary should include:
  - selected agent
  - selected command
  - selected step
  - selected working path
  - any relevant provider or model information if applicable for that agent

### Working Path

- Render as a small folder icon button followed by the selected final folder name.
- Show only the final folder name in the footer, not the full path.

### Agent Selector

- Opens a list of available agents.
- The currently selected agent is shown compactly in the footer.

### Command Selector

- Opens a list of commands available for the selected agent.
- Changing the agent may reset the selected command if it is no longer valid.

### Step Selector

- Opens a list of steps for the selected command.
- Changing the command may reset the selected step if it is no longer valid.

## Desktop Behavior

- Menus open as small anchored popovers near the pressed control.
- The `Info` popup should feel attached to the `i` button.
- Agent, command, and step selectors should all feel like compact control popovers.

## Mobile Behavior

- The footer layout remains the same.
- Pressing a footer control opens a large dialog or sheet that takes most of the screen.
- Agent, command, and step selection should each feel like focused mobile views.

## Visual Style

- Match the final common workspace designs.
- White composer surface.
- Light inner border.
- Tight spacing.
- Calm, premium, production-tool look.

## Hard Constraints

- Keep the send button as a dark circular up-arrow button.
- Keep agent, command, and step in the footer, not in the main input row.
- Do not show the full folder path in the footer.
- Make dependency behavior between agent, command, and step clear.

## Suggested React Structure

- `AgentsComposer`
- `CommonComposerShell`
- `AgentsComposerFooter`
- `ComposerInfoButton`
- `WorkingPathButton`
- `AgentSelectorButton`
- `CommandSelectorButton`
- `StepSelectorButton`

## Avoid

- no paperclip
- no page header controls leaking back into the transcript area
- no desktop-only layout differences in the base footer structure
- no hidden dependency resets with no visual feedback
