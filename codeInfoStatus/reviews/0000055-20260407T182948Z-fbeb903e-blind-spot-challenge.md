# Blind-Spot Challenge

- `plan_path`: `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`
- `review_handoff_path`: `codeInfoStatus/reviews/0000055-current-review.json`
- `review_pass_id`: `0000055-20260407T182948Z-fbeb903e`
- `top_risk_helpers_functions_challenged`:
  - `server/src/ingest/ingestJob.ts::processRun()` plus `completeReembedFastPathWithFence()`
  - `server/src/ingest/ingestJob.ts::waitForQueueRequestTerminalStatus()`
  - `server/src/lmstudio/toolService.ts::listIngestedRepositories()` plus `applyQueueOverlay()`
- `challenge_generated_new_findings`: `false`

## Challenge Results

- Top-risk helper challenge 1:
  - Contradictory input attempted: a queued zero-work delta re-embed that passed admission earlier but reaches execution with lock drift, provider lookup failure, or Chroma bootstrap failure before any real work begins, matching the risk matrix at [0000055-20260407T182948Z-fbeb903e-evidence.md](/home/d_a_s/code/codeInfo2/codeInfoStatus/reviews/0000055-20260407T182948Z-fbeb903e-evidence.md#L282).
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L1460) validates execution-time re-embed input before the no-op fast return at [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L1466); [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L535) proves lock drift fails before provider/bootstrap work; [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L590) and [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L635) prove the intended provider-free and bootstrap-failure-safe fast path after validation.

- Top-risk helper challenge 2:
  - Contradictory input attempted: terminal-event, timeout, and setup-read error races that could leave `waitForQueueRequestTerminalStatus()` registered in shared listener state or settle more than once, matching the risk matrix at [0000055-20260407T182948Z-fbeb903e-evidence.md](/home/d_a_s/code/codeInfo2/codeInfoStatus/reviews/0000055-20260407T182948Z-fbeb903e-evidence.md#L287).
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L649), [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L671), and [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L714) each assert listener count returns to zero while timeout/setup-read failures normalize to the expected blocking error contract.

- Top-risk helper challenge 3:
  - Contradictory input attempted: duplicate persisted metadata plus a waiting queue row plus an active overlay targeting the same logical repository, matching the risk matrix at [0000055-20260407T182948Z-fbeb903e-evidence.md](/home/d_a_s/code/codeInfo2/codeInfoStatus/reviews/0000055-20260407T182948Z-fbeb903e-evidence.md#L288).
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [toolService.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/toolService.ts#L1102) overlays queued rows before active contexts and refuses to let active state overwrite `waiting` or `cleanup-blocked` rows; [mcp-ingested-repositories.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/mcp-ingested-repositories.test.ts#L219) proves duplicate metadata still collapses to one waiting row; [ingest-roots-dedupe.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-roots-dedupe.test.ts#L651) proves the shared REST repo-list path also emits one authoritative active row for duplicate metadata plus active overlay.

- Extra non-helper consistency or portability challenge:
  - Contradictory input attempted: changed user-facing docs introducing absolute local filesystem links or portability-hostile Story 55 references.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [README.md](/home/d_a_s/code/codeInfo2/README.md#L284) documents Story 55 with contract bullets only, and the nearby changed fixture reference at [README.md](/home/d_a_s/code/codeInfo2/README.md#L282) stays relative (`./e2e/fixtures/repo/large-planning-doc.md`) rather than embedding a local machine path.

- Failure-ordering challenge:
  - Contradictory input attempted: external provider or collection bootstrap fails before any real embedding work begins on the zero-work re-embed fast path.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L1477) routes the zero-work path through `completeReembedFastPathWithFence()` after validation, and [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L635) proves the fast path still completes when bootstrap would fail after validation.

- Admission-vs-execution challenge:
  - Contradictory input attempted: request admission succeeds, then model lock drift occurs before queued execution starts.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L1460) revalidates queued re-embed work at execution time, and [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L535) proves the promoted zero-work request rejects execution-time drift with `MODEL_LOCKED`.

- Wrapped-error mismatch challenge:
  - Contradictory input attempted: lower layers emit a normalized `QUEUE_UNAVAILABLE` error instead of a raw provider/SDK error shape, and callers still need to preserve retryable transport behavior.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [requestQueue.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestQueue.ts#L39) creates a normalized `QUEUE_UNAVAILABLE` error shape, and the production route consumers branch on that normalized code in [ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts#L243) and [ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts#L115).

- Weak-proof test challenge:
  - Contradictory input attempted: changed disconnect tests prove router survival only because a fixed delay keeps the request in flight long enough for an abort, rather than because the test owns a deterministic scheduler or gate.
  - Outcome: `residual_weak_proof`.
  - Evidence: [mcp2.reingest.tool.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/mcp2.reingest.tool.test.ts#L419) relies on `setTimeout(resolve, 50)` and `controller.abort()` after `10ms`, and [mcp.reingest.classic.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/mcp.reingest.classic.test.ts#L430) uses the same timing pattern. The titles still match the assertions, but the proof is timing-based rather than gate-based.

- Mocked-seam contract challenge:
  - Contradictory input attempted: queue-outage tests only prove a mocked downstream seam can throw `QUEUE_UNAVAILABLE`, not that the production boundary itself preserves the transport contract.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: the route handlers themselves branch on `err.code === 'QUEUE_UNAVAILABLE'` in [ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts#L243) and [ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts#L115), so the changed tests still exercise a real production mapping point rather than a mock-only validation boundary.

- Env/config domain challenge:
  - Contradictory input attempted: empty string, whitespace, or mixed-case values for the e2e cleanup-route env gate.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [ingestE2eCleanup.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestE2eCleanup.ts#L7) uses strict equality to `'true'`, so malformed values disable the route instead of silently enabling it, and the checked-in e2e env file uses the exact intended value at [server/.env.e2e](/home/d_a_s/code/codeInfo2/server/.env.e2e#L21).

- Scale-shape challenge:
  - Contradictory input attempted: queued repository-list overlay grows with repository/file/chunk count in an unbounded selector or payload.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [toolService.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/toolService.ts#L1102) issues one queue query with a fixed three-value `$in` state filter and then performs a linear in-memory overlay per queue request; it does not build `$or`, `$nin`, or per-file delete selectors. This matches the story’s whole-request queue scope instead of a large-file query path.

- Leaked-registration challenge:
  - Contradictory input attempted: waiter cleanup leaks shared listener registrations on timeout, rejection, or early-return paths.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L649), [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L671), and [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L714) all assert listener cleanup back to zero.

- Stale-hint challenge:
  - Contradictory input attempted: a stale persisted vector-dimension hint survives even after the current run observes fresher embedding dimensions.
  - Outcome: `strengthened_rejected_risk`.
  - Evidence: [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L687) proves the successful ingest path writes the observed embedding dimension (`3`) rather than retaining the stale persisted hint (`1`).

## Overall Outcome

- `new_endorsed_findings`: none
- `residual_weak_proof_areas`:
  - The MCP disconnect tests at [mcp2.reingest.tool.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/mcp2.reingest.tool.test.ts#L419) and [mcp.reingest.classic.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/mcp.reingest.classic.test.ts#L430) still depend on fixed elapsed delays rather than a deterministic gate, so they are better treated as adequate smoke proof than maximal isolation proof.
