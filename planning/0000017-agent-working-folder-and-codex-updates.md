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

- Node.js `path` docs: https://nodejs.org/api/path.html
- Node.js `fs` docs (`fs.promises.stat`): https://nodejs.org/api/fs.html#fspromisesstatpath-options
- TypeScript (optional, for string-literal unions in signatures/tests): Context7 `/microsoft/typescript` (use v5.9.2 snippets)

#### Subtasks

1. [ ] Read and understand existing mapper + tests:
   - Files to read:
     - `server/src/ingest/pathMap.ts`
     - `server/src/test/unit/pathMap.test.ts`
   - Goal: match existing normalization conventions and avoid introducing a second mapping style.
2. [ ] Add a new exported helper in `server/src/ingest/pathMap.ts` (do not create a new module for this):
   - File to edit:
     - `server/src/ingest/pathMap.ts`
   - Add a new exported function (name explicit): `mapHostWorkingFolderToWorkdir(...)`.
   - Required signature (copy exactly):
     ```ts
     export function mapHostWorkingFolderToWorkdir(
       hostWorkingFolder: string,
       opts: { hostIngestDir: string; codexWorkdir: string },
     ):
       | { mappedPath: string; relPath: string }
       | { error: { code: 'INVALID_ABSOLUTE_PATH' | 'OUTSIDE_HOST_INGEST_DIR'; message: string } };
     ```
   - Required algorithm (copy/paste guidance):
     - Validate `path.isAbsolute(hostWorkingFolder)`; else return `INVALID_ABSOLUTE_PATH`.
     - Compute `relPath = path.relative(opts.hostIngestDir, hostWorkingFolder)`.
     - If `relPath` starts with `..` (or equals `..`) OR `path.isAbsolute(relPath)`: return `OUTSIDE_HOST_INGEST_DIR`.
     - Return `{ mappedPath: path.join(opts.codexWorkdir, relPath), relPath }`.
   - KISS + risk control:
     - Do not resolve symlinks.
     - Do not modify existing `mapIngestPath` behavior in this story.
3. [ ] Add unit tests for the new helper:
   - File to edit:
     - `server/src/test/unit/pathMap.test.ts`
4. [ ] **Test (server unit, `node:test`)**: maps host path under ingest root
   - Location: `server/src/test/unit/pathMap.test.ts`
   - Purpose: prove `mapHostWorkingFolderToWorkdir()` produces `{ mappedPath, relPath }` for a valid absolute path under `hostIngestDir`.
   - Description:
     - Given `hostIngestDir=/host/base` and `codexWorkdir=/data` and `hostWorkingFolder=/host/base/repo/sub`,
     - expect `relPath === 'repo/sub'` (platform separators normalized by `path.relative`)
     - expect `mappedPath` ends with `/data/repo/sub` (platform-aware join ok).
5. [ ] **Test (server unit, `node:test`)**: rejects host path outside ingest root
   - Location: `server/src/test/unit/pathMap.test.ts`
   - Purpose: prevent path traversal / escape by ensuring mapping is refused when outside `hostIngestDir`.
   - Description:
     - Given `hostIngestDir=/host/base`, `hostWorkingFolder=/host/other/repo`,
     - expect `{ error: { code: 'OUTSIDE_HOST_INGEST_DIR' } }`.
6. [ ] **Test (server unit, `node:test`)**: rejects non-absolute working folder input
   - Location: `server/src/test/unit/pathMap.test.ts`
   - Purpose: enforce the story rule “working_folder must be absolute” at the mapping layer.
   - Description:
     - Given `hostWorkingFolder='relative/path'`,
     - expect `{ error: { code: 'INVALID_ABSOLUTE_PATH' } }`.
4. [ ] Verification commands (must run before moving to Task 2):
   - `npm run lint --workspace server`
   - `npm run test --workspace server`

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

- Node.js `fs` docs (`fs.promises.stat`): https://nodejs.org/api/fs.html#fspromisesstatpath-options
- Node.js `path` docs: https://nodejs.org/api/path.html
- OpenAI Codex config docs (context for workdir + config precedence): Context7 `/openai/codex` (config + example-config)

#### Subtasks

1. [ ] Extend the service input type:
   - Files to read:
     - `server/src/agents/service.ts`
   - File to edit:
     - `server/src/agents/service.ts`
   - Add to `RunAgentInstructionParams`:
     - `working_folder?: string;`
2. [ ] Implement working_folder resolution in `runAgentInstruction()` (this is the only place that should decide which directory is used; REST + MCP both call into this):
   - Files to read:
     - `server/src/agents/service.ts`
     - `server/src/ingest/pathMap.ts` (new helper from Task 1)
   - File to edit:
     - `server/src/agents/service.ts`
   - Required rules (must implement exactly):
     - If `working_folder` is omitted/empty string: do nothing (existing behavior).
     - If `working_folder` is provided but not an absolute path: throw `{ code: 'WORKING_FOLDER_INVALID', reason: 'working_folder must be an absolute path' }`.
     - Try mapped path first:
       - `hostIngestDir = process.env.HOST_INGEST_DIR` (if missing/empty → skip mapping attempt).
       - `codexWorkdir = process.env.CODEX_WORKDIR ?? process.env.CODEINFO_CODEX_WORKDIR ?? '/data'`
       - If mapping returns a `mappedPath`, then if `mappedPath` exists **and is a directory**, choose it.
     - If no mapped directory chosen, then if literal `working_folder` exists **and is a directory**, choose it.
     - If neither exists as a directory: throw `{ code: 'WORKING_FOLDER_NOT_FOUND', reason: 'working_folder not found' }`.
3. [ ] Thread the chosen working directory into Codex execution:
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - File to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Add to `CodexRunFlags`:
     - `workingDirectoryOverride?: string;`
   - Apply it when constructing `threadOptions`:
     - `workingDirectory: workingDirectoryOverride ?? (process.env.CODEX_WORKDIR ?? process.env.CODEINFO_CODEX_WORKDIR ?? '/data')`
4. [ ] **Test (server unit, `node:test`)**: invalid `working_folder` (relative path) is rejected by the service
   - Location: `server/src/test/unit/agents-working-folder.test.ts` (new)
   - Purpose: ensure the service throws `WORKING_FOLDER_INVALID` before any Codex run is attempted.
   - Description:
     - call `runAgentInstruction({ working_folder: 'relative/path', ... })`
     - expect thrown error `{ code: 'WORKING_FOLDER_INVALID' }`.
5. [ ] **Test (server unit, `node:test`)**: mapped path exists → workingDirectoryOverride uses mapped path
   - Location: `server/src/test/unit/agents-working-folder.test.ts` (new)
   - Purpose: verify the “host path → host ingest rel → codex workdir” mapping is applied when possible.
   - Description:
     - set `HOST_INGEST_DIR=/host/base` and `CODEINFO_CODEX_WORKDIR=/data`
     - provide `working_folder=/host/base/repo/sub`
     - arrange filesystem so `/data/repo/sub` exists as a directory
     - assert captured Codex `startThread` options include `workingDirectory: '/data/repo/sub'` (or platform equivalent).
6. [ ] **Test (server unit, `node:test`)**: mapped path missing but literal exists → uses literal working_folder
   - Location: `server/src/test/unit/agents-working-folder.test.ts` (new)
   - Purpose: verify fallback behavior when mapping cannot be used.
   - Description:
     - set `HOST_INGEST_DIR=/host/base` and `CODEINFO_CODEX_WORKDIR=/data`
     - provide `working_folder=/some/literal/dir`
     - ensure mapped path does not exist, but `/some/literal/dir` exists as a directory
     - assert Codex `workingDirectory` is `/some/literal/dir`.
7. [ ] **Test (server unit, `node:test`)**: neither mapped nor literal exists → `WORKING_FOLDER_NOT_FOUND`
   - Location: `server/src/test/unit/agents-working-folder.test.ts` (new)
   - Purpose: guarantee callers get a stable error when no directory exists.
   - Description:
     - provide an absolute `working_folder` where neither mapped nor literal directory exists
     - expect thrown error `{ code: 'WORKING_FOLDER_NOT_FOUND' }`.
8. [ ] Verification commands (must run before moving to Task 3):
   - `npm run lint --workspace server`
   - `npm run test --workspace server`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- (fill during implementation)

---

### 3. REST: accept working_folder in POST /agents/:agentName/run

- Task Status: __to_do__
- Git Commits:

#### Overview

Accept `working_folder` via the Agents REST endpoint, validate input shape, and map resolution errors to stable HTTP responses without breaking existing clients.

#### Documentation Locations

- Express JSON body parsing + request validation: Context7 `/expressjs/express`.
- HTTP status code semantics (reference): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status

#### Subtasks

1. [ ] Extend request body validation:
   - Files to read:
     - `server/src/routes/agentsRun.ts`
   - File to edit:
     - `server/src/routes/agentsRun.ts`
   - Update `AgentRunBody` and `validateBody()` to accept:
     - `working_folder?: unknown`
   - Rules:
     - if provided: must be a string and `trim().length > 0`
     - do not check filesystem existence here (service does that so REST + MCP stay consistent)
2. [ ] Pass the value to the service:
   - File to edit:
     - `server/src/routes/agentsRun.ts`
   - Ensure the call includes `working_folder: parsedBody.working_folder` (or `undefined` if absent).
3. [ ] Extend route error mapping to include the new codes:
   - File to edit:
     - `server/src/routes/agentsRun.ts`
   - When service throws:
     - `WORKING_FOLDER_INVALID` → HTTP 400 with JSON `{ error: 'invalid_request', code: 'WORKING_FOLDER_INVALID', message: '...' }`
     - `WORKING_FOLDER_NOT_FOUND` → HTTP 400 with JSON `{ error: 'invalid_request', code: 'WORKING_FOLDER_NOT_FOUND', message: '...' }`
4. [ ] **Test (server unit, `node:test`)**: REST route forwards `working_folder` to the service
   - Files to read:
     - `server/src/test/unit/agents-router-run.test.ts`
   - File to edit:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Purpose: ensure request parsing plumbs the optional field through.
   - Description:
     - send a request body including `working_folder`
     - assert the stubbed service is called with `working_folder` present.
5. [ ] **Test (server unit, `node:test`)**: REST route maps `WORKING_FOLDER_INVALID` → HTTP 400 + code
   - Location: `server/src/test/unit/agents-router-run.test.ts`
   - Purpose: callers receive a stable 400 error with the correct `code`.
   - Description:
     - make the stubbed service throw `{ code: 'WORKING_FOLDER_INVALID' }`
     - expect response status 400 and body `{ error: 'invalid_request', code: 'WORKING_FOLDER_INVALID' }`.
6. [ ] **Test (server unit, `node:test`)**: REST route maps `WORKING_FOLDER_NOT_FOUND` → HTTP 400 + code
   - Location: `server/src/test/unit/agents-router-run.test.ts`
   - Purpose: callers receive a stable 400 error with the correct `code`.
   - Description:
     - make the stubbed service throw `{ code: 'WORKING_FOLDER_NOT_FOUND' }`
     - expect response status 400 and body `{ error: 'invalid_request', code: 'WORKING_FOLDER_NOT_FOUND' }`.
7. [ ] Verification commands:
   - `npm run lint --workspace server`
   - `npm run test --workspace server`

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

- Fetch API (request building + JSON body): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- React controlled inputs (don’t switch controlled/uncontrolled): Context7 `/reactjs/react.dev` (reference: `<input>` caveats)
- Jest (mocking fetch + inspecting calls): Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Update the request params type:
   - File to edit:
     - `client/src/api/agents.ts`
   - Add to the `runAgentInstruction(params: { ... })` signature:
     - `working_folder?: string;`
2. [ ] Include the field in the POST body:
   - File to edit:
     - `client/src/api/agents.ts`
   - Rule:
     - include `working_folder` only if `params.working_folder?.trim()` is non-empty
3. [ ] **Test (client unit, Jest)**: includes `working_folder` when provided
   - Files to read (pattern):
     - `client/src/test/chatPage.flags.reasoning.payload.test.tsx`
   - File to add:
     - `client/src/test/agentsApi.workingFolder.payload.test.ts`
   - Purpose: ensure API wrapper adds the field only when present.
   - Description:
     - call `runAgentInstruction({ working_folder: '/abs/path', ... })`
     - assert mocked `fetch` called with JSON body containing `working_folder`.
4. [ ] **Test (client unit, Jest)**: omits `working_folder` when not provided (or blank)
   - Location: `client/src/test/agentsApi.workingFolder.payload.test.ts`
   - Purpose: maintain backward compatibility for callers that don’t use the new field.
   - Description:
     - call `runAgentInstruction({ working_folder: undefined })` and separately `working_folder: '   '`
     - assert JSON body does not contain the field.
5. [ ] Verification commands:
   - `npm run lint --workspace client`
   - `npm run test --workspace client`

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

- MUI TextField API (v6): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
- MUI Accordion docs are *not* required for this story (KISS: single TextField only).
- React controlled inputs (don’t switch controlled/uncontrolled): Context7 `/reactjs/react.dev` (reference: `<input>` caveats)
- Jest + React Testing Library (existing repo patterns): Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Add state + TextField UI (controlled input):
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
   - File to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Add state:
     - `const [workingFolder, setWorkingFolder] = useState('');`
   - Add a `TextField` labelled exactly `working_folder` directly above the existing instruction input.
   - Make it controlled:
     - `value={workingFolder}` and `onChange={(e) => setWorkingFolder(e.target.value)}`
2. [ ] Thread it into the agent run request:
   - File to edit:
     - `client/src/pages/AgentsPage.tsx`
   - When calling `runAgentInstruction(...)`, pass:
     - `working_folder: workingFolder.trim() || undefined`
3. [ ] Reset behavior (must implement explicitly):
   - File to edit:
     - `client/src/pages/AgentsPage.tsx`
   - In `resetConversation()` and agent-change handler:
     - call `setWorkingFolder('')`
4. [ ] **Test (client UI, Jest/RTL)**: AgentsPage submits `working_folder` in POST body
   - Files to read:
     - `client/src/test/agentsPage.run.test.tsx` (agents run flow)
   - Location: `client/src/test/agentsPage.run.test.tsx` (edit)
   - Purpose: prove the end-to-end UI plumbing from TextField → API call works.
   - Description:
     - render AgentsPage
     - type a `working_folder` value
     - run an instruction
     - assert the captured request body contains `working_folder`.
5. [ ] **Test (client UI, Jest/RTL)**: Agent change clears the `working_folder` field
   - Location: `client/src/test/agentsPage.agentChange.test.tsx` (edit)
   - Purpose: prevent accidental reuse of a previous folder across agents.
   - Description:
     - set `working_folder` field
     - change agent selection
     - assert field is empty.
6. [ ] Verification commands:
   - `npm run lint --workspace client`
   - `npm run test --workspace client`

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

- Zod (schema validation): Context7 `/colinhacks/zod`
- JSON-RPC 2.0 spec (error codes, invalid params): https://www.jsonrpc.org/specification
- MCP basics (for context; keep wire format unchanged): https://modelcontextprotocol.io/

#### Subtasks

1. [ ] Extend the Zod schema + tool input schema:
   - Files to read:
     - `server/src/mcpAgents/tools.ts`
   - File to edit:
     - `server/src/mcpAgents/tools.ts`
   - Add to `runParamsSchema`:
     - `working_folder: z.string().min(1).optional()`
   - Update `run_agent_instruction` JSON `inputSchema` to include `working_folder` with a clear description.
2. [ ] Pass through to the agents service:
   - File to edit:
     - `server/src/mcpAgents/tools.ts`
   - Include `working_folder: parsed.working_folder` in the `runAgentInstruction({ ... })` call.
3. [ ] Ensure errors are mapped to invalid params:
   - File to edit:
     - `server/src/mcpAgents/tools.ts`
   - When the service throws `WORKING_FOLDER_INVALID` or `WORKING_FOLDER_NOT_FOUND`, translate to `InvalidParamsError` (safe message only).
4. [ ] **Test (server unit, `node:test`)**: MCP tool forwards `working_folder` to service
   - Files to read:
     - `server/src/test/unit/mcp-agents-router-run.test.ts` (router behavior)
     - `server/src/test/unit/mcp-agents-tools-run.test.ts` (tool behavior; if present)
   - Location: prefer `server/src/test/unit/mcp-agents-tools-run.test.ts` (edit/add)
   - Purpose: ensure Zod parsing + call plumbing is correct.
   - Description:
     - call `callTool('run_agent_instruction', { agentName, instruction, working_folder })`
     - assert stubbed `runAgentInstruction` receives `working_folder`.
5. [ ] **Test (server unit, `node:test`)**: MCP maps working-folder errors to InvalidParamsError
   - Location: `server/src/test/unit/mcp-agents-tools-run.test.ts` (edit/add)
   - Purpose: ensure MCP callers get a predictable invalid-params tool error.
   - Description:
     - stub service to throw `{ code: 'WORKING_FOLDER_NOT_FOUND' }` and separately `{ code: 'WORKING_FOLDER_INVALID' }`
     - assert tool throws/returns the repo’s InvalidParamsError shape for both.
6. [ ] Verification commands:
   - `npm run lint --workspace server`
   - `npm run test --workspace server`

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

- Express routing (route handler patterns): Context7 `/expressjs/express`
- Jest (updating tests/fixtures): Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Update the fixed model list returned for Codex:
   - Files to read:
     - `server/src/routes/chatModels.ts`
   - File to edit:
     - `server/src/routes/chatModels.ts`
   - Add a new entry to the `codexModels` array (append only):
     - `key: 'gpt-5.2'`
     - `displayName: 'gpt-5.2'`
     - `type: 'codex'`
2. [ ] **Test (client UI, Jest/RTL)**: provider model list includes `gpt-5.2` when Codex is selected
   - Files to read/edit (common locations):
     - `client/src/test/chatPage.provider.test.tsx` (mocked models response)
     - any other `client/src/test/*` or server integration tests that assert the exact Codex model list
   - Location: `client/src/test/chatPage.provider.test.tsx` (edit)
   - Purpose: prevent UI regressions where adding a new model breaks selection/defaults.
   - Description:
     - update the mocked `/chat/models?provider=codex` payload to include `gpt-5.2`
     - assert the dropdown options include `gpt-5.2`.
3. [ ] Verification commands:
   - `npm run lint --workspace server`
   - `npm run lint --workspace client`
   - `npm run test --workspace server`
   - `npm run test --workspace client`

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

- MUI Select API (v6): https://llms.mui.com/material-ui/6.4.12/api/select.md
- OpenAI Codex config docs (reasoning effort values): Context7 `/openai/codex`
- TypeScript (string literal unions + narrowing): Context7 `/microsoft/typescript`
- Jest (client/server tests): Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Update client types + UI options:
   - Files to read:
     - `client/src/hooks/useChatStream.ts` (defines `ModelReasoningEffort` union)
     - `client/src/components/chat/CodexFlagsPanel.tsx` (renders reasoning effort dropdown)
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`: extend `ModelReasoningEffort` to include `'xhigh'`.
     - `client/src/components/chat/CodexFlagsPanel.tsx`: add a new option:
       - value: `xhigh`
       - label: `XHigh (mapped to High)`
2. [ ] Update server validation to accept `xhigh` (app-level value):
   - Files to read:
     - `server/src/routes/chatValidators.ts`
   - File to edit:
     - `server/src/routes/chatValidators.ts`
   - Add `xhigh` to the accepted values list used by validation.
   - KISS: keep defaults unchanged (`high` remains the default).
3. [ ] Map `xhigh` → `high` at the Codex SDK boundary (required to remain compatible with installed `@openai/codex-sdk`):
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - File to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Implement mapping when constructing `threadOptions.modelReasoningEffort`:
     - if user requested `xhigh`, pass `high` to the SDK
4. [ ] **Test (client UI, Jest/RTL)**: selecting `xhigh` sends `modelReasoningEffort: 'xhigh'` in the request
   - Location: `client/src/test/chatPage.flags.reasoning.payload.test.tsx` (edit)
   - Purpose: ensure the app-level value is preserved in the request payload.
   - Description:
     - select reasoning effort `xhigh`
     - submit a Codex message
     - assert captured request JSON contains `modelReasoningEffort: 'xhigh'`.
5. [ ] **Test (server integration, Jest + MockCodex)**: server accepts `xhigh` but passes `high` into Codex thread options
   - Location: `server/src/test/integration/chat-codex-mcp.test.ts` (edit)
   - Purpose: ensure runtime behavior remains compatible with installed `@openai/codex-sdk`.
   - Description:
     - send a Codex request with `modelReasoningEffort: 'xhigh'`
     - assert mocked codex thread options received `modelReasoningEffort: 'high'`.
6. [ ] Documentation updates (do not miss this even if you only work this subtask):
   - Update `README.md` and `design.md` to state clearly:
     - `xhigh` is an app-level option and is mapped to `high` when calling Codex.
7. [ ] Verification commands:
   - `npm run lint --workspaces`
   - `npm run test --workspace server`
   - `npm run test --workspace client`
   - `npm run format:check --workspaces`

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

- Markdown syntax reference: https://www.markdownguide.org/basic-syntax/
- Mermaid syntax: Context7 `/mermaid-js/mermaid`

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
