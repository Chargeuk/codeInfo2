# Users can run agents with provider-neutral runtime config and `codeinfo_agents` folder support

# Acceptance

1. Users can run agents on Codex, GitHub Copilot, or LM Studio through one shared runtime contract instead of a Codex-only path.
2. Users can rely on layered runtime config, including a repo-local `codeinfo_config/config.toml`, without needing that file to exist before startup.
3. Users can see clear warnings and disabled states when an agent has an invalid provider, no usable provider, or a duplicate definition, while still being able to inspect the affected agent or flow.
4. Users can benefit from controlled provider fallback for agent and flow-owned agent runs, including clear visibility into which provider and model actually executed.
5. Users can rely on `codeinfo_agents` taking precedence over `codex_agents`, while older `codex_agents` layouts continue to work for compatibility.
6. Users and `code_info` callers can rely on one shared repository-grounded execution context, while the published neutral `CODEINFO_AGENT_HOME` contract replaces Codex-only env naming without breaking legacy compatibility.
7. Users can reopen an existing conversation and keep using its stored execution identity, while new conversations re-evaluate the current agent config and provider availability from scratch.
8. Support and technical reviewers can validate the full story through the normal wrapper-first build, test, and compose workflow.

# Description

This story finishes the move from a Codex-shaped agent runtime to a provider-neutral one. It lets the product run different agents on different providers, keeps repository-grounded execution consistent across chat, agents, flows, and `code_info`, and makes warning, fallback, and resumed-conversation behavior clearer to users and maintainers. It also modernizes the preferred agent folder and env naming without breaking existing repositories that still use the older Codex-focused names.

# Tasks

1. [codeInfo2] - Replace the runtime-config bootstrap contract with provider-neutral repo-local layering
- Add the new `codeinfo_config/config.toml` layer and preserve the final precedence rules across repo, provider, chat, and agent config.
- Update startup bootstrap, env defaults, and compose-owned config reachability for Copilot, LM Studio, and fallback-order parsing.

2. [codeInfo2] - Introduce the neutral agent-home and `codeinfo_agents` precedence helper
- Add the shared helper for `CODEINFO_AGENT_HOME` and legacy alias fallback, plus `codeinfo_agents` over `codex_agents`.
- Update discovery, lookup, and compatibility-proof files so duplicate warnings and precedence stay consistent.

3. [codeInfo2] - Resolve one shared repository execution context for chat and `code_info`
- Centralize repository execution context and working-directory resolution instead of letting each provider derive its own path.
- Use that shared contract as the execution-context foundation that later direct-agent and flow-owned runtime tasks also consume.

4. [codeInfo2] - Publish agent and flow warning-details surfaces from provider-neutral availability evaluation
- Add reusable availability evaluation for warnings, disabled reasons, and fallback candidates before a run starts.
- Expose the new details contracts through agent and flow routes, client API parsing, and popover-focused UI proof.

5. [codeInfo2] - Switch direct agent runs and commands to provider-neutral execution with pinned conversation identity
- Move direct agent execution, fallback, model repair, and command lookup onto the provider-neutral runtime path.
- Keep persisted provider, model, and `agentName` authoritative for later turns and prove ordering-sensitive persistence behavior.

6. [codeInfo2] - Switch flow-owned agent execution to the same provider-neutral runtime and continuation contract
- Remove remaining Codex-only flow execution assumptions and align flow-owned command lookup, warnings, and run-start errors to the shared contract.
- Keep flow child identity pinned across continuation, sibling state safe, and resume/backfill behavior explicitly proved.

7. [codeInfo2] - Update the Agents and Flows UI for warnings, disabled state, and pinned resumed execution identity
- Update client details loading, disabled-state handling, stale-state clearing, and resumed-versus-fresh-run behavior on Agents, Flows, and chat history surfaces.
- Extend unit and browser proof so warning timing, blocked submission, stale-state exclusion, and pinned resume behavior stay honest.

8. [codeInfo2] - Run final Story 0000057 validation and close out the provider-neutral agent contract
- Refresh the lightweight close-out documentation and create the reviewer-facing PR summary artifact for Story 57.
- Validate the whole story through the supported wrapper-first build, test, e2e, and normal compose-backed smoke workflow.
