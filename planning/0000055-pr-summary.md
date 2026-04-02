# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed callers honest while requests wait in that queue, extends the shared repository-list contract so queued work is visible in the ingest UI and MCP mirrors, and closes with the proof and documentation updates needed for final validation.

## Final task sequence

1. Task 1 introduced the persisted queue document model, FIFO admission helpers, and the startup/runtime queue pump boundaries.
2. Task 2 wired queue-backed request admission into ingest start, re-embed routing, and queue-unavailable transport handling.
3. Task 3 updated blocking re-embed callers so flows, commands, and MCP wait for queued work to reach a real terminal state.
4. Task 4 restored the shared `server:unit` wrapper baseline and re-owned the failures it exposed instead of masking them.
5. Task 5 repaired checked-in runtime-config and fixture drift that the restored wrapper exposed.
6. Task 6 re-baselined stale queue-aware transport proof homes to the Story 55 contract.
7. Task 7 repaired the remaining timeout and lifecycle proof owners until the full `server:unit` wrapper passed cleanly.
8. Task 8 extended the shared repository-list schema, server projection, client normalization, and ingest UI so queued rows stay visible with queue-aware identifiers and waiting-only queue positions.
9. Task 9 restored the reopened full cucumber baseline outside Task 8 by repairing the older ingest feature homes to current queue-era behavior.
10. Task 10 added the deterministic non-user-facing e2e cleanup seam for waiting queue items and restored the full Playwright baseline.
11. Task 11 traces final acceptance coverage, updates docs, and owns the final close-out validation pass.

## Durable queue contract

- Queue storage uses one Mongo collection for `waiting`, `running`, and `cleanup-blocked` items via [requestQueue.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestQueue.ts) and [ingestQueueRequest.ts](/home/d_a_s/code/codeInfo2/server/src/mongo/ingestQueueRequest.ts).
- Queue admission and write-side transport contracts live in [ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts), [ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts), and [reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts).
- Durable queue identity and runtime execution identity are intentionally split:
  - `requestId` is the queue record id.
  - `runId` is present only after work starts.
  - waiting responses return `queued: true` plus waiting-only `queuePosition`.
- Queue outages are explicit: REST uses `503` with `QUEUE_UNAVAILABLE`, while MCP, flows, and commands preserve that same retryable error meaning through their own structured surfaces.
- Startup recovery and queue cleanup ownership stay in the queue runtime, including retrying leftover `running` items and resolving `cleanup-blocked` items before newer waiting work.

## Shared visibility and UI contract

- The shared repository-list schema is now `0000055-queued-repo-list-v1` in [toolService.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/toolService.ts) and [lmstudio.ts](/home/d_a_s/code/codeInfo2/common/src/lmstudio.ts).
- Shared repo-list readers expose `requestId`, nullable `runId`, waiting-only `queuePosition`, and explicit `queueState` through:
  - [ingestRoots.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestRoots.ts)
  - [server.ts](/home/d_a_s/code/codeInfo2/server/src/mcp/server.ts)
  - [useIngestRoots.ts](/home/d_a_s/code/codeInfo2/client/src/hooks/useIngestRoots.ts)
- The ingest UI now treats queued submission as normal accepted behavior and renders queued plus cleanup-blocked rows through:
  - [IngestPage.tsx](/home/d_a_s/code/codeInfo2/client/src/pages/IngestPage.tsx)
  - [IngestForm.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/IngestForm.tsx)
  - [RootsTable.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/RootsTable.tsx)

## Acceptance mapping

- Queue storage, FIFO promotion, dedupe, and queue-state ownership:
  - implementation homes: [requestQueue.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestQueue.ts), [ingestQueueRequest.ts](/home/d_a_s/code/codeInfo2/server/src/mongo/ingestQueueRequest.ts)
  - proof homes: Task 3 and Task 4 server-unit proofs recorded in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Cleanup-blocked stall-and-retry plus startup recovery ordering:
  - implementation homes: [requestQueue.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestQueue.ts), [index.ts](/home/d_a_s/code/codeInfo2/server/src/index.ts)
  - proof homes: Task 3 unit/integration coverage and Task 10 e2e cleanup proof notes in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Queue-aware transport contracts and retryable `QUEUE_UNAVAILABLE`:
  - implementation homes: [ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts), [ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts), [reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts)
  - proof homes: Task 6 unit/integration reruns and Task 9 cucumber reruns in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Blocking re-embed callers through flows, commands, and MCP:
  - implementation homes: [reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts), [reingestExecution.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestExecution.ts), [mcp/server.ts](/home/d_a_s/code/codeInfo2/server/src/mcp/server.ts), [commandsRunner.ts](/home/d_a_s/code/codeInfo2/server/src/agents/commandsRunner.ts)
  - proof homes: Task 3 targeted unit/integration reruns and Task 6 proof re-baselines in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Shared repository-list queued visibility and queueable ingest-page submission:
  - implementation homes: [lmstudio.ts](/home/d_a_s/code/codeInfo2/common/src/lmstudio.ts), [toolService.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/toolService.ts), [ingestRoots.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestRoots.ts), [useIngestRoots.ts](/home/d_a_s/code/codeInfo2/client/src/hooks/useIngestRoots.ts), [IngestForm.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/IngestForm.tsx), [RootsTable.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/RootsTable.tsx)
  - proof homes: Task 8 server-unit, client, cucumber, targeted e2e, and compose notes in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)

## Validation evidence to date

- Task 3: targeted `build:summary:server` and `test:summary:server:unit` queue-contract proof homes passed.
- Task 5: targeted config-cluster `server:unit` reruns passed, and the full `server:unit` wrapper no longer failed in the config cluster.
- Task 6: queue-aware transport proof homes passed, and the full `server:unit` wrapper narrowed to non-transport owners before later fixes.
- Task 7: targeted timeout/lifecycle proof homes passed, and the full `server:unit` wrapper passed cleanly with no failures.
- Task 8: narrowed `ingest-roots.feature`, full client wrapper, targeted queued Playwright scenarios, and compose build/up/down proof all passed.
- Task 9: targeted cucumber feature reruns plus the full `test:summary:server:cucumber` wrapper passed.
- Task 10: the targeted queued-refresh Playwright rerun and the full `test:summary:e2e` wrapper both passed, with log-confirmed `unexpected: 0` despite wrapper `ambiguous_counts`.
- Task 11 final validation wrappers have not been rerun yet in this implementation-only pass. They remain owned by Task 11 Testing in the main plan.

## Deliberate non-changes and remaining out-of-scope boundaries

- Story 55 still does not add user-facing removal or cancellation of queued-but-not-started requests.
- Story 55 does not add degraded no-Mongo execution, priority queueing, multiple concurrent ingest workers, or unrelated generic status payload parity for queue position.
- The Task 10 e2e cleanup seam is intentionally non-user-facing and exists only to keep test teardown honest without changing the product queue contract.
