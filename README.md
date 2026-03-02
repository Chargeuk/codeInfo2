# CodeInfo2

Monorepo for client (React 19 + MUI), server (Express), and shared common package using npm workspaces.

## Prerequisites

- Node.js 22.x and npm 10+
- Docker 27+ and Docker Compose v2
- Git, Git-lfs, curl
- Openai Codex

## Quick Setup

### WSL Prerequisits
#### Configure WSL Git to use Windows Git Credential Manager.
Reference: https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/wsl.md
1. Install Git for Windows on the host machine.

2. In WSL, install Git:
    ```bash
    sudo apt update && sudo apt install -y git
    ```

3. In Windows PowerShell, verify Git and Git Credential Manager are available:
    ```powershell
    git --version; git credential-manager --version
    ```

4. In WSL, point Git to the Windows credential helper:
    ```bash
    git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"
    ```

5. Authenticate once with any HTTPS Git operation (for example `git fetch`); Git Credential Manager will prompt and store credentials in Windows Credential Manager.

#### Configure Executable Bit Access In WSL & Windows Git
When git repos that are available within WSL and accessed from Windows tools (e.g., SourceTree via `\\wsl$`),
file mode (executable bit) can appear different even when file contents are identical.
To keep Windows and WSL in sync, use these settings.

1. Update WSL Git to keep file mode tracking enabled so executable scripts stay correct:
    ```bash
    git config --global core.filemode true
    ```

2. Update Windows Git to disable file mode tracking so `\\wsl$` does not show mode-only changes:
    ```bash
    git config --global core.filemode false
    ```

3. Update Repo-local config ensuring you do not force `core.filemode` in the repo itself. If it exists, remove it:
    ```bash
    git config --local --unset core.filemode
    ```

3. Line endings for each repo checked out to be used within CodeInfo2 should be normalized by `.gitattributes`:
    ```
    * text=auto eol=lf
    ```

3. Quick status checks- Use these to confirm both environments agree:
    ```bash
    # WSL or Windows
    git status --porcelain=v2 -uno
    git ls-files --eol | head -n 20
    ```


### Mac & WSL That have followed the WSL setup above
1. Install CLI (host): `npm install -g @openai/codex`.
2. Ensure host.docker.internal is set to point to your local host
3. Ensure you create the folder `${HOME}/Documents/dev` and open it in a terminal to procede with the following steps. Note that all repositories must be checked out under `${HOME}/Documents/dev` (or a subfolder of that directory) in order to be visible to CodeInfo2.
4. Run `git clone https://github.com/Chargeuk/codeInfo2.git`
5. Within the cloned repo create the following empty files:
  - ./server/.env.local
  - ./client/.env.local
6. Run `start-gcf-server.sh` to allow docker from the containers to access your git credentials so it can push from the container.
7. Run `npm run compose:local` to start the required local services.

# CodeInfo2 Details

## MongoDB (conversation history)

- Conversation persistence depends on MongoDB. Default URI: `MONGO_URI=mongodb://host.docker.internal:27517/db?directConnection=true`.
- `docker-compose.yml` includes a Mongo 8 replica-set service bound to host port 27517 and passes the same URI into the server container; local dev can reuse the same URI when running the server without Compose.
- If Mongo is unreachable the server keeps running but reports `mongoConnected=false`; the client surfaces a banner and disables archive controls while allowing stateless chat.

## Codex config seed

- The repo ships `config.toml.example` at the root. On server startup, if `${CODEINFO_CODEX_HOME:-./codex}/config.toml` is missing, it is copied from the example (the `codex/` directory is git-ignored).
- Customize `./codex/config.toml` after the first run; subsequent starts leave your edits intact.

## Codex (CLI)

- Install CLI (host): `npm install -g @openai/codex` and log in.
- Login (host only): run `CODEX_HOME=./codex codex login` (or keep your existing `~/.codex`); Docker Compose mounts `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` to `/host/codex` and copies `auth.json` into `/app/codex` on startup when missing, so a separate container login is not required.
  - Note: `CODEX_HOME` is frequently set by Codex/agent environments; use `CODEINFO_HOST_CODEX_HOME` (not `CODEX_HOME`) when you need Compose to mount a specific host Codex home.
- Codex home: `CODEINFO_CODEX_HOME=./codex` (mounted to `/app/codex` in Docker); seeded from `config.toml.example` on first start—edit `./codex/config.toml` after seeding to add MCP servers or overrides.
- Behaviour when missing: if the CLI, `auth.json`, or `config.toml` are absent (and no host auth is available to copy), Codex stays disabled; startup logs explain which prerequisite is missing and the chat UI shows a disabled-state banner.
- Chat defaults: Codex runs with `workingDirectory=/data`, `skipGitRepoCheck:true`, and requires MCP tools declared under `[mcp_servers.codeinfo_host]` / `[mcp_servers.codeinfo_docker]` in `config.toml`.

## Chrome DevTools MCP

- The server container starts a **headless** Chrome instance on boot with remote debugging enabled.
- `docker-compose.local.yml` exposes the Chrome DevTools endpoint on port `9222` (e.g., `http://localhost:9222`) so the DevTools MCP server can attach.

## WSL + SourceTree (Windows Git)

If SourceTree is pointed at the WSL repo and shows `start-gcf-server.sh` (or other files) as modified while WSL Git shows a clean tree, it is usually a **file mode** mismatch (Windows Git does not track executable bits).

Recommended config:

```sh
# Windows Git (SourceTree) - ignore file mode changes globally, then clear any repo-local override
git -C //wsl$/<Distro>/home/<user>/path/to/repo config --global core.filemode false
git -C //wsl$/<Distro>/home/<user>/path/to/repo config --unset core.filemode

# WSL Git - keep executable bit tracking
git config --global core.filemode true
```

After updating, reset the file in Windows Git to clear the status:

```sh
git -C //wsl$/<Distro>/home/<user>/path/to/repo checkout -- start-gcf-server.sh
```

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
    - Ingested repo commands include optional `sourceId` and `sourceLabel`; local entries omit both fields.
    - Agents UI displays ingested commands as `<name> - [sourceLabel]` and includes `sourceId` when executing them.
  - Run a command:
    - `curl -s -X POST http://localhost:5010/agents/coding_agent/commands/run -H 'content-type: application/json' -d '{"commandName":"improve_plan"}' | jq`
    - Optional arguments:
      - `conversationId` (continue an existing agent conversation)
      - `working_folder` (absolute path; resolved like `/agents/:agentName/run`)
      - `sourceId` (ingested repo container path; required to disambiguate ingested commands)
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
  - Express `POST /mcp` (ingest tooling: `ListIngestedRepositories`, `VectorSearch`, `reingest_repository`).
  - MCP v2 JSON-RPC server on `MCP_PORT` (tooling: `codebase_question`, `reingest_repository`, documented under **MCP v2 tools** below).
    Their response conventions differ and must remain stable; shared MCP infrastructure lives under `server/src/mcpCommon/`.
- Config: `config.toml.example` seeds `[mcp_servers]` entries `codeinfo_host` and `codeinfo_docker` pointing at the URLs above when the server first runs.
- Required methods: `initialize` → `tools/list` → `tools/call`.
- Quick smoke (host):
  - `curl -X POST http://localhost:5010/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'`
  - `curl -X POST http://localhost:5010/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`
  - `curl -X POST http://localhost:5010/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"VectorSearch","arguments":{"query":"hello"}}}'`
- Tools exposed: `ListIngestedRepositories` (no params), `VectorSearch` (`query` required, optional `repository`, `limit` capped at 20), and `reingest_repository` (`sourceId` required). Results are returned as `content: [{ type: "text", text: "<json>" }]` (JSON string).
- Classic MCP `reingest_repository` compatibility lock: failures return JSON-RPC `error` envelopes (not `result.isError`) with canonical mappings (`INVALID_PARAMS`, `NOT_FOUND`, `BUSY`).
- Reingest canonical contract (shared service behavior used by MCP wiring tasks):
  - request args: `{ "sourceId": "<absolute-normalized-container-path>" }`
  - success payload: `{ "status": "started", "operation": "reembed", "runId": "...", "sourceId": "..." }`
  - failure mappings: invalid params -> `error.code=-32602`, `error.message="INVALID_PARAMS"`; unknown root -> `error.code=404`, `error.message="NOT_FOUND"`; busy -> `error.code=429`, `error.message="BUSY"`
  - error retry guidance includes deterministic `fieldErrors.reason` plus `reingestableRepositoryIds` and `reingestableSourceIds`.

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
- **Logs page:** open `/logs` to view combined server/client logs with level/source chips, free-text filter, live SSE toggle (auto-reconnect), manual refresh, and a “Send sample log” button that emits an example entry end-to-end. Opening the page emits `DEV-0000034:T7:logs_page_viewed` for verification. Ingest failure handling now emits frontend-visible `DEV-0000036:T17:ingest_provider_failure` entries for provider and route catch paths (`/ingest/start`, `/ingest/reembed/:root`, `/ingest/cancel/:runId`, `/ingest/roots`) with deterministic context (`runId`, `provider`, `surface`, `operation`, `code`, `message`, `retryable`, `attempt`, `waitMs`, `model`, `path/root`, `currentFile`, `stage`) where retryable failures map to `warn` and non-retryable/terminal failures map to `error`.
- **Chat page:** open `/chat` to chat with LM Studio or Codex via `POST /chat` (HTTP 202) plus WebSocket streaming at `/ws`. Models come from `/chat/models` (first auto-selects) and are filtered to chat-capable LLMs (embedding/vector models are hidden); the dropdown, input, and Send stay disabled during load/error/empty states or while a response is running. Messages render newest-first near the controls with distinct user/assistant bubbles, and transcript updates arrive via `/ws` events (late subscribers receive an `inflight_snapshot` catch-up). Switching conversations or navigating away unsubscribes from streaming but does not cancel the run server-side; Stop cancels the current in-flight run. Chat history is persisted in Mongo: the left sidebar lists conversations newest-first, supports active/archived/all filtering plus multi-select bulk archive/restore/delete, and turn snapshots come from `GET /conversations/:id/turns` which returns full history plus any in-flight snapshot (no pagination). Conversation listing supports agent scoping via `/conversations?agentName=__none__` (only conversations with no `agentName`) and `/conversations?agentName=<agent>` (exact match). When the provider is OpenAI Codex and available, a **Re-authenticate (device auth)** button opens a dialog that calls `POST /codex/device-auth` and shows the verification URL + user code for re-login.
- **Chat request defaults:** `POST /chat` now resolves provider/model with one shared order: explicit request value -> `CHAT_DEFAULT_PROVIDER` / `CHAT_DEFAULT_MODEL` -> hardcoded fallback (`codex`, `gpt-5.3-codex`). Committed defaults in `server/.env` and `server/.env.e2e` set those env keys to `codex` and `gpt-5.3-codex`.
- **Raw input validation contracts:** request payload text is preserved as entered for valid requests, but whitespace-only/newline-only inputs are rejected server-side before provider execution. `POST /chat` returns `400 { status: "error", code: "VALIDATION_FAILED", message: "message must contain at least one non-whitespace character" }`; `POST /agents/:agentName/run` returns `400 { error: "invalid_request", message: "instruction must contain at least one non-whitespace character" }`.
- **Runtime provider auto-fallback:** chat and MCP `codebase_question` apply the same single-hop runtime fallback. If the selected/default provider is unavailable and the other provider has a selectable model, execution switches once to that other provider. If no selectable fallback model exists, the request keeps the original provider and returns the existing unavailable contract (`POST /chat`: `503 PROVIDER_UNAVAILABLE`; MCP `codebase_question`: JSON-RPC `-32001 CODE_INFO_LLM_UNAVAILABLE`).
- **Task 14 fallback guardrail:** explicit `provider=lmstudio` requests no longer bypass runtime availability checks; LM Studio is only considered available when runtime model discovery returns at least one selectable chat model.
- **Conversation metadata persistence:** REST `/chat` and MCP `codebase_question` persist the resolved execution provider/model on the conversation. When execution is not Codex, stale `flags.threadId` is cleared to avoid cross-provider resume mismatches.
- **Agents page:** open `/agents` to run Codex agents with the same layout + transcript UI as Chat (Drawer sidebar, controls above transcript, WebSocket-driven transcript events). The conversations sidebar matches Chat with filter tabs, per-row archive/restore, and bulk archive/restore (bulk delete only when viewing Archived). History is scoped to the selected agent (`agentName=<agent>`) and updates live via `conversation_upsert` / `conversation_delete` over `/ws`. Controls include agent selection, optional command execution (macros), a working folder override with a **Choose folder** dialog, and Send/Stop/New conversation; agent descriptions + warnings live behind the info popover next to the selector. When an agent is selected and Codex is available, a **Re-authenticate (device auth)** button opens the same device-auth dialog for refreshing that agent’s credentials.
- **Agents raw send behavior:** the Agents send path preserves valid non-whitespace instruction text exactly as entered (including leading/trailing spaces and multiline newlines) in outbound `POST /agents/:agentName/run` payloads; whitespace-only/newline-only submissions are blocked client-side before dispatch.
- **Agents user markdown parity:** user bubbles render through the same shared markdown component as assistant bubbles, so lists/code fences/mermaid and sanitization behavior match assistant rendering while preserving the existing Agents bubble layout/chrome.
- **Agents render purity:** user-markdown rendering in Agents avoids render-time logger side effects so React rerenders/StrictMode do not duplicate instrumentation.
- **Flows page:** open `/flows` to list available flow definitions and run them end-to-end. The selector shows ingested flows as `<name> - [Repo]` labels (locals remain unlabeled) and keeps duplicates selectable; when an ingested flow is selected the Run action includes its `sourceId`. Optionally set a working folder and custom title, then Run to start (or Resume when a saved `resumeStepPath` exists). The info popover beside the selector shows warnings/Markdown descriptions, and the New Flow button resets the transcript + form fields while keeping the same flow selected. The sidebar lists conversations for the selected flow, while the transcript shows per-step metadata (label + agent type/identifier) plus status chips; Stop sends `cancel_inflight` over `/ws`.
- **Flows API:** flow definitions live under `flows/<flowName>.json` (resolved as a sibling to `codex_agents` when `CODEINFO_CODEX_AGENT_HOME` is set, or overridden via `FLOWS_DIR`) and are listed via `GET /flows` (ingested entries include optional `sourceId`/`sourceLabel`; local entries omit both); run a flow with `POST /flows/:flowName/run`. Conversation history can be filtered by flow using `GET /conversations?flowName=<name>` or `flowName=__none__` to exclude flow runs. Docker Compose mounts `flows-sandbox` and sets `FLOWS_DIR=/app/flows-sandbox` so the compose stack uses the sandbox flow definitions.
- **Chat providers:** a Provider dropdown (LM Studio by default) sits to the left of the Model selector. Codex appears as `OpenAI Codex` when the CLI/config/auth are present; when unavailable it stays disabled with inline guidance, and when tools are unavailable the Codex send input remains disabled with an MCP warning. Provider is locked once a conversation starts, while the model can still change. The message input is now multiline beneath the selectors; send/stop live beside it. Tool blocks/citations render only when the active provider advertises `toolsAvailable`.
- **Codex models:** `/chat/models?provider=codex` uses the `Codex_model_list` CSV env (trimmed, de-duplicated). Defaults in `server/.env` are `gpt-5.1-codex-max,gpt-5.1-codex-mini,gpt-5.1,gpt-5.2,gpt-5.2-codex`; if the env list is empty the server falls back to the same defaults and adds a warning.
- **Codex flags panel:** when provider=`OpenAI Codex`, a collapsible “Codex flags” panel appears under the Provider/Model row. Defaults are delivered by `GET /chat/models?provider=codex` via `codexDefaults` (sourced from `Codex_*` env values): sandbox mode (`Codex_sandbox_mode`), approval policy (`Codex_approval_policy`), reasoning effort (`Codex_reasoning_effort`), and toggles for **Enable network access** / **Enable web search** (`Codex_network_access_enabled` / `Codex_web_search_enabled`). The current defaults in `server/.env` are `danger-full-access`, `on-failure`, `high`, and `true/true` respectively. If a Codex request omits any flag, the server applies these env defaults. The Codex interface uses the validated flags directly and leaves missing values undefined so Codex config/env defaults can apply. The client omits Codex flags from `/chat` payloads when the selected value matches `codexDefaults`, so only user changes are sent; LM Studio ignores Codex-only flags. `codexWarnings` in the same response surfaces any env or runtime warnings; non-empty warnings render a banner above the flags panel. `xhigh` is accepted and passed through to Codex as `model_reasoning_effort="xhigh"` (via the installed `@openai/codex-sdk`). Example payload fragment: `"sandboxMode": "danger-full-access", "approvalPolicy": "on-request", "modelReasoningEffort": "low", "networkAccessEnabled": false, "webSearchEnabled": false`.
- **Chat bubble styling:** user and assistant bubbles share a consistent 14px border radius while keeping status chips, tool blocks, and citations aligned.
- **Bubble metadata headers:** user/assistant bubbles display timestamps, with assistant bubbles optionally showing token usage, timing/rate, and agent step indicators when metadata is available (status/error bubbles are excluded).
- **Chat tool visibility:** tool calls render closed by default with name + success/failure. Expanding shows a Parameters accordion (default-closed) plus tool-specific details: ListIngestedRepositories lists all repos with expandable metadata; VectorSearch shows an alphabetical, host-path-only file list with highest match value, summed chunk count, and total line count per file. Errors surface trimmed code/message with a toggle to reveal the full payload. The server now synthesizes `tool-result` events when LM Studio omits them and dedupes if native events arrive later, so the UI always receives parameters and payloads, and it suppresses assistant-role messages that merely echo tool payloads so raw tool JSON never appears as the chat reply.
- **Chat citations:** vector search citations now live inside a default-closed “Citations” accordion under the assistant bubble; expanding reveals `repo/relPath` + host path (when available) and the chunk text that grounded the reply.
- **Chat system context:** the shared prompt now lives in `common/src/systemContext.ts` and is re-exported in the client; it is prepended to LM Studio payloads client-side and injected server-side on the first Codex turn so the model sees the repo/tool instructions without replaying history.
- **Thought process reliability:** streamed analysis (`<think>`/Harmony analysis channel) is buffered append-only per turn, so multiple analysis bursts survive final/tool frames; the “Thought process” accordion keeps all received reasoning text.
- **Stream status & thinking:** assistant bubbles show a status chip (Processing spinner, Complete tick, or Failed cross). Completion now gates on the WebSocket `turn_final` event **and** all pending tool calls finishing; terminal text alone does not flip to Complete if tool calls are still pending. A “Thinking…” inline spinner appears only when the run is still processing, no visible assistant text has arrived for ≥1s, and no tool results are pending; it clears immediately on new text or when the run ends.
- Tool completion guardrails: if a provider omits tool result callbacks, the server synthesizes missing tool completion events (deduped when real results arrive) and the client marks any remaining `requesting` tools as `done` once the run finishes so spinners never stick.
- **Ingest page:** open `/ingest` to start an embedding run against a server-accessible folder. The form validates required path/name fields, lets you add an optional description, choose an embedding model (disabled once the shared collection is locked), toggle dry-run, and surfaces inline errors such as “Path is required” or “Select a model.” A banner appears when the embedding model is locked to a specific id. The page now lists embedded folders with per-row actions (Re-embed, Remove, Details), bulk actions, inline action feedback, and a tooltip over the name for descriptions. A Details drawer shows path/model/status, counts, last error, and the include/exclude defaults; the empty state explains that the model locks after the first ingest. Actions are disabled while an ingest is active to avoid conflicts. AST skip/failure banners appear when Tree-sitter indexing skips unsupported files or hits parse failures.
- **Active ingest card:** the page subscribes to the ingest WebSocket stream when `/ingest` is mounted and receives an immediate snapshot plus live updates (no polling). The card shows state chips (Queued/Scanning/Embedding/Completed/Cancelled/Error), file/chunk counts, any last error, a “Cancel ingest” button that calls `/ingest/cancel/{runId}` (disabled while cancelling), and a “View logs for this run” link (pre-filters logs with the runId). Per-file progress fields include `currentFile`, `fileIndex`, `fileTotal`, `percent` (1dp), and `etaMs` (milliseconds). AST status (supported/skipped/failed counts, last indexed) is shown when available. When the run reaches a terminal state, the card hides (no last-run summary) after refreshing roots/models. If the WebSocket drops, the page shows an explicit error banner instead of falling back to REST.
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

## Environment policy

- Commit `.env` files with safe defaults.
- Keep secrets in `.env.local` (git-ignored) when needed.
