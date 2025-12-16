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

Separately, the Ingest page UI has a couple of small usability issues:
- When the embedding model is locked, the same info notice appears twice (once on the page and once inside the form). We want to show it only once to reduce noise.
- The “Folder path” field is currently text-only; we want an optional “Choose folder…” affordance that helps users select a folder path more reliably.

This story aims to reduce re-ingest time and compute cost while keeping the ingest model lock, progress reporting, and current ingest status polling behavior intact.

---

## Acceptance Criteria

- Re-ingest supports an incremental/delta mode that:
  - Removes vectors for files that no longer exist in the folder.
  - Removes vectors for files whose content has changed (based on a file hash) and re-embeds those files.
  - Embeds and ingests files that are new (not previously present for that folder).
  - Leaves vectors for unchanged files untouched.
- Each embedded chunk has metadata sufficient to attribute it to a specific file:
  - Store a file path including filename (relative to the ingested root, or another agreed representation).
  - Store a file hash (and any other identifiers needed for diffing).
- Re-ingest remains safe/robust:
  - Cancelling a run cleans up only the in-progress vectors for that run (no partial corruption of existing unchanged vectors).
  - Concurrency is controlled (no simultaneous ingest/re-ingest against the same collections beyond existing locking rules).
  - Existing ingest status polling (`GET /ingest/status/:runId`) continues to work unchanged.
- Ingest page UX:
  - The “Embedding model locked to …” notice is shown only once (below “Start a new ingest” title, not duplicated inside the form).
  - The Folder path remains editable as a text field, and there is an additional “Choose folder…” mechanism that updates the field value when used (exact implementation depends on the chosen approach; see Questions).

---

## Out Of Scope

- Changing the ingest status transport from polling to SSE/WebSockets (status remains polling-driven).
- Cross-server coordination (delta assumes a single server process / single Chroma instance per environment).
- Sophisticated “partial file” diffs at the chunk level (v1 can treat a changed file as “delete all chunks for that file, then re-add”).
- Full “native OS folder picker that reveals absolute filesystem paths” in a standard browser environment, if it requires switching to an upload-based ingest model or a desktop wrapper (see Questions).
- Any UI redesign beyond the two specific Ingest page adjustments described above.

---

## Questions

1. **Source of truth for diffing:** should we diff by scanning existing vectors’ metadata in Chroma, or should we introduce a dedicated per-file index (e.g., a new `ingest_files` collection keyed by `{root, relPath}` with `fileHash` and timestamps) to avoid scanning all chunk metadata?
2. **Chunk IDs / update strategy:** do we want stable chunk IDs (e.g., `{root}:{relPath}:{chunkIndex}` or `chunkHash`) so we can upsert, or is the v1 strategy “delete all vectors for `{root, relPath}` then re-add” sufficient?
3. **Path representation:** the current chunk metadata stores `relPath`. Is that sufficient for “path including filename”, or do we need to store additional fields (e.g., `absContainerPath`, `repo`, `hostPath`) to support future UI and tool-citation use-cases?
4. **Chunking/config versioning:** should delta logic consider a `chunkerVersion` / `configHash` so that a re-ingest can be forced even when `fileHash` is unchanged but chunking rules change?
5. **Cancellation semantics:** if a re-ingest is “in-place” (updating vectors for a root), how do we ensure cancel does not leave the root in a mixed state? (Options: stage changes under a runId, then “swap” on completion; or accept eventual consistency with per-file deletes/adds.)
6. **Model lock + delta:** should a delta re-ingest be allowed only when the locked embedding model matches, or do we ever support migrating embeddings to a new model (likely out of scope for v1)?
7. **Folder picker UX:** do we mean:
   - a server-backed directory browser constrained to allowed roots (recommended for Docker/server-side ingest), or
   - a true browser-native folder picker (which typically implies upload-based ingest and does not provide a server-readable absolute path)?
8. **Performance constraints:** what folder sizes/repos are the target? This affects whether scanning Chroma metadatas is acceptable or whether we must add the per-file index collection.
9. **Backward compatibility:** how do we treat roots ingested before we add any new metadata fields (if any)? Should re-ingest auto-upgrade them during the first delta run?

---

# Tasks

(Not yet created — this story is still in the “Description/Acceptance Criteria/Out Of Scope/Questions” phase.)

