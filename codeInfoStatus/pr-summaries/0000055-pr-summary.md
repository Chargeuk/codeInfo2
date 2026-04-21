# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed callers honest while requests wait in that queue, extends the shared repository-list contract so queued work is visible in the ingest UI and MCP mirrors, and carries the review-created follow-up repairs and final validation needed to close the story honestly.

## Retained Earlier Proof

- Retained earlier Story 55 close-out context still lives in `planning/0000055-pr-summary.md`, including the broader client, browser, durable review-artifact, and earlier acceptance-chain notes that the current review-created pass did not reopen directly.
- The carried-forward weak-proof notes remain unchanged from the maintained legacy summary: `AC30` still relies partly on indirect proof for timeout-independent green blocking completion, `AC32` still relies partly on inspection-backed negative proof that queue fields are not mirrored onto unrelated payloads, and `AC43` still lacks a dedicated negative proof for queued-but-not-started removal.
- Earlier review-pass close-outs remain historical context only. This summary now treats review pass `0000055-20260421T050131Z-a77661de` as the active close-out block and does not rely on older review-pass reruns as proof that the current findings are closed.

## Review Follow-Up After Pass `0000055-20260421T050131Z-a77661de`

- The durable review anchor for this pass is the appended `Code Review Findings` block in `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`, which records one `must_fix` finding and four `should_fix` findings. Current close-out ownership lives in Tasks 172 through 176 of that same plan.
- Task 172 closed `F1` by moving blocking re-embed completion behind queue cleanup finalization. The repaired owners are `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`, and `server/src/ingest/reingestError.ts`; direct proof lives in `server/src/test/unit/ingest-queue-runtime-terminal.test.ts`, `server/src/test/unit/ingest-reembed.test.ts`, and `server/src/test/unit/reingestService.test.ts`.
- Task 173 closed `F2` by refreshing queue response and log metadata after `pumpIngestQueue()` using the bounded current-position lookup. The repaired owners are `server/src/routes/ingestStart.ts`, `server/src/routes/ingestReembed.ts`, and `server/src/ingest/requestQueue.ts`; direct proof lives in `server/src/test/unit/ingest-start.test.ts`, `server/src/test/unit/ingest-reembed.test.ts`, `server/src/test/integration/ingest-reembed.test.ts`, and the updated cucumber route harness.
- Task 174 closed `F3` and `F5` by keeping degraded startup reachable for queue-unavailable callers and preserving producer diagnostics through blocking re-ingest transports. The repaired owners are `server/src/index.ts`, `server/src/startup/ingestQueueStartup.ts`, `server/src/ingest/requestQueue.ts`, `server/src/ingest/reingestService.ts`, `server/src/ingest/reingestError.ts`, `server/src/agents/commandsRunner.ts`, `server/src/flows/service.ts`, `server/src/mcp/server.ts`, and `server/src/mcp2/tools/reingestRepository.ts`; direct proof lives in the startup, REST, re-ingest service, classic MCP, MCP2, command, and flow tests named in Task 174.
- Task 175 closed `F4` by documenting the REST `503 QUEUE_UNAVAILABLE` failure contract for both queueable producer routes in `openapi.json`. Direct proof lives in `server/src/test/unit/openapi.contract.test.ts`, which asserts both `POST /ingest/start` and `POST /ingest/reembed/{root}` failure envelopes while preserving the existing queue-aware `202` success shapes.
- Task 176 is the final validation and close-out owner for this review block. Its implementation subtasks refresh this summary and anchor the proof-owner list; its automated proof section still owns the final full wrapper reruns for the current review-created repair set.

## Fresh Reruns For This Pass

- Tasks 172 through 175 each record fresh task-scoped wrapper proof in the active plan. Those task-level reruns include server build, server unit, server cucumber, lint, format, compose build/start/host-network checks, and route or contract proof where each repaired owner required them.
- Task 176 has not yet run its final automated proof section. The current summary refresh is proof-authoring work only; the final story-level wrapper reruns remain pending under Task 176 Testing items 1 through 12.
- Do not treat older Task 161-171 or Task 153-160 rerun paths as fresh proof for the current `a77661de` block. They remain retained historical evidence for earlier reopened review work, not replacement proof for Tasks 172 through 175 or the Task 176 final validation pass.

## Residual Weak-Proof Notes

- The earlier Story 55 carried-forward weak-proof notes for `AC30`, `AC32`, and `AC43` remain the broad residual caveats until a future task adds direct negative proof for those exact acceptance surfaces.
- Task 172's queue-delete failure seam remains automation-owned for the exact cleanup failure edge because the repository exposes no supported manual DB-delete-failure harness; manual proof covered stack health and route availability while automated unit proof owns the injected failure boundary.
- Task 174's initial degraded-Mongo startup behavior remains automation-owned because the supported Compose stacks intentionally wait for Mongo health before server startup; the plan explicitly rejects ad hoc unsupported dependency-bypass commands as manual proof.
- Task 175's OpenAPI contract is static and not served by a supported runtime endpoint, so manual testing was assessed as not applicable; the proof owner is the OpenAPI contract test plus wrapper reruns.

## Rejected-Risk Notes

- This pass rejected weakening wrapper gates into targeted-only proof after review-created repairs landed. Task 176 still owns the supported final wrapper rerun set instead of reclosing from task-local proof alone.
- This pass rejected inventing manual runtime seams for hard negative states. Task 172 kept cleanup-delete failure proof in automation, and Task 174 kept degraded-startup proof in supported unit and transport tests because normal Compose deliberately starts after Mongo is healthy.
- This pass rejected treating static OpenAPI documentation as a browser/runtime manual proof target. Task 175 uses the machine-readable contract and unit-contract test as the honest proof home.
- No additional endorsed finding beyond the current `a77661de` repaired owner set is recorded in Tasks 172 through 175. If Task 176 final proof exposes a new failure, it should be tracked as fresh in-scope work or a live blocker instead of silently folded into this summary.

## Saturation Reasoning

- Tasks 172 through 175 collectively cover the current review-created block: blocking re-embed cleanup ordering, post-pump waiting queue-position freshness, degraded queue-unavailable startup and diagnostic preservation, and OpenAPI `503 QUEUE_UNAVAILABLE` contract coverage.
- Task 176 remains the final validation owner. Its later automated proof must rerun the supported build, test, e2e, compose, host-network, lint, and format gates before this story can be audited as complete.
- The durable close-out now names the current repaired proof homes and separates proof-authoring updates from final wrapper execution, so the story is not being reclosed from stale summary text.

## Bounded Residual-Risk Slot

- If Task 176 automated proof exposes a partially repaired seam, record the exact failing owner, wrapper command, and log path here before audit instead of stating the story is fully re-closed.
- If Task 176 automated proof stays green, this slot can remain as an explicit "not needed after final reruns" marker rather than being silently deleted.
