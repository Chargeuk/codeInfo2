# Users can run agents through one provider-neutral runtime contract

# Acceptance

1. Users can run chat, agents, flows, and repository-aware tools on Codex, GitHub Copilot, or LM Studio through one shared runtime contract instead of a Codex-only path.
2. Users can rely on layered runtime config and neutral agent-folder discovery without breaking older `codex_agents` layouts or legacy env aliases.
3. Users can see clear warnings, disabled states, fallback behavior, and resumed-conversation rules when a provider is missing, invalid, or changed after a conversation already started.
4. Users and support reviewers can trust resumed `/chat` and `codebase_question` runs to stay pinned to the stored execution identity instead of silently switching providers or models.
5. Users can see the real server-provided recovery reason when an agent or flow run fails, rather than a generic HTTP-status fallback.
6. Support and engineering reviewers can trust the final rollout because the story closes with wrapper-first server, client, browser, and compose-backed regression proof.

# Description

This story finishes the shift from a Codex-shaped runtime to a provider-neutral one for agents, flows, chat, and repository-aware execution. It lets teams configure different providers through one consistent contract, keeps compatibility with older folder and env layouts, preserves the right execution identity when conversations resume, and makes warning or failure behavior clearer when providers are missing or misconfigured. The later review-fix tasks harden resumed runs, visible error copy, and logging consistency so the finished rollout is safer for both users and support teams.

# Tasks

1. [codeInfo2] - Replace the runtime-config bootstrap contract with provider-neutral repo-local layering

- Add repo-local, provider, chat, and agent config precedence so the runtime merges the new neutral config stack consistently.

2. [codeInfo2] - Introduce the neutral agent-home and `codeinfo_agents` precedence helper

- Add the shared helper for neutral env naming and make `codeinfo_agents` win over `codex_agents` with duplicate warnings.

3. [codeInfo2] - Resolve one shared repository execution context for chat and `code_info`

- Centralize repository context and working-directory resolution so every provider gets the same grounded execution inputs.

4. [codeInfo2] - Publish agent and flow warning-details surfaces from provider-neutral availability evaluation

- Expose fallback, warning, and disabled-state details through the server and client-facing details contracts.

5. [codeInfo2] - Repair shared Codex availability bootstrap for provider-neutral server proof suites

- Stabilize the shared Codex readiness bootstrap so broader provider-neutral server proof can run honestly.

6. [codeInfo2] - Switch direct agent runs and commands to provider-neutral execution with pinned conversation identity

- Move direct agent execution, command runs, fallback, and saved execution identity onto the shared provider-neutral runtime.

7. [codeInfo2] - Switch flow-owned agent execution to the same provider-neutral runtime and continuation contract

- Align flow-owned agent execution, warnings, and resumed behavior with the same shared runtime and saved-identity rules.

8. [codeInfo2] - Update the Agents and Flows UI for warnings, disabled state, and pinned resumed execution identity

- Update the UI so warning timing, disabled-state handling, and resumed-versus-fresh execution rules stay clear to users.

9. [codeInfo2] - Run final Story 0000057 validation and close out the provider-neutral agent contract

- Re-run the broad story-level validation path and refresh reviewer-facing closeout artifacts for the original rollout.

10. [codeInfo2] - Repair resumed `codebase_question` execution-identity enforcement for all saved-provider conversations

- Keep saved `codebase_question` conversations pinned to their stored provider and model across contradictory follow-up input.

11. [codeInfo2] - Repair `/chat` resumed execution identity and lock-order mutation boundaries

- Keep resumed `/chat` sends on their stored execution identity and stop blocked concurrent sends from mutating saved metadata.

12. [codeInfo2] - Make provider bootstrap startup and managed config writes deterministic

- Await provider bootstrap on the normal startup path and stop stale config reads from overwriting newer provider config.

13. [codeInfo2] - Make MCP replay idempotency survive process-local cache loss

- Reconstruct replay results from completed persisted state after cache loss without changing caller-visible replay behavior.

14. [codeInfo2] - Repair main-stack Codex auth handoff before final review revalidation

- Restore the supported main-stack Codex auth handoff so repository-backed proof can run on the normal stack again.

15. [codeInfo2] - Revalidate review pass `0000057-20260507T014045Z-e54d5640` serious fixes and inline minor resolutions

- Re-run the earlier review-created repair block and its inline minor fixes through one final proof owner for that review cycle.

16. [codeInfo2] - Preserve server-provided failure reasons across agent and flow run surfaces

- Update client error parsing and visible run-surface proof so server `reason` text reaches Agents and Flows failures.

17. [codeInfo2] - Normalize shared transitive-consumer log marker schemas across emitters

- Unify the shared log-marker payload contract across repository-backed and summary-backed emitters and prove the reader path still works.

18. [codeInfo2] - Revalidate review pass `0000057-20260512T022927Z-9715bd20` serious fixes and inline minor resolutions

- Own the final broad regression rerun for the current review-created findings block and the inline minor fixes already recorded in that same review cycle.
