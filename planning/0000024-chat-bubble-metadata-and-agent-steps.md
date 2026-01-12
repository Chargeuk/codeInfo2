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
- Expose `command` step metadata on inflight snapshots (`inflight_snapshot` + REST `inflight`) so step indicators are available during streaming.
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
- **Inflight snapshot:** add optional `command` metadata (`name`, `stepIndex`, `totalSteps`) on `inflight_snapshot` and REST `inflight` payloads so the UI can show “Step X of Y” while streaming; continue using `inflight.startedAt` for temporary timestamps until persisted turns arrive.

---

## Research Findings (code-confirmed)

- `server/src/mongo/turn.ts` already stores `createdAt` timestamps and `command` metadata (`name`, `stepIndex`, `totalSteps`) for turns.
- `server/src/mongo/repo.ts` accepts optional `createdAt` when appending turns, and updates `lastMessageAt` from that timestamp.
- `server/src/chat/inflightRegistry.ts` tracks `userTurn.createdAt` and derives `assistantCreatedAt` for in-flight UI rendering.
- `server/src/chat/inflightRegistry.ts` and `server/src/ws/types.ts` currently do **not** include `command` metadata in `snapshotInflight` or `WsInflightSnapshotEvent`, so step metadata is unavailable during streaming.
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
- **Inflight/WS updates:** Extend `server/src/chat/inflightRegistry.ts` + `server/src/ws/types.ts` to include optional `command` metadata in inflight snapshots, and extend `turn_final` payloads with usage/timing. Mirror these additions in `client/src/hooks/useChatWs.ts` so the UI can render step indicators and usage immediately after streamed responses complete.
- **Client data flow:** Add usage/timing fields to `client/src/hooks/useConversationTurns.ts` (`StoredTurn`) and `client/src/hooks/useChatStream.ts` (`ChatMessage`), mapping REST and WS data into the message model. Also map `command` from inflight snapshots so step indicators render during streaming.
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

- Task Status: **__done__**
- Git Commits: **03e756a, 378fe9b, 5f65561, 8fa48a0, cc6a8b5**

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

1. [x] Review current turn persistence and REST payload shapes:
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

2. [x] Add usage/timing fields to the Turn schema + types:
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
     - Example (stored assistant turn fields):
       - `usage: { inputTokens: 120, outputTokens: 48, totalTokens: 168, cachedInputTokens: 32 }`
       - `timing: { totalTimeSec: 1.42, tokensPerSecond: 118 }`

3. [x] Thread usage/timing through repo types and append helpers:
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
     - Example (assistant append payload):
       - `{ role: 'assistant', content: '...', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, timing: { totalTimeSec: 0.4 } }`

4. [x] Extend REST turn schemas to accept usage/timing safely:
   - Documentation to read (repeat):
     - Zod v3 schema validation: Context7 `/websites/v3_zod_dev`
     - Express response basics: https://expressjs.com/en/api.html#res.json
   - Recap (acceptance criteria): user turns must ignore usage/timing; assistant-only validation required.
   - Files to edit:
     - `server/src/routes/conversations.ts`
   - Requirements:
     - Add `usage` + `timing` to `appendTurnSchema`.
     - Enforce that `usage`/`timing` is only accepted when `role === 'assistant'` (use Zod `superRefine` or equivalent v3 pattern).
     - Example (valid assistant request):
       - `{ role: 'assistant', content: 'Hi', usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } }`

5. [x] Integration test (server): assistant POST accepts usage/timing
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Exercise `POST /conversations/:id/turns` with an assistant payload containing usage/timing.
   - Purpose: Ensure `POST /conversations/:id/turns` accepts assistant usage/timing metadata.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Express response basics: https://expressjs.com/en/api.html#res.json

6. [x] Integration test (server): GET returns usage/timing fields
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Fetch turns after persistence and inspect usage/timing fields on assistant items.
   - Purpose: Ensure `GET /conversations/:id/turns` returns stored usage/timing intact.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Express response basics: https://expressjs.com/en/api.html#res.json

7. [x] Integration test (server): user POST rejects usage/timing
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Submit a user-role payload with usage/timing fields.
   - Purpose: Ensure user turns with usage/timing are rejected (400) by validation.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Express response basics: https://expressjs.com/en/api.html#res.json

8. [x] Integration test (server): assistant without metadata omits fields
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Persist an assistant turn without usage/timing and verify response shape.
   - Purpose: Ensure assistant turns without usage/timing omit the fields (no `null`).
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Express response basics: https://expressjs.com/en/api.html#res.json

9. [x] Documentation update - `README.md` (if any user-facing changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap (acceptance criteria): note any user-visible metadata additions if surfaced.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Note new metadata behavior (timestamps/tokens/timing) if it is user-visible.
   - Purpose: Keep onboarding docs aligned with UI changes.

10. [x] Documentation update - `design.md` (document new turn metadata fields):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap (acceptance criteria): document assistant-only `usage`/`timing` fields and optionality.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Describe new turn metadata fields and where they are persisted.
   - Purpose: Keep architecture documentation accurate.

11. [x] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if files move or new files added.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Add/update tree entries for any new/changed files, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

12. [x] Add manual-check log lines for REST usage/timing persistence and document expected output:
   - Files to edit:
     - `server/src/routes/conversations.ts`
   - Requirements:
     - Log before responding to `GET /conversations/:id/turns` when usage/timing is present (include `conversationId`, `hasUsage`, `hasTiming`).
     - Log on `POST /conversations/:id/turns` when assistant usage/timing is accepted.
     - Example log tags (must be exact):
       - `DEV-0000024:T1:turns_snapshot_usage`
       - `DEV-0000024:T1:assistant_usage_accepted`

13. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open Chat + Agents, send a message, refresh history, and verify no console errors; confirm console/network logs include `DEV-0000024:T1:turns_snapshot_usage` and `DEV-0000024:T1:assistant_usage_accepted` with `hasUsage/hasTiming=true` when metadata is present.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed current turn schema, repo helpers, REST turn routes, and turn integration tests to confirm createdAt/command handling and existing payload shapes.
- Added optional `usage`/`timing` metadata types and subdocument schemas to the Turn model without defaults.
- Extended repo append/list helpers and ChatInterface assistant persistence payloads to carry optional usage/timing metadata.
- Added REST validation for usage/timing with assistant-only enforcement and logging for usage/timing snapshots and accepted metadata.
- Added integration coverage for assistant usage/timing acceptance, GET return shape, user rejection, and omission when absent.
- Updated design notes for assistant `usage`/`timing` fields; README and project structure required no changes.
- Added DEV-0000024 logging tags on turn snapshot responses and assistant append acceptance when usage/timing is present.
- Reviewed design notes for WS mapping; no additional updates required for this task.
- Lint still reports pre-existing warnings; Prettier check passed.
- `npm run build --workspace server` and `npm run build --workspace client` succeeded (client build warns about chunk size).
- `npm run test --workspace server` failed in cucumber integration with `ChromaConnectionError` (Chroma container unhealthy), leaving step 3 incomplete.
- Reran `npm run test --workspace server` after setting `LMSTUDIO_BASE_URL` in `ws-chat-stream.test.ts`; all unit + integration tests passed.
- `npm run test --workspace client` succeeded with existing React DOM nesting console warnings.
- `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness), `npm run compose:build`, `npm run compose:up`, and `npm run compose:down` succeeded.
- Manual Playwright-MCP check completed using `http://host.docker.internal:5001`: sent a chat message, refreshed the conversation list, and verified no console errors on Chat/Agents pages.
- Seeded a REST assistant turn with usage/timing metadata and confirmed `/logs?text=DEV-0000024:T1` reported `assistant_usage_accepted` + `turns_snapshot_usage` with `hasUsage/hasTiming=true`.
- Brought the compose stack back down after completing the manual check.

---

### 2. Server: propagate usage/timing through chat events

- Task Status: **__done__**
- Git Commits: **cdb2fae, 024a019**

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

1. [x] Review ChatInterface + stream bridge event flow:
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

2. [x] Extend chat event types to include usage/timing:
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
     - Example (completion event payload):
       - `{ type: 'complete', threadId: 't1', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, timing: { totalTimeSec: 0.9, tokensPerSecond: 22 } }`

3. [x] Pass usage/timing into assistant persistence:
   - Documentation to read (repeat):
     - Node.js EventEmitter: https://nodejs.org/api/events.html
   - Recap (acceptance criteria): stored turns must include usage/timing when present.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Requirements:
     - Include usage/timing when calling `persistAssistantTurn`.
     - Ensure memory persistence stores the same optional fields.
     - Example (persistAssistantTurn params):
       - `{ content: '...', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, timing: { totalTimeSec: 0.9 } }`

4. [x] Unit test (server): persist usage/timing when provided
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`
   - Description: Simulate a completion event with usage/timing and verify persisted turn data.
   - Purpose: Ensure assistant turns store usage/timing from completion events.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Node.js EventEmitter: https://nodejs.org/api/events.html

5. [x] Unit test (server): omit usage/timing when missing
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`
   - Description: Simulate a completion event without usage/timing metadata.
   - Purpose: Ensure assistant turns omit usage/timing when completion provides none.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Node.js EventEmitter: https://nodejs.org/api/events.html

6. [x] Unit test (server): fallback timing uses run start
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`
   - Description: Run a completion path without provider timing and inspect elapsed time.
   - Purpose: Ensure fallback `totalTimeSec` uses run start timestamp when provider timing is absent.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
     - Node.js EventEmitter: https://nodejs.org/api/events.html

7. [x] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any new metadata behavior that affects users.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Document any user-visible changes in chat metadata flow.
   - Purpose: Keep README in sync with behavior.

8. [x] Documentation update - `design.md` (document chat event metadata flow + diagrams):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Recap: document where usage/timing flows through ChatInterface events and update any relevant mermaid flow/sequence diagrams.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Add/update flow notes and mermaid diagrams for chat event metadata.
   - Purpose: Keep architecture diagrams aligned with pipeline changes.

9. [x] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update the tree if any files were added/removed, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

10. [x] Add manual-check log lines for usage/timing flow through chat events:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/chatStreamBridge.ts`
   - Requirements:
     - Log when a completion event carries usage/timing and when it is forwarded to persistence.
     - Example log tags (must be exact):
       - `DEV-0000024:T2:complete_usage_received`
       - `DEV-0000024:T2:persist_usage_forwarded`

11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: run a chat request and confirm streaming completes without console errors; verify console logs include `DEV-0000024:T2:complete_usage_received` and `DEV-0000024:T2:persist_usage_forwarded` when metadata is present; inspect WS frames if possible to confirm `turn_final` payload contains usage/timing.
9. [x] `npm run compose:down`

#### Implementation notes

- Added usage/timing fields to chat completion events, plus shared normalization and fallback timing derivation in `ChatInterface`.
- Forwarded normalized usage/timing into assistant persistence and WS `turn_final`, with server-side logging for WS completion metadata.
- Added unit coverage for usage/timing persistence, omission, and fallback timing derived from run start.
- README update not required because usage/timing remains a backend-only change in this task.
- Updated design notes and the chat sequence diagram to call out usage/timing on `turn_final` events and fallback timing behavior.
- Project structure update not required because no files or paths were added/removed.
- Added `DEV-0000024:T2:complete_usage_received` and `DEV-0000024:T2:persist_usage_forwarded` logs for completion metadata and persistence forwarding.
- `npm run lint --workspaces` still reports pre-existing import-order warnings; `npm run format:check --workspaces` passed after running `npm run format --workspace server`.
- `npm run build --workspace server` succeeded.
- `npm run build --workspace client` succeeded (Vite chunk size warnings).
- `npm run test --workspace server` succeeded after rerunning with a longer timeout.
- `npm run test --workspace client` succeeded with existing React DOM nesting warnings.
- `npm run e2e` succeeded; Docker build emitted existing npm deprecation warnings.
- `npm run compose:build` succeeded (client chunk size warnings remain).
- `npm run compose:up` succeeded.
- Manual Playwright-MCP check used `http://host.docker.internal:5001/chat` to run a short LM Studio request, waited for `turn_final`, and saw no console errors.
- Verified `/logs` on `http://host.docker.internal:5010` contained `DEV-0000024:T2:complete_usage_received` and `DEV-0000024:T2:persist_usage_forwarded` with `hasTiming=true`.
- Confirmed `chat.ws.server_publish_turn_final` logs show `hasTiming=true`, indicating `turn_final` payload included timing metadata.
- `npm run compose:down` completed successfully after the manual validation.

---

### 3. Server: capture Codex usage metadata

- Task Status: **__done__**
- Git Commits: **45f893b, 1e12ffb**

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

1. [x] Review Codex event handling and SDK types:
   - Documentation to read (repeat):
     - OpenAI Codex non-interactive event docs (turn.completed usage): https://developers.openai.com/codex/noninteractive/
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
   - Recap (acceptance criteria): capture assistant usage tokens when provider supplies them.
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `node_modules/@openai/codex-sdk/dist/index.d.ts`
     - `server/src/test/unit/chat-interface-codex.test.ts`

2. [x] Capture `turn.completed` usage and forward it:
   - Documentation to read (repeat):
     - OpenAI Codex non-interactive event docs (turn.completed usage): https://developers.openai.com/codex/noninteractive/
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
   - Recap (acceptance criteria): map `input_tokens`, `output_tokens`, and `cached_input_tokens` into stored usage fields.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Requirements:
     - Map `input_tokens`, `cached_input_tokens`, `output_tokens` into stored usage fields.
     - Derive `totalTokens` when Codex omits it.
     - Example (Codex usage mapping):
       - Input: `{ usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 6 } }`
       - Stored: `{ usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 6, totalTokens: 16 } }`

3. [x] Unit test (server): Codex usage persisted
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-codex.test.ts`
   - Description: Feed a Codex `turn.completed` event with usage payload into the adapter.
   - Purpose: Ensure assistant turns persist Codex usage metadata.
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

4. [x] Unit test (server): missing cached input tokens handled
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-codex.test.ts`
   - Description: Provide usage without `cached_input_tokens` and verify mapping.
   - Purpose: Ensure missing `cached_input_tokens` does not block usage capture.
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

5. [x] Unit test (server): derive totalTokens when omitted
   - Test type: Unit (`node:test`)
   - Location: `server/src/test/unit/chat-interface-codex.test.ts`
   - Description: Provide usage with input/output only and verify derived total.
   - Purpose: Ensure `totalTokens` is derived when Codex omits it.
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

6. [x] Integration test (server): Codex usage persists end-to-end
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/chat-codex.test.ts`
   - Description: Run a Codex chat flow and inspect persisted assistant turns.
   - Purpose: Ensure assistant turns persist usage metadata via Codex run flow.
   - Documentation to read (repeat):
     - OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

7. [x] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any user-visible token usage behavior if needed.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Note Codex token usage display behavior if user-visible.
   - Purpose: Keep README aligned with provider metadata.

8. [x] Documentation update - `design.md` (document Codex usage capture):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document where Codex usage is captured and stored.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Describe Codex usage capture points and storage fields.
   - Purpose: Keep provider integration docs accurate.

9. [x] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

10. [x] Add manual-check log lines for Codex usage capture:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Requirements:
     - Log when a `turn.completed` event includes usage (include input/output/cached counts).
     - Example log tag (must be exact):
       - `DEV-0000024:T3:codex_usage_received`

11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: if Codex is available, run a Codex chat or agent command and verify no console errors; confirm `DEV-0000024:T3:codex_usage_received` appears in logs and usage metadata appears in the response payload/UI when available.
9. [x] `npm run compose:down`

#### Implementation notes

- Added Codex usage mapping for `turn.completed` events, deriving `totalTokens` and emitting `DEV-0000024:T3:codex_usage_received` logs.
- Added unit coverage for Codex usage persistence, missing cached token handling, and total token derivation.
- Extended the Codex integration test to assert usage metadata persists in memory turns.
- README needed no update for this task; project structure unchanged.
- Updated design notes with Codex usage capture details and log tag reference.
- `npm run lint --workspaces` reports existing import-order warnings (no new errors); `npm run format:check --workspaces` passes.
- `npm run build --workspace server` and `npm run build --workspace client` succeeded (client build warns about chunk size).
- `npm run test --workspace server` succeeded after rerunning with a longer timeout; `npm run test --workspace client` passed with existing DOM nesting warnings.
- `npm run e2e` succeeded after restarting the stack; initial 5-minute run timed out while tests were still running.
- `npm run compose:build`, `npm run compose:up`, and `npm run compose:down` succeeded for the local stack.
- Manual Playwright-MCP check used `http://host.docker.internal:5001/chat` with Codex provider; no console errors and `/logs` showed `DEV-0000024:T3:codex_usage_received` with usage counts.

---

### 4. Server: capture LM Studio prediction stats

- Task Status: **__in_progress__**
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

1. [x] Review LM Studio prediction flow and SDK types:
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
   - Recap (acceptance criteria): capture timing and usage when provided by the LM Studio SDK.
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
     - `node_modules/@lmstudio/sdk/dist/index.d.ts`
     - `server/src/test/integration/chat-assistant-persistence.test.ts`

2. [x] Capture prediction stats and forward them:
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
   - Recap (acceptance criteria): map prompt/predicted/total tokens plus total time + tokens/sec when supplied.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
   - Requirements:
     - Use `prediction.result()` or `onPredictionCompleted` to access `PredictionResult.stats`.
     - Map stats to usage/timing fields (prompt/predicted/total tokens; totalTimeSec/tokensPerSecond).
     - Fall back to run timing when stats are missing.
     - Example (LM Studio stats mapping):
       - Stats: `{ promptTokensCount: 12, predictedTokensCount: 4, totalTokensCount: 16, totalTimeSec: 0.5, tokensPerSecond: 32 }`
       - Stored: `{ usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 }, timing: { totalTimeSec: 0.5, tokensPerSecond: 32 } }`

3. [x] Integration test (server): LM Studio usage/timing persisted
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/chat-assistant-persistence.test.ts`
   - Description: Use an LM Studio completion with stats and verify stored metadata.
   - Purpose: Ensure assistant turns persist LM Studio usage/timing metadata when stats exist.
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

4. [x] Integration test (server): fallback total time when stats missing
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/chat-assistant-persistence.test.ts`
   - Description: Run an LM Studio completion without stats and inspect timing output.
   - Purpose: Ensure missing prediction stats still store elapsed `totalTimeSec` from run timing.
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

5. [x] Integration test (server): omit tokensPerSecond when absent
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/chat-assistant-persistence.test.ts`
   - Description: Provide stats lacking tokens/sec and verify omission.
   - Purpose: Ensure `tokensPerSecond` is omitted when stats do not include it.
   - Documentation to read (repeat):
     - LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

6. [x] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any user-visible metadata additions.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Note LM Studio usage/timing display behavior if user-visible.
   - Purpose: Keep README aligned with provider metadata.

7. [x] Documentation update - `design.md` (document LM Studio stats capture):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document where LM Studio stats are read and stored.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Describe LM Studio stats capture and mapping to turn metadata.
   - Purpose: Keep provider integration docs accurate.

8. [x] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

9. [x] Add manual-check log lines for LM Studio stats capture:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
   - Requirements:
     - Log when prediction stats are available and mapped to usage/timing.
     - Example log tag (must be exact):
       - `DEV-0000024:T4:lmstudio_stats_mapped`

10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: use LM Studio provider to send a chat message, confirm response renders, no console errors, and verify `DEV-0000024:T4:lmstudio_stats_mapped` appears in logs alongside usage/timing metadata in payload/UI when available.
9. [x] `npm run compose:down`

#### Implementation notes

- Mapped LM Studio `PredictionResult.stats` into usage/timing metadata and derived totals when missing; added `DEV-0000024:T4:lmstudio_stats_mapped` logging.
- Added integration coverage for LM Studio stats persistence, fallback timing, and missing tokens/sec handling.
- README and project structure updates were not required; design notes updated for LM Studio stats mapping.
- `npm run lint --workspaces` reports existing import-order warnings; ran `npm run format --workspace server` and `npm run format:check --workspaces` clean.
- `npm run e2e` timed out at 5 minutes on the first run; reran with a longer timeout and completed successfully.
- `npm run compose:up` initially timed out at 10s while containers were starting; reran with a longer timeout to confirm services healthy.
- Manual Playwright MCP check used `http://host.docker.internal:5001/chat` with LM Studio provider; response completed without console errors and `/logs` returned `DEV-0000024:T4:lmstudio_stats_mapped` with usage/timing stats.
- `npm run compose:down` stopped the local stack cleanly after the manual check.

---

### 5. Server: include command metadata in inflight snapshots (WS + REST)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Expose command step metadata on inflight snapshots so agent bubbles can render “Step X of Y” while streaming (both WS and REST inflight payloads).

#### Documentation Locations

- `ws` 8.18.3 server API (send/receive JSON payloads): Context7 `/websockets/ws/8_18_3`
- TypeScript handbook (optional properties + object typing): https://www.typescriptlang.org/docs/handbook/2/objects.html
- Node.js test runner `node:test` (integration test structure): https://nodejs.org/api/test.html
- Mermaid docs (sequence diagram updates for inflight payloads): Context7 `/mermaid-js/mermaid`
- ESLint CLI docs (lint command flags + usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier formatting options + CLI (format/check commands): https://prettier.io/docs/options
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review inflight state and snapshot publishing:
   - Documentation to read (repeat):
     - `ws` 8.18.3 server API: Context7 `/websockets/ws/8_18_3`
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
   - Recap (acceptance criteria): inflight snapshots must expose command step metadata when provided.
   - Files to read:
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/ws/types.ts`
     - `server/src/ws/server.ts`
     - `server/src/agents/service.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/test/integration/conversations.turns.test.ts`
     - `server/src/test/integration/agents-run-ws-stream.test.ts`

2. [ ] Extend inflight state to store command metadata:
   - Documentation to read (repeat):
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
   - Recap (acceptance criteria): store command metadata only when provided; keep optional.
   - Files to edit:
     - `server/src/chat/inflightRegistry.ts`
   - Requirements:
     - Add optional `command` to `InflightState` and `createInflight` params.
     - Include `command` on `snapshotInflight` and `snapshotInflightTurns` output when present.
     - Example (inflight state):
       - `command: { name: 'improve_plan', stepIndex: 2, totalSteps: 6 }`

3. [ ] Pass command metadata into inflight creation for agent runs:
   - Documentation to read (repeat):
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
   - Recap (acceptance criteria): inflight snapshots for command runs include step metadata.
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Include `params.command` when calling `createInflight` in `runAgentInstructionUnlocked`.
     - Leave other createInflight call sites unchanged (chat route + MCP codebase question).
     - Example (createInflight params):
       - `{ command: { name: 'improve_plan', stepIndex: 2, totalSteps: 6 } }`

4. [ ] Extend WS inflight snapshot payload to include command metadata:
   - Documentation to read (repeat):
     - `ws` 8.18.3 server API: Context7 `/websockets/ws/8_18_3`
   - Recap (acceptance criteria): include `command` only when present.
   - Files to edit:
     - `server/src/ws/types.ts`
     - `server/src/ws/server.ts`
   - Requirements:
     - Add optional `command` inside `WsInflightSnapshotEvent.inflight`.
     - Include `command` in `publishInflightSnapshot` when available.
     - Example (WS inflight payload):
       - `{ inflight: { inflightId: 'i1', startedAt: '...', command: { name: 'improve_plan', stepIndex: 2, totalSteps: 6 } } }`

5. [ ] Integration test (server): REST inflight includes command metadata
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Create an inflight state with command metadata and assert REST `inflight.command` fields.
   - Purpose: Ensure `/conversations/:id/turns` returns command metadata for in-flight agent runs.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

6. [ ] Integration test (server): REST inflight omits command when missing
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/conversations.turns.test.ts`
   - Description: Create an inflight state without command metadata and verify `inflight.command` is absent.
   - Purpose: Ensure REST inflight responses omit optional command metadata when not provided.
   - Documentation to read (repeat):
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

7. [ ] Integration test (server): WS inflight_snapshot includes command metadata
   - Test type: Integration (`node:test`)
   - Location: `server/src/test/integration/agents-run-ws-stream.test.ts`
   - Description: Run an agent instruction with command metadata and assert `inflight_snapshot.inflight.command` fields.
   - Purpose: Ensure streaming WS snapshots include step metadata for agent commands.
   - Documentation to read (repeat):
     - `ws` 8.18.3 server API: Context7 `/websockets/ws/8_18_3`
     - Node.js test runner (node:test): https://nodejs.org/api/test.html

8. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out inflight step metadata availability if user-visible.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Note streaming step indicator metadata if user-visible.
   - Purpose: Keep README aligned with live metadata behavior.

9. [ ] Documentation update - `design.md` (document inflight payload changes + diagrams):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Recap: document `inflight_snapshot` payload shape and update any relevant WS sequence diagrams.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update inflight snapshot payload docs and diagrams to include `command` metadata.
   - Purpose: Keep WS flow docs accurate.

10. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

11. [ ] Add manual-check log lines for inflight command metadata propagation:
   - Files to edit:
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/ws/server.ts`
   - Requirements:
     - Log when inflight snapshots include command metadata.
     - Example log tag (must be exact):
       - `DEV-0000024:T5:inflight_command_snapshot`

12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: run an agent command and confirm the “Step X of Y” indicator appears during streaming, with no console errors, and verify `DEV-0000024:T5:inflight_command_snapshot` appears in logs.
9. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 6. Server: extend WS `turn_final` payload with usage/timing

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
     - Example (turn_final payload):
       - `{ type: 'turn_final', status: 'ok', usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 }, timing: { totalTimeSec: 0.7, tokensPerSecond: 22 } }`

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
   - Document: `README.md`
   - Location: `README.md`
   - Description: Note WS metadata availability if user-visible.
   - Purpose: Keep README aligned with real-time updates.

6. [ ] Documentation update - `design.md` (document WS payload changes + diagrams):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Recap: document `turn_final` payload shape, usage/timing fields, and update any WS sequence diagrams.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update WS payload documentation and sequence diagrams.
   - Purpose: Keep architecture docs accurate for WS flow changes.

7. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

8. [ ] Add manual-check log lines for WS `turn_final` usage/timing emission:
   - Files to edit:
     - `server/src/ws/server.ts`
   - Requirements:
     - Log when `turn_final` includes usage/timing metadata.
     - Example log tag (must be exact):
       - `DEV-0000024:T6:turn_final_usage`

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: send a chat message and confirm token/time metadata appears immediately after completion (no refresh), with no console errors, and verify `DEV-0000024:T6:turn_final_usage` appears in logs.
9. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 7. Client: map REST usage/timing into stored turns

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend the REST turn snapshot mapping to include usage/timing fields in stored turns and command metadata on inflight snapshots.

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
     - Example (StoredTurn shape):
       - `{ usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12, cachedInputTokens: 2 }, timing: { totalTimeSec: 0.4 } }`

3. [ ] Extend InflightSnapshot to include command metadata:
   - Documentation to read (repeat):
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
   - Recap (acceptance criteria): REST inflight snapshots must include step metadata when present.
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Requirements:
     - Add optional `command` to `InflightSnapshot` with `{ name, stepIndex, totalSteps }`.
     - Keep `command` undefined when the server omits it.
     - Example (REST inflight payload):
       - `{ inflight: { inflightId: 'i1', startedAt: '...', command: { name: 'improve_plan', stepIndex: 1, totalSteps: 4 } } }`

4. [ ] Hook test (client): REST turns retain usage/timing
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Description: Mock REST response with usage/timing and verify stored turn shape.
   - Purpose: Ensure stored turns retain usage/timing fields from REST.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

5. [ ] Hook test (client): REST turns omit missing metadata
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Description: Mock REST response without usage/timing and verify no defaults.
   - Purpose: Ensure turns without usage/timing do not get defaulted fields.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

6. [ ] Hook test (client): REST inflight retains command metadata
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Description: Mock REST response with `inflight.command` metadata and verify hook state.
   - Purpose: Ensure inflight snapshots expose command step metadata for streaming UI.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

7. [ ] Hook test (client): REST inflight omits command when missing
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Description: Mock REST response with inflight data but no command metadata.
   - Purpose: Ensure inflight snapshots omit command metadata when not supplied.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

8. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any user-visible metadata changes if needed.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Note any REST metadata changes visible to users.
   - Purpose: Keep README aligned with persisted data behavior.

9. [ ] Documentation update - `design.md` (document REST turn mapping changes):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document client mapping for usage/timing fields.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Document REST turn mapping and client model updates.
   - Purpose: Keep architecture docs accurate for REST data flow.

10. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

11. [ ] Add manual-check log lines for REST stored-turn mapping:
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Requirements:
     - Log when REST turns include usage/timing and when inflight command metadata is hydrated.
     - Example log tags (must be exact):
       - `DEV-0000024:T7:rest_usage_mapped`
       - `DEV-0000024:T7:rest_inflight_command`

12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: send a message, refresh the page, and confirm usage/timing metadata persists in history; verify no console errors and confirm `DEV-0000024:T7:rest_usage_mapped` + `DEV-0000024:T7:rest_inflight_command` appear in logs.
9. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 8. Client: map WS usage/timing into stream state

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend the WS transcript event mapping so usage/timing fields and inflight command metadata land on streaming assistant messages.

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
   - Recap (acceptance criteria): `turn_final` should deliver usage/timing and inflight snapshots should deliver command metadata to streaming UI.
   - Files to read:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/support/mockChatWs.ts`
     - `common/src/fixtures/chatStream.ts`

2. [ ] Extend WS event types and message updates:
   - Documentation to read (repeat):
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - TypeScript handbook (object types): https://www.typescriptlang.org/docs/handbook/2/objects.html
   - Recap (acceptance criteria): in-flight assistant bubble uses `inflight.startedAt` for timestamps and exposes `command` step metadata when provided.
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Add optional `usage` + `timing` to `turn_final` event handling.
     - Add optional `command` to `inflight_snapshot` event typing and propagate it to the assistant message.
     - When hydrating an inflight snapshot, update the assistant bubble timestamp to `inflight.startedAt`.
     - Example (WS events):
       - `turn_final` with usage: `{ type: 'turn_final', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 }, timing: { totalTimeSec: 0.6 } }`
       - `inflight_snapshot` with command: `{ type: 'inflight_snapshot', inflight: { command: { name: 'improve_plan', stepIndex: 1, totalSteps: 4 } } }`

3. [ ] Update fixtures + WS mocks:
   - Documentation to read (repeat):
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Recap (acceptance criteria): fixtures should include usage/timing and inflight command metadata when present.
   - Files to edit:
     - `common/src/fixtures/chatStream.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Requirements:
     - Add representative usage/timing fields to `chatWsTurnFinalFixture` and mock events.
     - Add representative `command` metadata to `chatWsInflightSnapshotFixture` and mock inflight events.
     - Example (fixture additions):
       - `chatWsTurnFinalFixture.usage = { inputTokens: 8, outputTokens: 4, totalTokens: 12 }`
       - `chatWsInflightSnapshotFixture.inflight.command = { name: 'improve_plan', stepIndex: 1, totalSteps: 4 }`

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

7. [ ] Hook test (client): inflight snapshot preserves command metadata
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Hydrate an inflight snapshot with `command` metadata and assert the assistant message includes it.
   - Purpose: Ensure streaming UI receives step metadata for agent commands.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

8. [ ] Hook test (client): inflight snapshot omits command when missing
   - Test type: Hook test (React Testing Library)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Hydrate an inflight snapshot without `command` metadata and verify the assistant message omits it.
   - Purpose: Ensure command metadata is optional in streaming state.
   - Documentation to read (repeat):
     - React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

9. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any user-visible metadata changes if needed.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Note WS metadata availability if user-visible.
   - Purpose: Keep README aligned with live updates.

10. [ ] Documentation update - `design.md` (document WS mapping changes + diagrams):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Recap: document client WS mapping of usage/timing and update any relevant mermaid sequence diagrams.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update client WS mapping notes and related diagrams.
   - Purpose: Keep architecture docs accurate for WS flows.

11. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

12. [ ] Add manual-check log lines for WS transcript mapping:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Log when `turn_final` usage/timing is applied to the streaming assistant bubble.
     - Log when inflight snapshots include command metadata.
     - Example log tags (must be exact):
       - `DEV-0000024:T8:ws_usage_applied`
       - `DEV-0000024:T8:ws_inflight_command`

13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open two tabs on the same conversation, verify WS updates show tokens/timing live, and confirm no console errors; ensure logs include `DEV-0000024:T8:ws_usage_applied` and `DEV-0000024:T8:ws_inflight_command`.
9. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 9. Client: render bubble header metadata (Chat + Agents)

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
     - Example (formatted timestamp):
       - Input: `2026-01-11T20:05:00Z` → Output: `Jan 11, 2026, 2:05 PM` (local)

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
     - Example (assistant header lines):
       - `Tokens: in 10 · out 5 · total 15 (cached 2)`
       - `Time: 1.2s · Rate: 12.5 tok/s`
       - `Step 2 of 6`

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

8. [ ] Component test (client): cached input token suffix
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/chatPage.stream.test.tsx`
   - Description: Render an assistant turn with `cachedInputTokens` and verify the “(cached X)” suffix.
   - Purpose: Ensure cached input tokens display when provided.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

9. [ ] Component test (client): omit cached suffix when missing
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/chatPage.stream.test.tsx`
   - Description: Render an assistant turn without `cachedInputTokens` and ensure the suffix is absent.
   - Purpose: Ensure partial usage data does not render cached suffix.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

10. [ ] Component test (client): omit token line when usage missing
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/chatPage.stream.test.tsx`
   - Description: Render an assistant turn without usage fields and ensure the token line is not rendered.
   - Purpose: Ensure token metadata is omitted when no usage exists.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

11. [ ] Component test (client): omit timing/rate when missing
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/chatPage.stream.test.tsx`
   - Description: Provide assistant turns without timing/tokens-per-second fields.
   - Purpose: Ensure timing/rate rows are omitted when timing fields are missing or non-finite.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

12. [ ] Component test (client): invalid timestamp fallback
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/chatPage.stream.test.tsx`
   - Description: Render a bubble with an invalid `createdAt` and assert a timestamp still renders.
   - Purpose: Ensure invalid timestamps do not crash rendering and fall back to `new Date()`.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

13. [ ] Component test (client): inflight step indicator
   - Test type: Component test (React Testing Library)
   - Location: `client/src/test/agentsPage.streaming.test.tsx`
   - Description: Hydrate an inflight snapshot with command metadata and verify “Step X of Y” renders.
   - Purpose: Ensure step indicators appear during streaming agent runs.
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

14. [ ] Documentation update - `README.md` (if any user-facing changes need to be called out):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: call out any new metadata visible to users.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Document bubble metadata display (timestamps/tokens/timing/steps) if user-visible.
   - Purpose: Keep README aligned with UI behavior.

15. [ ] Documentation update - `design.md` (document bubble metadata UI behavior):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document UI rules for timestamps, tokens, timing, and steps.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Explain bubble header metadata UI rules and layout.
   - Purpose: Keep UI documentation accurate.

16. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this task.
   - Purpose: Keep the repository map current.

17. [ ] Add manual-check log lines for UI metadata rendering:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Log when metadata header renders with timestamp, token line, and timing/rate.
     - Log when step indicator renders for agent commands.
     - Example log tags (must be exact):
       - `DEV-0000024:T9:ui_metadata_rendered`
       - `DEV-0000024:T9:ui_step_indicator`

18. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: verify timestamps, token lines (including cached suffix), timing/rate visibility, step indicator during agent runs, and no console errors; confirm logs include `DEV-0000024:T9:ui_metadata_rendered` and `DEV-0000024:T9:ui_step_indicator` when the UI renders those elements.
9. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 10. Final verification + documentation + PR summary

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
   - Document: `README.md`
   - Location: `README.md`
   - Description: Update user-facing notes and any new commands introduced by this story.
   - Purpose: Keep onboarding docs accurate.
5. [ ] Ensure `design.md` is updated with any required description changes including Mermaid diagrams that have been added as part of this story
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: ensure diagrams reflect new metadata flow if updated.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update architecture notes and mermaid diagrams for new flows.
   - Purpose: Keep design documentation accurate.
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths changed.
   - Ordering: complete this after any subtask that adds/removes files.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update the file tree for any additions/removals made in this story, including every file added or removed.
   - Purpose: Keep repository map current.
7. [ ] Create a summary of all changes within this story and generate the pull request comment (must cover all tasks)
   - Documentation to read (repeat):
     - Husky: Context7 `/typicode/husky`
   - Recap: summary must cover all tasks and mention any workflow changes.

8. [ ] Add manual-check log lines for final verification:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Emit a summary log when manual checks are completed to confirm end-to-end validation.
     - Example log tag (must be exact):
       - `DEV-0000024:T10:manual_validation_complete`

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 5 minutes; e.g., `timeout 5m` or set `timeout_ms=300000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: validate chat/agents metadata UI end-to-end, capture screenshots to `./test-results/screenshots/` (name: `0000024-9-<short-name>.png`), confirm no console errors, and ensure `DEV-0000024:T10:manual_validation_complete` appears in logs.
9. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---
