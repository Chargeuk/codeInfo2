# Story 0000008 – Tool visibility detail & parameters

## Description
Enhance chat tool-call visibility so users can understand exactly which tool ran, what was passed in, and what it returned. Closed state should show the tool name and status; expanded state should display tool-specific, human-friendly details plus raw parameters. For ListIngestedRepositories, users need an expandable list of repositories with full metadata per repo. For VectorSearch, users should see an alphabetical list of unique files (with paths), each showing relevance score and chunk count. Errors must be obvious, expandable, and include all available details. Once the client receives tool data, the tool call is considered complete—no lingering spinners.

## Acceptance Criteria
- Tool call stays closed by default; closed view shows tool name and success/failure state once results/errors arrive.
- When opened, show all repository/file entries (no cap); each entry is individually expandable for details.
- All tool calls include an expandable Parameters section (closed by default) listing every parameter passed to the tool.
- ListIngestedRepositories results render as a list of repository names; each name is expandable to show the full returned metadata for that repository.
- VectorSearch results render as an alphabetical list of unique files showing full host path only; each entry shows the highest match value for that file, summed chunk count per file, and server-computed total line count of its returned chunks when available.
- Tool failures display a clear failed state; expanding shows trimmed error details with an option to view the full error (including stack/all fields).
- Once the front end receives tool results or errors, the tool call status changes to complete (no active spinner).
- Behavior is covered by unit/RTL/integration/e2e tests and documented in README/design.

## Out Of Scope
- Changing LM Studio tool schemas or server-side scoring logic.
- Altering ingest/vector search business rules beyond presentation.
- Adding new tools or authentication flows.

## Questions
- Do we need to cap the number of repository/file entries shown before collapsing behind “show more”? **Answer:** Keep the tool call closed by default. When expanded, show all repository/file entries with no cap. Each entry is itself expandable for detailed info.
- Should chunk count be summed per file or show per-result list? **Answer:** Sum chunk counts per file. Each file appears once with total chunks (e.g., 3 results for one file → chunk count 3). If available, also surface the file's total line count.
- Should we show host paths in addition to repo/relPath for VectorSearch? **Answer:** Show only the full host path; skip internal/container paths as they are not user-meaningful.
- How to obtain line counts? **Answer:** Compute server-side before sending to the client: total line count of all chunks returned for that file.
- What chunk details to show when expanding a file? **Answer:** Just the aggregated counts; no per-chunk snippets.
- Error display? **Answer:** Show trimmed subset (code/message/etc.) with an expansion to reveal full error including callstack and all available info; no masking needed.
- Sorting ties for VectorSearch? **Answer:** Top-level list is alphabetical (deduped). Also show the highest match value for each file; no secondary sort.

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
1. [ ] Confirm/extend tool result typing for ListIngestedRepositories and VectorSearch to carry parameters and raw payloads through SSE (`tool-result`) frames (files: `server/src/lmstudio/tools.ts`, `server/src/lmstudio/toolService.ts`, `server/src/routes/chat.ts`). Example payload to support:
   ```json
   {
     "type": "tool-result",
     "tool": "VectorSearch",
     "parameters": {"query": "foo", "limit": 5},
     "results": [
       {"hostPath": "/repo/a.txt", "chunk": "text", "score": 0.82, "lineCount": 12},
       {"hostPath": "/repo/a.txt", "chunk": "more", "score": 0.71, "lineCount": 8}
     ],
     "errorTrimmed": null,
     "errorFull": null
   }
   ```
2. [ ] Ensure errors propagate with structured details (code/message), mark tool status complete on receipt (no spinner linger), and include full error payload for optional expansion (same files as above). Trimmed example:
   ```json
   {"code":"MODEL_UNAVAILABLE","message":"embedding model missing"}
   ```
   Full example includes stack/metadata for expansion.
3. [ ] Compute line counts server-side for VectorSearch: when aggregating per-file results, sum chunk counts and total lines of returned chunks; attach `lineCount` to each file entry (implement aggregation in `server/src/lmstudio/toolService.ts`, e.g., in `formatVectorSearchResults` or equivalent helper).
4. [ ] Add/adjust fixtures and mocks: `server/src/test/support/mockLmStudioSdk.ts`, `server/src/test/integration/chat-tools-wire.test.ts` (or equivalent) and client mock SSE payloads to include parameters, hostPath-only, summed chunk count, highestMatch, lineCount, and full/trimmed error fields. Include sample payloads like:
   ```json
   {"hostPath":"/repo/a.txt","chunkCount":3,"lineCount":20,"highestMatch":0.82}
   ```
5. [ ] Update client chat stream state in `client/src/hooks/useChatStream.ts` (e.g., `handleToolResult` path) to retain tool parameters and tool-specific payloads (host-path-only VectorSearch aggregation fields, highestMatch, chunkCount, lineCount, trimmed/full error flags) and mark tool complete on first result/error.
5. [ ] Docs to update later: README, design, projectStructure.
6. [ ] Run lint/format after code changes.
7. [ ] Test: Server integration (type) — update `server/src/test/integration/chat-tools-wire.test.ts` (or equivalent) to assert tool-result frames contain parameters, hostPath only, summed chunk count per file, highestMatch, lineCount, and trimmed+full error fields; purpose: verify server emits correct payloads and completion status.
8. [ ] Test: Server unit (type) — add/extend targeted unit test (e.g., `server/src/test/unit/toolService.test.ts`) to cover aggregation logic for chunk sums and line counts, and error payload trimming/expansion flags; purpose: guard data shaping.
9. [ ] Test: Client hook unit (type) — add/extend `client/src/test/useChatStream.toolPayloads.test.ts` (or new) to ensure chat state stores parameters, host-path-only file aggregation, highestMatch, summed chunks, lineCount, trimmed/full error, and completion status; purpose: client state correctness.

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
1. [ ] Closed state (default) shows tool name and success/failure icon once result/error arrives; user opens to view details (implement in `client/src/pages/ChatPage.tsx`, e.g., `renderToolCall` section). Closed copy example: `VectorSearch · Success`.
2. [ ] Add expandable Parameters section (closed by default) showing all input params (pretty-printed JSON) for every tool call (in `ChatPage` UI). Example JSX skeleton:
   ```tsx
   <Accordion defaultExpanded={false} aria-label="Tool parameters">
     <AccordionSummary>Parameters</AccordionSummary>
     <AccordionDetails><CodeBlock value={JSON.stringify(params, null, 2)} /></AccordionDetails>
   </Accordion>
   ```
3. [ ] ListIngestedRepositories: render all repo names (no cap); each repo clickable to expand full metadata (hostPath/containerPath/counts/lastIngestAt/lockedModelId/lastError/etc.); component in `ChatPage` or new child component in `client/src/components/chat/ToolDetails.tsx` (if created). Example item label: `repo-a` → expands to JSON block/table of metadata.
4. [ ] VectorSearch: render all unique files (no cap), aggregated by host path only, sorted alphabetically; show highest match value per file, summed chunk count per file, and server-computed total line count when available; each file entry expandable for chunk/result details (no per-chunk snippets required). Implement in `ChatPage` or shared tool detail component; ensure alphabetic sort only. Example summary row: `/repo/a.txt · match 0.82 · chunks 3 · lines 20`.
5. [ ] Error state: show failed badge; expanded view displays trimmed error details with toggle to reveal full error (including stack/all fields); no masking of fields (UI in `ChatPage`). Example trimmed view: `MODEL_UNAVAILABLE: embedding model missing`; expansion shows full JSON.
6. [ ] Ensure accessibility: keyboard toggle for expansions, sensible aria labels (all new accordions/collapses).
7. [ ] Update projectStructure.md if new components added.
8. [ ] Run lint/format.
9. [ ] Test: Client RTL (type) — add/extend `client/src/test/chatPage.toolDetails.test.tsx` to cover: closed-by-default tool block (`VectorSearch · Success/Failed`), parameters accordion default closed showing params JSON, repo list expansion, host-path-only vector file aggregation, highest match value display, summed chunk count, optional line count, alphabetical ordering, and error expansion; purpose: UI behavior/regression coverage.
10. [ ] Test: Client RTL (type) — add error-path coverage showing trimmed error with expandable full payload (same file or new); purpose: ensure failure UX and full error reveal work.

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
1. [ ] Add Playwright e2e (type) — extend/create `e2e/chat-tools-visibility.spec.ts` to cover: tool closed by default; parameters accordion default-closed; ListIngestedRepositories repo expansion; VectorSearch host-path-only file list with alphabetical sort, highest match value, summed chunk count, line count; per-entry expansion; and closed-state label showing tool name + success/failure. Purpose: end-to-end UX verification.
2. [ ] Add Playwright e2e (type) — add failure-path coverage (mocked tool error) ensuring trimmed error + expandable full details (error payload visible after expand). Purpose: failure UX.
3. [ ] Capture screenshots per story naming convention into `test-results/screenshots/` for the above e2e flows; purpose: visual evidence.
4. [ ] Doc: README.md — add tool detail behaviors, parameters accordion default-closed, host-path-only file aggregation, chunk/line counts, and error expansion behavior.
5. [ ] Doc: design.md — describe tool detail flows, aggregation rules (host path, chunk sum, line count, highest match), error handling (trimmed + expand full), and include/update diagram if needed.
6. [ ] Doc: projectStructure.md — reflect any new components, tests, or e2e specs added for this story.
7. [ ] Summarize changes for PR comment (include coverage + UX notes).
8. [ ] Run `npm run lint --workspaces`, `npm run format:check --workspaces`, `npm run build --workspace server`, `npm run build --workspace client`, `npm run test --workspaces`, and `npm run e2e` if environment available.

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
2. [ ] Test: Server tests (type) — `npm run test --workspace server`; purpose: validate server logic and tool payload shaping.
3. [ ] Test: Client tests (type) — `npm run test --workspace client`; purpose: validate chat UI and state changes.
4. [ ] Test: Lint/format (type) — `npm run lint --workspaces` and `npm run format:check --workspaces`; purpose: code quality gate.
5. [ ] Test: E2E suite (type) — `npm run e2e`; purpose: end-to-end coverage including tool detail UX; capture/verify required screenshots for this story.
6. [ ] Run clean docker build if needed and compose up/down smoke.
7. [ ] Doc: README.md — confirm final state reflects tool detail behavior; update if needed.
8. [ ] Doc: design.md — confirm flow/diagrams reflect final state; update if needed.
9. [ ] Doc: projectStructure.md — confirm file tree reflects final components/tests; update if needed.
10. [ ] Prepare PR comment summarizing all changes and test results.

#### Testing
1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`

#### Implementation notes
- (fill during work)
