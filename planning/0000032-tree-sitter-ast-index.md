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

- Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
- Mongoose 9.0.1 guide (Context7): /automattic/mongoose/9.0.1
- MongoDB indexes: https://www.mongodb.com/docs/manual/indexes/
- Node.js test runner: https://nodejs.org/api/test.html
- TypeScript handbook (types): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (overview): https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

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
3. [ ] Unit tests — schema + index coverage:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
   - Files to edit:
     - `server/src/test/unit/ast-symbols-schema.test.ts` (new)
     - `server/src/test/unit/ast-edges-schema.test.ts` (new)
     - `server/src/test/unit/ast-references-schema.test.ts` (new)
     - `server/src/test/unit/ast-module-imports-schema.test.ts` (new)
     - `server/src/test/unit/ast-coverage-schema.test.ts` (new)
   - Assertions:
     - Required fields exist.
     - Indexes match the contract (including uniqueness where required).
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (add AST collections summary)
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add new Mongo files/tests)
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

### 2. Server: AST repo helpers

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Add repo helper functions for AST collections with Mongo-disconnected guards and bulk-write patterns.

#### Documentation Locations

- Mongoose 9.0.1 guide (Context7): /automattic/mongoose/9.0.1
- MongoDB bulkWrite: https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
- Node.js test runner: https://nodejs.org/api/test.html
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (overview): https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

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
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ast-repo-guards.test.ts` (new)
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

- Node Tree-sitter bindings: https://tree-sitter.github.io/node-tree-sitter/index.html
- node-gyp build prerequisites: https://github.com/nodejs/node-gyp
- Docker/Compose: Context7 `/docker/docs`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Markdown Guide: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Add Tree-sitter dependencies:
   - Documentation to read (repeat):
     - Node Tree-sitter bindings: https://tree-sitter.github.io/node-tree-sitter/index.html
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
     - Docker/Compose: Context7 `/docker/docs`
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

- Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
- Node Tree-sitter bindings: https://tree-sitter.github.io/node-tree-sitter/index.html
- tree-sitter-javascript grammar README: https://github.com/tree-sitter/tree-sitter-javascript
- tree-sitter-typescript grammar README: https://github.com/tree-sitter/tree-sitter-typescript
- Tree-sitter query files + tags metadata (tree-sitter.json): https://docs.rs/crate/tree-sitter-javascript/0.25.0/source/tree-sitter.json
- node-gyp build prerequisites: https://github.com/nodejs/node-gyp
- Tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
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
   - Documentation to read (repeat):
     - Node.js fs/promises: https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
2. [ ] Add AST parsing + symbol extraction module:
   - Documentation to read (repeat):
     - Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
     - Node Tree-sitter bindings: https://tree-sitter.github.io/node-tree-sitter/index.html
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
3. [ ] Unit tests — parser extracts expected symbols/edges:
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
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (document parsing approach + query usage)
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add new `server/src/ast` files + tests)
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

### 5. Server: Ingest AST indexing + persistence

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Integrate AST parsing into ingest runs and persist AST data + coverage without changing existing embedding behavior.

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
6. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (AST coverage + ingest persistence notes)
7. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (note any new files if added)
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

- Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
- Node.js test runner: https://nodejs.org/api/test.html
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides (overview): https://cucumber.io/docs/guides/
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

#### Subtasks

1. [ ] Extend ingest status payload with AST counts:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ws/types.ts`
   - Implementation details:
     - Add optional `ast` object per contract.
     - Ensure `ingest_snapshot` and `ingest_update` include `ast` when available.
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
2. [ ] Update server tests for the new `ast` status fields:
   - Files to edit:
     - `server/src/test/unit/ingest-status.test.ts`
     - `server/src/test/steps/ingest-status.steps.ts`
     - `server/src/test/features/ingest-status.feature`
   - Assertions:
     - Status snapshots include `ast.supportedFileCount`, `skippedFileCount`, `failedFileCount`.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Cucumber guides (overview): https://cucumber.io/docs/guides/
3. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (extend ingest status contract)
4. [ ] Run full linting:
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

- Mongoose queries: https://mongoosejs.com/docs/queries.html
- MongoDB CRUD: https://www.mongodb.com/docs/manual/crud/
- Node.js test runner: https://nodejs.org/api/test.html
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
3. [ ] Unit tests — AST tool validation:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ast-tool-validation.test.ts` (new)
   - Assertions:
     - Missing required fields return `VALIDATION_FAILED`.
     - `limit` defaults to 50 and caps at 200.
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (AST tool service behavior)
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add new service/test files)
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

### 8. Server: AST REST endpoints

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Expose `/tools/ast-*` REST endpoints that validate input, call the AST tool service, and return contract-shaped responses.

#### Documentation Locations

- Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
- Express 5 API reference: https://expressjs.com/en/5x/api.html
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
2. [ ] Integration tests — REST endpoints:
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/integration/tools-ast.test.ts` (new)
   - Assertions:
     - Each endpoint returns contract-shaped payloads when the service is stubbed.
     - Validation errors return `400` with details.
   - Notes:
     - Mirror the existing router test patterns from `server/src/test/unit/tools-vector-search.test.ts` / `tools-ingested-repos.test.ts` when stubbing deps.
3. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (REST tool contracts + error codes)
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (add new route/test files)
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `openapi.json` (add `/tools/ast-*` endpoints)
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

### 9. Server: MCP AST tool definitions

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
3. [ ] Integration tests — MCP tool list + call:
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/integration/mcp-server.test.ts`
   - Assertions:
     - `tools/list` includes AST tools.
     - `tools/call` returns JSON payload for a stubbed AST tool.
     - Validation errors return `-32602` with `VALIDATION_FAILED` message.
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (MCP tool list + response shapes)
5. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (update if any new test files added)
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

### 10. Client: Ingest status type updates

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Extend client ingest status types to include optional AST counts and update tests to accept the new fields.

#### Documentation Locations

- React 19 hooks reference: https://react.dev/reference/react
- TypeScript 5.9 release notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- Jest (React testing): https://jestjs.io/docs/getting-started
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

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

- React 19 hooks reference: https://react.dev/reference/react
- MUI Alert docs (MUI MCP, v6.4.x): https://llms.mui.com/material-ui/6.4.12/components/alert.md
- MUI Stack docs (MUI MCP, v6.4.x): https://llms.mui.com/material-ui/6.4.12/components/stack.md
- MUI Typography docs (MUI MCP, v6.4.x): https://llms.mui.com/material-ui/6.4.12/components/typography.md
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Jest (React testing): https://jestjs.io/docs/getting-started
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI: https://prettier.io/docs/cli
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Playwright: Context7 `/microsoft/playwright`
- Docker/Compose: Context7 `/docker/docs`

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
2. [ ] Client tests — banner rendering:
   - Documentation to read (repeat):
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest (React testing): https://jestjs.io/docs/getting-started
   - Files to edit:
     - `client/src/test/ingestStatus.test.tsx`
   - Assertions:
     - Banner appears when `ast.skippedFileCount > 0`.
     - Banner hidden when counts are zero or missing.
3. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `design.md` (client ingest banner notes)
4. [ ] Update documentation:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - `projectStructure.md` (update if tests changed)
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

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides https://cucumber.io/docs/guides/
- Markdown Guide: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Build the server
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
2. [ ] Build the client
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
3. [ ] perform a clean docker build
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
4. [ ] Ensure Readme.md is updated with any required description changes and with any new commands that have been added as part of this story
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
5. [ ] Ensure Design.md is updated with any required description changes including mermaid diagrams that have been added as part of this story
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
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
     - Jest: Context7 `/jestjs/jest`
2. [ ] run the server cucumber tests
   - Documentation to read (repeat):
     - Cucumber guides https://cucumber.io/docs/guides/
3. [ ] restart the docker environment
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
4. [ ] run the e2e tests
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
5. [ ] use the playwright mcp tool to ensure manually check the application, saving screenshots to ./test-results/screenshots/ - Each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

#### Implementation notes

- 
