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

This story introduces a provider-neutral agent runtime contract built from layered config files with clear precedence. The lowest-precedence layer is a new repo-local `codeinfo_config/config.toml`. Above that sits the selected provider's base `config.toml`, such as `codex/config.toml`, `copilot/config.toml`, or `lmstudio/config.toml`. The highest-precedence runtime file is either the selected provider's `chat/config.toml` for chat-driven surfaces or the selected agent's own `config.toml` for agent-driven surfaces. Higher-precedence values replace lower-precedence values. If `codeinfo_config/config.toml` has not been created yet, the runtime should continue cleanly without trying to auto-create repository files at startup. Provider base config files that this story owns, including `copilot/config.toml` and `lmstudio/config.toml`, should be created during shared startup bootstrap rather than waiting for first use.

For agents, the selected provider comes from a new app-owned metadata field inside the agent's own `config.toml`: `codeinfo_provider`. If that field is absent, the provider defaults to `codex` so today's checked-in agents continue to work without manual migration. If the field is present but invalid, the product should warn when the user opens that affected agent rather than silently defaulting to Codex. If a configured fallback provider is actually usable for that run, the agent should remain runnable and the warning should explain which fallback will be used. If no usable fallback provider is available, the product should show a clear error and disable that agent, but the agent should remain visible in discovery surfaces so users can still inspect the warning and understand why it cannot run. This invalid-provider path should use the same fallback order and availability checks as provider-unavailable agent runs. Chat runtime config does not need the same field because the provider is already selected through the chat contract rather than through an agent definition.

This story also introduces a shared provider-neutral repository execution-context contract for chat and agent runs. Shared code should resolve repository execution context once and pass the resulting context to whichever provider executes the run. That shared context should always include the selected repository path as runtime metadata when a `workingFolder` has been chosen and should also include a resolved runtime working-directory override for providers that support it directly. When no `workingFolder` has been selected, the common execution-context resolver should still choose the effective default execution root using the same precedence Codex uses today, rather than letting each provider fall back to its own unrelated process working directory. Codex and Copilot should consume that runtime working-directory value in this story. LM Studio should receive the same shared context even if its current provider implementation only uses the repository metadata or provider-specific tools rather than the same direct working-directory mechanism.

When an agent explicitly selects a provider that is unavailable, this story should not stop at the first failure. Instead, agent execution should evaluate a configurable fallback provider order from a new comma-separated env var in `server/.env`, with a default order of `codex,copilot`. `lmstudio` should be a valid value in that env var, but it should not appear in the default list. That env var should be normalized by trimming entries, dropping blanks, removing duplicates, and ignoring unknown provider ids with warnings. If normalization leaves no usable configured providers, the runtime should fall back to the default order rather than failing startup. This fallback rule applies only to direct agent runs and flow-owned agent runs; it does not change normal chat behavior. The fallback rule is also a separate recovery step, not part of the normal agent config merge precedence. If the selected provider is still available but the merged model is missing or invalid for that provider, the runtime should stay on that provider and resolve a fallback model there rather than entering the cross-provider fallback chain. If the runtime does need to fall back to another provider, it should try the same model first when that model exists on the fallback provider, then the model defined in that provider's chat config, and then the default model for that provider. Shared settings should carry forward across that fallback attempt, while provider-specific settings that the fallback provider cannot use should be ignored with warnings rather than making the fallback fail for that reason alone. That cross-provider fallback is per-run only: each new run should start again from the agent's configured provider and only fall back if the current run still needs recovery. When a fallback run succeeds, the conversation and any user-visible execution metadata should show the provider and model that actually ran, while also keeping a warning that fallback happened from the originally requested provider. If the originally failed provider also appears in the configured fallback list, it should be skipped rather than tried again. If no configured fallback provider can run, the request should fail clearly. Each fallback event should produce both warning logs and warning-capable GUI or API messages so users can see what happened.

This story also shifts the preferred agent folder name from `codex_agents` to `codeinfo_agents` while keeping the old folder name supported for compatibility. The new folder always wins when both are present, and that precedence must apply consistently in local discovery and in cross-repository command lookup. If the same agent exists in both folders, the ignored legacy copy should produce a warning that is both logged and surfaced in the agent list payload plus the selected agent's info or details surface. Equivalent flow-owned agent warning surfaces should reuse the same warning data through the existing flow info or details surface when that surface already exists. The same compatibility rule applies to environment naming: a new neutral agent-home contract can be introduced through `CODEINFO_AGENT_HOME`, but `CODEINFO_CODEX_AGENT_HOME` must remain supported as a legacy alias, and `CODEINFO_AGENT_HOME` should win when both are set.

The user's chosen scope for this story is intentionally config-driven. This story does not add new agent-page controls, does not add new MCP input overrides for agent provider selection, and does not introduce an extra manual override layer on top of the merged config. Normal execution should follow the merged `config.toml` values plus the shared repository execution context where a working folder has been selected. For direct agent runs and flow-owned agent runs only, the runtime may also apply the configured provider-fallback recovery policy after the selected provider fails or an invalid `codeinfo_provider` is detected.

One additional requirement is that the repo-owned `code_info` MCP definition and repo-owned instruction surfaces in this codebase should stop biasing callers toward Codex or toward any explicit model choice. The tool definition should treat both `provider` and `model` as explicit override fields only, and agents should omit them unless the user has specifically asked for a provider-specific or model-specific run. Omitted-field behavior can still follow the server's normal shared default-resolution contract, but the repo-owned tool contract and repo-owned prompts in this repository should no longer encourage or imply a Codex-first or model-pinning caller habit. In addition, omitted-provider or non-Codex execution must remain repository-grounded when the repository is available to the harness; provider neutrality is not complete if a non-Codex `code_info` execution loses repository context that the Codex path currently receives through working-directory or runtime wiring.

### Acceptance Criteria

- The runtime supports a repo-level base runtime config at `codeinfo_config/config.toml`.
- `codeinfo_config/config.toml` follows the repo-local runtime-config pattern and remains out of source control.
- If `codeinfo_config/config.toml` is missing, the runtime continues cleanly without auto-creating the file.
- Agent and chat runtime config resolution follows this precedence order, with higher entries overriding lower entries:
  - `codeinfo_config/config.toml`
  - `<provider>/config.toml`
  - `<provider>/chat/config.toml` for chat runtime resolution
  - `<agentRoot>/<agentName>/config.toml` for agent runtime resolution
- Higher-precedence scalar or array values replace lower-precedence values rather than attempting partial merges.
- Named tables still merge by key, with higher-precedence entries replacing conflicting lower-precedence entries.
- Agent configs can declare `codeinfo_provider = "codex" | "copilot" | "lmstudio"`.
- If `codeinfo_provider` is absent from an agent config, the runtime defaults that agent to `codex`.
- If `codeinfo_provider` is present but invalid, the product warns when the user opens that affected agent instead of silently defaulting to `codex`.
- If `codeinfo_provider` is invalid but a configured fallback provider is actually usable for that run, the agent remains runnable and the warning includes the fallback provider that will be used.
- If `codeinfo_provider` is invalid and no configured fallback provider is available, the product shows a clear error and disables that agent.
- If `codeinfo_provider` is invalid and no configured fallback provider is available, the affected agent remains visible in discovery surfaces and is marked disabled with a clear reason.
- Invalid `codeinfo_provider` handling uses the same fallback order and availability checks as provider-unavailable agent runs.
- Chat runtime config does not require or depend on `codeinfo_provider`.
- If `codeinfo_provider` appears in a config surface where it does not apply, the runtime ignores it with a warning instead of failing validation.
- The runtime strips app-owned `codeinfo_*` metadata before passing provider config into the relevant provider SDK or harness.
- `codex/config.toml` remains supported as the Codex provider base config.
- `copilot/config.toml` becomes a first-class provider base config resolved in the same product-owned way as Codex base config.
- `lmstudio/config.toml` becomes a first-class provider base config resolved in the same product-owned way as Codex base config.
- `copilot/config.toml` is bootstrapped in the same product-owned way as `codex/config.toml`.
- `lmstudio/config.toml` is bootstrapped in the same product-owned way as `codex/config.toml`.
- `copilot/config.toml` and `lmstudio/config.toml` are created during shared startup bootstrap rather than waiting for first provider use.
- Shared code resolves repository execution context once and passes a provider-neutral execution payload into every chat run, agent run, flow-owned agent run, and `code_info` execution.
- The shared repository execution context includes the selected repository path as runtime metadata.
- The shared repository execution context includes a resolved runtime working-directory override for providers that support it directly.
- When no `workingFolder` is selected, the shared execution-context resolver still produces the effective default execution root using the same precedence the Codex provider uses today.
- Chat execution uses the shared repository execution-context contract for Codex, Copilot, and LM Studio.
- Agent execution can run a Codex agent, a Copilot agent, or an LM Studio agent using the merged runtime config and the agent's selected provider.
- Agent execution uses the same shared repository execution-context contract for Codex, Copilot, and LM Studio.
- Provider fallback is an agent-only recovery rule for direct agent runs and flow-owned agent runs; it does not apply to normal chat execution.
- If an agent's selected provider is unavailable, agent execution evaluates fallback providers using a new comma-separated env var in `server/.env` named `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`.
- `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` defaults to `codex,copilot` in `server/.env`.
- `lmstudio` is a valid `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` value but is not part of the default fallback list.
- `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` is normalized by trimming entries, dropping blanks, removing duplicates, and ignoring unknown provider ids with warnings.
- If `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` normalizes to no usable configured providers, agent execution falls back to the default order of `codex,copilot` rather than failing startup.
- Provider fallback is a separate recovery step and does not change the normal agent runtime config precedence.
- If the selected provider is available but the merged model is missing or invalid for that provider, runtime stays on that provider and resolves a fallback model there instead of entering cross-provider fallback.
- A fallback provider counts as available only when it is actually usable for the current run, not merely because it is listed in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`.
- If provider fallback runs, the model selection order is: the same model on the fallback provider when available, then the model defined in that fallback provider's chat config, then that fallback provider's default model.
- If provider fallback runs, shared settings remain in effect and provider-specific settings the fallback provider cannot use are ignored with warnings rather than failing fallback for that reason alone.
- Cross-provider fallback is per-run only; each new run starts from the agent's configured provider again rather than becoming sticky on the last fallback provider.
- If the originally failed provider also appears in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, the runtime skips it and moves to the next configured provider.
- If no configured fallback provider can execute the agent run, the run fails clearly.
- Provider fallback emits both warning logs and warning-capable API or GUI warnings.
- Agent fallback warnings appear in the agent list payload and in the selected agent's info or details surface.
- Equivalent flow-owned agent warning surfaces reuse the same warning data through the existing flow info or details surface when that surface already exists.
- Agents disabled because no usable provider remains stay visible in the agent list and details surfaces rather than disappearing from discovery.
- After a fallback run succeeds, the conversation and user-visible execution metadata show the provider and model that actually executed, plus a warning that fallback happened from the originally requested provider.
- Existing commands and flows that execute agents continue to work after provider-neutral runtime selection is introduced.
- Flow-owned agent execution uses the same shared repository execution-context contract as direct agent execution.
- The current Codex-specific default-working-directory selection logic is removed from provider-specific execution code and replaced by the shared execution-context resolver.
- Codex consumes the shared runtime working-directory override.
- Copilot consumes the shared runtime working-directory override.
- LM Studio receives the shared repository execution context even if its provider-specific implementation does not use the same direct runtime working-directory mechanism as Codex or Copilot.
- The preferred agent folder name becomes `codeinfo_agents`.
- The legacy `codex_agents` folder remains supported for backward compatibility.
- `CODEINFO_AGENT_HOME` becomes the preferred neutral agent-home env var.
- `CODEINFO_CODEX_AGENT_HOME` remains supported as a legacy alias to `CODEINFO_AGENT_HOME`.
- If both `CODEINFO_AGENT_HOME` and `CODEINFO_CODEX_AGENT_HOME` are set, `CODEINFO_AGENT_HOME` wins and the legacy alias is treated as a fallback only.
- When both `codeinfo_agents` and `codex_agents` are present for the same lookup path, `codeinfo_agents` always wins.
- When the same agent is found in both folders, the runtime logs a warning and also surfaces that warning through existing warning-capable API or UI responses.
- Duplicate-agent warnings appear in the agent list payload and in the selected agent's info or details surface.
- Equivalent flow-owned agent warning surfaces reuse the same duplicate-agent warning data through the existing flow info or details surface when that surface already exists.
- Cross-repository command lookup uses the same folder precedence contract as local agent discovery.
- This story does not add new GUI-level agent provider overrides.
- This story does not add new MCP-level agent provider overrides beyond the merged config behavior.
- The `code_info` MCP tool definition describes `provider` as an explicit optional override rather than as a defaulted Codex-oriented field.
- The `code_info` MCP tool definition describes `model` as an explicit optional override rather than as a field callers should normally populate.
- Repo-owned instruction surfaces in this codebase that teach agents how to use `code_info` are updated to match the explicit-override contract for `provider` and `model`.
- Agents calling `code_info` omit `provider` unless the user explicitly asks for a provider-specific run.
- Agents calling `code_info` omit `model` unless the user explicitly asks for a model-specific run.
- When both `provider` and `model` are omitted from `code_info`, provider and model resolution follow the normal shared server default-selection contract.
- When `provider` is provided and `model` is omitted, `code_info` resolves the default model for that explicitly selected provider.
- When `model` is provided and `provider` is omitted, `code_info` uses the normal shared provider-selection contract and applies the explicit model as an override for the resolved provider.
- If an explicit `model` does not fit the chosen or resolved provider, `code_info` fails clearly instead of silently trying a different provider.
- `code_info` remains repository-grounded when `provider` is omitted.
- If `code_info` executes on Copilot or LM Studio, it receives equivalent repository context needed to answer local-repository questions through provider-appropriate runtime wiring, tools, or both.
- Omitting `provider` from `code_info` must not degrade repository-local questions into a non-grounded fallback path when the repository is available to the harness.
- Tests cover the layered merge precedence, `codeinfo_provider` defaulting, provider-specific agent execution, folder precedence, compatibility fallback to `codex_agents`, and `code_info` caller-contract changes, including omitted-provider, omitted-model, explicit provider-only, explicit model-only, and explicit provider-plus-model behavior.

### Out Of Scope

- Adding new agent-page controls that let users override provider, model, or provider-specific runtime flags by hand.
- Adding new MCP request fields that override agent provider selection outside the merged config contract.
- Turning chat runtime selection into an agent-style `codeinfo_provider` contract.
- Requiring every provider SDK to natively consume the exact same raw TOML shape directly.
- Requiring every provider to consume repository context through the exact same internal SDK fields or runtime mechanism.
- Requiring LM Studio to implement an identical Codex-style working-directory model if equivalent repository-grounded behavior is achieved through provider-specific tools or runtime wiring.
- Changing the precedence rules themselves for the default execution root beyond centralizing the current Codex behavior into shared code.
- Making LM Studio consume or honor the shared runtime working-directory override directly.
- Requiring agents to populate `provider` or `model` pre-emptively for routine `code_info` calls instead of relying on the shared server default-resolution contract.
- Updating shared harness, platform, or other agent-facing metadata that lives outside this repository.
- Moving or redesigning provider authentication secrets or stored auth state beyond what is required for the new config layering.
- Inventing a new manual override layer above `codeinfo_config/config.toml`, provider `config.toml`, and chat or agent runtime config.
- Adding a second user-facing working-folder override model that differs between chat, agents, flows, or MCP tools.
- Hiding disabled agents from discovery when provider validation or provider availability fails.
- Treating recoverable formatting mistakes in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` as fatal startup errors.
- Failing provider fallback solely because the original agent config contains provider-specific settings the fallback provider cannot use.
- Entering cross-provider fallback just because the chosen provider's model is missing when that provider itself is still available.
- Making the last fallback provider sticky across later runs without a real config or user change.
- Showing only the originally requested provider and model after a fallback run when a different provider or model actually executed.
- Removing `codex_agents` support in this story.
- Introducing new provider types beyond Codex, Copilot, and LM Studio.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

- Later manual proof should cover at least one agent configured for each provider, plus one scenario where both `codeinfo_agents` and `codex_agents` exist so precedence can be observed honestly.
- Later manual proof should include at least one command or flow path that resolves agent-owned files from another repository root, because folder precedence must match there as well.
- When proving the `code_info` change later, prefer artifact capture that shows the actual request payload or observable provider-selection behavior so the omission contract is visible.
- Later manual proof should show where users see fallback and duplicate-agent warnings in the agent list and in the selected agent's info or details surface, plus the existing flow info or details warning surface used for equivalent flow-owned agent warnings when that surface exists.
- Later manual proof should show that an invalid `codeinfo_provider` warning first appears when the user opens the affected agent rather than in the initial agent list.
- Later manual proof should include one fallback run where provider-specific settings from the original provider are ignored with a visible warning so the fallback still succeeds.
- Later manual proof should cover a malformed `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` with blanks, duplicates, or unknown providers and show the resulting warnings plus the normalized fallback behavior.
- Later manual proof should show that an agent with no usable provider remains visible but disabled in the list and details surfaces.
- Later manual proof should include one run where the selected provider is available but its model is missing, and show that the runtime stays on that provider while resolving a fallback model there.
- Later manual proof should show that a later rerun starts from the originally configured provider again rather than staying on the prior run's fallback provider.
- Later manual proof should show that a fallback run records and displays the provider and model that actually executed, while still surfacing a warning about the originally requested provider.

### Questions

1. If a missing model is repaired on the same provider, should the next run try the original model again, or keep using the repaired model?
   - Why this is important: This decides whether model repair is a one-run recovery step or a quiet long-term change to which model the agent keeps using.
   - Best Answer: Try the original model again on the next run. That matches the repo's current pattern of re-resolving provider and model from config on each run, keeps the configured model as the source of truth, and avoids silently turning an execution-time repair into a persistent config rewrite.
   - Where this answer came from: Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`, and `server/src/test/unit/config.chatDefaults.test.ts`. External evidence from OpenAI API docs, Context7 documentation for the OpenAI API, and DeepWiki notes on `openai/openai-node`, all of which reinforce that model choice is request-owned application behavior.

2. If a run falls back away from Codex, should we keep the old Codex thread id for later reuse, or clear it?
   - Why this is important: A Codex thread id is saved Codex-only continuation state, so reusing it after another provider ran could attach later work to the wrong provider-specific thread.
   - Best Answer: Clear it when a non-Codex run is saved, and preserve thread continuation only when the execution provider is still Codex. That best matches the repo's current provider-scoped thread handling and avoids cross-provider state leakage.
   - Where this answer came from: Repo evidence in `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/routes/chat.ts`, `server/src/chat/agentFlags.ts`, `server/src/test/unit/chat-interface-run-persistence.test.ts`, and `server/src/test/integration/chat-codex.test.ts`. External evidence was not needed because the local provider-specific thread contract already provides the strongest precedent.

## Decisions

1. Decision: if `code_info` gets a model name that does not fit the chosen provider, it should fail clearly rather than trying another provider.
   - The question being addressed: Should an invalid explicit model-provider combination fail clearly or silently switch to a different provider?
   - Why the question matters: The story now allows `model` to be an explicit override, so invalid combinations need one predictable contract.
   - What the answer is: Fail clearly without silent provider switching.
   - Where the answer came from: Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/test/unit/config.chatDefaults.test.ts`, and `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`.
   - Why it is the best answer: It matches the repo's existing treatment of explicit overrides as authoritative and keeps error handling understandable for users and agents.

2. Decision: LM Studio direct use of the provided runtime working directory is out of scope for this story.
   - The question being addressed: Does LM Studio need to match Codex and Copilot working-directory behavior in this story?
   - Why the question matters: The story already expects shared execution context for every provider, but LM Studio currently uses provider-specific tooling rather than the same cwd seam.
   - What the answer is: LM Studio should remain repository-grounded through existing provider-appropriate context and tools, but consuming the shared runtime working-directory override directly is out of scope for this story.
   - Where the answer came from: Repo evidence in `server/src/lmstudio/tools.ts`, `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, and `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`. External evidence from the official `lmstudio-js` source in `packages/lms-client/src/llm/LLMGeneratorHandle.ts` and `packages/lms-shared-types/src/PluginConfigSpecifier.ts`.
   - Why it is the best answer: It keeps the story focused on provider-neutral shared context and repository-grounded behavior without forcing unsupported LM Studio parity work into the same implementation.

3. Decision: this story should update only the repo-owned `code_info` definitions and instructions in this codebase.
   - The question being addressed: Should this story update only repo-owned `code_info` instructions, or should it also update shared harness or platform metadata outside this repository?
   - Why the question matters: The story now changes how `provider` and `model` should be described and used, so we need a clear boundary for which instruction surfaces this work owns.
   - What the answer is: Limit the story to repo-owned `code_info` definitions, prompts, and docs in this repository, and leave any shared harness or platform metadata outside this repository out of scope.
   - Where the answer came from: Repo evidence in `server/src/mcp2/tools/codebaseQuestion.ts`, `AGENTS.md`, `usefulCommands.txt.md`, `docs/developer-reference.md`, and prompt files under `codex_agents/**` plus `codeinfo_markdown/**`. Additional evidence from this planning session: the runtime-facing built tool schema mirrors the repo source, but no clearly separate shared harness metadata file was identified inside this repository.
   - Why it is the best answer: It keeps Story `0000057` grounded in code and documentation this repository directly owns, while still allowing a later follow-up to align any external agent-facing metadata if needed.

4. Decision: if `codeinfo_config/config.toml` is missing, the runtime should keep running without auto-creating it.
   - The question being addressed: If `codeinfo_config/config.toml` is missing, should the app create it or just keep running without it?
   - Why the question matters: The story adds a new repo-local config layer, so startup behavior needs to be predictable for repositories that have not created that file yet.
   - What the answer is: Keep running without the file and fall back to the remaining config layers instead of auto-creating repository files at startup.
   - Where the answer came from: Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/flows/markdownFileResolver.ts`, and `server/src/workingFolders/state.ts`, plus local repo-precedent retrieval from `code_info` during this planning round.
   - Why it is the best answer: It matches this repo's normal read-if-present behavior for repo-local config, avoids surprising writes into user repositories, and keeps first-run behavior simple.

5. Decision: `CODEINFO_AGENT_HOME` should be the new neutral agent-home env var, and it should win when both agent-home env vars are set.
   - The question being addressed: What should the new neutral agent-home env var be called, and if both agent-home env vars are set, should the new one win or should the old alias still take priority?
   - Why the question matters: The story keeps `CODEINFO_CODEX_AGENT_HOME` as a legacy alias, so conflicting env values need one clear precedence rule.
   - What the answer is: Use `CODEINFO_AGENT_HOME` as the preferred neutral env var. `CODEINFO_CODEX_AGENT_HOME` remains as a legacy fallback alias, and `CODEINFO_AGENT_HOME` wins when both are set.
   - Where the answer came from: Direct repo review of this story file for the missing env-var name, plus the existing story decision that the new neutral env var should take precedence over `CODEINFO_CODEX_AGENT_HOME`.
   - Why it is the best answer: It gives the story one clear env-var name, removes Codex-specific wording from the preferred contract, and keeps the migration path predictable.

6. Decision: when the same agent appears in both folders, the warning should be logged and also surfaced through existing warning-capable API or UI responses.
   - The question being addressed: If the same agent appears in both folders, should the warning stay in logs only, or also appear in API and UI warnings?
   - Why the question matters: The story already gives `codeinfo_agents` precedence, but users still need a clear way to understand why the legacy copy was ignored.
   - What the answer is: Log the collision and also surface the warning through API or UI warning fields where those surfaces already support warnings.
   - Where the answer came from: Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/routes/chatDiscovery.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chat.ts`, `server/src/agents/types.ts`, and `client/src/pages/AgentsPage.tsx`, plus local repo-precedent retrieval from `code_info` during this planning round.
   - Why it is the best answer: It matches the repo's broader warning pattern, keeps the precedence behavior diagnosable for users, and avoids forcing routine troubleshooting through server logs alone.

7. Decision: if an agent has an invalid `codeinfo_provider`, the product should warn when the user opens that agent and keep the agent runnable when a fallback is available.
   - The question being addressed: If an agent has an invalid `codeinfo_provider`, how should that failure be shown to the user?
   - Why the question matters: `codeinfo_provider` is an explicit per-agent runtime choice, so bad values need one clear contract.
   - What the answer is: Show a warning when the user opens the affected agent instead of silently defaulting to Codex. If a configured fallback provider is available, keep the agent runnable and include the fallback provider in the warning. If no usable fallback provider is available, show a clear error and disable the agent.
   - Where the answer came from: User direction in this planning round, plus direct repo review of this story file's existing warning-surfacing and fallback requirements.
   - Why it is the best answer: It gives users the warning at the moment they are actually looking at the affected agent, still lets them keep working when recovery is possible, and only disables the agent when the runtime truly has nowhere safe to go.

8. Decision: if an agent explicitly picks a provider that is unavailable, the runtime should try a configurable fallback provider order before failing.
   - The question being addressed: If an agent explicitly picks a provider that is unavailable, should the run fail clearly or try another provider?
   - Why the question matters: Per-agent provider selection is a core part of the story, but users still need a predictable recovery path when a provider is temporarily unavailable.
   - What the answer is: Use a new comma-separated env var in `server/.env` named `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, defaulting to `codex,copilot`. `lmstudio` is a valid value in that list but is not included by default. For each fallback provider, try the same model first when available, then that provider's chat-config model, then that provider's default model. If no configured fallback provider can run, fail clearly. Emit both warning logs and warning-capable GUI or API messages when fallback occurs.
   - Where the answer came from: User direction in this planning round, plus repo evidence in `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`, `server/src/config/chatDefaults.ts`, `server/src/agents/service.ts`, and `server/src/chat/factory.ts`.
   - Why it is the best answer: It gives operators a controlled recovery path without forcing LM Studio into the default chain, keeps the behavior adjustable through env config, and makes fallback visible to both operators and users.

9. Decision: Copilot and LM Studio base config files should be auto-seeded like Codex.
   - The question being addressed: Should Copilot and LM Studio base config files be auto-seeded like Codex, or only read if they already exist?
   - Why the question matters: The story says `copilot/config.toml` and `lmstudio/config.toml` should work in the same product-owned way as `codex/config.toml`, so bootstrap behavior needs to match too.
   - What the answer is: Auto-seed them like Codex.
   - Where the answer came from: Repo evidence in `server/src/config/codexConfig.ts`, `server/src/config/runtimeConfig.ts`, `server/src/config/copilotConfig.ts`, and `server/src/config/chatDefaults.ts`, plus local repo-precedent retrieval from `code_info` during this planning round.
   - Why it is the best answer: It is the closest match to the intended “same as Codex” behavior and keeps provider base-config treatment consistent instead of making Codex special.

10. Decision: provider fallback should apply only to agents and flow-owned agent runs, not to normal chat.
   - The question being addressed: Should provider fallback happen only for agents, or should chat use it too?
   - Why the question matters: The latest fallback requirements were added for agent runs, but broader wording elsewhere could accidentally pull chat into the same behavior.
   - What the answer is: Keep provider fallback agent-only.
   - Where the answer came from: Direct repo review of this story file, especially the broad runtime wording in the Description and the agent-specific fallback wording later in the same file.
   - Why it is the best answer: It keeps chat behavior stable and limits the new fallback complexity to the feature that actually needs it.

11. Decision: the fallback model rule should be a separate recovery step and must not change the normal agent config precedence.
   - The question being addressed: Should the fallback model rule be a separate recovery step, or should it change the normal agent config precedence?
   - Why the question matters: The plan already defines a normal agent runtime precedence order, and the new fallback model rule needs to fit around that cleanly instead of rewriting it.
   - What the answer is: Keep the normal agent precedence unchanged and treat fallback model selection as an agent-only recovery rule that runs only after the selected provider is unavailable.
   - Where the answer came from: Direct repo review of this story file, especially the agent runtime precedence list in Acceptance Criteria and the newer fallback-model wording in the Description and Acceptance Criteria.
   - Why it is the best answer: It resolves the current contradiction cleanly and keeps the plan easier to implement and explain.

12. Decision: if the failed provider also appears in the fallback env var, the runtime should skip it and move to the next provider.
   - The question being addressed: If the failed provider is also listed in the fallback env var, should it be skipped or tried again?
   - Why the question matters: The default fallback order starts with `codex,copilot`, so a Codex failure could otherwise retry Codex inside the fallback loop.
   - What the answer is: Skip the failed provider and continue to the next configured fallback provider.
   - Where the answer came from: Direct repo review of this story file, especially the new `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` wording and the default order now recorded in the story.
   - Why it is the best answer: It avoids pointless retries, keeps the fallback chain easier to understand, and reduces wasted recovery time.

13. Decision: `codeinfo_config/config.toml` should be optional rather than required in every repository.
   - The question being addressed: Should `codeinfo_config/config.toml` be optional, or should every repository be expected to have one?
   - Why the question matters: The story currently says the file exists, but also says the runtime should continue cleanly if it is missing.
   - What the answer is: Treat it as optional. The runtime supports the file when a repository chooses to add it, but does not require it to exist before the story works.
   - Where the answer came from: Direct repo review of this story file, especially the acceptance criteria that currently say both “exists” and “continues cleanly if missing.”
   - Why it is the best answer: It resolves the contradiction, matches the rest of the story's repo-local behavior, and keeps adoption easier for repositories that have not created the file yet.

14. Decision: agent fallback and duplicate-agent warnings should appear in the agent list payload and in the selected agent's info or details surface.
   - The question being addressed: Where should users see agent fallback and duplicate-agent warnings?
   - Why the question matters: The story already requires these warnings to reach the GUI and API, but users still need a clear and predictable place to see them.
   - What the answer is: Show the warnings in the agent list payload and in the selected agent's info or details surface, and reuse the same warning data through the existing flow info or details surface for equivalent flow-owned agent warnings when that surface already exists.
   - Where the answer came from: User direction in this planning round, plus direct repo review of this story file's earlier warning-visibility wording.
   - Why it is the best answer: It lets users see the warning both when choosing an agent and when reviewing that agent's details, without inventing a brand-new warning surface just for this story.

15. Decision: `copilot/config.toml` and `lmstudio/config.toml` should be created during shared startup bootstrap rather than waiting for first use.
   - The question being addressed: If `copilot/config.toml` or `lmstudio/config.toml` is missing, should startup create it, or should the app wait until that provider is first used?
   - Why the question matters: The story already says those provider base config files should be bootstrapped like Codex, but it still needed a clear timing rule.
   - What the answer is: Create them during startup as part of one shared provider-config bootstrap step.
   - Where the answer came from: Repo evidence in `server/src/index.ts`, `server/src/config/codexConfig.ts`, `server/src/config/runtimeConfig.ts`, and `server/src/test/unit/copilotSeedBootstrap.test.ts`, plus earlier decisions already recorded in this plan that Copilot and LM Studio base config files should be auto-seeded like Codex.
   - Why it is the best answer: It is the closest match to the current Codex behavior, keeps provider bootstrap timing predictable, and avoids hiding configuration side effects behind first use.

16. Decision: an invalid `codeinfo_provider` warning should first appear when the user opens the affected agent, not in the initial agent list.
   - The question being addressed: Should an invalid `codeinfo_provider` warning appear as soon as the agent list loads, or only after the user opens that agent?
   - Why the question matters: The story already said the user should be warned, but it needed a precise and consistent rule for when that warning first becomes visible.
   - What the answer is: Show the warning when the user opens the affected agent. Do not surface that specific warning in the initial agent list just because the agent exists there.
   - Where the answer came from: User direction in this planning round, plus the story's earlier distinction between broad list-level warnings and agent-specific details surfaces.
   - Why it is the best answer: It keeps the list view quieter, limits this warning to the agent the user is actively inspecting, and still surfaces the problem before the user tries to run the affected agent.

17. Decision: flow-owned agent warnings should reuse the existing flow info or details surface rather than adding a new warning area.
   - The question being addressed: For flow-owned agent warnings, should the story reuse the existing flow info or details UI, or add a brand-new warning area?
   - Why the question matters: The story already wanted equivalent flow-owned warning surfaces, but it needed a clearer implementation shape.
   - What the answer is: Reuse the existing flow info or details surface when it already exists.
   - Where the answer came from: Repo evidence in `client/src/pages/FlowsPage.tsx`, especially the existing `flow-warnings` block inside the flow info popover, plus user direction in this planning round.
   - Why it is the best answer: It keeps warning behavior consistent with the current flow UI and avoids unnecessary new UI work for this story.

18. Decision: provider fallback should ignore settings meant only for the original provider rather than fail the run for that reason alone.
   - The question being addressed: If fallback switches providers, should it ignore settings meant for the original provider, or fail the run?
   - Why the question matters: Without a clear rule, a Codex-only setting could make an otherwise healthy Copilot or LM Studio fallback fail for a confusing reason.
   - What the answer is: Keep the shared settings, ignore provider-specific settings the fallback provider cannot use, and emit warnings for anything dropped.
   - Where the answer came from: User direction in this planning round. Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/config/codexEnvDefaults.ts`, and `planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md`. External evidence from the TOML v1.0.0 spec at `toml.io`, which leaves key semantics to the application.
   - Why it is the best answer: It matches this repo's warning-first config normalization style, preserves fallback as a recovery path, and avoids cascading one provider problem into another avoidable failure.

19. Decision: malformed fallback env values should be normalized with warnings instead of treated as fatal errors.
   - The question being addressed: If the fallback env var has blank, duplicate, or unknown providers, should we warn and clean it up, or treat it as an error?
   - Why the question matters: Operators will edit this env var by hand, so the story needs one predictable rule for common mistakes.
   - What the answer is: Trim entries, drop blanks, remove duplicates, ignore unknown providers with warnings, and use the default fallback order only if nothing usable remains after normalization.
   - Where the answer came from: User direction in this planning round. Repo evidence in `server/src/config/codexEnvDefaults.ts`, `server/src/config/chatDefaults.ts`, and `planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md`. External evidence from Node.js environment-variable docs, Context7 documentation for `nodejs/node`, and DeepWiki notes on `nodejs/node`, all of which show that env values arrive as strings and application-level normalization belongs to the app.
   - Why it is the best answer: It matches existing repo env parsing patterns, keeps operator-facing behavior predictable, and still makes the bad config visible through warnings.

20. Decision: agents with no usable provider should stay visible but disabled rather than disappear from discovery.
   - The question being addressed: If no usable provider is left, should the agent stay visible but disabled, or disappear from the agent list?
   - Why the question matters: Users need a clear and stable way to understand why an agent cannot run without thinking it vanished or was deleted.
   - What the answer is: Keep the agent visible, mark it disabled, and show the reason through warnings or details surfaces.
   - Where the answer came from: User direction in this planning round. Repo evidence in `server/src/agents/types.ts`, `client/src/components/agents/AgentsComposerPanel.tsx`, and `server/src/config/chatDefaults.ts`.
   - Why it is the best answer: It aligns with the repo's existing agent API and UI shape, preserves debuggability, and keeps discovery behavior predictable for users.

21. Decision: model repair stays on the selected provider instead of entering cross-provider fallback.
   - The question being addressed: If the chosen provider is up but its model is missing, should the runtime stay on that provider or switch providers?
   - Why the question matters: A bad model name is a common operator mistake, and the story already treats provider fallback as a separate recovery path.
   - What the answer is: Stay on the selected provider and resolve a fallback model there instead of entering the cross-provider fallback chain.
   - Where the answer came from: User direction in this planning round. Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`, and `design.md`. External evidence from OpenAI API docs and DeepWiki notes on `openai/openai-node`, both of which show that model selection is application-owned within the chosen provider rather than something the SDK auto-switches across providers.
   - Why it is the best answer: It keeps explicit provider choice authoritative, matches the story's current separation between provider fallback and normal model resolution, and avoids silently changing providers for what is really a provider-local model issue.

22. Decision: cross-provider fallback is per-run only and does not become sticky across later runs.
   - The question being addressed: If one run falls back, should the next run try the original provider again, or keep using the fallback provider?
   - Why the question matters: This decides whether fallback is a one-run recovery step or a sticky provider change that silently reshapes later agent behavior.
   - What the answer is: Try the original provider again on the next run. Cross-provider fallback is per-run only.
   - Where the answer came from: User direction in this planning round. Repo evidence in this story's Description, Acceptance Criteria, and Decision 11, plus local runtime-persistence evidence in `server/src/routes/chat.ts` and `server/src/mongo/repo.ts` showing why this needed to be decided explicitly. External evidence from OpenAI API docs and DeepWiki notes on `openai/openai-node`, which reinforce that provider and model choice are request-owned application decisions.
   - Why it is the best answer: It preserves the agent's configured provider as the source of truth, keeps fallback aligned with the story's existing recovery-step framing, and prevents silent long-term drift away from the configured provider.

23. Decision: fallback runs should display and persist the provider and model that actually executed.
   - The question being addressed: After a fallback run, should the conversation show the provider that actually ran, or the provider originally requested?
   - Why the question matters: Users and later runtime code need one honest source for what really executed, especially when warnings, thread reuse, and later debugging depend on it.
   - What the answer is: Show and persist the provider and model that actually executed, and also keep a warning that fallback happened from the originally requested provider.
   - Where the answer came from: User direction in this planning round. Repo evidence in `server/src/routes/chat.ts`, `server/src/mongo/conversation.ts`, and `server/src/mongo/repo.ts`.
   - Why it is the best answer: It matches the repo's existing conversation metadata pattern, keeps visible state truthful, and still preserves the user's understanding of why the fallback happened.

## Implementation Ideas

- Add a new shared config helper for repo-local `codeinfo_config/config.toml` and refactor runtime resolution so it can compose three layers instead of only the current Codex base-plus-runtime contract.
- Treat `codeinfo_config/config.toml` as an optional read-if-present layer so startup falls back cleanly when repositories have not created the file yet.
- Promote provider selection for agents into app-owned metadata by reading `codeinfo_provider` from the agent `config.toml` before the full merge runs.
- Extend the existing `codexConfig` bootstrap pattern to first-class provider base configs for Copilot and LM Studio, likely with a dedicated LM Studio config helper and an expanded Copilot config helper, and run that provider-base bootstrap during shared startup rather than waiting for first provider use.
- Surface invalid `codeinfo_provider` warnings when the user opens the affected agent, include the fallback provider when one is available, and only disable the agent when no usable fallback provider exists.
- Keep the merged runtime contract portable by treating `codeinfo_*` keys as repository-owned metadata that is removed before provider SDK construction.
- Extract the current Codex default-working-directory resolution logic into a shared repository execution-context helper that resolves both selected-working-folder and no-working-folder cases, then returns provider-neutral runtime metadata plus any resolved runtime working-directory override.
- Update agent discovery, agent execution, command lookup, and flow-owned agent execution together so provider and folder selection stay consistent across all agent surfaces.
- Use that shared repository execution-context helper in the chat route, direct agent execution, flow-owned agent execution, and `code_info` execution so provider behavior cannot drift by surface.
- Let provider implementations consume the shared repository execution context according to their own capabilities: Codex and Copilot should use the runtime working-directory override directly, while LM Studio may initially rely on repository metadata, provider-specific tools, or later working-directory-capable wiring.
- Add targeted proof that Copilot chat and Copilot-backed agent execution actually receive and use the selected working folder, because that is the main current product gap.
- Add a shared provider-fallback resolver for agent execution that reads `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, applies the configured provider order, and records warning metadata whenever a fallback provider is used.
- Normalize `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` before availability checks by trimming entries, dropping blanks, removing duplicates, and warning on unknown providers, then fall back to the default order if nothing usable remains.
- Keep that fallback resolver scoped to direct agent runs and flow-owned agent runs so normal chat continues to use its existing behavior.
- Keep provider-local model repair separate from cross-provider fallback so a missing model on an otherwise available provider resolves to a fallback model on that same provider first.
- Reuse provider-model discovery so fallback acts as a separate recovery step: try the same model on the next provider first, then that provider's chat-config model, and finally that provider's default model before moving on or failing.
- Filter provider-specific runtime settings before constructing the fallback provider so shared settings survive while incompatible provider-only settings are dropped with warnings.
- Skip the originally failed provider if it also appears in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` rather than retrying it inside the fallback loop.
- Re-resolve the agent's configured provider at the start of each new run so a previous fallback does not become sticky by accident.
- Support a new neutral agent-home contract without breaking existing `CODEINFO_CODEX_AGENT_HOME` users by resolving the legacy variable as an alias during the migration window.
- Resolve `CODEINFO_AGENT_HOME` ahead of `CODEINFO_CODEX_AGENT_HOME` so the legacy name behaves as a fallback compatibility alias rather than a competing primary setting.
- Centralize folder precedence in one reusable helper so local discovery and cross-repository lookups cannot drift apart.
- Surface fallback and duplicate-agent warnings through the agent list payload and the selected agent's info or details surface, and reuse the same warning data through the existing flow info or details surface for equivalent flow-owned agent warnings when that surface already exists.
- Keep agents with no usable provider in discovery results with `disabled` plus warning metadata instead of removing them from the list.
- Separate configured-provider selection from persisted execution metadata so a fallback run can record the provider and model that actually executed without rewriting the configured provider choice for the next run.
- Update the `code_info` MCP schema text so both `provider` and `model` are documented as explicit override fields rather than normal caller-populated inputs.
- Update repo-owned instruction surfaces that teach agents how to use `code_info` so they explicitly say to omit `provider` and `model` unless the user requests a provider-specific or model-specific run.
- Add regression coverage for the MCP tool definition payload so future `tools/list` responses cannot silently drift back to Codex-biased or model-pinning wording.
- Add execution-path tests that prove omitted `provider` and omitted `model` follow the normal shared server resolution rules instead of requiring callers to pre-resolve those values themselves.
- Treat inapplicable `codeinfo_provider` usage as a warning path so invalid placement is visible in logs without blocking the wider runtime contract.
- Add targeted proof first around merge precedence and metadata stripping, then broader proof around provider-specific agent execution and folder-compatibility lookup.
