# Story 0000032 - Tree-sitter AST indexing for ingest

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today, CodeInfo2 only builds vector embeddings for repositories and relies on text chunking for search. This makes the AI great at semantic search but weaker at answering precise structural questions such as “where is this function defined?” or “what calls this method?”.

We want to add a Tree-sitter powered AST indexing pipeline that runs whenever a user ingests or re-embeds a repository **if the language is supported** (initial support: TypeScript/JavaScript). The system should build a structured symbol map (modules, classes, functions, methods, imports/exports, and call edges) and store it for fast structural queries via MCP tools. If an unsupported language is detected, the server should log a warning and the Ingest page should show an information banner explaining that AST indexing was skipped.

This phase focuses on Tree-sitter parsing and AST indexing only (no knowledge graph or vector embedding of AST artifacts yet).

AST indexing must reuse the existing ingest discovery/config rules (include/exclude, text/binary detection) and file hashing so the same files are parsed and the same hash keys are used for delta re-embed.

Note: Cross-repository symbol linking (e.g., linking imports in repo A to an ingested repo B like BabylonJS) is intentionally deferred to a later story.

---

## Acceptance Criteria

- Ingest `start` and `reembed` runs attempt Tree-sitter AST indexing for supported file types: `.ts`, `.tsx`, `.js`, `.jsx`.
- Unsupported files are skipped **per file** (not per repo); a warning log includes the root, skipped file count, and example paths, and the Ingest UI shows a non-blocking banner with the skipped count and reason (“unsupported language”).
- AST indexing is additive: vector embeddings, ingest status counts, and model locking behavior remain unchanged when AST indexing is enabled.
- Indexing respects ingest include/exclude rules and file hashes; unchanged files (same hash as last AST index) are not re-parsed and keep their existing AST records.
- Server-side parsing uses the Node.js Tree-sitter bindings (`tree-sitter` npm package) with the official grammars for JavaScript and TypeScript/TSX (`tree-sitter-javascript`, `tree-sitter-typescript`).
- AST artifacts are stored in Mongo using shared collections keyed by `root + relPath + fileHash` (no per-root collections).
- Each stored symbol record includes: `root`, `relPath`, `fileHash`, `language`, `kind`, `name`, `range` (start/end line+column), and optional `container` (parent symbol id or name).
- Each symbol has a deterministic `symbolId` derived from stable fields (root + relPath + kind + name + range) so edges can be re-linked on re-embed.
- Each stored edge record includes: `root`, `fromSymbolId`, `toSymbolId`, `type`, and the `relPath`/`fileHash` that produced it.
- The system records AST coverage per ingest root with: `supportedFileCount`, `skippedFileCount`, `failedFileCount`, and `lastIndexedAt`.
- Dry-run ingest performs the full AST parse and produces counts, but does **not** persist symbol/edge records.
- AST index schema (Option B): symbols include `Module`, `Class`, `Function`, `Method`, `Interface`, `TypeAlias`, `Enum`, `Property`; edges include `DEFINES`, `CALLS`, `IMPORTS`, `EXPORTS`, `EXTENDS`, `IMPLEMENTS`, `REFERENCES_TYPE`.
- When the grammar provides Tree-sitter query files (e.g., `queries/tags.scm`), those are used for definitions and references instead of custom ad-hoc AST walking.
- MCP tools (Option B) are available for supported repositories and return JSON with file paths + ranges:
  - `AstListSymbols` returns an array of symbol records.
  - `AstFindDefinition` returns a single symbol record (or empty result when not found).
  - `AstFindReferences` returns an array of `{ relPath, range, symbolId? }` references.
  - `AstCallGraph` returns `{ nodes: symbol[], edges: edge[] }` for the requested entry point.
  - `AstModuleImports` returns `{ modules: [{ relPath, imports: [{ source, names[] }] }] }`.
- REST endpoints mirror MCP tools using `/tools/ast-*` and the same request/response payloads (JSON schema parity with MCP output schemas).

---

## Message Contracts & Storage Shapes

### Updated Ingest Status Contract (REST + WS)

- Extend `IngestJobStatus` (used by `GET /ingest/status/:runId`, `ingest_snapshot`, `ingest_update`) with an optional `ast` object:
  - `ast?: { supportedFileCount: number; skippedFileCount: number; failedFileCount: number; lastIndexedAt?: string }`.
  - `lastIndexedAt` is ISO-8601, present only when at least one file was parsed.
  - `repository`/`root` in all AST tool calls refers to the same repo id returned by `ListIngestedRepositories` (derived from the ingest root metadata).

### New MCP + REST Tool Contracts (mirrors VectorSearch pattern)

- MCP tool names use PascalCase to match existing tools: `AstListSymbols`, `AstFindDefinition`, `AstFindReferences`, `AstCallGraph`, `AstModuleImports`.
- REST endpoints use `/tools/ast-*` with the same request/response payloads.
- `limit` defaults to `50` and caps at `200` across list/search style endpoints.

- `AstListSymbols` (MCP) + `POST /tools/ast-list-symbols` (REST)
  - Request: `{ repository: string; kinds?: string[]; limit?: number }`
  - Response: `{ symbols: SymbolRecord[] }`
- `AstFindDefinition` + `POST /tools/ast-find-definition`
  - Request: `{ repository: string; symbolId?: string; name?: string; kind?: string }`
  - Response: `{ symbol: SymbolRecord | null }`
- `AstFindReferences` + `POST /tools/ast-find-references`
  - Request: `{ repository: string; symbolId?: string; name?: string; kind?: string }`
  - Response: `{ references: ReferenceRecord[] }`
- `AstCallGraph` + `POST /tools/ast-call-graph`
  - Request: `{ repository: string; symbolId: string; depth?: number }`
  - Response: `{ nodes: SymbolRecord[]; edges: EdgeRecord[] }`
- `AstModuleImports` + `POST /tools/ast-module-imports`
  - Request: `{ repository: string; relPath?: string }`
  - Response: `{ modules: ModuleImportsRecord[] }`

Shared record shapes (all responses):

- `SymbolRecord`: `{ symbolId, root, relPath, fileHash, language, kind, name, range, container? }`
- `ReferenceRecord`: `{ relPath, range, symbolId? }`
- `EdgeRecord`: `{ root, relPath, fileHash, fromSymbolId, toSymbolId, type }`
- `ModuleImportsRecord`: `{ relPath, imports: [{ source, names[] }] }`
- `range` uses `{ start: { line, column }, end: { line, column } }` with **1-based** line/column (Tree-sitter rows/columns + 1).

Error model mirrors VectorSearch (`VALIDATION_FAILED`, `REPO_NOT_FOUND`, `INGEST_REQUIRED`), plus a new `AST_INDEX_REQUIRED` (409) when a repo has no AST data.

### New Mongo Collections

- `ast_symbols`
  - Fields: `root`, `relPath`, `fileHash`, `language`, `kind`, `name`, `range`, `container?`, `symbolId`, `createdAt`, `updatedAt`.
  - Indexes: `{ root: 1, relPath: 1, fileHash: 1 }`, `{ root: 1, symbolId: 1 }` (unique per root), `{ root: 1, kind: 1 }`.
- `ast_edges`
  - Fields: `root`, `relPath`, `fileHash`, `fromSymbolId`, `toSymbolId`, `type`, `createdAt`.
  - Indexes: `{ root: 1, fromSymbolId: 1 }`, `{ root: 1, toSymbolId: 1 }`, `{ root: 1, relPath: 1, fileHash: 1 }`.
- `ast_coverage`
  - Fields: `root`, `supportedFileCount`, `skippedFileCount`, `failedFileCount`, `lastIndexedAt`, `createdAt`, `updatedAt`.
  - Indexes: `{ root: 1 }` (unique).

---

## Out Of Scope

- Knowledge graph storage and graph query tooling.
- Embedding AST artifacts into the vector database.
- Support for languages beyond TypeScript/JavaScript in this phase.
- UI changes outside the Ingest page banner.
- Automatic fixes for unsupported languages or missing grammars.
- Cross-repository symbol linking or dependency resolution between multiple ingested repos.
- Browser/WASM parsing via `web-tree-sitter` (server indexing uses native Node bindings only).

---

## Questions

- None.

---

## Implementation Ideas

- Hook AST parsing into `server/src/ingest/ingestJob.ts` inside the per-file loop so it runs for both `start` and `reembed`, and reuse `dryRun` to skip Mongo writes while still computing counts.
- Reuse ingest discovery + hashing (`server/src/ingest/discovery.ts`, `server/src/ingest/hashing.ts`) so AST indexing sees the same files and file hashes as vector indexing and delta re-embed.
- Use the Node `tree-sitter` bindings with `tree-sitter-javascript` and `tree-sitter-typescript` grammars; load the grammar’s `TAGGING_QUERY`/`LOCALS_QUERY` (when provided) to extract definitions/references rather than writing bespoke AST walkers.
- Add Mongo collections for AST symbols/edges keyed by `root + relPath + fileHash`; store deterministic `symbolId` to make edges stable across re-embeds.
- Mirror the existing tools pattern (`server/src/mcp/server.ts` + `/tools/*` routes) with new MCP tool definitions and REST endpoints that return schema-aligned payloads for list symbols, find definition/references, call graph, and module imports.
- Surface skipped-language counts in the ingest status payload and render the non-blocking banner in the Ingest page (follow the existing alert patterns in `client/src/pages/IngestPage.tsx`).

---

## Edge Cases and Failure Modes

- **Parse failures per file**: Tree-sitter may throw or return an error tree for malformed files. Mark these files in `ast.failedFileCount`, skip writes for that file, and continue the run.
- **Missing or incompatible grammar**: If the JS/TS grammar fails to load or a grammar version mismatch occurs, log a warning and treat all supported files as failed (no crash).
- **Mixed-language repos**: Only supported files are parsed; unsupported files increment `skippedFileCount` and do not fail the run.
- **Dry-run ingest**: AST parsing still happens and counts update, but no Mongo writes are performed; counts still appear in status payloads and logs.
- **Re-embed with no file changes**: Delta path should skip AST re-indexing just like embeddings; return `skipped` if no AST work is required.
- **Mongo unavailable**: AST writes should be skipped with a warning, and the run should complete (matching existing degraded behavior when Mongo is down).
- **Ingest canceled mid-run**: Ensure any in-flight AST batch writes are aborted and the run exits cleanly with `cancelled` state.
- **Symbol id collisions**: If two symbols resolve to the same `symbolId`, log it and suffix with a counter or hash of the node range to keep the record unique.

---

# Implementation Plan

## Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks.
This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

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
- Mixed-language repos: AST indexing runs for all supported files and skips only unsupported files.
