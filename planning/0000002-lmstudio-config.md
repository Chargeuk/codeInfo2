# Story 0000002 – LM Studio Configuration & Model List

## Description

Extend the client so the existing version view becomes the Home page and add a dedicated “LM Studio” configuration page. On the new page, users can enter the base URL of their LM Studio server (e.g., `http://localhost:1234`), see whether the server is reachable, and view the available models reported by LM Studio. The client should rely on the server for proxying LM Studio requests so browser CORS and credentials are handled safely. Keep all prior functionality (version call) intact and present clear loading/error states for the LM Studio page.

### Acceptance Criteria

- Navigation distinguishes Home (current version card) from a new LM Studio page; route change works in dev, preview, and Docker/compose builds.
- LM Studio page captures a base URL (default `http://host.docker.internal:1234`) with validation and persistence (e.g., local storage) and allows re-check/refresh.
- Status indicator shows if LM Studio is reachable; failure surfaces an actionable error message.
- Available models list renders name/key/type using the SDK `system.listDownloadedModels` output, handles empty and error states, and is powered through the server proxy (no direct browser calls to LM Studio).
- Server exposes a typed endpoint to accept a base URL, invoke the SDK list call, and return status + models; includes input validation and timeout/exception handling.
- Tests cover new server endpoint, client LM Studio page (UI + fetch states), routing, and a Playwright flow that exercises navigation (with mocked LM Studio response).
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

1. [ ] Install routing dependency: `npm install --workspace client react-router-dom`; commit updated `package-lock.json`.
2. [ ] Create `client/src/routes/router.tsx` (or update `client/src/main.tsx`) wiring `BrowserRouter` with routes `/` → `HomePage` and `/lmstudio` → `LmStudioPage`; export router.
3. [ ] Extract current version UI into `client/src/pages/HomePage.tsx`; behaviour must match existing loading/error/version card.
4. [ ] Create `client/src/components/NavBar.tsx` using MUI `AppBar` + Tabs/Buttons; highlight active route, keyboard focusable, links to Home and LM Studio.
5. [ ] Update `client/src/App.tsx` to render routed pages via `Outlet` (or equivalent) and remove version-fetch side effects from the layout.
6. [ ] Add/adjust Jest tests in `client/src/test` to cover routing/nav: default renders Home, clicking LM Studio nav changes route.
7. [ ] Update `projectStructure.md` noting new files: `client/src/pages/HomePage.tsx`, `client/src/pages/LmStudioPage.tsx`, `client/src/components/NavBar.tsx`, `client/src/routes/router.tsx`.
8. [ ] Commands to run (in order): `npm run lint --workspace client`, `npm run test --workspace client`, `npm run build --workspace client`; fix issues before proceeding.

#### Testing

1. [ ] `npm run lint --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace client`

#### Implementation notes

- To be filled during execution.

---

### 2. Server LM Studio Proxy Endpoint (SDK)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add an Express route that accepts a base URL, invokes the LM Studio SDK to list downloaded models, and returns status + models with no caching. Keep server-side validation and timeouts to prevent hanging requests.

#### Documentation Locations

- LM Studio docs for listing models via SDK `system.listDownloadedModels` (includes sample output fields): https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- API server default port guidance (`1234`): https://lmstudio.ai/docs/developer/api.
- Express 5 routing (Context7 `/expressjs/express`).
- Node fetch/timeout patterns.
- Testing harness: Cucumber + supertest already configured in `server` workspace.

#### Subtasks

1. [ ] Install SDK: `npm install --workspace server @lmstudio/sdk`; commit updated `package-lock.json`.
2. [ ] Define shared types in `common` (e.g., `LmStudioModel`, `LmStudioStatusResponse`) and export them.
3. [ ] Add server env default `LMSTUDIO_BASE_URL=http://host.docker.internal:1234` to `server/.env`; note `.env.local` override (keeps git-ignored).
4. [ ] Implement Express route `/lmstudio/status` in new file `server/src/routes/lmstudio.ts` that:
   - Validates a `baseUrl` query/body (http/https); falls back to `LMSTUDIO_BASE_URL`.
   - Creates `LMStudioClient` pointing at the base URL and calls `client.system.listDownloadedModels()` with timeout (no caching).
   - Maps SDK result to the shared DTO (id/modelKey/displayName/type/format/path/sizeBytes/architecture/etc.).
   - Returns `{ status: 'ok' | 'error', models, baseUrl, error? }`; on error, include message and HTTP 502/400 as appropriate.
5. [ ] Wire route into server app in `server/src/index.ts` (import from `routes/lmstudio`), ensure CORS covers client origin, and log minimal info.
6. [ ] Add Cucumber test with SDK mock:
   - Create `server/src/test/support/mockLmStudioSdk.ts` exporting a stub `LMStudioClient` class with `system.listDownloadedModels(): Promise<ModelInfo[]>` returning scenario-controlled data shaped like the SDK sample (fields: `type`, `modelKey`, `displayName`, `format`, `path`, `sizeBytes`, `architecture`, optional `paramsString`, `maxContextLength`, `vision`, `trainedForToolUse`) from https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
   - Provide start/stop controls in the mock (e.g., `startMock({ port, scenario })` / `stopMock()`) so Cucumber steps can declare “Given LMStudio is running on port 1234” or “Given LMStudio is not running”. Running state returns data; stopped state rejects/throws to simulate unreachable LMStudio.
   - Allow tests to inject this mock via a factory parameter (DI) instead of patching imports; the production route defaults to the real SDK.
   - Use Cucumber steps + supertest against the Express app wired with the mock to verify:
     * success with multiple models,
     * success with zero models,
     * LMStudio unreachable/timeout.
7. [ ] Add Cucumber feature/steps: `server/src/test/features/lmstudio.feature`, `server/src/test/steps/lmstudio.steps.ts` covering success/empty/error/timeout; steps set the mock scenario then call `/lmstudio/status` via supertest.
8. [ ] Update README and design.md with new env (`LMSTUDIO_BASE_URL`), route description, and expected response shape.
9. [ ] Update `projectStructure.md` with new server files/tests.
10. [ ] Commands to run (in order): `npm run lint --workspace server`, `npm run test --workspace server` (uses mock), and manual `curl "/lmstudio/status?baseUrl=http://host.docker.internal:1234"` (requires LM Studio running).

#### Testing

1. [ ] `npm run lint --workspace server`
2. [ ] `npm run test --workspace server` (executes Cucumber with mocked SDK).
3. [ ] Manual `curl` against `/lmstudio/status?baseUrl=http://host.docker.internal:1234` (requires LM Studio running).

#### Implementation notes

- To be filled during execution.

---

### 3. LM Studio Config Page (Client, SDK-driven)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Build the LM Studio configuration UI that lets users set a base URL, view connection status, and display the model list from the server proxy with loading/error states.

#### Documentation Locations

- LM Studio SDK model listing (`system.listDownloadedModels`): https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
- MUI components (via MUI MCP).
- Testing Library/Jest patterns already in repo.
- Env defaults: `client/.env` (add `VITE_LMSTUDIO_URL=http://host.docker.internal:1234`; keep `.env.local` ignored).

#### Subtasks

1. [ ] Create `client/src/pages/LmStudioPage.tsx` with controlled base URL input (default from env/localStorage) and actions: “Check status” / “Refresh”.
2. [ ] Add a data hook (e.g., `useLmStudioStatus`) in `client/src/hooks/useLmStudioStatus.ts` calling server `/lmstudio/status`; manage states (idle/loading/success/error) and reachability indicator.
3. [ ] Render models in responsive list/table showing `displayName`, `modelKey`, `type/format`, size/arch if present; truncate long fields.
4. [ ] Add accessibility: labelled input, `aria-live` for status messages, focus management on errors, keyboard-activable refresh.
5. [ ] Persist base URL in `localStorage` and rehydrate on mount; allow reset to default.
6. [ ] Add client tests in `client/src/test/lmstudio.test.tsx` stubbing fetch: success with models, empty list, error/timeout; verify UI states and persistence.
7. [ ] Ensure routing/nav highlights LM Studio route and deep link `/lmstudio` works in dev/preview/Docker.
8. [ ] Update `README.md` with LM Studio page usage, base URL env, and note that calls go through the server proxy.
9. [ ] Update `design.md` with LM Studio flow (client → server proxy → SDK) and any UI notes.
10. [ ] Update `projectStructure.md` for new pages/hooks/components and any styling files.
11. [ ] Commands to run (in order): `npm run lint --workspace client`, `npm run test --workspace client`, `npm run build --workspace client`.

#### Testing

1. [ ] `npm run lint --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run build --workspace client`

#### Implementation notes

- To be filled during execution.

---

### 4. E2E & Documentation Updates (Live LM Studio)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Extend Playwright to cover navigation to the LM Studio page and verify UI states assuming a live LM Studio instance; refresh documentation to reflect the new feature and prerequisites.

#### Documentation Locations

- Existing Playwright setup `e2e/version.spec.ts`.
- LM Studio SDK docs for model listing (shape for assertions). citeturn0search3
- README/design.md/projectStructure.md.

#### Subtasks

1. [ ] Add Playwright spec `e2e/lmstudio.spec.ts` that: navigates to `/`, clicks LM Studio nav, waits for live data, asserts status indicator and at least one model row (requires LM Studio running at default URL).
2. [ ] Add helper inside the spec to detect unreachable LM Studio and skip with a clear message (so CI/dev failures are actionable).
3. [ ] Update README e2e section: prerequisite LM Studio running on `http://host.docker.internal:1234`; outline how to start it and remind to set the same URL in env if changed.
4. [ ] Update design.md with LM Studio flow (client → server proxy → LM Studio SDK) and navigation diagram; note no caching.
5. [ ] Update projectStructure.md for new e2e spec and any new server/client files.
6. [ ] Commands to run (in order): `npm run e2e:test`, `npm run lint --workspaces`, `npm run build:all`; record outcomes in Implementation notes.

#### Testing

1. [ ] `npm run e2e:test`
2. [ ] `npm run lint --workspaces`
3. [ ] `npm run build:all`

#### Implementation notes

- To be filled during execution.

---
