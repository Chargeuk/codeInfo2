# Title

Users can queue ingest and re-embed requests

# Acceptance

1. Users can submit ingest and re-embed requests while another ingest run is active, and the system keeps that work in a durable queue instead of rejecting it as busy.
2. Users can see queued repository work in the ingest repository list, including clear queued state and waiting position before execution starts.
3. Users and automation receive a durable `requestId` for queued work and a `runId` once the queued job actually starts running.
4. Users are protected from unsafe restart or cleanup behavior because the queue retries recovery in order and does not start newer work before blocked cleanup is resolved.
5. Users and automation receive clear retryable queue-backend errors when Mongo-backed queue persistence is unavailable.
6. The remaining review-created work keeps shared reingest callers aligned so pre-run failures stay structured and malformed or blank selectors are rejected before downstream lookup.
7. The story closes only after one final broad server revalidation pass proves the latest review fixes through the repository’s normal supported proof paths.

# Description

This story makes ingest and re-embed work durable, visible, and predictable when the server is already busy. Instead of forcing users or automation to retry later, the system records queued work, shows where it is in line, and starts it safely when earlier work finishes. The remaining planned work is now narrowly focused on one last shared reingest contract repair plus one final broad server revalidation pass so the queue story can close cleanly.

# Tasks

1. [Current Repository] - Add durable queue storage and canonical queue admission.

- Store queueable ingest and re-embed requests in MongoDB and normalize them to one canonical target before dedupe.
- Prove queue persistence, duplicate handling, and queue-unavailable behavior through server proof owners.

2. [Current Repository] - Add queue runtime lifecycle, cleanup ownership, and startup recovery.

- Keep waiting, running, and cleanup-blocked queue states small and explicit.
- Prove delete-before-next ordering, retry behavior, and safe startup recovery.

3. [Current Repository] - Replace queueable REST, MCP, command, and flow contracts.

- Return queue-aware response fields and keep blocking automation behavior intact while queued work waits.
- Prove REST, MCP, command, and flow callers receive the correct queued, running, and unavailable outcomes.

4. [Current Repository] - Show queued work in the shared repository list and ingest UI.

- Update the shared repo-list payload, client normalization, and ingest UI so queued rows and queue position stay visible.
- Prove queued visibility through server, client, and browser proof surfaces.

5. [Current Repository] - Keep queue docs, OpenAPI, cleanup, and retry contracts aligned through review-driven repairs.

- Finish the earlier queue contract fixes around state overlays, cleanup-blocked handling, retryable queue errors, OpenAPI accuracy, and destructive remove authority.
- Keep the maintained proof homes, documentation, and review summaries honest as those repairs land.

6. [Current Repository] - Preserve start-request admission contracts during deferred queue replay.

- Repair replayed queue-start validation so malformed stored request bodies do not bypass the same contract as live start-ingest requests.
- Prove the replay path through the existing queue pump, recovery, and start-ingest proof files.

7. [Current Repository] - Align mixed-shape re-embed validation across REST and shared callers.

- Repair queued re-embed validation so repo-list producers, shared services, REST, and MCP callers classify invalid metadata the same way.
- Prove the producer-consumer contract through the existing re-embed service, route, and tool proof surfaces.

8. [Current Repository] - Enforce exact remove selectors before target-first queue blocking.

- Tighten production remove handling so alias-shaped selectors are rejected before queue-state blocking logic runs.
- Prove exact selector handling and target-first blocking through route and integration proof owners.

9. [Current Repository] - Restore shared pre-run reingest caller contracts from the latest review pass.

- Repair the shared reingest service seam so pre-run `OPENAI_MODEL_UNAVAILABLE` stays structured for MCP, commands, flows, and REST callers.
- Reject malformed, unsupported, blank, or whitespace-only `sourceId` input before repo-list lookup can hide the expected `INVALID_PARAMS` contract.

10. [Current Repository] - Re-validate Story 55 after the latest review-created findings block.

- Run the final broad server build, unit, cucumber, compose smoke, lint, and format proof for the latest review-created findings block.
- Refresh the closing summary so the final review fixes, proof homes, and non-applicable proof categories are recorded together before close-out.
