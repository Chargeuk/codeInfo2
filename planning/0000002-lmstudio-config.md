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

1. [ ] Install SDK: `npm install --workspace server @lmstudio/sdk`; commit `package-lock.json`.
2. [ ] Add shared types in `common` (e.g., `LmStudioModel`, `LmStudioStatusResponse`) and export from `common/src/index.ts`.
3. [ ] Add `LMSTUDIO_BASE_URL=http://host.docker.internal:1234` to `server/.env`; remind `.env.local` remains ignored.
4. [ ] Create `server/src/routes/lmstudio.ts` with an exported factory `createLmStudioRouter({ clientFactory })` placeholder wiring (no logic yet).
5. [ ] Update `server/src/index.ts` to mount the router (stub) and ensure CORS still allows client origin.
6. [ ] Update `projectStructure.md` to include new server route file and env entry.
7. [ ] Commands: `npm run lint --workspace server`, `npm run build --workspace server`.

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

1. [ ] Implement logic in `server/src/routes/lmstudio.ts`: validate `baseUrl` (http/https), default to `LMSTUDIO_BASE_URL`, create `LMStudioClient`, call `system.listDownloadedModels()` with timeout (~3–5s), no caching.
2. [ ] Map SDK result to shared DTO fields and return `{ status: 'ok', models, baseUrl }`; on errors return `{ status: 'error', error, baseUrl }` with HTTP 400/502 as appropriate.
3. [ ] Ensure CORS is unchanged and minimal logging added.
4. [ ] Update `projectStructure.md` for implemented route details.
5. [ ] Commands: `npm run lint --workspace server`, `npm run test --workspace server` (will be red until Task 4 adds tests), `npm run build --workspace server`.

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

1. [ ] Create `server/src/test/support/mockLmStudioSdk.ts` exporting stub `LMStudioClient` with `system.listDownloadedModels()` and controls `startMock({ scenario, port })` / `stopMock()`, scenarios: `many`, `empty`, `unreachable/timeout`.
2. [ ] Allow DI into the route: the router should accept `clientFactory` so tests inject the mock; production uses real SDK.
3. [ ] Add feature file `server/src/test/features/lmstudio.feature` with scenarios: LM Studio running with models, running with zero models, LM Studio down/unreachable.
4. [ ] Add step definitions `server/src/test/steps/lmstudio.steps.ts` using supertest against the Express app wired to the mock; set scenario per step.
5. [ ] Update `projectStructure.md` to note the mock support file and new feature/steps.
6. [ ] Commands: `npm run test --workspace server`, `npm run lint --workspace server`.

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

1. [ ] Update README server section: describe `/lmstudio/status`, expected response shape, `LMSTUDIO_BASE_URL`, and curl example.
2. [ ] Update design.md with proxy flow and no-cache note.
3. [ ] Update projectStructure.md with new route, test files, mock support file.
4. [ ] Commands: `npm run lint --workspaces`.

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

1. [ ] Create `client/src/hooks/useLmStudioStatus.ts` to call `/lmstudio/status` (using `VITE_LMSTUDIO_URL` default). Manage states: idle/loading/success/error, expose `refresh()` and derived flags.
2. [ ] Handle empty-model response distinctly (reachable but zero models).
3. [ ] Export types from `common` for hook typing.
4. [ ] Add hook unit tests (mock fetch) covering success/many, success/empty, error/timeout, refresh behaviour.
5. [ ] Update `projectStructure.md` to include the new hook file and tests.
6. [ ] Commands: `npm run lint --workspace client`, `npm run test --workspace client`.

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

1. [ ] Implement `client/src/pages/LmStudioPage.tsx` using `useLmStudioStatus`; controlled base URL input (env/localStorage default), “Check status” and “Refresh models” buttons.
2. [ ] Render model list/table (displayName, modelKey, type/format, size/arch) with truncation and empty-state message when reachable but zero models.
3. [ ] Accessibility: labelled input, `aria-live` for status, focus on error, keyboard-activable refresh.
4. [ ] Persist base URL to `localStorage`; allow reset to default.
5. [ ] Update `projectStructure.md` for the new page file.
6. [ ] Commands: `npm run lint --workspace client`, `npm run build --workspace client`.

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

1. [ ] Add `client/src/test/lmstudio.test.tsx` to cover: success (many models), success (zero models shows empty-state), error/timeout, refresh triggers refetch, base URL persistence.
2. [ ] Mock fetch to the server proxy; ensure NavBar/routing still render page.
3. [ ] Update `projectStructure.md` for the new test file(s).
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

1. [ ] Update README: LM Studio page usage, `VITE_LMSTUDIO_URL`, server-proxy note, refresh button behaviour.
2. [ ] Update design.md: client flow (client → server proxy → SDK), empty-state and refresh notes.
3. [ ] Update projectStructure.md: pages/hooks/tests files.
4. [ ] Commands: `npm run lint --workspaces`.

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

1. [ ] Add `e2e/lmstudio.spec.ts`: navigate to `/`, click LM Studio nav, wait for live data, assert status indicator and at least one model row (requires LM Studio at default URL).
2. [ ] Add helper to skip with a clear message if LM Studio is unreachable.
3. [ ] Update README e2e section with the LM Studio prerequisite and how to start it.
4. [ ] Update projectStructure.md for new e2e spec.
5. [ ] Commands: `npm run e2e:test`, `npm run lint --workspaces`, `npm run build:all`; record results in Implementation notes.

#### Testing

1. [ ] `npm run e2e:test`
2. [ ] `npm run lint --workspaces`
3. [ ] `npm run build:all`

#### Implementation notes

- To be filled during execution.

---
