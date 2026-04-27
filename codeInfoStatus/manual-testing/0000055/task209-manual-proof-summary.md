# Task 209 Manual Proof Summary

Task `209` is the final task in Story `0000055`, so this pass expanded from task-scoped proof to full-story proof.

## Scope And Runtime

- Bound task source: `codeInfoStatus/flow-state/current-task.json` still resolved Task `209`.
- Eligibility source: fresh parser output from `python3 scripts/plan_status.py --task-number 209` showed Task `209` was `__done__`, fully checked, and unblocked.
- Startup path followed: `npm run compose:build`, then `npm run compose:up`.
- Shutdown path followed: `npm run compose:down`.
- Freshness handling: the prior main stack was treated as stale or unknown and was restarted before proof.

## Acceptance-Relevant Outcomes Proved

1. Full-story queue admission still works across the supported observable surfaces.
   - First `POST /ingest/start` returned a running request with `requestId` `69ef8c1d4c9bace36b3c5896` and `runId` `16bf1254-fbcb-486c-9b36-0e20cee94b56`.
   - Second `POST /ingest/start` returned `queued: true` with `requestId` `69ef8c1d4c9bace36b3c589b` and `queuePosition: 1`.
   - `POST /ingest/reembed/<root>` returned `queued: true` with `requestId` `69ef8c1d4c9bace36b3c58a5` and `queuePosition: 2`.
   - Retained API proof: `task209-queue-summary.json`.
2. Browser-visible queue state still matches the queue contract.
   - The Ingest page showed `Task 209 Final Story Queued Root` as `queued (#1)` while `Task 209 Final Story Active Root` showed `ingesting (embedding)`.
   - The queued-row details drawer showed `Request ID` `69ef8c1d4c9bace36b3c589b`, `Run ID` `Pending queue start`, and `Queue state` `waiting (#1)`.
   - Retained screenshots: `task209-story-queue-state.png` and `task209-queued-details.png`.
3. Queue-owned repository visibility survives degraded Mongo queue reads.
   - After stopping `mongo_db_CodeInfo`, `GET /health` reported `mongoConnected: false`.
   - The browser showed the degraded warning banner while still rendering visible repository rows.
   - Retained degraded proof: `task209-health-degraded.json`, `task209-roots-degraded.json`, `task209-tools-degraded.json`, `task209-mcp-degraded.json`, and `task209-degraded-warning-plus-rows.png`.
4. The queue can drain back to a clean resting state.
   - Retained drain proof: `task209-drain-summary.json`.

## Browser Evidence

- Error-level console messages: none. See `task209-browser-console.txt`.
- Non-static network evidence stayed healthy on the retained surface. See `task209-browser-network.txt`.

## Artifact Routing

- Scratch runtime output stayed under ignored `codeInfoTmp/manual-testing/0000055/`.
- Retained reviewer-facing proof lives under `codeInfoStatus/manual-testing/0000055/`.
- Playwright screenshots were staged with relative filenames under `manual-testing/0000055/` and then copied from `playwright-output-local/manual-testing/0000055/` into the retained story proof home.

## Notes

- The browser queue-state screenshot had to be re-captured after the first queued run completed during artifact review.
- Mongo was stopped only for the bounded degraded-read proof and the main stack was then shut down with `npm run compose:down`, returning the repository to its prior stopped state.
- No additional subtasks or testing steps were needed after this manual-proof pass.
