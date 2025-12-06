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

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose Codex `sandboxMode` choices in the UI (Codex-only) and forward them to the server Codex call; LM Studio must ignore the parameter.

#### Documentation Locations
- Codex exec flags: https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts
- Codex `SandboxMode` enum: https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- design.md (chat/MCP flow)

#### Subtasks
1. [ ] Server (`server/src/routes/chat.ts` + `server/src/routes/chatValidators.ts`): extend the Codex request schema to accept `sandboxMode` (enum import from `@openai/codex-sdk/dist/threadOptions`). Default to `workspace-write` when omitted; reject when provider≠codex. Forward via the Codex options object, e.g.
   ```ts
   const sandboxMode = body.sandboxMode ?? SandboxMode.WorkspaceWrite;
   const codexOpts = { ...baseOpts, sandboxMode };
   ```
2. [ ] Server tests (`server/src/test/integration/chat-codex-mcp.test.ts`): add scenarios: missing -> default `workspace-write`; invalid enum -> 400; valid value -> SSE shows forwarded value (inspect mocked Codex call args).
3. [ ] Client UI (`client/src/pages/ChatPage.tsx`, new `client/src/components/chat/CodexFlagsPanel.tsx` under Provider/Model row): render a dropdown populated from enum values returned by `/chat/models?provider=codex` (or a dedicated enums endpoint); default shown `workspace-write`; helper text “Controls Codex sandbox permissions (ignored for LM Studio)”.
4. [ ] Client state (`client/src/hooks/useChatStream.ts` or the send payload builder): include `sandboxMode` only when provider=codex; reset to default on provider switch/New conversation; keep current choice within the active Codex session.
5. [ ] Client tests (`client/src/test/chatPage.flags.sandbox.test.tsx`): mock enum response, assert default `workspace-write`, user selection persists within session, payload includes selection only for codex, resets on provider change.
6. [ ] Docs: README.md and design.md describe sandbox selector, default `workspace-write`, and LM Studio ignore behaviour (duplicate explicitly).
7. [ ] Lint/format touched packages.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (Codex mocks acceptable)

#### Implementation notes
- 

---

### 2. Network access toggle (`--config sandbox_workspace_write.network_access`)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Allow users to enable/disable network access for Codex sandboxes per request; server forwards boolean to Codex.

#### Documentation Locations
- Codex exec flags: https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts
- design.md (compose/env and Codex flow)

#### Subtasks
1. [ ] Server (`server/src/routes/chat.ts` + validator file): accept optional boolean `networkAccessEnabled` when provider=codex; default `true`; reject/strip for LM Studio. Forward in Codex options: `networkAccessEnabled: body.networkAccessEnabled ?? true`.
2. [ ] Server tests (`server/src/test/integration/chat-codex-mcp.test.ts`): cases for default true, explicit false, LM Studio rejection.
3. [ ] Client UI (Codex flags panel): add MUI `Switch` labeled “Enable network access”; helper text about sandbox networking risk; default ON.
4. [ ] Client state/payload: include only for provider=codex; reset to default on provider switch/New conversation.
5. [ ] Client tests (`client/src/test/chatPage.flags.network.test.tsx`): assert default ON, toggle updates payload, omitted for LM Studio.
6. [ ] Docs: README/design repeat default `true` and LM Studio ignore.
7. [ ] Lint/format touched packages.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`

#### Implementation notes
- 

---

### 3. Web search toggle (`--config features.web_search_request`)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose Codex web search enable/disable as a per-request flag, defaulting to enabled (`true`).

#### Documentation Locations
- Codex exec flags: https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts
- design.md (chat tooling)

#### Subtasks
1. [ ] Server (`server/src/routes/chat.ts` + validator): optional `webSearchEnabled` boolean when provider=codex; default `true`; reject/strip for LM Studio; forward to Codex options: `webSearchEnabled: body.webSearchEnabled ?? true`.
2. [ ] Server tests (`server/src/test/integration/chat-codex-mcp.test.ts`): default true, explicit false, LM Studio rejection.
3. [ ] Client UI (Codex flags panel): MUI `Switch` “Enable web search”; helper text about data usage; default ON.
4. [ ] Client state/payload: include only for provider=codex; reset to default on provider switch/New conversation.
5. [ ] Client tests (`client/src/test/chatPage.flags.websearch.test.tsx`): default ON, toggle behaviour, payload inclusion/exclusion.
6. [ ] Docs: README/design repeat default `true` and LM Studio ignore.
7. [ ] Lint/format touched packages.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`

#### Implementation notes
- 

---

### 4. Approval policy selector (`--config approval_policy`)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Let users pick Codex approval policy per request (e.g., `auto`, `always`, `never`) via UI, validated server-side.

#### Documentation Locations
- Codex `ApprovalMode` enum: https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- exec flags reference

#### Subtasks
1. [ ] Server (`server/src/routes/chat.ts` + validator): accept optional `approvalPolicy` enum (import `ApprovalMode` from `threadOptions`); default `on-failure`; reject/strip for LM Studio; forward to Codex options.
2. [ ] Server tests (`server/src/test/integration/chat-codex-mcp.test.ts`): default `on-failure`, invalid enum 400, valid forwarding.
3. [ ] Client UI (Codex flags panel): dropdown populated from API enum values; default `on-failure`; helper text explaining policies.
4. [ ] Client state/payload: include only for provider=codex; reset on provider switch/New conversation.
5. [ ] Client tests (`client/src/test/chatPage.flags.approval.test.tsx`): options from API, default `on-failure`, payload inclusion, reset behaviour.
6. [ ] Docs: README/design repeat options, default `on-failure`, LM Studio ignore.
7. [ ] Lint/format touched packages.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`

#### Implementation notes
- 

---

### 5. Model reasoning effort (`--config model_reasoning_effort`)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose Codex `modelReasoningEffort` enum (e.g., `low|medium|high`) for Codex requests, with validation and default `high`.

#### Documentation Locations
- Codex `ModelReasoningEffort` enum: https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts
- exec flags reference

#### Subtasks
1. [ ] Server (`server/src/routes/chat.ts` + validator): optional `modelReasoningEffort` enum (import `ModelReasoningEffort` from `threadOptions`); default `high`; reject/strip for LM Studio; forward to Codex options.
2. [ ] Server tests (`server/src/test/integration/chat-codex-mcp.test.ts`): default `high`, invalid enum 400, valid forwarding.
3. [ ] Client UI (Codex flags panel): dropdown from API enum values; default `high`; helper text on cost/quality.
4. [ ] Client state/payload: include only for provider=codex; reset on provider switch/New conversation.
5. [ ] Client tests (`client/src/test/chatPage.flags.reasoning.test.tsx`): options from API, default `high`, payload inclusion, reset.
6. [ ] Docs: README/design repeat options, default `high`, LM Studio ignore.
7. [ ] Lint/format touched packages.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`

#### Implementation notes
- 

---

### 6. Final validation and release checklist

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Validate all Codex flag controls end-to-end, ensure docs and structure are up to date, and prepare PR summary/screenshots per plan_format guidance.

#### Documentation Locations
- README.md, design.md, projectStructure.md
- plan_format.md final-task expectations

#### Subtasks
1. [ ] Build server: `npm run build --workspace server`
2. [ ] Build client: `npm run build --workspace client`
3. [ ] Clean docker build: `npm run compose:build`
4. [ ] Start compose and health-check: `npm run compose:up`, verify `curl http://localhost:5010/health` and client root, then `npm run compose:down`
5. [ ] Run tests: `npm run test --workspace server`; `npm run test --workspace client`; `npm run e2e`
6. [ ] Update README/design/projectStructure with final flag support details and any new files.
7. [ ] Capture screenshots to `test-results/screenshots/0000011-06-*.png` showing Codex flags panel (under Provider/Model row) and a successful Codex request with flags applied.
8. [ ] Prepare PR summary capturing all changes across tasks.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`

#### Implementation notes
- 
