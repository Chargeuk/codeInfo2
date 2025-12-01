# CodeInfo2

Monorepo for client (React 19 + MUI), server (Express), and shared common package using npm workspaces.

## Prerequisites

- Node.js 22.x and npm 10+
- Docker 27+ and Docker Compose v2
- Git, curl

## Install

```sh
npm install
```

## Workspace layout

- `client/` — React app (Vite) [workspace]
- `server/` — Express API [workspace]
- `common/` — shared TypeScript package [workspace]
- See `projectStructure.md` for the current repository map and file purposes.

## Client

- Logging: client uses shared `LogEntry` schema with console tee + forwarding toggle (full details coming in the dedicated Logging section from Task 6).
- Client logging env (set in `client/.env`, override in `.env.local`):
  ```env
  VITE_LOG_FORWARD_ENABLED=false
  ```
  Tests force-disable network sends when `MODE === 'test'`.
- `npm run dev --workspace client` (http://localhost:5001)
- `npm run build --workspace client`
- `npm run preview --workspace client -- --host --port 5001`
- `npm run test --workspace client` (Jest + @testing-library/react)
- Env: `client/.env` sets `VITE_API_URL` (defaults http://localhost:5010); overrides in `.env.local`
- Styling/layout: MUI `CssBaseline` handles global reset; the `NavBar` AppBar spans the full width and content is constrained to a single `Container` (lg) with top padding so pages start at the top-left (Vite starter centering/dark background removed).
- **Logs page:** open `/logs` to view combined server/client logs with level/source chips, free-text filter, live SSE toggle (auto-reconnect), manual refresh, and a “Send sample log” button that emits an example entry end-to-end.
- **Chat page:** open `/chat` to chat with LM Studio via the server `/chat` streaming proxy. Models come from `/chat/models` (first auto-selects) and are filtered to chat-capable LLMs (embedding/vector models are hidden); the dropdown, input, and Send stay disabled during load/error/empty states or while a response is streaming. Messages render newest-first near the controls with distinct user/assistant bubbles, streaming tokens accumulate into a single assistant bubble, and failures surface as inline error bubbles with retry guidance. Tool lifecycle events stay out of the transcript but are logged to the server log store so the Logs page can surface them. A **Stop** button appears while streaming to cancel generation (responses may truncate) and adds a status bubble; a **New conversation** button aborts any in-flight response, clears the transcript, keeps the currently selected model, and refocuses the input. Chat history is in-memory only; reloading or leaving the page resets the conversation.
- **Chat tool visibility:** tool calls render closed by default with name + success/failure. Expanding shows a Parameters accordion (default-closed) plus tool-specific details: ListIngestedRepositories lists all repos with expandable metadata; VectorSearch shows an alphabetical, host-path-only file list with highest match value, summed chunk count, and total line count per file. Errors surface trimmed code/message with a toggle to reveal the full payload.
- **Chat citations:** when LM Studio tools return vector search results, the assistant bubble shows inline citations with `repo/relPath` plus the host-resolvable path (when available) and the chunk text used for grounding.
- Tool completion guardrails: if LM Studio omits `onToolCallResult` frames and only sends a final `role:"tool"` message, the server now synthesizes a `type:"tool-result"` SSE (deduped when real results arrive) and the client marks any remaining `requesting` tools as `done` on `complete` so spinners never stick; additionally, as soon as assistant output resumes after a tool call (token or final), any pending tool spinner is cleared so the UI never waits for stream completion to stop.
- **Ingest page:** open `/ingest` to start an embedding run against a server-accessible folder. The form validates required path/name fields, lets you add an optional description, choose an embedding model (disabled once the shared collection is locked), toggle dry-run, and surfaces inline errors such as “Path is required” or “Select a model.” A banner appears when the embedding model is locked to a specific id. The page now lists embedded folders with per-row actions (Re-embed, Remove, Details), bulk actions, inline action feedback, and a tooltip over the name for descriptions. A Details drawer shows path/model/status, counts, last error, and the include/exclude defaults; the empty state explains that the model locks after the first ingest. Actions are disabled while an ingest is active to avoid conflicts.
- **Active ingest card:** once a run starts, the page polls `/ingest/status/{runId}` ~every 2s to show state chips (Queued/Scanning/Embedding/Completed/Cancelled/Error), file/chunk counts, any last error, a “Cancel ingest” button that calls `/ingest/cancel/{runId}` (disabled while cancelling), and a “View logs for this run” link (pre-filters logs with the runId). Status responses now include per-file progress: `currentFile`, `fileIndex`, `fileTotal`, `percent` (1dp), and `etaMs` (milliseconds). Example:
  ```json
  {
    "runId": "r1",
    "state": "embedding",
    "counts": { "files": 3, "chunks": 4, "embedded": 0 },
    "currentFile": "/repo/file-2.txt",
    "fileIndex": 2,
    "fileTotal": 3,
    "percent": 66.7,
    "etaMs": 12000
  }
  ```
- Assistant replies that include `<think>...</think>` or OpenAI Harmony channel-tagged analysis (`<|channel|>analysis<|message|>...<|end|>`) collapse immediately while streaming, show a spinner on the “Thought process” header, and can be expanded to watch the reasoning stream. Final content renders separately from the hidden analysis.
- **Mermaid diagrams:** code fences labeled `mermaid` render inline diagrams client-side; input is sanitized before rendering, and diagrams follow the current light/dark theme while staying within the chat bubble width.
- Server chat proxy uses LM Studio SDK 1.5 via `client.llm.model(<key>).act(...)` with the LM Studio tools (ListIngestedRepositories, VectorSearch) and AbortController so cancellation works; it now builds a `Chat.from(messages)` history so the model sees the full conversation per request. LM Studio base URL comes from `LMSTUDIO_BASE_URL` and is converted to ws/wss for the SDK.
- **LM Studio page:** use the NavBar tab to open `/lmstudio`, enter a base URL (defaults to `http://host.docker.internal:1234` or `VITE_LMSTUDIO_URL`), and click “Check status” to fetch via the server proxy—browser never calls LM Studio directly. “Refresh models” re-runs the server call, errors surface inline with focus returning to the URL field, and empty lists show “No models reported by LM Studio.” Base URLs persist in localStorage and can be reset to the default.
- Docker: `docker build -f client/Dockerfile -t codeinfo2-client .` then `docker run --rm -p 5001:5001 codeinfo2-client`

### End-to-end (Playwright)

- Primary stack: `npm run e2e` uses the dedicated `docker-compose.e2e.yml` (isolated Chroma volume, fixture mount at `/fixtures`) with ports client 6001 / server 6010 / chroma 8800. Individual steps: `npm run compose:e2e:build`, `npm run e2e:up`, `npm run e2e:test`, `npm run e2e:down`.
- Reset the e2e Chroma volume if metadata becomes corrupted (e.g., after schema tweaks): `docker compose --env-file .env.e2e -f docker-compose.e2e.yml down -v`.
- Tests live in `e2e/` (chat, lmstudio, logs, version, ingest). Ingest specs auto-skip when LM Studio/models are unavailable. E2E env defaults: `E2E_BASE_URL=http://localhost:6001`, `E2E_API_URL=http://localhost:6010`. `e2e/chat-tools.spec.ts` ingests the mounted fixture repo (`/fixtures/repo`), runs a vector search, mocks chat SSE, and asserts inline citations show `repo/relPath` plus the host path. It asks “What does main.txt say about the project?” and expects the fixture text “This is the ingest test fixture for CodeInfo2.”

## Root commands

- `npm run lint --workspaces`
- `npm run lint:fix --workspaces`
- `npm run format:check --workspaces`
- `npm run format --workspaces`
- `npm run build:all`
- `npm run clean`

### Quick run order for ingest/Testcontainers work

- `npm run build --workspace server`
- `npm run build --workspace client`
- `npm run test --workspace server` (builds then runs unit tests first, followed by Cucumber with Chroma via Testcontainers; Docker required)
- `npm run test --workspace client`
- `npm run compose:build`
- `npm run compose:up`
- `npm run compose:down`
- `npm run e2e`

Ingest collection names (`INGEST_COLLECTION`, `INGEST_ROOTS_COLLECTION`) come from `.env`; no test-only embedding env flags are needed.

## Common package

- `npm run lint --workspace common`
- `npm run format:check --workspace common`
- `npm run build --workspace common`
- Exports `getAppInfo(app, version): VersionInfo`

## Server

- Logging: structured pino logger using shared schema; log file at `./logs/server.log` with rotation (expanded in the Logging section added in Task 6).
- LM Studio clients are pooled per base URL so chat/ingest routes reuse a single connection; SIGINT/SIGTERM triggers the pool to close cleanly before the process exits.
- `npm run dev --workspace server` (default port 5010)
- `npm run build --workspace server`
- `npm run start --workspace server`
- `npm run test --workspace server` (builds + unit tests first, then Cucumber; Chroma comes from the Testcontainers compose hook—no mock CHROMA_URL path)
- Ingest Cucumber tests run against a real Chroma via Testcontainers; Docker must be running and will publish Chroma on host port 18000 (if busy, the hook falls back to a random host port and logs it). For manual debugging, `docker compose -f server/src/test/compose/docker-compose.chroma.yml up -d` (teardown with `docker compose -f server/src/test/compose/docker-compose.chroma.yml down -v`).
- Configure `PORT` via `server/.env` (override with `server/.env.local` if needed)
- Docker: `docker build -f server/Dockerfile -t codeinfo2-server .` then `docker run --rm -p 5010:5010 codeinfo2-server`
- **LM Studio tooling + Zod version pin:** the LM Studio SDK bundles Zod 3.25.76. A Zod 4.x copy pulled in by lint dependencies caused Docker-only tool-call failures (`keyValidator._parse is not a function`) because schemas were built with Zod v4 while the SDK validated with v3. We now pin Zod to `3.25.76` via an npm `overrides` entry in the root `package.json`; the regenerated `package-lock.json` ensures both host and container installs use a single Zod version, eliminating the error.

### Logging endpoints

- Env: `LOG_LEVEL`, `LOG_BUFFER_MAX` (default 5000), `LOG_MAX_CLIENT_BYTES` (default 32768), `LOG_FILE_PATH` (default `./logs/server.log`), `LOG_FILE_ROTATE` (`true` for daily rotation). Files write to `./logs` (gitignored/bind-mount later).
- POST `/logs` accepts a single log entry (32KB cap) and returns 202 with the stored sequence number:
  ```sh
  curl -X POST http://localhost:5010/logs \
    -H 'content-type: application/json' \
    -d '{"level":"info","message":"hello","timestamp":"2025-01-01T00:00:00.000Z","source":"client"}'
  ```
- GET `/logs` supports `level`, `source`, `text`, `since`, `until`, `limit` (max 200) and responds `{ items, lastSequence, hasMore }`:
  ```sh
  curl "http://localhost:5010/logs?level=error,info&source=client&limit=50"
  ```
- GET `/logs/stream` provides an SSE feed with heartbeats every 15s; resume with `Last-Event-ID` or `?sinceSequence=`. Example: `curl -N http://localhost:5010/logs/stream`.

### Ingest embedding models

- GET `/ingest/models` returns embedding-capable LM Studio models plus the current lock (if any):
  ```json
  {
    "models": [
      {
        "id": "embed-1",
        "displayName": "all-MiniLM",
        "contextLength": 2048,
        "format": "gguf",
        "size": 145000000,
        "filename": "all-mini.gguf"
      }
    ],
    "lockedModelId": null
  }
  ```
- Filters to `type === "embedding"` or capabilities including `embedding`; returns 502 `{status:"error", message}` if LM Studio is unavailable.

### Ingest start/status

- POST `/ingest/start` starts an ingest job. Body:
  ```json
  {
    "path": "/repo",
    "name": "repo",
    "description": "optional",
    "model": "embed-1",
    "dryRun": false
  }
  ```
  Responses: `202 {"runId":"..."}` on start; `409 {"status":"error","code":"MODEL_LOCKED"}` if collection locked to another model; `429 {"status":"error","code":"BUSY"}` if an ingest is already running; `400` on validation errors.
- GET `/ingest/status/{runId}` returns current state:
  ```json
  {"runId":"r1","state":"scanning","counts":{"files":3,"chunks":0,"embedded":0},"message":"Walking repo"}
  {"runId":"r1","state":"completed","counts":{"files":3,"chunks":12,"embedded":12}}
  {"runId":"r1","state":"error","counts":{"files":1,"chunks":2,"embedded":0},"lastError":"Chroma unavailable"}
  ```
- Model lock: first ingest sets lock to the chosen embedding model; subsequent ingests must use the same model while data exists.

### Ingest cancel / re-embed / remove

- POST `/ingest/cancel/{runId}` cancels the active ingest run, purges any partial vectors tagged with the runId, updates the roots entry to `cancelled`, and responds `{ "status": "ok", "cleanup": "complete" }`. Example: `curl -X POST http://localhost:5010/ingest/cancel/<runId>`.
- POST `/ingest/reembed/{root}` re-runs ingest for the stored root path (deletes existing vectors/metadata for that root first). Respects the existing model lock and returns `202 { runId }` or `404 NOT_FOUND` if the root is unknown.
- POST `/ingest/remove/{root}` deletes vectors and root metadata for the given root; if the vectors collection becomes empty, the locked model is cleared. Responds `{ status: 'ok', unlocked: boolean }`.
- Single-flight: concurrent ingest/re-embed/remove requests return `429 {code:'BUSY'}` while a run is active. Cancel is allowed to break an active run; the lock is released after cancellation completes.

### Ingest roots listing

- GET `/ingest/roots` returns stored roots in descending `lastIngestAt` order along with the current model lock:
  ```json
  {
    "roots": [
      {
        "runId": "a1",
        "name": "repo",
        "description": "project",
        "path": "/repo",
        "model": "embed-1",
        "status": "completed",
        "lastIngestAt": "2025-01-01T12:00:00.000Z",
        "counts": { "files": 3, "chunks": 12, "embedded": 12 },
        "lastError": null
      }
    ],
    "lockedModelId": "embed-1"
  }
  ```

### Tooling endpoints (LM Studio agent support)

- GET `/tools/ingested-repos` lists ingested repositories for the agent tools and includes `id`, `description`, `containerPath`, `hostPath`, `counts`, `lastIngestAt`, `lastError`, and `lockedModelId`. Paths stored under `/data/<repo>/...` are rewritten to host paths using `HOST_INGEST_DIR` (defaults to `/data`) and include a warning flag when that env var is unset.
- POST `/tools/vector-search` accepts `{ "query": string, "repository"?: string, "limit"?: number }`, validates input (`query` required, `limit` default 5/max 20, `repository` must match a known repo id), and queries Chroma. Responses include ordered `results` with `repo`, `relPath`, `containerPath`, `hostPath`, `chunk`, `chunkId`, `score`, and `modelId`, plus top-level `modelId` (locked model). Errors: `400 VALIDATION_FAILED`, `404 REPO_NOT_FOUND`, `409 INGEST_REQUIRED` (no locked embedding model yet), `503 EMBED_MODEL_MISSING` (locked model not available in LM Studio), `502 CHROMA_UNAVAILABLE`.

## Logging

- Quick API calls:

  ```sh
  # POST one entry
  curl -X POST http://localhost:5010/logs \
    -H 'content-type: application/json' \
    -d '{"level":"info","message":"demo","timestamp":"2025-01-01T00:00:00.000Z","source":"client"}'

  # GET filtered history
  curl "http://localhost:5010/logs?level=error,info&source=client&limit=50"

  # Stream live with SSE + heartbeats
  curl -N http://localhost:5010/logs/stream
  ```

- Env keys  
  Server: `LOG_LEVEL`, `LOG_BUFFER_MAX`, `LOG_MAX_CLIENT_BYTES`, `LOG_FILE_PATH=./logs/server.log`, `LOG_FILE_ROTATE=true`  
  Client: `VITE_LOG_LEVEL`, `VITE_LOG_FORWARD_ENABLED`, `VITE_LOG_MAX_BYTES`, `VITE_LOG_STREAM_ENABLED`
- File + compose: logs write to `/app/logs/server.log` (host `./logs` is mounted to `/app/logs` in `docker-compose.yml`).
- Disable client forwarding by setting in `.env.local`:
  ```env
  VITE_LOG_FORWARD_ENABLED=false
  ```
- LM Studio actions: client logs status/refresh/reset actions with redacted base URLs; server logs inbound LM Studio proxy calls (requestId, base URL origin, model count or error). Secrets in URLs are stripped before logging.

### LM Studio proxy

- Endpoint: `GET /lmstudio/status?baseUrl=http://host.docker.internal:1234` (query optional; falls back to `LMSTUDIO_BASE_URL`).
- Success example:
  ```json
  {
    "status": "ok",
    "baseUrl": "http://host.docker.internal:1234",
    "models": [{ "modelKey": "...", "displayName": "...", "type": "gguf" }]
  }
  ```
- Error example: `{ "status": "error", "baseUrl": "http://bad", "error": "Invalid baseUrl" }` (timeout/SDK errors return 502 with `status: "error"`).
- Env: `LMSTUDIO_BASE_URL` default `http://host.docker.internal:1234` (override in `server/.env.local`). Curl: `curl "http://localhost:5010/lmstudio/status?baseUrl=http://host.docker.internal:1234"`.

### Chat models (LM Studio)

- Endpoint: `GET /chat/models` (uses `LMSTUDIO_BASE_URL`; no query parameters). Returns `[ { "key": "llama-3", "displayName": "Llama 3 Instruct", "type": "gguf" } ]` shaped items.
- Failure: if LM Studio is unreachable/invalid, responds `503 { "error": "lmstudio unavailable" }`.
- The chat UI selects the first item by default when no model is chosen; callers should treat an empty array as “no models available”.
- Logging: start/success/failure log entries include the base URL origin and model count on success; errors log the sanitized origin only.

### Chat streaming

- Endpoint: `POST /chat` (uses `LMSTUDIO_BASE_URL`). Body: `{ "model": "<key>", "messages": [ { "role": "user", "content": "hello" } ] }` (see `@codeinfo2/common chatRequestFixture`).
- Response streams `text/event-stream` frames: token `{"type":"token","content":"Hi","roundIndex":0}`, tool lifecycle `{"type":"tool-request|tool-result", ...}` (arguments/results redacted in logs), final message `{"type":"final","message":{"role":"assistant","content":"Hi"},"roundIndex":0}`, `{"type":"complete"}` on finish, `{"type":"error","message":"lmstudio unavailable"}` on failure.
  Tool definitions use the LM Studio SDK `tool()` helper (empty `parameters` for list repos) so the SDK accepts them as function tools; invalid tool shapes previously triggered `Unhandled type: undefined`.
- Example: `curl -N -X POST http://localhost:5010/chat -H 'content-type: application/json' -d '{"model":"llama-3","messages":[{"role":"user","content":"hello"}]}'`.
- Logging: server records start/complete/error plus tool lifecycle metadata (name/callId only, no args/results) with the base URL origin and model; payloads respect `LOG_MAX_CLIENT_BYTES`.
- Tooling: chat registers LM Studio tools `ListIngestedRepositories` and `VectorSearch` (see `server/src/lmstudio/tools.ts`) that reuse the `/tools/ingested-repos` and `/tools/vector-search` logic. Tool responses include repo id, relPath, containerPath, hostPath, chunk text/score, and model id for citations; repo-not-found/validation errors surface as tool errors. VectorSearch now derives its embedding function from the collection’s locked model; if no lock exists it surfaces `INGEST_REQUIRED`, and if the locked model is missing in LM Studio it surfaces `EMBED_MODEL_MISSING`. Usage is logged without persisting payload bodies.
- Tool lifecycle entries are pushed into the server log buffer (visible on `/logs`/Logs page) but are not rendered in the chat transcript; the client still logs the metadata for observability.
- Rendering: assistant replies use a sanitized React Markdown pipeline (`react-markdown` + `remark-gfm` + `rehype-sanitize`) so GFM lists/links/code fences display while tool blocks and citations stay plain JSX; code fences render in styled `<pre><code>` blocks and links open in a new tab.
- Cancellation: if the client disconnects/aborts, the server calls `cancel()` on the LM Studio prediction via an `AbortController`, stops streaming immediately, and logs `{ reason: "client_disconnect" }`.
- Persistence: chat sessions are ephemeral; navigating away or using **New conversation** resets the transcript while keeping the selected model.

## Docker Compose

- Build both images: `npm run compose:build`
- Start stack: `npm run compose:up` (client on http://localhost:5001, server on http://localhost:5010)
- Tail logs: `npm run compose:logs`
- Stop stack: `npm run compose:down`
- Compose loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so those files remain the single source of truth for both local and compose runs (create empty `.env.local` files to silence warnings if you don't need overrides).
- Client uses `VITE_API_URL=http://server:5010` inside compose; override ports via `PORT` and `VITE_API_URL` if needed.

### Observability (Chroma traces)

- Compose stacks now run an OpenTelemetry Collector (`otel-collector`, ports 4317/4318) plus Zipkin (`zipkin`, port 9411). The collector loads `observability/otel-collector-config.yaml` and exports traces to Zipkin and a debug logger.
- Chroma containers point to the collector via `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http`, and `OTEL_SERVICE_NAME=chroma` so ingest traffic is captured.
- View traces at http://localhost:9411 after generating activity (e.g., start an ingest). If nothing appears, check collector logs: `docker compose logs otel-collector`.
- Cleanup: `docker compose down -v` tears down collector/zipkin/chroma volumes; remove any lingering volumes with `docker volume ls | grep codeinfo2` if ports/telemetry state need a full reset.

## End-to-end (Playwright)

- One-time: `npx playwright install --with-deps`
- Start stack: `npm run e2e:up`
- Run test: `npm run e2e:test` (runs all specs; uses `E2E_BASE_URL` or defaults to http://localhost:5001 and `E2E_API_URL` default http://localhost:5010 for the proxy)
- LM Studio spec hits live data via the server proxy; start LM Studio on `LMSTUDIO_BASE_URL` (default `http://host.docker.internal:1234`) before running. The test will `test.skip` if the proxy or LM Studio is unreachable, but the client still needs to be up.
- Chat spec (`e2e/chat.spec.ts`) covers model selection plus a two-turn streaming conversation; it skips automatically if `/chat/models` is unreachable or empty.
- Full flow: `npm run e2e`
- Shut down after tests: `npm run e2e:down`

## Environment policy

- Commit `.env` files with safe defaults.
- Keep secrets in `.env.local` (git-ignored) when needed.
