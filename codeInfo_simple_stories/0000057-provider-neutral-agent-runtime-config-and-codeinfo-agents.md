# Users can run agents through one provider-neutral runtime contract

# Acceptance

1. Users can run chat, agents, flows, and repository-aware tools on Codex, GitHub Copilot, or LM Studio through one shared runtime contract instead of a Codex-only path.
2. Users can rely on layered runtime config and neutral agent-folder discovery without breaking older `codex_agents` layouts or legacy env aliases.
3. Users can see clear warnings, disabled states, fallback behavior, and resumed-conversation rules when a provider is missing, invalid, or changed after a conversation already started.
4. Users and support reviewers can trust resumed `/chat` and `codebase_question` runs to stay pinned to the stored execution identity instead of silently switching providers or models.
5. Users can trust startup warnings, agent or flow admission, disabled-state handling, and replay behavior to fail safely when config, provider, or state problems occur.
6. Users can see the real server-provided recovery reason when an agent or flow run fails, rather than a generic HTTP-status fallback.
7. Support and engineering reviewers can trust the final rollout because the story closes with wrapper-first server, client, browser, and compose-backed regression proof.

# Description

This story finishes the shift from a Codex-shaped runtime to a provider-neutral one for agents, flows, chat, and repository-aware execution. It lets teams configure different providers through one consistent contract, keeps compatibility with older folder and env layouts, preserves the right execution identity when conversations resume, and makes warning or failure behavior clearer when providers are missing or misconfigured. The later review-fix tasks harden startup warnings, admission ordering, visible client state, replay durability, and final proof ownership so the finished rollout is safer for both users and support teams.

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

19. [codeInfo2] - Restore provider-neutral fallback warnings and degraded bootstrap surfaces

- Repair startup warning and degraded-run surfaces so fallback and invalid-provider behavior stays visible instead of silently disappearing.

20. [codeInfo2] - Normalize direct agent and command admission before runtime bootstrap

- Prevent direct agent and command paths from starting work before the shared runtime and repository selector state are valid.

21. [codeInfo2] - Normalize flow start and resume admission before execution begins

- Make flow start and resume paths reject bad selector or resume state before execution side effects begin.

22. [codeInfo2] - Stabilize repository-backed `/chat` runtime-home identity and failure boundaries

- Keep repository-backed `/chat` runs pinned to the right runtime-home identity and stop partial losing requests from leaving unsafe state behind.

23. [codeInfo2] - Make visible client execution state authoritative across selected details and resumed chat controls

- Keep stale detail caches and resumed provider or model selectors from showing runnable states that the real send path will ignore or reject.

24. [codeInfo2] - Make `codebase_question` replay claims durable before provider work begins

- Persist or claim replay ownership early enough that retries reuse one logical run instead of duplicating provider work.

25. [codeInfo2] - Revalidate review pass `0000057-20260513T150955Z-67ee8439` serious fixes and inline minor resolutions

- Own the final broad regression rerun for the latest review-created findings block and its inline minor fixes through server, client, browser, and compose-backed proof.

26. [codeInfo2] - Preserve run-start availability diagnostics across agent, command, and flow launches

- Keep provider fallback and invalid-provider warnings visible on direct agent, command, MCP, and flow run-start responses.

27. [codeInfo2] - Constrain repository-backed flow `agentType` resolution to the intended agent roots

- Reject unsafe flow-owned `agentType` values before repository-backed discovery or execution can escape the intended agent folders.

28. [codeInfo2] - Make continuation and resume state reconstruction authoritative before identity backfills

- Stop stale resume backfills from overwriting fresher child execution ownership and keep resumed provider identity pinned to the saved requested-provider state.

29. [codeInfo2] - Revalidate review pass `0000057-20260514T044937Z-54ba77ee` serious fixes and inline minor resolutions

- Own the latest broad review-cycle rerun across server, client, browser, compose, lint, and format proof for the new review-created findings block.

30. [codeInfo2] - Restore chat fallback and direct-agent fallback when the initially requested provider cannot bootstrap or load runtime config

- Move fallback choice ahead of provider-specific runtime-config loading for implicit chat, direct agent runs, and flow-owned agent runs.
- Keep explicit provider failures clear while adding proof that healthy fallback providers still run when the first provider cannot bootstrap.

31. [codeInfo2] - Make `/chat` apply authoritative resumed execution state and replay dedupe before started responses are emitted

- Fix the `/chat` validator and route so resumed-provider identity and duplicate replay barriers win before started responses or durable metadata writes.
- Update the retained chat validator, fallback, and replay proof files so they describe the repaired ordering contract directly.

32. [codeInfo2] - Preserve `/flows/:flowName/run` actual execution identity and launch diagnostics through the supported client contract

- Keep the first flow-start response carrying the actual provider, warnings, and machine-readable failure details through the server and client contract.
- Prove the page resets stale launch state correctly when a user starts a fresh run after an older failed or selected run.

33. [codeInfo2] - Align provider-specific `/chat/models` availability fields with the authoritative bootstrap-status contract

- Keep top-level provider availability, tools, and reason fields aligned with shared bootstrap status instead of letting provider-specific branches drift.
- Update the chat-page proof so a degraded provider cannot stay hidden in runnable submission state after the UI refreshes availability.

34. [codeInfo2] - Make bulk conversation UI state honor partial-success server outcomes

- Keep sidebar bulk actions aligned with count-based server outcomes so only confirmed rows clear while unresolved rows stay selected or pending.
- Update the server and sidebar proof so later bulk submissions exclude already-confirmed rows after a partial-success response.

35. [codeInfo2] - Revalidate review pass `0000057-20260515T064120Z-152411f0` serious fixes and inline minor resolutions

- Own one final broad regression pass across compose, build, server, client, browser, lint, and format proof for the current review-created findings block.
- Re-check the inline-resolved minor fixes in the same review cycle so the story closes with one shared revalidation owner.
