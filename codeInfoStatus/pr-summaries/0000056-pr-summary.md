# Story 0000056 PR Summary

- Plan: `planning/0000056-users-can-use-copilot-as-a-first-class-chat-provider-with-shared-agent-flags-and-defaults.md`
- Repository scope: current repository only
- Manual proof bundle: `codeInfoStatus/manual-proof/0000056/`

## Final Summary

1. What has been changed.
   The story added Copilot as a first-class chat provider with shared agent-flag defaults and parity across create, resume, persistence, and UI selection flows, then finished the review-cycle follow-up work by normalizing stale LM Studio defaults to live models, repairing the checked-in browser-runtime API base handling, restoring the tracked `server/.env` and `docker-compose.local.yml` local-stack contract that keeps working-folder selection functional, hardening the review workflow against cleanup-only runtime rewrites and missed changed-hunk regressions, and recording durable closeout evidence.
2. Why it changed.
   These changes were needed so provider-neutral chat behavior stays consistent across Codex, Copilot, and LM Studio, the main-stack browser flows keep reaching the correct API endpoint, the local stack keeps the working folder and host-ingest behavior users were already relying on, the review loop stops turning cleanup-only config concerns into breaking runtime rewrites, and the story can close on durable proof instead of scratch-only or partially reviewed state.
3. A simple explanation of any complex logic that needed to be added.
   The trickiest parts were teaching LM Studio model discovery to replace dead configured defaults with a live downloaded-model choice, preserving a browser-safe `USE_BROWSER_HOST` runtime directive through compose and the client entrypoint so provider/model refreshes still work after switching away from a Codex-backed conversation, restoring the local compose host-path contract without undoing the main-stack browser fix, and adding lightweight review guardrails that treat `cleanup_preference` as a narrow hint while still failing open when review metadata is missing or malformed.
4. What a reviewer should take particular interest in.
   Reviewers should focus on the provider/runtime contract seams in `server/src/chat/interfaces/ChatInterfaceCopilot.ts`, `server/src/config/startupEnv.ts`, `server/src/routes/chatModels.ts`, `docker-compose.yml`, and `client/entrypoint.sh`, the intentionally restored local-stack ownership in `server/.env`, `docker-compose.local.yml`, and `server/src/test/unit/host-network-compose-contract.test.ts`, the review-workflow hardening under `codeinfo_markdown/`, `codex_agents/review_agent/commands/review_blind_spot_challenge.json`, and `scripts/test/test_review_prompt_contracts.py`, plus the clean no-findings closeout in the plan’s `Post-Implementation Code Review` section and the curated durable manual-proof bundle under `codeInfoStatus/manual-proof/0000056/`.

## Review Status

- The latest `Post-Implementation Code Review` in the plan closes review pass `0000056-20260501T005010Z-506c6c19` with no actionable findings.
- The accepted final branch state now explicitly keeps the restored `server/.env` and `docker-compose.local.yml` local-stack contract, the matching host-ingest proof owner in `server/src/test/unit/host-network-compose-contract.test.ts`, and the review-workflow hardening that prevents cleanup-only runtime rewrites from being reintroduced on future review passes.
- The plan’s final task is complete, the story is recorded as complete on disk, and the PR summary reflects that final plan state rather than the earlier task-up and review-loop phases.

## Task 21 Closeout Prep

### Task-Required Finding Proof Homes

- `finding-4-copilot-bootstrap-partial-home`: implementation owners [copilotSeedBootstrap.ts](/home/d_a_s/code/codeInfo2/server/src/config/copilotSeedBootstrap.ts:1); focused proof homes [copilotSeedBootstrap.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/copilotSeedBootstrap.test.ts:1) and [copilot.boot-path.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/integration/copilot.boot-path.test.ts:1); closeout should cite Testing steps `4` and `5`.
- `finding-6-chat-inflight-replay-duplication`: implementation owners [chat.ts](/home/d_a_s/code/codeInfo2/server/src/routes/chat.ts:1) and [inflightRegistry.ts](/home/d_a_s/code/codeInfo2/server/src/chat/inflightRegistry.ts:1); focused proof homes [chat-tools-wire.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/integration/chat-tools-wire.test.ts:1) and [conversations.turns.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/integration/conversations.turns.test.ts:1); closeout should cite Testing steps `6` and `7`.
- `finding-8-lmstudio-error-mislabel`: implementation owners [providerRuntimeFlags.ts](/home/d_a_s/code/codeInfo2/server/src/chat/providerRuntimeFlags.ts:1) and [ChatInterfaceLMStudio.ts](/home/d_a_s/code/codeInfo2/server/src/chat/interfaces/ChatInterfaceLMStudio.ts:1); focused proof homes [lmstudio-provider-retry-logging.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/lmstudio-provider-retry-logging.test.ts:1) and [lmstudio-provider-dispatch.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/lmstudio-provider-dispatch.test.ts:1); closeout should cite Testing steps `8` and `9`.
- `finding-9-defaults-marker-schema-drift`: implementation owners [chatDefaults.ts](/home/d_a_s/code/codeInfo2/server/src/config/chatDefaults.ts:1), [chatValidators.ts](/home/d_a_s/code/codeInfo2/server/src/routes/chatValidators.ts:1), [chatProviders.ts](/home/d_a_s/code/codeInfo2/server/src/routes/chatProviders.ts:1), [chatModels.ts](/home/d_a_s/code/codeInfo2/server/src/routes/chatModels.ts:1), and [codebaseQuestion.ts](/home/d_a_s/code/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts:1); focused proof homes [chatValidators.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/chatValidators.test.ts:1), [chatProviders.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/chatProviders.test.ts:1), [chatModels.codex.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/chatModels.codex.test.ts:1), and [codebaseQuestion.happy.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts:1); closeout should cite Testing steps `10` through `13`.

### Broad Wrapper-Backed Revalidation Surfaces

- Shared baseline and build reruns: Testing steps `1`, `2`, and `3`.
- Broad server and client reruns that must also cover the inline-resolved minor findings from review cycle `0000056-rc-20260501T235427Z-243cab18`: Testing steps `14`, `15`, `16`, and `17`.
- Shared quality gates and supported runtime handoff: Testing steps `18`, `19`, and `20`.

### Shared Blocker Classifications

- If `npm run compose:build:summary` fails before any finding-specific assertions run, classify the closeout outcome as a shared compose-build baseline blocker rather than a regression in findings `4`, `6`, `8`, or `9`.
- If `npm run compose:up`, `curl -f http://localhost:5010/health`, or `curl -f http://localhost:5001` fails before any finding-specific assertions run, classify the closeout outcome as a shared runtime-handoff blocker rather than a finding-specific regression.
- If a broad wrapper such as `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run test:summary:client`, or `npm run test:summary:e2e` fails before the failing surface can be isolated to one finding seam, classify the outcome as a shared regression-surface blocker first and only narrow it to one finding after targeted evidence exists.

## Task 25 Final-Pass Proof Map

### Task 22: explicit-provider rejection

- Implementation seams: [chat.ts](/home/d_a_s/code/codeInfo2/server/src/routes/chat.ts:1), [codebaseQuestion.ts](/home/d_a_s/code/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts:1), and [chatDefaults.ts](/home/d_a_s/code/codeInfo2/server/src/config/chatDefaults.ts:1)
- Focused proof homes: [chat-copilot-fallback.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/integration/chat-copilot-fallback.test.ts:1) and [codebaseQuestion.unavailable.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts:1)
- Final-pass focused reruns: Task 25 Testing steps `4` and `5`

### Task 23: Copilot seed-import trust boundary

- Implementation seam: [copilotSeedBootstrap.ts](/home/d_a_s/code/codeInfo2/server/src/config/copilotSeedBootstrap.ts:1)
- Focused proof homes: [copilotSeedBootstrap.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/copilotSeedBootstrap.test.ts:1) and [copilot.boot-path.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/integration/copilot.boot-path.test.ts:1)
- Final-pass focused reruns: Task 25 Testing steps `6` and `7`

### Task 24: MCP replay barrier

- Implementation seams: [codebaseQuestion.ts](/home/d_a_s/code/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts:1), [router.ts](/home/d_a_s/code/codeInfo2/server/src/mcp2/router.ts:1), and [inflightRegistry.ts](/home/d_a_s/code/codeInfo2/server/src/chat/inflightRegistry.ts:1)
- Focused proof homes: [codebaseQuestion.validation.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts:1), [codebaseQuestion.happy.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts:1), and [mcp-codebase-question-ws-stream.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/integration/mcp-codebase-question-ws-stream.test.ts:1)
- Final-pass focused reruns: Task 25 Testing steps `8`, `9`, and `10`

## Task 25 Closeout Prep

### Inline Minor Fix Revalidation Placeholders

- Review cycle: `0000056-rc-20260502T143918Z-056fcf4c`
- Covered inline-resolved minor findings: `finding-1`, `finding-2`, `finding-4`, `finding-5`, `finding-6`, `finding-9`, and `finding-10`
- Pending broad wrapper-backed reruns to record later:
  - `compose_build_summary` -> Task 25 Testing step `1`
  - `build_summary_server` -> Task 25 Testing step `2`
  - `build_summary_client` -> Task 25 Testing step `3`
  - `test_summary_server_unit_full` -> Task 25 Testing step `11`
  - `test_summary_server_cucumber` -> Task 25 Testing step `12`
  - `test_summary_client_full` -> Task 25 Testing step `13`
  - `test_summary_e2e` -> Task 25 Testing step `14`
  - `lint` -> Task 25 Testing step `15`
  - `format_check` -> Task 25 Testing step `16`
  - `compose_up_health_runtime_handoff` -> Task 25 Testing step `17`

### Shared Blocker Classification Keys

- `compose_build_pre_assertion` -> `shared_compose_build_baseline_blocker`
- `startup_or_health_pre_assertion` -> `shared_runtime_handoff_blocker`
- `broad_wrapper_pre_isolation` -> `shared_regression_surface_blocker`
