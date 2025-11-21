# Story 0000001 – Initial Skeleton Setup

## Description

Create the first runnable skeleton for CodeInfo2 with three TypeScript projects managed via npm workspaces: (1) a React 19 client using Material UI, (2) an Express server, and (3) a shared `common` package consumed by both. Each app must run locally with `npm` scripts and via Dockerfiles, and `docker-compose` must start the stack. Repository-wide linting and formatting (ESLint + Prettier) should be configured for consistent code quality.

### Ground rules for juniors (read before any task)

- All commands are run from the repo root unless the step explicitly says otherwise; use `npm` (not yarn/pnpm). Required tooling: Node.js 22.x, npm 10+, Docker 27+, Docker Compose v2, git CLI, curl.
- We **commit `.env` files** with safe defaults so no `.env.example` is needed; use `.env.local` for private overrides and keep `.env.local` out of git and Docker contexts.
- After every config or file creation, run the listed verification command and check for exit code 0 and the noted success text (e.g., lint shows no warnings). Do not continue if a command fails—fix, rerun, then proceed.
- When a step says "create file", it means create or replace the entire file with the provided contents. When it says "append", add below existing content. Copy snippets exactly.
- Update `projectStructure.md` at the end of each task before marking the task done. Keep status fields and Git Commit hashes current as you work.

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
- (Resolved 2025-11-21) Client uses `VITE_API_URL` at build time to target the server (Vite prefix required).

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

- Task Status: __done__
- Git Commits: a4c0c46, 0e98d67, 70b5fa4

#### Overview

Set up npm workspaces, shared TypeScript config, ESLint/Prettier, EditorConfig, and root scripts to enforce consistent tooling across client, server, and common packages.

#### Documentation Locations

- npm workspaces: Node.js/npm docs (general reference)
- ESLint: Context7 `/eslint/eslint` — flat config/TypeScript lint setup.
- Prettier: Context7 `/prettier/prettier` — formatter options and CLI usage.
- Husky: Context7 `/typicode/husky` — git hooks setup and `npm run prepare` usage.
- Repository docs: `README.md`, `design.md` (update as we go).

#### Subtasks

1. [x] Create root `package.json` with `"workspaces": ["client", "server", "common"]`, `"engines": { "node": ">=22" }`, and scripts: `"lint": "eslint . --ext .ts,.tsx --max-warnings=0"`, `"lint:fix": "eslint . --ext .ts,.tsx --fix"`, `"format:check": "prettier . --check"`, `"format": "prettier . --write"`, `"build:all": "npm run build --workspaces"`, `"clean": "rimraf node_modules */node_modules"`. Use `npm pkg set` for clarity: `npm pkg set workspaces[0]=client workspaces[1]=server workspaces[2]=common engines.node=">=22"` etc.
2. [x] Add shared configs with concrete contents/guides: `.editorconfig` (UTF-8, 2 spaces), `.gitignore` (node_modules, dist, coverage, **.env.local**, .DS_Store, playwright-report, test-results), `.npmrc` (`save-exact=true`), `tsconfig.base.json` (compilerOptions: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `skipLibCheck: true`, `esModuleInterop: true`, `resolveJsonModule: true`, `paths` placeholder), and root `tsconfig.json` `{ "files": [], "references": [ {"path":"./client"}, {"path":"./server"}, {"path":"./common"} ], "extends": "./tsconfig.base.json" }`. Confirm `.env` is **not** ignored (we commit env defaults) while `.env.local` remains ignored.
3. [x] Install dev deps at root (single command): `npm install -D typescript eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier eslint-plugin-import prettier rimraf`. Create root `eslint.config.js` using flat config, e.g.:
   ```js
   import tseslint from 'typescript-eslint';
   export default [
     ...tseslint.configs.recommended,
     {
       files: ['**/*.ts', '**/*.tsx'],
       rules: {
         'import/order': ['warn', { alphabetize: { order: 'asc' } }],
       },
     },
   ];
   ```
   Create `.prettierrc` (e.g., `{ "singleQuote": true, "semi": true }`) and `.prettierignore` (node_modules, dist, coverage, .husky).
4. [x] Set up Husky + lint-staged explicitly:
   - Add to package.json: `"prepare": "husky install"`, `"lint-staged": { "**/*.{ts,tsx,js,jsx}": ["eslint --ext .ts,.tsx --max-warnings=0", "prettier --check"] }`.
   - Install deps: `npm install -D husky lint-staged`.
   - Run `npm run prepare`, then `npx husky add .husky/pre-commit "npx lint-staged"`.
5. [x] Run `npm install` at repo root to materialize `package-lock.json`. Then dry-run scripts to prove wiring: `npm run lint --workspaces` (expect exit code 0, no warnings), `npm run format:check --workspaces` (expect “checked N files, no changes”), `npm run build:all` (no outputs to build yet but should end success).
6. [x] Update `README.md` with: prerequisites (Node 22.x, npm 10+), install (`npm install`), workspace layout, and root commands (`npm run lint`, `npm run lint:fix`, `npm run format:check`, `npm run format`, `npm run build:all`, `npm run clean`).
7. [x] Update `design.md` with a short tooling section describing shared lint/format setup, Node version, and Husky flow.
8. [x] Update `projectStructure.md` to include new root config files and note that all packages share the root lint/format setup.

#### Testing

1. [x] `npm run lint --workspaces` (should pass with empty packages configured).
2. [x] `npm run format:check --workspaces` (should pass).
3. [x] `npm run build:all` (expected to finish quickly with no package sources yet).

#### Implementation notes

- Root npm workspace created with shared TS/ESLint/Prettier configs, EditorConfig, gitignore (keeps .env, ignores .env.local), npmrc (save-exact), and Husky + lint-staged pre-commit.
- Added placeholder workspace package.json files so `npm run lint/format:check/build:all --workspaces` succeed before real scaffolds exist.
- Verified lint, format:check, and build-all run clean; documented prerequisites, root commands, and env policy in README; added tooling baseline to design.md and expanded projectStructure map.
- Committed .env policy explicitly: commit .env defaults, ignore .env.local (also excluded from dockerignore later tasks).

---

### 2. Common Package Skeleton

- Task Status: __done__
- Git Commits: ce6b662, 0991e06

#### Overview

Bootstrap the `common` workspace package with TypeScript build output, ready-to-publish structure, and at least one shared helper consumed by both client and server to validate workspace linking.

#### Documentation Locations

- TypeScript: Context7 `/microsoft/TypeScript` (project references, declaration emit).
- npm workspaces: Node.js/npm docs for workspace linking.
- ESLint: Context7 `/eslint/eslint` (package-level extend).
- Prettier: Context7 `/prettier/prettier`.

#### Subtasks

1. [x] Create `common/package.json` with:
   - name `@codeinfo2/common`, `version` placeholder `0.0.1`, `type: "module"`, `main: "dist/index.js"`, `exports: { ".": "./dist/index.js" }`.
   - scripts: `"build": "tsc -b"`, `"lint": "npm run lint --workspace root"` (inherited), or set explicitly `eslint . --ext .ts,.tsx`, plus `lint:fix`, `format`, `format:check` mirroring root commands via `"npm run ... --workspace ."`.
   - `engines.node: ">=22"`.
2. [x] Add `common/tsconfig.json` extending `../tsconfig.base.json` with:
   ```json
   {
     "extends": "../tsconfig.base.json",
     "compilerOptions": {
       "rootDir": "src",
       "outDir": "dist",
       "declaration": true,
       "composite": true
     },
     "include": ["src"],
     "references": []
   }
   ```
3. [x] Implement `common/src/versionInfo.ts`:
   - Define `export type VersionInfo = { app: string; version: string };`
   - `export function getAppInfo(app: string, version: string): VersionInfo { return { app, version }; }`.
   - Export from `common/src/index.ts` via `export * from "./versionInfo.js";`.
4. [x] Ensure lint/format simply rely on root configs (no extra config files needed); confirm `.prettierignore` covers `dist` if necessary.
5. [x] Add `references` in root `tsconfig.json` already include common; verify `npm run build --workspace common` works; confirm workspace link with `npm ls @codeinfo2/common`.
6. [x] Update `README.md` with common package commands: `npm run lint --workspace common`, `npm run format:check --workspace common`, `npm run build --workspace common`; note it exports `getAppInfo`.
7. [x] Update `design.md` with a short paragraph on the `common` package purpose and `VersionInfo` DTO.
8. [x] Run `npm run lint --workspace common`, `npm run format:check --workspace common`, and `npm run build --workspace common` after creation.
9. [x] Run root `npm run lint --workspaces` after changes to confirm cross-package success.
10. [x] Update `projectStructure.md` to list `common/src/index.ts`, `common/src/versionInfo.ts`, `common/tsconfig.json`, and `dist/` output.

#### Testing

1. [x] `npm run lint --workspace common`.
2. [x] `npm run build --workspace common` (verifies declarations emitted to `dist/`).
3. [x] `npm run lint --workspaces` (root) to ensure no cross-package issues.

#### Implementation notes

- Built out @codeinfo2/common with module exports, scripts, and tsconfig; added VersionInfo DTO plus getAppInfo helper.
- Kept lint/format on root configs; ensured dist is ignored and tsbuildinfo excluded.
- Ran npm run lint/format:check/build for common and root lint --workspaces; npm ls @codeinfo2/common shows empty until client/server depend on it.
- Documented common commands in README, purpose in design notes, and updated projectStructure to list new files.

---

### 3. Server Core (Express API)

- Task Status: __done__
- Git Commits: 615ec20, 3eacad6

#### Overview

Build the Express server core with routes, wiring to `common`, and local scripts. No Docker or tests here—those move to the next task.

#### Documentation Locations

- Express: Context7 `/expressjs/express` — routing, middleware, app listen, handlers.
- TypeScript basics (if needed): Context7 `/microsoft/TypeScript` — tsconfig basics.
- ESLint: Context7 `/eslint/eslint` — lint config for TS/Node.
- Prettier: Context7 `/prettier/prettier` — formatting.

#### Subtasks

1. [x] Create `server/package.json` with name `@codeinfo2/server`, `version: 0.0.1`, `type: "module"`, `main: "dist/index.js"`; scripts: `"dev": "tsx watch src/index.ts"`, `"build": "tsc -b"`, `"start": "node dist/index.js"`, `"lint": "eslint . --ext .ts"`, `"lint:fix": "eslint . --ext .ts --fix"`, `"format:check": "prettier . --check"`, `"format": "prettier . --write"`; `engines.node >=22`.
2. [x] Install dependencies (single command): `npm install express@5 cors dotenv`. Dev deps: `npm install -D @types/express @types/node tsx typescript` (reuses root TS but keep here for references) plus `@types/cors` if needed.
3. [x] Add `server/tsconfig.json` extending `../tsconfig.base.json`:
   ```json
   {
     "extends": "../tsconfig.base.json",
     "compilerOptions": {
       "rootDir": "src",
       "outDir": "dist",
       "composite": true,
       "esModuleInterop": true,
       "resolveJsonModule": true
     },
     "include": ["src"],
     "references": [{ "path": "../common/tsconfig.json" }]
   }
   ```
4. [x] Implement `server/src/index.ts` with explicit snippet:

   ```ts
   import express from 'express';
   import cors from 'cors';
   import { config } from 'dotenv';
   import { getAppInfo } from '@codeinfo2/common';
   import pkg from '../package.json' assert { type: 'json' };

   config();
   const app = express();
   app.use(cors());
   const PORT = process.env.PORT ?? '5010';

   app.get('/health', (_req, res) => {
     res.json({
       status: 'ok',
       uptime: process.uptime(),
       timestamp: Date.now(),
     });
   });

   app.get('/version', (_req, res) => {
     res.json(getAppInfo('server', pkg.version));
   });

   app.get('/info', (_req, res) => {
     res.json({
       message: 'Server using common package',
       info: getAppInfo('server', pkg.version),
     });
   });

   app.listen(Number(PORT), () => console.log(`Server on ${PORT}`));
   ```

5. [x] Add `server/.env` (committed) containing `PORT=5010` and a comment `# Adjust CORS origins if needed; use .env.local for private overrides`. Ensure `.env.local` stays git-ignored but `.env` is versioned. Mention in README that the committed `.env` is safe defaults only.
6. [x] Update `README.md` with exact commands: `npm run dev --workspace server`, `npm run build --workspace server`, `npm run start --workspace server`, mention default port 5010 and how to override via `.env`.
7. [x] Update `design.md` with endpoint summaries and note that `/version` draws from `package.json` and returns `VersionInfo`.
8. [x] Run `npm run lint --workspace server`, `npm run build --workspace server`, then `npm run lint --workspaces`; record any fixes.
9. [x] Update `projectStructure.md` to list `server/src/index.ts`, `server/tsconfig.json`, `server/.env` (committed defaults), and note `.env.local` is ignored.

#### Testing

1. [x] `npm run lint --workspace server`.
2. [x] `npm run build --workspace server` then `npm run start --workspace server`; `curl http://localhost:5010/health` and `curl http://localhost:5010/version` (expect JSON containing `{ app: "server", version: "<pkg version>" }`).

#### Implementation notes

- Created server workspace package.json with express/cors/dotenv deps, scripts, and engines plus workspace link to common (version-matched).
- Added tsconfig with project reference to common; implemented Express entrypoint using getAppInfo and JSON import attributes.
- Committed server/.env defaults, verified lint/build, started server and curled /health and /version for expected JSON.
- Documented server commands and endpoints in README/design and updated projectStructure accordingly.

---

### 4. Server Testing & Docker Packaging

- Task Status: __done__
- Git Commits: 5512761, 67ad373, ab39501

#### Overview

Add Cucumber (Gherkin) tests, server Dockerfile, docker ignore, and related scripts.

#### Documentation Locations

- Express: Context7 `/expressjs/express` (for any route references).
- Docker: Context7 `/docker/docs` — Debian-slim multi-stage patterns, Node images.
- Testing: Cucumber guides https://cucumber.io/docs/guides/ — Gherkin/steps/setup.

#### Subtasks

1. [x] Add testing scaffold:
   - Create `server/src/test/features/example.feature` with:
     ```gherkin
     Feature: health endpoint
       Scenario: returns ok
         When I call the health endpoint
         Then I receive status ok
     ```
   - Create `server/src/test/steps/example.steps.ts`:

     ```ts
     import { Given, When, Then } from '@cucumber/cucumber';
     import assert from 'assert';
     import fetch from 'node-fetch';

     let response: any;

     When('I call the health endpoint', async () => {
       const res = await fetch('http://localhost:5010/health');
       response = { status: res.status, body: await res.json() };
     });

     Then('I receive status ok', () => {
       assert.equal(response.status, 200);
       assert.equal(response.body.status, 'ok');
     });
     ```

   - Add `cucumber.js` (ESM) at server root:
     ```js
     export default {
       default: {
         requireModule: ['tsx/register'],
         require: ['src/test/steps/**/*.ts'],
         paths: ['src/test/features/**/*.feature'],
         publishQuiet: true,
       },
     };
     ```
   - Add scripts to `server/package.json`: `"test": "cucumber-js"`, `"test:watch": "cucumber-js --watch"`.
   - Install dev deps: `npm install -D @cucumber/cucumber tsx node-fetch @types/node-fetch` (node-fetch optional if using native fetch with Node 22 experimental; include for clarity).

2. [x] Create `server/.dockerignore` containing: `node_modules`, `dist`, `coverage`, `npm-debug.log`, `Dockerfile*`, `.dockerignore`, `.git`, `.gitignore`, `.vscode`, `.env.local`, `src/test`, `playwright-report`, `test-results`, `npm-cache` (do **not** exclude `.env` because defaults are committed and needed for build context).
3. [x] Add `server/Dockerfile` multi-stage example:

   ```Dockerfile
   FROM node:22-slim AS deps
   WORKDIR /app
   COPY package*.json ../common/package*.json ./
   COPY .. ./
   RUN npm install --workspace server --workspace common --workspaces

   FROM node:22-slim AS build
   WORKDIR /app
   COPY --from=deps /app .
   RUN npm run build --workspace server

   FROM node:22-slim AS runtime
   WORKDIR /app/server
   COPY --from=build /app/server/dist ./dist
   COPY server/package*.json ./
   ENV PORT=5010
   EXPOSE 5010
   CMD ["node", "dist/index.js"]
   ```

   (Keep paths adjusted as needed if build context is repo root.)

4. [x] Update `README.md` with commands: `npm run test --workspace server`; Docker build `docker build -f server/Dockerfile -t codeinfo2-server .`; run `docker run --rm -p 5010:5010 codeinfo2-server`; curl `http://localhost:5010/health` and `/version`.
5. [x] Update `design.md` with: cucumber location, command, how `.dockerignore` excludes tests, and Dockerfile overview (multi-stage, Node 22 slim, exposes 5010).
6. [x] Execute `npm run test --workspace server`, `npm run build --workspace server`, optionally `npm run start --workspace server` to sanity-check.
7. [x] Build and run Docker image as above; capture findings in Implementation notes if port conflicts arise.
8. [x] Update `projectStructure.md` with new test files, `cucumber.js`, `.dockerignore`, and `server/Dockerfile`.

#### Testing

1. [x] `npm run test --workspace server`.
2. [x] `docker build -f server/Dockerfile -t codeinfo2-server .` then `docker run --rm -p 5010:5010 codeinfo2-server`; `curl http://localhost:5010/health` and `curl http://localhost:5010/version`.

#### Implementation notes

- Added Cucumber health feature/steps with ts-node runner; lint/build/test pass.
- Created server Dockerfile (multi-stage Node 22 slim) and .dockerignore excluding tests; set HUSKY=0 and use npm ci --ignore-scripts to avoid husky in image builds.
- Built codeinfo2-server image successfully; server endpoints already verified earlier.
- Updated README/design/projectStructure to reflect tests and Docker artifacts.

---

### 5. Client Skeleton (React 19 + MUI)

- Task Status: __done__
- Git Commits: efe4990, cc5b311, 167a2b1

#### Overview

Bootstrap React 19 client with Material UI, TypeScript, ESLint, Prettier, and cross-package consumption. Wire startup fetch to show server/client versions. Tests and Docker move to next task.

#### Documentation Locations

- React: Context7 `/reactjs/react.dev` — components, hooks, effect on startup fetch.
- Material UI: use MUI MCP tool (per instructions) for component/theme docs (pick v7.2.0 link when needed).
- ESLint: Context7 `/eslint/eslint` — React lint rules via plugin.
- Prettier: Context7 `/prettier/prettier`.

#### Subtasks

1. [x] Scaffold client with explicit command: from repo root run `npm create vite@latest client -- --template react-ts`; when prompted, accept defaults. Edit `client/package.json` to set `name` to `@codeinfo2/client`, `version` `0.0.1`, `engines.node ">=22"`.
2. [x] Install UI + shared deps: `npm install --workspace client @mui/material @emotion/react @emotion/styled @mui/icons-material` and ensure `@codeinfo2/common` is referenced automatically via workspace (no extra install needed once common exists).
3. [x] Set default dev port and env handling:
   - In `client/vite.config.ts`, set `server: { port: 5001, host: true }`.
   - Add `client/.env` (committed) with `VITE_API_URL=http://localhost:5010` (Vite uses `VITE_` prefix). State that overrides go in `client/.env.local` (ignored) and production compose will point to `http://server:5010`.
4. [x] Implement startup fetch using hooks and common DTO:
   - In `src/App.tsx` (or create if absent), use `useEffect` to call `${import.meta.env.VITE_API_URL}/version` with `fetch`.
   - Parse JSON into `VersionInfo` (import from `@codeinfo2/common`).
   - Show client version via `package.json` import: `import pkg from "../package.json"; const clientVersion = pkg.version;`.
   - Keep fallback UI for loading/error.
5. [x] Build simple MUI UI (use MUI MCP docs if needed): wrap in `<Container maxWidth="sm">`, `<Card>`, `<Typography variant="h4" gutterBottom>CodeInfo2 Versions</Typography>`, list items for client and server versions, and show `/info` call result if implemented.
6. [x] Update scripts in `client/package.json`: `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview --host --port 5001"`, `"lint": "eslint . --ext .ts,.tsx"`, `"lint:fix": "eslint . --ext .ts,.tsx --fix"`, `"format:check": "prettier . --check"`, `"format": "prettier . --write"`.
7. [x] Ensure TypeScript config extends root: in `client/tsconfig.json`, set `"extends": "../tsconfig.base.json"`, include `"compilerOptions": { "types": ["vite/client"], "jsx": "react-jsx" }`, `"include": ["src"]`. Add optional path alias: in `vite.config.ts`, `resolve: { alias: { '@codeinfo2/common': path.resolve(__dirname, '../common/src') } }` if needed for dev speed.
8. [x] Update `README.md` with client usage: `npm run dev --workspace client` (shows on http://localhost:5001), `npm run build --workspace client`, `npm run preview --workspace client -- --host --port 5001`, and env var `VITE_API_URL` description.
9. [x] Update `design.md` with a short section: Vite + React 19 + MUI, startup fetch to `/version`, uses `VersionInfo` DTO, relies on env `VITE_API_URL`.
10. [x] Run `npm run lint --workspace client`, `npm run build --workspace client`, then `npm run lint --workspaces` to ensure root still passes.
11. [x] Update `projectStructure.md` to list `client/vite.config.ts`, `client/src/App.tsx`, `client/src/main.tsx`, `client/.env` (committed defaults), note port 5001, and that `.env.local` is ignored.

#### Testing

1. [x] `npm run lint --workspace client`.
2. [x] `npm run build --workspace client`; then `npm run preview --workspace client -- --host --port 5001` and load http://localhost:5001` (expect visible client version label and server version label once API responds).

#### Implementation notes

- Scaffolded Vite React 19 client with MUI, Node 22 engines, and lint/format scripts; env defaults stored in committed client/.env (override via .env.local).
- App.tsx fetches `${VITE_API_URL}/version` using VersionInfo from common and shows both client/server versions with loading/error UI in MUI Card.
- Vite config sets port 5001 and alias to common/src; tsconfig extends root base.
- Ran client lint/build and root lint; added docs sections and projectStructure entries.

---

### 6. Client Testing & Docker Packaging

- Task Status: __done__
- Git Commits: 332a4f7, e5a251d

#### Overview

Add Jest testing, client Dockerfile, docker ignore, and related scripts.

#### Documentation Locations

- React: Context7 `/reactjs/react.dev` (for component/test references).
- Material UI: via MUI MCP tool.
- Jest: Context7 `/jestjs/jest` — test runner/config, matchers.
- Docker: Context7 `/docker/docs` — client multi-stage build/serve patterns.
- Husky: Context7 `/typicode/husky` — git hooks, pre-commit setup (for lint-staged awareness).

#### Subtasks

1. [x] Add Jest testing scaffold under `client/src/test`:
   - Install dev deps: `npm install -D --workspace client jest ts-jest @testing-library/react @testing-library/jest-dom @types/jest @testing-library/user-event`.
   - Create `client/jest.config.ts`:
     ```ts
     import type { Config } from 'jest';
     const config: Config = {
       preset: 'ts-jest',
       testEnvironment: 'jsdom',
       testMatch: ['**/src/test/**/*.test.(ts|tsx)'],
       setupFilesAfterEnv: ['<rootDir>/src/test/setupTests.ts'],
       moduleNameMapper: { '@codeinfo2/common': '<rootDir>/../common/src' },
     };
     export default config;
     ```
   - Create `client/src/test/setupTests.ts` with `import "@testing-library/jest-dom";`.
   - Add sample test `client/src/test/version.test.tsx` rendering `<App />` and asserting text `Client version` and `Server version` using `screen.getByText` (mock fetch with `jest.spyOn(global, "fetch")`).
2. [x] Add `.dockerignore` in `client` excluding: `node_modules`, `dist`, `coverage`, `.git`, `.gitignore`, `.vscode`, `.env.local`, `npm-debug.log`, `src/test`, `playwright-report`, `test-results`, `Dockerfile*` (keep committed `.env` available to the build context).
3. [x] Add `client/Dockerfile` multi-stage:

   ```Dockerfile
   FROM node:22-slim AS build
   WORKDIR /app
   COPY package*.json ../common/package*.json ./
   COPY .. ./
   RUN npm install --workspace client --workspace common --workspaces
   RUN npm run build --workspace client

   FROM node:22-slim AS runtime
   WORKDIR /app/client
   COPY --from=build /app/client/dist ./dist
   COPY client/package*.json ./
   ENV PORT=5001
   EXPOSE 5001
   CMD ["npm", "run", "preview", "--", "--host", "--port", "5001"]
   ```

4. [x] Update `README.md` with: `npm run test --workspace client`, note `npx jest --config jest.config.ts` alternative; Docker build/run commands as above plus reminder to set `VITE_API_URL` at build time if pointing to non-default server.
5. [x] Update `design.md` with Jest setup summary, `.dockerignore` rationale, and Docker runtime strategy (Vite preview serving `dist`).
6. [x] Run `npm run test --workspace client`, `npm run build --workspace client`, then `npm run lint --workspaces`; note any fixes in Implementation notes.
7. [x] Build and run Docker image: `docker build -f client/Dockerfile -t codeinfo2-client .`; `docker run --rm -p 5001:5001 codeinfo2-client`; check UI renders without server (display friendly error).
8. [x] Update `projectStructure.md` with Jest files, `.dockerignore`, and `client/Dockerfile`.

#### Testing

1. [x] `npm run test --workspace client` (Jest).
2. [x] `docker build -f client/Dockerfile -t codeinfo2-client .` and run `docker run --rm -p 5001:5001 codeinfo2-client`; verify UI runs and shows version info (if server available).

#### Implementation notes

- Added Jest + Testing Library (jsdom) with ts-jest ESM preset, sample version test, and setup file; guarded import.meta for test runs.
- Created client Dockerfile/.dockerignore mirroring server with HUSKY disabled during image build; built codeinfo2-client image successfully.
- Ran client test/build and root lint; updated README/design/projectStructure accordingly.

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

1. [ ] Create `docker-compose.yml` with explicit content:
   ```yaml
   version: '3.9'
   services:
     server:
       build: ./server
       image: codeinfo2-server
       ports:
         - '5010:5010'
       environment:
         - PORT=5010
       healthcheck:
         test: ['CMD', 'curl', '-f', 'http://localhost:5010/health']
         interval: 10s
         timeout: 5s
         retries: 5
     client:
       build: ./client
       image: codeinfo2-client
       ports:
         - '5001:5001'
       environment:
         - VITE_API_URL=http://server:5010
       depends_on:
         server:
           condition: service_healthy
       healthcheck:
         test: ['CMD', 'curl', '-f', 'http://localhost:5001']
         interval: 10s
         timeout: 5s
         retries: 5
   ```
   (Both services share default network.)
2. [ ] Add root `package.json` scripts: `"compose:up": "docker compose up -d"`, `"compose:down": "docker compose down"`, `"compose:logs": "docker compose logs -f"`, `"compose:build": "docker compose build"`.
3. [ ] Run `docker compose up --build` once after server/client Dockerfiles exist; visit `http://localhost:5001` and confirm versions render. If CORS errors occur, update server `cors()` to allow origin `http://localhost:5001`.
4. [ ] Document compose usage in `README.md` and `design.md`: required ports 5001/5010, env overrides (`VITE_API_URL`, `PORT`), rebuild command, stop command, and healthcheck behavior.
5. [ ] Run `npm run lint --workspaces` (and `npm run format:check` if YAML is auto-formatted) after adding compose file.
6. [ ] Update `projectStructure.md` to include `docker-compose.yml` and mention new root scripts.

#### Testing

1. [ ] `docker compose build` (uses both Dockerfiles).
2. [ ] `docker compose up -d` then curl `http://localhost:5010/health` and `http://localhost:5010/version`.
3. [ ] Open `http://localhost:5001` and verify client shows server + client versions.
4. [ ] `docker compose down` to clean up.

#### Implementation notes

- (Populate after work begins.)

---

### 8. Design Diagram Updates

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Enrich `design.md` with mermaid diagrams covering the overall architecture and the client→server `/version` flow using the shared DTO.

#### Documentation Locations

- `design.md` (add diagrams here).
- Mermaid: Context7 `/mermaid-js/mermaid` — diagram syntax for graph/sequence.
- Project plan / workspace layout for reference.

#### Subtasks

1. [ ] Add mermaid `graph TD` to `design.md` with concrete nodes, e.g.:
   ```mermaid
   graph TD
     A[root package.json] --> B[client workspace]
     A --> C[server workspace]
     A --> D[common workspace]
     B -->|uses| D
     C -->|uses| D
     B --> E[client Docker image]
     C --> F[server Docker image]
     E --> G[docker-compose]
     F --> G
   ```
2. [ ] Add `sequenceDiagram` showing `/version` flow with exact steps:
   ```mermaid
   sequenceDiagram
     participant User
     participant Client
     participant Server
     participant Common
     User->>Client: open http://localhost:5001
     Client->>Server: GET /version
     Server->>Server: read package.json version
     Server->>Common: getAppInfo("server", version)
     Common-->>Server: VersionInfo
     Server-->>Client: 200 VersionInfo
     Client-->>User: renders client + server versions
   ```
3. [ ] Add 2–3 sentence description under each diagram explaining what it represents and when it’s updated.
4. [ ] Update `projectStructure.md` to mention diagrams now live in `design.md` and must be kept current.

#### Testing

1. [ ] Run `npm run lint --workspaces` or `npm run format:check` if diagrams affect lint formatting.

#### Implementation notes

- (Populate after work begins.)

---

### 9. Project Structure Documentation

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Create and maintain `projectStructure.md` at the repo root with a live directory tree and one-line purpose for each folder/file. Keep it updated across tasks.

#### Documentation Locations

- Repository tree (local working copy).
- `projectStructure.md` itself (kept current each task).

#### Subtasks

1. [ ] Create `projectStructure.md` using a tree code block, e.g.:
   ```
   .
   ├─ client/      # React SPA (Vite + MUI)
   ├─ server/      # Express API
   ├─ common/      # shared DTO/util
   ├─ planning/    # story plans
   ├─ design.md    # diagrams + architecture notes
   ├─ docker-compose.yml  # stack wiring
   └─ README.md    # how to run
   ```
   Add one-line descriptions for every root file/folder that exists after tasks (include Dockerfiles, config files, husky folder, etc.).
2. [ ] Add a bold note near the top: "Update this file immediately whenever files are added/removed/renamed; every task that changes structure must update this doc."
3. [ ] Update `README.md` to mention `projectStructure.md` in navigation/overview so newcomers know where to look for layout.
4. [ ] Update `design.md` to point readers to `projectStructure.md` for directory context.
5. [ ] Verify later tasks keep a subtask to update this document (already present); adjust if new folders appear.

#### Testing

1. [ ] Run `npm run lint --workspaces` to confirm no formatting issues after adding the doc (if covered by prettier, run `npm run format:check`).

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

1. [ ] Confirm `docker-compose.yml` builds and runs client/server images (from Task 7) before e2e.
2. [ ] Add `e2e/version.spec.ts` using Playwright Test:

   ```ts
   import { test, expect } from '@playwright/test';

   const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

   test('shows client and server versions', async ({ page }) => {
     await page.goto(baseUrl);
     await expect(page.getByText(/Client version/i)).toBeVisible();
     await expect(page.getByText(/Server version/i)).toBeVisible();
   });
   ```

   Place it in `e2e/` folder at repo root.

3. [ ] Install dev dep: `npm install -D @playwright/test`; run once `npx playwright install --with-deps` (document as pre-step).
4. [ ] Add npm scripts at root: `"e2e:up": "docker compose up -d"`, `"e2e:test": "npx playwright test e2e/version.spec.ts"`, `"e2e:down": "docker compose down"`; optional `"e2e": "npm run e2e:up && npm run e2e:test && npm run e2e:down"`.
5. [ ] Update `README.md` with step order: 1) `npm run e2e:up`, 2) `npm run e2e:test`, 3) `npm run e2e:down`; include note to run `npx playwright install --with-deps` once after installing deps.
6. [ ] Update `design.md` describing e2e scope (version display), environment (`docker-compose`), and Playwright assertion approach.
7. [ ] Update `.gitignore` to exclude `playwright-report/`, `test-results/`, `.vscode` if not already.
8. [x] Update `projectStructure.md` to include `e2e/` folder and note new npm scripts.

#### Testing

1. [ ] `npm run e2e:up` then `npm run e2e:test`; confirm the test passes and reports both versions visible.
2. [ ] `npm run e2e:down` to clean up containers.

#### Implementation notes

- (Populate after work begins.)

---
