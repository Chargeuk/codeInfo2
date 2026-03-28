# Story 0000055 – Users can queue ingest and re-embed requests

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Users can currently start ingest and re-embed work only when the server is idle. If another ingest operation is already running, later requests are rejected as busy instead of being remembered and run in order. This is frustrating for both humans and AI automation because the user must retry later, and a server restart loses the intent to run that work entirely.

This story adds a durable whole-request queue for ingest and re-embed work. The queue is intentionally about request orchestration, not about how one ingest run chunks files or dispatches embeddings internally. When a request arrives, the server should normalize it to the canonical embed target path, store one queue record in MongoDB, and either start it immediately if nothing is active or leave it waiting until earlier queued work finishes.

The queue should use one MongoDB collection for both waiting and currently running items. The currently running item stays in the collection until it reaches a terminal outcome. Once that run completes, the server must remove that queue record before it attempts to start the next oldest item. This ordering matters because a restart should be able to look at the same collection and simply start the oldest remaining item again without relying on a second persistent "in progress" state.

This story also fixes duplicate-request behavior. If a request arrives for a canonical embed target path that is already waiting in the queue, the server should not insert a second queue item. Instead, it should update that existing waiting item's stored settings in place, keep the same queue request id and queue position, return success, and log that the queued work was intentionally updated rather than duplicated. If the matching item is already running, the server should still avoid creating a second queue item, but it should not try to mutate the active run's settings mid-flight. This latest-settings-wins rule for waiting items applies across both start-ingest and re-embed requests once the server has resolved them to the same canonical embed target path.

MongoDB is required for this queue feature. If Mongo is unavailable, queueable ingest and re-embed requests should be rejected before they start. This story does not provide a degraded "run immediately without persistence" mode because that would break the durable queue contract and make restart behavior inconsistent.

Agent and workflow behavior must remain predictable. If a re-embed request is triggered from a flow, command JSON file, or MCP surface that currently waits for terminal completion, that caller should still wait until the queued request actually finishes. Queueing changes how long the caller may need to wait, but it does not change the contract from blocking completion to fire-and-forget.

The frontend must also make queued work visible. When a repository is queued for re-embed, the UI should show that it is queued and show its queue position so the user knows the request was accepted and is waiting its turn. That queue position should count only waiting work, so `1` means “next in line” rather than “behind the currently running item plus everything else.” This should be a stable status in the ingest surfaces, not just a short-lived toast.

The queue is FIFO by creation time. On server startup, if the queue collection contains leftover items and no ingest is already active, the server should attempt to start the oldest remaining item automatically. Because the active item remains in Mongo until terminal completion, this gives the queue at-least-once recovery semantics after restart without needing a second persistent run-state table.

### Acceptance Criteria

- Ingest and re-embed requests use one durable MongoDB queue collection rather than being rejected immediately whenever another ingest run is active.
- Every queueable request is normalized to the canonical embed target path before dedupe and queue insertion decisions are made.
- If MongoDB is unavailable, queueable ingest and re-embed requests are rejected before any new run starts.
- The queue uses one collection for both waiting and currently running items; a running item remains in the collection until terminal completion.
- If no ingest is active when a request is accepted, the server inserts the queue item and then starts that oldest queued item immediately.
- If an ingest is already active when a request is accepted, the server inserts the queue item and leaves it waiting in FIFO order.
- Queue order is FIFO by queue creation time.
- On server startup, if no ingest is active and the queue collection contains leftover items, the server attempts to start the oldest remaining item automatically.
- When an ingest or re-embed run reaches a terminal outcome, the server attempts to delete that queue item before it attempts to start the next queued item.
- If queue-item deletion fails after a terminal run, the server does not start the next queued item until that queue-record removal problem is resolved or retried.
- If a request arrives for a canonical embed target path that is already waiting in the queue, the server does not create a duplicate queue item.
- For a matching waiting queue item, the newer request updates the stored queued settings in place, keeps the same queue request id, and keeps the same queue position.
- If a matching queue item is already running, the server still avoids creating a duplicate queue item, but it does not mutate the active run's settings mid-flight.
- The duplicate-request rule applies across both start-ingest and re-embed requests once they resolve to the same canonical embed target path.
- When a duplicate request is collapsed onto an existing queue item, the server returns success and reuses the existing queue request id instead of returning a duplicate-specific error.
- Queue-aware success responses expose `queued`, `requestId`, and `queuePosition`.
- Queue-aware success responses do not expose a separate `deduped` field in this story.
- For an immediately started request, the success payload includes the queue request id and a non-waiting queue state.
- For a waiting request, the success payload includes `queued: true`, the queue request id, and the current queue position.
- `queuePosition` counts only waiting requests; an already running item uses the non-waiting state instead of reporting itself as queue position `1`.
- Flow, command, and MCP re-embed callers that previously blocked until terminal completion still block until the queued request reaches a terminal outcome.
- Queue wait time is treated as part of the blocking contract for those callers rather than as a reason to return early.
- The frontend ingest surfaces show when a repository is queued for re-embed and show its queue position.
- Queued repository visibility is stable enough that a user can refresh or revisit the ingest page and still see that the request is waiting.
- Existing single-flight ingest execution still applies at runtime: only one ingest or re-embed run is active at a time, even though multiple future requests may now be queued durably.
- The queue request id may use the MongoDB document id generated for that queue item.
- This story does not require queued-but-not-started requests to be removable by the user once they are in the queue.
- Documentation and tests are updated to describe the durable queue contract, dedupe behavior, startup recovery, blocking caller behavior, and frontend queued-state visibility.

### Out Of Scope

- User-driven removal or cancellation of queued-but-not-started requests.
- Priority queues, non-FIFO ordering, or queue reordering controls.
- Multiple concurrent ingest workers processing more than one queued request at once.
- Replacing the existing internal file-chunking and embedding-dispatch optimizations planned elsewhere.
- Adding a degraded mode that still starts queueable requests when MongoDB is unavailable.
- Returning a separate `deduped` response field instead of the queue-oriented response contract defined here.
- Broad redesign of the ingest frontend beyond what is needed to show queued state and queue position.
- Exactly-once execution guarantees across crashes or restarts.

### Additional Repositories

- No Additional Repositories

### Questions

1. If removing the finished queue item fails, should the server keep retrying automatically or stop and wait for a manual fix?
   - Why this is important: The story already says the next queued run must not start before the finished queue record is removed, so we still need to decide whether recovery is automatic or purely manual.
   - Best Answer: Retry deletion automatically with backoff, and keep the queue stalled until that delete succeeds. This is the best fit because transient MongoDB failures should self-heal where possible, while the queue still preserves FIFO ordering and never advances past an uncleared finished item.
   - Where this answer came from: Repo evidence from [planning/0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md) and [server/src/ingest/lock.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/lock.ts), which already frame this story around single-flight ordering and delete-before-next semantics; external evidence from official MongoDB retryable-write guidance showing MongoDB is designed to recover from transient write failures with bounded retries; DeepWiki's BullMQ queue docs, which treat cleanup and stalled-job recovery as automatic retry territory rather than purely manual intervention; and Context7 could not be queried because the workspace quota is exhausted today.

## Decisions

1. Queue position should count only waiting requests.
   - The question being addressed: Should queue position count only waiting requests, or should it also count the request that is already running?
   - Why the question matters: The frontend and API both need one stable meaning for `queuePosition`, especially when one request is already running and another is next in line.
   - What the answer is: Count only waiting requests, so the first waiting job shows `queuePosition: 1`, and an already running job uses the non-waiting state without a queue position.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [planning/0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md), [server/src/routes/ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts), [server/src/routes/ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts), and [server/src/routes/ingestRoots.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestRoots.ts), plus external evidence from DeepWiki's BullMQ docs noting that user-facing queue position is application-level logic built on waiting-versus-active job lists. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It is clearer for users because `1` means “next in line,” and it matches the story's existing rule that immediately started work should return a non-waiting queue state instead of pretending it is still queued.
2. Newer settings should replace older settings for a matching waiting queue item.
   - The question being addressed: If the same repository is already queued with different settings, should the first request stay or should the newer one replace it?
   - Why the question matters: Dedupe by canonical embed path is already part of the story, but we still need one clear rule for conflicting provider or model choices on that same path.
   - What the answer is: If the matching queue item is still waiting, the newer request replaces the stored queued settings in place while keeping the same `requestId` and queue position. If the matching item is already running, the server still avoids creating a second queue item, but it does not mutate the active run's settings mid-flight.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [server/src/routes/ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts), [server/src/routes/ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts), [server/src/ingest/reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts), and [server/src/ingest/ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), plus external evidence from DeepWiki's BullMQ docs showing queues often dedupe on one job identity while the product still chooses how to treat later duplicates. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It lets users correct a queued request without losing its place in line, while still avoiding the higher-risk behavior of trying to rewrite an ingest that has already started.

## Implementation Ideas

- Add one MongoDB collection for queued ingest work, for example `ingest_queue_requests`, with the Mongo `_id` used as the external `requestId`.
- Store enough request data to restart the work after a process restart, including operation type, canonical embed target path, normalized request payload, source surface, and creation time.
- Add a shared `enqueueOrReuseIngestRequest(...)` helper that:
  - resolves the canonical embed target path first;
  - rejects immediately if Mongo is unavailable;
  - updates an existing waiting queue item in place for the same canonical target path while preserving its `requestId` and queue position;
  - reuses an existing running item for the same canonical target path without mutating the active run's settings;
  - otherwise inserts a new queue item and returns its request id.
- Add one shared `pumpIngestQueue()` function that starts the oldest queue item only when the existing in-memory ingest lock is idle.
- Keep the active queue document in Mongo while the run is executing; on terminal completion, delete it first and only then call `pumpIngestQueue()` again.
- Run `pumpIngestQueue()` on server startup so leftover queue entries are resumed automatically in FIFO order.
- Reuse the existing canonical path resolution logic so dedupe is based on the same normalized ingest target the runtime actually uses.
- Update REST ingest/re-embed handlers to return queue-aware success payloads with `queued`, `requestId`, and `queuePosition`.
- Keep `queuePosition` waiting-only, so the next waiting job is `1` and already running work uses the non-waiting queue state instead.
- Update blocking re-embed paths in flows, commands, and MCP so they enqueue or reuse a queue item and then wait for that queued request's terminal outcome instead of returning early.
- Revisit blocking wait timeouts for queue-aware callers because queue delay now becomes part of the contract rather than an error path.
- Extend ingest frontend data contracts so queued repositories can surface a stable `queued` state with queue position in the existing ingest views.
- Add tests for FIFO ordering, duplicate collapse, startup recovery, Mongo-unavailable rejection, delete-before-next ordering, blocking flow/command waits, and frontend queued-state rendering.
