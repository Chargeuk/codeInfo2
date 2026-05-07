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
- Task 10 proof homes: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` and `server/src/test/integration/mcp-codebase-question-ws-stream.test.ts` for saved-conversation MCP execution-identity pinning across contradictory explicit input and omitted-provider follow-ups.
- Task 11 proof homes: `server/src/test/integration/chat-codex.test.ts` for resumed `/chat` execution-identity pinning and pre-lock mutation boundaries.
- Task 12 proof homes: `server/src/test/unit/runtimeConfig.test.ts`, `server/src/test/unit/copilotConfig.test.ts`, and `server/src/test/unit/host-network-compose-contract.test.ts` plus the task-owned compose build or up or down smoke chain for awaited bootstrap startup and guarded config writers.
- Task 13 proof homes: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` and `server/src/test/integration/mcp-codebase-question-ws-stream.test.ts` for durable replay reconstruction after completed-cache loss while incomplete persisted replay state stays on the fresh path.
- Task 14 final revalidation owner: the broad wrapper-first build, server, client, cucumber, e2e, compose smoke, lint, and format sequence recorded in the executable plan for review pass `0000057-20260507T014045Z-e54d5640` and review cycle `0000057-rc-20260507T033249Z-a89766f6`.
- Inline minor proof owner carried into Task 14: `client/src/test/agentsPage.runGuard.test.tsx` remains the mixed-state disabled-agent `Execute Prompt` surface that the final review-cycle rerun must keep green, while the existing inline minor-fix audit entries remain the sole durable record for findings `finding-5`, `finding-10`, `finding-11`, and `finding-14`.

Final validation status:

- Story 57 baseline implementation and its original Task 9 close-out are complete on this branch.
- Review-created Tasks 10 through 13 are also complete on this branch, including their task-owned automated proof and retained task-scoped manual evidence where the executable plan required it.
- Task 14 is now the sole remaining review-cycle owner on disk. Its unchecked work is the final broad revalidation chain for review pass `0000057-20260507T014045Z-e54d5640`, not additional feature implementation for the underlying Story 57 runtime migration.
- This summary is therefore a reviewer-facing traceability artifact for the current close-out state, while the executable plan remains the source of truth for the remaining Task 14 proof run.

Scope guardrails kept intact:

- The story changes provider-neutral agent execution and repository grounding only; it does not introduce silent in-place provider switching for existing conversations.
- Warning details remain visible and explain fallback or disable states instead of silently rewriting the user’s selected execution target.
- `codeinfo_agents` precedence is documented as the preferred repository-owned home, while `codex_agents` remains compatibility-only behavior rather than the primary contract going forward.
