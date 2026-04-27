# Task 207 Final Manual Proof Summary

- Scope: final-task full-story proof for Story 55 using the stored plan scope in the current repository only.
- Runtime freshness: the existing main stack was treated as stale or unknown, so the pass restarted it with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up` before proof, then returned it to the prior stopped state with `npm run compose:down`. The preflight startup and shutdown transcripts were kept as ignored scratch under `codeInfoTmp/manual-testing/0000055/`.
- Diagnosis note: initial synthetic scratch roots hit `NO_ELIGIBLE_FILES`, so the bounded diagnosis pass switched to the existing Story 55 eligible fixtures at `codeInfoTmp/manual-testing/0000055/task181-fixture` and `codeInfoTmp/manual-testing/0000055/task191-waiting-root` rather than treating that scratch-fixture seam as a task-owned product failure.
- API proof:
  - `task207-health.json` shows `GET /health` returned `status: ok`.
  - `task207-sequential-start-summary.json` shows the active start returned `queued: false`, `queueState: running`, and a real `runId`, while the second start returned `queued: true` with `queuePosition: 1`.
  - `task207-active-status-sequential.json` shows the active run entered `embedding`.
  - `task207-queue-roots-focused.json` shows the running root exposed `requestId`, `runId`, and `queueState: running`, while the queued root exposed `requestId`, `runId: null`, `queueState: waiting`, and `queuePosition: 1`.
  - `task207-drain-wait.json` shows the queue drained naturally and both roots settled back to completed state.
- Browser proof:
  - `task207-ingest-queued-row.png` captures the Ingest UI with the queued row visible as `queued (#1)`.
  - `task207-ingest-queued-details.png` captures the details drawer with `Request ID`, `Run ID Pending queue start`, and `Queue state waiting (#1)`.
  - Playwright staging filenames were `manual-testing/0000055/task207-ingest-queued-row.png` and `manual-testing/0000055/task207-ingest-queued-details.png` before transfer into this retained proof home.
  - `task207-browser-console.txt` records the error-level console check, and `task207-browser-network.txt` records the successful ingest/log requests with no failed non-static product requests.
- Retained-vs-scratch contract: reviewer-facing summaries and screenshots stay in `codeInfoStatus/manual-testing/0000055/`; raw retries, startup transcripts, and failed scratch-path attempts were moved back under ignored `codeInfoTmp/manual-testing/0000055/`.
