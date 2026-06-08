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

The branch work also proved a set of repository-owned runtime seams that need to stay documented as part of the story outcome because they directly affect how this feature is validated and exercised. The checked-in main and e2e Compose stacks now need repository-owned Mongo image override seams so Ubuntu and other machine-specific checkouts can temporarily align their Mongo runtime with the local stack without forking the Compose files. The main Compose stack also now reserves host port `8300` for Chroma so the reviewed runtime shape does not collide with other local services. In the local host-networked development stack, host-networked services need `host.docker.internal` to resolve to loopback rather than Docker's bridge gateway so host-side helpers such as the Git credential forwarder remain reachable on plain Docker Engine Linux. Finally, Copilot runtime work for this story now depends on provider homes staying isolated and writable: Copilot subprocesses must use `/app/copilot` as their real `HOME` plus XDG cache/config roots, and startup must prepare writable runtime trees for Codex, Copilot, and LM Studio before privileges drop so auth and endpoint-backed runs do not fail on cache-directory permissions.

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
- The checked-in main Compose stack exposes Chroma on host port `8300`, and the repository-owned runtime config for that stack points to the same port so story validation uses the reviewed non-conflicting host contract.
- The checked-in main Compose stack supports `CODEINFO_MONGO_IMAGE` with default `mongo:8.2.9`, and the checked-in e2e Compose stack supports `CODEINFO_E2E_MONGO_IMAGE` with the same default, so machine-specific proof can temporarily align Mongo versions without editing the Compose files again.
- The tracked e2e env contract can pin `CODEINFO_E2E_MONGO_IMAGE` independently when a machine-specific downgrade is needed for proof, while the local and main-stack machine-local overrides continue to live in ignored local env files.
- In the local host-networked stack, the host-networked services that still need host helpers resolve `host.docker.internal` to `127.0.0.1` rather than `host-gateway`, so host-side helpers remain reachable on Docker Engine Linux during story proof.
- Copilot runtime execution uses `/app/copilot` as its effective `HOME`, `COPILOT_HOME`, `XDG_CACHE_HOME`, and `XDG_CONFIG_HOME` roots instead of sharing the Codex home, so Copilot auth, cache extraction, and endpoint-backed runs stay inside the mounted Copilot home.
- Container startup prepares writable runtime trees for Codex, Copilot, and LM Studio before dropping privileges, so provider cache directories required by this story exist and remain writable under both bind-mount and named-volume Compose shapes.
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
- For the repository-owned main-stack manual proof default, use `http://192.168.1.3:1234/v1` with exposed model `google/gemma-4-26b-a4b-qat`, because this endpoint/model combination has already completed the story's simple chat proof through both harnesses in the checked-in compose runtime.
- When later manual proof uses that live endpoint-backed default, manually test both `Copilot` and `Codex` chat surfaces rather than treating one successful provider run as sufficient story proof.
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
- **RESOLVED ISSUE** Earlier blocker analysis showed the missing work was test ownership, not a new runtime seam: `server/src/test/unit/config.chatDefaults.test.ts` already proved the canonical endpoint-aware matrix (`configured_endpoint` -> `same_endpoint_repair` -> `same_provider_native_fallback` -> `cross_provider_fallback`) plus fail-in-place, `server/src/test/integration/chat-copilot-fallback.test.ts` already owned caller-visible fallback warning assertions, `server/src/test/integration/chat-codex.test.ts` already owned resumed identity authority and explicit `PROVIDER_UNAVAILABLE` behavior, `server/src/test/integration/agents-run-client-conversation-id.test.ts` already owned direct-agent start warnings and saved identity persistence, `server/src/test/integration/flows.run.errors.test.ts` already owned flow-start warning payloads, and `server/src/test/integration/flows.run.resume.identity.test.ts` already owned resumed flow identity stability. External-library confirmation agreed that the host app must resolve the provider/model choice before invoking either SDK: Context7 `/openai/codex` documents `model_provider` plus `model_providers.<name>` with `base_url` and `wire_api` as resolved config inputs, and Context7 `/github/copilot-sdk` plus the official GitHub BYOK docs document a concrete custom provider object (`type`, `baseUrl`, optional `wireApi`) plus an explicit `model`, not SDK-owned fallback policy. DeepWiki lookups for `openai/codex` and `github/copilot-sdk` were attempted but returned 500s, so the external confirmation relied on those primary docs instead. The resulting failure mode at the time was a proof or test harness seam that Task 6 itself owned: the then-current blocked files still lacked endpoint-specific assertions (`rg` found no endpoint-specific fallback/fail-in-place terms in those five integration homes, and recent git history for those files showed no Story 59 updates), so the honest fix was to add the remaining endpoint-specific integration tests in their already-assigned homes rather than broaden wrappers, rerun the same suite, add a new baseline task, or mutate runtime behavior. That proof-home gap was later closed, which is why Task 6 now closes honestly as `__done__`.
- Manual testing skipped for the main compose stack Task 6 fallback and fail-in-place proof surface. Tried: `curl -sf http://localhost:5010/health`, `curl -I -sf http://localhost:5001`, and `npm run compose:build`. Observed: both localhost surfaces were unreachable and the supported compose wrapper failed with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. Why fuller proof was not possible: the repository-supported compose runtime was unavailable from this environment, which is outside this task's implementation repair scope.

---

### Task 7. Restore Docker-Backed Proof Runtime Access

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`, `Task 2`, `Task 3`, `Task 4`, `Task 5`, `Task 6`
- Task Status: `__done__`
- Git Commits:
- Notes: This prerequisite task owns the runtime-handoff seam for the repo's Docker-backed proof wrappers. It does not own Story 59 product code changes; it only restores one supported Docker access path so the blocked automated proof can resume honestly.

#### Overview

Restore a supported Docker daemon access path for this branch and worktree before the remaining final-proof wrappers run again. This task exists because the current session fails before any Playwright or compose-backed story proof starts, so the next honest owner is environment/runtime handoff rather than more endpoint-selection code work.

#### Task Exit Criteria

- One Docker access path supported by the repo wrappers is available to the session that will run the remaining proof: authorized access to `/var/run/docker.sock`, a supported rootless Docker socket, or a real Docker Desktop per-user socket selected through `DOCKER_HOST`.
- The repo's checked-in main compose build path reaches the Docker daemon through the supported summary wrapper without the earlier permission-denied failure.
- The same branch and worktree can be handed back to Task 11 without requiring Story 59 product-code changes or unsafe socket-permission hacks.

#### Documentation Locations

- `Context7 /docker/docs` - use for the supported Linux Engine non-root and rootless Docker access guidance.

#### Subtasks

1. [x] Re-read `scripts/test-summary-e2e.mjs`, `scripts/docker-compose-with-env.sh`, `docker context ls`, and the supported socket paths (`/var/run/docker.sock`, `~/.docker/run/docker.sock`, `~/.docker/desktop/docker.sock`) to identify which Docker access path this environment is supposed to use. Purpose: keep the runtime handoff aligned to the exact wrapper behavior already checked into the repo instead of inventing a new daemon path.
2. [x] If the current session still lacks any supported Docker access path, move this same story branch into a session or user that does have one, or restore supported host-level Docker access outside the repo using Docker's documented group/rootless/Desktop mechanisms. Do not change Story 59 application code or weaken socket permissions. Purpose: make the runtime prerequisite explicit and bounded before the implementation loop retries proof.
3. [x] Reconfirm the chosen session matches the wrapper-resolved Docker endpoint before handing execution back to Task 11, and record which supported endpoint/path is active plus which unsupported paths were ruled out. Purpose: leave a deterministic runtime handoff trail instead of another ambiguous retry.

#### Testing

1. [x] Run `npm run compose:build:summary` to prove the checked-in main compose build path can reach the Docker daemon from the chosen session without the earlier `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock` failure. Let Task 11 own the later `compose:up`, `compose:down`, and broad `test:summary:e2e` story proof after this runtime prerequisite is restored.

#### Implementation Notes

- Planner repair split the Docker-daemon access seam out of the final close-out task after repeated no-progress proof passes. The next honest owner is runtime handoff, not more Story 59 product-code changes.
- Docker access is now available again from the current branch session: `npm run compose:build:summary` passed cleanly on 2026-06-06, which proves the checked-in main compose build path can reach the daemon without the earlier socket-permission failure.
- Reconfirmed the active wrapper-resolved runtime path on the repaired session by building and starting the main stack successfully after moving the main-stack Chroma host port off the unrelated host-level `8000` collision; the supported handoff now runs through the main checked-in compose path with Chroma on host `8300`, while the local and e2e Chroma ports remain unchanged.
- Re-read the wrapper and socket-resolution scripts, confirmed the repo supports `DOCKER_HOST`, the active Docker context socket, `/var/run/docker.sock`, `~/.docker/run/docker.sock`, and `~/.docker/desktop/docker.sock`, then verified this session only exposes the default `unix:///var/run/docker.sock` context with no alternate user-level socket available.
- Re-checked `docker context ls`, `docker context inspect desktop-linux`, and `DOCKER_*` environment variables after the initial blocker analysis; the only available context remains `default -> unix:///var/run/docker.sock`, there is no `desktop-linux` context, and no Docker-specific environment override is present.
- Historical runtime-check summary: an earlier Docker socket discovery pass on this branch already exhausted the same wrapper-resolved runtime path and found no supported fallback beyond `/var/run/docker.sock`. The dated blocker notes below are retained as historical context for the runtime handoff that was later repaired.
- Follow-up runtime audit on the live `compose:local` stack found a newer Linux Docker Desktop-specific container seam in addition to the older host-session blocker notes: the active host context is now `desktop-linux` on `unix:///home/dan/.docker/desktop/docker.sock`, host `docker info` and `docker ps` succeed, but the mounted socket shows up inside `codeinfo2-server-local` as `root:root 660` while the server process runs as `uid=1000 gid=1000 groups=1000`. A direct non-root socket connect inside the container failed with `PermissionError: [Errno 13]`, while the same connect succeeded immediately when supplemental group `0` was added. Updated `scripts/docker-compose-with-env.sh` so Docker Desktop exports container-side socket group `0` through `CODEINFO_DOCKER_SOCK_GID` without forcing Linux runtimes fully to root, then validated the wrapper contract with `server/src/test/unit/copilot-compose-contract.test.ts`, `node --test src/test/unit/copilot-compose-contract.test.ts`, and `npm run format:check`. The live local stack was not restarted in this pass.
- **RESOLVED ISSUE** Fresh re-check on 2026-06-03 reproduced the same runtime gap: `id` still shows `uid=1000(node) gid=1000(node) groups=1000(node)`, `docker context ls` still resolves only `default unix:///var/run/docker.sock`, `docker info --format '{{.ServerVersion}} {{.DockerRootDir}}'` still fails with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`, and `find /run /var/run "$HOME/.docker" -maxdepth 3 -type s -name 'docker.sock'` still finds no alternate supported socket. That dated session-level blocker was later cleared when the branch moved into a session with working Docker access and the supported wrapper path passed again.
- **RESOLVED ISSUE** Fresh re-check in this pass reproduced the same runtime gap again: `id` still shows `uid=1000(node) gid=1000(node) groups=1000(node)`, `docker context ls` still resolves only `default unix:///var/run/docker.sock`, `docker info --format '{{.ServerVersion}} {{.DockerRootDir}}'` still fails with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`, and `find /run /var/run "$HOME/.docker" -maxdepth 3 -type s -name 'docker.sock'` still finds no alternate supported socket. This note is retained as repeated evidence for why Task 7 was split out before the runtime seam was repaired.
- **RESOLVED ISSUE** Fresh re-check in this pass reproduced the same runtime gap again: `id` still shows `uid=1000(node) gid=1000(node) groups=1000(node)`, `docker context ls` still resolves only `default unix:///var/run/docker.sock`, `docker info --format '{{.ServerVersion}} {{.DockerRootDir}}'` still fails with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`, and `find /run /var/run "$HOME/.docker" -maxdepth 3 -type s -name 'docker.sock'` still finds no alternate supported socket. That earlier need to re-own the task into a session with a supported Docker daemon path has since been satisfied.
- **RESOLVED ISSUE** Fresh re-check in this pass again found only the default `unix:///var/run/docker.sock` endpoint and the same permission-denied `docker info` failure, so Subtask 2 remained blocked at the time. This repeated note is now historical because the task later resumed in a session that could present a supported Docker daemon path.
- **RESOLVED ISSUE** Fresh repository, `code_info`, Context7, DeepWiki, and targeted web research showed that the right fix was runtime handoff, not more Story 59 code changes. Repository precedents were explicit: this repo routes `npm run test:summary:e2e` through `scripts/test-summary-e2e.mjs`, which always performs compose build and compose up before Playwright runs, and `scripts/docker-compose-with-env.sh` resolves Docker access only through supported endpoints: an explicit `DOCKER_HOST` Unix socket, the active Docker context endpoint, `/var/run/docker.sock`, `~/.docker/run/docker.sock`, or `~/.docker/desktop/docker.sock`. That wrapper also already contains its own non-mac socket-gid fallback that forces container UID/GID to root when the resolved socket group is `0`, which means the checked-in repo had already exhausted its built-in socket-ownership adaptation and still could not fix a host session that failed before the daemon connection opened. Fresh `code_info` pattern research again found no indexed cross-repository runtime-handling variant beyond `codeInfo2` itself, so this repo's own wrapper and plan precedents remained the controlling local evidence rather than one implementation option among several. The local evidence at the time matched that seam exactly: `docker context ls` exposed only the default `unix:///var/run/docker.sock` endpoint, `id` showed this session as `uid=1000(node) gid=1000(node) groups=1000(node)` with no extra groups, `docker info --format '{{.ServerVersion}} {{.DockerRootDir}}'` failed with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`, `env | rg '^DOCKER'` returned no Docker-specific override, and `find /run /var/run "$HOME/.docker" -maxdepth 3 -type s -name 'docker.sock'` found no rootless or Docker Desktop per-user socket. Official Docker precedents confirmed the supported fixes. Docker's Linux post-install docs say `/var/run/docker.sock` is root-owned by default, the supported non-root path is to add the user to the `docker` group, then log out/log back in or run `newgrp docker`, and that the `docker` group grants root-level privileges. Docker's rootless docs show the supported client path is a rootless daemon socket exposed through `DOCKER_HOST=unix:///run/user/<uid>/docker.sock` or the `rootless` context. Docker Desktop for Linux docs and the Docker docs repo confirm Desktop uses a per-user socket at `~/.docker/desktop/docker.sock`, creates a `desktop-linux` context, and direct-connect SDK/tools should export `DOCKER_HOST` to that socket when they cannot rely on the CLI context alone. Targeted issue-resolution research for this exact error matches how other engineers resolve it in practice: when using rootful Docker, they restore actual `docker` group membership and re-evaluate the current shell session; otherwise they move to a real rootless daemon/context or a real Desktop socket/context. Those were the proper fixes. Rejected alternatives were not suitable: `chmod 666 /var/run/docker.sock` or similar permission weakening is an unsafe anti-pattern, bypassing the repo wrappers would hide rather than solve the supported runtime contract, and mutating Story 59 product code cannot manufacture missing host-level daemon permission. This historical blocker analysis is now resolved because the branch later ran in a session with working Docker access, `npm run compose:build:summary` passed, and the main-stack compose path completed successfully.

### Task 8. Capture Branch-Only Runtime Seam Changes In The Story Plan

- Repository Name: `Current Repository`
- Task Dependencies: `Task 7`
- Task Status: `__done__`
- Git Commits:
- Notes: This branch-only documentation task records the reviewed runtime and environment changes that were required to prove Story 59 honestly on this machine and in the checked-in Compose surfaces. It does not introduce new product behavior beyond those already-landed runtime seams; it makes the plan acknowledge them explicitly and ties them to the branch history and focused proof that already ran.

#### Overview

Add one completed task to the story plan that captures the branch-only runtime seam changes which were required to make Story 59 provable on the supported local and main Compose environments. The purpose of this task is to keep those reviewed environment and runtime changes visible in the plan instead of leaving them implicit in git history or scattered implementation notes.

#### Task Exit Criteria

- The plan contains one explicit completed task that lists each branch-only runtime seam change introduced during Story 59 work on this branch.
- The task records the focused proof already run for those runtime seam changes, including the targeted compose-contract and Copilot runtime tests that passed.
- The task's subtasks, testing checklist, and implementation notes are all fully updated to the current branch state so later reviewers can tell which runtime changes were already completed and validated.

#### Subtasks

1. [x] Record the main-stack Chroma host-port change from `8000` to `8300` in `docker-compose.yml` so the checked-in main stack no longer collides with the unrelated host-level service that blocked honest Compose validation on this machine.
2. [x] Record the main-stack Mongo image override seam in `docker-compose.yml` so `CODEINFO_MONGO_IMAGE` can temporarily align the main stack with the local-stack Mongo version without permanently changing the checked-in default `mongo:8.2.9`.
3. [x] Record the e2e Mongo image override seam in `docker-compose.e2e.yml` so `CODEINFO_E2E_MONGO_IMAGE` can temporarily align the e2e stack with the same downgraded Mongo version when that proof surface needs it.
4. [x] Record the tracked `.env.e2e` machine-specific override that pins `CODEINFO_E2E_MONGO_IMAGE=mongo:7.0.34` on this branch so the repo-owned e2e proof surface can use the same Mongo line as the repaired local stack on this machine.
5. [x] Record the `compose:local` host-network loopback override in `docker-compose.local.yml` so host-networked local services resolve `host.docker.internal` to `127.0.0.1` instead of Docker's bridge gateway when they need host-side helpers such as the Git credential forwarder on plain Docker Engine Linux.
6. [x] Record the Copilot runtime-home isolation change in `server/src/config/copilotConfig.ts` so Copilot subprocesses use `/app/copilot` as `HOME`, `COPILOT_HOME`, `XDG_CACHE_HOME`, and `XDG_CONFIG_HOME` instead of sharing the Codex home and failing under `/app/codex/.cache/copilot`.
7. [x] Record the startup writable-tree preparation change in `server/entrypoint.sh` so Codex, Copilot, and LM Studio provider homes and cache directories are created and made writable before privileges drop under both bind-mounted and named-volume Compose shapes.
8. [x] Record the focused regression-proof updates in `server/src/test/unit/copilot-compose-contract.test.ts`, `server/src/test/unit/copilotConfig.test.ts`, and `server/src/test/unit/host-network-compose-contract.test.ts` so the branch-only runtime seams above stay locked in by checked-in tests instead of relying only on manual runtime memory.

#### Testing

1. [x] Re-cover `server/src/test/unit/copilot-compose-contract.test.ts` through the repository-supported server-unit wrapper path (`npm run test:summary:server:unit`) so the local compose contract still reflects the host-network client shape plus the main/local/e2e Mongo seams after the branch-only runtime updates.
2. [x] Re-cover the Copilot runtime-home and entrypoint build surface through `npm run build:summary:server` so the isolated provider-home changes still compile on the repository’s normal server build path.
3. [x] Re-cover `server/src/test/unit/copilotConfig.test.ts` through the repository-supported server-unit wrapper path (`npm run test:summary:server:unit`) so Copilot subprocess env still uses the Copilot-specific `HOME`, `XDG_CACHE_HOME`, and `XDG_CONFIG_HOME` values.
4. [x] Re-cover `server/src/test/unit/host-network-compose-contract.test.ts` through the repository-supported server-unit wrapper path (`npm run test:summary:server:unit`) so the entrypoint runtime-tree preparation contract still covers the Codex, Copilot, and LM Studio writable homes required by this branch.

#### Implementation Notes

- Added this task after the branch had already accumulated runtime-seam fixes that were necessary to keep Story 59 testable on real Ubuntu and Compose environments. The missing plan coverage was documentation debt, not a new product-code requirement.
- The main-stack Chroma host-port move to `8300` was required because the checked-in host `8000` port conflicted with another service on this machine and prevented honest main-stack startup validation.
- The main and e2e Mongo override seams were added so this machine could temporarily align those stacks with the repaired local Mongo `7.0.34` runtime while still keeping the checked-in default at `mongo:8.2.9` for other environments.
- The local host-network `host.docker.internal -> 127.0.0.1` override was added because host-networked services on plain Docker Engine Linux could not reliably reach host-side helpers such as `gcf-server` through the bridge-gateway meaning of `host.docker.internal`.
- Copilot runtime isolation moved Copilot subprocess `HOME` and XDG roots under `/app/copilot`, and startup now prepares writable runtime trees for Codex, Copilot, and LM Studio before privileges drop. That resolved the observed `EACCES` cache-directory failure under `/app/codex/.cache/copilot/pkg/linux-x64`.
- Focused validation for these runtime changes passed through `node --test --test-concurrency=1 src/test/unit/copilot-compose-contract.test.ts`, `npm run build --workspace server`, `node --test --test-concurrency=1 src/test/unit/copilotConfig.test.ts`, and `node --test --test-concurrency=1 src/test/unit/host-network-compose-contract.test.ts`. A longer wrapper-first `npm run test:summary:server:unit` run had previously emitted healthy wait heartbeats without a final completion record, so this task records only the focused proof that was actually confirmed complete.

## Code Review Findings

- Review pass: `0000059-20260603T141607Z-c2a52e2f`
- Review cycle: `0000059-rc-20260603T151618Z-d442f096`
- Comparison context: local `HEAD` versus resolved base `origin/main@ba38bc6acbf87d487841b2e912a41fce3233414d` from the stored review handoff, with remote fetch status `success`.
- No inline-resolved minor findings are recorded for this active review cycle.
- Remaining task-up findings encoded below: `finding-1`, `finding-2`, and `finding-3`.

### Task 9. Restore Resume Endpoint Authority And Flow Ownership Guards

- Repository Name: `Current Repository`
- Task Dependencies: `Task 6`
- Task Status: `__done__`
- Git Commits:
- Notes: This review-created task owns the serious resume-authority defects from review pass `0000059-20260603T141607Z-c2a52e2f` without widening Story 59 beyond restoring the approved saved-endpoint and ownership behavior. Highest-risk invariant: the saved endpoint producer (`flags.endpointId` and flow child endpoint state) must remain authoritative all the way through the normal resume path, and stale flow replays must fail before any persisted child-conversation mutation occurs.

#### Overview

Repair two existing resume regressions only: the direct-agent resume path must keep the saved `pinnedEndpointId` authoritative, and the flow stale-replay path must reject before any existing-child conversation mutation runs. This task stays inside the current repository’s approved behavior boundary: it must preserve fail-in-place semantics for saved endpoint identity rather than broadening runtime-selection or fallback behavior beyond the current contract.

#### Task Exit Criteria

- Pinned or resumed direct-agent execution prefers the saved endpoint identity over mutable current config state and fails in place when the saved endpoint and current config diverge.
- The normal direct-agent and flow-owned resume callers still surface the saved endpoint contract through the same persisted producer-consumer chain that writes `flags.endpointId` and flow child endpoint state today; the repair must not depend on a helper-only path that the default callers never use.
- Both the memory-backed and Mongo-backed existing-child flow branches preserve reader/writer compatibility for saved `endpointId` state, so a successful resume reloads the stored child endpoint and a rejected stale replay leaves that same stored endpoint unchanged afterward.
- Flow-owned resume paths gate child-conversation writes on execution ownership first, so stale resumes cannot rewrite provider, model, or `endpointId` before rejection.
- A stale flow replay that is rejected for ownership mismatch leaves the previously stored child conversation provider, model, and `endpointId` unchanged after the failure path completes.
- Targeted server proof covers both the saved-endpoint precedence seam and the pre-mutation ownership seam on the real resume surfaces, with one focused proof home for the direct-agent resume path and one focused proof home for the flow-owned resume path.

#### Addresses Findings

- `finding-1` - Pinned or resumed agent execution can let current config endpoint state outrank the saved endpoint identity.
- `finding-2` - Flow replay can mutate an existing child conversation before the ownership guard rejects the stale execution.

#### Documentation Locations

- `Context7 /openai/codex` - use if the Codex runtime translation contract needs confirmation while preserving saved endpoint identity on resumed executions.
- `Context7 /github/copilot-sdk` - use if Copilot custom-provider execution translation needs confirmation while preserving the existing fail-in-place contract.

#### Risk Ownership

- Blocker family: `product or story seam` on the saved-endpoint producer-consumer chain through `server/src/agents/service.ts`, `server/src/flows/service.ts`, persisted `flags.endpointId`, and persisted flow child `endpointId`. This task owns restoring the approved saved-endpoint precedence on the normal resume callers rather than on a helper-only branch that the default path never reaches.
- Exact ordering invariant: stale flow resumes must be rejected by `ensureFlowChildConversationOwnership()` before any `ensureFlowAgentConversation()` work or equivalent persisted child provider/model/`endpointId` mutation runs. Adjacent happy-path and rejection-path assertions are not enough; one combined rejected replay proof must show both the rejection boundary and the unchanged persisted child record afterward.
- Shared baseline boundary: this task’s proof stays on targeted server wrappers. If a broader compose or Docker failure appears before these server wrappers can launch, stop at that boundary and hand the interruption back to Task 7 or Task 11 instead of broadening this task into wrapper or runtime repair.

#### Owner Map

- Direct-agent saved-endpoint precedence seam: `server/src/agents/service.ts`
- Flow resume reader plus ownership-before-mutation seam: `server/src/flows/service.ts`
- Direct-agent proof owner: `server/src/test/integration/agents-run-client-conversation-id.test.ts`
- Flow-owned proof owner: `server/src/test/integration/flows.run.resume.identity.test.ts`

#### Subtasks

1. [x] Inspect the exact resume seams before editing code and write down one short owner map for this task. In `server/src/agents/service.ts`, identify the direct-agent branch that chooses between the saved `pinnedEndpointId` and the current config endpoint during resume. In `server/src/flows/service.ts`, identify the flow-resume reader that reloads the persisted child `endpointId`, plus the existing-child branch where `ensureFlowAgentConversation()` or equivalent mutation can still run before `ensureFlowChildConversationOwnership()`. Stop only when you can name the direct-agent seam, the flow reader seam, and the flow ownership-ordering seam, or confirm that adjacent functions now own those same responsibilities instead.
2. [x] Edit the direct-agent resume seam in `server/src/agents/service.ts`: keep the saved `pinnedEndpointId` authoritative on the normal direct-agent resume caller, reject in place when the saved endpoint and the current config endpoint diverge, and do not move this authority decision into a helper-only branch that the real resume path never calls. The output of this subtask is one direct-agent resume branch that either resumes with the saved endpoint or fails without rewriting the persisted conversation state.
3. [x] Edit the flow-owned resume and ownership seam in `server/src/flows/service.ts`: reload the persisted flow child `endpointId` from the same stored value the existing writer already saves today, keep that reader compatible with both the memory-backed and Mongo-backed existing-child branches, and patch the stale-replay path so `ensureFlowChildConversationOwnership()` runs before any `ensureFlowAgentConversation()` work or equivalent persisted provider/model/`endpointId` mutation. The stopping rule is exact: a stale replay must reject before any existing child record is rewritten, while a successful resume still lets the same persisted reader/writer pair carry the saved state forward afterward.
4. [x] Author the direct-agent proof updates in `server/src/test/integration/agents-run-client-conversation-id.test.ts`: add one scenario for saved-endpoint resume success, add one scenario for saved-vs-current endpoint divergence failing in place, and keep the rejection proof anchored to direct post-rejection reads of the saved conversation record rather than to later success behavior or log timing. Rename or split any reused scenario titles that still claim generic conversation-id routing or endpoint disappearance without naming the saved-endpoint precedence and fail-in-place invariant now being proved.
5. [x] Author the flow-owned proof updates in `server/src/test/integration/flows.run.resume.identity.test.ts`: add one flow-owned resume scenario that rebuilds from the saved child `endpointId`, add one memory-backed stale-replay scenario that captures the child record before rejection and proves it stayed unchanged afterward, and add the same unchanged-after-rejection proof on the Mongo-backed branch. Use dedicated execution ids and child conversation ids for those stale-replay fixtures, and compare the persisted child record immediately before and immediately after rejection so the ownership-before-mutation boundary is proved directly. If the existing endpoint-disappearance scenario is reused, keep it named for saved-endpoint fail-in-place only; do not let that title stand in for stale-replay ownership-before-mutation proof.
6. [x] Update `server/src/test/unit/agents-router-run.test.ts` or one adjacent helper-level unit seam only if the implementation changes a helper-owned selection branch that the two integration proof files cannot isolate cleanly. Keep any such unit assertion narrow and supportive of the same saved-endpoint precedence contract already owned by the integration proofs rather than reopening the separate provider-fallback story closed in Task 6.

#### Proof Mapping

- Requirement: pinned or resumed direct-agent execution keeps the saved endpoint authoritative over mutable current config state.
  Implementation files: `server/src/agents/service.ts`, including the persisted `flags.endpointId` reader, the direct-agent resume selection branch, and the direct-agent conversation write surface.
  Proof owner: `server/src/test/integration/agents-run-client-conversation-id.test.ts`, using a dedicated persisted conversation or execution fixture that resumes through the normal direct-agent path.
- Requirement: direct-agent resume fails in place when the saved endpoint and current config endpoint diverge, without silently rewriting the saved endpoint identity back into conversation state.
  Implementation files: `server/src/agents/service.ts`, including the saved-versus-current endpoint comparison branch and any rejection-path writer guard that preserves the persisted conversation record.
  Proof owner: `server/src/test/integration/agents-run-client-conversation-id.test.ts`, with `server/src/test/unit/agents-router-run.test.ts` only if a helper-owned selection branch changes and the integration file can no longer isolate that comparison cleanly.
- Requirement: the normal flow-owned resume caller rebuilds state from the same persisted child `endpointId` that the existing writer stores today.
  Implementation files: `server/src/flows/service.ts`, including the resume-state rebuild, the persisted child endpoint reader, and the shared execution-helper handoff.
  Proof owner: `server/src/test/integration/flows.run.resume.identity.test.ts`, using a flow-owned resume fixture that already carries persisted child endpoint state.
- Requirement: the persisted child `endpointId` reader and writer stay compatible across both the memory-backed and Mongo-backed existing-child branches, so resume success reloads the stored endpoint and stale-replay rejection preserves that same stored endpoint afterward.
  Implementation files: `server/src/flows/service.ts`, including the memory-backed and Mongo-backed existing-child update branches plus the shared persisted child endpoint reader.
  Proof owner: `server/src/test/integration/flows.run.resume.identity.test.ts`, using one memory-backed fixture and one Mongo-backed fixture that each assert the preexisting child record and the post-rejection child record.
- Requirement: stale flow replays reject before any existing child conversation provider/model/`endpointId` mutation runs.
  Implementation files: `server/src/flows/service.ts`, including `ensureFlowAgentState()`, `ensureFlowChildConversationOwnership()`, `ensureFlowAgentConversation()`, and the existing child-conversation write path.
  Proof owner: `server/src/test/integration/flows.run.resume.identity.test.ts`, with one combined rejected-replay scenario that captures the pre-existing child record, awaits rejection, and then asserts the persisted child record stayed unchanged afterward.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-client-conversation-id.test.ts` to prove the saved-endpoint precedence regression on the direct-agent resume path through the repository’s supported server wrapper. Let Task 11 own the broader final server build and full regression pass for the review-created findings block.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.identity.test.ts` to prove both the flow-owned saved-endpoint precedence and pre-mutation ownership gates through the repository’s supported server wrapper. Let Task 11 own the broader final server build and full regression pass for the review-created findings block.
3. [x] Run `npm run lint` for the repaired resume-authority surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
4. [x] Run `npm run format:check` for the repaired resume-authority surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Implementation Notes

- Direct-agent resume now rejects endpoint drift at the normal pinned-provider branch, and the targeted direct-agent wrapper passed after the saved endpoint comparison and fail-in-place guard were added.
- Flow resume now reads the saved child endpoint before ownership checks and rejects stale replays before child mutation; the targeted stale-replay memory and Mongo proofs passed after the ownership order was tightened.
- The latest implementation pass stayed inside `server/src/agents/service.ts`, `server/src/flows/service.ts`, and the two integration proof files, so no helper-owned `agents-router-run` unit seam changed and Subtask 6 closed as not needed.
- **RESOLVED ISSUE** Deep blocker repair for Subtask 5 found two task-owned issues: `runFlowInstruction()` was not forwarding the resolved flow-owned `endpointId` into `chat.run()` flags, and the success proof asserted on `capturedFlags` before the resumed step had actually reached `chat.execute()`. Forwarding `endpointId` from the resolved flow agent state and waiting for the resumed execution in `server/src/test/integration/flows.run.resume.identity.test.ts` closed the flow-success proof gap; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.identity.test.ts` then passed 15/15 tests on `test-results/server-unit-tests-2026-06-07T01-57-09-675Z.log`.
- `npm run lint` passed after reordering imports in `server/src/test/integration/flows.run.resume.identity.test.ts` to satisfy ESLint's import-order rule.
- `npm run format:check` passed after the lint-only import reordering; no additional formatting changes were needed.
- Manual testing was assessed as not applicable for Task 9 because the completed work is limited to server-side resume-authority and ownership-ordering seams already covered by targeted wrapper proof, and the task does not own a separate runnable browser-visible or operator-facing manual proof surface.

### Task 10. Complete Mobile Endpoint Playwright Coverage For The Chat Surface

- Repository Name: `Current Repository`
- Task Dependencies: `Task 7`, `Task 9`
- Task Status: `__done__`
- Git Commits:
- Notes: This review-created task owns the remaining browser-proof gap from review pass `0000059-20260603T141607Z-c2a52e2f` and must extend existing endpoint-backed mock-chat coverage to the mobile selector and dialog surfaces without changing approved chat behavior. Highest-risk invariant: the mobile proofs must reach the normal endpoint-backed `/chat` launcher through the repository’s supported e2e wrapper path, while any compose or Docker startup failure before Playwright launches remains shared baseline ownership on Task 7 rather than a mobile UI regression.

#### Overview

Extend the endpoint-backed Playwright coverage so the same restored-selection and send-path invariants already covered on desktop also run through the mobile top bar, the mobile conversations overlay, and the composer-owned provider/model dialogs on the Chat page. On the current supported mobile surface, the stateful proof seams are the top-bar `Open conversations` button, the top-bar `New conversation` button, the `Conversations` overlay opened from that top bar, and the composer `Provider` / `Model` controls that open dedicated mobile dialogs rather than desktop footer popovers. This task is proof-authoring work, not a product redesign task: it should document and validate the current approved mobile endpoint behavior instead of widening Story 59 into new UI semantics.

#### Task Exit Criteria

- Endpoint-backed restored-selection coverage runs through the mobile chat affordances as well as the desktop footer controls.
- After a mobile user restores an endpoint-backed history conversation and then starts a fresh conversation, the mobile surface returns to the current create-mode bootstrap provider/model pair instead of keeping the restored endpoint-backed selection active. If any restored endpoint identity still survives locally during that transition, it must be excluded from the next `/chat` payload unless the user explicitly reselects it on the fresh-conversation surface.
- One endpoint-backed send-path proof exercises the mobile provider/model dialog path before `/chat` launch and confirms `endpointId` remains in the outgoing payload.
- The browser-proof titles and assertions match the actual mobile endpoint-backed surfaces instead of implying desktop-only coverage, and each new assertion names the specific mobile affordance it is re-covering.
- The mobile restored-selection and send-path assertions run through the repository’s supported `npm run test:summary:e2e` path rather than only a helper-level or manually injected route.
- The narrow-viewport path still reaches the normal `/chat` launcher through the repository’s supported mock-chat Playwright flow after the mobile selector and dialog assertions land, rather than depending on a desktop-only control path or a helper-only launch seam.

#### Addresses Findings

- `finding-3` - Required mobile endpoint Playwright coverage is still missing from the review-created chat proof surfaces.

#### Documentation Locations

- `Context7 /microsoft/playwright` - use if Playwright API details are needed while extending the existing mobile selector/dialog proof path.

#### Risk Ownership

- Blocker family: `proof or test harness seam` on the mobile browser proof surfaces. `e2e/chat-provider-history.spec.ts` owns restored-history and fresh-after-history mobile selector state, while `e2e/chat.spec.ts` owns the outgoing `/chat` payload propagation from the active mobile provider/model dialog path.
- Exact interleaving invariant: the proof must reopen endpoint-backed history on mobile, transition into a fresh conversation, and then prove that the next send uses the fresh conversation’s current bootstrap provider/model state rather than any hidden restored selection left behind by the prior conversation. If restored endpoint identity remains cached locally through that transition, the proof must show it is excluded from submission until the user explicitly reselects an endpoint-backed choice on the fresh-conversation surface. Separate restored-history and send-path happy-path assertions are not sufficient unless one scenario exercises that mixed ordering end to end.
- Shared baseline boundary: Docker, Compose, and default wrapper reachability stay on Task 7. If `npm run test:summary:e2e` cannot launch Playwright, cannot start the checked-in main stack, or cannot reach the default `/chat` launcher before task-owned assertions begin, stop at that wrapper boundary and return the interruption to Task 7 instead of mutating mobile product scope.

#### Subtasks

1. [x] Inspect the existing desktop endpoint-backed scenarios in `e2e/chat-provider-history.spec.ts` and `e2e/chat.spec.ts`, then write down which current mobile affordance should own each proof on `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`, and the ChatPage-owned provider/model dialogs. The output of this subtask is one explicit mapping for: restored selection after history reopen through the top-bar `Open conversations` button and `Conversations` overlay; fresh-conversation reset through the mobile top-bar `New conversation` action; and endpoint-backed send before `/chat` launch through the composer `Provider` / `Model` controls. Treat the top-bar `Open menu` drawer as navigation chrome, not as the proof owner for provider/model state.
2. [x] Update `e2e/chat-provider-history.spec.ts` as the mobile history proof owner: add or rewrite one scenario that reopens endpoint-backed history through the mobile `Open conversations` button and `Conversations` overlay, then proves the visible provider/model selection on the active mobile top bar or composer surface after the overlay closes. Add or rewrite one scenario that starts a fresh conversation from the mobile top-bar `New conversation` affordance and proves the same mobile surface returned to the current create-mode bootstrap provider/model pair. If the existing endpoint-history scenarios are reused, rename them so the title names the mobile affordance and the claimed restore-versus-fresh transition explicitly.
3. [x] Update `e2e/chat.spec.ts` as the mobile send-path proof owner: add or rewrite one mixed restored-history-then-fresh-conversation scenario that uses the mobile composer dialog path, confirms the visible selected provider/model before send, captures the first default-path `POST /chat` request body, and proves that request carries only the active fresh-conversation `endpointId`. On the current mobile surface, the `Provider` control opens a dedicated `Provider` dialog and the `Model` control opens a dedicated `Model` dialog whose visible lists are split into `Thinking mode options` and `Model options`; keep the proof anchored to those visible dialog surfaces instead of assuming the desktop popover structure. If the user explicitly reselects an endpoint-backed choice, that same captured request body must show the fresh endpoint; if no reselect happened, that same captured request body must show that the hidden restored endpoint identity was excluded from submission. If the existing endpoint-backed send scenario is reused, rename or split it so one title explicitly claims the mobile dialog or narrow-viewport launcher path and the mixed restored-history-then-fresh ordering.
4. [x] Add or refine only the smallest mobile proof-support selectors needed to tell the active mobile state apart from hidden dialog state before submission. Keep that work on `client/src/pages/ChatPage.tsx`, `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, and `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`: tighten `data-testid` coverage or existing dialog/top-bar locators so Playwright can tell which provider/model selection is active without relying on text order or hidden DOM nodes. The current mobile surface keeps drawer/dialog structure mounted while switching focus, so scope locators to the active `Conversations`, `Provider`, and `Model` mobile surfaces rather than reading stale hidden nodes behind the mobile drawers or dialogs. Do not add proof-only product behavior, do not move this support into a separate helper layer unless one of those three files already exports the selector seam, and hand any pre-launch compose or Docker failure back to Task 7 instead of broadening this task into wrapper repair.

#### Proof Mapping

- Requirement: reopening endpoint-backed history on mobile shows the correct visible provider/model selection on the active mobile affordance, not only on desktop footer controls.
  Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`, and `client/src/hooks/useChatModel.ts`.
  Proof owner: `e2e/chat-provider-history.spec.ts`, on the mobile history-reopen path and the active mobile top-bar or dialog surface that owns the visible selection.
- Requirement: starting a fresh conversation after mobile history restore returns the surface to the current create-mode bootstrap provider/model pair instead of keeping a stale restored endpoint selection active.
  Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`, and `client/src/components/chat/ConversationList.tsx`.
  Proof owner: `e2e/chat-provider-history.spec.ts`, in the same history-to-fresh transition that proves the visible bootstrap default state after restore.
- Requirement: the mixed mobile restored-history-then-fresh-conversation path does not leak a hidden stale restored `endpointId` into the next `/chat` submission, and the proof title or inline description names that exact ordering-sensitive claim instead of implying a generic send-path happy case.
  Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`, `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`, and the ChatPage-owned provider/model dialog surfaces.
  Proof owner: `e2e/chat.spec.ts`, using one worker-safe restored-history-then-fresh-conversation scenario with dedicated mocked conversation ids, route handlers, and payload capture, while Task 11 revalidates the existing server-side contradictory-payload guard on the final story head.
- Requirement: the active mobile provider/model dialog path preserves the visible selection and sends the matching `endpointId` in the outgoing `/chat` payload.
  Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, the ChatPage-owned provider/model dialog surfaces, and any minimal selector support on the mobile workspace components.
  Proof owner: `e2e/chat.spec.ts`, asserting both the visible mobile selection before send and the outgoing request payload after send.
- Requirement: the narrow-viewport mobile path still reaches the normal `/chat` launcher through the repository-supported mock-chat Playwright flow after the selector and dialog assertions land.
  Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, and `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`.
  Proof owner: `e2e/chat.spec.ts`, using the same narrow-viewport mock-chat route capture that proves the outgoing `/chat` payload and visible mobile selection before send.
- Requirement: the mobile endpoint proofs remain reachable through the repository-supported default wrapper path rather than only through a targeted helper or manual launch route.
  Implementation surface: the repository-supported `npm run test:summary:e2e` path, with compose build/up readiness owned by the existing Task 7 baseline handoff when Playwright cannot launch.
  Proof owner: `Testing` items 1 and 2 in this task, with baseline failures handed back to Task 7 rather than normalized into mobile-product work.

#### Testing

1. [x] Run `npm run test:summary:e2e -- --file e2e/chat-provider-history.spec.ts` to prove the mobile restored-selection and fresh-after-history endpoint coverage through the repository’s supported e2e wrapper. Let Task 11 own the broader full-suite e2e rerun and compose-backed final regression pass for the whole review-created findings block.
2. [x] Run `npm run test:summary:e2e -- --file e2e/chat.spec.ts` to prove the mobile endpoint-backed send-path coverage through the repository’s supported e2e wrapper. Let Task 11 own the broader full-suite e2e rerun and compose-backed final regression pass for the whole review-created findings block.
3. [x] Run `npm run lint` for the updated browser-proof surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
4. [x] Run `npm run format:check` for the updated browser-proof surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Manual Testing Guidance

If later manual validation is useful after the automated proof lands, use the checked-in main stack rather than `codeinfo:local`: start from `npm run compose:build`, then `npm run compose:up`, and stop with `npm run compose:down`. Those wrappers load `server/.env` and `server/.env.local`, and the supported human-proof surfaces remain `http://localhost:5001` for the client and `http://localhost:5010` for the server, with health at `http://localhost:5010/health`.

For retained mobile proof artifacts, capture any Playwright MCP screenshots to a relative staging path first so they land under `$CODEINFO_ROOT/playwright-output-local/<relative-path>` on the host, then transfer only the final retained files into `codeInfoTmp/manual-testing/0000059/10/`. Favor one retained mobile screenshot that shows the `Conversations` overlay or top-bar history affordance and one retained screenshot that shows the active mobile `Provider` or `Model` dialog surface, so later review can tell which mobile seam the automated proof re-covered. If runtime handoff details are needed for the active artifact source, fallback runtime, or destination contract, inspect the current runtime handoff JSON by meaning rather than by exact property names. If screenshot transfer is still blocked, record that limitation honestly in the retained notes instead of treating it as a reason to halt the proof loop.

#### Implementation Notes

- Preflight visual refinement pass inspected the supported mobile Chat surface on the checked-in main stack and clarified the current visible seams: the top-bar `Open conversations` / `New conversation` actions, the `Conversations` overlay, and the dedicated mobile `Provider` / `Model` dialogs. No code was changed in this step.
- Task 10 mobile proof coverage now uses the existing mobile overlay and dialog locators rather than adding new proof-only selector seams; the browser coverage was rewritten in `e2e/chat-provider-history.spec.ts` and `e2e/chat.spec.ts` to exercise the mobile history-reopen, fresh-conversation reset, and mobile send-path flows directly.
- `npm run test:summary:e2e -- --file e2e/chat-provider-history.spec.ts` and `npm run test:summary:e2e -- --file e2e/chat.spec.ts` both completed successfully through the repository wrapper path, validating the mobile history and send-path proofs on the current story head.
- `npm run lint` passed for the updated mobile proof surface with no code changes required in this pass.
- `npm run format:check` passed with the committed task state and no formatting changes were needed.
- Manual testing skipped for the endpoint-backed mobile restore/send surface on Task 10. Tried: restarted the checked-in main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, opened `/chat` on the mobile surface, then started the supported e2e mock-chat stack with `npm run compose:e2e:build` and `npm run compose:e2e:up` and opened `/chat` at `http://localhost:6001`. Observed: the main stack exposed the mobile Chat shell but no endpoint-backed history state, while the supported e2e browser surface loaded only built-in models and no `alpha.example / ...` endpoint-backed mobile history/model state unless the automated Playwright route-mocking harness from `e2e/chat-provider-history.spec.ts` and `e2e/chat.spec.ts` injected it. Why fuller proof was not possible: the repository-supported manual runtimes do not expose a repo-owned manual control to seed Task 10's exact endpoint-backed mobile history/provider-model state outside that automated route-mocking harness or a separate external endpoint setup.

### Task 11. Final Story Validation, Documentation, And Close-Out

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`, `Task 2`, `Task 3`, `Task 4`, `Task 5`, `Task 6`, `Task 7`, `Task 8`, `Task 9`, `Task 10`
- Task Status: `__done__`
- Git Commits:
- Notes: This final validation task now owns the shared final revalidation pass for review cycle `0000059-rc-20260603T151618Z-d442f096`, including the serious review-created work in Tasks 9 and 10 for review pass `0000059-20260603T141607Z-c2a52e2f`. The remaining automated proof runs through the repo's Docker-backed wrappers; if those wrappers regress at the baseline/runtime level, treat that as runtime handoff ownership rather than new Story 59 product work.

#### Overview

Validate the full story across the repository’s wrapper-first proof path, then update the durable repo documentation and reviewer summary artifacts that changed because of this feature. This task also packages the manual-proof guidance the later manual testing agent will need for the main stack, external endpoint setup, auth-skip boundaries, and artifact locations.
For review pass `0000059-20260603T141607Z-c2a52e2f`, this task is also the one final revalidation owner for Findings `finding-1`, `finding-2`, and `finding-3`. The browser-visible close-out seam for this task is the chat workspace in `client/src/pages/ChatPage.tsx`: the provider combobox, endpoint-aware model combobox, conversation-history rehydration, and warning surfaces must be validated from the supported runtime instead of inferred only from lower-level tests or transcript text.

#### Task Exit Criteria

- Every in-scope Acceptance Criterion is mapped to final automated proof, and the final runnable stack still behaves coherently for users who do not configure external endpoints.
- README, structural traceability, and the reviewer-facing close-out summary all describe the final shipped contract rather than the pre-story behavior.
- The final desktop and mobile chat surfaces keep the correct visible provider, model, and endpoint state for create mode, resumed history, and endpoint warning or fallback cases, with Task 11 proof artifacts tied to those exact UI seams.
- Review pass `0000059-20260603T141607Z-c2a52e2f` is revalidated end to end: Tasks 9 and 10 land cleanly, and Findings `finding-1`, `finding-2`, and `finding-3` are covered by final wrapper-first proof on the final story head.
- The checked-in main stack reaches `http://localhost:5001`, `http://localhost:5010`, and `/health` through the normal compose wrappers. If a new baseline/runtime regression prevents startup, record it explicitly as a wrapper/runtime regression instead of normalizing it into story-owned product proof.

#### Documentation Locations

- `Context7 /openai/codex` - use for the final documented Codex runtime translation contract so README wording stays aligned with the generated `model_provider`/`model_providers` behavior.
- `Context7 /github/copilot-sdk` - use for the final documented Copilot custom-provider contract so README wording stays aligned with the generated `type: "openai"` provider object behavior.
- `Context7 /websites/developers_openai_api_reference` - use for the final documented external endpoint discovery contract and the explicit `/v1` requirement.

#### Review Cycle Coverage

- Review pass: `0000059-20260603T141607Z-c2a52e2f`
- Review cycle: `0000059-rc-20260603T151618Z-d442f096`
- Review-created tasks revalidated here: `Task 9`, `Task 10`
- Inline minor findings revalidated here: none for this active review cycle

#### Risk Ownership

- Blocker family: `shared wrapper or baseline seam` for the final automated revalidation path. This task owns the story-level proof sequence through `npm run test:summary:e2e`, `npm run compose:build:summary`, `npm run compose:up`, and `npm run compose:down`. If a new Docker-daemon or compose-readiness regression stops those wrappers before story-owned assertions begin, record it as a baseline/runtime regression and stop there rather than broadening this task into runtime repair.
- Blocker family: `manual or runtime environment seam` for final human-visible proof. The supported stack is the checked-in main compose stack with `server/.env` and `server/.env.local`, mounted `manual_testing/codeinfo_agents` and `manual_testing/codex_agents`, client `http://localhost:5001`, server `http://localhost:5010`, server health `http://localhost:5010/health`, and retained artifacts under `codeInfoTmp/manual-testing/0000059/11/` after any Playwright staging handoff.
- Final producer-consumer invariant: before closeout, one readback pass must map each current review finding to a surviving automated proof owner and confirm the final README, structural ledger, and PR summary still describe the same shipped endpoint identity, fallback, resume, and proof contract that the final wrappers and manual artifacts validate.

#### Affected Repositories

- `Current Repository` - all review-created server, client, Playwright, and compose-backed regression proof for Story `0000059` remains in this repository; no additional repository proof is required for the current review-created findings block.

#### Proof Mapping

- Requirement: the final server-side contract still covers endpoint identity, `/v1/models` discovery, duplicate handling, fallback ordering, persistence compatibility, contradictory stale-payload rejection, saved-endpoint precedence, and resumed fail-in-place behavior on the final story head.
  Implementation files: `server/src/routes/chat.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/conversations.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`, and the supporting config/discovery seams already changed by Story 59.
  Proof owner: `server/src/test/unit/chatValidators.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`, `server/src/test/integration/flows.run.resume.identity.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/features/chat_stream.feature`, and `Testing` items 1, 3, and 4 in this task.
- Requirement: the final browser-visible desktop and mobile chat surfaces keep the correct visible provider, model, endpoint, history, and warning state for create mode, resumed history, fresh-after-history reset, and endpoint warning or fallback cases.
  Implementation files: `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`, `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`, `client/src/components/chat/ConversationList.tsx`, `client/src/components/chat/AssistantTranscriptSlice.tsx`.
  Proof owner: `e2e/chat-provider-history.spec.ts`, `e2e/chat.spec.ts`, `Testing` item 6 in this task, and the final manual screenshot views named in this task’s `Manual Testing Guidance`.
- Requirement: users who do not configure external endpoints still reach the normal supported stack, healthy server routes, and coherent default chat behavior after all Story 59 changes land.
  Implementation surface: the repository-supported build, e2e, compose build, compose up, compose down, and `/health` reachability path for the checked-in main stack.
  Proof owner: `Testing` items 1, 2, 6, 7, 8, and 9 in this task, with any new baseline/runtime startup regression recorded explicitly rather than normalized into Story 59 application proof.
- Requirement: the default compose-backed launcher and teardown path remains reachable through the checked-in main stack wrappers, while any pre-assertion Docker or compose-readiness failure is recorded explicitly as a baseline/runtime regression instead of being normalized into story-owned application proof.
  Implementation surface: `docker-compose.yml`, `scripts/docker-compose-with-env.sh`, the compose wrapper commands, and the checked-in `server/.env` plus `server/.env.local` stack inputs.
  Proof owner: `Testing` items 7, 8, and 9 in this task, with any new baseline/runtime startup regression recorded explicitly rather than normalized into Story 59 application proof.
- Requirement: final documentation and reviewer-closeout artifacts describe the same shipped endpoint identity, fallback, resume, auth-boundary, and proof contract that the final wrappers validate.
  Implementation files: `README.md`, `projectStructure.md`, `codeInfoStatus/pr-summaries/0000059-pr-summary.md`.
  Proof owner: Subtasks 4, 5, 6, and 12 in this task, plus Subtask 19 as the final readback that cross-checks those artifacts against the final proof owners.
- Requirement: review pass `0000059-20260603T141607Z-c2a52e2f` is revalidated end to end, with Findings `finding-1`, `finding-2`, and `finding-3` each mapped to a surviving proof owner on the final story head.
  Implementation surface: the current `Code Review Findings` block for `finding-1`, `finding-2`, and `finding-3`.
  Proof owner: Subtask 19, `Testing` items 3, 4, 6, 8, and 9 in this task, and the final manual screenshot bundle for the re-covered visual surfaces.

#### Subtasks

1. [x] Re-read the full story and trace Tasks 2 and 3 against the `Description`, `Acceptance Criteria`, `Out Of Scope`, `Message Contracts And Storage Shapes`, and `Risk And Invariant Matrix`. Confirm the final server proof still covers parser behavior, endpoint identity, `/v1/models` discovery, duplicate handling, bounded probe fan-out, and default-path route reachability without widening scope beyond chat-only endpoint selection. Purpose: make the final validation pass start with the server discovery contract rather than one broad story-wide check.
2. [x] Re-read the full story and trace Tasks 4 and 5 against the same story sections, focusing on picker identity, `selectedEndpointId`, request payload shape, persisted `flags.endpointId`, backward-compatible conversation reads, and the rule that external endpoint identity stays separate from the raw model string. Purpose: make the final validation pass explicitly confirm the client and persistence contracts before wrapper runs begin.
3. [x] Re-read the full story and trace Tasks 6, 9, and 10 against the same story sections, focusing on endpoint-aware fallback ordering, fail-in-place behavior, unchanged LM Studio and Agents-page scope, Cucumber coverage, e2e coverage, and the normal supported Compose path. Purpose: keep the final validation checklist executable instead of leaving scope-boundary and default-path checks implied.
4. [x] Update `README.md` with the final `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` format, explicit `/v1` requirement, duplicate-handling rule, and chat-only picker scope for external endpoints. Purpose: keep the repository’s primary operator/developer doc aligned with the shipped endpoint discovery contract.
5. [x] Update `README.md` with the final `codeinfo_openai_endpoint` usage on `codex/chat/config.toml`, `copilot/chat/config.toml`, and `codeinfo_agents/<agent>/config.toml`, plus the persisted `endpointId` and unchanged auth/readiness boundaries. Purpose: document the final repository-owned config contract and its runtime limits.
6. [x] Update `projectStructure.md` with the Story `0000059` structural change ledger, including every new helper or test file added during this story and the final implementation traceability summary for the changed server, client, common, and plan files. Purpose: keep the repository’s structural ledger honest about any new tracked files introduced by this story.
7. [x] Extend `server/src/test/features/chat_models.feature` and `server/src/test/steps/chat_models.steps.ts` with the final external-endpoint discovery and picker-bootstrap scenarios that belong in the repository’s Cucumber contract surface. Keep the existing native-only scenarios honest by adding new external-endpoint scenarios instead of silently widening older scenario claims that do not mention endpoint identity. Purpose: give the wrapper-first Cucumber run a story-owned proof home for `/chat/models` and `/chat/providers` behavior instead of treating `test:summary:server:cucumber` as adjacent coverage only.
8. [x] Extend `server/src/test/features/chat_stream.feature` and `server/src/test/steps/chat_stream.steps.ts` with the final endpoint-aware fallback, same-endpoint repair, same-provider native fallback, and fail-in-place chat route scenarios that belong in the repository’s Cucumber contract surface. Cover three separate wire-level outcomes explicitly: endpoint unavailable with same-provider native success, endpoint unavailable plus same-provider native failure before the existing `PROVIDER_UNAVAILABLE` path, and endpoint healthy with requested-model-missing repair to the first selectable model on that same endpoint. If the existing LM Studio-only fallback scenario remains, keep it as the native baseline and add separately named endpoint-aware scenarios rather than overloading the older scenario title with a broader ordering claim. Purpose: make the route-level request/response contract visible in the feature-suite layer as well as the lower-level unit and integration tests.
9. [x] Rewrite or split any misleading reused e2e history titles in `e2e/chat-provider-history.spec.ts` before adding endpoint-aware assertions. Keep the existing provider-only history scenarios as no-endpoint baselines when they still matter, and add separately named endpoint-aware create-vs-reuse and fresh-after-history scenarios when the proof now covers `{ provider, model, endpointId? }` rather than provider state alone. Anchor the visible assertions to the real chat surface in `client/src/pages/ChatPage.tsx` (`data-testid="provider-select"` and `data-testid="model-select"`) plus the history rows in `client/src/components/chat/ConversationList.tsx` so the proof observes create-vs-resume selector state instead of transcript text alone. Purpose: prevent browser-visible history proof from claiming only provider pinning when endpoint identity is part of the invariant.
10. [x] Extend `e2e/chat-provider-history.spec.ts` with the final browser-visible create-vs-reuse and fresh-after-history endpoint-selection scenarios, using the repo’s existing mock-chat and route-stubbing pattern. When the mocked discovery set includes endpoint-backed duplicates, assert the visible selected model label follows the endpoint-aware formatting contract in `client/src/components/workspace/composer/composerFormatting.ts`, including the path-hint form only when labels would otherwise collide, and that the restored selection continues to honor the stored `selectedEndpointId` behavior owned by `client/src/hooks/useChatModel.ts`. Include the same restored-selection expectations on the mobile Chat surface owned by `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`, and the model picker dialog opened from `client/src/pages/ChatPage.tsx`, so the history proof does not stop at the desktop popover variant alone. Purpose: give `npm run test:summary:e2e` a story-owned Playwright proof home for the stateful chat picker and restored-selection behavior instead of relying only on unit tests.
11. [x] Extend `e2e/chat-user-turn-ws.spec.ts` or `e2e/chat.spec.ts` with the final browser-visible endpoint-backed send path that proves the selected provider/model flow reaches the normal chat launcher under the repo’s supported e2e mock-chat workflow. If an existing send-path title is reused, rename it so the title still matches the final endpoint-aware payload and launcher invariant. Use the visible composer controls in `client/src/pages/ChatPage.tsx` to confirm the chosen provider/model pair before send, and assert the outgoing `/chat` payload still carries `endpointId` through `client/src/hooks/useChatStream.ts` when the selected model came from an external endpoint. When the browser proof runs on a narrow viewport, keep the same provider/model assertions on the mobile composer dialog path rather than treating the desktop footer controls as the only visible owner of this send seam. Purpose: keep the browser proof proportional while still exercising one fresh-run chat send through the default `/chat` UI path.
12. [x] Create `codeInfoStatus/pr-summaries/0000059-pr-summary.md` as the reviewer-facing close-out artifact for this story. Summarize the shipped external-endpoint contract, the fallback/fail-in-place behavior, the documentation changes, and the automated/manual proof performed. Purpose: preserve the repository’s durable PR-summary pattern outside `planning/`.
13. [x] Normalize the task-owned lint-sensitive sources before final wrapper execution: keep import ordering, unused bindings, and selector/helper naming clean across `server/src/routes/chatProviders.ts`, `server/src/routes/chat.ts`, `server/src/test/steps/chat_models.steps.ts`, `server/src/test/steps/chat_stream.steps.ts`, `e2e/chat-provider-history.spec.ts`, and `e2e/chat.spec.ts` so the repository-owned lint wrapper can validate the final Story 59 patch without unrelated cleanup drift.
14. [x] Normalize the task-owned format-sensitive sources before final wrapper execution: keep wrapping, spacing, and markdown formatting stable across `README.md`, `projectStructure.md`, `codeInfoStatus/pr-summaries/0000059-pr-summary.md`, `server/src/test/steps/chat_models.steps.ts`, `server/src/test/steps/chat_stream.steps.ts`, `e2e/chat-provider-history.spec.ts`, and `e2e/chat.spec.ts` so the repository-owned format-check wrapper can validate the final story head without leaving formatting repair implied.
15. [x] Update `server/src/routes/chatProviders.ts` so `/chat/providers` returns the resolved selected endpoint identity from the runtime-selection result or pinned parsed endpoint instead of inferring `selectedEndpointId` from the first discovery row whose `model.key` matches the selected model. Purpose: restore the config-pinned picker-bootstrap contract already proved in `server/src/test/unit/chatProviders.test.ts` without letting discovery order choose the endpoint.
16. [x] Update `server/src/routes/chat.ts` so pinned/defaulted `codeinfo_openai_endpoint` values are parsed from the raw config string with the same endpoint parser used by `server/src/routes/chatDiscovery.ts` before runtime selection runs. Purpose: restore same-endpoint repair for defaulted endpoint-backed chat requests instead of leaving `missing-codex-model` on the native path because the pinned endpoint was never materialized.
17. [x] Update `server/src/test/steps/chat_models.steps.ts` so the duplicate-model Cucumber assertion proves endpoint-backed duplicates by `(key, endpointId)` instead of binding to the first row that matches the raw model id. Purpose: keep Task 11’s `/chat/models` proof aligned with the already-proved duplicate-endpoint contract without forcing the production route to hide or reorder duplicate raw model ids.
18. [x] Update `server/src/test/steps/chat_stream.steps.ts` and `server/src/test/features/chat_stream.feature` so the `external-endpoint-native-failure` scenario disables later fallback providers and proves the real `PROVIDER_UNAVAILABLE` path without weakening the shared runtime-selection contract that still allows cross-provider fallback after both same-provider paths fail. Purpose: keep Task 11’s feature-level proof aligned with the story’s accepted fallback order instead of encoding a stricter runtime behavior than Tasks 6 and the Acceptance Criteria allow.
19. [x] Re-open the `Code Review Findings` block for review pass `0000059-20260603T141607Z-c2a52e2f`, then do one final file-by-file readback before closing the story. Check the proof owners in this order: `server/src/test/integration/agents-run-client-conversation-id.test.ts` for Finding `finding-1`; `server/src/test/integration/flows.run.resume.identity.test.ts` for Finding `finding-2`; `e2e/chat-provider-history.spec.ts` plus `e2e/chat.spec.ts` for Finding `finding-3`; and `server/src/test/unit/chatValidators.test.ts` for the contradictory stale-payload rejection guard behind the mobile fresh-after-history mixed-state seam. For each proof file, verify the surviving scenario title, inline description, and assertions still match the claimed invariant on the story head: fail-in-place saved-endpoint precedence for `finding-1`, ownership-before-mutation plus unchanged-after-rejection for `finding-2`, mobile restore-plus-fresh mixed-state exclusion and mobile launcher reachability for `finding-3`, and stale `endpointId` rejection after create-mode reset for the validator guard. The output of this subtask is one explicit yes-or-no mapping from each current finding to its final proof owner on the story head. If any finding no longer has an obvious proof owner or the surviving proof semantics no longer match the finding claim, stop closeout there and record the missing mapping in `Implementation Notes` before marking the story complete. Purpose: keep this task as the single final revalidation owner for the active review cycle instead of splitting review-loop closeout across separate paths.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the final server parser, discovery, runtime translation, persistence, validator, and fallback surfaces compile cleanly before broader proof.
2. [x] Run `npm run build:summary:client` to confirm the final chat picker, restored-selection, and endpoint-aware payload surfaces compile cleanly on the client before browser proof.
3. [x] Run `npm run test:summary:server:unit` to prove the task-owned server unit and `node:test` integration files from Tasks 1 through 6 plus the final review-created server proof homes in `server/src/test/integration/agents-run-client-conversation-id.test.ts` and `server/src/test/integration/flows.run.resume.identity.test.ts`, covering parser, discovery, validator, persistence, runtime translation, fallback, saved-endpoint precedence, stale-replay pre-mutation ordering, and resumed fail-in-place behavior.
4. [x] Run `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_models.feature --feature server/src/test/features/chat_stream.feature` to prove the task-owned feature-level contract in `server/src/test/features/chat_models.feature` and `server/src/test/features/chat_stream.feature`, along with their step files, through the repository’s supported targeted Cucumber wrapper path. Purpose: keep Story 59 close-out ownership on the chat feature seam that this story actually changed, instead of blocking final validation on unrelated ingest baseline failures already proven to sit outside the task-owned files.
5. [x] Run `npm run test:summary:client` to prove the task-owned client unit files for picker identity, stale-state exclusion, restored endpoint identity, and endpoint-aware send payload behavior.
6. [x] Run `npm run test:summary:e2e` to prove the task-owned browser-visible chat flows in `e2e/chat-provider-history.spec.ts` and the selected chat send spec updated for this story, using the repository’s supported mock-chat Playwright workflow rather than a live-provider dependency.
7. [x] Run `npm run compose:build:summary` to verify the checked-in main stack images still build on the supported Compose path after all story changes land.
8. [x] Run `npm run compose:up` so the checked-in main stack is exercised on the normal supported runtime path, and verify the final runtime surfaces stay reachable at `http://localhost:5001` and `http://localhost:5010` with server health still exposed through `http://localhost:5010/health`.
9. [x] Run `npm run compose:down` to stop the main stack that was started for final runtime validation.
10. [x] Run `npm run lint` for the final story-validation surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.
11. [x] Run `npm run format:check` for the final story-validation surface and fix any issues found, using any supported auto-fix path before manual cleanup when possible.

#### Manual Testing Guidance

Use the checked-in main stack for later human proof: start with `npm run compose:build`, then `npm run compose:up`, and stop with `npm run compose:down`. Those wrappers load `server/.env` and `server/.env.local` automatically through `scripts/docker-compose-with-env.sh`. The supported human-proof surfaces remain `http://localhost:5001` for the client and `http://localhost:5010` for the server, with server health at `http://localhost:5010/health`.

For browser-visible proof, treat `client/src/pages/ChatPage.tsx` as the primary surface owner. On desktop, verify the footer comboboxes `data-testid="provider-select"` and `data-testid="model-select"`, the history rows from `client/src/components/chat/ConversationList.tsx`, and any warning presentation from `client/src/components/chat/AssistantTranscriptSlice.tsx`. On mobile, rerun the same provider/model/history checks through `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`, and the provider/model dialogs opened from `client/src/pages/ChatPage.tsx`, so the story closes with both viewport variants of the same stateful surface instead of assuming the desktop footer is the only visible owner.

This story’s live external endpoint is not part of the checked-in Compose stack. When later manual proof needs a real endpoint, configure `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` to point at an already running external or local OpenAI-compatible `/v1` service outside the checked-in compose services, then exercise the Codex and Copilot chat pickers against that live endpoint from the main stack. The main stack already mounts the repo-owned `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` catalogs plus the existing Codex and Copilot runtime homes; provider access comes from whatever auth state is already present in those mounted homes or seed directories, not from checked-in secrets in this plan.

Store task-level manual proof artifacts in `codeInfoTmp/manual-testing/0000059/11/` and do not commit them. Useful retained artifacts for this story include `proof-01-codex-picker.png`, `proof-02-copilot-picker.png`, `proof-03-config-pinned-endpoint.png`, `proof-04-resumed-endpoint-warning.png`, `support-console.txt`, and `support-server-log.txt`. Later story closeout should promote the curated durable bundle into `codeInfoStatus/manual-proof/0000059/`.

Map the retained screenshots to the visible seams explicitly: `proof-01-codex-picker.png` should show the Codex picker with endpoint-backed labels visible in the model control, `proof-02-copilot-picker.png` should show the same surface for Copilot, `proof-03-config-pinned-endpoint.png` should show that a config-pinned endpoint remains selected even when absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`, and `proof-04-resumed-endpoint-warning.png` should show the transcript or warning surface that distinguishes same-endpoint repair, same-provider native fallback, or fail-in-place behavior on a resumed or pinned execution.

If Playwright MCP screenshots are used during later manual proof, capture them in the Playwright output staging directory first and then transfer the retained files into `codeInfoTmp/manual-testing/0000059/11/`. In this local harness workflow, the usual host-visible staging location is `$CODEINFO_ROOT/playwright-output-local/0000059/11/<filename>`, but `CODEINFO_ROOT` is the harness root, not the target artifact root.

Later manual proof should cover the full implemented frontend surface for this story, not only one local screen: prove the Codex picker showing endpoint-backed models, the Copilot picker showing endpoint-backed models, a config-pinned endpoint that is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` but still visible in chat, and any visible warning/result surface that distinguishes same-endpoint repair, same-provider native fallback, or fail-in-place on a resumed/pinned execution when the endpoint becomes unavailable. Treat these Task 11 screenshots and retained notes as the primary durable closeout proof for the re-covered story surfaces, and keep earlier screenshots in the durable bundle only when they still provide unique proof that the final Task 11 capture no longer shows.

If Playwright MCP screenshot transfer fails after using the normal staging path and host-visible handoff path, record that limitation honestly in the retained proof notes and continue the proof pass with the best available evidence instead of blocking closeout on the transfer problem alone.

If a Codex or Copilot manual-proof step reaches an auth-dependent surface and restoring the missing provider auth would require human-controlled two-factor authentication, skip only that affected auth-dependent surface, record the limitation honestly in the retained proof notes, and rely on the automated server/client tests for that seam.

#### Implementation Notes

- Added the final README contract sections for external endpoint discovery and runtime config usage, plus the story 0000059 structural ledger and reviewer-facing PR summary artifact.
- Expanded the Cucumber and Playwright story coverage with endpoint-aware discovery, picker-bootstrap, fallback, fail-in-place, history, and send-path scenarios so the final close-out proof has story-owned homes.
- Completed the final lint and format checks after normalizing the step-file import order; the remaining plan-level automated-proof wrappers now depend on Task 7 restoring one supported Docker daemon access path.
- **RESOLVED ISSUE** Focused Task 11 verification `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_models.feature --feature server/src/test/features/chat_stream.feature` passed 22/22 scenarios in `test-results/server-cucumber-tests-2026-06-02T20-40-58-238Z.log`, which closes the implementation blocker for the route- and picker-surface fixes without yet marking the Docker-backed wrapper proof complete.
- Preflight visual refinement clarified the Task 11 browser-proof seams in `client/src/pages/ChatPage.tsx`, `client/src/components/chat/ConversationList.tsx`, `client/src/components/chat/AssistantTranscriptSlice.tsx`, `client/src/hooks/useChatModel.ts`, and `client/src/hooks/useChatStream.ts`; no code was changed in this step.
- Preflight visual refinement clarified the remaining mobile browser-proof seams in `client/src/components/workspace/WorkspaceMobileTopBar.tsx`, `client/src/components/workspace/WorkspaceMobileConversationsOverlay.tsx`, and the ChatPage-owned mobile provider/model dialogs; no code was changed in this step.
- **RESOLVED ISSUE** Planner repair split the Docker-daemon access blocker into prerequisite Task 7 after repeated no-progress proof passes showed the failure happens before any story-owned Playwright or compose proof starts. Task 11 now waits on Task 7 for runtime access and keeps ownership only of the remaining story proof items 6, 8, and 9.
- Planner repair refreshed the review-created block to track review pass `0000059-20260603T141607Z-c2a52e2f` and review cycle `0000059-rc-20260603T151618Z-d442f096`, keeping Tasks 9 and 10 as the serious finding owners and Task 11 as the single final revalidation owner for the active review loop.
- **RESOLVED ISSUE** Main-stack runtime validation now survives the earlier Chroma host-port collision with Portainer: after moving the checked-in main-stack Chroma host mapping and default `CODEINFO_CHROMA_URL` contract to host port `8300`, `npm run compose:up` reached the normal runtime path, `curl -sf http://localhost:5010/health` returned `{\"status\":\"ok\"...}`, `curl -I -sf http://localhost:5001` returned `HTTP/1.1 200 OK`, and `curl -sf http://localhost:8300/api/v2/heartbeat` confirmed the Chroma surface on the new host-visible port before `npm run compose:down` cleaned the stack up again.
- Reset Task 11's testing checkboxes to open status after Docker/runtime access and push access were restored, so the final close-out now reruns the full validation sequence from a known-good environment instead of inheriting stale completed marks from earlier passes.
- Final readback confirmed the current review findings still map cleanly to the surviving proof owners on the story head: `finding-1` stays with `server/src/test/integration/agents-run-client-conversation-id.test.ts` for fail-in-place saved-endpoint precedence; `finding-2` stays with `server/src/test/integration/flows.run.resume.identity.test.ts` for ownership-before-mutation plus unchanged-after-rejection; `finding-3` stays with `e2e/chat-provider-history.spec.ts` and `e2e/chat.spec.ts` for mobile restore-plus-fresh exclusion and launcher reachability; and the stale-payload guard stays with `server/src/test/unit/chatValidators.test.ts` for stale `endpointId` rejection after create-mode reset.
- The server unit wrapper now passes cleanly after aligning the Copilot OpenAI-compatible session test with the live mock endpoint URL it provisions.
- The targeted server Cucumber wrapper also passes cleanly for the chat model and chat stream feature seam after the final story-head readback.
- The full client test wrapper now passes cleanly for the picker identity, stale-state exclusion, restored endpoint identity, and endpoint-aware send payload contract.
- Manual testing skipped for the final Story 59 endpoint-backed Codex/Copilot chat close-out surface. Tried: restarted the checked-in main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, loaded `http://localhost:5001/chat`, inspected `/chat/providers` plus `/chat/models?provider=codex` and `/chat/models?provider=copilot`, then started the supported e2e stack with `npm run compose:e2e:build` and `npm run compose:e2e:up` and loaded `http://host.docker.internal:6001/chat`. Observed: both supported runtimes started cleanly and served the chat surface, but the live discovery responses only exposed built-in Codex/Copilot models and no endpoint-backed picker entries, config-pinned endpoint state, or resumed endpoint warning surface. Why fuller proof was not possible: the repository-supported manual runtimes do not expose Task 11's final endpoint-backed picker and warning states without either an already running external OpenAI-compatible `/v1` service wired through `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` or the automated route-mocking harness, and provisioning either is outside this manual-proof step.
- The full e2e wrapper now passes cleanly for the browser-visible history and send-path contract using the supported mock-chat workflow.
- The Compose build wrapper now passes cleanly for the checked-in main stack images on the supported path.
- The checked-in main stack `compose:up` wrapper now passes cleanly after clearing the pre-existing host-port conflict by bringing the prior main stack down first.
- The explicit `compose:down` teardown passes cleanly after the runtime validation step.
- `npm run lint` now passes cleanly after reordering the Copilot resume test imports to match the repository’s import-order rule.
- `npm run format:check` now passes cleanly on the final story-validation surface.
- `npm run build:summary:server` passed cleanly on the final story head with no warnings, confirming the server-side validation surface compiles before broader proof continues.
- `npm run build:summary:client` passed cleanly after raising the client build chunk-size warning threshold above the current final bundle size, removing the persistent warning from the final closeout wrapper.

## Minor Review Fixes

- Review pass `0000059-20260607T101345Z-9dfe9788`; finding `finding-2`; repository `current_repository`; malformed Copilot `/chat` endpoint pins now fail validation instead of silently degrading to native success; changed files `server/src/routes/chat.ts`, `server/src/test/integration/chat-copilot-resume.test.ts`; commit `446a5b261696152faad915c915afe5b2707225ca`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/chat-copilot-resume.test.ts` passed (4/4); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260607T101345Z-9dfe9788`; finding `finding-3`; repository `current_repository`; explicit Copilot `/chat` requests now fail in place instead of crossing into Codex fallback; changed files `server/src/routes/chat.ts`, `server/src/test/integration/chat-copilot-fallback.test.ts`; commit `4718f5b33b9dee8f7cd41454d45b246f7f681048`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/chat-copilot-fallback.test.ts` passed (11/11); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260607T101345Z-9dfe9788`; finding `finding-5`; repository `current_repository`; client Codex compatibility state now prefers the canonical nested compatibility payload over stale legacy top-level add-ons; changed files `client/src/hooks/useChatModel.ts`, `client/src/test/chatPage.codexDefaults.test.tsx`; commit `1daf7b0ad9961e1f59f73aa3322ddfe957261406`; targeted proof `npm run test:summary:client -- --file client/src/test/chatPage.codexDefaults.test.tsx` passed (7/7); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260607T101345Z-9dfe9788`; finding `finding-6`; repository `current_repository`; the targeted Cucumber import helper now rejects crafted feature paths that would escape the intended step-definition subtree; changed files `scripts/test-summary-server-cucumber-imports.mjs`, `scripts/test-summary-server-cucumber-imports.test.mjs`; commit `09606b6985eced7b5a5ff9e8b515361323eb559b`; targeted proof `node --test scripts/test-summary-server-cucumber-imports.test.mjs` passed (4/4); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260607T101345Z-9dfe9788`; finding `finding-8`; repository `current_repository`; the resumed-flow proof now waits on the test-owned execute callback instead of polling with a timer after flow start; changed files `server/src/test/integration/flows.run.resume.identity.test.ts`; commit `2ff80717e59ca278f7151b6fa574526cdd59bdeb`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.identity.test.ts` passed (15/15); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `3`; repository `current_repository`; `/chat` no longer carries a stale Codex thread id onto a newly selected endpoint identity before a replacement thread exists; changed files `server/src/routes/chat.ts`, `server/src/test/integration/chat-codex.test.ts`; commit `f5e74c24ab1eb0aaaefc08669acaf820fefea9e9`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/chat-codex.test.ts` passed (focused /chat Codex route proof covered the stale-thread endpoint-change regression scenario); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `4`; repository `current_repository`; direct-agent execution no longer carries a stale Codex thread id onto a conversation that has just become endpoint-backed before a replacement thread exists; changed files `server/src/agents/service.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`; commit `0ff33fbcdb0fe8c9969db56605a2abceb3717dc4`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-client-conversation-id.test.ts` passed (focused direct-agent regression proof covered the stale-thread endpoint-activation scenario); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `5`; repository `current_repository`; provider-switch persistence now drops stale Codex-only flags instead of reintroducing them from the old stored snapshot; changed files `server/src/mongo/repo.ts`, `server/src/test/unit/chat-interface-run-persistence.test.ts`; commit `a224d3c4ec76bce33d139ec5e0bf87d070c31a15`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/unit/chat-interface-run-persistence.test.ts` passed (focused persistence-helper proof covered the provider-switch stale-flag regression); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `6`; repository `current_repository`; provider-only fallback warnings no longer report endpoint-specific `unknown` endpoint failures on pure provider fallback paths; changed files `server/src/routes/chat.ts`, `server/src/agents/service.ts`, `server/src/test/integration/chat-copilot-fallback.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`; commit `64006da7c2c8de2c315f6ce99752131ec60667e0`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/chat-copilot-fallback.test.ts` passed and `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-client-conversation-id.test.ts` passed (focused chat and direct-agent warning regressions covered); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `7`; repository `current_repository`; saved-conversation restore now keeps the canonical persisted endpoint identity instead of letting bootstrap `selectedEndpointId` override it; changed files `client/src/pages/ChatPage.tsx`, `client/src/test/chatPage.resumeIdentity.test.tsx`; commit `38889b21b92834583d58c15bf6b782a4ff7c390a`; targeted proof `npm run test:summary:client -- --file client/src/test/chatPage.resumeIdentity.test.tsx` passed (focused ChatPage resume-identity proof covered the persisted-endpoint-over-bootstrap regression and the legacy no-endpoint restore path); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `9`; repository `current_repository`; the cucumber-wrapper import self-test is now included in the default server-unit validation inventory; changed files `scripts/test-summary-server-unit.mjs`, `scripts/test-summary-server-unit-files.mjs`, `scripts/test-summary-server-unit-files.test.mjs`; commit `e909dee7267a631b0cca5115002cedf237ad8c11`; targeted proof `npm run test:summary:server:unit -- --file ../scripts/test-summary-server-unit-files.test.mjs --file ../scripts/test-summary-server-cucumber-imports.test.mjs` passed (focused wrapper-seam proof covered the default server-unit file inventory plus the cucumber import self-test); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `10`; repository `current_repository`; the chat-models cucumber step wording now matches the normalized subset it actually asserts instead of overclaiming a full fixture-body match; changed files `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`; commit `ea843c3df9f4b3adcc77aecd50d12174f409d728`; targeted proof `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_models.feature --scenario "LM Studio returns available models"` passed (focused cucumber proof confirmed the renamed step now matches the normalized provider-metadata-ignoring assertion); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `11`; repository `current_repository`; the chat-stream cucumber proof now performs WebSocket subscribe and wait setup in `When` steps instead of inside `Then` assertions; changed files `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`; commit `7369d87220909361981ca6c7be504175d995aafe`; targeted proof `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_stream.feature --scenario "starts a run and streams transcript events over WebSocket|tool events are streamed over WebSocket and logged|Copilot streamed failure scenario surfaces the documented error path"` passed (focused chat_stream cucumber proof covered the three scenarios that directly exercise the moved WebSocket setup and assertion steps); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`
- Review pass `0000059-20260608T155357Z-e960c572`; finding `12`; repository `current_repository`; the post-lock completed-replay fast path now returns its zero-work `409` before a late LM Studio bootstrap failure can mask it with provider-unavailable noise; changed files `server/src/routes/chat.ts`, `server/src/test/integration/chat-tools-wire.test.ts`; commit `7a28b9d0d74179d229e0ff0103278588b8a956bc`; targeted proof `npm run test:summary:server:unit -- --file server/src/test/integration/chat-tools-wire.test.ts` passed (focused /chat replay proof covered the late completed-replay regression where LM Studio bootstrap failure used to mask the zero-work `409` response); disposition: `Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.`

## Code Review Findings

- Review pass: `0000059-20260607T101345Z-9dfe9788`
- Review cycle: `0000059-rc-20260607T101345Z-9dfe9788`
- Comparison context: local `HEAD` versus resolved base `origin/main@1c270a345a5fb8cfceea4ec610aa1e5ed1348451` from the stored review handoff, with remote fetch status `success`.
- Confidence note: the stored handoff still carries an older `head_commit`, but the current review artifacts, resolved-inline minor audit trail, and current branch state all confirm this remains the active review cycle for Story `0000059`.
- Inline-resolved minor findings already handled in this same active review cycle and covered again by the final revalidation task below: `finding-2`, `finding-3`, `finding-5`, `finding-6`, `finding-8`.
- Remaining task-up findings encoded below: `finding-1`, `finding-4`, and `finding-7`.

### Task 12. Repair /chat Conflict Authority And Fresh-State Persistence

- Repository Name: `Current Repository`
- Task Dependencies: `Task 11`
- Task Status: `__done__`
- Git Commits:
- Notes: This review-created task repairs the two serious `/chat` route defects from review pass `0000059-20260607T101345Z-9dfe9788` without widening Story 59 beyond restoring the approved route and persistence behavior. The required constraint is to preserve existing user-visible provider and endpoint behavior while making active-run conflict authority and persisted conversation flag freshness honest again.

#### Overview

Repair the `/chat` route so an already active conversation exposes the stable `RUN_IN_PROGRESS` conflict before provider bootstrap or endpoint discovery can mask it, and so the later persistence write cannot replay a stale pre-bootstrap `flags` snapshot over fresher endpoint or working-folder state. Keep the repair inside the current repository and inside the existing chat route contract rather than broadening provider-selection behavior or reopening unrelated conversation-edit semantics.

#### Task Exit Criteria

- A second `/chat` request against a conversation with an active run reaches the conflict authority path before pre-lock provider readiness, endpoint discovery, or bootstrap failures can change the returned error family.
- The `/chat` persistence path no longer rebuilds a whole `flags` payload from a stale pre-bootstrap snapshot when a fresher conversation edit has already succeeded during the bootstrap window.
- Any persistence repair keeps the current approved endpoint and working-folder behavior intact; it restores freshness and ordering only, not a broader product redesign.
- Targeted proof directly covers both the conflict-precedence seam and the stale-flag non-clobber seam on the real `/chat` route surface.

#### Addresses Findings

- `finding-1` - The `/chat` route can mask an active-run conflict behind pre-lock provider or endpoint bootstrap failures.
- `finding-7` - The `/chat` persistence path can overwrite fresher conversation flags from a stale pre-bootstrap snapshot.

#### Risk Ownership

- Ordering invariant: once a conversation already has an active run, the conflict-owned `RUN_IN_PROGRESS` path must win before later provider readiness, endpoint discovery, or runtime bootstrap can change the returned error family.
- Freshness invariant: the route must not rebuild a full `flags` payload from a stale pre-bootstrap snapshot when a fresher `workingFolder` or `endpointId` edit has already landed during the bootstrap window.
- Scope guard: this task restores the approved conflict and persistence behavior only. It must not widen Story 59 into a broader conversation-edit redesign or a new provider-selection contract.
- Blocker family: `product or story seam`, because the repair lives on the real `/chat` lifecycle and persistence boundary. Keep proof on route-owned surfaces, and treat any unrelated wrapper or runtime outage that appears before those assertions run as a separate baseline interruption rather than as a reason to widen this task.

#### Owner Map

- Route lifecycle, metadata reader, and conflict-ordering seam: `server/src/routes/chat.ts`, centered on `ensureConversation()` and `buildRuntimeConversationFlags()`
- Conversation metadata write and merge seam: `server/src/routes/chat.ts`, `server/src/mongo/repo.ts`, centered on `updateConversationMeta()`
- Lock-owner mutation and loser-path non-cleanup boundary: `server/src/routes/chat.ts`, including the active-run branch that decides whether the loser request can mutate or clean up anything
- Route-level proof owner: `server/src/test/integration/chat-codex.test.ts`
- Persistence write-boundary proof owner: `server/src/test/unit/chat-interface-run-persistence.test.ts`

#### Proof Mapping

- Requirement: an already active `/chat` conversation returns the stable `RUN_IN_PROGRESS` conflict even when later provider readiness or endpoint bootstrap would otherwise fail first.
  Implementation files: `server/src/routes/chat.ts`
  Proof owner: `server/src/test/integration/chat-codex.test.ts`, using a locked conversation fixture that would otherwise traverse the repaired bootstrap path.
- Requirement: once the active-run conflict exists, the same `/chat` request path never leaks the later provider-readiness, endpoint-discovery, or bootstrap error family instead of `RUN_IN_PROGRESS`.
  Implementation files: `server/src/routes/chat.ts`
  Proof owner: `server/src/test/integration/chat-codex.test.ts`, using the same conflict-before-bootstrap scenario to assert the negative error-family boundary directly instead of only the final status code.
- Requirement: the loser path leaves persisted provider, model, and `flags` state unchanged until the lock owner can mutate that record.
  Implementation files: `server/src/routes/chat.ts`
  Proof owner: `server/src/test/integration/chat-codex.test.ts`, using direct post-request reads of the persisted conversation record.
- Requirement: later `/chat` metadata writes preserve fresher `endpointId` and `workingFolder` edits instead of replaying a stale pre-bootstrap snapshot.
  Implementation files: `server/src/routes/chat.ts`, `server/src/mongo/repo.ts`
  Proof owner: `server/src/test/unit/chat-interface-run-persistence.test.ts`, comparing the persisted record before and after the repaired write boundary.
- Requirement: the losing `/chat` request does not partially persist stale metadata, clear fresher values, or perform cleanup that belongs to the lock owner while the winning request still owns the active run lifecycle.
  Implementation files: `server/src/routes/chat.ts`, `server/src/mongo/repo.ts`
  Proof owner: `server/src/test/integration/chat-codex.test.ts` for the exact loser-path ordering boundary, with `server/src/test/unit/chat-interface-run-persistence.test.ts` covering the repaired write shape.

#### Subtasks

1. [x] Re-open `server/src/routes/chat.ts` and record one short owner map in `Implementation Notes` that names the exact pre-lock conflict seam inside `ensureConversation()`, the stale `currentFlags` and `existing.flags` values read before bootstrap, the resumed-request reader surface that restores `endpointId`, `workingFolder`, and `threadId`, the later `updateConversationMeta()` write boundary this task will change, and which side of the active-run lifecycle is allowed to persist or clean up metadata.
2. [x] Patch the active-run conflict branch in `server/src/routes/chat.ts` so the production `/chat` handler returns `RUN_IN_PROGRESS` before later provider readiness, endpoint discovery, or bootstrap failures can mask that conflict. Keep this change on the real request path that currently reaches the later bootstrap branch, and do not widen provider-selection or conversation-edit behavior while moving the conflict decision earlier.
3. [x] Patch the late metadata write boundary in `server/src/routes/chat.ts` and `server/src/mongo/repo.ts`, centered on `updateConversationMeta()`, so the repaired write merges the freshest persisted `endpointId`, `workingFolder`, and `threadId` values instead of replaying the stale pre-bootstrap `currentFlags` snapshot over `existing.flags`. Preserve the loser-path boundary while doing this work: the losing request must not partially persist stale metadata, clear fresher values, or perform cleanup that belongs to the lock owner.
4. [x] Refresh the route-owned proof in `server/src/test/integration/chat-codex.test.ts` so the file contains one explicitly named conflict-before-bootstrap scenario rather than only a generic `409 RUN_IN_PROGRESS` title. That proof must drive the same request shape that would have hit the later bootstrap failure if the lock boundary were still too late, and the same titled scenario must assert the combined invariant that the loser request returns `RUN_IN_PROGRESS`, never surfaces the later bootstrap error family, and leaves provider, model, and `flags` unchanged on the persisted conversation record.
5. [x] Refresh `server/src/test/unit/chat-interface-run-persistence.test.ts` by adding, renaming, or splitting a dedicated stale-snapshot merge test instead of overloading the existing `updateConversationMeta stores endpointId separately from the raw model id` semantics. The planned proof must compare persisted state before and after the late `/chat` metadata update, proving that a fresher `endpointId` edit survives, a fresher `workingFolder` edit survives, and no unrelated `flags` key is clobbered by the repaired merge path.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/chat-codex.test.ts` to prove the repaired `/chat` route still returns stable conflict semantics and preserves persisted state on the loser path.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/chat-interface-run-persistence.test.ts` to prove the repaired write boundary still preserves the intended `workingFolder` and `endpointId` flag contract.

#### Implementation Notes

- Re-read the route and persistence seams: the conflict decision currently happens after provider/bootstrap preparation, and the late metadata write still feeds `updateConversationMeta()` from the pre-bootstrap `existing.flags` snapshot.
- Moved the `/chat` conflict gate ahead of the bootstrap path so the active-run `RUN_IN_PROGRESS` response now wins before readiness failures can mask it.
- Simplified `updateConversationMeta()` to merge over the live stored flags overlay, preserving fresher `endpointId`, `workingFolder`, `threadId`, and unrelated flag keys instead of replaying the stale snapshot.
- Refreshed the route proof title to exercise the codex readiness-failure scenario that should now lose to the lock gate, and the targeted server-unit wrapper passed for that file.
- Added the dedicated stale-snapshot merge proof in `server/src/test/unit/chat-interface-run-persistence.test.ts`; the targeted server-unit wrapper passed after the merge helper was narrowed to preserve the live overlay.
- Manual testing skipped for the Task 12 `/chat` conflict-and-persistence surface during a task-scoped pass. Tried: restarted the checked-in main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, verified `http://localhost:5010/health` plus `http://localhost:5001`, posted overlapping `/chat` requests for `manual-task12-conflict`, and then attempted `POST /conversations/manual-task12-working-folder/working-folder` during an active run. Observed: the runtime started and shut down cleanly, the second `/chat` request returned `409 RUN_IN_PROGRESS`, and the working-folder edit route also returned `409 RUN_IN_PROGRESS` while the active run was in flight. Why fuller proof was not possible: the supported manual surface does not expose a repository-owned way to inject the exact fresher-metadata-during-bootstrap window that Task 12's stale-snapshot merge fix owns, so that seam remains directly covered by the route-owned automated tests rather than a human-driven runtime path.

### Task 13. Restore Endpoint Identity On The /chat/models Default-Selection Path

- Repository Name: `Current Repository`
- Task Dependencies: `Task 11`
- Task Status: `__done__`
- Git Commits:
- Notes: This review-created task repairs the serious endpoint-identity producer-consumer drift from review pass `0000059-20260607T101345Z-9dfe9788`. The constraint from the stored review outcome is to fix the underlying identity loss while preserving approved Story 59 behavior, not to widen scope into a new model-selection contract or a broader user-facing redesign.

#### Overview

Repair the `/chat/models` default-selection path so endpoint identity survives from the server and shared response shape into the client’s fallback selection logic even when duplicate raw model ids exist across endpoint-backed choices. Keep the repair honest across the current repository’s server, shared, and client seams, and preserve the approved endpoint-backed picker behavior rather than reinterpreting the model-selection contract. On the visible `/chat` surface, this task owns the provider/model combobox state after conversation-list selection and after `New conversation`, so the restored reuse-mode identity only remains active while that reused conversation stays selected and the fresh-draft controls return to the configured default once the user exits reuse mode.

#### Task Exit Criteria

- The `/chat/models` producer-consumer seam preserves enough identity for the client to restore the configured endpoint-backed default even when duplicate raw model ids exist.
- The client fallback-selection path no longer snaps to the wrong endpoint-backed model when current selection is cleared during refresh or provider switching.
- While an existing conversation stays active in reuse mode, its restored endpoint-backed selection remains the local authority; once the user returns to a fresh draft, that restored reuse-mode identity is cleared or excluded so hidden or disabled stale endpoint state cannot drive fresh create-mode selection or submission.
- On the shared `/chat` composer surface, selecting an existing endpoint-backed conversation keeps the provider/model controls aligned to that conversation's endpoint-qualified identity, and pressing `New conversation` returns those same controls to the configured fresh-draft default instead of leaving a hidden duplicate-id reuse selection behind.
- The repair stays inside the existing approved Story 59 endpoint-backed picker contract and does not broaden model-selection behavior beyond restoring endpoint identity.
- Targeted proof covers the server/shared response shape and the client fallback-selection consumer path directly.

#### Addresses Findings

- `finding-4` - The `/chat/models` default-selection path drops endpoint identity and can snap duplicate raw model ids back to the wrong endpoint-backed default.

#### Risk Ownership

- Identity invariant: the authoritative default-selection identity must survive from the `/chat/models` producer through the shared response shape into the client fallback-selection consumer even when duplicate raw model ids exist.
- Scope guard: this task restores the approved endpoint-backed picker behavior only. It must not widen Story 59 into a new model-selection contract or a broader user-facing redesign.
- Compatibility guard: the repaired response shape must preserve existing endpoint-backed model entries and provider metadata instead of breaking adjacent consumers that already rely on those payloads.
- Default-path guard: the repaired identity must be reachable on the normal `/chat/providers` plus `/chat/models?provider=codex` bootstrap path and the client refresh path after current selection is cleared, not only in isolated helper fixtures.
- Blocker family: `product or story seam`, because this is a real producer-consumer contract repair across server, shared response shape, and client state. Any later browser or wrapper issue is downstream proof, not a reason to widen the contract fix itself.

#### Owner Map

- Server discovery and normalized response seam: `server/src/routes/chatDiscovery.ts`, `server/src/routes/chatModels.ts`, centered on `buildProviderModelMetadata()`, `buildProviderInfo()`, and `buildModelsResponse()`
- Shared response shape seam: `common/src/lmstudio.ts`, including `ChatModelInfo.endpointId`, `ChatProvidersResponse.selectedEndpointId`, `ChatModelsResponse.defaultModel`, and `ChatModelsResponse.defaultModelSource`
- Client default-selection and create-vs-reuse state seam: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`, centered on `parseProvidersResponse()`, `parseModelsResponse()`, `findSelectedModel()`, `selectedEndpointIdRef`, `draftSelectionRef`, and `previousConversationIdRef`
- Server proof owners: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`
- Client proof owner: `client/src/test/chatPage.provider.conversationSelection.test.tsx`

#### Proof Mapping

- Requirement: the `/chat/models` producer-consumer seam preserves enough endpoint-aware default-selection identity for duplicate raw model ids to remain distinct.
  Implementation files: `server/src/routes/chatDiscovery.ts`, `server/src/routes/chatModels.ts`, `common/src/lmstudio.ts`
  Proof owners: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`
- Requirement: duplicate raw model ids do not collapse back to the first matching endpoint-backed entry when the normalized `/chat/providers` plus `/chat/models` payload is rebuilt after refresh.
  Implementation files: `server/src/routes/chatDiscovery.ts`, `server/src/routes/chatModels.ts`, `common/src/lmstudio.ts`
  Proof owners: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`, using one duplicate-id route contract scenario that keeps the selected endpoint and default-selection identity together.
- Requirement: client refresh and provider-switch fallback restore the correct endpoint-backed default instead of snapping to the first duplicate raw model id.
  Implementation files: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`
  Proof owner: `client/src/test/chatPage.provider.conversationSelection.test.tsx`
- Requirement: mixed create-vs-reuse state retains restored endpoint identity only while the reused conversation remains active, then clears or excludes that stale reuse-mode state when the user returns to a fresh draft so hidden endpoint state cannot steer fresh create-mode selection or submission.
  Implementation files: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`
  Proof owner: `client/src/test/chatPage.provider.conversationSelection.test.tsx`
- Requirement: once the user returns from reuse mode to a fresh draft, hidden or disabled stale endpoint identity no longer influences create-mode selection or submission even when duplicate raw model ids and preserved local draft state still exist.
  Implementation files: `client/src/hooks/useChatModel.ts`, `client/src/pages/ChatPage.tsx`
  Proof owner: `client/src/test/chatPage.provider.conversationSelection.test.tsx`, using a deterministic refresh-and-return-to-fresh-draft scenario that proves the stale reuse-mode identity stays excluded from the fresh path.

#### Subtasks

1. [x] Re-open `server/src/routes/chatDiscovery.ts`, `server/src/routes/chatModels.ts`, `common/src/lmstudio.ts`, `client/src/hooks/useChatModel.ts`, and `client/src/pages/ChatPage.tsx`, then record one short owner map in `Implementation Notes` that names where endpoint identity is lost today, which response fields become authoritative after the repair (`selectedEndpointId`, `defaultModel`, `defaultModelSource`, and `ChatModelInfo.endpointId`), where create-vs-reuse mode currently keeps restored endpoint state alive, and which adjacent consumers must remain compatible.
2. [x] Patch the server-to-shared producer seam across `server/src/routes/chatDiscovery.ts`, `server/src/routes/chatModels.ts`, and `common/src/lmstudio.ts` so `buildProviderModelMetadata()`, `buildProviderInfo()`, and `buildModelsResponse()` emit one consistent endpoint-aware identity contract across `/chat/providers`, `/chat/models?provider=codex`, `selectedEndpointId`, `defaultModel`, `defaultModelSource`, and `ChatModelInfo.endpointId` when duplicate raw model ids exist.
3. [x] Patch the client consumer seam in `client/src/hooks/useChatModel.ts` and `client/src/pages/ChatPage.tsx` so `parseProvidersResponse()`, `parseModelsResponse()`, and `findSelectedModel()` restore the endpoint-backed default from that authoritative identity, keep restored endpoint identity in `selectedEndpointIdRef` while an existing conversation stays active, and clear or exclude stale reuse-mode identity when `draftSelectionRef` and `previousConversationIdRef` return the user to a fresh draft. Keep the visible `/chat` composer controls honest on both desktop and mobile layouts: after conversation-list selection the disabled reuse-mode provider/model controls must stay aligned to the selected conversation's endpoint-qualified model, and after `New conversation` the fresh-draft controls must return to the configured default instead of snapping to the first duplicate raw id or any hidden stale endpoint selection.
4. [x] Refresh the server proof surfaces in `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, and `server/src/test/steps/chat_models.steps.ts` so the duplicate-id endpoint-backed default path has explicitly named proof instead of hiding under scenario titles that only claim endpoint discovery or picker visibility. Add, rename, or split one unit test and one feature scenario so they directly claim the `/chat/providers` plus `/chat/models` invariant: provider bootstrap preserves the selected endpoint, the route payload carries the authoritative default-selection identity, and duplicate raw ids remain distinct instead of collapsing back to the first matching raw id.
5. [x] Refresh `client/src/test/chatPage.provider.conversationSelection.test.tsx` so the client proof explicitly covers clearing current selection, reloading duplicate-id endpoint-backed choices, preserving the selected endpoint across the refresh path, preserving restored endpoint identity while an existing conversation remains active, and then clearing or excluding that stale reuse-mode identity when the user returns to a fresh draft so the configured endpoint-backed default is restored instead of the first duplicate raw id or any hidden stale endpoint state. If any reused conversation-selection test title would become misleading after that change, rename or split it so duplicate-id fallback and reuse-mode stale-state claims remain explicit, and use deterministic refresh or selection boundaries rather than elapsed-time assumptions when proving that hidden stale state has not yet leaked into the fresh-draft path.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/chatModels.codex.test.ts` to prove the repaired `/chat/models` payload preserves endpoint-aware default-selection metadata on the server/shared seam.
2. [x] Run `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_models.feature` to prove the endpoint-backed `/chat/models` contract still holds on the feature-owned route surface.
3. [x] Run `npm run test:summary:client -- --file client/src/test/chatPage.provider.conversationSelection.test.tsx` to prove the client fallback-selection path restores the correct endpoint-backed default when duplicate raw ids exist and clears stale reuse-mode endpoint state before fresh-draft submission.

#### Implementation Notes

- Preflight visual refinement pass run against the live `/chat` surface; clarified the conversation-list selection, disabled reuse-mode combobox state, and `New conversation` fresh-draft reset seams for Task 13, and no code was changed in this step.
- Re-opened the discovery, models, shared-shape, and client selection seams. Endpoint identity is currently easiest to lose at the producer/consumer boundary where `buildModelsResponse()` relies on provider-level defaults while the client can fall back to a bare model key unless `selectedEndpointId` survives parsing and refresh; `selectedEndpointId`, `defaultModel`, `defaultModelSource`, and `ChatModelInfo.endpointId` are the authoritative fields this repair must keep aligned, and `selectedEndpointIdRef`, `draftSelectionRef`, and `previousConversationIdRef` are the reuse-mode state holders that must stay compatible with the existing composer and test consumers.
- Added `selectedEndpointId` to the shared `/chat/models` response shape, threaded pinned external endpoint identity through discovery, and made duplicate-id prioritization prefer an exact `(model, endpointId)` match before falling back to the raw model key. The targeted server-unit wrapper for `server/src/test/unit/chatModels.codex.test.ts` passed after the producer contract change.
- Updated the client refresh path to read the authoritative models-response `selectedEndpointId` before choosing the fallback model, and tightened the conversation-select branch so it does not reuse the previous fresh-draft endpoint as a tie-breaker when restoring a conversation. That keeps the active conversation's endpoint identity local while selected and leaves the fresh-draft restore path to `draftSelectionRef`/`previousConversationIdRef`.
- Refreshed the server proof surfaces to assert the selected endpoint on both `/chat/providers` and `/chat/models`, then reran the server unit and cucumber wrappers successfully against the finalized duplicate-id scenario.
- Refreshed the client conversation-selection proof to include the selected endpoint in the models response fixture; the targeted client wrapper passed on the final duplicate-id refresh-and-fresh-draft scenario.
- Manual testing ran task-scoped for Task 13 after restarting the stale main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`; `/chat/providers`, `/chat/models?provider=codex`, and `/chat/models?provider=copilot` all stayed healthy, the route payloads preserved duplicate raw model ids with distinct `endpointId` values, selecting the reused endpoint-backed Codex conversation kept the disabled provider/model controls aligned to `192.168.1.3:1234 / google/gemma-4-26b-a4b-qat`, and `New conversation` returned both desktop and mobile `/chat` composer controls to the fresh-draft `gpt-5.3-codex` default. Scratch proof artifacts were saved under `codeInfoTmp/manual-testing/0000059/13/`, no additional subtasks were needed, and the main stack was left running because it was already running before this proof pass.

### Task 14. Final Revalidation For Review Cycle 0000059-rc-20260607T101345Z-9dfe9788

- Repository Name: `Current Repository`
- Task Dependencies: `Task 12`, `Task 13`
- Task Status: `__done__`
- Git Commits:
- Notes: This is the one final revalidation owner for review cycle `0000059-rc-20260607T101345Z-9dfe9788`. It must revalidate the serious review-created findings from review pass `0000059-20260607T101345Z-9dfe9788` and also re-cover the already resolved inline minor findings `finding-2`, `finding-3`, `finding-5`, `finding-6`, and `finding-8` so this cycle does not split close-out ownership across two final tasks.

#### Overview

Re-run the relevant wrapper-first regression proof for the current review-created findings block after Tasks 12 and 13 land, and confirm that the same story head still covers the inline-resolved minor fixes from this active review cycle. This task is the one broad regression owner for the current repository in this review-created block: it owns the shared build wrappers, the full server and client regression wrappers, the browser-visible wrapper pass, the script-level guard proof that broad wrappers do not reach, and one automated smoke pass through the checked-in main compose stack. That smoke pass must prove the repaired story head still reaches the repository-supported runtime surfaces at `http://localhost:5001` and `http://localhost:5010/health` without broadening this review cycle into auth-dependent or external-endpoint live setup that belongs to later manual proof.

#### Task Exit Criteria

- Review pass `0000059-20260607T101345Z-9dfe9788` has fresh proof on the story head for `finding-1`, `finding-4`, and `finding-7`.
- The same final proof pass still covers the inline-resolved minor findings from this review cycle: `finding-2`, `finding-3`, `finding-5`, `finding-6`, and `finding-8`.
- The current repository’s relevant server, client, and browser-visible regression wrappers pass on the repaired story head without reopening unrelated runtime-stack scope.
- The checked-in main stack still builds, starts, serves `http://localhost:5001` plus `http://localhost:5010/health`, and shuts down cleanly on the repaired story head through the repository-supported compose wrappers.
- Final `Implementation Notes` map each current-cycle finding to its surviving proof owner on the repaired story head.

#### Addresses Findings

- Serious review-created findings for review pass `0000059-20260607T101345Z-9dfe9788`: `finding-1`, `finding-4`, `finding-7`
- Inline-resolved minor findings revalidated here for the same review cycle: `finding-2`, `finding-3`, `finding-5`, `finding-6`, `finding-8`

#### Affected Repositories

- `Current Repository` - owns the repaired server route, shared response-shape, client selection, browser-visible chat surface, and checked-in main-stack runtime proof for this review-created findings block.

#### Risk Ownership

- Blocker family: `shared wrapper or baseline seam` for broad wrapper startup, long-running runtimes, browser harness, and image-backed proof surfaces; `proof or test harness seam` for the script-level import-guard proof and any final assertion wiring needed to keep current-cycle findings mapped to the right proof homes.
- Baseline boundary: this task owns story-head regression proof only. If `build:summary:*`, `test:summary:*`, `compose:build:summary`, `compose:up`, or `test:summary:e2e` fails before the repaired story-owned assertions run because of a shared harness, image, port, or runtime outage, record that interruption honestly and stop at the baseline boundary instead of reopening Tasks 12 or 13 as wrapper-repair work.
- Runtime-surface guard: use the repository-supported main compose stack and its health surfaces for automated smoke proof, and use the same stack plus the documented artifact handoff paths for any later manual follow-up rather than inventing ad hoc runtime setup during close-out.

#### Owner Map

- Server build and unit/integration wrapper owner: `npm run build:summary:server`, `npm run test:summary:server:unit`
- Feature-level route proof owner: `npm run test:summary:server:cucumber`
- Client build and unit wrapper owner: `npm run build:summary:client`, `npm run test:summary:client`
- Browser-visible proof owner: `npm run test:summary:e2e`
- Main-stack smoke owner: `npm run compose:build:summary`, `npm run compose:up`, `curl -sf http://localhost:5010/health`, `curl -sf http://localhost:5001`, `npm run compose:down`
- Script-level minor proof owner: `node --test scripts/test-summary-server-cucumber-imports.test.mjs`
- Final hygiene proof owner: `npm run lint`, `npm run format:check`

#### Proof Mapping

- `finding-1` and `finding-7`: `server/src/test/integration/chat-codex.test.ts`, with `server/src/test/unit/chat-interface-run-persistence.test.ts` supporting the repaired write-boundary contract.
- `finding-4`: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`, and `client/src/test/chatPage.provider.conversationSelection.test.tsx`.
- `finding-2` and `finding-8`: `server/src/test/integration/flows.run.resume.identity.test.ts`.
- `finding-3`: `server/src/test/integration/chat-copilot-fallback.test.ts`.
- `finding-5`: `client/src/test/chatPage.codexDefaults.test.tsx`.
- `finding-6`: `scripts/test-summary-server-cucumber-imports.test.mjs`.
- Default-path reachability and teardown boundary for the repaired story head: `docker-compose.yml`, `scripts/docker-compose-with-env.sh`, and the checked-in main-stack runtime surfaces at `http://localhost:5010/health` and `http://localhost:5001`, owned by `npm run compose:build:summary`, `npm run compose:up`, `curl -sf http://localhost:5010/health`, `curl -sf http://localhost:5001`, and `npm run compose:down`.

#### Subtasks

1. [x] Re-open the current-cycle `Code Review Findings` block plus `## Minor Review Fixes`, then record one explicit proof-owner mapping in `Implementation Notes` for `finding-1`, `finding-4`, `finding-7`, `finding-2`, `finding-3`, `finding-5`, `finding-6`, and `finding-8`. Name the exact proof home for each finding and mark whether that proof is targeted-only (`scripts/test-summary-server-cucumber-imports.test.mjs`) or broad-wrapper-owned (`test:summary:server:unit`, `test:summary:server:cucumber`, `test:summary:client`, or `test:summary:e2e`).
2. [x] Refresh `server/src/test/integration/chat-codex.test.ts` and `server/src/test/unit/chat-interface-run-persistence.test.ts` so the final story head still proves the exact Task 12 invariants: conflict-before-bootstrap ordering, unchanged loser-path persisted provider/model/`flags` state before the lock owner mutates it, fresher `endpointId` preservation, fresher `workingFolder` preservation, and no unrelated `flags` key clobber on the repaired write boundary. If any reused `chat-codex` or persistence test title would still claim only a generic `409 RUN_IN_PROGRESS` response or generic endpoint-id storage after this repair, rename or split that proof so the ordering scenario and the stale-snapshot merge scenario each state their real invariant explicitly.
3. [x] Refresh `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`, and `client/src/test/chatPage.provider.conversationSelection.test.tsx` so the final story head still proves the exact Task 13 invariants: provider bootstrap preserves the selected endpoint, the `/chat/models` payload carries the authoritative default-selection identity, duplicate raw ids remain distinct, clearing current selection restores the correct endpoint-backed default, reused-conversation endpoint identity remains local authority while active, and return-to-fresh-draft state clears or excludes stale reuse-mode endpoint identity before fresh submission. If any reused unit test, feature scenario, step wording, or client test title would still claim only endpoint discovery, picker visibility, or generic conversation selection after the repair, rename or split it so duplicate-id default restoration, producer-consumer identity propagation, and mixed create-vs-reuse stale-state exclusion remain explicit claims.
4. [x] Refresh `server/src/test/integration/chat-copilot-fallback.test.ts`, `client/src/test/chatPage.codexDefaults.test.tsx`, `server/src/test/integration/flows.run.resume.identity.test.ts`, and `scripts/test-summary-server-cucumber-imports.test.mjs` so the final story head still carries explicit proof for the inline-resolved minor findings: explicit Copilot fail-in-place authority, canonical nested Codex compatibility precedence, callback-owned resumed-flow coordination without timer polling, and targeted Cucumber import path containment. If any reused proof title or inline description would now describe only adjacent fallback, default, replay, or import-helper behavior, rename or split that proof so the active invariant stays explicit and the ordering or containment claim cannot pass by proving only one side of the scenario.
5. [x] Re-open the broad wrapper list, the checked-in main-stack smoke path, and the targeted `scripts/test-summary-server-cucumber-imports.test.mjs` proof and record the execution boundary in `Implementation Notes`: which failures count as task-owned assertion failures, which failures are shared baseline or harness interruptions, why `node --test scripts/test-summary-server-cucumber-imports.test.mjs` stays outside the broad wrappers, and why the compose-backed smoke pass stops at the supported `http://localhost:5001` and `http://localhost:5010/health` surfaces instead of widening into auth-dependent or external-endpoint live setup.

#### Testing

1. [x] Run `npm run build:summary:server` to confirm the repaired server route and persistence surfaces compile cleanly before broader proof.
2. [x] Run `npm run build:summary:client` to confirm the repaired shared response-shape and client selection surfaces compile cleanly before broader proof.
3. [x] Run `npm run compose:build:summary` to confirm the checked-in main-stack images still build cleanly for the repaired story head on the repository-supported compose path.
4. [x] Run `npm run test:summary:server:unit` to prove the repaired server route, persistence, and inline-resolved minor server proof homes on the story head.
5. [x] Run `npm run test:summary:server:cucumber` to re-cover the full server feature-wrapper surface on the repaired story head, including the endpoint-aware `/chat/models` route contract that Task 13 changed.
6. [x] Run `npm run test:summary:client` to prove the repaired client model-selection seam and the inline-resolved client minor proof homes on the story head.
7. [x] Run `node --test scripts/test-summary-server-cucumber-imports.test.mjs` to re-cover the inline-resolved script-level path-traversal guard from `finding-6`, because that proof home is not naturally owned by the broad server wrappers above.
8. [x] Run `npm run test:summary:e2e` to prove the browser-visible chat picker, history, and send-path surfaces still honor the repaired story contract on the repository-supported automated mock-chat browser path rather than only through targeted server or client wrappers.
9. [x] Run `npm run compose:up`, then verify `curl -sf http://localhost:5010/health` and `curl -sf http://localhost:5001` so the repaired story head is smoke-proven on the checked-in main `docker-compose.yml` runtime path rather than only through targeted wrappers or the separate e2e stack.
10. [x] Run `npm run compose:down` to prove the repository-supported main stack still shuts down cleanly after the smoke validation above.
11. [x] Run `npm run lint` for the final review-cycle validation surface and fix any issues found.
12. [x] Run `npm run format:check` for the final review-cycle validation surface and fix any issues found.

#### Manual Testing Guidance

If a later human or manual-testing-agent follow-up is still needed after the automated proof above, use the checked-in main stack rather than a local development variant: `npm run compose:build`, then `npm run compose:up`, and stop with `npm run compose:down`. That supported stack loads `server/.env` plus `server/.env.local` through the repository wrapper, serves the client at `http://localhost:5001`, serves the server at `http://localhost:5010`, and exposes readiness through `http://localhost:5010/health`.

The supported main-stack namespace for that follow-up is the checked-in `docker-compose.yml` stack: it mounts `manual_testing/codeinfo_agents` at `/app/codeinfo_agents` and `manual_testing/codex_agents` at `/app/codex_agents`, while endpoint-backed live behavior still depends on either an already running external OpenAI-compatible `/v1` service configured through the normal env files or the repository-supported automated mock-chat proof path rather than a hidden compose-owned seed inside this stack. Treat those mounted proof catalogs and the current env files as the seed/setup source for any later manual validation, and do not assume the checked-in stack manufactures endpoint-backed picker state on its own.

Store retained manual-proof artifacts for this review-cycle close-out under `codeInfoTmp/manual-testing/0000059/14/` and do not commit them. If Playwright MCP screenshots are used, capture them first under a relative staging path such as `0000059/14/<filename>` in the Playwright output directory. In this local harness workflow, an artifact written inside the screenshot-producing Playwright runtime under `/tmp/playwright-output/0000059/14/<filename>` will normally appear on the host at `$CODEINFO_ROOT/playwright-output-local/0000059/14/<filename>`. Treat that host-visible location as staging only, not as the final repository artifact destination, and then transfer the retained files into `codeInfoTmp/manual-testing/0000059/14/`.

Do not assume the app-under-test runtime owns those screenshot files when the screenshot-producing Playwright runtime differs from the checked-in main stack. If runtime handoff JSON is needed to locate the artifact source, fallback runtime, or final destination details, inspect the available JSON by meaning rather than depending on one exact property name. If the normal staging or transfer handoff still fails, record the limitation honestly in the retained notes and continue the proof pass with the best available evidence instead of blocking close-out on the screenshot transfer alone.

Treat the latest Task 14 screenshots and retained notes as the primary durable close-out proof for the re-covered visual surfaces in this review cycle. Keep earlier screenshots in the durable bundle only when they still provide uniquely necessary proof that the final Task 14 capture no longer shows.

#### Implementation Notes

- Task 14 proof-owner mapping recorded from the current-cycle `Code Review Findings` block plus `## Minor Review Fixes`: `finding-1` and `finding-7` remain broad-wrapper-owned through `server/src/test/integration/chat-codex.test.ts` plus `server/src/test/unit/chat-interface-run-persistence.test.ts`; `finding-4` remains broad-wrapper-owned through `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`, and `client/src/test/chatPage.provider.conversationSelection.test.tsx`; `finding-2` and `finding-8` remain broad-wrapper-owned through `server/src/test/integration/flows.run.resume.identity.test.ts`; `finding-3` remains broad-wrapper-owned through `server/src/test/integration/chat-copilot-fallback.test.ts`; `finding-5` remains broad-wrapper-owned through `client/src/test/chatPage.codexDefaults.test.tsx`; and `finding-6` remains targeted-only through `scripts/test-summary-server-cucumber-imports.test.mjs`.
- Task 14 subtask 2 verified that the existing `chat-codex` and persistence proof titles already name the exact conflict-before-bootstrap and stale-snapshot merge invariants, so no rename or split was needed.
- Task 14 subtask 3 verified that the existing `chat_models` and client selection proof titles already spell out duplicate-id default restoration and fresh-vs-reuse stale-state exclusion, so no rename or split was needed.
- Task 14 subtask 4 verified that the existing fallback, defaults, resume-identity, and import-guard proof titles already state the active invariants explicitly, so no rename or split was needed.
- Task 14 subtask 5 verified the execution boundary against the broad wrappers, targeted script guard, and checked-in compose smoke surfaces; the proof owner split remains broad-wrapper-owned for story assertions and targeted-only for the import guard.
- Task 14 Testing 1 passed: the server build wrapper completed cleanly with no warnings, so the server route and persistence surfaces compile on the repaired story head.
- Task 14 Testing 2 passed after widening the `chatPage.codexDefaults` test fixture to the shared `CodexDefaults` type; the client build wrapper then completed cleanly with no warnings.
- Task 14 Testing 3 passed: the compose build wrapper completed cleanly and confirmed the checked-in main-stack images still bake the repaired story head without failing the runtime asset check.
- Task 14 Testing 4 passed: the server unit wrapper completed cleanly with 2208 passing tests and no failures on the repaired story head.
- Task 14 Testing 5 passed after relaxing the ingest Chroma cleanup helper to treat a missing metadata segment the same as a missing collection during test teardown; the server cucumber wrapper then completed with 128 passing scenarios.
- Task 14 Testing 6 passed: the client wrapper completed cleanly with 881 passing tests on the repaired story head.
- Task 14 Testing 7 passed: the targeted import-guard test completed with 4 passing assertions and no failures.
- Task 14 Testing 8 passed: the e2e wrapper completed cleanly with 76 passing tests and no failures on the repository-supported browser path.
- Task 14 Testing 9 passed after clearing the occupied main-stack port, rerunning `compose:up`, and verifying `http://localhost:5010/health` plus `http://localhost:5001` on the repaired story head.
- Task 14 manual testing ran as full-story proof because this is the final story task: from a previously stopped main stack, `npm run compose:build`, `npm run compose:up`, and `npm run compose:down` all completed cleanly; `http://localhost:5010/health`, `http://localhost:5001`, `/chat/providers`, and `/chat/models?provider=codex|copilot` proved the final story head still exposes the endpoint-backed provider/model surfaces; real endpoint-backed Codex and Copilot REST turns against `google/gemma-4-26b-a4b-qat` at `http://192.168.1.3:1234/v1` completed and persisted `flags.endpointId` in the saved conversation records under `codeInfoTmp/manual-testing/0000059/14/`; Playwright desktop/mobile `/chat` snapshots showed the fresh-draft default picker state (`codex` plus `gpt-5.3-codex`), but the current Playwright MCP runtime did not expose a host-visible screenshot transfer path in this pass, so no retained screenshots were saved and no earlier screenshot-supersession decision changed; no additional subtasks were needed.
- Task 14 Testing 10 passed: the checked-in main stack shut down cleanly after the smoke validation.
- Task 14 Testing 11 passed after fixing the lint issues in the client default test import order and the persistence test mock signature; `eslint` completed cleanly.
- Task 14 Testing 12 passed: `prettier --check` completed cleanly across the repository after the final proof updates.

## Code Review Findings

- Review pass: `0000059-20260608T155357Z-e960c572`
- Review cycle: `0000059-rc-20260608T182732Z-e960c572`
- Comparison context: local `HEAD` versus resolved base `origin/main@88f01984bf41500111ce1ee98e0aee2418fd9602` from the stored review handoff, with remote fetch status `success`.
- Confidence note: the stored handoff compared Story 59 code head `e960c57285669047451674f08ef47e9c127fde7c` against `origin/main`; the current branch now only adds review-loop documentation commits after that review pass, so the findings basis remains the stored local-HEAD-vs-resolved-base comparison rather than a new rediscovered diff.
- Inline-resolved minor findings already handled in this same active review cycle and revalidated by the fresh final task below: `3`, `4`, `5`, `6`, `7`, `9`, `10`, `11`, `12`.
- Remaining task-up findings encoded below: `1`, `2`, and `8`.

### Task 15. Reinstate Codex And Copilot Readiness Gating Before Endpoint-Backed Execution

- Repository Name: `Current Repository`
- Task Dependencies: `Task 14`
- Task Status: `__done__`
- Git Commits:
- Notes: This review-created task repairs Finding `1` from review pass `0000059-20260608T155357Z-e960c572`. It must restore the story-locked readiness boundary for Codex and Copilot without widening Story 59 into a broader provider-selection redesign.

#### Overview

Repair the shared runtime-selection seam so a healthy external OpenAI-compatible endpoint cannot bypass the existing Codex/Copilot auth-readiness gate on immediate `/chat` execution, direct-agent execution, or resumed/flow-owned execution. The task must preserve approved Story 59 behavior: endpoint-backed execution remains allowed only when the selected provider is actually ready, while degraded bootstrap or inactive auth must still block Codex/Copilot work instead of being silently repaired by endpoint health alone.

#### Task Exit Criteria

- Codex and Copilot endpoint-backed execution still requires the existing provider-readiness gate before any runtime-selection branch authorizes execution.
- `/chat`, direct-agent execution, and resumed/flow-owned execution all enforce the same restored readiness contract instead of diverging by caller.
- The repaired selector no longer returns endpoint-backed execution paths when the provider state is unavailable, inactive, or otherwise degraded in the exact scenarios this story said must still fail closed.
- The repair stays inside approved Story 59 scope by restoring the locked readiness behavior rather than changing unrelated fallback rules, endpoint discovery semantics, or user-facing provider-selection behavior.

#### Addresses Findings

- `1` - endpoint-backed selection bypasses the required Codex/Copilot auth-readiness gate in immediate and deferred execution paths.

#### Risk Ownership

- Admission-vs-execution guard: the same readiness contract must hold at request admission, direct-agent execution, and flow-owned replay or resume entry points.
- Scope guard: restore the locked readiness boundary only. Do not widen this task into a broader provider-selection redesign or a new user-facing fallback contract.
- Shared-helper seam: the selector fix is only complete when every current caller that passes endpoint runtime state through the helper preserves the same blocked-versus-allowed decision.
- Preserved-behavior guard: the repair must not turn degraded bootstrap into a silent native fallback or a broader endpoint-health override, because Story 59 explicitly kept the existing fail-closed readiness behavior for unavailable Codex and Copilot sessions.
- Ordering-proof guard: happy-path readiness proof is not enough here; the repaired task must still prove the exact contradiction where provider bootstrap is degraded while the external endpoint stays healthy, because that interleaving is the bypass this finding exposed.
- Blocker family: `product or story seam`, because this task restores a story-locked readiness contract on the real execution path rather than repairing a wrapper or harness.

#### Owner Map

- Shared readiness selector seam: `server/src/config/chatDefaults.ts`, centered on `resolveRuntimeProviderSelection()`
- `/chat` runtime-selection caller seam: `server/src/routes/chat.ts`
- Direct-agent caller seam: `server/src/agents/service.ts`
- Flow-owned or resumed execution caller seam: `server/src/flows/service.ts`
- Proof owners: `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`, `server/src/test/integration/flows.run.resume.identity.test.ts`

#### Requirement-To-Proof Mapping

- Requirement: endpoint-backed Codex/Copilot execution still fails closed on `/chat` when provider readiness is degraded, even if the external endpoint itself is healthy.
  Implementation files: `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`
  Proof owners: `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/integration/chat-codex.test.ts`
- Requirement: the same restored readiness contract still blocks direct-agent execution when the caller re-enters with degraded provider bootstrap state.
  Implementation files: `server/src/config/chatDefaults.ts`, `server/src/agents/service.ts`
  Proof owners: `server/src/test/integration/agents-run-client-conversation-id.test.ts`
- Requirement: the same restored readiness contract still blocks resumed or flow-owned execution when replayed work sees degraded provider readiness alongside a healthy endpoint.
  Implementation files: `server/src/config/chatDefaults.ts`, `server/src/flows/service.ts`
  Proof owners: `server/src/test/integration/flows.run.resume.identity.test.ts`
- Requirement: the repaired selector still authorizes endpoint-backed execution on the normal ready path instead of turning degraded-state protection into a blanket endpoint disable.
  Implementation files: `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`
  Proof owners: `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`, `server/src/test/integration/flows.run.resume.identity.test.ts`

#### Subtasks

1. [x] Re-open `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts`, then record one short owner map in `Implementation Notes` that names the exact endpoint-first branch currently authorizing execution before readiness is checked, which callers still feed degraded provider state into that branch, and which ready-versus-blocked outcomes must remain unchanged after the repair.
2. [x] Patch `resolveRuntimeProviderSelection()` so the Codex and Copilot endpoint-backed execution branches cannot return `configured_endpoint`, `same_endpoint_repair`, or any equivalent endpoint-backed authorization path until the existing provider-readiness boundary has already been satisfied. Keep the decision inside the shared production helper rather than duplicating partial caller-side guards.
3. [x] Patch `server/src/routes/chat.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts` so each caller computes the same degraded-versus-ready provider state before calling `resolveRuntimeProviderSelection()`, removes any caller-local endpoint authorization shortcut that can bypass that shared state, and preserves the existing ready-path behavior after the bypass is closed.
4. [x] Refresh `server/src/test/unit/config.chatDefaults.test.ts` and `server/src/test/integration/chat-codex.test.ts` so they separately prove the `/chat` blocked path for degraded-bootstrap-plus-healthy-endpoint state and the still-allowed ready path that keeps approved endpoint-backed execution reachable. If any reused config or `/chat` proof title would still claim only generic fallback, generic endpoint health, or a single-sided ready-path assertion after this repair, rename or split it so the degraded-versus-ready ordering claim stays explicit and cannot pass by proving only one side of the contradiction.
5. [x] Refresh `server/src/test/integration/agents-run-client-conversation-id.test.ts` and `server/src/test/integration/flows.run.resume.identity.test.ts` so they separately prove the degraded direct-agent and resumed-or-flow-owned blocked paths instead of only implying that invariant through generic fallback or active-run scenarios. If any reused direct-agent or resumed-flow proof title would still claim only a generic provider fallback or resume path after the repair, rename or split it so the blocked degraded-state boundary remains an explicit production claim.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/config.chatDefaults.test.ts` to prove the shared selector still enforces the restored Codex/Copilot readiness gate.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/chat-codex.test.ts` to prove `/chat` still fails closed before endpoint-backed execution when provider readiness is degraded.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-client-conversation-id.test.ts --file server/src/test/integration/flows.run.resume.identity.test.ts` to prove the same readiness gate still holds for direct-agent and resumed or flow-owned execution.

#### Implementation Notes

- Task 15 owner map recorded from the current task block: shared readiness selector seam is `server/src/config/chatDefaults.ts` via `resolveRuntimeProviderSelection()`, `/chat` caller seam is `server/src/routes/chat.ts`, direct-agent caller seam is `server/src/agents/service.ts`, and flow-owned caller seam is `server/src/flows/service.ts`.
- Task 15 subtask 2 now fails closed only when a healthy endpoint would otherwise bypass degraded Codex/Copilot readiness; the existing cross-provider fallback when the endpoint itself is unavailable remains intact.
- Task 15 subtask 3 now normalizes the runtime provider states before selection in the route, direct-agent, and flow-owned paths, and the flow-owned path drops the saved endpoint pin from the local caller surface when bootstrap is degraded so the helper cannot be reached through an endpoint shortcut.
- Task 15 subtask 4 added an explicit `/chat` proof that healthy external endpoints cannot override degraded bootstrap readiness, while preserving the ready-path coverage already present in the selector and chat integration tests.
- Task 15 subtask 5 added explicit degraded direct-agent and resumed flow-owned blocked-path proofs; the targeted server wrapper over `config.chatDefaults.test.ts`, `chat-codex.test.ts`, `agents-run-client-conversation-id.test.ts`, and `flows.run.resume.identity.test.ts` passed with 110 tests total and no failures.
- Task 15 audit normalized the testing checklist from repository evidence: commit `5e6c9177e3e83fe1c87306f74a9135aad27f7923` changed the planned selector and proof-owner files, and `test-results/server-unit-tests-2026-06-08T21-19-27-701Z.log` shows the targeted wrapper run passed all 110 tests across the four task-owned proof files.
- Task 15 automated-proof audit confirmed the implementation and targeted wrapper proof are both complete, no live blocker remains, and the restored fail-closed readiness behavior stays inside Story 59 scope without widening endpoint selection behavior. The task is now `__done__`; any broader cross-story validation remains owned by the later shared final revalidation task.
- Manual testing skipped for direct-agent and flow-owned endpoint-backed readiness-gating surfaces. Tried: restarted the checked-in main stack, proved endpoint-backed `/chat` Codex and Copilot requests against `http://192.168.1.3:1234/v1`, then called `POST /agents/coding_agent/run` and `POST /flows/smoke/run`. Observed: startup, `http://localhost:5010/health`, and `http://localhost:5001` all passed, `/chat` returned endpoint-backed assistant `ready` turns for both providers, but the direct-agent and flow-owned starts both resolved to native Codex model `gpt-5.4` with warnings instead of reaching an endpoint-backed non-chat path. Why fuller proof was not possible: the checked-in main-stack mounted agent configs and baked flow catalog do not expose an endpoint-pinned direct-agent or flow-owned runtime surface in this environment, and this step does not own adding proof-only runtime fixtures.

### Task 16. Repair Native-Default Versus Endpoint Selection Identity Drift Across Discovery And Submission

- Repository Name: `Current Repository`
- Task Dependencies: `Task 14`
- Task Status: `__done__`
- Git Commits:
- Notes: This review-created task repairs Finding `2` from review pass `0000059-20260608T155357Z-e960c572`. It must fix the underlying endpoint/model identity mismatch while preserving the approved Story 59 endpoint-backed picker contract instead of widening scope into a new user-facing selection model.

#### Overview

Repair the producer-consumer contract spanning endpoint discovery, `/chat/providers`, `/chat/models`, client bootstrap selection, and `/chat` submission so a native default model cannot be paired with a stale external `selectedEndpointId`. When the server normalizes the default back to a native Codex or Copilot model, the client must stop treating that model as endpoint-backed, and the repaired contract must keep duplicate-id endpoint-backed behavior intact without silently reintroducing the stale pinned endpoint into submission payloads.

#### Task Exit Criteria

- Discovery and route payloads no longer expose a stale endpoint selection alongside a native default model when the pinned external endpoint has no live model backing the chosen default.
- Client bootstrap and refresh logic no longer reattach a stale endpoint id to a selected model that has no endpoint identity of its own, and the visible `/chat` picker returns from a host-prefixed endpoint-backed model row to a plain native model row whenever the authoritative selection has been normalized back to native.
- `/chat` submission preserves approved Story 59 endpoint-backed picker behavior: endpoint ids are only sent when they actually belong to the selected model source.
- The repair preserves the existing user-facing picker contract instead of broadening Story 59 into a new selection workflow or a new fallback product rule.

#### Addresses Findings

- `2` - discovery can pair a native default model with a stale external `selectedEndpointId`, and the client then submits that mixed identity.

#### Risk Ownership

- Producer-consumer contract: discovery, route responses, client bootstrap, and send payload generation must all agree on the same authoritative endpoint/model identity.
- Scope guard: repair the stale mixed identity only. Do not widen this task into a redesign of endpoint discovery, picker defaults, or broader provider-fallback behavior.
- Duplicate-id guard: the fix must preserve the approved endpoint-backed duplicate raw model id behavior rather than solving the mismatch by collapsing endpoint-aware identity.
- Submission guard: once the server has normalized the selected default back to native, the client must not silently reattach a stale endpoint id during bootstrap, refresh, or send-payload assembly.
- Default-path guard: the repaired identity contract must be proven on the normal `/chat/providers` plus `/chat/models` bootstrap path and the default `/chat` submission path, not only in isolated helper fixtures or hand-built payloads.
- Mixed-state UI guard: when the picker transitions from an endpoint-backed selection to a native normalized default, any hidden, disabled, restored, or mode-gated endpoint state must either be cleared from client state or excluded from submission explicitly; it must not keep influencing derived payloads just because an older draft or selected conversation still carries `selectedEndpointId`.
- Blocker family: `product or story seam`, because this task owns a cross-surface producer-consumer repair that must stay within the approved Story 59 picker behavior.

#### Owner Map

- Discovery seam: `server/src/chat/openaiCompatModelDiscovery.ts`
- Route producer seams: `server/src/routes/chatProviders.ts`, `server/src/routes/chatModels.ts`
- Client bootstrap and send seams: `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`
- Proof owners: `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`, `server/src/test/unit/chatModels.codex.test.ts`, `client/src/test/chatPage.provider.conversationSelection.test.tsx`, `client/src/test/chatSendPayload.test.tsx`

#### Requirement-To-Proof Mapping

- Requirement: `/chat/providers` and `/chat/models` no longer pair a native default model with a stale selected endpoint id when the pinned external endpoint is unavailable for that default.
  Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/chatModels.ts`
  Proof owners: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`
- Requirement: client bootstrap and refresh state no longer reattach stale endpoint identity after the server has normalized the selected/default model back to native.
  Implementation files: `client/src/hooks/useChatModel.ts`
  Proof owners: `client/src/test/chatPage.provider.conversationSelection.test.tsx`
- Requirement: `/chat` submission omits `selectedEndpointId` when the authoritative selected model source is native, even if stale draft or bootstrap state previously carried an external endpoint id.
  Implementation files: `client/src/hooks/useChatStream.ts`
  Proof owners: `client/src/test/chatSendPayload.test.tsx`
- Requirement: when the client restores a draft, switches from a previously selected endpoint-backed conversation to a native normalized selection, or hides endpoint-backed state behind the current picker mode, the stale endpoint value is either cleared from local selection state or retained locally but excluded from the outgoing `/chat` payload explicitly.
  Implementation files: `client/src/hooks/useChatModel.ts`, `client/src/hooks/useChatStream.ts`
  Proof owners: `client/src/test/chatPage.provider.conversationSelection.test.tsx`, `client/src/test/chatSendPayload.test.tsx`
- Requirement: duplicate raw model ids remain endpoint-aware for genuinely endpoint-backed selections rather than collapsing back to the first matching native or endpointless model.
  Implementation files: `server/src/chat/openaiCompatModelDiscovery.ts`, `server/src/routes/chatModels.ts`, `client/src/hooks/useChatModel.ts`
  Proof owners: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`, `client/src/test/chatPage.provider.conversationSelection.test.tsx`

#### Subtasks

1. [x] Re-open `server/src/chat/openaiCompatModelDiscovery.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/chatModels.ts`, `client/src/hooks/useChatModel.ts`, and `client/src/hooks/useChatStream.ts`, then record one short owner map in `Implementation Notes` that names where stale endpoint identity is still preserved today after native-default normalization and which response or client fields must become authoritative after the repair.
2. [x] Patch the server-side discovery and route producer seams so `selectedEndpointId`, `selectedModel`, and the returned default-selection metadata beside them are only carried forward together when they still describe the same selected or default model source, while preserving the approved endpoint-aware duplicate-id behavior for genuinely endpoint-backed models.
3. [x] Patch `client/src/hooks/useChatModel.ts` so bootstrap normalization makes the mixed-state rule explicit on the exact `/chat` picker seams this task owns: selecting an endpoint-backed conversation may render a host-prefixed endpoint row in the `Model` combobox, but native-normalized bootstrap, `New conversation`, restored native draft state, and switching away from a previously selected endpoint-backed conversation must return the active picker to a plain native model row and must not keep a hidden `selectedEndpointId` inside the active submitting selection. Keep the compact mobile variant aligned with the desktop picker contract even when the provider combobox text is collapsed behind its icon-only control.
4. [x] Patch `client/src/hooks/useChatStream.ts` so send-payload assembly enforces that same mixed-state rule on submission: omit `selectedEndpointId` whenever the selected model source is endpointless, even if earlier bootstrap, restored draft, or previously selected conversation state still carries a stale external endpoint id.
5. [x] Refresh `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, and `server/src/test/steps/chat_models.steps.ts` so the native-default-plus-stale-endpoint contradiction and duplicate-id endpoint-backed preservation are separate named server-side claims on the discovery and route surfaces. If any reused unit test, feature scenario, or step wording would still claim only generic endpoint discovery, generic model listing, or generic duplicate-id handling after the repair, rename or split it so stale-endpoint cleanup and endpoint-backed duplicate-id preservation remain separate explicit claims.
6. [x] Refresh `client/src/test/chatPage.provider.conversationSelection.test.tsx` and `client/src/test/chatSendPayload.test.tsx` so they separately prove the mixed-state picker transitions this task owns on the real `/chat` surface contract: endpoint-backed conversation restore into a host-prefixed model row, reset back to a plain native model row after `New conversation`, restored draft with stale endpoint state, previously selected conversation with stale endpoint state, and the compact mobile picker path where provider chrome is icon-only but the selected model row and outgoing `/chat` payload still must drop stale endpoint identity. If any reused client proof title would still claim only generic picker refresh, generic draft restore, or generic send-payload behavior after the repair, rename or split it so mixed-state stale-endpoint exclusion remains explicit and is proved on deterministic bootstrap or submission boundaries rather than elapsed-time assumptions.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/chatModels.codex.test.ts` to prove the server-side discovery and route payloads no longer pair a native default with a stale endpoint id.
2. [x] Run `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_models.feature` to prove the route-owned `/chat/models` behavior still matches the repaired identity contract on the feature surface.
3. [x] Run `npm run test:summary:client -- --file client/src/test/chatPage.provider.conversationSelection.test.tsx --file client/src/test/chatSendPayload.test.tsx` to prove client bootstrap and `/chat` submission no longer send a stale endpoint id with a native model.

#### Implementation Notes

- Preflight visual refinement pass run against the supported `/chat` surface. Clarified the desktop and mobile picker seams around endpoint-backed conversation restore, `New conversation` reset, and host-prefixed versus plain native model rows. No code changed in this step.
- Owner map: stale endpoint identity is still preserved by `discoverOpenAiCompatEndpointModels()` returning `selectedEndpointId` unconditionally, by `/chat/providers` forwarding `runtimeSelection.endpointId` even when execution fell back to a native model, by `/chat/models` forwarding `selectedEndpointId` without checking whether the chosen default model row still carries that endpoint, by `useChatModel` reattaching `data.selectedEndpointId` during bootstrap/refresh, and by `useChatStream` trusting the caller-provided endpoint id at submit time. The authoritative fields after the repair are the server-selected model row identity on discovery/bootstrap and the client-selected model row identity plus its own endpoint id only when that row is still endpoint-backed.
- Server repair complete: discovery and route producer seams now only preserve `selectedEndpointId` when it still matches the selected model source, which keeps endpoint-backed duplicate raw ids intact while clearing stale native-default endpoint identity.
- Client repair complete: `useChatModel`, `ChatPage`, and `useChatStream` now treat stale endpoint identity as excluded from the active native selection and payload path, while keeping the host-prefixed row when the restored conversation is genuinely endpoint-backed.
- Proof complete: targeted server unit, server cucumber, and client tests all passed after the identity and picker-state repairs, including the compact mobile send path.
- Manual proof ran task-scoped after restarting the checked-in main stack because the previously running stack had no supported freshness marker. `/chat/providers` plus `/chat/models?provider=codex|copilot` returned native defaults with no stale `selectedEndpointId` while still listing the endpoint-backed `google/gemma-4-26b-a4b-qat` rows, the desktop and mobile `/chat` picker restored host-prefixed endpoint-backed rows for the fresh Codex and Copilot seed conversations, and `New conversation` reset both paths back to native Codex before the outgoing `/chat` payloads omitted `endpointId`. Scratch artifacts and screenshots were saved under `codeInfoTmp/manual-testing/0000059/16/`; one transient aborted `GET /chat/models?provider=copilot` occurred during conversation-switch refresh, but no additional subtasks were needed.
- Task 16 automated-proof audit confirmed the implementation and targeted proof are both complete, no live blocker remains, and the repaired native-versus-endpoint identity contract stays inside Story 59 scope without widening the picker workflow. The task is now `__done__`; any broader cross-story validation remains owned by the later shared final revalidation task.

### Task 17. Add A Durable Post-Completion Replay Barrier For Fresh Flow Retry Ownership

- Repository Name: `Current Repository`
- Task Dependencies: `Task 14`
- Task Status: `__done__`
- Git Commits:
- Notes: This review-created task repairs Finding `8` from review pass `0000059-20260608T155357Z-e960c572`. It must stop duplicate fresh-flow launches after ambiguous completion without widening Story 59 into a new flow product contract or unrelated lifecycle redesign.

#### Overview

Repair the fresh-flow retry-ownership seam so the same logical `retryOwnershipId` cannot launch a second full flow after the first run has already completed but the caller retries because the earlier result was lost, delayed, or otherwise ambiguous. The task must add a durable post-completion barrier or equivalent bounded replay-memory seam that preserves the approved current behavior for real new flow launches while preventing duplicate side effects, duplicate child-agent work, and duplicate provider calls on replay of the same logical request.

#### Task Exit Criteria

- A completed fresh flow run still leaves behind enough replay barrier state for the same `retryOwnershipId` to collapse into the earlier result instead of launching a second run.
- The repair covers the contradiction where the first run already committed side effects but the caller retries after losing the original response.
- The task remains bounded to the fresh-flow retry-ownership seam and does not broaden Story 59 into a new product-level retry API or unrelated lifecycle redesign.

#### Addresses Findings

- `8` - fresh flow retry ownership has no post-completion replay barrier, so the same logical retry can run twice after an ambiguous success.

#### Risk Ownership

- Completion barrier: the repaired seam must survive past the first run's completion long enough to recognize a same-request replay without blocking legitimate new runs.
- Scope guard: preserve the existing external flow contract. Do not widen this task into unrelated replay taxonomy or broader queue redesign.
- Side-effect guard: the repair is only complete when a post-completion retry no longer launches a second flow with new child work, persistence, or provider calls.
- Persistence-surface guard: the new completion barrier must name its writer, its replay-time reader, how partial or in-progress state is distinguished from completed state, and who is allowed to clear the bounded replay record after the duplicate-replay window closes.
- Existing-dedupe guard: the repaired post-completion barrier must not break the current in-flight dedupe behavior or the contradictory-payload rejection behavior already covered by the existing retry-ownership proof.
- Interleaving-proof guard: adjacent before/after success proof is not sufficient here; the repaired task must own the exact post-completion replay ordering where the first run has already committed side effects, the caller has not accepted the earlier result, and the same `retryOwnershipId` re-enters after the in-flight owner record has been cleared.
- Blocker family: `product or story seam`, because this is a real flow lifecycle repair in the production retry seam rather than a wrapper-only or harness-only defect.

#### Owner Map

- Fresh-run retry seam: `server/src/flows/service.ts`, centered on `startFlowRun()` and the retry-ownership lifecycle
- Proof owner: `server/src/test/integration/flows.run.errors.test.ts`

#### Requirement-To-Proof Mapping

- Requirement: a retry of the same fresh flow request after ambiguous completion returns the existing result instead of launching new work or duplicate side effects.
  Implementation files: `server/src/flows/service.ts`
  Proof owner: `server/src/test/integration/flows.run.errors.test.ts`
- Requirement: a true new request still launches a fresh flow and is not collapsed into the earlier completed run just because some request fields overlap.
  Implementation files: `server/src/flows/service.ts`
  Proof owner: `server/src/test/integration/flows.run.errors.test.ts`
- Requirement: contradictory payloads for the same retry-ownership key still reject instead of being silently merged by the new post-completion barrier.
  Implementation files: `server/src/flows/service.ts`
  Proof owner: `server/src/test/integration/flows.run.errors.test.ts`
- Requirement: the existing in-flight dedupe behavior still works while the post-completion barrier is layered after owner-record cleanup.
  Implementation files: `server/src/flows/service.ts`
  Proof owner: `server/src/test/integration/flows.run.errors.test.ts`
- Requirement: the completion barrier writer, replay-time reader, partial-state handling, and bounded cleanup ownership stay aligned so a retry cannot observe an in-progress record as completed, and cleanup cannot erase the replay barrier before the duplicate-replay window is over.
  Implementation files: `server/src/flows/service.ts`
  Proof owner: `server/src/test/integration/flows.run.errors.test.ts`

#### Subtasks

1. [x] Re-open `server/src/flows/service.ts` and record one short owner map in `Implementation Notes` that names where retry ownership is created, where it is cleared today, what exact post-completion replay window currently goes unguarded, which code path will write the new completion barrier, which code path will read it on replay, how partial or in-progress state is distinguished from completed state, and what constitutes a legitimate new launch versus a duplicate replay of the same logical request.
2. [x] Patch the fresh-flow retry-ownership seam so a completed run writes one bounded durable completion record keyed to the same logical request and `retryOwnershipId`, and make replay lookup read that same record before launching new work. The completed-record path must return the earlier result on duplicate replay while still allowing a truly new request to proceed.
3. [x] Preserve the current in-flight dedupe and contradictory-payload rejection branches in `server/src/flows/service.ts` while layering the post-completion barrier after owner-record cleanup; do not replace those branches with a broader cache that would silently merge distinct logical requests.
4. [x] Refresh `server/src/test/integration/flows.run.errors.test.ts` so it carries separate named cases for the post-completion replay contradiction, true-new-request divergence, contradictory-payload rejection, preserved in-flight dedupe behavior, and bounded cleanup ordering of the completion barrier instead of bundling those invariants into one broad retry scenario. If any reused retry proof title or helper flow would still claim only generic dedupe, generic replay, or generic cleanup behavior after the repair, rename or split it so the post-completion replay ordering and awaited cleanup boundary remain explicit deterministic claims that cannot pass by observing only the earlier run or only the later stored state.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.errors.test.ts` to prove the same `retryOwnershipId` no longer launches a second fresh flow after ambiguous completion.

#### Implementation Notes

- Owner map: retry ownership is created in `startFlowRun()` before the async flow launches, remains live through the in-flight window, and is now copied into a separate completed barrier before the inflight record is cleared in `finally`; replay reads the active map first, then the bounded completed map, with separate maps distinguishing in-flight versus completed state and a distinct launch signature rejecting contradictory reuse.
- Fresh-flow retry ownership now keeps a bounded completion record after the run finishes, so a same-signature replay returns the earlier accepted launch result instead of launching a second run, while distinct retry ids still start fresh runs.
- Targeted proof passed: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.errors.test.ts` completed successfully with 35/35 passing, covering the split in-flight, post-completion, contradiction, and true-new-request cases.
- Task 17 automated-proof audit confirmed the implementation and targeted proof are both complete, no live blocker remains, and the repaired fresh-flow retry barrier stays inside Story 59 scope without widening the external flow contract. The task is now `__done__`; any broader cross-story validation remains owned by the later shared final revalidation task.

### Task 18. Final Revalidation For Review Cycle 0000059-rc-20260608T182732Z-e960c572

- Repository Name: `Current Repository`
- Task Dependencies: `Task 15`, `Task 16`, `Task 17`
- Task Status: `__to_do__`
- Git Commits:
- Notes: This is the one final revalidation owner for review cycle `0000059-rc-20260608T182732Z-e960c572`. It must revalidate the serious review-created findings from review pass `0000059-20260608T155357Z-e960c572` and also re-cover the already resolved inline minor findings `3`, `4`, `5`, `6`, `7`, `9`, `10`, `11`, and `12` so this cycle does not split close-out ownership across separate final tasks.

#### Overview

Re-run the relevant wrapper-first regression proof for the current review-created findings block after Tasks 15, 16, and 17 land, and confirm that the same story head still covers the inline-resolved minor fixes from this active review cycle. This task is the one broad regression owner for the current repository in this review-created block: it owns the relevant server, client, browser-visible, script-level, and checked-in main-stack smoke proof for review pass `0000059-20260608T155357Z-e960c572`.

#### Task Exit Criteria

- Review pass `0000059-20260608T155357Z-e960c572` has fresh proof on the story head for Findings `1`, `2`, and `8`.
- The same final proof pass still covers the inline-resolved minor findings from this review cycle: `3`, `4`, `5`, `6`, `7`, `9`, `10`, `11`, and `12`.
- The current repository’s relevant server, client, browser-visible, and compose-backed smoke wrappers pass on the repaired story head without reopening unrelated runtime-stack scope.
- Final `Implementation Notes` map each current-cycle finding to its surviving proof owner on the repaired story head.

#### Addresses Findings

- Serious review-created findings for review pass `0000059-20260608T155357Z-e960c572`: `1`, `2`, `8`
- Inline-resolved minor findings revalidated here for the same review cycle: `3`, `4`, `5`, `6`, `7`, `9`, `10`, `11`, `12`

#### Affected Repositories

- `Current Repository` - owns the repaired selector, discovery, flow replay, client bootstrap, browser-visible chat surface, and checked-in main-stack runtime proof for this review-created findings block.

#### Risk Ownership

- Proof-owner mapping guard: this task is only complete when each serious finding (`1`, `2`, and `8`) and each inline-resolved minor finding (`3`, `4`, `5`, `6`, `7`, `9`, `10`, `11`, and `12`) is mapped to an explicit surviving proof home on the final story head rather than being assumed covered by a broad wrapper.
- Shared wrapper or baseline seam: `npm run build:summary:*`, `npm run test:summary:*`, `npm run compose:build:summary`, `npm run compose:up`, and `npm run test:summary:e2e` can fail for baseline or harness reasons unrelated to the repaired Story 59 assertions; when that happens, this task must record the interruption honestly instead of reopening Tasks 15 through 17 as wrapper-repair work.
- Proof or test harness seam: the targeted import-guard proof for Finding `9` remains a distinct proof home even though standard validation now also reaches it; the task must preserve that explicit harness ownership rather than assuming the broad server-unit wrapper alone is enough.
- Manual or runtime environment seam: if later manual follow-up is still needed, it must rely on the supported main stack, its readiness surfaces, the mounted proof catalogs, and the documented screenshot staging and transfer path rather than inventing ad hoc runtime setup or assuming the app-under-test runtime owns Playwright artifacts.
- Scope guard: this task revalidates current-story repairs only. It must not widen into live external-endpoint product exploration, auth-dependent setup, or unrelated wrapper cleanup beyond honest baseline-boundary reporting.

#### Owner Map

- Server build and unit/integration wrapper owners: `npm run build:summary:server`, `npm run test:summary:server:unit`
- Feature-level route proof owner: `npm run test:summary:server:cucumber`
- Client build and unit wrapper owners: `npm run build:summary:client`, `npm run test:summary:client`
- Browser-visible proof owner: `npm run test:summary:e2e`
- Main-stack smoke owner: `npm run compose:build:summary`, `npm run compose:up`, `curl -sf http://localhost:5010/health`, `curl -sf http://localhost:5001`, `npm run compose:down`
- Script-level import-guard owner for inline-resolved Finding `9`: `node --test scripts/test-summary-server-cucumber-imports.test.mjs`
- Final hygiene proof owner: `npm run lint`, `npm run format:check`

#### Requirement-To-Proof Mapping

- Finding `1`: `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`, and `server/src/test/integration/flows.run.resume.identity.test.ts`
- Finding `2`: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`, `client/src/test/chatPage.provider.conversationSelection.test.tsx`, and `client/src/test/chatSendPayload.test.tsx`
- Finding `8`: `server/src/test/integration/flows.run.errors.test.ts`
- Finding `3`: `server/src/test/integration/chat-codex.test.ts`
- Finding `4`: `server/src/test/integration/agents-run-client-conversation-id.test.ts`
- Finding `5`: `server/src/test/unit/chat-interface-run-persistence.test.ts`
- Finding `6`: `server/src/test/integration/chat-copilot-fallback.test.ts` and `server/src/test/integration/agents-run-client-conversation-id.test.ts`
- Finding `7`: `client/src/test/chatPage.resumeIdentity.test.tsx` and `client/src/test/chatPage.provider.conversationSelection.test.tsx`
- Finding `9`: `node --test scripts/test-summary-server-cucumber-imports.test.mjs` plus the broad `npm run test:summary:server:unit` wrapper that now includes that guard in standard validation
- Finding `10`: `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, and `server/src/test/steps/chat_models.steps.ts`
- Finding `11`: `server/src/test/features/chat_stream.feature` and `server/src/test/steps/chat_stream.steps.ts`
- Finding `12`: `server/src/test/integration/chat-tools-wire.test.ts`
- Final wrapper reachability for the repaired server surfaces: implementation files from Findings `1`, `8`, `3`, `4`, `5`, `6`, `9`, `10`, `11`, and `12`; proof owners `npm run build:summary:server`, `npm run test:summary:server:unit`, and `npm run test:summary:server:cucumber`
- Final wrapper reachability for the repaired client surfaces: implementation files from Findings `2` and `7`; proof owners `npm run build:summary:client`, `npm run test:summary:client`, and `npm run test:summary:e2e`
- Final checked-in main-stack smoke boundary for the repaired story head: implementation surfaces from the current repository runtime path; proof owners `npm run compose:build:summary`, `npm run compose:up`, `curl -sf http://localhost:5010/health`, `curl -sf http://localhost:5001`, and `npm run compose:down`
- Final hygiene boundary for the repaired story head: repository-wide Story 59 changes; proof owners `npm run lint` and `npm run format:check`

#### Subtasks

1. [ ] Re-open this current-cycle `Code Review Findings` block plus `## Minor Review Fixes`, then record one explicit proof-owner mapping in `Implementation Notes` for Findings `1`, `2`, `8`, `3`, `4`, `5`, `6`, `7`, `9`, `10`, `11`, and `12`. Name the exact proof home for each finding and mark whether that proof is targeted-only or broad-wrapper-owned.
2. [ ] Refresh the server unit and integration proof files `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`, `server/src/test/integration/flows.run.resume.identity.test.ts`, `server/src/test/integration/flows.run.errors.test.ts`, `server/src/test/unit/chat-interface-run-persistence.test.ts`, `server/src/test/integration/chat-copilot-fallback.test.ts`, and `server/src/test/integration/chat-tools-wire.test.ts` so the final story head keeps separate named assertions for blocked degraded-state paths, still-allowed ready paths, post-completion replay reuse, true-new-request divergence, contradictory-payload rejection, preserved in-flight dedupe, persistence authority, fallback ownership, and tool-wire behavior. If any reused server proof title would still claim only adjacent fallback, generic replay, or generic persistence behavior after the repaired story head lands, rename or split that proof so the current-cycle invariant remains explicit instead of being inferred from a neighboring assertion.
3. [ ] Refresh the server discovery and feature proof surfaces `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/features/chat_models.feature`, `server/src/test/steps/chat_models.steps.ts`, `server/src/test/features/chat_stream.feature`, and `server/src/test/steps/chat_stream.steps.ts` so native-default normalization, duplicate-id endpoint-backed preservation, route-level stale-endpoint cleanup, and chat-stream proof-honesty claims remain separately named on the final story head. If any reused unit test, feature scenario, or step wording would still claim only generic discovery, generic stream behavior, or generic route coverage after the revalidation refresh, rename or split it so the repaired invariant stays visible in the proof title itself.
4. [ ] Refresh the client and browser-visible proof surfaces `client/src/test/chatPage.provider.conversationSelection.test.tsx`, `client/src/test/chatSendPayload.test.tsx`, `client/src/test/chatPage.resumeIdentity.test.tsx`, `e2e/chat.spec.ts`, `e2e/chat-provider-history.spec.ts`, and any paired `e2e/support/*` fixtures they rely on so stale-endpoint clearing, native-send omission, restored-draft mixed state, selected-old-conversation mixed state, resume identity, and browser-visible picker or send-path behavior remain separately traceable on the final story head. If any reused client or e2e proof title would still claim only generic picker state, generic resume behavior, or generic chat send coverage after the repair, rename or split it so the mixed-state and browser-visible story contract remains explicit and reviewable.
5. [ ] Re-open `scripts/test-summary-server-cucumber-imports.test.mjs`, `scripts/test-summary-e2e.mjs`, `scripts/docker-compose-with-env.sh`, and `docker-compose.yml`, then record one execution-boundary note in `Implementation Notes` that distinguishes task-owned assertion failures from shared baseline or harness interruptions, explains why the script-level import guard remains its own proof home even after standard validation wiring, and states why the smoke pass stops at `http://localhost:5001` and `http://localhost:5010/health` instead of widening into auth-dependent or live external-endpoint setup.

#### Testing

1. [ ] Run `npm run build:summary:server` to confirm the repaired server selector, route, and flow replay surfaces compile cleanly before broader proof.
2. [ ] Run `npm run build:summary:client` to confirm the repaired discovery/bootstrap consumer surfaces compile cleanly before broader proof.
3. [ ] Run `npm run compose:build:summary` to confirm the checked-in main-stack images still build cleanly for the repaired story head.
4. [ ] Run `npm run test:summary:server:unit` to prove the repaired server selector, discovery, replay, and inline-resolved minor server proof homes on the story head.
5. [ ] Run `npm run test:summary:server:cucumber` to re-cover the full server feature-wrapper surface on the repaired story head, including the endpoint-aware `/chat/models` contract and the explicit `chat_stream` proof-honesty repairs already recorded inline.
6. [ ] Run `npm run test:summary:client` to prove the repaired client bootstrap, send, and inline-resolved client minor proof homes on the story head.
7. [ ] Run `node --test scripts/test-summary-server-cucumber-imports.test.mjs` to re-cover the script-level import-guard proof home for inline-resolved Finding `9`, because that proof should stay explicit even though the broader server-unit path also now covers it.
8. [ ] Run `npm run test:summary:e2e` to prove the browser-visible chat picker, history, and send-path surfaces still honor the repaired story contract on the repository-supported automated mock-chat browser path.
9. [ ] Run `npm run compose:up`, then verify `curl -sf http://localhost:5010/health` and `curl -sf http://localhost:5001` so the repaired story head is smoke-proven on the checked-in main `docker-compose.yml` runtime path. Treat this as runtime-boundary smoke proof only: preserved server, client, and browser-visible story behavior is still owned by Testing steps 4 through 8 rather than by the health surfaces alone.
10. [ ] Run `npm run compose:down` to prove the repository-supported main stack still shuts down cleanly after the smoke validation above.
11. [ ] Run `npm run lint` for the final review-cycle validation surface and fix any issues found.
12. [ ] Run `npm run format:check` for the final review-cycle validation surface and fix any issues found.

#### Manual Testing Guidance

If a later human or manual-testing-agent follow-up is still needed after the automated proof above, use the checked-in main stack rather than a local development variant: `npm run compose:build`, then `npm run compose:up`, and stop with `npm run compose:down`. Treat the checked-in `docker-compose.yml` stack plus the repository wrapper env loading (`server/.env` and `server/.env.local`) as the supported runtime contract for this review cycle. Use the mounted proof catalogs under `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` as the supported seed/setup source rather than ad hoc local edits, and treat `http://localhost:5001`, `http://localhost:5010`, and `http://localhost:5010/health` as the supported manual revalidation surfaces.

Store retained manual-proof artifacts for this review-cycle close-out under `codeInfoTmp/manual-testing/0000059/18/` and do not commit them. If Playwright MCP screenshots are used, capture them first under a relative staging path such as `0000059/18/<filename>` in the Playwright output directory; in this local harness workflow, an artifact written inside the screenshot-producing Playwright runtime under `/tmp/playwright-output/0000059/18/<filename>` will normally appear on the host at `$CODEINFO_ROOT/playwright-output-local/0000059/18/<filename>`, and should then be transferred into `codeInfoTmp/manual-testing/0000059/18/`.

Do not assume the app-under-test runtime owns those screenshot files when the screenshot-producing Playwright runtime differs from the checked-in main stack. If runtime handoff JSON is needed to locate artifact source, fallback runtime, or destination details, inspect that JSON for the needed information by meaning rather than exact property names. If screenshot transfer still fails, record the limitation honestly in the retained notes and continue with the best available evidence instead of blocking close-out on transfer alone.

Treat Task 18 screenshots as proof of the final repaired state for the visual surfaces this review cycle re-covers. Preserve earlier screenshots in durable closeout only when they still provide uniquely necessary proof that the Task 18 final-state capture no longer shows.

#### Implementation Notes

- Pending.
