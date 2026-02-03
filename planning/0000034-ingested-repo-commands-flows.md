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

- Task Status: **__in_progress__**
- Git Commits: c964fec

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

1. [x] Review current list logic and ingest metadata usage:
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
   - Checklist (duplicate rules): confirm `sourceId = RepoEntry.containerPath`, `sourceLabel = RepoEntry.id` fallback, and label format `<name> - [sourceLabel]`.
2. [x] Add ingest repo lookup + command discovery:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Implementation details:
     - Pull ingest roots via `listIngestedRepositories` and scan `<root>/codex_agents/<agentName>/commands` for JSON files.
     - Use `RepoEntry.containerPath` as the ingest root path and `RepoEntry.id` (already built via `buildRepoId`) as the display label.
     - Reuse `loadAgentCommandSummary` from `server/src/agents/commandsLoader.ts` for both local and ingested files so invalid JSON/schema handling stays consistent.
     - If `listIngestedRepositories` fails (for example, Chroma unavailable), return local commands only without adding new logging.
     - Skip ingest roots that are missing on disk or do not contain `codex_agents/<agentName>/commands` (no errors, just omit).
     - Add log line (server logStore append) after the combined list is built: message `DEV-0000034:T1:commands_listed` with context `{ agentName, localCount, ingestedCount, totalCount }`.
     - Example (pseudo):
       - `const roots = await listIngestedRepositories().catch(() => null);`
       - `const commandsRoot = path.join(repo.containerPath, 'codex_agents', agentName, 'commands');`
3. [x] Add labels + sort for local/ingested commands:
   - Files to edit:
     - `server/src/agents/service.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; npm run-script docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Implementation details:
     - Use `RepoEntry.containerPath` as `sourceId` and `RepoEntry.id` as `sourceLabel` (it already falls back to ingest metadata name or container basename).
     - Only apply an extra `path.posix.basename` fallback if `RepoEntry.id` is unexpectedly empty.
     - Keep local commands unlabeled (no `sourceId`/`sourceLabel`).
     - Sort the combined list by display label (`<name>` for local, `<name> - [sourceLabel]` for ingested).
     - Do not de-duplicate names; preserve duplicates across ingest roots.
     - Example display label logic:
       - `const displayLabel = sourceLabel ? name + ' - [' + sourceLabel + ']' : name;`
       - `commands.sort((a, b) => displayLabel(a).localeCompare(displayLabel(b)));`
4. [x] Update REST list payload + OpenAPI schema:
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
     - `openapi.json`
   - Docs to read: OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Implementation details:
     - Add optional `sourceId`/`sourceLabel` fields to REST list payloads for ingested items only.
     - Update the list command DTO/type in `server/src/agents/service.ts` so `sourceId`/`sourceLabel` are optional and omitted for local commands.
     - Example REST item: `{ name: 'build', description: 'Builds', disabled: false, sourceId: '/data/repo', sourceLabel: 'My Repo' }`.
5. [x] Update MCP list payload:
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Implementation details:
     - Add optional `sourceId`/`sourceLabel` fields to MCP list payloads for ingested items only.
     - Example MCP payload item (JSON): `{ name: 'build', description: 'Builds', disabled: false, sourceId: '/data/repo', sourceLabel: 'My Repo' }`.
6. [x] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure ingested commands include `sourceId`/`sourceLabel` and sorting uses the display label; purpose: lock down REST list contract + deterministic ordering.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: returned list contains `{ name: 'build', sourceId: '/data/repo', sourceLabel: 'My Repo' }` and sorts by `build - [My Repo]`.
7. [x] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure local commands omit `sourceId`/`sourceLabel`; purpose: keep local payloads unchanged.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: local entry equals `{ name: 'build', description: 'Builds', disabled: false }` with no `sourceId`/`sourceLabel` keys.
8. [x] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure `sourceLabel` falls back to ingest root basename when metadata name missing; purpose: enforce fallback label rule.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: metadata name missing => `sourceLabel === 'repo-folder'` and display label `build - [repo-folder]`.
9. [x] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure ingested commands are skipped when the matching agent does not exist locally; purpose: avoid invalid listings.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: if `agentName` not discovered locally, list excludes ingested commands entirely.
10. [x] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure duplicate command names across ingest roots are retained and sorted by label; purpose: confirm deterministic duplicate handling.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: two entries named `build` with different `sourceId` values both appear and order is by `build - [A]` then `build - [B]`.
11. [x] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: ensure missing ingest root directories are skipped and local commands still return; purpose: guard missing directories.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: missing `/data/repo/codex_agents/.../commands` does not throw and local list remains unchanged.
12. [x] Unit test (REST list) — `server/src/test/unit/agent-commands-list.test.ts`: listIngestedRepositories failures return local commands only; purpose: keep lists functional if ingest metadata is unavailable.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: when `listIngestedRepositories` rejects, output equals the local-only list with no ingested entries.
13. [x] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure ingested commands include `sourceId`/`sourceLabel` and sorting uses display label; purpose: keep MCP parity with REST.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: MCP JSON contains `{ name: 'build', sourceId: '/data/repo', sourceLabel: 'My Repo' }` and sorts by display label.
14. [x] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure local commands omit `sourceId`/`sourceLabel`; purpose: keep MCP local payloads unchanged.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: MCP local entry excludes `sourceId`/`sourceLabel` keys.
15. [x] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure `sourceLabel` falls back to ingest root basename when metadata name missing; purpose: enforce MCP fallback label rule.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: `sourceLabel` equals basename of `sourceId` when metadata name is empty.
16. [x] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure ingested commands are skipped when the matching agent does not exist locally; purpose: prevent invalid MCP listings.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: MCP response omits ingested entries for unknown local agents.
17. [x] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure duplicate command names across ingest roots are retained and sorted by label; purpose: match REST duplicate handling.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: MCP `build - [A]` appears before `build - [B]` with both entries present.
18. [x] Unit test (MCP list) — `server/src/test/unit/mcp-agents-commands-list.test.ts`: ensure missing ingest root directories are skipped and local commands still return; purpose: guard missing directories in MCP list.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: missing ingest directories do not remove local commands from MCP output.
19. [x] Update documentation — `design.md`:
    - Document: `design.md`.
    - Location: repo root `design.md`.
    - Description: Add/confirm command discovery includes ingested repos and the label/sorting rules, and update the related Mermaid architecture diagram(s).
    - Include (duplicate rules): `sourceId = RepoEntry.containerPath`, `sourceLabel = RepoEntry.id` (fallback to ingest root basename), and label format `<name> - [sourceLabel]`.
    - Purpose: keep architecture/design reference aligned with the new command discovery behavior.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
20. [x] Update documentation — `README.md`:
    - Document: `README.md`.
    - Location: repo root `README.md`.
    - Description: Note any new agent command list fields (`sourceId`/`sourceLabel`) if documentation mentions list payloads.
    - Include (duplicate rules): `sourceId` optional, `sourceLabel` optional, local entries omit both.
    - Purpose: keep public API usage notes accurate for operators.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
21. [x] After completing any file adds/removes in this task, update `projectStructure.md`:
    - Document: `projectStructure.md`.
    - Location: repo root `projectStructure.md`.
    - Description: Record any added/removed files or confirm no change.
    - Purpose: ensure repository map stays current after structural edits.
    - Added files: none.
    - Removed files: none.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
22. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open http://host.docker.internal:5001/logs and confirm log entry `DEV-0000034:T1:commands_listed` appears with `{ agentName, localCount, ingestedCount, totalCount }` matching the selected agent; verify no errors appear in the debug console. (UI label verification is covered in Task 5 after client updates.)
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed current command listing, MCP list mapping, ingest repo metadata (`RepoEntry`), and tests to align upcoming changes with existing list/run flows.
- Added ingested command discovery in `listAgentCommands`, reusing the command summary loader and ignoring missing/failed ingest roots.
- Added `sourceId`/`sourceLabel` metadata for ingested commands and sorted combined results by display label.
- Documented the agent commands list response in `openapi.json`, including optional source fields.
- MCP `list_commands` now returns `sourceId`/`sourceLabel` for ingested entries while keeping local entries unchanged.
- Extended REST/MCP unit tests to cover ingested metadata, label sorting, fallback labels, duplicate names, and failure/missing-root handling.
- Added MCP list tests for local-only payloads, fallback labels, and duplicate ingested labels.
- Updated `design.md` to document ingested command discovery, source metadata, and label sorting, plus refreshed the agents flow diagram.
- Updated `README.md` with optional `sourceId`/`sourceLabel` notes for ingested command lists.
- Confirmed `projectStructure.md` needs no changes for this task.
- Ran workspace lint and format checks; applied Prettier to resolve formatting warnings.
- Server tests required a longer timeout; reran with an extended limit until completion.
- Answer: UI label verification is deferred to Task 5 once client changes land; Task 1 manual check is considered complete based on the `DEV-0000034:T1:commands_listed` log entry showing `localCount=1` and `ingestedCount=1`.

---

### 2. Server: Agent command run sourceId support (REST + MCP)

- Task Status: **__done__**
- Git Commits: 6eb6dd7, 5097f0c

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

1. [x] Review current run validation + command loading:
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
   - Checklist (duplicate rules): unknown `sourceId` must map to `COMMAND_NOT_FOUND` (404) and local runs omit `sourceId`.
2. [x] Add sourceId resolution + containment checks:
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
   - Add log line (server logStore append) after resolving the command file (local or ingested): message `DEV-0000034:T2:command_run_resolved` with context `{ agentName, commandName, sourceId: sourceId ?? 'local', commandPath }`.
   - Example containment check:
     - `const resolved = path.resolve(commandsRoot, commandName + '.json');`
     - `if (path.relative(commandsRoot, resolved).startsWith('..')) throw { code: 'COMMAND_INVALID' };`
3. [x] Update REST run payload + OpenAPI schema:
   - Files to edit:
     - `server/src/routes/agentsCommands.ts`
     - `openapi.json`
   - Docs to read: OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - Accept optional `sourceId` in REST payloads and pass it into the service layer.
     - Example request JSON: `{ "commandName": "build", "sourceId": "/data/repo" }`.
4. [x] Update MCP run payload:
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Docs to read: Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - Accept optional `sourceId` in MCP payloads and forward to `runAgentCommand`.
     - Example MCP args: `{ agentName: "planning_agent", commandName: "build", sourceId: "/data/repo" }`.
5. [x] Unit test (REST run) — `server/src/test/unit/agents-commands-router-run.test.ts`: unknown `sourceId` returns 404; purpose: validate error handling for invalid ingest roots.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: `POST /agents/:agent/commands/run` with `{ commandName: 'build', sourceId: '/data/missing' }` returns `404 { error: 'not_found' }`.
6. [x] Unit test (REST run) — `server/src/test/unit/agents-commands-router-run.test.ts`: local command run works when `sourceId` is omitted; purpose: ensure local behavior unchanged.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: payload `{ commandName: 'build' }` routes to local command path and returns 202.
7. [x] Unit test (REST run) — `server/src/test/unit/agents-commands-router-run.test.ts`: ingested command runs when `sourceId` resolves to a valid command file; purpose: cover happy-path ingest execution.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: `{ commandName: 'build', sourceId: '/data/repo' }` returns 202 and uses ingested file path.
8. [x] Unit test (REST run) — `server/src/test/unit/agents-commands-router-run.test.ts`: missing ingested command file returns 404; purpose: validate not_found for missing files.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: `{ commandName: 'missing', sourceId: '/data/repo' }` yields `404 { error: 'not_found' }`.
9. [x] Unit test (command runner) — `server/src/test/unit/agent-commands-runner.test.ts`: path traversal attempt in command name is rejected by containment checks; purpose: enforce path safety.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: commandName `../escape` triggers `COMMAND_INVALID` or equivalent rejection.
10. [x] Unit test (MCP run) — `server/src/test/unit/mcp-agents-router-run.test.ts`: unknown `sourceId` returns not_found; purpose: validate MCP error handling.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: MCP `run_command` with `sourceId: '/data/missing'` throws `InvalidParamsError` mapped from `COMMAND_NOT_FOUND`.
11. [x] Unit test (MCP run) — `server/src/test/unit/mcp-agents-router-run.test.ts`: local command run works when `sourceId` is omitted; purpose: keep MCP local behavior unchanged.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: MCP args without `sourceId` run the local command folder.
12. [x] Unit test (MCP run) — `server/src/test/unit/mcp-agents-router-run.test.ts`: ingested command runs when `sourceId` resolves to a valid command file; purpose: MCP happy-path coverage.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: MCP args with `sourceId: '/data/repo'` resolve to `<sourceId>/codex_agents/<agent>/commands/<command>.json`.
13. [x] Unit test (MCP run) — `server/src/test/unit/mcp-agents-router-run.test.ts`: missing ingested command file returns not_found; purpose: MCP missing-file error coverage.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: MCP `run_command` with missing ingested file maps to not_found error response.
14. [x] Update documentation — `design.md` (run payload changes, plus Mermaid diagram updates).
    - Document: `design.md`.
    - Location: repo root `design.md`.
    - Description: Describe `sourceId` run support and update any related Mermaid flow/run diagrams.
    - Include (duplicate rules): REST/MCP run accepts optional `sourceId` (container path) and unknown `sourceId` returns 404.
    - Purpose: keep architecture/design references aligned with new run payload behavior.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
15. [x] Update documentation — `README.md`.
    - Document: `README.md`.
    - Location: repo root `README.md`.
    - Description: Note optional `sourceId` on agent command run payloads if README covers endpoints.
    - Include (duplicate rules): local runs omit `sourceId`; ingested runs require it to disambiguate.
    - Purpose: keep API usage instructions current.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
16. [x] After completing any file adds/removes in this task, update `projectStructure.md`:
    - Document: `projectStructure.md`.
    - Location: repo root `projectStructure.md`.
    - Description: Record any added/removed files or confirm no change.
    - Purpose: ensure repository map stays current after structural edits.
    - Added files: none.
    - Removed files: none.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
17. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open http://host.docker.internal:5001/logs and confirm `DEV-0000034:T2:command_run_resolved` appears with `{ agentName, commandName, sourceId, commandPath }` for a local run; verify no errors appear in the debug console. (Ingested command run verification is covered in Task 5 after client payload updates.)
9. [x] `npm run compose:down`

#### Implementation notes

- Reviewed existing run validation and command runner behavior to align new sourceId support with current error mapping and containment checks.
- Added sourceId-aware resolution, containment guards, and `DEV-0000034:T2:command_run_resolved` logging to command execution.
- Updated REST/MCP run payload handling plus OpenAPI docs, and added targeted tests for sourceId handling.
- Updated `design.md` and `README.md` to note optional `sourceId` in command run payloads.
- Confirmed `projectStructure.md` needs no updates for this task.
- Ran workspace lint and format checks; applied Prettier to resolve formatting warnings.
- Added REST/MCP run coverage for ingested command payloads and command runner path traversal protection; extended MCP tool schema to accept `sourceId`.
- Answer: Ingested command run verification is deferred to Task 5 once the client sends `sourceId`; Task 2 manual check is complete based on the `DEV-0000034:T2:command_run_resolved` log entry for a local run.

---

### 3. Server: Ingested flow discovery + list contract

- Task Status: **__in_progress__**
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

1. [x] Review current flow discovery and list contract:
   - Files to read:
     - `server/src/flows/discovery.ts`
     - `server/src/routes/flows.ts`
     - `server/src/flows/flowSchema.ts`
     - `server/src/lmstudio/toolService.ts`
     - `server/src/test/integration/flows.list.test.ts`
     - `openapi.json`
   - Docs to read: Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Checklist (duplicate rules): ingested flows use `sourceId = RepoEntry.containerPath` and label format `<name> - [sourceLabel]`.
2. [x] Add ingest repo lookup + flow discovery:
   - Files to edit:
     - `server/src/flows/discovery.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Scan `<ingestRoot>/flows` for JSON flows, add `sourceId` from `RepoEntry.containerPath` and `sourceLabel` from `RepoEntry.id`.
     - Reuse `parseFlowFile` + existing summary builder logic from `server/src/flows/discovery.ts` so invalid JSON/schema handling matches local flows.
     - If `listIngestedRepositories` fails, return local flows only without adding new logging.
     - Skip ingest roots that are missing on disk or do not contain a `flows/` folder.
     - Example (pseudo):
       - `const flowsRoot = path.join(repo.containerPath, 'flows');`
       - `summaries.push({ name, sourceId: repo.containerPath, sourceLabel: repo.id, ... });`
3. [x] Add labels + sort for local/ingested flows:
   - Files to edit:
     - `server/src/flows/discovery.ts`
   - Docs to read: Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
   - Use `RepoEntry.id` as `sourceLabel` (it already falls back to ingest metadata name or container basename).
   - Only apply an extra `path.posix.basename` fallback if `RepoEntry.id` is unexpectedly empty.
   - Keep local flows unlabeled; sort by display label.
   - Do not de-duplicate names; preserve duplicates across ingest roots.
   - Add log line (server logStore append) after the combined list is built: message `DEV-0000034:T3:flows_listed` with context `{ localCount, ingestedCount, totalCount }`.
   - Example display label logic:
     - `const displayLabel = sourceLabel ? name + ' - [' + sourceLabel + ']' : name;`
     - `flows.sort((a, b) => displayLabel(a).localeCompare(displayLabel(b)));`
4. [x] Update REST list payload + OpenAPI schema:
   - Files to edit:
     - `server/src/routes/flows.ts`
     - `openapi.json`
   - Docs to read: OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js `fs.readdir` + `path.resolve` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - Add optional `sourceId`/`sourceLabel` fields to REST list payloads for ingested items only.
     - Update the `FlowSummary` type in `server/src/flows/discovery.ts` to include optional `sourceId`/`sourceLabel` for ingested flows.
     - Example REST item: `{ name: 'release', description: 'Ship', disabled: false, sourceId: '/data/repo', sourceLabel: 'My Repo' }`.
5. [x] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: ingested flows include `sourceId`/`sourceLabel` and sorting uses display label; purpose: verify list contract + ordering.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: flow list includes `{ name: 'release', sourceId: '/data/repo', sourceLabel: 'My Repo' }` and order uses `release - [My Repo]`.
6. [x] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: local flows omit `sourceId`/`sourceLabel`; purpose: preserve local payload shape.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: local entry contains only `{ name, description, disabled }` without `sourceId`/`sourceLabel`.
7. [x] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: `sourceLabel` falls back to ingest root basename when metadata name missing; purpose: enforce fallback rule.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: empty metadata name => `sourceLabel === 'repo-folder'` and label `release - [repo-folder]`.
8. [x] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: duplicate flow names across ingest roots are retained and sorted; purpose: deterministic duplicate handling.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: two `release` flows with different `sourceId` values both appear and order is by display label.
9. [x] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: missing ingest root directories are skipped and local flows still return; purpose: guard missing directories.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: missing `/data/repo/flows` does not remove local flows from the response.
10. [x] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: ingest roots with no `flows/` directory are skipped and local flows still return; purpose: handle empty roots safely.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: ingest root `/data/repo` without `flows/` yields local flows only (no error).
11. [x] Integration test (flow list) — `server/src/test/integration/flows.list.test.ts`: listIngestedRepositories failures return local flows only; purpose: keep list responses available when ingest metadata is unavailable.
    - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
    - Example expectation: when `listIngestedRepositories` rejects, response equals the local-only flow list.
12. [x] Update documentation — `design.md` (flow discovery changes, plus Mermaid diagram updates).
    - Document: `design.md`.
    - Location: repo root `design.md`.
    - Description: Describe ingested flow discovery, list metadata, and update related Mermaid diagrams.
    - Include (duplicate rules): `sourceId = RepoEntry.containerPath`, `sourceLabel = RepoEntry.id` fallback, label format `<name> - [sourceLabel]`.
    - Purpose: keep flow architecture documentation aligned with new discovery behavior.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
13. [x] Update documentation — `README.md`.
    - Document: `README.md`.
    - Location: repo root `README.md`.
    - Description: Note optional flow list fields (`sourceId`/`sourceLabel`) if README documents list responses.
    - Include (duplicate rules): local flow list entries omit `sourceId`/`sourceLabel`.
    - Purpose: keep public API notes current.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
14. [x] After completing any file adds/removes in this task, update `projectStructure.md`:
    - Document: `projectStructure.md`.
    - Location: repo root `projectStructure.md`.
    - Description: Record any added/removed files or confirm no change.
    - Purpose: ensure repository map stays current after structural edits.
    - Added files: none.
    - Removed files: none.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
15. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: open http://host.docker.internal:5001/logs and confirm log entry `DEV-0000034:T3:flows_listed` appears with `{ localCount, ingestedCount, totalCount }`; verify no errors appear in the debug console. (UI label verification is covered in Task 6 after client updates.)
9. [x] `npm run compose:down`

#### Implementation notes

- Added ingested flow discovery in `server/src/flows/discovery.ts` by combining local `flows/` with `<ingestRoot>/flows` using `listIngestedRepositories`, `sourceId`/`sourceLabel`, and a shared summary builder.
- Introduced display-label sorting (`name - [sourceLabel]`) while keeping local flows unlabeled and preserving duplicate names across ingest roots.
- Logged `DEV-0000034:T3:flows_listed` with `{ localCount, ingestedCount, totalCount }` once the combined list is built; kept local-only behavior when ingest repo listing fails.
- Updated `server/src/routes/flows.ts` to pass `listIngestedRepositories` into discovery and documented the list schema additions in `openapi.json`.
- Expanded `server/src/test/integration/flows.list.test.ts` to cover ingested metadata, sorting, fallback labels, duplicates, missing/misconfigured roots, and `listIngestedRepositories` failures.
- Updated `design.md` and `README.md` for flow list metadata; confirmed `projectStructure.md` needs no change.
- Lint/format checks completed (`npm run lint --workspaces`, `npm run format --workspaces`, `npm run format:check --workspaces`) with only existing eslint warnings in other files.
- Manual check: `/logs` confirmed `DEV-0000034:T3:flows_listed` with `{ localCount: 2, ingestedCount: 1, totalCount: 3 }` at 2026-02-03 12:04:51 AM.
- Answer: UI label verification is deferred to Task 6 once the client renders display labels; Task 3 manual check is complete based on the `DEV-0000034:T3:flows_listed` log entry.

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
   - Checklist (duplicate rules): `sourceId` selects `<sourceId>/flows/<flow>.json`; unknown `sourceId` returns 404.
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
   - Add log line (server logStore append) after resolving the flow file (local or ingested): message `DEV-0000034:T4:flow_run_resolved` with context `{ flowName, sourceId: sourceId ?? 'local', flowPath }`.
   - Example containment check:
     - `const resolved = path.resolve(flowsRoot, flowName + '.json');`
     - `if (path.relative(flowsRoot, resolved).startsWith('..')) throw { code: 'FLOW_NOT_FOUND' };`
3. [ ] Update REST run payload + OpenAPI schema:
   - Files to edit:
     - `server/src/routes/flowsRun.ts`
     - `openapi.json`
   - Docs to read: OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html; Node.js `path.resolve`/`path.relative` (Context7 `/nodejs/node/v22.17.0`): /nodejs/node/v22.17.0; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
     - Accept optional `sourceId` in REST payloads and pass it into the flow service.
     - Example request JSON: `{ "sourceId": "/data/repo", "customTitle": "Release Run" }`.
4. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.basic.test.ts`: unknown `sourceId` returns 404; purpose: validate error handling for invalid ingest roots.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: `POST /flows/release/run` with `{ sourceId: '/data/missing' }` returns `404 { error: 'not_found' }`.
5. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.basic.test.ts`: ingested flow runs when `sourceId` resolves to a valid flow file; purpose: cover happy-path ingest execution.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: `{ sourceId: '/data/repo' }` returns 202 and uses `/data/repo/flows/<flow>.json`.
6. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.basic.test.ts`: local flow run works when `sourceId` is omitted; purpose: ensure local behavior unchanged.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: request without `sourceId` loads from the local flows directory.
7. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.hot-reload.test.ts`: missing ingested flow file returns 404; purpose: validate not_found for missing files.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: `{ sourceId: '/data/repo' }` with missing file returns `404 { error: 'not_found' }`.
8. [ ] Integration test (flow run) — `server/src/test/integration/flows.run.command.test.ts`: path traversal attempt in flow name is rejected by containment checks; purpose: enforce path safety.
   - Docs to read: Node.js test runner docs: https://nodejs.org/api/test.html; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: flowName `../escape` triggers `FLOW_NOT_FOUND` or equivalent 404.
9. [ ] Update documentation — `design.md` (run payload changes).
   - Document: `design.md`.
   - Location: repo root `design.md`.
   - Description: Document flow run `sourceId` behavior and update Mermaid diagrams covering run flows.
   - Include (duplicate rules): `sourceId` selects `<sourceId>/flows/<flowName>.json` and unknown values return 404.
   - Purpose: keep flow execution architecture accurate.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
10. [x] Update documentation — `README.md`.
    - Document: `README.md`.
    - Location: repo root `README.md`.
    - Description: Note optional `sourceId` on flow run payloads if README documents run endpoints.
    - Include (duplicate rules): local flow runs omit `sourceId`; ingested runs require it.
    - Purpose: keep API usage instructions current.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
11. [x] After completing any file adds/removes in this task, update `projectStructure.md`:
    - Document: `projectStructure.md`.
    - Location: repo root `projectStructure.md`.
    - Description: Record any added/removed files or confirm no change.
    - Purpose: ensure repository map stays current after structural edits.
    - Added files: none.
    - Removed files: none.
    - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open http://host.docker.internal:5001/flows, run an ingested flow, confirm run starts successfully; then open http://host.docker.internal:5001/logs and confirm `DEV-0000034:T4:flow_run_resolved` appears with `{ flowName, sourceId, flowPath }` (sourceId should match the ingested `/data/...` root); verify no errors appear in the debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- Parsed `sourceId`/`sourceLabel` in `client/src/api/flows.ts` and added optional `sourceId` to run payloads.
- Updated `client/src/pages/FlowsPage.tsx` to compute display labels, use composite selection keys for duplicate names, sort by label, and log `DEV-0000034:T6:flows.run_payload` before run requests.
- Adjusted flow selection tests to expect composite keys and added UI/run coverage for ingested/local flow payloads in `client/src/test/flowsPage.stop.test.tsx`.
- Updated `design.md` and `README.md` to document flow selector labels and `sourceId` behavior.
- Lint continues to emit existing repo warnings (import order in server tests, baseline-browser-mapping advisory) but no new errors were introduced.
- Manual check: dropdown shows `demo-flow - [Ingested Commands Demo]`; logs include `DEV-0000034:T6:flows.run_payload`; screenshot saved to `playwright-output-local/0000034-6-flows-ingested-run.png`.
- Blocker: ingested flow run returns 404 because server-side flow run `sourceId` support is not implemented yet (Task 4), so Testing step 8 cannot be fully completed.

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
   - Checklist (duplicate rules): dropdown labels use `<name> - [sourceLabel]` and run payloads include `sourceId` for ingested items.
2. [ ] Update agents API list parsing:
   - Files to edit:
     - `client/src/api/agents.ts`
   - Docs to read: React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Extend the command type to include optional `sourceId`/`sourceLabel` fields.
     - Parse optional `sourceId`/`sourceLabel` from the command list response and include them in the returned command objects.
     - Example type: `type Command = { name: string; description: string; disabled: boolean; sourceId?: string; sourceLabel?: string };`.
3. [x] Update dropdown rendering + selection state:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
   - Compute display labels (`<name>` vs `<name> - [sourceLabel]`).
   - Store `sourceId`/`sourceLabel` with each command and use a composite selection key so duplicate command names remain selectable.
   - Sort by display label and keep local commands unlabeled.
   - Ensure ingested commands run without extra confirmation prompts (same trusted flow as local commands).
     - Example display label + key:
       - `const label = sourceLabel ? name + ' - [' + sourceLabel + ']' : name;`
       - `const key = name + '::' + (sourceId ?? 'local');`
4. [ ] Update run payload support in agents API:
   - Files to edit:
     - `client/src/api/agents.ts`
   - Docs to read: React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Accept optional `sourceId` in `runAgentCommand` params and include it in the payload when provided.
     - Example payload: `{ commandName: 'build', sourceId: '/data/repo' }` (omit `sourceId` for local).
5. [x] Update run action to pass `sourceId`:
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
   - When the selected command has a `sourceId`, include it in the run payload; omit `sourceId` for local commands.
   - Example: selected `{ name: 'build', sourceId: '/data/repo' }` => payload includes `sourceId`.
   - Add log line (client logger) before firing the run request: message `DEV-0000034:T5:agents.command_run_payload` with context `{ commandName, sourceId: selected.sourceId ?? 'local' }`.
6. [ ] Client unit test (commands list) — `client/src/test/agentsPage.commandsList.test.tsx`: duplicate command names from different sources render distinct labels; purpose: confirm display label + sorting behavior.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: menu shows `build - [Repo A]` and `build - [Repo B]` as separate options.
7. [ ] Client unit test (commands run) — `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`: ingested command run sends the correct `sourceId` in payload; purpose: verify ingest run wiring.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: selecting `build - [Repo A]` triggers `POST /commands/run` with `{ sourceId: '/data/repo-a' }`.
8. [ ] Client unit test (commands run) — `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`: local command run omits `sourceId` in payload; purpose: keep local run behavior unchanged.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: selecting local `build` results in payload `{ commandName: 'build' }` without `sourceId`.
9. [x] Update documentation — `design.md` (UI behavior summary, plus Mermaid diagram updates where applicable).
   - Document: `design.md`.
   - Location: repo root `design.md`.
   - Description: Describe command dropdown label/sort behavior and update any related Mermaid UI/flow diagrams.
   - Include (duplicate rules): display label format `<name> - [sourceLabel]`, local commands unlabeled, sort by label.
   - Purpose: keep UI/architecture references aligned with new ingested command UX.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
10. [ ] Update documentation — `README.md`.
   - Document: `README.md`.
   - Location: repo root `README.md`.
   - Description: Mention UI behavior changes if README documents command execution workflows.
   - Include (duplicate rules): UI shows ingested labels and uses `sourceId` for runs.
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
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open http://host.docker.internal:5001/agents, verify duplicate command names remain selectable with `name - [Repo]` labels, run an ingested command (confirm no extra confirmation prompt appears); then open http://host.docker.internal:5001/logs and confirm `DEV-0000034:T5:agents.command_run_payload` appears with `{ commandName, sourceId }`; capture a screenshot of the Agents page dropdown + run confirmation and store it in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped by `docker-compose.local.yml`) as `0000034-5-agents-ingested-command.png`, then review the screenshot to confirm the GUI matches the expected labels and run state; verify no errors appear in the debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- _To be completed during implementation._

---

### 6. Client: Flows dropdown + run payload sourceId

- Task Status: **__in_progress__**
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

1. [x] Review current flows list + run flow:
   - Files to read:
     - `client/src/api/flows.ts`
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/flowsApi.test.ts`
     - `client/src/test/flowsPage.stop.test.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/; Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Checklist (duplicate rules): flow labels use `<name> - [sourceLabel]` and runs include `sourceId` for ingested flows.
2. [x] Update flows API list parsing:
   - Files to edit:
     - `client/src/api/flows.ts`
   - Docs to read: React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Extend the `FlowSummary` type to include optional `sourceId`/`sourceLabel` fields.
     - Parse optional `sourceId`/`sourceLabel` from the flows list response and include them in the returned flow objects.
     - Example type: `type FlowSummary = { name: string; description: string; disabled: boolean; sourceId?: string; sourceLabel?: string };`.
3. [ ] Update dropdown rendering + selection state:
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
   - Compute display labels (`<name>` vs `<name> - [sourceLabel]`).
   - Store `sourceId`/`sourceLabel` with each flow and use a composite selection key so duplicate flow names remain selectable.
   - Sort by display label and keep local flows unlabeled.
   - Ensure ingested flows run without extra confirmation prompts (same trusted flow as local runs).
     - Example display label + key:
       - `const label = sourceLabel ? name + ' - [' + sourceLabel + ']' : name;`
       - `const key = name + '::' + (sourceId ?? 'local');`
4. [x] Update run payload support in flows API:
   - Files to edit:
     - `client/src/api/flows.ts`
   - Docs to read: React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Implementation details:
     - Accept optional `sourceId` in `runFlow` params and include it in the payload when provided.
     - Example payload: `{ sourceId: '/data/repo' }` (omit for local runs).
5. [ ] Update run action to pass `sourceId`:
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Docs to read: MUI Select docs (MUI MCP `/mui/material@6.4.12`, `components/selects.md`): https://llms.mui.com/material-ui/6.4.12/components/selects.md; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface
   - Implementation details:
   - When the selected flow has a `sourceId`, include it in the run payload; omit `sourceId` for local flows.
   - Example: selected `{ name: 'release', sourceId: '/data/repo' }` => payload includes `sourceId`.
   - Add log line (client logger) before firing the run request: message `DEV-0000034:T6:flows.run_payload` with context `{ flowName, sourceId: selected.sourceId ?? 'local' }`.
6. [x] Client unit test (flows list UI) — `client/src/test/flowsPage.stop.test.tsx`: duplicate flow names from different sources render distinct labels; purpose: confirm display label + sorting behavior.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: dropdown shows `release - [Repo A]` and `release - [Repo B]` as separate options.
7. [x] Client unit test (flows run) — `client/src/test/flowsPage.stop.test.tsx`: ingested flow run sends the correct `sourceId` payload; purpose: verify ingest run wiring.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: selecting `release - [Repo A]` sends `{ sourceId: '/data/repo-a' }`.
8. [x] Client unit test (flows run) — `client/src/test/flowsPage.stop.test.tsx`: local flow run omits `sourceId` in payload; purpose: keep local run behavior unchanged.
   - Docs to read: React Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/; React state + hooks (Context7 `/websites/react_dev`): /websites/react_dev; ESLint CLI docs: https://eslint.org/docs/latest/use/command-line-interface; Prettier CLI docs: https://prettier.io/docs/cli/
   - Example expectation: selecting local `release` sends payload without `sourceId`.
9. [ ] Update documentation — `design.md` (UI behavior summary, plus Mermaid diagram updates where applicable).
   - Document: `design.md`.
   - Location: repo root `design.md`.
   - Description: Describe flow dropdown label/sort behavior and update any related Mermaid UI/flow diagrams.
   - Include (duplicate rules): display label format `<name> - [sourceLabel]`, local flows unlabeled, sort by label.
   - Purpose: keep UI/architecture references aligned with new ingested flow UX.
   - Docs to read: Markdown Guide: https://www.markdownguide.org/basic-syntax/
10. [ ] Update documentation — `README.md`.
   - Document: `README.md`.
   - Location: repo root `README.md`.
   - Description: Mention UI behavior changes if README documents flow execution workflows.
   - Include (duplicate rules): UI uses `sourceId` when running ingested flows.
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
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open http://host.docker.internal:5001/flows, verify duplicate flow names remain selectable with `name - [Repo]` labels, run an ingested flow (confirm no extra confirmation prompt appears); then open http://host.docker.internal:5001/logs and confirm `DEV-0000034:T6:flows.run_payload` appears with `{ flowName, sourceId }`; capture a screenshot of the Flows dropdown + run confirmation and store it in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped by `docker-compose.local.yml`) as `0000034-6-flows-ingested-run.png`, then review the screenshot to confirm the GUI matches the expected labels and run state; verify no errors appear in the debug console.
9. [ ] `npm run compose:down`

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
- React docs (hooks + effects): Context7 `/websites/react_dev`
- Jest docs (Context7 `/jestjs/jest`): /jestjs/jest
- Jest getting started docs (CLI + config): https://jestjs.io/docs/getting-started
- Cucumber guides (BDD workflow): https://cucumber.io/docs/guides/
- npm run-script docs (workspace script execution): https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Markdown Guide (doc formatting): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Documentation update — `README.md`:
   - Document: `README.md`.
   - Location: repo root `README.md`.
   - Description: Capture any new commands or API usage notes introduced by this story.
   - Purpose: keep user-facing setup/run guidance current before final verification.
2. [ ] Documentation update — `design.md`:
   - Document: `design.md`.
   - Location: repo root `design.md`.
   - Description: Capture architecture updates and refresh Mermaid diagrams added/updated in this story.
   - Purpose: ensure design reference is current before final verification.
3. [ ] After all file adds/removes are complete, update `projectStructure.md`:
   - Document: `projectStructure.md`.
   - Location: repo root `projectStructure.md`.
   - Description: Record any added/removed files or confirm no change.
   - Purpose: keep repository map accurate for final handoff.
   - Added files: none.
   - Removed files: none.
4. [ ] Add log line for final verification:
   - Files to edit:
     - `client/src/pages/LogsPage.tsx`
   - Description: add a one-time log on page mount with message `DEV-0000034:T7:logs_page_viewed` and context `{ route: '/logs' }` using the existing `createLogger('client')` instance.
   - Purpose: provide a verifiable log entry for the final manual Playwright check.
5. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m npm run e2e` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open http://host.docker.internal:5001, verify Agents + Flows pages show ingested labels and runs work; open http://host.docker.internal:5001/logs and confirm `DEV-0000034:T7:logs_page_viewed` appears after visiting the logs page; confirm no errors appear in the debug console; capture screenshots for all GUI acceptance criteria (Agents labels, command run, Flows labels, flow run, Logs filters) and store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped by `docker-compose.local.yml`) named `<plan>-7-<name>`, then review those screenshots to confirm the GUI matches each acceptance criterion.
9. [ ] `npm run compose:down`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here
