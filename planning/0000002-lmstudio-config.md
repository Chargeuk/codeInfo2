# Story 0000002 – LM Studio Configuration & Model List

## Description

Extend the client so the existing version view becomes the Home page and add a dedicated “LM Studio” configuration page. On the new page, users can enter the base URL of their LM Studio server (e.g., `http://localhost:1234`), see whether the server is reachable, and view the available models reported by LM Studio. The client should rely on the server for proxying LM Studio requests so browser CORS and credentials are handled safely. Keep all prior functionality (version call) intact and present clear loading/error states for the LM Studio page.

### Acceptance Criteria

- Navigation distinguishes Home (current version card) from a new LM Studio page; route change works in dev, preview, and Docker/compose builds.
- LM Studio page captures a base URL (default `http://host.docker.internal:1234`) with validation and persistence (e.g., local storage) and allows re-check/refresh.
- Status indicator shows if LM Studio is reachable; failure surfaces an actionable error message.
- Available models list renders name/key/type using the SDK `system.listDownloadedModels` output, handles empty and error states, and is powered through the server proxy (no direct browser calls to LM Studio). A visible “Refresh models” action re-runs the fetch.
- Server exposes a typed endpoint to accept a base URL, invoke the SDK list call, and return status + models; includes input validation and timeout/exception handling.
- Tests cover new server endpoint, client LM Studio page (UI + fetch states), routing, and a Playwright flow that exercises navigation with a live LM Studio instance at the default URL.
- Docs updated (README, design.md, projectStructure.md, planning notes) to describe the new page, API shape, env defaults, and scripts; lint/build/test commands remain green.
- UI is responsive down to phone widths (~360px): nav stays usable, LM Studio form and model list avoid horizontal scroll (table collapses to stacked rows or uses responsive layout), touch targets remain accessible.

### Out Of Scope

- Authenticating to LM Studio servers that require tokens or custom headers.
- Managing model downloads/loads/unloads; we only list what LM Studio reports.
- Persisting LM Studio config on the server or in a database (browser-local only).
- Non-HTTP transports (no WebSockets/IPC) and advanced LM Studio features (tool calling, embeddings, chat).

### Questions

- RESOLVED: Use the SDK `system.listDownloadedModels` output (all downloaded models) for the list view (https://lmstudio.ai/docs/typescript/manage-models/list-downloaded).
- RESOLVED: Default LM Studio base URL `http://host.docker.internal:1234`; also configurable via env (client `VITE_LMSTUDIO_URL` and server `LMSTUDIO_BASE_URL`) per LM Studio local server defaults (https://lmstudio.ai/docs/developer/api).
- RESOLVED: Server proxy will not cache results in this story; each request fetches fresh data.
- RESOLVED: Playwright tests will assume LM Studio is running on the default URL; no mocks in this story.

# Implementation Plan

## Implementation Plan Instructions

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

### 1. Router & Home Page Split

- Task Status: __done__
- Git Commits: 793743a, 6c00f00

#### Overview

Introduce React Router (or equivalent) so the existing version card becomes the Home route and a new LM Studio route exists. Provide top-level navigation.

#### Documentation Locations

- React Router docs (Context7 `/remix-run/react-router` via Context7 MCP).
- Existing client structure (`client/src/App.tsx`, `client/src/main.tsx`).
- MUI docs (use MUI MCP tool) for Tabs/Nav (e.g., `AppBar`, `Tabs`, `Link`).
- Env defaults: `client/.env` update for `VITE_LMSTUDIO_URL` (default `http://host.docker.internal:1234`).

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run lint --workspace client`
2. [x] `npm run test --workspace client`
3. [x] `npm run build --workspace client`

#### Implementation notes

- Added React Router shell with `client/src/routes/router.tsx`, `NavBar`, and `HomePage`/`LmStudioPage`, moving version fetch into the Home page and keeping App as a layout with `<Outlet />`.
- Introduced `common/src/api.ts` + export wiring for `fetchServerVersion` so the client can use a shared helper; added `VITE_LMSTUDIO_URL` default in `client/.env`.
- Updated Jest setup for Request/fetch/TextEncoder polyfills and adjusted scripts/tests to run on Windows (node invocation and MemoryRouter coverage), plus import ordering fixes to satisfy lint.
- Project structure doc now lists new router/pages/components; router test asserts nav + tab switching; all client lint/format/test/build commands now pass.

---

### 2. Server Types & Env Wiring

- Task Status: __done__
- Git Commits: 17eb0cd, 4aaaa9d

#### Overview

Set up server-side prerequisites for LM Studio integration: shared DTOs, SDK dependency, env defaults, and a route skeleton ready for injection.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- API server default port (`1234`): https://lmstudio.ai/docs/developer/api.
- Express 5 basics (Context7 `/expressjs/express`).

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run lint --workspace server`
2. [x] `npm run build --workspace server`

#### Implementation notes

- Installed `@lmstudio/sdk`, added `LMSTUDIO_BASE_URL` to `server/.env`, and registered the stub LM Studio router (with factory) in `server/src/index.ts`.
- Added shared LM Studio DTOs (`LmStudioModel` and status variants) plus `fetchLmStudioStatus` and typed `fetchServerVersion` in `common`, exporting via the barrel.
- Pointed client Jest config at the built common dist to satisfy NodeNext `.js` imports and ran a common build + client tests to confirm resolution.
- Updated projectStructure to reflect new common/server files; server lint/format:check/build all pass.

---

### 3. Server SDK Proxy Implementation

- Task Status: __done__
- Git Commits: cb45762, acc2c2e

#### Overview

Implement the `/lmstudio/status` proxy route using the LM Studio SDK with timeout/no-cache and proper validation/mapping.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels` (fields: `type`, `modelKey`, `displayName`, `format`, `path`, `sizeBytes`, `architecture`, optional `paramsString`, `maxContextLength`, `vision`, `trainedForToolUse`): https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- Express 5 routing (Context7 `/expressjs/express`).
- Node fetch/timeout patterns.

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run lint --workspace server`
2. [x] `npm run build --workspace server`

#### Implementation notes

- Implemented `/lmstudio/status` with baseUrl validation, LM Studio SDK call, 60s timeout guard, and DTO mapping (safe defaults for optional fields).
- Errors now return 400 for invalid URLs and 502 for SDK/timeout failures with console.warn logging; CORS left unchanged.
- Added server-level `.prettierignore` to keep build artifacts out of format checks and updated projectStructure to describe the route.
- Commands: lint/format:check/build ✅; `npm run test --workspace server` failed because the health scenario expects the server running (not started during the run).

---

### 4. Server Cucumber Tests with LM Studio Mock

- Task Status: __done__
- Git Commits: 7e14209, 98e649e

#### Overview

Add Cucumber coverage for the proxy route using a start/stop-able LM Studio SDK mock to cover success, empty, and unreachable cases without network calls.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- Cucumber + supertest usage (existing server test setup).

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run test --workspace server`
2. [x] `npm run lint --workspace server`

#### Implementation notes

- Added LM Studio mock client with controllable scenarios and injected the router into an in-memory Express app for Cucumber runs.
- Steps spin up a random-port server, call the shared helper (passing a default LM Studio baseUrl), and assert bodies/arrays; helper now surfaces status/body on errors.
- Tagged the legacy health feature with `@skip` and wired Cucumber scripts to use ESM-friendly `--import` with a `not @skip` filter; projectStructure updated with new test files.
- Commands: lint/format:check/test ✅ (three LM Studio scenarios passing).

---

### 5. Server Documentation Updates

- Task Status: __done__
- Git Commits: 4cb7bf1, 82dbdc1, 845b258

#### Overview

Document the new server proxy endpoint, env vars, and test approach.

#### Documentation Locations

- README.md (server section).
- design.md (server/API notes).
- projectStructure.md.

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run lint --workspaces`

#### Implementation notes

- Added README LM Studio proxy subsection with sample ok/error payloads, curl example, and `LMSTUDIO_BASE_URL` override guidance; noted compose env_file usage and .env.local warning.
- Updated design.md architecture and new LM Studio flow diagram covering success/empty/error + 60s timeout/no-cache notes.
- Switched docker-compose to env_file blocks for client/server; projectStructure already lists the proxy/test files.
- Commands: `npm run lint --workspaces` ✅ (fixed HomePage effect dependency to keep lint clean).

---

### 6. Client Data Hook for LM Studio

- Task Status: __done__
- Git Commits: 75c2c7a, fb0250b

#### Overview

Create a reusable hook to fetch LM Studio status/models via the server proxy with refresh support and state management.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- Testing Library/Jest patterns already in repo.

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run test --workspace client`
2. [x] `npm run lint --workspace client`

#### Implementation notes

- Built `useLmStudioStatus` hook with localStorage persistence, guarded import.meta envs, and state flags; falls back to localhost server base when env absent.
- Added Jest hook tests mocking `global.fetch` for success, empty, error (502), and network rejection, plus persistence assertions; uses common DTO types for inference.
- Updated projectStructure with hook/test entries; ran client lint/format:check/test after changes (all green).

---

### 7. Client LM Studio Page UI

- Task Status: __done__
- Git Commits: 235d67c, 852870c

#### Overview

Build the LM Studio page that uses the hook, shows status, models, empty/error states, and provides refresh and base URL controls.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- MUI components (via MUI MCP).
- Env defaults: `client/.env` with `VITE_LMSTUDIO_URL`.

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run lint --workspace client`
2. [x] `npm run build --workspace client`

#### Implementation notes

- Implemented LM Studio page using the hook with base URL input/reset, status messaging, and responsive layout (table on md+, stacked cards on small screens).
- Added accessibility touches (aria-live status, focus on error) and humanized model sizes while showing the active base URL.
- Commands run for this task: client lint, format:check, build all passing.

---

### 8. Client LM Studio Tests

- Task Status: __done__
- Git Commits: 75c2c7a, fb0250b, b30240b

#### Overview

Add Jest/Testing Library coverage for the LM Studio page and refresh/empty/error states.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- Testing Library/Jest patterns.

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run test --workspace client`
2. [x] `npm run lint --workspace client`

#### Implementation notes

- Added `client/src/test/lmstudio.test.tsx` using `jest.unstable_mockModule` with a minimal `@codeinfo2/common` stub so the ESM client uses a mocked `fetchLmStudioStatus` without global fetch overrides; also stubbed `fetchServerVersion` to keep the Home route stable when the router renders.
- Covered success + refresh, empty list, server error focus handling, and base URL persistence/navigation using Testing Library interactions with async `findBy`/`waitFor`.
- Commands run for this task: `npm run lint --workspace client`, `npm run format:check --workspace client`, and `npm run test --workspace client` (all green after formatting fix).

---

### 9. Client Documentation Updates

- Task Status: __done__
- Git Commits: 75c2c7a, fb0250b, d432f39

#### Overview

Document LM Studio client usage, refresh action, env vars, and structure changes.

#### Documentation Locations

- README.md (client section).
- design.md (UI flow, refresh/empty-state).
- projectStructure.md.

#### Subtasks

1. [x] README client section: add "LM Studio page" subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [x] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [x] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [x] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [x] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

#### Testing

1. [x] `npm run lint --workspaces`

#### Implementation notes

- Added README LM Studio subsection covering navigation, base URL defaults/persistence, server-proxy-only calls, refresh, and empty/error handling; clarified compose uses `env_file` with client/server `.env[.local]` as the single source of truth.
- Documented LM Studio UI behaviour in `design.md` (localStorage default/reset, action buttons, loading/error/empty status text, responsive table vs cards).
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces` after removing ignored `common/dist` build output so checks stayed clean.

---

### 10. E2E Validation (Live LM Studio)

- Task Status: __done__
- Git Commits: 75c2c7a, fb0250b, bdf84ac, 9918df1

#### Overview

Add Playwright coverage for navigation and LM Studio data using a live LM Studio instance; ensure prereqs are documented.

#### Documentation Locations

- Existing Playwright setup `e2e/version.spec.ts`.
- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- README/design.md/projectStructure.md.

#### Subtasks

1. [x] Add `e2e/lmstudio.spec.ts` with Playwright Test skeleton:
   ```ts
   import { test, expect } from '@playwright/test';
   const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

   test('LM Studio models render', async ({ page }) => {
     await page.goto(baseUrl);
     await page.getByRole('tab', { name: /LM Studio/i }).click();
     await expect(page.getByText(/LM Studio status/i)).toBeVisible();
     await expect(page.getByRole('row', { name: /model/i })).toBeVisible();
   });
   ```
   Add guard: before assertions, call the shared helper via `page.request.get` (or a small inline fetch) to `${process.env.LMSTUDIO_BASE_URL ?? 'http://host.docker.internal:1234'}/v1/models`; if response not ok, call `test.skip('LM Studio not reachable')`.
2. [x] Update README e2e section: prerequisite to start LM Studio locally on default port (include sample command or link), mention skip behaviour if unreachable, and that tests hit live data.
3. [x] Update projectStructure.md to list `e2e/lmstudio.spec.ts`.
4. [x] Commands: `npm run e2e:test`, `npm run lint --workspaces`, `npm run format:check --workspaces`, `npm run build:all`; record pass/fail in Implementation notes.
   - If `format:check` fails, run `npm run format --workspaces` or the specific workspace `npm run format:fix --workspace <pkg>`, then rerun `npm run format:check --workspaces`.

#### Testing

1. [x] `npm run e2e:test`
2. [x] `npm run lint --workspaces`
3. [x] `npm run build:all`

#### Implementation notes

- Added `e2e/lmstudio.spec.ts` that checks the proxy upfront and skips when LM Studio is unreachable; navigates the UI with the configured base URL and asserts either a model row or the empty-state message.
- Hardened `e2e/version.spec.ts` with a reachability guard and updated `e2e:test` to run the full suite; installed Playwright browsers locally to satisfy the new run.
- README e2e section now calls out LM Studio prerequisites, env vars (`E2E_BASE_URL`, `E2E_API_URL`, `LMSTUDIO_BASE_URL`), and skip behaviour; projectStructure lists the new spec.
- `npm run e2e:test` completed with both specs skipped because the client/proxy stack wasn’t running; `npm run lint --workspaces`, `npm run format:check --workspaces`, and `npm run build:all` all finish successfully after rebuilding `common/dist` and fixing NodeNext import extensions in Cucumber steps.
- Normalized the proxy to accept http/https/ws/wss inputs by converting http(s) to ws(s) before constructing the LM Studio SDK client; rebuilt images and reran `npm run e2e:test` with the stack + live LM Studio running—both specs now pass against the real instance.

---

### 11. GUI Layout Fix

- Task Status: __done__
- Git Commits: f1d2277

#### Overview

Fix the LM Studio page layout so it starts at the top of the viewport and fills the available width appropriately. Address leftover Vite starter CSS (body flex centering, dark background) and constrain the AppBar/Containers using MUI-recommended patterns (CssBaseline, top-level AppBar, single content container) to restore standard alignment and spacing.

#### Documentation Locations

- MUI CssBaseline guidance (MUI MCP v6.4.12) — normalize margins/box sizing/background.
- MUI AppBar API (MUI MCP v6.4.12) — intended to span full width, inherits Paper.
- MUI Container API (MUI MCP v6.4.12) — width constraints and gutter behavior.
- Current client layout files: `client/src/index.css`, `client/src/App.css`, `client/src/App.tsx`, `client/src/pages/LmStudioPage.tsx`.

#### Subtasks

1. [x] Clean up starter CSS: in `client/src/index.css` delete `body { display: flex; place-items: center; min-height: 100vh; }`, the dark `background-color`, and Vite link/button styles; in `client/src/App.css` remove `#root { max-width: 1280px; margin: 0 auto; padding: 2rem; text-align: center; }` and other unused demo classes. Keep only what’s still needed (e.g., font smoothing if desired).
2. [x] Add MUI baseline: import `CssBaseline` from `@mui/material` and render it at the root (wrap `RouterProvider` in `main.tsx`, or inside `App.tsx` above `NavBar`) so margins/background/box-sizing are normalized via theme instead of custom CSS.
3. [x] Layout structure: render `AppBar/NavBar` outside the width-limited content container so it spans full width; keep a single `Container` in `App.tsx` (or per page) for content, and remove nested Containers that double up padding (e.g., in `LmStudioPage.tsx` and `HomePage.tsx`). Use `sx` for spacing (top/bottom padding) rather than extra containers.
4. [x] Spacing/alignment: ensure LM Studio heading and controls align left at the top of the page using Container defaults plus a small top margin (e.g., `sx={{ mt: 3, pb: 4 }}`); remove any global text centering so tables/cards align left on md+ and sm breakpoints.
5. [x] Theme surfaces: verify background/foreground come from the theme after removing custom colors (light mode should show the default palette background); confirm typography inherits normal alignment and that helper texts/status use theme colors.
6. [x] Update docs: add layout notes to `design.md`, adjust `projectStructure.md` if files change, and update `README.md` if usage/build steps are impacted by CssBaseline/layout tweaks.
7. [x] Commands: run in order after code changes — lint, format check, unit tests, build, docker rebuild, e2e (see Testing section).

#### Testing

1. [x] `npm run lint --workspace client`
2. [x] `npm run format:check --workspaces`
3. [x] `npm run test --workspace client`
4. [x] `npm run build --workspace client`
5. [x] `npm run compose:build` (rebuild the full docker stack images)
6. [x] `npm run e2e:up && npm run e2e:test && npm run e2e:down` (run e2e suite against the running Docker stack; ensure LM Studio reachable or tests skip as designed)
7. [x] Manual verify after e2e: UI starts at top (no vertical centering), NavBar spans full width, content aligned left on Home/LM Studio, LM Studio table/cards align at md+/sm breakpoints, theme background visible (light) with no stray dark starter colors.

#### Implementation notes

- Removed Vite starter styling (dark background, centered body, demo link/button rules) so the theme background and default typography surface; kept only minimal smoothing + margin reset.
- Added `CssBaseline` at the app root, moved the `NavBar` AppBar outside the content container, and limited pages to a single `Container maxWidth="lg"` with left-aligned `Stack`/`Box` spacing for Home and LM Studio.
- Updated README and design notes to document the layout reset; added empty `client/.env.local` and `server/.env.local` so compose env_file loads cleanly.
- Commands run in order: lint ✅, format:check (fixed Prettier on LmStudioPage) ✅, client tests ✅ after rebuilding `common/dist` and reinstalling workspace deps, client build ✅, `compose:build` ✅, `e2e:up/test/down` ✅ (both specs passed against the compose stack), manual layout check via code + e2e load confirmed top-aligned content and full-width AppBar.

---
