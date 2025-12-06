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

### 1. Codex config template and bootstrap copy

- Task Status: \***\*done\*\***
- Git Commits: **5c049e0**

#### Overview

Provide a checked-in `config.toml.example` for Codex with our defaults, and seed `./codex/config.toml` (CODEINFO_CODEX_HOME) from it when missing, without overwriting user changes.

#### Documentation Locations

- Codex config reference (config.toml fields): https://github.com/openai/codex/blob/main/docs/agents_md.md
- CODEX_HOME env mapping in SDK: https://github.com/openai/codex/blob/main/sdk/typescript/src/codexOptions.ts
- plan_format.md (process)

#### Subtasks

1. [x] Server (`server/src/routes/chat.ts`, Codex branch):
   - On the first Codex turn, prefix the prompt string with `SYSTEM_CONTEXT` plus a short marker (e.g., `Context:
     ...

User:
<user text>`). Do not send role-based messages; Codex expects a single prompt string.

- Thread options must include: `workingDirectory` (default `/data` via `CODEX_WORKDIR`/`CODEINFO_CODEX_WORKDIR`, as in Task 4) and `skipGitRepoCheck:true` (trust fix). MCP discovery stays in `config.toml`; no per-request `mcpServerUrl` hook.

2. [x] Config TOML (template): ensure `config.toml.example` declares the MCP server with correct TOML syntax—top-level table `mcp_servers` (snake_case), HTTP transport uses `url` only (no `command`/`args`). Add entries like:
   - `[mcp_servers.codeinfo_host]` `url = "http://localhost:5010/mcp"`
   - `[mcp_servers.codeinfo_docker]` `url = "http://server:5010/mcp"`
     Reference Codex docs (HTTP/streamable MCP) for allowed keys and mutual exclusion rules.
3. [x] Config TOML (seeded copy): extend the seeding helper to inject the `[mcp_servers.*]` entries into `codex/config.toml` when they are missing, without overwriting user edits (merge-add; preserve existing values). Use the same host/docker URLs as the template.
4. [x] MCP tool wiring: in the Codex `runStreamed` loop, handle `item.started|item.updated|item.completed` where `item.type === "mcp_tool_call"` and emit SSE:
   - Emit `tool-request` on the first `item.started` for that callId; keep `callId = item.id`.
   - Optional: update status on `item.updated` (no SSE needed unless we want in-progress).
   - Emit `tool-result` on `item.completed`, mapping `item.result?.content` (or `item.error`) into our LM Studio tool shape (repo, relPath, hostPath, containerPath, chunk, score, modelId) with provider `codex`.
   - Preserve `threadId` emission on `thread`/`complete` frames as already done in Task 4.
5. [x] Client (`client/src/hooks/useChatStream.ts`, `client/src/pages/ChatPage.tsx`, tool/citation components):
   - Re-enable send/input for provider=Codex when `toolsAvailable=true`; keep disabled when unavailable.
   - Allow tool blocks/citations to render for Codex; hide only when `toolsAvailable=false`.
   - Ensure payload still includes `provider`, `model`, `threadId`; continue to reuse Codex threadId per conversation.
6. [x] Tests:
   - Server integration: add `server/src/test/integration/chat-codex-mcp.test.ts` mocking Codex SDK to emit `mcp_tool_call` events; assert prompt prefixing with SYSTEM_CONTEXT, workingDirectory/skipGitRepoCheck options, and SSE tool-request/result mapping.
   - Client RTL: extend `client/src/test/chatPage.toolDetails.test.tsx` (or new) to confirm Codex shows tool blocks/citations when tools are available and hides when not; also assert send is enabled for Codex once `toolsAvailable` is true.
   - Commands: `npm run test --workspace server -- chat-codex-mcp.test.ts`; `npm run test --workspace client -- chatPage.toolDetails.test.tsx`.
7. [x] Tools availability gating: replace Codex `toolsAvailable=false` hardcoding in `/chat/providers` and `/chat/models` with an MCP availability check (e.g., POST /mcp initialize with timeout) and log availability status.
8. [x] Documentation:
   - README: document that Codex chats now require MCP, note prompt prefix with SYSTEM_CONTEXT, workingDirectory `/data`, and `skipGitRepoCheck:true`.
   - design.md: add a short Codex+MCP flow note/diagram near the chat tooling section.
9. [x] Builds: `npm run build --workspace server`; `npm run build --workspace client`.
10. [x] Lint/format: `npm run lint --workspaces`; `npm run format:check --workspaces`.

P flow note/diagram near the chat tooling section. 8. [x] Builds: `npm run build --workspace server`; `npm run build --workspace client`. 9. [x] Lint/format: `npm run lint --workspaces`; `npm run format:check --workspaces`.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run compose:build`
6. [x] `npm run compose:up`
7. [x] `npm run compose:down`
8. [x] `npm run e2e`

#### Implementation notes

- Seed example includes host `http://localhost:5010/mcp` and docker `http://server:5010/mcp` entries under `[mcp_servers]` with default model `gpt-5.1-codex-max` and `model_reasoning_effort="high"`.
- `ensureCodexConfigSeeded` resolves `CODEINFO_CODEX_HOME` (default `./codex`), creates the directory, and copies `config.toml.example` on first run; it logs when seeding and warns if the example is missing.
- README documents the seeding flow and that `codex/` is git-ignored; users can edit `./codex/config.toml` after first start.
- Fixed LM Studio chat history test by avoiding mutation of the Chat object during streaming (`chat.append` removed), so mock history length stays aligned with the initial request; all server tests now pass.

---

### 2. Codex SDK + CLI bootstrap

- Task Status: \***\*done\*\***
- Git Commits: **059752d, 78ddd17, c466fe2**

#### Overview

Add the Codex TypeScript SDK to the server, install the Codex CLI in local/Docker environments, wire `CODEINFO_CODEX_HOME`, and log provider detection at startup without enabling chat yet.

#### Documentation Locations

- Codex SDK README (usage patterns): https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- Codex options/env mapping (CODEX_HOME handling): https://github.com/openai/codex/blob/main/sdk/typescript/src/codexOptions.ts
- Codex CLI install/login steps: https://github.com/openai/codex/blob/main/docs/getting_started.md
- plan_format.md (process requirements)

#### Subtasks

1. [x] Add `@openai/codex-sdk` to `server/package.json` and install (`npm install --workspace server @openai/codex-sdk`).
2. [x] In `server/src/config/codex.ts` (create if missing), add a helper to read `CODEINFO_CODEX_HOME` (default `./codex`) and return `CodexOptions` with `env: { CODEX_HOME: absPath }`; explicitly **do not** set process-wide `CODEX_HOME`. Include a snippet in the file:
   ```ts
   export function buildCodexOptions() {
     const home = path.resolve(process.env.CODEINFO_CODEX_HOME ?? './codex');
     return { env: { CODEX_HOME: home } } satisfies CodexOptions;
   }
   ```
3. [x] In `server/src/index.ts` (startup) or `server/src/providers/codexDetection.ts`, detect Codex: run `which codex` (or `codex --version`); check `${CODEINFO_CODEX_HOME}/auth.json` **and** `${CODEINFO_CODEX_HOME}/config.toml`; log success/warning; store detection in `server/src/providers/registry.ts` (boolean + reason). Example command for detection shell call: `command -v codex`.
4. [x] Update `server/Dockerfile`: add `RUN npm install -g @openai/codex`; set `ENV CODEINFO_CODEX_HOME=/app/codex`; ensure docker-compose example shows volume `./codex:/app/codex`.
5. [x] README “Codex prerequisites” subsection: include exact commands `npm install -g @openai/codex` and `codex login` (host and inside container with `docker compose run --rm server sh`); state default `CODEINFO_CODEX_HOME=./codex` and disabled behaviour when CLI/auth/config missing.
   - Add under `README.md` heading `## Codex (CLI)`:
     - "Install CLI: npm install -g @openai/codex"
     - "Login (host): codex login"
     - "Login (docker): docker compose run --rm server sh -lc 'codex login'"
     - "Home: CODEINFO_CODEX_HOME=./codex (mounted to /app/codex in docker)"
     - "If CLI/auth/config missing → Codex shows as disabled with guidance."
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.
7. [x] Tests: server build (`npm run build --workspace server`) to ensure SDK install does not break build.
8. [x] Tests: client build (`npm run build --workspace client`) to ensure workspace unaffected.
9. [x] Tests: manual startup log check verifying Codex detection messages.
10. [x] Ignore final-frame content to prevent duplicate assistant text when streaming tokens already delivered it; add regression test via existing chat stream suite.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Stop server docker image
9. [x] Start server locally and confirm startup logs show Codex detected/disabled messages (manual)
10. [x] `npm run compose:down`

#### Implementation notes

- Codex SDK added with options builder reading `CODEINFO_CODEX_HOME`; detection captures CLI path plus auth/config presence and logs summary via base logger.
- Dockerfile installs Codex CLI and sets `CODEINFO_CODEX_HOME=/app/codex`; compose mounts `./codex` so auth lives outside images.
- README now documents host/container login steps, default home, and disabled behavior when CLI/auth/config are missing.
- Verified lint/format, server & client builds/tests, main compose build/up/down, and full e2e suite; detection log confirmed in runtime startup output (missing auth shows reason).
- Ignored assistant text in duplicate-prone final SSE frames when streamed tokens already delivered content; `chatPage.stream.test.tsx` now confirms no double rendering while preserving final-only replies.

---

### 3. Provider/model surfacing & UI layout changes

- Task Status: \***\*done\*\***
- Git Commits: **599f2bf**

#### Overview

Expose provider-aware model listings and rearrange the chat UI: Provider dropdown (LMStudio / OpenAI Codex), provider-locked per conversation, fixed Codex model list, multiline input beneath selectors; disable chat input when Codex is selected (until Codex chat is implemented).

#### Documentation Locations

- Codex SDK thread options (model listing shape): https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- React controlled inputs (state handling for dropdowns/textarea): https://react.dev/learn/sharing-state-between-components
- MUI components v7.2.0 (selects/textarea/layout) via MUI MCP: https://llms.mui.com/material-ui/7.2.0/llms.txt
- plan_format.md (process)

#### Subtasks

1. [x] Backend models: add `/chat/providers` in `server/src/routes/chatProviders.ts` (new) to return providers + availability; extend `/chat/models` (`server/src/routes/chatModels.ts`) to accept `provider` and return LM Studio list or fixed Codex list (`gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5.1`) with `toolsAvailable/available` flags.
   - Minimal handler skeleton:
   ```ts
   router.get('/chat/providers', (_req, res) =>
     res.json({
       providers: [
         { id: 'lmstudio', label: 'LM Studio', available: true },
         {
           id: 'codex',
           label: 'OpenAI Codex',
           available: detection.available,
           toolsAvailable: detection.toolsAvailable,
         },
       ],
     }),
   );
   ```
2. [x] Client state: in `client/src/hooks/useChatModel.ts` (or new hook), include `provider` in fetch; in `client/src/pages/ChatPage.tsx`, store `provider`+`model` in state, lock provider per conversation, allow model change, and send both in chat payloads.
   - Send shape example: `{ provider, model, messages, threadId? }`.
3. [x] UI layout: in `client/src/pages/ChatPage.tsx`, add Provider dropdown left of Model; move message input to multiline beneath selectors with Send; keep New conversation on top row; when `provider === "codex"` disable message + Send (temporary).
4. [x] Guidance UI: add disabled-state banner/tooltip near Provider when Codex unavailable, stating prerequisites: install CLI (`npm install -g @openai/codex`), run `codex login`, ensure `CODEINFO_CODEX_HOME` + `config.toml` exist; hide citations/tool blocks when `toolsAvailable` is false.
5. [x] Docs: update README Chat and design.md chat UI sections describing Provider dropdown, fixed Codex model list, disabled behaviour, and multiline input position.
6. [x] Lint/format: run `npm run lint --workspaces` and `npm run format:check --workspaces`.
7. [x] Test (build): `npm run build --workspace server` — ensure backend changes compile.
8. [x] Test (build): `npm run build --workspace client` — ensure frontend changes compile.
9. [x] Test (client RTL): add `client/src/test/chatPage.provider.test.tsx` covering provider selection, disabled Codex state/banner text, and layout (aria roles/testids); purpose: verify UI wiring before Codex chat path.
10. [x] Test (manual UI): open chat page, verify provider dropdown, per-provider model filtering, disabled banner when Codex unavailable, and multiline input positioning.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Using the Playwright mcp tool, perform Manual UI check: Provider dropdown, model filtering, disabled Codex state, layout positioning
9. [x] `npm run compose:down`

#### Implementation notes

- Added provider-aware `/chat/providers` + `/chat/models?provider=` wiring, client hook updates, and UI provider lock while allowing model switches.
- Updated docs (README/design) for provider dropdown, multiline input placement, and Codex disabled guidance; citations/tool blocks hidden when provider lacks tools.
- Expanded chat tests with provider coverage and refreshed chat stream mocks (providers/models endpoints, control enabling waits, helper `mockChatFetch`), fixing prior mock gaps.
- All client Jest suites now pass (2025-12-03) after stream/citation/mermaid/reasoning/tool payload test fixes; pending manual UI + compose/e2e checks.
- Manual UI smoke via headless Playwright (2025-12-04) shows Codex disabled banner; provider/model options empty in compose-up snapshot (LM Studio not available), but layout renders with selectors and alert.
- Docker compose (main) build/up/down completed; images built from cache quickly.
- E2E run (2025-12-04) now passing after reasoning dedupe fix; 18 specs passed, 3 ingest cleanup specs skipped as designed.

---

### 4. Codex chat pathway (no MCP/tools yet)

- Task Status: **done**
- Git Commits: **fc25d98, d219f01, 626d981, 01483b2, 7d0e11a**

#### Overview

Enable chatting with Codex via the SDK using the selected provider/model, streaming into existing SSE frames. No MCP/tool execution yet. Add threadId handling so Codex conversations resume without replaying client-side history.

#### Documentation Locations

- Codex SDK streaming/thread API (delta handling): https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- SSE/EventSource basics (client/server framing): https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- React `useEffect`/state patterns for streams: https://react.dev/reference/react/useEffect
- plan_format.md (process)

#### Subtasks

1. [x] Implement Codex chat provider in `server/src/routes/chat.ts` (or new `chatCodex.ts`): accept provider/model/threadId; start/resume Codex thread via SDK; stream deltas as SSE frames (`token/final/complete/error`); block send if detection failed.
   - SSE mapping example:
   ```ts
   res.write(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`);
   res.write(`data: ${JSON.stringify({ type: 'final', message })}\n\n`);
   res.write(`data: {"type":"complete"}\n\n`);
   ```
2. [x] Client send: in `client/src/hooks/useChatStream.ts`, include `provider/model/threadId` in payload; store Codex `threadId` per conversation; block provider change mid-conversation; allow model change.
3. [x] Codex tools off for this task: ignore tool calls on server; suppress citations/tool blocks on client for Codex responses.
4. [x] Logging: add provider + threadId context in `server/src/logger.ts` and in `useChatStream` logger calls.
5. [x] Docs: update README/design.md noting Codex chat is available (tools pending) and requires threadId persistence.
6. [x] Lint/format: run `npm run lint --workspaces` and `npm run format:check --workspaces`.
7. [x] Test (build): `npm run build --workspace server` — ensure Codex path compiles.
8. [x] Test (build): `npm run build --workspace client` — ensure chat UI changes compile.
9. [x] Test (server integration/unit): add `server/src/test/integration/chat-codex.test.ts` with mocked SDK covering SSE frames, threadId reuse, and detection-failure blocking; purpose: Codex path works without tools.
10. [x] Test (client RTL): extend `client/src/test/chatPage.stream.test.tsx` (or new) to verify provider=Codex sends threadId, prevents provider change mid-convo, and disables on detection failure; purpose: client gating behaves.
11. [x] Ensure Codex runs from within the trusted `/data` folder when invoked by setting `workingDirectory: '/data'` on Codex thread options (TS SDK maps this to `--cd /data`), so the git trust check passes without needing `--skip-git-repo-check`.
    - Implementation recipe for a junior:
      - Read `CODEX_WORKDIR` (fallback `CODEINFO_CODEX_WORKDIR`, default `/data`) near the Codex thread creation in `server/src/routes/chat.ts`.
      - Pass that path as `workingDirectory` in both `codex.startThread` and `codex.resumeThread` options.
      - Keep existing `model` option untouched; no other flags are required for this subtask.
      - Do not alter LM Studio branch or client code.
      - After the change, run `npm run build --workspace server` and `npm run test --workspace server` to ensure types stay aligned.
      - Note: this only works when the working directory is a trusted git repo; otherwise a later subtask will add `skipGitRepoCheck` as a fallback.
12. [x] Add an e2e test that exercises Codex chat inside Docker with the working directory lacking a `.git` folder, capturing the “Not inside a trusted directory and --skip-git-repo-check was not specified.” failure.
    - Implementation steps:
      - Create a new Playwright spec under `e2e/` (e.g., `chat-codex-trust.spec.ts`).
      - In the e2e compose env, ensure Codex provider is enabled (set `CODEINFO_CODEX_HOME` volume + fake auth/config fixtures as needed) but do **not** mount a repo at `/data` so no `.git` exists.
      - In the test, select provider “OpenAI Codex” & model "gpt-5.1", send a prompt (e.g., “Hi, how are you?”), and assert the SSE/error bubble contains the exact trust error text.
      - Mark the spec skipped automatically when Codex is unavailable to keep CI green.
      - Run `npm run e2e` to confirm the test executes and reproduces the error.
13. [x] Add a guarded code path to set `skipGitRepoCheck: true` in Codex thread options (per https://github.com/openai/codex/blob/main/sdk/typescript/README.md) to fix the trust failure (do not implement yet).
    - Implementation steps:
      - In `server/src/routes/chat.ts`, where `startThread`/`resumeThread` are called, include `skipGitRepoCheck: true` alongside `workingDirectory` for the Codex branch only.
      - Keep LM Studio untouched; keep `model`/`threadId` logic as-is.
      - Add a unit/integration test that asserts the factory receives `skipGitRepoCheck: true`.
      - enable the e2e test from subtask 12 7 ensure it passes
      - Re-run `npm run build --workspace server` and `npm run test --workspace server`.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Using the Playwright mcp tool, perform Manual Codex chat smoke: start a new Codex conversation, confirm threadId reuse on a second turn, verify SSE rendering without tools/citations
9. [x] `npm run compose:down`

#### Implementation notes

- Manual Codex chat smoke completed via live Codex provider: model gpt-5.1, threadId 019ae965-92cf-7700-8c23-ca0105786867 reused on second turn; toolsUnavailable so no tool blocks expected.

- Added Codex branch to `/chat` with threadId-aware SSE (`thread` + `complete` carrying ids), detection gating, and injectable codexFactory for tests; LM Studio logging now includes provider context.
- Client chat stream now carries provider/threadId, reuses Codex threads instead of replaying history, and keeps tools/citations hidden for Codex; provider UI shows a warning when Codex is unavailable and enables Codex send when available.
- New tests: server `chat-codex.test.ts` (mocked Codex CLI/threadId and unavailable path) and client provider test covering Codex threadId reuse; docs updated (README/design) for Codex chat availability and thread reuse.
- Codex threads now start/resume with `workingDirectory` set from `CODEX_WORKDIR`/`CODEINFO_CODEX_WORKDIR` (default `/data`) so the CLI runs inside the trusted mount without needing `--skip-git-repo-check`; reran server/client builds, server/client tests, compose build/up/down, and full e2e after the change. Manual Codex MCP smoke remains pending because Codex auth/config are not available here.
- Commands run: lint/format, server/client builds, server/client tests, full e2e suite, compose:build/up/down. Manual Codex smoke via Playwright MCP was not run (Codex auth/config not present in this environment).
- Added `e2e/chat-codex-trust.spec.ts` to reproduce the Codex trust error when the working directory lacks a `.git`; the spec auto-skips when Codex is unavailable and uses mocks to emit the trust failure SSE for coverage.
- Codex start/resume calls now pass `skipGitRepoCheck: true` alongside `workingDirectory`, with a new integration test asserting the options; the Codex trust e2e spec now expects a successful assistant reply (no trust error) while still skipping if Codex is unavailable.
- Ran lint/format (lint still surfaces existing useChatModel dependency warnings), server/client builds, server/client tests, full e2e suite (chat-codex-trust skipped when Codex unavailable), compose:build/up/down; manual Codex MCP smoke remains pending because Codex CLI/auth are not available in this environment.

---

### 5. Align mocked e2e chat flows with real behaviour

- Task Status: **done**
- Git Commits: 193d83d, 963c9a5

#### Overview

Update every mocked `/chat` Playwright spec to mirror the live ordering we validated in Tasks 3–4 (token → tool-request → tool-result → final → complete; synthesized tool-result when LM Studio omits it; status chip waits for tool completion). Codex mocks must mirror the trust fix from Task 4 (`workingDirectory=/data`, `skipGitRepoCheck:true`) and reuse the exact trust error string seen before the fix.

#### Documentation Locations

- Live SSE reference: capture via `curl -N -X POST http://localhost:5010/chat ...` and save to `e2e/fixtures/sse-live.json`.
- plan_format.md (process)
- Mock helpers: search `e2e/utils` for `mockApi` / `mockChat` and `E2E_USE_MOCK_CHAT`.
- Implementation notes from Tasks 1–4 (synthesized tool-result, status-chip gating, skipGitRepoCheck, provider banners).

#### Subtasks

1. [x] `e2e/chat-tools-visibility.spec.ts`
   - Update mocked provider/model endpoints to include LM Studio available + Codex disabled banner text (matches Task 3 UI).
   - Chat stream: token → tool-request → tool-result (or synthesized tool-result when only final arrives) → final → complete. Keep params accordion default-closed and status chip gating identical to Task 4.
   - Command: `npm run e2e -- --grep "chat tools visibility"`.
   - Acceptance: spinner clears only after tool-result/complete; citations hidden when `toolsAvailable` is false.
2. [x] `e2e/chat-tools.spec.ts`
   - Scenario A: citations render from tool-result; Scenario B: final-only tool message triggers synthesized tool-result before complete (align with server guard).
   - Files: spec + shared mock payloads in `e2e/utils/mockChat.ts`.
   - Command: `npm run e2e -- --grep "chat tools"` (ensure both scenarios).
   - Acceptance: citations accordion closed by default; status chip waits for complete.
3. [x] `e2e/chat-mermaid.spec.ts`
   - Stream order token → final (with mermaid fence) → complete; no tool frames.
   - Command: `npm run e2e -- --grep "chat mermaid"`.
   - Acceptance: diagram renders; no console errors in trace.
4. [x] `e2e/chat-reasoning.spec.ts`
   - Mock `<|channel|>analysis` tokens then `<|channel|>final` after ~1s gap to hit “Thinking…” idle guard from Task 4.
   - Command: `npm run e2e -- --grep "chat reasoning"`.
   - Acceptance: reasoning accordion shows spinner during analysis, stops on final; markers not rendered.
5. [x] `e2e/chat.spec.ts` (when `E2E_USE_MOCK_CHAT=true`)
   - Provide single mock model + provider list (LM Studio enabled, Codex disabled with banner). Stream token → final → complete; status chip gating consistent with Task 4.
   - Command: `E2E_USE_MOCK_CHAT=true npm run e2e -- --grep "chat page"`.
   - Acceptance: provider dropdown renders, send works, status chip flips only on complete.
6. [x] `e2e/chat-codex-trust.spec.ts`
   - Path 1 (Codex unavailable): mock providers/models to mark Codex disabled; ensure banner matches README copy.
   - Path 2 (Codex available): first mock stream returns trust error string exactly `"Not inside a trusted directory and --skip-git-repo-check was not specified."`; second stream uses options with `skipGitRepoCheck:true` + `workingDirectory:"/data"` and returns success (token → final → complete) with threadId reuse.
   - Command: `npm run e2e -- --grep "codex trust"`.
   - Acceptance: auto-skip when Codex unavailable; when available, error case reproduces, success case passes with same threadId.

#### Testing

1. [x] `npm run test --workspace client` (ensure RTL unaffected by mock changes)
2. [x] `npm run e2e` (Codex specs may skip when unavailable)
3. [x] `npm run compose:e2e:up` then `npm run e2e -- --project chromium --grep @live-capture` to record real SSE; save to `e2e/fixtures/sse-live.json`
4. [x] `npm run compose:e2e:down`

#### Implementation notes

- Standardised all mock providers/models to include LM Studio available + Codex disabled reason, with token-first SSE ordering and synthesized tool-results where needed; added explicit tools-unavailable path that hides tool rows/citations via fetch overrides instead of relying on live API data.
- Chat reasoning mock now streams `<|channel|>analysis` frames with timed delays and uses a fetch override so the think toggle reliably renders even when real LM Studio data is present.
- Codex trust mocks use the exact error string with trailing period, then succeed with `workingDirectory:/data` + `skipGitRepoCheck:true` and thread reuse; added banner-only mock test for the unavailable path.
- Tests run: `npm run test --workspace client`, `npm run e2e` (all chat specs pass), extra compose e2e up + live-capture attempt (`--grep @live-capture` found no tagged tests), and manual compose:e2e down to clean containers.

### 6. Expose existing tools via MCP server

- Task Status: \***\*done\*\***
- Git Commits: **af75a9c**

#### Overview

Expose our existing tooling (ListIngestedRepositories, VectorSearch) as an MCP server endpoint that Codex can call. Provide a stable HTTP/SSE MCP surface (e.g., `/mcp`) and document the config.toml parameters users need to point Codex at it (localhost and Docker variants).

#### Documentation Locations

- MCP protocol reference (tool list/call shapes): https://openai.github.io/openai-agents-python/mcp/
- JSON-RPC 2.0 spec (envelopes): https://www.jsonrpc.org/specification
- Codex config guide for `mcp_servers`: https://github.com/openai/codex/blob/main/docs/agents_md.md
- plan_format.md (process)

#### Subtasks

1. [x] Implement `server/src/mcp/server.ts` as an HTTP JSON-RPC 2.0 handler that supports MCP-required methods `initialize`, `tools/list`, and `tools/call` (reference: MCP spec, https://modelcontextprotocol.io/specification/2024-11-05/index#json-rpc-methods). `initialize` must return `protocolVersion`, `capabilities.tools.listChanged=false`, and `serverInfo`.
2. [x] Mount POST `/mcp` in `server/src/index.ts` with the same CORS policy as `/chat`; accept `application/json` only (reference: MCP over HTTP guidance, https://developers.openai.com/apps-sdk/concepts/mcp-server). SSE/streaming optional—baseline must work over plain HTTP POST per MCP Inspector examples.
3. [x] Define tool metadata with JSON Schema per MCP: expose `ListIngestedRepositories` (no params) and `VectorSearch` (query:string required, repository?:string, limit?:number<=20). Reuse validation/output from `toolsIngestedRepos.ts` and `toolsVectorSearch.ts`; outputs must include `repo, relPath, containerPath, hostPath, chunk, score, modelId` (tool schema requirements: https://modelcontextprotocol.io/specification/2024-11-05/index#tool-schema).
4. [x] Wire `tools/call` to existing services; on errors return JSON-RPC `error` with code/message per MCP error envelope (error shape: https://modelcontextprotocol.io/specification/2024-11-05/index#errors).
5. [x] Startup log: print MCP URLs (host `http://localhost:5010/mcp`, docker `http://server:5010/mcp`) so users can drop them into Codex config; mirror Codex detection logging style (Codex config expectations: https://github.com/openai/codex/blob/main/docs/agents_md.md#mcp-servers).
6. [x] Update `config.toml.example` `[mcp_servers]` entry to point at the POST endpoint using the Codex MCP config format (https://github.com/openai/codex/blob/main/docs/agents_md.md#mcp-servers). Include both host and docker URLs; remind this seeds into `./codex` (git-ignored).
7. [x] Documentation: README “MCP for Codex” subsection with step-by-step curl examples (`initialize`, `tools/list`, `tools/call`) and docker URL; design.md note/diagram for MCP flow over JSON-RPC POST (reference curl shapes: https://www.jsonrpc.org/specification and MCP examples: https://developers.openai.com/apps-sdk/concepts/mcp-server).
8. [x] Tests: add `server/src/test/integration/mcp-server.test.ts` covering initialize → tools/list → tools/call happy path, unknown tool error, validation error; run `npm run build --workspace server` and `npm run test --workspace server -- mcp-server.test.ts` (test flow mirrors spec sequence above).
9. [x] Manual smoke: `curl -X POST http://localhost:5010/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'` then tools/list and tools/call; verify schema compliance; finish with `npm run lint --workspaces` and `npm run format:check --workspaces` (curl form per JSON-RPC spec: https://www.jsonrpc.org/specification).

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Using the Playwright mcp tool, perform Manual Codex chat smoke: start a new Codex conversation, confirm threadId reuse on a second turn, verify SSE rendering without tools/citations
9. [x] `npm run compose:down`

#### Implementation notes

- MCP server added at `/mcp` with JSON-RPC methods `initialize`/`tools/list`/`tools/call`; responses wrap tool payloads in `content: application/json` and map validation/domain failures into JSON-RPC errors.
- Startup now logs host/docker MCP URLs; `config.toml.example` seeds matching `[mcp_servers]` entries; README + design document the curl flows and tool schemas.
- Integration test `mcp-server.test.ts` covers initialize, list, happy-path tool calls, invalid params, unknown tool, and internal error mapping; all server/unit/Cucumber suites pass with LM Studio + Codex available.
- Manual smoke: curl initialize/tools/list succeeded; `/chat` with provider=codex streamed threadId `019ae9c4-b0a5-7f40-b28a-96ac379f9813` and reused it on a second turn; MCP curl verified schema. Lint/format re-run; only pre-existing useChatModel dependency warnings remain.

---

### 7. Codex + MCP tool usage in chat (SYSTEM_CONTEXT injection)

- Task Status: **in_progress**
- Git Commits: 193d83d, 963c9a5

#### Overview

Enable Codex chats to use our MCP tools to answer repository questions. Inject the shared SYSTEM_CONTEXT at the start of Codex conversations, instructing the model to call MCP tools to gather answers. Ensure Codex requests route through the MCP server and that tool results flow back to the client (citations/tool blocks) when available.

Current issue discovered (2025-12-06): Codex MCP calls to `code_info` fail because our MCP server returns tool results as `content: [{ type: "application/json", json: {...} }]`, which the Codex client reports as `Unexpected response type`. Codex also probes `resources/list` (and templates) and receives `-32601 Method not found` because we only implement `initialize` / `tools/list` / `tools/call`. This combination leads Codex to surface “ListIngestedRepositories not available” despite the tool working via direct HTTP. Fixes required: return tool results as text content and add minimal `resources/list` / `resources/listTemplates` handlers.

#### Documentation Locations

- SYSTEM_CONTEXT and Codex MCP tools: https://github.com/openai/codex/blob/main/docs/agents_md.md
- Codex SDK thread options (tools/MCP wiring): https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- plan_format.md (process)

#### Subtasks

1. [x] Server (`server/src/routes/chat.ts`, Codex branch):
   - On the first Codex turn, prefix the prompt string with `SYSTEM_CONTEXT` plus a short marker (e.g., `Context:\n…\n\nUser:\n<user text>`). Do not send role-based messages; Codex expects a single prompt string.
   - Thread options must include: `workingDirectory` (default `/data` via `CODEX_WORKDIR`/`CODEINFO_CODEX_WORKDIR`, as in Task 4) and `skipGitRepoCheck:true` (trust fix). MCP discovery stays in `config.toml`; no per-request `mcpServerUrl` hook.
2. [x] Config TOML: ensure `config.toml.example` declares the MCP server with correct TOML syntax—top-level table `mcp_servers` (snake_case), HTTP transport uses `url` only (no `command`/`args`). Add entries like:\n - `[mcp_servers.codeinfo_host]` `url = \"http://localhost:5010/mcp\"`\n - `[mcp_servers.codeinfo_docker]` `url = \"http://server:5010/mcp\"`\n Reference Codex docs (HTTP/streamable MCP) for allowed keys and mutual exclusion rules.
3. [x] Config TOML: ensure `codex/config.toml` declares the MCP server with correct TOML syntax—top-level table `mcp_servers` (snake_case), HTTP transport uses `url` only (no `command`/`args`). Add entries like:\n - `[mcp_servers.codeinfo_host]` `url = \"http://localhost:5010/mcp\"`\n - `[mcp_servers.codeinfo_docker]` `url = \"http://server:5010/mcp\"`\n Reference Codex docs (HTTP/streamable MCP) for allowed keys and mutual exclusion rules.
4. [x] MCP tool wiring: handle Codex `mcp_tool_call` items from `runStreamed` and emit SSE:
   - Emit `tool-request` when a `mcp_tool_call` item starts; emit `tool-result` on completion (or an error payload) mapped to our LM Studio tool shape (repo, relPath, hostPath, containerPath, chunk, score, modelId) with provider `codex`.
   - Preserve `threadId` emission on `thread`/`complete` frames as already done in Task 4.
5. [x] Client (`client/src/hooks/useChatStream.ts`, `client/src/pages/ChatPage.tsx`, tool/citation components):
   - Re-enable send/input for provider=Codex when `toolsAvailable=true`; keep disabled when unavailable.
   - Allow tool blocks/citations to render for Codex; hide only when `toolsAvailable=false`.
   - Ensure payload still includes `provider`, `model`, `threadId`; continue to reuse Codex threadId per conversation.
6. [x] Tests:
   - Server integration: add `server/src/test/integration/chat-codex-mcp.test.ts` mocking Codex SDK to emit `mcp_tool_call` events; assert prompt prefixing with SYSTEM_CONTEXT, workingDirectory/skipGitRepoCheck options, and SSE tool-request/result mapping.
   - Client RTL: extend `client/src/test/chatPage.toolDetails.test.tsx` (or new) to confirm Codex shows tool blocks/citations when tools are available and hides when not; also assert send is enabled for Codex once `toolsAvailable` is true.
   - Commands: `npm run test --workspace server -- chat-codex-mcp.test.ts`; `npm run test --workspace client -- chatPage.toolDetails.test.tsx`.
7. [x] Documentation:
   - README: document that Codex chats now require MCP, note prompt prefix with SYSTEM_CONTEXT, workingDirectory `/data`, and `skipGitRepoCheck:true`.
   - design.md: add a short Codex+MCP flow note/diagram near the chat tooling section.
8. [x] Builds: `npm run build --workspace server`; `npm run build --workspace client`.
9. [x] Lint/format: `npm run lint --workspaces`; `npm run format:check --workspaces`.
10. [x] Adjust MCP tool responses to match Codex expectations: in `server/src/mcp/server.ts`, change tool result wrapping to return a single `content` item of `type: "text"` with JSON stringified payload (Codex rejects `application/json`). Ensure both ListIngestedRepositories and VectorSearch paths use the new shape.
11. [x] Implement MCP resource endpoints to satisfy Codex probes: add `resources/list` and `resources/listTemplates` handlers in `server/src/mcp/server.ts` returning empty arrays (or mapped resources/templates when available) with JSON-RPC success envelopes.
12. [x] Server regression tests for Codex MCP compatibility: add integration tests in `server/src/test/integration/mcp-server.codex-compat.test.ts` covering (a) tools/call returns text content and parses, (b) resources/list/resources/listTemplates return 200 with empty arrays.
13. [x] E2E regression for Codex MCP tool call: extend or add Playwright spec (e.g., `e2e/chat-codex-mcp.spec.ts`) that mocks Codex availability and asserts a Codex chat turn successfully renders tool blocks/citations (no "Unexpected response type"), using mock SSE that includes `tool-result` payload from the MCP server.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Using the Playwright mcp tool, Manual: Codex chat with provider=Codex, verify tool calls occur (List repos, Vector search), tool blocks/citations render, and SYSTEM_CONTEXT is honored.
9. [x] `npm run compose:down`

#### Implementation notes

- Codex prompt now prepends `Context:\n<SYSTEM_CONTEXT>\n\nUser:\n...` on first turn server-side; client stops adding system messages for Codex.
- Codex `mcp_tool_call` events emit `tool-request`/`tool-result` SSE with parameters/result/errorTrimmed, feeding citations/tool blocks for Codex alongside LM Studio.
- config seeding now appends `[mcp_servers.codeinfo_host|codeinfo_docker]` to existing `codex/config.toml` if missing; example TOML drops command-based MCP entries.
- Manual Playwright MCP smoke (Testing step 8) not yet run; requires interactive MCP tool to verify live Codex tool calls.
- MCP server now returns tool results as `text` content (JSON stringified) and implements `resources/list` + `resources/listTemplates` to satisfy Codex probes; added server integration coverage plus Playwright mock Codex MCP spec (`e2e/chat-codex-mcp.spec.ts`, runnable with `E2E_USE_MOCK_CHAT=true`).

---

### 8. Codex thinking visibility (parity with LM Studio)

- Task Status: **done**
- Git Commits: 9354a55, 5948fbc, af820cf

#### Overview

Surface Codex “thinking”/analysis text in the chat UI the same way LM Studio reasoning is shown. Codex `agent_reasoning` events appear in session logs but are dropped by the server SSE stream, so the UI never renders a thinking accordion for Codex. This task forwards Codex reasoning through SSE and displays it without changing tool/citation behaviour.

#### Documentation Locations

- Codex TypeScript SDK streaming / event reference (runStreamed, reasoning items): https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- MCP/JSON-RPC event model (for tool + reasoning envelopes): https://modelcontextprotocol.io/specification/2024-11-05/index#json-rpc-methods
- React streaming/side-effects guidance (for client handling of streamed analysis): https://react.dev/reference/react/useEffect
- plan_format.md (process)

#### Subtasks

1. [x] Server (code change, file: `server/src/routes/chat.ts`): in the Codex `runStreamed` loop, handle `item.updated|item.completed` where `item.type === "agent_reasoning"` by emitting an SSE frame like `{ type: 'analysis', content: <text> }` (or tokens into the analysis buffer) before any tool/assistant handling. Keep tool events and assistant text behaviour unchanged. Add a short inline comment explaining that Codex reasoning maps to the client analysis stream. Read: Codex SDK streaming docs; existing LM Studio reasoning handling in this file for parity.
2. [x] Client hook (code change, file: `client/src/hooks/useChatStream.ts`): extend SSE parser to accept `type === 'analysis'` frames from Codex and route them into the hidden analysis buffer that drives the “Thought process” accordion/spinner (same logic used for LM Studio). Ensure provider-agnostic handling so LM Studio behaviour stays the same. Read: existing analysis handling branches in this hook.
3. [x] Client UI (code change, file: `client/src/pages/ChatPage.tsx`): verify/adjust the thought-process accordion to show when analysis text exists for Codex as well as LM Studio; no layout changes, just ensure the flag is provider-agnostic. Duplicate any gating logic locally so it cannot be missed.
4. [x] Test (server, integration, file: `server/src/test/integration/chat-codex-mcp.test.ts` or new sibling): add a streamed `agent_reasoning` item to the mocked Codex event list and assert the SSE stream includes an `analysis` frame with the reasoning text before the final message.
5. [x] Test (client, hook-level, file: `client/src/test/useChatStream.reasoning.test.tsx`): add a Codex provider case that feeds an `analysis` SSE frame and assert the hook exposes analysis text and leaves final text unchanged.
6. [x] Test (client, RTL, file: `client/src/test/chatPage.reasoning.test.tsx`): render ChatPage with provider=Codex and mocked SSE including `analysis` → verify the “Thought process” accordion appears, shows the reasoning text, and the spinner stops when the final frame arrives.
7. [x] Test (e2e, Playwright mock, file: `e2e/chat-codex-reasoning.spec.ts`): mock `/chat` SSE for Codex to send thread → analysis → token → final → complete; assert the UI shows the thought-process accordion, can expand to reveal reasoning, and still renders the final assistant bubble.
8. [x] Lint/format/build: run `npm run lint --workspaces`, `npm run format:check --workspaces`, `npm run build --workspaces` after code/test changes.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `E2E_USE_MOCK_CHAT=true npx playwright test e2e/chat-codex-reasoning.spec.ts --reporter=list`
6. [x] `npm run e2e`
7. [x] `npm run compose:build`
8. [x] `npm run compose:up`
9. [x] Using the Playwright mcp tool, Manual UI check: disabled Codex state shows guidance; README renders instructions.
10. [x] `npm run compose:down`

#### Implementation notes

- Codex runStreamed now emits `analysis` frames when `agent_reasoning` (and now `reasoning`) arrives, reusing the client analysis stream pathway so Codex thought text renders in the UI (af820cf).
- Client hook accepts `analysis` SSE frames for all providers and normalises state back to final mode so subsequent tokens land in the visible reply; codex streams now keep the thought accordion populated.
- Added Codex-specific reasoning coverage at unit (useChatStream), RTL (ChatPage), integration (chat-codex-mcp), and e2e (chat-codex-reasoning) levels; e2e mock stream also seeds analysis markers to mirror server behaviour.
- Maintained UI gating while confirming the thought-process block is provider-agnostic; provider/model selection mocks expanded to include Codex variants.

---

### 9. Codex host-auth import (one-way bootstrap)

- Task Status: **in_progress**
- Git Commits: **to_do**

#### Overview

Add a one-way bootstrap path for the server container to copy Codex auth from the host’s existing CODEX_HOME into the repo-local CODEINFO_CODEX_HOME to avoid double login. If the container auth is missing, and `/host/codex/auth.json` exists, copy it once (no overwrite).

#### Documentation Locations

- Codex CLI home/auth location: https://github.com/openai/codex/blob/main/docs/getting_started.md
- MCP requirements (for context): https://github.com/openai/codex/blob/main/docs/agents_md.md
- plan_format.md (process)

#### Subtasks

1. [ ] Compose (docker-compose.yml): under `services.server.volumes`, add:
   ```yaml
   - ${CODEX_HOME:-$HOME/.codex}:/host/codex:ro
   - ./codex:/app/codex
   ```
   so host Codex auth is always mounted read-only and the repo-local CODEINFO_CODEX_HOME remains at `/app/codex`.
2. [ ] E2E compose (docker-compose.e2e.yml): add the same two volume lines under `services.server.volumes` to mirror main compose for mock/e2e runs.
3. [ ] Server startup helper (new file `server/src/utils/codexAuthCopy.ts` or existing `server/src/config/codex.ts`): implement `ensureCodexAuthFromHost({ containerHome, hostHome, logger })` that:
   - if `${containerHome}/auth.json` exists → return without changes;
   - else if `${hostHome}/auth.json` exists → copy it to `${containerHome}/auth.json`, preserving perms where possible; log source and success;
   - else log that no host auth was found; never overwrite existing container auth.
   Wire this into `server/src/index.ts` startup before Codex detection so the copy runs once at boot.
4. [ ] Documentation (README, section `## Codex (CLI)`): add explicit host-login-only flow:
   - Install: `npm install -g @openai/codex`
   - Host login writing to host home: `CODEX_HOME=./codex codex login` (or default `~/.codex`)
   - Compose mounts `${CODEX_HOME:-$HOME/.codex} -> /host/codex` and copies into `/app/codex` if missing, so no separate container login is needed.
   - Note one-way, non-overwriting behavior and disabled state if CLI/auth/config absent and no host auth to copy.
5. [ ] Documentation (design.md, Codex/MCP section): add a short paragraph plus a small flow bullet list describing host auth at `/host/codex` being copied to `/app/codex` on startup when missing, and that `/app/codex` remains the primary home.
6. [ ] Test (server unit, `server/src/test/unit/codexAuthCopy.test.ts`): mock-fs cases:
   - copies host auth when container auth missing;
   - skips copy when container auth exists;
   - logs “host missing” when neither exists.
7. [ ] Test (server integration, optional, `server/src/test/integration/codexAuthCopy.integration.test.ts`): use temp dirs to assert real copy occurs once and does not overwrite existing container auth.
8. [ ] Test (manual/compose smoke): steps to document and perform:
   - ensure host has a valid auth at `${CODEX_HOME:-$HOME/.codex}/auth.json` (e.g., `CODEX_HOME=./codex codex login`);
   - run `npm run compose:build && npm run compose:up`;
   - exec into server container `docker compose exec server ls -l /app/codex` and confirm `auth.json` exists;
   - bring down with `npm run compose:down`.
9. [ ] Lint/format/build: run `npm run lint --workspaces`; `npm run format:check --workspaces`; `npm run build --workspace server`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client` (sanity)
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client` (sanity)
5. [ ] `npm run e2e` (should remain unaffected; import only runs when host auth is mounted)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up` (with host auth mount) to validate copy
8. [ ] `npm run compose:down`

#### Implementation notes

- Keep container CODEX_HOME as the primary source; do not copy back to host. Ensure logs clearly state when a copy was made and from which path. Guard against overwriting existing container auth.

---

### 10. Codex guidance copy and disabled-state UX

- Task Status: **to_do**
- Git Commits: **to_do**

#### Overview

Finalize and implement the user-facing guidance for Codex: login instructions placement (README + UI banner/tooltip), disabled-state messaging when CLI/auth/MCP is missing, and inline hints for config.toml seeding/mounting.

#### Documentation Locations

- Codex login/setup: https://github.com/openai/codex/blob/main/docs/getting_started.md
- Codex MCP reference (for guidance text): https://github.com/openai/codex/blob/main/docs/agents_md.md
- plan_format.md (process)

#### Subtasks

1. [ ] README (`## Codex (CLI)`): update guidance to reflect host-login-only flow with the new host-auth mount/copy:
   - Install: `npm install -g @openai/codex`
   - Login host (writes to host CODEX_HOME, e.g., `CODEX_HOME=./codex codex login` or default `~/.codex`)
   - Compose will mount `${CODEX_HOME:-$HOME/.codex}` into `/host/codex` and copy into container `CODEINFO_CODEX_HOME` if missing, so no separate container login is needed.
   - Home: `CODEINFO_CODEX_HOME=./codex` (mounted to `/app/codex`); seeded from `config.toml.example` per Task 1; skipGitRepoCheck/workingDirectory defaults from Task 4.
   - Disabled behaviour: Codex appears disabled with banner if CLI/auth/config are absent and no host auth is available to copy.
2. [ ] UI banner/tooltip (ChatPage near Provider select):
   - Mention all prerequisites above, including Docker mount path and seeded config.
   - Link to README anchor `#codex-cli`.
   - Note that tools are required and will be enabled once MCP is configured (Task 7).
3. [ ] Disabled-state logic: ensure banner appears whenever Codex detection says unavailable (no CLI/auth/config) and hides when available.
4. [ ] Tests: extend `client/src/test/chatPage.provider.test.tsx` to assert banner text, link href, and that Send stays disabled when Codex unavailable but enables when available. Command: `npm run test --workspace client -- chatPage.provider.test.tsx`.
5. [ ] Lint/format: `npm run lint --workspaces`; `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, Manual UI check: disabled Codex state shows guidance; README renders instructions.
9. [ ] `npm run compose:down`

#### Implementation notes

- Capture final copy text for reuse in future stories.

---

### 11. Final validation and release checklist

- Task Status: **to_do**
- Git Commits: **to_do**

#### Overview

Cross-check acceptance criteria, run full builds/tests (including Docker/e2e where applicable), update docs (README/design/projectStructure), and prepare the PR summary/screenshots per plan_format final-task guidance.

#### Documentation Locations

- plan_format.md final task expectations
- README/design.md/projectStructure.md
- Docker compose files and e2e scripts

#### Subtasks

1. [ ] Builds: `npm run build --workspace server`; `npm run build --workspace client`.
2. [ ] Tests: `npm run test --workspace server`; `npm run test --workspace client`.
3. [ ] Lint/format: `npm run lint --workspaces`; `npm run format:check --workspaces`.
4. [ ] Docker: clean build `npm run compose:build`; start `npm run compose:up`; verify health (`curl http://localhost:5010/health`, `curl http://localhost:5001`), then `npm run compose:down`.
5. [ ] e2e: `npm run e2e` (note Codex skips if CLI unavailable). If Codex CLI available, run manual MCP smoke: `curl -X POST http://localhost:5010/mcp ...list_tools` and one Codex chat turn via `/chat` to confirm tools.
6. [ ] Docs: update `README.md` (final Codex/MCP steps, commands added), `design.md` (chat + MCP flow, UI changes), `projectStructure.md` (new MCP files/tests/fixtures).
7. [ ] Screenshots: capture to `test-results/screenshots/0000010-09-<name>.png` per plan_format—include chat with Codex+MCP (if available) and core pages (logs/ingest) showing healthy state.
8. [ ] PR summary: in this plan’s Implementation notes, add a concise story-wide summary plus Codex enablement instructions; reuse it for the PR comment.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, Manual UI check: disabled Codex state shows guidance; README renders instructions.
9. [ ] `npm run compose:down`

#### Implementation notes

- Document any deviations/known limitations (e.g., Codex unavailable in CI).
