# DEV-000001 Working Plan: Server Port Hardening Without Touching compose:local

## Goal

Remove hard-coded runtime assumptions around server port `5010` so container/runtime behavior is consistently driven by `SERVER_PORT` (with controlled legacy fallback), while preserving current behavior for existing users.

## Non-Negotiable Constraints

- Do **not** stop/restart `compose:local` (`npm run compose:local:*` lifecycle commands are out of scope).
- Use only:
  - in-place checks against the already running `*-local` stack (`docker exec`, `curl`), and
  - disposable stacks (`compose` and `e2e`) for build/runtime validation.
- Keep commits incremental and focused.

## Current Baseline (already implemented)

- `server/src/config/serverPort.ts` exists with precedence:
  - `SERVER_PORT` -> `PORT` -> `'5010'`.
- `server/src/index.ts` and `server/src/providers/mcpStatus.ts` already consume `resolveServerPort()`.
- `server/.env`, `server/.env.e2e`, and `server/Dockerfile` already switched to `SERVER_PORT` defaults.

## Remaining Hardening Changes

### Task 1: Remove stale hard-coded `5010` assumptions in seeded Codex config output

Why:

- `server/src/config/codexConfig.ts` still seeds static MCP URL values using `http://localhost:5010/mcp`.
- If server runs on another port, newly seeded configs can become misleading.

Changes:

1. Update `server/src/config/codexConfig.ts`:

- Replace static `defaultCodexConfig` MCP URL entries with values built from resolved server port.
- Keep behavior deterministic if `SERVER_PORT` is missing (falls back to existing `5010`).
- Ensure generated URLs remain:
  - host: `http://localhost:<resolved>/mcp`
  - docker: `http://server:<resolved>/mcp`

2. Add or update tests for config seeding behavior:

- File: `server/src/test/unit/codexConfig.test.ts` (or existing relevant test file)
- Validate seeded config contains resolved port when `SERVER_PORT` is provided.
- Validate fallback behavior when only `PORT` is set.
- Validate default `5010` when neither env var is set.

### Task 2: Verify no additional runtime-critical hard-coded MCP URLs remain

Why:

- Need to ensure runtime paths use resolved server port everywhere relevant.

Changes:

1. Search for hard-coded MCP/server URL literals in server runtime paths.
2. For runtime code paths (not docs/test fixtures), replace hard-coded `5010` usage with `resolveServerPort()` or clearly scoped constants.
3. Leave explicit test fixture literals unchanged unless they are now incorrect for test intent.

### Task 3: Documentation alignment

Why:

- Ensure docs reflect `SERVER_PORT` as canonical and `PORT` as compatibility fallback.

Changes:

1. `README.md`

- Confirm env section states:
  - canonical `SERVER_PORT`
  - legacy `PORT` fallback support
  - examples use `SERVER_PORT`

2. `design.md`

- Confirm server runtime port section reflects actual precedence and behavior.

3. `projectStructure.md`

- Ensure new/updated config helper references are still accurate if any test files are added.

## Validation Plan (Safe With Active compose:local)

### A) Fast workspace checks

Run from `/home/d_a_s/code/codeInfo2`:

1. `npm run build:all`
2. `npm run lint --workspaces`
3. `npm run format:check --workspaces`
4. `npm run test --workspace client -- --runInBand --silent`
5. `npm run test --workspace server`

Notes:

- If server tests fail on known pre-existing assertions unrelated to this change, capture exact failures and classify as pre-existing vs introduced.

### B) Validate active local stack without lifecycle commands

1. `docker exec codeinfo2-server-local env | rg '^(SERVER_PORT|PORT)='`
2. `docker exec codeinfo2-server-local sh -lc 'ss -ltnp | rg 5010'`
3. `curl -sf http://host.docker.internal:5510/health`

Purpose:

- Confirm live local stack still works and environment values are coherent.

### C) Disposable default stack runtime validation (safe to start/stop)

1. `npm run compose:build`
2. `npm run compose:up`
3. Runtime checks against default stack:

- `curl -sf http://host.docker.internal:5010/health`
- `docker exec codeinfo2-server env | rg '^(SERVER_PORT|PORT)='`

4. `npm run compose:down`

### D) Full e2e validation on isolated e2e stack

1. `npm run e2e`

Purpose:

- End-to-end confidence with separate project/network/containers.

## Commit Strategy

- Commit 1: codex config runtime-port seeding + tests.
- Commit 2: any remaining runtime URL hardening found by search.
- Commit 3: docs alignment updates.

Commit format requirement:

- Prefix: `DEV-000001 - `
- Body: 4–5 sentences describing what changed and why.

## Done Criteria

- No new hard-coded runtime MCP/server URL assumptions that force `5010`.
- Seeding/runtime behavior follows `SERVER_PORT` canonical precedence.
- `compose:local` remains untouched throughout.
- Disposable stack + e2e validations complete.
- Changes are committed locally (no push until explicitly requested).
