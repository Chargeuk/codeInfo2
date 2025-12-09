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

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Create the foundational `ChatInterface` abstraction with normalized streaming events and a static-provider factory. No provider logic changes yet; only scaffolding and unit coverage to prove the event flow and factory selection.

#### Documentation Locations

- Node.js EventEmitter docs: https://nodejs.org/api/events.html
- TypeScript abstract classes/typing: https://www.typescriptlang.org/docs/handbook/2/classes.html
- JSON streaming basics (MDN Streams API): https://developer.mozilla.org/en-US/docs/Web/API/Streams_API

#### Subtasks

1. [ ] Create `server/src/chat/interfaces/ChatInterface.ts` with:
   - Exported normalized event types: `ChatTokenEvent { type:'token'; content:string }`, `ChatToolRequestEvent`, `ChatToolResultEvent`, `ChatFinalEvent`, `ChatCompleteEvent`, `ChatErrorEvent { message:string }`.
   - Abstract class `ChatInterface` exposing `run(message: string, flags, conversationId, model): Promise<void>` plus protected hooks `emit(event)`, `loadHistory(conversationId)`, `persistTurn(...)`.
   - Use Node EventEmitter (or a minimal internal emitter) to register listeners; include short code stub showing `on(eventType, handler)` usage.
2. [ ] Create `server/src/chat/factory.ts`:
   - Static provider map: `{ codex: () => new ChatInterfaceCodex(), lmstudio: () => new ChatInterfaceLMStudio() }` (use placeholder classes for now).
   - Export `getChatInterface(provider: 'codex'|'lmstudio')` throwing a typed `UnsupportedProviderError`.
   - Include code snippet in comments showing usage from routes.
3. [ ] Add persistence wiring in `ChatInterface`:
   - Import from `server/src/mongo/repo.ts`: `listTurns`, `appendTurn`, `updateConversationMeta`.
   - Implement `loadHistory(conversationId)` -> calls `listTurns({conversationId, limit: Infinity, cursor: undefined})`.
   - Implement `persistUser/assistant/tool turns` using `appendTurn`.
   - Do not change routes yet—only base class helpers.
4. [ ] Unit test (base events) `server/src/test/unit/chat-interface-base.test.ts`:
   - Use a fake subclass to emit token/final/complete; assert listeners fire in order.
5. [ ] Unit test (base persistence) `server/src/test/unit/chat-interface-base.test.ts`:
   - Mock repo functions; assert `loadHistory` and `persistTurn` are called with correct arguments.
6. [ ] Unit test (factory selection) `server/src/test/unit/chat-factory.test.ts`:
   - Assert `getChatInterface('codex')` returns Codex placeholder instance.
7. [ ] Unit test (factory unsupported) `server/src/test/unit/chat-factory.test.ts`:
   - Assert unsupported provider throws `UnsupportedProviderError` with code/message.
6. [ ] Run lint/format for touched areas.

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

### 2. Move Codex REST onto ChatInterface

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement `ChatInterfaceCodex` and route the Codex REST `/chat` path through the factory and base streaming events, preserving existing behaviour (tokens, tools, status, Codex threadId reuse).

#### Documentation Locations

- Express routing: Context7 `/expressjs/express`
- MDN Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- JSON-RPC 2.0 spec (for Codex thread handling reference): https://www.jsonrpc.org/specification

#### Subtasks

1. [ ] Implement `server/src/chat/interfaces/ChatInterfaceCodex.ts`:
   - Use existing Codex client (see `server/src/mcp2/tools/codebaseQuestion.ts` for reference).
   - Map Codex stream to normalized events; ensure tool-call events map to `ChatToolRequestEvent/ChatToolResultEvent`.
   - Preserve Codex threadId and include in flags as today.
2. [ ] Update `server/src/routes/chat.ts`:
   - For provider `codex`, call `getChatInterface('codex')` and stream normalized events through the existing SSE helper (show snippet replacing previous Codex branch).
   - Remove history payload acceptance (already enforced), keep conversationId flow unchanged.
3. [ ] Remove Codex-specific conditionals now handled by factory (document which branches deleted in `chat.ts`).
4. [ ] Integration test (SSE order) `server/src/test/integration/chat-codex-interface.test.ts`:
   - Assert SSE event order token -> tool request/result -> final -> complete.
5. [ ] Integration test (threadId persistence) `server/src/test/integration/chat-codex-interface.test.ts`:
   - Assert threadId is returned and persisted (mock repo or DB check).
6. [ ] Unit test (event mapping) `server/src/test/unit/chat-interface-codex.test.ts`:
   - Mock Codex client to emit token/final/error; assert normalized events fire.
6. [ ] Run lint/format for touched files.

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

### 3. Move LM Studio REST onto ChatInterface

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement `ChatInterfaceLMStudio`, route the LM Studio REST `/chat` path through the factory, and remove LM Studio conditionals while keeping tools/citations/status identical to current behaviour.

#### Documentation Locations

- LM Studio SDK docs (official): https://docs.lmstudio.ai/
- SSE basics: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- TypeScript union types (for event mapping): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types

#### Subtasks

1. [ ] Implement `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`:
   - Use LM Studio SDK calls currently in `server/src/routes/chat.ts` / `server/src/lmstudio/tools.ts`.
   - Map LM Studio tool events (ListIngestedRepositories, VectorSearch) to normalized tool request/result events with chunk/citation data preserved.
   - Emit tokens/final/complete per current behaviour.
2. [ ] Update `server/src/routes/chat.ts`:
   - For provider `lmstudio`, call `getChatInterface('lmstudio')` and stream normalized events through the SSE helper.
   - Remove LM Studio–specific conditional branches replaced by the interface.
3. [ ] Integration test (LM Studio tool/citation parity) `server/src/test/integration/chat-lmstudio-interface.test.ts`:
   - Assert tool results include `hostPath`, `relPath`, `chunk`; status chip reaches Complete only after tool results.
4. [ ] RTL/E2E fixture check `client/src/test/chatPage...` (existing files):
   - Adjust mocks only if response shape changed; otherwise ensure tests still pass unchanged.
5. [ ] Run lint/format for touched files.

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

### 4. Build MCP wrapper and wire Codex through it

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Create the MCP responder/adapter that consumes normalized ChatInterface events and outputs the current MCP segments payload. Wire Codex MCP path to use factory + wrapper; ensure payload matches today’s shape.

#### Documentation Locations

- MCP protocol: OpenAI MCP docs (Context7 `/openai/mcp`)
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- Streams to aggregation patterns (MDN Streams API): https://developer.mozilla.org/en-US/docs/Web/API/Streams_API

#### Subtasks

1. [ ] Implement MCP wrapper `server/src/chat/responders/McpResponder.ts`:
   - Accept normalized events and buffer into current MCP segments format: ordered `segments` with `thinking`, `vector_summary`, `answer`.
   - Drop unused fields; keep output identical to today’s Codex MCP JSON.
2. [ ] Update MCP Codex handler (`server/src/mcp2/tools/codebaseQuestion.ts`):
   - Obtain interface via `getChatInterface('codex')`, attach MCP wrapper, remove old Codex-specific assembly code.
   - Ensure archived-conversation checks remain.
3. [ ] Integration test (MCP Codex payload match) `server/src/test/integration/mcp-codex-wrapper.test.ts`:
   - Compare payload to current MCP structure (snapshot or explicit fields).
   - Verify segment order and absence of extra fields.
4. [ ] Run lint/format for touched files.

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

### 5. Enable LM Studio via MCP using the wrapper

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Allow the factory to return LM Studio for MCP requests, using the same wrapper to produce the existing segments format. Ensure tool/citation parity and backward compatibility.

#### Documentation Locations

- MCP protocol: OpenAI MCP docs (Context7 `/openai/mcp`)
- LM Studio SDK docs (official): https://docs.lmstudio.ai/
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification

#### Subtasks

1. [ ] Add LM Studio to factory static map for MCP usage; keep unsupported-provider error intact.
2. [ ] Update MCP handler to accept provider `lmstudio` and use MCP wrapper to produce current segments JSON.
3. [ ] Integration test (MCP LM Studio payload) `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`:
   - Mock LM Studio stream to emit token + tool + final; assert MCP payload matches Codex-style segments (no extra fields).
4. [ ] Run lint/format for touched files.

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

### 6. Configuration and cleanup

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Keep provider-specific configs inside subclasses, static provider list in factory, and remove dead conditionals/imports introduced during the refactor. Add clear unsupported-provider error responses.

#### Documentation Locations

- TypeScript module exports & errors: https://www.typescriptlang.org/docs/handbook/modules.html
- Error handling best practices (MDN JS Errors): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
- Express error responses: Context7 `/expressjs/express`

#### Subtasks

1. [ ] In each subclass file (`ChatInterfaceCodex.ts`, `ChatInterfaceLMStudio.ts`), keep provider-specific config (timeouts, base URLs, model filters) local; ensure factory map just instantiates without passing config.
2. [ ] Add shared `UnsupportedProviderError` in `server/src/chat/factory.ts` and reuse in REST and MCP handlers (adjust error handling in `chat.ts` and `mcp2` router to surface the same message/code).
3. [ ] Remove obsolete provider conditionals/imports from `server/src/routes/chat.ts` and `server/src/mcp2/*` that the factory/interfaces now cover; list removed blocks in implementation notes.
4. [ ] Run lint/format for touched files.

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

### 7. Documentation and diagrams

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Update docs to reflect the new ChatInterface abstraction, factory, MCP wrapper, and LM Studio MCP support. Add/refresh diagrams as needed.

#### Documentation Locations

- Mermaid diagrams: https://mermaid.js.org/intro/
- README style guidance (Markdown): https://www.markdownguide.org/basic-syntax/
- Architecture documentation patterns: https://c4model.com/

#### Subtasks

1. [ ] Update `design.md`:
   - Add a section “ChatInterface abstraction” describing base + factory + responders.
   - Add/refresh mermaid diagram showing REST/MCP -> factory -> provider subclass -> responder (SSE/MCP).
   - Note MCP payload compatibility and static provider list.
2. [ ] Update `README.md`:
   - Mention LM Studio now supported via MCP v2 using the shared ChatInterface.
   - Briefly describe factory selection and that MCP output shape is unchanged.
3. [ ] Update `projectStructure.md`:
   - Add entries for `server/src/chat/interfaces/ChatInterface.ts`, `ChatInterfaceCodex.ts`, `ChatInterfaceLMStudio.ts`, `server/src/chat/factory.ts`, `server/src/chat/responders/McpResponder.ts`.
4. [ ] Run lint/format for docs if applicable.

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

### 8. Final validation (story-level)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Run the full validation suite to confirm behaviour parity across REST and MCP for Codex and LM Studio after the refactor. Capture final notes.

#### Documentation Locations

- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- SSE behaviour reference: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- General test strategy (Jest): Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Verify MCP payload snapshots/compatibility for Codex and LM Studio (compare to stored fixtures from Task 4/5).
2. [ ] Spot-check REST SSE behaviour for both providers (tokens, tools, status, citations) using existing e2e or manual curl + EventSource.
3. [ ] Confirm unsupported-provider errors are clear in REST (`/chat`) and MCP (JSON-RPC error) when passing an unknown provider.
4. [ ] Summarize changes and results in Implementation notes.

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
