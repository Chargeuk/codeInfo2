# Story 0000016 – LLM Agents (GUI + MCP 5012)

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

It introduces “LLM agents”: named, Codex-only assistants with their own Codex home/config folder, exposed:

- In the GUI as a new **Agents** page.
- Via a new MCP JSON-RPC server on port **5012**, with:
  - one tool to list available agents
  - one tool to run an instruction for a named agent (with thread continuation via `conversationId`)

This story must heavily reuse existing chat infrastructure (`ChatInterface`, `ChatInterfaceCodex`, persistence, and `McpResponder`) and must not add provider/model selection for agents. Agents always use the existing Codex *run flag defaults* (sandbox/websearch/network/approval/reasoning), but use a per-agent system prompt from `system_prompt.txt` when present and otherwise run with **no** system prompt (global `SYSTEM_CONTEXT` disabled for agent runs).

## Description

Today, the product supports interactive chat and codebase Q&A. We want to add a new concept: **agents**.

An agent is a named Codex assistant that can be invoked from a dedicated **Agents** page and via a dedicated MCP server. Users can:

- see a list of available agents
- send an instruction to an agent
- continue an existing agent thread by providing a `conversationId` (same semantics as existing conversations)

Agents should behave like chat/codebase_question in terms of streaming and structured output (thinking + vector summaries + answer), but differ in that each agent uses its own Codex configuration folder under a new root, and each agent can have its own system prompt.

Agent conversations must be persisted just like existing chats, but must carry explicit metadata indicating which agent they belong to so the existing Chat page remains “clean” (shows only non-agent conversations) while the Agents page shows only conversations for the selected agent.

## Acceptance Criteria

- A new GUI page exists: `/agents` (and navigation entry “Agents”).
- The Agents page can:
  - list all available agents
  - display agent descriptions when provided
  - run an instruction against an agent
  - continue a prior run by selecting a prior conversation (API uses `conversationId`)
  - render results in the same segment format as `codebase_question` (`thinking`, `vector_summary`, `answer`).
- Agents page controls and behavior:
  - The top controls are limited to: agent selector dropdown, **Stop**, and **New conversation**.
  - Changing the selected agent:
    - aborts/stops any in-progress run
    - resets the current conversation to a new conversation state (as if New conversation was clicked)
    - refreshes the side panel so it shows past conversations for the selected agent
  - An information block is shown for the selected agent, rendering its `description` (when present).
- Agent conversation separation:
  - Agent runs create/persist conversations and turns in MongoDB (same persistence model as existing chat).
  - Each agent conversation stores the agent identifier in conversation metadata as a top-level optional field `conversation.agentName`.
  - Agent conversations do **not** persist agent execution flags (sandbox/websearch/network/approval/reasoning) into `Conversation.flags`; those are fixed server defaults. `Conversation.flags` is reserved for Codex continuation metadata (such as `threadId`).
  - The existing Chat page conversation list shows only non-agent conversations (agentName absent).
  - The Agents page conversation list is filtered to only show conversations for the currently selected agent.
- The server exposes an agents listing endpoint (to be used by both the GUI and MCP):
  - returns agent `name` and optional `description` (from `description.md` when present)
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
- Agent discovery:
  - Available agents are derived from the folder structure inside `CODEINFO_CODEX_AGENT_HOME`.
  - Any direct subfolder containing `config.toml` is considered an available agent.
  - The `agentName` is the subfolder name.
  - If `${agentHome}/description.md` exists, its contents are returned as the agent `description` in list responses.
- Auth seeding (runs on every discovery read):
  - Every time the agent home folders are read/validated (for `list_agents`, UI list refresh, or server-side agent lookups), the system must attempt auth seeding.
  - If an agent home does not contain `auth.json`, and the primary Codex home (existing `CODEINFO_CODEX_HOME`) *does* contain `auth.json`, then `auth.json` is copied into that agent home.
  - This is idempotent: never overwrite an existing agent `auth.json`.
- Per-agent system prompt:
  - If `${CODEINFO_CODEX_AGENT_HOME}/${agentName}/system_prompt.txt` exists, it is used as the agent system prompt for new conversations.
  - If it does not exist, the agent runs with no system prompt.
  - Note: this is implemented as a first-turn instruction prefix (not a dedicated model “system” channel) to avoid changing Codex adapter plumbing.
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

- Task Status: __done__
- Git Commits: 2855bc0, e447c75, 3355edd, 7fe7cc8, c8d01e3, 3ec07e7, fc4d30b, e6a2528, 9907c5f, 9807854, fcbba34

#### Overview

Agents require per-agent Codex configuration folders (home). The current Codex integration must be refactored so Codex instances can be created with an explicit home/config location (or equivalent), without mutating global process env per request (which is unsafe under concurrency).

This is a prerequisite for everything else in this story.

#### Documentation Locations

- Codex (SDK + local config):
  - `node_modules/@openai/codex-sdk/README.md` (Threads, `runStreamed()`, and how Codex is configured via options/env like `CODEX_HOME`)
  - `README.md` (app-level Codex config seeding + env vars used by this repo)
  - `design.md` (how this repo wires Codex + MCP v2 + thread model)
- Node.js: Context7 `/nodejs/node` (process/env behavior, `path`, `fs`, and concurrency constraints that make process-wide env mutation unsafe)
- TypeScript: Context7 `/microsoft/typescript` (type-safe factory signatures and optional param threading)
- Mongoose: Context7 `/automattic/mongoose` (required in this task for `$set` updates when persisting only `flags.threadId`)
- Mermaid diagrams (for documenting new flows in `design.md`): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Add explicit “Codex home override” helpers in `server/src/config/codexConfig.ts`.
   - Docs to read (this subtask):
     - `README.md` (Codex home + seeding behavior)
     - Node path APIs: Context7 `/nodejs/node`
   - Files to read:
     - `server/src/config/codexConfig.ts`
   - Files to edit:
     - `server/src/config/codexConfig.ts`
   - Implementation steps:
     - Add `export function resolveCodexHome(overrideHome?: string): string` that returns an absolute path and falls back to the existing `CODEINFO_CODEX_HOME ?? './codex'`.
     - Add “for-home” helpers so callers can compute paths without mutating env:
       - `getCodexConfigPathForHome(codexHome: string): string`
       - `getCodexAuthPathForHome(codexHome: string): string`
     - Keep existing exported functions (`getCodexHome`, `getCodexConfigPath`, `getCodexAuthPath`) working as they do today by delegating to the new helpers with no override.
   - Verify:
     - Run `npm run lint --workspace server` (must exit 0).
     - Run `npm run format:check --workspace server` (must exit 0).
2. [x] Update `buildCodexOptions()` to accept an explicit codex home override (no global env mutation).
   - Docs to read (this subtask):
     - Node env model: Context7 `/nodejs/node`
   - Files to read:
     - `server/src/config/codexConfig.ts`
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Files to edit:
     - `server/src/config/codexConfig.ts`
   - Implementation steps:
     - Change signature to `buildCodexOptions(params?: { codexHome?: string }): CodexOptions`.
     - Ensure it sets `CODEX_HOME` in the options env using the resolved absolute home (override when provided), and still spreads `...process.env`:
       ```ts
       return { env: { ...process.env, CODEX_HOME: resolvedHome } };
       ```
     - Do **not** write to `process.env` at runtime.
   - Verify:
     - Run `npm run lint --workspace server` (must exit 0).
3. [x] Update Codex detection so it can validate an arbitrary codex home.
   - Docs to read (this subtask):
     - Node fs APIs: Context7 `/nodejs/node`
   - Files to read:
     - `server/src/providers/codexDetection.ts`
     - `server/src/config/codexConfig.ts`
   - Files to edit:
     - `server/src/providers/codexDetection.ts`
   - Implementation steps:
     - Add a new exported helper `detectCodexForHome(codexHome: string): CodexDetection` that:
       - does **not** call `setCodexDetection()` (must not mutate the process-wide cached detection used by `/chat`)
       - checks CLI availability plus `auth.json` + `config.toml` inside the provided `codexHome` using the new “for-home” helpers
     - Keep the existing `detectCodex()` behavior unchanged for primary Codex home:
       - continues to update the global cached detection via `setCodexDetection()` (as used today by `/chat` and MCP v2 availability checks)
   - Verify:
     - Run `npm run lint --workspace server` (must exit 0).
4. [x] Update `ChatInterfaceCodex` to support agent runs safely (per-agent detection + per-agent system prompt, without leaking prompts into persisted user messages).
   - Docs to read (this subtask):
     - `design.md` (Codex usage + thread model)
     - `server/src/routes/chat.ts` (current Codex flow: conversationId vs threadId, and how flags are persisted/merged)
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/providers/codexDetection.ts`
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Implementation steps:
     - Extend the internal `CodexRunFlags` parsing to support:
       - `codexHome?: string` (absolute or relative path)
       - `disableSystemContext?: boolean` (when true, do not use `SYSTEM_CONTEXT` at all)
       - `systemPrompt?: string` (agent-provided system prompt text; must only apply on the first turn of a thread)
     - Replace the current global-only availability check:
       - If `codexHome` is provided, call `detectCodexForHome(codexHome)` and use its `.available/.reason` for the preflight check.
       - Otherwise, keep using the existing cached `getCodexDetection()` preflight behavior.
     - System prompt behavior (critical for agents):
       - Preserve the current behavior for normal chat/codebase_question when no new flags are provided.
       - For agents, the prompt must be applied **inside** `ChatInterfaceCodex.execute()` (like existing `SYSTEM_CONTEXT` behavior) so the system prompt does **not** appear in persisted user turns.
       - Apply `systemPrompt` only when starting a new thread (`!threadId`).
       - When `disableSystemContext === true`, do not apply `SYSTEM_CONTEXT` even on a new thread.
   - Verify:
     - Run `npm run lint --workspace server` (must exit 0).
5. [x] Make thread id persistence safe: update only `flags.threadId` without overwriting other `flags` keys.
   - Docs to read (this subtask):
     - Mongoose update operators: Context7 `/automattic/mongoose`
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/mongo/repo.ts`
   - Files to edit:
     - `server/src/mongo/repo.ts`
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Implementation steps:
     - Add a new repo helper (explicit name) in `server/src/mongo/repo.ts`:
       - `updateConversationThreadId({ conversationId, threadId }: { conversationId: string; threadId: string })`
     - Implement it using a `$set` update so it only updates `flags.threadId` (does not replace `flags`):
       - `$set: { 'flags.threadId': threadId }`
     - Update `ChatInterfaceCodex` to call this helper when Codex emits a new thread id.
   - Verify:
     - Run `npm run test --workspace server` (must exit 0).
6. [x] Server unit test (Node `node:test`): Codex home override sets `CODEX_HOME` correctly.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Create `server/src/test/unit/codexConfig.test.ts`
   - Purpose:
     - Prevent regressions where per-agent Codex home injection silently uses the wrong folder.
   - Test description:
     - `buildCodexOptions({ codexHome: '/tmp/x' })` sets `env.CODEX_HOME` to the resolved absolute path.
   - Verify:
     - `npm run test --workspace server`
7. [x] Server unit test (Node `node:test`): persisting Codex thread id does not clobber other `flags` keys.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Update `server/src/test/unit/chat-interface-codex.test.ts`
   - Purpose:
     - Ensure the new `$set: { 'flags.threadId': ... }` behavior cannot accidentally overwrite other persisted metadata under `flags`.
   - Test description:
     - Create a conversation with existing `flags` keys (e.g. `{ someOtherKey: true }`), then run the thread id update path and assert `someOtherKey` is still present after updating `flags.threadId`.
   - Verify:
     - `npm run test --workspace server`
8. [x] Update docs to record the new Codex home override mechanism.
   - Docs to read (this subtask):
     - `design.md`
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Implementation steps:
     - Document: primary Codex home (`CODEINFO_CODEX_HOME`) vs agent Codex homes (`CODEINFO_CODEX_AGENT_HOME/<agent>`).
     - Document: “no global env mutation”; codex home is injected via factory/options.
     - Add a Mermaid diagram showing the Codex creation flow (Chat/Agents) with an explicit `codexHome` passed into the Codex factory/options (no process env mutation).
   - Verify:
     - Run `npm run format:check --workspace server` (must exit 0).
9. [x] Update `projectStructure.md` for new files added by this task.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure the repository’s documented structure includes any newly created test files.
   - Required updates:
     - Add the new server unit test files created in this task under the Server section (unit tests).
10. [x] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - `/chat` loads; can start/continue a Codex chat; Stop works; no console errors.
   - `codebase_question` still streams and returns `{ thinking, vector_summary, answer }` segments (no regressions after Codex home override refactor).
9. [x] `npm run compose:down`

#### Implementation notes

- Added codex-home helper functions in `server/src/config/codexConfig.ts` (`resolveCodexHome`, `getCodexConfigPathForHome`, `getCodexAuthPathForHome`) and updated existing getters to delegate, enabling per-home path computation without process env mutation.
- Updated `buildCodexOptions()` to accept `{ codexHome?: string }` and inject `CODEX_HOME` into the Codex SDK options env without mutating `process.env`.
- Added `detectCodexForHome(codexHome)` in `server/src/providers/codexDetection.ts` to validate CLI/auth/config for an arbitrary Codex home without mutating the process-wide cached detection used by `/chat`.
- Extended `server/src/chat/interfaces/ChatInterfaceCodex.ts` run flags with `codexHome`, `disableSystemContext`, and `systemPrompt`, adding per-home preflight detection and first-turn prompt prefixing that does not affect persisted user turns.
- Added `updateConversationThreadId()` in `server/src/mongo/repo.ts` to `$set` only `flags.threadId`, and updated `ChatInterfaceCodex` to use it when persisting new thread ids.
- Added a unit test (`server/src/test/unit/codexConfig.test.ts`) ensuring `buildCodexOptions({ codexHome })` resolves and injects `env.CODEX_HOME` correctly.
- Added a unit test in `server/src/test/unit/chat-interface-codex.test.ts` asserting the thread-id update path uses `$set: { 'flags.threadId': ... }` so other `flags` keys cannot be overwritten.
- Documented primary vs override Codex homes and the “no process env mutation” injection flow in `design.md`, including a Mermaid diagram for the Codex home selection path.
- Updated `projectStructure.md` to include the new `server/src/test/unit/codexConfig.test.ts` unit test entry.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces` successfully.
- Completed Task 1 verification runs: server/client builds, server/client tests, full `npm run e2e`, docker compose build/up/down, and a Playwright + MCP smoke of `/chat` (Codex send/stop) and `codebase_question` response shape.

---

### 2. Mongo + repo: store `agentName` on conversations (top-level optional)

- Task Status: __done__
- Git Commits: 4985d74, 77a4b1e, f92dad5

#### Overview

Agent conversations must be persisted like normal conversations, but tagged with which agent they belong to so:

- the existing Chat page can stay “clean” (shows only non-agent conversations)
- the Agents page can show only the selected agent’s conversations

This task adds a top-level optional `Conversation.agentName?: string` and threads it through the server persistence layer.

#### Documentation Locations

- Conversation persistence overview: `design.md` (Conversation persistence section)
- Mongoose schema basics: Context7 `/automattic/mongoose`
- Node `node:test` (unit test harness used by server tests in this task): https://nodejs.org/api/test.html
- Mermaid diagrams (for documenting new persistence fields/flows in `design.md`): Context7 `/mermaid-js/mermaid`
- Existing persistence code:
  - `server/src/mongo/conversation.ts`
  - `server/src/mongo/repo.ts`

#### Subtasks

1. [x] Add `agentName?: string` to the Conversation model.
   - Docs to read (this subtask):
     - Mongoose schema definitions: Context7 `/automattic/mongoose`
   - Files to read:
     - `server/src/mongo/conversation.ts`
   - Files to edit:
     - `server/src/mongo/conversation.ts`
   - Implementation steps:
     - Add `agentName?: string` to the `Conversation` TypeScript interface.
     - Add `agentName` to the schema definition (optional).
     - Add an index to support filtered listing later (keep existing index too):
       - `{ agentName: 1, archivedAt: 1, lastMessageAt: -1 }`
   - Verify:
     - `npm run build --workspace server`
2. [x] Thread `agentName` through repo helpers (create + list).
   - Docs to read (this subtask):
     - Mongoose `.lean()` usage: Context7 `/automattic/mongoose`
   - Files to read:
     - `server/src/mongo/repo.ts`
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Implementation steps:
     - Add optional `agentName?: string` to `CreateConversationInput`.
     - Persist `agentName` when creating a conversation.
     - Add optional `agentName?: string` to `ConversationSummary` and include it in `listConversations()` return items.
   - Verify:
     - `npm run build --workspace server`
3. [x] Add unit tests proving `agentName` mapping (no real DB required).
   - Docs to read (this subtask):
     - Node `node:test`: https://nodejs.org/api/test.html
   - Files to read (existing stubbing pattern):
     - `server/src/test/unit/repo-persistence-source.test.ts`
   - Files to edit:
     - `server/src/test/unit/repo-persistence-source.test.ts`
   - Test expectations (concrete):
     - Stub `ConversationModel.find(...).sort(...).limit(...).lean()` to return a doc containing `agentName: 'coding_agent'`.
     - `listConversations()` returns an item where `agentName === 'coding_agent'`.
   - Verify:
     - `npm run test --workspace server`
4. [x] Update docs.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Implementation steps:
     - Document `Conversation.agentName?: string` and how it separates Chat vs Agents history.
     - Add/extend a Mermaid diagram showing the conversation model/persistence flow including the new `agentName` field and the “Chat = __none__ vs Agents = named agent” separation.
5. [x] Update `projectStructure.md` for schema/index changes.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure the architecture/docs inventory reflects new data model fields and any server-side schema/index adjustments.
   - Required updates:
     - Note the conversation model update location(s) and that conversations can now be tagged with `agentName`.
6. [x] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - `/chat` loads; conversation list renders; existing non-agent conversations behave unchanged.
   - Creating/running a normal chat does not set `agentName` and still appears on the Chat page history.
9. [x] `npm run compose:down`

#### Implementation notes

- Added optional `Conversation.agentName?: string` to `server/src/mongo/conversation.ts` with an additional compound index `{ agentName: 1, archivedAt: 1, lastMessageAt: -1 }` to support future filtered listings.
- Threaded `agentName` through `server/src/mongo/repo.ts` (`CreateConversationInput` and `ConversationSummary`) without defaulting it, so non-agent conversations keep `agentName` absent.
- Extended `server/src/test/unit/repo-persistence-source.test.ts` to assert `listConversations()` preserves `agentName` from lean docs while still defaulting `source` when missing.
- Updated `design.md` and `projectStructure.md` to document how `agentName` separates Chat vs Agents histories.
- Ran Task 2 verification: server/client builds, server/client tests, full `npm run e2e`, compose build/up/down, and a Playwright check that a normal Chat message still creates a visible history entry.

---

### 3. Agent discovery (filesystem list + optional description + system prompt presence)

- Task Status: __done__
- Git Commits: fda15d4, b194fb6

#### Overview

Implement agent discovery from `CODEINFO_CODEX_AGENT_HOME`.

Definition of an “available agent”:

- It is a **direct subfolder** of `CODEINFO_CODEX_AGENT_HOME`
- It contains a `config.toml` file
- The agent name is the folder name

Agent metadata to expose:

- Optional `description` read from `description.md` (Markdown) when present
- Optional `system_prompt.txt` **presence** (for later use in Task 7 when starting a new conversation)

Note: auth seeding is a separate concern and is implemented in Task 4. Task 4 will also wire auth seeding into the discovery read path.

#### Documentation Locations

- Agent folder conventions: this story’s Acceptance Criteria + `README.md`
- Node.js filesystem APIs: Context7 `/nodejs/node`
- Reference for file-copy conventions: `server/src/utils/codexAuthCopy.ts`
- Mermaid diagrams (for documenting agent discovery flow in `design.md`): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [x] Create agent discovery types (REST-safe + internal).
   - Docs to read (this subtask):
     - TypeScript type exports: Context7 `/microsoft/typescript`
   - Files to create:
     - `server/src/agents/types.ts`
   - Required exports (exact):
     - `export type AgentSummary = { name: string; description?: string; disabled?: boolean; warnings?: string[] };`
     - `export type DiscoveredAgent = AgentSummary & { home: string; configPath: string; descriptionPath?: string; systemPromptPath?: string };`
2. [x] Implement agent discovery.
   - Docs to read (this subtask):
     - Node `fs.readdir` / `fs.promises.readdir`: Context7 `/nodejs/node`
   - Files to create:
     - `server/src/agents/discovery.ts`
   - Implementation steps:
     - Read `CODEINFO_CODEX_AGENT_HOME` (throw a clear error if missing).
     - Scan only direct subfolders.
     - Include a folder only if `${agentHome}/config.toml` exists.
     - Read `${agentHome}/description.md` as UTF-8 if present and include it.
     - If `${agentHome}/system_prompt.txt` exists, set `systemPromptPath` (do not read contents in this task).
     - Sort agents alphabetically by `name` for deterministic output.
3. [x] Server unit test (Node `node:test`): discovery includes folders with `config.toml`.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Create `server/src/test/unit/agents-discovery.test.ts`
   - Purpose:
     - Ensure the “direct subfolder containing config.toml” rule is enforced and stable.
   - Test description:
     - Create `tmp/agentsRoot/coding_agent/config.toml` and assert `discoverAgents()` returns `coding_agent`.
4. [x] Server unit test (Node `node:test`): discovery ignores folders without `config.toml`.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Update `server/src/test/unit/agents-discovery.test.ts`
   - Purpose:
     - Prevent accidental discovery of incomplete/invalid agent folders.
   - Test description:
     - Create `tmp/agentsRoot/invalid_agent/` with no `config.toml` and assert it is not returned.
5. [x] Server unit test (Node `node:test`): discovery reads optional `description.md`.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Update `server/src/test/unit/agents-discovery.test.ts`
   - Purpose:
     - Ensure agent metadata shown in UI and MCP is sourced from disk as expected.
   - Test description:
     - Create `description.md` and assert returned agent includes `description` text.
6. [x] Server unit test (Node `node:test`): discovery detects optional `system_prompt.txt` presence.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Update `server/src/test/unit/agents-discovery.test.ts`
   - Purpose:
     - Ensure the run path can reliably determine if an agent has a system prompt available (used as a Codex system prompt override on the first turn, per Task 7).
   - Test description:
     - Create `system_prompt.txt` and assert returned agent includes a defined `systemPromptPath`.
7. [x] Update docs.
   - Files to edit:
     - `README.md`
   - Implementation steps:
     - Document agent folder layout:
       - required: `config.toml`
       - optional: `description.md`
       - optional: `system_prompt.txt`
8. [x] Update architecture docs (design + Mermaid) for discovery rules.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Make the agent discovery rules and metadata sources obvious to new contributors.
   - Implementation steps:
     - Add a Mermaid flow diagram for “Agent discovery” showing:
       - `CODEINFO_CODEX_AGENT_HOME` → scan direct subfolders → require `config.toml` → optionally read `description.md` / detect `system_prompt.txt`.
9. [x] Update `projectStructure.md` for new agents modules.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure newly added server agent modules and tests are documented in the repo structure.
   - Required updates:
     - Add entries for:
       - `server/src/agents/types.ts`
       - `server/src/agents/discovery.ts`
       - the new discovery unit test file(s)
10. [x] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e`
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check:
   - `/chat` loads with `CODEINFO_CODEX_AGENT_HOME` set; no console errors.
   - If agents UI is not implemented yet, confirm existing Chat UX still works end-to-end (send message, stop, reload).
9. [x] `npm run compose:down`

#### Implementation notes

- Implemented filesystem discovery (`server/src/agents/discovery.ts`) keyed off `CODEINFO_CODEX_AGENT_HOME`, scanning only direct subfolders and requiring `config.toml`.
- Added typed outputs (`server/src/agents/types.ts`) separating REST-safe summary fields from internal path metadata.
- Added unit coverage (`server/src/test/unit/agents-discovery.test.ts`) for config inclusion/exclusion, `description.md` reading, and `system_prompt.txt` presence detection.
- Updated `README.md` and `design.md` with agent folder conventions + a discovery Mermaid flow.
- Updated `projectStructure.md` to list the new modules/tests.
- Verification run: server build, client build, server tests, client tests, full `npm run e2e`, compose build/up/down. Compose `/chat` route was also checked via HTTP fetch during the manual step (no agent UI is expected yet in this task).

---

### 4. Auth seeding for agents (runs on every discovery read)

- Task Status: __in_progress__
- Git Commits: __to_do__

#### Overview

Every time the agent folders are read/checked (listing agents, running an agent), we must attempt to ensure each agent folder has an `auth.json` file when possible:

- If `${agentHome}/auth.json` is missing
- and the primary Codex home (`CODEINFO_CODEX_HOME`) contains `auth.json`
- then copy it into `${agentHome}/auth.json`
- never overwrite
- best-effort: never throw, only warn
- lock-protected: prevent concurrent requests racing to write the same file

This task implements that logic and wires it into the discovery read path so it runs on every discovery.

#### Documentation Locations

- Existing auth copy helper (reference implementation style):
  - `server/src/utils/codexAuthCopy.ts`
  - `server/src/test/unit/codexAuthCopy.test.ts`
- Node.js filesystem APIs: Context7 `/nodejs/node`
- Mermaid diagrams (for documenting auth seeding flow in `design.md`): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Implement agent auth seeding helper (best-effort, never overwrites).
   - Docs to read (this subtask):
     - Node fs APIs: Context7 `/nodejs/node`
   - Files to read:
     - `server/src/utils/codexAuthCopy.ts`
   - Files to create:
     - `server/src/agents/authSeed.ts`
   - Implementation steps:
     - Export a helper like:
       - `ensureAgentAuthSeeded({ agentHome, primaryCodexHome, logger }): { seeded: boolean; warning?: string }`
     - It must:
       - no-op if `${agentHome}/auth.json` exists
       - no-op if `${primaryCodexHome}/auth.json` does not exist
       - otherwise copy primary → agent
       - never throw; return a warning string on failure
2. [ ] Add an in-process mutex so concurrent calls do not race writes.
   - Docs to read (this subtask):
     - Promise chaining as a mutex: Context7 `/nodejs/node`
   - Files to edit:
     - `server/src/agents/authSeed.ts`
   - Implementation steps:
     - Implement a module-level lock (Promise chain or small mutex helper).
     - Ensure concurrent calls to `ensureAgentAuthSeeded` serialize copy attempts.
3. [ ] Wire auth seeding into discovery so it runs on every discovery read.
   - Docs to read (this subtask):
     - Task 3 discovery requirements in this story
   - Files to edit:
     - `server/src/agents/discovery.ts`
   - Implementation steps:
     - For each discovered agent, call `ensureAgentAuthSeeded(...)` best-effort.
     - If it returns a warning, append it to `warnings[]` on the agent summary.
     - Do not throw if seeding fails (listing should still work).
4. [ ] Server unit test (Node `node:test`): auth seeding copies primary `auth.json` into agent home when missing.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Create `server/src/test/unit/agents-authSeed.test.ts`
   - Purpose:
     - Ensure agent folders become runnable without requiring separate `codex login` per agent.
   - Test description:
     - Create `primary/auth.json` and an empty `agentHome/`, run `ensureAgentAuthSeeded(...)`, assert `agentHome/auth.json` exists and matches.
5. [ ] Server unit test (Node `node:test`): auth seeding never overwrites existing agent `auth.json`.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Update `server/src/test/unit/agents-authSeed.test.ts`
   - Purpose:
     - Protect against accidentally replacing agent-specific auth.
   - Test description:
     - Create both `primary/auth.json` and `agentHome/auth.json`, run seeding, assert agent auth content is unchanged.
6. [ ] Server unit test (Node `node:test`): auth seeding is lock-protected (concurrent calls do not race/throw).
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Update `server/src/test/unit/agents-authSeed.test.ts`
   - Purpose:
     - Prevent flakey behavior in production when multiple requests trigger discovery at once.
   - Test description:
     - Kick off two `ensureAgentAuthSeeded(...)` calls concurrently for the same agent home and assert both complete without throwing and `auth.json` exists.
7. [ ] Ensure secrets are excluded from git and docker build contexts.
   - Docs to read (this subtask):
     - Docker build context + `.dockerignore`: Context7 `/docker/docs`
   - Files to read:
     - `.gitignore` (confirm `codex_agents/**/auth.json` is ignored)
   - Files to edit/create:
     - If repo-root `.dockerignore` does not exist, create it.
     - Ensure it contains:
       - `codex_agents/**/auth.json`
       - `codex/**/auth.json`
8. [ ] Update docs.
   - Files to edit:
     - `README.md`
   - Implementation steps:
     - Document that auth is auto-copied from `CODEINFO_CODEX_HOME` into agent folders when missing.
     - Document that `auth.json` must never be committed.
9. [ ] Update architecture docs (design + Mermaid) for auth seeding flow.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Make the auth seeding behavior explicit and reviewable (including “best-effort” + locking).
   - Implementation steps:
     - Add a Mermaid flow diagram for “Auth seeding on discovery read” showing:
       - discovery read → for each agent: if missing `auth.json` and primary has `auth.json` then copy (never overwrite) → warnings on failure → continue listing.
10. [ ] Update `projectStructure.md` for new auth seeding modules/files.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure the new auth seeding helper and any related test/support files are discoverable from the project structure docs.
   - Required updates:
     - Add entries for:
       - `server/src/agents/authSeed.ts`
       - any new unit test file(s) created for auth seeding
       - `.dockerignore` (if created by this task)
11. [ ] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/chat` loads; no console errors; normal chat still runs.
   - Verify no unexpected writes under `codex_agents/` when running the app without any agent discovery calls (auth seeding should be discovery-triggered and best-effort).
9. [ ] `npm run compose:down`

#### Implementation notes


---

### 5. Docker/Compose wiring for agent homes

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Ensure agent folders under `CODEINFO_CODEX_AGENT_HOME` are available inside Docker/Compose environments and that env vars and mounts are configured consistently for:

- local dev (server running on host)
- main compose stack (`docker-compose.yml`)
- e2e compose stack (`docker-compose.e2e.yml`)

This task also exposes the Agents MCP port (`5012`) in compose so external clients can connect to it once Task 9 is implemented.

#### Documentation Locations

- Docker docs (bind mounts + ports): Context7 `/docker/docs`
- Mermaid diagrams (for documenting deployment wiring in `design.md`): Context7 `/mermaid-js/mermaid`
- Files to edit in this task:
  - `docker-compose.yml`
  - `docker-compose.e2e.yml`
  - `server/.env`
  - `README.md`

#### Subtasks

1. [ ] Update main compose (`docker-compose.yml`) to mount agent homes and expose Agents MCP port.
   - Docs to read (this subtask):
     - Docker Compose volumes + ports: Context7 `/docker/docs`
   - Files to edit:
     - `docker-compose.yml`
   - Implementation steps (exact):
     - Under `services.server.environment`, add:
       - `CODEINFO_CODEX_AGENT_HOME=/app/codex_agents`
       - `AGENTS_MCP_PORT=5012`
     - Under `services.server.ports`, add:
       - `'5012:5012'`
     - Under `services.server.volumes`, add a **rw** mount (auth seeding writes `auth.json`):
       - `./codex_agents:/app/codex_agents`
   - Verify:
     - `docker compose -f docker-compose.yml config` (must print a valid merged config)
2. [ ] Update e2e compose (`docker-compose.e2e.yml`) to mount agent homes and expose Agents MCP port.
   - Docs to read (this subtask):
     - Docker Compose volumes + ports: Context7 `/docker/docs`
   - Files to edit:
     - `docker-compose.e2e.yml`
   - Implementation steps (exact):
     - Under `services.server.ports`, add:
       - `'6012:5012'`
     - Under `services.server.environment`, add:
       - `CODEINFO_CODEX_AGENT_HOME=/app/codex_agents`
       - `AGENTS_MCP_PORT=5012`
     - Under `services.server.volumes`, add:
       - `./codex_agents:/app/codex_agents`
   - Verify:
     - `docker compose -f docker-compose.e2e.yml config` (must print a valid merged config)
3. [ ] Set a safe default for host dev in `server/.env`.
   - Files to edit:
     - `server/.env`
   - Implementation steps:
     - Add `CODEINFO_CODEX_AGENT_HOME=../codex_agents`
     - (Optional but recommended) add `AGENTS_MCP_PORT=5012` for explicitness.
4. [ ] Update docs for dockerized agent setup.
   - Files to edit:
     - `README.md`
   - Required doc details:
     - Agents MCP URL: `http://localhost:5012`
     - Compose mount path: host `./codex_agents` → container `/app/codex_agents`
     - Warning: `auth.json` may be copied into agent folders at runtime and must remain gitignored.
5. [ ] Update architecture docs (design + Mermaid) to reflect new runtime surfaces.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Ensure Docker/Compose wiring changes are reflected in the architecture docs.
   - Implementation steps:
     - Add/extend a Mermaid deployment diagram showing:
       - server container
       - bind mount for `/app/codex_agents`
       - exposed Agents MCP port (`5012`)
6. [ ] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/chat` loads when running in compose; no regressions.
   - Confirm the server container can see `/app/codex_agents` and `AGENTS_MCP_PORT` is set (by verifying agent-related endpoints/ports once implemented in later tasks).
9. [ ] `npm run compose:down`

#### Implementation notes


---

### 6. Server endpoint: list available agents (name + optional description)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose `GET /agents`, returning agent `name` plus optional `description` (Markdown) read from `${agentHome}/description.md` when present.

This endpoint is the single source of truth for:

- the GUI Agents page agent dropdown + info block
- the MCP `list_agents` tool (Task 9)

#### Documentation Locations

- Existing route test patterns:
  - `server/src/test/unit/tools-ingested-repos.test.ts` (builds an express app + supertest)
- Express: Context7 `/expressjs/express`
- Supertest: Context7 `/ladjs/supertest`
- Filesystem discovery implemented in Tasks 3–4:
  - `server/src/agents/discovery.ts`
  - `server/src/agents/authSeed.ts`
- Mermaid diagrams (for documenting new REST surfaces in `design.md`): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Create a shared agents service module (single source for REST + MCP).
   - Docs to read (this subtask):
     - This story: Task 3 discovery rules + Task 4 auth seeding rules
   - Files to create:
     - `server/src/agents/service.ts`
   - Implementation steps:
     - Export a `listAgents()` function that:
       - calls the discovery helper from `server/src/agents/discovery.ts`
       - returns only the REST-safe summary fields:
         - `name`, optional `description`, optional `disabled`, optional `warnings`
     - Also export a stubbed `runAgentInstruction()` signature (implemented in Task 7) so MCP can import from the same module without circular imports.
2. [ ] Implement `GET /agents` router.
   - Docs to read (this subtask):
     - Express routers: Context7 `/expressjs/express`
   - Files to create:
     - `server/src/routes/agents.ts`
   - Implementation steps:
     - Follow the existing router factory pattern (`createXRouter(deps?: Partial<Deps>)`).
     - Handler response shape (exact JSON):
       ```json
       { "agents": [ { "name": "coding_agent", "description": "# ...", "warnings": [] } ] }
       ```
3. [ ] Wire `createAgentsRouter()` into the main server app.
   - Files to edit:
     - `server/src/index.ts`
   - Implementation steps:
     - Add `app.use('/', createAgentsRouter())` near other `app.use('/', ...)` routes.
4. [ ] Server unit test (Supertest): `GET /agents` returns discovered agents.
   - Test type:
     - Server unit test (Supertest)
   - Test location:
     - Create `server/src/test/unit/agents-router-list.test.ts`
   - Purpose:
     - Ensure REST API returns a stable list for the Agents dropdown and MCP `list_agents`.
   - Test description:
     - With `CODEINFO_CODEX_AGENT_HOME=<tmp>`, create `coding_agent/config.toml`, call `GET /agents`, assert status 200 and `agents` contains `{ name: 'coding_agent' }`.
5. [ ] Server unit test (Supertest): `GET /agents` includes `description` when `description.md` exists.
   - Test type:
     - Server unit test (Supertest)
   - Test location:
     - Update `server/src/test/unit/agents-router-list.test.ts`
   - Purpose:
     - Ensure the UI info block and MCP metadata can show the per-agent description.
   - Test description:
     - Add `coding_agent/description.md` and assert response agent object includes `description`.
6. [ ] Server unit test (Supertest): `GET /agents` does not error when `description.md` is missing.
   - Test type:
     - Server unit test (Supertest)
   - Test location:
     - Update `server/src/test/unit/agents-router-list.test.ts`
   - Purpose:
     - Ensure agents without descriptions still appear and the endpoint remains robust.
   - Test description:
     - Ensure `description.md` is absent and assert status 200 with an agent object missing `description`.
7. [ ] Update docs.
   - Files to edit:
     - `README.md`
   - Required doc details:
     - `GET /agents` example curl command and example response.
8. [ ] Update architecture docs (design + Mermaid) for `GET /agents`.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Document the “single source of truth” agent listing flow reused by GUI + MCP.
   - Implementation steps:
     - Add a Mermaid flow diagram: GUI/MCP → `GET /agents`/`listAgents()` → discovery (+ auth seeding) → response `{ agents: [...] }`.
9. [ ] Update `projectStructure.md` for new REST agent listing modules.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure newly added server REST modules and tests are documented.
   - Required updates:
     - Add entries for:
       - `server/src/agents/service.ts`
       - `server/src/routes/agents.ts`
       - the new `GET /agents` unit test file(s)
10. [ ] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/chat` loads; no console errors.
   - Use the browser (or Playwright evaluate) to `fetch('/agents')` and confirm it returns `{ agents: [...] }` and includes `description` when `description.md` exists.
9. [ ] `npm run compose:down`

#### Implementation notes


---

### 7. Server endpoint: run an agent instruction (`POST /agents/:agentName/run`)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Expose a REST endpoint for the GUI to run an agent instruction without talking to MCP directly.

Critical requirement: the REST path and MCP path must share the same implementation so behavior, persistence, and output stay consistent. The shared implementation lives in `server/src/agents/service.ts` as `runAgentInstruction()` and is called by:

- REST: `POST /agents/:agentName/run` (this task)
- MCP: `run_agent_instruction` tool (Task 9)

#### Documentation Locations

- REST router/test patterns:
  - `server/src/routes/chat.ts` (shows how we use AbortController + req close handling)
  - `server/src/test/unit/tools-ingested-repos.test.ts` (router + supertest pattern)
- Shared segment output pattern:
  - `server/src/mcp2/tools/codebaseQuestion.ts` (McpResponder)
- Codex defaults to copy (agents must not expose these as controls):
  - `server/src/routes/chatValidators.ts`
- Codex SDK (how threads and streamed runs work; needed when wiring `threadId` and abort support):
  - `node_modules/@openai/codex-sdk/README.md`
- Node.js (AbortController/AbortSignal + `crypto.randomUUID()` + HTTP request lifecycle): Context7 `/nodejs/node`
- Express: Context7 `/expressjs/express`
- Supertest: Context7 `/ladjs/supertest`
- Mermaid diagrams (for documenting the agent run flow in `design.md`): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Create the route module for `POST /agents/:agentName/run`.
   - Docs to read (this subtask):
     - Express routers: Context7 `/expressjs/express`
   - Files to create:
     - `server/src/routes/agentsRun.ts`
   - Implementation steps:
     - Follow the “router factory” pattern (`createXRouter(deps?: Partial<Deps>)`) so tests can inject a fake `runAgentInstruction`.
     - Input:
       - route param: `agentName` (required, non-empty)
       - body: `{ instruction: string; conversationId?: string }`
     - Output (exact JSON):
       ```json
       { "agentName": "coding_agent", "conversationId": "...", "modelId": "gpt-5.1-codex-max", "segments": [ ... ] }
       ```
2. [ ] Wire the route into the main server app.
   - Files to edit:
     - `server/src/index.ts`
   - Implementation steps:
     - Add `app.use('/', createAgentsRunRouter())`.
3. [ ] Implement `runAgentInstruction()` in the shared agents service.
   - Docs to read (this subtask):
     - `server/src/mcp2/tools/codebaseQuestion.ts` (McpResponder wiring)
     - `server/src/routes/chat.ts` (AbortController + req close patterns)
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts` (flags model: `threadId`, and the new `systemPrompt/disableSystemContext/codexHome` flags added in Task 1)
   - Files to edit:
     - `server/src/agents/service.ts`
   - Implementation steps (concrete + copy/pasteable defaults):
     - Resolve the agent via discovery (`server/src/agents/discovery.ts`) so:
       - unknown agent → return a 404-like error from the service (the router maps it to HTTP 404)
       - missing `config.toml` → treat as not found
     - Fixed defaults (copy from `server/src/routes/chatValidators.ts`):
       - `modelId = 'gpt-5.1-codex-max'`
       - `sandboxMode = 'workspace-write'`
       - `networkAccessEnabled = true`
       - `webSearchEnabled = true`
       - `approvalPolicy = 'on-failure'`
       - `modelReasoningEffort = 'high'`
     - Conversation rules:
       - If `conversationId` is missing:
         - generate `conversationId = crypto.randomUUID()`
         - create conversation via `createConversation(...)` with:
           - `provider: 'codex'`
           - `model: modelId`
           - `agentName: agentName` (top-level field from Task 2)
           - `flags: {}` (agents do **not** persist run flags)
           - `source: <source>` (REST or MCP)
       - If `conversationId` is provided:
         - load conversation and reject:
           - 404 if missing
           - 410 if archived
           - 400 if `conversation.agentName !== agentName`
     - System prompt behavior:
       - Agents must **not** use the global `SYSTEM_CONTEXT` by default.
       - If **starting a new conversation only**, and `${agentHome}/system_prompt.txt` exists:
         - read it as UTF-8
         - pass it into `ChatInterfaceCodex` via flags as `systemPrompt` (do **not** modify/prefix the persisted user message)
       - Always pass `disableSystemContext: true` in Codex flags for agent runs so global system context is never applied.
     - Thread continuation:
       - Use `threadId = conversation.flags.threadId` (string) when present.
       - Pass it to Codex in the run flags so the next call continues.
       - Persist new thread ids using the Task 1 helper that updates only `flags.threadId`.
     - Per-agent Codex home:
       - Resolve `agentHome = ${CODEINFO_CODEX_AGENT_HOME}/${agentName}`
       - Create the Codex SDK instance using `CODEX_HOME = agentHome` (via `buildCodexOptions({ codexHome: agentHome })` in a per-request `codexFactory` closure passed to `getChatInterface('codex', { codexFactory })`).
       - Also pass `codexHome: agentHome` in flags so `ChatInterfaceCodex` can run per-home availability checks (Task 1).
     - Cancellation / Stop button:
       - Accept an `AbortSignal` parameter and pass it into the Codex run flags (so client disconnect / stop can abort).
     - Segments output:
       - Use `McpResponder` to build `segments` like `codebase_question`, but **do not** forward `thread`/`complete` events into the responder:
         - `threadId` events represent the Codex thread id, but this API must return the **server** `conversationId`.
         - Only feed responder: `analysis`, `tool-result`, `final`, and `error`.
       - Return `{ agentName, conversationId, modelId, segments }` where `conversationId` is always the server conversation id.
4. [ ] Implement the router handler by calling `runAgentInstruction()` and mapping errors.
   - Docs to read (this subtask):
     - Existing error mapping style: `server/src/routes/chat.ts`
   - Files to edit:
     - `server/src/routes/agentsRun.ts`
   - Error mapping requirements:
     - unknown agent → `404 { error: 'not_found' }`
     - archived conversation → `410 { error: 'archived' }`
     - mismatched agentName → `400 { error: 'agent_mismatch' }`
     - codex unavailable → `503 { error: 'codex_unavailable', reason: '...' }`
5. [ ] Server unit test (Supertest): `POST /agents/:agentName/run` validates request body (missing `instruction` → 400).
   - Test type:
     - Server unit test (Supertest)
   - Test location:
     - Create `server/src/test/unit/agents-router-run.test.ts`
   - Purpose:
     - Prevent ambiguous client/server failures by ensuring the API rejects invalid payloads consistently.
   - Test description:
     - Call `POST /agents/coding_agent/run` with `{}` and assert `400` with a validation error payload.
6. [ ] Server unit test (Supertest): unknown agent maps to 404.
   - Test type:
     - Server unit test (Supertest)
   - Test location:
     - Update `server/src/test/unit/agents-router-run.test.ts`
   - Purpose:
     - Ensure UI can show “agent not found” cleanly and MCP can mirror the same behavior.
   - Test description:
     - Inject a fake `runAgentInstruction()` that throws/returns an “unknown agent” error and assert the router returns `404 { error: 'not_found' }`.
7. [ ] Server unit test (Supertest): success response shape is stable.
   - Test type:
     - Server unit test (Supertest)
   - Test location:
     - Update `server/src/test/unit/agents-router-run.test.ts`
   - Purpose:
     - Lock in the contract used by the Agents page and MCP tool return payloads.
   - Test description:
     - Inject a fake `runAgentInstruction()` that returns:
       - `{ agentName, conversationId, modelId, segments }`
     - Assert status 200 and those fields exist in the JSON.
8. [ ] Update docs.
   - Files to edit:
     - `README.md`
   - Required doc details:
     - Example curl for `POST /agents/coding_agent/run`
     - Explain that `conversationId` is the server conversation id, and Codex thread id is stored in `flags.threadId`
9. [ ] Update architecture docs (design + Mermaid) for agent run flow.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Make the end-to-end agent execution flow explicit (including system prompt prefix and thread continuation).
   - Implementation steps:
     - Add a Mermaid sequence/flow diagram showing:
       - GUI/MCP → `runAgentInstruction()` → create/load conversation (agentName rules) → (optional) prefix `system_prompt.txt` on first turn → call Codex with `threadId` → persist `flags.threadId` → return `{ segments }`.
10. [ ] Update `projectStructure.md` for new REST agent run modules.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure newly added route modules and tests for agent execution are documented.
   - Required updates:
     - Add entries for:
       - `server/src/routes/agentsRun.ts`
       - any new unit test file(s) created for `POST /agents/:agentName/run`
11. [ ] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/chat` loads; no regressions.
   - If `/agents` UI is not implemented yet, validate the REST contract directly:
     - `fetch('/agents/coding_agent/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'hello' }) })` returns `{ agentName, conversationId, modelId, segments }`.
   - If `/agents` UI is implemented, run an instruction from the Agents page and confirm Stop + continuation by selecting history works.
9. [ ] `npm run compose:down`

#### Implementation notes


---

### 8. Server endpoint: list conversations filtered by agent

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add server support for listing conversations filtered by agent metadata so later UI tasks can:

- keep the existing Chat page “clean” by listing only conversations with **no** `agentName`
- show only conversations for the selected agent on the Agents page

Important semantics (must be implemented exactly):

- `/conversations?agentName=__none__` → conversations where `agentName` is missing/empty
- `/conversations?agentName=<agent>` → conversations where `agentName === <agent>`
- `/conversations` (no param) → existing behavior (no agent filter)

#### Documentation Locations

- Existing conversations endpoint:
  - `server/src/routes/conversations.ts`
- Existing persistence query:
  - `server/src/mongo/repo.ts` (`listConversations`)
- Existing repo test stubbing pattern:
  - `server/src/test/unit/repo-persistence-source.test.ts`
- Express: Context7 `/expressjs/express` (this is an Express route; refer for query string parsing and handler patterns)
- Mongoose query patterns: Context7 `/automattic/mongoose` (building the Mongo query for “no agent” vs “exact agent” filters)
- Zod: Context7 `/colinhacks/zod` (query schema parsing/validation in `listConversationsQuerySchema`)
- Zod website (official): https://zod.dev/ (quick reference for schemas/parse errors when validating query params)
- Supertest: Context7 `/ladjs/supertest`
- Mermaid diagrams (for documenting the filtering flow in `design.md`): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Add agent filter support to the repo query layer.
   - Docs to read (this subtask):
     - Mongo `$exists` and `$or`: Context7 `/automattic/mongoose`
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Implementation steps:
     - Extend `ListConversationsParams` with optional `agentName?: string`.
     - When `agentName` is:
       - omitted: keep existing query
       - `__none__`: add a filter matching “no agent”, e.g.:
         - `{ $or: [ { agentName: { $exists: false } }, { agentName: null }, { agentName: '' } ] }`
       - any other string: add `{ agentName: <value> }`
     - Keep cursor + archived behavior unchanged.
2. [ ] Add agent filter support to the REST endpoint.
   - Docs to read (this subtask):
     - Zod query parsing: Context7 `/colinhacks/zod` (primary) and https://zod.dev/ (official)
   - Files to edit:
     - `server/src/routes/conversations.ts`
   - Implementation steps:
     - Extend `listConversationsQuerySchema` to include optional `agentName`.
     - Pass the parsed `agentName` down to `listConversations({ ... })`.
3. [ ] Server unit test (Node `node:test`): repo query for `agentName=__none__` matches “missing agent”.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Create `server/src/test/unit/repo-conversations-agent-filter.test.ts`
   - Purpose:
     - Ensure the “Chat stays clean” filter works and remains backwards compatible.
   - Test description:
     - Stub `ConversationModel.find` to capture its `query` argument.
     - Call `listConversations({ agentName: '__none__', ... })` and assert the query includes an `$or` that matches missing/empty agentName.
4. [ ] Server unit test (Node `node:test`): repo query for `agentName=<agent>` matches exact agent.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Update `server/src/test/unit/repo-conversations-agent-filter.test.ts`
   - Purpose:
     - Ensure Agents page history is correctly scoped to the selected agent.
   - Test description:
     - Call `listConversations({ agentName: 'coding_agent', ... })` and assert `query.agentName === 'coding_agent'`.
5. [ ] Server unit test (Supertest): endpoint passes `agentName=__none__` to repo layer.
   - Test type:
     - Server unit test (Supertest)
   - Test location:
     - Create `server/src/test/unit/conversations-router-agent-filter.test.ts`
   - Purpose:
     - Ensure request parsing forwards the filter correctly to the repo layer.
   - Test description:
     - Build an express app with `createConversationsRouter({ listConversations: fake })`, call `GET /conversations?agentName=__none__`, assert fake called with `agentName: '__none__'`.
6. [ ] Server unit test (Supertest): endpoint passes `agentName=<agent>` to repo layer.
   - Test type:
     - Server unit test (Supertest)
   - Test location:
     - Update `server/src/test/unit/conversations-router-agent-filter.test.ts`
   - Purpose:
     - Ensure selected agent history lists correctly.
   - Test description:
     - Call `GET /conversations?agentName=coding_agent` and assert fake called with `agentName: 'coding_agent'`.
7. [ ] Update docs.
   - Files to edit:
     - `README.md`
   - Required doc details:
     - Document `/conversations?agentName=__none__`
     - Document `/conversations?agentName=<agent>`
8. [ ] Update architecture docs (design + Mermaid) for conversation filtering.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Make it clear how the Chat page stays “clean” while Agents page is scoped.
   - Implementation steps:
     - Add a Mermaid flow diagram showing:
       - Chat page → `/conversations?agentName=__none__`
       - Agents page → `/conversations?agentName=<selected>`
       - repo filter behavior (`$or` for missing agentName vs exact match).
9. [ ] Update `projectStructure.md` for new conversation filter tests.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure any new test files added for agent filtering are documented.
   - Required updates:
     - Add entries for the new unit test file(s) created by this task.
10. [ ] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/chat` loads and shows only non-agent conversations (agentName absent).
   - Validate filtering via the REST API:
     - `fetch('/conversations?agentName=__none__')` returns only conversations with no `agentName`.
     - `fetch('/conversations?agentName=coding_agent')` returns only `agentName === 'coding_agent'` conversations (after at least one agent run exists).
9. [ ] `npm run compose:down`

#### Implementation notes


---

### 9. Implement Agents MCP server (port 5012) with `list_agents` and `run_agent_instruction`

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Create a new MCP v2-style JSON-RPC server on port 5012 to expose agents to external clients.

Hard requirements:

- Runs on `AGENTS_MCP_PORT` (default `5012`)
- Exposes exactly two tools:
  - `list_agents`
  - `run_agent_instruction`
- Reuses the shared agents service (`server/src/agents/service.ts`) so REST + MCP behavior is identical.
- `run_agent_instruction` returns the same segment format as `codebase_question` (via `McpResponder`).
  - Note: unlike `codebase_question`, Agents MCP must return the **server** `conversationId` (not the Codex thread id).

#### Documentation Locations

- Existing MCP v2 server patterns to copy:
  - `server/src/mcp2/server.ts`
  - `server/src/mcp2/router.ts`
  - `server/src/mcp2/tools.ts`
  - `server/src/mcpCommon/dispatch.ts`
- MCP/JSON-RPC specs:
  - JSON-RPC 2.0: https://www.jsonrpc.org/specification
  - MCP: https://modelcontextprotocol.io/
- Node.js HTTP servers: Context7 `/nodejs/node`
- Mermaid diagrams (for documenting Agents MCP surface in `design.md`): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Add config for Agents MCP port.
   - Files to edit:
     - `server/src/config.ts`
   - Implementation steps:
     - Add: `export const AGENTS_MCP_PORT = Number(process.env.AGENTS_MCP_PORT ?? 5012);`
2. [ ] Create an Agents MCP server entrypoint (start/stop).
   - Docs to read (this subtask):
     - `server/src/mcp2/server.ts`
   - Files to create:
     - `server/src/mcpAgents/server.ts`
   - Implementation steps:
     - Implement `startAgentsMcpServer()` and `stopAgentsMcpServer()` mirroring `startMcp2Server()` / `stopMcp2Server()`, but listening on `AGENTS_MCP_PORT`.
3. [ ] Implement the JSON-RPC router for Agents MCP.
   - Docs to read (this subtask):
     - `server/src/mcp2/router.ts` (exact wire format + error codes)
   - Files to create:
     - `server/src/mcpAgents/router.ts`
     - `server/src/mcpAgents/types.ts` (copy or reuse the `jsonRpcResult/jsonRpcError` helpers; keep wire format identical to MCP v2)
   - Implementation steps:
     - Reuse `dispatchJsonRpc` from `server/src/mcpCommon/dispatch.ts`.
     - Keep protocol version + initialize response shape aligned with MCP v2.
     - Do **not** gate `tools/list` behind Codex availability:
       - `list_agents` must still be discoverable even when Codex is unavailable (agents can be returned with `disabled/warnings`).
     - Gate only `tools/call` for `run_agent_instruction` behind Codex availability (return `CODE_INFO_LLM_UNAVAILABLE` when unavailable).
4. [ ] Implement the tool registry (exactly two tools).
   - Docs to read (this subtask):
     - `server/src/mcp2/tools.ts` (tool definition + deps injection pattern)
   - Files to create:
     - `server/src/mcpAgents/tools.ts`
   - Implementation steps:
     - Implement `listTools()` returning two tool definitions:
       - `list_agents` (no params)
       - `run_agent_instruction` (params below)
     - Implement `callTool()` dispatching to the correct implementation.
     - Provide a dependency injection mechanism for tests (e.g. `setToolDeps/resetToolDeps` like `mcp2/tools.ts`).
5. [ ] Implement `list_agents` tool by delegating to the shared service.
   - Files to edit/create:
     - `server/src/mcpAgents/tools.ts` (or a dedicated `server/src/mcpAgents/tools/listAgents.ts`)
   - Implementation steps:
     - Call `listAgents()` from `server/src/agents/service.ts`.
     - Return MCP tool result shape:
       - `{ content: [{ type: 'text', text: '<json>' }] }`
       - JSON should be `{ agents: AgentSummary[] }`
6. [ ] Implement `run_agent_instruction` tool by delegating to the shared service.
   - Input schema (must match exactly):
     - required: `agentName`, `instruction`
     - optional: `conversationId`
   - Implementation steps:
     - Call `runAgentInstruction({ agentName, instruction, conversationId, source: 'MCP' })`.
     - Return MCP tool result shape:
       - `{ content: [{ type: 'text', text: '<json>' }] }`
       - JSON should be `{ agentName, conversationId, modelId, segments }`
7. [ ] Start/stop the Agents MCP server from the main server process.
   - Files to edit:
     - `server/src/index.ts`
   - Implementation steps:
     - Start in `start()` after HTTP server listens.
     - Stop in `shutdown()` alongside `stopMcp2Server()`.
8. [ ] Server unit test (Node `node:test` + `fetch`): Agents MCP `tools/list` returns exactly two tools.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Create `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Purpose:
     - Lock down the external MCP contract so clients can rely on a stable toolset.
   - Test description:
     - Start an `http.createServer(handleAgentsRpc)` on an ephemeral port and `POST` `{ "jsonrpc":"2.0","id":1,"method":"tools/list" }`.
     - Assert the returned tool names are exactly `list_agents` and `run_agent_instruction` (and no others).
9. [ ] Server unit test (Node `node:test` + `fetch`): Agents MCP `run_agent_instruction` returns segments payload shape.
   - Test type:
     - Server unit test (Node `node:test`)
   - Test location:
     - Create `server/src/test/unit/mcp-agents-router-run.test.ts`
   - Purpose:
     - Ensure MCP clients receive `{ agentName, conversationId, modelId, segments }` wrapped as a JSON text content item.
   - Test description:
     - Stub tool deps (like `mcp2/tools.ts` does) so `run_agent_instruction` returns a deterministic payload.
     - Call `tools/call` and assert the JSON string in `result.content[0].text` parses and contains the required fields.
10. [ ] Update docs.
   - Files to edit:
     - `README.md`
   - Required doc details:
     - URL: `http://localhost:5012`
     - Example `initialize` / `tools/list` / `tools/call` curl commands.
11. [ ] Update architecture docs (design + Mermaid) for Agents MCP 5012.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Ensure the new external integration surface is documented consistently with MCP v2.
   - Implementation steps:
     - Add a Mermaid diagram showing:
       - MCP client → Agents MCP server (`5012`) → `tools/list` / `tools/call` → shared agents service → Codex run.
12. [ ] Update `projectStructure.md` for new MCP Agents server modules.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure the new MCP server entrypoint/router/tools and associated tests are documented.
   - Required updates:
     - Add entries for:
       - `server/src/mcpAgents/server.ts`
       - `server/src/mcpAgents/router.ts`
       - `server/src/mcpAgents/types.ts` (if created)
       - `server/src/mcpAgents/tools.ts`
       - new MCP unit test file(s)
13. [ ] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/chat` loads; no regressions.
   - Verify Agents MCP server behavior (manual commands; expected when Task 9 is complete):
     - `tools/list` exposes exactly `list_agents` and `run_agent_instruction`.
     - `tools/call` for `run_agent_instruction` returns JSON text with `{ agentName, conversationId, modelId, segments }`.
9. [ ] `npm run compose:down`

#### Implementation notes


---

### 10. Add Agents GUI page (`/agents`) and navigation

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add a new UI surface to manage and run agents.

UI requirements (must be implemented exactly):

- A new page `/agents` with a navigation entry “Agents”
- Top controls **only**:
  - agent selector dropdown
  - Stop button
  - New conversation button
- Changing selected agent:
  - stops any in-progress run
  - resets the conversation (as if “New conversation” was clicked)
  - refreshes the conversation history panel so it shows only that agent’s conversations
- Agent info block:
  - shows the selected agent’s `description` (Markdown) when present
- Conversation continuation:
  - users continue threads by selecting a prior conversation from the history panel
  - there is **no** manual `conversationId` input field

Implementation constraint: reuse existing Chat page components where possible (especially `ConversationList`, `Markdown`, and any transcript rendering).

#### Documentation Locations

- Existing routing + Nav:
  - `client/src/routes/router.tsx`
  - `client/src/components/NavBar.tsx`
- Existing chat UI patterns to reuse:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/components/chat/ConversationList.tsx`
  - `client/src/components/Markdown.tsx`
  - `client/src/hooks/useConversations.ts`
- Server endpoints used by this page:
  - `GET /agents` (Task 6)
  - `POST /agents/:agentName/run` (Task 7)
  - `GET /conversations?agentName=...` (Task 8)
- React Router (routing + navigation): Context7 `/remix-run/react-router` (the router config and navigation patterns used in `client/src/routes/router.tsx`)
- React (state + effects): https://react.dev/ (hook behavior for page state, abort/reset logic, and derived UI)
- MUI components (required by AGENTS.md):
  - MUI MCP tool: use `https://llms.mui.com/material-ui/6.4.12/llms.txt` (project uses `@mui/material` `^6.4.1`; this is the closest pinned MUI v6 docs source)
- Markdown rendering stack (for agent description + transcript markdown reuse):
  - `react-markdown`: Context7 `/remarkjs/react-markdown` (how Markdown is rendered into React elements)
  - `remark-gfm`: Context7 `/remarkjs/remark-gfm` (tables/task-lists/autolinks expected in descriptions and responses)
  - `rehype-sanitize` (security/sanitization): `node_modules/rehype-sanitize/readme.md` (installed package docs used by `client/src/components/Markdown.tsx`)
- Client testing:
  - React Testing Library: Context7 `/testing-library/react-testing-library` (rendering + user interaction patterns for the new Agents page tests)
  - Jest: Context7 `/jestjs/jest` (mocking `fetch`, assertions, and async test patterns)
- Web Abort APIs (Stop button + agent change cancellation): https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Mermaid diagrams (for documenting UI-level flows in `design.md`): Context7 `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Add `/agents` route and NavBar tab entry.
   - Files to edit:
     - `client/src/routes/router.tsx`
     - `client/src/components/NavBar.tsx`
   - Implementation steps:
     - Add a new route: `<Route path="agents" element={<AgentsPage />} />`
     - Add a new tab:
       - `label="Agents"`, `value="/agents"`, `to="/agents"`
2. [ ] Add a client API module for agents.
   - Files to create:
     - `client/src/api/agents.ts`
   - Required exports (exact):
     - `listAgents(): Promise<{ agents: Array<{ name: string; description?: string; disabled?: boolean; warnings?: string[] }> }>`
     - `runAgentInstruction(params: { agentName: string; instruction: string; conversationId?: string; signal?: AbortSignal }): Promise<{ agentName: string; conversationId: string; modelId: string; segments: unknown[] }>`
   - Verify:
     - `npm run build --workspace client`
3. [ ] Update `useConversations()` to support agent filtering (server semantics are in Task 8).
   - Files to edit:
     - `client/src/hooks/useConversations.ts`
     - `client/src/test/useConversations.source.test.ts`
   - Implementation steps:
     - Change signature to `useConversations(params?: { agentName?: string })`.
     - If `params.agentName` is provided, include it in the query string:
       - `/conversations?agentName=__none__`
       - `/conversations?agentName=coding_agent`
     - Update/extend `client/src/test/useConversations.source.test.ts`:
       - existing tests should still pass when calling `useConversations()` with no params
       - add an assertion that when calling `useConversations({ agentName: '__none__' })`, the fetch URL includes `agentName=__none__`
4. [ ] Update Chat page to request only non-agent conversations.
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Implementation steps:
     - Call `useConversations({ agentName: '__none__' })`.
     - This keeps existing Chat history “clean”.
5. [ ] Update `ConversationList` to support the Agents page control constraints (reuse component; hide extra controls).
   - Files to read:
     - `client/src/components/chat/ConversationList.tsx`
   - Files to edit:
     - `client/src/components/chat/ConversationList.tsx`
   - Purpose:
     - The Agents page must have top controls **only**: agent dropdown, Stop, New conversation.
     - The existing `ConversationList` header includes “Show archived” + Refresh, and row actions include Archive/Restore; those must be hidden/disabled on `/agents` while keeping them on `/chat`.
   - Implementation steps (concrete):
     - Add an optional prop to `ConversationList` such as:
       - `variant?: 'chat' | 'agents'` (default `'chat'`)
     - When `variant === 'agents'`:
       - hide the “Show archived” toggle
       - hide the Refresh button
       - hide the per-row Archive/Restore icon buttons
     - Ensure existing Chat page behavior is unchanged (default variant).
6. [ ] Implement `AgentsPage` (reuse existing components; no parallel UI).
   - Files to create:
     - `client/src/pages/AgentsPage.tsx`
   - Implementation steps (high-level but concrete):
     - Fetch agent list on mount via `listAgents()`.
     - Keep state:
       - `selectedAgentName`
       - `activeConversationId` (undefined for “new conversation” state)
       - `messages` for the current transcript (reuse the `ChatMessage` type and the existing message bubble rendering patterns from `client/src/pages/ChatPage.tsx`)
       - `isRunning` + `AbortController` for Stop (AbortController must be aborted on agent change and Stop)
     - Layout:
       - Left panel: reuse `ConversationList` in `variant="agents"` mode using `useConversations({ agentName: selectedAgentName })`
       - Right panel: controls + description block + transcript + input
     - Agent dropdown change handler:
       - calls `abortController.abort()` (if running)
       - clears transcript + input
       - clears `activeConversationId`
       - triggers `refresh()` on `useConversations`
     - New conversation button:
       - same behavior as agent change reset, but without changing agent
     - Stop button:
       - aborts in-flight request and sets status to stopped
     - Conversation selection behavior:
       - When a conversation is clicked in the left panel:
         - set `activeConversationId`
         - load and render the saved turn history for that conversation by reusing the same approach as `client/src/pages/ChatPage.tsx`:
           - reuse `client/src/hooks/useConversationTurns.ts`
           - map stored turns to `ChatMessage` using the same mapping rules as `ChatPage` (including `toolCalls` rendering)
           - hydrate/replace the transcript when selecting a conversation
     - Send behavior:
       - call `runAgentInstruction({ agentName, instruction, conversationId: activeConversationId })`
       - set `activeConversationId` from the response
       - map the returned `segments` into the same message rendering semantics used by Chat:
         - create a `user` message for the instruction (content = instruction)
         - create an `assistant` message where:
           - `content` = the `answer` segment text (Markdown rendered by `client/src/components/Markdown.tsx`)
           - `think` = the `thinking` segment text (reuses Chat page “Thought process” UI)
           - `segments/tools` includes a synthetic tool row for the `vector_summary` segment, e.g.:
             - `tool.name = 'vector_summary'`
             - `tool.payload = { files: [...] }`
             - status = `done`
         - if the agent run returns no `thinking` or no `vector_summary`, omit those fields
     - No manual `conversationId` entry field.
7. [ ] Client test (RTL/Jest): Agents page loads and populates agent dropdown from `GET /agents`.
   - Test type:
     - Client RTL/Jest test
   - Test location:
     - Create `client/src/test/agentsPage.list.test.tsx`
   - Purpose:
     - Ensure the page can render the available agents list and the dropdown is wired to the REST endpoint.
   - Test description:
     - Mock `fetch` for `GET /agents` to return `{ agents: [{ name: 'coding_agent' }] }`.
     - Render the `/agents` route and assert the dropdown contains `coding_agent`.
8. [ ] Client test (RTL/Jest): Agents page shows agent description block when `description` is present.
   - Test type:
     - Client RTL/Jest test
   - Test location:
     - Create `client/src/test/agentsPage.description.test.tsx`
   - Purpose:
     - Ensure the UX requirement “information block shows agent description” is satisfied.
   - Test description:
     - Mock `GET /agents` to include `{ name: 'coding_agent', description: '# Hello' }`.
     - Select `coding_agent` and assert the description block renders Markdown text.
9. [ ] Client test (RTL/Jest): Changing selected agent aborts in-flight run and resets to new conversation state.
   - Test type:
     - Client RTL/Jest test
   - Test location:
     - Create `client/src/test/agentsPage.agentChange.test.tsx`
   - Purpose:
     - Ensure the “change agent = stop + new conversation + refresh history” requirement is enforced.
   - Test description:
     - Start a run (mock `POST /agents/:agentName/run` with a deferred promise) and confirm Stop is visible/active.
     - Change the agent selection and assert:
       - the abort controller was triggered
       - transcript is cleared
       - `activeConversationId` is cleared (indirectly via next send starting a new conversation)
10. [ ] Client test (RTL/Jest): Selecting a conversation continues that conversationId on the next send.
   - Test type:
     - Client RTL/Jest test
   - Test location:
     - Create `client/src/test/agentsPage.conversationSelection.test.tsx`
   - Purpose:
     - Ensure “continue by selecting from history” works without manual id entry.
   - Test description:
     - Mock `GET /conversations?agentName=coding_agent` to return an item with `conversationId: 'c1'`.
     - Click that conversation in the sidebar and send an instruction.
     - Assert the `POST /agents/coding_agent/run` payload includes `conversationId: 'c1'`.
11. [ ] Client test (RTL/Jest): Selecting a conversation hydrates and renders stored turn history.
   - Test type:
     - Client RTL/Jest test
   - Test location:
     - Create `client/src/test/agentsPage.turnHydration.test.tsx`
   - Purpose:
     - Ensure Agents page behaves like Chat by showing the transcript for an existing conversation when selected.
   - Test description:
     - Mock:
       - `GET /conversations?agentName=coding_agent` → returns `{ items: [{ conversationId: 'c1', title: '...', provider:'codex', model:'...', lastMessageAt:'...' }] }`
       - `GET /conversations/c1/turns` → returns a user + assistant turn.
     - Click the conversation row and assert the transcript renders both turns.
12. [ ] Client test (RTL/Jest): Running an instruction renders thinking/answer and a vector summary tool row.
   - Test type:
     - Client RTL/Jest test
   - Test location:
     - Create `client/src/test/agentsPage.run.test.tsx`
   - Purpose:
     - Ensure the page displays the same “segments” semantics as `codebase_question` and reuses Chat rendering patterns.
   - Test description:
     - Mock `POST /agents/coding_agent/run` to return:
       - `segments: [{ type:'thinking', text:'...' }, { type:'vector_summary', files:[...] }, { type:'answer', text:'...' }]`
     - Assert:
       - thinking UI is present (collapsed/expandable)
       - answer Markdown renders
       - a tool row exists for `vector_summary`
13. [ ] Update docs.
   - Files to edit:
     - `README.md`
   - Required doc details:
     - Where to find Agents page (`/agents`)
     - How conversation continuation works (select from history)
14. [ ] Update architecture docs (design + Mermaid) for Agents UI flow.
   - Docs to read (this subtask):
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Purpose:
     - Document the UI interaction flow so Stop/New Conversation/agent switching behavior is unambiguous.
   - Implementation steps:
     - Add a Mermaid flow diagram showing:
       - initial load → `GET /agents` → select agent → `GET /conversations?agentName=...`
       - send instruction → `POST /agents/:agentName/run`
       - agent switch → abort → reset convo → refresh history.
15. [ ] Update `projectStructure.md` for new client agents modules and tests.
   - Files to edit:
     - `projectStructure.md`
   - Purpose:
     - Ensure newly added client page/API modules and test files are documented.
   - Required updates:
     - Add entries for:
       - `client/src/pages/AgentsPage.tsx`
       - `client/src/api/agents.ts`
       - new Agents page test file(s)
16. [ ] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/agents` loads, lists agents, shows description (if present), and can run an instruction.
   - Changing selected agent stops in-flight runs, resets conversation, and refreshes history panel.
   - `/chat` still loads and shows only non-agent conversations.
9. [ ] `npm run compose:down`

#### Implementation notes


---

### 11. Final task – verify against acceptance criteria

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

1. [ ] Build the server: `npm run build --workspace server`
2. [ ] Build the client: `npm run build --workspace client`
3. [ ] Perform a clean docker build (server): `docker build -f server/Dockerfile .`
4. [ ] Ensure `README.md` is updated with any required description changes and any new commands added by this story
5. [ ] Ensure `design.md` is updated with any required description changes including mermaid diagrams added by this story
6. [ ] Ensure `projectStructure.md` is updated with any updated/added/removed files & folders
7. [ ] Create a pull request comment summarizing ALL story changes (server + client + docker + docs)
8. [ ] Run lint + format checks (all workspaces) and fix any failures.
   - Commands (must run both):
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
   - If either fails:
     - Rerun with fix scripts where available (examples):
       - `npm run lint:fix --workspaces`
       - `npm run format --workspaces`
     - Manually resolve any remaining issues, then rerun the two check commands until they pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check:
   - `/chat` still loads and shows only non-agent conversations
   - `/agents` loads, lists agents, shows agent description, and can run an instruction
   - Agents MCP `5012` responds to initialize/tools/list/tools/call
   - Save screenshots to `./test-results/screenshots/` named:
     - `0000016-11-chat.png`
     - `0000016-11-agents.png`
     - `0000016-11-mcp-5012.png`
9. [ ] `npm run compose:down`

#### Implementation notes


---
