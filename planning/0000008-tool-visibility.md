# Story 0000008 – Tool visibility detail & parameters

## Description
Enhance chat tool-call visibility so users can understand exactly which tool ran, what was passed in, and what it returned. Closed state should show the tool name and status; expanded state should display tool-specific, human-friendly details plus raw parameters. For ListIngestedRepositories, users need an expandable list of repositories with full metadata per repo. For VectorSearch, users should see an alphabetical list of unique files (with paths), each showing relevance score and chunk count. Errors must be obvious, expandable, and include all available details. Once the client receives tool data, the tool call is considered complete—no lingering spinners.

## Acceptance Criteria
- Tool call stays closed by default; closed view shows tool name and success/failure state once results/errors arrive.
- When opened, show all repository/file entries (no cap); each entry is individually expandable for details.
- All tool calls include an expandable Parameters section (closed by default) listing every parameter passed to the tool.
- ListIngestedRepositories results render as a list of repository names; each name is expandable to show the full returned metadata for that repository.
- VectorSearch results render as an alphabetical list of unique files (including paths); each entry shows relevance score and summed chunk count per file; include total line count when available.
- Tool failures display a clear failed state; expanding shows relevant error details returned by the tool.
- Once the front end receives tool results or errors, the tool call status changes to complete (no active spinner).
- Behavior is covered by unit/RTL/integration/e2e tests and documented in README/design.

## Out Of Scope
- Changing LM Studio tool schemas or server-side scoring logic.
- Altering ingest/vector search business rules beyond presentation.
- Adding new tools or authentication flows.

## Questions
- Do we need to cap the number of repository/file entries shown before collapsing behind “show more”? **Answer:** Keep the tool call closed by default. When expanded, show all repository/file entries with no cap. Each entry is itself expandable for detailed info.
- Should chunk count be summed per file or show per-result list? **Answer:** Sum chunk counts per file. Each file appears once with total chunks (e.g., 3 results for one file → chunk count 3). If available, also surface the file's total line count.
- Should we show host paths in addition to repo/relPath for VectorSearch? (Plan: yes if provided, otherwise relPath only.)

# Implementation Plan

## Instructions
(Standard steps from plan_format.md apply.)

# Tasks

### 1. Data shaping & plumbing

- Task Status: __to_do__
- Git Commits: to_do

#### Overview
Ensure tool payloads (success and error) include needed fields for ListIngestedRepositories and VectorSearch, and expose tool parameters to the client state.

#### Documentation Locations
- Server tool helpers: server/src/lmstudio/toolService.ts, server/src/lmstudio/tools.ts
- Chat route SSE wiring: server/src/routes/chat.ts
- Client chat stream parsing: client/src/hooks/useChatStream.ts
- LM Studio agent docs: https://lmstudio.ai/docs/typescript/agent/act

#### Subtasks
1. [ ] Confirm/extend tool result typing for ListIngestedRepositories and VectorSearch to carry parameters and raw payloads through SSE (`tool-result`) frames.
2. [ ] Ensure errors propagate with structured details (code/message) and mark tool status complete on receipt (no spinner linger).
3. [ ] Add/adjust fixtures and mocks (server test support, client mock SSE) to include parameters and tool payloads.
4. [ ] Update client chat stream state to retain tool parameters and tool-specific payloads for UI use.
5. [ ] Add/extend server unit/integration tests for tool result/error frames including parameters.
6. [ ] List planned tests: server unit/integration (chat tool frames), client hook unit tests.
7. [ ] Docs to update later: README, design, projectStructure.
8. [ ] Run lint/format after code changes.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run build --workspace client`
4. [ ] `npm run test --workspace client`

#### Implementation notes
- (fill during work)

---

### 2. UI rendering: tool summaries & details

- Task Status: __to_do__
- Git Commits: to_do

#### Overview
Render closed state (name + status) and expanded views with per-tool bespoke layouts plus parameters accordion.

#### Documentation Locations
- Chat UI: client/src/pages/ChatPage.tsx
- Markdown/structured render helpers: client/src/components/Markdown.tsx (if reused), tool detail components (to be added if needed)
- Client RTL tests: client/src/test/chatPage.*.test.tsx
- MUI docs: MUI MCP `@mui/material@7.2.0`

#### Subtasks
1. [ ] Closed state (default) shows tool name and success/failure icon once result/error arrives; user opens to view details.
2. [ ] Add expandable Parameters section (closed by default) showing all input params (pretty-printed JSON) for every tool call.
3. [ ] ListIngestedRepositories: render all repo names (no cap); each repo clickable to expand full metadata (hostPath/containerPath/counts/lastIngestAt/lockedModelId/lastError/etc.).
4. [ ] VectorSearch: render all unique files (no cap), aggregated by path, sorted alphabetically; show relevance score, summed chunk count per file, and total line count when available; each file entry expandable for chunk/result details.
5. [ ] Error state: show failed badge; expanded view displays error message/code and raw payload.
6. [ ] Ensure accessibility: keyboard toggle for expansions, sensible aria labels.
7. [ ] Add/extend client RTL tests covering success/error flows, parameters accordion default-closed, repo/file expansion, and sorting/aggregation.
8. [ ] Update projectStructure.md if new components added.
9. [ ] Run lint/format.

#### Testing
1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`

#### Implementation notes
- (fill during work)

---

### 3. End-to-end validation & docs

- Task Status: __to_do__
- Git Commits: to_do

#### Overview
Validate full flow and document new tool detail UX.

#### Documentation Locations
- README.md (chat/tool visibility section)
- design.md (tool detail flows + diagrams)
- projectStructure.md (new components/tests)
- Playwright docs: Context7 `/microsoft/playwright`

#### Subtasks
1. [ ] Add/extend Playwright e2e covering tool detail expansions for both tools (success and failure cases) and parameters accordion.
2. [ ] Capture screenshots per story naming convention into `test-results/screenshots/`.
3. [ ] Update README.md with the new tool detail behaviors and parameter visibility.
4. [ ] Update design.md with flow description/diagram for tool detail rendering and error handling.
5. [ ] Update projectStructure.md for any new files/components/tests.
6. [ ] Summarize changes for PR comment (include coverage + UX notes).
7. [ ] Run `npm run lint --workspaces`, `npm run format:check --workspaces`, `npm run build --workspace server`, `npm run build --workspace client`, `npm run test --workspaces`, and `npm run e2e` if environment available.

#### Testing
1. [ ] `npm run e2e`
2. [ ] `npm run build --workspace server`
3. [ ] `npm run build --workspace client`
4. [ ] `npm run test --workspace server`
5. [ ] `npm run test --workspace client`

#### Implementation notes
- (fill during work)

---

### 4. Final Task – Story completion checks

- status: __to_do__
- Git Commits: to_do

#### Overview
Ensure acceptance criteria met, full builds/tests pass, docs/screenshots complete, and PR summary ready.

#### Documentation Locations
- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks
1. [ ] Build server and client.
2. [ ] Run server and client tests.
3. [ ] Run clean docker build if needed and compose up/down smoke.
4. [ ] Run full e2e suite; capture/verify screenshots for this story.
5. [ ] Verify README/design/projectStructure reflect final state; update if needed.
6. [ ] Prepare PR comment summarizing all changes and test results.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`

#### Implementation notes
- (fill during work)
