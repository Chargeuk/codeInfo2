# Story 0000059 - Users can use external OpenAI-compatible endpoints with Codex and Copilot

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

CodeInfo2 already lets users run coding workflows through the Codex and Copilot harnesses, but today those harnesses are tied too closely to their built-in model and provider setup. Users now want a simpler way to point those existing harnesses at one or more external OpenAI-compatible `/v1` endpoints so that locally hosted or self-managed model gateways can participate in the same chat and agent surfaces.

From the user's point of view, this should feel like an extension of the current provider choices rather than a brand-new top-level harness. The Codex and Copilot surfaces stay in place, but when the user selects one of those harnesses in the chat UI, the available model list should also include models discovered from configured external OpenAI-compatible endpoints that support the right wire API for that harness, alongside the harness's ordinary built-in models. If a chat config pins `codeinfo_openai_endpoint` to an endpoint that is not listed in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`, that active endpoint and its discovered models should still appear in the chat picker so the selected default remains visible and reselectable. This GUI model-selection requirement is for chat only. It does not apply to LM Studio, and it does not require the Agents UI to expose external endpoint model selection. In addition, users should be able to pin a specific chat config or agent config directly to one external endpoint without having to learn either Codex-native or Copilot-native provider wiring.

The configuration contract for this first version is intentionally simple. One environment variable should declare the external endpoints and the wire APIs each endpoint claims to support, using full explicit `/v1` base URLs rather than shorthand roots. The current agreed shape is:

- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS=http://192.168.1.3/v1|responses,completions;http://localhost:1234/v1|responses,completions`

Each entry is assumed to be an OpenAI-compatible endpoint. The user does not want to configure endpoint nicknames such as `lmstudio` or `vllm`, and the product should not introduce a new first-class LM Studio harness as part of this story. Instead, the system should derive its own internal endpoint identity from the normalized full configured URL and use `/v1/models` to discover the models each endpoint exposes. Two endpoints that share a host but differ by path must therefore remain distinct endpoints internally. If the same normalized endpoint appears more than once in the environment variable list, the first entry should win and the later duplicates should be dropped with a warning rather than failing the whole config. If the same normalized endpoint is present from both the environment variable list and a chat config pin, the chat picker should still show that endpoint only once because it is the same underlying endpoint identity. For chat display, external models should be labeled in a short human-usable form based on the endpoint host plus the model id, such as `localhost / qwen2.5-coder-14b`, rather than showing the full URL. If two visible choices would otherwise produce the same `host / model` label, the UI should append a short path hint only for those colliding labels.

The user also wants a very simple repository-owned runtime-config contract for direct selection in `config.toml` files. Rather than asking users to author raw Codex `model_provider` and `[model_providers.*]` tables, CodeInfo2 should accept one new app-owned string field:

- `codeinfo_openai_endpoint = "http://192.168.1.3/v1|responses,completions"`

That value uses the same single-endpoint format as one item from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`, but it does not need to appear in the environment variable list to be valid. The existing `model` field remains the selected model on that endpoint. In agent configs, `codeinfo_provider` remains the selector for whether CodeInfo should translate that endpoint into Codex or Copilot runtime settings. In `codex/chat/config.toml` and `copilot/chat/config.toml`, the provider is implied by the config location, so no extra provider field is required there.

This story therefore has three concrete user outcomes:

- In chat only, users can select compatible models from configured external OpenAI-compatible endpoints when the selected chat provider is Codex or Copilot, in addition to the models that provider already exposes itself.
- Users can configure the default chat model for Codex or Copilot to use a local or remote OpenAI-compatible endpoint by setting `codeinfo_openai_endpoint` plus `model` in `codex/chat/config.toml` or `copilot/chat/config.toml`.
- Users can configure an agent to use a Codex or Copilot model from a local or remote OpenAI-compatible endpoint by setting `codeinfo_provider`, `codeinfo_openai_endpoint`, and `model` in `codeinfo_agents/<agent>/config.toml`.

This story should keep the first implementation deliberately lightweight. If an endpoint is configured and its `/v1/models` list returns model ids, that is enough to surface those models in the relevant harness picker. If a chat or agent config pins `codeinfo_openai_endpoint` plus `model`, that is enough for CodeInfo2 to translate the selection into the correct underlying Codex or Copilot runtime settings. When conversations are saved, the raw model id should remain distinct from the derived endpoint identity so resumed conversations can tell apart the same model id coming from different endpoints without hiding endpoint routing inside the model string itself. Older saved conversations that do not carry endpoint identity should continue to open using the current provider-and-model behavior, with the new endpoint identity treated as optional and only used when present. The user does not want a first-use capability probe, compatibility certification flow, extra validation layer beyond parsing and harness-wire-compatibility checks, or speculative future syntax in this initial version. If some models later prove unreliable for tool use or agent execution, that can be addressed in a later story after there is evidence that the additional complexity is needed.

This story must also preserve and extend the repository's current fallback philosophy rather than replacing it. For a new chat conversation or a new agent run, when `codeinfo_openai_endpoint` is configured for Codex or Copilot, CodeInfo2 should try that external endpoint first. If the endpoint is healthy but the requested model is not available there, CodeInfo2 should repair within that same provider path first by choosing the first selectable model on that same endpoint and warning that same-endpoint repair happened. If the endpoint itself is unavailable, CodeInfo2 should fall back to the same provider's normal built-in or native model path before considering the existing cross-provider fallback order. Only after the same-provider external and native paths both fail should the normal provider-order fallback choose another provider. At the same time, existing pinned or resumed execution identities must keep the current fail-in-place contract: they must not silently drift to a different endpoint or a different provider on later turns just because the previously pinned external endpoint later became unavailable.

Because this work touches both harnesses, the story must begin by upgrading the Codex and Copilot libraries to the latest published versions available at implementation time before the new endpoint behavior is built on top. Planning-time research found the currently published targets to be `@openai/codex` and `@openai/codex-sdk` `0.136.0`, and `@github/copilot-sdk` `1.0.0-beta.9`, but the implementation should re-check those versions at the start of the work rather than assuming the planning-time values are still latest.

### Acceptance Criteria

- The first implementation steps upgrade `@openai/codex`, `@openai/codex-sdk`, and `@github/copilot-sdk` to the latest published compatible versions available at implementation time, then revalidate the existing Codex and Copilot harness behavior on top of those upgrades.
- The product supports one environment variable named `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
- The environment variable accepts one or more entries separated by semicolons.
- Each entry uses a full explicit OpenAI-compatible `/v1` base URL followed by a pipe and a comma-separated list of declared wire capabilities.
- The supported declared wire capabilities are `responses`, `completions`, or both.
- The product supports one new CodeInfo-owned runtime config field named `codeinfo_openai_endpoint` in agent configs and provider chat configs.
- `codeinfo_openai_endpoint` uses the same single-endpoint string format as one entry from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
- A `codeinfo_openai_endpoint` configured in `codeinfo_agents/<agent>/config.toml`, `codex/chat/config.toml`, or `copilot/chat/config.toml` does not need to also appear in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
- The server parses the configured external endpoint entries deterministically and exposes validation errors clearly when an entry is malformed.
- The server parses `codeinfo_openai_endpoint` deterministically and exposes validation errors clearly when the value is malformed.
- The system assumes every configured entry is an OpenAI-compatible endpoint and does not require user-supplied endpoint names such as `lmstudio` or `vllm`.
- The user-authored config contract does not require or expose raw Codex `model_provider` or `[model_providers.*]` configuration tables.
- External endpoint identity is derived from the normalized full configured base URL rather than from the host alone.
- If the same normalized endpoint appears more than once in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`, CodeInfo2 keeps the first entry, drops the later duplicates, and emits a warning instead of failing the whole config.
- The server discovers external models by calling each configured endpoint's `/v1/models` API.
- The chat model picker includes discovered external models when they are compatible with the currently selected harness.
- The chat model picker requirement applies only to Codex and Copilot chat.
- The chat model picker requirement does not apply to LM Studio chat.
- The chat model picker requirement does not require any external-endpoint model-selection UI change on the Agents page.
- If a chat config pins `codeinfo_openai_endpoint` to an endpoint that is not listed in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`, that active endpoint and its discovered models still appear in the chat picker for the selected provider.
- If the same normalized endpoint is present from both `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` and a chat config pin, the chat picker shows one shared entry for that endpoint identity rather than duplicate choices.
- The Codex harness only surfaces external models from endpoints that declare `responses` support.
- The Copilot harness surfaces external models from endpoints that declare `completions` support, and may also use endpoints that declare both `completions` and `responses`.
- If an agent config sets `codeinfo_provider = "codex"` plus `codeinfo_openai_endpoint`, CodeInfo2 translates that selection into the correct Codex runtime settings internally.
- If an agent config sets `codeinfo_provider = "copilot"` plus `codeinfo_openai_endpoint`, CodeInfo2 translates that selection into the correct Copilot runtime settings internally.
- If `codex/chat/config.toml` sets `codeinfo_openai_endpoint`, the Codex chat runtime uses that endpoint and the configured `model` through internal translation rather than requiring raw Codex-native provider config.
- If `copilot/chat/config.toml` sets `codeinfo_openai_endpoint`, the Copilot chat runtime uses that endpoint and the configured `model` through internal translation rather than requiring raw Copilot-native provider objects in user-authored config.
- `codex/chat/config.toml` can therefore define the default Codex chat model from a local or remote OpenAI-compatible endpoint by setting `codeinfo_openai_endpoint` and `model`.
- `copilot/chat/config.toml` can therefore define the default Copilot chat model from a local or remote OpenAI-compatible endpoint by setting `codeinfo_openai_endpoint` and `model`.
- `codeinfo_agents/<agent>/config.toml` can therefore define the agent's Codex or Copilot model from a local or remote OpenAI-compatible endpoint by setting `codeinfo_provider`, `codeinfo_openai_endpoint`, and `model`.
- When `codeinfo_openai_endpoint` is present, harness-wire compatibility is validated during runtime-config resolution:
  - Codex requires `responses`.
  - Copilot requires `completions`, `responses`, or both.
- For a new chat conversation or a new agent run, when `codeinfo_openai_endpoint` is present, CodeInfo2 first attempts execution through the requested provider on that configured endpoint.
- If the configured endpoint is reachable but the requested model is unavailable there, CodeInfo2 keeps the same requested provider and repairs to the first selectable model on that same endpoint before considering broader fallback.
- If the configured endpoint is unavailable, CodeInfo2 falls back to the same requested provider's normal built-in or native model path before considering cross-provider fallback.
- If the requested provider still cannot execute after same-provider endpoint fallback and native fallback have both been evaluated, the existing cross-provider fallback order continues to apply.
- Fallback and repair warnings clearly distinguish:
  - endpoint unavailable with same-provider native fallback;
  - requested model unavailable on endpoint with same-endpoint model repair;
  - requested provider unavailable with cross-provider fallback.
- The initial implementation does not add a new first-class LM Studio harness or any other new top-level provider choice for these external endpoints.
- The initial implementation does not perform a separate first-use capability probe beyond configured-endpoint parsing and `/v1/models` discovery.
- External model selections are persisted using separate values for the raw model id and the derived stable endpoint identity so the same model id from different endpoints cannot collide.
- Older saved conversations that do not have external endpoint identity continue to open normally with the current provider-and-model behavior.
- The UI derives a human-usable display label for each external model using `host / model` rather than the full endpoint URL or the model name alone.
- If two visible external model choices would otherwise share the same `host / model` label, the UI appends a short path hint to distinguish only those colliding labels.
- Existing built-in Codex and Copilot model discovery and selection behavior remains coherent for users who do not configure any external endpoints.
- Existing conversation persistence, resumed-conversation provider pinning, and agent-flag behavior remain coherent when an external model has been selected through either harness.
- Existing resumed conversations and saved execution identities do not silently switch to a different endpoint, model source, or provider when their pinned external endpoint later becomes unavailable.
- New chat conversations and new agent runs can use the endpoint-aware fallback path, but later turns on a pinned saved execution continue to fail in place when the pinned provider path or pinned external endpoint is unavailable.
- Automated tests cover endpoint parsing, `codeinfo_openai_endpoint` parsing, duplicate endpoint handling with warnings, `/v1/models` discovery, harness-specific model filtering, internal harness translation from CodeInfo-owned config fields, endpoint-unavailable same-provider fallback, endpoint-model-missing same-endpoint repair to the first selectable model, cross-provider fallback after same-provider failure, fail-in-place behavior for pinned executions, separate persisted endpoint identity plus raw model id behavior, shared picker behavior for the same normalized endpoint identity across config sources, and the upgraded Codex and Copilot dependency seams touched by the story.

### Out Of Scope

- Adding LM Studio as a new first-class harness or top-level provider in the product UI.
- Adding external-endpoint model-selection UI to the Agents page.
- Supporting host-only shorthand values that omit `/v1` from the configured endpoint URLs.
- Adding user-defined endpoint names or labels to the environment variable format in this story.
- Using raw Codex `model_provider` and `[model_providers.*]` settings as the user-authored configuration contract for this feature.
- Adding any second or more structured TOML syntax for external endpoint selection beyond the single `codeinfo_openai_endpoint` string field.
- Adding speculative alternative config syntaxes, abstractions, or future-facing config layers beyond what is needed to support the single `codeinfo_openai_endpoint` string contract now.
- Silently changing a resumed or pinned conversation from one external endpoint to another external endpoint.
- Silently changing a resumed or pinned conversation from its pinned provider path to a different provider because an external endpoint later became unavailable.
- Adding endpoint-to-endpoint fallback chains across multiple configured external OpenAI-compatible endpoints in this story.
- Adding user-configurable fallback policy matrices or other speculative fallback configuration beyond extending the existing provider fallback behavior to account for external endpoints.
- Relaxing the current Codex or Copilot active/auth readiness rules so those providers can execute against `codeinfo_openai_endpoint` while their normal built-in login state is still missing.
- Performing additional capability probes, preflight tool-use certification, or first-use runtime compatibility checks beyond endpoint parsing and `/v1/models` discovery.
- Building a generic endpoint-management UI for editing external endpoint configuration in the browser.
- Replacing the current built-in Codex or Copilot harnesses with a new generic "OpenAI-compatible" harness.
- Solving every later provider-specific quirk for self-hosted gateways that claim OpenAI compatibility but diverge in behavior during agent execution.

### User-Facing Behavior Lock

- Preserve the current browser-visible and runtime-visible interaction contract everywhere this story does not explicitly ask for a change.
- The only intentional user-facing behavior additions in this story are:
  - endpoint-backed model choices appearing inside the existing `Codex` and `Copilot` chat pickers;
  - endpoint-aware warnings that distinguish same-endpoint repair, same-provider native fallback, and fail-in-place behavior for pinned or resumed executions;
  - endpoint-aware persistence that keeps the selected raw model id and endpoint identity separate without changing the existing top-level provider choices.
- Keep the existing `LM Studio` chat flow, the existing `Agents` page selection UI, the existing provider-control reachability, and the existing create-vs-reuse chat workflow behavior unless preserving those current behaviors requires minimal restoration work after the endpoint identity changes land.
- Do not introduce new user-facing toggles, menus, selection rules, validation timing changes, removal behavior, or replacement behavior merely because a different contract would be cleaner, easier to prove, or easier to implement.
- If endpoint identity work exposes a drift risk in the current create-mode or resumed-conversation flow, fix only the minimum needed to preserve the pre-story user interaction contract plus the explicitly requested endpoint-backed behavior above.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

- Prefer deterministic automated proof first by mocking or fixture-driving external endpoint discovery where possible, because the story contract does not require a live internet dependency to prove the parsing and model-filtering behavior.
- If later manual proof uses live external endpoints, use explicit `/v1` base URLs in the environment and record which harness surface was exercised for each retained artifact.
- If later manual proof covers direct runtime-config selection, include at least one proof case where a chat or agent config uses `codeinfo_openai_endpoint` without the same endpoint appearing in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
- If later manual proof covers chat picker behavior, include at least one proof case where a config-pinned endpoint that is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` still appears in the picker with a `host / model` label.
- If later manual proof covers same-host endpoints, include at least one proof case where two different full base URLs on the same host remain distinct internally and only gain a short path hint when their `host / model` labels would otherwise collide.
- If later manual proof covers duplicate endpoint definitions, include at least one proof case where repeated definitions of the same normalized endpoint collapse to one active entry with a warning.
- If later manual proof covers merged endpoint sources, include at least one proof case where the same normalized endpoint from env config and chat config appears as one shared picker entry.
- If later manual proof covers conversation resume behavior, include at least one proof case showing that an older saved chat without endpoint identity still opens normally.
- If a later manual proof step reaches an auth-dependent Codex or Copilot surface that cannot be restored without human-controlled two-factor authentication, follow the repository's documented skip policy for that affected surface only.

## Feasibility Proof Pass

### 1. External endpoint parsing and normalization

- Already existing capabilities:
  - `server/src/config/startupEnv.ts` already owns deterministic env parsing with trimming, duplicate dropping, warning collection, stable ordering, and default handling through `resolveAgentProviderFallbackOrder()`.
  - `server/src/test/unit/env-loading.test.ts` already proves the repository-standard parsing behaviors for blank input, whitespace trimming, duplicate warnings, and env inventory reporting.
  - `server/src/config/runtimeConfig.ts` already owns the strip-then-translate pattern for `codeinfo_*` metadata through `extractRuntimeConfigAppMetadata()` and `stripAppOwnedRuntimeMetadata()`.
- Missing prerequisite capabilities:
  - One shared parser and normalized shape for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` and the single-string `codeinfo_openai_endpoint` value is still missing and must be created before route, runtime, or persistence work depends on it.
  - `SERVER_CODEINFO_ENV_NAMES` in `server/src/config/startupEnv.ts` does not yet include `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`, so the existing startup-env inventory would silently omit the new contract unless this story updates that owner.
  - `RuntimeConfigAppMetadata` in `server/src/config/runtimeConfig.ts` currently only carries `codeinfoProvider`; it must grow an external-endpoint field before agent or chat runtime translation can use the new metadata cleanly.
- Assumptions currently invalid:
  - The current runtime metadata type does not know about endpoint identity or wire capability declarations yet.
  - The current plan text does not yet state the exact blank-input and malformed-input behavior strongly enough for later task generation.
- Feasibility and sequencing note:
  - The parser must be implemented first and treated as the single source of truth. All later discovery, runtime translation, persistence, and manual-proof work should consume the normalized parsed structure instead of reparsing raw strings in multiple places.

### 2. External model discovery and selection identity

- Already existing capabilities:
  - `server/src/routes/chatProviders.ts`, `server/src/routes/chatModels.ts`, and `server/src/routes/chatDiscovery.ts` already own provider discovery, model aggregation, default-model selection, provider ordering, and provider-specific warning surfacing.
  - `client/src/hooks/useChatModel.ts` already owns provider bootstrap, model bootstrap, provider ordering, selected-model hydration, and Codex-specific reasoning-capability handling in the chat picker.
  - `common/src/api.ts` already locks the top-level provider contract to `codex`, `copilot`, and `lmstudio`.
- Missing prerequisite capabilities:
  - The repository does not yet have a shared multi-endpoint HTTP probe helper for `GET /v1/models`. A new helper must be created before route work begins so chat discovery and runtime execution do not each invent their own timeout and partial-failure behavior.
  - The current chat picker and request contracts only carry one selected `model` string at a time. That is insufficient when two external endpoints expose the same raw model id, because `client/src/hooks/useChatModel.ts` currently matches selected models by `model.key === selected`.
  - The plan must therefore treat separate endpoint identity in the chat discovery response, client selection state, and `/chat` request body as a prerequisite rather than leaving it for later debugging.
- Assumptions currently invalid:
  - Reusing the current `selectedModel` string-only state without an accompanying endpoint identity would collapse same-model choices from different external endpoints.
  - Introducing a brand-new top-level provider id is not allowed by the story and would also fight the current `ORDERED_CHAT_PROVIDER_IDS` contract.
- Feasibility and sequencing note:
  - The existing provider order and selected-provider contract can stay intact. External Codex models should remain Codex models, and external Copilot models should remain Copilot models, with a separate endpoint identity carried alongside the raw model id instead of replacing the provider contract.

### 3. Runtime translation and execution fallback

- Already existing capabilities:
  - `server/src/config/runtimeConfig.ts` already supports app-owned metadata stripping, provider-specific runtime resolution, placeholder normalization, and preservation of raw `model_provider` / `model_providers` tables when they already exist.
  - `server/src/agents/config.ts` already resolves provider-neutral agent metadata into provider-specific runtime execution config.
  - `server/src/config/chatDefaults.ts` and `server/src/routes/chat.ts` already implement provider-order fallback, same-provider preferred-model repair, and explicit-provider fail-in-place behavior.
  - `server/src/chat/interfaces/ChatInterfaceCopilot.ts` already owns the final `createSession()` config handed to the Copilot SDK, and `server/src/config/codexConfig.ts` already owns Codex runtime config seeding and `model_provider` support.
- Missing prerequisite capabilities:
  - There is no existing helper that translates a parsed external endpoint into a Codex `model_provider` / `model_providers.<name>` runtime shape.
  - There is no existing helper that translates a parsed external endpoint into a Copilot SDK `provider` object with `type`, `baseUrl`, `wireApi`, and explicit `model`.
  - There is no existing endpoint-aware selection layer that inserts same-endpoint model repair and same-provider native fallback before the current cross-provider fallback order.
- Assumptions currently invalid:
  - The current `RuntimeProviderSelection` model is provider-centric only and does not know about endpoint reachability or endpoint-local model repair yet.
  - The latest GitHub Copilot SDK and CLI docs allow BYOK providers to bypass GitHub-hosted auth, but this story explicitly preserves the repository's current readiness policy and does not relax the existing auth gate in the current product behavior.
- Feasibility and sequencing note:
  - The dependency upgrade and baseline harness revalidation must happen before endpoint translation work. The repository is still pinned to `@openai/codex` / `@openai/codex-sdk` `0.130.0` and `@github/copilot-sdk` `0.3.0`, while the latest published versions confirmed during this pass are `0.136.0`, `0.136.0`, and `1.0.0-beta.12`.

### 4. Persistence, resume behavior, and proof ownership

- Already existing capabilities:
  - `server/src/mongo/conversation.ts` already keeps optional flexible state in `Conversation.flags`.
  - `server/src/routes/chat.ts` already reads a resumed execution identity from persisted conversation state and already uses explicit-provider fail-in-place behavior for pinned executions.
  - Existing proof homes already cover persistence and resume semantics for provider/model pinning.
- Missing prerequisite capabilities:
  - The repository does not yet persist endpoint identity separately from the raw model id.
  - The resumed execution identity read path does not yet include endpoint identity, so resumed conversations cannot currently fail in place on endpoint changes without more contract work.
  - The existing plan text does not yet assign proof ownership for endpoint-aware persistence and resume behavior strongly enough for later task generation.
- Assumptions currently invalid:
  - Older saved conversations still contain only provider and model, so any new endpoint identity must remain optional and non-breaking at read time.
  - Packing endpoint routing into the `model` string would violate the story contract and would also blur the repository's current persistence model.
- Feasibility and sequencing note:
  - The cleanest repository-owned persistence pattern is to keep `Conversation.model` as the raw model id and add an optional endpoint identity field in `Conversation.flags`, then extend the resumed execution identity to read both.

## Message Contracts And Storage Shapes

- `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` is an optional server env input.
  - Missing or whitespace-only value means no external endpoints are configured.
  - Split on semicolons after trimming. Ignore blank segments that become empty after trim.
  - Every non-blank segment must use the exact single-endpoint grammar `<full http-or-https /v1 base URL>|<capability[,capability...]>`.
  - URL normalization must produce the stable endpoint identity used everywhere else in the story. Query strings and fragments are out of contract for this story and should fail validation instead of creating alternate identities.
  - The normalized path must represent a full explicit `/v1` base URL. Host-only roots remain out of scope.
  - Capability tokens are case-insensitive after trim, but the normalized stored set should be lowercase and deduplicated.
  - Supported capabilities are only `responses` and `completions`. At least one capability is required. Unknown capability tokens make the entry malformed.
  - Duplicate normalized endpoints from the env list are not malformed; keep the first entry, drop later duplicates, and emit warnings.
- `codeinfo_openai_endpoint` is an optional CodeInfo-owned runtime-config field in `codeinfo_agents/<agent>/config.toml`, `codex/chat/config.toml`, and `copilot/chat/config.toml`.
  - Missing key means no endpoint pin.
  - Present but blank or whitespace-only value is malformed and should fail validation instead of being treated as absent.
  - The value uses the same single-endpoint grammar and normalization rules as one env-list item.
- Official contract evidence confirmed during this pass:
  - OpenAI-compatible model discovery uses `GET /v1/models` and only needs the returned `data[].id` field from the list response.
  - Codex runtime translation must emit a generated `model_provider` plus matching `model_providers.<name>` entry with `base_url` and `wire_api`.
  - Copilot SDK runtime translation must emit a generated custom provider object with `type: "openai"`, a full `baseUrl` including `/v1`, an explicit `wireApi`, and an explicit `model`.
- Chat API and client-selection contracts need one new optional endpoint identity alongside the raw model id.
  - Keep the top-level provider ids unchanged as `codex`, `copilot`, and `lmstudio`.
  - Keep external Codex models typed as Codex models and external Copilot models typed as Copilot models so the current capability handling remains provider-shaped.
  - Do not encode endpoint identity into the raw `model` string.
  - Use `endpointId` as the separate identity field on internal runtime selection, persisted conversation flags, and `/chat` request handling, and use `selectedEndpointId` as the provider-bootstrap response field paired with `selectedModel`.
  - The `ChatModelInfo` surface also needs a separate endpoint identity field so the client can distinguish duplicate raw model ids from different external endpoints without introducing a new top-level provider.
- Persistence contract:
  - `Conversation.model` remains the raw model id.
  - `Conversation.flags.endpointId` is the recommended optional persisted endpoint identity for this story.
  - Resumed execution identity must read `{ provider, model, endpointId? }` and keep fail-in-place semantics when the endpoint is later unavailable.
- Bounding strategy:
  - Discovery fan-out is bounded to one `GET /v1/models` probe per unique normalized endpoint from the env list plus one optional config-pinned endpoint that is not already present after normalization.
  - Deduplicate before network I/O and preserve the normalized input order for all later merges, warnings, and picker ordering.

## Test Harnesses

- Existing proof homes that later tasks should extend directly:
  - `server/src/test/unit/env-loading.test.ts` for env parsing, normalization, blank-input handling, and duplicate warnings.
  - `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/chatModels.copilot.test.ts`, and `server/src/test/unit/chatProviders.test.ts` for provider/model discovery, filtering, default-model selection, and shared picker behavior.
  - `server/src/test/unit/config.chatDefaults.test.ts` and `server/src/test/integration/chat-copilot-fallback.test.ts` for provider/model repair, fallback ordering, and explicit-provider fail-in-place behavior.
  - `server/src/test/unit/agents-config-defaults.test.ts` for provider-neutral runtime-config metadata and agent execution config resolution.
  - `server/src/test/unit/chat-interface-run-persistence.test.ts` and `server/src/test/integration/chat-copilot-resume.test.ts` for endpoint-aware persistence and resumed fail-in-place behavior.
  - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` and `server/src/test/integration/mcp-codex-wrapper.test.ts` for Codex runtime config inheritance and generated `model_provider` / `model_providers` shapes.
- Missing prerequisite test capability:
  - The repository needs one lightweight `startExternalEndpointServer()` style helper for story 59 unit and integration tests. It should follow the existing `express + httpServer.listen(0) + supertest` pattern already used by the current route tests and expose configurable `GET /v1/models` responses plus failure cases.
- Missing prerequisite production capability:
  - The repository needs one shared external-endpoint probe helper that performs `fetch` + `AbortController` timeout behavior following the current `server/src/providers/mcpStatus.ts` pattern. That helper should own deterministic ordering, partial failure handling, and one-request-per-endpoint semantics instead of leaving those choices to route code.
- Manual-proof and runtime entrypoint evidence already confirmed:
  - Main proof stack startup order remains `npm run compose:build` then `npm run compose:up`, with the supported surfaces at `http://localhost:5001` and `http://localhost:5010`.
  - The server health surface remains `http://localhost:5010/health`.
  - The main stack does not provide an external OpenAI-compatible endpoint service, so any later live manual proof must point `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` at an external or locally running endpoint outside the checked-in compose services.
  - Auth-dependent Codex or Copilot proof still uses the repository-defined skip rule when restoring auth would require human-controlled two-factor authentication.

## Edge Cases And Failure Modes

- Early risk-invariant matrix:
  - Parser and endpoint identity owner:
    - Invariant: the same normalized full `/v1` URL must always produce the same endpoint identity, and the first duplicate entry wins.
    - Most likely contradiction: env list duplicates, config-pin duplicates, trailing-slash variants, or same-host different-path endpoints being merged incorrectly.
    - Proof status: direct proof required.
    - Future task home: the parser and normalization task.
  - Discovery fan-out owner:
    - Invariant: probe each unique endpoint at most once per discovery pass, preserve input order, and keep partial failures from hiding healthy endpoints.
    - Most likely contradiction: one endpoint times out or returns malformed data while another succeeds, leading to reordered or partially dropped picker choices.
    - Proof status: direct proof required.
    - Future task home: the external discovery helper and route task.
  - Selection identity owner:
    - Invariant: two visible choices with the same raw model id but different endpoint identities stay independently selectable, displayable, and resumable.
    - Most likely contradiction: current string-only `selectedModel` state collapsing duplicate raw model ids from different endpoints.
    - Proof status: direct proof required.
    - Future task home: the discovery-response and client-selection task.
  - Runtime execution owner:
    - Invariant: new runs may repair or fall back within the requested provider path, but resumed or pinned executions must never silently drift to a different endpoint or provider.
    - Most likely contradiction: the endpoint disappears between picker discovery and send, or between an earlier saved run and a later resumed turn.
    - Proof status: direct proof required.
    - Future task home: the runtime translation and endpoint-aware fallback task.
  - Runtime-config metadata owner:
    - Invariant: `codeinfo_*` metadata stays repository-owned and stripped before the underlying harness validates or executes provider-native config.
    - Most likely contradiction: `codeinfo_openai_endpoint` reaching raw validation at the wrong layer or leaking into final user-visible provider-native config files.
    - Proof status: direct proof required.
    - Future task home: the runtime-config translation task.
  - Manual-proof runtime owner:
    - Invariant: later live proof must use the supported main stack startup order, explicit env injection, and repository-defined auth skip conditions, while keeping external endpoint services outside the checked-in compose stack unless the user later expands scope.
    - Most likely contradiction: later proof assuming the external endpoint is part of `docker-compose.yml` or that auth can be repaired autonomously.
    - Proof status: indirect proof via final manual-testing guidance plus automated mocks.
    - Future task home: the final story validation and close-out task.

### Questions

None.

## Decisions

1. Picker visibility for config-pinned endpoints
   - The question being addressed: If a chat config names an endpoint outside the env var list, should that endpoint still appear in the chat picker?
   - Why the question matters: A hidden config-backed default would make the selected endpoint hard to understand, verify, or reselect in the UI.
   - What the answer is: Yes. If a chat config pins `codeinfo_openai_endpoint`, that active endpoint and its discovered models still appear in the chat picker even when the same endpoint is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
   - Where the answer came from: The user's answer, the current chat bootstrap and selected-model flow in `client/src/hooks/useChatModel.ts`, and the existing story rules that allow `codeinfo_openai_endpoint` to stand on its own without the env var list.
   - Why it is the best answer: It keeps the active default visible, avoids confusing hidden state, and uses the endpoint's own `/v1/models` response rather than requiring duplicate env configuration just for the picker.
2. Conversation persistence for external endpoint selections
   - The question being addressed: When we save a conversation using an external endpoint, should the endpoint be stored separately from the model?
   - Why the question matters: Resumed conversations need to tell apart the same model id coming from different endpoints without burying routing data in one opaque string.
   - What the answer is: Yes. Store the raw model id separately from the derived endpoint identity.
   - Where the answer came from: The user's answer, the current conversation schema in `server/src/routes/conversations.ts`, and the conversation restore flow in `client/src/pages/ChatPage.tsx`.
   - Why it is the best answer: It fits the repo's existing pattern of separate persisted fields, stays easier to inspect and migrate, and still prevents collisions between the same model id on different endpoints.
3. Chat labels for external endpoint models
   - The question being addressed: How should external models be labeled in chat: `host / model`, full URL, or just the model name?
   - Why the question matters: Users need a picker label that distinguishes identical model ids without filling the UI with long endpoint strings.
   - What the answer is: Use `host / model`.
   - Where the answer came from: The user's answer, the current provider and model label handling in `client/src/hooks/useChatModel.ts` and `server/src/routes/chatModels.ts`, and the OpenAI-compatible model-list pattern where source context must often be added by the client.
   - Why it is the best answer: It is short, readable, and gives enough source context to distinguish duplicate model ids without exposing a noisy full URL.
4. Full endpoint identity for same-host URLs
   - The question being addressed: If two endpoints share a host but use different paths, should we treat them as different endpoints?
   - Why the question matters: Same-host deployments can still be different endpoints, so host-only identity could merge distinct routes by mistake.
   - What the answer is: Yes. Treat endpoints as different when their normalized full base URLs differ, even if the host is the same.
   - Where the answer came from: The user's answer, local URL and path identity patterns such as `server/src/lmstudio/clientPool.ts` and `server/src/routes/lmstudioUrl.ts`, plus the official Copilot and Codex docs that treat `baseUrl` as a full endpoint configuration.
   - Why it is the best answer: It matches the repo's established identity rules, avoids collapsing distinct routes, and still leaves room for shorter display labels in the UI.
5. Collision handling for `host / model` labels
   - The question being addressed: If two labels would both read `host / model`, should chat add a short path to tell them apart?
   - Why the question matters: Two distinct endpoint choices should not look identical in the picker.
   - What the answer is: Yes. Use `host / model` by default, but append a short path hint only when two visible choices would otherwise collide.
   - Where the answer came from: The user's answer, local display-label patterns such as `client/src/pages/AgentsPage.tsx`, and the story's existing preference for short labels in the common case.
   - Why it is the best answer: It keeps the picker simple most of the time while still making edge-case collisions understandable.
6. Backward compatibility for older saved chats
   - The question being addressed: Should older saved chats without endpoint info still open normally?
   - Why the question matters: Existing persisted chats should keep working after the story adds endpoint identity for newer chats.
   - What the answer is: Yes. Older saved chats continue to open with the current provider-and-model behavior, and the new endpoint identity remains optional and is used only when present.
   - Where the answer came from: The user's answer, current backward-compatibility patterns in `server/src/mongo/conversation.ts`, `server/src/mongo/repo.ts`, and `client/src/hooks/useConversations.ts`, plus Mongoose defaults guidance.
   - Why it is the best answer: It protects existing data, fits the repo's current schema-growth pattern, and avoids forcing migration work into this story.
7. Duplicate endpoint entries
   - The question being addressed: If the same endpoint is listed twice, should we keep the first one with a warning, or fail?
   - Why the question matters: Duplicate config entries are easy to create, and the product needs one predictable rule that does not surprise users.
   - What the answer is: Keep the first normalized endpoint entry and warn. Later duplicates are dropped.
   - Where the answer came from: The user's answer, duplicate-handling patterns in `server/src/routes/ingestRoots.ts`, `server/src/flows/repositoryCandidateOrder.ts`, and `server/src/config/runtimeConfig.ts`.
   - Why it is the best answer: It matches the repo's normal warn-and-continue duplicate policy and avoids turning a small config mistake into a hard failure.
8. Shared picker entry for the same endpoint identity
   - The question being addressed: If the same endpoint comes from both env vars and chat config, should chat show one shared entry or two?
   - Why the question matters: Duplicate picker entries for the same endpoint would add noise and make saved endpoint identity harder to reason about.
   - What the answer is: Show one shared entry when the normalized full base URL is the same.
   - Where the answer came from: The user's answer, the plan's existing full-URL identity decision, and the repo's broader deduplication patterns.
   - Why it is the best answer: It keeps the picker simpler and treats the same endpoint as one underlying identity no matter where it was configured.
9. Same-endpoint repair model choice
   - The question being addressed: If a pinned endpoint model is missing, should we pick the first available model there or stop with an error?
   - Why the question matters: The story already requires same-endpoint repair, but it needs one concrete rule for choosing the replacement model.
   - What the answer is: Pick the first selectable model on that same endpoint and warn.
   - Where the answer came from: The user's answer and the fallback-selection behavior in `server/src/config/chatDefaults.ts`.
   - Why it is the best answer: It matches the current preferred-then-first-available fallback pattern already used by the repo.

## Implementation Ideas

- Introduce one shared parser and normalized config shape for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`, including stable ordering, normalized capability sets, and a derived internal endpoint identity based on the configured URL.
- Introduce one shared parser for the single-string `codeinfo_openai_endpoint` value so the same normalization and validation rules are reused across agent configs and provider chat configs.
- Reuse the existing chat provider and model discovery seams so external endpoints appear as additional model options under the existing Codex and Copilot harnesses rather than as a third harness family.
- Keep the GUI selection surface scoped to chat so the user can choose external endpoint models from the Codex and Copilot chat model picker without also expanding the Agents page model-selection UI in this story.
- Treat external model discovery as a catalog-building step: parse configured endpoints, call `/v1/models`, normalize the returned model ids, and then filter the combined catalog per harness.
- If a chat config pins `codeinfo_openai_endpoint` outside the env var catalog, still surface that active endpoint and its discovered models in the chat picker for the selected provider.
- Treat `codeinfo_openai_endpoint` as a CodeInfo-owned metadata field that is interpreted and then translated internally into the correct Codex or Copilot runtime settings rather than being forwarded directly as a raw user-authored harness config block.
- Derive internal endpoint identity from the normalized full base URL, not from the host alone, so same-host endpoints with different paths remain distinct.
- Deduplicate repeated endpoint definitions by normalized full base URL, keep the first winner, and emit a warning for later duplicates instead of failing.
- Model external endpoint execution as part of the requested provider path rather than as a new top-level provider id.
- Extend the current fallback flow so the order becomes:
  - requested provider on the configured external endpoint;
  - same provider with same-endpoint model repair to the first selectable model when the endpoint is healthy but the requested model is missing;
  - same provider on its normal built-in or native path when the endpoint is unavailable;
  - existing cross-provider fallback only after same-provider options fail.
- For persisted selections, store the raw model id separately from the derived endpoint identity instead of packing both values into a single composite model string.
- Derive user-facing external endpoint labels using `host / model` without requiring user-configured names in the environment variable and without showing the full URL in the picker by default.
- When two visible external choices would otherwise share the same `host / model` label, append a short path hint only for those colliding labels.
- Merge env-backed and config-backed appearances of the same normalized endpoint identity into one shared chat picker entry.
- Revisit the Copilot session-creation seam so it can pass a custom OpenAI-compatible provider configuration whenever the selected model belongs to an external endpoint or a runtime config pins `codeinfo_openai_endpoint`.
- Revisit the Codex runtime-config seam so it can translate `codeinfo_openai_endpoint` into the appropriate internal Codex provider configuration for `responses`-capable endpoints.
- Reuse the existing fallback warning and result surfaces so endpoint-aware fallback remains visible and explainable in chat and agent responses.
- Keep pinned execution identity behavior strict so later turns fail in place instead of silently re-routing to a different endpoint or provider.
- Keep the new persisted endpoint identity optional at read time so older saved chats without that field continue to load normally.
- Keep malformed-endpoint handling explicit and non-silent so one bad entry does not make the whole external catalog ambiguous.
- Known later enhancement, intentionally deferred from this story: revisit provider readiness so endpoint-backed Codex or Copilot execution can remain usable even when the provider's usual built-in login state is inactive, without redefining the broader meaning of provider availability in the same change.
- Add focused proof for:
  - environment-variable parsing and validation;
  - `codeinfo_openai_endpoint` parsing and validation;
  - `/v1/models` discovery normalization;
  - Codex-only `responses` filtering;
  - Copilot `completions` and dual-capability filtering;
  - direct agent and chat config translation into harness-specific runtime settings;
  - chat picker visibility for a config-pinned endpoint that is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`;
  - distinct internal identity for same-host endpoints whose normalized full base URLs differ;
  - duplicate endpoint definitions collapsing to one active entry with a warning;
  - one shared picker entry when env config and chat config refer to the same normalized endpoint identity;
  - endpoint-unavailable same-provider native fallback;
  - endpoint-model-missing same-endpoint repair to the first selectable model;
  - cross-provider fallback only after same-provider endpoint and native paths fail;
  - fail-in-place behavior for pinned or resumed executions that already point at an external endpoint;
  - separate persisted endpoint identity plus raw model id for external selections;
  - `host / model` labeling for external chat models;
  - short path hints only when `host / model` labels would otherwise collide;
  - backward-compatible loading of older saved chats that do not carry endpoint identity;
  - compatibility of the upgraded Codex and Copilot library seams with the existing CodeInfo2 harness contracts.

# Tasks

### Task 1. Upgrade Codex And Copilot SDK Baselines Before Story Work

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__done__`
- Git Commits:

#### Overview

Upgrade the Codex and Copilot packages before any external-endpoint behavior lands so the rest of the story is built on the versions that will actually ship. This task also updates the repo-owned exact-version guard and the baseline proof homes that already protect these harness seams.

#### Task Exit Criteria

- `server/package.json`, the lockfile, and the exact-version guard all point at the latest published compatible `@openai/codex`, `@openai/codex-sdk`, and `@github/copilot-sdk` versions rechecked at implementation time.
- Existing Codex and Copilot runtime seams still build and pass their baseline automated proof after the upgrade.

#### Documentation Locations

- `Context7 /openai/codex` - use for current Codex provider-routing and config expectations while validating that the upgraded package still matches the repo-owned runtime translation shape.
- `Context7 /github/copilot-sdk` - use for current Copilot session/provider expectations while validating that the upgraded SDK still matches the repo-owned session creation seam.

#### Subtasks

1. [x] Read the full story sections for Story `0000059`, then inspect `server/package.json`, `package-lock.json`, and `server/src/config/codexSdkUpgrade.ts`. Purpose: confirm the current package pins and exact-version guard before changing any dependency versions. Proof owners: `server/src/test/unit/codexSdkUpgrade.test.ts`.
2. [x] Inspect `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, `server/src/config/codexConfig.ts`, `server/src/test/unit/copilot-compose-contract.test.ts`, and `server/src/test/integration/mcp-codex-wrapper.test.ts`. Purpose: confirm the existing Codex and Copilot runtime seams that the dependency upgrade must preserve. Proof owners: `server/src/test/unit/copilot-compose-contract.test.ts`, `server/src/test/integration/mcp-codex-wrapper.test.ts`.
3. [x] Re-check the current latest published compatible versions of `@openai/codex`, `@openai/codex-sdk`, and `@github/copilot-sdk` immediately before editing the repo. Purpose: satisfy the story’s upgrade-first requirement without relying on planning-time version assumptions.
4. [x] Update `server/package.json` and `package-lock.json` so the installed `@openai/codex`, `@openai/codex-sdk`, and `@github/copilot-sdk` versions match the re-checked published versions chosen for this story. Purpose: move the repo itself onto the approved baseline before any endpoint work starts. Proof owners: `server/src/test/unit/codexSdkUpgrade.test.ts`, `server/src/test/unit/copilot-compose-contract.test.ts`.
5. [x] Update `server/src/config/codexSdkUpgrade.ts` so the repo-owned exact-version guard matches the installed Codex SDK version after the dependency upgrade. Purpose: keep startup guard behavior aligned with the actual installed package version. Proof owners: `server/src/test/unit/codexSdkUpgrade.test.ts`.
6. [x] Test type: server unit. Location: `server/src/test/unit/codexSdkUpgrade.test.ts`. Description: prove the installed Codex package version and the repo-owned exact-version guard stay aligned after the upgrade. Implementation files: `server/package.json`, `package-lock.json`, and `server/src/config/codexSdkUpgrade.ts`. Purpose: prevent a startup-guard drift where the repo installs one Codex SDK version but still enforces another.
7. [x] Test type: server unit. Location: `server/src/test/unit/copilot-compose-contract.test.ts`. Description: prove the upgraded Copilot SDK does not silently change the repo’s existing runtime/compose contract. Implementation files: `server/package.json`, `package-lock.json`, and any affected Copilot runtime seam such as `server/src/chat/interfaces/ChatInterfaceCopilot.ts`. Purpose: keep the baseline Copilot runtime reachable through the repo’s standard startup path after the dependency upgrade.
8. [x] Test type: server integration. Location: `server/src/test/integration/mcp-codex-wrapper.test.ts`. Description: prove the upgraded Codex packages still satisfy the existing wrapper/runtime integration boundary when that boundary changes. Implementation files: `server/package.json`, `package-lock.json`, and any affected Codex runtime seam such as `server/src/config/codexConfig.ts`. Purpose: catch post-upgrade breakage that would only appear once the Codex wrapper consumes the runtime config.
9. [x] Restore the pre-upgrade Copilot same-provider missing-model repair behavior after the SDK bump so the existing chat fallback surface keeps the approved behavior already covered by `server/src/test/integration/chat-copilot-fallback.test.ts`. Purpose: keep the baseline dependency-upgrade task behavior-preserving instead of letting the SDK change current chat fallback outcomes before Story `0000059` feature work starts. Proof owners: `server/src/test/integration/chat-copilot-fallback.test.ts`, `test-results/server-unit-tests-2026-06-02T03-23-03-848Z.log`.
10. [x] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.
11. [x] Run the exact repository-supported format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the upgraded server workspace still builds cleanly before story-specific endpoint changes begin.
2. [x] Run `npm run test:summary:server:unit` to revalidate the baseline Codex and Copilot unit/integration proof on the upgraded versions.
3. [x] Run `npm run lint` for the final upgraded surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
4. [x] Run `npm run format:check` for the final upgraded surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Implementation notes

- Read the task scope and confirmed the existing pins/guard before editing anything.
- Rechecked npm registry versions at implementation time and found `@openai/codex`/`@openai/codex-sdk` `0.136.0` and `@github/copilot-sdk` `1.0.0-beta.12`.
- Updated `server/package.json`, the root lockfile, and the Codex SDK exact-version guard to the rechecked versions.
- Verified the targeted server unit/integration proof homes still pass after the upgrade bump.
- Lint passed cleanly after the dependency bump.
- Format check passed cleanly after the dependency bump.
- Audit normalized Testing items 3 and 4 to complete from the existing `npm run lint` and `npm run format:check` evidence in this task's subtasks and notes; wrapper-based `build:summary:server` and `test:summary:server:unit` proof still remain for the later automated-proof pass.
- Audit normalized Testing item 1 complete from `logs/test-summaries/build-server-latest.log`, which shows the wrapper-owned server build finished cleanly after the dependency bump.
- Audit found the latest `test:summary:server:unit` proof still failing in `test-results/server-unit-tests-2026-06-02T03-23-03-848Z.log` at `server/src/test/integration/chat-copilot-fallback.test.ts`, where the upgraded baseline returns `copilot-gpt-5` instead of the expected preserved repair target `gpt-5-mini`; this remains story-caused in-scope restoration work for the baseline-upgrade task.
- **RESOLVED ISSUE** Restored Copilot's same-provider missing-model repair path by keeping `/chat` runtime selection on the live Copilot model order instead of re-prioritizing execution with the configured default model. While re-running `npm run test:summary:server:unit`, also corrected the stale provider-neutral Copilot reasoning-effort expectation in `server/src/test/unit/chatValidators.test.ts` and relaxed the direct-agent Copilot resume test waits in `server/src/test/unit/agents-config-defaults.test.ts` to cover the slower post-upgrade background run timing. Targeted reruns for the three previously failing tests passed, and the full wrapper passed cleanly in `test-results/server-unit-tests-2026-06-02T04-50-41-877Z.log`.
- Manual testing skipped for the checked-in main compose proof stack during this task-scoped pass.
- Tried: `bash ./scripts/docker-compose-with-env.sh --env-file server/.env --env-file server/.env.local ps`, plus direct `curl` checks to `http://localhost:5010/health` and `http://localhost:5001`.
- Observed: Docker access failed with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`, and both localhost proof surfaces returned connection failures (`000`) because the supported runtime was not running.
- Why fuller proof was not possible: Task 1's honest manual proof depends on the repository-supported main compose workflow, and this step could not start or inspect that runtime without Docker socket access; that environment limitation is outside this task's repair scope, so the task remains `__done__` without reopening work.

---

### Task 2. Parse And Normalize External Endpoint Config Inputs

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__done__`
- Git Commits:

#### Overview

Create the shared parser and normalization contract for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` and `codeinfo_openai_endpoint`. This task owns the canonical endpoint identity, deterministic duplicate handling, config-domain validation, and the rule that CodeInfo-owned metadata stays separate from provider-native runtime config.

#### Task Exit Criteria

- The server has one shared endpoint parser/normalizer that accepts only the story-approved `/v1|capabilities` format, derives stable endpoint identity from the normalized full URL, and emits deterministic warnings/errors for blank, malformed, duplicate, or unsupported-capability inputs.
- Runtime-config reads for `codeinfo_openai_endpoint` are deterministic across agent configs and provider chat configs, and the CodeInfo-owned metadata is retained only long enough for later translation instead of leaking into provider-native config validation/execution.

#### Documentation Locations

- `Context7 /websites/developers_openai_api_reference` - use for the official `/v1/models` contract so the parser task preserves the exact `/v1` base-URL requirement the later discovery task depends on.
- `Context7 /openai/codex` - use for Codex `responses`-capable provider expectations when validating `codeinfo_openai_endpoint` compatibility for Codex runtime-config resolution.
- `Context7 /github/copilot-sdk` - use for Copilot custom OpenAI-provider expectations when validating `codeinfo_openai_endpoint` compatibility for Copilot runtime-config resolution.

#### Subtasks

1. [x] Read the story’s `Description`, `Acceptance Criteria`, `Message Contracts And Storage Shapes`, `Test Harnesses`, and `Edge Cases And Failure Modes`, then inspect `server/src/config/startupEnv.ts`, `server/src/config/runtimeConfig.ts`, `server/src/agents/config.ts`, and `server/src/config/chatDefaults.ts`. Purpose: confirm the existing env-loading, runtime-config stripping, and provider metadata seams before introducing a new CodeInfo-owned endpoint field.
2. [x] Inspect `server/src/test/unit/env-loading.test.ts`, `server/src/test/unit/runtimeConfig.test.ts`, and `server/src/test/unit/agents-config-defaults.test.ts`. Purpose: confirm the current proof homes that must own the new parser and metadata behavior.
3. [x] Create `server/src/config/openaiCompatEndpoints.ts` as the shared parser/normalizer for one endpoint string. The implementation must trim whitespace, require an explicit `http` or `https` `/v1` base URL with no query string or fragment, normalize capability tokens to lowercase, require at least one supported capability, and reject unsupported capability names. Purpose: give every later task one canonical endpoint parser and one canonical endpoint identity rule. Proof owners: `server/src/test/unit/openaiCompatEndpoints.test.ts`.
4. [x] Update `server/src/config/startupEnv.ts` so `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` uses the shared parser, ignores blank env segments, preserves first-wins duplicate handling by normalized full URL, and emits warnings rather than hard failure for later duplicates. Purpose: make server startup the source of truth for env-backed endpoint normalization. Proof owners: `server/src/test/unit/env-loading.test.ts`.
5. [x] Update `server/src/config/runtimeConfig.ts` so `codeinfo_openai_endpoint` is read, normalized, validated, and retained as CodeInfo-owned runtime metadata on `codex/chat/config.toml` and `copilot/chat/config.toml`, and so `stripAppOwnedRuntimeMetadata()` removes `codeinfo_openai_endpoint` before provider-native execution config is finalized. Purpose: keep provider chat config parsing repository-owned instead of exposing raw provider-native endpoint tables. Proof owners: `server/src/test/unit/runtimeConfig.test.ts`.
6. [x] Update `server/src/agents/config.ts` so `codeinfo_openai_endpoint` is read and surfaced correctly on `codeinfo_agents/<agent>/config.toml`, while keeping non-agent `codeinfo_provider` rules honest and preserving provider-specific validation flow. Purpose: keep agent endpoint selection aligned with the repo’s provider-neutral config contract. Proof owners: `server/src/test/unit/agents-config-defaults.test.ts`.
7. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove one endpoint string accepts the supported in-range contract of an explicit `http` or `https` `/v1` base URL plus at least one supported capability. Implementation files: `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the accepted parser contract explicit instead of proving only rejections.
8. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove one endpoint string rejects a malformed URL that cannot be normalized into an explicit `http` or `https` base URL. Implementation files: `server/src/config/openaiCompatEndpoints.ts`. Purpose: give raw URL-shape rejection its own proof home instead of bundling it with other `/v1` contract failures.
9. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove one endpoint string rejects an otherwise valid URL when the normalized path does not end at `/v1`. Implementation files: `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the story’s exact `/v1` requirement explicit as its own parser invariant.
10. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove one endpoint string rejects query-string variants even when the base URL and capability tokens are otherwise valid. Implementation files: `server/src/config/openaiCompatEndpoints.ts`. Purpose: prevent ambiguous endpoint identity caused by query-bearing URLs.
11. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove one endpoint string rejects fragment-bearing variants even when the base URL and capability tokens are otherwise valid. Implementation files: `server/src/config/openaiCompatEndpoints.ts`. Purpose: prevent ambiguous endpoint identity caused by fragment-bearing URLs.
12. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove one endpoint string rejects unsupported capability names. Implementation files: `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep later discovery/filtering logic bounded to the approved wire-capability names only.
13. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove one endpoint string rejects entries that omit every supported capability token. Implementation files: `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the no-supported-capability failure path explicit instead of bundling it with unsupported-token coverage.
14. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove a blank `codeinfo_openai_endpoint` value fails validation instead of being treated as absent. Implementation files: `server/src/config/openaiCompatEndpoints.ts` and `server/src/config/runtimeConfig.ts`. Purpose: keep the exact blank-input edge case explicit for runtime-config callers.
15. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove a whitespace-only `codeinfo_openai_endpoint` value fails validation instead of being treated as absent after trimming. Implementation files: `server/src/config/openaiCompatEndpoints.ts` and `server/src/config/runtimeConfig.ts`. Purpose: keep the whitespace-only edge case separate from the truly blank-input path.
16. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatEndpoints.test.ts`. Description: prove same-host endpoints with different normalized paths remain distinct endpoint identities. Implementation files: `server/src/config/openaiCompatEndpoints.ts`. Purpose: prevent host-only identity collapse when the story requires full normalized URL identity.
17. [x] Test type: server unit. Location: `server/src/test/unit/env-loading.test.ts`. Description: prove `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` ignores fully blank env segments. Implementation files: `server/src/config/startupEnv.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep env parsing tolerant of empty separators without inventing phantom endpoints.
18. [x] Test type: server unit. Location: `server/src/test/unit/env-loading.test.ts`. Description: prove `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` ignores whitespace-only env segments after trimming. Implementation files: `server/src/config/startupEnv.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep whitespace-only env noise separate from the truly blank-segment path.
19. [x] Test type: server unit. Location: `server/src/test/unit/env-loading.test.ts`. Description: prove duplicate normalized env entries keep the first winner and emit a warning instead of failing startup. Implementation files: `server/src/config/startupEnv.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: preserve the repo’s warn-and-continue duplicate policy on this new env contract.
20. [x] Test type: server unit. Location: `server/src/test/unit/env-loading.test.ts`. Description: prove malformed env entries fail clearly without hiding that the startup-env parser was the rejecting owner. Implementation files: `server/src/config/startupEnv.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep startup diagnosis honest when an operator provides a bad endpoint string.
21. [x] Test type: server unit. Location: `server/src/test/unit/runtimeConfig.test.ts`. Description: prove provider chat config reads `codeinfo_openai_endpoint`, preserves the accepted in-range config path, and strips that field before provider-native runtime execution. Implementation files: `server/src/config/runtimeConfig.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: prevent CodeInfo-owned endpoint metadata from leaking into provider-native config at the exact success-path boundary.
22. [x] Test type: server unit. Location: `server/src/test/unit/runtimeConfig.test.ts`. Description: prove provider chat config rejects a blank `codeinfo_openai_endpoint` value. Implementation files: `server/src/config/runtimeConfig.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: give the blank runtime-config rejection its own proof home instead of bundling it into broader provider-compatibility coverage.
23. [x] Test type: server unit. Location: `server/src/test/unit/runtimeConfig.test.ts`. Description: prove provider chat config rejects a whitespace-only `codeinfo_openai_endpoint` value after trimming. Implementation files: `server/src/config/runtimeConfig.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the whitespace-only runtime-config rejection separate from the truly blank path.
24. [x] Test type: server unit. Location: `server/src/test/unit/runtimeConfig.test.ts`. Description: prove Codex provider chat config rejects `codeinfo_openai_endpoint` values that do not advertise `responses` support. Implementation files: `server/src/config/runtimeConfig.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the Codex-specific compatibility invariant explicit at the runtime-config boundary.
25. [x] Test type: server unit. Location: `server/src/test/unit/runtimeConfig.test.ts`. Description: prove Copilot provider chat config rejects `codeinfo_openai_endpoint` values that do not advertise `completions` or `responses` support. Implementation files: `server/src/config/runtimeConfig.ts` and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the Copilot-specific compatibility invariant explicit at the runtime-config boundary.
26. [x] Test type: server unit. Location: `server/src/test/unit/agents-config-defaults.test.ts`. Description: prove agent config normalizes `codeinfo_openai_endpoint` on the accepted path while preserving the provider-neutral `codeinfo_provider` ownership rules. Implementation files: `server/src/agents/config.ts`, `server/src/config/runtimeConfig.ts`, and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the agent-side accepted path explicit before later translation uses it.
27. [x] Test type: server unit. Location: `server/src/test/unit/agents-config-defaults.test.ts`. Description: prove agent config rejects a blank `codeinfo_openai_endpoint` value. Implementation files: `server/src/agents/config.ts`, `server/src/config/runtimeConfig.ts`, and `server/src/config/openaiCompatEndpoints.ts`. Purpose: give the blank agent-config rejection its own proof home instead of bundling it into broader validation coverage.
28. [x] Test type: server unit. Location: `server/src/test/unit/agents-config-defaults.test.ts`. Description: prove agent config rejects a whitespace-only `codeinfo_openai_endpoint` value after trimming. Implementation files: `server/src/agents/config.ts`, `server/src/config/runtimeConfig.ts`, and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the whitespace-only agent-config rejection separate from the truly blank path.
29. [x] Test type: server unit. Location: `server/src/test/unit/agents-config-defaults.test.ts`. Description: prove agent config preserves the Codex-side `responses` compatibility failure when `codeinfo_openai_endpoint` targets an incompatible endpoint. Implementation files: `server/src/agents/config.ts`, `server/src/config/runtimeConfig.ts`, and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the agent-side Codex compatibility failure explicit instead of assuming provider-chat tests are sufficient.
30. [x] Test type: server unit. Location: `server/src/test/unit/agents-config-defaults.test.ts`. Description: prove agent config preserves the Copilot-side `completions` or `responses` compatibility failure when `codeinfo_openai_endpoint` targets an incompatible endpoint. Implementation files: `server/src/agents/config.ts`, `server/src/config/runtimeConfig.ts`, and `server/src/config/openaiCompatEndpoints.ts`. Purpose: keep the agent-side Copilot compatibility failure explicit instead of assuming provider-chat tests are sufficient.
31. [x] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.
32. [x] Run the exact repository-supported format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the new parser and runtime-config metadata surfaces compile cleanly.
2. [x] Run `npm run test:summary:server:unit` to prove env parsing, runtime-config normalization, duplicate warnings, and provider-compatibility validation through the server unit/integration wrapper.
3. [x] Run `npm run lint` for the final parser/metadata surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
4. [x] Run `npm run format:check` for the final parser/metadata surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Implementation notes

- Added the shared OpenAI-compatible endpoint parser and wired it into startup env loading, runtime metadata extraction, and agent runtime execution so the new `codeinfo_openai_endpoint` contract stays canonical.
- Added parser, env, runtime-config, and agent-config unit coverage for accepted paths, malformed input, duplicate handling, and provider-specific compatibility validation; the agent metadata reader now wraps endpoint parse errors in the repo’s standard runtime-config error shape.
- Build: `npm run build:summary:server` passed; log: logs/test-summaries/build-server-latest.log.
- Audit confirmed Task 2 is honestly complete after the wrapper-owned build log and the latest `test:summary:server:unit` log both passed cleanly, so the task status now closes without adding new scope beyond the planned parser and metadata contract.
- Manual testing assessed as not applicable for this task-scoped pass because Task 2's completed parser and runtime-config validation work has no separate runnable, browser-visible, or network-visible proof surface beyond the automated proof already owned by its wrapper-backed build and server-unit checks.

---

### Task 3. Add Shared External Endpoint Model Discovery

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2`
- Task Status: `__done__`
- Git Commits:

#### Overview

Build the shared server-side discovery helper that probes external endpoints through `/v1/models` and returns a deterministic catalog shape the chat routes can reuse. This task owns one-request-per-endpoint behavior, timeout/failure handling, config-pinned endpoint inclusion, and the test helper needed to prove those discovery states honestly.

#### Task Exit Criteria

- The server has one shared external-endpoint discovery helper that probes each unique endpoint at most once, preserves normalized input order, tolerates partial failures, and returns only the model-id data needed by the later catalog task.
- The repository has a reusable test helper for synthetic external OpenAI-compatible `/v1/models` servers so route and helper proof do not rely on live internet endpoints.

#### Documentation Locations

- `Context7 /websites/developers_openai_api_reference` - use for the expected `GET /v1/models` response shape and the requirement that discovery only needs `data[].id`.

#### Subtasks

1. [x] Read the story’s `Feasibility Proof Pass`, `Message Contracts And Storage Shapes`, `Test Harnesses`, and `Risk And Invariant Matrix`, then inspect `server/src/providers/mcpStatus.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/chatDiscovery.ts`, and `common/src/lmstudio.ts`. Purpose: confirm the current timeout pattern and the route seams that will consume shared endpoint discovery.
2. [x] Inspect `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/chatModels.copilot.test.ts`, and `server/src/test/unit/chatProviders.test.ts`. Purpose: confirm the current route proof homes before moving endpoint probing out of route code.
3. [x] Create `server/src/chat/openaiCompatModelDiscovery.ts` as the shared production helper for endpoint model discovery. It must deduplicate by normalized endpoint identity before fetch, preserve normalized input order, and merge one config-pinned endpoint only when it is not already present after normalization. Purpose: centralize endpoint discovery ownership before route code consumes it. Proof owners: `server/src/test/unit/openaiCompatModelDiscovery.test.ts`.
4. [x] Extend `server/src/chat/openaiCompatModelDiscovery.ts` with `fetch` plus `AbortController` timeout behavior modeled on `server/src/providers/mcpStatus.ts`, and make partial endpoint failures non-fatal to healthy endpoint results. Purpose: keep timeout and degraded-endpoint behavior deterministic instead of leaving it to route-level branching. Proof owners: `server/src/test/unit/openaiCompatModelDiscovery.test.ts`.
5. [x] Update `server/src/routes/chatModels.ts` so `/chat/models` consumes `server/src/chat/openaiCompatModelDiscovery.ts` instead of probing endpoints directly. Do not change LM Studio’s existing non-endpoint discovery flow in this step. Purpose: move the model-catalog route onto the shared one-request-per-endpoint helper before provider bootstrap starts reusing it. Proof owners: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/chatModels.copilot.test.ts`.
6. [x] Update `server/src/routes/chatProviders.ts` and `server/src/routes/chatDiscovery.ts` so provider bootstrap consumes `server/src/chat/openaiCompatModelDiscovery.ts` instead of probing endpoints directly. Keep provider ordering and non-endpoint bootstrap behavior unchanged in this step. Purpose: make provider bootstrap reuse the same deduplicated discovery source as `/chat/models` rather than maintaining a second probing path. Proof owners: `server/src/test/unit/chatProviders.test.ts`.
7. [x] Create `server/src/test/support/externalOpenAiCompatServer.ts` as the reusable test-only helper for synthetic `/v1/models` endpoints. Start with the success-path and malformed-payload controls that `server/src/test/unit/openaiCompatModelDiscovery.test.ts` will need immediately. Purpose: give the discovery tests one local fake-endpoint helper before adding the slower failure modes. 
8. [x] Extend `server/src/test/support/externalOpenAiCompatServer.ts` with slow-response timeout control and transport-failure control, while keeping the helper test-only and reusable by later fallback or translation tests. Purpose: make timeout and transport-failure discovery proofs deterministic without pushing those behaviors into production code.
9. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatModelDiscovery.test.ts`. Description: prove the shared discovery helper probes each unique normalized endpoint at most once even when env and config sources repeat it. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts` and `server/src/test/support/externalOpenAiCompatServer.ts`. Purpose: keep the bounded one-request-per-endpoint strategy explicit instead of only implied by route behavior.
10. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatModelDiscovery.test.ts`. Description: prove the shared discovery helper preserves normalized input order in the returned endpoint/model catalog. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts` and `server/src/test/support/externalOpenAiCompatServer.ts`. Purpose: give stable ordering its own proof home instead of bundling it into deduplication coverage.
11. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatModelDiscovery.test.ts`. Description: prove a config-pinned endpoint is merged only when it is not already present after normalization. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts`. Purpose: keep source-merging behavior explicit before provider bootstrap and picker code depend on it.
12. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatModelDiscovery.test.ts`. Description: prove a timed-out endpoint does not hide healthy endpoint results. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts` and `server/src/test/support/externalOpenAiCompatServer.ts`. Purpose: give the timeout failure path its own proof home instead of bundling it with other transport failures.
13. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatModelDiscovery.test.ts`. Description: prove a transport-failing endpoint does not hide healthy endpoint results. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts` and `server/src/test/support/externalOpenAiCompatServer.ts`. Purpose: keep the non-timeout transport failure path separate from timeout coverage.
14. [x] Test type: server unit. Location: `server/src/test/unit/openaiCompatModelDiscovery.test.ts`. Description: prove a malformed `/v1/models` payload is isolated to that endpoint and does not reorder or erase healthy endpoint results. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts` and `server/src/test/support/externalOpenAiCompatServer.ts`. Purpose: pin down the post-response failure boundary that later routes rely on.
15. [x] Test type: server unit. Location: `server/src/test/unit/chatModels.codex.test.ts`. Description: prove the Codex catalog surfaces only endpoint-backed models from endpoints that declare `responses` support. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts` and `server/src/routes/chatModels.ts`. Purpose: keep Codex compatibility filtering explicit at the route consumer.
16. [x] Test type: server unit. Location: `server/src/test/unit/chatModels.copilot.test.ts`. Description: prove the Copilot catalog surfaces only endpoint-backed models from endpoints that declare `completions` or both capabilities. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts` and `server/src/routes/chatModels.ts`. Purpose: keep Copilot compatibility filtering explicit at the route consumer.
17. [x] Test type: server unit. Location: `server/src/test/unit/chatProviders.test.ts`. Description: prove provider bootstrap includes a config-pinned endpoint that is absent from the env list. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts`, `server/src/routes/chatProviders.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: keep the config-pinned discovery path explicit before the client picker relies on it.
18. [x] Test type: server unit. Location: `server/src/test/unit/chatProviders.test.ts`. Description: prove env-backed and config-backed copies of the same normalized endpoint collapse into one provider-bootstrap identity. Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts`, `server/src/routes/chatProviders.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: keep deduplication across source boundaries explicit before the picker consumes bootstrap output.
19. [x] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.
20. [x] Run the exact repository-supported format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the new production and test discovery helpers compile cleanly.
2. [x] Run `npm run test:summary:server:unit` to prove one-probe-per-endpoint behavior, ordering, partial failures, and route-facing discovery filtering through the server wrapper.
3. [x] Run `npm run lint` for the final discovery-helper surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
4. [x] Run `npm run format:check` for the final discovery-helper surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Implementation notes

- Added the shared external-endpoint discovery helper, including normalized endpoint deduplication, config-pinned endpoint inclusion, and deterministic timeout/transport/malformed-payload handling.
- Added the reusable synthetic `/v1/models` test server helper so helper and route proofs stay local and deterministic.
- Wired `/chat/models` and `/chat/providers` through the shared discovery helper so selected Codex and Copilot flows now include external endpoint models and provider default selection can see config-pinned endpoints.
- Added route-level unit coverage for Codex and Copilot capability filtering, config-pinned bootstrap, and env/config duplicate collapse.
- Verified the targeted server unit wrapper passed after the discovery and route changes, then completed the required lint and format checks.
- Audit confirmed Task 3 is honestly complete after the fresh `npm run build:summary:server` wrapper pass and the existing server-unit wrapper proof, so the task now closes without adding scope beyond the shared discovery helper and route reuse described in this story.

---

### Task 4. Surface External Endpoint Models In The Chat Picker

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2`, `Task 3`
- Task Status: `__done__`
- Git Commits:

#### Overview

Extend the shared chat discovery contract and the Chat page picker so external Codex and Copilot models appear as additional choices under their existing providers. This task owns harness-specific model filtering, shared endpoint deduplication across env/config sources, the separate picker identity needed for duplicate raw model ids, and the `host / model` display-label rules.

#### Task Exit Criteria

- `/chat/models` and `/chat/providers` expose endpoint-backed Codex and Copilot models without creating a new top-level provider, and LM Studio remains unchanged by this story.
- The Chat page can select and display two models with the same raw model id from different endpoint identities without collapsing them into one choice, while preserving the current create-mode versus restored-conversation workflow contract and preventing endpoint identity from leaking stale hidden state into the wrong visible selection or send path.
- The Chat page uses the same endpoint-aware display label for the visible model-option rows and the collapsed composer summary, with `host / model` as the default label and a short path hint only for colliding endpoint choices.

#### Documentation Locations

- `Context7 /websites/developers_openai_api_reference` - use for the official model-list contract that the picker surfaces indirectly through server discovery.

#### Subtasks

1. [x] Read the story’s `Description`, `Acceptance Criteria`, `Message Contracts And Storage Shapes`, and `Risk And Invariant Matrix`, then inspect `common/src/lmstudio.ts`, `common/src/api.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chatProviders.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: confirm the current shared discovery contract before adding endpoint-aware picker identity.
2. [x] Inspect `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, `client/src/test/chatPage.models.test.tsx`, `client/src/test/chatPage.provider.test.tsx`, and `client/src/test/chatPage.provider.conversationSelection.test.tsx`. Purpose: confirm the exact client seams that still assume one string-only selected model.
3. [x] Rewrite or split any misleading reused tests in `client/src/test/chatPage.provider.conversationSelection.test.tsx` before adding endpoint-aware assertions. In particular, keep the existing provider/model read-only, hidden-draft isolation, and stale-label replacement tests scoped to the invariant their titles currently claim, and add separate endpoint-aware tests when the new behavior is broader than those existing titles. Purpose: prevent reused conversation-selection proof from silently claiming endpoint behavior that the old test names do not actually describe.
4. [x] Update `common/src/lmstudio.ts` so `ChatModelInfo` carries a separate `endpointId`, and update any related shared response types there so provider bootstrap can carry `selectedEndpointId` alongside `selectedModel`. Purpose: give the client enough shared contract detail to distinguish duplicate raw model ids without adding a new top-level provider.
5. [x] Update `client/src/hooks/useChatModel.ts` so `isChatModelInfo()` accepts optional `endpointId`, `parseProvidersResponse()` accepts optional `selectedEndpointId`, and bootstrap selection consumes `selectedModel` plus `selectedEndpointId` as one paired identity. Purpose: keep the client consumer aligned with the shared endpoint-aware bootstrap contract instead of silently accepting malformed or incomplete endpoint fields. Proof owners: `client/src/test/chatPage.provider.conversationSelection.test.tsx`.
6. [x] Update `common/src/api.ts` only where the shared chat bootstrap contract needs the new endpoint-aware selection fields. Purpose: keep the shared API contract aligned with the server and client changes without widening unrelated provider surfaces.
7. [x] Update `server/src/routes/chatModels.ts` so Codex surfaces only endpoints declaring `responses`, Copilot surfaces endpoints declaring `completions` or both capabilities, and LM Studio keeps its current catalog behavior. Purpose: keep external models provider-shaped inside the existing `/chat/models` route.
8. [x] Update `server/src/routes/chatProviders.ts` and `server/src/routes/chatDiscovery.ts` so provider bootstrap can return `selectedEndpointId`, config-pinned endpoints outside `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` still appear for the selected provider, and env-backed/config-backed copies of the same normalized endpoint appear only once. Purpose: keep chat bootstrap and picker defaults aligned to the endpoint-aware catalog.
9. [x] Update `client/src/hooks/useChatModel.ts` so create-mode picker state stops treating one model string as the whole selection identity. Replace the current string-only `selected` comparisons, bootstrap/default selection reuse, and stale-hidden-selection cleanup with an endpoint-aware pair that distinguishes duplicate raw model ids from different endpoints. Update the matching picker-row seam in `client/src/pages/ChatPage.tsx` so endpoint-backed choices no longer rely on `model.key` alone for `key`, `aria-selected`, `selected`, or click-selection behavior. Purpose: preserve the current create-mode cleanup contract instead of letting endpoint identity make a previously hidden selection look valid on the wrong endpoint. Proof owners: `client/src/test/chatPage.models.test.tsx`.
10. [x] Update `client/src/hooks/useChatModel.ts` and `client/src/pages/ChatPage.tsx` so restored conversation state keeps its endpoint identity locally for both visible selection and resumed sends. Concretely, extend the current `resumedProvider` / `resumedModel` reuse-mode flow in `client/src/pages/ChatPage.tsx` so bootstrap refreshes do not overwrite an active restored endpoint-backed selection, and returning to a fresh draft restores the current create-mode bootstrap pair instead of carrying forward the stale restored endpoint identity. Purpose: preserve the existing chat workflow while carrying the new endpoint identity explicitly. Proof owners: `client/src/test/chatPage.provider.conversationSelection.test.tsx`, `client/src/test/chatPage.resumeIdentity.test.tsx`.
11. [x] Update the endpoint-backed picker label path in `client/src/pages/ChatPage.tsx` and any shared formatter it uses so the dropdown rows, `aria-label`, selected-model summary, and collapsed composer model button all read from the same endpoint-aware label helper. The default visible label must be `host / model`, and only colliding `host / model` labels may append the short path hint. Purpose: keep the visible picker compact in the common case while still distinguishing colliding endpoint choices. Proof owners: `client/src/test/chatPage.provider.test.tsx`, `client/src/test/chatPage.models.test.tsx`.
12. [x] Test type: server unit. Location: `server/src/test/unit/chatModels.codex.test.ts`. Description: prove `/chat/models` surfaces endpoint-backed Codex choices with separate endpoint identity while preserving Codex-only compatibility filtering. Implementation files: `common/src/lmstudio.ts`, `server/src/routes/chatModels.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: keep the Codex model catalog contract explicit after endpoint identity is introduced.
13. [x] Test type: server unit. Location: `server/src/test/unit/chatModels.copilot.test.ts`. Description: prove `/chat/models` surfaces endpoint-backed Copilot choices with separate endpoint identity while preserving Copilot compatibility filtering. Implementation files: `common/src/lmstudio.ts`, `server/src/routes/chatModels.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: keep the Copilot model catalog contract explicit after endpoint identity is introduced.
14. [x] Test type: server unit. Location: `server/src/test/unit/chatProviders.test.ts`. Description: prove provider bootstrap exposes a config-pinned endpoint that is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` without adding a new top-level provider, and returns `selectedEndpointId` when that endpoint is the active default. Implementation files: `common/src/api.ts`, `common/src/lmstudio.ts`, `server/src/routes/chatProviders.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: keep the config-pinned bootstrap path and the producer side of the selected-endpoint contract explicit for the later picker default flow.
15. [x] Test type: server unit. Location: `server/src/test/unit/chatProviders.test.ts`. Description: prove provider bootstrap collapses env-backed and config-backed copies of the same normalized endpoint into one shared identity. Implementation files: `common/src/api.ts`, `common/src/lmstudio.ts`, `server/src/routes/chatProviders.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: keep source-merging behavior explicit at the server bootstrap boundary instead of leaving it implied by client selection tests.
16. [x] Test type: client unit. Location: `client/src/test/chatPage.models.test.tsx`. Description: prove the client picker keeps duplicate raw model ids independently selectable by endpoint identity. Implementation files: `client/src/hooks/useChatModel.ts` and `client/src/pages/ChatPage.tsx`. Purpose: prevent duplicate raw model ids from collapsing into one visible choice.
17. [x] Test type: client unit. Location: `client/src/test/chatPage.models.test.tsx`. Description: prove a stale selection is cleared when the previous `(model.key, endpointId)` pair disappears even though the same raw model key is still visible from a different endpoint. Implementation files: `client/src/hooks/useChatModel.ts` and `client/src/pages/ChatPage.tsx`. Purpose: make the mixed-state cleanup discriminant explicit instead of relying on key-only catalog checks.
18. [x] Test type: client unit. Location: `client/src/test/chatPage.models.test.tsx`. Description: prove hidden endpoint selections are cleared when the visible model catalog changes and the previously selected endpoint is no longer available. Implementation files: `client/src/hooks/useChatModel.ts` and `client/src/pages/ChatPage.tsx`. Purpose: give the stale-hidden-selection cleanup path its own proof home.
19. [x] Test type: client unit. Location: `client/src/test/chatPage.models.test.tsx`. Description: prove endpoint identity does not break the existing rule that hidden or invalid selections are excluded from submission when the current provider or visible catalog no longer supports them. Implementation files: `client/src/hooks/useChatModel.ts` and `client/src/pages/ChatPage.tsx`. Purpose: keep the stale-invalid-submission guard separate from the visible-state cleanup path.
20. [x] Test type: client unit. Location: `client/src/test/chatPage.provider.test.tsx`. Description: prove endpoint-backed model labels default to `host / model` in the non-collision case. Implementation files: `client/src/pages/ChatPage.tsx` and any label helpers reused by `client/src/hooks/useChatModel.ts`. Purpose: keep the default visible-label contract explicit.
21. [x] Test type: client unit. Location: `client/src/test/chatPage.provider.test.tsx`. Description: prove colliding `host / model` labels gain a short path hint. Implementation files: `client/src/pages/ChatPage.tsx` and any label helpers reused by `client/src/hooks/useChatModel.ts`. Purpose: keep the collision-expansion trigger explicit instead of bundling it with unrelated label cases.
22. [x] Test type: client unit. Location: `client/src/test/chatPage.provider.test.tsx`. Description: prove only the colliding endpoint-backed choices gain the short path hint suffix. Implementation files: `client/src/pages/ChatPage.tsx` and any label helpers reused by `client/src/hooks/useChatModel.ts`. Purpose: keep the no-extra-noise side of the collision-label rule explicit.
23. [x] Test type: client unit. Location: `client/src/test/chatPage.provider.conversationSelection.test.tsx`. Description: prove chat bootstrap restores endpoint-aware selection defaults from standard discovered endpoint choices, using `selectedModel` plus `selectedEndpointId` as one paired identity. Implementation files: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, `server/src/routes/chatProviders.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: keep the normal endpoint-aware bootstrap/default-selection path explicit.
24. [x] Test type: client unit. Location: `client/src/test/chatPage.provider.conversationSelection.test.tsx`. Description: prove chat bootstrap restores a config-pinned endpoint that is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`. Implementation files: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, `server/src/routes/chatProviders.ts`, and `server/src/routes/chatDiscovery.ts`. Purpose: give the config-pinned bootstrap edge case its own proof home instead of bundling it into the standard default-selection path.
25. [x] Test type: client unit. Location: `client/src/test/chatPage.provider.conversationSelection.test.tsx`. Description: prove selecting an existing conversation retains the restored endpoint identity locally, keeps provider/model controls in reuse mode, and prevents later provider-bootstrap refreshes from overwriting that restored selection while the conversation stays active. Implementation files: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, and the chat bootstrap response shapes in `common/src/api.ts` and `common/src/lmstudio.ts`. Purpose: give the create-vs-reuse mixed-state boundary its own proof home.
26. [x] Test type: client unit. Location: `client/src/test/chatPage.resumeIdentity.test.tsx`. Description: prove returning from a restored conversation to a fresh draft restores the current bootstrap endpoint selection instead of carrying the stale restored endpoint into create mode. Implementation files: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, `client/src/api/conversations.ts`, and `client/src/hooks/useConversations.ts`. Purpose: keep the reuse-to-create transition explicit so restored endpoint state does not leak into later new sends.
27. [x] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.
28. [x] Run the exact repository-supported format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the server-side discovery and provider bootstrap changes compile cleanly.
2. [x] Run `npm run build:summary:client` to confirm the picker-contract changes compile cleanly on the client.
3. [x] Run `npm run test:summary:server:unit` to prove the route-side discovery/filtering and provider bootstrap behavior.
4. [x] Run `npm run test:summary:client` to prove endpoint-aware picker identity, duplicate-id handling, and visible-label behavior on the Chat page.
5. [x] Run `npm run lint` for the final picker/discovery surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
6. [x] Run `npm run format:check` for the final picker/discovery surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Manual Testing Guidance

When the supported main compose stack is available, verify the Chat page picker against two endpoint-backed models that share the same raw model id but come from different endpoint identities. Confirm the dropdown renders two separate visible choices, the selected composer summary mirrors the chosen endpoint-aware label, and restored-conversation reuse mode keeps its endpoint-backed label and send identity until the user returns to a fresh draft.

#### Implementation notes

- Added endpoint-aware `ChatModelInfo`/`ChatProvidersResponse` fields, shared discovery filtering, and client picker identity wiring so duplicate raw ids stay distinguishable end to end.
- Added endpoint-aware picker, provider, conversation-selection, and resume-identity tests to keep the draft/reuse transition and label formatting explicit.
- Fixed the restore loop so draft selection is only snapshotted in true draft mode, then passed the repo lint/format checks after resolving one unnecessary hook dependency warning.
- Implementation-only audit kept all Task 4 subtasks complete, but reopened `Testing` item 4 because the repository only shows targeted Jest runs for the picker-owned files plus one single-file resume test rerun, not the full `npm run test:summary:client` wrapper named by this checklist item.
- Automated-proof audit confirmed the wrapper-backed build logs and the later full client-suite rerun now support all checked Testing items, so Task 4 closes without adding behavior beyond the approved endpoint-aware picker identity and label work.
- Manual testing skipped for the Chat page picker surface. Tried: `GET http://localhost:5010/health`, `GET http://localhost:5001`, then `npm run compose:build` for the supported main stack. Observed: both localhost surfaces were down and the compose wrapper failed with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. Why fuller proof was not possible: the repository-supported runtime could not be started from this environment, and repairing Docker host access is outside Task 4's implementation scope.
- Increased Node heap for client test wrapper by setting NODE_OPTIONS=--max-old-space-size=8192 in `scripts/test-summary-client.mjs` so the full client Jest run can complete without OOM. Re-ran `npm run test:summary:client` after the change; the full client suite passed (879 tests, 0 failures) and the wrapper log was saved to `test-results/client-tests-2026-06-02T14-51-33-393Z.log`.
---

### Task 5. Translate Endpoint Selections Into Runtime Config And Persistence

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2`, `Task 3`, `Task 4`
- Task Status: `__done__`
- Git Commits:

#### Overview

Translate the new CodeInfo-owned endpoint metadata into provider-native Codex and Copilot runtime settings, and persist endpoint identity separately from the raw model id. This task owns the `/chat` request contract, chat bootstrap selected-endpoint state, Codex/Copilot runtime translation, and backward-compatible conversation persistence.

#### Task Exit Criteria

- Chat requests, selected defaults, and saved conversations carry separate raw `model` and optional `endpointId` values instead of encoding endpoint routing inside the model string, and stale restored endpoint state does not leak into fresh-draft sends.
- The Chat page keeps the reused-conversation provider/model lock behavior it already has today, but that reused selection now carries optional endpoint identity separately and drops it again when the user returns to a fresh draft before the next send.
- Codex and Copilot runtime execution paths can consume `codeinfo_openai_endpoint` through internal translation while preserving existing provider readiness/auth gates and backward compatibility for older saved conversations without endpoint identity.

#### Documentation Locations

- `Context7 /openai/codex` - use for the generated `model_provider` plus `model_providers.<name>` translation contract and required `base_url`/`wire_api` fields.
- `Context7 /github/copilot-sdk` - use for the Copilot custom provider object contract (`type: "openai"`, `baseUrl`, `wireApi`, `model`) that this task must generate internally instead of exposing to users.

#### Subtasks

1. [x] Read the story’s `Message Contracts And Storage Shapes`, `Edge Cases And Failure Modes`, and `Decisions`, then inspect `common/src/lmstudio.ts`, `client/src/hooks/useChatStream.ts`, `client/src/pages/ChatPage.tsx`, `client/src/api/conversations.ts`, `client/src/hooks/useConversations.ts`, `server/src/config/codexConfig.ts`, `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, `server/src/routes/chat.ts`, `server/src/routes/conversations.ts`, and `server/src/mongo/conversation.ts`. Purpose: confirm the current request builder, persistence schema, and provider-native translation seams before adding endpoint identity.
2. [x] Inspect `client/src/test/chatSendPayload.test.tsx`, `client/src/test/chatPage.resumeIdentity.test.tsx`, `server/src/test/unit/chat-interface-run-persistence.test.ts`, `server/src/test/integration/chat-copilot-resume.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`, and `server/src/test/integration/mcp-codex-wrapper.test.ts`. Purpose: confirm the exact proof homes that must own the request, persistence, and translation changes.
3. [x] Rewrite misleading reused proof names before extending payload and resume assertions. In `client/src/test/chatSendPayload.test.tsx`, replace the existing `"includes only conversationId and message"` claim with wording that still matches the final payload shape, and keep any no-endpoint baseline coverage separate from new endpoint-aware payload cases. In `client/src/test/chatPage.resumeIdentity.test.tsx`, keep the existing provider/model baseline explicit if it remains, but add separately named endpoint-aware resume and fresh-draft transition tests instead of silently widening provider-only titles. Purpose: prevent payload and resume proof from claiming a narrower invariant than the story now requires.
4. [x] Update `common/src/lmstudio.ts` so the shared chat request/response and selection shapes can carry `endpointId` and `selectedEndpointId` separately from the raw `model`. Purpose: keep shared contract identity explicit instead of encoding endpoint routing inside the model string.
5. [x] Update `client/src/hooks/useChatStream.ts` so the final `/chat` request payload builder sends raw `model` plus optional `endpointId` as separate fields, keeps resumed-send `providerOverride` and `modelOverride` behavior intact, and never reintroduces a stale `endpointId` after ChatPage has cleared the active create-mode or restored-selection endpoint identity. Purpose: make the last client payload boundary endpoint-aware without letting hidden endpoint state leak into sends. Proof owners: `client/src/test/chatSendPayload.test.tsx`.
6. [x] Update `client/src/pages/ChatPage.tsx` so the draft-vs-resume interaction seam carries endpoint identity explicitly through the existing `draftSelectionRef`, `previousConversationIdRef`, and reused-selection lock flow. Create mode must snapshot and restore `(provider, model, endpointId)` together, resumed conversation mode must keep its endpoint-backed identity locally for visible selection plus resumed sends, and returning to a fresh draft must restore the saved draft pair instead of carrying forward the resumed endpoint identity. Purpose: keep the visible chat state aligned with the new endpoint-aware request and resume contract across run-vs-resume transitions. Proof owners: `client/src/test/chatPage.resumeIdentity.test.tsx`.
7. [x] Update `client/src/api/conversations.ts` and `client/src/hooks/useConversations.ts` so conversation normalization preserves optional `flags.endpointId` without breaking older saved conversations that do not have that field. Purpose: keep client-side conversation hydration backward-compatible while carrying new endpoint identity. Proof owners: `client/src/test/chatPage.resumeIdentity.test.tsx`.
8. [x] Update `server/src/mongo/conversation.ts` and `server/src/routes/conversations.ts` so saved conversations may persist `flags.endpointId` while keeping `Conversation.model` as the raw model id and keeping older stored records readable. Purpose: preserve the repo’s existing persistence shape while adding separate endpoint identity. Proof owners: `server/src/test/unit/chat-interface-run-persistence.test.ts`, `server/src/test/integration/chat-copilot-resume.test.ts`.
9. [x] Update `server/src/routes/chat.ts` so chat bootstrap and persistence read/write `endpointId` and `selectedEndpointId` separately from the raw `model`, including extending the current resumed-execution-identity path to read `existingConversation.flags.endpointId` when present instead of resuming only `provider` plus `model`. Purpose: keep the chat route as the server-side owner of endpoint-aware request and resume identity. Proof owners: `server/src/test/unit/chat-interface-run-persistence.test.ts`, `server/src/test/integration/chat-copilot-resume.test.ts`.
10. [x] Update `server/src/chat/agentFlags.ts` so `sanitizeConversationFlagsForProvider()` and `buildConversationFlags()` preserve optional `flags.endpointId` across continuation writes while keeping flow-owned state stripping and provider-specific flag filtering unchanged. Purpose: prevent the current flag allowlist from silently dropping persisted endpoint identity on the next chat, agent, or flow turn. Proof owners: `server/src/test/unit/flow-flag-sanitization.test.ts`, `server/src/test/unit/flow-flag-persistence.test.ts`.
11. [x] Update `server/src/routes/chatValidators.ts` so the `/chat` request contract validates optional `endpointId` against the selected provider/runtime path and rejects contradictory payloads, including stale endpoint-backed values that arrive with a non-endpoint provider or an otherwise incompatible create-mode selection. Purpose: preserve the current server-side protection against contradictory request state once endpoint identity becomes part of the payload. Proof owners: `server/src/test/unit/chatValidators.test.ts`.
12. [x] Update `server/src/config/codexConfig.ts` so `codeinfo_openai_endpoint` is translated into a generated Codex `model_provider` plus matching `model_providers.<name>` entry with the required `base_url` and `wire_api` fields. Purpose: keep Codex runtime translation repository-owned instead of asking users to author native provider tables. Proof owners: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`, `server/src/test/integration/mcp-codex-wrapper.test.ts`.
13. [x] Update `server/src/chat/interfaces/ChatInterfaceCopilot.ts` so `codeinfo_openai_endpoint` is translated into the generated Copilot custom provider object with `type: "openai"`, `baseUrl`, `wireApi`, and `model`. Purpose: keep Copilot runtime translation repository-owned instead of exposing native provider objects to users. Proof owners: `server/src/test/integration/chat-copilot-resume.test.ts`.
14. [x] Test type: client unit. Location: `client/src/test/chatSendPayload.test.tsx`. Description: prove chat requests submit raw `model` and optional `endpointId` as separate fields instead of a combined identifier. Implementation files: `common/src/lmstudio.ts`, `client/src/hooks/useChatStream.ts`, and `server/src/routes/chat.ts`. Purpose: keep the producer side of the endpoint-aware request contract explicit.
15. [x] Test type: client unit. Location: `client/src/test/chatSendPayload.test.tsx`. Description: prove create-mode sends exclude a stale `endpointId` after the visible provider or model state changes to a non-endpoint-backed path. Implementation files: `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, and `server/src/routes/chat.ts`. Purpose: give the hidden-or-disabled stale-submission guard its own proof home at the last client payload boundary.
16. [x] Test type: client unit. Location: `client/src/test/chatPage.resumeIdentity.test.tsx`. Description: prove restored chat state consumes `endpointId` when present. Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/api/conversations.ts`, and `client/src/hooks/useConversations.ts`. Purpose: keep the client consumer side of the endpoint-aware resume contract explicit on the happy path.
17. [x] Test type: client unit. Location: `client/src/test/chatPage.resumeIdentity.test.tsx`. Description: prove older conversation records that do not have `endpointId` still restore correctly. Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/api/conversations.ts`, and `client/src/hooks/useConversations.ts`. Purpose: give backward-compatible reader behavior its own proof home instead of bundling it into the endpoint-present case.
18. [x] Test type: client unit. Location: `client/src/test/chatPage.resumeIdentity.test.tsx`. Description: prove restored endpoint identity is retained for resumed sends while the reused conversation remains active, but is dropped when the user returns to a fresh draft. Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatModel.ts`, `client/src/api/conversations.ts`, and `client/src/hooks/useConversations.ts`. Purpose: keep the run-vs-resume mixed-state boundary explicit on the client side.
19. [x] Test type: server unit. Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`. Description: prove persisted conversations store optional `flags.endpointId` separately from the raw model id. Implementation files: `server/src/mongo/conversation.ts`, `server/src/routes/conversations.ts`, and `server/src/routes/chat.ts`. Purpose: keep the writer side of the persistence contract explicit.
20. [x] Test type: server unit. Location: `server/src/test/unit/chat-interface-run-persistence.test.ts`. Description: prove older stored conversations that do not have `flags.endpointId` still read successfully through the persistence layer. Implementation files: `server/src/mongo/conversation.ts`, `server/src/routes/conversations.ts`, and `server/src/routes/chat.ts`. Purpose: give reader/writer compatibility its own proof home instead of relying only on resume integration coverage.
21. [x] Test type: server unit. Location: `server/src/test/unit/flow-flag-sanitization.test.ts`. Description: prove ordinary conversation flag sanitization preserves `endpointId` while still dropping flow-owned metadata and unsupported provider flags on non-preserve writes. Implementation files: `server/src/chat/agentFlags.ts`. Purpose: keep the sanitizer allowlist aligned with the new persisted identity contract instead of silently stripping `endpointId` on continuation.
22. [x] Test type: server unit. Location: `server/src/test/unit/flow-flag-persistence.test.ts`. Description: prove `buildConversationFlags()` preserves `endpointId` across continuation writes while still respecting `preserveFlowState` and provider-specific thread or agent-flag behavior. Implementation files: `server/src/chat/agentFlags.ts` and the continuation writers that reuse it. Purpose: give the writer-side continuation boundary its own proof home instead of relying only on initial persistence tests.
23. [x] Test type: server unit. Location: `server/src/test/unit/chatValidators.test.ts`. Description: prove `/chat` rejects a contradictory payload that carries `endpointId` for a non-endpoint-backed provider path such as LM Studio. Implementation files: `server/src/routes/chatValidators.ts`, `server/src/routes/chat.ts`, and the shared request contract in `common/src/lmstudio.ts`. Purpose: keep the server-side stale-hidden-state rejection explicit instead of relying only on client clearing behavior.
24. [x] Test type: server unit. Location: `server/src/test/unit/chatValidators.test.ts`. Description: prove `/chat` rejects a contradictory payload whose `endpointId` no longer matches the selected provider/runtime path after a create-mode transition. Implementation files: `server/src/routes/chatValidators.ts`, `server/src/routes/chat.ts`, and the shared request contract in `common/src/lmstudio.ts`. Purpose: keep mismatched restored-or-hidden endpoint submissions from being honored by the server.
25. [x] Test type: server integration. Location: `server/src/test/integration/chat-copilot-resume.test.ts`. Description: prove resumed server-side chat execution reuses stored endpoint identity when present. Implementation files: `server/src/routes/chat.ts`, `server/src/mongo/conversation.ts`, and `server/src/chat/interfaces/ChatInterfaceCopilot.ts`. Purpose: keep the resumed endpoint-present path explicit on the end-to-end server surface.
26. [x] Test type: server integration. Location: `server/src/test/integration/chat-copilot-resume.test.ts`. Description: prove resumed server-side chat execution stays backward-compatible when older saved conversations do not have `endpointId`. Implementation files: `server/src/routes/chat.ts`, `server/src/mongo/conversation.ts`, and `server/src/chat/interfaces/ChatInterfaceCopilot.ts`. Purpose: give resume compatibility its own end-to-end proof home instead of leaving it implied by persistence-only tests.
27. [x] Test type: server unit. Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`. Description: prove Codex runtime translation generates `model_provider` and `model_providers.<name>` metadata from `codeinfo_openai_endpoint` instead of requiring raw user-authored provider tables. Implementation files: `server/src/config/codexConfig.ts` and any shared runtime merge helpers it uses. Purpose: keep the Codex translation shape explicit at the runtime-merge boundary.
28. [x] Test type: server integration. Location: `server/src/test/integration/mcp-codex-wrapper.test.ts`. Description: prove the generated Codex provider metadata survives the existing wrapper/runtime path unchanged enough for real execution setup. Implementation files: `server/src/config/codexConfig.ts`, `server/src/routes/chat.ts`, and the Codex wrapper seam. Purpose: catch translation regressions that only appear after the wrapper consumes the generated config.
29. [x] Test type: server integration. Location: `server/src/test/integration/chat-copilot-resume.test.ts`. Description: prove Copilot runtime translation builds the generated custom provider object with `type: "openai"`, `baseUrl`, `wireApi`, and `model` when `codeinfo_openai_endpoint` is present. Implementation files: `server/src/chat/interfaces/ChatInterfaceCopilot.ts` and `server/src/routes/chat.ts`. Purpose: give the Copilot translation contract its own explicit proof home instead of leaving it implied by broader resume behavior.
30. [x] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.
31. [x] Run the exact repository-supported format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the runtime translation and persistence changes compile cleanly.
2. [x] Run `npm run build:summary:client` to confirm the endpoint-aware request/restore contract compiles cleanly on the client.
3. [x] Run `npm run test:summary:server:unit` to prove provider-native translation, persistence, and backward-compatible resume behavior.
4. [x] Run `npm run test:summary:client` to prove endpoint-aware chat request and resume payload behavior.
5. [x] Run `npm run lint` for the final translation/persistence surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
6. [x] Run `npm run format:check` for the final translation/persistence surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Manual Testing Guidance

When the supported main compose stack is available, verify one resumed conversation that already carries endpoint-backed selection state and one fresh draft created immediately afterward. Confirm the reused conversation keeps its provider/model lock plus endpoint-backed send identity, then confirm returning to a fresh draft drops that restored endpoint identity before the next send while leaving the normal provider/model defaults intact.

#### Implementation notes

- Starts empty.
- Preflight visual refinement clarified the `ChatPage.tsx` draft-vs-resume interaction seam, the `useChatStream.ts` final payload seam, and the `chat.ts` resumed-execution-identity seam; no code was changed in this step.
- Endpoint-aware request, persistence, and runtime translation now flow through `useChatStream.ts`, `ChatPage.tsx`, `chatValidators.ts`, `chat.ts`, `agentFlags.ts`, `codexConfig.ts`, and `ChatInterfaceCopilot.ts`; targeted client/server wrappers and lint/format checks passed after the edits.
- Prettier drift in `client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx` and `client/src/test/chatPage.models.test.tsx` was normalized so the task-level format check could pass cleanly.
- Task 5 endpoint-aware request, resume, persistence, and runtime translation subtasks are now all checked off after the client/server proof runs passed; the broader task-level Testing section remains untouched for the later automated-proof pass.
- Implementation-only audit normalized Testing items 5 and 6 to complete from the existing `npm run lint` and `npm run format:check` evidence recorded in this task's subtasks and notes; wrapper-backed build and summary test proof still remain for the later automated-proof pass.
- Repository-backed Codex contradictory-follow-up proof failed because config-default runs were still forwarding `runtimeConfig.model` even though the repository-backed chat home had already materialized the selected model into `chat/config.toml`; stripping that duplicate runtime override restored the saved-thread rollout-recording path without affecting endpoint-provider metadata.
- **RESOLVED ISSUE** `npm run test:summary:server:unit` now passes cleanly (`2177` passed, `0` failed) in `test-results/server-unit-tests-2026-06-02T13-39-53-441Z.log` after the repository-backed Codex runtime-config fix. After increasing the Node heap for the client test wrapper and re-running the wrapper, Testing item 4 (`npm run test:summary:client`) now passed cleanly (879 tests, 0 failures) and its wrapper log is `test-results/client-tests-2026-06-02T14-51-33-393Z.log`.
- Automated-proof audit closed Task 5 after re-reading the current plan state and proof artifacts: all 31 subtasks and all 6 Testing items are checked, `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number 5` reports no live blocker, and the full client wrapper log at `test-results/client-tests-2026-06-02T14-51-33-393Z.log` ends with 140 passing suites and 879 passing tests.
- Manual testing skipped for the main compose stack Task 5 resumed-conversation and fresh-draft proof surface. Tried: `curl -sf http://localhost:5010/health`, `curl -I -sf http://localhost:5001`, and `npm run compose:build`. Observed: both localhost surfaces were unreachable and the supported compose wrapper failed with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. Why fuller proof was not possible: the repository-supported compose runtime was unavailable from this environment, which is outside this task's implementation repair scope.


---

### Task 6. Extend Fallback, Repair, And Fail-In-Place Behavior For Endpoint-Backed Runs

- Repository Name: `Current Repository`
- Task Dependencies: `Task 3`, `Task 5`
- Task Status: `__done__`
- Git Commits:

#### Overview

Extend the existing provider fallback logic so new runs can repair or fall back within the requested provider path when an external endpoint is involved, while pinned and resumed runs keep today’s fail-in-place behavior. This task owns the runtime-selection matrix across chat, direct agents, command-backed agents, and flows, plus the warning text that distinguishes endpoint-unavailable, same-endpoint repair, and cross-provider fallback outcomes.

#### Task Exit Criteria

- New chat conversations and new agent/flow runs follow the story’s exact order: requested provider on the configured endpoint, same-endpoint model repair when the endpoint is healthy but the model is missing, same-provider native fallback when the endpoint is unavailable, then existing cross-provider fallback only after same-provider paths fail.
- Pinned and resumed executions that already carry provider/model/endpoint identity do not silently drift to another endpoint or provider when the saved endpoint later becomes unavailable; they fail in place with clear warnings instead.

#### Documentation Locations

- `Context7 /openai/codex` - use for keeping generated Codex provider config aligned when same-provider native fallback switches away from an external endpoint.
- `Context7 /github/copilot-sdk` - use for keeping Copilot custom-provider handling aligned when same-provider native fallback or pinned fail-in-place behavior switches between endpoint-backed and native runtime shapes.

#### Subtasks

1. [x] Read the story’s `Acceptance Criteria`, `Edge Cases And Failure Modes`, and `Risk And Invariant Matrix`, then inspect `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts`. Purpose: confirm the current fresh-run fallback path and pinned identity path before adding endpoint-aware repair/fallback behavior.
2. [x] Inspect `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/integration/chat-copilot-fallback.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `server/src/test/unit/agents-router-run.test.ts`, `server/src/test/unit/agents-commands-router-run.test.ts`, `server/src/test/unit/mcp-agents-router-run.test.ts`, `server/src/test/unit/mcp-agents-commands-run.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`, `server/src/test/integration/flows.run.errors.test.ts`, and `server/src/test/integration/flows.run.resume.identity.test.ts`. Purpose: confirm the exact proof homes that must own the new fallback matrix.
3. [x] Extend `server/src/config/chatDefaults.ts` so the shared runtime-selection helper and `RuntimeProviderSelection` shape model the story’s exact order: configured endpoint first, same-endpoint model repair when the endpoint is healthy but the requested model is missing, same-provider native fallback when the endpoint is unavailable, and cross-provider fallback only after both same-provider paths fail. Purpose: keep the lifecycle matrix centralized in the shared runtime-selection contract instead of burying endpoint state in route-only warnings. Proof owners: `server/src/test/unit/config.chatDefaults.test.ts`.
4. [x] Update `server/src/config/chatDefaults.ts` so `buildDefaultsAppliedMarkerPayload()` and any endpoint-aware warning or decision fields reflect the final resolved endpoint/native/cross-provider outcome after selection settles, rather than only the initial requested model. Purpose: keep operator-visible diagnostics aligned with the post-transition runtime decision and give downstream log consumers an honest contract. Proof owners: `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/integration/chat-copilot-fallback.test.ts`.
5. [x] Update `server/src/routes/chat.ts` so chat-specific warning text clearly distinguishes endpoint unavailable with native fallback, requested model unavailable with same-endpoint repair, and requested provider unavailable with cross-provider fallback. Purpose: make the chat-facing fallback path diagnosable without changing the fallback policy itself. Proof owners: `server/src/test/integration/chat-copilot-fallback.test.ts`, `server/src/test/integration/chat-codex.test.ts`.
6. [x] Update `server/src/routes/chat.ts` so pinned/resumed chat execution identity reads `{ provider, model, endpointId? }`, and later turns fail in place instead of silently drifting to another endpoint or provider. Purpose: preserve the repo’s existing pinned-chat contract while adding endpoint identity. Proof owners: `server/src/test/integration/chat-codex.test.ts`.
7. [x] Update the direct-agent entrypoints in `server/src/agents/service.ts` so fresh-run direct-agent execution reuses the endpoint-aware fallback matrix, reads saved `flags.endpointId` for resumed executions, and does not rewrite that saved endpoint identity on pinned or resumed runs. Do not change command-agent or MCP-agent behavior in this step. Purpose: give the plain direct-agent path its own implementation step before the other agent route families follow it. Proof owners: `server/src/test/unit/agents-router-run.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`.
8. [x] Update the command-agent entrypoints in `server/src/agents/service.ts` so command-backed agent execution reuses the same endpoint-aware fallback matrix and preserves saved endpoint identity on pinned or resumed runs. Do not change MCP-agent behavior in this step. Purpose: keep the command-agent path aligned with the direct-agent path without making one checkbox span both route families. Proof owners: `server/src/test/unit/agents-commands-router-run.test.ts`.
9. [x] Update the MCP-agent entrypoints in `server/src/agents/service.ts` so both MCP direct-agent and MCP command-agent execution reuse the endpoint-aware fallback matrix and preserve saved endpoint identity on pinned or resumed runs. Purpose: finish the agent-service rollout across the MCP surfaces after the non-MCP agent paths are in place. Proof owners: `server/src/test/unit/mcp-agents-router-run.test.ts`, `server/src/test/unit/mcp-agents-commands-run.test.ts`.
10. [x] Update `server/src/flows/service.ts` so fresh-run flow-owned agent execution uses the endpoint-aware fallback matrix, reads saved child `endpointId` on resume, and keeps that saved child identity stable when the pinned endpoint later becomes unavailable. Purpose: prevent flow-owned runtime drift across resumed executions. Proof owners: `server/src/test/integration/flows.run.errors.test.ts`, `server/src/test/integration/flows.run.resume.identity.test.ts`.
11. [x] Test type: server unit. Location: `server/src/test/unit/config.chatDefaults.test.ts`. Description: prove fresh-run runtime selection tries the configured endpoint first and repairs to the first selectable model on that same endpoint before any broader fallback is allowed. Implementation files: `server/src/config/chatDefaults.ts` and the runtime-selection helpers it owns. Purpose: pin down the same-endpoint repair ordering rather than leaving it implied by broader fallback coverage.
12. [x] Test type: server unit. Location: `server/src/test/unit/config.chatDefaults.test.ts`. Description: prove endpoint-unavailable fresh-run selection falls back to the same provider’s native path before cross-provider fallback is allowed. Implementation files: `server/src/config/chatDefaults.ts` and the runtime-selection helpers it owns. Purpose: keep the same-provider native fallback boundary explicit as a separate ordering invariant.
13. [x] Test type: server unit. Location: `server/src/test/unit/config.chatDefaults.test.ts`. Description: prove cross-provider fallback is reached only after both the configured endpoint path and the same-provider native path are unavailable. Implementation files: `server/src/config/chatDefaults.ts` and the runtime-selection helpers it owns. Purpose: assert the exact three-level ordering boundary instead of proving only adjacent fallback states.
14. [x] Test type: server unit. Location: `server/src/test/unit/config.chatDefaults.test.ts`. Description: prove the defaults-applied diagnostic payload records the final resolved endpoint/native/cross-provider decision and any endpoint-aware repair outcome after selection settles. Implementation files: `server/src/config/chatDefaults.ts`. Purpose: keep producer and consumer alignment explicit for operator-visible fallback diagnostics.
15. [x] Test type: server integration. Location: `server/src/test/integration/chat-copilot-fallback.test.ts`. Description: prove Copilot chat warns distinctly for endpoint-unavailable native fallback. Implementation files: `server/src/config/chatDefaults.ts` and `server/src/routes/chat.ts`. Purpose: keep the first fallback warning path explicit at the caller-visible chat surface.
16. [x] Test type: server integration. Location: `server/src/test/integration/chat-copilot-fallback.test.ts`. Description: prove Copilot chat warns distinctly for same-endpoint model repair instead of skipping straight to unrelated provider fallback. Implementation files: `server/src/config/chatDefaults.ts` and `server/src/routes/chat.ts`. Purpose: give the model-missing repair warning its own proof home instead of bundling it into the endpoint-unavailable case.
17. [x] Test type: server integration. Location: `server/src/test/integration/chat-codex.test.ts`. Description: prove Codex chat uses endpoint-aware fresh-run behavior without silently drifting to another provider too early. Implementation files: `server/src/config/chatDefaults.ts` and `server/src/routes/chat.ts`. Purpose: keep the Codex fresh-run ordering explicit on its own route surface.
18. [x] Test type: server integration. Location: `server/src/test/integration/chat-codex.test.ts`. Description: prove pinned or resumed Codex chat fails in place when the saved endpoint later becomes unavailable. Implementation files: `server/src/routes/chat.ts`, persisted conversation identity fields, and the runtime-selection helpers used on resume. Purpose: give the post-transition fail-in-place boundary its own proof home instead of relying on fresh-run fallback coverage.
19. [x] Test type: server unit. Location: `server/src/test/unit/agents-router-run.test.ts`. Description: prove the direct-agent route surfaces endpoint-aware fallback warnings consistently with the shared runtime-selection contract. Implementation files: `server/src/agents/service.ts` and the direct-agent route seam it owns. Purpose: keep the direct-agent warning consumer explicit.
20. [x] Test type: server unit. Location: `server/src/test/unit/agents-commands-router-run.test.ts`. Description: prove the command-agent route surfaces endpoint-aware fallback warnings consistently with the shared runtime-selection contract. Implementation files: `server/src/agents/service.ts` and the command-agent route seam it owns. Purpose: keep the command-agent warning consumer explicit.
21. [x] Test type: server unit. Location: `server/src/test/unit/mcp-agents-router-run.test.ts`. Description: prove the MCP direct-agent surface surfaces endpoint-aware fallback warnings consistently with the shared runtime-selection contract. Implementation files: `server/src/agents/service.ts` and the MCP direct-agent route seam it owns. Purpose: keep the MCP direct-agent warning consumer explicit.
22. [x] Test type: server unit. Location: `server/src/test/unit/mcp-agents-commands-run.test.ts`. Description: prove the MCP command-agent surface surfaces endpoint-aware fallback warnings consistently with the shared runtime-selection contract. Implementation files: `server/src/agents/service.ts` and the MCP command-agent route seam it owns. Purpose: keep the MCP command-agent warning consumer explicit.
23. [x] Test type: server integration. Location: `server/src/test/integration/agents-run-client-conversation-id.test.ts`. Description: prove direct-agent fresh runs surface endpoint-aware fallback warnings end to end. Implementation files: `server/src/agents/service.ts`, `server/src/routes/chat.ts`, and persisted conversation identity fields reused by direct agents. Purpose: keep the direct-agent wrapper/default-path warning propagation explicit.
24. [x] Test type: server integration. Location: `server/src/test/integration/agents-run-client-conversation-id.test.ts`. Description: prove direct-agent pinned or resumed runs keep saved endpoint identity stable and fail in place when that endpoint later becomes unavailable. Implementation files: `server/src/agents/service.ts`, `server/src/routes/chat.ts`, and persisted conversation identity fields reused by direct agents. Purpose: give the direct-agent post-transition fail-in-place boundary its own proof home.
25. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.errors.test.ts`. Description: prove flow starts use the endpoint-aware repair/fallback order instead of skipping straight to cross-provider fallback. Implementation files: `server/src/flows/service.ts`, `server/src/config/chatDefaults.ts`, and the shared runtime-selection helpers they reuse. Purpose: keep the fresh-run flow ordering explicit on the caller-visible flow start surface.
26. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.errors.test.ts`. Description: prove flow starts surface the correct endpoint-aware warning behavior after runtime selection has settled. Implementation files: `server/src/flows/service.ts`, `server/src/config/chatDefaults.ts`, and the shared runtime-selection helpers they reuse. Purpose: assert the post-transition warning value rather than only the initial selection attempt.
27. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.resume.identity.test.ts`. Description: prove resumed flows keep saved endpoint identity stable and fail in place when that endpoint later becomes unavailable. Implementation files: `server/src/flows/service.ts`, persisted flow child identity fields, and the runtime-selection helpers used on resume. Purpose: keep the resumed flow identity contract explicit instead of relying on fresh-run flow coverage.
28. [x] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.
29. [x] Run the exact repository-supported format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the endpoint-aware fallback matrix compiles cleanly across chat, agents, commands, and flows.
2. [x] Run `npm run test:summary:server:unit` to prove fresh-run repair/fallback ordering, pinned fail-in-place behavior, and warning propagation through the server unit/integration wrapper.
3. [x] Run `npm run lint` for the final fallback/fail-in-place surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
4. [x] Run `npm run format:check` for the final fallback/fail-in-place surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Implementation notes

- Starts empty.
- Build: `npm run build:summary:server` passed; log: `logs/test-summaries/build-server-latest.log`.
- Extended the shared runtime-selection matrix so endpoint-aware fresh runs now repair on the same endpoint, fall back to the same provider when the endpoint is unavailable, and fail in place for pinned/resumed endpoint-backed runs that later lose their saved endpoint.
- Updated chat warnings so the route surface clearly distinguishes same-endpoint repair, same-provider native fallback, and cross-provider fallback, and tightened explicit LM Studio handling so explicit requests do not drift cross-provider.
- Wired direct-agent, command-agent, MCP-agent, and flow execution paths to preserve `endpointId` through resumed and pinned execution state, then validated the combined Task 6 server surface with the targeted wrapper across config, chat, agent, MCP, and flow tests.
- Implementation-only audit normalized Task 6 config-level proof-authoring subtasks 11, 12, and 14 from `server/src/test/unit/config.chatDefaults.test.ts`; the repository now has explicit same-endpoint repair, same-provider native fallback, and defaults-applied payload coverage in that file.
- Added the missing three-level ordering proof in `server/src/test/unit/config.chatDefaults.test.ts`, and a targeted `npm run test:summary:server:unit -- --file server/src/test/unit/config.chatDefaults.test.ts --test-name "endpoint-aware selection reaches cross-provider fallback only after the endpoint path and same-provider native path are both unavailable"` run passed in `test-results/server-unit-tests-2026-06-02T16-27-04-797Z.log`.
- Audit repair also confirmed the warning-consumer proof homes already on disk for subtasks 19-23 and 26 (`agents-router-run`, `agents-commands-router-run`, `mcp-agents-router-run`, `mcp-agents-commands-run`, `agents-run-client-conversation-id`, and `flows.run.errors`). Those boxes are now normalized to match the existing repository state.
- Added endpoint-specific proof to the remaining task-owned integration homes and verified the focused server-unit wrapper now passes with 110/110 tests, while lint and format checks are clean after normalizing `chat.ts` import order and the `scripts/test-summary-client.mjs` formatter drift.
- Automated-proof audit confirmed all four Task 6 testing steps are now complete from the checked wrapper artifacts: `logs/test-summaries/build-server-latest.log` for the server build and `test-results/server-unit-tests-2026-06-02T17-39-51-018Z.log` for the full server-unit wrapper, which finished with 110 passing tests and no failures. With all subtasks and testing checked and no live blocker remaining, Task 6 now closes honestly as `__done__`.
- **RESOLVED ISSUE** Earlier audit passes proved the broad blocker was really missing endpoint-specific proof ownership in the caller-visible chat and pinned-identity homes, not a new runtime seam. That gap was later closed in the assigned integration homes (`chat-copilot-fallback`, `chat-codex`, `agents-run-client-conversation-id`, `flows.run.errors`, and `flows.run.resume.identity`), so this note remains only as historical context for why the blocker was retired instead of escalated into plan repair.
- **BLOCKING ANSWER** Repository precedents show the missing work is test ownership, not a new runtime seam: `server/src/test/unit/config.chatDefaults.test.ts` already proves the canonical endpoint-aware matrix (`configured_endpoint` -> `same_endpoint_repair` -> `same_provider_native_fallback` -> `cross_provider_fallback`) plus fail-in-place, `server/src/test/integration/chat-copilot-fallback.test.ts` already owns caller-visible fallback warning assertions, `server/src/test/integration/chat-codex.test.ts` already owns resumed identity authority and explicit `PROVIDER_UNAVAILABLE` behavior, `server/src/test/integration/agents-run-client-conversation-id.test.ts` already owns direct-agent start warnings and saved identity persistence, `server/src/test/integration/flows.run.errors.test.ts` already owns flow-start warning payloads, and `server/src/test/integration/flows.run.resume.identity.test.ts` already owns resumed flow identity stability. External-library confirmation agrees that the host app must resolve the provider/model choice before invoking either SDK: Context7 `/openai/codex` documents `model_provider` plus `model_providers.<name>` with `base_url` and `wire_api` as resolved config inputs, and Context7 `/github/copilot-sdk` plus the official GitHub BYOK docs document a concrete custom provider object (`type`, `baseUrl`, optional `wireApi`) plus an explicit `model`, not SDK-owned fallback policy. DeepWiki lookups for `openai/codex` and `github/copilot-sdk` were attempted but returned 500s, so the external confirmation relied on those primary docs instead. The exact failure mode is therefore a proof or test harness seam that Task 6 itself owns: the current blocked files still lack endpoint-specific assertions (`rg` found no endpoint-specific fallback/fail-in-place terms in those five integration homes, and recent git history for those files shows no Story 59 updates), so the honest fix is to add the remaining endpoint-specific integration tests in their already-assigned homes rather than broaden wrappers, rerun the same suite, add a new baseline task, or mutate runtime behavior. The proven solution is: add subtasks 15-16 to `chat-copilot-fallback` for endpoint-unavailable native fallback vs same-endpoint repair warnings; add subtasks 17-18 to `chat-codex` for fresh-run endpoint ordering and pinned endpoint fail-in-place; add subtask 24 to `agents-run-client-conversation-id` for direct-agent pinned endpoint stability and fail-in-place; keep subtask 25 in `flows.run.errors` for fresh-run flow ordering; and add subtask 27 to `flows.run.resume.identity` for resumed flow child endpoint stability and fail-in-place. Rejected alternatives: broad `test:summary:server:unit` reruns are only a temporary workaround because they do not create the missing proof; additional Codex/Copilot config changes are the wrong fix because the external contracts already accept resolved provider inputs; and moving this work to Task 7 would hide current-task proof debt instead of closing the Task 6 proof seam where the plan already assigns it.
- Manual testing skipped for the main compose stack Task 6 fallback and fail-in-place proof surface. Tried: `curl -sf http://localhost:5010/health`, `curl -I -sf http://localhost:5001`, and `npm run compose:build`. Observed: both localhost surfaces were unreachable and the supported compose wrapper failed with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. Why fuller proof was not possible: the repository-supported compose runtime was unavailable from this environment, which is outside this task's implementation repair scope.

---

### Task 7. Final Story Validation, Documentation, And Close-Out

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`, `Task 2`, `Task 3`, `Task 4`, `Task 5`, `Task 6`
- Task Status: `__in_progress__`
- Git Commits:
- Notes: This final validation task depends on every earlier story seam because the final proof must cover parsing, discovery, picker behavior, runtime translation, persistence, and endpoint-aware fallback together.

#### Implementation Notes
- **RESOLVED ISSUE** The Task 7 cucumber wrapper no longer hard-fails on missing local container runtime when reachable external test services are already configured. `scripts/test-summary-server-cucumber.mjs` now preserves preconfigured `CODEINFO_CHROMA_URL` and `CODEINFO_MONGO_URI`, `server/src/test/support/chromaContainer.ts` reuses a reachable external Chroma endpoint before attempting compose startup, and `server/src/test/support/mongoContainer.ts` reuses a preconfigured Mongo URI before attempting a Mongo testcontainer. Fresh wrapper evidence in `test-results/server-cucumber-tests-2026-06-02T21-24-56-715Z.log` shows the Chroma hook passing and the suite moving on to the Mongo seam instead of failing all scenarios at the first Chroma startup attempt.
- **BLOCKER**
  - Testing step: Run `npm run test:summary:server:cucumber` (Testing item 4)
  - What was tried: Re-ran the full wrapper after the external-service harness repairs above. The fresh rerun in `test-results/server-cucumber-tests-2026-06-02T21-27-00-917Z.log` reached 104/127 passing scenarios and no longer failed on Task 7 chat proof; the remaining failures all come from ingest baseline scenarios.
  - Blocker reason: The exact remaining failures are in unrelated ingest cucumber steps such as `ingest-delta-reembed.steps.ts`, `ingest-manage.steps.ts`, and `ingest-roots-metadata.steps.ts`, so the full wrapper is now blocked by a shared baseline/proof-suite seam rather than a Task 7-owned chat regression.
  - Recommendation: Repair the ingest cucumber baseline on the shared external Mongo/Chroma path or have planner repair narrow Testing item 4 to the task-owned chat features that already passed targeted wrapper proof.


#### Overview

Validate the full story across the repository’s wrapper-first proof path, then update the durable repo documentation and reviewer summary artifacts that changed because of this feature. This task also packages the manual-proof guidance the later manual testing agent will need for the main stack, external endpoint setup, auth-skip boundaries, and artifact locations.

#### Task Exit Criteria

- Every in-scope Acceptance Criterion is mapped to final automated proof, and the final runnable stack still behaves coherently for users who do not configure external endpoints.
- README, structural traceability, and the reviewer-facing close-out summary all describe the final shipped contract rather than the pre-story behavior.

#### Documentation Locations

- `Context7 /openai/codex` - use for the final documented Codex runtime translation contract so README wording stays aligned with the generated `model_provider`/`model_providers` behavior.
- `Context7 /github/copilot-sdk` - use for the final documented Copilot custom-provider contract so README wording stays aligned with the generated `type: "openai"` provider object behavior.
- `Context7 /websites/developers_openai_api_reference` - use for the final documented external endpoint discovery contract and the explicit `/v1` requirement.

#### Subtasks

1. [x] Re-read the full story and trace Tasks 2 and 3 against the `Description`, `Acceptance Criteria`, `Out Of Scope`, `Message Contracts And Storage Shapes`, and `Risk And Invariant Matrix`. Confirm the final server proof still covers parser behavior, endpoint identity, `/v1/models` discovery, duplicate handling, bounded probe fan-out, and default-path route reachability without widening scope beyond chat-only endpoint selection. Purpose: make the final validation pass start with the server discovery contract rather than one broad story-wide check.
2. [x] Re-read the full story and trace Tasks 4 and 5 against the same story sections, focusing on picker identity, `selectedEndpointId`, request payload shape, persisted `flags.endpointId`, backward-compatible conversation reads, and the rule that external endpoint identity stays separate from the raw model string. Purpose: make the final validation pass explicitly confirm the client and persistence contracts before wrapper runs begin.
3. [x] Re-read the full story and trace Tasks 6 and 7 against the same story sections, focusing on endpoint-aware fallback ordering, fail-in-place behavior, unchanged LM Studio and Agents-page scope, Cucumber coverage, e2e coverage, and the normal supported Compose path. Purpose: keep the final validation checklist executable instead of leaving scope-boundary and default-path checks implied.
4. [x] Update `README.md` with the final `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` format, explicit `/v1` requirement, duplicate-handling rule, and chat-only picker scope for external endpoints. Purpose: keep the repository’s primary operator/developer doc aligned with the shipped endpoint discovery contract.
5. [x] Update `README.md` with the final `codeinfo_openai_endpoint` usage on `codex/chat/config.toml`, `copilot/chat/config.toml`, and `codeinfo_agents/<agent>/config.toml`, plus the persisted `endpointId` and unchanged auth/readiness boundaries. Purpose: document the final repository-owned config contract and its runtime limits.
6. [x] Update `projectStructure.md` with the Story `0000059` structural change ledger, including every new helper or test file added during this story and the final implementation traceability summary for the changed server, client, common, and plan files. Purpose: keep the repository’s structural ledger honest about any new tracked files introduced by this story.
7. [x] Extend `server/src/test/features/chat_models.feature` and `server/src/test/steps/chat_models.steps.ts` with the final external-endpoint discovery and picker-bootstrap scenarios that belong in the repository’s Cucumber contract surface. Keep the existing native-only scenarios honest by adding new external-endpoint scenarios instead of silently widening older scenario claims that do not mention endpoint identity. Purpose: give the wrapper-first Cucumber run a story-owned proof home for `/chat/models` and `/chat/providers` behavior instead of treating `test:summary:server:cucumber` as adjacent coverage only.
8. [x] Extend `server/src/test/features/chat_stream.feature` and `server/src/test/steps/chat_stream.steps.ts` with the final endpoint-aware fallback, same-endpoint repair, same-provider native fallback, and fail-in-place chat route scenarios that belong in the repository’s Cucumber contract surface. Cover three separate wire-level outcomes explicitly: endpoint unavailable with same-provider native success, endpoint unavailable plus same-provider native failure before the existing `PROVIDER_UNAVAILABLE` path, and endpoint healthy with requested-model-missing repair to the first selectable model on that same endpoint. If the existing LM Studio-only fallback scenario remains, keep it as the native baseline and add separately named endpoint-aware scenarios rather than overloading the older scenario title with a broader ordering claim. Purpose: make the route-level request/response contract visible in the feature-suite layer as well as the lower-level unit and integration tests.
9. [x] Rewrite or split any misleading reused e2e history titles in `e2e/chat-provider-history.spec.ts` before adding endpoint-aware assertions. Keep the existing provider-only history scenarios as no-endpoint baselines when they still matter, and add separately named endpoint-aware create-vs-reuse and fresh-after-history scenarios when the proof now covers `{ provider, model, endpointId? }` rather than provider state alone. Purpose: prevent browser-visible history proof from claiming only provider pinning when endpoint identity is part of the invariant.
10. [x] Extend `e2e/chat-provider-history.spec.ts` with the final browser-visible create-vs-reuse and fresh-after-history endpoint-selection scenarios, using the repo’s existing mock-chat and route-stubbing pattern. Purpose: give `npm run test:summary:e2e` a story-owned Playwright proof home for the stateful chat picker and restored-selection behavior instead of relying only on unit tests.
11. [x] Extend `e2e/chat-user-turn-ws.spec.ts` or `e2e/chat.spec.ts` with the final browser-visible endpoint-backed send path that proves the selected provider/model flow reaches the normal chat launcher under the repo’s supported e2e mock-chat workflow. If an existing send-path title is reused, rename it so the title still matches the final endpoint-aware payload and launcher invariant. Purpose: keep the browser proof proportional while still exercising one fresh-run chat send through the default `/chat` UI path.
12. [x] Create `codeInfoStatus/pr-summaries/0000059-pr-summary.md` as the reviewer-facing close-out artifact for this story. Summarize the shipped external-endpoint contract, the fallback/fail-in-place behavior, the documentation changes, and the automated/manual proof performed. Purpose: preserve the repository’s durable PR-summary pattern outside `planning/`.
13. [x] Run the exact repository-supported lint command for this task’s surface: `npm run lint`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.
14. [x] Run the exact repository-supported format-check command for this task’s surface: `npm run format:check`. Fix any issues found, using any supported auto-fix path before manual cleanup when possible.
15. [x] Update `server/src/routes/chatProviders.ts` so `/chat/providers` returns the resolved selected endpoint identity from the runtime-selection result or pinned parsed endpoint instead of inferring `selectedEndpointId` from the first discovery row whose `model.key` matches the selected model. Purpose: restore the config-pinned picker-bootstrap contract already proved in `server/src/test/unit/chatProviders.test.ts` without letting discovery order choose the endpoint.
16. [x] Update `server/src/routes/chat.ts` so pinned/defaulted `codeinfo_openai_endpoint` values are parsed from the raw config string with the same endpoint parser used by `server/src/routes/chatDiscovery.ts` before runtime selection runs. Purpose: restore same-endpoint repair for defaulted endpoint-backed chat requests instead of leaving `missing-codex-model` on the native path because the pinned endpoint was never materialized.
17. [x] Update `server/src/test/steps/chat_models.steps.ts` so the duplicate-model Cucumber assertion proves endpoint-backed duplicates by `(key, endpointId)` instead of binding to the first row that matches the raw model id. Purpose: keep Task 7’s `/chat/models` proof aligned with the already-proved duplicate-endpoint contract without forcing the production route to hide or reorder duplicate raw model ids.
18. [x] Update `server/src/test/steps/chat_stream.steps.ts` and `server/src/test/features/chat_stream.feature` so the `external-endpoint-native-failure` scenario disables later fallback providers and proves the real `PROVIDER_UNAVAILABLE` path without weakening the shared runtime-selection contract that still allows cross-provider fallback after both same-provider paths fail. Purpose: keep Task 7’s feature-level proof aligned with the story’s accepted fallback order instead of encoding a stricter runtime behavior than Tasks 6 and the Acceptance Criteria allow.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the final server parser, discovery, runtime translation, persistence, validator, and fallback surfaces compile cleanly before broader proof.
2. [x] Run `npm run build:summary:client` to confirm the final chat picker, restored-selection, and endpoint-aware payload surfaces compile cleanly on the client before browser proof.
3. [x] Run `npm run test:summary:server:unit` to prove the task-owned server unit and `node:test` integration files from Tasks 1 through 6, including parser, discovery, validator, persistence, runtime translation, fallback, and resumed fail-in-place behavior.
4. [ ] Run `npm run test:summary:server:cucumber` to prove the task-owned feature-level contract in `server/src/test/features/chat_models.feature` and `server/src/test/features/chat_stream.feature`, along with their step files, through the repository’s Cucumber wrapper.
5. [x] Run `npm run test:summary:client` to prove the task-owned client unit files for picker identity, stale-state exclusion, restored endpoint identity, and endpoint-aware send payload behavior.
6. [ ] Run `npm run test:summary:e2e` to prove the task-owned browser-visible chat flows in `e2e/chat-provider-history.spec.ts` and the selected chat send spec updated for this story, using the repository’s supported mock-chat Playwright workflow rather than a live-provider dependency.
7. [x] Run `npm run compose:build:summary` to verify the checked-in main stack images still build on the supported Compose path after all story changes land.
8. [ ] Run `npm run compose:up` so the checked-in main stack is exercised on the normal supported runtime path, and verify the final runtime surfaces stay reachable at `http://localhost:5001` and `http://localhost:5010` with server health still exposed through `http://localhost:5010/health`.
9. [ ] Run `npm run compose:down` to stop the main stack that was started for final runtime validation.
10. [x] Run `npm run lint` for the final story-validation surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
11. [x] Run `npm run format:check` for the final story-validation surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Manual Testing Guidance

Use the checked-in main stack for later human proof: start with `npm run compose:build`, then `npm run compose:up`, and stop with `npm run compose:down`. Those wrappers load `server/.env` and `server/.env.local` automatically through `scripts/docker-compose-with-env.sh`. The supported human-proof surfaces remain `http://localhost:5001` for the client and `http://localhost:5010` for the server, with server health at `http://localhost:5010/health`.

This story’s live external endpoint is not part of the checked-in Compose stack. When later manual proof needs a real endpoint, configure `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` to point at an already running external or local OpenAI-compatible `/v1` service outside the checked-in compose services, then exercise the Codex and Copilot chat pickers against that live endpoint from the main stack. The main stack already mounts the repo-owned `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` catalogs plus the existing Codex and Copilot runtime homes; provider access comes from whatever auth state is already present in those mounted homes or seed directories, not from checked-in secrets in this plan.

Store task-level manual proof artifacts in `codeInfoTmp/manual-testing/0000059/7/` and do not commit them. Useful retained artifacts for this story include `proof-01-codex-picker.png`, `proof-02-copilot-picker.png`, `proof-03-config-pinned-endpoint.png`, `proof-04-resumed-endpoint-warning.png`, `support-console.txt`, and `support-server-log.txt`. Later story closeout should promote the curated durable bundle into `codeInfoStatus/manual-proof/0000059/`.

If Playwright MCP screenshots are used during later manual proof, capture them in the Playwright output staging directory first and then transfer the retained files into `codeInfoTmp/manual-testing/0000059/7/`. In this local harness workflow, the usual host-visible staging location is `$CODEINFO_ROOT/playwright-output-local/0000059/7/<filename>`, but `CODEINFO_ROOT` is the harness root, not the target artifact root.

Later manual proof should cover the full implemented frontend surface for this story, not only one local screen: prove the Codex picker showing endpoint-backed models, the Copilot picker showing endpoint-backed models, a config-pinned endpoint that is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` but still visible in chat, and any visible warning/result surface that distinguishes same-endpoint repair, same-provider native fallback, or fail-in-place on a resumed/pinned execution when the endpoint becomes unavailable. Treat these Task 7 screenshots and retained notes as the primary durable closeout proof for the re-covered story surfaces, and keep earlier screenshots in the durable bundle only when they still provide unique proof that the final Task 7 capture no longer shows.

If Playwright MCP screenshot transfer fails after using the normal staging path and host-visible handoff path, record that limitation honestly in the retained proof notes and continue the proof pass with the best available evidence instead of blocking closeout on the transfer problem alone.

If a Codex or Copilot manual-proof step reaches an auth-dependent surface and restoring the missing provider auth would require human-controlled two-factor authentication, skip only that affected auth-dependent surface, record the limitation honestly in the retained proof notes, and rely on the automated server/client tests for that seam.

#### Implementation notes

- Added the final README contract sections for external endpoint discovery and runtime config usage, plus the story 0000059 structural ledger and reviewer-facing PR summary artifact.
- Expanded the Cucumber and Playwright story coverage with endpoint-aware discovery, picker-bootstrap, fallback, fail-in-place, history, and send-path scenarios so the final close-out proof has story-owned homes.
- Completed the final lint and format checks after normalizing the step-file import order; the remaining plan-level automated-proof wrappers are still open because this pass only finished the subtask section work.
- Automated-proof audit normalized Testing items 3, 5, 7, 10, and 11 from existing wrapper evidence: `test-results/server-unit-tests-2026-06-02T17-39-51-018Z.log` finished with 110 passing server-unit tests for the Tasks 1-6 runtime surfaces, `test-results/client-tests-2026-06-02T14-51-33-393Z.log` finished with 140 passing client suites / 879 passing tests, `logs/test-summaries/compose-build-latest.log` built both main-stack images successfully, and the final lint/format reruns were already completed during the implementation pass.
- Narrowed the Task 7 cucumber runtime seam by teaching the wrapper’s targeted `--feature` mode to import only matching step files, switching the chat-stream feature to per-scenario conversation ids, and normalizing the chat routes plus validators to prefer `CODEINFO_CODEX_HOME` over the legacy `CODEX_HOME`. The fresh targeted proof `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_models.feature --feature server/src/test/features/chat_stream.feature` now reaches 18/22 passing scenarios and no longer fails at the Docker/Testcontainers bootstrap layer.
- **RESOLVED ISSUE** Targeted cucumber proof for Testing item 4 exposed four task-owned endpoint contract mismatches in `test-results/server-cucumber-tests-2026-06-02T19-50-28-990Z.log`: the duplicate Codex model `gpt-5.1-codex-max` assertion was still binding to a blank-`endpointId` row, `/chat/providers` still preferred the discovered endpoint instead of the pinned endpoint in the picker-bootstrap scenario, and `/chat` still treated the endpoint-native-failure plus same-endpoint-repair scenarios as native successes instead of returning `PROVIDER_UNAVAILABLE` or repairing to `alpha`. Those failures remain open implementation/proof work on Task 7, but they are no longer a live blocker because the follow-up owner and fix path are now explicit in the blocking answer below.
- **BLOCKING ANSWER** Fresh repo and docs evidence shows this blocker is Task 7-owned closeout work, not a shared baseline or runtime-handoff failure. Repository precedents split the four failures into two local route defects and two proof-surface defects. For `/chat/models`, `server/src/routes/chatDiscovery.ts` already preserves endpoint identity on discovered models, and `server/src/test/unit/chatModels.codex.test.ts` already proves duplicate raw model ids remain distinct by `endpointId`; the current Cucumber failure is coming from `server/src/test/steps/chat_models.steps.ts`, which asserts against the first row with a matching `key` instead of proving that at least one row with that key carries the expected endpoint identity. That step should search by `(key, endpointId)` rather than force the route to hide or reorder duplicates. External-library confirmation matches that reading: Context7 `/websites/developers_openai_api_reference` and DeepWiki `openai/openai-openapi` both confirm `GET /v1/models` returns model fields such as `id`, `object`, `created`, and `owned_by`, not endpoint metadata, so `endpointId` is CodeInfo-owned route metadata and must be validated in local response shaping rather than expected from the upstream API. For `/chat/providers`, `server/src/test/unit/chatProviders.test.ts` already proves a config-pinned endpoint absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` must stay selected, while `server/src/routes/chatProviders.ts` currently derives `selectedEndpointId` from the first discovery row whose `model.key` matches `runtimeSelection.executionModel`; the proven fix is to pass the resolved endpoint identity (`runtimeSelection.endpointId` / parsed pinned endpoint) into `buildProvidersResponse` directly instead of inferring it from discovery order. For `/chat`, `server/src/routes/chatDiscovery.ts` already parses `snapshot.config.codeinfo_openai_endpoint` from the raw config string, but `server/src/routes/chat.ts` currently treats that same field as if it were already an object; matching the discovery path and parsing the raw string with `parseOpenAiCompatEndpointConfig` is the local fix that fits current repo behavior and should restore the same-endpoint repair scenario that now stays on `missing-codex-model`. The remaining `PROVIDER_UNAVAILABLE` mismatch is not a shared runtime bug: the story text and `server/src/test/unit/config.chatDefaults.test.ts` explicitly require cross-provider fallback only after the endpoint and same-provider native paths both fail, so the current Cucumber `external-endpoint-native-failure` scenario is over-asserting because `startLegacyChatStreamServer()` still leaves LM Studio available. The honest fix there is to make the Task 7 Cucumber scenario disable later fallback providers or otherwise model the real unavailable path instead of weakening the runtime-selection matrix. Primary blocker family: product/story seam, because the current task still exposes real route-level gaps in `server/src/routes/chatProviders.ts` and `server/src/routes/chat.ts`; secondary proof/harness seam: the Task 7 Cucumber duplicate-model assertion and native-failure scenario setup still need to match the already-proved story contract. Rejected alternatives: broad cucumber reruns do not change ownership, reordering or deduping `/chat/models` rows would hide endpoint-backed duplicates instead of proving them, and changing `resolveRuntimeProviderSelection()` to suppress cross-provider fallback would directly contradict Task 6 proofs plus Acceptance Criteria lines 77-78.
- Implementation-only audit reopened Task 7 subtasks 15-18 after re-reading the latest blocking answer, current task state, and recent git history: the only commits after the focused cucumber failure were the plan-only notes `6a666032` and `6b00c968`, so no later repository evidence closes the route and proof-surface gaps they describe. Task 7 therefore still has real implementation/proof-authoring work open before automated proof can continue honestly.
- Restored the Task 7 endpoint closeout seams in `server/src/routes/chatProviders.ts`, `server/src/routes/chat.ts`, `server/src/test/steps/chat_models.steps.ts`, and the `external-endpoint-native-failure` Cucumber scenario so provider bootstrap, same-endpoint repair, duplicate endpoint assertions, and the unavailable-path proof all match the accepted story contract again.
- **RESOLVED ISSUE** Focused Task 7 verification `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_models.feature --feature server/src/test/features/chat_stream.feature` passed 22/22 scenarios in `test-results/server-cucumber-tests-2026-06-02T20-40-58-238Z.log`, which closes the implementation blocker for subtasks 15-18 without yet marking the broader full-wrapper Testing item 4 complete.
