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

- Task Status: __done__
- Git Commits: 336c678, 4fa3092, dbf0795

#### Overview

Implement server-side folder discovery respecting git-tracked-only rules, exclude lists, and text-only constraint. Add chunking with heuristic boundaries and token caps using LM Studio SDK context length, plus hashing for file/chunk diffs. Covers AC: git-tracked text-only inputs, excludes, chunking/token cap groundwork.

#### Documentation Locations

- LM Studio SDK tokenization/context length: https://lmstudio.ai/docs/typescript/tokenization and https://lmstudio.ai/docs/typescript/model-info/get-context-length
- LM Studio embedding: https://lmstudio.ai/docs/typescript/embedding
- Git tracked-files reference: https://git-scm.com/docs/git-ls-files
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Subtask – Install missing deps: `npm install --workspace server chromadb@3.1.6` (needed later) and `npm install --workspace server @types/node@latest` if required. **Do not change @lmstudio/sdk@1.5.0.** Add env examples in `server/.env`: `CHROMA_URL=http://localhost:8000`, `INGEST_EXCLUDE=node_modules,.git,dist,build,coverage,logs,vendor,*.log,*.min.js,package-lock.json,yarn.lock,pnpm-lock.yaml`, `INGEST_INCLUDE=ts,tsx,js,jsx,mjs,cjs,json,jsonc,md,mdx,txt,py,java,kt,kts,go,rs,rb,php,cs,cpp,cc,c,h,hpp,swift,scala,clj,cljs,edn,sh,bash,zsh,ps1,yaml,yml,toml,ini,cfg,env,sql`. Note: env extends/overrides hardcoded defaults; mention this in README later.
2. [x] Subtask – Create `server/src/ingest/discovery.ts`: functions `findRepoRoot(startPath)`, `listGitTracked(root)` (`git ls-files -z`), fallback `walkDir` when not a repo, `isTextFile(path, extAllowlist, hardExcludes)` using allowlist + mime sniff fallback. Apply hard excludes (always) + env excludes (extend/override). Always skip `.git`. Return `{ root, files: Array<{ absPath, relPath, ext }> }`. Add inline example: env override `INGEST_EXCLUDE=node_modules,.git,dist,temp` should prune those.
   Starter skeleton:
   ```ts
   // server/src/ingest/discovery.ts
   export type DiscoveredFile = { absPath: string; relPath: string; ext: string };

   export async function findRepoRoot(startPath: string): Promise<string> {
     // TODO walk up until .git or fs root
   }

   export async function listGitTracked(root: string): Promise<string[]> {
     // TODO run `git ls-files -z` and split("\0")
   }

   export async function discoverFiles(startPath: string, cfg: IngestConfig): Promise<{ root: string; files: DiscoveredFile[] }> {
     // TODO pick git vs walkDir, filter with cfg.includes/excludes + isTextFile
   }
   ```
3. [x] Subtask – Add `server/src/ingest/hashing.ts`: `hashFile(absPath)`, `hashChunk(relPath, chunkIndex, text)` using sha256; deterministic order (root, relPath, chunkIndex, text) and UTF-8 encoding.
4. [x] Subtask – Add `server/src/ingest/chunker.ts`: accept text + model token limit. Use LM Studio helpers `countTokens`/`getContextLength`; safety margin `0.85 * contextLength`, fallback limit 2048 if unavailable. Boundary regex `/^(class\s+\w+|function\s+\w+|const\s+\w+\s*=\s*\(|export\s+(function|class))/m`; if boundary chunk exceeds limit, slice to ~75% of limit tokens. Output chunks `{ chunkIndex, text, tokenCount }`. Inputs/Outputs note: input text + limit → array of chunk objects with token counts respecting limit.
   Starter skeleton:
   ```ts
   // server/src/ingest/chunker.ts
   export type Chunk = { chunkIndex: number; text: string; tokenCount: number };

   export async function chunkText(text: string, model: EmbeddingModel, cfg: IngestConfig): Promise<Chunk[]> {
     const maxTokens = await getSafeLimit(model, cfg);
     // TODO split by boundary regex, enforce limits, fallback slice
   }
   ```
5. [x] Subtask – Add `server/src/ingest/types.ts` (`DiscoveredFile`, `Chunk`, `ChunkMeta`, `IngestRunState`) and `server/src/ingest/config.ts` to read env include/exclude lists, token safety margin, default cap (2048 fallback).
   Env merge example to include in `config.ts`:
   ```ts
   const defaultExcludes = ['node_modules', '.git', 'dist', 'build', 'coverage', 'logs', 'vendor'];
   const envExcludes = process.env.INGEST_EXCLUDE?.split(',').filter(Boolean) ?? [];
   export const excludes = Array.from(new Set([...defaultExcludes, ...envExcludes]));
   ```
6. [x] Subtask – Wire `server/src/ingest/index.ts` exporting discovery+chunking+hashing helpers; keep pure (no Express). Document exports briefly in file header.
   Minimal barrel:
   ```ts
   export * from './discovery';
   export * from './chunker';
   export * from './hashing';
   export * from './config';
   export * from './types';
   ```
7. [x] Subtask – Tests: add `server/src/ingest/__tests__/discovery.test.ts`, `chunker.test.ts`, `hashing.test.ts`. Cover git-tracked filter (mock git), hard exclude precedence, env override/extend, text detection, boundary-first splits, fallback slicing, hash determinism. Use fixtures under `server/src/ingest/__fixtures__` (create small sample files with obvious boundaries).
   Test skeleton example:
   ```ts
   describe('discoverFiles', () => {
     it('skips hard excludes and applies env overrides', async () => {
       // arrange temp dir + fixtures
       // mock git ls-files
       const result = await discoverFiles(tmpDir, cfg);
       expect(result.files.map(f => f.relPath)).toContain('src/app.ts');
       expect(result.files.some(f => f.relPath.includes('node_modules'))).toBe(false);
     });
   });
   ```
8. [x] Subtask – Update `projectStructure.md` with new ingest modules and fixture folder.
9. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if failures, rerun `npm run lint:fix --workspaces` / `npm run format --workspaces` and resolve. Expected result: both commands exit 0.

#### Testing

Prereqs: none beyond repo deps; LM Studio/Chroma not required for this task. Expected: builds succeed, tests green, compose stack starts then stops cleanly.

1. [x] `npm run build --workspace server` (should succeed)
2. [x] `npm run test --workspace server` (unit tests pass)
3. [x] `npm run compose:build` (images build)
4. [x] `npm run compose:up` (both services healthy; stop after verifying)
5. [x] `npm run compose:down` (stack stops without errors)

#### Implementation notes
- Reran lint/format; tightened ingest e2e selectors to scope to the target row/status chips so Playwright strict mode passes after re-embed/remove flows. `npm run e2e` now succeeds end-to-end.
- Switched Cucumber ingest Testcontainers to use docker-compose (server/src/test/compose/docker-compose.chroma.yml) via DockerComposeEnvironment, starting a single shared Chroma instance per run with explicit teardown and exit hooks. Ports are no longer fixed to 18000; CHROMA_URL now uses the mapped port.


- Cucumber integration added in Task 2 when endpoints exist.


### 2. Server – Embedding models endpoint

- Task Status: __done__
- Git Commits: 30b0f73, a2a4465

#### Overview

Expose `/ingest/models` that lists LM Studio downloaded models filtered to embedding-capable ones. Provide Cucumber coverage. Covers AC: model dropdown sourcing from embedding-only list before ingest begins.

#### Documentation Locations

- LM Studio listDownloadedModels: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded (filter to embedding models)
- Express docs (routing patterns): https://expressjs.com/ or Context7 `/expressjs/express`
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Subtask – Create `server/src/routes/ingestModels.ts` exposing `GET /ingest/models`. Inputs: no body. Outputs: `{ models: [{ id, displayName, contextLength, format, size, filename }], lockedModelId?: string }`. Use LM Studio SDK `listDownloadedModels()` and filter `model.type === 'embedding' || capabilities.includes('embedding')`. On SDK failure return 502 `{ status:'error', message }`.
   Handler skeleton:
   ```ts
   router.get('/ingest/models', async (req, res) => {
     try {
       const models = await sdk.listDownloadedModels();
       const embedding = models.filter(m => m.type === 'embedding' || m.capabilities?.includes('embedding'));
       res.json({ models: embedding.map(m => ({
         id: m.id,
         displayName: m.displayName,
         contextLength: m.contextLength,
         format: m.format,
         size: m.size,
         filename: m.filename,
       })), lockedModelId: await getLockedModel() });
     } catch (err) {
       res.status(502).json({ status: 'error', message: String(err) });
     }
   });
   ```
2. [x] Subtask – Register route in `server/src/index.ts` (or routes barrel) under `/ingest/models`; ensure CORS matches existing config.
3. [x] Subtask – Add Cucumber feature `server/src/test/features/ingest-models.feature` with scenarios: (a) returns only embedding models (mock SDK list with mixed types), (b) SDK failure returns 502 error payload. Implement steps in `server/src/test/steps/ingest-models.steps.ts` using SDK mock/stub.
4. [x] Subtask – Update README.md: include request/response example for `/ingest/models` (sample JSON), note embedding-only filter, mention locked model behavior.
   JSON example to insert:
   ```json
   {
     "models": [
       {"id":"embed-1","displayName":"all-MiniLM","contextLength":2048,"format":"gguf","size":145_000_000,"filename":"all-mini.gguf"}
     ],
     "lockedModelId": null
   }
   ```
5. [x] Subtask – Update design.md with a small sequence/flow for model fetch and UI dependency; include the same sample request/response for quick reference; reference model lock note.
6. [x] Subtask – Update `projectStructure.md` with new route + test files.
7. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix as needed (expect exit 0).

#### Testing

Prereqs: none beyond repo deps; LM Studio mocked in tests. Expected: builds succeed, Cucumber passes, compose stack starts/stops.

1. [x] `npm run build --workspace server` (success)
2. [x] `npm run test --workspace server` (all scenarios pass)
3. [x] `npm run compose:build`
4. [x] `npm run compose:up` (healthy)
5. [x] `npm run compose:down`

#### Implementation notes

- Reuse in client ingest form; keep model lock rules in mind.

---

### 3. Server – Ingest API & Chroma write

- Task Status: __done__
- Git Commits: 294a264, 586da8a

#### Overview

Expose ingest endpoints and wire Chroma writes with metadata. Provide Cucumber coverage. Ensure model lock is enforced when collection non-empty. Covers AC: single shared collection, model lock, metadata captured per chunk, ingest start/status.

#### Documentation Locations

- Chroma Node client: https://www.npmjs.com/package/chromadb (v3.1.6) and API docs
- Context7 `/websites/trychroma` (Chroma official docs via MCP)
- https://docs.trychroma.com/docs/run-chroma/persistent-client?lang=typescript
- LM Studio embedding/tokenization/context length: https://lmstudio.ai/docs/typescript/embedding , https://lmstudio.ai/docs/typescript/tokenization , https://lmstudio.ai/docs/typescript/model-info/get-context-length
- Docker Compose reference for Chroma service: https://docs.docker.com/compose/
- Testcontainers for Node (Chroma in tests): https://node.testcontainers.org/
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs: Context7 `/mermaid-js/mermaid`
- Express docs (routing patterns): https://expressjs.com/ or Context7 `/expressjs/express`

#### Subtasks

1. [x] Subtask – Add Chroma compose service snippet to `docker-compose.yml` (as shown below) and env keys in `server/.env`: `CHROMA_URL=http://chroma:8000`, `INGEST_COLLECTION=ingest_vectors`, `INGEST_ROOTS_COLLECTION=ingest_roots`.
   ```yaml
   chroma:
     image: chromadb/chroma:1.3.5
     ports: ['8000:8000']
     volumes: ['chroma-data:/chroma/.chroma']
   volumes:
     chroma-data:
   ```
2. [x] Subtask – Implement `server/src/ingest/chromaClient.ts`: singleton to `CHROMA_URL`, init collections, expose `getVectorsCollection()`, `getRootsCollection()`, `getLockedModel()` (from collection metadata), `setLockedModel(modelId)`, `collectionIsEmpty()`. Inputs/Outputs: helper functions only; no HTTP surface.
   - Chroma TS client reference (Context7 `/websites/trychroma`):
     ```ts
     import { ChromaClient } from "chromadb";

     const client = new ChromaClient({ path: process.env.CHROMA_URL ?? "http://localhost:8000" });
     const vectors = await client.getOrCreateCollection({ name: "ingest_vectors" });
     await vectors.add({
       ids: ["id1"],
       documents: ["doc"],
       embeddings: [embedding],
       metadatas: [{ repo: "my-repo" }],
     });
     const results = await vectors.query({
       queryTexts: ["search text"],
       nResults: 5,
       where: { repo: "my-repo" },
     });
     ```
3. [x] Subtask – Implement `POST /ingest/start` in `server/src/routes/ingestStart.ts`. Request body `{ path, name, description, model, dryRun?: boolean }`; Response `{ runId }` on 202; Errors: 409 `{ status:'error', code:'MODEL_LOCKED' }` if locked, 429 `{ status:'error', code:'BUSY' }` if single-flight holds (lock logic later), 400 validation. Validate model lock (if collection non-empty, reject). Start async job.
   Handler skeleton:
   ```ts
   router.post('/ingest/start', async (req, res) => {
     const { path, name, description, model, dryRun = false } = req.body ?? {};
     if (!path || !name || !model) return res.status(400).json({ status:'error', code:'VALIDATION' });
     if (!(await collectionIsEmpty()) && modelLockedDiffers(model)) return res.status(409).json({ status:'error', code:'MODEL_LOCKED' });
     if (lock.isHeld()) return res.status(429).json({ status:'error', code:'BUSY' });
     const runId = await orchestrator.start({ path, name, description, model, dryRun });
     res.status(202).json({ runId });
   });
   ```
4. [x] Subtask – Implement `GET /ingest/status/:runId` in `server/src/routes/ingestStatus.ts`: Output `{ runId, state: 'queued'|'scanning'|'embedding'|'completed'|'error'|'cancelled', counts: { files, chunks, embedded }, message?, lastError? }` from in-memory job state.
   Skeleton:
   ```ts
   router.get('/ingest/status/:runId', (req, res) => {
     const status = orchestrator.getStatus(req.params.runId);
     if (!status) return res.status(404).json({ status:'error', code:'NOT_FOUND' });
     res.json(status);
   });
   ```
5. [x] Subtask – Create orchestrator `server/src/ingest/ingestJob.ts`: uses discovery+chunker+hashing, LM Studio embedding (`model.embed()`), and Chroma upsert with metadata `{ runId, root, relPath, fileHash, chunkHash, embeddedAt, model, name, description }`. Respect `dryRun` by skipping upsert but still reporting would-be counts. Persist per-root summary into `ingest_roots` collection.
   - Chroma metadata filter shape (Context7 `/websites/trychroma`):
     ```ts
     await vectors.add({
       ids,
       documents,
       embeddings,
       metadatas: metadatas.map(m => ({ ...m, repo: root, runId })),
     });
     // later queries can scope by repo/runId
     await vectors.query({ queryTexts: ["foo"], where: { repo: root }, nResults: 10 });
     ```
6. [x] Subtask – Add API contracts to README.md: request/response JSON examples for `/ingest/start` and `/ingest/status/:runId`, model-lock rules, error codes (409 MODEL_LOCKED, 429 BUSY, 400 validation). Include example curl:
   - `curl -X POST http://localhost:5010/ingest/start -H 'content-type: application/json' -d '{"path":"/repo","name":"repo","model":"model1"}'`
   - `curl http://localhost:5010/ingest/status/<runId>`
   Add status response examples:
   ```json
   {"runId":"r1","state":"scanning","counts":{"files":3,"chunks":0,"embedded":0},"message":"Walking repo"}
   {"runId":"r1","state":"completed","counts":{"files":3,"chunks":12,"embedded":12}}
   {"runId":"r1","state":"cancelled","counts":{"files":1,"chunks":4,"embedded":2},"lastError":null}
   {"runId":"r1","state":"error","counts":{"files":1,"chunks":2,"embedded":0},"lastError":"Chroma unavailable"}
   ```
7. [x] Subtask – Update design.md with ingest flow mermaid (start → discover → chunk → embed → upsert), model-lock check, Chroma metadata; include the same sample request/response snippets; note dry-run path.
8. [x] Subtask – Update `projectStructure.md` for new routes/modules and compose volume addition.
9. [x] Subtask – Cucumber: feature `ingest-start.feature` using Testcontainers Chroma (or cucumber-compose) + mocked LM Studio. Scenarios: happy path, model-lock violation, dry-run (no vectors written). Steps in `server/src/test/steps/ingest-start.steps.ts`.
10. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix if needed (expect exit 0).

#### Testing

Prereqs: Chroma service available for tests that need it (Testcontainers/compose) and LM Studio mocked. Expected: builds succeed; Cucumber covers endpoints; compose stack healthy.

1. [x] `npm run build --workspace server`
2. [x] `npm run test --workspace server`
3. [x] `npm run compose:build`
4. [x] `npm run compose:up`
5. [x] `npm run compose:down`

#### Implementation notes

- Reuse runId for log filtering; ensure dry-run skips Chroma writes.

---

### 4. Server – Ingest roots listing

- Task Status: __done__
- Git Commits: d191b1d

#### Overview

Expose `GET /ingest/roots` to return embedded roots from the `ingest_roots` management collection (name, description, model, status, counts, last run). Used by the client table. Covers AC: list embedded roots and model lock visibility.

#### Documentation Locations

- Chroma client docs (metadata queries): https://www.npmjs.com/package/chromadb
- Context7 `/websites/trychroma` (Chroma official docs via MCP)
- https://docs.trychroma.com/docs/run-chroma/persistent-client?lang=typescript
- Docker Compose reference for service addresses: https://docs.docker.com/compose/
- Express docs (routing patterns): https://expressjs.com/ or Context7 `/expressjs/express`
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Subtask – Add `server/src/routes/ingestRoots.ts` for `GET /ingest/roots`. Output: `{ roots: [{ name, description, path, model, status, lastIngestAt, counts, lastError }], lockedModelId }` from `ingest_roots` collection and collection metadata.
   Handler skeleton + sample response:
   ```ts
   router.get('/ingest/roots', async (_req, res) => {
     const roots = await rootsCollection();
     res.json({ roots, lockedModelId: await getLockedModel() });
   });
   ```
   ```json
   {
     "roots": [
       {"name":"docs","description":"Project docs","path":"/repos/docs","model":"embed-1","status":"completed","lastIngestAt":"2025-01-01T12:00:00Z","counts":{"files":3,"chunks":12},"lastError":null}
     ],
     "lockedModelId":"embed-1"
   }
   ```
   - Chroma metadata query example (Context7 `/websites/trychroma`):
     ```ts
     const rows = await rootsCollection.get({ where: { repo: { "$in": ["docs", "api"] } } });
     ```
2. [x] Subtask – Ensure sorting by `lastIngestAt` desc; include `lockedModelId` for UI banner.
3. [x] Subtask – Cucumber feature `ingest-roots.feature`: scenarios (a) after ingest run returns row, (b) after remove returns empty list. Steps in `server/src/test/steps/ingest-roots.steps.ts` using Testcontainers Chroma + mocked LM Studio.
4. [x] Subtask – Update README.md with payload JSON example and filter/lock note (inputs none; output sample table row).
5. [x] Subtask – Update design.md with short flow (UI table fetch) and model-lock visibility; include payload example.
6. [x] Subtask – Update `projectStructure.md` for new route/test files.
7. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix if needed (expect success).

#### Testing

Prereqs: Chroma reachable (Testcontainers/compose) and LM Studio mocked. Expected: builds/tests/compose succeed.

1. [x] `npm run build --workspace server`
2. [x] `npm run test --workspace server`
3. [x] `npm run compose:build`
4. [x] `npm run compose:up`
5. [x] `npm run compose:down`

#### Implementation notes

- Added `/ingest/roots` route returning sorted root metadata with locked model id and resilient in-memory Chroma stub support (add/get/delete).
- Created Cucumber coverage for roots listing with mock LM Studio + in-memory Chroma, and ensured ingest orchestrator populates roots metadata even without documents/embeddings arrays.
- Updated README/design/projectStructure with the new endpoint contract and file map; validated lint/format, server build/tests, and compose up/down.

---

### 5. Server – Single-flight lock, soft cancel, and cleanup

- Task Status: __done__
- Git Commits: 33d7c1d

#### Overview

Enforce one ingest at a time, implement soft cancel, and purge partial embeddings for a run. Add incremental re-embed and remove endpoints. Covers AC: single-flight ingest, cancel/cleanup, re-embed diffs, remove/purge and model unlock when empty.

#### Documentation Locations

- Testcontainers for Node (Chroma in tests): https://node.testcontainers.org/
- Chroma Node client: https://www.npmjs.com/package/chromadb (v3.1.6) and API docs
- Context7 `/websites/trychroma` (Chroma official docs via MCP)
- https://docs.trychroma.com/docs/run-chroma/persistent-client?lang=typescript
- LM Studio embedding/tokenization: https://lmstudio.ai/docs/typescript/embedding and https://lmstudio.ai/docs/typescript/tokenization
- Express docs (routing patterns): https://expressjs.com/ or Context7 `/expressjs/express`
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Subtask – Implement global single-flight lock in `server/src/ingest/lock.ts` with TTL safeguard (e.g., 30m) and clear on completion/error/cancel. Concurrent `POST /ingest/start` returns 429 `{ status:'error', code:'BUSY' }`.
2. [x] Subtask – `POST /ingest/cancel/:runId` (route `ingestCancel.ts`): set cancel flag in orchestrator, abort LM Studio calls if possible, stop enqueueing work, delete vectors tagged with `runId`, update `ingest_roots` status to `cancelled`, respond `{ status:'ok', cleanup:'complete'|'pending' }`. Curl example: `curl -X POST http://localhost:5010/ingest/cancel/<runId>`; expected log line in server log mentioning runId and cleanup status.
   Handler skeleton:
   ```ts
   router.post('/ingest/cancel/:runId', async (req, res) => {
     const result = await orchestrator.cancel(req.params.runId);
     res.json({ status: 'ok', cleanup: result.cleanupState });
   });
   ```
3. [x] Subtask – `POST /ingest/reembed/:root` (route `ingestReembed.ts`): diff current hashes vs stored metadata, embed only changed chunks, delete removed file chunks; returns new `{ runId }`. Enforce model lock; reject if another ingest active. Curl example: `curl -X POST http://localhost:5010/ingest/reembed/my-root`.
   ```ts
   router.post('/ingest/reembed/:root', async (req, res) => {
     if (lock.isHeld()) return res.status(429).json({ status:'error', code:'BUSY' });
     const runId = await orchestrator.reembed(req.params.root);
     res.status(202).json({ runId });
   });
   ```
   - Chroma delete/query helpers (Context7 `/websites/trychroma`):
     ```ts
     await vectors.delete({ where: { repo: root } });
     await vectors.query({ queryTexts: ["updated"], where: { repo: root }, nResults: 10 });
     ```
4. [x] Subtask – `POST /ingest/remove/:root` (route `ingestRemove.ts`): purge vectors for root and delete entry in `ingest_roots`; if vectors collection becomes empty, clear locked model. Respond `{ status:'ok', unlocked: boolean }`. Curl example: `curl -X POST http://localhost:5010/ingest/remove/my-root`.
   ```ts
   router.post('/ingest/remove/:root', async (req, res) => {
     const unlocked = await orchestrator.removeRoot(req.params.root);
     res.json({ status: 'ok', unlocked });
   });
   ```
5. [x] Subtask – Update orchestrator to tag all writes with `runId` and `root` to support purge/cancel; ensure cancel cleans partial vectors. Add log entries for start, cancel, cleanup result.
6. [x] Subtask – Cucumber features: `ingest-cancel.feature`, `ingest-reembed.feature`, `ingest-remove.feature` using Testcontainers Chroma + mocked LM Studio. Assertions: lock prevents concurrent start, cancel removes runId vectors, reembed updates changed file only, remove clears root and unlocks model when empty. Include step asserting server log contains cleanup note.
7. [x] Subtask – README.md: add endpoint contract tables with request/response JSON examples for cancel/re-embed/remove; note single-flight and model lock interactions; include sample curl commands above.
8. [x] Subtask – design.md: add flow diagrams for cancel and re-embed/remove; include same example payloads; describe unlock condition when collection empty.
9. [x] Subtask – projectStructure.md: add new route/lock modules and test features.
10. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix if needed (expect clean).

#### Testing

Prereqs: Chroma reachable; LM Studio mocked; ensure no other ingest run active. Expected: builds/tests/compose succeed; cancel/re-embed/remove scenarios verified via Cucumber.

1. [x] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Log cancellation outcome and cleanup success/failure; track dirty runs if purge partial.
- Added TTL single-flight lock with cancel-aware release, cancel/re-embed/remove routes, and orchestrator support (cancel flag, vector/root purge, lock reset on empty).
- Extended Chroma in-memory stub with get/delete filtering, vectors clearing helper, and ensured roots are written for cancel/re-embed flows.
- New Cucumber coverage for cancel/re-embed/remove using LM Studio mock + in-memory Chroma; steps now reset vectors/lock per scenario and poll roots where needed.

---

### 6. Client – Ingest form & model lock (depends on NavBar after chat merge)

- Task Status: __done__
- Git Commits: 17373ae

#### Overview

Add Ingest page route/tab, form for path/name/description/model, and model lock banner. Disable model select once collection non-empty. Covers AC: ingest page UI, model selection default/lock, name/description capture.

#### Documentation Locations

- MUI docs via MCP (@mui/material@7.2.0)
- React Router docs: https://reactrouter.com/
- Jest docs: Context7 `/jestjs/jest`
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Subtask – Add `/ingest` route and NavBar tab (sync with chat branch). Files: update `client/src/routes/router.tsx`, `client/src/components/NavBar.tsx`.
2. [x] Subtask – Create `client/src/pages/IngestPage.tsx` with sections: form, lock banner, active run card placeholder, roots table placeholder.
3. [x] Subtask – Build `client/src/components/ingest/IngestForm.tsx`: fields path (required), name (required), description (optional), model select (disabled when `lockedModelId` present), dry-run toggle, start button. Validation states: show inline errors “Path is required”, “Name is required”, “Select a model” when applicable; disable submit until valid. Loading state: disable form when submitting. Empty state: when `lockedModelId` present, show banner text “Embedding model locked to <id>”. Submit calls `/ingest/start` JSON body `{ path, name, description?, model, dryRun }`.
   Prop sketch to guide typing:
   ```ts
   type IngestFormProps = {
     lockedModelId?: string;
     defaultModelId?: string;
     onStarted: (runId: string) => void;
   };
   ```
4. [x] Subtask – Hook `useIngestModels` (`client/src/hooks/useIngestModels.ts`) to fetch `/ingest/models`, return models + lockedModelId; cache first model as default when unlocked. Outputs: `{ models, lockedModelId, isLoading, error }`.
   Return type sketch:
   ```ts
   type Model = { id: string; displayName: string; contextLength?: number };
   type UseIngestModelsResult = { models: Model[]; lockedModelId?: string; isLoading: boolean; error?: string };
   ```
5. [x] Subtask – Jest/RTL tests `client/src/test/ingestForm.test.tsx`: cover unlocked vs locked, validation errors text, disabled submit when invalid or loading, payload structure on submit, lock banner visibility.
6. [x] Subtask – README.md: add ingest page route, UX summary (lock banner, validation messages), how to run locally.
7. [x] Subtask – design.md: add form layout notes and lock banner mention; include short Inputs/Outputs snippet for `/ingest/start` call.
8. [x] Subtask – projectStructure.md: add new page/component/hook/test paths.
9. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix as needed (expect success).

#### Testing

Prereqs: server endpoints available or mocked; set `VITE_API_URL` to server. Expected: build/test pass; compose stack healthy.

1. [x] `npm run build --workspace client`
2. [x] `npm run test --workspace client`
3. [x] `npm run compose:build`
4. [x] `npm run compose:up`
5. [x] `npm run compose:down`

#### Implementation notes

- Keep model fetch shared if chat provides a models endpoint; otherwise use ingest-specific endpoint.

---

### 7. Client – Active run card and status polling

- Task Status: __done__
- Git Commits: 2ad4ead

#### Overview

Show current ingest run status with counters, soft cancel, and link to logs. Poll status endpoint. Covers AC: surface progress/error states, soft cancel feedback, link to logs.

#### Documentation Locations

- MUI docs via MCP (@mui/material@7.2.0)
- React Router docs: https://reactrouter.com/
- Jest docs: Context7 `/jestjs/jest`

#### Subtasks

1. [x] Subtask – Create hook `client/src/hooks/useIngestStatus.ts` polling `/ingest/status/:runId` every ~2s, stop on terminal states. Outputs: `{ status, counts, isLoading, error, cancel }`.
   Return type sketch:
   ```ts
   type IngestCounts = { files: number; chunks: number; embedded: number; skipped?: number };
   type UseIngestStatusResult = {
     status?: 'queued'|'scanning'|'embedding'|'completed'|'cancelled'|'error';
     counts?: IngestCounts;
     isLoading: boolean;
     error?: string;
     cancel: () => Promise<void>;
   };
   ```
2. [x] Subtask – Component `client/src/components/ingest/ActiveRunCard.tsx`: show state badges (Scanning/Embedding/Cancelled/Completed/Error), counters {files, chunks, embedded, skipped}, lastError text. Cancel button calls `/ingest/cancel/:runId`; show inline success/error message. States: disable cancel while request in flight; show “Cancelling…” label.
3. [x] Subtask – Wire into `IngestPage` so when `/ingest/start` returns runId, page starts polling and shows card. Disable form/table actions while active ingest is running.
4. [x] Subtask – Add link/button to open Logs page filtered by `runId` (or copy runId to clipboard). Label: “View logs for this run”.
5. [x] Subtask – Tests `client/src/test/ingestStatus.test.tsx`: polling stops on completed/cancelled/error; cancel button invokes endpoint and updates UI; disabled states during cancel; logs link renders.
6. [x] Subtask – README.md: describe active run card, cancel behavior, polling interval, and states/messages.
7. [x] Subtask – design.md: add status/cancel flow notes or small sequence diagram; mention labels shown for each state.
8. [x] Subtask – projectStructure.md: include new hook/component/test files.
9. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues (expect success).

#### Testing

Prereqs: server status/cancel endpoints available or mocked. Expected: build/test pass; compose stack healthy.

1. [x] `npm run build --workspace client`
2. [x] `npm run test --workspace client`
3. [x] `npm run compose:build`
4. [x] `npm run compose:up`
5. [x] `npm run compose:down`

#### Implementation notes

- Consider exponential backoff on polling in error states; ensure cleanup messages align with server responses.

---

### 8. Client – Embedded folders table, details drawer, and actions

- Task Status: __done__
- Git Commits: 96911a9, d471631

#### Overview

Render table of embedded roots with actions (Re-embed, Remove, Details) and description hover/tooltip. Include bulk actions and empty state. Covers AC: remove/re-embed controls, description hover/click, model lock visibility, empty state.

#### Documentation Locations

- MUI docs via MCP (@mui/material@7.2.0)
- React Router docs: https://reactrouter.com/
- Jest docs: Context7 `/jestjs/jest`

#### Subtasks

1. [x] Subtask – Create hook `client/src/hooks/useIngestRoots.ts` to call `/ingest/roots`, returning `{ roots, lockedModelId, isLoading, error, refetch }`; refetch after re-embed/remove/start completes.
   Return type sketch:
   ```ts
   type IngestRoot = { name: string; description?: string; path: string; model: string; status: string; lastIngestAt?: string; counts?: { files?: number; chunks?: number } };
   type UseIngestRootsResult = { roots: IngestRoot[]; lockedModelId?: string; isLoading: boolean; error?: string; refetch: () => Promise<void> };
   ```
2. [x] Subtask – Component `client/src/components/ingest/RootsTable.tsx`: columns Name (tooltip with description), Path, Model, Status chip, Last ingest time, counts, row actions (Re-embed → POST /ingest/reembed/:root, Remove → POST /ingest/remove/:root, Details). States: disable row/bulk actions during active ingest; show inline success/error text after actions; empty state text “No embedded folders yet. Start an ingest to see entries.”
3. [x] Subtask – Component `client/src/components/ingest/RootDetailsDrawer.tsx`: shows name, description, path, model (locked), run history (from status/roots data), last error, include/exclude lists (from server response if available; otherwise render env defaults summary). Loading skeleton while data fetching.
4. [x] Subtask – Empty state and lock banner: preserve lock banner; empty state copy explains model lock and first ingest guidance.
5. [x] Subtask – Tests `client/src/test/ingestRoots.test.tsx`: table render, tooltip, details drawer content, re-embed/remove action calls, disabled state when active ingest, empty state text, success/error messaging.
6. [x] Subtask – README.md: document table/actions UX, empty state copy, lock effects on actions.
7. [x] Subtask – design.md: add layout notes/diagram for roots table and details drawer; include expected labels/states (empty, disabled, success/error).
8. [x] Subtask – projectStructure.md: add new hook/components/tests.
9. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues (expect clean).

#### Testing

Prereqs: server roots/re-embed/remove endpoints available or mocked. Expected: build/test pass; compose stack healthy.

1. [x] `npm run build --workspace client`
2. [x] `npm run test --workspace client`
3. [x] `npm run compose:build`
4. [x] `npm run compose:up`
5. [x] `npm run compose:down`

#### Implementation notes

- Consider pagination if many roots; otherwise simple list is fine for this story.

---

### 9. Final verification

- status: __done__
- Git Commits: 6c2387d, 5b4e50f, 43c2c7f

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

1. [x] Subtask – Add `docker-compose.e2e.yml` with isolated Chroma service/volume for e2e tests; ensure it does not affect the main compose stack; document volume cleanup (`docker compose -f docker-compose.e2e.yml down -v`).
2. [x] Subtask – Update `package.json` `e2e:*` scripts to use the e2e compose stack (build/up/down) and ensure env points to the e2e Chroma (COMPOSE_FILE or overrides).
3. [x] Subtask – Add Playwright e2e: start ingest on empty DB (select model, ingest sample folder), see status progress, complete, and entries appear in table. Use dedicated e2e docker-compose stack with isolated Chroma volume.
   Playwright snippet starter:
   ```ts
   test('ingest happy path', async ({ page }) => {
     await page.goto(process.env.E2E_BASE_URL ?? 'http://localhost:5001/ingest');
     await page.fill('input[name="path"]', '/fixtures/repo');
     await page.fill('input[name="name"]', 'fixtures');
     await page.click('text=Start ingest');
     await expect(page.getByText('Embedding model locked')).toBeVisible();
     await expect(page.getByText('Completed')).toBeVisible({ timeout: 120000 });
     await expect(page.getByRole('row', { name: /fixtures/ })).toBeVisible();
   });
   ```
4. [x] Subtask – Add Playwright e2e: cancel in-progress ingest, verify UI shows cancelled/cleanup state, no partial entries remain.
   ```ts
   test('cancel ingest', async ({ page }) => {
     await page.goto(BASE);
     await page.click('text=Start ingest');
     await page.click('text=Cancel');
     await expect(page.getByText('Cancelled')).toBeVisible({ timeout: 60000 });
     await expect(page.getByRole('row', { name: /fixtures/ })).not.toBeVisible();
   });
   ```
5. [x] Subtask – Add Playwright e2e: re-embed flow — modify a file, rerun ingest, verify updated timestamp/counts in table/details.
   ```ts
   test('re-embed updates timestamps', async ({ page }) => {
     await page.goto(BASE);
     await page.click('text=Re-embed');
     await expect(page.getByText('Completed')).toBeVisible({ timeout: 120000 });
     const ts = await page.getByRole('row', { name: /fixtures/ }).getByTestId('last-ingest');
     expect(ts).not.toBeNull();
   });
   ```
6. [x] Subtask – Add Playwright e2e: remove embedded root, verify table clears and model lock resets when collection empty.
   ```ts
   test('remove unlocks model', async ({ page }) => {
     await page.goto(BASE);
     await page.click('text=Remove');
     await expect(page.getByText('No embedded folders yet')).toBeVisible();
     await expect(page.getByText('Embedding model locked')).not.toBeVisible();
   });
   ```
7. [x] Subtask – Ensure Readme.md is updated with ingest endpoints/flows, e2e compose usage, and any new commands
8. [x] Subtask – Ensure Design.md is updated with ingest flows/diagrams and model-lock notes
9. [x] Subtask – Ensure projectStructure.md is updated with added/updated files & folders (including e2e compose file)
10. [x] Subtask – Create a PR-ready summary of changes (include ingest endpoints, UI, model lock, cancel/re-embed/remove)
11. [x] Subtask – Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run test --workspace server`
2. [x] `npm run test --workspace client`
3. [x] `npm run build --workspace server`
4. [x] `npm run build --workspace client`
5. [x] `npm run compose:build`
6. [x] `npm run compose:up`
8. [x] `npm run compose:down`
6. [x] `npm run e2e:up`
7. [x] `npm run e2e:test` (including new ingest e2e cases)
8. [x] `npm run e2e:down`

#### Implementation notes

- Coordinate rebase/merge with chat branch for NavBar/router before final checks; capture any screenshots for ingest UI if needed.
- PR summary draft: Added ingest roots UI (table/details/actions), implemented ingest e2e compose stack + Playwright ingest flows (happy/cancel/re-embed/remove with model-lock awareness), updated docs (README/design/projectStructure) and scripts for isolated e2e runs.
- E2E status: `npm run e2e:test` now passes against the e2e stack with LM Studio models available; all build/test/compose steps are green.

---

### 10. Server – ingest start/roots fixes (body parsing & Chroma metadata)

- status: __done__
- Git Commits: c2159ab, 9575b50, b60632b, 5d228f5, 2272267

#### Overview

Resolve the ingest API failures blocking e2e: JSON bodies aren’t parsed (so `/ingest/start` returns 400) and Chroma rejects `metadata.lockedModelId: null`, causing `/ingest/roots` 502s. Adjust middleware and metadata handling so ingest requests and roots listing succeed in e2e without muting the default embedding warning.

#### Documentation Locations

- Express JSON middleware: https://expressjs.com/en/api.html#express.json
- Chroma collections metadata rules: https://docs.trychroma.com/api-reference#collections

#### Subtasks

1. [x] Add `express.json()` middleware in `server/src/index.ts` before route registration so `/ingest/start` receives parsed bodies.
2. [x] Change Chroma collection initialization to avoid `lockedModelId: null`; omit the key until set, and adjust `getLockedModel/setLockedModel/clearLockedModel` to handle undefined/empty string safely.
3. [x] Add a small cleanup/reset step for e2e to drop existing Chroma collections or volume so stale metadata doesn’t persist (document command in README/design or e2e notes).
4. [x] Add Cucumber coverage for body parsing: create `server/src/test/features/ingest-start-body.feature` and steps `server/src/test/steps/ingest-start-body.steps.ts` that spin up the app with LM Studio mock + Chroma testcontainer, POST `/ingest/start` with JSON `{path:'/fixtures/repo',name:'repo',model:'embed-1',dryRun:true}`, and assert 202 + `runId` present (guards against 400 VALIDATION when body isn’t parsed).
5. [x] Add Cucumber coverage for Chroma metadata: create `server/src/test/features/ingest-roots-metadata.feature` and steps `server/src/test/steps/ingest-roots-metadata.steps.ts` that start with a clean Chroma volume, hit `/ingest/roots`, and assert 200 with `roots: []` and `lockedModelId` null/undefined (guards against 502 from `lockedModelId: null` metadata); reuse existing testcontainer setup/LM Studio mock.
6. [x] Ensure ingest start uses the same ws/wss conversion helper (`toWebSocketUrl`) as chat/models routes when constructing LM Studio clients.
7. [x] Verify `/ingest/roots` returns 200 with empty roots on a clean e2e stack; verify `/ingest/start` accepts a valid payload and returns 202 in dry-run mode.
8. [x] Update ingest roots write to satisfy Chroma’s requirement (no metadata-only add): supply a minimal placeholder embedding per root (e.g., `embeddings: [[0]]`, omit `documents`) with the existing `metadatas`, so Chroma doesn’t try to embed documents; ensure `vectors.add` is only called when we have embeddings.
9. [x] Add guards so ingest skips `add` calls when zero files/chunks are discovered, returning a clear error like “No eligible files found in <path>” instead of relying on Chroma errors.
10. [x] Rerun `npm run e2e` to confirm ingest flows pass (build, up, test, down); leave the DefaultEmbeddingFunction warning untouched.
11. [x] Silence Chroma default-embed warnings by providing a custom embedding function: add a Chroma client wrapper that passes an explicit embedding function using our LMStudio embedding model (see “Custom Embedding Functions” in https://docs.trychroma.com/docs/embeddings/embedding-functions?lang=typescript#custom-embedding-functions). Stub the embedding function to call LM Studio `embedding.model(modelKey).embed(texts[])`, wire it into `getVectorsCollection/getRootsCollection`, and keep dimensions consistent with existing adds.
12. [x] Add structured logging around the delete/remove path: log before calling Chroma delete/count/add, after success, on catch with error details, and at branching points in `removeRoot`, `clearRootsCollection`, `clearVectorsCollection`, and the `/ingest/remove/:root` route to trace the exact failure path in e2e.
13. [x] Fix lock clearing after remove: adjust `clearLockedModel()` so it doesn’t call `collection.modify({ metadata: {} })`, which Chroma rejects with “Expected metadata to be non-empty.” Use a non-empty metadata payload (e.g., `{ lockedModelId: null }`) or skip modify when metadata is already absent. Purpose: prevent 500s on `/ingest/remove/:root` when the vectors collection is empty and we attempt to release the model lock.

### 11. Cucumber – move ingest tests to Testcontainers

- status: **done**
- Git Commits: 737d89a, 2a80e77

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright (for existing e2e context): Context7 `/microsoft/playwright`
- Mermaid (if diagrams needed): Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/
- Chroma collections management (delete collections): https://docs.trychroma.com/docs/collections/manage-collections?lang=typescript#deleting-collections
- Chroma client/API reference: https://docs.trychroma.com/api-reference
- Testcontainers for Node: https://node.testcontainers.org/

#### Overview

Replace the in-memory Chroma mock in ingest Cucumber suites with real Chroma via Testcontainers. Provide a minimal compose file for manual debugging, start/stop Chroma from Cucumber hooks, and point ingest step defs at the real container while keeping LM Studio mocked. Aim: surface real Chroma validation (e.g., metadata-only adds) during BDD runs.

Prior issue to avoid: when a test-only embedding function produced vectors of a different dimension than the embeddings we added (or when roots used a 1-D placeholder), Chroma threw “no embedding function / dimension mismatch” errors. Strategy: keep the exact production embedding path (LM Studio/noop, no test embedding function), derive the roots placeholder embedding length from the first vectors add (fallback to 1 if none), and run Chroma via Testcontainers so code paths match prod.

#### Subtasks

1. [x] Add `server/src/test/compose/docker-compose.chroma.yml` for manual debug only: single `chromadb/chroma:1.3.5` service with named volume (e.g., `chroma-test-data`) mapped to a fixed non-standard host port `18000:8000`. Document teardown `docker compose -f server/src/test/compose/docker-compose.chroma.yml down -v` so it never blocks Testcontainers.
2. [x] Add `server/src/test/support/chromaContainer.ts` hooks (loaded by `server/cucumber.js`):
   - `BeforeAll`: start `chromadb/chroma:1.3.5` via `GenericContainer` with a fixed host port mapping (e.g., `.withFixedExposedPort(18000, 8000)`), set `process.env.CHROMA_URL = http://<host>:18000`, and log the value for troubleshooting.
   - `Before`: delete then recreate ingest collections (vectors + roots) each scenario.
   - `AfterAll`: stop the container.
3. [x] Keep ingest code paths identical to prod: remove any test-only embedding flags (`CHROMA_TEST_EMBEDDINGS`, etc.) and delete `CHROMA_URL='mock:'` overrides so step defs rely solely on the hook-injected `process.env.CHROMA_URL`. LM Studio stays mocked exactly as before.
4. [x] Align roots placeholder embeddings to collection dimensions in `server/src/ingest/ingestJob.ts`: derive `vectorDim` from the first vectors add (fallback 1 when none/dry-run) and add roots with `embeddings: [Array(vectorDim).fill(0)]` to avoid dimension errors.
5. [x] Update ingest step defs (`ingest-start.steps.ts`, `ingest-roots.steps.ts`, `ingest-manage.steps.ts`, `ingest-start-body.steps.ts`, `ingest-roots-metadata.steps.ts`): remove hard-coded `CHROMA_URL` or mock URLs; read `process.env.CHROMA_URL` only; retain LM Studio mocking.
6. [x] README: document that Cucumber ingest tests run against real Chroma via Testcontainers on a fixed non-standard host port (18000) so the main stack on 8000 can stay running; include manual debug commands for the compose file (same port) and the teardown reminder; note Docker must be running and the image pull will happen automatically.
7. [x] design.md: add a short paragraph/mini-sequence for the BDD flow (LM Studio mocked, real Chroma via Testcontainers on fixed port 18000, per-scenario wipe, same embedding path as prod, roots placeholder dim derived from vectors).
8. [x] projectStructure.md: list `server/src/test/compose/docker-compose.chroma.yml` and `server/src/test/support/chromaContainer.ts`.
9. [x] Add a “setup/commands” note (hooks file or README) with exact commands for juniors: `npm run build --workspace server`, `npm run build --workspace client`, `npm run test --workspace server` (starts Testcontainers; Docker required), `npm run test --workspace client`, `npm run compose:build`, `npm run compose:up`, `npm run compose:down`, `npm run e2e`; mention `INGEST_COLLECTION`/`INGEST_ROOTS_COLLECTION` defaults come from `.env` and no test-only embedding envs are needed.
10. [x] Add the missing Cucumber step definition for `Given the ingest roots test server is running with mock chroma and lmstudio` so ingest-roots-metadata.feature executes without undefined steps.
11. [x] Fix failing Cucumber cancel scenario: Chroma rejects `description: null` metadata during cancel. Update cancel path and roots add/write code to omit description when absent (or set to empty string) so metadata validates, then rerun server tests.
12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix any issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run compose:build`
6. [x] `npm run compose:up`
8. [x] `npm run compose:down`
7. [x] `npm run e2e` (builds, starts, runs e2e tests against a fresh docker instance, & shuts it down)

#### Implementation notes

- Keep the compose file minimal (Chroma only) and internal to tests; avoid host port publish unless Testcontainers requires it.

---

### 12. E2E – Clean Chroma state & stabilize re-embed

- status: __done__
- Git Commits: 2a24088, 727c3f5

#### Overview

E2E runs can inherit stale Chroma data because the e2e compose stack mounts a persistent `chroma-e2e-data` volume. This can cause model locks/dimension mismatches and re-embed 500s (as seen in recent runs). Make e2e Chroma ephemeral by default, enforce a clean state per run, and harden re-embed/remove e2e coverage to surface real errors while keeping state isolated.

#### Documentation Locations

- Docker/Compose volumes: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Chroma collections management: https://docs.trychroma.com/docs/collections/manage-collections?lang=typescript#deleting-collections
- Jest/Playwright expectations: Context7 `/jestjs/jest`

#### Subtasks

1. [x] Make e2e Chroma ephemeral by default  
   - File: `docker-compose.e2e.yml`  
   - Change: replace the named volume mount `chroma-e2e-data:/chroma/.chroma` with an anonymous volume (`- /chroma/.chroma`) or `tmpfs: /chroma/.chroma` so every `compose:e2e:up` starts empty.  
   - Ensure the `volumes:` block no longer declares `chroma-e2e-data`.
2. [x] Add a pre-clean step to the e2e flow  
   - File: `package.json` scripts or a small helper script (e.g., `scripts/clean-e2e-volume.sh`).  
   - Command to run before `compose:e2e:up`: `docker volume rm codeinfo2_chroma-e2e-data 2>/dev/null || true` (with a note that it’s harmless if absent).  
   - If using a script, document it and call it from `e2e` or `compose:e2e:up` to cover manual runs that skip `-v`.
3. [x] Assert/clear clean state in ingest e2e  
   - File: `e2e/ingest.spec.ts`.  
   - Before re-embed/remove tests, call the server `/ingest/roots` API and assert it returns `roots: []`; if not empty, POST `/ingest/remove/<root>` for each root to clear.  
   - Alternatively add a small helper in the spec to loop remove calls until empty; fail fast if any remove returns non-200.
4. [x] Capture and assert server log output on re-embed failures  
   - During the e2e test, after re-embed actions, fetch `/logs?text=re-embed&limit=50` (or read `logs/server-e2e.*.log` on disk) and assert no 500/“dimension mismatch”/“MODEL_LOCKED” errors.  
   - If errors appear, surface them via `expect` with a clear message so CI shows the root cause.
5. [x] Verify stability with repeated runs  
   - Run `npm run e2e` twice in a row (without manually deleting volumes) and confirm:  
     - Roots table starts empty on each run.  
     - Happy path, cancel, re-embed, remove all pass with no 500s in logs.  
     - Model lock chip reflects the model chosen in the current run only.

#### Testing

1. [x] `npm run e2e` (full cycle) — confirm roots are empty at start, all ingest flows pass, and no 500s in server-e2e logs.  
2. [x] Run `npm run compose:e2e:up && npm run e2e:test && npm run compose:e2e:down` (intentionally without `-v`) and verify the pre-clean step still yields an empty Chroma and passing tests.  
3. [x] After tests, grep `logs/server-e2e.*.log` for `re-embed` and ensure no 500/dimension/lock errors appear.

#### Implementation notes

- Aim for zero persistence of Chroma data between e2e runs to avoid model lock/dimension drift.
- Prefer minimal changes to the app; focus on e2e infra and test robustness.
- Swapped the e2e Chroma volume to anonymous (no named volume) and added a `compose:e2e:clean` script so every bring-up starts empty even if a previous run left volumes behind.
- Ingest e2e now force-cleans roots via the API (using `root.path`), waits for terminal states only, and asserts re-embed logs are clean to surface regressions earlier.
- Fixed `/ingest/reembed` 500s by removing the unsupported `ids` include from the Chroma roots query; re-embed now returns 202 and log greps show no dimension/model-lock errors.
- Ran `npm run e2e` multiple times plus a manual `compose:e2e:up && e2e:test && down` flow to verify repeated runs stay clean and lock state resets each time.

---

### 13. Server – LM Studio ws/wss validation in Cucumber

- status: __done__
- Git Commits: 4b63c4c, 6c92050

#### Overview

Add coverage so the LM Studio SDK mock mirrors real behaviour: reject `http://` base URLs and surface the same error we see in e2e. Ensure ingest start/re-embed fail fast in BDD when given a non-ws/wss URL, preventing regressions like the recent production slip.

#### Documentation Locations

- LM Studio SDK base URL/WS rules: https://lmstudio.ai/docs/typescript/overview (connection requirements)
- Express routing patterns: https://expressjs.com/
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [x] **Mock validation** – File: `server/src/test/support/mockLmStudioSdk.ts`. Add a guard in the mock client factory so when it receives a base URL that does not start with `ws://` or `wss://`, it throws the same error string as the real SDK: `Failed to construct LMStudioClient. The baseUrl passed in must have protocol "ws" or "wss". Received: <url>`.
2. [x] **Feature file** – Create `server/src/test/features/ingest-lmstudio-protocol.feature` with two scenarios: (a) LM Studio baseUrl set to http:// returns HTTP 500 and the SDK-like error when probing; (b) ws:// baseUrl returns 200 OK.
3. [x] **Step definitions** – Add `server/src/test/steps/ingest-lmstudio-protocol.steps.ts` that spins up a tiny express app with `/lmstudio/probe`, sets `LMSTUDIO_BASE_URL` per scenario, and asserts the status/error string matches the real SDK output.
4. [x] **Happy-path safety check** – In the same steps, ensure the ws:// scenario returns 200 with an "ok" message to prove mocks still work.
5. [x] **Docs in steps** – Comment in the steps file that Docker/Testcontainers may start when running the server suite; remind how to run it: `npm run test --workspace server`.
6. [x] **Tests/Lint/Format** – Run `npm run test --workspace server` (starts Docker for Chroma). Then run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix` / `npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run test --workspace server`

#### Implementation notes

- LM Studio mock now throws on non-ws/wss base URLs; probe feature/steps cover http (500) vs ws (200) and reset env between runs.
- Existing server step hooks now use ws://localhost:1234 to keep suites green; protocol feature uses its own tiny Express probe endpoint to isolate behaviour.

---

### 14. Server – Ingest fallback when git is unavailable (and add git to runtime)

- status: **in_progress**
- Git Commits: **to_do**

#### Overview

Ensure ingest can run on non-git folders or when `git ls-files` fails/missing. Add a graceful fallback to walk the filesystem when git tracking cannot be determined, while preserving the current git-tracked-only behaviour when git is available and returns results. Also install `git` in the server runtime image so tracked-only mode works in Docker. Prevents false "No eligible files" errors when git isn't present and avoids ingesting untracked junk when it is.

#### Documentation Locations

- Git ls-files reference: https://git-scm.com/docs/git-ls-files
- Node fs/promises & child_process docs (Context7 `/nodejs/node` if needed)
- Existing ingest discovery module: `server/src/ingest/discovery.ts`
- Jest docs: Context7 `/jestjs/jest`

#### Subtasks

1. [x] Update `listGitTracked` to return a discriminated result: `{ ok: true, paths: string[] }` on success; `{ ok: false, error }` on failure (e.g., git missing). Do **not** return an empty list on error.
2. [x] In `discoverFiles`, when `.git` exists: call `listGitTracked`. If `ok === true`, use `paths`; if `ok === false`, log an info/debug note like `git ls-files failed, falling back to walkDir` and then call `walkDir(root)`. Keep the existing include/exclude and text checks unchanged for both paths.
3. [x] Add Cucumber coverage in `server/src/test/features/ingest-discovery-fallback.feature` with steps under `server/src/test/steps/` covering:
   - (a) git success uses git list: create a temp repo with a tracked file, ensure the discovered files include it and exclude an untracked file.
   - (b) git failure (simulate git missing by stubbing exec or PATH) triggers fallback walkDir and finds a known file.
   - (c) empty repo (git returns empty) results in no files and propagates the "No eligible files" error from `/ingest/start`.
   Include setup/teardown in hooks; keep all tests inside `server/src/test` per repo convention.
4. [x] Install git in the server runtime image (`server/Dockerfile` runtime stage) so tracked-only mode works in containers; keep image small (e.g., `apt-get install -y git` alongside curl cleanup).
5. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix any issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run compose:build`
6. [x] `npm run compose:up`
8. [x] `npm run compose:down`
7. [x] `npm run e2e` (builds, starts, runs e2e tests against a fresh docker instance, & shuts it down)

#### Implementation notes

- Fallback should not change behaviour when git returns a valid list; only trigger when the git command fails or is missing.

---

### 15. Server – Log ingest lifecycle (start/success/error)

- status: **to_do**
- Git Commits: **to_do**

#### Overview

Emit structured log entries to the server log store for ingest lifecycle events so they appear on the Logs page: on start, on successful completion, and on error (including the "No eligible files" path). Include runId, path/root, model, counts (files/chunks/embedded), state, and error message when applicable.

#### Documentation Locations

- Existing logging store: `server/src/logStore.ts`, logger setup `server/src/logger.ts`
- Ingest orchestrator: `server/src/ingest/ingestJob.ts`
- Logs page UI expectations: client Logs page (existing behaviour)

#### Subtasks

1. [ ] Emit structured log entries (use the existing server logger/logStore so they appear on the Logs page) at:
   - **info**: ingest start — fields: runId, path (startPath), model, name/description, state=start
   - **info**: ingest completed — runId, root, model, files, chunks, embedded, state=completed
   - **error**: ingest failed/no eligible files — runId, path/root, model, counts, message/lastError, state=error
   Keep payloads small and consistent with existing log schema; do not log at debug.
2. [ ] Add a Cucumber scenario in `server/src/test/features/ingest-logging.feature` with steps under `server/src/test/steps/` asserting:
   - start emits an info log with runId and state=start
   - the "no eligible files" path emits an error log with runId and the message
   - a successful ingest emits an info log with state=completed and counts
   Use API calls to `/logs?text=<runId>` to assert visibility.
3. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix any issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
8. [ ] `npm run compose:down`
7. [ ] `npm run e2e` (builds, starts, runs e2e tests against a fresh docker instance, & shuts it down)

#### Implementation notes

- Use existing log store helpers to keep entries visible on the Logs page; avoid duplicating pino-http request logs.
- Keep payloads small and redaction rules consistent with existing logging.

---
