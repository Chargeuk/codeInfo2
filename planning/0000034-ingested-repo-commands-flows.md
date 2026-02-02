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
- If the ingest root display name is missing or empty, the fallback label is the ingest root folder name.
- Imported commands and flows are treated as trusted and can be executed without extra confirmation.
- Local (CodeInfo2) commands and flows continue to appear, remain functional, and remain unlabeled.
- MCP list/run tools surface ingested commands the same way as the UI (flows MCP parity is out of scope).
- REST list responses include `sourceId` and `sourceLabel` for ingested items, while local items omit both fields.
- REST run requests accept an optional `sourceId` for ingested commands/flows to disambiguate duplicates.
- Server path resolution for ingested items uses Node `path.resolve` + `path.relative` checks to ensure the resolved command/flow file stays within the ingest root container path.

---

## Out Of Scope

- Changing command or flow JSON schemas.
- Editing or validating commands/flows inside ingested repos beyond existing validation.
- UI redesigns beyond list labels and sorting.
- Changes to ingest workflows or repository ingestion behavior.
- Adding new MCP tools for flows (list/run) or changing MCP flow behavior.

---

## Questions

_None. All questions resolved._

---

## Rough Implementation Outline

- Server ingest roots: reuse `listIngestedRepositories` in `server/src/lmstudio/toolService.ts` to obtain ingest root names (with fallback to basename) and container paths; treat the display name as the `sourceLabel` for UI/MCP and the container path as `sourceId`.
- Agent commands discovery: extend `listAgentCommands` in `server/src/agents/service.ts` to merge local commands with any found under `<ingestRoot>/codex_agents/<agentName>/commands`, only when the agent exists locally; include `sourceId` (ingest root container path) + `sourceLabel` for ingested items and keep local items unlabeled.
- Agent command execution: update the command run path (e.g., `startAgentCommand`/`commandsRunner`) and REST/MCP inputs to accept an optional `sourceId`, resolve the correct `commands` directory from the ingest roots list (container path), and keep validation that paths stay inside the ingest root using `path.resolve` + `path.relative` checks.
- Flow discovery: update `server/src/flows/discovery.ts` (and the `/flows` route) to scan the local flows directory plus each `<ingestRoot>/flows` folder; return `sourceId` (ingest root container path) + `sourceLabel` for ingested flows, keep locals unlabeled, and sort by display label.
- Flow execution: update `server/src/flows/service.ts` and `server/src/routes/flowsRun.ts` to accept an optional `sourceId` (ingest root container path), resolve the matching flow file path for that source, and keep existing hot-reload/validation behavior with `path.resolve` + `path.relative` checks.
- MCP parity: update `server/src/mcpAgents/tools.ts` list/run command payloads to include source metadata and accept `sourceId`; flows MCP tools are out of scope.
- Client updates: adjust `client/src/api/agents.ts` and `client/src/pages/AgentsPage.tsx` to handle `sourceId/sourceLabel`, render labels as `<name> - [Repo]`, keep locals unlabeled, and pass `sourceId` on run; mirror the same approach in `client/src/api/flows.ts` and `client/src/pages/FlowsPage.tsx`.
- Validation/tests: update existing REST/MCP and UI tests that assert command/flow lists to account for source metadata, label formatting, and duplicate name handling (sorted by `name`).

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
