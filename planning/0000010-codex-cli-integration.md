# Story 0000010 – Codex CLI provider integration (draft)

## Description

Introduce Codex as an optional chat provider using the `@openai/codex-sdk`, which shells out to the locally installed Codex CLI with cached auth. The server should detect Codex availability, route chat requests through the SDK, and (when possible) expose our existing tools via an MCP server by steering Codex to a repo-local `CODEX_HOME`/`config.toml`. Client users can pick Codex alongside LM Studio; Codex stays hidden in environments without the CLI/auth. This draft captures intent and open questions before tasks and acceptance are finalized.

### Rough Plan
  - Codex home/config
      - Use a repo-local git-ignored `./codex/` as the Codex home directory, but do not set global CODEX_HOME; instead, expose `CODEINFO_CODEX_HOME` env and pass it as `CODEX_HOME` inside CodexOptions when instantiating the SDK. This avoids interfering with users’ personal Codex config.
      - Construct the Codex client with CodexOptions env: { CODEX_HOME: <abs path from CODEINFO_CODEX_HOME> } so the CLI bridge reads our config (including MCP servers) instead of ~/.codex.
      - Users must manually log in the Codex CLI against this repo-specific home; no auto-copy of ~/.codex/auth.json.
  - MCP wiring
      - Run a lightweight MCP server inside our Node process that exposes our existing tools (ListIngestedRepositories, VectorSearch). Bind it to 127.0.0.1:<port>.
      - In codex_home/config.toml, register that MCP server under [mcp] so Codex sees it without API keys.
      - On startup, generate/update codex_home/config.toml from a template with the chosen port and feature flags; keep it gitignored but document the template path.
  - Provider adapter
      - Add a “codex” provider in the server chat router that:
          - Checks which codex and ~/.codex/auth.json (or copied auth) on boot; only enables if present.
          - Creates a Codex client with CodexOptions { env: { CODEX_HOME }, model: selected Codex model, threadOptions as needed }.
          - Streams deltas → our SSE frames (token/final/complete/error) with provider: 'codex'.
          - If MCP startup or handshake fails, block Codex sends and surface an error popup; tools are required (no chat-only fallback). Mark toolsAvailable: false so the UI disables Codex.
  - Client changes
      - /chat/models returns provider-grouped entries with a toolsAvailable flag; Codex entries disabled with guidance when CLI/auth/MCP is unavailable.
      - Add a Provider dropdown left of Model with options LMStudio and OpenAI Codex; models list filters per provider. Provider is locked for the current conversation; models can change. New conversation keeps the provider.
      - Move the message input to a multiline field beneath the Provider/Model row alongside Send; keep New conversation on the top row.
      - Hide citations/tool blocks when toolsAvailable is false; show inline guidance about Codex requiring local CLI login and MCP.
      - Codex model list is fixed to `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, and `gpt-5.1` when the provider is OpenAI Codex.
  - Config/flags to bake in
      - Auto-detect Codex: if the CLI is not found or auth/config is missing, log a startup warning and expose Codex as disabled with guidance (no CODEX_ENABLED switch).
      - CODEINFO_CODEX_HOME (path, default ./codex), CODEX_TOOL_TIMEOUT_MS, CODEX_MCP_PORT. Tool availability is governed by config.toml; no separate toggle.
      - Docker enablement (opt-in): install the Codex CLI in images (`npm install -g @openai/codex`), mount CODEINFO_CODEX_HOME (e.g., ./codex:/app/codex), set CODEINFO_CODEX_HOME=/app/codex in the container env, and ensure users log in inside the container or provide a trusted auth.json in the mounted volume. Without these, Codex remains disabled with guidance in Docker/e2e.

## Acceptance Criteria (draft, now parameterised)

- Codex provider uses `gpt-5.1-codex-max` by default when available via the CLI/SDK bridge.
- MCP tool access is required; if MCP handshake fails, the client is blocked from sending to Codex and receives a clear error popup (no chat-only fallback).
- Auth expectation: user must manually log in the Codex CLI under the configured `CODEX_HOME`; README documents the login step and custom home path. No automatic copying of `~/.codex/auth.json`.
- Repository uses a git-ignored `codex/` directory as the default `CODEX_HOME`; all Codex config/auth files live there and stay out of version control.
- Provider selection UI: chat page adds a Provider dropdown (left of Model) with options `LMStudio` and `OpenAI Codex`; the Models dropdown filters to the chosen provider.
- Conversation constraints: provider cannot be switched mid-conversation; model can be switched. New conversation keeps the chosen provider.
- Input layout: message text input becomes multi-line, placed under the Provider/Model row alongside the Send button; New conversation stays on the top row. No front-end rate/timeout enforcement.

## Out Of Scope

- Permanent exposure of Codex in Docker/e2e environments (CLI/auth not available there).
- Billing/key management changes beyond using the existing Codex CLI login.

## Questions

Resolved:
- Default model: use `gpt-5.1-codex-max`.
- MCP failure: block Codex sends and show an error popup (no chat-only fallback).
- Auth: user must manually log in under the configured `CODEX_HOME`; document in README; no auto-copy of `~/.codex/auth.json`.
- UI: show both providers; models list depends on provider; provider locked per conversation; multi-line input under selectors; new conversation stays on top row.
- Front-end rate/timeouts: none enforced in UI.

Open items (to confirm before tasking):
- Exact wording/location of the Codex login instructions in README and any warning banner in the chat page.
- Whether to hide Codex entirely when CLI/auth is missing, or show disabled with guidance. **Decision:** show disabled with guidance.

# Implementation Plan

## Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks.
This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

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

To be defined once acceptance criteria are finalized.
