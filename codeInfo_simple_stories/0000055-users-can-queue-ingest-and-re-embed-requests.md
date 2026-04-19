# Title

Users can queue ingest and re-embed requests safely and see trustworthy queued progress

# Acceptance

1. Workflow users can submit ingest and re-embed requests even when another run is already active, and that work is queued instead of being lost.
2. Workflow users can trust queued and startup-recovered re-embed work to follow the same validation rules as immediate requests, even after restart or deferred replay.
3. Workflow users can see accurate queued repository state and structured diagnostics across the shared repository-list surfaces.
4. Workflow users can rely on stricter request validation so malformed queueable inputs and non-canonical selectors are rejected instead of being accepted accidentally.
5. Workflow users benefit from safer large delete-path cleanup during delta re-embed work, so large repository changes do not depend on one unbounded selector.
6. Support and engineering users can re-validate the repaired story through the repository's wrapper-first server and compose proof paths, with an updated reviewer summary that records what was rerun.

# Description

This story lets people queue ingest and re-embed work while keeping the queue reliable, visible, and safe. The latest review pass reopened the story to harden deferred replay, shared queue diagnostics, trust-boundary validation, and large cleanup behavior so queued work behaves consistently whether it starts immediately, waits in line, or resumes after restart. When this work is complete, the queueing feature will remain easier for users to trust because accepted requests, queued visibility, and recovery behavior will all stay aligned.

# Tasks

1. [codeInfo2] - Restore deferred queue replay validation parity.

- Update the replay seam in `server/src/ingest/ingestJob.ts` so queued promotion and startup recovery fail closed on invalid root-state or malformed persisted embedding fields.
- Extend the replay proof owners in `server/src/test/unit/`, `server/src/test/integration/`, and `server/src/test/features/ingest-reembed.feature`.

2. [codeInfo2] - Repair shared repo-list queue compatibility and diagnostics.

- Update `server/src/lmstudio/toolService.ts` and the related route and MCP readers so waiting rows preserve normalized provider and model data.
- Extend the repo-list proof owners in `server/src/test/unit/` and `server/src/test/features/ingest-roots.feature` so structured ingest-origin errors stay visible.

3. [codeInfo2] - Re-tighten queueable input trust boundaries.

- Update `server/src/routes/ingestReembed.ts`, `server/src/ingest/reingestService.ts`, and `server/src/ingest/requestContracts.ts` so non-canonical selectors and malformed configured workdirs fail cleanly.
- Extend the trust-boundary proof owners in `server/src/test/unit/`, `server/src/test/integration/ingest-reembed.test.ts`, and the ingest feature files.

4. [codeInfo2] - Bound large delta re-embed delete selectors.

- Update `server/src/mongo/repo.ts` and the delete path in `server/src/ingest/ingestJob.ts` so large rel-path cleanup uses an explicit bounded batching rule.
- Extend the delete-path proof owners in `server/src/test/unit/` and `server/src/test/features/ingest-delta-reembed.feature`.

5. [codeInfo2] - Restore honest BDD phase boundaries for delta re-embed.

- Update `server/src/test/steps/ingest-delta-reembed.steps.ts` and `server/src/test/features/ingest-delta-reembed.feature` so state-changing work lives in setup or action steps instead of assertion steps.
- Keep the scenario proving the same missing-`ingest_files` behavior while making the feature wording and step ownership honest.

6. [codeInfo2] - Re-validate the repaired story and refresh the reviewer summary.

- Update `codeInfoStatus/pr-summaries/0000055-pr-summary.md` with the repaired proof homes and the current review-pass close-out notes.
- Re-run the wrapper-first server and compose validation path defined in the main plan before closing the story again.
