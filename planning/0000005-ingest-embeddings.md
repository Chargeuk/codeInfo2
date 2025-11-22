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

Implement server-side folder discovery respecting git-tracked-only rules, exclude lists, and text-only constraint. Add chunking with heuristic boundaries and token caps using LM Studio SDK context length, plus hashing for file/chunk diffs.

#### Documentation Locations

- design.md (token limits, chunking heuristics)
- README.md (server ingest section to add)
- projectStructure.md (new server files)
- LM Studio SDK docs (countTokens, getContextLength)

#### Subtasks

1. [ ] Create ingest service module to: locate repo root (git), list tracked files, apply excludes (hard + env), filter to text files, and compute file hashes.
2. [ ] Add chunker that prefers class/function regex boundaries, falls back to size-based splits using `countTokens` and `getContextLength` with safety margin.
3. [ ] Compute deterministic chunk hashes and capture metadata scaffold (root, relPath, fileHash, chunkHash, embeddedAt placeholder, model).
4. [ ] Unit tests for discovery/excludes/text detection/chunking/hash functions.
5. [ ] Update projectStructure.md with new server modules.

#### Testing

1. [ ] `npm run test --workspace server` (ensure unit tests for discovery/chunking run)
2. [ ] `npm run build --workspace server`

#### Implementation notes

- Cucumber integration added in Task 2 when endpoints exist.

---

### 2. Server – Ingest API & Chroma write

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose ingest endpoints and wire Chroma writes with metadata. Provide Cucumber coverage. Ensure model lock is enforced when collection non-empty.

#### Documentation Locations

- design.md, README.md (API), projectStructure.md
- Chroma Node client docs (chromadb 3.1.6)
- LM Studio SDK (embedding)
- LM Studio listDownloadedModels (embedding models filter)

#### Subtasks

1. [ ] Add Chroma client config (Docker 1.3.5 target), shared vectors collection init, and model-lock enforcement (lock once non-empty). Create a small management collection (`ingest_roots`) to store per-root/run summaries (name, description, model, status, counts, lastIngestAt, runId).
2. [ ] Endpoint `POST /ingest/start` (body: path, name, description, model, dryRun?): kicks off ingest job, returns runId; rejects if another ingest running or model lock violated.
3. [ ] Endpoint `GET /ingest/status/:runId` for polling current run (state, counts, last error).
4. [ ] Endpoint `GET /ingest/roots` listing embedded roots with metadata, last run, counts, model.
5. [ ] Endpoint `GET /ingest/models` that filters LM Studio `listDownloadedModels` to embedding-capable models only; used by ingest UI/model lock.
6. [ ] Wire ingest job to use chunker, embed via LM Studio SDK, and upsert vectors with metadata (runId, root, relPath, hashes, model, embeddedAt, name, description). Upsert/patch `ingest_roots` record with status and counts.
6. [ ] Cucumber feature + steps covering happy path ingest start/status/list with mocked LM Studio + Chroma (use mock clients); include model-lock violation case.
7. [ ] Cucumber feature + steps covering `/ingest/models` filtering only embedding models.
8. [ ] Update README.md/design.md/projectStructure.md with new endpoints, collection/model lock rules, and data flow.
9. [ ] `npm run lint --workspaces` and `npm run format:check --workspaces` (fix if needed).

#### Testing

1. [ ] `npm run test --workspace server` (Cucumber)
2. [ ] `npm run build --workspace server`

#### Implementation notes

- Reuse runId for log filtering; ensure dry-run skips Chroma writes.

---

### 3. Server – Single-flight lock, soft cancel, and cleanup

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Enforce one ingest at a time, implement soft cancel, and purge partial embeddings for a run. Add incremental re-embed and remove endpoints.

#### Documentation Locations

- design.md (cancel/cleanup flow)
- README.md (API usage)
- projectStructure.md

#### Subtasks

1. [ ] Add server-wide ingest lock with clear error on concurrent start; include lock TTL/guard.
2. [ ] Support cancel: `POST /ingest/cancel/:runId` sets cancel flag, aborts embedding calls, stops new work, then deletes vectors tagged with runId and updates `ingest_roots` status; return status to caller.
3. [ ] Incremental re-embed endpoint `POST /ingest/reembed/:root` to diff by file/chunk hashes and update/delete as needed; update `ingest_roots` record with new runId/status/counts.
4. [ ] Remove endpoint `POST /ingest/remove/:root` to purge all vectors for a root (both vectors collection and `ingest_roots` record) and clear model lock if collection becomes empty.
5. [ ] Cucumber features/steps for cancel, re-embed, and remove, asserting cleanup of runId-tagged vectors and lock behavior.
6. [ ] Update README.md/design.md/projectStructure.md for cancel/re-embed/remove flows and soft-cancel semantics.
7. [ ] `npm run lint --workspaces` and `npm run format:check --workspaces` (fix if needed).

#### Testing

1. [ ] `npm run test --workspace server` (Cucumber)
2. [ ] `npm run build --workspace server`

#### Implementation notes

- Log cancellation outcome and cleanup success/failure; track dirty runs if purge partial.

---

### 4. Client – Ingest form & model lock (depends on NavBar after chat merge)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add Ingest page route/tab, form for path/name/description/model, and model lock banner. Disable model select once collection non-empty.

#### Documentation Locations

- design.md (GUI notes), README.md (UI), projectStructure.md
- MUI docs via MCP (@mui/material@7.2.0)

#### Subtasks

1. [ ] Add `/ingest` route and NavBar tab (coordinate with chat branch; rebase if needed).
2. [ ] Build form with inputs: path, display name, description, model dropdown (disabled when lock active), Start button, Dry-run toggle; surface inline errors/status.
3. [ ] Fetch model list from `/ingest/models` (embedding-capable only); enforce disabled select when locked; show lock banner.
4. [ ] Jest/RTL tests for form render, lock state, validation, disabled states, and submit payload.
5. [ ] Update README.md/design.md/projectStructure.md for new page/route and model lock UX.
6. [ ] `npm run lint --workspaces` and `npm run format:check --workspaces` (fix if needed).

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run build --workspace client`

#### Implementation notes

- Keep model fetch shared if chat provides a models endpoint; otherwise use ingest-specific endpoint.

---

### 5. Client – Active run card and status polling

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Show current ingest run status with counters, soft cancel, and link to logs. Poll status endpoint.

#### Documentation Locations

- design.md, README.md, projectStructure.md
- MUI docs via MCP

#### Subtasks

1. [ ] Add status card that appears when a run is active: states (Scanning/Embedding/Cancelled/Completed/Error), counters (files/chunks, skipped), last error text.
2. [ ] Hook polling to `/ingest/status/:runId`; handle transitions to completed/cancelled/error; stop polling on terminal states.
3. [ ] Add Cancel button (soft) calling cancel endpoint; show result messages (“cancelled and cleaned” vs “cleanup pending”).
4. [ ] Link to Logs page pre-filtered by runId (if possible); otherwise copy runId affordance.
5. [ ] Jest/RTL tests covering state transitions, cancel flow, and polling stop.
6. [ ] Update README.md/design.md/projectStructure.md accordingly.
7. [ ] `npm run lint --workspaces` and `npm run format:check --workspaces` (fix if needed).

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run build --workspace client`

#### Implementation notes

- Consider exponential backoff on polling in error states; ensure cleanup messages align with server responses.

---

### 6. Client – Embedded folders table, details drawer, and actions

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Render table of embedded roots with actions (Re-embed, Remove, Details) and description hover/tooltip. Include bulk actions and empty state.

#### Documentation Locations

- design.md, README.md, projectStructure.md
- MUI docs via MCP

#### Subtasks

1. [ ] Build table with columns: Name (with info tooltip for description), Path, Model, Status chip, Last ingest time, optional counts, row actions (Re-embed, Remove, Details), bulk select.
2. [ ] Implement Details drawer showing name, description, path, model (locked), run history, last error, include/exclude lists used.
3. [ ] Wire Re-embed action to server endpoint with optimistic/disable while running; Remove to purge endpoint (confirm dialog).
4. [ ] Empty state messaging and model-lock banner persistence; ensure actions disabled when an ingest is active.
5. [ ] Jest/RTL tests for table render, tooltip, drawer content, action handlers, bulk disable during active ingest.
6. [ ] Update README.md/design.md/projectStructure.md for table/drawer and actions.
7. [ ] `npm run lint --workspaces` and `npm run format:check --workspaces` (fix if needed).

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run build --workspace client`

#### Implementation notes

- Consider pagination if many roots; otherwise simple list is fine for this story.

---

### 7. Final verification

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

1. [ ] Build the server
2. [ ] Build the client
3. [ ] perform a clean docker build
4. [ ] Ensure Readme.md is updated with ingest endpoints/flows and any new commands
5. [ ] Ensure Design.md is updated with ingest flows/diagrams and model-lock notes
6. [ ] Ensure projectStructure.md is updated with added/updated files & folders
7. [ ] Create a PR-ready summary of changes (include ingest endpoints, UI, model lock, cancel/re-embed/remove)

#### Testing

1. [ ] `npm run test --workspace server`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace server`
4. [ ] `npm run build --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run e2e:test` (add ingest e2e if present; otherwise smoke existing)
8. [ ] `npm run compose:down`

#### Implementation notes

- Coordinate rebase/merge with chat branch for NavBar/router before final checks; capture any screenshots for ingest UI if needed.

---
