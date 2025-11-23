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

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __in_progress__
- Git Commits: 9a6c1c7, 0aac90f

#### Overview

Create a dedicated model list endpoint to supply the chat UI with available LM Studio models, keeping it decoupled from other LM Studio routes.

#### Documentation Locations

- LM Studio JS API: https://lmstudio.ai/docs/typescript
- LM Studio agent ACT: https://lmstudio.ai/docs/typescript/agent/act
- LM Studio JS GitHub (event shapes/examples): https://github.com/lmstudio-ai/lmstudio-js
- Express docs: https://expressjs.com/ and Context7 `/expressjs/express`
- Existing design.md, README.md, projectStructure.md

#### Subtasks

1. [x] Create `server/src/routes/chatModels.ts` exposing GET `/chat/models`: call `lmstudio.listDownloadedModels()`, map to `{ key, displayName, type }`, default to first entry when client requests no model; return 503 on LM Studio unreachable with `{ error }` body.
2. [x] Register the router in `server/src/index.ts` under `/chat`; ensure CORS/JSON body middleware already present and keep typings aligned with existing router pattern.
3. [x] Logging: emit start/success/failure log entries (no PII) with base URL reduced to `origin`; include model count on success.
4. [x] Document the exact `/chat/models` contract here and reuse it everywhere: 200 response body = `[ { "key": "llama-3", "displayName": "Llama 3 Instruct", "type": "gguf" } ]`; 503 body = `{ "error": "lmstudio unavailable" }`. Create a shared fixture `mockModels` with that single entry for both the mock SDK and client RTL tests.
5. [x] Provide LM Studio mock for Cucumber: extend `server/src/test/support/mockLmStudioSdk.ts` (or add equivalent) to stub `listDownloadedModels` success + failure toggles using the `mockModels` fixture; export helpers to flip failure mode.
6. [x] Tests (server Cucumber): add `server/src/test/features/chat_models.feature` + step defs to cover success (returns list/default) and failure (LM Studio down -> 503/json error) using the fixture payloads above.
7. [x] Update README.md (server/API sections) to include `/chat/models` usage and error behaviours.
8. [x] Update design.md with the model fetch flow and error handling; add/update a mermaid diagram if flow changes. (Use mermaid docs via Context7.)
9. [x] Update projectStructure.md with new server route/mock/test entries.
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

**Implementation scaffolds (for juniors)**
- Hook idea `client/src/hooks/useChatStream.ts`:
  ```ts
  import { useEffect, useRef, useState } from 'react';

  export function useChatStream(model: string | undefined) {
    const controllerRef = useRef<AbortController | null>(null);
    const [messages, setMessages] = useState([]);
    const [status, setStatus] = useState<'idle'|'sending'|'error'>('idle');

    const send = async (text: string) => {
      if (!model) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setStatus('sending');
      setMessages(prev => [...prev, { role: 'user', content: text }]);

      const res = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [...messages, { role: 'user', content: text }] }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistant = '';
      while (reader) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer.split('\n\n').forEach(line => {
          if (line.startsWith('data:')) {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.type === 'token') assistant += payload.content;
            if (payload.type === 'final') assistant = payload.message.content;
            if (payload.type === 'error') setStatus('error');
          }
        });
        setMessages(prev => [...prev.filter(m => m.role !== 'assistant-temp'), { role: 'assistant-temp', content: assistant }]);
      }
      setMessages(prev => [...prev.filter(m => m.role !== 'assistant-temp'), { role: 'assistant', content: assistant }]);
      setStatus('idle');
    };

    useEffect(() => () => controllerRef.current?.abort(), []);

    return { send, messages, status, stop: () => controllerRef.current?.abort() };
  }
  ```
- Bubble rendering (inverted order: newest near top controls):
  ```tsx
  <Stack spacing={1} sx={{ flexDirection: 'column' }}>
    {[...messages].reverse().map((m, idx) => (
      <Box key={idx} sx={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
        <Paper sx={{ p: 1.5, bgcolor: m.role === 'user' ? 'primary.main' : 'background.paper', color: m.role === 'user' ? 'primary.contrastText' : 'text.primary' }}>
          <Typography variant="body2">{m.content}</Typography>
        </Paper>
      </Box>
    ))}
  </Stack>
  ```
- Error bubble example: push `{ role: 'assistant', content: 'Error: ...', error: true }` and style with `color="error.main"`.

**Commands (copy/paste)**
- Focused client test: `npm run test --workspace client -- chat`
- Manual streaming check: open `/chat`, select model, type “hello”, observe token streaming.

**Implementation scaffolds (for juniors)**
- Files to create/update:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/hooks/useChatModel.ts`
  - Add route/tab in `client/src/routes/router.tsx` and `client/src/components/NavBar.tsx`
- Hook idea `useChatModel.ts`:
  ```ts
  import { useEffect, useState } from 'react';

  export function useChatModel() {
    const [models, setModels] = useState([]);
    const [selected, setSelected] = useState<string | undefined>();
    const [status, setStatus] = useState<'idle'|'loading'|'error'>('idle');

    useEffect(() => {
      let cancelled = false;
      setStatus('loading');
      fetch(`${import.meta.env.VITE_API_URL}/chat/models`)
        .then(r => r.json())
        .then(data => { if (!cancelled) { setModels(data); setSelected(data[0]?.key); setStatus('idle'); } })
        .catch(() => !cancelled && setStatus('error'));
      return () => { cancelled = true; };
    }, []);

    return { models, selected, setSelected, status };
  }
  ```
- Layout suggestion for `ChatPage.tsx` (inverted):
  ```tsx
  return (
    <Container maxWidth="lg">
      <Stack spacing={2} sx={{ pt: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
          <FormControl sx={{ minWidth: 240 }}>
            <InputLabel id="chat-model-label">Model</InputLabel>
            <Select ...>
              {models.map(m => <MenuItem key={m.key} value={m.key}>{m.displayName}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField fullWidth label="Message" placeholder="Type your prompt" disabled />
        </Stack>
        <Paper variant="outlined" sx={{ minHeight: 320, p: 2 }}>
          <Typography color="text.secondary">Transcript will appear here...</Typography>
        </Paper>
      </Stack>
    </Container>
  );
  ```
- State/error cues: show `CircularProgress` for loading; `Alert` for errors; `Typography` for empty state when models=[].

**Commands (copy/paste)**
- Run client tests only: `npm run test --workspace client -- ChatPage`
- Manual UI check: `npm run dev --workspace client` then open `http://localhost:5001/chat`

**Implementation scaffolds (for juniors)**
- Route file: `server/src/routes/chat.ts`
  ```ts
  import { Router } from 'express';
  import { logger } from '../logger';
  import { startStream, writeEvent, endStream } from '../chatStream';

  const router = Router();

  router.post('/', async (req, res) => {
    const { model, messages } = req.body;
    startStream(res);
    try {
      const ongoing = await lmstudio.getModel(model).act({
        messages,
        tools: [{
          name: 'noop',
          description: 'does nothing',
          execute: async () => ({ result: 'noop' }),
        }],
        allowParallelToolExecution: false,
      });

      for await (const event of ongoing) {
        if (event.type === 'predictionFragment') {
          writeEvent(res, { type: 'token', content: event.content, roundIndex: event.roundIndex });
        }
        if (event.type === 'message') {
          writeEvent(res, { type: 'final', message: event.message, roundIndex: event.roundIndex });
        }
      }
      writeEvent(res, { type: 'complete' });
      endStream(res);
    } catch (err: any) {
      logger.error({ err }, 'chat stream error');
      writeEvent(res, { type: 'error', message: err?.message ?? 'unknown error' });
      endStream(res);
    }
  });

  export default router;
  ```
- Stream helper skeleton `server/src/chatStream.ts`:
  ```ts
  import { Response } from 'express';

  export function startStream(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(':\n\n');
  }

  export const writeEvent = (res: Response, payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  export const endStream = (res: Response) => res.end();
  ```
- Tool event mapping hint:
  ```ts
  if (event.type === 'toolCallRequestStart') {
    writeEvent(res, { type: 'tool-request', callId: event.callId, roundIndex: event.roundIndex });
  }
  ```
- Cucumber step outline for streaming:
  ```ts
  When('I start a chat stream', async () => {
    res = await fetch(`${baseUrl}/chat`, { method: 'POST', body: JSON.stringify(body), headers });
    chunks = await collectSse(res);
  });
  Then('I see a token event', () => {
    assert.ok(chunks.find(c => c.type === 'token'));
  });
  ```

**SSE payload examples**
- Happy path:
  - `data: {"type":"token","content":"Hello","roundIndex":0}`
  - `data: {"type":"final","message":{"role":"assistant","content":"Hello"},"roundIndex":0}`
  - `data: {"type":"complete"}`
- Error path: `data: {"type":"error","message":"lmstudio unavailable"}` then stream ends.

**Commands (copy/paste)**
- Run single feature: `npm run test --workspace server -- --name "chat stream"`
- Manual curl (replace payload):
  ```sh
  curl -N -X POST http://localhost:5010/chat \
    -H 'content-type: application/json' \
    -d '{"model":"llama","messages":[{"role":"user","content":"hello"}]}'
  ```

**Implementation scaffolds (for juniors)**
- Suggested file: `server/src/routes/chatModels.ts`
  ```ts
  import { Router } from 'express';
  import { lmstudio } from '../lmstudioClient'; // adjust import to actual helper
  import { logger } from '../logger';

  const router = Router();

  router.get('/models', async (_req, res) => {
    try {
      const models = await lmstudio.listDownloadedModels();
      logger.info({ models: models.length }, 'chat models fetched');
      res.json(models.map(m => ({ key: m.modelKey, displayName: m.displayName, type: m.type })));
    } catch (err: any) {
      logger.error({ err }, 'chat models failed');
      res.status(503).json({ error: err?.message ?? 'lmstudio unavailable' });
    }
  });

  export default router;
  ```
- Register in `server/src/index.ts`:
  ```ts
  import chatModelsRouter from './routes/chatModels.js';
  app.use('/chat', chatModelsRouter);
  ```
- Cucumber step stub (for `chat_models.feature`):
  ```ts
  When('I request chat models', async () => {
    const res = await fetch(`${baseUrl}/chat/models`);
    response = { status: res.status, body: await res.json() };
  });
  Then('I receive at least {int} models', (min) => {
    assert.ok(response.body.length >= min);
  });
  ```
- Mock toggle idea in `server/src/test/support/mockLmStudioSdk.ts`:
  ```ts
  let failModels = false;
  export const setModelsFail = (val: boolean) => { failModels = val; };
  export const lmstudio = {
    listDownloadedModels: async () => {
      if (failModels) throw new Error('lmstudio down');
      return [{ modelKey: 'llama', displayName: 'Llama', type: 'gguf' }];
    },
  };
  ```

**Commands (copy/paste)**
- Run single feature: `npm run test --workspace server -- --name "chat models"`
- Start server for manual curl with mock enabled (if needed): `npm run dev --workspace server`
- Manual check: `curl http://localhost:5010/chat/models`

#### Testing

1. [x] `npm run test --workspace server`
2. [x] `npm run build --workspace server`
3. [x] `npm run build --workspace client`
4. [x] `npm run compose:build`
5. [x] `npm run compose:up`
6. [x] `npm run compose:down`

#### Implementation notes
- Added /chat/models route with sanitized base URL, start/success/failure logging, and 503 fallback when LM Studio is unreachable.
- Shared chat model fixture lives in common and feeds the LM Studio mock for Cucumber coverage.
- New chat_models feature/steps validate success and failure; reran server tests, server/client builds, and compose build/up/down successfully.
- Updated README, design mermaid flow, and projectStructure to document the endpoint and fixtures.
- Switched server test scripts to cross-env for cross-platform env vars; validated npm test on Windows.

- Note any retry/backoff choices or timeouts applied to LM Studio model listing.

---

### 2. Server Chat Streaming Endpoint

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __to_do__
- Git Commits: a3f3019, 6270e34

#### Overview

Implement the streaming `/chat` POST using LM Studio `.act()` with a dummy tool, emitting SSE-style events for tokens/tool lifecycle/final/complete/error.

#### Documentation Locations

- LM Studio JS API: https://lmstudio.ai/docs/typescript
- LM Studio agent ACT: https://lmstudio.ai/docs/typescript/agent/act
- LM Studio JS GitHub (message/event shapes): https://github.com/lmstudio-ai/lmstudio-js
- Express docs: https://expressjs.com/ and Context7 `/expressjs/express`
- SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
- Fetch streaming/ReadableStream: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing server patterns and mocks from Task 1

#### Subtasks

1. [x] Implement POST `/chat` in `server/src/routes/chat.ts`: accept `{ model, messages }`, call `lmstudio.getModel(model).act()` with dummy tool registration, stream SSE (`text/event-stream`) via async iteration.
   - **LM Studio event shapes (from `.act()`):**
     - `onPredictionFragment` yields `{ type: 'predictionFragment', content: string, roundIndex: number }` — map to SSE `{ type: 'token', content, roundIndex }`.
     - `onMessage` yields final `ChatMessage` `{ role: 'assistant'|'tool'|'user'|'system', content: string|object, roundIndex: number }` — map to SSE `{ type: 'final', message, roundIndex }`.
     - Tool callbacks: `onToolCallRequestStart/NameReceived/ArgumentFragmentGenerated/End` → emit SSE `{ type: 'tool-request', callId, name, argsFragment?, roundIndex }` (omit/blank content); `onToolCallResult` → `{ type: 'tool-result', callId, result, roundIndex }`.
     - When iteration ends, send `{ type: 'complete' }`; on errors, send `{ type: 'error', message }`.
   - **SSE frames:** `data: {"type":"token","content":"Hello","roundIndex":0}\n\n`; start stream with heartbeat `:\n\n`.
2. [x] Nail down and reuse canonical `/chat` fixtures: request body = `{ "model": "llama-3", "messages": [ { "role": "user", "content": "hello" } ] }`; happy-path SSE frames = token `data:{"type":"token","content":"Hi","roundIndex":0}\n\n`, final `data:{"type":"final","message":{"role":"assistant","content":"Hi"},"roundIndex":0}\n\n`, complete `data:{"type":"complete"}\n\n`; error SSE = `data:{"type":"error","message":"lmstudio unavailable"}\n\n`. Use these fixtures consistently in Cucumber steps, mock SDK responses, and client RTL tests.
3. [x] Add a small stream helper (e.g., `server/src/chatStream.ts`) to format SSE frames, send initial heartbeat, JSON-stringify safely, and close on completion/error or request `close`; ensure `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Provide a scaffold:
   ```ts
   export function startStream(res) {
     res.setHeader('Content-Type', 'text/event-stream');
     res.setHeader('Cache-Control', 'no-cache');
     res.setHeader('Connection', 'keep-alive');
     res.write(':\n\n');
   }
   export const writeEvent = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
   export const endStream = (res) => res.end();
   ```
4. [x] Register the route in `server/src/index.ts` under `/chat`; reuse existing middleware (body parser, logger) and guard payload size using existing limits.
5. [x] Logging: log tool lifecycle events (content omitted), stream start/end, and errors to existing logger/store; keep tool details out of transcript.
6. [x] Tests (server Cucumber): add `server/src/test/features/chat_stream.feature` + steps covering token/final happy path, tool redaction, and error framing using the LM Studio mock and the canonical fixtures above.
7. [x] Update README.md (server/API sections) to include streaming `/chat`, payload shapes, and logging visibility (tool events redacted).
8. [x] Update design.md with the chat streaming flow, event mapping, and tool logging redaction; include a mermaid sequence diagram for the streaming path.
9. [x] Update projectStructure.md with new server route changes and test additions.
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run test --workspace server`
2. [x] `npm run build --workspace server`
3. [x] `npm run build --workspace client`
4. [x] `npm run compose:build`
5. [x] `npm run compose:up`
6. [x] `npm run compose:down`

#### Implementation notes

- Added `server/src/routes/chat.ts` streaming SSE endpoint using LM Studio `.act()` with a noop tool, heartbeat start, and metadata-only tool events; payloads capped by `LOG_MAX_CLIENT_BYTES`.
- New `server/src/chatStream.ts` helper centralizes SSE start/write/end safeguards; reused by the route tests.
- Canonical chat fixtures live in `common/src/fixtures/chatStream.ts` (request, token/final/complete, error) and feed the mock LM Studio client + Cucumber steps.
- Cucumber `chat_stream.feature/steps` parse the SSE stream and assert token/final/complete ordering and error framing; compose/lint/build scripts all pass post-changes.

---

### 3. Cancellation & Stop Control

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __done__
- Git Commits: 9a6c1c7, 0aac90f, afab79a

#### Overview

Implement server-side cancellation of streaming predictions; client stop/new controls are handled in later tasks (UI tasks 6–7). This task focuses only on the server responding to aborted connections.

#### Documentation Locations

- LM Studio JS API: https://lmstudio.ai/docs/typescript
- LM Studio agent ACT: https://lmstudio.ai/docs/typescript/agent/act
- LM Studio JS GitHub (act callbacks): https://github.com/lmstudio-ai/lmstudio-js
- AbortController/Fetch streaming: https://developer.mozilla.org/en-US/docs/Web/API/AbortController and https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing server/client streaming code from Tasks 1–2

#### Subtasks

1. [x] Server: in `server/src/routes/chat.ts` wire an `AbortController` passed into `lmstudio.act` and call `ongoing.cancel?.()` on abort; reuse `chatStream` helper to end the SSE. Comment the handler so juniors know why it runs.
2. [x] Add `req.on('close')` + `req.on('aborted')` to stop emitting, call `controller.abort()`, invoke `cancel()`, and `endStream(res)`; guard against double-end.
3. [x] Add a tiny helper (if missing) in `server/src/chatStream.ts` to no-op when res.finished; export it and use it from the route.
4. [x] Tests (Cucumber): create `server/src/test/features/chat_cancellation.feature` and steps in `server/src/test/steps/chat_cancellation.steps.ts` using the LM Studio mock to emit slow tokens; abort the HTTP request and assert the mock `cancelled` flag is set and no further SSE frames arrive.
5. [x] Logging: ensure cancellation logs an info entry with `{reason:"client_disconnect"}`; add assertion in steps to read server log buffer if feasible.
6. [x] Update README.md (server section) with a short “Cancellation” subsection under `/chat` explaining client disconnects stop generation immediately.
7. [x] Update design.md with a mermaid flow for the cancel path and a note that `req.close` triggers `cancel()`.
8. [x] Update projectStructure.md to list the new feature/steps files if added.
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix via `npm run lint:fix`/`npm run format --workspaces` if needed.

**Implementation scaffolds (for juniors)**
- Playwright snippet extension target for chat (can live in `e2e/chat.spec.ts`):
  ```ts
  test('chat streams', async ({ page }) => {
    await page.goto(baseUrl + '/chat');
    await page.getByLabel('Model').selectOption({ index: 0 });
    await page.getByLabel('Message').fill('Hello');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/responding/i)).toBeVisible();
    await expect(page.getByText(/Hello/)).toBeVisible({ timeout: 20000 });
  });
  ```
- Screenshot reminder: run Playwright with `--output test-results` and save files to `test-results/screenshots/0000004-8-*.png`.

**Commands (copy/paste)**
- Run only chat e2e: `E2E_BASE_URL=http://localhost:5001 npx playwright test e2e/chat.spec.ts`
- Save screenshots from UI manually if needed: in Playwright test add `await page.screenshot({ path: 'test-results/screenshots/0000004-8-normal.png', fullPage: true });`

**Implementation scaffolds (for juniors)**
- Stop button near send:
  ```tsx
  <Button variant="text" color="secondary" onClick={stop} disabled={status !== 'sending'}>Stop</Button>
  ```
- Client abort wiring: `stop` should call `controllerRef.current?.abort(); setStatus('idle'); push a "stopped" bubble if desired.`
- UI feedback idea: add a chip `Stopped` next to last assistant bubble when stop is triggered.
- Test idea: mock fetch stream promise that never resolves, trigger stop, assert `abort` called and UI re-enables send.

**Commands (copy/paste)**
- Client test focus: `npm run test --workspace client -- stop`

**Implementation scaffolds (for juniors)**
- Add button near controls:
  ```tsx
  <Button variant="outlined" onClick={handleNew} disabled={status === 'sending'}>New conversation</Button>
  ```
- Handler logic:
  ```ts
  const handleNew = () => {
    stop(); // calls AbortController
    setMessages([]);
    setStatus('idle');
    inputRef.current?.focus();
    // choice: keep current model selected (document this)
  };
  ```
- Test idea (RTL): render page, add two messages, click New, expect transcript empty and input focused (`expect(input).toHaveFocus()`).

**Commands (copy/paste)**
- Client test filter: `npm run test --workspace client -- new conversation`

**Implementation scaffolds (for juniors)**
- In `server/src/routes/chat.ts` add cancellation handling:
  ```ts
  router.post('/', async (req, res) => {
    const controller = new AbortController();
    req.on('close', () => {
      controller.abort();
      ongoing?.cancel?.();
      endStream(res);
      logger.info('chat stream aborted by client');
    });
    // pass controller.signal into lmstudio.act if supported
  });
  ```
- Ensure `OngoingPrediction.cancel()` is called inside `req.on('close')` and in catch blocks.
- Add Cucumber step idea for cancellation:
  ```ts
  When('I cancel the chat stream', async () => {
    controller = new AbortController();
    const res = await fetch(url, { method: 'POST', body, headers, signal: controller.signal });
    controller.abort();
    await collect(res); // should finish quickly
  });
  Then('the server stops sending events', () => { /* assert stream ended */ });
  ```

**Commands (copy/paste)**
- Manual abort test: open a second terminal and run `curl -N ...` to start the stream, then `Ctrl+C` to ensure server logs show cancellation.

#### Testing

1. [x] `npm run test --workspace server`
2. [x] `npm run build --workspace server`
3. [x] `npm run build --workspace client`
4. [x] `npm run compose:build`
5. [x] `npm run compose:up`
6. [x] `npm run compose:down`

#### Implementation notes

- Added AbortController to `/chat` SSE route plus disconnect guards to stop LM Studio predictions on client abort while preventing double-closes; skips `complete` frames when aborted.
- `chatStream.ts` now treats finished responses as closed; request `aborted`/`close` events bail early and log `{reason:"client_disconnect"}`.
- Introduced `chat_cancellation.feature/steps` with slower mock streaming to assert cancellation and no final/complete frames; updated mock to expose cancel flag.
- Docs refreshed (README/design/projectStructure) for cancellation flow; lint/format, server/client builds, compose build/up/down, and full server Cucumber suite now pass.

---

### 4. Chat Page - Models List

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __done__
- Git Commits: d0dc74a, 83b3540

#### Overview

Add the chat page route with an initial view that lists available models (from `/chat/models`), allows selection, and sets the default model for the session. Layout establishes the inverted page structure with input area placeholder but no send/stream yet.

#### Documentation Locations

- MUI MCP tool: @mui/material@7.2.0 docs (llms.mui.com/material-ui/7.2.0/llms.txt)
- React 19 docs: https://react.dev/
- React Router docs: https://reactrouter.com/
- design.md for layout/typography
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing NavBar/router patterns in `client/src/components/NavBar.tsx`, `client/src/routes/router.tsx`

#### Subtasks

1. [x] Add `/chat` route in `client/src/routes/router.tsx` and NavBar tab in `client/src/components/NavBar.tsx`; route element = new page.
2. [x] Create `client/src/hooks/useChatModel.ts` that fetches `/chat/models`, stores `models`, `selected`, `setSelected`, `status`, and returns `errorMessage`; default `selected` = first model key. Handle fetch abort on unmount.
3. [x] Create `client/src/pages/ChatPage.tsx` (placeholder transcript area) with inverted layout: top `Stack` holds model `Select` + message `TextField` (disabled for now), transcript box below. Focus the TextField on mount using `useRef` + `useEffect`.
4. [x] Add loading/empty/error UI: CircularProgress while `status="loading"`, Alert on error, “No models available” copy when list is empty; disable inputs when loading/error/empty.
5. [x] Update README.md (UI section) with how to reach `/chat` and how the model dropdown behaves (first model auto-selected, error states).
6. [x] Update design.md with a short layout description + mermaid showing data flow (ChatPage -> useChatModel -> /chat/models).
7. [x] Update projectStructure.md to include `client/src/pages/ChatPage.tsx` and `client/src/hooks/useChatModel.ts`.
8. [x] Tests (RTL/Jest): add `client/src/test/chatPage.models.test.tsx` that:
   - renders route via `createMemoryRouter` with path `/chat`
   - stubs fetch to return `[ { key:'m1', displayName:'Model 1', type:'gguf' } ]`
   - asserts spinner during load, dropdown shows “Model 1”, selects it by default, and error Alert appears when fetch rejects.
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix with `npm run lint:fix`/`npm run format --workspaces` if needed.

#### Testing

1. [x] `npm run test --workspace client`
2. [x] `npm run build --workspace server`
3. [x] `npm run build --workspace client`
4. [x] `npm run compose:build`
5. [x] `npm run compose:up`
6. [x] `npm run compose:down`

#### Implementation notes

- Added `/chat` navigation and routed `ChatPage` into the main router so the chat flow lives alongside existing pages.
- Introduced `useChatModel` hook to fetch `/chat/models`, default the selected model, expose loading/error/empty flags, and abort in-flight requests on unmount.
- Built the initial `ChatPage` layout with top-aligned model select and disabled message field, plus loading spinner, inline error Alert with retry, and empty-state copy that disable controls appropriately.
- Documented the new page across README/design/projectStructure (with a data-flow mermaid) and covered the models list behaviour with a dedicated RTL test.

---

### 5. Chat Page – Chat Functionality

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

 - Task Status: __done__
 - Git Commits: 0f44c15, 0d97057

#### Overview

Implement chat send/receive on the chat page: connect input to streaming POST `/chat`, render bubbles with inverted order, and show inline error bubbles. New conversation and stop controls are added in later tasks.

#### Documentation Locations

- MUI MCP tool: @mui/material@7.2.0 docs
- React 19 docs: https://react.dev/
- design.md for bubble styles
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Client hooks/services from Task 4

#### Subtasks

1. [x] Create `client/src/hooks/useChatStream.ts` exporting `{ send(message), stop(), status, messages }`; implement streaming fetch to `/chat` with SSE parsing, accumulating assistant tokens into a single bubble per turn. Abort on unmount.
2. [x] Extend `ChatPage.tsx` to wire TextField (`data-testid="chat-input"`) + Send button (`data-testid="chat-send"`) to `useChatStream`; append user bubble immediately, stream assistant tokens into one assistant bubble, render newest messages nearest the controls (invert list before map).
3. [x] In `useChatStream`, parse SSE lines split on `\n\n`, handle payloads `{type:"token"|"final"|"error"}`, and update `messages` shape `{ id, role, content, kind?: "error"|"status" }`.
4. [x] Add UI states: “Responding…” helper text, disable Send while `status==="sending"`, show inline error bubble (`kind: "error"`) on failures with retry hint, keep tool events out of transcript.
5. [x] Log tool lifecycle via `createLogger('client-chat')` when tool events arrive (no transcript output); stub logging function so tests can spy.
6. [x] Update README.md (UI section) describing chat send/stream behaviour, inverted order, and that persistence/stop/new are coming in later steps.
7. [x] Update design.md with bubble styling (assistant left, user right), inverted stack, and a mermaid sketch of send/stream flow.
7. [x] Update projectStructure.md for `useChatStream.ts` and any new component/test files.
8. [x] Tests (RTL/Jest): add `client/src/test/chatPage.stream.test.tsx` that:
   - mocks `global.fetch` returning a ReadableStream emitting `data:{"type":"token","content":"Hi"}` then `data:{"type":"final","message":{"content":"Hi","role":"assistant"}}`
   - asserts Send is disabled while streaming, assistant bubble shows combined “Hi”, error path shows error bubble, and `unmount` calls `abort` on the controller.
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix with `npm run lint:fix`/`npm run format --workspaces` if needed.

#### Testing

1. [x] `npm run test --workspace client`
2. [x] `npm run build --workspace server`
3. [x] `npm run build --workspace client`
4. [x] `npm run compose:build`
5. [x] `npm run compose:up`
6. [x] `npm run compose:down`

#### Implementation notes

- Added `useChatStream` hook to POST `/chat`, parse SSE `token/final/error` frames, accumulate tokens into a single assistant bubble, and log tool events via `createLogger('client-chat')`; guards abort on unmount/stop and surfaces inline error bubbles with retry guidance.
- ChatPage now wires the model select and message form to the hook, renders newest-first bubbles (user right/assistant left/error in error palette), disables send during streaming or empty input, and shows a lightweight "Responding..." helper.
- Client README/design/projectStructure refreshed for streaming behaviour, bubble styling, and the new hook/test entries; design adds a mermaid send/stream flow.
- Added RTL coverage `chatPage.stream.test.tsx` for streaming success, error bubble surfacing, and abort-on-unmount; fetch streams are simulated with `ReadableStream` from `node:stream/web` and AbortController is mocked for cancellation assertions.
- Full lint, format, client test suite, workspace builds, and compose build/up/down executed successfully after the changes.

---

### 6. Chat Page – New Conversation Control

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __done__
- Git Commits: 57c5df8, dcc31e4

#### Overview

Add a “New conversation” button that clears the transcript and resets state to a fresh session without reload; ensure it aborts any active stream.

#### Documentation Locations

- design.md for UX states
- MUI MCP tool: @mui/material@7.2.0 docs (buttons/layout)
- React 19 docs: https://react.dev/
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Existing chat hooks/services from Tasks 4–5

#### Subtasks

1. [x] Add “New conversation” button to `ChatPage.tsx`; handler must call `stop()` from `useChatStream`, clear `messages`, reset `status` to `idle`, and keep the currently selected model (document this choice in README/design).
2. [x] Ensure the handler calls `await stop()` (if stop returns void, call then clear) before clearing state, then focuses the TextField (`data-testid="chat-input"`).
3. [x] Update README.md (UI section) to state that New conversation clears transcript, keeps model, and aborts in-flight responses.
4. [x] Update design.md with the reset flow and copy shown to users.
5. [x] Update projectStructure.md if any helper/component files were added.
6. [x] Tests (RTL/Jest): add `client/src/test/chatPage.newConversation.test.tsx` verifying stop is called, transcript empties, status resets, input regains focus, and selected model value persists in the Select.
7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix with `npm run lint:fix`/`npm run format --workspaces` if needed.

#### Testing

1. [x] `npm run test --workspace client`
2. [x] `npm run build --workspace server`
3. [x] `npm run build --workspace client`
4. [x] `npm run compose:build`
5. [x] `npm run compose:up`
6. [x] `npm run compose:down`

#### Implementation notes

- Added a visible “New conversation” button beside Send; it calls `stop()` then a new `reset` helper to clear transcript state, keep the current model selection, reset status to idle, clear the input, and refocus the message field.
- `useChatStream` now exposes `reset` to wipe messages while keeping the abort logic in `stop`, so the page handler can abort in-flight streams before clearing.
- Updated README/design to describe the reset behaviour (model retained, input refocused, transcript cleared) and documented the new Jest spec in projectStructure.
- Added `chatPage.newConversation.test.tsx` covering aborting a hanging stream, clearing bubbles, retaining the selected model label, and restoring input focus; lint/format rerun plus client build/test, server build, and compose build/up/down verified.

---

### 7. Chat Page – Stop Control UI

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __to_do__
- Git Commits: _to_do_

#### Overview

Add a Stop/Cancel button on the chat page that halts an in-progress response, coordinating with server cancellation and client abort handling.

#### Documentation Locations

- design.md for UX/controls
- MUI MCP tool: @mui/material@7.2.0 docs (buttons/status)
- React 19 docs: https://react.dev/
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- Cancellation wiring from Task 3

#### Subtasks

1. [ ] Add “Stop” button near Send/New in `ChatPage.tsx`; show it only while `status==="sending"`; disable Send while Stop is visible.
2. [ ] Wire Stop to `useChatStream.stop()` which aborts fetch/AbortController; when called, append a status bubble `{role:'assistant', kind:'status', content:'Generation stopped'}` and set `status` back to `idle`.
3. [ ] Update README.md (UI section) describing Stop behaviour (cancels in-flight generation, may truncate response).
4. [ ] Update design.md with stop-state flow and mermaid snippet for stop path.
5. [ ] Update projectStructure.md if any new helper/component/test file was added.
6. [ ] Tests (RTL/Jest): add `client/src/test/chatPage.stop.test.tsx` mocking a streaming fetch that never resolves; clicking Stop should call `stop`, cancel controller, prevent further tokens, show “stopped” indicator, and re-enable Send (assert `send` button disabled->enabled).
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix with `npm run lint:fix`/`npm run format --workspaces` if needed.

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

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __to_do__
- Git Commits: _to_do_

#### Overview

Validate the full stack (server chat endpoints + client chat UI) with Playwright, refresh documentation, and ensure logging covers tool events (redacted). Capture screenshots for evidence.

#### Documentation Locations

- Playwright docs: https://playwright.dev/docs/intro
- Docker docs: https://docs.docker.com/engine/ and Compose: https://docs.docker.com/compose/
- Mermaid docs: https://mermaid.js.org/ (Context7 `/mermaid-js/mermaid`)
- React 19 docs: https://react.dev/
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

