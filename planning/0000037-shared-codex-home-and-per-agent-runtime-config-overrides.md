# Story 0000037 – Shared CODEX_HOME with Per-Agent Runtime Config Overrides

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

CodeInfo2 currently supports multiple agents by switching Codex home folders per agent (`codex_agents/<agent>`), and this means each agent effectively needs its own Codex auth/config state.

This approach does not scale well as the number of agents grows because login/auth/session state must be managed repeatedly and the UI/API includes extra branching for chat-target vs agent-target device auth.

This story plans a move to one shared Codex home (`./codex`) for auth/session persistence while still preserving per-agent behavior. Per-agent behavior will be provided at runtime by reading each agent's `codex_agents/<agent>/config.toml` and passing those settings through `CodexOptions.config` when running agent/flow executions. Agent runs will continue using `useConfigDefaults: true` so model/policy come from runtime config overrides instead of hard-coded thread flags.

This story also plans upgrading `@openai/codex-sdk` to latest and simplifying frontend re-authentication so there is a single `Codex device auth` flow (no chat/agent selector).

### Acceptance Criteria

- Single shared Codex auth/session home is used for all Codex-backed chat/agent/flow execution paths (`./codex`), with no per-agent login requirement.
- `@openai/codex-sdk` is upgraded from `0.101.0` to latest stable and all existing Codex integration tests pass against the upgraded version.
- Agent runtime configuration is sourced from `codex_agents/<agent>/config.toml` and mapped into `CodexOptions.config` for execution-time overrides.
- Agent and flow runs continue to set `useConfigDefaults: true`, with thread/runtime behavior driven by config defaults and explicit runtime overrides rather than duplicated model/policy flag wiring.
- Existing per-agent behavior differences (model, approval policy, sandbox mode, reasoning effort, MCP server config, relevant feature toggles) remain preserved after migration to shared `CODEX_HOME`.
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

### Questions

- Which `config.toml` keys should be treated as supported runtime override keys vs ignored keys for this phase (strict allowlist vs broad pass-through)?
- Should unknown/unsupported config keys fail execution, or should they be ignored with a deterministic warning?
- Should runtime `CodexOptions.config` overrides be applied only for agent/flow runs, or also for direct chat runs when an agent context is active?
- Are there any Codex config keys in current agent configs that are startup-only/no-op when passed via per-run overrides, and how should those be surfaced to users?
- Should per-agent `auth.json` propagation/seeding code be removed immediately, or retained temporarily as compatibility no-op behavior during transition?
- Should the backend device-auth route contract be changed immediately to a single-target request body, or staged with backward-compatible request parsing for one release?
- How should we handle MCP server definitions from agent config when shared `CODEX_HOME` already has overlapping MCP server definitions (override precedence and conflict policy)?

## Implementation Ideas

- Introduce a dedicated agent config loader module that parses TOML into a typed runtime override object for `CodexOptions.config` plus any validated thread options.
- Keep `buildCodexOptions` centered on shared `CODEX_HOME`, and add an optional `config` payload merge path for per-run overrides.
- Refactor Codex invocation callsites in `server/src/agents/service.ts`, `server/src/flows/service.ts`, and `server/src/chat/interfaces/ChatInterfaceCodex.ts` to pass runtime config overrides while retaining `useConfigDefaults: true` semantics.
- Update detection/auth assumptions in `server/src/providers/codexDetection.ts` and auth-seeding paths in `server/src/agents/authSeed.ts` / discovery code to remove per-agent auth dependency.
- Simplify `POST /device-auth` contract/handler in `server/src/routes/codexDeviceAuth.ts` and corresponding frontend API typing in `client/src/api/codex.ts`.
- Simplify `client/src/components/codex/CodexDeviceAuthDialog.tsx` and remove target-selector wiring from `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx`.
- Upgrade `@openai/codex-sdk` and validate `CodexOptions`/`ThreadOptions` behavior against latest docs; confirm no regressions in run-stream event handling and thread resume behavior.
- Expand unit/integration coverage for: shared home detection, runtime config mapping, agent/flow behavior parity, device-auth API contract, and simplified frontend auth UX.
- Add focused regression tests for compatibility of existing agent `config.toml` examples under `codex_agents/*`.
- Add explicit logging markers for runtime config source selection and sanitized applied override metadata (without sensitive values) to aid diagnosis.

