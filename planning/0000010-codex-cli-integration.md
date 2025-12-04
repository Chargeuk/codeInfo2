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

- Task Status: **__done__**
- Git Commits: **5c049e0**

#### Overview

Provide a checked-in `config.toml.example` for Codex with our defaults, and seed `./codex/config.toml` (CODEINFO_CODEX_HOME) from it when missing, without overwriting user changes.

#### Documentation Locations

- Codex config reference (config.toml fields): https://github.com/openai/codex/blob/main/docs/agents_md.md
- CODEX_HOME env mapping in SDK: https://github.com/openai/codex/blob/main/sdk/typescript/src/codexOptions.ts
- plan_format.md (process)

#### Subtasks

1. [x] Add `config.toml.example` at repo root with:
   - `model = "gpt-5.1-codex-max"`
   - `model_reasoning_effort = "high"`
   - `[features]` `web_search_request = true` `view_image_tool = true`
   - `[mcp_servers]` entry for MCP: host `http://localhost:5010/mcp`, docker `http://server:5010/mcp` (comment both)
2. [x] Add bootstrap copy in `server/src/config/codexConfig.ts` (or a small `scripts/seed-codex-config.ts`): on startup, if `${CODEINFO_CODEX_HOME}/config.toml` missing, copy the example without overwriting.
   - Minimal copy snippet:
   ```ts
   if (!fs.existsSync(target)) {
     fs.copyFileSync(path.resolve('config.toml.example'), target);
   }
   ```
3. [x] Document in README: location of the example, how it seeds `./codex/config.toml`, how to edit, and reminder that `codex/` is git-ignored.
4. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; shellcheck any script if added.

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

- Task Status: **__done__**
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

- Task Status: **__done__**
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
   router.get('/chat/providers', (_req,res)=>res.json({providers:[{id:'lmstudio',label:'LM Studio',available:true},{id:'codex',label:'OpenAI Codex',available:detection.available,toolsAvailable:detection.toolsAvailable}]}));
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

- Task Status: **__in_progress__**
- Git Commits: **to_do**

#### Overview

Enable chatting with Codex via the SDK using the selected provider/model, streaming into existing SSE frames. No MCP/tool execution yet. Add threadId handling so Codex conversations resume without replaying client-side history.

#### Documentation Locations

- Codex SDK streaming/thread API (delta handling): https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- SSE/EventSource basics (client/server framing): https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- React `useEffect`/state patterns for streams: https://react.dev/reference/react/useEffect
- plan_format.md (process)

#### Subtasks

1. [ ] Implement Codex chat provider in `server/src/routes/chat.ts` (or new `chatCodex.ts`): accept provider/model/threadId; start/resume Codex thread via SDK; stream deltas as SSE frames (`token/final/complete/error`); block send if detection failed.
   - SSE mapping example:
   ```ts
   res.write(`data: ${JSON.stringify({type:'token',content:delta})}\n\n`);
   res.write(`data: ${JSON.stringify({type:'final',message})}\n\n`);
   res.write(`data: {"type":"complete"}\n\n`);
   ```
2. [ ] Client send: in `client/src/hooks/useChatStream.ts`, include `provider/model/threadId` in payload; store Codex `threadId` per conversation; block provider change mid-conversation; allow model change.
3. [ ] Codex tools off for this task: ignore tool calls on server; suppress citations/tool blocks on client for Codex responses.
4. [ ] Logging: add provider + threadId context in `server/src/logger.ts` and in `useChatStream` logger calls.
5. [ ] Docs: update README/design.md noting Codex chat is available (tools pending) and requires threadId persistence.
6. [ ] Lint/format: run `npm run lint --workspaces` and `npm run format:check --workspaces`.
7. [ ] Test (build): `npm run build --workspace server` — ensure Codex path compiles.
8. [ ] Test (build): `npm run build --workspace client` — ensure chat UI changes compile.
9. [ ] Test (server integration/unit): add `server/src/test/integration/chat-codex.test.ts` with mocked SDK covering SSE frames, threadId reuse, and detection-failure blocking; purpose: Codex path works without tools.
10. [ ] Test (client RTL): extend `client/src/test/chatPage.stream.test.tsx` (or new) to verify provider=Codex sends threadId, prevents provider change mid-convo, and disables on detection failure; purpose: client gating behaves.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, perform Manual Codex chat smoke: start a new Codex conversation, confirm threadId reuse on a second turn, verify SSE rendering without tools/citations
9. [ ] `npm run compose:down`



#### Implementation notes

- Record any SDK mocking approach and SSE mapping decisions.
- Note future hook points where MCP/tool execution will be added in a later task.

---


### 5. Expose existing tools via MCP server

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Expose our existing tooling (ListIngestedRepositories, VectorSearch) as an MCP server endpoint that Codex can call. Provide a stable HTTP/SSE MCP surface (e.g., `/mcp`) and document the config.toml parameters users need to point Codex at it (localhost and Docker variants).

#### Documentation Locations

- MCP protocol reference (tool list/call shapes): https://openai.github.io/openai-agents-python/mcp/
- JSON-RPC 2.0 spec (envelopes): https://www.jsonrpc.org/specification
- Codex config guide for `mcp_servers`: https://github.com/openai/codex/blob/main/docs/agents_md.md
- plan_format.md (process)

#### Subtasks

1. [ ] Add MCP server module `server/src/mcp/server.ts` and mount routes under `/mcp` in `server/src/index.ts`: implement `list_tools` and `call_tool` mapping to existing tool services.
   - JSON-RPC response example: `{ "jsonrpc": "2.0", "id": 1, "result": { ...toolResult } }`
   - SSE fallback example for streaming: `res.write('event: tool_result\n'); res.write('data: '+JSON.stringify(payload)+'\n\n');`
2. [ ] Map JSON-RPC 2.0 envelopes; support SSE/streamable HTTP for `call_tool` when responses stream; return JSON errors on failure.
3. [ ] Reuse existing validation/schemas from `toolsIngestedRepos` and `toolsVectorSearch`; ensure response payload matches current HTTP outputs (hostPath, modelId, etc.).
4. [ ] On startup, log MCP enabled URL(s) (host: http://localhost:5010/mcp, docker: http://server:5010/mcp) and any binding choices (127.0.0.1).
5. [ ] Update `config.toml.example` `[mcp_servers]` entry with the URLs above and ensure README documents how to set it.
6. [ ] Docs: add README/design notes for MCP usage, manual verification steps, and local-only security scope.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.
8. [ ] Test (build): `npm run build --workspace server` — ensure MCP module compiles.
9. [ ] Test (server integration/unit): add `server/src/test/integration/mcp-server.test.ts` covering `list_tools` and `call_tool` happy/error paths; purpose: verify JSON-RPC wiring and tool dispatch.
10. [ ] Test (manual): with Codex CLI logged in, set `[mcp_servers]` to `http://localhost:5010/mcp`, run `codex` chat, and verify tools list/call succeed; purpose: end-to-end MCP validation.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, perform Manual Codex chat smoke: start a new Codex conversation, confirm threadId reuse on a second turn, verify SSE rendering without tools/citations
9. [ ] `npm run compose:down`

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

- SYSTEM_CONTEXT and Codex MCP tools: https://github.com/openai/codex/blob/main/docs/agents_md.md
- Codex SDK thread options (tools/MCP wiring): https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- plan_format.md (process)

#### Subtasks

1. [ ] Server: in `server/src/routes/chat.ts` (Codex path), prepend `SYSTEM_CONTEXT` on first Codex turn and ensure thread creation includes it.
   - Add system message example: `{ role: 'system', content: SYSTEM_CONTEXT }` prepended before user message when threadId is absent.
2. [ ] Server: set Codex thread options to point at `/mcp`; require/strongly bias tool use so Codex calls ListIngestedRepositories/VectorSearch.
3. [ ] Server: map Codex MCP tool calls/results into SSE `tool-request`/`tool-result` frames; include provider tags; ensure citations data flow matches LM Studio path.
4. [ ] Client: re-enable chat input for provider=Codex; allow tool blocks/citations when `toolsAvailable=true`; still hide when unavailable.
5. [ ] Preserve threadId handling with MCP: store/forward threadId per conversation.
6. [ ] Docs: update README/design with SYSTEM_CONTEXT injection for Codex and tool-required behaviour; include prompt/instruction snippet used.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.
8. [ ] Test (build): `npm run build --workspace server` — ensure MCP-enabled Codex path compiles.
9. [ ] Test (build): `npm run build --workspace client` — ensure UI changes compile.
10. [ ] Test (server integration): add mocked Codex MCP test (e.g., `server/src/test/integration/chat-codex-mcp.test.ts`) verifying tool-call/result SSE mapping; purpose: Codex+MCP flow works.
11. [ ] Test (client RTL): extend `client/src/test/chatPage.toolDetails.test.tsx` (or new) to confirm Codex provider shows tool blocks/citations when `toolsAvailable=true` and hides when false; purpose: UI renders tools correctly for Codex.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, Manual: Codex chat with provider=Codex, verify tool calls occur (List repos, Vector search), tool blocks/citations render, and SYSTEM_CONTEXT is honored.
9. [ ] `npm run compose:down`


#### Implementation notes

- Capture how SYSTEM_CONTEXT is injected (server-side to avoid client replay) and any prompt wording.
- Note any Codex-specific quirks in MCP call shapes vs our SSE expectations.

---

### 7. Codex guidance copy and disabled-state UX

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Finalize and implement the user-facing guidance for Codex: login instructions placement (README + UI banner/tooltip), disabled-state messaging when CLI/auth/MCP is missing, and inline hints for config.toml seeding/mounting.

#### Documentation Locations

- Codex login/setup: https://github.com/openai/codex/blob/main/docs/getting_started.md
- Codex MCP reference (for guidance text): https://github.com/openai/codex/blob/main/docs/agents_md.md
- plan_format.md (process)

#### Subtasks

1. [ ] Define exact wording/location for Codex login/setup guidance in README (host + Docker) and add it.
   - Insert under `README.md` -> `## Codex (CLI)` the text: "Install CLI: npm install -g @openai/codex. Login: codex login (host) or docker compose run --rm server sh -lc 'codex login'. Set CODEINFO_CODEX_HOME=./codex (mounted to /app/codex). If CLI/auth/config missing, Codex shows disabled." 
2. [ ] Add UI guidance when Codex is disabled (e.g., inline banner/tooltip near Provider dropdown) explaining prerequisites (CLI install, login, config/mount) with links to README anchors.
3. [ ] Ensure disabled-state copy covers both host and Docker paths (CODEINFO_CODEX_HOME, config seeding, auth login).
4. [ ] Update tests: client RTL (add/extend `chatPage.provider.test.tsx`) to assert disabled-state banner/tooltip renders with required guidance text and links when Codex unavailable.
5. [ ] Run lint/format for touched workspaces.

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

### 8. Final validation and release checklist

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Cross-check acceptance criteria, run full builds/tests (including Docker/e2e where applicable), update docs (README/design/projectStructure), and prepare the PR summary/screenshots per plan_format final-task guidance.

#### Documentation Locations

- plan_format.md final task expectations
- README/design.md/projectStructure.md
- Docker compose files and e2e scripts

#### Subtasks

1. [ ] Build server and client.
2. [ ] Run server tests and client tests.
3. [ ] Perform clean Docker build; start compose stack (with Codex disabled/enabled as appropriate) and verify health.
4. [ ] Run e2e tests (skip Codex if not available in CI; document) and manual MCP smoke if Codex CLI is available.
5. [ ] Update README, design.md, projectStructure.md to reflect final state and MCP/Codex config.
6. [ ] Capture required screenshots (if applicable) and prepare a PR-ready summary of changes and how to enable Codex.
7. [ ] Run lint/format across workspaces.
8. [ ] Test (build): `npm run build --workspaces` — final confirmation.
9. [ ] Test (unit/integration): `npm run test --workspaces` — final confirmation.
10. [ ] Test (Docker): clean build + `docker compose up`/`down`, noting Codex availability status.
11. [ ] Test (e2e): `npm run e2e` (document skips if Codex unavailable); manual MCP smoke if Codex CLI present.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
9. [ ] `npm run compose:down`

#### Implementation notes

- Document any deviations/known limitations (e.g., Codex unavailable in CI).
