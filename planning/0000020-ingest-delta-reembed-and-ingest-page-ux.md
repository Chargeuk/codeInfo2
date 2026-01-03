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
- Markdown syntax (used when updating docs): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Read existing Mongoose model patterns so the new model matches repo conventions:
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1`
   - Files to read:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/turn.ts`

2. [ ] Create the `ingest_files` model with the required document shape:
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1` (Schemas, models, timestamps)
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
   - Copy/paste starter snippet (adapt names to match repo conventions):
     ```ts
     import mongoose, { Schema } from 'mongoose';

     export type IngestFile = {
       root: string;
       relPath: string;
       fileHash: string;
       updatedAt: Date;
     };

     const ingestFileSchema = new Schema<IngestFile>(
       {
         root: { type: String, required: true },
         relPath: { type: String, required: true },
         fileHash: { type: String, required: true },
       },
       { timestamps: true },
     );
     ```

3. [ ] Add the required indexes:
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1` (Schema#index)
     - https://www.mongodb.com/docs/manual/indexes/
   - Files to edit:
     - `server/src/mongo/ingestFile.ts`
   - Requirements:
     - Unique compound index: `{ root: 1, relPath: 1 }`.
     - Non-unique index: `{ root: 1 }`.
     - Do not add extra indexes in v1.
   - Copy/paste starter snippet:
     ```ts
     ingestFileSchema.index({ root: 1, relPath: 1 }, { unique: true });
     ingestFileSchema.index({ root: 1 });
     ```

4. [ ] Create the server unit test suite for the `ingest_files` Mongoose schema:
   - Test type: Server unit (node:test)
   - Purpose: prevent accidental schema/index regressions that would break delta re-embed.
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/automattic/mongoose/9.0.1` (Schema#indexes)
   - Files to add:
     - `server/src/test/unit/ingest-files-schema.test.ts`
   - Requirements:
     - The test must not attempt a real Mongo connection.

5. [ ] Unit test: required fields exist on the schema (`root`, `relPath`, `fileHash`):
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-files-schema.test.ts`
   - Purpose: ensure the minimal per-file index document shape stays stable.
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/automattic/mongoose/9.0.1` (Schema paths)
   - Files to edit:
     - `server/src/test/unit/ingest-files-schema.test.ts`
   - Requirements:
     - Assert the three schema paths exist and are marked required.

6. [ ] Unit test: unique compound index exists on `{ root: 1, relPath: 1 }`:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-files-schema.test.ts`
   - Purpose: ensure Mongo can safely treat `{ root, relPath }` as a key.
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/automattic/mongoose/9.0.1` (Schema#indexes)
   - Files to edit:
     - `server/src/test/unit/ingest-files-schema.test.ts`
   - Requirements:
     - Assert `IngestFileModel.schema.indexes()` includes exactly one unique index with keys `{ root: 1, relPath: 1 }`.

7. [ ] Unit test: non-unique index exists on `{ root: 1 }`:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-files-schema.test.ts`
   - Purpose: ensure lookups by `root` stay efficient.
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/automattic/mongoose/9.0.1` (Schema#indexes)
   - Files to edit:
     - `server/src/test/unit/ingest-files-schema.test.ts`
   - Requirements:
     - Assert `IngestFileModel.schema.indexes()` includes one non-unique index with keys `{ root: 1 }`.

8. [ ] Update `projectStructure.md` with the files added in this task:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file paths:
       - `server/src/mongo/ingestFile.ts`
       - `server/src/test/unit/ingest-files-schema.test.ts`

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (basic regression smoke):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks:
     - Load `http://localhost:5001/chat` and confirm the page renders without console errors.
     - Load `http://localhost:5001/ingest` and confirm the page renders (roots table loads or shows a sensible empty state).

9. [ ] `npm run compose:down`

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
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1` (Connections, buffering, `readyState`)
   - Files to read:
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/connection.ts`
   - Notes:
     - There is an existing convention of bailing out early when `mongoose.connection.readyState !== 1`.

2. [ ] Add repository helper functions for `ingest_files`:
   - Docs to read:
     - Context7 `/automattic/mongoose/9.0.1` (bulkWrite, updateOne upsert, deleteMany)
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
   - Copy/paste guard snippet (apply to each helper):
     ```ts
     import mongoose from 'mongoose';

     if (mongoose.connection.readyState !== 1) {
       return null;
     }
     ```
   - Copy/paste bulk upsert snippet (adapt to actual model name/imports):
     ```ts
     await IngestFileModel.bulkWrite(
       files.map((f) => ({
         updateOne: {
           filter: { root, relPath: f.relPath },
           update: { $set: { fileHash: f.fileHash } },
           upsert: true,
         },
       })),
       { ordered: false },
     );
     ```

3. [ ] Create the server unit test suite for the `ingest_files` repo guard behavior:
   - Test type: Server unit (node:test)
   - Purpose: ensure ingest can run in degraded mode without Mongoose buffering/hanging when Mongo is down.
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/automattic/mongoose/9.0.1` (Connection state)
   - Files to add:
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Requirements:
     - The test must not attempt a real Mongo connection.
     - Override `mongoose.connection.readyState` to `0`.
     - Include a helper to restore the original descriptor in a cleanup/finally.
   - Copy/paste testing hint:
     ```ts
     // In node:test you can use Object.defineProperty to temporarily override getters.
     // Make sure you restore the original descriptor in a cleanup/finally.
     ```

4. [ ] Unit test: `listIngestFilesByRoot(root)` returns `null` quickly when Mongo is disconnected:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Purpose: ensure delta logic can detect degraded-mode and fall back safely.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Requirements:
     - With `mongoose.connection.readyState = 0`, assert the helper returns `null` without contacting Mongo.

5. [ ] Unit test: `upsertIngestFiles(...)` returns `null` quickly when Mongo is disconnected:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Purpose: ensure ingest does not hang on write attempts when Mongo is down.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Requirements:
     - With `mongoose.connection.readyState = 0`, assert the helper returns `null`.

6. [ ] Unit test: `deleteIngestFilesByRelPaths(...)` returns `null` quickly when Mongo is disconnected:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Purpose: ensure delta runs that need deletions don’t block when Mongo is down.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Requirements:
     - With `mongoose.connection.readyState = 0`, assert the helper returns `null`.

7. [ ] Unit test: `clearIngestFilesByRoot(root)` returns `null` quickly when Mongo is disconnected:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Purpose: ensure legacy-upgrade/full-rebuild helpers don’t block in degraded mode.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Requirements:
     - With `mongoose.connection.readyState = 0`, assert the helper returns `null`.

8. [ ] Update `projectStructure.md` to include the new unit test file:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file path (`server/src/test/unit/ingest-files-repo-guards.test.ts`) under the server unit test section.

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (Mongo degraded-mode regression):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks:
     - Load `http://localhost:5001/chat` and confirm chat history renders even if Mongo is unavailable (banner behavior is acceptable).
     - Load `http://localhost:5001/ingest` and confirm the page renders without hard failures.

9. [ ] `npm run compose:down`

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
   - Docs to read:
     - https://nodejs.org/api/test.html (for how we’ll test this)
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
   - Copy/paste implementation outline (no Chroma/Mongo access here):
     ```ts
     // 1) Index previous by relPath
     // 2) Walk discovered:
     //    - if missing in previous => added
     //    - if hash differs => changed
     //    - else => unchanged
     // 3) Walk previous:
     //    - if missing in discovered => deleted
     // 4) Sort each array by relPath
     ```

2. [ ] Create the server unit test suite for `buildDeltaPlan(...)`:
   - Test type: Server unit (node:test)
   - Purpose: validate delta categorization logic without relying on Mongo/Chroma.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/unit/ingest-delta-plan.test.ts`

3. [ ] Unit test: “No previous, discovered has 2 files” → all are `added`:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-delta-plan.test.ts`
   - Purpose: ensure first-time delta planning behaves like a full ingest.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-delta-plan.test.ts`
   - Requirements:
     - Assert `added.length === 2` and the other arrays are empty.

4. [ ] Unit test: “Previous has 2, discovered matches hashes” → all are `unchanged`:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-delta-plan.test.ts`
   - Purpose: ensure true no-op runs are detected.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-delta-plan.test.ts`
   - Requirements:
     - Assert `unchanged.length === 2` and the other arrays are empty.

5. [ ] Unit test: “Previous has 2, discovered changes one hash” → 1 `changed`, 1 `unchanged`:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-delta-plan.test.ts`
   - Purpose: ensure a single-file edit triggers a single-file re-embed.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-delta-plan.test.ts`
   - Requirements:
     - Assert the changed item is the correct `relPath`.

6. [ ] Unit test: “Previous has 2, discovered missing one relPath” → 1 `deleted`:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-delta-plan.test.ts`
   - Purpose: ensure deletions are detected even if discovery returns fewer files.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-delta-plan.test.ts`
   - Requirements:
     - Assert `deleted.length === 1` and the deleted item is the correct `relPath`.

7. [ ] Unit test: “Mixed add + change + delete” in one run:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-delta-plan.test.ts`
   - Purpose: ensure categorization stays correct when multiple kinds of work happen together.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-delta-plan.test.ts`
   - Requirements:
     - Include at least one file in each of `added`, `changed`, and `deleted`.

8. [ ] Update `projectStructure.md` to include the new delta planner files:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file paths:
       - `server/src/ingest/deltaPlan.ts`
       - `server/src/test/unit/ingest-delta-plan.test.ts`

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (delta plan regression):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks:
     - Load `http://localhost:5001/ingest` and confirm it renders (this task is server-only, but this ensures nothing broke the page).

9. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 4. Server delta re-embed (file-level replacement) + legacy upgrade

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement delta re-ingest for `POST /ingest/reembed/:root` using the Mongo `ingest_files` index and file SHA-256 hashes. The server must only re-embed changed/new files, delete vectors for deleted files, and replace vectors for changed files by adding new vectors first and deleting old vectors afterwards.

#### Documentation Locations

- Chroma JS client + filter/delete semantics:
  - Context7 `/chroma-core/chroma` (JS/TS client usage; `where` vs `whereDocument`)
  - https://docs.trychroma.com/ (collection operations and conceptual docs)
  - https://cookbook.chromadb.dev/ (filter schema examples)
  - Deepwiki `chroma-core/chroma` (quickly confirm JS signature maps `whereDocument` to API `where_document`)
- Mongoose v9 (connecting, guarding `readyState`, and simple query patterns): Context7 `/automattic/mongoose/9.0.1`
- Node fs/promises (readFile, readdir) and crypto hashing: https://nodejs.org/api/fs.html and https://nodejs.org/api/crypto.html
- Testcontainers Node (GenericContainer lifecycle, wait strategies): Context7 `/testcontainers/testcontainers-node`
- Mermaid diagram syntax (for documenting delta flows): Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/syntax-reference.html
- Cucumber (feature files + step definitions + hooks):
  - https://cucumber.io/docs/guides/ (main guides index; this is the canonical starting point)
  - https://cucumber.io/docs/guides/10-minute-tutorial/ (how feature/step wiring works)
  - https://cucumber.io/docs/cucumber/api/ (hooks/tags API used by this repo’s step files)
  - https://cucumber.io/docs/gherkin/reference/ (Gherkin syntax reference)
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Read the current ingest flow so delta changes are applied upstream (not bolted on downstream):
   - Docs to read (repeat; do not skip):
     - https://docs.trychroma.com/ (filters + delete semantics)
     - https://nodejs.org/api/crypto.html (hashing primitives)
     - Context7 `/automattic/mongoose/9.0.1` (Mongo availability + guards)
   - Files to read:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ingest/discovery.ts`
     - `server/src/ingest/hashing.ts`
     - `server/src/ingest/chromaClient.ts`
     - `server/src/routes/ingestReembed.ts`

2. [ ] Update `reembed()` so it no longer performs a root-wide **vector** delete before starting (delta needs existing vectors):
   - Docs to read (repeat; do not skip):
     - https://docs.trychroma.com/ (delete semantics; we are intentionally *not* deleting root vectors up front)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - `reembed(rootPath)` must still validate the root exists in the roots collection (as today).
     - If multiple root metadata entries exist for the same `rootPath`, select the most recent entry (prefer `lastIngestAt` desc) when choosing the `name/description/model` to re-embed with.
       - Reason: the roots collection can contain multiple entries for the same `root` (e.g., repeated ingests), and picking the first match can use stale metadata.
     - It must start the ingest run with `operation: 'reembed'` and allow `processRun()` to decide full vs delta.
     - Do not call `deleteVectors({ where: { root: rootPath } })` up front.
     - It is OK to delete root metadata entries (`deleteRoots({ where: { root: rootPath } })`) up front (current behavior) to avoid duplicates; this does **not** delete vectors.
     - Do not attempt to "dedupe roots" at write time in this story (deleting metadata is risky and can hide useful history).
       - Instead, keep the roots listing stable by deduping the `/ingest/roots` response by `path` (see subtask 10).

3. [ ] Remove the current re-embed early-return so delta can process deletions even when discovery returns zero eligible files:
   - Docs to read (repeat; do not skip):
     - https://nodejs.org/api/fs.html (discovery can legitimately yield 0 eligible files)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Today, `processRun` returns early for re-embed when `files.length === 0`.
     - Delta re-embed must still be able to detect that *previously ingested* files were deleted (including "all files deleted"), so it must still load the `ingest_files` index and compute deletions.

4. [ ] Load the previous per-file index and compute hashes for the newly discovered files:
   - Docs to read (repeat; do not skip):
     - Context7 `/automattic/mongoose/9.0.1` (querying + connection guards)
     - https://nodejs.org/api/crypto.html (SHA-256)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Load the previous per-file index from Mongo (`ingest_files`) for the discovered `root`.
     - Hash all discovered files using SHA-256 of file bytes.
     - Ensure relPath normalization is consistent with existing ingest/discovery.
     - Degraded-mode rule (important):
       - If Mongo is unavailable and `listIngestFilesByRoot(root)` returns `null`, delta cannot run.
       - In that case: fall back to a full re-embed behavior (legacy-style root delete + full ingest) and **skip** writing `ingest_files` updates (because Mongo is still unavailable).

5. [ ] Compute the delta plan and decide the "work to perform" set:
   - Docs to read (repeat; do not skip):
     - https://nodejs.org/api/test.html (how we’ll validate this with tests)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Use `buildDeltaPlan(...)` to compute `added/changed/unchanged/deleted`.
     - Ensure determinism (stable ordering of work by `relPath`).
     - Reminder of required delta semantics:
       - `added`: on disk but not in Mongo index
       - `changed`: same relPath but hash differs
       - `unchanged`: same relPath and hash
       - `deleted`: in Mongo index but no longer on disk

6. [ ] Implement the no-op ("nothing changed") behavior for delta re-embed:
   - Docs to read (repeat; do not skip):
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - If `added.length + changed.length + deleted.length === 0`:
       - Do not write to Chroma.
       - Mark the run as `skipped` with a clear `message`.
     - Required message content (so the UI is understandable):
       - Include the root path (or root id) and state why it skipped (e.g., "No changes detected").

7. [ ] Implement deletions-only delta runs (no new embeddings required):
   - Docs to read (repeat; do not skip):
     - https://docs.trychroma.com/ (delete with `where`)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - If `deleted.length > 0` and `added.length + changed.length === 0`:
       - Perform the required deletes in Chroma for `{ root, relPath }`.
       - The run must not claim "No changes detected". Use a terminal message that indicates work occurred.
       - State may remain `skipped` if no embeddings were required.
   - Copy/paste delete-by-relPath outline:
     ```ts
     for (const file of deleted) {
       await deleteVectors({ where: { $and: [{ root }, { relPath: file.relPath }] } });
     }
     ```

8. [ ] Embed only the `added + changed` files (unchanged files are not re-embedded):
   - Docs to read (repeat; do not skip):
     - https://nodejs.org/api/fs.html (reading file contents)
     - https://nodejs.org/api/crypto.html (file hashing)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - For each changed/added file:
       - Chunk and embed as usual.
       - Store vector metadata including `root`, `relPath`, `fileHash`, `chunkHash`, and `runId`.
     - Do not touch vectors for `unchanged` files.
   - Copy/paste list-of-files-to-process hint:
     ```ts
     const work = [...added, ...changed];
     // work is the ONLY set of files that should be embedded in delta mode.
     ```

9. [ ] After new vectors are successfully written, apply post-write deletes for changed/deleted files:
   - Docs to read (repeat; do not skip):
     - https://docs.trychroma.com/ (metadata `where` filtering)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - For each changed file:
       - Delete older vectors for `{ root, relPath }` where `fileHash != newHash` (use a Chroma `where: { $and: [...] }` structure).
     - For each deleted file:
       - Delete vectors for `{ root, relPath }`.
   - Copy/paste delete-old-hash snippet:
     ```ts
     await deleteVectors({
       where: {
         $and: [{ root }, { relPath }, { fileHash: { $ne: newHash } }],
       },
     });
     ```

10. [ ] Implement `/ingest/roots` response dedupe by root `path` (prevents duplicate rows in the UI):
   - Purpose: keep the roots table stable without risky write-time deletes.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/routes/ingestRoots.ts`
   - Requirements:
     - Implement the dedupe at read/response time (not write time):
       - If multiple root metadata entries exist for the same `path`, return only one entry for that path.
       - Keep the most recent entry (prefer `lastIngestAt` when present; otherwise fall back to `runId` ordering).
     - KISS: implement a small pure helper (e.g. `dedupeRootsByPath(roots: RootEntry[]): RootEntry[]`).
   - Copy/paste helper outline:
     ```ts
     // group by path, keep the entry with the greatest lastIngestAt (Date.parse)
     // if lastIngestAt is missing, keep the later runId entry (string compare is fine for IDs)
     ```

11. [ ] Unit test: dedupe keeps the most recent entry by `lastIngestAt` when multiple paths are duplicated:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-roots-dedupe.test.ts`
   - Purpose: ensure UI shows the latest ingest activity for a path.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/unit/ingest-roots-dedupe.test.ts`
   - Requirements:
     - Create two root entries with the same `path` but different `lastIngestAt`.
     - Assert the deduped output keeps the one with the later `lastIngestAt`.

12. [ ] Unit test: dedupe falls back to `runId` ordering when `lastIngestAt` is missing:
   - Test type: Server unit (node:test)
   - Location: `server/src/test/unit/ingest-roots-dedupe.test.ts`
   - Purpose: keep deterministic selection even when timestamps are absent.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-roots-dedupe.test.ts`
   - Requirements:
     - Create two root entries with the same `path` and no `lastIngestAt`.
     - Assert the deduped output keeps the one with the later `runId`.

13. [ ] Ensure the per-file index is written/maintained for both initial ingest and re-embed:
   - Docs to read (repeat; do not skip):
     - Context7 `/automattic/mongoose/9.0.1` (bulkWrite, deleteMany)
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
     - Reminder of exact document shape in `ingest_files` (do not improvise fields):
       - `{ root: string, relPath: string, fileHash: string, updatedAt: Date }`

14. [ ] Implement "legacy root upgrade" behavior:
   - Docs to read (repeat; do not skip):
     - https://docs.trychroma.com/ (delete all by metadata filter)
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
     - Reminder: legacy upgrade is only for the case where Mongo is connected and the index is empty.
       - If Mongo is disconnected (`listIngestFilesByRoot` returns `null`), treat it as a degraded mode and do not attempt to update `ingest_files`.

15. [ ] Ensure run cancellation remains safe and does not corrupt older vectors:
   - Docs to read (repeat; do not skip):
     - https://docs.trychroma.com/ (delete with `where: { runId }`)
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Requirements:
     - Cancel must delete only `{ runId }` vectors (existing behavior) and must not delete vectors for unchanged files.
     - Do not update `ingest_files` until the run is in a successful terminal state (completed or skipped).

16. [ ] Add Mongo Testcontainers support for Cucumber delta scenarios (hook + cucumber registration):
   - Docs to read (repeat; do not skip):
     - Context7 `/testcontainers/testcontainers-node` (GenericContainer + Wait)
     - https://cucumber.io/docs/guides/
     - Context7 `/automattic/mongoose/9.0.1` (connect/disconnect)
   - Files to add:
     - `server/src/test/support/mongoContainer.ts`
   - Files to edit:
     - `server/cucumber.js`
   - Requirements:
     - In `server/src/test/support/mongoContainer.ts`, use a `@mongo` tag and a `Before({ tags: '@mongo' }, ...)` hook to start a Mongo Testcontainers instance only for these scenarios.
      - Important: to keep the plan’s “No-Mongo” scenario real and deterministic, ensure Mongo is **disconnected** at the start of every scenario unless the scenario is tagged `@mongo`.
        - KISS approach:
          - Add a global `Before` hook that calls `disconnectMongo()` if connected (ignore errors).
          - Add `Before({ tags: '@mongo' }, ...)` to connect for `@mongo` scenarios.
      - Update `server/cucumber.js` to require `src/test/support/mongoContainer.ts` (alongside `chromaContainer.ts`) so the hooks are registered.
      - Important: this repo does **not** currently include `@testcontainers/mongodb`, so do not use `MongoDBContainer`.
        - Use `GenericContainer('mongo:8')` from the existing `testcontainers` dependency.
       - Configure it explicitly for reliability:
         - `.withExposedPorts(27017)`
         - `.withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))`
         - `.withStartupTimeout(120_000)`
       - Construct a connection string like:
         - `mongodb://<host>:<mappedPort>/db?directConnection=true`
       - Set `process.env.MONGO_URI` to the container URI and call `connectMongo(process.env.MONGO_URI)` during the hook.
      - De-risk: start the container lazily once and reuse it across all `@mongo` scenarios (like the existing Chroma compose setup) instead of starting/stopping per scenario.
      - Clear the `ingest_files` collection (or at least the relevant `root`) in a `Before` hook so scenarios stay isolated.
      - Ensure `disconnectMongo()` and container stop happen in an `AfterAll` hook.

17. [ ] Add the Cucumber feature file scaffold for delta semantics (tagging rules + shared background):
   - Test type: Cucumber feature (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: define the acceptance-level behavior of delta re-embed in a way that exercises the real HTTP API + Chroma (and Mongo where tagged).
   - Docs to read (repeat; do not skip):
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/guides/10-minute-tutorial/ (high-level how scenarios/steps fit together)
     - https://cucumber.io/docs/gherkin/reference (exact keyword/tag syntax)
   - Files to add:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Files to read (copy patterns; do not re-invent wiring):
     - `server/src/test/features/ingest-reembed.feature`
     - `server/src/test/features/ingest-roots.feature`
   - Requirements:
     - Tagging rules (important for running the right infrastructure):
       - Add `@mongo` only to scenarios that require Mongo assertions.
       - Do **not** tag the whole feature file `@mongo`, because we need at least one scenario to run with Mongo disconnected.
     - Add a short `Feature:` description that explains what delta re-embed is and why `ingest_files` exists.
   - Copy/paste skeleton (adapt step wording to match your step definitions):
     ```gherkin
     Feature: Ingest delta re-embed

       Background:
         Given the ingest delta test server is running with chroma and lmstudio
         And ingest delta chroma stores are empty
         And ingest delta models scenario "basic"

       @mongo
       Scenario: Changed file replacement updates vectors and ingest_files
         Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
         When I POST ingest start for the delta repo with model "embed-1"
         Then ingest delta status for the last run becomes "completed"
         When I change ingest delta temp file "a.ts" to "export const a=2;"
         And I POST ingest reembed for the delta repo
         Then ingest delta status for the last run becomes "completed"
         And ingest delta vectors for "a.ts" have the latest fileHash
     ```

18. [ ] Cucumber scenario: @mongo Changed file replacement updates vectors and `ingest_files`:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: ensure changed files are replaced without deleting vectors up-front.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
     - https://docs.trychroma.com/ (metadata filter semantics)
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Steps must cause a file content change for a single `relPath` between runs.
     - Assertions:
       - vectors for the old hash are deleted
       - vectors for the new hash exist
       - `ingest_files` row for the relPath is updated

19. [ ] Cucumber scenario: @mongo Deleted file cleanup removes vectors and `ingest_files` row:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: ensure deletions are applied even if no re-embedding is required.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
     - https://docs.trychroma.com/
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Steps must delete a previously ingested file.
     - Assertions:
       - vectors for the deleted relPath are removed
       - `ingest_files` row for the relPath is removed

20. [ ] Cucumber scenario: @mongo Added file ingest inserts vectors and `ingest_files` row:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: ensure newly added files are embedded and indexed.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Steps must add a new file under the root between runs.
     - Assertions:
       - vectors exist for the newly added relPath
       - `ingest_files` row for the relPath is inserted

21. [ ] Cucumber scenario: @mongo Unchanged file untouched keeps vectors and `ingest_files` stable:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: ensure delta does not churn vectors when no changes exist.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Steps must keep one file unchanged between runs.
     - Assertions:
       - vectors remain for the unchanged relPath (same fileHash)
       - `ingest_files` row remains unchanged

22. [ ] Cucumber scenario: @mongo Corner case “all files deleted” still cleans up and completes:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: ensure deletion detection works when discovery returns zero eligible files.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Steps must remove all eligible files under the root before re-embed.
     - Assertions:
       - discovery returns 0 eligible files
       - vectors for previously indexed files are deleted
       - `ingest_files` rows for the root are removed
       - run ends in a terminal state and status polling completes

23. [ ] Cucumber scenario: @mongo Corner case “no-op re-embed” returns `skipped` with a clear message:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: ensure no-op delta runs are detectable by the UI.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Steps must ensure no file content changes between runs.
     - Assertions:
       - no vectors are added or removed
       - run ends with `state: 'skipped'`
       - message indicates no changes (must not be empty)

24. [ ] Cucumber scenario: @mongo Corner case “deletions-only re-embed” message must not claim “No changes detected”:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: avoid misleading UX when deletions occurred.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Steps must delete at least one file but not add/change any others.
     - Assertions:
       - vectors are deleted for removed relPaths
       - run message is not “No changes detected”

25. [ ] Cucumber scenario: No-Mongo corner case “re-embed works when Mongo is disconnected”:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: ensure the server does not crash/hang when Mongo is unavailable.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Do not start the Mongo container for this scenario (do not tag `@mongo`).
     - Ensure the global Mongo hook leaves Mongoose disconnected for this scenario (readyState must not be `1`).
     - Run completes in a terminal state (completed/skipped).
     - The server does not crash/hang due to Mongo being unavailable.

26. [ ] Cucumber scenario: @mongo Legacy root upgrade deletes old vectors when `ingest_files` is empty and repopulates the index:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: prove the “legacy root upgrade” branch is real and prevents duplicate vectors when migrating existing roots.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
     - https://docs.trychroma.com/ (delete with metadata `where`)
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Tag this scenario with `@mongo`.
     - Scenario setup must create a legacy root state:
       - Run an initial ingest for a temp repo root so vectors exist.
       - Explicitly delete all `ingest_files` rows for that `root` (this simulates a pre-story root that has vectors but no per-file index).
     - Re-embed that same root.
     - Assertions:
       - The re-embed run must **not** end with `state: 'skipped'` (it must do work).
       - The post-reembed vectors must **not** include any vectors from the previous runId (assert by querying Chroma metadatas and confirming no `{ runId: <previousRunId> }` exist).
       - `ingest_files` must be populated for **all discovered files** under the root.
   - Copy/paste Gherkin outline (adapt step wording to match your step file):
     ```gherkin
     @mongo
     Scenario: Legacy upgrade removes old vectors and repopulates ingest_files
       Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
       When I POST ingest start for the delta repo with model "embed-1"
       Then ingest delta status for the last run becomes "completed"
       And I remember the last runId as "initialRunId"
       And I delete all ingest_files rows for the delta repo root
       When I POST ingest reembed for the delta repo
       Then ingest delta status for the last run becomes "completed"
       And no vectors exist for runId "initialRunId"
       And ingest_files contains at least 1 row for the delta repo root
     ```

27. [ ] Cucumber scenario: Re-embed selects the most recent root metadata entry when duplicates exist:
   - Test type: Cucumber scenario (server integration)
   - Location: `server/src/test/features/ingest-delta-reembed.feature`
   - Purpose: ensure `reembed(rootPath)` uses the latest `name/description/model` when multiple root entries exist for the same root.
   - Docs to read:
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/gherkin/reference/
     - https://docs.trychroma.com/
   - Files to edit:
     - `server/src/test/features/ingest-delta-reembed.feature`
   - Requirements:
     - Create a temp repo root with at least one eligible file.
     - Seed the Chroma roots collection with **two** metadata entries for the same `root` (path):
       - Entry A: older `lastIngestAt`, `name: "old-name"` (and/or a distinct description)
       - Entry B: newer `lastIngestAt`, `name: "new-name"`
     - Trigger `POST /ingest/reembed/:root` for that root.
    - Assertion:
      - After the run completes, `GET /ingest/roots` must show the root’s `name` as `"new-name"` (proving the re-embed used the most recent metadata).
   - Copy/paste Gherkin outline (adapt step wording to match your step file):
     ```gherkin
     Scenario: Re-embed uses latest root metadata when duplicates exist
       Given ingest delta temp repo with file "a.ts" containing "export const a=1;"
       And ingest delta roots collection contains duplicate metadata for the delta repo root:
         | lastIngestAt         | name     |
         | 2026-01-01T00:00:00Z | old-name |
         | 2026-01-02T00:00:00Z | new-name |
       When I POST ingest reembed for the delta repo
       Then ingest delta status for the last run becomes "completed"
       And ingest roots for the delta repo should have name "new-name"
     ```

28. [ ] Implement the step definitions for the delta feature:
   - Docs to read (repeat; do not skip):
     - https://cucumber.io/docs/guides/
     - https://cucumber.io/docs/guides/10-minute-tutorial/ (mental model for steps)
     - https://cucumber.io/docs/cucumber/api/ (Before/After/BeforeAll/AfterAll)
     - https://docs.trychroma.com/ (collection.get + include metadatas)
   - Files to add:
     - `server/src/test/steps/ingest-delta-reembed.steps.ts`
   - Files to read (copy patterns; do not reinvent server harness or polling):
     - `server/src/test/steps/ingest-manage.steps.ts`
     - `server/src/test/steps/ingest-status.steps.ts`
     - `server/src/test/steps/ingest-roots.steps.ts`
     - `server/src/test/support/chromaContainer.ts`
   - Requirements:
     - Query Chroma metadata (via `getVectorsCollection().get({ where, include: ['metadatas'] })`) to assert:
       - presence/absence of vectors for `{ root, relPath }`
       - `fileHash` differences across re-embed runs for changed files
     - Query Mongo (`ingest_files`) to assert per-file index rows are correct *only for scenarios tagged `@mongo`*.
       - For non-@mongo scenarios, do not access Mongo and do not make assertions about `ingest_files`.
     - Add assertions for the ingest status API:
       - poll `GET /ingest/status/:runId` until terminal
       - assert `state` is terminal (`completed|cancelled|error|skipped`)
       - for no-op runs, assert `state === 'skipped'` and message contains a clear reason
       - for deletions-only runs, assert message is not "No changes detected"
     - Add step support for the new scenarios:
       - A step to delete all `ingest_files` rows for a root (used to simulate a legacy root).
       - A step to seed duplicate root metadata entries (two roots records for the same `root` path with different `lastIngestAt` and `name`).
       - A step/assertion to confirm there are **zero** vectors matching `{ runId: <priorRunId> }` after a legacy-upgrade re-embed.
     - The test must not rely on manual inspection.

29. [ ] Update `design.md` to reflect the new delta re-embed behavior (including Mermaid diagrams):
   - Docs to read (repeat; do not skip):
     - https://www.markdownguide.org/basic-syntax/
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Describe delta vs legacy re-embed behavior and the safety guarantee (add new vectors first, delete old after).
     - Add at least one Mermaid diagram so the flow is unambiguous (use fenced code blocks with language `mermaid`).
       - Preferred diagrams:
         - A Mermaid `sequenceDiagram` showing request → run creation → status polling → terminal state.
         - A Mermaid `flowchart` showing the `processRun` decision points (delta vs legacy upgrade vs degraded-mode fallback).
       - Copy/paste starter flowchart (adapt labels to match the final code paths):
         ```mermaid
         flowchart TD
           A[POST /ingest/reembed/:root] --> B{Mongo connected?}
           B -- no --> C[Degraded mode: full re-embed]\n(no ingest_files updates)
           B -- yes --> D{ingest_files has rows for root?}
           D -- no --> E[Legacy upgrade]\n(delete root vectors + full ingest + populate ingest_files]
           D -- yes --> F[Delta plan]\n(added/changed/unchanged/deleted)
           F --> G{Any added/changed/deleted?}
           G -- no --> H[Mark run skipped]\n(message: no changes]
           G -- yes --> I[Write new vectors for added/changed]
           I --> J[Delete old vectors for changed]\n+ delete vectors for deleted
           J --> K[Update ingest_files]\n(upsert added/changed, delete deleted)
       ```

30. [ ] Update `projectStructure.md` to include all new server files added in this task:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file paths:
       - `server/src/test/support/mongoContainer.ts`
       - `server/src/test/features/ingest-delta-reembed.feature`
       - `server/src/test/steps/ingest-delta-reembed.steps.ts`
       - `server/src/test/unit/ingest-roots-dedupe.test.ts`

31. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (delta re-embed behavior smoke):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks:
     - Load `http://localhost:5001/ingest` and confirm:
       - Roots list loads without duplicate rows for the same path.
       - Re-embed runs that do no work can surface `skipped` in status endpoints (server-side behavior).

9. [ ] `npm run compose:down`

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
- Mermaid diagram syntax (for documenting the new `/ingest/dirs` flow): Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/syntax-reference.html
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`
- Markdown syntax (used when updating docs): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Read existing ingest route patterns for consistent error handling and mount style:
   - Docs to read (repeat; do not skip):
     - Context7 `/expressjs/express/v5.1.0` (routing)
   - Files to read:
     - `server/src/routes/ingestStart.ts`
     - `server/src/routes/ingestRoots.ts`
     - `server/src/index.ts`
     - `server/src/ingest/pathMap.ts`
     - `server/src/test/unit/pathMap.test.ts`

2. [ ] Implement the directory listing route:
   - Docs to read (repeat; do not skip):
     - Context7 `/expressjs/express/v5.1.0` (async route handlers)
     - https://nodejs.org/api/fs.html#fspromisesreaddirpath-options
     - https://nodejs.org/api/path.html
   - Files to add:
     - `server/src/routes/ingestDirs.ts`
   - Requirements:
     - Route: `GET /ingest/dirs?path=<absolute server path>`.
     - Base path:
       - `base = process.env.HOST_INGEST_DIR || '/data'`.
       - If query `path` is omitted, list the base.
       - If query `path` is present but empty/whitespace (or not a string), treat it as omitted and list the base (do not introduce new error codes).
     - Exact response contract (copy/paste for reference; do not change keys):
       - Success:
         ```json
         { "base": "/data", "path": "/data/projects", "dirs": ["repo-a", "repo-b"] }
         ```
       - Error:
         ```json
         { "status": "error", "code": "OUTSIDE_BASE" | "NOT_FOUND" | "NOT_DIRECTORY" }
         ```
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
   - Copy/paste route skeleton (edit to match repo style):
     ```ts
     router.get('/ingest/dirs', async (req, res) => {
       const base = process.env.HOST_INGEST_DIR || '/data';
       const raw = typeof req.query.path === 'string' ? req.query.path : '';
       const requested = raw.trim() || base;
       // validate requested is inside base (lexically)
       // fs.stat -> isDirectory
       // fs.readdir({ withFileTypes: true }) -> dirs
     });
     ```

3. [ ] Mount the router in the server:
   - Docs to read:
     - Context7 `/expressjs/express/v5.1.0` (Router mounting)
   - Files to edit:
     - `server/src/index.ts`
   - Requirements:
     - Mount the router at `/` like other ingest routes.

4. [ ] Create the server unit test suite for `GET /ingest/dirs`:
   - Test type: Server unit (node:test + SuperTest)
   - Purpose: validate edge cases and error handling without relying on a real filesystem outside the test temp directory.
   - Docs to read (repeat; do not skip):
     - Context7 `/ladjs/supertest`
     - https://nodejs.org/api/test.html
   - Files to add:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - Create a temp directory tree.
     - Set `process.env.HOST_INGEST_DIR` to the temp base for the test.

5. [ ] Unit test: default request (no `path` query) lists child directories under the base:
   - Test type: Server unit (node:test + SuperTest)
   - Location: `server/src/test/unit/ingest-dirs-router.test.ts`
   - Purpose: confirm the simplest happy path for the directory picker.
   - Docs to read:
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - `GET /ingest/dirs` returns `200` and includes `dirs` with only directory names.

6. [ ] Unit test: `path=` (empty string) behaves like omitted path (lists base):
   - Test type: Server unit (node:test + SuperTest)
   - Location: `server/src/test/unit/ingest-dirs-router.test.ts`
   - Purpose: avoid ambiguous client behavior when the query string is present but blank.
   - Docs to read:
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - `GET /ingest/dirs?path=` returns `200` and lists the base.

7. [ ] Unit test: `path=   ` (whitespace) behaves like omitted path (lists base):
   - Test type: Server unit (node:test + SuperTest)
   - Location: `server/src/test/unit/ingest-dirs-router.test.ts`
   - Purpose: ensure the API is resilient to UI trimming/formatting issues.
   - Docs to read:
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - `GET /ingest/dirs?path=%20%20%20` returns `200` and lists the base.

8. [ ] Unit test: non-string `path` query behaves like omitted path (lists base):
   - Test type: Server unit (node:test + SuperTest)
   - Location: `server/src/test/unit/ingest-dirs-router.test.ts`
   - Purpose: avoid hard-to-debug crashes if clients send repeated query keys.
   - Docs to read:
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - Send a request like `GET /ingest/dirs?path=a&path=b` and assert it lists the base.

9. [ ] Unit test: returned `dirs` are sorted ascending:
   - Test type: Server unit (node:test + SuperTest)
   - Location: `server/src/test/unit/ingest-dirs-router.test.ts`
   - Purpose: keep the UI stable and predictable.
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - Create directories out of order and assert response `dirs` is sorted.

10. [ ] Unit test: `OUTSIDE_BASE` for a `path` outside the base:
   - Test type: Server unit (node:test + SuperTest)
   - Location: `server/src/test/unit/ingest-dirs-router.test.ts`
   - Purpose: enforce lexical containment and protect the server from browsing arbitrary FS paths.
   - Docs to read:
     - https://nodejs.org/api/path.html
   - Files to edit:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - Request a path outside base and assert `400` with `{ status:'error', code:'OUTSIDE_BASE' }`.

11. [ ] Unit test: `NOT_FOUND` for a missing path:
   - Test type: Server unit (node:test + SuperTest)
   - Location: `server/src/test/unit/ingest-dirs-router.test.ts`
   - Purpose: ensure the UI can show a meaningful error if the directory disappears.
   - Docs to read:
     - https://nodejs.org/api/fs.html
   - Files to edit:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - Request a non-existent path inside base and assert `404` with `{ status:'error', code:'NOT_FOUND' }`.

12. [ ] Unit test: `NOT_DIRECTORY` when `path` points at a file:
   - Test type: Server unit (node:test + SuperTest)
   - Location: `server/src/test/unit/ingest-dirs-router.test.ts`
   - Purpose: ensure the API does not return an invalid list response for files.
   - Docs to read:
     - https://nodejs.org/api/fs.html
   - Files to edit:
     - `server/src/test/unit/ingest-dirs-router.test.ts`
   - Requirements:
     - Request a file path inside base and assert `400` with `{ status:'error', code:'NOT_DIRECTORY' }`.

13. [ ] Update `design.md` with the `GET /ingest/dirs` endpoint contract and a Mermaid flow diagram:
   - Docs to read (repeat; do not skip):
     - https://www.markdownguide.org/basic-syntax/
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add the endpoint contract (request + success/error responses).
     - Add a short Mermaid diagram showing the server-side validation flow (base selection → lexical containment check → stat/isDirectory → readdir → sorted dirs).
       - Copy/paste starter diagram (adapt names to match the final implementation):
         ```mermaid
         flowchart TD
           A[GET /ingest/dirs?path=...] --> B[Derive base from HOST_INGEST_DIR or /data]
           B --> C{path provided?}
           C -- no/blank --> D[List base]
           C -- yes --> E[Validate inside base (lexical)]
           E -- outside --> F[400 OUTSIDE_BASE]
           E -- ok --> G{exists?}
           G -- no --> H[404 NOT_FOUND]
           G -- yes --> I{isDirectory?}
           I -- no --> J[400 NOT_DIRECTORY]
           I -- yes --> K[readdir withFileTypes]\nfilter dirs\nsort
           K --> L[200 { base, path, dirs[] }]
         ```

14. [ ] Update `projectStructure.md` with any new server files added in this task:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file paths:
       - `server/src/routes/ingestDirs.ts`
       - `server/src/test/unit/ingest-dirs-router.test.ts`

15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (`GET /ingest/dirs` endpoint contract):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks:
     - Load `http://localhost:5010/ingest/dirs` in the browser and confirm response contains `{ base, path, dirs }`.
     - Load `http://localhost:5010/ingest/dirs?path=/does-not-exist` and confirm `{ status:'error', code:'NOT_FOUND' }`.

9. [ ] `npm run compose:down`

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
- Jest (client unit tests): Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Confirm current mismatch between server and client ingest states:
   - Docs to read (repeat; do not skip):
     - https://react.dev/reference/react/useEffect (polling + cleanup)
   - Files to read:
     - `server/src/ingest/types.ts` (server includes `skipped`)
     - `client/src/hooks/useIngestStatus.ts` (client terminalStates does not include `skipped`)
     - `client/src/pages/IngestPage.tsx` (run-active and refresh logic)

2. [ ] Update the ingest status types and polling logic to treat `skipped` as terminal:
   - Docs to read (repeat; do not skip):
     - https://react.dev/reference/react/useEffect
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Requirements:
     - Add `'skipped'` to the `IngestState` union.
     - Add `'skipped'` to `terminalStates` so the hook stops polling.
   - Copy/paste hint:
     ```ts
     const terminalStates: IngestState[] = ['completed', 'cancelled', 'error', 'skipped'];
     ```

3. [ ] Update IngestPage terminal/run-active logic to treat `skipped` as terminal:
   - Docs to read (repeat; do not skip):
     - https://react.dev/reference/react/useEffect
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Include `skipped` in the “run finished” checks so the UI:
       - re-enables form/table actions
       - triggers `refetchRoots()` and `refresh()` when a run ends as `skipped`

4. [ ] Update `ActiveRunCard` so `skipped` is a supported terminal status (chip + cancel button):
   - Docs to read:
     - https://react.dev/reference/react/useEffect
   - Files to edit:
     - `client/src/components/ingest/ActiveRunCard.tsx`
   - Purpose:
     - Ensure the Active ingest card can display `skipped` and treats it as terminal (no Cancel button).
   - Requirements:
     - Add `'skipped'` to the `status` union.
     - Add a `statusColor` mapping for `skipped` (use a non-error color, e.g. `warning` or `info`).
     - Include `skipped` in the terminal-state check.

5. [ ] Client unit test: polling stops when ingest status returns `state: 'skipped'`:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestStatus.test.tsx`
   - Purpose: prevent infinite polling loops on no-op delta re-embeds.
   - Docs to read (repeat; do not skip):
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest` (fake timers + mocks)
     - https://jestjs.io/docs/getting-started
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
   - Requirements:
     - Add a test similar to “polls until completed then stops”, but with the terminal response returning `state: 'skipped'`.
     - Assert polling stops after the `skipped` response.

6. [ ] Client unit test: the UI renders a `skipped` status label:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestStatus.test.tsx`
   - Purpose: make skipped runs visible/understandable.
   - Docs to read:
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
   - Requirements:
     - Assert the run status label includes “skipped” (or the exact text used by the UI).

7. [ ] Client unit test: the UI re-enables actions after a `skipped` terminal state:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestStatus.test.tsx`
   - Purpose: ensure the form/buttons are not stuck disabled after no-op runs.
   - Docs to read:
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
   - Requirements:
     - Assert form/buttons are enabled after the skipped response.

8. [ ] Client unit test: IngestPage triggers roots + models refresh when the terminal state is `skipped`:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestStatus.test.tsx`
   - Purpose: ensure the page-level `useEffect` that runs after completion also runs for `skipped` (so the UI reflects latest roots/models after no-op re-embeds).
   - Docs to read (repeat; do not skip):
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest` (module mocking)
     - https://jestjs.io/docs/mock-functions
     - https://jestjs.io/docs/jest-object#jestmockmodulename-factory-options
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
   - Requirements:
     - Mock `useIngestModels` to expose a spy `refresh` function.
     - Mock `useIngestRoots` to expose a spy `refetch` function.
     - Mock `useIngestStatus` so it returns a terminal `status: 'skipped'` once an `activeRunId` exists.
     - Trigger `activeRunId` inside the test in a KISS way:
       - Prefer mocking `client/src/components/ingest/IngestForm.tsx` to call `props.onStarted('run-1')` on mount.
     - Assertion:
       - Once the component renders with `activeRunId` and `status: 'skipped'`, `refetch` and `refresh` are each called exactly once.
   - Copy/paste test skeleton (adapt imports to match test file style):
     ```ts
     const refresh = jest.fn();
     const refetch = jest.fn();

     jest.mock('../hooks/useIngestModels', () => ({
       __esModule: true,
       default: () => ({
         models: [],
         lockedModelId: null,
         defaultModelId: null,
         isLoading: false,
         isError: false,
         error: null,
         refresh,
       }),
     }));

     jest.mock('../hooks/useIngestRoots', () => ({
       __esModule: true,
       default: () => ({
         roots: [],
         lockedModelId: null,
         isLoading: false,
         isError: false,
         error: null,
         refetch,
       }),
     }));

     jest.mock('../hooks/useIngestStatus', () => ({
       __esModule: true,
       default: (runId?: string) => ({
         status: runId ? 'skipped' : null,
         counts: null,
         isLoading: false,
         isCancelling: false,
         error: null,
         cancel: jest.fn(),
       }),
     }));

     jest.mock('../components/ingest/IngestForm', () => ({
       __esModule: true,
       default: (props: { onStarted?: (runId: string) => void }) => {
         props.onStarted?.('run-1');
         return null;
       },
     }));
     ```

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (`skipped` terminal UX):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks:
     - Start an ingest/re-embed run that results in `skipped` and confirm the UI stops polling and re-enables actions.

9. [ ] `npm run compose:down`

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
- Jest (client unit tests): Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Confirm the duplication exists today and identify the two render locations:
   - Docs to read (repeat; do not skip):
     - MUI Alert docs: https://mui.com/material-ui/api/alert/
   - Files to read:
     - `client/src/pages/IngestPage.tsx`
     - `client/src/components/ingest/IngestForm.tsx`

2. [ ] Remove the in-form locked notice:
   - Docs to read (repeat; do not skip):
     - MUI Alert docs: https://mui.com/material-ui/api/alert/
   - Files to edit:
     - `client/src/components/ingest/IngestForm.tsx`
   - Requirements:
     - Remove the `Alert` that renders “Embedding model locked to …” inside the form.
     - Keep the existing behavior that disables the model select when `lockedModelId` exists.

3. [ ] Ensure the page-level notice is shown in the correct location:
   - Docs to read (repeat; do not skip):
     - MUI Alert docs: https://mui.com/material-ui/api/alert/
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Requirements:
     - Render exactly one notice “Embedding model locked to <id>”.
     - Place it directly below the “Start a new ingest” title (not duplicated elsewhere).

4. [ ] Client unit test update: lock banner is not rendered inside `IngestForm`:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestForm.test.tsx`
   - Purpose: enforce the “single notice” requirement and prevent UI duplication regressions.
   - Docs to read (repeat; do not skip):
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest`
     - https://jestjs.io/docs/getting-started
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Update/remove assertions that expect the lock banner to be inside `IngestForm`.

5. [ ] Client unit test: Embedding model select is disabled when `lockedModelId` is provided:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestForm.test.tsx`
   - Purpose: preserve the safety constraint that prevents mixing embedding models.
   - Docs to read:
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Assert the model select is disabled when `lockedModelId` is present.

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (single lock notice):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks:
     - Open the Ingest page and confirm “Embedding model locked to …” appears exactly once.

9. [ ] `npm run compose:down`

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
- MUI TextField docs (Folder path input is a TextField): https://mui.com/material-ui/api/text-field/
- Fetch API (query string building): https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
- Fetch API basics (used for calling the server endpoint): https://developer.mozilla.org/en-US/docs/Web/API/fetch
- Mermaid diagram syntax (for documenting the directory picker UX flow): Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/syntax-reference.html
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Jest (client unit tests): Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started
- Tooling references for required verification commands (npm run, ESLint CLI, Prettier CLI): https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://eslint.org/docs/latest/use/command-line-interface, Context7 `/prettier/prettier/3.6.2`

#### Subtasks

1. [ ] Read the existing ingest form state management and serverBase usage:
   - Docs to read (repeat; do not skip):
     - MUI Dialog docs: https://mui.com/material-ui/api/dialog/
     - Fetch URL building: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Files to read:
     - `client/src/components/ingest/IngestForm.tsx`

2. [ ] Add a small, typed fetch helper for `GET /ingest/dirs` (keeps the dialog component simple):
   - Docs to read (repeat; do not skip):
     - Fetch URL building: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Files to add:
     - `client/src/components/ingest/ingestDirsApi.ts`
   - Requirements:
     - Reminder: this MUST match the server contract exactly (do not rename fields):
       - Success:
         ```json
         { "base": "/data", "path": "/data/projects", "dirs": ["repo-a", "repo-b"] }
         ```
       - Error:
         ```json
         { "status": "error", "code": "OUTSIDE_BASE" | "NOT_FOUND" | "NOT_DIRECTORY" }
         ```
     - Export minimal types matching the server contract:
       - success: `{ base: string; path: string; dirs: string[] }`
       - error: `{ status: 'error'; code: 'OUTSIDE_BASE' | 'NOT_FOUND' | 'NOT_DIRECTORY' }`
     - Export a single function like `fetchIngestDirs(params: { path?: string }): Promise<...>`.
   - Copy/paste fetch hint:
     ```ts
     const qs = new URLSearchParams();
     if (params.path) qs.set('path', params.path);
     const url = new URL(`/ingest/dirs?${qs.toString()}`, serverBase).toString();
     const res = await fetch(url);
     const payload = await res.json();
     ```

3. [ ] Add a small directory picker dialog component (UI shell + loading/error states):
   - Docs to read (repeat; do not skip):
     - MUI Dialog docs: https://mui.com/material-ui/api/dialog/
     - React Testing Library (for later tests): https://testing-library.com/docs/react-testing-library/intro/
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
   - Docs to read (repeat; do not skip):
     - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String
   - Files to edit:
     - `client/src/components/ingest/DirectoryPickerDialog.tsx`
   - Requirements:
     - Allow navigation into a directory by clicking it.
     - Provide an "Up" action unless already at `base`.
     - Provide a "Use this folder" action for the currently viewed folder.

5. [ ] Wire the dialog into the Folder path input:
   - Docs to read (repeat; do not skip):
     - MUI TextField docs: https://mui.com/material-ui/api/text-field/
   - Files to edit:
     - `client/src/components/ingest/IngestForm.tsx`
   - Requirements:
     - Add a "Choose folder…" button next to the Folder path field.
     - When a folder is picked, update the text field value to the chosen absolute server path.
     - The Folder path text field must remain editable even if the picker is available.
     - Do not use browser filesystem APIs (no native directory pickers).

6. [ ] Test setup: mock `fetch` helpers for `GET /ingest/dirs` responses:
   - Purpose: keep the picker tests readable by centralizing repetitive mocking.
   - Docs to read (repeat; do not skip):
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest` (mocks + spies)
     - https://jestjs.io/docs/getting-started
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Provide a small helper to enqueue successive `fetch` responses for directory navigation.
   - Copy/paste helper outline:
     ```ts
     const enqueueFetchJson = (payloads: unknown[]) => {
       const fetchSpy = jest.spyOn(global, 'fetch' as any);
       for (const payload of payloads) {
         fetchSpy.mockResolvedValueOnce({
           ok: true,
           status: 200,
           json: async () => payload,
         } as any);
       }
       return fetchSpy;
     };
     ```

7. [ ] Client unit test: selecting a directory updates the Folder path input value:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestForm.test.tsx`
   - Purpose: prove the main happy path of the directory picker.
   - Docs to read:
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Open the dialog (click “Choose folder…”), choose a directory, and assert the Folder path input value changes.

8. [ ] Client unit test: clicking a directory triggers a second fetch for the new path:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestForm.test.tsx`
   - Purpose: ensure navigation is server-backed and keeps state consistent.
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Assert `fetch` is called twice and the second call includes the clicked path.

9. [ ] Client unit test: “Up” is disabled/hidden at the base and enabled when not at base:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestForm.test.tsx`
   - Purpose: prevent navigation that would attempt to browse above the allowed base.
   - Docs to read:
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Assert “Up” is not available at base.
     - After navigating into a subdirectory, assert “Up” becomes available.

10. [ ] Client unit test: “Use this folder” sets the current path even if no child directory is clicked:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestForm.test.tsx`
   - Purpose: allow selecting the currently viewed directory.
   - Docs to read:
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Open the dialog and click “Use this folder”.
     - Assert the Folder path input is set to the currently viewed `path`.

11. [ ] Client unit test: error path displays an error message when server returns `{ status:'error', code:'OUTSIDE_BASE' }`:
   - Test type: Client unit (Jest + React Testing Library)
   - Location: `client/src/test/ingestForm.test.tsx`
   - Purpose: ensure users can understand and recover from invalid navigation.
   - Docs to read:
     - https://testing-library.com/docs/react-testing-library/intro/
     - Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/ingestForm.test.tsx`
   - Requirements:
     - Mock a server error payload and assert the dialog renders an error state/message.

12. [ ] Update `design.md` with the directory picker UX flow (including a Mermaid diagram):
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Document how the “Choose folder…” dialog uses `GET /ingest/dirs` to browse within `HOST_INGEST_DIR`.
     - Add a Mermaid `sequenceDiagram` that shows:
       - opening the dialog triggers an initial `GET /ingest/dirs`
       - clicking a directory triggers another `GET /ingest/dirs?path=...`
       - clicking “Use this folder” calls `onPick(path)` and updates the Folder path field
       - an error response (`OUTSIDE_BASE` / `NOT_FOUND` / `NOT_DIRECTORY`) results in an error state in the dialog
     - Copy/paste starter diagram (adapt names/labels to match the final UI):
       ```mermaid
       sequenceDiagram
         participant User
         participant UI as Client UI (IngestForm + DirectoryPickerDialog)
         participant API as Server API

         User->>UI: Click "Choose folder…"
         UI->>API: GET /ingest/dirs
         API-->>UI: 200 { base, path, dirs[] }
         UI-->>User: Show directory list

         User->>UI: Click a directory
         UI->>API: GET /ingest/dirs?path=<clicked>
         API-->>UI: 200 { base, path, dirs[] }

         User->>UI: Click "Use this folder"
         UI-->>User: Folder path field updated

         Note over UI,API: Error case
         UI->>API: GET /ingest/dirs?path=<outside>
         API-->>UI: 400 { status:'error', code:'OUTSIDE_BASE' }
         UI-->>User: Show error state
       ```

13. [ ] Update `projectStructure.md` with the new client ingest picker files:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add the new file paths:
       - `client/src/components/ingest/ingestDirsApi.ts`
       - `client/src/components/ingest/DirectoryPickerDialog.tsx`

14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (directory picker modal):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks:
     - Open the Ingest page, click “Choose folder…”, navigate into a folder, then click “Use this folder”.
     - Confirm the Folder path input updates to the chosen path.

9. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 9. Final verification (acceptance criteria, clean builds, docs, and PR summary)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Perform end-to-end verification for the story: delta re-embed behavior, directory picker endpoint + UI, and documentation accuracy. This task ensures the story’s acceptance criteria are met and produces a PR-ready summary.

#### Documentation Locations

- Docker/Compose:
  - Context7 `/docker/docs`
  - https://docs.docker.com/reference/cli/docker/compose/ (CLI reference; confirms build/up args)
- Playwright:
  - Context7 `/microsoft/playwright`
  - https://playwright.dev/docs/intro (official docs; stable reference)
- Husky:
  - Context7 `/typicode/husky`
  - https://typicode.github.io/husky (official docs site)
- Mermaid:
  - Context7 `/mermaid-js/mermaid`
  - https://mermaid.js.org/intro/syntax-reference.html (syntax reference)
- Jest:
  - Context7 `/jestjs/jest`
  - https://jestjs.io/docs/getting-started
- Cucumber:
  - https://cucumber.io/docs/guides/
  - https://cucumber.io/docs/guides/10-minute-tutorial/
  - https://cucumber.io/docs/gherkin/reference/
- Markdown syntax (used for PR summaries and docs edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Re-check the story Acceptance Criteria section and confirm each bullet is demonstrably satisfied (no "it should" assumptions).
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
2. [ ] Documentation update: verify and update `README.md` for story 0000020 changes:
   - Document: `README.md`
   - Location: repo root (`README.md`)
   - Purpose: keep the “how to run/use” docs correct for developers.
   - Description: ensure any new runtime behavior introduced by delta re-embed and directory picking is discoverable.
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `README.md`
   - Requirements:
     - Ensure the README accurately reflects any new/changed env vars or behavior required by this story (e.g. `HOST_INGEST_DIR` defaulting and directory picker expectations).
     - Do not duplicate detailed API/flow diagrams here (those belong in the design document).

3. [ ] Documentation update: verify and update `design.md` (architecture + flows + Mermaid diagrams):
   - Document: `design.md`
   - Location: repo root (`design.md`)
   - Purpose: keep architecture and feature behavior understandable, especially for on-boarding.
   - Description: ensure the story’s new ingest semantics and directory picker UX flow are fully documented with Mermaid diagrams.
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Ensure the delta re-embed behavior (including `skipped` no-op and deletions-only messaging) is documented.
     - Ensure the `/ingest/dirs` endpoint contract and the client directory picker UX flow are documented.
     - Ensure Mermaid diagrams render (fenced code blocks with language `mermaid`, valid syntax).

4. [ ] Documentation update: verify and update `projectStructure.md` for any added/removed files:
   - Document: `projectStructure.md`
   - Location: repo root (`projectStructure.md`)
   - Purpose: keep the codebase map accurate for developers navigating the repo.
   - Description: ensure all files added or removed in story 0000020 are reflected in the project structure listing.
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Confirm all new server/client/test files introduced by tasks 1–8 are listed under the correct sections.
     - Remove any references to files that no longer exist.

5. [ ] Create a PR summary comment that covers all changes (server + client + tests) and references any new commands/behaviors.
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`

2. [ ] `npm run build --workspace client`

3. [ ] `npm run test --workspace server`

4. [ ] `npm run test --workspace client`

5. [ ] `npm run e2e`

6. [ ] `npm run compose:build`
   - Note: if you need a clean rebuild, use `npm run compose:build:clean`.

7. [ ] `npm run compose:up`

8. [ ] Manual Playwright-MCP check (story acceptance + regression smoke):
   - Docs to read:
     - Context7 `/microsoft/playwright`
   - Checks (story-specific):
     - Delta no-op re-embed: run a re-embed with no file changes and confirm status becomes `skipped` with a clear message.
     - Deletions-only: delete a file under a root, re-embed, and confirm the run does **not** claim “No changes detected”.
     - Directory picker: open “Choose folder…”, navigate into a directory, pick it, and confirm Folder path updates.
     - Lock notice: confirm “Embedding model locked to …” appears exactly once on the Ingest page.
   - Checks (regression):
     - Load `http://localhost:5001/chat` and confirm chat loads.
     - Load `http://localhost:5001/logs` and confirm logs page loads.
   - Required screenshots (save to `./test-results/screenshots/`):
     - `0000020-9-ingest-page.png` (Ingest page shows single lock notice + Choose folder button)
     - `0000020-9-ingest-picker.png` (Directory picker dialog open)
     - `0000020-9-ingest-delta.png` (Roots table reflects a completed/skipped re-embed run)

9. [ ] `npm run compose:down`


#### Implementation notes

- 
