# Story 0000027 - Flows mode

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Introduce a new **Flows** mode that orchestrates a logical sequence of agent steps (not tied to a single agent conversation). Flow definitions live on disk under `flows/<flowName>.json`, and each flow step selects a predefined Codex agent plus an identifier. The runtime reuses the previous `conversationId` for each `agentType + identifier` grouping, so steps can continue the same agent thread across the flow.

Flows support nested loops via `startLoop`/`endLoop`, and a `break` step that asks an LLM a provided question and expects a JSON yes/no response. If the configured `breakOn` answer is returned, the current loop is exited. A flow run has its own merged conversation transcript stored and streamed just like existing chat/agent conversations; the UI shows a single flow entry in the sidebar and renders each step with its result plus the agent type/identifier in the message bubbles. Users can stop a flow mid-execution and later resume from a stored step index. Flow definitions are hot-reloaded using the same mechanism as agent commands. Optional step labels can be set in the flow JSON for UI display, and each persisted flow turn should include step metadata (index, loop depth) so the UI can display it alongside the bubble. LLM steps use a `messages` array (like agent commands). Break steps specify a concrete agent + identifier for the JSON response, and the server exposes REST endpoints mirroring the Agents API. Flow conversations are titled `Flow: <name>` by default.
Flow runs also accept an optional `working_folder`, mirroring the agent run behavior.

---

## Acceptance Criteria

- Flow definitions are discovered from `flows/<flowName>.json` on disk and are hot-reloaded without a server restart (same hot-reload behavior as agent commands).
- A new flow JSON schema exists (distinct from agent commands) with required `steps: []` and step objects that include `type` plus optional `label` for UI display.
- Supported step `type` values are `startLoop`, `endLoop`, `llm`, and `break`.
- `llm` steps require `agentType` (Codex agent name from the Agents dropdown) and `identifier` fields, plus `messages` in the same shape used by agent commands (role + content array).
- `break` steps require `agentType`, `identifier`, `question`, and `breakOn: "yes" | "no"` and must instruct the agent to return JSON in the shape `{ "answer": "yes" | "no" }` for the break decision.
- Nested loops are supported by the runtime using a loop stack; `break` exits only the current loop defined by the closest `startLoop`/`endLoop` pair.
- Flow runs persist a merged flow conversation and stream events to the client using the same protocol as chat/agent runs.
- Flow conversations default to the title `Flow: <name>` and appear as a single item in the sidebar.
- The flow UI has a new **Flows** menu entry; the sidebar supports the same conversation management features as the existing conversations list.
- The main flow view renders each step and its result, including agent type, identifier, optional step label, and step metadata.
- Flow turn metadata includes step index and loop depth, persisted and surfaced in the UI bubbles.
- Users can stop a running flow, and later resume it from a stored step index.
- The flow runtime reuses the previous `conversationId` per `agentType + identifier` grouping when available, otherwise starts a new conversation for that grouping.
- The server exposes flow REST endpoints mirroring the Agents API surface, including list flows and run flow endpoints.
- Flow run endpoints accept optional `working_folder` (same validation as Agents), and optional resume input (conversation id + resume step index) to restart mid-flow.

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

# Implementation Plan

## Instructions

These instructions will be followed during implementation.

# Tasks

Tasks will be added after the Questions section is resolved.
