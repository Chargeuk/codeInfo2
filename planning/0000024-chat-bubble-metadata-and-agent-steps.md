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
  - `timing`: `{ totalTimeSec?: number; tokensPerSecond?: number; timeToFirstTokenSec?: number }`
    - Map LM Studio SDK `totalTimeSec` → `totalTimeSec`, `tokensPerSecond` → `tokensPerSecond`, `timeToFirstTokenSec` → `timeToFirstTokenSec` (REST uses `generation_time`, `tokens_per_second`, `time_to_first_token`).
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
- `@lmstudio/sdk` exposes `PredictionResult.stats` on the `OngoingPrediction` result (via `prediction.result()`), which includes `tokensPerSecond`, `timeToFirstTokenSec`, `totalTimeSec`, and token counts.
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

- Mongoose 9.0.1 schema + subdocs: Context7 `/automattic/mongoose/9.0.1`
- Zod v3 schema validation: Context7 `/websites/v3_zod_dev`
- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Express response basics (status + JSON): https://expressjs.com/en/api.html#res.json

#### Subtasks

1. [ ] Review current turn persistence and REST payload shapes:
   - Documentation to read:
     - Mongoose schema types: https://mongoosejs.com/docs/schematypes.html
     - Zod schema validation: Context7 `/colinhacks/zod`
   - Files to read:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/routes/conversations.ts`
     - `server/src/test/integration/conversations.turns.test.ts`
   - Goal:
     - Confirm how `createdAt` and `command` metadata are stored and returned today.

2. [ ] Add usage/timing fields to the Turn schema + types:
   - Files to edit:
     - `server/src/mongo/turn.ts`
   - Requirements:
     - Add optional `usage` object with `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens` numeric fields.
     - Add optional `timing` object with `totalTimeSec`, `tokensPerSecond`, `timeToFirstTokenSec` numeric fields.
     - Do not add defaults; store only when data exists.
     - Keep `command` metadata unchanged for agent step display.
     - Ensure these fields are optional and safe for non-assistant turns.

3. [ ] Thread usage/timing through repo types and append helpers:
   - Files to edit:
     - `server/src/mongo/repo.ts` (AppendTurnInput + TurnSummary)
     - `server/src/chat/interfaces/ChatInterface.ts` (persistAssistantTurn payload)
   - Requirements:
     - Accept optional `usage`/`timing` only for assistant turns in the append schema.
     - Ensure `persistAssistantTurn` can pass usage/timing into `appendTurn` and memory persistence.
     - Return `usage`/`timing` in `GET /conversations/:id/turns` when stored.
     - Omit fields (not `null`) when values are missing.

4. [ ] Extend REST turn schemas to accept usage/timing safely:
   - Files to edit:
     - `server/src/routes/conversations.ts`
   - Requirements:
     - Add `usage` + `timing` to `appendTurnSchema`.
     - Enforce that `usage`/`timing` is only accepted when `role === 'assistant'` (use Zod `superRefine` or equivalent v3 pattern).

5. [ ] Add/extend server integration tests for usage/timing:
   - Documentation to read:
     - Node.js test runner (node:test): https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/integration/conversations.turns.test.ts`
   - Requirements:
     - Cover `POST /conversations/:id/turns` with assistant usage/timing metadata.
     - Assert `GET /conversations/:id/turns` returns the metadata fields intact.
     - Assert user turns ignore any usage/timing input.

6. [ ] Documentation update - `README.md` (if any user-facing changes need to be called out):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `README.md`

7. [ ] Documentation update - `design.md` (document new turn metadata fields):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `design.md`

8. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `projectStructure.md`

9. [ ] Run full linting:
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

### 2. Server: capture provider usage/timing + include in WS `turn_final`

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Capture usage/timing metadata from Codex and LM Studio provider responses and persist them on assistant turns. Extend WS `turn_final` events to include this metadata so the UI can render it without waiting for a REST refresh.

#### Documentation Locations

- OpenAI Codex non-interactive event docs (turn.completed usage): https://developers.openai.com/codex/cli#non-interactive-mode
- OpenAI Codex SDK overview: https://developers.openai.com/codex/sdk
- LM Studio SDK README (prediction stats): https://www.npmjs.com/package/@lmstudio/sdk
- Zod v3 schema validation (WS payloads): Context7 `/websites/v3_zod_dev`
- `ws` 8.18.3 server API (if WS tests are updated): Context7 `/websockets/ws/8_18_3`

#### Subtasks

1. [ ] Review provider adapters and WS event shapes:
   - Documentation to read:
     - OpenAI Codex SDK (event stream reference): https://github.com/openai/codex
     - LM Studio SDK (prediction stats fields): https://github.com/lmstudio-ai/lmstudio-sdk
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
     - `server/src/ws/types.ts`
     - `server/src/ws/server.ts`
     - `node_modules/@openai/codex-sdk/dist/index.d.ts`
     - `node_modules/@lmstudio/sdk/dist/index.d.ts`
     - `server/src/test/unit/chat-interface-codex.test.ts`
     - `server/src/test/integration/chat-assistant-persistence.test.ts`
   - Goal:
     - Confirm where to capture provider usage/timing and how `turn_final` is emitted.

2. [ ] Add usage/timing propagation to ChatInterface + stream bridge:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/chatStreamBridge.ts`
   - Requirements:
     - Extend `ChatCompleteEvent` (or add a new event) to carry `usage` + `timing`.
     - Track usage/timing in `run()` and pass into `persistAssistantTurn`.
     - Capture a run start timestamp in `run()` so timing can fall back when providers omit stats.
     - Ensure `publishTurnFinal` can include usage/timing metadata for WS clients.

3. [ ] Capture Codex usage payloads and persist them:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Requirements:
     - Map `turn.completed` usage fields (`input_tokens`, `output_tokens`, `cached_input_tokens`) into stored `usage` fields.
     - Derive `totalTokens` from Codex usage when the provider omits it.
     - If elapsed time can be derived from run timing, populate `timing.totalTimeSec` accordingly.

4. [ ] Capture LM Studio prediction stats and persist them:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`
   - Requirements:
     - Use `onPredictionCompleted` or `prediction.result()` to access `PredictionResult.stats`.
     - Map SDK stats (`promptTokensCount`, `predictedTokensCount`, `totalTokensCount`) into `usage` fields.
     - Map `totalTimeSec`, `tokensPerSecond`, and `timeToFirstTokenSec` into `timing` fields when present.
     - If timing is missing but run timing is available, calculate `timing.totalTimeSec`.

5. [ ] Include usage/timing on WS `turn_final` events:
   - Documentation to read:
     - Zod schema validation: Context7 `/colinhacks/zod`
   - Files to edit:
     - `server/src/ws/types.ts`
     - `server/src/ws/server.ts`
   - Requirements:
     - Add optional `usage` + `timing` to the `turn_final` payload shape.
     - Ensure WS events still validate with existing protocol versioning.

6. [ ] Add/extend server tests for provider/WS metadata:
   - Documentation to read:
     - `ws` server API: Context7 `/websockets/ws/8_18_3`
   - Files to edit:
     - `server/src/test/unit/ws-server.test.ts`
     - `server/src/test/unit/chat-interface-codex.test.ts`
     - `server/src/test/integration/chat-codex.test.ts`
     - `server/src/test/integration/chat-assistant-persistence.test.ts`
   - Requirements:
     - Assert `turn_final` includes usage/timing when provided by the provider.
     - Keep existing WS protocol expectations intact.

7. [ ] Documentation update - `README.md` (if any user-facing behavior changes need to be called out):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `README.md`

8. [ ] Documentation update - `design.md` (document provider usage/timing capture):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `design.md`

9. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `projectStructure.md`

10. [ ] Run full linting:
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

### 3. Client: map usage/timing into chat + agent message models

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend client-side message models and hooks to carry usage/timing metadata from REST snapshots and WS `turn_final` events. This task focuses on data flow and state models, not on UI rendering.

#### Documentation Locations

- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- TypeScript handbook (type composition): https://www.typescriptlang.org/docs/handbook/2/objects.html
- React Testing Library (hook tests): https://testing-library.com/docs/react-testing-library/intro/

#### Subtasks

1. [ ] Review existing chat/agent message models and mapping:
   - Documentation to read:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/test/useConversationTurns.commandMetadata.test.ts`
     - `client/src/test/useChatStream.toolPayloads.test.tsx`

2. [ ] Extend REST turn models to include usage/timing:
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Requirements:
     - Add optional `usage` + `timing` fields to `StoredTurn`.
     - Include `cachedInputTokens` + `timeToFirstTokenSec` in the mapped shapes.
     - Map REST response fields into the new shape without breaking existing consumers.

3. [ ] Update shared chat fixtures for new metadata fields:
   - Files to edit:
     - `common/src/fixtures/chatStream.ts`
   - Requirements:
     - Add representative `usage` + `timing` fields to `chatWsTurnFinalFixture`.
     - Keep existing fixture shapes backward-compatible with current tests.

4. [ ] Extend WS event mapping to include usage/timing:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Requirements:
     - Include `usage` + `timing` in the `turn_final` event model.
     - Prefer WS metadata for in-flight bubbles until REST refresh replaces it.
     - When hydrating an inflight snapshot, update the assistant bubble timestamp to `inflight.startedAt`.

5. [ ] Update hook tests to cover new metadata fields:
   - Documentation to read:
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Files to edit:
     - `client/src/test/useConversationTurns.commandMetadata.test.ts`
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Requirements:
     - Add assertions for `usage` + `timing` mapping.

6. [ ] Documentation update - `README.md` (if any user-facing changes need to be called out):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `README.md`

7. [ ] Documentation update - `design.md` (document client state shape changes):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `design.md`

8. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `projectStructure.md`

9. [ ] Run full linting:
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

### 4. Client: render bubble header metadata in Chat + Agents

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Render message header metadata for user/assistant bubbles in Chat and Agents: timestamps, token usage, timing, and agent step indicators. This task only touches UI rendering; it relies on the metadata populated in earlier server/client tasks.

#### Documentation Locations

- MUI Stack: https://llms.mui.com/material-ui/6.4.12/components/stack.md
- MUI Typography: https://llms.mui.com/material-ui/6.4.12/components/typography.md
- MUI Tooltip: https://llms.mui.com/material-ui/6.4.12/components/tooltip.md
- `Intl.DateTimeFormat`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat

#### Subtasks

1. [ ] Review existing bubble rendering for Chat and Agents:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/chat/ConversationList.tsx` (for style patterns, if needed)

2. [ ] Add timestamp formatting helpers and fallback handling:
   - Documentation to read:
     - `Intl.DateTimeFormat`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
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
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Show token usage only when present; include cached input token suffix.
     - Show timing and tokens-per-second only when provided and finite.
     - Show “Step X of Y” for agent bubbles when `command.stepIndex` + `command.totalSteps` exist.
     - Do not render metadata for status/error bubbles.

4. [ ] Add/adjust UI tests for metadata rendering:
   - Documentation to read:
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Files to edit:
     - `client/src/test/useChatStream.toolPayloads.test.tsx` (or add a dedicated ChatPage/AgentsPage test)
     - `e2e/chat.spec.ts` (if adding e2e coverage for metadata)
   - Requirements:
     - Assert timestamp and token metadata appear for assistant turns when provided.

5. [ ] Documentation update - `README.md` (if any user-facing changes need to be called out):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `README.md`

6. [ ] Documentation update - `design.md` (document bubble metadata UI behavior):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `design.md`

7. [ ] Documentation update - `projectStructure.md` (only if files/paths change):
   - Documentation to read:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document location:
     - `projectStructure.md`

8. [ ] Run full linting:
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

### 5. Final verification + documentation + PR summary

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Validate the full story against acceptance criteria, perform clean builds/tests, update all required documentation, and produce the pull request summary for the story.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] Perform a clean docker build
4. [ ] Ensure `README.md` is updated with any required description changes and with any new commands that have been added as part of this story
5. [ ] Ensure `design.md` is updated with any required description changes including Mermaid diagrams that have been added as part of this story
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders
7. [ ] Create a summary of all changes within this story and generate the pull request comment (must cover all tasks)

#### Testing

1. [ ] Run the client Jest tests
2. [ ] Run the server Cucumber tests
3. [ ] Restart the docker environment
4. [ ] Run the e2e tests
5. [ ] Use the Playwright MCP tool to manually check the application, saving screenshots to `./test-results/screenshots/` (name: `0000024-5-<short-name>.png`)

#### Implementation notes

- Notes added during implementation.

---
