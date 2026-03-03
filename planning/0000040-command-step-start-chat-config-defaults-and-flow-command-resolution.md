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
5. Fix a confirmed issue where flows in a repository cannot resolve commands in that same repository while direct command execution from the GUI can still work, using red-green repro tests.

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
- Flow resolution changes must include an automated failing repro test first and a passing fix on the same test.
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
21. Flow resolver changes follow red-green evidence: add an automated failing repro test first, implement fix, then verify passing result on the same test.
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
- If command metadata is loading, start-step remains disabled.
- If command is invalid/disabled, start-step remains disabled and execution remains disabled.
- If command has only one step, start-step remains visible and disabled with `Step 1` selected.

Execution behavior:

- Clicking `Execute command` sends selected `startStep` as `1..N` in the command-run payload.
- Existing run locks, persistence checks, and websocket readiness checks remain unchanged and still gate execution.

Validation and feedback:

- Invalid step requests (out of range, malformed) surface through the existing command error area.
- Command row should preserve existing warning notes (Mongo persistence and websocket requirement).
- If backend rejects start-step, the user should see a specific message tied to that command run attempt, including allowed range (for example: `startStep must be between 1 and 6`).

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
- Env-fallback warnings are shown whenever returned in API response; do not add extra client-side warning replay/persistence logic.

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
- Error wording should be clear and actionable and must not be replaced by fallback-success output from another repository.

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
- Manual repository path validation confirms all linked task file locations in this plan resolve to existing files (including root-level `openapi.json`), so implementation risk is behavioral rather than broken references.
- Additional compatibility risk review confirms start-step changes need explicit websocket + persisted-turn metadata non-regression coverage to prevent downstream rendering/history regressions when runs begin at `startStep > 1`.
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

### Coverage Check (2026-03-03)

This coverage check confirms every acceptance criterion and edge-case group is assigned to concrete implementation tasks.

- AC 1-9 (AGENTS start-step UX + runtime behavior): Tasks 1, 2, 3, 4, 5.
- AC 10-16 (chat defaults + canonical web-search behavior + warnings): Tasks 6, 7, 8, 9.
- AC 17 and AC 26 (SDK pin + runtime guard alignment): Task 10, with final regression confirmation in Task 13.
- AC 18-21 and AC 27-28 (flow command resolution ordering/fail-fast with red-green proof): Task 11, with final regression confirmation in Task 13.
- AC 22-25 (REST contracts for `stepCount` and `startStep`): Tasks 1, 2, 3, 4, 5.

Edge-case mapping confirmation:

- `startStep` omission/range/type/drift and disabled-command behavior: Tasks 1, 2, 3, 5.
- Flow same-source invalid/read-failure fail-fast, ordered fallback, and all-sources-missing behavior: Task 11.
- Chat bootstrap non-destructive behavior and invalid-config fallback/warnings: Tasks 6 and 9.
- SDK drift/pre-release/version-resolution risks: Task 10.
- Cross-surface non-regression (`MCP run_command`, websocket/persistence metadata shape): Tasks 2, 3, and 13.

### 1. Server Message Contract: add `stepCount` to `GET /agents/:agentName/commands`

- Task Status: **done**
- Git Commits:
  - `f421a8b9` — DEV-[0000040] - Add stepCount contract for agent command listings

#### Overview

Add the backend response contract for command list items so the frontend can render `Start step` choices without parsing command files. This task only changes list-message shape and associated tests.

#### Documentation Locations (External References Only)

- Express routing guide: https://expressjs.com/en/guide/routing.html (Used for route handler structure and request/response wiring in `agentsCommands.ts`.)
- OpenAPI 3.1 specification: https://swagger.io/specification/ (Defines how `stepCount` must be represented as a required integer field in the API contract.)
- Node.js test runner API: https://nodejs.org/api/test.html (Source for test patterns used by unit/contract tests in this task.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for task-required lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates in `design.md` and `projectStructure.md`.)

#### Subtasks

1. [x] Add `stepCount: number` to the command summary type and returned summary object in [server/src/agents/commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts).
   - Docs to read first: https://expressjs.com/en/guide/routing.html, https://swagger.io/specification/, https://nodejs.org/api/test.html.
   - Files to read/edit: [commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts).
   - Acceptance criteria coverage: AC 22.
   - Done when: loader-level summary objects always include `stepCount`.
2. [x] Implement the `stepCount` generation rules in [server/src/agents/commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts): valid command file -> `command.items.length`; invalid/disabled command file -> sentinel `1`.
   - Docs to read first: https://swagger.io/specification/, https://nodejs.org/api/test.html.
   - Files to read/edit: [commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts).
   - Acceptance criteria coverage: AC 22, AC 23.
   - Done when: invalid/disabled summaries return `disabled: true` with `stepCount: 1` and valid summaries return actual step counts.
3. [x] Propagate `stepCount` through service and route response wiring in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) and [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
   - Docs to read first: https://expressjs.com/en/guide/routing.html, https://swagger.io/specification/.
   - Files to read/edit: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
   - Acceptance criteria coverage: AC 22, AC 23.
   - Done when: `GET /agents/:agentName/commands` JSON includes `stepCount` for every command item.
4. [x] Add a unit test for valid multi-step command summaries returning exact `stepCount = command.items.length`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts).
   - Description: Build a command fixture with `N > 1` steps and assert returned summary includes `stepCount = N`.
   - Purpose: Happy-path contract coverage for AC 22.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts).
   - Acceptance criteria coverage: AC 22.
   - Done when: test fails if valid command summary omits `stepCount` or reports incorrect value.
5. [x] Add a unit test for single-step command summaries returning `stepCount = 1`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts).
   - Description: Build a single-step command fixture and assert summary preserves `stepCount = 1` (not sentinel-disabled behavior).
   - Purpose: Corner-case coverage for minimum valid step count in AC 22.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts).
   - Acceptance criteria coverage: AC 22.
   - Done when: test fails if valid single-step command is misclassified or step count drifts.
6. [x] Add a unit test for disabled/unreadable command files returning sentinel `stepCount: 1` with `disabled: true`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts).
   - Description: Simulate read/parse failure and assert summary is disabled with sentinel step count.
   - Purpose: Error-path coverage for AC 23.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts).
   - Acceptance criteria coverage: AC 23.
   - Done when: test fails if disabled summary omits sentinel step count.
7. [x] Add a unit test for empty-item parse outcomes returning sentinel `stepCount: 1` with `disabled: true`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts).
   - Description: Simulate parse output that yields no executable items and assert disabled sentinel behavior.
   - Purpose: Corner-case hardening for AC 23.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-list.test.ts).
   - Acceptance criteria coverage: AC 23.
   - Done when: test proves empty/invalid parse outcomes never produce `stepCount < 1`.
8. [x] Add a router unit test ensuring `GET /agents/:agentName/commands` includes `stepCount` in every command item.
   - Test type: `Unit` (route-level).
   - Test location: [server/src/test/unit/agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts).
   - Description: Assert route JSON for both valid and disabled command fixtures always contains `stepCount`.
   - Purpose: Route message-contract coverage for AC 22 and AC 23.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agents-commands-router-list.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-list.test.ts).
   - Acceptance criteria coverage: AC 22, AC 23.
   - Done when: test fails if any returned item omits `stepCount`.
9. [x] Update API documentation in [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json) for required `stepCount` (`integer >= 1`).
   - Docs to read first: https://swagger.io/specification/, https://nodejs.org/api/test.html.
   - Files to read/edit: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json).
   - Acceptance criteria coverage: AC 22, AC 23.
   - Done when: OpenAPI schema requires `stepCount` on command list items.
10. [x] Add a contract test asserting OpenAPI requires `stepCount` with minimum `1`.

- Test type: `Contract`.
- Test location: [server/src/test/unit/openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.contract.test.ts).
- Description: Assert command list response schema marks `stepCount` as required integer with min constraint.
- Purpose: Prevent contract drift between implementation and OpenAPI docs (AC 22, AC 23).
- Docs to read first: https://nodejs.org/api/test.html, https://swagger.io/specification/.
- Files to read/edit: [openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.contract.test.ts).
- Acceptance criteria coverage: AC 22, AC 23.
- Done when: test fails if OpenAPI schema allows missing or invalid `stepCount`.

11. [x] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for this task’s new/changed `stepCount` message contract and related test coverage.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document backend command-list contract updates for required `stepCount` semantics and disabled-command sentinel behavior.
- Purpose: Keep architecture and API-behavior documentation aligned with implementation for AC 22 and AC 23.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 22, AC 23.
- Done when: `design.md` explicitly documents `stepCount` generation rules and response guarantees.

12. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for this task’s added, removed, and modified test/contract files.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Add/update/remove file-map entries for every file added, removed, or modified in this task.
- Purpose: Keep repository structure documentation current for junior implementation traceability.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 22, AC 23.
- Done when: `projectStructure.md` matches the post-task repository state and explicitly includes all added and removed files.

13. [x] Add deterministic diagnostic log marker [DEV_0000040_T01_STEP_COUNT_RESPONSE] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
- Acceptance criteria coverage: AC 22, AC 23.
- Manual Playwright-MCP expected outcome: after loading AGENTS command list, browser debug console shows the marker once per list refresh with `stepCount` values >= 1 for each item.
- Done when: [DEV_0000040_T01_STEP_COUNT_RESPONSE] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

14. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [x] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Subtask 1: Added required `stepCount: number` to `loadAgentCommandSummary` return shape and included it in both valid/invalid summary branches.
- Subtask 2: Implemented `stepCount` generation as `command.items.length` for valid files with a defensive fallback to disabled sentinel `stepCount: 1` for invalid/empty outcomes.
- Subtask 3: Added `stepCount` to `AgentCommandSummary` so service and route list payloads carry the required field end-to-end.
- Subtask 4: Added loader unit coverage for valid multi-step commands asserting exact `stepCount = command.items.length`.
- Subtask 5: Added loader unit coverage for valid single-step commands asserting `stepCount = 1` on non-disabled entries.
- Subtask 6: Added loader unit coverage asserting invalid/unreadable command summaries return `disabled: true` with sentinel `stepCount: 1`.
- Subtask 7: Added explicit empty-items parse-outcome unit coverage enforcing disabled sentinel `stepCount: 1`.
- Subtask 8: Added route-level unit coverage asserting every `GET /agents/:agentName/commands` item includes numeric `stepCount >= 1`.
- Subtask 9: Updated `openapi.json` command-list item schema to require integer `stepCount` with `minimum: 1`.
- Subtask 10: Added OpenAPI contract test coverage that fails when `stepCount` is missing or allows values below `1`.
- Subtask 11: Updated `design.md` to document required `stepCount` contract, sentinel behavior, and task-specific contract-test coverage.
- Subtask 12: Updated `projectStructure.md` entries for commands loader and command-list tests to reflect `stepCount` contract behavior.
- Subtask 13: Added deterministic server log marker `DEV_0000040_T01_STEP_COUNT_RESPONSE` in agents command-list flow with per-command `stepCount` context.
- Subtask 14: Ran `npm run lint --workspaces` (pass, warnings only) and `npm run format:check --workspaces` (server/common pass after formatting task files; client still fails on pre-existing unrelated files `client/src/pages/AgentsPage.tsx` and `client/src/test/agentsPage.descriptionPopover.test.tsx`).
- Testing 1: `npm run build:summary:server` passed after updating MCP command-list unit fixtures to include required `stepCount`.
- Testing 2: `npm run test:summary:server:unit` passed (`921/921`) after updating `agent-commands-loader` assertions for the new `stepCount` field.

---

### 2. Server Message Contract: add optional `startStep` to `POST /agents/:agentName/commands/run` and deterministic validation error mapping

- Task Status: **done**
- Git Commits:
  - `cf6d702d` — DEV-[0000040] - Add Task 2 startStep route contract and validation mapping

#### Overview

Add the run-request message contract for optional `startStep` with strict input validation and deterministic `INVALID_START_STEP` response shape. This task is route/service boundary only and does not change execution loop behavior yet.

#### Documentation Locations (External References Only)

- Express routing guide: https://expressjs.com/en/guide/routing.html (Used for route parsing/validation behavior in `POST /agents/:agentName/commands/run`.)
- HTTP status reference (MDN): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status (Defines correct `400` semantics for deterministic validation failures.)
- TypeScript functions handbook: https://www.typescriptlang.org/docs/handbook/2/functions.html (Used for optional `startStep` type signatures and route/service contract typing.)
- OpenAPI 3.1 specification: https://swagger.io/specification/ (Used to document optional `startStep` and `INVALID_START_STEP` error payload schema.)
- Node.js test runner API: https://nodejs.org/api/test.html (Source for route and MCP non-regression test assertions.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates in `design.md` and `projectStructure.md`.)

#### Subtasks

1. [x] Extend run-route request parsing in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts) so `startStep` is optional in `POST /agents/:agentName/commands/run`.
   - Docs to read first: https://expressjs.com/en/guide/routing.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
   - Files to read/edit: [agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
   - Acceptance criteria coverage: AC 6, AC 24.
   - Done when: route accepts payloads both with and without `startStep`.
2. [x] Implement route-level `startStep` shape checks in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts): omitted allowed; when present must be integer.
   - Docs to read first: https://expressjs.com/en/guide/routing.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
   - Files to read/edit: [agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
   - Acceptance criteria coverage: AC 7, AC 24, AC 25.
   - Done when: non-integer `startStep` requests return `400 invalid_request`.
3. [x] Add deterministic `INVALID_START_STEP` error mapping in [server/src/routes/agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts) with exact payload `400 { error: 'invalid_request', code: 'INVALID_START_STEP', message: 'startStep must be between 1 and N' }`.
   - Docs to read first: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
   - Files to read/edit: [agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts).
   - Acceptance criteria coverage: AC 7, AC 25.
   - Done when: route always returns the required code/message shape for this error type.
4. [x] Extend run-service input types in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) to include optional `startStep` without changing runner execution logic in this task.
   - Docs to read first: https://www.typescriptlang.org/docs/handbook/2/functions.html.
   - Files to read/edit: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts).
   - Acceptance criteria coverage: AC 24.
   - Done when: service compiles with optional `startStep` in route-to-service contracts.
5. [x] Add a route unit test for backward compatibility where request omits `startStep` and is accepted.
   - Test type: `Unit` (route-level).
   - Test location: [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Description: Send `POST /agents/:agentName/commands/run` without `startStep` and assert request is accepted.
   - Purpose: Happy-path backward compatibility coverage for AC 24.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Acceptance criteria coverage: AC 24.
   - Done when: test fails if omitted `startStep` is rejected.
6. [x] Add a route unit test for string `startStep` values returning `400 invalid_request`.
   - Test type: `Unit` (route-level).
   - Test location: [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Description: Use `startStep: "2"` and assert deterministic rejection.
   - Purpose: Error-path type validation coverage for AC 7 and AC 25.
   - Docs to read first: https://nodejs.org/api/test.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
   - Files to read/edit: [agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Acceptance criteria coverage: AC 7, AC 25.
   - Done when: test fails if string values are accepted.
7. [x] Add a route unit test for fractional `startStep` values returning `400 invalid_request`.
   - Test type: `Unit` (route-level).
   - Test location: [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Description: Use `startStep: 2.5` and assert deterministic rejection.
   - Purpose: Error-path integer-only contract coverage for AC 7 and AC 25.
   - Docs to read first: https://nodejs.org/api/test.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
   - Files to read/edit: [agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Acceptance criteria coverage: AC 7, AC 25.
   - Done when: test fails if fractional values are accepted.
8. [x] Add a route unit test for boolean `startStep` values returning `400 invalid_request`.
   - Test type: `Unit` (route-level).
   - Test location: [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Description: Use `startStep: true` and assert deterministic rejection.
   - Purpose: Error-path contract coverage for AC 7 and AC 25.
   - Docs to read first: https://nodejs.org/api/test.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
   - Files to read/edit: [agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Acceptance criteria coverage: AC 7, AC 25.
   - Done when: test fails if boolean values are accepted.
9. [x] Add a route unit test for `null` `startStep` values returning `400 invalid_request`.
   - Test type: `Unit` (route-level).
   - Test location: [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Description: Use `startStep: null` and assert deterministic rejection.
   - Purpose: Error-path null-handling coverage for AC 7 and AC 25.
   - Docs to read first: https://nodejs.org/api/test.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
   - Files to read/edit: [agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
   - Acceptance criteria coverage: AC 7, AC 25.
   - Done when: test fails if null values are accepted.
10. [x] Add a route unit test for deterministic `INVALID_START_STEP` error payload shape.

- Test type: `Unit` (route-level).
- Test location: [server/src/test/unit/agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
- Description: Assert response includes `error`, `code`, and exact `message` format when start step validation fails.
- Purpose: Error-contract stability coverage for AC 25.
- Docs to read first: https://nodejs.org/api/test.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
- Files to read/edit: [agents-commands-router-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agents-commands-router-run.test.ts).
- Acceptance criteria coverage: AC 25.
- Done when: test fails if code or message format drifts.

11. [x] Add an MCP regression test proving `run_command` tool input schema still has no `startStep`.

- Test type: `Unit` (MCP contract).
- Test location: [server/src/test/unit/mcp-agents-commands-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp-agents-commands-run.test.ts).
- Description: Assert MCP schema in [server/src/mcpAgents/tools.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcpAgents/tools.ts) remains unchanged for `run_command`.
- Purpose: Non-regression coverage for AC 8 and AC 24.
- Docs to read first: https://nodejs.org/api/test.html.
- Files to read/edit: [mcp-agents-commands-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp-agents-commands-run.test.ts), [tools.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcpAgents/tools.ts).
- Acceptance criteria coverage: AC 8, AC 24.
- Done when: test fails if `startStep` appears in MCP tool schema.

12. [x] Update [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json) for optional `startStep` and `INVALID_START_STEP` error shape.

- Docs to read first: https://swagger.io/specification/, https://nodejs.org/api/test.html.
- Files to read/edit: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json).
- Acceptance criteria coverage: AC 24, AC 25.
- Done when: OpenAPI schema matches runtime request/response shapes.

13. [x] Add a contract test asserting OpenAPI `run` request marks `startStep` optional and `INVALID_START_STEP` error payload is documented.

- Test type: `Contract`.
- Test location: [server/src/test/unit/openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.contract.test.ts).
- Description: Assert schema constraints for request body and error response fields/code/message.
- Purpose: Prevent OpenAPI/runtime drift for AC 24 and AC 25.
- Docs to read first: https://nodejs.org/api/test.html, https://swagger.io/specification/.
- Files to read/edit: [openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.contract.test.ts).
- Acceptance criteria coverage: AC 24, AC 25.
- Done when: test fails if contract allows required `startStep` or omits error fields.

14. [x] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for `POST /agents/:agentName/commands/run` optional `startStep` request contract and `INVALID_START_STEP` response mapping.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document optional `startStep`, backward-compatible omission behavior, deterministic validation failures, and unchanged MCP scope.
- Purpose: Ensure contract and behavior documentation stays aligned with server-side implementation for AC 24 and AC 25.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 24, AC 25.
- Done when: `design.md` clearly describes optional `startStep` and deterministic `INVALID_START_STEP` response behavior.

15. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for all task-2 added, removed, and modified files.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Reflect all route/service/OpenAPI/test files added, removed, or modified in this task.
- Purpose: Keep the codebase map accurate for junior developers implementing or validating this task in isolation.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 24, AC 25.
- Done when: `projectStructure.md` contains accurate entries for all added and removed files (and any modified files) in this task.

16. [x] Add deterministic diagnostic log marker [DEV_0000040_T02_START_STEP_VALIDATION] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [agentsCommands.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/agentsCommands.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts).
- Acceptance criteria coverage: AC 7, AC 24, AC 25.
- Manual Playwright-MCP expected outcome: executing AGENTS command runs logs marker entries for both valid and invalid `startStep` attempts, and invalid attempts include `INVALID_START_STEP` in the marker payload.
- Done when: [DEV_0000040_T02_START_STEP_VALIDATION] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

17. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [x] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Subtasks 1-3: Extended `POST /agents/:agentName/commands/run` parsing to accept optional `startStep`, validate integer-only shape when present, and map invalid values to deterministic `INVALID_START_STEP` `400` payloads.
- Subtask 4: Extended `startAgentCommand`/`runAgentCommand` input types with optional `startStep` without modifying runner execution behavior.
- Subtasks 5-10: Added route-unit coverage for omitted `startStep` acceptance plus string/fractional/boolean/null rejection and deterministic `INVALID_START_STEP` payload assertions.
- Subtask 11: Added MCP regression checks proving `run_command` schema/input remains unchanged and rejects unexpected `startStep`.
- Subtasks 12-13: Updated OpenAPI for optional `startStep` and deterministic `INVALID_START_STEP` response, then added contract tests for both.
- Subtasks 14-15: Updated design and project structure documentation for the Task 2 request/response contract and test coverage changes.
- Subtask 16: Added deterministic marker `DEV_0000040_T02_START_STEP_VALIDATION` in route/service paths for valid and invalid `startStep` attempts.
- Subtask 17: Ran `npm run lint --workspaces` (pass, warnings only) and `npm run format:check --workspaces` (server/common pass; client still fails on pre-existing unrelated files `client/src/pages/AgentsPage.tsx` and `client/src/test/agentsPage.descriptionPopover.test.tsx`).
- Testing 1: `npm run build:summary:server` passed (`status: passed`, `warnings: 0`).
- Testing 2: `npm run test:summary:server:unit` passed (`930/930`, `failed: 0`) with log `test-results/server-unit-tests-2026-03-03T19-50-43-423Z.log`.

---

### 3. Server Behavior: execute command runs from `startStep` with backward compatibility

- Task Status: **done**
- Git Commits:
  - `e9cc7692` — DEV-[0000040] - Implement Task 3 command runner startStep execution behavior

#### Overview

Implement runtime start-step behavior in the command runner. This task covers start index calculation, range validation against loaded command content, and default behavior when `startStep` is omitted.

#### Documentation Locations (External References Only)

- TypeScript functions handbook: https://www.typescriptlang.org/docs/handbook/2/functions.html (Used for `startStep` typing, runtime boundary conversion, and narrowing.)
- HTTP status reference (MDN): https://developer.mozilla.org/en-US/docs/Web/HTTP/Status (Used to keep `INVALID_START_STEP` error semantics consistent.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for runner unit/integration assertions.)
- Cucumber guides index: https://cucumber.io/docs/guides/ (Primary Cucumber documentation root for this task's cucumber-suite verification references.)
- Cucumber guides (parallel execution): https://cucumber.io/docs/guides/parallel-execution/ (Used as the Cucumber reference for this task's cucumber-suite verification step.)
- Mermaid docs via Context7: `/mermaid-js/mermaid` (Use Mermaid syntax guidance when updating `design.md` execution-flow diagrams for this task.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for wrapper command execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [x] Add optional `startStep` handling in [server/src/agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) for both `startAgentCommand` and `runAgentCommand`, defaulting omitted values to `1`.
   - Docs to read first: https://www.typescriptlang.org/docs/handbook/2/functions.html, https://nodejs.org/api/test.html.
   - Files to read/edit: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts).
   - Acceptance criteria coverage: AC 6, AC 24.
   - Done when: both service entry paths pass `startStep=1` when caller omits it.
2. [x] Update runner execution entrypoint in [server/src/agents/commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) to validate `startStep` against runtime total steps, convert `1..N` to zero-based index at boundary, and execute from selected step.
   - Docs to read first: https://www.typescriptlang.org/docs/handbook/2/functions.html.
   - Files to read/edit: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts).
   - Acceptance criteria coverage: AC 6, AC 9, AC 24.
   - Done when: runner starts at selected step and still emits normal step metadata for remaining steps.
3. [x] Throw typed `INVALID_START_STEP` runtime errors in [server/src/agents/commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) for out-of-range values.
   - Docs to read first: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status.
   - Files to read/edit: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts).
   - Acceptance criteria coverage: AC 7, AC 25.
   - Done when: out-of-range values fail deterministically with route-mapped code/message.
4. [x] Add a runner unit test for omitted `startStep` defaulting to `1`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Description: Run command without `startStep` and assert execution begins at first step.
   - Purpose: Happy-path backward compatibility coverage for AC 24.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Acceptance criteria coverage: AC 24.
   - Done when: test fails if omitted value does not start at step 1.
5. [x] Add a runner unit test for valid non-default `startStep` execution offsets.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Description: Run with `startStep > 1` and assert skipped earlier steps and correct emitted metadata.
   - Purpose: Happy-path execution-offset coverage for AC 6 and AC 9.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Acceptance criteria coverage: AC 6, AC 9.
   - Done when: test fails if runner still starts at step 1.
6. [x] Add a runner unit test for lower-bound `startStep = 1`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Description: Assert boundary value `1` is accepted and executes full command.
   - Purpose: Boundary happy-path coverage for AC 6 and AC 25.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Acceptance criteria coverage: AC 6, AC 25.
   - Done when: test fails if boundary lower value is rejected.
7. [x] Add a runner unit test for upper-bound `startStep = N`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Description: Assert boundary value `N` executes only final step and succeeds.
   - Purpose: Boundary happy-path coverage for AC 6 and AC 25.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Acceptance criteria coverage: AC 6, AC 25.
   - Done when: test fails if upper valid boundary is rejected.
8. [x] Add a runner unit test for out-of-range `startStep = 0`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Description: Assert deterministic `INVALID_START_STEP` failure with message `startStep must be between 1 and N`.
   - Purpose: Error-path range validation coverage for AC 7 and AC 25.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Acceptance criteria coverage: AC 7, AC 25.
   - Done when: test fails if lower out-of-range values are accepted or message drifts.
9. [x] Add a runner unit test for out-of-range `startStep = N+1`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Description: Assert deterministic `INVALID_START_STEP` failure with message `startStep must be between 1 and N`.
   - Purpose: Error-path range validation coverage for AC 7 and AC 25.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts).
   - Acceptance criteria coverage: AC 7, AC 25.
   - Done when: test fails if upper out-of-range values are accepted or message drifts.
10. [x] Add an integration test for omission behavior on `startAgentCommand` entry path.

- Test type: `Integration`.
- Test location: [server/src/test/integration/agents-run-client-conversation-id.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-client-conversation-id.test.ts).
- Description: Execute command through the `startAgentCommand` path without `startStep` and assert run begins at step 1.
- Purpose: Backward compatibility coverage for AC 24 across service entry points.
- Docs to read first: https://nodejs.org/api/test.html.
- Files to read/edit: [agents-run-client-conversation-id.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-client-conversation-id.test.ts).
- Acceptance criteria coverage: AC 24.
- Done when: test fails if omission path diverges from step-1 default.

11. [x] Add an integration test for omission behavior on `runAgentCommand` entry path.

- Test type: `Integration`.
- Test location: [server/src/test/integration/agents-run-client-conversation-id.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-client-conversation-id.test.ts).
- Description: Execute command through the `runAgentCommand` path without `startStep` and assert run begins at step 1.
- Purpose: Backward compatibility coverage for AC 24 across service entry points.
- Docs to read first: https://nodejs.org/api/test.html.
- Files to read/edit: [agents-run-client-conversation-id.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-client-conversation-id.test.ts).
- Acceptance criteria coverage: AC 24.
- Done when: test fails if omission path diverges from step-1 default.

12. [x] Add an integration websocket-stream test proving `startStep > 1` preserves absolute command metadata (`stepIndex`, `totalSteps`) in emitted conversation events.

- Test type: `Integration` (websocket).
- Test location: [server/src/test/integration/agents-run-ws-stream.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-ws-stream.test.ts).
- Description: Execute a command with `startStep > 1` and assert websocket stream metadata uses absolute step numbering (for example step 3 of N), not restarted numbering.
- Purpose: Prevent websocket consumer regressions while introducing start-step execution offsets.
- Docs to read first: https://nodejs.org/api/test.html.
- Files to read/edit: [agents-run-ws-stream.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-ws-stream.test.ts).
- Acceptance criteria coverage: AC 6, AC 24.
- Done when: test fails if websocket metadata shifts to relative numbering or incorrect totals.

13. [x] Add an integration persistence test proving `startStep > 1` preserves stored turn command metadata (`stepIndex`, `totalSteps`) for conversation history.

- Test type: `Integration` (persistence).
- Test location: [server/src/test/integration/conversations.turns.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/conversations.turns.test.ts).
- Description: Execute a command from a non-default start step and assert persisted turns keep stable command metadata shape with absolute step numbering.
- Purpose: Prevent history-render regressions in existing conversation views and APIs.
- Docs to read first: https://nodejs.org/api/test.html.
- Files to read/edit: [conversations.turns.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/conversations.turns.test.ts).
- Acceptance criteria coverage: AC 6, AC 24.
- Done when: test fails if persisted turn metadata shape or numbering semantics drift.

14. [x] Add an integration test for step-count drift where command metadata is stale but runtime command file has fewer steps, and assert deterministic `INVALID_START_STEP` failure is returned.

- Test type: `Integration`.
- Test location: [server/src/test/integration/agents-run-client-conversation-id.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-client-conversation-id.test.ts).
- Description: Simulate command-list metadata for higher `N`, reduce command file steps before execution, submit old `startStep`, and assert runtime range validation rejects the request.
- Purpose: Corner-case runtime source-of-truth coverage for AC 7, AC 24, and AC 25.
- Docs to read first: https://nodejs.org/api/test.html.
- Files to read/edit: [agents-run-client-conversation-id.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-client-conversation-id.test.ts).
- Acceptance criteria coverage: AC 7, AC 24, AC 25.
- Done when: test fails if stale client metadata can bypass runtime range validation.

15. [x] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for runtime `startStep` execution behavior and validation paths, including a Mermaid sequence diagram for execution flow and invalid-range failure handling.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document runtime `startStep` boundary conversion, omitted-value defaults, and deterministic error propagation path.
- Purpose: Preserve accurate execution-path documentation for AC 6, AC 7, AC 24, and AC 25.
- Docs to read first: `/mermaid-js/mermaid`, https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 6, AC 7, AC 24, AC 25.
- Done when: `design.md` includes correct runtime behavior and valid Mermaid syntax for the flow/error diagram.

16. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for task-3 runner/service/test files added, removed, or modified.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Record all runner/service/test files added, removed, or modified for this task.
- Purpose: Keep repository structure documentation synchronized for isolated subtask implementation.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 6, AC 7, AC 24, AC 25.
- Done when: `projectStructure.md` accurately reflects task-3 file layout and explicitly lists all added and removed files.

17. [x] Add deterministic diagnostic log marker [DEV_0000040_T03_RUNNER_START_STEP] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts).
- Acceptance criteria coverage: AC 6, AC 24, AC 25.
- Manual Playwright-MCP expected outcome: command execution from a non-default step logs marker once at run start with selected `startStep` and runtime `totalSteps` values.
- Done when: [DEV_0000040_T03_RUNNER_START_STEP] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

18. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [x] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber`
   - Use for server Cucumber feature/step coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands (`--tags` / `--feature` / `--scenario`), then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtasks 1-3: Defaulted omitted `startStep` to `1` in both service entrypoints, passed `startStep` through to the runner, added runtime `1..N` validation in `runAgentCommandRunner`, and started execution from zero-based `startIndex = startStep - 1`.
- Subtasks 4-9: Added runner unit coverage for omitted/default `startStep`, non-default offsets, both valid boundaries (`1`, `N`), and deterministic `INVALID_START_STEP` errors for `0` and `N+1`.
- Subtasks 10-11: Added integration coverage for both service entrypoints (`startAgentCommand` and `runAgentCommand`) proving omitted `startStep` runs from step 1.
- Subtask 12: Added websocket integration coverage proving `startStep > 1` preserves absolute command metadata (`stepIndex`, `totalSteps`) in streamed inflight snapshots.
- Subtask 13: Added conversation-turns integration coverage proving persisted `command` metadata keeps absolute step numbering for start-step offset histories.
- Subtask 14: Added integration coverage for runtime step-count drift rejection with deterministic `INVALID_START_STEP` reason text from runtime command file step count.
- Subtask 15: Updated command-run design docs to describe service defaulting, runner boundary conversion, runtime range validation, and `INVALID_START_STEP` failure propagation with an updated Mermaid sequence.
- Subtask 16: Updated `projectStructure.md` entries for Task 3-modified runner/service/test files and expanded test coverage descriptions.
- Subtask 17: Added deterministic `DEV_0000040_T03_RUNNER_START_STEP` marker emissions at service defaulting and runner start stages with selected `startStep` and runtime `totalSteps` context.
- Subtask 18: Ran `npm run lint --workspaces` (pass with existing repo-wide import-order warnings) and `npm run format:check --workspaces`; formatted new server integration tests, then re-ran format checks (server/common pass; client still fails on pre-existing files `client/src/pages/AgentsPage.tsx` and `client/src/test/agentsPage.descriptionPopover.test.tsx`).
- Testing 1: `npm run build:summary:server` passed (`status: passed`, `warnings: 0`) with log `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run test:summary:server:unit` passed (`tests run: 941`, `failed: 0`) with log `test-results/server-unit-tests-2026-03-03T20-12-33-615Z.log`.
- Testing 3: `npm run test:summary:server:cucumber` passed (`tests run: 68`, `failed: 0`) with log `test-results/server-cucumber-tests-2026-03-03T20-21-20-484Z.log`.

---

### 4. Client Message Contract: consume `stepCount` and send `startStep` in agents API layer

- Task Status: **done**
- Git Commits:
  - `1106970d` — DEV-[0000040] - Implement Task 4 client command API stepCount/startStep contract

#### Overview

Update the frontend API layer contracts to match backend message changes. This task is limited to API types, request payloads, and API-layer tests.

#### Documentation Locations (External References Only)

- Fetch API reference (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API (Used for request serialization and payload-shape handling in `client/src/api/agents.ts`.)
- TypeScript type compatibility: https://www.typescriptlang.org/docs/handbook/type-compatibility.html (Used for API contract type changes around required `stepCount` and optional `startStep`.)
- Jest docs via Context7: `/jestjs/jest` (Primary Jest MCP reference for writing/updating client unit tests in this task.)
- Jest getting started: https://jestjs.io/docs/getting-started (Used for API-layer test structure and assertions.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [x] Add `stepCount` to command-list response types in [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts) and ensure parser logic treats it as required.
   - Docs to read first: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, https://www.typescriptlang.org/docs/handbook/type-compatibility.html.
   - Files to read/edit: [agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts).
   - Acceptance criteria coverage: AC 22, AC 23.
   - Done when: client API types compile only when `stepCount` is present.
2. [x] Add optional `startStep` to run-request types and serialization in [client/src/api/agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts), ensuring omitted field remains possible for backward compatibility.
   - Docs to read first: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, https://www.typescriptlang.org/docs/handbook/type-compatibility.html.
   - Files to read/edit: [agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts).
   - Acceptance criteria coverage: AC 6, AC 24.
   - Done when: API wrapper sends `startStep` only when provided by caller.
3. [x] Add an API unit test for valid command-list payload parsing with required `stepCount`.
   - Test type: `Unit` (client API wrapper).
   - Test location: [client/src/test/agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Description: Mock command-list response including valid `stepCount` and assert parsed output is accepted.
   - Purpose: Happy-path client contract coverage for AC 22.
   - Docs to read first: https://jestjs.io/docs/getting-started.
   - Files to read/edit: [agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Acceptance criteria coverage: AC 22.
   - Done when: test fails if valid `stepCount` payload is rejected.
4. [x] Add an API unit test that rejects command-list payloads missing required `stepCount`.
   - Test type: `Unit` (client API wrapper).
   - Test location: [client/src/test/agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Description: Mock response without `stepCount` and assert parser throws/rejects.
   - Purpose: Error-path client contract coverage for AC 23.
   - Docs to read first: https://jestjs.io/docs/getting-started.
   - Files to read/edit: [agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Acceptance criteria coverage: AC 23.
   - Done when: test fails if missing `stepCount` payload is accepted.
5. [x] Add an API unit test that includes `startStep` in run payload when caller provides it.
   - Test type: `Unit` (client API wrapper).
   - Test location: [client/src/test/agentsApi.commandsRun.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsRun.test.ts).
   - Description: Call run API with `startStep` and assert serialized request includes integer `startStep`.
   - Purpose: Happy-path payload coverage for AC 6.
   - Docs to read first: https://jestjs.io/docs/getting-started.
   - Files to read/edit: [agentsApi.commandsRun.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsRun.test.ts).
   - Acceptance criteria coverage: AC 6.
   - Done when: test fails if provided `startStep` is not serialized.
6. [x] Add an API unit test that omits `startStep` in run payload when caller does not provide it.
   - Test type: `Unit` (client API wrapper).
   - Test location: [client/src/test/agentsApi.commandsRun.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsRun.test.ts).
   - Description: Call run API without `startStep` and assert request body does not include the field.
   - Purpose: Backward compatibility coverage for AC 24.
   - Docs to read first: https://jestjs.io/docs/getting-started.
   - Files to read/edit: [agentsApi.commandsRun.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsRun.test.ts).
   - Acceptance criteria coverage: AC 24.
   - Done when: test fails if wrapper always sends `startStep`.
7. [x] Add an API unit test rejecting `stepCount = 0` payloads.
   - Test type: `Unit` (client API wrapper).
   - Test location: [client/src/test/agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Description: Mock `stepCount: 0` and assert parser rejects invalid value.
   - Purpose: Corner-case contract hardening for AC 22 and AC 23.
   - Docs to read first: https://jestjs.io/docs/getting-started.
   - Files to read/edit: [agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Acceptance criteria coverage: AC 22, AC 23.
   - Done when: test fails if zero step count is accepted.
8. [x] Add an API unit test rejecting negative `stepCount` payloads.
   - Test type: `Unit` (client API wrapper).
   - Test location: [client/src/test/agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Description: Mock negative `stepCount` and assert parser rejects invalid value.
   - Purpose: Corner-case contract hardening for AC 22 and AC 23.
   - Docs to read first: https://jestjs.io/docs/getting-started.
   - Files to read/edit: [agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Acceptance criteria coverage: AC 22, AC 23.
   - Done when: test fails if negative step counts are accepted.
9. [x] Add an API unit test rejecting non-numeric `stepCount` payloads.
   - Test type: `Unit` (client API wrapper).
   - Test location: [client/src/test/agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Description: Mock string/object `stepCount` and assert parser rejects invalid type.
   - Purpose: Error-path contract hardening for AC 22 and AC 23.
   - Docs to read first: https://jestjs.io/docs/getting-started, https://www.typescriptlang.org/docs/handbook/type-compatibility.html.
   - Files to read/edit: [agentsApi.commandsList.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsApi.commandsList.test.ts).
   - Acceptance criteria coverage: AC 22, AC 23.
   - Done when: test fails if non-numeric step counts are accepted.
10. [x] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for client API contract changes to required `stepCount` and optional `startStep`.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document client-side request/response type expectations and validation behavior for the updated AGENTS API contract.
- Purpose: Keep design-level contract documentation aligned with frontend API changes for AC 6, AC 22, and AC 24.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 6, AC 22, AC 24.
- Done when: `design.md` accurately describes client API payload/response shapes and constraints.

11. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for task-4 API/test files added, removed, or modified.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Record every AGENTS API client contract/test file added, removed, or modified in this task.
- Purpose: Provide a correct file map for junior developers working task-4 subtasks in isolation.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 6, AC 22, AC 24.
- Done when: `projectStructure.md` entries match task-4 file changes and include all added and removed files.

12. [x] Add deterministic diagnostic log marker [DEV_0000040_T04_CLIENT_AGENTS_API] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [agents.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/api/agents.ts).
- Acceptance criteria coverage: AC 6, AC 22, AC 24.
- Manual Playwright-MCP expected outcome: when executing from AGENTS UI, browser debug console logs marker with outbound payload shape showing `startStep` present when selected and omitted when not provided.
- Done when: [DEV_0000040_T04_CLIENT_AGENTS_API] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

13. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:client`
   - Use when client/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log`.
2. [x] `npm run test:summary:client`
   - Use when client/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/client-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--subset` / `--test-name`), then rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary`
   - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log`.
4. [x] `npm run compose:up`
   - Start the dockerized app stack before manual Playwright-MCP checks.
5. [x] Manual Playwright-MCP check (http://host.docker.internal:5001)
   - Validate frontend API contract integration by executing AGENTS command flows and confirming marker `[DEV_0000040_T04_CLIENT_AGENTS_API]` appears with expected payload semantics.
   - Capture screenshots proving GUI/API integration outcomes (for example AGENTS command selection state before execute, and post-execute UI state) and store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped via `docker-compose.local.yml`).
   - Expected outcome: screenshots and console/network observations confirm the UI remains stable while `startStep` payload behavior matches this task contract, and the agent reviews screenshots to verify GUI expectations are met.
6. [x] `npm run compose:down`
   - Stop the dockerized app stack after manual checks complete.

#### Implementation notes

- Subtask 1: Updated `listAgentCommands` contract/types to require `stepCount` and fail fast on invalid command entries missing integer `stepCount >= 1`.
- Subtask 2: Extended `runAgentCommand` params with optional `startStep` and serialized it only when provided to preserve omission/backward compatibility.
- Subtasks 3-4: Added client API list tests covering valid required `stepCount` parsing and rejection when `stepCount` is missing.
- Subtasks 5-6: Added command-run API tests asserting `startStep` is included when provided and omitted when absent.
- Subtasks 7-9: Added list payload rejection tests for invalid `stepCount` values (`0`, negative, non-numeric).
- Subtask 10: Updated `design.md` with Task 4 client API contract expectations for required `stepCount`, optional `startStep`, and command-run request/response behavior.
- Subtask 11: Updated `projectStructure.md` with a dedicated Story 0000040 Task 4 ledger and refreshed API/test file-map descriptions.
- Subtask 12: Added deterministic client API marker `DEV_0000040_T04_CLIENT_AGENTS_API` in `runAgentCommand` with `includesStartStep` and `startStep` context fields.
- Subtask 13: Ran `npm run lint --workspaces` (pass, warnings only) and `npm run format:check --workspaces`; formatted Task 4 API/test files, then re-ran format check (server/common pass; client still fails on pre-existing files `client/src/pages/AgentsPage.tsx` and `client/src/test/agentsPage.descriptionPopover.test.tsx`).
- Testing 1: `npm run build:summary:client` passed (`status: passed`) with one Vite chunk-size warning (existing bundle-size warning class) and log `logs/test-summaries/build-client-latest.log`.
- Testing 2: `npm run test:summary:client` passed (`458/458`, `failed: 0`) after updating Agents-page command-list fixtures to include required `stepCount`; log `test-results/client-tests-2026-03-03T20-34-38-579Z.log`.
- Testing 3: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`) with log `logs/test-summaries/compose-build-latest.log`.
- Testing 4: `npm run compose:up` succeeded and started the dockerized stack (`client`, `server`, `mongo`, `chroma`, and supporting services all up/healthy).
- Testing 5: Manual Playwright verification against `http://host.docker.internal:5001/agents` confirmed marker `DEV_0000040_T04_CLIENT_AGENTS_API` on execute with payload context `{ includesStartStep: false, startStep: null }`; screenshots captured to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/task4-before-execute.png` and `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/task4-after-execute.png`.
- Testing 6: `npm run compose:down` completed successfully and shut down all compose services/networks after manual verification.

---

### 5. Frontend: AGENTS `Start step` control behavior and execution wiring

- Task Status: **done**
- Git Commits:
  - `a4408187` — DEV-[0000040] - Implement Task 5 AGENTS start-step UI and execution wiring

#### Overview

Implement AGENTS page UI behavior for selecting and validating start step using backend-provided `stepCount`. This task only covers page state, control rendering, and execute payload wiring.

#### Documentation Locations (External References Only)

- MUI MCP index (`@mui/material` 6.4.12): https://llms.mui.com/material-ui/6.4.12/llms.txt (Primary MCP source for component/API pages aligned with the repository's MUI 6.x line.)
- MUI Select component docs: https://mui.com/material-ui/react-select/ (Used for `Select` option rendering and accessibility behavior.)
- MUI FormControl API docs: https://mui.com/material-ui/api/form-control/ (Used for `FormControl` disabled/error/label wiring on the AGENTS page.)
- React state management: https://react.dev/learn/managing-state (Used for deterministic `Start step` state/reset rules.)
- Fetch API reference (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API (Used for execute-request payload behavior expectations.)
- Testing Library jest-dom: https://testing-library.com/docs/ecosystem-jest-dom/ (Used for UI state/visibility/error assertions.)
- Jest docs via Context7: `/jestjs/jest` (Primary Jest MCP reference for component/UI test authoring in this task.)
- Jest getting started: https://jestjs.io/docs/getting-started (Used for frontend test file patterns.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [x] Add a labeled `Start step` `FormControl + Select` immediately after command select in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), using MUI label/id pairing.
   - Docs to read first: https://mui.com/material-ui/react-select/, https://mui.com/material-ui/api/form-control/, https://react.dev/learn/managing-state.
   - Files to read/edit: [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
   - Acceptance criteria coverage: AC 1, AC 5.
   - Done when: control is visible in row order and properly labeled for keyboard/a11y.
2. [x] Implement `Start step` state rules in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx): disabled before command metadata, options `Step 1..Step N`, reset to `1` on command change, disabled when `N=1`.
   - Docs to read first: https://react.dev/learn/managing-state, https://mui.com/material-ui/react-select/.
   - Files to read/edit: [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
   - Acceptance criteria coverage: AC 2, AC 3, AC 4, AC 5.
   - Done when: state transitions match these four rules in UI interactions.
3. [x] Wire execute action payload in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx) so REST run calls include selected `startStep` integer.
   - Docs to read first: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API.
   - Files to read/edit: [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
   - Acceptance criteria coverage: AC 6.
   - Done when: outbound run request body contains correct `startStep` value.
4. [x] Add a UI test that `Start step` control is visible and positioned after command selection.
   - Test type: `Component/UI`.
   - Test location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Description: Render AGENTS command row and assert the labeled `Start step` control appears in expected order.
   - Purpose: Happy-path visual/structure coverage for AC 1.
   - Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/, https://jestjs.io/docs/getting-started.
   - Files to read/edit: [agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Acceptance criteria coverage: AC 1.
   - Done when: test fails if control is missing or misplaced.
5. [x] Add a UI test that `Start step` is disabled before valid command metadata loads.
   - Test type: `Component/UI`.
   - Test location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Description: Assert disabled state before command selection/metadata readiness.
   - Purpose: State-guard coverage for AC 2.
   - Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/.
   - Files to read/edit: [agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Acceptance criteria coverage: AC 2.
   - Done when: test fails if control becomes active too early.
6. [x] Add a UI test for options rendering exactly `Step 1..Step N` and default selection `Step 1`.
   - Test type: `Component/UI`.
   - Test location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Description: Select a command with known `stepCount` and assert option labels and default selected value.
   - Purpose: Happy-path option-generation coverage for AC 3.
   - Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/.
   - Files to read/edit: [agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Acceptance criteria coverage: AC 3.
   - Done when: test fails if options or default value drift.
7. [x] Add a UI test for command-switch reset (`Step N -> Step 1`).
   - Test type: `Component/UI`.
   - Test location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Description: Change start step away from `1`, switch command, and assert selection resets to `Step 1`.
   - Purpose: State-reset coverage for AC 4.
   - Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/, https://react.dev/learn/managing-state.
   - Files to read/edit: [agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Acceptance criteria coverage: AC 4.
   - Done when: test fails if selection persists across command change.
8. [x] Add a UI test for `stepCount = 1` behavior (visible, selected `Step 1`, and disabled).
   - Test type: `Component/UI`.
   - Test location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Description: Use single-step command fixture and assert locked single-step control behavior.
   - Purpose: Corner-case coverage for AC 5.
   - Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/.
   - Files to read/edit: [agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
   - Acceptance criteria coverage: AC 5.
   - Done when: test fails if single-step control is hidden or enabled.
9. [x] Add a UI/API integration test that execute action sends selected `startStep` integer.
   - Test type: `Component/UI` (request payload assertion).
   - Test location: [client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx).
   - Description: Select non-default step, click execute, and assert outbound request body includes correct integer `startStep`.
   - Purpose: Payload wiring coverage for AC 6.
   - Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/.
   - Files to read/edit: [agentsPage.commandsRun.persistenceDisabled.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx).
   - Acceptance criteria coverage: AC 6.
   - Done when: test fails if execute payload omits or mis-types `startStep`.
10. [x] Add a UI test proving no `startStep` controls are introduced on non-AGENTS surfaces touched by this task.

- Test type: `Component/UI` non-regression.
- Test location: [client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx).
- Description: Assert current test surface only renders AGENTS control and does not require additional flow/chat controls.
- Purpose: Scope guard for AC 8.
- Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/.
- Files to read/edit: [agentsPage.commandsRun.persistenceDisabled.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx).
- Acceptance criteria coverage: AC 8.
- Done when: test fails if unexpected start-step UI appears outside AGENTS behavior under test.

11. [x] Show backend `INVALID_START_STEP` responses using existing command error area in [client/src/pages/AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), preserving deterministic range text from server.

- Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/.
- Files to read/edit: [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
- Acceptance criteria coverage: AC 7, AC 25.
- Done when: UI displays server message text for this error without introducing a new error surface.

12. [x] Add a UI test asserting backend `INVALID_START_STEP` message is rendered unchanged in command error area.

- Test type: `Component/UI`.
- Test location: [client/src/test/agentsPage.run.commandError.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.commandError.test.tsx).
- Description: Mock server `INVALID_START_STEP` response and assert exact range text is displayed.
- Purpose: Error-message contract coverage for AC 7 and AC 25.
- Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/, https://jestjs.io/docs/getting-started.
- Files to read/edit: [agentsPage.run.commandError.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.run.commandError.test.tsx).
- Acceptance criteria coverage: AC 7, AC 25.
- Done when: test fails if UI rewrites or drops server message text.

13. [x] Add a UI test for disabled command entries (`disabled: true`, `stepCount: 1`) proving `Start step` remains disabled and execute action remains blocked.

- Test type: `Component/UI`.
- Test location: [client/src/test/agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
- Description: Use disabled command fixture with sentinel `stepCount: 1` and assert `Start step` is disabled, execute button is disabled, and no run request is triggered.
- Purpose: Error/corner-case UI guard coverage for AC 5, AC 23, and AC 24.
- Docs to read first: https://testing-library.com/docs/ecosystem-jest-dom/, https://jestjs.io/docs/getting-started.
- Files to read/edit: [agentsPage.commandsList.test.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/test/agentsPage.commandsList.test.tsx).
- Acceptance criteria coverage: AC 5, AC 23, AC 24.
- Done when: test fails if disabled command fixtures allow start-step editing or command execution.

14. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) for AGENTS `Start step` user-facing behavior and usage notes.

- Document name: `README.md`.
- Document location: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
- Description: Add clear user guidance for AGENTS command execution from selected step and visible validation feedback.
- Purpose: Keep user-facing behavior documentation current for AC 1-8.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
- Acceptance criteria coverage: documentation support for AC 1-8.
- Done when: `README.md` documents `Start step` behavior, defaults, and scope boundaries.

15. [x] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for AGENTS `Start step` UI flow and server error-display integration.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document control state transitions, payload wiring, and rendering of deterministic `INVALID_START_STEP` responses.
- Purpose: Preserve implementer-focused UI/interaction design details for AC 1-8 and AC 25.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 1-8, AC 25.
- Done when: `design.md` captures UI behavior, request behavior, and error rendering contract.

16. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for AGENTS page/test files added, removed, or modified in this task.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Record all client page/test files added, removed, or modified for `Start step` UI behavior.
- Purpose: Ensure file-level implementation map is accurate for junior developers.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 1-8.
- Done when: `projectStructure.md` mirrors actual task-5 file changes and explicitly includes all added and removed files.

17. [x] Add deterministic diagnostic log marker [DEV_0000040_T05_AGENTS_UI_EXECUTE] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx).
- Acceptance criteria coverage: AC 1-8, AC 25.
- Manual Playwright-MCP expected outcome: selecting and executing a command logs marker with selected command name and visible start-step value, and disabled-command attempts do not emit the execute marker.
- Done when: [DEV_0000040_T05_AGENTS_UI_EXECUTE] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

18. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:client`
   - Use when client/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log`.
2. [x] `npm run test:summary:client`
   - Use when client/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/client-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--subset` / `--test-name`), then rerun full `npm run test:summary:client`.
3. [x] `npm run test:summary:e2e`
   - Allow up to 7 minutes (for example `timeout 7m` or harness `timeout_ms=420000`). If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted wrapper commands (`--file` / `--grep`), then rerun full `npm run test:summary:e2e`.
4. [x] `npm run compose:build:summary`
   - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log`.
5. [x] `npm run compose:up`
   - Start the dockerized app stack before manual Playwright-MCP checks.
6. [x] Manual Playwright-MCP check (http://host.docker.internal:5001)
   - Manually confirm AGENTS `Start step` behavior and verify debug-console log markers: `[DEV_0000040_T04_CLIENT_AGENTS_API]` appears when the AGENTS API payload is sent, `[DEV_0000040_T05_AGENTS_UI_EXECUTE]` appears exactly once per successful execute click, and no new error-level console entries are present.
   - Capture screenshots for each GUI state required by this task (for example initial disabled state, enabled `Step 1..N` selector state, and error-message rendering state) and store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped via `docker-compose.local.yml`).
   - Agent validation requirement: review captured screenshots to confirm control order, labels, disabled/enabled transitions, and displayed validation messaging match this task’s acceptance expectations.
   - Expected outcome: marker payloads include selected command and start-step values, disabled-command attempts do not emit `[DEV_0000040_T05_AGENTS_UI_EXECUTE]`, and console error count remains unchanged.
7. [x] `npm run compose:down`
   - Stop the dockerized app stack after manual checks complete.

#### Implementation notes

- Subtask 1: Added AGENTS-row `Start step` MUI `FormControl + Select` immediately after the command select with explicit `InputLabel`/`labelId` pairing.
- Subtask 2: Added deterministic start-step state machine in `AgentsPage` (`disabled before command`, `Step 1..N`, reset to `1` on command change, disabled for `N=1`, and clamp to `1` when runtime list refresh makes prior value invalid).
- Subtask 3: Wired `startStep` through command execute payloads so REST command runs send integer `startStep`.
- Subtasks 4-8: Added `agentsPage.commandsList.test.tsx` coverage for control order, pre-selection disabled state, exact `Step 1..N` option rendering, command-switch reset, and single-step disabled behavior.
- Subtasks 9-10: Added `agentsPage.commandsRun.persistenceDisabled.test.tsx` coverage for outbound integer `startStep` payload and AGENTS-only control scope guard (`Start step` rendered exactly once in this surface).
- Subtasks 11-12: Kept command errors in existing `agents-run-error` area and added `agentsPage.run.commandError.test.tsx` coverage proving backend `INVALID_START_STEP` range text is rendered unchanged.
- Subtask 13: Added disabled-command UI guard coverage ensuring sentinel `stepCount: 1` entries keep `Start step` and execute blocked.
- Subtasks 14-16: Updated `README.md`, `design.md`, and `projectStructure.md` to document AGENTS `Start step` behavior, payload wiring, error rendering, marker usage, and task-modified file map entries.
- Subtask 17: Added deterministic marker `DEV_0000040_T05_AGENTS_UI_EXECUTE` on successful execute clicks with `{ agentName, commandName, sourceId, startStep }` context.
- Subtask 18: Ran `npm run lint --workspaces` (pass with pre-existing server import-order warnings) and `npm run format:check --workspaces`; formatted three changed client files and re-ran format check to pass all workspaces.
- Testing 1: `npm run build:summary:client` passed (`status: passed`) with existing Vite bundle-size warning; log `logs/test-summaries/build-client-latest.log`.
- Testing 2: `npm run test:summary:client` passed (`tests run: 467`, `failed: 0`); log `test-results/client-tests-2026-03-03T20-51-18-072Z.log`.
- Testing 3: `npm run test:summary:e2e` passed (`tests run: 39`, `failed: 0`); log `logs/test-summaries/e2e-tests-latest.log`.
- Testing 4: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`); log `logs/test-summaries/compose-build-latest.log`.
- Testing 5: `npm run compose:up` succeeded; compose services started healthy (client/server/mongo/chroma/playwright-mcp/otel/zipkin).
- Testing 6: Manual Playwright check against `http://host.docker.internal:5001/agents` verified start-step disabled and enabled states, payload markers (`DEV_0000040_T04_CLIENT_AGENTS_API`, `DEV_0000040_T05_AGENTS_UI_EXECUTE`), and unchanged backend range text rendering; screenshots saved to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/playwright-output-local/task5-start-step-disabled.png`, `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/playwright-output-local/task5-start-step-enabled.png`, and `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/playwright-output-local/task5-start-step-error.png`.
- Testing 7: `npm run compose:down` completed successfully and removed the full compose stack.
- Git Commits: Recorded Task 5 implementation commit `a4408187` in this task header before creating the git-commit marker commit.

---

### 6. Server: shared chat defaults resolver from `codex/chat/config.toml`

- Task Status: **done**
- Git Commits:
  - `bc12bfe0` — DEV-0000040 - implement shared codex chat defaults resolver and complete Task 6 checks

#### Overview

Implement the shared Codex default-resolution behavior in one place so all consumers can reuse one deterministic precedence and warning pipeline.

#### Documentation Locations (External References Only)

- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference (Authoritative source for `sandbox_mode`, `approval_policy`, `model_reasoning_effort`, `model`, and `web_search` keys.)
- OpenAI Codex config docs (repository docs mirror): https://raw.githubusercontent.com/openai/codex/main/docs/config.md (Used to cross-check canonical vs legacy config key behavior.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for resolver fallback and warning-branch tests.)
- Mermaid docs via Context7: `/mermaid-js/mermaid` (Use Mermaid syntax guidance when documenting resolver precedence and warning flows in `design.md`.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [x] Implement config-backed default reading in [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts) using [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) for `sandbox_mode`, `approval_policy`, `model_reasoning_effort`, `model`, and `web_search`.
   - Docs to read first: https://developers.openai.com/codex/config-reference, https://nodejs.org/api/test.html.
   - Files to read/edit: [chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12.
   - Done when: resolver can load all five fields from `codex/chat/config.toml`.
2. [x] Implement fallback precedence in [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts): `request override > codex/chat/config.toml > legacy env defaults > hardcoded safe fallback`, and emit field-specific warnings for legacy env fallback.
   - Docs to read first: https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts).
   - Acceptance criteria coverage: AC 13, AC 14.
   - Done when: fallback source selection is deterministic and warning text includes field names.
3. [x] Keep canonical `web_search` precedence and alias normalization in [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts): canonical wins; bool aliases map to `live|disabled`.
   - Docs to read first: https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts).
   - Acceptance criteria coverage: AC 16.
   - Done when: resolver output is stable for canonical+alias mixed inputs.
4. [x] Add a resolver unit test for invalid TOML in `codex/chat/config.toml`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Description: Supply malformed TOML and assert deterministic fallback behavior and warnings.
   - Purpose: Error-path robustness coverage for AC 13 and AC 14.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Acceptance criteria coverage: AC 13, AC 14.
   - Done when: test fails if parser failure silently skips warnings or returns unstable defaults.
5. [x] Add a resolver unit test for invalid field values in parsed config.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Description: Provide invalid enum/string values for covered keys and assert fallback chain selection.
   - Purpose: Error-path validation coverage for AC 11, AC 13, and AC 14.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Acceptance criteria coverage: AC 11, AC 13, AC 14.
   - Done when: test fails if invalid values are accepted as defaults.
6. [x] Add a resolver precedence unit test for `sandbox_mode` (`override > config > env > hardcoded`).
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Description: Assert source precedence ordering and fallback warning behavior for `sandbox_mode`.
   - Purpose: Field-specific precedence coverage for AC 10, AC 12, AC 13, AC 14.
   - Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Acceptance criteria coverage: AC 10, AC 12, AC 13, AC 14.
   - Done when: test fails if precedence or warning source is incorrect.
7. [x] Add a resolver precedence unit test for `approval_policy` (`override > config > env > hardcoded`).
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Description: Assert source precedence ordering and fallback warning behavior for `approval_policy`.
   - Purpose: Field-specific precedence coverage for AC 10, AC 12, AC 13, AC 14.
   - Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Acceptance criteria coverage: AC 10, AC 12, AC 13, AC 14.
   - Done when: test fails if precedence or warning source is incorrect.
8. [x] Add a resolver precedence unit test for `model_reasoning_effort` (`override > config > env > hardcoded`).
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Description: Assert source precedence ordering and fallback warning behavior for `model_reasoning_effort`.
   - Purpose: Field-specific precedence coverage for AC 10, AC 12, AC 13, AC 14.
   - Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Acceptance criteria coverage: AC 10, AC 12, AC 13, AC 14.
   - Done when: test fails if precedence or warning source is incorrect.
9. [x] Add a resolver precedence unit test for `model` (`override > config > env > hardcoded`).
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Description: Assert source precedence ordering and fallback warning behavior for `model`.
   - Purpose: Field-specific precedence coverage for AC 10, AC 12, AC 13, AC 14.
   - Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
   - Acceptance criteria coverage: AC 10, AC 12, AC 13, AC 14.
   - Done when: test fails if precedence or warning source is incorrect.
10. [x] Add a resolver unit test that canonical `web_search` wins when both canonical and alias keys are present.

- Test type: `Unit`.
- Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- Description: Provide config containing both canonical and alias inputs and assert canonical value is used.
- Purpose: Canonical precedence coverage for AC 16.
- Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
- Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- Acceptance criteria coverage: AC 16.
- Done when: test fails if alias keys override canonical `web_search`.

11. [x] Add a resolver unit test that alias `web_search=true` maps to canonical `live`.

- Test type: `Unit`.
- Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- Description: Provide alias boolean `true` and assert normalized output is `web_search = "live"`.
- Purpose: Alias normalization coverage for AC 16.
- Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
- Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- Acceptance criteria coverage: AC 16.
- Done when: test fails if alias `true` maps to any value other than `live`.

12. [x] Add a resolver unit test that alias `web_search=false` maps to canonical `disabled`.

- Test type: `Unit`.
- Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- Description: Provide alias boolean `false` and assert normalized output is `web_search = "disabled"`.
- Purpose: Alias normalization coverage for AC 16.
- Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
- Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- Acceptance criteria coverage: AC 16.
- Done when: test fails if alias `false` maps to any value other than `disabled`.

13. [x] Add a resolver precedence unit test for canonical `web_search` value with full source chain (`override > config > env > hardcoded`) and field-specific warning emission on env fallback.

- Test type: `Unit`.
- Test location: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- Description: Assert canonical `web_search` follows the same source precedence ordering as other covered fields and warnings are emitted only for env-fallback selection.
- Purpose: Close missing precedence-chain coverage for AC 11, AC 13, AC 14, and AC 16.
- Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
- Files to read/edit: [config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- Acceptance criteria coverage: AC 11, AC 13, AC 14, AC 16.
- Done when: test fails if `web_search` precedence diverges from resolver contract.

14. [x] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for shared resolver behavior, including a Mermaid flow diagram for precedence (`override > config > env > hardcoded`) and warning emission points.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document all covered default fields, deterministic precedence logic, legacy-env fallback warnings, and canonical web-search handling.
- Purpose: Provide precise architecture and behavior guidance for AC 10-16.
- Docs to read first: `/mermaid-js/mermaid`, https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 10-16.
- Done when: `design.md` includes precedence/warning behavior and valid Mermaid syntax.

15. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for task-6 resolver/test files added, removed, or modified.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Record all resolver/unit-test files added, removed, or modified in this task.
- Purpose: Keep the repository map accurate for implementation and regression tracing.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 10-16.
- Done when: `projectStructure.md` accurately reflects task-6 file changes and includes all added and removed files.

16. [x] Add deterministic diagnostic log marker [DEV_0000040_T06_CHAT_DEFAULT_RESOLVER] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
- Acceptance criteria coverage: AC 10-16.
- Manual Playwright-MCP expected outcome: opening chat/capability surfaces logs marker for each resolved Codex default field with explicit source (`override|config|env|hardcoded`).
- Done when: [DEV_0000040_T06_CHAT_DEFAULT_RESOLVER] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

17. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [x] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber`
   - Use for server Cucumber feature/step coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands (`--tags` / `--feature` / `--scenario`), then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtasks 1-3: Added async `resolveCodexChatDefaults` in `chatDefaults.ts` that reads `codex/chat/config.toml` via `loadRuntimeConfigSnapshot`, applies per-field precedence (`override > config > env > hardcoded`), emits field-specific legacy-env warnings, and keeps canonical `web_search` precedence over alias booleans.
- Subtasks 4-13: Replaced/expanded `config.chatDefaults.test.ts` with resolver coverage for invalid TOML fallback warnings, invalid config field handling, field-by-field precedence tests (`sandbox_mode`, `approval_policy`, `model_reasoning_effort`, `model`, `web_search`), and alias/canonical web-search normalization behavior.
- Subtask 16: Added deterministic marker `DEV_0000040_T06_CHAT_DEFAULT_RESOLVER` with per-field source/value and warning count context in resolver execution path.
- Subtask 14: Updated `design.md` with a dedicated Task 6 resolver section that documents covered fields, precedence chain, env-warning behavior, canonical `web_search` handling, and a Mermaid flow for source selection/warning emission.
- Subtask 15: Updated `projectStructure.md` with a Story 0000040 Task 6 structural ledger and refreshed `chatDefaults.ts` tree/summary text to reflect config-backed precedence and field-specific warning behavior.
- Subtask 17: Ran `npm run lint --workspaces` (pass with known pre-existing import-order warnings only), then ran `npm run format --workspaces` and a clean `npm run format:check --workspaces` rerun after formatting to confirm all workspaces pass.
- Testing 1: `npm run build:summary:server` passed (`status: passed`, `warnings: 0`) with log `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run test:summary:server:unit` passed (`tests run: 951`, `failed: 0`) with log `test-results/server-unit-tests-2026-03-03T21-10-33-305Z.log`.
- Testing 3: `npm run test:summary:server:cucumber` passed (`tests run: 68`, `failed: 0`) with log `test-results/server-cucumber-tests-2026-03-03T21-19-42-461Z.log`.

---

### 7. Server: REST chat and capability surfaces consume shared defaults

- Task Status: **done**
- Git Commits: **to_do**

#### Overview

Wire REST and capability endpoints to the shared resolver so runtime defaults and warning behavior are consistent across chat routes and model metadata surfaces.

#### Documentation Locations (External References Only)

- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference (Source of truth for Codex default fields consumed by REST metadata and chat routes.)
- Express routing guide: https://expressjs.com/en/guide/routing.html (Used for route integration in `chatModels.ts`, `chatProviders.ts`, and `chat.ts`.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for route default/warning regression tests.)
- Mermaid docs via Context7: `/mermaid-js/mermaid` (Use Mermaid syntax guidance when documenting REST defaults and warning propagation flows in `design.md`.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [x] Update [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts) to consume shared defaults resolver output, preserving current model capability response shape.
   - Docs to read first: https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12.
   - Done when: capability resolver no longer reads Codex defaults directly from env-only logic.
2. [x] Update [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts) to return `codexDefaults` and warnings from shared resolver path.
   - Docs to read first: https://developers.openai.com/codex/config-reference, https://expressjs.com/en/guide/routing.html.
   - Files to read/edit: [chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14.
   - Done when: `/chat/models` defaults/warnings match shared resolver output.
3. [x] Update [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chat.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chat.ts), and [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts) to use shared resolver defaults and warning semantics.
   - Docs to read first: https://expressjs.com/en/guide/routing.html, https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [chat.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chat.ts), [chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: REST chat request validation and metadata endpoints all derive Codex defaults from same resolver path.
4. [x] Add a unit test for `/chat/models` default sourcing from shared resolver.
   - Test type: `Unit` (route-level).
   - Test location: [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts).
   - Description: Assert `codexDefaults` fields come from shared resolver precedence, not env-only behavior.
   - Purpose: Happy-path default-source coverage for AC 10-13.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13.
   - Done when: test fails if `/chat/models` uses legacy env-first behavior.
5. [x] Add a unit test for `/chat/providers` default/warning behavior from shared resolver.
   - Test type: `Unit` (route-level).
   - Test location: [server/src/test/unit/chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts).
   - Description: Assert provider payload exposes resolver-backed defaults and field-specific warnings.
   - Purpose: Happy-path and warning coverage for AC 10-14.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14.
   - Done when: test fails if warnings/defaults diverge from resolver output.
6. [x] Add a unit test for chat request validation using shared resolver defaults including `web_search` normalization.
   - Test type: `Unit` (validator).
   - Test location: [server/src/test/unit/chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts).
   - Description: Assert validator path derives defaults via resolver and applies canonical web-search normalization semantics.
   - Purpose: Validation-path coverage for AC 10-16.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: test fails if validation path uses stale env-only behavior.
7. [x] Add a parity unit test for `chatModels` against shared fixture expectations.
   - Test type: `Unit` (parity).
   - Test location: [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts).
   - Description: Assert one fixture produces expected defaults/warnings identical to resolver output.
   - Purpose: Cross-surface parity coverage for AC 10-16.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: test fails if `/chat/models` parity drifts.
8. [x] Add a parity unit test for `chatProviders` against shared fixture expectations.
   - Test type: `Unit` (parity).
   - Test location: [server/src/test/unit/chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts).
   - Description: Assert one fixture produces expected defaults/warnings identical to resolver output.
   - Purpose: Cross-surface parity coverage for AC 10-16.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: test fails if `/chat/providers` parity drifts.
9. [x] Add a parity unit test for `chatValidators` against shared fixture expectations.
   - Test type: `Unit` (parity).
   - Test location: [server/src/test/unit/chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts).
   - Description: Assert one fixture produces expected defaults/warnings identical to resolver output.
   - Purpose: Cross-surface parity coverage for AC 10-16.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: test fails if validator parity drifts.
10. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) for REST chat/capability default-source behavior and warning semantics.

- Document name: `README.md`.
- Document location: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
- Description: Document how REST surfaces consume resolver-backed defaults and when warnings appear.
- Purpose: Keep operator/developer guidance current for AC 10-16 behavior.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
- Acceptance criteria coverage: documentation support for AC 10-16.
- Done when: `README.md` explains REST default/warning behavior with clear scope.

11. [x] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for REST resolver data flow, including a Mermaid sequence diagram covering `chatModels`, `chatProviders`, and chat validation paths.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document route-level integration points and shared-resolver propagation of defaults and warnings.
- Purpose: Preserve architecture-flow clarity for AC 10-16.
- Docs to read first: `/mermaid-js/mermaid`, https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 10-16.
- Done when: `design.md` includes accurate route flow and valid Mermaid syntax.

12. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for task-7 route/resolver/test files added, removed, or modified.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Record all REST/capability route and test files added, removed, or modified in this task.
- Purpose: Keep implementation file maps accurate for junior execution.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 10-16.
- Done when: `projectStructure.md` reflects all task-7 file changes and explicitly includes all added and removed files.

13. [x] Add deterministic diagnostic log marker [DEV_0000040_T07_REST_DEFAULTS_APPLIED] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), [chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [chat.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chat.ts), [chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts).
- Acceptance criteria coverage: AC 10-16.
- Manual Playwright-MCP expected outcome: loading chat models/providers and sending a chat request logs marker entries confirming shared resolver defaults and warning propagation were applied by REST routes.
- Done when: [DEV_0000040_T07_REST_DEFAULTS_APPLIED] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

14. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [x] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber`
   - Use for server Cucumber feature/step coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands (`--tags` / `--feature` / `--scenario`), then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtasks 1-3: Converted `resolveCodexCapabilities` to consume `resolveCodexChatDefaults` (shared config precedence), propagated async capability resolution into `chatModels`, `chatProviders`, `/chat` route, and `validateChatRequest`, and wired `/chat/providers` to return resolver-backed `codexDefaults` and `codexWarnings`.
- Subtasks 4-9: Expanded unit coverage in `chatModels.codex.test.ts`, `chatProviders.test.ts`, and `chatValidators.test.ts` for shared-resolver default sourcing, warning propagation, and parity fixtures; updated dependent tests for async resolver/validator behavior.
- Subtasks 10-12: Updated `README.md`, `design.md`, and `projectStructure.md` for Task 7 REST/capability resolver behavior, parity flow documentation, and file-map traceability.
- Subtask 13: Added deterministic marker `DEV_0000040_T07_REST_DEFAULTS_APPLIED` across capability/REST validation and metadata response paths with contextual fields (`surface`, `warningCount`, and defaults/default sources).
- Subtask 14: Ran `npm run lint --workspaces` (pass with known pre-existing import-order warnings only), then `npm run format --workspaces` followed by clean `npm run format:check --workspaces`.
- Testing 1: `npm run build:summary:server` passed (`status: passed`, `warnings: 0`) with log `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run test:summary:server:unit` passed (`tests run: 955`, `failed: 0`) with log `test-results/server-unit-tests-2026-03-03T21-32-36-400Z.log`.
- Testing 3: `npm run test:summary:server:cucumber` passed (`tests run: 68`, `failed: 0`) with log `test-results/server-cucumber-tests-2026-03-03T21-41-55-133Z.log`.

---

### 8. Server: MCP `codebase_question` uses shared chat defaults

- Task Status: **to_do**
- Git Commits: **to_do**

#### Overview

Align MCP `codebase_question` Codex default behavior with REST by reusing the same shared resolver path and warnings contract.

#### Documentation Locations (External References Only)

- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference (Source of truth for Codex thread-option defaults consumed by MCP `codebase_question`.)
- DeepWiki OpenAI Codex documentation: https://deepwiki.com/openai/codex (Used for MCP/Codex integration behavior cross-reference when validating tool-alignment assumptions.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for MCP tool happy/validation/unavailable test patterns.)
- Mermaid docs via Context7: `/mermaid-js/mermaid` (Use Mermaid syntax guidance when documenting MCP and REST shared-default parity flow in `design.md`.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [ ] Update [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts) to use shared resolver defaults/warnings for Codex thread options instead of direct env-default sourcing.
   - Docs to read first: https://developers.openai.com/codex/config-reference, https://nodejs.org/api/test.html.
   - Files to read/edit: [codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: MCP tool defaulting path matches REST behavior for covered fields.
2. [ ] Add a happy-path MCP tool unit test for resolver-backed default fields.
   - Test type: `Unit` (MCP tool).
   - Test location: [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts).
   - Description: Assert MCP `codebase_question` applies shared resolver defaults for covered Codex options.
   - Purpose: Happy-path coverage for AC 10-13.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13.
   - Done when: test fails if tool falls back to env-only defaults.
3. [ ] Add an MCP tool validation-path unit test for field-specific warning behavior on legacy-env fallback.
   - Test type: `Unit` (MCP tool validation).
   - Test location: [server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts).
   - Description: Assert warning payload names each field that used legacy env fallback.
   - Purpose: Warning-contract coverage for AC 13 and AC 14.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [codebaseQuestion.validation.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts).
   - Acceptance criteria coverage: AC 13, AC 14.
   - Done when: test fails if warning behavior drifts.
4. [ ] Add an MCP tool validation-path unit test for invalid option handling.
   - Test type: `Unit` (MCP tool validation).
   - Test location: [server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts).
   - Description: Assert invalid default option values are normalized/rejected deterministically in line with shared resolver behavior.
   - Purpose: Error-path option-validation coverage for AC 16.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [codebaseQuestion.validation.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts).
   - Acceptance criteria coverage: AC 16.
   - Done when: test fails if invalid options pass through silently.
5. [ ] Add an MCP tool unavailable-path unit test preserving shared default behavior.
   - Test type: `Unit` (MCP tool unavailable branch).
   - Test location: [server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts).
   - Description: Assert unavailable/degraded tool path still uses deterministic shared defaulting semantics.
   - Purpose: Corner-case resilience coverage for AC 10-16.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [codebaseQuestion.unavailable.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: test fails if unavailable branch bypasses resolver behavior.
6. [ ] Add a parity test comparing MCP `codebase_question` defaults/warnings against REST resolver fixtures.
   - Test type: `Unit` (parity).
   - Test location: [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts).
   - Description: Use same fixture inputs as REST tests and assert identical default/warning outputs.
   - Purpose: Cross-surface parity coverage for AC 10-16.
   - Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: test fails if MCP and REST diverge.
7. [ ] Add an integration parity test asserting REST and MCP surfaces produce aligned codex defaults/warnings when config values are missing and env fallbacks are used.
   - Test type: `Integration` (cross-surface parity).
   - Test location: [server/src/test/integration/chat-codex-mcp.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/chat-codex-mcp.test.ts).
   - Description: Under controlled missing-config fixtures, assert `/chat/models`/`/chat/providers` outputs and MCP `codebase_question` defaults/warnings remain aligned.
   - Purpose: Catch runtime wiring regressions between REST and MCP default-resolution paths.
   - Docs to read first: https://nodejs.org/api/test.html, https://developers.openai.com/codex/config-reference.
   - Files to read/edit: [chat-codex-mcp.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/chat-codex-mcp.test.ts).
   - Acceptance criteria coverage: AC 10, AC 11, AC 12, AC 13, AC 14, AC 16.
   - Done when: test fails if REST/MCP defaults or warning-field lists diverge for the same fixture inputs.
8. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for MCP default-source alignment, including a Mermaid sequence diagram for `codebase_question` resolver behavior and REST parity.
   - Document name: `design.md`.
   - Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
   - Description: Document shared resolver usage in MCP path and parity expectations with REST defaults/warnings.
   - Purpose: Ensure MCP integration architecture is explicit and test-aligned for AC 10-16.
   - Docs to read first: `/mermaid-js/mermaid`, https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
   - Acceptance criteria coverage: documentation support for AC 10-16.
   - Done when: `design.md` clearly documents MCP/REST parity and includes valid Mermaid syntax.
9. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for task-8 MCP tool/test files added, removed, or modified.
   - Document name: `projectStructure.md`.
   - Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
   - Description: Record all MCP tool implementation/test files added, removed, or modified in this task.
   - Purpose: Maintain an accurate repository map for isolated subtask execution.
   - Docs to read first: https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
   - Ordering requirement: complete this subtask after all file additions/removals in this task.
   - Acceptance criteria coverage: documentation support for AC 10-16.
   - Done when: `projectStructure.md` accurately lists task-8 file changes and includes all added and removed files.
10. [ ] Add deterministic diagnostic log marker [DEV_0000040_T08_MCP_DEFAULTS_APPLIED] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts).
- Acceptance criteria coverage: AC 10-16.
- Manual Playwright-MCP expected outcome: running MCP `codebase_question` via UI/MCP surface logs marker with resolved defaults and warning fields that match REST behavior.
- Done when: [DEV_0000040_T08_MCP_DEFAULTS_APPLIED] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber`
   - Use for server Cucumber feature/step coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands (`--tags` / `--feature` / `--scenario`), then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Pending implementation.

---

### 9. Server: deterministic bootstrap for missing `codex/chat/config.toml`

- Task Status: **to_do**
- Git Commits: **to_do**

#### Overview

Implement startup/bootstrap behavior for missing chat config with non-destructive rules. This task is restricted to runtime config bootstrap behavior and related tests.

#### Documentation Locations (External References Only)

- Node.js `fs` API: https://nodejs.org/api/fs.html (Used for copy/write/read behavior and deterministic bootstrap IO handling.)
- Node.js `path` API: https://nodejs.org/api/path.html (Used for deterministic config path construction and portability rules.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for bootstrap branch coverage tests.)
- Mermaid docs via Context7: `/mermaid-js/mermaid` (Use Mermaid syntax guidance when documenting bootstrap decision flow and warning branches in `design.md`.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [ ] Implement deterministic bootstrap in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts): copy `codex/config.toml` to `codex/chat/config.toml` when chat config is missing; generate template when both are missing; do not overwrite existing chat config.
   - Docs to read first: https://nodejs.org/api/fs.html, https://nodejs.org/api/path.html.
   - Files to read/edit: [runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: all three bootstrap branches execute deterministically.
2. [ ] Ensure file permission/read-write failures emit deterministic warnings in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) with no silent fallback behavior.
   - Docs to read first: https://nodejs.org/api/fs.html.
   - Files to read/edit: [runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: warning output is predictable for IO failure paths.
3. [ ] Add a runtime config unit test for copy-bootstrap path (`codex/config.toml` -> `codex/chat/config.toml`).
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Description: Simulate missing chat config with existing base config and assert copy occurs once.
   - Purpose: Happy-path bootstrap coverage for AC 15.
   - Docs to read first: https://nodejs.org/api/test.html, https://nodejs.org/api/fs.html.
   - Files to read/edit: [runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: test fails if copy branch does not create chat config.
4. [ ] Add a runtime config unit test for template-generation path when both configs are missing.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Description: Simulate absence of both files and assert deterministic template output is generated.
   - Purpose: Happy-path fallback coverage for AC 15.
   - Docs to read first: https://nodejs.org/api/test.html, https://nodejs.org/api/fs.html.
   - Files to read/edit: [runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: test fails if template branch is skipped or non-deterministic.
5. [ ] Add a runtime config unit test for non-destructive behavior when chat config already exists.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Description: Seed existing chat config and assert bootstrap does not overwrite it.
   - Purpose: Safety-path coverage for AC 15.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: test fails if existing chat config content changes.
6. [ ] Add a runtime config unit test for IO/read-write failure warning output.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Description: Force copy/write failure and assert deterministic warning logging.
   - Purpose: Error-path visibility coverage for AC 15.
   - Docs to read first: https://nodejs.org/api/test.html, https://nodejs.org/api/fs.html.
   - Files to read/edit: [runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: test fails if failure occurs without deterministic warning.
7. [ ] Add a runtime config unit test for missing `codex/chat` directory creation.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Description: Start with absent chat directory and assert bootstrap creates required directory tree.
   - Purpose: Corner-case filesystem coverage for AC 15.
   - Docs to read first: https://nodejs.org/api/fs.html, https://nodejs.org/api/test.html.
   - Files to read/edit: [runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: test fails if directory creation is skipped.
8. [ ] Add a runtime config unit test for read-only destination behavior.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Description: Simulate read-only target path and assert deterministic warning without silent fallback.
   - Purpose: Error-path permissions coverage for AC 15.
   - Docs to read first: https://nodejs.org/api/fs.html, https://nodejs.org/api/test.html.
   - Files to read/edit: [runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: test fails if permissions failure does not surface warning.
9. [ ] Add a runtime config unit test asserting no partial-file overwrite on failed copy.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Description: Force mid-copy failure and assert resulting chat config is not partially written/corrupted.
   - Purpose: Corner-case data-safety coverage for AC 15.
   - Docs to read first: https://nodejs.org/api/fs.html, https://nodejs.org/api/test.html.
   - Files to read/edit: [runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Acceptance criteria coverage: AC 15.
   - Done when: test fails if partial file artifacts remain after failure.
10. [ ] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) for runtime bootstrap behavior when `codex/chat/config.toml` is missing.

- Document name: `README.md`.
- Document location: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
- Description: Document copy/template/non-overwrite behavior and warning outcomes for startup bootstrap.
- Purpose: Keep operational behavior documentation current for AC 15.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
- Acceptance criteria coverage: documentation support for AC 15.
- Done when: `README.md` clearly states bootstrap branch behavior and safety guarantees.

11. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for bootstrap decision flow, including a Mermaid diagram for copy/template/non-overwrite branches and IO warning paths.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document runtime decision tree for config bootstrap and deterministic warning behavior.
- Purpose: Preserve architecture-level bootstrap logic for AC 15.
- Docs to read first: `/mermaid-js/mermaid`, https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 15.
- Done when: `design.md` includes correct bootstrap flow and valid Mermaid syntax.

12. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for task-9 runtime config/test files added, removed, or modified.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Record all runtime config/test files added, removed, or modified in this task.
- Purpose: Maintain accurate file-level documentation for new contributors.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 15.
- Done when: `projectStructure.md` accurately mirrors task-9 repository changes and includes all added and removed files.

13. [ ] Add deterministic diagnostic log marker [DEV_0000040_T09_CHAT_BOOTSTRAP_BRANCH] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
- Acceptance criteria coverage: AC 15.
- Manual Playwright-MCP expected outcome: after server start and first chat-surface load, marker appears once indicating bootstrap branch (`copied`, `generated_template`, or `existing_noop`).
- Done when: [DEV_0000040_T09_CHAT_BOOTSTRAP_BRANCH] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Pending implementation.

---

### 10. Server: upgrade and pin `@openai/codex-sdk` to `0.107.0` with guard alignment

- Task Status: **to_do**
- Git Commits: **to_do**

#### Overview

Upgrade dependency and runtime guard together so install-time and runtime expectations match exactly. This task must not include unrelated behavior changes.

#### Documentation Locations (External References Only)

- npm registry metadata for `@openai/codex-sdk`: https://registry.npmjs.org/@openai/codex-sdk (Machine-readable source used to verify stable vs pre-release versions.)
- npm package page for `@openai/codex-sdk`: https://www.npmjs.com/package/@openai/codex-sdk (Human-readable package release notes/metadata reference.)
- npm semantic versioning guide: https://docs.npmjs.com/about-semantic-versioning (Used for pin strategy and pre-release exclusion behavior.)
- npm `view` command docs: https://docs.npmjs.com/cli/v10/commands/npm-view (Used for required `npm view @openai/codex-sdk ...` verification command.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for guard-version and pre-release rejection tests.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [ ] Verify latest stable/baseline in implementation notes with `npm view @openai/codex-sdk version versions --json` (baseline `0.106.0`, target stable `0.107.0` as of 2026-03-03).
   - Docs to read first: https://www.npmjs.com/package/@openai/codex-sdk, https://docs.npmjs.com/about-semantic-versioning.
   - Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
   - Acceptance criteria coverage: AC 17, AC 26.
   - Done when: notes capture stable and pre-release values used for decision.
2. [ ] Update package pin to `0.107.0` in [server/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/package.json).
   - Docs to read first: https://docs.npmjs.com/about-semantic-versioning.
   - Files to read/edit: [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/package.json).
   - Acceptance criteria coverage: AC 17, AC 26.
   - Done when: manifest pin matches target stable version.
3. [ ] Update runtime guard constant to `0.107.0` in [server/src/config/codexSdkUpgrade.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexSdkUpgrade.ts).
   - Docs to read first: https://docs.npmjs.com/about-semantic-versioning.
   - Files to read/edit: [codexSdkUpgrade.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexSdkUpgrade.ts).
   - Acceptance criteria coverage: AC 26.
   - Done when: guard version equals package pin.
4. [ ] Verify startup guard integration path in [server/src/index.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/index.ts) remains aligned with updated constant.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [index.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/index.ts).
   - Acceptance criteria coverage: AC 17, AC 26.
   - Done when: startup still runs guard check with updated target version.
5. [ ] Add a guard unit test that exact pinned version `0.107.0` is accepted.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts).
   - Description: Set installed version to `0.107.0` and assert startup guard passes.
   - Purpose: Happy-path version gate coverage for AC 17 and AC 26.
   - Docs to read first: https://nodejs.org/api/test.html, https://docs.npmjs.com/about-semantic-versioning.
   - Files to read/edit: [codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts).
   - Acceptance criteria coverage: AC 17, AC 26.
   - Done when: test fails if exact pinned version is rejected.
6. [ ] Add a guard unit test rejecting pre-release versions (for example `0.107.0-alpha.1`).
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts).
   - Description: Set installed pre-release version and assert guard fails deterministically.
   - Purpose: Pre-release exclusion coverage for AC 26.
   - Docs to read first: https://nodejs.org/api/test.html, https://docs.npmjs.com/about-semantic-versioning.
   - Files to read/edit: [codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts).
   - Acceptance criteria coverage: AC 26.
   - Done when: test fails if pre-release versions are accepted.
7. [ ] Add a guard unit test rejecting higher stable versions than `0.107.0`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts).
   - Description: Set installed version to higher stable (for example `0.108.0`) and assert guard fails.
   - Purpose: Exact-version enforcement coverage for AC 17 and AC 26.
   - Docs to read first: https://nodejs.org/api/test.html, https://docs.npmjs.com/about-semantic-versioning.
   - Files to read/edit: [codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts).
   - Acceptance criteria coverage: AC 17, AC 26.
   - Done when: test fails if higher stable versions are accepted.
8. [ ] Add a guard unit test rejecting lower versions than `0.107.0`.
   - Test type: `Unit`.
   - Test location: [server/src/test/unit/codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts).
   - Description: Set installed version below target (for example `0.106.0`) and assert guard fails.
   - Purpose: Exact-version enforcement coverage for AC 17 and AC 26.
   - Docs to read first: https://nodejs.org/api/test.html, https://docs.npmjs.com/about-semantic-versioning.
   - Files to read/edit: [codexSdkUpgrade.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexSdkUpgrade.test.ts).
   - Acceptance criteria coverage: AC 17, AC 26.
   - Done when: test fails if lower versions are accepted.
9. [ ] Update lockfile resolution for the new pin and verify only one effective `@openai/codex-sdk` version is resolved for server runtime.
   - Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-view, https://docs.npmjs.com/about-semantic-versioning.
   - Files to read/edit: [package-lock.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package-lock.json).
   - Required verification commands: `npm ls @openai/codex-sdk --workspace server` and `npm view @openai/codex-sdk version versions --json`.
   - Acceptance criteria coverage: AC 17, AC 26.
   - Done when: lockfile contains the pinned server dependency, and verification output confirms no mixed-version ambiguity for server runtime resolution.
10. [ ] Add targeted SDK-upgrade regression smoke tests for chat, agents command-run, and flow-run paths to prove existing core paths still execute after pin update.

- Test type: `Integration` (targeted smoke).
- Test locations:
  - [server/src/test/integration/chat-codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/chat-codex.test.ts)
  - [server/src/test/integration/agents-run-ws-stream.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-ws-stream.test.ts)
  - [server/src/test/integration/flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts)
- Description: run/extend focused assertions proving chat, agent command execution, and flow execution remain healthy on `0.107.0`.
- Purpose: direct regression evidence for AC 17 beyond version-only checks.
- Docs to read first: https://nodejs.org/api/test.html.
- Files to read/edit: [chat-codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/chat-codex.test.ts), [agents-run-ws-stream.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/agents-run-ws-stream.test.ts), [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts).
- Acceptance criteria coverage: AC 17.
- Done when: targeted tests fail on regression and pass on the upgraded pin.

11. [ ] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) for SDK pin expectations and guard coupling requirements.

- Document name: `README.md`.
- Document location: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
- Description: Document required pinned SDK version and operational implications of guard/version mismatch.
- Purpose: Keep runbook-level dependency requirements explicit for AC 17 and AC 26.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
- Acceptance criteria coverage: documentation support for AC 17, AC 26.
- Done when: `README.md` states exact version pin and mismatch behavior.

12. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for SDK version guard architecture and exact-version enforcement behavior.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document why dependency pin and runtime guard must remain aligned and how pre-release versions are handled.
- Purpose: Preserve architecture rationale and constraints for AC 17 and AC 26.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 17, AC 26.
- Done when: `design.md` documents pin/guard coupling and rejection rules.

13. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for task-10 dependency/guard/test files added, removed, or modified.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Record all files added, removed, or modified for SDK pinning, runtime guard updates, and associated tests.
- Purpose: Keep repository structure docs correct for targeted implementation and review.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 17, AC 26.
- Done when: `projectStructure.md` lists all task-10 file changes accurately, including all added and removed files.

14. [ ] Add deterministic diagnostic log marker [DEV_0000040_T10_CODEX_SDK_GUARD] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [codexSdkUpgrade.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexSdkUpgrade.ts), [index.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/index.ts).
- Acceptance criteria coverage: AC 17, AC 26.
- Manual Playwright-MCP expected outcome: on app startup marker appears once in debug-console-forwarded logs with installed and required SDK versions and guard decision `accepted`.
- Done when: [DEV_0000040_T10_CODEX_SDK_GUARD] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run build:summary:client`
   - Use when client/common code may be affected by shared dependency updates. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log`.
3. [ ] `npm run compose:build:summary`
   - Use to validate clean docker dependency resolution after lockfile/package changes. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log`.
4. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/chat-codex.test.ts`
   - Targeted regression proof for chat path on upgraded SDK pin.
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-ws-stream.test.ts`
   - Targeted regression proof for agents command-run path on upgraded SDK pin.
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts`
   - Targeted regression proof for flow-run path on upgraded SDK pin.
7. [ ] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Pending implementation.

---

### 11. Server: flow command resolution deterministic source ordering and same-source fail-fast

- Task Status: **to_do**
- Git Commits: **to_do**

#### Overview

Implement and verify the flow command-resolution fix with red-green evidence, deterministic fallback ordering, and no fallback when same-source command is schema-invalid.

#### Documentation Locations (External References Only)

- Node.js `path` API: https://nodejs.org/api/path.html (Used for normalized label/path ordering rules and deterministic comparator implementation.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for red-green integration tests for resolver behavior.)
- Cucumber guides index: https://cucumber.io/docs/guides/ (Primary Cucumber documentation root for this task's cucumber-suite verification references.)
- Cucumber guides (parallel execution): https://cucumber.io/docs/guides/parallel-execution/ (Cucumber reference for this task's cucumber-suite verification step.)
- Mermaid docs via Context7: `/mermaid-js/mermaid` (Use Mermaid syntax guidance when documenting flow command-resolution ordering and fail-fast behavior in `design.md`.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Reference for required documentation updates.)

#### Subtasks

1. [ ] Add a failing repro integration test first demonstrating current incorrect same-source/fallback behavior (red step before implementation).
   - Test type: `Integration` (red-first repro).
   - Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Description: Build a fixture where expected same-source/ordered fallback behavior is violated by current code, and assert current run fails this new expectation.
   - Purpose: Red-green proof requirement coverage for AC 21 and AC 27 before implementing resolver changes.
   - Docs to read first: https://nodejs.org/api/test.html, https://nodejs.org/api/path.html.
   - Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Acceptance criteria coverage: AC 21, AC 27.
   - Done when: new test fails on current behavior before service changes.
2. [ ] Extend source-context plumbing in [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) so `startFlowRun` `sourceId` and `listIngestedRepositories` context are available to both command validation and runtime execution.
   - Docs to read first: https://nodejs.org/api/path.html.
   - Files to read/edit: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts).
   - Acceptance criteria coverage: AC 18, AC 27.
   - Done when: both validation and execution code paths can resolve repository candidates from same context.
3. [ ] Implement deterministic candidate ordering in [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts): same-source first, codeInfo2 second, then other repos sorted by case-insensitive ASCII normalized label then full path (no parallel loader implementation).
   - Docs to read first: https://nodejs.org/api/path.html.
   - Files to read/edit: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts).
   - Acceptance criteria coverage: AC 18, AC 19, AC 28.
   - Done when: ordering is deterministic and independent of filesystem iteration order.
4. [ ] Implement fail-fast behavior in [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts): if same-source command exists but is schema-invalid/read-failed, stop and do not fallback.
   - Docs to read first: https://nodejs.org/api/path.html.
   - Files to read/edit: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts).
   - Acceptance criteria coverage: AC 20, AC 27.
   - Done when: same-source invalid path returns failure immediately.
5. [ ] Ensure both pre-run command validation and runtime command execution use the same shared resolver path in [server/src/flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) to avoid behavior drift.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts).
   - Acceptance criteria coverage: AC 18, AC 20, AC 27.
   - Done when: one resolver function/path is reused by both phases.
6. [ ] Add an integration test for same-source command success path.
   - Test type: `Integration`.
   - Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Description: Flow with repository source resolves command from same source and executes successfully.
   - Purpose: Happy-path coverage for AC 18 and AC 27.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Acceptance criteria coverage: AC 18, AC 27.
   - Done when: test fails if same-source command resolution is bypassed.
7. [ ] Add an integration test for same-source missing command with fallback to codeInfo2 repository.
   - Test type: `Integration`.
   - Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Description: Same-source lacks command, resolver selects codeInfo2 repository as next candidate.
   - Purpose: Ordered fallback coverage for AC 18 and AC 27.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Acceptance criteria coverage: AC 18, AC 27.
   - Done when: test fails if fallback order skips codeInfo2.
8. [ ] Add an integration test for deterministic fallback among other repositories.
   - Test type: `Integration`.
   - Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Description: With multiple non-priority repos containing command, assert first match by defined comparator is selected.
   - Purpose: Deterministic ordering coverage for AC 19 and AC 28.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Acceptance criteria coverage: AC 19, AC 28.
   - Done when: test fails if selection depends on filesystem iteration order.
9. [ ] Add an integration test for same-source schema-invalid command fail-fast behavior.
   - Test type: `Integration`.
   - Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Description: Same-source command exists but is invalid; assert run fails without trying fallback repositories.
   - Purpose: Error-path fail-fast coverage for AC 20 and AC 27.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
   - Acceptance criteria coverage: AC 20, AC 27.
   - Done when: test fails if resolver continues fallback after same-source schema failure.
10. [ ] Add an integration test for same-source command read/parse failure fail-fast behavior.

- Test type: `Integration`.
- Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Description: Same-source command file exists but read/parse fails; assert run fails immediately and does not attempt fallback repositories.
- Purpose: Error-path fail-fast coverage for edge-case rules and AC 20/AC 27 scope behavior.
- Docs to read first: https://nodejs.org/api/test.html.
- Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Acceptance criteria coverage: AC 20, AC 27.
- Done when: test fails if resolver falls back after same-source read/parse failure.

11. [ ] Add an integration test for command-not-found across all candidate repositories preserving existing not-found failure path.

- Test type: `Integration`.
- Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Description: Configure same-source, codeInfo2, and sorted-other candidates without the target command and assert deterministic not-found failure behavior.
- Purpose: Corner-case exhaustive fallback coverage for AC 18, AC 19, AC 27, and AC 28.
- Docs to read first: https://nodejs.org/api/test.html, https://nodejs.org/api/path.html.
- Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Acceptance criteria coverage: AC 18, AC 19, AC 27, AC 28.
- Done when: test fails if missing command across all candidates produces inconsistent/non-standard failure behavior.

12. [ ] Add an integration test for normalized-label comparison with trimmed `sourceLabel`.

- Test type: `Integration`.
- Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Description: Use labels with surrounding whitespace and assert comparator uses trimmed normalized label.
- Purpose: Corner-case comparator coverage for AC 19 and AC 28.
- Docs to read first: https://nodejs.org/api/test.html, https://nodejs.org/api/path.html.
- Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Acceptance criteria coverage: AC 19, AC 28.
- Done when: test fails if whitespace affects ordering.

13. [ ] Add an integration test for empty/absent `sourceLabel` basename fallback ordering.

- Test type: `Integration`.
- Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Description: Use empty labels and assert comparator falls back to repository basename before path tie-break.
- Purpose: Corner-case comparator coverage for AC 19 and AC 28.
- Docs to read first: https://nodejs.org/api/test.html, https://nodejs.org/api/path.html.
- Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Acceptance criteria coverage: AC 19, AC 28.
- Done when: test fails if empty labels are not normalized correctly.

14. [ ] Add an integration test for path tie-break when normalized labels compare equal case-insensitively.

- Test type: `Integration`.
- Test location: [server/src/test/integration/flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Description: Create same normalized labels and assert deterministic first match by case-insensitive full path ordering.
- Purpose: Tie-break determinism coverage for AC 19 and AC 28.
- Docs to read first: https://nodejs.org/api/test.html, https://nodejs.org/api/path.html.
- Files to read/edit: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts).
- Acceptance criteria coverage: AC 19, AC 28.
- Done when: test fails if equal-label ordering is non-deterministic.

15. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) for flow resolver ordering and fail-fast behavior, including Mermaid flow/sequence diagrams for same-source success, codeInfo2 fallback, and same-source schema-invalid stop conditions.

- Document name: `design.md`.
- Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Description: Document deterministic source ordering comparator, fallback boundaries, and fail-fast semantics across validation/execution paths.
- Purpose: Preserve end-to-end resolver architecture details for AC 18-21 and AC 27-28.
- Docs to read first: `/mermaid-js/mermaid`, https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
- Acceptance criteria coverage: documentation support for AC 18-21 and AC 27-28.
- Done when: `design.md` includes exact rules and valid Mermaid syntax for all required flow scenarios.

16. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for task-11 flow service/integration-test files added, removed, or modified.

- Document name: `projectStructure.md`.
- Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Description: Record all flow service/integration-test files added, removed, or modified in this task.
- Purpose: Keep repository file-map documentation accurate for implementation and review.
- Docs to read first: https://www.markdownguide.org/basic-syntax/.
- Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
- Ordering requirement: complete this subtask after all file additions/removals in this task.
- Acceptance criteria coverage: documentation support for AC 18-21 and AC 27-28.
- Done when: `projectStructure.md` reflects all task-11 file changes with no omissions, including all added and removed files.

17. [ ] Add deterministic diagnostic log marker [DEV_0000040_T11_FLOW_RESOLUTION_ORDER] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.

- Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
- Files to read/edit: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts).
- Acceptance criteria coverage: AC 18-21, AC 27-28.
- Manual Playwright-MCP expected outcome: running flow commands logs marker with ordered candidate list and selected source, or fail-fast reason for same-source invalid/read-fail cases.
- Done when: [DEV_0000040_T11_FLOW_RESOLUTION_ORDER] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.

18. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

- Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
- Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
- Acceptance criteria coverage: quality gate for this task's implementation outputs.
- Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber`
   - Use for server Cucumber feature/step coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands (`--tags` / `--feature` / `--scenario`), then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Pending implementation.

---

### 12. Documentation synchronization for story 0000040 outputs

- Task Status: **to_do**
- Git Commits: **to_do**

#### Overview

Perform documentation-only updates so product behavior, architecture notes, and repository structure match the final implemented behavior of this story.

#### Documentation Locations (External References Only)

- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Used for README/design/projectStructure update formatting.)
- Mermaid docs via Context7: `/mermaid-js/mermaid` (Primary syntax reference for architecture and flow diagrams added to `design.md`.)
- OpenAPI 3.1 specification: https://swagger.io/specification/ (Used to keep documentation and `openapi.json` contract text aligned.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for interpreting openapi contract test evidence.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for lint/format/build wrapper execution.)

#### Subtasks

1. [ ] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) with final user-facing behavior for AGENTS start-step and config-backed chat defaults.
   - Document name: `README.md`.
   - Document location: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
   - Description: Capture finalized end-user behavior for AGENTS `Start step` and shared chat defaults so onboarding and operations docs match implemented behavior.
   - Purpose: Provide clear user-facing guidance and reduce implementation ambiguity for AC 1-8 and AC 10-16.
   - Docs to read first: https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
   - Acceptance criteria coverage: documentation support for AC 1-8 and AC 10-16.
   - Done when: README reflects final behavior exactly as implemented.
2. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with architecture/flow details for start-step contracts and flow command resolver ordering/fail-fast behavior, including Mermaid diagrams for each changed flow.
   - Document name: `design.md`.
   - Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
   - Description: Document finalized architecture, contract flow, and resolver behavior with Mermaid diagrams for each changed runtime flow.
   - Purpose: Preserve concrete implementation architecture references for AC 18-21 and AC 27-28.
   - Docs to read first: `/mermaid-js/mermaid`, https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
   - Acceptance criteria coverage: documentation support for AC 18-21 and AC 27-28.
   - Done when: design doc includes deterministic ordering/failure rules and valid Mermaid diagram syntax.
3. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) for all file additions/removals from tasks 1-11.
   - Document name: `projectStructure.md`.
   - Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
   - Description: Update the file/folder map to include all files added, removed, or moved during tasks 1-11.
   - Purpose: Ensure repository structure documentation is accurate for downstream task execution and review.
   - Docs to read first: https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
   - Ordering requirement: complete this subtask after all file additions/removals from tasks 1-11 are finished.
   - Acceptance criteria coverage: documentation support across whole story implementation.
   - Done when: file/module map matches repository state after implementation and includes every file added and removed by tasks 1-11.
4. [ ] Ensure [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json) reflects final route contract shapes from tasks 1-2 and stays aligned with route runtime behavior.
   - Docs to read first: https://swagger.io/specification/.
   - Files to read/edit: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json).
   - Acceptance criteria coverage: AC 22, AC 23, AC 24, AC 25.
   - Done when: OpenAPI schema matches live request/response behavior.
5. [ ] Add deterministic diagnostic log marker [DEV_0000040_T12_DOC_SYNC_COMPLETE] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.
   - Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
   - Files to read/edit: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json).
   - Acceptance criteria coverage: AC 22, AC 23, AC 24, AC 25.
   - Manual Playwright-MCP expected outcome: during final manual check, emit marker once from browser console after validating docs/contract alignment, and record the marker in implementation notes as documentation-sync evidence.
   - Done when: [DEV_0000040_T12_DOC_SYNC_COMPLETE] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
   - Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
   - Acceptance criteria coverage: quality gate for this task's implementation outputs.
   - Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Pending implementation.

---

### 13. Final verification: full acceptance and regression gate for story 0000040

- Task Status: **to_do**
- Git Commits: **to_do**

#### Overview

Run final end-to-end verification against all acceptance criteria, full builds/tests, docker checks, and manual UI checks with screenshots. This task closes the story and prepares pull-request summary content.

#### Documentation Locations (External References Only)

- Docker Compose docs: https://docs.docker.com/compose/ (Used for wrapper-backed compose lifecycle verification and diagnostics.)
- Playwright docs: https://playwright.dev/docs/intro (Used for final manual verification flow and screenshot evidence guidance.)
- Jest docs via Context7: `/jestjs/jest` (Context7 source for interpreting Jest output and expectations during final regression checks.)
- Jest getting started: https://jestjs.io/docs/getting-started (Used for interpreting client/server test run output in final verification.)
- Cucumber guides index: https://cucumber.io/docs/guides/ (Primary Cucumber documentation root for this task's server cucumber verification references.)
- Cucumber 10-minute tutorial: https://cucumber.io/docs/guides/10-minute-tutorial/ (Primary Cucumber guides subpath used for BDD suite execution expectations.)
- Cucumber parallel execution guide: https://cucumber.io/docs/guides/parallel-execution/ (Used for understanding multi-scenario execution behavior in wrapper runs.)
- DeepWiki OpenAI Codex documentation: https://deepwiki.com/openai/codex (Used for MCP contract non-regression cross-check context.)
- Mermaid docs via Context7: `/mermaid-js/mermaid` (Reference for validating all Mermaid diagrams added to `design.md` before story closure.)
- Node.js test runner API: https://nodejs.org/api/test.html (Used for acceptance-evidence mapping to targeted server tests.)
- npm run-script CLI docs: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reference for all wrapper commands executed in final verification.)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/ (Used for final PR summary and implementation-note formatting.)

#### Subtasks

1. [ ] Validate every acceptance criterion and record explicit pass/fail evidence with file/test references in this task’s implementation notes.
   - Docs to read first: https://nodejs.org/api/test.html.
   - Files to read/edit: [0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md) (acceptance criteria + this task's implementation notes section).
   - Acceptance criteria coverage: AC 1-28.
   - Done when: every AC has a concrete evidence note (test name, endpoint check, or manual check), and each evidence note is tagged as happy-path, error-path, or corner-case coverage.
2. [ ] After completing this task's Testing section, document outcomes for all wrapper/manual checks in this task's implementation notes, including pass/fail status, remediation actions, and rerun evidence.
   - Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script, https://nodejs.org/api/test.html, https://playwright.dev/docs/intro.
   - Files to read/edit: [0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md) (this task's implementation notes section), [mcp-agents-commands-run.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp-agents-commands-run.test.ts), [tools.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcpAgents/tools.ts).
   - Acceptance criteria coverage: AC 1-28.
   - Done when: implementation notes include explicit evidence for server unit, cucumber, client, e2e, targeted MCP non-regression, and manual Playwright checks.
3. [ ] Produce pull-request summary text covering all completed tasks, contract changes, tests run, and remaining risks.
   - Docs to read first: https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md), [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
   - Acceptance criteria coverage: release readiness communication for AC 1-28.
   - Done when: summary includes what changed, why, and proof points.
4. [ ] Confirm [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) is fully current after all code/test changes.
   - Document name: `README.md`.
   - Document location: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
   - Description: Verify final user-facing behavior descriptions and command references match implemented functionality and test evidence.
   - Purpose: Prevent release drift in user/operator documentation for AC 1-28.
   - Docs to read first: https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md).
   - Ordering requirement: complete this subtask after all file additions/removals in this task (including screenshot files) are finished.
   - Acceptance criteria coverage: final documentation readiness for AC 1-28.
   - Done when: `README.md` aligns with final behavior and no stale instructions remain.
5. [ ] Confirm [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) is fully current and all newly added Mermaid diagrams render and match implemented architecture/flow behavior.
   - Document name: `design.md`.
   - Document location: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
   - Description: Verify all architecture notes and Mermaid diagrams represent the final implemented flow and contract behavior.
   - Purpose: Ensure architecture documentation and diagram evidence are valid for AC 1-28 closure.
   - Docs to read first: `/mermaid-js/mermaid`, https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md).
   - Ordering requirement: complete this subtask after all file additions/removals in this task (including screenshot files) are finished.
   - Acceptance criteria coverage: final documentation readiness for AC 1-28.
   - Done when: `design.md` has no known drift and all Mermaid blocks are syntax-valid and behavior-accurate.
6. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) so it is fully current after all code/test/documentation changes.
   - Document name: `projectStructure.md`.
   - Document location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
   - Description: Update and verify that all added, removed, and modified files for the story (including screenshot artifacts) are correctly reflected in structure documentation.
   - Purpose: Ensure file-map documentation remains accurate for maintainers and reviewers.
   - Docs to read first: https://www.markdownguide.org/basic-syntax/.
   - Files to read/edit: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md).
   - Ordering requirement: complete this subtask after all file additions/removals in this task (including screenshot files) are finished.
   - Acceptance criteria coverage: final documentation readiness for AC 1-28.
   - Done when: `projectStructure.md` matches final repository state with no missing entries and explicitly includes all added and removed files from this task.
7. [ ] Add deterministic diagnostic log marker [DEV_0000040_T13_MANUAL_CHECK_COMPLETE] for this task's primary event flow, and include enough context fields to prove the trigger path executed correctly.
   - Docs to read first: https://nodejs.org/api/console.html, https://playwright.dev/docs/next/debug#browser-logs.
   - Files to read/edit: [0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md).
   - Acceptance criteria coverage: AC 1-28.
   - Manual Playwright-MCP expected outcome: after all manual checks pass, emit marker once in browser console and capture screenshot/log evidence tied to final regression completion.
   - Done when: [DEV_0000040_T13_MANUAL_CHECK_COMPLETE] is emitted deterministically for the relevant action and is included in Task 13 Manual Playwright-MCP verification evidence.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Docs to read first: https://docs.npmjs.com/cli/v10/commands/npm-run-script.
   - Files to read/edit: None (command-only subtask; update this story file implementation notes if behavior or evidence changes).
   - Acceptance criteria coverage: quality gate for this task's implementation outputs.
   - Done when: lint/format checks pass, or remaining issues are manually resolved and documented in implementation notes.

#### Testing

- Wrapper-only rule: do not attempt to run tests without using the summary wrappers listed below.
- Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server`
   - Use when server/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run build:summary:client`
   - Use when client/common code may be affected. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log`.
3. [ ] `npm run test:summary:server:unit`
   - Use for server node:test unit/integration coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--test-name`), then rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber`
   - Use for server Cucumber feature/step coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands (`--tags` / `--feature` / `--scenario`), then rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client`
   - Use when client/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/client-tests-*.log`), diagnose with targeted wrapper commands (`--file` / `--subset` / `--test-name`), then rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e`
   - Allow up to 7 minutes (for example `timeout 7m` or harness `timeout_ms=420000`). If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted wrapper commands (`--file` / `--grep`), then rerun full `npm run test:summary:e2e`.
7. [ ] `npm run compose:build:summary`
   - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log`.
8. [ ] `npm run compose:up`
   - Start the dockerized app stack before manual Playwright-MCP checks.
9. [ ] Manual Playwright-MCP check (http://host.docker.internal:5001)
   - Manually confirm story behavior and verify these debug-console markers appear with expected outcomes: `[DEV_0000040_T01_STEP_COUNT_RESPONSE]` (command list returns `stepCount >= 1`), `[DEV_0000040_T02_START_STEP_VALIDATION]` (valid and invalid `startStep` attempts are logged with invalid cases tagged `INVALID_START_STEP`), `[DEV_0000040_T03_RUNNER_START_STEP]` (runner logs selected `startStep` and `totalSteps`), `[DEV_0000040_T04_CLIENT_AGENTS_API]` (outbound AGENTS payload logging), `[DEV_0000040_T05_AGENTS_UI_EXECUTE]` (execute click emission only for enabled runs), `[DEV_0000040_T06_CHAT_DEFAULT_RESOLVER]` (default-source selection per field), `[DEV_0000040_T07_REST_DEFAULTS_APPLIED]` (REST chat defaults/warnings applied), `[DEV_0000040_T08_MCP_DEFAULTS_APPLIED]` (MCP defaults/warnings aligned), `[DEV_0000040_T09_CHAT_BOOTSTRAP_BRANCH]` (bootstrap branch reported once), `[DEV_0000040_T10_CODEX_SDK_GUARD]` (guard decision with installed/required versions), `[DEV_0000040_T11_FLOW_RESOLUTION_ORDER]` (flow candidate ordering and fail-fast reason), `[DEV_0000040_T12_DOC_SYNC_COMPLETE]` (documentation/contract sync verification marker), and no unexpected error-level console logs.
   - Capture screenshots for every GUI-verifiable acceptance surface (AGENTS start-step interactions, chat defaults/warnings states, and flow resolver success/failure UI outcomes) and store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped via `docker-compose.local.yml`).
   - Agent validation requirement: review all captured screenshots against story acceptance criteria and task expectations, and record explicit pass/fail notes for each GUI-verifiable acceptance point in implementation notes.
   - Expected outcome: each marker appears for its corresponding interaction exactly as defined in task subtasks, payload context matches expected values, and console errors remain zero for happy-path checks.
10. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/mcp-agents-commands-run.test.ts`

- Explicit unchanged-contract regression check proving MCP `run_command` schema remains unchanged by REST `startStep` work.

11. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-ws-stream.test.ts`

- Explicit websocket metadata regression check proving command-step metadata shape remains stable after start-step support.

12. [ ] `npm run compose:down`

- Stop the dockerized app stack after manual checks complete.

#### Implementation notes

- Pending implementation.
