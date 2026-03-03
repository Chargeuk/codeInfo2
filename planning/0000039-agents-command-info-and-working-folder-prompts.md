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

- Express routing and router handler behavior: https://expressjs.com/en/guide/routing.html (used for `Router`, route registration order, params/query access, and handler response flow in `agentsCommands.ts`)
- HTTP status semantics (`400`, `404`, `500`): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status (used to keep error mapping precise and consistent with REST contract expectations)
- Node test runner (`node:test`) patterns: https://nodejs.org/api/test.html (used for writing deterministic unit tests and subtests in server router test files)
- OpenAPI 3.1 specification: https://swagger.io/specification/ (used to update `GET /agents/{agentName}/prompts` schema, params, and error response contracts correctly)

#### Subtasks

1. [ ] Add a dedicated query parser helper for this route in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
   - Files: [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts)
   - Read first: https://expressjs.com/en/guide/routing.html and https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Implement exactly: create a function like `validatePromptsQuery(query)` that accepts `req.query` and returns `{ working_folder: string }`.
   - Enforce behavior in this helper: reject missing/blank `working_folder`, reject non-string/object/array query values, and return deterministic `invalid_request` messages.
   - Use this shape in helper output:
     ```ts
     type PromptsQuery = { working_folder: string };
     ```

2. [ ] Extend router dependencies to include the new service entrypoint.
   - Files: [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts), [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts)
   - Read first: https://expressjs.com/en/guide/routing.html
   - Implement exactly: update `Deps` type with `listAgentPrompts`, and set the default dependency object to wire `listAgentPrompts` from `service.ts`.
   - Keep existing dependency keys unchanged (`listAgentCommands`, `startAgentCommand`) and do not create a new router module.

3. [ ] Add `GET /:agentName/prompts` route handler to [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
   - Files: [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts)
   - Read first: https://expressjs.com/en/guide/routing.html and https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Implement exactly: validate `agentName` (trimmed non-empty), parse query via helper from subtask 1, call `deps.listAgentPrompts({ agentName, working_folder })`, and return `200` with `{ prompts: [...] }`.
   - Use this response shape exactly:
     ```json
     { "prompts": [{ "relativePath": "...", "fullPath": "..." }] }
     ```

4. [ ] Implement route-level error mapping for the new prompts route.
   - Files: [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Implement exactly:
     - `AGENT_NOT_FOUND` -> `404 { error: 'not_found' }`
     - `WORKING_FOLDER_INVALID` or `WORKING_FOLDER_NOT_FOUND` -> `400 { error: 'invalid_request', code, message }`
     - unexpected error -> `500 { error: 'agent_prompts_failed' }`
   - Reuse `isAgentCommandsError(...)` style already present in the file.

5. [ ] Add router prompts success test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test that calls `GET /agents/:agentName/prompts` with valid input and asserts `200` plus `{ prompts: [{ relativePath, fullPath }] }` response shape.
   - Purpose: verify happy-path contract payload shape before frontend integration.

6. [ ] Add router invalid `agentName` test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test for missing/blank path param `agentName` returning `400 { error: 'invalid_request' }`.
   - Purpose: verify route parameter guard behavior.

7. [ ] Add router missing/blank/non-string `working_folder` test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test that covers missing, blank, and non-string query values returning `400 invalid_request`.
   - Purpose: verify request-shape validation for required query input.

8. [ ] Add router `working_folder` array/object query-shape test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test where `working_folder` is provided as array/object query forms and assert `400 invalid_request`.
   - Purpose: verify query parser hardening against ambiguous query shapes.

9. [ ] Add router `AGENT_NOT_FOUND` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: mock service throw `{ code: 'AGENT_NOT_FOUND' }` and assert `404 { error: 'not_found' }`.
   - Purpose: verify not-found mapping contract.

10. [ ] Add router `WORKING_FOLDER_INVALID` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: mock service throw `WORKING_FOLDER_INVALID` and assert `400 invalid_request` with code/message.
   - Purpose: verify invalid-folder error mapping contract.

11. [ ] Add router `WORKING_FOLDER_NOT_FOUND` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: mock service throw `WORKING_FOLDER_NOT_FOUND` and assert `400 invalid_request` with code/message.
   - Purpose: verify missing-folder error mapping contract.

12. [ ] Add router unknown-error fallback test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: mock service throw generic error and assert `500 { error: 'agent_prompts_failed' }`.
   - Purpose: verify defensive fallback behavior.

13. [ ] Keep existing command-list tests passing in router list test file.
   - Test type: Server unit regression test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: ensure pre-existing `GET /agents/:agentName/commands` tests still pass without behavior drift.
   - Purpose: verify prompts-route additions do not regress command-list functionality.

14. [ ] Keep command-run route regression tests unchanged/passing.
   - Test type: Server unit regression test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts)
   - Description: run and keep existing command-run route assertions green; only add assertions if required by touched code.
   - Purpose: verify no command-run contract regression.

15. [ ] Keep instruction-run route regression tests unchanged/passing.
   - Test type: Server unit regression test (`node:test`).
   - Location: [server/src/test/unit/agents-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-router-run.test.ts)
   - Description: run and keep existing instruction-run route assertions green; only add assertions if required by touched code.
   - Purpose: verify no instruction-run contract regression.

16. [ ] Update OpenAPI contract for prompts discovery.
   - Files: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Implement exactly: add `GET /agents/{agentName}/prompts` with required `working_folder` query, `200` schema `{ prompts: [{ relativePath, fullPath }] }`, and `400`/`404`/`500` error schema mapping.

17. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

18. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- Node `fs` API (`readdir`, `Dirent`, symlink handling via `lstat`): https://nodejs.org/api/fs.html (used to implement recursive prompt discovery, markdown filtering, and symlink ignore behavior)
- Node `path` API (`resolve`, `relative`, separator normalization): https://nodejs.org/api/path.html (used to guarantee safe relative paths and deterministic slash-normalized output)
- Node test runner (`node:test`) patterns: https://nodejs.org/api/test.html (used for filesystem-fixture unit tests and deterministic assertion structure)

#### Subtasks

1. [ ] Add the service contract in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts).
   - Files: [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts)
   - Read first: https://nodejs.org/api/fs.html and https://nodejs.org/api/path.html
   - Implement exactly: `listAgentPrompts({ agentName, working_folder })` returning `{ prompts: Array<{ relativePath: string; fullPath: string }> }`.
   - Place this near `listAgentCommands(...)` to reuse existing service patterns.

2. [ ] Reuse existing validation/discovery helpers before any filesystem walk.
   - Files: [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts)
   - Read first: https://nodejs.org/api/path.html
   - Implement exactly: call `discoverAgents()` to confirm `agentName` exists and call `resolveWorkingFolderWorkingDirectory(...)` to validate/resolve runtime path.
   - Do not add source fan-out across ingest roots for this endpoint.

3. [ ] Add case-insensitive directory resolution for `.github/prompts`.
   - Files: [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts)
   - Read first: https://nodejs.org/api/fs.html
   - Implement exactly: resolve each path segment by reading actual dir entries and matching lower-cased names (`.github`, then `prompts`).
   - If not found, return `prompts: []` (not an error).

4. [ ] Add recursive markdown discovery walker.
   - Files: [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts)
   - Read first: https://nodejs.org/api/fs.html and https://nodejs.org/api/path.html
   - Implement exactly:
     - include only files ending in `.md` (case-insensitive),
     - ignore symlink files/directories,
     - skip non-markdown files,
     - use explicit traversal state (`stack`/`queue` with current directory path), not `Dirent.parentPath`.
   - Suggested shape:
     ```ts
     type PromptItem = { relativePath: string; fullPath: string };
     ```

5. [ ] Normalize and sort response output deterministically.
   - Files: [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts)
   - Read first: https://nodejs.org/api/path.html
   - Implement exactly: compute `relativePath` from prompts root, normalize separators to `/`, verify path is inside prompts root, then sort ascending by normalized `relativePath`.

6. [ ] Add service `AGENT_NOT_FOUND` test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: add a test where unknown `agentName` is passed and assert `AGENT_NOT_FOUND`.
   - Purpose: verify agent existence guard behavior.

7. [ ] Add service `WORKING_FOLDER_INVALID` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: mock/trigger invalid working folder and assert service throws `WORKING_FOLDER_INVALID`.
   - Purpose: verify invalid-path validation behavior.

8. [ ] Add service `WORKING_FOLDER_NOT_FOUND` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: mock/trigger missing working folder and assert service throws `WORKING_FOLDER_NOT_FOUND`.
   - Purpose: verify missing-path validation behavior.

9. [ ] Add case-insensitive `.github/prompts` detection test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: add fixture with mixed-case folder segments and assert prompt discovery still succeeds.
   - Purpose: verify required case-insensitive folder matching.

10. [ ] Add recursive prompt discovery test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: add nested prompt files and assert all nested markdown files are returned.
   - Purpose: verify recursive traversal behavior.

11. [ ] Add markdown-extension inclusion/exclusion test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: assert `.md`, `.MD`, and `*.prompt.md` are included while non-markdown files are excluded.
   - Purpose: verify extension filtering rules.

12. [ ] Add symlink-ignore test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: include symlink entries in fixture and assert they are ignored.
   - Purpose: verify traversal safety and loop prevention.

13. [ ] Add deterministic sort-order test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: provide unsorted fixture names and assert ascending normalized `relativePath` order in output.
   - Purpose: verify stable deterministic API output ordering.

14. [ ] Add output-shape safety test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: assert each prompt has absolute `fullPath` and `relativePath` is never absolute and never starts with `..`.
   - Purpose: verify path safety and contract correctness.

15. [ ] Add zero-results-when-prompts-dir-missing test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: assert service returns `{ prompts: [] }` when `.github/prompts` is absent.
   - Purpose: verify non-error empty-state behavior for missing prompts root.

16. [ ] Add zero-results-when-prompts-dir-has-no-markdown test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: assert service returns `{ prompts: [] }` when prompts directory exists but contains no markdown files.
   - Purpose: verify non-error empty-state behavior for non-markdown-only trees.

17. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

18. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- Fetch API basics: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API (used to implement `GET /agents/:agentName/prompts` call and non-2xx handling in API client)
- URL query parameter handling (`URLSearchParams`): https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams (used for correct `working_folder` encoding and stable query construction)
- Jest `expect` assertions: https://jestjs.io/docs/expect (used to assert URL composition, payload parsing, and error-shape behavior in client API tests)
- Context7 Jest docs: `/jestjs/jest` (used as MCP source for matcher, mocking, and async Jest patterns used in this task's tests)

#### Subtasks

1. [ ] Add `listAgentPrompts(...)` API method.
   - Files: [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API and https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Implement exactly:
     - endpoint `GET /agents/:agentName/prompts?working_folder=...`,
     - return type `{ prompts: Array<{ relativePath: string; fullPath: string }> }`.
   - Reuse existing URL base and `encodeURIComponent(agentName)` style in the same file.

2. [ ] Reuse existing API error parsing behavior.
   - Files: [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Implement exactly: call existing non-2xx parser and `throwAgentApiError(...)` so status/code/message handling remains consistent with other agents APIs.

3. [ ] Add API URL-path construction test for prompts endpoint.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting the request uses `GET /agents/:agentName/prompts` with the correct path structure.
   - Purpose: verify endpoint routing correctness in client API layer.

4. [ ] Add API `working_folder` query-encoding test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting `working_folder` is URL encoded correctly for spaces/slashes/backslashes.
   - Purpose: verify query encoding safety and cross-platform path support.

5. [ ] Add API success payload parsing test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting successful response parses into typed `{ prompts }` output.
   - Purpose: verify happy-path response handling in API client.

6. [ ] Add API JSON error parsing test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting JSON error responses surface `error`, `code`, and `message` through `AgentApiError`.
   - Purpose: verify structured error propagation.

7. [ ] Add API non-JSON error fallback test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting non-JSON responses produce stable fallback error values.
   - Purpose: verify robust error behavior for malformed responses.

8. [ ] Add API network rejection handling test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test where fetch rejects and assert promise rejection maps to stable client error behavior.
   - Purpose: verify transport-layer failure handling.

9. [ ] Add API `400 invalid_request` mapping test for prompts endpoint.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting missing/invalid `working_folder` server responses map to expected error code/message fields.
   - Purpose: verify contract-level error mapping for required query validation.

10. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

11. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- MUI Popover docs (MUI MCP mirror v6.4.12): https://llms.mui.com/material-ui/6.4.12/components/popover.md (used for anchor behavior, open/close semantics, and placement patterns)
- MUI IconButton API docs (MUI MCP mirror v6.4.12): https://llms.mui.com/material-ui/6.4.12/api/icon-button.md (used for disabled-state behavior and button semantics in command row)
- MUI v6 migration notes: https://mui.com/material-ui/migration/upgrade-to-v6/ (used to confirm compatibility assumptions while using v6-era APIs)
- React Testing Library intro: https://testing-library.com/docs/react-testing-library/intro (used for interaction-level component tests around popover open/close and disabled controls)
- Context7 Jest docs: `/jestjs/jest` (used as MCP source for component-test assertions and mock behavior in this task)

#### Subtasks

1. [ ] Add command-info button UI in command row.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://llms.mui.com/material-ui/6.4.12/api/icon-button.md and https://testing-library.com/docs/react-testing-library/intro
   - Implement exactly: add an `IconButton` in the command controls row, disabled when no command is selected.

2. [ ] Add command-info popover state and rendering.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://llms.mui.com/material-ui/6.4.12/components/popover.md
   - Implement exactly: reuse the existing agent-info popover state pattern (`anchorEl`, `open`, `onClose`) and display selected command description in the popover body.

3. [ ] Add explicit no-selection safety behavior.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
   - Implement exactly: disabled button must not open popover and must not throw runtime errors when clicked by tests.

4. [ ] Add command-info button presence test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test asserting command-info control renders in the command row.
   - Purpose: verify command-info entrypoint is visible in the intended UI location.

5. [ ] Add command-info disabled-without-selection test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test asserting command-info button is disabled when no command is selected.
   - Purpose: verify guard behavior for unselected state.

6. [ ] Add command-info popover open-and-content test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test selecting a command, clicking info button, and asserting description text appears in popover.
   - Purpose: verify happy-path popover behavior and payload rendering.

7. [ ] Add command-info popover-closed-when-no-selection test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test asserting popover does not open when command remains unselected.
   - Purpose: verify no-selection safety behavior.

8. [ ] Add command-info popover close interaction test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test that closes the popover and asserts it is no longer visible.
   - Purpose: verify close lifecycle behavior and user-dismiss flow.

9. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

10. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- React Testing Library intro: https://testing-library.com/docs/react-testing-library/intro (used for rendering and user interaction tests after inline description removal)
- DOM Testing Library query priority guide: https://testing-library.com/docs/queries/about (used to keep assertions user-facing and resilient when checking removed text/UI)
- Jest `expect` assertions: https://jestjs.io/docs/expect (used for negative assertions like “text not present” and control-state regression checks)
- Context7 Jest docs: `/jestjs/jest` (used as MCP source for Jest assertion and regression-test structure in this task)

#### Subtasks

1. [ ] Remove inline command description rendering.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://testing-library.com/docs/react-testing-library/intro
   - Implement exactly: remove the always-visible description block and default placeholder text rendering path.

2. [ ] Ensure removal of legacy placeholder copy.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://testing-library.com/docs/react-testing-library/intro
   - Implement exactly: string `Select a command to see its description.` must not exist anywhere on Agents page.

3. [ ] Add inline-description-removed test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add a test asserting the old inline command description area is not rendered.
   - Purpose: verify UI decluttering requirement is enforced.

4. [ ] Add legacy-placeholder-text-removed test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add a test asserting `Select a command to see its description.` is absent.
   - Purpose: verify explicit acceptance criterion for removed copy.

5. [ ] Add command-list-functional-regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add/keep a test asserting command listing and selection still behave normally after description removal.
   - Purpose: verify removal did not break core command-list interactions.

6. [ ] Add execute-command-enable-disable regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add/keep a test asserting execute-command button enable/disable behavior remains unchanged.
   - Purpose: verify run-control behavior did not regress.

7. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

8. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- React effects synchronization: https://react.dev/learn/synchronizing-with-effects (used for safe discovery lifecycle updates and stale-response guards)
- React controlled input reference: https://react.dev/reference/react-dom/components/input (used for `working_folder` commit behavior and Enter/blur handling)
- React event handling: https://react.dev/learn/responding-to-events (used to prevent unintended form submission from `working_folder` Enter key)
- DOM Testing Library async APIs: https://testing-library.com/docs/dom-testing-library/api-async (used for timing-sensitive lifecycle tests and async state assertions)
- Context7 Jest docs: `/jestjs/jest` (used as MCP source for async Jest test patterns and mock timing control in race-condition tests)

#### Subtasks

1. [ ] Add prompt discovery lifecycle state.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/synchronizing-with-effects and https://react.dev/reference/react-dom/components/input
   - Implement exactly these state values:
     - prompts loading,
     - prompts error,
     - committed `working_folder` value,
     - request sequence id/ref for stale-response protection.

2. [ ] Trigger discovery only on commit events.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/reference/react-dom/components/input
   - Implement exactly: run discovery only on working-folder `blur`, Enter on `working_folder`, and directory picker `onPick`; never on plain keystroke change.

3. [ ] Prevent Enter in `working_folder` from submitting main instruction form.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/responding-to-events
   - Implement exactly: scope this key handling to `working_folder` control only; do not break Enter/newline behavior inside main instruction textarea.

4. [ ] Skip duplicate discovery requests for unchanged committed folder.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/synchronizing-with-effects
   - Implement exactly: if committed folder equals last committed value, do not call API again.

5. [ ] Implement deterministic stale-response guard.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/synchronizing-with-effects
   - Implement exactly: use one monotonic request sequence/ref comparison; only latest request may commit results/error to state.

6. [ ] Add working-folder `blur` trigger test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting discovery starts when working-folder input blurs after a value change.
   - Purpose: verify commit-event trigger behavior for blur.

7. [ ] Add working-folder Enter-key trigger test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting discovery starts when Enter is pressed in working-folder input.
   - Purpose: verify commit-event trigger behavior for Enter.

8. [ ] Add directory-picker selection trigger test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting discovery starts after directory picker selects a folder.
   - Purpose: verify picker-based commit trigger behavior.

9. [ ] Add typing-only does-not-trigger test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting keystrokes without commit do not call prompts discovery API.
   - Purpose: verify no per-keystroke network traffic.

10. [ ] Add unchanged-committed-folder no-duplicate-request test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting committing the same folder value does not issue duplicate discovery request.
   - Purpose: verify request deduplication behavior.

11. [ ] Add latest-response-wins test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a race-condition test where two commits occur and only latest response applies.
   - Purpose: verify stale-response protection core behavior.

12. [ ] Add stale-success-ignored test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test where old success resolves late and is ignored after newer commit.
   - Purpose: verify out-of-order success responses do not overwrite current state.

13. [ ] Add stale-error-does-not-overwrite-latest-success test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test where old error resolves after latest success and ensure success state is retained.
   - Purpose: verify stale error isolation.

14. [ ] Add stale-success-does-not-overwrite-latest-error test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test where old success resolves after latest error and ensure error state is retained.
   - Purpose: verify stale success isolation.

15. [ ] Add Enter-in-working-folder does-not-submit-main-instruction test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting Enter in working-folder commits discovery without triggering instruction send.
   - Purpose: verify Enter key behavior is scoped correctly.

16. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

17. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- MUI Select docs (MUI MCP mirror v6.4.12): https://llms.mui.com/material-ui/6.4.12/components/selects.md (used for dropdown structure, option rendering, and empty-option behavior)
- MUI Button API docs (MUI MCP mirror v6.4.12): https://llms.mui.com/material-ui/6.4.12/api/button.md (used for execute-button disabled/enabled behavior)
- MUI v6 migration notes: https://mui.com/material-ui/migration/upgrade-to-v6/ (used to confirm supported API usage in current major version)
- React conditional rendering: https://react.dev/learn/conditional-rendering (used for prompts-row show/hide behavior across success/error/empty states)
- DOM Testing Library async APIs: https://testing-library.com/docs/dom-testing-library/api-async (used for UI transition assertions after async discovery responses)
- Context7 Jest docs: `/jestjs/jest` (used as MCP source for component-state assertion and mock setup patterns in prompts UI tests)

#### Subtasks

1. [ ] Add prompts list and selected-prompt state.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://llms.mui.com/material-ui/6.4.12/components/selects.md and https://react.dev/reference/react-dom/components/input
   - Implement exactly: track discovered `prompts` and selected prompt key by `fullPath`.

2. [ ] Implement prompts row visibility rules exactly.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/conditional-rendering
   - Implement exactly:
     - show selector + Execute Prompt when prompts exist,
     - show inline error when discovery fails for committed non-empty folder,
     - hide row when committed folder empty or success returns zero prompts.

3. [ ] Implement dropdown option and label behavior.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://llms.mui.com/material-ui/6.4.12/components/selects.md
   - Implement exactly:
     - render labels from `relativePath` only,
     - never render absolute `fullPath` in labels,
     - include explicit empty option `No prompt selected`.

4. [ ] Reset selected prompt on committed folder change.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/synchronizing-with-effects
   - Implement exactly: clear selected prompt immediately when committed folder changes; Execute Prompt stays disabled until new selection.

5. [ ] Enforce Execute Prompt enable/disable rules.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Implement exactly: Execute Prompt enabled only when a valid prompt option is currently selected.

6. [ ] Add prompts-row visibility-split test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test covering three outcomes: prompts present, discovery error, and zero prompts.
   - Purpose: verify conditional rendering contract for prompts row.

7. [ ] Add relative-path-label and empty-option test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting labels use `relativePath` and dropdown contains explicit `No prompt selected` option.
   - Purpose: verify UX labeling and clear-selection affordance.

8. [ ] Add no-absolute-fullPath-label-leak test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting rendered option text never exposes absolute `fullPath`.
   - Purpose: verify path privacy and UI contract safety.

9. [ ] Add prompt-selection-reset-on-folder-change test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test selecting a prompt, changing committed folder, and asserting selection resets.
   - Purpose: verify stale prompt prevention behavior.

10. [ ] Add clear-folder-hides-row-and-clears-error test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting clearing committed folder hides prompts row and removes previous prompts error state.
   - Purpose: verify empty-folder reset behavior.

11. [ ] Add execute-prompt-enable-disable-state test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting Execute Prompt stays disabled without valid selection and enables with valid selection.
   - Purpose: verify action gating behavior.

12. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

13. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- React event handling: https://react.dev/learn/responding-to-events (used for execute-prompt click orchestration and preserving existing UX behavior)
- Fetch API basics: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API (used because execute prompt must reuse existing instruction run API path)
- MUI Button API docs (MUI MCP mirror v6.4.12): https://llms.mui.com/material-ui/6.4.12/api/button.md (used for execute-button interaction and disabled rules)
- MUI v6 migration notes: https://mui.com/material-ui/migration/upgrade-to-v6/ (used to validate v6 compatibility assumptions)
- Jest `expect` assertions: https://jestjs.io/docs/expect (used for exact payload/composition assertions and conflict behavior checks)
- DOM Testing Library async APIs: https://testing-library.com/docs/dom-testing-library/api-async (used for run-start/run-error async UI assertions)
- Context7 Jest docs: `/jestjs/jest` (used as MCP source for payload assertion and conflict-regression Jest patterns in this task)

#### Subtasks

1. [ ] Add Execute Prompt click handler that reuses instruction run orchestration.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/responding-to-events
   - Implement exactly: mirror the same run-start sequence used by existing `handleSubmit`/`handleExecuteCommand` (loading, error reset, run start, response handling).

2. [ ] Compose the instruction payload from canonical preamble text.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://jestjs.io/docs/expect
   - Implement exactly: replace `<full path of markdown file>` with selected prompt `fullPath`; do not alter any other preamble text.

3. [ ] Execute through existing instruction API only.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Implement exactly: call `runAgentInstruction(...)` and pass the committed `working_folder`; do not call command-run endpoint.

4. [ ] Preserve conflict and generic error UX behavior.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/responding-to-events
   - Implement exactly: keep existing `RUN_IN_PROGRESS` handling and generic error messaging behavior unchanged.

5. [ ] Keep Send instruction and Execute command flows unchanged.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/responding-to-events
   - Implement exactly: no behavior changes outside new Execute Prompt path.

6. [ ] Add existing-instruction-conflict regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.run.instructionError.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.instructionError.test.tsx)
   - Description: add/keep explicit assertion that standard instruction path still surfaces `RUN_IN_PROGRESS` with unchanged UX.
   - Purpose: verify prompt work does not alter existing instruction conflict behavior.

7. [ ] Add existing-command-conflict regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsRun.conflict.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsRun.conflict.test.tsx)
   - Description: add/keep explicit assertion that command-run path still surfaces `RUN_IN_PROGRESS` with unchanged UX.
   - Purpose: verify prompt work does not alter existing command conflict behavior.

8. [ ] Add execute-prompt exact-preamble-payload test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting outbound `instruction` exactly matches canonical preamble text with single placeholder replacement.
   - Purpose: verify strict payload contract compliance.

9. [ ] Add execute-prompt `fullPath`-not-`relativePath` replacement test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting selected prompt runtime `fullPath` is injected into instruction text, never `relativePath`.
   - Purpose: verify runtime path correctness.

10. [ ] Add execute-prompt committed-working-folder-forwarding test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting execute prompt forwards committed `working_folder` in run request payload.
   - Purpose: verify run context propagation.

11. [ ] Add execute-prompt button-state test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting Execute Prompt stays disabled without valid prompt selection and enables only when valid.
   - Purpose: verify prompt-run action gating.

12. [ ] Add execute-prompt `409 RUN_IN_PROGRESS` conflict test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting prompt execution conflict surfaces existing conflict UX and does not crash.
   - Purpose: verify conflict-path parity for execute-prompt flow.

13. [ ] Add execute-prompt deleted/moved-file error-flow test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test simulating run failure after prompt selection (file moved/deleted) and assert error appears without crash.
   - Purpose: verify resilience to post-discovery file churn.

14. [ ] Add Send-button-still-uses-instruction-endpoint regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.run.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.test.tsx)
   - Description: add explicit assertion that Send action still calls standard instruction-run endpoint.
   - Purpose: verify non-prompt instruction path remains unchanged.

15. [ ] Add Execute-command-still-uses-command-endpoint regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add explicit assertion that Execute Command action still calls command-run endpoint.
   - Purpose: verify non-prompt command path remains unchanged.

16. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

17. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- Markdown syntax guide: https://www.markdownguide.org/basic-syntax/ (used for consistent project-doc text updates)
- Mermaid sequence diagram syntax: https://mermaid.js.org/syntax/sequenceDiagram.html (used when documenting final API/UI flow diagrams)
- OpenAPI 3.1 specification: https://swagger.io/specification/ (used to verify that final route schema and error mapping documentation match contract format)

#### Subtasks

1. [ ] Update user-facing README behavior notes.
   - Files: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: document command-info popover behavior, prompt discovery preconditions, and Execute Prompt flow.

2. [ ] Update architecture/design notes.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html
   - Implement exactly: document new `GET /agents/{agentName}/prompts` contract and prompt execution interaction with existing `POST /agents/{agentName}/run`.

3. [ ] Update project structure file map.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include all files added/removed during tasks 1-8 and complete this subtask only after all file add/remove subtasks are finished.

4. [ ] Verify OpenAPI is still aligned with implemented code.
   - Files: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Implement exactly: compare final route behavior and schemas to OpenAPI; update only if drift is detected.

5. [ ] Run lint and formatting as the final subtask for this task.
   - Files: repo root commands
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run lint --workspaces` then `npm run format:check --workspaces`.

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

- Docker Compose docs: https://docs.docker.com/compose/ (used for build/up/down validation steps and troubleshooting flow)
- Playwright introduction: https://playwright.dev/docs/intro (used for manual/automated acceptance checks and screenshot evidence guidance)
- Jest getting started: https://jestjs.io/docs/getting-started (used for interpreting client test wrapper outcomes and failure triage)
- Cucumber guides index: https://cucumber.io/docs/guides/ (used as canonical guide index for selecting the correct BDD execution/documentation guidance)
- Cucumber guide (10-minute tutorial subpath): https://cucumber.io/docs/guides/10-minute-tutorial/ (used as canonical Cucumber guide reference for server BDD test expectations)
- Markdown syntax guide: https://www.markdownguide.org/basic-syntax/ (used for final PR summary and documentation consistency)
- Mermaid sequence diagram syntax: https://mermaid.js.org/syntax/sequenceDiagram.html (used when validating diagram updates in final verification)

#### Subtasks

1. [ ] Build the server and verify no compile errors.
   - Files: repo root command run
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run build:summary:server`.

2. [ ] Build the client and verify no compile errors.
   - Files: repo root command run
   - Read first: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
   - Run exactly: `npm run build:summary:client`.

3. [ ] Perform clean docker build and confirm image success.
   - Files: repo root command run
   - Read first: https://docs.docker.com/compose/
   - Run exactly: `npm run compose:build:clean`.

4. [ ] Re-validate final README and design docs against implemented behavior.
   - Files: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://www.markdownguide.org/basic-syntax/ and https://mermaid.js.org/syntax/sequenceDiagram.html
   - Implement exactly: ensure docs fully reflect prompts API, UI behavior, and execution flow.

5. [ ] Re-validate final file map.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: ensure every changed file in this story is represented correctly.

6. [ ] Write final implementation summary for PR use.
   - Files: story notes and commit history
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: summarize server contract changes, client behavior changes, test coverage, and regression outcomes.

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
