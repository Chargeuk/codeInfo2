# Story 0000028 - Agents + Chat GUI consistency

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

The Agents and Chat pages currently waste vertical space and feel inconsistent with other pages (Chat, Agents, LM Studio, Ingest). Controls vary in size, alignment, and button styling, and the conversation view stops above the bottom of the screen leaving unused space. This story will reorganize the Agents controls to reclaim space, align inline controls to the same size and baseline, and make the conversation view fill the available height. It also introduces a reusable “Choose Folder” picker for Agents and Chat so folder selection behaves the same way as the Ingest page. The end result should be a tighter, more consistent UI that feels aligned across pages, with primary and secondary actions clearly distinguished and better use of screen real estate.

---

## Acceptance Criteria

- Agents page removes the description line and replaces it with an info icon beside the agent selector; clicking it opens a popover showing the agent description (Markdown) and any warnings.
- Agents controls are re-laid out to maximize vertical space:
  - The command selector and “Execute Command” button sit on the same row.
  - Send/Stop live to the right of the Instruction input and share identical sizing.
- Chat and Agents conversation views extend to the bottom of the viewport with no large unused gap.
- Chat and Agents include a “Choose Folder” button that uses the same directory picker behavior as the Ingest page.
- All dropdowns, text inputs, and buttons across Chat, Agents, LM Studio, and Ingest use consistent sizing and alignment (matching the current Agents control sizing).
- Button styling is consistent across pages with a clear primary/secondary hierarchy and matching sizes on shared rows (primary: `contained`; secondary: `outlined`; Stop uses `contained` + error color).
- Each task in this story must capture and review fresh UI screenshots to confirm the intended changes work and look correct.

## Visual References

- Chat layout gaps + control sizing baseline: `planning/0000028-agents-chat-gui-consistency-data/chat-page.png`
- Agents layout issues (agent description line, command layout, Send placement, conversation gap): `planning/0000028-agents-chat-gui-consistency-data/agents-page.png`
- LM Studio control sizing/variant differences: `planning/0000028-agents-chat-gui-consistency-data/lmstudio-page.png`
- Ingest control sizing + existing “Choose folder…” behavior to mirror: `planning/0000028-agents-chat-gui-consistency-data/ingest-page.png`

## Screenshot Workflow (required for every task)

1. Use the Playwright MCP tool to take screenshots (e.g. `browser_take_screenshot`) with a **relative** filename under `planning/0000028-agents-chat-gui-consistency-data/`.
2. Playwright saves to `/tmp/playwright-output`, which is mapped to `./playwright-output-local` on the host when using `docker-compose.local.yml`.
3. Move the screenshot into the repo folder so it is tracked alongside the plan:
   - Example: `mv playwright-output-local/planning/0000028-agents-chat-gui-consistency-data/<file>.png planning/0000028-agents-chat-gui-consistency-data/<file>.png`
4. Record which screenshots were reviewed for the task’s UI changes in the task notes once tasks are created.

---

## Out Of Scope

- New server APIs or changes to ingest/agent/chat back-end behavior beyond reusing the existing directory picker endpoint.
- Visual redesigns of navigation, sidebar behavior, or conversation rendering beyond spacing/height adjustments.
- Adding new feature pages or new command/agent functionality.

---

## Questions

None.

## Decisions

- Send/Stop buttons use a fixed width matching the larger label to prevent layout jitter when swapping.
- The info popover shows a friendly empty-state message when no description or warnings are available (e.g., “No description or warnings are available for this agent yet.”).

---

# Implementation Plan

Tasks will be added after the open questions are answered.
