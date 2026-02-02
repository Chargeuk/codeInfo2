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
