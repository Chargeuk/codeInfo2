# Title

Users can use Copilot as a first-class chat provider with shared Agent Flags and defaults

# Acceptance

1. Chat users can choose Codex, Copilot, or LM Studio with the default provider still controlled by `CODEINFO_CHAT_DEFAULT_PROVIDER`.
2. Chat users get each provider's default model and supported default Agent Flags from that provider's own `chat/config.toml` file instead of from one shared default-model setting.
3. Chat users see a provider-neutral `Agent Flags` panel that shows only the options the selected provider and model really support.
4. Chat users can change Agent Flags without losing the current conversation, while provider or model changes still start a new conversation on the next send.
5. Chat users can use Copilot with the product-managed tool layer in the normal chat page and through the shared `codebase_question` MCP path.
6. Existing Codex and LM Studio chat behaviour continues to work while the shared chat contract, defaults, and validation become provider-neutral.
7. Support and engineering users can understand the new defaults contract from updated docs and prove it through the repository's normal automated wrapper flows.

# Description

This story makes Copilot feel like a full chat provider in the same product surfaces where Codex already feels strong, while also cleaning up the chat architecture so it no longer depends on Codex-only defaults and UI controls. When this work is complete, the product will use one provider-neutral chat contract, each provider will own its own default model and supported default flags through seeded repo-local config, and users will get a simpler Agent Flags experience that stays honest to the selected provider.

# Tasks

1. [codeInfo2] - Move shared chat defaults into provider-local chat config files.

- Refresh the pinned Codex and Copilot packages and keep LM Studio aligned to the verified current version.
- Seed and reread `codex/chat/config.toml`, `copilot/chat/config.toml`, and `lmstudio/chat/config.toml` without bringing back `CODEINFO_CHAT_DEFAULT_MODEL`, while keeping Copilot runtime state rooted under `copilot/`.

2. [codeInfo2] - Publish one combined provider, model, and Agent Flags discovery contract.

- Replace the Codex-shaped discovery payload with one provider-neutral response family for providers, models, and option descriptors.
- Keep fallback ordering, per-model capability narrowing, provider-specific option honesty, and the distinction between seeded defaults and currently resolved defaults explicit in the shared contract.

3. [codeInfo2] - Replace the normal chat request and persistence contract with provider-neutral `agentFlags`.

- Update the `/chat` request path so validation, defaults resolution, and stored flags use provider-neutral naming.
- Preserve same-conversation flag edits while clearing stale provider-specific state such as Codex `threadId` when provider or model boundaries change.

4. [codeInfo2] - Wire provider-neutral flags into Copilot, LM Studio, and MCP execution.

- Map the new shared flags contract into real Copilot and LM Studio runtime behaviour without inventing fake symmetry.
- Add Copilot parity to the shared `codebase_question` MCP provider path while keeping the MCP request surface limited to provider and model.

5. [codeInfo2] - Replace the chat page's Codex-only flags UI with a server-driven Agent Flags panel.

- Build a provider-neutral `AgentFlagsPanel` from the server response and remove the hardcoded Codex-only panel path.
- Keep mixed-state behaviour safe by clearing hidden values, rebuilding drafts on provider or model changes, and letting restored conversations win over staged drafts.

6. [codeInfo2] - Run final Story 56 validation and close out the docs.

- Update the main repository docs and the Story 56 PR summary so they describe the final provider-local defaults and Agent Flags contract.
- Prove the whole story through the repository's normal build, test, container, browser, and runtime smoke wrappers.
