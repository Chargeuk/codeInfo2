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

We want each chat and agent message bubble header to show the message date and time (from stored UTC, displayed in local time). For agent replies, the header should also show token usage when available, including input/output/total tokens, with cached input tokens shown separately when provided by the provider. Agent replies should also display time taken and tokens-per-second when the provider supplies those stats; if time taken is not provided, it may be calculated from run timing. When an agent is executing a multi-step command list, the header should show the current step index and total steps.

---

## Acceptance Criteria

- **Timestamp on every bubble:** Chat and Agents pages show a date + time header on every user and assistant bubble.
- **Timestamp formatting:** Use `Intl.DateTimeFormat` with `{ dateStyle: 'medium', timeStyle: 'short' }` (example output: “Jan 11, 2026, 2:05 PM”).
- **UTC -> local conversion:** Timestamps are stored as UTC and rendered in the browser’s local time zone via `new Date(utc).toLocaleString(...)` or an equivalent conversion.
- **Assistant token usage (when present):** Assistant bubbles show “Tokens: in <input> · out <output> · total <total>”. If cached input tokens are provided, append “(cached <cachedInput>)”.
- **Timing + rate (when present):** Assistant bubbles show “Time: <seconds>s” when `totalTimeSec` is provided or calculated from run timing; show “Rate: <tokensPerSecond> tok/s” only when supplied by the provider.
- **Omit when missing:** If a provider does not supply any token usage fields, do not render any token usage text. If no timing data exists, do not render time/rate text.
- **Agent step indicator:** Agent assistant bubbles show “Step X of Y” when step metadata (`stepIndex` + `stepCount`) is present; otherwise no step indicator is shown.
- **No regressions:** Existing chat/agent workflows, persistence, and streaming continue to function without UI layout regressions.

---

## Out Of Scope

- Showing token usage on user bubbles.
- Displaying token usage when a provider does not supply any usage data.
- Calculating tokens-per-second when a provider does not supply it.
- Changing or expanding provider APIs beyond capturing existing usage metadata.
- Redesigning chat/agent layouts outside of header metadata additions.

---

## Questions

- None.

---

## Contracts & Storage Changes (explicit)

- Add optional token usage metadata to assistant turns (input/output/total and cached input when available).
- Add optional timing metadata to assistant turns (provider time taken + tokens/sec when available; calculated time when provider does not supply time).
- Add optional agent step metadata (stepIndex/stepCount) on assistant turns originating from command lists.
- All new fields are optional and omitted when values are unavailable.

---

## Research Findings (code-confirmed)

- Added server logging on Codex `turn.completed` events and on any Codex event containing `usage` to capture the full event structure (messages: `0000024 codex turn.completed event`, `0000024 codex usage event`).
- Test run on **January 9, 2026** (conversation `0000024-codex-usage-1767920951`) did **not** emit any usage-bearing events in server logs; Codex usage availability still unconfirmed and must be validated before wiring persistence.
- LM Studio SDK exposes timing + rate stats on `PredictionResult.stats` (`totalTimeSec`, `tokensPerSecond`) alongside token counts; these can be captured when using LM Studio.

---
