# Story 0000039 – Agents Command Info Popover and Working-Folder Prompts

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

On the Agents page, command descriptions are currently always rendered inline below the command selector, including the default message when no command is selected. This story removes that inline description area and moves command details behind a single command-info icon button in the command row.

This story also adds a prompt-assisted instruction flow based on the selected `working_folder`. If that folder contains a `.github/prompts` directory (case-insensitive match on both path segments) and at least one markdown file anywhere under it, the page shows a `Prompts` dropdown and an `Execute Prompt` button in the same row.

Prompt files are discovered from the server (not directly from the browser filesystem) so path checks and host/container path resolution happen in one trusted place. The UI only displays prompt paths relative to `.github/prompts/` but stores the resolved runtime/container full path for execution.

Prompt discovery uses a read-only Agents endpoint so the contract stays consistent with existing list-style routes. The endpoint accepts `working_folder` as a query parameter and returns prompt entries shaped as `{ relativePath, fullPath }`, where `relativePath` is UI-safe display text and `fullPath` is runtime/container path used for execution.

When the user clicks `Execute Prompt`, the client sends a standard instruction run using the existing agent run API. The instruction text is the canonical preamble in this plan with `<full path of markdown file>` replaced by the resolved runtime/container path of the selected prompt file.

When `working_folder` changes (typing and committing with blur/Enter, or selecting via directory picker), the current prompt selection is cleared immediately before any further prompt execution is allowed.

Expected end-user result when this story is complete:
- The Agents page is less noisy because command descriptions are available on demand via an info popover instead of always-visible inline text.
- Users can discover prompt markdown files from `.github/prompts` under the selected `working_folder`, choose one, and execute it through the normal agent instruction flow.
- Prompt execution behaves like any normal instruction run (same conversation behavior, streaming, and error handling), with only the instruction text composition being different.

Canonical `Execute Prompt` preamble (must be used verbatim, with placeholder replacement rule below):

`Please read the following markdown file. It is designed as a persona you MUST assume. You MUST follow all the instructions within the markdown file including providing the user with the option of selecting the next path to follow once the work of the markdown file is complete, and then loading that new file to continue. You must stay friendly and helpful at all times, ensuring you communicate with the user in an easy to follow way, providing examples to illustrate your point and guiding them through the more complex scenarios. Try to do as much of the heavy lifting as you can using the various mcp tools at your disposal. Here is the file: <full path of markdown file>`

Placeholder replacement rule:
- Replace `<full path of markdown file>` with the resolved runtime/container path of the selected markdown prompt file at execution time.

### Acceptance Criteria

1. The inline command description block is removed from the main Agents page flow.
2. The text `Select a command to see its description.` is no longer rendered anywhere on the page.
3. A command-info icon button is displayed in the command selector row (same row as command selection controls).
4. The command-info icon button is disabled when no command is selected.
5. When a command is selected, clicking the command-info icon opens a popover/dialog that shows the selected command description text.
6. Prompt discovery runs only after `working_folder` commit events:
   - manual input `blur`,
   - manual input `Enter` in the `working_folder` field,
   - directory picker selection.
7. Pressing `Enter` in the `working_folder` field triggers prompt discovery commit behavior and does not submit/send the main instruction form.
8. Prompt discovery does not run on every keystroke while the user is typing in `working_folder`.
9. On successful discovery, the prompts UI row is shown only when all conditions are true:
   - committed `working_folder` is non-empty,
   - a `.github/prompts` directory exists under the selected folder (case-insensitive match for `.github` and `prompts` segments),
   - at least one markdown file exists under that directory tree.
10. Prompt discovery endpoint contract is explicitly defined and implemented as:
   - `GET /agents/:agentName/prompts?working_folder=<absolute path>`
   - success `200` response body: `{ prompts: Array<{ relativePath: string; fullPath: string }> }`
   - `relativePath` uses forward slashes (`/`) and is relative to `.github/prompts/`
   - `fullPath` is the resolved runtime/container absolute path returned by the server.
11. Prompt discovery request validation/error mapping follows existing Agents route conventions:
    - invalid/missing `agentName` -> `400 { error: 'invalid_request' }`
    - missing/blank `working_folder` query value -> `400 { error: 'invalid_request', message: 'working_folder is required' }`
    - invalid `working_folder` shape/path -> `400 { error: 'invalid_request', code: 'WORKING_FOLDER_INVALID', ... }`
    - unresolved/non-existent `working_folder` -> `400 { error: 'invalid_request', code: 'WORKING_FOLDER_NOT_FOUND', ... }`
    - agent not found -> `404 { error: 'not_found' }`
    - unexpected failures -> `500 { error: 'agent_prompts_failed' }`.
12. Prompt discovery is recursive below `.github/prompts`, includes markdown files with case-insensitive extension handling (`.md`, `.MD`, including names like `foo.prompt.md`), and excludes non-markdown files.
13. Prompt discovery output is deterministic: prompt entries are sorted ascending by normalized `relativePath` before returning to the client.
14. Symlink safety is defined: discovery does not follow symlink directories/files when walking prompt trees, preventing traversal loops and cross-root escapes.
15. Prompt option labels are relative paths from `.github/prompts/` (for example, `onboarding/start.md`), never absolute host/runtime paths.
16. The prompts dropdown includes an explicit empty option so users can clear selection after previously choosing a prompt.
17. `Execute Prompt` is displayed in the prompts row and is disabled unless a valid prompt is selected.
18. If prompt discovery fails for a committed non-empty `working_folder`, the prompts row is shown with an inline error message and does not silently hide the failure.
19. If discovery succeeds with zero markdown prompt files, the prompts row is hidden (no error state).
20. Changing `working_folder` clears previously discovered prompt selection immediately (for both text commit and picker selection) and keeps `Execute Prompt` disabled until a new valid prompt is selected.
21. Clicking `Execute Prompt` uses the existing instruction run path (`POST /agents/:agentName/run`) and does not use command-run execution.
22. The outbound `instruction` string equals:
    - canonical preamble text from this plan, with `<full path of markdown file>` replaced by the selected prompt runtime/container full path.
23. The path inserted into the preamble is the runtime/container-resolved full path returned by discovery, not a host-only path string.
24. Existing agent run behavior remains unchanged for conversation reuse/new conversation creation, run state transitions, transcript streaming, and error handling.
25. Automated tests must cover:
    - command-info visibility, disabled state with no command, and popover opening with selected command,
    - removal of inline command description/default text,
    - prompt discovery endpoint contract (status codes, payload shape, and error mapping),
    - prompt discovery trigger timing (blur/Enter/picker only),
    - case-insensitive `.github/prompts` detection and recursive markdown discovery,
    - deterministic sort order of returned prompt entries,
    - symlink ignore behavior in recursive discovery,
    - relative-path label rendering,
    - execute button enable/disable rules,
    - explicit behavior split for discovery failure vs zero results,
    - stale discovery response handling when `working_folder` is changed quickly (latest committed folder wins),
    - run-lock conflict behavior (`409 RUN_IN_PROGRESS`) when Execute Prompt is triggered against a conversation already running,
    - execution behavior when a prompt file is deleted or moved after discovery but before Execute Prompt is clicked (surface run error, no crash),
    - prompt reset on `working_folder` change,
    - outbound instruction payload containing the exact preamble text and resolved runtime full path.
26. Existing agent command/message contracts remain unchanged and regression-tested:
    - `GET /agents/:agentName/commands`
    - `POST /agents/:agentName/commands/run`
    - `POST /agents/:agentName/run`.
27. `openapi.json` is updated to include `GET /agents/{agentName}/prompts` with request/response schema and error mappings consistent with this story contract.

### Message Contracts and Storage Shapes

1. New REST contract required by this story
- Endpoint: `GET /agents/:agentName/prompts?working_folder=<absolute path>`
- Purpose: discover markdown prompt files under `.github/prompts` for a committed `working_folder` and return runtime/container paths for execution composition.
- Query requirements:
- `working_folder` is required for this endpoint.
- `working_folder` must be absolute (POSIX or Windows style), following existing server-side validation behavior.
- Success response shape (`200`):
```json
{
  "prompts": [
    {
      "relativePath": "onboarding/start.md",
      "fullPath": "/data/repo/.github/prompts/onboarding/start.md"
    }
  ]
}
```
- Error response mapping (matches existing Agents REST conventions):
```json
{ "error": "invalid_request" }
```
```json
{
  "error": "invalid_request",
  "message": "working_folder is required"
}
```
```json
{
  "error": "invalid_request",
  "code": "WORKING_FOLDER_INVALID",
  "message": "working_folder must be an absolute path"
}
```
```json
{
  "error": "invalid_request",
  "code": "WORKING_FOLDER_NOT_FOUND",
  "message": "working_folder not found"
}
```
```json
{ "error": "not_found" }
```
```json
{ "error": "agent_prompts_failed" }
```

2. Existing contracts explicitly unchanged
- Instruction execution contract stays unchanged:
  - `POST /agents/:agentName/run` request body remains `{ instruction, conversationId?, working_folder? }`
  - `202` response remains `{ status, agentName, conversationId, inflightId, modelId }`
- Command execution contract stays unchanged:
  - `POST /agents/:agentName/commands/run` request body remains `{ commandName, sourceId?, conversationId?, working_folder? }`
  - `202` response remains `{ status, agentName, commandName, conversationId, modelId }`
- WebSocket message/event contracts remain unchanged (no new client message types, no new server event types for this story).
- MCP agents tool contracts remain unchanged (no new MCP tool in scope for this story).

3. Storage/persistence shape impact
- No Mongo schema changes are required.
- `Conversation` document shape remains unchanged (`agentName`, `source`, `flags`, etc.); no new prompt-related fields are added.
- `Turn` document shape remains unchanged (`command`, `usage`, `timing`, etc.); prompt execution records as standard user/assistant turns through existing flow.
- No data migration/backfill is required.
- Prompt selection/discovery UI state is ephemeral client state and is not persisted server-side.

### Edge Cases and Failure Modes

1. Missing `working_folder` query on prompt discovery
- Failure mode: client calls `GET /agents/:agentName/prompts` without `working_folder` or with blank value.
- Expected behavior: server returns `400 { error: 'invalid_request', message: 'working_folder is required' }`; UI shows inline prompts error for committed non-empty folder attempts.

2. Non-absolute or invalid `working_folder` path
- Failure mode: relative path or malformed value.
- Expected behavior: server returns `400` with `code: 'WORKING_FOLDER_INVALID'`; no discovery results are shown.

3. `working_folder` does not exist or is not accessible
- Failure mode: folder removed, inaccessible, or not mounted in runtime container.
- Expected behavior: server returns `400` with `code: 'WORKING_FOLDER_NOT_FOUND'`; prompts area shows inline error state.

4. `.github/prompts` exists with mixed-case folder names
- Failure mode: folder exists as `.GITHUB/Prompts` (or similar case variants).
- Expected behavior: discovery still succeeds due to case-insensitive segment matching.

5. `.github/prompts` exists but contains no markdown files
- Failure mode: directory tree has only non-markdown files.
- Expected behavior: discovery returns empty list and prompts area is hidden (not an error state).

6. Recursive traversal encounters symlinks
- Failure mode: symlink to external folders or recursive loops under prompts tree.
- Expected behavior: symlink entries are ignored; traversal does not follow links; discovery remains bounded and safe.

7. Rapid `working_folder` changes cause out-of-order discovery responses
- Failure mode: older request resolves after a newer request and overwrites newer results.
- Expected behavior: UI applies only the latest committed-folder response; stale responses are discarded.

8. Execute Prompt triggered while run already active for same conversation
- Failure mode: user starts prompt run while another run is already in progress.
- Expected behavior: existing run lock applies; server returns `409 RUN_IN_PROGRESS`; UI shows existing conflict error handling.

9. Prompt file deleted/moved after discovery but before execution
- Failure mode: dropdown contains prompt chosen earlier but file no longer exists when agent runs.
- Expected behavior: execution still uses existing instruction flow; failure appears as normal run/turn error in transcript; app does not crash.

10. User changes `working_folder` after selecting prompt
- Failure mode: stale prompt selection could execute against wrong folder context.
- Expected behavior: selected prompt is cleared immediately on committed folder change and Execute Prompt stays disabled until a new valid selection.

11. Enter key in `working_folder` field during draft instruction editing
- Failure mode: Enter key triggers unintended instruction send.
- Expected behavior: Enter commits folder discovery only; it does not submit/send the instruction form.

### Out Of Scope

- Editing, creating, renaming, or deleting prompt files from the UI.
- Supporting non-markdown prompt file types.
- Supporting GitHub Copilot-specific prompt metadata/validation beyond markdown-file discovery and execution path insertion.
- Prompt versioning, tagging, or search/filter UX beyond the dropdown list.
- Changes to agent command-file schema or command execution sequencing.
- Introducing a new protocol distinct from the existing Agents run contract for prompt execution.
- Multi-select prompt execution, prompt batching, or chained execution in a single click.

### Questions

None.

### Research Findings (2026-03-02)

- Node.js `fs.readdir` supports `recursive` and `withFileTypes` in current repo runtime (`node >=22`), which keeps prompt discovery implementation simple without extra dependencies.
- Node.js documents `fs.Dirent.parentPath` and deprecates `dirent.path`; because this repo guarantees `node >=22` (not a fixed 22.x minor), prompt traversal should not depend on `parentPath` and should carry directory context explicitly in walker state.
- POSIX `readdir()` does not guarantee sorted order, so deterministic sorting must be explicit in service code before returning prompt lists.
- Node.js `path` docs confirm POSIX vs Windows path semantics differ; prompt discovery should continue using existing server-side working-folder resolution rather than client-side path conversion.
- MUI Popover is already used in `AgentsPage` and is built on Modal with click-away/scroll lock behavior, so reusing existing popover interaction is consistent with current UI patterns.
- MUI MCP docs available in this environment are versioned at `6.4.12`; repository dependency resolves to `@mui/material 6.5.0` in lockfile, and APIs used by this story (`Popover`, `IconButton`, `Select`, `TextField`, `Button`) remain compatible within MUI v6.
- GitHub documentation uses `.github/prompts` for prompt files (often `.prompt.md`), but this story intentionally supports all markdown files (`.md`, case-insensitive) under that tree for simpler, project-local behavior.
- DeepWiki and Context7 MCP research attempts were unavailable in this environment (repository not indexed in DeepWiki; Context7 API key unavailable), so decisions were cross-checked with repo code and official Node/MUI/GitHub web documentation.
- Contract/storage confirmation for this story: only one new REST read contract is required (`GET /agents/:agentName/prompts`), while run contracts, WS/MCP schemas, and Mongo storage shapes remain unchanged.
- React `19.2.0` security advisory for React Server Components/React Server Functions was reviewed; this repo uses a Vite SPA client with no RSC/RSF runtime path, so advisory assumptions for server-component execution do not apply directly to this story.
- De-risking scope note: prompt discovery can stay scoped to the resolved `working_folder`; adding repository fan-out for this endpoint is unnecessary complexity because execution already relies on resolved runtime/container paths.

## Implementation Ideas

Use a single end-to-end approach that reuses existing Agents route/service patterns and keeps prompt-specific logic minimal.

1. Server routing and API surface
- Extend [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts) with `GET /:agentName/prompts`.
- Keep endpoint under the existing commands router namespace (mounted at `/agents`) to match current read-only list route patterns.
- Reuse the existing `isAgentCommandsError` style and existing run/list route error mapping structure in this router; do not create a separate prompts router.
- Accept `working_folder` as a query parameter and validate it as required, non-empty, and absolute via existing working-folder validation behavior.
- Return `200 { prompts: [...] }` on success and map typed service errors to existing route conventions (`invalid_request`, `not_found`, `500 { error: 'agent_prompts_failed' }`).
- Return `400 invalid_request` when `working_folder` query is missing/blank so endpoint behavior is explicit and testable.

2. Server service implementation
- Add a new service function in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), for example `listAgentPrompts({ agentName, working_folder })`.
- Reuse `resolveWorkingFolderWorkingDirectory(...)` for runtime/container path resolution, so the client never performs host/container mapping logic.
- Keep discovery scoped to the resolved `working_folder` path only; do not add `listIngestedRepositories(...)` fan-out for this endpoint.
- Verify agent existence using existing discovery path (`discoverAgents`) before scanning for prompts.
- Implement case-insensitive folder resolution for `.github/prompts` by matching each path segment against on-disk directory entries at each level.
- Walk the resolved prompts directory recursively, include only markdown files (`.md`, case-insensitive), ignore symlink entries, and skip non-markdown files.
- Build response items as `{ relativePath, fullPath }` where:
- `relativePath` is relative to prompts root with forward slashes.
- `fullPath` is the runtime/container absolute path used later for prompt execution.
- Sort collected prompts by normalized `relativePath` before returning.

3. Client API layer
- Add `listAgentPrompts(...)` in [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts) using existing fetch/error parsing conventions from current agents API methods.
- Keep response typing explicit as `Array<{ relativePath: string; fullPath: string }>`.
- Keep error parsing consistent with `AgentApiError` so UI can show inline discovery errors without introducing a new error abstraction.

4. Agents page UI and state flow
- Update [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx) to replace inline command description text with a command-info `IconButton` + `Popover`, following the existing agent-info popover pattern.
- Introduce prompt discovery state in the page:
- discovered prompt list,
- selected prompt value (keyed by `fullPath`),
- prompts loading state,
- prompts inline error message,
- last committed `working_folder` value used for discovery.
- Trigger discovery only on committed folder events:
- working-folder text field `blur`,
- Enter key in working-folder input,
- directory picker `onPick`.
- Ensure Enter handling in `working_folder` field prevents accidental submission of the main instruction form when no prompt action was requested.
- Do not trigger discovery in `onChange` for every keystroke.
- On each committed working-folder change:
- clear selected prompt immediately,
- clear old prompt list,
- run discovery only when committed value is non-empty.
- Render the prompts area when either:
- discovery returns at least one prompt (show selector + Execute Prompt button), or
- discovery fails for a committed non-empty `working_folder` (show inline error state).
- Hide the prompts area when there is no committed `working_folder` or discovery succeeds with zero prompts.
- Keep `Execute Prompt` disabled unless a valid prompt is selected.

5. Prompt execution behavior
- Keep execution on existing instruction flow only: `runAgentInstruction(...)` -> `POST /agents/:agentName/run`.
- Build instruction text in the client by replacing `<full path of markdown file>` in the canonical preamble with selected prompt `fullPath`.
- Do not introduce a separate prompt execution endpoint or command-run path.
- Preserve existing conversation/run behavior (reuse active conversation, websocket transcript flow, abort behavior).

6. Test strategy (rough coverage map)
- Client UI tests:
- update [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx) for removal of inline description and command-info interaction.
- extend [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx) pattern for command popover behavior.
- extend [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx) for commit-event discovery triggers and prompt reset behavior.
- add a focused new Agents page prompts test file for gating, inline error vs empty-result behavior, and execute button enable rules.
- Client API tests:
- extend [client/src/test/agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts) pattern for `listAgentPrompts`.
- Server tests:
- extend [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts) for new prompts route status/body/error mapping.
- add service tests in [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts) for recursive discovery, case-insensitive matching, deterministic sorting, markdown filtering, and symlink-ignore behavior.

7. Validation and delivery checks
- Use repository wrapper commands for validation and diagnosis:
- `npm run test:summary:client`
- `npm run test:summary:server:unit`
- `npm run build:summary:client`
- `npm run build:summary:server`
- Update documentation files already called out in scope (`README.md`, `design.md`, `projectStructure.md`) with final route and UX behavior once implementation details are finalized.

# Implementation Plan

## Instructions

1. Read all sections above before implementation, especially Acceptance Criteria, Message Contracts and Storage Shapes, and Edge Cases and Failure Modes.
2. Complete tasks in the exact order listed below.
3. Keep each task focused to one testable implementation concern.
4. Complete server contract/message tasks before frontend tasks that consume those contracts.
5. Add or update deterministic tests in the same task that introduces behavior/contract changes.
6. Use wrapper-first build/test commands from `AGENTS.md`.
7. Update task status, subtasks, tests, implementation notes, and commit hashes as each task progresses.

## Tasks

### 1. Server Message Contract: add `GET /agents/:agentName/prompts` route contract and error mapping

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Define the new REST message contract at the router boundary before any frontend work depends on it. This task only introduces request validation, response envelope shape, and error mapping for prompt discovery, with service logic mocked/stubbed through existing dependency injection.

#### Documentation Locations (External References Only)

- Express routing and request/response basics: https://expressjs.com/en/guide/routing.html
- HTTP status semantics (`400`, `404`, `500`): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
- Node test runner (`node:test`) patterns used in server tests: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Add a new route handler in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts) for `GET /:agentName/prompts`.
   - Validate non-empty `agentName`.
   - Validate required `working_folder` query string.
2. [ ] Add route-level request parsing for `working_folder` query value.
   - Reject missing/blank values with `400 { error: 'invalid_request', message: 'working_folder is required' }`.
   - Follow existing route validator style used in `agentsRun.ts` and `agentsCommands.ts` (typed parse helper + deterministic `invalid_request` messages), rather than ad-hoc inline checks in multiple places.
   - Treat `working_folder` as a plain string query parameter (Express 5 default simple query parser): reject array/object forms with `400 invalid_request`.
3. [ ] Add dependency wiring in `createAgentsCommandsRouter(...)` for new service method `listAgentPrompts`.
   - Update `Deps` type to include `listAgentPrompts`.
   - Add default dependency mapping from `server/src/agents/service.ts` without changing existing keys (`listAgentCommands`, `startAgentCommand`).
   - Keep route mounted in the existing `createAgentsCommandsRouter` path; do not create a new router module.
4. [ ] Implement route response envelope for success: `200 { prompts: Array<{ relativePath, fullPath }> }`.
5. [ ] Implement route error mapping:
   - `AGENT_NOT_FOUND` -> `404 { error: 'not_found' }`
   - `WORKING_FOLDER_INVALID` / `WORKING_FOLDER_NOT_FOUND` -> `400 { error: 'invalid_request', code, message }`
   - fallback -> `500 { error: 'agent_prompts_failed' }`
6. [ ] Update [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts) to:
   - align helper dependency naming with router DI (`startAgentCommand`, not `runAgentCommand`),
   - keep existing command-list tests passing while adding prompts-route tests.
7. [ ] Add router unit tests in [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts) for:
   - success payload shape,
   - invalid/malformed `agentName` -> `400 { error: 'invalid_request' }`,
   - missing/blank `working_folder`,
   - `AGENT_NOT_FOUND` mapping,
   - `WORKING_FOLDER_*` mappings,
   - generic `500` mapping.
8. [ ] Add/extend regression tests so existing command/run route contracts remain unchanged:
   - [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts),
   - [server/src/test/unit/agents-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-router-run.test.ts).
   - Keep these tests green as the primary regression guard; only add new assertions if route behavior changes unexpectedly.
9. [ ] Update [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json) with `GET /agents/{agentName}/prompts`:
   - required query param `working_folder`,
   - `200` response schema `{ prompts: [{ relativePath, fullPath }] }`,
   - `400`/`404`/`500` error schema mapping (`invalid_request`, `not_found`, `agent_prompts_failed`).
10. [ ] If this task adds/removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) in this task.
11. [ ] Run workspace lint/format checks as final subtask for this task:
   - `npm run lint --workspaces`
   - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agents-commands-router-list.test.ts`
3. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agents-commands-router-run.test.ts`
4. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agents-router-run.test.ts`
5. [ ] `npm run compose:build:summary`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 2. Server: implement prompt discovery service (case-insensitive `.github/prompts`, recursive markdown scan, deterministic ordering)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement the actual prompt discovery behavior in the server service layer with filesystem safety and deterministic ordering guarantees. This task is backend-only and test-focused, and it is independent of frontend rendering.

#### Documentation Locations (External References Only)

- Node `fs` API (`readdir`, `Dirent`, `lstat`/`stat`): https://nodejs.org/api/fs.html
- Node `path` API (`resolve`, `relative`, separators): https://nodejs.org/api/path.html
- Node test runner (`node:test`) patterns: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Add service-level contract in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts): `listAgentPrompts({ agentName, working_folder })`.
   - Implement alongside `listAgentCommands(...)` and reuse existing service error/helper patterns without introducing new source fan-out dependencies.
2. [ ] Reuse `resolveWorkingFolderWorkingDirectory(...)` to resolve/validate `working_folder` before traversal.
   - Reuse existing `discoverAgents()` agent lookup pattern used by `listAgentCommands(...)`.
3. [ ] Implement case-insensitive segment matching for `.github/prompts` under resolved working folder.
4. [ ] Implement recursive traversal under prompts root:
   - include markdown files only (`.md`, case-insensitive),
   - ignore symlink entries,
   - skip non-markdown files,
   - use explicit recursive walk context (`currentDir` stack/queue) rather than depending on `Dirent.parentPath`.
5. [ ] Return `{ prompts: Array<{ relativePath, fullPath }> }` with:
   - `relativePath` normalized to `/`,
   - `relativePath` guaranteed relative to `.github/prompts/` root (never absolute),
   - deterministic ascending sort by normalized `relativePath`.
6. [ ] Add service unit tests in [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts) for:
   - case-insensitive folder resolution,
   - recursive markdown discovery,
   - markdown extension coverage (`.md`, `.MD`, `*.prompt.md`) and exclusion of non-markdown files,
   - symlink ignore behavior,
   - deterministic ordering,
   - zero-results behavior when `.github/prompts` is missing and when it exists with no markdown files.
7. [ ] If this task adds/removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) in this task.
8. [ ] Run workspace lint/format checks as final subtask for this task.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agent-prompts-list.test.ts`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 3. Client Message Contract: add `listAgentPrompts` API client and contract tests

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add the frontend API function that consumes the new server prompt-discovery contract, with strict response typing and existing error parsing behavior. This task is isolated to the API layer and its tests.

#### Documentation Locations (External References Only)

- Fetch API basics: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- URL query parameter handling: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
- Jest assertions for request/response shape tests: https://jestjs.io/docs/expect

#### Subtasks

1. [ ] Add `listAgentPrompts(...)` in [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts).
   - Endpoint: `GET /agents/:agentName/prompts?working_folder=...`
   - Return type: `{ prompts: Array<{ relativePath: string; fullPath: string }> }`.
2. [ ] Reuse existing API helpers in [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts) for non-2xx and URL handling.
   - Use `throwAgentApiError(...)` so `AgentApiError` status/code/message behavior stays consistent.
   - Use the same `new URL(..., serverBase)` + `encodeURIComponent(agentName)` construction style as existing agent APIs.
3. [ ] Add API unit tests in [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts) for:
   - correct URL/query construction,
   - success payload parsing,
   - non-JSON/JSON error parsing behavior.
4. [ ] Add API unit test coverage for:
   - `400 invalid_request` with missing/invalid working folder messages/codes,
   - URL encoding of `working_folder` query values containing spaces and platform separators.
5. [ ] If this task adds/removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) in this task.
6. [ ] Run workspace lint/format checks as final subtask for this task.

#### Testing

1. [ ] `npm run build:summary:client`
2. [ ] `npm run test:summary:client -- --file client/src/test/agentsApi.promptsList.test.ts`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 4. Frontend: add command-info popover interaction

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Introduce the command-info icon and popover interaction only. This task does not remove legacy inline description text yet.

#### Documentation Locations (External References Only)

- MUI Popover component docs (v6.4.12): https://llms.mui.com/material-ui/6.4.12/components/popover.md
- MUI IconButton API docs (v6.4.12): https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
- Installed dependency note: repo resolves `@mui/material` to `6.5.0`; use v6.4.12 MCP docs as the closest available v6 reference and verify against existing in-repo component usage.
- React Testing Library interaction patterns: https://testing-library.com/docs/react-testing-library/intro

#### Subtasks

1. [ ] Add command-info icon button in the command row in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
   - Disabled when no command is selected.
2. [ ] Add command-info popover state and rendering for selected-command description.
   - Reuse the existing agent-info popover pattern (`anchorEl`, `open`, `id`, open/close handlers, `Popover` wiring).
3. [ ] Ensure disabled command-info behavior is safe and predictable when no command is selected.
   - Clicking the disabled button should not open the popover or throw runtime errors.
4. [ ] Extend [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx) pattern for command-info popover behavior.
5. [ ] If this task adds/removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) in this task.
6. [ ] Run workspace lint/format checks as final subtask for this task.

#### Testing

1. [ ] `npm run build:summary:client`
2. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.descriptionPopover.test.tsx`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 5. Frontend: remove inline command description area

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Remove the old always-visible inline command description behavior now that command-info popover interaction exists.

#### Documentation Locations (External References Only)

- React Testing Library interaction patterns: https://testing-library.com/docs/react-testing-library/intro
- Existing command list UI tests in [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)

#### Subtasks

1. [ ] Remove inline command description rendering in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
2. [ ] Ensure `Select a command to see its description.` is not rendered anywhere.
3. [ ] Update [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx) for inline description removal expectations.
4. [ ] Add/update regression assertions to confirm command execute button enable/disable behavior is unchanged.
5. [ ] If this task adds/removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) in this task.
6. [ ] Run workspace lint/format checks as final subtask for this task.

#### Testing

1. [ ] `npm run build:summary:client`
2. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.commandsList.test.tsx`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 6. Frontend: prompt discovery request lifecycle (commit triggers and stale-response guard)

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement prompt discovery request timing and request lifecycle safety only. This task does not implement final prompts row rendering rules.

#### Documentation Locations (External References Only)

- React state and effects guidance: https://react.dev/learn/synchronizing-with-effects
- React controlled inputs: https://react.dev/reference/react-dom/components/input
- React Testing Library async/state tests: https://testing-library.com/docs/dom-testing-library/api-async

#### Subtasks

1. [ ] Add prompt discovery request state in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx):
   - prompts loading,
   - prompts error,
   - committed working folder value,
   - request sequence id for latest-response-wins behavior.
2. [ ] Trigger discovery only on committed events:
   - `working_folder` blur,
   - Enter in `working_folder`,
   - directory picker selection.
3. [ ] Prevent Enter in `working_folder` from submitting the instruction form.
   - Scope this handling to the `working_folder` field only so multiline `Instruction` keeps normal Enter/newline behavior.
4. [ ] Do not request discovery if committed `working_folder` is unchanged from the last committed value.
5. [ ] Implement stale-response handling so only latest committed-folder response updates state.
   - Use one deterministic guard pattern (monotonic request sequence/ref check) instead of combining multiple cancellation strategies.
6. [ ] Extend [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx) for:
   - commit trigger timing (`blur`/`Enter`/picker),
   - no keystroke-only discovery before commit,
   - no duplicate discovery requests on unchanged committed folder.
7. [ ] Add/update lifecycle tests in [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx) for:
   - stale-response handling (latest committed folder wins),
   - Enter does not submit main instruction form.
8. [ ] If this task adds/removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) in this task.
9. [ ] Run workspace lint/format checks as final subtask for this task.

#### Testing

1. [ ] `npm run build:summary:client`
2. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.workingFolderPicker.test.tsx`
3. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.promptsDiscovery.test.tsx`
4. [ ] `npm run compose:build:summary`
5. [ ] `npm run compose:up`
6. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 7. Frontend: prompt selector UI state transitions and visibility rules

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement prompts selector rendering rules and selection/reset behavior once request lifecycle is in place.

#### Documentation Locations (External References Only)

- MUI Select and TextField docs (v6.4.12): https://llms.mui.com/material-ui/6.4.12/components/selects.md
- Installed dependency note: repo resolves `@mui/material` to `6.5.0`; use v6.4.12 MCP docs as the closest available v6 reference and verify against existing in-repo component usage.
- React Testing Library async/state tests: https://testing-library.com/docs/dom-testing-library/api-async

#### Subtasks

1. [ ] Add prompts list and selected prompt state in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
2. [ ] Implement prompts-area visibility rules:
   - show selector + Execute Prompt button when prompts exist,
   - show inline error when discovery fails for committed non-empty folder,
   - hide when committed folder is empty or discovery succeeds with zero prompts.
3. [ ] Implement prompts dropdown option behavior:
   - labels from `relativePath` only (never `fullPath`),
   - explicit empty option labeled `No prompt selected`.
4. [ ] Implement immediate selected prompt reset on committed `working_folder` change.
5. [ ] Keep Execute Prompt disabled unless selected prompt is valid.
6. [ ] Extend [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx) for:
   - visibility/error/zero-result split,
   - relative-path label rendering + explicit empty option behavior,
   - selection reset behavior.
7. [ ] If this task adds/removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) in this task.
8. [ ] Run workspace lint/format checks as final subtask for this task.

#### Testing

1. [ ] `npm run build:summary:client`
2. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.promptsDiscovery.test.tsx`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 8. Frontend: execute prompt through instruction run path

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Implement prompt execution by composing the canonical instruction string and dispatching it through the existing instruction run flow.

#### Documentation Locations (External References Only)

- React event handling: https://react.dev/learn/responding-to-events
- Existing API error handling patterns in client tests (Jest): https://jestjs.io/docs/expect
- MUI Button interaction states: https://llms.mui.com/material-ui/6.4.12/api/button.md
- Installed dependency note: repo resolves `@mui/material` to `6.5.0`; use v6.4.12 MCP docs as the closest available v6 reference and verify against existing in-repo component usage.

#### Subtasks

1. [ ] Add Execute Prompt handler in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
   - Reuse the same run orchestration sequence used by existing `handleSubmit` and `handleExecuteCommand`.
2. [ ] Compose outbound instruction exactly from canonical preamble by replacing `<full path of markdown file>` with selected prompt `fullPath`.
3. [ ] Execute via existing `runAgentInstruction(...)` only.
   - Pass committed `working_folder` value used for prompt discovery.
4. [ ] Preserve existing conflict and error UX handling (`RUN_IN_PROGRESS`, generic errors) without prompt-specific protocol branches.
5. [ ] Keep existing Send instruction and Execute command behavior unchanged.
6. [ ] Extend existing conflict tests in:
   - [client/src/test/agentsPage.run.instructionError.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.instructionError.test.tsx),
   - [client/src/test/agentsPage.commandsRun.conflict.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsRun.conflict.test.tsx),
   to assert unchanged conflict UX.
7. [ ] Add/update prompt execution-specific tests in [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx) for:
   - exact instruction payload composition,
   - `fullPath` replacement (not `relativePath`),
   - committed `working_folder` forwarding,
   - execute-button enable/disable behavior,
   - deleted/moved prompt error flow without crash.
8. [ ] Add/update regression assertions in existing agents page tests to confirm:
   - Send button still triggers standard instruction path,
   - Execute command still uses command-run path.
9. [ ] If this task adds/removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) in this task.
10. [ ] Run workspace lint/format checks as final subtask for this task.

#### Testing

1. [ ] `npm run build:summary:client`
2. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.executePrompt.test.tsx`
3. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.run.instructionError.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.commandsRun.conflict.test.tsx`
5. [ ] `npm run compose:build:summary`
6. [ ] `npm run compose:up`
7. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 9. Documentation: update story-facing product and architecture docs for final 0000039 behavior

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Capture final behavior in repository docs once implementation is complete, including API contract updates, UX behavior, and file map changes.

#### Documentation Locations (External References Only)

- Markdown guide for consistent formatting: https://www.markdownguide.org/basic-syntax/
- Mermaid syntax (if diagrams updated): https://mermaid.js.org/syntax/sequenceDiagram.html

#### Subtasks

1. [ ] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) with user-facing behavior updates for command info and prompt execution flow.
2. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with API contract and interaction flow updates (including prompt discovery + execute flow).
3. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for all files added/removed across this story.
4. [ ] Verify [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json) from Task 1 still matches final implementation and update only if implementation drift is discovered.
5. [ ] Run workspace lint/format checks as final subtask for this task.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 10. Final verification: full acceptance and regression gate for story 0000039

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Run full validation for the complete story, verify acceptance criteria end-to-end, and prepare final implementation summary evidence.

#### Documentation Locations (External References Only)

- Docker/Compose basics: https://docs.docker.com/compose/
- Playwright docs: https://playwright.dev/docs/intro
- Jest docs: https://jestjs.io/docs/getting-started
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server (`npm run build:summary:server`).
2. [ ] Build the client (`npm run build:summary:client`).
3. [ ] Perform a clean docker build (`npm run compose:build:clean`).
4. [ ] Ensure [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) is fully updated for final behavior.
5. [ ] Ensure [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) is fully updated (including any relevant diagrams).
6. [ ] Ensure [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) reflects all file additions/removals.
7. [ ] Create a full story implementation summary suitable for pull request description/comment.

#### Testing

1. [ ] `npm run test:summary:client`
2. [ ] `npm run test:summary:server:unit`
3. [ ] `npm run test:summary:server:cucumber`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:e2e`
6. [ ] Use Playwright MCP/manual browser check for key acceptance criteria and save screenshots under `test-results/screenshots/` with names prefixed `0000039-<task-number>-<description>.png`.
7. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.
