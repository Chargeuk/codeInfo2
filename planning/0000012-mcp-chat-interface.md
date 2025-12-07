# Story 0000012 – Server MCP for Chat Interface

## Description

Expose a new MCP server (running on its own port) that mirrors the existing chat interface capabilities. The MCP will allow external agents to discover available repositories and ask questions against them through the same backing search/chat pipeline the frontend uses, without affecting the existing MCP server. This story plans the scope and defaults before implementation tasks are created.

### Gotchas (lessons from 0000010 Codex MCP work)

- **Tool result shape:** Codex rejected MCP tool responses wrapped as `content: [{ type: "application/json", json: {...} }]` with “Unexpected response type.” The fix was to return a single `content` item of `type: "text"` containing a JSON-stringified payload. Apply the same text response shape for all tools here.
- **Required resource methods:** Codex probes `resources/list` and `resources/listTemplates`; when unimplemented it raised `Method not found` and marked tools unavailable. Implement both (empty arrays are fine) alongside `initialize`/`tools/list`/`tools/call`.
- **SSE/tool mapping:** Codex emits `mcp_tool_call` items; server must bridge them to `tool-request` / `tool-result` SSE frames so clients see tool blocks/citations. Preserve this mapping for the new MCP endpoint.

## Acceptance Criteria

- A dedicated MCP server process (separate port/endpoint from the current MCP) is available from the Node server.
- Single tool: **codebase_question** (Codex-only) that accepts a natural-language `question` and optional `conversationId`, answers using the existing vector search + chat pipeline, and returns only the LLM text output plus optional thinking segments and minimal vector-search summaries (no full citations). The response must include a `conversationId` to support follow-up turns and must preserve the ordering of thinking, vector summaries, and answering as emitted (do not coalesce by type). No other tools are exposed.
- Server picks sensible defaults for Codex model, sandbox/approval/network/search flags, and limits so MCP callers need minimal parameters; no LM Studio fallback is ever used.
- Tool results use a single `content` item of type `text` containing JSON-stringified payloads (per Codex MCP requirements).
- Existing MCP server and HTTP APIs continue to function unchanged; enabling the new MCP does not regress current chat or tooling flows.
- Availability fallback: the new MCP server must start even when Codex is unavailable, but every `tools/list`/`tools/call` request must return a clear JSON-RPC error (e.g., code -32001 `CODE_INFO_LLM_UNAVAILABLE`) rather than exposing empty tools or falling back to LM Studio; health signalling should match this behaviour.

## Out Of Scope

- Persisting MCP conversations beyond a single request/response.
- Adding new embedding/ingest capabilities; reuse current ingest data only.
- Frontend changes; this story is server-only wiring.
- Authentication/authorization for the new MCP (assume same open access as current internal tools).
- Introducing additional rate/concurrency/body-size limits; we rely on existing server defaults because Codex usage is prepaid/authenticated.

## Decisions (so far)

- Provider support: this MCP is **Codex-only**. If Codex is unavailable, the MCP endpoint should expose no tools (or surface a clear disabled/availability error) rather than falling back to LM Studio.
- Default model/effort: **gpt-5.1-codex-max** with **high** reasoning effort.
- MCP port: configurable via environment variable, default **5011**, exposed from the existing server process (not a separate service) as an additional entry point into the current chat/tooling logic.
- Limits: rely on existing server defaults; no extra concurrency/rate/body-size caps are added because Codex usage is prepaid by logged-in users.
- Query flow: reuse the current frontend chat pipeline (Codex drives tool calls to vector search/ingest data); for this MCP we expose only Codex models and do not define a custom flow beyond what the existing chat stack does.
- Prompting: we will need a Codex-specific system prompt (separate from the shared LM Studio `SYSTEM_CONTEXT`)—add a task to create/swap this prompt during implementation.
- Observability: everything streamed out to MCP callers (tokens, think/final frames, tool request/result metadata) must be logged with requestIds while redacting sensitive payloads as per existing logging policy.
- Resource methods: out of scope (no `resources/list` or templates beyond required stubs); the MCP will expose a single tool `codebase_question` that requires `question` and accepts an optional `repository` name.

## Questions

- Limits: no additional limits beyond current server behaviour (no explicit caps on tokens/chunks/concurrency/timeout for this MCP).
- Repo access: no per-repo allow/deny lists are required for this MCP.
- Streaming shape: QueryRepository should stream, but only include thinking information and the final answer (no token-by-token partials).
- Defaults: sandbox, approval, network, and web-search flags should mirror the web (UI) defaults, but be configurable via server environment variables for this MCP.
- Unavailability signalling: when Codex is missing, `tools/list` and `tools/call` should return a JSON-RPC error (e.g., code -32001, `CODEX_UNAVAILABLE`, clear message) instead of an empty tool list; avoid LM Studio fallback and keep the signal consistent even if Codex drops mid-run.

## Implementation Plan

Follow the standard plan workflow (copied from `plan_format.md`):

1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit & push that change, and only then begin implementation.
4. For each task, execute every subtask sequentially: before starting a subtask, read the documentation sources listed in that task; after finishing the subtask, run the relevant linters/formatters (Python + TypeScript) and fix issues before continuing.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, move on to the Testing section and work through the tests in order.
7. Once a test is complete, mark its checkbox.
8. After tests pass, perform every documentation update listed for the task.
9. Once a document is updated, mark its checkbox.
10. When all subtasks, tests, documentation updates, and verification commands are complete, consider the task finished and follow points 11–13 below.
11. As soon as a task’s implementation is done, add detailed notes in the Implementation notes section covering the code changes, decisions made, and any issues encountered. Push immediately after writing the notes.
12. Record the relevant git commit hash(es) in the Git Commits section. Once they are pushed, set the task status to `Done`, and push again so both the commit IDs and updated status are captured in this document.
13. After a task is fully documented (status, notes, commits), proceed to the next task and repeat the same process.

## Tasks

### 1. Scaffold Codex-only MCP server entrypoint

- Task Status: __done__
- Git Commits: a067088

#### Overview
Add the second MCP server endpoint on its own port (default 5011) within the existing Node process, with JSON-RPC methods `initialize`, `tools/list`, `tools/call`, and stubs for `resources/list` + `resources/listTemplates` (empty arrays). Ensure Codex availability gating returns a clear `CODEX_UNAVAILABLE` (-32001) error instead of empty tool lists.

#### Documentation Locations (external)
- JSON-RPC 2.0 specification (to follow envelope/params/error codes): https://www.jsonrpc.org/specification
- Node.js HTTP server docs (for createServer + request parsing): https://nodejs.org/api/http.html
- OpenAI MCP tool/result format rules (single text content item, tool list shape): https://platform.openai.com/docs/assistants/tools?context=mcp
- Mermaid diagrams (Context7): `/mermaid-js/mermaid` for any new flow diagrams added to design.md.
- Jest docs (Context7): `/jestjs/jest` for unit/integration test APIs.

#### Subtasks
1. [x] Config wiring (file paths + command):
   - Edit `server/.env`: add `MCP_PORT=5011` with a comment "Codex-only MCP JSON-RPC port".
   - Edit/create `server/src/config.ts`:
     ```ts
     export const MCP_PORT = Number(process.env.MCP_PORT ?? 5011);
     ```
   - Command to run now: `npm run format:check --workspace server`.
2. [x] Create MCP v2 server files (explicit paths + starter code):
   - `server/src/mcp2/server.ts`:
     ```ts
     import http from 'http';
     import { MCP_PORT } from '../config.js';
     import { handleRpc } from './router.js';

     let server: http.Server;
     export function startMcp2Server() {
       server = http.createServer(handleRpc);
       server.listen(MCP_PORT);
       return server;
     }
     export function stopMcp2Server() {
       return new Promise<void>((resolve) => server?.close(() => resolve()));
     }
     ```
   - `server/src/mcp2/types.ts`: define `JsonRpcRequest`, `JsonRpcResponse`, `jsonRpcError(code,message)`, `jsonRpcResult(id,result)`.
   - Command to run after creating: `npm run lint --workspace server`.
3. [x] Router skeleton (ordered code block): edit `server/src/mcp2/router.ts`:
   ```ts
   import { IncomingMessage, ServerResponse } from 'http';
   import { jsonRpcError, jsonRpcResult } from './types.js';
   import { isCodexAvailable } from './codexAvailability.js';
   import { listTools, callTool } from './tools.js';

   export async function handleRpc(req: IncomingMessage, res: ServerResponse) {
     // parse JSON body, switch on method, return jsonRpcResult/error
   }
   ```
   Methods to implement: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/listTemplates`.
   Error codes: `-32001` message `CODE_INFO_LLM_UNAVAILABLE`; `-32601` method not found; `-32602` invalid params.
   Command after edit: `npm run lint --workspace server`.
4. [x] Availability guard: create `server/src/mcp2/codexAvailability.ts` using existing chat Codex detection helper (import from its module). `tools/list`/`tools/call` must return `CODE_INFO_LLM_UNAVAILABLE` when false. Command: `npm run lint --workspace server`.
5. [x] Bootstrap: edit `server/src/index.ts` to call `startMcp2Server()` and on SIGINT call `stopMcp2Server()`; keep `/health` untouched. Command: `npm run lint --workspace server`.
6. [x] Design doc: update `design.md` with a mermaid diagram showing HTTP server, existing MCP, and new MCP (port 5011) flow; cite `/mermaid-js/mermaid` syntax. Command: `npm run format:check --workspaces`.
7. [x] Final check for this task: run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing (separate subtasks)
1. [x] Unit test (server/src/test/mcp2/router.list.unavailable.test.ts): `tools/list` returns `CODE_INFO_LLM_UNAVAILABLE` (-32001) when Codex is missing; `resources/list` and `resources/listTemplates` return empty arrays.
2. [x] Integration test (server/src/test/mcp2/router.list.happy.test.ts): start server (`npm run dev --workspace server`), call `initialize` then `tools/list` on port 5011; assert single tool returned and `/health` still OK.
3. [x] `npm run build --workspace server`
4. [x] `npm run build --workspace client`
5. [x] `npm run test --workspace server`
6. [x] `npm run test --workspace client`
7. [x] `npm run e2e`
8. [x] `npm run compose:build`
9. [x] `npm run compose:up`
10. [x] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
11. [x] `npm run compose:down`

#### Implementation notes
- Added `MCP_PORT` env default (5011) and shared `server/src/config.ts` export, plus new `server/src/mcp2` server/router/types/tools stubs with Codex availability gating via `isCodexAvailable` (env override for tests). Startup now launches the Codex-only MCP listener alongside Express and shuts it down on signals.
- Router handles initialize/tools/resources methods, returns `CODE_INFO_LLM_UNAVAILABLE` when Codex missing, and keeps empty resource lists for compatibility; doc flow updated in `design.md` with dual MCP mermaid diagram.
- Guarded `clearLockedModel` to ignore missing collection `ChromaNotFoundError` to stabilize ingest cleanup.
- Added unit coverage for MCP v2 list/unavailable cases; server/client builds, full server tests, and Playwright e2e suite now pass. Captured manual UI screenshots (home/chat/logs) at `test-results/screenshots/0000012-01-*.png` with headless Playwright.

---

### 2. Implement codebase_question tool (chat + vector search bridge)

- Task Status: __done__
- Git Commits: b4db0a20fb4d6588c4e4e1d76fe5c6cceaa309e9

#### Overview
Expose the single MCP tool `codebase_question(question, conversationId?)` that runs the existing chat pipeline with Codex: default model `gpt-5.1-codex-max`, reasoning `high`, sandbox `workspace-write`, approval `on-failure`, network+web search enabled. It should stream think/final only (no token chunking) and return ordered segments combining thinking, minimal vector-search summaries, and final text (no full citations) plus the conversationId to continue the thread. Preserve the chronological order of segments as emitted—do not coalesce by type. Vector/search limits remain internal—no limit parameter is exposed. Tool results must be JSON-stringified text content.

#### Documentation Locations (external)
- JSON-RPC 2.0 specification (tools/list, tools/call envelopes & errors): https://www.jsonrpc.org/specification
- Zod schema docs (parameter validation patterns): https://zod.dev/?id=basic-usage
- OpenAI MCP tool content rules (single text content item, tool definition fields): https://platform.openai.com/docs/assistants/tools?context=mcp
- Mermaid diagrams (Context7): `/mermaid-js/mermaid` for any flow added to design.md describing codebase_question.
- Jest docs (Context7): `/jestjs/jest` for unit/integration tests of codebase_question.

#### Subtasks
1. [x] Define input schema (file + code): edit `server/src/mcp2/tools/codebaseQuestion.ts` to validate params with Zod:
   ```ts
   const paramsSchema = z.object({
     question: z.string().min(1),
     conversationId: z.string().min(1).optional()
   });
   ```
   Reject extras; on validation failure return JSON-RPC -32602. Command: `npm run lint --workspace server`.
2. [x] Tool description: in `server/src/mcp2/tools/list.ts` (or router list handler) set description/parameter help to the provided sentence so Codex surfaces it. Command: `npm run format:check --workspace server`.
3. [x] Orchestration wiring (file + snippet): in `server/src/mcp2/tools/codebaseQuestion.ts` call existing chat pipeline with defaults (model `gpt-5.1-codex-max`, reasoning `high`, sandbox `workspace-write`, approval `on-failure`, network/web search enabled, workingDirectory `/data`, skipGitRepoCheck true) and pass conversationId through:
   ```ts
   const chatResult = await runCodexChat({ question, conversationId, defaults, vectorSearchClient });
   const { segments, modelId, conversationId: nextConversationId } = chatResult;
   ```
   Keep vector limits internal. Command: `npm run lint --workspace server`.
4. [x] Segment assembly (ordered): ensure `runCodexChat` (or adapter layer) builds ordered `segments` with types `thinking`, `vector_summary` (files: relPath, match, chunks, lines), and `answer`, preserving stream order. No citations. Command: `npm run lint --workspace server`.
5. [x] Response shaping (code + example): shape `tools/call` result as single text content:
   ```ts
   const payload = { segments, conversationId: nextConversationId, modelId };
   return jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(payload) }] });
   ```
   Example JSON (ordered segments) stays as shown in the plan. Command: `npm run format:check --workspace server`.
6. [x] Tests scaffolding (files): create
   - `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`
   - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
   Use Jest (Context7 `/jestjs/jest`) and fixtures matching the example payload. Command after adding: `npm run test --workspace server` (or targeted jest if available).
7. [x] Run `npm run lint --workspace server` and `npm run format:check --workspace server` after all code for this task. fix any issues.

#### Testing (separate subtasks)
1. [x] Unit test (server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts): missing question or bad limit returns JSON-RPC -32602.
2. [x] Unit/integration test (server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts): happy path streams think/final, returns ordered `segments` array (thinking, vector_summary, answer) JSON-stringified with `modelId` and `conversationId`; verify provided conversationId threads a follow-up call and segment order is preserved.
3. [x] Integration test (server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts): when Codex unavailable, `tools/call` returns `CODE_INFO_LLM_UNAVAILABLE` (-32001).
4. [x] `npm run build --workspace server`
5. [x] `npm run build --workspace client`
6. [x] `npm run test --workspace server`
7. [x] `npm run test --workspace client`
8. [x] `npm run e2e`
9. [x] `npm run compose:build`
10. [x] `npm run compose:up`
11. [x] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
12. [x] `npm run compose:down`

#### Implementation notes
- Added Codex-only `codebase_question` tool with strict Zod validation, default Codex thread options (workspace-write sandbox, on-failure approval, network/web search on, reasoning high), and prompt wiring that preserves conversationId threading.
- Stream parser now collects ordered segments (thinking deltas, vector_summary aggregation with relPath/match/chunk/line counts, and final answer) and returns JSON-stringified text content for MCP compatibility.
- Introduced test hooks to inject mock Codex factories, expanded tool list/call routing, and added dedicated unit tests for validation, happy path, and Codex-unavailable cases; updated server scripts to include new test glob.
- Ran full builds/tests (server, client, e2e), main compose build/up/down, and captured manual UI screenshots at `test-results/screenshots/0000012-02-home.png` and `test-results/screenshots/0000012-02-chat.png` while the stack was up.

---

### 3. Final validation and documentation sweep

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Verify the end-to-end MCP server works without regressing existing endpoints. Refresh documentation and structure maps to include the new MCP entrypoint and tools.

#### Documentation Locations (external)
- README/Markdown guidance (structure/examples): https://docs.github.com/en/get-started/writing-on-github
- Mermaid diagrams (Context7): `/mermaid-js/mermaid` for documenting the final MCP flow in design.md.
- JSON-RPC 2.0 specification (to document sample requests/responses): https://www.jsonrpc.org/specification
- Jest docs (Context7): `/jestjs/jest` for any referenced Jest examples in docs.
- Cucumber guides (for any BDD mentions): https://cucumber.io/docs/guides/

#### Subtasks
1. [ ] Run `npm run lint --workspaces` and `npm run test --workspace server`.
2. [ ] Smoke: start server (`npm run dev --workspace server`), call new MCP port with JSON-RPC `initialize` then `tools/list` and `tools/call` for `codebase_question`; confirm `/health` on main API still OK.
3. [ ] Update README.md (exact items):
   - Add `MCP_PORT` to env table.
   - Add a "MCP (codebase_question)" section with JSON-RPC curl example and response shape (ordered segments + conversationId, error code `CODE_INFO_LLM_UNAVAILABLE`).
   Command: `npm run format:check --workspaces`.
4. [ ] Update design.md (flow + mermaid): add final MCP flow description, defaults, error handling, conversationId threading, ordered segments (thinking/vector_summary/answer), and a mermaid diagram using Context7 `/mermaid-js/mermaid`. Command: `npm run format:check --workspaces`.
5. [ ] Update projectStructure.md: list new `server/src/mcp2` files (server.ts, router.ts, types.ts, codexAvailability.ts, tools/codebaseQuestion.ts, tests) and mention port 5011. Command: `npm run format:check --workspaces`.
6. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server` after all code for this task. fix any issues.
7. [ ] Capture Implementation notes and commit hashes; mark task done.

#### Testing (separate subtasks)
1. [ ] Repo-wide lint (command): `npm run lint --workspaces`.
2. [ ] Server test suite (command): `npm run test --workspace server` (covers new MCP tests).
3. [ ] Manual verification: start server (`npm run dev --workspace server`), call `initialize`, `tools/list`, and `codebase_question` on port 5011 with and without Codex availability to observe `CODE_INFO_LLM_UNAVAILABLE` behaviour.
4. [ ] `npm run build --workspace server`
5. [ ] `npm run build --workspace client`
6. [ ] `npm run test --workspace server`
7. [ ] `npm run test --workspace client`
8. [ ] `npm run e2e`
9. [ ] `npm run compose:build`
10. [ ] `npm run compose:up`
11. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the whole story and save screenshots against the previously started docker stack. Do NOT miss this step!
12. [ ] `npm run compose:down`

#### Implementation notes
- 
