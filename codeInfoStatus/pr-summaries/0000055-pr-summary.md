# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed callers honest while requests wait in that queue, extends the shared repository-list contract so queued work is visible in the ingest UI and MCP mirrors, and carries review-created repairs through final validation.

This summary is refreshed for review pass `0000055-20260422T045457Z-daafd19b`. The durable plan owner is `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`, with prerequisite Task 185, review-fix Tasks 186 through 190, and final validation Task 191.

## Retained Earlier Proof

- Earlier Story 55 close-out context still lives in `planning/0000055-pr-summary.md`; it remains historical context for acceptance-chain decisions that this review pass did not reopen directly.
- The carried-forward weak-proof notes remain unchanged: Mongo atomicity beyond mocked interleavings, broad production timeout guarantees, negative proof that unrelated read surfaces do not mirror queue fields, inherited repository-list scale shape, and explicit bulk-remove refresh-count proof stay as residual context unless a later task adds narrower proof.
- Earlier review-pass summaries and wrapper reruns are retained context only. They are not replacement proof for the current `0000055-20260422T045457Z-daafd19b` findings block.

## Review Follow-Up After Pass `0000055-20260422T045457Z-daafd19b`

- The durable review anchor for this pass is the appended `Code Review Findings` block in `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`. It records one `must_fix`, five `should_fix`, and one localized `optional_simplification`; the saturation and blind-spot challenge artifacts generated no additional actionable findings.
- `F1` is closed by Tasks 185 and 186. Task 185 repaired the prerequisite provider-failure baseline in `server/src/ingest/embeddingDispatcher.ts`, `server/src/ingest/ingestJob.ts`, OpenAI retry/error helpers, failure classification, and OpenAI model-lock proof. Task 186 repaired mounted execution path preservation across queued re-embed admission, promotion, and startup recovery in `server/src/ingest/reingestService.ts`, `server/src/ingest/pathMap.ts`, `server/src/ingest/ingestJob.ts`, and shared blocking caller tests.
- `F2` is closed by Task 187, which restored the immediate non-waiting `queueState` response contract across REST producers, OpenAPI, repo-list/tool consumers, client normalization, and the shared live-state constant. Owners include `server/src/routes/ingestStart.ts`, `server/src/routes/ingestReembed.ts`, `server/src/lmstudio/toolService.ts`, `server/src/mongo/ingestQueueRequest.ts`, `openapi.json`, `client/src/hooks/useIngestRoots.ts`, and `client/src/test/ingestRoots.test.tsx`.
- `F3` is closed by Task 190. `codeInfoStatus/manual-testing/0000055/server-main-exit.log` now redacts the OpenAI organization identifier while preserving useful 429 context, and the retained Story 55 manual artifacts were searched for sibling provider/account identifiers, token-like values, bearer credentials, authorization headers, and raw sensitive provider metadata.
- `F4` is closed by Task 190. Generated PNGs under `artifacts/story-0000055-screenshots/**` were removed from git tracking, the generated directory is ignored, and future e2e-generated screenshots write under ignored `test-results/screenshots/0000055/` unless a later manual proof deliberately promotes sanitized artifacts under `codeInfoStatus/manual-testing/0000055/`.
- `F5` is closed by Task 188. Waiting queue rewrite ownership now includes an observed-row compare-and-swap guard in the queue persistence/rewrite path, with proof in `server/src/test/unit/ingest-request-queue.test.ts`, `server/src/test/unit/ingest-start.test.ts`, `server/src/test/unit/ingest-reembed.test.ts`, and `server/src/test/unit/reingestService.test.ts`.
- `F6` is closed by Task 189. Row and bulk Remove now use persisted `root.path` payloads, while Re-embed continues to use canonical row identity where appropriate; proof lives in `client/src/components/ingest/RootsTable.tsx`, `client/src/hooks/useIngestRoots.ts`, and `client/src/test/ingestRoots.test.tsx`.
- `F7` is closed by Task 187. Repository-list overlays reuse the shared live queue-state contract from `server/src/mongo/ingestQueueRequest.ts`, avoiding repeated local literal sets in the current review-owned files.

## Proof Homes And Retained Artifacts

- Review artifacts for this pass are recorded in the plan as `codeInfoTmp/reviews/0000055-20260422T045457Z-daafd19b-evidence.md`, `codeInfoTmp/reviews/0000055-20260422T045457Z-daafd19b-findings.md`, `codeInfoTmp/reviews/0000055-20260422T045457Z-daafd19b-findings-saturation.md`, and `codeInfoTmp/reviews/0000055-20260422T045457Z-daafd19b-blind-spot-challenge.md`.
- Task-scoped automated proof for Tasks 185 through 190 is recorded in the active plan, including the targeted server-unit, client, git-artifact, lint, and format checks listed in each dependency task's Testing section.
- Durable sanitized manual artifacts remain under `codeInfoStatus/manual-testing/0000055/`. Generated automated screenshot output is intentionally not retained as ordinary tracked payload under `artifacts/story-0000055-screenshots/**`.
- For any later manual proof, retained screenshots, logs, and notes belong under `codeInfoStatus/manual-testing/0000055/` only after confirming provider account identifiers and token-like values are absent.

## Rejected-Risk Notes

- This pass rejects reclosing from task-local proof alone. Task 191 still owns the broad final wrapper rerun set before audit can mark the story complete.
- This pass rejects treating the provider-failure prerequisite, mounted-path contract, response-shape contract, queue rewrite guard, remove identity, artifact hygiene, or live-state constant proof as interchangeable. Each finding maps to its named task and proof homes above.
- This pass rejects inventing unsupported manual seams for hard negative or timing-sensitive states. Runtime proof should use supported wrappers and the documented main-stack path only.
- This pass rejects preserving generated binary churn under `artifacts/story-0000055-screenshots/**`; generated screenshots stay ignored unless deliberately promoted as sanitized manual proof.

## Saturation And Blind-Spot Carry-Forward

- The current review saturation artifact generated no new actionable findings beyond `F1` through `F7`.
- The blind-spot challenge artifact generated no new actionable findings and carried forward residual weak-proof areas around Mongo atomicity beyond mocked interleavings, broad production timeout guarantees, negative proof that unrelated read surfaces do not mirror queue fields, inherited repository-list scale shape, and explicit bulk-remove refresh-count proof.
- Task 191 remains the final validation owner for this review-created block. Its automated proof must rerun the supported build, test, e2e, compose, host-network, lint, and format gates before this story can be audited as complete.

## Wrapper And Runtime Failure Classification

- Product-owned failures are failures in the repaired Story 55 seams or their direct contracts: queue path-role validation, REST/OpenAPI response shape, Mongo queue rewrite atomicity, destructive Remove payload identity, provider log redaction, generated screenshot tracking, and live-state constant ownership.
- Baseline-owned failures are pre-existing or shared repository issues outside the repaired Story 55 surfaces that appear during broad wrapper reruns and should be recorded with their exact owner rather than hidden inside this final task.
- Harness-owned failures are wrapper, parser, Docker, Playwright, or summary-output defects where the product command reached a different terminal truth than the harness reported.
- Environment-owned failures are local runtime problems such as missing Docker availability, occupied required ports, unavailable host-network services, or external provider state that cannot be repaired inside this task without inventing unsupported seams.

## Task 191 Automated Testing Results

- `npm run build:summary:server` passed with `status: passed`, `warning_count: 0`, `agent_action: skip_log`, and retained log `logs/test-summaries/build-server-latest.log`.
- `npm run build:summary:client` initially failed at the typecheck gate on stricter optional-property narrowing in `IngestForm.tsx` and `RootsTable.tsx`; after narrowing `runId` locally and guarding missing selected-root entries, the rerun passed with `status: passed`, `warning_count: 0`, `agent_action: skip_log`, and retained log `logs/test-summaries/build-client-latest.log`.
- `npm run test:summary:server:unit` passed with `tests run: 1781`, `passed: 1781`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/server-unit-tests-2026-04-22T10-58-38-090Z.log`.
- `npm run test:summary:server:cucumber` initially exposed a stale startup-recovery mismatch fixture: without `CODEINFO_CODEX_WORKDIR`, the current mounted-path contract attempted filesystem discovery and returned `ENOENT`. The fixture now sets the mounted workdir boundary and expects the current `queued reembed requestPayload.path must match the mounted canonicalTargetPath` error before the full wrapper rerun.
- `npm run test:summary:server:cucumber -- --feature server/src/test/features/ingest-reembed.feature` passed with `tests run: 11`, `passed: 11`, `failed: 0`, and retained log `test-results/server-cucumber-tests-2026-04-22T11-18-20-133Z.log`; the required full `npm run test:summary:server:cucumber` rerun passed with `tests run: 109`, `passed: 109`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/server-cucumber-tests-2026-04-22T11-18-37-384Z.log`.
- `npm run test:summary:client` passed with `tests run: 705`, `passed: 705`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/client-tests-2026-04-22T11-20-39-933Z.log`.
- `npm run test:summary:e2e` passed through the wrapper's automated setup, build, Playwright execution, and teardown path with `tests run: 60`, `passed: 60`, `failed: 0`, `agent_action: skip_log`, and retained log `logs/test-summaries/e2e-tests-latest.log`.
- `npm run compose:build:summary` passed with `items passed: 2`, `items failed: 0`, `agent_action: skip_log`, the expected `DEV-0000050:T10:image_runtime_assets_baked` marker, and retained log `logs/test-summaries/compose-build-latest.log`.
- `npm run compose:up` passed the fixed-port preflight with `DEV-0000050:T09:compose_preflight_result {"result":"passed"}` and started the supported main stack; Mongo and the server reached healthy, and the client container started.
- `npm run test:summary:host-network:main` passed with all four MCP endpoints reachable over `host.docker.internal` at HTTP 200, emitted `DEV-0000050:T12:main_stack_probe_completed {"result":"passed"}`, and retained log `logs/test-summaries/host-network-main-latest.log`.
- `npm run compose:down` passed and removed the client, server, Mongo, Chroma, Zipkin, OpenTelemetry collector, Playwright MCP containers, and the `codeinfo2_internal` network cleanly.
- `npm run lint` passed with exit code 0 and no lint fixes were required.
- `npm run format:check` passed with `All matched files use Prettier code style!`, so no `npm run format` repair pass was needed.

## Bounded Residual-Risk Slot

- Task 191 final automated proof is complete. No wrapper exposed a still-partial repaired seam, so no additional product-owned, baseline-owned, harness-owned, support-artifact-owned, or environment-owned residual risk is being carried forward from review pass `0000055-20260422T045457Z-daafd19b`.
