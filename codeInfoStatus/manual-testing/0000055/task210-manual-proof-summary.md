# Task 210 Manual Proof Summary

Task `210` is the final task in Story `0000055`, so this pass expanded from task-scoped proof to full-story proof.

## Scope And Runtime

- Bound task source: `codeInfoStatus/flow-state/current-task.json` still resolved Task `210`, even though its status fields lagged behind the live plan.
- Eligibility source: fresh parser output from `python3 scripts/plan_status.py --task-number 210` showed Task `210` was `__done__`, fully checked, and unblocked.
- Startup path followed: `npm run compose:down` to clear the stale stack, then `npm run compose:build`, then `npm run compose:up`.
- Shutdown path followed: `npm run compose:down`.
- Freshness handling: the pre-existing main stack was treated as stale or unknown and was restarted before proof.

## Acceptance-Relevant Outcomes Proved

1. Full-story queue admission still works across the supported observable surfaces.
   - `POST /ingest/start` for `Task 209 Final Story Active Root` returned `queued: false`, `requestId` `69efa6e07584d84c13cb8c14`, and `runId` `dbb7babf-4fc2-4ef9-87a0-88ee6ef4b06a`.
   - A second `POST /ingest/start` for `Task 209 Final Story Queued Root` returned `queued: true` with `requestId` `69efa6e17584d84c13cb8c1c` and `queuePosition: 1`.
   - REST, tools, and classic MCP all showed the same active-plus-waiting queue contract in `task210-queue-summary-phase1.json`, `task210-tools-queue-phase1.json`, and `task210-mcp-queue-phase1-focused.json`.
2. The Task 210 selection-parity fix holds on the live browser surface.
   - The Ingest table showed `task188-manual-queue-proof` selected while the queue head and waiting row were already visible.
   - `POST /ingest/reembed/<task188 path>` returned `queued: true` with `requestId` `69efa7287584d84c13cb8c28` and `queuePosition: 2` while that row was selected.
   - The UI then dropped from `1 selected` to `0 selected` without a manual page reload, proving the completed row no longer remained selected after it became queue-blocked.
   - Retained transition artifact: `task210-selection-parity-summary.json`.
3. Queue-owned repository visibility survives degraded Mongo queue reads.
   - After stopping `mongo_db_CodeInfo`, `GET /health` reported `mongoConnected: false` in `task210-health-degraded.json`.
   - `GET /ingest/roots`, `GET /tools/ingested-repos`, and classic MCP `ListIngestedRepositories` all returned `queueReadDegraded: true` while still including visible repository rows in `task210-roots-degraded.json`, `task210-tools-degraded.json`, and `task210-mcp-degraded.json`.
   - The Ingest page showed the degraded warning banner and still rendered repository rows after a bounded `Refresh`.

## Browser Evidence

- Error-level console messages: none. See `task210-browser-console.txt`.
- Non-static browser requests stayed healthy on the proof surface. See `task210-browser-network.txt`.
- Playwright screenshot staging names used during proof:
  - `manual-testing/0000055/task210-story-queue-state.png`
  - `manual-testing/0000055/task210-queue-table.png`
  - `manual-testing/0000055/task210-selection-before-queue.png`
  - `manual-testing/0000055/task210-selection-cleared-after-queue.png`
  - `manual-testing/0000055/task210-degraded-warning-plus-rows.png`
- Screenshot transfer limitation: the Playwright tool reported captures under `/tmp/playwright-output/...`, but those files were not visible from the host shell, the running `codeinfo2-playwright-mcp-1` container, or the named Docker volume path available to this agent. The live browser images were still reviewed during capture, but no retained PNG files could be copied into the repository from the documented staging paths in this pass.

## Artifact Routing

- Retained reviewer-facing proof lives under `codeInfoStatus/manual-testing/0000055/`.
- The intended final screenshot destinations were:
  - `codeInfoStatus/manual-testing/0000055/task210-story-queue-state.png`
  - `codeInfoStatus/manual-testing/0000055/task210-queue-table.png`
  - `codeInfoStatus/manual-testing/0000055/task210-selection-before-queue.png`
  - `codeInfoStatus/manual-testing/0000055/task210-selection-cleared-after-queue.png`
  - `codeInfoStatus/manual-testing/0000055/task210-degraded-warning-plus-rows.png`
- JSON and text artifacts for startup, health, queue, degraded reads, and browser summaries were retained successfully in that same directory.

## Notes

- The bound task number in `current-task.json` stayed correct, but its status fields lagged behind the plan reread; parser output from `scripts/plan_status.py` was used as the source of truth for eligibility.
- The selected-row parity proof used the queued response plus the live browser transition to `0 selected`; the queue drained before a durable queued-row-after-transition screenshot could be transferred out of Playwright staging.
- No additional subtasks or testing steps were needed after this manual-proof pass.
