# Story 0000006 – LMStudio Chroma Tools

## Description

Give the LM Studio-backed assistant the ability to answer questions using the existing Chroma vector store. Add agent tools that (a) list previously ingested repositories and (b) run vector searches over stored chunks, optionally scoped to a specific repository. The goal is to let the agent ground answers in ingested repo content without exposing raw database plumbing to end users. The experience should feel like “ask the assistant about the codebase” with results filtered to relevant docs and repositories already processed by the ingest pipeline.

- ## Acceptance Criteria

- LM Studio agent exposes two tools: **ListIngestedRepositories** (returns names/ids and basic metadata) and **VectorSearch** (inputs: query text, optional repository identifier; outputs: ordered matches with source metadata and snippets).
- Vector search respects an optional repository filter so results can be constrained to one ingested repo; defaults to all ingested data when no filter is provided.
- Tools leverage the existing Chroma ingest collections and metadata (runId/root name/path/model, hashes, timestamps) without duplicating data or bypassing model-lock rules; assume the single locked embedding model already enforced by ingest.
- Tool responses include enough provenance (repo name/identifier, relative path, snippet, maybe chunk hash or offset info) for the assistant to surface inline citations to the user.
- Vector search returns the full stored chunk text (from Chroma `documents`) plus the file path (repo + relative path) so the agent can show inline citations with precise source context. The tool also returns a host-resolvable path by rewriting the stored ingest path (mounted as `/data` in containers) back to the host’s `HOST_INGEST_DIR`, so the LM Studio host-side agent can open files when needed, and the chat bubble must display the human-friendly file path alongside the result.
- Error handling is clear: empty repository list, missing/unknown repository filter, and Chroma/LM Studio failures surface actionable messages to the agent (and onward to the user).
- Security/guardrails: queries cannot execute arbitrary DB operations; access limited to read-only list/search on the ingest collections.
- Performance: sensible defaults for vector search (top-k/threshold) that keep responses fast enough for interactive chat (target under a few seconds with current data sizes). No extra chunk-size capping beyond existing ingest chunking in this story.
- Filtering: repository filter only; no extension/path-prefix filters in this story.

## Out Of Scope

- Re-ingest, delete, or modify embeddings (handled by existing ingest UI/APIs).
- Multi-tenant auth/ACLs or per-user data isolation.
- Cross-vector-store federation or non-Chroma backends.
- UI changes beyond what the agent surface requires (no new client pages; chat UI may only need minimal affordances if any).
- Full citation rendering/UX polish in the client (focus on tool plumbing first).
- Tuning or exposing LLM/vector parameters (topK/topP/temperature/score thresholds) beyond baked-in sensible defaults.
- Supporting multiple embedding models or per-model routing (ingest remains locked to a single model).

## Questions

- None outstanding for this story (chunk size capping and additional filters deferred).

## Implementation Plan

### Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks. This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit & push that change, and only then begin implementation.
4. For each task, execute every subtask sequentially: before starting a subtask, read the documentation sources listed in that task; after finishing the subtask, run the relevant linters/formatters (Python + TypeScript) and fix issues before continuing.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, Move on to the Testing section and work through the tests in order.
7. Once a test is complete, mark its checkbox.
8. After tests pass, perform every documentation update listed for the task.
9. Once a document is updated, mark its checkbox.
10. When all subtasks, tests, documentation updates, and verification commands are complete, consider the task finished and follow points 11–13 below.
11. As soon as a task’s implementation is done, add detailed notes in the Implementation notes section covering the code changes, decisions made, and any issues encountered. Push immediately after writing the notes.
12. Record the relevant git commit hash(es) in the Git Commits section. Once they are pushed, set the task status to `Done`, and push again so both the commit IDs and updated status are captured in this document.
13. After a task is fully documented (status, notes, commits), proceed to the next task and repeat the same process.

## Tasks

### 1. Server – Chroma tooling API

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose read-only server endpoints that back the LM Studio tools: list ingested repositories and perform vector search over stored chunks, with repository scoping and host-path rewriting so the agent can open files on the host.

#### Documentation Locations

- Existing ingest metadata structures: `server/src/ingest/chromaClient.ts`, `server/src/routes/ingestRoots.ts`
- Chroma JS client docs: https://docs.trychroma.com/ or Context7 `/websites/trychroma`
- Host path mapping: current compose/env usage of `HOST_INGEST_DIR` and `/data` mount (see `docker-compose.yml`, `server/.env`)
- Express routing patterns: Context7 `/expressjs/express`

#### Subtasks

1. [ ] Add a path translation helper (e.g., `server/src/ingest/pathMap.ts`) that rewrites stored ingest paths (mounted at `/data`) back to `HOST_INGEST_DIR`, returning both container and host paths plus repo/name metadata.
2. [ ] Implement `GET /tools/ingested-repos` (or similar) reusing the ingest roots collection to return: repo identifier (ingest name or root), description, path (container + host path), last ingest timestamp, model id, counts, last error. Handle empty lists gracefully.
3. [ ] Implement `POST /tools/vector-search` that accepts `{ query: string, repository?: string, limit?: number }`, validates input, scopes to a repo when provided, queries Chroma for top-k matches, and returns: score, full chunk text, repo identifier, relative path, host-resolvable path, chunk hash/ids for provenance.
4. [ ] Ensure responses never bypass the ingest model lock; reuse existing collections/metadata and avoid write operations. Add clear error payloads for missing repo, bad input, or Chroma failures.
5. [ ] Wire routes into `server/src/index.ts` (CORS consistent), add logging for tool calls, and document new env requirements if any (e.g., `HOST_INGEST_DIR`).
6. [ ] Add Cucumber coverage: new features under `server/src/test/features/tools-*.feature` and steps under `server/src/test/steps/tools-*.steps.ts` covering repo list empty/non-empty, search with/without repo filter, host-path rewrite, and error handling.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server` (unit + Cucumber)

#### Implementation notes

- 

---

### 2. Server – LM Studio tool wiring

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose the new list/search capabilities as LM Studio tool definitions used by the chat route, including metadata needed for inline citations and host path display.

#### Documentation Locations

- LM Studio SDK tooling docs: https://lmstudio.ai/docs/typescript/tooling
- Existing chat route/streaming: `server/src/routes/chat.ts`, `server/src/chatStream.ts`
- Client pool: `server/src/lmstudio/clientPool.ts`

#### Subtasks

1. [ ] Define LM Studio tool schemas for `ListIngestedRepositories` and `VectorSearch`, matching server API inputs/outputs (including host path, repo id, relative path, score, chunk text).
2. [ ] Integrate tools into the chat handler so tool calls invoke the new server logic (or shared helpers), streaming results into the assistant response with minimal additional latency.
3. [ ] Ensure tool responses preserve provenance data for citations and that errors are surfaced as actionable messages to the user.
4. [ ] Add unit/integration coverage (Jest or Cucumber) for tool invocation paths to confirm correct wiring and error propagation.
5. [ ] Update server logging to record tool usage (without leaking payload text beyond what logs already allow) for observability.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes

- 

---

### 3. Client – Chat UI citations & file path visibility

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Render tool results in the chat UI with inline citations showing the human-friendly file path, and ensure users can see which repo/file a chunk came from.

#### Documentation Locations

- Existing chat UI/hooks: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, `client/src/components` chat bubbles
- Testing: `client/src/test/chatPage.*.test.tsx`
- MUI components: use MUI MCP docs (per AGENTS instructions)

#### Subtasks

1. [ ] Extend chat message rendering to display file path (repo + relative path) alongside tool-provided snippets/chunks, ensuring layout works on mobile and desktop.
2. [ ] Ensure citations remain inline with the assistant message and are visible in the chat bubble; include host-friendly path text where applicable.
3. [ ] Update client-side types and parsing to capture new tool payload fields (score, repo id, file path, host path, chunk text).
4. [ ] Add RTL tests covering citation display, multiple results, and fallback states when no paths are returned.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 4. Final Task – Validate story completion

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Ensure all acceptance criteria are met, documentation is current, and the full stack builds and tests pass with the new tooling.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Cucumber: https://cucumber.io/docs/guides/
- Husky: Context7 `/typicode/husky`

#### Subtasks

1. [ ] Build the server and client: `npm run build --workspace server`, `npm run build --workspace client`.
2. [ ] Run tests: `npm run test --workspace server`, `npm run test --workspace client`.
3. [ ] Optional sanity: bring up compose stack to verify endpoints manually if needed (`npm run compose:up` then `npm run compose:down`).
4. [ ] Update `README.md`, `design.md`, and `projectStructure.md` with new tools, routes, and data flows; note host-path rewrite behavior.
5. [ ] Record implementation notes and final commit hashes in this plan; set all task statuses to __done__.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] (If run) `npm run compose:up` then `npm run compose:down`

#### Implementation notes

- 
