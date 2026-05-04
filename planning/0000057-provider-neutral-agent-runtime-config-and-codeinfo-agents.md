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

This story does not require a new backend service, a new frontend application, or a new operator-facing stack. The work stays inside the existing server runtime, the current provider adapters, the current compose and startup paths, and the existing chat, agent, and flow surfaces that already display warnings, disabled states, and execution metadata.

This story introduces a provider-neutral agent runtime contract built from layered config files with clear precedence. The lowest-precedence layer is a new repo-local `codeinfo_config/config.toml`. Above that sits the selected provider's base `config.toml`, such as `codex/config.toml`, `copilot/config.toml`, or `lmstudio/config.toml`. The highest-precedence runtime file is either the selected provider's `chat/config.toml` for chat-driven surfaces or the selected agent's own `config.toml` for agent-driven surfaces. Higher-precedence values replace lower-precedence values. If `codeinfo_config/config.toml` has not been created yet, the runtime should continue cleanly without trying to auto-create repository files at startup. Provider base config files that this story owns, including `copilot/config.toml` and `lmstudio/config.toml`, should be created during shared startup bootstrap rather than waiting for first use.

For agents, the selected provider comes from a new app-owned metadata field inside the agent's own `config.toml`: `codeinfo_provider`. If that field is absent, the provider defaults to `codex` so today's checked-in agents continue to work without manual migration. If the field is present but invalid, the product should warn when the user opens that affected agent rather than silently defaulting to Codex. If a configured fallback provider is actually usable for that run, the agent should remain runnable and the warning should explain which fallback will be used. If no usable fallback provider is available, the product should show a clear error and disable that agent, but the agent should remain visible in discovery surfaces so users can still inspect the warning and understand why it cannot run. This invalid-provider path should use the same fallback order and availability checks as provider-unavailable agent runs. Chat runtime config does not need the same field because the provider is already selected through the chat contract rather than through an agent definition.

This story also introduces a shared provider-neutral repository execution-context contract for chat, agent, and `code_info` runs. Shared code should resolve repository execution context once and pass the resulting context to whichever provider executes the run. That shared context should always include the selected repository path as runtime metadata when a `workingFolder` has been chosen and should also include a resolved runtime working-directory override for providers that support it directly. When no `workingFolder` has been selected, the common execution-context resolver should still choose the effective default execution root using the same precedence Codex uses today, rather than letting each provider fall back to its own unrelated process working directory. Codex and Copilot should consume that runtime working-directory value in this story. LM Studio should receive the same shared context even if its current provider implementation only uses the repository metadata or provider-specific tools rather than the same direct working-directory mechanism.

When an agent explicitly selects a provider that is unavailable, this story should not stop at the first failure. Instead, agent execution should evaluate a configurable fallback provider order from a new comma-separated env var in `server/.env`, with a default order of `codex,copilot`. `lmstudio` should be a valid value in that env var, but it should not appear in the default list. That env var should be normalized by trimming entries, dropping blanks, removing duplicates, and ignoring unknown provider ids with warnings. If normalization leaves no usable configured providers, the runtime should fall back to the default order rather than failing startup. This fallback rule applies only to direct agent runs and flow-owned agent runs; it does not change normal chat behavior. The fallback rule is also a separate recovery step, not part of the normal agent config merge precedence. If the selected provider is still available but the merged model is missing or invalid for that provider, the runtime should stay on that provider and resolve a fallback model there rather than entering the cross-provider fallback chain. If the runtime does need to fall back to another provider, it should try the same model first when that model exists on the fallback provider, then the model defined in that provider's chat config, and then the default model for that provider. Shared settings should carry forward across that fallback attempt, while provider-specific settings that the fallback provider cannot use should be ignored with warnings rather than making the fallback fail for that reason alone. Once a conversation has successfully persisted the provider and model that actually executed, later turns in that same conversation should continue on that stored provider-and-model pair rather than re-running provider or model selection from the agent config. That means cross-provider fallback and provider-local model repair are conversation-establishment behavior, not later-turn behavior. If that stored provider or model later becomes unavailable, the later turn should fail clearly inside the existing conversation instead of silently switching execution identity or auto-starting a new conversation. If a later turn would need a different provider or model, this story should not allow that change inside the same conversation. When a fallback run succeeds, the conversation and any user-visible execution metadata should show the provider and model that actually ran, and those stored values become the later-turn continuation target for that conversation. If the originally failed provider also appears in the configured fallback list, it should be skipped rather than tried again. If no configured fallback provider can run, the request should fail clearly. Each fallback event should produce both warning logs and warning-capable GUI or API messages so users can see what happened.

This story also shifts the preferred agent folder name from `codex_agents` to `codeinfo_agents` while keeping the old folder name supported for compatibility. The new folder always wins when both are present, and that precedence must apply consistently in local discovery and in cross-repository command lookup. If the same agent exists in both folders, the ignored legacy copy should produce a warning that is both logged and surfaced in the agent list payload plus the selected agent's info or details surface. Equivalent flow-owned agent warning surfaces should reuse the same warning data through the existing flow info or details surface when that surface already exists. The same compatibility rule applies to environment naming: a new neutral agent-home contract can be introduced through `CODEINFO_AGENT_HOME`, but `CODEINFO_CODEX_AGENT_HOME` must remain supported as a legacy alias, and `CODEINFO_AGENT_HOME` should win when both are set.

The user's chosen scope for this story is intentionally config-driven. This story does not add new agent-page controls, does not add new MCP input overrides for agent provider selection, and does not introduce an extra manual override layer on top of the merged config. Normal execution should follow the merged `config.toml` values plus the shared repository execution context where a working folder has been selected while a conversation is being established. After a conversation has successfully persisted the provider and model that actually executed, later turns in that same conversation should continue on those stored values instead of changing provider or model inside the existing conversation. Established conversations should also continue to use their stored `agentName` metadata instead of re-deriving agent identity from the current agent config on later turns. If that stored `agentName` no longer resolves, the later turn should fail clearly instead of substituting another agent. The stored conversation identity should come from the database, but the other agent-owned files referenced by that identity should still be resolved live at execution time rather than from a hidden snapshot. If the agent's config changes later, that updated config should affect only new conversations created after the change rather than rewriting the saved execution pair for an existing conversation. For direct agent runs and flow-owned agent runs only, the runtime may also apply the configured provider-fallback recovery policy after the selected provider fails or an invalid `codeinfo_provider` is detected, but only while determining the provider-and-model pair that the conversation will persist and continue with.

This story also changes stateful behavior for selected agents and resumed conversations. Opening an existing conversation keeps that conversation pinned to its stored execution identity even if the user has since selected a different agent or the underlying agent config has changed. Starting a fresh conversation reevaluates the current agent config, provider availability, and fallback rules from scratch. If the currently selected agent has no usable provider, the selected-agent details surface should show the warning and disabled state clearly, and the run-start path must not submit stale hidden state from an older runnable selection.

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
- If `codeinfo_provider` is present but trims to an empty string, the runtime treats it the same as absent and defaults that agent to `codex`.
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
- A blank or whitespace-only `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` counts as no configured value and falls back to the default order after normalization.
- If `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` normalizes to no usable configured providers, agent execution falls back to the default order of `codex,copilot` rather than failing startup.
- Provider fallback is a separate recovery step and does not change the normal agent runtime config precedence.
- If the selected provider is available but the merged model is missing or invalid for that provider, runtime stays on that provider and resolves a fallback model there instead of entering cross-provider fallback.
- Provider and model selection may vary only while establishing a conversation before the actual execution pair has been persisted.
- Once a conversation has successfully persisted the provider and model that actually executed, later turns in that same conversation continue on that stored provider-and-model pair.
- If an established conversation's stored provider or stored model later becomes unavailable, the later turn fails clearly inside that existing conversation instead of silently switching execution identity or auto-starting a new conversation.
- Opening an existing conversation treats the stored provider, model, and `agentName` as authoritative execution state even if the current UI selection or current agent config now points somewhere else.
- Starting a new conversation after an agent-config or provider-availability change reevaluates the current config, warning, and fallback state from scratch instead of inheriting the previous conversation's persisted execution pair.
- A fallback provider counts as available only when it is actually usable for the current run, not merely because it is listed in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`.
- If provider fallback runs, the model selection order is: the same model on the fallback provider when available, then the model defined in that fallback provider's chat config, then that fallback provider's default model.
- If provider fallback runs, shared settings remain in effect and provider-specific settings the fallback provider cannot use are ignored with warnings rather than failing fallback for that reason alone.
- Cross-provider fallback is allowed only while establishing a conversation before the actual execution pair has been persisted.
- If the originally failed provider also appears in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, the runtime skips it and moves to the next configured provider.
- If no configured fallback provider can execute the agent run, the run fails clearly.
- Provider fallback emits both warning logs and warning-capable API or GUI warnings.
- Agent fallback warnings appear in the agent list payload and in the selected agent's info or details surface.
- Invalid `codeinfo_provider` warnings are detail-driven for runnable agents: the warning becomes visible when the user opens the selected agent, while the discovery list stays focused on selection and disabled-state cues rather than eagerly expanding every warning inline.
- Equivalent flow-owned agent warning surfaces reuse the same warning data through the existing flow info or details surface when that surface already exists.
- Agents disabled because no usable provider remains stay visible in the agent list and details surfaces rather than disappearing from discovery.
- If the selected agent has no usable provider, the selected-agent details surface shows the disabled-plus-warning state and the run-start path excludes stale runnable-state assumptions from the submitted payload instead of trying to execute with the last known good selection.
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
- Blank or whitespace-only `CODEINFO_AGENT_HOME` and `CODEINFO_CODEX_AGENT_HOME` values count as unset input.
- If both `CODEINFO_AGENT_HOME` and `CODEINFO_CODEX_AGENT_HOME` are set, `CODEINFO_AGENT_HOME` wins and the legacy alias is treated as a fallback only.
- The normal startup path remains the default reachability path for the new env naming and provider bootstrap rules: shared startup bootstrap, `server/.env`, `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` must not require one-off operator edits just to reach the new provider-neutral agent contract.
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
- If resume-time request state ever contradicts the stored conversation execution identity, the stored provider, model, and `agentName` remain authoritative; contradictory client-visible state must be ignored for execution and may only surface as logging or warning context.
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

- Later manual proof should prefer the normal human stack through `npm run compose:build` followed by `npm run compose:up`, because `docker-compose.yml` is the stack that mounts the working repository into the server container and reflects the real repository-grounded runtime contract.
- Later manual proof should use `docker-compose.local.yml` only when the proof honestly requires its extra source bind mounts or Docker-socket behavior, not as the default runtime for this story.
- Later automated browser proof can still rely on the e2e stack, but `docker-compose.e2e.yml` should not be treated as the main mounted working-repository proof path because it does not mount the selected host repository into the server container.
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

## Questions

- No Further Questions

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

## Feasibility Proof Pass

### 1. Provider-Neutral Runtime Layering And Bootstrap

- Already existing capabilities:
  - `server/src/config/runtimeConfig.ts` already reads, normalizes, and merges runtime TOML for chat and agent surfaces, and it already knows how to bootstrap chat config templates for `codex`, `copilot`, and `lmstudio`.
  - `server/src/config/codexConfig.ts`, `server/src/config/copilotConfig.ts`, `server/src/config/copilotSeedBootstrap.ts`, `server/src/index.ts`, and `server/entrypoint.sh` already provide startup-owned home resolution and Copilot seed bootstrap behavior that this story can extend rather than replace.
  - `server/src/config/chatDefaults.ts` and `server/src/routes/chat.ts` already resolve multi-provider chat defaults and provider readiness for Codex, Copilot, and LM Studio.
- Missing prerequisite capabilities:
  - Agent and flow runtime entrypoints still resolve agent config through a Codex-only seam: `server/src/agents/config.ts` accepts only `codexHome`, and `server/src/agents/service.ts` plus `server/src/flows/service.ts` still construct `getChatInterface('codex')`.
  - The runtime resolver does not yet add an optional repo-local `codeinfo_config/config.toml` layer ahead of provider base config plus chat or agent runtime config.
  - No runtime parser currently recognizes `codeinfo_provider` or `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`.
- Assumptions currently invalid:
  - It is not valid to assume the existing shared runtime resolver is already provider-neutral for agent or flow execution just because chat defaults already support three providers.
  - It is not valid to assume provider fallback already exists for direct agents, flow-owned agents, or `code_info`; current provider fallback behavior is limited to chat-facing default selection paths.
- Feasibility and sequencing note:
  - This area is feasible because the repo already centralizes most chat-default and runtime-config logic. The safest sequence is to extend the shared runtime resolver first, then switch agent, flow, and `code_info` entrypoints onto that provider-neutral contract.

### 2. Agent Discovery, Folder Ownership, And Environment Naming

- Already existing capabilities:
  - `server/src/agents/discovery.ts`, `server/src/agents/types.ts`, `server/src/routes/agents.ts`, and `server/src/mcpAgents/tools.ts` already expose a stable discovered-agent payload with `name`, optional `description`, optional `disabled`, and optional `warnings`.
  - `server/src/agents/service.ts` and `server/src/agents/commandsLoader.ts` already resolve local and ingested command assets from existing repository roots.
  - The current compose and runtime stack already inject `CODEINFO_CODEX_AGENT_HOME` into the server container.
- Missing prerequisite capabilities:
  - Discovery still hard-requires `CODEINFO_CODEX_AGENT_HOME` and reads only one root; there is no neutral `CODEINFO_AGENT_HOME` alias or `codeinfo_agents` precedence helper yet.
  - Cross-repository command lookup in `server/src/agents/service.ts` still anchors directly to `codex_agents`.
  - Duplicate-agent detection between `codeinfo_agents` and `codex_agents` does not exist yet.
- Assumptions currently invalid:
  - It is not valid to assume neutral agent-home naming or folder precedence already works across local discovery, ingested command lookup, and compose runtime wiring.
- Feasibility and sequencing note:
  - This area is feasible because discovery is already centralized. Centralize folder-root and env-var precedence in one helper before updating list, run, command, and flow surfaces so they cannot drift apart.

### 3. Shared Repository Execution Context And Conversation Continuation

- Already existing capabilities:
  - `server/src/workingFolders/state.ts` already validates and restores `working_folder`, maps host paths into container-visible workdirs, and emits stable error codes such as `WORKING_FOLDER_INVALID`, `WORKING_FOLDER_NOT_FOUND`, `WORKING_FOLDER_UNAVAILABLE`, and `WORKING_FOLDER_REPOSITORY_UNAVAILABLE`.
  - `server/src/routes/chat.ts`, `server/src/routes/agentsRun.ts`, and `server/src/flows/service.ts` already accept working-folder input and persist working-folder metadata on conversations.
  - `server/src/mongo/conversation.ts` already persists `provider`, `model`, `agentName`, `flowName`, and mixed `flags`, including current use of `flags.threadId` and `flags.workingFolder`.
  - `server/src/chat/interfaces/ChatInterfaceCopilot.ts` already supports `workingDirectoryOverride`, while `server/src/chat/interfaces/ChatInterfaceLMStudio.ts` already accepts repository-oriented flags and persisted history.
- Missing prerequisite capabilities:
  - Chat, agents, flows, and `code_info` still do not share one provider-neutral execution-context helper that resolves repository metadata plus working-directory override exactly once.
  - Flow-owned agent execution still resolves runtime as Codex-only and persists flow child provider state under a Codex-shaped assumption.
  - The current plan needs explicit persistence guidance for how later-turn provider, model, and `agentName` continuation should extend the existing conversation shape without inventing a second storage model.
- Assumptions currently invalid:
  - It is not valid to assume flows or `code_info` already reuse the exact same provider-neutral working-folder logic as chat just because they accept similar repository inputs.
  - It is not valid to assume provider-native continuation can silently switch providers or models mid-conversation without conflicting with the repo's persisted conversation contract.
- Feasibility and sequencing note:
  - This area is feasible because working-folder resolution and conversation persistence are already centralized enough to reuse. Land the shared execution-context helper before provider fallback and continuation logic so later-turn behavior stays consistent across surfaces.

### 4. Proof Surfaces, Compose Delivery, And Runtime Wiring

- Already existing capabilities:
  - `package.json` and `AGENTS.md` already provide wrapper-first build, typecheck, compose, and test commands.
  - `server/package.json` already supports `node:test` unit plus integration suites and Cucumber feature suites with Testcontainers helpers under `server/src/test/support/`.
  - `client/src/test/**` already provides frontend unit coverage, and `playwright.config.ts` plus `e2e/**` already provide browser automation.
  - `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` already define three distinct proof stacks.
  - `docker-compose.yml` is the honest mounted working-repository contract: it binds `${CODEINFO_HOST_INGEST_DIR:-/tmp}` to `/data:ro`, sets `CODEINFO_CODEX_WORKDIR=/data`, sets `CODEINFO_CODEX_HOME=/app/codex`, seeds `CODEINFO_COPILOT_HOME=/app/copilot`, and exposes `CODEINFO_LMSTUDIO_HOME=/app/lmstudio`.
- Missing prerequisite capabilities:
  - No existing automated or manual proof currently demonstrates provider-neutral agent execution, duplicate-agent precedence, provider fallback, or pinned provider-and-model continuation across direct agents, flows, and `code_info`.
  - Compose and entrypoint coverage do not yet assert propagation of the new neutral agent-home alias or the new provider-fallback env var.
- Assumptions currently invalid:
  - It is not valid to assume current e2e coverage proves provider-neutral runtime behavior; current Playwright routes mainly mock agent run payloads and happy-path browser interactions.
  - It is not valid to assume `docker-compose.e2e.yml` can serve as the main mounted working-repository proof stack, because it does not mount the selected host repository into the server container.
  - It is not valid to assume `docker-compose.local.yml` should replace the normal human stack by default; it adds extra source bind mounts and Docker socket behavior that the main stack does not require.
- Feasibility and sequencing note:
  - This area is feasible because the repo already has strong wrappers and harnesses. Keep `docker-compose.yml` as the default human-stack proof path for mounted working-repository behavior, keep Playwright e2e as automated browser proof, and add any fake-provider or seeded-auth seams only in test-owned harnesses or fixtures.

## Message Contracts And Storage Shapes

- Preserve the discovered-agent payload shape from `server/src/agents/types.ts` and `GET /agents`: `{ name, description?, disabled?, warnings? }`.
- Preserve the started-run response shapes while adding provider-neutral behavior behind them:
  - agent runs: `{ status, agentName, conversationId, inflightId, modelId }`
  - flow runs: `{ status, flowName, conversationId, inflightId, modelId }`
  - MCP agent tools continue returning `conversationId` and `modelId` in their tool-result payloads.
- Copilot session creation and resume should stay inside the SDK's documented config surface that the repo already uses: `model`, `reasoningEffort`, `systemMessage`, `tools`, `availableTools`, `workingDirectory`, and `configDir`. Completion and streaming should keep mapping onto the provider event vocabulary the SDK documents and the repo already consumes: `session.start`, `session.resume`, `assistant.message_delta`, `tool.execution_start`, `tool.execution_complete`, `assistant.usage`, and `session.idle`.
- LM Studio standard `model.respond(...)` and `model.act(...)` calls should keep using the documented prediction-option surface the repo already passes today: bounded `maxTokens`, `temperature`, and `contextOverflowPolicy` with `stopAtLimit | truncateMiddle | rollingWindow`, plus tool-callback and streaming hooks. Do not plan against an unbounded `maxTokens: false` path or a direct standard `workingDirectory` override on those normal model calls.
- The installed Copilot SDK supports `reasoningEffort` values `low | medium | high | xhigh`, but the current repo-normalized Copilot agent-flag contract only exposes `low | medium | high`. Unless this story explicitly widens the shared provider-descriptor and test surface, preserve that narrower repo-facing contract instead of surfacing `xhigh` accidentally in one layer only.
- The installed LM Studio SDK documents `temperature` in the normal prediction API as a `0..1` value. Story 57 should treat that documented domain as the safe contract for provider-neutral runtime planning and should not rely on temperatures above `1` unless a later live proof or upstream documentation update confirms broader support.
- Preserve `working_folder` validation error codes and client-facing behavior that already exist in REST and MCP surfaces: `WORKING_FOLDER_INVALID`, `WORKING_FOLDER_NOT_FOUND`, `WORKING_FOLDER_UNAVAILABLE`, and `WORKING_FOLDER_REPOSITORY_UNAVAILABLE`.
- Preserve the canonical conversation storage shape in `server/src/mongo/conversation.ts`: `_id`, `provider`, `model`, `title`, `agentName?`, `flowName?`, `source`, `flags`, `lastMessageAt`, and `archivedAt`.
- Extend `Conversation.flags` for provider-neutral continuation and runtime metadata rather than inventing a second persistence table unless later repository evidence proves the current mixed-shape approach cannot support the story safely.
- Keep `flags.threadId`, `flags.workingFolder`, and existing flow resume metadata compatible with current conversation reads and writes in chat, agents, flows, and `code_info`.

## Lifecycle And State Ownership

- Shared startup bootstrap owns creating provider base config files such as `copilot/config.toml` and `lmstudio/config.toml` when they are missing. Runtime merge helpers may read `codeinfo_config/config.toml` if it exists, but this story does not make runtime request paths create, rename, or delete repository-local config files.
- Startup-owned config writers should follow the repo's existing staged-write or temp-file-plus-rename pattern for managed config artifacts so runtime readers do not observe partially written TOML or JSON. If bootstrap fails mid-write, keep the last readable target file, discard the staged artifact, and leave cleanup of temporary bootstrap artifacts with the startup-owned path that created them.
- Agent discovery and command lookup own reading `codeinfo_agents` plus legacy `codex_agents`. This story does not auto-migrate, rename, or delete the legacy folder; compatibility is maintained by read-time precedence plus warnings.
- Conversation establishment owns provider selection, fallback selection, model repair, working-folder resolution, and persistence of the actual execution identity. Once the first successful execution has written the real provider, model, and `agentName` into the existing conversation record, later turns read that saved identity instead of recomputing it from current config.
- If the conversation record exists before fallback or model repair has finished, any pre-fallback provider or model value is only an in-progress placeholder. The writer side must replace that placeholder with the actual executed pair before later-turn continuation reads it as authoritative, and the reader side must not treat the placeholder pair as the final pinned execution identity.
- Existing run-lock, inflight, cancel, and completion ownership stays with the current conversation and run lifecycle. Provider fallback or same-provider model repair must happen inside that existing run attempt rather than by silently creating a second visible conversation or a second lock owner.
- Cancel, retry, and crash-recovery behavior stay inside the existing run lifecycle: cancelling during fallback or model repair cancels the same inflight run, retry starts a new run through the normal acquire path, and crash or teardown continues to rely on the repo's existing lock-release and inflight-cleanup ownership instead of adding a second cleanup mechanism for this story.
- This story does not add a new cleanup worker, stale-conversation migration, or automatic deletion path. Existing conversation cleanup, archival, and lock-release behavior stays in the current repository-owned paths unless later implementation evidence proves one of those paths must be extended.

## Log Or Proof Markers

- Provider fallback or model-repair marker:
  - Expected outcome: the started-run response, the streamed transcript, and the persisted conversation metadata all agree on the provider and model that actually executed, even when the originally requested provider or model could not run.
- Duplicate-agent precedence marker:
  - Expected outcome: the selected runtime root resolves from `codeinfo_agents` when both folder names exist, and the agent list plus the selected agent or flow details surface show the warning about the ignored legacy duplicate.
- Established-conversation pinning marker:
  - Expected outcome: a later turn on the same conversation reuses the stored provider, model, and `agentName`, and if that stored execution pair later becomes unavailable, the failure appears inside that same conversation instead of silently switching providers or starting a new conversation.

## Test Harnesses

- Backend proof should continue to use the repository wrapper-first workflow from `AGENTS.md`, with `npm run test:summary:server:unit` and `npm run test:summary:server:cucumber` as the normal top-level server proof commands.
- Frontend proof should continue to use `npm run test:summary:client` for client unit coverage and `npm run test:summary:e2e` for automated browser proof.
- `server/package.json` already uses Testcontainers-backed support files for backend integration and Cucumber suites; this story should extend those harnesses rather than invent parallel integration infrastructure.
- `docker-compose.yml` is the default human-stack proof surface for working-repository and mounted-runtime behavior; later manual proof should prefer `npm run compose:build` followed by `npm run compose:up`.
- `docker-compose.local.yml` should be reserved for cases that honestly need its extra source bind mounts or Docker-socket behavior, and `docker-compose.e2e.yml` should remain the browser-automation stack rather than the main mounted working-repository proof stack.
- Any fallback-provider simulation, alternate auth state, duplicate-agent fixture, or seeded runtime state should live in test-only fixtures, compose wiring, or harness configuration rather than shipped production behavior.
- Deterministic continuation and fallback proof should assert ordering through observable boundaries such as the started-run response, streamed transcript, persisted conversation metadata, and stable conversation id rather than fixed sleeps or absence-only checks.

## Edge Cases And Failure Modes

- Missing `codeinfo_config/config.toml` must remain non-fatal and must not cause repository files to be auto-created.
- Missing, unreadable, or invalid provider `chat/config.toml` files currently degrade through warning-first default resolution; the new provider-neutral agent resolver should preserve that behavior where the story explicitly allows fallback instead of turning every optional config issue into a startup failure.
- `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` needs an explicit normalization contract: trim whitespace, drop blanks, remove duplicates, ignore unknown provider ids with warnings, and fall back to the default order only when normalization leaves no usable configured providers.
- Provider unavailability and provider-local model repair are separate failure classes: a missing model on an otherwise available provider should stay on that provider, while cross-provider fallback should run only when the selected provider cannot actually execute.
- Startup-created provider config artifacts must be safe to observe while the app is running: readers should see either the old readable file or the new readable file, never a half-written managed config artifact.
- Duplicate agents between `codeinfo_agents` and `codex_agents` must not silently shadow one another; discovery and details surfaces need explicit warning behavior when the new folder wins over the legacy copy.
- Shared execution-context logic must preserve current `working_folder` error codes and mapped-path behavior across chat, agents, flows, and `code_info`.
- Established conversations must stay pinned to the stored provider, model, and `agentName`; later unavailability should fail clearly inside that conversation rather than silently switching execution identity.
- Switching from an existing conversation to a fresh conversation must not carry the old conversation's stored provider, model, or disabled-state assumptions into the new run path unless the newly resolved config independently chooses the same execution pair.
- Contradictory mixed state, such as resuming an existing conversation while the current selected agent points to a different execution identity, must not silently mutate the stored conversation identity.
- Placeholder provider or model values written before fallback completes must never become the authoritative continuation pair for later turns.
- Provider fallback must tolerate incompatible provider-specific keys by filtering or warning on them rather than failing purely because a fallback provider cannot consume Codex-owned runtime settings.

## Implementation Ideas

### Implementation Seams

- Shared runtime-config layering seam:
  - Add one shared helper that reads optional `codeinfo_config/config.toml`, then merges provider base config plus chat or agent runtime config in the documented precedence order. Keep `codeinfo_config/config.toml` read-only and treat blank metadata values as unset before merge decisions.
- Provider-base bootstrap seam:
  - Extend startup-owned config bootstrap so `copilot/config.toml` and `lmstudio/config.toml` are created through the same product-owned path as Codex base config, without waiting for first provider use.
- Agent metadata parsing seam:
  - Read `codeinfo_provider` from the agent `config.toml` before full provider-runtime construction, default blank or missing values to `codex`, and strip `codeinfo_*` metadata before passing provider config into any SDK or harness.
- Neutral agent-home env seam:
  - Introduce one env-resolution helper that trims `CODEINFO_AGENT_HOME` and `CODEINFO_CODEX_AGENT_HOME`, treats blank values as unset, and resolves the new name ahead of the legacy alias.
- Folder precedence and duplicate detection seam:
  - Centralize `codeinfo_agents` over `codex_agents` precedence in one reusable helper that is shared by discovery and cross-repository command lookup, and make duplicate detection return warning metadata instead of silently shadowing the legacy copy.
- Shared execution-context seam:
  - Extract the current Codex default-working-directory logic into one provider-neutral repository execution-context helper that resolves selected working folder, default execution root, runtime metadata, and any provider-facing working-directory override.
- Chat consumer seam:
  - Switch the chat route to consume the shared execution-context helper without changing normal chat-only provider selection behavior.
- Direct agent and command consumer seam:
  - Switch direct agent execution and command lookup onto the shared execution-context and neutral agent-home helpers so provider selection, folder precedence, and runtime metadata cannot drift from one another.
- Flow-owned agent consumer seam:
  - Switch flow-owned agent execution onto the same shared execution-context, provider selection, and warning paths used by direct agent runs, while keeping flow-owned warning surfaces separate from direct-agent UI surfaces.
- `code_info` consumer seam:
  - Route `code_info` through the same repository execution-context contract so repository grounding does not depend on a chat-only or Codex-only path when provider is omitted.
- Agent fallback-order seam:
  - Add one agent-only fallback resolver that trims and normalizes `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, skips the originally failed provider, records warning metadata, and stays scoped to direct agent runs plus flow-owned agent runs.
- Provider-local model-repair seam:
  - Keep missing-model recovery on the originally selected provider first, using same-model then provider-chat-config model then provider default model, before any cross-provider fallback begins.
- Cross-provider fallback seam:
  - When provider fallback is actually needed, carry forward shared runtime settings, drop incompatible provider-specific settings with warnings, and keep the entire recovery path inside the existing run-lock and inflight ownership model.
- Conversation-establishment persistence seam:
  - During the first successful run, persist the actual execution provider, model, `agentName`, and provider-owned continuation metadata into the existing conversation record without mutating the underlying agent config.
- Later-turn continuation seam:
  - On later turns, read the stored provider, model, and `agentName` from the existing conversation record, validate that saved execution pair, re-resolve live agent-owned files from that identity, and fail in place if the saved provider, model, or agent name no longer runs.
- Warning and disabled-surface seam:
  - Surface invalid-provider, fallback, and duplicate-agent warnings through the agent list payload and selected-agent details surface, reuse the same warning data for equivalent flow-owned agent details surfaces where they already exist, and keep unrunnable agents visible with `disabled` plus warnings instead of removing them from discovery.
- Selected-agent and resume-state seam:
  - Keep existing-conversation resume state authoritative over later UI selection changes, reevaluate state only on fresh conversation start, and exclude stale runnable-state assumptions from new-run payloads when the currently selected agent is disabled or warning-gated.
- Default-path reachability seam:
  - Update the normal startup and compose-owned paths so shared bootstrap, `server/.env`, `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` all honor the new neutral agent-home and provider-bootstrap rules without one-off operator edits.

### Proof Seams

- Merge-precedence and metadata-stripping proof seam:
  - Prove layered merge order, blank-input normalization, and `codeinfo_*` metadata stripping independently from provider execution behavior.
- Folder-precedence and duplicate-warning proof seam:
  - Prove `codeinfo_agents` wins over `codex_agents`, duplicate warnings surface in the expected payloads, and cross-repository command lookup follows the same precedence helper.
- Shared execution-context proof seam:
  - Prove selected-working-folder and no-working-folder cases separately, including preserved `working_folder` error codes and Copilot working-directory consumption.
- Fallback and model-repair proof seam:
  - Prove provider-local model repair separately from cross-provider fallback, including normalized fallback-order handling, warning output, and actual executed provider-model persistence.
- Established-conversation continuation proof seam:
  - Prove later turns reuse the stored execution pair, keep config changes scoped to new conversations, and fail clearly inside the same conversation when the saved provider, model, or agent name no longer runs.
