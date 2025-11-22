# Story 0000004 – LM Studio Chat UI

## Description

Add a new client page that lets a user chat with an LLM running in LM Studio using the existing LM Studio JS API, via a server POST/streaming proxy. The chat session is ephemeral: each visit starts a fresh conversation, and no history is stored or retrieved from the server. The UI should invert the usual layout: input and model selector sit at the top, while older messages appear lower on the page. Chat bubbles must distinguish roles (LLM on the left, user on the right) and show streaming/complete responses. The chat loop should be structured so that future stories can plug in multiple tools via the LM Studio agent ACT pattern; for this story, wire a no-op dummy tool to prove the loop is tool-capable without performing actions. Users can carry on a full conversation during a session, but navigating away (or pressing a “New conversation” button) resets to a fresh, empty conversation.

Here’s the streaming approach we’ll use:

- **Server proxy:** Add a `/chat` POST that accepts the selected model + user message and immediately starts a streaming response. We’ll call `model.act()` from `@lmstudio/sdk`; it returns an `OngoingPrediction` that is both a Promise and an async iterable, so we can `for await` each event/token as it arrives.
  - Use a single-step POST that returns `text/event-stream` directly (simplest path); client will consume via `fetch` + `ReadableStream` instead of a GET/EventSource pair.
- **Transport to client:** The server will keep the HTTP connection open and emit Server-Sent Events (`text/event-stream`) with small payloads: `data: { type: "token" | "tool" | "final", content }`. This lets us surface multiple tool-response cycles that `.act()` may produce before the final answer.
- **Client consumption:** The chat page opens an `EventSource` (or fetch with `ReadableStream`) right after the POST is accepted, rendering each `token` chunk into the LLM bubble. When a `final` event arrives, we mark the turn complete and re-enable the send button.
- **Concurrency guard:** While a stream is active, the send control is disabled; once the stream closes or errors, it re-enables.
- **Model list + default:** Dropdown populated from LM Studio model list; first entry is selected by default for the session.
- **Dummy tool hook:** Register a no-op tool in the `.act()` call so the stream can include tool phases; client just displays the tool stage metadata.
- **Event mapping (from `.act()` callbacks):**
  - `onPredictionFragment` → emit `token` events shaped `data: { type: "token", content, roundIndex }` for incremental text.
  - `onMessage` → emit `final` events with the full `ChatMessage` (`role`, `content`, `roundIndex`) and mark the turn done.
  - Tool lifecycle: map `onToolCallRequestStart/NameReceived/ArgumentFragmentGenerated/End` to `tool-request` events carrying `callId`, `roundIndex`, `name`, and argument fragments; map `onToolCallResult` to `tool-result` with `result` payload; default execution is sequential (`allowParallelToolExecution` false).
  - Optional completion/heartbeat: when the async iterable ends, send a terminating `data: { type: "complete" }` or close the SSE stream; errors emit `data: { type: "error", message }` and close the connection so the client can re-enable input.
  - Tool events stay out of the chat transcript for now but must still be logged (content omitted/redacted) so operators can see tool activity via the Logs page.

### Acceptance Criteria

- A new routed page (e.g., `/chat`) accessible from the NavBar provides a chat interface to LM Studio models via the LM Studio JS API through a server proxy.
- Model selection is available at the top of the page via a dropdown populated from LM Studio’s model list; the first model in the list becomes the default selection.
  - Model list is served from a new dedicated server endpoint `/chat/models` (decoupled from `/lmstudio/status`).
- Input box sits at the top of the page; messages render in chronological order downward, with newest just under the input. Chat bubbles: LLM on the left, user on the right, visually distinct.
- Chat loop supports the LM Studio ACT/agent pattern with a registered dummy tool; hooks are structured so multiple tools can be added later without restructuring the page. Dummy tool is invoked/no-op to validate plumbing.
- Messages stream/render incrementally from the server proxy (or show a visible “responding” state) until completion; errors are surfaced inline with retry guidance. Server uses LM Studio `.act()` to support multiple tool-capable responses per request.
- Sending is disabled while a response is in flight to prevent concurrent requests.
- No temperature/max-tokens controls in this story.
- No persistence: navigating away and back resets the conversation; page copy or banner states this limitation.
- “New conversation” control clears transcript/state and starts a fresh session without reload.
- Basic accessibility: input labelled, dropdown labelled, bubbles readable with sufficient contrast, focus management keeps cursor in the input after send/response.
- A “Stop generating” control is available to cancel the in-flight stream when possible; cancellation re-enables the input.
- Errors surface as chat bubbles within the transcript (not just banners/toasts).

### Out Of Scope

- Storing or retrieving past conversations (no server endpoints, no local history persistence beyond in-memory state).
- Multi-user/authenticated chat or role management.
- Advanced tool implementations beyond the dummy no-op tool.
- Cost tracking, rate limiting, or model capability introspection beyond listing available models.
- Voice input/output or file attachments.

### Questions

- None (previous questions resolved and reflected in acceptance criteria).

## Implementation Plan

1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit & push that change, and only then begin implementation.
4. For each task, execute every subtask sequentially: before starting a subtask, read the documentation sources listed in that task; after finishing the subtask, run the relevant linters/formatters (Python + TypeScript) and fix issues before continuing.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, Move on to the Testing section and work through the tests in order
7. Once a test is complete, mark its checkbox.
8. After tests pass, perform every documentation update listed for the task.
9. Once a document is updated, mark its checkbox.
10. When all subtasks, tests, documentation updates, and verification commands are complete, consider the task finished and follow points 11–13 below.
11. As soon as a task’s implementation is done, add detailed notes in the Implementation notes section covering the code changes, decisions made, and any issues encountered. Push immediately after writing the notes.
12. Record the relevant git commit hash(es) in the Git Commits section. Once they are pushed, set the task status to `Done`, and push again so both the commit IDs and updated status are captured in this document.
13. After a task is fully documented (status, notes, commits), proceed to the next task and repeat the same process.


## Tasks

### 1. Server Models Endpoint

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Create a dedicated model list endpoint to supply the chat UI with available LM Studio models, keeping it decoupled from other LM Studio routes.

#### Documentation Locations

- LM Studio JS API docs: https://lmstudio.ai/docs/typescript
- LM Studio agent ACT docs: https://lmstudio.ai/docs/typescript/agent/act
- LM Studio JS GitHub: https://github.com/lmstudio-ai/lmstudio-js
- Express patterns: Context7 `/expressjs/express`
- Existing design.md, README.md, projectStructure.md

#### Subtasks

1. [ ] Add GET `/chat/models` on the server: fetch model list from LM Studio SDK, return names/ids; default model is the first entry. Handle LM Studio unreachability with clear errors.
2. [ ] Logging: log model fetch start/success/failure to existing logger/store (no PII), redacting any base URL details to origin only.
3. [ ] Tests (server Cucumber): cover `/chat/models` success and failure (LM Studio unavailable) with mocked SDK responses.
4. [ ] Provide controllable LM Studio mock for Cucumber: simulate `listDownloadedModels` responses and error paths; inject via dependency or env toggle in test bootstrap.
5. [ ] Update README.md (server/API sections) to include `/chat/models` usage and error behaviours.
6. [ ] Update design.md with the model fetch flow and error handling.
7. [ ] Update projectStructure.md with new server route/mock/test entries.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

3. [ ] `npm run test --workspace server`
4. [ ] `npm run build --workspace server`

#### Implementation notes

- Note any retry/backoff choices or timeouts applied to LM Studio model listing.

---

### 2. Server Chat Streaming Endpoint

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement the streaming `/chat` POST using LM Studio `.act()` with a dummy tool, emitting SSE-style events for tokens/tool lifecycle/final/complete/error.

#### Documentation Locations

- LM Studio JS API docs: https://lmstudio.ai/docs/typescript
- ACT docs: https://lmstudio.ai/docs/typescript/agent/act
- Existing server patterns and mocks from Task 1
- Fetch streaming/ReadableStream MDN

#### Subtasks

1. [ ] Add POST `/chat` streaming endpoint (single-step): accepts `{ model, messages: [...], options? }`; invokes `model.act()` with a registered dummy tool (no-op) and streams via `text/event-stream` using async iteration. Emit events: `token`, `final`, `tool-request`, `tool-result`, `complete`, `error` (tool events redacted content).
2. [ ] Logging: log tool lifecycle events (content omitted), stream start/end, and errors to existing logger/store; keep out of chat transcript.
3. [ ] Tests (server Cucumber): streaming happy path (token/final), tool event redaction, and error framing using the LM Studio mock.
4. [ ] Update README.md (server/API sections) to include streaming `/chat`, payload shapes, and logging visibility (tool events redacted).
5. [ ] Update design.md with the chat streaming flow, event mapping, and tool logging redaction.
6. [ ] Update projectStructure.md with new server route changes and test additions.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

3. [ ] `npm run test --workspace server`
4. [ ] `npm run build --workspace server`

#### Implementation notes

- Document streaming payload shapes and tool redaction choices here during implementation.

---

### 3. Cancellation & Stop Control

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement cancellation/stop behaviour end-to-end: server-side cancellation of streaming predictions, client abort handling, and UI stop/new conversation controls integration.

#### Documentation Locations

- LM Studio JS API docs: https://lmstudio.ai/docs/typescript
- ACT docs: https://lmstudio.ai/docs/typescript/agent/act
- Existing server/client streaming code from Tasks 1–2
- Fetch streaming/ReadableStream MDN

#### Subtasks

1. [ ] Server: add cancellation handling to `/chat` stream (abort on client disconnect or Stop signal) using `OngoingPrediction.cancel()`/AbortSignal; ensure cleanup of listeners.
2. [ ] Client: add stop control wiring using AbortController to cancel in-flight fetch/stream; propagate stop to server via abort; re-enable input after cancel.
3. [ ] Client: ensure “New conversation” also aborts active stream before clearing state.
4. [ ] Tests (server Cucumber): scenario for cancellation mid-stream (client disconnect) ensuring server stops emitting and logs cancellation.
5. [ ] Tests (client Jest): stop button aborts stream, disables send while active, and produces an error/stop bubble or completion state.
6. [ ] Update README.md (both server and client sections) to describe Stop/New conversation behaviour and lack of persistence.
7. [ ] Update design.md to capture cancellation flow, state transitions, and UX behaviour for Stop/New conversation.
8. [ ] Update projectStructure.md if new files/hooks are added for cancellation wiring.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`

#### Implementation notes

- Note any cancellation edge cases (stop before first token, multiple rapid stops) and logging decisions here.

---

### 4. Chat Page – Models List

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add the chat page route with an initial view that lists available models (from `/chat/models`), allows selection, and sets the default model for the session. Layout establishes the inverted page structure with input area placeholder but no send/stream yet.

#### Documentation Locations

- MUI components (use MUI MCP tool): lists, selects, loading states
- Existing NavBar/router patterns in `client/src/components/NavBar.tsx`, `client/src/routes/router.tsx`
- design.md for layout/typography

#### Subtasks

1. [ ] Add `/chat` route and NavBar tab; ensure default page load focuses the model selector/input area.
2. [ ] Render model list/dropdown sourced from `/chat/models`, defaulting to the first model; show loading/empty/error states.
3. [ ] Establish inverted layout scaffold: controls at top, transcript area below (can be placeholder for now).
4. [ ] Update README.md (UI section) describing chat page entry and model selection.
5. [ ] Update design.md with layout and model list states.
6. [ ] Update projectStructure.md with new page/component entries.
7. [ ] Tests (Jest/RTL): route renders, models fetched/displayed, default selection applies, error state shown on fetch failure.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace client`

#### Implementation notes

- Note any placeholder UI decisions and how model selection state will be passed to later tasks.

---

### 5. Chat Page – Chat Functionality

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement chat send/receive on the chat page: connect input to streaming POST `/chat`, render bubbles with inverted order, and show inline error bubbles. New conversation and stop controls are added in later tasks.

#### Documentation Locations

- MUI components for text input/buttons
- Client hooks/services from Task 4
- design.md for bubble styles

#### Subtasks

1. [ ] Wire send action to use chat hooks/services to stream responses; append assistant/user bubbles with inverted ordering (newest just under input).
2. [ ] Render streaming state (responding indicator) and error bubbles; maintain disabled send while streaming.
3. [ ] Ensure tool events remain hidden in transcript but are logged.
4. [ ] Update README.md (UI section) with chat send/receive behaviour and limitations (no persistence, stop/new conversation pending).
5. [ ] Update design.md with chat flow/rendering states and bubble styling.
6. [ ] Update projectStructure.md for any new components/hooks/tests.
7. [ ] Tests (Jest/RTL): send triggers streaming call, tokens render incrementally, errors surface as bubbles, ordering is inverted.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace client`

#### Implementation notes

- Capture any decisions on scroll behavior and bubble width here.

---

### 6. Chat Page – New Conversation Control

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add a “New conversation” button that clears the transcript and resets state to a fresh session without reload; ensure it aborts any active stream.

#### Documentation Locations

- design.md for UX states
- Existing chat hooks/services from Tasks 4–5

#### Subtasks

1. [ ] Implement New conversation control that clears messages/state and resets selected model/inputs as appropriate.
2. [ ] Ensure any in-flight stream is aborted before clearing (leveraging cancellation hooks from Task 3).
3. [ ] Update README.md (UI section) to document New conversation behaviour.
4. [ ] Update design.md with reset flow and UX copy.
5. [ ] Update projectStructure.md if new helpers/components are added.
6. [ ] Tests (Jest/RTL): button clears transcript, aborts active stream, and re-focuses input.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace client`

#### Implementation notes

- Note any state reset nuances (model selection retained or reset to default?).

---

### 7. Chat Page – Stop Control UI

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add a Stop/Cancel button on the chat page that halts an in-progress response, coordinating with server cancellation and client abort handling.

#### Documentation Locations

- design.md for UX/controls
- Cancellation wiring from Task 3

#### Subtasks

1. [ ] Add Stop control to the chat UI; disable send while stop is available; re-enable on completion/cancel/error.
2. [ ] Wire Stop to client abort + server cancellation pathway; show stop/abort feedback in the transcript or status.
3. [ ] Update README.md (UI section) with Stop behaviour and limitations.
4. [ ] Update design.md with Stop flow/state transitions.
5. [ ] Update projectStructure.md if new components/hooks are added.
6. [ ] Tests (Jest/RTL): stop button aborts stream, prevents further tokens, shows stopped state, and re-enables send.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace client`

#### Implementation notes

- Capture UX decisions for showing a “stopped” marker vs. error bubble.

---

### 8. End-to-End & Documentation

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Validate the full stack (server chat endpoints + client chat UI) with Playwright, refresh documentation, and ensure logging covers tool events (redacted). Capture screenshots for evidence.

#### Documentation Locations

- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`
- Existing README/design/projectStructure files

#### Subtasks

1. [ ] Add/extend Playwright spec to exercise chat flow:
   - Load chat page, wait for models dropdown to populate, assert at least one option, and change selection.
   - Send first prompt, stream response into assistant bubble, confirm completion.
   - Send follow-up prompt in same session and assert a second assistant response appears in order.
   - (Optional) verify Stop/New flows if time permits.
2. [ ] Ensure server/client logging shows tool lifecycle entries (content omitted) visible in Logs page; no tool events in transcript.
3. [ ] Update README with new endpoints (`/chat/models`, streaming `/chat`), usage notes, and limitations (no persistence, stop/new conversation).
4. [ ] Update design.md with the streaming flow, event mapping, UI states (responding, error bubble), and tool logging notes.
5. [ ] Update projectStructure.md with new files/dirs added in this story.
6. [ ] Save 2–3 screenshots of the Chat page (normal, streaming, error/stop) to `test-results/screenshots/0000004-8-*.png`.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e:test`
6. [ ] `npm run build:all`
7. [ ] `npm run compose:build`
8. [ ] `npm run compose:up`
9. [ ] `npm run compose:down`

#### Implementation notes

- Record e2e findings, screenshot names, and any flakiness mitigations here.

---
