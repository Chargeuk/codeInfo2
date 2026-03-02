# Story 0000039 – Agents Command Info Popover and Working-Folder Prompts

## Implementation Plan

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
   - manual input `Enter`,
   - directory picker selection.
7. Prompt discovery does not run on every keystroke while the user is typing in `working_folder`.
8. The prompts UI row is shown only when all conditions are true:
   - committed `working_folder` is non-empty,
   - a `.github/prompts` directory exists under the selected folder (case-insensitive match for `.github` and `prompts` segments),
   - at least one markdown file exists under that directory tree.
9. Prompt discovery endpoint contract is explicitly defined and implemented as:
   - `GET /agents/:agentName/prompts?working_folder=<absolute path>`
   - success `200` response body: `{ prompts: Array<{ relativePath: string; fullPath: string }> }`
   - `relativePath` uses forward slashes (`/`) and is relative to `.github/prompts/`
   - `fullPath` is the resolved runtime/container absolute path returned by the server.
10. Prompt discovery request validation/error mapping follows existing Agents route conventions:
    - invalid/missing `agentName` -> `400 { error: 'invalid_request' }`
    - invalid `working_folder` shape/path -> `400 { error: 'invalid_request', code: 'WORKING_FOLDER_INVALID', ... }`
    - unresolved/non-existent `working_folder` -> `400 { error: 'invalid_request', code: 'WORKING_FOLDER_NOT_FOUND', ... }`
    - agent not found -> `404 { error: 'not_found' }`
    - unexpected failures -> `500` with existing route-level server error pattern.
11. Prompt discovery is recursive below `.github/prompts`, includes markdown files with case-insensitive extension handling (`.md`, `.MD`, including names like `foo.prompt.md`), and excludes non-markdown files.
12. Prompt discovery output is deterministic: prompt entries are sorted ascending by normalized `relativePath` before returning to the client.
13. Symlink safety is defined: discovery does not follow symlink directories/files when walking prompt trees, preventing traversal loops and cross-root escapes.
14. Prompt option labels are relative paths from `.github/prompts/` (for example, `onboarding/start.md`), never absolute host/runtime paths.
15. The prompts dropdown includes an explicit empty option so users can clear selection after previously choosing a prompt.
16. `Execute Prompt` is displayed in the prompts row and is disabled unless a valid prompt is selected.
17. If prompt discovery fails for a committed non-empty `working_folder`, the prompts row is shown with an inline error message and does not silently hide the failure.
18. If discovery succeeds with zero markdown prompt files, the prompts row is hidden (no error state).
19. Changing `working_folder` clears previously discovered prompt selection immediately and keeps `Execute Prompt` disabled until a new valid prompt is selected.
20. Clicking `Execute Prompt` uses the existing instruction run path (`POST /agents/:agentName/run`) and does not use command-run execution.
21. The outbound `instruction` string equals:
    - canonical preamble text from this plan, with `<full path of markdown file>` replaced by the selected prompt runtime/container full path.
22. The path inserted into the preamble is the runtime/container-resolved full path returned by discovery, not a host-only path string.
23. Existing agent run behavior remains unchanged for conversation reuse/new conversation creation, run state transitions, transcript streaming, and error handling.
24. Automated tests must cover:
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
    - prompt reset on `working_folder` change,
    - outbound instruction payload containing the exact preamble text and resolved runtime full path.

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
- Node.js documents `fs.Dirent.parentPath` for recursive dirent traversal and deprecates `dirent.path`; implementation should use `parentPath`.
- POSIX `readdir()` does not guarantee sorted order, so deterministic sorting must be explicit in service code before returning prompt lists.
- Node.js `path` docs confirm POSIX vs Windows path semantics differ; prompt discovery should continue using existing server-side working-folder resolution rather than client-side path conversion.
- MUI Popover is already used in `AgentsPage` and is built on Modal with click-away/scroll lock behavior, so reusing existing popover interaction is consistent with current UI patterns.
- GitHub documentation uses `.github/prompts` for prompt files (often `.prompt.md`), but this story intentionally supports all markdown files (`.md`, case-insensitive) under that tree for simpler, project-local behavior.
- DeepWiki and Context7 MCP research attempts were unavailable in this environment (repository not indexed in DeepWiki; Context7 API key unavailable), so decisions were cross-checked with repo code and official Node/MUI/GitHub web documentation.

## Implementation Ideas

Use a single end-to-end approach that reuses existing Agents route/service patterns and keeps prompt-specific logic minimal.

1. Server routing and API surface
- Extend [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts) with `GET /:agentName/prompts`.
- Keep endpoint under the existing commands router namespace (mounted at `/agents`) to match current read-only list route patterns.
- Accept `working_folder` as a query parameter and validate it with the same strictness used in existing routes (string, non-empty after trim).
- Return `200 { prompts: [...] }` on success and map typed service errors to existing route conventions (`invalid_request`, `not_found`, `500` fallback).

2. Server service implementation
- Add a new service function in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), for example `listAgentPrompts({ agentName, working_folder })`.
- Reuse `resolveWorkingFolderWorkingDirectory(...)` for runtime/container path resolution, so the client never performs host/container mapping logic.
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
- Do not trigger discovery in `onChange` for every keystroke.
- On each committed working-folder change:
- clear selected prompt immediately,
- clear old prompt list,
- run discovery only when committed value is non-empty.
- Render a `Prompts` selector row only when discovery returns at least one prompt.
- Render inline error in that row when discovery fails for a non-empty committed folder.
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
- add service tests near [server/src/test/unit/agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts) or a dedicated prompts service test file for recursive discovery, case-insensitive matching, deterministic sorting, and symlink-ignore behavior.

7. Validation and delivery checks
- Use repository wrapper commands for validation and diagnosis:
- `npm run test:summary:client`
- `npm run test:summary:server:unit`
- `npm run build:summary:client`
- `npm run build:summary:server`
- Update documentation files already called out in scope (`README.md`, `design.md`, `projectStructure.md`) with final route and UX behavior once implementation details are finalized.
