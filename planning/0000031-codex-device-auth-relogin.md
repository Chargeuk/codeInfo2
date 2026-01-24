# Story 0000031 - Codex device-auth re-login flow

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today, when Codex auth expires inside the server container, requests fail with an error like “Your access token could not be refreshed because your refresh token was already used.” The UI surfaces the failure but provides no way to re-authenticate without logging into the container manually or copying a fresh `auth.json`. This makes the web UI feel broken when tokens expire, especially for agents, commands, or flow runs that use the Codex CLI under the hood.

We want a consistent, user-friendly re-login flow that works for **Chat** and **Agents** (including command-driven agent runs). The UI should always offer a **device-auth login** action **when Codex is the selected provider and available**, so users can re-authenticate proactively without relying on error detection. Clicking the action opens a centered dialog that guides the user through device-auth and shows the verification URL + code. The dialog includes a selector for which agent or chat session is being authenticated; it should default based on where the dialog was opened, but allow changing it. After successful login, the user can retry the run without leaving the UI.

This story does **not** add new business features; it only improves how the system recovers from expired Codex credentials.

---

## Acceptance Criteria

- Chat page shows a **Re-authenticate (device auth)** button only when the provider dropdown is set to **Codex** *and* `/chat/providers` reports Codex `available=true`; hide it when the provider is LM Studio or Codex is unavailable.
- Agents page shows the same button only when an agent is selected and Codex is available; Agents continue to use Codex as the provider and do not gain a new provider selector.
- Clicking the button opens a centered modal titled **Codex device auth** with: a target selector (`Chat` or `Agent: <name>`), a **Start device auth** button, and a close action.
- The target selector defaults to the current context (Chat page → `Chat`, Agents page → selected agent) and can be changed before starting.
- On **Start device auth**, the client sends `POST /codex/device-auth` with `{ target: "chat" }` or `{ target: "agent", agentName: "<selected>" }`; the modal shows a loading state and disables inputs until the request finishes.
- On success, the modal displays the `verificationUrl` and `userCode` returned by the server (plus `expiresInSec` if provided) and offers copy actions for both values.
- If the request fails, the modal shows a clear error message and re-enables **Start device auth** so the user can retry.
- Successful device-auth writes updated credentials to the selected target only:  
  - Target = `chat`: update the server Codex home **and** copy `auth.json` into **all** agent homes.  
  - Target = `agent`: update only the selected agent’s Codex home (no changes to the server Codex home).
- Subsequent agent runs (direct message, command, or flow step) use the updated auth without manual container access.
- The dialog never auto-retries a chat/agent run; users manually re-send their message or command after authenticating.
- No LM Studio UI or behavior changes occur; the button and dialog are Codex-only.

---

## Out Of Scope

- Automatic completion of the device-auth browser step (user interaction is still required).
- Changes to Codex CLI internals or custom forks of the Codex CLI.
- New UI flows for API-key authentication.
- Re-authenticate UI on the Flows page.
- Non-Codex auth problems unrelated to refresh-token expiry.
- Detection or special handling of specific Codex auth failure strings (we rely on the always-available re-auth dialog instead).
- Persisting device-auth state in Mongo beyond existing `auth.json` caching.

---

## Questions

- None.

---

## Documentation Locations (for later tasks)

- Codex auth + device auth: https://developers.openai.com/codex/auth
- Codex CLI reference (`codex login`): https://developers.openai.com/codex/cli/reference
- Codex config reference (`cli_auth_credentials_store`): https://developers.openai.com/codex/config-reference/
- Node child_process (spawning CLI): https://nodejs.org/api/child_process.html
- Express route handlers: Context7 `/expressjs/express/v5.1.0`
- MUI Dialog + Button + Select patterns: MUI MCP

---

## Research Findings (2026-01-24)

- Codex device code login requires enabling device code login in ChatGPT security settings (or workspace admin permissions).
- Codex can store credentials in `auth.json` under `CODEX_HOME` **or** in the OS keyring; `cli_auth_credentials_store` controls `file`, `keyring`, or `auto` behavior.
- `codex login --device-auth` prints the verification URL + user code to **stdout** and does not provide JSON/machine-readable output.
- `codex login status` can be used to confirm credentials exist after the flow completes.

---

## Implementation Ideas

- **Server endpoint (new):** Add `POST /codex/device-auth` under `server/src/routes` (new router or in `chat.ts`) that validates `{ target: "chat" | "agent", agentName? }`, resolves the Codex home via `server/src/config/codexConfig.ts`, and spawns `codex login --device-auth` with `CODEX_HOME` set to that home.
- **Stdout parsing:** Capture CLI **stdout** and parse the verification URL + user code from the device-auth prompt (no JSON output available) before returning `{ status, verificationUrl, userCode, expiresInSec?, target, agentName? }`.
- **Credential storage policy:** Before running login, ensure `cli_auth_credentials_store = "file"` in the target Codex `config.toml` so `auth.json` is written in containers; if the config cannot be written, return a clear error that auth cannot be persisted.
- **Detection refresh:** After login, refresh `CodexDetection` in `server/src/providers/codexRegistry.ts` (and any `codexAvailability` helpers) so `/chat/providers` reports Codex available without a restart.
- **Agent propagation:** If target is `chat`, call `server/src/agents/authSeed.ts` to copy the updated `auth.json` into every agent home; if target is `agent`, update only that agent home.
- **Client API helper:** Add a small client API wrapper for `POST /codex/device-auth` and error shapes alongside existing fetch helpers (`client/src/api/*`).
- **Dialog component:** Create a reusable `CodexDeviceAuthDialog` (e.g., `client/src/components/codex/`) using MUI Dialog patterns (similar to `DirectoryPickerDialog`) with target selector, start button, loading state, and success/error panel.
- **Chat integration:** In `client/src/pages/ChatPage.tsx`, show the **Re-authenticate (device auth)** action only when `useChatModel` provider is Codex and `available=true`; wire the dialog to default target `Chat`.
- **Agents integration:** In `client/src/pages/AgentsPage.tsx`, show the action only when an agent is selected and Codex is available; populate the target selector with agents from `/agents` and default to the selected agent.
- **Flows behavior:** No Flows-page UI changes (out of scope), but server-side auth propagation should cover flow steps that run via agents.
- **UX messaging:** On failure, surface a clear error; when device-auth is disabled, include the text “Enable device code login in ChatGPT settings” (no link).
- **Tests (outline):** Extend existing chat/agents page tests to assert button visibility and dialog flow; add a server route unit/integration test for `POST /codex/device-auth` using a stubbed CLI invocation.

---

## Message Contracts & Storage Shapes

- **New request (HTTP):** `POST /codex/device-auth` body `{ target: "chat" | "agent", agentName?: string }`.
- **New response (HTTP 200):** `{ status: "completed", verificationUrl: string, userCode: string, expiresInSec?: number, target: "chat" | "agent", agentName?: string }`.
- **Existing provider contracts:** keep `/chat/providers` and `/chat/models` shapes unchanged (`ChatProviderInfo`, `ChatModelsResponse`), so Codex availability still uses `available`, `toolsAvailable`, and `reason` fields.
- **Streaming contracts:** no new WS event types; device-auth is a normal HTTP call and chat/agent streams continue to use existing event shapes.
- **Storage shapes:** no Mongo changes; credentials are written to `auth.json` under the resolved Codex home because `cli_auth_credentials_store = "file"` is enforced for this flow.

---

## Edge Cases and Failure Modes

- Device-auth is not enabled in ChatGPT settings → endpoint returns an actionable error in the dialog and includes “Enable device code login in ChatGPT settings”.
- `config.toml` cannot be updated to `cli_auth_credentials_store = "file"` → return an error stating credentials cannot be persisted.
- `target = agent` with an unknown `agentName` → return `404 { error: 'not_found' }` so the UI can prompt the user to pick a valid agent.
- CLI output does not include a parsable verification URL or user code → return a clear error (“device auth output not recognized”) and log the raw output for debugging.
- Device code expires (15-minute timeout) or authorization is declined → CLI exits with an error; surface a “device code expired or was declined” message and allow retry.
- Codex CLI not found or exits non-zero → surface a distinct error code so UI can display “Codex unavailable.”
- Auth error appears mid-run → run fails as it does today; user can re-auth via the always-available dialog.
- Multiple concurrent requests trigger device-auth → allow it (no rate-limit), but ensure dialog messaging is clear.
- Agents using alternate Codex homes are supported (device-auth endpoint resolves them internally).

---

## Implementation Plan

### 1. Server: Device-auth CLI parsing helper

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Create a reusable helper that runs `codex login --device-auth`, parses the verification URL + user code from stdout, and returns a structured result for the route layer.

#### Documentation Locations

- Codex auth + device auth: https://developers.openai.com/codex/auth
- Codex CLI reference (`codex login`): https://developers.openai.com/codex/cli/reference
- Node.js child_process: https://nodejs.org/api/child_process.html
- Codex auth + device auth: https://developers.openai.com/codex/auth
- Codex CLI reference (`codex login`): https://developers.openai.com/codex/cli/reference
- Node.js child_process: https://nodejs.org/api/child_process.html
- Node.js test runner: https://nodejs.org/api/test.html
- Supertest HTTP assertions: https://github.com/forwardemail/supertest
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Mermaid diagrams: Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides: https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review Codex CLI + config helpers used for spawning:
   - Documentation to read (repeat):
     - Codex CLI reference (`codex login`): https://developers.openai.com/codex/cli/reference
   - Files to read:
     - `server/src/config/codexConfig.ts`
     - `server/src/providers/codexDetection.ts`
     - `server/src/mcpAgents/codexAvailability.ts`
   - Snippets to locate:
     - `buildCodexOptions` env handling
     - CLI detection logic (`command -v codex`)
2. [ ] Add a CLI device-auth helper:
   - Documentation to read (repeat):
     - Node.js child_process: https://nodejs.org/api/child_process.html
   - Files to edit:
     - `server/src/utils/codexDeviceAuth.ts` (new)
   - Implementation details:
     - Spawn `codex login --device-auth` with `CODEX_HOME=<resolved home>` and inherited env.
     - Capture stdout/stderr, parse verification URL + user code from stdout (regex-based), and return a structured result.
     - Expose a small pure parser function so unit tests can validate regex parsing with fixture output.
     - Keep running the child process after parsing and log the final exit status.
3. [ ] Add unit tests for parsing + runner behavior:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/codexDeviceAuth.test.ts` (new)
   - Test expectations:
     - Parser extracts `verificationUrl` + `userCode` from example device-auth output.
     - Runner returns an error when output is missing required fields.
4. [ ] Update `projectStructure.md` after any file additions/removals in this task.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run compose:build:clean`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
4. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
5. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
6. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 2. Server: Device-auth route contract

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add `POST /codex/device-auth` that validates the target (chat or agent), calls the CLI helper, and returns the success payload needed by the UI.

#### Documentation Locations

- Codex auth + device auth: https://developers.openai.com/codex/auth
- Codex CLI reference (`codex login`): https://developers.openai.com/codex/cli/reference
- Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
- Express 5 API reference: https://expressjs.com/en/5x/api.html
- Node.js test runner: https://nodejs.org/api/test.html
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Mermaid diagrams: Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides: https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review existing route and error-handling patterns:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/index.ts`
     - `server/src/logger.ts`
     - `server/src/routes/agentsRun.ts`
     - `server/src/routes/flowsRun.ts`
     - `server/src/routes/chatProviders.ts`
     - `server/src/utils/codexDeviceAuth.ts`
   - Key requirements (repeat):
     - Error responses must align with existing `invalid_request`, `not_found`, and `codex_unavailable` shapes.
2. [ ] Add the device-auth route handler:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/codexDeviceAuth.ts` (new)
     - `server/src/index.ts`
     - `server/src/logger.ts` (for `resolveLogConfig`)
   - Implementation details:
     - Export `createCodexDeviceAuthRouter` and mount at `/codex`.
     - Apply the JSON body limit using `resolveLogConfig().maxClientBytes` (match agents/flows routes).
     - Accept body `{ target: 'chat' | 'agent', agentName?: string }`.
     - Validate `target` as a trimmed string; reject missing/unknown values with `400 { error: 'invalid_request' }`.
     - When `target === 'agent'`, require a non-empty `agentName` that matches a discovered agent; return `404 { error: 'not_found' }` if missing.
     - If the Codex CLI is not available, return `503 { error: 'codex_unavailable', reason }` to align with other providers.
     - Call the helper from Task 1 and build `{ status: 'completed', verificationUrl, userCode, expiresInSec?, target, agentName? }`.
     - Log request start + success/failure with `baseLogger` including `requestId`, `target`, and `agentName`.
3. [ ] Add a server integration test for the route:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/codex.device-auth.test.ts` (new)
   - Test expectations:
     - `target=chat` returns `200` with parsed `verificationUrl` + `userCode` when the helper is stubbed.
     - `target=agent` with an unknown `agentName` returns `404 not_found`.
   - Key requirements (repeat):
     - Stub the helper so tests do not call the real CLI.
4. [ ] Update API documentation after the server change:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `openapi.json` (add `POST /codex/device-auth` request/response schema)
   - Key requirements (repeat):
     - Request body includes `target` + optional `agentName`.
     - Response includes `verificationUrl`, `userCode`, optional `expiresInSec`.
5. [ ] Update `projectStructure.md` after any file additions/removals in this task.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run compose:build:clean`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
4. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
5. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
6. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 3. Server: Persist auth configuration for device-auth

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Ensure the Codex config enforces `cli_auth_credentials_store = "file"` so device-auth writes `auth.json` under the target `CODEX_HOME`.

#### Documentation Locations

- Codex auth + device auth: https://developers.openai.com/codex/auth
- Codex config reference (`cli_auth_credentials_store`): https://developers.openai.com/codex/config-reference/
- Node.js fs/promises: https://nodejs.org/api/fs.html
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Mermaid diagrams: Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides: https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review Codex config helpers:
   - Documentation to read (repeat):
     - Codex config reference (`cli_auth_credentials_store`): https://developers.openai.com/codex/config-reference/
   - Files to read:
     - `server/src/config/codexConfig.ts`
   - Snippets to locate:
     - `getCodexConfigPathForHome`
2. [ ] Add a helper to enforce `cli_auth_credentials_store = "file"`:
   - Documentation to read (repeat):
     - Codex auth + device auth: https://developers.openai.com/codex/auth
   - Files to edit:
     - `server/src/config/codexConfig.ts`
   - Implementation details:
     - Read the target `config.toml` and ensure the `cli_auth_credentials_store` setting is present (append or update in-place).
     - Note from Codex docs: `file` stores credentials in `auth.json` under `CODEX_HOME` (treat it as a secret; never commit).
     - If the file cannot be updated, return a clear error that persistence is unavailable.
   - Key requirements (repeat):
     - Keep changes minimal and avoid rewriting unrelated config contents.
3. [ ] Add a unit test for the config enforcement helper:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/codexConfig.device-auth.test.ts` (new)
   - Test expectations:
     - When missing, the helper writes `cli_auth_credentials_store = "file"` into a temp config file.
4. [ ] Update `projectStructure.md` after any file additions/removals in this task.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build:clean`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 4. Server: Auth propagation + Codex availability refresh

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Copy refreshed `auth.json` to agent homes when targeting chat, and refresh Codex availability after login.

#### Documentation Locations

- Codex auth + device auth: https://developers.openai.com/codex/auth
- Node.js fs/promises: https://nodejs.org/api/fs.html
- Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Mermaid diagrams: Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides: https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review auth propagation + detection helpers:
   - Documentation to read (repeat):
     - Node.js fs/promises: https://nodejs.org/api/fs.html
   - Files to read:
     - `server/src/agents/authSeed.ts`
     - `server/src/utils/codexAuthCopy.ts`
     - `server/src/agents/discovery.ts`
     - `server/src/providers/codexDetection.ts`
     - `server/src/providers/codexRegistry.ts`
     - `server/src/routes/codexDeviceAuth.ts`
2. [ ] Add overwrite-capable auth propagation:
   - Documentation to read (repeat):
     - Node.js fs/promises: https://nodejs.org/api/fs.html
   - Files to edit:
     - `server/src/agents/authSeed.ts`
     - `server/src/routes/codexDeviceAuth.ts`
     - `server/src/agents/discovery.ts`
   - Implementation details:
     - When `target === 'chat'`, copy `auth.json` from the primary Codex home to every agent home (overwrite existing files).
     - Use `discoverAgents()` to enumerate agent homes; skip disabled agents if appropriate.
     - When `target === 'agent'`, update only the selected agent home.
     - Log copy failures and return a warning in the response when propagation fails.
3. [ ] Refresh Codex availability after login:
   - Documentation to read (repeat):
     - Codex auth + device auth: https://developers.openai.com/codex/auth
   - Files to edit:
     - `server/src/providers/codexDetection.ts`
     - `server/src/providers/codexRegistry.ts`
     - `server/src/routes/codexDeviceAuth.ts`
   - Implementation details:
     - Re-run detection for the updated **primary** Codex home and update the registry so `/chat/providers` shows availability without restart.
     - Do not change global detection when the target is an agent-only auth refresh.
4. [ ] Add a unit test for auth propagation overwrite:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/agents.authSeed.test.ts` (new or existing)
   - Test expectations:
     - When `overwrite=true`, the helper replaces an existing agent `auth.json` with the primary file.
5. [ ] Update `projectStructure.md` after any file additions/removals in this task.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build:clean`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 5. Client: Codex device-auth API helper

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Create a client API helper for `POST /codex/device-auth` with typed request/response handling and consistent error mapping for the UI dialog.

#### Documentation Locations

- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Codex auth + device auth: https://developers.openai.com/codex/auth
- TypeScript: https://www.typescriptlang.org/docs/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review existing API helpers and error handling patterns:
   - Files to read:
     - `client/src/api/agents.ts`
     - `client/src/api/baseUrl.ts`
     - `client/src/hooks/useChatModel.ts`
   - Key requirements (repeat):
     - Reuse existing `getApiBaseUrl` and error pattern from `agents.ts`.
2. [ ] Add a Codex device-auth API module:
   - Files to edit:
     - `client/src/api/codex.ts` (new)
   - Implementation details:
     - Export `postCodexDeviceAuth` that accepts `{ target: 'chat' | 'agent', agentName?: string }`.
     - Parse success responses to `{ status, verificationUrl, userCode, expiresInSec?, target, agentName? }`.
     - Throw a typed error object on non-200 responses (include `status` + `message`), preferring `message`/`reason` fields when provided.
3. [ ] Add a focused client unit test for the API helper:
   - Files to edit:
     - `client/src/test/codexDeviceAuthApi.test.ts` (new)
   - Test expectations:
     - `postCodexDeviceAuth` returns parsed data on 200.
     - Non-200 response throws a typed error with `status`.
4. [ ] Update `projectStructure.md` after any file additions/removals in this task.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build:clean`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 6. Client: CodexDeviceAuthDialog component

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Build a reusable dialog component that runs device-auth, shows loading/error/success states, and provides copy actions for the verification URL and user code.

#### Documentation Locations

- MUI Dialog API: https://mui.com/material-ui/api/dialog/
- MUI Select + TextField select pattern: https://mui.com/material-ui/react-select/
- MUI Select API (MenuItem children requirement): https://mui.com/material-ui/api/select/
- MUI Dialog + Button + Select patterns: MUI MCP
- React state + effect hooks: https://react.dev/reference/react
- Clipboard API: https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review existing dialog components for layout and state patterns:
   - Files to read:
     - `client/src/components/ingest/DirectoryPickerDialog.tsx`
     - `client/src/components/chat/CodexFlagsPanel.tsx` (UI style parity)
   - Key requirements (repeat):
     - Dialog should be centered and keyboard-accessible.
     - Inputs should be disabled while a request is in flight.
2. [ ] Implement `CodexDeviceAuthDialog`:
   - Files to edit:
     - `client/src/components/codex/CodexDeviceAuthDialog.tsx` (new)
   - Component props:
     - `open`, `onClose`, `defaultTarget`, `agents`, `onSuccess?`.
   - Implementation details:
     - Render a target selector with options `Chat` and `Agent: <name>`.
     - Use the `TextField select` pattern with `MenuItem` entries (matches existing Chat/Agents selects).
     - Ensure `MenuItem` entries are direct children of the select (per MUI Select API requirements).
     - Call `postCodexDeviceAuth` on “Start device auth”.
      - Show `verificationUrl`, `userCode`, and `expiresInSec` on success.
      - Provide copy buttons for URL + code (use `navigator.clipboard` with a fallback message when unavailable).
     - Display errors inline (including “Enable device code login in ChatGPT settings” when provided) and allow retry without closing the dialog.
      - Provide a clear close action (dialog close button + ESC/backdrop).
      - Ensure `onClose` handles `escapeKeyDown` and `backdropClick` reasons so standard close behaviors work.
      - Invoke `onSuccess` so parent pages can refresh provider availability.
      - Follow the async dialog state pattern from `DirectoryPickerDialog` (loading → success/error) instead of inventing new UI flows.
3. [ ] Add unit tests for the dialog:
   - Files to edit:
     - `client/src/test/codexDeviceAuthDialog.test.tsx` (new)
   - Test expectations:
     - Button disables while request is pending.
     - Success state renders the URL and code.
     - Error state renders the message and re-enables Start.
4. [ ] Update `projectStructure.md` after any file additions/removals in this task.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build:clean`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 7. Client: Chat page device-auth entry point

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Expose the re-authenticate button in Chat when Codex is selected + available, default the dialog target to Chat, and pass the available agent list to the dialog.

#### Documentation Locations

- MUI Button + Dialog patterns: MUI MCP
- MUI Dialog API: https://mui.com/material-ui/api/dialog/
- MUI Select + TextField select pattern: https://mui.com/material-ui/react-select/
- React state + effect hooks: https://react.dev/reference/react
- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review Chat page provider state and action layout:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatModel.ts`
     - `client/src/api/agents.ts`
   - Key requirements (repeat):
     - Button only appears when provider === `codex` and Codex is available.
2. [ ] Add the dialog wiring to Chat:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Implementation details:
     - Use the `providers` list from `useChatModel` to determine Codex availability (not the model `available` flag).
     - Fetch agents (via `listAgents`) when opening the dialog.
     - Pass `defaultTarget='chat'` and the agents list into `CodexDeviceAuthDialog`.
     - On dialog success, call `refreshProviders` (and `refreshModels` when Codex is selected) so availability updates immediately.
     - Hide the button when provider is LM Studio or Codex unavailable.
3. [ ] Add/extend chat page tests for the new button/dialog:
   - Files to edit:
     - `client/src/test/chatPage.provider.test.tsx` (or new `chatPage.deviceAuth.test.tsx`)
   - Test expectations:
     - Button only renders when `provider=codex` and `available=true`.
     - Clicking opens the dialog with Chat as the default target.
4. [ ] Update `projectStructure.md` after any file additions/removals in this task.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build:clean`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 8. Client: Agents page device-auth entry point

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Show the re-authenticate button on Agents when a selection is active and Codex is available, default the dialog target to the selected agent, and re-use the page’s agent list for the dialog.

#### Documentation Locations

- MUI Button + Dialog patterns: MUI MCP
- MUI Dialog API: https://mui.com/material-ui/api/dialog/
- MUI Select + TextField select pattern: https://mui.com/material-ui/react-select/
- React state + effect hooks: https://react.dev/reference/react
- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review Agents page selection + provider availability sources:
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/hooks/useChatModel.ts` (provider availability)
     - `client/src/api/agents.ts`
   - Key requirements (repeat):
     - Button appears only when `selectedAgentName` is set and Codex is available.
2. [ ] Add a Codex availability check for Agents:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - Reuse `useChatModel` to access `providers` + `refreshProviders`.
     - Derive Codex availability from the `providers` list instead of adding a new fetch hook.
3. [ ] Wire the dialog into Agents:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - Reuse the existing `agents` list for the dialog options.
     - Pass `defaultTarget` as the selected agent.
     - On dialog success, refresh Codex availability so the button state updates.
     - Hide the button when no agent is selected or Codex is unavailable.
4. [ ] Add/extend Agents page tests for the new button/dialog:
   - Files to edit:
     - `client/src/test/agentsPage.agentChange.test.tsx` (or new `agentsPage.deviceAuth.test.tsx`)
   - Test expectations:
     - Button only renders when an agent is selected and Codex is available.
     - Dialog defaults to `Agent: <selected>`.
5. [ ] Update `projectStructure.md` after any file additions/removals in this task.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build:clean`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 9. Final Task: Validate, document, and summarize

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Validate the story end-to-end, run clean builds/tests, update documentation, and prepare the pull request summary.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] Perform a clean Docker build
4. [ ] Ensure `README.md` is updated with any new commands or behavior changes
5. [ ] Ensure `design.md` reflects the device-auth flow (include diagrams if added)
6. [ ] Ensure `projectStructure.md` reflects all new/updated files
7. [ ] Create a PR summary comment covering all changes in this story

#### Testing

1. [ ] Run the client Jest tests
2. [ ] Run the server Cucumber tests
3. [ ] Restart the Docker environment
4. [ ] Run the e2e tests
5. [ ] Use Playwright MCP to manually verify:
   - Chat page shows the device-auth button for Codex and the dialog works.
   - Agents page shows the device-auth button for a selected agent and the dialog works.
   - Save screenshots to `test-results/screenshots` using the required naming convention.

#### Implementation notes

- 

---
