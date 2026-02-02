# Story 0000034 - Ingested repo commands and flows

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

CodeInfo2 currently loads agent commands and flows only from the CodeInfo2 repository itself. This makes it hard to reuse repository-specific commands and flows when working inside other ingested repos.

This story adds discovery of commands and flows from ingested repositories. If an ingested repo has a `codex_agents/<agentName>/commands` folder and that agent also exists locally, those commands should appear in the agent command dropdown. If an ingested repo has a `flows/` folder, those flows should appear in the flows dropdown. The UI will show the ingest root display name in brackets for each imported item (for example, `build - [My Repo]`) so duplicates are easy to distinguish; when a display name is missing we fall back to the ingest root folder name.

---

## Acceptance Criteria

- Commands are discovered from each ingested repo at `<ingestRoot>/codex_agents/<agentName>/commands` when the matching agent exists locally.
- Flows are discovered from each ingested repo at `<ingestRoot>/flows`.
- Only the ingest root container path (`/data/<repo>`) is used for `sourceId` in REST/MCP payloads and flow/command execution.
- Duplicate command or flow names are allowed across repos.
- Dropdown lists are sorted alphabetically by the full display label (`<name> - [Repo Name]`) so duplicates stay deterministic.
- Imported items display the ingest root display name in brackets, formatted as `<name> - [Repo Name]`.
- If the ingest root display name (`ingest metadata.name`) is missing or empty, the fallback label is the basename of the ingest root container path.
- Imported commands and flows are treated as trusted and can be executed without extra confirmation.
- Local (CodeInfo2) commands and flows continue to appear, remain functional, and remain unlabeled.
- MCP list/run tools surface ingested commands the same way as the UI (flows MCP parity is out of scope).
- REST list responses include `sourceId` and `sourceLabel` for ingested items, while local items omit both fields.
- REST run requests accept an optional `sourceId` for ingested commands/flows to disambiguate duplicates.
- Clients must pass `sourceId` when running ingested items; when `sourceId` is omitted, the server resolves commands/flows from local folders only.
- If `sourceId` is provided but does not match a known ingest root or file, the run endpoints return `404 { error: 'not_found' }`.
- Server path resolution for ingested items uses Node `path.resolve` + `path.relative` checks to ensure the resolved command/flow file stays within the ingest root container path.

---

## Out Of Scope

- Changing command or flow JSON schemas.
- Editing or validating commands/flows inside ingested repos beyond existing validation.
- UI redesigns beyond list labels and sorting.
- Changes to ingest workflows or repository ingestion behavior.
- Adding new MCP tools for flows (list/run) or changing MCP flow behavior.

---

## Contracts and Storage Impacts

- REST contracts: `GET /agents/:agentName/commands` and `GET /flows` will add optional `sourceId` and `sourceLabel` fields for ingested items; local items continue to omit these fields.
- REST run payloads: `POST /agents/:agentName/commands/run` and `POST /flows/:flowName/run` will accept an optional `sourceId` to disambiguate duplicates (container path for ingested roots).
- MCP contracts: the `list_commands` and `run_command` MCP payloads will mirror the REST `sourceId/sourceLabel` additions for ingested commands; no MCP flow tools are added.
- Storage: no Mongo/Chroma schema changes are required; ingest root metadata already supplies name + container path used at runtime.

---

## Edge Cases and Failure Modes

- Ingest roots list is empty: ingested commands/flows are simply omitted and local items continue to work.
- Ingest root metadata is missing a name: `sourceLabel` falls back to the basename of the container path and display labels stay deterministic.
- Ingest root folders are deleted or moved: list APIs should skip missing folders; run requests with that `sourceId` return `404 { error: 'not_found' }`.
- Duplicate names across repos: items appear separately with different labels; runs must include the correct `sourceId` to avoid ambiguity.
- Invalid/unknown `sourceId`: command/flow run returns `404 { error: 'not_found' }`.
- Path traversal attempts (e.g., `../` in `sourceId` or command/flow name): rejected by containment checks (`path.resolve` + `path.relative`).
- Invalid JSON or schema in ingested flow files: flows list marks them disabled with error text, matching existing local behavior.
- Ingested command JSON invalid: commands list marks them disabled (same behavior as local command discovery).

---

## Questions

_None. All questions resolved._

---

## Implementation Ideas

- Ingest roots source data: use `listIngestedRepositories` in `server/src/lmstudio/toolService.ts` to obtain ingest root display names (metadata `name`, falling back to the basename of the container path) plus the ingest root container path (`/data/<repo>`), using the container path as `sourceId` and the display name as `sourceLabel`.
- Agent command discovery: extend `listAgentCommands` in `server/src/agents/service.ts` to merge local commands with ingested commands under `<ingestRoot>/codex_agents/<agentName>/commands` for each ingest root, only when the agent exists locally; add `sourceId` + `sourceLabel` for ingested items and keep local items without those fields.
- Agent command execution: update `startAgentCommand`/`commandsRunner` plus `server/src/routes/agentsCommands.ts` and `server/src/mcpAgents/tools.ts` to accept an optional `sourceId`, resolve the ingested commands directory from the ingest root container path, and enforce path containment using `path.resolve` + `path.relative` before reading files.
- Flow discovery: extend `server/src/flows/discovery.ts` and `server/src/routes/flows.ts` to scan the local flows folder plus each `<ingestRoot>/flows`, returning `sourceId` (container path) + `sourceLabel` for ingested flows and keeping locals unlabeled; sort by the display label (`<name>` or `<name> - [Repo]`).
- Flow execution: update `server/src/flows/service.ts` and `server/src/routes/flowsRun.ts` to accept an optional `sourceId` (container path) and resolve the correct flow file path with the same `path.resolve` + `path.relative` containment checks.
- Client API + UI: adjust `client/src/api/agents.ts` and `client/src/pages/AgentsPage.tsx` to parse `sourceId/sourceLabel`, render labels as `<name> - [sourceLabel]` when present or `<name>` when absent, keep locals unlabeled, and pass `sourceId` when running commands; mirror for flows in `client/src/api/flows.ts` and `client/src/pages/FlowsPage.tsx`.
- Tests to revisit: server agent command list/run tests in `server/src/test/unit/agents-commands-router-run.test.ts` and `server/src/test/unit/mcp-agents-router-list.test.ts`; flow list/run tests in `server/src/test/integration/flows.list.test.ts` and `server/src/test/integration/flows.run.*.test.ts`; client tests for agents/flows dropdowns in `client/src/test/agentsPage.commandsList.test.tsx` and `client/src/test/flowsApi.test.ts`/`client/src/test/flowsPage.stop.test.tsx`.

---

# Implementation Plan

## Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks.
This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit & push that change, and only then begin implementation.
4. For each task, execute every subtask sequentially: before starting a subtask, read the documentation sources listed in that task; after finishing the subtask, run the relevant linters/formatters (Python + TypeScript) and fix issues before continuing.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, Move on to the Testing section and work through the tests in order.
7. Once a test is complete, mark its checkbox.
8. After tests pass, perform every documentation update listed for the task.
9. Once a document is updated, mark its checkbox.
10. When all subtasks, tests, documentation updates, and verification commands are complete, consider the task finished and follow points 11–13 below.
11. As soon as a task’s implementation is done, add detailed notes in the Implementation notes section covering the code changes, decisions made, and any issues encountered. Push immediately after writing the notes.
12. Record the relevant git commit hash(es) in the Git Commits section. Once they are pushed, set the task status to `Done`, and push again so both the commit IDs and updated status are captured in this document.
13. After a task is fully documented (status, notes, commits), proceed to the next task and repeat the same process.

---

## Tasks

### 1. Server: Ingested agent command discovery + list contract

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add ingested-repo command discovery to the agent command list so REST/MCP list responses include `sourceId`/`sourceLabel` for ingested items, with deterministic label sorting. This task is limited to listing and does not change command execution.

#### Documentation Locations

- Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- OpenAPI 3.1 spec (for `openapi.json` updates): https://spec.openapis.org/oas/v3.1.0
- npm run-script docs (CLI v10): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Node.js test runner API (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current list logic and ingest metadata usage:
   - Files to read:
     - `server/src/agents/service.ts`
     - `server/src/agents/commandsLoader.ts`
     - `server/src/routes/agentsCommands.ts`
     - `server/src/mcpAgents/tools.ts`
     - `server/src/lmstudio/toolService.ts`
     - `server/src/ingest/pathMap.ts`
     - `server/src/test/unit/agent-commands-list.test.ts`
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
     - `openapi.json`
2. [ ] Implement ingested command discovery and label sorting:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Implementation details:
     - Pull ingest roots via `listIngestedRepositories` and scan `<root>/codex_agents/<agentName>/commands` for JSON files.
     - If `listIngestedRepositories` fails (for example, Chroma unavailable), return local commands only and log/continue without throwing.
     - Skip ingest roots that are missing on disk or do not contain `codex_agents/<agentName>/commands` (no errors, just omit).
     - Use container path (`/data/<repo>`) as `sourceId` and ingest name (fallback to container basename) as `sourceLabel`.
     - Keep local commands unlabeled (no `sourceId`/`sourceLabel`).
     - Sort the combined list by display label (`<name>` for local, `<name> - [sourceLabel]` for ingested).
     - Do not de-duplicate names; preserve duplicates across ingest roots.
3. [ ] Update REST/MCP list payloads and OpenAPI schema:
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
     - `server/src/mcpAgents/tools.ts`
     - `openapi.json`
   - Implementation details:
     - Add optional `sourceId`/`sourceLabel` fields to list payloads for ingested items only.
4. [ ] Update/extend list tests:
   - Files to edit:
     - `server/src/test/unit/agent-commands-list.test.ts`
     - `server/src/test/unit/mcp-agents-router-list.test.ts`
   - Testing expectations:
     - Validate ingested commands include `sourceId`/`sourceLabel` and sorting uses the display label.
     - Add coverage for duplicate command names across different ingest roots (both entries retained, sorted by label).
     - Add coverage for missing ingest root directories (local commands still returned).
5. [ ] Update documentation — `design.md`:
   - Document: `design.md`.
   - Description: Add/confirm command discovery includes ingested repos and the label/sorting rules.
6. [ ] Update documentation — `README.md` (if any new endpoints/fields need mention).
7. [ ] Update documentation — `projectStructure.md` (if any files added/removed in this task; otherwise confirm no change).
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run compose:down`

#### Implementation notes

- _To be completed during implementation._

---

### 2. Server: Agent command run sourceId support (REST + MCP)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add optional `sourceId` support when running agent commands so ingested command files can be executed safely from their ingest root. This task focuses on run-time resolution and validation, not list discovery.

#### Documentation Locations

- Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- OpenAPI 3.1 spec: https://spec.openapis.org/oas/v3.1.0
- Node.js test runner API (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current run validation + command loading:
   - Files to read:
     - `server/src/agents/service.ts`
     - `server/src/agents/commandsRunner.ts`
     - `server/src/routes/agentsCommands.ts`
     - `server/src/mcpAgents/tools.ts`
     - `server/src/lmstudio/toolService.ts`
     - `server/src/agents/commandsLoader.ts`
     - `server/src/test/unit/agents-commands-router-run.test.ts`
     - `server/src/test/unit/mcp-agents-router-run.test.ts`
     - `openapi.json`
2. [ ] Add optional `sourceId` to run payloads and resolve command paths:
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
     - `server/src/agents/service.ts`
     - `server/src/agents/commandsRunner.ts`
     - `server/src/mcpAgents/tools.ts`
     - `openapi.json`
   - Implementation details:
     - Accept `sourceId` (container path) for ingested commands and reject unknown roots with 404.
     - Resolve `<sourceId>/codex_agents/<agentName>/commands/<command>.json` and validate containment with `path.resolve` + `path.relative`.
3. [ ] Update run tests:
   - Files to edit:
     - `server/src/test/unit/agents-commands-router-run.test.ts`
     - `server/src/test/unit/mcp-agents-router-run.test.ts`
     - `server/src/test/unit/agent-commands-runner.test.ts`
   - Testing expectations:
     - Validate 404 on unknown `sourceId` and success when `sourceId` resolves to an ingested command.
4. [ ] Update documentation — `design.md` (run payload changes).
5. [ ] Update documentation — `README.md` (if any new payload fields need mention).
6. [ ] Update documentation — `projectStructure.md` (if needed).
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run compose:down`

#### Implementation notes

- _To be completed during implementation._

---

### 3. Server: Ingested flow discovery + list contract

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Extend flow discovery to include ingested repositories, returning `sourceId`/`sourceLabel` metadata in the list response and maintaining deterministic sorting by display label.

#### Documentation Locations

- Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- OpenAPI 3.1 spec: https://spec.openapis.org/oas/v3.1.0
- Node.js test runner API (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current flow discovery and list contract:
   - Files to read:
     - `server/src/flows/discovery.ts`
     - `server/src/routes/flows.ts`
     - `server/src/flows/flowSchema.ts`
     - `server/src/lmstudio/toolService.ts`
     - `server/src/test/integration/flows.list.test.ts`
     - `openapi.json`
2. [ ] Implement ingested flow discovery and label sorting:
   - Files to edit:
     - `server/src/flows/discovery.ts`
     - `server/src/routes/flows.ts`
   - Implementation details:
     - Scan `<ingestRoot>/flows` for JSON flows, add `sourceId` (container path) and `sourceLabel`.
     - If `listIngestedRepositories` fails, return local flows only and log/continue without throwing.
     - Skip ingest roots that are missing on disk or do not contain a `flows/` folder.
     - Keep local flows unlabeled; sort by display label.
     - Do not de-duplicate names; preserve duplicates across ingest roots.
3. [ ] Update OpenAPI schema for flow list response:
   - Files to edit:
     - `openapi.json`
4. [ ] Update flow list tests:
   - Files to edit:
     - `server/src/test/integration/flows.list.test.ts`
   - Testing expectations:
     - Validate ingested flows include `sourceId`/`sourceLabel` and sorting uses the display label.
     - Add coverage for duplicate flow names across different ingest roots (both entries retained).
     - Add coverage for missing ingest root directories (local flows still returned).
5. [ ] Update documentation — `design.md` (flow discovery changes).
6. [ ] Update documentation — `README.md` (if any new list fields need mention).
7. [ ] Update documentation — `projectStructure.md` (if needed).
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run compose:down`

#### Implementation notes

- _To be completed during implementation._

---

### 4. Server: Flow run sourceId support

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add optional `sourceId` support for flow execution so ingested flows run from their ingest root container paths with containment checks.

#### Documentation Locations

- Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- OpenAPI 3.1 spec: https://spec.openapis.org/oas/v3.1.0
- Node.js test runner API (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review flow run loading and validation:
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/routes/flowsRun.ts`
     - `server/src/flows/types.ts`
     - `server/src/test/integration/flows.run.basic.test.ts`
     - `server/src/test/integration/flows.run.hot-reload.test.ts`
     - `openapi.json`
2. [ ] Add optional `sourceId` to flow run payload and resolve file path:
   - Files to edit:
     - `server/src/flows/service.ts`
     - `server/src/routes/flowsRun.ts`
     - `openapi.json`
   - Implementation details:
     - Accept `sourceId` (container path), resolve `<sourceId>/flows/<flowName>.json`, and enforce containment checks.
     - Unknown `sourceId` or missing flow returns 404.
3. [ ] Update flow run tests:
   - Files to edit:
     - `server/src/test/integration/flows.run.basic.test.ts`
     - `server/src/test/integration/flows.run.hot-reload.test.ts`
     - `server/src/test/integration/flows.run.command.test.ts`
4. [ ] Update documentation — `design.md` (run payload changes).
5. [ ] Update documentation — `README.md` (if any new payload fields need mention).
6. [ ] Update documentation — `projectStructure.md` (if needed).
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run compose:down`

#### Implementation notes

- _To be completed during implementation._

---

### 5. Client: Agents commands dropdown + run payload sourceId

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Update the Agents UI to display ingested command labels, sort by display label, and pass `sourceId` when running ingested commands. This task depends on the server list/run contracts already being updated.

#### Documentation Locations

- MUI Select/Menu docs (MUI MCP `/mui/material@7.2.0`)
- React state + hooks (React docs): https://react.dev/reference/react
- Jest DOM/testing library docs: https://testing-library.com/docs/react-testing-library/intro/
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current agents command list + run flow:
   - Files to read:
     - `client/src/api/agents.ts`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/test/agentsPage.commandsList.test.tsx`
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
2. [ ] Update list parsing + dropdown rendering:
   - Files to edit:
     - `client/src/api/agents.ts`
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - Parse optional `sourceId`/`sourceLabel` and compute display labels.
     - Store `sourceId`/`sourceLabel` with each command and use a composite selection key so duplicate command names remain selectable.
     - Sort by display label and keep local commands unlabeled.
3. [ ] Update run payload to include `sourceId` for ingested commands:
   - Files to edit:
     - `client/src/api/agents.ts`
     - `client/src/pages/AgentsPage.tsx`
   - Implementation details:
     - When the selected command has a `sourceId`, include it in the run payload; omit `sourceId` for local commands.
4. [ ] Update client tests:
   - Files to edit:
     - `client/src/test/agentsPage.commandsList.test.tsx`
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Testing expectations:
     - Validate duplicate command names from different sources render distinct labels and run with the correct `sourceId`.
5. [ ] Update documentation — `design.md` (UI behavior summary).
6. [ ] Update documentation — `README.md` (if any UI behavior needs mention).
7. [ ] Update documentation — `projectStructure.md` (if needed).
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run compose:down`

#### Implementation notes

- _To be completed during implementation._

---

### 6. Client: Flows dropdown + run payload sourceId

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Update the Flows UI to display ingested flow labels, sort by display label, and pass `sourceId` when running ingested flows. This task depends on the server flow list/run contracts being updated.

#### Documentation Locations

- MUI Select/Menu docs (MUI MCP `/mui/material@7.2.0`)
- React state + hooks (React docs): https://react.dev/reference/react
- Jest DOM/testing library docs: https://testing-library.com/docs/react-testing-library/intro/
- ESLint CLI docs (Context7 `/eslint/eslint/v9.37.0`): /eslint/eslint/v9.37.0
- Prettier CLI docs (Context7 `/prettier/prettier/3.6.2`): /prettier/prettier/3.6.2
- Markdown Guide (doc edits): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current flows list + run flow:
   - Files to read:
     - `client/src/api/flows.ts`
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/flowsApi.test.ts`
     - `client/src/test/flowsPage.stop.test.tsx`
2. [ ] Update list parsing + dropdown rendering:
   - Files to edit:
     - `client/src/api/flows.ts`
     - `client/src/pages/FlowsPage.tsx`
   - Implementation details:
     - Parse optional `sourceId`/`sourceLabel` and compute display labels.
     - Store `sourceId`/`sourceLabel` with each flow and use a composite selection key so duplicate flow names remain selectable.
     - Sort by display label and keep local flows unlabeled.
3. [ ] Update run payload to include `sourceId` for ingested flows:
   - Files to edit:
     - `client/src/api/flows.ts`
     - `client/src/pages/FlowsPage.tsx`
   - Implementation details:
     - When the selected flow has a `sourceId`, include it in the run payload; omit `sourceId` for local flows.
4. [ ] Update client tests:
   - Files to edit:
     - `client/src/test/flowsApi.test.ts`
     - `client/src/test/flowsPage.stop.test.tsx`
   - Testing expectations:
     - Validate duplicate flow names from different sources render distinct labels and run with the correct `sourceId`.
5. [ ] Update documentation — `design.md` (UI behavior summary).
6. [ ] Update documentation — `README.md` (if any UI behavior needs mention).
7. [ ] Update documentation — `projectStructure.md` (if needed).
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run compose:down`

#### Implementation notes

- _To be completed during implementation._

---

### 7. Final verification + documentation + PR summary

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Validate the full system against the acceptance criteria, run end-to-end builds/tests, ensure documentation is current, and prepare a pull request summary covering all changes from this story.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] perform a clean docker build
4. [ ] Ensure Readme.md is updated with any required description changes and with any new commands that have been added as part of this story
5. [ ] Ensure Design.md is updated with any required description changes including mermaid diagrams that have been added as part of this story
6. [ ] Ensure projectStructure.md is updated with any updated, added or removed files & folders
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.

#### Testing

1. [ ] run the client jest tests
2. [ ] run the server cucumber tests
3. [ ] restart the docker environment
4. [ ] run the e2e tests
5. [ ] use the playwright mcp tool to ensure manually check the application, saving screenshots to ./test-results/screenshots/ - Each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here
