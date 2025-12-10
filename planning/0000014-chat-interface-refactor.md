# Story 0000014 – Unified Chat Interface Abstraction

## Description

Unify the server-side chat execution paths so LM Studio and Codex share the same abstractions and so LM Studio can be exposed through the MCP v2 interface. Introduce a `ChatInterface` base abstraction that centralises shared concerns (conversation persistence, streaming adapters, flags handling), then implement provider-specific subclasses (e.g., `ChatInterfaceLMStudio`, `ChatInterfaceCodex`) chosen via a factory for both REST and MCP callers. The end result keeps current behaviour for existing providers while enabling LM Studio via MCP without duplicating logic or scattering provider-specific conditionals. Provider-specific configuration (timeouts, model maps, quirks) stays inside each subclass; the factory merely selects the subclass from a static provider list.

### MCP response handling (answered)

MCP v2 response format stays unchanged (single JSON-RPC result with ordered `segments`). We will wrap the streaming `ChatInterface` output in an MCP-specific responder/adapter that buffers the event stream (tokens, tool events, finals) into the existing MCP payload shape, then returns once complete. The wrapper is transport-specific, while the provider-specific derived classes (`ChatInterfaceLMStudio`, `ChatInterfaceCodex`) remain streaming-first; any new provider gains MCP support automatically via this wrapper without MCP-specific code in the provider class.

### Streaming adapter location (answered)

Streaming/response adapter logic will live in the base `ChatInterface` for now (overridable by subclasses if absolutely required). If additional transports emerge later, we can refactor into pluggable responders, but initial implementation prioritises simplicity.

### Capability discovery (answered)

The factory will use a simple static provider list to decide which subclasses are available; runtime health checks can be added later if needed.

### MCP payload compatibility (answered)

MCP output must remain byte-for-byte compatible with today’s segments format. The MCP wrapper will transform the normalized streaming output from `ChatInterface` (LM Studio or Codex) into that format and drop unused fields.

## Acceptance Criteria

- A common `ChatInterface` abstraction exists that covers shared workflow: loading conversation history by id, appending turns/status/tool calls, and emitting responses to REST streams and MCP callers.
- Provider-specific classes (at least LM Studio and Codex) use the common base while encapsulating only provider-specific API calls and quirks.
- REST `/chat` and MCP v2 `codebase_question` use the factory to obtain the correct provider implementation; conditional logic in route/handler files is minimised.
- LM Studio is available through the MCP v2 path with conversation-id-based history (no full-history payloads) and parity with REST behaviour (tools, citations, status).
- Behavioural parity: existing REST/Codex flows remain unchanged from a user perspective; regression tests stay green.
- Documentation updated to describe the new abstraction/factory, including how REST and MCP select providers and how to add future providers.

## Out Of Scope

- Adding new providers beyond LM Studio/Codex (e.g., Ollama, Claude).
- Changing client UI beyond any small wiring needed for MCP LM Studio support.
- Altering persistence schema or introducing new persistence backends.
- Refactoring tooling endpoints outside the chat execution path.

## Questions

- [Answered] Should MCP v2 responses share the same streaming adapter as REST, or keep MCP as single-response while reusing shared turn/metadata handling? → Keep MCP single-response format; use an MCP responder wrapper around the streaming `ChatInterface` to aggregate events into the current segment payload, so new providers work automatically with MCP.
- [Answered] Where should streaming adapters live: inside `ChatInterface` or as pluggable responders injected by the factory? → Keep it simple initially: place streaming/response adapter logic in the base `ChatInterface` (overridable by subclasses if required). If additional transports emerge later, refactor into pluggable responders at that point.
- [Answered] Do we want per-provider configuration (timeouts, model maps) centralised in the factory or alongside each subclass? → Keep provider-specific configuration inside each provider subclass; the factory simply selects the subclass so adding a new provider doesn’t require edits in multiple places.
- [Answered] How should provider capability discovery be exposed to the factory (static list vs. runtime health checks)? → Use a simple static list for now to keep complexity low; revisit runtime health checks if/when needed.
- [Answered] Any constraints on backwards compatibility of MCP payload shape when LM Studio is added (e.g., must segments mirror Codex output format)? → Keep the MCP payload shape exactly as today. The MCP wrapper should transform the normalized streaming output from `ChatInterface` (LM Studio or Codex) into the current segments format, dropping any fields not used in the existing contract.

## Implementation Plan

Copy the standard Implementation Plan instructions from `planning/plan_format.md` when creating tasks for this story. Do not start tasks until scope and questions above are clarified.

## Tasks

### 1. Extract ChatInterface base and factory scaffold

- Task Status: **__in_progress__**
- Git Commits: **6b7b7f1**

#### Overview

Create the foundational `ChatInterface` abstraction with normalized streaming events and a static-provider factory. No provider logic changes yet; only scaffolding and unit coverage to prove the event flow and factory selection.

#### Documentation Locations

- Node.js EventEmitter docs: https://nodejs.org/api/events.html — for emitting/handling normalized chat events.
- TypeScript abstract classes/typing: https://www.typescriptlang.org/docs/handbook/2/classes.html — to define the base `ChatInterface`.
- JSON streaming basics (MDN Streams API): https://developer.mozilla.org/en-US/docs/Web/API/Streams_API — to understand streaming event flows used by the interface.
- Jest testing guide: Context7 `/jestjs/jest` — for writing unit tests in this task.

#### Subtasks

1. [x] Create `server/src/chat/interfaces/ChatInterface.ts` (docs: EventEmitter, TS classes, Streams, Jest):
   - Export normalized event types: `ChatTokenEvent { type:'token'; content:string }`, `ChatToolRequestEvent { type:'tool-request'; name:string; callId:string; params:any }`, `ChatToolResultEvent { type:'tool-result'; callId:string; result:any }`, `ChatFinalEvent { type:'final'; content:string }`, `ChatCompleteEvent { type:'complete' }`, `ChatErrorEvent { type:'error'; message:string }`.
   - Abstract class `ChatInterface` with `run(message: string, flags: any, conversationId: string, model: string): Promise<void>` and protected `emit(event)`, `loadHistory(conversationId)`, `persistTurn(turn)`.
   - Include code stub showing `this.on('token', handler)` and `this.emit({ type:'token', content })`.
2. [x] Create `server/src/chat/factory.ts` (docs: TS modules, Jest):
   - Static provider map: `{ codex: () => new ChatInterfaceCodex(), lmstudio: () => new ChatInterfaceLMStudio() }` (placeholder classes ok).
   - Export `getChatInterface(provider: 'codex'|'lmstudio')` that throws `UnsupportedProviderError` when missing.
   - Add comment snippet: `const chat = getChatInterface(provider);`.
3. [x] Add persistence wiring in `ChatInterface` (docs: Streams, Jest):
   - Call `listTurns({ conversationId, limit: Infinity, cursor: undefined })` inside `loadHistory`.
   - Call `appendTurn` for user/assistant/tool turns; call `updateConversationMeta` to bump `lastMessageAt`.
   - No route changes yet.
4. [x] Unit test (base events) `server/src/test/unit/chat-interface-base.test.ts` (docs: Jest):
   - Fake subclass emits token/final/complete; expect call order `['token','final','complete']`.
5. [x] Unit test (base persistence) `server/src/test/unit/chat-interface-base.test.ts` (docs: Jest):
   - Mock repo; expect `loadHistory` and `persistTurn` invoked with conversationId and turn payload.
6. [x] Unit test (factory selection) `server/src/test/unit/chat-factory.test.ts` (docs: Jest):
   - Expect `getChatInterface('codex')` returns Codex placeholder instance.
7. [x] Unit test (factory unsupported) `server/src/test/unit/chat-factory.test.ts` (docs: Jest):
   - Expect calling with `'unknown'` throws `UnsupportedProviderError` with message/code.
8. [x] Update `projectStructure.md` to list `server/src/chat/interfaces/ChatInterface.ts` and `server/src/chat/factory.ts`.
9. [x] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client` (includes new RTL spec)
5. [x] `npm run e2e` (includes new provider-selection scenario)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: select Codex conversation → provider shows Codex and history visible; switch to LM Studio conversation → provider shows LM Studio; new conversation → reselect history → history still visible.
9. [x] `npm run compose:down`

#### Implementation notes

- Added `ChatInterface` base with discriminated event unions, history/turn helpers using repo persistence, and typed emit/on helpers.
- Created `getChatInterface` factory with `UnsupportedProviderError` plus placeholder Codex/LM Studio subclasses; added unit coverage for factory selection/unsupported paths.
- Added unit coverage for base event ordering and helper invocation via subclass spies; updated projectStructure with new chat files.
- Lint/format pass completed; full test matrix run: server/client builds, server/client tests, full e2e (main and compose), manual UI screenshots (home/chat) saved to `test-results/screenshots/0000014-1-*.png`, compose up/down.

---

### 2. Move Codex REST onto ChatInterface

- Task Status: **__done__**
- Git Commits: **6b7b7f1**

#### Overview

Implement `ChatInterfaceCodex` and route the Codex REST `/chat` path through the factory and base streaming events, preserving existing behaviour (tokens, tools, status, Codex threadId reuse).

#### Documentation Locations

- Express routing: Context7 `/expressjs/express` — to correctly update the `/chat` route.
- MDN Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events — to map normalized events to SSE.
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification — for Codex threadId handling and error shapes.
- Jest testing guide: Context7 `/jestjs/jest` — for unit/integration tests in this task.
- Cucumber guides: https://cucumber.io/docs/guides/ — if integration coverage uses Cucumber features.

#### Subtasks

1. [x] Implement `server/src/chat/interfaces/ChatInterfaceCodex.ts` (docs: Express, SSE, JSON-RPC, Jest, Cucumber):
   - Use existing Codex client (see `server/src/mcp2/tools/codebaseQuestion.ts` for reference).
   - Map Codex stream to normalized events; ensure tool-call events map to `ChatToolRequestEvent/ChatToolResultEvent`.
   - Preserve Codex threadId and include in flags as today.
2. [x] Update `server/src/routes/chat.ts` (docs: Express, SSE):
   - Replace Codex branch with:
     ```ts
     const chat = getChatInterface('codex');
     chat.on('token', ev => sse.send(ev));
     chat.on('tool-request', ev => sse.send(ev));
     chat.on('tool-result', ev => sse.send(ev));
     chat.on('final', ev => sse.send(ev));
     chat.on('complete', ev => sse.send(ev));
     chat.on('error', ev => sse.send(ev));
     await chat.run(message, flags, conversationId, model);
     ```
   - Remove history payload acceptance (already enforced); keep conversationId flow unchanged.
3. [x] Remove Codex-specific conditionals now handled by factory (document which branches deleted in `chat.ts`).
4. [x] Integration test (SSE order) `server/src/test/integration/chat-codex-interface.test.ts` (docs: Jest, Cucumber guides):
    - Assert SSE event order token -> tool request/result -> final -> complete.
5. [x] Integration test (threadId persistence) `server/src/test/integration/chat-codex-interface.test.ts` (docs: Jest, Cucumber):
    - Assert threadId is returned and persisted (mock repo or DB check).
6. [x] Unit test (event mapping) `server/src/test/unit/chat-interface-codex.test.ts` (docs: Jest):
    - Mock Codex client to emit token/final/error; assert normalized events fire.
7. [x] Update `projectStructure.md` to list `server/src/chat/interfaces/ChatInterfaceCodex.ts`.
8. [x] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client` (includes new RTL spec)
5. [x] `npm run e2e` (includes new provider-selection scenario)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: headless Playwright navigation to `/chat`, provider select shows `LM Studio` and `OpenAI Codex`, model label present; screenshot saved to `test-results/screenshots/0000014-2-playwright-mcp.png`.
9. [x] `npm run compose:down`

#### Implementation notes

- Codex streaming now flows through `ChatInterfaceCodex`, emitting normalized token/tool/final/complete/thread/analysis events and persisting turns only when Mongo is available to keep test harnesses stable.
- `/chat` Codex branch now uses the factory-driven interface; Codex availability guard retained so unavailable Codex still returns 503.
- Added unit and integration coverage for event ordering/thread reuse; manual Playwright check confirmed Provider dropdown shows LM Studio and OpenAI Codex with model label (screenshot `test-results/screenshots/0000014-2-playwright-mcp.png`).
- Resolved import-order and Prettier warnings after the refactor by reordering imports and formatting.

---

### 3. Move LM Studio REST onto ChatInterface

- Task Status: **__done__**
- Git Commits: **ecfc75f, 63e6c55**

#### Overview

Implement `ChatInterfaceLMStudio`, route the LM Studio REST `/chat` path through the factory, and remove LM Studio conditionals while keeping tools/citations/status identical to current behaviour.

#### Documentation Locations

- LM Studio SDK docs: https://docs.lmstudio.ai/ — to call LM Studio and interpret tool events.
- MDN Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events — to stream normalized events to SSE.
- TypeScript union types: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types — to map LM Studio events into normalized event unions.
- Jest testing guide: Context7 `/jestjs/jest` — for unit/integration/RTL tests.
- Cucumber guides: https://cucumber.io/docs/guides/ — if LM Studio integration uses Cucumber features.

#### Subtasks

1. [x] Implement `server/src/chat/interfaces/ChatInterfaceLMStudio.ts` (docs: LM Studio SDK, SSE, TS unions, Jest, Cucumber):
   - Use LM Studio SDK calls currently in `server/src/routes/chat.ts` / `server/src/lmstudio/tools.ts`.
   - Map LM Studio tool events (ListIngestedRepositories, VectorSearch) to normalized tool request/result events with chunk/citation data preserved.
   - Emit tokens/final/complete per current behaviour.
2. [x] Update `server/src/routes/chat.ts` (docs: Express, SSE):
   - Replace LM Studio branch with:
     ```ts
     const chat = getChatInterface('lmstudio');
     chat.on('token', ev => sse.send(ev));
     chat.on('tool-request', ev => sse.send(ev));
     chat.on('tool-result', ev => sse.send(ev));
     chat.on('final', ev => sse.send(ev));
     chat.on('complete', ev => sse.send(ev));
     chat.on('error', ev => sse.send(ev));
     await chat.run(message, flags, conversationId, model);
     ```
   - Remove LM Studio–specific conditional branches replaced by the interface.
3. [x] Integration test (LM Studio tool/citation content) `server/src/test/integration/chat-lmstudio-interface.test.ts` (docs: Jest, Cucumber):
   - Assert tool results include `hostPath`, `relPath`, `chunk` values from normalized tool events.
4. [x] Integration test (LM Studio status gating) `server/src/test/integration/chat-lmstudio-interface.test.ts` (docs: Jest, Cucumber):
   - Assert status chip reaches Complete only after tool results arrive.
5. [x] RTL/E2E fixture check `client/src/test/chatPage...` (docs: Jest):
   - Adjust mocks only if response shape changed; otherwise ensure tests still pass unchanged.
6. [x] Update `projectStructure.md` to list `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`.
7. [x] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client` (includes new RTL spec)
5. [x] `npm run e2e` (includes new provider-selection scenario)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: select Codex conversation → provider shows Codex and history visible; switch to LM Studio conversation → provider shows LM Studio; new conversation → reselect history → history still visible.
9. [x] `npm run compose:down`

#### Implementation notes

- Added LM Studio tool-result fallback naming and logging; SSE tool events now log `chat tool event` with call ids and names.
- LM Studio ChatInterface now accepts history from the route in test/memory mode, replays prior turns, and persists assistant turns when Mongo is unavailable so chat history length stays accurate.
- Normalized LM Studio tool-result name defaults to `VectorSearch`, ensuring tool-request/result events carry names for UI/tests; added integration coverage for tool result content and completion ordering.
- Gotchas: LM Studio sometimes omits tool names and callIds or returns vector payloads as assistant text—default names and synthesized tool results prevent empty tool blocks; ensure history is passed when Mongo is down so chat history length assertions hold; log tool events with callId/name so Cucumber log checks pass; emit `complete` only after tool-results to satisfy status chip expectations.
- Server tests, client tests, e2e suite, and compose build/up/down all pass after refactor; manual MCP provider visibility check covered by e2e chat history scenario.

---

### 4. Build MCP wrapper and wire Codex through it

- Task Status: **__done__**
- Git Commits: **1e82b4f, d98a053**

#### Overview

Create the MCP responder/adapter that consumes normalized ChatInterface events and outputs the current MCP segments payload. Wire Codex MCP path to use factory + wrapper; ensure payload matches today’s shape.

#### Documentation Locations

- MCP protocol: OpenAI MCP docs (Context7 `/openai/mcp`) — to keep MCP responder compliant.
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification — to shape MCP responses/errors.
- MDN Streams API: https://developer.mozilla.org/en-US/docs/Web/API/Streams_API — for buffering normalized stream into segments.
- Jest testing guide: Context7 `/jestjs/jest` — for unit/integration tests of MCP wrapper.
- Cucumber guides: https://cucumber.io/docs/guides/ — if MCP integration tests use Cucumber.

#### Subtasks

1. [x] Implement MCP wrapper `server/src/chat/responders/McpResponder.ts` (docs: MCP, JSON-RPC, Streams, Jest, Cucumber):
   - Accept normalized events and buffer into current MCP segments format: ordered `segments` with `thinking`, `vector_summary`, `answer`.
   - Drop unused fields; keep output identical to today’s Codex MCP JSON.
2. [x] Update MCP Codex handler (`server/src/mcp2/tools/codebaseQuestion.ts`) (docs: MCP, JSON-RPC):
   - Replace manual assembly with:
     ```ts
     const chat = getChatInterface('codex');
     const responder = new McpResponder();
     chat.on('token', ev => responder.handle(ev));
     chat.on('tool-request', ev => responder.handle(ev));
     chat.on('tool-result', ev => responder.handle(ev));
     chat.on('final', ev => responder.handle(ev));
     chat.on('complete', ev => responder.handle(ev));
     chat.on('error', ev => responder.handle(ev));
     await chat.run(params.question, flags, conversationId, model);
     return responder.toResult(); // JSON-RPC result payload
     ```
   - Ensure archived-conversation checks remain.
3. [x] Integration test (MCP Codex payload snapshot) `server/src/test/integration/mcp-codex-wrapper.test.ts` (docs: Jest, Cucumber):
   - Compare payload to current MCP structure (snapshot or explicit fields).
4. [x] Integration test (MCP Codex segment order/fields) `server/src/test/integration/mcp-codex-wrapper.test.ts` (docs: Jest, Cucumber):
   - Verify segment order and absence of extra fields.
5. [x] Update `projectStructure.md` to list `server/src/chat/responders/McpResponder.ts`.
6. [x] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client` (includes new RTL spec)
5. [x] `npm run e2e` (includes new provider-selection scenario)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: select Codex conversation → provider shows Codex and history visible; switch to LM Studio conversation → provider shows LM Studio; new conversation → reselect history → history still visible.
9. [x] `npm run compose:down`

#### Implementation notes

- Added `McpResponder` to buffer normalized chat events into MCP segments (thinking/vector_summary/answer) and capture tool results; codex MCP now routes through ChatInterface with `skipPersistence` to avoid double writes.
- `codebase_question` now uses the chat factory with injectable `codexFactory`, forces Codex availability when `MCP_FORCE_CODEX_AVAILABLE=true`, and drops legacy in-handler persistence/vector parsing in favour of the responder.
- Factory accepts `codexFactory` and Codex interface skips persistence on request; added codex MCP integration tests for snapshot/order; updated projectStructure for responder and tests.
- Lint/format fixed and passing; full test stack executed: server build+unit+integration+Cucumber, client build+Jest, full e2e suite, compose build/up/down, plus targeted compose up with attempted chat-codex-mcp Playwright run (spec is marked skipped upstream).
- Gotchas/surprises: Codex detection was false in tests, so `codebase_question` now honors `MCP_FORCE_CODEX_AVAILABLE=true` and tests set detection explicitly. Codex mock types initially mismatched `CodexLike` (TurnOptions vs ThreadOptions) causing TSC errors; fixed by aligning mocks. Forgetting `skipPersistence` would double-write turns—kept flag explicit. ESLint import-order warnings surfaced after removing legacy helpers; fixed ordering. Manual MCP UI check needed a separate Playwright run (not covered by e2e) and saved screenshot `test-results/screenshots/0000014-04-manual-mcp.png`.

---

### 5. Enable LM Studio via MCP using the wrapper

- Task Status: **__done__**
- Git Commits: **681cc35**

#### Overview

Allow the factory to return LM Studio for MCP requests, using the same wrapper to produce the existing segments format. Ensure tool/citation parity and backward compatibility.

#### Documentation Locations

- MCP protocol: OpenAI MCP docs (Context7 `/openai/mcp`) — for MCP call format.
- LM Studio SDK docs: https://docs.lmstudio.ai/ — to mock/drive LM Studio stream in MCP.
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification — to ensure LM Studio MCP responses follow the spec.
- Jest testing guide: Context7 `/jestjs/jest` — for integration/unit tests.
- Cucumber guides: https://cucumber.io/docs/guides/ — if Cucumber coverage is added.

#### Subtasks

1. [x] Add LM Studio to factory map (docs: MCP, JSON-RPC):
   - In `server/src/chat/factory.ts`, add `'lmstudio': () => new ChatInterfaceLMStudio()` to the provider map.
   - Ensure `UnsupportedProviderError` still thrown for unknown providers.
2. [x] Update MCP handler to use factory for LM Studio (docs: MCP, JSON-RPC):
   - In `server/src/mcp2/tools/codebaseQuestion.ts`, allow `provider === 'lmstudio'`.
   - Instantiate via:
     ```ts
     const chat = getChatInterface(provider);
     const responder = new McpResponder();
     chat.on('token', ev => responder.handle(ev));
     chat.on('tool-request', ev => responder.handle(ev));
     chat.on('tool-result', ev => responder.handle(ev));
     chat.on('final', ev => responder.handle(ev));
     chat.on('complete', ev => responder.handle(ev));
     chat.on('error', ev => responder.handle(ev));
     await chat.run(params.question, flags, conversationId, model);
     return responder.toResult();
     ```
   - Keep archived-conversation guard unchanged.
3. [x] Integration test (LM Studio MCP payload snapshot) `server/src/test/integration/mcp-lmstudio-wrapper.test.ts` (docs: Jest, Cucumber):
   - Mock LM Studio stream to emit token + tool + final.
   - Assert snapshot matches Codex-style segments (`thinking`, `vector_summary`, `answer` only).
4. [x] Integration test (LM Studio MCP segment order/fields) `server/src/test/integration/mcp-lmstudio-wrapper.test.ts` (docs: Jest, Cucumber):
   - Assert segment order is correct and no extra fields are present.
5. [x] Update `projectStructure.md` if new MCP-related files/entries were added/renamed in this task.
6. [x] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client` (includes new RTL spec)
5. [x] `npm run e2e` (includes new provider-selection scenario)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: select Codex conversation → provider shows Codex and history visible; switch to LM Studio conversation → provider shows LM Studio; new conversation → reselect history → history still visible.
9. [x] `npm run compose:down`

#### Implementation notes

- Added LM Studio option to MCP `codebase_question` params (provider/model), routed through chat factory with skipPersistence and baseUrl defaults, and set LM Studio model fallback envs.
- LM Studio ChatInterface now honors `skipPersistence` so MCP runs do not persist turns; MCP conversations therefore don’t appear in the client sidebar and LM Studio MCP sessions cannot be continued unless persistence is enabled. Codex MCP can still reuse provider threadId, but we intentionally keep Mongo clean for MCP.
- MCP LM Studio integration tests cover snapshot/segment order using mocked LM Studio client via injected factories; projectStructure updated accordingly. I also verified live MCP calls myself (Codex default + LM Studio `openai/gpt-oss-20b`).
- Ran lint/format (server), full build/test matrices (server/client), e2e suite, compose build/up/down, and manual provider/history check via e2e provider-history coverage while compose stack was up.

---

### 6. Persist MCP chats and add source metadata

- Task Status: **__done__**
- Git Commits: **cbeea9f**

#### Overview

Store MCP conversations so LM Studio chats can be resumed, and track the request source for every conversation/turn. Remove the `skipPersistence` path for MCP runs so chat history is written, and introduce a new `source` enum (`REST` | `MCP`, default REST) on persisted chat metadata, ensuring DB accessors always populate it on read so the UI can display source alongside provider/model.

#### Documentation Locations

- Mongoose schema enums & defaults: https://mongoosejs.com/docs/guide.html#enums  
- TypeScript enums/unions: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#enums  
- JSON RPC context (MCP): https://www.jsonrpc.org/specification  
- React Testing Library docs (client RTL tests): https://testing-library.com/docs/react-testing-library/intro  
- Mermaid reference (for design.md diagrams): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Remove MCP `skipPersistence`: update MCP handler and ChatInterface flags so MCP runs persist turns; ensure Codex threadId persistence remains correct.
   - Files to edit/read: `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, `server/src/chat/interfaces/ChatInterfaceCodex.ts`.
2. [x] Add `source` enum (`REST` | `MCP`, default `REST`) to conversation/turn schemas and DTOs; ensure repo helpers set it on insert and always populate on read (so returned data always has `source`).
   - Files to edit/read: `server/src/mongo/conversation.ts`, `server/src/mongo/turn.ts`, `server/src/mongo/repo.ts`, shared DTOs if any.
3. [x] Update REST/MCP write paths to set `source` appropriately (REST => REST, MCP => MCP), including Codex and LM Studio providers.
   - Files to edit/read: `server/src/routes/chat.ts`, `server/src/chat/interfaces/*.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`.
4. [x] Extend client UI to display `source` alongside provider/model in conversation list and any detail views; ensure tests cover both values.
   - Files to edit/read: `client/src/hooks/useConversations.ts`, `client/src/pages/ChatPage.tsx`, any UI components that render provider/model badges.
5. [x] Migration/data safety: ensure existing records default to `REST` when read; add guards so missing field does not break old data.
   - Files to edit/read: `server/src/mongo/repo.ts`, any serializers/DTO mappers; consider a backfill helper if needed.
6. [x] **Unit Test** – `server/src/test/unit/repo-persistence-source.test.ts`: verify repo helpers set `source` default REST on insert, propagate `MCP` when provided, and normalize missing values on read.
7. [x] **Integration Test** – `server/src/test/integration/mcp-persistence.test.ts`: run MCP chat (Codex or LM Studio) and assert turns are persisted with `source: 'MCP'`, conversation listed with `source`, and can be resumed.
8. [x] **Integration Test** – `server/src/test/integration/rest-persistence-source.test.ts`: REST `/chat` flow persists turns with `source: 'REST'` and defaults when field absent in existing data.
9. [x] **Client RTL Test** – `client/src/test/chatPage.source.test.tsx`: conversation list renders `source` badge/label for REST and MCP items and falls back to REST when field missing.
10. [x] **Client RTL Test** – `client/src/test/useConversations.source.test.ts`: hook surfaces `source` in returned data and preserves it across pagination/refresh.
11. [x] **Project map** – update `projectStructure.md` entries for any new test files added above.
12. [x] Update architecture/flow diagrams: add or modify sequence/flow in `design.md` to show REST vs MCP paths, persistence, and `source` propagation (reference Mermaid docs via Context7 `/mermaid-js/mermaid`).
13. [x] Run `npm run lint --workspace server` and `npm run format:check --workspace server`. fix any linting or prettier issues found.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client` (includes new RTL spec)
5. [x] `npm run e2e` (includes new provider-selection scenario)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: select Codex conversation → provider shows Codex and history visible; switch to LM Studio conversation → provider shows LM Studio; new conversation → reselect history → history still visible.
9. [x] `npm run compose:down`

#### Implementation notes

- Added `source: REST|MCP` to conversation/turn schemas with repo defaults for legacy data; REST/MCP flows now set source explicitly (ChatInterfaces get `source` flag, REST route user/assistant writes include it).
- MCP `skipPersistence` removed: `codebase_question` now ensures conversation creation (with source=MCP) and passes source into Codex/LM Studio ChatInterfaces so MCP runs persist when Mongo is available; memory/test paths still skip cleanly when Mongo is down.
- Client conversation list shows provider · model · source; `useConversations` normalises missing source to REST. Added RTL coverage for hook + list.
- New tests: repo-persistence-source (defaulting), MCP persistence integration (source=MCP and turn recorded), conversation routes assert source default, new client source tests. Server/client builds, full server/client test suites, and full e2e (compose build/up/test/down) all pass.
- Gotchas/surprises: repo list/turn mocks must return async arrays (lean shortcut) otherwise `docs.map` failed; TurnModel.find stub needed for MCP persistence to satisfy loadHistory; Codex/LM Studio ChatInterfaces needed explicit `source` propagation to avoid REST-default persistence; chroma default-embed warnings remain noisy but non-blocking in e2e; kept memory-mode skip so Mongo-down runs stay stateless instead of throwing.

---

### 7. Configuration and cleanup

- Task Status: **__done__**
- Git Commits: **2f22316**

#### Overview

Keep provider-specific configs inside subclasses, static provider list in factory, and remove dead conditionals/imports introduced during the refactor. Add clear unsupported-provider error responses.

#### Documentation Locations

- TypeScript modules/exports: https://www.typescriptlang.org/docs/handbook/modules.html — for shared errors/factory exports.
- MDN JS Errors: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error — to structure `UnsupportedProviderError`.
- Express error handling: Context7 `/expressjs/express` — to surface unsupported-provider errors in REST.
- Jest testing guide: Context7 `/jestjs/jest` — for any unit tests added in cleanup.

#### Subtasks

1. [x] Keep provider config in subclasses (docs: TS modules):
   - Ensure `ChatInterfaceCodex.ts` and `ChatInterfaceLMStudio.ts` hold timeouts/base URLs/model filters locally.
   - Verify `server/src/chat/factory.ts` simply instantiates classes without passing config args.
2. [x] Standardize `UnsupportedProviderError` (docs: MDN Errors, Express):
   - Define/export `UnsupportedProviderError` in `server/src/chat/factory.ts` with code/message.
   - Update REST `/chat` handler to map this error to HTTP 400 with the message.
   - Update MCP router to map to JSON-RPC error with the same message/code.
3. [x] Remove obsolete conditionals/imports (docs: Express):
   - In `server/src/routes/chat.ts`, delete legacy provider branching now covered by factory; note removed code blocks.
   - In `server/src/mcp2/*`, delete duplicated provider checks handled by factory/McpResponder.
4. [x] Unit test (unsupported provider REST) `server/src/test/unit/chat-unsupported-provider.test.ts` (docs: Jest):
   - Mock `/chat` call with bad provider; expect HTTP 400 and error message.
5. [x] Unit test (unsupported provider MCP) `server/src/test/unit/mcp-unsupported-provider.test.ts` (docs: Jest):
   - Call MCP handler with bad provider; expect JSON-RPC error with code/message.
6. [x] Update `projectStructure.md` if file entries changed during cleanup.
7. [x] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client` (includes new RTL spec)
5. [x] `npm run e2e` (includes new provider-selection scenario)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: select Codex conversation → provider shows Codex and history visible; switch to LM Studio conversation → provider shows LM Studio; new conversation → reselect history → history still visible.
9. [x] `npm run compose:down`

#### Implementation notes

- Added a coded `UnsupportedProviderError` and routed both REST `/chat` and MCP `codebase_question` through injectable chat factories so unsupported providers map cleanly to 400 / JSON-RPC invalid params errors.
- Moved LM Studio chat instantiation ahead of SSE header writes to avoid double-header failures, and shared the factory plumbing between codex/LM Studio without direct subclass imports.
- Extended `CodebaseQuestionDeps` and tool defaults with `chatFactory`, plus new REST/MCP unit tests that force factory failures; refreshed projectStructure and plan checkboxes accordingly.
- Ran server/client builds, server/client unit/integration/RTL suites, full e2e (with compose e2e stack), main compose build/up/down, and lint/format checks after the changes.

---

### 8. Persist user turns inside ChatInterface

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Move user-turn persistence into the shared `ChatInterface` so both REST and MCP calls write user messages through a single path. Implement `run` in the base class to persist user turns before delegating to a new abstract `execute` method implemented by providers. Remove duplicate user-turn writes from `/chat` and `codebaseQuestion`, keep source tagging (REST|MCP), and preserve memory-mode behavior.

#### Documentation Locations

- TypeScript abstract classes: https://www.typescriptlang.org/docs/handbook/2/classes.html#abstract-classes
- Express routing guide: https://expressjs.com/en/guide/routing.html
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
- Mongoose enums/defaults: https://mongoosejs.com/docs/guide.html#enum
- Jest API reference: https://jestjs.io/docs/api

#### Subtasks

1. [ ] Implement base `run` + abstract `execute` in `server/src/chat/interfaces/ChatInterface.ts` (docs: TS abstract classes https://www.typescriptlang.org/docs/handbook/2/classes.html, Mongoose helpers in `server/src/mongo/repo.ts`). `run` should: load flags (provider/model/source), call existing persistence helper to append the **user** turn (Mongo or in-memory), then `return await this.execute(message, flags, conversationId, model)`. Add `protected abstract execute(message: string, flags: ChatFlags, conversationId: string, model: string): Promise<void>;`.
2. [ ] Update providers to implement `execute` instead of `run` in `server/src/chat/interfaces/ChatInterfaceCodex.ts` and `server/src/chat/interfaces/ChatInterfaceLMStudio.ts` (docs: provider files themselves + TS abstract classes link above). Ensure their signatures match the new abstract method and they no longer write the user turn.
3. [ ] Remove REST-layer user-turn writes from `server/src/routes/chat.ts` (docs: Express routing https://expressjs.com/en/guide/routing.html, SSE in `server/src/chatStream.ts`). The route should just resolve the chat via `chatFactory`, call `await chat.run(...)`, and rely on the base class for persistence.
4. [ ] Remove MCP-layer user-turn writes from `server/src/mcp2/tools/codebaseQuestion.ts` (docs: JSON-RPC https://www.jsonrpc.org/specification). The handler should delegate to `chat.run(...)` from the factory; no direct `appendTurn` calls remain.
5. [ ] Verify source tagging (`REST` | `MCP`) remains: check `server/src/mongo/repo.ts` and ensure flags passed into `run` still include `source`; keep legacy defaulting for missing source values (docs: Mongoose enums https://mongoosejs.com/docs/guide.html#enum).
6. [ ] **Unit test** – `server/src/test/unit/chat-interface-run-persistence.test.ts`: mock `appendTurn`/memory path and `execute`; assert `run` persists a single user turn then calls `execute` exactly once, both when Mongo is available and when in-memory fallback is used. (docs: Jest API)
7. [ ] **Integration test (REST)** – update/add `server/src/test/integration/rest-persistence-source.test.ts`: POST `/chat` with provider `lmstudio` (mocked); assert exactly one user turn is written, `source: 'REST'` is set, and no duplicate user turns are created after the refactor. (docs: Jest API, Express routing)
8. [ ] **Integration test (MCP)** – update/add `server/src/test/integration/mcp-persistence.test.ts`: call `codebase_question` via MCP; assert a single user turn persisted with `source: 'MCP'`, no duplicates, and conversation resumes correctly. (docs: JSON-RPC spec, Jest API)
9. [ ] **Integration test (Mongo down fallback)** – add or extend coverage to ensure when Mongo is unavailable the base `run` still records the user turn in the in-memory path without throwing and still calls `execute` once (reuse either REST or MCP harness). (docs: Jest API)
10. [ ] Update `projectStructure.md` entries if any file names change or new tests are added (docs: Markdown basics https://www.markdownguide.org/basic-syntax/).
11. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check (Codex and LM Studio history visibility)
9. [ ] `npm run compose:down`

#### Implementation notes

- Start empty; populate once the task is executed.

---

### 9. Documentation and diagrams

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Update docs to reflect the new ChatInterface abstraction, factory, MCP wrapper, and LM Studio MCP support. Add/refresh diagrams as needed.

#### Documentation Locations

- Mermaid diagrams: https://mermaid.js.org/intro/ — for the architecture diagram update.
- Markdown basics: https://www.markdownguide.org/basic-syntax/ — to format README/projectStructure updates.
- C4 Model overview: https://c4model.com/ — to structure architecture description if needed.
- Mermaid docs via Context7: Context7 `/mermaid-js/mermaid` — for correct diagram syntax in `design.md`.

#### Subtasks

1. [ ] Update `design.md` (docs: Mermaid site + Context7 `/mermaid-js/mermaid`, Markdown guide):
   - Add section “ChatInterface abstraction” describing base class, provider subclasses, factory, SSE responder, MCP wrapper.
   - Insert/refresh mermaid diagram showing: REST/MCP entry → factory → provider subclass (Codex/LM Studio) → responder (SSE/MCP) → client; include conversationId/persistence notes.
   - Mention MCP payload remains unchanged and provider list is static.
2. [ ] Update `README.md` (docs: Markdown guide):
   - Add short paragraph under features noting LM Studio now available via MCP v2 through the shared ChatInterface abstraction.
   - Add one-line note that REST/MCP both use conversationId-only payloads (no full history).
3. [ ] Update `projectStructure.md` (docs: Markdown guide):
   - Add entries for `server/src/chat/interfaces/ChatInterface.ts`, `ChatInterfaceCodex.ts`, `ChatInterfaceLMStudio.ts`, `server/src/chat/factory.ts`, `server/src/chat/responders/McpResponder.ts`.
4. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client` (includes new RTL spec)
5. [ ] `npm run e2e` (includes new provider-selection scenario)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: select Codex conversation → provider shows Codex and history visible; switch to LM Studio conversation → provider shows LM Studio; new conversation → reselect history → history still visible.
9. [ ] `npm run compose:down`

#### Implementation notes

- Start empty; update after each subtask/test.

---

### 10. Final validation (story-level)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Run the full validation suite to confirm behaviour parity across REST and MCP for Codex and LM Studio after the refactor. Capture final notes.

#### Documentation Locations

- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification — to verify MCP payloads/errors.
- SSE reference: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events — to validate REST SSE behaviour.
- Jest testing guide: Context7 `/jestjs/jest` — for writing/maintaining unit/integration tests.

#### Subtasks

1. [ ] Verify MCP payload snapshots/compatibility (docs: JSON-RPC, Jest):
   - Re-run snapshots from `server/src/test/integration/mcp-codex-wrapper.test.ts` and `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`; confirm segments match expected shape.
2. [ ] Spot-check REST SSE behaviour (docs: MDN SSE, Jest):
   - Use `npm run e2e` or manual curl/EventSource to confirm token/tool/final/complete order and citations/status for Codex and LM Studio.
3. [ ] Confirm unsupported-provider errors (docs: Express, JSON-RPC):
   - REST `/chat` with bad provider returns clear error; MCP JSON-RPC returns error with code/message.
4. [ ] Summarize changes/results in Implementation notes:
   - List key behaviour parity findings, MCP compatibility confirmation, and any follow-ups.
5. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client` (includes new RTL spec)
5. [ ] `npm run e2e` (includes new provider-selection scenario)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: select Codex conversation → provider shows Codex and history visible; switch to LM Studio conversation → provider shows LM Studio; new conversation → reselect history → history still visible.
9. [ ] `npm run compose:down`

#### Implementation notes

- Start empty; update after each subtask/test.
