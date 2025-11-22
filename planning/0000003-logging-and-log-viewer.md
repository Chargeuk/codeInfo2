# Story 0000003 – Client/Server Logging & In-App Log Viewer

## Description

Introduce structured logging across the monorepo so both the server and client emit consistent log entries, client logs are forwarded to the server automatically, and a new GUI page surfaces recent logs with filtering and refresh controls. Today we rely on console output only; after this story we want operators to see server and client activity (including errors) in one place from the UI, with sensible defaults for levels, retention, and privacy-safe metadata.

### Acceptance Criteria

- Server uses a structured logger with levels (error, warn, info, debug), timestamps, component/source, request correlation id, and optional metadata; log level configurable via env and defaults to `info`.
- Server exposes `POST /logs` to accept client log entries (validated shape, size-limited, level-checked) and persists them alongside server logs; rejects oversize/unknown levels with clear errors and returns 202/400 appropriately.
- Server exposes `GET /logs` for filtered/paginated fetch **and** `GET /logs/stream` (SSE) to push new log entries with heartbeats and last-sequence tracking; both support level/source/time/text filters.
- Server retains logs in a rolling buffer (configurable max entries/MB) and writes a rotating file at `./logs/server.log` (gitignored, host-mounted into the container at `/app/logs` and excluded from Docker build context); retention defaults documented and overridable via env.
- Client includes a logging utility that wraps console/error boundary/unhandled rejection hooks, annotates entries with route, user agent, and correlation id, and automatically forwards logs to the server endpoint with retry/backoff; forwarding can be disabled via env/config.
- New “Logs” page in the client nav shows combined logs from the server API with level chips, timestamps, source, and message/context; supports level + text filters, manual refresh, auto-refresh toggle, loading/empty/error states, and no direct browser access to server files.
- Tests cover server log DTO validation, ingestion/retrieval endpoints (happy/error/limit cases), client logging utility + transport, Logs page rendering/filtering, and an e2e flow showing a client log appearing in the viewer via the server.
- Docs (README, design.md, projectStructure.md, planning notes) describe logging architecture, env vars, API shapes, UI behaviour, retention defaults, and how to disable/limit client forwarding; lint/build/test scripts remain green.
- Security/PII guardrails: sensitive keys/headers/body fragments are redacted before persistence/streaming; payload size limits and origin checks applied to `POST /logs`; CORS behaviour unchanged from existing server defaults.

### Out Of Scope

- Shipping logs to external providers (ELK/OpenSearch/Datadog/Sentry/etc.) beyond optional file output.
- Authentication/authorization for viewing logs (assume current unauthenticated environment); no RBAC or multi-tenant isolation.
- WebSocket streaming; SSE is the real-time path for this story. No historical log archival beyond the configured rolling buffer/rotation.
- Tracing/metrics integration (OpenTelemetry) beyond basic correlation/request ids.

### Questions

- None (defaults above cover required decisions; update if stakeholders change retention, privacy, or auth expectations).

## Implementation Plan Instructions

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

### 1. Logging Architecture & Shared Schema

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Define the logging approach, shared DTOs, env switches, and dependencies so server and client use the same schema and conventions before wiring endpoints/UI.

#### Documentation Locations

- Existing design.md and projectStructure.md for current patterns.
- Common package structure (`common/src`) for shared types.
- Env guidance in root README and workspace `.env` files.
- Pino docs via Context7 `/pinojs/pino`; pino-http (https://github.com/pinojs/pino-http); pino-roll (https://github.com/mcollina/pino-roll).

#### Decisions (locked in)

- Server logger: **pino** for structured JSON, speed, built-in redaction/serializers, and TS support.
- Client logger: lightweight TypeScript utility (not pino-browser) that mirrors `LogEntry`, tees to `console` and `POST /logs`, with batching/backoff and env toggle to disable forwarding.
- File output: primary log destination remains stdout for container-friendly 12-factor logging; additionally write a rotating file to `./logs/server.log` (gitignored, bind-mounted to `/app/logs` in docker-compose and excluded via .dockerignore) for local durability/inspection.

#### Subtasks

1. [ ] Install server logging deps: run `npm install pino pino-http pino-roll --workspace server`. Create `server/src/logger.ts` exporting `baseLogger` (pino with env level, redaction stub, destinations stdout + rotating file `./logs/server.log` via pino-roll, ensure dir exists) and `createRequestLogger()` (wraps pino-http, binds correlation/request id). Update `server/src/index.ts` to use `createRequestLogger` (no functional changes yet).
2. [ ] Create client logging skeleton files: `client/src/logging/logger.ts` (builds LogEntry, tees to console), `client/src/logging/transport.ts` (queue + no-op forwarder stub), and `client/src/logging/index.ts` (exports). Do not enable network sends yet; guard with env flag placeholder.
3. [ ] Define shared `LogEntry` DTO in `common/src/logging.ts` (level, message, timestamp, source, context, requestId/correlationId, userAgent, url/route, tags, sequence?). Add validation helpers and export via `common/src/index.ts`.
4. [ ] Add env variables with defaults: `server/.env` add `LOG_LEVEL=info`, `LOG_BUFFER_MAX=5000`, `LOG_MAX_CLIENT_BYTES=32768`, `LOG_FILE_PATH=./logs/server.log`, `LOG_FILE_ROTATE=true`; `client/.env` add `VITE_LOG_LEVEL=info`, `VITE_LOG_FORWARD_ENABLED=true`, `VITE_LOG_MAX_BYTES=32768`, `VITE_LOG_STREAM_ENABLED=true`. Mention overrides in `.env.local` samples (no secrets). Document the exact keys in README.
5. [ ] Update design.md: add shared logging schema overview, new files (`server/src/logger.ts`, `client/src/logging/*`, `common/src/logging.ts`), and env knobs summary.
6. [ ] Update projectStructure.md: list new files/dirs (`server/src/logger.ts`, `server/src/logStore.ts`, `server/src/routes/logs.ts`, `client/src/logging/*`, `common/src/logging.ts`), and note `logs/` directory.
7. [ ] Add a short Logging overview line to README (pointer to upcoming detailed section in Task 5).
8. [ ] Add `logs/` to root `.gitignore` and `server/.dockerignore`; note in plan to mount `./logs:/app/logs` in compose (actual compose edit in Task 5). Run repo-wide lint/format checks after schema changes.

#### Testing

1. [ ] `npm run lint --workspaces`
2. [ ] `npm run format:check --workspaces`
3. [ ] `npm run build:all`
4. [ ] `npm run compose:build`
5. [ ] `npm run compose:up` (confirm stack starts)
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 2. Server Logging Infrastructure & Storage

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Build the server-side logging plumbing: logger wiring, rolling in-memory store, file rotation hook, env defaults, and repository/docker ignores for the logs directory.

#### Documentation Locations

- Express routing/middleware patterns (Context7 `/expressjs/express`).
- Existing server entry/routes (`server/src/index.ts`, `server/src/routes`).
- Common LogEntry DTO from Task 1.
- Pino docs via Context7 `/pinojs/pino`; pino-http (https://github.com/pinojs/pino-http); pino-roll (https://github.com/mcollina/pino-roll).

#### Subtasks

1. [ ] Wire `server/src/logger.ts` into `server/src/index.ts` so request logging (pino-http) runs for all routes with correlation id and timing; keep stdout + file outputs (`./logs/server.log`).
2. [ ] Implement `server/src/logStore.ts`: in-memory rolling store with configurable max entries/bytes, sequence ids, append/query with filters (level/source/time/text), trims oldest; include hook to also write to the pino file destination when enabled.
3. [ ] Wire env/config defaults in code: read `LOG_LEVEL`, `LOG_BUFFER_MAX`, `LOG_MAX_CLIENT_BYTES`, `LOG_FILE_PATH` (default `./logs/server.log`), `LOG_FILE_ROTATE`. Ensure directory creation as needed.
4. [ ] Add `logs/` to root `.gitignore` and `server/.dockerignore`; ensure note to mount `./logs:/app/logs` in compose (compose edit happens later). Add a brief note in design.md about storage + rotation defaults.
5. [ ] Update projectStructure.md: add `server/src/logStore.ts`, `server/src/logger.ts`, and note `logs/` dir.
6. [ ] Run server commands: `npm run lint --workspace server`, `npm run format:check --workspaces`, `npm run build --workspace server`, `npm run compose:build`.

#### Testing

1. [ ] `npm run lint --workspace server`
2. [ ] `npm run format:check --workspaces`
3. [ ] `npm run build --workspace server`
4. [ ] `npm run compose:build`
5. [ ] `npm run compose:up` (confirm stack starts)
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 3. Server Log APIs & SSE

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose log ingestion and retrieval: `POST /logs`, `GET /logs` (history), and `GET /logs/stream` (SSE live tail) with validation, redaction, and tests.

#### Documentation Locations

- Express routing/middleware patterns (Context7 `/expressjs/express`).
- Existing server entry/routes (`server/src/index.ts`, `server/src/routes`).
- Common LogEntry DTO from Tasks 1–2.
- Cucumber test setup under `server/src/test`; Cucumber guides https://cucumber.io/docs/guides/.
- SSE framing: MDN Server-Sent Events / EventSource API (https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) and WHATWG HTML Living Standard – Server-sent events section (https://html.spec.whatwg.org/multipage/server-sent-events.html).

#### Subtasks

1. [ ] Add routes in `server/src/routes/logs.ts`: `POST /logs` validate LogEntry (size/level/source), redact sensitive fields, add requestId, append to store, return 202/400.
2. [ ] In the same router, implement `GET /logs` (filtered/paginated, returns {items, lastSequence, hasMore}) and `GET /logs/stream` (SSE: headers, heartbeat `:\n\n`, catch-up since lastSequence, push new entries; filters via query). Register router in `server/src/index.ts` under `/logs`.
3. [ ] Update README (server section): add `/logs` and `/logs/stream` API examples, env keys, log file path/rotation note.
4. [ ] Update design.md: document server logging flow (ingest → store → GET/SSE), redaction/retention notes.
5. [ ] Update projectStructure.md: ensure `server/src/routes/logs.ts` and related files are listed.
6. [ ] Add Cucumber coverage: feature `server/src/test/features/logs.feature` and steps `server/src/test/steps/logs.steps.ts` for valid ingestion, oversize/invalid level rejection, filtering by level/time, pagination cap, redaction check, SSE heartbeat/basic stream (use supertest + custom SSE parser). Keep existing tests passing.
7. [ ] Run server commands: `npm run lint --workspace server`, `npm run format:check --workspaces`, `npm run test --workspace server`, `npm run build --workspace server`.

#### Testing

1. [ ] `npm run lint --workspace server`
2. [ ] `npm run format:check --workspaces`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run build --workspace server`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up` (confirm stack starts)
7. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 4. Client Logging Capture & Transport

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add a client logging utility that standardizes log creation, hooks into errors/warnings, and forwards entries to the server with resiliency and opt-out controls.

#### Documentation Locations

- Client app shell and hooks (`client/src`), especially router/pages layout.
- Vite env handling (https://vitejs.dev/guide/env-and-mode.html) and existing `.env` defaults.
- Testing: Jest docs via Context7 `/jestjs/jest`; Testing Library patterns already in `client/src/test`.
- React fundamentals: https://react.dev/learn (component patterns, effects, error handling).
- React Router docs via Context7 `/remix-run/react-router` (routing/error boundaries where touched).

#### Subtasks

1. [ ] Implement `client/src/logging/logger.ts`: formats LogEntry with route/userAgent/correlationId; wraps console.warn/error; hooks `window.onerror`/`unhandledrejection` with throttle to avoid loops; exports `createLogger` and `installGlobalErrorHooks`.
2. [ ] Implement `client/src/logging/transport.ts`: queue + batching/backoff + offline guard sending to `POST /logs`; respects `VITE_LOG_FORWARD_ENABLED` and `VITE_LOG_MAX_BYTES`; no network sends when `import.meta.env.MODE === 'test'`. Export a `sendLogs` function used by logger.
3. [ ] Wire logger usage: integrate into HomePage fetch errors, LM Studio actions, router error boundary, and API hook(s). Add opt-in sample emission toggle if needed. Ensure messages redact obvious PII keys.
4. [ ] Update README (client section): add logging env keys (`VITE_LOG_LEVEL`, `VITE_LOG_FORWARD_ENABLED`, `VITE_LOG_MAX_BYTES`, `VITE_LOG_STREAM_ENABLED`), forwarding behaviour, and how to disable in `.env.local`.
5. [ ] Update design.md: describe client logging behaviour (console tee, forwarding, error hooks, env toggles) and privacy notes.
6. [ ] Update projectStructure.md: list `client/src/logging/*` and the new test files.
7. [ ] Add Jest/Testing Library tests: `client/src/test/logging/logger.test.ts`, `client/src/test/logging/transport.test.ts`, `client/src/test/logsPage.test.tsx` (smoke that triggers a forwarded log with mocked fetch). Ensure projectStructure lists these files.
8. [ ] Run client commands: `npm run lint --workspace client`, `npm run format:check --workspaces`, `npm run test --workspace client`, `npm run build --workspace client`, `npm run compose:build`.

#### Testing

1. [ ] `npm run lint --workspace client`

2. [ ] `npm run format:check --workspaces`
3. [ ] `npm run test --workspace client`
4. [ ] `npm run build --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up` (confirm stack starts)
7. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 5. Logs Page UI & End-to-End Visibility

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Create a new “Logs” route in the client that consumes the server log API, surfaces filters/refresh, and demonstrates a full client log flowing through to the viewer; ensure responsive, accessible layout.

#### Documentation Locations

- Existing router/NavBar components (`client/src/routes/router.tsx`, `client/src/components/NavBar.tsx`).
- MUI components for tables/chips/progress (consult via MUI MCP tool).
- Common LogEntry DTO and server log API contract from Tasks 1–3.
- SSE client usage: MDN EventSource (https://developer.mozilla.org/en-US/docs/Web/API/EventSource) for connection/retry/Last-Event-ID patterns.
- Testing: Jest docs via Context7 `/jestjs/jest` for hook/UI tests; Playwright docs via Context7 `/microsoft/playwright` for e2e.
- Playwright e2e setup under `e2e/`.
- React fundamentals: https://react.dev/learn (components/state/effects).
- React Router docs via Context7 `/remix-run/react-router` (NavBar routing, route setup, loaders/error boundaries if needed).

#### Subtasks

1. [ ] Add “Logs” route + NavBar tab wired to new page; ensure routing works in dev/preview/docker.
2. [ ] Build data hook to fetch logs via `GET /logs` and (when supported) subscribe to `GET /logs/stream` SSE for live updates with reconnection/backoff; keep filters (level multi-select, source, text search, since/until) and allow disabling live updates.
3. [ ] Implement UI (table on md+, stacked cards on sm) showing timestamp, level chip, source, message, context snippet, and correlation id; include controls for filters, refresh, auto-refresh toggle, and max rows indicator.
4. [ ] Wire client logging demo: on page load or button click, emit a sample client log and verify it appears after refresh/stream to prove end-to-end flow (behind a toggle to avoid spam).
5. [ ] Update README (client UI section) with Logs page usage (filters, stream toggle, refresh), and design.md with UI behaviours/states.
6. [ ] Update projectStructure.md to list new page/hook/test files and `e2e/logs.spec.ts`.
7. [ ] Add tests: Jest for hook/UI (`client/src/test/logsPage.test.tsx` extended for filters/refresh/SSE) and Playwright `e2e/logs.spec.ts` that triggers a client log and observes it via GET/stream.
8. [ ] Run commands in order: `npm run lint --workspace client`, `npm run format:check --workspaces`, `npm run test --workspace client`, `npm run build --workspace client`, `npm run compose:build`, `npm run compose:up`, `npm run e2e:test` (with new logs spec), `npm run compose:down`. Ensure docker compose still works.

#### Testing

1. [ ] `npm run lint --workspace client`
2. [ ] `npm run format:check --workspaces`
3. [ ] `npm run test --workspace client`
4. [ ] `npm run build --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up` (confirm stack starts)
7. [ ] `npm run e2e:test` (with stack up; expect new logs spec)
8. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 6. Acceptance Review & Release Readiness

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Verify all acceptance criteria, harden docs, and ensure clean builds/tests across workspaces and Docker, including screenshots/evidence where required.

#### Documentation Locations

- README.md, design.md, projectStructure.md, planning docs.
- Docker/Compose scripts and env files.
- Playwright docs (Context7 `/microsoft/playwright`), Docker docs (Context7 `/docker/docs`), Husky (Context7 `/typicode/husky`), Jest (Context7 `/jestjs/jest`), Mermaid (Context7 `/mermaid-js/mermaid`).

#### Subtasks

1. [ ] Build the server (`npm run build --workspace server`)
2. [ ] Build the client (`npm run build --workspace client`)
3. [ ] Perform a clean docker build (`npm run compose:build` after ensuring logs folder exists); bring stack up `npm run compose:up` (confirm) and down `npm run compose:down` after testing.
4. [ ] README.md: add logging usage (server/client), API examples for `/logs` and `/logs/stream`, env vars, log file location/rotation, compose volume mount `./logs:/app/logs`, and new commands.
5. [ ] design.md: add logging architecture diagram/flow (ingest -> store -> GET/SSE -> UI), GUI behaviour, redaction/retention notes.
6. [ ] projectStructure.md: list new files (server logger/logStore/routes, client logging folder, e2e/logs.spec.ts) and note `logs/` dir.
7. [ ] Git ignores + compose: add `logs/` to root `.gitignore` and `server/.dockerignore`; update `docker-compose.yml` with volume `./logs:/app/logs`; ensure `.env.local` guidance unchanged.
8. [ ] Create PR-ready summary of all changes (server/client logging, UI, tests, env) and include log viewer screenshots in `test-results/screenshots/0000003-5-*.png`.
9. [ ] Run repo-wide lint/format checks: `npm run lint --workspaces` then `npm run format:check --workspaces`; fix before final verification.

#### Testing

1. [ ] `npm run compose:build`
2. [ ] `npm run compose:up` (confirm stack starts)
3. [ ] run the client jest tests (`npm run test --workspace client`)
4. [ ] run the server cucumber tests (`npm run test --workspace server`)
5. [ ] run the e2e tests (`npm run e2e:test` with stack up; includes new logs spec)
6. [ ] use the playwright mcp tool to manually check the application, saving screenshots to ./test-results/screenshots/ (name `0000003-5-<name>.png`)
7. [ ] `npm run compose:down`

#### Implementation notes

- 

---
