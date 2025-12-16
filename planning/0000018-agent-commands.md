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
- Command runs are cancellable by reusing the existing abort mechanism: the caller (Agents UI via REST, or an MCP client) aborts the in-flight HTTP request (AbortController) and the server aborts the provider call via an AbortSignal; the command runner must stop after the current step and never execute subsequent steps once aborted.
- Concurrency is blocked with an in-memory, per-server-process **per-conversation lock**: while a run is in progress for a given `conversationId`, the server rejects concurrent REST/MCP run requests targeting the same `conversationId` (including from multiple browser tabs/windows).
- The UI does not implement client-side locking in v1; it relies on server rejection and shows a clear error when a run is already in progress.

### Concurrency gotchas (must be handled)

- Same `conversationId` must never process two runs at the same time; otherwise turns and `threadId` updates can interleave and corrupt the conversation timeline.
- Command runs are multi-step: the conversation lock must be held for the entire command run (not per step), otherwise another run could slip in between steps and interleave turns.
- Cancellation uses the existing abort mechanism (closing/aborting the HTTP request); the command runner must check `signal.aborted` between steps and never start the next step after abort.
- Because v1 cancellation is “abort the in-flight request”, the caller may not receive a normal success response when the user cancels/disconnects. The cancellation outcome must therefore be visible via persisted turns (e.g. the “Stopped” assistant turn), which will appear when the UI refreshes/rehydrates the conversation.
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
   - Response: `{ commands: Array<{ name: string; description: string; disabled?: boolean }> }`
     - `disabled` is only used by REST to surface invalid command files in the UI as unselectable.

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

- Task Status: **completed**
- Git Commits: b92ed2b
#### Overview

Add a simple in-memory, per-server-process **per-conversation lock** that blocks concurrent agent runs and command runs targeting the same `conversationId`. Apply it consistently across Agents REST and Agents MCP, returning a stable `RUN_IN_PROGRESS` error (REST: HTTP 409).

Gotchas to keep in mind while implementing this task:

- This lock must reject concurrent runs for the same `conversationId` even when they come from different browser windows/tabs.
- Command runs are multi-step and must hold the conversation lock for the entire run (implemented in later tasks, but the lock helper must support this).
- Cancellation is abort-based; lock release must always happen in `finally`, including abort/error cases.
- Agents MCP runs are long-lived HTTP requests; if an MCP client aborts/disconnects while a run is in-flight, the server should propagate an AbortSignal to the shared service so the provider run can stop (v1 uses process-local locks and must not “leak” locks until completion).

#### Documentation Locations

- Node.js `AbortController` / `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller (how we stop in-flight runs when the client aborts/disconnects)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (repo unit tests use Node’s built-in test runner; needed for new lock tests)
- HTTP 409 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409 (REST conflict response for `RUN_IN_PROGRESS`)
- Express 5 routing/request lifecycle: Context7 `/expressjs/express` (how to attach `req.on('aborted')` / `res.on('close')` and build routers consistently)
- Zod v3 schema validation: Context7 `/websites/v3_zod_dev` (how `.safeParse()`/`.strict()` validation should be done for tool args/bodies)
- SuperTest (HTTP route testing): Context7 `/ladjs/supertest` (used by server unit tests to call Express routes and assert response shapes)
- JSON-RPC 2.0 error semantics: https://www.jsonrpc.org/specification (Agents MCP is JSON-RPC; needed to map service errors to stable JSON-RPC errors)
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid` (needed to update `design.md` diagrams when adding the per-conversation lock flow)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [x] Read existing abort / run plumbing patterns:
   - Docs to read:
     - https://nodejs.org/api/globals.html#class-abortcontroller
     - Context7 `/expressjs/express`
     - Note: there is no existing per-conversation lock for agents/chat; the only lock-like helper today is the **global ingest lock** in `server/src/ingest/lock.ts` (TTL-based, reject-not-queue). We are *not* reusing it here because it is global, not keyed by `conversationId`, and includes TTL semantics we don’t need for v1.
   - Files to read:
     - `server/src/routes/agentsRun.ts`
     - `server/src/mcpAgents/router.ts` (Agents MCP HTTP handler; needed to understand how to abort long-running tool calls)
     - `server/src/mcpAgents/tools.ts`
     - `server/src/agents/service.ts`
     - `server/src/agents/authSeed.ts` (contains an existing keyed in-memory lock helper; use it as a reference only)
     - Optional reference (do not reuse in this story): `server/src/ingest/lock.ts`
2. [x] Add a new per-conversation lock helper (in-memory, per-process):
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
3. [x] Extend the agents error union to include `RUN_IN_PROGRESS`:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `server/src/agents/service.ts`
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Add `RUN_IN_PROGRESS` to the internal error codes used by agents/commands runs.
     - Ensure the error shape is safe (no stack traces leaked).
4. [x] Apply the per-conversation lock in the shared agents service (covers REST + MCP automatically):
   - Docs to read:
     - Context7 `/expressjs/express`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
     - https://nodejs.org/api/globals.html#class-abortcontroller
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
5. [x] Map `RUN_IN_PROGRESS` in REST + MCP:
   - Docs to read:
     - Context7 `/expressjs/express`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
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
6. [x] Agents MCP: propagate AbortSignal into the shared agents service (cancel-on-disconnect):
   - Docs to read:
     - https://nodejs.org/api/globals.html#class-abortcontroller
     - https://nodejs.org/api/http.html#event-close (request/response lifecycle and when “close” fires)
   - Files to read:
     - `server/src/mcpAgents/router.ts`
     - `server/src/mcpAgents/tools.ts`
   - Files to edit:
     - `server/src/mcpAgents/router.ts`
     - `server/src/mcpAgents/tools.ts`
   - Requirements:
     - Create a per-request `AbortController` inside `handleAgentsRpc(...)`.
     - Abort it when the MCP HTTP connection closes before the JSON-RPC response is written:
       - `req.on('aborted', ...)` (existing repo pattern; note: Node marks it deprecated but it is already used in `server/src/routes/agentsRun.ts`)
       - `res.on('close', ...)` with the same `if (!res.writableEnded)` guard pattern used in `agentsRun.ts`.
     - Thread the resulting `AbortSignal` into the tool call path so `run_agent_instruction` (and later `run_command`) can pass it into `runAgentInstruction(...)` / `runAgentCommand(...)`.
       - KISS approach: extend `callTool(...)` in `server/src/mcpAgents/tools.ts` to accept an optional context `{ signal?: AbortSignal }`, and have `handleAgentsRpc` pass it only for `tools/call`.
     - Gotcha to document in code/comments/tests:
       - The MCP router reads the whole request body before dispatch; cancellation only matters once the long-running tool call begins.
7. [x] Server unit test (REST route): verify `RUN_IN_PROGRESS` maps to HTTP 409 on `/agents/:agentName/run`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-router-run.test.ts`
   - Purpose:
     - Ensures a second request targeting the same `conversationId` is rejected as a REST conflict.
     - Prevents multi-tab interleaving of turns for the same conversation.
   - What to implement:
     - Acquire the conversation lock for `conversationId='c1'` (using the new `server/src/agents/runLock.ts` helper), then `POST /agents/<agentName>/run` with body `{ instruction: 'hello', conversationId: 'c1' }`.
     - Assert: `status === 409` and body includes `{ error: 'conflict', code: 'RUN_IN_PROGRESS' }`.
     - Also add an “edge” assertion in the same file: lock `c1` must not block a run for `conversationId='c2'`.
8. [x] Server unit test (Agents MCP tool handler): verify tool returns a stable conflict error for `RUN_IN_PROGRESS`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-tools.test.ts`
   - Purpose:
     - Ensures MCP callers can detect conflict without string matching.
   - What to implement:
     - Force `callTool('run_agent_instruction', ...)` to hit a locked `conversationId` by acquiring the lock first.
     - Assert: the tool call throws the expected MCP error type/code for “run already in progress” (per Task 1 mapping rules).
9. [x] Server unit test (Agents MCP router): verify JSON-RPC response is stable for `RUN_IN_PROGRESS`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`, HTTP server)
   - Location: `server/src/test/unit/mcp-agents-router-run.test.ts`
   - Purpose:
     - Ensures MCP JSON-RPC callers receive a stable error envelope for conflict and can retry later.
   - What to implement:
     - Start `http.createServer(handleAgentsRpc)` (copy the harness pattern from the existing test in this file).
     - Acquire the lock for a known `conversationId` and send a JSON-RPC `tools/call` request to `run_agent_instruction` using that `conversationId`.
     - Assert: JSON-RPC response contains an error with the expected stable code/message (per Task 1 mapping rules).
10. [x] Server unit test (Agents MCP router): aborting the HTTP request aborts the tool call (signal propagation):
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/globals.html#class-abortcontroller
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`, HTTP server)
   - Location: `server/src/test/unit/mcp-agents-router-run.test.ts`
   - Purpose:
     - Ensures MCP callers can cancel a long-running run by aborting the HTTP request, and the server propagates the abort to the shared service.
   - What to implement:
     - Use `setToolDeps({ runAgentInstruction: async (params) => { ... } })` to provide a stub that:
       - captures `params.signal` (newly added) and asserts it is an AbortSignal
       - waits until `signal.aborted === true` (attach an `abort` event listener), then returns or throws
     - Start `http.createServer(handleAgentsRpc)` and issue a `fetch(..., { signal })` JSON-RPC `tools/call` request to `run_agent_instruction`.
     - Once the stub confirms it has started (use a Promise barrier), abort the client `fetch` and assert:
       - the stub observed `signal.aborted === true`
       - the server does not hang (test completes).
11. [x] Update `design.md` with lock/concurrency flow + Mermaid diagram:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - The per-conversation lock is a new architecture constraint; it must be documented where developers look for runtime behavior.
   - Required updates:
     - Add (or extend) a Mermaid sequence diagram that shows:
       - UI/REST or MCP caller attempts a run
       - Service acquires per-conversation lock
       - On second concurrent call: service rejects with `RUN_IN_PROGRESS` (REST 409 / MCP tool error)
     - Add a short bullet list explaining “lock scope = conversationId only” and “in-memory per process (no cross-instance coordination)”.
12. [x] Update `projectStructure.md` after adding any new files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Files to add/remove entries for (must list all files changed by this task):
     - Add: `server/src/agents/runLock.ts`
     - Remove: (none)
13. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Start an agent run from one browser window/tab.
   - Attempt a second run against the same conversation from another browser window/tab and confirm it fails with `RUN_IN_PROGRESS` and surfaces a clear error.
9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-16: Marked Task 1 in progress; reviewed existing abort + run patterns in REST + MCP and the shared agents service.
- 2025-12-16: Added `server/src/agents/runLock.ts` with a simple per-process Set-based lock keyed by `conversationId`.
- 2025-12-16: Added per-conversation lock acquisition in `server/src/agents/service.ts`, plus REST (HTTP 409) + MCP (JSON-RPC error 409) mappings for `RUN_IN_PROGRESS`, and threaded AbortSignal from Agents MCP HTTP disconnects into `runAgentInstruction(...)`.
- 2025-12-16: Updated `design.md` (per-conversation lock flow) and `projectStructure.md` (added `server/src/agents/runLock.ts`).
- 2025-12-16: Ran `npm run lint --workspaces` and `npm run format:check --workspaces` (fixed server formatting via `npm run format --workspace server`).
- 2025-12-16: Testing: `npm run build --workspace server` passed.
- 2025-12-16: Testing: `npm run build --workspace client` passed.
- 2025-12-16: Testing: `npm run test --workspace server` passed.
- 2025-12-16: Testing: `npm run test --workspace client` passed.
- 2025-12-16: Testing: `npm run e2e` passed.
- 2025-12-16: Testing: `npm run compose:build` passed.
- 2025-12-16: Testing: `npm run compose:up` passed.
- 2025-12-16: Testing: Manual MCP call via `POST http://host.docker.internal:5012` (`tools/call` name=`list_commands`) returned `{ agents: [{ agentName, commands: [...] }] }` and excluded invalid/disabled commands.
- 2025-12-16: Testing: `npm run compose:down` passed.
- 2025-12-16: Testing: `npm run build --workspace client` passed.
- 2025-12-16: Testing: `npm run test --workspace server` passed.
- 2025-12-16: Testing: `npm run test --workspace client` passed.
- 2025-12-16: Testing: `npm run e2e` passed.
- 2025-12-16: Testing: `npm run compose:build` passed.
- 2025-12-16: Testing: `npm run compose:up` passed.
- 2025-12-16: Testing: Verified `RUN_IN_PROGRESS` using two concurrent REST calls against `http://host.docker.internal:5010` (second call returned HTTP 409 with `{ error: "conflict", code: "RUN_IN_PROGRESS" }`).
- 2025-12-16: Testing: `npm run compose:down` passed.

---

### 2. Mongo: add per-turn `command` metadata (`{ name, stepIndex, totalSteps }`)

- Task Status: **completed**
- Git Commits: 1a9d5fc
#### Overview

Add an optional `command` field to persisted turns so the UI can render “Command run: <name> (2/12)” inside chat bubbles for both user and assistant turns created by command runs.

#### Documentation Locations

- Mongoose schemas + subdocuments: Context7 `/websites/mongoosejs` (how to add an optional nested object field to a schema without breaking existing documents)
- MongoDB document modeling: https://www.mongodb.com/docs/manual/core/data-modeling-introduction/ (why optional fields are safe and how schema evolution works)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests added in this task use Node’s built-in runner)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [x] Read current turn persistence types and schemas:
   - Docs to read:
     - Context7 `/websites/mongoosejs`
   - Files to read:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
2. [x] Extend the Turn model/schema to include `command`:
   - Docs to read:
     - Context7 `/websites/mongoosejs`
     - https://www.mongodb.com/docs/manual/core/data-modeling-introduction/
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `server/src/mongo/turn.ts`
   - Required field shape:
     - `command?: { name: string; stepIndex: number; totalSteps: number }`
   - Requirements:
     - Optional field (missing for normal turns).
     - Stored as a subdocument in Mongo.
3. [x] Plumb `command` through repository helpers:
   - Docs to read:
     - Context7 `/websites/mongoosejs`
     - https://www.mongodb.com/docs/manual/core/data-modeling-introduction/
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Requirements:
     - Extend `AppendTurnInput` and `TurnSummary` to include optional `command`.
     - Ensure `listTurns` includes the field in its returned JSON.
4. [x] Plumb `command` through chat persistence:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Requirements:
     - Allow passing `command` metadata via flags to `chat.run(...)` and persist it on both the user and assistant turns for that run.
     - Ensure the “Stopped” assistant turn created on abort also receives the same `command` metadata (this is required for cancelled in-flight command steps).
     - Keep default behavior unchanged when no `command` is provided.
5. [x] Server unit test update: ensure chat persistence tests compile with the new `turn.command` field:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`
   - Purpose:
     - This test is sensitive to the `AppendTurnInput`/`TurnSummary` shape; it must still compile once `command?: { name, stepIndex, totalSteps }` is added.
     - Ensures normal (non-command) runs still persist user/assistant turns as before.
   - What to update:
     - Only adjust types/fixtures as needed (do not change the test’s behavioral assertions unless the new field requires it).
6. [x] Server unit test update: ensure base chat interface tests compile with the new `turn.command` field:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/chat-interface-base.test.ts`
   - Purpose:
     - Confirms ChatInterface base behavior remains unchanged and the test suite remains green after adding optional metadata.
   - What to update:
     - Only adjust types/fixtures as needed.
7. [x] Server unit test (new): verify `command` metadata is persisted and returned by list APIs:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/turn-command-metadata.test.ts`
   - Purpose:
     - Proves that when `appendTurn` is called with `command`, Mongo persistence stores it and `listTurns` returns it.
     - Proves the field is optional and does not appear/break when omitted.
   - Test cases to implement:
     - “stores + returns command when provided”
     - “omitting command keeps existing behavior”
8. [x] Server unit test (new): `chat.run(...)` persists `command` on BOTH the user turn and assistant turn:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/chat-command-metadata.test.ts`
   - Purpose:
     - Ensures command runs can tag each “step” as normal chat turns and the UI can render metadata on both sides of the exchange.
   - What to implement:
     - Build a minimal ChatInterface subclass test harness (copy patterns from `server/src/test/unit/chat-interface-base.test.ts`) that uses memory persistence.
     - Call `chat.run('hello', { command: { name: 'improve_plan', stepIndex: 1, totalSteps: 3 } }, conversationId, modelId)`.
     - Assert the stored turns include `command` on both:
       - the `role: 'user'` turn
       - the `role: 'assistant'` turn
9. [x] Server unit test (new): aborted run persists a `stopped` assistant turn that still includes `command`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/globals.html#class-abortcontroller
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/chat-command-metadata.test.ts`
   - Purpose:
     - Ensures cancellation persistence requirements are met: the in-flight step produces a visible “Stopped” assistant turn and it must be tagged with the same `command` metadata.
   - What to implement:
     - Create an `AbortController` and pass `signal: controller.signal` via flags.
     - Abort before completion and assert:
       - assistant turn `status === 'stopped'`
       - assistant turn includes `command: { name, stepIndex, totalSteps }`.
10. [x] Update `projectStructure.md` after adding any new test files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Files to add/remove entries for (must list all files changed by this task):
     - Add:
       - `server/src/test/unit/chat-command-metadata.test.ts`
       - `server/src/test/unit/turn-command-metadata.test.ts`
     - Remove: (none)
11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Run an agent command (later tasks) and verify command bubbles show “2/12” style metadata.
9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-16: Reviewed Mongoose schema/subdocument docs and the existing turn persistence + ChatInterface persistence flow for where to attach optional per-turn metadata.
- 2025-12-16: Added optional per-turn `command` metadata to the Turn model/schema and plumbed it through `appendTurn` + `listTurns` so it round-trips from persistence to API payloads.
- 2025-12-16: Updated `ChatInterface.run(...)` to accept `flags.command` and persist it on both user + assistant turns (including the `stopped` assistant turn when an AbortSignal is triggered).
- 2025-12-16: Added server unit coverage for command metadata persistence (repo + chat) and updated `projectStructure.md` to include the new tests.
- 2025-12-16: Manual verification note: the Agents UI command runner isn’t implemented until later tasks, so the “2/12” bubble rendering can’t be verified end-to-end yet; instead we verified via the Turns REST API after extending `POST /conversations/:id/turns` validation to accept `command` for debugging.
- 2025-12-16: Validation: `npm run lint --workspaces`, `npm run format:check --workspaces`, `npm run build --workspace server`, `npm run build --workspace client`, `npm run test --workspace server`, `npm run test --workspace client`, `npm run e2e`, `npm run compose:build`, `npm run compose:up`, curl check against `http://host.docker.internal:5010`, then `npm run compose:down`.

---

### 3. Server: implement command JSON schema + validation helper (v1)

- Task Status: **completed**
- Git Commits: eda66d2

#### Overview

Define the command JSON schema (based on `improve_plan.json`) and implement validation that produces a safe summary for listing (including disabled entries with description “Invalid command file”).

#### Documentation Locations

- Zod v3 object schemas/unions: Context7 `/websites/v3_zod_dev` (for defining the v1 command schema and returning safe parse results)
- Node.js filesystem (`fs.promises.readFile`, `readdir`): https://nodejs.org/api/fs.html (for reading command files from disk)
- `JSON.parse(...)`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse (how JSON parse failures surface and must be handled)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests for schema parsing are written with Node’s test runner)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [x] Confirm the example command matches the intended schema:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `codex_agents/planning_agent/commands/improve_plan.json`
   - Requirements:
     - Top-level `Description` string.
     - `items[]` with `{ type: "message", role: "user", content: string[] }`.
2. [x] Create command schema + parser helper:
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
3. [x] Add a file-loader helper that returns a safe list summary:
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
4. [x] Server unit test: valid command JSON parses as `{ ok: true }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-schema.test.ts`
   - Purpose:
     - Confirms the v1 schema accepts the expected shape from `codex_agents/.../commands/*.json`.
   - What to implement:
     - Provide a JSON string with `Description` + `items: [{ type: 'message', role: 'user', content: ['x'] }]`.
     - Assert `parseAgentCommandFile(...)` returns `{ ok: true }`.
5. [x] Server unit test: invalid JSON returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-schema.test.ts`
   - Purpose:
     - Ensures file parse failures are handled safely and produce disabled command entries later.
   - What to implement:
     - Call `parseAgentCommandFile('{ not valid json')`.
     - Assert it returns `{ ok: false }`.
6. [x] Server unit test: missing `Description` returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-schema.test.ts`
   - Purpose:
     - Ensures schema validation rejects missing required fields (corner case that would otherwise crash listing or produce blank UI).
   - What to implement:
     - Provide syntactically valid JSON with `items` but no `Description`.
     - Assert it returns `{ ok: false }`.
7. [x] Server unit test: empty/whitespace `Description` returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-schema.test.ts`
   - Purpose:
     - Prevents confusing UX where a command appears with a blank description.
   - What to implement:
     - Provide JSON with `Description: "   "` and a valid `items` list.
     - Assert `{ ok: false }`.
8. [x] Server unit test: missing `items` returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-schema.test.ts`
   - Purpose:
     - Ensures the discriminated union schema does not accept partial/legacy shapes.
   - What to implement:
     - Provide JSON with only `Description`.
     - Assert `{ ok: false }`.
9. [x] Server unit test: empty `items: []` returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-schema.test.ts`
   - Purpose:
     - Ensures commands always have at least one executable step.
   - What to implement:
     - Provide JSON with `items: []`.
     - Assert `{ ok: false }`.
10. [x] Server unit test: unsupported `type` returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-schema.test.ts`
    - Purpose:
      - Enforces v1 “type: message only” rule so future types can be added safely without ambiguity.
    - What to implement:
      - Provide JSON with `{ type: 'other', role: 'user', content: ['x'] }`.
      - Assert `{ ok: false }`.
11. [x] Server unit test: unsupported `role` returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-schema.test.ts`
    - Purpose:
      - Enforces v1 “role: user only” rule (explicitly requested).
    - What to implement:
      - Provide JSON with `{ type: 'message', role: 'assistant', content: ['x'] }`.
      - Assert `{ ok: false }`.
12. [x] Server unit test: non-array `content` returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-schema.test.ts`
    - Purpose:
      - Prevents runtime crashes when command content is malformed.
    - What to implement:
      - Provide JSON with `content: 'not-an-array'`.
      - Assert `{ ok: false }`.
13. [x] Server unit test: empty `content: []` returns `{ ok: false }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-schema.test.ts`
    - Purpose:
      - Ensures each step produces a non-empty instruction.
    - What to implement:
      - Provide JSON with `content: []`.
      - Assert `{ ok: false }`.
14. [x] Server unit test: whitespace-only `content` entries are rejected after trimming:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-schema.test.ts`
    - Purpose:
      - Prevents “empty lines only” steps that would appear as blank user turns.
    - What to implement:
      - Provide JSON with `content: ['   ']`.
      - Assert `{ ok: false }`.
15. [x] Server unit test: unknown keys are rejected (`.strict()` behavior):
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-schema.test.ts`
    - Purpose:
      - Ensures schema is extendable via explicit future changes, not by silently accepting typos.
    - What to implement:
      - Provide JSON with an extra top-level field like `{ Description, items, extra: true }`.
      - Assert `{ ok: false }`.
16. [x] Server unit test: trimming behavior produces a clean `command` object:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-schema.test.ts`
    - Purpose:
      - Guarantees execution joins clean strings and avoids leading/trailing whitespace bugs.
    - What to implement:
      - Provide JSON where `content: ['  first  ', ' second ']`.
      - Assert `parseAgentCommandFile(...)` returns `{ ok: true }` and the parsed command contains `content: ['first', 'second']`.
17. [x] Server unit test: `loadAgentCommandSummary(...)` returns enabled summary for valid command file:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-loader.test.ts`
    - Purpose:
      - Ensures the listing UX uses the command file’s Description and marks valid commands enabled.
    - What to implement:
      - Write a temp `*.json` file containing a valid command.
      - Call `loadAgentCommandSummary({ filePath, name })` and assert `{ disabled: false, description: <Description> }`.
18. [x] Server unit test: `loadAgentCommandSummary(...)` returns disabled summary when schema invalid:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-loader.test.ts`
    - Purpose:
      - Ensures invalid-but-parseable JSON becomes “Invalid command file” (disabled) for REST listing.
    - What to implement:
      - Write a temp `*.json` file containing syntactically valid JSON that violates schema (e.g. `items: []`).
      - Assert summary is `{ disabled: true, description: 'Invalid command file' }`.
19. [x] Server unit test: `loadAgentCommandSummary(...)` returns disabled summary when file read fails:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-loader.test.ts`
    - Purpose:
      - Covers the “file missing / IO error” corner case deterministically (no chmod tricks).
    - What to implement:
      - Call `loadAgentCommandSummary({ filePath: '/does/not/exist.json', name: 'missing' })`.
      - Assert it returns `{ name: 'missing', disabled: true, description: 'Invalid command file' }`.
20. [x] Update `projectStructure.md` after adding new server files/tests:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Files to add/remove entries for (must list all files changed by this task):
       - Add:
         - `server/src/agents/commandsLoader.ts`
         - `server/src/agents/commandsSchema.ts`
         - `server/src/test/unit/agent-commands-loader.test.ts`
         - `server/src/test/unit/agent-commands-schema.test.ts`
       - Remove: (none)
21. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Regression smoke check (no UI feature yet for this task):
     - Open `/agents` and confirm the page loads without errors.
     - Select an agent and run a simple instruction; confirm a response is persisted and shown.
     - Open `/chat` and confirm the page loads and can send a message (baseline regression).
9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-16: Marked Task 3 in progress and confirmed `codex_agents/planning_agent/commands/improve_plan.json` matches the intended v1 schema shape.
- 2025-12-16: Added `server/src/agents/commandsSchema.ts` with a strict Zod v1 schema and a safe `parseAgentCommandFile(...)` that trims and rejects empty/whitespace-only content.
- 2025-12-16: Added `server/src/agents/commandsLoader.ts` to read command files and produce a safe `{ name, description, disabled }` summary (invalid/missing files return “Invalid command file”).
- 2025-12-16: Added `server/src/test/unit/agent-commands-schema.test.ts` coverage for the happy-path v1 schema parse.
- 2025-12-16: Added unit coverage for JSON parse failures returning `{ ok: false }`.
- 2025-12-16: Added unit coverage for missing `Description` being rejected by the schema.
- 2025-12-16: Added unit coverage for whitespace-only `Description` being rejected after trimming.
- 2025-12-16: Added unit coverage for missing `items` being rejected.
- 2025-12-16: Added unit coverage for `items: []` being rejected.
- 2025-12-16: Added unit coverage for the v1 `type: message` enforcement.
- 2025-12-16: Added unit coverage for the v1 `role: user` enforcement.
- 2025-12-16: Added unit coverage for rejecting malformed `content` (must be a string array).
- 2025-12-16: Added unit coverage for rejecting empty `content: []`.
- 2025-12-16: Added unit coverage for trimming + rejecting whitespace-only content entries.
- 2025-12-16: Added unit coverage for `.strict()` behavior (unknown keys rejected).
- 2025-12-16: Added unit coverage ensuring the parsed command content is trimmed and returned in a clean normalized shape.
- 2025-12-16: Added `server/src/test/unit/agent-commands-loader.test.ts` coverage for `loadAgentCommandSummary(...)` happy-path enabled summaries.
- 2025-12-16: Added unit coverage for schema-invalid command files being surfaced as disabled “Invalid command file”.
- 2025-12-16: Added unit coverage for missing/IO-error command files returning disabled summaries (no throw).
- 2025-12-16: Updated `projectStructure.md` to include the new agent command schema/loader files and unit tests.
- 2025-12-16: Validation: `npm run lint --workspaces` and `npm run format:check --workspaces` passed.
- 2025-12-16: Testing: `npm run build --workspace server` passed.
- 2025-12-16: Testing: `npm run build --workspace client` passed.
- 2025-12-16: Testing: `npm run test --workspace server` passed.
- 2025-12-16: Testing: `npm run test --workspace client` passed.
- 2025-12-16: Testing: `npm run e2e` passed.
- 2025-12-16: Testing: `npm run compose:build` passed.
- 2025-12-16: Testing: `npm run compose:up` passed.
- 2025-12-16: Testing: Manual regression smoke via `http://host.docker.internal:5001/agents` + `/chat` (HTTP 200) and `POST http://host.docker.internal:5010/agents/coding_agent/run` succeeded (conversation persisted and `/conversations/:id/turns` returned turns).
- 2025-12-16: Testing: `npm run compose:down` passed.

---

### 4. Server: list agent commands (shared service)

- Task Status: **completed**
- Git Commits: 0ab4bee

#### Overview

Implement a shared server function that discovers command JSON files for an agent and returns their `{ name, description, disabled }` summaries (no REST/MCP wiring yet).

#### Documentation Locations

- Node.js filesystem directory listing (`fs.readdir`): https://nodejs.org/api/fs.html#fspromisesreaddirpath-options (to enumerate `commands/*.json` with no caching)
- Node.js path utilities: https://nodejs.org/api/path.html (safe basename handling and cross-platform joins)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests for directory listing behavior use Node’s runner)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [x] Read existing agent discovery shape (to locate agent home folders):
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `server/src/agents/discovery.ts`
     - `server/src/agents/service.ts`
2. [x] Add a new shared function to list commands for an agent:
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
3. [x] Server unit test: missing `commands/` folder returns empty list:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-list.test.ts`
   - Purpose:
     - Confirms listing is safe when an agent has no commands folder yet.
   - What to implement:
     - Call `listAgentCommands({ agentName })` for a discovered agent without a `commands/` directory.
     - Assert response is `{ commands: [] }`.
4. [x] Server unit test: valid command JSON appears as enabled entry:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-list.test.ts`
   - Purpose:
     - Confirms a normal, valid command file is surfaced to the UI as selectable.
   - What to implement:
     - Create `commands/improve_plan.json` under a temporary agent folder for the test (valid JSON matching schema).
     - Assert it is returned with:
       - `name === 'improve_plan'`
       - `disabled === false`
       - `description` equals the JSON `Description`.
5. [x] Server unit test: invalid command JSON (syntax) appears as disabled entry:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-list.test.ts`
   - Purpose:
     - Ensures invalid JSON does not crash listing and is surfaced as `disabled: true` with “Invalid command file”.
   - What to implement:
     - Create a `commands/bad.json` fixture (invalid JSON) under a temporary agent folder for the test.
     - Assert it is returned with `disabled: true` and `description === 'Invalid command file'`.
6. [x] Server unit test: invalid command JSON (schema) appears as disabled entry:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-list.test.ts`
   - Purpose:
     - Ensures “valid JSON but wrong shape” is treated as invalid and does not crash listing.
   - What to implement:
     - Create a `commands/bad-schema.json` fixture containing syntactically valid JSON that violates schema (e.g. `items: []`).
     - Assert it is returned with `disabled: true` and `description === 'Invalid command file'`.
7. [x] Server unit test: non-JSON files are ignored:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-list.test.ts`
   - Purpose:
     - Ensures only `*.json` files are treated as commands.
   - What to implement:
     - Create `commands/README.md` and `commands/notes.txt` in the temp agent folder.
     - Assert they are not returned in the commands list.
8. [x] Server unit test: results are sorted by `name` for deterministic UI ordering:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-list.test.ts`
   - Purpose:
     - Prevents UI dropdown ordering from changing between runs/OSes.
   - What to implement:
     - Create two valid command files `z.json` and `a.json`.
     - Assert the returned `commands` array is ordered `a` then `z`.
9. [x] Server unit test: “no caching” behavior (list reflects new files on the next call):
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-list.test.ts`
   - Purpose:
     - Confirms the requirement “commands list refreshed every time it is requested”.
   - What to implement:
     - Call `listAgentCommands(...)` once and assert only command `a` is present.
     - Create a new valid command file `b.json` after the first call.
     - Call `listAgentCommands(...)` again and assert both `a` and `b` are present.
10. [x] Server unit test: unknown agentName throws `{ code: 'AGENT_NOT_FOUND' }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-list.test.ts`
    - Purpose:
      - Ensures REST/MCP can map unknown agents to stable “not found” errors.
    - What to implement:
      - Call `listAgentCommands({ agentName: 'does-not-exist' })`.
      - Assert it throws `{ code: 'AGENT_NOT_FOUND' }`.
11. [x] Update `projectStructure.md` after adding any new test files:
   - Docs to read:
     - https://github.github.com/gfm/
    - Files to edit:
      - `projectStructure.md`
    - Files to add/remove entries for (must list all files changed by this task):
      - Add: `server/src/test/unit/agent-commands-list.test.ts`
      - Remove: (none)
12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Regression smoke check (service-only task; REST/UI wiring not added yet):
     - Open `/agents` and confirm the page loads without errors.
     - Select an agent and run a simple instruction; confirm a response is persisted and shown.
     - Open `/chat` and confirm the page loads and can send a message (baseline regression).
9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-16: Marked Task 4 in progress; reviewed existing agent discovery (`discoverAgents`) and shared agents service patterns to align command listing with existing agent-home resolution.
- 2025-12-16: Added `listAgentCommands(...)` to the shared agents service; it discovers the agent via `discoverAgents()`, returns `[]` when `commands/` is missing, filters to `*.json`, uses the Task 3 loader to compute `description/disabled`, and sorts results by name for deterministic UI ordering.
- 2025-12-16: Added `server/src/test/unit/agent-commands-list.test.ts` covering missing `commands/`, valid/invalid (syntax and schema) command files, ignoring non-JSON entries, deterministic sorting, no-caching behavior, and unknown-agent errors.
- 2025-12-16: Updated `projectStructure.md` to include `server/src/test/unit/agent-commands-list.test.ts`.
- 2025-12-16: Validation: `npm run lint --workspaces` passed; `npm run format:check --workspaces` passed (fixed formatting via `npm run format --workspace server`).
- 2025-12-16: Testing: `npm run build --workspace server` passed.
- 2025-12-16: Testing: `npm run build --workspace server` passed.
- 2025-12-16: Testing: `npm run build --workspace client` passed.
- 2025-12-16: Testing: `npm run test --workspace server` passed.
- 2025-12-16: Testing: `npm run test --workspace client` passed.
- 2025-12-16: Testing: `npm run e2e` passed.
- 2025-12-16: Testing: `npm run compose:build` passed.
- 2025-12-16: Testing: `npm run compose:up` passed.
- 2025-12-16: Testing: Manual regression smoke via `http://host.docker.internal:5001/agents` + `/chat` (HTTP 200) and `POST http://host.docker.internal:5010/agents/coding_agent/run` succeeded (conversation persisted and `/conversations/:id/turns` returned turns).
- 2025-12-16: Testing: `npm run compose:down` passed.

---

### 5. REST: `GET /agents/:agentName/commands`

- Task Status: **completed**
- Git Commits: 2e9f02a, fd1d268

#### Overview

Expose command listing to the GUI via REST using the shared list function. The response must include disabled invalid entries so the UI can show them as unselectable.

#### Documentation Locations

- Express 5 routing: Context7 `/expressjs/express` (how to add a new GET route and wire it into the app)
- HTTP 404 semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404 (REST behavior for unknown `agentName`)
- SuperTest (HTTP route testing): Context7 `/ladjs/supertest` (used to unit test the new REST route)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (server unit tests use Node’s runner)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [x] Create a new router for agent commands:
   - Docs to read:
     - Context7 `/expressjs/express`
   - Files to edit:
     - Create `server/src/routes/agentsCommands.ts`
   - Requirements:
     - Add `GET /agents/:agentName/commands`.
     - Use `listAgentCommands({ agentName })`.
     - If agent not found → 404 `{ error: 'not_found' }`.
2. [x] Wire the new router into server startup:
   - Docs to read:
     - Context7 `/expressjs/express`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Files to read:
     - `server/src/index.ts`
   - Files to edit:
     - `server/src/index.ts`
   - Requirements:
     - The new routes must be reachable at:
       - `GET /agents/:agentName/commands`
       - `POST /agents/:agentName/commands/run` (added in Task 9; wiring done here should not block adding the POST later).
     - Keep wiring consistent with the existing Agents routes:
       - Ensure `express.json()` (or equivalent) is registered before the router so the POST body can be read in Task 9.
       - Prefer the same dependency-injection style used elsewhere in `server/src/index.ts` (so unit tests can build minimal apps by importing the router factory directly).
     - Implementation sketch (adapt to the existing structure in `server/src/index.ts`):
     ```ts
     // server/src/index.ts
     import { createAgentsCommandsRouter } from './routes/agentsCommands';
     import { listAgentCommands, runAgentCommand } from './agents/service';

     app.use('/agents', createAgentsCommandsRouter({ listAgentCommands, runAgentCommand }));
     ```
3. [x] Server unit test (REST): valid agent returns `{ commands: [...] }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-list.test.ts`
   - Purpose:
     - Confirms the REST endpoint returns a stable payload shape the UI can consume.
   - What to implement:
     - Stub `listAgentCommands(...)` to return a non-empty list.
     - `GET /agents/:agentName/commands` and assert `status === 200` and `body.commands` is an array.
4. [x] Server unit test (REST): invalid command appears disabled in REST response:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-list.test.ts`
   - Purpose:
     - Ensures invalid command files are visible but unselectable in the UI (disabled entries UX).
   - What to implement:
     - Stub `listAgentCommands(...)` to include `{ name: 'bad', description: 'Invalid command file', disabled: true }`.
     - Assert response includes that entry and `disabled === true`.
5. [x] Server unit test (REST): unknown `agentName` returns HTTP 404 `{ error: 'not_found' }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-list.test.ts`
   - Purpose:
     - Ensures the UI can distinguish “no such agent” from “agent has no commands”.
   - What to implement:
     - Stub `listAgentCommands(...)` to throw `{ code: 'AGENT_NOT_FOUND' }`.
     - Assert `status === 404` and body is `{ error: 'not_found' }`.
6. [x] Server unit test (REST): agent with no commands returns `{ commands: [] }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-list.test.ts`
   - Purpose:
     - Confirms the route returns a consistent payload shape even when empty.
   - What to implement:
     - Stub `listAgentCommands(...)` to return `{ commands: [] }`.
     - Assert `status === 200` and `body.commands` is an empty array.
7. [x] Update `projectStructure.md` after adding any new files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Files to add/remove entries for (must list all files changed by this task):
     - Add:
       - `server/src/routes/agentsCommands.ts`
       - `server/src/test/unit/agents-commands-router-list.test.ts`
     - Remove: (none)
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - On `/agents`, changing agents refreshes command list (after UI work).
9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-16: Added `server/src/routes/agentsCommands.ts` exposing `GET /agents/:agentName/commands` (mounted under `/agents`) and mapped `AGENT_NOT_FOUND` to HTTP 404 `{ error: 'not_found' }`.
- 2025-12-16: Wired `createAgentsCommandsRouter()` into `server/src/index.ts` via `app.use('/agents', ...)` so Task 9 can add the `POST /:agentName/commands/run` endpoint without changing mount points.
- 2025-12-16: Added `server/src/test/unit/agents-commands-router-list.test.ts` covering success shape, disabled entries, unknown agent 404 mapping, and empty list behavior.
- 2025-12-16: Updated `projectStructure.md` for the new route + unit test.
- 2025-12-16: Validation: `npm run lint --workspaces` passed; `npm run format:check --workspaces` passed (after running `npm run format --workspace server`).
- 2025-12-16: Testing: `npm run build --workspace server` passed (fixed a unit-test stub type to satisfy TS build).
- 2025-12-16: Testing: `npm run build --workspace client` passed.
- 2025-12-16: Testing: `npm run test --workspace server` passed.
- 2025-12-16: Testing: `npm run test --workspace client` passed.
- 2025-12-16: Testing: `npm run e2e` passed.
- 2025-12-16: Testing: `npm run compose:build` passed.
- 2025-12-16: Testing: `npm run compose:up` passed.
- 2025-12-16: Manual check: confirmed REST payloads via `http://host.docker.internal:5010/agents` and `http://host.docker.internal:5010/agents/planning_agent/commands` (HTTP 200). Captured `/agents` screenshot using Playwright at `test-results/screenshots/0000018-5-agents.png`.
- 2025-12-16: Testing: `npm run compose:down` passed.

---

### 6. Agents MCP: add `list_commands` tool

- Task Status: **completed**
- Git Commits:

#### Overview

Expose command listing via Agents MCP `5012`. `list_commands` must return all agents (when agentName omitted) but list only valid commands (exclude disabled/invalid).

#### Documentation Locations

- JSON-RPC 2.0 errors: https://www.jsonrpc.org/specification (Agents MCP is JSON-RPC; `list_commands` must return stable error codes/messages)
- Zod v3 parsing: Context7 `/websites/v3_zod_dev` (how MCP tool args should be validated with `.safeParse()` and `.strict()` objects)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (unit tests for the MCP tool use Node’s runner)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [x] Read existing Agents MCP tool patterns:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `server/src/mcpAgents/tools.ts`
     - `server/src/mcpAgents/router.ts`
2. [x] Add tool definition + handler:
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
3. [x] Server unit test (Agents MCP tool): omitting `agentName` returns all agents and valid commands only:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-list.test.ts`
   - Purpose:
     - Confirms MCP listing is “all agents” by default and excludes invalid commands (disabled entries are REST-only).
   - What to implement:
     - Stub `listAgents()` and `listAgentCommands()` so one agent has a valid command and another has an invalid/disabled command.
     - Call `callTool('list_commands', {})` and assert:
       - output includes all agents
       - invalid/disabled commands are not included in MCP output.
4. [x] Server unit test (Agents MCP tool): unknown `agentName` returns a stable tool error:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-list.test.ts`
   - Purpose:
     - Ensures MCP callers get an explicit error instead of a silent empty list when an agent is unknown.
   - What to implement:
     - Call `callTool('list_commands', { agentName: 'does-not-exist' })`.
     - Assert the tool throws the expected “invalid params / not found” tool error (per Task 6 requirements).
5. [x] Server unit test (Agents MCP tool): `agentName` provided with no commands returns `{ commands: [] }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-list.test.ts`
   - Purpose:
     - Confirms behavior differs from “unknown agent”: an existing agent can legitimately have zero commands.
   - What to implement:
     - Stub `listAgents()` to include `planning_agent`.
     - Stub `listAgentCommands({ agentName: 'planning_agent' })` to return `{ commands: [] }`.
     - Call `callTool('list_commands', { agentName: 'planning_agent' })` and assert JSON result contains `commands: []`.
6. [x] Server unit test (Agents MCP tool): invalid params are rejected (empty `agentName`):
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-list.test.ts`
   - Purpose:
     - Ensures Zod schema validation is strict and avoids ambiguous behavior.
   - What to implement:
     - Call `callTool('list_commands', { agentName: '' })`.
     - Assert it throws an invalid-params style tool error.
7. [x] Update existing MCP tools/list expectation test:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Files to edit:
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Requirements:
     - Update the expected tool names to include `list_commands` (while `run_command` is not yet implemented in this task).
8. [x] Update `projectStructure.md` after adding any new test files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Files to add/remove entries for (must list all files changed by this task):
     - Add: `server/src/test/unit/mcp-agents-commands-list.test.ts`
     - Remove: (none)
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - Use an MCP client to call `list_commands` and verify output shape.
9. [x] `npm run compose:down`

#### Implementation notes

- 2025-12-16: Marked Task 6 in progress; reviewed existing Agents MCP tool patterns in `server/src/mcpAgents/tools.ts` and `server/src/mcpAgents/router.ts` to match JSON-RPC mapping, strict Zod validation, and test stubbing approach.
- 2025-12-16: Implemented MCP tool `list_commands` in `server/src/mcpAgents/tools.ts`, including strict Zod validation, a single-agent response shape, and an all-agents default that filters out disabled/invalid commands.
- 2025-12-16: Added `server/src/test/unit/mcp-agents-commands-list.test.ts` covering list_commands all-agents default, disabled-command filtering, unknown-agent errors, empty-command lists, and strict Zod validation.
- 2025-12-16: Updated `server/src/test/unit/mcp-agents-router-list.test.ts` to expect the new MCP tool in the tools/list output.
- 2025-12-16: Updated `projectStructure.md` to include `server/src/test/unit/mcp-agents-commands-list.test.ts` and refreshed MCP tool/test descriptions.
- 2025-12-16: Validation: `npm run lint --workspaces` passed; `npm run format:check --workspaces` initially failed for server files and was fixed via `npm run format --workspace server` before re-running `npm run format:check --workspaces` successfully.

---

### 7. Server: refactor agent execution into locked wrapper + unlocked internal helper

- Task Status: **to_do**
- Git Commits:

#### Overview

Refactor agents execution so the per-conversation lock can be acquired once for a command run while still calling the same core “run one instruction” logic for each step without deadlocking.

#### Documentation Locations

- `try { } finally { }` (async/await safety): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch (why lock release must happen in `finally` even when aborted)
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html (this refactor updates unit tests written with Node’s runner)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Read current `runAgentInstruction` implementation:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `server/src/agents/service.ts`
2. [ ] Extract an internal helper that runs a single instruction without acquiring the per-conversation lock:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `server/src/agents/service.ts`
   - Requirements:
     - Keep the exported `runAgentInstruction(...)` signature stable for existing callers.
     - Keep the locking behavior implemented in Task 1 (do not add a second lock layer here).
     - The internal helper must NOT acquire the per-conversation lock; it is used by the multi-step command runner (Task 8) which holds the lock for the entire command run.
     - Internal helper should accept an additional optional `command` metadata object (for later tasks) and pass it to `chat.run(...)`.
3. [ ] Server unit test update (REST): confirm `/agents/:agentName/run` behavior is unchanged after refactor:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-router-run.test.ts`
   - Purpose:
     - Confirms the REST route still forwards `instruction`, `conversationId`, and `working_folder` correctly after introducing an unlocked internal helper.
   - What to update:
     - If the refactor changes the dependency injection shape, update the `buildApp()` wiring in this test file.
     - Keep existing assertions; only update mocks/types as required.
4. [ ] Server unit test update (Agents MCP): confirm `run_agent_instruction` tool behavior is unchanged after refactor:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-tools.test.ts`
   - Purpose:
     - Confirms tool arg validation and error mapping still work once the service is refactored internally.
   - What to update:
     - Keep existing behavioral assertions; only update mocks/types as required.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid` (needed to update `design.md` with the command-run sequence diagram and abort/lock notes)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Add a command loader that returns the full parsed command (not just summary):
   - Docs to read:
     - Context7 `/websites/mongoosejs`
     - https://www.mongodb.com/docs/manual/core/data-modeling-introduction/
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
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
3. [ ] Server unit test: multi-step command executes all steps sequentially:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-runner.test.ts`
   - Purpose:
     - Proves the command runner executes steps in order and tags each step with correct `{ stepIndex, totalSteps }`.
   - What to implement:
     - Use a 3-item command fixture.
     - Stub the unlocked internal helper and assert it is called 3 times with:
       - `stepIndex` = 1, 2, 3
       - `totalSteps` = 3
4. [ ] Server unit test: abort after step 1 prevents steps 2+ from running:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/globals.html#class-abortcontroller
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-runner.test.ts`
   - Purpose:
     - Ensures cancellation is respected between steps and later steps never start after abort.
   - What to implement:
     - Use an `AbortController`; after first step completes, call `controller.abort()`.
     - Assert the helper is not called for step 2/3.
5. [ ] Server unit test: per-conversation lock blocks concurrent run during command execution:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-runner.test.ts`
   - Purpose:
     - Ensures the command runner holds the lock for the entire run, preventing interleaving runs.
   - What to implement:
     - Start a command run that holds the lock (e.g. a helper that awaits a promise).
     - While it is in-flight, attempt a second run against the same `conversationId`.
     - Assert the second run fails with `{ code: 'RUN_IN_PROGRESS' }`.
6. [ ] Server unit test: `instruction` passed to each step equals `content.join('\\n')` (with trimmed content):
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-runner.test.ts`
   - Purpose:
     - Confirms the runner executes exactly what the JSON defines (no accidental extra whitespace, no missing newlines).
   - What to implement:
     - Use a command item with `content: ['  first  ', 'second ']`.
     - Assert the unlocked helper receives `instruction === 'first\\nsecond'`.
7. [ ] Server unit test: `working_folder` is forwarded to the unlocked helper for every step:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-runner.test.ts`
   - Purpose:
     - Ensures the command runner behaves the same as normal agent runs regarding working folder overrides.
   - What to implement:
     - Call `runAgentCommand({ ..., working_folder: '/abs/path' })` and assert every unlocked-helper call receives `working_folder: '/abs/path'`.
8. [ ] Server unit test: when `conversationId` is omitted, a new id is generated and reused for all steps:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-runner.test.ts`
   - Purpose:
     - Ensures the command run can start a brand-new conversation and all steps append to the same conversation.
   - What to implement:
     - Call `runAgentCommand({ agentName, commandName, source: 'REST' })` without `conversationId`.
     - Assert the unlocked helper is called with the same `conversationId` for every step and the returned result uses that same id.
9. [ ] Server unit test: when `conversationId` is provided, it is reused and returned unchanged:
   - Docs to read:
     - https://nodejs.org/api/test.html
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/agent-commands-runner.test.ts`
   - Purpose:
     - Prevents accidental new-conversation creation when the user intends to run a command in an existing chat.
   - What to implement:
     - Call `runAgentCommand({ ..., conversationId: 'c1' })` and assert the result returns `conversationId === 'c1'`.
10. [ ] Server unit test: invalid `commandName` values are rejected with `{ code: 'COMMAND_INVALID' }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-runner.test.ts`
    - Purpose:
      - Prevents path traversal and keeps v1 naming contract (filename basename only).
    - What to implement:
      - Attempt `runAgentCommand` with `commandName: '../bad'`, `commandName: 'a/b'`, and `commandName: 'a\\\\b'`.
      - Assert each throws `{ code: 'COMMAND_INVALID' }`.
11. [ ] Server unit test: missing command file throws `{ code: 'COMMAND_NOT_FOUND' }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-runner.test.ts`
    - Purpose:
      - Ensures REST/MCP can map “command not found” to a stable 404-style error.
    - What to implement:
      - Ensure no matching `commands/<commandName>.json` exists for the discovered agent.
      - Assert `runAgentCommand(...)` throws `{ code: 'COMMAND_NOT_FOUND' }`.
12. [ ] Server unit test: invalid command file throws `{ code: 'COMMAND_INVALID' }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-runner.test.ts`
    - Purpose:
      - Ensures malformed command files fail safely and do not partially execute.
    - What to implement:
      - Create an invalid command JSON file (syntax or schema invalid).
      - Assert `runAgentCommand(...)` throws `{ code: 'COMMAND_INVALID' }` and the unlocked helper is never called.
13. [ ] Server unit test: step failure stops execution and releases the lock:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-runner.test.ts`
    - Purpose:
      - Ensures we do not execute later steps after a failure, and we don’t leak locks on thrown errors.
    - What to implement:
      - Stub the unlocked helper so step 2 throws an error.
      - Assert step 3 is never executed.
      - After the call rejects, start a second run for the same `conversationId` and assert it can acquire the lock (i.e., does not fail with `RUN_IN_PROGRESS`).
14. [ ] Server unit test: lock is per-conversation and does not block other conversations:
   - Docs to read:
     - https://nodejs.org/api/test.html
    - Test type: server unit (Node `node:test`)
    - Location: `server/src/test/unit/agent-commands-runner.test.ts`
    - Purpose:
      - Confirms the user requirement that different chats can run concurrently.
    - What to implement:
      - Start a command run for `conversationId='c1'` that blocks on a Promise barrier.
      - Start a second command run for `conversationId='c2'` and assert it proceeds (does not throw `RUN_IN_PROGRESS`).
15. [ ] Update `projectStructure.md` after adding any new files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Files to add/remove entries for (must list all files changed by this task):
     - Add:
       - `server/src/agents/commandsRunner.ts`
       - `server/src/test/unit/agent-commands-runner.test.ts`
     - Remove: (none)
16. [ ] Update `design.md` with the command-run flow + Mermaid sequence diagram:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - This task introduces the core “Agent Command” execution flow (multi-step runner + abort stop). It must be documented as a sequence diagram so future developers understand step ordering and cancellation semantics.
   - Required diagram content:
     - Actors: `Client(UI or MCP)`, `Server(REST/MCP)`, `AgentsService`, `Codex`.
     - Steps: `load command JSON` → `acquire conversation lock` → `step loop` → `abort check between steps` → `release lock`.
     - Note: clarify that on abort mid-step, the assistant turn is persisted as `Stopped` and tagged with `turn.command`.
17. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Regression smoke check (runner exists but is not wired to UI/REST yet):
     - Open `/agents` and confirm the page loads without errors.
     - Run a normal agent instruction and confirm the conversation/turns still persist correctly (baseline regression for locking/cancellation work from earlier tasks).
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
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid` (needed to update `design.md` when adding the new REST command-run endpoint flow)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

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
   - Docs to read:
     - Context7 `/expressjs/express`
     - https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
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
3. [ ] Server unit test (REST): valid command run returns `{ agentName, commandName, conversationId, modelId }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
   - Purpose:
     - Ensures the UI can rely on the minimal response shape and re-fetch turns.
   - What to implement:
     - Stub `runAgentCommand(...)` to return a stable payload.
     - `POST /agents/:agentName/commands/run` with `{ commandName: 'improve_plan' }` and assert the JSON shape.
4. [ ] Server unit test (REST): `RUN_IN_PROGRESS` returns HTTP 409 with stable body:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
   - Purpose:
     - Ensures multi-tab safety: server rejects concurrent runs against the same conversation.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'RUN_IN_PROGRESS' }`.
     - Assert `status === 409` and body includes `{ error: 'conflict', code: 'RUN_IN_PROGRESS' }`.
5. [ ] Server unit test (REST): invalid `commandName` returns HTTP 400 with `COMMAND_INVALID`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
   - Purpose:
     - Prevents path traversal / invalid command execution attempts.
   - What to implement:
     - Send `{ commandName: '../bad' }` or `{ commandName: 'a/b' }` and assert:
       - `status === 400`
       - body includes `{ error: 'invalid_request', code: 'COMMAND_INVALID' }`.
   - Reference test harness:
     - Copy the SuperTest wiring style from `server/src/test/unit/agents-router-run.test.ts`.
6. [ ] Server unit test (REST): `COMMAND_NOT_FOUND` maps to HTTP 404 `{ error: 'not_found' }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
   - Purpose:
     - Ensures the UI can show a clean “command not found” error when a user selects a stale command name.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'COMMAND_NOT_FOUND' }`.
     - Assert `status === 404` and body is `{ error: 'not_found' }`.
7. [ ] Server unit test (REST): `COMMAND_INVALID` from runner maps to HTTP 400 with stable body:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
   - Purpose:
     - Ensures invalid command files (schema/syntax) surface as a stable request error.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'COMMAND_INVALID', reason: 'Invalid command file' }`.
     - Assert `status === 400` and body includes `{ error: 'invalid_request', code: 'COMMAND_INVALID' }`.
8. [ ] Server unit test (REST): `WORKING_FOLDER_INVALID` maps to HTTP 400 with stable body:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
   - Purpose:
     - Matches existing agent-run behavior for invalid working folder input.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'WORKING_FOLDER_INVALID' }`.
     - Assert `status === 400` and body includes `{ error: 'invalid_request', code: 'WORKING_FOLDER_INVALID' }`.
9. [ ] Server unit test (REST): `WORKING_FOLDER_NOT_FOUND` maps to HTTP 400 with stable body:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
   - Test type: server unit (Node `node:test` + SuperTest)
   - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
   - Purpose:
     - Ensures callers get a clear, non-500 error when the folder doesn’t exist.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'WORKING_FOLDER_NOT_FOUND' }`.
     - Assert `status === 400` and body includes `{ error: 'invalid_request', code: 'WORKING_FOLDER_NOT_FOUND' }`.
10. [ ] Server unit test (REST): unknown agent maps to HTTP 404 `{ error: 'not_found' }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - Context7 `/ladjs/supertest`
    - Test type: server unit (Node `node:test` + SuperTest)
    - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
    - Purpose:
      - Ensures stable behavior when the UI references a removed/renamed agent.
    - What to implement:
      - Stub `runAgentCommand(...)` to throw `{ code: 'AGENT_NOT_FOUND' }`.
      - Assert `status === 404` and body is `{ error: 'not_found' }`.
11. [ ] Server unit test (REST): aborting the HTTP request aborts the runner via AbortSignal:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/globals.html#class-abortcontroller
    - Test type: server unit (Node `node:test`, HTTP server + fetch AbortController)
    - Location: `server/src/test/unit/agents-commands-router-run.test.ts`
    - Purpose:
      - Ensures v1 cancellation semantics work for command runs: closing/aborting the HTTP request must abort the in-flight provider call and stop subsequent steps.
    - What to implement:
      - Build an Express app with `createAgentsCommandsRouter({ runAgentCommand: stub })` and start it on an ephemeral port.
      - Stub `runAgentCommand` to capture `params.signal` and await until it is aborted (use an `abort` event listener).
      - Start a `fetch` POST request with a client-side `AbortController`, then abort it and assert the stub observed `signal.aborted === true`.
12. [ ] Update `projectStructure.md` after adding tests:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Files to add/remove entries for (must list all files changed by this task):
     - Add: `server/src/test/unit/agents-commands-router-run.test.ts`
     - Remove: (none)
13. [ ] Update `design.md` with REST command endpoints + Mermaid diagram updates:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - This task adds a new REST surface (`POST /agents/:agentName/commands/run`) and concrete error mapping rules; these must be reflected in architecture docs to keep the system understandable.
   - Required updates:
     - In the Agent Commands section, list the new REST endpoint and its minimal response shape.
     - In the existing command-run sequence diagram, show the REST route as the entry point (and include the `RUN_IN_PROGRESS` 409 branch).
14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid` (needed to update `design.md` when adding the Agents MCP command-run tool flow)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

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
   - Docs to read:
     - Context7 `/websites/v3_zod_dev`
     - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Requirements:
     - Return JSON text payload of `{ agentName, commandName, conversationId, modelId }`.
     - Propagate cancellation: forward the per-request `AbortSignal` (from `handleAgentsRpc` context added in Task 1) into `runAgentCommand({ ..., signal })` so aborting the MCP HTTP request stops the current step and prevents further steps.
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
3. [ ] Server unit test (Agents MCP tool): `run_command` success returns `{ agentName, commandName, conversationId, modelId }`:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-run.test.ts`
   - Purpose:
     - Ensures MCP callers can execute a command and receive a stable minimal response.
   - What to implement:
     - Stub `runAgentCommand(...)` to return `{ agentName, commandName, conversationId, modelId }`.
     - Call `callTool('run_command', { agentName, commandName })` and assert the JSON text content parses to that shape.
4. [ ] Server unit test (Agents MCP tool): `RUN_IN_PROGRESS` surfaces as a stable tool error:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-run.test.ts`
   - Purpose:
     - Ensures multi-tab/multi-client conflict can be detected without string matching.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'RUN_IN_PROGRESS' }`.
     - Assert the tool call throws the expected stable MCP error (per Task 10 mapping rules).
5. [ ] Server unit test (Agents MCP tool): invalid `commandName` is rejected with a stable error:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-run.test.ts`
   - Purpose:
     - Prevents path traversal / invalid command execution attempts from MCP.
   - What to implement:
     - Call `callTool('run_command', { agentName: 'planning_agent', commandName: '../bad' })`.
     - Assert it throws an invalid-params style error (per Task 10 mapping rules).
   - Reference harness:
     - Copy dependency injection patterns from `server/src/test/unit/mcp-agents-tools.test.ts`.
6. [ ] Server unit test (Agents MCP tool): `COMMAND_NOT_FOUND` maps to a stable tool error:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-run.test.ts`
   - Purpose:
     - Ensures MCP callers can treat “no such command” as an invalid params/not-found style error (no string parsing).
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'COMMAND_NOT_FOUND' }`.
     - Assert the tool call throws the expected stable tool error type/code.
7. [ ] Server unit test (Agents MCP tool): `COMMAND_INVALID` maps to a stable tool error:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-run.test.ts`
   - Purpose:
     - Ensures invalid command file/schema is reported safely to MCP callers.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'COMMAND_INVALID' }`.
     - Assert the tool call throws an invalid-params style tool error.
8. [ ] Server unit test (Agents MCP tool): `WORKING_FOLDER_*` errors map to invalid-params tool errors:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-run.test.ts`
   - Purpose:
     - Keeps MCP behavior aligned with existing `run_agent_instruction` working-folder validation rules.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'WORKING_FOLDER_INVALID' }`, assert invalid-params tool error.
     - Stub `runAgentCommand(...)` to throw `{ code: 'WORKING_FOLDER_NOT_FOUND' }`, assert invalid-params tool error.
9. [ ] Server unit test (Agents MCP tool): unknown agent maps to a stable tool error:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://www.jsonrpc.org/specification
   - Test type: server unit (Node `node:test`)
   - Location: `server/src/test/unit/mcp-agents-commands-run.test.ts`
   - Purpose:
     - Ensures the MCP surface does not silently return empty/ok results for unknown agents.
   - What to implement:
     - Stub `runAgentCommand(...)` to throw `{ code: 'AGENT_NOT_FOUND' }`.
     - Assert invalid-params style tool error (safe message).
10. [ ] Server unit test (Agents MCP router): aborting the HTTP request aborts `run_command` via AbortSignal:
   - Docs to read:
     - https://nodejs.org/api/test.html
     - https://nodejs.org/api/globals.html#class-abortcontroller
     - https://www.jsonrpc.org/specification
    - Test type: server unit (Node `node:test`, HTTP server + fetch AbortController)
    - Location: `server/src/test/unit/mcp-agents-router-run.test.ts`
    - Purpose:
      - Ensures MCP cancellation behavior is consistent for both `run_agent_instruction` and `run_command`.
    - What to implement:
      - Set tool deps so `runAgentCommand` captures `params.signal` and waits for abort.
      - Send a JSON-RPC `tools/call` request for `run_command` using `fetch(..., { signal })`, then abort the client signal and assert the stub saw `signal.aborted === true`.
11. [ ] Update existing MCP tools/list expectation test (now that `run_command` exists):
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Files to edit:
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Requirements:
     - Update expected tool names to include `run_command` as well as `list_commands`.
12. [ ] Update `projectStructure.md` after adding tests:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Files to add/remove entries for (must list all files changed by this task):
     - Add: `server/src/test/unit/mcp-agents-commands-run.test.ts`
     - Remove: (none)
13. [ ] Update `design.md` with Agents MCP tools (`list_commands` / `run_command`) + Mermaid diagram updates:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - This task expands the Agents MCP interface and adds a new automation surface; the architecture docs must describe the tool names and the shared “service runner” relationship.
   - Required updates:
     - Document the two Agents MCP tools and their argument shapes at a high level (no full JSON examples needed in design.md).
     - Add (or extend) a Mermaid sequence diagram path showing MCP `tools/call` → shared agents service → Codex.
     - Mention how `RUN_IN_PROGRESS` surfaces for MCP callers (tool error with stable code/message).
14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Add the list API call:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
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
2. [ ] Client unit test (Jest): listAgentCommands calls `GET /agents/:agentName/commands`:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Test type: client unit (Jest)
   - Location: `client/src/test/agentsApi.commandsList.test.ts`
   - Purpose:
     - Ensures the API helper hits the correct endpoint and uses the expected URL structure.
   - What to implement:
     - Mock `fetch` and assert it is called with `/agents/<agentName>/commands`.
   - Reference:
     - Copy fetch-mocking style from `client/src/test/agentsApi.workingFolder.payload.test.ts`.
3. [ ] Client unit test (Jest): listAgentCommands returns parsed `{ commands }` including `disabled` entries:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Test type: client unit (Jest)
   - Location: `client/src/test/agentsApi.commandsList.test.ts`
   - Purpose:
     - Ensures the UI will receive disabled entries for invalid command files and render them disabled.
   - What to implement:
     - Mock a JSON response containing a `commands` array with both enabled and disabled entries.
     - Assert the returned value matches the parsed structure.
4. [ ] Update `projectStructure.md` after adding new client test files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Files to add/remove entries for (must list all files changed by this task):
       - Add: `client/src/test/agentsApi.commandsList.test.ts`
       - Remove: (none)
     - Ensure the entry has a short description (what it covers).
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Regression smoke check (API helper only; UI not changed yet):
     - Open `/agents` and confirm the page loads without errors.
     - Run a normal agent instruction and confirm it still works end-to-end (baseline regression).
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Add the run API call:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
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
2. [ ] Client unit test (Jest): runAgentCommand calls `POST /agents/:agentName/commands/run`:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Test type: client unit (Jest)
   - Location: `client/src/test/agentsApi.commandsRun.test.ts`
   - Purpose:
     - Ensures the API helper hits the correct endpoint and uses `POST` with JSON body.
   - What to implement:
     - Mock `fetch` and assert:
       - URL includes `/agents/<agentName>/commands/run`
       - `method === 'POST'`
       - `content-type === 'application/json'`
3. [ ] Client unit test (Jest): optional payload fields are omitted when not provided:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Test type: client unit (Jest)
   - Location: `client/src/test/agentsApi.commandsRun.test.ts`
   - Purpose:
     - Ensures the server sees a clean payload (no empty strings), matching existing API behavior.
   - What to implement:
     - Call `runAgentCommand({ agentName, commandName })` and assert the JSON body does **not** include `working_folder` or `conversationId`.
   - Reference:
     - Copy “omit empty optionals” assertion style from `client/src/test/agentsApi.workingFolder.payload.test.ts`.
4. [ ] Update `projectStructure.md` after adding new client test files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Files to add/remove entries for (must list all files changed by this task):
       - Add: `client/src/test/agentsApi.commandsRun.test.ts`
       - Remove: (none)
     - Ensure the entry has a short description (what it covers).
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Regression smoke check (API helper only; UI not changed yet):
     - Open `/agents` and confirm the page loads without errors.
     - Run a normal agent instruction and confirm it still works end-to-end (baseline regression).
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Define a small structured error type for agent API calls:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/api/agents.ts`
   - Requirements:
     - Surface `{ status: number; code?: string; message: string }` via a custom `Error` subclass (preferred) or equivalent, so callers can reliably branch on `status` and `code`.
2. [ ] Update `runAgentInstruction(...)` to use structured errors:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/api/agents.ts`
   - Requirements:
     - When response is JSON, prefer `{ code, message }` fields from body if present.
     - Keep existing behavior for non-JSON error bodies (fallback to text).
3. [ ] Update `runAgentCommand(...)` to use structured errors:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/api/agents.ts`
   - Requirements:
     - Match the exact structured-error behavior used by `runAgentInstruction(...)` in Subtask 2:
       - On non-2xx responses, prefer `{ code, message }` from a JSON error body when available.
       - Fall back to `await res.text()` when the body is not JSON.
       - Preserve `status` on the thrown error so UI code can reliably branch on `status === 409` and `code === 'RUN_IN_PROGRESS'`.
     - Do not wrap/convert abort errors: an aborted request should still behave like the existing `runAgentInstruction(...)` (the caller treats abort as cancellation, not a server error).
4. [ ] Client unit test (Jest): `runAgentInstruction(...)` throws structured error for 409 `RUN_IN_PROGRESS`:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Test type: client unit (Jest)
   - Location: `client/src/test/agentsApi.errors.test.ts`
   - Purpose:
     - Ensures the UI can branch on `status === 409` and `code === 'RUN_IN_PROGRESS'` without string parsing.
   - What to implement:
     - Mock `fetch` to return `status=409` and JSON `{ code: 'RUN_IN_PROGRESS', message: '...' }`.
     - Assert the thrown error exposes `{ status: 409, code: 'RUN_IN_PROGRESS' }`.
5. [ ] Client unit test (Jest): `runAgentCommand(...)` throws structured error for 409 `RUN_IN_PROGRESS`:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Test type: client unit (Jest)
   - Location: `client/src/test/agentsApi.errors.test.ts`
   - Purpose:
     - Ensures command execution uses the same structured error contract as normal agent runs.
   - What to implement:
     - Mock `fetch` to return `status=409` and JSON `{ code: 'RUN_IN_PROGRESS', message: '...' }`.
     - Assert the thrown error exposes `{ status: 409, code: 'RUN_IN_PROGRESS' }`.
6. [ ] Update `projectStructure.md` after adding new client test files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Files to add/remove entries for (must list all files changed by this task):
       - Add: `client/src/test/agentsApi.errors.test.ts`
       - Remove: (none)
     - Ensure the entry has a short description (what it covers).
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Regression smoke check (API-only change; UI not changed yet):
     - Open `/agents` and confirm the page loads without errors.
     - Run a normal agent instruction and confirm it still works end-to-end (baseline regression).
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Extend `StoredTurn` with optional `command`:
   - Docs to read:
     - https://react.dev/reference/react
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Required type:
     - `command?: { name: string; stepIndex: number; totalSteps: number }`
   - Requirements:
     - The field must remain optional so existing turns continue to typecheck and render.
     - When the server includes `command` on a turn, the hook must preserve it as-is (no renaming or transformation), so UI rendering can rely on `turn.command` directly.
2. [ ] Add a `refresh()` function to the hook:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Requirements:
     - `refresh()` re-fetches the newest page (`replace` mode) without requiring a conversationId change.
3. [ ] Client unit test (Jest): `useConversationTurns.refresh()` re-fetches the newest page in `replace` mode:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Test type: client unit (Jest)
   - Location: `client/src/test/useConversationTurns.refresh.test.ts`
   - Purpose:
     - Ensures command execution can trigger a turns refresh without changing `conversationId`.
   - What to implement:
     - Mock the turns endpoint and verify calling `refresh()` causes a new fetch and sets `lastMode === 'replace'`.
4. [ ] Client unit test (Jest): turns API `command` metadata is preserved in `StoredTurn`:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
   - Test type: client unit (Jest)
   - Location: `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Purpose:
     - Ensures the UI can render `Command run: ... (2/12)` from persisted turns without any extra mapping layer.
   - What to implement:
     - Mock `/conversations/:id/turns` returning an item that includes:
       - `command: { name: 'improve_plan', stepIndex: 2, totalSteps: 12 }`
     - Assert the hook returns a `StoredTurn` containing that `command` field unchanged.
5. [ ] Update `projectStructure.md` after adding new client test files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Files to add/remove entries for (must list all files changed by this task):
       - Add:
         - `client/src/test/useConversationTurns.commandMetadata.test.ts`
         - `client/src/test/useConversationTurns.refresh.test.ts`
       - Remove: (none)
     - Ensure each entry has a short description (what it covers).
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Regression smoke check (hook-only change; UI not changed yet):
     - Open `/agents` and confirm the page loads without errors.
     - Run a normal agent instruction and confirm it still works end-to-end (baseline regression).
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

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
3. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
- Mermaid syntax (for design diagrams): Context7 `/mermaid-js/mermaid` (needed to update `design.md` for the UI “select command → execute → refresh turns” flow)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Add “Execute command” button + handler:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
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
   - Docs to read:
     - Context7 `/websites/mongoosejs`
     - https://www.mongodb.com/docs/manual/core/data-modeling-introduction/
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
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
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - When the API throws `status=409` and `code="RUN_IN_PROGRESS"`, show a friendly error bubble (do not disable the UI; just inform the user the conversation is already running).
   - Example user-facing message (copy this exact phrasing so tests can assert it):
     - “This conversation already has a run in progress in another tab/window. Please wait for it to finish or press Abort in the other tab.”
4. [ ] Surface `RUN_IN_PROGRESS` for normal agent instructions too:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - When `runAgentInstruction(...)` fails with `status=409` and `code="RUN_IN_PROGRESS"`, show the same friendly message as command runs.
     - This must work when a second browser window/tab tries to run against the same `conversationId`.
5. [ ] Update `design.md` with the Agents UI command flow + Mermaid diagram updates:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - This task changes the user-facing flow on `/agents` by adding a command dropdown and execute action that refreshes conversation history; it must be captured in the architecture docs so future UI work stays consistent.
   - Required updates:
     - Add a short section describing: “commands list refresh on agent change”, “execute returns `{ conversationId, modelId }` and UI re-fetches turns”, and “no client-side global lock; server rejects with RUN_IN_PROGRESS”.
     - Add (or extend) a Mermaid flowchart or sequence diagram showing: select agent → fetch commands → execute → refresh conversations → hydrate turns.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Extend the turns → messages mapping to carry command metadata:
   - Docs to read:
     - https://react.dev/reference/react
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/pages/AgentsPage.tsx`
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Ensure the message objects used for rendering bubbles carry `command` metadata for both user and assistant turns.
     - Do not manufacture metadata: when a turn has no `command`, the corresponding message must not have it either.
2. [ ] Render the note inside both user and assistant bubbles:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
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
3. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Client UI unit test (Jest/RTL): switching agents fetches a new commands list:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsList.test.tsx`
   - Purpose:
     - Confirms the commands dropdown is refreshed each time the selected agent changes.
   - What to implement:
     - Mock `GET /agents/:agentName/commands` responses for two agents with different commands.
     - Simulate switching the Agent select and assert the dropdown options update accordingly.
   - Reference patterns:
     - `client/src/test/agentsPage.list.test.tsx` (agents list + dropdown interaction)
2. [ ] Client UI unit test (Jest/RTL): invalid commands are rendered disabled/unselectable:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsList.test.tsx`
   - Purpose:
     - Ensures invalid command files show up in the dropdown but cannot be selected.
   - What to implement:
     - Mock commands list containing `{ name: 'bad', description: 'Invalid command file', disabled: true }`.
     - Assert the corresponding option is `disabled` and cannot be selected.
3. [ ] Client UI unit test (Jest/RTL): clicking Execute calls the run endpoint:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Purpose:
     - Confirms the UI issues `POST /agents/:agentName/commands/run` with the selected command name.
   - What to implement:
     - Select a command, click Execute, and assert `fetch` was called with `/agents/<agent>/commands/run`.
   - Reference patterns:
     - `client/src/test/agentsPage.run.test.tsx` (send flow + fetch mocking)
4. [ ] Client UI unit test (Jest/RTL): successful execute refreshes conversations and hydrates turns:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Purpose:
     - Ensures the “KISS” response flow works: execute returns `{ conversationId, modelId }`, UI re-fetches conversations and then turns.
   - What to implement:
     - Mock run response returning a new `conversationId`.
     - Assert the UI calls the conversations refresh endpoint and then fetches turns for the new conversation.
   - Reference patterns:
     - `client/src/test/agentsPage.turnHydration.test.tsx` (turn hydration from persisted turns)
5. [ ] Client UI unit test (Jest/RTL): `RUN_IN_PROGRESS` conflict message shows for command execute:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
   - Purpose:
     - Confirms multi-tab safety: server conflict is surfaced as a friendly message in the UI for command runs.
   - What to implement:
     - Mock command run to throw `{ status: 409, code: 'RUN_IN_PROGRESS' }`.
     - Assert the UI renders the friendly conflict message.
6. [ ] Client UI unit test (Jest/RTL): `RUN_IN_PROGRESS` conflict message shows for normal agent send:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
   - Purpose:
     - Confirms the same per-conversation lock messaging is used for both agent instructions and command runs.
   - What to implement:
     - Mock `/agents/:agentName/run` to respond with 409 `RUN_IN_PROGRESS` and assert the same message appears.
7. [ ] Client UI unit test (Jest/RTL): command names display with underscores replaced by spaces:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsList.test.tsx`
   - Purpose:
     - Confirms the dropdown shows friendly labels without changing the underlying `commandName` value sent to the server.
   - What to implement:
     - Mock commands list containing `{ name: 'improve_plan', description: 'd', disabled: false }`.
     - Assert the rendered option text includes `improve plan` (space) rather than `improve_plan`.
8. [ ] Client UI unit test (Jest/RTL): selecting a command shows its Description (and does not show JSON):
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsList.test.tsx`
   - Purpose:
     - Ensures the UI meets the story requirement: show Description only, never raw JSON.
   - What to implement:
     - Select a command and assert the description panel renders the description text.
     - Assert the UI does not render any `{"Description":`-style JSON content.
9. [ ] Client UI unit test (Jest/RTL): Execute is disabled when Mongo persistence is unavailable:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
   - Test type: client unit (Jest + React Testing Library)
   - Location: `client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx`
   - Purpose:
     - Matches the story’s KISS requirement: command execution UI relies on persisted turns for multi-step output, so it must be disabled when `mongoConnected === false`.
   - What to implement:
     - Mock `/health` returning `{ mongoConnected: false }`.
     - Assert the Execute button is disabled and the explanatory message is visible.
10. [ ] Client UI unit test (Jest/RTL): per-turn “Command run … (2/12)” note renders in bubbles:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
    - Test type: client unit (Jest + React Testing Library)
    - Location: `client/src/test/agentsPage.commandMetadataRender.test.tsx`
    - Purpose:
      - Ensures the final UX requirement is met: command-origin turns are clearly labelled with step progress.
    - What to implement:
      - Mock turn hydration to return at least one user and assistant turn with `command: { name: 'improve_plan', stepIndex: 2, totalSteps: 12 }`.
      - Assert the bubble includes `Command run: improve_plan (2/12)`.
11. [ ] Client UI unit test (Jest/RTL): Stop aborts an in-flight command execute request:
   - Docs to read:
     - Context7 `/websites/jestjs_io_30_0`
     - Context7 `/websites/testing-library`
     - Context7 `/testing-library/user-event`
     - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
    - Test type: client unit (Jest + React Testing Library)
    - Location: `client/src/test/agentsPage.commandsRun.abort.test.tsx`
    - Purpose:
      - Ensures v1 cancellation works from the UI: the existing Stop button aborts the in-flight command run request.
    - What to implement:
      - Mock the command-run `fetch` to return a Promise that never resolves, and capture the `signal` passed to fetch.
      - Click Execute, then click Stop.
      - Assert the captured `signal.aborted === true`.
12. [ ] Update `projectStructure.md` after adding new client test files:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Files to add/remove entries for (must list all files changed by this task):
       - Add:
         - `client/src/test/agentsPage.commandMetadataRender.test.tsx`
         - `client/src/test/agentsPage.commandsList.test.tsx`
         - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
         - `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
         - `client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx`
         - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
       - Remove: (none)
     - Ensure each entry has a short description (what it covers).
13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - Regression + feature smoke check (tests task; feature should now be complete):
     - Open `/agents`, select an agent, and confirm the Commands dropdown lists command names (no JSON shown).
     - Select a command and confirm its Description is shown.
     - Execute a command and confirm new turns appear annotated with “Command run: … (step/total)”.
     - Press Abort during a command run and confirm a “Stopped” assistant turn appears for the in-flight step.
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Update `README.md`:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `README.md`
   - Requirements:
     - Document where commands live (`codex_agents/<agent>/commands/*.json`).
     - Document the two REST endpoints and their payloads.
2. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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

Consolidate and sanity-check all architecture/flow updates to `design.md` made throughout this story (several earlier tasks now include explicit `design.md` updates). Ensure the final diagrams are complete, consistent, and match the actual implemented behavior.

#### Documentation Locations

- Mermaid syntax: Context7 `/mermaid-js/mermaid`
- MCP overview (terminology only): https://modelcontextprotocol.io/
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Update `design.md` with diagrams:
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Add a Mermaid sequence diagram for command run (UI → REST → service → Codex).
     - Mention per-conversation lock + abort-based cancellation semantics.
2. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
- Cucumber guides: https://cucumber.io/docs/guides/ (server test suite includes Cucumber; useful when interpreting `npm run test --workspace server` failures)

#### Subtasks

1. [ ] Update `projectStructure.md`:
   - Docs to read:
     - https://github.github.com/gfm/
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add new files created by this story and keep comments accurate.
     - Files to add/remove entries for (must list all files changed by Story 0000018):
       - Add (server runtime):
         - `server/src/agents/commandsLoader.ts`
         - `server/src/agents/commandsRunner.ts`
         - `server/src/agents/commandsSchema.ts`
         - `server/src/agents/runLock.ts`
         - `server/src/routes/agentsCommands.ts`
       - Add (server tests):
         - `server/src/test/unit/agent-commands-list.test.ts`
         - `server/src/test/unit/agent-commands-loader.test.ts`
         - `server/src/test/unit/agent-commands-runner.test.ts`
         - `server/src/test/unit/agent-commands-schema.test.ts`
         - `server/src/test/unit/agents-commands-router-list.test.ts`
         - `server/src/test/unit/agents-commands-router-run.test.ts`
         - `server/src/test/unit/chat-command-metadata.test.ts`
         - `server/src/test/unit/mcp-agents-commands-list.test.ts`
         - `server/src/test/unit/mcp-agents-commands-run.test.ts`
         - `server/src/test/unit/turn-command-metadata.test.ts`
       - Add (client tests):
         - `client/src/test/agentsApi.commandsList.test.ts`
         - `client/src/test/agentsApi.commandsRun.test.ts`
         - `client/src/test/agentsApi.errors.test.ts`
         - `client/src/test/agentsPage.commandMetadataRender.test.tsx`
         - `client/src/test/agentsPage.commandsList.test.tsx`
         - `client/src/test/agentsPage.commandsRun.abort.test.tsx`
         - `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
         - `client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx`
         - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
         - `client/src/test/useConversationTurns.commandMetadata.test.ts`
         - `client/src/test/useConversationTurns.refresh.test.ts`
       - Remove: (none)
2. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
- Cucumber guides: https://cucumber.io/docs/guides/ (Cucumber documentation hub; the server test suite includes Cucumber features)
- Cucumber guide (quick feature/step conventions): https://cucumber.io/docs/guides/10-minute-tutorial/ (shared Cucumber vocabulary and structure)
- Cucumber guide (CI considerations): https://cucumber.io/docs/guides/continuous-integration/ (helps ensure Cucumber runs reliably in automation/CI)

#### Subtasks

1. [ ] Confirm acceptance criteria checklist against the implemented behavior:
   - Docs to read:
     - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - File to read:
     - `planning/0000018-agent-commands.md`
2. [ ] Documentation update check: `README.md`
   - Docs to read:
     - https://github.github.com/gfm/
   - Document: `README.md`
   - Purpose:
     - Ensure the repo-level documentation reflects the final Agent Commands feature and the REST endpoints (`GET /agents/:agentName/commands`, `POST /agents/:agentName/commands/run`).
   - What to verify/update:
     - Command file location (`codex_agents/<agentName>/commands/*.json`) and the v1 schema summary.
     - Any new curl examples and error codes (`RUN_IN_PROGRESS`, `COMMAND_INVALID`, etc.).
3. [ ] Documentation update check: `design.md`
   - Docs to read:
     - Context7 `/mermaid-js/mermaid`
     - https://github.github.com/gfm/#fenced-code-blocks
   - Document: `design.md`
   - Purpose:
     - Ensure all architecture/flow changes made by this story are captured, including per-conversation locking, abort-based cancellation, and command-run execution flow.
   - What to verify/update:
     - Mermaid diagrams render correctly and match the implemented behavior.
     - The concurrency section documents: “lock scope = conversationId only”, “in-memory per process”, “no cross-instance coordination”.
4. [ ] Documentation update check: `projectStructure.md`
   - Docs to read:
     - https://github.github.com/gfm/
   - Document: `projectStructure.md`
   - Purpose:
     - Ensure the tracked project tree is accurate after all new files added by this story (server + client + tests).
   - What to verify/update:
     - All new files created in Tasks 1–21 appear in the tree with correct brief comments.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read:
     - https://docs.npmjs.com/cli/v10/commands/npm-run-script
     - https://eslint.org/docs/latest/use/command-line-interface
     - https://prettier.io/docs/en/cli.html
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
