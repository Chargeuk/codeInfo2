# Story 0000024 - Chat bubble metadata and agent steps

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today, chat and agent message bubbles show only the message content. Users have no quick way to see when a message was sent or, for agent replies, how many tokens were consumed. During agent command runs, it is also unclear where the agent is within a multi-step command sequence.

We want each chat and agent message bubble header to show the message date and time (from stored UTC, displayed in local time). For agent replies, the header should also show token usage when available, including input/output/total tokens, with cached input tokens shown separately when provided by the provider. When an agent is executing a multi-step command list, the header should show the current step index and total steps.

---

## Acceptance Criteria

- **Timestamp on every bubble:** Chat and Agents pages show a date + time header on every user and assistant bubble.
- **UTC -> local conversion:** Timestamps are stored as UTC and rendered in the browser’s local time zone (fallback to local Date rendering if explicit conversion is not available).
- **Assistant token usage:** Assistant bubbles show input/output/total token usage when the provider supplies those values, and show cached input tokens separately when provided.
- **Omit when missing:** If a provider does not supply any token usage fields, token usage is not displayed at all.
- **Agent step indicator:** Agent assistant bubbles show “Step X of Y” when the run is executing a multi-step command list; otherwise no step indicator is shown.
- **No regressions:** Existing chat/agent workflows, persistence, and streaming continue to function without UI layout regressions.

---

## Out Of Scope

- Showing token usage on user bubbles.
- Displaying token usage when a provider does not supply any usage data.
- Changing or expanding provider APIs beyond capturing existing usage metadata.
- Redesigning chat/agent layouts outside of header metadata additions.

---

## Questions

- None.

---

## Contracts & Storage Changes (explicit)

- Add optional token usage metadata to assistant turns (input/output/total and cached input when available).
- Add optional agent step metadata (stepIndex/stepCount) on assistant turns originating from command lists.
- All new fields are optional and omitted when values are unavailable.

---

## Research Findings (code-confirmed)

- Added server logging on Codex `turn.completed` events to capture the full event structure (message: `0000024 codex turn.completed event`). Check server logs after a Codex response to confirm the `usage` payload shape.
- Codex SDK typings indicate `usage` should include `input_tokens`, `cached_input_tokens`, and `output_tokens` on `turn.completed` events; logging will validate this in real runs before wiring persistence.

---

# Tasks
 Fill on this section once the story is ready