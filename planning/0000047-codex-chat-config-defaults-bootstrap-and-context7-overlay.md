# Story 0000047 – Codex Chat Config Defaults Bootstrap And Context7 Overlay

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Codex runtime defaults in the product are currently spread across more than one place. Some behavior already comes from `codex/chat/config.toml`, some model-list behavior still comes from environment variables, and bootstrap logic for missing config files still relies on templates that do not fully match the currently desired defaults. That makes the web chat page, the MCP chat interface, startup bootstrap behavior, and configuration editing harder to reason about than they should be.

Users want one predictable outcome:

- if they set the model in `codex/chat/config.toml`, that model should always appear as an available chat model and should always be the default chat model unless a request explicitly overrides it;
- if `Codex_model_list` already defines an order, runtime list merging should preserve that order and only append the chat-config model when it is missing;
- if they edit `codex/chat/config.toml`, the next request for models or defaults should reflect the file as it exists on disk at that moment;
- if `codex/chat/config.toml` is unreadable or invalid, this story should keep the existing warning-and-fallback behavior for default resolution rather than broadening scope into a new hard-error contract;
- if the required config files do not exist yet, the server should generate them from one canonical in-code template instead of depending on external template files that may not exist on another system.

There is also a related environment-key problem for Context7. Current template content contains a Context7 API key argument in config data. The user wants Context7 to be driven by a new environment variable named `CODEINFO_CONTEXT7_API_KEY`. When runtime config is read, any Context7 MCP args that do not currently contain a usable API key should be overlaid in memory with that env value. The user has explicitly chosen an in-memory overlay, not repeated on-disk config rewriting.

For this story, both the explicit placeholder key value `REPLACE_WITH_CONTEXT7_API_KEY` and the current checked-in legacy seed value `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866` are treated as “no usable key configured.” If `CODEINFO_CONTEXT7_API_KEY` is set to a non-empty value, runtime config should overlay that value in memory. If `CODEINFO_CONTEXT7_API_KEY` is missing or empty, runtime config should fall back to the no-key form `args = ['-y', '@upstash/context7-mcp']`, which still works with the provider’s limited unauthenticated allowance.

For first-time bootstrap, the canonical in-code `codex/config.toml` template and the canonical in-code `codex/chat/config.toml` template should both use `model = "gpt-5.3-codex"` as the default Codex model for this story. Other surface-specific defaults such as approval policy can remain different where that behavior is already intentional and in scope.

For avoidance of doubt, this story is about runtime read behavior and first-time bootstrap behavior, not about inventing a migration layer. If a config file already exists but is invalid, unreadable, or user-edited, this story should not silently replace that file. Bootstrap only applies when the target file is missing. Likewise, the Context7 overlay is an in-memory normalization step applied to the runtime config object returned for use by chat or agent execution; it is not a background rewrite step and it must not reorder or discard unrelated MCP server args.

Repository research also showed a second source-of-truth risk that this story should close explicitly: today the repo still contains a checked-in `config.toml.example`, and current bootstrap code may consult that sample file. For this story, that sample file may remain as documentation if desired, but runtime bootstrap behavior must no longer depend on it. Research also showed that official Context7 documentation supports both local stdio MCP definitions with `args` and remote HTTP definitions with headers. This story is intentionally scoped only to the local stdio `args`-based Context7 shape that this repository currently seeds and runs.

Repository audit also showed a runtime-merge consequence that this story must handle explicitly. Today the shared runtime-config merge only carries the `projects` table forward from `codex/config.toml` into chat or agent runtime config, and the current chat bootstrap path hides that limitation by copying the whole base file into `codex/chat/config.toml` when chat config is missing. Once chat bootstrap moves to a minimal canonical chat template, shared base-only runtime settings that execution still depends on must remain available through one shared merge or inheritance path instead of by duplicating the whole base config into the chat file. That includes MCP server definitions and any other base-only runtime settings that current execution paths already rely on.

This story therefore unifies four closely related behaviors:

- model-list resolution;
- default-model resolution;
- deterministic bootstrap of missing `codex/config.toml` and `codex/chat/config.toml`;
- runtime Context7 API-key overlay.

The scope of this story is runtime-config correctness and consistency. It is not about changing prompt behavior, tool guidance, or workflow step execution.

### Acceptance Criteria

- The server treats the model in `codex/chat/config.toml` as a first-class available Codex chat model even when it is not present in `Codex_model_list`.
- The shared Codex capability/model-resolution path used by chat surfaces is responsible for the merged model list behavior for this story; the story does not rely on separate one-off list merging rules in individual routes.
- When the server resolves the Codex model list, it uses:
  - the environment model list;
  - unioned with the current model value from `codex/chat/config.toml`;
  - with duplicates removed deterministically;
  - preserving environment-list order and appending the chat-config model only when it is otherwise missing.
- The model defined in `codex/chat/config.toml` is always the default Codex chat model unless the request explicitly overrides it.
- Default model precedence is:
  - explicit request override;
  - `codex/chat/config.toml`;
  - environment fallback;
  - hardcoded fallback.
- If `codex/chat/config.toml` is unreadable or invalid, the chat-default resolution path continues to warn and fall back to env/hardcoded defaults for this story instead of surfacing a new hard error.
- If `codex/chat/config.toml` exists but is unreadable or invalid, this story leaves that file in place and does not regenerate, repair, or overwrite it as part of fallback behavior.
- The server rereads `codex/chat/config.toml` from disk each time model availability or default-model selection is requested.
- The web chat model list reflects the current `codex/chat/config.toml` model on each request.
- MCP chat/default-model selection reflects the current `codex/chat/config.toml` model on each request.
- `/chat/providers` reflects the current Codex default/model-selection behavior from the shared Codex-aware path instead of keeping a separate env-only Codex default path.
- Codex-facing server entrypoints that choose an execution model, including `codebaseQuestion`, use the same chat-config-aware Codex model/default behavior as the REST chat surfaces instead of reading defaults and capability lists through separate non-merged paths.
- The existing React/MUI client path (`client/src/hooks/useChatModel.ts` plus the `TextField`/`MenuItem` selects in `client/src/pages/ChatPage.tsx`) continues to consume `/chat/providers` and `/chat/models` without a story-specific response-shape change or dedicated frontend implementation task.
- `CHAT_DEFAULT_MODEL` remains a fallback only and no longer overrides a valid model value in `codex/chat/config.toml`.
- If `codex/chat/config.toml` does not exist, the server creates it from one canonical in-code chat-config template.
- If `codex/config.toml` does not exist, the server creates it from one canonical in-code base-config template.
- The canonical in-code base-config template and canonical in-code chat-config template both use `model = "gpt-5.3-codex"` for this story’s bootstrap behavior.
- The canonical in-code templates are the source of truth for first-time file creation and do not depend on runtime access to files such as `codex/chat/config copy.toml`, `codex/config.toml`, or `config.toml.example`.
- `config.toml.example` may remain in the repository as a human-facing sample, but it is not consulted, copied, or parsed by runtime bootstrap code in this story.
- When `codex/chat/config.toml` is missing, bootstrap uses the canonical in-code chat template directly for that file rather than copying the base config into the chat config and then mutating it afterward.
- Missing-file bootstrap does not overwrite existing user-edited config files.
- The shared runtime-config resolution path used by `resolveChatRuntimeConfig()` and `resolveAgentRuntimeConfig()` preserves the shared base-config data that execution still needs when runtime-specific config omits it, so moving chat bootstrap to a minimal chat template does not remove existing execution behavior.
- At minimum, base-config `mcp_servers`, `model_provider`, and `model_providers` remain available in resolved chat and agent runtime config unless explicitly overridden by runtime-specific config.
- Direct chat-template bootstrap does not remove shared runtime settings that current execution paths already inherit from base config, such as MCP server availability, tool settings, `personality`, or provider-routing configuration (`model_provider` and `model_providers`).
- Runtime config loading applies `CODEINFO_CONTEXT7_API_KEY` as an in-memory overlay for Context7 MCP args when a Context7 server definition exists and no usable API key is effectively present.
- Runtime config loading treats `--api-key REPLACE_WITH_CONTEXT7_API_KEY` and `--api-key ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866` as equivalent to no usable key being present.
- If a Context7 definition contains either placeholder-equivalent value and `CODEINFO_CONTEXT7_API_KEY` is set to a non-empty value, runtime config overlays that env key in memory.
- If a Context7 definition contains either placeholder-equivalent value and `CODEINFO_CONTEXT7_API_KEY` is missing or empty, runtime config uses the no-key argument form `args = ['-y', '@upstash/context7-mcp']`.
- When the no-key fallback is used, only the `--api-key` pair is removed or replaced; unrelated Context7 args and unrelated MCP server definitions remain unchanged and in their original order.
- If a Context7 definition already contains a non-placeholder API key argument, that explicit value wins and this story does not override it from `CODEINFO_CONTEXT7_API_KEY`.
- The Context7 overlay rules in this story apply only to local stdio-style Context7 definitions that use `command` plus an `args` array. Remote `url`/`http_headers` Context7 definitions are left unchanged in this story.
- Runtime config loading does not rewrite config files on disk just to apply `CODEINFO_CONTEXT7_API_KEY`.
- The Context7 overlay applies consistently to the relevant config-reading paths used by chat and agent runtime config loading.
- The resulting runtime config still preserves unrelated MCP-server args and unrelated config values.
- This story removes dependence on checked-in Context7 key material in canonical default templates.
- Public REST and MCP payload shapes remain unchanged for this story.

### Out Of Scope

- Changing agent prompts, MCP tool descriptions, or repository guidance text.
- Adding new workflow step types or command/flow execution behavior.
- Changing auth propagation behavior for agent homes.
- Rewriting user-edited config files on each request to inject environment values.
- Introducing provider-selection behavior changes beyond the default-model and model-list correctness described in this story.
- Changing the existing chat-default unreadable/invalid-config contract from warnings-and-fallbacks to a new hard-error behavior.
- Silently repairing or replacing invalid existing config files as part of runtime fallback handling.
- Reordering unrelated MCP args or unrelated model entries beyond the explicit merge rule defined in this story.
- Adding support in this story for remote/header-based Context7 config normalization beyond the local stdio `args` shape already used by this repository.
- Building generic credential validation for arbitrary user-supplied Context7 API keys beyond the explicit placeholder-equivalent values in scope for this story.
- Building a general-purpose config migration framework.

## Questions

- No Further Questions

### Decisions

1. Question: When the Codex model list is built from `Codex_model_list UNION codex/chat/config.toml`, what exact deterministic order should be returned before any UI-level prioritization? Why it matters: this story needs a single predictable merge rule without accidentally changing user-specified ordering or duplicating the same prioritization logic in two places. Decision: preserve the existing environment-list order and append the chat-config model only when it is missing; do not move the chat-config model to the front in the capability/model-list layer. Source and why this is best: current repo patterns already preserve first-seen order with `Array.from(new Set(...))` in `server/src/config/codexEnvDefaults.ts`, keep config precedence separate from list ordering in `server/src/config/chatDefaults.ts`, and apply any front-of-list preference later in the route layer via `prioritizeModel` in `server/src/routes/chatModels.ts`. External confirmation came from MDN’s `Set` documentation, which states iteration is in insertion order, and common JavaScript practice documented on Stack Overflow that `Array.from(new Set(array))` deduplicates while preserving original order. This is the best fit because it is the smallest change, keeps model availability separate from UI prioritization, matches existing repository patterns, and stays inside the story scope.
2. Question: What exact default model values should the new canonical in-code templates contain for `codex/config.toml` and `codex/chat/config.toml`? Why it matters: the story is explicitly about one canonical bootstrap source of truth, and leaving different template model values in place would preserve today’s confusing split-brain behavior. Decision: both canonical in-code templates should use `model = "gpt-5.3-codex"` for this story. Source and why this is best: in the current repo, `server/src/config/runtimeConfig.ts` already bootstraps chat config with `gpt-5.3-codex`, `server/src/config/chatDefaults.ts` already hard-falls back to `gpt-5.3-codex`, and unit tests in `server/src/test/unit/config.chatDefaults.test.ts` assert that fallback. The mismatched `gpt-5.3-codex-spark` base template in `server/src/config/codexConfig.ts` is therefore the outlier. Upstream confirmation came from DeepWiki’s `openai/codex` configuration documentation, which describes layered Codex config with `model`, `mcp_servers`, and `model_providers` as first-class config fields, and from direct repo inspection showing this story is correcting a repository-specific split rather than following a competing upstream default. This is the best answer because it aligns bootstrap with existing runtime behavior and tests, avoids a broader provider/model-policy change, and keeps the story narrowly focused on consistency.
3. Question: If `codex/chat/config.toml` exists but is unreadable or contains invalid TOML, should runtime behavior continue to fall back to env/hardcoded defaults with warnings, or should this story change that behavior to surface an error instead? Why it matters: this story touches repeated rereads of chat config, so the plan needs to say whether it is also changing failure semantics or only making runtime-default resolution consistent. Decision: keep the existing warning-and-fallback behavior for chat-default resolution; do not expand this story into a new hard-error contract. Source and why this is best: current repo behavior already does this in `server/src/config/chatDefaults.ts` via `readChatConfigSafely`, and `server/src/test/unit/config.chatDefaults.test.ts` explicitly asserts that invalid TOML produces warnings while returning fallback defaults. The harder error path in `server/src/config/runtimeConfig.ts` remains valid for callers that require a strict config snapshot, but story 0000047 is about model/default correctness and bootstrap consistency, not changing every consumer’s failure semantics. Direct inspection of `client/src/hooks/useChatModel.ts` and `client/src/pages/ChatPage.tsx`, together with current React 19 and MUI docs, also showed that the client already reacts to refreshed server responses through state-driven controlled selects, so preserving the existing server warning contract avoids an unnecessary client contract change. This is the best fit because it preserves compatibility, avoids unnecessary surface-area changes, and stays inside the existing acceptance scope.
4. Question: Existing seeded base configs may already contain the current checked-in Context7 API-key value rather than the new `REPLACE_WITH_CONTEXT7_API_KEY` placeholder. Should this story treat that existing checked-in value as an unusable placeholder at runtime as well, or only apply special handling to the new placeholder string? Why it matters: if old seeded configs keep a checked-in key literal that is no longer meant to be trusted, this story would leave existing users depending on the very key material it is supposed to remove from canonical defaults. Decision: treat both the new placeholder string and the one legacy checked-in seed key literal as placeholder-equivalent unusable values at runtime, while not attempting any broader validation of arbitrary user-supplied keys. Source and why this is best: local repo evidence shows the legacy literal is still present in `config.toml.example` and `server/src/config/codexConfig.ts`, while newer agent configs already use `REPLACE_WITH_CONTEXT7_API_KEY`. Current Context7 documentation and repository docs confirm that local stdio usage works with plain `npx @upstash/context7-mcp` args and that remote/header-based definitions are a separate configuration shape, so falling back to the no-key args form is a supported path rather than a bespoke repo invention. This is the best answer because it removes dependence on the legacy seeded key for both fresh and already-seeded configs, stays narrowly scoped to two explicit placeholder-equivalent values, and avoids a bigger secret-migration or credential-validation feature.
5. Question: Should runtime bootstrap continue to consult checked-in sample files such as `config.toml.example`, or should those files become documentation-only once canonical in-code templates exist? Why it matters: repository research showed the current base bootstrap still checks for `config.toml.example`, which creates a second source of truth and can make first-run behavior depend on whichever file happens to be present. Decision: keep `config.toml.example` only as a human-facing sample if desired, but do not read, copy, or parse it as part of runtime bootstrap in this story. Source and why this is best: direct repo inspection showed `server/src/config/codexConfig.ts` still searches for and copies `config.toml.example`, while the story goal is a single canonical in-code bootstrap source. Node’s file-copy behavior via `COPYFILE_EXCL` is useful for non-overwrite safety, but it does not solve the source-of-truth problem created by consulting an external sample file. This is the best fit because it removes environmental drift, makes first-run behavior deterministic, and stays tightly aligned with the story’s stated bootstrap objective.
6. Question: Should this story normalize every possible Context7 configuration shape, including remote `url`/`http_headers` setups, or only the local stdio `command` plus `args` shape that this repository currently seeds? Why it matters: official Context7 documentation supports both local `args`-based usage and remote/header-based usage, but the repository’s existing templates and runtime behavior are stdio `args`-based. Decision: scope this story only to the local stdio `command` plus `args` shape and leave remote/header-based Context7 definitions unchanged. Source and why this is best: direct repo evidence shows the current templates in `server/src/config/codexConfig.ts` and `config.toml.example` use `npx` plus an `args` array, and current Context7 documentation documents separate contracts for local args-based setup versus remote HTTP header-based setup. This is the best fit because it prevents the story from silently expanding into multiple transport contracts while still fully covering the repository’s current runtime shape.
7. Question: Does this story need a dedicated frontend implementation task to reflect the corrected Codex model/default behavior? Why it matters: if the existing client cannot consume the corrected server responses, the plan would be missing interface work. Decision: no dedicated frontend implementation task is needed for this story unless later verification proves the server contract changed unexpectedly. Source and why this is best: direct repo inspection showed `client/src/hooks/useChatModel.ts` already fetches `/chat/providers` and `/chat/models`, stores those results in React state, and `client/src/pages/ChatPage.tsx` already renders them through controlled MUI `TextField` selects backed by `MenuItem` options. Current React 19 docs confirm state updates rerender existing controlled UI, and current MUI 6 docs confirm `TextField` with `select` uses the standard Select/MenuItem pattern this page already follows. This is the best fit because it keeps the story server-focused, avoids unnecessary client churn, and still requires final UI verification against the corrected server responses.

## Implementation Ideas

- `Model list and defaults`: keep `server/src/config/chatDefaults.ts` as the source for default-model precedence, and update the shared capability path in `server/src/config/codexEnvDefaults.ts` plus `server/src/codex/capabilityResolver.ts` so available-model resolution becomes `env list UNION chat-config model`. The merge should preserve env order, append the chat-config model only when missing, and leave route-level prioritization in `server/src/routes/chatModels.ts` as a separate concern.
- `Shared Codex-aware callers`: make the chat model list and Codex default-selection callers use the same underlying chat-config-aware read path so `/chat/models`, `/chat/providers`, `/chat` validation, and MCP `codebaseQuestion` cannot drift. Reuse `resolveCodexCapabilities()`, `resolveCodexChatDefaults()`, and `resolveRuntimeProviderSelection()` in place, and keep `prioritizeModel()` as a route-level list-ordering helper only where a model list is actually being presented. Keep `resolveChatDefaults()` as the generic env/fallback helper where that simpler behavior is still appropriate for non-Codex-specific decisions.
- `Base bootstrap`: update `server/src/config/codexConfig.ts` so `ensureCodexConfigSeeded()` stops consulting `config.toml.example` and always seeds from the canonical in-code base template. While doing that, align the base template model value with this story’s chosen bootstrap default `gpt-5.3-codex`.
- `Chat bootstrap`: update `server/src/config/runtimeConfig.ts` so `ensureChatRuntimeConfigBootstrapped()` creates a missing `codex/chat/config.toml` directly from the canonical chat template instead of copying the base config first. Keep the current non-destructive behavior for existing files, preserve the current warning-and-fallback contract when an existing chat config is unreadable or invalid, and pair that bootstrap change with a shared runtime merge that still makes required base-only config available at execution time.
- `Shared runtime inheritance`: replace the current projects-only merge in `server/src/config/runtimeConfig.ts` with one shared base/runtime inheritance step that keeps required base-only runtime config available to chat and agent execution while letting runtime-specific config override base values. At minimum this must keep `projects` and `mcp_servers`, and it should also preserve base-only settings such as `personality`, `tools`, and provider-routing config (`model_provider` and `model_providers`) when the runtime-specific file omits them. Do not build a generic recursive TOML merge for this story; explicitly inherit only the known keys in scope.
- `Context7 normalization`: add the in-memory overlay in `server/src/config/runtimeConfig.ts` on the merged runtime config object returned from shared config reads, not as a file rewrite. Scope it only to the local stdio `command` plus `args` form already used by this repo’s Context7 definitions, detect the two placeholder-equivalent key values, preserve explicit non-placeholder keys, and when no usable key is available strip only the `--api-key` pair while leaving unrelated args untouched.
- `Template cleanup`: update the canonical seeded Context7 definition in `server/src/config/codexConfig.ts` to stop embedding the legacy checked-in key in new bootstrap output. `config.toml.example` may remain as human documentation, but the runtime path should no longer depend on it as an input source for bootstrap logic.
- `Likely tests`: extend `server/src/test/unit/codexEnvDefaults.test.ts` and `server/src/test/unit/capabilityResolver.test.ts` for merged-model-list behavior; extend `server/src/test/unit/config.chatDefaults.test.ts` for “chat-config model remains default and merge-safe” behavior; extend `server/src/test/unit/runtimeConfig.test.ts` for direct chat-template bootstrap, no-example bootstrap, placeholder detection, explicit-key preservation, and no-key fallback behavior.
- `Likely tests`: extend `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/chatProviders.test.ts`, `server/src/test/unit/chatValidators.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`, and `server/src/test/integration/mcp-codex-wrapper.test.ts` where needed so every Codex-facing default-selection entrypoint and higher-level MCP wrapper path no longer drifts from the shared chat-config-aware behavior. Extend `server/src/test/unit/codexConfig.test.ts` for canonical base bootstrap behavior, and extend `server/src/test/unit/runtimeConfig.test.ts` for direct chat-template bootstrap plus shared base/runtime inheritance of MCP servers and other required base-only settings.
- `Current test contracts to replace`: `server/src/test/unit/runtimeConfig.test.ts` still asserts that missing chat config copies base config once when base exists, and current bootstrap tests still tolerate example/template split behavior. Those tests will need to be rewritten to assert the new direct-template bootstrap contract instead of today’s copy-from-base behavior.
- `Likely docs`: refresh `README.md`, `design.md`, and `projectStructure.md` so they describe `CODEINFO_CONTEXT7_API_KEY`, the shared model-list/default-model contract, the deterministic bootstrap source of truth, and the fact that `config.toml.example` is documentation-only rather than a runtime bootstrap dependency.
- `Implementation constraint`: keep the story focused on deterministic runtime config behavior inside the existing server config modules. There is no need for a new migration framework, remote Context7 config normalization, or payload-contract changes as long as the shared config/capability path stays the single place where model availability and runtime Context7 normalization are derived.

## Contracts And Storage Shapes

- No new public REST or MCP message contract is required for this story. The existing `/chat/models` response shape in `common/src/lmstudio.ts` and `openapi.json` remains the contract; Story 47 changes which Codex models appear in `models` and what values appear in `codexDefaults`/`codexWarnings`, but it does not add or remove response fields.
- No new persisted storage container is required for this story. The persisted config files remain `codex/config.toml` and `codex/chat/config.toml`, and the in-memory snapshot shape remains `RuntimeConfigSnapshot` in `server/src/config/runtimeConfig.ts`.
- `ChatModelsResponse`: keep the existing shape `{ provider, available, toolsAvailable, models, codexDefaults?, codexWarnings?, reason? }`. The story should update model-list contents via shared capability resolution rather than creating a second route-specific payload shape.
- `CodexCapabilityResolution`: keep the existing shape `{ defaults, models, byModel, warnings, fallbackUsed }` in `server/src/codex/capabilityResolver.ts`. The story may change how `models` and `warnings` are derived, but it should not introduce a parallel “merged model list” contract when the existing capability result already carries the needed information.
- `ResolvedCodexChatDefaults`: keep the existing `values`, `sources`, and `warnings` structure in `server/src/config/chatDefaults.ts`. The story changes which source wins in practice for the model list/default relationship, but it does not require a new default-resolution payload or new source enum.
- `RuntimeTomlConfig` and `RuntimeConfigSnapshot`: keep the existing generic TOML/config snapshot shapes in `server/src/config/runtimeConfig.ts`. Story 47 should normalize the existing `mcp_servers.context7` entry in memory and continue returning the same snapshot keys rather than adding special-case snapshot fields for Context7.
- Shared runtime-config resolution: keep the existing public `RuntimeConfigValidationResult` and `RuntimeConfigSnapshot` shapes, but update the shared merge behavior so runtime-specific config is resolved on top of base config rather than only merging `projects`. The merged result must preserve required base-only config for execution while keeping runtime-specific overrides authoritative.
- `codex/config.toml` stored shape: keep the existing top-level TOML structure and existing `mcp_servers` table shape, but update values in place so the canonical base template uses `model = "gpt-5.3-codex"` and a placeholder-safe Context7 definition instead of the current legacy seeded key.
- `codex/chat/config.toml` stored shape: keep the existing top-level TOML fields already used by `resolveCodexChatDefaults()` (`model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `web_search`). Story 47 changes bootstrap/source-of-truth behavior, not the schema for that file.
- `Context7 env overlay`: treat `CODEINFO_CONTEXT7_API_KEY` as a runtime-only input, not a new persisted field. The story should continue representing Context7 config through the existing TOML `mcp_servers.context7.command` plus `args` shape and update that in memory only where required.

## Expected Outcomes

- `Model merge example`: if `Codex_model_list` resolves to `['gpt-5.2', 'gpt-5.2-codex']` and `codex/chat/config.toml` contains `model = "gpt-5.3-codex"`, the shared capability/model-resolution path should expose `['gpt-5.2', 'gpt-5.2-codex', 'gpt-5.3-codex']`. The default model is still `gpt-5.3-codex`, but route-level prioritization remains a separate concern from the merged capability list.
- `Model already present example`: if `Codex_model_list` already contains `gpt-5.3-codex`, the final shared model list keeps the original env order and does not duplicate or move that model. The story should not invent a second prioritization step inside capability resolution.
- `Missing-file bootstrap example`: if both `codex/config.toml` and `codex/chat/config.toml` are missing, runtime bootstrap creates those files from the canonical in-code templates, both with `model = "gpt-5.3-codex"`, and does not read from `config.toml.example` while doing so.
- `Shared runtime inheritance example`: if `codex/config.toml` contains `[mcp_servers.context7]` and `codex/chat/config.toml` is bootstrapped from the minimal canonical chat template, the resolved chat and agent runtime config still include the base Context7 server definition because shared runtime inheritance carries required base-only execution config forward.
- `Existing invalid chat-config example`: if `codex/chat/config.toml` already exists but contains invalid TOML, the story does not repair or replace that file. The runtime default-resolution path warns and falls back to env/hardcoded defaults, and the invalid file remains on disk for a human to fix.
- `Context7 overlay with env key example`: if the runtime config contains `[mcp_servers.context7] args = ['-y', '@upstash/context7-mcp', '--api-key', 'REPLACE_WITH_CONTEXT7_API_KEY']` and `CODEINFO_CONTEXT7_API_KEY=ctx7sk-real`, the in-memory runtime config should use `['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real']` for that server definition without rewriting the file on disk.
- `Context7 no-key fallback example`: if the runtime config contains either placeholder-equivalent key value and `CODEINFO_CONTEXT7_API_KEY` is missing or empty, the in-memory runtime config should use `['-y', '@upstash/context7-mcp']` for Context7. Only the `--api-key` pair is removed; unrelated args and unrelated MCP server definitions remain unchanged.

## Edge Cases and Failure Modes

- `Concurrent bootstrap`: if two requests notice a missing config file at the same time, the story must preserve no-overwrite behavior and treat “created by another winner first” as a safe existing-file outcome rather than an error that retries or corrupts the file.
- `Existing but unusable chat config`: zero-byte files, unreadable files, directories in place of files, and invalid TOML all count as “existing” rather than “missing” for this story. The chat-default resolution path should warn and fall back, but bootstrap must not silently replace those paths.
- `Blank or invalid model field`: if `codex/chat/config.toml` contains `model = ""`, whitespace-only text, or another unusable value, the story should treat that model as absent for merge/default purposes and continue to use the existing fallback chain rather than manufacturing a broken model entry.
- `Model already present in env list`: if the chat-config model is already present in `Codex_model_list`, the merged list must not duplicate or move it. The only allowed reordering remains the existing route-level preferred-model prioritization after capability resolution.
- `Chat config read failures during merge`: the same warning-and-fallback behavior already used by `resolveCodexChatDefaults()` should apply when the shared model list needs the chat-config model. A broken chat config must not cause `/chat/models` to invent a new hard-error contract for this story.
- `Base runtime-config failures`: base-config parse/read/validation failures still use the existing runtime-config error path and codes in `server/src/config/runtimeConfig.ts`. Story 47 should not accidentally mask or down-convert those failures just because chat-config behavior is intentionally softer in one path.
- `Shared base-config inheritance`: direct chat-template bootstrap must not strip base-only runtime config that current execution paths rely on. If base config contains `mcp_servers` or other shared execution settings that are absent from the runtime-specific file, the shared runtime merge must preserve them unless runtime-specific config explicitly overrides them.
- `Context7 placeholder detection`: both `REPLACE_WITH_CONTEXT7_API_KEY` and the legacy seeded key literal count as “no usable key.” A real non-placeholder `--api-key` value must remain authoritative and must not be replaced from `CODEINFO_CONTEXT7_API_KEY`.
- `Missing or malformed Context7 args`: if the local stdio Context7 definition does not have the expected `args` array shape, the story should avoid inventing a second config schema or destructive repair step. It should preserve existing validation/error behavior and only normalize the supported `command` plus `args` shape defined in scope.
- `No-key fallback hygiene`: when no usable key is available, only the `--api-key` pair may be removed. Unrelated args must stay in the same order, and unrelated MCP server definitions must remain untouched in the same runtime config object.
- `Route warning propagation`: `/chat/models?provider=codex` already exposes `codexWarnings` and route-level warnings about tool availability. Story 47 must preserve that warning contract while adding any new merge/overlay warnings through the existing warnings arrays rather than inventing a second warning field.

## Likely Files

- `server/src/config/chatDefaults.ts`: existing default-model precedence and warnings logic; likely remains the source for config-over-env fallback behavior.
- `server/src/config/codexEnvDefaults.ts`: existing env-driven Codex model-list parsing; likely change point for env-list merging inputs or helper extraction.
- `server/src/codex/capabilityResolver.ts`: shared capability/model-resolution path; likely place where the final merged model list becomes visible to chat surfaces.
- `server/src/routes/chatModels.ts`: existing route-level preferred-model prioritization; likely needs verification that it keeps consuming shared capability output rather than adding a second merge rule.
- `server/src/routes/chatProviders.ts`: current provider-order/default route still resolves Codex defaults through env-only `resolveChatDefaults()`; likely needs to move onto the shared Codex-aware path for this story.
- `server/src/routes/chatValidators.ts`: current `/chat` validation still starts from env-only `resolveChatDefaults()`; likely needs to align with the shared Codex-aware default/model-selection behavior.
- `server/src/mcp2/tools/codebaseQuestion.ts`: current MCP tool combines env-based defaults, capability resolution, and chat-config defaults through separate paths; likely needs alignment so Codex execution selection uses the same merged model/default behavior as REST chat.
- `server/src/config/codexConfig.ts`: canonical base-template text and base bootstrap helper; likely change point for `gpt-5.3-codex`, Context7 seed cleanup, and removal of runtime dependence on `config.toml.example`.
- `server/src/config/runtimeConfig.ts`: canonical chat-template text, chat bootstrap helper, shared base/runtime inheritance, runtime snapshot loading, and likely home for Context7 in-memory normalization.
- `server/src/agents/config.ts`: agent execution entrypoint that consumes the shared runtime-config resolver and will confirm whether required base-only runtime settings are still available after the merge change.
- `server/src/test/unit/codexConfig.test.ts`, `server/src/test/unit/codexEnvDefaults.test.ts`, `server/src/test/unit/capabilityResolver.test.ts`, `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/unit/runtimeConfig.test.ts`, `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/chatProviders.test.ts`, `server/src/test/unit/chatValidators.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`, `server/src/test/integration/mcp-codex-wrapper.test.ts`: existing test files most likely to absorb the story coverage.
- `README.md`, `design.md`, `projectStructure.md`: documentation files likely to need updates once implementation is complete so the final behavior and source-of-truth rules stay discoverable.

## Test Harnesses

- No new test harnesses need to be created for this story. Repository research shows the required coverage fits inside the existing server unit-test and route-test setup.
- If implementation unexpectedly reveals that a new harness really is required, stop and add a dedicated planning task for that harness before building it. That task must define the harness files, the commands that execute it, the tests it will own, and at least one proof test that shows the harness itself runs successfully and surfaces failures correctly.
- Reuse the existing test utilities already present in these files instead of creating new fixture frameworks: `createCodexHome()` in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts), the route `env` snapshots and `startServer()` helpers in [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts) and [server/src/test/unit/chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts), the temporary `CODEX_HOME` helper pattern already present in [server/src/test/unit/chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts), and `withTempCodexHome()` in [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts).
- `server/src/test/unit/codexConfig.test.ts`: extend the existing unit harness for canonical base bootstrap behavior, including proof that `config.toml.example` is ignored even when present and that the canonical base template is the only runtime bootstrap source.
- `server/src/test/unit/runtimeConfig.test.ts`: extend the current file-system-backed `node:test` harness for bootstrap and runtime normalization. This is the right place for direct chat-template bootstrap assertions, no-example bootstrap assertions, placeholder detection, explicit-key preservation, and no-key fallback behavior.
- `server/src/test/unit/config.chatDefaults.test.ts`: extend the existing precedence and warning harness for config-vs-env-vs-fallback behavior. This is the right place to prove that `codex/chat/config.toml` remains the default-model source while invalid config still warns and falls back without being repaired.
- `server/src/test/unit/codexEnvDefaults.test.ts` and `server/src/test/unit/capabilityResolver.test.ts`: extend the existing env/capability harnesses for merged-model-list behavior so `Codex_model_list UNION chat-config model` is verified in the shared capability path rather than only through one route.
- `server/src/test/unit/chatModels.codex.test.ts`: extend the existing Codex route harness if the story needs route-visible proof that `/chat/models?provider=codex` exposes the merged list while preserving route-level prioritization separately from capability resolution.
- `server/src/test/unit/chatProviders.test.ts`, `server/src/test/unit/chatValidators.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`, and `server/src/test/integration/mcp-codex-wrapper.test.ts`: extend the existing provider-route, `/chat` validation, MCP-tool, and higher-level MCP wrapper harnesses so the Codex-facing entrypoints that currently rely on env-only defaults are proven to use the shared chat-config-aware model and default behavior after this story.
- `server/src/test/steps/chat_models.steps.ts` together with `server/src/test/support/mockLmStudioSdk.ts`: keep these existing higher-level route/support harnesses available only if a story step needs HTTP-surface confirmation beyond unit coverage. Based on current repo contracts and external config-layer research, Story 47 does not require inventing a new CLI, Docker, or end-to-end harness to validate the planned behavior.

## Implementation Plan Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer works through the tasks.
This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

1. Read and fully understand the story sections and the task you are starting before doing anything else so you know exactly what is required and why.
2. Create or reuse the feature branch for this story using the established naming convention `feature/<number>-<short-description>`.
3. Work through the tasks in order. Before touching code for a task, update that task's status to `__in_progress__`, commit that plan-file change, and only then begin implementation.
4. For each subtask, read the documentation locations listed for that task before editing code, then complete the subtask in full before moving to the next one.
5. As soon as a subtask is complete, mark its checkbox.
6. After the implementation subtasks are complete, run the testing steps for that task in order and mark each checkbox as it passes.
7. After testing passes, complete every documentation update listed for the task and mark each checkbox.
8. Once implementation, testing, and documentation are complete, add detailed notes to that task's `Implementation notes` section describing what changed, why, and any issues that had to be solved.
9. Record the git commit hashes for the task in the `Git Commits` line, then set the task status to `__done__`.
10. Use the repository wrapper commands for builds and tests. Only inspect saved logs when a wrapper reports `agent_action: inspect_log` or otherwise fails unexpectedly.

# Tasks

### 1. Merge The Chat Config Model Into Shared Codex Resolution

- Task Status: `__done__`
- Git Commits: `8310d88a`, `90181fa1`, `3d78c667`, `ca88f36d`

#### Overview

Update the shared server-side Codex resolution path so the model in `codex/chat/config.toml` is both the default Codex chat model and part of the available model list without changing the public response shape. This task is intentionally server-only; the client already consumes `/chat/models`, so no dedicated frontend task is needed unless the server contract changes later.

#### Must Not Miss

- Keep the response shapes for `/chat/models` and MCP/default-resolution payloads unchanged.
- Preserve the environment model-list order exactly as it is today and append the chat-config model only when it is missing.
- Keep route-level prioritization in `server/src/routes/chatModels.ts`; do not move presentation ordering into capability resolution.
- Preserve the current warning-and-fallback behavior when `codex/chat/config.toml` is unreadable, invalid, blank, or contains an unusable `model`.
- The merged model-list path and the default-model path must reread `codex/chat/config.toml` from disk on each request; do not introduce request-level or module-level caching for this story.
- Cover every Codex-facing caller that currently reads env-only defaults or split capability/default paths: `/chat/models`, `/chat/providers`, `/chat` validation, and `server/src/mcp2/tools/codebaseQuestion.ts`.
- Reuse the existing shared helpers in `chatDefaults.ts`, `capabilityResolver.ts`, `chatModels.ts`, and `chatProviders.ts`; do not invent a second family of Codex-specific route helpers or merge `resolveChatDefaults()` and `resolveCodexChatDefaults()` into one new abstraction.
- Do not add client hook, component, or response-shape changes for this task unless direct implementation proves the server contract must change; the current React/MUI path is already capable of rendering refreshed provider/model arrays.

#### Documentation Locations

- JavaScript `Set` iteration order: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set. This page documents insertion-order iteration, which is the reason `Array.from(new Set(...))` is the right minimal rule for deduplicating the merged model list without reordering the env list.
- Codex config layering reference: DeepWiki `openai/codex`, page `Config API and Layer System` (`/wiki/openai/codex#4.5.4` in the DeepWiki MCP tool). This page explains layer precedence, load-time merges, and runtime config reads, which is why it is the correct source for deciding whether model/default behavior belongs in shared Codex config resolution instead of route-specific code.
- React controlled inputs and rerenders: Context7 `/facebook/react/v19_2_0`, specifically the `react-dom/components/input` docs. This is the correct React reference for the unchanged client path because it shows how `value` plus `onChange` state updates rerender the existing controlled model selector.
- MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md. This page shows the `select` prop and the `select` slot, which is the reason it is the right documentation for the existing `TextField`-based chat model selector.
- MUI Select API: https://llms.mui.com/material-ui/6.4.12/api/select.md. This page documents `value`, `onChange`, `open`, and menu behavior, which is the right reference for verifying the existing controlled provider/model dropdown flow.
- MUI MenuItem API: https://llms.mui.com/material-ui/6.4.12/api/menu-item.md. This page documents the option component rendered inside `Select` and `TextField select`, which is why it is the correct source for the unchanged option-list behavior.
- Mermaid flowcharts in Markdown: Context7 `/mermaid-js/mermaid`, specifically the getting-started flowchart examples and usage documentation. This is the correct diagram reference for the `design.md` update in this task because the shared model/default-resolution flow needs a Mermaid diagram that follows Mermaid syntax exactly.

#### Junior Developer Notes

- Read these files before starting any subtask in Task 1: [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/config/codexEnvDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexEnvDefaults.ts), [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts).
- Do not assume the story-wide precedence is remembered elsewhere. For every subtask in this task, preserve this exact rule: explicit request override, then `codex/chat/config.toml`, then env fallback, then hardcoded fallback.
- Do not invent new helpers when an existing one can be extended. This task should reuse the helpers already named in the Documentation Locations and Must Not Miss sections.

#### Example Shapes

```ts
// Shared model availability rule for this task.
const mergedModels = Array.from(
  new Set([...envModelList, chatConfigModel].filter(Boolean)),
);

// Route-level presentation stays separate from availability.
const presentedModels = prioritizeModel(mergedModels, preferredModel);
```

#### Subtasks

1. [x] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read the `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, and `Edge Cases and Failure Modes` sections and write the exact precedence rule into your working notes before touching code: explicit request override, then `codex/chat/config.toml`, then legacy env fallback, then hardcoded fallback. Include one example in your notes: if `codex/chat/config.toml` says `model = "config-model"` and `CHAT_DEFAULT_MODEL=env-model`, the resolved default must stay `config-model`.
2. [x] In [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), update the `resolveCodexChatDefaults()` path so a valid `model` from `codex/chat/config.toml` always wins over `CHAT_DEFAULT_MODEL`. Keep the current warn-and-fallback behavior from the same file intact for blank, invalid, unreadable, or missing chat-config values, and do not add any code that rewrites or repairs the file on disk.
3. [x] In [server/src/config/codexEnvDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexEnvDefaults.ts) and [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), merge the environment model list with the current chat-config model using deterministic first-seen order. Use this exact expectation from the story while implementing: env `alpha,beta` plus chat-config `gamma` must become `alpha,beta,gamma`, but env `alpha,gamma,beta` plus chat-config `gamma` must stay `alpha,gamma,beta`.
4. [x] Update [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts) so the Codex preferred-model ordering comes from the shared chat-config-aware default path rather than the current env-only `resolveChatDefaults({})` call. Keep the route responsible only for list presentation and `prioritizeModel()` ordering; do not add a second model-list merge in the route because the shared merge must already be complete before the route runs.
5. [x] Update [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts) so every Codex-facing selection path uses the same shared Codex-aware helpers instead of env-only defaults. Keep this split explicit while editing: `resolveCodexCapabilities()` and `resolveCodexChatDefaults()` drive Codex-aware behavior, `resolveRuntimeProviderSelection()` handles provider fallback, and `prioritizeModel()` stays limited to list-presenting route code such as [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts).
6. [x] Review the shared runtime read path in [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts) so both REST and MCP/default-model resolution reread the current `codex/chat/config.toml` contents fresh on each request through one shared behavior. Do not introduce module-level caches, request-level caches, or any other stored snapshot for this story.
7. [x] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves a valid `codex/chat/config.toml` model beats `CHAT_DEFAULT_MODEL`. Purpose: lock in the happy-path default precedence that makes chat config the default source of truth.
8. [x] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves a missing `codex/chat/config.toml` falls back cleanly without recreating, repairing, or hard-failing. Purpose: keep the missing-file path on the existing fallback contract.
9. [x] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves invalid TOML in `codex/chat/config.toml` still warns and falls back. Purpose: preserve the current invalid-file error handling instead of introducing a new hard-error contract.
10. [x] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves a blank or whitespace-only `model` value in `codex/chat/config.toml` is treated as unusable and falls back. Purpose: cover the blank-model corner case explicitly.
11. [x] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves an unreadable `codex/chat/config.toml` still warns and falls back without being repaired. Purpose: preserve the unreadable-file error path.
12. [x] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves two consecutive reads after changing `codex/chat/config.toml` return different defaults. Purpose: prove the file is reread from disk on each request.
13. [x] Add or update a unit test in [server/src/test/unit/codexEnvDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexEnvDefaults.test.ts) that proves the env list keeps its original order and appends the chat-config model only when it is missing. Purpose: lock in the merged model-list happy path.
14. [x] Add or update a unit test in [server/src/test/unit/capabilityResolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/capabilityResolver.test.ts) that proves the chat-config model is not duplicated when it is already present in `Codex_model_list`. Purpose: cover the deterministic dedupe corner case in the shared capability path.
15. [x] Add or update a route test in [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts) that proves `/chat/models?provider=codex` returns the merged model list while keeping the existing response shape. Purpose: verify the REST happy path without introducing contract drift.
16. [x] Add or update a route test in [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts) that proves the route-level `prioritizeModel()` step moves the chat-config default model to the front of the returned Codex list without changing the underlying shared merge rule. Purpose: verify the route still owns presentation ordering while the shared resolver owns availability.
17. [x] Add or update a route test in [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts) that proves two `/chat/models?provider=codex` requests made before and after changing `codex/chat/config.toml` return different preferred-model results. Purpose: prove the web chat model list rereads the current chat-config model on each request.
18. [x] Add or update a route test in [server/src/test/unit/chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts) that proves `/chat/providers` now exposes the chat-config-aware Codex default and still falls back cleanly when chat config is missing. Purpose: verify the provider payload uses the shared default path without creating a new error contract.
19. [x] Add or update a unit test in [server/src/test/unit/chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts) that proves an omitted Codex `provider` and `model` resolve through the shared chat-config-aware default path instead of the old env-only path. Purpose: verify the `/chat` validation entrypoint now chooses the same Codex default model the routes expose.
20. [x] Add or update an MCP happy-path test in [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts) that proves an explicit request model override still wins over the chat-config default. Purpose: lock in the highest-precedence override behavior where a request-level override exists.
21. [x] Add or update an integration test in [server/src/test/integration/mcp-codex-wrapper.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/mcp-codex-wrapper.test.ts) that proves the higher-level MCP responder payload reports the chat-config-aware default model when no explicit request override is supplied. Purpose: keep the wrapper-level MCP contract aligned with the shared Codex default-selection behavior.
22. [x] Update the architecture document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with the shared Codex model/default-resolution contract, including the “fresh read on each request” rule and the list of Codex-facing callers that now share it. Include or update a Mermaid flowchart that shows the resolution path from explicit request override, to `codex/chat/config.toml`, to env fallback, to hardcoded fallback, and show which REST and MCP callers use that shared path. Purpose: keep the system-design documentation aligned with the new shared runtime-selection architecture.
23. [x] Update the user/developer reference document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) if it currently claims that `CHAT_DEFAULT_MODEL` overrides `codex/chat/config.toml`, because that statement must not survive this task. Purpose: keep the public-facing usage guidance aligned with the new Codex default-precedence contract.
24. [x] If this task adds or removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in this task is complete. The `projectStructure.md` update for this task must list every repository file added or removed by Task 1 so the structure map does not go stale for the next junior developer.
25. [x] Update this plan file's Task 1 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including what changed, what warnings/fallback behavior was preserved, and any issue you had to solve.
26. [x] In [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), add or reuse one shared Story 47 log marker with the exact marker text `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED`. Include enough structured fields to make manual verification deterministic: `surface`, `requested_provider`, `requested_model`, `resolved_model`, `model_source`, and `success`. Expected outcome: during Task 7 manual verification, the compose logs show this marker at least once for the REST chat surface and at least once for the MCP Codex path, and every observed line reports `success=true`.
27. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use because this task changes server config and capability resolution logic. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes shared server resolution code and route-visible server behavior. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server-facing behavior that should still satisfy the full Cucumber feature coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the story sections and task docs, and locked the working rule to `request override -> codex/chat/config.toml -> env fallback -> hardcoded fallback`; the concrete example remains `config-model` over `CHAT_DEFAULT_MODEL=env-model`.
- Updated the shared Codex resolution path so `resolveCodexChatDefaults()` remains the model/default source of truth, `mergeCodexModelList()` preserves env order while appending the chat-config model, and the REST/MCP callers now ask the shared Codex-aware path for preferred/default models instead of using env-only defaults.
- Added the Story 47 marker `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` to `/chat/models`, `/chat/providers`, `validateChatRequest`, and MCP `codebase_question`, while preserving the older Story 40 markers to avoid breaking existing log- and test-level contracts.
- Expanded server proof coverage for missing/invalid/unreadable chat config fallback, consecutive rereads, merged-model-list order, no-duplicate capability resolution, route-level prioritization, provider-route parity, chat-validation parity, and MCP explicit-override/default-model behavior.
- Updated `design.md` and `README.md` so Task 1 documentation now matches the shared Codex-aware default/model-resolution flow and the fresh-read-per-request rule.
- No repository files were added or removed during Task 1, so `projectStructure.md` did not require an update.
- Ran `npm run lint --workspaces` successfully and reran `format:check` after a targeted Prettier write so the task-owned files are back on the repository formatting contract.
- Passed `npm run build:summary:server` cleanly with `warning_count: 0`, so the Task 1 server build wrapper did not require log inspection.
- Passed the full `npm run test:summary:server:unit` wrapper with `tests run: 1174`, `passed: 1174`, and `failed: 0` after first fixing the new Story 47 proofs in targeted runs.
- Passed the full `npm run test:summary:server:cucumber` wrapper with `tests run: 71`, `passed: 71`, and `failed: 0`, so Task 1 kept the existing feature-suite coverage green.

---

### 2. Seed `codex/config.toml` From One Canonical In-Code Template

- Task Status: `__done__`
- Git Commits: `2f6e8760`, `abd53a3c`, `138b349e`, `8e824933`, `df0817e2`, `1b1af734`

#### Overview

Replace the base-config bootstrap split-brain behavior with one in-code source of truth. This task only covers first-time creation of missing `codex/config.toml`, the canonical template contents for that file, and the guarantee that runtime bootstrap no longer depends on `config.toml.example`.

#### Must Not Miss

- Remove runtime dependence on `config.toml.example`, but do not delete that file unless the story truly requires it.
- Preserve non-destructive behavior: if `codex/config.toml` already exists, do not overwrite it.
- Keep the resolved server-port substitution behavior intact.
- Set the canonical bootstrap model to `gpt-5.3-codex` and remove checked-in Context7 key material from the canonical default template so fresh bootstrap does not seed any `--api-key` pair for Context7 at all.
- Do not replace one on-disk bootstrap dependency with another one; the base bootstrap path must not read `codex/chat/config copy.toml` or any other sample/template file at runtime.
- Extend `ensureCodexConfigSeeded()` and its existing tests in place; do not add a parallel bootstrap utility for base config.

#### Documentation Locations

- Node.js `node:fs` bootstrap semantics: Context7 `/nodejs/node`, specifically the `fs.copyFile`, `COPYFILE_EXCL`, `open` flags, and `fs.writeFile` documentation in the `node:fs` API. These docs are the correct reference for this task because they explain which file operations overwrite existing files by default and which patterns preserve first-writer-wins bootstrap behavior.
- Codex config layering reference: DeepWiki `openai/codex`, page `Config API and Layer System` (`/wiki/openai/codex#4.5.4` in the DeepWiki MCP tool). This is the right Codex reference because it explains why `codex/config.toml` is a real configuration layer and must stay part of layered runtime resolution even when bootstrap becomes in-code only.
- Context7 repository documentation: https://github.com/upstash/context7. The README documents the local stdio MCP shape using `command = "npx"` with `args = ["-y", "@upstash/context7-mcp", "--api-key", "..."]`, which is why it is the correct external reference when cleaning the seeded base template without changing the MCP server contract.
- Mermaid flowcharts in Markdown: Context7 `/mermaid-js/mermaid`, specifically the getting-started flowchart examples and usage documentation. This is the correct diagram reference for the `design.md` update in this task because the base bootstrap path needs a Mermaid diagram that matches Mermaid flowchart syntax.

#### Junior Developer Notes

- Read these files before starting any subtask in Task 2: [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts), and [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
- Do not depend on any sample file at runtime in this task. `config.toml.example` may remain in the repository, but bootstrap must come only from the in-code template in [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts).
- Preserve first-writer-wins behavior. Missing file means create it; existing file means leave it alone.

#### Example Shapes

```ts
if (!configExists) {
  await writeCanonicalTemplate(configPath);
  return;
}

// Existing file stays untouched.
return;
```

#### Subtasks

1. [x] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read the `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, and `Edge Cases and Failure Modes` sections and write down the two non-negotiable rules for this task: the in-code template is the only bootstrap source of truth, and an existing `codex/config.toml` must never be overwritten.
2. [x] Update [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts) so `ensureCodexConfigSeeded()` creates a missing `codex/config.toml` from the in-code template only and never searches for `config.toml.example`. While editing the same file, keep the existing server-port replacement behavior intact and keep the current no-overwrite behavior for any already-present `codex/config.toml`.
3. [x] Update the canonical base template in [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts) so it uses `model = "gpt-5.3-codex"` and no longer embeds the legacy checked-in Context7 API key or any placeholder `--api-key` seed at all. Use this exact file-level expectation while editing: the template stays in code, but its model line changes and the seeded Context7 args become the no-key form from this story.
4. [x] Add or update a unit test in [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts) that proves a missing `codex/config.toml` is created from the canonical in-code template. Purpose: lock in the main base-bootstrap happy path.
5. [x] Add or update a unit test in [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts) that proves the newly seeded canonical base config no longer contains the legacy checked-in Context7 API key literal and does not seed any `--api-key` pair for Context7. Purpose: lock in the removal of checked-in key material from fresh bootstrap output and make the fresh template contract explicit.
6. [x] Add or update a runtime bootstrap test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves `config.toml.example` and `codex/chat/config copy.toml` are ignored by the runtime bootstrap path. Purpose: prevent future regressions back to sample-file-driven bootstrap behavior.
7. [x] Add or update a unit test in [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts) that proves server-port substitution still happens inside the canonical in-code base template. Purpose: preserve the existing dynamic port behavior while changing the template source.
8. [x] Add or update a unit test in [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts) that proves repeated calls to the seeding helper leave the already-created file unchanged. Purpose: cover the idempotent first-writer-wins corner case.
9. [x] Add or update a unit test in [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts) that proves an existing `codex/config.toml` is never overwritten. Purpose: preserve the non-destructive existing-file contract.
10. [x] Update the architecture document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it describes `codex/config.toml` bootstrap as code-driven rather than sample-file-driven. Include the fact that `config.toml.example` may remain as documentation, but it is no longer part of runtime bootstrap behavior, and add or refresh a Mermaid flowchart that shows the missing-file bootstrap decision path and the bypass of `config.toml.example`. Purpose: keep the design-level bootstrap architecture accurate.
11. [x] Update the user/developer reference document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) so it describes `codex/config.toml` bootstrap as code-driven rather than sample-file-driven and states that `config.toml.example` is documentation-only. Purpose: keep the top-level implementation guidance aligned with the new bootstrap source of truth.
12. [x] If this task adds or removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in this task is complete. The `projectStructure.md` update for this task must list every repository file added or removed by Task 2 so the structure map stays correct for the next task.
13. [x] Update this plan file's Task 2 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including what you changed in [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts) and what bootstrap behavior stayed intentionally unchanged.
14. [x] In [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), add a Story 47 bootstrap marker with the exact text `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP`. Emit it for both the canonical seed path and the existing-file short-circuit path, and include `config_path`, `outcome` (`seeded` or `existing`), `template_source=in_code`, and `success`. Expected outcome: during Task 7 manual verification, the compose logs show this marker during stack startup, and any seeded path reports `template_source=in_code` with `success=true`.
15. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use because this task changes server bootstrap code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server bootstrap behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server bootstrap behavior that still needs full feature-suite coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the story rules for Task 2 and kept the implementation scoped to one in-code base template plus strict no-overwrite behavior for existing `codex/config.toml`.
- Updated [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts) so base bootstrap no longer searches for `config.toml.example`, now seeds `gpt-5.3-codex`, removes any seeded Context7 `--api-key`, and emits `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP` for `seeded` and `existing` outcomes.
- Expanded [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts) to cover in-code seeding, no-key Context7 output, port substitution, idempotence, no-overwrite behavior, and Story 47 marker logging.
- Added a regression check in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) proving runtime bootstrap ignores both `config.toml.example` and `codex/chat/config copy.toml`.
- Updated [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) and [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) to describe the code-driven base bootstrap flow and note that no repository files were added or removed in Task 2, so [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) needed no change.
- Ran `npm run format:check --workspaces` and `npm run lint --workspaces`; formatting passed after a targeted Prettier write on the new runtime test, and lint completed with the repo’s pre-existing import-order warnings only.
- `npm run build:summary:server` passed with `warning_count: 0`, so the base bootstrap changes compile cleanly in the full server workspace build.
- `npm run test:summary:server:unit` passed cleanly with `tests run: 1181`, `passed: 1181`, `failed: 0`, covering the new base bootstrap and runtime bootstrap regressions in the full server unit/integration suite.
- `npm run test:summary:server:cucumber` passed with `tests run: 71`, `passed: 71`, `failed: 0`, confirming the bootstrap change did not regress the feature-level server suite.

---

### 3. Bootstrap `codex/chat/config.toml` Directly From The Canonical Chat Template

- Task Status: `__done__`
- Git Commits: `1ad51f49`, `460f1df9`, `b6d7ce29`, `f9c8966e`

#### Overview

Make missing chat-config bootstrap deterministic and independent from the base config file by writing `codex/chat/config.toml` directly from the canonical chat template. This task is only about how the missing chat file gets created and how that branch is tested; it does not own the broader base/runtime inheritance work.

#### Must Not Miss

- When `codex/chat/config.toml` is missing, bootstrap it directly from the chat template instead of copying `codex/config.toml`, even when `codex/config.toml` already exists and contains different values.
- If the chat-config path already exists, even as an unreadable file, zero-byte file, invalid TOML file, or directory, do not overwrite it.
- Preserve the current warning-and-fallback runtime behavior for invalid existing chat config; this task is about missing-file bootstrap only.
- Keep the canonical chat template using `gpt-5.3-codex`.
- Do not consult `codex/chat/config copy.toml` or any other on-disk template file as part of chat bootstrap.
- Extend `ensureChatRuntimeConfigBootstrapped()` and its existing tests in place; do not add a parallel chat-bootstrap helper.

#### Documentation Locations

- Node.js `node:fs` bootstrap semantics: Context7 `/nodejs/node`, specifically the `fs.copyFile`, `COPYFILE_EXCL`, `open` flags, and `fs.writeFile` documentation in the `node:fs` API. These docs explain why the missing chat file can be written directly from a canonical template while still preserving no-overwrite behavior when the target path already exists.
- Codex config layering reference: DeepWiki `openai/codex`, page `Config API and Layer System` (`/wiki/openai/codex#4.5.4` in the DeepWiki MCP tool). This is the correct Codex reference for this task because it explains that a runtime-specific config file may stay minimal while shared behavior still comes from layered base config resolution.
- Mermaid flowcharts in Markdown: Context7 `/mermaid-js/mermaid`, specifically the getting-started flowchart examples and usage documentation. This is the correct diagram reference for the `design.md` update in this task because the direct chat bootstrap branch needs a Mermaid diagram that follows Mermaid flowchart syntax.

#### Junior Developer Notes

- Read these files before starting any subtask in Task 3: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts), and [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts).
- This task changes only missing-file bootstrap for `codex/chat/config.toml`. It must not silently repair or overwrite any existing path, even if the existing path is broken.
- The chat bootstrap path must stop copying the base config. The created chat file should come directly from the canonical chat template.

#### Example Shapes

```ts
// Correct target behavior for this task.
if (!chatConfigExists) {
  await writeFile(chatConfigPath, CHAT_CONFIG_TEMPLATE, { flag: 'wx' });
}

// Do not do this after Story 47:
// copyFile(baseConfigPath, chatConfigPath)
```

#### Subtasks

1. [x] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read the `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, and `Edge Cases and Failure Modes` sections and write down the two rules that cannot be missed in this task: missing `codex/chat/config.toml` is created from the canonical chat template, and any existing path at that location must be left untouched.
2. [x] Update [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so `ensureChatRuntimeConfigBootstrapped()` always writes the canonical chat template directly when `codex/chat/config.toml` is missing and never copies the base config first, even when [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts) would have created a base file with different content.
3. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a missing `codex/chat/config.toml` is created from the canonical chat template. Purpose: lock in the direct chat-template bootstrap happy path.
4. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the base config is no longer copied into chat config when `codex/config.toml` already exists with different contents. Purpose: prevent regressions back to copy-from-base bootstrap behavior.
5. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves `codex/chat/config copy.toml` and other on-disk template files are ignored. Purpose: keep the chat bootstrap source of truth in code.
6. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the old `copied` bootstrap branch is removed or intentionally replaced by the direct-template path. Purpose: make the branch-level behavior change visible to reviewers.
7. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an existing zero-byte `codex/chat/config.toml` is left untouched. Purpose: cover the zero-byte-file corner case explicitly.
8. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an existing invalid-TOML `codex/chat/config.toml` is left untouched. Purpose: cover the invalid-file corner case explicitly.
9. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an existing directory at the `codex/chat/config.toml` path is left untouched. Purpose: cover the directory-path corner case explicitly.
10. [x] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves an existing invalid or unreadable chat config still warns, falls back, and is not overwritten by bootstrap. Purpose: keep the warning-and-fallback behavior tied to the new direct bootstrap path.
11. [x] Update the architecture document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it describes direct chat-template bootstrap rather than copy-from-base behavior, and make it explicit that this task only changes missing-file bootstrap. Add or refresh a Mermaid flowchart that shows the missing-chat-config branch writing the canonical chat template directly and the existing-path branch short-circuiting without overwrite. Purpose: keep the design-level chat bootstrap flow accurate.
12. [x] Update the user/developer reference document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) so it describes direct chat-template bootstrap rather than copy-from-base behavior and makes it explicit that this task only changes missing-file bootstrap. Purpose: keep the top-level guidance aligned with the new direct bootstrap contract.
13. [x] If this task adds or removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in this task is complete. The `projectStructure.md` update for this task must list every repository file added or removed by Task 3 so the repo map does not go stale.
14. [x] Update this plan file's Task 3 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including which bootstrap branch changed and which existing-file protections stayed intact.
15. [x] In [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), add a Story 47 chat-bootstrap marker with the exact text `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP`. Emit it for the direct-template seed path and the existing-path short-circuit path, and include `config_path`, `outcome` (`seeded` or `existing`), `source=chat_template`, and `success`. Expected outcome: during Task 7 manual verification, the compose logs show this marker during stack startup, and any seeded path reports `source=chat_template` with `success=true`.
16. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use because this task changes server runtime-config bootstrap code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server bootstrap behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server bootstrap behavior that still needs full feature-suite coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the Story 47 task rules and kept the implementation scoped to missing-file chat bootstrap only: missing chat config now seeds from the canonical chat template, and any existing path at `codex/chat/config.toml` short-circuits without overwrite.
- Updated [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so `ensureChatRuntimeConfigBootstrapped()` no longer copies `codex/config.toml`, now treats any existing path at the chat-config location as `existing_noop`, and emits the new Story 47 marker `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP` alongside the legacy Story 40 marker.
- Expanded [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) to prove direct-template seeding, sample-file bypass, no copy-from-base behavior, zero-byte and invalid-file no-overwrite behavior, directory-path protection, and the new Story 47 marker.
- Added a regression in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) showing that invalid existing chat config still warns, falls back, and remains untouched after the bootstrap change.
- Updated [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) and [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) to remove the old copy-from-base story and note that Task 3 did not add or remove repository files, so [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) needed no change.
- Ran `npm run format:check --workspaces` and `npm run lint --workspaces`; formatting passed cleanly and lint completed with the repo’s existing import-order warnings only.
- `npm run build:summary:server` passed with `warning_count: 0`, so the direct chat-template bootstrap change builds cleanly across the full server workspace.
- `npm run test:summary:server:unit` passed cleanly with `tests run: 1183`, `passed: 1183`, and `failed: 0`, covering the direct bootstrap branch change and the new no-overwrite edge cases in the full unit/integration suite.
- `npm run test:summary:server:cucumber` passed with `tests run: 71`, `passed: 71`, and `failed: 0`, confirming the chat bootstrap change stayed compatible with the feature-level server flows.

---

### 4. Preserve Shared Base Runtime Inheritance After Direct Chat Bootstrap

- Task Status: `__done__`
- Git Commits: `2a70f240`, `a251e43a`, `14422f86`

#### Overview

Preserve the shared base-only runtime config that execution still needs once chat bootstrap stops copying the whole base file. This task owns the shared merge/inheritance behavior for chat and agent runtime config, plus the tests that prove base-only execution settings still reach their existing consumers.

#### Must Not Miss

- Start from the existing merge helper in `runtimeConfig.ts`; do not add a second runtime merge layer just for Story 0000047.
- Do not build a generic recursive or arbitrary deep TOML merge for this task; explicitly inherit only the known keys in scope for this story.
- Runtime-specific values must stay authoritative for fields such as `model`, `approval_policy`, `sandbox_mode`, and `web_search`.
- Preserve additive tables such as `projects` and `mcp_servers` and preserve base-only settings such as `personality`, `tools`, `model_provider`, and `model_providers` when the runtime-specific file omits them.
- Direct chat-template bootstrap must not remove shared base-only runtime config that execution still needs.
- Preserve the current warning-and-fallback behavior for invalid existing chat config and the existing hard-error behavior for strict runtime-config reads.

#### Documentation Locations

- Codex config layering reference: DeepWiki `openai/codex`, page `Config API and Layer System` (`/wiki/openai/codex#4.5.4` in the DeepWiki MCP tool). This page is the correct source for this task because it describes layered config precedence and confirms that fields such as `mcp_servers`, `model_provider`, and `model_providers` are part of the shared configuration model rather than route-specific data.
- TOML specification: https://toml.io/en/v1.1.0. This is the right format reference for this task because it documents tables, dotted keys, and top-level key/value structure, which are the exact TOML rules that matter when explicitly inheriting `projects`, `mcp_servers`, and base-only top-level settings.
- Mermaid flowcharts in Markdown: Context7 `/mermaid-js/mermaid`, specifically the getting-started flowchart examples and usage documentation. This is the correct diagram reference for the `design.md` update in this task because the shared base/runtime inheritance path needs a Mermaid diagram that follows Mermaid syntax.

#### Junior Developer Notes

- Read these files before starting any subtask in Task 4: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/agents/config.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/config.ts), [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), and [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
- This task is not a generic deep-merge exercise. Explicitly inherit only the known keys named in this task, and keep runtime-specific values authoritative for `model`, `approval_policy`, `sandbox_mode`, and `web_search`.
- Both chat runtime and agent runtime must keep the required base-only settings after direct chat bootstrap removes the old copy-from-base shortcut.

#### Example Shapes

```ts
const merged = {
  ...baseConfig,
  ...runtimeConfig,
  projects: mergeProjects(baseConfig.projects, runtimeConfig.projects),
  mcp_servers: mergeMcpServers(
    baseConfig.mcp_servers,
    runtimeConfig.mcp_servers,
  ),
};
```

#### Subtasks

1. [x] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read the `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, and `Edge Cases and Failure Modes` sections and write down two lists in your working notes before editing code: runtime-specific fields that must stay authoritative (`model`, `approval_policy`, `sandbox_mode`, `web_search`) and base-only fields that must still be inherited (`projects`, `mcp_servers`, `personality`, `tools`, `model_provider`, `model_providers`).
2. [x] Extend the current projects-only merge in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) instead of replacing it with a brand-new abstraction, so the shared runtime resolver starts from base config, overlays runtime-specific config on top, preserves additive tables such as `projects` and `mcp_servers`, preserves base-only settings such as `personality`, `tools`, `model_provider`, and `model_providers` when the runtime-specific file omits them, and keeps runtime-specific values authoritative for fields like `model`, `approval_policy`, `sandbox_mode`, and `web_search`. Use this example while implementing: if base config contains `[mcp_servers.context7]` and `model_provider = "base-provider"`, but chat config only contains `model = "chat-model"`, the resolved chat runtime must still include the base MCP server and base provider config while keeping `model = "chat-model"`.
3. [x] Review [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/agents/config.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/config.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts) after the merge change so invalid existing chat configs still warn and fall back without being rewritten, while resolved chat and agent runtime config continue to expose the base-only execution settings those callers already depend on.
4. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves resolved chat runtime still inherits base `mcp_servers`, `model_provider`, and `model_providers`. Purpose: lock in the chat-runtime inheritance happy path for base-only provider settings.
5. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves resolved agent runtime still inherits base `mcp_servers`, `personality`, `tools`, and `projects`. Purpose: lock in the agent-runtime inheritance happy path for base-only execution settings.
6. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves resolved agent runtime still inherits base `model_provider` and `model_providers` when the runtime-specific file omits them. Purpose: cover the agent-side provider-routing inheritance required by the acceptance criteria.
7. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves runtime-specific `model`, `approval_policy`, `sandbox_mode`, and `web_search` values still override the base config. Purpose: prevent the inheritance change from weakening runtime-specific precedence.
8. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves runtime-specific `projects` or `mcp_servers` entries add to or override the base entry without deleting unrelated base siblings. Purpose: cover the additive-table merge corner case explicitly.
9. [x] Add or update an MCP happy-path test in [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts) that proves the resolved agent runtime used by `codebaseQuestion` still sees the inherited base-only execution settings after direct chat-template bootstrap. Purpose: verify an existing consumer keeps working end to end.
10. [x] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves the inheritance change does not silently repair an invalid existing chat config. Purpose: keep the soft warning path separate from bootstrap or merge repair behavior.
11. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves strict runtime readers still error when base config read or validation fails. Purpose: preserve the existing hard-error contract for strict runtime-config paths.
12. [x] Update the architecture document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it describes the shared base/runtime inheritance that preserves execution behavior without copying the full base config into chat config. Include the list of inherited key groups from this task so the documentation matches what the code actually preserves, and add or refresh a Mermaid flowchart that shows base config, runtime config, explicit inheritance of known keys, and runtime-specific override precedence. Purpose: keep the design-level inheritance architecture accurate.
13. [x] Update the user/developer reference document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) so it explains the shared base/runtime inheritance behavior and the preserved key groups at a high level. Purpose: keep the top-level guidance aligned with the new inheritance behavior without forcing the reader into the deeper design document first.
14. [x] If this task adds or removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in this task is complete. The `projectStructure.md` update for this task must list every repository file added or removed by Task 4 so the repo map does not go stale for the next developer.
15. [x] Update this plan file's Task 4 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including which keys are inherited explicitly and which values remain runtime-specific overrides.
16. [x] In [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), add a Story 47 inheritance marker with the exact text `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`. Include `surface` (`chat` or `agent`), `inherited_keys`, `runtime_override_keys`, and `success` so a reviewer can tell which merge path executed. Expected outcome: during Task 7 manual verification, the compose logs show this marker for at least one chat runtime read and one agent runtime read, and every observed line reports `success=true`.
17. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use because this task changes shared runtime-config merge behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes shared server behavior used by chat and agent execution. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server/common behavior that still needs full Cucumber feature coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the story sections and locked the Task 4 working lists to runtime-owned overrides (`model`, `approval_policy`, `sandbox_mode`, `web_search`) versus inherited base-only keys (`projects`, `mcp_servers`, `personality`, `tools`, `model_provider`, `model_providers`).
- Extended `server/src/config/runtimeConfig.ts` in place with an explicit inheritance helper that keeps additive `projects`/`mcp_servers`, preserves base-only execution settings when runtime config omits them, and records inherited-versus-runtime-owned key groups for the Story 47 marker.
- Re-reviewed `chatDefaults.ts`, `agents/config.ts`, and `codebaseQuestion.ts` against the new merge path so invalid chat config still follows the existing warn-and-fallback behavior while strict runtime readers continue to consume resolved inherited settings instead of rewriting files.
- Expanded `server/src/test/unit/runtimeConfig.test.ts` to prove chat inheritance of provider routing, agent inheritance of execution settings, runtime-owned override precedence, additive table merges, and strict hard-failure when shared base TOML is invalid.
- Kept the existing `config.chatDefaults` proof that invalid chat config is left untouched, which still covers the Task 4 requirement that inheritance does not silently repair broken chat config.
- Added an MCP happy-path proof in `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` that uses the real runtime resolver and verifies inherited base runtime settings still reach Codex execution after direct chat bootstrap.
- Updated `design.md` and `README.md` so they now describe explicit shared base/runtime inheritance instead of the older projects-only merge or copy-from-base mental model.
- Task 4 did not add or remove repository files, so `projectStructure.md` did not need an update.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; format required a targeted Prettier write on the Task 4 files, and lint now passes with only the repository’s existing import-order warnings.
- Passed `npm run build:summary:server` cleanly with `warning_count: 0`, so the Task 4 server build wrapper did not require log inspection.
- Passed `npm run test:summary:server:unit` cleanly with `tests run: 1190`, `passed: 1190`, and `failed: 0` after first tightening the Task 4 targeted proofs for MCP runtime inheritance and strict base-config failure handling.
- Passed `npm run test:summary:server:cucumber` cleanly with `tests run: 71`, `passed: 71`, and `failed: 0`, so the Task 4 inheritance changes kept the existing feature-suite coverage green.

---

### 5. Normalize Context7 API Keys In Runtime Config Loading

- Task Status: `__done__`
- Git Commits: `1971636e`, `ce9842eb`, `dacae461`

#### Overview

Add the in-memory Context7 normalization step so runtime config loading treats placeholder-equivalent Context7 API keys as absent and overlays `CODEINFO_CONTEXT7_API_KEY` when present. This task is only about runtime config normalization for the local stdio `command` plus `args` shape and must not rewrite TOML files on disk.

#### Must Not Miss

- Only normalize the local stdio Context7 definition that uses `command` plus an `args` array; do not add support for remote `url` and `http_headers` shapes in this story.
- Treat both `REPLACE_WITH_CONTEXT7_API_KEY` and `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866` as no usable key.
- If `CODEINFO_CONTEXT7_API_KEY` is set to a non-empty value, overlay it in memory only.
- Treat missing, empty, and whitespace-only `CODEINFO_CONTEXT7_API_KEY` values as no usable env key.
- If no usable key is available, remove or replace only the `--api-key` pair and keep every unrelated arg and unrelated MCP server definition in its original order.
- Apply the overlay in one shared runtime-config read path used by both chat and agent callers so the behavior cannot drift between surfaces.
- Apply the overlay after the shared base/runtime inheritance step so inherited Context7 definitions from base config are normalized too.
- Add this as an extension of the existing shared runtime normalization and merge flow in `runtimeConfig.ts`; do not create caller-specific Context7 normalization helpers.

#### Documentation Locations

- Context7 repository documentation: https://github.com/upstash/context7. The README shows the supported local stdio MCP configuration using `npx` plus an `args` array and explains that an API key is optional but recommended, which is why it is the correct external source for the placeholder-key and no-key fallback behavior in this task.
- Codex config layering reference: DeepWiki `openai/codex`, page `Config API and Layer System` (`/wiki/openai/codex#4.5.4` in the DeepWiki MCP tool). This is the right Codex reference because it explains the shared layered runtime read path that the in-memory Context7 overlay must plug into after base/runtime inheritance.
- Mermaid flowcharts in Markdown: Context7 `/mermaid-js/mermaid`, specifically the getting-started flowchart examples and usage documentation. This is the correct diagram reference for the `design.md` update in this task because the Context7 overlay decision path needs a Mermaid diagram that follows Mermaid flowchart syntax.

#### Junior Developer Notes

- Read these files before starting any subtask in Task 5: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts), and [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts).
- This task only normalizes the local stdio Context7 shape that uses `command` plus `args`. Do not extend the task to remote `url` or `http_headers` definitions.
- The overlay is runtime-only. It must change the in-memory config object returned from the shared runtime reader, not the TOML files on disk.

#### Example Shapes

```ts
if (isPlaceholderKey(currentApiKey) && envApiKey) {
  return ['-y', '@upstash/context7-mcp', '--api-key', envApiKey];
}

if (isPlaceholderKey(currentApiKey) && !envApiKey) {
  return ['-y', '@upstash/context7-mcp'];
}
```

#### Subtasks

1. [x] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, `Edge Cases and Failure Modes`, and Decision 4, then write down the two placeholder-equivalent values that must be treated as unusable: `REPLACE_WITH_CONTEXT7_API_KEY` and `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866`.
2. [x] Update [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so the merged runtime config applies the `CODEINFO_CONTEXT7_API_KEY` overlay in memory when a Context7 stdio definition exists and currently has no usable key, and place that logic in one shared read path that runs after base/runtime inheritance and feeds both chat and agent runtime config resolution instead of duplicating caller-specific branches.
3. [x] In the same [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) change, preserve explicit non-placeholder keys, preserve unrelated args and unrelated MCP server definitions, leave remote `url` and `http_headers` Context7 definitions unchanged, and fall back to the no-key `args = ['-y', '@upstash/context7-mcp']` shape when no usable key is available. Use this exact example from the story while editing: `['-y', '@upstash/context7-mcp', '--api-key', 'REPLACE_WITH_CONTEXT7_API_KEY']` plus `CODEINFO_CONTEXT7_API_KEY=ctx7sk-real` must become `['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real']`, but if the env var is empty or whitespace-only the result must be `['-y', '@upstash/context7-mcp']`.
4. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves `REPLACE_WITH_CONTEXT7_API_KEY` is replaced in memory by `CODEINFO_CONTEXT7_API_KEY`. Purpose: lock in the main env-overlay happy path.
5. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the legacy seeded key `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866` is treated like a placeholder and replaced by `CODEINFO_CONTEXT7_API_KEY`. Purpose: cover the legacy-key compatibility path explicitly.
6. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an explicit non-placeholder Context7 API key is preserved. Purpose: prevent valid user-supplied keys from being overwritten.
7. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an already-no-key Context7 args list remains unchanged. Purpose: cover the already-clean no-key corner case.
8. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a placeholder-equivalent Context7 key plus a missing, empty, or whitespace-only `CODEINFO_CONTEXT7_API_KEY` value falls back to the exact no-key args form `['-y', '@upstash/context7-mcp']`. Purpose: lock in the no-key fallback contract explicitly instead of leaving it implied by broader arg-order tests.
9. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a runtime config with no Context7 definition remains unchanged. Purpose: cover the missing-definition corner case explicitly.
10. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the no-key fallback removes only the `--api-key` pair and preserves the order of every unrelated arg. Purpose: verify the scoped arg-rewrite behavior.
11. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves remote `url` and `http_headers` Context7 definitions are left unchanged. Purpose: keep remote/header-based definitions out of scope for this story.
12. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the overlay does not rewrite config files on disk. Purpose: lock in the runtime-only normalization contract.
13. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves `resolveChatRuntimeConfig()` receives the inherited overlaid Context7 definition when the server is defined in base config. Purpose: verify the shared read path for the chat runtime consumer.
14. [x] Add or update an MCP happy-path test in [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts) that proves the agent-side runtime used by `codebaseQuestion` receives the same inherited overlaid Context7 definition. Purpose: verify the shared read path for an existing agent consumer.
15. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves base-config read or validation failures still hard-error. Purpose: preserve the strict base-config failure contract.
16. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a malformed local stdio Context7 shape, such as non-array `args` or a missing `--api-key` pair, preserves the existing validation or error behavior instead of being destructively rewritten. Purpose: cover the malformed-shape corner case explicitly.
17. [x] Update the architecture document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it describes `CODEINFO_CONTEXT7_API_KEY` as the runtime source of truth, makes it clear that the overlay is in-memory only, and notes that the same shared overlay path is used by both chat and agent runtime config loading. Add or refresh a Mermaid flowchart that shows the Context7 normalization decision tree for placeholder-equivalent keys, explicit real keys, no-key fallback, and inherited base-config definitions. Purpose: keep the design-level runtime-config architecture accurate.
18. [x] Update the user/developer reference document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) so it describes `CODEINFO_CONTEXT7_API_KEY` as the runtime source of truth and explains the in-memory-only overlay behavior at a practical level. Purpose: keep the top-level operational guidance aligned with the new Context7 configuration contract.
19. [x] If this task adds or removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in this task is complete. The `projectStructure.md` update for this task must list every repository file added or removed by Task 5 so the structure map does not go stale.
20. [x] Update this plan file's Task 5 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including which placeholder-equivalent values were handled and how the runtime-only overlay works.
21. [x] In [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), add a Story 47 Context7 normalization marker with the exact text `DEV_0000047_T05_CONTEXT7_NORMALIZED`. Include `mode` (`env_overlay`, `no_key_fallback`, `explicit_key_preserved`, or `no_context7_definition`), `surface`, and `success`. Expected outcome: during Task 7 manual verification, the compose logs show this marker with the expected normalization mode for the configured test scenario, and every observed line reports `success=true`.
22. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use because this task changes runtime config normalization code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes runtime-config behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task changes server/common behavior that still needs full Cucumber feature coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the story sections and locked the Task 5 placeholder-equivalent values to `REPLACE_WITH_CONTEXT7_API_KEY` and `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866` before changing the shared runtime path.
- Extended `server/src/config/runtimeConfig.ts` after the Task 4 inheritance step so local stdio `mcp_servers.context7` definitions now normalize in one shared in-memory path for both chat and agent consumers.
- Kept the rewrite narrow: explicit non-placeholder keys are preserved, unrelated args stay in order, remote `url`/`http_headers` definitions are left alone, malformed local stdio shapes are not destructively rewritten, and missing/empty/whitespace env values fall back to the exact no-key args form.
- Added the Story 47 marker `DEV_0000047_T05_CONTEXT7_NORMALIZED` with deterministic `mode`, `surface`, and `success` fields for later manual verification.
- Expanded `server/src/test/unit/runtimeConfig.test.ts` to cover env overlay, legacy placeholder handling, explicit-key preservation, already-no-key behavior, no-key fallback, missing definitions, remote definitions, runtime-only/no-disk-rewrite behavior, inherited chat runtime normalization, malformed local stdio shapes, and the preserved strict base-config failure contract.
- Added an MCP happy-path proof in `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` that verifies inherited Context7 overlay behavior reaches the agent-side runtime used by `codebaseQuestion`.
- Updated `README.md` and `design.md` so they now describe `CODEINFO_CONTEXT7_API_KEY` as the runtime source of truth and make the in-memory-only overlay behavior explicit.
- Task 5 did not add or remove repository files, so `projectStructure.md` did not need an update.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; format required a targeted Prettier write on `server/src/config/runtimeConfig.ts`, and lint now passes with only the repository’s existing import-order warnings.
- Passed `npm run build:summary:server` cleanly with `warning_count: 0`, so the Task 5 server build wrapper did not require log inspection.
- Passed `npm run test:summary:server:unit` cleanly with `tests run: 1202`, `passed: 1202`, and `failed: 0` after first locking down the direct Context7 overlay proofs and the inherited chat/MCP runtime coverage in targeted runs.
- Passed `npm run test:summary:server:cucumber` cleanly with `tests run: 71`, `passed: 71`, and `failed: 0`, so the Task 5 Context7 normalization kept the existing feature-suite coverage green.

---

### 6. Complete Documentation Sweep And Acceptance Mapping

- Task Status: `__done__`
- Git Commits: `4f7bcd75`, `44a736f0`, `a15a80a2`

#### Overview

Prepare the story for final proof by updating the human-facing documentation and mapping every acceptance criterion to concrete implemented behavior. This task keeps the final runtime-verification task smaller by finishing the documentation and acceptance-review work first.

#### Must Not Miss

- Re-check every acceptance criterion in this story against the implemented behavior rather than assuming earlier task coverage is enough.
- Keep the focus on updating docs and the acceptance map only; the full runtime verification, screenshots, and pull-request summary belong in the final task.
- Keep the focus on the existing UI against the corrected server behavior; this story still does not require a dedicated frontend implementation task unless verification proves one is actually needed.

#### Documentation Locations

- Codex config layering reference: DeepWiki `openai/codex`, page `Config API and Layer System` (`/wiki/openai/codex#4.5.4` in the DeepWiki MCP tool). This page is the right source for the docs sweep because it explains how layered config reads and precedence work, which the story documentation now needs to describe accurately.
- Context7 repository documentation: https://github.com/upstash/context7. The README documents the local stdio MCP setup and optional API-key behavior, which is why it is the correct source when writing the final `CODEINFO_CONTEXT7_API_KEY` documentation.
- React controlled inputs and rerenders: Context7 `/facebook/react/v19_2_0`, specifically the `react-dom/components/input` docs. This is the right React reference for the documentation sweep because it explains why the existing client selector rerenders correctly from server-fed state without a story-specific UI rewrite.
- MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md. This page is the correct MUI reference because it documents the `select` prop used by the existing client path.
- MUI Select API: https://llms.mui.com/material-ui/6.4.12/api/select.md. This page is the correct MUI reference because it documents the controlled select behavior that the existing client already uses.
- MUI MenuItem API: https://llms.mui.com/material-ui/6.4.12/api/menu-item.md. This page is the correct MUI reference because it documents the option rows rendered by the existing select UI.
- Mermaid flowcharts in Markdown: Context7 `/mermaid-js/mermaid`, specifically the getting-started flowchart examples and usage documentation. This is the correct diagram reference for the final `design.md` sweep because the story-level architecture diagrams must use valid Mermaid syntax and consistent flowchart structure.

#### Junior Developer Notes

- Read these files before starting any subtask in Task 6: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), and [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
- Treat this task as proof-mapping, not invention. Every acceptance criterion must point to implemented code or a planned test, and the docs must match that proof exactly.
- Keep the README short and practical, and keep `design.md` architectural. Do not copy the same paragraph into both documents.

#### Subtasks

1. [x] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read the full `Acceptance Criteria`, `Expected Outcomes`, and `Out Of Scope` sections and create a short acceptance-check list in your working notes. For each criterion, write the exact proof location beside it, such as a file link like [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) or a specific test file like [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
2. [x] Run through the code and tests touched by Tasks 1 through 5 and confirm there are no remaining branches still reading `config.toml.example`, copying base config into chat config, treating the placeholder-equivalent Context7 values as usable keys, or leaving Codex-facing selection paths on the old env-only default behavior. Use the file links already named in this story, especially [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts).
3. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) with any remaining command or behavior changes from this story, including the `CODEINFO_CONTEXT7_API_KEY` runtime behavior if that documentation is still incomplete. Make sure the README wording matches the acceptance criteria and does not reintroduce old sample-file bootstrap behavior or old Codex default-precedence wording.
4. [x] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it fully reflects the final shared model/default-resolution path, the canonical bootstrap source of truth, the shared base/runtime inheritance, and the runtime-only Context7 overlay behavior. Use the implementation files already named in this story as the source of truth, especially [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), and [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), and ensure the final Mermaid diagrams cover the end-to-end resolution flow, bootstrap flow, inheritance flow, and Context7 overlay flow without drifting from the implemented behavior.
5. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask from Tasks 1 through 6 is complete. This story-level `projectStructure.md` sweep must list every repository file added or removed during the story, plus any materially repurposed files, so the repo map still matches the code and documentation a junior will rely on next.
6. [x] Update this plan file's Task 6 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after the acceptance map and documentation updates are complete, including which documents changed and which acceptance criteria were hardest to map.
7. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and this story plan so the final regression instructions list the exact Story 47 runtime markers `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED`, `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP`, `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP`, `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`, and `DEV_0000047_T05_CONTEXT7_NORMALIZED`, plus the expected success outcomes for each. Expected outcome: Task 7 can use one canonical marker checklist during the Manual Playwright-MCP verification step without needing to infer marker names from code.
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

No wrapper test runs are required for this documentation-only task. Do not attempt to run builds or tests without the summary wrappers if you later need verification for an adjacent code change.

#### Acceptance-check list

- The chat-config model is always available to Codex even when absent from `Codex_model_list`.
  Proof: [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), [server/src/test/unit/capabilityResolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/capabilityResolver.test.ts), [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts)
- Shared Codex capability resolution owns merged model availability rather than route-only merge rules.
  Proof: [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts)
- Model-list merge preserves env order, removes duplicates deterministically, and appends the chat-config model only when missing.
  Proof: [server/src/config/codexEnvDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexEnvDefaults.ts), [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), [server/src/test/unit/capabilityResolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/capabilityResolver.test.ts)
- The model in `codex/chat/config.toml` is the default Codex model unless a request explicitly overrides it.
  Proof: [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts), [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts)
- Default precedence is request override, then chat config, then env, then hardcoded fallback.
  Proof: [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts)
- Invalid or unreadable `codex/chat/config.toml` still warns and falls back instead of introducing a new hard-error contract.
  Proof: [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts)
- Existing invalid or unreadable chat config is left in place and is not regenerated or repaired.
  Proof: [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Codex model availability and default selection reread `codex/chat/config.toml` on each request.
  Proof: [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts), [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts)
- The web chat model list reflects the current chat-config model on each request.
  Proof: [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts)
- MCP default/model selection reflects the current chat-config model on each request.
  Proof: [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts), [server/src/test/integration/mcp-codex-wrapper.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/mcp-codex-wrapper.test.ts)
- `/chat/providers` uses the shared Codex-aware default/model path instead of an env-only Codex path.
  Proof: [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/test/unit/chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts)
- Codex-facing entrypoints, including `codebase_question`, share the same Codex-aware selection behavior as REST chat.
  Proof: [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), [server/src/test/unit/chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts), [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts)
- The client continues to consume `/chat/providers` and `/chat/models` without a Story 47 response-shape change or dedicated UI rewrite.
  Proof: [client/src/hooks/useChatModel.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useChatModel.ts), [client/src/pages/ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx), [common/src/lmstudio.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/common/src/lmstudio.ts)
- `CHAT_DEFAULT_MODEL` is fallback-only and does not override a valid chat-config model.
  Proof: [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts)
- Missing `codex/chat/config.toml` is bootstrapped from one canonical in-code chat template.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Missing `codex/config.toml` is bootstrapped from one canonical in-code base template.
  Proof: [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts)
- The base and chat templates both use `model = "gpt-5.3-codex"` for bootstrap.
  Proof: [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- First-time file creation depends only on canonical in-code templates and not on `config.toml.example`, `codex/config.toml`, or `codex/chat/config copy.toml`.
  Proof: [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- `config.toml.example` remains documentation-only and is not consulted, copied, or parsed by runtime bootstrap.
  Proof: [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts)
- Missing chat bootstrap writes the chat template directly instead of copying base config first.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Missing-file bootstrap does not overwrite existing user-edited config files.
  Proof: [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Shared runtime resolution preserves base-config data needed by chat and agent execution when runtime-specific config omits it.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts), [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts)
- At minimum, `mcp_servers`, `model_provider`, and `model_providers` remain available in resolved chat and agent runtime config unless explicitly overridden.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Direct chat-template bootstrap does not remove inherited runtime settings such as MCP servers, tools, personality, or provider-routing config.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts), [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts)
- Runtime config loading applies `CODEINFO_CONTEXT7_API_KEY` in memory when a local stdio Context7 definition exists and no usable key is effectively present.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- `REPLACE_WITH_CONTEXT7_API_KEY` and `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866` are both treated as placeholder-equivalent unusable keys.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- If the env key is usable, runtime config overlays it in memory for placeholder-equivalent Context7 values.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts), [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts)
- If the env key is missing, empty, or whitespace-only, runtime config falls back to the no-key Context7 args form.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- The no-key fallback removes or replaces only the `--api-key` pair and preserves unrelated arg order and unrelated MCP definitions.
  Proof: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Explicit non-placeholder Context7 API keys remain authoritative and are not overridden from `CODEINFO_CONTEXT7_API_KEY`.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Context7 normalization is limited to local stdio `command` plus `args`; remote `url` and `http_headers` definitions remain unchanged.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Runtime config loading does not rewrite TOML files on disk to apply the Context7 env overlay.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Context7 overlay applies consistently to the chat and agent/runtime config paths that read shared runtime config.
  Proof: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts), [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts)
- Runtime config preserves unrelated MCP-server args and unrelated config values after Context7 normalization.
  Proof: [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts)
- Canonical default templates no longer depend on checked-in Context7 key material.
  Proof: [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/test/unit/codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts)
- Public REST and MCP payload shapes remain unchanged while Story 47 changes only resolved values and warnings.
  Proof: [common/src/lmstudio.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/common/src/lmstudio.ts), [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts)

#### Story 47 runtime marker checklist

- `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED`
  Expected success outcome: REST and MCP Codex-facing selection paths emit `success=true` with the resolved model and its source.
- `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP`
  Expected success outcome: base-config seeding checks emit `template_source=in_code`, `outcome=seeded|existing`, and `success=true`.
- `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP`
  Expected success outcome: chat-config seeding checks emit `source=chat_template`, `outcome=seeded|existing`, and `success=true`.
- `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`
  Expected success outcome: chat and agent runtime reads emit `success=true` with explicit inherited and runtime-owned key sets.
- `DEV_0000047_T05_CONTEXT7_NORMALIZED`
  Expected success outcome: post-inheritance runtime reads emit `success=true` and the expected normalization `mode` for the active Context7 scenario.

#### Implementation notes

- Re-read the Acceptance Criteria, Expected Outcomes, and Out Of Scope sections and added this task’s acceptance-check list so Task 7 can reuse one canonical proof map. The trickiest boundary to capture cleanly was the split between soft chat-default fallbacks and strict runtime-config failures, so those proofs now point to separate files and tests.
- Re-audited the Task 1 through Task 5 implementation files and tests for stale branches. The remaining code paths now point at in-code bootstrap, direct chat-template seeding, post-inheritance Context7 normalization, and shared Codex-aware selection; no lingering `config.toml.example` runtime reads or copy-from-base chat bootstrap branches remain.
- Updated [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) so the docs now match the final Story 47 behavior, including the unchanged client selector contract, the canonical bootstrap/inheritance rules, and the shared runtime marker checklist that Task 7 will use.
- Completed the required task-level hygiene pass with `npm run lint --workspaces` and `npm run format:check --workspaces`. Formatting passed cleanly, and lint finished with only the repository’s pre-existing import-order warnings, so no Story 47 doc changes needed further code fixes.

---

### 7. Final Runtime Verification And Pull-Request Summary

- Task Status: `__done__`
- Git Commits: `20ae4507`, `e9a8f959`

#### Overview

Run the full story-level proof that all completed changes work together in the real runtime paths, capture manual evidence, and prepare the pull-request summary. This final task is the end-to-end verification and evidence-collection step for the whole story.

#### Must Not Miss

- Keep the focus on verifying the existing UI against the corrected server behavior; this story does not require a dedicated frontend implementation task unless verification proves one is actually needed.
- Save manual verification screenshots into `test-results/screenshots/` using the story number and final task number in the filename.
- Include all story changes in the pull-request summary, not just the last task.
- Reuse the acceptance-check list produced in Task 6 so final verification closes every mapped criterion with runtime proof where appropriate.

#### Documentation Locations

- Docker Compose lifecycle commands: Context7 `/docker/compose`, specifically the `docker compose up`, `docker compose down`, `docker compose start`, and `docker compose stop` docs. These are the correct Docker references for this task because the final verification step depends on bringing the stack up cleanly, checking it, and tearing it down again.
- Playwright screenshots and screenshot assertions: Context7 `/microsoft/playwright`, specifically the screenshot guide and `LocatorAssertions.toHaveScreenshot`. These are the correct Playwright references for this task because the final proof requires saving stable manual evidence into `test-results/screenshots/`.
- Jest snapshot and expect API docs: Context7 `/jestjs/jest`, specifically snapshot testing and `Expect` matcher guidance. This is the right Jest reference for final verification because it explains how snapshot-style evidence and matcher failures are expected to behave when reviewing client-side test output.
- Cucumber guides index: https://cucumber.io/docs/guides/ and Cucumber Continuous Integration guide: https://cucumber.io/docs/guides/continuous-integration/. The guides index is the required top-level Cucumber reference for this task, and the CI guide is the specific page that explains non-zero exit behavior and build-server execution expectations when interpreting wrapper-based cucumber pass/fail results.
- Codex config layering reference: DeepWiki `openai/codex`, page `Config API and Layer System` (`/wiki/openai/codex#4.5.4` in the DeepWiki MCP tool). This keeps final verification grounded in the actual layered Codex config contract that the story changes.
- Context7 repository documentation: https://github.com/upstash/context7. The README is the correct source here because it documents the local stdio MCP shape and optional API-key behavior that final verification must preserve.
- React controlled inputs and rerenders: Context7 `/facebook/react/v19_2_0`, specifically the `react-dom/components/input` docs. This is the correct React reference for confirming why the unchanged client selector should reflect refreshed server data.
- MUI TextField API: https://llms.mui.com/material-ui/6.4.12/api/text-field.md. This page is the right MUI reference because it documents the `select` prop used by the existing client control.
- MUI Select API: https://llms.mui.com/material-ui/6.4.12/api/select.md. This page is the right MUI reference because it documents the controlled dropdown behavior the existing client already uses.
- MUI MenuItem API: https://llms.mui.com/material-ui/6.4.12/api/menu-item.md. This page is the right MUI reference because it documents the option rows rendered inside the unchanged select UI.

#### Junior Developer Notes

- Read these files before starting any subtask in Task 7: [client/src/hooks/useChatModel.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useChatModel.ts), [client/src/pages/ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx), [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), and [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
- This task is verification-only for the UI. Do not add new client behavior unless the server contract is proven insufficient during verification.
- Save screenshots with the exact naming rule in this task, and use the acceptance map from Task 6 to decide what evidence still needs to be collected.

#### Subtasks

1. [x] Re-read the acceptance-check list created in Task 6 from [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) and write down which final runtime proof or screenshot will close each remaining criterion. Keep the proof plan next to the files that drive the behavior, such as [client/src/hooks/useChatModel.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useChatModel.ts) and [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
2. [x] After Testing step 9 completes, take the raw Playwright-MCP screenshots from `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` and save the selected evidence screenshots to `test-results/screenshots/` using filenames of the form `0000047-7-<short-name>.png`. Make sure each saved screenshot can be mapped back to the acceptance-check list from Task 6 and to the GUI expectation it proves.
3. [x] Create a pull-request summary comment that covers the model/default resolution change, the base bootstrap change, the chat bootstrap change, the shared base/runtime inheritance change, the Context7 overlay change, the observed Story 47 marker lines, and the final verification results. Use the implementation files and tests already named in this story as the source material, especially [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), and the relevant server test files.
4. [x] If this task adds or removes repository files while completing the final verification work, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in Task 7 is complete. The update must list every repository file added or removed by the final verification task, and it must not list generated screenshot evidence under `test-results/screenshots/` because `projectStructure.md` is for maintained repository structure rather than runtime artifacts.
5. [x] Update this plan file's Task 7 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after all verification, screenshots, and pull-request summary work are complete, including which runtime proofs were strongest, which Story 47 markers were observed, and where the saved screenshots live.
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Mandatory for the final regression check because server/common behavior may be affected. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Mandatory for the final regression check because the final task verifies the existing client against the completed server behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Mandatory for the final regression check because server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Mandatory for the final regression check because server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Mandatory for the final regression check because the completed story is testable from the client-facing chat surface. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` - Allow up to 7 minutes. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - Use because the final regression check includes front-end-accessible validation through the containerized stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP testing step - Use the Playwright MCP tools against `http://host.docker.internal:5001` to confirm the story’s completed behavior and general regression health, and in parallel inspect `npm run compose:logs` output for the Story 47 markers documented in Task 6. During this step, capture GUI screenshots into `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` because that folder is mapped by `docker-compose.local.yml`. Review those screenshots as part of the check, not just as artifacts: confirm the chat page shows the expected provider/model defaults, the available model list matches the implemented server behavior, and the overall GUI still matches the task expectations before selecting the final screenshots to keep under `test-results/screenshots/`. Expected marker outcomes: `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` appears for both REST and MCP paths with `success=true`; `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP` appears during startup with `template_source=in_code` and `success=true` when seeding is needed; `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP` appears during startup with `source=chat_template` and `success=true` when seeding is needed; `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED` appears for chat and agent runtime reads with `success=true`; and `DEV_0000047_T05_CONTEXT7_NORMALIZED` appears with the expected `mode` for the configured scenario and `success=true`. Also verify that the chat UI reflects the server-selected defaults and available models, that every GUI-visible acceptance item is backed by a screenshot where practical, and that there are no logged errors in the browser debug console.
10. [x] `npm run compose:down`

#### Implementation notes

#### Final runtime proof plan

- Shared Codex model/default behavior: close with the wrapper build/test passes plus a manual chat-page screenshot showing the resolved provider/model state from [client/src/hooks/useChatModel.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useChatModel.ts) and [client/src/pages/ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx).
- Canonical base/chat bootstrap and inheritance: close with compose-start marker review for `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP`, `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP`, and `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`, plus the existing server wrapper/test coverage already mapped in Task 6.
- Runtime-only Context7 normalization: close with compose-log review for `DEV_0000047_T05_CONTEXT7_NORMALIZED` and the existing runtime-config/codebase-question proof files from Task 6.
- Client-contract stability: close with the unchanged chat-page UI behaving correctly against `http://host.docker.internal:5001`, backed by screenshots and a clean browser console.

- Re-read the Task 6 acceptance map and converted it into this final runtime proof plan so the wrapper runs, compose logs, and screenshots all tie back to the same acceptance sources. The key constraint is keeping UI verification focused on existing behavior, with marker and wrapper evidence closing the server-side criteria.
- `npm run build:summary:server` passed with `status: passed` and `warning_count: 0`, so the final server/common regression gate stayed clean before the runtime verification steps.
- `npm run build:summary:client` passed cleanly through its typecheck and build phases with `warning_count: 0`, which keeps the unchanged chat selector path eligible for the manual UI verification later in this task.
- `npm run test:summary:server:unit` passed with `tests run: 1202`, `passed: 1202`, and `failed: 0`, so the full server/common regression suite stayed clean before compose-level verification.
- `npm run test:summary:server:cucumber` passed with `tests run: 71`, `passed: 71`, and `failed: 0`, so the higher-level server regression scenarios also stayed green for the final verification run.
- `npm run test:summary:client` passed with `tests run: 544`, `passed: 544`, and `failed: 0`, which keeps the existing client-facing chat surface on a clean full-suite baseline before manual Playwright verification.
- `npm run test:summary:e2e` passed with `tests run: 43`, `passed: 43`, and `failed: 0`, so the wrapper-driven end-to-end regression flow stayed green before the manual compose-based Story 47 checks.
- `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`, which cleared the containerized build gate before bringing the stack up for manual verification.
- `npm run compose:up` completed with the stack healthy, including the final `codeinfo2-server-1` and `codeinfo2-client-1` healthy/started transitions needed for the manual Playwright-MCP verification step.
- Manual Playwright-MCP verification against `http://host.docker.internal:5001/chat` confirmed the unchanged Chat page reflected the server-selected Codex defaults, showed the expected `qwen3.5-122b-a10b` default model, kept `gpt-5.3-codex` in the merged model dropdown, and produced no browser-console errors. The selected screenshots were saved to [test-results/screenshots/0000047-7-chat-defaults.png](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/test-results/screenshots/0000047-7-chat-defaults.png) and [test-results/screenshots/0000047-7-chat-model-list.png](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/test-results/screenshots/0000047-7-chat-model-list.png).
- Compose-log review observed `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` for both REST and MCP, `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP` with `template_source: 'in_code'`, `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP` with `source: 'chat_template'`, `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED` for both `chat` and `agent`, and `DEV_0000047_T05_CONTEXT7_NORMALIZED` with `mode: 'no_key_fallback'`; every observed Story 47 marker reported `success: true`.
- Added the Task 7 PR summary artifact at [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so the final review can reuse one concise story summary with marker observations and wrapper results.
- Updated [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after adding the maintained PR-summary artifact, while intentionally keeping the generated screenshot files out of the structure ledger.
- `npm run lint --workspaces` surfaced the repo's standing import-order warnings again, and `npm run format:check --workspaces` passed cleanly for every workspace. No new Task 7 formatting issues were introduced, so the final closeout preserved the existing lint baseline while keeping the touched files Prettier-clean.
- `npm run compose:down` completed successfully and removed the Story 47 verification stack, closing the compose lifecycle after the final runtime proof and screenshot capture.

---

## Code Review Findings

### Review Summary

Story 47 was reviewed against the active plan, the branch diff versus `main`, and the durable review artifacts in `codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-evidence.md` and `codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md`. The review found one correctness issue that breaks the intended runtime Context7 overlay contract, one branch-scope cleanup issue caused by unrelated future-story planning files on this story branch, and one optional simplification opportunity around runtime-config concentration.

This story is therefore reopened. Task 8 fixes the runtime Context7 overlay gap, Task 9 removes the unrelated planning drift from this branch, and Task 10 reruns full validation so Story 47 is re-proven against the acceptance criteria after the review-driven changes.

### Acceptance Proof Status

1. AC1 `chat-config model is available to Codex`: `direct`
2. AC2 `shared capability path owns merged model list`: `direct`
3. AC3 `env order + dedupe + append-only merge`: `direct`
4. AC4 `chat-config model is default unless overridden`: `direct`
5. AC5 `request -> config -> env -> hardcoded precedence`: `direct`
6. AC6 `invalid/unreadable chat config warns and falls back`: `direct`
7. AC7 `invalid existing chat config is left in place`: `direct`
8. AC8 `chat config is reread on each request`: `direct`
9. AC9 `web chat model list reflects current chat config`: `direct`
10. AC10 `MCP default/model selection reflects current chat config`: `direct`
11. AC11 `/chat/providers` uses shared Codex-aware selection`: `direct`
12. AC12 `Codex-facing entrypoints share the same selection behavior`: `direct`
13. AC13 `existing client contract remains usable without response-shape change`: `indirect`
14. AC14 `CHAT_DEFAULT_MODEL is fallback-only`: `direct`
15. AC15 `missing chat config bootstraps from canonical chat template`: `direct`
16. AC16 `missing base config bootstraps from canonical base template`: `direct`
17. AC17 `both templates use gpt-5.3-codex`: `direct`
18. AC18 `bootstrap uses only in-code canonical templates`: `direct`
19. AC19 `config.toml.example is documentation-only`: `direct`
20. AC20 `chat bootstrap writes chat template directly, not copy-from-base`: `direct`
21. AC21 `missing-file bootstrap does not overwrite existing configs`: `direct`
22. AC22 `shared runtime resolution preserves required base data`: `direct`
23. AC23 `mcp_servers/model_provider/model_providers remain available`: `direct`
24. AC24 `direct chat bootstrap does not remove inherited runtime settings`: `direct`
25. AC25 `Context7 overlay applies when no usable key exists`: `missing`
26. AC26 `placeholder + legacy key values count as unusable`: `direct`
27. AC27 `placeholder-equivalent values are overlaid from env`: `direct`
28. AC28 `placeholder-equivalent values fall back to no-key form when env missing`: `direct`
29. AC29 `no-key fallback only removes the api-key pair and preserves other args`: `direct`
30. AC30 `explicit non-placeholder Context7 key wins`: `direct`
31. AC31 `Context7 normalization only affects local stdio definitions`: `direct`
32. AC32 `Context7 overlay does not rewrite TOML on disk`: `direct`
33. AC33 `Context7 overlay applies consistently to chat and agent runtime reads`: `direct`
34. AC34 `unrelated MCP args and config values are preserved`: `direct`
35. AC35 `canonical templates no longer depend on checked-in Context7 key material`: `direct`
36. AC36 `public REST and MCP payload shapes remain unchanged`: `indirect`

There is no other acceptance criterion currently classified as `missing`, but AC13 and AC36 remain indirect because their runtime and contract evidence is based on unchanged client/type code plus manual verification rather than a dedicated contract snapshot.

### Succinctness Review

The implemented Story 47 behavior is mostly appropriately scoped, but `server/src/config/runtimeConfig.ts`, `server/src/test/unit/runtimeConfig.test.ts`, and `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` now carry several Story 47 responsibilities in concentrated form. That concentration is acceptable to leave alone while the correctness and scope findings are being fixed, but it remains a valid optional simplification candidate if the reopened work touches those areas again.

### 8. Restore Context7 Env Overlay For No-Key Definitions

- Task Status: `__done__`
- Git Commits: `868c053b`, `39fbeb10`

#### Overview

Fix the Story 47 Context7 normalization gap so a local stdio Context7 definition that already uses the canonical no-key args form still picks up `CODEINFO_CONTEXT7_API_KEY` in memory when that env var is set. This task exists because the review found that Story 47 currently overlays placeholder values but does not append an env key when the `--api-key` pair is entirely absent.

#### Must Not Miss

- Preserve the existing rule that an explicit non-placeholder Context7 API key remains authoritative.
- Preserve the existing rule that missing or empty `CODEINFO_CONTEXT7_API_KEY` keeps the no-key args form.
- Scope the fix only to local stdio-style Context7 definitions that use `command` plus `args`.
- Preserve unrelated Context7 args in their original order; if a new `--api-key` pair must be added, append it deterministically rather than reshuffling earlier args.
- Extend tests for the exact review finding: no-key args plus a non-empty env key must produce an in-memory args list that includes `--api-key <env>`.

#### Documentation Locations

- [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md): use the Description lines about Context7 overlay and the AC lines about “no usable key” as the contract source of truth.
- [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts): current normalization logic and Story 47 markers live here.
- [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts): current unit coverage for Context7 normalization lives here.
- [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts): downstream runtime-config proof for inherited Context7 settings lives here.
- https://github.com/upstash/context7: use the local stdio MCP shape as the external shape reference.

#### Junior Developer Notes

- Read the review findings artifact [codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md) before editing code so you understand the exact contract gap you are fixing.
- Start from the existing `normalizeContext7Args()` helper rather than inventing a second normalization path.
- Keep this task about runtime normalization and proof coverage only. Do not expand it into general Context7 validation or broader MCP-schema changes.

#### Example Shapes

```ts
// Story 47 fix target for this task.
const args = ['-y', '@upstash/context7-mcp'];
const env = 'ctx7sk-real';

// In-memory normalized result:
['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'];
```

#### Subtasks

1. [x] Re-read the Story 47 review finding about no-key Context7 env overlay in [codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md) and copy the exact contract into your working notes before editing: when no usable key is present, a non-empty `CODEINFO_CONTEXT7_API_KEY` must be applied in memory even if the `--api-key` pair is absent.
2. [x] Update [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so `normalizeContext7Args()` appends `--api-key <env>` when the Context7 args are already in the no-key form and `CODEINFO_CONTEXT7_API_KEY` is non-empty.
3. [x] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a no-key args list plus `CODEINFO_CONTEXT7_API_KEY=ctx7sk-real` becomes `['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real']` in memory.
4. [x] Add or update a runtime-resolution test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves resolved chat or agent runtime config inherits a no-key base Context7 definition and still gains the env key in memory.
5. [x] Add or update the downstream proof in [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts) so the MCP path proves the same no-key-plus-env overlay contract, not only placeholder replacement.
6. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) and [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) if either document currently implies that env overlay only happens when a placeholder key is present.
7. [x] Update this plan file’s Task 8 `Implementation notes` after the fix and tests are complete, including the exact no-key scenario that was broken and how the new coverage closes it.
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve the remaining task-owned issues.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Locked the Task 8 contract from the review findings before editing code: when no usable Context7 key is present, a non-empty `CODEINFO_CONTEXT7_API_KEY` must be applied in memory even if the local stdio args already omit the `--api-key` pair.
- Updated `normalizeContext7Args()` so no-key local stdio Context7 args now append `--api-key <env>` in memory when `CODEINFO_CONTEXT7_API_KEY` is usable, while the blank-env path still leaves the canonical no-key args untouched.
- Added a focused unit proof that the no-key helper path now normalizes `['-y', '@upstash/context7-mcp']` to `['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real']` when the env var is present.
- Added a runtime-resolution proof that inherited base Context7 no-key args now pick up the env key in resolved chat runtime config without rewriting TOML on disk.
- Extended the MCP happy-path proof so `codebase_question` now receives the same env-overlaid runtime config for inherited no-key Context7 args, not only placeholder replacements.
- Tightened `README.md` and `design.md` so Story 47 now documents env overlay for both placeholder-equivalent keys and the already-no-key local stdio args form.
- Ran `npm run format:check --workspaces` cleanly, and `npm run lint --workspaces` stayed on the repository’s existing import-order-warning baseline without adding new Task 8 lint errors.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the Task 8 runtime-normalization change compiled cleanly without log inspection.
- The first full `npm run test:summary:server:unit` run exposed a deterministic integration-test isolation issue: `chat-codex-mcp.test.ts` was reading host `/app/codex` defaults through `CODEX_HOME` instead of the temp Story 47 test home, so I bound `CODEX_HOME` to the test fixture home alongside `CODEINFO_CODEX_HOME` before rerunning.
- Passed the rerun of `npm run test:summary:server:unit` with `tests run: 1205`, `passed: 1205`, `failed: 0`, and `agent_action: skip_log` after tightening that Codex-home test isolation.
- The broken Task 8 scenario is now covered at three levels: direct helper normalization for existing no-key args, resolved chat runtime inheritance from a no-key base Context7 definition, and MCP `codebase_question` consumption of the same overlaid runtime config.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the Context7 overlay fix and the test-isolation cleanup stayed compatible with the higher-level server feature suite.
- Re-ran `npm run format:check --workspaces` cleanly after the test-isolation follow-up edit, and `npm run lint --workspaces` remained on the repository’s existing 38 import-order warnings with no new Task 8 lint errors.

### 9. Remove Unrelated Future-Story Planning Drift From The Story 47 Branch

- Task Status: `__done__`
- Git Commits: `784117db`, `16919506`

#### Overview

Remove the unrelated future-story planning changes from this branch so Story 47 again contains only Story 47 work plus approved workflow-support paths. This task exists because the review found future-story planning files on the branch that are not part of the active story and are not protected by the workflow-path exception.

#### Must Not Miss

- Keep the approved workflow-support paths under `codeInfoStatus/**`, `flows/**`, and `codex_agents/**` intact; this task is about unrelated planning drift, not workflow config.
- Restore the planning directory so the `main...HEAD` diff no longer carries future-story planning additions or renumbering unrelated to Story 47.
- If removing or reverting planning files changes [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), update it so the maintained structure ledger matches the final Story 47 branch state.
- Do not delete the durable review artifacts created during this review. They must be committed with the reopened plan changes.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md): this is the source of the should-fix finding this task resolves.
- [planning/0000048-github-copilot-sdk-chat-provider.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-github-copilot-sdk-chat-provider.md) and [planning/0000049-command-and-flow-user-input-wait-step.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000049-command-and-flow-user-input-wait-step.md): current out-of-scope planning files to resolve for this branch.
- [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md): update only if the maintained repo structure entries need to change after the planning cleanup.
- [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md): use the branching and commit-message rules while closing this review-driven branch cleanup.

#### Junior Developer Notes

- Treat this as branch hygiene work, not as a chance to rewrite future stories.
- Re-check `git diff --name-status main...HEAD -- planning projectStructure.md` before and after the cleanup so you can prove the branch only carries Story 47 planning changes afterward.
- Keep the transient handoff file under `codeInfoStatus/reviews/0000047-current-review.json` out of the commit unless later workflow explicitly asks for it.

#### Example Shapes

```text
Before cleanup:
planning/0000048-github-copilot-sdk-chat-provider.md
planning/0000049-command-and-flow-user-input-wait-step.md

After cleanup:
only Story 47 planning files remain changed on this branch
```

#### Subtasks

1. [x] Re-read the Story 47 review finding about out-of-scope planning drift in [codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md) and write down exactly which planning paths must leave the Story 47 branch.
2. [x] Update the planning tree so the unrelated future-story files [planning/0000048-github-copilot-sdk-chat-provider.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000048-github-copilot-sdk-chat-provider.md) and [planning/0000049-command-and-flow-user-input-wait-step.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000049-command-and-flow-user-input-wait-step.md) no longer remain as Story 47 branch changes.
3. [x] Re-check `git diff --name-status main...HEAD -- planning projectStructure.md` and confirm only Story 47 planning changes remain in the branch diff after the cleanup.
4. [x] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the maintained structure ledger still reflects the removed or restored planning files incorrectly after the cleanup.
5. [x] Update this plan file’s Task 9 `Implementation notes` after the cleanup is complete, including what was removed or restored and how you verified the planning diff was narrowed back to Story 47.
6. [x] Run `npm run format:check --workspaces` if any maintained markdown or JSON files owned by this task changed in a way that could affect formatting consistency.

#### Testing

No wrapper test runs are required for this planning-only task. Do not attempt to run tests without using the wrapper if later verification becomes necessary. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Confirmed the exact Task 9 cleanup target from the review finding before editing: remove `planning/0000048-github-copilot-sdk-chat-provider.md` and undo the `planning/0000048-command-and-flow-user-input-wait-step.md` -> `planning/0000049-command-and-flow-user-input-wait-step.md` future-story rename from this branch.
- Restored the planning tree toward `main` for the out-of-scope paths by deleting the GitHub Copilot story file from this branch and restoring the command/user-input-wait plan back to `planning/0000048-command-and-flow-user-input-wait-step.md`.
- Re-checked `git diff --name-status main...HEAD -- planning projectStructure.md` after the cleanup commit and confirmed the planning diff is now narrowed back to Story 47 artifacts: the active plan file and the maintained `planning/0000047-pr-summary.md`.
- `projectStructure.md` did not need a Task 9 edit because its remaining branch diff only tracks the maintained `planning/0000047-pr-summary.md` entry and no longer references the removed future-story planning drift.
- Ran `npm run format:check --workspaces` after the Task 9 markdown updates, and all client, server, and common workspace files remained Prettier-clean.

### 10. Revalidate Story 47 After Review Fixes

- Task Status: `__done__`
- Git Commits: `f61d82db`, `e201de97`

#### Overview

Re-run full Story 47 validation after Tasks 8 and 9 are complete so the reopened story closes again against the acceptance criteria, the review findings, and the final branch contents. This task replaces the old “complete” state with a fresh full validation pass after review-driven fixes.

#### Must Not Miss

- Re-check the review findings and prove that the `must_fix` and `should_fix` findings are both closed before calling the story done again.
- Revalidate the original Story 47 acceptance criteria, not just the new review-fix code paths.
- Refresh the PR summary and plan notes so the final maintained documentation reflects the post-review branch state.
- During manual runtime verification, explicitly prove that a no-key Context7 definition plus `CODEINFO_CONTEXT7_API_KEY` now emits the expected Story 47 marker behavior and produces an overlaid in-memory args list.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-evidence.md): use the evidence gate as the baseline for what was already proven before the review reopened the story.
- [codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md): use this file as the source of the findings that must be closed by Tasks 8 and 9.
- [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md): refresh this maintained artifact so it reflects the post-review-fix validation results.
- [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md): refresh only if the review-fix work changed the maintained docs.

#### Junior Developer Notes

- Start by re-reading the `Code Review Findings` section above so you know which review artifacts and acceptance-proof statuses must change before the story can close again.
- Treat this as a full-story revalidation task. Do not rely on the original Task 7 wrapper results once code or branch contents have changed.
- Keep the transient handoff file out of the commit. The durable artifacts for this review pass are the evidence file and findings file only.

#### Example Shapes

```text
Expected post-fix runtime proof:
DEV_0000047_T05_CONTEXT7_NORMALIZED mode=env_overlay success=true
```

#### Subtasks

1. [x] Re-read the `Code Review Findings` section in this plan and the findings artifact [codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md), then verify in working notes that Tasks 8 and 9 fully close the `must_fix` and `should_fix` findings before starting the final validation commands.
2. [x] Refresh [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so it captures the post-review-fix summary, including the corrected Context7 overlay behavior and the narrowed branch scope.
3. [x] Update this plan file’s Task 10 `Implementation notes` after validation is complete, including which findings were closed, which acceptance criteria remained indirect, and whether the optional simplification was intentionally deferred.
4. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the review-fix implementation changed the maintained story documentation or structure ledger.
5. [x] Record the git commit hashes for Tasks 8 through 10 in this plan once the reopened work is complete, then return the new review-driven tasks to `__done__`.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` - Allow up to 7 minutes. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP testing step to manually confirm Story 47 behavior and general regression health. This repeat verification must include a scenario where the runtime config uses the no-key Context7 args form, `CODEINFO_CONTEXT7_API_KEY` is non-empty, and `DEV_0000047_T05_CONTEXT7_NORMALIZED` reports `mode=env_overlay` with `success=true`. It must also confirm the chat page still reflects the expected provider/model behavior, review `npm run compose:logs` for the Story 47 markers, and verify that there are no logged errors within the browser debug console. The front end remains accessible at `http://host.docker.internal:5001` via the Playwright MCP tools.
10. [x] `npm run compose:down`

#### Implementation notes

- Re-read the review findings and evidence before rerunning validation. Task 8 now closes the `must_fix` gap by overlaying `CODEINFO_CONTEXT7_API_KEY` onto canonical no-key Context7 args, and Task 9 now closes the `should_fix` gap by removing the future-story planning drift from the Story 47 branch diff.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the final Story 47 server build gate stayed clean before the broader regression reruns.
- Passed `npm run build:summary:client` cleanly through the client typecheck/build pipeline with `warning_count: 0` and `agent_action: skip_log`, so the unchanged chat UI contract remains buildable after the review fixes.
- Passed `npm run test:summary:server:unit` with `tests run: 1205`, `passed: 1205`, `failed: 0`, and `agent_action: skip_log`, so the full post-review server unit/integration gate stayed green without extra log inspection.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the higher-level post-review server feature suite also stayed green.
- Passed `npm run test:summary:client` with `tests run: 544`, `passed: 544`, `failed: 0`, and `agent_action: skip_log`, so the client-facing regression suite remained green after the review fixes.
- Passed `npm run test:summary:e2e` with `tests run: 43`, `passed: 43`, `failed: 0`, and `agent_action: skip_log`, so the wrapper-driven end-to-end regression path also remained green.
- Created a temporary host Codex home at `/tmp/story47-task10-codex-home` with a base `config.toml` that keeps Context7 in the canonical no-key local stdio args form and a copied host `auth.json`, so the compose/manual revalidation can prove the exact `env_overlay` runtime scenario without mutating repository config files.
- Passed `CODEINFO_HOST_CODEX_HOME=/tmp/story47-task10-codex-home CODEINFO_CONTEXT7_API_KEY=ctx7sk-real npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, clearing the containerized build gate for the final manual runtime proof.
- Brought the compose stack up with `CODEINFO_HOST_CODEX_HOME=/tmp/story47-task10-codex-home` and `CODEINFO_CONTEXT7_API_KEY=ctx7sk-real`; the server reached `Healthy` and the client container started successfully, which set up the required final manual verification scenario.
- Refreshed `planning/0000047-pr-summary.md` with the post-review-fix branch summary, explicitly recording that Task 8 closed the Context7 no-key overlay gap and Task 9 narrowed the branch diff back to Story 47 artifacts only.
- No further `README.md`, `design.md`, or `projectStructure.md` changes were required during Task 10 because the review-fix work did not alter the maintained docs or structure ledger beyond the already-updated Story 47 summary artifacts.
- Manual Playwright verification against `http://host.docker.internal:5001/chat` loaded the Codex chat page with provider `codex`, model `gpt-5.1-codex-mini`, returned a successful `ok` response, and showed no browser-console errors; live compose logs also showed `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` for `/chat/models`, `/chat/providers`, and `chat_validation` with `success: true`.
- The compose-mounted `/app/codex` runtime home still reflected the repository bind mount, so the exact no-key-plus-env proof was completed inside the running server image by resolving a temporary no-key Codex home with `CODEINFO_CONTEXT7_API_KEY=ctx7sk-real`; that emitted `DEV_0000047_T05_CONTEXT7_NORMALIZED { mode: 'env_overlay', surface: 'chat', success: true }` and returned `["-y","@upstash/context7-mcp","--api-key","ctx7sk-real"]`.
- Task 10 closes both review findings: Task 8 closed the `must_fix` Context7 no-key overlay gap, and Task 9 closed the `should_fix` planning-drift gap; the review's `optional_simplification` remains intentionally deferred because the reopened work only needed correctness and proof.
- The only acceptance evidence that remained indirect is payload-shape stability, which stayed covered by unchanged route/type code plus the existing full wrapper and route/integration suites rather than by a new OpenAPI snapshot diff.
- Passed `CODEINFO_HOST_CODEX_HOME=/tmp/story47-task10-codex-home CODEINFO_CONTEXT7_API_KEY=ctx7sk-real npm run compose:down`, so the final compose teardown completed cleanly after the manual verification run.
- Reopened-task commit ledger: Task 8 used `868c053b`, `39fbeb10`, and `9be8bea8`; Task 9 used `784117db`, `16919506`, and `0e05f65c`; Task 10 used `f61d82db` and `e201de97` before this final plan-close commit.

## Post-Implementation Code Review

Story 47 was reviewed against `main` using the durable artifacts [codeInfoStatus/reviews/0000047-20260315T140322Z-ae0ae885-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T140322Z-ae0ae885-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T140322Z-ae0ae885-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T140322Z-ae0ae885-findings.md). The `main...HEAD` review confirmed that the committed branch diff is now limited to Story 47 implementation files, Story 47 docs/tests/plan files, and approved workflow-support paths under `codeInfoStatus/**`, `flows/**`, and `codex_agents/**`; no suspicious or out-of-scope files remained after Task 9 removed the future-story planning drift.

Files inspected during the review included the core implementation paths [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/config/codexEnvDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexEnvDefaults.ts), [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), together with the maintained docs and the Story 47 server/unit/integration proof files named throughout this plan.

### Acceptance Proof Status

1. AC1 `chat-config model is available to Codex`: `direct`
2. AC2 `shared capability path owns merged model list`: `direct`
3. AC3 `env order + dedupe + append-only merge`: `direct`
4. AC4 `chat-config model is default unless overridden`: `direct`
5. AC5 `request -> config -> env -> hardcoded precedence`: `direct`
6. AC6 `invalid/unreadable chat config warns and falls back`: `direct`
7. AC7 `invalid existing chat config is left in place`: `direct`
8. AC8 `chat config is reread on each request`: `direct`
9. AC9 `web chat model list reflects current chat config`: `direct`
10. AC10 `MCP default/model selection reflects current chat config`: `direct`
11. AC11 `/chat/providers` uses shared Codex-aware selection`: `direct`
12. AC12 `Codex-facing entrypoints share the same selection behavior`: `direct`
13. AC13 `existing client contract remains usable without response-shape change`: `indirect`
14. AC14 `CHAT_DEFAULT_MODEL is fallback-only`: `direct`
15. AC15 `missing chat config bootstraps from canonical chat template`: `direct`
16. AC16 `missing base config bootstraps from canonical base template`: `direct`
17. AC17 `both templates use gpt-5.3-codex`: `direct`
18. AC18 `bootstrap uses only in-code canonical templates`: `direct`
19. AC19 `config.toml.example is documentation-only`: `direct`
20. AC20 `chat bootstrap writes chat template directly, not copy-from-base`: `direct`
21. AC21 `missing-file bootstrap does not overwrite existing configs`: `direct`
22. AC22 `shared runtime resolution preserves required base data`: `direct`
23. AC23 `mcp_servers/model_provider/model_providers remain available`: `direct`
24. AC24 `direct chat bootstrap does not remove inherited runtime settings`: `direct`
25. AC25 `Context7 overlay applies when no usable key exists`: `direct`
26. AC26 `placeholder + legacy key values count as unusable`: `direct`
27. AC27 `placeholder-equivalent values are overlaid from env`: `direct`
28. AC28 `placeholder-equivalent values fall back to no-key form when env missing`: `direct`
29. AC29 `no-key fallback only removes the api-key pair and preserves other args`: `direct`
30. AC30 `explicit non-placeholder Context7 key wins`: `direct`
31. AC31 `Context7 normalization only affects local stdio definitions`: `direct`
32. AC32 `Context7 overlay does not rewrite TOML on disk`: `direct`
33. AC33 `Context7 overlay applies consistently to chat and agent runtime reads`: `direct`
34. AC34 `unrelated MCP args and config values are preserved`: `direct`
35. AC35 `canonical templates no longer depend on checked-in Context7 key material`: `direct`
36. AC36 `public REST and MCP payload shapes remain unchanged`: `indirect`

There are no acceptance criteria currently classified as `missing`. AC13 and AC36 remain indirect because the current proof is based on unchanged client/type contracts, route and integration coverage, and manual verification rather than a dedicated payload snapshot artifact.

### Succinctness Review

The implementation remains appropriately succinct for the required behavior overall, and the review did not identify any `must_fix` or `should_fix` defects that justify reopening the story. The only remaining simplification opportunity is that [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts), and [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts) still carry a dense concentration of Story 47 responsibilities and proof coverage. That concentration is a valid optional simplification watchpoint, but it is zero-risk at this stage and did not justify reopening the completed story.

The story remains complete after code review because the branch-vs-main diff is clean, the evidence and findings artifacts are durable and aligned with the final branch state, every acceptance criterion has either direct or indirect proof, and the only remaining note is a deferred optional simplification rather than a correctness, scope, or contract problem.

## Code Review Findings

External review was ingested through [codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md). That pass endorsed one `must_fix` finding and one deferred `optional_simplification`.

- `must_fix` / `generic_engineering_issue`: [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) currently lets `mergeNamedTables()` coerce malformed non-table values to `{}` before `validateRuntimeConfig()` runs, which can hide invalid runtime TOML such as `mcp_servers = "bad"` or `tools = "bad"` instead of surfacing a validation error.
- `optional_simplification` / `generic_engineering_issue`: the Story 47 marker `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` uses inconsistent `model_source` vocabularies across [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), and [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts). This is a real observability cleanup opportunity, but it is intentionally deferred because it is not a reopening correctness defect and the external automated patch examples were not safe to apply as-is.
- Rejected external comments: the `/chat/providers` generic-warning propagation comment was not adopted because it would blur the response contract rather than clearly fix a bug, and the `stat.isFile()` bootstrap comment was rejected because Story 47 explicitly treats directories and other existing non-missing paths as existing rather than bootstrap targets.

Acceptance proof status after this external review remains: AC1-12 `direct`, AC13 `indirect`, AC14-35 `direct`, and AC36 `indirect`. No acceptance criterion is currently classified as `missing`, but the external review exposed one negative-path correctness gap outside the original acceptance list: malformed merged top-level runtime tables are weakly proven and currently appear to be normalized too early. The overall implementation is still appropriately succinct for the required Story 47 behavior, but [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) remains the densest implementation area and now requires a focused repair task before the story can remain closed.

---

### 11. Preserve Validation Errors For Invalid Merged Runtime Tables

- Task Status: `__done__`
- Git Commits: `69c39822`, `c026ae61`

#### Overview

Repair the shared runtime merge path so invalid non-table values for merged runtime table keys are not silently normalized into `{}` before validation runs. This task is limited to the merge/validation contract surfaced by the external review and must not broaden Story 47 into a generic deep-merge framework or reopen already-rejected bootstrap-path comments.

#### Must Not Miss

- Keep the fix inside [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts); do not build a second runtime merge path.
- Invalid non-table values for merged table keys such as `projects`, `mcp_servers`, `tools`, and `model_providers` must remain visible to `validateRuntimeConfig()` or be rejected before merge in a way that still produces the existing validation-style failure contract.
- Preserve the valid shared inheritance behavior already implemented for real table values; this task is about malformed non-table inputs only.
- Do not change the Story 47 edge-case contract that existing non-missing chat-config paths, including directories, are treated as existing rather than bootstrap candidates.
- Do not reopen the deferred `model_source` observability simplification in this task.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md): this is the exact external findings artifact that defines the merge-before-validate defect to fix.
- [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts): the current shared merge and validation path to repair.
- [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts): the existing unit/runtime proof surface for merged runtime config behavior.
- https://toml.io/en/v1.1.0: use the table-vs-scalar TOML rules to keep the merge fix aligned with valid TOML table semantics instead of inventing a repo-local rule.

#### Junior Developer Notes

- Read [codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md) before editing code so you understand why the merge helper was reopened.
- Start from `mergeNamedTables()` and the `mergeTopLevelTable()` callers; do not invent a new merge abstraction or recursive merge engine.
- Keep this task about strict malformed-input handling only. A valid table merge that already works should continue to work exactly as it does today.

#### Example Shapes

```ts
// Incorrect current risk shape:
// runtime config TOML
// mcp_servers = "bad"
//
// Current merge path must not turn that into {}
// before validateRuntimeConfig() sees it.
```

#### Subtasks

1. [x] Re-read the external review evidence and findings artifacts for Story 47 and copy the exact contract into your working notes before editing: malformed non-table values for merged table keys must surface validation failure instead of being silently normalized into `{}`.
2. [x] Update [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so the shared merge path no longer coerces invalid non-table `baseValue` or `runtimeValue` inputs into empty tables for the merged keys covered by Story 47.
3. [x] Add or update a unit/runtime test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a malformed `mcp_servers = "bad"` input now fails validation instead of being silently dropped or replaced by inherited base data.
4. [x] Add or update a unit/runtime test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves another merged table key such as `tools = "bad"` or `projects = "bad"` also surfaces the expected validation failure.
5. [x] Add or update a regression test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves valid table inheritance for Story 47 keys still works after the fix, so the repair does not break the good path while tightening the malformed-input path.
6. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the maintained docs or structure ledger need to mention the stricter validation behavior after the implementation is complete.
7. [x] Update this plan file’s Task 11 `Implementation notes` after the fix and tests are complete, including which malformed-input cases were previously being normalized too early and how the new tests prove they now fail correctly.

#### Implementation notes

- Re-read the external review evidence and findings and locked the Task 11 contract to: malformed non-table values for merged table keys must stay visible to validation instead of being silently normalized into `{}` or replaced by inherited data.
- Updated `mergeNamedTables()` so invalid non-table runtime or base values are preserved for validation instead of being coerced into `{}`, and tightened `normalizeRuntimeConfig()` so malformed canonical `tools` values are not deleted before validation sees them.
- Added focused runtime-reader coverage proving `mcp_servers = "bad"` and `tools = "bad"` now fail with `RUNTIME_CONFIG_VALIDATION_FAILED`, while a valid inherited `mcp_servers` plus `tools` configuration still resolves successfully after the repair.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the Task 11 server build gate stayed clean without log inspection.
- Passed `npm run test:summary:server:unit` with `tests run: 1208`, `passed: 1208`, `failed: 0`, and `agent_action: skip_log`; the targeted runtimeConfig-only wrapper before the full rerun exposed the malformed `tools` value being dropped in `normalizeRuntimeConfig()`, which is why that normalization fix landed alongside the merge helper repair.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the higher-level server feature suite stayed green after tightening malformed merged-table validation.
- No `README.md`, `design.md`, or `projectStructure.md` changes were needed for Task 11 because the stricter malformed-input handling stays inside the existing runtime validation contract and did not change the maintained docs or structure ledger.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

---

### 12. Revalidate Story 47 After External Review Repair

- Task Status: `__done__`
- Git Commits: `69c39822`, `c026ae61`, `3dfc1b96`, `ca2a0678`

#### Overview

Run a fresh full-story validation pass after Task 11 closes the external `must_fix` finding so Story 47 can be closed again against the original acceptance criteria, the external review artifacts, and the final branch contents.

#### Must Not Miss

- Re-check the external findings artifact and prove that Task 11 closes the reopened `must_fix` finding before returning this story to `__done__`.
- Revalidate the original Story 47 acceptance criteria, not only the Task 11 malformed-input path.
- Keep the deferred `optional_simplification` explicitly deferred unless implementation work proves it became a correctness issue.
- Refresh the maintained summary artifacts so the final branch state reflects the post-external-review repair.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-evidence.md)
- [codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md)
- [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md)

#### Junior Developer Notes

- Treat this as a full story-close validation task. Do not rely on the earlier Task 10 wrapper results once Task 11 changes code.
- Keep the transient handoff file out of the commit; only the durable evidence/findings artifacts for this external review pass and the plan change belong in the final commit from this disposition cycle.

#### Subtasks

1. [x] Re-read the external-review findings artifact [codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T165803Z-2df347b7-findings.md) and confirm in working notes that Task 11 fully closes the reopened `must_fix` finding before starting the final regression wrappers.
2. [x] Refresh [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so it records the post-external-review repair summary and the disposition of the deferred optional simplification.
3. [x] Update this plan file’s Task 12 `Implementation notes` after validation is complete, including which external review findings were closed, which acceptance criteria remained indirect, and why the optional simplification stayed deferred.
4. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the maintained docs or structure ledger changed during Task 11.
5. [x] Record the git commit hashes for Tasks 11 and 12 in this plan once the reopened work is complete, then return the new review-driven tasks to `__done__`.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP testing step to manually confirm Story 47 behavior and general regression health after the Task 11 fix. This must still verify that the chat page works at `http://host.docker.internal:5001`, that there are no logged browser-console errors, and that the runtime/config surfaces changed by Story 47 still behave as expected after the merge-validation repair.
10. [x] `npm run compose:down`

#### Implementation notes

- Re-read the external findings and confirmed Task 11 closes the reopened `must_fix`: malformed merged-table scalars for keys like `mcp_servers` and `tools` now remain visible to validation instead of being coerced away, while the `optional_simplification` around `model_source` vocabulary remains intentionally deferred because it is still an observability cleanup rather than a correctness bug.
- Refreshed `planning/0000047-pr-summary.md` so the maintained Story 47 summary now captures the external-review repair in Task 11, the fresh Task 12 wrapper results, and the fact that the `optional_simplification` remains deferred because the final pass did not turn it into a correctness issue.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the Task 11 runtime-config repair still clears the server build gate before the broader regression suite.
- Passed `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, which keeps the Story 47 client/common surfaces green after the malformed-table validation repair even though the code change itself was server-side.
- Passed `npm run test:summary:server:unit` with `tests run: 1208`, `passed: 1208`, `failed: 0`, and `agent_action: skip_log`, so the repaired malformed-table validation path and the pre-existing Story 47 runtime behaviors still hold across the full server unit/integration suite.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, which keeps the higher-level server behavior green after tightening validation for malformed merged runtime tables.
- Passed `npm run test:summary:client` with `tests run: 544`, `passed: 544`, `failed: 0`, and `agent_action: skip_log`, so the Story 47 client behavior stayed green after the Task 11 server-side validation repair.
- Passed `npm run test:summary:e2e` with `tests run: 43`, `passed: 43`, `failed: 0`, and `agent_action: skip_log`, so the end-to-end Story 47 flow still holds after the external-review repair without any teardown or environment regressions.
- Passed `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, which keeps the explicit post-repair container build proof green before the manual runtime validation.
- Passed `npm run compose:up` and waited for `codeinfo2-server-1` and `codeinfo2-client-1` to reach healthy/started state, which made the mapped host surface ready for the final manual Playwright-MCP regression check.
- Manual Playwright-MCP verification at `http://host.docker.internal:5001/chat` loaded cleanly with provider `codex` and model `gpt-5.1-codex-mini`; a new conversation replying to `Reply with exactly ok.` returned `ok`, and the browser error console remained empty, so the Story 47 runtime/config surfaces still behave normally after the malformed-table validation repair.
- Passed `npm run compose:down`, which cleanly removed the validation stack after the manual host-port verification and closed the Task 12 regression loop without teardown errors.
- No `README.md`, `design.md`, or `projectStructure.md` changes were needed for Task 12 because the Task 11 repair stayed within the existing runtime validation contract and the maintained structure ledger remained accurate.
- Closed the external-review `must_fix` by pairing Task 11’s malformed-table validation repair with this full Task 12 rerun; the deferred `optional_simplification` stayed deferred because the fresh wrapper/manual pass kept it in the observability-cleanup category rather than exposing a product or contract bug.
- Acceptance criteria around payload-shape stability and runtime marker consistency remain partly indirect in this final pass: the full server, client, e2e, compose, and manual coverage stayed green, but there is still no dedicated route-contract snapshot artifact for those response shapes.
- Recorded the Task 11 and Task 12 implementation hashes on this task and returned the reopened external-review cycle to `__done__` after the final regression loop completed cleanly.

## Code Review Findings

Story 47 was reviewed again against the active plan, the branch diff versus `main`, and the durable artifacts [codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md). That review found one localized `should_fix` issue: the shared Story 47 marker `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` still emits incompatible `model_source` vocabularies across REST and MCP surfaces. Because the files are already touched by Story 47, the cleanup is low risk, and it improves a shared logging contract without changing public payloads, the story is reopened for one focused repair plus one fresh full revalidation pass.

Acceptance proof status for this pass remains:

- AC1-12: `direct`
- AC13: `indirect`
- AC14-35: `direct`
- AC36: `indirect`

The implemented behavior is still appropriately succinct overall. The reopening reason is not a product-correctness defect in runtime behavior or bootstrap handling; it is a shared marker-schema consistency issue that should now be fixed rather than deferred because the current review flow treats this class of low-risk, localized cleanup as actionable follow-up work.

---

### 13. Normalize Story 47 Marker Model Source Vocabulary

- Task Status: `__done__`
- Git Commits: `2cee8629`, `bfb1b04a`

#### Overview

Normalize the `model_source` vocabulary emitted by the shared Story 47 marker `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` so the touched REST and MCP entrypoints use one consistent contract. This task is intentionally limited to logging/marker consistency only; it must not change REST or MCP payload shapes and it must not reopen the already-closed runtime/bootstrap logic.

#### Must Not Miss

- Keep all public REST and MCP payload shapes unchanged; this task is about marker/event consistency only.
- Align `model_source` across [`server/src/routes/chatModels.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [`server/src/routes/chatProviders.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [`server/src/routes/chatValidators.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), and [`server/src/mcp2/tools/codebaseQuestion.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts).
- Reuse one shared normalization rule, preferably by reusing or extending the existing helper path in [`server/src/config/chatDefaults.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), instead of introducing multiple local mappers.
- If the raw Codex source value is still operationally useful, emit it under a separate clearly named field such as `codex_model_source`; do not overload one field with two vocabularies.
- Do not reopen the earlier rejected `/chat/providers` warning-propagation comment or any bootstrap-path behavior in this task.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md): this is the current review artifact that defines the marker-schema inconsistency to fix.
- [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts): current home of the shared Story 47 marker constant and existing model-source normalization logic.
- [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts): the touched marker emitters that must agree after this task.
- [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts), [server/src/test/unit/chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts), [server/src/test/unit/chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts), and [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts): likely proof surfaces for the normalized shared marker contract.

#### Junior Developer Notes

- Start by reading the current review evidence and findings artifacts so you understand exactly why this marker inconsistency is now a `should_fix` instead of a deferred cleanup.
- Keep the fix as small as possible: one shared normalization rule, touched emitters aligned to it, and matching proof.
- Prefer a shared helper over duplicating a tiny `switch` in multiple routes; the whole point of this task is to reduce schema drift risk.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md), then record in working notes the exact required outcome: one consistent `model_source` vocabulary for `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED`.
2. [x] Update the shared marker emission path so the touched Story 47 REST and MCP surfaces all emit the same `model_source` contract, reusing a shared normalization helper instead of duplicating local conversions.
3. [x] If raw Codex source information is still needed for operations, expose it under a separate stable field rather than reusing `model_source` for both normalized and raw values.
4. [x] Add or update route/MCP test coverage in the existing Story 47 server test files so the marker contract is proven consistently across `/chat/models`, `/chat/providers`, chat validation, and `codebaseQuestion`.
5. [x] Update this plan file’s Task 13 `Implementation notes` once the repair and tests are complete, including which emitters were aligned and whether a separate raw-source field was retained.
6. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the maintained docs or structure ledger need to mention the revised marker field contract.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the latest review evidence/findings and locked the Task 13 contract to: `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` must emit one normalized `model_source` vocabulary across REST and MCP surfaces.
- Reused the shared normalization path in `server/src/config/chatDefaults.ts` by extending it with the inverse helper needed to keep `model_source` normalized while avoiding route-local mapping drift.
- Updated the Story 47 marker emitters in `/chat/models`, `/chat/providers`, chat validation, and `mcp2.codebase_question` so `model_source` is now normalized and the raw Codex source is retained separately as `codex_model_source` where it is still operationally useful.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the shared marker-contract cleanup clears the server build gate before the test wrappers.
- Added focused Story 47 marker-contract coverage in the existing `/chat/models`, `/chat/providers`, chat validation, and `codebaseQuestion` test files; the first full unit pass exposed ambient `CHAT_DEFAULT_*` env leakage in two new fallback-source assertions, so those tests now clear the relevant env keys explicitly before asserting the normalized-vs-raw marker fields.
- Passed `npm run test:summary:server:unit` on rerun with `tests run: 1211`, `passed: 1211`, `failed: 0`, and `agent_action: skip_log`, which proves the aligned marker schema and the added route/MCP coverage are now green across the full server unit/integration suite.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the broader server feature suite stayed green after normalizing the shared Story 47 marker contract.
- No `README.md`, `design.md`, or `projectStructure.md` changes were needed for Task 13 because the repair stays inside the Story 47 logging contract and does not change maintained runtime behavior or structure documentation.

---

### 14. Revalidate Story 47 After Marker Consistency Repair

- Task Status: `__done__`
- Git Commits: `2cee8629`, `bfb1b04a`, `eb6fa970`, `d9f55891`

#### Overview

Run one fresh full-story validation pass after Task 13 so Story 47 can close again with the new shared marker contract, the prior external-review repair, and the final branch contents all reflected in the maintained evidence.

#### Must Not Miss

- Re-check the current review findings artifact and prove that Task 13 closes the reopened `should_fix` before returning the story to `__done__`.
- Revalidate the original Story 47 acceptance criteria, not only the marker-schema cleanup.
- Keep the payload-shape acceptance criteria explicitly indirect unless this task adds a dedicated contract snapshot artifact.
- Refresh the maintained summary artifacts so the final branch state reflects the post-marker-repair validation.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-evidence.md)
- [codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md)
- [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md)

#### Junior Developer Notes

- Treat this as a full story-close validation task. Do not rely on the earlier Task 12 wrapper results once Task 13 changes code.
- Keep the transient handoff file out of the commit; only the durable evidence/findings artifacts for this review pass and the plan change belong in the final commit from this disposition cycle.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T191021Z-15417516-findings.md) and confirm in working notes that Task 13 fully closes the reopened `should_fix` finding before starting the final regression wrappers.
2. [x] Refresh [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so it records the post-marker-repair summary and the final disposition of any remaining indirect-proof areas.
3. [x] Update this plan file’s Task 14 `Implementation notes` after validation is complete, including which review findings were closed, which acceptance criteria remained indirect, and whether any simplification opportunities remain intentionally deferred.
4. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the maintained docs or structure ledger changed during Task 13.
5. [x] Record the git commit hashes for Tasks 13 and 14 in this plan once the reopened work is complete, then return the new review-driven tasks to `__done__`.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP testing step to manually confirm Story 47 behavior and general regression health after the Task 13 marker repair. This must still verify that the chat page works at `http://host.docker.internal:5001`, that there are no logged browser-console errors, and that the runtime/config surfaces changed by Story 47 still behave as expected after the shared marker vocabulary cleanup.
10. [x] `npm run compose:down`

#### Implementation notes

- Re-read the current review findings/evidence and confirmed Task 13 closes the reopened `should_fix`: the shared Story 47 marker now emits one normalized `model_source` vocabulary across the touched REST and MCP surfaces, with raw Codex source retained separately as `codex_model_source` where needed.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the post-marker-repair branch still clears the server build gate before the broader regression pass.
- Passed `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, which keeps the Story 47 client/common surfaces green after the marker-contract cleanup.
- Passed `npm run test:summary:server:unit` with `tests run: 1211`, `passed: 1211`, `failed: 0`, and `agent_action: skip_log`, so the marker-contract repair and the earlier Story 47 runtime/bootstrap fixes still hold together across the full server unit/integration suite.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the higher-level server behavior stayed green after the shared marker vocabulary repair.
- Passed `npm run test:summary:client` with `tests run: 544`, `passed: 544`, `failed: 0`, and `agent_action: skip_log`, so the client-facing Story 47 behavior remains green after the Task 13 marker cleanup.
- Passed `npm run test:summary:e2e` with `tests run: 43`, `passed: 43`, `failed: 0`, and `agent_action: skip_log`, so the end-to-end Story 47 flow still holds after the marker-schema cleanup.
- Passed `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, which keeps the explicit post-marker-repair container build proof green before the final manual runtime check.
- Passed `npm run compose:up` and waited for `codeinfo2-server-1` to reach healthy state and `codeinfo2-client-1` to start, which made the mapped host surface ready for the final manual browser verification.
- Refreshed `planning/0000047-pr-summary.md` so the maintained story summary now records Task 13 closing the reopened `should_fix`, the fresh Task 14 regression results, and the fact that AC13 and AC36 still remain indirect because this pass did not add a dedicated payload-shape snapshot artifact.
- No `README.md`, `design.md`, or `projectStructure.md` changes were needed for Task 14 because the marker-consistency repair did not change maintained runtime behavior or the structure ledger.
- Manual Playwright-MCP verification at `http://host.docker.internal:5001/chat` loaded cleanly with provider `codex` and model `gpt-5.1-codex-mini`; a new conversation replying to `Reply with exactly ok.` returned `ok`, and the browser error console remained empty, so the Story 47 runtime/config surfaces still behave normally after the shared marker-vocabulary repair.
- Passed `npm run compose:down`, which shut down the Story 47 regression stack cleanly after the host-port manual verification.
- Task 14 closes the reopened `should_fix` by pairing Task 13's shared marker-vocabulary repair with a fresh full regression pass; AC13 and AC36 remain intentionally indirect because this review cycle still did not add a dedicated payload-shape snapshot artifact, and there is no additional simplification intentionally deferred in this reopened pass.
- Recorded the Task 13 and Task 14 implementation hashes in this plan and returned Task 14 to `__done__`, leaving the reopened review cycle fully closed in the maintained story record.

## Code Review Findings

Story 47 was reviewed again against the active plan, the branch diff versus `main`, and the durable artifacts [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md). That review found one localized `should_fix` issue: mixed-shape runtime configs can now silently lose the legacy `features.view_image_tool` alias whenever a `tools` table exists without `tools.view_image`. Because the regression is in a file already touched by Story 47, is low risk to repair, and restores backward-compatible normalization behavior without changing public payloads, the story is reopened for one focused fix plus one fresh full revalidation pass.

Acceptance proof status for this pass remains:

- AC1-12: `direct`
- AC13: `indirect`
- AC14-35: `direct`
- AC36: `indirect`

No acceptance criterion is currently classified as `missing`, but this review exposed one generic engineering defect outside the original acceptance list: mixed-shape alias compatibility in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) is no longer preserved when legacy and canonical structures partially coexist. The implemented code remains appropriately succinct overall, but [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) is still the densest Story 47 surface and now requires this targeted compatibility repair before the story can remain closed.

The current pass durable review artifacts that must be committed alongside the plan change are:

- [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md)
- [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md)

---

### 15. Restore Mixed-Shape `view_image` Alias Compatibility In Runtime Normalization

- Task Status: `__done__`
- Git Commits: `9ab1a8e0`, `d4cf094d`

#### Overview

Repair the mixed-shape runtime normalization regression so legacy `features.view_image_tool` continues to populate `tools.view_image` when a runtime config already has a `tools` table but does not define `tools.view_image`. This task is intentionally scoped to backward-compatible normalization behavior in `server/src/config/runtimeConfig.ts`; it must not reopen the Story 47 bootstrap-path contract that intentionally treats existing unusable chat-config paths as existing.

#### Must Not Miss

- Keep the fix localized to runtime normalization and its tests; do not broaden this task into unrelated bootstrap or marker work.
- Preserve the current precedence rule for canonical values: if `tools.view_image` already exists, it remains authoritative and the legacy alias stays ignored.
- Restore the previous mixed-shape compatibility behavior: if `tools` exists but `tools.view_image` does not, a usable `features.view_image_tool` value should still populate `tools.view_image`.
- Do not change the plan-authorized Story 47 rule that existing directories or other unusable chat-config paths count as `existing` rather than `missing`.
- Add direct regression coverage for the mixed-shape coexistence path that triggered the reopened `should_fix`.
- Keep public REST and MCP payload shapes unchanged.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md): current evidence artifact for the reopened review cycle, including the top-risk helper analysis and external review disposition.
- [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md): the current findings artifact that defines the exact mixed-shape alias defect to repair.
- [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts): current home of `normalizeRuntimeConfig()` and the mixed-shape alias logic that now needs repair.
- [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts): existing runtime normalization and bootstrap proof file where the mixed-shape regression test should be added.

#### Junior Developer Notes

- Read the reopened findings artifact first so you understand the exact path that regressed: this is not about alias-only input and not about canonical conflict; it is specifically about partial coexistence of legacy and canonical shapes.
- Keep the repair small. The target outcome is to restore compatibility for mixed-shape inputs while preserving canonical-key precedence and the existing Story 47 bootstrap contract.
- When you add the regression test, make the mixed-shape input explicit. Include at least one unrelated `tools` entry plus `features.view_image_tool = true`, then assert that both the unrelated tool and `tools.view_image` survive normalization.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md), then write down the exact defect in working notes before changing code: a `tools` table without `tools.view_image` must not suppress `features.view_image_tool`.
2. [x] Update `normalizeRuntimeConfig()` in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so a usable legacy `features.view_image_tool` value still populates `tools.view_image` when the runtime config has a `tools` table but no canonical `tools.view_image` key. Keep canonical `tools.view_image` authoritative when it already exists.
3. [x] Add or update focused regression coverage in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) for the mixed-shape coexistence path, proving that unrelated `tools` keys are preserved and that `tools.view_image` is restored from the legacy alias only when the canonical key is absent.
4. [x] Re-run any existing Story 47 runtime normalization assertions in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that cover alias-only and canonical-conflict inputs, ensuring the repair does not regress the already-closed Story 47 behavior.
5. [x] Update this plan file’s Task 15 `Implementation notes` after the repair and tests are complete, including the exact mixed-shape input that failed before the fix and how the final condition preserves canonical precedence.
6. [x] Update [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) only if the maintained Story 47 summary needs to mention the reopened mixed-shape compatibility repair before the final validation task closes the story again.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the reopened review evidence and findings before editing and locked the Task 15 defect to one rule: a `tools` table without `tools.view_image` must not suppress the legacy `features.view_image_tool` alias.
- Updated `normalizeRuntimeConfig()` in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so the legacy alias now backfills `tools.view_image` whenever the canonical key is absent, even if unrelated `tools` entries already exist.
- Added a focused mixed-shape regression in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that keeps an unrelated `tools.web_search` entry while restoring `tools.view_image` from `features.view_image_tool`.
- Re-ran the runtimeConfig unit file through the server-unit summary wrapper to prove the existing alias-only and canonical-conflict assertions still pass alongside the new mixed-shape coverage.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the localized runtime-normalization repair still clears the server build gate cleanly.
- Passed `npm run test:summary:server:unit` with `tests run: 1212`, `passed: 1212`, `failed: 0`, and `agent_action: skip_log`, so the full server unit/integration suite stayed green after restoring the mixed-shape alias path.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the higher-level server feature suite also stayed green after the mixed-shape compatibility repair.
- The concrete mixed-shape regression now covered is `features.view_image_tool = true` plus `tools.web_search = false`, which now preserves `tools.web_search` while backfilling `tools.view_image`; canonical `tools.view_image` still wins when it already exists.
- Left [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) unchanged in Task 15 because Task 16 is the dedicated maintained-summary refresh point for the final reopened validation cycle.

---

### 16. Revalidate Story 47 After Mixed-Shape Alias Repair

- Task Status: `__done__`
- Git Commits: `3eba2b73`, `19056ee8`

#### Overview

Run one fresh full-story validation pass after Task 15 so Story 47 can close again with the mixed-shape alias repair, the earlier external-review fixes, and the final branch contents all reflected in the maintained evidence. This task is the new final acceptance gate and must re-check the full Story 47 contract rather than only the reopened normalization defect.

#### Must Not Miss

- Re-check the current review findings artifact and prove that Task 15 closes the reopened `should_fix` before returning the story to `__done__`.
- Revalidate the original Story 47 acceptance criteria, not only the mixed-shape alias repair.
- Keep AC13 and AC36 explicitly indirect unless this task adds a dedicated payload-shape snapshot artifact.
- Refresh the maintained Story 47 summary artifacts so the final branch state records the reopened review cycle and its closeout.
- Keep the transient handoff file out of the commit; only the durable evidence/findings artifacts for this review pass and the plan change belong in the final commit from this disposition cycle.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-evidence.md)
- [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md)
- [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md)

#### Junior Developer Notes

- Treat this as a full story-close validation task. Do not rely on the earlier Task 14 wrapper results once Task 15 changes runtime normalization logic.
- The reopened review finding is generic engineering scope, but the final validation still needs to prove the full Story 47 acceptance set remains green after the compatibility repair.
- If the Task 15 repair changes the final Story 47 summary or acceptance-proof notes, update them here before closing the story again.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T213021Z-af04dbf5-findings.md) and confirm in working notes that Task 15 fully closes the reopened `should_fix` before starting the final regression wrappers.
2. [x] Refresh [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so it records the mixed-shape alias repair, the fresh Task 16 regression results, and the final disposition of any remaining indirect-proof areas.
3. [x] Update this plan file’s Task 16 `Implementation notes` after validation is complete, including which review finding was closed, which acceptance criteria remain indirect, and whether any simplification opportunities remain intentionally deferred.
4. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the maintained docs or structure ledger changed during Task 15.
5. [x] Record the git commit hashes for Tasks 15 and 16 in this plan once the reopened work is complete, then return the new review-driven tasks to `__done__`.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP testing step to manually confirm Story 47 behavior and general regression health after the Task 15 mixed-shape alias repair. This must still verify that the chat page works at `http://host.docker.internal:5001`, that there are no logged browser-console errors, and that the runtime/config surfaces changed by Story 47 still behave as expected after the compatibility fix.
10. [x] `npm run compose:down`

#### Implementation notes

- Re-read the reopened mixed-shape findings before validation and confirmed Task 15 closes the `should_fix`: the missing `tools.view_image` path is now covered directly while canonical `tools.view_image` precedence remains intact.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the post-Task-15 branch still clears the server build gate cleanly before the broader regression reruns.
- Passed `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the unchanged client contract still builds cleanly after the mixed-shape runtime repair.
- Passed `npm run test:summary:server:unit` with `tests run: 1212`, `passed: 1212`, `failed: 0`, and `agent_action: skip_log`, so the full server unit/integration gate remained green after the Task 15 compatibility fix.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the higher-level server feature suite remained green after the mixed-shape repair as well.
- Passed `npm run test:summary:client` with `tests run: 544`, `passed: 544`, `failed: 0`, and `agent_action: skip_log`, so the client-facing regression suite remained green after the Task 15 runtime-only change.
- Passed `npm run test:summary:e2e` with `tests run: 40`, `passed: 40`, `failed: 0`, and `agent_action: skip_log`, so the wrapper-driven end-to-end flow also remained green after the mixed-shape alias repair.
- Passed `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, which cleared the compose build gate before the final manual host-port verification.
- Passed `npm run compose:up`, reaching a healthy server and started client before the manual host-port verification step.
- Manual Playwright verification against `http://host.docker.internal:5001/chat` loaded the chat page successfully, initialized provider `codex` with model `gpt-5.1-codex-mini`, returned `ok` for `Reply with exactly ok.`, and showed no browser-console errors.
- Refreshed [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so the maintained Story 47 summary now records the Task 15 mixed-shape repair, the Task 16 rerun results, and the remaining indirect-proof areas.
- No additional changes were needed in [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), or [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) because Task 15 repaired compatibility inside the existing runtime contract rather than changing maintained docs or the structure ledger.
- Passed `npm run compose:down`, which removed the validation stack cleanly after the final host-port manual verification.
- Task 16 closes the reopened `should_fix` by pairing Task 15’s mixed-shape alias repair with this fresh full regression pass; AC13 and AC36 remain intentionally indirect because this cycle still does not add a dedicated payload-shape snapshot artifact, and no further simplification work was needed in this closeout pass.
- Recorded the reopened-task ledger in this plan and returned Task 16 to `__done__` after the final revalidation pass completed cleanly.

## Code Review Findings

Story 47 was reviewed again against the active plan, the branch diff versus `main`, and the durable artifacts [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md). That review found one localized `should_fix` issue: malformed legacy alias values for `features.view_image_tool` and `features.web_search_request` can still be deleted by `normalizeRuntimeConfig()` before the existing runtime-config validator has a chance to reject them. Because the defect is inside a file already changed by Story 47, weakens validation correctness without changing public payloads, and is low risk to repair, the story is reopened for one focused validation-order fix plus one fresh full revalidation pass.

Acceptance proof status for this pass remains:

- AC1-7: `direct`
- AC8: `indirect`
- AC9-12: `direct`
- AC13: `indirect`
- AC14-35: `direct`
- AC36: `indirect`

No acceptance criterion is currently classified as `missing`, but the review exposed one generic engineering defect outside the original acceptance list: malformed legacy alias values can still normalize into success silently inside [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts). The implemented code remains appropriately succinct overall, but [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) is still the densest Story 47 surface and the normalization-before-validation path remains the clearest simplification hotspot because it currently hides malformed input instead of letting the existing validator reject it.

The current pass durable review artifacts that must be committed alongside the plan change are:

- [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md)
- [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md)

---

### 17. Preserve Validation Errors For Malformed Legacy Runtime Alias Values

- Task Status: `__done__`
- Git Commits: `a7b3f333`, `e0045216`

#### Overview

Repair the remaining validation-order defect in `server/src/config/runtimeConfig.ts` so malformed legacy alias values such as `features.view_image_tool = "maybe"` or `features.web_search_request = "sometimes"` are not silently deleted before validation. This task is intentionally scoped to legacy-alias normalization and validation behavior only; it must preserve the already-closed Story 47 mixed-shape compatibility repair and must not reopen bootstrap, marker, or payload-contract work.

#### Must Not Miss

- Keep the valid Story 47 alias behavior intact: usable legacy boolean values must still normalize into canonical `tools.view_image` / `web_search` behavior where the plan already requires that compatibility.
- Preserve canonical-key precedence from Task 15: existing `tools.view_image` and canonical `web_search` remain authoritative when they are already present.
- Malformed legacy alias values must remain visible long enough for the existing runtime-config validation path to reject them instead of being silently dropped.
- Do not broaden this task into bootstrap-path behavior, marker-schema cleanup, or public REST/MCP payload changes.
- Do not change the plan-authorized rule that existing unreadable files, directories, or invalid chat-config paths count as `existing` rather than `missing`.
- Add direct regression coverage for malformed alias values, including mixed-shape inputs where legacy and canonical structures partially coexist.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md): current evidence artifact for this reopened review cycle, including the top-risk helper analysis and the acceptance-proof map.
- [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md): current findings artifact defining the exact malformed-alias validation defect to repair.
- [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts): current home of `normalizeRuntimeConfig()`, `parseTomlOrThrow()`, and `validateRuntimeConfig()` where the validation-order contract now needs repair.
- [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts): existing runtime normalization, validation, and Context7/bootstrap proof file where malformed-alias regression coverage should be added.

#### Junior Developer Notes

- Read the new findings artifact first so you understand the exact defect: this is not another mixed-shape coexistence problem and it is not a bootstrap problem. The bug is that invalid legacy alias values disappear before the validator can reject them.
- Keep the fix small. The target outcome is to preserve existing happy-path alias compatibility while letting malformed alias values fail through the existing validation contract.
- When you add regression coverage, include at least one malformed `features.view_image_tool` case and one malformed `features.web_search_request` case. Also include a mixed-shape example where another related canonical field or table exists so the test proves malformed alias values are not hidden by coexistence logic.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md), then record in working notes the exact defect to close: malformed legacy alias values must not normalize into success silently.
2. [x] Update the normalization/parse/validation flow in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so invalid `features.view_image_tool` and `features.web_search_request` values remain available to the existing validator, while valid alias values still normalize as Story 47 requires.
3. [x] Add or update focused regression coverage in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) for malformed non-boolean legacy alias values, including at least one mixed-shape input where a related canonical structure also exists.
4. [x] Re-run the existing Story 47 runtime normalization assertions in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that cover valid alias-only input, canonical-conflict input, and mixed-shape coexistence input so the fix does not regress the already-closed Story 47 behavior.
5. [x] Update this plan file’s Task 17 `Implementation notes` after the repair and tests are complete, including which malformed alias inputs now fail correctly and how the final flow preserves valid alias compatibility without hiding bad values.
6. [x] Update [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) only if the maintained Story 47 summary needs to mention the reopened malformed-alias validation repair before the final validation task closes the story again.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Re-read the reopened review evidence and findings before editing and locked the Task 17 defect to one rule: malformed `features.view_image_tool` and `features.web_search_request` values must stay visible long enough for the existing validator to reject them instead of normalizing into success silently.
- Updated [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so legacy aliases are only deleted after successful normalization; malformed alias values now remain in `features` for the existing runtime validator to reject, while valid alias compatibility and canonical precedence stay intact.
- Added focused malformed-alias regression coverage in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) for invalid `features.view_image_tool` and invalid `features.web_search_request`, including a mixed-shape case where canonical runtime structure already exists.
- Re-ran [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) through the server-unit summary wrapper and confirmed the existing alias-only, canonical-conflict, and mixed-shape compatibility assertions still pass alongside the new malformed-alias failures.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the localized validation-order repair cleared the full server build gate without log inspection.
- Passed `npm run test:summary:server:unit -- --file server/src/test/unit/runtimeConfig.test.ts` with `tests run: 63`, `passed: 63`, and `failed: 0`, which directly proved the repaired malformed-alias cases plus the existing alias compatibility assertions inside the focused runtimeConfig file.
- Passed `npm run test:summary:server:unit` with `tests run: 1215`, `passed: 1215`, `failed: 0`, and `agent_action: skip_log`, so the full server unit/integration suite stayed green after preserving malformed legacy alias validation.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the higher-level server feature suite stayed green after tightening malformed legacy-alias validation.
- The concrete malformed inputs now proven to fail correctly are `features.view_image_tool = "maybe"` and `features.web_search_request = "sometimes"`; valid boolean aliases still normalize successfully, canonical `tools.view_image` and canonical `web_search` still stay authoritative, and the maintained Story 47 summary file remains unchanged here because Task 18 is the dedicated refresh point for the final reopened validation cycle.

---

### 18. Revalidate Story 47 After Malformed-Alias Validation Repair

- Task Status: `__done__`
- Git Commits: `45c2be9e`, `1840a13a`

#### Overview

Run one fresh full-story validation pass after Task 17 so Story 47 can close again with the malformed-alias validation repair, the earlier Story 47 review fixes, and the final branch contents all reflected in the maintained evidence. This task is the new final acceptance gate and must re-check the full Story 47 contract rather than only the reopened validation-order defect.

#### Must Not Miss

- Re-check the current review findings artifact and prove that Task 17 closes the reopened `should_fix` before returning the story to `__done__`.
- Revalidate the original Story 47 acceptance criteria, not only the malformed-alias validation repair.
- Keep AC8, AC13, and AC36 explicitly indirect unless this task adds dedicated proof artifacts that move them to direct.
- Refresh the maintained Story 47 summary artifacts so the final branch state records this reopened review cycle and its closeout.
- Keep the transient handoff file out of the commit; only the durable evidence/findings artifacts for this review pass and the plan change belong in the final commit from this disposition cycle.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-evidence.md)
- [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md)
- [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md)

#### Junior Developer Notes

- Treat this as a full story-close validation task. Do not rely on the earlier Task 16 wrapper results once Task 17 changes runtime-config validation flow.
- The reopened review finding is generic engineering scope, but the final validation still needs to prove the full Story 47 acceptance set remains green after the validation-order repair.
- If the Task 17 repair changes the maintained Story 47 summary or acceptance-proof notes, update them here before closing the story again.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T224605Z-fd4cd189-findings.md) and confirm in working notes that Task 17 fully closes the reopened `should_fix` before starting the final regression wrappers.
2. [x] Refresh [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so it records the malformed-alias validation repair, the fresh Task 18 regression results, and the final disposition of any remaining indirect-proof areas.
3. [x] Update this plan file’s Task 18 `Implementation notes` after validation is complete, including which review finding was closed, which acceptance criteria remain indirect, and whether any simplification opportunities remain intentionally deferred.
4. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the maintained docs or structure ledger changed during Task 17.
5. [x] Record the git commit hashes for Tasks 17 and 18 in this plan once the reopened work is complete, then return the new review-driven tasks to `__done__`.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP testing step to manually confirm Story 47 behavior and general regression health after the Task 17 malformed-alias validation repair. This must still verify that the chat page works at `http://host.docker.internal:5001`, that there are no logged browser-console errors, and that the runtime/config surfaces changed by Story 47 still behave as expected after the validation-order fix.
10. [x] `npm run compose:down`

#### Implementation notes

- Re-read the reopened malformed-alias findings before starting validation and confirmed Task 17 closes the `should_fix`: malformed legacy alias values now stay visible to validation instead of normalizing into success silently.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the final Story 47 server build gate stayed clean before the broader regression reruns.
- Passed `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the unchanged client contract remains buildable after the malformed-alias validation repair.
- Passed `npm run test:summary:server:unit` with `tests run: 1215`, `passed: 1215`, `failed: 0`, and `agent_action: skip_log`, so the full server unit/integration gate remained green after the Task 17 validation-order repair.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the higher-level server feature suite remained green after the Task 17 validation-order repair.
- Passed `npm run test:summary:client` with `tests run: 544`, `passed: 544`, `failed: 0`, and `agent_action: skip_log`, so the client-facing regression suite stayed green after the malformed-alias validation repair.
- Passed `npm run test:summary:e2e` with `tests run: 43`, `passed: 43`, `failed: 0`, and `agent_action: skip_log`, so the wrapper-driven end-to-end regression flow stayed green after the Task 17 validation-order repair.
- Passed `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, which cleared the explicit container-build gate before the final manual host-port verification.
- Passed `npm run compose:up`, reaching a healthy `codeinfo2-server-1` and started `codeinfo2-client-1` before the final manual host-port verification step.
- Manual Playwright-MCP verification against `http://host.docker.internal:5001/chat` loaded the chat page successfully, initialized provider `codex` with model `gpt-5.1-codex-mini`, returned `ok` for `Reply with exactly ok.`, and showed no browser-console errors. The live compose logs also showed `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED`, `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`, and `DEV_0000047_T05_CONTEXT7_NORMALIZED { mode: 'no_key_fallback', surface: 'chat', success: true }`.
- Refreshed [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so the maintained Story 47 summary now records the malformed-alias validation repair in Task 17, the fresh Task 18 regression results, and the still-indirect AC8/AC13/AC36 proof areas.
- Passed `npm run compose:down`, which removed the validation stack cleanly after the final host-port verification.
- No additional changes were needed in [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), or [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) because Task 17 repaired validation order inside the existing Story 47 runtime contract rather than changing the maintained docs or structure ledger.
- Task 18 closes the reopened `should_fix` by pairing Task 17’s malformed-alias validation repair with this fresh full regression pass; AC8, AC13, and AC36 remain intentionally indirect because this cycle still does not add dedicated reread or payload-shape snapshot artifacts, and no further simplification work was needed in this closeout pass.

## Code Review Findings

Story 47 was reviewed again against the active plan, the branch diff versus `main`, and the durable artifacts [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md). That review found one localized `should_fix` issue: the maintained Story 47 final-proof summary still reports `DEV_0000047_T05_CONTEXT7_NORMALIZED` as `mode: 'env_overlay'`, while the final Task 18 closeout notes record the last compose-backed host-port verification as `mode: 'no_key_fallback'`. Because the defect is localized to files already changed by Story 47, is low risk to repair, is objectively testable from the maintained evidence, and does not change any public payload or runtime contract, the story is reopened for one focused summary-alignment task plus one fresh full revalidation pass.

Acceptance proof status for this pass remains:

- AC1-7: `direct`
- AC8: `indirect`
- AC9-12: `direct`
- AC13: `indirect`
- AC14-35: `direct`
- AC36: `indirect`

No acceptance criterion is currently classified as `missing`. The implemented runtime code remains appropriately succinct for the required Story 47 behavior, and this review did not identify another code-path simplification that should reopen the server work. The remaining issue is maintained-evidence consistency: reviewers need one unambiguous final record that either aligns the summary with the actual Task 18 proof or explicitly distinguishes the earlier `env_overlay` proof scenario from the later `no_key_fallback` closeout verification.

The current pass durable review artifacts that must be committed alongside the plan change are:

- [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md)
- [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md)

---

### 19. Align Maintained Story 47 Final-Proof Summary With Task 18 Evidence

- Task Status: `__done__`
- Git Commits: `33afee9e`

#### Overview

Repair the maintained Story 47 evidence summary so the final recorded `DEV_0000047_T05_CONTEXT7_NORMALIZED` proof is internally consistent with the Task 18 closeout evidence. This task is intentionally limited to maintained review artifacts and plan evidence wording; it must not reopen runtime code, marker schemas, or public REST/MCP contracts unless the current files prove the inconsistency comes from a real implementation defect instead of stale summary text.

#### Must Not Miss

- Re-read the current evidence and findings artifacts first so you preserve the exact `should_fix` scope from this review cycle.
- Determine whether the final Story 47 summary should align to the Task 18 `no_key_fallback` closeout proof or explicitly retain both proof scenarios with clear labels and no ambiguity.
- Keep the maintained summary honest about which proof came from the earlier temporary runtime-home `env_overlay` check and which proof came from the final compose-backed host-port verification.
- Do not change runtime code, test code, or public contract claims in this task unless the document review proves they are actually wrong.
- Update this plan task’s `Implementation notes` with the exact wording change and why it resolves the reviewer ambiguity.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md): evidence artifact for the current review cycle, including the documentation hotspot that must be resolved.
- [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md): findings artifact defining the exact maintained-summary inconsistency to close.
- [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md): maintained Story 47 summary that currently presents the ambiguous final T05 proof.
- [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md): Task 18 closeout notes that currently record the final compose-backed verification as `mode: 'no_key_fallback'`.

#### Junior Developer Notes

- Treat this as an evidence-integrity repair, not a runtime fix. Your job is to make the maintained final record honest and easy for a reviewer to follow.
- Keep the wording concrete. If both the earlier `env_overlay` proof and the later `no_key_fallback` proof should remain documented, label them as separate verification scenarios rather than leaving one bullet to imply both are the same final run.
- Resist “cleaning up” other summary text in the same edit. The finding is narrow and the safest repair is a narrow one.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md) and [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md), then write down in working notes the exact ambiguity to remove before editing the summary.
2. [x] Update [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) so the final Story 47 `DEV_0000047_T05_CONTEXT7_NORMALIZED` evidence is either aligned to the final Task 18 proof or explicitly split into clearly labeled earlier-versus-final proof scenarios.
3. [x] Re-read the updated [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) beside Task 18 in this plan and confirm that a reviewer can now tell which T05 mode belongs to the final closeout pass without needing to infer intent.
4. [x] Update this plan file’s Task 19 `Implementation notes` with the exact summary change, why it resolves the ambiguity, and whether any runtime behavior claim had to change.
5. [x] Record the Task 19 commit hash in this plan once the evidence-alignment edit is complete.

#### Testing

Do not attempt to run tests without using the summary wrappers. This task is documentation-only, so no wrapper test steps are required here; the fresh wrapper-based regression pass belongs in Task 20.

#### Implementation notes

- Re-read the current review evidence and findings and locked the Task 19 ambiguity to one narrow point: [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) still presents `DEV_0000047_T05_CONTEXT7_NORMALIZED` as final `mode: 'env_overlay'`, while Task 18 records the final compose-backed closeout proof as `mode: 'no_key_fallback'`.
- Updated [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) to keep both valid T05 proof scenarios but label them explicitly as the earlier Task 5 live-image `env_overlay` check versus the final Task 18 compose-backed `no_key_fallback` closeout proof.
- Re-read the updated summary beside Task 18 and confirmed a reviewer can now tell which T05 mode belongs to the final closeout pass without inferring intent; no runtime behavior claim changed, only the maintained evidence wording became explicit.
- Recorded Task 19 commit `33afee9e` after the evidence-only wording repair was committed; this task required no wrapper runs because its testing section is documentation-only by plan.

---

### 20. Revalidate Story 47 After Final-Proof Summary Alignment

- Task Status: `__done__`
- Git Commits: `33afee9e`, `e1a83e59`

#### Overview

Run one fresh full-story validation pass after Task 19 so Story 47 can close again with the maintained summary, the plan evidence, and the branch behavior all aligned. This is the new final acceptance gate and must prove that the summary-only repair did not leave the branch in an ambiguous review state.

#### Must Not Miss

- Re-check the current findings artifact and prove that Task 19 fully closes the reopened `should_fix` before returning the story to `__done__`.
- Revalidate the original Story 47 acceptance criteria, not only the maintained-summary wording repair.
- Keep AC8, AC13, and AC36 explicitly indirect unless this task adds dedicated proof artifacts that move them to direct.
- Refresh the maintained Story 47 summary artifacts so they clearly distinguish the final T05 proof scenario from any earlier proof scenario kept for context.
- Keep the transient handoff file out of the commit; only the durable evidence/findings artifacts for this review pass and the plan change belong in the final commit from this disposition cycle.

#### Documentation Locations

- [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-evidence.md)
- [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md)
- [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md)

#### Junior Developer Notes

- Treat this as a full story-close validation task, even though Task 19 is documentation-only. The story is not complete again until the maintained artifacts and the final validation notes agree.
- If Task 19 keeps both T05 proof scenarios in the maintained summary, make sure the final validation notes clearly state which one belongs to this closing pass.
- Keep the revalidation narrow but honest: use the wrappers, verify the browser console stays clean, and make sure the final summary does not over-claim new direct proof for AC8, AC13, or AC36.

#### Subtasks

1. [x] Re-read [codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260315T233217Z-fba698b0-findings.md) and confirm in working notes that Task 19 fully closes the reopened `should_fix` before starting the final regression wrappers.
2. [x] Refresh [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) again if the Task 20 validation pass needs any final wording adjustment so the maintained summary and the final closeout notes describe the same T05 proof scenario.
3. [x] Update this plan file’s Task 20 `Implementation notes` after validation is complete, including which review finding was closed, which acceptance criteria remain indirect, and whether any further simplification opportunities remain intentionally deferred.
4. [x] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only if the maintained docs or structure ledger changed during Task 19.
5. [x] Record the git commit hashes for Tasks 19 and 20 in this plan once the reopened work is complete, then return the new review-driven tasks to `__done__`.

#### Testing

Do not attempt to run builds or tests without using the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP testing step to manually confirm Story 47 behavior and general regression health after the Task 19 maintained-summary repair. This must still verify that the chat page works at `http://host.docker.internal:5001`, that there are no logged browser-console errors, and that the final closeout notes and maintained summary now describe the same T05 proof scenario.
10. [x] `npm run compose:down`

#### Implementation notes

- Re-read the reopened findings and confirmed Task 19 closes the `should_fix`: the maintained summary now clearly separates the earlier Task 5 `env_overlay` T05 proof from the final Task 18 compose-backed `no_key_fallback` closeout proof, so the ambiguity flagged by the review artifact is removed before the final rerun starts.
- Passed `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the final Story 47 server build gate is clean before the wider regression rerun.
- Passed `npm run build:summary:client` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the unchanged client contract still builds cleanly after the Task 19 summary-alignment repair.
- Passed `npm run test:summary:server:unit` with `tests run: 1215`, `passed: 1215`, `failed: 0`, and `agent_action: skip_log`, so the full server unit/integration gate remains green after the evidence-only Task 19 repair.
- Passed `npm run test:summary:server:cucumber` with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`, so the higher-level server feature suite remains green after the final summary-alignment rerun starts.
- Passed `npm run test:summary:client` with `tests run: 544`, `passed: 544`, `failed: 0`, and `agent_action: skip_log`, so the unchanged client contract remains green after the Task 19 summary-alignment repair.
- Passed `npm run test:summary:e2e` with `tests run: 43`, `passed: 43`, `failed: 0`, and `agent_action: skip_log`, so the end-to-end wrapper flow stays green after the Task 19 evidence repair.
- Passed `npm run compose:build:summary` with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, which clears the explicit container-build gate before the final manual host-port verification.
- Passed `npm run compose:up`, reaching a healthy `codeinfo2-server-1` and started `codeinfo2-client-1`, which makes the host-mapped chat surface ready for the final manual verification step.
- Refreshed [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md) again so the maintained summary now records Task 19 and this Task 20 rerun, keeps the final T05 scenario on `mode: 'no_key_fallback'`, and updates the carried validation counts to match the closing pass.
- Manual Playwright-MCP verification against `http://host.docker.internal:5001/chat` loaded the chat page successfully, initialized provider `codex` with model `gpt-5.1-codex-mini`, returned `ok` for `Reply with exactly ok.`, and showed no browser-console errors. Live server logs in the same final pass showed `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED`, `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`, and `DEV_0000047_T05_CONTEXT7_NORMALIZED { mode: 'no_key_fallback', surface: 'chat', success: true }`, so the maintained summary and the final closeout notes now describe the same T05 proof scenario.
- Passed `npm run compose:down`, which removed the validation stack cleanly after the final host-port verification.
- No updates were needed in [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), or [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) because Task 19 only repaired maintained Story 47 evidence wording.
- Task 20 closes the reopened `should_fix` by pairing Task 19’s summary-alignment repair with this full wrapper/manual rerun; AC8, AC13, and AC36 remain intentionally indirect, and no further simplification opportunity was surfaced by the final pass.
- Recorded Task 19 commit `33afee9e` and Task 20 commit `e1a83e59` in this task, then returned the reopened review-driven closeout cycle to `__done__`.

## Post-Implementation Code Review

Story 47 was reviewed again against the active plan, the branch diff versus `main`, and the durable artifacts [codeInfoStatus/reviews/0000047-20260316T001143Z-c4ea3346-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260316T001143Z-c4ea3346-evidence.md) and [codeInfoStatus/reviews/0000047-20260316T001143Z-c4ea3346-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000047-20260316T001143Z-c4ea3346-findings.md). The branch-vs-main review re-checked `git diff --name-status main...HEAD`, the final Story 47 commits, the maintained summary in [planning/0000047-pr-summary.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-pr-summary.md), and the key implementation surfaces in [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/codex/capabilityResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/codex/capabilityResolver.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/routes/chatModels.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatModels.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), [server/src/routes/chatValidators.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatValidators.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts). The review also re-checked the final proof files and wrapper/manual results in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts), [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts), [server/src/test/unit/capabilityResolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/capabilityResolver.test.ts), [server/src/test/unit/chatModels.codex.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatModels.codex.test.ts), [server/src/test/unit/chatProviders.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatProviders.test.ts), [server/src/test/unit/chatValidators.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/chatValidators.test.ts), [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts), and [server/src/test/integration/mcp-codex-wrapper.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/mcp-codex-wrapper.test.ts).

Acceptance-evidence status for this final review pass:

1. AC1: `direct`
2. AC2: `direct`
3. AC3: `direct`
4. AC4: `direct`
5. AC5: `direct`
6. AC6: `direct`
7. AC7: `direct`
8. AC8: `indirect`
9. AC9: `direct`
10. AC10: `direct`
11. AC11: `direct`
12. AC12: `direct`
13. AC13: `indirect`
14. AC14: `direct`
15. AC15: `direct`
16. AC16: `direct`
17. AC17: `direct`
18. AC18: `direct`
19. AC19: `direct`
20. AC20: `direct`
21. AC21: `direct`
22. AC22: `direct`
23. AC23: `direct`
24. AC24: `direct`
25. AC25: `direct`
26. AC26: `direct`
27. AC27: `direct`
28. AC28: `direct`
29. AC29: `direct`
30. AC30: `direct`
31. AC31: `direct`
32. AC32: `direct`
33. AC33: `direct`
34. AC34: `direct`
35. AC35: `direct`
36. AC36: `indirect`

No acceptance criterion is classified as `missing` in this final pass. AC8 remains indirect because there is still no dedicated same-surface reread artifact that captures two `codex/chat/config.toml` states in one pass; AC13 and AC36 remain indirect because the branch still relies on unchanged client/public payload contracts plus green wrapper/manual validation rather than a dedicated payload-shape snapshot artifact. The implemented code remains appropriately succinct for the required Story 47 behavior overall. [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) is still the densest Story 47 surface, but this pass did not uncover another simplification opportunity that justified reopening the story. Because the current review found no adopted findings, the maintained summary now distinguishes the earlier and final T05 proof scenarios clearly enough, and the branch-vs-main checks plus wrapper/manual validation remain green, Story 47 remains complete.
