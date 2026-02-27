# Story 0000037 – Shared CODEX_HOME with Per-Agent Runtime Config Overrides

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.
When tasks are created for this story, they must include an explicit ordering/safety note that minimizing `./codex/config.toml` is a final isolated task, and that after that point the `code_info` MCP tool is expected to stop working for this running instance and must not be used.

### Description

CodeInfo2 currently supports multiple agents by switching Codex home folders per agent (`codex_agents/<agent>`), and this means each agent effectively needs its own Codex auth/config state.

This approach does not scale well as the number of agents grows because login/auth/session state must be managed repeatedly and the UI/API includes extra branching for chat-target vs agent-target device auth.

This story plans a move to one shared Codex home (`./codex`) for auth/session persistence while strictly preserving per-agent behavior. Per-agent behavior will be provided at runtime by reading each agent's `codex_agents/<agent>/config.toml` and passing those settings through `CodexOptions.config` whenever that agent is executed (including direct agent runs, agent commands, and flow-driven agent execution paths). Agent runs will continue using `useConfigDefaults: true` so model/policy come from runtime config values instead of hard-coded thread flags.

Hard rule for this story: agent behavior must remain unchanged from user perspective. For any given agent, only values from that agent's own `config.toml` are allowed to determine that agent's Codex behavior, regardless of how the agent is invoked.

Feasibility has been validated against latest upstream surfaces: `@openai/codex-sdk` latest stable supports runtime `CodexOptions.config` overrides and shared `CODEX_HOME` environment control, and therefore this behavior model is achievable.

Because application chat currently depends on behavior values in `./codex/config.toml`, this story also introduces a dedicated chat runtime config file (for example `./codex/chat/config.toml`) that is used for application chat behavior via runtime `CodexOptions.config` overrides while still using the same shared `CODEX_HOME` for auth/session state.

Required migration order: create the chat runtime config as a copy of current `./codex/config.toml` before reducing `./codex/config.toml` to a minimal shared-default set. This prevents chat behavior regressions during migration.

This story also plans upgrading `@openai/codex-sdk` to latest stable, removing legacy app-side reasoning-effort shims that manually widened older SDK typings (for example custom `| 'xhigh'` unions/casts), and simplifying frontend re-authentication so there is a single `Codex device auth` flow (no chat/agent selector).

For chat reasoning effort UX, options must be sourced from a backend capability payload that reflects what the upgraded SDK/runtime supports instead of a hard-coded client option list. This includes showing `minimal` when supported now, and automatically surfacing newly supported values in future SDK upgrades without adding another one-off shim.

Operational safety rule for this story: migration must be non-destructive for `codex_agents/*`. Do not delete, move, or rename `auth.json` (or any other files) inside agent folders because this running CodeInfo2 instance depends on those files remaining present.

Additional rollout safety rule: reducing values in `./codex/config.toml` can stop the chat agent (and therefore `code_info` MCP availability) in this running instance. Because of this, minimizing `./codex/config.toml` must be done only at the very end of implementation as a single isolated step after all other code changes, verification, and documentation updates are complete.

### Implementation Boundaries (Junior-Readable)

- Runtime behavior ownership must be explicit:
  - Agent runs (`/agents/:agentName/run`, `/agents/:agentName/commands/run`, flow-driven steps, and MCP agent execution) get behavior from `codex_agents/<agent>/config.toml`.
  - App chat runs get behavior from `./codex/chat/config.toml`.
  - Shared `./codex/config.toml` is for shared auth/session home and shared `[projects]` defaults only.
- Precedence must be deterministic and documented in code comments/tests:
  - `effectiveProjects = { ...baseProjects, ...agentProjects }`.
  - Example: base has `/data=trusted`, agent has `/data=untrusted` and `/work=trusted` => effective is `/data=untrusted`, `/work=trusted`.
  - No non-project behavior key from shared `./codex/config.toml` may override a named agent’s behavior.
- Device-auth must use one shared auth flow after migration:
  - Backend accepts one request shape only, and frontend sends that one shape only.
  - Request payload has no caller-selected target fields.
  - Legacy chat-vs-agent selector behavior is removed from UI and API payload contracts.
- Compatibility normalization must be deterministic:
  - `features.view_image_tool` is normalized to `tools.view_image`.
  - Legacy web-search keys are normalized to canonical `web_search` mode (`live` / `cached` / `disabled`).
  - `features.web_search_request` remains accepted only as an input alias, not as the canonical stored/runtime key.
  - Unsupported/misplaced keys follow one validation policy only (defined below in Acceptance Criteria) so behavior is predictable for all agents.
- File safety rule is strict:
  - No delete/move/rename operations under `codex_agents/*`.
  - Existing `auth.json` files must remain present after story completion.

### Acceptance Criteria

- Single shared Codex auth/session home is used for all Codex-backed chat/agent/flow execution paths (`./codex`), with no per-agent login requirement.
- `@openai/codex-sdk` is upgraded from `0.101.0` to the latest **stable** version available on implementation start date (no alpha/pre-release builds), and the exact upgraded version is recorded in story implementation notes.
- Local compatibility shims that were introduced to inject/widen reasoning effort support (for example server-side `ModelReasoningEffort | 'xhigh'` unions and related casts) are removed in favor of the SDK-native `ModelReasoningEffort` surface.
- Agent runtime configuration is sourced from `codex_agents/<agent>/config.toml` and mapped into `CodexOptions.config` for execution-time overrides.
- Agent and flow runs continue to set `useConfigDefaults: true`, with thread/runtime behavior driven by config defaults and explicit runtime overrides rather than duplicated model/policy flag wiring.
- Existing per-agent behavior differences (model, approval policy, sandbox mode, reasoning effort, MCP server config, relevant feature toggles, and any other behavior-defining config values) remain preserved after migration to shared `CODEX_HOME`.
- For any agent execution path (`/agents/:agentName/run`, `/agents/:agentName/commands/run`, flow-driven agent steps, and MCP agent execution surfaces), behavior is determined only by that agent's `codex_agents/<agent>/config.toml`.
- Shared `codex/config.toml` must not override agent behavior values when a named agent is running; shared home is for auth/session persistence, not behavior policy for agents.
- The only shared-base behavior injected into agent runtime config is `[projects]` trust metadata from `codex/config.toml`, merged as `effectiveProjects = { ...baseProjects, ...agentProjects }` so agent-defined project entries override shared defaults.
- Application chat behavior is sourced from dedicated chat runtime config (for example `./codex/chat/config.toml`) passed through runtime `CodexOptions.config`, not from behavior values left in minimal `./codex/config.toml`.
- Migration sequencing is enforced: chat runtime config copy is created from existing `./codex/config.toml` before `./codex/config.toml` is minimized.
- Minimizing/removing values from `./codex/config.toml` is executed only as a final isolated task at the end of the story after all other implementation/testing steps are complete.
- Final minimized `./codex/config.toml` no longer carries runtime behavior keys (`model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `[features]`, `[mcp_servers]`) and is limited to shared-home defaults plus shared `[projects]` trust entries.
- The plan/tasks explicitly warn that once `./codex/config.toml` is minimized for this running instance, the chat agent and `code_info` MCP tool are expected to stop working, and `code_info` must not be used after that point.
- Current legacy key usage is normalized deterministically before execution: `features.view_image_tool` is translated to `tools.view_image`, and deprecated `features.web_search_request` remains supported through compatibility alias behavior.
- Canonical runtime storage/output uses `tools.view_image` and top-level `web_search`; legacy keys are accepted only as read-time aliases and are not re-emitted as canonical output.
- Unsupported or misplaced keys discovered in current agent TOMLs (for example `cli_auth_credentials_store` nested under `[projects.\"<path>\"]`) follow one fixed validation policy:
  - unknown keys: warning log with key path, then ignored;
  - invalid type for a supported key: hard validation error for that agent run;
  - no silent fallback to another agent or shared behavior values.
- All existing agent config files under `codex_agents/*/config.toml` are validated in tests against supported runtime mapping rules and produce consistent behavior across all invocation paths.
- No migration step in this story deletes, moves, or renames files under `codex_agents/*`; this explicitly includes preserving each agent folder `auth.json`.
- Codex availability detection and startup validation move to shared-home semantics while remaining compatible with existing agent-local auth artifacts that must remain on disk for this instance.
- Per-agent auth propagation/seeding behavior is retained in a non-destructive compatibility mode as needed to keep current runtime behavior stable; no plan step may remove agent-folder auth files.
- Device-auth backend endpoint is changed to a single request contract with no target selector fields, and no legacy dual-shape/backward-compatible parsing remains after migration.
- Requests that still send legacy selector fields (for example `target` or `agentName`) are rejected with a deterministic client error response rather than silently reinterpreted.
- Device-auth endpoint behavior is explicitly defined for juniors:
  - `POST /codex/device-auth` request body must be an empty JSON object `{}`.
  - `200` success response: `{ "status": "ok", "rawOutput": "<string>" }`.
  - `400` invalid request response (including any legacy selector fields): `{ "error": "invalid_request", "message": "<reason>" }`.
  - `503` codex unavailable response: `{ "error": "codex_unavailable", "reason": "<reason>" }`.
- Frontend re-authentication UI is simplified to one Codex device auth screen and removes chat/agent selector UX and related branch-specific messaging.
- Chat reasoning-effort options are no longer hard-coded in the frontend; the client renders options exactly from backend capability data sourced from the upgraded SDK/runtime support set.
- `minimal` (and any other capability value surfaced by runtime model metadata, including `none`/`xhigh` where provided) is visible/selectable in chat, and selection is validated/passed through end-to-end the same as other supported effort values.
- Future SDK/runtime reasoning-effort additions appear in chat automatically after dependency upgrade/redeploy, without adding new custom value-injection code.
- Backend capability payload includes a deterministic field for reasoning effort options (array of supported values), and frontend behavior is deterministic when values change (invalid prior selection is reset to that model’s supported default).
- Chat model capability payload shape is explicitly defined and shared in `common` types:
  - each Codex model entry includes `supportedReasoningEfforts: string[]` and `defaultReasoningEffort: string`;
  - UI must render reasoning choices from those fields only;
  - if a previously selected effort is no longer supported for the selected model, UI resets to that model’s `defaultReasoningEffort`.
- Legacy compatibility behaviors are explicitly documented for any remaining read-only agent config fields that cannot be safely translated into runtime overrides.
- Logs and error payloads remain deterministic and secret-safe after refactor:
  - no auth tokens, auth file contents, full TOML blobs, or raw device-auth secrets in logs;
  - diagnostic logs may include sanitized key names/paths and boolean presence flags only.
- `design.md` and `projectStructure.md` are updated to reflect new Codex home strategy, runtime config override flow, and re-auth UX/API contract changes.

### Message Contracts & Storage Shapes (Upfront Definitions)

This section defines contract/storage changes required by this story so implementation does not guess or duplicate existing shapes.

#### 1. Device Auth API Contract (`POST /codex/device-auth`)

- Existing contract (current code + OpenAPI):
  - Request: `{ target: 'chat' | 'agent', agentName?: string }`
  - Response: `{ status: string, rawOutput: string, target: string, agentName?: string }`
- Target contract for this story:
  - Request: `{}` (no selector fields; server determines shared-home auth target internally)
  - Response success (`200`): `{ status: "ok", rawOutput: string }`
  - Response invalid request (`400`): `{ error: "invalid_request", message: string }`
  - Response unavailable (`503`): `{ error: "codex_unavailable", reason: string }`
- Compatibility rule:
  - Legacy selector fields (`target`, `agentName`) are rejected with `400 invalid_request`.
- Shared definitions to update:
  - `common`/shared API typing surfaces
  - `openapi.json`
  - `server/src/routes/codexDeviceAuth.ts`
  - `client/src/api/codex.ts`
  - `client/src/components/codex/CodexDeviceAuthDialog.tsx`
  - `client/src/pages/ChatPage.tsx`
  - `client/src/pages/AgentsPage.tsx`

#### 2. Chat Models Capability Contract (`GET /chat/models?provider=codex`)

- Existing contract (current code):
  - `ChatModelsResponse` includes `models` and `codexDefaults`, but no per-model reasoning capability payload.
- Target contract for this story:
  - Add codex capability payload so frontend reasoning options come from backend model capabilities, not hard-coded UI lists.
  - Required payload shape:
    - per model: `supportedReasoningEfforts: string[]`
    - per model: `defaultReasoningEffort: string`
  - Values come from codex model capabilities (for example `none`, `minimal`, `low`, `medium`, `high`, and where present `xhigh`), not a frontend static enum.
  - Example model payload (shape only):
    ```json
    {
      "key": "gpt-5.3-codex-spark",
      "displayName": "GPT-5.3 Codex Spark",
      "type": "codex",
      "supportedReasoningEfforts": ["none", "minimal", "low", "medium", "high", "xhigh"],
      "defaultReasoningEffort": "high"
    }
    ```
- Shared definitions to update:
  - `common/src/lmstudio.ts` (canonical shared types)
  - `server/src/routes/chatModels.ts` (payload producer)
  - `client/src/hooks/useChatModel.ts` and `client/src/components/chat/CodexFlagsPanel.tsx` (payload consumer)
  - `openapi.json` (publish contract if `/chat/models` is documented in this story update)

#### 3. Runtime Config Storage Shapes (On Disk)

- Shared base config (`./codex/config.toml`):
  - Target role: shared home/auth/session defaults and shared `[projects]` defaults only.
  - Not allowed to define behavior that overrides named-agent runtime behavior.
  - Final minimized shape expectation (example):
    ```toml
    [projects]
    [projects."/data"]
    trust_level = "trusted"
    [projects."/app/server"]
    trust_level = "trusted"
    ```
  - Keys such as `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `[features]`, and `[mcp_servers]` must be removed from this file in the final isolated minimization step.
  - Canonical keys for this story area:
    - `tools.view_image` (not `features.view_image_tool`)
    - top-level `web_search` mode (`live` / `cached` / `disabled`)
- Chat runtime config (`./codex/chat/config.toml`):
  - New/required shape for chat behavior defaults.
  - Must be copied from existing `./codex/config.toml` before base minimization.
  - Must exist before base minimization is executed.
- Agent runtime config (`codex_agents/<agent>/config.toml`):
  - Source of truth for agent behavior keys.
  - Legacy key normalization at read time:
    - `features.view_image_tool -> tools.view_image`
    - legacy web-search flags -> canonical `web_search`
  - Validation policy:
    - unknown keys warn+ignore;
    - invalid type for supported key hard-fails the run.
- Auth files:
  - `./codex/auth.json` and `codex_agents/*/auth.json` must remain on disk.
  - No delete/move/rename under `codex_agents/*`.
  - Story must not alter auth file contents except normal Codex login refresh behavior.

#### 4. In-Memory Effective Runtime Shape (Server Merge Result)

- Agent run effective shape:
  - Behavior keys from `codex_agents/<agent>/config.toml`.
  - Shared project trust merged as:
    - `effectiveProjects = { ...baseProjects, ...agentProjects }`
  - No other shared-base behavior keys may override named-agent behavior.
- Chat run effective shape:
  - Behavior keys from `./codex/chat/config.toml`.
  - Shared `CODEX_HOME` environment still used for auth/session.

### Edge Cases and Failure Modes

This section defines non-happy-path conditions that must be handled deterministically during implementation.

1. Migration sequencing and partial rollout hazards
   - Failure mode: `./codex/config.toml` is minimized before `./codex/chat/config.toml` is created.
   - Impact: chat behavior defaults disappear/regress immediately in this running instance.
   - Required handling: enforce copy-first ordering (`config.toml -> chat/config.toml`), and fail migration step with explicit error if chat config file is missing at minimization time.

2. Shared-home availability false negatives
   - Failure mode: detection logic still checks only legacy per-agent home semantics for chat availability.
   - Impact: provider status incorrectly reports unavailable even when shared `./codex/auth.json` is valid.
   - Required handling: availability checks for chat must read shared-home auth/config presence only; agent execution checks may still validate agent-specific config presence.

3. Device-auth request-shape mismatch during frontend/backend rollout
   - Failure mode: old client still sends `target`/`agentName` after backend moves to `{}` request body contract.
   - Impact: confusing silent fallback or ambiguous re-auth target behavior.
   - Required handling: deterministic `400 invalid_request` with a clear message for any selector fields; no reinterpretation or defaulting.

4. Concurrent device-auth operations
   - Failure mode: multiple `/codex/device-auth` requests run concurrently and race auth propagation/refresh.
   - Impact: stale availability state or inconsistent auth propagation timing.
   - Required handling: completion-side effects stay idempotent and deterministic; completion success/failure must not leak secrets and must not corrupt shared auth state.

5. Runtime config read/parse failures
   - Failure mode: missing file, unreadable file, or invalid TOML in `./codex/chat/config.toml` or `codex_agents/<agent>/config.toml`.
   - Impact: run path ambiguity (unexpected fallback to shared behavior or wrong agent behavior).
   - Required handling:
     - agent runs: hard-fail that agent run with deterministic validation error (no fallback to another config source for behavior keys);
     - chat runs: deterministic startup/runtime error surfaced to caller/logs; no silent fallback to minimized `./codex/config.toml` behavior keys.

6. Base/agent merge precedence regressions
   - Failure mode: shared config behavior keys leak into agent runtime behavior when merge logic is incorrect.
   - Impact: named-agent behavior changes from current user-visible expectations.
   - Required handling: only `[projects]` entries are inherited from shared base; all other behavior keys are agent-owned for agent runs.

7. Legacy-key normalization collisions
   - Failure mode: both canonical and legacy keys exist with conflicting values (for example both `tools.view_image` and `features.view_image_tool`).
   - Impact: non-deterministic behavior between invocation paths.
   - Required handling: one deterministic normalization order is enforced and documented; canonical key wins when both are present.

8. Unsupported key/type handling drift across paths
   - Failure mode: REST run, MCP run, and flow-driven execution apply different unknown-key/type validation behavior.
   - Impact: same agent config behaves differently by invocation path.
   - Required handling: one shared validation policy implementation is used across all execution surfaces:
     - unknown key => warning + ignore;
     - invalid type for supported key => hard validation error.

9. Reasoning-effort capability drift
   - Failure mode: UI sends stale/unsupported effort for selected model (for example model set changed after refresh).
   - Impact: avoidable run-time validation errors or hidden downgraded behavior.
   - Required handling: UI must reset invalid selection to model `defaultReasoningEffort`; backend must validate supported efforts per selected model and reject invalid values deterministically.

10. Capability payload incompleteness
   - Failure mode: backend returns model list without `supportedReasoningEfforts` or `defaultReasoningEffort`.
   - Impact: frontend cannot render deterministic reasoning-effort controls.
   - Required handling: codex model payload contract is strict for every codex model entry; missing fields are treated as server contract bugs and covered by tests.

11. SDK upgrade contract drift
   - Failure mode: latest stable `@openai/codex-sdk` changes accepted config key/value shapes (including reasoning effort values).
   - Impact: runtime override mapping or validation becomes stale.
   - Required handling: record exact upgraded version, lock contract tests around runtime config mapping and effort validation, and remove legacy shims only after tests pass against upgraded SDK.

12. Non-destructive file safety violations
   - Failure mode: migration scripts or refactors accidentally delete/move/rename `codex_agents/*` files (especially `auth.json`).
   - Impact: current running instance breaks and cannot recover agent auth continuity.
   - Required handling: explicit guards and verification checks ensure all existing `codex_agents/*/auth.json` files remain present after migration steps.

13. Sensitive-log leakage during failures
   - Failure mode: parse or auth errors log full config/auth content or unredacted device-auth output.
   - Impact: credential/secret exposure in logs.
   - Required handling: logging remains key-path and presence-flag based; only sanitized output samples allowed; never log raw auth blobs/tokens.

14. Final isolated minimization blast radius
   - Failure mode: developers continue relying on chat-agent-backed `code_info` after minimized `./codex/config.toml` disables chat agent in this running instance.
   - Impact: planning/verification flow unexpectedly breaks mid-story.
   - Required handling: final-step warning is explicit in tasks and handoff notes; all `code_info`-dependent checks must occur before minimization.

### Out Of Scope

- Redesigning the entire agents UX beyond the required re-auth simplification.
- Introducing new Codex providers or non-Codex authentication systems.
- Reworking unrelated ingest/embedding architecture.
- Introducing persistent config editing UI for agent `config.toml` files in this story.
- Converting all agent configuration to a different file format (for example YAML/JSON) in this story.
- Changing intended behavior of existing agents (this story preserves existing agent behavior rather than redefining agent policy semantics).
- Introducing a second Codex home/auth store for chat (chat and agents continue using one shared `CODEX_HOME`).
- Deleting, moving, or renaming any files inside `codex_agents/*` (including `auth.json`) as part of this story.
- Performing `./codex/config.toml` minimization before all other story implementation and verification work is complete.

### Questions

None. All prior questions are resolved, and non-destructive preservation of files under `codex_agents/*` is a mandatory constraint for this story.

## Resolved Findings (Initial Research)

- Latest stable SDK version at planning time is `@openai/codex-sdk@0.106.0` (registry checked on 2026-02-27); `0.107.0` is alpha only at this time. Runtime `CodexOptions.config` overrides and `env` control remain available and suitable for this design.
- Current SDK typings already include `xhigh` (and `minimal`) in `ModelReasoningEffort`, so existing app-side compatibility widening for `xhigh` is now redundant and should be removed as part of this story.
- Published SDK package confirms runtime `config` overrides are passed as CLI `--config` entries, so per-agent runtime override mapping is feasible without writing files during each run.
- Upstream codex model metadata (codex MCP/app-server docs) exposes per-model `supportedReasoningEfforts` and `defaultReasoningEffort`, with values that can include `none|minimal|low|medium|high|xhigh`; story tasking must therefore avoid any static reasoning-effort enum source for capability payloads.
- The proposal is achievable without changing the agent behavior contract, provided runtime precedence is enforced so named-agent config values always win for behavior fields.
- Chat should use a dedicated runtime config file (copy of current `./codex/config.toml`) while still using the same shared `CODEX_HOME`; this avoids introducing a second auth/session home.
- Chat config copy must be created before minimizing `./codex/config.toml` so chat behavior remains stable during rollout.
- All three current agent config files contain supported core behavior keys: `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `[mcp_servers.*]`, and `[projects.*].trust_level`.
- Current compatibility gaps found in agent files:
  - `features.view_image_tool` is not a current schema key and requires compatibility mapping to `tools.view_image`.
  - Legacy web-search keys should normalize to canonical top-level `web_search` mode to avoid mixed key behavior.
  - `cli_auth_credentials_store = \"file\"` is currently nested under a project table in all agent files, not top-level, and therefore should not be treated as a valid project-level behavior field.
- Current server model-capability behavior is split across static/env sources (`getCodexModelList`, `getCodexEnvDefaults`, and hard-coded `chatValidators` lists) for chat model payload and chat validation (`/chat/models` and `/chat`); story implementation should consolidate these chat-facing paths into one shared runtime capability resolver to reduce drift without widening scope into unrelated surfaces.
- Codex upstream config layering behavior validates this story’s precedence model: lower layers are overridden by higher layers, and table/object values are merged while scalar overrides replace prior values.
- Upstream model capability surfaces can vary by model; reasoning effort options must be derived from backend capability/model listing payloads rather than hard-coded UI enums.
- `codex/config.toml` currently defines shared project trust entries for `/data` and `/app/server`; `coding_agent` additionally defines `/Users/danielstapleton/Documents/dev`.
- Base-project merge policy required by this story: shared `[projects]` defaults may be inherited, but agent-defined project entries take precedence and no other shared-base behavior keys are allowed to override agent behavior.
- Product decision: preserve existing `codex_agents/*` files for this running instance; specifically, do not delete/move/rename `auth.json` or any other file under agent folders during this story.
- Product decision: keep per-agent auth handling in non-destructive compatibility mode where required for runtime stability rather than removing agent-folder auth artifacts.
- Product decision: change backend device-auth contract to a single-shape empty JSON request body (`{}`) in this story at the point where frontend/backend rollout is aligned; do not stage one-release backward-compatible parsing.
- Product decision: after migration, device-auth uses one request shape only and legacy selector fields are rejected with deterministic client error responses.
- Product decision: agent TOML validation policy is fixed as unknown-key warning+ignore, supported-key invalid-type hard error, with no silent fallback to shared/other agent behavior.
- Product decision: treat `./codex/config.toml` minimization as a final isolated end-of-story step only; after this step in the running instance, chat-agent-backed `code_info` MCP usage is expected to be unavailable and must stop.

## Implementation Ideas

1. Freeze shared contracts and canonical config vocabulary first.
   - Update shared types/contracts in `common/src/lmstudio.ts` and `openapi.json` for:
     - dynamic reasoning-effort capability payload returned to the client;
     - simplified device-auth request/response shape;
     - canonical config keys (`tools.view_image`, top-level `web_search`) and legacy alias handling rules.
   - Keep this phase contract-only so later code wiring has one stable target.

2. Introduce shared `CODEX_HOME` layout and migration guardrails before runtime rewiring.
   - Update `server/src/config/codexConfig.ts` to support:
     - shared home `./codex`;
     - dedicated chat runtime config `./codex/chat/config.toml`;
     - safe migration copy from existing `./codex/config.toml` to chat config.
   - Update `server/src/providers/codexDetection.ts` to align startup/availability checks with shared-home behavior.
   - Do not minimize `./codex/config.toml` in this phase.

3. Add a dedicated runtime config merge/normalization layer.
   - Build deterministic merge path for agent execution:
     - base shared config (`./codex/config.toml`) projects only;
     - agent config (`codex_agents/<agent>/config.toml`) behavior keys;
     - effective projects merge: `{ ...baseProjects, ...agentProjects }`.
   - Normalize legacy keys at read time:
     - `features.view_image_tool -> tools.view_image`;
     - legacy web-search keys -> canonical `web_search`.
   - Apply fixed validation policy:
     - unknown keys warn+ignore;
     - invalid supported key types hard-fail for that run.

4. Rewire all runtime callers to consume merged runtime config.
   - Pass runtime `CodexOptions.config` consistently in:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`;
     - `server/src/agents/service.ts`;
     - `server/src/flows/service.ts`;
     - related helper paths in `server/src/agents/config.ts` as needed.
   - Preserve `useConfigDefaults: true` behavior and current user-visible agent behavior.

5. Simplify device-auth API/backend/frontend flow after runtime config wiring is stable.
   - Backend: simplify `server/src/routes/codexDeviceAuth.ts` to one request shape and deterministic legacy-field rejection.
   - Client API: update `client/src/api/codex.ts`.
   - UI: remove target selector/branching from:
     - `client/src/components/codex/CodexDeviceAuthDialog.tsx`;
     - `client/src/pages/ChatPage.tsx`;
     - `client/src/pages/AgentsPage.tsx`.

6. Shift reasoning-effort UX to backend model capabilities.
   - Backend capability payload from `server/src/routes/chatModels.ts` should drive allowed values per model.
   - Client consumes and renders dynamic options in:
     - `client/src/hooks/useChatModel.ts`;
     - `client/src/components/chat/CodexFlagsPanel.tsx`;
     - `client/src/hooks/useChatStream.ts` typing surfaces.
   - Do not assume static enum parity across surfaces; UI options must follow backend capability payload.

7. Remove compatibility shims and complete SDK alignment.
   - Upgrade `@openai/codex-sdk` in `server/package.json` from `0.101.0` to latest stable on implementation day (no alpha).
   - Remove local widened reasoning-effort shim paths in server/client typing where SDK-native types now cover support.
   - Validate no regressions in thread start/resume and stream event handling.

8. Hardening, tests, and documentation alignment before final config minimization.
   - Add/update regression coverage for:
     - precedence + normalization;
     - shared-home detection and auth behavior;
     - device-auth simplified contract;
     - reasoning capability payload-driven UI behavior;
     - preservation of files under `codex_agents/*`.
   - Update `design.md` and `projectStructure.md` to match runtime behavior and contract changes.

9. Perform `./codex/config.toml` minimization as isolated final step only.
   - After all code/tests/docs are complete, reduce shared config to minimal shared defaults.
   - Keep explicit operator warning that `code_info` MCP is expected to stop working for this running instance after this step.

## Tasking Readiness (Junior Handoff)

The story is ready to be tasked only when all the following are explicit in the resulting tasks:

- Scope boundaries are preserved:
  - no delete/move/rename under `codex_agents/*`;
  - `codex_agents/*/auth.json` files remain present;
  - no behavior redesign for existing agents.
- Contract changes are represented as concrete deliverables:
  - `POST /codex/device-auth` uses empty-body `{}` input and the exact `200/400/503` response shapes defined above;
  - legacy selector fields are rejected (not silently translated);
  - chat model payload includes `supportedReasoningEfforts` and `defaultReasoningEffort`.
- Runtime precedence outputs are explicit and testable:
  - agent behavior comes from `codex_agents/<agent>/config.toml`;
  - chat behavior comes from `./codex/chat/config.toml`;
  - shared `./codex/config.toml` contributes shared `[projects]` defaults only via `effectiveProjects = { ...baseProjects, ...agentProjects }`.
- Canonical normalization outcomes are explicit and testable:
  - `features.view_image_tool` is read as alias input and emitted as `tools.view_image`;
  - legacy web-search input keys normalize to canonical top-level `web_search`;
  - unknown-key and invalid-type handling follows one fixed policy (warn+ignore vs hard-fail).
- Final migration sequencing is explicit and safe:
  - create `./codex/chat/config.toml` before minimizing `./codex/config.toml`;
  - minimize `./codex/config.toml` only in the final isolated implementation step;
  - include the explicit warning that `code_info` MCP is expected to be unavailable after this final step in this running instance.

# Implementation Plan

## Instructions

1. Read all story sections above before coding, especially Acceptance Criteria, Message Contracts, and Edge Cases.
2. Complete tasks in the exact order below; do not start frontend contract consumers before their server contract tasks are complete.
3. Keep each task focused to one testable implementation concern.
4. Keep `codex_agents/*` non-destructive at all times: no delete/move/rename operations.
5. For all config/contract changes, add deterministic tests in the same task before marking it complete.
6. Keep the final `./codex/config.toml` minimization as the last isolated task only.

## Tasks

### 1. Server: Upgrade Codex SDK to latest stable

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Upgrade `@openai/codex-sdk` to latest stable at implementation start and lock dependency resolution before any behavior refactor work.

#### Documentation Locations

- Codex SDK README (config overrides and thread options): Context7 `/openai/codex`
- npm semver guidance: https://docs.npmjs.com/about-semantic-versioning

#### Subtasks

1. [ ] Upgrade `@openai/codex-sdk` in `server/package.json` to latest stable (no pre-release).
   - Files: `server/package.json`.
   - Do: replace `@openai/codex-sdk` version with latest stable (no `-alpha`, `-beta`, `-rc`).
   - Docs: Context7 `/openai/codex`, https://docs.npmjs.com/about-semantic-versioning.
   - Done when: `server/package.json` references a stable version only.
2. [ ] Update lockfile and ensure only one resolved SDK version is used by server workspace dependency tree.
   - Files: root `package-lock.json`.
   - Do: run workspace install/update and confirm a single resolved `@openai/codex-sdk` entry for server path.
   - Docs: https://docs.npmjs.com/cli/v10/commands/npm-ls.
   - Done when: `npm ls @openai/codex-sdk --workspace server` shows one version.
3. [ ] Record exact upgraded SDK version in this story file Implementation notes for traceability.
   - Files: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Do: add a dated note under Task 1 implementation notes with exact version string.
   - Docs: https://keepachangelog.com/en/1.0.0/.
   - Done when: Task 1 notes explicitly state the final upgraded version.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm ls @openai/codex-sdk --workspace server`

#### Implementation notes

- None yet.

### 2. Server: Remove local reasoning-effort widening shims and align shared/client/server typing

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Remove compatibility-only widened reasoning-effort unions/casts and align code to SDK-native/runtime capability values.

#### Documentation Locations

- Codex SDK types/interfaces: Context7 `/openai/codex`
- TypeScript handbook (type narrowing and unions): https://www.typescriptlang.org/docs/

#### Subtasks

1. [ ] Remove local widened reasoning-effort type shims/casts in server runtime code and tests (for example `ModelReasoningEffort | 'xhigh'` compatibility-only types).
   - Files: `server/src/chat`, `server/src/routes`, `server/src/codex` (all files currently widening effort unions), plus matching `server/src/test` files.
   - Do: replace widened unions/casts with SDK-native types.
   - Docs: Context7 `/openai/codex`, https://www.typescriptlang.org/docs/handbook/2/everyday-types.html.
   - Done when: no server type includes manual `| 'xhigh'` compatibility additions.
2. [ ] Remove any client/shared compatibility typings that were only present to widen values already supported by upgraded SDK.
   - Files: `common/src/lmstudio.ts`, `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`, related client test files.
   - Do: delete widened local aliases and rely on shared/server capability payload types.
   - Docs: https://www.typescriptlang.org/docs/handbook/2/types-from-types.html.
   - Done when: shared/client type surfaces do not carry compatibility-only widening.
3. [ ] Update shared/client/server reasoning-effort type usage to SDK-native/runtime capability values (including `none`/`minimal` when surfaced) and remove manual cast-based compatibility types in chat validators/flag payload builders.
   - Files: `server/src/routes/chat.ts` (or validators file), `server/src/routes/chatModels.ts`, `client/src/components/chat/CodexFlagsPanel.tsx`, `common/src/lmstudio.ts`.
   - Do: use capability-driven value lists and remove cast-based forcing.
   - Docs: Context7 `/openai/codex`, https://react.dev/reference/react/useMemo.
   - Done when: validation and UI both consume typed capability values without manual casts.
4. [ ] Add/adjust unit tests to prove SDK-native reasoning-effort typing compiles and behavior remains unchanged for supported values.
   - Files: `server/src/test/**`, `client/src/test/**`, `common/src/**` tests if present.
   - Do: update compile-time and runtime tests for accepted/rejected values.
   - Docs: https://jestjs.io/docs/getting-started.
   - Done when: tests cover supported and unsupported values with deterministic assertions.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run build --workspace common`
4. [ ] Run targeted server and client reasoning-effort tests and verify pass.

#### Implementation notes

- None yet.

### 3. Server: Implement canonical runtime config loading, bootstrap, and normalization layer

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Create one server-side config resolution layer that reads shared base config, chat config, and agent config, and normalizes legacy keys to canonical keys.

#### Documentation Locations

- TOML v1.0.0 spec: https://toml.io/en/v1.0.0
- Codex config layering references: Context7 `/openai/codex`
- Node fs/path APIs: https://nodejs.org/api/fs.html and https://nodejs.org/api/path.html

#### Subtasks

1. [ ] Add/extend config loader module(s) to read `./codex/config.toml`, `./codex/chat/config.toml`, and `codex_agents/<agent>/config.toml`.
   - Files: `server/src/config/codexConfig.ts`, `server/src/agents/config.ts` (or shared resolver file), plus new helper module if needed under `server/src/config`.
   - Do: centralize file reads in one resolver API used by all callers.
   - Docs: https://toml.io/en/v1.0.0, https://nodejs.org/api/fs.html.
   - Done when: one resolver can return base/chat/agent parsed config objects.
2. [ ] Reuse existing codex/agent path resolution helpers (`getCodexHome`, `getCodexConfigPathForHome`, `discoverAgents` agent `home/configPath`) instead of introducing new path-discovery logic.
   - Files: `server/src/config/codexConfig.ts`, `server/src/agents/discovery.ts` (or existing helper locations).
   - Do: import and reuse existing helpers; remove duplicate path derivation code.
   - Docs: https://nodejs.org/api/path.html, https://nodejs.org/api/fs.html, Context7 `/openai/codex`.
   - Done when: no duplicate path-walk logic exists for these config locations.
3. [ ] Add chat runtime config bootstrap behavior.
   - Files: resolver/loader module from Subtask 1.
   - Do: if `./codex/chat/config.toml` missing and `./codex/config.toml` exists, copy once; never overwrite existing chat config.
   - Docs: https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode.
   - Done when: first run creates chat config once and subsequent runs preserve it.
4. [ ] Implement canonical normalization rules at read time.
   - Files: normalization helper in `server/src/agents/config.ts` or dedicated normalizer module.
   - Do: map `features.view_image_tool -> tools.view_image`; accept `features.web_search_request` as input alias only; normalize legacy web-search keys to top-level `web_search`; canonical key wins on conflict.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: normalized output always emits canonical keys only.
5. [ ] Add unit tests for normalization and canonical+legacy collision behavior.
   - Files: `server/src/test/**` for config loader/normalizer.
   - Do: add fixtures with canonical-only, legacy-only, and mixed key collisions.
   - Docs: https://jestjs.io/docs/expect.
   - Done when: tests explicitly assert canonical-wins behavior.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server -- agents-config-defaults`
3. [ ] Run new config-loader/normalization unit tests directly and verify pass.

#### Implementation notes

- None yet.

### 4. Server: Implement runtime config merge precedence, validation policy, and deterministic failure behavior

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Implement deterministic merge and validation behavior for runtime config resolution, including strict agent/chat failure handling and no behavior fallback leakage.

#### Documentation Locations

- TOML v1.0.0 spec: https://toml.io/en/v1.0.0
- Codex config layering references: Context7 `/openai/codex`

#### Subtasks

1. [ ] Implement deterministic merge behavior with `effectiveProjects = { ...baseProjects, ...agentProjects }`.
   - Files: shared resolver module introduced in Task 3, likely `server/src/agents/config.ts` and `server/src/config/codexConfig.ts`.
   - Do: merge only `[projects]` from base into agent; agent entries override same path keys.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: merge output preserves agent behavior keys and only inherits base projects.
2. [ ] Implement fixed validation policy in one shared validator (unknown key warn+ignore, invalid type hard error).
   - Files: shared validator in `server/src/agents/config.ts` or new `server/src/agents/configValidation.ts`.
   - Do: centralize rules and return structured diagnostics.
   - Docs: Context7 `/openai/codex` for valid config keys.
   - Done when: all run paths call the same validator function.
3. [ ] Implement deterministic config read/parse failure behavior for agent/chat.
   - Files: resolver and route/service error mapping (`server/src/agents/service.ts`, `server/src/chat/interfaces/ChatInterfaceCodex.ts`).
   - Do: hard-fail agent on missing/unreadable/invalid config; deterministic chat error with no fallback to base behavior keys.
   - Docs: Node fs errors https://nodejs.org/api/errors.html.
   - Done when: failures return stable error codes/messages across retries.
4. [ ] Ensure no fallback path allows shared behavior keys to override named-agent behavior keys.
   - Files: all resolver consumers in `server/src/agents/service.ts`, `server/src/flows/service.ts`, `server/src/mcp/**`.
   - Do: remove any fallback assignment from base behavior fields.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: code audit and tests show no shared behavior override in agent runs.
5. [ ] Add unit tests for merge precedence and validator outcomes.
   - Files: `server/src/test/**` config resolver suites.
   - Do: include unknown key warning assertions and invalid type error assertions.
   - Docs: https://jestjs.io/docs/mock-functions.
   - Done when: tests fail if policy changes.
6. [ ] Add unit tests for read/parse failure paths for both chat and agent config resolution.
   - Files: same resolver test suites plus service-layer tests.
   - Do: cover missing file, invalid TOML, unreadable permission cases.
   - Docs: https://nodejs.org/api/fs.html#file-system-flags.
   - Done when: deterministic error payloads/log messages are asserted.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server -- agents-config-defaults`
3. [ ] Run targeted config read/parse failure tests directly and verify deterministic error payloads/logs.

#### Implementation notes

- None yet.

### 5. Server: Replace model-only parsing with shared runtime config resolver across execution entrypoints

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Replace existing model-only config parsing (`readAgentModelId`) so all execution paths consume the same TOML-based runtime config resolver.

#### Documentation Locations

- Node fs/path APIs: https://nodejs.org/api/fs.html and https://nodejs.org/api/path.html
- Codex config references: Context7 `/openai/codex`

#### Subtasks

1. [ ] Replace existing line-based model-only config parsing (`readAgentModelId`) with the shared TOML-based runtime config resolver in all run surfaces.
   - Files: `server/src/agents/config.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`.
   - Do: remove regex/line parser usage for runtime behavior decisions.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: `readAgentModelId` is deleted or unused for runtime decisions.
2. [ ] Update agent service and flow service execution entrypoints to consume resolver output instead of regex/line parsing.
   - Files: `server/src/agents/service.ts`, `server/src/flows/service.ts`.
   - Do: inject resolver output into run option builders.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: agent and flow runs pull model/policy/tools from same resolver object.
3. [ ] Ensure no codepath still depends on `readAgentModelId` for runtime behavior decisions.
   - Files: whole server workspace; verify with search.
   - Do: remove old function or keep only for unrelated legacy read with explicit comment.
   - Docs: https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md.
   - Done when: `rg "readAgentModelId" server/src` shows no runtime-path callers.
4. [ ] Add regression tests proving model-only regex parsing is no longer used by any execution path.
   - Files: `server/src/test/agents/**`, `server/src/test/flows/**`.
   - Do: include a config that would fail old regex but pass new TOML resolver.
   - Docs: https://jestjs.io/docs/expect.
   - Done when: regression would fail if old parser is restored.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server -- agents-config-defaults`
3. [ ] Run targeted regression tests proving resolver usage across agents + flows.

#### Implementation notes

- None yet.

### 6. Server: Wire runtime config overrides into chat, agent run, and agent command execution paths

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Apply runtime config overrides to chat and primary REST agent execution surfaces while preserving `useConfigDefaults: true`.

#### Documentation Locations

- Codex SDK config override behavior: Context7 `/openai/codex`
- Express routing guide: https://expressjs.com/en/guide/routing.html

#### Subtasks

1. [ ] Update chat Codex execution path to pass chat runtime config via `CodexOptions.config` and shared `CODEX_HOME`.
   - Files: `server/src/chat/interfaces/ChatInterfaceCodex.ts`, supporting option-builder files.
   - Do: resolve `./codex/chat/config.toml` and pass normalized config in runtime options.
   - Docs: Context7 `/openai/codex` (`CodexOptions.config`).
   - Done when: chat run config source is chat config file only.
2. [ ] Update agent execution path (`/agents/:agentName/run`) to pass agent runtime config via `CodexOptions.config`.
   - Files: `server/src/agents/service.ts`, related route/controller file.
   - Do: call shared resolver and inject agent-specific config object.
   - Docs: Context7 `/openai/codex`, https://expressjs.com/en/guide/routing.html.
   - Done when: REST agent run never pulls behavior from shared base except projects merge.
3. [ ] Update agent command execution path (`/agents/:agentName/commands/run`) to use the same agent runtime config resolution.
   - Files: command route/service handler under `server/src/agents`.
   - Do: reuse exact resolver invocation from Subtask 2.
   - Docs: Express route docs https://expressjs.com/en/guide/routing.html.
   - Done when: command path and run path use shared helper.
4. [ ] Extend shared chat interface/runtime option plumbing (`ChatInterfaceCodex` + option builders) to accept runtime `CodexOptions.config` payloads without breaking existing call signatures.
   - Files: `server/src/chat/interfaces/ChatInterfaceCodex.ts`, `server/src/chat/**` option builder modules.
   - Do: thread optional config parameter through wrappers with backward-compatible defaults.
   - Docs: Context7 `/openai/codex`.
   - Done when: TypeScript compile confirms no caller breakage.
5. [ ] Ensure updated execution paths retain `useConfigDefaults: true` and do not reintroduce duplicated model/policy thread flag wiring.
   - Files: all touched run option builders.
   - Do: keep `useConfigDefaults: true` literal in all run starts.
   - Docs: Context7 `/openai/codex` thread start options.
   - Done when: no path sets duplicate thread model/policy flags when config defaults are active.
6. [ ] Add integration tests proving chat behavior is sourced from `./codex/chat/config.toml` and agent REST paths use agent config behavior.
   - Files: `server/src/test/chat/**`, `server/src/test/agents/**`.
   - Do: add explicit fixture assertions showing chat and agent read different files.
   - Docs: https://jestjs.io/docs/getting-started.
   - Done when: tests fail if chat path accidentally reads base/agent config.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] Verify targeted chat + agent run/command runtime-config tests pass.

#### Implementation notes

- None yet.

### 7. Server: Wire runtime config overrides into flow and MCP execution paths

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Apply the same runtime config resolution to flow-driven and MCP execution surfaces so behavior parity is preserved across all invocation paths.

#### Documentation Locations

- Codex SDK config override behavior: Context7 `/openai/codex`
- JSON-RPC 2.0 spec (MCP contract parity): https://www.jsonrpc.org/specification

#### Subtasks

1. [ ] Update flow-driven agent execution path to use the same agent runtime config resolution and precedence as REST.
   - Files: `server/src/flows/service.ts` and flow step execution helpers.
   - Do: call the shared resolver used in Task 6 Subtask 2.
   - Docs: Context7 `/openai/codex`, https://www.jsonrpc.org/specification.
   - Done when: flow step run options match REST agent run options for same agent.
2. [ ] Update MCP agent execution surfaces to resolve the same runtime config behavior as REST and flow surfaces.
   - Files: `server/src/mcp/**` agent execution adapters.
   - Do: replace any direct model-only config read with shared resolver.
   - Docs: https://www.jsonrpc.org/specification.
   - Done when: MCP path has same config source and validation path.
3. [ ] Ensure all updated paths retain `useConfigDefaults: true` and do not duplicate model/policy flag logic.
   - Files: flow and MCP run option builders.
   - Do: verify options include `useConfigDefaults: true` and no duplicate model/policy flags.
   - Docs: Context7 `/openai/codex`.
   - Done when: static search confirms `useConfigDefaults` set consistently.
4. [ ] Add integration tests proving behavior parity across REST agent run, commands run, flow step, and MCP execution.
   - Files: `server/src/test/agents/**`, `server/src/test/flows/**`, `server/src/test/mcp/**`.
   - Do: run same fixture agent through all four surfaces and compare effective runtime config.
   - Docs: https://jestjs.io/docs/using-matchers.
   - Done when: parity test snapshots/assertions are identical where expected.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] Verify targeted flow + MCP runtime-config tests pass.

#### Implementation notes

- None yet.

### 8. Server: Shared-home detection alignment for Codex availability and startup semantics

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Move Codex availability and startup checks to shared-home semantics for chat and shared runtime behavior.

#### Documentation Locations

- Node child_process/fs docs: https://nodejs.org/api/child_process.html and https://nodejs.org/api/fs.html
- Codex runtime/home behavior: Context7 `/openai/codex`

#### Subtasks

1. [ ] Update detection/startup logic to treat shared `./codex` as chat availability source of truth.
   - Files: `server/src/providers/codexDetection.ts`, `server/src/config/codexConfig.ts`.
   - Do: for chat availability, check shared-home auth/config only.
   - Docs: Context7 `/openai/codex`, https://nodejs.org/api/fs.html.
   - Done when: chat availability remains true when shared auth is valid even if agent-local auth differs.
2. [ ] Reuse existing detection/auth helpers (`detectCodexForHome`, `refreshCodexDetection`, `ensureAgentAuthSeeded`, `propagateAgentAuthFromPrimary`) and avoid parallel duplicate implementations.
   - Files: `server/src/providers/codexDetection.ts`, `server/src/agents/auth*` helper files.
   - Do: compose existing helpers, do not add second implementation path.
   - Docs: https://nodejs.org/api/fs.html, https://nodejs.org/api/child_process.html.
   - Done when: detection/auth behavior routes through existing helper functions.
3. [ ] Add tests for shared-home availability outcomes and detection refresh behavior.
   - Files: `server/src/test/codex/**`.
   - Do: cover startup and refresh paths with shared-home fixtures.
   - Docs: https://jestjs.io/docs/timer-mocks.
   - Done when: tests assert deterministic available/unavailable states and refresh transitions.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server -- codex`

#### Implementation notes

- None yet.

### 9. Server: Non-destructive auth compatibility and agent-file safety guards

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Retain existing auth seeding/propagation compatibility behavior without deleting, moving, or renaming anything under `codex_agents/*`.

#### Documentation Locations

- Node fs docs: https://nodejs.org/api/fs.html
- Codex runtime/home behavior: Context7 `/openai/codex`

#### Subtasks

1. [ ] Keep compatibility auth seeding/propagation behavior non-destructive for `codex_agents/*/auth.json`.
   - Files: `server/src/agents/auth*`, `server/src/providers/codexDetection.ts`.
   - Do: preserve copy/seed behavior without deletions or renames.
   - Docs: https://nodejs.org/api/fs.html, Context7 `/openai/codex`.
   - Done when: runtime still seeds/propagates as before and no destructive ops exist.
2. [ ] Add guards/tests to ensure no code path deletes, renames, or moves files under `codex_agents/*`.
   - Files: auth helper modules and related tests under `server/src/test`.
   - Do: add guard assertions or filesystem spies for `unlink`, `rm`, `rename` on `codex_agents/*`.
   - Docs: https://nodejs.org/api/fs.html#fsrenameoldpath-newpath-callback.
   - Done when: tests fail on any destructive call under agent directories.
3. [ ] Add tests for auth propagation idempotency and post-run file presence guarantees.
   - Files: `server/src/test/agents-authSeed*` suites.
   - Do: run propagation twice and assert same result and file presence.
   - Docs: https://jestjs.io/docs/expect.
   - Done when: idempotency and file-presence assertions pass.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server -- agents-authSeed`
3. [ ] Run file-safety guard tests directly and verify pass.

#### Implementation notes

- None yet.

### 10. Server Message Contract: Simplify `POST /codex/device-auth` to single request shape

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Implement the server-side device-auth message contract change first: request body must be `{}` only, with deterministic `200/400/503` responses and legacy selector-field rejection.

#### Documentation Locations

- OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html
- Express JSON/body handling: https://expressjs.com/en/resources/middleware/body-parser.html
- JSON response best practices: https://datatracker.ietf.org/doc/html/rfc7807

#### Subtasks

1. [ ] Update `server/src/routes/codexDeviceAuth.ts` request parsing to accept only empty JSON object and reject selector fields (`target`, `agentName`) with `400 invalid_request`.
   - Files: `server/src/routes/codexDeviceAuth.ts`.
   - Do: add strict request body validation at route start.
   - Docs: https://expressjs.com/en/resources/middleware/body-parser.html.
   - Done when: `{ "target": "chat" }` and `{ "agentName": "x" }` return `400 invalid_request`.
2. [ ] Reject any non-empty request body (not only selector fields) with deterministic `400 invalid_request` so the `{}` contract is strict.
   - Files: `server/src/routes/codexDeviceAuth.ts`.
   - Do: enforce `Object.keys(body).length === 0` contract.
   - Docs: OpenAPI object schema rules https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: `{ "foo": "bar" }` also returns `400 invalid_request`.
3. [ ] Update shared/common API types for device-auth request/response to the single-shape contract.
   - Files: `common/src/**` API contract types, `client/src/api/codex.ts` types if shared import not used.
   - Do: define request `{}` and response union for `200/400/503`.
   - Docs: TypeScript discriminated unions https://www.typescriptlang.org/docs/.
   - Done when: client and server compile against same type contract.
4. [ ] Update success and error response payloads to the defined contract.
   - Files: `server/src/routes/codexDeviceAuth.ts`.
   - Do: return exactly:
     - `200 { status: "ok", rawOutput }`
     - `400 { error: "invalid_request", message }`
     - `503 { error: "codex_unavailable", reason }`
   - Docs: RFC 7807 guidance https://datatracker.ietf.org/doc/html/rfc7807.
   - Done when: integration tests assert exact JSON shapes.
5. [ ] Remove legacy dual-shape parsing/response behavior from backend route.
   - Files: `server/src/routes/codexDeviceAuth.ts` and any helper parsing modules.
   - Do: remove target-branch logic and dead types.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: no route code references `target` or `agentName` request semantics.
6. [ ] Update `openapi.json` for `/codex/device-auth` request and response schemas.
   - Files: `openapi.json`.
   - Do: reflect strict `{}` request and `200/400/503` response bodies.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: schema validation and route tests align.
7. [ ] Add/update server integration tests for success/error and rejection scenarios.
   - Files: `server/src/test/codex.device-auth*` suites.
   - Do: cover empty request success, selector rejection, unknown-field rejection, unavailable `503`, payload-too-large behavior.
   - Docs: https://jestjs.io/docs/asynchronous.
   - Done when: each scenario has explicit assertion for status and payload shape.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server -- codex.device-auth`
3. [ ] Validate `/codex/device-auth` schema changes in `openapi.json`.

#### Implementation notes

- None yet.

### 11. Server Message Contract: Device-auth concurrency handling and post-success side effects

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Add deterministic concurrent request behavior and preserve post-success auth propagation/availability refresh under the simplified device-auth contract.

#### Documentation Locations

- Express request handling: https://expressjs.com/en/guide/routing.html
- Node async/concurrency behavior: https://nodejs.org/api/

#### Subtasks

1. [ ] Add deterministic concurrent request handling so overlapping device-auth runs remain idempotent and do not corrupt auth propagation state.
   - Files: `server/src/routes/codexDeviceAuth.ts`, shared lock helper module.
   - Do: reuse conversation-lock pattern (`tryAcquireConversationLock` / `releaseConversationLock`) or equivalent shared lock helper.
   - Docs: https://nodejs.org/api/async_context.html, https://nodejs.org/api/fs.html.
   - Done when: concurrent requests do not create inconsistent auth state.
2. [ ] Preserve non-destructive post-success auth propagation/availability refresh behavior under the single-shape contract.
   - Files: `server/src/routes/codexDeviceAuth.ts`, `server/src/providers/codexDetection.ts`, auth propagation helpers.
   - Do: keep existing refresh/propagation side effects, but only after successful auth.
   - Docs: https://nodejs.org/api/async_context.html, https://expressjs.com/en/guide/routing.html.
   - Done when: successful auth still triggers refresh and propagation safely.
3. [ ] Add/update integration tests for concurrent request behavior and post-success side effects.
   - Files: `server/src/test/codex.device-auth*` suites.
   - Do: create overlapping request tests and assert deterministic responses + side effects.
   - Docs: https://jestjs.io/docs/setup-teardown.
   - Done when: tests confirm idempotent behavior under contention.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server -- codex.device-auth`
3. [ ] Run targeted concurrency test(s) for `/codex/device-auth` and verify idempotent outcomes.

#### Implementation notes

- None yet.

### 12. Server Message Contract: Add codex model reasoning-capability payload to `/chat/models`

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Implement backend model-capability payload contract for Codex models so frontend reasoning options are driven by server data, not hard-coded values.

#### Documentation Locations

- Codex model capability references: Context7 `/openai/codex`
- OpenAPI 3.0.3 schema docs: https://spec.openapis.org/oas/v3.0.3.html
- TypeScript JSON schema typing patterns: https://www.typescriptlang.org/docs/

#### Subtasks

1. [ ] Update shared response types in `common/src/lmstudio.ts` to include per-model capability fields.
   - Files: `common/src/lmstudio.ts`.
   - Do: add `supportedReasoningEfforts: string[]` and `defaultReasoningEffort: string` on codex model DTOs.
   - Docs: Context7 `/openai/codex`, TypeScript docs.
   - Done when: shared types compile and are consumed by server/client.
2. [ ] Update `server/src/routes/chatModels.ts` to include capability fields for every codex model item.
   - Files: `server/src/routes/chatModels.ts`.
   - Do: populate both capability fields from resolver/model metadata for each codex entry.
   - Docs: Context7 `/openai/codex`.
   - Done when: API response includes fields on all codex models.
3. [ ] Update `openapi.json` for `/chat/models` codex response schema if documented there.
   - Files: `openapi.json`.
   - Do: add both new fields as required for codex model schema entries.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: schema reflects runtime payload.
4. [ ] Update shared mock fixtures and contract helpers to include capability fields.
   - Files: `common/src/fixtures/mockModels.ts`, related test helpers.
   - Do: update all codex fixture objects with supported/default effort fields.
   - Docs: https://jestjs.io/docs/setup-teardown, https://www.typescriptlang.org/docs/.
   - Done when: fixture-driven tests do not require ad-hoc overrides.
5. [ ] Add/update server tests for codex model payload completeness and field presence.
   - Files: `server/src/test/chatModels.codex*` suites.
   - Do: assert each returned codex model includes non-empty `supportedReasoningEfforts` and valid `defaultReasoningEffort` member.
   - Docs: https://jestjs.io/docs/expect.
   - Done when: tests fail if either field is missing.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace common`
3. [ ] `npm run test --workspace server -- chatModels.codex`

#### Implementation notes

- None yet.

### 13. Server: Share codex capability resolver across `/chat/models` and `/chat`

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Replace static reasoning/model sources with one shared runtime codex capability resolver and use it consistently for chat response payloads and chat request validation.

#### Documentation Locations

- Codex model capability references: Context7 `/openai/codex`

#### Subtasks

1. [ ] Replace static reasoning/model sources for chat capability payloads and chat validation with one shared runtime codex capability resolver sourced from model metadata.
   - Files: `server/src/routes/chatModels.ts`, `server/src/routes/chat.ts`, existing `chatValidators` and helper files.
   - Do: remove hard-coded effort arrays and `getCodexModelList`/`getCodexEnvDefaults` static assumptions where applicable.
   - Docs: Context7 `/openai/codex`.
   - Done when: both routes read capabilities from same resolver output.
2. [ ] Implement one shared codex capability resolver module used by `/chat/models` payload generation and `/chat` validation.
   - Files: new module under `server/src/codex/` or `server/src/chat/` plus imports in both routes.
   - Do: expose stable API returning supported/default effort per model with deterministic fallback when metadata unavailable.
   - Docs: Context7 `/openai/codex`, https://www.typescriptlang.org/docs/.
   - Done when: one module is imported by both consumers.
3. [ ] Ensure deterministic behavior when capability data changes and emit only capability-normalized effort values.
   - Files: shared resolver and `chatModels` route mapping.
   - Do: normalize ordering and ensure fallback default is explicit.
   - Docs: Context7 `/openai/codex`, https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: emitted values are deterministic across repeated calls.
4. [ ] Add server-side chat request validation that rejects unsupported `model_reasoning_effort` values for selected model with deterministic `invalid_request` errors.
   - Files: `server/src/routes/chat.ts`, validator module.
   - Do: validate effort against selected model capability set; no silent downgrade.
   - Docs: https://datatracker.ietf.org/doc/html/rfc7807, https://httpwg.org/specs/rfc9110.html.
   - Done when: unsupported effort returns deterministic `invalid_request` response.
5. [ ] Add/update parity tests proving `/chat/models` and `/chat` consume the same capability resolver output.
   - Files: `server/src/test/chatModels.codex*`, `server/src/test/chat*`.
   - Do: assert validator and payload both reflect same resolver fixture.
   - Docs: https://jestjs.io/docs/snapshot-testing.
   - Done when: parity test fails if either route diverges.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server -- chatModels.codex`
3. [ ] Run targeted server chat-validation tests for unsupported reasoning effort and verify deterministic error contract.
4. [ ] Run targeted parity tests for `/chat/models` and `/chat`.

#### Implementation notes

- None yet.

### 14. Frontend: Consume simplified device-auth API contract

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

After Task 10 is complete, update frontend API request/response types for the simplified device-auth contract.

#### Documentation Locations

- React fetch/error handling patterns: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- TypeScript API typing guidance: https://www.typescriptlang.org/docs/

#### Subtasks

1. [ ] Update `client/src/api/codex.ts` request type/payload to send `{}` for `POST /codex/device-auth`.
   - Files: `client/src/api/codex.ts`.
   - Do: remove target/agent parameters and always post empty object.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: request body is always `{}`.
2. [ ] Update response typing/parsing to match new backend response shape (remove target-specific fields from success type).
   - Files: `client/src/api/codex.ts`, shared type imports from `common/src`.
   - Do: parse success `{ status, rawOutput }` and error unions `{ error, ... }`.
   - Docs: TypeScript union docs.
   - Done when: no client type references response `target`/`agentName`.
3. [ ] Update frontend API-helper tests covering request/response parsing and error handling.
   - Files: `client/src/test/**` API tests.
   - Do: add assertions for `200`, `400 invalid_request`, and `503 codex_unavailable` payload handling.
   - Docs: https://jestjs.io/docs/asynchronous.
   - Done when: tests verify strict request and typed response parsing.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client -- codexDeviceAuthApi`

#### Implementation notes

- None yet.

### 15. Frontend: Remove device-auth target selector UX and wire one shared auth dialog flow

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

After Task 10 and Task 14 are complete, simplify UI usage to one shared device-auth flow with no chat/agent target selector.

#### Documentation Locations

- MUI docs (Dialog, Button, Alert, TextField): use MUI MCP (`mcp__mui__useMuiDocs`)
- React hooks/state docs: https://react.dev/reference/react

#### Subtasks

1. [ ] Reuse the existing `CodexDeviceAuthDialog` component and simplify it in place (no replacement component unless strictly necessary).
   - Files: `client/src/components/codex/CodexDeviceAuthDialog.tsx`.
   - Do: keep component identity and simplify props/state instead of creating new dialog component.
   - Docs: MUI Dialog docs via MCP, React component ref docs.
   - Done when: same component file handles the new single auth flow.
2. [ ] Remove target selector behavior from the dialog and update copy/state handling for one shared flow.
   - Files: `client/src/components/codex/CodexDeviceAuthDialog.tsx`.
   - Do: remove selector control and any target-specific text branches.
   - Docs: MUI FormControl/Alert docs via MCP.
   - Done when: dialog has one path and no target-specific UI states.
3. [ ] Update `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx` to use shared dialog behavior without selector defaults.
   - Files: `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`.
   - Do: remove page-level target defaults and pass unified dialog props only.
   - Docs: React state lifting docs https://react.dev/learn/sharing-state-between-components.
   - Done when: both pages trigger same dialog API without selector props.
4. [ ] Update frontend tests covering dialog and page integration behavior.
   - Files: `client/src/test/**` for dialog, chat page, and agents page.
   - Do: assert no selector rendered and both pages use same flow.
   - Docs: Testing Library guides https://testing-library.com/docs/.
   - Done when: tests fail if selector reappears.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client -- codexDeviceAuthDialog`
3. [ ] Run related ChatPage/AgentsPage codex-auth tests and verify pass.

#### Implementation notes

- None yet.

### 16. Frontend: Expose codex model capabilities in chat model state and enforce deterministic defaults

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

After Task 12 and Task 13 are complete, update chat model state plumbing to carry capability fields and apply deterministic default/reset behavior.

#### Documentation Locations

- React hooks/state docs: https://react.dev/reference/react
- TypeScript union/array typing guidance: https://www.typescriptlang.org/docs/

#### Subtasks

1. [ ] Update `client/src/hooks/useChatModel.ts` to retain and expose codex model capability fields per model.
   - Files: `client/src/hooks/useChatModel.ts`.
   - Do: persist `supportedReasoningEfforts` and `defaultReasoningEffort` in local model state/derived selectors.
   - Docs: https://react.dev/reference/react, https://www.typescriptlang.org/docs/.
   - Done when: hook returns capability fields for selected model.
2. [ ] Reuse existing codex-default wiring in `useChatModel` / `useChatStream` when applying capability-driven defaults and reset behavior; avoid duplicating default-selection logic.
   - Files: `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`.
   - Do: route through existing default helpers and extend them for capability payload.
   - Docs: https://react.dev/learn/reusing-logic-with-custom-hooks.
   - Done when: one default-selection path is used.
3. [ ] Implement deterministic reset behavior: when selected effort is no longer valid for selected model, reset to `defaultReasoningEffort`.
   - Files: `client/src/hooks/useChatModel.ts`.
   - Do: add validation/reset on model change and capability refresh.
   - Docs: https://react.dev/learn/choosing-the-state-structure.
   - Done when: stale effort selection self-corrects deterministically.
4. [ ] Update shared/common typings usage in client to remove hard-coded assumptions about effort lists.
   - Files: `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`, any local effort enums.
   - Do: delete static effort arrays if they mirror codex assumptions.
   - Docs: TypeScript literal types docs.
   - Done when: effort options derive from model capability payload only.
5. [ ] Add/update frontend tests for capability-driven default/reset behavior.
   - Files: `client/src/test/chatPage.codexDefaults*` and hook tests.
   - Do: cover model switch and capability change scenarios.
   - Docs: Testing Library + Jest docs.
   - Done when: tests assert reset-to-default semantics.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client -- chatPage.codexDefaults`
3. [ ] Run targeted `useChatModel` capability/default tests directly and verify pass.

#### Implementation notes

- None yet.

### 17. Frontend: Render dynamic reasoning-effort options and enforce payload validity per selected model

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

After Task 16 is complete, switch chat flags UI and chat payload building to runtime capability-driven reasoning effort values.

#### Documentation Locations

- MUI docs (Select/MenuItem/FormControl): use MUI MCP (`mcp__mui__useMuiDocs`)
- React hooks/state docs: https://react.dev/reference/react

#### Subtasks

1. [ ] Update `client/src/components/chat/CodexFlagsPanel.tsx` to render reasoning options from selected model `supportedReasoningEfforts`.
   - Files: `client/src/components/chat/CodexFlagsPanel.tsx`.
   - Do: remove hard-coded effort option list and map from selected model capabilities.
   - Docs: MUI Select/MenuItem docs via MCP.
   - Done when: options in UI exactly match payload values.
2. [ ] Update `client/src/hooks/useChatStream.ts` payload builder to send only values valid for selected model capability set.
   - Files: `client/src/hooks/useChatStream.ts`.
   - Do: pre-send validation against selected model capabilities.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html, Context7 `/openai/codex`.
   - Done when: invalid values are never sent.
3. [ ] Ensure invalid prior selection is replaced by selected model `defaultReasoningEffort` before request send.
   - Files: `client/src/hooks/useChatStream.ts`, optionally shared helper in `useChatModel`.
   - Do: enforce fallback to model default on send path.
   - Docs: https://react.dev/learn/choosing-the-state-structure.
   - Done when: request payload always carries supported value.
4. [ ] Add/update frontend tests for dynamic option rendering and invalid-selection reset/payload behavior.
   - Files: `client/src/test/chatPage.flags.reasoning*`.
   - Do: assert rendered options and outgoing payload correctness.
   - Docs: https://testing-library.com/docs/queries/about/.
   - Done when: tests fail if static lists reintroduced.

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client -- chatPage.flags.reasoning`
3. [ ] Run targeted reasoning payload tests and verify only supported values are sent.

#### Implementation notes

- None yet.

### 18. Server: Add cross-surface regression tests for precedence and normalization rules

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Add focused regression coverage for precedence/normalization behavior across REST, MCP, and flow execution surfaces.

#### Documentation Locations

- Node test runner docs: https://nodejs.org/api/test.html
- Jest docs: https://jestjs.io/docs/getting-started
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification

#### Subtasks

1. [ ] Add tests for shared-base + agent precedence (`effectiveProjects` merge and no shared behavior override of named-agent behavior).
   - Files: `server/src/test/agents/**`, `server/src/test/flows/**`, `server/src/test/mcp/**`.
   - Do: assert shared project inheritance and agent override precedence.
   - Docs: https://www.jsonrpc.org/specification, https://toml.io/en/v1.0.0.
   - Done when: all invocation paths return same precedence result.
2. [ ] Add tests for legacy-key normalization and canonical output enforcement, including canonical-wins collisions.
   - Files: `server/src/test/agents-config-defaults*` and related normalizer tests.
   - Do: fixtures with `features.view_image_tool`, `features.web_search_request`, and canonical keys together.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: output emits canonical keys only and canonical wins on collisions.
3. [ ] Add tests for fixed validation policy parity across REST/MCP/flow invocation paths.
   - Files: integration tests under `server/src/test/agents`, `server/src/test/flows`, `server/src/test/mcp`.
   - Do: run unknown key and invalid type scenarios through each surface.
   - Docs: acceptance criteria validation policy.
   - Done when: all surfaces return consistent warn/error behavior.
4. [ ] Reuse existing server test patterns (`codex.device-auth`, `chatModels.codex`, and `openapi.contract`) instead of creating one-off harnesses.
   - Files: new tests in existing suite folders, not a parallel harness directory.
   - Do: follow repository test setup helpers.
   - Docs: https://jestjs.io/docs/getting-started.
   - Done when: no duplicated harness boilerplate is introduced.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] Run new targeted precedence/normalization regression suites directly and verify pass.

#### Implementation notes

- None yet.

### 19. Server: Add compatibility and safety regression tests for migration behavior

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Add focused regression coverage for non-destructive file safety, deterministic secret-safe logging, fixture validation, and parser-removal guarantees.

#### Documentation Locations

- Node test runner docs: https://nodejs.org/api/test.html
- Jest docs: https://jestjs.io/docs/getting-started

#### Subtasks

1. [ ] Add tests proving `codex_agents/*/auth.json` files remain present through migration-compatible flows.
   - Files: `server/src/test/agents-authSeed*`, migration-related suites.
   - Do: pre/post checks for each agent auth file.
   - Docs: https://nodejs.org/api/fs.html.
   - Done when: tests fail if any auth file missing after flow.
2. [ ] Add tests verifying deterministic secret-safe logging behavior for config/device-auth errors.
   - Files: route and resolver tests that inspect logger calls.
   - Do: assert logs include sanitized key/path only, no token/blob secrets.
   - Docs: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html.
   - Done when: tests explicitly reject token/raw TOML leakage in logs.
3. [ ] Add fixture-driven tests that validate every currently present `codex_agents/*/config.toml` file against normalization/validation rules and assert deterministic outcomes across invocation paths.
   - Files: new fixture sweep test under `server/src/test/agents/**`.
   - Do: enumerate agent config files and run same validation pipeline for REST/MCP/flow.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: each existing config file is covered by test assertions.
4. [ ] Add regression tests proving no execution path still relies on model-only regex parsing after shared runtime config resolver rollout.
   - Files: `server/src/test/agents/**`, `server/src/test/flows/**`.
   - Do: include cases that old regex parser would mis-handle.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: tests guard against parser regression.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] Run targeted compatibility/safety regression suites directly and verify pass.

#### Implementation notes

- None yet.

### 20. Documentation: Update shared-home runtime architecture and API contract docs in `design.md`

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Update architecture and contract documentation after implementation tasks above are complete and verified.

#### Documentation Locations

- Mermaid docs: Context7 `/mermaid-js/mermaid`
- OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html

#### Subtasks

1. [ ] Update `design.md` with shared home strategy, config ownership, precedence/normalization, device-auth contract, and capability-driven reasoning options.
   - Files: `design.md`.
   - Do: include explicit flow diagrams/sections for chat vs agent runtime ownership and contract payloads.
   - Docs: Context7 `/mermaid-js/mermaid`, https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: a new engineer can map each runtime path to config source without reading code.
2. [ ] Ensure examples in docs reflect canonical keys and new message contracts.
   - Files: `design.md`.
   - Do: include before/after examples for `features.view_image_tool -> tools.view_image` and `{}` device-auth request.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: examples match implemented payloads and key names exactly.

#### Testing

1. [ ] Manually verify `design.md` diagrams/flows match implemented behavior.

#### Implementation notes

- None yet.

### 21. Documentation: Update file map and compatibility examples in `projectStructure.md`

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Update repository file-map and compatibility alias examples after implementation tasks above are complete and verified.

#### Documentation Locations

- OpenAPI 3.0.3 spec: https://spec.openapis.org/oas/v3.0.3.html

#### Subtasks

1. [ ] Update `projectStructure.md` for all files added/removed by this story.
   - Files: `projectStructure.md`.
   - Do: add every new/changed path from server/client/common/docs work.
   - Docs: https://git-scm.com/docs/git-ls-files.
   - Done when: listed paths align with actual repository state.
2. [ ] Document read-only compatibility keys accepted as input aliases but not emitted as canonical output, with concrete before/after examples.
   - Files: `projectStructure.md`.
   - Do: include examples for `features.view_image_tool` and web-search alias normalization.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: examples make canonical output expectations explicit.

#### Testing

1. [ ] Manually verify `projectStructure.md` entries match actual repository tree for changed files.

#### Implementation notes

- None yet.

### 22. Final isolated migration step: Minimize `./codex/config.toml` (projects-only)

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Perform final shared-base config minimization as an isolated end-of-story step only, after all prior implementation/testing/docs tasks are complete.

#### Documentation Locations

- TOML spec: https://toml.io/en/v1.0.0
- Codex config references: Context7 `/openai/codex`

#### Subtasks

1. [ ] Verify prerequisite gate: all prior tasks are marked done and validated.
   - Files: this planning file checkboxes + implementation notes.
   - Do: verify tasks 1-21 are complete before editing `./codex/config.toml`.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: all preceding task statuses and testing checkboxes are complete.
2. [ ] Confirm all `code_info`-dependent verification/inspection steps are complete before minimization and record this checkpoint in Implementation notes.
   - Files: this planning file Task 22 implementation notes.
   - Do: add explicit checkpoint note before file minimization commit.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: note exists before any minimization diff.
3. [ ] Ensure `./codex/chat/config.toml` exists and carries chat behavior defaults before minimizing base config; if missing, abort minimization with deterministic error and no file mutation.
   - Files: `codex/chat/config.toml`, migration helper in server if scripted.
   - Do: enforce guard that blocks minimization when chat config missing.
   - Docs: https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode, https://toml.io/en/v1.0.0.
   - Done when: missing-chat-config case exits safely with no mutation.
4. [ ] Minimize `./codex/config.toml` to shared defaults + `[projects]` only (remove behavior keys and MCP blocks from this file).
   - Files: `codex/config.toml`.
   - Do: retain shared projects entries only; remove `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `[features]`, `[mcp_servers]`.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: file is projects-only plus shared-home defaults.
5. [ ] Re-verify that no `codex_agents/*` files were deleted/moved/renamed and all existing `auth.json` files remain present.
   - Files: `codex_agents/*`.
   - Do: run file-presence verification and compare against pre-step list.
   - Docs: https://nodejs.org/api/fs.html.
   - Done when: all agent auth files still exist unchanged in location.
6. [ ] Add explicit operator note in Implementation notes that `code_info` MCP is expected to be unavailable after this step in this running instance.
   - Files: this planning file Task 22 implementation notes.
   - Do: add final warning note immediately after execution.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: note exists and references this expected post-step behavior.

#### Testing

1. [ ] Validate minimized `./codex/config.toml` matches projects-only target shape in this story.
2. [ ] Validate `./codex/chat/config.toml` remains present and unchanged by minimization.
3. [ ] Verify filesystem checks for `codex_agents/*/auth.json` presence pass.
4. [ ] Simulate missing chat config precondition and verify minimization step abort behavior is deterministic and non-destructive.

#### Implementation notes

- None yet.
