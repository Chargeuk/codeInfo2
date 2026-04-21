# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed callers honest while requests wait in that queue, extends the shared repository-list contract so queued work is visible in the ingest UI and MCP mirrors, and carries the review-created follow-up repairs and final validation needed to close the story honestly.

## Retained Earlier Proof

- Retained earlier Story 55 close-out context still lives in `planning/0000055-pr-summary.md`, including the broader client, browser, durable review-artifact, and earlier acceptance-chain notes that the current review-created pass did not reopen directly.
- The carried-forward weak-proof notes remain unchanged from the maintained legacy summary: `AC30` still relies partly on indirect proof for timeout-independent green blocking completion, `AC32` still relies partly on inspection-backed negative proof that queue fields are not mirrored onto unrelated payloads, and `AC43` still lacks a dedicated negative proof for queued-but-not-started removal.
- Earlier review-pass close-outs remain historical context only. This summary now treats review pass `0000055-20260420T140453Z-d9e38eba` as the active close-out block and does not rely on the older `0000055-20260419T200440Z-d67f1ccc` Task 153-160 summary as proof that the current findings are closed.

## Review Follow-Up After Pass `0000055-20260420T140453Z-d9e38eba`

- The durable review anchor for this pass is the appended `Code Review Findings` block in `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`, which records two `must_fix` findings and five `should_fix` findings. Current close-out ownership lives in Tasks 161 through 170 of that same plan.
- Task 161 closed the formatter prerequisite by excluding committed `codeInfoStatus/manual-testing/` durable proof artifacts from repo-wide Prettier ownership while keeping `prettier . --check` as the supported gate. The repaired owner is `.prettierignore`, with proof recorded by `npm run lint` and `npm run format:check`.
- Task 162 closed the cross-operation waiting queue rewrite finding by repairing `server/src/ingest/requestQueue.ts` so queued `start` work can be rewritten by a later queued `reembed` request for the same canonical target while preserving queue identity and FIFO metadata. Direct proof lives in `server/src/test/unit/ingest-request-queue.test.ts`, `server/src/test/unit/ingest-start.test.ts`, and `server/src/test/unit/ingest-reembed.test.ts`.
- Task 163 closed the shared build prerequisite by repairing stale `shouldRewriteWaitingRequest(...)` caller arity in `server/src/ingest/requestQueue.ts`. Direct proof lives in `server/src/test/unit/ingest-request-queue.test.ts`, with the server build wrapper confirming the prerequisite no longer blocks downstream repairs.
- Task 164 closed the deletions-only cleanup-blocked fast-path finding by routing degraded persisted cleanup through the shared cleanup-blocked publication path in `server/src/ingest/ingestJob.ts` instead of reporting terminal success. Direct proof lives in `server/src/test/unit/ingest-reembed.test.ts`, `server/src/test/unit/ingest-files-repo-guards.test.ts`, and `server/src/test/unit/ingest-queue-runtime-terminal.test.ts`.
- Task 165 closed the `/ingest/reembed` admission-time `OPENAI_MODEL_UNAVAILABLE` finding by adding real locked-model validation before queue acceptance through `server/src/ingest/reingestService.ts` and `server/src/routes/ingestReembed.ts`. Direct proof lives in `server/src/test/integration/openai-model-unavailable-contract.test.ts`, `server/src/test/integration/ingest-failure-logging-coverage.test.ts`, `server/src/test/integration/ingest-reembed.test.ts`, and the updated cucumber owner.
- Task 166 closed the first shared `flows.run.loop` server-unit blocker by repairing the named loop-stop cleanup proof in `server/src/test/integration/flows.run.loop.test.ts` around an explicit finalize checkpoint instead of fixed-delay cleanup assumptions.
- Task 167 closed the `/ingest/roots` direct-response and canonical-row identity findings by repairing `server/src/routes/ingestRoots.ts`, captured-response cucumber steps, client row identity handling, and the browser queued-to-running proof. Direct proof lives in `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/steps/ingest-manage.steps.ts`, `server/src/test/features/ingest-roots.feature`, `client/src/test/useIngestRoots.test.tsx`, and `e2e/ingest.spec.ts`.
- Task 168 closed the reintroduced shared `flows.run.loop` stop-finalize blocker by adding the bounded pre-iteration stop check in `server/src/flows/service.ts` and tightening `server/src/test/integration/flows.run.loop.test.ts` around the between-iteration stop boundary.
- Task 169 closed the queue-runtime proof-owner finding by moving the affected proof owners onto the request-aware terminal wait boundary instead of `runId` polling. Direct proof lives in `server/src/test/unit/ingest-queue-runtime.helpers.ts`, the queue-runtime pump/startup/recovery/deferred-mismatch/terminal unit owners, and `server/src/test/integration/ingest-reembed-invalid-state.test.ts`.
- Task 170 closed the classic MCP malformed-arguments finding by rejecting present non-object `tools/call.params.arguments` payloads at the dispatcher boundary in `server/src/mcp/server.ts`, while preserving object-shaped domain validation. Direct proof lives in `server/src/test/unit/mcp.reingest.classic.test.ts`.

## Fresh Reruns For This Pass

- Tasks 161 through 170 each record fresh task-scoped wrapper proof in the active plan. Those task-level reruns include server build, server unit, server cucumber, client build, client unit, e2e, lint, format, compose startup, and host-network checks where the repaired owner required them.
- Task 171 has not yet run its final automated proof section. The current summary refresh is therefore proof-authoring work only; the final story-level wrapper reruns remain pending under Task 171 Testing items 1 through 11.
- Do not treat older Task 153-160 rerun paths as fresh proof for the current `d9e38eba` block. They remain retained historical evidence for earlier reopened review work, not replacement proof for Tasks 161 through 170 or the Task 171 final validation pass.

## Residual Weak-Proof Notes

- The earlier Story 55 carried-forward weak-proof notes for `AC30`, `AC32`, and `AC43` remain the broad residual caveats until a future task adds direct negative proof for those exact acceptance surfaces.
- Task 165's negative live-runtime `OPENAI_MODEL_UNAVAILABLE` path remains automation-owned because the supported runtime cannot honestly seed a repository locked to a disallowed OpenAI model through public setup surfaces. The route contract is directly proved by server integration coverage, and the plan preserves manual guidance not to fabricate a runtime seam for this negative case.
- Tasks 166, 168, and 169 are primarily automation-owned async coordination seams. Their strongest proof remains the repaired unit or integration owners plus wrapper reruns, because there is no separate browser-visible or manual surface for those internal timing boundaries.

## Rejected-Risk Notes

- This pass rejected weakening wrapper gates into targeted-only proof after shared failures moved between owners. Planner repairs inserted or reactivated the correct prerequisite owners instead of hiding failing full-wrapper evidence.
- This pass rejected broad runtime or admin seams solely to make hard negative states manually reachable. In particular, Task 165 kept disallowed OpenAI model setup inside direct server proof instead of weakening model allowlist enforcement.
- This pass rejected treating durable proof artifacts as source-formatting failures. Task 161 fixed the repo-wide formatter input set rather than running broad formatting churn across artifact JSON.
- No additional endorsed finding beyond the current `d9e38eba` repaired owner set is recorded in Tasks 161 through 170. If Task 171 final proof exposes a new failure, it should be tracked as fresh in-scope work or a live blocker instead of silently folded into this summary.

## Saturation Reasoning

- Tasks 161 through 170 collectively cover the current review-created block: formatter prerequisite, cross-operation queue rewrite, shared build prerequisite, cleanup-blocked fast path, admission-time model validation, flow-loop server-unit prerequisites, roots canonical identity and captured-response proof, request-aware queue-runtime proof, and classic MCP dispatcher argument-shape validation.
- Task 171 remains the final validation owner. Its later automated proof must rerun the supported build, test, compose, host-network, lint, and format gates before this story can be audited as complete.
- The durable close-out now names the current repaired proof homes and separates proof-authoring updates from final wrapper execution, so the story is not being reclclosed from stale summary text.

## Bounded Residual-Risk Slot

- If Task 171 automated proof exposes a partially repaired seam, record the exact failing owner, wrapper command, and log path here before audit instead of stating the story is fully re-closed.
- If Task 171 automated proof stays green, this slot can remain as an explicit "not needed after final reruns" marker rather than being silently deleted.
