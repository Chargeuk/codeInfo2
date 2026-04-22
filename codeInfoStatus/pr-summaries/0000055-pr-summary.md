# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed callers honest while requests wait in that queue, extends the shared repository-list contract so queued work is visible in the ingest UI and MCP mirrors, and carries review-created repairs through final validation.

This summary is refreshed for review pass `0000055-20260422T115002Z-d109d87f`. The durable plan owner is `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`, with review-fix Tasks 192 through 195 and final validation Task 196.

## Review Follow-Up After Pass `0000055-20260422T115002Z-d109d87f`

- The durable review anchor for this pass is the appended `Code Review Findings` block in `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`. Review artifacts are `codeInfoTmp/reviews/0000055-20260422T115002Z-d109d87f-evidence.md`, `codeInfoTmp/reviews/0000055-20260422T115002Z-d109d87f-findings.md`, `codeInfoTmp/reviews/0000055-20260422T115002Z-d109d87f-findings-saturation.md`, and `codeInfoTmp/reviews/0000055-20260422T115002Z-d109d87f-blind-spot-challenge.md`.
- `F1` is closed by Task 192. Runtime owner `server/src/ingest/ingestJob.ts` now keeps cleanup delete-failure plus cleanup-blocked-persistence-failure ownership blocking newer queue promotion until the failed queue record is removed or durable cleanup ownership is visible again; proof homes are `server/src/test/unit/ingest-queue-runtime-terminal.test.ts` and `server/src/test/unit/ingest-cancel.test.ts`.
- `F2` is closed by Task 193. Contract owners `openapi.json`, `server/src/test/unit/openapi.contract.test.ts`, `server/src/routes/ingestStart.ts`, `server/src/ingest/requestContracts.ts`, `client/src/components/ingest/IngestForm.tsx`, and `client/src/test/ingestForm.test.tsx` now align `POST /ingest/start` around either legacy `model` or the complete canonical `embeddingProvider` plus `embeddingModel` pair; proof homes are the OpenAPI, ingest-start, and IngestForm tests recorded in Task 193.
- `F3` is closed by Task 194. Queue-read outage owners `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`, `server/src/ingest/reingestExecution.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`, command dispatch, and flow dispatch now preserve retryable `QUEUE_UNAVAILABLE` semantics for blocking wait-time queue-read failures; proof homes are the targeted reingest service, MCP classic, MCP v2, direct execution, command, and flow tests recorded in Task 194.
- `F4` is closed by Task 192. Diagnostic owner `server/src/lmstudio/toolService.ts` now lets cleanup-blocked overlays without runtime status replace stale persisted `lastError` values; proof homes are `server/src/test/unit/tools-ingested-repos.test.ts` and `server/src/test/unit/ingest-roots-dedupe.test.ts`.
- `F5` is closed by Task 195. Production remove owners `server/src/routes/ingestRemove.ts`, `server/src/ingest/requestQueue.ts`, `server/src/test/features/ingest-remove.feature`, `server/src/test/steps/ingest-manage.steps.ts`, `server/src/routes/ingestE2eCleanup.ts`, `server/src/test/integration/ingest-e2e-cleanup.test.ts`, `client/src/components/ingest/RootsTable.tsx`, and `client/src/test/ingestRoots.test.tsx` now enforce queue-state authority before destructive removal while preserving idle removal and the test-only cleanup boundary.
- `F6` is closed by Task 192. Proof owner `server/src/test/unit/ingest-cancel.test.ts` replaced the fixed `setTimeout(20)` negative assertion with a deterministic unresolved cleanup-gate pending-promise boundary.

## Proof Homes For Pass `0000055-20260422T115002Z-d109d87f`

- Task 192 automated proof homes: `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-queue-runtime-terminal.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/unit/tools-ingested-repos.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-roots-dedupe.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-cancel.test.ts`, `npm run lint`, and `npm run format:check`, all checked in the plan.
- Task 193 automated proof homes: `npm run test:summary:server:unit -- --file server/src/test/unit/openapi.contract.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-start.test.ts`, `npm run test:summary:client -- --file client/src/test/ingestForm.test.tsx`, `npm run lint`, and `npm run format:check`, all checked in the plan.
- Task 194 automated proof homes: `npm run test:summary:server:unit -- --file server/src/test/unit/reingestService.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/unit/mcp.reingest.classic.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/unit/mcp2.reingest.tool.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/unit/reingestExecution.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/integration/commands.reingest.test.ts`, `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts`, `npm run lint`, and `npm run format:check`, all checked in the plan.
- Task 195 automated proof homes: `npm run test:summary:server:cucumber -- --feature server/src/test/features/ingest-remove.feature`, `npm run test:summary:server:unit -- --file server/src/test/integration/ingest-e2e-cleanup.test.ts`, `npm run test:summary:client -- --file client/src/test/ingestRoots.test.tsx`, `npm run lint`, and `npm run format:check`, all checked in the plan.
- Task 196 is the broad final validation owner. Its automated proof reran `npm run build:summary:server`, `npm run build:summary:client`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run test:summary:client`, `npm run test:summary:e2e`, `npm run compose:build:summary`, `npm run compose:up`, `npm run test:summary:host-network:main`, `npm run compose:down`, `npm run lint`, and `npm run format:check`.

## Saturation, Blind Spots, And Residual Risk For Pass `0000055-20260422T115002Z-d109d87f`

- The saturation and blind-spot challenge artifacts generated no additional actionable findings beyond `F1` through `F6`.
- Rejected-risk carry-forward remains explicit: queue rewrite race protection is guarded by observed-row filters and duplicate-key recovery; deferred queued re-embed execution revalidates persisted path/model payloads before discovery; startup recovery checks cleanup-blocked rows before running or waiting work; queue waiter listener cleanup is direct even though queue-read failure shape was endorsed as `F3`; UI field-role and bulk proof stay direct while the server remove authority gap was endorsed as `F5` and repaired in Task 195.
- Known pre-wrapper residual risk: Task 192's exact delete-failure plus cleanup-blocked-persistence-failure interleaving and deterministic cancel gate remain automated-proof-owned because no supported live runtime fixture exposes that internal fault-injection boundary.
- Known pre-wrapper residual risk: Task 194's queue-read outage contract remains automated-proof-owned because the repository has no supported manual queue-read-outage injection harness, and this summary does not invent one by stopping internal services.
- Known pre-wrapper residual risk: Task 195 observed a Chroma healthcheck deprecation response on `/api/v1/heartbeat` during task-scoped manual proof, but the task-owned API and UI proof completed; Task 196 broad Compose, host-network, and e2e proof must classify any recurrence as product, harness, baseline, or environment before retrying or blocking.
- Broad wrapper, Compose, Docker, host-network, e2e, port, health-check, and environment failures in Task 196 must be classified as task-owned product defects, proof-harness defects, shared wrapper or baseline defects, or manual/runtime environment defects. They must not be hidden by repeated broad-wrapper reruns or by treating targeted repair-task proof as final default-path proof.

## Task 196 Automated Testing Results

- `npm run build:summary:server` passed with `status: passed`, `warning_count: 0`, `agent_action: skip_log`, and retained log `logs/test-summaries/build-server-latest.log`.
- `npm run build:summary:client` passed through typecheck and build with `status: passed`, `warning_count: 0`, `agent_action: skip_log`, and retained log `logs/test-summaries/build-client-latest.log`.
- The first `npm run test:summary:server:unit` run failed in `server/src/test/integration/ingest-lock-lifecycle.test.ts` because the production remove route queried the Mongo-backed queue before honoring an existing in-memory ingest lock, returning 500 instead of deterministic `BUSY`; `server/src/routes/ingestRemove.ts` was repaired so active-run ownership and `isBusy()` block before the queue read while waiting queue-owned rows still block before destructive removal.
- `npm run test:summary:server:unit -- --file server/src/test/integration/ingest-lock-lifecycle.test.ts` passed with `tests run: 2`, `passed: 2`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/server-unit-tests-2026-04-22T16-35-09-036Z.log`.
- The required full `npm run test:summary:server:unit` rerun passed with `tests run: 1788`, `passed: 1788`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/server-unit-tests-2026-04-22T16-35-18-618Z.log`.
- `npm run test:summary:server:cucumber` passed with `tests run: 114`, `passed: 114`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/server-cucumber-tests-2026-04-22T16-51-11-820Z.log`.
- `npm run test:summary:client` passed with `tests run: 705`, `passed: 705`, `failed: 0`, `agent_action: skip_log`, and retained log `test-results/client-tests-2026-04-22T16-53-00-954Z.log`.
- `npm run test:summary:e2e` passed through the wrapper's compose build, automated Playwright execution, and teardown path with `tests run: 60`, `passed: 60`, `failed: 0`, emitted `DEV-0000050:T13:e2e_host_network_config_verified`, `agent_action: skip_log`, and retained log `logs/test-summaries/e2e-tests-latest.log`.
- `npm run compose:build:summary` passed with `items passed: 2`, `items failed: 0`, emitted `DEV-0000050:T10:image_runtime_assets_baked`, `agent_action: skip_log`, and retained log `logs/test-summaries/compose-build-latest.log`.
- `npm run compose:up` passed the fixed-port preflight with `DEV-0000050:T09:compose_preflight_result {"result":"passed"}` and started the supported main stack; Mongo and the server reached healthy, and the client container started.
- `npm run test:summary:host-network:main` passed with classic MCP, chat MCP, agents MCP, and Playwright MCP reachable over `host.docker.internal` at HTTP 200, emitted `DEV-0000050:T12:main_stack_probe_completed {"result":"passed"}`, `agent_action: skip_log`, and retained log `logs/test-summaries/host-network-main-latest.log`.
- `npm run compose:down` passed and removed the client, server, Mongo, Chroma, Zipkin, OpenTelemetry collector, Playwright MCP containers, and the `codeinfo2_internal` network cleanly.
- `npm run lint` passed with exit code 0 and no lint fixes were required.
- `npm run format:check` passed with `All matched files use Prettier code style!`, so no `npm run format` repair pass was needed.

## Bounded Residual-Risk Slot For Pass `0000055-20260422T115002Z-d109d87f`

- Task 196 automated proof is complete and no live blocker remains. The route-ordering repair found by full server-unit proof was fixed and rerun through targeted and full wrappers. No wrapper exposed a still-partial repaired seam, so no additional product-owned, baseline-owned, harness-owned, support-artifact-owned, or environment-owned residual risk is being carried forward from review pass `0000055-20260422T115002Z-d109d87f`.

## Retained Earlier Proof

- Earlier Story 55 close-out context still lives in `planning/0000055-pr-summary.md`; it remains historical context for acceptance-chain decisions that this review pass did not reopen directly.
- The carried-forward weak-proof notes remain unchanged: Mongo atomicity beyond mocked interleavings, broad production timeout guarantees, negative proof that unrelated read surfaces do not mirror queue fields, inherited repository-list scale shape, and explicit bulk-remove refresh-count proof stay as residual context unless a later task adds narrower proof.
- Earlier review-pass summaries and wrapper reruns are retained context only. They are not replacement proof for the current `0000055-20260422T115002Z-d109d87f` findings block.

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

- The `0000055-20260422T045457Z-daafd19b` review saturation artifact generated no new actionable findings beyond `F1` through `F7`.
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
