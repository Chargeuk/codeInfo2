# Story 0000027 - Flows mode

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Introduce a new **Flows** mode that orchestrates a logical sequence of agent steps (not tied to a single agent conversation). Flow definitions live on disk under `flows/<flowName>.json` and are hot-reloaded by re-reading the filesystem on each request (matching the existing agent/command behavior). Each flow step selects a predefined Codex agent plus an identifier; the runtime reuses the previous `conversationId` for each `agentType + identifier` grouping so steps can continue the same agent thread across the flow.

Flows support nested loops via `startLoop` steps that include their own `steps` array, and a `break` step that asks an LLM a provided question and expects a JSON yes/no response. If the configured `breakOn` answer is returned, the current loop is exited. A flow run has its own merged conversation transcript stored and streamed just like existing chat/agent conversations; the UI shows a single flow entry in the sidebar and renders each step with its result plus the agent type/identifier in the message bubbles. Users can stop a flow mid-execution and later resume from a stored step path. Optional step labels can be set in the flow JSON for UI display, and each persisted flow turn should include step metadata (index, loop depth) so the UI can display it alongside the bubble. LLM steps use a `messages` array (like agent commands). Break steps specify a concrete agent + identifier for the JSON response. Flows can also include a step that runs an agent command (for example, `planning_agent` → `improve_plan`). The server exposes REST endpoints mirroring the Agents API. Flow conversations are titled `Flow: <name>` by default. Flow runs also accept an optional `working_folder`, mirroring the agent run behavior.

---

## Acceptance Criteria

- Flow definitions are discovered from `flows/<flowName>.json` on disk and are hot-reloaded without a server restart by re-reading the directory on each request (same pattern as agent discovery and command listing).
- A new flow JSON schema exists (distinct from agent commands) with a required top-level `steps: []`, optional top-level `description`, and step objects that include `type` plus optional `label` for UI display.
- Supported step `type` values are `startLoop`, `llm`, `break`, and `command`. `startLoop` must include a non-empty `steps` array; nested loops are expressed by placing another `startLoop` inside that array.
- `llm` steps require `agentType` (Codex agent name from the Agents dropdown), `identifier`, and `messages` entries shaped like `{ role, content: string[] }` (same message payload used by agent commands).
- `break` steps require `agentType`, `identifier`, `question`, and `breakOn: "yes" | "no"` and must instruct the agent to return JSON in the shape `{ "answer": "yes" | "no" }` for the break decision.
- `command` steps require `agentType`, `identifier`, and `commandName` (must match an available agent command for that agent).
- Nested loops are supported by the runtime using a loop stack; `break` exits only the current loop defined by the closest `startLoop`.
- Flow JSON validation is strict (unknown keys invalid) and mirrors agent command validation rules for trimming/empty checks; invalid JSON or schema errors still appear in the list but with `disabled: true` and a human-readable error message.
- Non-JSON files in `flows/` are ignored and missing `flows/` returns an empty list (same behavior as missing agent command folders).
- `GET /flows` returns `{ flows: [{ name, description, disabled, error? }] }`, where `name` is the filename stem and `description` is the top-level flow description (empty string when missing).
- `POST /flows/:flowName/run` returns `202 { status: "started", flowName, conversationId, inflightId, modelId }` and accepts optional `working_folder`, `conversationId`, and `resumeStepPath` fields to resume a stopped flow.
- Flow runs persist a merged flow conversation and stream events to the client using the same protocol as chat/agent runs.
- Flow streaming uses the existing WebSocket event contract (no new event types).
- Conversations gain an optional `flowName` field; flow runs set `flowName` to the flow name so they can be filtered separately from chat/agent conversations.
- `GET /conversations` accepts `flowName` filtering (exact match), and `flowName=__none__` returns conversations without a flow name (mirrors `agentName` filtering).
- Flow conversations default to the title `Flow: <name>` and appear as a single item in the sidebar.
- The flow UI has a new **Flows** menu entry; the sidebar supports the same conversation management features as the existing conversations list.
- The main flow view renders each step and its result, including agent type, identifier, optional step label, and step metadata.
- Each flow turn persists step metadata under `turn.command` with at least `{ name: "flow", stepIndex, totalSteps, loopDepth, agentType, identifier, label? }`, where `stepIndex`/`totalSteps` refer to the current step list (root or loop). The UI uses this metadata in the bubble.
- Users can stop a running flow, and later resume it from a stored step path.
- Stopping a flow uses the existing `cancel_inflight` WebSocket event and produces a `turn_final` event with `status: "stopped"` for the flow conversation.
- Flow run state for resume is stored under `conversation.flags.flow` with at least `{ stepPath, loopStack, agentConversations }` and is updated after each completed step, where `stepPath` is an array of zero-based indices describing the nested path, `loopStack` is an array of `{ loopStepPath, iteration }` frames, and `agentConversations` keys are formatted as `${agentType}:${identifier}`.
- The flow runtime reuses the previous `conversationId` per `agentType + identifier` grouping when available, otherwise starts a new conversation for that grouping.

---

## Out Of Scope

- UI creation/editing of flows; flows are defined only on disk.
- Support for non-Codex agent types or direct provider calls outside existing agents.
- Loop safety guards like max-iteration limits or timeouts beyond existing stop controls.
- New semantics for agent commands; existing agent command JSON schema remains unchanged.

---

## Questions

None.

---

## Research Notes

- Use directory re-scans for hot reload (same as agent commands). Node’s `fs.watch()` is documented as not being 100% consistent across platforms and can be unreliable on network/virtual file systems, so avoiding watcher-based reload is safer.
- Express 5 supports async route handlers that return promises; rejected promises are routed to the error handler, so flow endpoints can follow the same async pattern as existing agent routes without extra wrappers.
- Mongoose strict mode is enabled by default, so new fields like `flowName` and extended `command` metadata must be added to the schemas or they will be dropped on save.

## Scope Notes

- The story spans new server endpoints/runtime plus a new UI surface; consider splitting into backend/runtime first and UI second if you want smaller, independently shippable slices.

---

## Implementation Ideas

- **Flow discovery + validation (server):** mirror agent command loading by adding a `server/src/flows/` module that scans `flows/` on each request (no cache), ignores non-JSON files, and returns summaries `{ name, description, disabled, error? }`. Use Zod `.strict()` schemas with `z.string().trim()` plus `safeParse` to mirror `server/src/agents/commandsSchema.ts` behavior for trimming and invalid/disabled handling. A separate schema module keeps list/run validation consistent across REST + MCP.
- **REST surface (server):** add routes similar to `server/src/routes/agents.ts`, `server/src/routes/agentsRun.ts`, and `server/src/routes/agentsCommands.ts`, plus register them in `server/src/index.ts`. `GET /flows` delegates to the flow list service, `POST /flows/:flowName/run` validates body, returns 202 with `conversationId`/`inflightId`/`modelId`, and supports `working_folder`, `conversationId`, and `resumeStepPath`.
- **Flow runtime (server):** create `server/src/flows/service.ts` modeled after `server/src/agents/service.ts`. Use `createInflight`, `publishUserTurn`, and `attachChatStreamBridge` to stream over the existing WS protocol; reuse `abortInflight` from `server/src/chat/inflightRegistry.ts` via the existing `cancel_inflight` WS event path. Persist flow state under `conversation.flags.flow` (including step path + loop stack) and update it after each step for resumability.
- **Conversation persistence updates:** extend `server/src/mongo/conversation.ts` to add `flowName` (and index it), and update `server/src/mongo/repo.ts` + `server/src/routes/conversations.ts` to support `flowName` and `flowName=__none__` filtering, mirroring `agentName` semantics. Extend `server/src/mongo/turn.ts` to store flow metadata under `command` (e.g., `stepIndex`, `totalSteps`, `loopDepth`, `agentType`, `identifier`, `label`).
- **Agent reuse per grouping:** maintain a `agentConversations` map in `conversation.flags.flow` keyed by `${agentType}:${identifier}`. On each `llm`/`break`/`command` step, reuse prior `conversationId` from the map or start a new one via the agents run helper. For `command`, call the same execution path as `/agents/:agent/commands/run` (use `startAgentCommand`/`runAgentCommandRunner` so validation, locks, and working-folder handling match existing behavior).
- **UI (client):** create `client/src/pages/FlowsPage.tsx` using the same Drawer layout as `client/src/pages/ChatPage.tsx`/`AgentsPage.tsx`, add a new top-level nav entry in `client/src/components/NavBar.tsx`, and register the route in `client/src/routes/router.tsx`. Reuse `client/src/components/chat/ConversationList.tsx` with a new `variant=\"flows\"`, and load data via `useConversations({ flowName })` once server filtering exists. Bubble metadata lines already render `message.command` in Chat/Agents; extend `buildStepLine` (or shared helper) to show flow label + loop depth.
- **Client API parity:** mirror `client/src/api/agents.ts` (especially `runAgentCommand`) when adding flow run helpers; keep abort handling and error mapping consistent with existing agent command calls.
- **Types + fixtures:** update any shared DTOs in `common/` and client fixtures that mirror conversation or turn metadata so tests stay aligned.
- **Tests (rough):** mirror existing agent command schema tests for flow schema validation, add unit tests for list/run routes, and extend WS integration tests to cover flow start + cancel + resume. In the client, add RTL coverage similar to `chatPage.stream`/`agentsPage.streaming` to assert flow metadata rendering.

---

## Message & Storage Contracts

### REST API (new)

- `GET /flows` → `{ flows: [{ name, description, disabled, error? }] }`
  - `name`: filename stem of `flows/<name>.json`
  - `description`: top-level flow description (empty string if omitted)
  - `disabled`: `true` when JSON/schema validation fails
  - `error`: optional validation error summary for disabled flows
- `POST /flows/:flowName/run` body: `{ working_folder?, conversationId?, resumeStepPath? }`
  - `working_folder` should use the same validation as Agents (`working_folder` may be omitted)
  - `conversationId` and `resumeStepPath` together indicate resume-from-step
  - `resumeStepPath` is an array of zero-based indices describing the nested path through `steps`
  - Response `202`: `{ status: "started", flowName, conversationId, inflightId, modelId }`

### Conversations (existing endpoints, extended fields)

- `ConversationSummary` gains `flowName?: string` (similar to `agentName`)
- `GET /conversations` supports `flowName` filter:
  - `flowName=<name>` returns only flow conversations for that flow
  - `flowName=__none__` returns conversations with no flow name
- New flow conversations default `title` to `Flow: <name>`

### Turn metadata (storage + UI)

- Flow turns set `turn.command` to include:
  - `name: "flow"`
  - `stepIndex`, `totalSteps`, `loopDepth`
  - `agentType`, `identifier`
  - optional `label`
- This metadata is persisted in `turns` and rendered in the flow bubble header.
- `label` should default to the step `type` when omitted so the UI can display a fallback without extra contracts.
- `commandName` remains only in the flow JSON for `command` steps and is not stored in `turn.command`.

### Streaming events

- Flow runs reuse the existing chat/agent WebSocket event types (`user_turn`, `assistant_delta`, `tool_event`, `turn_final`, etc.) with no new event shapes.

### Conversation state (resume)

- Flow resume state stored in `conversation.flags.flow`:
  - `stepPath`: last completed step path (array of indices)
  - `loopStack`: array of `{ loopStepPath, iteration }` frames
  - `agentConversations`: map keyed by `${agentType}:${identifier}` → `conversationId`

### Flow JSON Example (for clarity)

```json
{
  "description": "Summarize, refine, and iterate until done.",
  "steps": [
    {
      "type": "startLoop",
      "label": "Main loop",
      "steps": [
        {
          "type": "llm",
          "label": "Draft summary",
          "agentType": "coding_agent",
          "identifier": "summary",
          "messages": [
            { "role": "user", "content": ["Summarize the current notes."] }
          ]
        },
        {
          "type": "command",
          "label": "Improve plan",
          "agentType": "planning_agent",
          "identifier": "planner",
          "commandName": "improve_plan"
        },
        {
          "type": "break",
          "label": "Check for completion",
          "agentType": "coding_agent",
          "identifier": "summary",
          "question": "Is the summary complete? Reply as JSON {\"answer\":\"yes\"|\"no\"}.",
          "breakOn": "yes"
        }
      ]
    }
  ]
}
```

- Each `messages` entry uses `{ role, content: string[] }` matching agent command message items.
- `startLoop` requires a non-empty `steps` array and may include an optional `label`; the `steps` array is the loop body and repeats until a `break` step triggers.

---

## Edge Cases and Failure Modes

- **Invalid flow JSON/schema:** The flow should appear in `GET /flows` with `disabled: true` and an error message; attempts to run it should return `400 { error: "invalid_request" }` or `404 { error: "not_found" }` (same pattern as invalid agent command usage).
- **Unknown command name:** If a `command` step references a missing agent command, fail the run with `400 { error: "invalid_request" }` and emit `turn_final` with `status: "failed"`.
- **Missing flow file:** `POST /flows/:flowName/run` returns `404 { error: "not_found" }` when the flow file does not exist.
- **Empty loop steps:** A `startLoop` with no `steps` should fail schema validation and the flow should be listed as `disabled`.
- **Break response not JSON / wrong shape:** Treat as `failed` step with a clear error, and emit `turn_final` status `failed` for the flow run.
- **Break response not `yes`/`no`:** Treat as `failed` and do not loop; emit `turn_final` status `failed`.
- **Agent mismatch when resuming:** If a stored agent conversation id belongs to a different agent than requested by the flow step, the run should fail with a `400 { error: "agent_mismatch" }` and surface the failure in the flow transcript.
- **Archived flow conversation:** Running or resuming a flow with an archived `conversationId` should return `410 { error: "archived" }` (consistent with chat/agent behavior).
- **Concurrent run on same flow conversation:** Return `409 { error: "conflict", code: "RUN_IN_PROGRESS" }` if a run is already in progress for the flow conversation.
- **Cancel mid-step:** A user stop should abort the inflight run, emit `turn_final` with `status: "stopped"`, and persist the last completed step index for resuming.
- **Resume with invalid `resumeStepPath`:** Return `400 { error: "invalid_request" }` when any index is negative or exceeds the available steps at that nesting level.
- **Hot reload mid-run:** The active run should continue using the loaded in-memory flow definition; a subsequent run should use the newly loaded file.

---

# Implementation Plan

## Instructions

These instructions will be followed during implementation.

# Tasks

### 1. Server: Flow schema

- Task Status: **__done__**
- Git Commits: f0e76ea, a843fae

#### Overview

Define the strict flow JSON schema and unit coverage for validation. This task establishes the flow definition contract without any discovery or REST endpoints.

#### Documentation Locations

- Zod schema validation (`.strict()` + unions + refinements): Context7 `/colinhacks/zod`
- JSON parsing errors + try/catch patterns: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review existing agent command schema patterns to mirror behavior:
   - Documentation to read (repeat):
     - Zod schema validation: Context7 `/colinhacks/zod`
     - JSON parsing errors: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to read:
     - `server/src/agents/commandsSchema.ts`
     - `server/src/agents/commandsLoader.ts`
     - `server/src/agents/service.ts`
   - Story requirements to repeat here so they are not missed:
     - Flow schema validation must be **strict** (unknown keys invalid).
     - Invalid JSON or schema should still list the flow as `disabled: true` with a human-readable error.
   - Goal:
     - Confirm how invalid JSON is surfaced as `disabled: true` with an error message.
     - Note which trimming/empty-check helpers are used so the flow schema matches them.
   - Code landmarks (repeat):
     - `trimmedNonEmptyString`, `AgentCommandMessageItemSchema`, and `parseAgentCommandFile` in `server/src/agents/commandsSchema.ts`.
     - `loadAgentCommandSummary` and `INVALID_DESCRIPTION` handling in `server/src/agents/commandsLoader.ts`.
   - Notes:
     - `parseAgentCommandFile` returns `{ ok: false }` on JSON parse or schema failure.
     - `trimmedNonEmptyString` + `.strict()` enforce trimming and unknown-key rejection.
     - `loadAgentCommandSummary` surfaces invalid JSON/schema as `disabled: true` with `Invalid command file`.

2. [x] Add a strict flow schema module for JSON validation:
   - Documentation to read (repeat):
     - Zod schema validation: Context7 `/colinhacks/zod`
     - JSON parsing errors: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - `server/src/flows/flowSchema.ts` (new)
   - Story requirements to repeat here so they are not missed:
     - Top-level JSON must include `steps: []`; `description?: string` is optional.
     - Step `type` values are **only** `startLoop`, `llm`, `break`, `command`.
     - Every step may include `label?: string` for UI display.
     - `startLoop` requires a **non-empty** `steps` array (recursive schema).
     - `llm` step shape: `agentType`, `identifier`, `messages: { role, content: string[] }[]`.
     - `messages.role` must be `user` to match existing agent command message rules.
     - `break` step shape: `agentType`, `identifier`, `question`, `breakOn: "yes" | "no"`.
     - `command` step shape: `agentType`, `identifier`, `commandName`.
     - All objects are `.strict()` and must reject unknown keys.
   - Implementation hint (repeat):
     - Reuse `trimmedNonEmptyString` + `parse` patterns from `server/src/agents/commandsSchema.ts` so trimming/empty checks match existing behavior.
   - Code landmarks (repeat):
     - Model the flow schema after `AgentCommandFileSchema` and `AgentCommandMessageItemSchema` in `server/src/agents/commandsSchema.ts`.
     - Follow `parseAgentCommandFile` error handling to return `{ ok: false }` on JSON parse or schema failures.
   - Logging requirement (repeat):
     - Emit `flows.schema.loaded` (info) once when the flow schema module is loaded; include `{ module: 'flows' }` in the context.

3. [x] Unit tests: flow schema validation
   - Test type: Unit (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/unit/flows-schema.test.ts` (new)
   - Description:
     - Add unit coverage for flow schema parsing, strictness, and trimming rules.
   - Story requirements to repeat here so they are not missed:
     - Strict schema rejects unknown keys.
     - `startLoop` requires non-empty `steps`.
     - `breakOn` only accepts `yes` or `no`.
     - `llm` requires `agentType`, `identifier`, and `messages` entries.
     - `break` requires `agentType`, `identifier`, `question`, and `breakOn`.
     - `command` requires `agentType`, `identifier`, and `commandName`.
     - `messages` must contain non-empty strings and `role: "user"`.
   - Purpose:
     - Validate strict schema errors, trimming, and invalid shapes.
   - Test data hints (repeat):
     - Use inline JSON strings (no file IO) and mirror the `parseAgentCommandFile` calling pattern.
     - Include at least one valid flow and multiple invalid variants (unknown keys, empty `steps`, missing `agentType`).

4. [x] Documentation update: `design.md` (flow schema + `/flows` overview)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document the flow JSON schema, step types, and `/flows` overview.
   - Purpose:
     - Keep architecture notes aligned with the new flow schema.

5. [x] Documentation update: `projectStructure.md` (new flow schema files)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/flows/flowSchema.ts` and `server/src/test/unit/flows-schema.test.ts` to the repo tree (no removals).
   - Purpose:
     - Keep the repo tree accurate after new files are added.

6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, then open the Logs page and confirm a `flows.schema.loaded` log entry appears (expect exactly one entry after server start); verify no errors appear in the browser debug console.
9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed agent command schema patterns to mirror strict parsing, trim behavior, and invalid-json handling.
- Confirmed invalid command files surface as disabled entries with the fixed Invalid command file description.
- Added `server/src/flows/flowSchema.ts` with strict Zod schemas, recursive `startLoop` steps, and a `parseFlowFile` helper that mirrors agent command parsing.
- Logged `flows.schema.loaded` once on module load via the shared log store.
- Added unit coverage in `server/src/test/unit/flows-schema.test.ts` for valid flows, strict schema errors, and trimming rules.
- Documented the flow schema and step types in `design.md`, including strict/trim behavior and the `/flows` listing note.
- Updated `projectStructure.md` to include the new flow schema module and unit test in the server tree.
- Ran `npm run lint --workspaces`, fixed lint errors (unused Codex SDK type imports; recursion schema const), and reran lint with existing import-order warnings unchanged.
- Ran Prettier `format` and confirmed `format:check` passes after formatting the new flow files.
- Fixed TypeScript build errors by casting flow step schemas as discriminated-union options and keeping manual flow types to avoid recursive inference issues.
- `npm run build --workspace server` now succeeds.
- `npm run build --workspace client` succeeds (Vite emits only chunk-size warnings).
- `npm run test --workspace server` timed out at 120s on first run; reran with longer timeout and all unit/integration tests passed.
- `npm run test --workspace client` passed (existing console warnings from Markdown/streaming logs remain).
- `npm run e2e` completed successfully (36 Playwright specs passed).
- `npm run compose:build` succeeded (same client chunk-size warnings as earlier).
- `npm run compose:up` started the stack successfully (server/client healthy).
- Manual Playwright-MCP check confirmed a single `flows.schema.loaded` entry on the Logs page after rebuilding/restarting the stack; no console errors after reload (initial stream error occurred during container restart).
- `npm run compose:down` stopped the stack cleanly.
- Added a side-effect import in `server/src/index.ts` to ensure the flow schema module loads and emits its log on server startup; rebuilt/restarted compose afterward.

---

### 2. Server: Flow discovery + list endpoint

- Task Status: **__done__**
- Git Commits: 7adea01, 98dd756

#### Overview

Add flow discovery (scan `flows/` on each request) and expose `GET /flows` with disabled/error reporting for invalid flow files. This task provides the hot-reload listing without starting any flow runs.

#### Documentation Locations

- Node.js `fs/promises` + `path` (directory scanning + JSON file reads): https://nodejs.org/api/fs.html
- Express 5 response helpers (`res.json`, async handlers): Context7 `/expressjs/express/v5.1.0`
- JSON parsing errors + try/catch patterns: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review existing discovery + loader patterns to mirror behavior:
   - Documentation to read (repeat):
     - Node.js `fs/promises`: https://nodejs.org/api/fs.html
   - Files to read:
     - `server/src/agents/commandsLoader.ts`
     - `server/src/ingest/discovery.ts`
   - Story requirements to repeat here so they are not missed:
     - Flow discovery must scan `flows/` on **every request** (hot reload, no cache).
     - Invalid JSON/schema must still be listed as `disabled: true` with an error message.
   - Goal:
     - Confirm how invalid JSON is surfaced as `disabled: true` with an error message.
   - Code landmarks (repeat):
     - `loadAgentCommandSummary` in `server/src/agents/commandsLoader.ts` (returns `disabled: true` with `INVALID_DESCRIPTION`).
     - `walkDir` + `listGitTracked` fallback logic in `server/src/ingest/discovery.ts` for directory scanning patterns.
   - Notes:
     - Agent command loaders surface invalid JSON/schema as `disabled: true` with `Invalid command file`.
     - `discoverFiles` uses `fs.readdir({ withFileTypes: true })` plus recursive `walkDir` for on-demand scanning patterns.

2. [x] Implement flow discovery with hot-reload scanning:
   - Documentation to read (repeat):
     - JSON.parse error handling: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - `server/src/flows/discovery.ts` (new)
   - Story requirements to repeat here so they are not missed:
     - Scan `flows/` on every request (no in-memory cache).
     - Ignore non-JSON files; missing folder returns `[]`.
     - Invalid JSON or schema produces `disabled: true` with a human-readable error.
     - Flow summary shape is `{ name, description, disabled, error? }`.
     - `description` defaults to empty string when missing.
   - Requirements:
     - Scan `flows/` on every request (no in-memory cache).
     - Ignore non-JSON files; missing folder returns `[]`.
     - Invalid JSON or schema produces `disabled: true` with a human-readable error.
     - Flow summary includes `{ name, description, disabled, error? }`.
     - `description` defaults to an empty string when missing.
     - Reuse agent command loader patterns (`loadAgentCommandSummary`) rather than new parsing rules when possible.
   - Implementation checklist (repeat):
     - Use `fs.readdir(..., { withFileTypes: true })` to list `flows/` and filter `.json` files only.
     - Parse JSON with `JSON.parse` in a try/catch, then validate with the flow schema and return `{ disabled: true, error }` on failure.
     - Default `description` to an empty string when missing.
   - Logging requirement (repeat):
     - Emit `flows.discovery.scan` (info) after each scan with `{ totalFlows, disabledFlows }` so listing requests can be verified.

3. [x] Add `GET /flows` route and register it:
   - Documentation to read (repeat):
     - Express `res.json`: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/flows.ts` (new)
     - `server/src/index.ts`
   - Story requirements to repeat here so they are not missed:
     - `GET /flows` returns `{ flows: FlowSummary[] }`.
     - Disabled flows include an `error` field with validation/parsing details.
   - Requirements:
     - `GET /flows` returns `{ flows: FlowSummary[] }`.
     - Disabled flows include `error` text from validation/parsing.
   - Code landmarks (repeat):
     - Mirror response shape and error handling style from `createAgentsCommandsRouter` in `server/src/routes/agentsCommands.ts`.
     - Follow route registration patterns in `server/src/index.ts` for existing routers.

4. [x] Integration tests: flow discovery + list
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.list.test.ts` (new)
     - `server/src/test/fixtures/flows/` (new fixtures)
   - Description:
     - Add integration coverage for `GET /flows` listing and disabled/error reporting.
   - Story requirements to repeat here so they are not missed:
     - Missing `flows/` folder returns empty list.
     - Non-JSON files are ignored.
     - Invalid JSON/schema is listed as `disabled: true` with `error` text.
   - Purpose:
     - Validate non-JSON ignore, missing folder handling, and `disabled` error text.

5. [x] Documentation update: `design.md` (flow discovery + `/flows` listing)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document flow discovery, disabled/error behavior, and list endpoint.
   - Purpose:
     - Keep discovery behavior documented for operators and maintainers.

6. [x] Documentation update: `projectStructure.md` (flow discovery files)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/flows/discovery.ts`, `server/src/routes/flows.ts`, `server/src/test/integration/flows.list.test.ts`, and `server/src/test/fixtures/flows/` fixture files (`valid-flow.json`, `invalid-json.json`, `invalid-schema.json`, `ignore.txt`) to the repo tree (no removals).
   - Purpose:
     - Keep the repo tree accurate after new discovery files are added.

7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run `fetch('http://host.docker.internal:5010/flows')` in devtools, verify the response JSON has a `flows` array, then open Logs and confirm a `flows.discovery.scan` entry appears with `totalFlows` ≥ 0; confirm no errors appear in the browser debug console.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed agent command loaders and ingest discovery patterns for invalid JSON handling and on-demand directory scanning.
- Added `server/src/flows/discovery.ts` to scan the `flows/` folder per request, return summaries with disabled/error states, and emit `flows.discovery.scan` logging.
- Added `server/src/routes/flows.ts` and registered it in `server/src/index.ts` for `GET /flows` listing.
- Added `server/src/test/integration/flows.list.test.ts` and fixtures under `server/src/test/fixtures/flows/` to verify listing, invalid JSON/schema errors, and non-JSON ignore behavior.
- Documented flow discovery and `/flows` listing behavior in `design.md`.
- Updated `projectStructure.md` for new flow discovery files, route, and fixtures/tests.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and reran Prettier after ignoring the invalid JSON fixture for format checks.
- Fixed a TS build error in `server/src/flows/discovery.ts` by typing Dirent from `node:fs` and confirmed the server build passes.
- `npm run build --workspace client` succeeded (same chunk-size warnings as prior builds).
- `npm run test --workspace server` initially failed due to the invalid-schema fixture; updated the fixture and cleaned temporary test directories before rerunning successfully.
- `npm run test --workspace client` passed (existing console warnings remain).
- `npm run e2e` timed out at 7 minutes on the first attempt; ran `npm run e2e:down` to clean up and reran successfully (36 specs passed).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the stack successfully (server/client healthy).
- Manual Playwright-MCP check confirmed `/flows` returns an empty `flows` array in this environment and logs `flows.discovery.scan` with `totalFlows: 0`; browser console remained clean.
- `npm run compose:down` stopped the stack cleanly.

---

### 3. Server: Conversation flowName persistence

- Task Status: **__done__**
- Git Commits: 2fead1b, 39f50dd

#### Overview

Add `flowName` to conversation persistence and summary types so flow conversations are stored and broadcast correctly. This task updates Mongo schema and WS summary payloads without filtering logic.

#### Documentation Locations

- Mongoose schema fields + optional indexes: Context7 `/automattic/mongoose/9.0.1`
- Express query parsing (`req.query`) and response helpers: Context7 `/expressjs/express/v5.1.0`
- WebSocket JSON message shape best practices: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review current conversation schema and summary mapping:
   - Documentation to read (repeat):
     - Mongoose schema fields: Context7 `/automattic/mongoose/9.0.1`
     - WebSocket JSON message shape best practices: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to read:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/events.ts`
     - `server/src/ws/sidebar.ts`
     - `server/src/ws/types.ts`
     - `server/src/chat/memoryPersistence.ts`
   - Story requirements to repeat here so they are not missed:
     - Conversations gain optional `flowName?: string`.
     - `flowName` must be included in conversation summaries + WS sidebar payloads.
     - Missing `flowName` should be omitted (not `null`).
   - Code landmarks (repeat):
     - `Conversation` interface + `conversationSchema` in `server/src/mongo/conversation.ts`.
     - `toConversationEvent` in `server/src/mongo/repo.ts` and `ConversationEventSummary` in `server/src/mongo/events.ts`.
     - `toWsConversationSummary` in `server/src/ws/sidebar.ts` and `WsSidebarConversationUpsertEvent` in `server/src/ws/types.ts`.
     - `memoryConversations` + `updateMemoryConversationMeta` in `server/src/chat/memoryPersistence.ts`.

2. [x] Add `flowName` to persistence + summary types:
   - Documentation to read (repeat):
     - Mongoose schema fields: Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/mongo/events.ts`
     - `server/src/ws/types.ts`
     - `server/src/ws/sidebar.ts`
     - `server/src/chat/memoryPersistence.ts`
   - Story requirements to repeat here so they are not missed:
     - Flow runs must persist `flowName` so they can be filtered later.
     - `flowName` must appear in WS sidebar summaries for live updates.
     - Memory persistence must retain `flowName` when Mongo is unavailable.
   - Requirements:
     - `flowName?: string` optional field on conversations.
     - Include `flowName` in `ConversationSummary` and WS sidebar summaries.
     - Ensure missing `flowName` is omitted (not `null`).
     - Ensure new flow conversations can set `flowName` at creation time via `createConversation` inputs.
     - Update conversation event summaries to include `flowName` for WS upserts.
     - Update memory persistence helpers to keep `flowName` on in-memory conversations.
   - Implementation checklist (repeat):
     - Add `flowName?: string` to `Conversation` and persist it in `conversationSchema`.
     - Extend `CreateConversationInput` + `toConversationEvent` to pass `flowName` through to `ConversationEventSummary`.
     - Include `flowName` in sidebar summaries (only when defined) and in memory persistence updates.
   - Logging requirement (repeat):
     - Emit `conversations.flowName.mapped` (info) when listing conversations, with `{ flowNameCount, totalCount }` in the context.

3. [x] Integration test: flowName appears in conversation list
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/conversations.flowname.test.ts` (new)
   - Description:
     - Ensure `GET /conversations` returns `flowName` when present.
   - Purpose:
     - Validate flow conversation summaries surface `flowName` for the client.

4. [x] Unit test: WS sidebar upsert includes flowName
   - Test type: Unit (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/ws-server.test.ts`
   - Description:
     - Emit a conversation upsert with `flowName` and assert WS payload includes it.
   - Purpose:
     - Keep WS sidebar updates aligned with flow filtering UI.

5. [x] Documentation update: `design.md` (flowName field)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document the `flowName` field and how it separates flow vs chat conversations.
   - Purpose:
     - Keep schema/architecture notes aligned with flow filtering.

6. [x] Documentation update: `projectStructure.md` (flowName tests)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/test/integration/conversations.flowname.test.ts` to the repo tree (no removals).
   - Purpose:
     - Keep the repo structure accurate.

7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run `fetch('http://host.docker.internal:5010/conversations?state=all')` in devtools, verify `items` omit `flowName` when absent, then open Logs and confirm a `conversations.flowName.mapped` entry with `totalCount` matching the response length; confirm no errors appear in the browser debug console.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed conversation persistence, event mapping, WS sidebar types, and memory persistence to confirm where flowName needs to be threaded (conversation schema, repo summaries, WS summaries, memory updates).
- Added optional `flowName` to the conversation schema, repo summaries/events, WS sidebar summaries, and memory persistence patching; added a `conversations.flowName.mapped` info log during list mapping.
- Added `server/src/test/integration/conversations.flowname.test.ts` to assert list responses include flowName when present and omit it otherwise.
- Updated the WS server unit test to assert conversation upserts carry `flowName` in the sidebar payload.
- Documented the new `flowName` tag in `design.md` and added the integration test to `projectStructure.md`.
- `npm run lint --workspaces` completed with existing import-order warnings only; `npm run format:check --workspaces` passed cleanly.
- `npm run build --workspace server` succeeded.
- `npm run build --workspace client` succeeded (Vite chunk size warnings only).
- `npm run test --workspace server` initially failed due to stale Testcontainers (port/Chroma conflicts); after removing the leftover containers, reran successfully with all unit + Cucumber scenarios passing.
- `npm run test --workspace client` passed (console output includes expected jsdom/logging noise).
- `npm run e2e` completed successfully (33 passed, 3 skipped).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the stack successfully.
- Playwright MCP check: `/conversations?state=all` returned items without `flowName`, Logs page showed `conversations.flowName.mapped` with `totalCount=20`, and the browser console stayed clean.
- `npm run compose:down` stopped the stack cleanly.

---

### 4. Server: Conversation flowName filtering

- Task Status: **__done__**
- Git Commits: e742c89, f7d8180

#### Overview

Add `flowName` filtering to `GET /conversations` (`flowName=<name>` and `flowName=__none__`) so flows stay isolated from chat/agents. This task only touches query handling and list filtering logic.

#### Documentation Locations

- Express query parsing (`req.query`) and response helpers: Context7 `/expressjs/express/v5.1.0`
- Mongoose query filters: Context7 `/automattic/mongoose/9.0.1`
- Node.js test runner: https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Implement `flowName` filtering in `GET /conversations`:
   - Documentation to read (repeat):
     - Express query parsing: Context7 `/expressjs/express/v5.1.0`
     - Mongoose query filters: Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
   - Story requirements to repeat here so they are not missed:
     - `flowName=<name>` returns only conversations with that `flowName`.
     - `flowName=__none__` returns only conversations without a `flowName`.
     - Preserve existing `agentName` and `state` filters.
   - Requirements:
     - `flowName=<name>` returns only conversations with that `flowName`.
     - `flowName=__none__` returns only conversations without a `flowName`.
     - Preserve existing `agentName` and `state` filters.
   - Logging requirement (repeat):
     - Emit `conversations.flowName.filter_applied` (info) with `{ flowNameFilter }` whenever a flowName filter is present.

2. [x] Integration test: conversations list flowName filtering
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Description:
     - Exercise `GET /conversations` with `flowName=<name>` and `flowName=__none__`.
     - Assert the returned items include the `flowName` field when set.
   - Story requirements to repeat here so they are not missed:
     - Tests must cover `flowName=<name>` and `flowName=__none__`.
   - Purpose:
     - Validate list API filtering behavior.

3. [x] Unit test: router flowName query parsing
   - Test type: Unit (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/conversations-router-agent-filter.test.ts`
   - Description:
     - Verify the router builds repo filters for `flowName` and `__none__`.
   - Story requirements to repeat here so they are not missed:
     - `flowName=<name>` and `flowName=__none__` are parsed correctly.
   - Purpose:
     - Ensure routing logic stays aligned with repository filters.

4. [x] Unit test: repo flowName filter semantics
   - Test type: Unit (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/unit/repo-conversations-agent-filter.test.ts`
   - Description:
     - Validate repository query logic for `flowName` filtering.
   - Story requirements to repeat here so they are not missed:
     - Existing `agentName` filtering coverage must remain.
   - Purpose:
     - Keep repo-level filters consistent across agent + flow filters.

5. [x] Documentation update: `design.md` (flowName filtering)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document `flowName` filtering and `__none__` semantics.
   - Purpose:
     - Keep filtering behavior aligned with API contract.

6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open Chat and Agents pages at `http://host.docker.internal:5001`, confirm `/conversations` requests include `flowName=__none__`, then open Logs and verify `conversations.flowName.filter_applied` entries show `flowNameFilter: "__none__"`; confirm no errors appear in the browser debug console.
9. [x] `npm run compose:down`

#### Implementation notes

- Added `flowName` query parsing and `conversations.flowName.filter_applied` logging in the conversations router.
- Repo filtering now supports `flowName=<name>` and `flowName=__none__` alongside existing agent filters.
- Extended integration and unit coverage for router forwarding and repo query filters with flowName cases.
- Documented flowName filtering semantics in `design.md`.
- `npm run lint --workspaces` reported existing import-order warnings only; `npm run format --workspaces` fixed formatting and `npm run format:check --workspaces` passed.
- `npm run build --workspace server` succeeded.
- `npm run build --workspace client` succeeded (Vite chunk-size warnings only).
- `npm run test --workspace server` passed (54 Cucumber scenarios, 325 steps).
- `npm run test --workspace client` passed (console logs include expected jsdom noise).
- `npm run e2e` completed successfully (33 passed, 3 skipped).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the stack successfully.
- Playwright MCP check: Chat/Agents loaded and Logs captured (note: log query did not surface `conversations.flowName.filter_applied`, indicating the UI does not yet send `flowName=__none__`).
- `npm run compose:down` stopped the stack cleanly.

---

### 5. Server: Flow run core (llm steps only)

- Task Status: **__done__**
- Git Commits: 9d78c5b, 9a4f1b2

#### Overview

Implement the flow run engine for linear `llm` steps, including `POST /flows/:flowName/run`, flow conversation creation (`title: Flow: <name>`), and sequential step execution. This task focuses on core execution without loops, break steps, commands, or resume support.

#### Documentation Locations

- Express async handlers + error propagation: Context7 `/expressjs/express/v5.1.0`
- AbortController usage (cancellation): https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Node.js timers (delays between steps if needed): https://nodejs.org/api/timers.html
- Node.js `fs/promises` (test fixture updates): https://nodejs.org/api/fs.html
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review agent run + inflight streaming helpers:
   - Documentation to read (repeat):
     - AbortController: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
   - Files to read:
     - `server/src/agents/service.ts`
     - `server/src/agents/commands.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/routes/agentsRun.ts`
   - Story requirements to repeat here so they are not missed:
     - Flow runs must stream using the existing WS protocol (no new event types).
     - Flow runs must reuse per-agent thread ids when available.
   - Code landmarks (repeat):
     - `runAgentInstructionUnlocked` + `startAgentInstruction` in `server/src/agents/service.ts` (thread id + inflight creation).
     - `createInflight`, `appendAssistantDelta`, `appendToolEvent`, and `abortInflight` in `server/src/chat/inflightRegistry.ts`.
     - `attachChatStreamBridge` in `server/src/chat/chatStreamBridge.ts` for streaming events.
     - Route patterns in `server/src/routes/agentsRun.ts` for request parsing + error mapping.

2. [x] Implement flow run service for sequential `llm` steps:
   - Documentation to read (repeat):
     - Express error handling: https://expressjs.com/en/guide/error-handling.html
     - AbortController: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
   - Files to edit:
     - `server/src/flows/service.ts` (new)
     - `server/src/flows/types.ts` (new)
   - Story requirements to repeat here so they are not missed:
     - Flow runs create a conversation titled `Flow: <name>` and set `flowName`.
     - Steps execute sequentially (no loops/break/command yet in this task).
     - Persist turns to the **flow** conversation only.
     - Reuse per-agent thread ids (`agentType` + `identifier` mapping) when available.
     - Validate `working_folder` with shared resolver and surface the same error codes as agent runs.
     - When memory persistence is active, flow conversations/turns must still be recorded.
   - Requirements:
     - Load flow definition on each run (no caching).
     - Create flow conversation when missing; set `flowName` and `title`.
     - Execute `llm` steps sequentially using a flow step runner built from agent config (Codex home + system prompt).
     - Maintain an in-memory `agentConversations` map keyed by `${agentType}:${identifier}` for step reuse (persist later).
     - Use existing WS streaming bridge to emit transcript events to the flow conversation.
     - Persist user/assistant turns to the flow conversation (do not persist step turns into the agent-mapping conversations).
     - Run the agent chat interface with `skipPersistence: true` against the agent conversation id, then manually persist turns to the flow conversation.
     - Convert each `messages[]` entry to a single instruction string (join `content` with `\n`).
     - Use agent config (`codexHome`, `useConfigDefaults`, `systemPrompt`) like `runAgentInstructionUnlocked`.
     - When a per-agent thread id exists, pass it via `threadId` so the same Codex thread continues.
     - Only include `systemPrompt` when starting a brand-new thread (no thread id stored yet).
     - Acquire/release the existing per-conversation run lock to prevent overlapping flow runs.
     - Propagate the flow inflight AbortSignal into each step so Stop cancels the active step.
     - Validate `working_folder` via the shared resolver and surface `WORKING_FOLDER_INVALID/NOT_FOUND` consistently.
     - Reuse `resolveWorkingFolderWorkingDirectory` and `tryAcquireConversationLock`/`releaseConversationLock` from the agents layer.
     - If `shouldUseMemoryPersistence()` is true, create/update `memoryConversations` with `flowName` and persist turns via `recordMemoryTurn`/`updateMemoryConversationMeta`.
   - Code landmarks (repeat):
     - `runAgentInstructionUnlocked` in `server/src/agents/service.ts` for per-step execution and inflight setup.
     - `resolveWorkingFolderWorkingDirectory` in `server/src/agents/service.ts` for `working_folder` validation.
     - `tryAcquireConversationLock`/`releaseConversationLock` in `server/src/agents/runLock.ts` for run locking.
     - `recordMemoryTurn` + `updateMemoryConversationMeta` in `server/src/chat/memoryPersistence.ts`.

3. [x] Add `POST /flows/:flowName/run` route:
   - Documentation to read (repeat):
     - Express request body parsing: https://expressjs.com/en/api.html#req.body
   - Files to edit:
     - `server/src/routes/flowsRun.ts` (new)
     - `server/src/index.ts`
   - Story requirements to repeat here so they are not missed:
     - Response is `202 { status: "started", flowName, conversationId, inflightId, modelId }`.
     - Missing flow returns `404 { error: "not_found" }`.
     - Invalid JSON/schema returns `400 { error: "invalid_request" }`.
     - Archived conversation returns `410 { error: "archived" }`.
     - Concurrent run returns `409 { error: "conflict", code: "RUN_IN_PROGRESS" }`.
   - Requirements:
     - Accept `{ conversationId?, working_folder? }`.
     - Return `202 { status: "started", flowName, conversationId, inflightId, modelId }`.
     - Mirror agent run validation for `working_folder` errors.
     - Missing flow file returns `404 { error: 'not_found' }`.
     - Invalid flow JSON/schema returns `400 { error: 'invalid_request' }`.
     - Archived conversations return `410 { error: 'archived' }`.
     - Concurrent runs on the same flow conversation return `409 { error: 'conflict', code: 'RUN_IN_PROGRESS' }`.
   - Logging requirement (repeat):
     - Emit `flows.run.started` (info) when returning 202 with `{ flowName, conversationId, inflightId }`.

4. [x] Integration tests: basic `llm` flow run:
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.run.basic.test.ts` (new)
     - `server/src/test/fixtures/flows/` (extend with a simple llm-only flow)
   - Description:
     - Validate the happy-path flow run for a single `llm` step with streaming.
   - Story requirements to repeat here so they are not missed:
     - `POST /flows/:flowName/run` returns 202 with `conversationId` + `inflightId`.
     - Response payload includes `flowName` and `modelId`.
     - Flow conversation title defaults to `Flow: <name>`.
     - Streamed events use the existing WS protocol (no new event types).
   - Purpose:
     - Ensure `POST /flows/:flowName/run` returns 202, sets the flow title, and streams a user turn + assistant delta.

5. [x] Integration tests: flow run error cases (missing/invalid/archived/conflict):
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.run.errors.test.ts` (new)
     - `server/src/test/fixtures/flows/` (add invalid JSON + invalid schema fixtures)
   - Description:
     - Exercise run endpoint error responses for missing/invalid flows and run conflicts.
   - Story requirements to repeat here so they are not missed:
     - Missing flow file returns `404 { error: "not_found" }`.
     - Invalid flow JSON/schema returns `400 { error: "invalid_request" }`.
     - Archived flow conversation returns `410 { error: "archived" }`.
     - Concurrent run returns `409 { error: "conflict", code: "RUN_IN_PROGRESS" }`.
   - Purpose:
     - Lock in error handling for core run request validation.

6. [x] Integration tests: flow run `working_folder` validation
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.run.working-folder.test.ts` (new)
   - Description:
     - Validate `working_folder` acceptance and invalid folder error responses.
   - Story requirements to repeat here so they are not missed:
     - Invalid `working_folder` returns `400 { code: "WORKING_FOLDER_INVALID" | "WORKING_FOLDER_NOT_FOUND" }`.
     - Valid `working_folder` is resolved consistently with agent runs.
   - Purpose:
     - Ensure flow runs reuse agent working-folder validation semantics.

7. [x] Integration tests: flow run hot reload between runs
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.run.hot-reload.test.ts` (new)
   - Description:
     - Update a flow file between runs and verify the next run uses the updated definition.
   - Story requirements to repeat here so they are not missed:
     - Flow definitions are reloaded from disk on each run request (no cache).
   - Purpose:
     - Confirm hot-reload behavior for run execution.

8. [x] Documentation update: `design.md` (flow run core)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document `/flows/:flowName/run` contract and flow conversation title format.
   - Purpose:
     - Keep runtime flow behavior documented and aligned with the API.

9. [x] Documentation update: `projectStructure.md` (flow run files)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/flows/service.ts`, `server/src/flows/types.ts`, `server/src/routes/flowsRun.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.errors.test.ts`, `server/src/test/integration/flows.run.working-folder.test.ts`, `server/src/test/integration/flows.run.hot-reload.test.ts`, and `server/src/test/fixtures/flows/` fixtures (`llm-basic.json`, `hot-reload.json`) to the repo tree (no removals).
   - Purpose:
     - Keep the repo structure accurate after new flow runtime files.

10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run `fetch('http://host.docker.internal:5010/flows/<flowName>/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })` for a valid flow, then open Logs and confirm `flows.run.started` appears with matching `flowName`; confirm no errors appear in the browser debug console.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed agent run/inflight helpers in `server/src/agents/service.ts`, `server/src/agents/commandsRunner.ts` (note: `commands.ts` does not exist), `server/src/chat/inflightRegistry.ts`, `server/src/chat/chatStreamBridge.ts`, and `server/src/routes/agentsRun.ts` to mirror WS streaming, locking, and error mapping for flow runs.
- Confirmed inflight creation/publish flow and working-folder validation patterns to reuse in flow service.
- Added `server/src/flows/service.ts` and `server/src/flows/types.ts` to load flow files per run, create flow conversations, execute llm-only steps with per-agent thread reuse, and persist merged flow turns while streaming via the existing WS bridge.
- Wired `POST /flows/:flowName/run` in `server/src/routes/flowsRun.ts` with request validation, error mapping, and registration in `server/src/index.ts`.
- Added flow run integration coverage for basic streaming (`flows.run.basic.test.ts`), error cases (`flows.run.errors.test.ts`), working folder validation (`flows.run.working-folder.test.ts`), and hot reload behavior (`flows.run.hot-reload.test.ts`).
- Added flow run fixtures `llm-basic.json` and `hot-reload.json` under `server/src/test/fixtures/flows/`.
- Documented core flow run behavior and sequential llm execution in `design.md`.
- Updated `projectStructure.md` with new flow service/router files, integration tests, and flow fixtures.
- `npm run lint --workspaces` reports existing import-order warnings in unrelated files; no new lint errors.
- `npm run format --workspaces` followed by `npm run format:check --workspaces` passes.
- `npm run build --workspace server` succeeded.
- `npm run build --workspace client` succeeded (Vite chunk-size warnings only).
- `npm run test --workspace server` passed (reran with extended timeout after initial timeouts; 413 tests, 54 Cucumber scenarios).
- `npm run test --workspace client` passed (console warnings from jsdom/DOM nesting logs).
- `npm run e2e` passed after rerun with extended timeout (33 passed, 3 skipped).
- `npm run compose:build` succeeded.
- `npm run compose:up` started the stack successfully.
- Playwright MCP check: `POST /flows/manual-flow/run` returned 202 and Logs page showed `flows.run.started` for `manual-flow` with no browser console errors.
- `npm run compose:down` stopped the stack successfully.
- Updated `server/src/test/integration/flows.list.test.ts` expectations to include the new flow fixtures introduced for flow run tests.

---

### 6. Server: Loop + break step support

- Task Status: **__done__**
- Git Commits: 9253545, d10dc1a

#### Overview

Extend the flow runtime with nested loop support and `break` steps that evaluate a JSON `yes/no` response. This task introduces loop stack mechanics and validates break responses without adding command steps yet.

#### Documentation Locations

- JSON parsing + error handling patterns: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- AbortController usage: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review existing flow runtime implementation:
   - Documentation to read (repeat):
     - JSON parsing + error handling patterns: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
     - AbortController usage: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/flows/flowSchema.ts`
   - Story requirements to repeat here so they are not missed:
     - Nested loops must be supported via a loop stack.
     - `break` exits only the nearest loop.
   - Code landmarks (repeat):
     - Initial flow execution loop in `server/src/flows/service.ts` (created in Task 5).
     - Flow schema definitions in `server/src/flows/flowSchema.ts` for step typing.

2. [x] Add loop stack execution for `startLoop`:
   - Documentation to read (repeat):
     - JSON parsing + error handling patterns: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - `server/src/flows/service.ts`
   - Story requirements to repeat here so they are not missed:
     - Loop stack stores `loopStepPath` + iteration count.
     - Nested `startLoop` bodies execute recursively.
   - Requirements:
     - Maintain a loop stack with current loop path + iteration count.
     - Execute nested `startLoop` steps recursively.
     - Ensure `break` exits only the nearest loop.

3. [x] Implement `break` step handling:
   - Documentation to read (repeat):
     - JSON.parse error handling: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - `server/src/flows/service.ts`
   - Story requirements to repeat here so they are not missed:
     - `break` step must ask for JSON `{ "answer": "yes" | "no" }`.
     - Invalid JSON/shape must fail the flow with `turn_final status=failed`.
     - Only exit the current loop when response equals `breakOn`.
   - Requirements:
     - Ask the configured agent to answer `{ "answer": "yes" | "no" }`.
     - Validate JSON and `answer` shape; invalid responses fail the flow with clear errors.
     - Exit current loop only when response matches `breakOn`.
     - Emit `turn_final` with `status: 'failed'` on invalid JSON or invalid `answer` values.
     - Persist the final `answer` decision into flow turn content so it appears in the transcript.
   - Logging requirement (repeat):
     - Emit `flows.run.break_decision` (info) with `{ answer, breakOn, loopDepth }` when a break response is evaluated.

4. [x] Integration tests: nested loop + break behavior:
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.run.loop.test.ts` (new)
     - `server/src/test/fixtures/flows/` (add a loop flow fixture)
   - Description:
     - Validate loop execution and break behavior with nested steps.
   - Story requirements to repeat here so they are not missed:
     - Loop continues until `break` returns the configured `breakOn` answer.
     - Invalid JSON or `answer` fails the flow.
     - Wrong `answer` value (`maybe`, empty, etc.) fails the flow with `turn_final status=failed`.
     - Non-JSON response fails the flow with `turn_final status=failed`.
   - Purpose:
     - Confirm loop iterations continue until `break` triggers.

5. [x] Documentation update: `design.md` (loop + break semantics)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document loop stack behavior and `break` JSON response contract.
   - Purpose:
     - Keep loop control semantics documented with diagrams.

6. [x] Documentation update: `projectStructure.md` (loop test + fixture files)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/test/integration/flows.run.loop.test.ts` and `server/src/test/fixtures/flows/loop-break.json` to the repo tree (no removals).
   - Purpose:
     - Keep file map accurate after adding loop tests.

7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, start a loop/break flow if available, then open Logs and confirm `flows.run.break_decision` appears with `answer` matching the step; verify no errors in the browser debug console.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed `server/src/flows/service.ts` and `server/src/flows/flowSchema.ts` to confirm llm-only flow execution and strict step typing so loop/break support can extend the existing run loop.
- Added loop-stack execution in `server/src/flows/service.ts` with recursive step traversal, per-loop iteration tracking, and support for nested `startLoop` blocks.
- Implemented `break` step handling with JSON answer parsing, `flows.run.break_decision` logging, and deferred turn_final override on invalid responses.
- Added loop/break integration coverage with `server/src/test/integration/flows.run.loop.test.ts` and `server/src/test/fixtures/flows/loop-break.json` to validate looping and error cases.
- Documented loop/break semantics in `design.md` and registered new loop fixtures/tests in `projectStructure.md`.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format --workspaces` followed by `npm run format:check --workspaces` to align formatting.
- Verified server build with `npm run build --workspace server`.
- Verified client build with `npm run build --workspace client` (Vite chunk size warnings only).
- Ran `npm run test --workspace server` (node:test + cucumber scenarios) after updating flow list fixtures.
- Ran `npm run test --workspace client` (passes; console log noise from test logger as usual).
- Ran `npm run e2e` (compose e2e build/up/test/down; 36 specs passed).
- Ran `npm run compose:build` for the main Docker stack.
- Started the main Docker stack with `npm run compose:up`.
- Manual Playwright check: opened `http://host.docker.internal:5001`, ran a loop/break flow, and confirmed `flows.run.break_decision` entries (answer yes) in Logs with no browser console errors.
- Shut down Docker stack with `npm run compose:down`.
- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 7. Server: Command step support

- Task Status: **__done__**
- Git Commits: 12a60a2, 8d3f288

#### Overview

Add support for `command` steps that run agent command macros (`commands/<commandName>.json`) within a flow. This task loads and executes the command JSON using the flow step runner so results stream and persist into the flow conversation (not the agent conversation).

#### Documentation Locations

- Express error handling (invalid request responses): Context7 `/expressjs/express/v5.1.0`
- JSON schema validation patterns: Context7 `/colinhacks/zod`
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review agent command loader + schema:
   - Documentation to read (repeat):
     - JSON schema validation patterns: Context7 `/colinhacks/zod`
   - Files to read:
     - `server/src/agents/commandsLoader.ts`
     - `server/src/agents/commandsSchema.ts`
     - `server/src/agents/service.ts`
     - `server/src/routes/agentsCommands.ts`
   - Story requirements to repeat here so they are not missed:
     - `command` steps must reuse agent command definitions (`commands/<commandName>.json`).
     - Invalid commands must fail with `400 { error: "invalid_request" }`.
   - Code landmarks (repeat):
     - `loadAgentCommandFile` + `loadAgentCommandSummary` in `server/src/agents/commandsLoader.ts`.
     - `runAgentCommandRunner` and `isSafeCommandName` in `server/src/agents/commandsRunner.ts`.
     - `AgentCommandFileSchema` in `server/src/agents/commandsSchema.ts`.

2. [x] Implement `command` step execution in flow runtime:
   - Documentation to read (repeat):
     - Express error handling (invalid request responses): Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/flows/service.ts`
   - Story requirements to repeat here so they are not missed:
     - `command` steps run agent command macros and stream like `llm` steps.
     - Errors must surface as `turn_final status=failed` with clear messages.
   - Requirements:
     - Validate `commandName` exists for the target `agentType`.
     - Load the command JSON and execute each item using the flow step runner (same streaming/persistence as `llm`).
     - Treat each command item as a sub-step under the same flow step metadata (no new flow step index).
     - Ensure errors surface as `turn_final` status `failed` with a clear message.
   - Logging requirement (repeat):
     - Emit `flows.run.command_step` (info) with `{ commandName, agentType }` when a command step begins execution.

3. [x] Integration tests: command step run:
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.run.command.test.ts` (new)
     - `server/src/test/fixtures/flows/` (add a command step fixture)
   - Description:
     - Validate command step execution and invalid command handling in flow runs.
   - Story requirements to repeat here so they are not missed:
     - Valid command steps succeed and stream.
     - Invalid command names return `400 { error: "invalid_request" }`.
   - Purpose:
     - Validate a command step succeeds and invalid commands fail with 400.

4. [x] Documentation update: `design.md` (command steps)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document command step behavior and error handling.
   - Purpose:
     - Keep command step behavior aligned with flow execution.

5. [x] Documentation update: `projectStructure.md` (command test + fixture files)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/test/integration/flows.run.command.test.ts` and `server/src/test/fixtures/flows/command-step.json` to the repo tree (no removals).
   - Purpose:
     - Keep file map accurate after adding command tests.

6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run a command-step flow if available, then open Logs and confirm `flows.run.command_step` appears with the expected `commandName`; confirm no errors appear in the browser debug console.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed agent command loading/validation patterns in `commandsLoader`, `commandsSchema`, and `commandsRunner` to mirror error mapping for `COMMAND_INVALID`/`COMMAND_NOT_FOUND` and safe command name checks.
- Added command-step execution in `server/src/flows/service.ts`, including command file validation, `flows.run.command_step` logging, and a fallback failure path that emits a failed flow turn when command loading fails.
- Added `flows.run.command` integration coverage with a `command-step.json` fixture to validate successful command execution and a missing command case returning `400 invalid_request`.
- Updated `design.md` to document command step execution and failure behavior.
- Updated `projectStructure.md` to include the command-step fixture and integration test.
- Ran workspace lint/format checks; resolved new formatting issues and noted pre-existing lint warnings outside this task.
- `npm run build --workspace server` succeeded after removing an unreachable-type reference in the flow step fallback branch.
- `npm run build --workspace client` succeeded (Vite emitted chunk-size warnings only).
- `npm run test --workspace server` succeeded after updating `flows.list.test.ts` for the new `command-step` fixture (earlier run failed and a timeout occurred before rerunning with a larger window).
- `npm run test --workspace client` succeeded (logs include expected jsdom console output warnings).
- `npm run e2e` succeeded (compose e2e build/up/tests/down all passed).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the stack successfully (services healthy).
- Manual Playwright check: ran `manual-command-step` flow, verified `flows.run.command_step` (commandName `improve_plan`) in Logs, and saw no browser console errors.
- `npm run compose:down` stopped the stack cleanly after manual verification.

---

### 8. Server: Resume state persistence

- Task Status: **__done__**
- Git Commits: 7c548b9, a23ca6b

#### Overview

Persist flow run state (step path, loop stack, agent conversation mapping, and per-agent thread ids) in `conversation.flags.flow`. This task stores resume state without enabling resume execution yet.

#### Documentation Locations

- Mongoose schema updates + nested objects: Context7 `/automattic/mongoose/9.0.1`
- JSON parsing + validation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review existing conversation flags handling:
   - Documentation to read (repeat):
     - Mongoose schema updates + nested objects: Context7 `/automattic/mongoose/9.0.1`
   - Files to read:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/agents/service.ts`
   - Story requirements to repeat here so they are not missed:
     - Resume state lives in `conversation.flags.flow` with `stepPath`, `loopStack`, and `agentConversations`.
     - Per-agent thread ids must be persisted alongside the agent mapping.
   - Code landmarks (repeat):
     - `Conversation` interface `flags` field in `server/src/mongo/conversation.ts`.
     - `updateConversationMeta` + `updateConversationThreadId` in `server/src/mongo/repo.ts`.
     - `threadId` lookup in `runAgentInstructionUnlocked` (`server/src/agents/service.ts`).
     - `updateMemoryConversationMeta` in `server/src/chat/memoryPersistence.ts`.

2. [x] Add `conversation.flags.flow` persistence shape:
   - Documentation to read (repeat):
     - Mongoose schema updates: Context7 `/automattic/mongoose/9.0.1`
     - JSON parsing + validation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/chat/memoryPersistence.ts`
   - Story requirements to repeat here so they are not missed:
     - Store `stepPath`, `loopStack`, and `agentConversations` map.
     - Store per-agent `threadId` values keyed by `${agentType}:${identifier}`.
     - Keep flags optional/backwards compatible.
     - Memory persistence must retain `flags.flow` updates.
     - Agent conversation ids are used only for thread continuity; turns still persist to the flow conversation.
   - Requirements:
     - Store `stepPath`, `loopStack`, and `agentConversations` map.
     - Ensure flags remain optional and backward compatible.
     - Store per-agent `threadId` values keyed by `${agentType}:${identifier}` alongside `agentConversations`.
     - On run start, hydrate the in-memory agent map from `flags.flow` when present.
     - When a new agent mapping is needed, create a companion agent conversation (`agentName` set, title derived from flow + identifier) so thread ids can be persisted safely.
     - When using memory persistence, update `memoryConversations` with `flags.flow` via `updateMemoryConversationMeta`.
   - Logging requirement (repeat):
     - Emit `flows.resume.state_saved` (info) when `flags.flow` is persisted, with `{ conversationId, stepPath }`.

3. [x] Unit tests: flow flags persistence
   - Test type: Unit (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/unit/flows.flags.test.ts` (new)
   - Description:
     - Ensure `flags.flow` is saved and loaded on conversation documents.
   - Story requirements to repeat here so they are not missed:
     - Tests cover storing and returning `flags.flow`.
   - Purpose:
     - Ensure `flags.flow` is stored and returned in conversation metadata.

4. [x] Documentation update: `design.md` (resume state)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document the `flags.flow` structure and how it is used for resume.
   - Purpose:
     - Keep resume state design notes current.

5. [x] Documentation update: `projectStructure.md` (flow flags test file)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/test/unit/flows.flags.test.ts` to the repo tree (no removals).
   - Purpose:
     - Keep file map accurate after adding flags tests.

6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run a flow if available, then open Logs and confirm `flows.resume.state_saved` appears with the flow `conversationId`; confirm no errors appear in the browser debug console.
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed existing conversation flags usage in `conversation.ts`, `repo.ts`, `agents/service.ts`, and `memoryPersistence.ts` to align flow resume state with current threadId persistence patterns.
- Added flow resume state persistence in `server/src/flows/service.ts` and a dedicated `FlowResumeState` type, including agent conversation hydration, threadId persistence, and `flows.resume.state_saved` logging.
- Added `flows.flags.test.ts` to verify `flags.flow` persistence and conversation listing surfaces the stored state.
- Updated `design.md` with the `flags.flow` resume state structure and logging note.
- Updated `projectStructure.md` to include the new `flows.flags.test.ts` unit test.
- Ran workspace lint/format checks; fixed new import order/formatting issues and noted existing lint warnings elsewhere.
- `npm run build --workspace server` succeeded after reordering flow agent model lookup.
- `npm run build --workspace client` succeeded (Vite emitted chunk-size warnings only).
- `npm run test --workspace server` succeeded (unit + integration suites).
- `npm run test --workspace client` succeeded (Jest suite; expected jsdom console logging).
- `npm run e2e` succeeded (compose e2e build/up/tests/down all passed).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the stack successfully (services healthy).
- Manual Playwright check: ran `manual-resume-state` flow, verified `flows.resume.state_saved` with conversationId `645baef7-3751-4087-8974-3f688ac9e70a` in Logs, and saw no browser console errors.
- `npm run compose:down` stopped the stack cleanly after manual verification.

---

---

### 9. Server: Resume execution support

- Task Status: **__in_progress__**
- Git Commits: **__to_do__**

#### Overview

Enable resume execution using `resumeStepPath` and stored `flags.flow` state. This task validates resume paths, detects agent mismatches, and persists step progress on stop/cancel.

#### Documentation Locations

- Express request validation patterns: Context7 `/expressjs/express/v5.1.0`
- JSON parsing + validation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Implement resume path validation + execution:
   - Documentation to read (repeat):
     - Express request validation patterns: Context7 `/expressjs/express/v5.1.0`
     - JSON parsing + validation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - `server/src/flows/service.ts`
     - `server/src/routes/flowsRun.ts`
   - Story requirements to repeat here so they are not missed:
     - Accept `resumeStepPath` to continue a stopped flow.
     - Invalid indices must return `400 { error: "invalid_request" }`.
     - Agent mismatch returns `400 { error: "agent_mismatch" }`.
     - Persist step progress on stop/cancel for later resume.
     - Resume state updates must work with memory persistence when Mongo is unavailable.
   - Requirements:
     - Accept `resumeStepPath` (array of indices) in the run request.
     - Validate every index and return `400 invalid_request` on mismatch.
     - Resume uses stored `loopStack` and `agentConversations` when present.
     - Update `flags.flow.stepPath` after each completed step.
     - If a stored `agentConversations` id maps to a different agent, return `400 { error: 'agent_mismatch' }`.
     - On stop/cancel, persist the last completed `stepPath` for resume.
     - Update per-agent `threadId` mapping after each step when Codex emits a new thread id.
     - Prefer the thread id from `turn_final`/`thread` events over the flow conversation `flags.threadId`.
     - When `shouldUseMemoryPersistence()` is true, update `memoryConversations` with the latest `flags.flow` values.
   - Logging requirement (repeat):
     - Emit `flows.resume.requested` (info) with `{ conversationId, resumeStepPath }` when a resume run starts.
   - Code landmarks (repeat):
     - Flow run request parsing pattern in `server/src/routes/flowsRun.ts` (created in Task 5).
     - `updateConversationMeta` usage in `server/src/mongo/repo.ts` for persisting `flags` updates.
     - `memoryConversations` + `updateMemoryConversationMeta` in `server/src/chat/memoryPersistence.ts`.

2. [ ] Integration tests: resume behavior + invalid resume path:
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.run.resume.test.ts` (new)
   - Description:
     - Validate resume continuation, invalid path handling, and agent mismatch errors.
   - Story requirements to repeat here so they are not missed:
     - Tests cover stop/resume and invalid `resumeStepPath` errors.
     - Tests cover `agent_mismatch` error when an agent conversation id belongs to a different agent.
     - Tests cover invalid indices (negative or out-of-range) returning `400 { error: "invalid_request" }`.
   - Purpose:
     - Verify stop/resume from stored step path and invalid path errors.

3. [ ] Documentation update: `design.md` (resume execution)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document resume path validation and `agent_mismatch` error behavior.
   - Purpose:
     - Keep resume execution notes aligned with runtime behavior.

4. [ ] Documentation update: `projectStructure.md` (resume test file)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/test/integration/flows.run.resume.test.ts` to the repo tree (no removals).
   - Purpose:
     - Keep file map accurate after adding resume tests.

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, stop a flow run and resume it, then open Logs and confirm `flows.resume.requested` appears with the expected `resumeStepPath`; verify no errors appear in the browser debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 10. Server: Flow turn metadata for UI (message changes)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Attach flow step metadata to persisted turns (`turn.command`) so the client can render step labels, agent identifiers, and loop depth. This isolates the server-side message shape changes that the UI will consume.

#### Documentation Locations

- Mongoose subdocument fields: Context7 `/automattic/mongoose/9.0.1`
- Express response shaping (`res.json`): Context7 `/expressjs/express/v5.1.0`
- WebSocket payload patterns: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current turn metadata usage:
   - Documentation to read (repeat):
     - Mongoose subdocument fields: Context7 `/automattic/mongoose/9.0.1`
     - WebSocket payload patterns: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to read:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/routes/conversations.ts`
     - `client/src/hooks/useChatStream.ts` (client rendering of command metadata)
   - Story requirements to repeat here so they are not missed:
     - Flow turns must emit `turn.command` metadata so UI can render step labels + agent identifiers.
   - Code landmarks (repeat):
     - `TurnCommandMetadata` in `server/src/mongo/turn.ts`.
     - `parseCommandMetadata` in `server/src/chat/interfaces/ChatInterface.ts`.
     - `InflightState.command` in `server/src/chat/inflightRegistry.ts` and snapshot builders in the same file.

2. [ ] Add flow-specific command metadata shape:
   - Documentation to read (repeat):
     - Mongoose subdocument fields: Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/chat/interfaces/ChatInterface.ts` (parseCommandMetadata)
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/ws/types.ts`
   - Story requirements to repeat here so they are not missed:
     - `turn.command.name = "flow"` and must include `stepIndex`, `totalSteps`, `loopDepth`, `agentType`, `identifier`, `label`.
     - Default `label` to the step `type` when missing.
   - Requirements:
     - `turn.command.name = "flow"`
     - Include `stepIndex`, `totalSteps`, `loopDepth`, `agentType`, `identifier`, and `label`.
     - Default `label` to the step `type` when omitted in the flow JSON.

3. [ ] Emit flow metadata on each flow step turn:
   - Documentation to read (repeat):
     - WebSocket payload patterns: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
   - Files to edit:
     - `server/src/flows/service.ts`
   - Story requirements to repeat here so they are not missed:
     - Every flow step must include `turn.command` metadata in persisted turns and inflight snapshots.
   - Requirements:
     - Populate `turn.command` fields for every flow step.
     - Preserve existing agent step metadata where applicable.
     - Ensure inflight snapshots include the flow command metadata during streaming.
   - Logging requirement (repeat):
     - Emit `flows.turn.metadata_attached` (info) with `{ stepIndex, agentType }` when attaching flow command metadata.

4. [ ] Integration test: flow turn metadata in snapshots
   - Test type: Integration (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/integration/flows.turn-metadata.test.ts` (new)
   - Description:
     - Ensure turn snapshots include flow `command` metadata fields.
   - Story requirements to repeat here so they are not missed:
     - `GET /conversations/:id/turns` includes flow `command` metadata.
   - Purpose:
     - Verify turn snapshots include `command` metadata for flow turns.

5. [ ] Unit test: command metadata parser for flows
   - Test type: Unit (`node:test`)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to add/edit:
     - `server/src/test/unit/chat-command-metadata.test.ts`
   - Description:
     - Validate `parseCommandMetadata` handles flow fields and defaults.
   - Story requirements to repeat here so they are not missed:
     - Flow `turn.command` includes `stepIndex`, `totalSteps`, `loopDepth`, `agentType`, `identifier`, `label`.
   - Purpose:
     - Ensure command metadata parsing is aligned with flow turns.

6. [ ] Documentation update: `design.md` (flow turn metadata)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document the `turn.command` metadata shape used by flows.
   - Purpose:
     - Keep transcript metadata documented for UI consumers.

7. [ ] Documentation update: `projectStructure.md` (flow metadata test file)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `server/src/test/integration/flows.turn-metadata.test.ts` to the repo tree (no removals).
   - Purpose:
     - Keep file map accurate after adding metadata tests.

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run a flow if available, then open Logs and confirm `flows.turn.metadata_attached` entries appear for step indices; ensure no errors appear in the browser debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 11. Client: Flows API helpers

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add client API helpers for listing flows and starting flow runs. This task exposes a typed client interface without any UI changes.

#### Documentation Locations

- Fetch API + AbortController: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing Agents API helpers:
   - Documentation to read (repeat):
     - Fetch API + AbortController: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to read:
     - `client/src/api/agents.ts`
   - Story requirements to repeat here so they are not missed:
     - Flows API should mirror Agents API patterns for error handling and abort support.
   - Code landmarks (repeat):
     - `AgentApiError`, `throwAgentApiError`, and `parseAgentApiErrorResponse` in `client/src/api/agents.ts`.
     - `runAgentInstruction` and `listAgentCommands` request/response shapes in the same file.

2. [ ] Add flows API helpers:
   - Documentation to read (repeat):
     - Fetch API + AbortController: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to edit:
     - `client/src/api/flows.ts` (new)
   - Story requirements to repeat here so they are not missed:
     - `listFlows()` must call `GET /flows` and return `{ flows: [...] }`.
     - `runFlow()` must call `POST /flows/:flowName/run` and surface 202 payload.
     - Error handling must mirror Agents API patterns.
   - Requirements:
     - `listFlows()` calling `GET /flows`.
     - `runFlow(flowName, payload)` calling `POST /flows/:flowName/run`.
     - Mirror error handling patterns from `client/src/api/agents.ts`.
     - Reuse the same abort + error parsing helpers as the Agents API if available.
   - Logging requirement (repeat):
     - Use `createLogger('client-flows')` to emit `flows.api.list` and `flows.api.run` (info) with `{ flowName }` where applicable.

3. [ ] Unit tests: flows API helpers
   - Test type: RTL/Jest
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Files to add/edit:
     - `client/src/test/flowsApi.test.ts` (new)
   - Description:
     - Verify list/run API helpers build correct requests and parse responses.
   - Story requirements to repeat here so they are not missed:
     - Tests verify request URLs, success payloads, and error handling for both endpoints.
   - Purpose:
     - Validate request URLs and error handling for `listFlows` and `runFlow`.

4. [ ] Unit tests: flows API run payload fields
   - Test type: RTL/Jest
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Files to add/edit:
     - `client/src/test/flowsApi.run.payload.test.ts` (new)
   - Description:
     - Verify `runFlow` includes optional payload fields when provided.
   - Story requirements to repeat here so they are not missed:
     - Payload includes `working_folder` when set.
     - Payload includes `resumeStepPath` when set.
   - Purpose:
     - Confirm `runFlow` serializes optional payload fields correctly.

5. [ ] Documentation update: `projectStructure.md` (flows API helper)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `client/src/api/flows.ts`, `client/src/test/flowsApi.test.ts`, and `client/src/test/flowsApi.run.payload.test.ts` to the repo tree (no removals).
   - Purpose:
     - Keep file map accurate after API helper additions.

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, call `listFlows()` and `runFlow()` from the Flows UI (or console), then open Logs and confirm `flows.api.list` and `flows.api.run` entries appear with the expected `flowName`; confirm no errors appear in the browser debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

---

### 12. Client: Flows UI

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Build the Flows UI: list flows, start/resume runs, and render flow conversations with step metadata. This task depends on server message changes from Task 10.

#### Documentation Locations

- MUI components (Drawer, Button, TextField, Chip, Typography): MUI MCP tool (`@mui/material@6.4.12`)
- React Router v7.9.x docs: Context7 `/remix-run/react-router/react-router_7.9.4`
- Fetch API + AbortController: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing Chat/Agents UI patterns for reuse:
   - Documentation to read (repeat):
     - React Router v7.9.x docs: Context7 `/remix-run/react-router/react-router_7.9.4`
     - MUI components: MUI MCP tool (`@mui/material@6.4.12`)
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/api/flows.ts`
   - Story requirements to repeat here so they are not missed:
     - Flows UI must reuse existing chat layout patterns and streaming hooks.
   - Code landmarks (repeat):
     - Sidebar layout + conversation selection in `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx`.
     - `ConversationList` props for sidebar rendering in `client/src/components/chat/ConversationList.tsx`.
     - Streaming hook usage in `client/src/hooks/useChatStream.ts` and WS handling in `client/src/hooks/useChatWs.ts`.

2. [ ] Build Flows page UI:
   - Documentation to read (repeat):
     - MUI components: MUI MCP tool (`@mui/material@6.4.12`)
     - React Router v7.9.x docs: Context7 `/remix-run/react-router/react-router_7.9.4`
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx` (new)
     - `client/src/routes/router.tsx`
     - `client/src/components/NavBar.tsx`
   - Story requirements to repeat here so they are not missed:
     - Flows page has its own route + nav entry.
     - Sidebar lists only conversations for the selected flow.
     - Bubbles show step label + agentType/identifier metadata.
   - Requirements:
     - Sidebar uses `ConversationList` filtered by `flowName`.
     - Main panel includes flow selector, run/resume controls, and transcript.
     - Display `command` metadata in bubble header (label + agentType/identifier).
   - Logging requirement (repeat):
     - Use `createLogger('client-flows')` to emit `flows.ui.opened` (info) when the page mounts.

3. [ ] Wire flow run/resume + stop controls:
   - Documentation to read (repeat):
     - Fetch API + AbortController: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/hooks/useChatStream.ts`
   - Story requirements to repeat here so they are not missed:
     - Start runs via `POST /flows/:flowName/run`.
     - Resume uses stored `resumeStepPath`.
     - Stop uses existing `cancel_inflight` WS path.
   - Requirements:
     - Start runs via `POST /flows/:flowName/run`.
     - Resume uses stored `resumeStepPath` when provided.
     - Stop uses existing `cancel_inflight` WS path.
   - Logging requirement (repeat):
     - Emit `flows.ui.run_clicked`, `flows.ui.resume_clicked`, and `flows.ui.stop_clicked` (info) with `{ flowName }` when the buttons are used.

4. [ ] Client tests (RTL): flows page basics:
   - Test type: RTL/Jest
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Files to add/edit:
     - `client/src/test/flowsPage.test.tsx` (new)
   - Description:
     - Validate Flows page renders list and step metadata.
   - Story requirements to repeat here so they are not missed:
     - Tests cover flow list rendering and step metadata display.
   - Purpose:
     - Render Flows page, list flows, and verify metadata line rendering.

5. [ ] Client tests (RTL): flows page run/resume controls
   - Test type: RTL/Jest
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Files to add/edit:
     - `client/src/test/flowsPage.run.test.tsx` (new)
   - Description:
     - Validate run + resume controls call the flows API with expected payloads.
   - Story requirements to repeat here so they are not missed:
     - Run uses `POST /flows/:flowName/run`.
     - Resume includes `resumeStepPath` when available.
   - Purpose:
     - Ensure the Flows UI triggers run/resume with the right payload fields.

6. [ ] Client tests (RTL): flows page stop control
   - Test type: RTL/Jest
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Files to add/edit:
     - `client/src/test/flowsPage.stop.test.tsx` (new)
   - Description:
     - Validate stop control triggers the cancel inflight flow.
   - Story requirements to repeat here so they are not missed:
     - Stop uses existing `cancel_inflight` WS path.
   - Purpose:
     - Ensure Flows UI stop control wires to the existing stop mechanism.

7. [ ] Documentation update: `README.md` (Flows UI entry)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `README.md`
   - Description:
     - Add Flows page route and usage notes for running flows.
   - Purpose:
     - Ensure user-facing docs mention the new Flows UI.

8. [ ] Documentation update: `design.md` (Flows UI description)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Description:
     - Document Flows UI navigation + data flow and add Mermaid diagrams.
   - Purpose:
     - Keep UI architecture aligned with the new page and data flow.

9. [ ] Documentation update: `projectStructure.md` (Flows UI files)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Add `client/src/pages/FlowsPage.tsx`, `client/src/test/flowsPage.test.tsx`, `client/src/test/flowsPage.run.test.tsx`, and `client/src/test/flowsPage.stop.test.tsx` to the repo tree (no removals).
   - Purpose:
     - Keep file map accurate after UI additions.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001/flows`, start/resume/stop a flow if available, then open Logs and confirm `flows.ui.opened` plus the matching `flows.ui.run_clicked`/`flows.ui.resume_clicked`/`flows.ui.stop_clicked` entries appear; verify no errors appear in the browser debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 13. Client: Flow filtering

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Update client conversation list filtering so Chat and Agents exclude flow conversations by default, and Flows can query by `flowName`.

#### Documentation Locations

- React state patterns: https://react.dev/reference/react/useState
- TypeScript structural typing: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Extend conversation summary + WS types for `flowName`:
   - Documentation to read (repeat):
     - TypeScript structural typing: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useConversations.ts`
   - Story requirements to repeat here so they are not missed:
     - Client summaries must carry `flowName` for filtering.
   - Code landmarks (repeat):
     - `ConversationSummary` type in `client/src/hooks/useConversations.ts`.
     - WS sidebar event handling in `client/src/hooks/useChatWs.ts` (apply upserts + deletes).
   - Requirements:
     - Add `flowName?: string` to client summary shapes.
     - Preserve `flowName` on WS sidebar upserts.

2. [ ] Update `useConversations` to accept `flowName` filter:
   - Documentation to read (repeat):
     - React state patterns: https://react.dev/reference/react/useState
   - Files to edit:
     - `client/src/hooks/useConversations.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Story requirements to repeat here so they are not missed:
     - Chat + Agents must request `flowName=__none__`.
     - Flows page must pass `flowName=<name>`.
   - Requirements:
     - Support `flowName=<name>` and `flowName=__none__` query params.
     - Ensure Chat + Agents requests include `flowName=__none__` so flow conversations stay isolated.
   - Logging requirement (repeat):
     - Use `createLogger('client-flows')` to emit `flows.filter.requested` (info) with `{ flowName }` whenever `useConversations` issues a request.

3. [ ] Update/extend client tests for flow filtering:
   - Test type: RTL/Jest
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/useConversations.source.test.ts`
   - Description:
     - Validate the flowName query parameter selection for Chat/Agents.
   - Story requirements to repeat here so they are not missed:
     - Tests confirm `flowName=__none__` is included for Chat/Agents.
   - Purpose:
     - Confirm `flowName=__none__` is included in Chat/Agents list requests.

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open Chat, Agents, and Flows pages at `http://host.docker.internal:5001`, then open Logs and confirm `flows.filter.requested` entries show `flowName: "__none__"` for Chat/Agents and `flowName: "<selected>"` for Flows; verify no errors appear in the browser debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 14. Client: Flow command metadata support

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Preserve the extended flow step metadata (`loopDepth`, `label`, `agentType`, `identifier`) in client normalization and tests.

#### Documentation Locations

- TypeScript structural typing: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Extend command metadata types + normalization:
   - Documentation to read (repeat):
     - TypeScript structural typing: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Story requirements to repeat here so they are not missed:
     - Client must preserve `loopDepth`, `label`, `agentType`, `identifier` for flow turns.
   - Code landmarks (repeat):
     - `normalizeCommandMetadata` and stream parsing in `client/src/hooks/useChatStream.ts`.
     - Turn normalization in `client/src/hooks/useConversationTurns.ts`.
     - WS fixtures in `client/src/test/support/mockChatWs.ts` (update sample payloads).
   - Requirements:
     - Extend command metadata types to include `loopDepth`, `label`, `agentType`, `identifier`.
     - Keep backward compatibility with existing command metadata tests.
     - Mirror server `TurnCommandMetadata` shape so parsing stays in sync.
   - Logging requirement (repeat):
     - Emit `flows.metadata.normalized` (info) when flow command metadata is parsed, with `{ stepIndex, label }`.

2. [ ] RTL test: conversation turns command metadata
   - Test type: RTL/Jest
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Description:
     - Ensure normalized turns retain flow metadata fields.
   - Story requirements to repeat here so they are not missed:
     - Tests verify flow metadata fields survive normalization.
   - Purpose:
     - Confirm flow metadata fields survive normalization in turn snapshots.

3. [ ] RTL test: chat stream tool payload metadata
   - Test type: RTL/Jest
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Files to edit:
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description:
     - Validate stream parsing preserves flow metadata in tool payloads.
   - Story requirements to repeat here so they are not missed:
     - Tests verify flow metadata fields survive normalization.
   - Purpose:
     - Confirm stream normalization does not drop flow metadata.

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open a flow conversation in the UI (if available), then open Logs and confirm `flows.metadata.normalized` entries appear with the expected `label`; verify no errors appear in the browser debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 15. Final verification + documentation + PR summary

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Validate the full story against acceptance criteria, perform clean builds/tests, update documentation, and produce the pull request summary for the story.

#### Documentation Locations

- Docker Compose guide (clean builds + compose up/down): Context7 `/docker/docs`
- Playwright Test docs (Node/TS setup + running tests): https://playwright.dev/docs/intro
- Husky docs (git hook management + install): https://typicode.github.io/husky/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- npm run-script reference (running workspace scripts): https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Documentation update: `README.md` (story summary + commands)
   - Documentation to read (repeat):
     - Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `README.md`
   - Description:
     - Document new Flows endpoints/commands and UI entry points.
   - Purpose:
     - Keep user-facing docs current for new flow functionality.

2. [ ] Documentation update: `design.md` (final architecture + diagrams)
   - Documentation to read (repeat):
     - Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
     - Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md`
   - Description:
     - Add final flow run/resume architecture notes and Mermaid diagrams.
   - Purpose:
     - Ensure architecture documentation matches the delivered changes.

3. [ ] Documentation update: `projectStructure.md` (final tree)
   - Documentation to read (repeat):
     - Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`
   - Description:
     - Reflect new `flows/` directory and all new server/client/test files.
   - Purpose:
     - Keep repository structure accurate for future work.

4. [ ] Documentation update: PR summary comment
   - Documentation to read (repeat):
     - Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `planning/0000027-flows-mode.md`
   - Description:
     - Create a summary of server, client, tests, and compat impacts.
   - Purpose:
     - Provide a ready-to-post PR summary after all tasks complete.

5. [ ] Add verification log line for final QA pass:
   - Documentation to read (repeat):
     - Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `client/src/pages/LogsPage.tsx`
   - Description:
     - Emit `flows.verification.manual_check` (info) when the Logs page is opened during the final verification pass.
   - Purpose:
     - Provide a definitive log marker that the manual QA step was executed.

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run a flow end-to-end (stop mid-run, resume, verify sidebar filtering by `flowName`), visit the Logs page, and confirm `flows.verification.manual_check` appears; smoke-test Chat + Agents pages for regressions; confirm no errors appear in the browser debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.
