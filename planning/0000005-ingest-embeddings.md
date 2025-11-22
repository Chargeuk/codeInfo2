# Story 0000005 – Ingest Embeddings Page

## Description

Add a new **Ingest** page that lets users point the system at a folder (e.g., a git repo) accessible to the server. The server will walk the tree, chunk files intelligently (prefer boundaries between classes/functions; fall back to size-based chunks), embed the chunks with a selected LM Studio embedding model, and store vectors in a shared Chroma collection. Each chunk must persist rich metadata: repository root path, relative file path, embedding time, file hash, chunk hash, and any flags needed to target later deletes/updates. Users need controls to re-embed incrementally (only changed/added/removed files) and to remove all embeddings associated with a folder using the metadata.

### Embedding model limits (LM Studio)
- Use the LM Studio SDK to obtain per-model token limits: `await model.getContextLength()` on the selected embedding model to know the max tokens a chunk may contain.
- Measure candidate chunks with `await model.countTokens(text)` (or `tokenize` length) and keep them under a safety margin, e.g., 80–90% of `getContextLength()` to leave room for any per-chunk prefixes.
- If limits cannot be fetched, fall back to a conservative default cap (e.g., 2048 tokens) until the real limit is retrieved; prefer the live SDK value over any cached/default number.

## Acceptance Criteria

- Ingest page reachable from NavBar, showing folder path input and LM Studio model dropdown (models sourced from LM Studio). First model defaulted.
- Server accepts a folder path, enumerates files, chunks large files at class/function boundaries when possible, otherwise size-based fallback.
- Each embedded chunk stored in one shared Chroma collection (no per-repo DBs) with metadata: repo root, relative path, file hash, chunk hash, embeddedAt timestamp, and model used.
- One shared Chroma collection means a single embedding model must be used for all entries; the model is selectable only when the collection is empty (first ingest or after a full purge) and is fixed thereafter unless the collection is cleared.
- Re-embed workflow reuses metadata/hashes to only embed changed files/chunks; removes vectors for deleted files.
- Users can remove a previously embedded folder by metadata key (e.g., repo root) without affecting other data.
- Errors and progress surface to the UI (basic states sufficient for this story).
- If the target folder is a git repo or within one, only git-tracked files are embedded (untracked/ignored files skipped); `.git` directories are always excluded. Only text files are eligible, and all text files are included unless they are in the exclude list or nested under an excluded directory. Maintain a hardcoded exclude list (initially includes `node_modules`, `.git`, lockfiles like `package-lock.json`, and other obvious vendor/cache dirs) applied even outside git contexts.
- Exclude list is configurable via env (initial hardcoded defaults still apply); the env-driven list should let operators extend or override exclusions without code changes.
- Ingest runs are single-flight: server rejects new ingest requests while one is running. In-progress ingest must be abortable (server stops the job and frees the lock; UI surfaces cancellation).
- Chroma backing store will run via the official Docker image v1.3.5, and the Node client will use `chromadb` npm package v3.1.6.
- Default include extensions (env-overridable allowlist): ts, tsx, js, jsx, mjs, cjs, json, jsonc, md, mdx, txt, py, java, kt, kts, go, rs, rb, php, cs, cpp, cc, c, h, hpp, swift, scala, clj, cljs, edn, sh, bash, zsh, ps1, yaml, yml, toml, ini, cfg, env (non-secret defaults only), sql. Exclude (hard, even if text or listed in env): lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml), minified bundles (*.min.js), build/ and dist/ outputs, logs (*.log), vendor directories (node_modules, vendor), VCS/meta (.git), coverage/caches.
- Server will expose an embedding-models endpoint that filters LM Studio’s downloaded models to embedding-capable ones only (via `listDownloadedModels`), used by the ingest UI; model choice is only allowed when collection is empty.

## Out Of Scope

- Authentication/authorization around ingest operations.
- UI progress bars beyond simple status text.
- Multi-tenant Chroma collections or separate DB instances per repo.
- Advanced chunking heuristics (AST-level per-language) beyond basic class/function boundary detection and size fallback.

## GUI Notes (current intent)

- New Ingest form: fields for Folder path (required), Display name (required), Description (optional), Model dropdown (selectable only when collection empty), Start ingest button, optional Dry-run toggle, inline status/error text.
- Active run card: shows current state (“Scanning…/Embedding…/Cancelled/Completed”), counters, soft Cancel button, and a link to view logs filtered by runId.
- Embedded folders table: columns for Name, Path, Model, Status chip, Last ingest time, counts (files/chunks optional). Actions per row: Re-embed (incremental), Remove (purge), View details. Bulk actions for selected rows.
- Description display: info/tooltip icon next to Name in the table; description also shown in the Details drawer opened from View details.
- Details drawer: shows name, description, path, model (locked), run history with timestamps/results, last error, and the include/exclude lists applied for that root.
- Model lock banner: once collection non-empty, show “Embedding model locked to <model>” near the form; model dropdown disabled thereafter.
- Empty state: guidance that model choice is locked after first ingest; prompt to set name/description when adding the first folder.

## Questions

- Abort semantics: prefer soft cancel (graceful stop) — cancel flag halts new work, abort in-flight embedding calls, then purge all vectors tagged to the current runId; surface “cancelled and cleaned” or “cancelled; cleanup pending” in UI if purge is partial.

## Implementation Plan

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

## Tasks

### 1. Server – Ingest discovery, chunking, and hashing

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement server-side folder discovery respecting git-tracked-only rules, exclude lists, and text-only constraint. Add chunking with heuristic boundaries and token caps using LM Studio SDK context length, plus hashing for file/chunk diffs. Covers AC: git-tracked text-only inputs, excludes, chunking/token cap groundwork.

#### Documentation Locations

- LM Studio SDK tokenization/context length: https://lmstudio.ai/docs/typescript/tokenization and https://lmstudio.ai/docs/typescript/model-info/get-context-length
- LM Studio embedding: https://lmstudio.ai/docs/typescript/embedding
- Git tracked-files reference: https://git-scm.com/docs/git-ls-files
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Install missing deps for this phase: `npm install --workspace server chromadb@3.1.6` and `npm install --workspace server @types/node@latest` if needed. **Do not change LM Studio SDK — @lmstudio/sdk@1.5.0 is already installed and must stay pinned.** Add env keys to `server/.env`: `CHROMA_URL=http://localhost:8000`, `INGEST_EXCLUDE=node_modules,.git,dist,build,coverage,logs,vendor,*.log,*.min.js,package-lock.json,yarn.lock,pnpm-lock.yaml`, `INGEST_INCLUDE=ts,tsx,js,jsx,mjs,cjs,json,jsonc,md,mdx,txt,py,java,kt,kts,go,rs,rb,php,cs,cpp,cc,c,h,hpp,swift,scala,clj,cljs,edn,sh,bash,zsh,ps1,yaml,yml,toml,ini,cfg,env,sql`. Document defaults stay in code; env extends/overrides.
2. [ ] Create `server/src/ingest/discovery.ts`: functions `findRepoRoot(startPath)`, `listGitTracked(root)` using `git ls-files -z`, fallback to `walkDir` when not a git repo, `isTextFile(path, extAllowlist, hardExcludes)` using extension allowlist and mime sniff (fallback). Apply hard excludes (always) + env excludes (extend/override). Ensure `.git` is always skipped. Return `{ root, files: Array<{ absPath, relPath, ext }> }`.
3. [ ] Add `server/src/ingest/hashing.ts`: `hashFile(absPath)`, `hashChunk(relPath, chunkIndex, text)` using sha256; deterministic input order (root, relPath, chunkIndex, text) and encode UTF-8.
4. [ ] Add `server/src/ingest/chunker.ts`: accept text + model token limit. Use LM Studio helpers `countTokens`/`getContextLength`. Use safety margin 0.85 * contextLength; fallback limit 2048 if limit unavailable. Boundary regexes: split on `/^(class\s+\w+|function\s+\w+|const\s+\w+\s*=\s*\(|export\s+(function|class))/m`. If a boundary chunk exceeds limit, fallback to size-based slice of ~75% of limit tokens. Output chunks with `chunkIndex`, `text`, `tokenCount`.
5. [ ] Add `server/src/ingest/types.ts` with shared types (`DiscoveredFile`, `Chunk`, `ChunkMeta`, `IngestRunState`). Add `server/src/ingest/config.ts` to read env include/exclude lists, token safety margin, default cap.
6. [ ] Wire `server/src/ingest/index.ts` exporting discovery+chunking helpers for later API use; keep pure (no Express).
7. [ ] Tests: add `server/src/ingest/__tests__/discovery.test.ts`, `chunker.test.ts`, `hashing.test.ts`. Cover git-tracked filter (mock git), hard exclude precedence, env override/extend, text detection, boundary-first splits, fallback slicing, hash determinism. Use fixtures under `server/src/ingest/__fixtures__` (small sample files).
8. [ ] Update `projectStructure.md` with new ingest modules and fixture folder.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if failures, rerun `npm run lint:fix --workspaces` / `npm run format --workspaces` and resolve.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Cucumber integration added in Task 2 when endpoints exist.

---

### 2. Server – Embedding models endpoint

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose `/ingest/models` that lists LM Studio downloaded models filtered to embedding-capable ones. Provide Cucumber coverage. Covers AC: model dropdown sourcing from embedding-only list before ingest begins.

#### Documentation Locations

- LM Studio listDownloadedModels: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded (filter to embedding models)
- Express docs (routing patterns): https://expressjs.com/ or Context7 `/expressjs/express`
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Create `server/src/routes/ingestModels.ts` exposing `GET /ingest/models`. Use LM Studio SDK `listDownloadedModels()` and filter `model.type === 'embedding' || capabilities.includes('embedding')`. Response shape: `{ models: [{ id, displayName, contextLength, format, size, filename }] }`. If the ingest collection is non-empty (hook later), include `lockedModelId` if known. Errors: 502 on SDK failure with `{ status:'error', message }`.
2. [ ] Register route in `server/src/index.ts` (or routes barrel) under `/ingest/models`; ensure CORS matches existing config.
3. [ ] Add Cucumber feature `server/src/test/features/ingest-models.feature` with scenarios: (a) returns only embedding models (mock SDK list with mixed types), (b) SDK failure returns 502 error payload. Implement steps in `server/src/test/steps/ingest-models.steps.ts` using SDK mock/stub.
4. [ ] Update README.md: document request/response example for `/ingest/models` (sample JSON), note embedding-only filter, mention locked model behavior.
5. [ ] Update design.md with a small sequence/flow for model fetch and UI dependency; include the same sample request/response for quick reference; reference model lock note.
6. [ ] Update projectStructure.md with new route + test files.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix as needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Reuse in client ingest form; keep model lock rules in mind.

---

### 3. Server – Ingest API & Chroma write

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose ingest endpoints and wire Chroma writes with metadata. Provide Cucumber coverage. Ensure model lock is enforced when collection non-empty. Covers AC: single shared collection, model lock, metadata captured per chunk, ingest start/status.

#### Documentation Locations

- Chroma Node client: https://www.npmjs.com/package/chromadb (v3.1.6) and API docs
- LM Studio embedding/tokenization/context length: https://lmstudio.ai/docs/typescript/embedding , https://lmstudio.ai/docs/typescript/tokenization , https://lmstudio.ai/docs/typescript/model-info/get-context-length
- Docker Compose reference for Chroma service: https://docs.docker.com/compose/
- Testcontainers for Node (Chroma in tests): https://node.testcontainers.org/
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs: Context7 `/mermaid-js/mermaid`
- Express docs (routing patterns): https://expressjs.com/ or Context7 `/expressjs/express`

#### Subtasks

1. [ ] Add Chroma compose service snippet to `docker-compose.yml`:
   ```yaml
   chroma:
     image: chromadb/chroma:1.3.5
     ports: ['8000:8000']
     volumes: ['chroma-data:/chroma/.chroma']
   volumes:
     chroma-data:
   ```
   Add env to server `.env`: `CHROMA_URL=http://chroma:8000`, `INGEST_COLLECTION=ingest_vectors`, `INGEST_ROOTS_COLLECTION=ingest_roots`.
2. [ ] Implement `server/src/ingest/chromaClient.ts`: singleton connecting to `CHROMA_URL`, init collections, expose helpers `getVectorsCollection()`, `getRootsCollection()`, `getLockedModel()` (via collection metadata), `setLockedModel(modelId)`, `collectionIsEmpty()`.
3. [ ] Implement `POST /ingest/start` in `server/src/routes/ingestStart.ts`: body `{ path, name, description, model, dryRun?: boolean }`. Validate model lock (if collection non-empty, reject with 409 `{ status:'error', code:'MODEL_LOCKED' }`). Enforce single-flight lock (defer to Task 5 for cancellation plumbing). Start async job, return `{ runId }`.
4. [ ] Implement `GET /ingest/status/:runId` in `server/src/routes/ingestStatus.ts`: returns `{ runId, state: 'queued'|'scanning'|'embedding'|'completed'|'error'|'cancelled', counts: { files, chunks, embedded }, message?, lastError? }` reading from in-memory job state.
5. [ ] Create ingest job orchestrator `server/src/ingest/ingestJob.ts`: uses discovery+chunker+hashing, LM Studio embedding (`model.embed()`), and Chroma upsert with metadata `{ runId, root, relPath, fileHash, chunkHash, embeddedAt, model, name, description }`. Respect `dryRun` by skipping upsert but still reporting would-be counts. Persist per-root summary into `ingest_roots` collection.
6. [ ] Add API contracts to README.md: request/response JSON examples for `/ingest/start` and `/ingest/status/:runId`, model-lock rules, error codes (409 MODEL_LOCKED, 429 BUSY when lock engaged, 400 validation).
7. [ ] Update design.md with ingest flow mermaid (start → discover → chunk → embed → upsert), show model-lock check and Chroma metadata; include the same sample request/response snippets; note dry-run path.
8. [ ] Update projectStructure.md for new routes/modules and compose volume addition.
9. [ ] Cucumber: feature `ingest-start.feature` using Testcontainers Chroma (or cucumber-compose) + mocked LM Studio: scenarios happy path, model-lock violation, and dry-run (no vectors written). Steps in `server/src/test/steps/ingest-start.steps.ts`.
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Reuse runId for log filtering; ensure dry-run skips Chroma writes.

---

### 4. Server – Ingest roots listing

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose `GET /ingest/roots` to return embedded roots from the `ingest_roots` management collection (name, description, model, status, counts, last run). Used by the client table. Covers AC: list embedded roots and model lock visibility.

#### Documentation Locations

- Chroma client docs (metadata queries): https://www.npmjs.com/package/chromadb
- Docker Compose reference for service addresses: https://docs.docker.com/compose/
- Express docs (routing patterns): https://expressjs.com/ or Context7 `/expressjs/express`
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Add `server/src/routes/ingestRoots.ts` for `GET /ingest/roots`: return `{ roots: [{ name, description, path, model, status, lastIngestAt, counts, lastError }], lockedModelId }` pulling from `ingest_roots` collection and collection metadata.
2. [ ] Ensure sorting by `lastIngestAt` desc; include `lockedModelId` for UI banner.
3. [ ] Cucumber feature `ingest-roots.feature` with scenarios: after ingest run returns row; after remove returns empty list. Steps in `server/src/test/steps/ingest-roots.steps.ts` using Testcontainers Chroma and mocked LM Studio.
4. [ ] Update README.md with payload JSON example and filter/lock note.
5. [ ] Update design.md with short flow (UI table fetch) and model-lock visibility; include the payload example for quick reference.
6. [ ] Update projectStructure.md for new route/test files.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Consider pagination later; simple list is fine for this story.

---

### 5. Server – Single-flight lock, soft cancel, and cleanup

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Enforce one ingest at a time, implement soft cancel, and purge partial embeddings for a run. Add incremental re-embed and remove endpoints. Covers AC: single-flight ingest, cancel/cleanup, re-embed diffs, remove/purge and model unlock when empty.

#### Documentation Locations

- Testcontainers for Node (Chroma in tests): https://node.testcontainers.org/
- LM Studio embedding/tokenization: https://lmstudio.ai/docs/typescript/embedding and https://lmstudio.ai/docs/typescript/tokenization
- Express docs (routing patterns): https://expressjs.com/ or Context7 `/expressjs/express`
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Implement global single-flight lock in `server/src/ingest/lock.ts` with TTL safeguard (e.g., 30m) and clear on completion/error/cancel. Concurrent `POST /ingest/start` returns 429 `{ status:'error', code:'BUSY' }`.
2. [ ] `POST /ingest/cancel/:runId` (route file `ingestCancel.ts`): set cancel flag in orchestrator, abort LM Studio calls if possible, stop enqueueing work, delete vectors tagged with `runId`, update `ingest_roots` status to `cancelled`, respond `{ status:'ok', cleanup:'complete'|'pending' }`.
3. [ ] `POST /ingest/reembed/:root` (route `ingestReembed.ts`): diff current hashes vs stored metadata, embed only changed chunks, delete removed file chunks; returns new `runId`. Enforce model lock; reject if another ingest active.
4. [ ] `POST /ingest/remove/:root` (route `ingestRemove.ts`): purge vectors for root and delete entry in `ingest_roots`; if vectors collection becomes empty, clear locked model. Respond `{ status:'ok', unlocked: boolean }`.
5. [ ] Update orchestrator to tag all writes with `runId` and `root` to support purge/cancel; ensure cancel cleans partial vectors.
6. [ ] Cucumber features: `ingest-cancel.feature`, `ingest-reembed.feature`, `ingest-remove.feature` using Testcontainers Chroma + mocked LM Studio. Assertions: lock prevents concurrent start, cancel removes runId vectors, reembed updates changed file only, remove clears root and unlocks model when empty.
7. [ ] README.md: add endpoint contract tables with request/response JSON examples for cancel/re-embed/remove; note single-flight and model lock interactions.
8. [ ] design.md: add flow diagrams for cancel and re-embed/remove; include the same example payloads; describe unlock condition.
9. [ ] projectStructure.md: add new route/lock modules and test features.
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Log cancellation outcome and cleanup success/failure; track dirty runs if purge partial.

---

### 6. Client – Ingest form & model lock (depends on NavBar after chat merge)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add Ingest page route/tab, form for path/name/description/model, and model lock banner. Disable model select once collection non-empty. Covers AC: ingest page UI, model selection default/lock, name/description capture.

#### Documentation Locations

- MUI docs via MCP (@mui/material@7.2.0)
- React Router docs: https://reactrouter.com/
- Jest docs: Context7 `/jestjs/jest`
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Add `/ingest` route and NavBar tab (sync with chat branch). Files: update `client/src/routes/router.tsx`, `client/src/components/NavBar.tsx` to include tab.
2. [ ] Create page shell `client/src/pages/IngestPage.tsx` with sections: form, lock banner, active run card placeholder, roots table placeholder.
3. [ ] Form component `client/src/components/ingest/IngestForm.tsx`: fields path (required), name (required), description (optional), model select (disabled when `lockedModelId` present), dry-run toggle, start button. Validation: non-empty path/name, model required when select enabled. On submit call `/ingest/start` with JSON body.
4. [ ] Hook `useIngestModels` (`client/src/hooks/useIngestModels.ts`) to fetch `/ingest/models`, return models + lockedModelId; cache first model as default when unlocked.
5. [ ] Jest/RTL tests: render with unlocked vs locked state, validation errors, disabled submit when invalid, payload structure, lock banner visibility. Place under `client/src/test/ingestForm.test.tsx`.
6. [ ] README.md: add ingest page route, brief UX (model lock banner), how to run locally.
7. [ ] design.md: add form layout notes and lock banner mention.
8. [ ] projectStructure.md: add new page/component/hook/test paths.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix as needed.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Keep model fetch shared if chat provides a models endpoint; otherwise use ingest-specific endpoint.

---

### 7. Client – Active run card and status polling

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Show current ingest run status with counters, soft cancel, and link to logs. Poll status endpoint. Covers AC: surface progress/error states, soft cancel feedback, link to logs.

#### Documentation Locations

- MUI docs via MCP (@mui/material@7.2.0)
- React Router docs: https://reactrouter.com/
- Jest docs: Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Create hook `client/src/hooks/useIngestStatus.ts` polling `/ingest/status/:runId` with interval (e.g., 2s) and stop on terminal states. Accept `runId | undefined`.
2. [ ] Component `client/src/components/ingest/ActiveRunCard.tsx`: show state badges (Scanning/Embedding/Cancelled/Completed/Error), counters {files, chunks, embedded, skipped}, lastError text, cancel button (calls `/ingest/cancel/:runId`). Display success/error toast-like inline message.
3. [ ] Wire into `IngestPage` so when `/ingest/start` returns runId, page starts polling and shows card. Disable form/table actions while active.
4. [ ] Add link/button to open Logs page filtered by `runId` (if query param supported) or copy runId to clipboard helper.
5. [ ] Tests `client/src/test/ingestStatus.test.tsx`: polling stops on completed/cancelled/error, cancel button invokes endpoint and updates UI, disabled states during cancel.
6. [ ] README.md: describe active run card, cancel behavior, and polling interval.
7. [ ] design.md: add status/cancel flow notes or small sequence diagram.
8. [ ] projectStructure.md: include new hook/component/test files.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Consider exponential backoff on polling in error states; ensure cleanup messages align with server responses.

---

### 8. Client – Embedded folders table, details drawer, and actions

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Render table of embedded roots with actions (Re-embed, Remove, Details) and description hover/tooltip. Include bulk actions and empty state. Covers AC: remove/re-embed controls, description hover/click, model lock visibility, empty state.

#### Documentation Locations

- MUI docs via MCP (@mui/material@7.2.0)
- React Router docs: https://reactrouter.com/
- Jest docs: Context7 `/jestjs/jest`

#### Subtasks

1. [ ] Create hook `client/src/hooks/useIngestRoots.ts` to call `/ingest/roots`, returning roots + lockedModelId; refetch after re-embed/remove/start completes.
2. [ ] Component `client/src/components/ingest/RootsTable.tsx`: columns Name (tooltip with description), Path, Model, Status chip, Last ingest time, counts, row actions (Re-embed -> POST /ingest/reembed/:root, Remove -> POST /ingest/remove/:root, Details). Support bulk select disable during active ingest.
3. [ ] Component `client/src/components/ingest/RootDetailsDrawer.tsx`: shows name, description, path, model (locked), run history (from status/roots data), last error, include/exclude lists (read from server response if provided; otherwise from env defaults summary).
4. [ ] Empty state copy explaining model lock and first ingest guidance. Preserve lock banner from models hook.
5. [ ] Tests `client/src/test/ingestRoots.test.tsx`: table render, tooltip, details drawer content, re-embed/remove action calls, disabled state when active ingest.
6. [ ] README.md: document table/actions UX and how model lock affects UI.
7. [ ] design.md: add layout notes/diagram for roots table and details drawer.
8. [ ] projectStructure.md: add new hook/components/tests.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Consider pagination if many roots; otherwise simple list is fine for this story.

---

### 9. Final verification

- status: __to_do__
- Git Commits: __to_do__

#### Overview

Cross-check acceptance criteria, run full builds/tests, and update docs. Align with chat branch merges (NavBar/router) during verification. Capture screenshots if UI changed significantly.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides https://cucumber.io/docs/guides/
- design.md, README.md, projectStructure.md

#### Subtasks

1. [ ] Add `docker-compose.e2e.yml` with isolated Chroma service/volume for e2e tests; ensure it does not affect the main compose stack; document volume cleanup (`docker compose -f docker-compose.e2e.yml down -v`).
2. [ ] Update `package.json` `e2e:*` scripts to use the e2e compose stack (build/up/down) and ensure env points to the e2e Chroma (COMPOSE_FILE or built-in overrides).
3. [ ] Add Playwright e2e: start ingest on empty DB (select model, ingest sample folder), see status progress, complete, and entries appear in table. Use dedicated e2e docker-compose stack with isolated Chroma volume.
4. [ ] Add Playwright e2e: cancel in-progress ingest, verify UI shows cancelled/cleanup state, no partial entries remain.
5. [ ] Add Playwright e2e: re-embed flow — modify a file, rerun ingest, verify updated timestamp/counts in table/details.
6. [ ] Add Playwright e2e: remove embedded root, verify table clears and model lock resets when collection empty.
7. [ ] Ensure Readme.md is updated with ingest endpoints/flows, e2e compose usage, and any new commands
8. [ ] Ensure Design.md is updated with ingest flows/diagrams and model-lock notes
9. [ ] Ensure projectStructure.md is updated with added/updated files & folders (including e2e compose file)
10. [ ] Create a PR-ready summary of changes (include ingest endpoints, UI, model lock, cancel/re-embed/remove)
11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run test --workspace server`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace server`
4. [ ] `npm run build --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`
6. [ ] `npm run e2e:up`
7. [ ] `npm run e2e:test` (including new ingest e2e cases)
8. [ ] `npm run e2e:down`

#### Implementation notes

- Coordinate rebase/merge with chat branch for NavBar/router before final checks; capture any screenshots for ingest UI if needed.

---
