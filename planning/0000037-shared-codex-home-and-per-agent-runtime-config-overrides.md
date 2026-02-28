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

- `@openai/codex-sdk` runtime overrides and config behavior: Context7 `/openai/codex` (authoritative for `CodexOptions.config` semantics used by this task).
- npm semver policy: https://docs.npmjs.com/about-semantic-versioning (used to enforce stable/non-prerelease upgrade selection).
- npm dependency tree verification: https://docs.npmjs.com/cli/v10/commands/npm-ls (used to verify single resolved SDK version in workspace).

#### Subtasks

1. [ ] Upgrade `@openai/codex-sdk` in `server/package.json` to latest stable (no pre-release).
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/package.json`.
   - Do: replace `@openai/codex-sdk` version with latest stable (no `-alpha`, `-beta`, `-rc`).
   - Docs: Context7 `/openai/codex`, https://docs.npmjs.com/about-semantic-versioning.
   - Done when: `server/package.json` references a stable version only.
2. [ ] Update lockfile and ensure only one resolved SDK version is used by server workspace dependency tree.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: root `package-lock.json`.
   - Do: run workspace install/update and confirm a single resolved `@openai/codex-sdk` entry for server path.
   - Docs: https://docs.npmjs.com/cli/v10/commands/npm-ls.
   - Done when: `npm ls @openai/codex-sdk --workspace server` shows one version.
3. [ ] Record exact upgraded SDK version in this story file Implementation notes for traceability.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Document name: `0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Document location: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Description: update this story planning document with the exact implementation detail required by the subtask.
   - Purpose: preserve an auditable, junior-readable implementation record tied to the story.
   - Do: add a dated note under Task 1 implementation notes with exact version string.
   - Docs: https://keepachangelog.com/en/1.0.0/.
   - Done when: Task 1 notes explicitly state the final upgraded version.

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm ls @openai/codex-sdk --workspace server`

#### Implementation notes

- None yet.

### 2. Server: Remove local reasoning-effort widening shims and align shared/client/server typing

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Remove compatibility-only widened reasoning-effort unions/casts and align code to SDK-native/runtime capability values.

#### Documentation Locations

- `@openai/codex-sdk` types and runtime capability surfaces: Context7 `/openai/codex` (source of truth for reasoning-effort typing after upgrade).
- TypeScript type-system references: https://www.typescriptlang.org/docs/ (used for union removal and discriminated typing updates).
- React Hook behavior (`useMemo`/state derivation): https://react.dev/reference/react/useMemo (used where capability arrays are memoized in UI).
- Jest assertions and matcher behavior: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started (used for deterministic supported/unsupported value tests).

#### Subtasks

1. [ ] Remove local widened reasoning-effort type shims/casts in server runtime code and tests (for example `ModelReasoningEffort | 'xhigh'` compatibility-only types).
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/chat/interfaces/ChatInterfaceCodex.ts`, `server/src/routes/chatValidators.ts`, `server/src/routes/chat.ts`, plus matching `server/src/test/unit/chat-codex-reasoning-delta.test.ts` and chat-validation tests.
   - Do: replace widened unions/casts with SDK-native types.
   - Docs: Context7 `/openai/codex`, https://www.typescriptlang.org/docs/handbook/2/everyday-types.html.
   - Done when: no server type includes manual `| 'xhigh'` compatibility additions.
2. [ ] Remove any client/shared compatibility typings that were only present to widen values already supported by upgraded SDK.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `common/src/lmstudio.ts`, `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`, `client/src/components/chat/CodexFlagsPanel.tsx`, related client test files.
   - Do: delete widened local aliases and rely on shared/server capability payload types.
   - Docs: https://www.typescriptlang.org/docs/handbook/2/types-from-types.html.
   - Done when: shared/client type surfaces do not carry compatibility-only widening.
3. [ ] Update shared/client/server reasoning-effort type usage to SDK-native/runtime capability values (including `none`/`minimal` when surfaced) and remove manual cast-based compatibility types in chat validators/flag payload builders.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/chat.ts` (or validators file), `server/src/routes/chatModels.ts`, `client/src/components/chat/CodexFlagsPanel.tsx`, `common/src/lmstudio.ts`.
   - Do: use capability-driven value lists and remove cast-based forcing.
   - Docs: Context7 `/openai/codex`, https://react.dev/reference/react/useMemo.
   - Done when: validation and UI both consume typed capability values without manual casts.
4. [ ] Add server unit test for accepted SDK-native reasoning efforts.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/unit/chat-codex-reasoning-delta.test.ts`, `server/src/test/unit/chatModels.codex.test.ts`.
   - Description: assert every supported `ModelReasoningEffort` value accepted by updated server typing/validation paths.
   - Purpose: prevent regressions where supported SDK values are incorrectly rejected.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started.
   - Done when: test fails if a supported value is rejected.
5. [ ] Add server unit test for unsupported reasoning-effort rejection.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/unit/chat-codex-reasoning-delta.test.ts`, route validator unit tests under `server/src/test/unit`.
   - Description: assert unsupported effort values are rejected with deterministic error output.
   - Purpose: ensure strict invalid-value handling after shim removal.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if an unsupported value is silently accepted.
6. [ ] Add client unit test for capability-driven effort typing usage.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/chatPage.reasoning.test.tsx`, `client/src/test/chatPage.models.test.tsx`.
   - Description: assert client state and payload paths accept SDK-native capability values without compatibility casts.
   - Purpose: ensure UI logic remains aligned to SDK-native effort semantics.
   - Docs: https://testing-library.com/docs/, Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started.
   - Done when: test fails if manual compatibility casts are required again.

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run build --workspace common`
6. [ ] Run targeted server and client reasoning-effort tests and verify pass.
7. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
8. [ ] `npm run compose:build`
9. [ ] `npm run compose:up`
10. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` to validate reasoning-effort UI behavior and confirm no debug-console errors.
11. [ ] `npm run compose:down`

#### Implementation notes

- None yet.

### 3. Server: Implement canonical runtime config loading, bootstrap, and normalization layer

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Create one server-side config resolution layer that reads shared base config, chat config, and agent config, and normalizes legacy keys to canonical keys.

#### Documentation Locations

- TOML v1.0.0 spec: https://toml.io/en/v1.0.0 (used to parse and normalize canonical vs legacy key layout correctly).
- TOML parser package docs (`toml`): https://www.npmjs.com/package/toml (used for concrete parser API/error behavior and version pinning).
- `@openai/codex-sdk` config layering expectations: Context7 `/openai/codex` (used to map normalized keys into runtime config overrides).
- Node.js filesystem/path APIs: https://nodejs.org/api/fs.html and https://nodejs.org/api/path.html (used for loader reads, path resolution, and chat-config bootstrap copy behavior).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for this task's resolver and normalization test updates).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required architecture-flow diagram updates in `design.md` for this task).

#### Subtasks

1. [ ] Add/extend config loader module(s) to read `./codex/config.toml`, `./codex/chat/config.toml`, and `codex_agents/<agent>/config.toml`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/config/codexConfig.ts`, `server/src/agents/config.ts` (or shared resolver file), plus new helper module if needed under `server/src/config`.
   - Do: centralize file reads in one resolver API used by all callers.
   - Docs: https://toml.io/en/v1.0.0, https://nodejs.org/api/fs.html.
   - Done when: one resolver can return base/chat/agent parsed config objects.
2. [ ] Add explicit TOML parser dependency and parse helper before resolver rollout.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/package.json`, `server/src/agents/config.ts` (or shared parser helper under `server/src/config`).
   - Do: add a stable TOML parser dependency (`toml`) and parse via one helper that returns deterministic parse errors (remove regex-only parsing assumptions).
   - Docs: https://www.npmjs.com/package/toml, https://toml.io/en/v1.0.0.
   - Done when: resolver and services no longer depend on line/regex parsing for runtime config keys.
3. [ ] Reuse existing codex/agent path resolution helpers (`getCodexHome`, `getCodexConfigPathForHome`, `discoverAgents` agent `home/configPath`) instead of introducing new path-discovery logic.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/config/codexConfig.ts`, `server/src/agents/discovery.ts` (or existing helper locations).
   - Do: import and reuse existing helpers; remove duplicate path derivation code.
   - Docs: https://nodejs.org/api/path.html, https://nodejs.org/api/fs.html, Context7 `/openai/codex`.
   - Done when: no duplicate path-walk logic exists for these config locations.
4. [ ] Add chat runtime config bootstrap behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: resolver/loader module from Subtask 1.
   - Do: if `./codex/chat/config.toml` missing and `./codex/config.toml` exists, copy once; never overwrite existing chat config.
   - Docs: https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode.
   - Done when: first run creates chat config once and subsequent runs preserve it.
5. [ ] Implement canonical normalization rules at read time.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: normalization helper in `server/src/agents/config.ts` or dedicated normalizer module.
   - Do: map `features.view_image_tool -> tools.view_image`; accept `features.web_search_request` as input alias only; normalize legacy web-search keys to top-level `web_search`; canonical key wins on conflict.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: normalized output always emits canonical keys only.
6. [ ] Add normalization unit test for legacy `features.view_image_tool` alias mapping.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config normalization suites.
   - Description: assert legacy `features.view_image_tool` input normalizes to canonical `tools.view_image`.
   - Purpose: preserve deterministic legacy-key compatibility behavior.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if canonical output is not produced.
7. [ ] Add normalization unit test for legacy web-search alias mapping.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config normalization suites.
   - Description: assert supported legacy web-search aliases normalize to top-level canonical `web_search`.
   - Purpose: prevent mixed legacy/canonical key behavior.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if canonical `web_search` is missing.
8. [ ] Add normalization collision unit test for canonical-wins precedence.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config normalization suites.
   - Description: assert canonical key value wins when canonical and legacy aliases are both present.
   - Purpose: enforce deterministic precedence for conflicting inputs.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if alias value overrides canonical value.
9. [ ] Add bootstrap unit test for copy-once chat-config creation.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config bootstrap suites.
   - Description: assert missing `./codex/chat/config.toml` is created exactly once from base config when base exists.
   - Purpose: verify migration-safe bootstrap happy path.
   - Docs: https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode.
   - Done when: test fails if initial copy does not occur.
10. [ ] Add bootstrap unit test for no-overwrite behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config bootstrap suites.
   - Description: assert existing `./codex/chat/config.toml` is never overwritten during bootstrap.
   - Purpose: protect previously migrated/customized chat runtime config.
   - Docs: https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode.
   - Done when: test fails if existing chat config contents are mutated.
11. [ ] Add bootstrap unit test for missing-base no-copy behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config bootstrap suites.
   - Description: assert bootstrap does not create/mutate chat config when base config source is missing.
   - Purpose: guarantee non-destructive behavior in partial/missing source state.
   - Docs: https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode.
   - Done when: test fails if files are created/changed without base input.
12. [ ] Update `projectStructure.md` for any files added or removed in this task, after all file-add/remove subtasks are completed.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `projectStructure.md`.
   - Document name: `projectStructure.md`.
   - Document location: repository root `projectStructure.md`.
   - Description: update file-map and compatibility documentation content required by this subtask.
   - Purpose: keep repository-structure documentation synchronized with delivered code changes.
   - Do: list every file added and removed by this task (including resolver/normalizer modules, test files, and any deleted/renamed paths), not just representative examples.
   - Docs: https://git-scm.com/docs/git-ls-files.
   - Done when: `projectStructure.md` contains a complete added/removed file list for this task with no omissions.
13. [ ] Update `design.md` with the runtime config loader/bootstrap/normalization architecture and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: add/update narrative and Mermaid flowchart/sequence diagrams covering shared base/chat/agent config loading, copy-once chat bootstrap, and canonical normalization behavior.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` diagrams and descriptions match final implementation in this task.

14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run test --workspace server -- agents-config-defaults`
4. [ ] Run new config-loader/normalization unit tests directly and verify pass.
5. [ ] Run targeted bootstrap copy/no-overwrite tests and verify deterministic outcomes.

#### Implementation notes

- None yet.

### 4. Server: Implement runtime config merge precedence, validation policy, and deterministic failure behavior

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Implement deterministic merge and validation behavior for runtime config resolution, including strict agent/chat failure handling and no behavior fallback leakage.

#### Documentation Locations

- TOML v1.0.0 spec: https://toml.io/en/v1.0.0 (used to validate key/value typing and parse-failure semantics).
- `@openai/codex-sdk` config vocabulary: Context7 `/openai/codex` (used to distinguish supported keys from unknown keys).
- Node.js error model: https://nodejs.org/api/errors.html (used to map missing/unreadable/invalid file failures deterministically).
- Jest test patterns: Context7 `/jestjs/jest`, https://jestjs.io/docs/mock-functions (used for validator warning/error path assertions).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required precedence/validation flow diagram updates in `design.md` for this task).

#### Subtasks

1. [ ] Implement deterministic merge behavior with `effectiveProjects = { ...baseProjects, ...agentProjects }`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: shared resolver module introduced in Task 3, likely `server/src/agents/config.ts` and `server/src/config/codexConfig.ts`.
   - Do: merge only `[projects]` from base into agent; agent entries override same path keys.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: merge output preserves agent behavior keys and only inherits base projects.
2. [ ] Implement fixed validation policy in one shared validator (unknown key warn+ignore, invalid type hard error).
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: shared validator in `server/src/agents/config.ts` or new `server/src/agents/configValidation.ts`.
   - Do: centralize rules and return structured diagnostics.
   - Docs: Context7 `/openai/codex` for valid config keys.
   - Done when: all run paths call the same validator function.
3. [ ] Implement deterministic config read/parse failure behavior for agent/chat.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: resolver and route/service error mapping (`server/src/agents/service.ts`, `server/src/chat/interfaces/ChatInterfaceCodex.ts`).
   - Do: hard-fail agent on missing/unreadable/invalid config; deterministic chat error with no fallback to base behavior keys.
   - Docs: Node fs errors https://nodejs.org/api/errors.html.
   - Done when: failures return stable error codes/messages across retries.
4. [ ] Ensure no fallback path allows shared behavior keys to override named-agent behavior keys.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: all resolver consumers in `server/src/agents/service.ts`, `server/src/flows/service.ts`, `server/src/mcpAgents/**`, `server/src/mcp2/**`, `server/src/mcpCommon/**`.
   - Do: remove any fallback assignment from base behavior fields.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: code audit and tests show no shared behavior override in agent runs.
5. [ ] Add merge-precedence unit test for `effectiveProjects` override behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config resolver suites.
   - Description: assert `{ ...baseProjects, ...agentProjects }` behavior where agent project values override base entries.
   - Purpose: lock deterministic merge precedence required by the story.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if base projects override agent project entries.
6. [ ] Add validator unit test for unknown-key warning-and-ignore behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config validator suites.
   - Description: assert unknown keys emit warnings and are ignored without run failure.
   - Purpose: enforce fixed unknown-key handling policy across paths.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/mock-functions.
   - Done when: test fails if unknown keys start failing runs.
7. [ ] Add validator unit test for invalid-type hard-fail behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` config validator suites.
   - Description: assert supported keys with invalid value types fail deterministically.
   - Purpose: enforce strict type validation policy.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if invalid types are accepted or downgraded.
8. [ ] Add agent-config failure unit test for missing file.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` resolver/service failure suites.
   - Description: assert missing `codex_agents/<agent>/config.toml` hard-fails agent run deterministically.
   - Purpose: prevent fallback leakage when agent config is absent.
   - Docs: https://nodejs.org/api/fs.html#file-system-flags.
   - Done when: test fails if run silently falls back.
9. [ ] Add agent-config failure unit test for invalid TOML.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` resolver/service failure suites.
   - Description: assert invalid agent TOML parse errors hard-fail run with deterministic error payload/logging.
   - Purpose: guarantee deterministic agent failure semantics.
   - Docs: https://toml.io/en/v1.0.0.
   - Done when: test fails if invalid TOML falls back or produces nondeterministic errors.
10. [ ] Add agent-config failure unit test for unreadable file permissions.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` resolver/service failure suites.
   - Description: assert unreadable agent config file hard-fails run deterministically.
   - Purpose: prevent ambiguous behavior on filesystem permission errors.
   - Docs: https://nodejs.org/api/fs.html#file-system-flags.
   - Done when: test fails if unreadable files are treated as soft warnings.
11. [ ] Add chat-config failure unit test for missing file.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` chat resolver/service failure suites.
   - Description: assert missing `./codex/chat/config.toml` produces deterministic chat error without fallback to base behavior keys.
   - Purpose: enforce no-fallback rule for chat runtime behavior.
   - Docs: https://nodejs.org/api/errors.html.
   - Done when: test fails if missing chat config falls back to base behavior.
12. [ ] Add chat-config failure unit test for invalid TOML.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` chat resolver/service failure suites.
   - Description: assert invalid chat TOML returns deterministic error and no behavior fallback.
   - Purpose: guarantee deterministic chat parse-error semantics.
   - Docs: https://toml.io/en/v1.0.0.
   - Done when: test fails if invalid chat TOML is tolerated.
13. [ ] Add chat-config failure unit test for unreadable file permissions.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` chat resolver/service failure suites.
   - Description: assert unreadable chat config returns deterministic error and no fallback.
   - Purpose: prevent hidden behavior changes on permission failures.
   - Docs: https://nodejs.org/api/fs.html#file-system-flags.
   - Done when: test fails if unreadable chat config still allows chat execution.
14. [ ] Add happy-path unit test for valid canonical agent/chat config resolution.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` resolver happy-path suites.
   - Description: assert valid canonical configs resolve successfully with expected merged output.
   - Purpose: ensure success-path behavior remains correct while tightening error handling.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if valid canonical config no longer resolves.
15. [ ] Add happy-path unit test for valid legacy-alias input normalization.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/**` resolver happy-path suites.
   - Description: assert valid legacy alias inputs normalize successfully and still execute.
   - Purpose: keep backward-compatible success path while enforcing canonical output.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if valid legacy input can no longer run.
16. [ ] Update `projectStructure.md` for any files added or removed in this task, after all file-add/remove subtasks are completed.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `projectStructure.md`.
   - Document name: `projectStructure.md`.
   - Document location: repository root `projectStructure.md`.
   - Description: update file-map and compatibility documentation content required by this subtask.
   - Purpose: keep repository-structure documentation synchronized with delivered code changes.
   - Do: list every file added and removed by this task (validator/resolver modules, tests, and any deleted/renamed paths) after implementation subtasks are complete.
   - Docs: https://git-scm.com/docs/git-ls-files.
   - Done when: `projectStructure.md` accurately and completely lists all added/removed files for this task.
17. [ ] Update `design.md` with precedence/validation architecture details and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: add/update diagrams and notes for `effectiveProjects` precedence, unknown-key warn-and-ignore path, invalid-type hard-fail path, and deterministic failure handling.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` includes accurate precedence and validation diagrams matching this task's final behavior.

18. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run test --workspace server -- agents-config-defaults`
4. [ ] Run targeted config read/parse failure tests directly and verify deterministic error payloads/logs.
5. [ ] Run targeted valid-config happy-path resolver tests and verify pass.

#### Implementation notes

- None yet.

### 5. Server: Replace model-only parsing with shared runtime config resolver across execution entrypoints

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Replace existing model-only config parsing (`readAgentModelId`) so all execution paths consume the same TOML-based runtime config resolver.

#### Documentation Locations

- Node.js filesystem/path APIs: https://nodejs.org/api/fs.html and https://nodejs.org/api/path.html (used while replacing line-based parsing with structured TOML resolution).
- TOML v1.0.0 spec: https://toml.io/en/v1.0.0 (used to parse complete runtime config instead of regex model extraction).
- `@openai/codex-sdk` runtime config behavior: Context7 `/openai/codex` (used to ensure resolver output matches runtime option expectations).
- ripgrep usage guide: https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md (used to verify old parser call-site removal efficiently).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for parser-removal regression tests in this task).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required parser-to-resolver flow updates in `design.md` for this task).

#### Subtasks

1. [ ] Replace existing line-based model-only config parsing (`readAgentModelId`) with the shared TOML-based runtime config resolver in all run surfaces.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/agents/config.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`.
   - Do: remove regex/line parser usage for runtime behavior decisions.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: `readAgentModelId` is deleted or unused for runtime decisions.
2. [ ] Update agent service and flow service execution entrypoints to consume resolver output instead of regex/line parsing.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/agents/service.ts`, `server/src/flows/service.ts`.
   - Do: inject resolver output into run option builders.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: agent and flow runs pull model/policy/tools from same resolver object.
3. [ ] Ensure no codepath still depends on `readAgentModelId` for runtime behavior decisions.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: whole server workspace; verify with search.
   - Do: remove old function or keep only for unrelated legacy read with explicit comment.
   - Docs: https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md.
   - Done when: `rg "readAgentModelId" server/src` shows no runtime-path callers.
4. [ ] Add agent execution regression test proving resolver replaces regex parsing.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Regression.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`.
   - Description: use a TOML fixture that old line/regex parsing would mis-handle but resolver handles correctly.
   - Purpose: prevent reintroduction of model-only parser in agent run path.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if agent path returns to regex parsing behavior.
5. [ ] Add flow execution regression test proving resolver replaces regex parsing.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Regression.
   - Test location: `server/src/test/unit/flows*.test.ts`, `server/src/test/integration/flows.*.test.ts`.
   - Description: assert flow-run config resolution uses full TOML resolver behavior, not legacy model-only parsing.
   - Purpose: guarantee flow path remains aligned with resolver migration.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if flow path reverts to model-only parsing.
6. [ ] Update `design.md` with parser-removal architecture changes and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: document and diagram the shared resolver path replacing `readAgentModelId` in agent and flow execution entrypoints.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` clearly shows no model-only parsing path remains for runtime behavior decisions.

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run test --workspace server -- agents-config-defaults`
4. [ ] Run targeted regression tests proving resolver usage across agents + flows.

#### Implementation notes

- None yet.

### 6. Server: Wire runtime config overrides into chat, agent run, and agent command execution paths

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Apply runtime config overrides to chat and primary REST agent execution surfaces while preserving `useConfigDefaults: true`.

#### Documentation Locations

- `@openai/codex-sdk` runtime options and defaults: Context7 `/openai/codex` (used for `CodexOptions.config` and `useConfigDefaults: true` handling).
- Express routing reference: https://expressjs.com/en/guide/routing.html (used for `/agents/:agentName/run` and `/agents/:agentName/commands/run` wiring).
- TypeScript language docs: https://www.typescriptlang.org/docs/ (used to preserve call-signature compatibility while extending option plumbing).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for chat/run/commands integration test updates in this task).
- Cucumber guides: https://cucumber.io/docs/guides/ (required because task-level verification runs `npm run test --workspace server`, which executes cucumber integration tests).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required chat/run/commands flow diagram updates in `design.md` for this task).

#### Subtasks

1. [ ] Update chat Codex execution path to pass chat runtime config via `CodexOptions.config` and shared `CODEX_HOME`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/chat/interfaces/ChatInterfaceCodex.ts`, supporting option-builder files.
   - Do: resolve `./codex/chat/config.toml` and pass normalized config in runtime options.
   - Docs: Context7 `/openai/codex` (`CodexOptions.config`).
   - Done when: chat run config source is chat config file only.
2. [ ] Update agent execution path (`/agents/:agentName/run`) to pass agent runtime config via `CodexOptions.config` while forcing shared `CODEX_HOME`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/agents/service.ts`, related route/controller file.
   - Do: call shared resolver and inject agent-specific config object; stop passing `agent.home` as per-agent `codexHome` and use shared home helpers only.
   - Docs: Context7 `/openai/codex`, https://expressjs.com/en/guide/routing.html.
   - Done when: REST agent run never pulls behavior from shared base except projects merge and no per-agent `codexHome` override remains.
3. [ ] Update agent command execution path (`/agents/:agentName/commands/run`) to use the same agent runtime config resolution and shared `CODEX_HOME`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: command route/service handler under `server/src/agents`.
   - Do: reuse exact resolver invocation from Subtask 2 and remove any command-path per-agent home override.
   - Docs: Express route docs https://expressjs.com/en/guide/routing.html.
   - Done when: command path and run path use shared helper and both use the same shared home path.
4. [ ] Extend shared chat interface/runtime option plumbing (`ChatInterfaceCodex` + option builders) to accept runtime `CodexOptions.config` payloads without breaking existing call signatures.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/chat/interfaces/ChatInterfaceCodex.ts`, `server/src/chat/**` option builder modules.
   - Do: thread optional config parameter through wrappers with backward-compatible defaults.
   - Docs: Context7 `/openai/codex`.
   - Done when: TypeScript compile confirms no caller breakage.
5. [ ] Ensure updated execution paths retain `useConfigDefaults: true` and do not reintroduce duplicated model/policy thread flag wiring or per-agent home overrides.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: all touched run option builders.
   - Do: keep `useConfigDefaults: true` literal in all run starts and verify `codexHome` values resolve to shared `getCodexHome()` semantics only.
   - Docs: Context7 `/openai/codex` thread start options.
   - Done when: no path sets duplicate thread model/policy flags when config defaults are active and no path passes `agent.home` as `codexHome`.
6. [ ] Add chat integration test for chat-config source enforcement.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chat-interface-codex.test.ts`, `server/src/test/integration/chat-codex.test.ts`.
   - Description: assert chat execution reads `./codex/chat/config.toml` behavior values and not agent/base behavior keys.
   - Purpose: lock chat runtime ownership boundary.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started.
   - Done when: test fails if chat path reads base/agent behavior config.
7. [ ] Add REST agent-run integration test for agent-config source enforcement.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/agents-run-*.test.ts`, `server/src/test/unit/agents-router-run.test.ts`.
   - Description: assert `/agents/:agentName/run` uses named-agent config behavior with only projects merged from base and still executes with shared `CODEX_HOME`.
   - Purpose: lock agent behavior ownership for run endpoint.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started.
   - Done when: test fails if run endpoint reads shared behavior keys or switches to per-agent home.
8. [ ] Add REST agent-command integration test for agent-config source enforcement.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-commands-router-run.test.ts`, `server/src/test/integration/agents-run-*.test.ts`.
   - Description: assert `/agents/:agentName/commands/run` uses same resolver and behavior source as `/run`, with shared `CODEX_HOME`.
   - Purpose: prevent run/command behavior drift.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started.
   - Done when: test fails if commands path diverges from run path or uses per-agent home.
9. [ ] Update `design.md` with chat/run/commands runtime flow changes and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: document and diagram how chat uses `./codex/chat/config.toml`, how run/commands use agent config plus projects merge, and where `useConfigDefaults: true` is applied.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` has accurate flow diagrams for chat, run, and command execution.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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

- `@openai/codex-sdk` runtime options: Context7 `/openai/codex` (used so flow/MCP execution uses the same option contract as REST).
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (used for MCP parity expectations and deterministic request/response behavior).
- Jest matcher docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/using-matchers (used for cross-surface parity assertions).
- Cucumber guides: https://cucumber.io/docs/guides/ (required because task-level verification runs `npm run test --workspace server`, which executes cucumber integration tests).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required flow/MCP architecture diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Update flow-driven agent execution path to use the same agent runtime config resolution and precedence as REST.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/flows/service.ts` and flow step execution helpers.
   - Do: call the shared resolver used in Task 6 Subtask 2 and remove flow-specific `params.agentHome` override when starting Codex runs.
   - Docs: Context7 `/openai/codex`, https://www.jsonrpc.org/specification.
   - Done when: flow step run options match REST agent run options for same agent, including shared-home semantics.
2. [ ] Update MCP agent execution surfaces to resolve the same runtime config behavior as REST and flow surfaces.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/mcpAgents/router.ts`, `server/src/mcpAgents/tools.ts`, `server/src/mcp2/router.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/mcp2/tools/reingestRepository.ts`, `server/src/mcpCommon/dispatch.ts`.
   - Do: replace any direct model-only config read with shared resolver and ensure MCP-triggered runs use the same shared home path as REST/flow.
   - Docs: https://www.jsonrpc.org/specification.
   - Done when: MCP path has same config source, shared-home behavior, and validation path.
3. [ ] Ensure all updated paths retain `useConfigDefaults: true` and do not duplicate model/policy flag logic or reintroduce per-agent home wiring.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: flow and MCP run option builders.
   - Do: verify options include `useConfigDefaults: true`, no duplicate model/policy flags, and no `codexHome: agent.home` / `codexHome: params.agentHome` assignments.
   - Docs: Context7 `/openai/codex`.
   - Done when: static search confirms `useConfigDefaults` set consistently and no per-agent home assignment remains in flow/MCP execution.
4. [ ] Add integration test for REST `/agents/:agentName/run` baseline effective config output.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`.
   - Description: capture baseline effective runtime config produced by REST run surface.
   - Purpose: establish reference behavior for cross-surface parity checks.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/using-matchers.
   - Done when: baseline assertions are deterministic for fixture input.
5. [ ] Add integration test for `/agents/:agentName/commands/run` parity with REST run baseline.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`.
   - Description: assert commands-run effective config matches REST run baseline for same agent fixture.
   - Purpose: prevent behavior drift between REST run surfaces.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/using-matchers.
   - Done when: commands-run assertions fail on any baseline divergence.
6. [ ] Add integration test for flow-step parity with REST run baseline.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/flows*.test.ts`, `server/src/test/integration/flows.*.test.ts`.
   - Description: assert flow-driven execution effective config matches REST run baseline for same agent fixture.
   - Purpose: guarantee flow execution parity.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/using-matchers.
   - Done when: flow assertions fail on parity mismatch.
7. [ ] Add integration test for MCP execution parity with REST run baseline.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/mcp*`, `server/src/test/unit/mcp*`, `server/src/test/mcp2/**`.
   - Description: assert MCP execution effective config matches REST run baseline for same agent fixture.
   - Purpose: guarantee MCP execution parity with REST/flow paths.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/using-matchers.
   - Done when: MCP assertions fail on parity mismatch.
8. [ ] Update `design.md` with flow/MCP execution architecture and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: document and diagram flow-step and MCP execution paths consuming the shared runtime config resolver with parity to REST run.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` shows consistent run/flow/MCP behavior and config source ownership.

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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

- Node.js process/filesystem docs: https://nodejs.org/api/child_process.html and https://nodejs.org/api/fs.html (used for detection/startup availability checks).
- `@openai/codex-sdk` home/runtime behavior: Context7 `/openai/codex` (used to align shared-home availability semantics).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for shared-home availability test updates in this task).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required shared-home detection flow diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Update detection/startup logic to treat shared `./codex` as chat availability source of truth.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/providers/codexDetection.ts`, `server/src/config/codexConfig.ts`.
   - Do: for chat availability, check shared-home auth/config only.
   - Docs: Context7 `/openai/codex`, https://nodejs.org/api/fs.html.
   - Done when: chat availability remains true when shared auth is valid even if agent-local auth differs.
2. [ ] Reuse existing detection/auth helpers (`detectCodexForHome`, `refreshCodexDetection`, `ensureAgentAuthSeeded`, `propagateAgentAuthFromPrimary`) and avoid parallel duplicate implementations.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/providers/codexDetection.ts`, `server/src/agents/auth*` helper files.
   - Do: compose existing helpers, do not add second implementation path.
   - Docs: https://nodejs.org/api/fs.html, https://nodejs.org/api/child_process.html.
   - Done when: detection/auth behavior routes through existing helper functions.
3. [ ] Add availability test for shared-home auth present at startup.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/codexConfig.test.ts`, `server/src/test/unit/codexConfig.device-auth.test.ts`.
   - Description: assert chat availability is `available` when shared `./codex` auth/config prerequisites are present.
   - Purpose: prevent shared-home false negatives on startup.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if valid shared-home state reports unavailable.
4. [ ] Add availability test for shared-home auth missing at startup.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/codexConfig.test.ts`, `server/src/test/unit/codexConfig.device-auth.test.ts`.
   - Description: assert chat availability is `unavailable` when shared-home prerequisites are absent.
   - Purpose: validate deterministic negative-path availability behavior.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if missing prerequisites still report available.
5. [ ] Add detection refresh test for availability state transition.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/codexConfig.device-auth.test.ts`, `server/src/test/integration/codexAuthCopy.integration.test.ts`.
   - Description: assert `refreshCodexDetection` updates status deterministically after auth state changes.
   - Purpose: guarantee refresh path correctness after login/propagation changes.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/timer-mocks.
   - Done when: test fails if refresh leaves stale availability state.
6. [ ] Update `design.md` with shared-home detection architecture and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: add/update diagrams and narrative for startup detection, refresh path, and shared-home availability decision points.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` captures the final shared-home detection flow implemented by this task.

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run test --workspace server -- codex`

#### Implementation notes

- None yet.

### 9. Server: Non-destructive auth compatibility and agent-file safety guards

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Retain existing auth seeding/propagation compatibility behavior without deleting, moving, or renaming anything under `codex_agents/*`.

#### Documentation Locations

- Node.js filesystem docs: https://nodejs.org/api/fs.html (used to guarantee non-destructive auth propagation behavior).
- `@openai/codex-sdk` shared-home behavior: Context7 `/openai/codex` (used to retain compatibility-mode auth handling while moving to shared home).
- Jest assertion docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect (used for idempotency and file-presence verification tests).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required auth-propagation flow diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Keep compatibility auth seeding/propagation behavior non-destructive for `codex_agents/*/auth.json`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/agents/auth*`, `server/src/providers/codexDetection.ts`.
   - Do: preserve copy/seed behavior without deletions or renames.
   - Docs: https://nodejs.org/api/fs.html, Context7 `/openai/codex`.
   - Done when: runtime still seeds/propagates as before and no destructive ops exist.
2. [ ] Add file-safety guard test for delete operations under `codex_agents/*`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/unit/agents-authSeed.test.ts`, `server/src/test/integration/codexAuthCopy.integration.test.ts`.
   - Description: assert no `unlink`/`rm` destructive file deletion is executed against agent directories.
   - Purpose: enforce non-destructive migration guarantee.
   - Docs: https://nodejs.org/api/fs.html.
   - Done when: test fails on any delete attempt in `codex_agents/*`.
3. [ ] Add file-safety guard test for rename/move operations under `codex_agents/*`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/unit/agents-authSeed.test.ts`, `server/src/test/integration/codexAuthCopy.integration.test.ts`.
   - Description: assert no `rename`-based move operations target agent directory files.
   - Purpose: preserve agent auth/config file locations.
   - Docs: https://nodejs.org/api/fs.html#fsrenameoldpath-newpath-callback.
   - Done when: test fails on any rename/move attempt in `codex_agents/*`.
4. [ ] Add auth propagation idempotency test.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-authSeed.test.ts`, `server/src/test/integration/codexAuthCopy.integration.test.ts`.
   - Description: run propagation twice and assert second run produces no state drift.
   - Purpose: guarantee deterministic repeatability.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if repeated propagation changes result.
5. [ ] Add post-run agent auth file-presence test.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-authSeed.test.ts`, `server/src/test/integration/codexAuthCopy.integration.test.ts`.
   - Description: assert all expected `codex_agents/*/auth.json` files remain present after propagation/run flow.
   - Purpose: protect runtime continuity for existing agent auth artifacts.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if any expected auth file is missing.
6. [ ] Update `design.md` with auth-compatibility propagation flow and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: add/update diagrams showing non-destructive auth seeding/propagation behavior and agent-file safety constraints.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` documents final auth compatibility flow and explicit non-destructive guarantees from this task.

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run test --workspace server -- agents-authSeed`
4. [ ] Run file-safety guard tests directly and verify pass.

#### Implementation notes

- None yet.

### 10. Server Message Contract: Simplify `POST /codex/device-auth` to single request shape

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Implement the server-side device-auth message contract change first: request body must be `{}` only, with deterministic `200/400/503` responses and legacy selector-field rejection.

#### Documentation Locations

- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (used to define strict `{}` request and `200/400/503` response schemas).
- Express JSON body parsing docs: https://expressjs.com/en/resources/middleware/body-parser.html (used for strict request-shape enforcement).
- RFC 7807 problem details: https://datatracker.ietf.org/doc/html/rfc7807 (used for deterministic structured error payload design).
- TypeScript docs: https://www.typescriptlang.org/docs/ (used for shared discriminated API response typing).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for device-auth contract test updates in this task).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required device-auth contract flow diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Update `server/src/routes/codexDeviceAuth.ts` request parsing to accept only empty JSON object and reject selector fields (`target`, `agentName`) with `400 invalid_request`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/codexDeviceAuth.ts`.
   - Do: add strict request body validation at route start.
   - Docs: https://expressjs.com/en/resources/middleware/body-parser.html.
   - Done when: `{ "target": "chat" }` and `{ "agentName": "x" }` return `400 invalid_request`.
2. [ ] Reject any non-empty request body (not only selector fields) with deterministic `400 invalid_request` so the `{}` contract is strict.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/codexDeviceAuth.ts`.
   - Do: enforce `Object.keys(body).length === 0` contract and normalize oversize parser errors (`entity.too.large`) to the same `400 { error: "invalid_request", message }` shape.
   - Docs: OpenAPI object schema rules https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: `{ "foo": "bar" }` and oversized bodies both return `400 invalid_request` with deterministic `message`.
3. [ ] Update shared/common API types for device-auth request/response to the single-shape contract.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `common/src/**` API contract types, `client/src/api/codex.ts` types if shared import not used.
   - Do: define request `{}` and response union for `200/400/503`.
   - Docs: TypeScript discriminated unions https://www.typescriptlang.org/docs/.
   - Done when: client and server compile against same type contract.
4. [ ] Update success and error response payloads to the defined contract.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/codexDeviceAuth.ts`.
   - Do: return exactly:
     - `200 { status: "ok", rawOutput }`
     - `400 { error: "invalid_request", message }`
     - `503 { error: "codex_unavailable", reason }`
   - Docs: RFC 7807 guidance https://datatracker.ietf.org/doc/html/rfc7807.
   - Done when: integration tests assert exact JSON shapes.
5. [ ] Remove legacy dual-shape parsing/response behavior from backend route.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/codexDeviceAuth.ts` and any helper parsing modules.
   - Do: remove target-branch logic and dead types.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: no route code references `target` or `agentName` request semantics.
6. [ ] Update `openapi.json` for `/codex/device-auth` request and response schemas.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `openapi.json`.
   - Do: reflect strict `{}` request and `200/400/503` response bodies.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: schema validation and route tests align.
7. [ ] Update the OpenAPI contract unit test to assert the new `/codex/device-auth` schemas.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/test/unit/openapi.contract.test.ts`.
   - Do: add/adjust assertions for strict `{}` request body and exact `200/400/503` response schema shapes.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html, Context7 `/jestjs/jest`.
   - Done when: contract test fails if schema reintroduces selector fields or misses required error shapes.
8. [ ] Add device-auth integration test for empty `{}` success response.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`.
   - Description: assert empty JSON request returns `200` with `{ status: \"ok\", rawOutput }`.
   - Purpose: validate happy-path contract behavior.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if response status/body diverges from contract.
9. [ ] Add device-auth integration test for legacy selector-field rejection.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`.
   - Description: assert requests with `target`/`agentName` return `400 invalid_request`.
   - Purpose: enforce strict removal of legacy dual-shape parsing.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if selector payload is accepted.
10. [ ] Add device-auth integration test for unknown non-empty field rejection.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`.
   - Description: assert non-empty body with unknown fields returns `400 invalid_request`.
   - Purpose: enforce strict `{}` request-shape contract.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if unknown fields are ignored.
11. [ ] Add device-auth integration test for codex unavailable response.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`.
   - Description: assert unavailable codex path returns `503` with `{ error: \"codex_unavailable\", reason }`.
   - Purpose: guarantee deterministic unavailable-path contract.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if status/error payload differs.
12. [ ] Add device-auth integration test for payload-too-large handling.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`.
   - Description: assert oversized payload returns `400` with `{ error: \"invalid_request\", message }` and does not emit legacy/non-contract error shapes.
   - Purpose: cover request-size corner case explicitly.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if payload-size failure behavior returns anything other than deterministic `invalid_request`.
13. [ ] Update `design.md` with simplified device-auth contract flow and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: document and diagram strict `{}` request validation and deterministic `200/400/503` response paths with legacy selector rejection.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` diagrams match final backend device-auth contract behavior.

14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run test --workspace server -- codex.device-auth`
4. [ ] Validate `/codex/device-auth` schema changes in `openapi.json`.

#### Implementation notes

- None yet.

### 11. Server Message Contract: Device-auth concurrency handling and post-success side effects

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Add deterministic concurrent request behavior and preserve post-success auth propagation/availability refresh under the simplified device-auth contract.

#### Documentation Locations

- Express routing docs: https://expressjs.com/en/guide/routing.html (used for request concurrency handling in route implementation).
- Node.js async context docs: https://nodejs.org/api/async_context.html (used for deterministic lock/serialization strategy references).
- Node.js filesystem docs: https://nodejs.org/api/fs.html (used to keep propagation side-effects non-destructive).
- Jest setup/teardown docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/setup-teardown (used for concurrent integration test structure).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required device-auth concurrency flow diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Add deterministic concurrent request handling so overlapping device-auth runs remain idempotent and do not corrupt auth propagation state.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/codexDeviceAuth.ts`, shared lock helper module.
   - Do: reuse conversation-lock pattern (`tryAcquireConversationLock` / `releaseConversationLock`) or equivalent shared lock helper.
   - Docs: https://nodejs.org/api/async_context.html, https://nodejs.org/api/fs.html.
   - Done when: concurrent requests do not create inconsistent auth state.
2. [ ] Preserve non-destructive post-success auth propagation/availability refresh behavior under the single-shape contract.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/codexDeviceAuth.ts`, `server/src/providers/codexDetection.ts`, auth propagation helpers.
   - Do: keep existing refresh/propagation side effects, but only after successful auth.
   - Docs: https://nodejs.org/api/async_context.html, https://expressjs.com/en/guide/routing.html.
   - Done when: successful auth still triggers refresh and propagation safely.
3. [ ] Add concurrent device-auth integration test for overlapping request idempotency.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`.
   - Description: assert overlapping auth requests produce deterministic, idempotent response behavior.
   - Purpose: validate lock/serialization behavior under contention.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/setup-teardown.
   - Done when: test fails if concurrent calls produce inconsistent outcomes.
4. [ ] Add post-success integration test for auth propagation side effects.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`, `server/src/test/unit/codexAuthCopy.test.ts`.
   - Description: assert successful auth triggers non-destructive propagation path exactly as defined.
   - Purpose: prevent regression in required post-success compatibility behavior.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if propagation side effects are skipped or duplicated.
5. [ ] Add post-success integration test for availability refresh side effects.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`, `server/src/test/unit/codexConfig.device-auth.test.ts`.
   - Description: assert successful auth updates codex availability state deterministically.
   - Purpose: ensure detection refresh remains aligned with auth completion.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if availability state is stale after success.
6. [ ] Add shared-auth reuse integration test across execution surfaces after one successful device-auth flow.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `server/src/test/integration/agents-run-*.test.ts`, `server/src/test/integration/flows.run.*.test.ts`.
   - Description: assert one successful shared-home device-auth flow enables chat, agent run, and flow-driven execution without requiring additional per-agent login.
   - Purpose: validate the core story guarantee of one shared auth/session home across invocation paths.
   - Docs: Context7 `/jestjs/jest`, Context7 `/openai/codex`.
   - Done when: test fails if any surface still requires separate per-agent auth after shared auth success.
7. [ ] Update `projectStructure.md` for any files added or removed in this task, after all file-add/remove subtasks are completed.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `projectStructure.md`.
   - Document name: `projectStructure.md`.
   - Document location: repository root `projectStructure.md`.
   - Description: update file-map and compatibility documentation content required by this subtask.
   - Purpose: keep repository-structure documentation synchronized with delivered code changes.
   - Do: list every file added and removed by this task (lock/helper modules, concurrency tests, and any deleted/renamed paths) after all file-changing subtasks complete.
   - Docs: https://git-scm.com/docs/git-ls-files.
   - Done when: project file map reflects the complete final set of files added/removed by this task.
8. [ ] Update `design.md` with device-auth concurrency and side-effect flows plus Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: add/update diagrams for lock acquisition/release, auth success side effects, availability refresh, and propagation sequencing.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` diagrams and text describe the final concurrency and side-effect behavior implemented in this task.

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run test --workspace server -- codex.device-auth`
4. [ ] Run targeted concurrency test(s) for `/codex/device-auth` and verify idempotent outcomes.
5. [ ] Run shared-auth reuse integration tests across chat/agent/flow surfaces and verify no per-agent re-login is required.

#### Implementation notes

- None yet.

### 12. Server Message Contract: Add codex model reasoning-capability payload to `/chat/models`

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Implement backend model-capability payload contract for Codex models so frontend reasoning options are driven by server data, not hard-coded values.

#### Documentation Locations

- `@openai/codex-sdk` model capability surfaces: Context7 `/openai/codex` (used to source supported/default reasoning effort values).
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (used to publish `/chat/models` capability payload contract).
- TypeScript docs: https://www.typescriptlang.org/docs/ (used to extend shared DTO typing safely).
- Jest docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started (used for completeness tests on every returned model entry).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required chat-model capability contract diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Update shared response types in `common/src/lmstudio.ts` to include per-model capability fields.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `common/src/lmstudio.ts`.
   - Do: add `supportedReasoningEfforts: string[]` and `defaultReasoningEffort: string` on codex model DTOs.
   - Docs: Context7 `/openai/codex`, TypeScript docs.
   - Done when: shared types compile and are consumed by server/client.
2. [ ] Update `server/src/routes/chatModels.ts` to include capability fields for every codex model item.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/chatModels.ts`.
   - Do: populate both capability fields from resolver/model metadata for each codex entry.
   - Docs: Context7 `/openai/codex`.
   - Done when: API response includes fields on all codex models.
3. [ ] Update `openapi.json` for `/chat/models` codex response schema if documented there.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `openapi.json`.
   - Do: add both new fields as required for codex model schema entries.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: schema reflects runtime payload and matches runtime route response fields.
4. [ ] Update OpenAPI contract tests for `/chat/models` codex capability fields.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/test/unit/openapi.contract.test.ts`.
   - Do: add assertions for `supportedReasoningEfforts` and `defaultReasoningEffort` presence/requirements in codex model schema.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html, Context7 `/jestjs/jest`.
   - Done when: contract test fails if either field is missing from the documented codex model shape.
5. [ ] Update shared mock fixtures and contract helpers to include capability fields.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `common/src/fixtures/mockModels.ts`, related test helpers.
   - Do: update all codex fixture objects with supported/default effort fields.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/setup-teardown, https://www.typescriptlang.org/docs/.
   - Done when: fixture-driven tests do not require ad-hoc overrides.
6. [ ] Add codex model payload test for `supportedReasoningEfforts` presence and non-empty values.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chatModels.codex.test.ts`.
   - Description: assert every codex model response item includes a non-empty `supportedReasoningEfforts` array.
   - Purpose: guarantee frontend receives renderable reasoning option sets.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if any codex model omits or empties the array.
7. [ ] Add codex model payload test for `defaultReasoningEffort` validity.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chatModels.codex.test.ts`.
   - Description: assert every codex model `defaultReasoningEffort` exists and is a member of `supportedReasoningEfforts`.
   - Purpose: ensure deterministic client default/reset behavior.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if default is missing or invalid.
8. [ ] Add mixed-provider payload regression test for non-codex model shape stability.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Regression.
   - Test location: `server/src/test/unit/chatModels.codex.test.ts`.
   - Description: assert non-codex model entries remain unchanged when codex capability fields are introduced.
   - Purpose: prevent cross-provider schema regressions.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/using-matchers.
   - Done when: test fails if non-codex payload shape is unintentionally modified.
9. [ ] Add codex-unavailable payload contract test for `/chat/models`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chatModels.codex.test.ts`.
   - Description: assert unavailable codex path returns deterministic contract-safe payload (`available: false`, `models: []`) without malformed capability fields.
   - Purpose: cover degraded/error-path contract behavior for frontend consumers.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if unavailable path response shape diverges from documented contract.
10. [ ] Update `design.md` with `/chat/models` capability contract details and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: add/update diagrams and examples for per-model `supportedReasoningEfforts` and `defaultReasoningEffort` payload flow from server to client.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` reflects the final capability payload contract and data flow implemented in this task.

11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run build --workspace common`
4. [ ] `npm run test --workspace server -- chatModels.codex`
5. [ ] Run targeted mixed-provider model payload tests (codex + non-codex) and verify pass.
6. [ ] Run codex-unavailable payload contract tests and verify deterministic response shape.

#### Implementation notes

- None yet.

### 13. Server: Share codex capability resolver across `/chat/models` and `/chat`

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Replace static reasoning/model sources with one shared runtime codex capability resolver and use it consistently for chat response payloads and chat request validation.

#### Documentation Locations

- `@openai/codex-sdk` capabilities and model metadata: Context7 `/openai/codex` (used to build one shared runtime resolver for `/chat/models` and `/chat`).
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (used to keep response and validation contracts aligned).
- RFC 7807 and HTTP semantics: https://datatracker.ietf.org/doc/html/rfc7807 and https://httpwg.org/specs/rfc9110.html (used for deterministic invalid-request errors).
- TypeScript docs: https://www.typescriptlang.org/docs/ (used for shared resolver output typing).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for capability resolver and validation test updates in this task).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required shared capability-resolver architecture diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Replace static reasoning/model sources for chat capability payloads and chat validation with one shared runtime codex capability resolver sourced from model metadata.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/chatModels.ts`, `server/src/routes/chat.ts`, `server/src/routes/chatValidators.ts`, shared helper files under `server/src/config`.
   - Do: remove hard-coded effort arrays and `getCodexModelList`/`getCodexEnvDefaults` static assumptions where applicable.
   - Docs: Context7 `/openai/codex`.
   - Done when: both routes read capabilities from same resolver output.
2. [ ] Implement one shared codex capability resolver module used by `/chat/models` payload generation and `/chat` validation.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: new module under `server/src/codex/` or `server/src/chat/` plus imports in both routes.
   - Do: expose stable API returning supported/default effort per model with deterministic fallback when metadata unavailable.
   - Docs: Context7 `/openai/codex`, https://www.typescriptlang.org/docs/.
   - Done when: one module is imported by both consumers.
3. [ ] Ensure deterministic behavior when capability data changes and emit only capability-normalized effort values.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: shared resolver and `chatModels` route mapping.
   - Do: normalize ordering and ensure fallback default is explicit.
   - Docs: Context7 `/openai/codex`, https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: emitted values are deterministic across repeated calls.
4. [ ] Add server-side chat request validation that rejects unsupported `model_reasoning_effort` values for selected model with deterministic `invalid_request` errors.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `server/src/routes/chat.ts`, validator module.
   - Do: validate effort against selected model capability set; no silent downgrade.
   - Docs: https://datatracker.ietf.org/doc/html/rfc7807, https://httpwg.org/specs/rfc9110.html.
   - Done when: unsupported effort returns deterministic `invalid_request` response.
5. [ ] Add parity test for `/chat/models` payload using shared capability resolver fixture.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chatModels.codex.test.ts`.
   - Description: assert `/chat/models` response is derived from shared resolver output fixture.
   - Purpose: lock payload producer to shared resolver contract.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/snapshot-testing.
   - Done when: test fails if `/chat/models` diverges from resolver output.
6. [ ] Add parity test for `/chat` validation using shared capability resolver fixture.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chat-codex-reasoning-delta.test.ts`, `server/src/test/integration/chat-codex.test.ts`.
   - Description: assert `/chat` request validation uses same resolver fixture as `/chat/models`.
   - Purpose: prevent payload/validation capability drift.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if `/chat` accepts/rejects values inconsistent with resolver output.
7. [ ] Add fallback test for deterministic `/chat/models` payload when metadata is unavailable.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chatModels.codex.test.ts`.
   - Description: assert fallback payload shape and defaults remain deterministic when metadata fetch fails.
   - Purpose: guarantee stable API behavior in degraded metadata conditions.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/mock-functions.
   - Done when: test fails if fallback payload changes nondeterministically.
8. [ ] Add fallback validation test for accepted reasoning-effort values.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chat-codex-reasoning-delta.test.ts`, `server/src/test/integration/chat-codex.test.ts`.
   - Description: assert valid fallback-supported effort values are accepted by `/chat` validation.
   - Purpose: confirm fallback validation still supports intended requests.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if valid fallback values are rejected.
9. [ ] Add fallback validation test for rejected reasoning-effort values.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chat-codex-reasoning-delta.test.ts`, `server/src/test/integration/chat-codex.test.ts`.
   - Description: assert unsupported fallback effort values are rejected with deterministic `invalid_request`.
   - Purpose: confirm fallback validation remains strict and deterministic.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if unsupported fallback values are accepted.
10. [ ] Add forward-compatibility test for non-standard reasoning-effort capability values.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/chat-codex-reasoning-delta.test.ts`.
   - Description: inject a capability fixture containing a non-standard/new effort value (outside current static list) and assert `/chat/models` surfaces it while `/chat` validation accepts it for that model.
   - Purpose: guarantee future SDK/runtime reasoning additions do not require new one-off server code.
   - Docs: Context7 `/openai/codex`, Context7 `/jestjs/jest`.
   - Done when: test fails if unseen capability values are dropped or rejected despite resolver support.
11. [ ] Update `projectStructure.md` for any files added or removed in this task, after all file-add/remove subtasks are completed.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `projectStructure.md`.
   - Document name: `projectStructure.md`.
   - Document location: repository root `projectStructure.md`.
   - Description: update file-map and compatibility documentation content required by this subtask.
   - Purpose: keep repository-structure documentation synchronized with delivered code changes.
   - Do: list every file added and removed by this task (shared capability resolver modules, supporting tests, and any deleted/renamed paths).
   - Docs: https://git-scm.com/docs/git-ls-files.
   - Done when: `projectStructure.md` includes the complete set of files added/removed by this task.
12. [ ] Update `design.md` with shared capability-resolver architecture and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: document and diagram one resolver feeding both `/chat/models` and `/chat` validation, including deterministic fallback paths.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` clearly shows shared capability resolution and validation flow with no duplicate logic paths.

13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] `npm run test --workspace server -- chatModels.codex`
4. [ ] Run targeted server chat-validation tests for unsupported reasoning effort and verify deterministic error contract.
5. [ ] Run targeted parity tests for `/chat/models` and `/chat`.
6. [ ] Run targeted fallback-capability tests and verify both accepted and rejected effort flows are deterministic.
7. [ ] Run forward-compatibility capability tests using non-standard effort values and verify `/chat/models` + `/chat` parity.

#### Implementation notes

- None yet.

### 14. Frontend: Consume simplified device-auth API contract

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

After Task 10 is complete, update frontend API request/response types for the simplified device-auth contract.

#### Documentation Locations

- Fetch API reference: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API (used for client request/response handling behavior).
- TypeScript docs: https://www.typescriptlang.org/docs/ (used for strict client API contract typing).
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (used to keep frontend client contract synchronized with server schema).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for frontend API contract test updates in this task).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required frontend contract-consumption flow diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Update `client/src/api/codex.ts` request type/payload to send `{}` for `POST /codex/device-auth`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/api/codex.ts`.
   - Do: remove target/agent parameters and always post empty object.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API, https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: request body is always `{}`.
2. [ ] Update response typing/parsing to match new backend response shape (remove target-specific fields from success type).
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/api/codex.ts`, shared type imports from `common/src`.
   - Do: parse success `{ status, rawOutput }` and error unions `{ error, ... }`.
   - Docs: TypeScript union docs.
   - Done when: no client type references response `target`/`agentName`.
3. [ ] Add frontend API unit test for strict `{}` request payload serialization.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/**` codex API helper suites.
   - Description: assert device-auth client always sends empty JSON object request body.
   - Purpose: enforce strict request contract on client side.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if request body includes target/agent fields.
4. [ ] Add frontend API unit test for `200` success response parsing.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/**` codex API helper suites.
   - Description: assert success payload parses to `{ status, rawOutput }` shape.
   - Purpose: ensure happy-path response contract handling remains correct.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if success payload parsing drifts.
5. [ ] Add frontend API unit test for `400 invalid_request` response parsing.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/**` codex API helper suites.
   - Description: assert invalid request payload parses deterministically to error type.
   - Purpose: guarantee deterministic client handling of request-shape errors.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if `400` parsing loses error details.
6. [ ] Add frontend API unit test for `503 codex_unavailable` response parsing.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/**` codex API helper suites.
   - Description: assert unavailable response maps to expected error type with reason.
   - Purpose: guarantee deterministic unavailable-path handling in client API layer.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if `503` parsing is inconsistent.
7. [ ] Update `design.md` with frontend device-auth API consumption flow and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: document and diagram request/response handling for the simplified `{}` device-auth contract in client API code.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` reflects final frontend API consumption flow and error-state handling from this task.

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run test --workspace client -- codexDeviceAuthApi`
4. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` for simplified device-auth request/response behavior and no debug-console errors.
8. [ ] `npm run compose:down`

#### Implementation notes

- None yet.

### 15. Frontend: Remove device-auth target selector UX and wire one shared auth dialog flow

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

After Task 10 and Task 14 are complete, simplify UI usage to one shared device-auth flow with no chat/agent target selector.

#### Documentation Locations

- MUI MCP entrypoint: https://llms.mui.com/material-ui/7.2.0/getting-started/mcp.md (used to ensure current-version Material UI guidance via MCP).
- MUI API docs used by this task: https://llms.mui.com/material-ui/7.2.0/api/dialog.md, https://llms.mui.com/material-ui/7.2.0/api/button.md, https://llms.mui.com/material-ui/7.2.0/api/alert.md, https://llms.mui.com/material-ui/7.2.0/api/text-field.md (used for component prop/state behavior during dialog simplification).
- React docs: https://react.dev/reference/react and https://react.dev/learn/sharing-state-between-components (used for shared dialog state flow across pages).
- Testing Library docs: https://testing-library.com/docs/ (used for dialog and page integration tests).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for dialog and page integration test updates in this task).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required frontend auth-flow diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Reuse the existing `CodexDeviceAuthDialog` component and simplify it in place (no replacement component unless strictly necessary).
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/components/codex/CodexDeviceAuthDialog.tsx`.
   - Do: keep component identity and simplify props/state instead of creating new dialog component.
   - Docs: MUI Dialog docs via MCP, React component ref docs.
   - Done when: same component file handles the new single auth flow.
2. [ ] Remove target selector behavior from the dialog and update copy/state handling for one shared flow.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/components/codex/CodexDeviceAuthDialog.tsx`.
   - Do: remove selector control and any target-specific text branches.
   - Docs: MUI FormControl/Alert docs via MCP.
   - Done when: dialog has one path and no target-specific UI states.
3. [ ] Update `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx` to use shared dialog behavior without selector defaults.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`.
   - Do: remove page-level target defaults and pass unified dialog props only.
   - Docs: React state lifting docs https://react.dev/learn/sharing-state-between-components.
   - Done when: both pages trigger same dialog API without selector props.
4. [ ] Add frontend integration test for dialog selector removal.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/**` `CodexDeviceAuthDialog` suites.
   - Description: assert target selector UI is absent and dialog renders one unified auth flow.
   - Purpose: prevent reintroduction of chat-vs-agent branching UX.
   - Docs: https://testing-library.com/docs/.
   - Done when: test fails if selector controls reappear.
5. [ ] Add frontend integration test for ChatPage shared auth dialog wiring.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/**` ChatPage suites.
   - Description: assert ChatPage opens and uses unified auth dialog without target defaults.
   - Purpose: guarantee chat page integration uses simplified API flow.
   - Docs: https://testing-library.com/docs/.
   - Done when: test fails if chat page still passes selector-specific behavior.
6. [ ] Add frontend integration test for AgentsPage shared auth dialog wiring.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/**` AgentsPage suites.
   - Description: assert AgentsPage opens and uses same unified auth dialog contract as ChatPage.
   - Purpose: guarantee consistent auth UX across pages.
   - Docs: https://testing-library.com/docs/.
   - Done when: test fails if agents page diverges from shared dialog flow.
7. [ ] Add frontend integration test for `400 invalid_request` dialog error state.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/**` `CodexDeviceAuthDialog` suites.
   - Description: assert dialog shows deterministic error state on `400 invalid_request`.
   - Purpose: verify request-validation failures are surfaced correctly to users.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if `400` errors are hidden or malformed.
8. [ ] Add frontend integration test for `503 codex_unavailable` dialog error state.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/**` `CodexDeviceAuthDialog` suites.
   - Description: assert dialog shows deterministic unavailable state on `503 codex_unavailable`.
   - Purpose: verify unavailable-path UX behavior.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if `503` state is not rendered as expected.
9. [ ] Add frontend integration test for dialog retry behavior after error.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/**` `CodexDeviceAuthDialog` suites.
   - Description: assert retry action transitions from error/loading back to successful completion state.
   - Purpose: ensure robust recovery flow from auth errors.
   - Docs: https://testing-library.com/docs/, Context7 `/jestjs/jest`, https://jestjs.io/docs/asynchronous.
   - Done when: test fails if retry does not clear error and proceed deterministically.
10. [ ] Update `design.md` with unified frontend device-auth UX flow and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: add/update diagrams for one shared auth dialog flow across ChatPage and AgentsPage including error and retry states.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` shows the final single-path frontend auth UX flow implemented in this task.

11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run test --workspace client -- codexDeviceAuthDialog`
4. [ ] Run related ChatPage/AgentsPage codex-auth tests and verify pass.
5. [ ] Run targeted auth-dialog error/retry tests and verify deterministic UI states.
6. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
7. [ ] `npm run compose:build`
8. [ ] `npm run compose:up`
9. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` for shared dialog behavior on ChatPage/AgentsPage and no debug-console errors.
10. [ ] `npm run compose:down`

#### Implementation notes

- None yet.

### 16. Frontend: Expose codex model capabilities in chat model state and enforce deterministic defaults

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

After Task 12 and Task 13 are complete, update chat model state plumbing to carry capability fields and apply deterministic default/reset behavior.

#### Documentation Locations

- React hooks and state docs: https://react.dev/reference/react and https://react.dev/learn/choosing-the-state-structure (used for deterministic default/reset state transitions).
- TypeScript docs: https://www.typescriptlang.org/docs/ (used for capability-field typing in hook state).
- Jest + Testing Library docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started and https://testing-library.com/docs/ (used for capability-driven reset behavior tests).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required model-capability state-flow diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Update `client/src/hooks/useChatModel.ts` to retain and expose codex model capability fields per model.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/hooks/useChatModel.ts`.
   - Do: persist `supportedReasoningEfforts` and `defaultReasoningEffort` in local model state/derived selectors.
   - Docs: https://react.dev/reference/react, https://www.typescriptlang.org/docs/.
   - Done when: hook returns capability fields for selected model.
2. [ ] Reuse existing codex-default wiring in `useChatModel` / `useChatStream` when applying capability-driven defaults and reset behavior; avoid duplicating default-selection logic.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`.
   - Do: route through existing default helpers and extend them for capability payload.
   - Docs: https://react.dev/learn/reusing-logic-with-custom-hooks.
   - Done when: one default-selection path is used.
3. [ ] Implement deterministic reset behavior: when selected effort is no longer valid for selected model, reset to `defaultReasoningEffort`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/hooks/useChatModel.ts`.
   - Do: add validation/reset on model change and capability refresh.
   - Docs: https://react.dev/learn/choosing-the-state-structure.
   - Done when: stale effort selection self-corrects deterministically.
4. [ ] Update shared/common typings usage in client to remove hard-coded assumptions about effort lists.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`, any local effort enums.
   - Do: delete static effort arrays if they mirror codex assumptions.
   - Docs: TypeScript literal types docs.
   - Done when: effort options derive from model capability payload only.
5. [ ] Add frontend hook test for model-switch default/reset behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/chatPage.codexDefaults*` and `useChatModel` hook suites.
   - Description: assert switching models resets invalid effort selection to selected model default.
   - Purpose: guarantee deterministic reset behavior during normal model changes.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect, https://testing-library.com/docs/.
   - Done when: test fails if stale effort value survives model switch.
6. [ ] Add frontend hook test for capability-update default/reset behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/chatPage.codexDefaults*` and `useChatModel` hook suites.
   - Description: assert capability payload refresh invalidating current effort forces reset to `defaultReasoningEffort`.
   - Purpose: guarantee deterministic reset behavior when capabilities change at runtime.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if invalid selection remains after capability update.
7. [ ] Add malformed-payload test for empty `supportedReasoningEfforts`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/chatPage.codexDefaults*` and hook suites.
   - Description: assert UI/hook behavior remains stable with empty supported effort arrays.
   - Purpose: prevent runtime crashes on malformed capability payload corner case.
   - Docs: https://react.dev/learn/choosing-the-state-structure, Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if empty array causes crash or nondeterministic state.
8. [ ] Add malformed-payload test for mismatched `defaultReasoningEffort`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `client/src/test/chatPage.codexDefaults*` and hook suites.
   - Description: assert deterministic fallback behavior when default effort is not included in supported list.
   - Purpose: enforce resilient behavior on inconsistent backend payload data.
   - Docs: https://react.dev/learn/choosing-the-state-structure, Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if mismatched default causes unstable UI state.
9. [ ] Update `design.md` with chat model capability state flow and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: document and diagram capability propagation into hook state and deterministic reset-to-default behavior on model/capability changes.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` diagrams match the implemented state transition behavior in this task.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run test --workspace client -- chatPage.codexDefaults`
4. [ ] Run targeted `useChatModel` capability/default tests directly and verify pass.
5. [ ] Run malformed-capability payload corner-case tests and verify pass.
6. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
7. [ ] `npm run compose:build`
8. [ ] `npm run compose:up`
9. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` for model-switch default/reset behavior and no debug-console errors.
10. [ ] `npm run compose:down`

#### Implementation notes

- None yet.

### 17. Frontend: Render dynamic reasoning-effort options and enforce payload validity per selected model

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

After Task 16 is complete, switch chat flags UI and chat payload building to runtime capability-driven reasoning effort values.

#### Documentation Locations

- MUI MCP entrypoint: https://llms.mui.com/material-ui/7.2.0/getting-started/mcp.md (used for current-version component API accuracy).
- MUI API docs used by this task: https://llms.mui.com/material-ui/7.2.0/api/select.md, https://llms.mui.com/material-ui/7.2.0/api/menu-item.md, https://llms.mui.com/material-ui/7.2.0/api/form-control.md (used for dynamic option rendering and form-state integration).
- React docs: https://react.dev/reference/react (used for payload validity and reset-on-change state flow).
- `@openai/codex-sdk` + OpenAPI contract references: Context7 `/openai/codex` and https://spec.openapis.org/oas/v3.0.3.html (used to match UI payloads to server-validated capability constraints).
- Jest testing framework references: Context7 `/jestjs/jest` and https://jestjs.io/docs/getting-started (used for reasoning-options rendering and payload validation tests in this task).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required reasoning-option UI/payload flow diagrams in `design.md` for this task).

#### Subtasks

1. [ ] Update `client/src/components/chat/CodexFlagsPanel.tsx` to render reasoning options from selected model `supportedReasoningEfforts`.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/components/chat/CodexFlagsPanel.tsx`.
   - Do: remove hard-coded effort option list and map from selected model capabilities.
   - Docs: MUI Select/MenuItem docs via MCP.
   - Done when: options in UI exactly match payload values.
2. [ ] Update `client/src/hooks/useChatStream.ts` payload builder to send only values valid for selected model capability set.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/hooks/useChatStream.ts`.
   - Do: pre-send validation against selected model capabilities.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html, Context7 `/openai/codex`.
   - Done when: invalid values are never sent.
3. [ ] Ensure invalid prior selection is replaced by selected model `defaultReasoningEffort` before request send.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `client/src/hooks/useChatStream.ts`, optionally shared helper in `useChatModel`.
   - Do: enforce fallback to model default on send path.
   - Docs: https://react.dev/learn/choosing-the-state-structure.
   - Done when: request payload always carries supported value.
4. [ ] Add frontend render test for dynamic reasoning options list.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/chatPage.flags.reasoning*`.
   - Description: assert select options render exactly from `supportedReasoningEfforts` for selected model.
   - Purpose: prevent reintroduction of hard-coded/static effort lists.
   - Docs: https://testing-library.com/docs/queries/about/.
   - Done when: test fails if rendered options do not match capability payload.
5. [ ] Add frontend payload test for invalid-selection reset before request send.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/chatPage.flags.reasoning*`.
   - Description: assert invalid prior effort selection is reset to `defaultReasoningEffort` before payload generation.
   - Purpose: enforce deterministic request validity behavior.
   - Docs: https://testing-library.com/docs/queries/about/.
   - Done when: test fails if invalid values reach payload builder.
6. [ ] Add frontend payload test for supported-values-only request output.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/chatPage.flags.reasoning*`.
   - Description: assert outgoing payload includes only values present in selected model capability set.
   - Purpose: ensure client never sends server-invalid reasoning values.
   - Docs: https://testing-library.com/docs/queries/about/.
   - Done when: test fails if unsupported values are emitted.
7. [ ] Add corner-case integration test for single-option capability list.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/chatPage.flags.reasoning*`.
   - Description: assert UI selection and payload flow remain valid when only one reasoning effort is supported.
   - Purpose: validate minimal-option-set corner case behavior.
   - Docs: https://testing-library.com/docs/queries/about/, https://react.dev/reference/react.
   - Done when: test fails if one-option models produce invalid UI or payload behavior.
8. [ ] Add corner-case integration test for non-standard/new reasoning-effort capability values.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `client/src/test/chatPage.flags.reasoning*`, `client/src/test/chatPage.models.test.tsx`.
   - Description: assert a non-standard capability value from backend payload is rendered in the selector and can be sent without client-side rejection when it is model-supported.
   - Purpose: guarantee frontend remains future-compatible with newly surfaced SDK/runtime effort values.
   - Docs: https://testing-library.com/docs/queries/about/, Context7 `/openai/codex`, Context7 `/jestjs/jest`.
   - Done when: test fails if a model-supported non-standard value is hidden or blocked.
9. [ ] Update `design.md` with dynamic reasoning-option UI/payload flow and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: add/update diagrams for capability-driven option rendering, invalid-selection correction, and request payload validation before send.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` captures the final end-to-end reasoning-option flow implemented by this task.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] `npm run test --workspace client -- chatPage.flags.reasoning`
4. [ ] Run targeted reasoning payload tests and verify only supported values are sent.
5. [ ] Run single-option capability-list tests and verify UI/payload behavior remains valid.
6. [ ] Run non-standard capability-value tests and verify rendered options + payload passthrough remain deterministic.
7. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
8. [ ] `npm run compose:build`
9. [ ] `npm run compose:up`
10. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` for dynamic reasoning options and no debug-console errors.
11. [ ] `npm run compose:down`

#### Implementation notes

- None yet.

### 18. Server: Add cross-surface regression tests for precedence and normalization rules

- Task Status: **__todo__**
- Git Commits: `None yet`

#### Overview

Add focused regression coverage for precedence/normalization behavior across REST, MCP, and flow execution surfaces.

#### Documentation Locations

- Node.js test runner docs: https://nodejs.org/api/test.html (used where native test utilities/helpers are referenced).
- Jest docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started (used for integration and regression assertion patterns).
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (used for MCP invocation-path parity assertions).
- TOML + Codex references: https://toml.io/en/v1.0.0 and Context7 `/openai/codex` (used for normalization and canonical runtime config expectations).
- Cucumber guides: https://cucumber.io/docs/guides/ (required because task-level verification runs `npm run test --workspace server`, which executes cucumber integration tests).

#### Subtasks

1. [ ] Add cross-surface precedence test for shared project inheritance.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`, `server/src/test/unit/flows*.test.ts`, `server/src/test/integration/flows.*.test.ts`, `server/src/test/integration/mcp*`, `server/src/test/unit/mcp*`, `server/src/test/mcp2/**`.
   - Description: assert shared base `[projects]` entries are inherited across REST/flow/MCP surfaces.
   - Purpose: enforce consistent shared project inheritance behavior everywhere.
   - Docs: https://www.jsonrpc.org/specification, https://toml.io/en/v1.0.0.
   - Done when: all surfaces show identical inherited shared project entries.
2. [ ] Add cross-surface precedence test for agent project override behavior.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`, `server/src/test/unit/flows*.test.ts`, `server/src/test/integration/flows.*.test.ts`, `server/src/test/integration/mcp*`, `server/src/test/unit/mcp*`, `server/src/test/mcp2/**`.
   - Description: assert agent project entries override same-path base project entries across all invocation paths.
   - Purpose: enforce deterministic `effectiveProjects` override precedence.
   - Docs: https://www.jsonrpc.org/specification, https://toml.io/en/v1.0.0.
   - Done when: all surfaces agree on agent-over-base project values.
3. [ ] Add normalization test for `features.view_image_tool` to canonical output.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/unit/agents-config-defaults.test.ts` and normalizer suites.
   - Description: assert alias input produces canonical `tools.view_image` output only.
   - Purpose: guarantee canonical key emission for view-image behavior.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: test fails if legacy key is re-emitted as output.
4. [ ] Add normalization test for `features.web_search_request` to canonical output.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/unit/agents-config-defaults.test.ts` and normalizer suites.
   - Description: assert web-search legacy alias input normalizes to canonical top-level `web_search`.
   - Purpose: prevent mixed legacy/canonical web-search state.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: test fails if canonical `web_search` is not emitted.
5. [ ] Add normalization collision test for canonical-key precedence.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/unit/agents-config-defaults.test.ts` and normalizer suites.
   - Description: assert canonical key value wins when canonical and legacy alias keys conflict.
   - Purpose: enforce deterministic collision resolution.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: test fails if alias value overrides canonical value.
6. [ ] Add validation-parity test for unknown-key handling across REST/MCP/flow.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`, `server/src/test/unit/flows*.test.ts`, `server/src/test/integration/flows.*.test.ts`, `server/src/test/integration/mcp*`, `server/src/test/unit/mcp*`, `server/src/test/mcp2/**`.
   - Description: assert unknown keys produce warning+ignore behavior consistently on all invocation paths.
   - Purpose: lock one shared unknown-key policy across surfaces.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started.
   - Done when: test fails if any surface hard-fails unknown keys.
7. [ ] Add validation-parity test for invalid-type handling across REST/MCP/flow.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`, `server/src/test/unit/flows*.test.ts`, `server/src/test/integration/flows.*.test.ts`, `server/src/test/integration/mcp*`, `server/src/test/unit/mcp*`, `server/src/test/mcp2/**`.
   - Description: assert invalid supported-key types hard-fail consistently on all invocation paths.
   - Purpose: lock one shared invalid-type policy across surfaces.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started.
   - Done when: test fails if any surface downgrades invalid type errors.
8. [ ] Reuse existing server test patterns (`codex.device-auth`, `chatModels.codex`, and `openapi.contract`) instead of creating one-off harnesses.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: new tests in existing suite folders, not a parallel harness directory.
   - Do: follow repository test setup helpers.
   - Docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started.
   - Done when: no duplicated harness boilerplate is introduced.
9. [ ] Update `projectStructure.md` for any files added or removed in this task, after all file-add/remove subtasks are completed.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `projectStructure.md`.
   - Document name: `projectStructure.md`.
   - Document location: repository root `projectStructure.md`.
   - Description: update file-map and compatibility documentation content required by this subtask.
   - Purpose: keep repository-structure documentation synchronized with delivered code changes.
   - Do: add all new cross-surface regression test files created by this task and confirm no removed files are missing from documentation.
   - Docs: https://git-scm.com/docs/git-ls-files.
   - Done when: project structure documentation reflects this task's final test-file footprint.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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

- Node.js filesystem/test docs: https://nodejs.org/api/fs.html and https://nodejs.org/api/test.html (used for file-safety and fixture validation coverage).
- Jest docs: Context7 `/jestjs/jest`, https://jestjs.io/docs/getting-started (used for migration safety regression suites).
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html (used for secret-safe logging assertions).
- TOML + Codex references: https://toml.io/en/v1.0.0 and Context7 `/openai/codex` (used for fixture normalization and parser-removal guard tests).
- Cucumber guides: https://cucumber.io/docs/guides/ (required because task-level verification runs `npm run test --workspace server`, which executes cucumber integration tests).

#### Subtasks

1. [ ] Add auth-file presence test across migration-compatible flows.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-authSeed.test.ts`, `server/src/test/integration/codexAuthCopy.integration.test.ts`, migration-related suites.
   - Description: assert every expected `codex_agents/*/auth.json` exists before and after migration-compatible operations.
   - Purpose: guarantee non-destructive auth-file preservation.
   - Docs: https://nodejs.org/api/fs.html.
   - Done when: test fails if any expected auth file is missing post-flow.
2. [ ] Add log-safety test for config-parse error logging.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: route/resolver logging tests under `server/src/test/**`.
   - Description: assert config parse failures log only sanitized key/path context and no raw secrets.
   - Purpose: enforce secret-safe logging for config error paths.
   - Docs: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html.
   - Done when: test fails if raw TOML/token-like content appears in logs.
3. [ ] Add log-safety test for device-auth error logging.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Unit.
   - Test location: `server/src/test/integration/codex.device-auth.test.ts`, `server/src/test/unit/codexDeviceAuth.test.ts` logging assertions.
   - Description: assert device-auth failures never log raw auth output/tokens and only log sanitized diagnostics.
   - Purpose: enforce secret-safe logging for auth error paths.
   - Docs: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html.
   - Done when: test fails if sensitive auth material appears in logs.
4. [ ] Add fixture-sweep validation test for all `codex_agents/*/config.toml` files.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: fixture sweep suite under `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`.
   - Description: enumerate all current agent config files and validate each against normalization/validation pipeline.
   - Purpose: ensure existing in-repo configs are all covered by deterministic validation.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: test fails if any agent config is unvalidated or produces nondeterministic output.
5. [ ] Add fixture-sweep parity test across REST/MCP/flow for validated configs.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Integration.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`, `server/src/test/unit/flows*.test.ts`, `server/src/test/integration/flows.*.test.ts`, `server/src/test/integration/mcp*`, `server/src/test/unit/mcp*`, `server/src/test/mcp2/**`.
   - Description: assert each validated config yields consistent behavior across invocation paths.
   - Purpose: prevent path-dependent behavior drift for existing agents.
   - Docs: https://www.jsonrpc.org/specification, Context7 `/jestjs/jest`, https://jestjs.io/docs/expect.
   - Done when: test fails if any invocation path diverges.
6. [ ] Add parser-removal regression test for agent execution path.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Regression.
   - Test location: `server/src/test/unit/agents-*.test.ts`, `server/src/test/integration/agents-*.test.ts`.
   - Description: assert agent execution no longer relies on model-only regex parsing behavior.
   - Purpose: protect resolver rollout in agent path.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: test fails if agent path reverts to regex parsing.
7. [ ] Add parser-removal regression test for flow execution path.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Test type: Regression.
   - Test location: `server/src/test/unit/flows*.test.ts`, `server/src/test/integration/flows.*.test.ts`.
   - Description: assert flow execution no longer relies on model-only regex parsing behavior.
   - Purpose: protect resolver rollout in flow path.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: test fails if flow path reverts to regex parsing.
8. [ ] Update `projectStructure.md` for any files added or removed in this task, after all file-add/remove subtasks are completed.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `projectStructure.md`.
   - Document name: `projectStructure.md`.
   - Document location: repository root `projectStructure.md`.
   - Description: update file-map and compatibility documentation content required by this subtask.
   - Purpose: keep repository-structure documentation synchronized with delivered code changes.
   - Do: document new compatibility/safety regression test files and any removed migration-era test files.
   - Docs: https://git-scm.com/docs/git-ls-files.
   - Done when: `projectStructure.md` contains an accurate file-map update for this task.

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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

- Mermaid docs via Context7: Context7 `/mermaid-js/mermaid` (used to document updated runtime architecture diagrams correctly).
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (used to document exact API contract changes).
- `@openai/codex-sdk` config references: Context7 `/openai/codex` (used to explain shared-home vs runtime-override behavior accurately).

#### Subtasks

1. [ ] Update `design.md` with shared home strategy, config ownership, precedence/normalization, device-auth contract, and capability-driven reasoning options.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: include explicit flow diagrams/sections for chat vs agent runtime ownership and contract payloads.
   - Docs: Context7 `/mermaid-js/mermaid`, https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: a new engineer can map each runtime path to config source without reading code.
2. [ ] Ensure examples in docs reflect canonical keys and new message contracts.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: include before/after examples for `features.view_image_tool -> tools.view_image` and `{}` device-auth request.
   - Docs: https://spec.openapis.org/oas/v3.0.3.html.
   - Done when: examples match implemented payloads and key names exactly.

3. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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

- Git file listing reference: https://git-scm.com/docs/git-ls-files (used to verify documented changed file set against actual tracked files).
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (used for documenting updated response/request shapes in file map notes).
- TOML + Codex references: https://toml.io/en/v1.0.0 and Context7 `/openai/codex` (used for canonical vs alias config examples in compatibility section).

#### Subtasks

1. [ ] Update `projectStructure.md` for all files added/removed by this story.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `projectStructure.md`.
   - Document name: `projectStructure.md`.
   - Document location: repository root `projectStructure.md`.
   - Description: update file-map and compatibility documentation content required by this subtask.
   - Purpose: keep repository-structure documentation synchronized with delivered code changes.
   - Do: add every new/changed path from server/client/common/docs work.
   - Docs: https://git-scm.com/docs/git-ls-files.
   - Done when: listed paths align with actual repository state.
2. [ ] Document read-only compatibility keys accepted as input aliases but not emitted as canonical output, with concrete before/after examples.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `projectStructure.md`.
   - Document name: `projectStructure.md`.
   - Document location: repository root `projectStructure.md`.
   - Description: update file-map and compatibility documentation content required by this subtask.
   - Purpose: keep repository-structure documentation synchronized with delivered code changes.
   - Do: include examples for `features.view_image_tool` and web-search alias normalization.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: examples make canonical output expectations explicit.

3. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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

- TOML v1.0.0 specification: https://toml.io/en/v1.0.0 (used to enforce valid final projects-only config shape).
- `@openai/codex-sdk` config behavior: Context7 `/openai/codex` (used to keep minimized base config aligned with runtime override model).
- Node.js filesystem copy semantics: https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode (used for pre-minimization chat-config existence/guard behavior).
- Mermaid specification references: Context7 `/mermaid-js/mermaid` and https://mermaid.js.org/intro/ (used for required final migration-flow diagram updates in `design.md` for this task).

#### Subtasks

1. [ ] Verify prerequisite gate: all prior tasks are marked done and validated.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Document name: `0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Document location: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Description: update prerequisite-completion checkboxes and gating markers in this story plan before starting minimization.
   - Purpose: enforce safe sequencing and make minimization preconditions auditable for junior developers.
   - Do: verify tasks 1-21 are complete before editing `./codex/config.toml`, then mark Task 22 gating checklist state in this planning document.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: all preceding task statuses and testing checkboxes are complete.
2. [ ] Confirm all `code_info`-dependent verification/inspection steps are complete before minimization and record this checkpoint in Implementation notes.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Document name: `0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Document location: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Description: add a pre-minimization Implementation Notes entry confirming all required `code_info`-dependent checks were completed earlier.
   - Purpose: preserve operational traceability for when `code_info` is expected to become unavailable after final minimization.
   - Do: add explicit checkpoint note before file minimization commit.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: note exists before any minimization diff.
3. [ ] Ensure `./codex/chat/config.toml` exists and carries chat behavior defaults before minimizing base config; if missing, abort minimization with deterministic error and no file mutation.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `codex/chat/config.toml`, migration helper in server if scripted.
   - Do: enforce guard that blocks minimization when chat config missing.
   - Docs: https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode, https://toml.io/en/v1.0.0.
   - Done when: missing-chat-config case exits safely with no mutation.
4. [ ] Minimize `./codex/config.toml` to shared defaults + `[projects]` only (remove behavior keys and MCP blocks from this file).
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `codex/config.toml`.
   - Do: retain shared projects entries only; remove `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `[features]`, `[mcp_servers]`.
   - Docs: https://toml.io/en/v1.0.0, Context7 `/openai/codex`.
   - Done when: file is projects-only plus shared-home defaults.
5. [ ] Re-verify that no `codex_agents/*` files were deleted/moved/renamed and all existing `auth.json` files remain present.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `codex_agents/*`.
   - Do: run file-presence verification and compare against pre-step list.
   - Docs: https://nodejs.org/api/fs.html.
   - Done when: all agent auth files still exist unchanged in location.
6. [ ] Add explicit operator note in Implementation notes that `code_info` MCP is expected to be unavailable after this step in this running instance.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Document name: `0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Document location: `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
   - Description: add a post-minimization Implementation Notes entry describing expected `code_info` unavailability in this running instance.
   - Purpose: provide clear operator guidance and prevent follow-up work from assuming `code_info` availability.
   - Do: add final warning note immediately after execution.
   - Docs: Context7 `/openai/codex`, https://toml.io/en/v1.0.0.
   - Done when: note exists and references this expected post-step behavior.
7. [ ] Update `design.md` with final minimized-base migration architecture and Mermaid diagrams after all architecture-flow subtasks are complete.
   - Junior context (duplicated intentionally): use this subtask's listed files, test locations, and docs links as the required source of truth; do not assume context from other subtasks. If this subtask adds/removes files, ensure the task's `projectStructure.md` update subtask records every added/removed path.
   - Files: `design.md`.
   - Document name: `design.md`.
   - Document location: repository root `design.md`.
   - Description: update architecture/flow documentation content for the behavior specified in this subtask, including Mermaid diagrams when required.
   - Purpose: keep implementation and architecture documentation synchronized for junior developers.
   - Do: document and diagram final shared `./codex/config.toml` role, `./codex/chat/config.toml` dependency, and post-minimization operational behavior notes.
   - Docs: Context7 `/mermaid-js/mermaid`, https://mermaid.js.org/intro/.
   - Done when: `design.md` reflects the final post-migration architecture and expected operational state.

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm story behavior/regressions and no debug-console errors.
9. [ ] `npm run compose:down`
10. [ ] Validate minimized `./codex/config.toml` matches projects-only target shape in this story.
11. [ ] Validate `./codex/chat/config.toml` remains present and unchanged by minimization.
12. [ ] Verify filesystem checks for `codex_agents/*/auth.json` presence pass.
13. [ ] Simulate missing chat config precondition and verify minimization step abort behavior is deterministic and non-destructive.
14. [ ] Verify final implementation notes include both required operational warnings: `code_info`-dependent checks were completed before minimization, and `code_info` MCP is expected to be unavailable after minimization in this running instance.

#### Implementation notes

- None yet.
