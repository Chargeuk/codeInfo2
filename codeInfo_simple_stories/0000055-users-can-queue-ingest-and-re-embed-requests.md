# Title

Users can queue ingest and re-embed requests

# Acceptance

1. Users can submit ingest and re-embed requests while another ingest run is active, and the system remembers that work instead of rejecting it as busy.
2. Users can see queued repository work in the ingest repository list with a clear waiting position.
3. Users and automation receive separate `requestId` and `runId` values so waiting work and actively running work are not confused.
4. Users are protected from false success when queue cleanup fails; blocked cleanup remains visible and prevents newer queued work from starting too early.
5. Users and automation receive a clear retryable `QUEUE_UNAVAILABLE` response when the Mongo-backed queue is unavailable.
6. Support and engineering users can rely on documented REST failure contracts and wrapper-first automated proof before the story closes again.

# Description

This story makes ingest and re-embed work durable and visible when the server is already busy. Instead of asking users or automation to retry later, the system records queued work, shows where it is in line, and starts it safely when earlier work finishes. The latest tasked review block tightens the final queue behavior so blocking callers do not see success before cleanup is complete, waiting positions stay current after queue promotions, queue-unavailable errors remain reachable and specific, and the REST documentation matches the runtime contract.

# Tasks

1. [codeInfo2] - Repair blocking re-embed cleanup ordering.

- Update `server/src/ingest/ingestJob.ts` and `server/src/ingest/reingestService.ts` so blocking callers do not receive success until queue cleanup is finalized.
- Add server unit proof for normal, skipped, zero-work, deletions-only, cleanup-failed, waiter-cleanup, and retained-success paths.

2. [codeInfo2] - Recompute waiting queue positions after route pump transitions.

- Update `server/src/ingest/requestQueue.ts`, `server/src/routes/ingestStart.ts`, and `server/src/routes/ingestReembed.ts` so responses and logs use the current post-pump waiting position.
- Add server unit proof that start-ingest and re-embed payloads and queue logs do not reuse stale pre-pump queue positions.

3. [codeInfo2] - Restore reachable queue-unavailable behavior and preserve diagnostics.

- Update startup, queue availability, re-ingest service, and re-ingest error formatting so degraded Mongo startup can surface retryable `QUEUE_UNAVAILABLE`.
- Add server unit and integration proof that REST, command, flow, classic MCP, and MCP2 surfaces preserve the specific degraded-startup diagnostic.

4. [codeInfo2] - Document the REST `QUEUE_UNAVAILABLE` failure contract.

- Update `openapi.json` so `POST /ingest/start` and `POST /ingest/reembed/{root}` document the `503 QUEUE_UNAVAILABLE` response envelope.
- Add OpenAPI contract proof that the new failure responses are documented without weakening existing queue-aware success responses.

5. [codeInfo2] - Revalidate the current review-created findings block.

- Refresh `codeInfoStatus/pr-summaries/0000055-pr-summary.md` so it cites the repaired proof homes and any still-honest residual risk.
- Run the repository's wrapper-first server, client, e2e, compose smoke, lint, and format proof before closing the story again.
