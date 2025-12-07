# Story 0000012 – Server MCP for Chat Interface

## Description

Expose a new MCP server (running on its own port) that mirrors the existing chat interface capabilities. The MCP will allow external agents to discover available repositories and ask questions against them through the same backing search/chat pipeline the frontend uses, without affecting the existing MCP server. This story plans the scope and defaults before implementation tasks are created.

### Gotchas (lessons from 0000010 Codex MCP work)

- **Tool result shape:** Codex rejected MCP tool responses wrapped as `content: [{ type: "application/json", json: {...} }]` with “Unexpected response type.” The fix was to return a single `content` item of `type: "text"` containing a JSON-stringified payload. Apply the same text response shape for all tools here.
- **Required resource methods:** Codex probes `resources/list` and `resources/listTemplates`; when unimplemented it raised `Method not found` and marked tools unavailable. Implement both (empty arrays are fine) alongside `initialize`/`tools/list`/`tools/call`.
- **SSE/tool mapping:** Codex emits `mcp_tool_call` items; server must bridge them to `tool-request` / `tool-result` SSE frames so clients see tool blocks/citations. Preserve this mapping for the new MCP endpoint.

## Acceptance Criteria

- A dedicated MCP server process (separate port/endpoint from the current MCP) is available from the Node server.
- Single tool: **codebase_question** (Codex-only) that accepts a natural-language `question`, answers using the existing vector search + chat pipeline, and returns citations where possible. No other tools are exposed.
- Server picks sensible defaults for Codex model, sandbox/approval/network/search flags, and limits so MCP callers need minimal parameters; no LM Studio fallback is ever used.
- Tool results use a single `content` item of type `text` containing JSON-stringified payloads (per Codex MCP requirements).
- Existing MCP server and HTTP APIs continue to function unchanged; enabling the new MCP does not regress current chat or tooling flows.
- Availability fallback: the new MCP server must start even when Codex is unavailable, but every `tools/list`/`tools/call` request must return a clear JSON-RPC error (e.g., code -32001 `CODEX_UNAVAILABLE`) rather than exposing empty tools or falling back to LM Studio; health signalling should match this behaviour.

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
1. [ ] Add server config/env wiring for `MCP_PORT` defaulting to 5011; ensure it is documented and validated.
2. [ ] Create MCP router/handler module exposing `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/listTemplates`, returning JSON-RPC 2.0 envelopes.
3. [ ] Implement Codex-availability guard that short-circuits `tools/list`/`tools/call` with `CODEX_UNAVAILABLE` error when Codex CLI/auth/config are missing, while still allowing other methods to respond.
4. [ ] Wire server bootstrap to start the new MCP listener without affecting existing MCP/HTTP endpoints; include graceful shutdown hooks.
5. [ ] Update lint/format if new files added; run root lint for touched areas.

#### Testing
1. [ ] Unit: handler returns empty tools + proper error code when Codex unavailable.
2. [ ] Unit/integration: `resources/list` and `resources/listTemplates` return empty arrays and do not throw.
3. [ ] Integration: server starts both MCP endpoints concurrently; existing `/health` remains OK.

#### Implementation notes
- 

---

### 2. Implement codebase_question tool (chat + vector search bridge)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose the single MCP tool `codebase_question(question)` that runs the existing chat pipeline with Codex: default model `gpt-5.1-codex-max`, reasoning `high`, sandbox `workspace-write`, approval `on-failure`, network+web search enabled. It should stream think/final only (no token chunking) and surface citations from vector search. Tool results must be JSON-stringified text content.

#### Documentation Locations
- design.md (describe query flow and defaults)
- README.md (how to call the tool + defaults)
- projectStructure.md (new tool module, any helper files)

#### Subtasks
1. [ ] Define input schema: required `question`, optional `limit` (<=20) aligned with vector search defaults.
2. [ ] Set human-readable tool description and parameter help text to: "Ask any question about a codebase for an LLM to search and answer. The LLM has access to a vectorised set of codebases and you can ask it to name them. If you ask a question about a specific codebase, then the LLM restricts the search to only vectorised data for that repository." Apply this to the MCP schema so Codex surfaces it.
3. [ ] Wire Codex chat invocation reusing existing system prompt + flags (workingDirectory=/data, skipGitRepoCheck:true); ensure no LM Studio fallback.
4. [ ] Map Codex `mcp_tool_call` events to SSE `tool-request/result` and capture vector search citations in the final payload.
5. [ ] Shape the response as single `text` content containing JSON { answer, citations, modelId } and ensure errors surface via JSON-RPC.
6. [ ] Run lint/format for touched modules.

#### Testing
1. [ ] Unit/integration: happy path streams think/final and yields JSON-stringified result with citations present when vector data exists.
2. [ ] Unit: validation errors for missing question / bad limit map to -32602.
3. [ ] Integration: Codex-unavailable path returns `CODEX_UNAVAILABLE` error for `tools/call`.

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
2. [ ] Smoke: start server and confirm both MCP endpoints respond; check `/health` remains ok.
3. [ ] Update README.md, design.md, projectStructure.md with final MCP details and file additions.
4. [ ] Capture Implementation notes and commit hashes; mark task done.

#### Testing
1. [ ] `npm run lint --workspaces`
2. [ ] `npm run test --workspace server`
3. [ ] Manual: start server, call `tools/list` and `codebase_question` via JSON-RPC on port 5011 (Codex available) and verify behaviour when Codex disabled.

#### Implementation notes
- 
