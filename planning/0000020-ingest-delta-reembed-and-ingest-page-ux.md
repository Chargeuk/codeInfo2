# Story 0000020 – Delta re-ingest (file-hash based) + Ingest page UX tidy

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):
- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today, ingest (and re-embed) behaves like a full rebuild of a folder’s embeddings. This is simple and robust, but it scales poorly for large folders because a re-ingest must re-read, re-chunk, re-embed, and rewrite vectors for every file even when only a small subset changed.

We want to introduce a **delta re-ingest** mechanism driven by **file content hashes** so that when a user requests a re-ingest, the server only re-embeds files that are new or have changed, and removes embeddings for files that have been deleted.

Glossary:
- **root**: the ingest root id/name stored for a folder and used as the collection namespace in ingest metadata (the same value returned by `GET /ingest/roots`).

To make deletions/changes fast and avoid scanning chunk metadata in Chroma, we will introduce a lightweight **per-file index stored in MongoDB** (collection `ingest_files`) keyed by `{ root, relPath }` and storing `fileHash` (plus a minimal `updatedAt` for debugging). This index is used to:
- detect deleted files (present in the index but not found on disk),
- detect changed files (hash differs), and
- detect new files (present on disk but not in the index).

File hashes use a simple, deterministic algorithm (SHA-256 of the file bytes as read from disk). We do not use mtime/size shortcuts in v1.

For changed files, we will treat re-ingest as a **file-level replacement**: re-chunk and re-add the file’s vectors tagged with the run id, and only after success delete older vectors for `{ root, relPath }` where the stored `fileHash` differs. We will not attempt chunk-level upserts because modified files are very unlikely to retain the same chunk boundaries. If a run is cancelled mid-file, existing vectors remain intact.

Separately, the Ingest page UI has a couple of small usability issues:
- When the embedding model is locked, the same info notice appears twice (once on the page and once inside the form). We want to show it only once to reduce noise.
- The “Folder path” field is currently text-only; we want an optional “Choose folder…” affordance that helps users select a folder path more reliably.
  - This should be a **server-backed directory picker** (a modal that lists directories under an allowed base like `/data` / `HOST_INGEST_DIR`) and writes the chosen server-readable path back into the text field.
  - It must not require browser access to the user’s local filesystem, and it must not switch ingest to an upload-based model.

This story aims to reduce re-ingest time and compute cost while keeping the ingest model lock, progress reporting, and current ingest status polling behavior intact.

---

## Message Contracts

### Directory picker (new endpoint)

**Request**
- `GET /ingest/dirs?path=<absolute server path>`
- `path` is optional; when omitted, the base defaults to `HOST_INGEST_DIR` (or `/data`).
- Lexical base validation only (no realpath containment checks). Paths that escape via symlink are allowed if accessible.

**Response (success)**
```json
{
  "base": "/data",
  "path": "/data/projects",
  "dirs": ["repo-a", "repo-b"]
}
```

**Response (error)**
```json
{
  "status": "error",
  "code": "OUTSIDE_BASE" | "NOT_FOUND" | "NOT_DIRECTORY"
}
```

---

### Mongo per-file index (collection `ingest_files`)

**Document shape**
```json
{
  "root": "repo-name",
  "relPath": "src/file.ts",
  "fileHash": "sha256-hex",
  "updatedAt": "2026-01-03T00:00:00.000Z"
}
```

**Indexes**
- Unique: `{ root: 1, relPath: 1 }`
- Non-unique: `{ root: 1 }`

---

### Vector metadata (Chroma)

Each chunk includes:
```json
{
  "root": "repo-name",
  "relPath": "src/file.ts",
  "fileHash": "sha256-hex",
  "runId": "r1",
  "chunkHash": "sha256-hex",
  "embeddedAt": "2026-01-03T00:00:00.000Z",
  "ingestedAtMs": 1735862400000,
  "model": "embed-1",
  "name": "repo-name",
  "description": "optional"
}
```

Notes:
- Deletes for file replacement use Chroma `where` metadata filters over `{ root, relPath, fileHash }`.
- `runId` is used to clean up in-progress vectors on cancel.
- `chunkIndex` is encoded in the vector id (e.g., `${runId}:${relPath}:${chunkIndex}`); `tokenCount` is not persisted in metadata today.

---

## Acceptance Criteria

- Re-ingest supports an incremental/delta mode that:
  - Removes vectors for files that no longer exist in the folder.
  - For files whose content has changed (based on a file hash), performs a file-level replacement: add new vectors first (tagged with `runId` + new hash), then delete older vectors for `{ root, relPath }` where `fileHash` differs.
  - Embeds and ingests files that are new (not previously present for that folder).
  - Leaves vectors for unchanged files untouched.
  - Automatically upgrades legacy roots (ingested before the Mongo per-file index existed): legacy root = no `ingest_files` records for that root; delete all existing vectors for the root and re-ingest, populating the per-file index as part of that run.
- Each embedded chunk has metadata sufficient to attribute it to a specific file:
  - Store `relPath` (POSIX, relative to the ingested root) including filename.
  - Store a file hash (SHA-256) for diffing.
- Deletes for file-level replacement use Chroma metadata filters (the `where` filter) over `{ root, relPath, fileHash }`.
- A per-file index is persisted in **MongoDB** and is the primary source of truth for delta decisions:
  - Collection name: `ingest_files`.
  - It is keyed by `{ root, relPath }` and stores `fileHash` and `updatedAt`.
  - Indexes: unique `{ root, relPath }` and non-unique `{ root }`.
- Delta re-ingest uses this index to detect new/changed/deleted files without scanning all chunk metadata in Chroma.
- Re-ingest remains safe/robust:
  - Cancelling a run cleans up only the in-progress vectors for that run (no partial corruption of existing unchanged vectors).
  - For changed files, new vectors are added first and old vectors are deleted only after successful replacement.
  - Concurrency is controlled (no simultaneous ingest/re-ingest against the same collections beyond existing locking rules).
  - Existing ingest status polling (`GET /ingest/status/:runId`) continues to work unchanged.
- Ingest page UX:
  - The “Embedding model locked to …” notice is shown only once (below “Start a new ingest” title, not duplicated inside the form).
  - The Folder path remains editable as a text field, and there is an additional “Choose folder…” mechanism that updates the field value when used.
    - The “Choose folder…” UX is implemented as a **server-backed directory picker modal** limited to `HOST_INGEST_DIR` (default `/data`), and selecting a folder updates the text field with the server-readable path.
    - The directory picker endpoint lists child directories under the base path and rejects only lexically out-of-base paths; symlink escapes are allowed if the path resolves and is accessible.
    - Endpoint response shape example: `{ "base": "/data", "path": "/data/projects", "dirs": ["repo-a", "repo-b"] }` with errors returning `{ "status": "error", "code": "OUTSIDE_BASE" | "NOT_FOUND" | "NOT_DIRECTORY" }`.
    - The directory picker is backed by a simple server endpoint that lists child directories under the allowed base and rejects paths outside that base; the UI displays directory names and writes the server-readable path into the input.

---

## Out Of Scope

- Changing the ingest status transport from polling to SSE/WebSockets (status remains polling-driven).
- Cross-server coordination (delta assumes a single server process / single Chroma instance per environment).
- Sophisticated “partial file” diffs at the chunk level (v1 can treat a changed file as “delete all chunks for that file, then re-add”).
- Stable chunk IDs / upsert-based updates (we use file-level replacement by deleting `{ root, relPath }` vectors then re-adding).
- Full “native OS folder picker that reveals absolute filesystem paths” in a standard browser environment, if it requires switching to an upload-based ingest model or a desktop wrapper (see Questions).
- A browser-native folder picker that depends on local filesystem selection and implies upload-based ingest or a desktop wrapper (we will use a server-backed directory picker instead).
- Storing the per-file index inside Chroma (we will store it in MongoDB instead).
- Any UI redesign beyond the two specific Ingest page adjustments described above.
- Chunker/config versioning for delta decisions (if needed later, we will force a full re-ingest by clearing the per-file index for a root).
- Embedding model migration during re-ingest (delta re-ingest only runs when the locked model matches).
- Multiple directory picker bases (v1 uses a single base: `HOST_INGEST_DIR` or `/data`).
- Hash shortcuts (mtime/size) for delta decisions; v1 always hashes file bytes.

---

## Decisions

- **Per-file index schema:** collection `ingest_files` with `{ root, relPath, fileHash, updatedAt }`, indexes on `{ root }` and unique `{ root, relPath }`.
- **Chunk metadata:** store `relPath` and `fileHash`; derive host/container paths upstream when needed.
- **Hashing:** SHA-256 of file bytes as read from disk; no mtime/size shortcuts.
- **Delta replacement flow:** add new vectors first (tagged with `runId` + new hash), then delete older vectors for `{ root, relPath }` where `fileHash` differs; cancel leaves old vectors intact.
- **Chunker/config versioning:** defer; if rules change, force full re-ingest by clearing the per-file index for that root.
- **Model lock:** delta re-ingest only when locked model matches; no auto-migration.
- **Directory picker:** server-backed modal scoped to a single base (`HOST_INGEST_DIR` default `/data`).
- **Symlink handling:** symlinked paths that escape the base are allowed if they resolve and are accessible; do not reject based on realpath containment.
- **Performance target:** assume medium/large repos (10k–100k files); per-file index required.
- **Legacy roots:** defined as no `ingest_files` rows for a root; do a full re-ingest and populate the index.

---

## Research Findings (MCP + Web)

- **Current chunk metadata:** `server/src/ingest/types.ts` defines per-chunk metadata fields including `fileHash`, `chunkHash`, `relPath`, `chunkIndex`, and `tokenCount`, so delta work can reuse `relPath`/`fileHash` without inventing new names.
- **Metadata actually stored on add:** `processRun` in `server/src/ingest/ingestJob.ts` builds the metadata objects passed to Chroma. The stored fields include `runId`, `root`, `relPath`, `fileHash`, `chunkHash`, `embeddedAt`, `ingestedAtMs`, `model`, `name`, and optional `description`. `chunkIndex` is encoded in the vector id and `tokenCount` is not stored.
- **Cancel cleanup:** `cancelRun` in `server/src/ingest/ingestJob.ts` deletes vectors with `where: { runId }`, so run-scoped cleanup already exists and is safe to keep for delta.
- **Root-wide deletes:** `reembed` and `removeRoot` in `server/src/ingest/ingestJob.ts` delete vectors/roots by `root`, with low-level delete helpers in `server/src/ingest/chromaClient.ts` (delete vectors/roots, drop empty collections, clear locked model).
- **Delete helper signature:** `deleteVectors` in `server/src/ingest/chromaClient.ts` accepts `where` and/or `ids` and forwards them directly to Chroma’s `collection.delete`, so we can pass metadata filters without extra wrapper changes.
- **Path normalization:** `mapIngestPath` in `server/src/ingest/pathMap.ts` already normalizes host/container paths and extracts `relPath`; reuse it to keep relPath consistent.
- **Chroma delete filters:** In the JS client (`chromadb`), `collection.delete` accepts `where` (metadata) and optional `whereDocument` (document content). The HTTP API/docs often spell this as `where_document`, but the JS client uses `whereDocument`. For this story we only need metadata `where` filters over `{ root, relPath, fileHash, runId }` using operators like `$ne` and logical `$and/$or`.
- **Filter machinery:** Chroma’s core filter implementation treats delete filters consistently with query/get; the same `Where` structures and operators back all three operations.
- **Chroma filter validation:** Chroma’s client and backend parsers enforce a single operator per field and structured `$and/$or` lists; set operators (`$in/$nin`) require consistent value types. Use this schema to avoid invalid where payloads.
- **Chroma reference schema:** The Chroma Cookbook publishes explicit JSON schemas for `where` and `where_document` (aka `whereDocument` in the JS client), including maxProperties=1 per clause and the supported operator sets for metadata vs document filters.
- **MUI modal choice:** MUI `Dialog` (built on `Modal`) provides `open` and `onClose` and is appropriate for a simple directory picker modal.
- **MUI 6.5.0:** repo uses `@mui/material` 6.5.0; the 6.5.0 release notes (https://github.com/mui/material-ui/releases/tag/v6.5.0) do not indicate any Dialog API changes relevant to this story (the release mainly includes a Dialog codemod entry), so using MUI MCP 6.4.12 docs for Dialog is acceptable.
- **Directory picker endpoint (codebase):** there is no existing route or helper that lists directories under `HOST_INGEST_DIR`; current ingest routes only validate required fields and `GET /ingest/roots` lists stored ingest metadata (not live filesystem contents). Existing path validation helpers live in `server/src/ingest/pathMap.ts` and agents’ working-folder resolver.
- **Symlink/realpath behavior (codebase):** current path helpers and discovery logic normalize paths and rely on prefix checks without calling `realpath`, so they do not guard against symlink escapes; this aligns with the decision to allow symlinked paths that resolve outside the base.
- **Directory picker endpoint (recommended behavior):** Node’s `fs.promises.readdir` supports `withFileTypes: true` (Dirent results), and `path.resolve` can be used to build a lexical base check; pair these for lightweight directory listing without realpath containment. Do not reject paths that escape via symlinks, per the symlink allowance decision; only reject paths that are outside the base by lexical resolution or are unreadable.

- **Dependency versions (verified from package-lock.json):** this repo currently resolves to React `19.2.0`, Express `5.1.0`, and MUI `6.5.0` (plus `chromadb` `3.1.6`, `mongoose` `9.0.1`, `testcontainers` `10.10.2`, `zod` `3.25.76`). Ensure doc references match these versions where possible.

---

## Questions

None (resolved; details folded into Description / Acceptance Criteria / Out Of Scope).

---

# Tasks

### 1. MongoDB per-file index schema (`ingest_files`)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Introduce a MongoDB collection (`ingest_files`) that stores a lightweight per-file hash index keyed by `{ root, relPath }`. This index is the upstream source of truth that enables delta decisions without scanning chunk metadata in Chroma.

#### Documentation Locations

- Mongoose v9 schema + indexes: Context7 `/automattic/mongoose/9.0.1`
- MongoDB index concepts (unique compound index): https://www.mongodb.com/docs/manual/indexes/
- Node.js test runner (server uses node:test for unit/integration tests): https://nodejs.org/api/test.html
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Read existing Mongoose model patterns so the new model matches repo conventions:
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1`
   - Files to read:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/turn.ts`

2. [ ] Create the `ingest_files` model with the required document shape:
   - Files to add:
     - `server/src/mongo/ingestFile.ts`
   - Requirements:
     - Export a TS `IngestFile` interface with fields:
       - `root: string`
       - `relPath: string`
       - `fileHash: string`
       - `updatedAt: Date`
     - Use Mongoose `timestamps: true` so `updatedAt` is maintained automatically (and is available for debugging).
     - Use a stable model name (e.g. `IngestFile`) and follow the existing `models.<Name> || model(...)` pattern.

3. [ ] Add the required indexes:
   - Files to edit:
     - `server/src/mongo/ingestFile.ts`
   - Requirements:
     - Unique compound index: `{ root: 1, relPath: 1 }`.
     - Non-unique index: `{ root: 1 }`.
     - Do not add extra indexes in v1.

4. [ ] Add a unit test proving the schema shape + indexes exist (no real Mongo connection):
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/unit/ingest-files-schema.test.ts`
   - Requirements:
     - Assert `IngestFileModel.schema.indexes()` includes:
       - one unique index on `root + relPath`
       - one non-unique index on `root`
     - Assert required fields are present on the schema.

5. [ ] Update project structure docs if a new file was introduced:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file path under the `server/src/mongo/` section.

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix failures with repo scripts.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test:unit --workspace server`

#### Implementation notes

- 

---

### 2. MongoDB per-file index repository helpers (safe when Mongo is unavailable)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add focused repository helper functions for reading/upserting/deleting `ingest_files` rows. These helpers must avoid Mongoose buffering/timeouts when Mongo is unavailable (tests and degraded runtime), so ingest can safely fall back to non-delta behavior.

#### Documentation Locations

- Mongoose v9 bulkWrite + updateOne upserts: Context7 `/automattic/mongoose/9.0.1`
- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Read the existing Mongo repo patterns and the “Mongo unavailable” guard used elsewhere:
   - Files to read:
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/connection.ts`
   - Notes:
     - There is an existing convention of bailing out early when `mongoose.connection.readyState !== 1`.

2. [ ] Add repository helper functions for `ingest_files`:
   - Reuse existing repo module (do not introduce a new “repo file” pattern):
     - The codebase centralizes Mongo helpers in `server/src/mongo/repo.ts`.
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Requirements:
     - All helpers must return `null` (or a clearly typed `{ ok:false }`) when `mongoose.connection.readyState !== 1`.
     - Implement:
       - `listIngestFilesByRoot(root: string)` → returns `Array<{ relPath: string; fileHash: string }>`
       - `upsertIngestFiles(params: { root: string; files: Array<{ relPath: string; fileHash: string }> })` → bulk upsert
       - `deleteIngestFilesByRelPaths(params: { root: string; relPaths: string[] })` → deleteMany
       - `clearIngestFilesByRoot(root: string)` → deleteMany (used for legacy upgrade/full rebuilds)
     - KISS: do not add “clever” partial updates (no mtime/size shortcuts; no chunk-level indexing).

3. [ ] Add unit tests proving the helpers are “safe” when Mongo is disconnected:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Requirements:
     - Override `mongoose.connection.readyState` to `0` and assert each helper returns `null` quickly.
     - The test must not attempt a real Mongo connection.

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix failures with repo scripts.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run test:unit --workspace server`

#### Implementation notes

- 

---

### 3. Delta decision engine (pure planning of new/changed/deleted files)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Create a pure “delta planner” that compares the discovered on-disk file list (with hashes) to the previous `ingest_files` index and produces a deterministic plan: which files are `new`, `changed`, `unchanged`, and `deleted`. This module is intentionally DB/Chroma-free so it can be unit-tested easily.

#### Documentation Locations

- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Create the delta planner module:
   - Files to add:
     - `server/src/ingest/deltaPlan.ts`
   - Requirements:
     - Export minimal types:
       - `IndexedFile = { relPath: string; fileHash: string }`
       - `DiscoveredFileHash = { absPath: string; relPath: string; fileHash: string }`
     - Export a single function:
       - `buildDeltaPlan(params: { previous: IndexedFile[]; discovered: DiscoveredFileHash[] })`
     - The return value must contain:
       - `unchanged: IndexedFile[]`
       - `changed: DiscoveredFileHash[]`
       - `added: DiscoveredFileHash[]`
       - `deleted: IndexedFile[]`
     - Determinism:
       - Always sort results by `relPath` ascending so progress/logging is stable.
     - KISS: do not incorporate “legacy root detection” here (that is decided by whether Mongo has any rows for the root).

2. [ ] Add unit tests covering common scenarios:
   - Files to add:
     - `server/src/test/unit/ingest-delta-plan.test.ts`
   - Required test cases:
     - “No previous, discovered has 2 files” → all are `added`.
     - “Previous has 2, discovered matches hashes” → all are `unchanged`.
     - “Previous has 2, discovered changes one hash” → 1 `changed`, 1 `unchanged`.
     - “Previous has 2, discovered missing one relPath” → 1 `deleted`.
     - “Mixed add + change + delete” in one run.

3. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix failures with repo scripts.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run test:unit --workspace server`

#### Implementation notes

- 

---

### 4. Server delta re-embed (file-level replacement) + legacy upgrade

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement delta re-ingest for `POST /ingest/reembed/:root` using the Mongo `ingest_files` index and file SHA-256 hashes. The server must only re-embed changed/new files, delete vectors for deleted files, and replace vectors for changed files by adding new vectors first and deleting old vectors afterwards.

#### Documentation Locations

- Chroma delete filters (`where` schema, `$and/$or`, `$ne`, `$in` constraints): https://docs.trychroma.com/ and https://cookbook.chromadb.dev/
- Mongoose v9 (connecting, guarding `readyState`, and simple query patterns): Context7 `/automattic/mongoose/9.0.1`
- Node fs/promises (readFile, readdir) and crypto hashing: https://nodejs.org/api/fs.html and https://nodejs.org/api/crypto.html
- Testcontainers Node (GenericContainer lifecycle, wait strategies): Context7 `/testcontainers/testcontainers-node`
- Cucumber guides (new feature + step definitions): https://cucumber.io/docs/guides/
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Read the current ingest flow so delta changes are applied upstream (not bolted on downstream):
   - Files to read:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ingest/discovery.ts`
     - `server/src/ingest/hashing.ts`
     - `server/src/ingest/chromaClient.ts`
     - `server/src/routes/ingestReembed.ts`

2. [ ] Update `reembed()` so it no longer performs a root-wide delete before starting:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - `reembed(rootPath)` must still validate the root exists in the roots collection (as today).
     - It must start the ingest run with `operation: 'reembed'` and allow `processRun()` to decide full vs delta.
     - Do not delete vectors up front.
     - Root metadata deduplication must still be preserved so `/ingest/roots` does not accumulate duplicates:
       - The roots list endpoint does not dedupe entries; the UI table rows are keyed by `root.path`, so duplicates cause unstable rendering.
       - Implement dedupe at write time (see below): delete existing root metadata entries for `{ root }` immediately before writing the new run’s root metadata entry.

3. [ ] Remove the current re-embed early-return so delta can process deletions even when discovery returns zero eligible files:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Today, `processRun` returns early for re-embed when `files.length === 0`.
     - Delta re-embed must still be able to detect that *previously ingested* files were deleted (including "all files deleted"), so it must still load the `ingest_files` index and compute deletions.

4. [ ] Load the previous per-file index and compute hashes for the newly discovered files:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Load the previous per-file index from Mongo (`ingest_files`) for the discovered `root`.
     - Hash all discovered files using SHA-256 of file bytes.
     - Ensure relPath normalization is consistent with existing ingest/discovery.

5. [ ] Compute the delta plan and decide the "work to perform" set:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Use `buildDeltaPlan(...)` to compute `added/changed/unchanged/deleted`.
     - Ensure determinism (stable ordering of work by `relPath`).

6. [ ] Implement the no-op ("nothing changed") behavior for delta re-embed:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - If `added.length + changed.length + deleted.length === 0`:
       - Do not write to Chroma.
       - Mark the run as `skipped` with a clear `message`.

7. [ ] Implement deletions-only delta runs (no new embeddings required):
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - If `deleted.length > 0` and `added.length + changed.length === 0`:
       - Perform the required deletes in Chroma for `{ root, relPath }`.
       - The run must not claim "No changes detected". Use a terminal message that indicates work occurred.
       - State may remain `skipped` if no embeddings were required.

8. [ ] Embed only the `added + changed` files (unchanged files are not re-embedded):
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - For each changed/added file:
       - Chunk and embed as usual.
       - Store vector metadata including `root`, `relPath`, `fileHash`, `chunkHash`, and `runId`.
     - Do not touch vectors for `unchanged` files.

9. [ ] After new vectors are successfully written, apply post-write deletes for changed/deleted files:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - For each changed file:
       - Delete older vectors for `{ root, relPath }` where `fileHash != newHash` (use a Chroma `where: { $and: [...] }` structure).
     - For each deleted file:
       - Delete vectors for `{ root, relPath }`.

10. [ ] Ensure root metadata is updated and deduped on run completion (prevents duplicate rows in `/ingest/roots`):
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Immediately before writing a run’s root metadata entry (the `roots.add(...)` call in the success/terminal flow), delete existing root metadata entries for the same `{ root }` using the existing helper `deleteRoots({ where: { root } })`.
     - This applies for successful `start` and `reembed` runs.
     - This must not delete vectors; it only keeps the roots listing stable.

11. [ ] Ensure the per-file index is written/maintained for both initial ingest and re-embed:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/mongo/repo.ts`
   - Requirements:
     - Initial ingest (`operation === 'start'`): after a successful run, write `ingest_files` rows for all discovered files and their `fileHash` values.
       - KISS approach: clear existing rows for the root and insert/upsert all discovered file hashes (start ingest is already a "full rebuild" operation).
     - Re-embed (`operation === 'reembed'`): after a successful run, update the index using the delta plan:
       - Upsert rows for `added + changed`.
       - Delete rows for `deleted`.
       - Do not rewrite rows for `unchanged`.
     - Do not update the Mongo per-file index on cancellation or error.

12. [ ] Implement "legacy root upgrade" behavior:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/mongo/repo.ts`
   - Requirements:
     - Legacy root definition: there are **zero** `ingest_files` rows for the root.
     - When legacy is detected on a re-embed:
       - Delete all vectors for `{ root }`.
       - Delete all root metadata entries for `{ root }`.
       - Perform a full ingest of all discovered files (same behavior as current re-embed today).
       - Populate `ingest_files` for all files as part of the successful run.

13. [ ] Ensure run cancellation remains safe and does not corrupt older vectors:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Cancel must delete only `{ runId }` vectors (existing behavior) and must not delete vectors for unchanged files.
     - Do not update `ingest_files` until the run is in a successful terminal state (completed or skipped).

14. [ ] Add Mongo Testcontainers support for Cucumber delta scenarios (hook + cucumber registration):
   - Files to add:
     - `server/src/test/support/mongoContainer.ts`
   - Files to edit:
     - `server/cucumber.js`
   - Requirements:
     - In `server/src/test/support/mongoContainer.ts`, use a `@mongo` tag and a `Before({ tags: '@mongo' }, ...)` hook to start a Mongo Testcontainers instance only for these scenarios.
     - Update `server/cucumber.js` to require `src/test/support/mongoContainer.ts` (alongside `chromaContainer.ts`) so the hooks are registered.
     - Important: this repo does **not** currently include `@testcontainers/mongodb`, so do not use `MongoDBContainer`.
       - Use `GenericContainer('mongo:8')` from the existing `testcontainers` dependency.
       - Configure it explicitly for reliability:
         - `.withExposedPorts(27017)`
         - `.withWaitStrategy(Wait.forLogMessage('Waiting for connections'))`
         - `.withStartupTimeout(120_000)`
       - Construct a connection string like:
         - `mongodb://<host>:<mappedPort>/db?directConnection=true`
       - Set `process.env.MONGO_URI` to the container URI and call `connectMongo(process.env.MONGO_URI)` during the hook.
       - Ensure `disconnectMongo()` and container stop happen in an `After`/`AfterAll` hook for tagged scenarios.

15. [ ] Add the Cucumber feature file describing delta semantics:
   - Files to add:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - The feature must prove:
       - "Changed file" → vectors for old hash are deleted, vectors for new hash exist.
       - "Deleted file" → vectors for the deleted relPath are removed.
       - "Unchanged file" → vectors remain untouched.
       - The `ingest_files` index matches the post-run truth:
         - changed file hash updated
         - deleted file row removed
         - unchanged file row remains unchanged
       - "All files deleted" case is handled:
         - discovery returns 0 eligible files
         - vectors for previously indexed files are deleted
         - `ingest_files` rows for the root are removed
         - run ends in a terminal state and status polling completes

16. [ ] Implement the step definitions for the delta feature:
   - Files to add:
     - `server/src/test/steps/ingest-delta-reembed.steps.ts`
   - Requirements:
     - The step definitions must query Chroma metadata (via `getVectorsCollection().get({ where, include: ['metadatas'] })`) to assert the fileHash conditions.
     - The step definitions must query Mongo (`ingest_files`) to assert the per-file index rows are correct.
     - The test must not rely on manual inspection.

17. [ ] Update docs to reflect delta re-embed behavior and the new Mongo collection:
   - Files to edit:
     - `design.md`
     - `projectStructure.md`
   - Requirements:
     - `design.md`: describe delta vs legacy re-embed behavior and the safety guarantee (add new vectors first, delete old after).
     - `projectStructure.md`: list any new files added under `server/src/ingest/` and `server/src/mongo/` and `server/src/test/`.

18. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix failures with repo scripts.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run test --workspace server`

#### Implementation notes

- 

---

### 5. Server directory picker endpoint (`GET /ingest/dirs`)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add a small server endpoint that lists child directories under a single allowed base (`HOST_INGEST_DIR` default `/data`). This powers the “Choose folder…” UI without requiring browser filesystem access or switching ingest to an upload-based model.

#### Documentation Locations

- Express 5.1.0 routing (new endpoint; async handler + promise semantics): Context7 `/expressjs/express/v5.1.0` and https://expressjs.com/en/guide/routing.html
- Node fs/promises readdir (Dirent + withFileTypes): https://nodejs.org/api/fs.html#fspromisesreaddirpath-options
- Node path resolution + normalization: https://nodejs.org/api/path.html
- SuperTest (route testing patterns used by server): Context7 `/ladjs/supertest`
- Node.js test runner (node:test): https://nodejs.org/api/test.html
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Read existing ingest route patterns for consistent error handling and mount style:
   - Files to read:
     - `server/src/routes/ingestStart.ts`
     - `server/src/routes/ingestRoots.ts`
     - `server/src/index.ts`
     - `server/src/ingest/pathMap.ts`
     - `server/src/test/unit/pathMap.test.ts`

2. [ ] Implement the directory listing route:
   - Files to add:
     - `server/src/routes/ingestDirs.ts`
   - Requirements:
     - Route: `GET /ingest/dirs?path=<absolute server path>`.
     - Base path:
       - `base = process.env.HOST_INGEST_DIR || '/data'`.
       - If query `path` is omitted, list the base.
       - If query `path` is present but empty/whitespace (or not a string), treat it as omitted and list the base (do not introduce new error codes).
     - Validation:
       - Reuse the existing lexical containment logic in `server/src/ingest/pathMap.ts`:
         - Use `mapHostWorkingFolderToWorkdir({ hostIngestDir: base, codexWorkdir: '/', hostWorkingFolder: path })` to validate `path` is lexically inside `base`.
         - Do not call `realpath` (symlink escapes allowed).
         - Map any `INVALID_ABSOLUTE_PATH` / `OUTSIDE_HOST_INGEST_DIR` errors to the endpoint’s `OUTSIDE_BASE` error code to preserve the story contract.
       - Reject lexically out-of-base requests with `400` and `{ status:'error', code:'OUTSIDE_BASE' }`.
       - If `path` doesn’t exist: `404` and `{ status:'error', code:'NOT_FOUND' }`.
       - If `path` exists but is not a directory: `400` and `{ status:'error', code:'NOT_DIRECTORY' }`.
       - Success response:
         - `{ base, path, dirs: string[] }` where `dirs` are immediate child directory names (not full paths), sorted ascending.

3. [ ] Mount the router in the server:
   - Files to edit:
     - `server/src/index.ts`
   - Requirements:
     - Mount the router at `/` like other ingest routes.

4. [ ] Add server unit tests for the endpoint:
   - Files to add:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - Create a temp directory tree.
     - Set `process.env.HOST_INGEST_DIR` to the temp base for the test.
     - Assert:
       - default request (no path) lists child directories.
       - `OUTSIDE_BASE` for `path` outside the base.
       - `NOT_FOUND` for missing path.
       - `NOT_DIRECTORY` when `path` points at a file.

5. [ ] Update docs if files were added:
   - Files to edit:
     - `design.md`
     - `projectStructure.md`
   - Requirements:
     - Add the endpoint contract to `design.md` (request + responses).
     - Update `projectStructure.md` with new router/test file paths.

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix failures with repo scripts.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run test:unit --workspace server`

#### Implementation notes

- 

---

### 6. Client ingest status: handle `skipped` as a terminal state

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Ensure the client correctly treats the server’s ingest status state `skipped` as a terminal state so polling stops, the UI re-enables, and roots/models refresh behavior matches `completed`. This is required for delta re-embed no-op runs and for existing re-embed “skipped” behavior.

#### Documentation Locations

- React hooks patterns (polling + cleanup): https://react.dev/reference/react/useEffect
- Fetch API + URL building: https://developer.mozilla.org/en-US/docs/Web/API/URL
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Confirm current mismatch between server and client ingest states:
   - Files to read:
     - `server/src/ingest/types.ts` (server includes `skipped`)
     - `client/src/hooks/useIngestStatus.ts` (client terminalStates does not include `skipped`)
     - `client/src/pages/IngestPage.tsx` (run-active and refresh logic)

2. [ ] Update the ingest status types and polling logic to treat `skipped` as terminal:
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Requirements:
     - Add `'skipped'` to the `IngestState` union.
     - Add `'skipped'` to `terminalStates` so the hook stops polling.

3. [ ] Update IngestPage terminal/run-active logic to treat `skipped` as terminal:
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Include `skipped` in the “run finished” checks so the UI:
       - re-enables form/table actions
       - triggers `refetchRoots()` and `refresh()` when a run ends as `skipped`

4. [ ] Add client tests proving polling stops on `skipped`:
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
   - Requirements:
     - Add a test similar to “polls until completed then stops”, but with the terminal response returning `state: 'skipped'`.
     - Assert:
       - polling stops after the `skipped` response
       - the UI renders a `skipped` status label

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix failures with repo scripts.

#### Testing

1. [ ] `npm run build --workspace client`

2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 7. Ingest UI: remove duplicate “model locked” notice

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Reduce UI noise by showing the locked embedding model notice only once on the Ingest page (not duplicated inside the form). This is a pure UI change and should not alter ingest behavior.

#### Documentation Locations

- MUI Alert component docs:
  - MUI MCP `@mui/material@6.4.12` (closest available in MCP; repo resolves to MUI `6.5.0`)
  - MUI site API reference (verify props for current 6.x): https://mui.com/material-ui/api/alert/
- React testing patterns (repo uses Testing Library): https://testing-library.com/docs/react-testing-library/intro/
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Confirm the duplication exists today and identify the two render locations:
   - Files to read:
     - `client/src/pages/IngestPage.tsx`
     - `client/src/components/ingest/IngestForm.tsx`

2. [ ] Remove the in-form locked notice:
   - Files to edit:
     - `client/src/components/ingest/IngestForm.tsx`
   - Requirements:
     - Remove the `Alert` that renders “Embedding model locked to …” inside the form.
     - Keep the existing behavior that disables the model select when `lockedModelId` exists.

3. [ ] Ensure the page-level notice is shown in the correct location:
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Render exactly one notice “Embedding model locked to <id>”.
     - Place it directly below the “Start a new ingest” title (not duplicated elsewhere).

4. [ ] Update client tests:
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Update/remove assertions that expect the lock banner to be inside `IngestForm`.
     - Keep (or add) an assertion that the Embedding model select is disabled when `lockedModelId` is provided.

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix failures with repo scripts.

#### Testing

1. [ ] `npm run build --workspace client`

2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 8. Ingest UI: server-backed directory picker modal (“Choose folder…”)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add a “Choose folder…” affordance to the Folder path field that opens a server-backed directory picker modal. The modal browses directories under the allowed server base (`HOST_INGEST_DIR` default `/data`) and writes the selected absolute server path into the existing editable text field.

#### Documentation Locations

- MUI Dialog docs:
  - MUI MCP `@mui/material@6.4.12` (closest available in MCP; repo resolves to MUI `6.5.0`)
  - MUI site API reference (verify props for current 6.x): https://mui.com/material-ui/api/dialog/
- Fetch API (query string building): https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Read the existing ingest form state management and serverBase usage:
   - Files to read:
     - `client/src/components/ingest/IngestForm.tsx`

2. [ ] Add a small, typed fetch helper for `GET /ingest/dirs` (keeps the dialog component simple):
   - Files to add:
     - `client/src/components/ingest/ingestDirsApi.ts`
   - Requirements:
     - Export minimal types matching the server contract:
       - success: `{ base: string; path: string; dirs: string[] }`
       - error: `{ status: 'error'; code: 'OUTSIDE_BASE' | 'NOT_FOUND' | 'NOT_DIRECTORY' }`
     - Export a single function like `fetchIngestDirs(params: { path?: string }): Promise<...>`.

3. [ ] Add a small directory picker dialog component (UI shell + loading/error states):
   - Files to add:
     - `client/src/components/ingest/DirectoryPickerDialog.tsx`
   - Requirements:
     - Props:
       - `open: boolean`
       - `path?: string` (current path to browse; optional)
       - `onClose(): void`
       - `onPick(path: string): void`
     - UI:
       - Use MUI `Dialog` with title and actions.
       - Show current `path` and a list region.
       - Render loading and error states.
     - Data loading:
       - Call the helper from `ingestDirsApi.ts`.

4. [ ] Implement directory navigation within the dialog:
   - Files to edit:
     - `client/src/components/ingest/DirectoryPickerDialog.tsx`
   - Requirements:
     - Allow navigation into a directory by clicking it.
     - Provide an "Up" action unless already at `base`.
     - Provide a "Use this folder" action for the currently viewed folder.

5. [ ] Wire the dialog into the Folder path input:
   - Files to edit:
     - `client/src/components/ingest/IngestForm.tsx`
   - Requirements:
     - Add a "Choose folder…" button next to the Folder path field.
     - When a folder is picked, update the text field value to the chosen absolute server path.
     - The Folder path text field must remain editable even if the picker is available.
     - Do not use browser filesystem APIs (no native directory pickers).

6. [ ] Add client tests for the directory picker component:
   - Files to add:
     - `client/src/test/directoryPickerDialog.test.tsx`
   - Requirements:
     - Mock `fetch` for `GET /ingest/dirs` success and error payloads.
     - Assert:
       - loading state appears then renders directory list
       - clicking a directory triggers navigation (subsequent fetch with updated path)
       - "Use this folder" calls `onPick` with the current path
       - error payloads render a clear message

7. [ ] Add/extend ingest form tests proving the picker updates the Folder path field:
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Mock `fetch` for `GET /ingest/dirs`.
     - Open the dialog, choose a directory, and assert the Folder path input value changes.
     - Include an error-path test (server returns `{ status:'error', code:'OUTSIDE_BASE' }`) and assert the dialog shows an error message.

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix failures with repo scripts.

#### Testing

1. [ ] `npm run build --workspace client`

2. [ ] `npm run test --workspace client`

#### Implementation notes

- 

---

### 9. Final verification (acceptance criteria, clean builds, docs, and PR summary)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Perform end-to-end verification for the story: delta re-embed behavior, directory picker endpoint + UI, and documentation accuracy. This task ensures the story’s acceptance criteria are met and produces a PR-ready summary.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Re-check the story Acceptance Criteria section and confirm each bullet is demonstrably satisfied (no "it should" assumptions).

2. [ ] Manual verification checklist (before running full automation):
   - Requirements:
     - Trigger a delta re-embed where nothing changed and confirm:
       - server returns a terminal `skipped` state with a clear message
       - the client stops polling and re-enables actions
     - Trigger a delta re-embed where at least one file is deleted and confirm:
       - the run does not claim "No changes detected"
       - deleted file vectors disappear from Chroma and `ingest_files` rows are removed
     - Open the directory picker and confirm it:
       - lists directories under the allowed base
       - updates the Folder path field when "Use this folder" is chosen

3. [ ] Build the server outside Docker:
   - Command:
     - `npm run build --workspace server`

4. [ ] Build the client outside Docker:
   - Command:
     - `npm run build --workspace client`

5. [ ] Run server tests (unit + integration + cucumber):
   - Command:
     - `npm run test --workspace server`

6. [ ] Run client Jest tests:
   - Command:
     - `npm run test --workspace client`

7. [ ] Perform a clean Docker build and restart Compose:
   - Commands:
     - `npm run compose:build:clean`
     - `npm run compose:up`

8. [ ] Run e2e tests:
   - Command:
     - `npm run e2e`

9. [ ] Manual Playwright-MCP smoke check and screenshots (save to `./test-results/screenshots/`):
   - Required screenshots:
     - `0000020-9-ingest-page.png` (Ingest page shows single lock notice + Choose folder button)
     - `0000020-9-ingest-picker.png` (Directory picker dialog open)
     - `0000020-9-ingest-delta.png` (Roots table reflects a completed re-embed run)

10. [ ] Documentation updates (must be accurate and complete):
   - Files to edit:
     - `README.md`
     - `design.md`
     - `projectStructure.md`
   - Requirements:
     - Document `/ingest/dirs`.
     - Document the `ingest_files` collection and how it affects delta re-embed.
     - Ensure `projectStructure.md` includes any new files added in this story.

11. [ ] Create a PR summary comment that covers all changes (server + client + tests) and references any new commands/behaviors.

12. [ ] Bring Compose down:
   - Command:
     - `npm run compose:down`


#### Testing

1. [ ] `npm run lint --workspaces`

2. [ ] `npm run format:check --workspaces`

#### Implementation notes

- 
