# Users can run agents with provider-neutral runtime config and `codeinfo_agents` folder support

# Acceptance

1. Users can run agents on Codex, GitHub Copilot, or LM Studio through one shared runtime contract instead of a Codex-only execution path.
2. Users can rely on layered runtime config, including repo-local `codeinfo_config/config.toml`, without needing that file to exist before startup.
3. Users can see clear warnings, disabled states, and fallback behavior when an agent has an invalid provider, no usable provider, or a duplicate definition.
4. Users can rely on `codeinfo_agents` taking precedence over `codex_agents`, while older layouts and env aliases continue to work for compatibility.
5. Users can reopen an existing conversation and keep its stored execution identity, while new conversations still re-evaluate the latest config and provider availability from scratch.
6. Users and support reviewers can trust startup, resumed `/chat`, resumed `codebase_question`, and disabled-agent run guards to stay consistent after the provider-neutral rollout.
7. Support and technical reviewers can validate the finished story through the normal wrapper-first build, test, browser, and compose-backed proof paths.

# Description

This story completes the move from a Codex-shaped runtime to a provider-neutral one for agents, flows, and repository-aware execution. It lets teams configure agents for different providers, keeps warnings and disabled-state behavior clear, preserves the correct execution identity when conversations resume, and keeps the newer neutral folder and env contracts compatible with older repository layouts. The follow-up review tasks also harden resumed runs, startup bootstrap, and replay behavior so the final rollout is safe and trustworthy.

# Tasks

1. [codeInfo2] - Replace the runtime-config bootstrap contract with provider-neutral repo-local layering

- Add the repo-local config layer and final precedence rules across repo, provider, chat, and agent config.
- Update startup bootstrap and fallback-order parsing so provider-neutral defaults load consistently.

2. [codeInfo2] - Introduce the neutral agent-home and `codeinfo_agents` precedence helper

- Add the shared helper for `CODEINFO_AGENT_HOME`, legacy alias fallback, and `codeinfo_agents` over `codex_agents`.
- Keep duplicate-agent warnings and lookup precedence consistent across discovery and cross-repo lookup.

3. [codeInfo2] - Resolve one shared repository execution context for chat and `code_info`

- Centralize repository execution context and working-directory resolution instead of letting each provider derive its own path.
- Reuse that shared execution payload across chat and `code_info` runs.

4. [codeInfo2] - Publish agent and flow warning-details surfaces from provider-neutral availability evaluation

- Add reusable availability evaluation for warnings, disabled reasons, and fallback candidates.
- Expose the new details contract through server routes and client-facing parsing.

5. [codeInfo2] - Repair shared Codex availability bootstrap for provider-neutral server proof suites

- Stabilize the shared Codex availability bootstrap used by provider-neutral server proof paths.
- Keep server proof harnesses honest before broader agent and flow execution changes depend on them.

6. [codeInfo2] - Switch direct agent runs and commands to provider-neutral execution with pinned conversation identity

- Move direct agent execution, fallback, model repair, and command lookup onto the provider-neutral runtime path.
- Keep persisted provider, model, and `agentName` authoritative for later turns.

7. [codeInfo2] - Switch flow-owned agent execution to the same provider-neutral runtime and continuation contract

- Remove remaining Codex-only flow execution assumptions and align flow-owned command lookup and warnings to the shared contract.
- Keep flow continuation, sibling state, and resume behavior explicitly proved.

8. [codeInfo2] - Update the Agents and Flows UI for warnings, disabled state, and pinned resumed execution identity

- Update client details loading, stale-state clearing, and resumed-versus-fresh-run behavior on Agents, Flows, and chat history surfaces.
- Extend unit and browser proof so warning timing, blocked submission, and pinned resume behavior stay honest.

9. [codeInfo2] - Run final Story 0000057 validation and close out the provider-neutral agent contract

- Refresh close-out documentation and the reviewer-facing PR summary artifact.
- Validate the whole original story through the supported wrapper-first build, test, browser, and compose smoke workflow.

10. [codeInfo2] - Repair resumed `codebase_question` execution identity for saved-provider conversations

- Keep saved MCP conversations pinned to their stored provider and model even when follow-up input is contradictory or omits provider.
- Prove the saved-identity behavior on both the unit seam and the websocket-backed persisted path.

11. [codeInfo2] - Repair resumed `/chat` execution identity and lock-order mutation boundaries

- Keep resumed `/chat` sends pinned to stored provider and model instead of rewriting saved execution identity.
- Stop blocked concurrent sends from mutating persisted metadata before the route proves the run lock winner.

12. [codeInfo2] - Make provider bootstrap startup and managed config writes deterministic

- Await provider bootstrap on the default startup path and stop stale reads from clobbering newer provider config.
- Prove the guarded writer behavior and the normal launcher path through targeted proof plus startup smoke.

13. [codeInfo2] - Make MCP replay idempotency survive process-local cache loss

- Reconstruct replay results from persisted completed state after cache loss without changing caller-visible replay semantics.
- Prove that incomplete persisted state still falls back to fresh execution instead of masquerading as a replay hit.

14. [codeInfo2] - Revalidate the review-created fixes and inline minor resolutions for review pass `0000057-20260507T014045Z-e54d5640`

- Re-run the shared broad regression proof for the review-created findings block and the inline minor fixes already landed in this cycle.
- Keep the final close-out tied to the current review cycle and the exact proof files promised by the follow-up tasks.
