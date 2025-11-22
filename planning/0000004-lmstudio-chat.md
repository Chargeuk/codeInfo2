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

- LM Studio JS API: https://lmstudio.ai/docs/typescript
- LM Studio agent ACT: https://lmstudio.ai/docs/typescript/agent/act
- LM Studio JS GitHub (event shapes/examples): https://github.com/lmstudio-ai/lmstudio-js
- Express docs: https://expressjs.com/
- Existing design.md, README.md, projectStructure.md

#### Subtasks

1. [ ] Create `server/src/routes/chatModels.ts` exposing GET `/chat/models`: call `lmstudio.listDownloadedModels()`, map to `{ key, displayName, type }`, default to first entry when client requests no model; return 503 on LM Studio unreachable with `{ error }` body.
2. [ ] Register the router in `server/src/index.ts` under `/chat`; ensure CORS/JSON body middleware already present and keep typings aligned with existing router pattern.
3. [ ] Logging: emit start/success/failure log entries (no PII) with base URL reduced to `origin`; include model count on success.
4. [ ] Provide LM Studio mock for Cucumber: extend `server/src/test/support/mockLmStudioSdk.ts` (or add equivalent) to stub `listDownloadedModels` success + failure toggles.
5. [ ] Tests (server Cucumber): add `server/src/test/features/chat_models.feature` + step defs to cover success (returns list/default) and failure (LM Studio down -> 503/json error).
6. [ ] Update README.md (server/API sections) to include `/chat/models` usage and error behaviours.
7. [ ] Update design.md with the model fetch flow and error handling; add/update a mermaid diagram if flow changes. (Use mermaid docs via Context7.)
8. [ ] Update projectStructure.md with new server route/mock/test entries.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace server`
2. [ ] `npm run build --workspace server`
3. [ ] `npm run build --workspace client`
4. [ ] `npm run compose:build`
5. [ ] `npm run compose:up`
6. [ ] `npm run compose:down`

#### Implementation notes

- Note any retry/backoff choices or timeouts applied to LM Studio model listing.

---

### 2. Server Chat Streaming Endpoint

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement the streaming `/chat` POST using LM Studio `.act()` with a dummy tool, emitting SSE-style events for tokens/tool lifecycle/final/complete/error.

#### Documentation Locations

- LM Studio JS API: https://lmstudio.ai/docs/typescript
- LM Studio agent ACT: https://lmstudio.ai/docs/typescript/agent/act
- LM Studio JS GitHub (message/event shapes): https://github.com/lmstudio-ai/lmstudio-js
- Express docs: https://expressjs.com/
- SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
- Fetch streaming/ReadableStream: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing server patterns and mocks from Task 1

#### Subtasks

1. [ ] Implement POST `/chat` in `server/src/routes/chat.ts`: accept `{ model, messages }`, call `lmstudio.getModel(model).act()` with dummy tool registration, stream SSE (`text/event-stream`) via async iteration.
   - **LM Studio event shapes (from `.act()`):**
     - `onPredictionFragment` yields `{ type: 'predictionFragment', content: string, roundIndex: number }` — map to SSE `{ type: 'token', content, roundIndex }`.
     - `onMessage` yields final `ChatMessage` `{ role: 'assistant'|'tool'|'user'|'system', content: string|object, roundIndex: number }` — map to SSE `{ type: 'final', message, roundIndex }`.
     - Tool callbacks: `onToolCallRequestStart/NameReceived/ArgumentFragmentGenerated/End` → emit SSE `{ type: 'tool-request', callId, name, argsFragment?, roundIndex }` (omit/blank content); `onToolCallResult` → `{ type: 'tool-result', callId, result, roundIndex }`.
     - When iteration ends, send `{ type: 'complete' }`; on errors, send `{ type: 'error', message }`.
   - **SSE frames:** `data: {"type":"token","content":"Hello","roundIndex":0}\n\n`; start stream with heartbeat `:\n\n`.
2. [ ] Add a small stream helper (e.g., `server/src/chatStream.ts`) to format SSE frames, send initial heartbeat, JSON-stringify safely, and close on completion/error or request `close`; ensure `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
3. [ ] Register the route in `server/src/index.ts` under `/chat`; reuse existing middleware (body parser, logger) and guard payload size using existing limits.
4. [ ] Logging: log tool lifecycle events (content omitted), stream start/end, and errors to existing logger/store; keep tool details out of transcript.
5. [ ] Tests (server Cucumber): add `server/src/test/features/chat_stream.feature` + steps covering token/final happy path, tool redaction, and error framing using the LM Studio mock.
6. [ ] Update README.md (server/API sections) to include streaming `/chat`, payload shapes, and logging visibility (tool events redacted).
7. [ ] Update design.md with the chat streaming flow, event mapping, and tool logging redaction; include a mermaid sequence diagram for the streaming path.
8. [ ] Update projectStructure.md with new server route changes and test additions.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace server`
2. [ ] `npm run build --workspace server`
3. [ ] `npm run build --workspace client`
4. [ ] `npm run compose:build`
5. [ ] `npm run compose:up`
6. [ ] `npm run compose:down`

#### Implementation notes

- Document streaming payload shapes and tool redaction choices here during implementation.

---

### 3. Cancellation & Stop Control

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement cancellation/stop behaviour end-to-end: server-side cancellation of streaming predictions, client abort handling, and UI stop/new conversation controls integration.

#### Documentation Locations

- LM Studio JS API: https://lmstudio.ai/docs/typescript
- LM Studio agent ACT: https://lmstudio.ai/docs/typescript/agent/act
- LM Studio JS GitHub (act callbacks): https://github.com/lmstudio-ai/lmstudio-js
- AbortController/Fetch streaming: https://developer.mozilla.org/en-US/docs/Web/API/AbortController and https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing server/client streaming code from Tasks 1–2

#### Subtasks

1. [ ] Server: add cancellation handling to `/chat` stream (abort on client disconnect or Stop signal) using `OngoingPrediction.cancel()`/AbortSignal; ensure listeners are removed and response ends cleanly (update `server/src/routes/chat.ts` / stream helper).
2. [ ] Client hook: extend `useChatStream` in `client/src/hooks/useChatStream.ts` to hold an `AbortController`, pass `signal` to fetch/stream reader, and expose `stop()` that aborts and resets in-flight state.
3. [ ] Client UI integration (temporary): wire Stop/New conversation buttons on `client/src/pages/ChatPage.tsx` to hook methods; disable send while stopped state resolves.
4. [ ] Tests (server Cucumber): scenario for cancellation mid-stream (client disconnect) ensuring server stops emitting and logs cancellation.
5. [ ] Tests (client Jest): stop button aborts stream, disables send while active, and produces an error/stop bubble or completion state.
6. [ ] Update README.md (both server and client sections) to describe Stop/New conversation behaviour and lack of persistence.
7. [ ] Update design.md to capture cancellation flow, state transitions, and UX behaviour for Stop/New conversation; include a mermaid flow/sequence diagram for cancel/stop.
8. [ ] Update projectStructure.md if new files/hooks are added for cancellation wiring.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace server`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace server`
4. [ ] `npm run build --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`

#### Implementation notes

- Note any cancellation edge cases (stop before first token, multiple rapid stops) and logging decisions here.

---

### 4. Chat Page – Models List

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add the chat page route with an initial view that lists available models (from `/chat/models`), allows selection, and sets the default model for the session. Layout establishes the inverted page structure with input area placeholder but no send/stream yet.

#### Documentation Locations

- MUI MCP tool: @mui/material@7.2.0 docs (llms.mui.com/material-ui/7.2.0/llms.txt)
- React Router docs: https://reactrouter.com/
- design.md for layout/typography
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing NavBar/router patterns in `client/src/components/NavBar.tsx`, `client/src/routes/router.tsx`

#### Subtasks

1. [ ] Add `/chat` route and NavBar tab; ensure default page load focuses the model selector/input area.
2. [ ] Render model list/dropdown sourced from `/chat/models`, defaulting to the first model; show loading/empty/error states.
3. [ ] Establish inverted layout scaffold: controls at top, transcript area below (can be placeholder for now).
4. [ ] Place model selection state in a hook or context (e.g., `client/src/hooks/useChatModel.ts`) so later tasks can reuse it.
5. [ ] Update README.md (UI section) describing chat page entry and model selection.
6. [ ] Update design.md with layout and model list states; add a simple mermaid diagram showing page structure/data flow.
7. [ ] Update projectStructure.md with new page/component entries.
8. [ ] Tests (Jest/RTL): route renders, models fetched/displayed, default selection applies, error state shown on fetch failure.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run build --workspace server`
3. [ ] `npm run build --workspace client`
4. [ ] `npm run compose:build`
5. [ ] `npm run compose:up`
6. [ ] `npm run compose:down`

#### Implementation notes

- Note any placeholder UI decisions and how model selection state will be passed to later tasks.

---

### 5. Chat Page – Chat Functionality

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement chat send/receive on the chat page: connect input to streaming POST `/chat`, render bubbles with inverted order, and show inline error bubbles. New conversation and stop controls are added in later tasks.

#### Documentation Locations

- MUI MCP tool: @mui/material@7.2.0 docs
- design.md for bubble styles
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Client hooks/services from Task 4

#### Subtasks

1. [ ] Connect the input on `/chat` page to the chat service/hook: on submit, call streaming API with selected model and append a user bubble, then stream assistant tokens into a single assistant bubble (inverted order: newest just under input).
2. [ ] Add UI states: responding indicator (e.g., animated dots), disabled send while streaming, inline error bubble with retry guidance.
3. [ ] Keep tool events hidden in transcript but ensure `createLogger` records tool lifecycle to logs.
4. [ ] Update README.md (UI section) with chat send/receive behaviour and limitations (no persistence, stop/new conversation pending).
5. [ ] Update design.md with chat flow/rendering states and bubble styling (role left/right, inverted stack); include mermaid sketch of UI/data flow.
6. [ ] Update projectStructure.md for any new components/hooks/tests.
7. [ ] Tests (Jest/RTL): send triggers streaming call, tokens render incrementally into one assistant bubble, errors surface as bubbles, ordering is inverted.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run build --workspace server`
3. [ ] `npm run build --workspace client`
4. [ ] `npm run compose:build`
5. [ ] `npm run compose:up`
6. [ ] `npm run compose:down`

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
- MUI MCP tool: @mui/material@7.2.0 docs (buttons/layout)
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing chat hooks/services from Tasks 4–5

#### Subtasks

1. [ ] Implement New conversation control that clears messages/state, resets streaming flags, and (decision) either retains last selected model or resets to default—document choice.
2. [ ] Ensure any in-flight stream is aborted before clearing (leveraging cancellation hooks from Task 3) and UI re-focuses the input.
3. [ ] Update README.md (UI section) to document New conversation behaviour.
4. [ ] Update design.md with reset flow and UX copy; include mermaid snippet if flow changes.
5. [ ] Update projectStructure.md if new helpers/components are added.
6. [ ] Tests (Jest/RTL): button clears transcript, aborts active stream, and re-focuses input; verify model retention/reset behaviour matches doc.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run build --workspace server`
3. [ ] `npm run build --workspace client`
4. [ ] `npm run compose:build`
5. [ ] `npm run compose:up`
6. [ ] `npm run compose:down`

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
- MUI MCP tool: @mui/material@7.2.0 docs (buttons/status)
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Cancellation wiring from Task 3

#### Subtasks

1. [ ] Add Stop control to the chat UI; disable send while stop is available; re-enable on completion/cancel/error.
2. [ ] Wire Stop to client abort + server cancellation pathway; show stop/abort feedback (e.g., “Generation stopped”) in the transcript or status banner.
3. [ ] Update README.md (UI section) with Stop behaviour and limitations.
4. [ ] Update design.md with Stop flow/state transitions; add mermaid illustrating stop path.
5. [ ] Update projectStructure.md if new components/hooks are added.
6. [ ] Tests (Jest/RTL): stop button aborts stream, prevents further tokens, shows stopped state, and re-enables send.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run build --workspace server`
3. [ ] `npm run build --workspace client`
4. [ ] `npm run compose:build`
5. [ ] `npm run compose:up`
6. [ ] `npm run compose:down`

#### Implementation notes

- Capture UX decisions for showing a “stopped” marker vs. error bubble.

---

### 8. End-to-End & Documentation

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Validate the full stack (server chat endpoints + client chat UI) with Playwright, refresh documentation, and ensure logging covers tool events (redacted). Capture screenshots for evidence.

#### Documentation Locations

- Playwright docs: https://playwright.dev/docs/intro
- Docker docs: https://docs.docker.com/engine/ and Compose: https://docs.docker.com/compose/
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing README/design/projectStructure files

#### Subtasks

1. [ ] Add/extend Playwright spec to exercise chat flow:
   - Load chat page, wait for models dropdown to populate, assert at least one option, and change selection.
   - Send first prompt, stream response into assistant bubble, confirm completion.
   - Send follow-up prompt in same session and assert a second assistant response appears in order.
   - (Optional) verify Stop/New flows if time permits.
2. [ ] Ensure server/client logging shows tool lifecycle entries (content omitted) visible in Logs page; no tool events in transcript.
3. [ ] Update README with new endpoints (`/chat/models`, streaming `/chat`), usage notes, and limitations (no persistence, stop/new conversation).
4. [ ] Update design.md with the streaming flow, event mapping, UI states (responding, error bubble), and tool logging notes; refresh mermaid diagrams accordingly.
5. [ ] Update projectStructure.md with new files/dirs added in this story.
6. [ ] Save 2–3 screenshots of the Chat page (normal, streaming, error/stop) to `test-results/screenshots/0000004-8-*.png`.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace server`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace server`
4. [ ] `npm run build --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run e2e:test`
8. [ ] `npm run compose:down`

#### Implementation notes

- Record e2e findings, screenshot names, and any flakiness mitigations here.

---
