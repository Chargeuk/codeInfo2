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
- For disabled command summary entries where command content cannot be parsed, effective UI `N` comes from sentinel `stepCount: 1`.
- `Same source repository` means the repository source that provided the flow file currently being executed.
- `codeInfo2 repository` means the repository that contains this application codebase.
- `Normalized source label` means `sourceLabel.trim()` when present and non-empty; otherwise basename of the repository source full path.
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
- Codex reasoning key is `model_reasoning_effort` (not `reasoning_effort`) in runtime config.
- For missing Codex default fields, fallback precedence is `request override > codex/chat/config.toml > legacy env defaults > hardcoded safe fallback`, and server warnings are emitted whenever legacy env fallback is used.
- Missing `codex/chat/config.toml` bootstraps by copying `codex/config.toml` first, then generating standard template if base config is missing.
- Deprecated web-search aliases are normalized deterministically:
  - `true` aliases -> canonical `web_search = "live"`
  - `false` aliases -> canonical `web_search = "disabled"`
  - canonical `web_search` always wins when both canonical and alias are present.
- `@openai/codex-sdk` is pinned to `0.107.0`.
- Repository baseline before this story is `@openai/codex-sdk` `0.106.0`; this story upgrades/pins to `0.107.0`.
- Server workspace TypeScript is currently `^5.6.3` (root/client are `5.9.3`), so server-task implementations must remain TypeScript 5.6-compatible unless a separate TypeScript-upgrade story is approved.
- Flow command lookup for repository-sourced flows resolves in this order: same source repository first, then the codeInfo2 repository, then other repositories by first match where "first" means case-insensitive ASCII ascending on normalized source label, tie-broken by case-insensitive ASCII ascending on full source path.
- Flow command fallback to codeInfo2/other repositories occurs only for command-not-found cases; if same-source command exists but is schema-invalid, resolution fails fast without fallback.
- Investigation output must include an automated failing repro test and a fix.
- `GET /agents/:agentName/commands` must include `stepCount` so AGENTS UI can render deterministic `Start step` options.
- Disabled command entries still include `stepCount` as sentinel `1` when command file cannot be parsed; execution remains blocked by `disabled=true`/server validation.
- `POST /agents/:agentName/commands/run` accepts optional `startStep`; omitted means server default `1` for backward compatibility.
- `startStep` contract in this story applies to REST `POST /agents/:agentName/commands/run`; MCP Agents `run_command` tool input remains unchanged in this story.
- Invalid start-step uses deterministic validation contract with code `INVALID_START_STEP`.
- SDK upgrade is complete only when dependency version and the runtime guard (`DEV_0000037_T01_REQUIRED_VERSION`) are both updated to `0.107.0`.
- Upstream Codex docs currently describe top-level `web_search` default behavior as `cached`; this story keeps existing app compatibility by using explicit mapping for legacy bool aliases (`true -> live`, `false -> disabled`) and explicit app fallback behavior instead of relying on implicit upstream defaults.
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
7. Server rejects invalid provided `startStep` values (non-integer, `< 1`, `> N`) with `400` request-validation error and a message that includes the accepted range.
8. Start-step behavior is added only for REST `AGENTS` command execution and does not introduce start-step controls or start-step input fields for Flows page, chat surfaces, or MCP Agents `run_command`.
9. No command-step dependency inference is added; server executes from selected valid step without auto-adjusting based on previous step dependencies.
10. Chat defaults for Codex options are sourced from `codex/chat/config.toml` for both REST chat and MCP chat responses/execution paths.
11. Covered Codex default fields are explicitly: `sandbox_mode`, `approval_policy`, `model_reasoning_effort`, `model`, and `web_search`.
12. Default resolution precedence for each covered field is `request override > codex/chat/config.toml`.
13. When a covered field is missing in `codex/chat/config.toml`, fallback precedence is `request override > codex/chat/config.toml > legacy env defaults > hardcoded safe fallback`.
14. Server emits a warning whenever a covered field uses `legacy env defaults`, and warning text names the specific field that fell back.
15. `codex/chat/config.toml` bootstrap behavior is deterministic: if chat config is missing, copy `codex/config.toml`; if base config is also missing, generate standard template; if chat config already exists, do not overwrite it.
16. Deprecated `web_search_request`/legacy boolean web-search inputs are normalized to canonical `web_search` (`true -> "live"`, `false -> "disabled"`), and canonical `web_search` wins if both are present.
17. `@openai/codex-sdk` is upgraded and pinned to `0.107.0` in dependency manifests, and regression checks confirm existing chat/agent/flow flows still execute.
18. Flow command lookup order for repository-scoped flows is: same source repository first, then codeInfo2 repository, then other repositories.
19. For "other repositories", candidate sources are sorted deterministically by case-insensitive ASCII on normalized source label, then case-insensitive ASCII on full source path, and first match is used.
20. Cross-repository fallback is used only for command-not-found; if same-source command exists but is schema-invalid, execution fails immediately and does not fallback.
21. Investigation and fix follow red-green evidence: add an automated failing repro test first, implement fix, then verify passing result on the same test.
22. `GET /agents/:agentName/commands` response includes `stepCount` per command (`integer >= 1`) so client can render `Step 1..Step N` without reading command files in browser.
23. For disabled commands with unreadable/invalid command files, response still includes `stepCount: 1` as sentinel plus `disabled: true`; client keeps execution disabled.
24. `POST /agents/:agentName/commands/run` remains backward compatible: when `startStep` is omitted by older clients, server executes from step `1`.
25. Invalid `startStep` responses use `400` with deterministic error payload including `code: "INVALID_START_STEP"` and message format `startStep must be between 1 and N`.
26. `@openai/codex-sdk` upgrade includes updating server dependency version to `0.107.0`, updating the version guard constant in `server/src/config/codexSdkUpgrade.ts`, and keeping pre-release versions (`-alpha`, `-beta`, `-rc`) out of production manifests.
27. Flow command resolution fix is covered by automated tests for: same-source success, same-source missing command with codeInfo2 fallback, deterministic "other repository" fallback ordering, and same-source schema-invalid fail-fast without fallback.
28. Deterministic repository ordering comparison for fallback is case-insensitive ASCII on normalized source label, then case-insensitive ASCII on full source path.

### Message Contracts and Storage Shapes

This section defines contract and persistence impacts up front so implementation does not duplicate or accidentally drift existing shapes.

1. REST contract changes required by this story

- `GET /agents/:agentName/commands`
  - Existing response item shape:
    - `{ name, description, disabled, sourceId?, sourceLabel? }`
  - Updated response item shape for this story:
    - `{ name, description, disabled, stepCount, sourceId?, sourceLabel? }`
  - `stepCount` is required and must be an integer `>= 1`.
  - `stepCount` generation rule:
    - valid command file: `command.items.length`
    - disabled/invalid command file: sentinel `1` with `disabled: true`.

- `POST /agents/:agentName/commands/run`
  - Existing request body shape:
    - `{ commandName, sourceId?, conversationId?, working_folder? }`
  - Updated request body shape for this story:
    - `{ commandName, startStep?, sourceId?, conversationId?, working_folder? }`
  - `startStep` is optional for backward compatibility; when omitted, server executes from step `1`.
  - `startStep` must be integer within `[1, stepCount]`.
  - Server validates range against the command file loaded at execution time (server is source of truth; client value is advisory).
  - Invalid `startStep` contract:
    - `400 { error: 'invalid_request', code: 'INVALID_START_STEP', message: 'startStep must be between 1 and N' }`

- `POST /agents/:agentName/commands/run` success response remains unchanged:
  - `202 { status: 'started', agentName, commandName, conversationId, modelId }`

2. REST/MCP/WebSocket contracts that remain unchanged

- `POST /chat` request/response shape remains unchanged; only default-value sourcing changes behind existing fields.
- `GET /chat/models` and `GET /chat/providers` payload shape remains unchanged; only `codexDefaults`/`codexWarnings` value origin changes.
- MCP `codebase_question` request/response shape remains unchanged.
- MCP Agents `run_command` tool contract remains unchanged for this story scope (start-step applies only to REST AGENTS page command runs).
- WebSocket event schemas remain unchanged (`WsInflightSnapshotEvent`, `WsTurnFinalEvent`, and existing `command` metadata shape).

3. Flow-run contract behavior in scope

- `POST /flows/:flowName/run` request/response/error envelope remains unchanged.
- Flow command-resolution fix is an internal lookup/order behavior change.
- For same-source schema-invalid commands, failure remains surfaced through existing failed-turn/final-status channels, not a new transport contract.

4. Storage and persistence impact

- No Mongo schema changes required:
  - Conversation document shape remains unchanged.
  - Turn document shape remains unchanged (existing `command: { name, stepIndex, totalSteps }` is sufficient).
- No in-memory runtime shape changes required:
  - Inflight registry shape remains unchanged.
  - Memory conversation/turn shapes remain unchanged.
- No migration/backfill required for this story.

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
    - same-source repository -> codeInfo2 repository -> other repositories sorted by case-insensitive normalized source label, then case-insensitive full source path.

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

### Tasking Readiness

This story is ready to be broken into tasks when the task author preserves the boundaries below.

Required implementation outputs (must all be represented by downstream tasks):

- AGENTS start-step support is fully wired end-to-end:
  - command list returns `stepCount`
  - command run accepts optional `startStep`
  - server validates `startStep` with deterministic `INVALID_START_STEP` errors
  - UI sends and enforces valid `startStep` range.
- Chat default-source migration is complete for both REST and MCP codebase-question paths using the same precedence and warning behavior.
- Runtime bootstrap behavior for missing `codex/chat/config.toml` is deterministic and non-destructive.
- SDK upgrade is complete and aligned:
  - dependency pinned to `0.107.0`
  - runtime guard constant updated to `0.107.0`
  - no pre-release SDK version accepted for this story.
- Flow command resolution bug is fixed with deterministic source ordering and no fallback on same-source schema-invalid command files.

Required validation evidence (must be produced by downstream tasks):

- Updated/added automated tests for all changed contracts and behaviors listed in Acceptance Criteria and Message Contracts sections.
- Passing wrapper-based validation for the affected workspaces:
  - `npm run build:summary:server`
  - `npm run build:summary:client`
  - targeted wrappers during diagnosis, then full relevant wrappers for final validation.
- Contract coverage evidence:
  - REST route tests for `/agents/:agentName/commands` and `/agents/:agentName/commands/run`
  - flow command resolution tests covering same-source success, same-source invalid fail-fast, and deterministic cross-repo fallback.
- Migration/compatibility evidence:
  - tests or assertions proving older clients (no `startStep`) still run from step 1
  - tests/assertions proving unchanged MCP `run_command` contract behavior for this story scope.

Tasking guardrails (must not be violated by downstream tasks):

- No new persistence schema fields unless a new planning update explicitly adds them.
- No new WebSocket message types unless a new planning update explicitly adds them.
- No broad refactor outside the four scoped surfaces in this story.

### Edge Cases and Failure Modes

The following cases must be handled explicitly so implementation and validation remain deterministic.

1. AGENTS `startStep` contract and execution edge cases

- Omitted `startStep` from older clients remains valid and must execute from step `1`.
- `startStep` values `0`, negative integers, decimals, non-numeric strings, and values greater than current runtime step count must return `400` with `code: "INVALID_START_STEP"` and range message `startStep must be between 1 and N`.
- If command metadata was loaded earlier but command file changes before execution (step count drift), server-side runtime validation is source of truth; request may become invalid and must fail with deterministic range error.
- Disabled/invalid command entries expose sentinel `stepCount: 1` for UI stability, but execution must remain blocked by existing disabled-command checks.
- `N = 1` remains a valid execution surface: UI keeps `Start step` visible and fixed to `1`; server still accepts omitted/explicit `1`.

2. Flow command resolution edge cases

- Same-source command exists but is schema-invalid: fail fast on same-source error and do not fallback to codeInfo2 or other repositories.
- Same-source command exists but file read/parse fails (for example permissions/corruption): treat as same-source failure and do not fallback; surface explicit error context.
- Same-source command missing: fallback proceeds deterministically (codeInfo2 next, then other repositories by case-insensitive ASCII normalized label, then case-insensitive ASCII full path).
- Multiple repositories with equivalent normalized labels and mixed-case names must still resolve deterministically using the defined tie-breaker; behavior must not depend on filesystem iteration order.
- Command missing across all candidate sources must return existing not-found failure path (no silent success from unrelated fallback behavior).

3. Chat defaults and bootstrap edge cases

- `codex/chat/config.toml` missing while `codex/config.toml` exists: bootstrap copy must occur once and preserve existing values.
- Both chat config and base config missing: generate standard template deterministically.
- Chat config already exists: bootstrap must be non-destructive (no overwrite, no reset).
- Chat config exists but has invalid TOML or invalid field values: emit warning(s), do not overwrite user file, and apply fallback chain `request > config > legacy env > hardcoded safe fallback`.
- Canonical `web_search` and deprecated aliases present together: canonical key wins every time.
- Runtime cannot read or write config path (permission/path errors): startup continues with warning and deterministic fallback behavior instead of partial silent defaults.

4. SDK upgrade/version guard edge cases

- Dependency pin and runtime guard constant drift (one updated, one not) must fail verification; story is incomplete unless both are `0.107.0`.
- Pre-release SDK builds (`-alpha`, `-beta`, `-rc`) must not be accepted in production manifests for this story.
- Lockfile/manifests must resolve to the same effective SDK version used by runtime guard checks; no mixed-version ambiguity across install/runtime.

5. Cross-surface compatibility failure modes

- REST AGENTS start-step contract changes must not alter MCP Agents `run_command` input contract in this story.
- Chat default-source migration must behave the same for REST chat and MCP codebase-question paths; divergence is a failure.
- Existing websocket event schemas and conversation/turn persistence shapes must remain unchanged while implementing these behaviors.

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
- Command dropdown includes step-count preview in option secondary text for every command option (for example `build_release` + `6 steps`).
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
  - Existing Mongo/in-memory shapes already support this story without schema changes (`Turn.command` already stores `{ name, stepIndex, totalSteps }`).
- `code_info` + manifest cross-check confirms current version baseline is:
  - server `@openai/codex-sdk`: `0.106.0` (target in this story: `0.107.0`)
  - client `@mui/material`: `^6.4.1`
  - client React: `^19.2.0`
  - TypeScript: root `5.9.3`, client `~5.9.3`, server `^5.6.3`.
- `deepwiki` tool check failed because repository `Chargeuk/codeInfo2` is not indexed in this environment at research time.
- `deepwiki` upstream cross-reference against `openai/codex` confirms config-layer failure modes relevant to this story:
  - malformed TOML/schema-invalid values should fail deterministically with actionable error context
  - config precedence/override behavior must be explicit to avoid silent default drift
  - config write/read flows can surface version/conflict conditions that should never be silently swallowed.
- `deepwiki` upstream cross-reference against `expressjs/express` confirms Express 5 assumptions used by this plan:
  - async handler rejections are forwarded to error middleware automatically
  - body-parser/request parsing failures are expected to flow through deterministic error middleware shaping for stable `400` payloads.
- `context7` tool check failed because no valid Context7 API key is configured in this environment at research time.
- npm registry live checks (2026-03-03) confirm:
  - latest stable `@openai/codex-sdk` is `0.107.0`
  - latest pre-release is `0.108.0-alpha.3`
  - package diff `0.106.0 -> 0.107.0` changes package version and bundled CLI dependency version, with no SDK API surface diff in published files.
- OpenAI Codex config reference (developers.openai.com) confirms:
  - `features.web_search_request` is a deprecated legacy toggle mapping to top-level `web_search` when canonical key is unset.
  - `web_search` canonical modes are `disabled | cached | live`.
  - `approval_policy`, `sandbox_mode`, and `model_reasoning_effort` remain canonical config keys.
- MUI docs MCP (Material UI `6.4.12`, closest to installed `6.4.1`) confirms:
  - `Select` + `FormControl` + `InputLabel` pattern remains canonical for labeled dropdowns
  - `Select` accessibility labeling should use matching `InputLabel` id and `Select` `labelId`
  - FormControl API/props used in this story (`disabled`, `error`, `size`, `variant`) are valid for the installed major/minor line.

Source references used in this research pass:

- npm package metadata: https://www.npmjs.com/package/@openai/codex-sdk and `npm view @openai/codex-sdk ...`
- npm registry diff evidence: `npm diff --diff @openai/codex-sdk@0.106.0 --diff @openai/codex-sdk@0.107.0`
- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference
- OpenAI Codex docs entrypoint: https://raw.githubusercontent.com/openai/codex/main/docs/config.md
- React release blog (React 19): https://react.dev/blog/2024/12/05/react-19
- Express 5 migration guide: https://expressjs.com/en/guide/migrating-5.html
- Mongoose 9 migration guide: https://mongoosejs.com/docs/migrating_to_9.html
- MUI Select docs (v6 line via MCP + public docs): https://mui.com/material-ui/react-select/
- MUI FormControl API (v6 line via MCP + public docs): https://mui.com/material-ui/api/form-control/

# Implementation Plan

## Instructions

1. Read this full plan before implementation, especially Acceptance Criteria, Message Contracts and Storage Shapes, Edge Cases and Failure Modes, and the task order below.
2. Execute tasks in the listed order.
3. Keep each task focused to one testable behavior or contract.
4. Complete server message-contract tasks before frontend tasks that depend on those contracts.
5. Add or update deterministic tests inside the same task that introduces behavior.
6. Use wrapper-first build/test commands from `AGENTS.md`.
7. Keep task status, subtask checkboxes, testing checkboxes, implementation notes, and git commit hashes updated continuously while implementing.
8. Keep server TypeScript changes compatible with server workspace `typescript@^5.6.3`; do not assume TypeScript 5.9-only syntax/features in server tasks.

## Tasks

### 1. Server Message Contract: add `stepCount` to `GET /agents/:agentName/commands`

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add the backend response contract for command list items so the frontend can render `Start step` choices without parsing command files. This task only changes list-message shape and associated tests.

#### Documentation Locations (External References Only)

- Express routing basics: https://expressjs.com/en/guide/routing.html
- OpenAPI 3.1: https://swagger.io/specification/
- Node test runner: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Update command summary shape to include `stepCount` in [server/src/agents/commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts).
2. [ ] Ensure `stepCount` generation rule is implemented in [server/src/agents/commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts):
   - valid command file -> `command.items.length`
   - invalid/disabled command file -> sentinel `1`.
3. [ ] Ensure list service returns `stepCount` in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) and route payload includes it in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
4. [ ] Add/extend server unit tests for command-list contract in [server/src/test/unit/agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts) and [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts).
5. [ ] Update `openapi.json` list contract schema for `stepCount` in [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json) and add/update OpenAPI contract tests in [server/src/test/unit/openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.contract.test.ts).
6. [ ] Update documentation files changed by this task:
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-list.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agents-commands-router-list.test.ts`
7. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/openapi.contract.test.ts`
8. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 2. Server Message Contract: add optional `startStep` to `POST /agents/:agentName/commands/run` and deterministic validation error mapping

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Add the run-request message contract for optional `startStep` with strict input validation and deterministic `INVALID_START_STEP` response shape. This task is route/service boundary only and does not change execution loop behavior yet.

#### Documentation Locations (External References Only)

- Express routing and request validation patterns: https://expressjs.com/en/guide/routing.html
- HTTP status semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
- Node test runner: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Extend request parsing for command-run in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts) to accept optional `startStep`.
2. [ ] Add validation rules for `startStep` shape in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts):
   - omitted allowed
   - integer only when present
   - reject non-integer inputs as `400 invalid_request`.
3. [ ] Add deterministic error mapping in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts) for `INVALID_START_STEP` to:
   - `400 { error: 'invalid_request', code: 'INVALID_START_STEP', message: 'startStep must be between 1 and N' }`.
4. [ ] Extend command-run service input contract in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) to include optional `startStep` without changing runner logic in this task.
5. [ ] Add/extend router unit tests in [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts) for:
   - optional `startStep` accepted,
   - invalid type rejected,
   - `INVALID_START_STEP` mapping shape.
6. [ ] Add/extend MCP Agents `run_command` regression tests in [server/src/test/unit/mcp-agents-commands-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp-agents-commands-run.test.ts) and confirm [server/src/mcpAgents/tools.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcpAgents/tools.ts) input schema remains unchanged for this story scope (no `startStep` input field).
7. [ ] Update run contract in [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json) and add/update OpenAPI tests in [server/src/test/unit/openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.contract.test.ts).
8. [ ] Update documentation files changed by this task:
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agents-commands-router-run.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/mcp-agents-commands-run.test.ts`
7. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/openapi.contract.test.ts`
8. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 3. Server Behavior: execute command runs from `startStep` with backward compatibility

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement runtime start-step behavior in the command runner. This task covers start index calculation, range validation against loaded command content, and default behavior when `startStep` is omitted.

#### Documentation Locations (External References Only)

- Node test runner: https://nodejs.org/api/test.html
- TypeScript handbook (function types and narrowing): https://www.typescriptlang.org/docs/handbook/2/functions.html

#### Subtasks

1. [ ] Add `startStep` handling in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) for both `startAgentCommand` (background run path) and `runAgentCommand` (synchronous path) so omitted values default to `1`.
2. [ ] Update execution entrypoint in [server/src/agents/commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) to:
   - validate `startStep` against runtime `totalSteps`,
   - convert `1..N` to runner index at execution boundary,
   - execute from selected step through final step.
3. [ ] Ensure runtime range failures throw typed `INVALID_START_STEP` errors in [server/src/agents/commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts).
4. [ ] Add/extend runner tests in [server/src/test/unit/agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for:
   - omitted `startStep` runs from step 1,
   - valid non-1 step executes from offset,
   - out-of-range values fail deterministically.
5. [ ] Add/extend service integration tests in [server/src/test/integration/agents-run-client-conversation-id.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-client-conversation-id.test.ts) to prove backward compatibility with older clients (omitted `startStep` still executes from step 1) for both command run entry paths.
6. [ ] Update documentation files changed by this task:
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-runner.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-client-conversation-id.test.ts`
7. [ ] `npm run test:summary:server:cucumber`
8. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 4. Client Message Contract: consume `stepCount` and send `startStep` in agents API layer

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Update the frontend API layer contracts to match backend message changes. This task is limited to API types, request payloads, and API-layer tests.

#### Documentation Locations (External References Only)

- Fetch API patterns (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- TypeScript type compatibility: https://www.typescriptlang.org/docs/handbook/type-compatibility.html
- Jest docs: https://jestjs.io/docs/getting-started

#### Subtasks

1. [ ] Add `stepCount` to command list response typing in [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts).
2. [ ] Add optional `startStep` to command run request typing and request body serialization in [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts).
3. [ ] Add/extend API tests in [client/src/test/agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts) and [client/src/test/agentsApi.commandsRun.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsRun.test.ts).
4. [ ] Update documentation files changed by this task:
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:client -- --file client/src/test/agentsApi.commandsList.test.ts`
6. [ ] `npm run test:summary:client -- --file client/src/test/agentsApi.commandsRun.test.ts`
7. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 5. Frontend: AGENTS `Start step` control behavior and execution wiring

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement AGENTS page UI behavior for selecting and validating start step using backend-provided `stepCount`. This task only covers page state, control rendering, and execute payload wiring.

#### Documentation Locations (External References Only)

- MUI Select component docs: https://mui.com/material-ui/react-select/
- MUI FormControl API docs: https://mui.com/material-ui/api/form-control/
- React state patterns: https://react.dev/learn/managing-state
- Jest DOM matchers: https://testing-library.com/docs/ecosystem-jest-dom/

#### Subtasks

1. [ ] Add `Start step` UI control to [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx) immediately after command selection control.
2. [ ] Implement state behavior in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx):
   - disabled before valid command metadata,
   - options `Step 1..Step N`,
   - reset to `1` on command change,
   - disabled when `N = 1`.
3. [ ] Add command-option step-count preview text in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx) (for example `N steps`) using backend-provided `stepCount` so users can pick the correct command before choosing `Start step`.
4. [ ] Wire execute action payload in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx) to pass `startStep` in `POST /agents/:agentName/commands/run`.
5. [ ] Add/extend UI tests in existing command-row suites (do not create a parallel page-test scaffold):
   - [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx)
   - [client/src/test/agentsPage.run.commandError.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.commandError.test.tsx)
   - [client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx)
   to verify visibility, enable/disable behavior, reset behavior, command-option step-count preview text, outbound payload, and `INVALID_START_STEP` inline feedback.
6. [ ] Ensure row-level inline error handling for backend `INVALID_START_STEP` responses in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx) with deterministic range message display.
7. [ ] Update documentation files changed by this task:
   - [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.commandsList.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.run.commandError.test.tsx`
7. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx`
8. [ ] `npm run test:summary:client`
9. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 6. Server: shared chat defaults resolver from `codex/chat/config.toml`

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement the shared Codex default-resolution behavior in one place so all consumers can reuse one deterministic precedence and warning pipeline.

#### Documentation Locations (External References Only)

- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference
- Node test runner: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Extend shared default resolution in [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts) by reusing runtime-config parsing/normalization from [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) to read `codex/chat/config.toml` values for `sandbox_mode`, `approval_policy`, `model_reasoning_effort`, `model`, and `web_search`.
2. [ ] Implement precedence `request override > codex/chat/config.toml > legacy env defaults > hardcoded safe fallback` in [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), with warning messages that include exact field names whenever legacy env fallback is used.
3. [ ] Keep canonical `web_search` precedence and deterministic alias normalization in the shared defaults path by reusing existing runtime-config normalization behavior so canonical `web_search` wins over deprecated aliases and bool aliases map to `live|disabled`.
4. [ ] Add/extend tests in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts), including invalid TOML/invalid field-value fallback behavior and deterministic warnings without overwriting user config files.
5. [ ] Update documentation files changed by this task:
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/config.chatDefaults.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 7. Server: REST chat and capability surfaces consume shared defaults

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Wire REST and capability endpoints to the shared resolver so runtime defaults and warning behavior are consistent across chat routes and model metadata surfaces.

#### Documentation Locations (External References Only)

- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference
- Node test runner: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Update [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts) to source Codex defaults from the shared config-backed resolver instead of env-only defaults, preserving existing model capability shape.
2. [ ] Update [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts) to return `codexDefaults` and warning semantics from the shared config-backed resolver path (not env-first behavior).
3. [ ] Update [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chat.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chat.ts), and [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts) to use the shared resolver for Codex defaults and deterministic warning output.
4. [ ] Add/extend tests:
   - [server/src/test/unit/chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts)
   - [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts)
   - [server/src/test/unit/chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts).
5. [ ] Update documentation files changed by this task:
   - [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/chatValidators.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/chatModels.codex.test.ts`
7. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/chatProviders.test.ts`
8. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 8. Server: MCP `codebase_question` uses shared chat defaults

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Align MCP `codebase_question` Codex default behavior with REST by reusing the same shared resolver path and warnings contract.

#### Documentation Locations (External References Only)

- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference
- Node test runner: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Update [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts) to source Codex thread defaults from the shared config-backed resolver instead of direct env-default sourcing.
2. [ ] Add/extend tests:
   - [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts)
   - [server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts)
   - [server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts).
3. [ ] Update documentation files changed by this task:
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`
7. [ ] `npm run test:summary:server:unit -- --file server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
8. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 9. Server: deterministic bootstrap for missing `codex/chat/config.toml`

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement startup/bootstrap behavior for missing chat config with non-destructive rules. This task is restricted to runtime config bootstrap behavior and related tests.

#### Documentation Locations (External References Only)

- Node fs API: https://nodejs.org/api/fs.html
- Node path API: https://nodejs.org/api/path.html
- Node test runner: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Update bootstrap logic in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) to:
   - copy `codex/config.toml` to `codex/chat/config.toml` when chat config is missing,
   - generate standard template when both files are missing,
   - keep existing chat config untouched when present.
2. [ ] Ensure permission/read-write failures are logged as deterministic warnings in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) without silent fallback behavior.
3. [ ] Add/extend bootstrap tests in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) for:
   - copy path,
   - template generation path,
   - non-destructive existing-file path,
   - failure warning path.
4. [ ] Update documentation files changed by this task:
   - [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/runtimeConfig.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 10. Server: upgrade and pin `@openai/codex-sdk` to `0.107.0` with guard alignment

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Upgrade dependency and runtime guard together so install-time and runtime expectations match exactly. This task must not include unrelated behavior changes.

#### Documentation Locations (External References Only)

- npm package info for `@openai/codex-sdk`: https://www.npmjs.com/package/@openai/codex-sdk
- npm semver docs: https://docs.npmjs.com/about-semantic-versioning
- Node test runner: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Verify latest stable `@openai/codex-sdk` and baseline/target in implementation notes using `npm view @openai/codex-sdk version versions --json` (baseline `0.106.0`, target stable `0.107.0` as of 2026-03-03).
2. [ ] Update `@openai/codex-sdk` version pin to `0.107.0` in [server/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/package.json).
3. [ ] Update runtime guard constant in [server/src/config/codexSdkUpgrade.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexSdkUpgrade.ts) to `0.107.0`.
4. [ ] Verify startup guard usage path remains aligned in [server/src/index.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/index.ts).
5. [ ] Add/extend tests in [server/src/test/unit/codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts) to ensure expected version and pre-release rejection behavior.
6. [ ] Update documentation files changed by this task:
   - [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/codexSdkUpgrade.test.ts`
6. [ ] `npm run test:summary:server:unit`
7. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 11. Server: flow command resolution deterministic source ordering and same-source fail-fast

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Implement and verify the flow command-resolution fix with red-green evidence, deterministic fallback ordering, and no fallback when same-source command is schema-invalid.

#### Documentation Locations (External References Only)

- Node path API: https://nodejs.org/api/path.html
- Node test runner: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Add a failing repro test first in [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) that demonstrates current incorrect same-source/fallback behavior.
2. [ ] Extend existing source-context plumbing in [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) so existing `startFlowRun` `sourceId` + `listIngestedRepositories` context is passed into command-step resolution used by `validateCommandSteps` and runtime command execution.
3. [ ] Extend existing [loadCommandForAgent](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) resolution behavior with deterministic candidate ordering (do not add a second command parsing/loading path):
   - same-source repository first,
   - codeInfo2 repository second,
   - other repositories sorted by case-insensitive ASCII normalized source label, then case-insensitive ASCII full source path.
4. [ ] Implement same-source schema-invalid/read-failure fail-fast behavior in [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) with no downstream fallback.
5. [ ] Ensure both pre-run command validation and runtime command execution use the same shared resolver path in [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) so behavior does not diverge between validation and execution phases.
6. [ ] Extend integration tests in [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for:
   - same-source success,
   - same-source missing with codeInfo2 fallback,
   - deterministic other-repo fallback ordering,
   - same-source schema-invalid fail-fast.
7. [ ] Update documentation files changed by this task:
   - [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
   - [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts`
6. [ ] `npm run test:summary:server:cucumber`
7. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 12. Documentation synchronization for story 0000040 outputs

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Perform documentation-only updates so product behavior, architecture notes, and repository structure match the final implemented behavior of this story.

#### Documentation Locations (External References Only)

- Markdown guide: https://www.markdownguide.org/basic-syntax/
- Mermaid syntax guide: https://mermaid.js.org/syntax/sequenceDiagram.html

#### Subtasks

1. [ ] Update user-facing behavior notes in [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) for AGENTS start-step behavior and chat-default sourcing.
2. [ ] Update architecture/flow details in [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), including flow command-resolution ordering and start-step contract references.
3. [ ] Update file/module map in [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for any added/removed test or source files from tasks 1-11.
4. [ ] Ensure `openapi.json` documentation reflects final contract shapes from tasks 1-2 and aligns with route behavior.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/openapi.contract.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.

---

### 13. Final verification: full acceptance and regression gate for story 0000040

- Task Status: __to_do__
- Git Commits: __to_do__

#### Overview

Run final end-to-end verification against all acceptance criteria, full builds/tests, docker checks, and manual UI checks with screenshots. This task closes the story and prepares pull-request summary content.

#### Documentation Locations (External References Only)

- Docker docs via Context7: `/docker/docs`
- Playwright docs via Context7: `/microsoft/playwright`
- Jest docs: https://jestjs.io/docs/getting-started
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Validate every acceptance criterion in this plan and record pass/fail notes in this task's Implementation notes.
2. [ ] Run full regression wrappers (server unit/cucumber, client tests, e2e) and log any remediation required.
3. [ ] Run explicit non-regression checks that MCP Agents `run_command` contract remains unchanged for this story scope (no new `startStep` input requirement and no payload shape drift).
4. [ ] Use Playwright MCP manual checks for AGENTS start-step, chat defaults initialization/warnings, and flow resolution failure/success behavior.
5. [ ] Save screenshots to `test-results/screenshots/` using naming format `0000040-13-<short-name>.png`.
6. [ ] Produce pull-request summary text covering all implemented tasks, tests, contract changes, and risks.
7. [ ] Confirm `README.md`, `design.md`, and `projectStructure.md` are fully current.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/mcp-agents-commands-run.test.ts`
7. [ ] `npm run test:summary:server:cucumber`
8. [ ] `npm run test:summary:client`
9. [ ] `npm run test:summary:e2e`
10. [ ] Playwright MCP manual verification with screenshots in `test-results/screenshots/`
11. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.
