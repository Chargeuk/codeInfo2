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

- **Timestamp on every user/assistant bubble:** Chat and Agents pages show a date + time header on every user and assistant bubble (status/error bubbles excluded).
- **Timestamp formatting:** Use `Intl.DateTimeFormat` with `{ dateStyle: 'medium', timeStyle: 'short' }` (example output: “Jan 11, 2026, 2:05 PM”).
- **UTC -> local conversion:** Timestamps are stored as UTC and rendered in the browser’s local time zone via `new Date(utc).toLocaleString(...)` or an equivalent conversion.
- **Timestamp source:** Use persisted `turn.createdAt` for stored turns; for in-flight assistant bubbles, use `inflight.startedAt` until the persisted turn replaces it.
- **Assistant token usage (when present):** Assistant bubbles show “Tokens: in <input> · out <output> · total <total>”. If cached input tokens are provided, append “(cached <cachedInput>)”.
- **Timing + rate (when present):** Assistant bubbles show “Time: <seconds>s” when `totalTimeSec` is provided or calculated from run timing; show “Rate: <tokensPerSecond> tok/s” only when supplied by the provider.
- **Omit when missing:** If a provider does not supply any token usage fields, do not render any token usage text. If no timing data exists, do not render time/rate text.
- **Agent step indicator:** Agent assistant bubbles show “Step X of Y” when step metadata (`stepIndex` + `totalSteps`) is present; otherwise no step indicator is shown.
- **No regressions:** Existing chat/agent workflows, persistence, and streaming continue to function without UI layout regressions.

---

## Out Of Scope

- Showing token usage on user bubbles.
- Displaying token usage when a provider does not supply any usage data.
- Calculating tokens-per-second when a provider does not supply it.
- Changing or expanding provider APIs beyond capturing existing usage metadata.
- Redesigning chat/agent layouts outside of header metadata additions.
- Adding headers to local-only status/error bubbles that do not have persisted timestamps.

---

## Questions

- None.

---

## Contracts & Storage Changes (explicit)

- Reuse existing `Turn.command` metadata (`name`, `stepIndex`, `totalSteps`) for agent step display (no new schema needed for steps).
- Add optional usage metadata on assistant turns only (input/output/total tokens plus cached input when supplied).
- Add optional timing metadata on assistant turns only (provider time taken + tokens/sec when available; calculate elapsed time when missing).
- All new fields are optional and omitted when values are unavailable.

---

## Message Contracts & Storage Shapes (draft)

- **Mongo Turn document (`server/src/mongo/turn.ts`):** add optional `usage` and `timing` objects on assistant turns; keep existing `command` for step metadata.
  - `usage`: `{ inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number }`
    - Map LM Studio SDK `promptTokensCount` → `inputTokens`, `predictedTokensCount` → `outputTokens`, `totalTokensCount` → `totalTokens` (REST uses `prompt_tokens`, `completion_tokens`, `total_tokens`).
    - Map Codex `input_tokens` → `inputTokens`, `output_tokens` → `outputTokens`, `cached_input_tokens` → `cachedInputTokens` (derive `totalTokens` when available).
  - `timing`: `{ totalTimeSec?: number; tokensPerSecond?: number }`
    - Map LM Studio SDK `totalTimeSec` → `totalTimeSec`, `tokensPerSecond` → `tokensPerSecond` (REST uses `generation_time`, `tokens_per_second`).
    - If provider does not supply timing, compute `totalTimeSec` using `inflight.startedAt` → assistant turn `createdAt`.
- **REST append turn (`POST /conversations/:id/turns`):** extend request schema to accept optional `usage` + `timing` (no changes for user turns).
- **REST turn snapshots (`GET /conversations/:id/turns`):** include `usage` + `timing` on returned assistant turn items when stored; continue returning `command` when present.
- **WebSocket updates (`turn_final`):** include `usage` + `timing` so live UI can render without waiting for a refresh; continue relying on persisted turns for history.
- **Inflight snapshot:** no new fields required on `inflight_snapshot`; the UI uses `inflight.startedAt` for temporary timestamps until persisted turns arrive.

---

## Research Findings (code-confirmed)

- `server/src/mongo/turn.ts` already stores `createdAt` timestamps and `command` metadata (`name`, `stepIndex`, `totalSteps`) for turns.
- `server/src/mongo/repo.ts` accepts optional `createdAt` when appending turns, and updates `lastMessageAt` from that timestamp.
- `server/src/chat/inflightRegistry.ts` tracks `userTurn.createdAt` and derives `assistantCreatedAt` for in-flight UI rendering.
- `server/src/chat/interfaces/ChatInterfaceCodex.ts` logs any `usage` payloads found on Codex events and logs full `turn.completed` payloads, but does not persist usage yet.
- `server/src/chat/interfaces/ChatInterface.ts` currently emits `complete` without usage/timing metadata and `chatStreamBridge` publishes `turn_final` without usage/timing; both need extension to carry the new metadata.
- `@lmstudio/sdk` exposes `PredictionResult.stats` on the `OngoingPrediction` result (via `prediction.result()`), which includes `tokensPerSecond`, `totalTimeSec`, and token counts.
- `@lmstudio/sdk` defines `LLMPredictionStats` with `tokensPerSecond`, `totalTimeSec`, `promptTokensCount`, `predictedTokensCount`, and `totalTokensCount` (available on `PredictionResult.stats`).
- Client has existing timestamp helpers: `formatTimestamp` in `client/src/components/chat/ConversationList.tsx` (guards missing values) and `client/src/pages/LogsPage.tsx` (uses `Intl.DateTimeFormat`). Reuse these patterns for bubble headers.
- Dependency versions in this repo: React `^19.2.0`, `@mui/material` `^6.4.1`, Zod `3.25.76`, Mongoose `9.0.1`, `ws` `8.18.3`, `@openai/codex-sdk` `0.64.0`, `@lmstudio/sdk` `1.5.0`.
- MUI docs for 6.4.x are available via the MUI MCP server (6.4.12) and should be used for Stack/Typography/Tooltip guidance.

## Research Findings (external docs)

- Codex docs show `turn.completed` events include `usage` with `input_tokens`, `cached_input_tokens`, and `output_tokens` (example in non-interactive mode docs).
- Codex SDK docs describe the TypeScript SDK usage and thread handling; they specify Node 18+ for server-side use.
- LM Studio SDK README (npm) documents accessing prediction stats via awaiting the prediction and reading `.stats` (tokens/sec, time to first token, token counts).
- Mongoose subdocument docs reiterate that subdocument defaults are not applied when undefined; avoid defaults for optional metadata fields.
- Public MUI docs default to v7; use the MUI MCP 6.4.x pages for Stack/Typography/Tooltip.
- Deepwiki is not indexed for `lmstudio-ai/lmstudio-sdk`; use npm + installed types for that SDK.

---

## Implementation Ideas

- **Server turn metadata:** Extend `server/src/mongo/turn.ts` with optional `usage` and `timing` fields (keep existing `command` metadata for step display). Thread these fields through `server/src/mongo/repo.ts` (`AppendTurnInput`, `TurnSummary`) and `server/src/routes/conversations.ts` (append schema + REST response). Use `createdAt` + run start time to calculate elapsed time when providers omit timing.
- **Provider capture:** In `server/src/chat/interfaces/ChatInterfaceCodex.ts`, capture `event.usage` from `turn.completed` and store it on the assistant turn. In `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, read `PredictionResult.stats` (tokens per second, total time) and token counts to populate usage/timing; ensure the metadata is passed into `ChatInterface.persistAssistantTurn` so it persists.
- **Inflight/WS updates:** Extend `server/src/ws/types.ts` (`turn_final` payload) and `client/src/hooks/useChatWs.ts` to carry usage/timing so the UI updates immediately after a streamed response completes (no manual refresh needed).
- **Client data flow:** Add usage/timing fields to `client/src/hooks/useConversationTurns.ts` (`StoredTurn`) and `client/src/hooks/useChatStream.ts` (`ChatMessage`), mapping REST and WS data into the message model. Ensure `command` is already mapped for step indicators.
- **Bubble rendering:** Update `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx` bubble headers to render: (1) localized timestamp using `Intl.DateTimeFormat` (use `inflight.startedAt` for in-flight assistant bubbles), (2) token usage line only when available, (3) time + rate line when present, and (4) “Step X of Y” when `command` metadata exists. Use MUI `Stack`, `Typography`, and `Tooltip` as needed for layout and hover details.

---

## Edge Cases and Failure Modes

- **Missing or invalid timestamps:** If `createdAt` or `inflight.startedAt` is missing or unparsable, fall back to `new Date()` and render the timestamp without crashing.
- **Partial usage data:** If only some usage fields are present (e.g., no cached input tokens), render only the available values and omit the cached suffix.
- **Zero/NaN timing values:** If `totalTimeSec` or `tokensPerSecond` is `0`, `NaN`, or non-finite, omit the affected line instead of showing invalid values.
- **No usage/timing from provider:** For providers that omit usage/timing, ensure bubbles render only the timestamp and content (no empty metadata rows).
- **WS ordering vs REST refresh:** When a `turn_final` WS event arrives before the persisted turn is visible in REST, prefer the WS metadata for the active bubble and replace it once the persisted turn arrives.
- **Command metadata absent for agents:** If an agent run does not include `command` metadata (single instructions or manual runs), do not render “Step X of Y”.
- **Archived conversations:** If a conversation is archived while a turn is in-flight, ensure the UI does not crash and metadata rendering gracefully stops when the run is cancelled.

---

## Tasks

### 1. Server: persist usage/timing metadata on assistant turns (REST + storage)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend the server’s stored turn shape to include optional usage and timing metadata for assistant turns, and expose those fields through the REST turn append/snapshot routes. This task is focused on persistence and API contracts only; provider capture happens in the next task.

#### Documentation Locations

- Mongoose 9.0.1 schema + subdocs (optional subdocuments, defaults only apply when undefined): Context7 `/automattic/mongoose/9.0.1`
- Zod v3 schema validation (optional objects + `superRefine` for assistant-only metadata): Context7 `/websites/v3_zod_dev`
- Express 5 API `res.json` (JSON response shaping for REST routes): https://expressjs.com/en/api.html#res.json
- Node.js test runner `node:test` (integration test structure and assertions): https://nodejs.org/api/test.html
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current turn persistence and REST payload shapes:
   - Documentation to read (repeat):
     - Mongoose 9.0.1 schema types: Context7 `/automattic/mongoose/9.0.1`
     - Zod v3 schema validation: Context7 `/websites/v3_zod_dev`
     - Express response basics: https://expressjs.com/en/api.html#res.json
   - Recap (acceptance criteria): timestamps remain from persisted `turn.createdAt`, and assistant-only metadata is optional.
   - Files to read:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/routes/conversations.ts`
     - `server/src/test/integration/conversations.turns.test.ts`
   - Goal:
     - Confirm how `createdAt` and `command` metadata are stored and returned today.

2. [ ] Add usage/timing fields to the Turn schema + types:
   - Documentation to read (repeat):
     - Mongoose 9.0.1 schema types: Context7 `/automattic/mongoose/9.0.1`
     - Zod v3 schema validation: Context7 `/websites/v3_zod_dev`
   - Recap (acceptance criteria): store usage/timing only for assistant turns; omit when values are missing.
   - Files to edit:
     - `server/src/mongo/turn.ts`
   - Requirements:
     - Add optional `usage` object with `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens` numeric fields.
     - Add optional `timing` object with `totalTimeSec`, `tokensPerSecond` numeric fields.
     - Do not add defaults; store only when data exists.
     - Keep `command` metadata unchanged for agent step display.
     - Ensure these fields are optional and safe for non-assistant turns.

3. [ ] Thread usage/timing through repo types and append helpers:
   - Documentation to read (repeat):
     - Mongoose 9.0.1 schema types: Context7 `/automattic/mongoose/9.0.1`
     - Zod v3 schema validation: Context7 `/websites/v3_zod_dev`
   - Recap (acceptance criteria): REST turn snapshots must return usage/timing only when stored.
   - Files to edit:
     - `server/src/mongo/repo.ts` (AppendTurnInput + TurnSummary)
     - `server/src/chat/interfaces/ChatInterface.ts` (persistAssistantTurn payload)
   - Requirements:
     - Accept optional `usage`/`timing` only for assistant turns in the append schema.
     - Ensure `persistAssistantTurn` can pass usage/timing into `appendTurn` and memory persistence.
     - Return `usage`/`timing` in `GET /conversations/:id/turns` when stored.
     - Omit fields (not `null`) when values are missing.

4. [ ] Extend REST turn schemas to accept usage/timing safely:
   - Documentation to read (repeat):
     - Zod v3 schema validation: Context7 `/websites/v3_zod_dev`
     - Express response basics: https://expressjs.com/en/api.html#res.json
   - Recap (acceptance criteria): user turns must ignore usage/timing; assistant-only validation required.
   - Files to edit:
     - `server/src/routes/conversations.ts`
   - Requirements:
     - Add `usage` + `timing` to `appendTurnSchema`.
     - Enforce that `usage`/`timing` is only accepted when `role === 'assistant'` (use Zod `superRefine` or equivalent v3 pattern).

5. [ ] Integration test (server): assistant POST accepts usage/timing
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Exercise `POST /conversations/:id/turns` with an assistant payload containing usage/timing.
   - Purpose: Ensure `POST /conversations/:id/turns` accepts assistant usage/timing metadata.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Express response basics: https://expressjs.com/en/api.html#res.json

6. [ ] Integration test (server): GET returns usage/timing fields
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Fetch turns after persistence and inspect usage/timing fields on assistant items.
   - Purpose: Ensure `GET /conversations/:id/turns` returns stored usage/timing intact.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Express response basics: https://expressjs.com/en/api.html#res.json

7. [ ] Integration test (server): user POST rejects usage/timing
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Submit a user-role payload with usage/timing fields.
   - Purpose: Ensure user turns with usage/timing are rejected (400) by validation.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Express response basics: https://expressjs.com/en/api.html#res.json

8. [ ] Integration test (server): assistant without metadata omits fields
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Persist an assistant turn without usage/timing and verify response shape.
   - Purpose: Ensure assistant turns without usage/timing omit the fields (no `null`).
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Express response basics: https://expressjs.com/en/api.html#res.json

9. [ ] Documentation update - `README.md` (if any user-facing changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap (acceptance criteria): note any user-visible metadata additions if surfaced.
   - Document location:
     - `README.md`

10. [ ] Documentation update - `design.md` (document new turn metadata fields):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap (acceptance criteria): document assistant-only `usage`/`timing` fields and optionality.
   - Document location:
     - `design.md`

11. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if files move or new files added.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document location:
     - `projectStructure.md`

12. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/en/
   - Recap: run from repo root; fix issues before proceeding.
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, run `npm run lint:fix` / `npm run format --workspaces` and resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 2. Server: propagate usage/timing through chat events

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend the core chat event pipeline so usage/timing metadata can flow from provider adapters into persistence and downstream consumers. This task focuses on ChatInterface state/event shapes and run-time timing capture.

#### Documentation Locations

- OpenAI Codex SDK overview (thread/run API + Node requirements): https://developers.openai.com/codex/sdk/
- LM Studio SDK docs (prediction flow + client usage): https://lmstudio.ai/docs/api/sdk
- LM Studio npm README (install + API surface reference): https://www.npmjs.com/package/@lmstudio/sdk
- Node.js EventEmitter (event emission/handling semantics): https://nodejs.org/api/events.html
- Node.js test runner `node:test` (unit test structure): https://nodejs.org/api/test.html
- Mermaid docs (sequence/flow diagrams for chat pipeline changes): Context7 `/mermaid-js/mermaid`
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review ChatInterface + stream bridge event flow:
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
     - Node.js EventEmitter: https://nodejs.org/api/events.html
   - Recap (acceptance criteria): completion events must eventually carry assistant usage/timing.
   - Files to read:
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/test/unit/chat-interface-run-persistence.test.ts`
     - `node_modules/@openai/codex-sdk/dist/index.d.ts`
     - `node_modules/@lmstudio/sdk/dist/index.d.ts`

2. [ ] Extend chat event types to include usage/timing:
   - Documentation to read (repeat):
     - Node.js EventEmitter: https://nodejs.org/api/events.html
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
   - Recap (acceptance criteria): usage/timing optional; assistant-only; omit when missing.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Requirements:
     - Add optional `usage` + `timing` on the completion event (or introduce a new event type).
     - Capture a run start timestamp in `run()` for fallback timing.
     - Store latest usage/timing in `run()` so `persistAssistantTurn` can consume it.

3. [ ] Pass usage/timing into assistant persistence:
   - Documentation to read (repeat):
     - Node.js EventEmitter: https://nodejs.org/api/events.html
   - Recap (acceptance criteria): stored turns must include usage/timing when present.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Requirements:
     - Include usage/timing when calling `persistAssistantTurn`.
     - Ensure memory persistence stores the same optional fields.

4. [ ] Unit test (server): persist usage/timing when provided
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`
   - Description: Simulate a completion event with usage/timing and verify persisted turn data.
   - Purpose: Ensure assistant turns store usage/timing from completion events.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Node.js EventEmitter: https://nodejs.org/api/events.html

5. [ ] Unit test (server): omit usage/timing when missing
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`
   - Description: Simulate a completion event without usage/timing metadata.
   - Purpose: Ensure assistant turns omit usage/timing when completion provides none.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Node.js EventEmitter: https://nodejs.org/api/events.html

6. [ ] Unit test (server): fallback timing uses run start
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`
   - Description: Run a completion path without provider timing and inspect elapsed time.
   - Purpose: Ensure fallback `totalTimeSec` uses run start timestamp when provider timing is absent.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Node.js EventEmitter: https://nodejs.org/api/events.html

7. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any new metadata behavior that affects users.
   - Document location:
     - `README.md`

8. [ ] Documentation update - `design.md` (document chat event metadata flow + diagrams):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Recap: document where usage/timing flows through ChatInterface events and update any relevant mermaid flow/sequence diagrams.
   - Document location:
     - `design.md`

9. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document location:
     - `projectStructure.md`

10. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/en/
   - Recap: run from repo root after changes and fix any issues.
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, run `npm run lint:fix` / `npm run format --workspaces` and resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 3. Server: capture Codex usage metadata

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Capture usage metadata from Codex `turn.completed` events and feed it into the shared chat usage/timing pipeline.

#### Documentation Locations

- OpenAI Codex non-interactive event docs (usage on `turn.completed`): https://developers.openai.com/codex/noninteractive/
- OpenAI Codex SDK overview (client APIs + event payload structure): https://developers.openai.com/codex/sdk/
- Node.js test runner `node:test` (unit + integration tests): https://nodejs.org/api/test.html
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review Codex event handling and SDK types:
   - Documentation to read (repeat):
     - OpenAI Codex non-interactive event docs (turn.completed usage): https://developers.openai.com/codex/noninteractive/
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
   - Recap (acceptance criteria): capture assistant usage tokens when provider supplies them.
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `node_modules/@openai/codex-sdk/dist/index.d.ts`
     - `server/src/test/unit/chat-interface-codex.test.ts`

2. [ ] Capture `turn.completed` usage and forward it:
   - Documentation to read (repeat):
     - OpenAI Codex non-interactive event docs (turn.completed usage): https://developers.openai.com/codex/noninteractive/
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
   - Recap (acceptance criteria): map `input_tokens`, `output_tokens`, and `cached_input_tokens` into stored usage fields.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Requirements:
     - Map `input_tokens`, `cached_input_tokens`, `output_tokens` into stored usage fields.
     - Derive `totalTokens` when Codex omits it.

3. [ ] Unit test (server): Codex usage persisted
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-codex.test.ts`
   - Description: Feed a Codex `turn.completed` event with usage payload into the adapter.
   - Purpose: Ensure assistant turns persist Codex usage metadata.
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

4. [ ] Unit test (server): missing cached input tokens handled
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-codex.test.ts`
   - Description: Provide usage without `cached_input_tokens` and verify mapping.
   - Purpose: Ensure missing `cached_input_tokens` does not block usage capture.
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

5. [ ] Unit test (server): derive totalTokens when omitted
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-codex.test.ts`
   - Description: Provide usage with input/output only and verify derived total.
   - Purpose: Ensure `totalTokens` is derived when Codex omits it.
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

6. [ ] Integration test (server): Codex usage persists end-to-end
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/chat-codex.test.ts`
   - Description: Run a Codex chat flow and inspect persisted assistant turns.
   - Purpose: Ensure assistant turns persist usage metadata via Codex run flow.
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

7. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any user-visible token usage behavior if needed.
   - Document location:
     - `README.md`

8. [ ] Documentation update - `design.md` (document Codex usage capture):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document where Codex usage is captured and stored.
   - Document location:
     - `design.md`

9. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document location:
     - `projectStructure.md`

10. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/en/
   - Recap: run from repo root and fix issues before moving on.
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, run `npm run lint:fix` / `npm run format --workspaces` and resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 4. Server: capture LM Studio prediction stats

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Capture LM Studio prediction stats and feed them into the shared chat usage/timing pipeline.

#### Documentation Locations

- LM Studio SDK docs (prediction flow + client API): https://lmstudio.ai/docs/api/sdk
- LM Studio npm README (install + API surface reference): https://www.npmjs.com/package/@lmstudio/sdk
- Node.js test runner `node:test` (integration test structure): https://nodejs.org/api/test.html
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review LM Studio prediction flow and SDK types:
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
   - Recap (acceptance criteria): capture timing and usage when provided by the LM Studio SDK.
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
     - `node_modules/@lmstudio/sdk/dist/index.d.ts`
     - `server/src/test/integration/chat-assistant-persistence.test.ts`

2. [ ] Capture prediction stats and forward them:
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
   - Recap (acceptance criteria): map prompt/predicted/total tokens plus total time + tokens/sec when supplied.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
   - Requirements:
     - Use `prediction.result()` or `onPredictionCompleted` to access `PredictionResult.stats`.
     - Map stats to usage/timing fields (prompt/predicted/total tokens; totalTimeSec/tokensPerSecond).
     - Fall back to run timing when stats are missing.

3. [ ] Integration test (server): LM Studio usage/timing persisted
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/chat-assistant-persistence.test.ts`
   - Description: Use an LM Studio completion with stats and verify stored metadata.
   - Purpose: Ensure assistant turns persist LM Studio usage/timing metadata when stats exist.
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

4. [ ] Integration test (server): fallback total time when stats missing
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/chat-assistant-persistence.test.ts`
   - Description: Run an LM Studio completion without stats and inspect timing output.
   - Purpose: Ensure missing prediction stats still store elapsed `totalTimeSec` from run timing.
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

5. [ ] Integration test (server): omit tokensPerSecond when absent
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/chat-assistant-persistence.test.ts`
   - Description: Provide stats lacking tokens/sec and verify omission.
   - Purpose: Ensure `tokensPerSecond` is omitted when stats do not include it.
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

6. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any user-visible metadata additions.
   - Document location:
     - `README.md`

7. [ ] Documentation update - `design.md` (document LM Studio stats capture):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document where LM Studio stats are read and stored.
   - Document location:
     - `design.md`

8. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document location:
     - `projectStructure.md`

9. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/en/
   - Recap: run from repo root and fix issues before moving on.
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, run `npm run lint:fix` / `npm run format --workspaces` and resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 5. Server: extend WS `turn_final` payload with usage/timing

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Expose usage/timing metadata on the WS `turn_final` payload so clients can render metadata immediately after streaming completes.

#### Documentation Locations

- `ws` 8.18.3 server API (send/receive JSON payloads): Context7 `/websockets/ws/8_18_3`
- Node.js test runner `node:test` (unit test structure): https://nodejs.org/api/test.html
- Mermaid docs (sequence diagram updates for WS payloads): Context7 `/mermaid-js/mermaid`
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review WS type definitions and publish flow:
   - Documentation to read (repeat):
     - `ws` 8.18.3 server API: Context7 `/websockets/ws/8_18_3`
   - Recap (acceptance criteria): `turn_final` must include usage/timing when available.
   - Files to read:
     - `server/src/ws/types.ts`
     - `server/src/ws/server.ts`
     - `server/src/chat/chatStreamBridge.ts`

2. [ ] Extend `turn_final` payload to include usage/timing:
   - Documentation to read (repeat):
     - `ws` 8.18.3 server API: Context7 `/websockets/ws/8_18_3`
   - Recap (acceptance criteria): include usage/timing only when present; omit when missing.
   - Files to edit:
     - `server/src/ws/types.ts`
     - `server/src/ws/server.ts`
     - `server/src/chat/chatStreamBridge.ts`
   - Requirements:
     - Add optional `usage` + `timing` on `WsTurnFinalEvent`.
     - Pass usage/timing from the completion event into `publishTurnFinal`.

3. [ ] Unit test (server): `turn_final` includes usage/timing
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/ws-chat-stream.test.ts`
   - Description: Publish a completion event with usage/timing and assert payload fields.
   - Purpose: Ensure usage/timing fields survive WS publish when provided.
   - Documentation to read (repeat):
     - `ws` 8.18.3 server API: Context7 `/websockets/ws/8_18_3`
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

4. [ ] Unit test (server): `turn_final` omits metadata when missing
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/ws-server.test.ts`
   - Description: Publish a completion event without usage/timing and verify omission.
   - Purpose: Ensure `turn_final` omits usage/timing when completion has none.
   - Documentation to read (repeat):
     - `ws` 8.18.3 server API: Context7 `/websockets/ws/8_18_3`
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

5. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out WS metadata if user-visible.
   - Document location:
     - `README.md`

6. [ ] Documentation update - `design.md` (document WS payload changes + diagrams):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Recap: document `turn_final` payload shape, usage/timing fields, and update any WS sequence diagrams.
   - Document location:
     - `design.md`

7. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document location:
     - `projectStructure.md`

8. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/en/
   - Recap: run from repo root and fix issues before moving on.
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, run `npm run lint:fix` / `npm run format --workspaces` and resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 6. Client: map REST usage/timing into stored turns

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend the REST turn snapshot mapping to include usage/timing fields in stored turns.

#### Documentation Locations

- TypeScript handbook (object types + optional properties): https://www.typescriptlang.org/docs/handbook/2/objects.html
- React Testing Library (hook tests + render utilities): https://testing-library.com/docs/react-testing-library/intro/
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review stored-turn mapping:
   - Documentation to read (repeat):
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/
   - Recap (acceptance criteria): REST turns must include usage/timing when stored.
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/test/useConversationTurns.commandMetadata.test.ts`

2. [ ] Extend StoredTurn to include usage/timing:
   - Documentation to read (repeat):
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
   - Recap (acceptance criteria): keep fields optional; assistant-only; omit when missing.
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Requirements:
     - Add optional `usage` + `timing` fields, including `cachedInputTokens`.
     - Map REST response fields into the new shape without breaking existing consumers.

3. [ ] Hook test (client): REST turns retain usage/timing
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Description: Mock REST response with usage/timing and verify stored turn shape.
   - Purpose: Ensure stored turns retain usage/timing fields from REST.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

4. [ ] Hook test (client): REST turns omit missing metadata
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Description: Mock REST response without usage/timing and verify no defaults.
   - Purpose: Ensure turns without usage/timing do not get defaulted fields.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

5. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any user-visible metadata changes if needed.
   - Document location:
     - `README.md`

6. [ ] Documentation update - `design.md` (document REST turn mapping changes):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document client mapping for usage/timing fields.
   - Document location:
     - `design.md`

7. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Document location:
     - `projectStructure.md`

8. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/en/
   - Recap: run from repo root and fix issues before moving on.
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, run `npm run lint:fix` / `npm run format --workspaces` and resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 7. Client: map WS usage/timing into stream state

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend the WS transcript event mapping so usage/timing fields land on streaming assistant messages.

#### Documentation Locations

- WebSocket browser API (message event + JSON handling): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- TypeScript handbook (object types + optional properties): https://www.typescriptlang.org/docs/handbook/2/objects.html
- React Testing Library (hook tests + render utilities): https://testing-library.com/docs/react-testing-library/intro/
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- Mermaid docs (client WS flow updates): Context7 `/mermaid-js/mermaid`
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review WS transcript mapping:
   - Documentation to read (repeat):
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/
   - Recap (acceptance criteria): `turn_final` should deliver usage/timing to streaming UI.
   - Files to read:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/support/mockChatWs.ts`
     - `common/src/fixtures/chatStream.ts`

2. [ ] Extend WS event types and message updates:
   - Documentation to read (repeat):
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
   - Recap (acceptance criteria): in-flight assistant bubble uses `inflight.startedAt` for timestamps.
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Add optional `usage` + `timing` to `turn_final` event handling.
     - When hydrating an inflight snapshot, update the assistant bubble timestamp to `inflight.startedAt`.

3. [ ] Update fixtures + WS mocks:
   - Documentation to read (repeat):
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Recap (acceptance criteria): fixtures should include usage/timing when present.
   - Files to edit:
     - `common/src/fixtures/chatStream.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Requirements:
     - Add representative usage/timing fields to `chatWsTurnFinalFixture` and mock events.

4. [ ] Hook test (client): WS preserves usage/timing
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Emit `turn_final` with usage/timing and inspect message state.
   - Purpose: Ensure `turn_final` usage/timing metadata is preserved on streamed assistant messages.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

5. [ ] Hook test (client): WS omits missing metadata
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Emit `turn_final` without usage/timing and verify no empty fields.
   - Purpose: Ensure `turn_final` without usage/timing does not add empty metadata fields.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

6. [ ] Hook test (client): inflight uses startedAt timestamp
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Hydrate an inflight snapshot and confirm timestamp uses `inflight.startedAt`.
   - Purpose: Ensure inflight snapshot uses `inflight.startedAt` for assistant timestamp.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

7. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any user-visible metadata changes if needed.
   - Document location:
     - `README.md`

8. [ ] Documentation update - `design.md` (document WS mapping changes + diagrams):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Recap: document client WS mapping of usage/timing and update any relevant mermaid sequence diagrams.
   - Document location:
     - `design.md`

9. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document location:
     - `projectStructure.md`

10. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/en/
   - Recap: run from repo root and fix issues before moving on.
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, run `npm run lint:fix` / `npm run format --workspaces` and resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 8. Client: render bubble header metadata (Chat + Agents)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Render message header metadata for user/assistant bubbles in Chat and Agents: timestamps, token usage, timing, and agent step indicators. This task only touches UI rendering; it relies on the metadata populated in earlier server/client tasks.

#### Documentation Locations

- MUI Stack (layout + spacing for header rows): https://llms.mui.com/material-ui/6.4.12/components/stack.md
- MUI Typography (text variants + inline metadata): https://llms.mui.com/material-ui/6.4.12/components/typography.md
- MUI Tooltip (hover details for tokens/time when needed): https://llms.mui.com/material-ui/6.4.12/components/tooltips.md
- `Intl.DateTimeFormat` (dateStyle/timeStyle formatting): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
- React Testing Library (component tests + queries): https://testing-library.com/docs/react-testing-library/intro/
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing bubble rendering for Chat and Agents:
   - Documentation to read (repeat):
     - MUI Stack: https://llms.mui.com/material-ui/6.4.12/components/stack.md
     - MUI Typography: https://llms.mui.com/material-ui/6.4.12/components/typography.md
     - MUI Tooltip: https://llms.mui.com/material-ui/6.4.12/components/tooltips.md
     - `Intl.DateTimeFormat`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
   - Recap (acceptance criteria): render timestamp for every user/assistant bubble.
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/chat/ConversationList.tsx` (for style patterns, if needed)

2. [ ] Add timestamp formatting helpers and fallback handling:
   - Documentation to read (repeat):
     - MUI Stack: https://llms.mui.com/material-ui/6.4.12/components/stack.md
     - MUI Typography: https://llms.mui.com/material-ui/6.4.12/components/typography.md
     - `Intl.DateTimeFormat`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
   - Recap (acceptance criteria): use `{ dateStyle: 'medium', timeStyle: 'short' }`, local time.
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Files to reference:
     - `client/src/components/chat/ConversationList.tsx` (guarded timestamp helper)
     - `client/src/pages/LogsPage.tsx` (`Intl.DateTimeFormat` usage pattern)
   - Requirements:
     - Use `{ dateStyle: 'medium', timeStyle: 'short' }`.
     - For in-flight assistant bubbles, use `inflight.startedAt` until persisted turns arrive.
     - Fallback to `new Date()` when timestamps are invalid.
     - Use MUI 6.4.x docs (via MUI MCP) for Stack/Typography/Tooltip usage rather than the v7 public docs.

3. [ ] Render metadata rows for assistant bubbles:
   - Documentation to read (repeat):
     - MUI Stack: https://llms.mui.com/material-ui/6.4.12/components/stack.md
     - MUI Typography: https://llms.mui.com/material-ui/6.4.12/components/typography.md
     - MUI Tooltip: https://llms.mui.com/material-ui/6.4.12/components/tooltips.md
   - Recap (acceptance criteria): show tokens/time/step only when values exist.
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Show token usage only when present; include cached input token suffix.
     - Show timing and tokens-per-second only when provided and finite.
     - Show “Step X of Y” for agent bubbles when `command.stepIndex` + `command.totalSteps` exist.
     - Do not render metadata for status/error bubbles.

4. [ ] Component test (client): ChatPage shows timestamp + tokens
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/chatPage.stream.test.tsx`
   - Description: Render ChatPage with an assistant turn containing usage/timing metadata.
   - Purpose: Ensure ChatPage assistant bubbles show timestamp + token usage when provided.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

5. [ ] Component test (client): AgentsPage shows timestamp + tokens
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/agentsPage.streaming.test.tsx`
   - Description: Render AgentsPage with an assistant turn containing usage/timing metadata.
   - Purpose: Ensure AgentsPage assistant bubbles show timestamp + token usage when provided.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

6. [ ] Component test (client): omit metadata rows for status/error
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/chatPage.stream.test.tsx`
   - Description: Render status/error bubbles and assert metadata rows are absent.
   - Purpose: Ensure status/error bubbles do not render metadata rows.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

7. [ ] Component test (client): step indicator conditional
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/agentsPage.streaming.test.tsx`
   - Description: Provide agent command metadata with and without step counts.
   - Purpose: Ensure “Step X of Y” renders only when `stepIndex` + `totalSteps` exist.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

8. [ ] Component test (client): omit timing/rate when missing
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/chatPage.stream.test.tsx`
   - Description: Provide assistant turns without timing/tokens-per-second fields.
   - Purpose: Ensure timing/rate rows are omitted when timing fields are missing or non-finite.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

9. [ ] Documentation update - `README.md` (if any user-facing changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any new metadata visible to users.
   - Document location:
     - `README.md`

10. [ ] Documentation update - `design.md` (document bubble metadata UI behavior):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document UI rules for timestamps, tokens, timing, and steps.
   - Document location:
     - `design.md`

11. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document location:
     - `projectStructure.md`

12. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/en/
   - Recap: run from repo root and fix issues before moving on.
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`
   - If either fails, run `npm run lint:fix` / `npm run format --workspaces` and resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run e2e`
7. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 9. Final verification + documentation + PR summary

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Validate the full story against acceptance criteria, perform clean builds/tests, update all required documentation, and produce the pull request summary for the story.

#### Documentation Locations

- Docker Compose guide (clean builds + compose up/down): https://docs.docker.com/guides/docker-compose/
- Playwright Test docs (Node/TS setup + running tests): https://playwright.dev/docs/intro
- Husky docs (git hook management + install): https://typicode.github.io/husky/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Cucumber guide (JS 10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Build the server
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Recap: confirm server build works outside Docker before final verification.
2. [ ] Build the client
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Recap: confirm client build works outside Docker before final verification.
3. [ ] Perform a clean docker build
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Recap: clean build must succeed to validate images.
4. [ ] Ensure `README.md` is updated with any required description changes and with any new commands that have been added as part of this story
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document user-visible metadata changes and any new commands.
5. [ ] Ensure `design.md` is updated with any required description changes including Mermaid diagrams that have been added as part of this story
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: ensure diagrams reflect new metadata flow if updated.
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths changed.
   - Ordering: complete this after any subtask that adds/removes files.
7. [ ] Create a summary of all changes within this story and generate the pull request comment (must cover all tasks)
   - Documentation to read (repeat):
     - Husky: Context7 `/typicode/husky`
   - Recap: summary must cover all tasks and mention any workflow changes.

#### Testing

1. [ ] Run the client Jest tests
2. [ ] Run the server Cucumber tests
3. [ ] Restart the docker environment
4. [ ] Run the e2e tests
5. [ ] Use the Playwright MCP tool to manually check the application, saving screenshots to `./test-results/screenshots/` (name: `0000024-9-<short-name>.png`)

#### Implementation notes

- Notes added during implementation.

---
