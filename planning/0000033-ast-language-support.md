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

## Implementation Placement (CodeInfo2)

- Store custom locals queries alongside the AST parser as first‑class assets in CodeInfo2, under:
  - `server/src/ast/queries/<language>/locals.scm`
- Add a language‑specific loader in `server/src/ast/parser.ts` that prefers these local `locals.scm` files for languages lacking grammar‑provided locals queries.
- Keep tags queries sourced from the grammar packages (`queries/tags.scm`) for languages that provide them.

---

## Validation & Testing Approach

- Create a minimal fixture file per language containing:
  - At least one function and class/struct (where applicable)
  - Local variable declarations and references
  - A function call that references a locally declared symbol
- Add parser‑level tests to assert:
  - `locals.scm` captures both `@local.definition` and `@local.reference` for each language
  - The AST output includes references for those symbols (non‑empty references result)
- Verify ingest logs show successful AST indexing for each language and no `locals.scm` missing warnings.

---

## Implementation Ideas

- Update `AstLanguage` to include `python`, `c_sharp`, `rust`, and `cpp`, then extend `normalizeLanguage` with the tree‑sitter.json defaults (`py`, `cs`, `rs`, `cc/cpp/cxx/hpp/hxx/h`).
- Add grammar bindings and package roots in `server/src/ast/parser.ts`, plus `server/src/types/tree-sitter.d.ts` module declarations for the new grammar packages so Node can load them.
- Extend `loadQueries` to read `queries/tags.scm` from each grammar package and `server/src/ast/queries/<language>/locals.scm` for languages without upstream locals; keep the query cache and warm‑up behavior aligned with new languages.
- Add the new extensions to `astSupportedExtensions` and keep ingest/reembed calling AST parsing for those files; confirm unsupported extensions still log a skip reason.
- Create `server/src/ast/queries/<language>/locals.scm` for python/c_sharp/rust/cpp and add minimal fixtures + unit tests in `server/src/test/unit/ast-parser.test.ts` and ingest gating coverage in `server/src/test/unit/ingest-ast-indexing.test.ts`.
- Ensure AST tool tests (e.g., `server/src/test/unit/ast-tool-validation.test.ts`) accept the new language values without schema changes.

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

## Tasks

Tasks will be added once the Questions section is fully resolved.
