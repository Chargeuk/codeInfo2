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
- **Cancel cleanup:** `cancelRun` in `server/src/ingest/ingestJob.ts` deletes vectors with `where: { runId }`, so run-scoped cleanup already exists and is safe to keep for delta.
- **Root-wide deletes:** `reembed` and `removeRoot` in `server/src/ingest/ingestJob.ts` delete vectors/roots by `root`, with low-level delete helpers in `server/src/ingest/chromaClient.ts` (delete vectors/roots, drop empty collections, clear locked model).
- **Delete helper signature:** `deleteVectors` in `server/src/ingest/chromaClient.ts` accepts `where` and/or `ids` and forwards them directly to Chroma’s `collection.delete`, so we can pass metadata filters without extra wrapper changes.
- **Path normalization:** `mapIngestPath` in `server/src/ingest/pathMap.ts` already normalizes host/container paths and extracts `relPath`; reuse it to keep relPath consistent.
- **Chroma delete filters:** Chroma `collection.delete` accepts `where` and optional `where_document`. The documented filter schema includes metadata operators `$eq/$ne/$gt/$gte/$lt/$lte`, `$in/$nin`, and logical `$and/$or`, with a single operator per field (maxProperties=1). Document filters support `$contains/$not_contains` plus `$and/$or`.
- **Filter machinery:** Chroma’s core filter implementation treats delete filters consistently with query/get; the same `Where` structures and operators back all three operations.
- **MUI modal choice:** MUI `Dialog` (built on `Modal`) provides `open` and `onClose` and is appropriate for a simple directory picker modal.
- **Directory picker endpoint (codebase):** there is no existing route or helper that lists directories under `HOST_INGEST_DIR`; current ingest routes only validate required fields and `GET /ingest/roots` lists stored ingest metadata (not live filesystem contents). Existing path validation helpers live in `server/src/ingest/pathMap.ts` and agents’ working-folder resolver.
- **Symlink/realpath behavior (codebase):** current path helpers and discovery logic normalize paths and rely on prefix checks without calling `realpath`, so they do not guard against symlink escapes; this aligns with the decision to allow symlinked paths that resolve outside the base.
- **Directory picker endpoint (recommended behavior):** use `fs.promises.readdir` with `withFileTypes: true` to list child directories, and validate the requested path by resolving it against the allowed base (e.g., `path.resolve` + prefix check). Do not reject paths that escape via symlinks, per the symlink allowance decision; only reject paths that are outside the base by string/lexical resolution or are unreadable.

---

## Questions

None (resolved; details folded into Description / Acceptance Criteria / Out Of Scope).

---

# Tasks

(Not yet created — this story is still in the “Description/Acceptance Criteria/Out Of Scope/Questions” phase.)
