# Story 0000033 - AST language support (Tree-sitter)

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

CodeInfo2 currently builds AST symbol data only for JavaScript/TypeScript files during ingest, which limits AST tools to JS/TS repos. This story extends the same pipeline so Python, C#, Rust, and C++ repos can be indexed and queried without changing how ingest or the tools work for JS/TS.

This phase is strictly about language coverage. We will keep the existing AST schema, ingest discovery rules, file hashing, and tool contracts unchanged. Where grammars do not ship `locals.scm` (Python/C#/Rust/C++), we will add CodeInfo2-owned locals queries so definitions and references are still captured. No UI updates are planned; verification is via server logs and parser-level tests added in this story.

---

## Acceptance Criteria

- Ingest `start` and `reembed` parse ASTs for any file whose language is detected as **javascript**, **typescript**, **tsx**, **python**, **c_sharp**, **rust**, or **cpp**; a repo containing at least one file per language yields AST records with those `language` values.
- File-extension routing mirrors each grammar’s `tree-sitter.json` defaults: `py` → python, `cs` → c_sharp, `rs` → rust, `cc/cpp/cxx/hpp/hxx/h` → cpp.
- New grammars are wired to the expected packages: `tree-sitter-python`, `tree-sitter-c-sharp`, `tree-sitter-rust`, and `tree-sitter-cpp`; no custom file‑extension overrides are added beyond the grammar defaults.
- Custom locals queries exist at `server/src/ast/queries/<language>/locals.scm` for **python**, **c_sharp**, **rust**, and **cpp**, and the parser loads these files for those languages while still loading `tags.scm` from the grammar packages.
- Parser‑level tests with minimal fixtures for python/c_sharp/rust/cpp assert at least one `@local.definition` and one `@local.reference` capture per language, and the resulting AST output includes reference entries for those symbols.
- AST indexing remains additive: existing embedding counts, ingest totals, and model‑locking behavior remain unchanged in current test/fixture runs (no regressions introduced).
- AST parsing does not skip supported files during `reembed` based on delta logic; logs confirm AST parsing attempts occur for supported files on reembed.
- Server logs report unsupported file extensions with the extension and skip reason, and do not emit “Tree‑sitter query files missing; skipping AST parse” for the four new languages.
- MCP/REST AST tool response shape is unchanged; client builds without changes and can surface the new `language` values.

---

## Out Of Scope

- Knowledge graph storage (e.g., Memgraph) and cross-repository linking.
- Changing `AstSymbolKind` or `AstEdgeType` enums or adding new edge/symbol kinds.
- UI banners or additional client-side messaging for AST language support.
- Custom AST parsing logic that bypasses Tree‑sitter queries.
- Expanding file extension lists beyond the grammar defaults for each language.

---

## Message Contracts & Storage Shapes

No new message contracts or storage shapes are required. Existing AST collections and tool responses already carry a `language` field; this story only expands the allowed language values. Update the type/validation surfaces that enumerate languages (e.g., `AstLanguage` and any schema guards) so new values are accepted, but keep the document/response shapes unchanged.

---

## Questions

---

## Reference Sources (code-graph-rag)

We will use the following code‑graph‑rag files as **reference inputs** when authoring custom `locals.scm` queries. These are **not** drop‑in artifacts; they guide node‑type coverage and naming conventions.

**Shared file extension mappings**
- `codebase_rag/constants.py:64` (extension constants)
- `codebase_rag/constants.py:90` (extension tuples by language)

- **Python (custom locals needed):**
  - `codebase_rag/language_spec.py:205` (Python `LanguageSpec` node types)
  - `codebase_rag/constants.py:2579` (Python node type tuples + package indicators)
- **C# (custom locals needed):**
  - `codebase_rag/language_spec.py:382` (C# `LanguageSpec` node types)
  - `codebase_rag/constants.py:2711` (C# node type tuples)
- **Rust (custom locals needed):**
  - `codebase_rag/language_spec.py:244` (Rust `LanguageSpec` + explicit function/class/call queries)
  - `codebase_rag/constants.py:2615` (Rust node type tuples + package indicators)
- **C++ (custom locals needed):**
  - `codebase_rag/language_spec.py:344` (C++ `LanguageSpec` + explicit function/class/call queries)
  - `codebase_rag/constants.py:2674` (C++ node type tuples + package indicators)

---

## SCM Availability Notes

The following grammars **do not ship `locals.scm`** in their official Tree‑sitter repos, so we must author and maintain our own `locals.scm` to reach full reference support:

- Python (`tree-sitter-python`)
- C# (`tree-sitter-c-sharp`)
- Rust (`tree-sitter-rust`)
- C++ (`tree-sitter-cpp`)

## Tree-sitter.json Defaults (File Types + Query Files)

These values come from each grammar’s `tree-sitter.json` and are used to keep extension routing and query expectations aligned with upstream defaults.

- **Python**
  - File types: `py`
  - Query files: `highlights.scm`, `tags.scm` (no `locals.scm`)
- **C#**
  - File types: `cs`
  - Query files: `highlights.scm`, `tags.scm` (no `locals.scm`)
- **Rust**
  - File types: `rs`
  - Query files: `highlights.scm`, `injections.scm`, `tags.scm` (no `locals.scm`)
- **C++**
  - File types: `cc`, `cpp`, `cxx`, `hpp`, `hxx`, `h`
  - Query files: `highlights.scm` (includes tree-sitter-c highlights), `injections.scm`, `tags.scm` (no `locals.scm`)

---

## Documentation Locations (node-types.json sources)

- Python: `https://github.com/tree-sitter/tree-sitter-python/blob/master/src/node-types.json`
- C#: `https://github.com/tree-sitter/tree-sitter-c-sharp/blob/master/src/node-types.json`
- Rust: `https://github.com/tree-sitter/tree-sitter-rust/blob/master/src/node-types.json`
- C++: `https://github.com/tree-sitter/tree-sitter-cpp/blob/master/src/node-types.json`
- Tree-sitter `tree-sitter.json` and query conventions: `https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html`

---

## Validation & Testing Notes

- The detailed file-level placement and test instructions are captured in each task’s subtasks to avoid relying on story-wide context.
- Use the per-subtask documentation links and file lists for implementation details.

---

## Implementation Ideas

- Update `AstLanguage` to include `python`, `c_sharp`, `rust`, and `cpp`, then extend `normalizeLanguage` with the tree‑sitter.json defaults (`py`, `cs`, `rs`, `cc/cpp/cxx/hpp/hxx/h`).
- Add grammar bindings and package roots in `server/src/ast/parser.ts`, plus `server/src/types/tree-sitter.d.ts` module declarations for the new grammar packages so Node can load them.
- Extend `loadQueries` to read `queries/tags.scm` from each grammar package and `server/src/ast/queries/<language>/locals.scm` for languages without upstream locals; keep the query cache and warm‑up behavior aligned with new languages.
- Add the new extensions to `astSupportedExtensions` and keep ingest/reembed calling AST parsing for those files; confirm unsupported extensions still log a skip reason.
- Create `server/src/ast/queries/<language>/locals.scm` for python/c_sharp/rust/cpp and add minimal fixtures + unit tests in `server/src/test/unit/ast-parser.test.ts` and ingest gating coverage in `server/src/test/unit/ingest-ast-indexing.test.ts`.
- Ensure AST tool tests (e.g., `server/src/test/unit/ast-tool-validation.test.ts`) accept the new language values without schema changes.

---

## Expected Files To Add Or Update

- Update: `server/src/ast/types.ts`, `server/src/ast/parser.ts`, `server/src/ingest/ingestJob.ts`, `server/src/types/tree-sitter.d.ts`.
- Add: `server/src/ast/queries/python/locals.scm`, `server/src/ast/queries/c_sharp/locals.scm`, `server/src/ast/queries/rust/locals.scm`, `server/src/ast/queries/cpp/locals.scm`.
- Update tests: `server/src/test/unit/ast-parser.test.ts`, `server/src/test/unit/ingest-ast-indexing.test.ts`, and any AST tool validation tests that enumerate language values.

---

## Edge Cases and Failure Modes

- Missing grammar packages or bindings for a new language should log a grammar-load failure and return a failed AST parse result without crashing ingest.
- Missing `locals.scm` files for the new languages should be logged once per language and skip AST parsing for that file, matching current JS/TS behavior for missing queries.
- Unsupported extensions (e.g., `.pyw`, `.hpp` if not included) must still log a skip reason and not be treated as supported unless added intentionally.
- C++ headers (`.h`) are shared with C; ensure we only parse them with the C++ grammar to keep results consistent with the story’s scope.
- Tree-sitter query syntax errors in custom `locals.scm` should surface as parse failures with line/column/snippet details (as seen in existing AST error logging) so they are actionable.
- Very large files should not change existing ingest behavior; AST indexing should fail gracefully if parsing exceeds memory/time limits.

---

## Locals.scm Authoring Method (per language)

We will author `locals.scm` for Python, C#, Rust, and C++ using the same repeatable approach:

1. Collect Tree‑sitter node types from the grammar (`node-types.json`) and confirm the declaration/reference nodes in each language.
2. Use code‑graph‑rag’s node‑type lists and query hints as a **starting point** (see Reference Sources).
3. Draft a minimal `locals.scm` with:
   - `@local.scope` captures (e.g., function/class/closure bodies)
   - `@local.definition` captures (e.g., identifiers in declarations)
   - `@local.reference` captures (generic identifiers/expressions)
4. Parse fixtures for each language, validate reference coverage, and refine queries until references align with expected identifiers.

Note: Node‑type names used in the example outlines below **must be validated** against each language’s `node-types.json` to avoid mismatched captures. If any node name differs, update the `locals.scm` and the plan’s references accordingly during implementation.

### Python (locals.scm example outline)

Start from Python node types (function/class/assignment/import) and draft:

```

(function_definition) @local.scope
(class_definition) @local.scope
(block) @local.scope

(function_definition name: (identifier) @local.definition)
(class_definition name: (identifier) @local.definition)
(assignment left: (identifier) @local.definition)
(import_statement name: (identifier) @local.definition)
(import_from_statement name: (identifier) @local.definition)

(identifier) @local.reference
```

Reference inputs:
- `codebase_rag/language_spec.py:205`
- `codebase_rag/constants.py:2082`
- `codebase_rag/constants.py:2579`

### C# (locals.scm example outline)

Start from C# node types (method/constructor/local function/variable declarator) and draft:

```

(method_declaration name: (identifier) @local.definition) @local.scope
(constructor_declaration name: (identifier) @local.definition) @local.scope
(local_function_statement name: (identifier) @local.definition) @local.scope
(variable_declarator name: (identifier) @local.definition)

(identifier) @local.reference
```

Reference inputs:
- `codebase_rag/language_spec.py:382`
- `codebase_rag/constants.py:1683`
- `codebase_rag/constants.py:2711`

### Rust (locals.scm example outline)

Start from Rust node types (function/impl/let bindings) and draft:

```

(function_item) @local.scope
(impl_item) @local.scope
(block) @local.scope

(function_item name: (identifier) @local.definition)
(let_declaration pattern: (identifier) @local.definition)

(identifier) @local.reference
```

Reference inputs:
- `codebase_rag/language_spec.py:244`
- `codebase_rag/constants.py:2303`
- `codebase_rag/constants.py:2615`

### C++ (locals.scm example outline)

Start from C++ node types (function/field/parameter declarators) and draft:

```

(function_definition) @local.scope
(compound_statement) @local.scope

(function_definition declarator: (function_declarator declarator: (identifier) @local.definition))
(parameter_declaration declarator: (identifier) @local.definition)
(init_declarator declarator: (identifier) @local.definition)

(identifier) @local.reference
```

Reference inputs:
- `codebase_rag/language_spec.py:344`
- `codebase_rag/constants.py:1709`
- `codebase_rag/constants.py:2674`

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

---

## Tasks

### 1. Server: AST language enum + extension routing

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Expand the AST language type and extension routing so ingest and tool validation recognise Python, C#, Rust, and C++ files before parser work begins. This aligns validation with the new grammar defaults and keeps routing consistent across ingest + reembed flows.

#### Documentation Locations

- Tree-sitter language config + query file defaults (Context7 `/tree-sitter/tree-sitter`): /tree-sitter/tree-sitter
- Tree-sitter init docs (`tree-sitter.json` structure + query keys): https://tree-sitter.github.io/tree-sitter/cli/init.html
- tree-sitter-python `tree-sitter.json` example (file-types + tags path): https://docs.rs/crate/tree-sitter-python/0.23.3/source/tree-sitter.json
- Tree-sitter Python grammar repo (extension defaults + node types): https://github.com/tree-sitter/tree-sitter-python
- Tree-sitter C# grammar repo (extension defaults + node types): https://github.com/tree-sitter/tree-sitter-c-sharp
- Tree-sitter Rust grammar repo (extension defaults + node types): https://github.com/tree-sitter/tree-sitter-rust
- Tree-sitter C++ grammar repo (extension defaults + node types): https://github.com/tree-sitter/tree-sitter-cpp
- TypeScript reference (Context7 `/microsoft/typescript/v5.9.2`, latest available for 5.9.x) for union updates: /microsoft/typescript/v5.9.2
- Node.js test runner API (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- npm run-script docs (CLI v10): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current AST language routing and supported extension logic:
   - Files to read:
     - `server/src/ast/types.ts`
     - `server/src/ast/parser.ts`
     - `server/src/ingest/ingestJob.ts`
     - `server/src/test/unit/ast-tool-validation.test.ts`
     - `server/src/test/unit/ingest-ast-indexing.test.ts`
   - Notes:
     - Identify the current `AstLanguage` union, `normalizeLanguage` logic, and the `astSupportedExtensions` set.
   - Documentation to read (repeat):
     - Tree-sitter language configuration (`tree-sitter.json` locals/tags defaults): /tree-sitter/tree-sitter
     - TypeScript handbook (union type updates): /microsoft/typescript/v5.9.2
2. [ ] Audit for any hard-coded AST language lists or validators:
   - Files to search:
     - `server/src/ast`
     - `server/src/ingest`
     - `server/src/test/unit`
   - Implementation details:
     - Update any arrays or guards (e.g., warm-up language lists) so they include the new languages.
     - Keep response payload shapes unchanged.
     - Validate extension lists against each grammar’s `tree-sitter.json` file-types so routing matches the published defaults.
   - Documentation to read (repeat):
     - Tree-sitter init docs (query path defaults + `tree-sitter.json` structure): https://tree-sitter.github.io/tree-sitter/cli/init.html
     - tree-sitter-python `tree-sitter.json` example (file-types + tags path): https://docs.rs/crate/tree-sitter-python/0.23.3/source/tree-sitter.json
3. [ ] Extend `AstLanguage` and extension routing:
   - Files to edit:
     - `server/src/ast/types.ts`
     - `server/src/ast/parser.ts`
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Add `python`, `c_sharp`, `rust`, and `cpp` to the `AstLanguage` union and any related schema guards.
     - Map `py`, `cs`, `rs`, `cc`, `cpp`, `cxx`, `hpp`, `hxx`, and `h` to the new languages (no extra overrides beyond grammar defaults).
   - Documentation to read (repeat):
     - Tree-sitter language configuration: /tree-sitter/tree-sitter
     - Tree-sitter C++ grammar (extension defaults + node types): https://github.com/tree-sitter/tree-sitter-cpp
4. [ ] Update validation coverage for new language values:
   - Test type: Unit (validation/guard coverage).
   - Test location: `server/src/test/unit/ast-tool-validation.test.ts`.
   - Description: Ensure validators accept the new language values and still reject unknown languages.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
     - TypeScript handbook: /microsoft/typescript/v5.9.2
5. [ ] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Add/confirm the supported AST language list and extension routing summary.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
6. [ ] Update documentation — `projectStructure.md` (if any new files are added in this task; otherwise confirm no change):
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Ensure the tree remains accurate if any files were added or removed.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: /eslint/eslint/v9.37.0
     - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`
8. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 2. Server: Tree-sitter grammar dependencies + parser wiring

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Add the Tree-sitter grammar packages and wire them into the parser so language detection and query loading can target Python, C#, Rust, and C++. Query assets and parser tests are handled in the next task to keep this step focused on dependency + wiring changes.

#### Documentation Locations

- Tree-sitter query system + capture conventions (Context7 `/tree-sitter/tree-sitter`): /tree-sitter/tree-sitter
- DeepWiki tree-sitter Query System (query file conventions): deepwiki tree-sitter/tree-sitter → “Query System”
- Tree-sitter init docs (`tree-sitter.json` structure + query keys): https://tree-sitter.github.io/tree-sitter/cli/init.html
- Tree-sitter Python grammar repo (node types + queries): https://github.com/tree-sitter/tree-sitter-python
- Tree-sitter C# grammar repo (node types + queries): https://github.com/tree-sitter/tree-sitter-c-sharp
- Tree-sitter Rust grammar repo (node types + queries): https://github.com/tree-sitter/tree-sitter-rust
- Tree-sitter C++ grammar repo (node types + queries): https://github.com/tree-sitter/tree-sitter-cpp
- TypeScript ambient module declarations (Context7 `/microsoft/typescript/v5.9.2`): /microsoft/typescript/v5.9.2
- Node.js test runner API (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- npm run-script docs (CLI v10): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing parser/query loading patterns:
   - Files to read:
     - `server/src/ast/parser.ts`
     - `server/src/types/tree-sitter.d.ts`
     - `server/src/ast/queries/typescript/locals.scm`
     - `server/src/test/unit/ast-parser.test.ts`
   - Notes:
     - Identify how tags/locals queries are loaded for JS/TS today.
     - Reuse `sanitizeQuery`, `loadQueryFile`, and `loadQueries` rather than adding new loaders.
   - Documentation to read (repeat):
     - Tree-sitter query syntax + locals capture guide: /tree-sitter/tree-sitter
     - Tree-sitter init docs (query path defaults + `tree-sitter.json` structure): https://tree-sitter.github.io/tree-sitter/cli/init.html
2. [ ] Add Tree-sitter grammar dependencies:
   - Files to edit:
     - `server/package.json`
     - `package-lock.json`
   - Implementation details:
     - Add `tree-sitter-python`, `tree-sitter-c-sharp`, `tree-sitter-rust`, and `tree-sitter-cpp` with versions aligned to existing Tree-sitter dependencies (`tree-sitter@0.21.1`, `tree-sitter-javascript@0.23.1`, `tree-sitter-typescript@0.23.2`).
     - Keep the existing `tree-sitter` binding version unchanged unless it blocks grammar loading.
   - Documentation to read (repeat):
     - npm run-script (workspace commands): https://docs.npmjs.com/cli/v10/commands/npm-run-script
3. [ ] Extend Tree-sitter module declarations for new grammars:
   - Files to edit:
     - `server/src/types/tree-sitter.d.ts`
   - Implementation details:
     - Add module declarations for each new grammar package so TypeScript can import them cleanly.
   - Documentation to read (repeat):
     - TypeScript handbook (union type updates): /microsoft/typescript/v5.9.2
4. [ ] Wire new languages into the parser + query loader:
   - Files to edit:
     - `server/src/ast/parser.ts`
   - Implementation details:
     - Register `python`, `c_sharp`, `rust`, and `cpp` in `getLanguageConfig` or equivalent language map.
     - Load `queries/tags.scm` from each grammar package and load `locals.scm` from `server/src/ast/queries/<language>/locals.scm` for the new languages.
     - Extend any query warm-up lists (e.g., `warmAstParserQueries`) to include the new languages.
   - Documentation to read (repeat):
     - Tree-sitter query syntax + locals capture guide: /tree-sitter/tree-sitter
5. [ ] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Note the new grammar packages and parser wiring changes.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
6. [ ] Update documentation — `projectStructure.md` (if any files were added in this task; otherwise confirm no change):
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Ensure the tree remains accurate after dependency and wiring changes.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: /eslint/eslint/v9.37.0
     - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`
8. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 3. Server: AST query assets + parser tests

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Verify grammar query assets, add CodeInfo2-owned locals, and extend parser unit tests to cover Python, C#, Rust, and C++.

#### Documentation Locations

- Tree-sitter query system + capture conventions (Context7 `/tree-sitter/tree-sitter`): /tree-sitter/tree-sitter
- DeepWiki tree-sitter Query System (query file conventions): deepwiki tree-sitter/tree-sitter → “Query System”
- Tree-sitter init docs (`tree-sitter.json` structure + query keys): https://tree-sitter.github.io/tree-sitter/cli/init.html
- Tree-sitter Python grammar repo (node types + queries): https://github.com/tree-sitter/tree-sitter-python
- Tree-sitter C# grammar repo (node types + queries): https://github.com/tree-sitter/tree-sitter-c-sharp
- Tree-sitter Rust grammar repo (node types + queries): https://github.com/tree-sitter/tree-sitter-rust
- Tree-sitter C++ grammar repo (node types + queries): https://github.com/tree-sitter/tree-sitter-cpp
- Node.js test runner API (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- npm run-script docs (CLI v10): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Verify grammar package query assets before wiring tags:
   - Files to inspect:
     - `node_modules/tree-sitter-python/queries`
     - `node_modules/tree-sitter-c-sharp/queries`
     - `node_modules/tree-sitter-rust/queries`
     - `node_modules/tree-sitter-cpp/queries`
   - Implementation details:
     - Confirm each package ships `queries/tags.scm`.
     - If any package lacks `tags.scm`, update the dependency version to one that includes tags rather than adding local fallbacks.
   - Documentation to read (repeat):
     - Tree-sitter init docs (query path defaults + `tree-sitter.json` structure): https://tree-sitter.github.io/tree-sitter/cli/init.html
     - Tree-sitter Python grammar (node types + queries): https://github.com/tree-sitter/tree-sitter-python
2. [ ] Create custom locals queries for new languages:
   - Files to add:
     - `server/src/ast/queries/python/locals.scm`
     - `server/src/ast/queries/c_sharp/locals.scm`
     - `server/src/ast/queries/rust/locals.scm`
     - `server/src/ast/queries/cpp/locals.scm`
   - Implementation details:
     - Use the grammar `node-types.json` for node names; capture `@local.scope`, `@local.definition`, and `@local.reference` for each language.
     - Use the code-graph-rag reference inputs listed earlier in this plan to confirm node coverage.
   - Example snippet (use node names from each grammar’s `node-types.json`):
     - `(identifier) @local.reference`
   - Documentation to read (repeat):
     - Tree-sitter query syntax + locals capture guide: /tree-sitter/tree-sitter
3. [ ] Add parser unit coverage for new languages:
   - Test type: Unit (parser output).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Add minimal inline fixtures per language and assert at least one `@local.definition` and one `@local.reference` capture, plus non-empty references in the output.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
     - Tree-sitter query syntax: /tree-sitter/tree-sitter
   - Notes:
     - Extend existing fixtures in `ast-parser.test.ts` instead of creating new test files.
     - Copy the existing TS fixture structure (inline source string + `parseAstSource` call) to keep tests consistent.
4. [ ] Add parser error-path coverage for new languages (corner cases):
   - Test type: Unit (parser failures).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Add at least one new-language case that asserts `Missing Tree-sitter query files` when `queryBundleOverride: null`, and another that asserts `Tree-sitter grammar unavailable` when `parserLanguageOverride: null`.
   - Coverage notes:
     - Use a `relPath` with a new extension (e.g., `.py`, `.rs`) so the error paths are exercised for the new language routing.
     - Keep assertions aligned with the existing error strings returned by `parseAstSource` so the tests remain deterministic.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
5. [ ] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Note that Python/C#/Rust/C++ locals queries are CodeInfo2-owned and record any dependency version changes made to obtain tags.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
6. [ ] Update documentation — `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add the new `server/src/ast/queries/*/locals.scm` files to the tree.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: /eslint/eslint/v9.37.0
     - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`
8. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 4. Server: Ingest AST indexing coverage + logging

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Extend ingest AST indexing coverage so the new language extensions are parsed during `start` and `reembed`, and update logs/tests to confirm skip reasons and successful AST attempts.

#### Documentation Locations

- Tree-sitter query system + capture conventions (Context7 `/tree-sitter/tree-sitter`): /tree-sitter/tree-sitter
- Node.js test runner API (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- npm run-script docs (CLI v10): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review ingest AST indexing flow + tests:
   - Files to read:
     - `server/src/ingest/ingestJob.ts`
     - `server/src/ingest/deltaPlan.ts`
     - `server/src/test/unit/ingest-ast-indexing.test.ts`
     - `server/src/ingest/__fixtures__` (if fixtures are used for AST indexing tests)
   - Notes:
     - Locate the AST parse call site, the supported extension check, and existing log messages for unsupported extensions.
   - Documentation to read (repeat):
     - Node.js test runner (ingest unit tests): /nodejs/node/v22.17.0
2. [ ] Ensure ingest AST indexing covers new languages during `start` + `reembed`:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Confirm AST parsing is attempted for supported files even when vector delta logic skips embeddings.
     - Log unsupported extensions with extension list + reason (e.g., `unsupported_language`) and keep example paths for debugging.
     - Ensure logs do not emit a “locals.scm missing” warning for the new languages.
   - Example log context (shape only):
     - `{ root, skippedFileCount, skippedExtensions: ['py', 'cs'], reason: 'unsupported_language' }`
   - Documentation to read (repeat):
     - Tree-sitter query/locals guidance: /tree-sitter/tree-sitter
3. [ ] Update ingest AST indexing tests for new extensions:
   - Test type: Unit (ingest AST indexing).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Description: Add at least one file per new extension (`.py`, `.cs`, `.rs`, `.cpp`, `.h`) plus one unsupported extension (e.g., `.pyw`) and assert supported counts + reembed AST attempts.
   - Assertions:
     - Logs include unsupported extension reasons for non-supported files.
     - The unsupported `.pyw` (or equivalent) file is *not* treated as Python and appears in the unsupported-extension log with the skip reason.
     - Logs include AST parsing attempts for the new languages during reembed.
     - Logs do not include “Tree-sitter query files missing; skipping AST parse” for the new languages.
     - Unsupported-language log context includes the extension list and skip reason.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
   - Notes:
     - Extend the existing ingest AST indexing test file rather than creating new tests.
4. [ ] Validate no regressions to embedding counts or model-locking behavior:
   - Files to read:
     - `server/src/test/unit/ingest-status.test.ts`
     - `server/src/test/unit/ingest-root-metadata.test.ts` (if present)
   - Implementation details:
     - Confirm existing tests that assert embedding counts or model locks still pass without updates.
     - If expectations need adjustment due to new AST fields, update only the AST-related fields; keep embedding counts and model lock assertions unchanged.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
5. [ ] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Document ingest AST indexing coverage for Python/C#/Rust/C++ and note the skip-log behaviour.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
6. [ ] Update documentation — `projectStructure.md` (if new fixture files are added):
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add new fixture files to the tree if any are introduced.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: /eslint/eslint/v9.37.0
     - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`
8. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 5. Final verification + acceptance criteria

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Validate the full story against acceptance criteria, run the complete test/build workflow, refresh documentation, and prepare the pull request summary.

#### Documentation Locations

- Docker Compose reference (Context7 `/docker/docs`): /docker/docs
- Playwright (Context7 `/microsoft/playwright.dev`) for e2e runs: /microsoft/playwright.dev
- Playwright MCP server docs (Context7 `/microsoft/playwright-mcp`) for screenshots: /microsoft/playwright-mcp
- Husky hooks (Context7 `/typicode/husky`): /typicode/husky
- Mermaid diagrams (Context7 `/mermaid-js/mermaid/v11_0_0`): /mermaid-js/mermaid/v11_0_0
- Jest CLI/config (Context7 `/websites/jestjs_io_30_0`) for Jest 30.x: /websites/jestjs_io_30_0
- Cucumber.js guide (https://cucumber.io/docs/guides/10-minute-tutorial): https://cucumber.io/docs/guides/10-minute-tutorial
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- npm run-script docs (CLI v10): https://docs.npmjs.com/cli/v10/commands/npm-run-script

#### Subtasks

1. [ ] Build the server.
   - Documentation to read (repeat):
     - npm run-script: https://docs.npmjs.com/cli/v10/commands/npm-run-script
2. [ ] Build the client.
   - Documentation to read (repeat):
     - npm run-script: https://docs.npmjs.com/cli/v10/commands/npm-run-script
3. [ ] Perform a clean docker build.
   - Documentation to read (repeat):
     - Docker/Compose: /docker/docs
4. [ ] Ensure `README.md` is updated with any required description or command changes added during this story.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
5. [ ] Ensure `design.md` is updated with any required description changes and mermaid diagrams added during this story.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid: /mermaid-js/mermaid/v11_0_0
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [ ] Create a concise summary of all changes in this story and draft a pull request comment covering all tasks.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/

#### Testing

1. [ ] Run the client Jest tests.
   - Documentation to read (repeat):
     - Jest: /websites/jestjs_io_30_0
2. [ ] Run the server Cucumber tests.
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/10-minute-tutorial
3. [ ] Restart the docker environment.
   - Documentation to read (repeat):
     - Docker/Compose: /docker/docs
4. [ ] Run the e2e tests.
   - Documentation to read (repeat):
     - Playwright: /microsoft/playwright.dev
5. [ ] Use the Playwright MCP tool to manually check the application, saving screenshots to `./test-results/screenshots/` (name each screenshot with the plan index, task number, and scenario).
   - Documentation to read (repeat):
     - Playwright: /microsoft/playwright.dev

#### Implementation notes

- 

---
