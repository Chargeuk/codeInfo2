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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to keep `design.md` Mermaid route-flow diagrams valid while documenting this task)

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
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify happy-path contract payload shape before frontend integration.

6. [ ] Add router invalid `agentName` test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test for missing/blank path param `agentName` returning `400 { error: 'invalid_request' }`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify route parameter guard behavior.

7. [ ] Add router missing/blank/non-string `working_folder` test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test that covers missing, blank, and non-string query values returning `400 invalid_request`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify request-shape validation for required query input.

8. [ ] Add router `working_folder` array/object query-shape test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test where `working_folder` is provided as array/object query forms and assert `400 invalid_request`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify query parser hardening against ambiguous query shapes.

9. [ ] Add router `AGENT_NOT_FOUND` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: mock service throw `{ code: 'AGENT_NOT_FOUND' }` and assert `404 { error: 'not_found' }`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify not-found mapping contract.

10. [ ] Add router `WORKING_FOLDER_INVALID` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: mock service throw `WORKING_FOLDER_INVALID` and assert `400 invalid_request` with code/message.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify invalid-folder error mapping contract.

11. [ ] Add router `WORKING_FOLDER_NOT_FOUND` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: mock service throw `WORKING_FOLDER_NOT_FOUND` and assert `400 invalid_request` with code/message.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify missing-folder error mapping contract.

12. [ ] Add router unknown-error fallback test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: mock service throw generic error and assert `500 { error: 'agent_prompts_failed' }`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify defensive fallback behavior.

13. [ ] Keep existing command-list tests passing in router list test file.
   - Test type: Server unit regression test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: ensure pre-existing `GET /agents/:agentName/commands` tests still pass without behavior drift.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify prompts-route additions do not regress command-list functionality.

14. [ ] Keep command-run route regression tests unchanged/passing.
   - Test type: Server unit regression test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts)
   - Description: run the full existing command-run route suite and keep all current assertions passing exactly as-is; do not weaken/remove/replace assertions and do not add new assertions in this subtask.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify no command-run contract regression.

15. [ ] Keep instruction-run route regression tests unchanged/passing.
   - Test type: Server unit regression test (`node:test`).
   - Location: [server/src/test/unit/agents-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-router-run.test.ts)
   - Description: run the full existing instruction-run route suite and keep all current assertions passing exactly as-is; do not weaken/remove/replace assertions and do not add new assertions in this subtask.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify no instruction-run contract regression.

16. [ ] Add router missing/blank `working_folder` required-message test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test asserting missing and blank `working_folder` return `400 { error: 'invalid_request', message: 'working_folder is required' }`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify exact required-input error message contract.

17. [ ] Add router empty-prompts success-envelope test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts)
   - Description: add a test asserting successful `200` response with `prompts: []` when service returns no prompts.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify success-shape corner case for empty discovery results.

18. [ ] Update OpenAPI contract for prompts discovery.
   - Files: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Implement exactly: add `GET /agents/{agentName}/prompts` with required `working_folder` query, `200` schema `{ prompts: [{ relativePath, fullPath }] }`, and `400`/`404`/`500` error schema mapping.

19. [ ] Add OpenAPI prompts-route contract verification test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/openapi.prompts-route.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.prompts-route.test.ts)
   - Description: create `server/src/test/unit/openapi.prompts-route.test.ts` if it does not already exist, then assert `openapi.json` contains `GET /agents/{agentName}/prompts` with required `working_folder` query parameter and `200`/`400`/`404`/`500` responses.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify OpenAPI contract coverage for the prompts endpoint and prevent documentation drift.

20. [ ] Update design documentation for router contract and error flow.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: add/update `GET /agents/{agentName}/prompts` router validation/error-mapping notes and include a Mermaid sequence diagram showing request validation, service call, and status-code outcomes.

21. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md, including `server/src/test/unit/openapi.prompts-route.test.ts` when created. Complete this subtask only after all add/remove-file subtasks in this task are finished.

22. [ ] Add prompts-route observability log lines for manual verification.
   - Files: [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts)
   - Implement exactly: emit structured logs with these exact prefixes:
     - `[agents.prompts.route.request] agentName=<agentName> workingFolder=<working_folder>` before calling `listAgentPrompts(...)`.
     - `[agents.prompts.route.success] agentName=<agentName> promptsCount=<count>` on `200` responses.
     - `[agents.prompts.route.error] agentName=<agentName> status=<status> code=<code|none>` on mapped `4xx/5xx` responses.
   - Purpose: provide deterministic route-level traces that can be asserted during manual Playwright-MCP checks.

23. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
4. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [ ] `npm run compose:up`
6. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, trigger one prompts discovery request (via UI if available, otherwise run browser-console `fetch` against `/agents/<agentName>/prompts?working_folder=<path>`), then run `npm run compose:logs` and confirm logs contain `[agents.prompts.route.request]` followed by either `[agents.prompts.route.success]` (success with prompts count) or `[agents.prompts.route.error]` (mapped failure status/code). Expected outcome: one terminal route result log per request and no browser debug-console errors.
7. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to keep `design.md` Mermaid discovery-flow diagrams valid while documenting this task)

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
     - reuse the existing recursive traversal pattern already used in [server/src/ingest/discovery.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/discovery.ts) (`walkDir`) as the baseline structure, then adapt it for prompt-specific filtering/safety rules,
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
   - Implement exactly: compute `relativePath` from prompts root, normalize separators to `/`, verify path is inside prompts root, then sort ascending by normalized `relativePath` using the same `localeCompare` comparator style already used in [server/src/ingest/deltaPlan.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/deltaPlan.ts) and [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts).

6. [ ] Add service `AGENT_NOT_FOUND` test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: create `server/src/test/unit/agent-prompts-list.test.ts` if it does not already exist, then add a test where unknown `agentName` is passed and assert `AGENT_NOT_FOUND`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify agent existence guard behavior.

7. [ ] Add service `WORKING_FOLDER_INVALID` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: mock/trigger invalid working folder and assert service throws `WORKING_FOLDER_INVALID`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify invalid-path validation behavior.

8. [ ] Add service `WORKING_FOLDER_NOT_FOUND` mapping test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: mock/trigger missing working folder and assert service throws `WORKING_FOLDER_NOT_FOUND`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify missing-path validation behavior.

9. [ ] Add case-insensitive `.github/prompts` detection test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: add fixture with mixed-case folder segments and assert prompt discovery still succeeds.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify required case-insensitive folder matching.

10. [ ] Add recursive prompt discovery test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: add nested prompt files and assert all nested markdown files are returned.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify recursive traversal behavior.

11. [ ] Add markdown-extension inclusion/exclusion test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: assert `.md`, `.MD`, and `*.prompt.md` are included while non-markdown files are excluded.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify extension filtering rules.

12. [ ] Add symlink-ignore test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: include symlink entries in fixture and assert they are ignored.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify traversal safety and loop prevention.

13. [ ] Add deterministic sort-order test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: provide unsorted fixture names and assert ascending normalized `relativePath` order in output.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify stable deterministic API output ordering.

14. [ ] Add forward-slash `relativePath` normalization test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: add a test asserting every returned `relativePath` uses forward slashes (`/`) and never backslashes.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify API contract requirement for normalized `relativePath` separators.

15. [ ] Add output-shape safety test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: assert each prompt has absolute `fullPath` and `relativePath` is never absolute and never starts with `..`.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify path safety and contract correctness.

16. [ ] Add zero-results-when-prompts-dir-missing test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: assert service returns `{ prompts: [] }` when `.github/prompts` is absent.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify non-error empty-state behavior for missing prompts root.

17. [ ] Add zero-results-when-prompts-dir-has-no-markdown test.
   - Test type: Server unit test (`node:test`).
   - Location: [server/src/test/unit/agent-prompts-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-prompts-list.test.ts)
   - Description: assert service returns `{ prompts: [] }` when prompts directory exists but contains no markdown files.
   - Read first: https://nodejs.org/api/test.html
   - Purpose: verify non-error empty-state behavior for non-markdown-only trees.

18. [ ] Update design documentation for prompt-discovery service flow.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/flowchart.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: add/update service-layer discovery notes for case-insensitive `.github/prompts` lookup, recursive markdown filtering, symlink-ignore behavior, and include a Mermaid flowchart/sequence diagram for traversal and result shaping.

19. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md, including `server/src/test/unit/agent-prompts-list.test.ts` and any new prompt-discovery fixtures created for these tests. Complete this subtask only after all add/remove-file subtasks in this task are finished.

20. [ ] Add prompt-discovery service observability log lines for manual verification.
   - Files: [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts)
   - Implement exactly: emit structured logs with these exact prefixes:
     - `[agents.prompts.discovery.start] agentName=<agentName> workingFolder=<resolvedWorkingFolder>` at discovery start.
     - `[agents.prompts.discovery.complete] promptsRoot=<resolvedPromptsRoot> promptsCount=<count>` when discovery succeeds.
     - `[agents.prompts.discovery.empty] reason=<prompts_dir_missing_or_no_markdown>` when returning zero results for missing/no-markdown trees.
   - Purpose: provide deterministic discovery lifecycle traces for manual Playwright-MCP validation.

21. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
4. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [ ] `npm run compose:up`
6. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, trigger prompt discovery for a folder with prompts and a folder without prompts, then run `npm run compose:logs` and confirm `[agents.prompts.discovery.start]` then `[agents.prompts.discovery.complete]` for populated folders and `[agents.prompts.discovery.empty] reason=prompts_dir_missing_or_no_markdown` for empty/missing trees. Expected outcome: logged prompt counts match UI-visible results and no browser debug-console errors.
7. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to keep `design.md` Mermaid API-call diagrams valid while documenting this task)

#### Subtasks

1. [ ] Add `listAgentPrompts(...)` API method.
   - Files: [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API and https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   - Implement exactly:
     - endpoint `GET /agents/:agentName/prompts?working_folder=...`,
     - return type `{ prompts: Array<{ relativePath: string; fullPath: string }> }`.
   - Reuse existing URL base and `encodeURIComponent(agentName)` style in the same file, and reuse the query-string construction pattern already used in [client/src/components/ingest/ingestDirsApi.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/components/ingest/ingestDirsApi.ts) (`URLSearchParams`) to avoid bespoke encoding logic.

2. [ ] Reuse existing API error parsing behavior.
   - Files: [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
   - Implement exactly: call existing non-2xx parser and `throwAgentApiError(...)` so status/code/message handling remains consistent with other agents APIs.

3. [ ] Add API URL-path construction test for prompts endpoint.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: create `client/src/test/agentsApi.promptsList.test.ts` if it does not already exist, then add a test asserting the request uses `GET /agents/:agentName/prompts` with the correct path structure.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify endpoint routing correctness in client API layer.

4. [ ] Add API `working_folder` query-encoding test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting `working_folder` is URL encoded correctly for spaces/slashes/backslashes.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify query encoding safety and cross-platform path support.

5. [ ] Add API success payload parsing test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting successful response parses into typed `{ prompts }` output.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify happy-path response handling in API client.

6. [ ] Add API JSON error parsing test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting JSON error responses surface `error`, `code`, and `message` through `AgentApiError`.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify structured error propagation.

7. [ ] Add API non-JSON error fallback test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting non-JSON responses produce stable fallback error values.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify robust error behavior for malformed responses.

8. [ ] Add API network rejection handling test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test where fetch rejects and assert promise rejection maps to stable client error behavior.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify transport-layer failure handling.

9. [ ] Add API `400 invalid_request` mapping test for prompts endpoint.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting missing/invalid `working_folder` server responses map to expected error code/message fields.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify contract-level error mapping for required query validation.

10. [ ] Add API `404 not_found` mapping test for unknown agent.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting `404 { error: 'not_found' }` is propagated through `AgentApiError` as expected.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify unknown-agent error mapping for prompts endpoint.

11. [ ] Add API `500 agent_prompts_failed` mapping test.
   - Test type: Client unit test (Jest).
   - Location: [client/src/test/agentsApi.promptsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.promptsList.test.ts)
   - Description: add a test asserting `500 { error: 'agent_prompts_failed' }` is propagated through `AgentApiError` as expected.
   - Read first: https://jestjs.io/docs/expect and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify server-failure error mapping for prompts endpoint.

12. [ ] Update design documentation for client prompt-list API flow.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: add/update API-client contract notes for `listAgentPrompts(...)` and include a Mermaid sequence diagram covering client call, query encoding, and error propagation back to UI state.

13. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md, including `client/src/test/agentsApi.promptsList.test.ts` when created. Complete this subtask only after all add/remove-file subtasks in this task are finished.

14. [ ] Add client API observability log lines for prompts-list requests.
   - Files: [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts)
   - Implement exactly: emit browser debug logs with these exact prefixes:
     - `[agents.prompts.api.request] agentName=<agentName> workingFolder=<working_folder>` before `fetch`.
     - `[agents.prompts.api.success] agentName=<agentName> promptsCount=<count>` on successful parse.
     - `[agents.prompts.api.error] agentName=<agentName> status=<status|none> code=<code|none>` on rejected responses/errors.
   - Purpose: allow Manual Playwright-MCP checks to confirm request/response/error events fire in the expected sequence.

15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, commit `working_folder`, and verify browser debug console shows `[agents.prompts.api.request]` followed by `[agents.prompts.api.success]` for success; force one failure path and verify `[agents.prompts.api.error]` includes status/code fields. Capture screenshots `0000039-task3-prompts-api-success.png` and `0000039-task3-prompts-api-error.png`, store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped within `docker-compose.local.yml`), and review them with the agent to confirm the GUI success/error states match this task’s expectations. Expected outcome: each request emits exactly one request log plus one success/error log, screenshots confirm expected UI states, and no unrelated console errors.
6. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to keep `design.md` Mermaid UI-interaction diagrams valid while documenting this task)

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
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify command-info entrypoint is visible in the intended UI location.

5. [ ] Add command-info disabled-without-selection test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test asserting command-info button is disabled when no command is selected.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify guard behavior for unselected state.

6. [ ] Add command-info popover open-and-content test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test selecting a command, clicking info button, and asserting description text appears in popover.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify happy-path popover behavior and payload rendering.

7. [ ] Add command-info popover-closed-when-no-selection test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test asserting popover does not open when command remains unselected.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify no-selection safety behavior.

8. [ ] Add command-info popover close interaction test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.descriptionPopover.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.descriptionPopover.test.tsx)
   - Description: add a test that closes the popover and asserts it is no longer visible.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify close lifecycle behavior and user-dismiss flow.

9. [ ] Update design documentation for command-info popover flow.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: add/update command-info interaction notes and include a Mermaid sequence diagram showing command selection, info-button enablement, popover open, and close flow.

10. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

11. [ ] Add command-info popover interaction log lines.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Implement exactly: emit browser debug logs with these exact prefixes:
     - `[agents.commandInfo.blocked] reason=no_command_selected` when info button is triggered while disabled/no selection.
     - `[agents.commandInfo.open] commandName=<selectedCommandName>` when popover opens.
   - Purpose: verify command-info guard and open behavior in Manual Playwright-MCP checks.

12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, click command-info with no command selected and verify `[agents.commandInfo.blocked] reason=no_command_selected`; then select a command and click command-info to verify `[agents.commandInfo.open] commandName=<selectedCommandName>`. Capture screenshots `0000039-task4-command-info-disabled.png` and `0000039-task4-command-info-popover-open.png`, store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped within `docker-compose.local.yml`), and review them with the agent to confirm disabled and open-popover GUI states match this task’s expectations. Expected outcome: blocked case does not open popover, selected-command case opens popover with matching description, screenshots confirm expected states, and no browser debug-console errors.
6. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to keep `design.md` Mermaid UI-flow diagrams valid while documenting this task)

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
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify UI decluttering requirement is enforced.

4. [ ] Add legacy-placeholder-text-removed test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add a test asserting `Select a command to see its description.` is absent.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify explicit acceptance criterion for removed copy.

5. [ ] Add command-list-functional-regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add/keep a test asserting command listing and selection still behave normally after description removal.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify removal did not break core command-list interactions.

6. [ ] Add execute-command-enable-disable regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add/keep a test asserting execute-command button enable/disable behavior remains unchanged.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify run-control behavior did not regress.

7. [ ] Update design documentation for command-description flow removal.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: update architecture notes to remove legacy inline-description flow and include a Mermaid sequence diagram that reflects info-popover-only command-description access.

8. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md. Complete this subtask only after all add/remove-file subtasks in this task are finished.

9. [ ] Add command-description presentation mode log lines.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Implement exactly: emit browser debug logs with these exact prefixes:
     - `[agents.commandDescription.inlineRemoved] rendered=false` on page render to confirm inline block is removed.
     - `[agents.commandDescription.source] mode=popover commandName=<selectedCommandName|none>` when description source state changes.
   - Purpose: provide observable evidence that description rendering moved entirely to popover mode.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, select and change commands, and verify browser debug console includes `[agents.commandDescription.inlineRemoved] rendered=false` and `[agents.commandDescription.source] mode=popover ...`. Capture screenshots `0000039-task5-no-inline-description.png` and `0000039-task5-popover-description-only.png`, store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped within `docker-compose.local.yml`), and review them with the agent to confirm the inline block/default text is absent and popover is the only description UI. Expected outcome: inline description/default text never appears in UI, popover is the only description surface, screenshots confirm expected states, and no browser debug-console errors.
6. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to keep `design.md` Mermaid request-lifecycle diagrams valid while documenting this task)

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
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify commit-event trigger behavior for blur.

7. [ ] Add working-folder Enter-key trigger test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting discovery starts when Enter is pressed in working-folder input.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify commit-event trigger behavior for Enter.

8. [ ] Add directory-picker selection trigger test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting discovery starts after directory picker selects a folder.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify picker-based commit trigger behavior.

9. [ ] Add typing-only does-not-trigger test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting keystrokes without commit do not call prompts discovery API.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify no per-keystroke network traffic.

10. [ ] Add unchanged-committed-folder no-duplicate-request test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting committing the same folder value does not issue duplicate discovery request.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify request deduplication behavior.

11. [ ] Add empty-committed-folder no-request test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.workingFolderPicker.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.workingFolderPicker.test.tsx)
   - Description: add a test asserting committing an empty `working_folder` does not call the prompts discovery API.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify non-empty commit precondition for discovery requests.

12. [ ] Add latest-response-wins test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: create `client/src/test/agentsPage.promptsDiscovery.test.tsx` if it does not already exist, then add a race-condition test where two commits occur and only latest response applies.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify stale-response protection core behavior.

13. [ ] Add stale-success-ignored test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test where old success resolves late and is ignored after newer commit.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify out-of-order success responses do not overwrite current state.

14. [ ] Add stale-error-does-not-overwrite-latest-success test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test where old error resolves after latest success and ensure success state is retained.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify stale error isolation.

15. [ ] Add stale-success-does-not-overwrite-latest-error test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test where old success resolves after latest error and ensure error state is retained.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify stale success isolation.

16. [ ] Add Enter-in-working-folder does-not-submit-main-instruction test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting Enter in working-folder commits discovery without triggering instruction send.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify Enter key behavior is scoped correctly.

17. [ ] Update design documentation for prompt-discovery request lifecycle.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: add/update lifecycle notes for commit-only discovery triggers, Enter-key behavior, and stale-response guard; include a Mermaid sequence diagram that shows latest-response-wins behavior.

18. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md, including `client/src/test/agentsPage.promptsDiscovery.test.tsx` when created. Complete this subtask only after all add/remove-file subtasks in this task are finished.

19. [ ] Add prompt-discovery request lifecycle log lines.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Implement exactly: emit browser debug logs with these exact prefixes:
     - `[agents.prompts.discovery.commit] source=<blur|enter|picker> workingFolder=<committedWorkingFolder>` on commit events.
     - `[agents.prompts.discovery.request.start] requestId=<requestId> workingFolder=<committedWorkingFolder>` when request begins.
     - `[agents.prompts.discovery.request.stale_ignored] requestId=<requestId> workingFolder=<staleWorkingFolder>` when older responses are ignored.
   - Purpose: verify commit-only triggering and stale-response guard behavior during Manual Playwright-MCP checks.

20. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, trigger `working_folder` commits via blur, Enter, and picker, then quickly switch folders to force stale responses. Verify `[agents.prompts.discovery.commit]`, `[agents.prompts.discovery.request.start]`, and `[agents.prompts.discovery.request.stale_ignored]` appear with matching sources/request ids. Capture screenshots `0000039-task6-before-stale-switch.png` and `0000039-task6-after-stale-switch-latest-folder-wins.png`, store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped within `docker-compose.local.yml`), and review them with the agent to confirm GUI state reflects only the latest committed folder. Expected outcome: only latest committed folder drives UI state, screenshots confirm stale-response protection in visible UI, and no browser debug-console errors.
6. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to keep `design.md` Mermaid UI-state diagrams valid while documenting this task)

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
   - Description: create `client/src/test/agentsPage.promptsDiscovery.test.tsx` if it does not already exist, then add a test covering three outcomes: prompts present, discovery error, and zero prompts.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify conditional rendering contract for prompts row.

7. [ ] Add relative-path-label and empty-option test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting labels use `relativePath` and dropdown contains explicit `No prompt selected` option.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify UX labeling and clear-selection affordance.

8. [ ] Add no-absolute-fullPath-label-leak test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting rendered option text never exposes absolute `fullPath`.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify path privacy and UI contract safety.

9. [ ] Add prompt-selection-reset-on-folder-change test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test selecting a prompt, changing committed folder, and asserting selection resets.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify stale prompt prevention behavior.

10. [ ] Add clear-folder-hides-row-and-clears-error test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting clearing committed folder hides prompts row and removes previous prompts error state.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify empty-folder reset behavior.

11. [ ] Add execute-prompt-enable-disable-state test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test asserting Execute Prompt stays disabled without valid selection and enables with valid selection.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify action gating behavior.

12. [ ] Add empty-option-clear-after-selection test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.promptsDiscovery.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.promptsDiscovery.test.tsx)
   - Description: add a test selecting a valid prompt, then selecting `No prompt selected`, and asserting Execute Prompt becomes disabled again.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify clear-selection behavior required by explicit empty dropdown option.

13. [ ] Update design documentation for prompts-row state transitions.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: add/update prompts visibility and selection-reset rules and include a Mermaid diagram that captures show/hide/error/empty and selection-reset transitions.

14. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md, including `client/src/test/agentsPage.promptsDiscovery.test.tsx` when this task creates it. Complete this subtask only after all add/remove-file subtasks in this task are finished.

15. [ ] Add prompts-selector state-transition log lines.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Implement exactly: emit browser debug logs with these exact prefixes:
     - `[agents.prompts.selector.visible] promptCount=<count> workingFolder=<committedWorkingFolder>` when selector row is shown.
     - `[agents.prompts.selector.hidden] reason=<empty_working_folder|discovery_zero_results|discovery_error>` when selector row is hidden.
     - `[agents.prompts.selection.changed] relativePath=<relativePath|none>` when user selects or clears a prompt.
   - Purpose: provide explicit observable state transitions for prompt selector visibility and selection changes.

16. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, exercise prompt discovery success/zero-result/error states and prompt selection/clear actions. Verify `[agents.prompts.selector.visible]`, `[agents.prompts.selector.hidden]`, and `[agents.prompts.selection.changed]` logs match the rendered UI state. Capture screenshots `0000039-task7-selector-visible.png`, `0000039-task7-selector-hidden-zero-results.png`, and `0000039-task7-selector-error-state.png`, store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped within `docker-compose.local.yml`), and review them with the agent to confirm selector visibility/error behavior matches this task’s expectations. Expected outcome: visibility/selection logs map 1:1 to UI transitions, screenshots confirm each selector state, and no browser debug-console errors.
6. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to keep `design.md` Mermaid execution-flow diagrams valid while documenting this task)

#### Subtasks

1. [ ] Add Execute Prompt click handler that reuses instruction run orchestration.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://react.dev/learn/responding-to-events
   - Implement exactly: mirror the same run-start sequence used by existing `handleSubmit`/`handleExecuteCommand` (loading, error reset, run start, response handling).

2. [ ] Compose the instruction payload from canonical preamble text.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Read first: https://jestjs.io/docs/expect
   - Implement exactly: use this exact preamble string and replace only `<full path of markdown file>` with selected prompt `fullPath`; do not alter any other characters/spacing/punctuation:
     ```text
     Please read the following markdown file. It is designed as a persona you MUST assume. You MUST follow all the instructions within the markdown file including providing the user with the option of selecting the next path to follow once the work of the markdown file is complete, and then loading that new file to continue. You must stay friendly and helpful at all times, ensuring you communicate with the user in an easy to follow way, providing examples to illustrate your point and guiding them through the more complex scenarios. Try to do as much of the heavy lifting as you can using the various mcp tools at your disposal. Here is the file: <full path of markdown file>
     ```
   - Placeholder replacement rule for this subtask: `<full path of markdown file>` -> selected prompt runtime/container `fullPath` returned by `GET /agents/:agentName/prompts`.

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
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify prompt work does not alter existing instruction conflict behavior.

7. [ ] Add existing-command-conflict regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsRun.conflict.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsRun.conflict.test.tsx)
   - Description: add/keep explicit assertion that command-run path still surfaces `RUN_IN_PROGRESS` with unchanged UX.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify prompt work does not alter existing command conflict behavior.

8. [ ] Add execute-prompt exact-preamble-payload test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: create `client/src/test/agentsPage.executePrompt.test.tsx` if it does not already exist, then add a test asserting outbound `instruction` exactly equals the following text with only `<full path of markdown file>` replaced by selected runtime/container `fullPath`:
     ```text
     Please read the following markdown file. It is designed as a persona you MUST assume. You MUST follow all the instructions within the markdown file including providing the user with the option of selecting the next path to follow once the work of the markdown file is complete, and then loading that new file to continue. You must stay friendly and helpful at all times, ensuring you communicate with the user in an easy to follow way, providing examples to illustrate your point and guiding them through the more complex scenarios. Try to do as much of the heavy lifting as you can using the various mcp tools at your disposal. Here is the file: <full path of markdown file>
     ```
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify strict payload contract compliance.

9. [ ] Add execute-prompt `fullPath`-not-`relativePath` replacement test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting selected prompt runtime `fullPath` is injected into instruction text, never `relativePath`.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify runtime path correctness.

10. [ ] Add execute-prompt committed-working-folder-forwarding test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting execute prompt forwards committed `working_folder` in run request payload.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify run context propagation.

11. [ ] Add execute-prompt button-state test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting Execute Prompt stays disabled without valid prompt selection and enables only when valid.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify prompt-run action gating.

12. [ ] Add execute-prompt `409 RUN_IN_PROGRESS` conflict test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test asserting prompt execution conflict surfaces existing conflict UX and does not crash.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify conflict-path parity for execute-prompt flow.

13. [ ] Add execute-prompt deleted/moved-file error-flow test.
   - Test type: Client component unit test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.executePrompt.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.executePrompt.test.tsx)
   - Description: add a test simulating run failure after prompt selection (file moved/deleted) and assert error appears without crash.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify resilience to post-discovery file churn.

14. [ ] Add Send-button-still-uses-instruction-endpoint regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.run.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.test.tsx)
   - Description: add explicit assertion that Send action still calls standard instruction-run endpoint.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify non-prompt instruction path remains unchanged.

15. [ ] Add Execute-command-still-uses-command-endpoint regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - Description: add explicit assertion that Execute Command action still calls command-run endpoint.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify non-prompt command path remains unchanged.

16. [ ] Add existing-run conversation-reuse/new-conversation regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.run.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.test.tsx)
   - Description: add/keep explicit assertions that standard instruction run still reuses active conversation when present and still creates a new conversation when no active conversation exists.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify unchanged conversation lifecycle behavior after Execute Prompt additions.

17. [ ] Add existing-run state-transition regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.run.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.test.tsx)
   - Description: add/keep explicit assertions that standard run transitions still progress through loading/start/success-or-error states exactly as before.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify unchanged run state machine behavior after Execute Prompt additions.

18. [ ] Add existing transcript-streaming regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.streaming.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.streaming.test.tsx)
   - Description: add/keep explicit assertions that websocket transcript streaming updates still render correctly for non-prompt runs.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify unchanged transcript streaming behavior after Execute Prompt additions.

19. [ ] Add existing-instruction generic-error regression test.
   - Test type: Client component unit regression test (React Testing Library + Jest).
   - Location: [client/src/test/agentsPage.run.instructionError.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.instructionError.test.tsx)
   - Description: add/keep explicit assertions that non-conflict instruction-run failures still surface the existing generic error UX and recovery behavior.
   - Read first: https://testing-library.com/docs/react-testing-library/intro, https://jestjs.io/docs/expect, and Context7 Jest docs `/jestjs/jest`
   - Purpose: verify unchanged instruction error handling behavior after Execute Prompt additions.

20. [ ] Update design documentation for Execute Prompt run flow.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: add/update Execute Prompt orchestration notes and include a Mermaid sequence diagram covering payload composition, call to `POST /agents/{agentName}/run`, and conflict/error handling.

21. [ ] Update structure docs only if files changed.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include every file/folder added or removed by this task in projectStructure.md, including `client/src/test/agentsPage.executePrompt.test.tsx` when created. Complete this subtask only after all add/remove-file subtasks in this task are finished.

22. [ ] Add execute-prompt orchestration log lines.
   - Files: [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx)
   - Implement exactly: emit browser debug logs with these exact prefixes:
     - `[agents.prompts.execute.clicked] relativePath=<relativePath> fullPath=<fullPath>` when Execute Prompt is clicked.
     - `[agents.prompts.execute.payload_built] instructionHasFullPath=<true|false>` after composing the canonical preamble.
     - `[agents.prompts.execute.result] status=<started|error> code=<code|none>` after run request result is known.
   - Purpose: verify Execute Prompt payload composition and run-result handling via Manual Playwright-MCP checks.

23. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
4. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [ ] `npm run compose:up`
6. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, select a prompt, click Execute Prompt, and cover both success and error/conflict paths. Verify `[agents.prompts.execute.clicked]`, `[agents.prompts.execute.payload_built] instructionHasFullPath=true`, and `[agents.prompts.execute.result] status=<started|error> code=<...>`. Capture screenshots `0000039-task8-execute-enabled.png`, `0000039-task8-execute-running-or-success.png`, and `0000039-task8-execute-conflict-or-error.png`, store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped within `docker-compose.local.yml`), and review them with the agent to confirm Execute Prompt UX and error handling match this task’s expectations. Expected outcome: execution uses full path in payload, instruction endpoint is used, screenshots confirm success and failure/conflict GUI behavior, and no browser debug-console errors.
7. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to verify Mermaid syntax and diagram features while updating `design.md`)
- OpenAPI 3.1 specification: https://swagger.io/specification/ (used to verify that final route schema and error mapping documentation match contract format)

#### Subtasks

1. [ ] Update user-facing README behavior notes.
   - Files: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: document command-info popover behavior, prompt discovery preconditions, and Execute Prompt flow.

2. [ ] Update architecture/design notes.
   - Files: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`
   - Implement exactly: document new `GET /agents/{agentName}/prompts` contract and prompt execution interaction with existing `POST /agents/{agentName}/run`, and include/update Mermaid diagrams for both discovery and execution flows.

3. [ ] Update project structure file map.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: include all files added/removed during tasks 1-8, including `server/src/test/unit/openapi.prompts-route.test.ts`, `server/src/test/unit/agent-prompts-list.test.ts`, `client/src/test/agentsApi.promptsList.test.ts`, `client/src/test/agentsPage.promptsDiscovery.test.tsx`, `client/src/test/agentsPage.executePrompt.test.tsx`, plus any prompt-discovery fixtures created by Task 2; complete this subtask only after all file add/remove subtasks are finished.

4. [ ] Verify OpenAPI is still aligned with implemented code.
   - Files: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json)
   - Read first: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   - Implement exactly: compare final route behavior and schemas to OpenAPI; update only if drift is detected.

5. [ ] Add a manual-log verification matrix to story-facing docs.
   - Files: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Implement exactly: add a section listing these exact log prefixes and their expected outcomes:
     - `[agents.prompts.route.request]`, `[agents.prompts.route.success]`, `[agents.prompts.route.error]`
     - `[agents.prompts.discovery.start]`, `[agents.prompts.discovery.complete]`, `[agents.prompts.discovery.empty]`
     - `[agents.prompts.api.request]`, `[agents.prompts.api.success]`, `[agents.prompts.api.error]`
     - `[agents.commandInfo.open]`, `[agents.commandInfo.blocked]`
     - `[agents.prompts.discovery.commit]`, `[agents.prompts.discovery.request.start]`, `[agents.prompts.discovery.request.stale_ignored]`
     - `[agents.prompts.selector.visible]`, `[agents.prompts.selector.hidden]`, `[agents.prompts.selection.changed]`
     - `[agents.prompts.execute.clicked]`, `[agents.prompts.execute.payload_built]`, `[agents.prompts.execute.result]`
   - Purpose: make manual Playwright-MCP verification criteria explicit and reusable for junior developers.

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001`, run one complete discovery-and-execute flow, and verify runtime logs match the documentation matrix exactly for route/discovery/api/commandInfo/selector/execute prefixes. Expected outcome: documented log catalog and runtime logs are aligned with no browser debug-console errors.
6. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

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
- Context7 Jest docs: `/jestjs/jest` (used as MCP source for Jest assertion and test-run interpretation patterns during final verification)
- Cucumber guides index: https://cucumber.io/docs/guides/ (used as canonical guide index for selecting the correct BDD execution/documentation guidance)
- Cucumber guide (10-minute tutorial subpath): https://cucumber.io/docs/guides/10-minute-tutorial/ (used as canonical Cucumber guide reference for server BDD test expectations)
- Markdown syntax guide: https://www.markdownguide.org/basic-syntax/ (used for final PR summary and documentation consistency)
- Mermaid sequence diagram syntax: https://mermaid.js.org/syntax/sequenceDiagram.html (used when validating diagram updates in final verification)
- Context7 Mermaid docs: `/mermaid-js/mermaid` (used to validate final Mermaid diagram syntax in `design.md` during verification)

#### Subtasks

1. [ ] Re-validate final `README.md` against implemented behavior.
   - Document name: `README.md`
   - Location: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
   - Description: verify user-facing behavior notes match implementation, including command-info popover behavior, prompt discovery conditions, and Execute Prompt usage flow.
   - Purpose: ensure end-user documentation is accurate and complete for the delivered feature.
   - Read first: https://www.markdownguide.org/basic-syntax/

2. [ ] Re-validate final `design.md` architecture and Mermaid diagrams against implemented behavior.
   - Document name: `design.md`
   - Location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - Description: verify architecture notes and Mermaid diagrams match the implemented prompts discovery and execution flow, including route contracts and error handling paths.
   - Purpose: ensure technical design documentation remains a reliable source for implementation and maintenance decisions.
   - Read first: https://mermaid.js.org/syntax/sequenceDiagram.html and Context7 Mermaid docs `/mermaid-js/mermaid`

3. [ ] Re-validate final file map.
   - Files: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: ensure every changed file in this story is represented correctly.

4. [ ] Write final implementation summary for PR use.
   - Files: story notes and commit history
   - Read first: https://www.markdownguide.org/basic-syntax/
   - Implement exactly: summarize server contract changes, client behavior changes, test coverage, and regression outcomes.

5. [ ] Add final regression evidence checklist for required story log lines.
   - Files: [planning/0000039-agents-command-info-and-working-folder-prompts.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000039-agents-command-info-and-working-folder-prompts.md)
   - Implement exactly: in Task 10 implementation notes, add a checklist entry confirming manual verification captured expected outcomes for these exact prefixes: `[agents.prompts.route.request]`, `[agents.prompts.route.success]`, `[agents.prompts.route.error]`, `[agents.prompts.discovery.start]`, `[agents.prompts.discovery.complete]`, `[agents.prompts.discovery.empty]`, `[agents.prompts.api.request]`, `[agents.prompts.api.success]`, `[agents.prompts.api.error]`, `[agents.commandInfo.open]`, `[agents.commandInfo.blocked]`, `[agents.prompts.selector.visible]`, `[agents.prompts.selector.hidden]`, `[agents.prompts.selection.changed]`, `[agents.prompts.execute.clicked]`, `[agents.prompts.execute.payload_built]`, and `[agents.prompts.execute.result]`.
   - Purpose: ensure final regression sign-off explicitly includes runtime event-log validation evidence.

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without using the wrapper commands listed below.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [ ] `npm run compose:up`
9. [ ] Manual Playwright-MCP check: open Agents page at `http://host.docker.internal:5001` and execute end-to-end happy path plus representative failures. Verify all required story log prefixes appear (`[agents.prompts.route.*]`, `[agents.prompts.discovery.*]`, `[agents.prompts.api.*]`, `[agents.commandInfo.*]`, `[agents.prompts.selector.*]`, `[agents.prompts.execute.*]`) with outcomes matching acceptance criteria. Capture and store screenshots in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped within `docker-compose.local.yml`) for every GUI-verifiable acceptance item, at minimum: `0000039-final-command-info-disabled.png`, `0000039-final-command-info-open.png`, `0000039-final-no-inline-description.png`, `0000039-final-prompts-visible.png`, `0000039-final-prompts-zero-results-hidden-or-empty-state.png`, `0000039-final-prompts-error-state.png`, `0000039-final-execute-prompt-enabled.png`, `0000039-final-execute-prompt-running-or-success.png`, and `0000039-final-execute-prompt-conflict-or-error.png`. Review each screenshot with the agent and cross-check against acceptance criteria before sign-off. Expected outcome: complete log evidence captured, screenshots confirm all GUI acceptance criteria that can be visually validated, and no browser debug-console errors.
10. [ ] `npm run compose:down`

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Pending implementation.
