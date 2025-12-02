# Story 0000009 – Frontend log source alignment

## Description

Backend log ingestion only allows sources `client` or `server`, but the chat hook emits `source: "client-chat"`, causing valid telemetry to be rejected with `{"error":"invalid log entry"}`. We need to align frontend log sources with the schema while preserving the ability to distinguish chat tool events for observability.

## Acceptance Criteria

- Frontend chat logging uses an allowed source value so `/logs` accepts the entries.
- Chat tool events remain distinguishable (e.g., via context/tags) without breaking validation.
- Tests cover the new logging behavior (unit/client) and ensure no schema rejection.
- Documentation reflects the logging source change and how chat tool logs are tagged.

## Out Of Scope

- Changing server log schema or adding new source enums.
- Batch log transport changes beyond what is needed to pass validation.

## Questions

- Should chat-specific tagging live in `context` or a `tags` array? (Proposed: `context.channel = "client-chat"`).
- Do we need to expose chat log filters in the UI now or later? (Proposed: keep existing UI; no new filters.)

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

### 1. Align chat logger source with backend schema

- Task Status: **to_do**
- Git Commits: to_do

#### Overview

Switch chat logging to use the allowed `client` source while preserving chat-specific tagging so tool telemetry still identifies chat flows.

#### Documentation Locations

- Logging DTOs: `common/src/logging.ts`
- Client logger factory: `client/src/logging/logger.ts`
- Chat stream logging: `client/src/hooks/useChatStream.ts`

#### Subtasks

1. [ ] Audit current logger creation in `useChatStream.ts`; confirm `createLogger('client-chat')` usage and planned replacement.
2. [ ] Update chat logger to use `source: "client"` and add a contextual tag (e.g., `context.channel = "client-chat"` or a `tags` entry) so chat tool events stay distinguishable.
3. [ ] Adjust any related tests/mocks to expect the new source/tag (add a focused unit/RTL assertion).
4. [ ] Update docs (README/design) to note chat logs now use `client` source with `channel: client-chat` tag.
5. [ ] Run lint/format after code changes.

#### Testing

1. [ ] `npm run test --workspace client`
2. [ ] `npm run lint --workspaces`
3. [ ] `npm run format:check --workspaces`

#### Implementation notes

- to_be_filled

---

### 2. System context update hook

- status: **to_do**
- Git Commits: **to_do**

#### Overview

Add a task placeholder to update the system context to a specific block of text that will be provided during implementation. No content change until the text is supplied; ensure wiring is ready to accept and apply it once given.

#### Documentation Locations

- TBD (will depend on where system context lives once text is provided)

#### Subtasks

1. [ ] Capture the provided system context block (to be supplied) and confirm target file/structure.
2. [ ] Apply the context update to the agreed location (likely client config or shared constant) without altering other semantics.
3. [ ] Add/adjust tests or snapshots if the context impacts rendering or logic.
4. [ ] Update documentation to point to the new context location and usage.

#### Testing

1. [ ] `npm run test --workspace client` (or narrower affected suite once location is known)

#### Implementation notes

- to_be_filled

---

### 3. Round chat bubble corners

- status: **to_do**
- Git Commits: **to_do**

#### Overview

Update chat bubble styling so both user and assistant messages have rounded corners consistent with the design language.

#### Documentation Locations

- Chat UI: `client/src/pages/ChatPage.tsx`
- Shared styles: `client/src/index.css` or component-level styles
- MUI docs: via MUI MCP tool (theme/shape/styling)

#### Subtasks

1. [ ] Decide the radius values and apply them to chat bubbles (user and assistant) while preserving current spacing/width constraints.
2. [ ] Ensure status chips, tool blocks, and citations still align visually with rounded bubbles.
3. [ ] Update relevant tests/snapshots if they assert class names or inline styles.
4. [ ] Document the visual change in README/design and note any new tokens/variables used.

#### Testing

1. [ ] `npm run test --workspace client`

#### Implementation notes

- to_be_filled

---

### 4. Final Task – verification & docs sweep

- status: **to_do**
- Git Commits: **to_do**

#### Overview

Ensure builds/tests clean, docs accurate, and summarize changes for the PR comment.

#### Documentation Locations

- README.md
- design.md
- projectStructure.md

#### Subtasks

1. [ ] Confirm README/design/projectStructure reflect the log source/tag behavior.
2. [ ] Run `npm run build --workspaces`.
3. [ ] Run `npm run test --workspace client` (sanity).
4. [ ] Prepare PR summary text covering scope, tests, and risk.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run build --workspace server`
3. [ ] `npm run test --workspace client`

#### Implementation notes

- to_be_filled

---
