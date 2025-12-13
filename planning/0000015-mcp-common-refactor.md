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

- Task Status: __done__
- Git Commits: c05ed41, 27ef963

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

1. [x] Read `server/src/mcp/server.ts` and write down the exact “contract” you must preserve:
   - `initialize` response fields and values (note: `serverInfo.version` is currently hard-coded here).
   - `resources/listTemplates` response key name (note: this may differ from MCP v2; do not change it).
   - tool responses are returned as `result.content[0].type === "text"` and `result.content[0].text` is a JSON string.
   - Docs to read (repeat, even if you’ve read them already):
     - MCP spec: https://modelcontextprotocol.io/ (and https://github.com/modelcontextprotocol/specification)
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcp/server.ts`
   - Non-negotiables: **no behavior change**; do not rename keys or “standardize” outputs.
2. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: `initialize` returns protocolVersion and capabilities.
   - Purpose: prove the `/mcp` initialize wire format is unchanged.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
     - MCP spec: https://modelcontextprotocol.io/
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: if an assertion changes because output changed, restore the output (do not “update expected” unless it was already wrong pre-story).
3. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: `tools/list` returns MCP tool definitions (includes `ListIngestedRepositories` + `VectorSearch`).
   - Purpose: prove tool list output and names remain unchanged.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
     - MCP spec: https://modelcontextprotocol.io/
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: preserve tool names, schemas, and the exact list output shape.
4. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: `tools/call` executes `ListIngestedRepositories` and returns `content[0].type === "text"` JSON.
   - Purpose: prove tool result encoding and payload shape remain unchanged.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
     - MCP spec: https://modelcontextprotocol.io/
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: preserve the `content[0].type === "text"` + JSON-string encoding pattern.
5. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: `tools/call` validates `VectorSearch` args and returns `-32602` when `query` missing.
   - Purpose: prove validation error mapping for `/mcp` remains unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Invalid params”: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: preserve error code and any `error.data` fields.
6. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: unknown tool name returns `-32602`.
   - Purpose: prove unknown-tool mapping remains unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Invalid params”: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: preserve the current error mapping (even if it seems “non-standard”).
7. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: unknown JSON-RPC method returns `-32601`.
   - Purpose: prove method-not-found mapping remains unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Method not found”: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: preserve error codes/messages exactly.
8. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: invalid request shape returns `-32600`.
   - Purpose: prove invalid-request mapping remains unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Invalid Request”: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: preserve invalid-request detection + payload shape.
9. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: internal errors inside tool execution return `-32603`.
   - Purpose: prove internal-error mapping remains unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Internal error”: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: preserve the internal-error mapping and response shape.
10. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.test.ts`
   - Description: thrown `ValidationError` instances map to `-32602` with `error.data.details`.
   - Purpose: prove `/mcp` validation error payload shape remains unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Invalid params”: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.test.ts`
   - Non-negotiables: preserve `error.data.details` structure.
11. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Description: `tools/call` responses are returned as `text` content (ListIngestedRepositories).
   - Purpose: prove tool response encoding stays compatible with Codex expectations.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
     - MCP spec (tools/call result): https://modelcontextprotocol.io/
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Non-negotiables: preserve the Codex-compatible `text` content encoding.
12. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Description: `VectorSearch` content is `text` and parsable JSON.
   - Purpose: prove vector search tool encoding stays compatible with Codex expectations.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
     - MCP spec (tools/call result): https://modelcontextprotocol.io/
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Non-negotiables: preserve encoding + JSON string parseability.
13. [x] **Integration test case (update existing)** — `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Type: Node `node:test` + Supertest (Express in-memory).
   - Location: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Description: `resources/list` returns `{ resources: [] }` and `resources/listTemplates` returns `{ resourceTemplates: [] }`.
   - Purpose: prove `/mcp` resources payload keys remain unchanged.
   - Docs to read (repeat):
     - MCP spec (resources): https://modelcontextprotocol.io/
     - Node `node:test`: https://nodejs.org/api/test.html
     - Supertest: Context7 `/ladjs/supertest` and DeepWiki `ladjs/supertest`
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Files to edit: `server/src/test/integration/mcp-server.codex-compat.test.ts`
   - Non-negotiables: preserve key naming differences between `/mcp` and MCP v2 (`resourceTemplates` vs `resource_templates`).
14. [x] **Unit test case (update existing)** — `server/src/test/unit/mcp2-router-initialize.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-initialize.test.ts`
   - Description: MCP v2 `initialize` returns protocolVersion/capabilities/serverInfo.
   - Purpose: prove MCP v2 initialize wire format is unchanged.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Node `http`: https://nodejs.org/api/http.html
     - Node `fetch`: https://nodejs.org/api/globals.html#fetch
     - MCP spec: https://modelcontextprotocol.io/
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcp2/router.ts`, `server/src/test/unit/mcp2-router-initialize.test.ts`
   - Files to edit: `server/src/test/unit/mcp2-router-initialize.test.ts`
   - Non-negotiables: preserve `serverInfo` values and how version is sourced in MCP v2.
15. [x] **Unit test case (update existing)** — `server/src/test/unit/mcp2-router-list-happy.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-list-happy.test.ts`
   - Description: MCP v2 `tools/list` returns tool definitions when Codex is available.
   - Purpose: prove MCP v2 tool-list output stays unchanged when available.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Node `http`: https://nodejs.org/api/http.html
     - Node `fetch`: https://nodejs.org/api/globals.html#fetch
     - MCP spec (tools/list): https://modelcontextprotocol.io/
   - Files to read: `server/src/mcp2/router.ts`, `server/src/mcp2/tools.ts`, `server/src/test/unit/mcp2-router-list-happy.test.ts`
   - Files to edit: `server/src/test/unit/mcp2-router-list-happy.test.ts`
   - Non-negotiables: preserve tool list payload structure and gating conditions.
16. [x] **Unit test case (update existing)** — `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Description: MCP v2 `tools/list` returns `CODE_INFO_LLM_UNAVAILABLE (-32001)` when Codex is missing.
   - Purpose: prove MCP v2 gating behavior is unchanged.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Node `http`: https://nodejs.org/api/http.html
     - Node `fetch`: https://nodejs.org/api/globals.html#fetch
     - JSON-RPC 2.0 error envelope: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcp2/router.ts`, `server/src/mcp2/codexAvailability.ts`, `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Files to edit: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Non-negotiables: preserve `-32001` and exact error message string.
17. [x] **Unit test case (update existing)** — `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Description: MCP v2 `resources/list` returns `{ resources: [] }` and `resources/listTemplates` returns `{ resource_templates: [] }`.
   - Purpose: prove MCP v2 resource payload keys remain unchanged.
   - Docs to read (repeat):
     - MCP spec (resources): https://modelcontextprotocol.io/
     - Node `node:test`: https://nodejs.org/api/test.html
     - Node `http`: https://nodejs.org/api/http.html
     - Node `fetch`: https://nodejs.org/api/globals.html#fetch
   - Files to read: `server/src/mcp2/router.ts`, `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Files to edit: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`
   - Non-negotiables: preserve key naming differences between `/mcp` and MCP v2 (`resourceTemplates` vs `resource_templates`).
18. [x] **Unit test case (add new)** — `server/src/test/unit/mcp2-router-parse-error.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + raw `http.request`.
   - Location: `server/src/test/unit/mcp2-router-parse-error.test.ts`
   - Description: invalid JSON request body returns parse error `-32700`, `id: null`, message `"Parse error"`.
   - Purpose: prove MCP v2 parse-error behavior is unchanged after refactor.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Parse error”: https://www.jsonrpc.org/specification
     - Node `http` (raw request): https://nodejs.org/api/http.html
     - Node `node:test`: https://nodejs.org/api/test.html
   - Files to read: `server/src/mcp2/router.ts` (specifically `readBody` + `JSON.parse` try/catch patterns), `server/src/test/unit/mcp2-router-list-happy.test.ts` (for the existing `http.createServer(handleRpc)` pattern).
   - Files to edit (new): `server/src/test/unit/mcp2-router-parse-error.test.ts`
   - Suggested request snippet (keep payload invalid JSON on purpose):
     - `body: \"{ not valid json\"`
   - Non-negotiables: response must be JSON-RPC error with `id: null` and code `-32700`.
19. [x] **Unit test case (add new)** — `server/src/test/unit/mcp2-router-invalid-request.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-invalid-request.test.ts`
   - Description: invalid JSON-RPC request shape returns `-32600` `"Invalid Request"`.
   - Purpose: prove MCP v2 invalid-request behavior is unchanged after refactor.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Invalid Request”: https://www.jsonrpc.org/specification
     - Node `fetch`: https://nodejs.org/api/globals.html#fetch
     - Node `node:test`: https://nodejs.org/api/test.html
   - Files to read: `server/src/mcp2/router.ts`, `server/src/test/unit/mcp2-router-initialize.test.ts` (for the “start server, call fetch” pattern).
   - Files to edit (new): `server/src/test/unit/mcp2-router-invalid-request.test.ts`
   - Non-negotiables: preserve error code/message and `id` behavior for invalid requests (match existing implementation).
20. [x] **Unit test case (add new)** — `server/src/test/unit/mcp2-router-method-not-found.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-method-not-found.test.ts`
   - Description: unknown JSON-RPC method returns `-32601` `"Method not found"`.
   - Purpose: prove MCP v2 method-not-found behavior is unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Method not found”: https://www.jsonrpc.org/specification
     - Node `fetch`: https://nodejs.org/api/globals.html#fetch
     - Node `node:test`: https://nodejs.org/api/test.html
   - Files to read: `server/src/mcp2/router.ts`, `server/src/test/unit/mcp2-router-list-happy.test.ts` (pattern).
   - Files to edit (new): `server/src/test/unit/mcp2-router-method-not-found.test.ts`
   - Non-negotiables: preserve error code/message and response shape.
21. [x] **Unit test case (add new)** — `server/src/test/unit/mcp2-router-tool-not-found.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/unit/mcp2-router-tool-not-found.test.ts`
   - Description: `tools/call` with unknown tool name returns `-32601` with message `Tool not found: <name>`.
   - Purpose: prove MCP v2 unknown-tool mapping is unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Method not found”: https://www.jsonrpc.org/specification
     - MCP spec (tools/call): https://modelcontextprotocol.io/
     - Node `fetch`: https://nodejs.org/api/globals.html#fetch
   - Files to read: `server/src/mcp2/router.ts`, `server/src/mcp2/tools.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Files to edit (new): `server/src/test/unit/mcp2-router-tool-not-found.test.ts`
   - Non-negotiables: preserve the “unknown tool maps to method-not-found” behavior even if you disagree with it.
22. [x] **Unit test case (update existing)** — `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Description: `codebase_question` returns `content[0].type === "text"` JSON with segments order `thinking -> vector_summary -> answer`.
   - Purpose: prove MCP v2 `codebase_question` output shape is unchanged.
   - Docs to read (repeat):
     - MCP spec (tools/call result): https://modelcontextprotocol.io/
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
   - Files to read: `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Files to edit: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Non-negotiables: preserve the exact JSON string layout inside `content[0].text` (segment ordering and keys).
23. [x] **Unit test case (update existing)** — `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Description: `codebase_question` preserves conversation id and resumes the same Codex thread on follow-up.
   - Purpose: prove MCP v2 conversation continuity is unchanged.
   - Docs to read (repeat):
     - MCP spec (tools/call): https://modelcontextprotocol.io/
     - Node `node:test`: https://nodejs.org/api/test.html
   - Files to read: `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/mongo/repo.ts` (conversation persistence behavior), `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Files to edit: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Non-negotiables: do not change how `conversationId`/thread ids are generated or returned.
24. [x] **Unit test case (update existing)** — `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
   - Description: `codebase_question` is gated when Codex unavailable (returns `-32001 CODE_INFO_LLM_UNAVAILABLE`).
   - Purpose: prove MCP v2 tool gating is unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 error envelope: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
   - Files to read: `server/src/mcp2/codexAvailability.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
   - Files to edit: `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
   - Non-negotiables: preserve code `-32001` and the exact message string.
25. [x] **Unit test case (update existing)** — `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`
   - Type: Node `node:test` + `http.createServer(handleRpc)` + `fetch`.
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`
   - Description: missing required `question` returns `-32602` `"Invalid params"`.
   - Purpose: prove MCP v2 invalid-params mapping is unchanged.
   - Docs to read (repeat):
     - JSON-RPC 2.0 “Invalid params”: https://www.jsonrpc.org/specification
     - Node `node:test`: https://nodejs.org/api/test.html
   - Files to read: `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`
   - Files to edit: `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`
   - Non-negotiables: preserve code/message and any `error.data` fields.
26. [x] Update `projectStructure.md` (refactor-only) with explicit entries/updates for every **new** test file added in this task:
   - Add `server/src/test/unit/mcp2-router-parse-error.test.ts` — MCP v2 parse error contract (`-32700`) characterization.
   - Add `server/src/test/unit/mcp2-router-invalid-request.test.ts` — MCP v2 invalid request contract (`-32600`) characterization.
   - Add `server/src/test/unit/mcp2-router-method-not-found.test.ts` — MCP v2 method not found contract (`-32601`) characterization.
   - Add `server/src/test/unit/mcp2-router-tool-not-found.test.ts` — MCP v2 unknown tool mapping contract (`-32601`) characterization.
   - Docs to read (repeat, if unfamiliar with Markdown lists/code blocks): https://docs.github.com/en/get-started/writing-on-github
   - Files to read: `projectStructure.md` (existing MCP/mcp2 sections for formatting consistency)
   - Files to edit: `projectStructure.md`
   - Non-negotiables: do not rename/move files in this story; only add/update descriptions for files added by this plan.
27. [x] Files to read / edit for all tests in this task:
   - Files to read: `server/src/mcp/server.ts`, `server/src/mcp2/router.ts`, `server/src/mcp2/tools.ts`, `server/src/mcp2/errors.ts`.
   - Files to edit: all test files listed above.
   - Docs to read (repeat): MCP spec https://modelcontextprotocol.io/ and JSON-RPC spec https://www.jsonrpc.org/specification
   - Non-negotiables: treat tests as “characterization”; do not change product behavior to satisfy a refactor convenience.
28. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix` and `npm run format --workspaces`) and manually resolve remaining issues, then rerun `npm run lint --workspaces` and `npm run format:check --workspaces`.
   - Docs to read (repeat):
     - ESLint CLI: Context7 `/eslint/eslint`
     - Prettier CLI: Context7 `/prettier/prettier`
   - Non-negotiables: treat lint/format failures as blockers; fix them before moving on.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (MCP contracts + basic regressions):
   - Confirm the UI still loads and renders: `http://localhost:5001/chat` and `http://localhost:5001/logs`.
   - Confirm both MCP endpoints still respond to `initialize` and `tools/list` using the smoke commands in `README.md`.
   - Save at least one screenshot to `test-results/screenshots/` named `0000015-01-<name>.png`.
9. [x] `npm run compose:down`

#### Implementation notes

- Task 5 progress (2025-12-13): `npm run build --workspace server` ok.
- Task 5 progress (2025-12-13): `npm run build --workspace client` ok.
- Task 5 progress (2025-12-13): `npm run compose:build` ok (script runs Docker build with `--pull --no-cache`).

- `/mcp` (Express) contract highlights from `server/src/mcp/server.ts`: `initialize` returns `protocolVersion: 2024-11-05`, `capabilities.tools.listChanged=false`, and `serverInfo: {name:'codeinfo2-mcp', version:'1.0.0'}`; `resources/listTemplates` uses `resourceTemplates`; tool results are encoded as `result.content[0].type === 'text'` with `text` as a JSON string; invalid request currently yields a JSON body with no `id` key when the request has no `id` (because it is `undefined`); unknown tools map to `-32602` with message `Unknown tool <name>`; internal errors map to `-32603` with `{ data: { message: '<Error: ...>' } }`.
- MCP v2 router current behavior note: `tools/call` unknown tool maps to `-32601` with message `Tool not found: <name>` (not the generic `"Method not found"` string).
- Test updates/additions:
  - Strengthened `/mcp` integration assertions in `server/src/test/integration/mcp-server.test.ts` (explicit error messages + data payloads).
  - Strengthened MCP v2 `tools/list` contract assertion in `server/src/test/unit/mcp2-router-list-happy.test.ts` and `codebase_question` content encoding assertion in `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`.
  - Added MCP v2 router characterization tests: `server/src/test/unit/mcp2-router-parse-error.test.ts`, `server/src/test/unit/mcp2-router-invalid-request.test.ts`, `server/src/test/unit/mcp2-router-method-not-found.test.ts`, `server/src/test/unit/mcp2-router-tool-not-found.test.ts`.
- Verification run (2025-12-13):
  - Builds: `npm run build --workspace server`, `npm run build --workspace client`.
  - Tests: `npm run test --workspace server` (unit+integration+mcp2+cucumber), `npm run test --workspace client`, `npm run e2e` (passed).
  - Compose: `npm run compose:build`, `npm run compose:up`, curl smoke for `/mcp` and MCP v2 `initialize`/`tools/list`, `npm run compose:down`.
  - Screenshot saved locally (gitignored): `test-results/screenshots/0000015-01-mcp-contracts.png`.


---

### 2. Introduce a shared MCP core module

- Task Status: __done__
- Git Commits: 52e2f05, 277787e

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

1. [x] Identify the duplicated “infrastructure” code to consolidate (read both files side-by-side):
   - From `server/src/mcp/server.ts`: `jsonRpcResult`, `jsonRpcError`, `isObject`, request validation, and the method dispatch skeleton for `initialize` / `tools/list` / `tools/call` / `resources/*`.
   - From `server/src/mcp2/router.ts`: `isObject`, request validation, method dispatch skeleton for `initialize` / `tools/list` / `tools/call` / `resources/*` (note: body reading + parse error handling must remain in `mcp2/router.ts`).
   - Files to read: `server/src/mcp/server.ts`, `server/src/mcp2/router.ts`.
   - Docs to read (repeat):
     - MCP spec: https://modelcontextprotocol.io/ (and https://github.com/modelcontextprotocol/specification)
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Non-negotiables: shared code must be “infrastructure only”; do not move tool registries, gating, or error-code conventions into shared code.
2. [x] Create `server/src/mcpCommon/` with **small, mechanical** helpers only:
   - `server/src/mcpCommon/guards.ts`: shared `isObject(value)` and any other tiny type guards used by both implementations.
   - `server/src/mcpCommon/jsonRpc.ts`: shared `jsonRpcResult(id, result)` and `jsonRpcError(id, code, message, data?)`.
     - Must support arbitrary `id` and arbitrary `code` values because the two servers differ.
   - `server/src/mcpCommon/dispatch.ts`: a dispatcher function that:
     - accepts a parsed message `{ jsonrpc, id, method, params }` (do not parse JSON here),
     - provides hooks per method so each server can preserve its current response payload shapes,
     - returns a full JSON-RPC response payload that the caller can `res.json(...)` / `res.end(...)`.
   - Files to edit (new): `server/src/mcpCommon/guards.ts`, `server/src/mcpCommon/jsonRpc.ts`, `server/src/mcpCommon/dispatch.ts`.
   - Docs to read (repeat):
     - JSON-RPC 2.0 spec (request/response envelopes, `id` rules): https://www.jsonrpc.org/specification
     - TypeScript (module exports + types): Context7 `/microsoft/typescript`
   - Files to read: `server/src/mcp/server.ts`, `server/src/mcp2/router.ts`
   - Non-negotiables: **no behavior change**; these helpers must be capable of reproducing both servers’ existing payloads exactly.
   - Suggested minimal TypeScript shapes (copy/paste as a starting point, then adjust to match existing code):
     ```ts
     export type JsonRpcId = string | number | null;
     export type JsonRpcResponse =
       | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
       | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };
     ```
3. [x] Define the dispatcher API so a junior can implement without design work:
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
   - Docs to read (repeat):
     - JSON-RPC 2.0 spec (validation + method dispatch expectations): https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcp/server.ts` (existing validation/dispatch), `server/src/mcp2/router.ts` (existing validation/dispatch)
   - Non-negotiables:
     - Do not parse JSON in the dispatcher; callers own body parsing and parse errors.
     - Dispatcher must not rewrite handler payloads; it should return them verbatim.
     - Dispatcher must allow each server to keep its own error-code choices and messages.
4. [x] **Unit test case (add new)** — `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Type: Node `node:test` + `node:assert/strict`.
   - Location: `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Description: invalid request input returns the `invalidRequest(id)` handler output and does not throw.
   - Purpose: prove shared dispatcher handles invalid input safely and preserves handler outputs.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Node `assert/strict`: https://nodejs.org/api/assert.html
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcpCommon/dispatch.ts`
   - Files to edit (new): `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Non-negotiables: this test must not assume any specific error codes; it must assert “verbatim handler output” behavior.
5. [x] **Unit test case (add new)** — `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Type: Node `node:test` + `node:assert/strict`.
   - Location: `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Description: known method `initialize` routes to `handlers.initialize(id)`.
   - Purpose: prove shared dispatcher routes known methods correctly.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcpCommon/dispatch.ts`
   - Files to edit (new): `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Non-negotiables: dispatcher must not enforce response shapes beyond routing; handlers own the payload.
6. [x] **Unit test case (add new)** — `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Type: Node `node:test` + `node:assert/strict`.
   - Location: `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Description: unknown method routes to `handlers.methodNotFound(id)`.
   - Purpose: prove shared dispatcher preserves each server’s method-not-found behavior via handlers.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - JSON-RPC 2.0 “Method not found”: https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcpCommon/dispatch.ts`
   - Files to edit (new): `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Non-negotiables: unknown method handling must be delegated; do not hardcode codes/messages in shared code.
7. [x] **Unit test case (add new)** — `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Type: Node `node:test` + `node:assert/strict`.
   - Location: `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Description: dispatcher returns handler payloads verbatim (no mutation / no rewriting).
   - Purpose: guarantee “no behavior change” by ensuring the dispatcher never changes payload structures.
   - Docs to read (repeat):
     - Node `node:test`: https://nodejs.org/api/test.html
     - Node `assert/strict`: https://nodejs.org/api/assert.html
   - Files to read: `server/src/mcpCommon/dispatch.ts`
   - Files to edit (new): `server/src/test/unit/mcp-common-dispatch.test.ts`
   - Non-negotiables: treat this as the “core invariant” test for the refactor.
8. [x] Files to read / edit for dispatcher tests:
   - Files to read: `server/src/mcpCommon/dispatch.ts`.
   - Files to edit (new): `server/src/test/unit/mcp-common-dispatch.test.ts`.
   - Docs to read (repeat): Node `node:test` https://nodejs.org/api/test.html
   - Non-negotiables: keep tests small and isolated; do not require starting the full server.
9. [x] Update `projectStructure.md` (refactor-only) with explicit new entries for shared MCP core:
   - Add `server/src/mcpCommon/` with a description like “Shared MCP/JSON-RPC infrastructure used by both MCP servers (helpers/dispatch only; must not change wire formats).”
   - Add `server/src/mcpCommon/guards.ts`, `server/src/mcpCommon/jsonRpc.ts`, and `server/src/mcpCommon/dispatch.ts` with brief, specific descriptions.
   - Add `server/src/test/unit/mcp-common-dispatch.test.ts` with a description like “Unit tests for shared MCP dispatcher routing/validation.”
   - Docs to read (repeat, if unfamiliar with Markdown lists/code blocks): https://docs.github.com/en/get-started/writing-on-github
   - Files to read: `projectStructure.md`
   - Files to edit: `projectStructure.md`
   - Non-negotiables: keep file descriptions factual and specific; do not imply behavior changes.
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix` and `npm run format --workspaces`) and manually resolve remaining issues, then rerun `npm run lint --workspaces` and `npm run format:check --workspaces`.
   - Docs to read (repeat):
     - ESLint CLI: Context7 `/eslint/eslint`
     - Prettier CLI: Context7 `/prettier/prettier`
   - Non-negotiables: treat lint/format failures as blockers; fix them before moving on.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (MCP contracts + basic regressions):
   - Confirm the UI still loads and renders: `http://localhost:5001/chat` and `http://localhost:5001/logs`.
   - Confirm both MCP endpoints still respond to `initialize` and `tools/list` using the smoke commands in `README.md`.
   - Save at least one screenshot to `test-results/screenshots/` named `0000015-02-<name>.png`.
9. [x] `npm run compose:down`

#### Implementation notes

- Added `server/src/mcpCommon/` shared infrastructure module (guards, JSON-RPC helpers, dispatch skeleton) without touching either MCP server implementation yet (no runtime behavior change in this task).
- Dispatcher is intentionally “dumb”: it validates minimally (overridable) and routes `initialize/resources/tools` by method string, returning handler payloads verbatim so each MCP server can preserve its own wire-format quirks in Tasks 3–4.
- Added unit characterization `server/src/test/unit/mcp-common-dispatch.test.ts` to lock in the “verbatim handler output” invariant.
- Verification run (2025-12-13): lint/format ok, server/client builds ok, server/client tests ok, full `npm run e2e` ok, compose build/up/down ok; screenshot saved locally (gitignored) at `test-results/screenshots/0000015-02-mcp-common.png`.


---

### 3. Refactor Express MCP (`server/src/mcp/server.ts`) to use the shared core

- Task Status: __done__
- Git Commits: 863a565, b2b5c70

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

1. [x] Refactor `server/src/mcp/server.ts` in small steps:
   - Import and use `server/src/mcpCommon/guards.ts` instead of the local `isObject`.
   - Import and use `server/src/mcpCommon/jsonRpc.ts` instead of local `jsonRpcResult/jsonRpcError`.
   - Replace the inline method dispatch chain with `server/src/mcpCommon/dispatch.ts`, using handlers that return the **exact** current payloads.
   - Files to read: `server/src/mcp/server.ts`, `server/src/mcpCommon/guards.ts`, `server/src/mcpCommon/jsonRpc.ts`, `server/src/mcpCommon/dispatch.ts`.
   - Files to edit: `server/src/mcp/server.ts`.
   - Docs to read (repeat):
     - Express Router basics: Context7 `/expressjs/express`
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
     - MCP spec: https://modelcontextprotocol.io/
   - Non-negotiables: refactor only; the response wire format must be identical before/after.
2. [x] Keep these items local to `server/src/mcp/server.ts` (to avoid behavior drift):
   - tool definitions array (schemas, descriptions, output schema keys)
   - domain error mapping (including any non-standard codes like `404`, `409`, `503`)
   - `PROTOCOL_VERSION` and the exact `initialize` `serverInfo` payload (currently `name: "codeinfo2-mcp", version: "1.0.0"`).
   - Docs to read (repeat): MCP spec https://modelcontextprotocol.io/
   - Files to read: `server/src/mcp/server.ts`
   - Files to edit: `server/src/mcp/server.ts` (only if the refactor accidentally moved these items)
   - Non-negotiables: do not “standardize” codes or names; preserve existing quirks.
3. [x] Ensure dependency injection via `createMcpRouter(deps)` remains unchanged:
   - `createMcpRouter()` signature stays the same.
   - Passing overrides for `listIngestedRepositories`, `validateVectorSearch`, and `vectorSearch` keeps working (Task 1 contract tests depend on it).
   - Files to read: `server/src/mcp/server.ts`, `server/src/test/integration/mcp-server.test.ts`, `server/src/test/integration/mcp-server.codex-compat.test.ts`.
   - Files to edit: `server/src/mcp/server.ts` (only if needed to preserve injection behavior).
   - Docs to read (repeat):
     - TypeScript: Context7 `/microsoft/typescript`
     - Node `node:test` (to understand how deps are injected in tests): https://nodejs.org/api/test.html
   - Non-negotiables: do not delete or rename dependency-injection hooks; tests rely on them.
4. [x] Run only the Express MCP contract test first and fix failures by restoring previous output:
   - If `serverInfo` values, key names, or error codes differ, change the refactor until it matches the pre-refactor behavior.
   - Files to read: `server/src/test/integration/mcp-server.test.ts`, `server/src/test/integration/mcp-server.codex-compat.test.ts`.
   - Files to edit: `server/src/mcp/server.ts`.
   - Docs to read (repeat): none beyond the test files and JSON-RPC spec https://www.jsonrpc.org/specification
   - Non-negotiables: treat these tests as “contracts”; do not weaken assertions to make refactor easier.
5. [x] Update `projectStructure.md` (refactor-only) entry for `server/src/mcp/server.ts`:
   - Add a note in its description that it now uses `server/src/mcpCommon/*` for shared JSON-RPC helpers/dispatch.
   - Keep the description clear that tool definitions + domain error mapping remain owned by `server/src/mcp/server.ts`.
   - Files to edit: `projectStructure.md`.
   - Docs to read (repeat, if unfamiliar with Markdown lists/code blocks): https://docs.github.com/en/get-started/writing-on-github
   - Files to read: `projectStructure.md`
   - Non-negotiables: only update descriptions; do not rename/move files.
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix` and `npm run format --workspaces`) and manually resolve remaining issues, then rerun `npm run lint --workspaces` and `npm run format:check --workspaces`.
   - Docs to read (repeat):
     - ESLint CLI: Context7 `/eslint/eslint`
     - Prettier CLI: Context7 `/prettier/prettier`
   - Non-negotiables: treat lint/format failures as blockers; fix them before moving on.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (Express MCP contract + basic regressions):
   - Confirm `/chat` and `/logs` still render: `http://localhost:5001/chat` and `http://localhost:5001/logs`.
   - Confirm Express `POST /mcp` still responds correctly to `initialize`, `tools/list`, and a happy-path `tools/call` using the smoke commands in `README.md`.
   - Save at least one screenshot to `test-results/screenshots/` named `0000015-03-<name>.png`.
9. [x] `npm run compose:down`

#### Implementation notes

- Refactored `server/src/mcp/server.ts` to use `server/src/mcpCommon/{guards,jsonRpc,dispatch}` while preserving the existing `/mcp` wire format and error-code conventions.
- Kept tool schemas/definitions, `PROTOCOL_VERSION`, `serverInfo` payload, and domain error mapping (including `404/409/503`) owned by the Express MCP router.
- Verified Codex-compatible `tools/call` responses still return `content[0].type === "text"` with JSON-string encoding.
- Verification run (2025-12-13): lint ok, format ok, server/client builds ok, server/client tests ok, `npm run e2e` ok, compose build/up/down ok; curl smoke for `/mcp` `initialize`/`tools/list`/`tools/call` ok; screenshots saved to `test-results/screenshots/0000015-03-chat.png` and `test-results/screenshots/0000015-03-logs.png`.

---

### 4. Refactor MCP v2 router (`server/src/mcp2/router.ts`) to use the shared core

- Task Status: __done__
- Git Commits: 87f1d7f, bff802b

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

1. [x] Keep the transport-level behavior unchanged in `server/src/mcp2/router.ts`:
   - Keep `readBody(req)` as-is.
   - Keep `JSON.parse` try/catch as-is so invalid JSON produces `jsonRpcError(null, -32700, "Parse error")`.
   - Keep response headers and `res.end(JSON.stringify(payload))` behavior as-is.
   - Files to read: `server/src/mcp2/router.ts`.
   - Files to edit: `server/src/mcp2/router.ts`.
   - Docs to read (repeat):
     - Node `http` request/response handling: https://nodejs.org/api/http.html
     - JSON-RPC 2.0 “Parse error”: https://www.jsonrpc.org/specification
   - Non-negotiables: parse-error semantics and header/body handling must remain identical.
2. [x] Replace only the method-dispatch skeleton with the shared core dispatcher:
   - After parsing `message`, delegate to `dispatch(...)` with handlers that:
     - return the current `initialize` payload (including `serverInfo.version` sourced from `package.json`).
     - return the current `resources/list` payload keys.
     - return the current `resources/listTemplates` payload keys (note: do not rename keys even if inconsistent).
     - preserve the `tools/list` and `tools/call` Codex gating behavior:
       - if unavailable, return `{ error: { code: -32001, message: "CODE_INFO_LLM_UNAVAILABLE" } }` with the current structure.
   - Files to read: `server/src/mcp2/router.ts`, `server/src/mcpCommon/dispatch.ts`, `server/src/mcpCommon/guards.ts`, `server/src/mcp2/codexAvailability.ts`.
   - Files to edit: `server/src/mcp2/router.ts`.
   - Docs to read (repeat):
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
     - MCP spec: https://modelcontextprotocol.io/
     - TypeScript: Context7 `/microsoft/typescript`
   - Non-negotiables:
     - Do not rename any resource keys or error messages.
     - Preserve `CODE_INFO_LLM_UNAVAILABLE (-32001)` gating exactly.
     - Keep tool ownership in `server/src/mcp2/tools.ts` and tool implementation in `server/src/mcp2/tools/*`.
3. [x] Keep `server/src/mcp2/types.ts` and `server/src/mcp2/errors.ts` in place unless you can prove (via tests) that moving them cannot change output shape.
   - Docs to read (repeat): none required beyond JSON-RPC spec https://www.jsonrpc.org/specification
   - Files to read: `server/src/mcp2/types.ts`, `server/src/mcp2/errors.ts`
   - Non-negotiables: default to leaving these files where they are; this story is refactor-only and output-sensitive.
4. [x] Verify existing MCP v2 tests + any additions from Task 1 still pass:
   - If a test fails due to output differences, adjust the refactor to preserve original behavior.
   - Files to read: all MCP v2 contract tests listed in Task 1.
   - Files to edit: `server/src/mcp2/router.ts` (and only shared core files if the fix is truly infrastructure-only).
   - Docs to read (repeat): Node `node:test` https://nodejs.org/api/test.html
   - Non-negotiables: if a test fails due to wire-format changes, fix the implementation (don’t relax the tests).
5. [x] Update `projectStructure.md` (refactor-only) entry for `server/src/mcp2/router.ts`:
   - Add a note in its description that it now uses `server/src/mcpCommon/*` for shared guards/dispatch.
   - Keep the description clear that transport parsing (readBody/JSON.parse) + Codex gating remain owned by `server/src/mcp2/router.ts`.
   - Files to edit: `projectStructure.md`.
   - Docs to read (repeat, if unfamiliar with Markdown lists/code blocks): https://docs.github.com/en/get-started/writing-on-github
   - Files to read: `projectStructure.md`
   - Non-negotiables: only update descriptions; do not rename/move files.
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix` and `npm run format --workspaces`) and manually resolve remaining issues, then rerun `npm run lint --workspaces` and `npm run format:check --workspaces`.
   - Docs to read (repeat):
     - ESLint CLI: Context7 `/eslint/eslint`
     - Prettier CLI: Context7 `/prettier/prettier`
   - Non-negotiables: treat lint/format failures as blockers; fix them before moving on.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (MCP v2 contract + basic regressions):
   - Confirm `/chat` and `/logs` still render: `http://localhost:5001/chat` and `http://localhost:5001/logs`.
   - Confirm MCP v2 (port `MCP_PORT`) still responds correctly to `initialize`, `tools/list`, and `tools/call` for `codebase_question` (and still returns `CODE_INFO_LLM_UNAVAILABLE` when expected) using the smoke commands in `README.md`.
   - Save at least one screenshot to `test-results/screenshots/` named `0000015-04-<name>.png`.
9. [x] `npm run compose:down`

#### Implementation notes

- Refactored `server/src/mcp2/router.ts` to use the shared `server/src/mcpCommon/dispatch.ts` dispatcher and `server/src/mcpCommon/guards.ts` type guard without changing any MCP v2 wire formats.
- Kept transport ownership local to `router.ts` (readBody, JSON.parse try/catch mapping to `-32700 Parse error`, response headers, and `res.end(JSON.stringify(...))`).
- Preserved Codex availability gating for `tools/list` and `tools/call`, including `CODE_INFO_LLM_UNAVAILABLE (-32001)` shape and message, and kept the v2 resource key naming (`resource_templates`) unchanged.
- Verification run (2025-12-13): lint/format ok, server/client builds ok, server/client tests ok, `npm run e2e` ok, compose build/up/down ok; MCP v2 curl smoke for `initialize`/`tools/list`/`tools/call` ok; screenshots saved to `test-results/screenshots/0000015-04-chat.png` and `test-results/screenshots/0000015-04-logs.png`.

---

### 5. Final task – verify against acceptance criteria

- Task Status: __in_progress__
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

1. [x] Build the server (outside Docker) and confirm it exits 0:
   - `npm run build --workspace server`
   - Docs to read (repeat, if unfamiliar with npm workspaces/scripts):
     - npm workspaces: https://docs.npmjs.com/cli/v10/using-npm/workspaces
     - npm scripts: https://docs.npmjs.com/cli/v10/using-npm/scripts
   - Non-negotiables: this is a refactor-only story; if the build breaks, fix the refactor before proceeding.
2. [x] Build the client (outside Docker) and confirm it exits 0:
   - `npm run build --workspace client`
   - Docs to read (repeat, if unfamiliar with npm workspaces/scripts):
     - npm workspaces: https://docs.npmjs.com/cli/v10/using-npm/workspaces
     - npm scripts: https://docs.npmjs.com/cli/v10/using-npm/scripts
   - Non-negotiables: do not accept build failures; resolve before continuing.
3. [x] Perform a clean docker build and confirm it exits 0:
   - `npm run compose:build`
   - Docs to read (repeat):
     - Docker: Context7 `/docker/docs`
     - Docker Compose: Context7 `/docker/docs`
   - Non-negotiables: use the “clean” build (no cache) as configured by the repo script.
4. [ ] Update `README.md` (refactor-only; no behavior changes):
   - Add a short note in the MCP documentation explaining there are **two** MCP surfaces:
     - Express `POST /mcp` (tooling: `ListIngestedRepositories`, `VectorSearch`)
     - MCP v2 server on `MCP_PORT` (tooling: `codebase_question`)
   - State that their response conventions may differ and this story preserves both contracts.
   - Mention shared MCP infrastructure lives under `server/src/mcpCommon/`.
   - Files to edit: `README.md`.
   - Docs to read (repeat):
     - MCP spec: https://modelcontextprotocol.io/
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
   - Non-negotiables: documentation must explicitly state “no behavior change” and must not imply the endpoints were merged.
5. [ ] Update `design.md` (refactor-only; no behavior changes):
   - Add a short “MCP servers” section explaining:
     - Why both `server/src/mcp/*` and `server/src/mcp2/*` exist.
     - What moved to `server/src/mcpCommon/*` (guards, JSON-RPC helpers, dispatch skeleton).
     - What remains per server (transport parsing, availability gating, tool sets, domain error mapping, response-shape differences).
   - Files to edit: `design.md`.
   - Docs to read (repeat):
     - Mermaid (if adding/updating diagrams): Context7 `/mermaid-js/mermaid`
     - MCP spec: https://modelcontextprotocol.io/
   - Non-negotiables: describe ownership boundaries clearly so future devs don’t accidentally change wire formats.
6. [ ] Update `projectStructure.md` (refactor-only) explicitly with:
   - New `server/src/mcpCommon/` entries (and file descriptions).
   - New/updated MCP contract tests added in this story.
   - Updated descriptions for `server/src/mcp/server.ts` and `server/src/mcp2/router.ts` noting shared-core usage while preserving ownership boundaries.
   - Files to edit: `projectStructure.md`.
   - Docs to read (repeat, if unfamiliar with Markdown lists/code blocks): https://docs.github.com/en/get-started/writing-on-github
   - Non-negotiables: keep entries accurate and specific; list all new files added by this story.
7. [ ] Create a pull request summary comment that includes:
   - what duplication was removed,
   - what shared module(s) were introduced and why,
   - proof of “no behavior change” (which characterization/contract tests protect this),
   - which commands were run to validate (build/test/e2e/compose).
   - Docs to read (repeat, if unfamiliar):
     - GitHub Markdown: https://docs.github.com/en/get-started/writing-on-github
   - Non-negotiables: include explicit evidence of “no behavior change” (tests + manual checks) and call out that MCP v1/v2 differences were preserved.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix` and `npm run format --workspaces`) and manually resolve remaining issues, then rerun `npm run lint --workspaces` and `npm run format:check --workspaces`.
   - Docs to read (repeat):
     - ESLint CLI: Context7 `/eslint/eslint`
     - Prettier CLI: Context7 `/prettier/prettier`
   - Non-negotiables: treat lint/format failures as blockers; fix them before moving on.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check (story acceptance + regressions):
   - Confirm `/chat` renders and can send a message without UI regressions.
   - Confirm `/logs` renders and can load log history.
   - Confirm Express `POST /mcp` still responds to `initialize` + `tools/list` and returns valid tool results for both `ListIngestedRepositories` and `VectorSearch`.
   - Confirm MCP v2 (port `MCP_PORT`) still responds to `initialize` + `tools/list` and supports `tools/call` for `codebase_question` (including `CODE_INFO_LLM_UNAVAILABLE` gating behavior).
   - Save screenshots to `test-results/screenshots/` named `0000015-05-<name>.png` (minimum: `0000015-05-chat.png` and `0000015-05-logs.png`).
9. [ ] `npm run compose:down`

#### Implementation notes
