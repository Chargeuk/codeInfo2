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
compose -> edit server/.env.local for host-only overrides; compose-owned container runtime overrides stay in docker-compose.yml
compose:local -> edit server/.env.local and client/.env.local
e2e -> edit .env.e2e
```

For e2e specifically, `.env.e2e` is used for compose interpolation values. Container runtime defaults still come from `server/.env.e2e` and `client/.env.e2e`.

Client env contract:

- `client/.env` / `client/.env.local` now use `VITE_CODEINFO_API_URL`, `VITE_CODEINFO_LMSTUDIO_URL`, `VITE_CODEINFO_LOG_FORWARD_ENABLED`, and `VITE_CODEINFO_LOG_MAX_BYTES`.
- `compose:local` passes `client/.env.local` into Docker Compose interpolation so client-only overrides can drive both the local client image build args and the runtime-injected `window.__CODEINFO_CONFIG__`.
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

- Conversation persistence depends on MongoDB. Compose-owned container runtime defaults come from `docker-compose.yml` and point the server container at `mongodb://host.docker.internal:27517/db?directConnection=true`; host-only non-compose overrides belong in `server/.env.local`.
- `docker-compose.yml` includes a Mongo 8 replica-set service bound to host port 27517 and passes the same URI into the server container; local dev can reuse the same URI when running the server without Compose.
- If Mongo is unreachable the server keeps running but reports `mongoConnected=false`; the client surfaces a banner and disables archive controls while allowing stateless chat.

## Codex config seed

- On server startup, if `${CODEINFO_CODEX_HOME:-./codex}/config.toml` is missing, the server writes one canonical in-code base template to that path (the `codex/` directory is git-ignored).
- `config.toml.example` may remain in the repo as a human-facing sample, but runtime bootstrap does not read, parse, or copy it.
- Customize `./codex/config.toml` after the first run; subsequent starts leave your edits intact.
- Fresh base bootstrap uses `model = "gpt-5.6-sol"` and seeds Context7 in the no-key local stdio form `args = ['-y', '@upstash/context7-mcp']`; it does not seed any checked-in or placeholder `--api-key` pair.
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
- Login (host only): run `CODEX_HOME=./codex codex login` (or keep your existing `~/.codex`); the checked-in main and e2e Compose stacks preserve the documented `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` host fallback contract, expose that host Codex home read-only at `/host/codex`, and seed or repair the writable `/app/codex` runtime home from it, so a separate container login is not required there.
  - Note: `CODEX_HOME` is frequently set by Codex/agent environments; use `CODEINFO_HOST_CODEX_HOME` (not `CODEX_HOME`) when you need Compose to mount a specific host Codex home.
  - Reauthentication rule: if Codex runs start failing with auth-refresh errors such as `refresh_token_reused` or `token_expired`, rerun `codex login` (or `codex login --device-auth`) against the Codex home backing the runtime you are using, then restart that stack.
- Codex home: `CODEINFO_CODEX_HOME=./codex`; the runtime seeds the canonical base template on first start. `docker-compose.local.yml` live-mounts repo `./codex` to `/app/codex` for local editing and also exposes `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` at `/host/codex` for best-effort auth seeding when the repo-local home has not been logged in yet. The checked-in main and e2e stacks keep that documented host fallback contract, keep a writable `/app/codex` runtime home, and expose the host Codex home at `/host/codex:ro` for startup seeding and repair rather than bind-mounting the host home directly at `/app/codex`.
- `CODEINFO_CODEX_WORKDIR` is no longer a checked-in developer-home path. The tracked `server/.env` keeps only a template placeholder, `docker-compose.yml` and `docker-compose.local.yml` now set the container runtime workdir explicitly to `/data`, and any host-only override belongs in `server/.env.local`.
- Copilot runtime home: `CODEINFO_COPILOT_HOME=../copilot` in checked-in server development defaults, with `/app/copilot` reserved as the container override path for compose-backed runtimes and e2e. The optional `CODEINFO_COPILOT_CLI_PATH` override can point the SDK at an explicit `copilot` binary when `PATH` discovery is not reliable; if it is unset, the runtime keeps the default `PATH` lookup.
- Docker Copilot persistence: the local compose stack bind-mounts the gitignored repo-root `./copilot` folder directly to `/app/copilot`, so local auth survives restarts in the same visible way as `./codex`. The wrapper now seeds repo-owned plaintext-token persistence in `copilot/settings.json` with `storeTokenPlaintext: true` only when that file is missing; it no longer writes this setting into Copilot-managed `config.json`. The main and e2e compose stacks keep the Docker-managed `copilot-data` named volume at `/app/copilot`, add a read-only `./copilot:/seed/copilot:ro` seed mount, and repair missing auth-bearing peers in the writable runtime home when `config.json`, `settings.json`, or session-state data is only partially present there. Once the full auth-bearing runtime set is already present, startup skips seeding instead of overwriting that complete runtime home. Operators should not need to delete the runtime volume for normal startup, though a one-off volume reset can still be useful during local diagnosis. Copilot-managed JSON artifacts may contain JSONC comments, and the device-auth bootstrap now tolerates that compatibility format instead of failing before login. Published application ports stay unchanged.
- Behaviour when missing: if the CLI, `auth.json`, or `config.toml` are absent, Codex stays disabled; startup logs explain which prerequisite is missing and the chat UI shows a disabled-state banner. Local compose may seed a missing repo-local `auth.json` from `/host/codex` when that host mount is available, but startup no longer treats split local and host homes as an error by itself.
- Shared auth contract: `POST /codex/device-auth` still requires `{}` and now returns provider-auth states instead of a raw-output-only success payload. The Codex path can return `verification_ready`, `completion_pending`, `completed`, `already_authenticated`, `failed`, or `unavailable_before_start`, with `verificationUrl`, `userCode`, and optional `displayOutput` included only when relevant.
- Copilot auth contract: `POST /copilot/device-auth` uses the same strict `{}` request and the same shared provider-auth states. It returns verification details early, reuses the same route as the refresh path after the browser step, short-circuits to `already_authenticated` when env-token or logged-in-user auth is already available, and keeps Copilot-home persistence under `CODEINFO_COPILOT_HOME`.
- Copilot credential precedence is runtime-owned, not committed-env-owned. Checked-in env files may set `CODEINFO_COPILOT_HOME` and the optional CLI-path override, but they do not replace or mask `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, stored Copilot login state, or `gh` fallback. `/health` also stays process-only; Copilot readiness continues to surface through `/chat/providers` and `/chat/models` instead of server health.
- Chat defaults: Codex runs with `workingDirectory=/data`, `skipGitRepoCheck:true`, and requires MCP tools declared under `[mcp_servers.codeinfo_host]` / `[mcp_servers.codeinfo_docker]` in `config.toml`.
- Server SDK pin and runtime guard are coupled:
  - `@openai/codex` and `@openai/codex-sdk` are pinned at `0.144.1` in `server/package.json`.
  - startup guard requires exact `0.144.1`; pre-release, lower, and higher versions are rejected.
  - if installed and required versions diverge, startup emits deterministic guard-rejection logs and the mismatch must be corrected before release.

## GitHub Copilot and provider-neutral runtime

- Story `0000051` added GitHub Copilot as a third chat provider alongside Codex and LM Studio. Story `0000057` extends the same provider-neutral runtime contract across chat, agents, commands, and flows.
- Provider ordering remains one shared contract everywhere runtime selection uses it: `codex`, then `copilot`, then `lmstudio`.
- Chat still uses the selected chat provider directly, while agents and flow-owned agent runs resolve their provider from the agent's `config.toml` and fall back through the configured provider order when needed.
- The runtime resolves `CODEINFO_COPILOT_HOME` in the same style as `CODEINFO_CODEX_HOME`:
  - checked-in development default: `server/.env` uses `../copilot`
  - local compose runtime override: `/app/copilot` backed by repo-root `./copilot`
  - main and e2e compose runtimes: `/app/copilot` backed by the named-volume contract `copilot-data`, with optional one-time auth seeding from `./copilot:/seed/copilot:ro`
- The optional `CODEINFO_COPILOT_CLI_PATH` override can point the SDK at an explicit `copilot` binary. If it is unset, the runtime keeps normal `PATH` discovery.
- Copilot readiness is surfaced through `/chat/providers` and `/chat/models`, not through `/health`. Missing CLI, missing auth, or missing model discovery keep Copilot visible with a stable disabled reason instead of failing server startup.
- Shared auth now uses the `Choose Authentication` dialog for both Codex and Copilot. `POST /copilot/device-auth` uses the same provider-auth state vocabulary as Codex and returns device-flow verification details early so the browser step can finish outside the container.
- Checked-in env files never hard-code Copilot credentials. Runtime auth precedence still honors `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, stored Copilot login state, and authenticated `gh` fallback before device auth is required.

## External OpenAI-compatible endpoints

- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` configures one or more OpenAI-compatible `/v1` endpoints for Codex and Copilot chat discovery. Each entry may use the labeled form `<Label>,<full /v1 URL>|<capability[,capability...]>`, for example `OpenRouter,https://openrouter.ai/api/v1|responses,completions`. Legacy unlabeled `<full /v1 URL>|<capability[,capability...]>` entries are still accepted for backward compatibility, but labeled entries are required when the endpoint must match a configured key.
- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS` optionally configures raw bearer keys for labeled endpoints using `<label>,<raw key>` entries separated by semicolons. Endpoint labels and key labels are both normalized with the same repository-owned rule before matching: trim, lowercase, and collapse internal whitespace to `-`.
- The exact label from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` is preserved for GUI display, while the normalized URL remains the real runtime and persistence `endpointId`. Labels must also stay unique after normalization: if two endpoint labels or two key labels collapse to the same normalized value, startup fails fast. If that happens, rename or remove the conflicting labels, or fall back to unlabeled legacy endpoint entries where that is still appropriate.
- Codex runs against `openrouter.ai` use a generated startup model catalog for the selected model because Codex expects richer `/models` metadata than OpenRouter returns directly.
- Codex discovery also filters OpenRouter models down to entries that advertise tool use in `supported_parameters`, because non-tool-capable models cannot execute the Codex harness.
- The external-endpoint list is chat-picker scope only. It populates `/chat/providers` and `/chat/models` for Codex and Copilot, but it does not replace LM Studio discovery or broaden Agents-page provider selection.
- `codeinfo_openai_endpoint` is supported in `codex/chat/config.toml`, `copilot/chat/config.toml`, and `codeinfo_agents/<agent>/config.toml` as a provider or agent pin to one external endpoint. The runtime keeps that pin separate from the raw model id by persisting `endpointId` in conversation and flow flags.
- A config-pinned endpoint can still participate in discovery even when it is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`, and the selected endpoint stays visible in the chat picker as `endpointId`-backed model identity. If that pinned endpoint needs bearer auth, the same normalized endpoint URL must also be declared in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` so the runtime can inherit its label/key mapping; `codeinfo_openai_endpoint` itself remains URL-only.
- Bearer keys are a server-runtime concern in this repository. Put endpoint labels and keys in `server/.env.local` for host-only overrides. The repo-root `.env.local` is not part of the supported server startup env contract.
- Endpoint-backed conversations and flow-owned runs keep their stored `provider`, `model`, and `endpointId` stable on resume or reuse. Auth, CLI presence, and provider readiness still gate availability independently of endpoint discovery, so a missing login or unavailable provider still disables the provider as before.

## Chat defaults and Agent Flags behavior

- `CODEINFO_CHAT_DEFAULT_PROVIDER` remains the single top-level chat default selector. The server resolves the default provider in shared order `codex`, then `copilot`, then `lmstudio`, and only falls automatically when the selected default provider is unavailable or misconfigured.
- `CODEINFO_CHAT_DEFAULT_MODEL` is no longer part of the normal operator contract. The default model now comes from the selected provider's repo-local `chat/config.toml` file:
  - `codex/chat/config.toml`
  - `copilot/chat/config.toml`
  - `lmstudio/chat/config.toml`
- Those provider-local files are product-owned chat-default contracts, not a claim that every provider natively reads the same file itself. The server reads one normalized TOML shape, translates it into provider runtime settings, and rereads the files on each relevant request instead of caching a startup snapshot.
- Startup bootstrap seeds the provider-local chat config folders automatically. The repo keeps those local provider folders out of git and out of Docker build context, including the LM Studio defaults folder.
- The provider-local config is now the source of truth for:
  - the default model for that provider
  - the provider's supported default Agent Flag values
  - fallback behavior when the default provider is unavailable
- Automatic fallback is provider-first and config-backed. When the default provider cannot supply a valid model, the server tries the next available provider and uses that fallback provider's own `chat/config.toml` model instead of reviving a hidden shared model env path.
- Explicit user choice stays trustworthy. If the user explicitly selects Codex, Copilot, or LM Studio and that provider's local config is broken, the request fails clearly instead of silently switching to another provider.
- `CODEINFO_LMSTUDIO_BASE_URL` is now treated as a runtime-local endpoint override, not a checked-in product default. Compose-owned server containers get an explicit `host.docker.internal` value from their compose `environment:` blocks, while host-only or workstation-specific LM Studio endpoints belong in `server/.env.local`.
- Discovery now exposes one combined provider-model-Agent-Flags contract. `/chat/providers` and `/chat/models` return provider availability, runtime model data, provider-neutral Agent Flag descriptors, and provider/model-specific capability narrowing in one server-fed shape.
- The browser chat page renders a provider-neutral `Agent Flags` panel from that descriptor contract. The page shows only the controls supported by the selected provider and model, seeds visible values from the resolved defaults in the provider-local config, and sends later edits back on normal chat requests as nested `agentFlags`.
- The normal chat request contract keeps the existing transport fields (`provider`, `model`, `message`, `conversationId`, optional `inflightId`, `threadId`, and `working_folder`) and now carries provider-specific runtime options under one provider-neutral `agentFlags` object.
- Provider-specific first-pass Agent Flags are intentionally different:
  - Codex: sandbox mode, approval policy, reasoning effort, reasoning summary, verbosity, network access, and `webSearchMode`
  - Copilot: reasoning effort plus a simple `toolAccess` `On`/`Off` control
  - LM Studio: provider-native generation/tool options such as temperature, max tokens, context overflow policy, and tool access
- MCP `codebase_question` now shares the same provider-selection and defaults contract as the normal chat path, including Copilot parity on provider selection and model/default resolution. `provider` and `model` remain optional explicit overrides rather than fields callers should populate routinely, and Agent Flags stay out of the MCP request shape itself.

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

## Agent folders (provider-neutral layout)

Agents are discovered from the directory set by `CODEINFO_AGENT_HOME`, with `CODEINFO_CODEX_AGENT_HOME` retained as a legacy fallback alias. The preferred repository folder is `codeinfo_agents`, while `codex_agents` remains supported for compatibility and loses precedence when both roots are present. Each direct subfolder is treated as an agent when it contains a `config.toml` file.

Example layout:

```text
codeinfo_agents/<agentName>/
  config.toml          # required
  description.md       # optional (Markdown shown in UI/MCP listings)
  system_prompt.txt    # optional (used only on first turn of a new agent conversation)
```

- Agent defaults: `codeinfo_agents/<agentName>/config.toml` is the source of truth for agent execution defaults (e.g. `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, and web-search/network feature toggles). The optional `codeinfo_provider` field selects the preferred execution provider for that agent, defaulting to `codex` when omitted. The UI does not provide direct model/provider overrides for agents.
- Server-owned defaults: the server still sets `workingDirectory=/data` (or `CODEX_WORKDIR`) and `skipGitRepoCheck:true` for agent runs.
- Auth seeding: on each agent discovery read, if an agent-specific `auth.json` is missing but the primary provider home already has the required auth state, the runtime can best-effort seed that provider-owned auth into the runtime agent home. It never overwrites existing agent auth, and auth artifacts must never be committed.
- Docker/Compose: local compose live-mounts `./codeinfo_agents` and the legacy `./codex_agents` into the container so agent configs can be edited while the stack is running. Main and e2e keep the same provider-neutral precedence while still honoring the legacy root when it is the only one present.
- Agents MCP (port 5012): JSON-RPC endpoint on `http://localhost:5012` (exposed by Compose).

## Features at a Glance

- Chat workspace with provider/model selection, streaming responses, conversation history, and tool/citation rendering.
- Shared chat provider ordering now uses one contract-first order across defaults and provider listing: `codex`, then `copilot`, then `lmstudio`. Copilot stays visible in provider lists even when unavailable, and the current server model route now returns Copilot model metadata only when readiness and verified model discovery succeed.
- Copilot chat now runs through the same `/chat` transport and stop flow as the existing providers. New Copilot conversations reuse `conversationId` as the session id, follow-up turns resume that same session, unavailable Copilot requests follow the shared provider fallback rules, and resume mismatches fail clearly instead of silently switching to a fresh hidden session.
- Agents workspace for running provider-neutral agent instructions and reusable command macros with history and stop/resume controls.
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

## Story 54 Ingest Tuning

- The existing `/ingest` UI and `/ingest/start` plus `/ingest/reembed/:root` routes remain the runtime path for large-text ingest. Story 54 adds no new ingest API and no new browser surface.
- Large `.md`, `.mdx`, and `.txt` files now switch to a prose-oriented chunking path once they reach `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES` in `server/.env`. The checked-in default is `65536`, and the runtime logs `DEV-0000054:large_text_path_selected` when that path is selected.
- Provider dispatch is now bounded per provider:
  - `CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE=20`
  - `CODEINFO_INGEST_OPENAI_MAX_INFLIGHT=10`
  - `CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE=1`
  - `CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT=4`
  - `CODEINFO_INGEST_MAX_QUEUE_SIZE=-1`
- OpenAI batching may mix chunks from different files, but ordering and persisted metadata stay deterministic. LM Studio still behaves as effective batch size `1` even if configured higher, and over-large configured values clamp to provider-supported limits instead of failing a run.
- Queue-cap behavior is explicit: `-1` means no extra absolute cap beyond the normal dispatcher bounds, `0` means no waiting queue, and any positive value caps waiting work at that many queued items.
- Cancellation is best-effort and bounded: once a run is cancelled, the dispatcher stops sending new work immediately, tries to abort in-flight provider requests where supported, and ignores late results that arrive after cancellation.
- Delta re-embed AST behavior stays conservative: if no AST-supported file was added, changed, or deleted, AST rebuild is skipped entirely; if any AST-supported add/change/delete or boundary-crossing move is present, the runtime reuses the existing full AST rebuild path. Story 54 does not add partial AST updates or rename detection.
- The checked-in Story 54 browser/runtime proof fixture is [`e2e/fixtures/repo/large-planning-doc.md`](./e2e/fixtures/repo/large-planning-doc.md), mounted at `/fixtures/repo/large-planning-doc.md` in the compose-backed runtime used by e2e and manual validation.

## Story 55 Durable Ingest Queue

- Queueable ingest and re-embed requests now use one durable Mongo-backed queue instead of failing immediately whenever another ingest run is active.
- Queue admission is canonical-target based. Start-ingest and re-embed requests that normalize to the same embed target reuse one durable queue record instead of creating duplicate waiting work.
- Queue responses split durable queue identity from runtime execution identity:
  - `requestId` is the durable queue record id.
  - `runId` appears only after execution starts.
  - waiting responses return `queued: true` plus waiting-only `queuePosition`.
- Queue state stays intentionally small: `waiting`, `running`, and `cleanup-blocked`.
- Queue order is FIFO by queue creation time. On startup, cleanup-blocked work is resolved before newer waiting work, and leftover `running` records are retried as abandoned previously-active work.
- Waiting duplicate submits keep the existing `requestId`, queue position, original `createdAt`, and original source-surface provenance while replacing the stored normalized request settings with the latest submit.
- Queue cleanup stays ordered: the runtime deletes a finished queue record before advancing newer waiting work, and a delete failure leaves the queue in `cleanup-blocked` until cleanup succeeds.
- Queue-backed outages are explicit. REST surfaces Mongo queue outages as `503` with `QUEUE_UNAVAILABLE`, and MCP, flow, and command paths preserve that same retryable error meaning instead of flattening it into a generic invalid request.
- Re-embed callers that already blocked until terminal completion still block after queueing. Queue wait time is part of the contract; Story 55 does not convert those callers into fire-and-forget behavior.
- Shared repository-list readers are the source of truth for queued visibility. The ingest UI, `/ingest/roots`, and classic `ListIngestedRepositories` all use the same queued row shape with `requestId`, nullable `runId`, waiting-only `queuePosition`, and `queueState`, including temporary rows for brand-new queued roots.
- The ingest UI keeps queueable submissions enabled while another run is active, but Story 55 still does not add user-facing removal or cancellation for queued-but-not-started work.

## Common Usage

1. Start the local stack: `npm run compose:local`.
2. Open the client app: `http://localhost:5501`.
3. Use **Chat** (`/chat`) for model conversations and repository tooling.
4. Use **Agents** (`/agents`) for specialized agent-driven work and command macros.
5. Use **Flows** (`/flows`) for repeatable multi-step automations.
6. Use **Ingest** (`/ingest`) before repository-aware answers if a repo is not indexed yet.

Generic concurrent child-flow waves and the multi-repository review-set contract are documented in [`docs/subflow-waves-and-review-sets.md`](./docs/subflow-waves-and-review-sets.md).

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
- host Codex auth must be available through `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` because the checked-in main and e2e stacks seed and repair their writable `/app/codex` runtime homes from the read-only `/host/codex` mount rather than asking operators to log in inside the container
- `docker-compose.local.yml` intentionally keeps a local-development overlay for `./codex`, `./codex_agents`, `./flows`, and `./flows-sandbox` so those runtime trees can be edited live while the host-networked local stack is running. The main and e2e stacks remain image-baked.

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
4. Perform the real-stack manual Playwright-MCP proof against `http://host.docker.internal:5001` for unavailable/auth-required state and the shared auth dialog.
5. Start the fake-scenario e2e stack with `npm run compose:e2e:up`, then perform the fake happy-path manual Chrome-DevTools-MCP proof against `http://host.docker.internal:6001`. The checked-in e2e env contract already selects the named fake Copilot scenario there, so this final browser step should consume that running stack instead of re-injecting browser-side mocks.
6. Stop the e2e stack with `npm run compose:e2e:down`, then stop the main stack with `npm run compose:down`.

Evidence locations:

- summary-wrapper logs: `logs/test-summaries/`
- client/server test logs: `test-results/`
- In the local harness workflow, `/tmp/playwright-output` inside the local Playwright MCP container is bind-mounted to the repo-root `playwright-output-local/` directory, so any Playwright MCP artifact written there becomes visible on the host under `playwright-output-local/`.
- Manual proof may capture temporary screenshots across multiple tasks, but durable story-proof closeout prefers the latest final-state screenshots, usually from the final story task, unless earlier screenshots remain uniquely necessary for a surface the final task did not honestly re-prove.
- manual Playwright screenshots: `playwright-output-local/0000050-14-chat-ready.png` and `playwright-output-local/0000050-14-logs-proof.png`
- final validation marker helper: `scripts/emit-task14-validation-marker.mjs`
- current canonical reviewer summaries: `codeInfoStatus/pr-summaries/<story-number>-pr-summary.md`
- migrated Story 50 reviewer-facing summary: `codeInfoStatus/pr-summaries/0000050-pr-summary.md`

Wrapper log review rule:

- if a summary wrapper reports clean success with `agent_action: skip_log`, do not open the saved log just to inspect it
- only open full logs when the wrapper reports failure, unexpected warnings, or ambiguous/unknown counts

Flow-stop cleanup troubleshooting:

- If `npm run test:summary:server:unit` appears to keep running after a flow-loop stop/cancel test should have finished, inspect the saved log for these server markers before changing code blindly:
  - `CANCEL_INFLIGHT_RECEIVED` with `inflightSnapshot`, `ownershipRunToken`, and `pendingCancelRunToken`
  - `flows stopped final emitted before cleanup`
  - `flows runtime cleanup starting`
  - `flows runtime cleanupInflight completed` or `flows runtime cleanupInflight skipped because active inflight did not match`
  - `flows runtime cleanup finished`
- These lines are emitted from the flow stop path and are intended to show whether the runtime still has inflight state, active ownership, or pending cancel state after a looped flow reports `stopped`.
- The most useful comparison is the before/after snapshot in `flows runtime cleanup starting` versus `flows runtime cleanup finished`; if `inflightId`, `ownershipRunToken`, or pending-cancel fields remain populated at the end, the issue is likely a real cleanup leak rather than a wrapper problem.

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
- Local compose live-mounts `codex/`, `codex_agents/`, `flows/`, and `flows-sandbox/` so edits to those trees are visible immediately in the running local server container.
- Client dev server: `npm run dev --workspace client`
- Server dev server: `npm run dev --workspace server`
- Client tests: `npm run test --workspace client`
- Server tests: `npm run test --workspace server`
- E2E tests: `npm run e2e`

## Detailed Documentation

- Developer reference (APIs, MCP surfaces, runtime details): [docs/developer-reference.md](docs/developer-reference.md)
- Current reviewer-summary artifact location: `codeInfoStatus/pr-summaries/<story-number>-pr-summary.md`
- Story 50 PR summary: [codeInfoStatus/pr-summaries/0000050-pr-summary.md](codeInfoStatus/pr-summaries/0000050-pr-summary.md)
- Repository map and file purpose reference: [projectStructure.md](projectStructure.md)

## Environment Policy

- Commit `.env` files with safe defaults.
- Keep secrets in `.env.local` (git-ignored) when needed.
