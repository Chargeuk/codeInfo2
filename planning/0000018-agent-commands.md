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
- Command-run turns appear as normal agent chat turns, but each turn created by a command run is annotated so the UI can show a small “Command run: <name>” note inside the chat bubble.
- Command runs are cancellable: cancelling stops the in-flight step (best-effort) and prevents any subsequent steps from running.

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

Legacy compatibility:

- Not required in v1. Existing command JSON files (including the current example `improve_plan.json`) will be migrated to the canonical `items/type/message` format as part of this story’s tasks.

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
    3) normalizes legacy `Events/Chat_Input` into `items`,
    4) executes steps sequentially by calling the existing agent runner,
    5) returns aggregated results.
  - Both REST and Agents MCP call the shared implementation (no client-side step execution loop).
  - Commands can be run:
    - with `conversationId` (continue existing conversation), or
    - without `conversationId` (start new conversation).
  - Commands accept optional `working_folder` and reuse Story `0000017` rules (absolute path required; host mapping attempted under `HOST_INGEST_DIR`; fallback to literal directory; errors are safe).
  - Command execution returns a minimal REST payload `{ agentName, commandName, conversationId, modelId }`; the client refreshes turns to render outputs.
  - Cancellation:
    - Cancelling a command run stops the current in-flight step best-effort (abort provider call) and guarantees no further steps execute.
    - Cancelling must not append partial/empty follow-up steps after the cancel occurs.

- Agents UI:
  - When the selected agent changes, the UI fetches and replaces the commands list for that agent.
  - UI shows:
    - a dropdown of command names (display label replaces `_` with spaces; underlying value remains the filename-derived `name`),
    - the selected command’s `Description`,
    - an “Execute” button.
  - UI does not show the command JSON.
  - If the working folder field is populated, it is passed as `working_folder` when executing the selected command.
  - After execution completes, the UI shows each command step’s prompt content and the agent’s response for that step by re-fetching turns (no special step payload required).
  - Each command-run-created turn shows a small “Command run: <commandName>” note inside the chat bubble.

- Validation rules (KISS; enforce only what we need now):
  - Command file must be valid JSON.
  - `Description` must be a non-empty string.
  - Either `items` or legacy `Events` must be present (after normalization, `items.length >= 1`).
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
  - Listing invalid commands:
    - When listing commands, invalid command files must still appear in the list as disabled entries (so users can see something exists but cannot run it).
    - Disabled entries may use a placeholder description (for example “Invalid command file”) if the JSON cannot be parsed.
  - REST mapping:
    - `AGENT_NOT_FOUND` → 404
    - `COMMAND_NOT_FOUND` → 404
    - `COMMAND_INVALID` → 400 with `{ error: "invalid_request", code: "COMMAND_INVALID", message: "..." }`
    - `WORKING_FOLDER_*` → 400 (existing behavior)
  - MCP mapping:
    - invalid params (including `COMMAND_*` and `WORKING_FOLDER_*`) must be returned as invalid-params style tool errors with safe messages.

---

## Out Of Scope

- Streaming command execution results step-by-step to the UI (v1 may be synchronous and return only `{ conversationId, modelId, ... }`).
- Partial execution controls (run step ranges, skip steps, retry a failed step).
- UI editing/creating commands from the browser.
- A richer command metadata model (`title`, `tags`, `icons`, keyboard shortcuts).
- Non-message command item types (e.g. “pause/confirm”, “set variable”, “select file”, “run tool directly”).
- Running commands in the main Chat UI (non-agents).
- Persisting a separate “CommandRun” collection/entity in MongoDB (v1 uses a simple per-turn metadata field instead).

---

## Questions

(none)
