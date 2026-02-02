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
- Tests to revisit: server agent command list/run tests in `server/src/test/unit/agents-commands-router-run.test.ts` and `server/src/test/unit/mcp-agents-commands-list.test.ts`; flow list/run tests in `server/src/test/integration/flows.list.test.ts` and `server/src/test/integration/flows.run.*.test.ts`; client tests for agents/flows dropdowns in `client/src/test/agentsPage.commandsList.test.tsx` and `client/src/test/flowsApi.test.ts`/`client/src/test/flowsPage.stop.test.tsx`.

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

- Node.js fs + path docs (directory scans + containment checks): Context7 `/nodejs/node/v22.17.0`
- OpenAPI 3.0.3 spec (schema field updates): https://spec.openapis.org/oas/v3.0.3.html
- npm run-script docs (workspace script execution): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Node.js test runner docs (`node:test` usage + CLI flags): https://nodejs.org/api/test.html
- Jest docs (Context7 `/jestjs/jest`): /jestjs/jest
- Mermaid docs (Context7 `/mermaid-js/mermaid`): /mermaid-js/mermaid
- ESLint CLI docs (lint command usage + exit codes): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI docs (format/check options): https://prettier.io/docs/cli/
- Markdown Guide (doc formatting): https://www.markdownguide.org/basic-syntax/

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
    - `server/src/test/unit/mcp-agents-commands-list.test.ts`
     - `openapi.json`
   - Docs to read: Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
2. [ ] Add ingest repo lookup + command discovery:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Implementation details:
     - Pull ingest roots via `listIngestedRepositories` and scan `<root>/codex_agents/<agentName>/commands` for JSON files.
     - Use `RepoEntry.containerPath` as the ingest root path and `RepoEntry.id` (already built via `buildRepoId`) as the display label.
     - Reuse `loadAgentCommandSummary` from `server/src/agents/commandsLoader.ts` for both local and ingested files so invalid JSON/schema handling stays consistent.
     - If `listIngestedRepositories` fails (for example, Chroma unavailable), return local commands only without adding new logging.
     - Skip ingest roots that are missing on disk or do not contain `codex_agents/<agentName>/commands` (no errors, just omit).
3. [ ] Add labels + sort for local/ingested commands:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Implementation details:
     - Use `RepoEntry.containerPath` as `sourceId` and `RepoEntry.id` as `sourceLabel` (it already falls back to ingest metadata name or container basename).
     - Only apply an extra `path.posix.basename` fallback if `RepoEntry.id` is unexpectedly empty.
     - Keep local commands unlabeled (no `sourceId`/`sourceLabel`).
     - Sort the combined list by display label (`<name>` for local, `<name> - [sourceLabel]` for ingested).
     - Do not de-duplicate names; preserve duplicates across ingest roots.
4. [ ] Update REST list payload + OpenAPI schema:
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
     - `openapi.json`
   - Docs to read: OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Implementation details:
     - Add optional `sourceId`/`sourceLabel` fields to REST list payloads for ingested items only.
     - Update the list command DTO/type in `server/src/agents/service.ts` so `sourceId`/`sourceLabel` are optional and omitted for local commands.
5. [ ] Update MCP list payload:
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Implementation details:
     - Add optional `sourceId`/`sourceLabel` fields to MCP list payloads for ingested items only.
6. [ ] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure ingested commands include `sourceId`/`sourceLabel` and sorting uses the display label; purpose: lock down REST list contract + deterministic ordering.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
7. [ ] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure local commands omit `sourceId`/`sourceLabel`; purpose: keep local payloads unchanged.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
8. [ ] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure `sourceLabel` falls back to ingest root basename when metadata name missing; purpose: enforce fallback label rule.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
9. [ ] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure ingested commands are skipped when the matching agent does not exist locally; purpose: avoid invalid listings.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
10. [ ] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure duplicate command names across ingest roots are retained and sorted by label; purpose: confirm deterministic duplicate handling.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
11. [ ] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure missing ingest root directories are skipped and local commands still return; purpose: guard missing directories.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
12. [ ] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: listIngestedRepositories failures return local commands only; purpose: keep lists functional if ingest metadata is unavailable.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
13. [ ] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure ingested commands include `sourceId`/`sourceLabel` and sorting uses display label; purpose: keep MCP parity with REST.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
14. [ ] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure local commands omit `sourceId`/`sourceLabel`; purpose: keep MCP local payloads unchanged.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
15. [ ] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure `sourceLabel` falls back to ingest root basename when metadata name missing; purpose: enforce MCP fallback label rule.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
16. [ ] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure ingested commands are skipped when the matching agent does not exist locally; purpose: prevent invalid MCP listings.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
17. [ ] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure duplicate command names across ingest roots are retained and sorted by label; purpose: match REST duplicate handling.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
18. [ ] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure missing ingest root directories are skipped and local commands still return; purpose: guard missing directories in MCP list.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
19. [ ] Update documentation — `design.md`:
    - Document: `design.md`.
    - Location: repo root `design.md`.
    - Description: Add/confirm command discovery includes ingested repos and the label/sorting rules, and update the related Mermaid architecture diagram(s).
    - Purpose: keep architecture/design reference aligned with the new command discovery behavior.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
20. [ ] Update documentation — `README.md`:
    - Document: `README.md`.
    - Location: repo root `README.md`.
    - Description: Note any new agent command list fields (`sourceId`/`sourceLabel`) if documentation mentions list payloads.
    - Purpose: keep public API usage notes accurate for operators.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
21. [ ] After completing any file adds/removes in this task, update `projectStructure.md`:
    - Document: `projectStructure.md`.
    - Location: repo root `projectStructure.md`.
    - Description: Record any added/removed files or confirm no change.
    - Purpose: ensure repository map stays current after structural edits.
    - Added files: none.
    - Removed files: none.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
22. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.
    - Docs to read: npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/

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

- Node.js path docs (path.resolve/path.relative containment checks): Context7 `/nodejs/node/v22.17.0`
- OpenAPI 3.0.3 spec (schema field updates): https://spec.openapis.org/oas/v3.0.3.html
- npm run-script docs (workspace script execution): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Node.js test runner docs (`node:test` usage + CLI flags): https://nodejs.org/api/test.html
- Jest docs (Context7 `/jestjs/jest`): /jestjs/jest
- Mermaid docs (Context7 `/mermaid-js/mermaid`): /mermaid-js/mermaid
- ESLint CLI docs (lint command usage + exit codes): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI docs (format/check options): https://prettier.io/docs/cli/
- Markdown Guide (doc formatting): https://www.markdownguide.org/basic-syntax/

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
   - Docs to read: Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
2. [ ] Add sourceId resolution + containment checks:
   - Files to edit:
     - `server/src/agents/service.ts`
     - `server/src/agents/commandsRunner.ts`
   - Docs to read: Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Accept `sourceId` (container path) for ingested commands and map it to a `RepoEntry.containerPath` from `listIngestedRepositories`.
     - Treat unknown `sourceId` values as `COMMAND_NOT_FOUND` so REST/MCP return `404 { error: 'not_found' }`.
     - Extend `RunAgentCommandRunnerParams` + `runAgentCommandRunner` to accept an optional ingested `commandsRoot`/`commandFilePath` override (use local `agent.home/commands` when `sourceId` is omitted).
     - Resolve `<sourceId>/codex_agents/<agentName>/commands/<command>.json` and validate containment with `path.resolve` + `path.relative`.
     - If `sourceId` is provided but no matching `containerPath` exists, return `404 { error: 'not_found' }`.
3. [ ] Update REST run payload + OpenAPI schema:
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
     - `openapi.json`
   - Docs to read: OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - Accept optional `sourceId` in REST payloads and pass it into the service layer.
4. [ ] Update MCP run payload:
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Docs to read: Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - Accept optional `sourceId` in MCP payloads and forward to `runAgentCommand`.
5. [ ] Unit test (REST run) — `server/src/test/unit/agents-commands-router-run.test.ts`: unknown `sourceId` returns 404; purpose: validate error handling for invalid ingest roots.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
6. [ ] Unit test (REST run) — `server/src/test/unit/agents-commands-router-run.test.ts`: local command run works when `sourceId` is omitted; purpose: ensure local behavior unchanged.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
7. [ ] Unit test (REST run) — `server/src/test/unit/agents-commands-router-run.test.ts`: ingested command runs when `sourceId` resolves to a valid command file; purpose: cover happy-path ingest execution.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
8. [ ] Unit test (REST run) — `server/src/test/unit/agents-commands-router-run.test.ts`: missing ingested command file returns 404; purpose: validate not_found for missing files.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
9. [ ] Unit test (command runner) — `server/src/test/unit/agent-commands-runner.test.ts`: path traversal attempt in command name is rejected by containment checks; purpose: enforce path safety.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
10. [ ] Unit test (MCP run) — `server/src/test/unit/mcp-agents-router-run.test.ts`: unknown `sourceId` returns not_found; purpose: validate MCP error handling.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
11. [ ] Unit test (MCP run) — `server/src/test/unit/mcp-agents-router-run.test.ts`: local command run works when `sourceId` is omitted; purpose: keep MCP local behavior unchanged.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
12. [ ] Unit test (MCP run) — `server/src/test/unit/mcp-agents-router-run.test.ts`: ingested command runs when `sourceId` resolves to a valid command file; purpose: MCP happy-path coverage.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
13. [ ] Unit test (MCP run) — `server/src/test/unit/mcp-agents-router-run.test.ts`: missing ingested command file returns not_found; purpose: MCP missing-file error coverage.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
14. [ ] Update documentation — `design.md` (run payload changes, plus Mermaid diagram updates).
    - Document: `design.md`.
    - Location: repo root `design.md`.
    - Description: Describe `sourceId` run support and update any related Mermaid flow/run diagrams.
    - Purpose: keep architecture/design references aligned with new run payload behavior.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
15. [ ] Update documentation — `README.md`.
    - Document: `README.md`.
    - Location: repo root `README.md`.
    - Description: Note optional `sourceId` on agent command run payloads if README covers endpoints.
    - Purpose: keep API usage instructions current.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
16. [ ] After completing any file adds/removes in this task, update `projectStructure.md`:
    - Document: `projectStructure.md`.
    - Location: repo root `projectStructure.md`.
    - Description: Record any added/removed files or confirm no change.
    - Purpose: ensure repository map stays current after structural edits.
    - Added files: none.
    - Removed files: none.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
17. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.
    - Docs to read: npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/

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

- Node.js fs + path docs (directory scans + containment checks): Context7 `/nodejs/node/v22.17.0`
- OpenAPI 3.0.3 spec (schema field updates): https://spec.openapis.org/oas/v3.0.3.html
- npm run-script docs (workspace script execution): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Node.js test runner docs (`node:test` usage + CLI flags): https://nodejs.org/api/test.html
- Jest docs (Context7 `/jestjs/jest`): /jestjs/jest
- Mermaid docs (Context7 `/mermaid-js/mermaid`): /mermaid-js/mermaid
- ESLint CLI docs (lint command usage + exit codes): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI docs (format/check options): https://prettier.io/docs/cli/
- Markdown Guide (doc formatting): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current flow discovery and list contract:
   - Files to read:
     - `server/src/flows/discovery.ts`
     - `server/src/routes/flows.ts`
     - `server/src/flows/flowSchema.ts`
     - `server/src/lmstudio/toolService.ts`
     - `server/src/test/integration/flows.list.test.ts`
     - `openapi.json`
   - Docs to read: Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
2. [ ] Add ingest repo lookup + flow discovery:
   - Files to edit:
     - `server/src/flows/discovery.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Scan `<ingestRoot>/flows` for JSON flows, add `sourceId` from `RepoEntry.containerPath` and `sourceLabel` from `RepoEntry.id`.
     - Reuse `parseFlowFile` + existing summary builder logic from `server/src/flows/discovery.ts` so invalid JSON/schema handling matches local flows.
     - If `listIngestedRepositories` fails, return local flows only without adding new logging.
     - Skip ingest roots that are missing on disk or do not contain a `flows/` folder.
3. [ ] Add labels + sort for local/ingested flows:
   - Files to edit:
     - `server/src/flows/discovery.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Use `RepoEntry.id` as `sourceLabel` (it already falls back to ingest metadata name or container basename).
     - Only apply an extra `path.posix.basename` fallback if `RepoEntry.id` is unexpectedly empty.
     - Keep local flows unlabeled; sort by display label.
     - Do not de-duplicate names; preserve duplicates across ingest roots.
4. [ ] Update REST list payload + OpenAPI schema:
   - Files to edit:
     - `server/src/routes/flows.ts`
     - `openapi.json`
   - Docs to read: OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - Add optional `sourceId`/`sourceLabel` fields to REST list payloads for ingested items only.
     - Update the `FlowSummary` type in `server/src/flows/discovery.ts` to include optional `sourceId`/`sourceLabel` for ingested flows.
5. [ ] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: ingested flows include `sourceId`/`sourceLabel` and sorting uses display label; purpose: verify list contract + ordering.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
6. [ ] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: local flows omit `sourceId`/`sourceLabel`; purpose: preserve local payload shape.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
7. [ ] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: `sourceLabel` falls back to ingest root basename when metadata name missing; purpose: enforce fallback rule.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
8. [ ] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: duplicate flow names across ingest roots are retained and sorted; purpose: deterministic duplicate handling.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
9. [ ] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: missing ingest root directories are skipped and local flows still return; purpose: guard missing directories.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
10. [ ] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: ingest roots with no `flows/` directory are skipped and local flows still return; purpose: handle empty roots safely.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
11. [ ] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: listIngestedRepositories failures return local flows only; purpose: keep list responses available when ingest metadata is unavailable.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
12. [ ] Update documentation — `design.md` (flow discovery changes, plus Mermaid diagram updates).
    - Document: `design.md`.
    - Location: repo root `design.md`.
    - Description: Describe ingested flow discovery, list metadata, and update related Mermaid diagrams.
    - Purpose: keep flow architecture documentation aligned with new discovery behavior.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
13. [ ] Update documentation — `README.md`.
    - Document: `README.md`.
    - Location: repo root `README.md`.
    - Description: Note optional flow list fields (`sourceId`/`sourceLabel`) if README documents list responses.
    - Purpose: keep public API notes current.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
14. [ ] After completing any file adds/removes in this task, update `projectStructure.md`:
    - Document: `projectStructure.md`.
    - Location: repo root `projectStructure.md`.
    - Description: Record any added/removed files or confirm no change.
    - Purpose: ensure repository map stays current after structural edits.
    - Added files: none.
    - Removed files: none.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.
    - Docs to read: npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/

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

- Node.js path docs (path.resolve/path.relative containment checks): Context7 `/nodejs/node/v22.17.0`
- OpenAPI 3.0.3 spec (schema field updates): https://spec.openapis.org/oas/v3.0.3.html
- npm run-script docs (workspace script execution): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Node.js test runner docs (`node:test` usage + CLI flags): https://nodejs.org/api/test.html
- Jest docs (Context7 `/jestjs/jest`): /jestjs/jest
- ESLint CLI docs (lint command usage + exit codes): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI docs (format/check options): https://prettier.io/docs/cli/
- Markdown Guide (doc formatting): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review flow run loading and validation:
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/routes/flowsRun.ts`
     - `server/src/flows/types.ts`
     - `server/src/test/integration/flows.run.basic.test.ts`
     - `server/src/test/integration/flows.run.hot-reload.test.ts`
     - `openapi.json`
   - Docs to read: Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
2. [ ] Add sourceId resolution + containment checks:
   - Files to edit:
     - `server/src/flows/service.ts`
   - Docs to read: Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Accept `sourceId` (container path) and map it to `RepoEntry.containerPath` from `listIngestedRepositories`.
     - Extend `FlowRunStartParams` and `startFlowRun` signatures to accept optional `sourceId` and thread it to flow loading.
     - Extend `loadFlowFile` to accept an optional base directory (local flows dir vs. `<sourceId>/flows`) and reuse it for both local and ingested runs.
     - Resolve `<sourceId>/flows/<flowName>.json` and enforce containment checks with `path.resolve` + `path.relative`.
     - Continue to enforce `isSafeFlowName` validation for ingested runs (same rules as local runs).
     - Treat unknown `sourceId` as `FLOW_NOT_FOUND` so REST returns `404 { error: 'not_found' }`.
     - Missing ingested flow files should surface `FLOW_NOT_FOUND` (same 404 contract).
3. [ ] Update REST run payload + OpenAPI schema:
   - Files to edit:
     - `server/src/routes/flowsRun.ts`
     - `openapi.json`
   - Docs to read: OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - Accept optional `sourceId` in REST payloads and pass it into the flow service.
4. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.basic.test.ts`: unknown `sourceId` returns 404; purpose: validate error handling for invalid ingest roots.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
5. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.basic.test.ts`: ingested flow runs when `sourceId` resolves to a valid flow file; purpose: cover happy-path ingest execution.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
6. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.basic.test.ts`: local flow run works when `sourceId` is omitted; purpose: ensure local behavior unchanged.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
7. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.hot-reload.test.ts`: missing ingested flow file returns 404; purpose: validate not_found for missing files.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
8. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.command.test.ts`: path traversal attempt in flow name is rejected by containment checks; purpose: enforce path safety.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
9. [ ] Update documentation — `design.md` (run payload changes).
   - Document: `design.md`.
   - Location: repo root `design.md`.
   - Description: Document flow run `sourceId` behavior and update Mermaid diagrams covering run flows.
   - Purpose: keep flow execution architecture accurate.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
10. [ ] Update documentation — `README.md`.
    - Document: `README.md`.
    - Location: repo root `README.md`.
    - Description: Note optional `sourceId` on flow run payloads if README documents run endpoints.
    - Purpose: keep API usage instructions current.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
11. [ ] After completing any file adds/removes in this task, update `projectStructure.md`:
    - Document: `projectStructure.md`.
    - Location: repo root `projectStructure.md`.
    - Description: Record any added/removed files or confirm no change.
    - Purpose: ensure repository map stays current after structural edits.
    - Added files: none.
    - Removed files: none.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.
    - Docs to read: npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/

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

- MUI Select docs (labels + MenuItem usage): MUI MCP `/mui/material@6.4.12` — https://llms.mui.com/material-ui/6.4.12/components/selects.md
- React state + hooks (controlled selects + derived state): Context7 `/websites/react_dev`
- React Testing Library docs (queries + user events): https://testing-library.com/docs/react-testing-library/intro/
- Jest docs (Context7 `/jestjs/jest`): /jestjs/jest
- Mermaid docs (Context7 `/mermaid-js/mermaid`): /mermaid-js/mermaid
- npm run-script docs (workspace script execution): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- ESLint CLI docs (lint command usage + exit codes): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI docs (format/check options): https://prettier.io/docs/cli/
- Markdown Guide (doc formatting): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current agents command list + run flow:
   - Files to read:
     - `client/src/api/agents.ts`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/test/agentsPage.commandsList.test.tsx`
     - `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
2. [ ] Update agents API list parsing:
   - Files to edit:
     - `client/src/api/agents.ts`
   - Docs to read: React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Extend the command type to include optional `sourceId`/`sourceLabel` fields.
     - Parse optional `sourceId`/`sourceLabel` from the command list response and include them in the returned command objects.
3. [ ] Update dropdown rendering + selection state:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Compute display labels (`<name>` vs `<name> - [sourceLabel]`).
     - Store `sourceId`/`sourceLabel` with each command and use a composite selection key so duplicate command names remain selectable.
     - Sort by display label and keep local commands unlabeled.
4. [ ] Update run payload support in agents API:
   - Files to edit:
     - `client/src/api/agents.ts`
   - Docs to read: React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Accept optional `sourceId` in `runAgentCommand` params and include it in the payload when provided.
5. [ ] Update run action to pass `sourceId`:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - When the selected command has a `sourceId`, include it in the run payload; omit `sourceId` for local commands.
6. [ ] Client unit test (commands list) — `client/src/test/agentsPage.commandsList.test.tsx`: duplicate command names from different sources render distinct labels; purpose: confirm display label + sorting behavior.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
7. [ ] Client unit test (commands run) — `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`: ingested command run sends the correct `sourceId` in payload; purpose: verify ingest run wiring.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
8. [ ] Client unit test (commands run) — `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`: local command run omits `sourceId` in payload; purpose: keep local run behavior unchanged.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
9. [ ] Update documentation — `design.md` (UI behavior summary, plus Mermaid diagram updates where applicable).
   - Document: `design.md`.
   - Location: repo root `design.md`.
   - Description: Describe command dropdown label/sort behavior and update any related Mermaid UI/flow diagrams.
   - Purpose: keep UI/architecture references aligned with new ingested command UX.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
10. [ ] Update documentation — `README.md`.
   - Document: `README.md`.
   - Location: repo root `README.md`.
   - Description: Mention UI behavior changes if README documents command execution workflows.
   - Purpose: keep user-facing usage notes current.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
11. [ ] After completing any file adds/removes in this task, update `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: repo root `projectStructure.md`.
   - Description: Record any added/removed files or confirm no change.
   - Purpose: ensure repository map stays current after structural edits.
   - Added files: none.
   - Removed files: none.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.
    - Docs to read: npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/

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

- MUI Select docs (labels + MenuItem usage): MUI MCP `/mui/material@6.4.12` — https://llms.mui.com/material-ui/6.4.12/components/selects.md
- React state + hooks (controlled selects + derived state): Context7 `/websites/react_dev`
- React Testing Library docs (queries + user events): https://testing-library.com/docs/react-testing-library/intro/
- Jest docs (Context7 `/jestjs/jest`): /jestjs/jest
- Mermaid docs (Context7 `/mermaid-js/mermaid`): /mermaid-js/mermaid
- npm run-script docs (workspace script execution): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- ESLint CLI docs (lint command usage + exit codes): https://eslint.org/docs/latest/use/command-line-interface
- Prettier CLI docs (format/check options): https://prettier.io/docs/cli/
- Markdown Guide (doc formatting): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current flows list + run flow:
   - Files to read:
     - `client/src/api/flows.ts`
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/flowsApi.test.ts`
     - `client/src/test/flowsPage.stop.test.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
2. [ ] Update flows API list parsing:
   - Files to edit:
     - `client/src/api/flows.ts`
   - Docs to read: React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Extend the `FlowSummary` type to include optional `sourceId`/`sourceLabel` fields.
     - Parse optional `sourceId`/`sourceLabel` from the flows list response and include them in the returned flow objects.
3. [ ] Update dropdown rendering + selection state:
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Compute display labels (`<name>` vs `<name> - [sourceLabel]`).
     - Store `sourceId`/`sourceLabel` with each flow and use a composite selection key so duplicate flow names remain selectable.
     - Sort by display label and keep local flows unlabeled.
4. [ ] Update run payload support in flows API:
   - Files to edit:
     - `client/src/api/flows.ts`
   - Docs to read: React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Accept optional `sourceId` in `runFlow` params and include it in the payload when provided.
5. [ ] Update run action to pass `sourceId`:
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - When the selected flow has a `sourceId`, include it in the run payload; omit `sourceId` for local flows.
6. [ ] Client unit test (flows list UI) — `client/src/test/flowsPage.stop.test.tsx`: duplicate flow names from different sources render distinct labels; purpose: confirm display label + sorting behavior.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
7. [ ] Client unit test (flows run) — `client/src/test/flowsPage.stop.test.tsx`: ingested flow run sends the correct `sourceId` payload; purpose: verify ingest run wiring.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
8. [ ] Client unit test (flows run) — `client/src/test/flowsPage.stop.test.tsx`: local flow run omits `sourceId` in payload; purpose: keep local run behavior unchanged.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
9. [ ] Update documentation — `design.md` (UI behavior summary, plus Mermaid diagram updates where applicable).
   - Document: `design.md`.
   - Location: repo root `design.md`.
   - Description: Describe flow dropdown label/sort behavior and update any related Mermaid UI/flow diagrams.
   - Purpose: keep UI/architecture references aligned with new ingested flow UX.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
10. [ ] Update documentation — `README.md`.
   - Document: `README.md`.
   - Location: repo root `README.md`.
   - Description: Mention UI behavior changes if README documents flow execution workflows.
   - Purpose: keep user-facing usage notes current.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
11. [ ] After completing any file adds/removes in this task, update `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: repo root `projectStructure.md`.
   - Description: Record any added/removed files or confirm no change.
   - Purpose: ensure repository map stays current after structural edits.
   - Added files: none.
   - Removed files: none.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues if needed.
    - Docs to read: npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/

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

- Docker Compose build command docs: https://docs.docker.com/reference/cli/docker/compose/build/
- Docker Compose up command docs: https://docs.docker.com/reference/cli/docker/compose/up/
- Docker Compose down command docs: https://docs.docker.com/reference/cli/docker/compose/down/
- Playwright writing tests guide (test runner usage): https://playwright.dev/docs/writing-tests
- Husky docs (Git hooks + skips): https://typicode.github.io/husky/
- Mermaid docs (Context7 `/mermaid-js/mermaid`): /mermaid-js/mermaid
- Mermaid syntax reference (diagram updates): https://mermaid.js.org/intro/syntax-reference.html
- Jest docs (Context7 `/jestjs/jest`): /jestjs/jest
- Jest getting started docs (CLI + config): https://jestjs.io/docs/getting-started
- Cucumber guides (BDD workflow): https://cucumber.io/docs/guides/
- npm run-script docs (workspace script execution): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Markdown Guide (doc formatting): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] perform a clean docker build
4. [ ] Documentation update — `README.md`:
   - Document: `README.md`.
   - Location: repo root `README.md`.
   - Description: Capture any new commands or API usage notes introduced by this story.
   - Purpose: keep user-facing setup/run guidance current before final verification.
5. [ ] Documentation update — `design.md`:
   - Document: `design.md`.
   - Location: repo root `design.md`.
   - Description: Capture architecture updates and refresh Mermaid diagrams added/updated in this story.
   - Purpose: ensure design reference is current before final verification.
6. [ ] After all file adds/removes are complete, update `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: repo root `projectStructure.md`.
   - Description: Record any added/removed files or confirm no change.
   - Purpose: keep repository map accurate for final handoff.
   - Added files: none.
   - Removed files: none.
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
