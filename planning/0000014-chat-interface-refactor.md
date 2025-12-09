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

- `design.md` (current chat flow and streaming details)
- `projectStructure.md` (file locations)
- plan_format instructions (this file)

#### Subtasks

1. [ ] Create `server/src/chat/interfaces/ChatInterface.ts` defining normalized event types (token, tool-request/result, final, complete, error) and shared methods for loading/persisting turns, applying flags, and emitting events (use typed callbacks or an EventEmitter).
2. [ ] Add `server/src/chat/factory.ts` with a static provider map (`codex`, `lmstudio`) returning the correct subclass (stub the subclasses for now). Include graceful unsupported-provider error.
3. [ ] Wire shared persistence helpers in the base class to call existing Mongo repo functions (load turns by conversationId, append turns/tool calls, update lastMessageAt). Do not change route code yet.
4. [ ] Add unit tests `server/src/test/unit/chat-interface-base.test.ts` covering event emission order, error propagation, and persistence hooks using fakes.
5. [ ] Add unit tests `server/src/test/unit/chat-factory.test.ts` covering provider selection and unsupported-provider error.
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

- `server/src/routes/chat.ts`
- `server/src/mcp2` (for Codex behaviour reference)
- `design.md` chat streaming section

#### Subtasks

1. [ ] Implement `server/src/chat/interfaces/ChatInterfaceCodex.ts` using the existing Codex client; map provider responses to normalized events.
2. [ ] Update `/chat` route to obtain the Codex interface via the factory and emit SSE from normalized events (reuse current SSE helper).
3. [ ] Remove Codex-specific conditionals from `chat.ts` now handled by the interface/factory.
4. [ ] Ensure Codex threadId persistence and flags are preserved; add/adjust integration tests `server/src/test/integration/chat-codex-interface.test.ts`.
5. [ ] Unit test Codex interface mapping (tokens, tool-request/result, final, complete, error).
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

- `server/src/lmstudio/*`
- `server/src/routes/chat.ts`
- `design.md` LM Studio tools/streaming sections

#### Subtasks

1. [ ] Implement `server/src/chat/interfaces/ChatInterfaceLMStudio.ts` using the LM Studio SDK/tools; map SDK events to normalized events.
2. [ ] Update `/chat` route to use factory for LM Studio path; remove LM-specific branching.
3. [ ] Ensure tool payloads/citations/status chips match current REST behaviour; adjust integration tests or add `server/src/test/integration/chat-lmstudio-interface.test.ts`.
4. [ ] Add/adjust RTL/e2e fixtures if needed to keep client expectations unchanged.
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

- `server/src/mcp2/*` (current MCP flow and payload)
- `design.md` MCP sections

#### Subtasks

1. [ ] Implement MCP wrapper (e.g., `server/src/chat/responders/McpResponder.ts`) that buffers normalized events into segments format used today, dropping unused fields.
2. [ ] Update MCP Codex handler to instantiate the interface via factory and pass events through the MCP wrapper; remove old Codex-specific MCP handling duplication.
3. [ ] Add compatibility tests `server/src/test/integration/mcp-codex-wrapper.test.ts` asserting payload equality with current contract (snapshot or explicit structure).
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

- `server/src/mcp2/*`
- `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`

#### Subtasks

1. [ ] Allow LM Studio in the static provider list for MCP path; ensure unsupported-provider handling remains clear.
2. [ ] Wire MCP handler to select LM Studio when requested; feed events through the MCP wrapper.
3. [ ] Add integration tests `server/src/test/integration/mcp-lmstudio-wrapper.test.ts` verifying segments format matches Codex-style contract (drop unused fields).
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

- `server/src/chat/factory.ts`
- `server/src/chat/interfaces/*`
- `design.md` (config notes)

#### Subtasks

1. [ ] Ensure provider config (timeouts, base URLs, model filters) lives in each subclass; factory stays a static selector.
2. [ ] Add explicit unsupported-provider error shape reused by REST and MCP paths.
3. [ ] Remove obsolete conditionals/imports from routes and MCP code paths now handled by factory/interfaces.
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

- `design.md`
- `README.md`
- `projectStructure.md`

#### Subtasks

1. [ ] Update `design.md` with the new architecture, factory flow, and MCP wrapper notes; include/update mermaid diagram.
2. [ ] Update `README.md` with brief notes on the abstraction and LM Studio MCP availability.
3. [ ] Update `projectStructure.md` to list new interface/factory/wrapper files.
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

- This plan
- `design.md` (for reference)

#### Subtasks

1. [ ] Verify MCP payload snapshots/compatibility for Codex and LM Studio.
2. [ ] Spot-check REST SSE behaviour for both providers (tokens, tools, status, citations).
3. [ ] Confirm unsupported-provider errors are clear in REST and MCP.
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
