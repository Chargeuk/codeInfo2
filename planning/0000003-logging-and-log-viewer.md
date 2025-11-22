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

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __done__
- Git Commits: 74af58b

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

1. [x] Install server logging deps with a single command: `npm install pino pino-http pino-roll --workspace server`. Create `server/src/logger.ts` using the starter below (safe to copy/paste and tweak levels/paths):
   ```ts
   import fs from 'node:fs';
   import path from 'node:path';
   import pino from 'pino';
   import pinoHttp from 'pino-http';
   import pinoRoll from 'pino-roll';

   const logFilePath = process.env.LOG_FILE_PATH || './logs/server.log';
   const logDir = path.dirname(logFilePath);
   fs.mkdirSync(logDir, { recursive: true });

   const destination = process.env.LOG_FILE_ROTATE === 'false'
     ? pino.destination(logFilePath)
     : pinoRoll({ file: logFilePath, frequency: 'daily', mkdir: true });

   export const baseLogger = pino({ level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.authorization', 'body.password'] }, destination);

   export function createRequestLogger() {
     return pinoHttp({ logger: baseLogger, genReqId: () => crypto.randomUUID?.() || Date.now().toString() });
   }
   ```
   Update `server/src/index.ts` to `app.use(createRequestLogger());` right after env/config setup so every route logs; no other behaviour changes yet.
2. [x] Create client logging skeleton files with concrete stubs:
   - `client/src/logging/logger.ts`:
     ```ts
     import { LogEntry } from '@codeinfo2/common';
     import { sendLogs } from './transport';

     export function createLogger(source = 'client'): (entry: Omit<LogEntry, 'timestamp' | 'source'>) => void {
       return (entry) => {
         const full: LogEntry = { timestamp: new Date().toISOString(), source, ...entry };
         // tee to console for dev ergonomics
         // eslint-disable-next-line no-console
         console[entry.level === 'error' ? 'error' : 'log'](full);
         sendLogs([full]);
       };
     }
     ```
   - `client/src/logging/transport.ts` (no network yet, just queue placeholder):
     ```ts
     import { LogEntry } from '@codeinfo2/common';
     const queue: LogEntry[] = [];
     export function sendLogs(entries: LogEntry[]) {
       if (import.meta.env.VITE_LOG_FORWARD_ENABLED === 'false') return;
       queue.push(...entries);
       // network POST /logs will be added in Task 4
     }
     export function getQueuedLogs() { return queue; }
     ```
   - `client/src/logging/index.ts` re-export the above. Keep forwarding disabled in tests via the env flag.
3. [x] Define shared `LogEntry` DTO in `common/src/logging.ts` (copy/paste starter):
   ```ts
   export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
   export type LogEntry = {
     level: LogLevel;
     message: string;
     timestamp: string; // ISO string
     source: 'server' | 'client';
     requestId?: string;
     correlationId?: string;
     userAgent?: string;
     url?: string;
     route?: string;
     tags?: string[];
     context?: Record<string, unknown>;
     sequence?: number;
   };

   export function isLogEntry(value: unknown): value is LogEntry {
     const v = value as Partial<LogEntry>;
     return !!v && ['error','warn','info','debug'].includes(v.level as string) && typeof v.message === 'string';
   }
   ```
   Export from `common/src/index.ts` and add a tiny unit test later (Task 4) to guard the validator.
4. [x] Add env variables with explicit text blocks (append verbatim):
   - `server/.env`
     ```
     LOG_LEVEL=info
     LOG_BUFFER_MAX=5000
     LOG_MAX_CLIENT_BYTES=32768
     LOG_FILE_PATH=./logs/server.log
     LOG_FILE_ROTATE=true
     ```
   - `client/.env`
     ```
     VITE_LOG_LEVEL=info
     VITE_LOG_FORWARD_ENABLED=true
     VITE_LOG_MAX_BYTES=32768
     VITE_LOG_STREAM_ENABLED=true
     ```
   Mirror these as commented examples in `server/.env.local` and `client/.env.local` so juniors know where to override.
5. [x] Update design.md: add a “Logging schema (shared)” subsection describing `LogEntry`, env knobs, and the new shared files (`server/src/logger.ts`, `client/src/logging/*`, `common/src/logging.ts`). Include a one-sentence privacy note about redacting auth headers/password fields. Add a mermaid snippet showing client/server/common log flow; use Context7 `/mermaid-js/mermaid` if needed.
6. [x] Update projectStructure.md: list new files/dirs (`server/src/logger.ts`, `server/src/logStore.ts`, `server/src/routes/logs.ts`, `client/src/logging/*`, `common/src/logging.ts`) and note `logs/` directory under root.
7. [x] Update README: add a one-line Logging overview under Server/Client intro pointing to the detailed section to be written in Task 6.
8. [x] Add `logs/` to root `.gitignore` and `server/.dockerignore`; note in plan to mount `./logs:/app/logs` in compose (actual compose edit in Task 6). After finishing the above, run repo-wide checks in this order and expect **all pass**: `npm run lint --workspaces` (no warnings), `npm run format:check --workspaces` (“checked … files”), `npm run build:all` (succeeds), `npm run compose:build` then `npm run compose:up` (client 5001 + server 5010 healthy), `npm run compose:down`.

#### Testing

1. [x] `npm run lint --workspaces`
2. [x] `npm run format:check --workspaces`
3. [x] `npm run build:all`
4. [x] `npm run compose:build`
5. [x] `npm run compose:up` (confirm stack starts)
6. [x] `npm run compose:down`

#### Implementation notes

- Remember to mount `./logs:/app/logs` in docker-compose during Task 6.

---

### 2. Server Logging Infrastructure & Storage

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __in_progress__
- Git Commits: __to_do__

#### Overview

Build the server-side logging plumbing: logger wiring, rolling in-memory store, file rotation hook, env defaults, and repository/docker ignores for the logs directory.

#### Documentation Locations

- Express routing/middleware patterns (Context7 `/expressjs/express`).
- Existing server entry/routes (`server/src/index.ts`, `server/src/routes`).
- Common LogEntry DTO from Task 1.
- Pino docs via Context7 `/pinojs/pino`; pino-http (https://github.com/pinojs/pino-http); pino-roll (https://github.com/mcollina/pino-roll).

#### Subtasks

1. [x] Update `server/src/index.ts`: import `createRequestLogger` from `server/src/logger.ts` and add `app.use(createRequestLogger());` immediately after CORS/env setup. Store the generated `req.id` on `res.locals.requestId` so downstream routes can reuse it.
2. [x] Implement `server/src/logStore.ts` using this scaffold (trim/filters included so juniors can fill blanks):
   ```ts
   import { LogEntry, LogLevel } from '@codeinfo2/common';

   type Filters = { level?: LogLevel[]; source?: string[]; text?: string; since?: number; until?: number };

   const maxEntries = Number(process.env.LOG_BUFFER_MAX || 5000);
   const store: LogEntry[] = [];
   let sequence = 0;

   export function append(entry: LogEntry): LogEntry {
     const enriched = { ...entry, sequence: ++sequence };
     store.push(enriched);
     if (store.length > maxEntries) store.shift();
     return enriched;
   }

   export function query(filters: Filters, limit = 200) {
     return store
       .filter((e) => !filters.level || filters.level.includes(e.level))
       .filter((e) => !filters.source || filters.source.includes(e.source))
       .filter((e) => !filters.text || `${e.message} ${JSON.stringify(e.context ?? {})}`.toLowerCase().includes(filters.text.toLowerCase()))
       .filter((e) => !filters.since || new Date(e.timestamp).getTime() >= filters.since)
       .filter((e) => !filters.until || new Date(e.timestamp).getTime() <= filters.until)
       .slice(-limit);
   }

   export function lastSequence() { return sequence; }
   ```
   Leave hooks for file writing; add a TODO comment to forward to `baseLogger` file destination when wired.
3. [x] Wire env/config defaults in code: read `LOG_LEVEL`, `LOG_BUFFER_MAX`, `LOG_MAX_CLIENT_BYTES`, `LOG_FILE_PATH` (default `./logs/server.log`), `LOG_FILE_ROTATE`; ensure `./logs` exists. Add a helper `resolveLogConfig()` returning parsed numbers so juniors don’t parse envs ad hoc.
4. [x] Add `logs/` to root `.gitignore` and `server/.dockerignore`; add a “Storage/Retention” note in design.md covering buffer size, rotation, and compose mount (`./logs:/app/logs`) including the exact volume line to paste later: `- ./logs:/app/logs`.
5. [x] Update projectStructure.md: add `server/src/logStore.ts`, `server/src/logger.ts`, and note `logs/` dir.
6. [x] Run server commands in order, checking for green exit codes: `npm run lint --workspace server`, `npm run format:check --workspaces`, `npm run test --workspace server` (Cucumber), `npm run build --workspace server`, `npm run compose:build`, `npm run compose:up` (verify `/health` 200), `npm run compose:down`.

#### Testing

1. [x] `npm run lint --workspace server`
2. [x] `npm run format:check --workspaces`
3. [x] `npm run build --workspace server`
4. [x] `npm run compose:build`
5. [x] `npm run compose:up` (confirm stack starts)
6. [x] `npm run compose:down`

#### Implementation notes

- Request logging middleware now attaches the generated request id to `res.locals.requestId` so downstream routes can correlate server logs and future log ingestion.
- Implemented `logStore` as an in-memory ring buffer with sequence numbers and filter helpers, trimming by `LOG_BUFFER_MAX` and leaving a TODO hook to forward to the file logger.
- Added `resolveLogConfig()` to centralize env parsing for levels, buffer limits, file path/rotation, and client payload caps; it also creates the log directory before pino destinations are built.
- Documented storage/retention defaults and compose volume guidance in `design.md`, refreshed `projectStructure.md`, and tightened `server/.dockerignore` to exclude `logs/` explicitly.
- Updated server Cucumber scripts to use the ts-node ESM loader so `.js` specifiers resolve against TS sources; reran lint, format, tests, build, and compose cycle with `/health` returning 200.

---

### 3. Server Log APIs & SSE

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

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

1. [ ] Add routes in `server/src/routes/logs.ts` using concrete handlers:
   - `POST /logs` flow: parse body, `if (!isLogEntry(body)) return res.status(400).json({ error: 'invalid log entry' });` enforce `JSON.stringify(body).length <= LOG_MAX_CLIENT_BYTES`; whitelist levels `error|warn|info|debug`; redact `authorization`, `password`, `token` keys from headers/context before storing; attach `requestId` from `res.locals`; call `append` and respond 202 `{ status: 'accepted', sequence }`.
   - Provide example curl in README later:
     ```sh
     curl -X POST http://localhost:5010/logs \
       -H 'content-type: application/json' \
       -d '{"level":"info","message":"hello","timestamp":"2025-01-01T00:00:00.000Z","source":"client"}'
     ```
2. [ ] In the same router, implement `GET /logs` and `GET /logs/stream` with explicit SSE framing:
   - `GET /logs` query params: `level=info,warn`, `source=client,server`, `text=error`, `since=unixMs`, `until=unixMs`, `limit` (cap at 200). Response `{ items, lastSequence, hasMore }` sorted ascending by sequence.
   - `GET /logs/stream`: set headers `text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`; send initial heartbeat `:\n\n`; honor `Last-Event-ID` (or `?sinceSequence=`) to replay missed items via `query`; emit events as:
     ```
     id: <sequence>\n
     data: {"level":"info","message":"..."}\n\n
     ```
     send heartbeat every 15s `:\n\n`; close on `req.on('close')` and remove listeners.
   - Register router in `server/src/index.ts` under `/logs`.
3. [ ] Update README (server section): include request/response samples for `/logs` and `/logs/stream`, list env keys, note log file path/rotation, and mention SSE heartbeat + `Last-Event-ID` usage (`curl -N http://localhost:5010/logs/stream`).
4. [ ] Update design.md: document server logging flow (ingest → logStore → GET/SSE), redaction/retention defaults, SSE behaviours (heartbeat every 15s, replay via Last-Event-ID), and limits (200 items, 32KB payload). Add a mermaid sequence diagram for SSE (client -> server -> stream); use Context7 `/mermaid-js/mermaid` for syntax reference.
5. [ ] Update projectStructure.md: ensure `server/src/routes/logs.ts` and related files are listed.
6. [ ] Add Cucumber coverage with explicit starting points:
   - Feature `server/src/test/features/logs.feature` containing scenarios: valid ingestion → 202; invalid level → 400; oversize payload → 400; GET with `level=error` returns only errors; SSE heartbeat + one event (use mock store inject or append first); redaction hides `password` field.
   - Steps `server/src/test/steps/logs.steps.ts` reuse supertest against app; for SSE parsing, use a simple line buffer helper provided inline (ok to copy from test file header).
7. [ ] Run server commands: `npm run lint --workspace server`, `npm run format:check --workspaces`, `npm run test --workspace server`, `npm run build --workspace server`, `npm run compose:build`, `npm run compose:up` (confirm stack starts), `npm run compose:down`.

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

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

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
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (for any new sequence/flow charts added to design.md).

#### Subtasks

1. [ ] Implement `client/src/logging/logger.ts` using this starter:
   ```ts
   import { LogEntry, LogLevel } from '@codeinfo2/common';
   import { sendLogs } from './transport';

   const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];

   export function createLogger(source = 'client', routeProvider = () => window.location.pathname) {
     return (level: LogLevel, message: string, context: Record<string, unknown> = {}) => {
       if (!levels.includes(level)) level = 'info';
       const entry: LogEntry = {
         level,
         message,
         timestamp: new Date().toISOString(),
         source,
         route: routeProvider(),
         userAgent: navigator.userAgent,
         correlationId: crypto.randomUUID?.(),
         context,
       };
       // console tee for dev
       // eslint-disable-next-line no-console
       console[level === 'error' ? 'error' : 'log'](entry);
       sendLogs([entry]);
     };
   }

   export function installGlobalErrorHooks(log = createLogger('client-global')) {
     let lastError = 0;
     const minGap = 1000;
     window.onerror = (msg, url, line, col, err) => {
       if (Date.now() - lastError < minGap) return;
       lastError = Date.now();
       log('error', 'window.onerror', { msg, url, line, col, error: String(err) });
     };
     window.onunhandledrejection = (event) => {
       if (Date.now() - lastError < minGap) return;
       lastError = Date.now();
       log('error', 'unhandledrejection', { reason: String(event.reason) });
     };
   }
   ```
2. [ ] Implement `client/src/logging/transport.ts` with batching/backoff scaffold (use these exact defaults: `MAX_BATCH = 10`, `BACKOFF = [500, 1000, 2000, 4000]` ms, `VITE_LOG_MAX_BYTES` cap 32768):
   ```ts
   import { LogEntry } from '@codeinfo2/common';

   const queue: LogEntry[] = [];
   const MAX_BATCH = 10;
   const BACKOFF = [500, 1000, 2000, 4000];
   let backoffIndex = 0;
   let inFlight = false;

   export async function flushQueue() {
     if (inFlight || queue.length === 0) return;
     if (import.meta.env.MODE === 'test') { queue.length = 0; return; }
     if (import.meta.env.VITE_LOG_FORWARD_ENABLED === 'false') { queue.length = 0; return; }
     if (!navigator.onLine) return;
     const batch = queue.splice(0, MAX_BATCH);
     inFlight = true;
     try {
       const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/logs`, {
         method: 'POST',
         headers: { 'content-type': 'application/json' },
         body: JSON.stringify(batch),
       });
       if (!res.ok) throw new Error(`status ${res.status}`);
       backoffIndex = 0;
     } catch (err) {
       // put back and retry later
       queue.unshift(...batch);
       const delay = BACKOFF[Math.min(backoffIndex++, BACKOFF.length - 1)];
       setTimeout(flushQueue, delay);
     } finally {
       inFlight = false;
     }
   }

   export function sendLogs(entries: LogEntry[]) {
     const maxBytes = Number(import.meta.env.VITE_LOG_MAX_BYTES || 32768);
     entries.forEach((e) => {
       if (JSON.stringify(e).length <= maxBytes) queue.push(e);
     });
     void flushQueue();
   }

   export function _getQueue() { return queue; } // for tests
   ```
3. [ ] Wire logger usage with concrete hooks:
   - `client/src/main.tsx`: call `installGlobalErrorHooks();` once.
   - `client/src/pages/HomePage.tsx`: in the fetch catch, `logger('error', 'version fetch failed', { error });`.
   - `client/src/pages/LmStudioPage.tsx`: log start/success/failure of status/model refresh; include `baseUrl` in context with obvious secrets removed.
   - `client/src/routes/router.tsx`: in error boundary component, log the error object and route.
   - Add a simple opt-in sample emitter on Logs page later (Task 5) guarded by a toggle `Send sample log`.
4. [ ] Update README (client section) with a small block showing env keys, how to disable forwarding via `.env.local`, and a short example:
   ```env
   VITE_LOG_FORWARD_ENABLED=false
   ```
   Mention that tests force-disable network sends (`MODE === 'test'`).
5. [ ] Update design.md: describe client logging flow (console tee → queue → POST /logs with backoff), env toggles, and privacy note (redact obvious PII in context before logging).
6. [ ] Update projectStructure.md: list `client/src/logging/logger.ts`, `client/src/logging/transport.ts`, `client/src/logging/index.ts`, and new tests under `client/src/test/logging/`.
7. [ ] Add Jest/Testing Library tests with ready-to-use shapes:
   - `client/src/test/logging/logger.test.ts`: mock `sendLogs`, call logger, assert it receives a LogEntry with timestamp/source/route; simulate `window.onerror` and ensure throttling works.
   - `client/src/test/logging/transport.test.ts`: mock `fetch`, push entries, await `flushQueue`, assert POST body length ≤ max bytes, retry/backoff puts entries back when fetch rejects.
   - `client/src/test/logsPage.test.tsx`: render a minimal Logs page stub that calls `createLogger` and ensures sendLogs was invoked (mocked) when a button is clicked.
   Remember to add any new test helpers to projectStructure.
8. [ ] Run client commands in order (stop if any fail): `npm run lint --workspace client`, `npm run format:check --workspaces`, `npm run test --workspace client`, `npm run build --workspace client`, `npm run compose:build`, `npm run compose:up`, `npm run compose:down`.

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

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

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
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (for Logs UI + stream flow diagrams in design.md).

#### Subtasks

1. [ ] Add “Logs” route + NavBar tab in `client/src/routes/router.tsx` and `client/src/components/NavBar.tsx`; copy an existing tab pattern and point to `/logs`. Verify dev server shows the tab.
2. [ ] Build data hook `client/src/hooks/useLogs.ts` using this scaffold; keep defaults `filters.level=[]`, `filters.source=[]`, `filters.text=''`, `limit` implicit at 200 via the server, and `live=true` by default:
   ```ts
   import { useEffect, useMemo, useRef, useState } from 'react';
   import { LogEntry } from '@codeinfo2/common';

   type Filters = { level: string[]; source: string[]; text: string; since?: number; until?: number };

   export function useLogs(filters: Filters, live = true) {
     const [logs, setLogs] = useState<LogEntry[]>([]);
     const [loading, setLoading] = useState(false);
     const [error, setError] = useState<string | null>(null);
     const lastSequence = useRef<number | undefined>(undefined);

     const query = useMemo(() => {
       const params = new URLSearchParams();
       if (filters.level.length) params.set('level', filters.level.join(','));
       if (filters.source.length) params.set('source', filters.source.join(','));
       if (filters.text) params.set('text', filters.text);
       if (filters.since) params.set('since', String(filters.since));
       if (filters.until) params.set('until', String(filters.until));
       if (lastSequence.current) params.set('sinceSequence', String(lastSequence.current));
       return params.toString();
     }, [filters.level, filters.source, filters.text, filters.since, filters.until]);

     useEffect(() => {
       let cancelled = false;
       async function load() {
         setLoading(true); setError(null);
         try {
           const res = await fetch(`/logs?${query}`);
           if (!res.ok) throw new Error(`status ${res.status}`);
           const body = await res.json();
           if (cancelled) return;
           setLogs(body.items);
           lastSequence.current = body.lastSequence;
         } catch (e) {
           if (!cancelled) setError(String(e));
         } finally {
           if (!cancelled) setLoading(false);
         }
       }
       void load();
       return () => { cancelled = true; };
     }, [query]);

     useEffect(() => {
       if (!live) return;
       const es = new EventSource(`/logs/stream?${query}`);
       es.onmessage = (evt) => {
         const parsed = JSON.parse(evt.data) as LogEntry;
         lastSequence.current = parsed.sequence ?? lastSequence.current;
         setLogs((prev) => [...prev.slice(-199), parsed]);
       };
       es.onerror = () => { es.close(); };
       return () => es.close();
     }, [query, live]);

     return { logs, loading, error, refreshQuery: () => setLogs([]) };
   }
   ```
3. [ ] Implement UI in `client/src/pages/LogsPage.tsx` with a ready layout skeleton (replace with MUI components):
   ```tsx
   import { Chip, Container, Stack, TextField, Switch, FormControlLabel, Button, Table, TableHead, TableRow, TableCell, TableBody, CircularProgress } from '@mui/material';
   import { useState } from 'react';
   import { useLogs } from '../hooks/useLogs';

   export default function LogsPage() {
     const [text, setText] = useState('');
     const [live, setLive] = useState(true);
     const { logs, loading, error } = useLogs({ level: [], source: [], text }, live);

     return (
       <Container maxWidth="lg">
         <Stack direction="row" spacing={2} alignItems="center" mb={2}>
           <TextField label="Search text" value={text} onChange={(e) => setText(e.target.value)} size="small" />
           <FormControlLabel control={<Switch checked={live} onChange={(e) => setLive(e.target.checked)} />} label="Live" />
           <Button onClick={() => window.location.reload()}>Refresh</Button>
         </Stack>
         {loading && <CircularProgress />} {error && <div role="alert">{error}</div>}
         <Table size="small">
           <TableHead>
             <TableRow>
               <TableCell>Time</TableCell><TableCell>Level</TableCell><TableCell>Source</TableCell><TableCell>Message</TableCell><TableCell>Context</TableCell>
             </TableRow>
           </TableHead>
           <TableBody>
             {logs.map((log) => (
               <TableRow key={log.sequence ?? log.timestamp}>
                 <TableCell>{log.timestamp}</TableCell>
                 <TableCell><Chip label={log.level} color={log.level === 'error' ? 'error' : log.level === 'warn' ? 'warning' : 'primary'} /></TableCell>
                 <TableCell>{log.source}</TableCell>
                 <TableCell>{log.message}</TableCell>
                 <TableCell>{log.context ? JSON.stringify(log.context) : ''}</TableCell>
               </TableRow>
             ))}
           </TableBody>
         </Table>
       </Container>
     );
   }
   ```
   On small screens, switch to stacked cards (can reuse MUI `Card` with `Stack` in sm breakpoint).
4. [ ] Wire client logging demo: add a `Send sample log` button on Logs page that calls `createLogger('client-demo')('info','sample log',{ route: '/logs' })`; ensure it appears after refresh/stream.
5. [ ] Update README (client UI section) with usage bullets: filters (levels/text), live toggle, refresh button, sample log button, and mention SSE auto-reconnect.
6. [ ] Update design.md “Client UI” with states: loading spinner, empty state (“No logs yet”), error banner, live on/off behaviour, and add a small mermaid sketch of the Logs page data flow (filters → fetch → table/SSE) using Context7 `/mermaid-js/mermaid` for syntax reference.
7. [ ] Update projectStructure.md to list new page `client/src/pages/LogsPage.tsx`, hook `client/src/hooks/useLogs.ts`, tests, and `e2e/logs.spec.ts`.
8. [ ] Add tests with concrete guidance:
   - Jest `client/src/test/logsPage.test.tsx`: mock `fetch` to return two logs; render page; expect rows; toggle live off and ensure EventSource is not constructed (mock it via `global.EventSource = jest.fn()`).
   - Hook test: mock fetch + EventSource emitting one message to ensure state updates.
   - Playwright `e2e/logs.spec.ts`: start stack, click Logs tab, click “Send sample log”, wait for row containing “sample log”, assert level chip text matches.
9. [ ] Run commands in order: `npm run lint --workspace client`, `npm run format:check --workspaces`, `npm run test --workspace client`, `npm run build --workspace client`, `npm run compose:build`, `npm run compose:up`, `npm run e2e:test`, `npm run compose:down`.

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

_(Reminder: tick each subtask/test checkbox as soon as you complete it before moving on.)_

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Verify all acceptance criteria, harden docs, and ensure clean builds/tests across workspaces and Docker, including screenshots/evidence where required.

#### Documentation Locations

- README.md, design.md, projectStructure.md, planning docs.
- Docker/Compose scripts and env files.
- Playwright docs (Context7 `/microsoft/playwright`), Docker docs (Context7 `/docker/docs`), Husky (Context7 `/typicode/husky`), Jest (Context7 `/jestjs/jest`), Mermaid (Context7 `/mermaid-js/mermaid`).

#### Subtasks

1. [ ] Build the server (`npm run build --workspace server`). If it fails, capture error in Implementation notes before fixing.
2. [ ] Build the client (`npm run build --workspace client`).
3. [ ] Perform a clean docker build (`npm run compose:build`) after ensuring a local `./logs` folder exists. Bring stack up `npm run compose:up`, confirm client at http://localhost:5001 and server `/health` 200, then `npm run compose:down`.
4. [ ] README.md: add a “Logging” section with:
   - `/logs` POST/GET examples (curl) and `/logs/stream` SSE example (`curl -N http://localhost:5010/logs/stream`).
   - Env keys for both apps, log file path/rotation, compose volume line `- ./logs:/app/logs`.
   - How to disable client forwarding (`VITE_LOG_FORWARD_ENABLED=false`).
5. [ ] design.md: include a mermaid sequence (ingest -> logStore -> GET/SSE -> UI), describe GUI states, redaction rules, retention defaults, SSE heartbeat/replay. Use Context7 `/mermaid-js/mermaid` as reference for syntax while updating diagrams.
6. [ ] projectStructure.md: list all new files (server logger/logStore/routes, client logging folder, Logs page/hook, e2e/logs.spec.ts) and note `logs/` dir.
7. [ ] Git ignores + compose: ensure `logs/` present in root `.gitignore` and `server/.dockerignore`; update `docker-compose.yml` with `- ./logs:/app/logs`; leave `.env.local` guidance unchanged.
8. [ ] Create PR-ready summary covering server logging, client logging, UI, tests, env changes; save 2–3 screenshots of the Logs page to `test-results/screenshots/0000003-6-*.png` (e.g., `...-list.png`, `...-filters.png`).
9. [ ] Run repo-wide checks in order: `npm run lint --workspaces`, `npm run format:check --workspaces`, `npm run test --workspace server`, `npm run test --workspace client`, `npm run e2e:test` (stack up), then `npm run compose:down`.

#### Testing

1. [ ] `npm run compose:build`
2. [ ] `npm run compose:up` (confirm stack starts)
3. [ ] run the client jest tests (`npm run test --workspace client`)
4. [ ] run the server cucumber tests (`npm run test --workspace server`)
5. [ ] run the e2e tests (`npm run e2e:test` with stack up; includes new logs spec)
6. [ ] use the playwright mcp tool to manually check the application, saving screenshots to ./test-results/screenshots/ (name `0000003-6-<name>.png`)
7. [ ] `npm run compose:down`

#### Implementation notes

- 

---
