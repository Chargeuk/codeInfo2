# Title

Users can queue ingest and re-embed requests

# Acceptance

1. Users can submit ingest and re-embed requests even while another ingest run is already active, and the system keeps that work in a durable queue instead of rejecting it as busy.
2. Users can see queued repository work in the ingest repository list, including queued state and waiting position before execution starts, and that visibility must stay honest even when queue reads are degraded.
3. Users and automation receive a durable `requestId` for queued work and a `runId` once that queued work actually starts running.
4. Users are protected from unsafe restart, cleanup, and degraded-read behavior because the queue surfaces blocked or unavailable state instead of silently pretending the queue is empty and healthy.
5. The story closes only after the remaining degraded-read repair and one final broad regression pass prove the current review block.

# Description

This story makes ingest and re-embed work durable, visible, and predictable when the server is already busy. Instead of forcing users or automation to retry later, the product records queued work, shows where it is in line, and starts it safely when earlier work finishes. Most of the queue feature is already implemented, and the remaining planned work is focused on one reviewed gap: keeping queued repository visibility honest during Mongo-degraded reads, then rerunning the final broad validation for the latest review pass.

# Tasks

1. [Current Repository] - Preserve queued repository visibility during Mongo-degraded reads

- Repair the shared repo-list readers so a Mongo disconnect does not silently hide queued rows or present the queue as healthy when it is not.
- Update the focused server, MCP, and client proof files for degraded waiting rows, healthy queued overlays, and the waiting-before-first-run path.

2. [Current Repository] - Re-validate Story 55 after review pass `0000055-20260427T120554Z-cfc8af21`

- Run the supported server, client, e2e, compose, lint, and format wrappers for the current review-created findings block.
- Refresh the PR summary and review-state mapping so the task-required degraded-read fix and the inline-resolved minor fix close on the same final proof set.
