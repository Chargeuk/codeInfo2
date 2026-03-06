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

### Corporate Registry and Certificate Overrides (Restricted Networks)

Use this section only when your network requires internal registries and/or corporate CA certificates. Standard users can leave all `CODEINFO_*` values unset.

Workflow env-file rules:

```text
compose/compose:local -> edit server/.env.local
e2e -> edit .env.e2e
```

For e2e specifically, `.env.e2e` is used for compose interpolation values. Container runtime defaults still come from `server/.env.e2e` and `client/.env.e2e`.

Corporate certificate directory requirements:

- Example host path: `/home/<user>/corp-certs`
- Put corporate CA files in that directory as `.crt` files.
- `CODEINFO_CORP_CERTS_DIR` points to this host directory and is mounted into `/usr/local/share/ca-certificates/codeinfo-corp`.

`CODEINFO_REFRESH_CA_CERTS_ON_START=false` is the default behavior. Only case-insensitive `true` enables refresh. If refresh is enabled and certs are missing/invalid, server startup fails fast with non-zero exit.

| Variable | Default when unset | Where used |
| --- | --- | --- |
| `CODEINFO_NPM_REGISTRY` | npm default registry behavior | Docker build-time npm install steps in server/client images, and host helper install in `start-gcf-server.sh` |
| `CODEINFO_PIP_INDEX_URL` | pip default index behavior | Server Docker build-time `pip install` |
| `CODEINFO_PIP_TRUSTED_HOST` | pip default trusted-host behavior | Server Docker build-time `pip install` |
| `CODEINFO_NODE_EXTRA_CA_CERTS` | `/etc/ssl/certs/ca-certificates.crt` | Server runtime export before Node starts |
| `CODEINFO_CORP_CERTS_DIR` | `./certs/empty-corp-ca` compose fallback source | Compose server cert mount source to `/usr/local/share/ca-certificates/codeinfo-corp:ro` |
| `CODEINFO_REFRESH_CA_CERTS_ON_START` | Disabled (`false` behavior unless value is `true`) | Server entrypoint CA refresh gate before `exec node dist/index.js` |

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
- Chat runtime config bootstrap (`./codex/chat/config.toml`) is deterministic and non-destructive:
  - if chat config exists: no overwrite (`existing_noop`).
  - if chat config is missing and base config exists: copy `./codex/config.toml` once (`copied`).
  - if both chat and base configs are missing: generate a standard chat template (`generated_template`).
  - IO/permission failures are surfaced with deterministic warnings and no silent fallback; failed copy/write paths clean up partial destination files.

## Codex (CLI)

- Install CLI (host): `npm install -g @openai/codex` and log in.
- Login (host only): run `CODEX_HOME=./codex codex login` (or keep your existing `~/.codex`); Docker Compose mounts `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` to `/host/codex` and copies `auth.json` into `/app/codex` on startup when missing, so a separate container login is not required.
  - Note: `CODEX_HOME` is frequently set by Codex/agent environments; use `CODEINFO_HOST_CODEX_HOME` (not `CODEX_HOME`) when you need Compose to mount a specific host Codex home.
- Codex home: `CODEINFO_CODEX_HOME=./codex` (mounted to `/app/codex` in Docker); seeded from `config.toml.example` on first start—edit `./codex/config.toml` after seeding to add MCP servers or overrides.
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
- `web_search` handling is canonical-first:
  - canonical `web_search` wins over alias keys;
  - alias bool values normalize to canonical modes (`true -> live`, `false -> disabled`).
- `/chat/models?provider=codex` and `/chat/providers` return resolver-backed `codexDefaults` and `codexWarnings`.
- `/chat` request validation applies the same resolver-backed defaults when Codex flags are omitted.

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
- Ingest workspace for embedding repositories, monitoring ingest progress, and managing re-embed/remove operations.
- Logs workspace for live server/client log inspection and filtering.

## Common Usage

1. Start the local stack: `npm run compose:local`.
2. Open the client app: `http://localhost:5501`.
3. Use **Chat** (`/chat`) for model conversations and repository tooling.
4. Use **Agents** (`/agents`) for specialized agent-driven work and command macros.
5. Use **Flows** (`/flows`) for repeatable multi-step automations.
6. Use **Ingest** (`/ingest`) before repository-aware answers if a repo is not indexed yet.

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

## Quick Commands

- Start stack: `npm run compose:local`
- Client dev server: `npm run dev --workspace client`
- Server dev server: `npm run dev --workspace server`
- Client tests: `npm run test --workspace client`
- Server tests: `npm run test --workspace server`
- E2E tests: `npm run e2e`

## Detailed Documentation

- Developer reference (APIs, MCP surfaces, runtime details): [docs/developer-reference.md](docs/developer-reference.md)
- Repository map and file purpose reference: [projectStructure.md](projectStructure.md)

## Environment Policy

- Commit `.env` files with safe defaults.
- Keep secrets in `.env.local` (git-ignored) when needed.
