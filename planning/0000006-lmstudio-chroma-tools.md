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

- Task Status: __in_progress__
- Git Commits: 84398b2, b63db30

#### Overview

Expose read-only server endpoints that back the LM Studio tools: list ingested repositories and perform vector search over stored chunks, with repository scoping and host-path rewriting so the agent can open files on the host.

#### Documentation Locations

- Existing ingest metadata structures: `server/src/ingest/chromaClient.ts`, `server/src/routes/ingestRoots.ts`
- Chroma JS client docs (vectors.query, metadata filters, collection schema): https://docs.trychroma.com/ or Context7 `/websites/trychroma`
- Express routing patterns (handlers, middleware, CORS): Context7 `/expressjs/express`
- Jest unit testing (no external services): Context7 `/jestjs/jest`
- Supertest for HTTP handler units (with mocked deps): https://github.com/ladjs/supertest#readme
- Host path mapping/env: current compose/env usage of `HOST_INGEST_DIR` and `/data` mount (see `docker-compose.yml`, `server/.env`)

#### Subtasks

1. [x] Add a path translation helper (e.g., `server/src/ingest/pathMap.ts`) that rewrites stored ingest paths (mounted at `/data`) back to `HOST_INGEST_DIR`, returning both container and host paths plus repo/name metadata.
   - Rule: stored paths look like `/data/<rootName>/<relativePath>`; map to host via `${HOST_INGEST_DIR}/<rootName>/<relativePath>`. If `HOST_INGEST_DIR` is unset, default to `/data` but include a warning field `hostPathWarning`.
   - Include helper signature suggestion: `mapIngestPath(containerPath: string): { repo: string; relPath: string; containerPath: string; hostPath: string; hostPathWarning?: string }`.
   - Scaffold snippet:
     ```ts
     export function mapIngestPath(containerPath: string, hostIngestDir = process.env.HOST_INGEST_DIR || '/data') {
       // TODO: parse `/data/<repo>/<relPath>`; when hostIngestDir is missing, set hostPathWarning
     }
     ```
2. [ ] Implement `GET /tools/ingested-repos` reusing the ingest roots collection to return: repo identifier (use `name` with fallback to `path` basename), description, containerPath (from stored path), hostPath (via mapper), lastIngestAt ISO, modelId, counts, lastError. Handle empty lists gracefully.
   - Example response (non-empty):
     ```json
     {"repos":[{"id":"repo","description":"sample","containerPath":"/data/repo","hostPath":"/Users/me/repo","lastIngestAt":"2025-01-01T12:00:00.000Z","modelId":"text-embedding-qwen3-embedding-4b","counts":{"files":3,"chunks":12,"embedded":12},"lastError":null}],"lockedModelId":"text-embedding-qwen3-embedding-4b"}
     ```
   - Empty list example: `{ "repos": [], "lockedModelId": null }`.
3. [ ] Implement `POST /tools/vector-search` that accepts `{ query: string, repository?: string, limit?: number }`, validates input, scopes to a repo when provided, queries Chroma for top-k matches, and returns: score, full chunk text, repo identifier, relative path, host-resolvable path, chunk hash/ids for provenance.
   - Defaults: `limit` default 5, max 20; `query` required non-empty string; `repository` must match an existing ingest root name.
   - Chroma query: `collection.query({ queryTexts:[query], where:{ root: repository? }, nResults: limit })`; include `documents`, `metadatas`, `distances`/`scores`.
   - Response example:
     ```json
     {"results":[{"repo":"repo","relPath":"docs/main.txt","containerPath":"/data/repo/docs/main.txt","hostPath":"/Users/me/repo/docs/main.txt","score":0.12,"chunk":"hello world from fixture","chunkId":"hash123"}],"modelId":"text-embedding-qwen3-embedding-4b"}
     ```
   - Errors: unknown repo → `404 {"error":"REPO_NOT_FOUND"}`; invalid body → `400 {"error":"VALIDATION_FAILED","details":["query is required"]}`; Chroma failure → `502 {"error":"CHROMA_UNAVAILABLE"}`.
   - Scaffold snippet:
     ```ts
     const results = await collection.query({
       queryTexts: [body.query],
       where: body.repository ? { root: body.repository } : undefined,
       nResults: Math.min(body.limit ?? 5, 20),
     });
     ```
4. [ ] Ensure responses never bypass the ingest model lock; reuse existing collections/metadata and avoid write operations. Add clear error payloads for missing repo, bad input, or Chroma failures.
5. [ ] Wire routes into `server/src/index.ts` (CORS consistent) and add logging for tool calls.
6. [ ] Add pure unit tests in `server/src/test/unit/pathMap.test.ts` for the path translation helper: happy path, missing host env (warning), malformed paths.
7. [ ] Add unit tests in `server/src/test/unit/tools-ingested-repos.test.ts` that mock ingest roots data (no Chroma/LMStudio) and hit the handler via supertest to cover empty list, single repo mapping, and lockedModelId passthrough.
8. [ ] Add unit tests in `server/src/test/unit/tools-vector-search.test.ts` that mock the Chroma client dependency (no live service) to cover search with/without repo filter, limit capping, validation error on missing query, unknown repo 404, and upstream failure 502.
9. [ ] Document any new env requirements (e.g., `HOST_INGEST_DIR`) in `server/.env`.
10. [ ] Update `README.md` to describe the new tooling endpoints, inputs/outputs, and path rewrite behaviour.
11. [ ] Update `design.md` to reflect the new list/search flows, path rewrite, and data returned.
12. [ ] Update `projectStructure.md` to include new routes/helpers/tests related to the tools API.
13. [ ] Run `npm run lint --workspaces`, `npm run format:check --workspaces` & fix any issues.


#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`
8. [ ] `npm run e2e`

#### Implementation notes

- Added `mapIngestPath` helper to translate stored `/data/<repo>/<relPath>` paths back to host paths, emitting a warning when `HOST_INGEST_DIR` is absent.
- Normalized container paths to POSIX and added a fallback split so unexpected inputs still yield repo/relPath values for future tooling calls.
- Reminder: after each subtask/test completion, update this section with decisions/edge cases discovered and add the latest commit hash under Git Commits, then push. Also keep the Task Status field in sync (`__to_do__` → `__in_progress__` → `__done__`).

---

### 2. Server – LM Studio tool wiring

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose the new list/search capabilities as LM Studio tool definitions used by the chat route, including metadata needed for inline citations and host path display.

#### Documentation Locations

- LM Studio TypeScript agent tools (using `tool()` with zod schemas, naming/description impact, examples including external-effect tools like createFile): https://lmstudio.ai/docs/typescript/agent/tools
- LM Studio agent `.act()` API (multi-round tool use, callbacks, tool schema examples): https://lmstudio.ai/docs/typescript/agent/act
- Existing chat route/streaming: `server/src/routes/chat.ts`, `server/src/chatStream.ts`
- Client pool: `server/src/lmstudio/clientPool.ts`
- Jest docs (unit testing, mocks): Context7 `/jestjs/jest`
- Supertest docs (HTTP integration testing): https://github.com/ladjs/supertest#readme
- (No Cucumber for this task; rely on Jest/supertest unit/integration)

#### Subtasks

1. [ ] Define LM Studio tool schema for **ListIngestedRepositories** in `server/src/lmstudio/tools.ts` using `tool()` + zod; include description, no input params, output array of repos `{ id, description, containerPath, hostPath, lastIngestAt, modelId, counts, lastError }`.
2. [ ] Define LM Studio tool schema for **VectorSearch** in the same file: input `{ query: z.string().min(1), repository: z.string().optional(), limit: z.number().int().min(1).max(20).default(5) }`; output item `{ repo, relPath, hostPath, containerPath, score, chunk, chunkId, modelId }`.
   - Schema scaffold:
     ```ts
     const vectorSearch = tool({
       name: 'VectorSearch',
       description: 'Search ingested chunks optionally scoped to a repository',
       parameters: z.object({
         query: z.string().min(1),
         repository: z.string().optional(),
         limit: z.number().int().min(1).max(20).default(5),
       }),
       execute: async ({ query, repository, limit }) => {/* call helper */},
     });
     ```
2. [ ] Integrate tools into the chat handler so tool calls invoke the new server logic (or shared helpers), streaming results into the assistant response with minimal additional latency.
   - Register tools in `server/src/routes/chat.ts` (or shared `chatStream.ts`) by passing them into `client.llm.model(...).act(...)` tool list; reuse the same helpers the HTTP endpoints use to avoid duplication.
3. [ ] Ensure tool responses preserve provenance data for citations and that errors are surfaced as actionable messages to the user.
4. [ ] Add unit test (type: Jest; location: `server/src/test/unit/chat-tools.test.ts`) to assert tool schemas and payload shapes passed into LM Studio `act`; include fixture payloads matching the HTTP examples above.
5. [ ] Add integration test (type: supertest/Jest; location: `server/src/test/integration/chat-tools-wire.test.ts`) to exercise the HTTP chat route with mocked LM Studio/tool outputs; verify the streamed SSE includes tool results with hostPath and relPath fields.
6. [ ] Add unit test (type: Jest; location: `server/src/test/unit/chat-tools-wire.test.ts`) that validates tool schemas/execute functions when LM Studio is mocked, ensuring tool payloads include repo/path metadata without needing live vectors.
7. [ ] Update server logging to record tool usage (without leaking payload text beyond what logs already allow) for observability.
8. [ ] Update `README.md` (server section) to describe the new LM Studio tools integration and how they are invoked.
9. [ ] Update `design.md` to include the tool wiring and data flow for list/search tools in chat.
10. [ ] Update `projectStructure.md` to list any new tool schema/helper/test files added for LM Studio wiring.
11. [ ] Run `npm run lint --workspaces`, `npm run format:check --workspaces` & fix any issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`
8. [ ] `npm run e2e`

#### Implementation notes

- Reminder: after each subtask/test completion, update this section with decisions/edge cases discovered and add the latest commit hash under Git Commits, then push. Also keep the Task Status field in sync (`__to_do__` → `__in_progress__` → `__done__`).

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
- React Testing Library docs (render, screen, assertions): https://testing-library.com/docs/react-testing-library/intro
- React Router (for navigation impact if needed): https://reactrouter.com/en/main (only if routing touches UI changes)

#### Subtasks

1. [ ] Extend chat message rendering to display file path (repo + relative path) alongside tool-provided snippets/chunks, ensuring layout works on mobile and desktop.
2. [ ] Ensure citations remain inline with the assistant message and are visible in the chat bubble; include host-friendly path text where applicable.
   - Target components: `client/src/pages/ChatPage.tsx` (render loop), `client/src/hooks/useChatStream.ts` (parsing tool events), and chat bubble component (add a small inline `path` row with `repo/relPath` and hostPath in parentheses if present).
   - Mobile rule: path wraps and truncates in middle (`textOverflow: 'ellipsis'`, `maxWidth: '100%'`).
   - Render scaffold (pseudo-JSX):
     ```jsx
     {result.hostPath ? (
       <Typography variant="caption">{`${result.repo}/${result.relPath}`} ({result.hostPath})</Typography>
     ) : (
       <Typography variant="caption">{`${result.repo}/${result.relPath}`}</Typography>
     )}
     ```
3. [ ] Update client-side types and parsing to capture new tool payload fields (score, repo id, file path, host path, chunk text); extend the SSE/tool event types in `useChatStream.ts` to include `repo`, `relPath`, `hostPath`, `chunk`, `score`.
4. [ ] Add RTL test (type: RTL/Jest; location: `client/src/test/chatPage.citations.test.tsx`) to verify path + citation rendering with multiple results; use fixture payloads mirroring the server response example (`repo/docs/main.txt`).
5. [ ] Add RTL test (type: RTL/Jest; location: `client/src/test/chatPage.noPaths.test.tsx`) to verify fallback when paths are missing; expect the chunk text renders without path row and no crashes.
6. [ ] Update `README.md` (client section) to mention visible file paths/citations from LM Studio tools.
7. [ ] Update `design.md` with UI flow/state notes for chat citations and file path rendering.
8. [ ] Update `projectStructure.md` to list any new client components/tests added for citations.
9. [ ] Run `npm run lint --workspaces`, `npm run format:check --workspaces` & fix any issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`
8. [ ] `npm run e2e`

#### Implementation notes

- Reminder: after each subtask/test completion, update this section with decisions/edge cases discovered and add the latest commit hash under Git Commits, then push. Also keep the Task Status field in sync (`__to_do__` → `__in_progress__` → `__done__`).

---

### 4. Final Task – Validate story completion

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Ensure all acceptance criteria are met, documentation is current, and the full stack builds and tests pass with the new tooling.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Chroma docs (for verifying model selection and data presence during e2e): https://docs.trychroma.com/ or Context7 `/websites/trychroma`

#### Subtasks

1. [ ] Add Playwright e2e test (type: Playwright; location: `e2e/chat-tools.spec.ts` or extend existing chat spec) that: (a) triggers ingest of the mounted fixture repo (`/fixtures/repo` from `e2e/fixtures/repo`), (b) asks a question whose answer is in the fixture (e.g., text in `main.txt`), (c) verifies the assistant returns chunk text with inline file path and host-path text. Ensure the test sets the ingest path to `/fixtures/repo` (or host-equivalent if run outside compose) so data exists before querying.
   - Question/answer to use: ask “What does main.txt say about the project?” and expect a chunk containing “This is the ingest test fixture for CodeInfo2.” Path assertion: `repo/main.txt` visible plus hostPath text in parentheses.
   - Compose env: ingest path `/fixtures/repo`, hostPath rewrite should return `/e2e/fixtures/repo` when HOST_INGEST_DIR is `/` in CI.
2. [ ] Update e2e ingest/model selection to prefer embedding model `text-embedding-qwen3-embedding-4b` when available; otherwise fall back to the default. Apply this across embedding-related e2e specs.
3. [ ] If fixture content needs updating for meaningful Q&A, add/adjust files under `e2e/fixtures/repo` with the above deterministic answer and document the expected question/answer in the test.
4. [ ] Update `README.md` with new endpoints, tool behaviour, env notes (HOST_INGEST_DIR), and chat citation visibility.
5. [ ] Update `design.md` with diagrams/flow for tool calls, host-path rewrites, and chat citation rendering.
6. [ ] Update `projectStructure.md` to list new files (routes, helpers, tests).
7. [ ] Run `npm run lint --workspaces`, `npm run format:check --workspaces` & fix any issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`
8. [ ] `npm run e2e`

#### Implementation notes

- 
