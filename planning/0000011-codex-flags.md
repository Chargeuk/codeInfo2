# Story 0000011 – Codex CLI flag controls

## Description
Expose the remaining Codex CLI execution flags (from `sdk/typescript/src/exec.ts`) as optional, per-request controls that appear only when the provider is **OpenAI Codex**. The server should accept these options, forward them to Codex calls, and ignore them for LM Studio. The client should surface a dedicated Codex settings panel so users can toggle/choose values per message without breaking existing defaults.

## Acceptance Criteria
- When provider=Codex, the chat UI shows a collapsible "Codex flags" panel with controls for each supported flag: sandbox mode, network access, web search, approval policy, and model reasoning effort, rendered immediately below the Provider/Model row.
- Server `/chat` accepts the corresponding optional parameters only for provider=codex and passes them through to the Codex exec/SDK options; LM Studio requests ignore them safely.
- Each flag is validated on the server (enum/boolean/array/file) with clear error responses; invalid inputs never reach the Codex CLI.
- Flags default to the agreed values (sandboxMode=workspace-write, approvalPolicy=on-failure, modelReasoningEffort=high, networkAccessEnabled=true, webSearchEnabled=true) with no regression to LM Studio requests when unset on Codex.
- Client state resets Codex flag selections on "New conversation" but preserves them while a Codex conversation is active.
- Documentation (README/design) and plan tasks list which flags are intentionally **not** exposed (`--model`, `--cd`, `--add-dir`, `--skip-git-repo-check`, `--output-schema`, `AbortSignal`, base URL override, API key override, images).

## Out Of Scope
- Changing the default Codex model selection or LM Studio behaviour.
- Persisting Codex flag choices across browser sessions (in-memory only unless later requested).
- API key overrides (leave current behaviour unchanged).
- Base URL overrides (leave current behaviour unchanged).
- Image attachments/`--image` handling (no changes from current behaviour).
- Any new MCP tools.

## Questions / Decisions
1. Enum sources: surface the full enum option sets for `SandboxMode`, `ApprovalMode`, and `ModelReasoningEffort` directly from the Codex SDK (`threadOptions` types) instead of hard-coding values.
2. Defaults (per stakeholder):
   - `approvalPolicy` default → `on-failure`.
   - `sandboxMode` default → `workspace-write`.
   - `modelReasoningEffort` default → `high`.
   - `networkAccessEnabled` default → `true`.
   - `webSearchEnabled` default → `true`.
3. Out-of-scope confirmations: API key override, base URL override, and image handling stay as-is; no behavioural changes in this story.
4. Open: none currently.

# Implementation Plan

## Instructions
1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit & push that change, and only then begin implementation.
4. For each task, execute every subtask sequentially: before starting a subtask, read the documentation sources listed in that task; after finishing the subtask, run the relevant linters/formatters and fix issues before continuing.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, move on to the Testing section and work through the tests in order.
7. Once a test is complete, mark its checkbox.
8. After tests pass, perform every documentation update listed for the task.
9. Once a document is updated, mark its checkbox.
10. When all subtasks, tests, documentation updates, and verification commands are complete, consider the task finished and follow points 11–13 below.
11. As soon as a task’s implementation is done, add detailed notes in the Implementation notes section covering the code changes, decisions made, and any issues encountered. Push immediately after writing the notes.
12. Record the relevant git commit hash(es) in the Git Commits section. Once they are pushed, set the task status to `Done`, and push again so both the commit IDs and updated status are captured in this document.
13. After a task is fully documented (status, notes, commits), proceed to the next task and repeat the same process.

---

### 1. Sandbox mode selector (`--sandbox`)

- Task Status: __done__
- Git Commits: 16aa978

#### Overview
Expose Codex `sandboxMode` choices in the UI (Codex-only) and forward them to the server Codex call; LM Studio must ignore the parameter.

#### Documentation Locations
- Codex exec flags (source of supported CLI options): https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts
- Codex `threadOptions` enums (authoritative enum names/values): https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- MUI Select API (dropdown component used in UI): https://mui.com/material-ui/react-select/

#### Subtasks
1. [x] Server validation update (`server/src/routes/chatValidators.ts`): extend schema to include optional `sandboxMode` using `SandboxMode` from `@openai/codex-sdk/dist/threadOptions`; default `SandboxMode.WorkspaceWrite` when absent; if present while `provider !== 'codex'`, log a warning and strip it instead of erroring. Include payload examples in comments for juniors.
2. [x] Server handler update (`server/src/routes/chat.ts`): when `provider === 'codex'`, add `sandboxMode` (with default) to Codex options; when provider is LM Studio drop the field and log a warning about ignoring Codex-only flags.
3. [x] Server integration tests (`server/src/test/integration/chat-codex-mcp.test.ts`):
   - omitted `sandboxMode` -> Codex call receives `SandboxMode.WorkspaceWrite`.
   - invalid string -> HTTP 400 with clear message and no Codex call.
   - explicit `SandboxMode.FullAccess` (or any non-default enum) -> forwarded to Codex call options; SSE stream completes.
   - LM Studio request with `sandboxMode` -> 200 OK, flag not forwarded, warning logged/asserted.
4. [x] Client component: create `client/src/components/chat/CodexFlagsPanel.tsx` exporting a panel rendered immediately under the Provider/Model row in `client/src/pages/ChatPage.tsx`; include a `Select` populated from enum values returned by the provider, label “Sandbox mode”, helper text “Controls Codex sandbox permissions (ignored for LM Studio).”
5. [x] Client wiring: in `ChatPage.tsx` pass the sandbox state/handlers into `CodexFlagsPanel`; ensure the panel renders only when `provider === 'codex'` but the state lives alongside other chat form state so it survives within a Codex session.
6. [x] Client state/payload (`client/src/hooks/useChatStream.ts` send builder): include `sandboxMode` in the POST body only when provider is codex; default to `SandboxMode.WorkspaceWrite` on initial load and when the provider switches away and back or when “New conversation” is clicked.
7. [x] Client tests (RTL): add `client/src/test/chatPage.flags.sandbox.default.test.tsx` covering render + default value + helper text; add `client/src/test/chatPage.flags.sandbox.payload.test.tsx` asserting payload contains chosen value only for codex; add `client/src/test/chatPage.flags.sandbox.reset.test.tsx` asserting provider change/New conversation resets to default.
8. [x] Docs: README.md — Chat/Codex section: describe Sandbox mode selector, enum options, default `workspace-write`, and LM Studio ignore note; include a one-line payload example showing `sandboxMode` in the request.
9. [x] Docs: design.md — duplicate the same sandbox description and default in the chat/Codex subsection so a dev sees it even without README.
10. [x] Lint/format: Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing
1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Using the Playwright mcp tool, Manual UI check for this task's implemented functionality. Do NOT miss this step!
9. [x] `npm run compose:down`

#### Implementation notes
- Added `chatValidators` to sanitize chat bodies, apply Codex sandbox defaults, and log warnings when Codex-only flags appear on non-Codex providers; chat route now uses the validator, logs warnings, and forwards sandboxMode into thread options.
- Extended Codex integration tests to cover default/invalid/custom sandbox values and LM Studio ignore+warning; reordered imports to satisfy lint.
- Client now renders a Codex flags accordion with sandbox select, manages sandbox state/reset on provider changes and new conversation, and sends sandboxMode on Codex requests; useChatStream accepts Codex flags; three RTL suites cover default render, payload inclusion, and reset flows.
- Docs updated (README/design) to describe the Codex flags panel, options, default, and LM Studio ignore note; projectStructure lists new files/tests.
- Testing: server+client builds/tests, e2e suite, compose:build/up/down all ran.
- Manual UI check completed via Playwright MCP against `http://localhost:5001/chat`: switched provider to OpenAI Codex, verified Codex flags accordion renders with sandbox default `workspace-write` helper, and confirmed compose stack brought up/down cleanly for the check.

---

### 2. Network access toggle (`--config sandbox_workspace_write.network_access`)

- Task Status: __in_progress__
- Git Commits: __to_do__

#### Overview
Allow users to enable/disable network access for Codex sandboxes per request; server forwards boolean to Codex.

#### Documentation Locations
- Codex exec flags (source of supported CLI options): https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts
- Codex `threadOptions` enums (authoritative enum names/values): https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- MUI Switch API (toggle component used in UI): https://mui.com/material-ui/react-switch/

#### Subtasks
1. [x] Server validation (`server/src/routes/chatValidators.ts`): add optional boolean `networkAccessEnabled`; default `true`; if present with non-codex provider, log a warning and strip it instead of erroring; keep examples in comments.
2. [x] Server handler (`server/src/routes/chat.ts`): when provider is codex, forward `networkAccessEnabled` (default `true`) in Codex options; when provider is LM Studio, drop the field and log the ignore.
3. [x] Server integration tests (`server/src/test/integration/chat-codex-mcp.test.ts`):
   - omitted -> Codex call args show `networkAccessEnabled: true`.
   - explicit false -> Codex call receives `false`.
   - LM Studio request containing the field -> succeeds (no 400), flag absent from LM Studio call, warning logged/asserted.
4. [x] Client UI (`client/src/components/chat/CodexFlagsPanel.tsx`): add a `Switch` with label “Enable network access” and helper text “Allows Codex sandbox network access (ignored for LM Studio)”; default checked.
5. [x] Client wiring/state (`client/src/pages/ChatPage.tsx` + `client/src/hooks/useChatStream.ts`): hold `networkAccessEnabled` in chat state, include in payload only for codex, reset to `true` on provider change or New conversation; keep current value while staying on Codex provider.
6. [x] Client tests (RTL):
   - `client/src/test/chatPage.flags.network.default.test.tsx` verifies default ON + helper text.
   - `client/src/test/chatPage.flags.network.payload.test.tsx` ensures payload carries the boolean for codex and is absent for LM Studio.
   - include reset behaviour in the reset test file if not covered elsewhere.
7. [x] Docs: README.md — add a bullet in the Chat/Codex section for “Network access” with default `true`, what it does, and that LM Studio ignores it; show a JSON snippet with `"networkAccessEnabled": false`.
8. [x] Docs: design.md — duplicate the same description/default/ignore note.
9. [x] Lint/format: Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing
1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Using the Playwright mcp tool, Manual UI check for this task's implemented functionality. Do NOT miss this step!
9. [x] `npm run compose:down`

#### Implementation notes
- Added server validation for `networkAccessEnabled` with defaults/warnings and forwarded flag into Codex thread options; integration tests cover default, invalid, explicit false, and LM Studio ignore paths.
- Codex flags panel now includes a network access switch, wired through chat state/reset and Codex payloads so LM Studio requests omit the flag; new RTL suites cover default render, payload include/exclude, and reset to default.
- Docs (README/design) now list the network access flag and example payload; lint/format + full test matrix (server/client builds & tests, e2e, compose build/up/down, manual Playwright MCP UI check) completed.

---

### 3. Web search toggle (`--config features.web_search_request`)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose Codex web search enable/disable as a per-request flag, defaulting to enabled (`true`).

#### Documentation Locations
- Codex exec flags (source of supported CLI options): https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts
- Codex `threadOptions` enums (authoritative enum names/values): https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- MUI Switch API (toggle component used in UI): https://mui.com/material-ui/react-switch/

#### Subtasks
1. [ ] Server validation (`server/src/routes/chatValidators.ts`): add optional boolean `webSearchEnabled`; default `true`; if provided for a non-codex provider, log a warning and strip it (no 400); include examples in comments.
2. [ ] Server handler (`server/src/routes/chat.ts`): when provider is codex, add `webSearchEnabled` (default `true`) to Codex options; when provider is LM Studio, drop the field and log that it was ignored.
3. [ ] Server integration tests (`server/src/test/integration/chat-codex-mcp.test.ts`):
   - omitted -> Codex call gets `webSearchEnabled: true`.
   - explicit false -> Codex call gets `false`.
   - LM Studio with the flag -> succeeds (no 400), flag not forwarded, warning logged/asserted.
4. [ ] Client UI (`client/src/components/chat/CodexFlagsPanel.tsx`): add a `Switch` labeled “Enable web search” with helper “Allows Codex to issue web search requests (ignored for LM Studio)”; default checked.
5. [ ] Client wiring/state (`client/src/pages/ChatPage.tsx` + `client/src/hooks/useChatStream.ts`): track `webSearchEnabled`, include it in payload only for codex, default to true, reset to true on provider change or New conversation.
6. [ ] Client tests (RTL): add `client/src/test/chatPage.flags.websearch.default.test.tsx` (render + default + helper), `client/src/test/chatPage.flags.websearch.payload.test.tsx` (payload include/exclude), and cover reset behaviour.
7. [ ] Docs: README.md — Chat/Codex section bullet for Web search with default `true`, what it enables, LM Studio ignore note, plus a JSON example showing `"webSearchEnabled": false`.
8. [ ] Docs: design.md — duplicate the same description/default/ignore note.
9. [ ] Lint/format: Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, Manual UI check for this task's implemented functionality. Do NOT miss this step!
9. [ ] `npm run compose:down`

#### Implementation notes
- 

---

### 4. Approval policy selector (`--config approval_policy`)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Let users pick Codex approval policy per request (e.g., `auto`, `always`, `never`) via UI, validated server-side.

#### Documentation Locations
- Codex `ApprovalMode` enum (authoritative values): https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- Codex exec flags reference (how approval maps into CLI/exec): https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts
- MUI Select API (dropdown component used in UI): https://mui.com/material-ui/react-select/

#### Subtasks
1. [ ] Server validation (`server/src/routes/chatValidators.ts`): add optional `approvalPolicy` enum using `ApprovalMode` from `@openai/codex-sdk/dist/threadOptions`; default `ApprovalMode.OnFailure`; if provided for non-codex provider, log a warning and strip instead of erroring; keep enum values listed for copy/paste.
2. [ ] Server handler (`server/src/routes/chat.ts`): when provider is codex, forward `approvalPolicy` (default applied) in Codex options; for LM Studio drop the field and log an ignore.
3. [ ] Server integration tests (`server/src/test/integration/chat-codex-mcp.test.ts`):
   - omitted -> Codex call receives `ApprovalMode.OnFailure`.
   - invalid value -> 400 and Codex not invoked.
   - explicit valid value -> forwarded to Codex call options and reflected in captured args.
   - LM Studio with `approvalPolicy` -> succeeds, field absent from LM Studio call, warning logged/asserted.
4. [ ] Client UI (`client/src/components/chat/CodexFlagsPanel.tsx`): add a `Select` labeled “Approval policy” listing enum options, default `on-failure`, helper “Codex action approval behaviour (ignored for LM Studio).” Place in the Codex panel under Provider/Model.
5. [ ] Client wiring/state (`client/src/pages/ChatPage.tsx` + `client/src/hooks/useChatStream.ts`): hold `approvalPolicy`, include only for codex payloads, reset to default on provider change or New conversation, keep current choice within active Codex session.
6. [ ] Client tests (RTL): add `client/src/test/chatPage.flags.approval.default.test.tsx` (render + default), `client/src/test/chatPage.flags.approval.payload.test.tsx` (payload include/exclude), and cover reset behaviour.
7. [ ] Docs: README.md — add approval policy bullet with enum options and default `on-failure`, note LM Studio ignore, and include a JSON example showing `"approvalPolicy": "always"`.
8. [ ] Docs: design.md — duplicate the approval description/default/ignore note.
9. [ ] Lint/format: Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, Manual UI check for this task's implemented functionality. Do NOT miss this step!
9. [ ] `npm run compose:down`

#### Implementation notes
- 

---

### 5. Model reasoning effort (`--config model_reasoning_effort`)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose Codex `modelReasoningEffort` enum (e.g., `low|medium|high`) for Codex requests, with validation and default `high`.

#### Documentation Locations
- Codex `ModelReasoningEffort` enum (authoritative values): https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- Codex exec flags reference (how reasoning effort maps into CLI/exec): https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts
- MUI Select API (dropdown component used in UI): https://mui.com/material-ui/react-select/

#### Subtasks
1. [ ] Server validation (`server/src/routes/chatValidators.ts`): add optional `modelReasoningEffort` enum using `ModelReasoningEffort` from `@openai/codex-sdk/dist/threadOptions`; default `ModelReasoningEffort.High`; if provided for non-codex provider, log a warning and strip instead of erroring; list enum options inline for copy/paste.
2. [ ] Server handler (`server/src/routes/chat.ts`): forward `modelReasoningEffort` (default applied) in Codex options when provider is codex; drop and log ignore for LM Studio requests.
3. [ ] Server integration tests (`server/src/test/integration/chat-codex-mcp.test.ts`):
   - omitted -> Codex call includes `modelReasoningEffort: ModelReasoningEffort.High`.
   - invalid -> 400 and no Codex call.
   - explicit `low|medium|high` -> forwarded to Codex call options.
   - LM Studio with the field -> succeeds, field not forwarded, warning logged/asserted.
4. [ ] Client UI (`client/src/components/chat/CodexFlagsPanel.tsx`): add `Select` labeled “Reasoning effort” with enum options, default `high`, helper “Higher effort may improve quality at more cost (ignored for LM Studio).”
5. [ ] Client wiring/state (`client/src/pages/ChatPage.tsx` + `client/src/hooks/useChatStream.ts`): store `modelReasoningEffort`, send only for codex, default to `high`, reset to default on provider change or New conversation while preserving within active Codex sessions.
6. [ ] Client tests (RTL): add `client/src/test/chatPage.flags.reasoning.default.test.tsx` (render + default), `client/src/test/chatPage.flags.reasoning.payload.test.tsx` (payload include/exclude + reset behaviour).
7. [ ] Docs: README.md — add reasoning effort bullet with options and default `high`, LM Studio ignore note, and a JSON example showing `"modelReasoningEffort": "low"`.
8. [ ] Docs: design.md — duplicate the reasoning description/default/ignore note.
9. [ ] Lint/format: Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, Manual UI check for this task's implemented functionality. Do NOT miss this step!
9. [ ] `npm run compose:down`

#### Implementation notes
- 

---

### 6. Final validation and release checklist

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Validate all Codex flag controls end-to-end, ensure docs and structure are up to date, and prepare PR summary/screenshots per plan_format guidance.

#### Documentation Locations
- Docker Compose reference (build/up/down commands used in validation): https://docs.docker.com/compose/
- Playwright docs (e2e tests and screenshots): https://playwright.dev/docs/intro
- Jest docs (client/server unit tests): https://jestjs.io/docs/getting-started
- npm workspaces reference (workspace build/test commands): https://docs.npmjs.com/cli/v9/using-npm/workspaces

#### Subtasks
1. [ ] Build server: `npm run build --workspace server` (confirm succeeds after all flag changes).
2. [ ] Build client: `npm run build --workspace client` (ensures new CodexFlagsPanel and wiring compile).
3. [ ] Clean docker build: `npm run compose:build` to verify images still build with new code.
4. [ ] Start compose: `npm run compose:up`; verify `curl http://localhost:5010/health` returns 200 and open client root (http://localhost:5001) loads; then `npm run compose:down`.
5. [ ] Tests: run `npm run test --workspace server`, `npm run test --workspace client`, and `npm run e2e` (confirm Codex flag-related specs pass); record results in Implementation notes.
6. [ ] Docs update - README.md: in Chat/Codex section, list each flag (sandboxMode, networkAccessEnabled, webSearchEnabled, approvalPolicy, modelReasoningEffort), defaults, LM Studio ignore note, and include one JSON request example showing all flags.
7. [ ] Docs update - design.md: duplicate the same flag list/defaults/ignore note and UI placement under Provider/Model row (even if repeated from README).
8. [ ] Docs update - projectStructure.md: add any new files (e.g., `client/src/components/chat/CodexFlagsPanel.tsx`, new test files) with brief comments.
9. [ ] Screenshots: capture after running `npm run compose:up` or local dev — store in `test-results/screenshots/` with names `0000011-06-flags-panel.png` (show Codex flags panel open) and `0000011-06-codex-send.png` (show a Codex message sent with non-default flag values visible). Ensure files are committed.
10. [ ] Lint/format: Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the Playwright mcp tool, Manual UI check for this story's acceptance & implemented functionality. Do NOT miss this step!
9. [ ] `npm run compose:down`

#### Implementation notes
- 
