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

Note: Cross-repository symbol linking (e.g., linking imports in repo A to an ingested repo B like BabylonJS) is intentionally deferred to a later story.

---

## Acceptance Criteria

- Ingest and re-embed flows attempt Tree-sitter AST indexing for supported languages (TypeScript/JavaScript).
- For unsupported languages, the server logs a warning and the Ingest UI shows a non-blocking info banner indicating AST indexing was skipped for those files.
- AST indexing does not change existing embed/vector behavior or model locking rules.
- AST artifacts are stored persistently and can be queried through MCP tools (e.g., list symbols, find definition, find references, call graph) for supported repositories.
- Indexing respects ingest include/exclude rules and uses file hashes to avoid reprocessing unchanged files.
- The system records which roots have AST coverage and which files were skipped due to unsupported languages.
- AST artifacts are stored in Mongo using shared collections keyed by repo/root + file hash (no per-root collections).
- Dry-run ingest executes the full AST indexing pipeline (no skips).
- AST index schema (Option B): symbols include Module, Class, Function, Method, Interface, TypeAlias, Enum, Property; edges include DEFINES, CALLS, IMPORTS, EXPORTS, EXTENDS, IMPLEMENTS, REFERENCES_TYPE.
- MCP tools (Option B): `list_symbols`, `find_definition`, `find_references`, `call_graph`, `module_imports` for supported repositories.
- REST endpoints mirror MCP tools (same pattern as vector tools).

---

## Out Of Scope

- Knowledge graph storage and graph query tooling.
- Embedding AST artifacts into the vector database.
- Support for languages beyond TypeScript/JavaScript in this phase.
- UI changes outside the Ingest page banner.
- Automatic fixes for unsupported languages or missing grammars.
- Cross-repository symbol linking or dependency resolution between multiple ingested repos.

---

## Questions

- None.

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
