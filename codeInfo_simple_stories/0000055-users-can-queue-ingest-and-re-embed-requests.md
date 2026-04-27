# Title

Users can queue ingest and re-embed requests

# Acceptance

1. Users can submit ingest and re-embed requests even while another ingest run is already active, and the system keeps that work in a durable queue instead of rejecting it as busy.
2. Users can see queued repository work in the ingest repository list, including queued state and waiting position before execution starts.
3. Users and automation receive a durable `requestId` for queued work and a `runId` once that queued work actually starts running.
4. Users are protected from unsafe restart and cleanup behavior because the queue retries recovery in order and does not start newer work before blocked cleanup is resolved.
5. The story closes only after the remaining review fixes prove the queue helper contract, the retained proof-artifact contract, and one final broad regression pass for the current review block.

# Description

This story makes ingest and re-embed work durable, visible, and predictable when the server is already busy. Instead of forcing users or automation to retry later, the product records queued work, shows where it is in line, and starts it safely when earlier work finishes. Most of the queue feature is already implemented, and the remaining planned work is focused on tightening one queue-helper seam, clarifying where durable proof artifacts belong, and rerunning the final broad validation for the latest review pass.

# Tasks

1. [Current Repository] - Simplify waiting-only queue admission fallbacks

- Remove the dead waiting-row fallback branches in `server/src/ingest/requestQueue.ts` so the helper reflects the real waiting-only contract.
- Update the queue-owner proof files so ordering, duplicate-key recovery, cleanup, and cancel behavior still match the simplified helper.

2. [Current Repository] - Define a durable Story 55 manual-proof artifact home

- Decide which Story 55 proof artifacts must stay tracked and which should move into ignored scratch storage.
- Align the plan, review findings artifact, and PR summary so they all point at the same retained-proof contract.

3. [Current Repository] - Re-validate Story 55 after review pass `0000055-20260427T065706Z-15b0a653`

- Run the final broad automated regression proof for the current review-created findings block using the supported server build, server test, compose, lint, and format paths.
- Refresh the closing summary so the current review findings, inline minor fixes, retained proof contract, and final proof homes all line up before story close-out.
