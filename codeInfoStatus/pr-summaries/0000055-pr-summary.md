# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed callers honest while requests wait in that queue, extends the shared repository-list contract so queued work is visible in the ingest UI and MCP mirrors, and carries the review-created follow-up repairs and final validation needed to close the story honestly.

## Retained Earlier Proof

- Retained earlier Story 55 close-out context still lives in `planning/0000055-pr-summary.md`, including the broader client, browser, durable review-artifact, and earlier acceptance-chain notes that this review-created pass did not reopen directly.
- The still-relevant carried-forward weak-proof notes remain unchanged from that maintained summary: `AC30` still relies partly on indirect proof for timeout-independent green blocking completion, `AC32` still relies partly on inspection-backed negative proof that queue fields are not mirrored onto unrelated payloads, and `AC43` still lacks a dedicated negative proof for queued-but-not-started removal.
- Earlier retained browser and client evidence was not rerun during Tasks 153 through 159. Task 160's later automated-proof phase is responsible for any fresh compose or supported-stack reruns that this review-created close-out still needs before audit.

## Review Follow-Up After Pass `0000055-20260419T200440Z-d67f1ccc`

- The durable review anchor for this pass is the appended `Review Pass 0000055-20260419T200440Z-d67f1ccc` and `Code Review Findings` block in `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`. Current disk does not contain a matching durable `codeInfoStatus/reviews/0000055-20260419T200440Z-d67f1ccc-{evidence,findings}.md` pair, so this close-out intentionally cites the maintained plan and repaired task owners instead of inventing replacement artifacts.
- Task 153 closed `deferred_execution_validation_drift` and `malformed_input_normalized_before_validation` by repairing deferred replay validation in `server/src/ingest/ingestJob.ts` and carrying direct proof through `server/src/test/unit/ingest-queue-runtime-deferred-cancelled.test.ts`, `server/src/test/unit/ingest-queue-runtime-startup.test.ts`, `server/src/test/unit/ingest-queue-runtime-pump.test.ts`, `server/src/test/unit/ingest-queue-runtime-recovery.test.ts`, `server/src/test/integration/ingest-reembed-invalid-state.test.ts`, `server/src/test/features/ingest-reembed.feature`, and `server/src/test/steps/ingest-manage.steps.ts`. Fresh wrapper proof for that repair is on disk at `logs/test-summaries/build-server-latest.log`, `test-results/server-unit-tests-2026-04-20T01-00-56-836Z.log`, and `test-results/server-cucumber-tests-2026-04-20T01-32-19-033Z.log`.
- Task 154 cleared the prerequisite loop-stop cleanup owner in `server/src/flows/service.ts` without reopening the queue-wait seam. Its direct proof owner remains `server/src/test/integration/flows.run.loop.test.ts`, with targeted wrapper proof at `test-results/server-unit-tests-2026-04-20T05-47-37-826Z.log` and the prerequisite-clearing full wrapper confirmation at `test-results/server-unit-tests-2026-04-20T05-48-12-859Z.log`.
- Task 155 closed the shared queue-wait timeout settlement seam in `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`, and `server/src/test/unit/reingestService.test.ts`, preserving request-identity filtering, listener cleanup, `WAIT_TIMEOUT`, and `QUEUE_READ_FAILED` semantics. Its repaired full-wrapper confirmation is retained at `test-results/server-unit-tests-2026-04-20T06-29-58-700Z.log`.
- Task 156 closed `backward_compatibility_reader_writer_mismatch` and `normalized_error_shape_consumer_mismatch` in the shared repo-list reader centered on `server/src/lmstudio/toolService.ts`, with direct proof in `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`, `server/src/test/features/ingest-roots.feature`, and `server/src/test/steps/ingest-manage.steps.ts`. Fresh wrapper proof is retained at `test-results/server-unit-tests-2026-04-20T04-30-54-728Z.log` and `test-results/server-cucumber-tests-2026-04-20T04-45-51-128Z.log`.
- Task 157 closed `non_canonical_selector_alias_accepted` and `config_domain_fail_open` by retightening selector and configured-workdir validation in `server/src/routes/ingestReembed.ts`, `server/src/ingest/reingestService.ts`, `server/src/ingest/requestContracts.ts`, and `server/src/ingest/ingestJob.ts`. The repaired proof homes are `server/src/test/unit/ingest-reembed.test.ts`, `server/src/test/integration/ingest-reembed.test.ts`, `server/src/test/unit/ingest-start.test.ts`, `server/src/test/unit/ingest-queue-runtime-recovery.test.ts`, `server/src/test/features/ingest-reembed.feature`, `server/src/test/features/ingest-start.feature`, `server/src/test/steps/ingest-manage.steps.ts`, and `server/src/test/steps/ingest-start.steps.ts`, with fresh wrapper proof at `test-results/server-unit-tests-2026-04-20T08-33-32-447Z.log` and `test-results/server-cucumber-tests-2026-04-20T09-00-00-023Z.log`.
- Task 158 closed `unbounded_bulk_selector_growth` by bounding rel-path delete selectors in `server/src/mongo/repo.ts` and the changed delta re-embed cleanup seam in `server/src/ingest/ingestJob.ts`. Direct proof owners are `server/src/test/unit/ingest-files-repo-guards.test.ts`, `server/src/test/unit/ingest-reembed.test.ts`, `server/src/test/features/ingest-delta-reembed.feature`, and `server/src/test/steps/ingest-delta-reembed.steps.ts`, with fresh wrapper proof retained at `test-results/server-unit-tests-2026-04-20T12-11-44-153Z.log` and `test-results/server-cucumber-tests-2026-04-20T12-27-58-295Z.log`.
- Task 159 closed `bdd_assertion_step_mutates_state` locally in `server/src/test/features/ingest-delta-reembed.feature` and `server/src/test/steps/ingest-delta-reembed.steps.ts` without widening into unrelated cucumber churn. Fresh feature-scoped wrapper proof is retained at `test-results/server-cucumber-tests-2026-04-20T12-53-51-673Z.log`.

## Fresh Server Reruns For This Pass

- Fresh server build reruns for this review-created pass are retained on disk through `npm run build:summary:server` in `logs/test-summaries/build-server-latest.log`.
- Fresh server unit reruns for the repaired review-created owners are retained at:
  - `test-results/server-unit-tests-2026-04-20T01-00-56-836Z.log`
  - `test-results/server-unit-tests-2026-04-20T04-30-54-728Z.log`
  - `test-results/server-unit-tests-2026-04-20T05-48-12-859Z.log`
  - `test-results/server-unit-tests-2026-04-20T06-29-58-700Z.log`
  - `test-results/server-unit-tests-2026-04-20T08-33-32-447Z.log`
  - `test-results/server-unit-tests-2026-04-20T12-11-44-153Z.log`
- Fresh server cucumber reruns for the repaired review-created owners are retained at:
  - `test-results/server-cucumber-tests-2026-04-20T01-32-19-033Z.log`
  - `test-results/server-cucumber-tests-2026-04-20T04-45-51-128Z.log`
  - `test-results/server-cucumber-tests-2026-04-20T09-00-00-023Z.log`
  - `test-results/server-cucumber-tests-2026-04-20T12-27-58-295Z.log`
  - `test-results/server-cucumber-tests-2026-04-20T12-53-51-673Z.log`
- These reruns are intentionally separated from retained earlier Story 55 evidence. They do not imply fresh client, browser, or supported-stack reruns for this pass, which remain either retained from `planning/0000055-pr-summary.md` or still pending Task 160's later wrapper phase.

## Residual Weak-Proof Notes

- Task 154's loop-stop cleanup release and Task 158's bounded delete batching remain primarily automation-owned seams. Current repository evidence shows no supported public runtime surface that reproduces those exact internal boundaries without test fixtures or direct persistence assertions, so their strongest proof remains the repaired unit or integration owners plus the fresh wrapper reruns above.
- That automation-owned status is an honest proof-boundary note, not an open new defect: both seams now have direct task-owned tests and green wrapper confirmation on current disk.
- The earlier Story 55 carried-forward weak-proof notes for `AC30`, `AC32`, and `AC43` remain the only broader residual caveats currently preserved from the maintained legacy summary, because this review-created pass did not reopen the unaffected client or browser acceptance surfaces behind those notes.

## Rejected-Risk Notes

- This pass did not endorse any additional finding beyond the five review-created defect families recorded in the current plan block. In particular, the repair path rejected route-specific compatibility shims, replay-only validation forks, generalized Mongo cleanup refactors, and broad cucumber wording churn in favor of bounded shared-owner fixes in Tasks 153 through 159.
- Earlier retained Story 55 rejected-risk conclusions carried forward from `planning/0000055-pr-summary.md` remain in force where this pass did not reopen them directly. Nothing in Tasks 153 through 159 created a fresh on-disk reason to promote those previously rejected sibling risks into new endorsed findings.

## Saturation Reasoning

- Tasks 153 through 159 collectively re-covered the review-created defect families from the current pass: deferred replay validation parity, shared repo-list compatibility and diagnostics, queueable trust-boundary exactness, bounded large-delete cleanup, and honest BDD phase boundaries.
- The prerequisite split into Tasks 154 through 156 prevented later repairs from masking earlier shared owners. That sequencing is now reflected on disk by each repaired task being `__done__` and by the later tasks citing the earlier prerequisite handoffs explicitly in the maintained plan.
- Fresh server build, unit, and cucumber reruns now exist for each repaired owner family, which is sufficient to keep adjacent server-side defect families saturated at this stage without claiming fresh client, browser, or compose proof that has not yet been rerun in Task 160.

## Blind-Spot Challenge Outcome

- The current review-created findings block resolved into seven bounded repaired owners on disk: Tasks 153 through 159. No additional follow-on owner was inserted after Task 159, and the maintained plan currently shows Task 160 as the remaining final-validation pass rather than another fresh seam-repair task.
- The honest additive challenge result for this pass is therefore "no new endorsed finding beyond the repaired owners already tracked in Tasks 153 through 159," while still preserving the residual weak-proof notes above until Task 160's later wrapper reruns finish.

## Bounded Residual-Risk Slot

- If Task 160's remaining wrapper reruns later expose a partially repaired seam, this summary should keep Story 55 in a bounded non-closing state by recording the exact failing owner, wrapper command, and log path here instead of restating the story as fully re-closed.
- If those later reruns stay green, this slot can remain as an explicit "not needed after final reruns" marker rather than being silently deleted.
