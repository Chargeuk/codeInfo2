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

- Task Status: **done**
- Git Commits: a2a0b6a

#### Overview

Switch chat logging to use the allowed `client` source while preserving chat-specific tagging so tool telemetry still identifies chat flows.

#### Documentation Locations (external)

- React hooks reference (useRef/useEffect/useCallback) – needed to reason about the chat hook changes: https://react.dev/reference/react
- MDN Fetch streaming basics – relevant because log transport batches use fetch: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- TypeScript handbook (narrowing & structural typing) – to ensure the updated log payload/contexts stay type-safe: https://www.typescriptlang.org/docs/handbook/2/narrowing.html

#### Subtasks

1. [x] Audit current logger creation in `client/src/hooks/useChatStream.ts` (function `useChatStream`, near the top-level logger definition). Capture the exact snippet that currently reads `const log = createLogger('client-chat');` to show before/after in notes.
2. [x] Replace that line with `const log = createLogger('client');` and wrap the logger call so every emitted entry merges `{ channel: 'client-chat', ...context }` before `sendLogs` (e.g., inside `logToolEvent` helper). Include the concrete code diff in the task notes:
   ```ts
   const log = createLogger('client');
   const logWithChannel = (level, message, context = {}) =>
     log(level, message, { channel: 'client-chat', ...context });
   ```
   Then swap existing `log(...)` calls in this hook to `logWithChannel(...)`.
3. [x] Test (unit/RTL) in `client/src/test/chatPage.stream.test.tsx`: mock/spy `sendLogs` (existing jest mock) and assert the first logged tool event equals `{ source: 'client', context: expect.objectContaining({ channel: 'client-chat' }) }`. Add a concrete expectation snippet in the test: `expect(payload.source).toBe('client'); expect(payload.context?.channel).toBe('client-chat');`.
4. [x] If present, update the shared logger mock in `client/src/test/__mocks__/logger.ts` (or similar) to capture `channel` and default `source: 'client'` so other tests stay aligned; add a small assertion to that mock’s test to verify the channel is preserved.
5. [x] Documentation: README `Logging` section (existing heading) — add a bullet under “Client logging” noting chat tool events now use `source: client` with `context.channel = "client-chat"` for filtering.
6. [x] Documentation: design.md `Logging` / observability section — add the same source/tag detail and a one-liner on why the tag is used for chat telemetry.
7. [x] Documentation: projectStructure.md — if new/renamed test helper files are added, list them; otherwise note the `useChatStream` update in the comments for that file.
8. [x] Lint/format: run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues (record commands/outcomes in implementation notes).

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run compose:build`
6. [x] `npm run compose:up`
7. [x] `npm run compose:down`
8. [x] `npm run e2e`

#### Implementation notes

- Subtask 1: Confirmed `useChatStream` initializes `const logger = useRef(createLogger('client-chat')).current;` and uses `logger('info', 'chat tool event', { ... })` for tool events.
- Subtask 2: Swapped to `const log = useRef(createLogger('client')).current` with a `logWithChannel` helper that merges `{ channel: 'client-chat', ...context }`, and replaced the tool-event logger call with `logWithChannel('info', ...)`; send callback deps updated accordingly.
- Subtask 3: Added `sendLogs` jest mock queue in `chatPage.stream.test.tsx` and asserted the first tool log carries `source: 'client'` and `context.channel = 'client-chat'`.
- Subtask 4: No shared `__mocks__/logger.ts` exists; noted as not applicable after confirming mocks, so no extra mock file changes were required.
- Subtask 5: README logging section now documents chat tool logs using `source: client` with `context.channel = "client-chat"`.
- Subtask 6: design.md logging section mentions the channel tag rationale for chat telemetry and schema alignment.
- Subtask 7: projectStructure entry for `useChatStream.ts` notes the client source + chat channel tag logging.
- Subtask 8: Ran `npm run lint --workspaces` (clean) and `npm run format:check --workspaces`; formatted `client/src/hooks/useChatStream.ts` then rechecked successfully.
- Test 1: `npm run build --workspace server` succeeded.
- Test 2: `npm run build --workspace client` succeeded (vite build, noted large chunk warning unchanged).
- Test 3: `npm run test --workspace server` passed (unit + Cucumber; expected Chroma default-embed warnings/deprecation notices only).
- Test 4: `npm run test --workspace client` passed after mocking `logging/transport` via `jest.unstable_mockModule`; console act warnings remain from existing suites.
- Test 5: `npm run compose:build` succeeded (Docker images built; npm deprecated/vulnerability warnings noted from base dependencies, chunk size warning persists).
- Test 6: `npm run compose:up` brought stack up (client/server/chroma/otel/zipkin all started, server reported healthy).
- Test 7: `npm run compose:down` stopped and removed stack containers/network cleanly.
- Test 8: `npm run e2e` succeeded (compose:e2e build/up/test/down; all 21 Playwright specs passed; chunk size warning noted, no residual containers).

---

### 2. System context update hook

- status: __in_progress__
- Git Commits: 18cad00, f3e748e

#### Overview

Prepare to inject a provided system-context text block once it’s supplied. Identify the target location now so we can paste it in immediately when given (no semantics change until the text arrives).

#### Documentation Locations (external)

- React context / module exports (for placing the provided text in a shared constant): https://react.dev/reference/react/createContext
- TypeScript modules/exporting constants (for sharing the context block safely): https://www.typescriptlang.org/docs/handbook/modules.html

#### Subtasks

1. [x] Create/stub `client/src/constants/systemContext.ts` now with `export const SYSTEM_CONTEXT = '';` so the target is fixed. Document this exact path here.
2. [ ] When text is provided, replace the empty string with the supplied content; no other behaviour change. Record the exact commit hash in the plan.
3. [x] Identify the consumer: note which component/hook will read the constant (e.g., `client/src/hooks/useChatStream.ts` or `client/src/pages/ChatPage.tsx`) and add a TODO comment there pointing to the constant until content arrives.
4. [x] Test (unit/RTL) for the chosen consumer: add an assertion that the constant is read (e.g., render path picks up `SYSTEM_CONTEXT` value). Purpose: ensure injected text is actually used.
5. [x] Documentation: README “Chat” (or “Logging/Chat tooling”) subsection — add a sentence stating system context is stored in `client/src/constants/systemContext.ts` and injected when provided.
6. [x] Documentation: design.md — add a short note in the chat/agent section about the system context location and consumer.
7. [x] Lint/format: run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run compose:build`
6. [x] `npm run compose:up`
7. [x] `npm run compose:down`
8. [x] `npm run e2e`

#### Implementation notes

- Added `client/src/constants/systemContext.ts` as the stub home for the system prompt; waiting for real text so subtask 2 stays open.
- Hook `useChatStream` now trims `SYSTEM_CONTEXT` and prepends a system message when non-empty; added TODO comment marking it as the consumer.
- New RTL coverage in `client/src/test/chatPage.stream.test.tsx` verifies chat requests include the system prompt (global constant mocked for tests) without changing runtime behaviour when empty.
- Docs: README chat section documents the constant path/behaviour; design.md notes `useChatStream` prepends the prompt when present; projectStructure lists the new constants folder/file.
- Ran lint + format for all workspaces; reran after test edits.
- Testing completed per checklist: server build/tests, client build/tests (fixed system-context test to avoid isolate hook issues), compose build/up/down, and full e2e suite.

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

1. [ ] Use a single radius token `14px` for both user and assistant bubbles. Apply in `client/src/pages/ChatPage.tsx` where the bubble `Box`/`Paper` `sx` is defined (and any shared styled component). Include the exact `sx` change in notes:
   ```ts
   borderRadius: '14px',
   ```
2. [ ] Verify layout for status chips, tool blocks, and citations remains aligned; adjust padding/margins in the same file if needed (note any tweaks with file/line references).
3. [ ] Test (RTL): in `client/src/test/chatPage.stream.test.tsx` (or a new `chatPage.bubble-style.test.tsx` if clearer), assert rendered bubbles have `border-radius: 14px` for both user and assistant selectors (query by test id or role used today).
4. [ ] Documentation: README “Chat” section — add a bullet noting bubbles use 14px rounding to align with the current visual language.
5. [ ] Documentation: design.md chat UI section — update to mention 14px bubble radius and that citations/status chips remain aligned.
6. [ ] Documentation: projectStructure.md — update the `client/src/pages/ChatPage.tsx` comment if needed to mention bubble styling and add any new test file path.
7. [ ] Lint/format: run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`
8. [ ] `npm run e2e`

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
2. [ ] Prepare PR summary text covering scope, tests, and risk.
3. [ ] Lint/format: run `npm run lint --workspaces` and `npm run format:check --workspaces`; fix issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`
8. [ ] `npm run e2e`

#### Implementation notes

- to_be_filled

---
