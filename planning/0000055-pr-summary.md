# Story 0000055 PR Summary

## Scope

Story 55 adds a durable Mongo-backed ingest queue for start-ingest and re-embed requests, keeps blocking re-embed callers honest while requests wait in that queue, extends the shared repository-list contract so queued work is visible in the ingest UI and MCP mirrors, and closes with the proof and documentation updates needed for final validation.

## Final task sequence

1. Task 1 added the persisted queue document model, canonical queue-target normalization, and durable admission reuse.
2. Task 2 wired FIFO runtime promotion, delete-before-next cleanup, `cleanup-blocked` retry behavior, cancellation cleanup ownership, and startup recovery.
3. Task 3 replaced queueable transport contracts for REST, MCP, commands, and flows so queued admission and blocking completion stayed honest.
4. Tasks 4 through 7 restored the full `server:unit` baseline, first by re-baselining the wrapper, then by repairing config drift, stale queue-era proof homes, and the remaining timeout or lifecycle regressions.
5. Task 8 extended the shared repository-list contract, server projection, client normalization, and ingest UI so queued rows stay visible with queue-aware identifiers and waiting-only queue positions.
6. Task 9 restored the reopened cucumber baseline outside Task 8 by re-baselining older ingest feature homes to the current queue-era behavior.
7. Task 10 added the deterministic non-user-facing e2e cleanup seam for waiting queue items and restored the full Playwright baseline.
8. Tasks 11 through 19 re-grounded the reopened `server:unit` overrun story, bounded the wrapper and child-side seams honestly, then confirmed the current `server:unit` baseline is healthy again from current `HEAD` while preserving focused cleanup diagnostics for the intermittent loop-stop path.
9. Task 20 originally owned the first full acceptance trace and wrapper reruns for Story 55 before the later review reopened the story.
10. Tasks 21 through 25 closed the reopened review findings by fixing the queue waiter rejection path, removing the queued bulk-remove leak, restoring the shared client baseline, bounding the terminal queue-state cache, and replacing the weak fixed-delay flow-stop proof with a deterministic boundary.
11. Task 26 closed the first reopened review cycle with refreshed acceptance tracing and full wrapper reruns, but a later review pass reopened the story again with three new scope-corrective findings.
12. Task 27 repaired the blocking re-embed waiter so an initial queue-state read failure now degrades through the existing bounded terminal-or-timeout contract instead of escaping as a raw setup failure.
13. Task 28 repaired startup recovery so any persisted `cleanup-blocked` row still blocks newer waiting work even when `runId` is missing, keeping restart ordering aligned with the live queue pump contract.
14. Task 29 removed the unrelated token-counting utility files and root script entry so the Story 55 branch scope again matches the documented ingest-queue plan.
15. Task 30 closed the second earlier review cycle before a later review pass reopened the story again around generated contract drift, non-portable workflow state, and weak browser proof ownership.
16. Task 31 repaired the generated OpenAPI and contract coverage so the queue-aware ingest routes and repository-list payloads are represented and pinned again.
17. Task 32 removed machine-local workflow-state values from tracked runtime JSON so the branch no longer carries one developer machine's local paths and host URLs as portable state.
18. Task 33 restored a trustworthy full `npm run test:summary:client` baseline after the unrelated suite-only timeout that surfaced while the reopened review tasks were landing.
19. Task 34 made the reopened browser proof deterministic and durable by removing the weak skip path, replacing arbitrary waits with explicit proof boundaries, and moving screenshot evidence into tracked artifacts.
20. Tasks 35 through 39 then bounded the shared remove-flow failure honestly: first deriving the failing owner, then exhausting the stale row-selection and post-visibility branches, and finally proving the earlier submit/start owner in `startIngestAndCaptureOutcome()`.
21. Task 40 resumed the shared remove-flow repair from that earlier owner proof and restored both the targeted remove-flow scenario and the full `npm run test:summary:e2e` wrapper on current `HEAD`.

## Durable queue contract

- Queue storage uses one Mongo collection for `waiting`, `running`, and `cleanup-blocked` items via [requestQueue.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestQueue.ts) and [ingestQueueRequest.ts](/home/d_a_s/code/codeInfo2/server/src/mongo/ingestQueueRequest.ts).
- Queue admission and write-side transport contracts live in [requestContracts.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestContracts.ts), [requestQueue.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestQueue.ts), [ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts), [ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts), and [reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts).
- Durable queue identity and runtime execution identity are intentionally split:
  - `requestId` is the queue record id.
  - `runId` is present only after work starts.
  - waiting responses return `queued: true` plus waiting-only `queuePosition`.
- Queue outages are explicit: REST uses `503` with `QUEUE_UNAVAILABLE`, while MCP, flows, and commands preserve that same retryable error meaning through their own structured surfaces.
- Startup recovery and queue cleanup ownership stay in the queue runtime through [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts) and [index.ts](/home/d_a_s/code/codeInfo2/server/src/index.ts), including retrying leftover `running` items, resolving `cleanup-blocked` items before newer waiting work, and deleting the finished queue record before later work starts.

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
  - implementation homes: [requestQueue.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestQueue.ts), [ingestQueueRequest.ts](/home/d_a_s/code/codeInfo2/server/src/mongo/ingestQueueRequest.ts), [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts)
  - proof homes: Task 1 queue-admission unit tests and Task 2 queue-runtime unit tests recorded in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Cleanup-blocked stall-and-retry plus startup recovery ordering:
  - implementation homes: [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), [index.ts](/home/d_a_s/code/codeInfo2/server/src/index.ts)
  - proof homes: Task 2 queue-runtime unit and integration coverage recorded in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Queue-aware transport contracts and retryable `QUEUE_UNAVAILABLE`:
  - implementation homes: [ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts), [ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts), [reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts)
  - proof homes: Task 3 transport-contract proofs, Task 6 transport-proof reruns, and Task 9 cucumber reruns in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Blocking re-embed callers through flows, commands, and MCP:
  - implementation homes: [reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts), [reingestExecution.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestExecution.ts), [mcp/server.ts](/home/d_a_s/code/codeInfo2/server/src/mcp/server.ts), [commandsRunner.ts](/home/d_a_s/code/codeInfo2/server/src/agents/commandsRunner.ts)
  - proof homes: Task 3 targeted unit/integration reruns and Task 6 proof re-baselines in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Shared repository-list queued visibility and queueable ingest-page submission:
  - implementation homes: [lmstudio.ts](/home/d_a_s/code/codeInfo2/common/src/lmstudio.ts), [toolService.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/toolService.ts), [ingestRoots.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestRoots.ts), [useIngestRoots.ts](/home/d_a_s/code/codeInfo2/client/src/hooks/useIngestRoots.ts), [IngestForm.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/IngestForm.tsx), [RootsTable.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/RootsTable.tsx)
  - proof homes: Task 8 server-unit, client, cucumber, targeted e2e, and compose notes in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
- Review-fix closure across both reopen cycles:
  - waiter rejection and blocking completion first closed through [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts) and [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts) in Task 21, while Task 27 later closed the distinct setup-read failure path the newer review found at the same waiter seam
  - queued bulk-remove leakage is closed in [RootsTable.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/RootsTable.tsx), [IngestPage.tsx](/home/d_a_s/code/codeInfo2/client/src/pages/IngestPage.tsx), [ingestRoots.test.tsx](/home/d_a_s/code/codeInfo2/client/src/test/ingestRoots.test.tsx), and [e2e/ingest.spec.ts](/home/d_a_s/code/codeInfo2/e2e/ingest.spec.ts), recorded by Task 22 in [0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md)
  - the unrelated client timeout baseline is restored by Task 23 in [chatPage.flags.network.payload.test.tsx](/home/d_a_s/code/codeInfo2/client/src/test/chatPage.flags.network.payload.test.tsx) and [chatPage.flags.websearch.payload.test.tsx](/home/d_a_s/code/codeInfo2/client/src/test/chatPage.flags.websearch.payload.test.tsx), with the clean full client wrapper rerun captured in the main plan
  - terminal queue-state retention is bounded by Task 24 in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), [ingest-queue-runtime.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-queue-runtime.test.ts), and [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts)
  - the weak flow-stop proof is replaced by Task 25 in [flows.run.errors.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/integration/flows.run.errors.test.ts), using the deterministic run-lock release plus persisted-turn inspection boundary now recorded in the main plan
  - startup recovery for malformed `cleanup-blocked` rows is now closed by Task 28 in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts) and [ingest-queue-runtime.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-queue-runtime.test.ts), keeping restart ordering aligned with the story contract even when `runId` is null
  - unrelated branch scope drift is now closed by Task 29 removing the root script entry from [package.json](/home/d_a_s/code/codeInfo2/package.json) and deleting the non-story utility files so Story 55 again matches its documented ingest/runtime scope
- Explicit out-of-scope boundaries retained through close-out:
  - no user-facing removal or cancellation of queued-but-not-started requests
  - no degraded run-anyway mode when Mongo is unavailable
  - no priority queueing or multi-worker ingest execution
  - no queue-position mirroring onto unrelated non-repository status payloads
  - no exactly-once execution guarantee across crashes or restarts

## Validation evidence to date

- Task 1: targeted `build:summary:server` and `test:summary:server:unit` queue-admission proof homes passed.
- Task 2: queue-runtime unit coverage plus startup-recovery and cleanup ownership proofs passed in the plan's recorded wrapper runs.
- Task 3: queue-aware transport proof homes and live REST manual validation passed.
- Task 5: targeted config-cluster `server:unit` reruns passed, and the full `server:unit` wrapper no longer failed in the config cluster.
- Task 6: queue-aware transport proof homes passed, and the full `server:unit` wrapper narrowed to non-transport owners before later fixes.
- Task 7: targeted timeout/lifecycle proof homes passed, and the full `server:unit` wrapper passed cleanly with no failures.
- Task 8: narrowed `ingest-roots.feature`, full client wrapper, targeted queued Playwright scenarios, and compose build/up/down proof all passed.
- Task 9: targeted cucumber feature reruns plus the full `test:summary:server:cucumber` wrapper passed.
- Task 10: the targeted queued-refresh Playwright rerun and the full `test:summary:e2e` wrapper both passed, with log-confirmed `unexpected: 0` despite wrapper `ambiguous_counts`.
- Task 19: repeated loop-stop reruns, whole-file `flows.run.loop.test.ts` reruns, and the full `test:summary:server:unit` wrapper passed cleanly from current `HEAD`, so the old shared-baseline blocker is retired.
- Task 20: the first full story wrapper reruns passed before review reopen and remain part of the pre-review validation history, but they are no longer sufficient on their own because the reopened findings changed code and proof after that point.
- Task 21: focused server build, waiter-path unit coverage, and full `test:summary:server:unit` reruns passed after the queue waiter rejection fix landed.
- Task 22: targeted client proof, targeted e2e `Remove selected` proof, and the supporting client build rerun passed after the queued bulk-remove leak was removed.
- Task 23: the exact chat-flag timeout owners passed, and the full `test:summary:client` wrapper returned to a clean trustworthy baseline.
- Task 24: targeted queue-runtime plus waiter-cache unit proof, full `test:summary:server:unit`, and supporting server build reruns passed after terminal-state retention was bounded.
- Task 25: the strengthened `flows.run.errors.test.ts` proof and the full `test:summary:server:unit` wrapper passed after the fixed-delay check was replaced with a deterministic boundary.
- Task 26 wrapper reruns already passed during the first reopen cycle, but they were later superseded by the newer review-corrective tasks 31 through 40.
- Task 31 restored the generated OpenAPI and queue-aware contract proof homes needed for the reopened contract-drift finding.
- Task 32 removed the machine-local runtime snapshot values from tracked workflow state so final close-out no longer depends on one developer machine's absolute paths and localhost URLs.
- Task 33 returned the full client wrapper to a clean trustworthy baseline.
- Task 34's targeted queue scenarios and durable screenshot artifacts now pass with stable proof boundaries, and the screenshots live in tracked `artifacts/story-0000055-screenshots/`.
- Task 39 proved the earlier submit/start owner seam with a clean targeted wrapper rerun, and Task 40 restored both the targeted shared remove-flow scenario and the full `test:summary:e2e` wrapper with `58/58` passing on current `HEAD`.
- This summary now reflects the post-Task-40 implementation state and leaves only the final cross-wrapper and compose revalidation work to Task 41.

## Deliberate non-changes and remaining out-of-scope boundaries

- Story 55 still does not add user-facing removal or cancellation of queued-but-not-started requests.
- Story 55 does not add degraded no-Mongo execution, priority queueing, multiple concurrent ingest workers, or unrelated generic status payload parity for queue position.
- The Task 10 e2e cleanup seam is intentionally non-user-facing and exists only to keep test teardown honest without changing the product queue contract.
