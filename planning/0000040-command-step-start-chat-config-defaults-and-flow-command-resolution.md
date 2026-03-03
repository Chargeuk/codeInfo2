# Story 0000040 - Command Step Start, Chat Config Defaults, and Flow Command Resolution

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

This story introduces five related improvements for agent workflows and chat defaults:

1. On the `AGENTS` page, users must be able to run a command from a selected step instead of always starting from step 1.
2. Chat defaults currently controlled by environment variables (for example sandbox mode, approval policy, reasoning effort, and default model) should instead come from `codex/chat/config.toml`, so the server can return one canonical default set and the client can initialize from those values.
3. If `codex/chat/config.toml` is missing, the server should ensure a usable default is generated during startup/bootstrap.
4. Upgrade `@openai/codex-sdk` to the latest stable version.
5. Investigate and reproduce an issue where flows in a repository appear unable to resolve commands in that same repository, while direct command execution from the GUI can still work.

Working definitions used in this story (to remove ambiguity):

- `N` means the number of executable steps in the selected command (`N = command.steps.length`).
- `Start step` means the first step index the server should execute for a command run. It is 1-based (`1..N`), not 0-based.
- `Same source repository` means the repository source that provided the flow file currently being executed.
- `codeInfo2 repository` means the repository that contains this application codebase.
- `Legacy env defaults` means existing environment-driven defaults currently used when config values are missing (for example `CHAT_DEFAULT_MODEL`, Codex-related env defaults).
- `Hardcoded safe fallback` means final constant values in server code used only when both request override, config value, and legacy env value are unavailable.

Scope control for this story (KISS):

- This story remains one plan file, but implementation is constrained to four bounded change surfaces only: AGENTS start-step execution, chat default-source migration, Codex SDK/version gate update, and flow command resolution.
- No shared utility rewrite is in scope unless required to satisfy one of those four surfaces.
- Each surface must remain backward compatible for existing callers unless an acceptance criterion explicitly changes the contract.

Decisions confirmed for this story:

- Start-step selection uses `1..N` in both UI and API payloads, with server-side validation.
- Start-step scope is `AGENTS` page command execution only.
- Default start step is always step `1` when a command is selected.
- Dependency analysis between command steps is out of scope for this story; users can pick any valid step.
- Chat defaults use precedence `request override > codex/chat/config.toml`, replacing env-default sourcing for these fields.
- Codex default model source is `codex/chat/config.toml` (`model`), replacing `CHAT_DEFAULT_MODEL` for Codex default model selection, while users can still override model in the GUI per request.
- For missing Codex default fields, fallback precedence is `request override > codex/chat/config.toml > legacy env defaults > hardcoded safe fallback`, and server warnings are emitted whenever legacy env fallback is used.
- Missing `codex/chat/config.toml` bootstraps by copying `codex/config.toml` first, then generating standard template if base config is missing.
- Deprecated web search alias handling is normalized to canonical `web_search` with default `"live"` parity.
- `@openai/codex-sdk` is pinned to `0.107.0`.
- Flow command lookup for repository-sourced flows resolves in this order: same source repository first, then the codeInfo2 repository, then other repositories by first match where "first" means source label alphabetical ascending, tie-broken by full source path alphabetical ascending.
- Flow command fallback to codeInfo2/other repositories occurs only for command-not-found cases; if same-source command exists but is schema-invalid, resolution fails fast without fallback.
- Investigation output must include an automated failing repro test and a fix.
- `GET /agents/:agentName/commands` must include `stepCount` so AGENTS UI can render deterministic `Start step` options.
- `POST /agents/:agentName/commands/run` accepts optional `startStep`; omitted means server default `1` for backward compatibility.
- Invalid start-step uses deterministic validation contract with code `INVALID_START_STEP`.
- SDK upgrade is complete only when dependency version and the runtime guard (`DEV_0000037_T01_REQUIRED_VERSION`) are both updated to `0.107.0`.
- Upstream Codex docs currently describe top-level `web_search` default behavior as `cached`; this story intentionally keeps app compatibility behavior for legacy bool parity by mapping legacy `true -> live`, `false -> disabled`, and using explicit app fallback rather than relying on implicit upstream default.
- Research confirms current flow command lookup is local-agent-home only; source-aware fallback behavior in this story is net-new and not already implemented.

Expected end-user outcome:

- Command reruns are faster and less repetitive because users can resume from a chosen step.
- Chat defaults are more predictable across REST chat and MCP chat because they come from one config source (`codex/chat/config.toml`).
- Startup behavior is more reliable because missing chat config is handled automatically.
- Flow-command behavior is clarified with either a verified fix or a documented, reproducible usage pattern.

### Acceptance Criteria

1. On `AGENTS` page command runs, the command row includes a `Start step` dropdown immediately after command selection control.
2. `Start step` is disabled until a valid command is selected and command metadata is loaded.
3. After command selection, `Start step` options are exactly `Step 1` through `Step N` (`N = command.steps.length`) and selected value is `1` by default.
4. Changing command selection resets `Start step` back to `1` every time.
5. If `N = 1`, `Start step` remains visible, preselected to `Step 1`, and disabled.
6. Clicking `Execute command` sends `startStep` as an integer in `POST /agents/:agentName/commands/run` payload, and value must be within `[1, N]`.
7. Server rejects invalid `startStep` values (missing when required, non-integer, `< 1`, `> N`) with `400` request-validation error and a message that includes the accepted range.
8. Start-step behavior is added only for `AGENTS` command execution and does not introduce start-step controls to Flows page or other execution surfaces.
9. No command-step dependency inference is added; server executes from selected valid step without auto-adjusting based on previous step dependencies.
10. Chat defaults for Codex options are sourced from `codex/chat/config.toml` for both REST chat and MCP chat responses/execution paths.
11. Covered Codex default fields are explicitly: `sandbox_mode`, `approval_policy`, `reasoning_effort`, `model`, and `web_search`.
12. Default resolution precedence for each covered field is `request override > codex/chat/config.toml`.
13. When a covered field is missing in `codex/chat/config.toml`, fallback precedence is `request override > codex/chat/config.toml > legacy env defaults > hardcoded safe fallback`.
14. Server emits a warning whenever a covered field uses `legacy env defaults` so operators can see migration gaps.
15. `codex/chat/config.toml` bootstrap behavior is deterministic: if chat config is missing, copy `codex/config.toml`; if base config is also missing, generate standard template; if chat config already exists, do not overwrite it.
16. Deprecated `web_search_request` config input is normalized to canonical `web_search`; canonical runtime default remains `"live"` when no explicit value is provided.
17. `@openai/codex-sdk` is upgraded and pinned to `0.107.0` in dependency manifests, and regression checks confirm existing chat/agent/flow flows still execute.
18. Flow command lookup order for repository-scoped flows is: same source repository first, then codeInfo2 repository, then other repositories.
19. For "other repositories", candidate sources are sorted deterministically by source label ascending, then full source path ascending, and first match is used.
20. Cross-repository fallback is used only for command-not-found; if same-source command exists but is schema-invalid, execution fails immediately and does not fallback.
21. Investigation and fix follow red-green evidence: add an automated failing repro test first, implement fix, then verify passing result on the same test.
22. `GET /agents/:agentName/commands` response includes `stepCount` per command (`integer >= 1`) so client can render `Step 1..Step N` without reading command files in browser.
23. `POST /agents/:agentName/commands/run` remains backward compatible: when `startStep` is omitted by older clients, server executes from step `1`.
24. Invalid `startStep` responses use `400` with deterministic error payload including `code: "INVALID_START_STEP"` and message format `startStep must be between 1 and N`.
25. `@openai/codex-sdk` upgrade includes updating server dependency version to `0.107.0`, updating the version guard constant in `server/src/config/codexSdkUpgrade.ts`, and keeping pre-release versions (`-alpha`, `-beta`, `-rc`) out of production manifests.
26. Flow command resolution fix is covered by automated tests for: same-source success, same-source missing command with codeInfo2 fallback, deterministic "other repository" fallback ordering, and same-source schema-invalid fail-fast without fallback.
27. Deterministic repository ordering comparison for fallback is case-insensitive ASCII on `sourceLabel`, then case-insensitive ASCII on full source path.

### Out Of Scope

- Redesigning full command authoring format beyond start-step execution support.
- Replacing existing flow JSON schema with a new DSL.
- Introducing new chat providers beyond current Codex/LM Studio behavior.
- Start-step controls for Flows page or non-Agents command execution surfaces.
- Broad refactors unrelated to start-step execution, config-default sourcing, or flow-command resolution.

### Scope Assessment (2026-03-03)

Current assessment: the story is viable but broad, and required tighter boundaries to stay junior-friendly and low-risk.

What was improved in this plan:

- Added explicit bounded scope constraints so this story does not expand into unrelated refactors.
- Added missing compatibility contracts (`startStep` optional defaulting and explicit error code/message contract).
- Added missing API data dependency (`stepCount` in command-list response) needed for AGENTS UI to implement `1..N` deterministically.
- Added explicit SDK upgrade completion conditions that include both package version and runtime version guard alignment.
- Added explicit deterministic ordering rule semantics and concrete flow-resolution test expectations for the known bug surface.

Remaining risk to monitor (already scoped in criteria):

- Cross-surface change coupling (AGENTS + chat defaults + flows + SDK) increases regression chance if merged without surface-focused verification.

## Implementation Ideas

This section is intentionally a rough implementation guide, not a task list.

Implementation shape:

- Implement through one end-to-end integration thread: API contract -> service/runner behavior -> UI consumption -> regression tests.
- Keep changes localized to existing modules for each surface rather than introducing new abstraction layers in this story.
- Preserve backward compatibility where callers already exist (especially command-run payloads that do not yet send `startStep`).

Likely code surfaces to change:

1. AGENTS command start-step support:
   - Route/body validation and error mapping:
     - `server/src/routes/agentsCommands.ts`
   - Command-run service and runner plumbing:
     - `server/src/agents/service.ts`
     - `server/src/agents/commandsRunner.ts`
   - Command-list metadata for UI step options:
     - `server/src/agents/commandsLoader.ts`
     - `server/src/agents/service.ts`
   - Client API + AGENTS page start-step controls:
     - `client/src/api/agents.ts`
     - `client/src/pages/AgentsPage.tsx`

2. Chat defaults from `codex/chat/config.toml`:
   - Default-source precedence and fallback warnings:
     - `server/src/config/chatDefaults.ts`
     - `server/src/routes/chatValidators.ts`
   - Runtime config bootstrap/read path parity:
     - `server/src/config/runtimeConfig.ts`
   - Ensure MCP codebase-question path uses same default policy as REST chat:
     - `server/src/mcp2/tools/codebaseQuestion.ts`

3. SDK upgrade alignment (`0.107.0`):
   - Dependency pin + startup guard alignment:
     - `server/package.json`
     - `server/src/config/codexSdkUpgrade.ts`
   - Validate startup/version logging still reflects the upgraded minimum:
     - `server/src/index.ts`

4. Flow command resolution order/fallback:
   - Source-aware command lookup strategy for flow command steps:
     - `server/src/flows/service.ts`
   - Reuse existing repository listing metadata, but enforce deterministic fallback ordering in flow lookup logic itself:
     - same-source repository -> codeInfo2 repository -> sorted other repositories.

Integration notes to keep implementation simple:

- Convert `startStep` to zero-based only at execution boundary inside runner loop; keep API/UI semantics 1-based.
- Keep existing default run behavior for older clients by treating missing `startStep` as `1`.
- Add `stepCount` to command-list response so UI never has to inspect command files directly.
- Keep error contracts stable and explicit (`INVALID_START_STEP` for range/type errors).
- Limit flow fallback to command-not-found; if same-source command file exists but is schema-invalid, fail immediately.

Regression checks to prioritize while implementing:

- Existing command-run callers without `startStep` continue to execute from step 1.
- Invalid `startStep` values return deterministic `400` payload with range message.
- AGENTS UI renders `Step 1..Step N` from `stepCount` and clamps outbound values to valid range.
- REST chat and MCP codebase-question resolve Codex defaults using the same precedence chain.
- SDK upgrade guard matches dependency pin (`0.107.0`) and still rejects unsupported versions.
- Flow command resolution follows exact precedence and deterministic tie-break ordering.

### Interface Draft (Web GUI)

This section defines concrete UI behavior for the unresolved interface requirements in this story.

#### A. AGENTS page - command start-step interaction

Primary user outcome:
- A user can re-run a command from a chosen step quickly without editing command files or re-running all prior steps.

Layout proposal:
- Keep controls in the existing command action row on `AgentsPage`.
- Row order (desktop): `Command` select -> `Start step` select -> command info icon -> `Execute command` button.
- Row order (mobile): stack into one column in the same visual order.

Control behavior:
- `Start step` is a single-select dropdown (`1..N`) and is always visible in the command row.
- Before command selection, `Start step` is disabled with placeholder text (for example `Select command first`).
- Default selected value is always `1` on command selection and on command change.
- Step options are rendered as readable labels: `Step 1`, `Step 2`, ... `Step N`.
- Command dropdown includes step-count preview in option secondary text when available (for example `build_release` + `6 steps`).
- If command metadata is loading, start-step remains disabled.
- If command is invalid/disabled, start-step remains disabled and execution remains disabled.
- If command has only one step, start-step remains visible and disabled with `Step 1` selected.

Execution behavior:
- Clicking `Execute command` sends selected `startStep` as `1..N` in the command-run payload.
- Existing run locks, persistence checks, and websocket readiness checks remain unchanged and still gate execution.

Validation and feedback:
- Invalid step requests (out of range, malformed) surface as inline error feedback in the command area.
- Command row should preserve existing warning notes (Mongo persistence and websocket requirement).
- If backend rejects start-step, the user should see a specific message tied to that command run attempt, including allowed range (for example: `startStep must be between 1 and 6`).
- Start-step validation feedback uses inline row-level `Alert` (no snackbar for this path).

Accessibility and keyboard behavior:
- `Start step` select must have a visible label and be keyboard navigable.
- Tab order follows the visual sequence in the row.
- Disabled states are announced by native control semantics (MUI/HTML disabled behavior).

Responsive behavior:
- On small screens, controls stack with full-width selects and fixed-width action buttons dropped to full-width.
- No horizontal overflow in the command row at common mobile widths.

Viability checks:
- Current row structure and disabled-state patterns in `client/src/pages/AgentsPage.tsx` support adding one more `FormControl + Select` without changing overall flow ownership.
- Existing API contract in `client/src/api/agents.ts` and `server/src/routes/agentsCommands.ts` requires extension to carry/validate `startStep`.

#### B. Chat page - defaults and warnings presentation

Primary user outcome:
- Chat settings open with expected defaults from `codex/chat/config.toml`, while still allowing manual override in GUI.

UI behavior:
- Existing `CodexFlagsPanel` remains the editing surface for sandbox/approval/reasoning/network/web-search controls.
- Existing warnings banner remains the display surface for server warnings.
- Add/continue warning text for env fallback usage so migration status is visible without blocking user actions; warning includes which field fell back.
- Env-fallback warning banner is shown on every load while fallback is active.

State behavior:
- Initial flag values come from server-provided defaults (no client-side env assumptions).
- User can still override values in the current session before sending a message.
- Warning display is informational; it should not disable controls by itself.

Viability checks:
- Chat already consumes `codexDefaults` and `codexWarnings` and renders a warnings banner in `client/src/pages/ChatPage.tsx`.
- Existing initialization logic and gating (`codexDefaultsReady`) can support the new fallback-source semantics without introducing new panel components.

#### C. Flow command resolution - UX surface expectation

Primary user outcome:
- When a command cannot run due to invalid same-source command file, users get a clear, actionable error instead of silent fallback behavior.

UI behavior expectation:
- Flow run errors for schema-invalid same-source commands should be surfaced as explicit run failure messages.
- Error text should include enough context to identify the failing command and source location label.
- Error wording should be operator-first with optional technical suffix (for example: `Command file invalid for selected source` + `schema validation failed`) and must not be replaced by fallback-success output from another repository.

Viability checks:
- Existing flow/chat transcript already renders warning/error bubbles, so this requirement can be satisfied through improved server error detail and existing UI surfaces.

### Questions

None.

### Research Findings (2026-03-03)

- `code_info` repository inspection confirms:
  - AGENTS command-run route currently does not accept `startStep`.
  - AGENTS command-list payload currently does not provide `stepCount`.
  - Flow command loading currently reads only `<agentHome>/commands/<name>.json` and does not use flow source repository fallback order.
  - REST chat and MCP codebase-question still source Codex defaults from env-backed paths in key locations.
- `deepwiki` tool check failed because repository `Chargeuk/codeInfo2` is not indexed in this environment at research time.
- `context7` tool check failed because no valid Context7 API key is configured in this environment at research time.
- npm registry live checks (2026-03-03) confirm:
  - latest stable `@openai/codex-sdk` is `0.107.0`
  - latest pre-release is `0.108.0-alpha.3`
  - package diff `0.106.0 -> 0.107.0` changes package version and bundled CLI dependency version, with no SDK API surface diff in published files.
- OpenAI Codex config reference (developers.openai.com) confirms:
  - `features.web_search_request` is a deprecated legacy toggle mapping to top-level `web_search` when canonical key is unset.
  - `web_search` canonical modes are `disabled | cached | live`.
  - `approval_policy`, `sandbox_mode`, and `model_reasoning_effort` remain canonical config keys.

Source references used in this research pass:

- npm package metadata: https://www.npmjs.com/package/@openai/codex-sdk and `npm view @openai/codex-sdk ...`
- npm registry diff evidence: `npm diff --diff @openai/codex-sdk@0.106.0 --diff @openai/codex-sdk@0.107.0`
- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference
- OpenAI Codex docs entrypoint: https://raw.githubusercontent.com/openai/codex/main/docs/config.md
