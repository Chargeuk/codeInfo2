# Story 0000001 – Initial Skeleton Setup

## Description
Create the first runnable skeleton for CodeInfo2 with three TypeScript projects managed via npm workspaces: (1) a React 19 client using Material UI, (2) an Express server, and (3) a shared `common` package consumed by both. Each app must run locally with `npm` scripts and via Dockerfiles, and `docker-compose` must start the stack. Repository-wide linting and formatting (ESLint + Prettier) should be configured for consistent code quality.

## Acceptance Criteria
- npm workspaces configured with `client`, `server`, and `common` packages and working local installs.
- React 19 client bootstrapped with Material UI, TypeScript, ESLint, Prettier, and start/build scripts that run successfully.
- Express server skeleton with TypeScript, ESLint, Prettier, health endpoint, and start/build scripts that run successfully.
- `common` package exports typed shared pieces (e.g., version DTO) consumed by both client and server to prove cross-package consumption.
- Server exposes `/version` returning its `package.json` version using the shared DTO.
- Client calls `/version` on startup, shows both server and client version values.
- Root-level `projectStructure.md` documents directory tree with one-line descriptions and is kept current by all tasks.
- Server uses Cucumber (Gherkin) tests under `server/src/test`; client uses Jest (with @testing-library/react) under `client/src/test`; test folders are excluded from Docker build contexts via .dockerignore files.
- `design.md` contains mermaid diagrams for overall architecture (client/server/common/workspaces/docker) and key request flow (client → server `/version` → common DTO).
- End-to-end smoke tested by running the full Docker stack and executing a Playwright script to validate the version UI and API flow.
- Dockerfiles for client and server build and start successfully; images run locally.
- `docker-compose` brings up both services (client + server) and wiring works (client can call server API endpoint via configured base URL).
- Root scripts for linting/formatting and workspace-aware building succeed.
- Updated documentation explains workspace layout, how to run locally, how to build images, and how to use docker-compose.

## Out Of Scope
- Production-grade CI/CD pipelines.
- Authentication/authorization flows.
- Database integration (use in-memory/mock data only).
- Advanced UI pages beyond a minimal placeholder.
- Deployment to cloud providers.

## Questions
- (Resolved 2025-11-21) Use Node.js 22.x as the baseline runtime for all packages and images.
- (Resolved 2025-11-21) Use Debian-slim base images with multi-stage builds for both client and server.
- (Resolved 2025-11-21) Default ports: client 5001, server 5010; both overridable via env variables and docker-compose mapping.
- (Resolved 2025-11-21) Enable Husky and lint-staged pre-commit hooks from the outset.
- (Resolved 2025-11-21) Client uses `REACT_APP_API_URL` at build time to target the server.

# Implementation Plan
## Instructions
This list must be copied into each new plan. It instructs how a developer works through the tasks.
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
### 1. Workspace & Tooling Baseline

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Set up npm workspaces, shared TypeScript config, ESLint/Prettier, EditorConfig, and root scripts to enforce consistent tooling across client, server, and common packages.

#### Documentation Locations
- npm workspaces: Node.js/npm docs (general reference)
- ESLint: Context7 `/eslint/eslint` — flat config/TypeScript lint setup.
- Prettier: Context7 `/prettier/prettier` — formatter options and CLI usage.
- Husky: Context7 `/typicode/husky` — git hooks setup and `npm run prepare` usage.
- Repository docs: `README.md`, `design.md` (update as we go).

#### Subtasks
1. [ ] Create root `package.json` with `"workspaces": ["client", "server", "common"]`, `engines.node: ">=22"`, and scripts: `lint`, `lint:fix`, `format:check`, `format`, `build:all` (runs `npm run build --workspaces`), `clean`.
2. [ ] Add shared configs: `.editorconfig`, `.gitignore`, `.npmrc` (e.g., `save-exact=true`), `tsconfig.base.json` (paths + `references` placeholder) and root `tsconfig.json` that references package tsconfigs.
3. [ ] Install/dev-deps at root: `typescript`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-config-prettier`, `eslint-plugin-import`, `prettier`. Create root flat config `eslint.config.js` extending TS rules with command examples using `eslint . --ext .ts,.tsx --max-warnings=0`. Create `.prettierrc` and `.prettierignore`; add `format:check` as `prettier . --check` and `format` as `prettier . --write`.
4. [ ] Set up Husky + lint-staged: add `prepare` script, run `npm run prepare` (npm v10+ with Node 22), add `.husky/pre-commit` with `npx lint-staged`; create `lint-staged.config.mjs` to run `eslint --ext .ts,.tsx --max-warnings=0` and `prettier --check` on staged files.
5. [ ] Run `npm install` to materialize lockfile; verify root scripts execute (they should no-op on empty packages without failing).
6. [ ] Update `README.md` with prerequisites (Node 22), workspace layout, and root commands (`npm install`, `npm run lint`, `npm run format:check`, `npm run build:all`).
7. [ ] Update `design.md` with tooling/architecture notes for the workspace baseline.
8. [ ] Update `projectStructure.md` to reflect new root files/configs.

#### Testing
1. [ ] `npm run lint --workspaces` (should pass with empty packages configured).
2. [ ] `npm run format:check --workspaces` (should pass).
3. [ ] `npm run build:all` (expected to finish quickly with no package sources yet).

#### Implementation notes
- (Populate after work begins.)

---

### 8. Project Structure Documentation

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Create and maintain `projectStructure.md` at the repo root with a live directory tree and one-line purpose for each folder/file. Keep it updated across tasks.

#### Documentation Locations
- Repository tree (local working copy).
- `projectStructure.md` itself (kept current each task).

#### Subtasks
1. [ ] Create `projectStructure.md` with current tree and one-line descriptions for root files/folders.
2. [ ] Add a short note in the file explaining it must be updated whenever files change.
3. [ ] Update `README.md`/`design.md` references to mention `projectStructure.md` for navigation.
4. [ ] Ensure future tasks include a subtask to update this document (already added across tasks).

#### Testing
1. [ ] Run `npm run lint --workspaces` to confirm no formatting issues after adding the doc (if covered by prettier, run `npm run format:check`).

#### Implementation notes
- (Populate after work begins.)

---

### 9. Design Diagram Updates

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Enrich `design.md` with mermaid diagrams covering the overall architecture and the client→server `/version` flow using the shared DTO.

#### Documentation Locations
- `design.md` (add diagrams here).
- Mermaid: Context7 `/mermaid-js/mermaid` — diagram syntax for graph/sequence.
- Project plan / workspace layout for reference.

#### Subtasks
1. [ ] Add a mermaid `graph TD` diagram showing workspaces (`client`, `server`, `common`), root scripts, Docker images, and docker-compose wiring.
2. [ ] Add a mermaid `sequenceDiagram` (or flowchart) depicting client startup fetching `/version`, server reading `package.json` version, returning `VersionInfo` from `common`, and client rendering versions.
3. [ ] Briefly describe each diagram below it for clarity.
4. [ ] Update `projectStructure.md` to note `design.md` now contains diagrams.

#### Testing
1. [ ] Run `npm run lint --workspaces` or `npm run format:check` if diagrams affect lint formatting.

#### Implementation notes
- (Populate after work begins.)

---

### 2. Common Package Skeleton

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Bootstrap the `common` workspace package with TypeScript build output, ready-to-publish structure, and at least one shared helper consumed by both client and server to validate workspace linking.

#### Documentation Locations
- TypeScript: Context7 `/microsoft/TypeScript` (project references, declaration emit).
- npm workspaces: Node.js/npm docs for workspace linking.
- ESLint: Context7 `/eslint/eslint` (package-level extend).
- Prettier: Context7 `/prettier/prettier`.

#### Subtasks
1. [ ] Create `common/package.json` with name `@codeinfo2/common`, type `module`, exports for `./dist/index.js`, scripts: `build` (tsc -b), `lint`, `lint:fix`, `format:check`, `format` (reuse root configs).
2. [ ] Add `common/tsconfig.json` extending `../tsconfig.base.json`, set `outDir: dist`, `declaration: true`, `composite: true`, and `references: []` (none yet).
3. [ ] Implement `common/src/versionInfo.ts` defining `VersionInfo { app: string; version: string; }` and `getAppInfo(app: string, version: string): VersionInfo`; export via `common/src/index.ts`.
4. [ ] Ensure package lint/format configs extend root (may just rely on root flat config + prettier ignore paths as needed).
5. [ ] Wire root `build:all` to build `common` (tsc project references) and confirm workspace links via `npm ls @codeinfo2/common`.
6. [ ] Update `README.md` with commands relevant to `common` package usage (build/lint) and how consumers install via workspaces.
7. [ ] Update `design.md` with purpose of `common`, how it’s shared, and reference to the VersionInfo DTO.
8. [ ] Run `npm run lint --workspace common`, `npm run format:check --workspace common`, and `npm run build --workspace common`.
9. [ ] Run root `npm run lint --workspaces` after changes.
10. [ ] Update `projectStructure.md` with new common files/outputs.

#### Testing
1. [ ] `npm run lint --workspace common`.
2. [ ] `npm run build --workspace common` (verifies declarations emitted to `dist/`).
3. [ ] `npm run lint --workspaces` (root) to ensure no cross-package issues.

#### Implementation notes
- (Populate after work begins.)

---

### 3. Server Core (Express API)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Build the Express server core with routes, wiring to `common`, and local scripts. No Docker or tests here—those move to the next task.

#### Documentation Locations
- Express: Context7 `/expressjs/express` — routing, middleware, app listen, handlers.
- TypeScript basics (if needed): Context7 `/microsoft/TypeScript` — tsconfig basics.
- ESLint: Context7 `/eslint/eslint` — lint config for TS/Node.
- Prettier: Context7 `/prettier/prettier` — formatting.

#### Subtasks
1. [ ] Create `server/package.json` with name `@codeinfo2/server`, main `dist/index.js`, type `module`, scripts: `dev` (`ts-node-dev --respawn src/index.ts` or `tsx watch src/index.ts`), `build` (`tsc -b`), `start` (`node dist/index.js`), `lint`, `lint:fix`, `format:check`, `format`.
2. [ ] Install dependencies: `express@5`, `cors`, `dotenv`; dev-deps: `@types/express`, `@types/node`, `ts-node-dev` or `tsx`, `typescript` (workspace), `nodemon` optional.
3. [ ] Add `server/tsconfig.json` extending `../tsconfig.base.json`, set `rootDir: src`, `outDir: dist`, `composite: true`, `esModuleInterop: true`, `resolveJsonModule: true`, and `references` -> `{ path: "../common/tsconfig.json" }`.
4. [ ] Implement `server/src/index.ts`: load env, set `const PORT = process.env.PORT ?? "5010"`; set up Express + CORS; routes:
   - `GET /health` -> `{ status: "ok", uptime, timestamp }` (uses `getAppInfo` to include server version optionally).
   - `GET /version` -> reads `package.json` version (import with `assert { type: "json" }` or `fs.readFileSync`), returns `VersionInfo` from `common` `{ app: "server", version }`.
   - `GET /info` -> returns sample message proving `common` import (e.g., `getAppInfo("server", version)`).
5. [ ] Add `server/.env.example` documenting `PORT=5010` and note CORS/client origin and `REACT_APP_API_URL` expectation on client side.
6. [ ] Update `README.md` with server commands (`npm run dev --workspace server`, `npm run build --workspace server`, `npm run start --workspace server`) and how to set `PORT`.
7. [ ] Update `design.md` with server architecture notes and endpoint descriptions (`/health`, `/version`, `/info`) and how they use `common`.
8. [ ] Run `npm run lint --workspace server`, `npm run build --workspace server`, then `npm run lint --workspaces`.
9. [ ] Update `projectStructure.md` for server source and config files.

#### Testing
1. [ ] `npm run lint --workspace server`.
2. [ ] `npm run build --workspace server` and `npm run start --workspace server`; curl `http://localhost:5010/health` and `/version`.

#### Implementation notes
- (Populate after work begins.)

---

### 4. Server Testing & Docker Packaging

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Add Cucumber (Gherkin) tests, server Dockerfile, docker ignore, and related scripts.

#### Documentation Locations
- Express: Context7 `/expressjs/express` (for any route references).
- Docker: Context7 `/docker/docs` — Debian-slim multi-stage patterns, Node images.
- Testing: Cucumber guides https://cucumber.io/docs/guides/ — Gherkin/steps/setup.

#### Subtasks
1. [ ] Add testing scaffold: create `server/src/test/features/example.feature` and `server/src/test/steps/example.steps.ts`; add `cucumber.js` (ESM) pointing to `src/test`, using `--require-module ts-node/register` (or `tsx`) and `--require src/test/steps/**/*.ts`, `--publish-quiet`; add scripts `test` (`cucumber-js`) and `test:watch`.
2. [ ] Ensure `.dockerignore` in `server` excludes `src/test`, `node_modules`, `npm-cache`, `dist`, `coverage`, `.vscode`, `.git`, `Dockerfile*`, build caches, and Playwright/Jest artifacts (`playwright-report`, `test-results`) even if not used here (defensive).
3. [ ] Add `server/Dockerfile` (Debian-slim multi-stage): stage 1 install deps + build; stage 2 copy `dist`, `package.json`, `package-lock.json`, set `ENV PORT=5010`, `EXPOSE 5010`, `CMD ["node", "dist/index.js"]`.
4. [ ] Update `README.md` with server test command (`npm run test --workspace server`) and Docker build/run commands (Docker first, then npm scripts).
5. [ ] Update `design.md` with testing approach (Cucumber under `src/test` with `cucumber.js` options), exclusion via `.dockerignore`, and runtime architecture/Docker notes.
6. [ ] Run `npm run test --workspace server` (cucumber-js), `npm run build --workspace server`, optional `npm run start --workspace server` sanity.
7. [ ] `docker build -f server/Dockerfile -t codeinfo2-server .` and run `docker run --rm -p 5010:5010 codeinfo2-server`; curl `/health` and `/version`.
8. [ ] Update `projectStructure.md` for test files, `.dockerignore`, and Dockerfile.

#### Testing
1. [ ] `npm run test --workspace server`.
2. [ ] `docker build -f server/Dockerfile -t codeinfo2-server .` and run `docker run --rm -p 5010:5010 codeinfo2-server`; curl `/health` and `/version`.

#### Implementation notes
- (Populate after work begins.)

---

### 5. Client Skeleton (React 19 + MUI)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Bootstrap React 19 client with Material UI, TypeScript, ESLint, Prettier, and cross-package consumption. Wire startup fetch to show server/client versions. Tests and Docker move to next task.

#### Documentation Locations
- React: Context7 `/reactjs/react.dev` — components, hooks, effect on startup fetch.
- Material UI: use MUI MCP tool (per instructions) for component/theme docs (pick v7.2.0 link when needed).
- ESLint: Context7 `/eslint/eslint` — React lint rules via plugin.
- Prettier: Context7 `/prettier/prettier`.

#### Subtasks
1. [ ] Scaffold `client` with Vite React TypeScript template (React 19) inside workspace: `npm create vite@latest client -- --template react-ts`; adjust `package.json` name to `@codeinfo2/client` and `engines.node >=22`.
2. [ ] Install deps: `@mui/material`, `@emotion/react`, `@emotion/styled`, `@mui/icons-material` (if needed), and ensure `@codeinfo2/common` workspace link resolves.
3. [ ] Set client default port to `5001` (Vite config `server.port`), add `.env.example` with `REACT_APP_API_URL=http://localhost:5010` and document override.
4. [ ] Implement startup fetch: in `src/main.tsx` (or App), use `useEffect` to call `/version` via `REACT_APP_API_URL`; display server version and client version (read from `package.json` import or inject via `import.meta.env` fallback) using the `VersionInfo` DTO from `common`.
5. [ ] Add simple UI with MUI (e.g., `Container`, `Card`, `Typography`) showing both versions and data from `/info` plus a shared value from `common`.
6. [ ] Configure scripts in `client/package.json`: `dev`, `build`, `preview`, `lint`, `lint:fix`, `format:check`, `format`; ensure ESLint React plugin present via root config or add `eslint-plugin-react`.
7. [ ] Add `client/vite.config.ts` path alias to `@codeinfo2/common` if needed; ensure TypeScript `tsconfig.json` extends root base and includes `types` for Vite.
8. [ ] Update `README.md` with client commands (`npm run dev --workspace client`, `npm run build --workspace client`, `npm run preview --workspace client`), env var `REACT_APP_API_URL`, and port mapping.
9. [ ] Update `design.md` with client architecture notes (Vite, MUI, version fetch flow) and dependency on server.
10. [ ] Run `npm run lint --workspace client`, `npm run build --workspace client`, and root `npm run lint --workspaces`.
11. [ ] Update `projectStructure.md` with client source/config files.

#### Testing
1. [ ] `npm run lint --workspace client`.
2. [ ] `npm run build --workspace client`; then `npm run preview --workspace client -- --host --port 5001` and load http://localhost:5001 to see versions.

#### Implementation notes
- (Populate after work begins.)

---

### 6. Client Testing & Docker Packaging

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Add Jest testing, client Dockerfile, docker ignore, and related scripts.

#### Documentation Locations
- React: Context7 `/reactjs/react.dev` (for component/test references).
- Material UI: via MUI MCP tool.
- Docker: Context7 `/docker/docs` — client multi-stage build/serve patterns.
- Husky: Context7 `/typicode/husky` — git hooks, pre-commit setup (for lint-staged awareness).

#### Subtasks
1. [ ] Add Jest testing scaffold under `client/src/test`: install `jest`, `@testing-library/react`, `@testing-library/jest-dom`, `ts-jest` (recommended runner), create `jest.config.ts` with `preset: 'ts-jest'`, `testMatch: ['**/src/test/**/*.test.ts?(x)']`, `setupFilesAfterEnv: ['<rootDir>/src/test/setupTests.ts']`; add `src/test/setupTests.ts` importing `@testing-library/jest-dom`; add an example test that renders the version UI.
2. [ ] Add `.dockerignore` in `client` excluding `src/test`, `node_modules`, `npm-cache`, `dist`, `coverage`, `.vscode`, `.git`, `Dockerfile*`, `playwright-report`, `test-results`.
3. [ ] Add `client/Dockerfile` (Debian-slim multi-stage): build with `npm run build`, runtime stage serving `dist` via `npm run preview -- --host --port 5001` or `serve -s dist`; set `EXPOSE 5001`.
4. [ ] Update `README.md` with client test command (`npm run test --workspace client`) and Docker build/run commands (Docker first, then npm scripts).
5. [ ] Update `design.md` with testing approach (Jest under `src/test`, `ts-jest` preset, setup file), exclusion via `.dockerignore`, and runtime serve approach.
6. [ ] Run `npm run test --workspace client`, `npm run build --workspace client`, and root `npm run lint --workspaces`.
7. [ ] `docker build -f client/Dockerfile -t codeinfo2-client .` and run `docker run --rm -p 5001:5001 codeinfo2-client`, verify UI handles server unreachable case.
8. [ ] Update `projectStructure.md` with client test files, `.dockerignore`, and Dockerfile.

#### Testing
1. [ ] `npm run test --workspace client` (Jest).
2. [ ] `docker build -f client/Dockerfile -t codeinfo2-client .` and run `docker run --rm -p 5001:5001 codeinfo2-client`; verify UI runs and shows version info (if server available).

#### Implementation notes
- (Populate after work begins.)

---

### 7. Docker Compose Integration

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Create `docker-compose.yml` wiring client and server images, managing environment variables, network, and volume needs for local dev/demo. Validate end-to-end interaction.

#### Documentation Locations
- Docker/Compose: Context7 `/docker/docs` — compose services, env overrides, build contexts, healthchecks.
- Dockerfiles from Tasks 4 & 6 (for reference once created).

#### Subtasks
1. [ ] Create `docker-compose.yml` with services:
   - `server`: build `./server`, image `codeinfo2-server`, ports `5010:5010`, env `PORT=5010`.
   - `client`: build `./client`, image `codeinfo2-client`, ports `5001:5001`, env `REACT_APP_API_URL=http://server:5010`.
   - Define shared network; add healthchecks for server (`curl -f http://localhost:5010/health`) and client (`curl -f http://localhost:5001`).
2. [ ] Add root scripts: `compose:up`, `compose:down`, `compose:logs`, `compose:build` pointing to `docker compose` commands.
3. [ ] Run `docker compose up --build` and verify UI shows both versions; adjust CORS if needed in server.
4. [ ] Document compose usage in `README.md`/`design.md`: required env vars, port bindings (5001/5010), how to rebuild images, how to stop.
5. [ ] Run `npm run lint --workspaces` after compose file added to ensure formatting rules pass (use prettier on YAML if configured).
6. [ ] Update `projectStructure.md` with compose file and any new supporting scripts.

#### Testing
1. [ ] `docker compose build` (uses both Dockerfiles).
2. [ ] `docker compose up -d` then curl `http://localhost:5010/health` and `http://localhost:5010/version`.
3. [ ] Open `http://localhost:5001` and verify client shows server + client versions.
4. [ ] `docker compose down` to clean up.

#### Implementation notes
- (Populate after work begins.)

---

### 10. End-to-End Validation with Playwright

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Spin up the full stack via Docker Compose and run a Playwright script to validate the version UI and API flow (client displays both client/server versions from `/version`).

#### Documentation Locations
- Docker/Compose: Context7 `/docker/docs` — compose usage.
- Playwright: Context7 `/microsoft/playwright` — scripting, assertions, CLI options, `npx playwright install --with-deps`.
- Husky: Context7 `/typicode/husky` — if hooks are run before e2e scripts.
- Mermaid: Context7 `/mermaid-js/mermaid` — diagram syntax reference for any flow/graph updates tied to E2E notes.

#### Subtasks
1. [ ] Ensure `docker-compose.yml` builds and runs client/server images (depends on Task 7).
2. [ ] Add `e2e/` folder with a Playwright script (e.g., `e2e/version.spec.ts`) that: starts from `http://localhost:5001`, waits for page load, asserts presence of client version text and server version text fetched from `/version`; handle server-down case as a test failure (no skip).
3. [ ] Add dev-deps: `@playwright/test`; add npm scripts: `e2e:up` (`docker compose up -d`), `e2e:test` (`npx playwright test e2e/version.spec.ts`), `e2e:down` (`docker compose down`); document `npx playwright install --with-deps` prerequisite.
4. [ ] Document in `README.md` the commands/order: `npm run e2e:up`, `npm run e2e:test`, `npm run e2e:down` (Docker commands first), plus Playwright install note (`npx playwright install --with-deps` if needed).
5. [ ] Update `design.md` to note E2E coverage scope (version flow) and that it runs against compose stack.
6. [ ] Update `.gitignore` if Playwright artifacts (e.g., `test-results`, `playwright-report`) generated.
7. [ ] Update `projectStructure.md` with `e2e/` and new scripts.

#### Testing
1. [ ] `npm run e2e:up` then `npm run e2e:test`; confirm the test passes and reports both versions visible.
2. [ ] `npm run e2e:down` to clean up containers.

#### Implementation notes
- (Populate after work begins.)

---
