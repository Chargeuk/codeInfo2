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
- Git Commits: `8310d88a`, `90181fa1`, `3d78c667`

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

- Task Status: `__in_progress__`
- Git Commits:

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
13. [ ] Update this plan file's Task 2 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including what you changed in [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts) and what bootstrap behavior stayed intentionally unchanged.
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

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read the `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, and `Edge Cases and Failure Modes` sections and write down the two rules that cannot be missed in this task: missing `codex/chat/config.toml` is created from the canonical chat template, and any existing path at that location must be left untouched.
2. [ ] Update [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so `ensureChatRuntimeConfigBootstrapped()` always writes the canonical chat template directly when `codex/chat/config.toml` is missing and never copies the base config first, even when [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts) would have created a base file with different content.
3. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a missing `codex/chat/config.toml` is created from the canonical chat template. Purpose: lock in the direct chat-template bootstrap happy path.
4. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the base config is no longer copied into chat config when `codex/config.toml` already exists with different contents. Purpose: prevent regressions back to copy-from-base bootstrap behavior.
5. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves `codex/chat/config copy.toml` and other on-disk template files are ignored. Purpose: keep the chat bootstrap source of truth in code.
6. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the old `copied` bootstrap branch is removed or intentionally replaced by the direct-template path. Purpose: make the branch-level behavior change visible to reviewers.
7. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an existing zero-byte `codex/chat/config.toml` is left untouched. Purpose: cover the zero-byte-file corner case explicitly.
8. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an existing invalid-TOML `codex/chat/config.toml` is left untouched. Purpose: cover the invalid-file corner case explicitly.
9. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an existing directory at the `codex/chat/config.toml` path is left untouched. Purpose: cover the directory-path corner case explicitly.
10. [ ] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves an existing invalid or unreadable chat config still warns, falls back, and is not overwritten by bootstrap. Purpose: keep the warning-and-fallback behavior tied to the new direct bootstrap path.
11. [ ] Update the architecture document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it describes direct chat-template bootstrap rather than copy-from-base behavior, and make it explicit that this task only changes missing-file bootstrap. Add or refresh a Mermaid flowchart that shows the missing-chat-config branch writing the canonical chat template directly and the existing-path branch short-circuiting without overwrite. Purpose: keep the design-level chat bootstrap flow accurate.
12. [ ] Update the user/developer reference document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) so it describes direct chat-template bootstrap rather than copy-from-base behavior and makes it explicit that this task only changes missing-file bootstrap. Purpose: keep the top-level guidance aligned with the new direct bootstrap contract.
13. [ ] If this task adds or removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in this task is complete. The `projectStructure.md` update for this task must list every repository file added or removed by Task 3 so the repo map does not go stale.
14. [ ] Update this plan file's Task 3 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including which bootstrap branch changed and which existing-file protections stayed intact.
15. [ ] In [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), add a Story 47 chat-bootstrap marker with the exact text `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP`. Emit it for the direct-template seed path and the existing-path short-circuit path, and include `config_path`, `outcome` (`seeded` or `existing`), `source=chat_template`, and `success`. Expected outcome: during Task 7 manual verification, the compose logs show this marker during stack startup, and any seeded path reports `source=chat_template` with `success=true`.
16. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use because this task changes server runtime-config bootstrap code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes server bootstrap behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because this task changes server bootstrap behavior that still needs full feature-suite coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- None yet.

---

### 4. Preserve Shared Base Runtime Inheritance After Direct Chat Bootstrap

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read the `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, and `Edge Cases and Failure Modes` sections and write down two lists in your working notes before editing code: runtime-specific fields that must stay authoritative (`model`, `approval_policy`, `sandbox_mode`, `web_search`) and base-only fields that must still be inherited (`projects`, `mcp_servers`, `personality`, `tools`, `model_provider`, `model_providers`).
2. [ ] Extend the current projects-only merge in [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) instead of replacing it with a brand-new abstraction, so the shared runtime resolver starts from base config, overlays runtime-specific config on top, preserves additive tables such as `projects` and `mcp_servers`, preserves base-only settings such as `personality`, `tools`, `model_provider`, and `model_providers` when the runtime-specific file omits them, and keeps runtime-specific values authoritative for fields like `model`, `approval_policy`, `sandbox_mode`, and `web_search`. Use this example while implementing: if base config contains `[mcp_servers.context7]` and `model_provider = "base-provider"`, but chat config only contains `model = "chat-model"`, the resolved chat runtime must still include the base MCP server and base provider config while keeping `model = "chat-model"`.
3. [ ] Review [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/agents/config.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/config.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts) after the merge change so invalid existing chat configs still warn and fall back without being rewritten, while resolved chat and agent runtime config continue to expose the base-only execution settings those callers already depend on.
4. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves resolved chat runtime still inherits base `mcp_servers`, `model_provider`, and `model_providers`. Purpose: lock in the chat-runtime inheritance happy path for base-only provider settings.
5. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves resolved agent runtime still inherits base `mcp_servers`, `personality`, `tools`, and `projects`. Purpose: lock in the agent-runtime inheritance happy path for base-only execution settings.
6. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves resolved agent runtime still inherits base `model_provider` and `model_providers` when the runtime-specific file omits them. Purpose: cover the agent-side provider-routing inheritance required by the acceptance criteria.
7. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves runtime-specific `model`, `approval_policy`, `sandbox_mode`, and `web_search` values still override the base config. Purpose: prevent the inheritance change from weakening runtime-specific precedence.
8. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves runtime-specific `projects` or `mcp_servers` entries add to or override the base entry without deleting unrelated base siblings. Purpose: cover the additive-table merge corner case explicitly.
9. [ ] Add or update an MCP happy-path test in [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts) that proves the resolved agent runtime used by `codebaseQuestion` still sees the inherited base-only execution settings after direct chat-template bootstrap. Purpose: verify an existing consumer keeps working end to end.
10. [ ] Add or update a unit test in [server/src/test/unit/config.chatDefaults.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/config.chatDefaults.test.ts) that proves the inheritance change does not silently repair an invalid existing chat config. Purpose: keep the soft warning path separate from bootstrap or merge repair behavior.
11. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves strict runtime readers still error when base config read or validation fails. Purpose: preserve the existing hard-error contract for strict runtime-config paths.
12. [ ] Update the architecture document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it describes the shared base/runtime inheritance that preserves execution behavior without copying the full base config into chat config. Include the list of inherited key groups from this task so the documentation matches what the code actually preserves, and add or refresh a Mermaid flowchart that shows base config, runtime config, explicit inheritance of known keys, and runtime-specific override precedence. Purpose: keep the design-level inheritance architecture accurate.
13. [ ] Update the user/developer reference document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) so it explains the shared base/runtime inheritance behavior and the preserved key groups at a high level. Purpose: keep the top-level guidance aligned with the new inheritance behavior without forcing the reader into the deeper design document first.
14. [ ] If this task adds or removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in this task is complete. The `projectStructure.md` update for this task must list every repository file added or removed by Task 4 so the repo map does not go stale for the next developer.
15. [ ] Update this plan file's Task 4 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including which keys are inherited explicitly and which values remain runtime-specific overrides.
16. [ ] In [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), add a Story 47 inheritance marker with the exact text `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`. Include `surface` (`chat` or `agent`), `inherited_keys`, `runtime_override_keys`, and `success` so a reviewer can tell which merge path executed. Expected outcome: during Task 7 manual verification, the compose logs show this marker for at least one chat runtime read and one agent runtime read, and every observed line reports `success=true`.
17. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use because this task changes shared runtime-config merge behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes shared server behavior used by chat and agent execution. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because this task changes server/common behavior that still needs full Cucumber feature coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- None yet.

---

### 5. Normalize Context7 API Keys In Runtime Config Loading

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read `Acceptance Criteria`, `Implementation Ideas`, `Expected Outcomes`, `Edge Cases and Failure Modes`, and Decision 4, then write down the two placeholder-equivalent values that must be treated as unusable: `REPLACE_WITH_CONTEXT7_API_KEY` and `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866`.
2. [ ] Update [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) so the merged runtime config applies the `CODEINFO_CONTEXT7_API_KEY` overlay in memory when a Context7 stdio definition exists and currently has no usable key, and place that logic in one shared read path that runs after base/runtime inheritance and feeds both chat and agent runtime config resolution instead of duplicating caller-specific branches.
3. [ ] In the same [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) change, preserve explicit non-placeholder keys, preserve unrelated args and unrelated MCP server definitions, leave remote `url` and `http_headers` Context7 definitions unchanged, and fall back to the no-key `args = ['-y', '@upstash/context7-mcp']` shape when no usable key is available. Use this exact example from the story while editing: `['-y', '@upstash/context7-mcp', '--api-key', 'REPLACE_WITH_CONTEXT7_API_KEY']` plus `CODEINFO_CONTEXT7_API_KEY=ctx7sk-real` must become `['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real']`, but if the env var is empty or whitespace-only the result must be `['-y', '@upstash/context7-mcp']`.
4. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves `REPLACE_WITH_CONTEXT7_API_KEY` is replaced in memory by `CODEINFO_CONTEXT7_API_KEY`. Purpose: lock in the main env-overlay happy path.
5. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the legacy seeded key `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866` is treated like a placeholder and replaced by `CODEINFO_CONTEXT7_API_KEY`. Purpose: cover the legacy-key compatibility path explicitly.
6. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an explicit non-placeholder Context7 API key is preserved. Purpose: prevent valid user-supplied keys from being overwritten.
7. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves an already-no-key Context7 args list remains unchanged. Purpose: cover the already-clean no-key corner case.
8. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a placeholder-equivalent Context7 key plus a missing, empty, or whitespace-only `CODEINFO_CONTEXT7_API_KEY` value falls back to the exact no-key args form `['-y', '@upstash/context7-mcp']`. Purpose: lock in the no-key fallback contract explicitly instead of leaving it implied by broader arg-order tests.
9. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a runtime config with no Context7 definition remains unchanged. Purpose: cover the missing-definition corner case explicitly.
10. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the no-key fallback removes only the `--api-key` pair and preserves the order of every unrelated arg. Purpose: verify the scoped arg-rewrite behavior.
11. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves remote `url` and `http_headers` Context7 definitions are left unchanged. Purpose: keep remote/header-based definitions out of scope for this story.
12. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves the overlay does not rewrite config files on disk. Purpose: lock in the runtime-only normalization contract.
13. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves `resolveChatRuntimeConfig()` receives the inherited overlaid Context7 definition when the server is defined in base config. Purpose: verify the shared read path for the chat runtime consumer.
14. [ ] Add or update an MCP happy-path test in [server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts) that proves the agent-side runtime used by `codebaseQuestion` receives the same inherited overlaid Context7 definition. Purpose: verify the shared read path for an existing agent consumer.
15. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves base-config read or validation failures still hard-error. Purpose: preserve the strict base-config failure contract.
16. [ ] Add or update a unit test in [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts) that proves a malformed local stdio Context7 shape, such as non-array `args` or a missing `--api-key` pair, preserves the existing validation or error behavior instead of being destructively rewritten. Purpose: cover the malformed-shape corner case explicitly.
17. [ ] Update the architecture document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it describes `CODEINFO_CONTEXT7_API_KEY` as the runtime source of truth, makes it clear that the overlay is in-memory only, and notes that the same shared overlay path is used by both chat and agent runtime config loading. Add or refresh a Mermaid flowchart that shows the Context7 normalization decision tree for placeholder-equivalent keys, explicit real keys, no-key fallback, and inherited base-config definitions. Purpose: keep the design-level runtime-config architecture accurate.
18. [ ] Update the user/developer reference document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) so it describes `CODEINFO_CONTEXT7_API_KEY` as the runtime source of truth and explains the in-memory-only overlay behavior at a practical level. Purpose: keep the top-level operational guidance aligned with the new Context7 configuration contract.
19. [ ] If this task adds or removes files, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in this task is complete. The `projectStructure.md` update for this task must list every repository file added or removed by Task 5 so the structure map does not go stale.
20. [ ] Update this plan file's Task 5 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after implementation and testing are complete, including which placeholder-equivalent values were handled and how the runtime-only overlay works.
21. [ ] In [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), add a Story 47 Context7 normalization marker with the exact text `DEV_0000047_T05_CONTEXT7_NORMALIZED`. Include `mode` (`env_overlay`, `no_key_fallback`, `explicit_key_preserved`, or `no_context7_definition`), `surface`, and `success`. Expected outcome: during Task 7 manual verification, the compose logs show this marker with the expected normalization mode for the configured test scenario, and every observed line reports `success=true`.
22. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use because this task changes runtime config normalization code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes runtime-config behavior covered by node:test unit/integration suites. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because this task changes server/common behavior that still needs full Cucumber feature coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- None yet.

---

### 6. Complete Documentation Sweep And Acceptance Mapping

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] In [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md), re-read the full `Acceptance Criteria`, `Expected Outcomes`, and `Out Of Scope` sections and create a short acceptance-check list in your working notes. For each criterion, write the exact proof location beside it, such as a file link like [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) or a specific test file like [server/src/test/unit/runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
2. [ ] Run through the code and tests touched by Tasks 1 through 5 and confirm there are no remaining branches still reading `config.toml.example`, copying base config into chat config, treating the placeholder-equivalent Context7 values as usable keys, or leaving Codex-facing selection paths on the old env-only default behavior. Use the file links already named in this story, especially [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [server/src/routes/chatProviders.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chatProviders.ts), and [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts).
3. [ ] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) with any remaining command or behavior changes from this story, including the `CODEINFO_CONTEXT7_API_KEY` runtime behavior if that documentation is still incomplete. Make sure the README wording matches the acceptance criteria and does not reintroduce old sample-file bootstrap behavior or old Codex default-precedence wording.
4. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so it fully reflects the final shared model/default-resolution path, the canonical bootstrap source of truth, the shared base/runtime inheritance, and the runtime-only Context7 overlay behavior. Use the implementation files already named in this story as the source of truth, especially [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), and [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), and ensure the final Mermaid diagrams cover the end-to-end resolution flow, bootstrap flow, inheritance flow, and Context7 overlay flow without drifting from the implemented behavior.
5. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask from Tasks 1 through 6 is complete. This story-level `projectStructure.md` sweep must list every repository file added or removed during the story, plus any materially repurposed files, so the repo map still matches the code and documentation a junior will rely on next.
6. [ ] Update this plan file's Task 6 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after the acceptance map and documentation updates are complete, including which documents changed and which acceptance criteria were hardest to map.
7. [ ] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), and this story plan so the final regression instructions list the exact Story 47 runtime markers `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED`, `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP`, `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP`, `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED`, and `DEV_0000047_T05_CONTEXT7_NORMALIZED`, plus the expected success outcomes for each. Expected outcome: Task 7 can use one canonical marker checklist during the Manual Playwright-MCP verification step without needing to infer marker names from code.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

No wrapper test runs are required for this documentation-only task. Do not attempt to run builds or tests without the summary wrappers if you later need verification for an adjacent code change.

#### Implementation notes

- None yet.

---

### 7. Final Runtime Verification And Pull-Request Summary

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Re-read the acceptance-check list created in Task 6 from [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) and write down which final runtime proof or screenshot will close each remaining criterion. Keep the proof plan next to the files that drive the behavior, such as [client/src/hooks/useChatModel.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useChatModel.ts) and [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts).
2. [ ] After Testing step 9 completes, take the raw Playwright-MCP screenshots from `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` and save the selected evidence screenshots to `test-results/screenshots/` using filenames of the form `0000047-7-<short-name>.png`. Make sure each saved screenshot can be mapped back to the acceptance-check list from Task 6 and to the GUI expectation it proves.
3. [ ] Create a pull-request summary comment that covers the model/default resolution change, the base bootstrap change, the chat bootstrap change, the shared base/runtime inheritance change, the Context7 overlay change, the observed Story 47 marker lines, and the final verification results. Use the implementation files and tests already named in this story as the source material, especially [server/src/config/chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [server/src/config/codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), and the relevant server test files.
4. [ ] If this task adds or removes repository files while completing the final verification work, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) only after every file-adding or file-removing subtask in Task 7 is complete. The update must list every repository file added or removed by the final verification task, and it must not list generated screenshot evidence under `test-results/screenshots/` because `projectStructure.md` is for maintained repository structure rather than runtime artifacts.
5. [ ] Update this plan file's Task 7 `Implementation notes` in [planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md) after all verification, screenshots, and pull-request summary work are complete, including which runtime proofs were strongest, which Story 47 markers were observed, and where the saved screenshots live.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests without the summary wrappers. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Mandatory for the final regression check because server/common behavior may be affected. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Mandatory for the final regression check because the final task verifies the existing client against the completed server behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Mandatory for the final regression check because server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Mandatory for the final regression check because server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Mandatory for the final regression check because the completed story is testable from the client-facing chat surface. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` - Allow up to 7 minutes. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [ ] `npm run compose:build:summary` - Use because the final regression check includes front-end-accessible validation through the containerized stack. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [ ] `npm run compose:up`
9. [ ] Manual Playwright-MCP testing step - Use the Playwright MCP tools against `http://host.docker.internal:5001` to confirm the story’s completed behavior and general regression health, and in parallel inspect `npm run compose:logs` output for the Story 47 markers documented in Task 6. During this step, capture GUI screenshots into `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` because that folder is mapped by `docker-compose.local.yml`. Review those screenshots as part of the check, not just as artifacts: confirm the chat page shows the expected provider/model defaults, the available model list matches the implemented server behavior, and the overall GUI still matches the task expectations before selecting the final screenshots to keep under `test-results/screenshots/`. Expected marker outcomes: `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` appears for both REST and MCP paths with `success=true`; `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP` appears during startup with `template_source=in_code` and `success=true` when seeding is needed; `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP` appears during startup with `source=chat_template` and `success=true` when seeding is needed; `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED` appears for chat and agent runtime reads with `success=true`; and `DEV_0000047_T05_CONTEXT7_NORMALIZED` appears with the expected `mode` for the configured scenario and `success=true`. Also verify that the chat UI reflects the server-selected defaults and available models, that every GUI-visible acceptance item is backed by a screenshot where practical, and that there are no logged errors in the browser debug console.
10. [ ] `npm run compose:down`

#### Implementation notes

- None yet.

---
