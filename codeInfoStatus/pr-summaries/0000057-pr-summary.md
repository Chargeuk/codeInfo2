## Story 0000057 Summary

This story completes the provider-neutral runtime migration for repository-owned agent execution. The server and client now share one execution-context contract across direct agents, command-backed runs, flow-owned agents, and MCP `code_info`, while keeping `codeinfo_agents` as the preferred repo-local home, surfacing warning details consistently, and pinning established conversations to their stored provider, model, and execution identity.

Implementation highlights:

- Task 1 replaced the old runtime bootstrap contract with provider-neutral repo-local layering so server defaults, repository config, and runtime overlays feed one shared execution model.
- Task 2 introduced the neutral agent-home and precedence helper so `codeinfo_agents` wins over `codex_agents` when both target the same selected repository without silently hiding compatibility fallback behavior.
- Task 3 moved repository grounding onto one shared execution-context seam that direct chat, direct agents, flow-owned runs, and `codebase_question` now reuse.
- Task 4 published the warning-details contract so availability evaluation can report duplicate-folder, invalid-provider, fallback, repair, and disabled-state reasoning to both server routes and browser surfaces.
- Tasks 5 through 7 completed the server-side runtime migration and kept direct agents, commands, flows, and MCP proof on the same provider-neutral continuation rules.
- Task 8 finished the browser-visible portion of the story by aligning Agents and Flows UI warnings, disabled state, fallback surfaces, and resumed-conversation identity pinning with the shared server contract.

Task-to-proof map:

- Task 1 proof homes: Story 57 server config/runtime unit coverage plus final Task 9 wrapper validation.
- Task 2 proof homes: Story 57 config-root and precedence server unit coverage plus focused warning and duplicate-folder client coverage.
- Task 3 proof homes: Story 57 repository-context server unit and MCP coverage plus final Task 9 wrapper validation.
- Task 4 proof homes: Story 57 provider-availability server proof, `client/src/test/agentsPage.list.test.tsx`, `client/src/test/agentsPage.descriptionPopover.test.tsx`, and `client/src/test/flowsPage.runGuard.test.tsx`.
- Task 5 proof homes: Story 57 Codex bootstrap server proof suites and the final server wrapper chain in Task 9.
- Task 6 proof homes: Story 57 direct-agent server proof, `client/src/test/chatPage.resumeIdentity.test.tsx`, and `e2e/chat-provider-history.spec.ts`.
- Task 7 proof homes: Story 57 flow-owned server proof, `e2e/flows-execution-runs.spec.ts`, and the final compose-backed validation chain in Task 9.
- Task 8 proof homes: `client/src/test/agentsPage.runGuard.test.tsx`, `client/src/test/chatPage.freshRunContext.test.tsx`, `client/src/test/chatPage.resumeIdentity.test.tsx`, `e2e/agents.spec.ts`, `e2e/chat-provider-history.spec.ts`, and `e2e/flows-execution-runs.spec.ts`.
- Task 9 proof homes: the final wrapper-first build, test, compose smoke, lint, and format sequence recorded in the executable plan.

Final validation status:

- Task 8 implementation and its task-owned proof are complete on this branch.
- Task 9 is the remaining close-out owner. Final wrapper-first story validation, compose smoke, and durable manual-proof promotion still belong to the executable plan and are not duplicated here.

Scope guardrails kept intact:

- The story changes provider-neutral agent execution and repository grounding only; it does not introduce silent in-place provider switching for existing conversations.
- Warning details remain visible and explain fallback or disable states instead of silently rewriting the user’s selected execution target.
- `codeinfo_agents` precedence is documented as the preferred repository-owned home, while `codex_agents` remains compatibility-only behavior rather than the primary contract going forward.
