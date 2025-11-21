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

## Client

- `npm run dev --workspace client` (http://localhost:5001)
- `npm run build --workspace client`
- `npm run preview --workspace client -- --host --port 5001`
- Env: `client/.env` sets `VITE_API_URL` (defaults http://localhost:5010); overrides in `.env.local`

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

## Environment policy

- Commit `.env` files with safe defaults.
- Keep secrets in `.env.local` (git-ignored) when needed.
