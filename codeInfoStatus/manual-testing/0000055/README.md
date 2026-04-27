# Story 0000055 Retained Proof Contract

Story 55 keeps a bounded tracked proof home in `codeInfoStatus/manual-testing/0000055/` and moves raw runtime bulk into ignored `codeInfoTmp/manual-testing/0000055/`.

## Tracked Surfaces

- `README.md`
  - Role: contract and retained-file inventory for Story 55 manual proof.
  - Readers: `planning/0000055-users-can-queue-ingest-and-re-embed-requests.md`, `codeInfoTmp/reviews/0000055-20260427T065706Z-15b0a653-findings.md`, and `codeInfoStatus/pr-summaries/0000055-pr-summary.md`.
- `task204-*.json`, `task204-*.txt`, `task204-*.status`
  - Role: the final retained Task 204 reviewer-facing summaries for the latest pre-review-cycle full-story manual proof.
  - Writers: the Task 204 manual proof pass and its closeout export step.
  - Readers: the Task 204 implementation note, Task 206 retained-proof contract repair, and Task 207 final revalidation closeout.
- `task207-*.json`, `task207-*.txt`, `task207-*.png`, `task207-manual-proof-summary.md`
  - Role: the final retained Task 207 full-story manual-proof summaries for the active review-cycle closeout.
  - Writers: the Task 207 manual proof pass and its retained-proof export step.
  - Readers: the Task 207 implementation note, the Story 55 plan closeout, and later reviewer verification of the final queue-behavior proof.

## Ignored Raw Proof Home

- Raw runtime artifacts now live under `codeInfoTmp/manual-testing/0000055/`, including the `rehomed-from-codeInfoStatus/` subtree created by Task 206.
- That ignored proof home is where future manual-proof writers should stage screenshots, log tails, browser captures, compose transcripts, payload dumps, and other transient bulk before any later task explicitly promotes a sanitized summary into Git.

## Cleanup Ownership

- Cleanup owner for transient runtime bulk: the task or manual-proof pass that generated it.
- Promotion owner for any future tracked file: the current plan task that explicitly names a reviewer-facing retained artifact and updates the plan, findings artifact, and PR summary to match.

## Retained Inventory After Task 206

- `README.md`
- `task204-classic-invalid-params.json`
- `task204-compose-build.txt`
- `task204-compose-down-live.txt`
- `task204-compose-down-pre.txt`
- `task204-compose-up.txt`
- `task204-cucumber-model-unavailable-summary.txt`
- `task204-health.json`
- `task204-mcpv2-initialize.json`
- `task204-mcpv2-invalid-params.json`
- `task204-mcpv2-tools-list.json`
- `task204-pr-summary.txt`
- `task204-rest-whitespace-root.json`
- `task204-rest-whitespace-root.status`
- `task204-review-disposition-state.json`
- `task204-task203-parser.json`
- `task204-task204-parser.json`

## Additional Retained Proof From Task 207

- `task207-active-status-sequential.json`
- `task207-browser-console.txt`
- `task207-browser-network.txt`
- `task207-drain-wait.json`
- `task207-health.json`
- `task207-ingest-queued-details.png`
- `task207-ingest-queued-row.png`
- `task207-manual-proof-summary.md`
- `task207-queue-roots-focused.json`
- `task207-sequential-start-summary.json`
