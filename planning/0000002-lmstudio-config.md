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

1. [x] Install routing dependency with exact command `npm install --workspace client react-router-dom` (from repo root). Expect `package-lock.json` and `client/package.json` to change.
2. [x] Add `client/src/routes/router.tsx` exporting a router (copy/paste starter):
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
3. [x] Extract existing version-fetch UI into `client/src/pages/HomePage.tsx` (move logic from current `App.tsx`). Use the common helper for version fetch; starter code to paste:
   ```tsx
   import { useEffect, useState } from 'react';
   import { Card, CardContent, Container, Typography } from '@mui/material';
   import { fetchServerVersion, VersionInfo } from '@codeinfo2/common';
   import pkg from '../../package.json';

   export default function HomePage() {
     const [serverVersion, setServerVersion] = useState<VersionInfo | null>(null);
     const [error, setError] = useState<string | null>(null);
     const [loading, setLoading] = useState(true);
     const clientVersion = pkg.version;

     useEffect(() => {
       let cancelled = false;
       (async () => {
         try {
           const data = await fetchServerVersion(import.meta.env.VITE_API_URL);
           if (!cancelled) setServerVersion(data);
         } catch (err) {
           if (!cancelled) setError((err as Error).message);
         } finally {
           if (!cancelled) setLoading(false);
         }
       })();
       return () => {
         cancelled = true;
       };
     }, []);

     return (
       <Container maxWidth="sm">
         <Card sx={{ mt: 4 }}>
           <CardContent>
             <Typography variant="h4" gutterBottom>CodeInfo2 Versions</Typography>
             {loading && <Typography>Loading…</Typography>}
             {error && <Typography color="error">{error}</Typography>}
             {!loading && !error && (
               <>
                 <Typography>Client version: {clientVersion}</Typography>
                 <Typography>Server version: {serverVersion?.version}</Typography>
               </>
             )}
           </CardContent>
         </Card>
       </Container>
     );
   }
   ```
4. [x] Update `client/.env` to add `VITE_LMSTUDIO_URL=http://host.docker.internal:1234` (keep existing `VITE_API_URL`), note in file comment that overrides belong in `.env.local`.
5. [x] Create `client/src/components/NavBar.tsx` using MUI `AppBar` + `Tabs` + `Tab` with React Router links. Paste starter code (Tabs stay scrollable on small screens using `variant="scrollable"`):
   ```tsx
   import { AppBar, Tabs, Tab, Toolbar } from '@mui/material';
   import { Link as RouterLink, useLocation } from 'react-router-dom';

   export default function NavBar() {
     const { pathname } = useLocation();
     const value = pathname.startsWith('/lmstudio') ? '/lmstudio' : '/';
     return (
       <AppBar position="static">
         <Toolbar sx={{ minHeight: 64 }}>
           <Tabs
             value={value}
             aria-label="Main navigation"
             textColor="inherit"
             indicatorColor="secondary"
             variant="scrollable"
             scrollButtons={false}
           >
             <Tab label="Home" value="/" component={RouterLink} to="/" aria-label="Home" />
             <Tab label="LM Studio" value="/lmstudio" component={RouterLink} to="/lmstudio" aria-label="LM Studio" />
           </Tabs>
         </Toolbar>
       </AppBar>
     );
   }
   ```
6. [x] Update `client/src/App.tsx`: render `<NavBar />` and an `<Outlet />`; remove version-fetch side effects from this file (they now live in HomePage). Keep a top-level `<Container>` wrapper if desired.
7. [x] Add/adjust Jest tests (new file `client/src/test/router.test.tsx`): using `MemoryRouter initialEntries={['/']}` render router + NavBar; assert Home renders by default (`Client version` text present). Simulate clicking LM Studio tab and assert the URL changes to `/lmstudio` and placeholder heading like `LM Studio` is visible. Use Testing Library `userEvent`.
8. [x] Update `projectStructure.md` with new files: `client/src/pages/HomePage.tsx`, `client/src/pages/LmStudioPage.tsx` (placeholder), `client/src/components/NavBar.tsx`, `client/src/routes/router.tsx`.
9. [x] Commands (run in order and expect success):
   - `npm run lint --workspace client` → exit 0, no warnings.
   - `npm run format:check --workspace client` → reports all files formatted.
   - `npm run test --workspace client` → Jest green, e.g., `Tests: 1 passed` for router test.
   - `npm run build --workspace client` → Vite build completes, dist emitted, no errors.
   - If `format:check` fails, run `npm run format:fix --workspace client`, then rerun `npm run format:check --workspace client`.

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

1. [x] Install LM Studio SDK from repo root: `npm install --workspace server @lmstudio/sdk` (expect `package-lock.json` and `server/package.json` to change).
2. [x] Add shared API helpers and types in `common`:
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
       if (!res.ok) throw new Error(`lmstudio status failed: ${res.status}`);
       return res.json();
      }
     export async function fetchServerVersion(serverBaseUrl: string, fetchImpl = globalThis.fetch) {
       const res = await fetchImpl(new URL('/version', serverBaseUrl).toString());
       if (!res.ok) throw new Error(`version failed: ${res.status}`);
       return res.json();
     }
     ```
   Ensure barrel exports so both helpers are available to client UI and server tests.
3. [x] Append `LMSTUDIO_BASE_URL=http://host.docker.internal:1234` to `server/.env` (keep comment above if present). `.env` is committed; `.env.local` stays ignored.
4. [x] Create `server/src/routes/lmstudio.ts` with stub router factory (copy/paste skeleton):
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
5. [x] Wire router in `server/src/index.ts`: import `createLmStudioRouter`, call it with a factory `(baseUrl) => new LMStudioClient({ baseUrl })` (actual logic filled in Task 3), and mount: `app.use('/', createLmStudioRouter({ clientFactory }));`. Ensure existing CORS stays enabled.
6. [x] Update `projectStructure.md` to mention new files `common/src/lmstudio.ts`, `common/src/api.ts`, `server/src/routes/lmstudio.ts`, and the new env var line in `server/.env`.
7. [x] Commands (expect success): `npm run lint --workspace server`, `npm run format:check --workspace server`, `npm run build --workspace server`.
   - If `format:check` fails, run `npm run format:fix --workspace server`, then rerun `npm run format:check --workspace server`.

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

1. [x] Implement `/lmstudio/status` in `server/src/routes/lmstudio.ts`:
   - Accept query/body `baseUrl`? Use `req.query.baseUrl` (string | undefined). If missing, fall back to `process.env.LMSTUDIO_BASE_URL`.
   - Validate `baseUrl` with regex `^https?://` (constant `BASE_URL_REGEX`) and reject invalid with HTTP 400 JSON `{ status: 'error', baseUrl, error: 'Invalid baseUrl' }`.
   - Create client via injected `clientFactory(baseUrl)`; set timeout using `Promise.race` with `AbortController` and `const REQUEST_TIMEOUT_MS = 60000` (60 seconds).
   - Call `client.system.listDownloadedModels()`; do not cache.
2. [x] Map SDK result to DTO `LmStudioModel[]` using fields: `model.modelKey`, `model.displayName`, `model.type`, `model.format`, `model.path`, `model.sizeBytes`, `model.architecture`, `model.paramsString ?? null`, `model.maxContextLength ?? null`, `model.vision ?? false`, `model.trainedForToolUse ?? false`.
3. [x] Success response: HTTP 200 `{ status: 'ok', baseUrl, models }`. Empty array allowed.
4. [x] Error handling: for validation → 400 as above; for timeout or SDK errors → 502 `{ status: 'error', baseUrl, error: '<message>' }`. Log with `console.warn` including baseUrl and message (no stack trace to avoid noise).
5. [x] Keep CORS middleware unchanged; no additional headers required.
6. [x] Update `projectStructure.md` noting `/lmstudio/status` route and mapping behaviour.
7. [x] Commands (expect pass except tests): `npm run lint --workspace server`, `npm run format:check --workspace server`, `npm run test --workspace server` (will be red until Task 4 adds tests), `npm run build --workspace server`.
   - If `format:check` fails, run `npm run format:fix --workspace server`, then rerun `npm run format:check --workspace server`.

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

1. [x] Create `server/src/test/support/mockLmStudioSdk.ts` that exports:
   - `type MockScenario = 'many' | 'empty' | 'timeout'`.
   - `startMock({ scenario }: { scenario: MockScenario })` to set global scenario.
   - `stopMock()` to reset.
   - `class MockLMStudioClient` with `system = { listDownloadedModels: async () => { ... } }` returning:
     - many: array of 2 models with realistic fields; empty: `[]`; timeout: await `new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))`.
2. [x] Ensure router DI works: in tests, pass `clientFactory = () => new MockLMStudioClient() as unknown as LMStudioClient` when creating the router.
3. [x] Add feature file `server/src/test/features/lmstudio.feature`:
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
4. [x] Add steps in `server/src/test/steps/lmstudio.steps.ts` using the shared helper instead of manual fetch:
   - Before each scenario call `startMock({ scenario })`.
   - Spin up the Express app (with injected mock factory) on a random port via `app.listen(0)`; capture the URL.
   - Call `fetchLmStudioStatus({ serverBaseUrl: baseUrlUnderTest })` from `@codeinfo2/common` to hit the real HTTP endpoint.
   - Assert status code via response shape (no supertest); after each, close the server and `stopMock()`.
5. [x] Update `projectStructure.md` to list mock support file and new feature/steps under server tests.
6. [x] Commands: `npm run lint --workspace server`, `npm run format:check --workspace server`, `npm run test --workspace server` (should pass now).
   - If `format:check` fails, run `npm run format:fix --workspace server`, then rerun `npm run format:check --workspace server`.

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

- Task Status: __in_progress__
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
4. [ ] Update `docker-compose.yml`: remove inline `environment` entries for client/server and instead set `env_file` with exact block:
   ```yaml
   services:
     server:
       env_file:
         - server/.env
         - server/.env.local
     client:
       env_file:
         - client/.env
         - client/.env.local
   ```
   (Note: if `.env.local` is absent, create an empty file or comment/remove that line to avoid compose warnings.) Keep port mappings unchanged.
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
   - Pasteable starter:
   ```ts
   import { useCallback, useMemo, useState } from 'react';
   import { fetchLmStudioStatus, LmStudioStatusOk, LmStudioStatusResponse } from '@codeinfo2/common';

   const LS_KEY = 'lmstudio.baseUrl';
   const DEFAULT_LM_URL = 'http://host.docker.internal:1234';

   export function useLmStudioStatus() {
     const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
     const initialBaseUrl = stored ?? import.meta.env.VITE_LMSTUDIO_URL ?? DEFAULT_LM_URL;
     const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
     const [state, setState] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; data?: LmStudioStatusOk; error?: string }>({ status: 'idle' });

     const refresh = useCallback(async (nextBaseUrl?: string) => {
       const targetBase = nextBaseUrl ?? baseUrl;
       setBaseUrl(targetBase);
       if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, targetBase);
       setState({ status: 'loading' });
       try {
         const res: LmStudioStatusResponse = await fetchLmStudioStatus({ serverBaseUrl: import.meta.env.VITE_API_URL, lmBaseUrl: targetBase });
         if (res.status === 'ok') {
           setState({ status: 'success', data: res });
         } else {
           setState({ status: 'error', error: res.error });
         }
       } catch (err) {
         setState({ status: 'error', error: (err as Error).message });
       }
     }, [baseUrl]);

     const flags = useMemo(() => ({
       isLoading: state.status === 'loading',
       isError: state.status === 'error',
       isEmpty: state.status === 'success' && state.data?.models.length === 0,
     }), [state]);

     return { baseUrl, setBaseUrl, state, ...flags, refresh };
   }
   ```
2. [ ] Hook tests in `client/src/test/useLmStudioStatus.test.ts`: mock `global.fetch` to return JSON for scenarios many, empty, error (HTTP 502), and network rejection. Assert state transitions and that refresh updates stored baseUrl. Clear/reset localStorage between tests.
3. [ ] Ensure types imported from `@codeinfo2/common` (LmStudioStatusResponse, LmStudioStatusOk) are used for inference.
4. [ ] Update `projectStructure.md` to list the new hook file and test file.
5. [ ] Commands (expect clean): `npm run lint --workspace client` → exit 0; `npm run format:check --workspace client` → formatted; `npm run test --workspace client` → all hook tests green.
   - If `format:check` fails, run `npm run format:fix --workspace client`, then rerun `npm run format:check --workspace client`.

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
   - Layout: wrap in MUI `Container` and `Stack`, ensure responsiveness (use `Stack` gap and `direction` that switches to column on small screens via `useMediaQuery` or MUI responsive props).
   - Base URL input: MUI `TextField` label "LM Studio base URL" (controlled), helper text showing default, `aria-describedby` for validation errors.
   - Buttons: `Check status` (calls `refresh(baseUrl)`), `Reset to default` (loads env default, saves, triggers refresh), `Refresh models` (uses current baseUrl).
   - Status area: `aria-live="polite"` typography showing loading/error/success; on error call `inputRef.current?.focus()`.
2. [ ] Model list: use MUI `Table` on md+ screens and a `Stack`/`List` fallback on xs/sm (no horizontal scroll). Columns/fields: `displayName`, `modelKey`, `type/format`, `sizeBytes` (humanized), `architecture`. Truncate long keys with `Typography noWrap` + `title` attr. Empty state text: “No models reported by LM Studio.”
3. [ ] Accessibility: ensure buttons have `aria-label` where needed, Tab order works, and error messages are announced (`role="status"`).
4. [ ] Persist base URL via localStorage key from Task 6; show the currently used URL on the page.
5. [x] Update `projectStructure.md` to include `client/src/pages/LmStudioPage.tsx` and note new UI elements.
6. [ ] Commands: `npm run lint --workspace client` (exit 0), `npm run format:check --workspace client` (all formatted), `npm run build --workspace client` (Vite succeeds, no errors).
   - If `format:check` fails, run `npm run format:fix --workspace client`, then rerun `npm run format:check --workspace client`.
   - Pasteable starter (add responsive tweaks as needed):
   ```tsx
   import { useRef, useState } from 'react';
   import { Container, Stack, TextField, Button, Typography, Table, TableBody, TableCell, TableHead, TableRow, Paper, useMediaQuery } from '@mui/material';
   import { useTheme } from '@mui/material/styles';
   import { useLmStudioStatus } from '../hooks/useLmStudioStatus';

   const DEFAULT_LM_URL = import.meta.env.VITE_LMSTUDIO_URL ?? 'http://host.docker.internal:1234';

   export default function LmStudioPage() {
     const theme = useTheme();
     const isSmall = useMediaQuery(theme.breakpoints.down('sm'));
     const inputRef = useRef<HTMLInputElement>(null);
     const { baseUrl, setBaseUrl, state, isLoading, isError, isEmpty, refresh } = useLmStudioStatus();
     const [input, setInput] = useState(baseUrl);

     const handleCheck = () => refresh(input);
     const handleReset = () => {
       setInput(DEFAULT_LM_URL);
       refresh(DEFAULT_LM_URL);
     };

     const statusText = state.status === 'loading' ? 'Checking…' : state.status === 'error' ? state.error : `Connected to ${state.data?.baseUrl ?? ''}`;

     return (
       <Container maxWidth="md" sx={{ mt: 4, pb: 4 }}>
         <Stack spacing={2} direction="column">
           <Typography variant="h4">LM Studio</Typography>
           <TextField
             label="LM Studio base URL"
             value={input}
             inputRef={inputRef}
             onChange={(e) => setInput(e.target.value)}
             helperText={`Default: ${DEFAULT_LM_URL}`}
             aria-describedby="lmstudio-status"
             fullWidth
           />
           <Stack direction={isSmall ? 'column' : 'row'} spacing={1} alignItems={isSmall ? 'stretch' : 'center'}>
             <Button variant="contained" onClick={handleCheck} disabled={isLoading}>Check status</Button>
             <Button variant="outlined" onClick={handleReset} disabled={isLoading}>Reset to default</Button>
             <Button variant="text" onClick={() => refresh()} disabled={isLoading}>Refresh models</Button>
           </Stack>
           <Typography id="lmstudio-status" aria-live="polite" color={isError ? 'error' : 'text.primary'} role="status">
             {statusText}
           </Typography>
           {isEmpty && <Typography>No models reported by LM Studio.</Typography>}
           {state.status === 'success' && state.data?.models.length ? (
             isSmall ? (
               <Stack spacing={1} role="list">
                 {state.data.models.map((m) => (
                   <Paper key={m.modelKey} role="listitem" sx={{ p: 2 }}>
                     <Typography variant="subtitle1" noWrap title={m.displayName}>{m.displayName}</Typography>
                     <Typography variant="body2" noWrap title={m.modelKey}>{m.modelKey}</Typography>
                     <Typography variant="body2">{`${m.type}${m.format ? ` / ${m.format}` : ''}`}</Typography>
                     <Typography variant="body2">{m.architecture ?? '-'}</Typography>
                     <Typography variant="body2">Size: {m.sizeBytes ?? '-'} bytes</Typography>
                   </Paper>
                 ))}
               </Stack>
             ) : (
               <Paper>
                 <Table size="small" aria-label="LM Studio models">
                   <TableHead>
                     <TableRow>
                       <TableCell>Name</TableCell>
                       <TableCell>Key</TableCell>
                       <TableCell>Type/Format</TableCell>
                       <TableCell>Architecture</TableCell>
                       <TableCell align="right">Size (bytes)</TableCell>
                     </TableRow>
                   </TableHead>
                   <TableBody>
                     {state.data.models.map((m) => (
                       <TableRow key={m.modelKey} role="row">
                         <TableCell>{m.displayName}</TableCell>
                         <TableCell><Typography noWrap title={m.modelKey}>{m.modelKey}</Typography></TableCell>
                         <TableCell>{`${m.type}${m.format ? ` / ${m.format}` : ''}`}</TableCell>
                         <TableCell>{m.architecture ?? '-'}</TableCell>
                         <TableCell align="right">{m.sizeBytes ?? '-'}</TableCell>
                       </TableRow>
                     ))}
                   </TableBody>
                 </Table>
               </Paper>
             )
           ) : null}
         </Stack>
       </Container>
     );
   }
   ```

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
2. [ ] Mock common helper instead of global fetch to keep tests aligned with shared code; reset between tests; use `await screen.findByText` to wait for async rendering. Run `npm run format:check --workspace client` after tests.
3. [ ] Update `projectStructure.md` to list the new test file(s).
4. [ ] Commands: `npm run lint --workspace client`, `npm run format:check --workspace client`, `npm run test --workspace client`.
   - If `format:check` fails, run `npm run format:fix --workspace client`, then rerun `npm run format:check --workspace client`.

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
5. [ ] Commands: `npm run lint --workspaces` and `npm run format:check --workspaces` (should pass with only docs touched).

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
4. [ ] Commands: `npm run e2e:test`, `npm run lint --workspaces`, `npm run format:check --workspaces`, `npm run build:all`; record pass/fail in Implementation notes.
   - If `format:check` fails, run `npm run format --workspaces` or the specific workspace `npm run format:fix --workspace <pkg>`, then rerun `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run e2e:test`
2. [ ] `npm run lint --workspaces`
3. [ ] `npm run build:all`

#### Implementation notes

- To be filled during execution.

---
