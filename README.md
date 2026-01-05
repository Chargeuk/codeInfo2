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

## MongoDB (conversation history)

- Conversation persistence depends on MongoDB. Default URI: `MONGO_URI=mongodb://host.docker.internal:27517/db?directConnection=true`.
- `docker-compose.yml` includes a Mongo 8 replica-set service bound to host port 27517 and passes the same URI into the server container; local dev can reuse the same URI when running the server without Compose.
- If Mongo is unreachable the server keeps running but reports `mongoConnected=false`; the client surfaces a banner and disables archive controls while allowing stateless chat.

## Codex config seed

- The repo ships `config.toml.example` at the root. On server startup, if `${CODEINFO_CODEX_HOME:-./codex}/config.toml` is missing, it is copied from the example (the `codex/` directory is git-ignored).
- Customize `./codex/config.toml` after the first run; subsequent starts leave your edits intact.

## Codex (CLI)

- Install CLI (host): `npm install -g @openai/codex`.
- Login (host only): run `CODEX_HOME=./codex codex login` (or keep your existing `~/.codex`); Docker Compose mounts `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` to `/host/codex` and copies `auth.json` into `/app/codex` on startup when missing, so a separate container login is not required.
  - Note: `CODEX_HOME` is frequently set by Codex/agent environments; use `CODEINFO_HOST_CODEX_HOME` (not `CODEX_HOME`) when you need Compose to mount a specific host Codex home.
- Codex home: `CODEINFO_CODEX_HOME=./codex` (mounted to `/app/codex` in Docker); seeded from `config.toml.example` on first start—edit `./codex/config.toml` after seeding to add MCP servers or overrides.
- Behaviour when missing: if the CLI, `auth.json`, or `config.toml` are absent (and no host auth is available to copy), Codex stays disabled; startup logs explain which prerequisite is missing and the chat UI shows a disabled-state banner.
- Chat defaults: Codex runs with `workingDirectory=/data`, `skipGitRepoCheck:true`, and requires MCP tools declared under `[mcp_servers.codeinfo_host]` / `[mcp_servers.codeinfo_docker]` in `config.toml`.

## Codex agents (folder layout)

Agents are discovered from the directory set by `CODEINFO_CODEX_AGENT_HOME`. Each direct subfolder is treated as an agent when it contains a `config.toml` file.

Example layout:

```text
codex_agents/<agentName>/
  config.toml          # required
  description.md       # optional (Markdown shown in UI/MCP listings)
  system_prompt.txt    # optional (used only on first turn of a new agent conversation)
```

- Agent defaults: `codex_agents/<agentName>/config.toml` is the source of truth for agent execution defaults (e.g. `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, and web-search/network feature toggles). The UI does not provide model/provider selection for agents.
- Server-owned defaults: the server still sets `workingDirectory=/data` (or `CODEX_WORKDIR`) and `skipGitRepoCheck:true` for agent runs.
- Auth seeding: on each agent discovery read, if `codex_agents/<agentName>/auth.json` is missing but the primary Codex home (`CODEINFO_CODEX_HOME`) has `auth.json`, the server will best-effort copy it into the agent folder. It never overwrites existing agent auth, and `auth.json` must never be committed.
- Docker/Compose: `docker-compose.yml` mounts `./codex_agents` → `/app/codex_agents` (rw) and sets `CODEINFO_CODEX_AGENT_HOME=/app/codex_agents` so agents are discoverable in containers.
- Agents MCP (port 5012): JSON-RPC endpoint on `http://localhost:5012` (exposed by Compose).

### Agents REST API

- Agents UI:
  - Open the **Agents** tab (route `/agents`) to run an instruction against an agent from the browser UI.
  - To continue a prior agent run, select a conversation from the sidebar history (there is no manual `conversationId` input).

- List available agents:
  - `curl -s http://localhost:5010/agents | jq`
  - Example response:
    ```json
    {
      "agents": [
        {
          "name": "coding_agent",
          "description": "# My agent\n\nSome details...",
          "warnings": []
        }
      ]
    }
    ```

- Run an instruction against an agent:
  - `curl -s -X POST http://localhost:5010/agents/coding_agent/run -H 'content-type: application/json' -d '{"instruction":"Say hello"}' | jq`
  - Run with an explicit working folder (optional):
    - `curl -s -X POST http://localhost:5010/agents/coding_agent/run -H 'content-type: application/json' -d '{"instruction":"Say hello","working_folder":"/host/base/repo"}' | jq`
  - Continue an existing agent conversation (server `conversationId`, not the Codex thread id):
    - `curl -s -X POST http://localhost:5010/agents/coding_agent/run -H 'content-type: application/json' -d '{"instruction":"Continue","conversationId":"<conversationId>"}' | jq`
  - Example response (202):
    ```json
    {
      "status": "started",
      "agentName": "coding_agent",
      "conversationId": "<conversationId>",
      "inflightId": "<inflightId>",
      "modelId": "<modelId>"
    }
    ```
  - Notes:
    - Agents runs return HTTP `202` immediately and continue executing in the background; transcript updates arrive over WebSocket. Navigating away does **not** cancel the run. Use **Stop** (WS `cancel_inflight`) to cancel.
    - `working_folder` (optional) requests the working directory for this run and must be an absolute path (POSIX or Windows).
    - Resolution order: mapped candidate (host path under `HOST_INGEST_DIR` -> joined into `CODEX_WORKDIR`/`CODEINFO_CODEX_WORKDIR`), then literal fallback, else error.
    - Stable error codes for invalid_request: `WORKING_FOLDER_INVALID` (not absolute/invalid input) and `WORKING_FOLDER_NOT_FOUND` (neither candidate directory exists).
    - The response `conversationId` is the server conversation id used for history and continuation.
    - Codex continuation uses an internal thread id persisted as `Conversation.flags.threadId`.

- Agent Commands (macros):
  - Commands live alongside an agent under `codex_agents/<agentName>/commands/*.json` (file basename is the command name).
  - Command file schema (v1):
    ```json
    {
      "Description": "Refine a story plan for clarity and completeness.",
      "items": [
        {
          "type": "message",
          "role": "user",
          "content": ["Step 1 prompt...", "Step 1 continues..."]
        }
      ]
    }
    ```
  - List available commands for an agent:
    - `curl -s http://localhost:5010/agents/coding_agent/commands | jq`
    - Example response:
      ```json
      {
        "commands": [
          {
            "name": "improve_plan",
            "description": "Refine a story plan for clarity and completeness.",
            "disabled": false
          }
        ]
      }
      ```
  - Run a command:
    - `curl -s -X POST http://localhost:5010/agents/coding_agent/commands/run -H 'content-type: application/json' -d '{"commandName":"improve_plan"}' | jq`
    - Optional arguments:
      - `conversationId` (continue an existing agent conversation)
      - `working_folder` (absolute path; resolved like `/agents/:agentName/run`)
    - Example request:
      ```json
      {
        "commandName": "improve_plan",
        "conversationId": "<conversationId>",
        "working_folder": "/host/base/repo"
      }
      ```
    - Example response:
      ```json
      {
        "status": "started",
        "agentName": "coding_agent",
        "commandName": "improve_plan",
        "conversationId": "<conversationId>",
        "modelId": "<modelId>"
      }
      ```
    - Error notes:
      - Missing agent/command returns 404 `{ "error": "not_found" }`.
      - Validation errors return 400 `{ "error": "invalid_request", "code": "COMMAND_INVALID" | "WORKING_FOLDER_INVALID" | "WORKING_FOLDER_NOT_FOUND", "message": "..." }`.
      - Concurrent runs return 409 `{ "error": "conflict", "code": "RUN_IN_PROGRESS", "message": "..." }`.


### Agents MCP (JSON-RPC)

- Endpoint: POST JSON-RPC 2.0 to `http://localhost:5012` (Compose exposes it; e2e compose maps to `http://localhost:6012`).
- Tools:
  - `list_agents`
  - `list_commands`
  - `run_agent_instruction`
  - `run_command`
- `run_agent_instruction` optional arguments: `conversationId` and `working_folder` (absolute path; resolved like REST).
- Quick smoke (host/compose):
  - `curl -s -X POST http://localhost:5012 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | jq`
  - `curl -s -X POST http://localhost:5012 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq`
  - `curl -s -X POST http://localhost:5012 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}' | jq`
  - `curl -s -X POST http://localhost:5012 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"run_agent_instruction","arguments":{"agentName":"coding_agent","instruction":"Say hello"}}}' | jq`

### MCP for Codex

- Endpoint: POST JSON-RPC 2.0 to `http://localhost:5010/mcp` (host) or `http://server:5010/mcp` (docker). CORS matches `/chat`.
- Note: the server intentionally exposes **two** MCP surfaces:
  - Express `POST /mcp` (ingest tooling: `ListIngestedRepositories`, `VectorSearch`).
  - MCP v2 JSON-RPC server on `MCP_PORT` (tooling: `codebase_question`, documented under **MCP (codebase_question)** below).
    Their response conventions differ and must remain stable; shared MCP infrastructure lives under `server/src/mcpCommon/`.
- Config: `config.toml.example` seeds `[mcp_servers]` entries `codeinfo_host` and `codeinfo_docker` pointing at the URLs above when the server first runs.
- Required methods: `initialize` → `tools/list` → `tools/call`.
- Quick smoke (host):
  - `curl -X POST http://localhost:5010/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'`
  - `curl -X POST http://localhost:5010/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`
  - `curl -X POST http://localhost:5010/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"VectorSearch","arguments":{"query":"hello"}}}'`
- Tools exposed: `ListIngestedRepositories` (no params) and `VectorSearch` (`query` required, optional `repository`, `limit` capped at 20). Results are returned as `content: [{ type: "text", text: "<json>" }]` (JSON string).

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
- **Chat page:** open `/chat` to chat with LM Studio or Codex via `POST /chat` (HTTP 202) plus WebSocket streaming at `/ws`. Models come from `/chat/models` (first auto-selects) and are filtered to chat-capable LLMs (embedding/vector models are hidden); the dropdown, input, and Send stay disabled during load/error/empty states or while a response is running. Messages render newest-first near the controls with distinct user/assistant bubbles, and transcript updates arrive via `/ws` events (late subscribers receive an `inflight_snapshot` catch-up). Switching conversations or navigating away unsubscribes from streaming but does not cancel the run server-side; Stop cancels the current in-flight run. Chat history is persisted in Mongo: the left sidebar lists conversations newest-first, supports active/archived/all filtering plus multi-select bulk archive/restore/delete, and turn snapshots come from `GET /conversations/:id/turns` which returns full history plus any in-flight snapshot (no pagination). Conversation listing supports agent scoping via `/conversations?agentName=__none__` (only conversations with no `agentName`) and `/conversations?agentName=<agent>` (exact match).
- **Agents page:** open `/agents` to run Codex agents with the same layout + transcript UI as Chat (Drawer sidebar, controls above transcript, WebSocket-driven transcript events). History is scoped to the selected agent (`agentName=<agent>`) and updates live via `conversation_upsert` / `conversation_delete` over `/ws`. Controls include agent selection, optional command execution (macros), a working folder override, and Send/Stop/New conversation.
- **Chat providers:** a Provider dropdown (LM Studio by default) sits to the left of the Model selector. Codex appears as `OpenAI Codex` when the CLI/config/auth are present; when unavailable it stays disabled with inline guidance, and when tools are unavailable the Codex send input remains disabled with an MCP warning. Provider is locked once a conversation starts, while the model can still change. The message input is now multiline beneath the selectors; send/stop live beside it. Tool blocks/citations render only when the active provider advertises `toolsAvailable`.
- **Codex models:** when provider=`OpenAI Codex`, the fixed model list from `/chat/models?provider=codex` includes `gpt-5.2`.
- **Codex flags panel:** when provider=`OpenAI Codex`, a collapsible “Codex flags” panel appears under the Provider/Model row with a sandbox mode select (`workspace-write` default, plus `read-only` and `danger-full-access`), an approval policy select (`on-failure` default; also `on-request`, `never`, `untrusted`), a reasoning effort select (`high` default; also `xhigh`, `medium`, `low`), and toggles for **Enable network access** / **Enable web search** (both default `true`). Requests always send the selected `sandboxMode`, `approvalPolicy`, `modelReasoningEffort`, `networkAccessEnabled`, and `webSearchEnabled` for Codex; LM Studio ignores Codex-only flags. `xhigh` is accepted and passed through to Codex as `model_reasoning_effort="xhigh"` (via the installed `@openai/codex-sdk`). Example payload fragment: `"sandboxMode": "danger-full-access", "approvalPolicy": "on-request", "modelReasoningEffort": "low", "networkAccessEnabled": false, "webSearchEnabled": false`.
- **Chat bubble styling:** user and assistant bubbles share a consistent 14px border radius while keeping status chips, tool blocks, and citations aligned.
- **Chat tool visibility:** tool calls render closed by default with name + success/failure. Expanding shows a Parameters accordion (default-closed) plus tool-specific details: ListIngestedRepositories lists all repos with expandable metadata; VectorSearch shows an alphabetical, host-path-only file list with highest match value, summed chunk count, and total line count per file. Errors surface trimmed code/message with a toggle to reveal the full payload. The server now synthesizes `tool-result` events when LM Studio omits them and dedupes if native events arrive later, so the UI always receives parameters and payloads, and it suppresses assistant-role messages that merely echo tool payloads so raw tool JSON never appears as the chat reply.
- **Chat citations:** vector search citations now live inside a default-closed “Citations” accordion under the assistant bubble; expanding reveals `repo/relPath` + host path (when available) and the chunk text that grounded the reply.
- **Chat system context:** the shared prompt now lives in `common/src/systemContext.ts` and is re-exported in the client; it is prepended to LM Studio payloads client-side and injected server-side on the first Codex turn so the model sees the repo/tool instructions without replaying history.
- **Thought process reliability:** streamed analysis (`<think>`/Harmony analysis channel) is buffered append-only per turn, so multiple analysis bursts survive final/tool frames; the “Thought process” accordion keeps all received reasoning text.
- **Stream status & thinking:** assistant bubbles show a status chip (Processing spinner, Complete tick, or Failed cross). Completion now gates on the WebSocket `turn_final` event **and** all pending tool calls finishing; terminal text alone does not flip to Complete if tool calls are still pending. A “Thinking…” inline spinner appears only when the run is still processing, no visible assistant text has arrived for ≥1s, and no tool results are pending; it clears immediately on new text or when the run ends.
- Tool completion guardrails: if a provider omits tool result callbacks, the server synthesizes missing tool completion events (deduped when real results arrive) and the client marks any remaining `requesting` tools as `done` once the run finishes so spinners never stick.
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
- Tests live in `e2e/` (chat, lmstudio, logs, version, ingest). Ingest specs auto-skip when LM Studio/models are unavailable. E2E env defaults: `E2E_BASE_URL=http://localhost:6001`, `E2E_API_URL=http://localhost:6010`. `e2e/chat-tools.spec.ts` ingests the mounted fixture repo (`/fixtures/repo`), runs a vector search, mocks `POST /chat` (202) + `/ws` transcript events, and asserts inline citations show `repo/relPath` plus the host path. It asks “What does main.txt say about the project?” and expects the fixture text “This is the ingest test fixture for CodeInfo2.”

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
- Chat execution is unified behind a `ChatInterface` abstraction: the client sends only `{ conversationId, message, provider, model }`, the server loads any stored turns, streams tokens/tool events, and persists user + assistant turns (including `toolCalls`) via MongoDB or an in-memory fallback when Mongo is down. Codex uses its own thread history (only the latest user message is submitted per turn) while LM Studio replays stored history.
- `npm run dev --workspace server` (default port 5010)
- `npm run build --workspace server`
- `npm run start --workspace server`
- `npm run test --workspace server` (builds + unit tests first, then Cucumber; Chroma comes from the Testcontainers compose hook—no mock CHROMA_URL path)
- Ingest Cucumber tests run against a real Chroma via Testcontainers; Docker must be running and will publish Chroma on host port 18000 (if busy, the hook falls back to a random host port and logs it). For manual debugging, `docker compose -f server/src/test/compose/docker-compose.chroma.yml up -d` (teardown with `docker compose -f server/src/test/compose/docker-compose.chroma.yml down -v`).
- Configure `PORT` via `server/.env` (override with `server/.env.local` if needed)
- Env: `PORT` (default 5010), `LMSTUDIO_BASE_URL` (default `http://host.docker.internal:1234`), `MCP_PORT` (Codex-only MCP JSON-RPC, default 5011), `MONGO_URI` (default `mongodb://host.docker.internal:27517/db?directConnection=true`)
- Docker: `docker build -f server/Dockerfile -t codeinfo2-server .` then `docker run --rm -p 5010:5010 codeinfo2-server`
- **LM Studio tooling + Zod version pin:** the LM Studio SDK bundles Zod 3.25.76. A Zod 4.x copy pulled in by lint dependencies caused Docker-only tool-call failures (`keyValidator._parse is not a function`) because schemas were built with Zod v4 while the SDK validated with v3. We now pin Zod to `3.25.76` via an npm `overrides` entry in the root `package.json`; the regenerated `package-lock.json` ensures both host and container installs use a single Zod version, eliminating the error.

## MCP (codebase_question)

- Endpoint: JSON-RPC 2.0 on `http://localhost:${MCP_PORT:-5011}` (Codex-gated; returns `CODE_INFO_LLM_UNAVAILABLE` -32001 if Codex is not available).
- Tool: `codebase_question` with params `{ question: string; conversationId?: string; provider?: 'codex' | 'lmstudio'; model?: string }`. Responses are a single `content` item of type `text` containing JSON with ordered segments (`thinking`, `vector_summary`, `answer`), `conversationId`, and `modelId`.
- Example call:
  ```sh
  curl -s -X POST http://localhost:5011 \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"codebase_question","arguments":{"question":"What does this project do?"}}}'
  ```
- Example response shape:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "content": [
        {
          "type": "text",
          "text": "{\"conversationId\":\"...\",\"modelId\":\"gpt-5.1-codex-max\",\"segments\":[{\"type\":\"thinking\",\"text\":\"...\"},{\"type\":\"vector_summary\",\"files\":[{\"path\":\"...\",\"chunks\":1,\"match\":0.42,\"lines\":12}]},{\"type\":\"answer\",\"text\":\"...\"}]}"
        }
      ]
    }
  }
  ```

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
  {"runId":"r1","state":"skipped","counts":{"files":0},"message":"No changes detected"}
  {"runId":"r1","state":"error","counts":{"files":1,"chunks":2,"embedded":0},"lastError":"Chroma unavailable"}
  ```
- Model lock: first ingest sets lock to the chosen embedding model; subsequent ingests must use the same model while data exists.

### Ingest directory picker

- GET `/ingest/dirs?path=<absolute server path>` lists child directories under the configured base path.
  - Base defaults to `HOST_INGEST_DIR` (falls back to `/data`).
  - Response: `{ "base": "/data", "path": "/data/projects", "dirs": ["repo-a", "repo-b"] }`.
  - Errors: `{ "status": "error", "code": "OUTSIDE_BASE" | "NOT_FOUND" | "NOT_DIRECTORY" }`.
- The `/ingest` UI uses this endpoint for the “Choose folder…” modal; the Folder path field remains editable.

### Ingest cancel / re-embed / remove

- POST `/ingest/cancel/{runId}` cancels the active ingest run, purges any partial vectors tagged with the runId, updates the roots entry to `cancelled`, and responds `{ "status": "ok", "cleanup": "complete" }`. Example: `curl -X POST http://localhost:5010/ingest/cancel/<runId>`.
- POST `/ingest/reembed/{root}` re-runs ingest for the stored root path in **delta** mode using per-file SHA-256 hashes stored in Mongo (`ingest_files`).
  - Unchanged files are skipped (existing vectors remain intact).
  - Deleted files have their vectors removed.
  - Legacy roots (no `ingest_files` records) fall back to a full rebuild (delete all vectors, then re-ingest).
  - Respects the existing model lock and returns `202 { runId }` or `404 NOT_FOUND` if the root is unknown.
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
- Chat tool logs: client emits tool lifecycle entries with `source: client` and `context.channel = "client-chat"` so `/logs` accepts them while keeping chat telemetry filterable.
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

- Endpoint: `POST /chat` starts a run and returns immediately (HTTP 202). Body: `{ "provider": "lmstudio|codex", "model": "<key>", "conversationId": "<uuid>", "message": "hello" }`.
- Response (202): `{ "status": "started", "conversationId": "<uuid>", "inflightId": "<uuid>", "provider": "...", "model": "..." }`.
- Transcript streaming is **WebSocket-only** at `ws://localhost:5010/ws` (or `wss://.../ws`). Clients subscribe with `subscribe_conversation` and receive: `inflight_snapshot` (catch-up), then `assistant_delta`/`analysis_delta`/`tool_event`, finishing with `turn_final`.
- Example: `curl -s -X POST http://localhost:5010/chat -H 'content-type: application/json' -d '{"provider":"lmstudio","model":"llama-3","conversationId":"00000000-0000-0000-0000-000000000000","message":"hello"}'`.
- Logging: server records `chat.run.started` plus WS publish milestones (`chat.stream.*`) and tool lifecycle metadata (name/callId only, no args/results); payloads respect `LOG_MAX_CLIENT_BYTES`.
- Tooling: chat registers LM Studio tools `ListIngestedRepositories` and `VectorSearch` (see `server/src/lmstudio/tools.ts`) that reuse the `/tools/ingested-repos` and `/tools/vector-search` logic. Tool responses include repo id, relPath, containerPath, hostPath, chunk text/score, and model id for citations; repo-not-found/validation errors surface as tool errors. VectorSearch now derives its embedding function from the collection’s locked model; if no lock exists it surfaces `INGEST_REQUIRED`, and if the locked model is missing in LM Studio it surfaces `EMBED_MODEL_MISSING`. Usage is logged without persisting payload bodies.
- Tool lifecycle entries are pushed into the server log buffer (visible on `/logs`/Logs page) but are not rendered in the chat transcript; the client still logs the metadata for observability.
- Rendering: assistant replies use a sanitized React Markdown pipeline (`react-markdown` + `remark-gfm` + `rehype-sanitize`) so GFM lists/links/code fences display while tool blocks and citations stay plain JSX; code fences render in styled `<pre><code>` blocks and links open in a new tab.
- Cancellation: Stop sends a `cancel_inflight` message over `/ws` to abort the current run (responses may truncate). Switching conversations/unmounting unsubscribes from streaming but does not cancel the run server-side.
- Persistence: chat history is stored in MongoDB. If Mongo is unreachable, the UI falls back to stateless mode and bulk/archive controls are disabled.

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
