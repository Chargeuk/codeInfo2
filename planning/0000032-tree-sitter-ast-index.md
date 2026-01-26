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
- `ast_references`
  - Fields: `root`, `relPath`, `fileHash`, `symbolId?`, `name`, `kind?`, `range`, `createdAt`.
  - Indexes: `{ root: 1, symbolId: 1 }`, `{ root: 1, name: 1, kind: 1 }`, `{ root: 1, relPath: 1, fileHash: 1 }`.
- `ast_module_imports`
  - Fields: `root`, `relPath`, `fileHash`, `imports: [{ source, names[] }]`, `createdAt`, `updatedAt`.
  - Indexes: `{ root: 1, relPath: 1, fileHash: 1 }`, `{ root: 1, relPath: 1 }`.
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

---

### 1. Server: AST Mongo schemas + repo helpers

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Create Mongo collections for AST symbols, edges, references, module imports, and coverage, plus repo helper functions with Mongo-disconnected guards so AST indexing can store/query data safely.

#### Documentation Locations

- Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
- MongoDB indexes: https://www.mongodb.com/docs/manual/indexes/
- Node.js test runner: https://nodejs.org/api/test.html
- TypeScript handbook (types): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (overview): https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review existing ingest file schema + repo helper patterns:
   - Documentation to read (repeat):
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
   - Files to read:
     - `server/src/mongo/ingestFile.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/test/unit/ingest-files-schema.test.ts`
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Notes:
     - Confirm how collection names, timestamps, and indexes are defined.
2. [ ] Add AST Mongo schema models:
   - Documentation to read (repeat):
     - MongoDB indexes: https://www.mongodb.com/docs/manual/indexes/
   - Files to edit:
     - `server/src/mongo/astSymbol.ts` (new)
     - `server/src/mongo/astEdge.ts` (new)
     - `server/src/mongo/astReference.ts` (new)
     - `server/src/mongo/astModuleImport.ts` (new)
     - `server/src/mongo/astCoverage.ts` (new)
   - Implementation details:
     - Match field names + indexes exactly from Message Contracts (`ast_symbols`, `ast_edges`, `ast_references`, `ast_module_imports`, `ast_coverage`).
     - Ensure `{ root, symbolId }` is unique per root for symbols.
3. [ ] Add repo helpers for AST collections with Mongo guards:
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Implementation details:
     - Add list/upsert/clear helpers for symbols, edges, and coverage.
     - Add list/upsert/clear helpers for references and module imports.
     - Follow existing `readyState` guard pattern used for ingest files.
     - Prefer bulkWrite for symbol/edge upserts and deleteMany for clears.
4. [ ] Unit tests — schema + index coverage:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ast-symbols-schema.test.ts` (new)
     - `server/src/test/unit/ast-edges-schema.test.ts` (new)
     - `server/src/test/unit/ast-references-schema.test.ts` (new)
     - `server/src/test/unit/ast-module-imports-schema.test.ts` (new)
     - `server/src/test/unit/ast-coverage-schema.test.ts` (new)
   - Assertions:
     - Required fields exist.
     - Indexes match the contract (including uniqueness where required).
5. [ ] Unit tests — repo helpers return null when Mongo is disconnected:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ast-repo-guards.test.ts` (new)
   - Assertions:
     - Helper functions short-circuit without hitting model methods.
6. [ ] Update documentation:
   - `design.md` (add AST collections summary)
7. [ ] Update documentation:
   - `projectStructure.md` (add new Mongo files/tests)
8. [ ] Run full linting:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Prove docker compose starts (`npm run compose:up`)
5. [ ] Run server unit tests (`npm run test:unit --workspace server`)

#### Implementation notes

- 

---

### 2. Server: Tree-sitter parser + AST record builder

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Implement a Tree-sitter parsing module that maps JS/TS/TSX source text into Symbol/Edge records with deterministic `symbolId`s and 1-based ranges.

#### Documentation Locations

- Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
- Tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
- tree-sitter-javascript repo: https://github.com/tree-sitter/tree-sitter-javascript
- tree-sitter-typescript repo: https://github.com/tree-sitter/tree-sitter-typescript
- Node.js fs/promises: https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
- TypeScript handbook (types): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Node.js test runner: https://nodejs.org/api/test.html
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (overview): https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review ingestion + hashing usage for file metadata alignment:
   - Files to read:
     - `server/src/ingest/hashing.ts`
     - `server/src/ingest/types.ts`
   - Notes:
     - Confirm how file hashes are computed so AST records can reuse the same hash.
2. [ ] Add Tree-sitter dependencies:
   - Files to edit:
     - `server/package.json`
     - `package-lock.json`
   - Dependencies:
     - `tree-sitter`
     - `tree-sitter-javascript`
     - `tree-sitter-typescript`
3. [ ] Ensure Docker build can compile native Tree-sitter bindings:
   - Files to edit:
     - `server/Dockerfile`
   - Implementation details:
     - Install build essentials in the deps stage (e.g., `python3`, `make`, `g++`) before `npm ci`.
4. [ ] Add AST parsing + symbol extraction module:
   - Documentation to read (repeat):
     - Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
   - Files to edit:
     - `server/src/ast/parser.ts` (new)
     - `server/src/ast/types.ts` (new)
   - Implementation details:
     - Export `parseAstSource({ root, text, relPath, fileHash })` returning `{ language, symbols, edges, references, imports }`.
     - Load JS/TS/TSX grammars and select parser by file extension.
     - Load `queries/tags.scm` / `queries/locals.scm` from the grammar packages when present; use them for definitions/references before any manual AST walking.
     - Constrain symbol kinds to the Option B list: `Module`, `Class`, `Function`, `Method`, `Interface`, `TypeAlias`, `Enum`, `Property`.
     - Constrain edge types to `DEFINES`, `CALLS`, `IMPORTS`, `EXPORTS`, `EXTENDS`, `IMPLEMENTS`, `REFERENCES_TYPE`.
     - Convert Tree-sitter `row`/`column` to 1-based `range`.
     - Generate deterministic `symbolId` from `{ root, relPath, kind, name, range }` and handle collisions with a stable suffix.
     - Populate `container` for child symbols where a parent name or symbol id is available.
     - Return `imports` data shaped for `ModuleImportsRecord` and `references` data shaped for `ReferenceRecord`.
     - Create a `Module` symbol per file to anchor IMPORTS/EXPORTS edges.
     - Treat `tree.rootNode.hasError` as a parse failure and surface it as `failed` output.
     - Keep parsing errors isolated to the file being parsed (return a failure result, do not throw).
5. [ ] Unit tests — parser extracts expected symbols/edges:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ast-parser.test.ts` (new)
   - Test data:
     - Sample `.ts` + `.tsx` source strings with class, function, import/export, and call sites.
   - Assertions:
     - Symbols include expected `kind`, `name`, and 1-based ranges.
     - `symbolId` is stable across repeated runs.
     - References include expected `relPath` + range for call sites.
     - Module imports include expected `source` and imported `names`.
     - Unsupported extension returns `{ language: 'unsupported', symbols: [] }` (or equivalent).
6. [ ] Update documentation:
   - `design.md` (document parsing approach + query usage)
7. [ ] Update documentation:
   - `projectStructure.md` (add new `server/src/ast` files + tests)
8. [ ] Run full linting:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Prove docker compose starts (`npm run compose:up`)
5. [ ] Run server unit tests (`npm run test:unit --workspace server`)

#### Implementation notes

- 

---

### 3. Server: Ingest AST indexing + status payload updates

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Integrate AST parsing into ingest runs, persist AST data + coverage, and extend ingest status messages with `ast` counts so the UI can surface skipped/failed files.

#### Documentation Locations

- Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
- MongoDB write operations: https://www.mongodb.com/docs/manual/crud/
- Node.js fs/promises: https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
- Node.js test runner: https://nodejs.org/api/test.html
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (overview): https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review ingest run + delta flow paths:
   - Files to read:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ingest/deltaPlan.ts`
     - `server/src/ingest/discovery.ts`
     - `server/src/ingest/hashing.ts`
     - `server/src/ingest/types.ts`
     - `server/src/ws/server.ts`
2. [ ] Wire AST parsing into the per-file ingest loop:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Use the existing `discoverFiles` output (do not rescan) so include/exclude rules match vector ingest.
     - Parse `.ts`, `.tsx`, `.js`, `.jsx` files only; increment `skippedFileCount` for others.
     - For supported files, call the parser module and increment `supportedFileCount` / `failedFileCount` accordingly.
     - Skip writes when `dryRun` is true, but still compute counts.
     - If Mongo is disconnected, skip AST writes with a warning and continue.
     - Ensure vector ingest counts + model locking behavior are unchanged by AST indexing.
     - When grammar load fails, treat supported files as failed and log the failure once per run.
3. [ ] Add ingest logging for unsupported-language skips:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Log a warning with `root`, `skippedFileCount`, and up to 5 example `relPath` values.
     - Ensure log message matches the acceptance criteria wording (unsupported language).
4. [ ] Persist AST symbols/edges + coverage records:
   - Files to edit:
     - `server/src/mongo/repo.ts`
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - For `start`, clear any existing AST records for the root before inserting new ones.
     - For `reembed` with delta, delete AST records for deleted/changed files and upsert new records for added/changed files.
     - Persist `ast_references` and `ast_module_imports` alongside symbols/edges.
     - Ensure unchanged files keep their existing AST records (no delete for `deltaPlan.unchanged`).
     - If delta plan has no changes, skip AST re-indexing and leave existing AST records untouched.
     - Update `ast_coverage` with `supportedFileCount`, `skippedFileCount`, `failedFileCount`, and `lastIndexedAt` (ISO).
5. [ ] Handle cancellation cleanup for AST records:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Track which relPaths have been written during the run.
     - On cancel, delete AST records for those relPaths (or clear the root on `start`) to avoid partial data.
6. [ ] Extend ingest status payload with AST counts:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ws/types.ts`
   - Implementation details:
     - Add optional `ast` object per contract.
     - Ensure `ingest_snapshot` and `ingest_update` include `ast` when available.
7. [ ] Update server tests for the new `ast` status fields:
   - Files to edit:
     - `server/src/test/unit/ingest-status.test.ts`
     - `server/src/test/steps/ingest-status.steps.ts`
     - `server/src/test/features/ingest-status.feature`
   - Assertions:
     - Status snapshots include `ast.supportedFileCount`, `skippedFileCount`, `failedFileCount`.
8. [ ] Update documentation:
   - `design.md` (extend ingest status contract + AST coverage notes)
9. [ ] Update documentation:
   - `projectStructure.md` (note any new files if added)
10. [ ] Run full linting:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Prove docker compose starts (`npm run compose:up`)
5. [ ] Run server unit tests (`npm run test:unit --workspace server`)
6. [ ] Run server integration tests (`npm run test:integration --workspace server`)

#### Implementation notes

- 

---

### 4. Server: AST tool service + REST endpoints

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Add AST tool service functions and `/tools/ast-*` REST endpoints that validate input, query AST data, and return contract-shaped responses with proper error handling.

#### Documentation Locations

- Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
- Express 5 API reference: https://expressjs.com/en/5x/api.html
- Mongoose queries: https://mongoosejs.com/docs/queries.html
- MongoDB CRUD: https://www.mongodb.com/docs/manual/crud/
- Node.js test runner: https://nodejs.org/api/test.html
- Supertest HTTP assertions: https://github.com/forwardemail/supertest
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (overview): https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review tool patterns and error mapping:
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
     - `server/src/routes/toolsVectorSearch.ts`
     - `server/src/routes/toolsIngestedRepos.ts`
2. [ ] Add AST tool validation + query services:
   - Files to edit:
     - `server/src/ast/toolService.ts` (new)
   - Implementation details:
     - Implement validation for each AST tool request; apply default `limit=50` and cap at `200`.
     - Resolve repository → root using `listIngestedRepositories` to match the existing repo id contract.
     - When multiple repos share the same id, select the most recent `lastIngestAt`.
     - Return `AST_INDEX_REQUIRED` (409) when no coverage data exists for the repo.
     - Implement call graph traversal by following `CALLS` edges up to the requested depth.
     - `AstModuleImports` should map persisted import records into `{ relPath, imports: [{ source, names[] }] }`.
     - `AstFindReferences` should query `ast_references` by `symbolId` or by `{ name, kind }`.
3. [ ] Add REST route handlers:
   - Files to edit:
     - `server/src/routes/toolsAstListSymbols.ts` (new)
     - `server/src/routes/toolsAstFindDefinition.ts` (new)
     - `server/src/routes/toolsAstFindReferences.ts` (new)
     - `server/src/routes/toolsAstCallGraph.ts` (new)
     - `server/src/routes/toolsAstModuleImports.ts` (new)
     - `server/src/index.ts`
   - Implementation details:
     - Mirror the VectorSearch route error handling (`VALIDATION_FAILED`, `REPO_NOT_FOUND`, `INGEST_REQUIRED`, `AST_INDEX_REQUIRED`).
4. [ ] Integration tests — REST endpoints:
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/tools-ast.test.ts` (new)
   - Assertions:
     - Each endpoint returns contract-shaped payloads when the service is stubbed.
     - Validation errors return `400` with details.
5. [ ] Unit tests — AST tool validation:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ast-tool-validation.test.ts` (new)
   - Assertions:
     - Missing required fields return `VALIDATION_FAILED`.
     - `limit` defaults to 50 and caps at 200.
6. [ ] Update documentation:
   - `design.md` (REST tool contracts + error codes)
7. [ ] Update documentation:
   - `projectStructure.md` (add new route/service/test files)
8. [ ] Update documentation:
   - `openapi.json` (add `/tools/ast-*` endpoints)
9. [ ] Run full linting:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Prove docker compose starts (`npm run compose:up`)
5. [ ] Run server unit tests (`npm run test:unit --workspace server`)

#### Implementation notes

- 

---

### 5. Server: MCP AST tool definitions + handlers

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Expose AST tools through the MCP JSON-RPC server with schemas aligned to the REST contracts and test coverage for tool listing and execution.

#### Documentation Locations

- MCP tool format (schema expectations): https://modelcontextprotocol.io/specification
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- Node.js test runner: https://nodejs.org/api/test.html
- Supertest HTTP assertions: https://github.com/forwardemail/supertest
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (overview): https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review MCP server patterns:
   - Files to read:
     - `server/src/mcp/server.ts`
     - `server/src/test/integration/mcp-server.test.ts`
2. [ ] Add AST MCP tool definitions + dispatch:
   - Files to edit:
     - `server/src/mcp/server.ts`
   - Implementation details:
     - Add tool definitions for `AstListSymbols`, `AstFindDefinition`, `AstFindReferences`, `AstCallGraph`, `AstModuleImports` with input/output schemas.
     - Route `tools/call` to AST service functions and map errors to MCP `invalid params` or internal errors.
3. [ ] Integration tests — MCP tool list + call:
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/mcp-server.test.ts`
   - Assertions:
     - `tools/list` includes AST tools.
     - `tools/call` returns JSON payload for a stubbed AST tool.
     - Validation errors return `-32602` with `VALIDATION_FAILED` message.
4. [ ] Update documentation:
   - `design.md` (MCP tool list + response shapes)
5. [ ] Update documentation:
   - `projectStructure.md` (update if any new test files added)
6. [ ] Run full linting:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Prove docker compose starts (`npm run compose:up`)
5. [ ] Run server unit tests (`npm run test:unit --workspace server`)

#### Implementation notes

- 

---

### 6. Client: Ingest AST skip banner + type updates

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Surface AST skip/failure counts in the Ingest page by extending ingest status types and rendering a non-blocking banner when AST indexing is skipped.

#### Documentation Locations

- React hooks: https://react.dev/reference/react
- MUI Alert + Stack docs (use MUI MCP tool): `@mui/material` via MCP
- MUI Typography docs (use MUI MCP tool): `@mui/material` via MCP
- Jest (React testing): https://jestjs.io/docs/getting-started
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Review ingest status types + UI layout patterns:
   - Files to read:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useIngestStatus.ts`
     - `client/src/pages/IngestPage.tsx`
2. [ ] Extend ingest status types for AST counts:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useIngestStatus.ts`
   - Implementation details:
     - Add optional `ast` field with `supportedFileCount`, `skippedFileCount`, `failedFileCount`, `lastIndexedAt`.
3. [ ] Add Ingest page banner for AST skips/failures:
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - UI details:
     - Show a non-blocking `Alert` when `ast.skippedFileCount > 0` with message “AST indexing skipped for X file(s) (unsupported language).”
     - If `failedFileCount > 0`, show a warning/info banner noting failures and advising to check logs.
4. [ ] Client tests — banner rendering:
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
   - Assertions:
     - Banner appears when `ast.skippedFileCount > 0`.
     - Banner hidden when counts are zero or missing.
5. [ ] Update documentation:
   - `design.md` (client ingest banner notes)
6. [ ] Update documentation:
   - `projectStructure.md` (update if tests changed)
7. [ ] Run full linting:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Prove docker compose starts (`npm run compose:up`)
5. [ ] Run client unit tests (`npm run test --workspace client`)

#### Implementation notes

- 

---

### 7. Final Task: Full verification + acceptance criteria

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Validate the full story against acceptance criteria, run full builds/tests, ensure documentation is complete, and prepare the pull request summary.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] perform a clean docker build
4. [ ] Ensure Readme.md is updated with any required description changes and with any new commands that have been added as part of this story
5. [ ] Ensure Design.md is updated with any required description changes including mermaid diagrams that have been added as part of this story
6. [ ] Ensure projectStructure.md is updated with any updated, added or removed files & folders
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.

#### Testing

1. [ ] run the client jest tests
2. [ ] run the server cucumber tests
3. [ ] restart the docker environment
4. [ ] run the e2e tests
5. [ ] use the playwright mcp tool to ensure manually check the application, saving screenshots to ./test-results/screenshots/ - Each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot

#### Implementation notes

- 
