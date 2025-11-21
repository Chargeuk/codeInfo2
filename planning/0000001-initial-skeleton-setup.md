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

## Implementation Plan Instructions
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

### 6. Project Structure Documentation

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

### 1. Workspace & Tooling Baseline

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Set up npm workspaces, shared TypeScript config, ESLint/Prettier, EditorConfig, and root scripts to enforce consistent tooling across client, server, and common packages.

#### Documentation Locations
- npm workspaces: Node.js/npm docs (general reference)
- ESLint: Context7 `/eslint/eslint` — flat config/TypeScript lint setup.
- Prettier: Context7 `/prettier/prettier` — formatter options and CLI usage.
- Repository docs: `README.md`, `design.md` (update as we go).

#### Subtasks
1. [ ] Create root `package.json` with `"workspaces": ["client", "server", "common"]`, `engines.node: ">=22"`, and scripts: `lint`, `lint:fix`, `format:check`, `format`, `build:all` (runs `npm run build --workspaces`), `clean`.
2. [ ] Add shared configs: `.editorconfig`, `.gitignore`, `.npmrc` (e.g., `save-exact=true`), `tsconfig.base.json` (paths + `references` placeholder) and root `tsconfig.json` that references package tsconfigs.
3. [ ] Install/dev-deps at root: `typescript`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-config-prettier`, `eslint-plugin-import`, `prettier`. Create root flat config `eslint.config.js` extending TS rules; create `.prettierrc` and `.prettierignore`.
4. [ ] Set up Husky + lint-staged: add `prepare` script, run `npm run prepare`, add `.husky/pre-commit` with `npx lint-staged`; create `lint-staged.config.mjs` to run `eslint --ext .ts,.tsx` and `prettier --check` on staged files.
5. [ ] Run `npm install` to materialize lockfile; verify root scripts execute (they should no-op on empty packages without failing).
6. [ ] Update `README.md` and `design.md` with prerequisites (Node 22), workspace layout, and root commands (`npm install`, `npm run lint`, `npm run format:check`, `npm run build:all`).
7. [ ] Update `projectStructure.md` to reflect new root files/configs.

#### Testing
1. [ ] `npm run lint --workspaces` (should pass with empty packages configured).
2. [ ] `npm run format:check --workspaces` (should pass).
3. [ ] `npm run build:all` (expected to finish quickly with no package sources yet).

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
6. [ ] Update `README.md` and `design.md` to describe the `common` package purpose, output location `dist/`, and example import usage in server/client.
7. [ ] Run `npm run lint --workspace common`, `npm run format:check --workspace common`, and `npm run build --workspace common`.
8. [ ] Run root `npm run lint --workspaces` after changes.
9. [ ] Update `projectStructure.md` with new common files/outputs.

#### Testing
1. [ ] `npm run lint --workspace common`.
2. [ ] `npm run build --workspace common` (verifies declarations emitted to `dist/`).
3. [ ] `npm run lint --workspaces` (root) to ensure no cross-package issues.

#### Implementation notes
- (Populate after work begins.)

---

### 3. Server Skeleton (Express)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Create an Express server with TypeScript, consuming the `common` package, exposing a health endpoint and an endpoint that returns shared data. Provide local run, build, lint scripts and a Dockerfile.

#### Documentation Locations
- Express: Context7 `/expressjs/express` — routing, middleware, app listen, handlers.
- TypeScript basics (if needed): Context7 `/microsoft/TypeScript` — tsconfig basics.
- ESLint: Context7 `/eslint/eslint` — lint config for TS/Node.
- Prettier: Context7 `/prettier/prettier` — formatting.
- Docker: Context7 `/docker/docs` — Debian-slim multi-stage patterns, Node images.

#### Subtasks
1. [ ] Create `server/package.json` with name `@codeinfo2/server`, main `dist/index.js`, type `module`, scripts: `dev` (`ts-node-dev --respawn src/index.ts` or `tsx watch src/index.ts`), `build` (`tsc -b`), `start` (`node dist/index.js`), `lint`, `lint:fix`, `format:check`, `format`.
2. [ ] Install dependencies: `express@5`, `cors`, `dotenv`; dev-deps: `@types/express`, `@types/node`, `ts-node-dev` or `tsx`, `typescript` (workspace), `nodemon` optional.
3. [ ] Add `server/tsconfig.json` extending `../tsconfig.base.json`, set `rootDir: src`, `outDir: dist`, `composite: true`, `esModuleInterop: true`, `resolveJsonModule: true`, and `references` -> `{ path: "../common/tsconfig.json" }`.
4. [ ] Implement `server/src/index.ts`: load env, set `const PORT = process.env.PORT ?? "5010"`; set up Express + CORS; routes:
   - `GET /health` -> `{ status: "ok", uptime, timestamp }` (uses `getAppInfo` to include server version optionally).
   - `GET /version` -> reads `package.json` version (import with `assert { type: "json" }` or `fs.readFileSync`), returns `VersionInfo` from `common` `{ app: "server", version }`.
   - `GET /info` -> returns sample message proving `common` import (e.g., `getAppInfo("server", version)`).
5. [ ] Add `server/.env.example` documenting `PORT=5010` and note CORS/client origin and `REACT_APP_API_URL` expectation on client side.
6. [ ] Add `server/Dockerfile` (Debian-slim multi-stage): stage 1 install deps + build; stage 2 copy `dist`, `package.json`, `package-lock.json`, set `ENV PORT=5010`, `EXPOSE 5010`, `CMD ["node", "dist/index.js"]`.
7. [ ] Update `README.md` & `design.md` with server run commands: `npm run dev --workspace server`, `npm run build --workspace server`, `npm run start --workspace server`; document `PORT` env, `/health`, `/version`, `/info` endpoints.
8. [ ] Run `npm run lint --workspace server`, `npm run build --workspace server`, then `npm run lint --workspaces`.
9. [ ] Update `projectStructure.md` for all server files and Dockerfile.

#### Testing
1. [ ] `npm run lint --workspace server`.
2. [ ] `npm run build --workspace server` and `npm run start --workspace server` then curl `http://localhost:5010/health` and `/version`.
3. [ ] `docker build -f server/Dockerfile -t codeinfo2-server .` and run `docker run --rm -p 5010:5010 codeinfo2-server` then curl `/health` and `/version`.

#### Implementation notes
- (Populate after work begins.)

---

### 4. Client Skeleton (React 19 + MUI)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Bootstrap React 19 client (likely Vite) with Material UI, TypeScript, ESLint, Prettier. Consume `common` package and call server API. Provide Dockerfile and local scripts.

#### Documentation Locations
- React: Context7 `/reactjs/react.dev` — components, hooks, effect on startup fetch.
- Material UI: use MUI MCP tool (per instructions) for component/theme docs (pick v7.2.0 link when needed).
- ESLint: Context7 `/eslint/eslint` — React lint rules via plugin.
- Prettier: Context7 `/prettier/prettier`.
- Docker: Context7 `/docker/docs` — client multi-stage build/serve patterns.

#### Subtasks
1. [ ] Scaffold `client` with Vite React TypeScript template (React 19) inside workspace: `npm create vite@latest client -- --template react-ts`; adjust `package.json` name to `@codeinfo2/client` and `engines.node >=22`.
2. [ ] Install deps: `@mui/material`, `@emotion/react`, `@emotion/styled`, `@mui/icons-material` (if needed), and ensure `@codeinfo2/common` workspace link resolves.
3. [ ] Set client default port to `5001` (Vite config `server.port`), add `.env.example` with `REACT_APP_API_URL=http://localhost:5010` and document override.
4. [ ] Implement startup fetch: in `src/main.tsx` (or App), use `useEffect` to call `/version` via `REACT_APP_API_URL`; display server version and client version (read from `package.json` import or inject via `import.meta.env` fallback) using the `VersionInfo` DTO from `common`.
5. [ ] Add simple UI with MUI (e.g., `Container`, `Card`, `Typography`) showing both versions and data from `/info` plus a shared value from `common`.
6. [ ] Configure scripts in `client/package.json`: `dev`, `build`, `preview`, `lint`, `lint:fix`, `format:check`, `format`; ensure ESLint React plugin present via root config or add `eslint-plugin-react`.
7. [ ] Add `client/vite.config.ts` path alias to `@codeinfo2/common` if needed; ensure TypeScript `tsconfig.json` extends root base and includes `types` for Vite.
8. [ ] Add `client/Dockerfile` (Debian-slim multi-stage): build with `npm run build`, runtime stage serving `dist` via `npm run preview -- --host --port 5001` or `serve -s dist`; set `EXPOSE 5001`.
9. [ ] Update `README.md`/`design.md` with client commands (`npm run dev --workspace client`, `npm run build --workspace client`, `npm run preview --workspace client`), env var `REACT_APP_API_URL`, and port mapping.
10. [ ] Run `npm run lint --workspace client`, `npm run build --workspace client`, and root `npm run lint --workspaces`.
11. [ ] Update `projectStructure.md` with client files (src, config, Dockerfile).

#### Testing
1. [ ] `npm run lint --workspace client`.
2. [ ] `npm run build --workspace client`; then `npm run preview --workspace client -- --host --port 5001` and load http://localhost:5001 to see versions.
3. [ ] `docker build -f client/Dockerfile -t codeinfo2-client .` and run `docker run --rm -p 5001:5001 codeinfo2-client`, verify UI shows server unreachable copy if server down.

#### Implementation notes
- (Populate after work begins.)

---

### 5. Docker Compose Integration

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Create `docker-compose.yml` wiring client and server images, managing environment variables, network, and volume needs for local dev/demo. Validate end-to-end interaction.

#### Documentation Locations
- Docker/Compose: Context7 `/docker/docs` — compose services, env overrides, build contexts, healthchecks.
- Dockerfiles from Tasks 3 & 4 (for reference once created).

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
