# Story 0000001 – Initial Skeleton Setup

## Description
Create the first runnable skeleton for CodeInfo2 with three TypeScript projects managed via npm workspaces: (1) a React 19 client using Material UI, (2) an Express server, and (3) a shared `common` package consumed by both. Each app must run locally with `npm` scripts and via Dockerfiles, and `docker-compose` must start the stack. Repository-wide linting and formatting (ESLint + Prettier) should be configured for consistent code quality.

## Acceptance Criteria
- npm workspaces configured with `client`, `server`, and `common` packages and working local installs.
- React 19 client bootstrapped with Material UI, TypeScript, ESLint, Prettier, and start/build scripts that run successfully.
- Express server skeleton with TypeScript, ESLint, Prettier, health endpoint, and start/build scripts that run successfully.
- `common` package exports at least one typed utility/value consumed by both client and server to prove cross-package consumption.
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
- Should the client reference server URL via environment variable at build time (e.g., `VITE_API_URL` or `REACT_APP_API_URL`)?

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

### 1. Workspace & Tooling Baseline

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Set up npm workspaces, shared TypeScript config, ESLint/Prettier, EditorConfig, and root scripts to enforce consistent tooling across client, server, and common packages.

#### Documentation Locations
- npm workspaces: Node.js docs / npm docs
- ESLint + Prettier setup for TypeScript
- Repository README and design notes

#### Subtasks
1. [ ] Initialize root `package.json` with npm workspaces for `client`, `server`, `common`; add root scripts for lint, format, build, and clean.
2. [ ] Add shared `.editorconfig`, `.gitignore`, `.npmrc` (if needed), base `tsconfig.json` with project references.
3. [ ] Configure ESLint + Prettier at root with TypeScript rules; ensure package-level extend works (use flat config if preferred).
4. [ ] Add root-level lint/format scripts and verify they detect issues in empty packages; wire to workspace scripts.
5. [ ] Document workspace layout and tooling in `README.md` and `design.md`.
6. [ ] Run full lint/format to validate baseline.

#### Testing
1. [ ] Prove server build works outside docker (once server exists) — placeholder for task dependency.
2. [ ] Prove client build works outside docker (once client exists) — placeholder for task dependency.
3. [ ] Prove CLEAN docker build works — placeholder for later tasks.
4. [ ] Prove docker compose starts — placeholder for later tasks.

#### Implementation notes
- (Populate after work begins.)

---

### 2. Common Package Skeleton

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Bootstrap the `common` workspace package with TypeScript build output, ready-to-publish structure, and at least one shared helper consumed by both client and server to validate workspace linking.

#### Documentation Locations
- TypeScript project references / build configs
- npm workspaces linking docs

#### Subtasks
1. [ ] Create `common/package.json` with module/exports fields, scripts (`build`, `lint`, `test?`), and TS types.
2. [ ] Add `common/tsconfig.json` extending root; configure output to `dist` with declarations.
3. [ ] Implement a simple shared utility (e.g., `getAppInfo()` returning name/version) and ensure it is exported.
4. [ ] Add per-package ESLint/Prettier configs extending root.
5. [ ] Update root build to include `common` and ensure `npm install` generates workspace links.
6. [ ] Update docs (README/design) to describe the `common` package purpose and usage.
7. [ ] Run lint/build for `common` and ensure outputs are generated.
8. [ ] Run full lint for repo.

#### Testing
1. [ ] Prove server build works outside docker (after server links to common).
2. [ ] Prove client build works outside docker (after client links to common).
3. [ ] Prove CLEAN docker build works (later).
4. [ ] Prove docker compose starts (later).

#### Implementation notes
- (Populate after work begins.)

---

### 3. Server Skeleton (Express)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Create an Express server with TypeScript, consuming the `common` package, exposing a health endpoint and an endpoint that returns shared data. Provide local run, build, lint scripts and a Dockerfile.

#### Documentation Locations
- Express + TypeScript setup
- Dockerfile best practices (multi-stage)
- ESLint/Prettier configs

#### Subtasks
1. [ ] Scaffold `server/package.json`, `tsconfig`, and entrypoint (e.g., `src/index.ts`) using `ts-node-dev` for dev and `tsc` + `node` for prod.
2. [ ] Wire health endpoint `/health` returning status and version from `common` utility.
3. [ ] Add sample API `/info` that reads from `common` package to prove shared code consumption.
4. [ ] Configure scripts: `dev`, `build`, `start`, `lint`, `format`.
5. [ ] Add Dockerfile (multi-stage, prod image running `node dist/index.js`), exposing chosen port.
6. [ ] Document server usage and env vars in README/design.
7. [ ] Run lint/build locally; ensure `common` is resolved via workspaces.
8. [ ] Run full lint repo.

#### Testing
1. [ ] Prove server build works outside docker.
2. [ ] Prove client build works outside docker (depends on Task 4).
3. [ ] Prove CLEAN docker build works (server image).
4. [ ] Prove docker compose starts.

#### Implementation notes
- (Populate after work begins.)

---

### 4. Client Skeleton (React 19 + MUI)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Bootstrap React 19 client (likely Vite) with Material UI, TypeScript, ESLint, Prettier. Consume `common` package and call server API. Provide Dockerfile and local scripts.

#### Documentation Locations
- React 19 + Vite TypeScript docs
- Material UI (use MUI MCP tool for references)
- Dockerfile best practices

#### Subtasks
1. [ ] Scaffold client with Vite React 19 TS template (or equivalent) within `client` workspace; ensure workspace install works.
2. [ ] Integrate Material UI baseline theme; add simple page showing data from `common` and fetching `/info` from server via configurable API URL.
3. [ ] Configure scripts: `dev`, `build`, `preview`, `lint`, `format`.
4. [ ] Ensure TypeScript path aliases align with root config; verify `common` workspace import works.
5. [ ] Add Dockerfile (multi-stage build, serve static via `node`/`npm run preview` or `nginx`—choose simple node serve) exposing client port.
6. [ ] Document client usage, env vars (`API_URL`), and dependency on server.
7. [ ] Run lint/build locally; ensure MUI imports work.
8. [ ] Run full lint repo.

#### Testing
1. [ ] Prove server build works outside docker (already handled in Task 3).
2. [ ] Prove client build works outside docker.
3. [ ] Prove CLEAN docker build works (client image).
4. [ ] Prove docker compose starts.

#### Implementation notes
- (Populate after work begins.)

---

### 5. Docker Compose Integration

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Create `docker-compose.yml` wiring client and server images, managing environment variables, network, and volume needs for local dev/demo. Validate end-to-end interaction.

#### Documentation Locations
- Docker Compose docs
- Existing Dockerfiles from Tasks 3 & 4

#### Subtasks
1. [ ] Write `docker-compose.yml` to build/use local images for client/server; set environment for API base URL and ports.
2. [ ] Add convenience scripts in root `package.json` for `compose:up`, `compose:down`, `compose:logs`.
3. [ ] Verify client calls server when both run via compose (adjust CORS/env as needed).
4. [ ] Document compose usage, ports, and troubleshooting in README/design.
5. [ ] Run full lint repo.

#### Testing
1. [ ] Prove server build works outside docker (from Task 3).
2. [ ] Prove client build works outside docker (from Task 4).
3. [ ] Prove CLEAN docker build works (both images via compose build).
4. [ ] Prove docker compose starts and serves end-to-end.

#### Implementation notes
- (Populate after work begins.)

---
