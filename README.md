# CodeInfo2

Monorepo for client (React 19 + MUI), server (Express), and shared common package using npm workspaces.

## Prerequisites

- Node.js 22.x and npm 10+
- Docker 27+ and Docker Compose v2
- Git, Git-lfs, curl
- Openai Codex

## Quick Setup

### WSL Prerequisites

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

4. Line endings for each repo checked out to be used within CodeInfo2 should be normalized by `.gitattributes`:

   ```
   * text=auto eol=lf
   ```

5. Quick status checks- Use these to confirm both environments agree:
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

### Corporate Registry and Certificate Overrides (Restricted Networks)

Use this section only when your network requires internal registries and/or corporate CA certificates. Standard users can leave all `CODEINFO_*` values unset.

Workflow env-file rules:

```text
compose/compose:local -> edit server/.env.local
e2e -> edit .env.e2e
```

For e2e specifically, `.env.e2e` is used for compose interpolation values. Container runtime defaults still come from `server/.env.e2e` and `client/.env.e2e`.

Client env contract:

- `client/.env` / `client/.env.local` now use `VITE_CODEINFO_API_URL`, `VITE_CODEINFO_LMSTUDIO_URL`, `VITE_CODEINFO_LOG_FORWARD_ENABLED`, and `VITE_CODEINFO_LOG_MAX_BYTES`.
- Docker Compose passes the same renamed `VITE_CODEINFO_*` values into the client build and runtime container so the built bundle and runtime-injected `window.__CODEINFO_CONFIG__` stay aligned.
- Older generic client log-level and log-stream toggles are documentation-only leftovers and are not live runtime readers.

Corporate certificate directory requirements:

- Example host path: `/home/<user>/corp-certs`
- Put corporate CA files in that directory as `.crt` files.
- `CODEINFO_CORP_CERTS_DIR` points to this host directory and is mounted into `/usr/local/share/ca-certificates/codeinfo-corp`.

`CODEINFO_REFRESH_CA_CERTS_ON_START=false` is the default behavior. Only case-insensitive `true` enables refresh. If refresh is enabled and certs are missing/invalid, server startup fails fast with non-zero exit.

| Variable                             | Default when unset                                 | Where used                                                                                                    |
| ------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CODEINFO_NPM_REGISTRY`              | npm default registry behavior                      | Docker build-time npm install steps in server/client images, and host helper install in `start-gcf-server.sh` |
| `CODEINFO_PIP_INDEX_URL`             | pip default index behavior                         | Server Docker build-time `pip install`                                                                        |
| `CODEINFO_PIP_TRUSTED_HOST`          | pip default trusted-host behavior                  | Server Docker build-time `pip install`                                                                        |
| `CODEINFO_NODE_EXTRA_CA_CERTS`       | `/etc/ssl/certs/ca-certificates.crt`               | Server runtime export before Node starts                                                                      |
| `CODEINFO_CORP_CERTS_DIR`            | `./certs/empty-corp-ca` compose fallback source    | Compose server cert mount source to `/usr/local/share/ca-certificates/codeinfo-corp:ro`                       |
| `CODEINFO_REFRESH_CA_CERTS_ON_START` | Disabled (`false` behavior unless value is `true`) | Server entrypoint CA refresh gate before `exec node dist/index.js`                                            |

# CodeInfo2 Details

## MongoDB (conversation history)

- Conversation persistence depends on MongoDB. Default URI: `CODEINFO_MONGO_URI=mongodb://host.docker.internal:27517/db?directConnection=true`.
- `docker-compose.yml` includes a Mongo 8 replica-set service bound to host port 27517 and passes the same URI into the server container; local dev can reuse the same URI when running the server without Compose.
- If Mongo is unreachable the server keeps running but reports `mongoConnected=false`; the client surfaces a banner and disables archive controls while allowing stateless chat.

## Codex config seed

- On server startup, if `${CODEINFO_CODEX_HOME:-./codex}/config.toml` is missing, the server writes one canonical in-code base template to that path (the `codex/` directory is git-ignored).
- `config.toml.example` may remain in the repo as a human-facing sample, but runtime bootstrap does not read, parse, or copy it.
- Customize `./codex/config.toml` after the first run; subsequent starts leave your edits intact.
- Fresh base bootstrap uses `model = "gpt-5.3-codex"` and seeds Context7 in the no-key local stdio form `args = ['-y', '@upstash/context7-mcp']`; it does not seed any checked-in or placeholder `--api-key` pair.
- Chat runtime config bootstrap (`./codex/chat/config.toml`) is deterministic and non-destructive:
  - if chat config exists: no overwrite (`existing_noop`).
  - if chat config is missing: write the canonical in-code chat template directly (`generated_template`), regardless of whether base config exists.
  - on-disk template files such as `codex/chat/config copy.toml` are ignored during bootstrap.
  - IO/permission failures are surfaced with deterministic warnings and no silent fallback; failed write paths clean up partial destination files.
- Resolved chat and agent runtime config now inherit a defined base-key set from `./codex/config.toml` instead of relying on chat bootstrap copying the full base file:
  - inherited additively when omitted by the runtime-specific file: `projects`, `mcp_servers`, `personality`, `tools`, `model_provider`, `model_providers`
  - still runtime-owned when present in the runtime-specific file: `model`, `approval_policy`, `sandbox_mode`, `web_search`
  - strict runtime readers still hard-fail on invalid base/runtime TOML, while chat-default fallback reads continue to warn and fall back without rewriting invalid chat files
  - for local stdio `[mcp_servers.context7]` definitions that use `command` plus `args`, `CODEINFO_CONTEXT7_API_KEY` is now the runtime source of truth whenever no usable key is present, including placeholder-equivalent `--api-key` values and the already-no-key args form; the overlay happens in memory only and never rewrites the TOML files on disk
  - placeholder-equivalent Context7 values are treated as unusable and normalize to either the env overlay or the no-key args form `['-y', '@upstash/context7-mcp']`; if the args are already in that no-key form and the env var is non-empty, runtime appends `--api-key <env>` in memory

## Codex (CLI)

- Install CLI (host): `npm install -g @openai/codex` and log in.
- Login (host only): run `CODEX_HOME=./codex codex login` (or keep your existing `~/.codex`); Docker Compose mounts `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` to `/host/codex` and copies `auth.json` into `/app/codex` on startup when missing, so a separate container login is not required.
  - Note: `CODEX_HOME` is frequently set by Codex/agent environments; use `CODEINFO_HOST_CODEX_HOME` (not `CODEX_HOME`) when you need Compose to mount a specific host Codex home.
- Codex home: `CODEINFO_CODEX_HOME=./codex` (mounted to `/app/codex` in Docker); seeded from the canonical in-code base template on first start. Edit `./codex/config.toml` after seeding to add MCP servers or overrides.
- Behaviour when missing: if the CLI, `auth.json`, or `config.toml` are absent (and no host auth is available to copy), Codex stays disabled; startup logs explain which prerequisite is missing and the chat UI shows a disabled-state banner.
- Chat defaults: Codex runs with `workingDirectory=/data`, `skipGitRepoCheck:true`, and requires MCP tools declared under `[mcp_servers.codeinfo_host]` / `[mcp_servers.codeinfo_docker]` in `config.toml`.
- Server SDK pin and runtime guard are coupled:
  - `@openai/codex-sdk` is pinned at `0.107.0` in `server/package.json`.
  - startup guard requires exact `0.107.0`; pre-release, lower, and higher versions are rejected.
  - if installed and required versions diverge, startup emits deterministic guard-rejection logs and the mismatch must be corrected before release.

## REST Codex defaults behavior

- REST chat capability surfaces now use one shared Codex-default resolver path.
- Covered fields are `sandbox_mode`, `approval_policy`, `model_reasoning_effort`, `model`, and `web_search`.
- Resolution precedence is deterministic per field:
  - request override -> `codex/chat/config.toml` -> legacy env fallback -> hardcoded safe fallback.
- The `model` from `codex/chat/config.toml` is treated as the Codex chat default model and is unioned into the available Codex model list when `Codex_model_list` does not already contain it.
- The shared Codex-aware read path is used by `/chat/models`, `/chat/providers`, `/chat` request validation, and MCP `codebase_question`, and those callers reread `codex/chat/config.toml` on each request instead of caching a snapshot.
- `web_search` handling is canonical-first:
  - canonical `web_search` wins over alias keys;
  - alias bool values normalize to canonical modes (`true -> live`, `false -> disabled`).
- `/chat/models?provider=codex` and `/chat/providers` return resolver-backed `codexDefaults` and `codexWarnings`.
- `/chat` request validation applies the same resolver-backed defaults when Codex flags are omitted.
- The existing React 19 + MUI chat selector path stays unchanged: the client keeps consuming `/chat/providers` and `/chat/models`, and the controlled `TextField select` + `MenuItem` inputs rerender from server-fed state without a Story 47 payload change.

## Story 47 Verification Markers

- `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED`
  Expected outcome: emitted from REST and MCP Codex-facing selection paths with `success=true`, a resolved model, and the correct `model_source`.
- `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP`
  Expected outcome: emitted during base-config seeding checks with `template_source=in_code`, `outcome=seeded|existing`, and `success=true`.
- `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP`
  Expected outcome: emitted during chat-config seeding checks with `source=chat_template`, `outcome=seeded|existing`, and `success=true`.
- `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`
  Expected outcome: emitted during chat and agent runtime reads with `success=true`, plus explicit `inherited_keys` and `runtime_override_keys`.
- `DEV_0000047_T05_CONTEXT7_NORMALIZED`
  Expected outcome: emitted after runtime inheritance with `success=true` and the expected `mode` for the active Context7 key scenario (`env_overlay`, `no_key_fallback`, `explicit_key_preserved`, or `no_context7_definition`).

## Chrome DevTools MCP

- The server container starts a **headless** Chrome instance on boot with remote debugging enabled.
- `docker-compose.local.yml` exposes the Chrome DevTools endpoint on port `9222` (e.g., `http://localhost:9222`) so the DevTools MCP server can attach.

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

## Features at a Glance

- Chat workspace with provider/model selection, streaming responses, conversation history, and tool/citation rendering.
- Agents workspace for running Codex agent instructions and reusable command macros with history and stop/resume controls.
- Flows workspace to execute JSON-defined multi-step flows and resume interrupted runs.
  Previously rendered Flow assistant bubbles now stay visible while later steps stream because the client ignores stale earlier-step websocket transcript events instead of rebinding the active bubble.
- Ingest workspace for embedding repositories, monitoring ingest progress, and managing re-embed/remove operations.
- Logs workspace for live server/client log inspection and filtering.

## Shared Stop Behavior

- Chat, Agents, command runs, and Flows now use the same server-authoritative stop contract.
- The client always sends `cancel_inflight` with `conversationId` and includes `inflightId` only when that server-visible inflight id is already known.
- During the startup race, conversation-only stop is valid; this is the supported path when the run already owns the conversation but the page has not yet stored a usable `inflightId`.
- If no active run exists for that conversation, the server emits non-terminal `cancel_ack.result === 'noop'` correlated by `requestId`; the UI clears `stopping` from that ack and must not invent a fake stopped bubble.
- A real active stop is confirmed only when websocket delivery reaches `turn_final.status === 'stopped'`.
- The visible stop UX is aligned across pages: while a stop is pending the transcript stays in `stopping`, and after a confirmed stop persisted turns hydrate back into a visible `Stopped` state.

## Story 46 Safety Rules

- Ingest now rejects blank-only fresh runs after chunk filtering. If discovered files produce zero embeddable chunks, the run ends with the existing `NO_ELIGIBLE_FILES` contract instead of looking like a successful skip.
- Embedding providers still keep defensive blank-input guards, but the shared ingest chunk filter is the primary boundary. Blank or whitespace-only chunk text must never be sent to OpenAI or LM Studio.
- Chat navigation is not cancellation. Sidebar selection, `New conversation`, provider changes, and model changes all switch the visible draft locally without sending `cancel_inflight`.
- Explicit `Stop` remains the only Chat action that cancels an active run. Hidden conversations continue in the background until they finish or the user stops them directly.
- Revisiting a hidden conversation reuses the existing `/conversations/:id/turns` transcript plus optional inflight snapshot so the visible page rehydrates the correct persisted state.

## Common Usage

1. Start the local stack: `npm run compose:local`.
2. Open the client app: `http://localhost:5501`.
3. Use **Chat** (`/chat`) for model conversations and repository tooling.
4. Use **Agents** (`/agents`) for specialized agent-driven work and command macros.
5. Use **Flows** (`/flows`) for repeatable multi-step automations.
6. Use **Ingest** (`/ingest`) before repository-aware answers if a repo is not indexed yet.

## Story 48 Workflow Contract

- Working-repo-first lookup now applies everywhere this story touched:
  - working repository first;
  - referencing-file owner second;
  - local `codeInfo2` third;
  - other ingested repositories last.
- Nested lookups restart that same order on every hop. A prior winner does not become the next root unless it is also the owner of the next referencing file.
- The working-folder picker is now a saved conversation setting for Chat, Agents, and Flows. Direct command runs reuse the owning agent conversation instead of creating a separate command conversation.
- Picker behavior is intentionally strict:
  - switching back to an existing conversation restores its saved folder;
  - idle edits save through the shared conversation working-folder route;
  - active runs lock the picker;
  - stale or invalid saved paths are cleared back to the normal empty state.
- Runtime lookup debugging is split across two surfaces:
  - structured logs show full candidate order and selected repository;
  - persisted run metadata stores only the compact lookup summary (`selectedRepositoryPath`, `fallbackUsed`, `workingRepositoryAvailable`).
- Repository-owned env names now use the `CODEINFO_*` namespace on the server and `VITE_CODEINFO_*` in the client/runtime config path.
- The current client/runtime env set is:
  - `VITE_CODEINFO_API_URL`
  - `VITE_CODEINFO_LMSTUDIO_URL`
  - `VITE_CODEINFO_LOG_FORWARD_ENABLED`
  - `VITE_CODEINFO_LOG_MAX_BYTES`
- OpenAI embeddings now use tokenizer-backed counting with Node `tiktoken` and the real `8192`-token model boundary. OpenAI-specific counting failures fail closed with explicit ingest errors instead of falling back to the old heuristic or whitespace estimates.
- Final full-story regression commands:
  - `npm run build:summary:server`
  - `npm run build:summary:client`
  - `npm run test:summary:server:unit`
  - `npm run test:summary:server:cucumber`
  - `npm run test:summary:client`
  - `npm run test:summary:e2e`
  - `npm run compose:build:summary`
  - `npm run compose:up`
  - `npm run compose:down`

## Story 45 Workflow Files

Story 45 extends command and flow JSON files with repository-aware markdown loading and blocking re-ingest steps without adding a new paused or resumable workflow mode.

- Command files keep the existing top-level shape `{ "Description": string, "items": [...] }`.
- Flow files keep the existing top-level shape `{ "description"?: string, "steps": [...] }`.
- Command `message` items and flow `llm` steps now accept exactly one instruction source:
  - inline content/messages; or
  - `markdownFile`, resolved as one verbatim instruction string.
- Commands, dedicated flow steps, and flow-owned command files can now run `{ "type": "reingest", "sourceId": "<absolute-ingested-root>" }`.
- Re-ingest stays synchronous and blocking inside the runner. Once a re-ingest request has started, terminal `completed`, `cancelled`, and `error` outcomes are recorded as structured results and later workflow items can continue.

### `codeinfo_markdown` folder

- `markdownFile` is always relative to a repository-level `codeinfo_markdown/` directory.
- Safe nested paths such as `architecture/review.md` are supported.
- Empty paths, absolute paths, `..` traversal, and normalized escapes outside `codeinfo_markdown/` are rejected.
- Markdown bytes are read and decoded as strict UTF-8, then passed to the agent exactly as read. The server does not trim, split, or reinterpret the markdown into multiple messages.

### Repository lookup order

- Direct commands launched with a repository `sourceId` look for markdown in that same source repository first, then the local `codeInfo2` checkout, then other ingested repositories sorted by case-insensitive label and full path.
- Direct commands launched without a repository `sourceId` resolve from the local `codeInfo2` checkout first.
- Flow `llm.markdownFile` steps and flow-owned command files use the parent flow repository as the same-source candidate, then fall back to local `codeInfo2`, then the same deterministic sorted ingested-repository list.
- A missing file falls through to the next repository candidate. If a higher-priority candidate contains the file but it is unreadable or invalid UTF-8, the step fails immediately instead of silently falling through.

### Example command file

```json
{
  "Description": "Refresh the repository index and run the review prompt.",
  "items": [
    {
      "type": "reingest",
      "sourceId": "/workspace/repository"
    },
    {
      "type": "message",
      "role": "user",
      "markdownFile": "architecture/review.md"
    },
    {
      "type": "message",
      "role": "user",
      "content": ["Summarize the main risks in three bullets."]
    }
  ]
}
```

### Example flow file

```json
{
  "description": "Refresh the repository index and run the review prompt.",
  "steps": [
    {
      "type": "reingest",
      "label": "Refresh repository index",
      "sourceId": "/workspace/repository"
    },
    {
      "type": "llm",
      "label": "Architecture review",
      "agentType": "planning_agent",
      "identifier": "architecture-review",
      "markdownFile": "architecture/review.md"
    }
  ]
}
```

## Agents Workspace Behavior Notes

- Command start-step execution:
  - The command row shows `Command` -> `Start step` -> `Command info` -> `Execute command`.
  - `Start step` is always visible and uses backend `stepCount` to render `Step 1..Step N`.
  - `GET /agents/{agentName}/commands` always returns `stepCount >= 1` per command; unreadable/invalid command files return sentinel `stepCount: 1` with `disabled: true`.
  - Before selecting a valid command, `Start step` stays disabled with `Select command first`.
  - Changing command selection resets `Start step` back to `Step 1`.
  - Single-step commands (`stepCount: 1`) keep `Start step` visible but disabled on `Step 1`.
  - Execute Command sends `startStep` in `POST /agents/{agentName}/commands/run` and backend range errors (for example `startStep must be between 1 and N`) are shown in the existing run error banner.
  - Backward compatibility is preserved: when `startStep` is omitted, server execution defaults to step `1`.
  - Scope boundary: start-step controls are AGENTS-page command execution only (not flows/chat/MCP).
- Command info popover:
  - The **Command info** control is disabled until a command is selected.
  - Clicking the disabled wrapper logs a blocked event (`[agents.commandInfo.blocked] reason=no_command_selected`).
  - Selecting a command and opening the popover logs (`[agents.commandInfo.open] commandName=<name>`).
- Prompt discovery preconditions:
  - Prompt discovery is commit-driven from `working_folder` only (blur, Enter, or directory-picker commit).
  - Discovery calls `GET /agents/{agentName}/prompts?working_folder=<value>`.
  - Prompt selector visibility is state-based:
    - visible when prompts are returned,
    - hidden for empty working folder or zero-results success,
    - inline error shown when discovery fails for a non-empty committed folder.
- Conversation working-folder restore and lock behavior:
  - Chat, Agents, and Flows restore the saved working folder from the selected conversation when you switch back into an existing conversation.
  - Idle edits on an existing conversation save through the shared conversation-working-folder route; clearing the field and blurring clears the saved value.
  - If the server clears an invalid saved folder, the picker returns to its normal empty state without a manual refresh.
  - Working-folder pickers are read-only while the related chat, agent, command, or flow run is still active.
- Execute Prompt flow:
  - Execute Prompt is enabled only when a valid prompt is selected.
  - Execution composes a canonical instruction preamble and replaces only the `<full path of markdown file>` placeholder with selected prompt `fullPath`.
  - Execute Prompt uses the existing instruction run endpoint (`POST /agents/{agentName}/run`) and forwards committed `working_folder`.

## Agents Manual Verification Log Matrix

- `[agents.prompts.route.request]`: server received prompts-route request with agent/folder context.
- `[agents.prompts.route.success]`: server returned prompts-route success with prompts count.
- `[agents.prompts.route.error]`: server prompts-route request failed (validation/not-found/internal).
- `[agents.prompts.discovery.start]`: service started discovery from committed `working_folder`.
- `[agents.prompts.discovery.complete]`: service completed discovery and returned prompts.
- `[agents.prompts.discovery.empty]`: service completed with zero prompts / missing prompts directory.
- `[agents.prompts.api.request]`: client issued prompts API request.
- `[agents.prompts.api.success]`: client received prompts API success.
- `[agents.prompts.api.error]`: client received prompts API error.
- `[agents.commandInfo.open]`: command info popover opened with selected command.
- `[agents.commandInfo.blocked]`: command info was clicked with no command selected.
- `DEV_0000040_T04_CLIENT_AGENTS_API`: command-run API payload marker with `includesStartStep`/`startStep`.
- `DEV_0000040_T05_AGENTS_UI_EXECUTE`: AGENTS execute-click marker with selected command + `startStep`.
- `DEV_0000040_T12_DOC_SYNC_COMPLETE`: docs/contract synchronization marker emitted once during final verification with context fields for `readme`, `design`, `projectStructure`, and `openapi` sync status.
- `[agents.prompts.discovery.commit]`: UI committed `working_folder` (blur/enter/picker).
- `[agents.prompts.discovery.request.start]`: UI started a prompts discovery request id.
- `[agents.prompts.discovery.request.stale_ignored]`: stale discovery response was ignored.
- `[agents.prompts.selector.visible]`: prompts selector row became visible with prompt count.
- `[agents.prompts.selector.hidden]`: prompts selector row hidden (`empty_working_folder` or `discovery_zero_results`).
- `[agents.prompts.selection.changed]`: prompt selection changed (`relativePath` or `none`).
- `[agents.prompts.execute.clicked]`: Execute Prompt clicked with selected relative/full path context.
- `[agents.prompts.execute.payload_built]`: execute payload constructed; `instructionHasFullPath=true` expected.
- `[agents.prompts.execute.result]`: execute path completed with `status=started` or `status=error` and code.

## Story 50 Host-Network Runtime and Validation

Story 50 finishes the portable re-ingest selector work and moves the checked-in main runtime to a host-network Compose contract. The validated runtime uses these host-visible surfaces:

- client UI: `http://host.docker.internal:5001`
- REST API plus classic `POST /mcp`: `http://host.docker.internal:5010`
- dedicated chat MCP: `http://host.docker.internal:5011`
- dedicated agents MCP: `http://host.docker.internal:5012`
- Playwright MCP control URL: `http://host.docker.internal:8932/mcp`
- Chrome DevTools discovery for manual browser attachment: `http://host.docker.internal:9222`

Host-network prerequisites:

- Docker Desktop or an equivalent runtime that supports host networking for the checked-in Compose stack
- `host.docker.internal` must resolve from both the host and the containerized agent/browser tooling
- repositories that need to be visible to Codex and runtime folder pickers must live under `${HOME}/Documents/dev`
- host Codex auth must be available through `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` so the server container can seed `/app/codex/auth.json`

Wrapper-first validation flow:

1. Build and test through the checked-in summary wrappers:
   - `npm run build:summary:server`
   - `npm run build:summary:client`
   - `npm run test:summary:server:unit`
   - `npm run test:summary:server:cucumber`
   - `npm run test:summary:client`
   - `npm run test:summary:e2e`
   - `npm run compose:build:summary`
2. Start the validated main stack with `npm run compose:up`.
3. Probe the live host-network listeners with `npm run test:summary:host-network:main`.
4. Perform the manual Playwright-MCP proof against `http://host.docker.internal:5001`.
5. Stop the stack with `npm run compose:down`.

Evidence locations:

- summary-wrapper logs: `logs/test-summaries/`
- client/server test logs: `test-results/`
- manual Playwright screenshots: `playwright-output-local/0000050-14-chat-ready.png` and `playwright-output-local/0000050-14-logs-proof.png`
- final validation marker helper: `scripts/emit-task14-validation-marker.mjs`
- reviewer-facing summary: `planning/0000050-pr-summary.md`

Wrapper log review rule:

- if a summary wrapper reports clean success with `agent_action: skip_log`, do not open the saved log just to inspect it
- only open full logs when the wrapper reports failure, unexpected warnings, or ambiguous/unknown counts

### Story 50 Manual Proof Markers

Manual Playwright-MCP review uses the Story 50 marker set as proof evidence. Reviewers should expect these markers in the validated wrapper logs and/or the running `/logs` page:

- `DEV-0000050:T01:reingest_request_shape_accepted` — runtime `/logs`; proves the re-ingest request union reached execution
- `DEV-0000050:T02:reingest_strict_result_normalized` — runtime `/logs`; proves the strict normalized result contract
- `DEV-0000050:T03:reingest_targets_resolved` — runtime `/logs`; proves `sourceId` / `current` / `all` target resolution
- `DEV-0000050:T04:reingest_payload_persisted` — runtime `/logs`; proves the persisted transcript payload kind and target mode
- `DEV-0000050:T05:markdown_step_skipped` — runtime `/logs`; proves empty markdown skips are explicit and inspectable
- `DEV-0000050:T06:mcp_endpoints_normalized` — runtime `/logs`; proves classic/chat/agents/Playwright endpoint normalization
- `DEV-0000050:T07:checked_in_mcp_contract_loaded` — runtime `/logs`; proves the checked-in env contract loaded without legacy fallback
- `DEV-0000050:T08:shell_harness_ready` — shell-wrapper output; proves the checked-in shell harness contract exists
- `DEV-0000050:T09:compose_preflight_result` — compose wrapper output; proves host-network preflight pass/fail reporting
- `DEV-0000050:T10:image_runtime_assets_baked` — `logs/test-summaries/compose-build-latest.log`; proves image-baked runtime assets
- `DEV-0000050:T11:host_network_runtime_ready` — runtime startup logs and `/logs`; proves the active host-network port contract
- `DEV-0000050:T12:main_stack_probe_completed` — `logs/test-summaries/host-network-main-latest.log`; proves the four main MCP surfaces were reachable
- `DEV-0000050:T13:e2e_host_network_config_verified` — `logs/test-summaries/e2e-tests-latest.log`; proves e2e uses separate host-visible browser and MCP addresses
- `DEV-0000050:T14:story_validation_completed` — runtime `/logs`; proves final manual validation completed with `traceabilityPass`, `manualChecksPassed`, `screenshotCount`, and `proofWrapperPassed`

During the manual proof pass, use the running UI at `http://host.docker.internal:5001` plus the saved screenshots in `playwright-output-local/` to confirm that the expected Story 50 markers are visible for the exercised paths.

## Quick Commands

- Start stack: `npm run compose:local`
- Client dev server: `npm run dev --workspace client`
- Server dev server: `npm run dev --workspace server`
- Client tests: `npm run test --workspace client`
- Server tests: `npm run test --workspace server`
- E2E tests: `npm run e2e`

## Detailed Documentation

- Developer reference (APIs, MCP surfaces, runtime details): [docs/developer-reference.md](docs/developer-reference.md)
- Story 50 PR summary: [planning/0000050-pr-summary.md](planning/0000050-pr-summary.md)
- Repository map and file purpose reference: [projectStructure.md](projectStructure.md)

## Environment Policy

- Commit `.env` files with safe defaults.
- Keep secrets in `.env.local` (git-ignored) when needed.
