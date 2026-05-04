# Story 0000057 – Users can run agents with provider-neutral runtime config and codeinfo_agents folder support

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

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

This story also introduces a shared provider-neutral repository execution-context contract for chat, agent, and `code_info` runs. Shared code should resolve repository execution context once and pass the resulting context to whichever provider executes the run. That shared context should always include the selected repository path as runtime metadata when a `workingFolder` has been chosen and should also include a resolved runtime working-directory override for providers that support it directly. When no `workingFolder` has been selected, the common execution-context resolver should still choose the effective default execution root using the same precedence Codex uses today, rather than letting each provider fall back to its own unrelated process working directory. Codex and Copilot should consume that runtime working-directory value in this story. LM Studio should receive the same shared context even if its current provider implementation only uses the repository metadata or provider-specific tools rather than the same direct working-directory mechanism.

When an agent explicitly selects a provider that is unavailable, this story should not stop at the first failure. Instead, agent execution should evaluate a configurable fallback provider order from a new comma-separated env var in `server/.env`, with a default order of `codex,copilot`. `lmstudio` should be a valid value in that env var, but it should not appear in the default list. That env var should be normalized by trimming entries, dropping blanks, removing duplicates, and ignoring unknown provider ids with warnings. If normalization leaves no usable configured providers, the runtime should fall back to the default order rather than failing startup. This fallback rule applies only to direct agent runs and flow-owned agent runs; it does not change normal chat behavior. The fallback rule is also a separate recovery step, not part of the normal agent config merge precedence. If the selected provider is still available but the merged model is missing or invalid for that provider, the runtime should stay on that provider and resolve a fallback model there rather than entering the cross-provider fallback chain. If the runtime does need to fall back to another provider, it should try the same model first when that model exists on the fallback provider, then the model defined in that provider's chat config, and then the default model for that provider. Shared settings should carry forward across that fallback attempt, while provider-specific settings that the fallback provider cannot use should be ignored with warnings rather than making the fallback fail for that reason alone. Once a conversation has successfully persisted the provider and model that actually executed, later turns in that same conversation should continue on that stored provider-and-model pair rather than re-running provider or model selection from the agent config. That means cross-provider fallback and provider-local model repair are conversation-establishment behavior, not later-turn behavior. If that stored provider or model later becomes unavailable, the later turn should fail clearly inside the existing conversation instead of silently switching execution identity or auto-starting a new conversation. If a later turn would need a different provider or model, this story should not allow that change inside the same conversation. When a fallback run succeeds, the conversation and any user-visible execution metadata should show the provider and model that actually ran, and those stored values become the later-turn continuation target for that conversation. If the originally failed provider also appears in the configured fallback list, it should be skipped rather than tried again. If no configured fallback provider can run, the request should fail clearly. Each fallback event should produce both warning logs and warning-capable GUI or API messages so users can see what happened.

This story also shifts the preferred agent folder name from `codex_agents` to `codeinfo_agents` while keeping the old folder name supported for compatibility. The new folder always wins when both are present, and that precedence must apply consistently in local discovery and in cross-repository command lookup. If the same agent exists in both folders, the ignored legacy copy should produce a warning that is both logged and surfaced in the agent list payload plus the selected agent's info or details surface. Equivalent flow-owned agent warning surfaces should reuse the same warning data through the existing flow info or details surface when that surface already exists. The same compatibility rule applies to environment naming: a new neutral agent-home contract can be introduced through `CODEINFO_AGENT_HOME`, but `CODEINFO_CODEX_AGENT_HOME` must remain supported as a legacy alias, and `CODEINFO_AGENT_HOME` should win when both are set.

The user's chosen scope for this story is intentionally config-driven. This story does not add new agent-page controls, does not add new MCP input overrides for agent provider selection, and does not introduce an extra manual override layer on top of the merged config. Normal execution should follow the merged `config.toml` values plus the shared repository execution context where a working folder has been selected while a conversation is being established. After a conversation has successfully persisted the provider and model that actually executed, later turns in that same conversation should continue on those stored values instead of changing provider or model inside the existing conversation. Established conversations should also continue to use their stored `agentName` metadata instead of re-deriving agent identity from the current agent config on later turns. If that stored `agentName` no longer resolves, the later turn should fail clearly instead of substituting another agent. The stored conversation identity should come from the database, but the other agent-owned files referenced by that identity should still be resolved live at execution time rather than from a hidden snapshot. If the agent's config changes later, that updated config should affect only new conversations created after the change rather than rewriting the saved execution pair for an existing conversation. For direct agent runs and flow-owned agent runs only, the runtime may also apply the configured provider-fallback recovery policy after the selected provider fails or an invalid `codeinfo_provider` is detected, but only while determining the provider-and-model pair that the conversation will persist and continue with.

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
- Provider and model selection may vary only while establishing a conversation before the actual execution pair has been persisted.
- Once a conversation has successfully persisted the provider and model that actually executed, later turns in that same conversation continue on that stored provider-and-model pair.
- If an established conversation's stored provider or stored model later becomes unavailable, the later turn fails clearly inside that existing conversation instead of silently switching execution identity or auto-starting a new conversation.
- A fallback provider counts as available only when it is actually usable for the current run, not merely because it is listed in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`.
- If provider fallback runs, the model selection order is: the same model on the fallback provider when available, then the model defined in that fallback provider's chat config, then that fallback provider's default model.
- If provider fallback runs, shared settings remain in effect and provider-specific settings the fallback provider cannot use are ignored with warnings rather than failing fallback for that reason alone.
- Cross-provider fallback is allowed only while establishing a conversation before the actual execution pair has been persisted.
- If the originally failed provider also appears in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, the runtime skips it and moves to the next configured provider.
- If no configured fallback provider can execute the agent run, the run fails clearly.
- Provider fallback emits both warning logs and warning-capable API or GUI warnings.
- Agent fallback warnings appear in the agent list payload and in the selected agent's info or details surface.
- Equivalent flow-owned agent warning surfaces reuse the same warning data through the existing flow info or details surface when that surface already exists.
- Agents disabled because no usable provider remains stay visible in the agent list and details surfaces rather than disappearing from discovery.
- After a fallback or model-repair run succeeds, the conversation and user-visible execution metadata show the provider and model that actually executed, and those stored values become the later-turn continuation target for that conversation.
- If an established conversation already stores `agentName`, later turns continue to use that stored `agentName` instead of re-deriving agent identity from the current agent config.
- If an established conversation's stored `agentName` no longer resolves, the later turn fails clearly instead of substituting a different agent.
- Later turns keep using the conversation identity stored in the database, while the agent-owned files referenced by that identity are resolved live at execution time rather than from a hidden snapshot.
- If an agent's config changes after a conversation has started, the existing conversation keeps using its saved provider-and-model pair and the changed config applies only to new conversations.
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
- `code_info` remains repository-grounded when `provider` is omitted.
- If `code_info` executes on Copilot or LM Studio, it receives equivalent repository context needed to answer local-repository questions through provider-appropriate runtime wiring, tools, or both.
- Omitting `provider` from `code_info` must not degrade repository-local questions into a non-grounded fallback path when the repository is available to the harness.
- Tests cover the layered merge precedence, `codeinfo_provider` defaulting, provider-specific agent execution, folder precedence, compatibility fallback to `codex_agents`, and provider-neutral repository execution-context behavior across agent, chat, and `code_info` surfaces.

### Out Of Scope

- Adding new agent-page controls that let users override provider, model, or provider-specific runtime flags by hand.
- Adding new MCP request fields that override agent provider selection outside the merged config contract.
- Turning chat runtime selection into an agent-style `codeinfo_provider` contract.
- Requiring every provider SDK to natively consume the exact same raw TOML shape directly.
- Requiring every provider to consume repository context through the exact same internal SDK fields or runtime mechanism.
- Requiring LM Studio to implement an identical Codex-style working-directory model if equivalent repository-grounded behavior is achieved through provider-specific tools or runtime wiring.
- Changing the precedence rules themselves for the default execution root beyond centralizing the current Codex behavior into shared code.
- Making LM Studio consume or honor the shared runtime working-directory override directly.
- Updating shared harness, platform, or other agent-facing metadata that lives outside this repository.
- Moving or redesigning provider authentication secrets or stored auth state beyond what is required for the new config layering.
- Inventing a new manual override layer above `codeinfo_config/config.toml`, provider `config.toml`, and chat or agent runtime config.
- Adding a second user-facing working-folder override model that differs between chat, agents, flows, or MCP tools.
- Hiding disabled agents from discovery when provider validation or provider availability fails.
- Treating recoverable formatting mistakes in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` as fatal startup errors.
- Failing provider fallback solely because the original agent config contains provider-specific settings the fallback provider cannot use.
- Entering cross-provider fallback just because the chosen provider's model is missing when that provider itself is still available.
- Re-running provider or model selection inside an already established conversation after provider and model have been persisted for that conversation.
- Allowing a later turn in the same conversation to change to a different provider or model instead of continuing on the stored execution pair.
- Adding a special legacy backfill or migration path for conversations missing persisted provider, model, or agent-name fields; normal app-created conversations already store those values today, and malformed historical cleanup can be handled separately if it ever becomes necessary.
- Adding per-conversation snapshot storage for agent files, prompts, commands, or config contents instead of resolving those files live at execution time.
- Removing `codex_agents` support in this story.
- Introducing new provider types beyond Codex, Copilot, and LM Studio.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

- Later manual proof should cover at least one agent configured for each provider, plus one scenario where both `codeinfo_agents` and `codex_agents` exist so precedence can be observed honestly.
- Later manual proof should include at least one command or flow path that resolves agent-owned files from another repository root, because folder precedence must match there as well.
- Later manual proof should show where users see fallback and duplicate-agent warnings in the agent list and in the selected agent's info or details surface, plus the existing flow info or details warning surface used for equivalent flow-owned agent warnings when that surface exists.
- Later manual proof should show that an invalid `codeinfo_provider` warning first appears when the user opens the affected agent rather than in the initial agent list.
- Later manual proof should include one fallback run where provider-specific settings from the original provider are ignored with a visible warning so the fallback still succeeds.
- Later manual proof should cover a malformed `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` with blanks, duplicates, or unknown providers and show the resulting warnings plus the normalized fallback behavior.
- Later manual proof should show that an agent with no usable provider remains visible but disabled in the list and details surfaces.
- Later manual proof should include one run where the selected provider is available but its model is missing, and show that the runtime stays on that provider while resolving a fallback model there.
- Later manual proof should show that once a conversation has stored its actual execution provider and model, a later turn keeps using that stored pair instead of re-running provider or model selection from config.
- Later manual proof should show that if an established conversation's saved provider or model later becomes unavailable, the later turn fails clearly inside that conversation instead of silently switching or starting fresh.
- Later manual proof should show that a fallback or model-repair run records and displays the provider and model that actually executed, and that later turns continue on that stored pair.
- Later manual proof should show that changing an agent's config affects only new conversations and does not rewrite the saved provider, model, or `agentName` for an already established conversation.
- Later manual proof should show that if a saved `agentName` no longer resolves, the later turn fails clearly instead of substituting another agent.
- Later manual proof should show that later turns keep using stored database identity fields while resolving the current agent files live at execution time.

### Questions

## Decisions

1. Decision: LM Studio direct use of the provided runtime working directory is out of scope for this story.
   - The question being addressed: Does LM Studio need to match Codex and Copilot working-directory behavior in this story?
   - Why the question matters: The story already expects shared execution context for every provider, but LM Studio currently uses provider-specific tooling rather than the same cwd seam.
   - What the answer is: LM Studio should remain repository-grounded through existing provider-appropriate context and tools, but consuming the shared runtime working-directory override directly is out of scope for this story.
   - Where the answer came from: Repo evidence in `server/src/lmstudio/tools.ts`, `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, and `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`. External evidence from the official `lmstudio-js` source in `packages/lms-client/src/llm/LLMGeneratorHandle.ts` and `packages/lms-shared-types/src/PluginConfigSpecifier.ts`.
   - Why it is the best answer: It keeps the story focused on provider-neutral shared context and repository-grounded behavior without forcing unsupported LM Studio parity work into the same implementation.

2. Decision: if `codeinfo_config/config.toml` is missing, the runtime should keep running without auto-creating it.
   - The question being addressed: If `codeinfo_config/config.toml` is missing, should the app create it or just keep running without it?
   - Why the question matters: The story adds a new repo-local config layer, so startup behavior needs to be predictable for repositories that have not created that file yet.
   - What the answer is: Keep running without the file and fall back to the remaining config layers instead of auto-creating repository files at startup.
   - Where the answer came from: Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/flows/markdownFileResolver.ts`, and `server/src/workingFolders/state.ts`, plus local repo-precedent retrieval from `code_info` during this planning round.
   - Why it is the best answer: It matches this repo's normal read-if-present behavior for repo-local config, avoids surprising writes into user repositories, and keeps first-run behavior simple.

3. Decision: `CODEINFO_AGENT_HOME` should be the new neutral agent-home env var, and it should win when both agent-home env vars are set.
   - The question being addressed: What should the new neutral agent-home env var be called, and if both agent-home env vars are set, should the new one win or should the old alias still take priority?
   - Why the question matters: The story keeps `CODEINFO_CODEX_AGENT_HOME` as a legacy alias, so conflicting env values need one clear precedence rule.
   - What the answer is: Use `CODEINFO_AGENT_HOME` as the preferred neutral env var. `CODEINFO_CODEX_AGENT_HOME` remains as a legacy fallback alias, and `CODEINFO_AGENT_HOME` wins when both are set.
   - Where the answer came from: Direct repo review of this story file for the missing env-var name, plus the existing story decision that the new neutral env var should take precedence over `CODEINFO_CODEX_AGENT_HOME`.
   - Why it is the best answer: It gives the story one clear env-var name, removes Codex-specific wording from the preferred contract, and keeps the migration path predictable.

4. Decision: if an agent has an invalid `codeinfo_provider`, the product should warn when the user opens that agent and keep the agent runnable when a fallback is available.
   - The question being addressed: If an agent has an invalid `codeinfo_provider`, how should that failure be shown to the user?
   - Why the question matters: `codeinfo_provider` is an explicit per-agent runtime choice, so bad values need one clear contract.
   - What the answer is: Show a warning when the user opens the affected agent instead of silently defaulting to Codex. If a configured fallback provider is available, keep the agent runnable and include the fallback provider in the warning. If no usable fallback provider is available, show a clear error and disable the agent.
   - Where the answer came from: User direction in this planning round, plus direct repo review of this story file's existing warning-surfacing and fallback requirements.
   - Why it is the best answer: It gives users the warning at the moment they are actually looking at the affected agent, still lets them keep working when recovery is possible, and only disables the agent when the runtime truly has nowhere safe to go.

5. Decision: if an agent explicitly picks a provider that is unavailable, the runtime should try a configurable fallback provider order before failing.
   - The question being addressed: If an agent explicitly picks a provider that is unavailable, should the run fail clearly or try another provider?
   - Why the question matters: Per-agent provider selection is a core part of the story, but users still need a predictable recovery path when a provider is temporarily unavailable.
   - What the answer is: Use a new comma-separated env var in `server/.env` named `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, defaulting to `codex,copilot`. `lmstudio` is a valid value in that list but is not included by default. For each fallback provider, try the same model first when available, then that provider's chat-config model, then that provider's default model. If no configured fallback provider can run, fail clearly. Emit both warning logs and warning-capable GUI or API messages when fallback occurs.
   - Where the answer came from: User direction in this planning round, plus repo evidence in `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`, `server/src/config/chatDefaults.ts`, `server/src/agents/service.ts`, and `server/src/chat/factory.ts`.
   - Why it is the best answer: It gives operators a controlled recovery path without forcing LM Studio into the default chain, keeps the behavior adjustable through env config, and makes fallback visible to both operators and users.

6. Decision: Copilot and LM Studio base config files should be auto-seeded like Codex.
   - The question being addressed: Should Copilot and LM Studio base config files be auto-seeded like Codex, or only read if they already exist?
   - Why the question matters: The story says `copilot/config.toml` and `lmstudio/config.toml` should work in the same product-owned way as `codex/config.toml`, so bootstrap behavior needs to match too.
   - What the answer is: Auto-seed them like Codex.
   - Where the answer came from: Repo evidence in `server/src/config/codexConfig.ts`, `server/src/config/runtimeConfig.ts`, `server/src/config/copilotConfig.ts`, and `server/src/config/chatDefaults.ts`, plus local repo-precedent retrieval from `code_info` during this planning round.
   - Why it is the best answer: It is the closest match to the intended “same as Codex” behavior and keeps provider base-config treatment consistent instead of making Codex special.

7. Decision: provider fallback should apply only to agents and flow-owned agent runs, not to normal chat.
   - The question being addressed: Should provider fallback happen only for agents, or should chat use it too?
   - Why the question matters: The latest fallback requirements were added for agent runs, but broader wording elsewhere could accidentally pull chat into the same behavior.
   - What the answer is: Keep provider fallback agent-only.
   - Where the answer came from: Direct repo review of this story file, especially the broad runtime wording in the Description and the agent-specific fallback wording later in the same file.
   - Why it is the best answer: It keeps chat behavior stable and limits the new fallback complexity to the feature that actually needs it.

8. Decision: if the failed provider also appears in the fallback env var, the runtime should skip it and move to the next provider.
   - The question being addressed: If the failed provider is also listed in the fallback env var, should it be skipped or tried again?
   - Why the question matters: The default fallback order starts with `codex,copilot`, so a Codex failure could otherwise retry Codex inside the fallback loop.
   - What the answer is: Skip the failed provider and continue to the next configured fallback provider.
   - Where the answer came from: Direct repo review of this story file, especially the new `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` wording and the default order now recorded in the story.
   - Why it is the best answer: It avoids pointless retries, keeps the fallback chain easier to understand, and reduces wasted recovery time.

9. Decision: agent fallback and duplicate-agent warnings should appear in the agent list payload and in the selected agent's info or details surface.
   - The question being addressed: Where should users see agent fallback and duplicate-agent warnings?
   - Why the question matters: The story already requires these warnings to reach the GUI and API, but users still need a clear and predictable place to see them.
   - What the answer is: Show the warnings in the agent list payload and in the selected agent's info or details surface, and reuse the same warning data through the existing flow info or details surface for equivalent flow-owned agent warnings when that surface already exists.
   - Where the answer came from: User direction in this planning round, plus direct repo review of this story file's earlier warning-visibility wording.
   - Why it is the best answer: It lets users see the warning both when choosing an agent and when reviewing that agent's details, without inventing a brand-new warning surface just for this story.

10. Decision: `copilot/config.toml` and `lmstudio/config.toml` should be created during shared startup bootstrap rather than waiting for first use.

- The question being addressed: If `copilot/config.toml` or `lmstudio/config.toml` is missing, should startup create it, or should the app wait until that provider is first used?
- Why the question matters: The story already says those provider base config files should be bootstrapped like Codex, but it still needed a clear timing rule.
- What the answer is: Create them during startup as part of one shared provider-config bootstrap step.
- Where the answer came from: Repo evidence in `server/src/index.ts`, `server/src/config/codexConfig.ts`, `server/src/config/runtimeConfig.ts`, and `server/src/test/unit/copilotSeedBootstrap.test.ts`, plus earlier decisions already recorded in this plan that Copilot and LM Studio base config files should be auto-seeded like Codex.
- Why it is the best answer: It is the closest match to the current Codex behavior, keeps provider bootstrap timing predictable, and avoids hiding configuration side effects behind first use.

11. Decision: provider fallback should ignore settings meant only for the original provider rather than fail the run for that reason alone.

- The question being addressed: If fallback switches providers, should it ignore settings meant for the original provider, or fail the run?
- Why the question matters: Without a clear rule, a Codex-only setting could make an otherwise healthy Copilot or LM Studio fallback fail for a confusing reason.
- What the answer is: Keep the shared settings, ignore provider-specific settings the fallback provider cannot use, and emit warnings for anything dropped.
- Where the answer came from: User direction in this planning round. Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/config/codexEnvDefaults.ts`, and `planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md`. External evidence from the TOML v1.0.0 spec at `toml.io`, which leaves key semantics to the application.
- Why it is the best answer: It matches this repo's warning-first config normalization style, preserves fallback as a recovery path, and avoids cascading one provider problem into another avoidable failure.

12. Decision: malformed fallback env values should be normalized with warnings instead of treated as fatal errors.

- The question being addressed: If the fallback env var has blank, duplicate, or unknown providers, should we warn and clean it up, or treat it as an error?
- Why the question matters: Operators will edit this env var by hand, so the story needs one predictable rule for common mistakes.
- What the answer is: Trim entries, drop blanks, remove duplicates, ignore unknown providers with warnings, and use the default fallback order only if nothing usable remains after normalization.
- Where the answer came from: User direction in this planning round. Repo evidence in `server/src/config/codexEnvDefaults.ts`, `server/src/config/chatDefaults.ts`, and `planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md`. External evidence from Node.js environment-variable docs, Context7 documentation for `nodejs/node`, and DeepWiki notes on `nodejs/node`, all of which show that env values arrive as strings and application-level normalization belongs to the app.
- Why it is the best answer: It matches existing repo env parsing patterns, keeps operator-facing behavior predictable, and still makes the bad config visible through warnings.

13. Decision: agents with no usable provider should stay visible but disabled rather than disappear from discovery.

- The question being addressed: If no usable provider is left, should the agent stay visible but disabled, or disappear from the agent list?
- Why the question matters: Users need a clear and stable way to understand why an agent cannot run without thinking it vanished or was deleted.
- What the answer is: Keep the agent visible, mark it disabled, and show the reason through warnings or details surfaces.
- Where the answer came from: User direction in this planning round. Repo evidence in `server/src/agents/types.ts`, `client/src/components/agents/AgentsComposerPanel.tsx`, and `server/src/config/chatDefaults.ts`.
- Why it is the best answer: It aligns with the repo's existing agent API and UI shape, preserves debuggability, and keeps discovery behavior predictable for users.

14. Decision: model repair stays on the selected provider instead of entering cross-provider fallback.

- The question being addressed: If the chosen provider is up but its model is missing, should the runtime stay on that provider or switch providers?
- Why the question matters: A bad model name is a common operator mistake, and the story already treats provider fallback as a separate recovery path.
- What the answer is: Stay on the selected provider and resolve a fallback model there instead of entering the cross-provider fallback chain.
- Where the answer came from: User direction in this planning round. Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`, and `design.md`. External evidence from OpenAI API docs and DeepWiki notes on `openai/openai-node`, both of which show that model selection is application-owned within the chosen provider rather than something the SDK auto-switches across providers.
- Why it is the best answer: It keeps explicit provider choice authoritative, matches the story's current separation between provider fallback and normal model resolution, and avoids silently changing providers for what is really a provider-local model issue.

15. Decision: cross-provider fallback is only for establishing a conversation, and later turns stay on the stored execution pair.

- The question being addressed: If one run falls back, should the next run try the original provider again, or keep using the fallback provider?
- Why the question matters: This decides whether fallback is a one-run recovery step or a sticky provider change that silently reshapes later agent behavior.
- What the answer is: Use cross-provider fallback only while establishing a conversation before the actual execution pair has been persisted. After that, later turns in the same conversation stay on the stored provider-and-model pair.
- Where the answer came from: User direction in this planning round after reviewing Codex and Copilot continuation constraints. Repo evidence in `server/src/routes/chat.ts`, `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, `server/src/chat/agentFlags.ts`, and `server/src/mongo/repo.ts`, which show that provider-native continuation depends on the persisted execution context. External evidence was not needed because the local continuation contract already provides the strongest precedent.
- Why it is the best answer: It preserves provider-native continuation for Codex and Copilot, keeps later-turn behavior predictable, and avoids silently switching an established conversation onto a provider that does not own that conversation's history.

16. Decision: fallback runs should display and persist the provider and model that actually executed.

- The question being addressed: After a fallback run, should the conversation show the provider that actually ran, or the provider originally requested?
- Why the question matters: Users and later runtime code need one honest source for what really executed, especially when warnings, thread reuse, and later debugging depend on it.
- What the answer is: Show and persist the provider and model that actually executed, and use those stored values as the continuation target for later turns in that same conversation.
- Where the answer came from: User direction in this planning round. Repo evidence in `server/src/routes/chat.ts`, `server/src/mongo/conversation.ts`, and `server/src/mongo/repo.ts`.
- Why it is the best answer: It matches the repo's existing conversation metadata pattern, keeps visible state truthful, and gives later turns one unambiguous provider-and-model pair to continue with.

17. Decision: provider-local model repair becomes the stored continuation model for that conversation.

- The question being addressed: If a missing model is repaired on the same provider, should the next run try the original model again, or keep using the repaired model?
- Why the question matters: This decides whether model repair is a one-run recovery step or a quiet long-term change to which model the agent keeps using.
- What the answer is: If model repair happens while establishing the conversation, the repaired model that actually executed becomes the stored continuation model for later turns in that same conversation.
- Where the answer came from: User direction in this planning round after clarifying that established conversations should continue on the provider-and-model pair stored in the database. Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`, and `server/src/mongo/repo.ts`.
- Why it is the best answer: It keeps continuation behavior consistent with the stored execution metadata, avoids reintroducing a model mismatch on the next turn, and matches the same blanket continuity rule now being applied across providers.

18. Decision: once a conversation has stored a provider and model, later turns may not change either value inside that conversation.

- The question being addressed: Should the same continuity rule apply only to Codex and Copilot, or should it be a blanket rule for all providers in this story?
- Why the question matters: LM Studio could rebuild from history, but a provider-specific exception would make the story harder to explain, test, and trust.
- What the answer is: Apply one blanket rule. Once a conversation has stored its actual execution provider and model, later turns in that same conversation keep using that stored pair.
- Where the answer came from: User direction in this planning round, plus repo evidence in `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, `server/src/routes/chat.ts`, and `server/src/mongo/conversation.ts`.
- Why it is the best answer: It keeps the product contract simple, prevents provider-specific surprises, and aligns continuation behavior with the database state the runtime already persists and reads.

19. Decision: if a saved provider or model stops working later, the next turn should fail clearly inside the existing conversation.

- The question being addressed: If a saved provider or model stops working later, should the next turn fail, or should we force a new conversation?
- Why the question matters: The story now locks each conversation to its saved execution pair, so later-turn failure behavior needs to be explicit.
- What the answer is: Fail the later turn clearly inside the existing conversation instead of silently switching providers or auto-starting a new conversation.
- Where the answer came from: User direction in this planning round. Repo evidence in `server/src/routes/chat.ts`, `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, `server/src/chat/agentFlags.ts`, `client/src/pages/ChatPage.tsx`, and `client/src/test/chatPage.inflightNavigate.test.tsx`. External evidence in the official OpenAI conversation-state docs, the official GitHub Copilot SDK session-persistence docs, and DeepWiki notes on `openai/openai-node`.
- Why it is the best answer: It preserves the saved conversation identity, matches the repo's explicit-failure precedent for unavailable pinned execution, and avoids silently changing what an existing conversation means.

20. Decision: if an agent's config changes after a conversation starts, the old conversation keeps its saved provider, model, and `agentName`, and the new config applies only to new conversations.

- The question being addressed: If an agent's config changes after a conversation starts, should the old conversation keep its saved provider, model, and `agentName`, or adopt the new config?
- Why the question matters: Without a clear rule, an agent edit could silently rewrite how an established conversation continues.
- What the answer is: Keep the old conversation on its saved provider-and-model pair and its stored `agentName`, and apply the changed agent config only to new conversations created after that edit.
- Where the answer came from: User direction in this planning round. Repo evidence in `client/src/pages/ChatPage.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, `server/src/routes/chat.ts`, `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, and `server/src/mongo/repo.ts`. External evidence in the official OpenAI conversation-state docs, the official GitHub Copilot SDK session-persistence docs, and DeepWiki notes on `openai/openai-node`.
- Why it is the best answer: It matches the repo's next-send boundary behavior for provider and model changes, keeps continuation predictable, and prevents later config edits from mutating an existing conversation's saved execution identity or agent binding.

21. Decision: if the saved agent name no longer exists later, the turn should fail clearly instead of substituting another agent.

- The question being addressed: If the saved agent name no longer exists later, should the turn fail, or should we try a different agent?
- Why the question matters: The story now says later turns keep using the stored `agentName`, so missing-agent behavior needs one explicit rule.
- What the answer is: Fail the later turn clearly instead of substituting a different agent.
- Where the answer came from: User direction in this planning round. Repo evidence in `server/src/agents/service.ts`, `server/src/test/unit/agents-router-run.test.ts`, `server/src/test/unit/agents-commands-router-run.test.ts`, `server/src/test/unit/agent-prompts-list.test.ts`, and `server/src/test/unit/agent-commands-list.test.ts`. External evidence in the official GitHub Copilot session-persistence docs, the official OpenAI conversation-state docs, and DeepWiki notes on `openai/openai-node`.
- Why it is the best answer: It matches the repo's current `AGENT_NOT_FOUND` precedent, keeps agent identity explicit, and avoids silently changing the agent behavior behind an existing conversation.

22. Decision: later turns should keep using stored database identity fields, but agent-owned files should be resolved live at execution time.

- The question being addressed: If an agent's files change after a conversation starts, should later turns use the updated agent files, or keep the older version?
- Why the question matters: Storing `agentName` does not automatically decide whether conversations follow live file changes or require per-conversation snapshots.
- What the answer is: Keep using the identity fields stored in the database for continuation, but resolve the agent-owned files referenced by that identity live at execution time rather than from a hidden snapshot.
- Where the answer came from: User direction in this planning round. Repo evidence in `server/src/agents/discovery.ts`, `server/src/config/runtimeConfig.ts`, `server/src/agents/service.ts`, `server/src/routes/conversations.ts`, and `server/src/test/unit/conversations-router-agent-filter.test.ts`. External evidence in the official GitHub Copilot session-persistence docs, the official OpenAI conversation-state docs, and DeepWiki notes on `openai/openai-node`.
- Why it is the best answer: It preserves the stored conversation identity, matches the repo's current live-discovery behavior, and avoids expanding this story into a much larger snapshotting feature.

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
- Once a conversation has persisted its actual execution provider and model, route later turns directly onto that stored pair instead of re-resolving provider or model from config.
- Validate the stored provider-and-model pair before each later turn and fail clearly inside the existing conversation if that saved pair is no longer runnable.
- Reuse provider-model discovery so fallback acts as a separate recovery step: try the same model on the next provider first, then that provider's chat-config model, and finally that provider's default model before moving on or failing.
- Filter provider-specific runtime settings before constructing the fallback provider so shared settings survive while incompatible provider-only settings are dropped with warnings.
- Skip the originally failed provider if it also appears in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` rather than retrying it inside the fallback loop.
- Treat provider fallback and provider-local model repair as conversation-establishment behavior only, and stop re-running those selection steps after the conversation's actual execution pair has been persisted.
- Keep established conversations pinned to their saved execution pair and stored `agentName` even if the underlying agent config later changes, and apply those config edits only when starting new conversations.
- Re-resolve the saved `agentName` against the live agent list on each later turn, and fail with the existing missing-agent path if it no longer resolves.
- Resolve agent-owned files live at execution time from the saved conversation identity instead of introducing per-conversation snapshots of agent content.
- Support a new neutral agent-home contract without breaking existing `CODEINFO_CODEX_AGENT_HOME` users by resolving the legacy variable as an alias during the migration window.
- Resolve `CODEINFO_AGENT_HOME` ahead of `CODEINFO_CODEX_AGENT_HOME` so the legacy name behaves as a fallback compatibility alias rather than a competing primary setting.
- Centralize folder precedence in one reusable helper so local discovery and cross-repository lookups cannot drift apart.
- Surface fallback and duplicate-agent warnings through the agent list payload and the selected agent's info or details surface, and reuse the same warning data through the existing flow info or details surface for equivalent flow-owned agent warnings when that surface already exists.
- Keep agents with no usable provider in discovery results with `disabled` plus warning metadata instead of removing them from the list.
- Separate configured-provider selection from persisted execution metadata so a fallback or model-repair run can record the provider and model that actually executed without mutating the underlying agent config.
- Treat inapplicable `codeinfo_provider` usage as a warning path so invalid placement is visible in logs without blocking the wider runtime contract.
- Add targeted proof first around merge precedence and metadata stripping, then broader proof around provider-specific agent execution and folder-compatibility lookup.
