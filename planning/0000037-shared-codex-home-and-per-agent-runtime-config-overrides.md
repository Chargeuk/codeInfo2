# Story 0000037 – Shared CODEX_HOME with Per-Agent Runtime Config Overrides

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

CodeInfo2 currently supports multiple agents by switching Codex home folders per agent (`codex_agents/<agent>`), and this means each agent effectively needs its own Codex auth/config state.

This approach does not scale well as the number of agents grows because login/auth/session state must be managed repeatedly and the UI/API includes extra branching for chat-target vs agent-target device auth.

This story plans a move to one shared Codex home (`./codex`) for auth/session persistence while strictly preserving per-agent behavior. Per-agent behavior will be provided at runtime by reading each agent's `codex_agents/<agent>/config.toml` and passing those settings through `CodexOptions.config` whenever that agent is executed (including direct agent runs, agent commands, and flow-driven agent execution paths). Agent runs will continue using `useConfigDefaults: true` so model/policy come from runtime config values instead of hard-coded thread flags.

Hard rule for this story: agent behavior must remain unchanged from user perspective. For any given agent, only values from that agent's own `config.toml` are allowed to determine that agent's Codex behavior, regardless of how the agent is invoked.

Feasibility has been validated against latest upstream surfaces: `@openai/codex-sdk` latest stable supports runtime `CodexOptions.config` overrides and shared `CODEX_HOME` environment control, and therefore this behavior model is achievable.

Because application chat currently depends on behavior values in `./codex/config.toml`, this story also introduces a dedicated chat runtime config file (for example `./codex/chat/config.toml`) that is used for application chat behavior via runtime `CodexOptions.config` overrides while still using the same shared `CODEX_HOME` for auth/session state.

Required migration order: create the chat runtime config as a copy of current `./codex/config.toml` before reducing `./codex/config.toml` to a minimal shared-default set. This prevents chat behavior regressions during migration.

This story also plans upgrading `@openai/codex-sdk` to latest stable and simplifying frontend re-authentication so there is a single `Codex device auth` flow (no chat/agent selector).

### Acceptance Criteria

- Single shared Codex auth/session home is used for all Codex-backed chat/agent/flow execution paths (`./codex`), with no per-agent login requirement.
- `@openai/codex-sdk` is upgraded from `0.101.0` to latest stable (`0.106.0` at planning time, or newer latest stable if available during implementation) and all existing Codex integration tests pass against the upgraded version.
- Agent runtime configuration is sourced from `codex_agents/<agent>/config.toml` and mapped into `CodexOptions.config` for execution-time overrides.
- Agent and flow runs continue to set `useConfigDefaults: true`, with thread/runtime behavior driven by config defaults and explicit runtime overrides rather than duplicated model/policy flag wiring.
- Existing per-agent behavior differences (model, approval policy, sandbox mode, reasoning effort, MCP server config, relevant feature toggles, and any other behavior-defining config values) remain preserved after migration to shared `CODEX_HOME`.
- For any agent execution path (`/agents/:agentName/run`, `/agents/:agentName/commands/run`, flow-driven agent steps, and MCP agent execution surfaces), behavior is determined only by that agent's `codex_agents/<agent>/config.toml`.
- Shared `codex/config.toml` must not override agent behavior values when a named agent is running; shared home is for auth/session persistence, not behavior policy for agents.
- The only shared-base behavior injected into agent runtime config is `[projects]` trust metadata from `codex/config.toml`, merged as `effectiveProjects = { ...baseProjects, ...agentProjects }` so agent-defined project entries override shared defaults.
- Application chat behavior is sourced from dedicated chat runtime config (for example `./codex/chat/config.toml`) passed through runtime `CodexOptions.config`, not from behavior values left in minimal `./codex/config.toml`.
- Migration sequencing is enforced: chat runtime config copy is created from existing `./codex/config.toml` before `./codex/config.toml` is minimized.
- Current legacy key usage is normalized deterministically before execution: `features.view_image_tool` is translated to `tools.view_image`, and deprecated `features.web_search_request` remains supported through compatibility alias behavior.
- Unsupported or misplaced keys discovered in current agent TOMLs (for example `cli_auth_credentials_store` nested under `[projects.\"<path>\"]`) are handled deterministically with explicit validation outcome (error or warning policy defined and tested), and no silent cross-agent fallback is allowed.
- All existing agent config files under `codex_agents/*/config.toml` are validated in tests against supported runtime mapping rules and produce consistent behavior across all invocation paths.
- Codex availability detection and startup validation no longer require agent-specific `auth.json` in each agent folder; availability semantics are based on shared Codex home plus required runtime files.
- Device-auth backend endpoint no longer requires target mode branching for chat vs agent login in normal flow and supports a single Codex login path.
- Frontend re-authentication UI is simplified to one Codex device auth screen and removes chat/agent selector UX and related branch-specific messaging.
- Legacy compatibility behaviors are explicitly documented for any remaining read-only agent config fields that cannot be safely translated into runtime overrides.
- Logs and error payloads remain deterministic and secret-safe after refactor (no token/key leakage, no raw confidential config content in logs).
- `design.md` and `projectStructure.md` are updated to reflect new Codex home strategy, runtime config override flow, and re-auth UX/API contract changes.

### Out Of Scope

- Redesigning the entire agents UX beyond the required re-auth simplification.
- Introducing new Codex providers or non-Codex authentication systems.
- Reworking unrelated ingest/embedding architecture.
- Introducing persistent config editing UI for agent `config.toml` files in this story.
- Converting all agent configuration to a different file format (for example YAML/JSON) in this story.
- Changing intended behavior of existing agents (this story preserves existing agent behavior rather than redefining agent policy semantics).
- Introducing a second Codex home/auth store for chat (chat and agents continue using one shared `CODEX_HOME`).

### Questions

- Should per-agent `auth.json` propagation/seeding code be removed immediately, or retained temporarily as compatibility no-op behavior during transition?
- Should the backend device-auth route contract be changed immediately to a single-target request body, or staged with backward-compatible request parsing for one release?

## Resolved Findings (Initial Research)

- Latest stable SDK version at planning time is `@openai/codex-sdk@0.106.0`; runtime `CodexOptions.config` overrides and `env` control remain available and suitable for this design.
- The proposal is achievable without changing the agent behavior contract, provided runtime precedence is enforced so named-agent config values always win for behavior fields.
- Chat should use a dedicated runtime config file (copy of current `./codex/config.toml`) while still using the same shared `CODEX_HOME`; this avoids introducing a second auth/session home.
- Chat config copy must be created before minimizing `./codex/config.toml` so chat behavior remains stable during rollout.
- All three current agent config files contain supported core behavior keys: `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `[mcp_servers.*]`, and `[projects.*].trust_level`.
- Current compatibility gaps found in agent files:
  - `features.view_image_tool` is not a current schema key and requires compatibility mapping to `tools.view_image`.
  - `cli_auth_credentials_store = \"file\"` is currently nested under a project table in all agent files, not top-level, and therefore should not be treated as a valid project-level behavior field.
- `codex/config.toml` currently defines shared project trust entries for `/data` and `/app/server`; `coding_agent` additionally defines `/Users/danielstapleton/Documents/dev`.
- Base-project merge policy required by this story: shared `[projects]` defaults may be inherited, but agent-defined project entries take precedence and no other shared-base behavior keys are allowed to override agent behavior.

## Implementation Ideas

- Introduce a dedicated agent config loader module that parses each agent TOML into runtime overrides for `CodexOptions.config`, with a compatibility-first approach aimed at preserving current behavior.
- Keep `buildCodexOptions` centered on shared `CODEX_HOME`, and add an optional per-run `config` payload sourced from the selected agent's `config.toml`.
- Add a chat runtime config loader (for example from `./codex/chat/config.toml`) and route application chat execution through that runtime `CodexOptions.config` payload.
- Implement rollout guardrails: copy current `./codex/config.toml` to chat runtime config path before reducing base config to minimal shared defaults.
- Refactor Codex invocation callsites in `server/src/agents/service.ts`, `server/src/flows/service.ts`, and `server/src/chat/interfaces/ChatInterfaceCodex.ts` to pass agent runtime config overrides for all agent execution paths while retaining `useConfigDefaults: true` semantics.
- Implement explicit precedence rules for agent runs: agent `config.toml` values win for agent behavior, and shared-home config is limited to auth/session and non-agent-specific baseline concerns.
- Add a normalization layer for known legacy keys before passing runtime overrides (`features.view_image_tool -> tools.view_image`, preserve `features.web_search_request` compatibility behavior), with strict validation for unknown/misplaced keys.
- Add an explicit config-merging utility that merges only base `[projects]` from `codex/config.toml` into the agent runtime config and does not merge other shared-base behavior fields.
- Update detection/auth assumptions in `server/src/providers/codexDetection.ts` and auth-seeding paths in `server/src/agents/authSeed.ts` / discovery code to remove per-agent auth dependency.
- Simplify `POST /device-auth` contract/handler in `server/src/routes/codexDeviceAuth.ts` and corresponding frontend API typing in `client/src/api/codex.ts`.
- Simplify `client/src/components/codex/CodexDeviceAuthDialog.tsx` and remove target-selector wiring from `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx`.
- Upgrade `@openai/codex-sdk` and validate `CodexOptions`/`ThreadOptions` behavior against latest docs; confirm no regressions in run-stream event handling and thread resume behavior.
- Expand unit/integration coverage for: shared home detection, runtime config mapping, strict per-agent behavior parity across all invocation surfaces, device-auth API contract, and simplified frontend auth UX.
- Add focused regression tests for compatibility of existing agent `config.toml` examples under `codex_agents/*`.
- Add explicit logging markers for runtime config source selection and sanitized applied override metadata (without sensitive values) to aid diagnosis.
