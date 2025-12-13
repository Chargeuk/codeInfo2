# Story 0000015 – Consolidate MCP Server Infrastructure

## Implementation Plan Instructions

This story follows `planning/plan_format.md`. It focuses on consolidating shared MCP/JSON-RPC server mechanics used by the two existing server MCP implementations:

- `server/src/mcp/server.ts` (Express route `POST /mcp`)
- `server/src/mcp2/*` (standalone HTTP server on `MCP_PORT`)

### Description

Today the product exposes two MCP interfaces from the server. This is correct because they serve different purposes and expose different tools, but they both re-implement the same “MCP server basics” (JSON-RPC envelope handling, `initialize`/`tools/list`/`tools/call` dispatch, and common helper logic). As a result, making changes to MCP behavior is harder and riskier than it needs to be.

After this story, both MCP implementations still exist and still behave exactly the same externally, but they share a single internal “MCP core” module for the duplicated infrastructure code. This reduces duplication, makes it easier to maintain MCP behavior consistently, and reduces the chance that future MCP changes accidentally diverge between the two servers.

### Ground rules for juniors (read before any task)

- This is a **refactor-only** story: if a test assertion changes because an output payload changed, the output must be restored to its original shape. Do **not** “fix” or “standardize” any response keys, status codes, tool schemas, or gating behaviors in this story.
- MCP “v1” (`server/src/mcp/server.ts`) and MCP “v2” (`server/src/mcp2/*`) intentionally differ in some response shapes and error-code conventions. Preserve those differences exactly as they are today.
- Before moving any code, lock down the current behavior with characterization tests. Only refactor once those tests are green.
- When refactoring, keep changes small and mechanical:
  - extract helpers to a shared module,
  - update call sites,
  - rerun tests,
  - repeat.
- If you are unsure what is “the current behavior”, locate it by reading these files first:
  - `server/src/mcp/server.ts`
  - `server/src/mcp2/router.ts`
  - `server/src/mcp2/types.ts`
  - `server/src/mcp2/tools.ts`
  - existing tests under `server/src/test/unit/mcp2-*` and `server/src/test/mcp2/tools/*`

### Acceptance Criteria

- Both MCP implementations remain present and continue serving their existing tool sets and endpoints:
  - Express MCP: `POST /mcp` continues to expose `ListIngestedRepositories` and `VectorSearch` with the same schemas and responses.
  - MCP v2 server: continues to expose `codebase_question` via `tools/list` and `tools/call` on `MCP_PORT`.
- A shared internal MCP core module exists and is used by both implementations for common infrastructure (JSON-RPC helpers + request validation + method dispatch).
- No externally observable behavior changes:
  - Response shapes remain byte-for-byte compatible with pre-refactor output (including any existing naming differences between the two MCP servers).
  - Status/error code conventions for each MCP server remain unchanged.
  - MCP v2 Codex availability gating behavior remains unchanged.
- Tests exist that characterize both MCP servers’ current behaviors and protect against accidental wire-format changes.
- Documentation is updated to explain:
  - why two MCP implementations exist,
  - where shared core code lives,
  - what *must not* be changed when adding new MCP tools.

### Out Of Scope

- Merging the two MCP endpoints into one server/port.
- Adding new tools or changing any tool’s contract (schemas, argument validation, payload structure).
- Changing error-code conventions (e.g. HTTP-ish codes vs JSON-RPC codes) or “fixing” existing response shape mismatches between the two servers.
- Reworking the Codex detection/gating model.

### Questions



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

### 1. Add characterization tests for both MCP servers

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Before refactoring, add tests that lock in the current JSON-RPC request/response behaviors for both MCP servers. These tests must validate response payload shapes and error handling so the consolidation cannot accidentally change the wire format.

#### Documentation Locations

- Model Context Protocol (MCP) spec:
  - https://modelcontextprotocol.io/
  - https://github.com/modelcontextprotocol/specification
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- Node.js (tests + HTTP + fetch):
  - Context7 `/nodejs/node`
  - https://nodejs.org/api/test.html
  - https://nodejs.org/api/http.html
  - https://nodejs.org/api/globals.html#fetch
- TypeScript (tests + shared types): Context7 `/microsoft/typescript`
- Express Router / middleware: Context7 `/expressjs/express`
- Supertest:
  - Context7 `/ladjs/supertest`
  - Deepwiki `ladjs/supertest`
- ESLint (lint step at end): Context7 `/eslint/eslint`
- Prettier (format step at end): Context7 `/prettier/prettier`

#### Subtasks

1. [ ] Read `server/src/mcp/server.ts` and write down the exact “contract” you must preserve:
   - `initialize` response fields and values (note: `serverInfo.version` is currently hard-coded here).
   - `resources/listTemplates` response key name (note: this may differ from MCP v2; do not change it).
   - tool responses are returned as `result.content[0].type === "text"` and `result.content[0].text` is a JSON string.
2. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: `initialize` returns protocolVersion and capabilities.
   - Purpose: prove the `/mcp` initialize wire format is unchanged.
3. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: `tools/list` returns MCP tool definitions (includes `ListIngestedRepositories` + `VectorSearch`).
   - Purpose: prove tool list output and names remain unchanged.
4. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: `tools/call` executes `ListIngestedRepositories` and returns `content[0].type === "text"` JSON.
   - Purpose: prove tool result encoding and payload shape remain unchanged.
5. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: `tools/call` validates `VectorSearch` args and returns `-32602` when `query` missing.
   - Purpose: prove validation error mapping for `/mcp` remains unchanged.
6. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: unknown tool name returns `-32602`.
   - Purpose: prove unknown-tool mapping remains unchanged.
7. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: unknown JSON-RPC method returns `-32601`.
   - Purpose: prove method-not-found mapping remains unchanged.
8. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: invalid request shape returns `-32600`.
   - Purpose: prove invalid-request mapping remains unchanged.
9. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: internal errors inside tool execution return `-32603`.
   - Purpose: prove internal-error mapping remains unchanged.
10. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: thrown `ValidationError` instances map to `-32602` with `error.data.details`.
   - Purpose: prove `/mcp` validation error payload shape remains unchanged.
11. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Description: `tools/call` responses are returned as `text` content (ListIngestedRepositories).
   - Purpose: prove tool response encoding stays compatible with Codex expectations.
12. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Description: `VectorSearch` content is `text` and parsable JSON.
   - Purpose: prove vector search tool encoding stays compatible with Codex expectations.
13. [ ] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Description: `resources/list` returns `{ resources: [] }` and `resources/listTemplates` returns `{ resourceTemplates: [] }`.
   - Purpose: prove `/mcp` resources payload keys remain unchanged.
14. [ ] **Unit test case (update existing)** — `server/src/test/unit/mcp2-router-initialize.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-initialize.test.ts`
   - Description: MCP v2 `initialize` returns protocolVersion/capabilities/serverInfo.
   - Purpose: prove MCP v2 initialize wire format is unchanged.
15. [ ] **Unit test case (update existing)** — `server/src/test/unit/mcp2-router-list-happy.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-list-happy.test.ts`
   - Description: MCP v2 `tools/list` returns tool definitions when Codex is available.
   - Purpose: prove MCP v2 tool-list output stays unchanged when available.
16. [ ] **Unit test case (update existing)** — `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Description: MCP v2 `tools/list` returns `CODE_INFO_LLM_UNAVAILABLE (-32001)` when Codex is missing.
   - Purpose: prove MCP v2 gating behavior is unchanged.
17. [ ] **Unit test case (update existing)** — `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Description: MCP v2 `resources/list` returns `{ resources: [] }` and `resources/listTemplates` returns `{ resource_templates: [] }`.
   - Purpose: prove MCP v2 resource payload keys remain unchanged.
18. [ ] **Unit test case (add new)** — `server/src/test/unit/mcp2-router-parse-error.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + raw `http.request`.
   - Location: `server/src/test/unit/mcp2-router-parse-error.test.ts`
   - Description: invalid JSON request body returns parse error `-32700`, `id: null`, message `"Parse error"`.
   - Purpose: prove MCP v2 parse-error behavior is unchanged after refactor.
19. [ ] **Unit test case (add new)** — `server/src/test/unit/mcp2-router-invalid-request.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-invalid-request.test.ts`
   - Description: invalid JSON-RPC request shape returns `-32600` `"Invalid Request"`.
   - Purpose: prove MCP v2 invalid-request behavior is unchanged after refactor.
20. [ ] **Unit test case (add new)** — `server/src/test/unit/mcp2-router-method-not-found.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-method-not-found.test.ts`
   - Description: unknown JSON-RPC method returns `-32601` `"Method not found"`.
   - Purpose: prove MCP v2 method-not-found behavior is unchanged.
21. [ ] **Unit test case (add new)** — `server/src/test/unit/mcp2-router-tool-not-found.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-tool-not-found.test.ts`
   - Description: `tools/call` with unknown tool name returns `-32601` `"Method not found"`.
   - Purpose: prove MCP v2 unknown-tool mapping is unchanged.
22. [ ] **Unit test case (update existing)** — `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Description: `codebase_question` returns `content[0].type === "text"` JSON with segments order `thinking -> vector_summary -> answer`.
   - Purpose: prove MCP v2 `codebase_question` output shape is unchanged.
23. [ ] **Unit test case (update existing)** — `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Description: `codebase_question` preserves conversation id and resumes the same Codex thread on follow-up.
   - Purpose: prove MCP v2 conversation continuity is unchanged.
24. [ ] **Unit test case (update existing)** — `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
   - Description: `codebase_question` is gated when Codex unavailable (returns `-32001 CODE_INFO_LLM_UNAVAILABLE`).
   - Purpose: prove MCP v2 tool gating is unchanged.
25. [ ] **Unit test case (update existing)** — `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`
   - Description: missing required `question` returns `-32602` `"Invalid params"`.
   - Purpose: prove MCP v2 invalid-params mapping is unchanged.
26. [ ] Update `projectStructure.md` (refactor-only) with explicit entries/updates for every **new** test file added in this task:
   - Add `server/src/test/unit/mcp2-router-parse-error.test.ts` — MCP v2 parse error contract (`-32700`) characterization.
   - Add `server/src/test/unit/mcp2-router-invalid-request.test.ts` — MCP v2 invalid request contract (`-32600`) characterization.
   - Add `server/src/test/unit/mcp2-router-method-not-found.test.ts` — MCP v2 method not found contract (`-32601`) characterization.
   - Add `server/src/test/unit/mcp2-router-tool-not-found.test.ts` — MCP v2 unknown tool mapping contract (`-32601`) characterization.
27. [ ] Files to read / edit for all tests in this task:
   - Files to read: `server/src/mcp/server.ts`, `server/src/mcp2/router.ts`, `server/src/mcp2/tools.ts`, `server/src/mcp2/errors.ts`.
   - Files to edit: all test files listed above.
28. [ ] The last subtask is always repo-wide linting/format checks (all workspaces):
   - Run: `npm run lint --workspaces`
   - Run: `npm run format:check --workspaces`
   - If either fails:
     - Run: `npm run lint:fix --workspaces` (or the closest available fix command)
     - Run: `npm run format --workspaces`
     - Manually resolve any remaining lint/format issues, then rerun:
       - `npm run lint --workspaces`
       - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run test --workspace server`

#### Implementation notes


---

### 2. Introduce a shared MCP core module

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Create a small shared “MCP core” module that contains the duplicated JSON-RPC/MCP infrastructure code, while still allowing the two MCP servers to keep their intentionally different behaviors (transport, tool sets, gating, and error mapping).

#### Documentation Locations

- Model Context Protocol (MCP) spec:
  - https://modelcontextprotocol.io/
  - https://github.com/modelcontextprotocol/specification
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- Node.js (HTTP server + test runner): Context7 `/nodejs/node`
- TypeScript (types for request/handler contracts): Context7 `/microsoft/typescript`
- ESLint (lint step at end): Context7 `/eslint/eslint`
- Prettier (format step at end): Context7 `/prettier/prettier`

#### Subtasks

1. [ ] Identify the duplicated “infrastructure” code to consolidate (read both files side-by-side):
   - From `server/src/mcp/server.ts`: `jsonRpcResult`, `jsonRpcError`, `isObject`, request validation, and the method dispatch skeleton for `initialize` / `tools/list` / `tools/call` / `resources/*`.
   - From `server/src/mcp2/router.ts`: `isObject`, request validation, method dispatch skeleton for `initialize` / `tools/list` / `tools/call` / `resources/*` (note: body reading + parse error handling must remain in `mcp2/router.ts`).
   - Files to read: `server/src/mcp/server.ts`, `server/src/mcp2/router.ts`.
2. [ ] Create `server/src/mcpCommon/` with **small, mechanical** helpers only:
   - `server/src/mcpCommon/guards.ts`: shared `isObject(value)` and any other tiny type guards used by both implementations.
   - `server/src/mcpCommon/jsonRpc.ts`: shared `jsonRpcResult(id, result)` and `jsonRpcError(id, code, message, data?)`.
     - Must support arbitrary `id` and arbitrary `code` values because the two servers differ.
   - `server/src/mcpCommon/dispatch.ts`: a dispatcher function that:
     - accepts a parsed message `{ jsonrpc, id, method, params }` (do not parse JSON here),
     - provides hooks per method so each server can preserve its current response payload shapes,
     - returns a full JSON-RPC response payload that the caller can `res.json(...)` / `res.end(...)`.
   - Files to edit (new): `server/src/mcpCommon/guards.ts`, `server/src/mcpCommon/jsonRpc.ts`, `server/src/mcpCommon/dispatch.ts`.
3. [ ] Define the dispatcher API so a junior can implement without design work:
   - Inputs:
     - `message` (already parsed JSON object or “unknown” to validate)
     - `handlers` object that contains:
       - `initialize(id)`
       - `resourcesList(id)`
       - `resourcesListTemplates(id)`
       - `toolsList(id)`
       - `toolsCall(id, params)`
       - `methodNotFound(id)`
       - `invalidRequest(id)`
     - Optional `validateRequest(message)` hook if needed for strictness
   - Outputs:
     - `{ jsonrpc:"2.0", id, result }` or `{ jsonrpc:"2.0", id, error:{ code, message, data? } }`
   - Files to edit: `server/src/mcpCommon/dispatch.ts` (define exported types/signatures) and any new shared types file only if needed.
4. [ ] **Unit test case (add new)** — `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Type: Node `node:test` + `node:assert/strict`.
   - Location: `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Description: invalid request input returns the `invalidRequest(id)` handler output and does not throw.
   - Purpose: prove shared dispatcher handles invalid input safely and preserves handler outputs.
5. [ ] **Unit test case (add new)** — `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Type: Node `node:test` + `node:assert/strict`.
   - Location: `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Description: known method `initialize` routes to `handlers.initialize(id)`.
   - Purpose: prove shared dispatcher routes known methods correctly.
6. [ ] **Unit test case (add new)** — `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Type: Node `node:test` + `node:assert/strict`.
   - Location: `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Description: unknown method routes to `handlers.methodNotFound(id)`.
   - Purpose: prove shared dispatcher preserves each server’s method-not-found behavior via handlers.
7. [ ] **Unit test case (add new)** — `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Type: Node `node:test` + `node:assert/strict`.
   - Location: `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Description: dispatcher returns handler payloads verbatim (no mutation / no rewriting).
   - Purpose: guarantee “no behavior change” by ensuring the dispatcher never changes payload structures.
8. [ ] Files to read / edit for dispatcher tests:
   - Files to read: `server/src/mcpCommon/dispatch.ts`.
   - Files to edit (new): `server/src/test/unit/mcp-common-dispatch.test.ts`.
9. [ ] Update `projectStructure.md` (refactor-only) with explicit new entries for shared MCP core:
   - Add `server/src/mcpCommon/` with a description like “Shared MCP/JSON-RPC infrastructure used by both MCP servers (helpers/dispatch only; must not change wire formats).”
   - Add `server/src/mcpCommon/guards.ts`, `server/src/mcpCommon/jsonRpc.ts`, and `server/src/mcpCommon/dispatch.ts` with brief, specific descriptions.
   - Add `server/src/test/unit/mcp-common-dispatch.test.ts` with a description like “Unit tests for shared MCP dispatcher routing/validation.”
10. [ ] The last subtask is always repo-wide linting/format checks (all workspaces):
   - Run: `npm run lint --workspaces`
   - Run: `npm run format:check --workspaces`
   - If either fails:
     - Run: `npm run lint:fix --workspaces` (or the closest available fix command)
     - Run: `npm run format --workspaces`
     - Manually resolve any remaining lint/format issues, then rerun:
       - `npm run lint --workspaces`
       - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run test --workspace server`

#### Implementation notes


---

### 3. Refactor Express MCP (`server/src/mcp/server.ts`) to use the shared core

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Refactor the Express MCP router implementation to delegate JSON-RPC/MCP infrastructure concerns to the shared core, while keeping its tool definitions and existing response/error conventions unchanged.

#### Documentation Locations

- Express Router: Context7 `/expressjs/express`
- TypeScript (refactor is in TS): Context7 `/microsoft/typescript`
- Model Context Protocol (MCP) spec:
  - https://modelcontextprotocol.io/
  - https://github.com/modelcontextprotocol/specification
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- ESLint (lint step at end): Context7 `/eslint/eslint`
- Prettier (format step at end): Context7 `/prettier/prettier`

#### Subtasks

1. [ ] Refactor `server/src/mcp/server.ts` in small steps:
   - Import and use `server/src/mcpCommon/guards.ts` instead of the local `isObject`.
   - Import and use `server/src/mcpCommon/jsonRpc.ts` instead of local `jsonRpcResult/jsonRpcError`.
   - Replace the inline method dispatch chain with `server/src/mcpCommon/dispatch.ts`, using handlers that return the **exact** current payloads.
   - Files to read: `server/src/mcp/server.ts`, `server/src/mcpCommon/guards.ts`, `server/src/mcpCommon/jsonRpc.ts`, `server/src/mcpCommon/dispatch.ts`.
   - Files to edit: `server/src/mcp/server.ts`.
2. [ ] Keep these items local to `server/src/mcp/server.ts` (to avoid behavior drift):
   - tool definitions array (schemas, descriptions, output schema keys)
   - domain error mapping (including any non-standard codes like `404`, `409`, `503`)
   - `PROTOCOL_VERSION` and the exact `initialize` `serverInfo` payload (currently `name: "codeinfo2-mcp", version: "1.0.0"`).
3. [ ] Ensure dependency injection via `createMcpRouter(deps)` remains unchanged:
   - `createMcpRouter()` signature stays the same.
   - Passing overrides for `listIngestedRepositories`, `validateVectorSearch`, and `vectorSearch` keeps working (Task 1 contract tests depend on it).
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`, `server/src/test/integration/mcp-server.codex-compat.test.ts`.
   - Files to edit: `server/src/mcp/server.ts` (only if needed to preserve injection behavior).
4. [ ] Run only the Express MCP contract test first and fix failures by restoring previous output:
   - If `serverInfo` values, key names, or error codes differ, change the refactor until it matches the pre-refactor behavior.
   - Files to read: `server/src/test/integration/mcp-server.test.ts`, `server/src/test/integration/mcp-server.codex-compat.test.ts`.
   - Files to edit: `server/src/mcp/server.ts`.
5. [ ] Update `projectStructure.md` (refactor-only) entry for `server/src/mcp/server.ts`:
   - Add a note in its description that it now uses `server/src/mcpCommon/*` for shared JSON-RPC helpers/dispatch.
   - Keep the description clear that tool definitions + domain error mapping remain owned by `server/src/mcp/server.ts`.
   - Files to edit: `projectStructure.md`.
6. [ ] The last subtask is always repo-wide linting/format checks (all workspaces):
   - Run: `npm run lint --workspaces`
   - Run: `npm run format:check --workspaces`
   - If either fails:
     - Run: `npm run lint:fix --workspaces` (or the closest available fix command)
     - Run: `npm run format --workspaces`
     - Manually resolve any remaining lint/format issues, then rerun:
       - `npm run lint --workspaces`
       - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run test --workspace server`

#### Implementation notes


---

### 4. Refactor MCP v2 router (`server/src/mcp2/router.ts`) to use the shared core

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Refactor the standalone MCP v2 router to use the shared core for JSON-RPC method handling, while preserving its body reading + parse error semantics and Codex availability gating.

#### Documentation Locations

- Node.js (HTTP server + request/response handling): Context7 `/nodejs/node`
- TypeScript (refactor is in TS): Context7 `/microsoft/typescript`
- Model Context Protocol (MCP) spec:
  - https://modelcontextprotocol.io/
  - https://github.com/modelcontextprotocol/specification
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- ESLint (lint step at end): Context7 `/eslint/eslint`
- Prettier (format step at end): Context7 `/prettier/prettier`

#### Subtasks

1. [ ] Keep the transport-level behavior unchanged in `server/src/mcp2/router.ts`:
   - Keep `readBody(req)` as-is.
   - Keep `JSON.parse` try/catch as-is so invalid JSON produces `jsonRpcError(null, -32700, "Parse error")`.
   - Keep response headers and `res.end(JSON.stringify(payload))` behavior as-is.
   - Files to read: `server/src/mcp2/router.ts`.
   - Files to edit: `server/src/mcp2/router.ts`.
2. [ ] Replace only the method-dispatch skeleton with the shared core dispatcher:
   - After parsing `message`, delegate to `dispatch(...)` with handlers that:
     - return the current `initialize` payload (including `serverInfo.version` sourced from `package.json`).
     - return the current `resources/list` payload keys.
     - return the current `resources/listTemplates` payload keys (note: do not rename keys even if inconsistent).
     - preserve the `tools/list` and `tools/call` Codex gating behavior:
       - if unavailable, return `{ error: { code: -32001, message: "CODE_INFO_LLM_UNAVAILABLE" } }` with the current structure.
   - Files to read: `server/src/mcp2/router.ts`, `server/src/mcpCommon/dispatch.ts`, `server/src/mcpCommon/guards.ts`, `server/src/mcp2/codexAvailability.ts`.
   - Files to edit: `server/src/mcp2/router.ts`.
3. [ ] Keep `server/src/mcp2/types.ts` and `server/src/mcp2/errors.ts` in place unless you can prove (via tests) that moving them cannot change output shape.
4. [ ] Verify existing MCP v2 tests + any additions from Task 1 still pass:
   - If a test fails due to output differences, adjust the refactor to preserve original behavior.
   - Files to read: all MCP v2 contract tests listed in Task 1.
   - Files to edit: `server/src/mcp2/router.ts` (and only shared core files if the fix is truly infrastructure-only).
5. [ ] Update `projectStructure.md` (refactor-only) entry for `server/src/mcp2/router.ts`:
   - Add a note in its description that it now uses `server/src/mcpCommon/*` for shared guards/dispatch.
   - Keep the description clear that transport parsing (readBody/JSON.parse) + Codex gating remain owned by `server/src/mcp2/router.ts`.
   - Files to edit: `projectStructure.md`.
6. [ ] The last subtask is always repo-wide linting/format checks (all workspaces):
   - Run: `npm run lint --workspaces`
   - Run: `npm run format:check --workspaces`
   - If either fails:
     - Run: `npm run lint:fix --workspaces` (or the closest available fix command)
     - Run: `npm run format --workspaces`
     - Manually resolve any remaining lint/format issues, then rerun:
       - `npm run lint --workspaces`
       - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run test --workspace server`

#### Implementation notes


---

### 5. Final task – verify against acceptance criteria

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Final end-to-end validation for the story. Confirms the refactor is safe (no contract changes), the full stack still builds and tests, and documentation is updated.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Playwright MCP server (manual-check tooling): Context7 `/microsoft/playwright-mcp`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber:
  - Context7 `/cucumber/docs`
  - https://cucumber.io/docs/guides/
- Model Context Protocol (MCP) spec:
  - https://modelcontextprotocol.io/
  - https://github.com/modelcontextprotocol/specification
- ESLint (final lint step): Context7 `/eslint/eslint`
- Prettier (final format step): Context7 `/prettier/prettier`

#### Subtasks

1. [ ] Build the server (outside Docker) and confirm it exits 0:
   - `npm run build --workspace server`
2. [ ] Build the client (outside Docker) and confirm it exits 0:
   - `npm run build --workspace client`
3. [ ] Perform a clean docker build and confirm it exits 0:
   - `npm run compose:build`
4. [ ] Update `README.md` (refactor-only; no behavior changes):
   - Add a short note in the MCP documentation explaining there are **two** MCP surfaces:
     - Express `POST /mcp` (tooling: `ListIngestedRepositories`, `VectorSearch`)
     - MCP v2 server on `MCP_PORT` (tooling: `codebase_question`)
   - State that their response conventions may differ and this story preserves both contracts.
   - Mention shared MCP infrastructure lives under `server/src/mcpCommon/`.
   - Files to edit: `README.md`.
5. [ ] Update `design.md` (refactor-only; no behavior changes):
   - Add a short “MCP servers” section explaining:
     - Why both `server/src/mcp/*` and `server/src/mcp2/*` exist.
     - What moved to `server/src/mcpCommon/*` (guards, JSON-RPC helpers, dispatch skeleton).
     - What remains per server (transport parsing, availability gating, tool sets, domain error mapping, response-shape differences).
   - Files to edit: `design.md`.
6. [ ] Update `projectStructure.md` (refactor-only) explicitly with:
   - New `server/src/mcpCommon/` entries (and file descriptions).
   - New/updated MCP contract tests added in this story.
   - Updated descriptions for `server/src/mcp/server.ts` and `server/src/mcp2/router.ts` noting shared-core usage while preserving ownership boundaries.
   - Files to edit: `projectStructure.md`.
7. [ ] Create a pull request summary comment that includes:
   - what duplication was removed,
   - what shared module(s) were introduced and why,
   - proof of “no behavior change” (which characterization/contract tests protect this),
   - which commands were run to validate (build/test/e2e/compose).
8. [ ] The last subtask is always repo-wide linting/format checks (all workspaces):
   - Run: `npm run lint --workspaces`
   - Run: `npm run format:check --workspaces`
   - If either fails:
     - Run: `npm run lint:fix --workspaces` (or the closest available fix command)
     - Run: `npm run format --workspaces`
     - Manually resolve any remaining lint/format issues, then rerun:
       - `npm run lint --workspaces`
       - `npm run format:check --workspaces`

#### Testing

1. [ ] The first testing task must always be to prove the server build works outside of docker:
   - `npm run build --workspace server`
2. [ ] The second testing task must always be to prove the client build works outside of docker:
   - `npm run build --workspace client`
3. [ ] The third testing task must always be to prove the CLEAN docker build works:
   - `npm run compose:build`
4. [ ] The fourth testing task must always be to prove the docker compose starts:
   - `npm run compose:up`
5. [ ] Run the server tests:
   - `npm run test --workspace server`
6. [ ] Run the client tests:
   - `npm run test --workspace client`
7. [ ] Run the e2e tests:
   - `npm run e2e`
8. [ ] Bring the stack down:
   - `npm run compose:down`
9. [ ] Use the Playwright MCP tool to manually check the application and save screenshots to `./test-results/screenshots/`:
   - Naming: `0000015-05-<name>.png`
   - Minimum checks: `/chat`, `/logs`, and confirm both MCP endpoints still respond to `initialize` and `tools/list` (via curl or UI where appropriate).

#### Implementation notes
