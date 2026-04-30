# Title

Users can use Copilot as a first-class chat provider with shared Agent Flags and defaults

# Acceptance

1. Chat users can choose Codex, Copilot, or LM Studio, with `CODEINFO_CHAT_DEFAULT_PROVIDER` still deciding the top-level default provider.
2. Chat users get each provider's default model and supported default Agent Flags from that provider's own `chat/config.toml` file instead of from one shared default-model setting.
3. Chat users see one provider-neutral `Agent Flags` panel that shows only the controls the selected provider and model actually support.
4. Chat users can change Agent Flags without losing the current conversation, while provider or model changes still start a new conversation on the next send.
5. Chat users can use Copilot with the product-managed tool layer in the normal chat page and through the shared `codebase_question` MCP path.
6. Saved conversations, resumed flows, and provider-specific payloads do not leak stale or unsupported state back into later requests or sidebar labels.
7. Existing Codex and LM Studio chat behaviour continues to work while defaults, validation, discovery, and proofs become provider-neutral.
8. Support and engineering users can bootstrap, validate, and explain the final contract through the repository's standard wrappers, runtime smoke path, and reviewer summary.

# Description

This story makes Copilot feel like a full chat provider in the same product surfaces where Codex already feels strong, while also cleaning up the shared chat architecture so it no longer depends on Codex-only defaults, payloads, and UI controls. When this work is complete, each provider owns its own repo-local defaults, the browser renders one honest Agent Flags experience for the selected provider and model, Copilot works through the normal tool-aware chat seams, and the story closes with stronger validation around stale state, replay safety, and reviewer-facing proof.

# Tasks

1. [codeInfo2] - Refresh the shared provider-local chat-config defaults and bootstrap foundation.

- Seed and reread `codex/chat/config.toml`, `copilot/chat/config.toml`, and `lmstudio/chat/config.toml` without bringing back `CODEINFO_CHAT_DEFAULT_MODEL`.
- Keep Copilot runtime state rooted under `copilot/`, preserve atomic config writes, and keep provider folders out of Git and Docker build inputs.

2. [codeInfo2] - Publish the combined provider-model-Agent-Flags discovery contract.

- Replace the old Codex-shaped discovery payload with one provider-neutral contract for providers, models, capability narrowing, and option descriptors.
- Keep provider ordering, fallback rules, and the distinction between seeded defaults and resolved defaults explicit in the shared response.

3. [codeInfo2] - Replace the normal chat request and persistence contract with provider-neutral `agentFlags`.

- Move normal chat requests and stored flags off the old Codex-only payload shape and onto shared `agentFlags`.
- Preserve same-conversation flag edits while clearing stale provider-specific state when provider or model boundaries change.

4. [codeInfo2] - Wire provider-neutral flags into Copilot, LM Studio, and MCP execution.

- Map the shared flags contract into real Copilot and LM Studio runtime behaviour without inventing fake symmetry.
- Add Copilot parity to the shared `codebase_question` MCP path while keeping the MCP request surface limited to provider and model.

5. [codeInfo2] - Repair the shared ESLint flat-config baseline so repo-wide lint respects ignored generated fixture trees.

- Fix the lint configuration so generated fixture trees and similar non-source paths stop polluting repo-wide lint results.
- Keep the lint baseline trustworthy before the broader Story 56 proof and closeout steps run.

6. [codeInfo2] - Move Copilot plaintext-persistence bootstrap to `settings.json` and make Copilot-managed JSON reads JSONC-safe.

- Make the Copilot auth bootstrap tolerant of Copilot-managed JSON-with-comments artifacts and use the live settings file as the plaintext source of truth.
- Keep device auth and runtime persistence coherent without weakening the existing runtime-home contract.

7. [codeInfo2] - Replace the chat page’s Codex-only flags architecture with a server-driven Agent Flags panel.

- Build a provider-neutral `AgentFlagsPanel` from the server response and remove the hardcoded Codex-only panel path.
- Keep mixed-state behaviour safe by clearing hidden values, rebuilding drafts on provider or model changes, and letting restored conversations win over staged drafts.

8. [codeInfo2] - Run final Story 0000056 validation and close out the provider-neutral chat contract.

- Update the main docs and the Story 56 PR summary so they describe the final provider-local defaults and Agent Flags contract truthfully.
- Prove the whole story through the repository’s normal build, test, container, browser, and runtime smoke wrappers.

9. [codeInfo2] - Harden the Copilot tool-off contract at the real session-registration seam.

- Repair the shared Copilot session-construction seam so `toolAccess: 'off'` really removes tool registration in both create and resume flows.
- Keep the proof focused on the real session-registration seam instead of only on empty metadata.

10. [codeInfo2] - Restore one bounded LM Studio option-domain contract across discovery, validation, defaults, and runtime execution.

- Re-align LM Studio `temperature` and `maxTokens` behaviour so discovery, defaults parsing, validation, and runtime execution all use the same bounded contract.
- Keep the proof explicit on bounded defaults, invalid input, runtime enforcement, and the repository-supported integration seam.

11. [codeInfo2] - Re-establish a server-owned boundary for persisted flow metadata on conversations.

- Stop ordinary conversation writes from persisting `flags.flow` or `flags.flowChild`, and keep flow-owned writes on the intended server path only.
- Prove that stale flow metadata cannot leak back into sidebar run clues or trusted flow-resume behaviour.

12. [codeInfo2] - Make Copilot seed import replay-safe after preflight checks.

- Repair the Copilot seed bootstrap path so a mid-run runtime initialization cannot be overwritten by stale seed artifacts.
- Keep staged-temp cleanup explicit so later runtime readers never see a partial mixed seed/runtime state.

13. [codeInfo2] - Revalidate review pass `0000056-20260429T204701Z-484b4dd4` after review-task repairs.

- Revalidate the serious review-created findings and the inline minor fixes together through one final wrapper-first proof pass.
- Refresh the PR summary and closeout notes so reviewers can see which focused proof owners and broad wrapper surfaces closed each finding.
