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

#### Subtasks

1. [ ] Install `react-router-dom` in the client workspace; verify package-lock updates.
2. [ ] Create router entry in `client/src/main.tsx` (or `router.tsx`) with routes `/` (Home) and `/lmstudio`; wrap app with `BrowserRouter`.
3. [ ] Extract existing version UI into `HomePage` component/file and keep behaviour identical (loading/error/version card).
4. [ ] Create a shared layout with MUI `AppBar` + nav (Tabs or Buttons) that shows active route, supports keyboard focus, and links to Home/LM Studio.
5. [ ] Update `client/src/App.tsx` to render routed pages via `Outlet` (or simple switch) and remove direct version-fetch side effects from the layout.
6. [ ] Add/adjust Jest tests for routing and nav (render default home, clicking LM Studio tab changes route).
7. [ ] Update `projectStructure.md` with new files (layout, HomePage, router).
8. [ ] Run `npm run lint --workspace client`, `npm run test --workspace client`, and `npm run build --workspace client`; fix issues.

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

#### Subtasks

1. [ ] Add `@lmstudio/sdk` dependency to server workspace (workspace install).
2. [ ] Define shared types in `common` (e.g., `LmStudioModel`, `LmStudioStatusResponse`) and export them.
3. [ ] Add server env default `LMSTUDIO_BASE_URL=http://host.docker.internal:1234` to `server/.env`; note `.env.local` override.
4. [ ] Implement Express route `/lmstudio/status` that:
   - Validates a `baseUrl` query/body (http/https); falls back to `LMSTUDIO_BASE_URL`.
   - Creates `LMStudioClient` pointing at the base URL and calls `client.system.listDownloadedModels()` with timeout (no caching).
   - Maps SDK result to the shared DTO (id/modelKey/displayName/type/format/path/sizeBytes/architecture/etc.).
   - Returns `{ status: 'ok' | 'error', models, baseUrl, error? }`; on error, include message and HTTP 502/400 as appropriate.
5. [ ] Wire route into server app (e.g., `app.get('/lmstudio/status', handler)`), ensure CORS covers client origin, and log minimal info.
6. [ ] Add Cucumber test with SDK mock:
   - Create `server/src/test/support/mockLmStudioSdk.ts` exporting a stub `LMStudioClient` class with `system.listDownloadedModels(): Promise<ModelInfo[]>` returning scenario-controlled data shaped like the SDK sample (fields: `type`, `modelKey`, `displayName`, `format`, `path`, `sizeBytes`, `architecture`, optional `paramsString`, `maxContextLength`, `vision`, `trainedForToolUse`) from https://lmstudio.ai/docs/typescript/manage-models/list-downloaded.
   - Allow tests to inject this stub into the route via a factory parameter (DI) instead of patching imports; the production route defaults to the real SDK.
   - Use Cucumber steps + supertest against the Express app wired with the stub to verify success (list length > 0), empty list, and error/timeout responses without network access.
7. [ ] Update README and design.md with new env (`LMSTUDIO_BASE_URL`), route description, and expected response shape.
8. [ ] Update `projectStructure.md` with new server files/tests.
9. [ ] Run `npm run lint --workspace server`, `npm run test --workspace server`, and manual `curl "/lmstudio/status?baseUrl=http://host.docker.internal:1234"` (LM Studio running).

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

#### Subtasks

1. [ ] Create `LmStudioPage` with controlled base URL input (default from env/localStorage) and actions: “Check status” / “Refresh”.
2. [ ] Implement data hook to call server `/lmstudio/status`; manage states (idle/loading/success/error) and derive reachability indicator.
3. [ ] Render models in responsive list/table showing `displayName`, `modelKey`, `type/format`, size/arch if present; truncate long fields.
4. [ ] Add accessibility: labelled input, `aria-live` for status messages, focus management on errors, keyboard-activable refresh.
5. [ ] Persist base URL in `localStorage` and rehydrate on mount; allow reset to default.
6. [ ] Add client tests (Jest + Testing Library) stubbing fetch: success with models, empty list, error/timeout; verify UI states and persistence.
7. [ ] Ensure routing/nav highlights LM Studio route and deep link `/lmstudio` works in dev/preview/Docker.
8. [ ] Update `projectStructure.md` for new components/hooks; add any styling files.
9. [ ] Run `npm run lint --workspace client`, `npm run test --workspace client`, and `npm run build --workspace client`.

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
2. [ ] Add helper to skip test with clear message if LM Studio is unreachable (to aid CI/dev).
3. [ ] Update README e2e section: prerequisite LM Studio running on `http://host.docker.internal:1234`; outline start/stop steps.
4. [ ] Update design.md with LM Studio flow (client → server proxy → LM Studio SDK) and navigation diagram; note no caching.
5. [ ] Update projectStructure.md for new e2e spec and any new server/client files.
6. [ ] Run `npm run e2e:test`, `npm run lint --workspaces`, `npm run build:all`; record outcomes in Implementation notes.

#### Testing

1. [ ] `npm run e2e:test`
2. [ ] `npm run lint --workspaces`
3. [ ] `npm run build:all`

#### Implementation notes

- To be filled during execution.

---
