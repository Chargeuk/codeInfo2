# Story 0000055 – Users can queue ingest and re-embed requests

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Users can currently start ingest and re-embed work only when the server is idle. If another ingest operation is already running, later requests are rejected as busy instead of being remembered and run in order. This is frustrating for both humans and AI automation because the user must retry later, and a server restart loses the intent to run that work entirely.

This story adds a durable whole-request queue for ingest and re-embed work. The queue is intentionally about request orchestration, not about how one ingest run chunks files or dispatches embeddings internally. When a request arrives, the server should normalize it to the canonical embed target path, store one queue record in MongoDB, and either start it immediately if nothing is active or leave it waiting until earlier queued work finishes.

Queue-aware success responses now need two identifiers with different jobs. `requestId` is the durable queue identifier for the queued request itself. `runId` remains the runtime ingest identifier once work has actually started. A waiting item can therefore return `requestId` without an active `runId` yet, while an immediately started or later-started item can expose both.

The queue should use one MongoDB collection for both waiting and currently running items. The currently running item stays in the collection until it reaches a terminal outcome. Once that run completes, the server must remove that queue record before it attempts to start the next oldest item. If that delete fails, the server should log an error, surface an error state in the frontend, and keep retrying the delete with backoff while the queue remains stalled. This ordering matters because a restart should be able to look at the same collection and simply start the oldest remaining item again without relying on a second persistent "in progress" state.

This story also fixes duplicate-request behavior. If a request arrives for a canonical embed target path that is already waiting in the queue, the server should not insert a second queue item. Instead, it should update that existing waiting item's stored settings in place, keep the same queue request id and queue position, return success, and log that the queued work was intentionally updated rather than duplicated. If the matching item is already running, the server should still avoid creating a second queue item, but it should not try to mutate the active run's settings mid-flight. This latest-settings-wins rule for waiting items applies across both start-ingest and re-embed requests once the server has resolved them to the same canonical embed target path.

MongoDB is required for this queue feature. If Mongo is unavailable, queueable ingest and re-embed requests should be rejected before they start. This story does not provide a degraded "run immediately without persistence" mode because that would break the durable queue contract and make restart behavior inconsistent.

Agent and workflow behavior must remain predictable. If a re-embed request is triggered from a flow, command JSON file, or MCP surface that currently waits for terminal completion, that caller should still wait until the queued request actually finishes. Queueing changes how long the caller may need to wait, but it does not change the contract from blocking completion to fire-and-forget. The preferred server behavior is event-driven waiting for the queue item and ingest run to reach a terminal state, not a short fixed timeout loop. A much longer safety timeout can still exist as a final guard for broken listeners or lost state, but it should not be the normal reason a correctly queued request fails.

The frontend must also make queued work visible. When a repository is queued for re-embed, the UI should show that it is queued and show its queue position so the user knows the request was accepted and is waiting its turn. That queue position should count only waiting work, so `1` means “next in line” rather than “behind the currently running item plus everything else.” The repository list is the required source of truth for this state; this story does not need a separate top-of-page queue card. If a brand-new repository is queued before it has ever been ingested, the repository list should synthesize a temporary row right away so queued start-ingest work is visible there too. This should be a stable status in the ingest surfaces, not just a short-lived toast.

The queue is FIFO by creation time. On server startup, if the queue collection contains leftover items and no ingest is already active, the server should first retry or resolve any cleanup-blocked queue item that previously failed deletion, and only then attempt to start the oldest remaining waiting item automatically. Because the active item remains in Mongo until terminal completion, this gives the queue at-least-once recovery semantics after restart without needing a second persistent run-state table.

### Acceptance Criteria

- Ingest and re-embed requests use one durable MongoDB queue collection rather than being rejected immediately whenever another ingest run is active.
- Every queueable request is normalized to the canonical embed target path before dedupe and queue insertion decisions are made.
- If MongoDB is unavailable, queueable ingest and re-embed requests are rejected before any new run starts.
- When MongoDB is unavailable, queueable ingest and re-embed requests return a clear retryable `QUEUE_UNAVAILABLE` error rather than a generic server failure.
- The queue uses one collection for both waiting and currently running items; a running item remains in the collection until terminal completion.
- If no ingest is active when a request is accepted, the server inserts the queue item and then starts that oldest queued item immediately.
- If an ingest is already active when a request is accepted, the server inserts the queue item and leaves it waiting in FIFO order.
- Queue order is FIFO by queue creation time.
- On server startup, if no ingest is active and the queue collection contains leftover items, the server attempts to start the oldest remaining item automatically.
- When an ingest or re-embed run reaches a terminal outcome, the server attempts to delete that queue item before it attempts to start the next queued item.
- If queue-item deletion fails after a terminal run, the server logs an error, shows an error state in the frontend, retries the delete with backoff, and does not start the next queued item until that queue-record removal problem is resolved.
- If a request arrives for a canonical embed target path that is already waiting in the queue, the server does not create a duplicate queue item.
- For a matching waiting queue item, the newer request updates the stored queued settings in place, keeps the same queue request id, and keeps the same queue position.
- If a matching queue item is already running, the server still avoids creating a duplicate queue item, but it does not mutate the active run's settings mid-flight.
- The duplicate-request rule applies across both start-ingest and re-embed requests once they resolve to the same canonical embed target path.
- When a duplicate request is collapsed onto an existing queue item, the server returns success and reuses the existing queue request id instead of returning a duplicate-specific error.
- Queue-aware success responses expose `queued`, `requestId`, and `queuePosition`.
- `requestId` is the durable queue identifier for this story.
- `runId` remains the active ingest-run identifier once work has actually started.
- Queue-aware success responses do not expose a separate `deduped` field in this story.
- For an immediately started request, the success payload includes the queue request id, the active `runId`, and a non-waiting queue state.
- For a waiting request, the success payload includes `queued: true`, the queue request id, the current queue position, and no active `runId` yet.
- `queuePosition` counts only waiting requests; an already running item uses the non-waiting state instead of reporting itself as queue position `1`.
- Flow, command, and MCP re-embed callers that previously blocked until terminal completion still block until the queued request reaches a terminal outcome.
- Queue wait time is treated as part of the blocking contract for those callers rather than as a reason to return early.
- The preferred blocking path waits for real queue-item or ingest completion events rather than relying on a short fixed timeout as the normal control mechanism.
- A much longer safety timeout may still exist as a final guard, but it is not the normal success path for correctly queued work.
- The frontend ingest surfaces show when a repository is queued for re-embed and show its queue position in the repository list.
- If a brand-new repository is queued before its first ingest run starts, the repository list still shows a temporary queued row right away.
- Queued repository visibility is stable enough that a user can refresh or revisit the ingest page and still see that the request is waiting.
- Existing single-flight ingest execution still applies at runtime: only one ingest or re-embed run is active at a time, even though multiple future requests may now be queued durably.
- The queue request id may use the MongoDB document id generated for that queue item.
- On startup, cleanup-blocked queue items are retried or resolved before the server starts any newer waiting item.
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
- Adding a dedicated top-of-page queue card for queued re-embed work.
- Exactly-once execution guarantees across crashes or restarts.

### Additional Repositories

- No Additional Repositories

### Questions

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
3. Finished queue-item deletion should retry automatically and surface an error.
   - The question being addressed: If removing the finished queue item fails, should the server keep retrying automatically or stop and wait for a manual fix?
   - Why the question matters: The story already says the next queued run must not start before the finished queue record is removed, so we still need to decide whether recovery is automatic or purely manual and how visible that failure is to users.
   - What the answer is: Retry deletion automatically with backoff, keep the queue stalled until that delete succeeds, log an error, and show an error state in the frontend while the queue is blocked.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [planning/0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md) and [server/src/ingest/lock.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/lock.ts), plus external evidence from official MongoDB retryable-write guidance showing MongoDB is designed to recover from transient write failures with bounded retries and DeepWiki's BullMQ queue docs, which treat cleanup and stalled-job recovery as automatic retry territory rather than purely manual intervention. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It preserves FIFO correctness, self-heals common transient failures, and still gives both operators and users a clear signal that the queue is blocked on cleanup rather than silently appearing idle.
4. Queue responses should keep both `requestId` and `runId`.
   - The question being addressed: Should queue responses keep `runId`, or should `requestId` be the only ID?
   - Why the question matters: Today the ingest routes, polling, and tests all work through `runId`, but this story adds a durable `requestId` for queued work.
   - What the answer is: Keep both. `requestId` is the durable queue identifier, and `runId` remains the active ingest identifier once work has actually started. A waiting item can therefore return `requestId` with no active `runId` yet.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [server/src/routes/ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts), [server/src/routes/ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts), [server/src/ingest/reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts), [client/src/components/ingest/IngestForm.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/IngestForm.tsx), and the current ingest step definitions under [server/src/test/steps](/home/d_a_s/code/codeInfo2/server/src/test/steps), plus external evidence from BullMQ docs on unique job IDs and DeepWiki queue guidance around waiting vs active job state. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It preserves existing active-run tooling while still giving queued work its own durable identifier.
5. Queued re-embed state should live in the repository list, not a new queue card.
   - The question being addressed: Should queued re-embed status show in the repository list only, or also in a top-of-page queue card?
   - Why the question matters: The story already says queued state must survive refresh, but we still need one clear primary UI surface so the frontend contract does not sprawl.
   - What the answer is: Make the repository list the required source of truth and keep a dedicated top-of-page queue card out of scope for this story.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [client/src/pages/IngestPage.tsx](/home/d_a_s/code/codeInfo2/client/src/pages/IngestPage.tsx), [client/src/hooks/useIngestRoots.ts](/home/d_a_s/code/codeInfo2/client/src/hooks/useIngestRoots.ts), [client/src/hooks/useIngestStatus.ts](/home/d_a_s/code/codeInfo2/client/src/hooks/useIngestStatus.ts), and [client/src/components/ingest/RootsTable.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/RootsTable.tsx), plus external evidence from BullMQ docs and DeepWiki guidance distinguishing waiting jobs from active jobs and describing queue position as application-level state derived from waiting jobs. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: The repository row already matches the re-embed target, survives refresh naturally, and avoids expanding the UI scope with a second special-purpose queue surface.
6. Flows, commands, and MCP should wait through the queue by default.
   - The question being addressed: Should flows, commands, and MCP wait through the whole queue, or fail after a short timeout?
   - Why the question matters: The story says these callers should still block until completion, but the current re-embed service only waits about 90 seconds before giving up.
   - What the answer is: These callers should wait through the whole queue and the actual ingest run. The preferred implementation is event-driven waiting for queue-item and ingest completion, with only a much longer safety timeout as a final guard rather than as the normal control path.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [server/src/ingest/reingestService.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestService.ts), [server/src/ingest/reingestExecution.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/reingestExecution.ts), [server/src/flows/service.ts](/home/d_a_s/code/codeInfo2/server/src/flows/service.ts), and [server/src/mcp/server.ts](/home/d_a_s/code/codeInfo2/server/src/mcp/server.ts), which show the current blocking contract and its short wait budget; external evidence from DeepWiki's BullMQ documentation on `waitUntilFinished`-style blocking and the distinction between queue delay and actual execution; Context7 could not be queried because the workspace quota is exhausted today; and web search evidence from official BullMQ docs describing waiting vs active states and how active work continues until it completes.
   - Why it is the best answer: Queue delay becomes normal behavior in this story, so callers should not fail just because they had to wait their turn. Event-driven waiting also matches the real completion model better than treating a short timeout as the primary control mechanism.
7. A brand-new queued repository should appear in the repository list right away.
   - The question being addressed: If a brand-new repository is queued, should the repository list show a temporary row right away, or wait until the run starts?
   - Why the question matters: The repository list is now the required queued-state surface, but a brand-new start-ingest request may not have an existing repository row yet.
   - What the answer is: Show a temporary row right away so queued start-ingest work is visible in the same repository-list surface as queued re-embed work.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [client/src/pages/IngestPage.tsx](/home/d_a_s/code/codeInfo2/client/src/pages/IngestPage.tsx), [client/src/hooks/useIngestRoots.ts](/home/d_a_s/code/codeInfo2/client/src/hooks/useIngestRoots.ts), [client/src/components/ingest/RootsTable.tsx](/home/d_a_s/code/codeInfo2/client/src/components/ingest/RootsTable.tsx), and [server/src/lmstudio/toolService.ts](/home/d_a_s/code/codeInfo2/server/src/lmstudio/toolService.ts), plus external evidence from DeepWiki's BullMQ guidance on exposing waiting items before they become active. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It keeps the repository list as the single source of truth, avoids inventing a second queued-state surface, and gives immediate visible confirmation that a brand-new ingest request was accepted.
8. Startup recovery should clear cleanup-blocked items before newer waiting work.
   - The question being addressed: When the server restarts, should cleanup-blocked items be fixed before any new queued work starts?
   - Why the question matters: The story already says delete failures block the queue, but startup recovery still needs one clear rule about whether blocked cleanup or fresh queued work goes first after a restart.
   - What the answer is: Retry or resolve cleanup-blocked items first, and only start the next waiting request after that blocked state is cleared.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [planning/0000055-users-can-queue-ingest-and-re-embed-requests.md](/home/d_a_s/code/codeInfo2/planning/0000055-users-can-queue-ingest-and-re-embed-requests.md), [server/src/ingest/lock.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/lock.ts), and [server/src/index.ts](/home/d_a_s/code/codeInfo2/server/src/index.ts), plus external evidence from DeepWiki's BullMQ recovery guidance on stalled and leftover jobs. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It preserves FIFO behavior and prevents the queue from silently advancing past a record that was explicitly meant to stall progress.
9. Mongo outages should return a clear retryable `QUEUE_UNAVAILABLE` error.
   - The question being addressed: If Mongo is unavailable, should queue requests return a clear retryable `QUEUE_UNAVAILABLE` error?
   - Why the question matters: The story already says these requests must be rejected when Mongo is down, but it still does not pin down a client-visible error contract that tells users and agents nothing started.
   - What the answer is: Return a clear retryable `QUEUE_UNAVAILABLE` error, preferably as a temporary-service response rather than a generic server failure.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [server/src/routes/ingestStart.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestStart.ts), [server/src/routes/ingestReembed.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestReembed.ts), [server/src/ingest/requestContracts.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/requestContracts.ts), and [server/src/mongo/connection.ts](/home/d_a_s/code/codeInfo2/server/src/mongo/connection.ts), plus external evidence from RFC 9110 guidance on `503 Service Unavailable` and retryability and DeepWiki queue guidance on backend-unavailable retries. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It clearly tells callers the queue backend is temporarily unavailable, nothing ran, and retrying later is reasonable.

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
- If finished queue-item deletion fails, log the failure, expose a frontend-visible blocked error state, and retry deletion with backoff before allowing the queue to advance.
- Run `pumpIngestQueue()` on server startup so leftover queue entries are resumed automatically in FIFO order.
- Reuse the existing canonical path resolution logic so dedupe is based on the same normalized ingest target the runtime actually uses.
- Update REST ingest/re-embed handlers to return queue-aware success payloads with `queued`, `requestId`, and `queuePosition`.
- Keep `requestId` as the durable queue identifier while still returning `runId` once work has actually started.
- Keep `queuePosition` waiting-only, so the next waiting job is `1` and already running work uses the non-waiting queue state instead.
- Update blocking re-embed paths in flows, commands, and MCP so they enqueue or reuse a queue item and then wait for that queued request's terminal outcome instead of returning early.
- Prefer an event-driven completion wait for queue-aware callers so queue delay and actual ingest completion are treated as normal blocking behavior rather than a short timeout race.
- Keep only a much longer safety timeout around that event-driven wait so broken listeners or lost in-memory state still fail eventually instead of hanging forever.
- Extend ingest frontend data contracts so queued repositories can surface a stable `queued` state with queue position in the repository list without adding a separate queue card.
- Synthesize a temporary repository-list row for brand-new queued start-ingest requests so the repository list remains the only required queued-state surface.
- On startup, resolve any cleanup-blocked queue record before starting newer waiting work so restart behavior preserves the same stall semantics as a live server.
- Return a clear retryable `QUEUE_UNAVAILABLE` error contract when Mongo-backed queue persistence is unavailable so clients and agents can distinguish temporary queue outages from generic failures.
- Add tests for FIFO ordering, duplicate collapse, startup recovery, Mongo-unavailable rejection, delete-before-next ordering, blocking flow/command waits, and frontend queued-state rendering.
