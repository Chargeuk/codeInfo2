# Story 0000018 – Agent commands (macros) via UI + REST + Agents MCP

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):
- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today, using agents for repeatable workflows (for example: improving/refining a story plan) requires manually copying/pasting a series of prompts into the Agents UI or MCP calls. This is slow, error-prone, and makes it hard to repeat a known-good workflow consistently.

We want to introduce **Agent Commands**: predefined, named “macros” stored alongside an agent (e.g. `codex_agents/planning_agent/commands/improve_plan.json`). A user can select a command from a dropdown in the Agents page and run it either in a new agent conversation or within an existing agent conversation. The UI should show the command’s name in the dropdown, show the command’s `Description` when selected, and provide a button to execute the command. The UI should not show the underlying JSON.

This functionality must also be exposed via the existing Agents MCP (port `5012`) so external tooling can list and run agent commands. Both the GUI (via REST) and MCP must call into the same shared server code for discovery, validation, and execution—there should not be separate “client-runner” and “server-runner” implementations.

### Version notes (verified in repo)

These versions matter for which external docs we should follow while implementing this story:

- Runtime: Node `22.x` (repo requires `>=22`).
- Client: React `19.2.x`, React Router `7.9.x`, MUI `6.4.x` (project uses `@mui/material ^6.4.1`), Jest `30.2.x` + Testing Library, ts-jest `29.4.x`.
- Server: Express `5.x` (project uses `express ^5.0.0`), Mongoose `9.0.1`, Zod `3.25.76`.

Deepwiki MCP note: Deepwiki does not currently have `Chargeuk/codeInfo2` indexed, so Deepwiki MCP queries fail until it is indexed (implementation must rely on repo code + Context7/MUI MCP + web docs instead).

### Key behavior

- Each agent may optionally have a `commands/` folder containing `*.json` command files.
- The list of available commands is refreshed every time commands are listed (REST or MCP), and the UI refreshes the list whenever the selected agent changes.
- Executing a command runs through its steps sequentially, feeding each step into the agent (reusing `conversationId` between steps).
- Commands accept an optional `working_folder` (absolute path), reusing the existing Agents “working folder” input field and the existing server-side resolution/mapping logic from Story `0000017`.
- Command-run turns appear as normal agent chat turns, but each turn created by a command run is annotated so the UI can show a small “Command run: <name>” note inside the chat bubble.
- Command-run turn metadata uses a single structured field: `command: { name, stepIndex, totalSteps }` so the UI can show progress like “2/12”.
- Command runs are cancellable by reusing the existing abort mechanism: the UI aborts the in-flight HTTP request (AbortController) and the server aborts the provider call via an AbortSignal; the command runner must stop after the current step and never execute subsequent steps once aborted.
- Concurrency is blocked with an in-memory, per-server-process **per-conversation lock**: while a run is in progress for a given `conversationId`, the server rejects concurrent REST/MCP run requests targeting the same `conversationId` (including from multiple browser tabs/windows).
- The UI does not implement client-side locking in v1; it relies on server rejection and shows a clear error when a run is already in progress.

### Concurrency gotchas (must be handled)

- Same `conversationId` must never process two runs at the same time; otherwise turns and `threadId` updates can interleave and corrupt the conversation timeline.
- Command runs are multi-step: the conversation lock must be held for the entire command run (not per step), otherwise another run could slip in between steps and interleave turns.
- Cancellation uses the existing abort mechanism (closing/aborting the HTTP request); the command runner must check `signal.aborted` between steps and never start the next step after abort.
- Because v1 cancellation is “abort the in-flight request”, the client may not receive a normal success response when the user cancels. The cancellation outcome must therefore be visible via persisted turns (e.g. the “Stopped” assistant turn), which will appear when the UI refreshes/rehydrates the conversation.
- For runs that start a new conversation (no `conversationId` provided), the server must generate a `conversationId` early and lock that id for the duration of the run.

### Command schema (v1; extendable)

The schema is based on the structure already used in `codex_agents/planning_agent/commands/improve_plan.json`, but formalized so future stories can add new item types beyond “message”.

Top-level object:

- `Description: string` – required, non-empty (trimmed).
- `items: CommandItem[]` – required, non-empty.

`CommandItem` (discriminated union by `type`):

1. `type: "message"` (supported in this story)
   - `role: "user"` – required for now (future stories may allow other roles).
   - `content: string[]` – required, non-empty; each entry is a non-empty string (trimmed).
   - Execution: `instruction = content.join("\n")`, then call the existing agent runner once for this step.

Legacy compatibility:

- Not required in v1 (there is no existing command execution feature to remain compatible with). The example command file `codex_agents/planning_agent/commands/improve_plan.json` is already in the canonical `items/type/message` shape.

### Discovery + naming

- Command name (for dropdown and APIs) is derived from the JSON filename (basename without `.json`).
- Command `Description` is sourced from the JSON’s `Description` field.

### REST API shape (proposed)

1. List commands for an agent:
   - `GET /agents/:agentName/commands`
   - Response: `{ commands: Array<{ name: string; description: string }> }`

2. Run a command:
   - `POST /agents/:agentName/commands/run`
   - Body:
     - `commandName: string` (required, must match a discovered command name)
     - `conversationId?: string` (optional; if omitted the server starts a new agent conversation)
     - `working_folder?: string` (optional; absolute path; same rules as `POST /agents/:agentName/run`)
   - Response:
     - KISS: return only `{ agentName: string, commandName: string, conversationId: string, modelId: string }` and let the UI re-fetch turns to render results.

### MCP API shape (Agents MCP additions; proposed)

Add two new tools to Agents MCP `5012`:

1. `list_commands`
   - Input:
     - `{ agentName?: string }`
   - Output:
     - If `agentName` provided: `{ agentName, commands: [{ name, description }] }`
     - Else: `{ agents: [{ agentName, commands: [{ name, description }] }] }`

2. `run_command`
   - Input:
     - `{ agentName: string, commandName: string, conversationId?: string, working_folder?: string }`
   - Output:
     - Same shape as REST run response.

---

## Acceptance Criteria

- Agent command discovery:
  - Each agent may optionally have `codex_agents/<agentName>/commands/*.json`.
  - Commands list is refreshed every time list is requested (no long-lived cache).
  - Command name is derived from filename (basename without `.json`; no JSON “title” field required in v1).
  - REST exposes `GET /agents/:agentName/commands` returning `{ commands: [{ name, description, disabled? }] }`.
  - Agents MCP exposes a `list_commands` tool that can list by agent or list all.
  - `list_commands` without `agentName` returns **all agents**, including agents with no `commands/` folder, with `commands: []`.
  - Only valid (non-disabled) commands are returned via Agents MCP `list_commands`.

- Agent command execution (shared server path):
  - There is exactly one server-side implementation that:
    1) loads a command JSON file,
    2) validates it,
    3) executes steps sequentially by calling the existing agent runner,
    4) returns aggregated results.
  - Both REST and Agents MCP call the shared implementation (no client-side step execution loop).
  - Commands can be run:
    - with `conversationId` (continue existing conversation), or
    - without `conversationId` (start new conversation).
  - Commands accept optional `working_folder` and reuse Story `0000017` rules (absolute path required; host mapping attempted under `HOST_INGEST_DIR`; fallback to literal directory; errors are safe).
  - Command execution returns a minimal REST payload `{ agentName, commandName, conversationId, modelId }`; the client refreshes turns to render outputs.
  - Cancellation:
    - Cancelling a command run reuses the existing abort flow (abort HTTP request → server AbortSignal → provider abort) and guarantees no further steps execute.
    - The command runner must check `signal.aborted` between steps and never start the next step after an abort.
    - When cancelling during an in-flight step, the server appends an assistant turn indicating the step was cancelled (existing “Stopped” messaging is acceptable) with the `command` metadata set for that step.
  - Concurrency:
    - While a run is in progress for a given `conversationId` (per-conversation in-memory lock), REST and MCP must reject new run requests targeting the same `conversationId` with `RUN_IN_PROGRESS`.
    - The per-conversation lock must apply consistently to:
      - REST `POST /agents/:agentName/run`
      - REST `POST /agents/:agentName/commands/run`
      - Agents MCP `run_agent_instruction`
      - Agents MCP `run_command`
    - The lock is in-memory per server process and does not coordinate across multiple server instances in v1.
    - Commands are multi-step: the lock must be held for the full command run so other runs cannot interleave between steps.

- Agents UI:
  - When the selected agent changes, the UI fetches and replaces the commands list for that agent.
  - UI shows:
    - a dropdown of command names (display label replaces `_` with spaces; underlying value remains the filename-derived `name`),
    - the selected command’s `Description`,
    - an “Execute” button.
  - UI does not show the command JSON.
  - Invalid command entries are visible but disabled/unselectable in the dropdown.
  - If the working folder field is populated, it is passed as `working_folder` when executing the selected command.
  - After execution completes, the UI shows each command step’s prompt content and the agent’s response for that step by re-fetching turns (no special step payload required).
  - Each command-run-created turn shows a small “Command run: <commandName>” note inside the chat bubble.
  - When the server responds with `RUN_IN_PROGRESS`, the UI surfaces a clear error (for example: “This conversation is already running; wait for it to finish or abort it.”).
  - When persistence is unavailable (`mongoConnected === false` banner), the UI disables command execution (because the transcript cannot be re-fetched) and shows a clear message.

- Validation rules (KISS; enforce only what we need now):
  - Command file must be valid JSON.
  - `Description` must be a non-empty string.
  - `items` must be present and non-empty (`items.length >= 1`).
  - Supported item types:
    - only `type: "message"` in this story.
  - For `message` items:
    - `role` must be `"user"` (v1 enforces user-only).
    - `content` must be a non-empty string array.
  - Traversal prevention:
    - Reject `commandName` containing path separators (`/`, `\\`) or `..`.

- Error codes (stable, safe, reused across REST and MCP):
  - Existing agent errors must continue to work (`AGENT_NOT_FOUND`, `CODEX_UNAVAILABLE`, `CONVERSATION_ARCHIVED`, `AGENT_MISMATCH`, `WORKING_FOLDER_INVALID`, `WORKING_FOLDER_NOT_FOUND`).
  - New command errors:
    - `COMMAND_NOT_FOUND` – requested `commandName` does not exist for that agent.
    - `COMMAND_INVALID` – JSON parse failure, schema invalid, unsupported item type/role.
  - Concurrency:
    - `RUN_IN_PROGRESS` – a run is already in progress for the targeted `conversationId` (covers multiple browser windows/tabs).
  - Listing invalid commands:
    - When listing commands, invalid command files must still appear in the list as disabled entries (so users can see something exists but cannot run it).
    - Disabled entries may use a placeholder description (for example “Invalid command file”) if the JSON cannot be parsed.
  - REST mapping:
    - `AGENT_NOT_FOUND` → 404
    - `COMMAND_NOT_FOUND` → 404
    - `COMMAND_INVALID` → 400 with `{ error: "invalid_request", code: "COMMAND_INVALID", message: "..." }`
    - `WORKING_FOLDER_*` → 400 (existing behavior)
    - `RUN_IN_PROGRESS` → 409 with `{ error: "conflict", code: "RUN_IN_PROGRESS", message: "..." }`
  - MCP mapping:
    - invalid params (including `COMMAND_*` and `WORKING_FOLDER_*`) must be returned as invalid-params style tool errors with safe messages.
    - `RUN_IN_PROGRESS` must be returned as a tool error with a stable code/message (so callers can treat it as a conflict/retry-later condition).

---

## Out Of Scope

- Streaming command execution results step-by-step to the UI (v1 may be synchronous and return only `{ conversationId, modelId, ... }`).
- An explicit cancel endpoint/tool for command runs (v1 cancellation is via aborting the in-flight request; follow-up steps must not run after abort).
- Partial execution controls (run step ranges, skip steps, retry a failed step).
- UI editing/creating commands from the browser.
- A richer command metadata model (`title`, `tags`, `icons`, keyboard shortcuts).
- Non-message command item types (e.g. “pause/confirm”, “set variable”, “select file”, “run tool directly”).
- Running commands in the main Chat UI (non-agents).
- Persisting a separate “CommandRun” collection/entity in MongoDB (v1 uses a simple per-turn metadata field instead).
- Cross-instance locking (multi-server coordination via Redis/DB).
- Guardrails like max command file size or max step/item count (v1 has no explicit limits).

---

## Questions

(none)

---

# Tasks

### 1. Per-conversation run lock + `RUN_IN_PROGRESS` across Agents REST + MCP

- Task Status: **to_do**
- Git Commits:

#### Overview

Add a simple in-memory, per-server-process **per-conversation lock** that blocks concurrent agent runs and command runs targeting the same `conversationId`. Apply it consistently across Agents REST and Agents MCP, returning a stable `RUN_IN_PROGRESS` error (REST: HTTP 409).

Gotchas to keep in mind while implementing this task:

- This lock must reject concurrent runs for the same `conversationId` even when they come from different browser windows/tabs.
- Command runs are multi-step and must hold the conversation lock for the entire run (implemented in later tasks, but the lock helper must support this).
- Cancellation is abort-based; lock release must always happen in `finally`, including abort/error cases.

#### Documentation Locations

- Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller (how we stop in-flight runs when the client aborts/disconnects)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (repo unit tests use Node’s built-in test runner; needed for new lock tests)
- HTTP 409 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409 (REST conflict response for `RUN_IN_PROGRESS`)
- Express 5 routing/request lifecycle: Context7 `/expressjs/express` (how to attach `req.on('aborted')` / `res.on('close')` and build routers consistently)
- Zod v3 schema validation: Context7 `/websites/v3_zod_dev` (how `.safeParse()`/`.strict()` validation should be done for tool args/bodies)
- SuperTest (HTTP route testing): Context7 `/ladjs/supertest` (used by server unit tests to call Express routes and assert response shapes)
- JSON-RPC 2.0 error semantics: https://www.jsonrpc.org/specification (Agents MCP is JSON-RPC; needed to map service errors to stable JSON-RPC errors)

#### Subtasks

1. [ ] Read existing abort / run plumbing patterns:
   - Docs to read:
     - https://nodejs.org/api/globals.html#class-abortcontroller
     - Context7 `/expressjs/express`
     - Note: there is no existing per-conversation lock for agents/chat; the only lock-like helper today is the **global ingest lock** in `server/src/ingest/lock.ts` (TTL-based, reject-not-queue). We are *not* reusing it here because it is global, not keyed by `conversationId`, and includes TTL semantics we don’t need for v1.
   - Files to read:
     - `server/src/routes/agentsRun.ts`
     - `server/src/mcpAgents/tools.ts`
     - `server/src/agents/service.ts`
     - `server/src/agents/authSeed.ts` (contains an existing keyed in-memory lock helper; use it as a reference only)
     - Optional reference (do not reuse in this story): `server/src/ingest/lock.ts`
2. [ ] Add a new per-conversation lock helper (in-memory, per-process):
   - Docs to read:
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
   - Files to edit:
     - Create `server/src/agents/runLock.ts`
   - Requirements:
     - Lock is keyed by `conversationId` (string).
     - KISS: implement this directly with an in-memory `Set<string>` or `Map<string, true>` and keep it isolated to agent runs (do **not** refactor `authSeed` in this story).
     - API must be tiny and explicit: `tryAcquireConversationLock(conversationId: string): boolean` + `releaseConversationLock(conversationId: string): void`.
     - Semantics: agent run locks must **reject** when already held (no queuing).
     - Lock must be released in a `finally` block even if the run fails/throws or is aborted.
   - Implementation sketch (copy the shape, not necessarily the exact code):
     ```ts
     const active = new Set<string>();

     export function tryAcquireConversationLock(conversationId: string): boolean {
       if (active.has(conversationId)) return false;
       active.add(conversationId);
       return true;
     }

     export function releaseConversationLock(conversationId: string): void {
       active.delete(conversationId);
     }
     ```
3. [ ] Extend the agents error union to include `RUN_IN_PROGRESS`:
   - Files to read:
     - `server/src/agents/service.ts`
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Add `RUN_IN_PROGRESS` to the internal error codes used by agents/commands runs.
     - Ensure the error shape is safe (no stack traces leaked).
4. [ ] Apply the per-conversation lock in the shared agents service (covers REST + MCP automatically):
   - Files to read:
     - `server/src/agents/service.ts`
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Compute the effective `conversationId` (provided or newly generated) first, then acquire the lock for that id before any provider call.
     - This does not block other conversations (lock is keyed), but it *does* ensure that if another browser tab/window starts using the same `conversationId` mid-run, it is rejected.
     - On conflict, throw `{ code: 'RUN_IN_PROGRESS', reason?: string }`.
     - Release must happen in `finally` even on abort and errors.
   - Implementation sketch (where to put the `try/finally`):
     - In `runAgentInstruction(...)`, after computing `conversationId` and before calling `chat.run(...)`:
       ```ts
       if (!tryAcquireConversationLock(conversationId)) {
         throw toRunAgentError('RUN_IN_PROGRESS', 'Conversation already has an in-flight run');
       }
       try {
         // existing runAgentInstruction logic...
       } finally {
         releaseConversationLock(conversationId);
       }
       ```
5. [ ] Map `RUN_IN_PROGRESS` in REST + MCP:
   - Files to edit:
     - `server/src/routes/agentsRun.ts`
     - `server/src/mcpAgents/tools.ts`
     - `server/src/mcpAgents/router.ts`
     - `server/src/mcp2/errors.ts`
   - Requirements:
     - REST: map `RUN_IN_PROGRESS` → HTTP `409` with JSON `{ error: 'conflict', code: 'RUN_IN_PROGRESS', message: '...' }`.
       - Example response body (tests should assert this shape):
         ```json
         { "error": "conflict", "code": "RUN_IN_PROGRESS", "message": "A run is already in progress for this conversation." }
         ```
     - MCP: map `RUN_IN_PROGRESS` → a tool error with a stable code/message so clients can retry later.
       - KISS approach: add a dedicated error class (e.g. `RunInProgressError` with `.code = 409`) in `server/src/mcp2/errors.ts`, have tools throw it when the service returns `{ code: 'RUN_IN_PROGRESS' }`, and have the Agents MCP router map it to a JSON-RPC error consistently (similar to `ArchivedConversationError`).
6. [ ] Add focused unit coverage for the lock behavior:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
     - https://www.jsonrpc.org/specification (error codes overview)
   - Files to edit:
     - `server/src/test/unit/agents-router-run.test.ts`
     - `server/src/test/unit/mcp-agents-tools.test.ts`
     - `server/src/test/unit/mcp-agents-router-run.test.ts`
   - Test requirements:
     - Main path: a normal run with no lock returns success as today.
     - Failure path: simulate “run already in progress” for a specific `conversationId` by acquiring the lock, then call the route/tool with that same `conversationId` and assert `RUN_IN_PROGRESS`.
     - Edge case: acquiring a lock for `conversationId='c1'` must not block a run for `conversationId='c2'`.
   - Where to copy patterns from (junior-friendly pointers):
     - REST test patterns: `server/src/test/unit/agents-router-run.test.ts` (Supertest + `buildApp()` helper).
     - MCP tool patterns: `server/src/test/unit/mcp-agents-tools.test.ts` (uses `setToolDeps`/`resetToolDeps`).
     - MCP router patterns: `server/src/test/unit/mcp-agents-router-run.test.ts` (spins up `http.createServer(handleAgentsRpc)` and POSTs JSON-RPC).
7. [ ] Update `projectStructure.md` after adding any new files:
   - Files to edit:
     - `projectStructure.md`
8. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Start an agent run from one browser window/tab.
   - Attempt a second run against the same conversation from another browser window/tab and confirm it fails with `RUN_IN_PROGRESS` and surfaces a clear error.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 2. Mongo: add per-turn `command` metadata (`{ name, stepIndex, totalSteps }`)

- Task Status: **to_do**
- Git Commits:

#### Overview

Add an optional `command` field to persisted turns so the UI can render “Command run: <name> (2/12)” inside chat bubbles for both user and assistant turns created by command runs.

#### Documentation Locations

- Mongoose schemas + subdocuments: Context7 `/websites/mongoosejs` (how to add an optional nested object field to a schema without breaking existing documents)
- MongoDB document modeling: https://www.mongodb.com/docs/manual/core/data-modeling-introduction/ (why optional fields are safe and how schema evolution works)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests added in this task use Node’s built-in runner)

#### Subtasks

1. [ ] Read current turn persistence types and schemas:
   - Docs to read:
     - Context7 `/websites/mongoosejs`
   - Files to read:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
2. [ ] Extend the Turn model/schema to include `command`:
   - Files to edit:
     - `server/src/mongo/turn.ts`
   - Required field shape:
     - `command?: { name: string; stepIndex: number; totalSteps: number }`
   - Requirements:
     - Optional field (missing for normal turns).
     - Stored as a subdocument in Mongo.
3. [ ] Plumb `command` through repository helpers:
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Requirements:
     - Extend `AppendTurnInput` and `TurnSummary` to include optional `command`.
     - Ensure `listTurns` includes the field in its returned JSON.
4. [ ] Plumb `command` through chat persistence:
   - Files to read:
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Requirements:
     - Allow passing `command` metadata via flags to `chat.run(...)` and persist it on both the user and assistant turns for that run.
     - Ensure the “Stopped” assistant turn created on abort also receives the same `command` metadata (this is required for cancelled in-flight command steps).
     - Keep default behavior unchanged when no `command` is provided.
5. [ ] Validate existing ChatInterface unit tests still compile and pass:
   - Files to read:
     - `server/src/test/unit/chat-interface-run-persistence.test.ts`
     - `server/src/test/unit/chat-interface-base.test.ts`
   - Requirements:
     - If TypeScript method override signatures need widening due to the new optional `command` field, update these tests accordingly without changing their assertions unless necessary.
6. [ ] Add unit coverage for `command` persistence plumbing:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - Add `server/src/test/unit/turn-command-metadata.test.ts`
   - Test requirements:
     - Verify `appendTurn` stores and `listTurns` returns `command` when provided.
     - Verify missing `command` does not break existing behavior.
7. [ ] Update `projectStructure.md` after adding any new test files:
   - Files to edit:
     - `projectStructure.md`
8. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Run an agent command (later tasks) and verify command bubbles show “2/12” style metadata.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 3. Server: implement command JSON schema + validation helper (v1)

- Task Status: **to_do**
- Git Commits:

#### Overview

Define the command JSON schema (based on `improve_plan.json`) and implement validation that produces a safe summary for listing (including disabled entries with description “Invalid command file”).

#### Documentation Locations

- Zod v3 object schemas/unions: Context7 `/websites/v3_zod_dev` (for defining the v1 command schema and returning safe parse results)
- Node.js filesystem (`fs.promises.readFile`, `readdir`): https://nodejs.org/api/fs.html (for reading command files from disk)
- `JSON.parse(...)`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse (how JSON parse failures surface and must be handled)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests for schema parsing are written with Node’s test runner)

#### Subtasks

1. [ ] Confirm the example command matches the intended schema:
   - Files to read:
     - `codex_agents/planning_agent/commands/improve_plan.json`
   - Requirements:
     - Top-level `Description` string.
     - `items[]` with `{ type: "message", role: "user", content: string[] }`.
2. [ ] Create command schema + parser helper:
   - Docs to read:
     - Context7 `/websites/v3_zod_dev`
     - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - Create `server/src/agents/commandsSchema.ts`
   - Required exports (copy names exactly):
     - `export type AgentCommandItem = ...`
     - `export type AgentCommandFile = ...`
     - `export function parseAgentCommandFile(jsonText: string): { ok: true; command: AgentCommandFile } | { ok: false }`
   - Requirements:
     - Only supports `type: "message"` and `role: "user"` in v1.
     - `content` must be a non-empty string array; trim entries during parse.
3. [ ] Add a file-loader helper that returns a safe list summary:
   - Docs to read:
     - https://nodejs.org/api/fs.html
   - Files to edit:
     - Create `server/src/agents/commandsLoader.ts`
   - Required exported function:
     ```ts
     export async function loadAgentCommandSummary(params: {
       filePath: string;
       name: string;
     }): Promise<{ name: string; description: string; disabled: boolean }>;
     ```
   - Requirements:
     - If JSON invalid or schema invalid → `{ disabled: true, description: "Invalid command file" }`.
     - If valid → `{ disabled: false, description: <Description from JSON> }`.
4. [ ] Add unit tests for schema parsing + invalid handling:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - Add `server/src/test/unit/agent-commands-schema.test.ts`
   - Test requirements:
     - Valid parse returns ok.
     - Invalid JSON returns `{ ok: false }`.
     - Invalid schema returns `{ ok: false }`.
5. [ ] Update `projectStructure.md` after adding new server files/tests:
   - Files to edit:
     - `projectStructure.md`
6. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Not applicable yet (schema only); verify server unit tests pass.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 4. Server: list agent commands (shared service)

- Task Status: **to_do**
- Git Commits:

#### Overview

Implement a shared server function that discovers command JSON files for an agent and returns their `{ name, description, disabled }` summaries (no REST/MCP wiring yet).

#### Documentation Locations

- Node.js filesystem directory listing (`fs.readdir`): https://nodejs.org/api/fs.html#fspromisesreaddirpath-options (to enumerate `commands/*.json` with no caching)
- Node.js path utilities: https://nodejs.org/api/path.html (safe basename handling and cross-platform joins)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests for directory listing behavior use Node’s runner)

#### Subtasks

1. [ ] Read existing agent discovery shape (to locate agent home folders):
   - Files to read:
     - `server/src/agents/discovery.ts`
     - `server/src/agents/service.ts`
2. [ ] Add a new shared function to list commands for an agent:
   - Docs to read:
     - https://nodejs.org/api/fs.html#fspromisesreaddirpath-options
     - https://nodejs.org/api/path.html
   - Files to edit:
     - `server/src/agents/service.ts`
   - Required export (copy name exactly):
     ```ts
     export async function listAgentCommands(params: {
       agentName: string;
     }): Promise<{ commands: Array<{ name: string; description: string; disabled: boolean }> }>;
     ```
   - Requirements:
     - If `agentName` does not match a discovered agent → throw `{ code: 'AGENT_NOT_FOUND' }` (so REST can return 404 and MCP can return a stable tool error).
     - If `commands/` folder missing → return `{ commands: [] }`.
     - Only include `*.json` files.
     - `name` is basename without `.json`.
     - Use the loader from Task 3 to compute `{ description, disabled }`.
     - No caching in v1: always read the directory contents from disk each time this function is called so new/edited command files appear immediately.
3. [ ] Add unit coverage for list logic:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - Add `server/src/test/unit/agent-commands-list.test.ts`
   - Test requirements:
     - No folder → empty list.
     - Invalid JSON file → included with `disabled: true` and “Invalid command file”.
     - Unknown agentName → throws `{ code: 'AGENT_NOT_FOUND' }`.
4. [ ] Update `projectStructure.md` after adding any new test files:
   - Files to edit:
     - `projectStructure.md`
5. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Not applicable yet (service only); verify server unit tests pass.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 5. REST: `GET /agents/:agentName/commands`

- Task Status: **to_do**
- Git Commits:

#### Overview

Expose command listing to the GUI via REST using the shared list function. The response must include disabled invalid entries so the UI can show them as unselectable.

#### Documentation Locations

- Express 5 routing: Context7 `/expressjs/express` (how to add a new GET route and wire it into the app)
- HTTP 404 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404 (REST behavior for unknown `agentName`)
- SuperTest (HTTP route testing): Context7 `/ladjs/supertest` (used to unit test the new REST route)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (server unit tests use Node’s runner)

#### Subtasks

1. [ ] Create a new router for agent commands:
   - Docs to read:
     - Context7 `/expressjs/express`
   - Files to edit:
     - Create `server/src/routes/agentsCommands.ts`
   - Requirements:
     - Add `GET /agents/:agentName/commands`.
     - Use `listAgentCommands({ agentName })`.
     - If agent not found → 404 `{ error: 'not_found' }`.
2. [ ] Wire the new router into server startup:
   - Files to read:
     - `server/src/index.ts`
   - Files to edit:
     - `server/src/index.ts`
3. [ ] Add unit coverage for the REST route:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - Add `server/src/test/unit/agents-commands-router-list.test.ts`
   - Test requirements:
     - Valid agent returns `{ commands: [...] }`.
     - Invalid command included with `disabled: true`.
4. [ ] Update `projectStructure.md` after adding any new files:
   - Files to edit:
     - `projectStructure.md`
5. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - On `/agents`, changing agents refreshes command list (after UI work).
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 6. Agents MCP: add `list_commands` tool

- Task Status: **to_do**
- Git Commits:

#### Overview

Expose command listing via Agents MCP `5012`. `list_commands` must return all agents (when agentName omitted) but list only valid commands (exclude disabled/invalid).

#### Documentation Locations

- JSON-RPC 2.0 errors: https://www.jsonrpc.org/specification (Agents MCP is JSON-RPC; `list_commands` must return stable error codes/messages)
- Zod v3 parsing: Context7 `/websites/v3_zod_dev` (how MCP tool args should be validated with `.safeParse()` and `.strict()` objects)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests for the MCP tool use Node’s runner)

#### Subtasks

1. [ ] Read existing Agents MCP tool patterns:
   - Files to read:
     - `server/src/mcpAgents/tools.ts`
     - `server/src/mcpAgents/router.ts`
2. [ ] Add tool definition + handler:
   - Docs to read:
     - https://www.jsonrpc.org/specification
     - Context7 `/websites/v3_zod_dev`
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Requirements:
     - Add tool name: `list_commands`.
     - Input schema: `{ agentName?: string }`.
     - If agentName provided:
       - If agent does not exist → return a stable tool error (404-style) with a safe message (do not silently return empty).
       - return `{ agentName, commands: [{ name, description }] }` (exclude disabled).
     - Else:
       - return `{ agents: [{ agentName, commands: [{ name, description }] }] }` for **all** agents.
3. [ ] Add unit coverage:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - Add `server/src/test/unit/mcp-agents-commands-list.test.ts`
   - Test requirements:
     - Omitting agentName returns all agents with commands arrays.
     - Invalid commands are excluded from MCP output.
4. [ ] Update existing MCP tools/list expectation test:
   - Files to read:
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Files to edit:
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Requirements:
     - Update the expected tool names to include `list_commands` (while `run_command` is not yet implemented in this task).
5. [ ] Update `projectStructure.md` after adding any new test files:
   - Files to edit:
     - `projectStructure.md`
6. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Use an MCP client to call `list_commands` and verify output shape.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 7. Server: refactor agent execution into locked wrapper + unlocked internal helper

- Task Status: **to_do**
- Git Commits:

#### Overview

Refactor agents execution so the per-conversation lock can be acquired once for a command run while still calling the same core “run one instruction” logic for each step without deadlocking.

#### Documentation Locations

- `try { } finally { }` (async/await safety): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch (why lock release must happen in `finally` even when aborted)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (this refactor updates unit tests written with Node’s runner)

#### Subtasks

1. [ ] Read current `runAgentInstruction` implementation:
   - Files to read:
     - `server/src/agents/service.ts`
2. [ ] Extract an internal helper that runs a single instruction without acquiring the per-conversation lock:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Keep the exported `runAgentInstruction(...)` signature stable for existing callers.
     - Keep the locking behavior implemented in Task 1 (do not add a second lock layer here).
     - The internal helper must NOT acquire the per-conversation lock; it is used by the multi-step command runner (Task 8) which holds the lock for the entire command run.
     - Internal helper should accept an additional optional `command` metadata object (for later tasks) and pass it to `chat.run(...)`.
3. [ ] Update unit tests to cover both paths:
   - Files to read:
     - `server/src/test/unit/agents-router-run.test.ts`
   - Files to edit:
     - Update/add tests as needed to confirm behavior unchanged for normal runs.
4. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Basic `/agents` run still works without commands.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 8. Server: implement command execution runner (sequential steps + abort stop)

- Task Status: **to_do**
- Git Commits:

#### Overview

Implement a shared `runAgentCommand(...)` function that loads a command file, acquires the per-conversation lock once (for the entire command run), runs each step sequentially as an agent instruction (joining `content[]` with `\n`), tags turns with `command` metadata, and stops after the current step if aborted.

#### Documentation Locations

- Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller (how abort propagates and how to check `signal.aborted` between steps)
- Node.js `path` utilities: https://nodejs.org/api/path.html (prevent path traversal via `commandName` and build a safe file path)
- Node.js `crypto.randomUUID()`: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions (how to generate a new `conversationId` for new command runs)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests for multi-step execution are written with Node’s runner)

#### Subtasks

1. [ ] Add a command loader that returns the full parsed command (not just summary):
   - Files to read:
     - `server/src/agents/commandsSchema.ts`
   - Files to edit:
     - `server/src/agents/commandsLoader.ts`
   - Requirements:
     - Add `loadAgentCommandFile({ filePath })` that returns `{ ok: true, command } | { ok: false }`.
2. [ ] Implement `runAgentCommand(...)` in the agents service:
   - Docs to read:
     - https://nodejs.org/api/globals.html#class-abortcontroller
     - https://nodejs.org/api/path.html
   - Files to edit:
     - `server/src/agents/service.ts`
   - Required export:
     ```ts
     export async function runAgentCommand(params: {
       agentName: string;
       commandName: string;
       conversationId?: string;
       working_folder?: string;
       signal?: AbortSignal;
       source: 'REST' | 'MCP';
     }): Promise<{ agentName: string; commandName: string; conversationId: string; modelId: string }>;
     ```
   - Requirements:
     - Validate `commandName` contains no `/`, `\\`, or `..`.
     - Acquire the per-conversation lock once for the entire run (hold it across all steps so no other run can interleave).
     - Load/parse the command file; invalid → `COMMAND_INVALID`.
     - For each step `i`:
       - If `signal?.aborted`, stop before starting next step.
       - Build `instruction = content.join(\"\\n\")`.
       - Call the unlocked internal “run instruction” helper with `command: { name, stepIndex: i+1, totalSteps }`.
     - Cancellation behavior:
       - When abort happens mid-step, the underlying chat persistence should produce a “Stopped” assistant turn; ensure it has `command` metadata (same `{ name, stepIndex, totalSteps }`).
   - Implementation sketch (keep this structure so locks + abort are correct):
     ```ts
     const totalSteps = command.items.length;
     const conversationId = params.conversationId ?? crypto.randomUUID();

     if (!tryAcquireConversationLock(conversationId)) throw toRunAgentError('RUN_IN_PROGRESS');
     try {
       for (let i = 0; i < totalSteps; i++) {
         if (params.signal?.aborted) break;
         const item = command.items[i];
         const instruction = item.content.join('\n');
         await runAgentInstructionUnlocked({
           ...params,
           conversationId,
           instruction,
           command: { name: params.commandName, stepIndex: i + 1, totalSteps },
         });
       }
       return { agentName: params.agentName, commandName: params.commandName, conversationId, modelId };
     } finally {
       releaseConversationLock(conversationId);
     }
     ```
   - Reminder (do not miss these “gotchas”, even if you only read this subtask):
     - The lock must be held for the *entire* multi-step run (not reacquired per step).
     - `signal.aborted` must be checked *between* steps so later steps never start after cancel.
     - Command metadata must tag BOTH the user turn and assistant turn for each step (Task 2/7 enable this plumbing).
3. [ ] Add unit coverage for sequential execution + abort stop:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - Add `server/src/test/unit/agent-commands-runner.test.ts`
   - Test requirements:
     - With a 3-step command, verify the unlocked helper is called 3 times with correct `stepIndex` and `totalSteps`.
     - Simulate abort after step 1 and verify step 2+ never execute.
     - Edge case: while a command run is in progress (lock held), a concurrent agent run targeting the same `conversationId` must fail with `RUN_IN_PROGRESS`.
4. [ ] Update `projectStructure.md` after adding any new files:
   - Files to edit:
     - `projectStructure.md`
5. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Not applicable yet (no UI/REST wired); verify server unit tests pass.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 9. REST: `POST /agents/:agentName/commands/run`

- Task Status: **to_do**
- Git Commits:

#### Overview

Expose command execution to the GUI via REST using the shared runner. Response is minimal; UI re-fetches turns.

#### Documentation Locations

- Express 5 routing + body parsing: Context7 `/expressjs/express` (how to add a POST route and wire abort handling consistently)
- Node.js `AbortController`: https://nodejs.org/api/globals.html#class-abortcontroller (route cancellation wiring via AbortSignal)
- HTTP status semantics (400/404/409): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status (stable REST mappings for command errors and `RUN_IN_PROGRESS`)
- SuperTest (HTTP route testing): Context7 `/ladjs/supertest` (unit tests for the POST route)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (server unit tests use Node’s runner)

#### Subtasks

1. [ ] Add the REST route:
   - Docs to read:
     - Context7 `/expressjs/express`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
   - Route contract:
     - `POST /agents/:agentName/commands/run`
     - Body: `{ commandName: string, conversationId?: string, working_folder?: string }`
     - Response: `{ agentName, commandName, conversationId, modelId }`
   - Cancellation wiring (must match existing Agents run route behavior):
     - Copy the pattern from `server/src/routes/agentsRun.ts`:
       - Create `const controller = new AbortController()`
       - `req.on('aborted', () => controller.abort())`
       - `res.on('close', () => { if (!res.writableEnded) controller.abort() })`
       - Pass `signal: controller.signal` into `runAgentCommand(...)`
     - Reminder: v1 cancellation is **abort the in-flight HTTP request**; the UI may not receive a “success” response when stopped, so the “Stopped” assistant turn must be persisted by the server (Task 2 + Task 8).
2. [ ] Map runner errors to stable HTTP responses:
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
   - Requirements:
     - `COMMAND_NOT_FOUND` → 404
     - `COMMAND_INVALID` → 400 + code
     - `RUN_IN_PROGRESS` → 409 + code
     - `WORKING_FOLDER_*` → 400 + code
   - Example error shapes (tests should assert these shapes, not text matching):
     - 404: `{ "error": "not_found" }` (for unknown agent/command)
     - 400: `{ "error": "invalid_request", "code": "COMMAND_INVALID", "message": "..." }`
     - 409: `{ "error": "conflict", "code": "RUN_IN_PROGRESS", "message": "..." }`
3. [ ] Add unit tests for the new route:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Files to edit:
     - Add `server/src/test/unit/agents-commands-router-run.test.ts`
   - Test requirements:
     - Main path: valid command returns `{ agentName, commandName, conversationId, modelId }`.
     - Failure path: when a run is already in progress for the same `conversationId`, the route returns `409` with `code: RUN_IN_PROGRESS`.
     - Failure path: invalid `commandName` (contains `/` or `..`) returns `400` with `code: COMMAND_INVALID`.
   - Where to copy test patterns from:
     - `server/src/test/unit/agents-router-run.test.ts` (Supertest + route wiring + stable error shape assertions)
4. [ ] Update `projectStructure.md` after adding tests:
   - Files to edit:
     - `projectStructure.md`
5. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Execute a command via curl and confirm turns are appended.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 10. Agents MCP: add `run_command` tool

- Task Status: **to_do**
- Git Commits:

#### Overview

Expose command execution via Agents MCP using the same server runner and error mapping rules.

#### Documentation Locations

- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification (Agents MCP tool behavior and error envelopes)
- Zod v3 parsing: Context7 `/websites/v3_zod_dev` (validate tool args; reject invalid inputs safely)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (MCP tool tests use Node’s runner)

#### Subtasks

1. [ ] Add the tool definition + args schema:
   - Docs to read:
     - https://www.jsonrpc.org/specification
     - Context7 `/websites/v3_zod_dev`
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Input schema:
     - `{ agentName: string, commandName: string, conversationId?: string, working_folder?: string }`
2. [ ] Implement the handler using `runAgentCommand(...)`:
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Requirements:
     - Return JSON text payload of `{ agentName, commandName, conversationId, modelId }`.
     - Map `COMMAND_*`, `WORKING_FOLDER_*`, and `RUN_IN_PROGRESS` to stable tool errors with safe messages.
   - Where to copy the pattern from:
     - `server/src/mcpAgents/tools.ts` already has `runRunAgentInstruction(...)` which:
       - validates args with Zod
       - calls the service
       - maps known service error codes to `InvalidParamsError` / `ArchivedConversationError` / `CodexUnavailableError`
     - Implement `run_command` by mirroring that structure (new schema + new call + new mapping).
   - Example JSON-RPC request (use this shape in tests):
     ```json
     {
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/call",
       "params": { "name": "run_command", "arguments": { "agentName": "planning_agent", "commandName": "improve_plan" } }
     }
     ```
3. [ ] Add unit tests:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Files to edit:
     - Add `server/src/test/unit/mcp-agents-commands-run.test.ts`
   - Test requirements:
     - Main path returns `{ agentName, commandName, conversationId, modelId }`.
     - Failure path: `RUN_IN_PROGRESS` returned when a run is already in progress for the same `conversationId`.
     - Failure path: invalid `commandName` rejected with a stable error.
   - Where to copy test harness from:
     - `server/src/test/unit/mcp-agents-router-run.test.ts` (HTTP server + JSON-RPC POST helper)
     - `server/src/test/unit/mcp-agents-tools.test.ts` (direct `callTool()` dependency injection + error mapping assertions)
4. [ ] Update existing MCP tools/list expectation test (now that `run_command` exists):
   - Files to read:
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Files to edit:
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Requirements:
     - Update expected tool names to include `run_command` as well as `list_commands`.
5. [ ] Update `projectStructure.md` after adding tests:
   - Files to edit:
     - `projectStructure.md`
6. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Call MCP `run_command` and confirm it returns `{ conversationId, modelId }`.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 11. Client API: add `listAgentCommands()` (REST `GET /agents/:agentName/commands`)

- Task Status: **to_do**
- Git Commits:

#### Overview

Add a focused client API helper for listing commands for the selected agent. This is used by the Commands dropdown in the Agents UI.

#### Documentation Locations

- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Jest 30 + TypeScript: Context7 `/websites/jestjs_io_30_0`
- ts-jest ESM preset (`ts-jest/presets/default-esm`): Context7 `/websites/kulshekhar_github_io-ts-jest-docs`

#### Subtasks

1. [ ] Add the list API call:
   - Files to edit:
     - `client/src/api/agents.ts`
   - Required export:
     ```ts
     export async function listAgentCommands(agentName: string): Promise<{ commands: Array<{ name: string; description: string; disabled: boolean }> }>;
     ```
   - Requirements:
     - Calls `GET /agents/:agentName/commands`.
     - Returns `{ commands }` including disabled entries so the UI can show invalid commands as disabled.
   - Implementation sketch (follow existing `serverBase` + URL building style in this file):
     ```ts
     const res = await fetch(new URL(`/agents/${encodeURIComponent(agentName)}/commands`, serverBase).toString());
     ```
2. [ ] Add client unit coverage for listing:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/kulshekhar_github_io-ts-jest-docs`
   - Files to edit:
     - Add `client/src/test/agentsApi.commandsList.test.ts`
   - Test requirements:
     - Uses fetch mocking to confirm it hits `/agents/:agentName/commands`.
     - Returns the parsed `commands` array.
   - Where to copy test patterns from:
     - `client/src/test/agentsApi.workingFolder.payload.test.ts` (fetch mocking + asserting URL + body)
3. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Not applicable yet (API helper only); verify client unit tests pass.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 12. Client API: add `runAgentCommand()` (REST `POST /agents/:agentName/commands/run`)

- Task Status: **to_do**
- Git Commits:

#### Overview

Add a focused client API helper for executing a selected command against an agent (optionally continuing an existing conversation).

#### Documentation Locations

- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- AbortController / AbortSignal: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Jest 30 + TypeScript: Context7 `/websites/jestjs_io_30_0`
- ts-jest ESM preset (`ts-jest/presets/default-esm`): Context7 `/websites/kulshekhar_github_io-ts-jest-docs`

#### Subtasks

1. [ ] Add the run API call:
   - Files to edit:
     - `client/src/api/agents.ts`
   - Required export:
     ```ts
     export async function runAgentCommand(params: { agentName: string; commandName: string; conversationId?: string; working_folder?: string; signal?: AbortSignal; }): Promise<{ agentName: string; commandName: string; conversationId: string; modelId: string }>;
     ```
   - Requirements:
     - Calls `POST /agents/:agentName/commands/run`.
     - Body: `{ commandName, conversationId?, working_folder? }`.
     - Propagates `signal` to fetch so the existing Abort button can cancel it.
   - Reminder:
     - Keep the “omit empty optionals” behavior consistent with `runAgentInstruction(...)` in this file (don’t send `working_folder: ""`).
2. [ ] Add client unit coverage for running:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/kulshekhar_github_io-ts-jest-docs`
   - Files to edit:
     - Add `client/src/test/agentsApi.commandsRun.test.ts`
   - Test requirements:
     - Confirms it hits `/agents/:agentName/commands/run`.
     - Confirms `working_folder` and `conversationId` are omitted when not provided.
   - Where to copy test patterns from:
     - `client/src/test/agentsApi.workingFolder.payload.test.ts` (asserts optional payload behavior)
3. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Not applicable yet (API helper only); verify client unit tests pass.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 13. Client API: structured error parsing for agents endpoints (including `RUN_IN_PROGRESS`)

- Task Status: **to_do**
- Git Commits:

#### Overview

Add consistent, structured error parsing for agent-related API calls so the UI can detect `RUN_IN_PROGRESS` (409) without string parsing, for both normal runs and command runs.

#### Documentation Locations

- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Response.json(): https://developer.mozilla.org/en-US/docs/Web/API/Response/json
- Jest 30 + TypeScript: Context7 `/websites/jestjs_io_30_0`

#### Subtasks

1. [ ] Define a small structured error type for agent API calls:
   - Files to edit:
     - `client/src/api/agents.ts`
   - Requirements:
     - Surface `{ status: number; code?: string; message: string }` via a custom `Error` subclass (preferred) or equivalent, so callers can reliably branch on `status` and `code`.
2. [ ] Update `runAgentInstruction(...)` to use structured errors:
   - Files to edit:
     - `client/src/api/agents.ts`
   - Requirements:
     - When response is JSON, prefer `{ code, message }` fields from body if present.
     - Keep existing behavior for non-JSON error bodies (fallback to text).
3. [ ] Update `runAgentCommand(...)` to use structured errors:
   - Files to edit:
     - `client/src/api/agents.ts`
4. [ ] Add unit tests for `RUN_IN_PROGRESS` detection:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - Add `client/src/test/agentsApi.errors.test.ts`
   - Test requirements:
     - For `runAgentInstruction(...)`, simulate `409` with `{ code: "RUN_IN_PROGRESS" }` and assert the thrown error exposes `status=409` and `code="RUN_IN_PROGRESS"`.
     - For `runAgentCommand(...)`, same assertion.
5. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Not applicable yet (API only); verify client unit tests pass.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 14. Client: add turns refresh + include `command` metadata in `StoredTurn`

- Task Status: **to_do**
- Git Commits:

#### Overview

Support the “KISS” command execution response by adding a refresh method to `useConversationTurns` and extending `StoredTurn` to include optional `command` metadata returned by the server.

#### Documentation Locations

- React hooks reference: https://react.dev/reference/react (implementing `refresh()` and handling state updates safely)
- Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API (the hook re-fetches turns; helps ensure correct fetch + abort usage)
- Jest 30 + TypeScript: Context7 `/websites/jestjs_io_30_0` (client unit tests run under Jest and must use the project’s Jest patterns)
- React Testing Library: Context7 `/websites/testing-library` (tests in this repo render components/hooks via Testing Library patterns)

#### Subtasks

1. [ ] Extend `StoredTurn` with optional `command`:
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Required type:
     - `command?: { name: string; stepIndex: number; totalSteps: number }`
2. [ ] Add a `refresh()` function to the hook:
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Requirements:
     - `refresh()` re-fetches the newest page (`replace` mode) without requiring a conversationId change.
3. [ ] Add unit tests for refresh behavior:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - Add `client/src/test/useConversationTurns.refresh.test.ts`
4. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Not applicable yet (hook only); verify unit tests pass.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 15. Client UI: commands dropdown + description (list-only)

- Task Status: **to_do**
- Git Commits:

#### Overview

Update the Agents page to list commands for the selected agent and show the selected command `Description`. This task does not execute commands yet.

#### Documentation Locations

- MUI Select API (disabled options): MUI MCP `@mui/material@6.4.12` (use `mcp__mui__fetchDocs` for `Select`/`MenuItem` to confirm disabled behavior)
- MUI MenuItem API (disabled state): MUI MCP `@mui/material@6.4.12` (ensures invalid commands can be shown but not selectable)
- MUI FormControl/InputLabel/Typography APIs: MUI MCP `@mui/material@6.4.12` (layout + labeling for accessible dropdown UI)
- React state/effects: https://react.dev/reference/react (fetch-on-agent-change and derived selection state)

#### Subtasks

1. [ ] Add command list state and fetch-on-agent-change:
   - Docs to read:
     - https://react.dev/reference/react/useEffect
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - On agent change, call `listAgentCommands(selectedAgentName)` and store results.
     - Keep disabled commands in state so the dropdown can show them as disabled.
2. [ ] Add the Commands dropdown + description panel:
   - Docs to read:
     - MUI MCP `@mui/material@6.4.12`
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Dropdown options use command `name` as value.
     - Display label replaces `_` with spaces.
     - Disabled commands are unselectable and show description “Invalid command file”.
     - Show selected command Description below the dropdown.
   - UI sketch (MUI components already imported in `AgentsPage.tsx`):
     ```tsx
     <FormControl fullWidth size="small">
       <InputLabel id="command-label">Command</InputLabel>
       <Select labelId="command-label" label="Command" value={selectedCommand ?? ''} onChange={...}>
         {commands.map((cmd) => (
           <MenuItem key={cmd.name} value={cmd.name} disabled={cmd.disabled}>
             {cmd.name.replace(/_/g, ' ')}
           </MenuItem>
         ))}
       </Select>
     </FormControl>
     <Typography variant="body2" color="text.secondary">
       {selectedCommandSummary?.description ?? 'Select a command to see its description.'}
     </Typography>
     ```
   - Reminder:
     - Do **not** render the raw JSON contents anywhere in the UI (dropdown only shows names; description is read from JSON and displayed as plain text).
3. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/agents` lists commands for the selected agent and updates when switching agents.
   - Invalid commands appear disabled.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 16. Client UI: execute command button + server conflict messaging

- Task Status: **to_do**
- Git Commits:

#### Overview

Add the “Execute command” button, wire it to the new API, and ensure the UI handles concurrency conflicts (`RUN_IN_PROGRESS`) and persistence-unavailable constraints (Mongo down) without adding client-side locking.

#### Documentation Locations

- MUI Button API: MUI MCP `@mui/material@6.4.12` (disabled state + primary action styling for Execute)
- AbortController / AbortSignal: https://developer.mozilla.org/en-US/docs/Web/API/AbortController (the Execute run must be cancellable via the existing Abort mechanism)
- HTTP 409 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409 (server conflict surfaced as `RUN_IN_PROGRESS`)
- React hooks: https://react.dev/reference/react (state transitions around execute + refresh)

#### Subtasks

1. [ ] Add “Execute command” button + handler:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Calls `runAgentCommand({ agentName, commandName, conversationId, working_folder, signal })`.
     - Uses the existing AbortController and shares the same Abort button.
     - If persistence is unavailable (`mongoConnected === false` banner), disable Execute and show a short message explaining command runs require history loading to display step outputs.
   - UI sketch (keep it simple; disable conditions are the important part):
     ```tsx
     <Button
       variant="contained"
       disabled={!selectedCommandName || isRunning || persistenceUnavailable}
       onClick={handleExecuteCommand}
     >
       Execute command
     </Button>
     {persistenceUnavailable ? (
       <Typography variant="body2" color="text.secondary">
         Commands require conversation history (Mongo) to display multi-step results.
       </Typography>
     ) : null}
     ```
   - Reminder:
     - No client-side “global lock” in v1. Only disable Execute when *this* tab is running (`isRunning`) or Mongo is down; server enforces per-conversation locking and returns `RUN_IN_PROGRESS`.
2. [ ] Implement success flow that refreshes conversations + turns:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Gotcha: the Agents page only loads turns when `activeConversationId` exists in the sidebar `conversations` list (`knownConversationIds` gate). When a command run creates a new conversation, the UI must refresh the conversation list first so the new `conversationId` is recognized and turns can load.
     - On success (existing or new conversation):
       - Call `refreshConversations()` so the returned `conversationId` is present in the sidebar list.
       - Set `activeConversationId` to the returned `conversationId`.
       - Clear `messages` so the transcript renders from persisted turns (KISS; persisted turns do not include “segments” detail from live runs).
       - Call `refresh()` on `useConversationTurns` (or rely on the hook’s initial fetch after the id becomes eligible) to show the newly appended turns.
3. [ ] Surface `RUN_IN_PROGRESS` for command execution:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - When the API throws `status=409` and `code="RUN_IN_PROGRESS"`, show a friendly error bubble (do not disable the UI; just inform the user the conversation is already running).
   - Example user-facing message (copy this exact phrasing so tests can assert it):
     - “This conversation already has a run in progress in another tab/window. Please wait for it to finish or press Abort in the other tab.”
4. [ ] Surface `RUN_IN_PROGRESS` for normal agent instructions too:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - When `runAgentInstruction(...)` fails with `status=409` and `code="RUN_IN_PROGRESS"`, show the same friendly message as command runs.
     - This must work when a second browser window/tab tries to run against the same `conversationId`.
5. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Execute button runs a command and the transcript refreshes from persisted turns.
   - When a second browser window/tab tries to run against the same `conversationId`, the UI shows the `RUN_IN_PROGRESS` message.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 17. Client UI: render per-turn “Command run … (2/12)” metadata in bubbles

- Task Status: **to_do**
- Git Commits:

#### Overview

Render the per-turn `command` metadata inside chat bubbles so users can see which turns were produced by a command run and what step index they correspond to.

#### Documentation Locations

- MUI Typography API: MUI MCP `@mui/material@6.4.12` (how to render subtle “Command run … (2/12)” notes)
- React rendering basics: https://react.dev/reference/react (conditional rendering of metadata without disrupting markdown/tool UI)

#### Subtasks

1. [ ] Extend the turns → messages mapping to carry command metadata:
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/pages/AgentsPage.tsx`
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
2. [ ] Render the note inside both user and assistant bubbles:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - If `turn.command` exists, render a small note like `Command run: <name> (<stepIndex>/<totalSteps>)`.
     - Keep styling subtle; do not interfere with normal markdown/tool rendering.
   - UI sketch:
     ```tsx
     {turn.command ? (
       <Typography variant="caption" color="text.secondary">
         Command run: {turn.command.name} ({turn.command.stepIndex}/{turn.command.totalSteps})
       </Typography>
     ) : null}
     ```
3. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Running a command appends turns that include the “Command run … (2/12)” note.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 18. Client tests: commands list + run + disabled entries + conflict errors

- Task Status: **to_do**
- Git Commits:

#### Overview

Add focused client tests for the new Commands UI flow (listing, disabled entries, running, refresh behavior, and conflict error handling).

#### Documentation Locations

- Jest 30: Context7 `/websites/jestjs_io_30_0` (test runner and mocking conventions used in this repo)
- React Testing Library: Context7 `/websites/testing-library` (rendering AgentsPage and querying by role/text like a user)
- Testing Library user-event: Context7 `/testing-library/user-event` (simulating user clicks/types for dropdown + execute flows)
- React Router v7 (Memory router): Context7 `/remix-run/react-router/react-router_7.9.4` (tests use `createMemoryRouter` + `RouterProvider`)
- MUI components: MUI MCP `@mui/material@6.4.12` (dropdown/button rendering in tests)

#### Subtasks

1. [ ] Add test coverage for command listing UI:
   - Files to edit:
     - Add `client/src/test/agentsPage.commandsList.test.tsx`
   - Test requirements:
     - Agent change fetches new commands list.
     - Disabled commands are rendered disabled/unselectable.
   - Where to copy test patterns from:
     - `client/src/test/agentsPage.list.test.tsx` (agents list + dropdown interaction)
     - `client/src/test/agentsPage.description.test.tsx` (description rendering assertions)
2. [ ] Add test coverage for running a command + turns refresh:
   - Files to edit:
     - Add `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Test requirements:
     - Execute calls the run endpoint and triggers turns refresh.
   - Where to copy test patterns from:
     - `client/src/test/agentsPage.run.test.tsx` (send/stop flow + fetch mocking)
     - `client/src/test/agentsPage.turnHydration.test.tsx` (turn hydration from persisted turns)
3. [ ] Add test coverage for conflict messaging:
   - Files to edit:
     - Add `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
   - Test requirements:
     - When the API throws `status=409` + `code="RUN_IN_PROGRESS"`, the UI shows the friendly message for both normal agent run and command run.
   - Reminder:
     - These tests should validate both:
       - conflict from a command run attempt
       - conflict from a normal agent instruction attempt
     - because server locking is per-conversation and must protect multi-tab interactions.
4. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Not applicable (tests only); verify client unit tests pass.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 19. Docs: update `README.md` (Agent Commands overview + REST endpoints)

- Task Status: **to_do**
- Git Commits:

#### Overview

Document Agent Commands (where command files live and the REST API surface for listing and running).

#### Documentation Locations

- HTTP semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status

#### Subtasks

1. [ ] Update `README.md`:
   - Files to edit:
     - `README.md`
   - Requirements:
     - Document where commands live (`codex_agents/<agent>/commands/*.json`).
     - Document the two REST endpoints and their payloads.
2. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - N/A (docs); rely on prior tasks + final verification.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 20. Docs: update `design.md` (sequence diagram + cancellation + locking)

- Task Status: **to_do**
- Git Commits:

#### Overview

Add a Mermaid sequence diagram and document the cancellation + per-conversation locking semantics for Agent Commands.

#### Documentation Locations

- Mermaid syntax: Context7 `/mermaid-js/mermaid`
- MCP overview (terminology only): https://modelcontextprotocol.io/

#### Subtasks

1. [ ] Update `design.md` with diagrams:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid sequence diagram for command run (UI → REST → service → Codex).
     - Mention per-conversation lock + abort-based cancellation semantics.
2. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - N/A (docs); rely on prior tasks + final verification.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 21. Docs: update `projectStructure.md` (new files from Story 0000018)

- Task Status: **to_do**
- Git Commits:

#### Overview

Keep the project tree map up to date after introducing new command-related server/client files.

#### Documentation Locations

- None (file is repo-specific).

#### Subtasks

1. [ ] Update `projectStructure.md`:
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add new files created by this story and keep comments accurate.
2. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - N/A (docs); rely on prior tasks + final verification.
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)

---

### 22. Final verification + acceptance criteria validation

- Task Status: **to_do**
- Git Commits:

#### Overview

Run the full verification suite, confirm all acceptance criteria are met, and capture screenshots proving the UI command workflow works end-to-end.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs` (clean builds and compose up/down validation)
- Playwright: Context7 `/microsoft/playwright` (how screenshots/assertions work and where snapshots land)
- Jest 30: Context7 `/websites/jestjs_io_30_0` (repo unit test runner behavior for both front-end and back-end workspaces)
- Cucumber guide (quick feature/step conventions): https://cucumber.io/docs/guides/10-minute-tutorial/ (shared Cucumber vocabulary and structure)
- Cucumber guide (CI considerations): https://cucumber.io/docs/guides/continuous-integration/ (helps ensure Cucumber runs reliably in automation/CI)

#### Subtasks

1. [ ] Confirm acceptance criteria checklist against the implemented behavior:
   - File to read:
     - `planning/0000018-agent-commands.md`
2. [ ] Build the server:
   - `npm run build --workspace server`
3. [ ] Build the client:
   - `npm run build --workspace client`
4. [ ] Perform a clean docker build:
   - `npm run compose:build`
5. [ ] Start docker compose:
   - `npm run compose:up`
6. [ ] Run server tests:
   - `npm run test --workspace server`
7. [ ] Run client tests:
   - `npm run test --workspace client`
8. [ ] Run e2e tests:
   - `npm run e2e`
9. [ ] Manual Playwright-MCP check + screenshots:
   - Use Playwright MCP to capture screenshots under `test-results/screenshots/`:
     - `0000018-22-agents-commands-dropdown.png`
     - `0000018-22-agents-command-run-annotated-turns.png`
     - `0000018-22-agents-command-abort-stopped-turn.png`
10. [ ] Stop docker compose:
   - `npm run compose:down`
11. [ ] Ensure docs remain correct:
   - Verify `README.md`, `design.md`, `projectStructure.md` are updated and accurate.
12. [ ] Run repo-wide lint/format gate:
   - Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check (screenshots as above)
9. [ ] `npm run compose:down`

#### Implementation notes

- (empty)
