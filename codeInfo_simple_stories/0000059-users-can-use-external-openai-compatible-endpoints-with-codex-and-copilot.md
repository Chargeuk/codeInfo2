# Users can use external OpenAI-compatible endpoints with Codex and Copilot

# Acceptance

1. Users can see compatible external endpoint models in the existing `Codex` and `Copilot` chat pickers without adding a new top-level provider.
2. Users can set the default `Codex` or `Copilot` chat model from a local or remote OpenAI-compatible `/v1` endpoint by setting `codeinfo_openai_endpoint` and `model`.
3. Users can configure an agent to run through a `Codex` or `Copilot` external endpoint by setting `codeinfo_provider`, `codeinfo_openai_endpoint`, and `model`.
4. Users can keep a config-pinned endpoint visible in chat even when it is not listed in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
5. Users can rely on duplicate endpoint definitions collapsing to one active endpoint with a warning instead of breaking the whole configuration.
6. Users can resume older conversations that do not have endpoint identity, while newer endpoint-backed conversations keep the raw model id and endpoint identity separate.
7. Users can rely on new runs trying same-provider repair and fallback before broader provider fallback, while pinned or resumed runs fail in place instead of silently moving to a different endpoint or provider.
8. Users keep the current `LM Studio` and `Agents` page behavior for this story; the external model picker change applies only to `Codex` and `Copilot` chat.

# Description

This story lets CodeInfo2 use external OpenAI-compatible `/v1` endpoints as an extension of the existing `Codex` and `Copilot` provider experience instead of introducing a brand-new harness. It adds a simple repository-owned config contract, surfaces compatible external models in chat, translates those selections into the underlying Codex and Copilot runtime settings, and preserves clear fallback and resume behavior so users can adopt self-hosted or remote gateways without losing the current product flow.

# Tasks

1. [codeInfo2] - Upgrade the Codex and Copilot SDK baseline before feature work
- Update the package pins and exact-version guard in the server workspace.
- Re-check the existing Codex and Copilot seam tests before endpoint work builds on them.

2. [codeInfo2] - Parse and normalize external endpoint configuration
- Add the shared parser for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` and `codeinfo_openai_endpoint`.
- Extend startup and runtime-config validation so malformed, blank, and duplicate endpoint entries are handled consistently.

3. [codeInfo2] - Add shared external endpoint model discovery
- Build the reusable server helper that calls each normalized endpoint’s `/v1/models` API once and merges the results.
- Add the test-only fake endpoint helper used by discovery, timeout, and malformed-payload proof.

4. [codeInfo2] - Surface external endpoint models in the chat picker
- Extend the shared chat discovery contract and Chat page state so `Codex` and `Copilot` can show endpoint-backed models without adding a new provider id.
- Keep duplicate raw model ids, config-pinned endpoints, and stale create-versus-reuse picker state separate and visible.

5. [codeInfo2] - Translate endpoint selections into runtime config and persistence
- Carry `endpointId` separately from the raw `model` through chat payloads, conversation state, and resume behavior.
- Translate `codeinfo_openai_endpoint` into the provider-native Codex and Copilot runtime settings inside the server.

6. [codeInfo2] - Extend fallback and fail-in-place behavior for endpoint-backed runs
- Add same-endpoint repair, same-provider native fallback, and cross-provider fallback ordering for new runs.
- Preserve fail-in-place behavior for pinned or resumed chat, agent, and flow executions when the saved endpoint later becomes unavailable.

7. [codeInfo2] - Run final validation and update close-out documentation
- Refresh the README, structural traceability, and PR summary for the shipped external-endpoint contract.
- Add the final Cucumber, browser, Compose, and manual-proof ownership needed to close the story cleanly.
