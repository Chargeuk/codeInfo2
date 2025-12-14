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
- **Resolved**: If `HOST_INGEST_DIR` is unset, skip mapping and only attempt the literal path check.
- **Resolved**: Require `working_folder` to be an absolute path; reject relative inputs for predictability.
- **Resolved**: Defaults remain unchanged (Codex reasoning default stays `high`; no reorder of model list beyond appending `gpt-5.2`).
- **Resolved**: `gpt-5.2` is added as a new fixed model id alongside existing models (no new `gpt-5.2-*` variants in this story).
- **Discovered constraint**: current `@openai/codex-sdk` (and even latest at time of writing) does **not** include `xhigh` in its `ModelReasoningEffort` TypeScript union (it currently exposes `minimal|low|medium|high`). This story therefore implements `xhigh` as an **app-level allowed value** that is passed through to Codex at runtime with a narrow type-cast at the SDK boundary, and it adds tests to ensure the option is forwarded (without requiring an SDK bump).

---

# Implementation Plan

## Instructions

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

# Tasks

### 1. Add server-side working_folder resolution + error plumbing

- Task Status: __to_do__
- Git Commits:

#### Overview

Introduce a single, tested server helper that resolves an agent-run `working_folder` into a Codex `workingDirectory` override for that call, using the required mapping/fallback rules and returning stable errors when resolution fails.

#### Documentation Locations

- Node.js `path` + `fs` docs (built-in): for cross-platform path normalization and existence checks.
- Existing mapping helper: `server/src/ingest/pathMap.ts` (container → host mapping patterns).
- Express error handling patterns: Context7 `/expressjs/express` (used later in Task 2).

#### Subtasks

1. [ ] Read `server/src/agents/service.ts`, `server/src/chat/interfaces/ChatInterfaceCodex.ts`, and `server/src/ingest/pathMap.ts` to align naming and behavior.
2. [ ] Create a new helper module (suggested) `server/src/agents/workingFolder.ts`:
   - exports `resolveAgentWorkingDirectory({ workingFolder, hostIngestDir, codexWorkdir }): { workingDirectory?: string; error?: { code; message; attempted? } }`
   - implements the mapping algorithm in Acceptance Criteria (including “skip mapping if outside host ingest root” safety).
3. [ ] Extend `RunAgentInstructionParams` in `server/src/agents/service.ts` to accept optional `working_folder` (string) and thread it through callers.
4. [ ] Update `runAgentInstruction()` in `server/src/agents/service.ts`:
   - resolve `working_folder` to a `workingDirectory` override
   - on success: pass the override into Codex execution flags (new flag on `ChatInterfaceCodex`, e.g. `workingDirectoryOverride`)
   - on failure: throw a structured agent-run error code that routes/MCP map consistently:
     - `WORKING_FOLDER_INVALID` (not absolute / wrong type)
     - `WORKING_FOLDER_NOT_FOUND` (neither mapped nor literal exists as a directory)
5. [ ] Update `server/src/chat/interfaces/ChatInterfaceCodex.ts` to accept and apply the per-call override when building `threadOptions.workingDirectory` (without mutating env and without changing non-agent behavior).
6. [ ] Add server unit tests (Node `node:test`) covering:
   - mapped path exists → uses mapped
   - mapped missing but literal exists → uses literal
   - neither exists → returns/throws expected error
   - `working_folder` outside `HOST_INGEST_DIR` → mapping skipped/rejected safely
   - Windows-style separators in input are normalized safely (where applicable)
7. [ ] Run `npm run lint --workspace server` and fix issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill during implementation)

---

### 2. REST: accept working_folder in POST /agents/:agentName/run + client API wiring

- Task Status: __to_do__
- Git Commits:

#### Overview

Plumb the new optional `working_folder` through the REST endpoint and the client `runAgentInstruction` API wrapper, returning a clear 400 error when invalid/nonexistent.

#### Documentation Locations

- Express JSON body parsing + request validation: Context7 `/expressjs/express`.
- Existing route: `server/src/routes/agentsRun.ts`.
- Client fetch wrapper: `client/src/api/agents.ts`.

#### Subtasks

1. [ ] Update `server/src/routes/agentsRun.ts` body validation to accept optional `working_folder` and the alias `workingFolder` (both strings); if both are present, prefer `working_folder`. Pass through to `runAgentInstruction`.
2. [ ] Map new agent-run errors to stable HTTP responses:
   - `400` for invalid/nonexistent working folder (with safe message)
3. [ ] Update `client/src/api/agents.ts` to accept optional `working_folder` parameter and include it in the POST body only when present.
4. [ ] Add/adjust server integration tests for REST agent runs to validate:
   - request accepts `working_folder`
   - invalid `working_folder` returns 400 with expected error code
5. [ ] Run `npm run lint --workspace server` and `npm run lint --workspace client`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill during implementation)

---

### 3. GUI: add optional working_folder control to Agents page

- Task Status: __to_do__
- Git Commits:

#### Overview

Add an optional working folder input to the Agents page so users can run an agent from a specific folder, without expanding the top control bar beyond the existing constraints (agent selector, Stop, New conversation).

#### Documentation Locations

- MUI TextField/Form patterns (use MUI MCP tool during implementation).
- Agents UI: `client/src/pages/AgentsPage.tsx`.

#### Subtasks

1. [ ] Decide UI placement consistent with existing constraints:
   - do NOT add to the top control bar; instead add a secondary input near the instruction box (or in an “Advanced” accordion) labelled `working_folder`.
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

### 4. MCP 5012: extend run_agent_instruction schema to accept working_folder

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

### 5. Codex updates: add model gpt-5.2 and reasoning effort xhigh

- Task Status: __to_do__
- Git Commits:

#### Overview

Update the Codex model list and reasoning-effort options across server validation and client UI, plus any seeded config/docs that describe defaults.

#### Documentation Locations

- `/chat/models` implementation: `server/src/routes/chatModels.ts`
- Codex flags UI: `client/src/components/chat/CodexFlagsPanel.tsx`
- Request validation: `server/src/routes/chatValidators.ts`
- Seed config docs: `server/src/config/codexConfig.ts`, `config.toml.example`, `README.md`, `design.md`

#### Subtasks

1. [ ] Update `server/src/routes/chatModels.ts` to include Codex model `gpt-5.2` in the fixed list.
2. [ ] Update any server-side validators that restrict Codex model ids to include `gpt-5.2`.
3. [ ] Add `xhigh` to the Codex reasoning effort options:
   - client UI options in `client/src/components/chat/CodexFlagsPanel.tsx`
   - server validators that restrict `modelReasoningEffort`
   - client `ModelReasoningEffort` union in `client/src/hooks/useChatStream.ts`
   - server boundary types: do not rely on `@openai/codex-sdk` union supporting `xhigh`; cast only at the point where options are passed to the SDK.
4. [ ] Update unit/integration tests that assert codex model lists and reasoning effort values.
5. [ ] Confirm defaults remain `high` and update any docs/examples/tests that mention the allowed set to include `xhigh`.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`

#### Implementation notes

- (fill during implementation)

---

### 6. Documentation + project structure updates

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

### 7. Final task – verify against acceptance criteria

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
     - `0000017-7-agents-working-folder.png`
     - `0000017-7-mcp-5012-working-folder.png`
     - `0000017-7-chat-codex-models.png`
9. [ ] `npm run compose:down`

#### Implementation notes

- (fill during implementation)
