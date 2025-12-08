# Story 0000013 – Persistent Conversation History (MongoDB)

## Description

Add MongoDB (via the latest Mongoose) to persist chat conversations so sessions survive client reloads and normalize the flow across Codex and LM Studio providers. Each conversation gets a unique id (Codex threads reuse the Codex thread id) with individual turns stored separately and timestamped. The chat page should surface a left-hand history menu sorted newest-first; continuing a conversation only sends the conversation id plus the new message, never the full transcript.

## Acceptance Criteria

- MongoDB connection configured in the server using the latest Mongoose; connection settings documented and env-driven.
- Conversation model: unique conversation id (Codex uses thread id), provider enum, created/updated timestamps; turn model references conversation, stores role/content/timestamp.
- Server exposes APIs to create conversation, append turn, fetch paginated history, and list conversations ordered newest-first; Codex/LM Studio both resume using just the conversation id.
- MCP (port 5011) conversations are persisted as well: calls to `codebase_question` create/update the same conversation/turn records, using the Codex thread id as the conversation id.
- Client chat page shows a left-hand conversation history (newest first) and loads turns lazily from the server; sending a message only sends conversation id + new text for both providers.
- Frontend chat requests (Codex and LM Studio) will send only the conversation id and next message—never the full history—since the server will load turns from MongoDB.
- Existing chat behaviour (streaming, stop, flags, citations) remains unchanged aside from persistence; e2e/tests updated to cover persisted flows.

## Out Of Scope

- Multi-user auth/ACL; assume single-user storage for now.
- Vector store changes; MongoDB only for conversation metadata/turns.
- Full-text search across conversations (basic listing only).
- Migration tooling beyond initial schema setup.
- Per-turn payload size limits (no cap in this story).
- Optimistic locking/concurrency control between tabs.
- Retention/TTL limits for stored turns (indefinite retention in this story).

## Questions

- What MongoDB deployment target do we assume for dev/e2e (Docker service vs. external URI)? → **Use local MongoDB via Docker for dev and e2e.**
- Connection string/env: use `MONGO_URI=mongodb://host.docker.internal:27517/db?directConnection=true` (align e2e/Cucumber as needed).
- Do we cap stored turns or add TTL/retention controls? → **No; store turns indefinitely for this story.**
- Should we support soft-delete/archiving for conversations? → **Yes; include soft-delete/archiving support.**
- What payload size limits should apply per turn? → **None for this story; keep it simple unless future need arises.**
- Do we need optimistic locking for concurrent writes from multiple tabs? → **No; out of scope for this story.**
- Conversation metadata fields: include title/label, provider, model, flags, lastMessageAt, and createdAt.
- Soft-delete UX: hide archived conversations by default with an option to list and restore.
- Turn payload contents: store role/content plus model id, provider, tool calls, and status so sessions can be fully restored.
- Failure mode if Mongo is down: allow chat to proceed but show a banner that conversations will not be stored.
- Pagination: conversation list loads 20 at a time with infinite scroll; turn fetch returns newest-first and auto-loads older turns when scrolling up.

# Implementation Plan

## Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks. This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

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

# Tasks

### 1. Mongo connection setup

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Introduce server-side Mongo connection using the agreed `MONGO_URI` env, wire it into app startup, and ensure compose/e2e configs pass the URI to the server.

#### Documentation Locations
- MongoDB connection strings: Context7 `/mongodb/docs`
- Mongoose connection API: Context7 `/mongoosejs/mongoose`
- Docker Compose env docs: https://docs.docker.com/compose/environment-variables/envvars-precedence/

#### Subtasks
1. [ ] Add `MONGO_URI` to `server/.env` and `server/.env.e2e` with the exact value `mongodb://host.docker.internal:27517/db?directConnection=true`; add a commented placeholder to `server/.env.local` for overrides. Duplicate the same key in `server/.env.example` if it exists.
2. [ ] Update `docker-compose.yml`, `docker-compose.e2e.yml`, and `server/src/test/compose/docker-compose.chroma.yml` server service environment blocks to pass `MONGO_URI` through (use the same value as above). Keep existing healthchecks untouched.
3. [ ] Create `server/src/mongo/connection.ts` exporting `connectMongo(uri: string): Promise<void>` and `disconnectMongo(): Promise<void>` using `mongoose.connect`; log success/failure with `pino` (`server/src/logger.ts`) and set `mongoose.set('strictQuery', true)`. Example:
   ```ts
   export async function connectMongo(uri: string) {
     mongoose.set('strictQuery', true);
     await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
     logger.info({ uri }, 'Mongo connected');
   }
   export async function disconnectMongo() {
     await mongoose.connection.close();
     logger.info('Mongo disconnected');
   }
   ```
4. [ ] In `server/src/index.ts`, import and call `connectMongo(process.env.MONGO_URI!)` before starting the HTTP server; on SIGINT/SIGTERM call `disconnectMongo()` alongside existing shutdown hooks. If `MONGO_URI` is missing, log an error and `process.exit(1)`. Ensure shutdown awaits both LM Studio cleanup and `disconnectMongo()`.
5. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`; fix any errors.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
9. [ ] `npm run compose:down`

#### Implementation notes
- Details after implementation.

---

### 2. Conversation schemas

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Define Mongoose models/schemas for Conversation and Turn including required metadata and soft-delete flags.

#### Documentation Locations
- Mongoose schema/types: Context7 `/mongoosejs/mongoose`
- MongoDB TTL/soft-delete patterns: Context7 `/mongodb/docs`

#### Subtasks
1. [ ] Create `server/src/mongo/conversation.ts` exporting a Mongoose model with fields: `_id: string` (conversationId), `provider: 'lmstudio' | 'codex'`, `model: string`, `title: string`, `flags: Record<string, unknown>`, `createdAt: Date`, `updatedAt: Date`, `lastMessageAt: Date`, `archivedAt: Date | null` (default null). Add index on `{ archivedAt: 1, lastMessageAt: -1 }`.
2. [ ] Create `server/src/mongo/turn.ts` exporting a model with fields: `conversationId: string` (ref to Conversation `_id`), `role: 'user' | 'assistant' | 'system'`, `content: string`, `model: string`, `provider: string`, `toolCalls: object | null`, `status: 'ok' | 'stopped' | 'failed'`, `createdAt: Date`. Add index on `{ conversationId: 1, createdAt: -1 }`.
3. [ ] Add a repository helper file `server/src/mongo/repo.ts` with functions: `createConversation`, `updateConversationMeta`, `archiveConversation`, `restoreConversation`, `appendTurn`, `listConversations({ limit, cursor, includeArchived })`, `listTurns({ conversationId, limit, cursor })`. Include JSDoc and types; ensure list uses `archivedAt` filter and sorts by `lastMessageAt desc` for conversations, `createdAt desc` for turns.
4. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
9. [ ] `npm run compose:down`


#### Implementation notes
- Details after implementation.

---

### 3. Conversation list and turn APIs

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose REST endpoints to list conversations (paginated, newest-first, archived toggle), create conversation, append turn, fetch turns paginated newest-first with load-older support, and archive/restore.

#### Documentation Locations
- Express docs: Context7 `/expressjs/express`
- Zod validation: Context7 `/colinhacks/zod`
- MongoDB pagination patterns: Context7 `/mongodb/docs`

#### Subtasks
1. [ ] Create `server/src/routes/conversations.ts` with Express router and register it in `server/src/index.ts`.
2. [ ] Implement `GET /conversations?archived=false&limit=20&cursor=<lastMessageAt>` returning `{ items: ConversationSummary[], nextCursor?: string }` sorted by `lastMessageAt desc`; default limit 20. Example response:
   ```json
   { "items":[{ "conversationId":"abc123","title":"Fix tests","provider":"lmstudio","model":"llama-3","lastMessageAt":"2025-12-08T10:00:00Z","archived":false }], "nextCursor":"2025-12-08T09:59:00Z" }
   ```
3. [ ] Implement `POST /conversations` accepting `{ provider, model, title?, flags? }` and returning `{ conversationId }`; create Conversation row.
4. [ ] Implement `POST /conversations/:id/archive` and `/conversations/:id/restore` toggling `archivedAt`; return `{ status: 'ok' }`.
5. [ ] Implement `GET /conversations/:id/turns?limit=50&cursor=<createdAt>` returning newest-first turns with `{ items, nextCursor? }`; default limit 50. Example:
   ```json
   { "items":[{ "role":"assistant","content":"hi","createdAt":"..."},{ "role":"user","content":"hello","createdAt":"..."}], "nextCursor":"2025-12-08T08:00:00Z" }
   ```
6. [ ] Implement `POST /conversations/:id/turns` accepting `{ role, content, model, provider, toolCalls?, status }`; append turn and update `lastMessageAt`.
7. [ ] Validate all inputs with zod, return 400 on validation errors, 404 on missing conversation, 410 if archived when append requested. Document error bodies: `{ "error": "validation_error", "details": [...] }`, `{ "error": "not_found" }`, `{ "error": "archived" }`.
8. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`.

#### Testing
1. [ ] API (supertest): `server/src/test/routes/conversations.create.test.ts` — covers POST /conversations happy/validation.
2. [ ] API (supertest): `server/src/test/routes/conversations.list.test.ts` — covers GET /conversations pagination, archived filter, nextCursor.
3. [ ] API (supertest): `server/src/test/routes/conversations.turns.test.ts` — covers GET/POST /conversations/:id/turns pagination, archived rejection (410), validation errors.
4. [ ] API (supertest): `server/src/test/routes/conversations.archive.test.ts` — covers archive/restore endpoints and list visibility.
5. [ ] `npm run build --workspace server`
6. [ ] `npm run build --workspace client`
7. [ ] `npm run test --workspace server`
8. [ ] `npm run test --workspace client`
9. [ ] `npm run compose:build`
10. [ ] `npm run compose:up`
11. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
12. [ ] `npm run compose:down`


#### Implementation notes
- Details after implementation.

---

### 4. Chat pipeline persistence (LM Studio + Codex HTTP)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Integrate persistence into existing chat flow so HTTP chat (LM Studio/Codex) creates/updates conversations and turns, and requests accept conversation id instead of full history.

#### Documentation Locations
- Express docs: Context7 `/expressjs/express`
- Zod validation: Context7 `/colinhacks/zod`
- JSON streaming patterns (general): MDN fetch streaming https://developer.mozilla.org/en-US/docs/Web/API/Streams_API

#### Subtasks
1. [ ] Update `server/src/routes/chat.ts` validation to require `conversationId` for both providers; reject requests that send a messages history payload with 400 and a clear error.
2. [ ] On first turn for a new `conversationId`, create Conversation using provider/model/title (use first user message as title fallback).
3. [ ] Before calling the model, load turns from Mongo (newest-first, then reverse to chronological) and pass to the existing chat pipeline instead of client-supplied history.
4. [ ] After each request, append user and assistant turns (including tool calls/status) to Mongo and update `lastMessageAt`.
5. [ ] Run `npm run lint --workspace server` and `npm run test --workspace server` (add/adjust chat tests).
6. [ ] Add request/response examples to comments:
   - Request: `{ "conversationId": "abc123", "model": "llama-3", "provider": "lmstudio", "message": "Hi there", "flags": { "sandboxMode":"workspace-write" } }`
   - Error when history is sent: 400 `{ "error": "conversationId required; history is loaded server-side" }`

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
9. [ ] `npm run compose:down`


#### Implementation notes
- Details after implementation.

---

### 5. MCP persistence (codebase_question)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Persist MCP conversations on port 5011 so `codebase_question` creates/updates conversation/turn records using Codex thread id.

#### Documentation Locations
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- MCP tool/result shape: OpenAI MCP docs (Context7 `/openai/mcp`)
- Mongoose usage: Context7 `/mongoosejs/mongoose`

#### Subtasks
1. [ ] In `server/src/mcp2/tools/codebaseQuestion.ts`, after receiving Codex response, upsert Conversation (id = threadId) with provider `codex`, model, flags; create if missing.
2. [ ] Persist a Turn for the user question and a Turn for the assistant answer; include tool calls, status, and thinking/vector summary payloads in `toolCalls` or metadata field.
3. [ ] If the conversation is archived, return an error (410) indicating it must be restored before use.
4. [ ] Run `npm run lint --workspace server` and `npm run test --workspace server`.
5. [ ] Add inline example of the stored turn shape in comments:
   ```json
   { "conversationId":"thread-1","role":"assistant","content":"Answer","provider":"codex","model":"gpt-5.1-codex-max","toolCalls":[...],"status":"ok","createdAt":"..." }
   ```

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
9. [ ] `npm run compose:down`


#### Implementation notes
- Details after implementation.

---

### 6. Client conversation history UI

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Add left-hand conversation list (newest-first, infinite scroll), archive toggle/view/restore, and load turns lazily; send only conversation id + new message in chat requests for both providers.

#### Documentation Locations
- React docs: https://react.dev/learn
- MUI components: use MUI MCP tool (select correct version)
- Infinite scroll patterns: MDN IntersectionObserver https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API

#### Subtasks
1. [ ] Create a new sidebar component (e.g., `client/src/components/chat/ConversationList.tsx`) with infinite scroll (page size 20) calling `GET /conversations`; include toggle to show archived and buttons to archive/restore.
2. [ ] Add a hook `client/src/hooks/useConversations.ts` to wrap list/scroll logic and expose `loadMore`, `archive`, `restore`.
3. [ ] Add a hook `client/src/hooks/useConversationTurns.ts` to fetch turns newest-first (limit 50) and load older on scroll-up; trigger `loadOlder` when the transcript scroll is within ~200px of the top; stop when `nextCursor` is undefined. Bind to chat transcript.
4. [ ] Update `client/src/pages/ChatPage.tsx` (and `useChatStream.ts`) to send only `{ conversationId, message }` (no history) for both providers; ensure conversationId is required and created when user clicks “New conversation”. Default title = first user message trimmed to 80 chars.
5. [ ] Show an inline banner in ChatPage when persistence is unavailable (from Task 7 flag) and disable archive UI in that state. Banner copy: “Conversation history unavailable — messages won’t be stored until Mongo reconnects.”
6. [ ] Run `npm run lint --workspace client` and `npm run format:check --workspace client`.

#### Testing
1. [ ] RTL: `client/src/test/chatSidebar.test.tsx` — conversation list renders, infinite scroll, archive/restore toggles.
2. [ ] RTL: `client/src/test/chatTurnsLazyLoad.test.tsx` — turns load newest-first, load older triggers near top, stops when no cursor.
3. [ ] RTL: `client/src/test/chatSendPayload.test.tsx` — chat send payload contains conversationId only (no history) for both providers; title fallback 80 chars.
4. [ ] RTL: `client/src/test/chatPersistenceBanner.test.tsx` — banner shows when mongoConnected=false and disables archive controls.
5. [ ] `npm run build --workspace server`
6. [ ] `npm run build --workspace client`
7. [ ] `npm run test --workspace server`
8. [ ] `npm run test --workspace client`
9. [ ] `npm run e2e`
10. [ ] `npm run compose:build`
11. [ ] `npm run compose:up`
12. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
13. [ ] `npm run compose:down`


#### Implementation notes
- Details after implementation.

---

### 7. Persistence availability banner

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Detect Mongo unavailability and surface a banner in the client indicating conversations won’t be stored while allowing chat to proceed.

#### Documentation Locations
- React docs: https://react.dev/learn
- MUI components: use MUI MCP tool (Alert/Banner)

#### Subtasks
1. [ ] Extend `GET /health` (or add `/health/persistence`) to include `mongoConnected: boolean` based on Mongoose connection state.
2. [ ] Update client health fetch (add a small hook, e.g., `usePersistenceStatus`) and render a persistent banner on ChatPage when `mongoConnected=false`; hide/disable conversation list controls in that state.
3. [ ] Run `npm run lint --workspaces` and `npm run test --workspace client`.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the task and save screenshots against the previously started docker stack. Do NOT miss this step!
9. [ ] `npm run compose:down`

#### Implementation notes
- Details after implementation.

---

### 8. Final validation and documentation sweep

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
End-to-end validation, docs updates (README/design/projectStructure), and screenshots per story requirements.

#### Documentation Locations
- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Jest: Context7 `/jestjs/jest`
- Cucumber: https://cucumber.io/docs/guides/

#### Subtasks
1. [ ] Build the server.
2. [ ] Build the client.
3. [ ] Perform a clean docker build.
4. [ ] Update README.md: add `MONGO_URI` env description, Docker compose Mongo notes, and brief usage of conversation history.
5. [ ] Update design.md: add persistence flow/mermaid diagram, note Mongo failover banner, and conversation/turn schema summary.
6. [ ] Update projectStructure.md: list new Mongo files (connection.ts, conversation.ts, turn.ts, repo.ts, routes) and new client hooks/components.
7. [ ] Create PR-style summary of all changes across tasks.
8. [ ] Capture Playwright MCP screenshots saved to `test-results/screenshots/0000013-08-<name>.png`.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Using the playwright-mcp tool, perform a manual UI check for every implemented functionality within the whole story and save screenshots against the previously started docker stack. Do NOT miss this step!
9. [ ] `npm run compose:down`

#### Implementation notes
- Details after implementation.
