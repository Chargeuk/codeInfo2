# Blind-Spot Challenge

- `plan_path`: `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`
- `review_handoff`: `codeInfoStatus/reviews/0000055-current-review.json`
- `review_pass_id`: `0000055-20260406T094135Z-3ffce0de`
- `top_risk_helpers`: `validateExecutableIngestInput()`, `waitForQueueRequestTerminalStatus()`, `processRun()`
- `new_findings_generated`: `false`

## Challenge Results

1. `validateExecutableIngestInput()` admission-vs-execution challenge  
   Contradictory state attempted: a queued `/ingest/start` request is accepted with one lock interpretation and later promoted under a stricter one.  
   Outcome: strengthened rejected-risk note.  
   Evidence: route admission still validates before enqueue in [ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts#L139), the shared validator still owns the lock and allowlist contract in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L610), start-mode runtime still validates before execution in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L842), re-embed runtime still validates before any real-work branch in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L1466), and the direct parity tests remain in [ingest-start.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-start.test.ts#L406) and [ingest-queue-runtime.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-queue-runtime.test.ts#L222).

2. `waitForQueueRequestTerminalStatus()` leaked-registration challenge  
   Contradictory state attempted: the initial queue-state read rejects, the timeout fallback read also rejects, and a run-status listener has already been registered.  
   Outcome: strengthened rejected-risk note.  
   Evidence: the helper still centralizes settle-once cleanup in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L2589) and registers the listener/timer before the guarded setup read in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L2669); the direct cleanup proofs remain in [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L592), [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L614), and [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L657).

3. `processRun()` failure-ordering challenge  
   Contradictory state attempted: Chroma bootstrap fails before any real work begins on a zero-work delta re-embed, or the Task 46 validation move lets a real-work re-embed reach mutation logic first.  
   Outcome: strengthened rejected-risk note.  
   Evidence: the zero-work branch still returns through the fenced fast path in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L1458), bootstrap skipping remains limited to the explicit `allowCollectionBootstrapFailure` path in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L1290), real-work re-embed validation still runs before deletion/full-work branches in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L1466), and the direct bootstrap-failure proof remains in [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L439).

4. Hidden-state UI challenge  
   Contradictory state attempted: visible edits or disabled queue-blocked rows leak stale state into later payloads or bulk actions.  
   Outcome: strengthened rejected-risk note.  
   Evidence: `IngestForm` still serializes the currently visible fields at submit time in [IngestForm.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/IngestForm.tsx#L220), the resubmit and target-switch proofs remain in [ingestForm.test.tsx](/home/d_a_s/code/codeInfo2/client/src/test/ingestForm.test.tsx#L202) and [ingestForm.test.tsx](/home/d_a_s/code/codeInfo2/client/src/test/ingestForm.test.tsx#L252), `RootsTable` still disables queue-blocked or active-head selection in [RootsTable.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/RootsTable.tsx#L393) and [RootsTable.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/RootsTable.tsx#L417), and the mixed-selection guards remain directly tested in [ingestRoots.test.tsx](/home/d_a_s/code/codeInfo2/client/src/test/ingestRoots.test.tsx#L205) and [ingestRoots.test.tsx](/home/d_a_s/code/codeInfo2/client/src/test/ingestRoots.test.tsx#L304).

5. Extra non-helper consistency and portability challenge  
   Contradictory state attempted: a changed user-facing doc introduces an absolute local filesystem link, checked-in secret, or other portability defect.  
   Outcome: strengthened rejected-risk note.  
   Evidence: the changed top-level README content in [README.md](/home/d_a_s/code/codeInfo2/README.md#L1) does not introduce absolute local filesystem links, credentials, or secret-like values in the reviewed sections; the remaining absolute-path links observed in this story live in planning/support files, which are allowed support-file churn rather than a new user-facing portability regression for this challenge.

6. Wrapped-error mismatch challenge  
   Contradictory state attempted: a lower layer emits `QUEUE_UNAVAILABLE` as a normalized/provider-shaped error and the caller branches on the wrong raw shape.  
   Outcome: strengthened rejected-risk note.  
   Evidence: the shared classifier still preserves retryable `QUEUE_UNAVAILABLE` semantics in [ingestFailureClassifier.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/ingestFailureClassifier.ts#L49) and [ingestFailureClassifier.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/ingestFailureClassifier.ts#L92), the REST route still maps that code directly at the production boundary in [ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts#L82), the blocking tool path still maps the same code to its structured retryable error in [reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts#L597), and the corresponding proofs remain in [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L324) and [reingestService.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/reingestService.test.ts#L700).

7. Weak-proof test challenge  
   Contradictory state attempted: the browser proof relies on arbitrary elapsed sleeps where a stronger observable boundary exists.  
   Outcome: residual weak proof.  
   Evidence: the e2e cleanup loop still polls with `sleep(1_000)` in [ingest.spec.ts](/home/d_a_s/code/codeInfo2/e2e/ingest.spec.ts#L107), and the cancel flow still inserts `waitForTimeout(1_000)` before the button action in [ingest.spec.ts](/home/d_a_s/code/codeInfo2/e2e/ingest.spec.ts#L600). The surrounding assertions still bind to visible queue/cancel state, so this remains a proof-strength concern rather than a new correctness finding.

8. Mocked-seam challenge  
   Contradictory state attempted: the queue-outage test only proves that a mocked enqueue seam can throw `QUEUE_UNAVAILABLE`, not that the production route enforces the transport contract.  
   Outcome: strengthened rejected-risk note.  
   Evidence: the mocked unit proof exists in [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L324), but the production boundary itself still performs the 503/retryable mapping directly in [ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts#L115), so the proof is not mock-only at this HEAD.

9. Env/config domain challenge  
   Contradictory state attempted: empty or whitespace `CODEINFO_CHROMA_URL` values, or a non-positive collection dimension, flow into an unsafe base URL or invalid dimension.  
   Outcome: strengthened rejected-risk note.  
   Evidence: `resolveCollectionDimension()` still trims whitespace, falls back to `http://localhost:8000`, prefixes bare hosts with `http://`, and rejects non-positive dimensions by returning `null` in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L767).

10. Scale-shape challenge  
   Contradictory state attempted: queue-position or repo-list queries scale with repository file or chunk count rather than the number of live queue requests.  
   Outcome: strengthened rejected-risk note.  
   Evidence: waiting-position counting remains one fixed `$or` predicate over `createdAt` and `_id` in [requestQueue.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestQueue.ts#L66), and repo-list queue overlay still fetches live queue rows with one fixed `$in` selector over three states in [toolService.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/toolService.ts#L959).

11. Stale-hint precedence challenge  
   Contradictory state attempted: stale persisted root-dimension hints override fresher vector dimensions learned during the current run.  
   Outcome: strengthened rejected-risk note.  
   Evidence: `resolveKnownRootEmbeddingDimOrNull()` still prefers observed vector dimensions ahead of persisted root or collection hints in [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts#L810), and the direct precedence proof remains in [ingest-reembed.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-reembed.test.ts#L489).

## Outcome

No new findings were generated by this blind-spot challenge. The only remaining concern is the already-known weak-proof note in the browser acceptance tests, where short fixed waits remain in use.
