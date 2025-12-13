# Story 0000016 – LLM Agents (GUI + MCP 5012)

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

It introduces “LLM agents”: named, Codex-only assistants with their own Codex home/config folder, exposed:

- In the GUI as a new **Agents** page.
- Via a new MCP JSON-RPC server on port **5012**, with:
  - one tool to list available agents
  - one tool to run an instruction for a named agent (with thread continuation via `conversationId`)

This story must heavily reuse existing chat infrastructure (`ChatInterface`, `ChatInterfaceCodex`, persistence, and `McpResponder`) and must not add provider/model selection for agents. Agents always use the existing Codex defaults.

## Description

Today, the product supports interactive chat and codebase Q&A. We want to add a new concept: **agents**.

An agent is a named Codex assistant that can be invoked from a dedicated **Agents** page and via a dedicated MCP server. Users can:

- see a list of available agents
- send an instruction to an agent
- continue an existing agent thread by providing a `conversationId` (same semantics as existing conversations)

Agents should behave like chat/codebase_question in terms of streaming and structured output (thinking + vector summaries + answer), but differ in that each agent uses its own Codex configuration folder under a new root, and each agent can have its own system prompt.

## Acceptance Criteria

- A new GUI page exists: `/agents` (and navigation entry “Agents”).
- The Agents page can:
  - list all available agents
  - run an instruction against an agent
  - continue a prior run by reusing a `conversationId`
  - render results in the same segment format as `codebase_question` (`thinking`, `vector_summary`, `answer`).
- A new MCP v2-style JSON-RPC server runs on port **5012** and exposes exactly two tools:
  - `list_agents`
  - `run_agent_instruction`
- `run_agent_instruction`:
  - requires `agentName` + `instruction`
  - accepts optional `conversationId`
  - always uses provider `codex`
  - always uses the same default Codex model/reasoning/sandbox/web-search/approval settings as the existing Codex chat defaults
  - returns `content: [{ type: "text", text: "<json>" }]` where the JSON includes `{ conversationId, modelId, agentName, segments }`
  - uses the same segment semantics as `codebase_question`.
- A new env var exists: `CODEINFO_CODEX_AGENT_HOME`.
  - Agents are stored under `${CODEINFO_CODEX_AGENT_HOME}/${agentName}`.
  - Example: `codex_agents/coding_agent/config.toml` maps to agent home `codex_agents/coding_agent`.
- Startup auth seeding:
  - If an agent home does not contain `auth.json`, and the primary Codex home (existing `CODEINFO_CODEX_HOME`) *does* contain `auth.json`, then `auth.json` is copied into that agent home on startup.
  - This occurs for all agents at startup (idempotent: do not overwrite existing agent `auth.json`).
- Docker / Compose:
  - `codex_agents/` is mounted into the server container.
  - `CODEINFO_CODEX_AGENT_HOME` points to that mount path.
- Documentation updated: `README.md`, `design.md`, `projectStructure.md`.

## Out Of Scope

- Provider/model selection for agents (Codex-only, fixed defaults).
- Adding more than two MCP tools for agents.
- Merging existing MCP surfaces; the new agent MCP server is an additional port.
- Agent scheduling, background jobs, webhooks, or multi-user auth separation.
- Any change that requires committing secrets or `auth.json` into git.

## Questions



# Implementation Plan

## Instructions

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

### 1. Refactor Codex creation to support per-agent Codex home (no global env mutation)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Agents require per-agent Codex configuration folders (home). The current Codex integration must be refactored so Codex instances can be created with an explicit home/config location (or equivalent), without mutating global process env per request (which is unsafe under concurrency).

This is a prerequisite for everything else in this story.

#### Documentation Locations

- Codex CLI + SDK usage (local repo docs):
  - `README.md` (Codex config seed + env vars)
  - `design.md` (MCP v2 + Codex details)
- Node.js env + process model: Context7 `/nodejs/node`
- TypeScript: Context7 `/microsoft/typescript`

#### Subtasks

1. [ ] Identify how `CODEINFO_CODEX_HOME` is currently resolved and passed into Codex (e.g. `server/src/config/codexConfig.ts` and `server/src/chat/interfaces/ChatInterfaceCodex.ts`).
2. [ ] Introduce a new abstraction for “Codex home” that can be provided at Codex factory creation time (not via `process.env` mutation per request).
3. [ ] Update `ChatInterfaceCodex` (and any other Codex entry points) to accept the configured Codex home explicitly via the factory/deps.
4. [ ] Add/extend unit/integration tests proving:
   - two concurrent Codex interface constructions can use different homes without leaking state
   - existing non-agent chat behavior still uses the primary Codex home by default.
5. [ ] Update any related docs in `design.md` describing the new Codex home injection mechanism.
6. [ ] Run full linting for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes


---

### 2. Agent discovery + startup auth seeding + docker wiring

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement agent discovery from `CODEINFO_CODEX_AGENT_HOME`, validate each agent folder shape, and seed missing `auth.json` from the primary Codex home when available. Update Docker/Compose so agent folders are mounted into containers correctly.

#### Documentation Locations

- Existing env + docker notes: `README.md`, `design.md`, `docker-compose.yml`
- Node.js filesystem APIs: Context7 `/nodejs/node`
- Docker docs: Context7 `/docker/docs`

#### Subtasks

1. [ ] Define an “agent folder contract” (minimum: `<agentHome>/config.toml`; optional: `<agentHome>/system_prompt.md`; optional: `<agentHome>/auth.json`).
2. [ ] Implement agent discovery utility (returns id/name + paths + any warnings) and unit tests.
3. [ ] Implement startup auth seeding:
   - copy `${CODEINFO_CODEX_HOME}/auth.json` to `${CODEINFO_CODEX_AGENT_HOME}/${agentName}/auth.json` when missing
   - never overwrite an existing agent `auth.json`
   - do not crash startup if auth is missing; surface an explicit “agent disabled” state instead.
4. [ ] Update Dockerfile/compose wiring to mount `codex_agents/` into the server container and set `CODEINFO_CODEX_AGENT_HOME` accordingly.
5. [ ] Ensure `codex_agents/**/auth.json` is gitignored and not included in Docker build contexts.
6. [ ] Update `README.md` with:
   - agent folder layout
   - required env vars
   - how to add a new agent folder.
7. [ ] Run full linting for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up` (verify env + mount behavior)
5. [ ] `npm run compose:down`

#### Implementation notes


---

### 3. Implement Agents MCP server (port 5012) with `list_agents` and `run_agent_instruction`

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Create a new MCP v2-style JSON-RPC server on port 5012 to expose agents to external clients. It must reuse existing ChatInterface + McpResponder patterns and persist conversations/turns like existing MCP runs.

#### Documentation Locations

- Existing MCP v2 server patterns:
  - `server/src/mcp2/*`
  - `design.md` MCP sections
- Model Context Protocol spec:
  - https://modelcontextprotocol.io/
  - https://github.com/modelcontextprotocol/specification
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
- Node.js HTTP servers + tests: Context7 `/nodejs/node`
- TypeScript: Context7 `/microsoft/typescript`

#### Subtasks

1. [ ] Add a new server entrypoint for agents MCP:
   - Port `5012` (env override allowed, default 5012)
   - Reuse `server/src/mcpCommon/*` dispatcher helpers
2. [ ] Implement tool registry:
   - `list_agents` returns agent list derived from `CODEINFO_CODEX_AGENT_HOME`
   - `run_agent_instruction` runs an instruction for a named agent
3. [ ] Define input schema for `run_agent_instruction`:
   - required: `agentName`, `instruction`
   - optional: `conversationId`
4. [ ] Implement `run_agent_instruction` by reusing:
   - `ChatInterfaceCodex` with explicit per-agent Codex home injection
   - `McpResponder` so output segments match `codebase_question`
   - conversation persistence with `source: 'MCP'` and flags capturing `agentName` + per-agent codex flags.
5. [ ] Per-agent system prompt:
   - when starting a new conversation (no `conversationId`), prepend a system block sourced from `${agentHome}/system_prompt.md` (or empty when missing)
   - do not affect existing chat/system context.
6. [ ] Add characterization tests for `5012` server:
   - tools/list returns exactly the two tools
   - run_agent_instruction returns segments and preserves conversationId across calls
   - validation and “agent not found/disabled” error mappings are stable.
7. [ ] Run full linting for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`

#### Implementation notes


---

### 4. Add Agents GUI page (`/agents`) and navigation

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add a new UI surface to manage and run agents. The UI should feel like the existing chat/codebase Q&A experience but without provider/model selectors. It must render the same structured segments as the MCP results.

#### Documentation Locations

- Existing chat UI patterns:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/components/Markdown.tsx`
  - `client/src/hooks/useChatStream.ts`
- MUI component references: use the MUI MCP tool (required by AGENTS.md)

#### Subtasks

1. [ ] Add route `/agents` and a new NavBar entry “Agents”.
2. [ ] Create a client API module for agents:
   - call the server’s agent API surface (REST wrapper around 5012 or direct server route, to be decided in implementation)
   - `listAgents()` and `runAgentInstruction({ agentName, instruction, conversationId? })`
3. [ ] Build Agents page UI:
   - agent selector (from listAgents)
   - instruction text area + submit
   - optional conversationId input (for continuation)
   - result view rendering segments (`thinking`, `vector_summary`, `answer`) consistent with `codebase_question` rendering expectations
4. [ ] Add client tests (RTL/Jest):
   - renders agent list
   - runs an instruction and displays segments
   - continues a conversationId and shows updated results.
5. [ ] Update `README.md` with Agents page usage.
6. [ ] Run full linting for touched workspaces.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes


---

### 5. Final task – verify against acceptance criteria

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Validate all acceptance criteria, run full builds/tests, validate clean docker builds/compose startup, and perform manual verification with Playwright screenshots saved under `./test-results/screenshots/`.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/
- Repo docs: `README.md`, `design.md`, `projectStructure.md`

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] Perform a clean docker build
4. [ ] Ensure `README.md` is updated with any required description changes and with any new commands that have been added as part of this story
5. [ ] Ensure `design.md` is updated with any required description changes including mermaid diagrams that have been added as part of this story
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run test --workspace server`
3. [ ] Restart the docker environment
4. [ ] `npm run e2e`
5. [ ] Use the Playwright MCP tool to manually check:
   - `/agents` loads and can run an instruction
   - MCP `5012` server responds to initialize/tools/list/tools/call
   - screenshots saved to `./test-results/screenshots/` named like `0000016-05-agents.png`, `0000016-05-mcp-5012.png`

#### Implementation notes


---

