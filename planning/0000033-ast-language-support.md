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
- No AST tool request schema changes are required; language values are derived from stored AST data.

---

## Expected Files To Add Or Update

- Update: `server/src/ast/types.ts`, `server/src/ast/parser.ts`, `server/src/ingest/ingestJob.ts`, `server/src/types/tree-sitter.d.ts`.
- Add: `server/src/ast/queries/python/locals.scm`, `server/src/ast/queries/c_sharp/locals.scm`, `server/src/ast/queries/rust/locals.scm`, `server/src/ast/queries/cpp/locals.scm`.
- Update tests: `server/src/test/unit/ast-parser.test.ts`, `server/src/test/unit/ingest-ast-indexing.test.ts`.

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

- Task Status: **__done__**
- Git Commits: e884dca, bdf3108

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
- Jest CLI/config (Context7 `/websites/jestjs_io_30_0`) for Jest 30.x: /websites/jestjs_io_30_0
- Cucumber guides: https://cucumber.io/docs/guides/
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Mermaid diagrams (Context7 `/mermaid-js/mermaid/v11_0_0`): /mermaid-js/mermaid/v11_0_0
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review current AST language routing and supported extension logic:
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
2. [x] Audit for any hard-coded AST language lists or validators:
   - Files to search:
     - `server/src/ast`
     - `server/src/ingest`
     - `server/src/test/unit`
   - Implementation details:
     - Update any arrays or guards (e.g., warm-up language lists) so they include the new languages.
     - Keep response payload shapes unchanged.
     - Update AST tool validation tests if they enumerate allowed language values.
     - Validate extension lists against each grammar’s `tree-sitter.json` file-types so routing matches the published defaults.
   - Documentation to read (repeat):
     - Tree-sitter init docs (query path defaults + `tree-sitter.json` structure): https://tree-sitter.github.io/tree-sitter/cli/init.html
     - tree-sitter-python `tree-sitter.json` example (file-types + tags path): https://docs.rs/crate/tree-sitter-python/0.23.3/source/tree-sitter.json
3. [x] Confirm message contracts and storage shapes remain unchanged:
   - Files to read:
     - `server/src/mongo/astSymbol.ts`
     - `server/src/mongo/astEdge.ts`
     - `server/src/mongo/astReference.ts`
     - `server/src/mongo/astModuleImport.ts`
     - `server/src/ast/toolService.ts`
     - `openapi.json`
   - Implementation details:
     - Ensure no schema or response shape changes are required; only the allowed `language` values expand.
     - If any contracts do enumerate language values, update the enum list but keep shapes unchanged.
4. [x] Extend `AstLanguage` and extension routing:
   - Files to edit:
     - `server/src/ast/types.ts`
     - `server/src/ast/parser.ts`
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Add `python`, `c_sharp`, `rust`, and `cpp` to the `AstLanguage` union and any related schema guards.
     - Map `py`, `cs`, `rs`, `cc`, `cpp`, `cxx`, `hpp`, `hxx`, and `h` to the new languages (no extra overrides beyond grammar defaults).
     - Mapping reference (keep exact lowercase strings):
       - `py` → `python`
       - `cs` → `c_sharp`
       - `rs` → `rust`
       - `cc`/`cpp`/`cxx`/`hpp`/`hxx`/`h` → `cpp`
   - Documentation to read (repeat):
     - Tree-sitter language configuration: /tree-sitter/tree-sitter
     - Tree-sitter C++ grammar (extension defaults + node types): https://github.com/tree-sitter/tree-sitter-cpp
5. [x] Add startup log line for AST extension routing:
   - Files to edit:
     - `server/src/ast/parser.ts`
     - `server/src/logger.ts` (if helper usage is required)
   - Implementation details:
     - Emit log event `DEV-0000033:T1:ast-extension-map` once on server start (e.g., in `warmAstParserQueries`).
     - Include context with `extensions` and `languages`, ensuring the list contains `py`, `cs`, `rs`, `cc/cpp/cxx/hpp/hxx/h` and `python`, `c_sharp`, `rust`, `cpp`.
     - Ensure the log is emitted only once (use a module-level guard).
   - Purpose: Make extension routing visible in logs for manual verification.
   - Documentation to read (repeat):
     - Node.js logging patterns in repo (read existing `append` usage in `server/src/ast/parser.ts`).
6. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Add/confirm the supported AST language list and extension routing summary. If the ingest/AST flow changes, add or update a Mermaid diagram of the AST indexing flow.
   - Purpose: Keep the architecture notes and diagrams aligned with the updated language support.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid: /mermaid-js/mermaid/v11_0_0
7. [x] Update documentation — `projectStructure.md` (if any new files are added in this task; otherwise confirm no change):
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Ensure the tree remains accurate if any files were added or removed.
   - Purpose: Maintain an accurate file map for the repo.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: /eslint/eslint/v9.37.0
     - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (open http://host.docker.internal:5001):
   - Verify the app loads and basic navigation (Chat, Ingest, Logs) works.
   - Confirm the browser console has **no errors**.
   - Capture a screenshot of the Logs page showing the new log line; ensure the agent verifies the GUI state matches expectations.
   - Screenshot storage: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`.
   - Logs page check: confirm `DEV-0000033:T1:ast-extension-map` appears once and includes `py`, `cs`, `rs`, `h` plus the new language names.
9. [x] `npm run compose:down`

#### Implementation notes

- Added new AST language values and extension routing (js/ts/tsx + py/cs/rs/cpp family), updated ingest skip logging to include skipped extensions + reason, and logged the extension map via `DEV-0000033:T1:ast-extension-map`.
- Updated AST ingest skip test to reflect `.py` now supported and ensured skipped extensions are asserted.
- Updated `design.md` with supported language/extension summary and new log line.
- `npm run format:check --workspaces` initially failed on `client/src/pages/AgentsPage.tsx`; ran `npm run format --workspaces` to resolve the pre-existing format issue.
- `npm run lint --workspaces` continues to emit existing import/order warnings in server tests; left unchanged.
- `npm run test --workspace server` timed out at 120s once; reran with extended timeout and passed.

---

### 2. Server: Tree-sitter grammar dependencies + parser wiring

- Task Status: **__in_progress__**
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
- Jest CLI/config (Context7 `/websites/jestjs_io_30_0`) for Jest 30.x: /websites/jestjs_io_30_0
- Cucumber guides: https://cucumber.io/docs/guides/
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Mermaid diagrams (Context7 `/mermaid-js/mermaid/v11_0_0`): /mermaid-js/mermaid/v11_0_0
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review existing parser/query loading patterns:
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
2. [x] Add Tree-sitter grammar dependencies:
   - Files to edit:
     - `server/package.json`
     - `package-lock.json`
   - Implementation details:
     - Add `tree-sitter-python`, `tree-sitter-c-sharp`, `tree-sitter-rust`, and `tree-sitter-cpp` with versions aligned to existing Tree-sitter dependencies (`tree-sitter@0.21.1`, `tree-sitter-javascript@0.23.1`, `tree-sitter-typescript@0.23.2`).
     - Keep the existing `tree-sitter` binding version unchanged unless it blocks grammar loading.
   - Documentation to read (repeat):
     - npm run-script (workspace commands): https://docs.npmjs.com/cli/v10/commands/npm-run-script
3. [x] Extend Tree-sitter module declarations for new grammars:
   - Files to edit:
     - `server/src/types/tree-sitter.d.ts`
   - Implementation details:
     - Add module declarations for each new grammar package so TypeScript can import them cleanly.
   - Documentation to read (repeat):
     - TypeScript handbook (union type updates): /microsoft/typescript/v5.9.2
4. [x] Wire new languages into the parser + query loader:
   - Files to edit:
     - `server/src/ast/parser.ts`
   - Implementation details:
     - Register `python`, `c_sharp`, `rust`, and `cpp` in `getLanguageConfig` or equivalent language map.
     - Load `queries/tags.scm` from each grammar package and load `locals.scm` from `server/src/ast/queries/<language>/locals.scm` for the new languages.
     - Extend any query warm-up lists (e.g., `warmAstParserQueries`) to include the new languages.
   - Documentation to read (repeat):
     - Tree-sitter query syntax + locals capture guide: /tree-sitter/tree-sitter
5. [x] Add startup log line for grammar registration:
   - Files to edit:
     - `server/src/ast/parser.ts`
   - Implementation details:
     - Emit log event `DEV-0000033:T2:ast-grammar-registered` once per new language when grammar configs are registered.
     - Include context with `language` and `package` (e.g., `tree-sitter-python`).
     - Use a `Set` guard so each language logs once.
   - Purpose: Prove grammar registration succeeded for manual verification.
   - Documentation to read (repeat):
     - Node.js logging patterns in repo (read existing `append` usage in `server/src/ast/parser.ts`).
6. [x] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Note the new grammar packages and parser wiring changes. If parser wiring changes alter the AST flow, add/update a Mermaid diagram.
   - Purpose: Record dependency and parser wiring decisions for future reference.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid: /mermaid-js/mermaid/v11_0_0
7. [x] Update documentation — `projectStructure.md` (if any files were added in this task; otherwise confirm no change):
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Ensure the tree remains accurate after dependency and wiring changes.
   - Purpose: Keep the repo file map consistent with dependency and wiring updates.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: /eslint/eslint/v9.37.0
     - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check (open http://host.docker.internal:5001):
   - Verify the app loads and basic navigation (Chat, Ingest, Logs) works.
   - Confirm the browser console has **no errors**.
   - Capture a screenshot of the Logs page showing grammar registration; ensure the agent verifies the GUI state matches expectations.
   - Screenshot storage: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`.
   - Logs page check: confirm `DEV-0000033:T2:ast-grammar-registered` appears for `python`, `c_sharp`, `rust`, `cpp`.
9. [x] `npm run compose:down`

#### Implementation notes

- Added `tree-sitter-python`, `tree-sitter-c-sharp`, `tree-sitter-rust`, and `tree-sitter-cpp` dependencies and module declarations.
- Updated AST parser to load tags from grammar packages, locals from new query paths, and log `DEV-0000033:T2:ast-grammar-registered` once per language; warmed queries for new languages.
- Documented grammar registration log in `design.md`.
- Ran `npm run lint --workspaces` (existing import/order warnings) and `npm run format --workspaces` after initial format check failure.
- Testing: builds, unit tests, e2e, compose up/down, and Playwright UI check; screenshot saved to `playwright-output-local/0000033-2-logs-grammar-registered.png`.

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
- Jest CLI/config (Context7 `/websites/jestjs_io_30_0`) for Jest 30.x: /websites/jestjs_io_30_0
- Cucumber guides: https://cucumber.io/docs/guides/
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Mermaid diagrams (Context7 `/mermaid-js/mermaid/v11_0_0`): /mermaid-js/mermaid/v11_0_0
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
     - Node type file locations to consult:
       - `node_modules/tree-sitter-python/src/node-types.json`
       - `node_modules/tree-sitter-c-sharp/src/node-types.json`
       - `node_modules/tree-sitter-rust/src/node-types.json`
       - `node_modules/tree-sitter-cpp/src/node-types.json`
   - Example snippet (use node names from each grammar’s `node-types.json`):
     - `(identifier) @local.reference`
   - Documentation to read (repeat):
     - Tree-sitter query syntax + locals capture guide: /tree-sitter/tree-sitter
3. [ ] Add parser unit test for **Python** locals capture (happy path):
   - Test type: Unit (parser output).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Add a minimal `.py` fixture, assert `result.language === 'python'`, and verify at least one `@local.definition` and one `@local.reference`, plus non-empty references.
   - Minimal fixture example:
     - `def greet():\n  name = "hi"\n  print(name)\n\n` (ensure a definition + reference).
   - Purpose: Confirms Python locals queries produce definitions and references.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
     - Tree-sitter query syntax: /tree-sitter/tree-sitter
4. [ ] Add parser unit test for **C#** locals capture (happy path):
   - Test type: Unit (parser output).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Add a minimal `.cs` fixture, assert `result.language === 'c_sharp'`, and verify at least one `@local.definition` and one `@local.reference`, plus non-empty references.
   - Minimal fixture example:
     - `class Widget { void Run() { var id = 1; System.Console.WriteLine(id); } }`
   - Purpose: Confirms C# locals queries produce definitions and references.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
     - Tree-sitter query syntax: /tree-sitter/tree-sitter
5. [ ] Add parser unit test for **Rust** locals capture (happy path):
   - Test type: Unit (parser output).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Add a minimal `.rs` fixture, assert `result.language === 'rust'`, and verify at least one `@local.definition` and one `@local.reference`, plus non-empty references.
   - Minimal fixture example:
     - `fn greet() { let id = 1; println!("{}", id); }`
   - Purpose: Confirms Rust locals queries produce definitions and references.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
     - Tree-sitter query syntax: /tree-sitter/tree-sitter
6. [ ] Add parser unit test for **C++** locals capture (happy path):
   - Test type: Unit (parser output).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Add a minimal `.h` fixture (to validate header routing), assert `result.language === 'cpp'`, and verify at least one `@local.definition` and one `@local.reference`, plus non-empty references.
   - Minimal fixture example:
     - `int add(int value) { int total = value + 1; return total; }`
   - Purpose: Confirms C++ locals queries produce definitions and references.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
     - Tree-sitter query syntax: /tree-sitter/tree-sitter
7. [ ] Add parser error test for **missing query bundle** on a new language:
   - Test type: Unit (parser failures).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Use a new-language extension (e.g., `.py`) with `queryBundleOverride: null` and assert `Missing Tree-sitter query files`.
   - Minimal fixture example:
     - Reuse the `.py` fixture text from the Python happy-path subtask.
   - Purpose: Ensures the error path for missing queries is exercised for new languages.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
8. [ ] Add parser error test for **missing grammar binding** on a new language:
   - Test type: Unit (parser failures).
   - Test location: `server/src/test/unit/ast-parser.test.ts`.
   - Description: Use a new-language extension (e.g., `.rs`) with `parserLanguageOverride: null` and assert `Tree-sitter grammar unavailable`.
   - Minimal fixture example:
     - Reuse the `.rs` fixture text from the Rust happy-path subtask.
   - Purpose: Ensures the grammar-load failure path is covered for new languages.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
9. [ ] Add log line for custom locals query loading:
   - Files to edit:
     - `server/src/ast/parser.ts`
   - Implementation details:
     - Emit log event `DEV-0000033:T3:ast-locals-query-loaded` when a locals query is loaded from `server/src/ast/queries/<language>/locals.scm`.
     - Include context `{ language, localsPath }` and ensure it logs once per language.
   - Purpose: Confirm custom locals queries are loaded for manual verification.
   - Documentation to read (repeat):
     - Node.js logging patterns in repo (read existing `append` usage in `server/src/ast/parser.ts`).
10. [ ] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Note that Python/C#/Rust/C++ locals queries are CodeInfo2-owned and record any dependency version changes made to obtain tags. Add/update a Mermaid diagram if query wiring changes the AST flow.
   - Purpose: Capture AST query ownership and any flow adjustments for maintainers.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid: /mermaid-js/mermaid/v11_0_0
11. [ ] Update documentation — `projectStructure.md` **after** adding locals query files:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add **all** new `server/src/ast/queries/*/locals.scm` files to the tree (python, c_sharp, rust, cpp) and include any removed/renamed files if applicable.
   - Purpose: Keep the file tree accurate after adding new query assets and reflect all file changes.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read (repeat):
      - ESLint CLI: /eslint/eslint/v9.37.0
      - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check (open http://host.docker.internal:5001):
   - Verify the app loads and basic navigation (Chat, Ingest, Logs) works.
   - Confirm the browser console has **no errors**.
   - Capture a screenshot of the Logs page showing locals query load; ensure the agent verifies the GUI state matches expectations.
   - Screenshot storage: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`.
   - Logs page check: confirm `DEV-0000033:T3:ast-locals-query-loaded` appears for `python`, `c_sharp`, `rust`, `cpp` and references `server/src/ast/queries/` paths.
9. [ ] `npm run compose:down`

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
- Jest CLI/config (Context7 `/websites/jestjs_io_30_0`) for Jest 30.x: /websites/jestjs_io_30_0
- Cucumber guides: https://cucumber.io/docs/guides/
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`, latest available for ESLint 9.x): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Mermaid diagrams (Context7 `/mermaid-js/mermaid/v11_0_0`): /mermaid-js/mermaid/v11_0_0
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
3. [ ] Add ingest test for **supported extension coverage** (happy path):
   - Test type: Unit (ingest AST indexing).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Description: Add fixture files for `.py`, `.cs`, `.rs`, `.cpp`, `.h` and assert they are counted as AST-supported during ingest.
   - Fixture name suggestions (keep tiny files):
     - `python/sample.py`, `csharp/sample.cs`, `rust/sample.rs`, `cpp/sample.cpp`, `cpp/sample.h`
   - Purpose: Confirms new language extensions are treated as supported inputs.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
4. [ ] Add ingest test for **unsupported extension skip** (error path):
   - Test type: Unit (ingest AST indexing).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Description: Include a `.pyw` (or other unsupported) file and assert it is *not* treated as Python and appears in the unsupported-extension log with the skip reason.
   - Fixture name suggestion:
     - `python/unsupported.pyw`
   - Purpose: Confirms unsupported extensions are rejected with explicit logging.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
5. [ ] Add ingest test for **reembed AST attempts** on new languages (happy path):
   - Test type: Unit (ingest AST indexing).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Description: Assert reembed paths still attempt AST parsing for `.py`, `.cs`, `.rs`, `.cpp`, `.h` even when vector delta logic skips embeddings.
   - Implementation hint:
     - Use the existing AST parser stub hook (`__setParseAstSourceForTest`) to record calls and assert each extension is attempted.
   - Purpose: Ensures AST parsing runs during reembed for supported languages.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
6. [ ] Add ingest test for **missing-queries log absence** on new languages (corner case):
   - Test type: Unit (ingest AST indexing).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Description: Assert logs do **not** include “Tree-sitter query files missing; skipping AST parse” for `.py`, `.cs`, `.rs`, `.cpp`.
   - Implementation hint:
     - Use the existing logStore query helper to assert absence of the `DEV-0000032:T4:ast-queries-missing` event.
   - Purpose: Ensures new locals queries are wired and the missing-queries warning is not emitted.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
   - Notes:
     - Extend the existing ingest AST indexing test file rather than creating new tests.
7. [ ] Add log line for AST ingest configuration:
   - Files to edit:
     - `server/src/ingest/ingestJob.ts`
   - Implementation details:
     - Emit log event `DEV-0000033:T4:ast-ingest-config` once per ingest run before AST parsing begins.
     - Include context `{ supportedExtensions, root }`.
   - Purpose: Confirm ingest AST coverage is configured and visible in logs.
   - Documentation to read (repeat):
     - Node.js logging patterns in repo (read existing `logLifecycle`/`logWarning` usage in `server/src/ingest/ingestJob.ts`).
8. [ ] Validate no regressions to embedding counts or model-locking behavior:
   - Files to read:
     - `server/src/test/unit/ingest-status.test.ts`
     - `server/src/test/unit/ingest-root-metadata.test.ts` (if present)
   - Implementation details:
     - Confirm existing tests that assert embedding counts or model locks still pass without updates.
     - If expectations need adjustment due to new AST fields, update only the AST-related fields; keep embedding counts and model lock assertions unchanged.
   - Documentation to read (repeat):
     - Node.js test runner: /nodejs/node/v22.17.0
9. [ ] Update documentation — `design.md`:
   - Document: `design.md`.
   - Location: `design.md`.
   - Description: Document ingest AST indexing coverage for Python/C#/Rust/C++ and note the skip-log behaviour. Add/update a Mermaid diagram if ingest flow changes.
   - Purpose: Document ingest flow changes and ensure diagrams match updated behavior.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid: /mermaid-js/mermaid/v11_0_0
10. [ ] Update documentation — `projectStructure.md` **after** adding any fixture files:
   - Document: `projectStructure.md`.
   - Location: `projectStructure.md`.
   - Description: Add **all** new fixture files (and any removed/renamed fixture files) to the tree if introduced.
   - Purpose: Keep the repo tree accurate when fixtures change and capture all file changes.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read (repeat):
      - ESLint CLI: /eslint/eslint/v9.37.0
      - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check (open http://host.docker.internal:5001):
   - Verify the app loads and basic navigation (Chat, Ingest, Logs) works.
   - Confirm the browser console has **no errors**.
   - Capture a screenshot of the Logs page showing ingest config; ensure the agent verifies the GUI state matches expectations.
   - Screenshot storage: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`.
   - Logs page check: confirm `DEV-0000033:T4:ast-ingest-config` appears and lists the new extensions.
9. [ ] `npm run compose:down`

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
- Cucumber guides: https://cucumber.io/docs/guides/
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
   - Purpose: Keep top-level usage and commands current.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
5. [ ] Ensure `design.md` is updated with any required description changes and mermaid diagrams added during this story.
   - Purpose: Ensure architecture notes and diagrams match implemented behavior.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid: /mermaid-js/mermaid/v11_0_0
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders.
   - Purpose: Maintain an accurate inventory of the repo tree.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
7. [ ] Create a concise summary of all changes in this story and draft a pull request comment covering all tasks.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: /eslint/eslint/v9.37.0
     - Prettier CLI: /prettier/prettier/3.6.2

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check (open http://host.docker.internal:5001):
   - Verify the app loads and basic navigation (Chat, Ingest, Logs) works.
   - Confirm the browser console has **no errors**.
   - Capture screenshots of Chat, Ingest, and Logs pages; ensure the agent verifies the GUI matches acceptance criteria and general regressions.
   - Screenshot storage: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`.
   - After capture, copy the screenshots into `./test-results/screenshots/` and name them with plan index, task number, and scenario.
9. [ ] `npm run compose:down`

#### Implementation notes

- 

---
