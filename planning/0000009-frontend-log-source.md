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

#### Documentation Locations (external)

- React hooks reference (useRef/useEffect/useCallback) – needed to reason about the chat hook changes: https://react.dev/reference/react
- MDN Fetch streaming basics – relevant because log transport batches use fetch: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- TypeScript handbook (narrowing & structural typing) – to ensure the updated log payload/contexts stay type-safe: https://www.typescriptlang.org/docs/handbook/2/narrowing.html

#### Subtasks

1. [ ] Audit current logger creation in `client/src/hooks/useChatStream.ts`; locate the `createLogger('client-chat')` instantiation and plan its replacement.
2. [ ] Change that call to `createLogger('client')` and attach chat tagging in the log payload (e.g., spread `context` with `{ channel: 'client-chat', ...context }` before `sendLogs`), so entries validate while retaining chat identification.
3. [ ] Test (unit/RTL): `client/src/test/chatPage.stream.test.tsx` — assert a logged tool event now has `source: 'client'` and `context.channel === 'client-chat'` (mock/spy `sendLogs`). Purpose: ensure emitted log shape matches backend schema with chat tag preserved.
4. [ ] Test (unit/RTL): If a mock logger helper exists in `client/src/test/__mocks__/`, update/extend it to capture the new channel tag and validate source. Purpose: keep shared mocks aligned with logging change.
5. [ ] Documentation: Update README logging section to state chat tool events use source `client` with channel tag `client-chat`.
6. [ ] Documentation: Update design.md observability/logging notes with the same source + channel tag detail.
7. [ ] Documentation: Update projectStructure.md if any new test/helper files were added or existing ones renamed.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` after the code/test changes.

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

Prepare to inject a provided system-context text block once it’s supplied. Identify the target location now so we can paste it in immediately when given (no semantics change until the text arrives).

#### Documentation Locations (external)

- React context / module exports (for placing the provided text in a shared constant): https://react.dev/reference/react/createContext
- TypeScript modules/exporting constants (for sharing the context block safely): https://www.typescriptlang.org/docs/handbook/modules.html

#### Subtasks

1. [ ] When the text is provided, place it in the agreed file (proposed: a new constant in `client/src/constants/systemContext.ts` or an existing config file if already used). Document the exact target in the plan once confirmed.
2. [ ] Wire the consumer (if any) to read from that constant without changing existing behavior until the content is present. Note the injection point (component/hook) in this plan.
3. [ ] Test (unit/RTL) [file TBD once consumer known]: verify the system context constant is loaded/used/rendered as intended. Purpose: ensure the injected text is actually consumed.
4. [ ] Documentation: Update README to note where the system context constant lives and how it’s applied.
5. [ ] Documentation: Update design.md with a brief note on the system context location/usage once set.

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

#### Documentation Locations (external)

- MUI component styling (sx / theme shape) – use MUI MCP `@mui/material@7.2.0` docs (required for Bubble styling): https://llms.mui.com/material-ui/7.2.0/llms.txt
- React styling patterns (to keep styles consistent with React best practices): https://react.dev/learn/adding-styles

#### Subtasks

1. [ ] Pick radii (e.g., 12–16px) and apply to chat bubbles in `client/src/pages/ChatPage.tsx` (or shared styles in `client/src/index.css`/styled components). Ensure both user and assistant bubbles use the new corners.
2. [ ] Verify layout for status chips, tool blocks, and citations remains aligned; adjust padding/margins in the same file if needed.
3. [ ] Test (RTL): `client/src/test/chatPage.stream.test.tsx` (or new style-focused test) — assert chat bubbles have the new rounded radius (class/style) for both user and assistant. Purpose: prevent regressions in bubble shape.
4. [ ] Documentation: Update README to mention rounded chat bubbles and note the chosen radius token.
5. [ ] Documentation: Update design.md chat UI section to reflect rounded bubble styling.
6. [ ] Documentation: Update projectStructure.md if new style/test helpers are added for the bubble change.

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
