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
- **LM Studio page:** use the NavBar tab to open `/lmstudio`, enter a base URL (defaults to `http://host.docker.internal:1234` or `VITE_LMSTUDIO_URL`), and click “Check status” to fetch via the server proxy—browser never calls LM Studio directly. “Refresh models” re-runs the server call, errors surface inline with focus returning to the URL field, and empty lists show “No models reported by LM Studio.” Base URLs persist in localStorage and can be reset to the default.
- Docker: `docker build -f client/Dockerfile -t codeinfo2-client .` then `docker run --rm -p 5001:5001 codeinfo2-client`

## Root commands

- `npm run lint --workspaces`
- `npm run lint:fix --workspaces`
- `npm run format:check --workspaces`
- `npm run format --workspaces`
- `npm run build:all`
- `npm run clean`

## Common package

- `npm run lint --workspace common`
- `npm run format:check --workspace common`
- `npm run build --workspace common`
- Exports `getAppInfo(app, version): VersionInfo`

## Server

- Logging: structured pino logger using shared schema; log file at `./logs/server.log` with rotation (expanded in the Logging section added in Task 6).
- `npm run dev --workspace server` (default port 5010)
- `npm run build --workspace server`
- `npm run start --workspace server`
- `npm run test --workspace server` (Cucumber scenarios)
- Configure `PORT` via `server/.env` (override with `server/.env.local` if needed)
- Docker: `docker build -f server/Dockerfile -t codeinfo2-server .` then `docker run --rm -p 5010:5010 codeinfo2-server`

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
  { "status": "ok", "baseUrl": "http://host.docker.internal:1234", "models": [{ "modelKey": "...", "displayName": "...", "type": "gguf" }] }
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
- Example: `curl -N -X POST http://localhost:5010/chat -H 'content-type: application/json' -d '{"model":"llama-3","messages":[{"role":"user","content":"hello"}]}'`.
- Logging: server records start/complete/error plus tool lifecycle metadata (name/callId only, no args/results) with the base URL origin and model; payloads respect `LOG_MAX_CLIENT_BYTES`.

## Docker Compose

- Build both images: `npm run compose:build`
- Start stack: `npm run compose:up` (client on http://localhost:5001, server on http://localhost:5010)
- Tail logs: `npm run compose:logs`
- Stop stack: `npm run compose:down`
- Compose loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so those files remain the single source of truth for both local and compose runs (create empty `.env.local` files to silence warnings if you don't need overrides).
- Client uses `VITE_API_URL=http://server:5010` inside compose; override ports via `PORT` and `VITE_API_URL` if needed.

## End-to-end (Playwright)

- One-time: `npx playwright install --with-deps`
- Start stack: `npm run e2e:up`
- Run test: `npm run e2e:test` (runs all specs; uses `E2E_BASE_URL` or defaults to http://localhost:5001 and `E2E_API_URL` default http://localhost:5010 for the proxy)
- LM Studio spec hits live data via the server proxy; start LM Studio on `LMSTUDIO_BASE_URL` (default `http://host.docker.internal:1234`) before running. The test will `test.skip` if the proxy or LM Studio is unreachable, but the client still needs to be up.
- Full flow: `npm run e2e`
- Shut down after tests: `npm run e2e:down`

## Environment policy

- Commit `.env` files with safe defaults.
- Keep secrets in `.env.local` (git-ignored) when needed.
