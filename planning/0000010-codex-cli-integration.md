# Story 0000010 – Codex CLI provider integration (draft)

## Description

Introduce Codex as an optional chat provider using the `@openai/codex-sdk`, which shells out to the locally installed Codex CLI with cached auth. The server should detect Codex availability, route chat requests through the SDK, and (when possible) expose our existing tools via an MCP server by steering Codex to a repo-local `CODEX_HOME`/`config.toml`. Client users can pick Codex alongside LM Studio; Codex stays hidden in environments without the CLI/auth. This draft captures intent and open questions before tasks and acceptance are finalized.

### Rough Plan
  - Codex home/config
      - Use a repo-local git-ignored `./codex/` as the Codex home directory, but do not set global CODEX_HOME; instead, expose `CODEINFO_CODEX_HOME` env and pass it as `CODEX_HOME` inside CodexOptions when instantiating the SDK. This avoids interfering with users’ personal Codex config.
      - Construct the Codex client with CodexOptions env: { CODEX_HOME: <abs path from CODEINFO_CODEX_HOME> } so the CLI bridge reads our config (including MCP servers) instead of ~/.codex.
      - Users must manually log in the Codex CLI against this repo-specific home; no auto-copy of ~/.codex/auth.json.
  - MCP wiring
      - Run a lightweight MCP server inside our Node process that exposes our existing tools (ListIngestedRepositories, VectorSearch). Bind it to 127.0.0.1:<port>.
      - In codex_home/config.toml, register that MCP server under [mcp] so Codex sees it without API keys.
      - On startup, generate/update codex_home/config.toml from a template with the chosen port and feature flags; keep it gitignored but document the template path.
  - Provider adapter
      - Add a “codex” provider in the server chat router that:
          - Checks which codex and ~/.codex/auth.json (or copied auth) on boot; only enables if present.
          - Creates a Codex client with CodexOptions { env: { CODEX_HOME }, model: selected Codex model, threadOptions as needed }.
          - Streams deltas → our SSE frames (token/final/complete/error) with provider: 'codex'.
          - If MCP startup or handshake fails, block Codex sends and surface an error popup; tools are required (no chat-only fallback). Mark toolsAvailable: false so the UI disables Codex.
          - Return and accept a Codex threadId so conversations can resume without replaying prior messages from the client; client must send threadId on subsequent Codex turns.
  - Client changes
      - /chat/models returns provider-grouped entries with a toolsAvailable flag; Codex entries disabled with guidance when CLI/auth/MCP is unavailable.
      - Add a Provider dropdown left of Model with options LMStudio and OpenAI Codex; models list filters per provider. Provider is locked for the current conversation; models can change. New conversation keeps the provider.
      - Move the message input to a multiline field beneath the Provider/Model row alongside Send; keep New conversation on the top row.
      - Hide citations/tool blocks when toolsAvailable is false; show inline guidance about Codex requiring local CLI login and MCP.
      - Codex model list is fixed to `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, and `gpt-5.1` when the provider is OpenAI Codex.
      - When provider is Codex, store the returned threadId in chat state (and persist per conversation) and include it on subsequent sends; do not rely on replaying the full message history for Codex.
  - Config/flags to bake in
      - Auto-detect Codex: if the CLI is not found or auth/config is missing, log a startup warning and expose Codex as disabled with guidance (no CODEX_ENABLED switch).
      - CODEINFO_CODEX_HOME (path, default ./codex), CODEX_TOOL_TIMEOUT_MS, CODEX_MCP_PORT. Tool availability is governed by config.toml; no separate toggle.
      - Docker enablement (opt-in): install the Codex CLI in images (`npm install -g @openai/codex`), mount CODEINFO_CODEX_HOME (e.g., ./codex:/app/codex), set CODEINFO_CODEX_HOME=/app/codex in the container env, and ensure users log in inside the container or provide a trusted auth.json in the mounted volume. Without these, Codex remains disabled with guidance in Docker/e2e.

## Acceptance Criteria (draft, now parameterised)

- Codex provider uses `gpt-5.1-codex-max` by default when available via the CLI/SDK bridge.
- MCP tool access is required; if MCP handshake fails, the client is blocked from sending to Codex and receives a clear error popup (no chat-only fallback).
- Auth expectation: user must manually log in the Codex CLI under the configured `CODEX_HOME`; README documents the login step and custom home path. No automatic copying of `~/.codex/auth.json`.
- Repository uses a git-ignored `codex/` directory as the default `CODEX_HOME`; all Codex config/auth files live there and stay out of version control.
- Provider selection UI: chat page adds a Provider dropdown (left of Model) with options `LMStudio` and `OpenAI Codex`; the Models dropdown filters to the chosen provider.
- Conversation constraints: provider cannot be switched mid-conversation; model can be switched. New conversation keeps the chosen provider.
- Input layout: message text input becomes multi-line, placed under the Provider/Model row alongside the Send button; New conversation stays on the top row. No front-end rate/timeout enforcement.

## Out Of Scope

- Permanent exposure of Codex in Docker/e2e environments (CLI/auth not available there).
- Billing/key management changes beyond using the existing Codex CLI login.

## Questions

Resolved:
- Default model: use `gpt-5.1-codex-max`.
- MCP failure: block Codex sends and show an error popup (no chat-only fallback).
- Auth: user must manually log in under the configured `CODEX_HOME`; document in README; no auto-copy of `~/.codex/auth.json`.
- UI: show both providers; models list depends on provider; provider locked per conversation; multi-line input under selectors; new conversation stays on top row.
- Front-end rate/timeouts: none enforced in UI.

Open items (to confirm before tasking):
- Exact wording/location of the Codex login instructions in README and any warning banner in the chat page.
- Whether to hide Codex entirely when CLI/auth is missing, or show disabled with guidance. **Decision:** show disabled with guidance.

# Implementation Plan

## Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks.
This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

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

# Tasks

### 1. Codex SDK + CLI bootstrap

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Add the Codex TypeScript SDK to the server, install the Codex CLI in local/Docker environments, wire `CODEINFO_CODEX_HOME`, and log provider detection at startup without enabling chat yet.

#### Documentation Locations

- Codex SDK README: https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- Codex options/env mapping: https://github.com/openai/codex/blob/main/sdk/typescript/src/codexOptions.ts
- Codex CLI install/login: https://github.com/openai/codex/blob/main/docs/getting_started.md
- Repo README + design.md for environment notes
- plan_format.md for process

#### Subtasks

1. [ ] Add `@openai/codex-sdk` dependency to `server/package.json`; run install.
2. [ ] Create `CODEINFO_CODEX_HOME` default (`./codex`) in server config/env handling; ensure it is passed as `CODEX_HOME` to the SDK options factory; do not set global `CODEX_HOME`.
3. [ ] Implement Codex availability check on server startup (detect `codex` binary, presence of auth/config under `CODEINFO_CODEX_HOME`); log success/warning accordingly; expose detection state in a provider registry (no endpoints yet).
4. [ ] Update server Dockerfile to install Codex CLI (`npm install -g @openai/codex`); mount `CODEINFO_CODEX_HOME` in compose/dev docs; set env `CODEINFO_CODEX_HOME=/app/codex` in Docker envs.
5. [ ] Add README section describing Codex CLI prerequisite, login under `CODEINFO_CODEX_HOME`, and Docker mounting steps; mention that without CLI/auth Codex is disabled with guidance.
6. [ ] Run lint/format for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] Clean Docker build of server image (CI-equivalent) to verify CLI install step
4. [ ] Start server locally and confirm startup logs show Codex detected/disabled messages (manual)

#### Implementation notes

- Record detection outcome and any CLI install nuances.
- Note any security considerations for mounting auth.json in Docker.

---

### 2. Provider/model surfacing & UI layout changes

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Expose provider-aware model listings and rearrange the chat UI: Provider dropdown (LMStudio / OpenAI Codex), provider-locked per conversation, fixed Codex model list, multiline input beneath selectors; disable chat input when Codex is selected (until Codex chat is implemented).

#### Documentation Locations

- Codex SDK model options: https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- UI/React refs: react.dev docs for controlled inputs
- MUI components: use MUI MCP docs (@mui/material@7.2.0)
- design.md / README chat sections

#### Subtasks

1. [ ] Add provider registry endpoint (e.g., `/chat/providers`) and extend `/chat/models` to accept `provider`, returning LM Studio models or fixed Codex list (`gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5.1`) plus `toolsAvailable/available` flags.
2. [ ] Update client state to store provider + model; lock provider for the current conversation; allow model changes; carry provider to model fetch and send payloads.
3. [ ] Rework chat UI layout: Provider dropdown left of Model; multiline message box under selectors with Send; keep New conversation button on the top row; disable input/Send when provider=Codex (temporary until Codex chat lands).
4. [ ] Show disabled-with-guidance UI when Codex unavailable or tools unavailable; hide citations/tool blocks when `toolsAvailable` is false.
5. [ ] Update tests (client) for provider/model selection, disabled Codex state, layout changes (data-testid/style assertions where applicable).
6. [ ] Update README/design.md to describe provider selection, fixed Codex model list, and disabled state when Codex not available.
7. [ ] Run lint/format for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace client`
4. [ ] Manual UI check: Provider dropdown, model filtering, disabled Codex state, layout positioning

#### Implementation notes

- Capture the provider-lock behavior and any UI/ARIA tweaks for multiline input.
- Note any temporary disabling flags that will be removed in Task 3.

---

### 3. Codex chat pathway (no MCP/tools yet)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Enable chatting with Codex via the SDK using the selected provider/model, streaming into existing SSE frames. No MCP/tool execution yet. Add threadId handling so Codex conversations resume without replaying client-side history.

#### Documentation Locations

- Codex SDK streaming/thread API: https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- SSE framing in server: server/src/chatStream.ts
- Client chat state/hooks docs in codebase (useChatStream, etc.)

#### Subtasks

1. [ ] Implement Codex chat provider in the server router: accept provider/model/threadId; start or resume Codex thread; stream deltas as our SSE frames (token/final/complete/error); gate send if Codex detection failed.
2. [ ] Update client chat hook/page to send provider/model/threadId; store Codex threadId in conversation state; prohibit provider change mid-conversation; allow model change.
3. [ ] Ensure Codex path is tool-free for now: block/ignore tool requests; keep citations hidden for Codex responses.
4. [ ] Update logging to include provider and threadId context; ensure disabled state errors surface cleanly to the UI.
5. [ ] Add server and client tests: server unit/integration for Codex provider stub (mock SDK); client RTL for sending with provider=Codex, threadId persistence, and disabled state when detection fails.
6. [ ] Update README/design.md to note Codex chat availability (tooling pending) and threadId persistence requirement.
7. [ ] Run lint/format for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] Manual Codex chat smoke: start a new Codex conversation, confirm threadId reuse on a second turn, verify SSE rendering without tools/citations

#### Implementation notes

- Record any SDK mocking approach and SSE mapping decisions.
- Note future hook points where MCP/tool execution will be added in a later task.

---

### 4. Codex config template and bootstrap copy

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Provide a checked-in `config.toml.example` for Codex with our defaults, and seed `./codex/config.toml` (CODEINFO_CODEX_HOME) from it when missing, without overwriting user changes.

#### Documentation Locations

- Codex config reference: https://github.com/openai/codex/blob/main/docs/agents_md.md
- CODEX_HOME env mapping in SDK: https://github.com/openai/codex/blob/main/sdk/typescript/src/codexOptions.ts
- Repository README/design for Codex home expectations

#### Subtasks

1. [ ] Add `config.toml.example` (tracked) containing:
   - `model = "gpt-5.1-codex-max"`
   - `model_reasoning_effort = "high"`
   - `[features]` with `web_search_request = true` and `view_image_tool = true`
   - `[mcp_servers]` entry for our MCP server (document host vs Docker URL)
2. [ ] Implement bootstrap logic (startup hook or small script) to copy the example to `${CODEINFO_CODEX_HOME}/config.toml` if it does not exist; never overwrite an existing file.
3. [ ] Document in README how to customize `./codex/config.toml`, how seeding works, and that `codex/` remains git-ignored while the example stays tracked.
4. [ ] Run lint/format for touched workspaces (and shellcheck if a shell script is added).

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] Manual: remove/rename `./codex/config.toml`, start the server, verify the file is seeded from the example; restart to confirm idempotency (no overwrite).
3. [ ] If a standalone script is provided, run it directly to confirm copy behavior.

#### Implementation notes

- Capture the MCP server URL(s) used in the example and any template substitutions.
- Note any platform/path considerations for CODEINFO_CODEX_HOME.

---

### 5. Expose existing tools via MCP server

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Expose our existing tooling (ListIngestedRepositories, VectorSearch) as an MCP server endpoint that Codex can call. Provide a stable HTTP/SSE MCP surface (e.g., `/mcp`) and document the config.toml parameters users need to point Codex at it (localhost and Docker variants).

#### Documentation Locations

- MCP protocol reference: https://openai.github.io/openai-agents-python/mcp/
- Current tool schemas in server routes (`toolsIngestedRepos`, `toolsVectorSearch`) and LM Studio tool wiring
- Codex config guide: https://github.com/openai/codex/blob/main/docs/agents_md.md

#### Subtasks

1. [ ] Add MCP server module/route (HTTP + SSE) on the Express app (e.g., `/mcp`): implement `list_tools` returning both tools’ schemas and `call_tool` dispatching to existing service logic. Bind to 127.0.0.1 by default.
2. [ ] Map request/response to JSON-RPC 2.0; support SSE/streamable HTTP where appropriate; include error envelopes on failures.
3. [ ] Reuse current validation/schemas for both tools; ensure outputs match existing HTTP responses (including hostPath metadata).
4. [ ] Surface detection/logs on startup that MCP is enabled and the URL to configure (host + docker forms).
5. [ ] Update `config.toml.example` `[mcp_servers]` entry with the MCP URL (`http://localhost:5010/mcp` for host; `http://server:5010/mcp` for docker) and note in README how to set it.
6. [ ] Add README/design notes for MCP usage, including manual verification steps and security scope (local only by default).
7. [ ] Run lint/format for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server` (add unit/integration for `/mcp` list_tools and call_tool happy/err paths)
3. [ ] Manual: with Codex CLI logged in, point `config.toml` `[mcp_servers]` at `http://localhost:5010/mcp`, run `codex` chat, and verify the tools are listed and callable.

#### Implementation notes

- Capture final MCP URL(s) and any CORS/host binding choices.
- Note any streaming behaviors or limitations for large payloads.

---

### 6. Codex + MCP tool usage in chat (SYSTEM_CONTEXT injection)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Enable Codex chats to use our MCP tools to answer repository questions. Inject the shared SYSTEM_CONTEXT at the start of Codex conversations, instructing the model to call MCP tools to gather answers. Ensure Codex requests route through the MCP server and that tool results flow back to the client (citations/tool blocks) when available.

#### Documentation Locations

- SYSTEM_CONTEXT location: client/src/constants/systemContext.ts
- MCP usage in Codex: Codex docs (agents_md) + SDK thread options
- Existing tool rendering on client (chat tool blocks/citations)

#### Subtasks

1. [ ] Server: when provider=Codex, prepend SYSTEM_CONTEXT to the first Codex turn; ensure thread creation includes this context.
2. [ ] Server: wire Codex thread options to point at our MCP server; require tool use where appropriate (or strongly bias via instructions) so Codex calls ListIngestedRepositories/VectorSearch.
3. [ ] Server: map Codex MCP tool calls/results into our existing SSE tool-request/result frames so the client can render tool blocks/citations; include provider tags.
4. [ ] Client: re-enable chat input for Codex, allowing tool blocks/citations to render when provider=Codex and toolsAvailable=true; still hide when unavailable.
5. [ ] Ensure threadId handling remains intact with MCP calls and that subsequent turns reuse the same thread with context and tool availability.
6. [ ] Tests: server integration test with mocked Codex MCP calls; client RTL verifying Codex provider now streams tool blocks/citations; update existing tests that assumed Codex disabled.
7. [ ] Update README/design to note SYSTEM_CONTEXT injection for Codex and tool-required behaviour; document any prompts/instructions used.
8. [ ] Run lint/format for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] Manual: Codex chat with provider=Codex, verify tool calls occur (List repos, Vector search), tool blocks/citations render, and SYSTEM_CONTEXT is honored.

#### Implementation notes

- Capture how SYSTEM_CONTEXT is injected (server-side to avoid client replay) and any prompt wording.
- Note any Codex-specific quirks in MCP call shapes vs our SSE expectations.
