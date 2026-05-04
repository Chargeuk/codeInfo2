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

This story introduces a provider-neutral agent runtime contract built from layered config files with clear precedence. The lowest-precedence layer is a new repo-local `codeinfo_config/config.toml`. Above that sits the selected provider's base `config.toml`, such as `codex/config.toml`, `copilot/config.toml`, or `lmstudio/config.toml`. The highest-precedence runtime file is either the selected provider's `chat/config.toml` for chat-driven surfaces or the selected agent's own `config.toml` for agent-driven surfaces. Higher-precedence values replace lower-precedence values. If `codeinfo_config/config.toml` has not been created yet, the runtime should continue cleanly without trying to auto-create repository files at startup.

For agents, the selected provider comes from a new app-owned metadata field inside the agent's own `config.toml`: `codeinfo_provider`. If that field is absent, the provider defaults to `codex` so today's checked-in agents continue to work without manual migration. If the field is present but invalid, that agent should fail clearly rather than silently defaulting to Codex. Chat runtime config does not need the same field because the provider is already selected through the chat contract rather than through an agent definition.

This story also introduces a shared provider-neutral repository execution-context contract for chat and agent runs. Shared code should resolve repository execution context once and pass the resulting context to whichever provider executes the run. That shared context should always include the selected repository path as runtime metadata when a `workingFolder` has been chosen and should also include a resolved runtime working-directory override for providers that support it directly. When no `workingFolder` has been selected, the common execution-context resolver should still choose the effective default execution root using the same precedence Codex uses today, rather than letting each provider fall back to its own unrelated process working directory. Codex and Copilot should consume that runtime working-directory value in this story. LM Studio should receive the same shared context even if its current provider implementation only uses the repository metadata or provider-specific tools rather than the same direct working-directory mechanism.

When an agent explicitly selects a provider that is unavailable, this story should not stop at the first failure. Instead, agent execution should evaluate a configurable fallback provider order from a new comma-separated env var in `server/.env`, with a default order of `codex,copilot`. `lmstudio` should be a valid value in that env var, but it should not appear in the default list. This fallback rule applies only to direct agent runs and flow-owned agent runs; it does not change normal chat behavior. The fallback rule is also a separate recovery step, not part of the normal agent config merge precedence. If the runtime falls back to another provider, it should try the same model first when that model exists on the fallback provider, then the model defined in that provider's chat config, and then the default model for that provider. If the originally failed provider also appears in the configured fallback list, it should be skipped rather than tried again. If no configured fallback provider can run, the request should fail clearly. Each fallback event should produce both warning logs and warning-capable GUI or API messages so users can see what happened.

This story also shifts the preferred agent folder name from `codex_agents` to `codeinfo_agents` while keeping the old folder name supported for compatibility. The new folder always wins when both are present, and that precedence must apply consistently in local discovery and in cross-repository command lookup. If the same agent exists in both folders, the ignored legacy copy should produce a warning that is both logged and surfaced through existing warning-capable API or UI responses. The same compatibility rule applies to environment naming: a new neutral agent-home contract can be introduced, but `CODEINFO_CODEX_AGENT_HOME` must remain supported as a legacy alias, and the new neutral env var should win when both are set.

The user's chosen scope for this story is intentionally config-driven. This story does not add new agent-page controls, does not add new MCP input overrides for agent provider selection, and does not introduce an extra manual override layer on top of the merged config. The runtime should simply execute according to the merged `config.toml` values plus the shared repository execution context where a working folder has been selected.

One additional requirement is that the repo-owned `code_info` MCP definition and repo-owned instruction surfaces in this codebase should stop biasing callers toward Codex or toward any explicit model choice. The tool definition should treat both `provider` and `model` as explicit override fields only, and agents should omit them unless the user has specifically asked for a provider-specific or model-specific run. Omitted-field behavior can still follow the server's normal shared default-resolution contract, but the repo-owned tool contract and repo-owned prompts in this repository should no longer encourage or imply a Codex-first or model-pinning caller habit. In addition, omitted-provider or non-Codex execution must remain repository-grounded when the repository is available to the harness; provider neutrality is not complete if a non-Codex `code_info` execution loses repository context that the Codex path currently receives through working-directory or runtime wiring.

### Acceptance Criteria

- A new repo-level base runtime config exists at `codeinfo_config/config.toml`.
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
- If `codeinfo_provider` is present but invalid, that agent fails clearly instead of silently defaulting to `codex`.
- Chat runtime config does not require or depend on `codeinfo_provider`.
- If `codeinfo_provider` appears in a config surface where it does not apply, the runtime ignores it with a warning instead of failing validation.
- The runtime strips app-owned `codeinfo_*` metadata before passing provider config into the relevant provider SDK or harness.
- `codex/config.toml` remains supported as the Codex provider base config.
- `copilot/config.toml` becomes a first-class provider base config resolved in the same product-owned way as Codex base config.
- `lmstudio/config.toml` becomes a first-class provider base config resolved in the same product-owned way as Codex base config.
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
- Provider fallback is a separate recovery step and does not change the normal agent runtime config precedence.
- If provider fallback runs, the model selection order is: the same model on the fallback provider when available, then the model defined in that fallback provider's chat config, then that fallback provider's default model.
- If the originally failed provider also appears in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, the runtime skips it and moves to the next configured provider.
- If no configured fallback provider can execute the agent run, the run fails clearly.
- Provider fallback emits both warning logs and warning-capable API or GUI warnings.
- Existing commands and flows that execute agents continue to work after provider-neutral runtime selection is introduced.
- Flow-owned agent execution uses the same shared repository execution-context contract as direct agent execution.
- The current Codex-specific default-working-directory selection logic is removed from provider-specific execution code and replaced by the shared execution-context resolver.
- Codex consumes the shared runtime working-directory override.
- Copilot consumes the shared runtime working-directory override.
- LM Studio receives the shared repository execution context even if its provider-specific implementation does not use the same direct runtime working-directory mechanism as Codex or Copilot.
- The preferred agent folder name becomes `codeinfo_agents`.
- The legacy `codex_agents` folder remains supported for backward compatibility.
- A legacy environment variable such as `CODEINFO_CODEX_AGENT_HOME` remains supported as an alias to the preferred neutral agent-home contract.
- If both the new neutral agent-home env var and `CODEINFO_CODEX_AGENT_HOME` are set, the new neutral env var wins and the legacy alias is treated as a fallback only.
- When both `codeinfo_agents` and `codex_agents` are present for the same lookup path, `codeinfo_agents` always wins.
- When the same agent is found in both folders, the runtime logs a warning and also surfaces that warning through existing warning-capable API or UI responses.
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
- Removing `codex_agents` support in this story.
- Introducing new provider types beyond Codex, Copilot, and LM Studio.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

- Later manual proof should cover at least one agent configured for each provider, plus one scenario where both `codeinfo_agents` and `codex_agents` exist so precedence can be observed honestly.
- Later manual proof should include at least one command or flow path that resolves agent-owned files from another repository root, because folder precedence must match there as well.
- When proving the `code_info` change later, prefer artifact capture that shows the actual request payload or observable provider-selection behavior so the omission contract is visible.

### Questions

1. Should `codeinfo_config/config.toml` be optional, or should every repository be expected to have one?
   - Why this is important: The plan currently says the file exists, but also says the runtime should keep going if the file is missing, so the story needs one clear contract.
   - Best Answer: It should be optional. In simple terms, the runtime should support the file when a repository chooses to add it, but should not require it to exist before the story works.
   - Where this answer came from: Direct repo review of this story file, especially the acceptance criteria that currently say both “exists” and “continues cleanly if missing.”

2. What should the new neutral agent-home env var be called?
   - Why this is important: The story says a new neutral env var should win over `CODEINFO_CODEX_AGENT_HOME`, but it never names that new variable, so two developers could implement different names.
   - Best Answer: Use `CODEINFO_AGENT_HOME`. In simple terms, it is short, clear, and directly matches what the variable controls without keeping the old Codex-specific wording.
   - Where this answer came from: Direct repo review of this story file, especially the description and acceptance criteria that refer to “the new neutral env var” without naming it.

3. If an agent has an invalid `codeinfo_provider`, should it show as disabled with a warning, or only fail when someone tries to run it?
   - Why this is important: The plan says the agent should fail clearly, but it does not say when that failure becomes visible to the user.
   - Best Answer: It should show as disabled with a warning. In simple terms, this tells the user what is wrong before they try to run the agent, instead of letting them discover the problem only after pressing Run.
   - Where this answer came from: Direct repo review of this story file, especially the current “fail clearly” wording and the existing plan language about surfacing warnings through API or UI responses.

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

5. Decision: when both agent-home env vars are set, the new neutral env var should win.
   - The question being addressed: If both agent-home env vars are set, should the new one win, or should the old alias still take priority?
   - Why the question matters: The story keeps `CODEINFO_CODEX_AGENT_HOME` as a legacy alias, so conflicting env values need one clear precedence rule.
   - What the answer is: The new neutral agent-home env var wins, and `CODEINFO_CODEX_AGENT_HOME` is used only as a fallback compatibility alias with a warning.
   - Where the answer came from: Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/config/runtimeConfig.ts`, `server/src/config/codexConfig.ts`, and `server/src/test/unit/config.chatDefaults.test.ts`, plus local repo-precedent retrieval from `code_info` during this planning round.
   - Why it is the best answer: It follows this repo's normal canonical-over-legacy precedence pattern and gives users a predictable migration path away from the old Codex-specific name.

6. Decision: when the same agent appears in both folders, the warning should be logged and also surfaced through existing warning-capable API or UI responses.
   - The question being addressed: If the same agent appears in both folders, should the warning stay in logs only, or also appear in API and UI warnings?
   - Why the question matters: The story already gives `codeinfo_agents` precedence, but users still need a clear way to understand why the legacy copy was ignored.
   - What the answer is: Log the collision and also surface the warning through API or UI warning fields where those surfaces already support warnings.
   - Where the answer came from: Repo evidence in `server/src/config/chatDefaults.ts`, `server/src/routes/chatDiscovery.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chat.ts`, `server/src/agents/types.ts`, and `client/src/pages/AgentsPage.tsx`, plus local repo-precedent retrieval from `code_info` during this planning round.
   - Why it is the best answer: It matches the repo's broader warning pattern, keeps the precedence behavior diagnosable for users, and avoids forcing routine troubleshooting through server logs alone.

7. Decision: if an agent has an invalid `codeinfo_provider`, that agent should fail clearly rather than defaulting silently to Codex.
   - The question being addressed: If an agent has an invalid `codeinfo_provider`, should that agent fail clearly or quietly default to Codex?
   - Why the question matters: `codeinfo_provider` is an explicit per-agent runtime choice, so bad values need one clear contract.
   - What the answer is: Fail clearly for that agent. Codex remains the default only when `codeinfo_provider` is absent.
   - Where the answer came from: Repo evidence in `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`, `server/src/ingest/requestContracts.ts`, `server/src/routes/ingestStart.ts`, and `server/src/config/chatDefaults.ts`, plus local repo-precedent retrieval from `code_info` during this planning round.
   - Why it is the best answer: It matches the repo's usual handling for invalid explicit provider values and avoids silently changing an agent's declared runtime choice.

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

## Implementation Ideas

- Add a new shared config helper for repo-local `codeinfo_config/config.toml` and refactor runtime resolution so it can compose three layers instead of only the current Codex base-plus-runtime contract.
- Treat `codeinfo_config/config.toml` as an optional read-if-present layer so startup falls back cleanly when repositories have not created the file yet.
- Promote provider selection for agents into app-owned metadata by reading `codeinfo_provider` from the agent `config.toml` before the full merge runs.
- Extend the existing `codexConfig` bootstrap pattern to first-class provider base configs for Copilot and LM Studio, likely with a dedicated LM Studio config helper and an expanded Copilot config helper.
- Keep invalid `codeinfo_provider` handling strict by failing the affected agent clearly instead of silently remapping it onto Codex.
- Keep the merged runtime contract portable by treating `codeinfo_*` keys as repository-owned metadata that is removed before provider SDK construction.
- Extract the current Codex default-working-directory resolution logic into a shared repository execution-context helper that resolves both selected-working-folder and no-working-folder cases, then returns provider-neutral runtime metadata plus any resolved runtime working-directory override.
- Update agent discovery, agent execution, command lookup, and flow-owned agent execution together so provider and folder selection stay consistent across all agent surfaces.
- Use that shared repository execution-context helper in the chat route, direct agent execution, flow-owned agent execution, and `code_info` execution so provider behavior cannot drift by surface.
- Let provider implementations consume the shared repository execution context according to their own capabilities: Codex and Copilot should use the runtime working-directory override directly, while LM Studio may initially rely on repository metadata, provider-specific tools, or later working-directory-capable wiring.
- Add targeted proof that Copilot chat and Copilot-backed agent execution actually receive and use the selected working folder, because that is the main current product gap.
- Add a shared provider-fallback resolver for agent execution that reads `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER`, applies the configured provider order, and records warning metadata whenever a fallback provider is used.
- Keep that fallback resolver scoped to direct agent runs and flow-owned agent runs so normal chat continues to use its existing behavior.
- Reuse provider-model discovery so fallback acts as a separate recovery step: try the same model on the next provider first, then that provider's chat-config model, and finally that provider's default model before moving on or failing.
- Skip the originally failed provider if it also appears in `CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER` rather than retrying it inside the fallback loop.
- Support a new neutral agent-home contract without breaking existing `CODEINFO_CODEX_AGENT_HOME` users by resolving the legacy variable as an alias during the migration window.
- Resolve the new neutral agent-home env var ahead of `CODEINFO_CODEX_AGENT_HOME` so the legacy name behaves as a fallback compatibility alias rather than a competing primary setting.
- Centralize folder precedence in one reusable helper so local discovery and cross-repository lookups cannot drift apart.
- Surface duplicate-agent precedence warnings through existing warning-capable API or UI paths as well as server logs so users can understand why a legacy copy was ignored.
- Update the `code_info` MCP schema text so both `provider` and `model` are documented as explicit override fields rather than normal caller-populated inputs.
- Update repo-owned instruction surfaces that teach agents how to use `code_info` so they explicitly say to omit `provider` and `model` unless the user requests a provider-specific or model-specific run.
- Add regression coverage for the MCP tool definition payload so future `tools/list` responses cannot silently drift back to Codex-biased or model-pinning wording.
- Add execution-path tests that prove omitted `provider` and omitted `model` follow the normal shared server resolution rules instead of requiring callers to pre-resolve those values themselves.
- Treat inapplicable `codeinfo_provider` usage as a warning path so invalid placement is visible in logs without blocking the wider runtime contract.
- Add targeted proof first around merge precedence and metadata stripping, then broader proof around provider-specific agent execution and folder-compatibility lookup.
