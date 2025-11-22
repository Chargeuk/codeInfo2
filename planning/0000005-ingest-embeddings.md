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

## Out Of Scope

- Authentication/authorization around ingest operations.
- UI progress bars beyond simple status text.
- Multi-tenant Chroma collections or separate DB instances per repo.
- Advanced chunking heuristics (AST-level per-language) beyond basic class/function boundary detection and size fallback.

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

## Tasks (stubs to be detailed later)

### 1. Ingest Foundations (stub)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Placeholder for defining server/API, embedding flow, and data model tasks.

#### Documentation Locations

- To be filled when scoping.

#### Subtasks

1. [ ] Define subtasks and tests for ingest foundations.

#### Testing

1. [ ] Define testing approach.

#### Implementation notes

- TBD.

---

### 2. Ingest UI (stub)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Placeholder for UI wiring, model dropdown, folder input, and progress/error surfacing.

#### Documentation Locations

- To be filled when scoping.

#### Subtasks

1. [ ] Define subtasks and tests for UI.

#### Testing

1. [ ] Define testing approach.

#### Implementation notes

- TBD.

---

### 3. Ingest Maintenance (stub)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Placeholder for re-embed/diffing, deletion by metadata, and cleanup flows.

#### Documentation Locations

- To be filled when scoping.

#### Subtasks

1. [ ] Define subtasks and tests for maintenance flows.

#### Testing

1. [ ] Define testing approach.

#### Implementation notes

- TBD.

---

### [N]. Final Task (stub)

- status: __to_do__
- Git Commits: __to_do__

#### Overview

Placeholder for final verification once tasks are detailed.

#### Documentation Locations

- To be filled when scoping.

#### Subtasks

1. [ ] Define final verification steps.

#### Testing

1. [ ] Define final testing steps.

#### Implementation notes

- TBD.

---
