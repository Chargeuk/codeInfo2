# Story 0000007 – Ingest visibility & AI output clarity

## Description
Improve observability during ingest and chat so users see which files are being processed and how tool calls drive answers. While ingest runs, expose per-file progress instead of only chunk counts so long runs feel transparent and debuggable. During chat, surface tool invocation moments and show which files/vector results informed the reply. Finally, format assistant responses as markdown (with mermaid support) to make structured answers and diagrams easy to consume.

Also support OpenAI/GPT-OSS "Harmony" channel-tagged output (e.g., `<|channel|>analysis<|message|>...<|end|><|start|>assistant<|channel|>final<|message|>` — see https://cookbook.openai.com/articles/openai-harmony), treating `analysis` as hidden/collapsible reasoning (like `<think>`) and `final` as the visible reply, even while streaming. We will implement this parsing ourselves (no external Harmony renderer dependency) alongside our existing think/tool handling.

## Acceptance Criteria
- Ingest UI and API expose the current file path being processed (in addition to chunk counts) and update it live during a run.
- Chat transcript shows when LM Studio tools are invoked, including the tool name and timing, without disrupting the conversation flow, via an inline spinner inside the active assistant bubble that stops when the call finishes.
- Completed tool calls collapse into an inline expandable section that reveals the tool name, result payload, and errors (if any); for VectorSearch this includes the list of chunks and the list of files/paths returned.
- VectorSearch results displayed in chat include the repo and relative file paths used for grounding; users can see which files informed the answer.
- Assistant messages render as markdown, preserving code blocks and allowing mermaid diagrams to display correctly in the client.
- `<think>` content stays collapsed as soon as the opening tag is seen, even before the closing tag arrives; while streaming, show a thinking icon + spinner on the collapsible header, and allow users to open it to watch the think text stream.
- Harmony/OpenAI channel-tagged outputs (e.g., `<|channel|>analysis<|message|>...<|end|><|start|>assistant<|channel|>final<|message|>`) are parsed and rendered with the analysis content collapsed like think blocks and the final content shown as the visible reply.
- Behaviour is documented in README/design with any new env flags or UI states; existing tests are expanded or added to cover the new visibility and markdown flows.

### Harmony + Markdown coexistence
- Parsing then rendering: detect think/Harmony channels first to split visible vs hidden; markdown-render only the visible “final” text, and optionally the hidden text when expanded.
- Tool metadata stays structured (not markdown-rendered) to avoid mangling paths/ids; citations remain separate.
- Streaming: accumulate analysis in the hidden buffer; start streaming/rendering markdown once `final` begins, re-render incrementally.
- Security: sanitize markdown input before rendering; keep code fences/mermaid blocks intact.

## Out Of Scope
- Changing ingest chunking/tokenization behaviour or performance tuning beyond exposing progress.
- Adding new ingestion data sources or authentication flows.
- Full redesign of the chat UI layout; changes are limited to visibility/formatting additions.
- Server-side RAG parameter tuning (topK/temperature) beyond existing defaults.

## Questions (all resolved)
- Should file-progress reporting include percentage/ETA or just the current file name/path? **Decision:** include percentage, current index/total, ETA, and current file path.
- How should tool-call visibility appear in the chat UI (inline status line, chips, or a collapsible log)? **Decision:** inline spinner inside the active assistant bubble; on completion it collapses into an expandable block with details.
- Do we need a toggle to disable tool-call visibility for minimal mode? **Decision:** no toggle; tool details stay in collapsible blocks users can leave closed.
- Are there security/privacy constraints on showing full host paths in chat, or should we truncate to repo/relPath only? **Decision:** no constraints; show full host paths (local dev only).
- For mermaid rendering, should we support dark/light themes or rely on MUI theme defaults? **Decision:** rely on MUI theme defaults (light/dark aware) with no extra toggle.

# Implementation Plan

## Instructions
(This section is the standard process to follow once tasks are created.)

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

### 1. Ingest progress telemetry

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Expose per-file ingest progress: show current file path, index/total, percentage, and ETA in the ingest status API and UI so long runs are transparent and debuggable.

#### Documentation Locations
- Server ingest orchestration: `server/src/ingest/ingestJob.ts`, `server/src/routes/ingestStart.ts`, `server/src/routes/ingestCancel.ts`
- Client ingest UI: `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/hooks/useIngestStatus.ts`
- Ingest Cucumber coverage: `server/src/test/features/ingest-*.feature`
- Ingest e2e: `e2e/ingest.spec.ts`

#### Subtasks
1. [ ] Add server status fields for `currentFile`, `fileIndex`, `fileTotal`, `percent`, and `etaMs`; plumb through ingest job tracking and `/ingest/status/:runId` responses.
2. [ ] Update ingest polling hook and ActiveRunCard to display file path, index/total, percentage, and ETA with live updates and sane fallbacks.
3. [ ] Server unit tests: new status fields surface in ingest job/status handler (`server/src/ingest/ingestJob.ts`, related route tests).
4. [ ] Server Cucumber: feature+steps asserting `/ingest/status/:runId` returns file path/index/total/percent/eta.
5. [ ] Client RTL: ActiveRunCard displays file path, index/total, percent, ETA with live polling (`client/src/components/ingest/ActiveRunCard.tsx`).
6. [ ] E2E: ingest progress assertion in `e2e/ingest.spec.ts` (or new spec) showing file path and percent update.
7. [ ] Update README.md with the new ingest status fields and UI behaviour.
8. [ ] Update design.md with ingest progress flow/state notes.
9. [ ] Update projectStructure.md if any files are added/renamed.
10. [ ] Run full linting (`npm run lint --workspaces`).

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] Clean docker build (`npm run compose:build`)
4. [ ] Start docker compose (`npm run compose:up`)
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`

#### Implementation notes
-

---

### 2. Chat tool-call visibility

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Render inline tool-call activity inside assistant bubbles with a spinner and tool name during execution, collapsing to an expandable detail block (showing results/errors, chunks, and file paths) once complete.

#### Documentation Locations
- Chat stream handling: `client/src/hooks/useChatStream.ts`
- Chat UI: `client/src/pages/ChatPage.tsx`
- Server tool events: `server/src/routes/chat.ts`, `server/src/lmstudio/tools.ts`, `server/src/lmstudio/toolService.ts`
- Chat RTL tests: `client/src/test/chatPage.*.test.tsx`
- Chat SSE Cucumber/integration: `server/src/test/features/chat_*`, `server/src/test/integration/chat-tools-wire.test.ts`

#### Subtasks
1. [ ] Extend SSE/tool parsing to track active tool calls (id, name, state) and expose progress to the UI.
2. [ ] Add UI elements: inline spinner + tool name while running; collapsible section with result/error details (chunks + file paths for VectorSearch) after completion.
3. [ ] Client RTL: spinner/collapse states and vector file list rendering in chat bubble (`client/src/pages/ChatPage.tsx`).
4. [ ] Server unit/integration: tool event payloads reach SSE stream (e.g., `server/src/test/integration/chat-tools-wire.test.ts`) and include needed fields.
5. [ ] Server Cucumber (if applicable): feature to assert tool-request/result visibility fields in SSE.
6. [ ] E2E: chat-tools visibility flow shows spinner then collapsible result with file paths.
7. [ ] Update README.md with chat tool-call visibility behaviour.
8. [ ] Update design.md with tool-call UI/flow.
9. [ ] Update projectStructure.md for any new components/tests.
10. [ ] Run full linting (`npm run lint --workspaces`).

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] Clean docker build (`npm run compose:build`)
4. [ ] Start docker compose (`npm run compose:up`)
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`

#### Implementation notes
-

---

### 3. Reasoning collapse (think + Harmony)

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Handle streaming reasoning for `<think>` and Harmony channel tags by collapsing analysis immediately, showing a spinner-enabled header, and keeping final content separate for display.

#### Documentation Locations
- Chat stream parsing: `client/src/hooks/useChatStream.ts`
- Chat UI components for think blocks: `client/src/pages/ChatPage.tsx`
- Harmony format reference: https://cookbook.openai.com/articles/openai-harmony
- Chat RTL tests: `client/src/test/chatPage.*.test.tsx`

#### Subtasks
1. [ ] Implement streaming parser that detects `<think>` early and Harmony analysis/final channels, buffering analysis hidden and emitting final to visible content.
2. [ ] Update UI to collapse analysis/think immediately with thinking icon + spinner, allow expansion during streaming.
3. [ ] Client RTL: streaming think/Harmony collapse UX (collapsed on open, spinner header, expandable during stream).
4. [ ] Client unit: parser logic for think/Harmony channels (visible vs hidden splitting).
5. [ ] Server unit/integration (if shared parser/server-side handling is added) for Harmony/think separation.
6. [ ] E2E: chat streaming scenario with Harmony-style output verifying collapse/expand behaviour.
7. [ ] Update README.md for reasoning handling.
8. [ ] Update design.md with reasoning/rendering flow and streaming states.
9. [ ] Update projectStructure.md if new parser files are added.
10. [ ] Run full linting (`npm run lint --workspaces`).

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] Clean docker build (`npm run compose:build`)
4. [ ] Start docker compose (`npm run compose:up`)
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`

#### Implementation notes
-

---

### 4. Markdown rendering

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Render assistant visible content as markdown (excluding mermaid) with safe streaming re-renders while keeping tool metadata structured.

#### Documentation Locations
- Markdown renderer usage in client (where configured)
- Chat UI render paths: `client/src/pages/ChatPage.tsx`
- Chat RTL tests: `client/src/test/chatPage.*.test.tsx`

#### Subtasks
1. [ ] Integrate/confirm markdown renderer for assistant visible content (final channel/visible text), including streaming re-render support and sanitization.
2. [ ] Keep tool details/citations structured (not markdown-rendered); ensure code fences render correctly.
3. [ ] Client RTL: markdown rendering of chat replies with code fences; snapshot/DOM assertions for code blocks.
4. [ ] Server unit (only if server processes markdown) to ensure no regressions in API payload formatting.
5. [ ] Update README.md to describe markdown behaviour and safety.
6. [ ] Update design.md to reflect markdown rendering paths and sanitization.
7. [ ] Update projectStructure.md if renderer utilities change.
8. [ ] Run full linting (`npm run lint --workspaces`).

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] Clean docker build (`npm run compose:build`)
4. [ ] Start docker compose (`npm run compose:up`)
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`

#### Implementation notes
-

---

### 5. Mermaid rendering

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview
Enable mermaid diagram rendering inside assistant replies (markdown code fences with `mermaid` language), ensuring safe hydration and theme compatibility.

#### Documentation Locations
- Mermaid renderer/integration points in client
- Chat UI render paths: `client/src/pages/ChatPage.tsx`
- Chat RTL/e2e tests for rendering
- Mermaid docs: Context7 `/mermaid-js/mermaid`

#### Subtasks
1. [ ] Wire mermaid rendering for ```mermaid``` fences in assistant replies, with streaming-friendly updates.
2. [ ] Ensure theme-aware styling (respect MUI theme) and safe DOM injection/sanitization.
3. [ ] Client RTL: mermaid block render in chat reply with XSS/sanitization assertions.
4. [ ] E2E: mermaid rendering scenario to confirm diagrams appear and no regressions.
5. [ ] Update README.md for mermaid support and usage.
6. [ ] Update design.md with mermaid rendering flow/theme notes.
7. [ ] Update projectStructure.md if renderer utilities change.
8. [ ] Run full linting (`npm run lint --workspaces`).

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] Clean docker build (`npm run compose:build`)
4. [ ] Start docker compose (`npm run compose:up`)
5. [ ] `npm run test --workspace server`
6. [ ] `npm run test --workspace client`
7. [ ] `npm run e2e`

#### Implementation notes
-

---

### 6. Final Task – Validate story completion

- status: **to_do**
- Git Commits: **to_do**

#### Overview
End-to-end validation against acceptance criteria: ingest progress visibility, tool-call transparency, reasoning collapse, markdown/mermaid rendering. Ensure builds, tests, docs, and screenshots are complete.

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
7. [ ] Add or extend e2e tests as needed to cover the new ingest progress, tool-call visibility, reasoning collapse, markdown, and mermaid behaviour; commit screenshots per instructions.
8. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.

#### Testing
1. [ ] run the client jest tests
2. [ ] run the server cucumber tests
3. [ ] restart the docker environment
4. [ ] run the e2e tests
5. [ ] use the playwright mcp tool to ensure manually check the application, saving screenshots to ./test-results/screenshots/ - Each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot

#### Implementation notes
- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here

---
