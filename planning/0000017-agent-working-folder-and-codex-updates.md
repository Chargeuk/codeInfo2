# Story 0000017 – Agent working_folder + Codex model/reasoning updates

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

It expands the existing Agents feature (Story `0000016`) with:

1. A new optional parameter `working_folder` for agent runs (GUI + REST + MCP `5012`).
2. Updated Codex model + reasoning-effort options:
   - Add Codex model `gpt-5.2` to the fixed Codex model list returned by `/chat/models?provider=codex`.
   - Add a new reasoning effort option `xhigh` (the new highest option) anywhere we present/validate Codex reasoning effort.

Agents must continue to be Codex-only and config-driven (agent `config.toml` remains the source of truth for runtime defaults like sandbox/approval/reasoning/network/websearch when `useConfigDefaults` is enabled).

---

## Description

Today, agent runs always execute with the server’s configured Codex working directory (typically `CODEX_WORKDIR` / `CODEINFO_CODEX_WORKDIR` / `/data`). This makes it awkward to run an agent “from inside” a particular repository folder when the host has multiple ingest roots or multiple nested projects.

We want to allow the caller (Agents GUI or Agents MCP) to optionally provide a `working_folder` so the agent executes as-if it was started from that directory.

The `working_folder` should be treated as a **host path** by default and mapped into the server/Codex working directory when possible. If the mapped path does not exist (or mapping is not possible), we then fall back to treating the input as a literal path in the server runtime. If neither exists, we return a clear error to the caller.

Separately, we need to keep Codex UI/options up to date by adding `gpt-5.2` and a new highest reasoning effort `xhigh`.

---

## Acceptance Criteria

- Agents: new optional `working_folder` parameter is supported end-to-end:
  - Agents GUI can set `working_folder` when running an instruction.
  - REST `POST /agents/:agentName/run` accepts `working_folder`.
  - Agents MCP `run_agent_instruction` accepts `working_folder`.
  - When omitted/empty, existing behavior remains unchanged.
- `working_folder` resolution logic:
  1. Treat input as a **host path** first.
  2. Attempt to map it via:
     - compute `rel = relative( HOST_INGEST_DIR, working_folder )`
     - compute `mapped = join( CODEX_WORKDIR || CODEINFO_CODEX_WORKDIR || '/data', rel )`
     - if `mapped` exists **and is a directory**, use it as the Codex `workingDirectory` for this call.
  3. If the mapped path does not exist, check `working_folder` **as provided** (no mapping) and:
     - if it exists **and is a directory**, use it as the Codex `workingDirectory` for this call.
  4. If neither candidate exists, return an error:
     - REST returns `400` with a stable error code (and a safe, human-readable message).
     - MCP returns a JSON-RPC tool error that callers can treat as invalid params (and includes a safe message).
- Security/safety:
  - The mapping attempt must not allow escaping `CODEINFO_CODEX_WORKDIR` via `..` segments when the host path is outside `HOST_INGEST_DIR` (i.e. mapping must be skipped or rejected when `working_folder` is not under `HOST_INGEST_DIR`).
  - The server must not crash on odd path separators; normalization should be consistent across host/container paths.
- Input rules:
  - `working_folder` must be an **absolute** path (POSIX or Windows). Relative paths are rejected with a `400`/invalid-params error.
  - If `HOST_INGEST_DIR` is not set, the host-path mapping attempt is skipped and only the literal path check is performed.
- Codex model list:
  - `/chat/models?provider=codex` includes `gpt-5.2` in addition to the existing fixed Codex models.
  - Client UI that relies on the Codex model list continues to function; tests updated accordingly.
- Codex reasoning effort:
  - Any Codex reasoning-effort dropdown/validation includes `xhigh` as the new highest option.
  - Existing defaults remain unchanged (`high` stays the default).
- Documentation:
  - `README.md`, `design.md`, and `projectStructure.md` are updated to reflect:
    - the new `working_folder` parameter and its resolution/mapping rules
    - the new Codex model `gpt-5.2` and reasoning effort `xhigh`

---

## Out Of Scope

- Adding provider/model selection controls for agents.
- Changing the agent discovery folder conventions (`CODEINFO_CODEX_AGENT_HOME/<agentName>`).
- Changing non-agent chat working directory behavior.
- Adding new MCP tools beyond expanding `run_agent_instruction`.
- Changing how ingest roots are discovered or mounted; this story only uses existing env (`HOST_INGEST_DIR`, `CODEX_WORKDIR` / `CODEINFO_CODEX_WORKDIR`).

---

## Questions

- **Resolved**: Use wire name `working_folder` for GUI + MCP + REST. REST will accept both `working_folder` and `workingFolder` (alias) but will *emit/send* `working_folder`.
- **Simplified**: Support only `working_folder` (no alias). This avoids ambiguity and keeps both REST and MCP aligned.
- **Resolved**: If `HOST_INGEST_DIR` is unset, skip mapping and only attempt the literal path check.
- **Resolved**: Require `working_folder` to be an absolute path; reject relative inputs for predictability.
- **Resolved**: Defaults remain unchanged (Codex reasoning default stays `high`; no reorder of model list beyond appending `gpt-5.2`).
- **Resolved**: `gpt-5.2` is added as a new fixed model id alongside existing models (no new `gpt-5.2-*` variants in this story).
- **Discovered constraint (source of truth: this repo + upstream docs)**:
  - The installed `@openai/codex-sdk` exposes `ModelReasoningEffort` as `minimal|low|medium|high` (no `xhigh`).
  - The upstream Codex CLI config docs also only document `model_reasoning_effort` as `minimal|low|medium|high`.
  - Therefore this story implements `xhigh` as an **app-level** option that is **accepted and persisted** but **mapped to `high` at the Codex SDK boundary** (so we don’t rely on undocumented/unsupported runtime behavior). If/when upstream adds `xhigh`, we can remove the mapping.

---

# Implementation Plan

## Instructions

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

# Tasks

### 1. Extend path mapping for working_folder (host → workdir)

- Task Status: __to_do__
- Git Commits:

#### Overview

Reuse and extend the existing ingest path mapping module to support mapping an agent-run `working_folder` from a host path into the Codex workdir, including traversal guards and unit tests.

#### Documentation Locations

- Node.js `path` + `fs` docs (built-in): for cross-platform path normalization and existence checks.
- Existing mapping helper: `server/src/ingest/pathMap.ts` (reuse this module for host↔container mapping).

#### Subtasks

1. [ ] Read `server/src/ingest/pathMap.ts` and `server/src/test/unit/pathMap.test.ts` to align naming and existing expectations.
2. [ ] Extend `server/src/ingest/pathMap.ts` with a new exported helper to map host → workdir, e.g.:
   - add a new exported helper (name explicit) to map host → container/workdir, e.g.:
     - `mapHostToWorkdir(hostPath: string, opts?: { hostIngestDir?: string; workdir?: string }): { mappedPath: string; relPath: string } | { error: { code: 'OUTSIDE_HOST_INGEST_DIR' | 'HOST_INGEST_DIR_UNSET' | 'INVALID_ABSOLUTE_PATH'; message: string } }`
   - implement the mapping algorithm in Acceptance Criteria (including “skip mapping if outside host ingest root” safety).
   - add traversal guards so `..` cannot escape the workdir when mapping is applied.
   - KISS: do **not** change existing `mapIngestPath` behavior in this story; implement only the new host→workdir helper needed for `working_folder`.
3. [ ] Add/extend server unit tests by reusing `server/src/test/unit/pathMap.test.ts`:
   - add tests for the new host→workdir mapping helper
   - add regression tests for traversal escape attempts (keep scope to simple `..` / outside-root cases; no symlink resolution in this story)
4. [ ] Run `npm run lint --workspace server` and fix issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill during implementation)

---

### 2. Server: wire working_folder into agent execution (service + ChatInterfaceCodex)

- Task Status: __to_do__
- Git Commits:

#### Overview

Resolve `working_folder` in the agents service, apply the per-call working directory override in Codex thread options, and return stable, caller-friendly errors when resolution fails.

#### Documentation Locations

- Node.js `fs`/`path` (built-in): existence checks and normalization.
- Existing mapping helper: `server/src/ingest/pathMap.ts` (host→workdir mapping added in Task 1).
- Existing agent execution path: `server/src/agents/service.ts`, `server/src/chat/interfaces/ChatInterfaceCodex.ts`.

#### Subtasks

1. [ ] Extend `server/src/agents/service.ts` params to accept optional `working_folder` and thread it into execution.
2. [ ] Implement resolution behavior in `runAgentInstruction()`:
   - try host→workdir mapping (Task 1 helper) and check mapped path exists **as a directory**
   - fallback to literal path check (directory)
   - throw structured agent-run errors:
     - `WORKING_FOLDER_INVALID` (not absolute / wrong type)
     - `WORKING_FOLDER_NOT_FOUND` (neither mapped nor literal exists as a directory)
3. [ ] Extend `CodexRunFlags` in `server/src/chat/interfaces/ChatInterfaceCodex.ts` to accept a per-call working directory override and apply it when building `ThreadOptions.workingDirectory`.
4. [ ] Add server unit/integration coverage for the agent/service resolution behavior:
   - mapped path exists → uses mapped
   - mapped missing but literal exists → uses literal
   - neither exists → returns/throws expected error
   - `working_folder` outside `HOST_INGEST_DIR` → mapping skipped/rejected safely
5. [ ] Run `npm run lint --workspace server`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill during implementation)

---

### 3. REST: accept working_folder in POST /agents/:agentName/run

- Task Status: __to_do__
- Git Commits:

#### Overview

Accept `working_folder` via the Agents REST endpoint (with a `workingFolder` alias), validate input shape, and map resolution errors to stable HTTP responses without breaking existing clients.

#### Documentation Locations

- Express JSON body parsing + request validation: Context7 `/expressjs/express`.
- Existing route: `server/src/routes/agentsRun.ts`.
- Existing agent error mapping: `server/src/routes/agentsRun.ts`, `server/src/mcpAgents/tools.ts`.

#### Subtasks

1. [ ] Update `server/src/routes/agentsRun.ts` body validation to accept optional `working_folder` (string).
2. [ ] Pass `working_folder` through to `runAgentInstruction`.
3. [ ] Map new agent-run errors to stable HTTP responses:
   - `400 { error: 'invalid_request', code: 'WORKING_FOLDER_INVALID' | 'WORKING_FOLDER_NOT_FOUND', message: '...' }`
4. [ ] Add/adjust server route tests (unit/integration) ensuring:
   - valid request with `working_folder` reaches the service
   - invalid/nonexistent folder returns 400 with expected `code`
5. [ ] Run `npm run lint --workspace server`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill during implementation)

---

### 4. Client API: add working_folder to runAgentInstruction()

- Task Status: __to_do__
- Git Commits:

#### Overview

Extend the client API wrapper so `working_folder` can be sent to the server (without changing behavior when omitted).

#### Documentation Locations

- Client fetch wrapper: `client/src/api/agents.ts`.

#### Subtasks

1. [ ] Update `client/src/api/agents.ts` to accept optional `working_folder` and include it in the POST body only when present.
2. [ ] Add/adjust client unit tests (mock fetch) to assert:
   - when provided, request body contains `working_folder`
   - when omitted, request body does not include the field
3. [ ] Run `npm run lint --workspace client` and `npm run format:check --workspace client`.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill during implementation)

---

### 5. GUI: add optional working_folder control to Agents page

- Task Status: __to_do__
- Git Commits:

#### Overview

Add an optional working folder input to the Agents page so users can run an agent from a specific folder, without expanding the top control bar beyond the existing constraints (agent selector, Stop, New conversation).

#### Documentation Locations

- MUI TextField/Form patterns (use MUI MCP tool during implementation).
- Agents UI: `client/src/pages/AgentsPage.tsx`.
- Reusable UI/testing pattern: `client/src/components/chat/CodexFlagsPanel.tsx` + `client/src/test/chatPage.flags.*.payload.test.tsx` (accordion-style “advanced” controls and request-body assertions).

#### Subtasks

1. [ ] Decide UI placement consistent with existing constraints:
   - do NOT add to the top control bar; add a single `TextField` directly above the instruction input labelled `working_folder` (no accordion; keep it obvious and simple).
2. [ ] Update `client/src/pages/AgentsPage.tsx` to store the optional `working_folder` value and pass it to `runAgentInstruction(...)`.
3. [ ] Define reset behavior: `working_folder` is cleared on **New conversation** and when changing agent (to avoid accidental reuse across runs).
4. [ ] Add/adjust client tests to assert:
   - the field renders
   - the outgoing POST includes `working_folder` when provided
   - error messaging for invalid working folder surfaces cleanly to the user
5. [ ] Run `npm run lint --workspace client` and `npm run format:check --workspace client`.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill during implementation)

---

### 6. MCP 5012: extend run_agent_instruction schema to accept working_folder

- Task Status: __to_do__
- Git Commits:

#### Overview

Expose `working_folder` through the Agents MCP tool `run_agent_instruction` and ensure invalid values return a predictable MCP error (invalid params style).

#### Documentation Locations

- Zod validation patterns (already used in `server/src/mcpAgents/tools.ts`).
- MCP v2 conventions in this repo: `server/src/mcpAgents/*` and `server/src/mcp2/*`.

#### Subtasks

1. [ ] Update `server/src/mcpAgents/tools.ts`:
   - extend Zod schema to allow optional `working_folder`
   - update tool `inputSchema` to document `working_folder`
   - pass through to `runAgentInstruction`
2. [ ] Update MCP error mapping for invalid/nonexistent working folder:
   - return an “invalid params” style tool error with a safe message
3. [ ] Update/extend unit tests for MCP agent tool calls to cover the new param and error case.
4. [ ] Run `npm run lint --workspace server` and `npm run test --workspace server`.

#### Testing

1. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill during implementation)

---

### 7. Codex updates: add model gpt-5.2

- Task Status: __to_do__
- Git Commits:

#### Overview

Update the fixed Codex model list surfaced by the server so it includes `gpt-5.2`, and update any dependent tests/fixtures.

#### Documentation Locations

- `/chat/models` implementation: `server/src/routes/chatModels.ts`
- Provider selection tests/fixtures: `client/src/test/chatPage.provider.test.tsx` (and any other tests mocking the models response)

#### Subtasks

1. [ ] Update `server/src/routes/chatModels.ts` to include Codex model `gpt-5.2` in the fixed list (append after existing).
2. [ ] Update any tests/fixtures that assert the Codex model list to include `gpt-5.2`.
3. [ ] Run `npm run lint --workspace server` and `npm run lint --workspace client`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill during implementation)

---

### 8. Codex updates: add reasoning effort xhigh (app-level)

- Task Status: __to_do__
- Git Commits:

#### Overview

Update the Codex model list and reasoning-effort options across server validation and client UI, plus any seeded config/docs that describe defaults.

#### Documentation Locations

- Codex flags UI: `client/src/components/chat/CodexFlagsPanel.tsx`
- Request validation: `server/src/routes/chatValidators.ts`
- Seed config docs: `server/src/config/codexConfig.ts`, `config.toml.example`, `README.md`, `design.md`

#### Subtasks

1. [ ] Add `xhigh` to the Codex reasoning effort options:
   - client UI options in `client/src/components/chat/CodexFlagsPanel.tsx`
   - server validators that restrict `modelReasoningEffort`
   - client `ModelReasoningEffort` union in `client/src/hooks/useChatStream.ts`
   - server boundary behavior:
     - reuse the existing “app-owned union” pattern already used on the client (`client/src/hooks/useChatStream.ts`) by defining a server-local union for accepted values (do not import `ModelReasoningEffort` from `@openai/codex-sdk` for validation).
      - map `xhigh` → `high` when constructing Codex `ThreadOptions` so the SDK always receives a supported value.
   - KISS: do not modify or bump `@openai/codex-sdk` in this story.
2. [ ] Update unit/integration tests that assert reasoning effort values and allowed sets.
3. [ ] Confirm defaults remain `high` and update any docs/examples/tests that mention the allowed set to include `xhigh`.
4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill during implementation)

---

### 9. Documentation + project structure updates

- Task Status: __to_do__
- Git Commits:

#### Overview

Ensure documentation reflects the new API surface and that `projectStructure.md` is updated for any new files/tests.

#### Documentation Locations

- `README.md`
- `design.md`
- `projectStructure.md`

#### Subtasks

1. [ ] Update `README.md`:
   - document `working_folder` for Agents UI/REST/MCP and the mapping/fallback behavior
   - document `gpt-5.2` and `xhigh` availability
2. [ ] Update `design.md`:
   - add a short section describing per-call working directory overrides for agent runs (and how it differs from default chat)
3. [ ] Update `projectStructure.md` for any new/changed files.
4. [ ] Run `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run format:check --workspaces`

#### Implementation notes

- (fill during implementation)

---

### 10. Final task – verify against acceptance criteria

- Task Status: __to_do__
- Git Commits:

#### Overview

Re-validate all acceptance criteria after implementation, including end-to-end agent runs from the GUI and MCP with valid/invalid `working_folder` values, plus the updated Codex model/reasoning options.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server: `npm run build --workspace server`
2. [ ] Build the client: `npm run build --workspace client`
3. [ ] Perform a clean docker build (server): `docker build -f server/Dockerfile .`
4. [ ] Ensure `README.md` is updated with any required description changes and any new commands added by this story.
5. [ ] Ensure `design.md` is updated with any required description changes (include any new diagrams if needed).
6. [ ] Ensure `projectStructure.md` is up to date.
7. [ ] Run lint + format checks:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/agents` can run an instruction with a valid `working_folder` and the run uses the expected working directory
   - `/agents` returns a clear error for an invalid `working_folder`
   - Agents MCP `5012` accepts `working_folder` and returns a clear error for invalid paths
   - `/chat` Codex model list includes `gpt-5.2`
   - Codex reasoning effort options include `xhigh`
   - Save screenshots to `./test-results/screenshots/` named:
     - `0000017-10-agents-working-folder.png`
     - `0000017-10-mcp-5012-working-folder.png`
     - `0000017-10-chat-codex-models.png`
9. [ ] `npm run compose:down`

#### Implementation notes

- (fill during implementation)
