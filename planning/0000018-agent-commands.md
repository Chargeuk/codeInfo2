# Story 0000018 – Agent commands (macros) via UI + REST + Agents MCP

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

For now this document only defines **Description**, **Acceptance Criteria**, **Out Of Scope**, and **Questions**. Tasks will be added after the Questions section is resolved.

---

## Description

Today, using agents for repeatable workflows (for example: improving/refining a story plan) requires manually copying/pasting a series of prompts into the Agents UI or MCP calls. This is slow, error-prone, and makes it hard to repeat a known-good workflow consistently.

We want to introduce **Agent Commands**: predefined, named “macros” stored alongside an agent (e.g. `codex_agents/planning_agent/commands/improve_plan.json`). A user can select a command from a dropdown in the Agents page and run it either in a new agent conversation or within an existing agent conversation. The UI should show the command’s name in the dropdown, show the command’s `Description` when selected, and provide a button to execute the command. The UI should not show the underlying JSON.

This functionality must also be exposed via the existing Agents MCP (port `5012`) so external tooling can list and run agent commands. Both the GUI (via REST) and MCP must call into the same shared server code for discovery, validation, and execution—there should not be separate “client-runner” and “server-runner” implementations.

### Key behavior

- Each agent may optionally have a `commands/` folder containing `*.json` command files.
- The list of available commands is refreshed every time commands are listed (REST or MCP), and the UI refreshes the list whenever the selected agent changes.
- Executing a command runs through its steps sequentially, feeding each step into the agent (reusing `conversationId` between steps).
- Commands accept an optional `working_folder` (absolute path), reusing the existing Agents “working folder” input field and the existing server-side resolution/mapping logic from Story `0000017`.

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

Legacy compatibility (required for this story):

- If a command file uses the existing legacy schema:
  - `Events: { Chat_Input: string }[]`
- Then it is treated as:
  - `items: [{ type: "message", role: "user", content: [Chat_Input] }, ...]`

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
     - `agentName: string`
     - `commandName: string`
     - `conversationId: string` (always returned)
     - `modelId: string`
     - `steps: Array<{ role: "user"; content: string[]; segments: unknown[] }>`

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
  - Command name is derived from filename (no JSON “title” field required in v1).
  - REST exposes `GET /agents/:agentName/commands` returning `{ commands: [{ name, description }] }`.
  - Agents MCP exposes a `list_commands` tool that can list by agent or list all.

- Agent command execution (shared server path):
  - There is exactly one server-side implementation that:
    1) loads a command JSON file,
    2) validates it,
    3) normalizes legacy `Events/Chat_Input` into `items`,
    4) executes steps sequentially by calling the existing agent runner,
    5) returns aggregated results.
  - Both REST and Agents MCP call the shared implementation (no client-side step execution loop).
  - Commands can be run:
    - with `conversationId` (continue existing conversation), or
    - without `conversationId` (start new conversation).
  - Commands accept optional `working_folder` and reuse Story `0000017` rules (absolute path required; host mapping attempted under `HOST_INGEST_DIR`; fallback to literal directory; errors are safe).

- Agents UI:
  - When the selected agent changes, the UI fetches and replaces the commands list for that agent.
  - UI shows:
    - a dropdown of command names,
    - the selected command’s `Description`,
    - an “Execute” button.
  - UI does not show the command JSON.
  - If the working folder field is populated, it is passed as `working_folder` when executing the selected command.
  - After execution completes, the UI shows each command step’s prompt content and the agent’s response for that step (using returned `steps[]` data).

- Validation rules (KISS; enforce only what we need now):
  - Command file must be valid JSON.
  - `Description` must be a non-empty string.
  - Either `items` or legacy `Events` must be present (after normalization, `items.length >= 1`).
  - Supported item types:
    - only `type: "message"` in this story.
  - For `message` items:
    - `role` must be `"user"`.
    - `content` must be a non-empty string array.
  - Guardrails:
    - Reject commands with too many items (cap to a small, documented max).
    - Reject command files over a small, documented max size.
    - Reject `commandName` containing path separators (`/`, `\\`) or `..` (prevents traversal).

- Error codes (stable, safe, reused across REST and MCP):
  - Existing agent errors must continue to work (`AGENT_NOT_FOUND`, `CODEX_UNAVAILABLE`, `CONVERSATION_ARCHIVED`, `AGENT_MISMATCH`, `WORKING_FOLDER_INVALID`, `WORKING_FOLDER_NOT_FOUND`).
  - New command errors:
    - `COMMAND_NOT_FOUND` – requested `commandName` does not exist for that agent.
    - `COMMAND_INVALID` – JSON parse failure, schema invalid, unsupported item type/role.
    - `COMMAND_TOO_LARGE` – file too large or too many items.
  - REST mapping:
    - `AGENT_NOT_FOUND` → 404
    - `COMMAND_NOT_FOUND` → 404
    - `COMMAND_INVALID` → 400 with `{ error: "invalid_request", code: "COMMAND_INVALID", message: "..." }`
    - `COMMAND_TOO_LARGE` → 400 with `{ error: "invalid_request", code: "COMMAND_TOO_LARGE", message: "..." }`
    - `WORKING_FOLDER_*` → 400 (existing behavior)
  - MCP mapping:
    - invalid params (including `COMMAND_*` and `WORKING_FOLDER_*`) must be returned as invalid-params style tool errors with safe messages.

---

## Out Of Scope

- Streaming command execution results step-by-step to the UI (v1 may be synchronous and return the final aggregated result).
- Partial execution controls (run step ranges, skip steps, retry a failed step).
- UI editing/creating commands from the browser.
- A richer command metadata model (`title`, `tags`, `icons`, keyboard shortcuts).
- Non-message command item types (e.g. “pause/confirm”, “set variable”, “select file”, “run tool directly”).
- Running commands in the main Chat UI (non-agents).
- Persisting command run groupings as a first-class “CommandRun” entity in MongoDB (v1 may rely on existing conversation/turn persistence).

---

## Questions

1. Should command execution be allowed to run “assistant” or “system” messages as steps, or do we want to enforce `role: "user"` only in v1 (recommended for KISS)?
2. Do you want **legacy** support for the current committed command schema (`Events` + `Chat_Input`) in v1, or is it acceptable to migrate existing command JSON files to the new `items/type/message` shape as part of this story?
3. Maximum guardrails:
   - What max command file size should we enforce (e.g. 64KB)?
   - What max `items` length should we enforce (e.g. 50)?
4. Error surface:
   - For `GET /agents/:agentName/commands`, if a command JSON is invalid, should we:
     - skip it silently,
     - skip it but include a `warnings[]` list,
     - or include it in the list with a `disabled: true` flag and a warning?
5. Should `list_commands` without `agentName` return commands for **all** agents, or only for agents that have a `commands/` folder?
6. Naming:
   - Is “commandName” (filename) the only identifier, or do you want a stable explicit id field inside the JSON (recommended: filename-only for v1)?

