# Story 0000017 – Agent working_folder + Codex model/reasoning updates

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

It expands the existing Agents feature (Story `0000016`) with:

1. A new optional parameter `working_folder` for agent runs (GUI + REST + MCP `5012`).
2. Updated Codex model + reasoning-effort options:
   - Add Codex model `gpt-5.2` to the fixed Codex model list returned by `/chat/models?provider=codex`.
   - Add a new reasoning effort option `xhigh` (the new highest option) anywhere we present/validate Codex reasoning effort.

Agents must continue to be Codex-only and config-driven (agent `config.toml` remains the source of truth for runtime defaults like sandbox/approval/reasoning/network/websearch when `useConfigDefaults` is enabled).

---

## Description

Today, agent runs always execute with the server’s configured Codex working directory (typically `CODEX_WORKDIR` / `CODEINFO_CODEX_WORKDIR` / `/data`). This makes it awkward to run an agent “from inside” a particular repository folder when the host has multiple ingest roots or multiple nested projects.

We want to allow the caller (Agents GUI or Agents MCP) to optionally provide a `working_folder` so the agent executes as-if it was started from that directory.

The `working_folder` should be treated as a **host path** by default and mapped into the server/Codex working directory when possible. If the mapped path does not exist (or mapping is not possible), we then fall back to treating the input as a literal path in the server runtime. If neither exists, we return a clear error to the caller.

Separately, we need to keep Codex UI/options up to date by adding `gpt-5.2` and a new highest reasoning effort `xhigh`.

---

## Acceptance Criteria

- Agents: new optional `working_folder` parameter is supported end-to-end:
  - Agents GUI can set `working_folder` when running an instruction.
  - REST `POST /agents/:agentName/run` accepts `working_folder`.
  - Agents MCP `run_agent_instruction` accepts `working_folder`.
  - When omitted/empty, existing behavior remains unchanged.
- `working_folder` resolution logic:
  1. Treat input as a **host path** first.
  2. Attempt to map it via:
     - normalize `HOST_INGEST_DIR` and `working_folder` to POSIX-style (replace `\\` with `/`, then `path.posix.normalize`)
     - compute `relPath` by removing the `HOST_INGEST_DIR` prefix **only if** `working_folder` is inside `HOST_INGEST_DIR` (boundary-aware)
     - compute `mapped = join( CODEX_WORKDIR || CODEINFO_CODEX_WORKDIR || '/data', relPath )`
     - if `mapped` exists **and is a directory**, use it as the Codex `workingDirectory` for this call.
  3. If the mapped path does not exist, check `working_folder` **as provided** (no mapping) and:
     - if it exists **and is a directory**, use it as the Codex `workingDirectory` for this call.
  4. If neither candidate exists, return an error:
     - REST returns `400` with a stable error code (and a safe, human-readable message).
     - MCP returns a JSON-RPC tool error that callers can treat as invalid params (and includes a safe message).
- Security/safety:
  - The mapping attempt must not allow escaping `CODEINFO_CODEX_WORKDIR` via `..` segments when the host path is outside `HOST_INGEST_DIR` (i.e. mapping must be skipped or rejected when `working_folder` is not under `HOST_INGEST_DIR`).
  - The server must not crash on odd path separators; normalization should be consistent across host/container paths.
- Input rules:
  - `working_folder` must be an **absolute** path (POSIX or Windows). Relative paths are rejected with a `400`/invalid-params error.
    - Implementation detail: use `path.posix.isAbsolute(...) || path.win32.isAbsolute(...)` (do **not** use only `path.isAbsolute`, because the server may run on Linux while receiving Windows-style paths).
  - If `HOST_INGEST_DIR` is not set, the host-path mapping attempt is skipped and only the literal path check is performed.
- Codex model list:
  - `/chat/models?provider=codex` includes `gpt-5.2` in addition to the existing fixed Codex models.
  - Client UI that relies on the Codex model list continues to function; tests updated accordingly.
- Codex reasoning effort:
  - Any Codex reasoning-effort dropdown/validation includes `xhigh` as the new highest option.
  - Existing defaults remain unchanged (`high` stays the default).
  - `xhigh` is passed through to Codex via the installed `@openai/codex-sdk` (it forwards `model_reasoning_effort="..."` to the Codex CLI). No “down-mapping” is performed in this story.
- Documentation:
  - `README.md`, `design.md`, and `projectStructure.md` are updated to reflect:
    - the new `working_folder` parameter and its resolution/mapping rules
    - the new Codex model `gpt-5.2` and reasoning effort `xhigh`

---

## Out Of Scope

- Adding provider/model selection controls for agents.
- Changing the agent discovery folder conventions (`CODEINFO_CODEX_AGENT_HOME/<agentName>`).
- Changing non-agent chat working directory behavior.
- Adding new MCP tools beyond expanding `run_agent_instruction`.
- Changing how ingest roots are discovered or mounted; this story only uses existing env (`HOST_INGEST_DIR`, `CODEX_WORKDIR` / `CODEINFO_CODEX_WORKDIR`).
- MCP v2 `codebase_question` tool behavior (it still uses its current Codex defaults and does not add new Codex model / reasoning-effort parameters in this story).

---

## Questions

---

# Implementation Plan

## Instructions

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

# Tasks

### 1. Extend path mapping for working_folder (host → workdir)

- Task Status: **completed**
- Git Commits: d7f5f18, 6d65d49, f0aead8

#### Overview

Reuse and extend the existing ingest path mapping module to support mapping an agent-run `working_folder` from a host path into the Codex workdir, including traversal guards and unit tests.

#### Documentation Locations

- Node.js `path` docs: https://nodejs.org/api/path.html (for `isAbsolute`, `normalize`, and safe path joining)
- Node.js `fs` docs (`fs.promises.stat`): https://nodejs.org/api/fs.html#fspromisesstatpath-options (for “exists and is a directory” checks used by tests)
- TypeScript string literal unions: Context7 `/microsoft/typescript` (for typing the `{ error: { code: ... } }` return shape)
- Cucumber guides: https://cucumber.io/docs/guides/ (server `npm run test` runs Cucumber feature tests)

#### Subtasks

1. [x] Read and understand existing mapper + tests:
   - Docs to read:
     - https://nodejs.org/api/path.html
     - https://nodejs.org/api/test.html (repo uses `node:test` for unit tests)
     - Context7 `/microsoft/typescript`
   - Files to read:
     - `server/src/ingest/pathMap.ts`
     - `server/src/test/unit/pathMap.test.ts`
   - Goal: match existing normalization conventions and avoid introducing a second mapping style.
2. [x] Add a new exported helper in `server/src/ingest/pathMap.ts` (do not create a new module for this):
   - Docs to read:
     - https://nodejs.org/api/path.html (POSIX paths, `normalize`, `join`, `isAbsolute`)
     - Context7 `/microsoft/typescript` (string literal unions for the return type)
   - File to edit:
     - `server/src/ingest/pathMap.ts`
   - Add a new exported function (name explicit): `mapHostWorkingFolderToWorkdir(...)`.
   - Required signature (copy exactly):
     ```ts
     export function mapHostWorkingFolderToWorkdir(
       hostWorkingFolder: string,
       opts: { hostIngestDir: string; codexWorkdir: string },
     ):
       | { mappedPath: string; relPath: string }
       | {
           error: {
             code: 'INVALID_ABSOLUTE_PATH' | 'OUTSIDE_HOST_INGEST_DIR';
             message: string;
           };
         };
     ```
   - Required algorithm (copy/paste guidance):
     - Use the same normalization conventions as `mapIngestPath()`:
       - `normalizedHostWorkingFolder = path.posix.normalize(hostWorkingFolder.replace(/\\\\/g, '/'))`
       - `normalizedHostIngestDir = path.posix.normalize(opts.hostIngestDir.replace(/\\\\/g, '/'))`
       - `normalizedCodexWorkdir = path.posix.normalize(opts.codexWorkdir.replace(/\\\\/g, '/'))`
     - Validate `path.posix.isAbsolute(normalizedHostWorkingFolder)` and `path.posix.isAbsolute(normalizedHostIngestDir)`; else return `INVALID_ABSOLUTE_PATH`.
       - Note: Windows absolute paths are handled at the _service_ layer in Task 2 and will typically skip mapping; this helper is intentionally POSIX-style to match the existing `pathMap.ts` module.
   - **Simpler + lower-risk containment check (no `relative()`):**
     - `hostIngestDirNoTrailingSlash = normalizedHostIngestDir !== '/' && normalizedHostIngestDir.endsWith('/') ? normalizedHostIngestDir.slice(0, -1) : normalizedHostIngestDir`
     - If `normalizedHostWorkingFolder === hostIngestDirNoTrailingSlash`: treat as “inside” and set `relPath = ''`
     - Else if `normalizedHostWorkingFolder.startsWith(hostIngestDirNoTrailingSlash + '/')`: set `relPath = normalizedHostWorkingFolder.slice(hostIngestDirNoTrailingSlash.length + 1)`
     - Else: return `OUTSIDE_HOST_INGEST_DIR`
   - Return `{ mappedPath: path.posix.join(normalizedCodexWorkdir, relPath), relPath }`.
   - KISS + risk control:
     - Do not resolve symlinks.
     - Do not modify existing `mapIngestPath` behavior in this story.
3. [x] Add a dedicated test section for the new helper:
   - Docs to read:
     - https://nodejs.org/api/test.html (test structure + assertions patterns)
     - https://nodejs.org/api/path.html (path behavior the tests are exercising)
   - File to edit:
     - `server/src/test/unit/pathMap.test.ts`
   - Instruction (be explicit):
     - Add a new `describe('mapHostWorkingFolderToWorkdir', () => { ... })` block (or match the file’s existing style if it doesn’t use `describe`).
     - Put the three tests below (Subtasks 4–7) inside that block so a reader can find them quickly.
4. [x] **Test (server unit, `node:test`)**: maps host path under ingest root
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/path.html
   - Location: `server/src/test/unit/pathMap.test.ts`
   - Purpose: prove `mapHostWorkingFolderToWorkdir()` produces `{ mappedPath, relPath }` for a valid absolute path under `hostIngestDir`.
   - Description:
     - Given `hostIngestDir=/host/base` and `codexWorkdir=/data` and `hostWorkingFolder=/host/base/repo/sub`,
   - expect `relPath === 'repo/sub'`
   - expect `mappedPath` ends with `/data/repo/sub`.
5. [x] **Test (server unit, `node:test`)**: rejects host path outside ingest root
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/path.html
   - Location: `server/src/test/unit/pathMap.test.ts`
   - Purpose: prevent path traversal / escape by ensuring mapping is refused when outside `hostIngestDir`.
   - Description:
     - Given `hostIngestDir=/host/base`, `hostWorkingFolder=/host/other/repo`,
     - expect `{ error: { code: 'OUTSIDE_HOST_INGEST_DIR' } }`.
6. [x] **Test (server unit, `node:test`)**: rejects prefix-but-not-child paths
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/path.html
   - Location: `server/src/test/unit/pathMap.test.ts`
   - Purpose: ensure the containment check is boundary-aware (e.g. `/host/base2` is NOT inside `/host/base`).
   - Description:
     - Given `hostIngestDir=/host/base`, `hostWorkingFolder=/host/base2/repo`,
     - expect `{ error: { code: 'OUTSIDE_HOST_INGEST_DIR' } }`.
7. [x] **Test (server unit, `node:test`)**: rejects non-absolute working folder input
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/path.html
   - Location: `server/src/test/unit/pathMap.test.ts`
   - Purpose: enforce the story rule “working_folder must be absolute” at the mapping layer.
   - Description:
     - Given `hostWorkingFolder='relative/path'`,
     - expect `{ error: { code: 'INVALID_ABSOLUTE_PATH' } }`.
8. [x] Verification commands (must run before moving to Task 2):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script (how `npm run <script>` works)
   - `npm run lint --workspace server`
   - `npm run test --workspace server`
9. [x] Repo-wide lint + format gate (must be the last subtask in every task):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - `/agents` loads and lists agents (baseline regression)
   - `/agents` can run an instruction without `working_folder` (baseline regression)
   - No new UI regressions on `/chat` (baseline smoke: page loads, no console errors)
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Implemented `mapHostWorkingFolderToWorkdir()` in `server/src/ingest/pathMap.ts` with POSIX normalization (\\→/ + `path.posix.normalize`) and a boundary-aware inside-root check.
- Returns `{ mappedPath, relPath }` on success or a small `{ error: { code, reason } }` union for invalid/unsafe inputs without changing existing `mapIngestPath()` behavior.
- Added unit coverage under `describe('mapHostWorkingFolderToWorkdir', ...)` for happy path + outside-root + prefix-but-not-child + non-absolute inputs.
- Hardened Codex integration tests by clearing `CODEX_WORKDIR`/`CODEINFO_CODEX_WORKDIR` during tests so assertions about the default `/data` workdir are deterministic across dev environments.
- Updated `server/src/ingest/chromaClient.ts` to treat empty/whitespace `CHROMA_URL` as “unset” so the server test runner’s `CHROMA_URL=''` does not crash URL parsing.
- In this environment, `npm run e2e` required `CODEX_HOME` to be set to a host-shared path (used `CODEX_HOME=$PWD/codex`) to avoid Docker Desktop “mounts denied” errors.
- Completed the manual `/agents` + `/chat` smoke check with Playwright and captured screenshots under `test-results/screenshots/`.


---

### 2. Server: wire working_folder into agent execution (service + ChatInterfaceCodex)

- Task Status: **completed**
- Git Commits: 594301d

#### Overview

Resolve `working_folder` in the agents service, apply the per-call working directory override in Codex thread options, and return stable, caller-friendly errors when resolution fails.

#### Documentation Locations

- Node.js `fs` docs (`fs.promises.stat`): https://nodejs.org/api/fs.html#fspromisesstatpath-options (to check directory existence safely)
- Node.js `path` docs: https://nodejs.org/api/path.html (absolute path checks + normalization)
- Codex CLI config reference (for context on CODEX_HOME + config precedence): Context7 `/openai/codex`
- `@openai/codex-sdk` runtime behavior (how `modelReasoningEffort` and `workingDirectory` are forwarded to the Codex CLI): code_info MCP (inspect the installed `@openai/codex-sdk` package in this repo)
- Mermaid syntax (diagrams for this flow): Context7 `/mermaid-js/mermaid`
- Cucumber guides: https://cucumber.io/docs/guides/ (server `npm run test` runs Cucumber feature tests)

#### Subtasks

1. [x] Extend the service input type:
   - Docs to read:
     - https://nodejs.org/api/path.html (absolute path rules referenced later in this task)
   - Files to read:
     - `server/src/agents/service.ts`
   - File to edit:
     - `server/src/agents/service.ts`
   - Add to `RunAgentInstructionParams`:
     - `working_folder?: string;`
2. [x] Extend the service error union to include working-folder errors:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status (these codes will later be surfaced as HTTP 400)
   - Files to read:
     - `server/src/agents/service.ts`
   - File to edit:
     - `server/src/agents/service.ts`
   - Update `RunAgentErrorCode` to also include:
     - `WORKING_FOLDER_INVALID`
     - `WORKING_FOLDER_NOT_FOUND`
3. [x] Add an exported resolver helper (so it can be unit-tested without running Codex):
   - Docs to read:
     - https://nodejs.org/api/fs.html#fspromisesstatpath-options (directory existence checks)
     - https://nodejs.org/api/path.html (POSIX + win32 absolute checks)
   - Files to read:
     - `server/src/agents/service.ts`
     - `server/src/ingest/pathMap.ts` (new helper from Task 1)
     - `server/src/ingest/discovery.ts` (existing pattern: `fs.stat(...).catch(() => null)` to avoid throwing on ENOENT/permissions)
     - `server/src/agents/discovery.ts` (existing pattern: safe `fs.stat` wrapper that treats ENOENT as missing)
   - File to edit:
     - `server/src/agents/service.ts`
   - Add a new exported function (name explicit, copy exactly):
     ```ts
     export async function resolveWorkingFolderWorkingDirectory(
       working_folder: string | undefined,
     ): Promise<string | undefined>;
     ```
   - Required rules (must implement exactly):
     - If `working_folder` is omitted/empty string (after `trim()`): return `undefined`.
     - If `working_folder` is provided but not an absolute path (POSIX or Windows): throw `{ code: 'WORKING_FOLDER_INVALID', reason: 'working_folder must be an absolute path' }`.
       - Use `path.posix.isAbsolute(normalized) || path.win32.isAbsolute(raw)` for this check.
       - Where `normalized = working_folder.replace(/\\\\/g, '/')` and `raw = working_folder` (unmodified).
     - `hostIngestDir = process.env.HOST_INGEST_DIR` (if missing/empty → skip mapping attempt).
     - `codexWorkdir = process.env.CODEX_WORKDIR ?? process.env.CODEINFO_CODEX_WORKDIR ?? '/data'`
     - Try mapped path first (host → workdir):
       - Only attempt mapping when:
         - `hostIngestDir` is set (non-empty), AND
         - both `hostIngestDir` and `working_folder` are POSIX-absolute after `\\`→`/` normalization.
       - Call `mapHostWorkingFolderToWorkdir(...)`.
       - If it returns `{ mappedPath }` and `mappedPath` exists **and is a directory**, return `mappedPath`.
       - If it returns an error (including `OUTSIDE_HOST_INGEST_DIR`): treat it as “mapping not possible” and continue to literal check (do **not** error).
     - Literal fallback:
       - If `working_folder` exists **and is a directory**, return `working_folder` exactly as provided (do not normalize).
     - Error handling (important to avoid 500s):
       - When checking “exists and is a directory”, treat any filesystem error (ENOENT, ENOTDIR, EACCES, etc.) as “does not exist” and continue/fail with `WORKING_FOLDER_NOT_FOUND` (do not allow uncaught stat errors to bubble up).
       - Reuse the repo’s existing approach from `server/src/ingest/discovery.ts` / `server/src/agents/discovery.ts` (don’t invent a new error-handling convention).
     - If neither candidate exists as a directory: throw `{ code: 'WORKING_FOLDER_NOT_FOUND', reason: 'working_folder not found' }`.
4. [x] Thread the chosen working directory into Codex execution:
   - Docs to read:
     - Context7 `/openai/codex` (Codex CLI option semantics; confirms `workingDirectory` is valid)
     - code_info MCP: inspect installed `@openai/codex-sdk` (how thread options are forwarded)
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - File to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Add to `CodexRunFlags`:
     - `workingDirectoryOverride?: string;`
   - Apply it when constructing `threadOptions` (both `useConfigDefaults` and non-config branches):
     - `workingDirectory: workingDirectoryOverride ?? (process.env.CODEX_WORKDIR ?? process.env.CODEINFO_CODEX_WORKDIR ?? '/data')`
5. [x] Wire the resolved directory into agent runs:
   - Docs to read:
     - https://nodejs.org/api/path.html (why we treat empty/whitespace as “unset”)
   - Files to read:
     - `server/src/agents/service.ts`
   - File to edit:
     - `server/src/agents/service.ts`
   - When calling `chat.run(...)`, include:
     - `workingDirectoryOverride: await resolveWorkingFolderWorkingDirectory(params.working_folder)` (or omit if it resolves to `undefined`)
6. [x] **Test (server unit, `node:test`)**: invalid `working_folder` (relative path) is rejected by the resolver
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/path.html
   - Location: `server/src/test/unit/agents-working-folder.test.ts` (new)
   - Purpose: ensure `resolveWorkingFolderWorkingDirectory()` throws `WORKING_FOLDER_INVALID` before any Codex run is attempted.
   - Description:
     - call `resolveWorkingFolderWorkingDirectory('relative/path')`
     - expect thrown error `{ code: 'WORKING_FOLDER_INVALID' }`.
7. [x] **Test (server unit, `node:test`)**: mapped path exists → resolver returns mapped path
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/fs.html#fspromisesmkdirpath-options (if you need to create temp dirs)
   - Location: `server/src/test/unit/agents-working-folder.test.ts` (new)
   - Purpose: verify the “host path → host ingest rel → codex workdir” mapping is applied when possible.
   - Description:
     - set `HOST_INGEST_DIR=/host/base` and `CODEINFO_CODEX_WORKDIR=/data`
     - provide `working_folder=/host/base/repo/sub`
     - arrange filesystem so `/data/repo/sub` exists as a directory
     - assert `resolveWorkingFolderWorkingDirectory('/host/base/repo/sub')` returns `/data/repo/sub`.
8. [x] **Test (server unit, `node:test`)**: mapped path missing but literal exists → resolver returns literal
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/fs.html#fspromisesmkdirpath-options
   - Location: `server/src/test/unit/agents-working-folder.test.ts` (new)
   - Purpose: verify fallback behavior when mapping cannot be used.
   - Description:
     - set `HOST_INGEST_DIR=/host/base` and `CODEINFO_CODEX_WORKDIR=/data`
     - provide `working_folder=/some/literal/dir`
     - ensure mapped path does not exist, but `/some/literal/dir` exists as a directory
     - assert `resolveWorkingFolderWorkingDirectory('/some/literal/dir')` returns `/some/literal/dir`.
9. [x] **Test (server unit, `node:test`)**: neither mapped nor literal exists → resolver throws `WORKING_FOLDER_NOT_FOUND`
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Location: `server/src/test/unit/agents-working-folder.test.ts` (new)
   - Purpose: guarantee callers get a stable error when no directory exists.
   - Description:
     - provide an absolute `working_folder` where neither mapped nor literal directory exists
     - expect thrown error `{ code: 'WORKING_FOLDER_NOT_FOUND' }`.
10. [x] **Test (server unit, `node:test`)**: ChatInterfaceCodex uses `workingDirectoryOverride` when provided

- Docs to read:
  - https://nodejs.org/api/test.html
  - code_info MCP: inspect installed `@openai/codex-sdk` (which options are passed to `startThread`)
- Location: `server/src/test/unit/chat-codex-workingDirectoryOverride.test.ts` (new)
- Purpose: ensure the Codex adapter actually uses the per-call override (without involving the agents service).
- Description:
  - construct a `ChatInterfaceCodex` with a stub `codexFactory` that captures `startThread(opts)`
  - call `chat.run('Hello', { workingDirectoryOverride: '/tmp/override', useConfigDefaults: true }, ...)`
  - assert captured `opts.workingDirectory === '/tmp/override'`.

11. [x] Update `design.md` with the new agent working-directory override flow (include Mermaid diagram) (do this after implementing the resolver + override wiring above):

- Docs to read:
  - Context7 `/mermaid-js/mermaid` (diagram syntax)
- Files to edit:
  - `design.md`
- Add a section describing how agent runs resolve `working_folder` and choose the final Codex `workingDirectory`.
- Add a Mermaid `flowchart` showing the resolution order:
  - absolute validation → mapped candidate (HOST_INGEST_DIR → CODEX_WORKDIR) → literal fallback → error
- Include the two stable error codes: `WORKING_FOLDER_INVALID`, `WORKING_FOLDER_NOT_FOUND`.

12. [x] Update `projectStructure.md` to include new server test files (do this after creating the files above):

- Docs to read:
  - https://www.markdownguide.org/basic-syntax/ (safe Markdown editing)
- Files to edit:
  - `projectStructure.md`
- Add entries under `server/src/test/unit/` for:
  - `agents-working-folder.test.ts`
  - `chat-codex-workingDirectoryOverride.test.ts`

13. [x] Verification commands (must run before moving to Task 3):

- Docs to read:
  - https://docs.npmjs.com/cli/v10/commands/npm-run-script
- `npm run lint --workspace server`
- `npm run test --workspace server`

14. [x] Repo-wide lint + format gate (must be the last subtask in every task):

- Docs to read:
  - https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Run:
  - `npm run lint --workspaces`
  - `npm run format:check --workspaces`
- If either fails:
  - `npm run lint:fix --workspaces`
  - `npm run format --workspaces`
- Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - `/agents` can run with a valid `working_folder` that maps under `HOST_INGEST_DIR` (primary story behaviour)
   - `/agents` returns a clear error for invalid/non-existent `working_folder` (primary story behaviour)
   - `/agents` can still run without `working_folder` (backwards compatibility)
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Extended `RunAgentInstructionParams` with optional `working_folder` and added stable error codes `WORKING_FOLDER_INVALID`/`WORKING_FOLDER_NOT_FOUND` in the agents service.
- Added `resolveWorkingFolderWorkingDirectory()` which validates absolute paths (POSIX or Windows), attempts host→workdir mapping via `mapHostWorkingFolderToWorkdir()` when `HOST_INGEST_DIR` is set, then falls back to the literal directory.
- Threaded the resolved directory into Codex execution via `workingDirectoryOverride` and ensured ChatInterfaceCodex prefers the override for both config-default and explicit ThreadOptions branches.
- Added unit coverage for resolver happy/failure paths and for ChatInterfaceCodex’s working directory override plumbing.
- Updated `design.md` + `projectStructure.md` to document the new working-folder resolution flow and test locations.
- Local testing note: `npm run e2e`/`npm run compose:*` required forcing `CODEX_HOME=$PWD/codex` because this environment had `CODEX_HOME=/app/codex_agents/coding_agent` set, which causes Docker Desktop mount-denied errors on macOS.

---

### 3. REST: accept working_folder in POST /agents/:agentName/run

- Task Status: **completed**
- Git Commits: bc3a193

#### Overview

Accept `working_folder` via the Agents REST endpoint, validate input shape, and map resolution errors to stable HTTP responses without breaking existing clients.

#### Documentation Locations

- Express JSON body parsing + route handlers: Context7 `/expressjs/express` (for `Router`, `express.json`, and request lifecycle)
- Supertest (server HTTP testing): Context7 `/ladjs/supertest` (repo tests use `supertest(request(app))`)
- HTTP status code semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status (to keep error responses consistent and predictable)
- Mermaid syntax (diagrams for this flow): Context7 `/mermaid-js/mermaid`
- Cucumber guides: https://cucumber.io/docs/guides/ (server `npm run test` runs Cucumber feature tests)

#### Subtasks

1. [x] Extend request body validation:
   - Docs to read:
     - Context7 `/expressjs/express` (request handler patterns)
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status (why this stays a 400)
   - Files to read:
     - `server/src/routes/agentsRun.ts`
   - File to edit:
     - `server/src/routes/agentsRun.ts`
   - Update `AgentRunBody` and `validateBody()` to accept:
     - `working_folder?: unknown`
   - Rules:
     - if provided: must be a string and `trim().length > 0`
     - do not check filesystem existence here (service does that so REST + MCP stay consistent)
   - Important note (easy to miss):
     - `validateBody()` must return `working_folder?: string` so the route handler can forward it to the service.
2. [x] Pass the value to the service:
   - Docs to read:
     - Context7 `/expressjs/express`
   - File to edit:
     - `server/src/routes/agentsRun.ts`
   - Ensure the call includes `working_folder: parsedBody.working_folder` (or `undefined` if absent).
3. [x] Extend route error mapping to include the new codes:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - File to edit:
     - `server/src/routes/agentsRun.ts`
   - Required type update (avoid silent 500s):
     - Extend the local `AgentRunError` union to include:
       - `{ code: 'WORKING_FOLDER_INVALID'; reason?: string }`
       - `{ code: 'WORKING_FOLDER_NOT_FOUND'; reason?: string }`
   - When service throws:
     - `WORKING_FOLDER_INVALID` → HTTP 400 with JSON `{ error: 'invalid_request', code: 'WORKING_FOLDER_INVALID', message: '...' }`
     - `WORKING_FOLDER_NOT_FOUND` → HTTP 400 with JSON `{ error: 'invalid_request', code: 'WORKING_FOLDER_NOT_FOUND', message: '...' }`
4. [x] **Test (server unit, `node:test`)**: REST route forwards `working_folder` to the service
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to read:
     - `server/src/test/unit/agents-router-run.test.ts`
   - File to edit:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Purpose: ensure request parsing plumbs the optional field through.
   - Description:
     - send a request body including `working_folder`
     - assert the stubbed service is called with `working_folder` present.
5. [x] **Test (server unit, `node:test`)**: REST route maps `WORKING_FOLDER_INVALID` → HTTP 400 + code
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Location: `server/src/test/unit/agents-router-run.test.ts`
   - Purpose: callers receive a stable 400 error with the correct `code`.
   - Description:
     - make the stubbed service throw `{ code: 'WORKING_FOLDER_INVALID' }`
     - expect response status 400 and body `{ error: 'invalid_request', code: 'WORKING_FOLDER_INVALID' }`.
6. [x] **Test (server unit, `node:test`)**: REST route maps `WORKING_FOLDER_NOT_FOUND` → HTTP 400 + code
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Location: `server/src/test/unit/agents-router-run.test.ts`
   - Purpose: callers receive a stable 400 error with the correct `code`.
   - Description:
     - make the stubbed service throw `{ code: 'WORKING_FOLDER_NOT_FOUND' }`
     - expect response status 400 and body `{ error: 'invalid_request', code: 'WORKING_FOLDER_NOT_FOUND' }`.
7. [x] Update `design.md` to document the REST contract and errors (include Mermaid diagram) (do this after implementing the REST wiring above):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Add/update a short section for `POST /agents/:agentName/run` including:
     - request body field `working_folder?: string`
     - the two error codes and how they appear in HTTP 400 bodies
   - Add a Mermaid `sequenceDiagram` showing browser/client → server route → agents service → Codex adapter, including:
     - working folder resolution step
     - early-return error path for invalid/not-found
8. [x] Verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - `npm run lint --workspace server`
   - `npm run test --workspace server`
9. [x] Repo-wide lint + format gate (must be the last subtask in every task):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - Verified the REST contract accepts `working_folder` and returns safe, stable HTTP 400 bodies for invalid input.
   - Verified `WORKING_FOLDER_INVALID` and `WORKING_FOLDER_NOT_FOUND` map to `{ error: 'invalid_request', code: '...' }`.
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Updated `server/src/routes/agentsRun.ts` to validate/forward `working_folder` and map `WORKING_FOLDER_INVALID`/`WORKING_FOLDER_NOT_FOUND` to stable HTTP 400 responses.
- Extended `server/src/test/unit/agents-router-run.test.ts` with focused coverage for request plumbing and the new 400 error mappings.
- Added a short `POST /agents/:agentName/run` documentation section + Mermaid `sequenceDiagram` to `design.md`.
- Local dev gotchas:
  - This environment had `CODEX_HOME=/app/codex_agents/coding_agent`, which breaks Docker Desktop mounts; ran `npm run e2e` and `npm run compose:*` with `CODEX_HOME=$PWD/codex`.
  - Verified the compose REST contract by curling *inside* the server container (`docker exec codeinfo2-server-1 ...`) because host port access was inconsistent in this environment.

---

### 4. Client API: add working_folder to runAgentInstruction()

- Task Status: **completed**
- Git Commits: 6945d4e

#### Overview

Extend the client API wrapper so `working_folder` can be sent to the server (without changing behavior when omitted).

#### Documentation Locations

- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API (for POST JSON patterns and reading error bodies)
- Jest 30 docs (match repo): Context7 `/websites/jestjs_io_30_0` (for mocking + `toHaveBeenCalledWith` assertions)
- Testing Library docs (match repo patterns): Context7 `/websites/testing-library` (for `render`, `screen`, queries, async helpers)

#### Subtasks

1. [x] Update the request params type:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - File to edit:
     - `client/src/api/agents.ts`
   - Add to the `runAgentInstruction(params: { ... })` signature:
     - `working_folder?: string;`
2. [x] Include the field in the POST body:
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - File to edit:
     - `client/src/api/agents.ts`
   - Rule:
     - include `working_folder` only if `params.working_folder?.trim()` is non-empty
3. [x] **Test (client unit, Jest)**: includes `working_folder` when provided
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to read (pattern):
     - `client/src/test/chatPage.flags.reasoning.payload.test.tsx`
   - File to add:
     - `client/src/test/agentsApi.workingFolder.payload.test.ts`
   - Purpose: ensure API wrapper adds the field only when present.
   - Description:
     - call `runAgentInstruction({ working_folder: '/abs/path', ... })`
     - assert mocked `fetch` called with JSON body containing `working_folder`.
4. [x] **Test (client unit, Jest)**: omits `working_folder` when not provided (or blank)
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Location: `client/src/test/agentsApi.workingFolder.payload.test.ts`
   - Purpose: maintain backward compatibility for callers that don’t use the new field.
   - Description:
     - call `runAgentInstruction({ working_folder: undefined })` and separately `working_folder: '   '`
     - assert JSON body does not contain the field.
5. [x] Update `projectStructure.md` to include the new client test file (do this after adding the file above):
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Add an entry under `client/src/test/` for:
     - `agentsApi.workingFolder.payload.test.ts`
6. [x] Verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - `npm run lint --workspace client`
   - `npm run test --workspace client`
7. [x] Repo-wide lint + format gate (must be the last subtask in every task):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - `/agents` can still run an instruction (API wrapper change must not break runtime)
   - `/agents` requests include `working_folder` only when non-empty (inspect network request in devtools)
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Updated `client/src/api/agents.ts` to accept optional `working_folder` and include it in the POST body only when `trim()` is non-empty.
- Added client unit coverage in `client/src/test/agentsApi.workingFolder.payload.test.ts` to assert `working_folder` is included/omitted correctly.
- Updated `projectStructure.md` to list the new client API test.
- Verified `npm run lint --workspace client` and `npm run test --workspace client`.
- Ran repo-wide lint/format gate (`npm run lint --workspaces`, `npm run format:check --workspaces`) and fixed the new test file with `npm run format --workspace client`.
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server`.
- Testing: `npm run test --workspace client`.
- Testing: `CODEX_HOME=$PWD/codex npm run e2e`.
- Testing: `CODEX_HOME=$PWD/codex npm run compose:build`.
- Testing: `CODEX_HOME=$PWD/codex npm run compose:up`.
- Testing: manual Playwright check on `http://host.docker.internal:5001/agents` verified POST `/agents/:agent/run` omits `working_folder` when blank.
- Testing: `CODEX_HOME=$PWD/codex npm run compose:down`.

---

### 5. GUI: add optional working_folder control to Agents page

- Task Status: **completed**
- Git Commits: 23f7376

- `23f7376` DEV-0000017 - Task 5: working_folder field in Agents UI

#### Overview

Add an optional working folder input to the Agents page so users can run an agent from a specific folder, without expanding the top control bar beyond the existing constraints (agent selector, Stop, New conversation).

#### Documentation Locations

- MUI TextField API (v6): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
- MUI Accordion docs are _not_ required for this story (KISS: single TextField only).
- React controlled inputs caveats: Context7 `/reactjs/react.dev` (to avoid controlled/uncontrolled warnings)
- React Router (tests use `createMemoryRouter`/`RouterProvider`): Context7 `/remix-run/react-router`
- Jest 30 docs (match repo): Context7 `/websites/jestjs_io_30_0` (assert request bodies and interactions)
- Testing Library docs: Context7 `/websites/testing-library` (RTL patterns used throughout repo)
- user-event docs (match repo): Context7 `/testing-library/user-event` (recommended over raw `fireEvent` for realistic interactions)
- jest-dom matchers: Context7 `/testing-library/jest-dom` (matchers like `toBeInTheDocument`, `toHaveTextContent`)
- Mermaid syntax (diagrams for this flow): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Add state + TextField UI (controlled input):
   - Docs to read:
     - https://llms.mui.com/material-ui/6.4.12/api/text-field.md
     - Context7 `/reactjs/react.dev` (controlled inputs)
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
   - File to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Add state:
     - `const [workingFolder, setWorkingFolder] = useState('');`
   - Add a `TextField` labelled exactly `working_folder` directly above the existing instruction input.
   - Make it controlled:
     - `value={workingFolder}` and `onChange={(e) => setWorkingFolder(e.target.value)}`
2. [x] Thread it into the agent run request:
   - Docs to read:
     - Context7 `/reactjs/react.dev`
   - File to edit:
     - `client/src/pages/AgentsPage.tsx`
   - When calling `runAgentInstruction(...)`, pass:
     - `working_folder: workingFolder.trim() || undefined`
3. [x] Reset behavior (must implement explicitly):
   - Docs to read:
     - Context7 `/reactjs/react.dev`
   - File to edit:
     - `client/src/pages/AgentsPage.tsx`
   - In `resetConversation()` and agent-change handler:
     - call `setWorkingFolder('')`
4. [x] **Test (client UI, Jest/RTL)**: AgentsPage submits `working_folder` in POST body
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
   - Files to read:
     - `client/src/test/agentsPage.run.test.tsx` (agents run flow)
   - Location: `client/src/test/agentsPage.run.test.tsx` (edit)
   - Purpose: prove the end-to-end UI plumbing from TextField → API call works.
   - Description:
     - render AgentsPage
     - type a `working_folder` value
     - run an instruction
     - assert the captured request body contains `working_folder`.
5. [x] **Test (client UI, Jest/RTL)**: Agent change clears the `working_folder` field
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
   - Location: `client/src/test/agentsPage.agentChange.test.tsx` (edit)
   - Purpose: prevent accidental reuse of a previous folder across agents.
   - Description:
     - set `working_folder` field
     - change agent selection
     - assert field is empty.
6. [x] Update `design.md` to document the Agents UI flow (include Mermaid diagram) (do this after implementing the UI wiring above):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Add a Mermaid `flowchart` describing:
     - user enters `working_folder` + instruction → POST `/agents/:agentName/run` → error/success handling in UI
   - Mention reset behavior (agent change / new conversation clears `working_folder`).
7. [x] Verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - `npm run lint --workspace client`
   - `npm run test --workspace client`
8. [x] Repo-wide lint + format gate (must be the last subtask in every task):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - `/agents` shows the new `working_folder` field and it is cleared on agent change / new conversation (primary story behaviour)
   - Running with valid/invalid `working_folder` shows success/error as expected (primary story behaviour)
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Added a controlled `working_folder` `TextField` to `client/src/pages/AgentsPage.tsx` with local state (`workingFolder`).
- Wired `workingFolder.trim() || undefined` through to the `runAgentInstruction(...)` call.
- Implemented reset behavior by clearing `workingFolder` in `resetConversation()` (covers agent change + new conversation).
- Updated `client/src/test/agentsPage.run.test.tsx` to type `working_folder` and assert it is present in the POST body.
- Updated `client/src/test/agentsPage.agentChange.test.tsx` to assert `working_folder` is cleared when changing agent.
- Updated `design.md` with a Mermaid flowchart for the Agents run flow including optional `working_folder` + UI error handling and reset behavior.
- Verified `npm run lint --workspace client` and `npm run test --workspace client`.
- Verified repo-wide lint/format gate: `npm run lint --workspaces` and `npm run format:check --workspaces`.
- Testing: `npm run build --workspace server`.
- Testing: `npm run build --workspace client`.
- Testing: `npm run test --workspace server`.
- Testing: `npm run test --workspace client`.
- Testing: `CODEX_HOME=$PWD/codex npm run e2e` (required to override an environment `CODEX_HOME` pointing at an unshared Docker Desktop path).
- Testing: `CODEX_HOME=$PWD/codex npm run compose:build`.
- Testing: `CODEX_HOME=$PWD/codex npm run compose:up`.
- Testing: manual browser check against `http://host.docker.internal:5001/agents` verified:
  - `working_folder` field present
  - field clears on New conversation + agent change
  - invalid path surfaces `WORKING_FOLDER_NOT_FOUND`
  - valid path (e.g. `/app`) successfully runs and returns an answer.
- Testing: `CODEX_HOME=$PWD/codex npm run compose:down`.

---

### 6. MCP 5012: extend run_agent_instruction schema to accept working_folder

- Task Status: **completed**
- Git Commits: efa6f00

#### Overview

Expose `working_folder` through the Agents MCP tool `run_agent_instruction` and ensure invalid values return a predictable MCP error (invalid params style).

#### Documentation Locations

- Zod v3 schema validation (repo uses Zod 3.x): Context7 `/websites/v3_zod_dev` (used for input parsing/validation in MCP tools)
- JSON-RPC 2.0 spec (error codes, invalid params): https://www.jsonrpc.org/specification
- MCP basics (for context; keep wire format unchanged): https://modelcontextprotocol.io/
- Mermaid syntax (diagrams for this flow): Context7 `/mermaid-js/mermaid`
- Cucumber guides: https://cucumber.io/docs/guides/ (server `npm run test` runs Cucumber feature tests)

#### Subtasks

1. [x] Extend the Zod schema + tool input schema:
   - Docs to read:
     - Context7 `/websites/v3_zod_dev`
     - https://www.jsonrpc.org/specification (invalid params error code)
   - Files to read:
     - `server/src/mcpAgents/tools.ts`
   - File to edit:
     - `server/src/mcpAgents/tools.ts`
   - Add to `runParamsSchema`:
     - `working_folder: z.string().min(1).optional()`
   - Update `run_agent_instruction` JSON `inputSchema` to include `working_folder` with a clear description.
2. [x] Pass through to the agents service:
   - Docs to read:
     - Context7 `/websites/v3_zod_dev`
   - File to edit:
     - `server/src/mcpAgents/tools.ts`
   - Include `working_folder: parsed.working_folder` in the `runAgentInstruction({ ... })` call.
3. [x] Ensure errors are mapped to invalid params:
   - Docs to read:
     - https://www.jsonrpc.org/specification
   - File to edit:
     - `server/src/mcpAgents/tools.ts`
   - Required type update (avoid JSON-RPC internal errors):
     - Extend the local `AgentRunError` union in this file to include:
       - `{ code: 'WORKING_FOLDER_INVALID'; reason?: string }`
       - `{ code: 'WORKING_FOLDER_NOT_FOUND'; reason?: string }`
   - When the service throws `WORKING_FOLDER_INVALID` or `WORKING_FOLDER_NOT_FOUND`, translate to `InvalidParamsError` (safe message only).
4. [x] **Test (server unit, `node:test`)**: `callTool()` forwards `working_folder` to the agents service
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/websites/v3_zod_dev`
   - Files to read:
     - `server/src/mcpAgents/tools.ts`
   - File to add:
     - `server/src/test/unit/mcp-agents-tools.test.ts`
   - Purpose: ensure Zod parsing + call plumbing is correct at the tools layer.
   - Description:
     - call `callTool('run_agent_instruction', { agentName, instruction, working_folder }, { runAgentInstruction: stub })`
     - assert stub receives `working_folder`.
5. [x] **Test (server unit, `node:test`)**: JSON-RPC router accepts `working_folder` and forwards it to tools/service
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://modelcontextprotocol.io/
   - Files to read:
     - `server/src/test/unit/mcp-agents-router-run.test.ts`
   - File to edit:
     - `server/src/test/unit/mcp-agents-router-run.test.ts`
   - Purpose: ensure the `tools/call` wire path supports the new parameter.
   - Description:
     - send a `tools/call` request with `arguments.working_folder`
     - assert the stubbed service receives `working_folder`.
6. [x] **Test (server unit, `node:test`)**: `callTool()` maps working-folder errors to `InvalidParamsError`
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Location: `server/src/test/unit/mcp-agents-tools.test.ts`
   - Purpose: ensure MCP callers get a predictable invalid-params tool error.
   - Description:
     - stub service to throw `{ code: 'WORKING_FOLDER_NOT_FOUND' }` and separately `{ code: 'WORKING_FOLDER_INVALID' }`
     - assert `callTool(...)` throws `InvalidParamsError` for both.
7. [x] Update `projectStructure.md` to include the new server test file (do this after adding the file above):
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Add an entry under `server/src/test/unit/` for:
     - `mcp-agents-tools.test.ts`
8. [x] Update `design.md` to document the MCP tool contract change (include Mermaid diagram) (do this after implementing the MCP schema + wiring above):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Add a Mermaid `sequenceDiagram` for:
     - MCP client → Agents MCP `5012` → tools layer → agents service → Codex
   - Include the new optional param name `working_folder` and that invalid paths become JSON-RPC “invalid params” style tool errors.
9. [x] Verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - `npm run lint --workspace server`
   - `npm run test --workspace server`
10. [x] Repo-wide lint + format gate (must be the last subtask in every task):
    - Docs to read:
      - https://docs.npmjs.com/cli/v10/commands/npm-run-script
    - Run:
      - `npm run lint --workspaces`
      - `npm run format:check --workspaces`
    - If either fails:
      - `npm run lint:fix --workspaces`
      - `npm run format --workspaces`
    - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - Agents MCP `5012` `run_agent_instruction` accepts `working_folder` and returns clear invalid-params errors (primary story behaviour)
   - `/agents` UI still works after MCP tool schema changes (baseline regression)
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Task 6 in progress: extending Agents MCP (5012) `run_agent_instruction` to accept optional `working_folder`, wire it to the agents service, and add unit + router tests plus documentation updates.
- Subtask 1: added optional `working_folder` to the MCP tools Zod schema and to the published JSON `inputSchema` for `run_agent_instruction`.
- Subtask 2: plumbed `working_folder` through the MCP tools layer into `runAgentInstruction({ ... })`.
- Subtask 3: extended the MCP tools error mapping to translate `WORKING_FOLDER_INVALID`/`WORKING_FOLDER_NOT_FOUND` into JSON-RPC invalid-params (`InvalidParamsError`).
- Subtask 4: added `server/src/test/unit/mcp-agents-tools.test.ts` with a tools-layer unit test proving `working_folder` is forwarded into the agents service call.
- Subtask 5: updated `server/src/test/unit/mcp-agents-router-run.test.ts` to include `arguments.working_folder` and assert it reaches the stubbed agents service.
- Subtask 6: extended `server/src/test/unit/mcp-agents-tools.test.ts` to assert `WORKING_FOLDER_INVALID`/`WORKING_FOLDER_NOT_FOUND` are translated to `InvalidParamsError`.
- Subtask 7: updated `projectStructure.md` to list `server/src/test/unit/mcp-agents-tools.test.ts`.
- Subtask 8: updated `design.md` with an Agents MCP sequence diagram covering `working_folder` and invalid-params error mapping.
- Subtask 9: verified server lint + tests (`npm run lint --workspace server`, `npm run test --workspace server`).
- Subtask 10: verified repo-wide lint + format gate; ran `npm run format --workspaces` to fix Prettier warnings in the new/updated server unit tests.
- Testing 1: `npm run build --workspace server`.
- Testing 2: `npm run build --workspace client`.
- Testing 3: `npm run test --workspace server`.
- Testing 4: `npm run test --workspace client`.
- Testing 5: `CODEX_HOME=$PWD/codex npm run e2e`.
- Testing 6: `CODEX_HOME=$PWD/codex npm run compose:build`.
- Testing 7: `CODEX_HOME=$PWD/codex npm run compose:up`.
- Testing 8: manual checks against mapped ports:
  - Agents MCP tools/list contains `working_folder` in `run_agent_instruction` schema.
  - `tools/call` with `working_folder=/this/does/not/exist` returns JSON-RPC error `-32602` message `working_folder not found`.
  - `tools/call` with `working_folder=relative/path` returns JSON-RPC error `-32602` message `working_folder must be an absolute path`.
  - Client routes respond `200` at `http://host.docker.internal:5001/agents` and `http://host.docker.internal:5001/chat` (screenshots captured under `test-results/screenshots/task6-*.png`).
- Testing 9: `CODEX_HOME=$PWD/codex npm run compose:down`.

---

### 7. Codex updates: add model gpt-5.2

- Task Status: **completed**
- Git Commits: 59d5cb4
#### Overview

Update the fixed Codex model list surfaced by the server so it includes `gpt-5.2`, and update any dependent tests/fixtures.

#### Documentation Locations

- Express routing (route handler patterns): Context7 `/expressjs/express`
- Jest 30 docs (match repo): Context7 `/websites/jestjs_io_30_0` (test structure + matchers)
- Testing Library docs (client fixtures): Context7 `/websites/testing-library`
- React Router (tests use `createMemoryRouter`/`RouterProvider`): Context7 `/remix-run/react-router`
- Cucumber guides: https://cucumber.io/docs/guides/ (server `npm run test` runs Cucumber feature tests)

#### Subtasks

1. [x] Update the fixed model list returned for Codex:
   - Docs to read:
     - Context7 `/expressjs/express`
   - Files to read:
     - `server/src/routes/chatModels.ts`
   - File to edit:
     - `server/src/routes/chatModels.ts`
   - Add a new entry to the `codexModels` array (append only):
     - `key: 'gpt-5.2'`
     - `displayName: 'gpt-5.2'`
     - `type: 'codex'`
2. [x] **Test (client UI, Jest/RTL)**: provider model list includes `gpt-5.2` when Codex is selected
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/remix-run/react-router`
   - Files to read/edit (common locations):
     - `client/src/test/chatPage.provider.test.tsx` (mocked models response)
     - `client/src/test/chatPage.provider.conversationSelection.test.tsx` (also mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.approval.payload.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.approval.default.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.reasoning.payload.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.reasoning.default.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.websearch.payload.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.websearch.default.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.network.payload.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.network.default.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.sandbox.payload.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.sandbox.default.test.tsx` (mocks `/chat/models?provider=codex`)
     - `client/src/test/chatPage.flags.sandbox.reset.test.tsx` (mocks `/chat/models?provider=codex`)
   - Location: `client/src/test/chatPage.provider.test.tsx` (edit)
   - Purpose: prevent UI regressions where adding a new model breaks selection/defaults.
   - Description:
     - update the mocked `/chat/models?provider=codex` payload to include `gpt-5.2`
     - assert the dropdown options include `gpt-5.2`.
3. [x] Verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - `npm run lint --workspace server`
   - `npm run lint --workspace client`
   - `npm run test --workspace server`
   - `npm run test --workspace client`
4. [x] Repo-wide lint + format gate (must be the last subtask in every task):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - `/chat` model dropdown includes `gpt-5.2` when provider is Codex (primary story behaviour)
   - `/agents` still loads and runs (baseline regression)
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Task 7 completed: added Codex model `gpt-5.2` to the server fixed list and updated client tests/fixtures.
- Subtask 1: appended `gpt-5.2` to the `codexModels` array returned by `GET /chat/models?provider=codex`.
- Subtask 2: updated client Jest/RTL fixtures that mock `/chat/models?provider=codex` and added an assertion that the model dropdown includes `gpt-5.2`.
- Subtask 3: verified lint + tests (`npm run lint --workspace server`, `npm run lint --workspace client`, `npm run test --workspace server`, `npm run test --workspace client`).
- Subtask 4: verified repo-wide lint + format gate (`npm run lint --workspaces`, `npm run format:check --workspaces`).
- Testing 1: `npm run build --workspace server`.
- Testing 2: `npm run build --workspace client`.
- Testing 3: `npm run test --workspace server`.
- Testing 4: `npm run test --workspace client`.
- Testing 5: `CODEX_HOME=$PWD/codex npm run e2e`.
- Testing 6: `CODEX_HOME=$PWD/codex npm run compose:build`.
- Testing 7: `CODEX_HOME=$PWD/codex npm run compose:up`.
- Testing 8: manual checks against mapped ports: confirmed `gpt-5.2` appears in the `/chat` model dropdown when provider is Codex and `/agents` loads; saved screenshots to `test-results/screenshots/task7-*.png`.
- Testing 9: `CODEX_HOME=$PWD/codex npm run compose:down`.

---

### 8. Codex updates: add reasoning effort xhigh

- Task Status: **completed**
- Git Commits: a69bc3b

#### Overview

Update Codex reasoning-effort options across server validation and client UI, plus documentation/diagrams describing the new option.

#### Documentation Locations

- MUI Select API (v6): https://llms.mui.com/material-ui/6.4.12/api/select.md
- OpenAI Codex config docs (reasoning effort values): Context7 `/openai/codex`
- TypeScript (string literal unions + narrowing): Context7 `/microsoft/typescript`
- Jest 30 docs (match repo): Context7 `/websites/jestjs_io_30_0`
- Testing Library docs (client tests): Context7 `/websites/testing-library`
- `@openai/codex-sdk` runtime behavior (it forwards `model_reasoning_effort="..."` to the Codex CLI): code_info MCP (inspect the installed `@openai/codex-sdk` package in this repo)
- Mermaid syntax (diagrams for this flow): Context7 `/mermaid-js/mermaid`
- Cucumber guides: https://cucumber.io/docs/guides/ (server `npm run test` runs Cucumber feature tests)

#### Subtasks

1. [x] Update client types + UI options:
   - Docs to read:
     - https://llms.mui.com/material-ui/6.4.12/api/select.md
     - Context7 `/microsoft/typescript`
   - Files to read:
     - `client/src/hooks/useChatStream.ts` (defines `ModelReasoningEffort` union)
     - `client/src/components/chat/CodexFlagsPanel.tsx` (renders reasoning effort dropdown)
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`: extend `ModelReasoningEffort` to include `'xhigh'`.
     - `client/src/components/chat/CodexFlagsPanel.tsx`: add a new option:
       - value: `xhigh`
       - label: `XHigh`
2. [x] Update server validation to accept `xhigh` (app-level value):
   - Docs to read:
     - Context7 `/microsoft/typescript` (widening unions safely)
   - Files to read:
     - `server/src/routes/chatValidators.ts`
   - File to edit:
     - `server/src/routes/chatValidators.ts`
   - Add `xhigh` to the accepted values list used by validation.
   - Important type note:
     - `server/src/routes/chatValidators.ts` currently uses `ModelReasoningEffort` from `@openai/codex-sdk` (which does **not** include `xhigh` in this repo’s installed version).
     - Use an app-level union type like `type AppModelReasoningEffort = ModelReasoningEffort | 'xhigh'`:
       - Update `ValidatedChatRequest['codexFlags'].modelReasoningEffort` to use `AppModelReasoningEffort`.
       - Then, when building the final `threadOptions` in `ChatInterfaceCodex`, cast as needed.
3. [x] Ensure `xhigh` is passed through to Codex:
   - Docs to read:
     - Context7 `/openai/codex` (what values are accepted at CLI config level)
     - code_info MCP: inspect installed `@openai/codex-sdk` (runtime pass-through; SDK types may lag)
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - code_info MCP: inspect installed `@openai/codex-sdk` to confirm it forwards `modelReasoningEffort` as `--config model_reasoning_effort="..."` (no SDK-side validation)
   - File to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Required type changes (to keep TypeScript happy):
     - Update `CodexRunFlags` so `codexFlags.modelReasoningEffort` can be `ModelReasoningEffort | 'xhigh'` (the installed `CodexThreadOptions` type is narrower).
       - KISS suggestion: define a local helper type in `ChatInterfaceCodex.ts`:
         - `type CodexThreadOptionsCompat = Omit<CodexThreadOptions, 'modelReasoningEffort'> & { modelReasoningEffort?: ModelReasoningEffort | 'xhigh' };`
         - then type `codexFlags?: Partial<CodexThreadOptionsCompat>` in `CodexRunFlags`.
   - Implementation rule:
     - Do **not** down-map `xhigh` to `high`; pass it through in `threadOptions.modelReasoningEffort` (with a type cast at assignment, because the installed SDK types are narrower than the CLI’s accepted values).
4. [x] **Test (client UI, Jest/RTL)**: selecting `xhigh` sends `modelReasoningEffort: 'xhigh'` in the request
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
   - Location: `client/src/test/chatPage.flags.reasoning.payload.test.tsx` (edit)
   - Purpose: ensure the app-level value is preserved in the request payload.
   - Description:
     - select reasoning effort `xhigh`
     - submit a Codex message
     - assert captured request JSON contains `modelReasoningEffort: 'xhigh'`.
5. [x] **Test (server integration, `node:test` + MockCodex)**: server accepts `xhigh` and passes `xhigh` into Codex thread options
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Location: `server/src/test/integration/chat-codex-mcp.test.ts` (edit)
   - Purpose: ensure the server preserves the requested reasoning effort all the way to the Codex adapter options.
   - Description:
     - send a Codex request with `modelReasoningEffort: 'xhigh'`
     - assert mocked codex thread options received `modelReasoningEffort: 'xhigh'`.
6. [x] Update `README.md` to document `xhigh` (do this after implementing the validation + adapter changes above):
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
     - Context7 `/openai/codex`
   - Files to edit:
     - `README.md`
   - Purpose: ensure users know `xhigh` exists and what it does.
   - Description (must include):
     - `xhigh` is accepted and passed through to Codex as `model_reasoning_effort="xhigh"` (via the installed `@openai/codex-sdk`).
7. [x] Update `design.md` to document the reasoning-effort flow (include Mermaid diagram) (do this after implementing the validation + adapter changes above):
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose: capture the architecture/flow change so future devs understand how the flag is validated and forwarded.
   - Description (must include):
     - call out that `xhigh` is not in this repo’s installed SDK TypeScript union, but is still forwarded at runtime.
   - Add a Mermaid `flowchart` showing:
     - UI selection → REST payload (`modelReasoningEffort`) → server validation → Codex thread options (`modelReasoningEffort`)
8. [x] Verification commands:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - `npm run lint --workspaces`
   - `npm run test --workspace server`
   - `npm run test --workspace client`
   - `npm run format:check --workspaces`
9. [x] Repo-wide lint + format gate (must be the last subtask in every task):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - `/chat` reasoning effort dropdown includes `xhigh` and selecting it still sends `modelReasoningEffort: 'xhigh'` (primary story behaviour)
   - `/agents` still runs with `working_folder` (baseline regression)
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Subtask 1: extended client `ModelReasoningEffort` to include `xhigh` and added an `XHigh` option to the Codex flags dropdown.
- Subtask 2: updated server `/chat` validation to accept `modelReasoningEffort: 'xhigh'` using an app-level union (`ModelReasoningEffort | 'xhigh'`) so the installed SDK types can lag safely.
- Subtask 3: widened `ChatInterfaceCodex` flag typing to allow `xhigh` and cast the final `threadOptions.modelReasoningEffort` assignment so runtime pass-through is preserved.
- Subtask 4: updated client RTL test to select `xhigh` and assert request payload forwards `modelReasoningEffort: 'xhigh'`.
- Subtask 5: updated server integration test to send `modelReasoningEffort: 'xhigh'` and assert the mocked Codex thread options receive it.
- Subtask 6: documented `xhigh` in `README.md` and noted it is passed through to Codex as `model_reasoning_effort="xhigh"`.
- Subtask 7: documented the reasoning-effort flow (and SDK type mismatch) in `design.md` with a Mermaid diagram.
- Subtask 8: verified lint/tests/format (`npm run lint --workspaces`, `npm run test --workspace server`, `npm run test --workspace client`, `npm run format:check --workspaces`).
- Subtask 9: repo-wide lint + format gate passed (same commands; no fixes required).
- Testing 1: `npm run build --workspace server`.
- Testing 2: `npm run build --workspace client`.
- Testing 3: `npm run test --workspace server`.
- Testing 4: `npm run test --workspace client`.
- Testing 5: `CODEX_HOME=$PWD/codex npm run e2e`.
- Testing 6: `CODEX_HOME=$PWD/codex npm run compose:build`.
- Testing 7: `CODEX_HOME=$PWD/codex npm run compose:up`.
- Testing 8: headless Playwright check against `http://host.docker.internal:5001` with API rewrite for `http://localhost:5010` to ensure the browser hit the mapped Docker ports; verified `modelReasoningEffort: 'xhigh'` and `working_folder` request payloads, and saved screenshots to `test-results/screenshots/task8-chat-xhigh.png` and `test-results/screenshots/task8-agents-working-folder.png`.
- Testing 9: `CODEX_HOME=$PWD/codex npm run compose:down`.

---

### 9. Documentation + project structure updates

- Task Status: **completed**
- Git Commits: e4c7bc4

- `e4c7bc4` DEV-0000017 - Task 9: Documentation updates

#### Overview

Ensure documentation reflects the new API surface and that `projectStructure.md` is updated for any new files/tests.

#### Documentation Locations

- Markdown syntax reference: https://www.markdownguide.org/basic-syntax/
- Mermaid syntax: Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Update `README.md`:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
     - Context7 `/openai/codex` (for wording around `model_reasoning_effort`)
   - Files to edit:
     - `README.md`
   - Purpose: make the new public API surface discoverable to someone who never read the story plan.
   - Instructions (copy/paste-friendly, include all details here):
     - Under the Agents section, document the new optional request field:
       - name: `working_folder`
       - meaning: “requested working directory for this agent run”
       - rules:
         - must be absolute (POSIX or Windows)
         - resolution order: mapped candidate (host path under `HOST_INGEST_DIR` → joined into `CODEX_WORKDIR`/`CODEINFO_CODEX_WORKDIR`), then literal fallback, else error
     - Add the two stable error codes and what they mean:
       - `WORKING_FOLDER_INVALID`: not absolute / invalid input
       - `WORKING_FOLDER_NOT_FOUND`: neither candidate directory exists
     - Under the Codex section, add:
       - model list includes `gpt-5.2`
       - reasoning effort includes `xhigh` and it is passed through as `model_reasoning_effort="xhigh"`
2. [x] Update `design.md`:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Purpose: ensure future changes can be made safely by showing the exact control/data flow.
   - Instructions (be explicit, even if duplicated elsewhere):
     - Add (or update) a section titled `Agent working_folder overrides` that explains:
       - how `working_folder` is resolved to a final Codex `workingDirectory`
       - that agent `config.toml` remains the source of truth for defaults, but `working_folder` overrides the working directory per call
     - Ensure these Mermaid diagrams exist and render:
       - Agent `working_folder` resolution `flowchart` (mapped → literal → error)
       - REST route `sequenceDiagram` for `POST /agents/:agentName/run` showing the 400 error path
       - MCP `sequenceDiagram` showing JSON-RPC call → tool validation → service → Codex
       - Reasoning-effort `flowchart` that explicitly mentions the SDK type mismatch but runtime pass-through for `xhigh`
3. [x] Update `projectStructure.md` for files added/changed by this story:
   - Docs to read:
     - https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Instructions:
     - Add one line entry for every file added by Tasks 2, 4, and 6 (new unit test files).
     - Verify no “planned file” is missing from `projectStructure.md` before marking this subtask complete.
4. [x] Run formatting check for the repo:
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Command:
     - `npm run format:check --workspaces`
5. [x] Repo-wide lint + format gate (must be the last subtask in every task):
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
   - Run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check to validate docs match behaviour (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - Verify `/agents` shows `working_folder` and the mapping/error behaviour matches the docs
   - Verify `/chat` includes `gpt-5.2` and `xhigh` as documented
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Subtask 1: updated `README.md` to document the optional `working_folder` request field (rules, resolution order, and stable error codes) and to note Codex models include `gpt-5.2`.
- Subtask 2: updated `design.md` with an `Agent working_folder overrides` section and verified the required Mermaid diagrams are present (resolution flowchart, REST 400 error path, MCP tool flow, and reasoning-effort/xhigh notes).
- Subtask 3: verified `projectStructure.md` already includes entries for the new unit test files added in Tasks 2/4/6; no structural updates required for Task 9.
- Subtask 4: ran `npm run format:check --workspaces` and confirmed Prettier is clean across all workspaces.
- Subtask 5: ran the repo-wide lint + format gate (`npm run lint --workspaces`, `npm run format:check --workspaces`).
- Testing 1: `npm run build --workspace server`.
- Testing 2: `npm run build --workspace client`.
- Testing 3: `npm run test --workspace server`.
- Testing 4: `npm run test --workspace client`.
- Testing 5: `CODEX_HOME=$PWD/codex npm run e2e`.
- Testing 6: `CODEX_HOME=$PWD/codex npm run compose:build`.
- Testing 7: `CODEX_HOME=$PWD/codex npm run compose:up`.
- Testing 8: ran a headless Playwright check against `http://host.docker.internal:5001` with API rewrite from `http://localhost:5010` -> `http://host.docker.internal:5010`; verified `/agents` shows `working_folder`, `/chat` Codex models include `gpt-5.2`, and Codex reasoning effort includes `xhigh`; saved screenshots to `test-results/screenshots/0000017-09-agents-working-folder.png`, `test-results/screenshots/0000017-09-chat-codex-models.png`, and `test-results/screenshots/0000017-09-chat-xhigh.png`.
- Testing 9: `CODEX_HOME=$PWD/codex npm run compose:down`.


---

### 10. Final task – verify against acceptance criteria

- Task Status: **completed**
- Git Commits:

#### Overview

Re-validate all acceptance criteria after implementation, including end-to-end agent runs from the GUI and MCP with valid/invalid `working_folder` values, plus the updated Codex model/reasoning options.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest 30 docs (match repo): Context7 `/websites/jestjs_io_30_0`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

**Docs to read (repeat):** Context7 `/docker/docs`, Context7 `/microsoft/playwright`, Context7 `/typicode/husky`, Context7 `/mermaid-js/mermaid`, Context7 `/websites/jestjs_io_30_0`, https://cucumber.io/docs/guides/

1. [x] Build the server: `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] Build the client: `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] Perform a clean docker build (server): `docker build -f server/Dockerfile .` (Docs: Context7 `/docker/docs`)
4. [x] Ensure `README.md` is updated with any required description changes and any new commands added by this story. (Docs: https://www.markdownguide.org/basic-syntax/)
5. [x] Ensure `design.md` is updated with any required description changes (include any new diagrams if needed). (Docs: https://www.markdownguide.org/basic-syntax/, Context7 `/mermaid-js/mermaid`)
6. [x] Ensure `projectStructure.md` is up to date. (Docs: https://www.markdownguide.org/basic-syntax/)
7. [x] Repo-wide lint + format gate (must be the last subtask in every task) (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script):
   - Run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`
   - Re-run the checks and manually resolve any remaining issues.

#### Testing

1. [x] `npm run build --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
2. [x] `npm run build --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script)
3. [x] `npm run test --workspace server` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://cucumber.io/docs/guides/)
4. [x] `npm run test --workspace client` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/websites/jestjs_io_30_0`)
5. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
6. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
7. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
8. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
   - All story behaviours are visible in the UI (`working_folder`, `gpt-5.2`, `xhigh`) and docs match behaviour (primary story behaviour)
   - General regression smoke: `/chat`, `/agents`, `/ingest`, `/logs` load without errors
9. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
10. [x] `npm run e2e` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/microsoft/playwright`)
11. [x] `npm run compose:build` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
12. [x] `npm run compose:up` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)
13. [x] Manual Playwright-MCP check (Docs: Context7 `/microsoft/playwright`, Context7 `/docker/docs`):
    - `/agents` can run an instruction with a valid `working_folder` and the run uses the expected working directory
    - `/agents` returns a clear error for an invalid `working_folder`
    - Agents MCP `5012` accepts `working_folder` and returns a clear error for invalid paths
    - `/chat` Codex model list includes `gpt-5.2`
    - Codex reasoning effort options include `xhigh`
    - Save screenshots to `./test-results/screenshots/` named:
      - `0000017-10-agents-working-folder.png`
      - `0000017-10-mcp-5012-working-folder.png`
      - `0000017-10-chat-codex-models.png`
14. [x] `npm run compose:down` (Docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script, Context7 `/docker/docs`)

#### Implementation notes

- Subtask 1: `npm run build --workspace server`.
- Subtask 2: `npm run build --workspace client`.
- Subtask 3: `docker build -f server/Dockerfile .`.
- Subtask 4: updated `README.md` to document `CODEINFO_HOST_CODEX_HOME` for Docker Compose (avoids `CODEX_HOME` collisions in Codex/agent environments).
- Follow-up fix: updated `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` to use `${CODEINFO_HOST_CODEX_HOME:-$HOME/.codex}` instead of `${CODEX_HOME:-$HOME/.codex}` for the host Codex home mount.
- Subtask 5: reviewed `design.md` (no further changes required for Task 10).
- Subtask 6: reviewed `projectStructure.md` (no further changes required for Task 10).
- Subtask 7: `npm run lint --workspaces` and `npm run format:check --workspaces`.
- Testing 1: `npm run build --workspace server`.
- Testing 2: `npm run build --workspace client`.
- Testing 3: `npm run test --workspace server`.
- Testing 4: `npm run test --workspace client`.
- Testing 5: `npm run e2e` (25 passed; 2 skipped).
- Testing 6: `npm run compose:build`.
- Testing 7: `npm run compose:up`.
- Testing 8: headless Playwright smoke against `http://host.docker.internal:5001` (API rewrite from `http://localhost:5010` -> `http://host.docker.internal:5010`); verified `/chat`, `/agents`, `/ingest`, `/logs` load and `working_folder`, `gpt-5.2`, and `xhigh` are visible.
- Testing 9: `npm run compose:down`.
- Testing 10: `npm run e2e` (25 passed; 2 skipped).
- Testing 11: `npm run compose:build`.
- Testing 12: `npm run compose:up`.
- Testing 13: headless Playwright/MCP validation against `http://host.docker.internal:5001` + `http://host.docker.internal:5012`; verified `/agents` valid/invalid `working_folder`, MCP `tools/call run_agent_instruction` valid/invalid `working_folder`, and `/chat` Codex model list + `xhigh`; saved screenshots to `test-results/screenshots/0000017-10-agents-working-folder.png`, `test-results/screenshots/0000017-10-mcp-5012-working-folder.png`, and `test-results/screenshots/0000017-10-chat-codex-models.png`.
- Testing 14: `npm run compose:down`.
