# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed and remove callers honest while requests wait in that queue, extends the shared repository-list contract so queue-owned work is visible across REST, MCP, and the client, and carries the `0000055-20260426T203714Z-ff22e029` review repairs plus inline minor fixes through one final validation pass.

This summary is refreshed for review pass `0000055-20260426T203714Z-ff22e029`. The durable plan owner is `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`, with repair Tasks `197` through `201` and final validation Task `202`.

## Review Artifacts

- Review handoff: `codeInfoTmp/reviews/0000055-current-review.json`
- Evidence: `codeInfoTmp/reviews/0000055-20260426T203714Z-ff22e029-evidence.md`
- Findings: `codeInfoTmp/reviews/0000055-20260426T203714Z-ff22e029-findings.md`
- Saturation: `codeInfoTmp/reviews/0000055-20260426T203714Z-ff22e029-findings-saturation.md`
- Blind-spot challenge: `codeInfoTmp/reviews/0000055-20260426T203714Z-ff22e029-blind-spot-challenge.md`

## Finding-To-Proof Map

- `F1` is closed by Task `197`. Owners `server/src/ingest/ingestJob.ts`, `server/src/ingest/requestContracts.ts`, and `server/src/routes/ingestStart.ts` now keep deferred queued start replay from reconstructing a missing `requestPayload.name`; proof owners are `server/src/test/unit/ingest-queue-runtime-pump.test.ts`, `server/src/test/unit/ingest-queue-runtime-recovery.test.ts`, and `server/src/test/unit/ingest-start.test.ts`.
- `F2` is closed by Tasks `198`, `199`, and `200`. Owners `server/src/test/steps/ingest-manage.steps.ts`, `server/src/test/support/mixedShapeRuntimeBridge.js`, `server/src/test/support/hostNetworkMainProbe.mjs`, `server/src/lmstudio/toolService.ts`, `server/src/ingest/reingestService.ts`, `server/src/routes/ingestRoots.ts`, and `server/src/routes/ingestReembed.ts` now keep mixed-shape canonical metadata on the structured invalid-state path across REST, shared callers, classic MCP, and MCP2; proof owners are `server/src/test/features/ingest-reembed.feature`, `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/reingestService.test.ts`, `server/src/test/integration/ingest-reembed-invalid-state.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- `F3` is closed by Task `201`. Owners `server/src/routes/ingestRemove.ts` and `server/src/ingest/requestContracts.ts` now reject non-exact destructive selectors before alias or dot-segment normalization can retarget removal; proof owners are `server/src/test/integration/ingest-lock-lifecycle.test.ts` and `server/src/test/features/ingest-remove.feature`.
- `F4` is closed by Task `201`. Owners `server/src/routes/ingestRemove.ts`, `server/src/test/integration/ingest-lock-lifecycle.test.ts`, and `server/src/test/features/ingest-remove.feature` now keep target-owned `QUEUE_STATE_BLOCKED` ahead of unrelated generic busy fallback when the selected root is queue-owned.
- Inline finding `5` stays closed in `client/src/hooks/useIngestRoots.ts` and `client/src/test/ingestRoots.test.tsx`; the roots client now preserves row-local `upstreamStatus` and `retryAfterMs` instead of dropping them during `/ingest/roots` normalization.
- Inline finding `6` stays closed in `client/src/components/ingest/IngestForm.tsx` and `client/src/test/ingestForm.test.tsx`; the already-open directory picker can no longer mutate the ingest path after the form enters a disabled submit state.
- Inline finding `7` stays closed in `client/src/test/ingestRoots.test.tsx`; queued and cleanup-blocked rows keep queue-derived remove affordances aligned with the visible row state.
- Inline finding `8` stays closed in `client/src/test/ingestRoots.test.tsx`; bulk re-embed mixed-failure and full-failure shaping now proves that row-level helper errors do not silently flatten the aggregate result.
- Inline finding `9` stays closed in `client/src/test/ingestForm.test.tsx`; the shared disabled ingest-form state reaches non-submit sibling controls during an in-flight submit.

## Final Validation Proof Homes

- Build proof homes: `logs/test-summaries/build-server-latest.log` and `logs/test-summaries/build-client-latest.log`
- Server automated proof homes: the latest `test-results/server-unit-tests-*.log` and `test-results/server-cucumber-tests-*.log`
- Client automated proof homes: the latest `test-results/client-tests-*.log` and matching `test-results/client-tests-*.json`
- Compose and host-network proof homes: `logs/test-summaries/compose-build-latest.log`, `logs/test-summaries/host-network-main-latest.log`, plus terminal output from `npm run compose:up` and `npm run compose:down`
- End-to-end proof home: `logs/test-summaries/e2e-tests-latest.log`
- Repository-hygiene proof homes: terminal output from `npm run lint` and `npm run format:check`

## Inline Minor Revalidation Requirements

- Findings `5` through `9` must be revalidated in the same final pass as `F1` through `F4`, not left behind as artifact-only inline fixes.
- The final pass must explicitly preserve row-local state in `client/src/test/ingestRoots.test.tsx`, exclude disabled state from submission in `client/src/test/ingestForm.test.tsx`, and keep queue-derived remove affordances aligned with visible row state instead of letting stale local values leak into the next action.
- The final pass must explicitly cover the mixed-failure bulk re-embed result shape and the disabled sibling-control state during in-flight submit in the same client wrapper run, not by isolated memory of earlier targeted proofs.

## Dependency Closure Before Final Pass

- Task `197` is `__done__` with `5/5` subtasks checked, `1/1` testing items checked, and no live blockers.
- Task `198` is `__done__` with `4/4` subtasks checked, `1/1` testing items checked, and no live blockers.
- Task `199` is `__done__` with `4/4` subtasks checked, `4/4` testing items checked, and no live blockers.
- Task `200` is `__done__` with `13/13` subtasks checked, `3/3` testing items checked, and no live blockers.
- Task `201` is `__done__` with `5/5` subtasks checked, `3/3` testing items checked, and no live blockers.

## Failure Classification For Final Validation

- Product-owned failures are regressions in the repaired seams: deferred queued start replay, mixed-shape re-embed invalid-state handling, destructive remove selector authority, target-first queue blocking, or the inline client mixed-state behaviors.
- Shared-wrapper-owned failures are summary-wrapper or parser failures where the repository command reaches a different terminal truth than the harness reports.
- Shared-baseline-owned failures are pre-existing repository, dependency, or infrastructure faults exposed by the broad wrapper reruns but not owned by the repaired Story 55 seams.
- Runtime-handoff-owned failures are supported main-stack readiness, mounted namespace, Docker, host-network, or environment faults that block broad proof without contradicting the repaired product contract.

## Final Validation Scope

- Task `202` owns the broad wrapper rerun set: `npm run build:summary:server`, `npm run build:summary:client`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run test:summary:client`, `npm run compose:build:summary`, `npm run compose:up`, `npm run test:summary:host-network:main`, `npm run compose:down`, `npm run test:summary:e2e`, `npm run lint`, and `npm run format:check`.
- `compose:up`, `compose:down`, `lint`, and `format:check` are terminal-output proof surfaces rather than retained log-file artifacts; the plan and final close-out must keep that distinction explicit.
- No additional repositories are in scope for this review cycle; `Current Repository` owns the full final regression proof.

## Residual-Risk Rule

- If any broad wrapper exposes a still-partial repaired seam, Task `202` must record that residual risk explicitly in the plan and summary instead of silently reclosing the story.
