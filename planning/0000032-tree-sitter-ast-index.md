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

### 1. Server: AST Mongo schemas

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Create Mongo collections for AST symbols, edges, references, module imports, and coverage with the required indexes.

#### Documentation Locations

- Mongoose schema guide (define AST collection fields + indexes): https://mongoosejs.com/docs/guide.html
- Mongoose 9.0.1 docs (Context7, version-aligned index behavior): /automattic/mongoose/9.0.1
- MongoDB indexes reference (unique/compound index options): https://www.mongodb.com/docs/manual/indexes/
- Node.js test runner (unit tests for schema/index expectations): https://nodejs.org/api/test.html
- TypeScript handbook (shared types for schema models): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Review existing ingest file schema patterns:
   - Documentation to read (repeat):
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
   - Files to read:
     - `server/src/mongo/ingestFile.ts`
     - `server/src/test/unit/ingest-files-schema.test.ts`
   - Notes:
     - Confirm how collection names, timestamps, and indexes are defined.
2. [ ] Add AST Mongo schema models:
   - Documentation to read (repeat):
     - MongoDB indexes: https://www.mongodb.com/docs/manual/indexes/
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
   - Files to edit:
     - `server/src/mongo/astSymbol.ts` (new)
     - `server/src/mongo/astEdge.ts` (new)
     - `server/src/mongo/astReference.ts` (new)
     - `server/src/mongo/astModuleImport.ts` (new)
     - `server/src/mongo/astCoverage.ts` (new)
   - Implementation details:
     - Match field names + indexes exactly from Message Contracts (`ast_symbols`, `ast_edges`, `ast_references`, `ast_module_imports`, `ast_coverage`).
     - Ensure `{ root, symbolId }` is unique per root for symbols.
3. [ ] Unit test — AST symbols schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-symbols-schema.test.ts` (new).
   - Description: Verify required fields, timestamps, and compound/unique indexes for `ast_symbols`.
   - Purpose: Ensure symbol storage matches the contract and prevents duplicate `symbolId`s per root.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
4. [ ] Unit test — AST edges schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-edges-schema.test.ts` (new).
   - Description: Validate required edge fields and indexes for `ast_edges`.
   - Purpose: Ensure edge lookups by root/from/to/type match the contract.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
5. [ ] Unit test — AST references schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-references-schema.test.ts` (new).
   - Description: Validate required reference fields and indexes for `ast_references`.
   - Purpose: Ensure reference queries by symbol/relPath are indexed and contract-safe.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
6. [ ] Unit test — AST module imports schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-module-imports-schema.test.ts` (new).
   - Description: Validate module import fields (source + names) and indexes for `ast_module_imports`.
   - Purpose: Ensure module import lookups by root/relPath are indexed and consistent.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
7. [ ] Unit test — AST coverage schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-coverage-schema.test.ts` (new).
   - Description: Validate coverage counts and `lastIndexedAt` fields for `ast_coverage`.
   - Purpose: Ensure coverage tracking is persisted and indexed by root.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
8. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (add AST collections summary)
9. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add new Mongo files/tests)
10. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 2. Server: AST repo helpers

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Add repo helper functions for AST collections with Mongo-disconnected guards and bulk-write patterns.

#### Documentation Locations

- Mongoose 9.0.1 docs (Context7, repo helper patterns): /automattic/mongoose/9.0.1
- MongoDB bulkWrite reference (bulk upserts for AST records): https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
- MongoDB CRUD reference (deleteMany and filtered queries): https://www.mongodb.com/docs/manual/crud/
- Node.js test runner (unit tests for repo helper guards): https://nodejs.org/api/test.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Review existing repo helper patterns:
   - Files to read:
     - `server/src/mongo/repo.ts`
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Notes:
     - Reuse the existing `mongoose.connection.readyState` guard + bulkWrite pattern (do not introduce a new DB access layer).
   - Documentation to read (repeat):
     - Mongoose 9.0.1 guide (Context7): /automattic/mongoose/9.0.1
     - MongoDB bulkWrite: https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
2. [ ] Add AST repo helpers:
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Implementation details:
     - Add list/upsert/clear helpers for symbols, edges, references, module imports, and coverage.
     - Prefer bulkWrite for symbol/edge/reference upserts and deleteMany for clears.
   - Documentation to read (repeat):
     - Mongoose 9.0.1 guide (Context7): /automattic/mongoose/9.0.1
     - MongoDB bulkWrite: https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
3. [ ] Unit tests — repo helpers return null when Mongo is disconnected:
   - Test type: Unit (repo helpers).
   - Test location: `server/src/test/unit/ast-repo-guards.test.ts` (new).
   - Description: Exercise AST repo helpers with `mongoose.connection.readyState !== 1`.
   - Purpose: Ensure AST helper functions short-circuit and do not attempt writes when Mongo is down.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Assertions:
     - Helper functions short-circuit without hitting model methods.
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (add AST repo helper notes)
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add any new tests)
6. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 3. Server: Tree-sitter dependencies + Docker build support

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Add Tree-sitter dependencies and ensure Docker builds can compile native bindings.

#### Documentation Locations

- Node Tree-sitter bindings (Node API + native build notes): https://tree-sitter.github.io/node-tree-sitter/index.html
- tree-sitter-javascript README (JS grammar package details): https://github.com/tree-sitter/tree-sitter-javascript
- tree-sitter-typescript README (TS/TSX grammar package details): https://github.com/tree-sitter/tree-sitter-typescript
- node-gyp build prerequisites (native addon toolchain): https://github.com/nodejs/node-gyp
- Dockerfile reference (build stages + package install): https://docs.docker.com/engine/reference/builder/
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Add Tree-sitter dependencies:
   - Documentation to read (repeat):
     - Node Tree-sitter bindings: https://tree-sitter.github.io/node-tree-sitter/index.html
     - tree-sitter-javascript README: https://github.com/tree-sitter/tree-sitter-javascript
     - tree-sitter-typescript README: https://github.com/tree-sitter/tree-sitter-typescript
     - node-gyp build prerequisites: https://github.com/nodejs/node-gyp
   - Files to edit:
     - `server/package.json`
     - `package-lock.json`
   - Dependencies:
     - `tree-sitter`
     - `tree-sitter-javascript`
     - `tree-sitter-typescript`
2. [ ] Ensure Docker build can compile native Tree-sitter bindings:
   - Documentation to read (repeat):
     - node-gyp build prerequisites: https://github.com/nodejs/node-gyp
     - Dockerfile reference (build stage tooling): https://docs.docker.com/engine/reference/builder/
     - Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
   - Files to edit:
     - `server/Dockerfile`
   - Implementation details:
     - Install build essentials in the deps stage (e.g., `python3`, `make`, `g++`) before `npm ci`.
3. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (dependency/build prerequisites)
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (note Dockerfile changes if listed)
5. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build`)
4. [ ] Prove docker compose starts (`npm run compose:up`)

#### Implementation notes

- 

---

### 4. Server: Tree-sitter parser module

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Implement a Tree-sitter parsing module that maps JS/TS/TSX source text into Symbol/Edge/Reference/Import records with deterministic `symbolId`s and 1-based ranges.

#### Documentation Locations

- Tree-sitter “Using parsers” (parser lifecycle + input handling): https://tree-sitter.github.io/tree-sitter/using-parsers
- Tree-sitter query syntax (pattern matching for tags/locals): https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
- Tree-sitter code navigation queries (tags/locals semantics): https://tree-sitter.github.io/tree-sitter/code-navigation-systems
- Tree-sitter CLI init config (tree-sitter.json query paths): https://tree-sitter.github.io/tree-sitter/cli/init.html
- Node Tree-sitter bindings (Node parser API): https://tree-sitter.github.io/node-tree-sitter/index.html
- tree-sitter-javascript README (JS grammar + queries folder): https://github.com/tree-sitter/tree-sitter-javascript
- tree-sitter-typescript README (TS/TSX grammar + queries folder): https://github.com/tree-sitter/tree-sitter-typescript
- DeepWiki: tree-sitter query system overview: https://deepwiki.com/tree-sitter/tree-sitter
- Node.js fs/promises (reading source files + queries): https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
- TypeScript handbook (parser result types): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Node.js test runner (parser unit tests): https://nodejs.org/api/test.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Review ingestion + hashing usage for file metadata alignment:
   - Files to read:
     - `server/src/ingest/hashing.ts`
     - `server/src/ingest/types.ts`
   - Notes:
     - Confirm how file hashes are computed so AST records can reuse the same hash.
   - Documentation to read (repeat):
     - Node.js fs/promises: https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
2. [ ] Add AST parsing + symbol extraction module:
   - Documentation to read (repeat):
     - Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
     - Tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
     - Tree-sitter code navigation queries: https://tree-sitter.github.io/tree-sitter/code-navigation-systems
     - Tree-sitter CLI init config (tree-sitter.json query paths): https://tree-sitter.github.io/tree-sitter/cli/init.html
     - Node Tree-sitter bindings: https://tree-sitter.github.io/node-tree-sitter/index.html
     - tree-sitter-javascript README: https://github.com/tree-sitter/tree-sitter-javascript
     - tree-sitter-typescript grammar README: https://github.com/tree-sitter/tree-sitter-typescript
   - Files to edit:
     - `server/src/ast/parser.ts` (new)
     - `server/src/ast/types.ts` (new)
   - Implementation details:
     - Export `parseAstSource({ root, text, relPath, fileHash })` returning `{ language, symbols, edges, references, imports }`.
     - Load JS/TS/TSX grammars and select parser by file extension (use `tree-sitter-typescript`.typescript and `.tsx` for TS/TSX).
    - Load `queries/tags.scm` / `queries/locals.scm` by reading the grammar package files (via `tree-sitter.json` or direct `queries/` paths) instead of assuming exported constants.
    - If query files are missing, mark the file as `failed` and log once per run (do not add custom AST walking as a fallback).
     - Constrain symbol kinds to the Option B list: `Module`, `Class`, `Function`, `Method`, `Interface`, `TypeAlias`, `Enum`, `Property`.
     - Constrain edge types to `DEFINES`, `CALLS`, `IMPORTS`, `EXPORTS`, `EXTENDS`, `IMPLEMENTS`, `REFERENCES_TYPE`.
     - Convert Tree-sitter `row`/`column` to 1-based `range`.
     - Generate deterministic `symbolId` from `{ root, relPath, kind, name, range }` and handle collisions with a stable suffix.
     - Populate `container` for child symbols where a parent name or symbol id is available.
     - Return `imports` data shaped for `ModuleImportsRecord` and `references` data shaped for `ReferenceRecord`.
     - Create a `Module` symbol per file to anchor IMPORTS/EXPORTS edges.
     - Treat `tree.rootNode.hasError` as a parse failure and surface it as `failed` output.
     - Keep parsing errors isolated to the file being parsed (return a failure result, do not throw).
3. [ ] Unit test — parser extracts symbols/edges for TS/TSX:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse sample `.ts` and `.tsx` sources with classes, functions, and exports.
   - Purpose: Verify symbol kinds/names and 1-based ranges in the happy path.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] Unit test — parser returns stable `symbolId` values:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Run the same source through the parser twice.
   - Purpose: Ensure deterministic `symbolId` generation for re-embed linking.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
5. [ ] Unit test — parser emits reference ranges for call sites:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse a sample function call and confirm reference range output.
   - Purpose: Ensure references are captured for `AstFindReferences`.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
6. [ ] Unit test — parser maps module imports:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse a file with imports and validate `{ source, names[] }` output.
   - Purpose: Ensure `AstModuleImports` can be populated from stored data.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
7. [ ] Unit test — unsupported extension returns unsupported result:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse a non-supported extension and check the returned language flag.
   - Purpose: Ensure unsupported files are skipped without crashes.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
8. [ ] Unit test — missing query files returns failed parse:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Simulate missing `tags.scm` or `locals.scm` files.
   - Purpose: Ensure parser returns a failed result without throwing.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
9. [ ] Unit test — error tree marks file as failed:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Force `rootNode.hasError === true` and validate failure output.
   - Purpose: Ensure malformed files do not crash AST indexing.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
10. [ ] Unit test — grammar load failure logs once:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Simulate grammar load failure and assert logging + failure result.
   - Purpose: Ensure consistent failure handling when parser setup fails.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
11. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (document parsing approach + query usage)
12. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add new `server/src/ast` files + tests)
13. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 5. Server: Ingest AST indexing + persistence

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Integrate AST parsing into ingest runs and persist AST data + coverage without changing existing embedding behavior.

#### Documentation Locations

- Tree-sitter “Using parsers” (per-file parse flow): https://tree-sitter.github.io/tree-sitter/using-parsers
- MongoDB CRUD reference (write/delete operations for AST records): https://www.mongodb.com/docs/manual/crud/
- Node.js fs/promises (read source files within ingest loop): https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
- Node.js test runner (unit/integration tests): https://nodejs.org/api/test.html
- Cucumber guide (server integration tests): https://cucumber.io/docs/guides/10-minute-tutorial/
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Review ingest run + delta flow paths:
   - Files to read:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ingest/deltaPlan.ts`
     - `server/src/ingest/discovery.ts`
     - `server/src/ingest/hashing.ts`
     - `server/src/ingest/types.ts`
     - `server/src/ws/server.ts`
   - Documentation to read (repeat):
     - MongoDB write operations: https://www.mongodb.com/docs/manual/crud/
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
   - Documentation to read (repeat):
     - Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
     - MongoDB write operations: https://www.mongodb.com/docs/manual/crud/
3. [ ] Add ingest logging for unsupported-language skips:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Log a warning with `root`, `skippedFileCount`, and up to 5 example `relPath` values.
     - Ensure log message matches the acceptance criteria wording (unsupported language).
   - Documentation to read (repeat):
     - Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
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
   - Documentation to read (repeat):
     - MongoDB write operations: https://www.mongodb.com/docs/manual/crud/
5. [ ] Handle cancellation during AST indexing:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Stop processing and skip any further AST writes once cancellation is detected.
     - Clear any in-memory AST batches without attempting partial cleanup of already-written records.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
6. [ ] Unit test — ingest AST supported file counts:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Run ingest with supported `.ts/.tsx/.js/.jsx` files.
   - Purpose: Ensure `ast.supportedFileCount` increments correctly.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
7. [ ] Unit test — ingest logs unsupported-language skips:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Include unsupported files and capture the warning log.
   - Purpose: Ensure `ast.skippedFileCount` increments and warning message matches contract.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
8. [ ] Unit test — ingest parse failures increment failed count:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Force parser failures for supported files.
   - Purpose: Ensure `ast.failedFileCount` increments without aborting the run.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
9. [ ] Unit test — ingest dry-run parses without writes:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Execute ingest with `dryRun=true`.
   - Purpose: Confirm parsing occurs but AST repo write helpers are not called.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
10. [ ] Unit test — ingest cancellation stops AST work:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Trigger cancellation mid-run.
   - Purpose: Ensure parsing halts and queued writes are skipped.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
11. [ ] Unit test — Mongo disconnected skips AST writes:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Simulate `mongoose.connection.readyState !== 1`.
   - Purpose: Ensure write helpers are not called and a warning is logged.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
12. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (AST coverage + ingest persistence notes)
13. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (note any new files if added)
14. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 6. Server: Ingest status AST fields

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Extend ingest status payloads (REST + WS) with optional AST counts and update tests accordingly.

#### Documentation Locations

- Node.js test runner (unit tests around ingest status): https://nodejs.org/api/test.html
- Cucumber guide (server integration tests): https://cucumber.io/docs/guides/10-minute-tutorial/
- TypeScript handbook (update status types safely): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Extend ingest status payload with AST counts:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ws/types.ts`
   - Implementation details:
     - Add optional `ast` object per contract.
     - Ensure `ingest_snapshot` and `ingest_update` include `ast` when available.
   - Documentation to read (repeat):
     - TypeScript handbook (update `IngestJobStatus` shapes): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
2. [ ] Unit test — ingest status includes AST fields:
   - Test type: Unit (server ingest status).
   - Test location: `server/src/test/unit/ingest-status.test.ts`.
   - Description: Extend status snapshot expectations for `ast.supportedFileCount`, `skippedFileCount`, `failedFileCount`.
   - Purpose: Ensure REST status payloads include AST counts when provided.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
3. [ ] Cucumber step updates — ingest status AST fields:
   - Test type: Integration (Cucumber steps).
   - Test location: `server/src/test/steps/ingest-status.steps.ts`.
   - Description: Update step assertions to include `ast.*` fields in status responses.
   - Purpose: Keep ingest status BDD coverage aligned with the contract.
   - Documentation to read (repeat):
     - Cucumber guide (server integration tests): https://cucumber.io/docs/guides/10-minute-tutorial/
4. [ ] Feature update — ingest status AST fields:
   - Test type: Integration (Cucumber feature).
   - Test location: `server/src/test/features/ingest-status.feature`.
   - Description: Add/extend scenarios to expect AST counts in the status payload.
   - Purpose: Ensure behavior is documented and verified at the feature level.
   - Documentation to read (repeat):
     - Cucumber guide (server integration tests): https://cucumber.io/docs/guides/10-minute-tutorial/
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (extend ingest status contract)
6. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 7. Server: AST tool service

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Add AST tool validation + query services for list/find/call-graph/modules and error handling.

#### Documentation Locations

- Mongoose query docs (filtering AST symbols/edges): https://mongoosejs.com/docs/queries.html
- MongoDB CRUD reference (find + projection patterns): https://www.mongodb.com/docs/manual/crud/
- Node.js test runner (tool service unit tests): https://nodejs.org/api/test.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Review tool patterns and error mapping:
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
   - Documentation to read (repeat):
     - Mongoose queries: https://mongoosejs.com/docs/queries.html
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
   - Documentation to read (repeat):
     - Mongoose queries: https://mongoosejs.com/docs/queries.html
     - MongoDB CRUD: https://www.mongodb.com/docs/manual/crud/
3. [ ] Unit test — AST tool validation missing required fields:
   - Test type: Unit (validation).
   - Test location: `server/src/test/unit/ast-tool-validation.test.ts` (new).
   - Description: Omit required input fields for each AST tool.
   - Purpose: Ensure `VALIDATION_FAILED` is returned for invalid payloads.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] Unit test — AST tool validation limit defaults/caps:
   - Test type: Unit (validation).
   - Test location: `server/src/test/unit/ast-tool-validation.test.ts` (new).
   - Description: Provide no `limit` and an oversized `limit`.
   - Purpose: Confirm default `limit=50` and cap at `200`.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
5. [ ] Unit test — tool service repo not found:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Query with unknown repo id.
   - Purpose: Return `REPO_NOT_FOUND` without hitting AST collections.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
6. [ ] Unit test — tool service missing coverage:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Repo exists but `ast_coverage` is missing.
   - Purpose: Return `AST_INDEX_REQUIRED` to signal missing AST index.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
7. [ ] Unit test — tool service selects newest repo root:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Provide multiple roots with the same repo id.
   - Purpose: Ensure newest `lastIngestAt` root is selected.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
8. [ ] Unit test — tool service call graph depth:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Build a call chain longer than requested depth.
   - Purpose: Ensure traversal respects depth and stops correctly.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
9. [ ] Unit test — tool service module imports mapping:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Seed module import records with sources + names.
   - Purpose: Verify `AstModuleImports` shape `{ relPath, imports: [{ source, names[] }] }`.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
10. [ ] Unit test — tool service references fallback:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Query by `{ name, kind }` when `symbolId` missing.
   - Purpose: Ensure fallback reference lookup works for legacy callers.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
11. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (AST tool service behavior)
12. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add new service/test files)
13. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 8. Server: AST REST endpoints

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Expose `/tools/ast-*` REST endpoints that validate input, call the AST tool service, and return contract-shaped responses.

#### Documentation Locations

- Express 5 routing docs (Context7, version-aligned handlers): /expressjs/express/v5.1.0
- Express 5 API reference (request/response/error handling): https://expressjs.com/en/5x/api.html
- Supertest HTTP assertions (route integration tests): https://github.com/forwardemail/supertest
- Node.js test runner (integration test harness): https://nodejs.org/api/test.html
- OpenAPI 3.0 spec (update `openapi.json` schemas): https://spec.openapis.org/oas/latest.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md`, `projectStructure.md`, `openapi.json`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Add REST route handlers:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/toolsAstListSymbols.ts` (new)
     - `server/src/routes/toolsAstFindDefinition.ts` (new)
     - `server/src/routes/toolsAstFindReferences.ts` (new)
     - `server/src/routes/toolsAstCallGraph.ts` (new)
     - `server/src/routes/toolsAstModuleImports.ts` (new)
     - `server/src/index.ts`
   - Implementation details:
     - Mirror the VectorSearch route error handling (`VALIDATION_FAILED`, `REPO_NOT_FOUND`, `INGEST_REQUIRED`, `AST_INDEX_REQUIRED`).
2. [ ] Integration test — REST happy path payloads:
   - Test type: Integration (REST routes).
   - Test location: `server/src/test/integration/tools-ast.test.ts` (new).
   - Description: Stub the AST service and assert response shapes for all `/tools/ast-*` routes.
   - Purpose: Ensure contract-aligned payloads for list/find/call-graph/module-imports.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
   - Notes:
     - Mirror the existing router test patterns from `server/src/test/unit/tools-vector-search.test.ts` / `tools-ingested-repos.test.ts` when stubbing deps.
3. [ ] Integration test — REST validation errors:
   - Test type: Integration (REST routes).
   - Test location: `server/src/test/integration/tools-ast.test.ts` (new).
   - Description: Send invalid payloads for each endpoint.
   - Purpose: Verify `400` responses with `VALIDATION_FAILED` details.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] Integration test — REST error mapping:
   - Test type: Integration (REST routes).
   - Test location: `server/src/test/integration/tools-ast.test.ts` (new).
   - Description: Force `REPO_NOT_FOUND`, `INGEST_REQUIRED`, `AST_INDEX_REQUIRED` from the service.
   - Purpose: Ensure status codes + body shapes match the VectorSearch route conventions.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (REST tool contracts + error codes)
6. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add new route/test files)
7. [ ] Update documentation:
   - Documentation to read (repeat):
     - OpenAPI 3.0 spec (schema + path shape): https://spec.openapis.org/oas/latest.html
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `openapi.json` (add `/tools/ast-*` endpoints)
8. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 9. Server: MCP AST tool definitions

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Expose AST tools through the MCP JSON-RPC server with schemas aligned to the REST contracts and test coverage for tool listing and execution.

#### Documentation Locations

- MCP tool spec (schema + tool registration): https://modelcontextprotocol.io/specification
- JSON-RPC 2.0 spec (tool call envelopes/errors): https://www.jsonrpc.org/specification
- Supertest HTTP assertions (MCP integration tests): https://github.com/forwardemail/supertest
- Node.js test runner (integration tests): https://nodejs.org/api/test.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Review MCP server patterns:
   - Files to read:
     - `server/src/mcp/server.ts`
     - `server/src/test/integration/mcp-server.test.ts`
   - Documentation to read (repeat):
     - MCP tool format (schema expectations): https://modelcontextprotocol.io/specification
2. [ ] Add AST MCP tool definitions + dispatch:
   - Files to edit:
     - `server/src/mcp/server.ts`
   - Implementation details:
     - Add tool definitions for `AstListSymbols`, `AstFindDefinition`, `AstFindReferences`, `AstCallGraph`, `AstModuleImports` with input/output schemas.
     - Route `tools/call` to AST service functions and map errors to MCP `invalid params` or internal errors.
   - Documentation to read (repeat):
     - MCP tool format (schema expectations): https://modelcontextprotocol.io/specification
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
3. [ ] Integration test — MCP tools/list includes AST tools:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Call `tools/list` and verify AST tool definitions are present.
   - Purpose: Ensure AST tools are advertised to MCP clients.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] Integration test — MCP tools/call returns payload:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Stub AST service response and call each tool.
   - Purpose: Ensure MCP responses include JSON payloads with the contract shape.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
5. [ ] Integration test — MCP validation errors:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Call tools with invalid payloads.
   - Purpose: Confirm `-32602` is returned with `VALIDATION_FAILED` messaging.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
6. [ ] Integration test — MCP AST_INDEX_REQUIRED mapping:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Simulate missing coverage in the AST service.
   - Purpose: Ensure `AST_INDEX_REQUIRED` is mapped consistently with existing MCP tools.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
7. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (MCP tool list + response shapes)
8. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (update if any new test files added)
9. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 10. Client: Ingest status type updates

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Extend client ingest status types to include optional AST counts and update tests to accept the new fields.

#### Documentation Locations

- React 19 hooks reference (client state + effects): https://react.dev/reference/react
- TypeScript 5.9 release notes (type changes in client): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- Jest getting started (client unit tests): https://jestjs.io/docs/getting-started
- Testing Library intro (React test queries): https://testing-library.com/docs/react-testing-library/intro/
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Review ingest status types:
   - Files to read:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useIngestStatus.ts`
   - Documentation to read (repeat):
     - React 19 hooks reference: https://react.dev/reference/react
2. [ ] Extend ingest status types for AST counts:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useIngestStatus.ts`
   - Implementation details:
     - Add optional `ast` field with `supportedFileCount`, `skippedFileCount`, `failedFileCount`, `lastIndexedAt`.
   - Documentation to read (repeat):
     - TypeScript 5.9 release notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
3. [ ] Client tests — ingest status shape updates:
   - Test type: Unit (client hook/types).
   - Test location: `client/src/test/ingestStatus.test.tsx`.
   - Description: Ensure ingest status rendering tolerates optional `ast` fields.
   - Purpose: Prevent regressions when new AST fields are present in status payloads.
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
   - Assertions:
     - Existing ingest status tests accept optional `ast` fields without failing.
   - Documentation to read (repeat):
     - Jest (React testing): https://jestjs.io/docs/getting-started
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (client ingest status types)
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (update if tests changed)
6. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 11. Client: Ingest AST status banners

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Render non-blocking Ingest page banners for AST skipped/failed counts using existing Alert layout patterns.

#### Documentation Locations

- React 19 hooks reference (rendering conditional banners): https://react.dev/reference/react
- MUI Alert docs (MUI MCP v6.4.x, banner layout): https://llms.mui.com/material-ui/6.4.12/components/alert.md
- MUI Stack docs (MUI MCP v6.4.x, layout spacing): https://llms.mui.com/material-ui/6.4.12/components/stack.md
- MUI Typography docs (MUI MCP v6.4.x, banner text): https://llms.mui.com/material-ui/6.4.12/components/typography.md
- Testing Library intro (render + query assertions): https://testing-library.com/docs/react-testing-library/intro/
- Jest getting started (client unit tests): https://jestjs.io/docs/getting-started
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Add Ingest page banner for AST skips/failures:
   - Documentation to read (repeat):
     - MUI Alert docs (MUI MCP, v6.4.x): https://llms.mui.com/material-ui/6.4.12/components/alert.md
     - MUI Stack docs (MUI MCP, v6.4.x): https://llms.mui.com/material-ui/6.4.12/components/stack.md
     - MUI Typography docs (MUI MCP, v6.4.x): https://llms.mui.com/material-ui/6.4.12/components/typography.md
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - UI details:
     - Show a non-blocking `Alert` when `ast.skippedFileCount > 0` with message “AST indexing skipped for X file(s) (unsupported language).”
     - If `failedFileCount > 0`, show a warning/info banner noting failures and advising to check logs.
     - Reuse the existing page-level `Alert` layout patterns already used for model lock and WS status (do not introduce a new banner component).
2. [ ] Client test — skipped-language banner renders:
   - Test type: Unit (client UI).
   - Test location: `client/src/test/ingestStatus.test.tsx`.
   - Description: Provide status payload with `ast.skippedFileCount > 0`.
   - Purpose: Ensure the “unsupported language” banner renders.
   - Documentation to read (repeat):
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest (React testing): https://jestjs.io/docs/getting-started
3. [ ] Client test — failed AST banner renders:
   - Test type: Unit (client UI).
   - Test location: `client/src/test/ingestStatus.test.tsx`.
   - Description: Provide status payload with `ast.failedFileCount > 0`.
   - Purpose: Ensure the failure banner renders with guidance to check logs.
   - Documentation to read (repeat):
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest (React testing): https://jestjs.io/docs/getting-started
4. [ ] Client test — banners hidden when counts are zero/missing:
   - Test type: Unit (client UI).
   - Test location: `client/src/test/ingestStatus.test.tsx`.
   - Description: Provide status payload with `ast` missing or counts = 0.
   - Purpose: Ensure banners do not render in the normal happy path.
   - Documentation to read (repeat):
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest (React testing): https://jestjs.io/docs/getting-started
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (client ingest banner notes)
6. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (update if tests changed)
7. [ ] Run full linting:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
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

### 12. Final Task: Full verification + acceptance criteria

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Validate the full story against acceptance criteria, run full builds/tests, ensure documentation is complete, and prepare the pull request summary.

#### Documentation Locations

- Docker Compose overview (clean builds + compose up): https://docs.docker.com/compose/
- Playwright Test intro (e2e run + screenshots): https://playwright.dev/docs/intro
- Husky docs (pre-commit hooks): https://typicode.github.io/husky/
- Mermaid intro (diagram updates in `design.md`): https://mermaid.js.org/intro/
- Jest getting started (client unit tests): https://jestjs.io/docs/getting-started
- Cucumber guide (server integration tests): https://cucumber.io/docs/guides/10-minute-tutorial/
- Markdown Guide (update docs + PR summary): https://www.markdownguide.org/basic-syntax/
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Build the server
   - Documentation to read (repeat):
     - Docker Compose overview (clean builds + compose up): https://docs.docker.com/compose/
2. [ ] Build the client
   - Documentation to read (repeat):
     - Docker Compose overview (clean builds + compose up): https://docs.docker.com/compose/
3. [ ] perform a clean docker build
   - Documentation to read (repeat):
     - Docker Compose overview (clean builds + compose up): https://docs.docker.com/compose/
4. [ ] Ensure Readme.md is updated with any required description changes and with any new commands that have been added as part of this story
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
5. [ ] Ensure Design.md is updated with any required description changes including mermaid diagrams that have been added as part of this story
   - Documentation to read (repeat):
     - Mermaid intro (diagram updates in `design.md`): https://mermaid.js.org/intro/
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
6. [ ] Ensure projectStructure.md is updated with any updated, added or removed files & folders
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/

#### Testing

1. [ ] run the client jest tests
   - Documentation to read (repeat):
     - Jest getting started (client unit tests): https://jestjs.io/docs/getting-started
2. [ ] run the server cucumber tests
   - Documentation to read (repeat):
     - Cucumber guide (server integration tests): https://cucumber.io/docs/guides/10-minute-tutorial/
3. [ ] restart the docker environment
   - Documentation to read (repeat):
     - Docker Compose overview (clean builds + compose up): https://docs.docker.com/compose/
4. [ ] run the e2e tests
   - Documentation to read (repeat):
     - Playwright Test intro (e2e run + screenshots): https://playwright.dev/docs/intro
5. [ ] use the playwright mcp tool to ensure manually check the application, saving screenshots to ./test-results/screenshots/ - Each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot
   - Documentation to read (repeat):
     - Playwright Test intro (e2e run + screenshots): https://playwright.dev/docs/intro

#### Implementation notes

- 
