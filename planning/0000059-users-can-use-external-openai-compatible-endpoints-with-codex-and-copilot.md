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

### Questions

None.

## Decisions

1. Picker visibility for config-pinned endpoints
   - The question being addressed: If a chat config names an endpoint outside the env var list, should that endpoint still appear in the chat picker?
   - Why the question matters: A hidden config-backed default would make the selected endpoint hard to understand, verify, or reselect in the UI.
   - What the answer is: Yes. If a chat config pins `codeinfo_openai_endpoint`, that active endpoint and its discovered models still appear in the chat picker even when the same endpoint is absent from `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
   - Where the answer came from: The user's answer, the current chat bootstrap and selected-model flow in [client/src/hooks/useChatModel.ts](/home/dan/code/codeInfo2/client/src/hooks/useChatModel.ts:153), and the existing story rules that allow `codeinfo_openai_endpoint` to stand on its own without the env var list.
   - Why it is the best answer: It keeps the active default visible, avoids confusing hidden state, and uses the endpoint's own `/v1/models` response rather than requiring duplicate env configuration just for the picker.
2. Conversation persistence for external endpoint selections
   - The question being addressed: When we save a conversation using an external endpoint, should the endpoint be stored separately from the model?
   - Why the question matters: Resumed conversations need to tell apart the same model id coming from different endpoints without burying routing data in one opaque string.
   - What the answer is: Yes. Store the raw model id separately from the derived endpoint identity.
   - Where the answer came from: The user's answer, the current conversation schema in [server/src/routes/conversations.ts](/home/dan/code/codeInfo2/server/src/routes/conversations.ts:60), and the conversation restore flow in [client/src/pages/ChatPage.tsx](/home/dan/code/codeInfo2/client/src/pages/ChatPage.tsx:817).
   - Why it is the best answer: It fits the repo's existing pattern of separate persisted fields, stays easier to inspect and migrate, and still prevents collisions between the same model id on different endpoints.
3. Chat labels for external endpoint models
   - The question being addressed: How should external models be labeled in chat: `host / model`, full URL, or just the model name?
   - Why the question matters: Users need a picker label that distinguishes identical model ids without filling the UI with long endpoint strings.
   - What the answer is: Use `host / model`.
   - Where the answer came from: The user's answer, the current provider and model label handling in [client/src/hooks/useChatModel.ts](/home/dan/code/codeInfo2/client/src/hooks/useChatModel.ts:17) and [server/src/routes/chatModels.ts](/home/dan/code/codeInfo2/server/src/routes/chatModels.ts:106), and the OpenAI-compatible model-list pattern where source context must often be added by the client.
   - Why it is the best answer: It is short, readable, and gives enough source context to distinguish duplicate model ids without exposing a noisy full URL.
4. Full endpoint identity for same-host URLs
   - The question being addressed: If two endpoints share a host but use different paths, should we treat them as different endpoints?
   - Why the question matters: Same-host deployments can still be different endpoints, so host-only identity could merge distinct routes by mistake.
   - What the answer is: Yes. Treat endpoints as different when their normalized full base URLs differ, even if the host is the same.
   - Where the answer came from: The user's answer, local URL and path identity patterns such as [server/src/lmstudio/clientPool.ts](/home/dan/code/codeInfo2/server/src/lmstudio/clientPool.ts:4) and [server/src/routes/lmstudioUrl.ts](/home/dan/code/codeInfo2/server/src/routes/lmstudioUrl.ts:1), plus the official Copilot and Codex docs that treat `baseUrl` as a full endpoint configuration.
   - Why it is the best answer: It matches the repo's established identity rules, avoids collapsing distinct routes, and still leaves room for shorter display labels in the UI.
5. Collision handling for `host / model` labels
   - The question being addressed: If two labels would both read `host / model`, should chat add a short path to tell them apart?
   - Why the question matters: Two distinct endpoint choices should not look identical in the picker.
   - What the answer is: Yes. Use `host / model` by default, but append a short path hint only when two visible choices would otherwise collide.
   - Where the answer came from: The user's answer, local display-label patterns such as [client/src/pages/AgentsPage.tsx](/home/dan/code/codeInfo2/client/src/pages/AgentsPage.tsx:60), and the story's existing preference for short labels in the common case.
   - Why it is the best answer: It keeps the picker simple most of the time while still making edge-case collisions understandable.
6. Backward compatibility for older saved chats
   - The question being addressed: Should older saved chats without endpoint info still open normally?
   - Why the question matters: Existing persisted chats should keep working after the story adds endpoint identity for newer chats.
   - What the answer is: Yes. Older saved chats continue to open with the current provider-and-model behavior, and the new endpoint identity remains optional and is used only when present.
   - Where the answer came from: The user's answer, current backward-compatibility patterns in [server/src/mongo/conversation.ts](/home/dan/code/codeInfo2/server/src/mongo/conversation.ts:45), [server/src/mongo/repo.ts](/home/dan/code/codeInfo2/server/src/mongo/repo.ts:55), and [client/src/hooks/useConversations.ts](/home/dan/code/codeInfo2/client/src/hooks/useConversations.ts:144), plus Mongoose defaults guidance.
   - Why it is the best answer: It protects existing data, fits the repo's current schema-growth pattern, and avoids forcing migration work into this story.
7. Duplicate endpoint entries
   - The question being addressed: If the same endpoint is listed twice, should we keep the first one with a warning, or fail?
   - Why the question matters: Duplicate config entries are easy to create, and the product needs one predictable rule that does not surprise users.
   - What the answer is: Keep the first normalized endpoint entry and warn. Later duplicates are dropped.
   - Where the answer came from: The user's answer, duplicate-handling patterns in [server/src/routes/ingestRoots.ts](/home/dan/code/codeInfo2/server/src/routes/ingestRoots.ts:280), [server/src/flows/repositoryCandidateOrder.ts](/home/dan/code/codeInfo2/server/src/flows/repositoryCandidateOrder.ts:69), and [server/src/config/runtimeConfig.ts](/home/dan/code/codeInfo2/server/src/config/runtimeConfig.ts:760).
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
   - Where the answer came from: The user's answer and the fallback-selection behavior in [server/src/config/chatDefaults.ts](/home/dan/code/codeInfo2/server/src/config/chatDefaults.ts:477) and [server/src/config/chatDefaults.ts](/home/dan/code/codeInfo2/server/src/config/chatDefaults.ts:540).
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
