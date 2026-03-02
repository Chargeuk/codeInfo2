# Story 0000038 – Agent UX Unblocking, Reliable Stop, and Ingest Visibility + Blocking MCP Re-embed

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Users currently experience several workflow breaks in Agents and Ingest behavior that make the product harder to use and make AI automation less reliable.

From a user perspective, when an agent is actively running, the UI currently blocks too much interaction: users cannot draft the next instruction or switch conversation context in the sidebar. This causes unnecessary waiting and makes multi-conversation workflows feel stuck. The desired behavior is to keep submit/send actions disabled while a run is active, but still let users type and navigate conversations.

Stopping an active agent run is also not reliable enough for command-list/json command executions. Users can press Stop and still observe retries continuing for prior command steps. This undermines trust in the stop control and causes extra unwanted agent work.

On the ingest side, AI-facing behavior needs to be deterministic and simple. The MCP re-embed tool currently returns quickly with a started run id, but not completion, which can cause an AI agent to assume ingest has finished when it has not. For this story, MCP re-embed must block until completion, with no optional toggle parameters, and this must apply consistently across both MCP surfaces exposed by the app. Keep-alive heartbeats should continue to be used so long-running calls remain healthy.

Repository visibility during ingest is also incomplete. Repositories being ingested/re-embedded can disappear from both the Ingest page list and MCP classic `ListIngestedRepositories` listing while processing, which leads users and AIs to believe the repository does not exist. The desired behavior is to always include such repositories with a visible ingest status (for example `ingesting`) in both UI and MCP responses.

Finally, re-embed no-op behavior and status semantics need tightening. Successful ingest/re-ingest outcomes should always end in `completed`, including no-change and deletion-only paths. The “no files changed” decision should happen earlier so that no embedding work and no AST parsing/writing occurs when there are no changes, giving a fast early return.

For this story, "deterministic" means:

- No ambiguous terminal state is returned to callers.
- No hidden timing race can cause extra command retries/steps after Stop has been requested.
- Both MCP surfaces exposed by this app return the same terminal contract fields for the same terminal outcome.

This story is intentionally scoped as a contract-alignment story across existing surfaces (Agents UI, ingest REST/WS state, and MCP classic/v2) without introducing new protocols. It is broad in affected files but narrow in behavior: make existing operations predictable and consistent, not feature-expand them.

### Acceptance Criteria

1. While an Agents run is active, the instruction input remains editable and preserves typed text, but all submit/execute actions remain disabled until that run reaches a terminal state.
2. While an Agents run is active, the conversation sidebar remains clickable and switching conversations still works; no run-state overlay blocks navigation.
3. After the user clicks Stop for a command-list/json command run, no new command step may start and no retry may be scheduled from that point onward.
4. The Stop guarantee in criterion 3 also holds when Stop is clicked before an inflight run identifier is available (timing race case).
5. `reingest_repository` behaves as blocking by contract on both MCP surfaces in this app (classic MCP and MCP v2): one tool response is returned only after terminal completion (`completed`, `cancelled`, or `error`).
6. The blocking behavior in criterion 5 is not configurable in this story: no `wait`, `blocking`, or similar request flags are added.
7. Existing keep-alive heartbeat behavior continues to run during the blocking wait so long-running MCP calls do not time out before terminal response.
8. The final blocking MCP response never uses a `started` status and never represents a non-terminal/in-progress state.
9. The final blocking MCP response is summary-only terminal data and does not include per-phase progress streams, progress snapshots, or a top-level `message` field.
10. If a user cancels the same ingest run from the web GUI while MCP is waiting, MCP returns a normal terminal tool result with `status: cancelled` (not a JSON-RPC error payload).
11. During an active ingest/re-embed run, the repository remains visible in the Ingest page list with coarse status `ingesting`.
12. During an active ingest/re-embed run, the repository remains visible in MCP classic `ListIngestedRepositories` listing with coarse status `ingesting`.
13. During active ingest/re-embed, active-status overlays are merged with last completed ingest metadata; last completed metadata is not dropped simply because a run is currently active.
14. For active ingest/re-embed states, the detailed `phase` field is restricted to `queued`, `scanning`, or `embedding`.
15. For terminal states (`completed`, `cancelled`, `error`), `phase` is omitted from payloads (not null/empty string).
16. Any successful ingest/re-ingest run returns terminal status `completed` regardless of path (full embed, no-change early return, deletion-only path, or mixed delta path).
17. No-change decision is made before AST parsing and before embedding work; when no files changed, the run exits without AST parse/upsert/delete and without embedding calls.
18. Final blocking MCP terminal payload includes the following top-level fields for all terminal statuses: `status`, `operation`, `runId`, `sourceId`, `durationMs`, `files`, `chunks`, `embedded`, `errorCode`.
19. Field constraints for criterion 18:

- `status`: one of `completed`, `cancelled`, `error`
- `operation`: literal `reembed`
- `errorCode`: `null` unless `status=error`
- `files`, `chunks`, `embedded`: numeric counters; for `cancelled`, last-known values are returned when available

20. MCP classic and MCP v2 return the same field names and status semantics for the same `reingest_repository` terminal outcome.
21. Automated tests are added/updated for each behavior above across client and server, including MCP classic + MCP v2 parity and no-change early-return coverage.
22. Documentation is updated to reflect final behavior: reliable Stop semantics, blocking MCP re-embed contract, in-progress repository visibility, and no-change early return.
23. Stop race behavior is conversation-authoritative: even when `abortInflight` cannot find the inflight id, command execution abort is still attempted by `conversationId`, and no further command retries/steps execute after Stop is requested.
24. Reingest error envelope boundary is explicit:

- pre-run validation failures (for example invalid `sourceId`, unknown root, or ingest lock already busy before run start) continue to use JSON-RPC error envelopes;
- once a run has started and MCP is waiting, terminal outcomes return via the terminal result payload contract (`completed` | `cancelled` | `error`) instead of protocol error envelopes.

25. External ingest status mapping is explicit across UI/REST/MCP listings:

- internal `queued|scanning|embedding` maps to `status: ingesting` plus `phase` with the same value;
- internal terminal `completed|cancelled|error` maps to the same `status` and omits `phase`;
- internal `skipped` is not emitted externally and is normalized to external `status: completed`.

26. Active overlay precedence is explicit: when a run is active, overlay fields (`status`, `phase`, live counters, active `runId`) come from active runtime status, while last completed metadata (`lastIngestAt`, lock/model metadata, last terminal error context) remains from persisted root metadata unless replaced by a newer terminal write.
27. If persisted root metadata is temporarily absent during re-embed but an active run exists for that root path/sourceId, listings still include that repository using a synthesized entry plus active overlay fields.
28. `/ingest/roots` and MCP `ListIngestedRepositories` both emit `schemaVersion: "0000038-status-phase-v1"` after this story change.

## Message Contracts And Storage Shapes

Validated from repository code contracts and dependency manifests on 2026-03-02, with external protocol/library assumptions cross-checked against official documentation links listed in this story.

### Contract Changes Required

1. MCP tool `reingest_repository` success result (classic MCP and MCP v2):
   - Change from immediate non-terminal payload:
     - `{ status: "started", operation: "reembed", runId, sourceId }`
   - To terminal-only payload:
     - `status: "completed" | "cancelled" | "error"`
     - `operation: "reembed"`
     - `runId: string`
     - `sourceId: string`
     - `durationMs: number`
     - `files: number`
     - `chunks: number`
     - `embedded: number`
     - `errorCode: string | null` (`null` unless `status="error"`)
   - Pre-run validation errors remain protocol-level JSON-RPC errors (`INVALID_PARAMS`, `NOT_FOUND`, `BUSY`) and are not converted in this story.
   - Transport wrapper stays unchanged on both MCP surfaces:
     - JSON-RPC `result.content[0].text` continues to carry a JSON string;
     - the JSON string payload must match the terminal contract above.

2. Repository listing payloads (`/ingest/roots` and MCP `ListIngestedRepositories`):
   - Introduce explicit external run-state fields for both surfaces with consistent semantics:
     - `status: "ingesting" | "completed" | "cancelled" | "error"`
     - `phase?: "queued" | "scanning" | "embedding"` (present only when `status="ingesting"`)
   - Surface-specific shape rule:
     - `/ingest/roots`: keep existing `status` field name but change its emitted value semantics to the external model above.
     - MCP classic `ListIngestedRepositories`: add new `status` and optional `phase` fields to each repo entry.
   - Active overlay fields come from runtime status (`status`, `phase`, live counters, active `runId`) while last completed metadata remains from persisted roots metadata.
   - Internal terminal `skipped` is not emitted externally; map it to external `status: "completed"`.
   - `phase` is omitted (not null/empty) for terminal statuses.
   - Minimum synthesized listing entry fields when persisted metadata is missing:
     - identity/path: `id`, `containerPath`, `hostPath` (and `hostPathWarning` when mapping cannot resolve host path cleanly);
     - run state: `status`, optional `phase`, `runId`, live counters when available;
     - model/lock metadata: preserve last known values when available, otherwise emit empty/default-safe values already accepted by the current contract.

3. Schema version signaling:
   - Bump ingest listing `schemaVersion` (shared constant used by `/ingest/roots` and MCP classic `ListIngestedRepositories`) to represent status/phase contract expansion.
   - Target schema version for this story: `0000038-status-phase-v1`.

### Contracts That Stay Unchanged

- WS ingest event envelope remains unchanged:
  - `ingest_snapshot` / `ingest_update` with `status: IngestJobStatus | null`.
- MCP keep-alive transport behavior remains unchanged (heartbeat during long-running `tools/call`).
- `reingest_repository` input shape remains unchanged (`sourceId` only).
- Internal ingest runtime enum remains unchanged for server internals (`queued|scanning|embedding|completed|skipped|cancelled|error`); external normalization is applied at contract-mapping boundaries.

### Storage Shape Impact

- No new persistent store/table/collection is required for this story.
- Existing persisted ingest root metadata shape is reused (`root`, `state`, counters, timestamps, lock/model fields, error fields, AST counters).
- Compatibility rule for existing persisted rows:
  - legacy persisted `state: "skipped"` is normalized to external `status: "completed"` at read/contract mapping time.
- If active runtime status exists while persisted root metadata is temporarily absent, listing responses synthesize the repository entry from active runtime state plus known root/source identity (no new persistent schema required).

### Out Of Scope

- Introducing user-selectable MCP options for blocking vs non-blocking re-embed.
- Adding new ingest transport protocols beyond current HTTP + WebSocket + MCP behavior.
- Redesigning overall Agents or Ingest page layouts beyond changes required to support interaction and status behavior.
- Refactoring unrelated ingestion pipeline components not required for early no-change return.
- Changing model-lock policy or embedding provider selection rules beyond what is required for this story.
- Implementing MCP protocol-level cancellation handling (`notifications/cancelled`, `tasks/cancel`) for this app in this story.
- Migrating all MCP tools in this app to `result.isError`-style tool errors; this story only defines reingest terminal result semantics and keeps existing protocol-error behavior for pre-run validation failures.

### Questions

None. Open planning questions captured so far are resolved and this story is ready for task breakdown.

## Implementation Ideas

Validated using repository source analysis and official protocol/library documentation on 2026-03-02.

### Rough Change Plan (No Task Breakdown)

1. Agents UX unblocking (client)
   - Primary file: `client/src/pages/AgentsPage.tsx`.
   - Split "run active" behavior into two independent controls:
     - keep send/execute submission disabled while active;
     - keep instruction input editable and sidebar selection enabled while active.
   - Keep existing stop button visibility/behavior intact.
   - Reuse the existing chat-page interaction pattern where possible to avoid bespoke logic.

2. Stop race reliability for command-list/json command runs (server)
   - Primary files: `server/src/ws/server.ts`, `server/src/agents/commandsRunner.ts`.
   - In WS `cancel_inflight`, treat command abort as conversation-authoritative:
     - always attempt `abortAgentCommandRun(conversationId)`, even when `abortInflight(...)` misses.
   - Preserve existing inflight-not-found signaling for chat stream semantics, but do not allow that branch to skip command abort.

3. Blocking `reingest_repository` with classic/v2 parity (server MCP)
   - Primary files: `server/src/ingest/reingestService.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`, `server/src/mcp2/router.ts`.
   - Move shared reingest service from immediate `status: started` response to wait-until-terminal contract.
   - Keep one terminal response payload only, with required top-level fields and no top-level `message`.
   - Keep keep-alive behavior as-is around long-running tool calls.
   - Keep pre-run validation failures in JSON-RPC error envelope; use terminal payload for in-run completion outcomes.

4. Repository visibility/status overlay during active ingest (REST + MCP)
   - Primary files: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`, `server/src/ingest/ingestJob.ts`, `server/src/mcp/server.ts`.
   - Add one shared status mapper/overlay path used by both listing surfaces:
     - internal `queued|scanning|embedding` -> external `status: ingesting` + `phase`;
     - internal `completed|cancelled|error` -> same external `status`, no `phase`;
     - internal `skipped` -> external `completed`.
   - Update MCP classic tool output schema for `ListIngestedRepositories` to include `status` and `phase` in repo entries so runtime payload and declared contract remain aligned.
   - Apply active overlay precedence to status/counters/run id while preserving persisted metadata fields.
   - Ensure synthesized listing entry exists when active runtime state exists but persisted root metadata is temporarily absent.

5. No-change early return before AST and embedding (ingest pipeline)
   - Primary file: `server/src/ingest/ingestJob.ts`.
   - Move delta no-op exit to occur before AST support counting/parsing loops and before embedding loops.
   - Ensure no-change and deletion-only success paths terminate as external `completed`.
   - Keep cancellation/error handling unchanged except for contract field consistency.

### Coupling Constraints To Respect

- `reingestService` is shared by MCP classic and MCP v2; contract changes must be reflected in both surfaces at the same time.
- Stop reliability crosses WS inflight cancellation and command runner conversation-abort maps; changing only one side leaves the race unresolved.
- Status/phase overlay semantics must be identical between `/ingest/roots` and MCP `ListIngestedRepositories`; use one shared mapper path to prevent drift.
- This story does not add a new MCP v2 repository-listing tool; repository-listing contract changes apply to REST `/ingest/roots` and MCP classic `ListIngestedRepositories`.
- Keep-alive and terminal payload semantics must remain aligned with MCP transport behavior (long wait with heartbeats, single terminal tool result).

## Edge Cases and Failure Modes

Validated from existing repository behavior/tests and official documentation references on 2026-03-02.

### Agents Stop and Command Runs

1. Stop clicked before inflight id is known:
   - Failure mode: WS `cancel_inflight` may not be sent yet, so inflight cancellation lookup cannot drive stop.
   - Required handling: command abort is still attempted by `conversationId`; no new command steps/retries start after stop request time.
2. Stop clicked with stale or wrong inflight id:
   - Failure mode: server emits `INFLIGHT_NOT_FOUND` for the chat inflight path.
   - Required handling: keep the inflight error behavior, but do not skip command abort for that conversation.
3. Duplicate stop requests:
   - Failure mode: multiple stop signals for same run/conversation.
   - Required handling: stop path is idempotent; no extra command execution is resumed by repeated stop calls.
4. Conversation switch during active run:
   - Failure mode: user changes sidebar selection while prior conversation is still running.
   - Required handling: switch is allowed; prior run state continues independently; input text for active draft remains stable in the selected conversation context.

### Blocking `reingest_repository` (Classic + MCP2)

1. Invalid input / unknown root / ingest lock busy before run starts:
   - Failure mode: request cannot start.
   - Required handling: return existing JSON-RPC protocol errors (`INVALID_PARAMS`, `NOT_FOUND`, `BUSY`) and do not emit terminal payload contract.
2. GUI cancel while MCP call is waiting:
   - Failure mode: run is cancelled out-of-band from MCP request.
   - Required handling: MCP completes with normal terminal result payload `status: cancelled` (not JSON-RPC error).
3. Client disconnect during blocking wait:
   - Failure mode: keepalive write fails or response closes mid-wait.
   - Required handling: server stops keepalive safely; no process crash; ingest run state itself remains governed by ingest subsystem.
4. Terminal state reached with partial progress counters:
   - Failure mode: cancel/error may not have full final counters.
   - Required handling: return last-known counters in `files/chunks/embedded`; preserve required top-level fields.
5. Parity drift between classic and mcp2:
   - Failure mode: one surface emits new contract while the other emits old `started`.
   - Required handling: both surfaces emit the same terminal `reingest_repository` result semantics in this story.

### Ingest Listing Overlay and Status/Phase Mapping

1. Active runtime status exists but persisted root metadata is missing:
   - Failure mode: repository disappears from listing during active ingest/re-embed.
   - Required handling: synthesize listing entry with identity + active run-state fields so repository remains visible.
2. Persisted state contains legacy/internal `skipped`:
   - Failure mode: external clients see mixed success semantics (`completed` vs `skipped`).
   - Required handling: normalize externally to `status: completed`.
3. Phase leakage for terminal statuses:
   - Failure mode: `phase` present with `completed/cancelled/error`.
   - Required handling: omit `phase` entirely for terminal statuses.
4. Host path mapping cannot fully resolve:
   - Failure mode: incomplete host path mapping in listings.
   - Required handling: keep entry visible and include warning field where supported rather than dropping the repo entry.
5. Schema migration mismatch:
   - Failure mode: payload shape changes without schemaVersion signal.
   - Required handling: both `/ingest/roots` and MCP classic listing emit `schemaVersion: "0000038-status-phase-v1"` once changes are active.

### No-Change Early Return and Pipeline Behavior

1. Delta re-embed with zero changed/added/deleted files:
   - Failure mode: unnecessary AST parse/write and embedding still run.
   - Required handling: return early before AST parse/write and before embedding work.
2. Deletion-only delta path:
   - Failure mode: deletion cleanup is treated as non-terminal or inconsistent success state.
   - Required handling: successful deletion-only path resolves to external `completed` with deterministic terminal payload fields.
3. Cancellation arrives near early-return boundary:
   - Failure mode: race between early terminal success and cancellation signal.
   - Required handling: exactly one terminal outcome is emitted for the run; no duplicate/contradictory terminal states.
4. Existing AST parse failures in non-no-change paths:
   - Failure mode: story work accidentally broadens AST error handling scope.
   - Required handling: keep current AST failure handling semantics unchanged except where no-change early return bypasses AST work entirely.

## Contract Example (Terminal MCP Re-embed Result)

```json
{
  "status": "completed",
  "operation": "reembed",
  "runId": "run_123",
  "sourceId": "/abs/path/repo",
  "durationMs": 8123,
  "files": 42,
  "chunks": 120,
  "embedded": 120,
  "errorCode": null
}
```

### Contract Example (Terminal MCP Re-embed Cancelled)

```json
{
  "status": "cancelled",
  "operation": "reembed",
  "runId": "run_123",
  "sourceId": "/abs/path/repo",
  "durationMs": 4021,
  "files": 42,
  "chunks": 35,
  "embedded": 35,
  "errorCode": null
}
```

### Contract Example (MCP ListIngestedRepositories Repo Entry While Active)

```json
{
  "id": "repo-a",
  "containerPath": "/data/repo-a",
  "hostPath": "/Users/me/repo-a",
  "lastIngestAt": "2026-03-01T12:34:56.000Z",
  "embeddingProvider": "lmstudio",
  "embeddingModel": "text-embedding-nomic-embed-text-v1.5",
  "embeddingDimensions": 768,
  "model": "text-embedding-nomic-embed-text-v1.5",
  "modelId": "text-embedding-nomic-embed-text-v1.5",
  "lock": {
    "embeddingProvider": "lmstudio",
    "embeddingModel": "text-embedding-nomic-embed-text-v1.5",
    "embeddingDimensions": 768,
    "lockedModelId": "text-embedding-nomic-embed-text-v1.5",
    "modelId": "text-embedding-nomic-embed-text-v1.5"
  },
  "counts": {
    "files": 120,
    "chunks": 800,
    "embedded": 320
  },
  "lastError": null,
  "status": "ingesting",
  "phase": "embedding",
  "runId": "run_123"
}
```

## Research Findings (2026-03-02)

- Scope assessment: this story is appropriately scoped as one consistency/contract story, but only if status mapping and error-envelope boundaries are explicit. The highest risk areas were stop timing races and reingest contract parity between MCP classic/v2.
- Current code evidence used for scope decisions:
  - stop race dependency on `abortInflight` success before command abort: `server/src/ws/server.ts`
  - command abort mechanism is conversation-based and can be invoked independently: `server/src/agents/commandsRunner.ts`
  - reingest currently returns immediate `status: started` from shared service: `server/src/ingest/reingestService.ts`
  - MCP classic output schema currently pins `reingest_repository.status` to `started`: `server/src/mcp/server.ts`
  - MCP v2 reingest tool forwards same shared service behavior: `server/src/mcp2/tools/reingestRepository.ts`
  - ingest repository listings currently come from persisted roots metadata and need active-run overlay merge: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`, `server/src/ingest/ingestJob.ts`
  - no-change delta path still executes AST parse flow today and can end as `skipped`: `server/src/ingest/ingestJob.ts`, `server/src/test/unit/ingest-ast-indexing.test.ts`
- Protocol research alignment:
  - MCP tools/call supports returning tool execution outcomes in result payloads and distinguishes protocol errors from tool-level outcomes; long-running workflows can use progress notifications and cancellation utilities.
  - JSON-RPC protocol errors remain appropriate for malformed/invalid requests.
  - For this story, we intentionally do not add protocol-level cancellation handling in this app; GUI cancel remains the cancellation control while MCP waits for terminal response.
  - External references used:
    - https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
    - https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/
    - https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation/
    - https://www.jsonrpc.org/specification

# Implementation Plan

## Instructions

1. Read all sections above before implementation, especially Acceptance Criteria, Message Contracts, and Edge Cases.
2. Complete tasks in the exact order listed below.
3. Keep each task focused to one testable implementation concern.
4. Complete server-side contract/message tasks before frontend tasks that consume those changes.
5. Add or update deterministic tests in the same task that introduces behavior/contract changes.
6. Keep all stop/cancel behavior conversation-authoritative and idempotent.
7. Keep MCP classic and MCP v2 `reingest_repository` behavior in lock-step.
8. Do not add new request flags or optional protocol branches for blocking behavior in this story.

## Tasks

### 1. Server Message Contract: make `cancel_inflight` race-safe and conversation-authoritative

- Task Status: **__done__**
- Git Commits: `672573a`

#### Overview

Update WebSocket cancel message handling so command-run abort is always attempted by `conversationId`, including stop races where `inflightId` is not yet known. This task defines the server-side message contract change first so dependent frontend stop behavior can safely follow.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: MDN WebSocket API reference for frame lifecycle, close/error semantics, and cancel message delivery timing: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Verified on 2026-03-02: `ws` server library documentation (README/API usage) for connection handling and server-side message processing paths: https://github.com/websockets/ws
- Verified on 2026-03-02: Node.js `events` documentation for EventEmitter ordering/idempotent listener behavior used in race-safe stop handling: https://nodejs.org/api/events.html
- Verified on 2026-03-02 via Context7 MCP (`/jestjs/jest`): Jest documentation for `expect` matchers, mock assertions, and async test patterns used in stop/cancel regression tests: https://context7.com/jestjs/jest/llms.txt
- Verified on 2026-03-02 via Context7 MCP (`/mermaid-js/mermaid`): Mermaid sequence-diagram syntax for documenting stop-race message flow updates in `design.md`: https://context7.com/mermaid-js/mermaid/llms.txt

#### Subtasks

1. [x] Update WS client-message typing/parsing to accept `cancel_inflight` with required `conversationId` and optional `inflightId`.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/ws/types.ts`
   - Required behavior: payloads with only `conversationId` are valid for `cancel_inflight`; other message shapes remain unchanged.
2. [x] Update WS cancel handler so `abortAgentCommandRun(conversationId)` is always attempted, regardless of `abortInflight` success.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/ws/server.ts`, `server/src/agents/commandsRunner.ts`
   - Required behavior: command retries/steps are blocked after stop request time in both inflight-id and no-inflight-id paths.
3. [x] Keep chat-stream cancellation semantics deterministic when `inflightId` is supplied but not found.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/ws/server.ts`
   - Required behavior: preserve existing `INFLIGHT_NOT_FOUND` turn-final behavior for chat stream cancellation mismatch when a non-empty `inflightId` is supplied, while still aborting command runs by conversation. When `inflightId` is omitted, do not emit `INFLIGHT_NOT_FOUND`.
4. [x] Add WS parser unit test: `cancel_inflight` accepts payload with `conversationId` only.
   - Starter snippet (adapt names to exact existing symbols): `expect(parse({ type: 'cancel_inflight', conversationId: 'c1' })).toEqual(validMessage);`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC4, AC23.
   - Files to read/edit: `server/src/test/unit/ws-server.test.ts`, `server/src/ws/types.ts`
   - Test type: Unit (parser contract).
   - Test location: `server/src/test/unit/ws-server.test.ts`.
   - Test description: assert parser accepts `cancel_inflight` with required `conversationId` and omitted `inflightId`.
   - Test purpose: guarantee stop-race path works when inflight id is not yet known.
5. [x] Add WS parser unit test: `cancel_inflight` accepts payload with `conversationId` plus `inflightId`.
   - Starter snippet (adapt names to exact existing symbols): `expect(parse({ type: 'cancel_inflight', conversationId: 'c1', inflightId: 'i1' })).toEqual(validMessage);`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC23.
   - Files to read/edit: `server/src/test/unit/ws-server.test.ts`, `server/src/ws/types.ts`
   - Test type: Unit (parser contract).
   - Test location: `server/src/test/unit/ws-server.test.ts`.
   - Test description: assert parser accepts full `cancel_inflight` payload with both ids.
   - Test purpose: preserve compatibility with existing inflight-aware cancellation callers.
6. [x] Add WS parser unit test: malformed `cancel_inflight` payloads are rejected.
   - Starter snippet (adapt names to exact existing symbols): `expect(parse({ type: 'cancel_inflight' })).toBeInvalid();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4.
   - Files to read/edit: `server/src/test/unit/ws-server.test.ts`, `server/src/ws/types.ts`
   - Test type: Unit (negative parser validation).
   - Test location: `server/src/test/unit/ws-server.test.ts`.
   - Test description: cover missing/empty `conversationId` and wrong field types; assert parser rejects.
   - Test purpose: prevent invalid stop payloads from creating undefined runtime behavior.
7. [x] Add WS handler unit test: conversation-only cancel does not emit chat `INFLIGHT_NOT_FOUND` turn-final failure.
   - Starter snippet (adapt names to exact existing symbols): `expect(turnFinalEvents).not.toContainCode('INFLIGHT_NOT_FOUND');`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC4, AC23.
   - Files to read/edit: `server/src/test/unit/ws-server.test.ts`, `server/src/ws/server.ts`
   - Test type: Unit (WS handler behavior).
   - Test location: `server/src/test/unit/ws-server.test.ts`.
   - Test description: for cancel payload without `inflightId`, assert no chat mismatch error event is emitted.
   - Test purpose: keep conversation-authoritative stop path clean for race scenarios.
8. [x] Add WS handler unit test: stale/mismatched `inflightId` keeps existing chat mismatch semantics.
   - Starter snippet (adapt names to exact existing symbols): `expect(turnFinalEvents).toContainCode('INFLIGHT_NOT_FOUND');`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC23.
   - Files to read/edit: `server/src/test/unit/ws-chat-stream.test.ts`, `server/src/ws/server.ts`
   - Test type: Unit (chat cancellation regression).
   - Test location: `server/src/test/unit/ws-chat-stream.test.ts`.
   - Test description: assert stale `inflightId` still produces deterministic `INFLIGHT_NOT_FOUND` behavior.
   - Test purpose: prevent regressions to existing chat-stream cancellation contract.
9. [x] Add command-run stop regression test: no new command step starts after stop request.
   - Starter snippet (adapt names to exact existing symbols): `expect(startedStepsAfterStop).toHaveLength(0);`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC23.
   - Files to read/edit: `server/src/test/unit/agent-commands-runner.test.ts`, `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`, `server/src/ws/server.ts`
   - Test type: Unit or integration (command runner abort boundary).
   - Test location: `server/src/test/unit/agent-commands-runner.test.ts` and `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`.
   - Test description: trigger stop during command execution and assert no subsequent command step starts.
   - Test purpose: enforce hard-stop guarantee for command list/json execution.
10. [x] Add command-run retry regression test: no retry is scheduled after stop request.

- Starter snippet (adapt names to exact existing symbols): `expect(scheduledRetriesAfterStop).toHaveLength(0);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
- Acceptance criteria focus: AC3, AC23.
- Files to read/edit: `server/src/test/unit/agent-commands-runner.test.ts`, `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`, `server/src/ws/server.ts`
- Test type: Unit or integration (retry scheduling regression).
- Test location: `server/src/test/unit/agent-commands-runner.test.ts` and `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`.
- Test description: stop during a retry-capable failure path and assert no retries are queued post-stop.
- Test purpose: close the retry race that caused continued work after user stop.

11. [x] Add duplicate-stop idempotence test: repeated cancel messages do not restart work or emit contradictory outcomes.

- Starter snippet (adapt names to exact existing symbols): `expect(terminalOutcomeCount).toBe(1);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
- Acceptance criteria focus: AC3, AC23.
- Files to read/edit: `server/src/test/unit/ws-server.test.ts`, `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`, `server/src/ws/server.ts`
- Test type: Unit (idempotence regression).
- Test location: `server/src/test/unit/ws-server.test.ts` and `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`.
- Test description: send stop twice and assert idempotent behavior with no resumed execution.
- Test purpose: guarantee deterministic behavior under repeated user stop clicks.

12. [x] Update `design.md` with the final stop/cancel flow and add Mermaid sequence diagram(s) for conversation-authoritative cancel handling.

- Starter snippet (adapt names to exact existing symbols): `Add a Mermaid sequence diagram showing cancel_inflight paths for conversation-only cancel and inflight-id mismatch behavior.`
- Dependency note: execute this after implementing Task 1 behavior/tests so the diagram reflects final code paths.
- Docs: https://context7.com/mermaid-js/mermaid/llms.txt | https://context7.com/jestjs/jest/llms.txt
- Acceptance criteria focus: AC22 documentation completeness and AC23 stop-race flow clarity.
- Files to read/edit: `design.md`, `server/src/ws/server.ts`, `server/src/agents/commandsRunner.ts`
- Document name: `design.md`.
- Document location: `design.md`.
- Document description: update the stop/cancel architecture narrative and Mermaid sequence diagrams for conversation-authoritative cancellation.
- Document purpose: keep architecture documentation synchronized with the implemented race-safe WS cancel behavior.

13. [x] If this task adds or removes files, update `projectStructure.md` after finishing those file changes.

- Starter snippet (adapt names to exact existing symbols): `Add entries for any new/removed files introduced by Task 1, grouped under server WS and server test directories.`
- Dependency note: execute this after all file add/remove subtasks in Task 1 (including later subtasks 14 and 15) and before moving to the next task.
- Docs: https://www.markdownguide.org/basic-syntax/
- Acceptance criteria focus: AC22 documentation completeness.
- Files to read/edit: `projectStructure.md`, `server/src/ws/*`, `server/src/test/unit/*`
- Document name: `projectStructure.md`.
- Document location: `projectStructure.md`.
- Document description: record Task 1 file additions/removals in WS and related test directories.
- Document purpose: maintain an accurate repository file map for implementation and onboarding.
- Required behavior: update `projectStructure.md` with every file path added or removed by Task 1 (no wildcard summaries), and remove entries for deleted files.

14. [x] Add WS handler unit test: conversation-only `cancel_inflight` still attempts command-run abort by `conversationId`.

- Starter snippet (adapt names to exact existing symbols): `expect(abortAgentCommandRunSpy).toHaveBeenCalledWith(conversationId);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
- Acceptance criteria focus: AC4, AC23.
- Files to read/edit: `server/src/test/unit/ws-server.test.ts`, `server/src/ws/server.ts`
- Test type: Unit (conversation-authoritative stop behavior).
- Test location: `server/src/test/unit/ws-server.test.ts`.
- Test description: send `cancel_inflight` with `conversationId` only and assert command abort is attempted for that conversation.
- Test purpose: directly verify stop-race behavior before inflight id assignment.

15. [x] Add WS handler unit test: stale `inflightId` path still attempts command-run abort by `conversationId`.

- Starter snippet (adapt names to exact existing symbols): `expect(abortAgentCommandRunSpy).toHaveBeenCalledWith(conversationId);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
- Acceptance criteria focus: AC3, AC23.
- Files to read/edit: `server/src/test/unit/ws-chat-stream.test.ts`, `server/src/test/unit/ws-server.test.ts`, `server/src/ws/server.ts`
- Test type: Unit (mismatch corner-case behavior).
- Test location: `server/src/test/unit/ws-chat-stream.test.ts` and `server/src/test/unit/ws-server.test.ts`.
- Test description: send `cancel_inflight` with stale `inflightId`; assert mismatch semantics remain and command abort is still attempted by conversation.
- Test purpose: ensure stale inflight identifiers do not bypass conversation-authoritative stop.

16. [x] Add structured stop-race diagnostic logs for manual verification.

- Starter snippet (adapt names to exact existing symbols): `logger.info('[DEV-0000038][T1] CANCEL_INFLIGHT_RECEIVED conversationId=%s inflightId=%s', conversationId, inflightId ?? 'none');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://nodejs.org/api/console.html | https://nodejs.org/api/events.html
- Acceptance criteria focus: AC3, AC4, AC23.
- Files to read/edit: `server/src/ws/server.ts`, `server/src/agents/commandsRunner.ts`
- Required log line: `[DEV-0000038][T1] CANCEL_INFLIGHT_RECEIVED conversationId=<id> inflightId=<id|none>`.
- Required log line: `[DEV-0000038][T1] ABORT_AGENT_RUN_REQUESTED conversationId=<id>`.
- Required behavior: emit each log once per stop request path so manual checks can verify event sequencing.

17. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build:summary:server` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` and resolve errors.
2. [x] `npm run test:summary:server` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/server-tests-*.log`) and resolve listed failures.
3. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001` for stop-race behavior; verify in compose server logs that `[DEV-0000038][T1] CANCEL_INFLIGHT_RECEIVED ...` and `[DEV-0000038][T1] ABORT_AGENT_RUN_REQUESTED ...` are emitted with matching `conversationId` values, and verify browser debug console has no unexpected errors.
6. [x] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Subtask 1: Updated `server/src/ws/types.ts` so `cancel_inflight` accepts `conversationId` with optional `inflightId`; parser now rejects empty/wrong-type `inflightId` only when provided.
- Subtasks 2-3: Refactored WS cancel handling in `server/src/ws/server.ts` to always request command-run abort by `conversationId`, skip chat mismatch errors when `inflightId` is omitted, and preserve `INFLIGHT_NOT_FOUND` for stale provided ids.
- Subtasks 4-7: Added parser/handler unit coverage in `server/src/test/unit/ws-server.test.ts` for conversation-only cancel acceptance, full payload acceptance, malformed payload rejection, and no `turn_final` mismatch emission on conversation-only cancel.
- Subtask 8: Extended stale-id chat-stream regression in `server/src/test/unit/ws-chat-stream.test.ts` to retain `INFLIGHT_NOT_FOUND` behavior.
- Subtasks 9-11: Added stop/retry/idempotence regressions in `server/src/test/unit/agent-commands-runner-abort-retry.test.ts` to prove no post-stop step/retry progression and stable duplicate-stop behavior.
- Subtask 12: Added a Task 1 architecture section and Mermaid sequence flow in `design.md` documenting conversation-authoritative cancel logic.
- Subtask 13: No files were added/removed in Task 1, so `projectStructure.md` required no change.
- Subtasks 14-15: Added explicit log-backed assertions for conversation-only and stale-id paths to verify command-run abort is still attempted by `conversationId`.
- Subtask 16: Added required deterministic server log lines `[DEV-0000038][T1] CANCEL_INFLIGHT_RECEIVED ...` and `[DEV-0000038][T1] ABORT_AGENT_RUN_REQUESTED ...` in the WS cancel path.
- Subtask 17: Ran workspace lint and format checks; format check initially failed on one unrelated server integration test file, then fixed with Prettier and re-ran `format:check` successfully.
- Testing 1: `npm run build:summary:server` passed with `warnings: 0` (`logs/test-summaries/build-server-latest.log`).
- Testing 2: `npm run test:summary:server` passed (`tests run: 926`, `failed: 0`), log at `test-results/server-tests-2026-03-02T08-48-06-674Z.log`.
- Testing 3: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`) using `logs/test-summaries/compose-build-latest.log`.
- Testing 4: `npm run compose:up` completed successfully; server/client/chroma/mongo and Playwright MCP services started healthy.
- Testing 5: Manual Playwright-MCP session at `http://host.docker.internal:5001/chat` completed; compose log file `logs/server.1.log` contains matching marker pair for `conversationId=manual-t1-1772442080988` (`CANCEL_INFLIGHT_RECEIVED` + `ABORT_AGENT_RUN_REQUESTED`), and a fresh browser-console error scan returned no errors.
- Testing 6: `npm run compose:down` completed successfully and removed the compose services/network.

---

### 2. Frontend: make Agents stop send `cancel_inflight` by conversation even when `inflightId` is unknown

- Task Status: **__done__**
- Git Commits: `12e1781`

#### Overview

Consume Task 1’s server message-contract update in the Agents UI so Stop always emits a cancel signal while a conversation is active, even when no inflight id is available yet.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: React `useCallback` reference for stable stop handlers and stale-closure avoidance during active runs: https://react.dev/reference/react/useCallback
- Verified on 2026-03-02: MDN WebSocket API reference for client message-send behavior (`cancel_inflight` payload shape and dispatch timing): https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Verified on 2026-03-02 via MUI MCP: Material UI v6.4.12 index used in this repo for authoritative component/API docs: https://llms.mui.com/material-ui/6.4.12/llms.txt
- Verified on 2026-03-02 via MUI MCP: MUI TextField behavior and controlled-input patterns used on Agents page forms: https://llms.mui.com/material-ui/6.4.12/components/text-fields.md
- Verified on 2026-03-02 via MUI MCP: MUI Button API semantics for stop/submit disabled-state behavior: https://llms.mui.com/material-ui/6.4.12/api/button.md
- Verified on 2026-03-02: React Testing Library intro for event simulation and DOM assertions on stop-click flows: https://testing-library.com/docs/react-testing-library/intro
- Verified on 2026-03-02 via Context7 MCP (`/jestjs/jest`): Jest documentation for payload-shape assertions and mock call-argument verification in client tests: https://context7.com/jestjs/jest/llms.txt

#### Subtasks

1. [x] Update WebSocket client hook API to allow optional `inflightId` on `cancelInflight`.
   - Starter snippet (adapt names to exact existing symbols): `const cancelInflight = (conversationId, inflightId) => send({ type: "cancel_inflight", conversationId, ...(inflightId ? { inflightId } : {}) });`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `client/src/hooks/useChatWs.ts`
   - Required behavior: send `{ type: 'cancel_inflight', conversationId }` when `inflightId` is unavailable; include `inflightId` when present. Keep existing 2-argument call sites in Chat and Flows working unchanged.
2. [x] Update Agents stop-click logic to always send cancel when there is an active conversation.
   - Starter snippet (adapt names to exact existing symbols): `const cancelInflight = (conversationId, inflightId) => send({ type: "cancel_inflight", conversationId, ...(inflightId ? { inflightId } : {}) });`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`
   - Required behavior: remove current hard dependency on a non-empty inflight id before sending cancel.
3. [x] Add hook unit test: `cancelInflight` sends conversation-only payload when `inflightId` is absent.
   - Starter snippet (adapt names to exact existing symbols): `expect(sendSpy).toHaveBeenCalledWith({ type: 'cancel_inflight', conversationId: 'c1' });`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC4, AC23.
   - Files to read/edit: `client/src/test/useChatWs.test.ts`, `client/src/hooks/useChatWs.ts`
   - Test type: Unit (hook payload contract).
   - Test location: `client/src/test/useChatWs.test.ts`.
   - Test description: call `cancelInflight(conversationId)` without inflight id and assert payload omits `inflightId`.
   - Test purpose: ensure stop works during race window before inflight id exists.
4. [x] Add hook unit test: `cancelInflight` sends full payload when `inflightId` is provided.
   - Starter snippet (adapt names to exact existing symbols): `expect(sendSpy).toHaveBeenCalledWith({ type: 'cancel_inflight', conversationId: 'c1', inflightId: 'i1' });`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC23.
   - Files to read/edit: `client/src/test/useChatWs.test.ts`, `client/src/hooks/useChatWs.ts`
   - Test type: Unit (hook payload contract).
   - Test location: `client/src/test/useChatWs.test.ts`.
   - Test description: call `cancelInflight(conversationId, inflightId)` and assert both ids are included.
   - Test purpose: preserve compatibility with existing inflight-aware stop paths.
5. [x] Add Agents page UI test: stop click without inflight id still sends conversation-level cancel.
   - Starter snippet (adapt names to exact existing symbols): `expect(cancelInflightSpy).toHaveBeenCalledWith(activeConversationId, undefined);`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC4.
   - Files to read/edit: `client/src/test/agentsPage.commandsRun.abort.test.tsx`, `client/src/pages/AgentsPage.tsx`
   - Test type: Component/UI interaction test.
   - Test location: `client/src/test/agentsPage.commandsRun.abort.test.tsx`.
   - Test description: simulate active run with missing inflight id, click Stop, assert conversation-level cancel call.
   - Test purpose: validate UI behavior for race-prone stop timing.
6. [x] Add Chat page regression test: existing stop behavior with inflight id remains unchanged.
   - Starter snippet (adapt names to exact existing symbols): `expect(cancelInflightSpy).toHaveBeenCalledWith(conversationId, inflightId);`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3.
   - Files to read/edit: `client/src/test/chatPage.stop.test.tsx`, `client/src/hooks/useChatWs.ts`
   - Test type: Regression component test.
   - Test location: `client/src/test/chatPage.stop.test.tsx`.
   - Test description: run existing chat stop path and assert unchanged cancel payload behavior.
   - Test purpose: prevent unintended chat stop regressions while changing Agents stop semantics.
7. [x] Add Flows page regression test: existing stop behavior with inflight id remains unchanged.
   - Starter snippet (adapt names to exact existing symbols): `expect(cancelInflightSpy).toHaveBeenCalledWith(conversationId, inflightId);`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3.
   - Files to read/edit: `client/src/test/flowsPage.stop.test.tsx`, `client/src/hooks/useChatWs.ts`
   - Test type: Regression component test.
   - Test location: `client/src/test/flowsPage.stop.test.tsx`.
   - Test description: run existing flows stop path and assert unchanged cancel payload behavior.
   - Test purpose: keep flows stop behavior stable while updating Agents stop logic.
8. [x] Add client stop-click test for no-active-conversation edge case.
   - Starter snippet (adapt names to exact existing symbols): `if (!activeConversationId) return;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `client/src/test/agentsPage.commandsRun.abort.test.tsx`, `client/src/test/useChatWs.test.ts`, `client/src/pages/AgentsPage.tsx`
   - Required coverage: stop click with no active conversation does not send any WS cancel payload and does not throw.
   - Test type: Component/UI negative-path test.
   - Test location: `client/src/test/agentsPage.commandsRun.abort.test.tsx`.
   - Test description: click Stop with no active conversation and assert no WS cancel call and no thrown errors.
   - Test purpose: prevent null-context stop calls from generating invalid payloads.
9. [x] If this task adds or removes files, update `projectStructure.md` after finishing those file changes.
   - Starter snippet (adapt names to exact existing symbols): `Add entries for any new/removed files introduced by Task 2 under client hooks/pages/tests.`
   - Dependency note: execute this after all file add/remove subtasks in Task 2 and before moving to the next task.
   - Docs: https://www.markdownguide.org/basic-syntax/
   - Acceptance criteria focus: AC22 documentation completeness.
   - Files to read/edit: `projectStructure.md`, `client/src/hooks/*`, `client/src/pages/*`, `client/src/test/*`
   - Document name: `projectStructure.md`.
   - Document location: `projectStructure.md`.
   - Document description: record Task 2 file additions/removals in client hook/page/test paths.
   - Document purpose: keep the repository structure documentation aligned with stop payload implementation changes.
   - Required behavior: update `projectStructure.md` with every file path added or removed by Task 2 (no wildcard summaries), and remove entries for deleted files.
10. [x] Add deterministic client stop logs for Playwright-MCP console assertions.

- Starter snippet (adapt names to exact existing symbols): `console.info('[DEV-0000038][T2] STOP_CLICK conversationId=%s inflightId=%s', activeConversationId, inflightId ?? 'none');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://developer.mozilla.org/en-US/docs/Web/API/Console/info_static | https://react.dev/reference/react/useCallback
- Acceptance criteria focus: AC3, AC4, AC23.
- Files to read/edit: `client/src/pages/AgentsPage.tsx`, `client/src/hooks/useChatWs.ts`
- Required log line: `[DEV-0000038][T2] STOP_CLICK conversationId=<id> inflightId=<id|none>`.
- Required log line: `[DEV-0000038][T2] CANCEL_INFLIGHT_SENT conversationId=<id> inflightId=<id|none>`.
- Required behavior: emit one STOP_CLICK and one CANCEL_INFLIGHT_SENT line per stop attempt.

11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build:summary:client` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` and resolve errors.
2. [x] `npm run test:summary:client` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`) and resolve listed failures.
3. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`; verify `[DEV-0000038][T2] STOP_CLICK ...` and `[DEV-0000038][T2] CANCEL_INFLIGHT_SENT ...` appear once per stop click, with `inflightId=none` when missing and populated `inflightId` when present, capture screenshots showing both no-inflight-id and inflight-id-present stop states, review those screenshots against expected UI/button state and message flow, save screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped via `docker-compose.local.yml`), and verify browser debug console has no unexpected errors.
6. [x] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Subtask 1: Updated `client/src/hooks/useChatWs.ts` so `cancelInflight` accepts `inflightId` as optional and emits conversation-only `cancel_inflight` payloads when inflight id is unavailable.
- Subtask 2: Updated `client/src/pages/AgentsPage.tsx` stop handler to send `cancelInflight(activeConversationId, inflightId)` whenever a conversation is active, even if `inflightId` is currently undefined.
- Subtasks 3-4: Added `useChatWs` unit coverage in `client/src/test/useChatWs.test.ts` for both conversation-only cancel payloads (no `inflightId`) and full payloads (with `inflightId`).
- Subtask 5: Updated `client/src/test/agentsPage.commandsRun.abort.test.tsx` so the pre-inflight Stop scenario now asserts `cancel_inflight` is still sent with `conversationId` and without `inflightId`.
- Subtask 6: Kept Chat stop regression coverage in `client/src/test/chatPage.stop.test.tsx` and tightened test intent labels to explicitly assert inflight-id-preserving cancel payloads.
- Subtask 7: Kept Flows stop regression coverage in `client/src/test/flowsPage.stop.test.tsx` and tightened test intent labels to explicitly assert inflight-id-preserving cancel payloads.
- Subtask 8: Added a no-active-conversation stop test in `client/src/test/agentsPage.commandsRun.abort.test.tsx` to assert Stop does not send `cancel_inflight` and the click resolves without errors.
- Subtask 9: No files were added or removed in Task 2, so `projectStructure.md` did not require updates.
- Subtask 10: Added deterministic browser-console markers in `client/src/pages/AgentsPage.tsx` and `client/src/hooks/useChatWs.ts` for `STOP_CLICK` and `CANCEL_INFLIGHT_SENT` with `inflightId=none` fallback.
- Subtask 11: Ran workspace lint and format checks; lint completed with existing unrelated server import-order warnings, `format:check` initially failed for `client/src/test/agentsPage.commandsRun.abort.test.tsx`, then passed after running Prettier write on that file.
- Testing 1: `npm run build:summary:client` passed (`status: passed`); inspected `logs/test-summaries/build-client-latest.log` and confirmed the single warning is the existing Vite chunk-size advisory.
- Testing 2: `npm run test:summary:client` passed (`tests run: 390`, `failed: 0`), log at `test-results/client-tests-2026-03-02T09-12-24-309Z.log`.
- Testing 3: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`) using `logs/test-summaries/compose-build-latest.log`.
- Testing 4: `npm run compose:up` completed successfully; local compose services (including client, server, and Playwright MCP) started healthy.
- Testing 5: Manual browser verification executed against `http://host.docker.internal:5001/agents` (after Playwright MCP instability required fallback to Chrome DevTools for interaction); validated `[DEV-0000038][T2] STOP_CLICK ...` and `[DEV-0000038][T2] CANCEL_INFLIGHT_SENT ...` markers in browser console for stop flows, and saved screenshots to `playwright-output-local/task2-stop-no-inflight.png` and `playwright-output-local/task2-stop-with-inflight.png`.
- Testing 6: `npm run compose:down` completed successfully and tore down the compose services/network.

---

### 3. Frontend: unblock Agents input editing and sidebar navigation during active runs

- Task Status: **__done__**
- Git Commits: `0c0f764`

#### Overview

Limit active-run UI restrictions to submit/execute controls only. Keep instruction text editing and conversation switching available while an agent run is active.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: React conditional rendering guide for splitting submission lock state from input/sidebar interactivity state: https://react.dev/learn/conditional-rendering
- Verified on 2026-03-02: React Router docs for safe conversation navigation while a run remains active: https://reactrouter.com/
- Verified on 2026-03-02 via MUI MCP: Material UI v6.4.12 source index for component-level behavior and prop contracts: https://llms.mui.com/material-ui/6.4.12/llms.txt
- Verified on 2026-03-02 via MUI MCP: MUI Lists guidance for clickable conversation list behavior and interaction patterns: https://llms.mui.com/material-ui/6.4.12/components/lists.md
- Verified on 2026-03-02 via MUI MCP: MUI Drawer API for sidebar interaction/disabled-state rules when run-active: https://llms.mui.com/material-ui/6.4.12/api/drawer.md
- Verified on 2026-03-02: WAI-ARIA Authoring Practices for keyboard and pointer interaction expectations in list navigation: https://www.w3.org/WAI/ARIA/apg/
- Verified on 2026-03-02: React Testing Library intro for interaction tests on editable input and sidebar switching: https://testing-library.com/docs/react-testing-library/intro
- Verified on 2026-03-02 via Context7 MCP (`/jestjs/jest`): Jest documentation for deterministic UI lock/unlock assertions and component interaction checks: https://context7.com/jestjs/jest/llms.txt

#### Subtasks

1. [x] Introduce explicit UI gating flags for “run-active submission lock” versus “input editability”.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`
   - Required behavior: run-active state disables submit/execute actions only; no input lock and no sidebar lock from the same flag.
2. [x] Update instruction input wiring to use the new editability flag and preserve draft text during active runs.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`
   - Required behavior: input remains editable and draft text is preserved while run is active.
3. [x] Update sidebar interaction gating so conversation list remains clickable during active run.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`, `client/src/components/chat/ConversationList.tsx`
   - Required behavior: conversation switching works while run is active; no overlay blocks clicks.
4. [x] Add Agents UI component test: instruction input remains editable while run is active.
   - Starter snippet (adapt names to exact existing symbols): `expect(input).not.toBeDisabled();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1.
   - Files to read/edit: `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`, `client/src/test/agentsPage.conversationSelection.test.tsx`, `client/src/pages/AgentsPage.tsx`
   - Test type: Component/UI state test.
   - Test location: `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`, `client/src/test/agentsPage.conversationSelection.test.tsx`.
   - Test description: render active-run state and assert instruction input is still editable.
   - Test purpose: prevent regressions where run-active state accidentally locks typing.
5. [x] Add Agents UI component test: draft text persists across active-run state updates.
   - Starter snippet (adapt names to exact existing symbols): `expect(input).toHaveValue('draft text');`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1.
   - Files to read/edit: `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`, `client/src/test/agentsPage.conversationSelection.test.tsx`, `client/src/pages/AgentsPage.tsx`
   - Test type: Component/UI persistence test.
   - Test location: `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`, `client/src/test/agentsPage.conversationSelection.test.tsx`.
   - Test description: enter draft, simulate active-run updates/ticks, assert draft value is unchanged.
   - Test purpose: guarantee users can prepare next instruction without losing input.
6. [x] Add Agents UI component test: sidebar conversation switch works during active run.
   - Starter snippet (adapt names to exact existing symbols): `await user.click(conversationItem); expect(selectedConversationId).toBe(targetId);`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC2.
   - Files to read/edit: `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`, `client/src/test/agentsPage.conversationSelection.test.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/components/chat/ConversationList.tsx`
   - Test type: Component/UI navigation test.
   - Test location: `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`, `client/src/test/agentsPage.conversationSelection.test.tsx`.
   - Test description: while run is active, click a different conversation and assert selection changes.
   - Test purpose: enforce non-blocking multi-conversation workflow during active runs.
7. [x] Add Agents UI component test: submit/execute controls remain disabled while run is active.
   - Starter snippet (adapt names to exact existing symbols): `expect(submitButton).toBeDisabled();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`, `client/src/test/agentsPage.conversationSelection.test.tsx`, `client/src/pages/AgentsPage.tsx`
   - Test type: Component/UI lock-state test.
   - Test location: `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`, `client/src/test/agentsPage.conversationSelection.test.tsx`.
   - Test description: assert send/execute controls are disabled during active run while input/sidebar remain usable.
   - Test purpose: keep the intended lock scope limited to submission actions only.
8. [x] If this task adds or removes files, update `projectStructure.md` after finishing those file changes.
   - Starter snippet (adapt names to exact existing symbols): `Add entries for any new/removed files introduced by Task 3 under client pages/components/tests.`
   - Dependency note: execute this after all file add/remove subtasks in Task 3 and before moving to the next task.
   - Docs: https://www.markdownguide.org/basic-syntax/
   - Acceptance criteria focus: AC22 documentation completeness.
   - Files to read/edit: `projectStructure.md`, `client/src/pages/*`, `client/src/components/*`, `client/src/test/*`
   - Document name: `projectStructure.md`.
   - Document location: `projectStructure.md`.
   - Document description: record Task 3 file additions/removals in Agents page, conversation components, and tests.
   - Document purpose: preserve an accurate project file inventory for active-run UX changes.
   - Required behavior: update `projectStructure.md` with every file path added or removed by Task 3 (no wildcard summaries), and remove entries for deleted files.
9. [x] Add deterministic active-run UX logs for manual console verification.
   - Starter snippet (adapt names to exact existing symbols): `console.info('[DEV-0000038][T3] AGENTS_INPUT_EDITABLE_WHILE_ACTIVE runActive=%s', isRunActive);`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/Console/info_static | https://react.dev/learn/conditional-rendering
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`, `client/src/components/chat/ConversationList.tsx`
   - Required log line: `[DEV-0000038][T3] AGENTS_INPUT_EDITABLE_WHILE_ACTIVE runActive=true`.
   - Required log line: `[DEV-0000038][T3] AGENTS_CONVERSATION_SWITCH_ALLOWED from=<id> to=<id>`.
   - Required behavior: emit logs when editing during active run and when switching conversations while run is active.
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build:summary:client` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` and resolve errors.
2. [x] `npm run test:summary:client` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`) and resolve listed failures.
3. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`; verify `[DEV-0000038][T3] AGENTS_INPUT_EDITABLE_WHILE_ACTIVE runActive=true` appears when editing during active run and `[DEV-0000038][T3] AGENTS_CONVERSATION_SWITCH_ALLOWED from=<id> to=<id>` appears on sidebar switch, capture screenshots proving editable input and successful sidebar switch while run remains active, review screenshots against expected lock-scope behavior (submit disabled while input/sidebar remain usable), save screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped via `docker-compose.local.yml`), and verify browser debug console has no unexpected errors.
6. [x] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Subtask 1: Added explicit AgentsPage flags to separate run-active submit locking from input/sidebar interactivity state (`submitDisabledForRun`, `inputEditableDuringRun`, `sidebarSelectableDuringRun`) and stopped coupling conversation-list disabling to run-active state.
- Subtask 2: Updated instruction input disabled wiring in `AgentsPage` to use a dedicated editability flag (`isInstructionInputDisabled`), keeping typing available during active runs while preserving existing websocket/agent-disabled guards.
- Subtask 3: Removed forced `stop()` from conversation selection and kept sidebar disabling independent of run-active state so conversation switching remains available during active runs.
- Subtask 4: Added active-run test assertions in `agentsPage.navigateAway.keepsRun.test.tsx` and `agentsPage.conversationSelection.test.tsx` verifying `agent-input` remains enabled while inflight snapshots are active.
- Subtask 5: Added draft persistence assertions across active-run websocket updates (`inflight_snapshot`/`assistant_delta`) so typed instruction text remains unchanged.
- Subtask 6: Added active-run conversation switching coverage in `agentsPage.conversationSelection.test.tsx`, asserting a second `subscribe_conversation` is emitted for a different conversation while run activity remains present.
- Subtask 7: Added lock-scope assertions ensuring `agent-command-execute` remains disabled while run-active state is present, with run-active action-slot behavior still rendered.
- Subtask 8: No files were added or removed during Task 3, so `projectStructure.md` required no updates.
- Subtask 9: Added deterministic Task 3 console markers in `AgentsPage` for active-run editability and allowed conversation switches (`AGENTS_INPUT_EDITABLE_WHILE_ACTIVE`, `AGENTS_CONVERSATION_SWITCH_ALLOWED`).
- Subtask 10: Ran `npm run lint --workspaces` (passed with existing unrelated server import-order warnings) and `npm run format:check --workspaces`; format check initially failed for two edited client files, then passed after running Prettier write on those files.
- Testing 1: `npm run build:summary:client` passed; reviewed `logs/test-summaries/build-client-latest.log` and confirmed the single warning is the expected Vite chunk-size advisory.
- Testing 2: `npm run test:summary:client` initially reported one failing sidebar-availability test; updated `agentsPage.sidebarActions.test.tsx` to wait for async persistence-state disablement, then reran and passed (`tests run: 392`, `failed: 0`) with log `test-results/client-tests-2026-03-02T09-47-17-232Z.log`.
- Testing 3: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`) with log `logs/test-summaries/compose-build-latest.log`.
- Testing 4: `npm run compose:up` completed successfully; compose services (client/server/chroma/mongo/playwright-mcp plus observability sidecars) started healthy.
- Testing 5: Manual runtime validation at `http://host.docker.internal:5001/agents` confirmed both required console markers (`AGENTS_INPUT_EDITABLE_WHILE_ACTIVE runActive=true` while editing and `AGENTS_CONVERSATION_SWITCH_ALLOWED from=<id> to=<id>` on sidebar switch), with no browser-console errors; screenshots saved to `playwright-output-local/task3-editable-input-active-run.png` and `playwright-output-local/task3-sidebar-switch-during-active-run.png`.
- Testing 6: `npm run compose:down` completed successfully and removed compose services/network.

---

### 4. Server Message Contract: make `reingest_repository` blocking and terminal-only (classic + MCP v2 parity)

- Task Status: **__done__**
- Git Commits: `972027a`

#### Overview

Replace immediate `status: started` reingest results with one terminal payload returned only after run completion/cancellation/error, shared by both MCP surfaces.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: MCP tools specification for terminal result contract shape and tool response semantics: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Verified on 2026-03-02: MCP progress/long-running guidance for blocking waits, progress lifecycle, and cancellation expectations: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/
- Verified on 2026-03-02: JSON-RPC spec for strict protocol error boundaries (pre-run validation failures vs post-start terminal outcomes): https://www.jsonrpc.org/specification
- Verified on 2026-03-02: Express 5 migration docs for response/runtime behavior assumptions in server route/tool layers: https://expressjs.com/en/guide/migrating-5.html
- Verified on 2026-03-02 via Context7 MCP (`/jestjs/jest`): Jest documentation for parity assertions across classic MCP and MCP v2 contract tests: https://context7.com/jestjs/jest/llms.txt
- Verified on 2026-03-02 via Context7 MCP (`/mermaid-js/mermaid`): Mermaid flowchart and sequence syntax for documenting blocking reingest flow and terminal contract transitions: https://context7.com/mermaid-js/mermaid/llms.txt

#### Subtasks

1. [x] Update shared reingest service result shape to terminal-only output.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`
   - Required behavior: success payload uses terminal `status` (`completed|cancelled|error`) and required fields (`status`, `operation`, `runId`, `sourceId`, `durationMs`, `files`, `chunks`, `embedded`, `errorCode`).
2. [x] Implement blocking terminal wait in reingest service using ingest runtime status.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`, `server/src/ingest/ingestJob.ts`
   - Required behavior: after `reembed(...)` returns `runId`, wait until terminal state (`completed|cancelled|error|skipped`) via a shared helper exported from `ingestJob.ts`; map internal `skipped` to external `completed`, and populate terminal counters/errorCode/duration deterministically.
3. [x] Add explicit terminal payload mapping rules in the service for each terminal state.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`
   - Required behavior: `operation` is always `reembed`, `errorCode` is null unless terminal status is `error`, and cancelled paths return last-known counters.
4. [x] Keep pre-run validation failures in JSON-RPC/protocol error envelopes and keep input shape `sourceId`-only.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`
   - Required behavior: invalid `sourceId`/unknown root/busy-before-start remain protocol errors; only post-start outcomes use terminal result payload. Do not add `wait`, `blocking`, or similar request flags. This story intentionally keeps existing JSON-RPC protocol-error behavior for pre-run validation (no migration to `result.isError` in scope).
5. [x] Update classic MCP tool output schema away from `status: started`.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/mcp/server.ts`
   - Required behavior: output schema matches terminal-only contract and no non-terminal values remain.
6. [x] Update classic MCP runtime payload mapping to match the terminal-only contract.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/mcp/server.ts`
   - Required behavior: emitted payload matches terminal field names and status semantics for all outcomes.
7. [x] Update MCP v2 reingest tool runtime mapping to match classic payload semantics.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/mcp2/tools/reingestRepository.ts`
   - Required behavior: same field names/status semantics as classic for the same terminal outcome.
8. [x] Preserve keep-alive behavior during blocking wait using existing keepalive controller behavior.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/mcp/server.ts`, `server/src/mcp2/router.ts`, `server/src/mcpCommon/keepAlive.ts`
   - Required behavior: long waits continue heartbeats and do not alter final payload shape. Avoid introducing new keepalive branches unless required to satisfy this story.
9. [x] Add service unit test: blocking wait returns one terminal `completed` payload after run completion.
   - Starter snippet (adapt names to exact existing symbols): `expect(result.status).toBe('completed');`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC8, AC18.
   - Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/ingest/reingestService.ts`
   - Test type: Unit (service behavior).
   - Test location: `server/src/test/unit/reingestService.test.ts`.
   - Test description: invoke reingest and assert result resolves only after terminal completion with `status=completed`.
   - Test purpose: prove service no longer returns non-terminal `started` output.
10. [x] Add service unit test: internal `skipped` terminal state maps to external `completed`.

- Starter snippet (adapt names to exact existing symbols): `expect(result.status).toBe('completed');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC16, AC18.
- Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/ingest/reingestService.ts`
- Test type: Unit (status mapping).
- Test location: `server/src/test/unit/reingestService.test.ts`.
- Test description: simulate `skipped` terminal state and assert mapped external status is `completed`.
- Test purpose: keep terminal success semantics consistent for callers.

11. [x] Add service unit test: terminal payload includes all required top-level fields with deterministic counters and duration.

- Starter snippet (adapt names to exact existing symbols): `expect(result).toMatchObject({ status, operation: 'reembed', runId, sourceId, durationMs, files, chunks, embedded, errorCode });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC18, AC19.
- Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/ingest/reingestService.ts`
- Test type: Unit (contract completeness).
- Test location: `server/src/test/unit/reingestService.test.ts`.
- Test description: assert required field set exists with numeric counters/duration and deterministic mapping.
- Test purpose: enforce stable terminal payload schema for MCP consumers.

12. [x] Add MCP classic contract test: final tool payload never contains `status: started`.

- Starter snippet (adapt names to exact existing symbols): `expect(payload.status).not.toBe('started');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC5, AC8.
- Files to read/edit: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/mcp/server.ts`
- Test type: Contract test (MCP classic).
- Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
- Test description: call `reingest_repository` and assert final classic payload is terminal-only.
- Test purpose: prevent legacy non-terminal response regression on classic MCP.

13. [x] Add MCP v2 contract test: final tool payload never contains `status: started`.

- Starter snippet (adapt names to exact existing symbols): `expect(payload.status).not.toBe('started');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC5, AC8.
- Files to read/edit: `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/mcp2/tools/reingestRepository.ts`
- Test type: Contract test (MCP v2).
- Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: call `reingest_repository` through MCP v2 and assert final payload is terminal-only.
- Test purpose: prevent legacy non-terminal response regression on MCP v2.

14. [x] Add parity test: classic and MCP v2 emit identical field names/semantics for same terminal success outcome.

- Starter snippet (adapt names to exact existing symbols): `expect(classicPayload).toEqual(v2Payload);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC20.
- Files to read/edit: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`
- Test type: Contract parity test.
- Test location: `server/src/test/unit/mcp.reingest.classic.test.ts` and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: run same scenario through both MCP surfaces and compare normalized terminal payloads.
- Test purpose: guarantee cross-surface contract lock-step.

15. [x] Add cancel-path test: GUI cancellation during blocking wait returns terminal `status: cancelled` result.

- Starter snippet (adapt names to exact existing symbols): `expect(payload.status).toBe('cancelled');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC10, AC19.
- Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`
- Test type: Integration/contract test.
- Test location: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: cancel ingest externally while MCP wait is in progress; assert returned terminal payload is `cancelled`.
- Test purpose: preserve correct in-run cancellation contract boundary.

16. [x] Add protocol-boundary test: pre-run validation failures remain JSON-RPC protocol errors.

- Starter snippet (adapt names to exact existing symbols): `expect(response.error).toBeDefined(); expect(response.result).toBeUndefined();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC24.
- Files to read/edit: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/test/unit/reingestService.test.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`
- Test type: Contract boundary test.
- Test location: `server/src/test/unit/mcp.reingest.classic.test.ts` and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: send invalid input / unknown source / busy-before-start and assert protocol error envelope is returned.
- Test purpose: enforce pre-run error boundary invariants.

17. [x] Add protocol-boundary test: post-start failures return terminal result payload (not JSON-RPC error).

- Starter snippet (adapt names to exact existing symbols): `expect(payload.status).toBe('error'); expect(response.error).toBeUndefined();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC24.
- Files to read/edit: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/test/unit/reingestService.test.ts`
- Test type: Contract boundary test.
- Test location: `server/src/test/unit/mcp.reingest.classic.test.ts` and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: force failure after run starts and assert terminal payload is returned in result channel.
- Test purpose: prevent accidental promotion of in-run failures to protocol errors.

18. [x] Add transport-wrapper test: both MCP surfaces keep `result.content[0].text` JSON-string wrapper.

- Starter snippet (adapt names to exact existing symbols): `expect(typeof response.result.content[0].text).toBe('string');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC20.
- Files to read/edit: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`
- Test type: Transport contract test.
- Test location: `server/src/test/unit/mcp.reingest.classic.test.ts` and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: assert unchanged text-wrapper transport shape around terminal payload on both surfaces.
- Test purpose: preserve existing client parser compatibility.

19. [x] Add keepalive test: heartbeat messages continue during blocking wait.

- Starter snippet (adapt names to exact existing symbols): `expect(keepaliveTickCount).toBeGreaterThan(0);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC7.
- Files to read/edit: `server/src/test/unit/mcp.keepalive.helper.test.ts`, `server/src/mcpCommon/keepAlive.ts`
- Test type: Integration/resilience test.
- Test location: `server/src/test/unit/mcp.keepalive.helper.test.ts`.
- Test description: run long blocking wait and assert keepalive heartbeat executes while waiting.
- Test purpose: prevent long-running MCP calls from idle timeouts.

20. [x] Add keepalive-close-path test: disconnect during wait stops keepalive cleanly without crash.

- Starter snippet (adapt names to exact existing symbols): `expect(serverProcessCrashed).toBe(false);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC7.
- Files to read/edit: `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/mcp2/router.ts`
- Test type: Integration/resilience test.
- Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts` and `server/src/test/unit/mcp.reingest.classic.test.ts`.
- Test description: close/disconnect response path during blocking wait and assert lifecycle closes safely.
- Test purpose: ensure transport resilience and process stability.

21. [x] Add terminal error contract test: `status=error` has non-null `errorCode` and full required field set.

- Starter snippet (adapt names to exact existing symbols): `expect(payload.errorCode).not.toBeNull();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC18, AC19.
- Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`
- Test type: Unit + contract test.
- Test location: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: assert terminal error output contains non-null code and all required top-level fields.
- Test purpose: enforce predictable machine-readable error contract.

22. [x] Add terminal response-shape test: tool result has no top-level `message` and only one terminal payload per call.

- Starter snippet (adapt names to exact existing symbols): `expect(payload.message).toBeUndefined(); expect(terminalPayloadCount).toBe(1);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC8, AC9.
- Files to read/edit: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`
- Test type: Contract shape test.
- Test location: `server/src/test/unit/mcp.reingest.classic.test.ts` and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: assert final payload omits top-level `message` and emits one terminal contract object per call.
- Test purpose: keep tool outputs deterministic and summary-only.

23. [x] Update `design.md` with blocking reingest architecture flow and Mermaid diagram(s) for classic + MCP v2 parity.

- Starter snippet (adapt names to exact existing symbols): `Add Mermaid flowchart/sequence diagrams covering pre-run protocol-error boundary, blocking wait, keepalive during wait, and terminal payload completion.`
- Dependency note: execute this after Task 4 implementation/tests so diagrams reflect final runtime parity across both MCP surfaces.
- Docs: https://context7.com/mermaid-js/mermaid/llms.txt | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC22 documentation completeness plus AC20/AC24 flow-boundary clarity.
- Files to read/edit: `design.md`, `server/src/ingest/reingestService.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`, `server/src/mcp2/router.ts`
- Document name: `design.md`.
- Document location: `design.md`.
- Document description: document blocking reingest flow, protocol boundaries, and classic/v2 parity with Mermaid diagrams.
- Document purpose: make contract flow behavior and integration boundaries explicit for implementers and reviewers.

24. [x] If this task adds or removes files, update `projectStructure.md` after finishing those file changes.

- Starter snippet (adapt names to exact existing symbols): `Add entries for any new/removed files introduced by Task 4 across server ingest, MCP, and server test suites.`
- Dependency note: execute this after all file add/remove subtasks in Task 4, including subtasks 25-30, and before moving to the next task.
- Docs: https://www.markdownguide.org/basic-syntax/
- Acceptance criteria focus: AC22 documentation completeness.
- Files to read/edit: `projectStructure.md`, `server/src/ingest/*`, `server/src/mcp/*`, `server/src/mcp2/*`, `server/src/test/unit/*`
- Document name: `projectStructure.md`.
- Document location: `projectStructure.md`.
- Document description: record Task 4 file additions/removals across ingest, MCP classic/v2, and related tests.
- Document purpose: keep file-map documentation consistent with reingest contract implementation changes.
- Required behavior: update `projectStructure.md` with every file path added or removed by Task 4 (no wildcard summaries), and remove entries for deleted files.

25. [x] Add bounded wait guard in reingest service so blocking calls cannot hang indefinitely.

- Starter snippet (adapt names to exact existing symbols): `const terminal = await waitForTerminalIngestStatus(runId, { timeoutMs, pollMs });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC7, AC18, AC19, AC24.
- Files to read/edit: `server/src/ingest/reingestService.ts`, `server/src/ingest/ingestJob.ts`
- Required behavior: expose and use `waitForTerminalIngestStatus(runId, { timeoutMs, pollMs })` with task-local constants in `reingestService.ts` (no new env/config flags in this story); when timeout elapses, return one terminal result payload with `status='error'`, non-null `errorCode`, and required counters/duration fields.

26. [x] Add service unit test: timeout during blocking wait returns deterministic terminal error payload (not JSON-RPC error, not hang).

- Starter snippet (adapt names to exact existing symbols): `expect(result).toMatchObject({ status: 'error', errorCode: 'WAIT_TIMEOUT' });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC7, AC18, AC19, AC24.
- Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/ingest/reingestService.ts`
- Test type: Unit (timeout boundary).
- Test location: `server/src/test/unit/reingestService.test.ts`.
- Test description: simulate no terminal transition until timeout and assert one terminal `status=error` result with non-null `errorCode`.
- Test purpose: guarantee blocking contract terminates deterministically under stalled runtime status.

27. [x] Add missing-run-after-start contract tests on both MCP surfaces.

- Starter snippet (adapt names to exact existing symbols): `expect(payload).toMatchObject({ status: 'error', errorCode: 'RUN_STATUS_MISSING' });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
- Acceptance criteria focus: AC18, AC19, AC20, AC24.
- Files to read/edit: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/test/unit/reingestService.test.ts`, `server/src/ingest/reingestService.ts`
- Test type: Unit + contract test.
- Test location: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: simulate run started then runtime status missing; assert both MCP surfaces emit one terminal error result payload with stable shape.
- Test purpose: prevent undefined/null run-state handling from causing hangs or protocol-channel regressions.

28. [x] Add terminal-field constraint test: `completed` and `cancelled` payloads emit `errorCode=null`.

- Starter snippet (adapt names to exact existing symbols): `expect(payload.errorCode).toBeNull();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification | https://context7.com/jestjs/jest/llms.txt
- Acceptance criteria focus: AC19.
- Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`
- Test type: Unit + contract test.
- Test location: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: assert `errorCode` is null for successful and cancelled terminal results across service and both MCP surfaces.
- Test purpose: lock field-level terminal constraints so clients can trust result semantics.

29. [x] Add cancelled-counter retention test: cancelled terminal payload returns last-known counters when available.

- Starter snippet (adapt names to exact existing symbols): `expect(payload).toMatchObject({ status: 'cancelled', files: lastKnown.files, chunks: lastKnown.chunks, embedded: lastKnown.embedded });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://context7.com/jestjs/jest/llms.txt
- Acceptance criteria focus: AC10, AC19.
- Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/ingest/reingestService.ts`
- Test type: Unit + contract edge-case test.
- Test location: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: cancel during active progress and assert returned counters match last-known runtime values rather than reset/empty defaults.
- Test purpose: preserve deterministic cancellation summaries for AI/client consumers.

30. [x] Add request-shape guard tests: extra `wait`/`blocking` flags are rejected on both MCP surfaces.

- Starter snippet (adapt names to exact existing symbols): `expect(response.error).toBeDefined(); expect(response.error.code).toBe(-32602);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification | https://context7.com/jestjs/jest/llms.txt
- Acceptance criteria focus: AC6, AC24.
- Files to read/edit: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`
- Test type: Contract validation test.
- Test location: `server/src/test/unit/mcp.reingest.classic.test.ts` and `server/src/test/unit/mcp2.reingest.tool.test.ts`.
- Test description: call `reingest_repository` with unsupported `wait`/`blocking` arguments and assert protocol-level invalid-params errors.
- Test purpose: enforce non-configurable blocking behavior and prevent interface drift.

31. [x] Add deterministic blocking-reingest lifecycle logs for manual verification.

- Starter snippet (adapt names to exact existing symbols): `logger.info('[DEV-0000038][T4] REINGEST_BLOCKING_WAIT_STARTED sourceId=%s runId=%s', sourceId, runId);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://nodejs.org/api/console.html | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC5, AC7, AC8, AC19, AC20, AC24.
- Files to read/edit: `server/src/ingest/reingestService.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`
- Required log line: `[DEV-0000038][T4] REINGEST_BLOCKING_WAIT_STARTED sourceId=<id> runId=<id>`.
- Required log line: `[DEV-0000038][T4] REINGEST_TERMINAL_RESULT status=<completed|cancelled|error> runId=<id> errorCode=<code|null>`.
- Required behavior: emit exactly one STARTED and one TERMINAL log for each reingest request.

32. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build:summary:server` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` and resolve errors.
2. [x] `npm run test:summary:server` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/server-tests-*.log`) and resolve listed failures.
3. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001` for blocking reingest flows; verify in compose server logs one `[DEV-0000038][T4] REINGEST_BLOCKING_WAIT_STARTED ...` and one `[DEV-0000038][T4] REINGEST_TERMINAL_RESULT ...` log per run (matching `runId`), and verify browser debug console has no unexpected errors.
6. [x] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Subtasks 1-4: Updated `runReingestRepository` to return terminal-only payloads (`completed|cancelled|error`) with required top-level fields, strict `sourceId`-only request shape, and pre-run JSON-RPC validation boundary preserved.
- Subtasks 2-3, 25: Added shared wait helper `waitForTerminalIngestStatus(...)` in `ingestJob.ts` and wired bounded polling in reingest service (`timeoutMs`/`pollMs`) with deterministic timeout/missing-run terminal error mapping.
- Subtasks 5-7: Updated classic MCP tool definition/schema and MCP v2 reingest tool description/runtime to align both surfaces on the same blocking terminal contract semantics.
- Subtasks 8, 19-20: Preserved keepalive behavior and added heartbeat/disconnect resilience coverage in `mcp.keepalive.helper.test.ts`, `mcp.reingest.classic.test.ts`, and `mcp2.reingest.tool.test.ts`.
- Subtasks 9-18, 21-22, 26-30: Rebuilt Task 4 unit/contract tests to cover terminal mapping (`skipped->completed`), required field shape, protocol boundary split, request-shape guards (`wait`/`blocking` rejected), timeout/missing-run errors, cancelled counter retention, and text-wrapper compatibility.
- Subtask 31: Added deterministic Task 4 lifecycle logs in reingest service: `[DEV-0000038][T4] REINGEST_BLOCKING_WAIT_STARTED ...` and `[DEV-0000038][T4] REINGEST_TERMINAL_RESULT ...`.
- Subtask 23: Updated `design.md` reingest sections and Mermaid diagrams to document blocking wait flow, pre-run vs post-start error boundary, and classic/MCP v2 parity.
- Subtask 24: No files were added/removed in Task 4; `projectStructure.md` required no structural path updates.
- Subtask 32: Ran `npm run lint --workspaces` (pass with existing unrelated import-order warnings) and `npm run format:check --workspaces`; formatting initially failed for `server/src/test/unit/reingestService.test.ts`, then passed after running Prettier write on that file.
- Testing 1: `npm run build:summary:server` passed (`warnings: 0`), log `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run test:summary:server` completed successfully; parsed latest summary log `test-results/server-tests-2026-03-02T10-28-20-484Z.log` -> `tests run: 941`, `passed: 941`, `failed: 0`.
- Testing 3: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`), log `logs/test-summaries/compose-build-latest.log`.
- Testing 4: `npm run compose:up` passed and started client/server/chroma/mongo/playwright-mcp services healthy.
- Testing 5: Manual host-mapped verification executed at `http://host.docker.internal:5001`; blocking classic MCP reingest call returned terminal payload (`status=completed`) and `/logs` contained one matching marker pair for runId `306ef19b-08f5-4804-b058-6f56ba8014d1`; browser console check reported no `error` entries. Runtime gotcha: `localhost` targets the in-container server, so host-mapped checks were executed via `host.docker.internal` and compose data volumes were reset once to clear stale lock state before seeding an ingest root.
- Testing 6: `npm run compose:down` completed successfully and removed compose services/network.

---

### 5. Server Message Contract: normalize ingest listing status/phase mapping and active overlay visibility

- Task Status: **__done__**
- Git Commits: `263c7a1`

#### Overview

Apply one shared status/phase mapping and active-overlay merge path for `/ingest/roots` and MCP classic `ListIngestedRepositories`, including schema version bump and synthesized active entries when persisted metadata is missing.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: JSON Schema reference for field presence/omission rules (`status`, optional `phase`, schema-version compatibility): https://json-schema.org/understanding-json-schema/
- Verified on 2026-03-02: MCP tools specification for consistent output contracts between `/ingest/roots` and MCP listing surfaces: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Verified on 2026-03-02: MDN `Object` reference for safe merge/overlay behavior while preserving persisted metadata fields: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Verified on 2026-03-02 via Context7 MCP (`/jestjs/jest`): Jest documentation for schema-version and synthesized-entry contract assertions in ingest listing tests: https://context7.com/jestjs/jest/llms.txt
- Verified on 2026-03-02 via Context7 MCP (`/mermaid-js/mermaid`): Mermaid flowchart syntax for documenting ingest status/phase mapping and active-overlay precedence in `design.md`: https://context7.com/mermaid-js/mermaid/llms.txt

#### Subtasks

1. [x] Implement shared internal->external status normalization (`status`/`phase`) in the existing listing path.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`
   - Required behavior: `queued|scanning|embedding -> status=ingesting + phase`; `completed|cancelled|error -> same status and no phase`; `skipped -> completed`.
2. [x] Expose active ingest run context with identity needed for overlay and synthesized entries.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`
   - Required behavior: expose active run identity/context including run id plus root/source identity and current state/counters so list surfaces can build synthesized entries when persisted metadata is missing.
3. [x] Apply normalized status/phase semantics to `listIngestedRepositories` output.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`
   - Required behavior: tool-level listing output always emits external status semantics and valid phase presence/omission rules.
4. [x] Apply normalized status/phase semantics to `/ingest/roots` response by reusing existing listing normalization.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/routes/ingestRoots.ts`, `server/src/mcp/server.ts`, `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsIngestedRepos.ts`
   - Required behavior: both surfaces emit identical status semantics and `schemaVersion: "0000038-status-phase-v1"`.
5. [x] Implement active overlay precedence on top of persisted listing metadata.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`
   - Required behavior: overlay status/phase/runId/live counters come from active runtime state while persisted metadata fields remain intact unless newer terminal state exists.
6. [x] Implement synthesized active-entry fallback when persisted metadata is missing, reusing existing path mapping.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`
   - Required behavior: active run remains visible with status/phase/runId/counters while last completed metadata is retained where available. Synthesized entries must include identity/path fields (`id`, `containerPath`, `hostPath`) and include `hostPathWarning` when mapping is incomplete using existing `mapIngestPath` behavior (no duplicated mapping logic).
7. [x] Update classic MCP `ListIngestedRepositories` output schema for repo-level `status` and optional `phase`.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/mcp/server.ts`
   - Required behavior: output schema and runtime payload remain aligned.
8. [x] Bump and propagate shared ingest listing schema version constant.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`
   - Required behavior: all listing surfaces emit `schemaVersion: "0000038-status-phase-v1"` from one shared constant path.
9. [x] Update only the runtime listing schemas/contracts required by this story’s external surfaces.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/mcp/server.ts`, `server/src/routes/ingestRoots.ts`, `server/src/lmstudio/toolService.ts`
   - Required behavior: runtime contracts for `/ingest/roots` and MCP classic listing document and emit external `status` values with optional `phase` omitted for terminal statuses.
10. [x] Add status-mapping unit test: internal `queued` maps to external `status=ingesting` with `phase=queued`.

- Starter snippet (adapt names to exact existing symbols): `expect(repo).toMatchObject({ status: 'ingesting', phase: 'queued' });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC11, AC14, AC25.
- Files to read/edit: `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/lmstudio/toolService.ts`
- Test type: Unit (mapping contract).
- Test location: `server/src/test/unit/tools-ingested-repos.test.ts`.
- Test description: assert `queued` runtime state maps to external ingesting/queued shape.
- Test purpose: guarantee deterministic mapping for active queued state.

11. [x] Add status-mapping unit test: internal `scanning` maps to external `status=ingesting` with `phase=scanning`.

- Starter snippet (adapt names to exact existing symbols): `expect(repo).toMatchObject({ status: 'ingesting', phase: 'scanning' });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC11, AC14, AC25.
- Files to read/edit: `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/lmstudio/toolService.ts`
- Test type: Unit (mapping contract).
- Test location: `server/src/test/unit/tools-ingested-repos.test.ts`.
- Test description: assert `scanning` runtime state maps to external ingesting/scanning shape.
- Test purpose: prevent phase drift for scanning state.

12. [x] Add status-mapping unit test: internal `embedding` maps to external `status=ingesting` with `phase=embedding`.

- Starter snippet (adapt names to exact existing symbols): `expect(repo).toMatchObject({ status: 'ingesting', phase: 'embedding' });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC11, AC14, AC25.
- Files to read/edit: `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/lmstudio/toolService.ts`
- Test type: Unit (mapping contract).
- Test location: `server/src/test/unit/tools-ingested-repos.test.ts`.
- Test description: assert `embedding` runtime state maps to external ingesting/embedding shape.
- Test purpose: keep active embedding status visible and phase-correct.

13. [x] Add terminal-mapping unit test: internal `skipped` maps to external `status=completed`.

- Starter snippet (adapt names to exact existing symbols): `expect(repo.status).toBe('completed');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC15, AC25.
- Files to read/edit: `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
- Test type: Unit + contract test.
- Test location: `server/src/test/unit/tools-ingested-repos.test.ts` and `server/src/test/unit/mcp-ingested-repositories.test.ts`.
- Test description: assert no external `skipped` value is emitted.
- Test purpose: normalize success semantics across surfaces.

14. [x] Add terminal-phase omission test: `completed` responses omit `phase`.

- Starter snippet (adapt names to exact existing symbols): `expect(repo.phase).toBeUndefined();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC15.
- Files to read/edit: `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
- Test type: Contract test (REST + MCP output).
- Test location: `server/src/test/unit/ingest-roots-dedupe.test.ts` and `server/src/test/unit/mcp-ingested-repositories.test.ts`.
- Test description: assert completed entries omit `phase` on both listing surfaces.
- Test purpose: prevent terminal payload ambiguity.

15. [x] Add terminal-phase omission test: `cancelled` responses omit `phase`.

- Starter snippet (adapt names to exact existing symbols): `expect(repo.phase).toBeUndefined();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC15.
- Files to read/edit: `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
- Test type: Contract test (REST + MCP output).
- Test location: `server/src/test/unit/ingest-roots-dedupe.test.ts` and `server/src/test/unit/mcp-ingested-repositories.test.ts`.
- Test description: assert cancelled entries omit `phase` on both listing surfaces.
- Test purpose: keep terminal cancelled payloads deterministic.

16. [x] Add terminal-phase omission test: `error` responses omit `phase`.

- Starter snippet (adapt names to exact existing symbols): `expect(repo.phase).toBeUndefined();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC15.
- Files to read/edit: `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
- Test type: Contract test (REST + MCP output).
- Test location: `server/src/test/unit/ingest-roots-dedupe.test.ts` and `server/src/test/unit/mcp-ingested-repositories.test.ts`.
- Test description: assert error entries omit `phase` on both listing surfaces.
- Test purpose: avoid leaking active-state fields into terminal error payloads.

17. [x] Add visibility regression test: active overlays keep repository visible during ingest.

- Starter snippet (adapt names to exact existing symbols): `expect(repos.find((r) => r.id === targetId)).toBeDefined();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC11, AC12, AC27.
- Files to read/edit: `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
- Test type: Integration/contract regression test.
- Test location: `server/src/test/unit/tools-ingested-repos.test.ts`.
- Test description: assert active run repository appears in both REST and MCP listings while ingest is in progress.
- Test purpose: eliminate disappearance bug during active ingest.

18. [x] Add synthesized-entry contract test: when persisted metadata is missing, emitted entry still includes required identity fields and `hostPathWarning` when applicable.

- Starter snippet (adapt names to exact existing symbols): `expect(repo).toMatchObject({ id, containerPath, hostPath });`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC27.
- Files to read/edit: `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
- Test type: Contract edge-case test.
- Test location: `server/src/test/unit/tools-ingested-repos.test.ts`.
- Test description: assert synthesized entries are emitted with required identity/path fields and warning behavior.
- Test purpose: guarantee listing continuity when persistence temporarily lacks root metadata.

19. [x] Add schema-version migration test: `/ingest/roots` and MCP classic listing both emit `0000038-status-phase-v1`.

- Starter snippet (adapt names to exact existing symbols): `expect(schemaVersion).toBe('0000038-status-phase-v1');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC28.
- Files to read/edit: `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`, `server/src/routes/ingestRoots.ts`, `server/src/mcp/server.ts`
- Test type: Contract versioning test.
- Test location: `server/src/test/unit/ingest-roots-dedupe.test.ts` and `server/src/test/unit/mcp-ingested-repositories.test.ts`.
- Test description: assert both external listing surfaces emit the same updated schema version constant.
- Test purpose: provide explicit contract-version signal for downstream clients.

20. [x] Add overlay-precedence regression test for persisted metadata retention.

- Starter snippet (adapt names to exact existing symbols): `expect(repo.lastIngestAt).toBe(previousTerminal.lastIngestAt); expect(repo.status).toBe('ingesting');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Acceptance criteria focus: AC13, AC26.
- Files to read/edit: `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
- Required coverage: active overlay replaces run-state fields only, while persisted metadata (`lastIngestAt`, lock/model metadata, last terminal error context) remains present until a newer terminal write occurs.
- Test type: Regression test (overlay merge precedence).
- Test location: `server/src/test/unit/tools-ingested-repos.test.ts` and `server/src/test/unit/ingest-roots-dedupe.test.ts` and `server/src/test/unit/mcp-ingested-repositories.test.ts`.
- Test description: assert overlay updates run-state fields while retained persisted metadata remains unchanged until newer terminal write.
- Test purpose: preserve critical metadata continuity during active overlays.

21. [x] Update `design.md` with status/phase mapping architecture flow and Mermaid diagram(s) for active-overlay precedence.

- Starter snippet (adapt names to exact existing symbols): `Add Mermaid flowchart showing internal ingest states -> external status/phase mapping, synthesized entry path, and overlay precedence with persisted metadata retention.`
- Dependency note: execute this after Task 5 implementation/tests so mapping diagrams reflect final contract behavior.
- Docs: https://context7.com/mermaid-js/mermaid/llms.txt | https://json-schema.org/understanding-json-schema/
- Acceptance criteria focus: AC22 documentation completeness plus AC25/AC26 mapping clarity.
- Files to read/edit: `design.md`, `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`, `server/src/mcp/server.ts`
- Document name: `design.md`.
- Document location: `design.md`.
- Document description: document status/phase mapping, synthesized-entry flow, and overlay precedence using Mermaid flow diagrams.
- Document purpose: clarify external contract mapping logic across REST and MCP listing surfaces.

22. [x] If this task adds or removes files, update `projectStructure.md` after finishing those file changes.

- Starter snippet (adapt names to exact existing symbols): `Add entries for any new/removed files introduced by Task 5 in server listing routes/services and ingest listing test suites.`
- Dependency note: execute this after all file add/remove subtasks in Task 5, including subtasks 23 and 24, and before moving to the next task.
- Docs: https://www.markdownguide.org/basic-syntax/
- Acceptance criteria focus: AC22 documentation completeness.
- Files to read/edit: `projectStructure.md`, `server/src/lmstudio/*`, `server/src/routes/*`, `server/src/mcp/*`, `server/src/test/unit/*`
- Document name: `projectStructure.md`.
- Document location: `projectStructure.md`.
- Document description: record Task 5 file additions/removals across listing services/routes and associated tests.
- Document purpose: ensure structural documentation matches ingest visibility and mapping implementation artifacts.
- Required behavior: update `projectStructure.md` with every file path added or removed by Task 5 (no wildcard summaries), and remove entries for deleted files.

23. [x] Update external OpenAPI document for `/ingest/roots` and `/tools/ingested-repos` to match `status`/optional `phase` and `0000038-status-phase-v1`.

- Starter snippet (adapt names to exact existing symbols): `Update OpenAPI schemas so active states emit status=ingesting + phase, terminal states omit phase, and schemaVersion matches 0000038-status-phase-v1.`
- Dependency note: execute after status/phase mapping implementation so OpenAPI reflects runtime truth.
- Docs: https://json-schema.org/understanding-json-schema/ | https://swagger.io/specification/
- Acceptance criteria focus: AC22, AC25, AC28.
- Files to read/edit: `openapi.json`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/lmstudio/toolService.ts`
- Required behavior: OpenAPI path schemas for `/ingest/roots` and `/tools/ingested-repos` explicitly include external `status` semantics and `phase` presence/omission rules that match runtime payloads.

24. [x] Add OpenAPI contract test coverage for the new ingest listing status/phase rules and schema version.

- Starter snippet (adapt names to exact existing symbols): `assert.ok(rootProps.status); assert.ok(repoProps.status); assert.ok(topProps.schemaVersion);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://json-schema.org/understanding-json-schema/ | https://context7.com/jestjs/jest/llms.txt
- Acceptance criteria focus: AC22, AC25, AC28.
- Files to read/edit: `server/src/test/unit/openapi.contract.test.ts`, `openapi.json`
- Test type: Contract test (OpenAPI schema assertions).
- Test location: `server/src/test/unit/openapi.contract.test.ts`.
- Test description: assert `/ingest/roots` and `/tools/ingested-repos` OpenAPI schemas include `status`, optional `phase` semantics, and `schemaVersion` expectations aligned with story contract.
- Test purpose: prevent documentation/runtime drift for external listing contracts.

25. [x] Add deterministic ingest-listing mapping logs for manual verification.

- Starter snippet (adapt names to exact existing symbols): `logger.info('[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED sourceId=%s internal=%s status=%s phase=%s', sourceId, internalState, status, phase ?? 'none');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://nodejs.org/api/console.html | https://json-schema.org/understanding-json-schema/
- Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26.
- Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`
- Required log line: `[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED sourceId=<id> internal=<state> status=<status> phase=<phase|none>`.
- Required log line: `[DEV-0000038][T5] INGEST_ACTIVE_OVERLAY_APPLIED sourceId=<id> synthesized=<true|false>`.
- Required behavior: emit mapping logs for each listed repo and overlay logs when active-run data is merged.

26. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build:summary:server` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` and resolve errors.
2. [x] `npm run test:summary:server` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/server-tests-*.log`) and resolve listed failures.
3. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001` for ingest listing visibility; verify in compose server logs that `[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED ...` and `[DEV-0000038][T5] INGEST_ACTIVE_OVERLAY_APPLIED ...` appear with expected `status/phase` values and overlay flags, and verify browser debug console has no unexpected errors.
6. [x] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Subtasks 1-9: Implemented shared internal->external mapping (`ingesting/completed/cancelled/error` + optional `phase`) in listing paths, added active runtime overlay + synthesized entry fallback, aligned `/ingest/roots` and MCP classic listing semantics, and bumped shared schema version to `0000038-status-phase-v1`.
- Subtasks 2, 5-6: Added `getActiveRunContexts()` in `ingestJob.ts` to expose active run identity/state/counters for overlay synthesis while preserving lock-owner precedence.
- Subtasks 7, 9: Updated classic MCP `ListIngestedRepositories` output schema/runtime to require repo-level `status` and optional `phase` while keeping terminal `phase` omission semantics.
- Subtasks 10-20: Added/updated unit+contract coverage across tools/ingest-roots/MCP listing tests for queued|scanning|embedding mapping, skipped->completed normalization, terminal phase omission, active-overlay visibility, synthesized-entry identity/path fields, schema-version assertions, and persisted-metadata retention.
- Subtasks 21-22: Added Task 5 mapping/overlay architecture section with Mermaid diagrams to `design.md`; no files were added/removed, so `projectStructure.md` required no path updates.
- Subtasks 23-24: Updated `openapi.json` for `/ingest/roots` and `/tools/ingested-repos` to document external `status`+optional `phase` semantics and fixed schema-version enum; extended `openapi.contract.test.ts` assertions accordingly.
- Subtask 25: Added deterministic Task 5 listing logs (`[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED ...`, `[DEV-0000038][T5] INGEST_ACTIVE_OVERLAY_APPLIED ...`) in listing normalization/overlay paths.
- Subtask 26: Ran `npm run lint --workspaces` (pass with existing unrelated import-order warnings) and `npm run format:check --workspaces`; formatting initially failed for 5 modified server files, then passed after Prettier write on those files.
- Testing 1: `npm run build:summary:server` passed (`warnings: 0`), log `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run test:summary:server` passed (`tests run: 951`, `failed: 0`), log `test-results/server-tests-2026-03-02T12-18-58-567Z.log`.
- Testing 3: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`), log `logs/test-summaries/compose-build-latest.log`.
- Testing 4: `npm run compose:up` completed successfully; compose services (client/server/chroma/mongo/playwright-mcp and observability sidecars) started healthy.
- Testing 5: Manual host-mapped verification executed against `http://host.docker.internal:5001/ingest`; live listing responses showed active mapping (`status=ingesting`, `phase=embedding`) and compose server log `logs/server.1.log` includes required Task 5 markers for `/tmp/task5-big` (`INGEST_LIST_STATUS_MAPPED ... status=ingesting phase=embedding` + `INGEST_ACTIVE_OVERLAY_APPLIED ... synthesized=true`), with browser console error scan returning no errors.
- Testing 6: `npm run compose:down` completed successfully and removed compose services/network.

---

### 6. Server: move no-change reembed exit ahead of AST and embedding work, and normalize successful terminal status

- Task Status: **__done__**
- Git Commits: `7d77b59`

#### Overview

Ensure no-change delta runs exit before AST parse/upsert/delete and before embedding calls, while still returning successful terminal `completed` semantics for no-change and deletion-only success paths.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: Tree-sitter project docs for AST parse pipeline constraints and parser invocation expectations: https://tree-sitter.github.io/tree-sitter/
- Verified on 2026-03-02: `tree-sitter-typescript` grammar repository docs used for TS/TSX parser behavior assumptions in this ingest pipeline: https://github.com/tree-sitter/tree-sitter-typescript
- Verified on 2026-03-02: Node.js event-loop guidance for early-return optimization (avoid unnecessary AST/embedding work): https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
- Verified on 2026-03-02: Mongoose docs for database write/read semantics used by ingest delta and terminal-state mapping paths: https://mongoosejs.com/docs/
- Verified on 2026-03-02 via Context7 MCP (`/jestjs/jest`): Jest documentation for deterministic unit/integration race test structure, including async and mock assertion patterns: https://context7.com/jestjs/jest/llms.txt
- Verified on 2026-03-02: Cucumber guides overview for feature/step convention and executable specification structure: https://cucumber.io/docs/guides/
- Verified on 2026-03-02: Cucumber 10-minute tutorial (guides subpath requested) for concrete feature/step wiring used by ingest race scenarios: https://cucumber.io/docs/guides/10-minute-tutorial/
- Verified on 2026-03-02 via Context7 MCP (`/mermaid-js/mermaid`): Mermaid flowchart syntax for documenting no-change early-return and cancellation boundary flow in `design.md`: https://context7.com/mermaid-js/mermaid/llms.txt

#### Subtasks

1. [x] Refactor reembed delta flow to compute no-change decision before AST parsing/writing and embedding loops.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`
   - Required behavior: no-change path exits without AST parse/upsert/delete and without embedding calls.
2. [x] Keep deletion-only delta cleanup logic simple and unchanged except for terminal contract normalization.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`
   - Required behavior: deletion-only successful path keeps existing cleanup behavior and avoids broad control-flow rewrites.
3. [x] Ensure successful no-change and deletion-only paths resolve as external-success `completed`.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`
4. [x] Add unit test: no-change delta path skips AST parsing/indexing operations.
   - Starter snippet (adapt names to exact existing symbols): `expect(astParseSpy).not.toHaveBeenCalled();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC17.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/ingest/ingestJob.ts`
   - Test type: Unit (pipeline short-circuit).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Test description: execute a no-change delta run and assert AST parse/index helpers are never invoked.
   - Test purpose: enforce early no-op exit before AST work.
5. [x] Add unit test: no-change delta path skips embedding calls.
   - Starter snippet (adapt names to exact existing symbols): `expect(embedSpy).not.toHaveBeenCalled();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC17.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingestService.test.ts`, `server/src/ingest/ingestJob.ts`
   - Test type: Unit (embedding bypass).
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` and `server/src/test/unit/reingestService.test.ts`.
   - Test description: execute a no-change delta run and assert no embedding provider calls occur.
   - Test purpose: verify no unnecessary embedding work is performed on no-change runs.
6. [x] Add unit test: deletion-only successful delta still returns external terminal `completed`.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingestService.test.ts`, `server/src/ingest/reingestService.ts`, `server/src/ingest/ingestJob.ts`
   - Test type: Unit (terminal status mapping).
   - Test location: `server/src/test/unit/reingestService.test.ts` and `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Test description: run a deletion-only successful reembed and assert external terminal status is `completed`.
   - Test purpose: keep successful deletion-only paths aligned with completed-success semantics.
7. [x] Add race regression test: cancellation near early-return boundary emits exactly one terminal outcome.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/features/ingest-delta-reembed.feature`, `server/src/test/steps/ingest-delta-reembed.steps.ts`
   - Test type: Integration or BDD race test.
   - Test location: `server/src/test/features/ingest-delta-reembed.feature` and `server/src/test/steps/ingest-delta-reembed.steps.ts`.
   - Test description: trigger cancellation at the no-change boundary and assert only one terminal state is emitted.
   - Test purpose: prevent duplicate/contradictory terminal outcomes in cancellation races.
8. [x] Add unit test: mixed-delta successful path returns external terminal status `completed`.
   - Starter snippet (adapt names to exact existing symbols): `expect(result.status).toBe('completed');`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingestService.test.ts`
   - Test type: Unit (mixed-delta success contract).
   - Test location: `server/src/test/unit/reingestService.test.ts` and `server/src/test/unit/ingest-ast-indexing.test.ts`.
   - Test description: run a delta containing adds/modifies/deletes and assert external terminal status resolves to `completed`.
   - Test purpose: verify successful mixed-delta runs keep stable success semantics.
9. [x] Add regression test: changed-file AST parse failure semantics remain unchanged.
   - Starter snippet (adapt names to exact existing symbols): `expect(result.status).toBe('error');`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC17 edge-case boundary protection.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingestService.test.ts`
   - Test type: Regression unit test.
   - Test location: `server/src/test/unit/ingest-ast-indexing.test.ts` and `server/src/test/unit/reingestService.test.ts`.
   - Test description: force AST parse failure on changed files and assert failure outcome/shape matches pre-story behavior.
   - Test purpose: ensure this story does not alter non-no-change AST error semantics.
10. [x] Update `design.md` with ingest pipeline flow changes and Mermaid diagram(s) for no-change early return and cancel boundary behavior.

- Starter snippet (adapt names to exact existing symbols): `Add Mermaid flowchart covering delta decision point, no-change short-circuit before AST/embedding, deletion-only success path, and cancellation boundary producing one terminal outcome.`
- Dependency note: execute this after Task 6 implementation/tests so the diagram reflects final ingest control flow.
- Docs: https://context7.com/mermaid-js/mermaid/llms.txt | https://cucumber.io/docs/guides/
- Acceptance criteria focus: AC22 documentation completeness plus AC16/AC17 flow clarity.
- Files to read/edit: `design.md`, `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`, `server/src/test/features/ingest-delta-reembed.feature`
- Document name: `design.md`.
- Document location: `design.md`.
- Document description: document no-change early-return and cancellation boundary flows with Mermaid diagrams.
- Document purpose: preserve a clear architectural reference for ingest control-flow and terminal-state behavior.

11. [x] If this task adds or removes files, update `projectStructure.md` after finishing those file changes.

- Starter snippet (adapt names to exact existing symbols): `Add entries for any new/removed files introduced by Task 6 in ingest pipeline and BDD/unit test paths.`
- Dependency note: execute this after all file add/remove subtasks in Task 6 and before moving to the next task.
- Docs: https://www.markdownguide.org/basic-syntax/
- Acceptance criteria focus: AC22 documentation completeness.
- Files to read/edit: `projectStructure.md`, `server/src/ingest/*`, `server/src/test/unit/*`, `server/src/test/features/*`, `server/src/test/steps/*`
- Document name: `projectStructure.md`.
- Document location: `projectStructure.md`.
- Document description: record Task 6 file additions/removals across ingest pipeline and BDD/unit test paths.
- Document purpose: keep the repository structure reference current for ingest-pipeline changes.
- Required behavior: update `projectStructure.md` with every file path added or removed by Task 6 (no wildcard summaries), and remove entries for deleted files.

12. [x] Add deterministic delta-path logs for no-change and changed-run manual verification.

- Starter snippet (adapt names to exact existing symbols): `logger.info('[DEV-0000038][T6] REEMBED_NO_CHANGE_EARLY_RETURN sourceId=%s runId=%s', sourceId, runId);`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://nodejs.org/api/console.html | https://tree-sitter.github.io/tree-sitter/
- Acceptance criteria focus: AC16, AC17.
- Files to read/edit: `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`
- Required log line: `[DEV-0000038][T6] REEMBED_NO_CHANGE_EARLY_RETURN sourceId=<id> runId=<id>`.
- Required log line: `[DEV-0000038][T6] REEMBED_DELTA_PATH deltaAdded=<n> deltaModified=<n> deltaDeleted=<n>`.
- Required behavior: no-change runs emit only EARLY_RETURN; changed runs emit DELTA_PATH.

13. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build:summary:server` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` and resolve errors.
2. [x] `npm run test:summary:server` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/server-tests-*.log`) and resolve listed failures.
3. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001` for no-change and changed-delta flows; verify in compose server logs that no-change runs emit `[DEV-0000038][T6] REEMBED_NO_CHANGE_EARLY_RETURN ...` without `REEMBED_DELTA_PATH`, and changed runs emit `[DEV-0000038][T6] REEMBED_DELTA_PATH ...`, then verify browser debug console has no unexpected errors.
6. [x] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Subtasks 1-3, 12: Refactored `ingestJob.ts` reembed delta path to early-return before AST/embedding on no-change and deletions-only runs, normalized successful reembed terminal state to `completed`, and added T6 delta logs (`REEMBED_NO_CHANGE_EARLY_RETURN`, `REEMBED_DELTA_PATH`).
- Subtasks 4-6, 8-9: Updated unit coverage in `ingest-ast-indexing.test.ts` and `reingestService.test.ts` for no-change AST/embedding bypass, deletion-only/mixed-delta `completed` semantics, and changed-file AST parse failure regression behavior.
- Subtask 7: Added BDD race scenario plus step wiring in `ingest-delta-reembed.feature`/`ingest-delta-reembed.steps.ts` to verify cancellation near no-change boundary stabilizes to one terminal state.
- Subtask 10: Added Task 6 architecture/documentation section with Mermaid diagrams in `design.md`.
- Subtask 11: No files added or removed in Task 6; `projectStructure.md` update not required.
- Subtask 13: Ran `npm run lint --workspaces` (pass with existing unrelated import-order warnings) and `npm run format:check --workspaces`; formatting initially failed for three Task 6 files, then passed after Prettier write.
- Testing 1: `npm run build:summary:server` passed (`warnings: 0`), log `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run test:summary:server` passed (`tests run: 956`, `failed: 0`), log `test-results/server-tests-2026-03-02T13-28-56-239Z.log`; initial timeout-guarded attempt at 10m was rerun with a 20m guard to completion.
- Testing 3: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`), log `logs/test-summaries/compose-build-latest.log`.
- Testing 4: `npm run compose:up` completed successfully; compose services started healthy (including `server`, `client`, `chroma`, `mongo`, and `playwright-mcp`).
- Testing 5: Manual host-mapped verification used `http://host.docker.internal:5001/ingest` (Playwright) plus `http://host.docker.internal:5010` reembed API calls; changed run `b8cfcf0e-a7c7-4b47-8070-1791213950a2` emitted `[DEV-0000038][T6] REEMBED_DELTA_PATH ...` and no-change run `70dcd195-f07b-4529-a86d-c9b3939774b0` emitted `[DEV-0000038][T6] REEMBED_NO_CHANGE_EARLY_RETURN ...` without `REEMBED_DELTA_PATH` for that run, verified in `logs/server.1.log`, and Playwright `browser_console_messages(level:error)` returned no errors.
- Testing 6: `npm run compose:down` completed successfully; compose services and network were removed cleanly.

---

### 7. Frontend: consume external ingest `status`/`phase` contract and preserve active repository visibility

- Task Status: **__done__**
- Git Commits: `6cc4f66`

#### Overview

Align Ingest page data normalization/rendering with server contract updates so active runs remain visible with coarse `ingesting` status and optional phase details.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: React effect synchronization guidance for ingest polling/hydration and stable state transitions: https://react.dev/learn/synchronizing-with-effects
- Verified on 2026-03-02 via MUI MCP: Material UI v6.4.12 index used for component/API behavior consistency with this repo version: https://llms.mui.com/material-ui/6.4.12/llms.txt
- Verified on 2026-03-02 via MUI MCP: MUI Table component docs for rendering active/terminal ingest status and optional phase display: https://llms.mui.com/material-ui/6.4.12/components/table.md
- Verified on 2026-03-02: TypeScript narrowing handbook for discriminated unions around `status` and optional `phase`: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- Verified on 2026-03-02: TypeScript 5.9 release notes to align syntax/typing assumptions with repo toolchain: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- Verified on 2026-03-02: React Testing Library intro for UI-level status/phase rendering assertions: https://testing-library.com/docs/react-testing-library/intro
- Verified on 2026-03-02 via Context7 MCP (`/jestjs/jest`): Jest documentation for hook-normalization and render-contract assertions in ingest UI tests: https://context7.com/jestjs/jest/llms.txt
- Verified on 2026-03-02 via Context7 MCP (`/mermaid-js/mermaid`): Mermaid flowchart syntax for documenting ingest UI status/phase rendering flow in `design.md`: https://context7.com/mermaid-js/mermaid/llms.txt

#### Subtasks

1. [x] Update ingest API/client types for external `status` and optional `phase` fields.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `common/src/lmstudio.ts`, `client/src/hooks/useIngestRoots.ts`
2. [x] Update ingest root normalization logic to parse external `status` and optional `phase`.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `client/src/hooks/useIngestRoots.ts`
   - Required behavior: normalized client model preserves status/phase semantics and terminal phase omission.
3. [x] Update ingest list/table components to render active status from new external fields.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `client/src/components/ingest/RootsTable.tsx`, `client/src/pages/IngestPage.tsx`
   - Required behavior: active repos stay visible with `status=ingesting`; phase shown only when present.
4. [x] Update ingest detail/status components to render phase only for active statuses.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/pages/IngestPage.tsx`
   - Required behavior: active repos stay visible with `status=ingesting`; phase shown only when present.
5. [x] Add hook normalization test: `status=ingesting` rows preserve allowed `phase` values.
   - Starter snippet (adapt names to exact existing symbols): `expect(normalized).toMatchObject({ status: 'ingesting', phase: 'embedding' });`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC25.
   - Files to read/edit: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`, `client/src/hooks/useIngestRoots.ts`
   - Test type: Unit (hook normalization contract).
   - Test location: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`.
   - Test description: feed ingesting payload rows through normalization and assert `phase` remains present and valid.
   - Test purpose: guarantee client keeps active ingest phase information visible.
6. [x] Add hook normalization test: terminal rows (`completed`, `cancelled`, `error`) omit `phase`.
   - Starter snippet (adapt names to exact existing symbols): `expect(normalized.phase).toBeUndefined();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC15, AC25.
   - Files to read/edit: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`, `client/src/hooks/useIngestRoots.ts`
   - Test type: Unit (hook terminal-shape contract).
   - Test location: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`.
   - Test description: normalize terminal rows and assert `phase` is omitted from client model.
   - Test purpose: prevent stale or invalid phase rendering for terminal states.
7. [x] Add hook normalization test: ingest roots `schemaVersion` accepts `0000038-status-phase-v1`.
   - Starter snippet (adapt names to exact existing symbols): `expect(result.schemaVersion).toBe('0000038-status-phase-v1');`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC28.
   - Files to read/edit: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`, `client/src/hooks/useIngestRoots.ts`, `common/src/lmstudio.ts`
   - Test type: Unit (schema version compatibility).
   - Test location: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`.
   - Test description: verify ingest roots parsing/typing accepts and preserves schema version `0000038-status-phase-v1`.
   - Test purpose: lock client compatibility to the updated server listing contract version.
8. [x] Add UI rendering test: active ingest row remains visible with `status=ingesting` and phase text.
   - Starter snippet (adapt names to exact existing symbols): `expect(screen.getByText(/ingesting/i)).toBeInTheDocument();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14.
   - Files to read/edit: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`, `client/src/components/ingest/RootsTable.tsx`, `client/src/pages/IngestPage.tsx`
   - Test type: Component/UI visibility test.
   - Test location: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`.
   - Test description: render active ingest state and assert repository row remains present with ingesting status and displayed phase.
   - Test purpose: prevent active repository disappearance in UI.
9. [x] Add UI rendering test: `completed` status shows no phase label.
   - Starter snippet (adapt names to exact existing symbols): `expect(screen.queryByText(/phase/i)).not.toBeInTheDocument();`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC15.
   - Files to read/edit: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/pages/IngestPage.tsx`
   - Test type: Component/UI terminal-state test.
   - Test location: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`.
   - Test description: render completed ingest row/card and assert phase label/text is absent.
   - Test purpose: enforce terminal phase omission in UI for completed state.
10. [x] Add UI rendering test: `cancelled` status shows no phase label.

- Starter snippet (adapt names to exact existing symbols): `expect(screen.queryByText(/phase/i)).not.toBeInTheDocument();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- Acceptance criteria focus: AC15.
- Files to read/edit: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/pages/IngestPage.tsx`
- Test type: Component/UI terminal-state test.
- Test location: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`.
- Test description: render cancelled ingest row/card and assert phase label/text is absent.
- Test purpose: enforce terminal phase omission in UI for cancelled state.

11. [x] Add UI rendering test: `error` status shows no phase label.

- Starter snippet (adapt names to exact existing symbols): `expect(screen.queryByText(/phase/i)).not.toBeInTheDocument();`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- Acceptance criteria focus: AC15.
- Files to read/edit: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/pages/IngestPage.tsx`
- Test type: Component/UI terminal-state test.
- Test location: `client/src/test/ingestRoots.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestStatus.progress.test.tsx`.
- Test description: render error ingest row/card and assert phase label/text is absent.
- Test purpose: enforce terminal phase omission in UI for error state.

12. [x] Update `design.md` with ingest UI flow updates and Mermaid diagram(s) for status/phase rendering and active-visibility behavior.

- Starter snippet (adapt names to exact existing symbols): `Add Mermaid flowchart showing ingest roots payload -> client normalization -> UI render decisions for ingesting vs terminal states (phase omitted for terminal).`
- Dependency note: execute this after Task 7 implementation/tests so diagram and text reflect final UI behavior.
- Docs: https://context7.com/mermaid-js/mermaid/llms.txt | https://react.dev/learn/synchronizing-with-effects
- Acceptance criteria focus: AC22 documentation completeness plus AC11/AC15 UI flow clarity.
- Files to read/edit: `design.md`, `client/src/hooks/useIngestRoots.ts`, `client/src/components/ingest/RootsTable.tsx`, `client/src/pages/IngestPage.tsx`
- Document name: `design.md`.
- Document location: `design.md`.
- Document description: document ingest UI normalization/rendering flow and terminal phase-omission rules with Mermaid diagrams.
- Document purpose: provide a maintained architecture view of client-side ingest status behavior.

13. [x] If this task adds or removes files, update `projectStructure.md` after finishing those file changes.

- Starter snippet (adapt names to exact existing symbols): `Add entries for any new/removed files introduced by Task 7 in common/client ingest hooks, components, pages, and tests.`
- Dependency note: execute this after all file add/remove subtasks in Task 7 and before moving to the next task.
- Docs: https://www.markdownguide.org/basic-syntax/
- Acceptance criteria focus: AC22 documentation completeness.
- Files to read/edit: `projectStructure.md`, `common/src/*`, `client/src/hooks/*`, `client/src/components/ingest/*`, `client/src/pages/*`, `client/src/test/*`
- Document name: `projectStructure.md`.
- Document location: `projectStructure.md`.
- Document description: record Task 7 file additions/removals across common/client ingest hooks, components, pages, and tests.
- Document purpose: maintain an accurate file-map reference for ingest UI contract consumption changes.
- Required behavior: update `projectStructure.md` with every file path added or removed by Task 7 (no wildcard summaries), and remove entries for deleted files.

14. [x] Add deterministic ingest UI rendering logs for Playwright-MCP console assertions.

- Starter snippet (adapt names to exact existing symbols): `console.info('[DEV-0000038][T7] INGEST_UI_ROW_RENDER sourceId=%s status=%s phase=%s', sourceId, status, phase ?? 'none');`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://developer.mozilla.org/en-US/docs/Web/API/Console/info_static | https://react.dev/learn/synchronizing-with-effects
- Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
- Files to read/edit: `client/src/hooks/useIngestRoots.ts`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/pages/IngestPage.tsx`
- Required log line: `[DEV-0000038][T7] INGEST_UI_ROW_RENDER sourceId=<id> status=<status> phase=<phase|none>`.
- Required log line: `[DEV-0000038][T7] INGEST_UI_TERMINAL_PHASE_HIDDEN sourceId=<id> status=<completed|cancelled|error>`.
- Required behavior: emit row-render log for visible entries and phase-hidden log for terminal-state rendering.

15. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build:summary:server` - Use because this task changes `common` contracts consumed by server and client. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` and resolve errors.
2. [x] `npm run build:summary:client` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` and resolve errors.
3. [x] `npm run test:summary:server` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/server-tests-*.log`) and resolve listed failures.
4. [x] `npm run test:summary:client` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`) and resolve listed failures.
5. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find failing target(s).
6. [x] `npm run compose:up`
7. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`; verify `[DEV-0000038][T7] INGEST_UI_ROW_RENDER ...` is emitted for active and terminal rows, verify `[DEV-0000038][T7] INGEST_UI_TERMINAL_PHASE_HIDDEN ...` appears for `completed|cancelled|error`, capture screenshots for ingesting, completed, cancelled, and error UI states, review screenshots to confirm phase is shown only for ingesting and hidden for terminal statuses, save screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped via `docker-compose.local.yml`), and verify browser debug console has no unexpected errors.
8. [x] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Subtasks 1-2: Added shared external ingest status/phase types plus schema-version constant in `common/src/lmstudio.ts`, then updated `useIngestRoots` to normalize `status`/`phase` under the new external contract and preserve `schemaVersion` from `/ingest/roots`.
- Subtasks 3-4, 14: Updated `RootsTable` status rendering to show `status=ingesting` with optional phase text, keep terminal rows phase-free, and emit deterministic Task 7 console markers (`INGEST_UI_ROW_RENDER`, `INGEST_UI_TERMINAL_PHASE_HIDDEN`) for manual Playwright assertions.
- Subtasks 5-11: Added hook and UI regression coverage across `useIngestRoots`, `RootsTable`, and `IngestPage` tests for ingesting-phase preservation, terminal phase omission (`completed|cancelled|error`), and schemaVersion compatibility (`0000038-status-phase-v1`).
- Subtask 12: Added a dedicated Task 7 section in `design.md` with Mermaid diagrams covering `/ingest/roots` normalization and ingesting-vs-terminal phase render rules.
- Subtask 13: No files were added or removed for Task 7, so `projectStructure.md` required no changes.
- Subtask 15: Ran `npm run lint --workspaces` (pass with existing unrelated server import-order warnings) and `npm run format:check --workspaces`; format check initially failed on four Task 7 client files, then passed after `npm run format --workspaces`.
- Testing 1: `npm run build:summary:server` passed (`warnings: 0`), log `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run build:summary:client` passed (`warnings: 1`), log `logs/test-summaries/build-client-latest.log`; warning is the existing Vite chunk-size warning.
- Testing 3: `npm run test:summary:server` passed (`tests run: 956`, `failed: 0`), log `test-results/server-tests-2026-03-02T13-55-40-043Z.log`.
- Testing 4: `npm run test:summary:client` passed (`tests run: 401`, `failed: 0`), log `test-results/client-tests-2026-03-02T14-06-01-617Z.log`.
- Testing 5: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`), log `logs/test-summaries/compose-build-latest.log`.
- Testing 6: `npm run compose:up` completed successfully; compose services started healthy (including `server`, `client`, `chroma`, `mongo`, and `playwright-mcp`).
- Testing 7: Manual host-mapped verification executed against `http://host.docker.internal:5001/ingest`; screenshots captured at `playwright-output-local/0000038-task7-{ingesting,completed,cancelled,error}.png`; console marker assertions from Playwright run were `STATE=ingesting ROW=1 HIDDEN=0`, `STATE=completed ROW=1 HIDDEN=1`, `STATE=cancelled ROW=1 HIDDEN=1`, `STATE=error ROW=1 HIDDEN=1`, and `ERROR_LOG_COUNT=0`, confirming phase shown only for ingesting and hidden for terminal statuses. (Playwright-MCP tool calls timed out in this environment, so equivalent local Playwright automation was used against the same host-mapped URL.)
- Testing 8: `npm run compose:down` completed successfully and removed compose services/network.

---

### 8. Documentation: update architecture and file-map docs for final 0000038 behavior

- Task Status: **__done__**
- Git Commits: `60e3298`

#### Overview

Update story-adjacent documentation so junior developers can understand final stop semantics, blocking MCP reingest behavior, and ingest status/phase mapping without reverse-engineering code.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02 via Context7 MCP (`/mermaid-js/mermaid`): Mermaid documentation index and syntax references for architecture/flow diagrams in `design.md`: https://context7.com/mermaid-js/mermaid/llms.txt
- Verified on 2026-03-02: MCP tools specification for documenting terminal-only reingest response semantics accurately: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Verified on 2026-03-02: JSON-RPC spec to document pre-run protocol-error boundaries correctly: https://www.jsonrpc.org/specification

#### Subtasks

1. [x] Update `design.md` with final stop-race handling, blocking reingest contract flow, and status/phase mapper behavior, including Mermaid diagrams.
   - Starter snippet (adapt names to exact existing symbols): `Document final stop-race, blocking reingest, and status/phase architecture flows with valid Mermaid diagrams.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://context7.com/mermaid-js/mermaid/llms.txt | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification
   - Acceptance criteria focus: AC22 and cross-check of all implemented AC behavior.
   - Files to read/edit: `design.md`
   - Document name: `design.md`.
   - Document location: `design.md`.
   - Document description: capture final architecture behavior and flow diagrams for stop handling, blocking reingest, and ingest status mapping.
   - Document purpose: provide the authoritative technical design reference for this story.
2. [x] Update `projectStructure.md` with all files added/removed/renamed across this story’s implementation tasks.
   - Starter snippet (adapt names to exact existing symbols): `Document all file additions/removals/renames produced by story 0000038 tasks.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://context7.com/mermaid-js/mermaid/llms.txt | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification
   - Acceptance criteria focus: AC22 and cross-check of all implemented AC behavior.
   - Files to read/edit: `projectStructure.md`
   - Document name: `projectStructure.md`.
   - Document location: `projectStructure.md`.
   - Document description: list story-specific structural changes to repository files and paths.
   - Document purpose: keep project structure documentation accurate for developers navigating the codebase.
   - Required behavior: include a complete explicit path list of all files added/removed/renamed across Tasks 1-7, and ensure no stale entries remain for removed files.
3. [x] Update this story plan’s Implementation Notes sections as each task completes, including key decisions and deviations.
   - Starter snippet (adapt names to exact existing symbols): `Record per-task implementation outcomes, deviations, and important decisions in the story notes sections.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://context7.com/mermaid-js/mermaid/llms.txt | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification
   - Acceptance criteria focus: AC22 and cross-check of all implemented AC behavior.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`
   - Document name: `0000038-agent-ux-stop-and-ingest-status.md`.
   - Document location: `planning/0000038-agent-ux-stop-and-ingest-status.md`.
   - Document description: update per-task Implementation Notes with concrete completion details.
   - Document purpose: preserve execution traceability and reduce handover ambiguity for future contributors.
4. [x] Run markdown format check and fix markdown/style issues in `design.md` if required.
   - Starter snippet (adapt names to exact existing symbols): `Apply any markdown formatting fixes needed in design.md after running format checks.`
   - Dependency note: execute this after Subtask 1 content updates.
   - Docs: https://context7.com/mermaid-js/mermaid/llms.txt
   - Acceptance criteria focus: AC22 documentation quality.
   - Files to read/edit: `design.md`
   - Document name: `design.md`.
   - Document location: `design.md`.
   - Document description: apply markdown style/format corrections after architecture updates.
   - Document purpose: keep design documentation readable and standards-compliant.
5. [x] Run markdown format check and fix markdown/style issues in `projectStructure.md` if required.
   - Starter snippet (adapt names to exact existing symbols): `Apply any markdown formatting fixes needed in projectStructure.md after running format checks.`
   - Dependency note: execute this after Subtask 2 content updates.
   - Docs: https://context7.com/mermaid-js/mermaid/llms.txt
   - Acceptance criteria focus: AC22 documentation quality.
   - Files to read/edit: `projectStructure.md`
   - Document name: `projectStructure.md`.
   - Document location: `projectStructure.md`.
   - Document description: apply markdown style/format corrections after file-map updates.
   - Document purpose: ensure structure documentation stays clean and consistent.
6. [x] Run markdown format check and fix markdown/style issues in this story plan file if required.
   - Starter snippet (adapt names to exact existing symbols): `Apply any markdown formatting fixes needed in planning/0000038-agent-ux-stop-and-ingest-status.md after running format checks.`
   - Dependency note: execute this after Subtask 3 content updates.
   - Docs: https://context7.com/mermaid-js/mermaid/llms.txt
   - Acceptance criteria focus: AC22 documentation quality.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`
   - Document name: `0000038-agent-ux-stop-and-ingest-status.md`.
   - Document location: `planning/0000038-agent-ux-stop-and-ingest-status.md`.
   - Document description: apply markdown style/format corrections to final story notes.
   - Document purpose: keep planning documentation consistent and machine/human readable.
7. [x] Add a dedicated documentation section listing the exact manual QA log markers introduced in Tasks 1-7.
   - Starter snippet (adapt names to exact existing symbols): `Add section \"Manual QA Log Markers (DEV-0000038)\" listing required prefixes and expected outcomes per task.`
   - Dependency note: execute after Task 1-7 log-line subtasks so the table reflects final text exactly.
   - Docs: https://www.markdownguide.org/basic-syntax/ | https://context7.com/mermaid-js/mermaid/llms.txt
   - Acceptance criteria focus: AC22 documentation quality.
   - Files to read/edit: `design.md`, `planning/0000038-agent-ux-stop-and-ingest-status.md`
   - Required log line: include exact text for `[DEV-0000038][T1]` through `[DEV-0000038][T7]` markers.
   - Required log line: `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=<T1|T2|T3|T4|T5|T6|T7>`.
   - Required behavior: documentation table exactly matches runtime log prefixes so Playwright-MCP manual checks are deterministic.
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Manual QA Log Markers (DEV-0000038)

| Task | Marker text | Validation intent |
| ---- | ----------- | ----------------- |
| T1 | `[DEV-0000038][T1] CANCEL_INFLIGHT_RECEIVED conversationId=<id> inflightId=<id\|none>` | WS cancel handler observed with conversation/inflight context. |
| T1 | `[DEV-0000038][T1] ABORT_AGENT_RUN_REQUESTED conversationId=<id>` | Conversation-authoritative command abort requested. |
| T2 | `[DEV-0000038][T2] STOP_CLICK conversationId=<id> inflightId=<id\|none>` | Agents stop click captured in UI console. |
| T2 | `[DEV-0000038][T2] CANCEL_INFLIGHT_SENT conversationId=<id> inflightId=<id\|none>` | UI cancel frame dispatch confirmed. |
| T3 | `[DEV-0000038][T3] AGENTS_INPUT_EDITABLE_WHILE_ACTIVE runActive=true` | Active run keeps input editable. |
| T3 | `[DEV-0000038][T3] AGENTS_CONVERSATION_SWITCH_ALLOWED from=<id> to=<id>` | Active run allows sidebar conversation switch. |
| T4 | `[DEV-0000038][T4] REINGEST_BLOCKING_WAIT_STARTED sourceId=<id> runId=<id>` | Blocking reingest wait lifecycle start. |
| T4 | `[DEV-0000038][T4] REINGEST_TERMINAL_RESULT status=<completed\|cancelled\|error> runId=<id> errorCode=<code\|null>` | Terminal blocking result lifecycle completion. |
| T5 | `[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED sourceId=<id> internal=<state> status=<status> phase=<phase\|none>` | Internal->external status/phase mapping verified. |
| T5 | `[DEV-0000038][T5] INGEST_ACTIVE_OVERLAY_APPLIED sourceId=<id> synthesized=<true\|false>` | Active overlay and synthesized-entry path verified. |
| T6 | `[DEV-0000038][T6] REEMBED_NO_CHANGE_EARLY_RETURN sourceId=<id> runId=<id>` | No-change reembed early-return path verified. |
| T6 | `[DEV-0000038][T6] REEMBED_DELTA_PATH deltaAdded=<n> deltaModified=<n> deltaDeleted=<n>` | Changed-delta reembed path verified. |
| T7 | `[DEV-0000038][T7] INGEST_UI_ROW_RENDER sourceId=<id> status=<status> phase=<phase\|none>` | Ingest UI row render contract verified for active and terminal rows. |
| T7 | `[DEV-0000038][T7] INGEST_UI_TERMINAL_PHASE_HIDDEN sourceId=<id> status=<completed\|cancelled\|error>` | Terminal phase-hidden rendering verified. |
| T8 | `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=<T1\|T2\|T3\|T4\|T5\|T6\|T7>` | Documentation log-reference validation evidence entry. |

#### Testing

1. [x] `npm run build:summary:server` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` and resolve errors.
2. [x] `npm run build:summary:client` - If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` and resolve errors.
3. [x] `npm run test:summary:server` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/server-tests-*.log`) and resolve listed failures.
4. [x] `npm run test:summary:client` - If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`) and resolve listed failures.
5. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find failing target(s).
6. [x] `npm run compose:up`
7. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`; execute one representative stop flow and one ingest flow, verify each documented marker from `[DEV-0000038][T1]` through `[DEV-0000038][T7]` appears with expected fields/counts, capture one screenshot per representative GUI flow and review it against the documentation expectations being validated, save screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped via `docker-compose.local.yml`), and record `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=<...>` entries in verification evidence for each validated marker family.
8. [x] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Subtask 1: Updated `design.md` with final Story 0000038 cross-check coverage for stop race semantics, blocking reingest contract boundaries, and status/phase mapping, including Mermaid diagrams aligned to implemented behavior.
- Subtask 2: Updated `projectStructure.md` with an explicit Story 0000038 Tasks 1-7 structural ledger (added/removed/renamed all explicit, plus full modified-file traceability list).
- Subtask 3: Updated Task 8 implementation notes incrementally as subtasks completed, documenting key documentation decisions and preserving explicit traceability for handoff.
- Subtasks 4-6: Ran markdown formatting checks for `design.md`, `projectStructure.md`, and the story plan; applied Prettier writes and rechecked until all three files passed.
- Subtask 7: Added `Manual QA Log Markers (DEV-0000038)` reference sections in `design.md` and Task 8 plan text with exact marker strings for T1-T7 plus the T8 validation marker format.
- Subtask 8: Ran `npm run lint --workspaces` (pass with existing unrelated server import-order warnings) and `npm run format:check --workspaces` (pass).
- Testing 1: `npm run build:summary:server` passed (`warnings: 0`), log `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run build:summary:client` passed (`warnings: 1`), log `logs/test-summaries/build-client-latest.log`; warning is the existing Vite chunk-size warning.
- Testing 3: `npm run test:summary:server` passed (`tests run: 956`, `failed: 0`), log `test-results/server-tests-2026-03-02T14-36-07-242Z.log`.
- Testing 4: `npm run test:summary:client` passed (`tests run: 401`, `failed: 0`), log `test-results/client-tests-2026-03-02T14-46-31-415Z.log`.
- Testing 5: `npm run compose:build:summary` passed (`items passed: 2`, `items failed: 0`), log `logs/test-summaries/compose-build-latest.log`.
- Testing 6: `npm run compose:up` completed successfully; compose services started healthy (including `server`, `client`, `chroma`, `mongo`, and `playwright-mcp`).
- Testing 7: Representative host-mapped GUI checks executed at `http://host.docker.internal:5001/agents` and `http://host.docker.internal:5001/ingest`; screenshots captured to `playwright-output-local/0000038-task8-stop-flow.png` and `playwright-output-local/0000038-task8-ingest-flow.png` with `TASK8_SCREENSHOT_ERRORS=0`. Marker-family validation counts recorded from runtime logs + current test artifacts: `T1_CANCEL_INFLIGHT_RECEIVED=7`, `T1_ABORT_AGENT_RUN_REQUESTED=7`, `T2_STOP_CLICK=3`, `T2_CANCEL_INFLIGHT_SENT=17`, `T3_INPUT_EDITABLE=20`, `T3_CONVERSATION_SWITCH_ALLOWED=1`, `T4_WAIT_STARTED=1`, `T4_TERMINAL_RESULT=1`, `T5_STATUS_MAPPED=35`, `T5_OVERLAY_APPLIED=3`, `T6_NO_CHANGE=1`, `T6_DELTA_PATH=2`, `T7_ROW_RENDER=13`, `T7_TERMINAL_PHASE_HIDDEN=11`; source locations used were `logs/server.1.log`, `test-results/client-tests-2026-03-02T14-46-31-415Z.log`, and `/logs?limit=3000` for T4 entries.
- `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=T1`
- `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=T2`
- `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=T3`
- `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=T4`
- `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=T5`
- `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=T6`
- `[DEV-0000038][T8] DOC_LOG_REFERENCE_VALIDATED marker=T7`
- Testing 8: `npm run compose:down` completed successfully and removed compose services/network.

---

### 9. Final verification: full acceptance and regression gate for story 0000038

- Task Status: **__to_do__**
- Git Commits: `None yet`

#### Overview

Perform end-to-end verification of all acceptance criteria after Tasks 1-8 are complete, including server/client builds, tests, docker flows, MCP parity checks, and manual UI validation.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: Docker Compose docs for deterministic startup/shutdown validation flow used in final regression gate: https://docs.docker.com/compose/
- Verified on 2026-03-02: Playwright intro for end-to-end verification execution model and artifact expectations: https://playwright.dev/docs/intro
- Verified on 2026-03-02: Playwright assertions reference for stable UI contract checks in acceptance validation: https://playwright.dev/docs/test-assertions
- Verified on 2026-03-02: MCP tools specification for classic/v2 parity checks during manual terminal-outcome validation: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/

#### Subtasks

1. [ ] Prepare an AC-by-AC verification matrix template and map each acceptance criterion to one explicit test subtask below.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence mapping.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`
2. [ ] Execute manual stop-race test: click Stop before inflight id is known and verify no command retries/steps start afterward.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
   - Test type: Manual integration test (Agents stop race).
   - Test location: Agents UI plus command-run server logs captured in `test-results/screenshots/*`.
   - Test description: trigger stop before inflight id assignment and confirm command execution does not continue.
   - Test purpose: validate conversation-authoritative stop behavior in race windows.
3. [ ] Execute manual chat-cancel mismatch test: cancel with stale/invalid `inflightId` and verify deterministic `INFLIGHT_NOT_FOUND`.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC3, AC23.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
   - Test type: Manual integration test (chat cancel mismatch).
   - Test location: Chat UI/server WS logs, artifacts in `test-results/screenshots/*`.
   - Test description: send cancel using stale inflight id and confirm mismatch error signaling remains deterministic.
   - Test purpose: prevent regressions to existing chat cancellation semantics.
4. [ ] Execute manual MCP classic test: `reingest_repository` completed run returns terminal payload contract.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC5, AC8, AC18, AC20.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
   - Test type: Manual contract test (MCP classic).
   - Test location: MCP classic tool-call output capture in `test-results/screenshots/*`.
   - Test description: run completed reingest via classic surface and verify terminal fields and no `started`.
   - Test purpose: validate terminal-only contract on classic MCP.
5. [ ] Execute manual MCP v2 test: `reingest_repository` completed run returns terminal payload contract.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC5, AC8, AC18, AC20.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
   - Test type: Manual contract test (MCP v2).
   - Test location: MCP v2 tool-call output capture in `test-results/screenshots/*`.
   - Test description: run completed reingest via v2 surface and verify terminal fields and no `started`.
   - Test purpose: validate terminal-only contract on MCP v2.
6. [ ] Execute manual MCP classic cancel test: GUI cancel while waiting returns terminal `status=cancelled`.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC10, AC19, AC20.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
   - Test type: Manual contract test (MCP classic cancellation).
   - Test location: MCP classic response capture and GUI cancel evidence in `test-results/screenshots/*`.
   - Test description: start classic blocking reingest, cancel from GUI, verify terminal cancelled payload.
   - Test purpose: verify in-run cancellation boundary for classic MCP.
7. [ ] Execute manual MCP v2 cancel test: GUI cancel while waiting returns terminal `status=cancelled`.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC10, AC19, AC20.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
   - Test type: Manual contract test (MCP v2 cancellation).
   - Test location: MCP v2 response capture and GUI cancel evidence in `test-results/screenshots/*`.
   - Test description: start v2 blocking reingest, cancel from GUI, verify terminal cancelled payload.
   - Test purpose: verify in-run cancellation boundary for MCP v2.
8. [ ] Execute manual MCP classic error test: post-start failure returns terminal `status=error` payload.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC18, AC19, AC24.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
   - Test type: Manual contract test (MCP classic error path).
   - Test location: MCP classic response capture in `test-results/screenshots/*`.
   - Test description: induce post-start failure and verify error terminal payload instead of protocol error envelope.
   - Test purpose: enforce post-start terminal-result error boundary on classic MCP.
9. [ ] Execute manual MCP v2 error test: post-start failure returns terminal `status=error` payload.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC18, AC19, AC24.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
   - Test type: Manual contract test (MCP v2 error path).
   - Test location: MCP v2 response capture in `test-results/screenshots/*`.
   - Test description: induce post-start failure and verify error terminal payload instead of protocol error envelope.
   - Test purpose: enforce post-start terminal-result error boundary on MCP v2.
10. [ ] Execute manual UI listing visibility test: active ingest remains visible with `status=ingesting` and valid `phase`.

- Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC11, AC14, AC27.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Manual UI test (Ingest page listing).
- Test location: Ingest page artifacts in `test-results/screenshots/*`.
- Test description: run active ingest and verify row remains visible with ingesting status and phase.
- Test purpose: confirm UI does not hide active repositories.

11. [ ] Execute manual MCP classic listing visibility test: active ingest remains visible with `status=ingesting` and valid `phase`.

- Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC12, AC14, AC27.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Manual contract test (MCP classic listing).
- Test location: MCP classic `ListIngestedRepositories` output capture in `test-results/screenshots/*`.
- Test description: while ingest is active, query MCP listing and verify repository remains present with ingesting/phase fields.
- Test purpose: confirm active overlay visibility on MCP listing surface.

12. [ ] Execute manual MCP classic pre-run validation error test: invalid `sourceId` returns JSON-RPC protocol error.

- Starter snippet (adapt names to exact existing symbols): `Call reingest_repository with invalid sourceId and assert protocol error envelope, not terminal payload.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC24.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Manual protocol-boundary test (MCP classic).
- Test location: MCP classic error response capture in `test-results/screenshots/*`.
- Test description: call classic reingest with invalid pre-run input and verify protocol error envelope.
- Test purpose: preserve pre-run JSON-RPC error boundary on classic MCP.

13. [ ] Execute manual MCP v2 pre-run validation error test: invalid `sourceId` returns JSON-RPC protocol error.

- Starter snippet (adapt names to exact existing symbols): `Call reingest_repository with invalid sourceId and assert protocol error envelope, not terminal payload.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC24.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Manual protocol-boundary test (MCP v2).
- Test location: MCP v2 error response capture in `test-results/screenshots/*`.
- Test description: call v2 reingest with invalid pre-run input and verify protocol error envelope.
- Test purpose: preserve pre-run JSON-RPC error boundary on MCP v2.

14. [ ] Execute manual MCP classic no-change test: no-change reingest completes with terminal `status=completed`.

- Starter snippet (adapt names to exact existing symbols): `Run no-change reingest and assert terminal status completed.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC16, AC17.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Manual contract test (MCP classic no-change).
- Test location: MCP classic response capture in `test-results/screenshots/*`.
- Test description: execute no-change reingest via classic surface and verify successful terminal completed status.
- Test purpose: validate no-change success semantics for classic MCP.

15. [ ] Execute manual MCP v2 no-change test: no-change reingest completes with terminal `status=completed`.

- Starter snippet (adapt names to exact existing symbols): `Run no-change reingest and assert terminal status completed.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC16, AC17.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Manual contract test (MCP v2 no-change).
- Test location: MCP v2 response capture in `test-results/screenshots/*`.
- Test description: execute no-change reingest via v2 surface and verify successful terminal completed status.
- Test purpose: validate no-change success semantics for MCP v2.

16. [ ] Execute manual MCP classic mixed-delta test: mixed changes complete with terminal `status=completed`.

- Starter snippet (adapt names to exact existing symbols): `Run mixed-delta reingest and assert terminal status completed.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC16, AC17.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Manual contract test (MCP classic mixed-delta).
- Test location: MCP classic response capture in `test-results/screenshots/*`.
- Test description: execute mixed-delta reingest via classic surface and verify successful terminal completed status.
- Test purpose: confirm mixed-delta success semantics for classic MCP.

17. [ ] Execute manual MCP v2 mixed-delta test: mixed changes complete with terminal `status=completed`.

- Starter snippet (adapt names to exact existing symbols): `Run mixed-delta reingest and assert terminal status completed.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC16, AC17.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Manual contract test (MCP v2 mixed-delta).
- Test location: MCP v2 response capture in `test-results/screenshots/*`.
- Test description: execute mixed-delta reingest via v2 surface and verify successful terminal completed status.
- Test purpose: confirm mixed-delta success semantics for MCP v2.

18. [ ] Save manual verification artifacts/screenshots into `test-results/screenshots` with story/task-prefixed filenames.

- Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC1-AC28 final gate evidence.
- Files to read/edit: `test-results/screenshots/*`

19. [ ] Ensure final `design.md` content reflects implemented behavior with no contradictions.

- Starter snippet (adapt names to exact existing symbols): `Cross-check design.md architecture text and Mermaid diagrams against final implemented stop/reingest/status behavior.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC1-AC28 final gate evidence.
- Files to read/edit: `design.md`
- Document name: `design.md`.
- Document location: `design.md`.
- Document description: validate and correct architecture/flow documentation and diagrams against implemented behavior.
- Document purpose: prevent architectural documentation drift at final verification.

20. [ ] Ensure final `projectStructure.md` content reflects implemented file changes with no contradictions.

- Starter snippet (adapt names to exact existing symbols): `Cross-check projectStructure.md entries against actual created/removed/renamed files in story implementation.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC1-AC28 final gate evidence.
- Files to read/edit: `projectStructure.md`
- Document name: `projectStructure.md`.
- Document location: `projectStructure.md`.
- Document description: validate and correct file-map documentation against actual repository changes.
- Document purpose: ensure file-structure documentation is accurate for future implementation work.

21. [ ] Ensure final story plan file reflects implemented behavior and verification evidence with no contradictions.

- Starter snippet (adapt names to exact existing symbols): `Cross-check planning/0000038-agent-ux-stop-and-ingest-status.md implementation notes and verification evidence against final outcomes.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC1-AC28 final gate evidence.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`
- Document name: `0000038-agent-ux-stop-and-ingest-status.md`.
- Document location: `planning/0000038-agent-ux-stop-and-ingest-status.md`.
- Document description: validate story-level verification notes and acceptance evidence entries.
- Document purpose: keep the story record internally consistent for release and audit traceability.

22. [ ] Execute AC21 automated-coverage audit: confirm every AC1-AC28 maps to at least one passing automated test reference in this story.

- Starter snippet (adapt names to exact existing symbols): `For each AC, record at least one automated test file + test name + command output reference; mark any missing coverage as a blocking defect.`
- Dependency note: execute after all automated test suites complete so evidence reflects final pass state.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC21.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Coverage-audit verification test.
- Test location: Story AC matrix and recorded automated command outputs/artifacts.
- Test description: verify each acceptance criterion has explicit automated coverage evidence (happy/error/edge where applicable) and no unmapped criteria remain.
- Test purpose: guarantee the story’s automated test plan is complete rather than implicit.

23. [ ] Execute AC21 parity/no-change automation gate: run and record parity plus no-change targeted suites as explicit evidence.

- Starter snippet (adapt names to exact existing symbols): `Record passing outputs for MCP classic/v2 parity tests and no-change early-return suites with command names and artifact links.`
- Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
- Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Acceptance criteria focus: AC21.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Test type: Automated regression gate.
- Test location: Server targeted test command outputs and linked artifacts.
- Test description: run parity-focused reingest suites and no-change early-return suites, then record evidence in the AC matrix.
- Test purpose: ensure the highest-risk cross-surface and early-return paths are explicitly covered by passing automation.

24. [ ] Add a final regression log-assertion checklist that maps each manual flow to exact expected `DEV-0000038` log markers.

- Starter snippet (adapt names to exact existing symbols): `For each manual flow row, list required console/server log markers and expected count (>=1 or exactly 1).`
- Dependency note: execute after all task-level log-line subtasks and before final manual Playwright-MCP verification.
- Docs: https://playwright.dev/docs/intro | https://www.markdownguide.org/basic-syntax/
- Acceptance criteria focus: AC21, AC22.
- Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
- Required log line: include checklist entries for `[DEV-0000038][T1]` through `[DEV-0000038][T7]`.
- Required log line: `[DEV-0000038][T9] FINAL_REGRESSION_LOG_ASSERTION_PASSED markerFamily=<T1|T2|T3|T4|T5|T6|T7> count=<n>`.
- Required behavior: checklist defines expected marker counts and pass/fail criteria for manual verification evidence.

25. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build:summary:server` - Mandatory final regression check (task is not strictly front end). If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Mandatory final regression check (task is not strictly back end). If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server` - Mandatory final regression check (task is not strictly front end). If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/server-tests-*.log`) and resolve listed failures.
4. [ ] `npm run test:summary:client` - Mandatory final regression check (task is not strictly back end). If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`) and resolve listed failures.
5. [ ] `timeout 7m npm run test:summary:e2e` - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log` and resolve root causes before rerunning.
6. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001`; validate final regression checklist by asserting all marker families `[DEV-0000038][T1]` to `[DEV-0000038][T7]` appear in the expected flows with correct ids/status fields and expected counts, capture screenshots for every acceptance criterion that is GUI-verifiable (including happy path, error states, and corner cases), review each screenshot against the expected UI outcomes in this story, save screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped via `docker-compose.local.yml`), record `[DEV-0000038][T9] FINAL_REGRESSION_LOG_ASSERTION_PASSED markerFamily=<...> count=<n>` entries in verification evidence, and verify no unexpected browser debug-console errors are logged.
9. [ ] `npm run compose:down`
       Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

#### Implementation notes

- Pending implementation.
