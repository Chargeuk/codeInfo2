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
2. Open the client app: `http://localhost:5001`.
3. Use **Chat** (`/chat`) for model conversations and repository tooling.
4. Use **Agents** (`/agents`) for specialized agent-driven work and command macros.
5. Use **Flows** (`/flows`) for repeatable multi-step automations.
6. Use **Ingest** (`/ingest`) before repository-aware answers if a repo is not indexed yet.

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
