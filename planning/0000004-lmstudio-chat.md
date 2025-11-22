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

### 1. Server Chat Streaming & Models Endpoint

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Baseline plumbing for server-side chat endpoints and streaming contract to LM Studio using `.act()` with a dummy tool, plus logging hooks. Establishes the model list endpoint and the single-step streaming POST used by the client.

#### Documentation Locations

- LM Studio JS API docs: https://lmstudio.ai/docs/typescript
- LM Studio agent ACT docs: https://lmstudio.ai/docs/typescript/agent/act
- LM Studio JS GitHub: https://github.com/lmstudio-ai/lmstudio-js
- Express patterns: Context7 `/expressjs/express`
- Existing design.md, README.md, projectStructure.md

#### Subtasks

1. [ ] Add GET `/chat/models` on the server: fetch model list from LM Studio SDK, return names/ids; default model is the first entry. Handle LM Studio unreachability with clear errors.
2. [ ] Add POST `/chat` streaming endpoint (single-step): accepts `{ model, messages: [...], options? }`; invokes `model.act()` with a registered dummy tool (no-op) and streams via `text/event-stream` using async iteration. Emit events: `token`, `final`, `tool-request`, `tool-result`, `complete`, `error` (tool events redacted content). Respect abort/cancel on client disconnect.
3. [ ] Wire cancellation: call `OngoingPrediction.cancel()` (or AbortSignal) when client closes connection; ensure server stops emitting and cleans listeners.
4. [ ] Logging: log tool lifecycle events (content omitted), stream start/end, errors, and cancellations to existing logger/store; keep out of chat transcript.
5. [ ] Update server env/docs placeholders if any new knobs are needed (none expected in this story) and ensure payload size guards reuse existing limits.
6. [ ] Tests (server): add Cucumber feature(s) covering `/chat/models` success/failure, `/chat` streaming happy path (token/final), tool event redaction, cancellation handling, and error framing.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run lint --workspace server`
2. [ ] `npm run format:check --workspaces`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run build --workspace server`

#### Implementation notes

- Document streaming payload shapes and tool redaction choices here during implementation.

---

### 2. Client Chat Hooks & Services

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Create client-side services/hooks to fetch models, post chat turns, and consume the streaming response with cancellation. Ensure logging captures tool events (redacted) and errors, while maintaining the “disable while streaming” rule.

#### Documentation Locations

- LM Studio JS API docs: https://lmstudio.ai/docs/typescript
- ACT docs: https://lmstudio.ai/docs/typescript/agent/act
- Existing client logging/util patterns in `client/src/logging/*`
- React Router docs: Context7 `/remix-run/react-router`
- Fetch streaming/ReadableStream MDN

#### Subtasks

1. [ ] Add a client API module for `/chat/models` and streaming `/chat` POST using `fetch` + `ReadableStream`; parse server SSE-style lines into structured events.
2. [ ] Build a `useChatStream` hook managing messages state, in-flight flag, stop handler (AbortController), error bubble creation, and appending streamed tokens into the current assistant message.
3. [ ] Ensure tool events are logged (redacted content) but not rendered; integrate existing logger for start/end/error events.
4. [ ] Enforce UI rule: send disabled during stream; stop button triggers abort; “new conversation” clears state and aborts any active stream.
5. [ ] Tests (Jest): unit-test the stream parser, hook state transitions (send → streaming → final/error), abort path, and model fetch error handling.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run lint --workspace client`
2. [ ] `npm run format:check --workspaces`
3. [ ] `npm run test --workspace client`
4. [ ] `npm run build --workspace client`

#### Implementation notes

- Capture edge cases (empty model list, network drop mid-stream, cancel before first token) here.

---

### 3. Chat Page UI & Routing

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add the routed Chat page with inverted layout, model dropdown, chat bubbles, stop/new conversation controls, and inline error bubbles. Keep messages chronological downward with input at the top. Use MUI components per existing design language.

#### Documentation Locations

- MUI components (use MUI MCP tool): lists, cards, chips, text fields, buttons, selects
- Existing NavBar/router patterns in `client/src/components/NavBar.tsx`, `client/src/routes/router.tsx`
- Design/typography choices in design.md

#### Subtasks

1. [ ] Add `/chat` route and NavBar tab; ensure default page load focuses the input.
2. [ ] Implement layout: top section with model dropdown, multiline input, Send and Stop buttons, New conversation button; transcript below with role-based bubbles (LLM left, user right), inverted flow (newest just under input), and loading indicator during streaming.
3. [ ] Render error states as bubbles; show in-flight “responding” indicator; keep stop/send disabled states consistent with hook.
4. [ ] Accessibility: labels for inputs/selects/buttons, focus return to input after send/stop/new conversation; maintain contrast for bubbles.
5. [ ] Tests (Jest/RTL): render route, model selection updates state, send disables during stream, stop aborts stream, new conversation clears transcript, errors show as bubble.
6. [ ] Update projectStructure.md with new files (page, components, hooks, tests) and README client section with chat usage summary and limitations (no persistence, stop/new conversation, error bubbles).
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run lint --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace client`

#### Implementation notes

- Note any UI trade-offs (e.g., scrollbar behavior, bubble width) and mobile responsiveness decisions.

---

### 4. End-to-End & Documentation

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Validate the full stack (server chat endpoints + client chat UI) with Playwright, refresh documentation, and ensure logging covers tool events (redacted). Capture screenshots for evidence.

#### Documentation Locations

- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`
- Existing README/design/projectStructure files

#### Subtasks

1. [ ] Add/extend Playwright spec to exercise chat flow: load chat page, pick model, send prompt, see streamed response, use Stop, start New conversation, verify transcript reset.
2. [ ] Ensure server/client logging shows tool lifecycle entries (content omitted) visible in Logs page; no tool events in transcript.
3. [ ] Update README with new endpoints (`/chat/models`, streaming `/chat`), usage notes, and limitations (no persistence, stop/new conversation).
4. [ ] Update design.md with the streaming flow, event mapping, UI states (responding, error bubble), and tool logging notes.
5. [ ] Update projectStructure.md with new files/dirs added in this story.
6. [ ] Save 2–3 screenshots of the Chat page (normal, streaming, error/stop) to `test-results/screenshots/0000004-4-*.png`.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run lint --workspaces`
2. [ ] `npm run format:check --workspaces`
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
