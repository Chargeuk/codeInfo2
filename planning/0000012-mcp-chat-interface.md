# Story 0000012 – Server MCP for Chat Interface

## Description

Expose a new MCP server (running on its own port) that mirrors the existing chat interface capabilities. The MCP will allow external agents to discover available repositories and ask questions against them through the same backing search/chat pipeline the frontend uses, without affecting the existing MCP server. This story plans the scope and defaults before implementation tasks are created.

### Gotchas (lessons from 0000010 Codex MCP work)

- **Tool result shape:** Codex rejected MCP tool responses wrapped as `content: [{ type: "application/json", json: {...} }]` with “Unexpected response type.” The fix was to return a single `content` item of `type: "text"` containing a JSON-stringified payload. Apply the same text response shape for all tools here.
- **Required resource methods:** Codex probes `resources/list` and `resources/listTemplates`; when unimplemented it raised `Method not found` and marked tools unavailable. Implement both (empty arrays are fine) alongside `initialize`/`tools/list`/`tools/call`.
- **SSE/tool mapping:** Codex emits `mcp_tool_call` items; server must bridge them to `tool-request` / `tool-result` SSE frames so clients see tool blocks/citations. Preserve this mapping for the new MCP endpoint.

## Acceptance Criteria

- A dedicated MCP server process (separate port/endpoint from the current MCP) is available from the Node server.
- Single tool: **codebase_question** (Codex-only) that accepts a natural-language `question` and optional `conversationId`, answers using the existing vector search + chat pipeline, and returns only the LLM text output plus optional thinking summary (no citations). The response must include a `conversationId` to support follow-up turns. No other tools are exposed.
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

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Add the second MCP server endpoint on its own port (default 5011) within the existing Node process, with JSON-RPC methods `initialize`, `tools/list`, `tools/call`, and stubs for `resources/list` + `resources/listTemplates` (empty arrays). Ensure Codex availability gating returns a clear `CODEX_UNAVAILABLE` (-32001) error instead of empty tool lists.

#### Documentation Locations
- design.md (server architecture, MCP section update)
- projectStructure.md (new server entrypoint file + config surface)
- README.md (MCP ports/env defaults)

#### Subtasks
1. [ ] Add `MCP_PORT` (default 5011) to server config:
   - Edit `server/.env` to include `MCP_PORT=5011` (keep comment explaining Codex-only MCP).
   - Add typed getter in `server/src/config.ts` (create file if missing):
     ```ts
     export const MCP_PORT = Number(process.env.MCP_PORT ?? 5011);
     ```
   - Mention `MCP_PORT` in README env table.
2. [ ] Create new entry files under `server/src/mcp2/` (keep original MCP untouched):
   - `server/src/mcp2/server.ts`: starts HTTP server on `MCP_PORT` and exports `startMcp2Server()` / `stopMcp2Server()`.
   - `server/src/mcp2/router.ts`: JSON-RPC dispatcher wired to `http.createServer` request handler.
   - `server/src/mcp2/types.ts`: types for JSON-RPC request/response envelopes and error helper.
   Use this skeleton in `router.ts`:
   ```ts
   import { IncomingMessage, ServerResponse } from 'http';
   import { jsonRpcError, jsonRpcResult } from './types.js';

   export async function handleRpc(req: IncomingMessage, res: ServerResponse) {
     // parse body, switch on method, call handlers
   }
   ```
3. [ ] Implement JSON-RPC handlers in `server/src/mcp2/router.ts`:
   - Methods: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/listTemplates`.
   - Envelope shape: `{ jsonrpc: "2.0", id, result }` or `{ jsonrpc: "2.0", id, error: { code, message } }`.
   - Error codes: `-32001` message `CODE_INFO_LLM_UNAVAILABLE` when Codex missing; `-32601` method not found; `-32602` invalid params.
   - `tools/list` returns `[ { name: "codebase_question", description: <text>, parameters: {...schema...} } ]` only when Codex available.
4. [ ] Add availability guard in `server/src/mcp2/codexAvailability.ts` (or inline) reusing existing Codex detection helper (same one the chat router uses). `tools/list` and `tools/call` must short-circuit with `CODEX_UNAVAILABLE` when unavailable.
5. [ ] Wire `server/src/index.ts` to start the new MCP server alongside the existing HTTP server and existing MCP; ensure graceful shutdown hooks close it:
   ```ts
   const mcp2 = await startMcp2Server();
   process.on('SIGINT', async () => { await mcp2.stop(); process.exit(0); });
   ```
   Keep `/health` behaviour unchanged.
6. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server` after changes.

#### Testing
1. [ ] Unit: `tools/list` returns `CODE_INFO_LLM_UNAVAILABLE` (-32001) when Codex is missing and only then; `resources/list`/`resources/listTemplates` return empty arrays.
2. [ ] Integration: start server locally (`npm run dev --workspace server`), confirm `/health` works and new MCP port accepts `initialize` + `tools/list` using curl:
   ```sh
   curl -X POST http://localhost:5011/ -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
   ```
   then tools/list.
3. [ ] Lint/format: `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Implementation notes
- 

---

### 2. Implement codebase_question tool (chat + vector search bridge)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose the single MCP tool `codebase_question(question, conversationId?)` that runs the existing chat pipeline with Codex: default model `gpt-5.1-codex-max`, reasoning `high`, sandbox `workspace-write`, approval `on-failure`, network+web search enabled. It should stream think/final only (no token chunking) and return only thinking + final text (no citations) plus the conversationId to continue the thread. Tool results must be JSON-stringified text content.

#### Documentation Locations
- design.md (describe query flow and defaults, include sample JSON-RPC request/response)
- README.md (how to call the tool + defaults, curl example)
- projectStructure.md (new tool module files under `server/src/mcp2`)

#### Subtasks
1. [ ] Define input schema in `server/src/mcp2/tools/codebaseQuestion.ts`: required `question` (string), optional `conversationId` (string), optional `limit` (number, default 5, max 20). Reject extras; emit JSON-RPC -32602 on validation failure. Add inline Zod schema example:
   ```ts
   const paramsSchema = z.object({
     question: z.string().min(1),
     conversationId: z.string().min(1).optional(),
     limit: z.number().int().min(1).max(20).optional()
   });
   ```
2. [ ] Set human-readable tool description and parameter help text to: "Ask any question about a codebase for an LLM to search and answer. The LLM has access to a vectorised set of codebases and you can ask it to name them. If you ask a question about a specific codebase, then the LLM restricts the search to only vectorised data for that repository." Apply this to the tool schema so Codex surfaces it (set on `tools/list` output and the tool definition used in `tools/call`).
3. [ ] Wire Codex chat invocation (no LM Studio fallback) using existing chat pipeline utilities: set defaults model `gpt-5.1-codex-max`, reasoning `high`, sandbox `workspace-write`, approval `on-failure`, network/web search enabled, workingDirectory `/data`, skipGitRepoCheck true. Pass `conversationId` through to Codex so threads continue when provided and return any new/continued id. Place orchestration in `server/src/mcp2/tools/codebaseQuestion.ts` and reuse vector search helper if available. Pseudocode:
   ```ts
   const chatResult = await runCodexChat({ question, limit, conversationId, defaults, vectorSearchClient });
   const { answer, thinking, modelId, conversationId: nextConversationId } = chatResult;
   ```
4. [ ] Map Codex `mcp_tool_call` events to SSE `tool-request/result`; buffer thinking/final internally and do not forward intermediate tokens. Ensure streaming only sends think/final (no token chunks) before packaging final result.
5. [ ] Shape the `tools/call` result as single `content` item `{ type: "text", text: JSON.stringify({ answer, thinking, modelId, limitUsed, conversationId: nextConversationId }) }` and set proper JSON-RPC envelope; add error mapping for Codex unavailable (-32001) and validation (-32602). Example response body:
   ```json
   { "jsonrpc":"2.0", "id":1, "result": { "content": [ { "type":"text", "text":"{\"answer\":\"...\",\"thinking\":\"...\",\"modelId\":\"gpt-5.1-codex-max\",\"limitUsed\":5,\"conversationId\":\"thread-123\"}" } ] } }
   ```
6. [ ] Add unit helpers/mocks under `server/src/test/mcp2/tools/codebaseQuestion.test.ts` (or similar) to simulate Codex + vector search; include a fixture JSON-RPC request/response snapshot for juniors.
7. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server` after code changes.

#### Testing
1. [ ] Unit/integration: happy path streams think/final and yields JSON-stringified result with answer/thinking only (no citations) and returns a conversationId; verify the supplied conversationId threads the follow-up call.
2. [ ] Unit: validation errors for missing question / bad limit map to -32602.
3. [ ] Integration: Codex-unavailable path returns `CODE_INFO_LLM_UNAVAILABLE` error for `tools/call`.

#### Implementation notes
- 

---

### 3. Final validation and documentation sweep

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Verify the end-to-end MCP server works without regressing existing endpoints. Refresh documentation and structure maps to include the new MCP entrypoint and tools.

#### Documentation Locations
- README.md (new MCP endpoint, env, usage)
- design.md (finalised MCP flow, defaults, error handling)
- projectStructure.md (new files, ports)

#### Subtasks
1. [ ] Run `npm run lint --workspaces` and `npm run test --workspace server`.
2. [ ] Smoke: start server (`npm run dev --workspace server`), call new MCP port with JSON-RPC `initialize` then `tools/list` and `tools/call` for `codebase_question`; confirm `/health` on main API still OK.
3. [ ] Update README.md (env, port 5011, curl example for `codebase_question`), design.md (MCP flow diagram + sample request/response), and projectStructure.md (list new `server/src/mcp2/*` files) **in this task**, even if previously noted elsewhere.
4. [ ] Capture Implementation notes and commit hashes; mark task done.

#### Testing
1. [ ] `npm run lint --workspaces`
2. [ ] `npm run test --workspace server`
3. [ ] Manual: start server, call `tools/list` and `codebase_question` via JSON-RPC on port 5011 (Codex available) and verify behaviour when Codex disabled.

#### Implementation notes
- 
