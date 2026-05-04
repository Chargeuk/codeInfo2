# Story 0000057 – Users can run agents with provider-neutral runtime config and codeinfo_agents folder support

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

When tasks are later added to this story, use this section contract:

- `Subtasks` are for implementation and proof-authoring work that can be completed before formal proof runs.
- `Testing` is for automated proof execution only.
- `Manual Testing Guidance` is optional, non-blocking guidance for the manual testing agent and must not contain checkboxes.
- Outside `Additional Repositories`, use repository-relative paths, repository aliases, commands, environment-variable names, or other portable lookup directions instead of absolute filesystem paths.
- End each task's `Subtasks` section with separate lint and prettier or format-check subtasks in that order, and end each `Testing` section with separate lint and prettier or format-check steps in that order.
- Keep test-enablement seams such as auth bypasses, seeded identities, mocked providers, or alternate login helpers in test-only harnesses, fixtures, or test configuration rather than in shipped production behavior.
- Prefer the unmodified human Docker stack for manual testing whenever repository evidence shows it is runnable, and only fall back to minimal test-only enablement when the normal stack is not enough.
- Keep automated screenshots and similar generated proof artifacts in ignored artifact locations rather than tracked repository files.
- For any task, put manual-testing screenshots, logs, and similar proof artifacts in `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and do not commit them.
- If manual testing for the story will write task-level proof artifacts into `codeInfoTmp/` and `.gitignore` does not already ignore that scratch path, add or update that ignore rule before later proof depends on it.
- For story closeout, state that a later promotion step curates durable final proof into `codeInfoStatus/manual-proof/<story-number>/`.
- When Manual Testing Guidance mentions Playwright MCP screenshots, state that screenshots are captured in the Playwright output directory first and then transferred into the target repository task-scoped scratch destination. `CODEINFO_ROOT` is the harness root and may expose staging paths such as `$CODEINFO_ROOT/playwright-output-local`, but it is not the target artifact root unless the active plan is in the harness repository.
- When useful, recommend deterministic manual-proof basenames such as `proof-01-<slug>.png`, `support-console.txt`, `support-network.json`, and `support-<slug>.log` so later closeout can promote artifacts without guesswork.

### Description

CodeInfo2 already supports three chat providers in the product: Codex, GitHub Copilot, and LM Studio. The chat stack has already moved toward a provider-neutral model, but the agent, command, and flow runtime is still shaped around Codex. Today, agent execution still assumes a Codex-oriented base runtime config, still discovers agents from `codex_agents`, and still uses Codex-only execution paths even when a checked-in agent config appears to target another model backend.

From a user's point of view, this creates two product problems. First, users can select Copilot or LM Studio in the chat product, but they cannot configure one agent to run on Copilot and another to run on LM Studio through the same first-class contract. Second, the folder and runtime naming still advertise the older Codex-only shape even though the product is now clearly broader than that.

This story introduces a provider-neutral agent runtime contract built from layered config files with clear precedence. The lowest-precedence layer is a new repo-local `codeinfo_config/config.toml`. Above that sits the selected provider's base `config.toml`, such as `codex/config.toml`, `copilot/config.toml`, or `lmstudio/config.toml`. The highest-precedence runtime file is either the selected provider's `chat/config.toml` for chat-driven surfaces or the selected agent's own `config.toml` for agent-driven surfaces. Higher-precedence values replace lower-precedence values.

For agents, the selected provider comes from a new app-owned metadata field inside the agent's own `config.toml`: `codeinfo_provider`. If that field is absent, the provider defaults to `codex` so today's checked-in agents continue to work without manual migration. Chat runtime config does not need the same field because the provider is already selected through the chat contract rather than through an agent definition.

This story also shifts the preferred agent folder name from `codex_agents` to `codeinfo_agents` while keeping the old folder name supported for compatibility. The new folder always wins when both are present, and that precedence must apply consistently in local discovery and in cross-repository command lookup. The same compatibility rule applies to environment naming: a new neutral agent-home contract can be introduced, but `CODEINFO_CODEX_AGENT_HOME` must remain supported as a legacy alias.

The user's chosen scope for this story is intentionally config-driven. This story does not add new agent-page controls, does not add new MCP input overrides for agent provider selection, and does not introduce an extra manual override layer on top of the merged config. The runtime should simply execute according to the merged `config.toml` values.

One additional requirement is that the `code_info` MCP tool should stop biasing callers toward Codex. The tool definition should treat `provider` as an explicit override only, and agents should omit it unless the user has specifically asked for a provider. Omitted-provider behavior can still follow the server's normal default-provider resolution, but the tool contract itself should no longer encourage or imply a Codex-first caller habit.

### Acceptance Criteria

- A new repo-level base runtime config exists at `codeinfo_config/config.toml`.
- `codeinfo_config/config.toml` follows the repo-local runtime-config pattern and remains out of source control.
- Agent and chat runtime config resolution follows this precedence order, with higher entries overriding lower entries:
  - `codeinfo_config/config.toml`
  - `<provider>/config.toml`
  - `<provider>/chat/config.toml` for chat runtime resolution
  - `<agentRoot>/<agentName>/config.toml` for agent runtime resolution
- Higher-precedence scalar or array values replace lower-precedence values rather than attempting partial merges.
- Named tables still merge by key, with higher-precedence entries replacing conflicting lower-precedence entries.
- Agent configs can declare `codeinfo_provider = "codex" | "copilot" | "lmstudio"`.
- If `codeinfo_provider` is absent from an agent config, the runtime defaults that agent to `codex`.
- Chat runtime config does not require or depend on `codeinfo_provider`.
- If `codeinfo_provider` appears in a config surface where it does not apply, the runtime ignores it with a warning instead of failing validation.
- The runtime strips app-owned `codeinfo_*` metadata before passing provider config into the relevant provider SDK or harness.
- `codex/config.toml` remains supported as the Codex provider base config.
- `copilot/config.toml` becomes a first-class provider base config resolved in the same product-owned way as Codex base config.
- `lmstudio/config.toml` becomes a first-class provider base config resolved in the same product-owned way as Codex base config.
- Agent execution can run a Codex agent, a Copilot agent, or an LM Studio agent using the merged runtime config and the agent's selected provider.
- Existing commands and flows that execute agents continue to work after provider-neutral runtime selection is introduced.
- The preferred agent folder name becomes `codeinfo_agents`.
- The legacy `codex_agents` folder remains supported for backward compatibility.
- A legacy environment variable such as `CODEINFO_CODEX_AGENT_HOME` remains supported as an alias to the preferred neutral agent-home contract.
- When both `codeinfo_agents` and `codex_agents` are present for the same lookup path, `codeinfo_agents` always wins.
- Cross-repository command lookup uses the same folder precedence contract as local agent discovery.
- This story does not add new GUI-level agent provider overrides.
- This story does not add new MCP-level agent provider overrides beyond the merged config behavior.
- The `code_info` MCP tool definition describes `provider` as an explicit optional override rather than as a defaulted Codex-oriented field.
- Agents calling `code_info` omit `provider` unless the user explicitly asks for a provider-specific run.
- Tests cover the layered merge precedence, `codeinfo_provider` defaulting, provider-specific agent execution, folder precedence, compatibility fallback to `codex_agents`, and `code_info` caller-contract changes.

### Out Of Scope

- Adding new agent-page controls that let users override provider, model, or provider-specific runtime flags by hand.
- Adding new MCP request fields that override agent provider selection outside the merged config contract.
- Turning chat runtime selection into an agent-style `codeinfo_provider` contract.
- Requiring every provider SDK to natively consume the exact same raw TOML shape directly.
- Moving or redesigning provider authentication secrets or stored auth state beyond what is required for the new config layering.
- Inventing a new manual override layer above `codeinfo_config/config.toml`, provider `config.toml`, and chat or agent runtime config.
- Removing `codex_agents` support in this story.
- Introducing new provider types beyond Codex, Copilot, and LM Studio.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

- Later manual proof should cover at least one agent configured for each provider, plus one scenario where both `codeinfo_agents` and `codex_agents` exist so precedence can be observed honestly.
- Later manual proof should include at least one command or flow path that resolves agent-owned files from another repository root, because folder precedence must match there as well.
- When proving the `code_info` change later, prefer artifact capture that shows the actual request payload or observable provider-selection behavior so the omission contract is visible.

### Questions

None. `codeinfo_config/config.toml` remains out of source control, a legacy env alias such as `CODEINFO_CODEX_AGENT_HOME` remains supported, and inapplicable `codeinfo_provider` values are ignored with a warning.

## Implementation Ideas

- Add a new shared config helper for repo-local `codeinfo_config/config.toml` and refactor runtime resolution so it can compose three layers instead of only the current Codex base-plus-runtime contract.
- Promote provider selection for agents into app-owned metadata by reading `codeinfo_provider` from the agent `config.toml` before the full merge runs.
- Extend the existing `codexConfig` bootstrap pattern to first-class provider base configs for Copilot and LM Studio, likely with a dedicated LM Studio config helper and an expanded Copilot config helper.
- Keep the merged runtime contract portable by treating `codeinfo_*` keys as repository-owned metadata that is removed before provider SDK construction.
- Update agent discovery, agent execution, command lookup, and flow-owned agent execution together so provider and folder selection stay consistent across all agent surfaces.
- Support a new neutral agent-home contract without breaking existing `CODEINFO_CODEX_AGENT_HOME` users by resolving the legacy variable as an alias during the migration window.
- Centralize folder precedence in one reusable helper so local discovery and cross-repository lookups cannot drift apart.
- Update the `code_info` tool definition and its tests so the contract encourages omitted `provider` by default, while still allowing explicit provider selection when the user requests it.
- Treat inapplicable `codeinfo_provider` usage as a warning path so invalid placement is visible in logs without blocking the wider runtime contract.
- Add targeted proof first around merge precedence and metadata stripping, then broader proof around provider-specific agent execution and folder-compatibility lookup.
