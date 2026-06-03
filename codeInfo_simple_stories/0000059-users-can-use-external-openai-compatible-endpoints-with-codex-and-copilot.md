# Users can use external OpenAI-compatible endpoints with Codex and Copilot

# Acceptance

1. Users can see compatible external endpoint models in the existing `Codex` and `Copilot` chat pickers without adding a new top-level provider.
2. Users can set the default `Codex` or `Copilot` chat model from a local or remote OpenAI-compatible `/v1` endpoint by setting `codeinfo_openai_endpoint` alongside `model`.
3. Users can configure an agent to run through a `Codex` or `Copilot` external endpoint by setting `codeinfo_provider`, `codeinfo_openai_endpoint`, and `model`.
4. Users can keep a config-pinned endpoint visible in chat even when it is not listed in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`.
5. Users can rely on duplicate endpoint definitions collapsing to one active endpoint with a warning instead of breaking configuration.
6. Users can keep older saved conversations working while newer endpoint-backed conversations store the raw model id and endpoint identity separately.
7. Users can rely on new runs trying same-endpoint repair and same-provider fallback before broader provider fallback, while pinned or resumed runs fail in place instead of silently moving to a different endpoint or provider.
8. Users keep the current `LM Studio` and `Agents` page behavior for this story; the external model picker change applies only to `Codex` and `Copilot` chat.

# Description

This story extends the existing `Codex` and `Copilot` experience so teams can point chat and agent flows at external OpenAI-compatible `/v1` endpoints without learning provider-native wiring. It adds a simple repository-owned configuration contract, surfaces compatible external models in chat, preserves saved conversation identity, and keeps fallback behavior clear so self-hosted or remote model gateways fit into the current product flow instead of replacing it.

# Tasks

1. [codeInfo2] - Upgrade Codex and Copilot SDK baselines before story work
- Update the package versions and version guards for the Codex and Copilot runtime seams.
- Re-check the existing harness proof so endpoint work starts from a current supported baseline.

2. [codeInfo2] - Parse and normalize external endpoint config inputs
- Add the shared parser for `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` and `codeinfo_openai_endpoint`.
- Extend validation so malformed, blank, and duplicate endpoint entries are handled consistently.

3. [codeInfo2] - Add shared external endpoint model discovery
- Build the server helper that calls each normalized endpoint’s `/v1/models` API and merges the results.
- Add the fake endpoint support used by discovery, timeout, and malformed-payload proof.

4. [codeInfo2] - Surface external endpoint models in the chat picker
- Extend the chat discovery contract and chat page state so `Codex` and `Copilot` can show endpoint-backed models.
- Preserve duplicate-model labeling, config-pinned endpoints, and create-versus-reuse picker identity.

5. [codeInfo2] - Translate endpoint selections into runtime config and persistence
- Carry `endpointId` separately from the raw `model` through chat payloads, conversation state, and resume behavior.
- Translate `codeinfo_openai_endpoint` into repository-owned Codex and Copilot runtime settings on the server.

6. [codeInfo2] - Extend fallback, repair, and fail-in-place behavior for endpoint-backed runs
- Add same-endpoint repair, same-provider native fallback, and cross-provider fallback ordering for new runs.
- Preserve fail-in-place behavior for pinned or resumed chat, agent, and flow executions.

7. [codeInfo2] - Restore Docker-backed proof runtime access
- Repair the supported Docker and Compose access path that the final browser and runtime proof depends on.
- Keep this runtime prerequisite separate so later story validation can use the normal wrapper-backed stack.

8. [codeInfo2] - Restore Resume Endpoint Authority And Flow Ownership Guards
- Tighten the resume server and flow seams so saved endpoint identity stays authoritative on resumed work.
- Add focused proof for saved-endpoint precedence and stale-replay rejection before mutation.

9. [codeInfo2] - Complete Mobile Endpoint Playwright Coverage For The Chat Surface
- Extend the mobile chat browser proof for restored history, fresh-conversation reset, and endpoint-backed send behavior.
- Keep the proof on the normal chat surface instead of a one-off manual-only route.

10. [codeInfo2] - Final Story Validation, Documentation, And Close-Out
- Finish the README, structural traceability, and reviewer summary for the shipped external-endpoint contract.
- Re-run the final story proof bundle, including the current review-created findings block, full browser proof, and Compose-backed runtime validation.
