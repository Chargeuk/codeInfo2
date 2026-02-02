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

This story adds discovery of commands and flows from ingested repositories. If an ingested repo has a `codex_agents/<agentName>/commands` folder and that agent also exists locally, those commands should appear in the agent command dropdown. If an ingested repo has a `flows/` folder, those flows should appear in the flows dropdown. The UI will show the ingest root display name in brackets for each imported item (for example, `build - [My Repo]`) so duplicates are easy to distinguish.

---

## Acceptance Criteria

- Commands are discovered from each ingested repo at `<ingestRoot>/codex_agents/<agentName>/commands` when the matching agent exists locally.
- Flows are discovered from each ingested repo at `<ingestRoot>/flows`.
- Duplicate command or flow names are allowed across repos.
- Dropdown lists are sorted alphabetically by command/flow name.
- Imported items display the ingest root display name in brackets, formatted as `<name> - [Repo Name]`.
- Imported commands and flows are treated as trusted and can be executed without extra confirmation.
- Local (CodeInfo2) commands and flows continue to appear and remain functional.

---

## Out Of Scope

- Changing command or flow JSON schemas.
- Editing or validating commands/flows inside ingested repos beyond existing validation.
- UI redesigns beyond list labels and sorting.
- Changes to ingest workflows or repository ingestion behavior.

---

## Questions

- Should local (CodeInfo2) commands/flows show a label like `[CodeInfo2]`, or remain unlabeled?
- If an ingest root display name is missing or empty, should we fall back to the folder name?
- Should MCP list/run tools surface ingested commands/flows the same way as the UI?

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
