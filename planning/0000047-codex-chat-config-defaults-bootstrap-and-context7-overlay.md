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

There is also a related environment-key problem for Context7. Current template content contains a Context7 API key argument in config data. The user wants Context7 to be driven by a new environment variable named `CODEINFO_CONTEXT7_API_KEY`. When runtime config is read, any Context7 MCP args that are missing an API key should be overlaid in memory with that env value. The user has explicitly chosen an in-memory overlay, not repeated on-disk config rewriting.

For this story, both the explicit placeholder key value `REPLACE_WITH_CONTEXT7_API_KEY` and the current checked-in legacy seed value `ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866` are treated as “no usable key configured.” If `CODEINFO_CONTEXT7_API_KEY` is set to a non-empty value, runtime config should overlay that value in memory. If `CODEINFO_CONTEXT7_API_KEY` is missing or empty, runtime config should fall back to the no-key form `args = ['-y', '@upstash/context7-mcp']`, which still works with the provider’s limited unauthenticated allowance.

For first-time bootstrap, the canonical in-code `codex/config.toml` template and the canonical in-code `codex/chat/config.toml` template should both use `model = "gpt-5.3-codex"` as the default Codex model for this story. Other surface-specific defaults such as approval policy can remain different where that behavior is already intentional and in scope.

For avoidance of doubt, this story is about runtime read behavior and first-time bootstrap behavior, not about inventing a migration layer. If a config file already exists but is invalid, unreadable, or user-edited, this story should not silently replace that file. Bootstrap only applies when the target file is missing. Likewise, the Context7 overlay is an in-memory normalization step applied to the runtime config object returned for use by chat or agent execution; it is not a background rewrite step and it must not reorder or discard unrelated MCP server args.

Repository research also showed a second source-of-truth risk that this story should close explicitly: today the repo still contains a checked-in `config.toml.example`, and current bootstrap code may consult that sample file. For this story, that sample file may remain as documentation if desired, but runtime bootstrap behavior must no longer depend on it. Research also showed that official Context7 documentation supports both local stdio MCP definitions with `args` and remote HTTP definitions with headers. This story is intentionally scoped only to the local stdio `args`-based Context7 shape that this repository currently seeds and runs.

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
- `CHAT_DEFAULT_MODEL` remains a fallback only and no longer overrides a valid model value in `codex/chat/config.toml`.
- If `codex/chat/config.toml` does not exist, the server creates it from one canonical in-code chat-config template.
- If `codex/config.toml` does not exist, the server creates it from one canonical in-code base-config template.
- The canonical in-code base-config template and canonical in-code chat-config template both use `model = "gpt-5.3-codex"` for this story’s bootstrap behavior.
- The canonical in-code templates are the source of truth for first-time file creation and do not depend on runtime access to files such as `codex/chat/config copy.toml`, `codex/config.toml`, or `config.toml.example`.
- `config.toml.example` may remain in the repository as a human-facing sample, but it is not consulted, copied, or parsed by runtime bootstrap code in this story.
- When `codex/chat/config.toml` is missing, bootstrap uses the canonical in-code chat template directly for that file rather than copying the base config into the chat config and then mutating it afterward.
- Missing-file bootstrap does not overwrite existing user-edited config files.
- Runtime config loading applies `CODEINFO_CONTEXT7_API_KEY` as an in-memory overlay for Context7 MCP args when a Context7 server definition exists and no API key argument is already present.
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
2. Question: What exact default model values should the new canonical in-code templates contain for `codex/config.toml` and `codex/chat/config.toml`? Why it matters: the story is explicitly about one canonical bootstrap source of truth, and leaving different template model values in place would preserve today’s confusing split-brain behavior. Decision: both canonical in-code templates should use `model = "gpt-5.3-codex"` for this story. Source and why this is best: in the current repo, `server/src/config/runtimeConfig.ts` already bootstraps chat config with `gpt-5.3-codex`, `server/src/config/chatDefaults.ts` already hard-falls back to `gpt-5.3-codex`, and unit tests in `server/src/test/unit/config.chatDefaults.test.ts` assert that fallback. The mismatched `gpt-5.3-codex-spark` base template in `server/src/config/codexConfig.ts` is therefore the outlier. Upstream confirmation came from DeepWiki’s `openai/codex` configuration documentation, which points to `gpt-5.3-codex` as the main default coding model and did not surface an authoritative `gpt-5.3-codex-spark` default. A Context7 lookup was attempted for external library confirmation but the tool returned an invalid API key error in this environment, so DeepWiki plus direct repo evidence were used instead. This is the best answer because it aligns bootstrap with existing runtime behavior and tests, avoids a broader provider/model-policy change, and keeps the story narrowly focused on consistency.
3. Question: If `codex/chat/config.toml` exists but is unreadable or contains invalid TOML, should runtime behavior continue to fall back to env/hardcoded defaults with warnings, or should this story change that behavior to surface an error instead? Why it matters: this story touches repeated rereads of chat config, so the plan needs to say whether it is also changing failure semantics or only making runtime-default resolution consistent. Decision: keep the existing warning-and-fallback behavior for chat-default resolution; do not expand this story into a new hard-error contract. Source and why this is best: current repo behavior already does this in `server/src/config/chatDefaults.ts` via `readChatConfigSafely`, and `server/src/test/unit/config.chatDefaults.test.ts` explicitly asserts that invalid TOML produces warnings while returning fallback defaults. The harder error path in `server/src/config/runtimeConfig.ts` remains valid for callers that require a strict config snapshot, but story 0000047 is about model/default correctness and bootstrap consistency, not changing every consumer’s failure semantics. External confirmation was limited because this is primarily a repository-policy question; a Context7 lookup was not available in this environment due to an invalid API key, and a web search showed mixed general opinions, reinforcing that the best answer here is the already-tested local behavior. This is the best fit because it preserves compatibility, avoids unnecessary surface-area changes, and stays inside the existing acceptance scope.
4. Question: Existing seeded base configs may already contain the current checked-in Context7 API-key value rather than the new `REPLACE_WITH_CONTEXT7_API_KEY` placeholder. Should this story treat that existing checked-in value as an unusable placeholder at runtime as well, or only apply special handling to the new placeholder string? Why it matters: if old seeded configs keep a checked-in key literal that is no longer meant to be trusted, this story would leave existing users depending on the very key material it is supposed to remove from canonical defaults. Decision: treat both the new placeholder string and the one legacy checked-in seed key literal as placeholder-equivalent unusable values at runtime, while not attempting any broader validation of arbitrary user-supplied keys. Source and why this is best: local repo evidence shows the legacy literal is still present in `config.toml.example` and `server/src/config/codexConfig.ts`, while newer agent configs already use `REPLACE_WITH_CONTEXT7_API_KEY`. Context7’s official documentation says basic usage works without an API key at reduced limits, and DeepWiki’s `upstash/context7` documentation plus provider issue reports show invalid or stale API keys can fail with `401 Unauthorized` rather than gracefully downgrading. A Context7 tool lookup was attempted but blocked in this environment by an invalid API key, so direct repo evidence, DeepWiki, and provider documentation/issues were used instead. This is the best answer because it removes dependence on the legacy seeded key for both fresh and already-seeded configs, stays narrowly scoped to two explicit placeholder-equivalent values, and avoids a bigger secret-migration or credential-validation feature.
5. Question: Should runtime bootstrap continue to consult checked-in sample files such as `config.toml.example`, or should those files become documentation-only once canonical in-code templates exist? Why it matters: repository research showed the current base bootstrap still checks for `config.toml.example`, which creates a second source of truth and can make first-run behavior depend on whichever file happens to be present. Decision: keep `config.toml.example` only as a human-facing sample if desired, but do not read, copy, or parse it as part of runtime bootstrap in this story. Source and why this is best: direct repo inspection showed `server/src/config/codexConfig.ts` still searches for and copies `config.toml.example`, while the story goal is a single canonical in-code bootstrap source. Node’s file-copy behavior via `COPYFILE_EXCL` is useful for non-overwrite safety, but it does not solve the source-of-truth problem created by consulting an external sample file. This is the best fit because it removes environmental drift, makes first-run behavior deterministic, and stays tightly aligned with the story’s stated bootstrap objective.
6. Question: Should this story normalize every possible Context7 configuration shape, including remote `url`/`http_headers` setups, or only the local stdio `command` plus `args` shape that this repository currently seeds? Why it matters: official Context7 documentation supports both local `args`-based usage and remote/header-based usage, but the repository’s existing templates and runtime behavior are stdio `args`-based. Decision: scope this story only to the local stdio `command` plus `args` shape and leave remote/header-based Context7 definitions unchanged. Source and why this is best: direct repo evidence shows the current templates in `server/src/config/codexConfig.ts` and `config.toml.example` use `npx` plus an `args` array, and official Context7 documentation documents separate contracts for local args-based setup versus remote HTTP header-based setup. The Context7 MCP tool itself could not be queried in this environment because the configured API key was invalid, so official GitHub docs, DeepWiki, and repo evidence were used instead. This is the best fit because it prevents the story from silently expanding into multiple transport contracts while still fully covering the repository’s current runtime shape.

## Implementation Ideas

- Consolidate model-list and default-model behavior so the same runtime read path is used by web chat routes and MCP chat tooling.
- Extend the current Codex capability resolution so the model list is based on `env list UNION chat-config model`, preserving environment order and only appending the chat-config model when it is absent.
- Keep request override precedence unchanged while lowering `CHAT_DEFAULT_MODEL` to fallback-only status behind `codex/chat/config.toml`.
- Keep route-level or UI-level model prioritization separate from capability resolution so the merged list stays stable and deterministic.
- Replace reliance on external runtime template files with one canonical in-code base template and one canonical in-code chat template, both using `gpt-5.3-codex` as the model value for first-time bootstrap, and create missing chat config from the chat template directly rather than copying base config first.
- Update bootstrap helpers in `server/src/config/runtimeConfig.ts` and `server/src/config/codexConfig.ts` so first-run creation is deterministic and non-destructive.
- Reuse the existing chat-default warning-and-fallback path for unreadable or invalid chat config rather than introducing a new strict-error behavior in this story.
- Apply the Context7 API-key overlay during runtime config read/normalization, not during repeated writes.
- Detect existing real `--api-key` args before overlaying anything so explicit user-provided keys still win.
- Treat `REPLACE_WITH_CONTEXT7_API_KEY` and the one legacy checked-in seed key literal as placeholder-equivalent values, not as real configured keys.
- When either placeholder-equivalent value is present and `CODEINFO_CONTEXT7_API_KEY` is empty, strip only the `--api-key` pair and fall back to the unauthenticated `['-y', '@upstash/context7-mcp']` argument form without disturbing unrelated args.
- Add tests for:
  - model list includes chat-config model when env list omits it;
  - chat-config model is default in web and MCP surfaces;
  - reread-from-disk behavior after file edits;
  - missing chat config bootstraps from the in-code template;
  - missing base config bootstraps from the in-code template;
  - Context7 args receive in-memory env overlay only when needed;
  - both placeholder-equivalent Context7 key values fall back to the no-key argument form when `CODEINFO_CONTEXT7_API_KEY` is empty.
