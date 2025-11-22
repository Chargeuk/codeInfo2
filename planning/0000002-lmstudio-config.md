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

## Instructions

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

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Introduce React Router (or equivalent) so the existing version card becomes the Home route and a new LM Studio route exists. Provide top-level navigation.

#### Documentation Locations

- React Router docs (Context7 `/remix-run/react-router` via Context7 MCP).
- Existing client structure (`client/src/App.tsx`, `client/src/main.tsx`).
- MUI docs (use MUI MCP tool) for Tabs/Nav (e.g., `AppBar`, `Tabs`, `Link`).
- Env defaults: `client/.env` update for `VITE_LMSTUDIO_URL` (default `http://host.docker.internal:1234`).

#### Subtasks

1. [ ] Install routing dependency with exact command `npm install --workspace client react-router-dom` (from repo root). Expect `package-lock.json` and `client/package.json` to change.
2. [ ] Add `client/src/routes/router.tsx` exporting a router (copy/paste starter):
   ```tsx
   import { createBrowserRouter, createRoutesFromElements, Route } from 'react-router-dom';
   import App from '../App';
   import HomePage from '../pages/HomePage';
   import LmStudioPage from '../pages/LmStudioPage';
   export const router = createBrowserRouter(
     createRoutesFromElements(
       <Route path="/" element={<App />}>
         <Route index element={<HomePage />} />
         <Route path="lmstudio" element={<LmStudioPage />} />
       </Route>
     )
   );
   export default router;
   ```
   Update `client/src/main.tsx` to wrap `<RouterProvider router={router} />` instead of rendering `<App />` directly.
3. [ ] Extract existing version-fetch UI into `client/src/pages/HomePage.tsx` (move logic from current `App.tsx` unchanged: loading, error, success states showing client/server version card). Switch the fetch to use the new common helper `fetchServerVersion` (see Task 2) instead of ad-hoc `fetch` to keep client/server tests aligned. Keep imports from `@codeinfo2/common` and `package.json` the same.
4. [ ] Update `client/.env` to add `VITE_LMSTUDIO_URL=http://host.docker.internal:1234` (keep existing `VITE_API_URL`), note in file comment that overrides belong in `.env.local`.
5. [ ] Create `client/src/components/NavBar.tsx` using MUI `AppBar` + `Tabs` + `Tab` with React Router links: use `component={RouterLink}` to `/` and `/lmstudio`, derive active tab from `useLocation().pathname` (treat `/` as index). Include keyboard focusability and aria labels.
6. [ ] Update `client/src/App.tsx`: render `<NavBar />` and an `<Outlet />`; remove version-fetch side effects from this file (they now live in HomePage). Keep a top-level `<Container>` wrapper if desired.
7. [ ] Add/adjust Jest tests (new file `client/src/test/router.test.tsx`): using `MemoryRouter initialEntries={['/']}` render router + NavBar; assert Home renders by default (`Client version` text present). Simulate clicking LM Studio tab and assert the URL changes to `/lmstudio` and placeholder heading like `LM Studio` is visible. Use Testing Library `userEvent`.
8. [ ] Update `projectStructure.md` with new files: `client/src/pages/HomePage.tsx`, `client/src/pages/LmStudioPage.tsx` (placeholder), `client/src/components/NavBar.tsx`, `client/src/routes/router.tsx`.
9. [ ] Commands (run in order and expect success): `npm run lint --workspace client` (0 warnings), `npm run test --workspace client` (router test passes), `npm run build --workspace client` (Vite build succeeds).

#### Testing

1. [ ] `npm run lint --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace client`

#### Implementation notes

- To be filled during execution.

---

### 2. Server Types & Env Wiring

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Set up server-side prerequisites for LM Studio integration: shared DTOs, SDK dependency, env defaults, and a route skeleton ready for injection.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- API server default port (`1234`): https://lmstudio.ai/docs/developer/api.
- Express 5 basics (Context7 `/expressjs/express`).

#### Subtasks

1. [ ] Install LM Studio SDK from repo root: `npm install --workspace server @lmstudio/sdk` (expect `package-lock.json` and `server/package.json` to change).
2. [ ] Add shared API helpers and types in `common`:
   - Types in `common/src/lmstudio.ts` exported via `common/src/index.ts`:
     - `LmStudioModel`, `LmStudioStatusOk`, `LmStudioStatusError`, `LmStudioStatusResponse` (same shapes as earlier).
   - New helper in `common/src/api.ts` (exported via index):
     ```ts
     export async function fetchLmStudioStatus({
       serverBaseUrl,
       lmBaseUrl,
       fetchImpl = globalThis.fetch,
     }: { serverBaseUrl: string; lmBaseUrl?: string; fetchImpl?: typeof fetch })
       : Promise<LmStudioStatusResponse> {
       const url = new URL('/lmstudio/status', serverBaseUrl);
       if (lmBaseUrl) url.searchParams.set('baseUrl', lmBaseUrl);
       const res = await fetchImpl(url.toString());
       return res.json();
     }
     export async function fetchServerVersion(serverBaseUrl: string, fetchImpl = globalThis.fetch) {
       const res = await fetchImpl(new URL('/version', serverBaseUrl).toString());
       return res.json();
     }
     ```
   Ensure barrel exports so both helpers are available to client UI and server tests.
3. [ ] Append `LMSTUDIO_BASE_URL=http://host.docker.internal:1234` to `server/.env` (keep comment above if present). `.env` is committed; `.env.local` stays ignored.
4. [ ] Create `server/src/routes/lmstudio.ts` with stub router factory (copy/paste skeleton):
   ```ts
   import { Router } from 'express';
   import type { LMStudioClient } from '@lmstudio/sdk';
   import type { LmStudioStatusResponse } from '@codeinfo2/common';

   type ClientFactory = (baseUrl: string) => LMStudioClient;

   export function createLmStudioRouter({ clientFactory }: { clientFactory: ClientFactory }) {
     const router = Router();
     router.get('/lmstudio/status', async (_req, res) => {
       // logic added in Task 3
       res.json({ status: 'error', baseUrl: '', error: 'not implemented' } satisfies LmStudioStatusResponse);
     });
     return router;
   }
   ```
5. [ ] Wire router in `server/src/index.ts`: import `createLmStudioRouter`, call it with a factory `(baseUrl) => new LMStudioClient({ baseUrl })` (actual logic filled in Task 3), and mount: `app.use('/', createLmStudioRouter({ clientFactory }));`. Ensure existing CORS stays enabled.
6. [ ] Update `projectStructure.md` to mention new files `common/src/lmstudio.ts`, `common/src/api.ts`, `server/src/routes/lmstudio.ts`, and the new env var line in `server/.env`.
7. [ ] Commands (expect success): `npm run lint --workspace server`, `npm run build --workspace server`.

#### Testing

1. [ ] `npm run lint --workspace server`
2. [ ] `npm run build --workspace server`

#### Implementation notes

- To be filled during execution.

---

### 3. Server SDK Proxy Implementation

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement the `/lmstudio/status` proxy route using the LM Studio SDK with timeout/no-cache and proper validation/mapping.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels` (fields: `type`, `modelKey`, `displayName`, `format`, `path`, `sizeBytes`, `architecture`, optional `paramsString`, `maxContextLength`, `vision`, `trainedForToolUse`): https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- Express 5 routing (Context7 `/expressjs/express`).
- Node fetch/timeout patterns.

#### Subtasks

1. [ ] Implement `/lmstudio/status` in `server/src/routes/lmstudio.ts`:
   - Accept query/body `baseUrl`? Use `req.query.baseUrl` (string | undefined). If missing, fall back to `process.env.LMSTUDIO_BASE_URL`.
   - Validate `baseUrl` with regex `^https?://` and reject invalid with HTTP 400 JSON `{ status: 'error', baseUrl, error: 'Invalid baseUrl' }`.
   - Create client via injected `clientFactory(baseUrl)`; set timeout using `Promise.race` with `AbortController` ~4000–5000ms.
   - Call `client.system.listDownloadedModels()`; do not cache.
2. [ ] Map SDK result to DTO `LmStudioModel[]` using fields: `model.modelKey`, `model.displayName`, `model.type`, `model.format`, `model.path`, `model.sizeBytes`, `model.architecture`, `model.paramsString ?? null`, `model.maxContextLength ?? null`, `model.vision ?? false`, `model.trainedForToolUse ?? false`.
3. [ ] Success response: HTTP 200 `{ status: 'ok', baseUrl, models }`. Empty array allowed.
4. [ ] Error handling: for validation → 400 as above; for timeout or SDK errors → 502 `{ status: 'error', baseUrl, error: '<message>' }`. Log with `console.warn` including baseUrl and message (no stack trace to avoid noise).
5. [ ] Keep CORS middleware unchanged; no additional headers required.
6. [ ] Update `projectStructure.md` noting `/lmstudio/status` route and mapping behaviour.
7. [ ] Commands (expect pass except tests): `npm run lint --workspace server`, `npm run test --workspace server` (will be red until Task 4 adds tests), `npm run build --workspace server`.

#### Testing

1. [ ] `npm run lint --workspace server`
2. [ ] `npm run build --workspace server`

#### Implementation notes

- To be filled during execution.

---

### 4. Server Cucumber Tests with LM Studio Mock

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add Cucumber coverage for the proxy route using a start/stop-able LM Studio SDK mock to cover success, empty, and unreachable cases without network calls.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- Cucumber + supertest usage (existing server test setup).

#### Subtasks

1. [ ] Create `server/src/test/support/mockLmStudioSdk.ts` that exports:
   - `type MockScenario = 'many' | 'empty' | 'timeout'`.
   - `startMock({ scenario }: { scenario: MockScenario })` to set global scenario.
   - `stopMock()` to reset.
   - `class MockLMStudioClient` with `system = { listDownloadedModels: async () => { ... } }` returning:
     - many: array of 2 models with realistic fields; empty: `[]`; timeout: await `new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))`.
2. [ ] Ensure router DI works: in tests, pass `clientFactory = () => new MockLMStudioClient() as unknown as LMStudioClient` when creating the router.
3. [ ] Add feature file `server/src/test/features/lmstudio.feature`:
   ```gherkin
   Feature: LM Studio status
     Scenario: LM Studio returns models
       Given LM Studio scenario "many"
       When I GET "/lmstudio/status"
       Then the response status code is 200
       And the JSON field "status" equals "ok"
       And the JSON array "models" has length 2

     Scenario: LM Studio returns no models
       Given LM Studio scenario "empty"
       When I GET "/lmstudio/status"
       Then the response status code is 200
       And the JSON field "status" equals "ok"
       And the JSON array "models" has length 0

     Scenario: LM Studio is unreachable
       Given LM Studio scenario "timeout"
       When I GET "/lmstudio/status"
       Then the response status code is 502
       And the JSON field "status" equals "error"
   ```
4. [ ] Add steps in `server/src/test/steps/lmstudio.steps.ts` using the shared helper instead of manual fetch:
   - Before each scenario call `startMock({ scenario })`.
   - Spin up the Express app (with injected mock factory) on a random port via `app.listen(0)`; capture the URL.
   - Call `fetchLmStudioStatus({ serverBaseUrl: baseUrlUnderTest })` from `@codeinfo2/common` to hit the real HTTP endpoint.
   - Assert status code via response shape (no supertest); after each, close the server and `stopMock()`.
5. [ ] Update `projectStructure.md` to list mock support file and new feature/steps under server tests.
6. [ ] Commands: `npm run test --workspace server` (should pass now), `npm run lint --workspace server`.

#### Testing

1. [ ] `npm run test --workspace server`
2. [ ] `npm run lint --workspace server`

#### Implementation notes

- To be filled during execution.

---

### 5. Server Documentation Updates

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Document the new server proxy endpoint, env vars, and test approach.

#### Documentation Locations

- README.md (server section).
- design.md (server/API notes).
- projectStructure.md.

#### Subtasks

1. [ ] README updates (server section):
   - Add subsection “LM Studio proxy” under Server with description of `/lmstudio/status` request (optional `?baseUrl=` query) and response shapes for ok/error (show JSON samples for each).
   - Document env `LMSTUDIO_BASE_URL` default value and override guidance.
   - Provide copy/paste curl example: `curl "http://localhost:5010/lmstudio/status?baseUrl=http://host.docker.internal:1234"` and expected `status:"ok"` + `models` array outline.
2. [ ] design.md updates:
   - Update Architecture mermaid graph to include LM Studio node: Client → Server → LM Studio, noting server as proxy.
   - Add new sequence diagram “LM Studio Flow” placed below existing Version flow showing: User → Client → Server `/lmstudio/status` → LM Studio; branches for success with models, success empty, and error/timeout; note “no caching, fresh call per refresh”.
   - Mention timeout behaviour and error surfaces in text under the diagrams.
3. [ ] projectStructure.md: add entries for `server/src/routes/lmstudio.ts`, `server/src/test/support/mockLmStudioSdk.ts`, `server/src/test/features/lmstudio.feature`, `server/src/test/steps/lmstudio.steps.ts`, and the new docs sections.
4. [ ] Update `docker-compose.yml`: remove inline `environment` entries for client/server and instead set `env_file` to use the workspace files (`server/.env`, `server/.env.local` if present; `client/.env`, `client/.env.local` if present) so there is a single source of truth. Keep port mappings the same.
5. [ ] Commands: `npm run lint --workspaces` (docs are linted by prettier); ensure it passes.

#### Testing

1. [ ] `npm run lint --workspaces`

#### Implementation notes

- To be filled during execution.

---

### 6. Client Data Hook for LM Studio

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Create a reusable hook to fetch LM Studio status/models via the server proxy with refresh support and state management.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- Testing Library/Jest patterns already in repo.

#### Subtasks

1. [ ] Implement `client/src/hooks/useLmStudioStatus.ts` using the common helper:
   - Local storage key: `lmstudio.baseUrl`.
   - Default base URL resolution order: `localStorage` value → `import.meta.env.VITE_LMSTUDIO_URL` → `'http://host.docker.internal:1234'`.
   - State shape: `{ status: 'idle' | 'loading' | 'success' | 'error'; data?: LmStudioStatusOk; error?: string; baseUrl: string }` plus booleans `isLoading`, `isError`, `isEmpty` (when success and models.length === 0).
   - Expose `refresh(nextBaseUrl?: string)` that updates base URL, writes to localStorage, flips to loading, and calls `fetchLmStudioStatus({ serverBaseUrl: import.meta.env.VITE_API_URL, lmBaseUrl: baseUrl })` imported from `@codeinfo2/common`.
   - Handle network/timeout errors by setting `status: 'error'` and `error` message.
2. [ ] Hook tests in `client/src/test/useLmStudioStatus.test.ts`: mock `global.fetch` to return JSON for scenarios many, empty, error (HTTP 502), and network rejection. Assert state transitions and that refresh updates stored baseUrl. Clear/reset localStorage between tests.
3. [ ] Ensure types imported from `@codeinfo2/common` (LmStudioStatusResponse, LmStudioStatusOk) are used for inference.
4. [ ] Update `projectStructure.md` to list the new hook file and test file.
5. [ ] Commands: `npm run lint --workspace client`, `npm run test --workspace client`.

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run lint --workspace client`

#### Implementation notes

- To be filled during execution.

---

### 7. Client LM Studio Page UI

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Build the LM Studio page that uses the hook, shows status, models, empty/error states, and provides refresh and base URL controls.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- MUI components (via MUI MCP).
- Env defaults: `client/.env` with `VITE_LMSTUDIO_URL`.

#### Subtasks

1. [ ] Build `client/src/pages/LmStudioPage.tsx` using `useLmStudioStatus`:
   - Layout: wrap in MUI `Container` and `Stack`.
   - Base URL input: MUI `TextField` label "LM Studio base URL" (controlled), helper text showing default, `aria-describedby` for validation errors.
   - Buttons: `Check status` (calls `refresh(baseUrl)`), `Reset to default` (loads env default, saves, triggers refresh), `Refresh models` (uses current baseUrl).
   - Status area: `aria-live="polite"` typography showing loading/error/success; on error call `inputRef.current?.focus()`.
2. [ ] Model list: use MUI `Table` or `List` showing columns `displayName`, `modelKey`, `type/format`, `sizeBytes` (humanized), `architecture`. Truncate long keys with `Typography noWrap` + `title` attr. Empty state text: “No models reported by LM Studio.”
3. [ ] Accessibility: ensure buttons have `aria-label` where needed, Tab order works, and error messages are announced (`role="status"`).
4. [ ] Persist base URL via localStorage key from Task 6; show the currently used URL on the page.
5. [ ] Update `projectStructure.md` to include `client/src/pages/LmStudioPage.tsx` and note new UI elements.
6. [ ] Commands: `npm run lint --workspace client`, `npm run build --workspace client` (expect success).

#### Testing

1. [ ] `npm run lint --workspace client`
2. [ ] `npm run build --workspace client`

#### Implementation notes

- To be filled during execution.

---

### 8. Client LM Studio Tests

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add Jest/Testing Library coverage for the LM Studio page and refresh/empty/error states.

#### Documentation Locations

- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- Testing Library/Jest patterns.

#### Subtasks

1. [ ] Add `client/src/test/lmstudio.test.tsx` covering:
   - Renders LM Studio page and calls the hook using mocked `fetchLmStudioStatus` (jest mock of common helper) returning models array; assert table rows > 0.
   - Empty response (`models: []`) shows empty-state message.
   - Error response (`status: 'error'`) shows error text and focuses the input.
   - `Refresh models` button triggers second helper call (count calls), `Check status` uses new base URL and persists to localStorage.
   - Routing still works when rendered under `MemoryRouter` with NavBar.
2. [ ] Mock common helper instead of global fetch to keep tests aligned with shared code; reset between tests; use `await screen.findByText` to wait for async rendering.
3. [ ] Update `projectStructure.md` to list the new test file(s).
4. [ ] Commands: `npm run test --workspace client`, `npm run lint --workspace client`.

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run lint --workspace client`

#### Implementation notes

- To be filled during execution.

---

### 9. Client Documentation Updates

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Document LM Studio client usage, refresh action, env vars, and structure changes.

#### Documentation Locations

- README.md (client section).
- design.md (UI flow, refresh/empty-state).
- projectStructure.md.

#### Subtasks

1. [ ] README client section: add “LM Studio page” subsection describing navigation path, base URL input, refresh button, and that the client always calls the server proxy (never the LM Studio server directly). Document `VITE_LMSTUDIO_URL` default and how to override via `.env.local` or build-time env.
2. [ ] design.md: mirror server doc changes by noting UI behaviours (loading spinner, empty-state text, error surface). Include the updated Architecture + LM Studio flow diagrams if not already present from Task 5 (reference the same diagrams to avoid duplication).
3. [ ] projectStructure.md: list new client files `client/src/pages/LmStudioPage.tsx`, `client/src/hooks/useLmStudioStatus.ts`, `client/src/components/NavBar.tsx`, and tests `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/lmstudio.test.tsx`.
4. [ ] README/compose note: document that `docker-compose.yml` now loads env from `client/.env[.local]` and `server/.env[.local]` via `env_file`, so env values have a single source of truth.
5. [ ] Commands: `npm run lint --workspaces` (should pass with only docs touched).

#### Testing

1. [ ] `npm run lint --workspaces`

#### Implementation notes

- To be filled during execution.

---

### 10. E2E Validation (Live LM Studio)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add Playwright coverage for navigation and LM Studio data using a live LM Studio instance; ensure prereqs are documented.

#### Documentation Locations

- Existing Playwright setup `e2e/version.spec.ts`.
- LM Studio docs `system.listDownloadedModels`: https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- README/design.md/projectStructure.md.

#### Subtasks

1. [ ] Add `e2e/lmstudio.spec.ts` with Playwright Test skeleton:
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
2. [ ] Update README e2e section: prerequisite to start LM Studio locally on default port (include sample command or link), mention skip behaviour if unreachable, and that tests hit live data.
3. [ ] Update projectStructure.md to list `e2e/lmstudio.spec.ts`.
4. [ ] Commands: `npm run e2e:test`, `npm run lint --workspaces`, `npm run build:all`; record pass/fail in Implementation notes.

#### Testing

1. [ ] `npm run e2e:test`
2. [ ] `npm run lint --workspaces`
3. [ ] `npm run build:all`

#### Implementation notes

- To be filled during execution.

---
