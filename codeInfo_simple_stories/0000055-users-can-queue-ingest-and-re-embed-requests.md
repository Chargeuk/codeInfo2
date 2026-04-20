# Title

Users can queue ingest and re-embed requests

# Acceptance

1. Users can submit queued ingest and re-embed work without creating duplicate waiting jobs for the same repository target.
2. Users can trust queued cleanup failures to stay visibly blocked instead of being reported as successful when required cleanup did not finish.
3. Users get honest validation at the point they submit re-embed work, including correct rejection when a locked model is unavailable.
4. Users see stable queued and running repository rows on `/ingest`, including correct row identity during queued-to-running handoff.
5. Queue-driven runtime and MCP request handling stay trustworthy because malformed request shapes and request-completion boundaries are proved through the supported automated paths.
6. Support and engineering users can revalidate the repaired story with the repository's normal wrapper-first build, test, client, e2e, and compose smoke flows.

# Description

This story lets people queue ingest and re-embed work safely while keeping the queue results honest and visible. The latest review pass reopened the story to tighten duplicate waiting-job updates, cleanup-blocked handling, submission-time validation, repository-list identity, queue-runtime proof ownership, and classic MCP input validation. When this work is complete, queued work will be easier to trust because accepted requests, blocked cleanup, browser-visible queue rows, and automated proof will all stay aligned.

# Tasks

1. [codeInfo2] - Repair cross-operation waiting queue rewrite parity.

- Update `server/src/ingest/requestQueue.ts` so a waiting `start` row can be rewritten in place by a later `reembed` request for the same canonical target.
- Extend the queue-owner and route-owner proof files in `server/src/test/unit/ingest-request-queue.test.ts`, `ingest-start.test.ts`, and `ingest-reembed.test.ts`.

2. [codeInfo2] - Repair deletions-only cleanup-blocked fast-path behavior.

- Update `server/src/ingest/ingestJob.ts` so delete-only delta re-embed work publishes the shared `cleanup-blocked` state instead of a false success when persisted cleanup degrades.
- Extend the proof owners in `server/src/test/unit/ingest-reembed.test.ts`, `ingest-files-repo-guards.test.ts`, and `ingest-queue-runtime-terminal.test.ts`.

3. [codeInfo2] - Restore honest admission-time `/ingest/reembed` validation.

- Update `server/src/routes/ingestReembed.ts` and `server/src/ingest/reingestService.ts` so locked-model admission failures are rejected at the real route boundary before queue acceptance.
- Extend the route-owner proof files in `server/src/test/integration/openai-model-unavailable-contract.test.ts`, `ingest-reembed.test.ts`, and `ingest-failure-logging-coverage.test.ts`.

4. [codeInfo2] - Restore direct `/ingest/roots` proof and canonical row identity.

- Update `server/src/routes/ingestRoots.ts`, `client/src/hooks/useIngestRoots.ts`, and the related cucumber and e2e proof owners so stable row identity wins over runtime-only metadata.
- Extend the browser-visible proof in `e2e/ingest.spec.ts` plus the server and client proof files that own queued and cleanup-blocked row visibility.

5. [codeInfo2] - Re-anchor queue-runtime proof owners on the request-aware wait boundary.

- Update the shared helper in `server/src/test/unit/ingest-queue-runtime.helpers.ts` so request-aware completion replaces polling as the main proof boundary.
- Extend the affected queue-runtime proof files in `server/src/test/unit/` and `server/src/test/integration/ingest-reembed-invalid-state.test.ts`.

6. [codeInfo2] - Reject malformed classic MCP arguments before domain validation.

- Update `server/src/mcp/server.ts` so non-object `arguments` payloads are rejected at the dispatcher boundary instead of being coerced into an empty object.
- Extend the classic MCP proof owner in `server/src/test/unit/mcp.reingest.classic.test.ts` for malformed-shape and retained happy-path behavior.

7. [codeInfo2] - Revalidate the review-created repair block and refresh the close-out summary.

- Update `codeInfoStatus/pr-summaries/0000055-pr-summary.md` so it cites the repaired proof homes and distinguishes fresh reruns from retained earlier evidence.
- Re-run the repository's wrapper-first server, client, e2e, and compose smoke paths before closing the story again.
