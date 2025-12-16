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

To make deletions/changes fast and avoid scanning chunk metadata in Chroma, we will introduce a lightweight **per-file index stored in MongoDB** (for example `ingest_files`) keyed by `{ root, relPath }` and storing `fileHash` (and any other small fields we decide are useful). This index is used to:
- detect deleted files (present in the index but not found on disk),
- detect changed files (hash differs), and
- detect new files (present on disk but not in the index).

For changed files, we will treat re-ingest as a **file-level replacement**: delete all existing vectors for `{ root, relPath }` and then re-chunk and re-add the file’s vectors. We will not attempt chunk-level upserts because modified files are very unlikely to retain the same chunk boundaries.

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
  - For files whose content has changed (based on a file hash), performs a file-level replacement by deleting all vectors for `{ root, relPath }` and re-embedding the file.
  - Embeds and ingests files that are new (not previously present for that folder).
  - Leaves vectors for unchanged files untouched.
  - Automatically upgrades legacy roots (ingested before the Mongo per-file index existed): if there is no per-file index data for the root, delete all existing vectors for that root and re-ingest, populating the per-file index as part of that run.
- Each embedded chunk has metadata sufficient to attribute it to a specific file:
  - Store a file path including filename (relative to the ingested root, or another agreed representation).
  - Store a file hash (and any other identifiers needed for diffing).
- A per-file index is persisted in **MongoDB** and is the primary source of truth for delta decisions:
  - It is keyed by `{ root, relPath }` and stores `fileHash` (minimum).
  - Delta re-ingest uses this index to detect new/changed/deleted files without scanning all chunk metadata in Chroma.
- Re-ingest remains safe/robust:
  - Cancelling a run cleans up only the in-progress vectors for that run (no partial corruption of existing unchanged vectors).
  - Concurrency is controlled (no simultaneous ingest/re-ingest against the same collections beyond existing locking rules).
  - Existing ingest status polling (`GET /ingest/status/:runId`) continues to work unchanged.
- Ingest page UX:
  - The “Embedding model locked to …” notice is shown only once (below “Start a new ingest” title, not duplicated inside the form).
  - The Folder path remains editable as a text field, and there is an additional “Choose folder…” mechanism that updates the field value when used.
    - The “Choose folder…” UX is implemented as a **server-backed directory picker modal** limited to an allowed base (e.g., `/data` / `HOST_INGEST_DIR`), and selecting a folder updates the text field with the server-readable path.

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

---

## Questions

1. **Mongo per-file index shape:** what exact Mongo schema do we want for the per-file index (minimum `{ root, relPath, fileHash }`; optionally `updatedAt`, `sizeBytes`, `mtimeMs`, `chunkerVersion/configHash`, `lastEmbeddedAt`) and what indexes should we add for performance?
2. **Path representation:** the current chunk metadata stores `relPath`. Is that sufficient for “path including filename”, or do we need to store additional fields (e.g., `absContainerPath`, `repo`, `hostPath`) to support future UI and tool-citation use-cases?
3. **Chunking/config versioning:** should delta logic consider a `chunkerVersion` / `configHash` so that a re-ingest can be forced even when `fileHash` is unchanged but chunking rules change?
4. **Cancellation semantics:** if a re-ingest is “in-place” (updating vectors for a root), how do we ensure cancel does not leave the root in a mixed state? (Options: stage changes under a runId, then “swap” on completion; or accept eventual consistency with per-file deletes/adds.)
5. **Model lock + delta:** should a delta re-ingest be allowed only when the locked embedding model matches, or do we ever support migrating embeddings to a new model (likely out of scope for v1)?
6. **Directory picker details:** what is the allowed base (default `/data` vs `HOST_INGEST_DIR`), do we support browsing multiple bases, and how do we present/validate container-path vs host-path expectations in the UI copy?
7. **Performance constraints:** what folder sizes/repos are the target? This affects whether scanning Chroma metadatas is acceptable or whether we must add the per-file index collection.
8. **Backward compatibility:** agreed: re-ingest auto-upgrades legacy roots during the first delta run. If there is no Mongo per-file index data for that root, remove all vectors for the root prior to re-ingesting, and populate the per-file index as part of that run.

---

# Tasks

(Not yet created — this story is still in the “Description/Acceptance Criteria/Out Of Scope/Questions” phase.)
