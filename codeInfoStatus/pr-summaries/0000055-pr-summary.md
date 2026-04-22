# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed callers honest while requests wait in that queue, extends the shared repository-list contract so queued work is visible in the ingest UI and MCP mirrors, and carries review-created repairs through final validation.

This summary is refreshed for review pass `0000055-20260421T213927Z-9a3752e6`. The durable plan owner is `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`, with review-fix Tasks 177 through 183 and final validation Task 184.

## Retained Earlier Proof

- Earlier Story 55 close-out context still lives in `planning/0000055-pr-summary.md`; it remains historical context for acceptance-chain decisions that this review pass did not reopen directly.
- The carried-forward weak-proof notes remain unchanged from the maintained legacy summary: `AC30` still relies partly on indirect proof for timeout-independent green blocking completion, `AC32` still relies partly on inspection-backed negative proof that queue fields are not mirrored onto unrelated payloads, and `AC43` still lacks a dedicated negative proof for queued-but-not-started removal.
- Earlier review-pass summaries and wrapper reruns are retained context only. They are not treated as replacement proof for the current `0000055-20260421T213927Z-9a3752e6` findings block.

## Review Follow-Up After Pass `0000055-20260421T213927Z-9a3752e6`

- The durable review anchor for this pass is the appended `Code Review Findings` block in `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`. It records five `must_fix` findings, three `should_fix` findings, and one localized `optional_simplification`; the saturation and blind-spot challenge artifacts generated no additional actionable findings.
- Task 177 closed `F1` by treating `cleanup-blocked` as a client terminal queue state. Owners are `client/src/hooks/useChatWs.ts`, `client/src/hooks/useIngestStatus.ts`, `client/src/pages/IngestPage.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, and the existing row display in `client/src/components/ingest/RootsTable.tsx`; direct proof lives in `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`, and retained `client/src/test/ingestRoots.test.tsx` row coverage.
- Task 178 closed `F2` by replacing the old short blocking re-embed default wait with a named long safety guard while preserving explicit short injected timeout tests. Owners are `server/src/ingest/reingestService.ts`, `server/src/mcp/server.ts`, `server/src/agents/commandsRunner.ts`, and `server/src/flows/service.ts`; direct proof lives in `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/test/integration/commands.reingest.test.ts`, and `server/src/test/integration/flows.run.command.test.ts`.
- Task 179 closed `F3` by rejecting malformed `POST /ingest/start` body fields before queue admission. Owners are `server/src/routes/ingestStart.ts`, `server/src/ingest/requestContracts.ts`, `server/src/ingest/ingestJob.ts`, and `openapi.json`; direct proof lives in `server/src/test/unit/ingest-start.test.ts`, `server/src/test/unit/openapi.contract.test.ts`, `server/src/test/features/ingest-start-body.feature`, and `server/src/test/steps/ingest-start-body.steps.ts`.
- Task 180 closed `F4`, `F6`, and `F7` by realigning the shared repo-list runtime shape, OpenAPI schemas, MCP/tool mirrors, client normalization, active queue overlay model metadata, and canonical row identity. Owners include `server/src/lmstudio/toolService.ts`, REST and MCP repo-list producers, `openapi.json`, `client/src/hooks/useIngestRoots.ts`, `client/src/pages/IngestPage.tsx`, and `client/src/components/ingest/RootsTable.tsx`; direct proof lives in the server/client unit and contract files named in Task 180.
- Task 181 closed `F5` by persisting a replay barrier before non-idempotent queue finalization side effects and keeping startup recovery aligned with that barrier. Owners are `server/src/ingest/ingestJob.ts`, queue finalization/recovery helpers, and runtime recovery proof files named in Task 181.
- Task 182 closed `F8` by separating attempted queue processor paths from validation-passed started paths in BDD proof. Owners are `server/src/test/steps/ingest-manage.steps.ts`, `server/src/test/features/ingest-status.feature`, and `server/src/test/features/ingest-reembed.feature`.
- Task 183 closed `F9` by replacing duplicated live queue-state literals with a named live-target state contract. Owners are `server/src/mongo/ingestQueueRequest.ts`, `server/src/ingest/requestQueue.ts`, and `server/src/test/unit/ingest-request-queue.test.ts`.

## Retained Artifacts

- Review artifacts for this pass are recorded in the plan as `codeInfoTmp/reviews/0000055-20260421T213927Z-9a3752e6-evidence.md`, `codeInfoTmp/reviews/0000055-20260421T213927Z-9a3752e6-findings.md`, `codeInfoTmp/reviews/0000055-20260421T213927Z-9a3752e6-findings-saturation.md`, and `codeInfoTmp/reviews/0000055-20260421T213927Z-9a3752e6-blind-spot-challenge.md`.
- Optional task-scoped manual artifacts already recorded for Tasks 177 and 178 live under `codeInfoTmp/manual-testing/0000055/`.
- If final manual proof is requested after automated Task 184 proof, the retained destination is `codeInfoStatus/manual-testing/0000055/`; current Task 184 implementation does not require manual output before automated proof.
- Review pass `0000055-20260422T045457Z-daafd19b` artifact hygiene keeps generated automated screenshots out of tracked payloads: e2e-generated PNGs now write under ignored `test-results/screenshots/0000055/`, and only intentionally retained sanitized manual proof belongs under `codeInfoStatus/manual-testing/0000055/`.

## Fresh Reruns For This Pass

- Tasks 177 through 183 each record fresh task-scoped automated proof in the active plan, including targeted client, server unit, server cucumber, lint, and format wrappers where each repaired owner required them.
- Task 184 has not yet run its final automated proof section. The current summary refresh is proof-authoring work only; the final story-level wrapper reruns remain pending under Task 184 Testing items 1 through 12.
- The pending Task 184 wrapper set is: `npm run build:summary:server`, `npm run build:summary:client`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run test:summary:client`, `npm run test:summary:e2e`, `npm run compose:build:summary`, `npm run compose:up`, `npm run test:summary:host-network:main`, `npm run compose:down`, `npm run lint`, and `npm run format:check`.

## Residual Weak-Proof Notes

- The earlier Story 55 carried-forward weak-proof notes for `AC30`, `AC32`, and `AC43` remain the broad residual caveats until a future task adds direct negative proof for those exact acceptance surfaces.
- Task 177's cleanup-blocked browser proof covered the visible row and non-cancellable state, while automated client tests own the deterministic websocket/refetch transition details.
- Task 178's exact long blocking queue-wait guard remains automation-owned because the supported live runtime has no deterministic manual harness for forcing a queued re-embed past the former 90-second budget without contaminating state.
- Tasks 182 and 183 are proof-harness or schema-contract repairs without a new browser-visible product surface; their manual testing was assessed as not applicable at task scope.

## Rejected-Risk Notes

- This pass rejects reclosing from task-local proof alone. Task 184 still owns the broad final wrapper rerun set before audit can mark the story complete.
- This pass rejects inventing unsupported manual seams for hard negative or timing-sensitive states. Runtime proof should use supported wrappers and documented manual guidance only.
- This pass rejects treating older review-pass reruns as proof that the current `9a3752e6` block is closed. Older artifacts remain context, not replacement proof.
- If Task 184 final proof exposes a new failure, classify it as product-owned, baseline-owned, harness-owned, or environment-owned and record the exact owner instead of silently folding it into this summary.

## Saturation And Blind-Spot Carry-Forward

- The current review saturation artifact generated no new actionable findings beyond `F1` through `F9`.
- The blind-spot challenge artifact generated no new actionable findings and reinforced the same owner seams, including terminal-state propagation, blocking wait behavior, admission validation, repo-list schema/runtime parity, replay-barrier ordering, BDD proof semantics, and schema live-state deduplication.
- Task 184 remains the final validation owner for this review-created block. Its later automated proof must rerun the supported build, test, e2e, compose, host-network, lint, and format gates before this story can be audited as complete.

## Task 184 Automated Testing Results

- `npm run build:summary:server` passed with `status: passed`, `warning_count: 0`, `agent_action: skip_log`, and retained log `logs/test-summaries/build-server-latest.log`.
- `npm run build:summary:client` passed with `status: passed`, `warning_count: 0`, `agent_action: skip_log`, and retained log `logs/test-summaries/build-client-latest.log`.
- `npm run test:summary:server:unit` initially failed in three queue cleanup tests because one assertion raced the asynchronous queue deletion finalizer and two fake queue request IDs reached default Mongo-backed barrier persistence; after patching the tests, the targeted wrapper rerun passed with 38 tests, and the full wrapper passed with `tests run: 1772`, `passed: 1772`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/server-unit-tests-2026-04-22T04-06-35-258Z.log`.
- `npm run test:summary:server:cucumber` passed with `tests run: 109`, `passed: 109`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/server-cucumber-tests-2026-04-22T04-22-28-741Z.log`.
- `npm run test:summary:client` passed with `tests run: 701`, `passed: 701`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/client-tests-2026-04-22T04-24-23-779Z.log`.
- `npm run test:summary:e2e` passed with `tests run: 60`, `passed: 60`, `failed: 0`, `agent_action: skip_log`, retained log `logs/test-summaries/e2e-tests-latest.log`, and wrapper output confirming `browserBaseUrl: http://host.docker.internal:6001` plus `mcpControlUrl: http://host.docker.internal:8932/mcp`.
- `npm run compose:build:summary` passed with `items passed: 2`, `items failed: 0`, `agent_action: skip_log`, retained log `logs/test-summaries/compose-build-latest.log`, and wrapper output confirming `DEV-0000050:T10:image_runtime_assets_baked` for `codeinfo2-server`.
- `npm run compose:up` passed; compose preflight reported `result: passed` for ports `5010`, `5011`, `5012`, and `8932`, then Docker started the stack with `mongo_db_CodeInfo` and `codeinfo2-server-1` reaching healthy before `codeinfo2-client-1` started.
- `npm run test:summary:host-network:main` passed with `classicMcp`, `chatMcp`, `agentsMcp`, and `playwrightMcp` all reachable over `host.docker.internal`, emitted `DEV-0000050:T12:main_stack_probe_completed`, used `agent_action: skip_log`, and retained log `logs/test-summaries/host-network-main-latest.log`.
- `npm run compose:down` passed and removed `codeinfo2-client-1`, `codeinfo2-server-1`, `mongo_db_CodeInfo`, `codeinfo2-chroma-1`, `codeinfo2-zipkin-1`, `codeinfo2-otel-collector-1`, `codeinfo2-playwright-mcp-1`, and the `codeinfo2_internal` network.
- `npm run lint` passed with exit code 0 and no fixes required.
- `npm run format:check` initially failed because `server/src/test/unit/ingest-queue-runtime-startup.test.ts` needed Prettier wrapping after the test-helper repair; ran `npm run format`, then `npm run format:check` passed with `All matched files use Prettier code style!`. The earlier lint result was produced before formatting rewrote that test file, so lint was reopened for a final rerun against the formatted tree.
- Final `npm run lint` rerun passed with exit code 0 after the Prettier rewrite, so the lint proof is current for the formatted tree.
- Final `npm run format:check` rerun passed with `All matched files use Prettier code style!` after removing accidental formatter side effects from retained screenshot artifacts, so the format proof is current for the final tree.

## Bounded Residual-Risk Slot

- Pending final Task 184 automated proof. If a wrapper exposes a partially repaired seam, record the exact failing owner, command, classification, and log path here before audit.
