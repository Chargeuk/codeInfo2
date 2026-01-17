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

Flows support nested loops via `startLoop`/`endLoop`, and a `break` step that asks an LLM a provided question and expects a JSON yes/no response. If the configured `breakOn` answer is returned, the current loop is exited. A flow run has its own merged conversation transcript stored and streamed just like existing chat/agent conversations; the UI shows a single flow entry in the sidebar and renders each step with its result plus the agent type/identifier in the message bubbles. Users can stop a flow mid-execution and later resume from a stored step index. Optional step labels can be set in the flow JSON for UI display, and each persisted flow turn should include step metadata (index, loop depth) so the UI can display it alongside the bubble. LLM steps use a `messages` array (like agent commands). Break steps specify a concrete agent + identifier for the JSON response, and the server exposes REST endpoints mirroring the Agents API. Flow conversations are titled `Flow: <name>` by default. Flow runs also accept an optional `working_folder`, mirroring the agent run behavior.

---

## Acceptance Criteria

- Flow definitions are discovered from `flows/<flowName>.json` on disk and are hot-reloaded without a server restart by re-reading the directory on each request (same pattern as agent discovery and command listing).
- A new flow JSON schema exists (distinct from agent commands) with a required top-level `steps: []`, optional top-level `description`, and step objects that include `type` plus optional `label` for UI display.
- Supported step `type` values are `startLoop`, `endLoop`, `llm`, and `break`. Loop boundaries are matched only by nesting (no loop ids).
- `llm` steps require `agentType` (Codex agent name from the Agents dropdown), `identifier`, and `messages` entries shaped like `{ role, content: string[] }` (same message payload used by agent commands).
- `break` steps require `agentType`, `identifier`, `question`, and `breakOn: "yes" | "no"` and must instruct the agent to return JSON in the shape `{ "answer": "yes" | "no" }` for the break decision.
- Nested loops are supported by the runtime using a loop stack; `break` exits only the current loop defined by the closest `startLoop`/`endLoop` pair.
- Flow JSON validation is strict (unknown keys invalid) and mirrors agent command validation rules for trimming/empty checks; invalid JSON or schema errors still appear in the list but with `disabled: true` and a human-readable error message.
- Non-JSON files in `flows/` are ignored and missing `flows/` returns an empty list (same behavior as missing agent command folders).
- `GET /flows` returns `{ flows: [{ name, description, disabled, error? }] }`, where `name` is the filename stem and `description` is the top-level flow description (empty string when missing).
- `POST /flows/:flowName/run` returns `202 { status: "started", flowName, conversationId, inflightId, modelId }` and accepts optional `working_folder`, `conversationId`, and `resumeStepIndex` fields to resume a stopped flow.
- Flow runs persist a merged flow conversation and stream events to the client using the same protocol as chat/agent runs.
- Conversations gain an optional `flowName` field; flow runs set `flowName` to the flow name so they can be filtered separately from chat/agent conversations.
- `GET /conversations` accepts `flowName` filtering (exact match), and `flowName=__none__` returns conversations without a flow name (mirrors `agentName` filtering).
- Flow conversations default to the title `Flow: <name>` and appear as a single item in the sidebar.
- The flow UI has a new **Flows** menu entry; the sidebar supports the same conversation management features as the existing conversations list.
- The main flow view renders each step and its result, including agent type, identifier, optional step label, and step metadata.
- Each flow turn persists step metadata under `turn.command` with at least `{ name: "flow", stepIndex, totalSteps, loopDepth, agentType, identifier, label? }`, and the UI uses this metadata in the bubble.
- Users can stop a running flow, and later resume it from a stored step index.
- Stopping a flow uses the existing `cancel_inflight` WebSocket event and produces a `turn_final` event with `status: "stopped"` for the flow conversation.
- Flow run state for resume is stored under `conversation.flags.flow` with at least `{ stepIndex, loopStack, agentConversations }` and is updated after each completed step.
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

---

## Implementation Ideas

- **Flow discovery + validation (server):** mirror agent command loading by adding a `server/src/flows/` module that scans `flows/` on each request (no cache), ignores non-JSON files, and returns summaries `{ name, description, disabled, error? }`. Use Zod `.strict()` schemas with `z.string().trim()` plus `safeParse` to mirror `server/src/agents/commandsSchema.ts` behavior for trimming and invalid/disabled handling. A separate schema module keeps list/run validation consistent across REST + MCP.
- **REST surface (server):** add routes similar to `server/src/routes/agents.ts` and `server/src/routes/agentsRun.ts`, plus register them in `server/src/index.ts`. `GET /flows` delegates to the flow list service, `POST /flows/:flowName/run` validates body, returns 202 with `conversationId`/`inflightId`/`modelId`, and supports `working_folder`, `conversationId`, and `resumeStepIndex`.
- **Flow runtime (server):** create `server/src/flows/service.ts` modeled after `server/src/agents/service.ts`. Use `createInflight`, `publishUserTurn`, and `attachChatStreamBridge` to stream over the existing WS protocol; reuse `abortInflight` from `server/src/chat/inflightRegistry.ts` via the existing `cancel_inflight` WS event path. Persist flow state under `conversation.flags.flow` and update it after each step for resumability.
- **Conversation persistence updates:** extend `server/src/mongo/conversation.ts` to add `flowName` (and index it), and update `server/src/mongo/repo.ts` + `server/src/routes/conversations.ts` to support `flowName` and `flowName=__none__` filtering, mirroring `agentName` semantics. Extend `server/src/mongo/turn.ts` to store flow metadata under `command` (e.g., `stepIndex`, `totalSteps`, `loopDepth`, `agentType`, `identifier`, `label`).
- **Agent reuse per grouping:** maintain a `agentConversations` map in `conversation.flags.flow` keyed by `agentType+identifier`. On each `llm`/`break` step, reuse prior `conversationId` from the map or start a new one via the agents run helper.
- **UI (client):** create a `FlowsPage` using the same Drawer layout as `client/src/pages/ChatPage.tsx`/`AgentsPage.tsx`, and add a new top-level nav entry. Reuse `client/src/components/chat/ConversationList.tsx` with a new `variant=\"flows\"`, and load data via `useConversations({ flowName })` once server filtering exists. Bubble metadata lines already render `message.command` in Chat/Agents; extend `buildStepLine` (or shared helper) to show flow label + loop depth.
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
- `POST /flows/:flowName/run` body: `{ working_folder?, conversationId?, resumeStepIndex? }`
  - `working_folder` should use the same validation as Agents (`working_folder` may be omitted)
  - `conversationId` and `resumeStepIndex` together indicate resume-from-step
  - `resumeStepIndex` is a zero-based index into the `steps` array
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

### Conversation state (resume)

- Flow resume state stored in `conversation.flags.flow`:
  - `stepIndex`: last completed step index
  - `loopStack`: array of `{ startStepIndex, endStepIndex }` frames
  - `agentConversations`: map keyed by `${agentType}:${identifier}` → `conversationId`

### Flow JSON Example (for clarity)

```json
{
  "description": "Summarize, refine, and iterate until done.",
  "steps": [
    { "type": "startLoop", "label": "Main loop" },
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
      "type": "break",
      "label": "Check for completion",
      "agentType": "coding_agent",
      "identifier": "summary",
      "question": "Is the summary complete? Reply as JSON {\"answer\":\"yes\"|\"no\"}.",
      "breakOn": "yes"
    },
    { "type": "endLoop" }
  ]
}
```

- Each `messages` entry uses `{ role, content: string[] }` matching agent command message items.
- `startLoop`/`endLoop` carry no required fields other than `type` (optional `label`).

---

# Implementation Plan

## Instructions

These instructions will be followed during implementation.

# Tasks

Tasks will be added after the Questions section is resolved.
