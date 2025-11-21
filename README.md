# CodeInfo2

Monorepo for client (React 19 + MUI), server (Express), and shared common package using npm workspaces.

## Prerequisites

- Node.js 22.x and npm 10+
- Docker 27+ and Docker Compose v2
- Git, curl

## Install

```sh
npm install
```

## Workspace layout

- `client/` — React app (Vite) [workspace]
- `server/` — Express API [workspace]
- `common/` — shared TypeScript package [workspace]
- See `projectStructure.md` for the current repository map and file purposes.

## Client

- `npm run dev --workspace client` (http://localhost:5001)
- `npm run build --workspace client`
- `npm run preview --workspace client -- --host --port 5001`
- `npm run test --workspace client` (Jest + @testing-library/react)
- Env: `client/.env` sets `VITE_API_URL` (defaults http://localhost:5010); overrides in `.env.local`
- Docker: `docker build -f client/Dockerfile -t codeinfo2-client .` then `docker run --rm -p 5001:5001 codeinfo2-client`

## Root commands

- `npm run lint --workspaces`
- `npm run lint:fix --workspaces`
- `npm run format:check --workspaces`
- `npm run format --workspaces`
- `npm run build:all`
- `npm run clean`

## Common package

- `npm run lint --workspace common`
- `npm run format:check --workspace common`
- `npm run build --workspace common`
- Exports `getAppInfo(app, version): VersionInfo`

## Server

- `npm run dev --workspace server` (default port 5010)
- `npm run build --workspace server`
- `npm run start --workspace server`
- `npm run test --workspace server` (Cucumber health scenario; server must be running on 5010)
- Configure `PORT` via `server/.env` (override with `server/.env.local` if needed)
- Docker: `docker build -f server/Dockerfile -t codeinfo2-server .` then `docker run --rm -p 5010:5010 codeinfo2-server`

## Docker Compose

- Build both images: `npm run compose:build`
- Start stack: `npm run compose:up` (client on http://localhost:5001, server on http://localhost:5010)
- Tail logs: `npm run compose:logs`
- Stop stack: `npm run compose:down`
- Client uses `VITE_API_URL=http://server:5010` inside compose; override ports via `PORT` and `VITE_API_URL` if needed.

## End-to-end (Playwright)

- One-time: `npx playwright install --with-deps`
- Start stack: `npm run e2e:up`
- Run test: `npm run e2e:test` (uses `E2E_BASE_URL` or defaults to http://localhost:5001)
- Full flow: `npm run e2e`
- Shut down after tests: `npm run e2e:down`

## Environment policy

- Commit `.env` files with safe defaults.
- Keep secrets in `.env.local` (git-ignored) when needed.
