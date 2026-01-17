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

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Define the strict flow JSON schema and unit coverage for validation. This task establishes the flow definition contract without any discovery or REST endpoints.

#### Documentation Locations

- Zod schema validation (`.strict()` + unions + refinements): Context7 `/colinhacks/zod`
- JSON parsing errors + try/catch patterns: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing agent command schema patterns to mirror behavior:
   - Documentation to read (repeat):
     - Zod schema validation: Context7 `/colinhacks/zod`
   - Files to read:
     - `server/src/agents/commandsSchema.ts`
     - `server/src/agents/commandsLoader.ts`
     - `server/src/agents/service.ts`
   - Goal:
     - Confirm how invalid JSON is surfaced as `disabled: true` with an error message.

2. [ ] Add a strict flow schema module for JSON validation:
   - Documentation to read (repeat):
     - Zod schema validation: Context7 `/colinhacks/zod`
   - Files to edit:
     - `server/src/flows/flowSchema.ts` (new)
   - Requirements:
     - Top-level object with `steps` (non-empty array) and optional `description`.
     - Step union types: `startLoop`, `llm`, `break`, `command`.
     - `startLoop` requires a non-empty `steps` array (recursive schema).
     - `llm` requires `agentType`, `identifier`, `messages` (`{ role, content: string[] }`).
     - For now, `messages.role` must be `user` to mirror existing agent command semantics.
     - `break` requires `agentType`, `identifier`, `question`, `breakOn: 'yes' | 'no'`.
     - `command` requires `agentType`, `identifier`, `commandName`.
     - All objects are `.strict()` so unknown keys invalidate the flow.
     - Prefer reusing the `trimmedNonEmptyString` + `parse` patterns from `server/src/agents/commandsSchema.ts`.

3. [ ] Unit tests: flow schema validation
   - Test type: Unit (`node:test`)
   - Files to add/edit:
     - `server/src/test/unit/flows-schema.test.ts` (new)
   - Purpose:
     - Validate strict schema errors, trimming, and invalid shapes.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html

4. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (flow schema + `/flows` endpoint overview)
     - `projectStructure.md` (add `flows/` and new server files)

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual check: run the flow schema unit test and confirm invalid inputs fail as expected.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 2. Server: Flow discovery + list endpoint

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add flow discovery (scan `flows/` on each request) and expose `GET /flows` with disabled/error reporting for invalid flow files. This task provides the hot-reload listing without starting any flow runs.

#### Documentation Locations

- Node.js `fs/promises` + `path` (directory scanning + JSON file reads): https://nodejs.org/api/fs.html
- Express 5 response helpers (`res.json`, async handlers): Context7 `/expressjs/express/v5.1.0`
- JSON parsing errors + try/catch patterns: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing discovery + loader patterns to mirror behavior:
   - Documentation to read (repeat):
     - Node.js `fs/promises`: https://nodejs.org/api/fs.html
   - Files to read:
     - `server/src/agents/commandsLoader.ts`
     - `server/src/ingest/discovery.ts`
   - Goal:
     - Confirm how invalid JSON is surfaced as `disabled: true` with an error message.

2. [ ] Implement flow discovery with hot-reload scanning:
   - Documentation to read (repeat):
     - JSON.parse error handling: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - `server/src/flows/discovery.ts` (new)
   - Requirements:
     - Scan `flows/` on every request (no in-memory cache).
     - Ignore non-JSON files; missing folder returns `[]`.
     - Invalid JSON or schema produces `disabled: true` with a human-readable error.
     - Flow summary includes `{ name, description, disabled, error? }`.
     - `description` defaults to an empty string when missing.
     - Reuse agent command loader patterns (`loadAgentCommandSummary`) rather than new parsing rules when possible.

3. [ ] Add `GET /flows` route and register it:
   - Documentation to read (repeat):
     - Express `res.json`: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/flows.ts` (new)
     - `server/src/index.ts`
   - Requirements:
     - `GET /flows` returns `{ flows: FlowSummary[] }`.
     - Disabled flows include `error` text from validation/parsing.

4. [ ] Integration tests: flow discovery + list
   - Test type: Integration (`node:test`)
   - Files to add/edit:
     - `server/src/test/integration/flows.list.test.ts` (new)
     - `server/src/test/fixtures/flows/` (new fixtures)
   - Purpose:
     - Validate non-JSON ignore, missing folder handling, and `disabled` error text.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html

5. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (flow discovery + `/flows` endpoint overview)
     - `projectStructure.md` (add `flows/` and discovery/route files)

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: call `GET /flows` with valid + invalid fixtures and confirm `disabled/error` behavior.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 3. Server: Conversation flowName persistence

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add `flowName` to conversation persistence and summary types so flow conversations are stored and broadcast correctly. This task updates Mongo schema and WS summary payloads without filtering logic.

#### Documentation Locations

- Mongoose schema fields + optional indexes: Context7 `/automattic/mongoose/9.0.1`
- Express query parsing (`req.query`) and response helpers: Context7 `/expressjs/express/v5.1.0`
- WebSocket JSON message shape best practices: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current conversation schema and summary mapping:
   - Documentation to read (repeat):
     - Mongoose schema fields: Context7 `/automattic/mongoose/9.0.1`
   - Files to read:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/ws/sidebar.ts`
     - `server/src/ws/types.ts`

2. [ ] Add `flowName` to persistence + summary types:
   - Documentation to read (repeat):
     - Mongoose schema fields: Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/ws/types.ts`
     - `server/src/ws/sidebar.ts`
   - Requirements:
     - `flowName?: string` optional field on conversations.
     - Include `flowName` in `ConversationSummary` and WS sidebar summaries.
     - Ensure missing `flowName` is omitted (not `null`).
     - Ensure new flow conversations can set `flowName` at creation time via `createConversation` inputs.

3. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (conversation filters + flowName field)
     - `projectStructure.md` (if any files added/removed)

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: create a flow conversation and confirm WS sidebar payload includes `flowName`.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 4. Server: Conversation flowName filtering

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add `flowName` filtering to `GET /conversations` (`flowName=<name>` and `flowName=__none__`) so flows stay isolated from chat/agents. This task only touches query handling and list filtering logic.

#### Documentation Locations

- Express query parsing (`req.query`) and response helpers: Context7 `/expressjs/express/v5.1.0`
- Mongoose query filters: Context7 `/automattic/mongoose/9.0.1`
- Node.js test runner: https://nodejs.org/api/test.html
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Implement `flowName` filtering in `GET /conversations`:
   - Documentation to read (repeat):
     - Express query parsing: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/conversations.ts`
     - `server/src/mongo/repo.ts`
   - Requirements:
     - `flowName=<name>` returns only conversations with that `flowName`.
     - `flowName=__none__` returns only conversations without a `flowName`.
     - Preserve existing `agentName` and `state` filters.

2. [ ] Unit/integration tests: flowName list filtering
   - Test type: Unit + Integration (`node:test`)
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
     - `server/src/test/unit/conversations-router-agent-filter.test.ts`
     - `server/src/test/unit/repo-conversations-agent-filter.test.ts`
   - Purpose:
     - Validate `flowName=<name>` and `flowName=__none__` filtering.

3. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (conversation filter notes)

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: `GET /conversations?flowName=__none__` returns only non-flow conversations.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 5. Server: Flow run core (llm steps only)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement the flow run engine for linear `llm` steps, including `POST /flows/:flowName/run`, flow conversation creation (`title: Flow: <name>`), and sequential step execution. This task focuses on core execution without loops, break steps, commands, or resume support.

#### Documentation Locations

- Express async handlers + error propagation: Context7 `/expressjs/express/v5.1.0`
- AbortController usage (cancellation): https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Node.js timers (delays between steps if needed): https://nodejs.org/api/timers.html
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review agent run + inflight streaming helpers:
   - Documentation to read (repeat):
     - AbortController: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
   - Files to read:
     - `server/src/agents/service.ts`
     - `server/src/agents/commands.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/routes/agentsRun.ts`

2. [ ] Implement flow run service for sequential `llm` steps:
   - Documentation to read (repeat):
     - Express error handling: https://expressjs.com/en/guide/error-handling.html
   - Files to edit:
     - `server/src/flows/service.ts` (new)
     - `server/src/flows/types.ts` (new)
   - Requirements:
     - Load flow definition on each run (no caching).
     - Create flow conversation when missing; set `flowName` and `title`.
     - Execute `llm` steps sequentially using a flow step runner built from agent config (Codex home + system prompt).
     - Maintain an in-memory `agentConversations` map keyed by `${agentType}:${identifier}` for step reuse (persist later).
     - Use existing WS streaming bridge to emit transcript events to the flow conversation.
     - Persist user/assistant turns to the flow conversation (do not persist step turns into the agent-mapping conversations).
     - Convert each `messages[]` entry to a single instruction string (join `content` with `\n`).
     - Use agent config (`codexHome`, `useConfigDefaults`, `systemPrompt`) like `runAgentInstructionUnlocked`.
     - When a per-agent thread id exists, pass it via `threadId` so the same Codex thread continues.
     - Only include `systemPrompt` when starting a brand-new thread (no thread id stored yet).
     - Acquire/release the existing per-conversation run lock to prevent overlapping flow runs.
     - Propagate the flow inflight AbortSignal into each step so Stop cancels the active step.
     - Validate `working_folder` via the shared resolver and surface `WORKING_FOLDER_INVALID/NOT_FOUND` consistently.
     - Reuse `resolveWorkingFolderWorkingDirectory` and `tryAcquireConversationLock`/`releaseConversationLock` from the agents layer.

3. [ ] Add `POST /flows/:flowName/run` route:
   - Documentation to read (repeat):
     - Express request body parsing: https://expressjs.com/en/api.html#req.body
   - Files to edit:
     - `server/src/routes/flowsRun.ts` (new)
     - `server/src/index.ts`
   - Requirements:
     - Accept `{ conversationId?, working_folder? }`.
     - Return `202 { status: "started", flowName, conversationId, inflightId, modelId }`.
     - Mirror agent run validation for `working_folder` errors.
     - Missing flow file returns `404 { error: 'not_found' }`.
     - Invalid flow JSON/schema returns `400 { error: 'invalid_request' }`.
     - Archived conversations return `410 { error: 'archived' }`.
     - Concurrent runs on the same flow conversation return `409 { error: 'conflict', code: 'RUN_IN_PROGRESS' }`.

4. [ ] Integration tests: basic `llm` flow run:
   - Test type: Integration (`node:test`)
   - Files to add/edit:
     - `server/src/test/integration/flows.run.basic.test.ts` (new)
     - `server/src/test/fixtures/flows/` (extend with a simple llm-only flow)
   - Purpose:
     - Ensure `POST /flows/:flowName/run` returns 202 and streams a user turn + assistant delta.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html

5. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (flow run core + REST contract)
     - `projectStructure.md` (new flow service/routes)

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: trigger a basic flow and verify WS transcript events land on the flow conversation.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 6. Server: Loop + break step support

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend the flow runtime with nested loop support and `break` steps that evaluate a JSON `yes/no` response. This task introduces loop stack mechanics and validates break responses without adding command steps yet.

#### Documentation Locations

- JSON parsing + error handling patterns: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- AbortController usage: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing flow runtime implementation:
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/flows/flowSchema.ts`

2. [ ] Add loop stack execution for `startLoop`:
   - Files to edit:
     - `server/src/flows/service.ts`
   - Requirements:
     - Maintain a loop stack with current loop path + iteration count.
     - Execute nested `startLoop` steps recursively.
     - Ensure `break` exits only the nearest loop.

3. [ ] Implement `break` step handling:
   - Documentation to read (repeat):
     - JSON.parse error handling: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
   - Files to edit:
     - `server/src/flows/service.ts`
   - Requirements:
     - Ask the configured agent to answer `{ "answer": "yes" | "no" }`.
     - Validate JSON and `answer` shape; invalid responses fail the flow with clear errors.
     - Exit current loop only when response matches `breakOn`.
     - Emit `turn_final` with `status: 'failed'` on invalid JSON or invalid `answer` values.
     - Persist the final `answer` decision into flow turn content so it appears in the transcript.

4. [ ] Integration tests: nested loop + break behavior:
   - Test type: Integration (`node:test`)
   - Files to add/edit:
     - `server/src/test/integration/flows.run.loop.test.ts` (new)
     - `server/src/test/fixtures/flows/` (add a loop flow fixture)
   - Purpose:
     - Confirm loop iterations continue until `break` triggers.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html

5. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (loop stack + break step semantics)

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: run a loop flow and confirm the break response stops the loop.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 7. Server: Command step support

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add support for `command` steps that run agent command macros (`commands/<commandName>.json`) within a flow. This task loads and executes the command JSON using the flow step runner so results stream and persist into the flow conversation (not the agent conversation).

#### Documentation Locations

- Express error handling (invalid request responses): Context7 `/expressjs/express/v5.1.0`
- JSON schema validation patterns: Context7 `/colinhacks/zod`
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review agent command loader + schema:
   - Files to read:
     - `server/src/agents/commandsLoader.ts`
     - `server/src/agents/commandsSchema.ts`
     - `server/src/agents/service.ts`
     - `server/src/routes/agentsCommands.ts`

2. [ ] Implement `command` step execution in flow runtime:
   - Files to edit:
     - `server/src/flows/service.ts`
   - Requirements:
     - Validate `commandName` exists for the target `agentType`.
     - Load the command JSON and execute each item using the flow step runner (same streaming/persistence as `llm`).
     - Treat each command item as a sub-step under the same flow step metadata (no new flow step index).
     - Ensure errors surface as `turn_final` status `failed` with a clear message.

3. [ ] Integration tests: command step run:
   - Test type: Integration (`node:test`)
   - Files to add/edit:
     - `server/src/test/integration/flows.run.command.test.ts` (new)
     - `server/src/test/fixtures/flows/` (add a command step fixture)
   - Purpose:
     - Validate a command step succeeds and invalid commands fail with 400.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html

4. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (command step description + error handling)

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: run a flow containing a command step and verify the output appears in the flow transcript.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

### 8. Server: Resume state persistence

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Persist flow run state (step path, loop stack, agent conversation mapping, and per-agent thread ids) in `conversation.flags.flow`. This task stores resume state without enabling resume execution yet.

#### Documentation Locations

- Mongoose schema updates + nested objects: Context7 `/automattic/mongoose/9.0.1`
- JSON parsing + validation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing conversation flags handling:
   - Files to read:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/agents/service.ts`

2. [ ] Add `conversation.flags.flow` persistence shape:
   - Documentation to read (repeat):
     - Mongoose schema updates: Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/mongo/conversation.ts`
     - `server/src/mongo/repo.ts`
   - Requirements:
    - Store `stepPath`, `loopStack`, and `agentConversations` map.
    - Ensure flags remain optional and backward compatible.
    - Store per-agent `threadId` values keyed by `${agentType}:${identifier}` alongside `agentConversations`.
    - On run start, hydrate the in-memory agent map from `flags.flow` when present.
     - When a new agent mapping is needed, create a companion agent conversation (`agentName` set, title derived from flow + identifier) so thread ids can be persisted safely.

3. [ ] Unit tests: flow flags persistence
   - Test type: Unit (`node:test`)
   - Files to add/edit:
     - `server/src/test/unit/flows.flags.test.ts` (new)
   - Purpose:
     - Ensure `flags.flow` is stored and returned in conversation metadata.

4. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (resume state + `flags.flow` storage)

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: start a flow and confirm `flags.flow` is stored on the conversation document.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.

---

---

### 9. Server: Resume execution support

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Enable resume execution using `resumeStepPath` and stored `flags.flow` state. This task validates resume paths, detects agent mismatches, and persists step progress on stop/cancel.

#### Documentation Locations

- Express request validation patterns: Context7 `/expressjs/express/v5.1.0`
- JSON parsing + validation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Implement resume path validation + execution:
   - Files to edit:
     - `server/src/flows/service.ts`
     - `server/src/routes/flowsRun.ts`
   - Requirements:
     - Accept `resumeStepPath` (array of indices) in the run request.
     - Validate every index and return `400 invalid_request` on mismatch.
     - Resume uses stored `loopStack` and `agentConversations` when present.
     - Update `flags.flow.stepPath` after each completed step.
     - If a stored `agentConversations` id maps to a different agent, return `400 { error: 'agent_mismatch' }`.
     - On stop/cancel, persist the last completed `stepPath` for resume.
     - Update per-agent `threadId` mapping after each step when Codex emits a new thread id.
     - Prefer the thread id from `turn_final`/`thread` events over the flow conversation `flags.threadId`.

2. [ ] Integration tests: resume behavior + invalid resume path:
   - Test type: Integration (`node:test`)
   - Files to add/edit:
     - `server/src/test/integration/flows.run.resume.test.ts` (new)
   - Purpose:
     - Verify stop/resume from stored step path and invalid path errors.

3. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (resume execution notes)

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: stop a flow mid-run, resume with `resumeStepPath`, and confirm it continues.
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
- Express response shaping: https://expressjs.com/en/api.html#res.json
- WebSocket payload patterns: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current turn metadata usage:
   - Files to read:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/routes/conversations.ts`
     - `client/src/hooks/useChatStream.ts` (client rendering of command metadata)

2. [ ] Add flow-specific command metadata shape:
   - Documentation to read (repeat):
     - Mongoose subdocument fields: Context7 `/automattic/mongoose/9.0.1`
   - Files to edit:
     - `server/src/mongo/turn.ts`
     - `server/src/mongo/repo.ts`
     - `server/src/chat/interfaces/ChatInterface.ts` (parseCommandMetadata)
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/ws/types.ts`
   - Requirements:
     - `turn.command.name = "flow"`
     - Include `stepIndex`, `totalSteps`, `loopDepth`, `agentType`, `identifier`, and `label`.
     - Default `label` to the step `type` when omitted in the flow JSON.

3. [ ] Emit flow metadata on each flow step turn:
   - Files to edit:
     - `server/src/flows/service.ts`
   - Requirements:
     - Populate `turn.command` fields for every flow step.
     - Preserve existing agent step metadata where applicable.
     - Ensure inflight snapshots include the flow command metadata during streaming.

4. [ ] Integration tests: turn metadata in snapshots:
   - Test type: Integration (`node:test`)
   - Files to add/edit:
     - `server/src/test/integration/flows.turn-metadata.test.ts` (new)
     - `server/src/test/unit/chat-command-metadata.test.ts`
   - Purpose:
     - Verify `GET /conversations/:id/turns` includes `command` metadata for flow turns.
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html

5. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (flow turn metadata contract)

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: load a flow conversation and verify `command` metadata appears in the turn snapshot payload.
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
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing Agents API helpers:
   - Files to read:
     - `client/src/api/agents.ts`

2. [ ] Add flows API helpers:
   - Files to edit:
     - `client/src/api/flows.ts` (new)
   - Requirements:
     - `listFlows()` calling `GET /flows`.
     - `runFlow(flowName, payload)` calling `POST /flows/:flowName/run`.
     - Mirror error handling patterns from `client/src/api/agents.ts`.
     - Reuse the same abort + error parsing helpers as the Agents API if available.

3. [ ] Unit tests: flows API helpers
   - Test type: RTL/Jest
   - Files to add/edit:
     - `client/src/test/flowsApi.test.ts` (new)
   - Purpose:
     - Validate request URLs and error handling for `listFlows` and `runFlow`.

4. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md` (new API helper file)

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: call the new flows API helpers in a dev console and confirm successful responses.
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
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing Chat/Agents UI patterns for reuse:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/chat/ConversationList.tsx`
     - `client/src/hooks/useConversations.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/api/flows.ts`

2. [ ] Build Flows page UI:
   - Documentation to read (repeat):
     - MUI components: MUI MCP tool (`@mui/material@6.4.12`)
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx` (new)
     - `client/src/routes/router.tsx`
     - `client/src/components/NavBar.tsx`
   - Requirements:
     - Sidebar uses `ConversationList` filtered by `flowName`.
     - Main panel includes flow selector, run/resume controls, and transcript.
     - Display `command` metadata in bubble header (label + agentType/identifier).

3. [ ] Wire flow run/resume + stop controls:
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Start runs via `POST /flows/:flowName/run`.
     - Resume uses stored `resumeStepPath` when provided.
     - Stop uses existing `cancel_inflight` WS path.

4. [ ] Client tests (RTL): flows page basics:
   - Test type: RTL/Jest
   - Files to add/edit:
     - `client/src/test/flowsPage.test.tsx` (new)
   - Purpose:
     - Render Flows page, list flows, and verify metadata line rendering.
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`

5. [ ] Documentation updates:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `README.md` (new Flows page entry)
     - `design.md` (Flows UI description)
     - `projectStructure.md` (new client files)

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: open `/flows`, start a flow, and verify step headers render with label + agentType/identifier.
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
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Extend conversation summary + WS types for `flowName`:
   - Files to edit:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/hooks/useConversations.ts`
   - Requirements:
     - Add `flowName?: string` to client summary shapes.
     - Preserve `flowName` on WS sidebar upserts.

2. [ ] Update `useConversations` to accept `flowName` filter:
   - Files to edit:
     - `client/src/hooks/useConversations.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Support `flowName=<name>` and `flowName=__none__` query params.
     - Ensure Chat + Agents requests include `flowName=__none__` so flow conversations stay isolated.

3. [ ] Update/extend client tests for flow filtering:
   - Test type: RTL/Jest
   - Files to edit:
     - `client/src/test/useConversations.source.test.ts`
   - Purpose:
     - Confirm `flowName=__none__` is included in Chat/Agents list requests.

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: Chat/Agents sidebars no longer show flow conversations; Flows sidebar shows only the selected flow.
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
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI/options: https://prettier.io/docs/options
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Extend command metadata types + normalization:
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Requirements:
     - Extend command metadata types to include `loopDepth`, `label`, `agentType`, `identifier`.
     - Keep backward compatibility with existing command metadata tests.
     - Mirror server `TurnCommandMetadata` shape so parsing stays in sync.

2. [ ] Update/extend client tests for command metadata:
   - Test type: RTL/Jest
   - Files to edit:
     - `client/src/test/useConversationTurns.commandMetadata.test.ts`
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Purpose:
     - Confirm flow metadata fields survive normalization and do not break existing step line rendering.

3. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: flow step headers render extended metadata without breaking existing step lines.
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

1. [ ] Ensure `README.md` is updated with any required description changes and with any new commands that have been added as part of this story.
2. [ ] Ensure `design.md` is updated with any required description changes including Mermaid diagrams added for flows.
3. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders after all file additions/removals.
4. [ ] Create a summary of all changes and draft the PR comment for this story (server + client + tests).
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual check: run a flow end-to-end, stop mid-run, resume, and verify sidebar filtering by `flowName`.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here.
