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
1. [ ] Server: add optional `sandboxMode` param for provider=codex in `/chat` request schema; validate against allowed enum; pass through to Codex exec/SDK; default to `workspace-write`.
2. [ ] Client: show a dropdown of sandbox modes in Codex-only settings; default selection = `workspace-write`.
3. [ ] Client: ensure selection resets on provider change/New conversation; persist within current Codex session.
4. [ ] Tests: add server validation test for sandboxMode; add client RTL test for the dropdown rendering + payload.
5. [ ] Docs: note sandbox control in README/design, and state it is ignored for LM Studio.
6. [ ] Lint/format touched packages.

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
1. [ ] Server: accept optional boolean `networkAccessEnabled` for provider=codex; default to `true`; reject for LM Studio.
2. [ ] Client: add toggle in Codex settings; include help text about sandbox networking risk; default ON (`true`).
3. [ ] Client: ensure value included in Codex payload and omitted otherwise.
4. [ ] Tests: server validation test; client RTL test verifying toggle -> payload.
5. [ ] Docs: update README/design with network access control and defaults.
6. [ ] Lint/format touched packages.

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
1. [ ] Server: add optional `webSearchEnabled` boolean (Codex only), validate, default to `true`, and forward to exec options.
2. [ ] Client: add toggle in Codex settings with hint about network/data usage; default ON (`true`).
3. [ ] Tests: server validation; client RTL for toggle + payload; e2e mock to ensure flag passes through.
4. [ ] Docs: mention web search toggle and default.
5. [ ] Lint/format touched packages.

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
1. [ ] Server: accept optional `approvalPolicy` enum for provider=codex; validate; default to `on-failure`; pass through.
2. [ ] Client: add dropdown/select in Codex settings with default `on-failure`.
3. [ ] Tests: server validation + payload mapping; client RTL for select + New conversation reset.
4. [ ] Docs: clarify available policies and defaults.
5. [ ] Lint/format touched packages.

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
1. [ ] Server: add optional `modelReasoningEffort` enum for provider=codex; validate; default to `high`; forward to exec.
2. [ ] Client: dropdown in Codex settings; default to `high`.
3. [ ] Tests: server validation; client RTL for select + payload.
4. [ ] Docs: describe effect and defaults.
5. [ ] Lint/format touched packages.

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
7. [ ] Capture screenshots to `test-results/screenshots/0000011-06-*.png` showing Codex flags panel and successful Codex request.
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
