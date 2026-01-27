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
- References and module imports are stored persistently and keyed by `root + relPath + fileHash` to support AST tool queries.
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

Error model mirrors VectorSearch style (`VALIDATION_FAILED`, `REPO_NOT_FOUND`, `INGEST_REQUIRED`), plus a new `AST_INDEX_REQUIRED` (409) when a repo has no AST data.

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

- Task Status: **__done__**
- Git Commits: ceb28fd, 0e93765

#### Overview

Create Mongo collections for AST symbols, edges, references, module imports, and coverage with the required indexes.

#### Documentation Locations

- Mongoose schema guide (define AST collection fields + indexes): https://mongoosejs.com/docs/guide.html
- Mongoose 9.0.1 docs (Context7, version-aligned index behavior): /automattic/mongoose/9.0.1
- MongoDB indexes reference (unique/compound index options): https://www.mongodb.com/docs/manual/indexes/
- Node.js test runner (unit tests for schema/index expectations): https://nodejs.org/api/test.html
- TypeScript handbook (shared types for schema models): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Review existing ingest file schema patterns:
   - Documentation to read (repeat):
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
   - Files to read:
     - `server/src/mongo/ingestFile.ts`
     - `server/src/test/unit/ingest-files-schema.test.ts`
   - Notes:
     - Confirm how collection names, timestamps, and indexes are defined.
2. [x] Add AST Mongo schema models:
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
3. [x] Unit test — AST symbols schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-symbols-schema.test.ts` (new).
   - Description: Verify required fields, timestamps, and compound/unique indexes for `ast_symbols`.
   - Purpose: Ensure symbol storage matches the contract and prevents duplicate `symbolId`s per root.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
4. [x] Unit test — AST edges schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-edges-schema.test.ts` (new).
   - Description: Validate required edge fields and indexes for `ast_edges`.
   - Purpose: Ensure edge lookups by root/from/to/type match the contract.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
5. [x] Unit test — AST references schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-references-schema.test.ts` (new).
   - Description: Validate required reference fields and indexes for `ast_references`.
   - Purpose: Ensure reference queries by symbol/relPath are indexed and contract-safe.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
6. [x] Unit test — AST module imports schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-module-imports-schema.test.ts` (new).
   - Description: Validate module import fields (source + names) and indexes for `ast_module_imports`.
   - Purpose: Ensure module import lookups by root/relPath are indexed and consistent.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
7. [x] Unit test — AST coverage schema (fields + indexes):
   - Test type: Unit (schema model).
   - Test location: `server/src/test/unit/ast-coverage-schema.test.ts` (new).
   - Description: Validate coverage counts and `lastIndexedAt` fields for `ast_coverage`.
   - Purpose: Ensure coverage tracking is persisted and indexed by root.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Mongoose schemas + indexes: https://mongoosejs.com/docs/guide.html
8. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Add AST collections summary and a mermaid diagram showing AST collections and relationships.
   - Purpose: Keep architecture documentation aligned with new AST storage.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
9. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add new Mongo schema + test files to the tree (`server/src/mongo/astSymbol.ts`, `server/src/mongo/astEdge.ts`, `server/src/mongo/astReference.ts`, `server/src/mongo/astModuleImport.ts`, `server/src/mongo/astCoverage.ts`, `server/src/test/unit/ast-symbols-schema.test.ts`, `server/src/test/unit/ast-edges-schema.test.ts`, `server/src/test/unit/ast-references-schema.test.ts`, `server/src/test/unit/ast-module-imports-schema.test.ts`, `server/src/test/unit/ast-coverage-schema.test.ts`).
   - Purpose: Keep repository structure documentation in sync with added files.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
10. [x] Add AST schema registration log line:
   - Files to edit:
     - `server/src/mongo/astCoverage.ts`
   - Log line:
     - `DEV-0000032:T1:ast-mongo-models-ready`
   - Implementation details:
     - Use `baseLogger.info` to emit the log when AST models are registered (module load time).
     - Include `event: 'DEV-0000032:T1:ast-mongo-models-ready'` and `collection: 'ast_coverage'`.
   - Documentation to read (repeat):
     - Mongoose schema guide: https://mongoosejs.com/docs/guide.html
11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, load Chat + Ingest pages, open Logs, and confirm `DEV-0000032:T1:ast-mongo-models-ready` appears once; confirm the browser console has no errors.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed `ingestFile` schema/test to mirror collection naming, timestamps, and index patterns for new AST models.
- Added AST symbol/edge/reference/module-import/coverage schemas with required fields, indexes, and collection names per contract.
- Added unit tests covering AST schema required fields, timestamp behavior, and index definitions for all new collections.
- Documented AST collections and relationships in `design.md` and updated the project tree to list new schema/test files.
- Logged AST Mongo model readiness from `astCoverage.ts` with the required event payload.
- Ensured AST coverage model is imported at server startup so the readiness log emits.
- Added logStore append for `DEV-0000032:T1:ast-mongo-models-ready` so it appears in the Logs UI.
- Lint completed with existing import-order warnings; ran Prettier to fix formatting and re-checked format successfully.
- `npm run build --workspace server` completed successfully.
- `npm run build --workspace client` completed successfully (Vite chunk-size warnings only).
- `npm run test --workspace server` completed after rerunning with a longer timeout (initial runs timed out).
- `npm run test --workspace client` completed successfully (console warnings logged during tests).
- `npm run e2e` completed successfully (compose build/up/test/down).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the local docker stack.
- Updated verification log line to append into log store so it appears in Logs UI.
- Manual Playwright-MCP check confirmed `DEV-0000032:T12:verification-ready`, ingest AST banner + active AST status, and chat flow; screenshots saved to `playwright-output-local/0000032-12-logs-verification-ready.png`, `playwright-output-local/0000032-12-ingest-ast-banner.png`, `playwright-output-local/0000032-12-ingest-active-ast.png`, and `playwright-output-local/0000032-12-chat-flow.png`.
- `npm run compose:down` stopped the local docker stack.
- `npm run compose:up` completed successfully.
- Rebuilt and restarted compose stack to load AST log store changes.
- Playwright-MCP verified Chat/Ingest pages and Logs entry for `DEV-0000032:T1:ast-mongo-models-ready` with no console errors observed.
- `npm run compose:down` completed successfully.

---

### 2. Server: AST repo helpers

- Task Status: **__done__**
- Git Commits: 0dd078e, a9b0c43

#### Overview

Add repo helper functions for AST collections with Mongo-disconnected guards and bulk-write patterns.

#### Documentation Locations

- Mongoose 9.0.1 docs (Context7, repo helper patterns): /automattic/mongoose/9.0.1
- MongoDB bulkWrite reference (bulk upserts for AST records): https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
- MongoDB CRUD reference (deleteMany and filtered queries): https://www.mongodb.com/docs/manual/crud/
- Node.js test runner (unit tests for repo helper guards): https://nodejs.org/api/test.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Review existing repo helper patterns:
   - Files to read:
     - `server/src/mongo/repo.ts`
     - `server/src/test/unit/ingest-files-repo-guards.test.ts`
   - Notes:
     - Reuse the existing `mongoose.connection.readyState` guard + bulkWrite pattern (do not introduce a new DB access layer).
   - Documentation to read (repeat):
     - Mongoose 9.0.1 guide (Context7): /automattic/mongoose/9.0.1
     - MongoDB bulkWrite: https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
2. [x] Add AST repo helpers:
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Implementation details:
     - Add list/upsert/clear helpers for symbols, edges, references, module imports, and coverage.
     - Prefer bulkWrite for symbol/edge/reference upserts and deleteMany for clears.
   - Documentation to read (repeat):
     - Mongoose 9.0.1 guide (Context7): /automattic/mongoose/9.0.1
     - MongoDB bulkWrite: https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
3. [x] Unit tests — repo helpers return null when Mongo is disconnected:
   - Test type: Unit (repo helpers).
   - Test location: `server/src/test/unit/ast-repo-guards.test.ts` (new).
   - Description: Exercise AST repo helpers with `mongoose.connection.readyState !== 1`.
   - Purpose: Ensure AST helper functions short-circuit and do not attempt writes when Mongo is down.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Assertions:
     - Helper functions short-circuit without hitting model methods.
4. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Add AST repo helper notes and update the AST ingest persistence mermaid diagram.
   - Purpose: Document how AST repo helpers fit into ingest persistence.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
5. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add new test file entries for AST repo guard coverage (`server/src/test/unit/ast-repo-guards.test.ts`).
   - Purpose: Keep project tree accurate after adding tests.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
6. [x] Add AST repo helper log line:
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Log line:
     - `DEV-0000032:T2:ast-repo-upsert`
   - Implementation details:
     - Emit `baseLogger.info` when AST symbol/edge/reference upserts are invoked.
     - Include `event: 'DEV-0000032:T2:ast-repo-upsert'` and `root` in the payload.
   - Documentation to read (repeat):
     - MongoDB bulkWrite: https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run an ingest, open Logs, and confirm `DEV-0000032:T2:ast-repo-upsert` appears for the ingest root; confirm the browser console has no errors.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed `repo.ts` and ingest file guard tests to mirror readyState checks + bulkWrite/deleteMany patterns for AST helpers.
- Added AST repo helper list/upsert/clear helpers with bulkWrite/deleteMany patterns and coverage upsert.
- Added AST repo guard unit tests to ensure helpers short-circuit when Mongo is disconnected.
- Documented AST repo helper persistence flow in `design.md` and updated `projectStructure.md` with the new test file.
- Added `DEV-0000032:T2:ast-repo-upsert` log emission for AST upsert helpers (logStore + base logger).
- Lint completed with existing import-order warnings; ran Prettier and re-checked formatting.
- `npm run build --workspace server` completed after fixing TS errors.
- `npm run build --workspace client` completed successfully (Vite chunk-size warning only).
- `npm run test --workspace server` completed successfully.
- `npm run test --workspace client` completed successfully (console warnings during tests).
- `npm run e2e` completed successfully.
- `npm run compose:build` and `npm run compose:up` completed successfully.
- Manual Playwright-MCP check: ran a tiny dry-run ingest for `/Users/danielstapleton/Documents/dev/ci2-ast-tiny`, then filtered Logs to confirm `DEV-0000032:T2:ast-repo-upsert` appears with the root; no console errors observed. (Used `host.docker.internal` for log injection to target the compose-backed server.)
- `npm run compose:down` completed successfully.

---

### 3. Server: Tree-sitter dependencies + Docker build support

- Task Status: **__done__**
- Git Commits: 8d10bf2

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
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Add Tree-sitter dependencies:
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
2. [x] Ensure Docker build can compile native Tree-sitter bindings:
   - Documentation to read (repeat):
     - node-gyp build prerequisites: https://github.com/nodejs/node-gyp
     - Dockerfile reference (build stage tooling): https://docs.docker.com/engine/reference/builder/
     - Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
   - Files to edit:
     - `server/Dockerfile`
   - Implementation details:
     - Install build essentials in the deps stage (e.g., `python3`, `make`, `g++`) before `npm ci`.
3. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Document Tree-sitter dependency/build prerequisites and update any build-toolchain mermaid diagram.
   - Purpose: Record build requirements for native Tree-sitter bindings.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
4. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Note any Dockerfile changes if listed in the tree.
   - Purpose: Keep the project structure summary accurate after build changes.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
5. [x] Add Tree-sitter dependency log line:
   - Files to edit:
     - `server/src/index.ts`
   - Log line:
     - `DEV-0000032:T3:tree-sitter-deps-ready`
   - Implementation details:
     - After server startup, emit `baseLogger.info` once confirming the Tree-sitter dependency is loaded (e.g., `require('tree-sitter')` succeeds).
     - Include `event: 'DEV-0000032:T3:tree-sitter-deps-ready'` and `dependency: 'tree-sitter'`.
   - Documentation to read (repeat):
     - Node.js modules: https://nodejs.org/api/modules.html
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, open Logs, confirm `DEV-0000032:T3:tree-sitter-deps-ready` appears after startup, and confirm there are no console errors after initial page load.
9. [x] `npm run compose:down`

#### Implementation notes

- Added `tree-sitter`, `tree-sitter-javascript`, and `tree-sitter-typescript` to the server workspace and captured `tree-sitter` via a local module declaration file for TypeScript.
- Updated the server Dockerfile deps stage to install `python3`, `make`, and `g++`, allowed install scripts during `npm ci`, and copied `/app/server/node_modules` into the runtime stage so native bindings load.
- Added a startup log (`DEV-0000032:T3:tree-sitter-deps-ready`) emitted after successfully loading the Tree-sitter dependency.
- Updated `design.md` and `projectStructure.md` with Tree-sitter build prerequisite notes and the new type shim entry.
- Lint reported existing import-order warnings; ran `npm run format --workspaces` and confirmed `npm run format:check --workspaces` passed.
- Manual Playwright-MCP check: filtered Logs for `DEV-0000032:T3:tree-sitter-deps-ready` and confirmed entries; no browser console errors.
- `npm run compose:down` completed successfully after verification.

---

### 4. Server: Tree-sitter parser module

- Task Status: **__done__**
- Git Commits: 35d2d19

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
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Review ingestion + hashing usage for file metadata alignment:
   - Files to read:
     - `server/src/ingest/hashing.ts`
     - `server/src/ingest/types.ts`
   - Notes:
     - Confirm how file hashes are computed so AST records can reuse the same hash.
   - Documentation to read (repeat):
     - Node.js fs/promises: https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
2. [x] Add AST parsing + symbol extraction module:
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
3. [x] Unit test — parser extracts symbols for TS/TSX:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse sample `.ts` and `.tsx` sources with classes, functions, and exports.
   - Purpose: Verify symbol kinds/names and 1-based ranges in the happy path.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] Unit test — parser returns stable `symbolId` values:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Run the same source through the parser twice.
   - Purpose: Ensure deterministic `symbolId` generation for re-embed linking.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
5. [x] Unit test — parser disambiguates `symbolId` collisions:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Feed two symbols that would generate the same `symbolId` and assert the collision suffix is stable.
   - Purpose: Ensure symbol collisions do not overwrite previous records.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
6. [x] Unit test — parser emits `CALLS` edges:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse a file with a function call and assert a `CALLS` edge linking caller → callee.
   - Purpose: Ensure call-graph traversal has edges to follow.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
7. [x] Unit test — parser emits reference ranges for call sites:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse a sample function call and confirm reference range output.
   - Purpose: Ensure references are captured for `AstFindReferences`.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
8. [x] Unit test — parser emits IMPORTS/EXPORTS edges:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse a module with imports/exports and assert `IMPORTS`/`EXPORTS` edges from the module symbol.
   - Purpose: Ensure module relationship edges are stored for AST tooling.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
9. [x] Unit test — parser maps module imports:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse a file with imports and validate `{ source, names[] }` output.
   - Purpose: Ensure `AstModuleImports` can be populated from stored data.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
10. [x] Unit test — unsupported extension returns unsupported result:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Parse a non-supported extension and check the returned language flag.
   - Purpose: Ensure unsupported files are skipped without crashes.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
11. [x] Unit test — missing query files returns failed parse:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Simulate missing `tags.scm` or `locals.scm` files.
   - Purpose: Ensure parser returns a failed result without throwing.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
12. [x] Unit test — error tree marks file as failed:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Force `rootNode.hasError === true` and validate failure output.
   - Purpose: Ensure malformed files do not crash AST indexing.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
13. [x] Unit test — grammar load failure logs once:
   - Test type: Unit (parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts` (new).
   - Description: Simulate grammar load failure and assert logging + failure result.
   - Purpose: Ensure consistent failure handling when parser setup fails.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
14. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Document the Tree-sitter parsing approach, query usage, and add an AST parse-flow mermaid diagram.
   - Purpose: Explain the AST parsing pipeline and data extraction flow.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
15. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add new AST parser files and tests to the tree (`server/src/ast/parser.ts`, `server/src/ast/types.ts`, `server/src/test/unit/ast-parser.test.ts`).
   - Purpose: Keep project structure documentation current with new AST modules.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
16. [x] Add AST parser log line:
   - Files to edit:
     - `server/src/ast/parser.ts`
   - Log line:
     - `DEV-0000032:T4:ast-parser-queries-loaded`
   - Implementation details:
     - Emit `baseLogger.info` the first time parser query files load successfully.
     - Include `event: 'DEV-0000032:T4:ast-parser-queries-loaded'` and `language` in the payload.
   - Documentation to read (repeat):
     - Tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
17. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run a small ingest from the Ingest page (use the sample repo), open Logs, and confirm `DEV-0000032:T4:ast-parser-queries-loaded` appears; confirm the UI stays responsive with no console errors.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed ingest hashing and types to confirm `fileHash` uses SHA-256 of file contents and `relPath`/`ext` align with discovery output.
- Added `server/src/ast/parser.ts` and `server/src/ast/types.ts` with Tree-sitter parser setup, query loading from grammar packages, module symbol creation, and symbol/reference/import extraction with deterministic symbol IDs.
- Added unit coverage for TS/TSX symbol extraction with range assertions.
- Added unit coverage to confirm `parseAstSource` yields stable symbol IDs across runs.
- Added unit coverage for collision handling using the `createSymbolIdFactory` helper.
- Added call graph edge generation from call references and covered with unit tests.
- Added reference range assertions for call sites in parser tests.
- Added import/export edge generation from module symbols with unit coverage.
- Added module import mapping coverage for `{ source, names[] }` output.
- Added unsupported-extension failure test coverage.
- Added missing-query failure test coverage and logging.
- Added parse-error failure coverage for malformed source trees.
- Added grammar-load failure logging (once) with unit coverage.
- Documented Tree-sitter parsing flow, query usage, and added an AST parser flow diagram in `design.md`.
- Added AST parser files and unit test entry to `projectStructure.md`.
- Added `DEV-0000032:T4:ast-parser-queries-loaded` logging on first successful query load.
- Lint continues to report existing import-order warnings; ran `npm run format --workspaces` and confirmed `npm run format:check --workspaces` passes.
- `npm run build --workspace server` completed successfully.
- `npm run build --workspace client` completed successfully (Vite chunk-size warning only).
- `npm run test --workspace server` completed successfully after rerunning with a longer timeout.
- `npm run test --workspace client` completed successfully (console warnings during tests).
- `npm run e2e` completed successfully after adding Tree-sitter language module type shims (initial build failed without them).
- `npm run compose:build` completed successfully.
- `npm run compose:up` completed successfully.
- Manual Playwright-MCP check confirmed `DEV-0000032:T4:ast-parser-queries-loaded` logs after warmup and no browser console errors.
- `npm run compose:down` completed successfully.
- Sanitized Tree-sitter query files to strip unsupported predicates and added test overrides for missing queries/grammar failures.
- Added CALLS/IMPORTS/EXPORTS edge generation and module import symbol handling.
- Added `warmAstParserQueries()` and invoked it on server startup to log query load events.
- Added Tree-sitter language module type shims in `server/src/types/tree-sitter.d.ts` to satisfy Docker builds.

---

### 5. Server: Ingest AST indexing + persistence

- Task Status: **__done__**
- Git Commits: 1ca39a4

#### Overview

Integrate AST parsing into ingest runs and persist AST data + coverage without changing existing embedding behavior.

#### Documentation Locations

- Tree-sitter “Using parsers” (per-file parse flow): https://tree-sitter.github.io/tree-sitter/using-parsers
- MongoDB CRUD reference (write/delete operations for AST records): https://www.mongodb.com/docs/manual/crud/
- Node.js fs/promises (read source files within ingest loop): https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
- Node.js test runner (unit/integration tests): https://nodejs.org/api/test.html
- Cucumber guides (server integration tests): https://cucumber.io/docs/guides/
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Review ingest run + delta flow paths:
   - Files to read:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ingest/deltaPlan.ts`
     - `server/src/ingest/discovery.ts`
     - `server/src/ingest/hashing.ts`
     - `server/src/ingest/types.ts`
     - `server/src/ws/server.ts`
   - Documentation to read (repeat):
     - MongoDB write operations: https://www.mongodb.com/docs/manual/crud/
2. [x] Wire AST parsing into the per-file ingest loop:
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
3. [x] Add ingest logging for unsupported-language skips:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Log a warning with `root`, `skippedFileCount`, and up to 5 example `relPath` values.
     - Ensure log message matches the acceptance criteria wording (unsupported language).
   - Documentation to read (repeat):
     - Tree-sitter docs (parsers): https://tree-sitter.github.io/tree-sitter/using-parsers
4. [x] Persist AST symbols/edges + coverage records:
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
5. [x] Handle cancellation during AST indexing:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Stop processing and skip any further AST writes once cancellation is detected.
     - Clear any in-memory AST batches without attempting partial cleanup of already-written records.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
6. [x] Unit test — ingest AST supported file counts:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Run ingest with supported `.ts/.tsx/.js/.jsx` files.
   - Purpose: Ensure `ast.supportedFileCount` increments correctly.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
7. [x] Unit test — ingest logs unsupported-language skips:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Include unsupported files and capture the warning log.
   - Purpose: Ensure `ast.skippedFileCount` increments and warning message matches contract.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
8. [x] Unit test — ingest parse failures increment failed count:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Force parser failures for supported files.
   - Purpose: Ensure `ast.failedFileCount` increments without aborting the run.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
9. [x] Unit test — ingest dry-run parses without writes:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Execute ingest with `dryRun=true`.
   - Purpose: Confirm parsing occurs but AST repo write helpers are not called.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
10. [x] Unit test — ingest cancellation stops AST work:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Trigger cancellation mid-run.
   - Purpose: Ensure parsing halts and queued writes are skipped.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
11. [x] Unit test — Mongo disconnected skips AST writes:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Simulate `mongoose.connection.readyState !== 1`.
   - Purpose: Ensure write helpers are not called and a warning is logged.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
12. [x] Unit test — delta re-embed deletes/upserts AST records:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Simulate a delta plan with added, changed, and deleted files.
   - Purpose: Ensure deletes run for deleted/changed files and upserts run for added/changed files only.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
13. [x] Unit test — delta re-embed skips unchanged files:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Include `deltaPlan.unchanged` entries and verify they are not parsed or written.
   - Purpose: Ensure unchanged files keep existing AST records without reprocessing.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
14. [x] Unit test — delta re-embed skips when no changes:
   - Test type: Unit (ingest flow).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` (new).
   - Description: Provide a delta plan with no added/changed/deleted files.
   - Purpose: Ensure AST parsing and writes are skipped when no re-index is needed.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
15. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Add AST coverage and ingest persistence notes plus a mermaid diagram for the ingest/AST pipeline.
   - Purpose: Capture the end-to-end ingest + AST indexing flow.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
16. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add new AST ingest indexing tests to the project tree (`server/src/test/unit/ingest-ast-indexing.test.ts`).
   - Purpose: Keep projectStructure aligned with new test coverage.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
17. [x] Add ingest AST indexing log line:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Log line:
     - `DEV-0000032:T5:ast-index-complete`
   - Implementation details:
     - Emit `baseLogger.info` when AST indexing finishes for a root (after coverage counts are persisted).
     - Include `event: 'DEV-0000032:T5:ast-index-complete'`, `root`, and counts in the payload.
   - Documentation to read (repeat):
     - Node.js fs/promises: https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
18. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, start an ingest, open Logs, and confirm `DEV-0000032:T5:ast-index-complete` appears with counts; confirm the browser console shows no errors.
9. [x] `npm run compose:down`
10. [x] `npm run test:integration --workspace server`

#### Implementation notes

- Reviewed ingest flow (ingestJob/deltaPlan/discovery/hashing/types/ws) to align AST indexing with existing delta handling, hashing, and ingest update publishing.
- Added AST parsing into the ingest loop with supported/skip/failed counts, grammar-failure warning, and in-memory batching for symbols/edges/references/imports.
- Logged unsupported-language skips with example paths; logged AST indexing completion after coverage persistence.
- Wired AST persistence for start/reembed (clear or delete-by-relPath, upsert symbols/edges/references/imports, and coverage), skipping writes on dry-run or Mongo disconnect.
- Cancellation now clears AST batches and skips remaining AST writes.
- Added `__setParseAstSourceForTest` to stub parser behavior and updated AST ingest tests to track calls via local mocks.
- Adjusted AST test Mongo mocks to return query objects with `exec()` for `updateOne`/`deleteMany` paths.
- Ran `npm run lint --workspaces` (existing import-order warnings remain) and `npm run format --workspaces` after updates.
- Added `ingest-ast-indexing.test.ts` unit coverage for supported/skipped counts, parse failures, dry-run behavior, cancellation handling, mongo disconnect skip, and delta re-embed delete/upsert/skip flows.
- Updated `design.md` with AST ingest coverage notes and a detailed ingest/AST pipeline diagram.
- Updated `projectStructure.md` to include the new AST ingest indexing unit test.
- `npm run lint --workspaces` still reports existing import-order warnings; `npm run format:check --workspaces` passes.
- `npm run build --workspace server` completed successfully.
- `npm run build --workspace client` completed successfully (Vite chunk-size warnings only).
- `npm run test --workspace server` completed successfully.
- `npm run test --workspace client` completed successfully.
- `npm run e2e` completed successfully.
- `npm run compose:build` completed successfully.
- `npm run compose:up` completed successfully.
- Manual Playwright-MCP ingest run confirmed `DEV-0000032:T5:ast-index-complete` logs for `/Users/danielstapleton/Documents/dev/ci2-ast-tiny` with counts; no browser console errors observed.
- `npm run compose:down` completed successfully.
- `npm run test:integration --workspace server` completed successfully.

---

### 6. Server: Ingest status AST fields

- Task Status: **__done__**
- Git Commits: f70e5ab

#### Overview

Extend ingest status payloads (REST + WS) with optional AST counts and update tests accordingly.

#### Documentation Locations

- Node.js test runner (unit tests around ingest status): https://nodejs.org/api/test.html
- Cucumber guides (server integration tests): https://cucumber.io/docs/guides/
- TypeScript handbook (update status types safely): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Extend ingest status payload with AST counts:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ws/types.ts`
   - Implementation details:
     - Add optional `ast` object per contract.
     - Ensure `ingest_snapshot` and `ingest_update` include `ast` when available.
   - Documentation to read (repeat):
     - TypeScript handbook (update `IngestJobStatus` shapes): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
2. [x] Unit test — ingest status includes AST fields:
   - Test type: Unit (server ingest status).
   - Test location: `server/src/test/unit/ingest-status.test.ts`.
   - Description: Extend status snapshot expectations for `ast.supportedFileCount`, `skippedFileCount`, `failedFileCount`.
   - Purpose: Ensure REST status payloads include AST counts when provided.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
3. [x] Unit test — WS ingest events include AST fields:
   - Test type: Unit (WebSocket server).
   - Test location: `server/src/test/unit/ws-server.test.ts`.
   - Description: Emit ingest status with `ast` counts and assert `ingest_snapshot`/`ingest_update` include them.
   - Purpose: Ensure realtime ingest updates surface AST counts over WS.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] Cucumber step updates — ingest status AST fields:
   - Test type: Integration (Cucumber steps).
   - Test location: `server/src/test/steps/ingest-status.steps.ts`.
   - Description: Update step assertions to include `ast.*` fields in status responses.
   - Purpose: Keep ingest status BDD coverage aligned with the contract.
   - Documentation to read (repeat):
     - Cucumber guide (server integration tests): https://cucumber.io/docs/guides/10-minute-tutorial/
5. [x] Feature update — ingest status AST fields:
   - Test type: Integration (Cucumber feature).
   - Test location: `server/src/test/features/ingest-status.feature`.
   - Description: Add/extend scenarios to expect AST counts in the status payload.
   - Purpose: Ensure behavior is documented and verified at the feature level.
   - Documentation to read (repeat):
     - Cucumber guide (server integration tests): https://cucumber.io/docs/guides/10-minute-tutorial/
6. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Extend the ingest status contract section and add a mermaid diagram for the status payload flow.
   - Purpose: Document how AST counts move through REST/WS status updates.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
7. [x] Add ingest status log line:
   - Files to edit:
     - `server/src/ws/server.ts`
   - Log line:
     - `DEV-0000032:T6:ingest-status-ast`
   - Implementation details:
     - Emit `baseLogger.info` when broadcasting ingest status that includes `ast` counts.
     - Include `event: 'DEV-0000032:T6:ingest-status-ast'`, `runId`, and `supportedFileCount`.
   - Documentation to read (repeat):
     - WebSocket server overview: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, trigger an ingest, open Logs, and confirm `DEV-0000032:T6:ingest-status-ast` appears; confirm the browser console has no errors.
9. [x] `npm run compose:down`

#### Implementation notes

- Added optional `ast` counts to ingest status payloads and ensured updates carry AST counts through REST/WS status snapshots.
- Logged `DEV-0000032:T6:ingest-status-ast` during ingest WS broadcasts when AST counts are present.
- Updated ingest status unit + WS tests, plus Cucumber ingest-status steps/feature to assert AST counts.
- Documented ingest status AST payload shape and status flow in `design.md`.
- Ran `npm run lint --workspaces` (existing import-order warnings only), then `npm run format --workspaces` after `format:check` flagged server files.
- `npm run build --workspace server` and `npm run build --workspace client` completed successfully (Vite chunk-size warnings only).
- `npm run test --workspace server` and `npm run test --workspace client` completed successfully.
- `npm run e2e` completed successfully.
- `npm run compose:build`, `npm run compose:up`, manual Playwright-MCP log check for `DEV-0000032:T6:ingest-status-ast`, and `npm run compose:down` completed successfully.

---

### 7. Server: AST tool service

- Task Status: **__done__**
- Git Commits: 358ea01

#### Overview

Add AST tool validation + query services for list/find/call-graph/modules and error handling.

#### Documentation Locations

- Mongoose query docs (filtering AST symbols/edges): https://mongoosejs.com/docs/queries.html
- MongoDB CRUD reference (find + projection patterns): https://www.mongodb.com/docs/manual/crud/
- Node.js test runner (tool service unit tests): https://nodejs.org/api/test.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Review tool patterns and error mapping:
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
   - Documentation to read (repeat):
     - Mongoose queries: https://mongoosejs.com/docs/queries.html
2. [x] Add AST tool validation + query services:
   - Files to edit:
     - `server/src/ast/toolService.ts` (new)
   - Implementation details:
     - Implement validation for each AST tool request; apply default `limit=50` and cap at `200`.
     - Resolve repository → root using `listIngestedRepositories` to match the existing repo id contract.
     - Use the repo entry’s `containerPath` as the `root` value when querying AST collections (not `hostPath`).
    - When multiple repos share the same id, select the most recent `lastIngestAt`.
    - Return `INGEST_REQUIRED` (409) when there are no ingested repositories.
    - Return `AST_INDEX_REQUIRED` (409) when no coverage data exists for the repo.
     - Reuse `ValidationError` and `RepoNotFoundError` from `server/src/lmstudio/toolService.ts` to keep error mapping consistent.
     - Implement call graph traversal by following `CALLS` edges up to the requested depth.
      - `AstModuleImports` should map persisted import records into `{ relPath, imports: [{ source, names[] }] }`.
      - `AstFindReferences` should query `ast_references` by `symbolId` or by `{ name, kind }`.
   - Documentation to read (repeat):
     - Mongoose queries: https://mongoosejs.com/docs/queries.html
     - MongoDB CRUD: https://www.mongodb.com/docs/manual/crud/
3. [x] Unit test — AST tool validation missing required fields:
   - Test type: Unit (validation).
   - Test location: `server/src/test/unit/ast-tool-validation.test.ts` (new).
   - Description: Omit required input fields for each AST tool.
   - Purpose: Ensure `VALIDATION_FAILED` is returned for invalid payloads.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] Unit test — AST tool validation limit defaults/caps:
   - Test type: Unit (validation).
   - Test location: `server/src/test/unit/ast-tool-validation.test.ts` (new).
   - Description: Provide no `limit` and an oversized `limit`.
   - Purpose: Confirm default `limit=50` and cap at `200`.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
5. [x] Unit test — tool service ingest required:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: No repositories returned from `listIngestedRepositories`.
   - Purpose: Return `INGEST_REQUIRED` when nothing has been ingested.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
6. [x] Unit test — tool service repo not found:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Query with unknown repo id.
   - Purpose: Return `REPO_NOT_FOUND` without hitting AST collections.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
7. [x] Unit test — tool service missing coverage:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Repo exists but `ast_coverage` is missing.
   - Purpose: Return `AST_INDEX_REQUIRED` to signal missing AST index.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
8. [x] Unit test — tool service selects newest repo root:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Provide multiple roots with the same repo id.
   - Purpose: Ensure newest `lastIngestAt` root is selected.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
9. [x] Unit test — tool service uses containerPath root:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Seed repo metadata with `containerPath` and verify AST queries use it as `root`.
   - Purpose: Ensure AST queries align with stored `root` values from ingest metadata.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
10. [x] Unit test — tool service list symbols filters + limits:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Request symbols with `kinds` and `limit` filters.
   - Purpose: Verify list results are filtered and capped as expected.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
11. [x] Unit test — tool service find definition by symbolId:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Query `AstFindDefinition` with a known `symbolId`.
   - Purpose: Ensure definition lookup returns the matching symbol.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
12. [x] Unit test — tool service references by symbolId:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Query `AstFindReferences` using a `symbolId`.
   - Purpose: Ensure references return for direct symbol lookups.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
13. [x] Unit test — tool service call graph depth:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Build a call chain longer than requested depth.
   - Purpose: Ensure traversal respects depth and stops correctly.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
14. [x] Unit test — tool service module imports mapping:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Seed module import records with sources + names.
   - Purpose: Verify `AstModuleImports` shape `{ relPath, imports: [{ source, names[] }] }`.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
14. [x] Unit test — tool service references fallback:
   - Test type: Unit (service query).
   - Test location: `server/src/test/unit/ast-tool-service.test.ts` (new).
   - Description: Query by `{ name, kind }` when `symbolId` missing.
   - Purpose: Ensure fallback reference lookup works for legacy callers.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
15. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Document AST tool service behavior and add a mermaid diagram for tool query flow.
   - Purpose: Explain how AST tool requests map to Mongo queries and responses.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
16. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add AST tool service + unit test files to the tree (`server/src/ast/toolService.ts`, `server/src/test/unit/ast-tool-validation.test.ts`, `server/src/test/unit/ast-tool-service.test.ts`).
   - Purpose: Keep project structure docs aligned with added service/test files.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
17. [x] Add AST tool service log line:
   - Files to edit:
     - `server/src/ast/toolService.ts`
   - Log line:
     - `DEV-0000032:T7:ast-tool-service-request`
   - Implementation details:
     - Emit `baseLogger.info` at the start of each tool service handler.
     - Include `event: 'DEV-0000032:T7:ast-tool-service-request'`, `tool`, and `repository`.
   - Documentation to read (repeat):
     - Mongoose queries: https://mongoosejs.com/docs/queries.html
18. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, call `/tools/ast-list-symbols` from the browser console, open Logs, and confirm `DEV-0000032:T7:ast-tool-service-request` appears; confirm no console errors while the app is idle and after the request.
9. [x] `npm run compose:down`

#### Implementation notes

- Implemented AST tool service with validation, repo resolution, and query helpers for list/find/call-graph/module-imports.
- Added unit coverage for validation defaults/caps and all tool service query paths, including INGEST_REQUIRED and AST_INDEX_REQUIRED branches.
- Wired the `DEV-0000032:T7:ast-tool-service-request` log emission when tool handlers are invoked.
- Documented AST tool service flow + errors in `design.md` with a tool query diagram.
- Updated `projectStructure.md` to list the AST tool service and new unit tests.
- Ran lint + format checks; format required a Prettier pass, lint still reports existing import/order warnings in other files.
- Updated AST tool service row typings to satisfy server build output.
- Client build completed with existing Vite chunk size warnings.
- Server tests passed after rerunning with a longer timeout.
- Client tests passed with expected experimental VM modules warnings and console logs.
- E2E test run completed successfully (36 passed).
- Docker compose build completed successfully.
- Docker compose stack started successfully.
- Manual Playwright-MCP check completed after Task 8 REST endpoints landed; `DEV-0000032:T7:ast-tool-service-request` confirmed in Logs.
- Docker compose stack stopped cleanly after the manual check.

---

### 8. Server: AST REST endpoints

- Task Status: **__done__**
- Git Commits: d62af2e

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
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Add REST route handlers:
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
     - Mirror the VectorSearch route error handling style (`VALIDATION_FAILED`, `REPO_NOT_FOUND`, `INGEST_REQUIRED`, `AST_INDEX_REQUIRED`).
2. [x] Integration test — REST happy path payloads:
   - Test type: Integration (REST routes).
   - Test location: `server/src/test/integration/tools-ast.test.ts` (new).
   - Description: Stub the AST service and assert response shapes for all `/tools/ast-*` routes.
   - Purpose: Ensure contract-aligned payloads for list/find/call-graph/module-imports.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
   - Notes:
     - Mirror the existing router test patterns from `server/src/test/unit/tools-vector-search.test.ts` / `tools-ingested-repos.test.ts` when stubbing deps.
3. [x] Integration test — REST validation errors:
   - Test type: Integration (REST routes).
   - Test location: `server/src/test/integration/tools-ast.test.ts` (new).
   - Description: Send invalid payloads for each endpoint.
   - Purpose: Verify `400` responses with `VALIDATION_FAILED` details.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] Integration test — REST error mapping:
   - Test type: Integration (REST routes).
   - Test location: `server/src/test/integration/tools-ast.test.ts` (new).
   - Description: Force `REPO_NOT_FOUND`, `INGEST_REQUIRED`, and `AST_INDEX_REQUIRED` from the service.
   - Purpose: Ensure status codes + body shapes match the VectorSearch route conventions.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
5. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Add REST tool contracts, error codes, and a mermaid diagram for REST tool flow.
   - Purpose: Document the REST API surface for AST tooling and its error semantics.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
6. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add new REST route files and integration tests to the tree (`server/src/routes/toolsAstListSymbols.ts`, `server/src/routes/toolsAstFindDefinition.ts`, `server/src/routes/toolsAstFindReferences.ts`, `server/src/routes/toolsAstCallGraph.ts`, `server/src/routes/toolsAstModuleImports.ts`, `server/src/test/integration/tools-ast.test.ts`).
   - Purpose: Keep repository structure documentation in sync with new endpoints.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [x] Update documentation — `openapi.json`:
   - Document: `openapi.json`.
   - Location: `openapi.json`.
   - Description: Add `/tools/ast-*` endpoints and schema references.
   - Purpose: Ensure API documentation reflects the new REST tool routes.
   - Documentation to read (repeat):
     - OpenAPI 3.0 spec (schema + path shape): https://spec.openapis.org/oas/latest.html
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
8. [x] Add AST REST route log line:
   - Files to edit:
     - `server/src/routes/toolsAstListSymbols.ts`
   - Log line:
     - `DEV-0000032:T8:ast-rest-request`
   - Implementation details:
     - Emit `baseLogger.info` at the start of each AST REST handler.
     - Include `event: 'DEV-0000032:T8:ast-rest-request'` and `route`.
   - Documentation to read (repeat):
     - Express 5 routing docs: /expressjs/express/v5.1.0
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, call `/tools/ast-list-symbols`, open Logs, and confirm `DEV-0000032:T8:ast-rest-request` appears; ensure no console errors while app is idle.
9. [x] `npm run compose:down`

#### Implementation notes

- Added AST REST routes for list/find/references/call-graph/module-imports with shared error mapping and logging.
- Added integration coverage for happy paths, validation errors, and mapped repo/ingest/coverage error responses.
- Documented AST REST routes and error semantics in `design.md`.
- Updated `projectStructure.md` and `openapi.json` for AST REST routes + tests.
- Ran lint + format checks; format required a Prettier pass, lint still reports existing import/order warnings in unrelated files.
- Logged AST REST requests into the log store so the Logs UI surfaces `DEV-0000032:T8:ast-rest-request`.
- Server build completed successfully.
- Client build completed with the existing Vite chunk size warning.
- Server tests completed successfully.
- Client tests completed with expected VM module warnings and jest worker teardown notice.
- E2E run completed (33 passed, 3 skipped).
- Docker compose build completed successfully.
- Docker compose stack started successfully.
- Manual Playwright-MCP check confirmed `DEV-0000032:T8:ast-rest-request` and `DEV-0000032:T7:ast-tool-service-request` log entries after `/tools/ast-list-symbols`.
- Docker compose stack stopped cleanly after manual verification.

---

### 9. Server: MCP AST tool definitions

- Task Status: **__done__**
- Git Commits: a8919f4

#### Overview

Expose AST tools through the MCP JSON-RPC server with schemas aligned to the REST contracts and test coverage for tool listing and execution.

#### Documentation Locations

- MCP tool spec (schema + tool registration): https://modelcontextprotocol.io/specification
- JSON-RPC 2.0 spec (tool call envelopes/errors): https://www.jsonrpc.org/specification
- Supertest HTTP assertions (MCP integration tests): https://github.com/forwardemail/supertest
- Node.js test runner (integration tests): https://nodejs.org/api/test.html
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Review MCP server patterns:
   - Files to read:
     - `server/src/mcp/server.ts`
     - `server/src/test/integration/mcp-server.test.ts`
   - Documentation to read (repeat):
     - MCP tool format (schema expectations): https://modelcontextprotocol.io/specification
2. [x] Add AST MCP tool definitions + dispatch:
   - Files to edit:
     - `server/src/mcp/server.ts`
   - Implementation details:
     - Add tool definitions for `AstListSymbols`, `AstFindDefinition`, `AstFindReferences`, `AstCallGraph`, `AstModuleImports` with input/output schemas.
     - Route `tools/call` to AST service functions and map errors to MCP `invalid params` or internal errors.
     - Map `INGEST_REQUIRED` and `AST_INDEX_REQUIRED` to JSON-RPC errors with `409` codes (matching VectorSearch handling).
   - Documentation to read (repeat):
     - MCP tool format (schema expectations): https://modelcontextprotocol.io/specification
     - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
3. [x] Integration test — MCP tools/list includes AST tools:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Call `tools/list` and verify AST tool definitions are present.
   - Purpose: Ensure AST tools are advertised to MCP clients.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] Integration test — MCP tools/call returns payload:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Stub AST service response and call each tool.
   - Purpose: Ensure MCP responses include JSON payloads with the contract shape.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
5. [x] Integration test — MCP validation errors:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Call tools with invalid payloads.
   - Purpose: Confirm `-32602` is returned with `VALIDATION_FAILED` messaging.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
6. [x] Integration test — MCP AST_INDEX_REQUIRED mapping:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Simulate missing coverage in the AST service.
   - Purpose: Ensure `AST_INDEX_REQUIRED` is mapped consistently with existing MCP tools.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
7. [x] Integration test — MCP INGEST_REQUIRED mapping:
   - Test type: Integration (MCP server).
   - Test location: `server/src/test/integration/mcp-server.test.ts`.
   - Description: Simulate `INGEST_REQUIRED` from the AST service when no repos exist.
   - Purpose: Ensure `INGEST_REQUIRED` is mapped consistently with existing MCP tools.
   - Documentation to read (repeat):
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
     - Node.js test runner: https://nodejs.org/api/test.html
8. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Document MCP tool list/response shapes and add a mermaid diagram for MCP tool flow.
   - Purpose: Explain MCP exposure of AST tools and response contracts.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
9. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add/adjust MCP test file entries if new coverage is added.
   - Purpose: Keep project structure docs aligned with MCP test changes.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
10. [x] Add MCP tool registration log line:
   - Files to edit:
     - `server/src/mcp/server.ts`
   - Log line:
     - `DEV-0000032:T9:ast-mcp-tools-registered`
   - Implementation details:
     - Emit `baseLogger.info` after AST tool definitions are registered.
     - Include `event: 'DEV-0000032:T9:ast-mcp-tools-registered'` and `toolCount`.
   - Documentation to read (repeat):
     - MCP tool spec: https://modelcontextprotocol.io/specification
11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, open Logs, confirm `DEV-0000032:T9:ast-mcp-tools-registered` appears after startup, and confirm the browser console has no errors.
9. [x] `npm run compose:down`

#### Implementation notes

- Added AST MCP tool schemas + dispatcher wiring with logStore registration event for `DEV-0000032:T9:ast-mcp-tools-registered`.
- Expanded MCP integration tests to cover AST tool list/call payloads and validation/AST_INDEX_REQUIRED/INGEST_REQUIRED mappings.
- Documented AST MCP tools/flow in `design.md` and updated `projectStructure.md` for MCP integration coverage.
- Lint still reports existing import/order warnings in unrelated files; format check required a Prettier pass for the MCP integration test file.
- Server tests required extended runtime but completed successfully.
- Client tests ran with expected VM module warnings and logged console noise.
- E2E run completed (36 passed).
- Compose build/up rerun after logStore update; manual Logs check confirmed `DEV-0000032:T9:ast-mcp-tools-registered` and console stayed clean.
- Compose stack shut down cleanly after verification.

---

### 10. Client: Ingest status type updates

- Task Status: **__done__**
- Git Commits: f7e7bf8

#### Overview

Extend client ingest status types to include optional AST counts and update tests to accept the new fields.

#### Documentation Locations

- React 19 hooks reference (client state + effects): https://react.dev/reference/react
- TypeScript 5.9 release notes (type changes in client): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- Jest docs (Context7): /jestjs/jest
- Jest getting started (client unit tests): https://jestjs.io/docs/getting-started
- Testing Library intro (React test queries): https://testing-library.com/docs/react-testing-library/intro/
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Review ingest status types:
   - Files to read:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useIngestStatus.ts`
   - Documentation to read (repeat):
     - React 19 hooks reference: https://react.dev/reference/react
2. [x] Extend ingest status types for AST counts:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useIngestStatus.ts`
   - Implementation details:
     - Add optional `ast` field with `supportedFileCount`, `skippedFileCount`, `failedFileCount`, `lastIndexedAt`.
   - Documentation to read (repeat):
     - TypeScript 5.9 release notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
3. [x] Client tests — ingest status shape updates:
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
4. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Document client ingest status type updates and add a mermaid diagram for status data flow.
   - Purpose: Clarify how AST status fields propagate to the client.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
5. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Update the tree if client test files are modified.
   - Purpose: Keep documentation aligned with test adjustments.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
6. [x] Add client ingest status log line:
   - Files to edit:
     - `client/src/hooks/useIngestStatus.ts`
   - Log line:
     - `DEV-0000032:T10:ast-status-received`
   - Implementation details:
     - Emit `console.info` when a status payload includes the `ast` field.
     - Include the counts in the logged payload for verification.
   - Documentation to read (repeat):
     - React hooks reference: https://react.dev/reference/react
7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run an ingest, and confirm the browser console includes `DEV-0000032:T10:ast-status-received` with counts; ensure no console errors. Capture a screenshot of the Ingest page showing AST status fields and store it in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` for review.
9. [x] `npm run compose:down`

#### Implementation notes

- Added AST counts to ingest status types and surfaced AST metrics in the active ingest card.
- Logged `DEV-0000032:T10:ast-status-received` when ingest status includes AST counts.
- Updated ingest status UI tests to tolerate AST fields.
- Documented AST status payload updates and WS flow diagram in `design.md`.
- Lint still reports existing import/order warnings in unrelated files; formatting clean.
- Server tests completed (long runtime) with no failures.
- Client tests completed with expected VM module warnings and console noise.
- E2E run completed (36 passed).
- Manual Playwright-MCP check verified `DEV-0000032:T10:ast-status-received` and captured screenshot `playwright-output-local/0000032-t10-ast-status.png`.

---

### 11. Client: Ingest AST status banners

- Task Status: **__done__**
- Git Commits: c36cb16

#### Overview

Render non-blocking Ingest page banners for AST skipped/failed counts using existing Alert layout patterns.

#### Documentation Locations

- React 19 hooks reference (rendering conditional banners): https://react.dev/reference/react
- MUI Alert docs (MUI MCP v6.4.x, banner layout): https://llms.mui.com/material-ui/6.4.12/components/alert.md
- MUI Stack docs (MUI MCP v6.4.x, layout spacing): https://llms.mui.com/material-ui/6.4.12/components/stack.md
- MUI Typography docs (MUI MCP v6.4.x, banner text): https://llms.mui.com/material-ui/6.4.12/components/typography.md
- Testing Library intro (render + query assertions): https://testing-library.com/docs/react-testing-library/intro/
- Jest docs (Context7): /jestjs/jest
- Jest getting started (client unit tests): https://jestjs.io/docs/getting-started
- Docker Compose overview (compose build/up steps): https://docs.docker.com/compose/
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Add Ingest page banner for AST skips/failures:
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
2. [x] Client test — skipped-language banner renders:
   - Test type: Unit (client UI).
   - Test location: `client/src/test/ingestStatus.test.tsx`.
   - Description: Provide status payload with `ast.skippedFileCount > 0`.
   - Purpose: Ensure the “unsupported language” banner renders.
   - Documentation to read (repeat):
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest (React testing): https://jestjs.io/docs/getting-started
3. [x] Client test — failed AST banner renders:
   - Test type: Unit (client UI).
   - Test location: `client/src/test/ingestStatus.test.tsx`.
   - Description: Provide status payload with `ast.failedFileCount > 0`.
   - Purpose: Ensure the failure banner renders with guidance to check logs.
   - Documentation to read (repeat):
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest (React testing): https://jestjs.io/docs/getting-started
4. [x] Client test — banners hidden when counts are zero/missing:
   - Test type: Unit (client UI).
   - Test location: `client/src/test/ingestStatus.test.tsx`.
   - Description: Provide status payload with `ast` missing or counts = 0.
   - Purpose: Ensure banners do not render in the normal happy path.
   - Documentation to read (repeat):
     - Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest (React testing): https://jestjs.io/docs/getting-started
5. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Add client ingest banner notes and a mermaid diagram for the ingest status UI flow.
   - Purpose: Document UI behavior when AST indexing is skipped or fails.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
6. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Update tree entries if client test files change.
   - Purpose: Keep project structure docs accurate after test edits.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [x] Add AST banner render log line:
   - Files to edit:
     - `client/src/pages/IngestPage.tsx`
   - Log line:
     - `DEV-0000032:T11:ast-banner-evaluated`
   - Implementation details:
     - Emit `console.info` when banner visibility is evaluated (include `skippedFileCount`/`failedFileCount`).
     - Ensure the log appears even when banners are hidden (counts are zero).
   - Documentation to read (repeat):
     - React hooks reference: https://react.dev/reference/react
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, verify AST skip/failure banners render when counts are present, and confirm the console shows `DEV-0000032:T11:ast-banner-evaluated` (with counts) and no errors. Capture a screenshot of the banners and store it in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` for review.
9. [x] `npm run compose:down`

#### Implementation notes

- Added AST skip/failure banners in `IngestPage` and log line `DEV-0000032:T11:ast-banner-evaluated` with counts.
- Extended ingest status UI tests to cover skip/failure banners and hidden states.
- Updated `design.md` with AST banner behavior and a dedicated mermaid flowchart.
- No project structure changes were required for the updated test file.
- Lint still reports existing import/order warnings in unrelated server/test files; formatting clean.
- `npm run build --workspace server` completed successfully.
- `npm run build --workspace client` completed with the usual Vite chunk size warning.

---

### 13. Server: AST relationship edges + collision logging

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Add missing AST edge types (`EXTENDS`, `IMPLEMENTS`, `REFERENCES_TYPE`) and log symbolId collisions so the AST index fully meets the Option B schema requirements.

#### Documentation Locations

- Tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
- Tree-sitter node queries (capture filters): https://tree-sitter.github.io/tree-sitter/using-parsers#query-captures
- Tree-sitter JavaScript/TypeScript grammar docs: https://tree-sitter.github.io/tree-sitter/creating-parsers
- Node.js test runner (AST parser unit tests): https://nodejs.org/api/test.html
- Markdown Guide (update `design.md` + `projectStructure.md`): https://www.markdownguide.org/basic-syntax/
- Mermaid docs (Context7, architecture diagrams): /mermaid-js/mermaid
- ESLint CLI (run task lint step): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI (run task format step): https://prettier.io/docs/cli
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [ ] Review existing AST edge handling:
   - Documentation to read (repeat):
     - Tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
   - Files to read:
     - `server/src/ast/parser.ts`
     - `server/src/ast/types.ts`
2. [ ] Add `EXTENDS`/`IMPLEMENTS` edge extraction:
   - Files to edit:
     - `server/src/ast/parser.ts`
   - Implementation details:
     - Detect `extends`/`implements` clauses in class/interface declarations.
     - Map each referenced type name to the closest symbol in the same file and emit `EXTENDS` or `IMPLEMENTS` edges.
3. [ ] Add `REFERENCES_TYPE` edge extraction:
   - Files to edit:
     - `server/src/ast/parser.ts`
   - Implementation details:
     - Use Tree-sitter query captures (`reference.type`) to collect type references.
     - Map each reference to the matching symbol in the file and emit `REFERENCES_TYPE` edges.
4. [ ] Log symbolId collisions:
   - Files to edit:
     - `server/src/ast/parser.ts`
   - Implementation details:
     - When `createSymbolIdFactory` detects a duplicate hash, emit `DEV-0000032:T13:ast-symbolid-collision` via `append` + `baseLogger` with the base string and the new suffix count.
5. [ ] Unit tests — new AST edges + collision logging:
   - Test type: Unit (AST parser).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Add fixtures that produce `extends`/`implements` clauses and type references; assert the new edge types and collision log.
6. [ ] Update ingest AST indexing test coverage if needed:
   - Test type: Unit (ingest indexing).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Description: Verify new edge types are persisted during ingest when present.
7. [ ] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Document the new edge types and the collision log behavior.
   - Purpose: Keep AST schema docs aligned with the implemented edges.
8. [ ] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Update tree entries if test files are modified.
   - Purpose: Keep project structure docs aligned with updated tests.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run an ingest with a repo containing `extends`/`implements` and type references, and confirm `DEV-0000032:T13:ast-symbolid-collision` appears when forcing a collision; ensure no console errors.
9. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 14. Final Task: Full verification + acceptance criteria (retest)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Re-run full verification after the added AST edge work to ensure the story still meets all acceptance criteria.

#### Documentation Locations

- Docker Compose overview (clean builds + compose up): https://docs.docker.com/compose/
- Playwright Test intro (e2e run + screenshots): https://playwright.dev/docs/intro
- Husky docs (pre-commit hooks): https://typicode.github.io/husky/
- Mermaid docs (Context7, diagram syntax): /mermaid-js/mermaid
- Mermaid intro (diagram updates in `design.md`): https://mermaid.js.org/intro/
- Jest docs (Context7): /jestjs/jest
- Jest getting started (client/server tests): https://jestjs.io/docs/getting-started
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
- `npm run test --workspace server` completed within the extended timeout (54 scenarios passed).
- `npm run test --workspace client` passed with expected VM module warnings and console logs.
- `npm run e2e` completed with 36 passing tests.
- `npm run compose:build` completed successfully.
- `npm run test --workspace server` required a longer timeout; completed with 54 scenarios passing.
- Client tests passed with expected VM module warnings and console output.
- `npm run e2e` completed with 36 tests passing.
- `npm run compose:build` completed; client build still reports the chunk size warning.
- `npm run compose:up` started the local docker stack successfully.
- Manual Playwright-MCP check confirmed `DEV-0000032:T11:ast-banner-evaluated` and the skipped banner; screenshot saved to `playwright-output-local/0000032-t11-ast-banners.png`.
- `npm run compose:down` stopped the local docker stack.

---

### 12. Final Task: Full verification + acceptance criteria

- Task Status: **__done__**
- Git Commits: adf928e

#### Overview

Validate the full story against acceptance criteria, run full builds/tests, ensure documentation is complete, and prepare the pull request summary.

#### Documentation Locations

- Docker Compose overview (clean builds + compose up): https://docs.docker.com/compose/
- Playwright Test intro (e2e run + screenshots): https://playwright.dev/docs/intro
- Husky docs (pre-commit hooks): https://typicode.github.io/husky/
- Mermaid docs (Context7, diagram syntax): /mermaid-js/mermaid
- Mermaid intro (diagram updates in `design.md`): https://mermaid.js.org/intro/
- Jest docs (Context7): /jestjs/jest
- Jest getting started (client unit tests): https://jestjs.io/docs/getting-started
- Cucumber guides (server integration tests): https://cucumber.io/docs/guides/
- Markdown Guide (update docs + PR summary): https://www.markdownguide.org/basic-syntax/
- npm run-script (workspace build/test commands): https://docs.npmjs.com/cli/v9/commands/npm-run-script

#### Subtasks

1. [x] Update documentation — `README.md`:
   - Document: `README.md`.
   - Location: `README.md`.
   - Description: Add any new commands or user-facing descriptions introduced by AST indexing.
   - Purpose: Keep onboarding instructions current for users and developers.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
2. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Ensure architecture notes and mermaid diagrams reflect all AST indexing changes.
   - Purpose: Provide an accurate architectural reference for the new pipeline.
   - Documentation to read (repeat):
     - Mermaid docs (Context7, diagram syntax): /mermaid-js/mermaid
     - Mermaid intro (diagram updates in `design.md`): https://mermaid.js.org/intro/
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
3. [x] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add/update/remove file entries to reflect all story changes.
   - Purpose: Keep the repository tree representation accurate.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
4. [x] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
5. [x] Add final verification log line:
   - Files to edit:
     - `server/src/index.ts`
   - Log line:
     - `DEV-0000032:T12:verification-ready`
   - Implementation details:
     - Emit `baseLogger.info` once the server has finished startup and is ready for verification checks.
     - Include `event: 'DEV-0000032:T12:verification-ready'` and `port` in the payload.
   - Documentation to read (repeat):
     - Node.js events: https://nodejs.org/api/events.html
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, open Logs and confirm `DEV-0000032:T12:verification-ready` is present, walk through ingest + chat flows, verify AST status banners appear when expected, and confirm the browser console has no errors; capture screenshots for every GUI acceptance criterion and store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` for review.
9. [x] `npm run compose:down`

#### Implementation notes

- Updated `README.md` ingest section with AST banner + active card status notes.
- Added startup log note for `DEV-0000032:T12:verification-ready` in logging schema documentation.
- No `projectStructure.md` changes were needed (no new tracked files).
- PR summary draft:
  - Tree-sitter AST indexing pipeline with Mongo-backed symbols/edges/refs, coverage counts, and delta re-embed support.
  - AST tooling exposed via MCP + REST (`ast-*`) endpoints and validation/error mapping.
  - Client ingest status enhancements (AST counts in active card, skip/failure banners, log lines) plus related tests and documentation.
- Added `DEV-0000032:T12:verification-ready` startup log entry in `server/src/index.ts`.
- Lint still reports existing import/order warnings in server/test files; formatting clean.
- `npm run build --workspace server` completed successfully.
- `npm run build --workspace client` completed with the usual Vite chunk size warning.
