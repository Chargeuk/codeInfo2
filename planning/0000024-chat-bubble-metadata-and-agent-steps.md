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

- Does the Codex CLI emit `turn.completed` usage for our configured models and MCP-enabled runs in this repo, or do we need additional CLI flags/config to surface usage reliably?
- Does the current `@lmstudio/sdk` version used by the server expose token counts + timing stats for chat/tool runs, and are the field names consistent across tool-calling and non-tooling responses?

---

## Contracts & Storage Changes (explicit)

- Reuse existing `Turn.command` metadata (`name`, `stepIndex`, `totalSteps`) for agent step display (no new schema needed for steps).
- Add optional usage metadata on assistant turns (input/output/total tokens plus cached input when supplied).
- Add optional timing metadata on assistant turns (provider time taken + tokens/sec when available; calculate elapsed time when missing).
- All new fields are optional and omitted when values are unavailable.

---

## Research Findings (code-confirmed)

- `server/src/mongo/turn.ts` already stores `createdAt` timestamps and `command` metadata (`name`, `stepIndex`, `totalSteps`) for turns.
- `server/src/mongo/repo.ts` accepts optional `createdAt` when appending turns, and updates `lastMessageAt` from that timestamp.
- `server/src/chat/inflightRegistry.ts` tracks `userTurn.createdAt` and derives `assistantCreatedAt` for in-flight UI rendering.
- `server/src/chat/interfaces/ChatInterfaceCodex.ts` logs any `usage` payloads found on Codex events and logs full `turn.completed` payloads, but does not persist usage yet.
- `@lmstudio/sdk` defines `LLMPredictionStats` with `tokensPerSecond`, `totalTimeSec`, `promptTokensCount`, `predictedTokensCount`, and `totalTokensCount` (available on `PredictionResult.stats`).

## Research Findings (external docs)

- Codex CLI/SDK event streams expose `turn.completed` events that include a `usage` object with `input_tokens`, `output_tokens`, and `cached_input_tokens` when available.
- LM Studio REST chat/completions responses include `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`) and `stats` (`tokens_per_second`, `generation_time`, `time_to_first_token`).
- Deepwiki does not have an indexed page for this repository yet, so no deepwiki references are available.

---

## Implementation Ideas

- **Server turn metadata:** Extend `server/src/mongo/turn.ts` with optional `usage` and `timing` fields (keep existing `command` metadata for step display). Thread these fields through `server/src/mongo/repo.ts` (`AppendTurnInput`, `TurnSummary`) and `server/src/routes/conversations.ts` (append schema + REST response). Use `createdAt` + run start time to calculate elapsed time when providers omit timing.
- **Provider capture:** In `server/src/chat/interfaces/ChatInterfaceCodex.ts`, capture `event.usage` from `turn.completed` and store it on the assistant turn. In `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, read `PredictionResult.stats` (tokens per second, total time) and token counts to populate usage/timing; ensure the metadata is passed into `ChatInterface.persistAssistantTurn` so it persists.
- **Inflight/WS updates:** Decide whether to surface usage/timing only on persisted turns (REST refresh) or also via WS. If live updates are needed, extend `server/src/ws/types.ts` (`turn_final` payload) and `client/src/hooks/useChatWs.ts` to carry usage/timing so the UI updates without a reload.
- **Client data flow:** Add usage/timing fields to `client/src/hooks/useConversationTurns.ts` (`StoredTurn`) and `client/src/hooks/useChatStream.ts` (`ChatMessage`), mapping REST and WS data into the message model. Ensure `command` is already mapped for step indicators.
- **Bubble rendering:** Update `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx` bubble headers to render: (1) localized timestamp using `Intl.DateTimeFormat`, (2) token usage line only when available, (3) time + rate line when present, and (4) “Step X of Y” when `command` metadata exists. Use MUI `Stack`, `Typography`, and `Tooltip` as needed for layout and hover details.

---
