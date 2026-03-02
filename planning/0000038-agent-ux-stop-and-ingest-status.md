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

- Task Status: **__to_do__**
- Git Commits: `None yet`

#### Overview

Update WebSocket cancel message handling so command-run abort is always attempted by `conversationId`, including stop races where `inflightId` is not yet known. This task defines the server-side message contract change first so dependent frontend stop behavior can safely follow.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: MDN WebSocket API reference for frame lifecycle, close/error semantics, and cancel message delivery timing: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Verified on 2026-03-02: `ws` server library documentation (README/API usage) for connection handling and server-side message processing paths: https://github.com/websockets/ws
- Verified on 2026-03-02: Node.js `events` documentation for EventEmitter ordering/idempotent listener behavior used in race-safe stop handling: https://nodejs.org/api/events.html
- Verified on 2026-03-02: Jest `expect` assertions for deterministic stop/cancel contract tests and race regression checks: https://jestjs.io/docs/expect

#### Subtasks

1. [ ] Update WS client-message typing/parsing to accept `cancel_inflight` with required `conversationId` and optional `inflightId`.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Verification command after this subtask: `npm run test --workspace server -- ws`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/ws/types.ts`
   - Required behavior: payloads with only `conversationId` are valid for `cancel_inflight`; other message shapes remain unchanged.
2. [ ] Update WS cancel handler so `abortAgentCommandRun(conversationId)` is always attempted, regardless of `abortInflight` success.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Verification command after this subtask: `npm run test --workspace server -- ws`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/ws/server.ts` (`server/src/agents/commandsRunner.ts` read-only unless deterministic idempotence fix is required)
   - Required behavior: command retries/steps are blocked after stop request time in both inflight-id and no-inflight-id paths.
3. [ ] Keep chat-stream cancellation semantics deterministic when `inflightId` is supplied but not found.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Verification command after this subtask: `npm run test --workspace server -- ws`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/ws/server.ts`
   - Required behavior: preserve existing `INFLIGHT_NOT_FOUND` turn-final behavior for chat stream cancellation mismatch when a non-empty `inflightId` is supplied, while still aborting command runs by conversation. When `inflightId` is omitted, do not emit `INFLIGHT_NOT_FOUND`.
4. [ ] Add/extend unit tests for WS parsing and cancel handler race paths.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Verification command after this subtask: `npm run test --workspace server -- ws`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/test/unit/ws-*.test.ts` (existing WS parser/handler suites)
   - Required coverage: `conversationId`-only cancel, `conversationId+inflightId` cancel, stale inflight id, duplicate stop, and no `turn_final` failure event for conversation-only cancel.
5. [ ] Add/extend command-run regression test proving no further command step/retry starts after stop request.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Verification command after this subtask: `npm run test --workspace server -- ws`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/test/unit/agents-commands*.test.ts` and/or integration suites covering command-run stop flow.
6. [ ] Add/extend chat cancellation unit regression tests to ensure existing chat mismatch semantics are unchanged.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Verification command after this subtask: `npm run test --workspace server -- ws`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/test/unit/ws-chat-stream.test.ts`
   - Required coverage: mismatched/stale `inflightId` still yields `INFLIGHT_NOT_FOUND` turn-final for chat-stream cancellation.
7. [ ] Add/extend WS parser validation tests for malformed `cancel_inflight` payloads.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && !msg.conversationId) rejectAsInvalidMessage();`
   - Verification command after this subtask: `npm run test --workspace server -- ws`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/test/unit/ws-*.test.ts`, `server/src/ws/types.ts`
   - Required coverage: missing/empty `conversationId`, wrong payload types, and assertion that invalid messages do not trigger `abortAgentCommandRun`.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; resolve any issues introduced by this task.
   - Starter snippet (adapt names to exact existing symbols): `if (msg.type === "cancel_inflight" && msg.conversationId) { abortAgentCommandRun(msg.conversationId); if (msg.inflightId) await abortInflight(msg.inflightId); }`
   - Verification command after this subtask: `npm run test --workspace server -- ws`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | https://github.com/websockets/ws | https://nodejs.org/api/events.html | https://jestjs.io/docs/expect
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `server/src/ws/types.ts`, `server/src/ws/server.ts`, `server/src/test/unit/ws-*.test.ts`, `server/src/test/unit/agents-commands*.test.ts`, `server/src/test/unit/ws-chat-stream.test.ts`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] Run targeted WS cancel + command-run stop race tests, malformed cancel payload validation tests, and chat cancel regression tests; confirm pass.

#### Implementation notes

- Pending implementation.

---

### 2. Frontend: make Agents stop send `cancel_inflight` by conversation even when `inflightId` is unknown

- Task Status: **__to_do__**
- Git Commits: `None yet`

#### Overview

Consume Task 1’s server message-contract update in the Agents UI so Stop always emits a cancel signal while a conversation is active, even when no inflight id is available yet.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: React `useCallback` reference for stable stop handlers and stale-closure avoidance during active runs: https://react.dev/reference/react/useCallback
- Verified on 2026-03-02: MDN WebSocket API reference for client message-send behavior (`cancel_inflight` payload shape and dispatch timing): https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Verified on 2026-03-02 via MUI MCP: Material UI v6.4.12 index used in this repo for authoritative component/API docs: https://llms.mui.com/material-ui/6.4.12/llms.txt
- Verified on 2026-03-02 via MUI MCP: MUI TextField behavior and controlled-input patterns used on Agents page forms: https://llms.mui.com/material-ui/6.4.12/components/text-fields.md
- Verified on 2026-03-02 via MUI MCP: MUI Button API semantics for stop/submit disabled-state behavior: https://llms.mui.com/material-ui/6.4.12/api/button.md
- Verified on 2026-03-02: React Testing Library intro for event simulation and DOM assertions on stop-click flows: https://testing-library.com/docs/react-testing-library/intro
- Verified on 2026-03-02: Jest `expect` assertions for payload-shape and call-argument verification: https://jestjs.io/docs/expect

#### Subtasks

1. [ ] Update WebSocket client hook API to allow optional `inflightId` on `cancelInflight`.
   - Starter snippet (adapt names to exact existing symbols): `const cancelInflight = (conversationId, inflightId) => send({ type: "cancel_inflight", conversationId, ...(inflightId ? { inflightId } : {}) });`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage.commandsRun.abort`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `client/src/hooks/useChatWs.ts`
   - Required behavior: send `{ type: 'cancel_inflight', conversationId }` when `inflightId` is unavailable; include `inflightId` when present. Keep existing 2-argument call sites in Chat and Flows working unchanged.
2. [ ] Update Agents stop-click logic to always send cancel when there is an active conversation.
   - Starter snippet (adapt names to exact existing symbols): `const cancelInflight = (conversationId, inflightId) => send({ type: "cancel_inflight", conversationId, ...(inflightId ? { inflightId } : {}) });`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage.commandsRun.abort`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`
   - Required behavior: remove current hard dependency on a non-empty inflight id before sending cancel.
3. [ ] Add/extend client tests for stop-without-inflight-id and stop-with-inflight-id payload behavior.
   - Starter snippet (adapt names to exact existing symbols): `const cancelInflight = (conversationId, inflightId) => send({ type: "cancel_inflight", conversationId, ...(inflightId ? { inflightId } : {}) });`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage.commandsRun.abort`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `client/src/test/agentsPage.commandsRun.abort.test.tsx`, `client/src/test/chatPage.stop.test.tsx`, `client/src/test/flowsPage.stop.test.tsx`, `client/src/test/useChatWs*.test.ts`
   - Required coverage: payload shape in both paths, no regression to existing Chat/Flows stop behavior, and preservation of existing call-site compatibility.
4. [ ] Add/extend client stop-click tests for no-active-conversation edge case.
   - Starter snippet (adapt names to exact existing symbols): `if (!activeConversationId) return;`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage.commandsRun.abort`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `client/src/test/agentsPage.commandsRun.abort.test.tsx`, `client/src/test/useChatWs*.test.ts`, `client/src/pages/AgentsPage.tsx`
   - Required coverage: stop click with no active conversation does not send any WS cancel payload and does not throw.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; resolve any issues introduced by this task.
   - Starter snippet (adapt names to exact existing symbols): `const cancelInflight = (conversationId, inflightId) => send({ type: "cancel_inflight", conversationId, ...(inflightId ? { inflightId } : {}) });`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage.commandsRun.abort`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/reference/react/useCallback | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://testing-library.com/docs/react-testing-library/intro
   - Acceptance criteria focus: AC3, AC4, AC23.
   - Files to read/edit: `client/src/hooks/useChatWs.ts`, `client/src/pages/AgentsPage.tsx`, `client/src/test/agentsPage.commandsRun.abort.test.tsx`, `client/src/test/chatPage.stop.test.tsx`, `client/src/test/flowsPage.stop.test.tsx`, `client/src/test/useChatWs*.test.ts`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] Run targeted Agents stop-path tests (including no-active-conversation edge case) and confirm pass.

#### Implementation notes

- Pending implementation.

---

### 3. Frontend: unblock Agents input editing and sidebar navigation during active runs

- Task Status: **__to_do__**
- Git Commits: `None yet`

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
- Verified on 2026-03-02: Jest `expect` for deterministic UI lock/unlock assertions: https://jestjs.io/docs/expect

#### Subtasks

1. [ ] Introduce explicit UI gating flags for “run-active submission lock” versus “input editability”.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`
   - Required behavior: run-active state disables submit/execute actions only; no input lock and no sidebar lock from the same flag.
2. [ ] Update instruction input wiring to use the new editability flag and preserve draft text during active runs.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`
   - Required behavior: input remains editable and draft text is preserved while run is active.
3. [ ] Update sidebar interaction gating so conversation list remains clickable during active run.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`, `client/src/components/chat/ConversationList.tsx` (if prop behavior updates are needed)
   - Required behavior: conversation switching works while run is active; no overlay blocks clicks.
4. [ ] Add/extend client tests for active-run input editability and draft persistence.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/test/agentsPage*.test.tsx`
   - Required coverage: input remains editable while run is active; draft text remains unchanged through active-run updates.
5. [ ] Add/extend client tests for active-run sidebar-switch behavior and submit lock behavior.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/test/agentsPage*.test.tsx`
   - Required coverage: draft persistence while run is active, switch conversation during active run, submit still disabled while active.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; resolve any issues introduced by this task.
   - Starter snippet (adapt names to exact existing symbols): `const disableSubmit = isRunActive; const disableInput = false; const disableSidebar = false;`
   - Verification command after this subtask: `npm run test --workspace client -- agentsPage`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/conditional-rendering | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://reactrouter.com/ | https://www.w3.org/WAI/ARIA/apg/
   - Acceptance criteria focus: AC1, AC2.
   - Files to read/edit: `client/src/pages/AgentsPage.tsx`, `client/src/components/chat/ConversationList.tsx`, `client/src/test/agentsPage*.test.tsx`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] Run targeted Agents active-run UX tests and confirm pass.

#### Implementation notes

- Pending implementation.

---

### 4. Server Message Contract: make `reingest_repository` blocking and terminal-only (classic + MCP v2 parity)

- Task Status: **__to_do__**
- Git Commits: `None yet`

#### Overview

Replace immediate `status: started` reingest results with one terminal payload returned only after run completion/cancellation/error, shared by both MCP surfaces.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: MCP tools specification for terminal result contract shape and tool response semantics: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Verified on 2026-03-02: MCP progress/long-running guidance for blocking waits, progress lifecycle, and cancellation expectations: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/
- Verified on 2026-03-02: JSON-RPC spec for strict protocol error boundaries (pre-run validation failures vs post-start terminal outcomes): https://www.jsonrpc.org/specification
- Verified on 2026-03-02: Express 5 migration docs for response/runtime behavior assumptions in server route/tool layers: https://expressjs.com/en/guide/migrating-5.html
- Verified on 2026-03-02: Jest `expect` assertions for parity tests across classic MCP and MCP v2 surfaces: https://jestjs.io/docs/expect

#### Subtasks

1. [ ] Update shared reingest service result shape to terminal-only output.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`
   - Required behavior: success payload uses terminal `status` (`completed|cancelled|error`) and required fields (`status`, `operation`, `runId`, `sourceId`, `durationMs`, `files`, `chunks`, `embedded`, `errorCode`).
2. [ ] Implement blocking terminal wait in reingest service using ingest runtime status.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`, `server/src/ingest/ingestJob.ts` (only if small runtime helper export is required)
   - Required behavior: after `reembed(...)` returns `runId`, wait until terminal state (`completed|cancelled|error|skipped`), map internal `skipped` to external `completed`, and populate terminal counters/errorCode/duration deterministically.
3. [ ] Add explicit terminal payload mapping rules in the service for each terminal state.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`
   - Required behavior: `operation` is always `reembed`, `errorCode` is null unless terminal status is `error`, and cancelled paths return last-known counters.
4. [ ] Keep pre-run validation failures in JSON-RPC/protocol error envelopes and keep input shape `sourceId`-only.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`
   - Required behavior: invalid `sourceId`/unknown root/busy-before-start remain protocol errors; only post-start outcomes use terminal result payload. Do not add `wait`, `blocking`, or similar request flags. This story intentionally keeps existing JSON-RPC protocol-error behavior for pre-run validation (no migration to `result.isError` in scope).
5. [ ] Update classic MCP tool output schema away from `status: started`.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/mcp/server.ts`
   - Required behavior: output schema matches terminal-only contract and no non-terminal values remain.
6. [ ] Update classic MCP runtime payload mapping to match the terminal-only contract.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/mcp/server.ts`
   - Required behavior: emitted payload matches terminal field names and status semantics for all outcomes.
7. [ ] Update MCP v2 reingest tool runtime mapping to match classic payload semantics.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/mcp2/tools/reingestRepository.ts`
   - Required behavior: same field names/status semantics as classic for the same terminal outcome.
8. [ ] Preserve keep-alive behavior during blocking wait using existing keepalive controller behavior.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/mcp/server.ts`, `server/src/mcp2/router.ts`, `server/src/mcpCommon/keepAlive.ts` (if adjustments needed)
   - Required behavior: long waits continue heartbeats and do not alter final payload shape. Avoid introducing new keepalive branches unless required to satisfy this story.
9. [ ] Add/extend service-level tests for terminal payload mapping and wait behavior.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/test/unit/reingestService.test.ts`
   - Required coverage: terminal wait, `skipped -> completed`, required top-level fields, and deterministic duration/counter mapping.
10. [ ] Add/extend classic + MCP v2 tests for terminal parity and protocol-error boundary.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/test/unit/mcp-*.test.ts`, `server/src/test/unit/reingest*.test.ts`
   - Required coverage: no `started` in final result, GUI cancel while waiting returns `status: cancelled`, parity assertions across both MCP surfaces, `operation === reembed`, `errorCode` null unless `status=error`, cancelled returns last-known counters, pre-run validation failures remain JSON-RPC errors, post-start failure/cancel return terminal result payload (not protocol error), and both surfaces keep transport wrapper `result.content[0].text` as JSON string.
11. [ ] Add/extend one representative keepalive resilience test for blocking reingest wait.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/test/unit/mcp.keepalive.helper.test.ts`, `server/src/test/unit/mcp2-router-*.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`
   - Required coverage: keepalive runs during blocking wait and the response lifecycle completes cleanly on one disconnect/close path.
12. [ ] Add/extend terminal error-path tests for `errorCode` and required-field completeness.
   - Starter snippet (adapt names to exact existing symbols): `expect(result.status).toBe('error'); expect(result.errorCode).not.toBeNull();`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC8, AC9, AC18, AC19.
   - Files to read/edit: `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/reingest*.test.ts`, `server/src/test/unit/mcp-*.test.ts`
   - Required coverage: `status=error` always includes non-null `errorCode` and all required top-level terminal fields on both MCP surfaces.
13. [ ] Add/extend MCP response-shape tests to prove terminal-only single result without top-level `message`.
   - Starter snippet (adapt names to exact existing symbols): `expect(payload.status).not.toBe('started'); expect(payload.message).toBeUndefined();`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC8, AC9.
   - Files to read/edit: `server/src/test/unit/mcp-*.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2-router-*.test.ts`
   - Required coverage: no interim `started` payload is surfaced as the tool result, top-level `message` is absent, and exactly one terminal payload is asserted per call.
14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; resolve any issues introduced by this task.
   - Starter snippet (adapt names to exact existing symbols): `return { status: mapTerminal(state), operation: "reembed", runId, sourceId, durationMs, files, chunks, embedded, errorCode };`
   - Verification command after this subtask: `npm run test --workspace server -- reingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress/ | https://www.jsonrpc.org/specification | https://expressjs.com/en/guide/migrating-5.html
   - Acceptance criteria focus: AC5, AC6, AC7, AC8, AC9, AC10, AC18, AC19, AC20, AC24.
   - Files to read/edit: `server/src/ingest/reingestService.ts`, `server/src/ingest/ingestJob.ts`, `server/src/mcp/server.ts`, `server/src/mcp2/tools/reingestRepository.ts`, `server/src/mcp2/router.ts`, `server/src/mcpCommon/keepAlive.ts`, `server/src/test/unit/reingestService.test.ts`, `server/src/test/unit/mcp-*.test.ts`, `server/src/test/unit/reingest*.test.ts`, `server/src/test/unit/mcp.keepalive.helper.test.ts`, `server/src/test/unit/mcp2-router-*.test.ts`, `server/src/test/unit/mcp.reingest.classic.test.ts`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] Run targeted reingest contract tests for classic + MCP v2, including pre-run vs post-start error-boundary, error-path `errorCode` assertions, no-top-level-`message` checks, and disconnect/keepalive resilience; confirm pass.

#### Implementation notes

- Pending implementation.

---

### 5. Server Message Contract: normalize ingest listing status/phase mapping and active overlay visibility

- Task Status: **__to_do__**
- Git Commits: `None yet`

#### Overview

Apply one shared status/phase mapping and active-overlay merge path for `/ingest/roots` and MCP classic `ListIngestedRepositories`, including schema version bump and synthesized active entries when persisted metadata is missing.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: JSON Schema reference for field presence/omission rules (`status`, optional `phase`, schema-version compatibility): https://json-schema.org/understanding-json-schema/
- Verified on 2026-03-02: MCP tools specification for consistent output contracts between `/ingest/roots` and MCP listing surfaces: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Verified on 2026-03-02: MDN `Object` reference for safe merge/overlay behavior while preserving persisted metadata fields: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
- Verified on 2026-03-02: Jest `expect` assertions for schema-version and synthesized-entry contract tests: https://jestjs.io/docs/expect

#### Subtasks

1. [ ] Implement shared internal->external status normalization (`status`/`phase`) in the existing listing path.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`
   - Required behavior: `queued|scanning|embedding -> status=ingesting + phase`; `completed|cancelled|error -> same status and no phase`; `skipped -> completed`.
2. [ ] Expose active ingest run context with identity needed for overlay and synthesized entries.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`
   - Required behavior: expose active run identity/context including run id plus root/source identity and current state/counters so list surfaces can build synthesized entries when persisted metadata is missing.
3. [ ] Apply normalized status/phase semantics to `listIngestedRepositories` output.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`
   - Required behavior: tool-level listing output always emits external status semantics and valid phase presence/omission rules.
4. [ ] Apply normalized status/phase semantics to `/ingest/roots` response by reusing existing listing normalization.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/routes/ingestRoots.ts`, `server/src/mcp/server.ts`, `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsIngestedRepos.ts` (if schemaVersion passthrough/update is needed)
   - Required behavior: both surfaces emit identical status semantics and `schemaVersion: "0000038-status-phase-v1"`.
5. [ ] Implement active overlay precedence on top of persisted listing metadata.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`
   - Required behavior: overlay status/phase/runId/live counters come from active runtime state while persisted metadata fields remain intact unless newer terminal state exists.
6. [ ] Implement synthesized active-entry fallback when persisted metadata is missing, reusing existing path mapping.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`
   - Required behavior: active run remains visible with status/phase/runId/counters while last completed metadata is retained where available. Synthesized entries must include identity/path fields (`id`, `containerPath`, `hostPath`) and include `hostPathWarning` when mapping is incomplete using existing `mapIngestPath` behavior (no duplicated mapping logic).
7. [ ] Update classic MCP `ListIngestedRepositories` output schema for repo-level `status` and optional `phase`.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/mcp/server.ts`
   - Required behavior: output schema and runtime payload remain aligned.
8. [ ] Bump and propagate shared ingest listing schema version constant.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`
   - Required behavior: all listing surfaces emit `schemaVersion: "0000038-status-phase-v1"` from one shared constant path.
9. [ ] Update only the runtime listing schemas/contracts required by this story’s external surfaces.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/mcp/server.ts`, `server/src/routes/ingestRoots.ts`, `server/src/lmstudio/toolService.ts`
   - Required behavior: runtime contracts for `/ingest/roots` and MCP classic listing document and emit external `status` values with optional `phase` omitted for terminal statuses.
10. [ ] Add/extend server tests for status/phase mapping and active overlay behavior.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/test/unit/tools-ingested-repos*.test.ts`, `server/src/test/unit/ingest-roots*.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
   - Required coverage: active overlays keep repositories visible, terminal states omit phase, and skipped is normalized to completed.
11. [ ] Add/extend focused contract tests for synthesized entries and schema-version migration.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/test/unit/tools-ingested-repos*.test.ts`, `server/src/test/unit/ingest-roots*.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
   - Required coverage: active overlays keep repositories visible, terminal states omit phase, synthesized entries include required identity fields (and `hostPathWarning` when needed), and schemaVersion assertions migrate to `0000038-status-phase-v1`.
12. [ ] Add/extend overlay-precedence regression tests for persisted metadata retention.
   - Starter snippet (adapt names to exact existing symbols): `expect(repo.lastIngestAt).toBe(previousTerminal.lastIngestAt); expect(repo.status).toBe('ingesting');`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC13, AC26.
   - Files to read/edit: `server/src/test/unit/tools-ingested-repos*.test.ts`, `server/src/test/unit/ingest-roots*.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
   - Required coverage: active overlay replaces run-state fields only, while persisted metadata (`lastIngestAt`, lock/model metadata, last terminal error context) remains present until a newer terminal write occurs.
13. [ ] Add/extend terminal-status mapping tests for explicit `completed|cancelled|error` phase omission on all listing surfaces.
   - Starter snippet (adapt names to exact existing symbols): `expect(repo.phase).toBeUndefined();`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC14, AC15, AC25.
   - Files to read/edit: `server/src/test/unit/tools-ingested-repos*.test.ts`, `server/src/test/unit/ingest-roots*.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`
   - Required coverage: `completed`, `cancelled`, and `error` outputs all omit `phase` (not null/empty) in both `/ingest/roots` and MCP listing responses.
14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; resolve any issues introduced by this task.
   - Starter snippet (adapt names to exact existing symbols): `const status = mapStatus(internalState); const phase = status === "ingesting" ? mapPhase(internalState) : undefined;`
   - Verification command after this subtask: `npm run test --workspace server -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://json-schema.org/understanding-json-schema/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
   - Acceptance criteria focus: AC11, AC12, AC13, AC14, AC15, AC25, AC26, AC27, AC28.
   - Files to read/edit: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`, `server/src/ingest/ingestJob.ts`, `server/src/test/unit/tools-ingested-repos*.test.ts`, `server/src/test/unit/ingest-roots*.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] Run targeted ingest listing/status mapping tests, including overlay-precedence metadata retention and terminal-phase omission for all terminal statuses; confirm pass.

#### Implementation notes

- Pending implementation.

---

### 6. Server: move no-change reembed exit ahead of AST and embedding work, and normalize successful terminal status

- Task Status: **__to_do__**
- Git Commits: `None yet`

#### Overview

Ensure no-change delta runs exit before AST parse/upsert/delete and before embedding calls, while still returning successful terminal `completed` semantics for no-change and deletion-only success paths.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: Tree-sitter project docs for AST parse pipeline constraints and parser invocation expectations: https://tree-sitter.github.io/tree-sitter/
- Verified on 2026-03-02: `tree-sitter-typescript` grammar repository docs used for TS/TSX parser behavior assumptions in this ingest pipeline: https://github.com/tree-sitter/tree-sitter-typescript
- Verified on 2026-03-02: Node.js event-loop guidance for early-return optimization (avoid unnecessary AST/embedding work): https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
- Verified on 2026-03-02: Mongoose docs for database write/read semantics used by ingest delta and terminal-state mapping paths: https://mongoosejs.com/docs/
- Verified on 2026-03-02: Jest getting-started docs for deterministic unit/integration race test structure: https://jestjs.io/docs/getting-started
- Verified on 2026-03-02: Cucumber guides overview for feature/step convention and executable specification structure: https://cucumber.io/docs/guides/
- Verified on 2026-03-02: Cucumber 10-minute tutorial (guides subpath requested) for concrete feature/step wiring used by ingest race scenarios: https://cucumber.io/docs/guides/10-minute-tutorial/

#### Subtasks

1. [ ] Refactor reembed delta flow to compute no-change decision before AST parsing/writing and embedding loops.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`
   - Required behavior: no-change path exits without AST parse/upsert/delete and without embedding calls.
2. [ ] Keep deletion-only delta cleanup logic simple and unchanged except for terminal contract normalization.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`
   - Required behavior: deletion-only successful path keeps existing cleanup behavior and avoids broad control-flow rewrites.
3. [ ] Ensure successful no-change and deletion-only paths resolve as external-success `completed`.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts` (if mapping updates are required)
4. [ ] Add/extend tests proving no-change bypasses AST/embedding work.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingest*.test.ts`, related ingest unit suites
5. [ ] Add/extend tests proving deletion-only success still reports `completed`.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingest*.test.ts`, related ingest unit suites
6. [ ] Add/extend one focused race regression test for cancellation near early-return boundary.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/features/ingest-delta-reembed.feature`, `server/src/test/steps/ingest-delta-reembed.steps.ts`
   - Required coverage: exactly one terminal outcome under cancel/no-change timing race.
7. [ ] Add/extend mixed-delta success-path tests proving external terminal status remains `completed`.
   - Starter snippet (adapt names to exact existing symbols): `expect(result.status).toBe('completed');`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingest*.test.ts`
   - Required coverage: mixed delta (adds/modifies/deletes in one run) resolves externally as successful terminal `completed`.
8. [ ] Add/extend regression tests confirming existing AST failure semantics remain unchanged for changed-file runs.
   - Starter snippet (adapt names to exact existing symbols): `expect(result.status).toBe('error');`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC17 edge-case boundary protection.
   - Files to read/edit: `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingest*.test.ts`
   - Required coverage: changed-file AST parse failures still surface the same failure outcome/shape as before this story (no accidental semantics change).
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; resolve any issues introduced by this task.
   - Starter snippet (adapt names to exact existing symbols): `if (delta.added === 0 && delta.modified === 0 && delta.deleted === 0) return completedNoChangeResult();`
   - Verification command after this subtask: `npm run test --workspace server -- ingest-ast`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://tree-sitter.github.io/tree-sitter/ | https://github.com/tree-sitter/tree-sitter-typescript | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | https://mongoosejs.com/docs/ | https://jestjs.io/docs/getting-started
   - Acceptance criteria focus: AC16, AC17.
   - Files to read/edit: `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`, `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/reingest*.test.ts`, `server/src/test/features/ingest-delta-reembed.feature`, `server/src/test/steps/ingest-delta-reembed.steps.ts`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run test --workspace server`
3. [ ] Run targeted no-change/deletion-only/mixed-delta ingest tests, including unchanged AST-failure semantics regression, and confirm pass.

#### Implementation notes

- Pending implementation.

---

### 7. Frontend: consume external ingest `status`/`phase` contract and preserve active repository visibility

- Task Status: **__to_do__**
- Git Commits: `None yet`

#### Overview

Align Ingest page data normalization/rendering with server contract updates so active runs remain visible with coarse `ingesting` status and optional phase details.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: React effect synchronization guidance for ingest polling/hydration and stable state transitions: https://react.dev/learn/synchronizing-with-effects
- Verified on 2026-03-02 via MUI MCP: Material UI v6.4.12 index used for component/API behavior consistency with this repo version: https://llms.mui.com/material-ui/6.4.12/llms.txt
- Verified on 2026-03-02 via MUI MCP: MUI Table component docs for rendering active/terminal ingest status and optional phase display: https://llms.mui.com/material-ui/6.4.12/components/table.md
- Verified on 2026-03-02: TypeScript narrowing handbook for discriminated unions around `status` and optional `phase`: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- Verified on 2026-03-02: TypeScript 5.9 release notes to align syntax/typing assumptions with repo toolchain: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- Verified on 2026-03-02: React Testing Library intro for UI-level status/phase rendering assertions: https://testing-library.com/docs/react-testing-library/intro
- Verified on 2026-03-02: Jest `expect` assertions for hook normalization and render contract tests: https://jestjs.io/docs/expect

#### Subtasks

1. [ ] Update ingest API/client types for external `status` and optional `phase` fields.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Verification command after this subtask: `npm run test --workspace client -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `common/src/lmstudio.ts`, `client/src/hooks/useIngestRoots.ts`
2. [ ] Update ingest root normalization logic to parse external `status` and optional `phase`.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Verification command after this subtask: `npm run test --workspace client -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `client/src/hooks/useIngestRoots.ts`
   - Required behavior: normalized client model preserves status/phase semantics and terminal phase omission.
3. [ ] Update ingest list/table components to render active status from new external fields.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Verification command after this subtask: `npm run test --workspace client -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `client/src/components/ingest/RootsTable.tsx`, `client/src/pages/IngestPage.tsx`
   - Required behavior: active repos stay visible with `status=ingesting`; phase shown only when present.
4. [ ] Update ingest detail/status components to render phase only for active statuses.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Verification command after this subtask: `npm run test --workspace client -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/pages/IngestPage.tsx`
   - Required behavior: active repos stay visible with `status=ingesting`; phase shown only when present.
5. [ ] Add/extend client tests for ingest hook/type normalization semantics.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Verification command after this subtask: `npm run test --workspace client -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `client/src/test/ingest*.test.tsx`
   - Required coverage: normalized status/phase shape matches external contract and terminal phase omission rules.
6. [ ] Add/extend client tests for active visibility and status/phase display semantics in UI.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Verification command after this subtask: `npm run test --workspace client -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `client/src/test/ingest*.test.tsx`
   - Required coverage: no disappearance during active run, terminal states omit phase display.
7. [ ] Add/extend client rendering tests for terminal ingest statuses (`completed`, `cancelled`, `error`) and absent phase text.
   - Starter snippet (adapt names to exact existing symbols): `expect(screen.queryByText(/phase/i)).not.toBeInTheDocument();`
   - Verification command after this subtask: `npm run test --workspace client -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC14, AC15, AC25.
   - Files to read/edit: `client/src/test/ingest*.test.tsx`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/pages/IngestPage.tsx`
   - Required coverage: all terminal statuses render correctly in UI and never display stale phase labels.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; resolve any issues introduced by this task.
   - Starter snippet (adapt names to exact existing symbols): `const phase = row.status === "ingesting" ? row.phase : undefined;`
   - Verification command after this subtask: `npm run test --workspace client -- ingest`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://react.dev/learn/synchronizing-with-effects | https://llms.mui.com/material-ui/6.4.12/llms.txt | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
   - Acceptance criteria focus: AC11, AC12, AC14, AC15, AC25, AC28.
   - Files to read/edit: `common/src/lmstudio.ts`, `client/src/hooks/useIngestRoots.ts`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/pages/IngestPage.tsx`, `client/src/test/ingest*.test.tsx`

#### Testing

1. [ ] `npm run build --workspace client`
2. [ ] `npm run test --workspace client`
3. [ ] Run targeted ingest status UI tests, including terminal-status display and phase-omission assertions, and confirm pass.

#### Implementation notes

- Pending implementation.

---

### 8. Documentation: update architecture and file-map docs for final 0000038 behavior

- Task Status: **__to_do__**
- Git Commits: `None yet`

#### Overview

Update story-adjacent documentation so junior developers can understand final stop semantics, blocking MCP reingest behavior, and ingest status/phase mapping without reverse-engineering code.

#### Documentation Locations (External References Only)

- Verified on 2026-03-02: Mermaid intro and syntax references for updating architecture/flow diagrams without syntax drift: https://mermaid.js.org/intro/
- Verified on 2026-03-02: Mermaid flowchart syntax details for contract-flow updates in `design.md`: https://mermaid.js.org/syntax/flowchart.html
- Verified on 2026-03-02: MCP tools specification for documenting terminal-only reingest response semantics accurately: https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
- Verified on 2026-03-02: JSON-RPC spec to document pre-run protocol-error boundaries correctly: https://www.jsonrpc.org/specification

#### Subtasks

1. [ ] Update `design.md` with final stop-race handling, blocking reingest contract flow, and status/phase mapper behavior.
   - Starter snippet (adapt names to exact existing symbols): `Document final contract JSON examples and changed file paths in design.md/projectStructure.md/story notes.`
   - Verification command after this subtask: `npm run format:check --workspaces`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://mermaid.js.org/intro/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification
   - Acceptance criteria focus: AC22 and cross-check of all implemented AC behavior.
   - Files to read/edit: `design.md`
2. [ ] Update `projectStructure.md` with all files added/removed/renamed across this story’s implementation tasks.
   - Starter snippet (adapt names to exact existing symbols): `Document final contract JSON examples and changed file paths in design.md/projectStructure.md/story notes.`
   - Verification command after this subtask: `npm run format:check --workspaces`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://mermaid.js.org/intro/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification
   - Acceptance criteria focus: AC22 and cross-check of all implemented AC behavior.
   - Files to read/edit: `projectStructure.md`
3. [ ] Update this story plan’s Implementation Notes sections as each task completes, including key decisions and deviations.
   - Starter snippet (adapt names to exact existing symbols): `Document final contract JSON examples and changed file paths in design.md/projectStructure.md/story notes.`
   - Verification command after this subtask: `npm run format:check --workspaces`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://mermaid.js.org/intro/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification
   - Acceptance criteria focus: AC22 and cross-check of all implemented AC behavior.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`
4. [ ] Run `npm run format:check --workspaces` and fix markdown/style issues if needed.
   - Starter snippet (adapt names to exact existing symbols): `Document final contract JSON examples and changed file paths in design.md/projectStructure.md/story notes.`
   - Verification command after this subtask: `npm run format:check --workspaces`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://mermaid.js.org/intro/ | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/ | https://www.jsonrpc.org/specification
   - Acceptance criteria focus: AC22 and cross-check of all implemented AC behavior.
   - Files to read/edit: `design.md`, `projectStructure.md`, `planning/0000038-agent-ux-stop-and-ingest-status.md`

#### Testing

1. [ ] Review docs against implemented behavior and acceptance criteria; confirm no contract contradictions remain.

#### Implementation notes

- Pending implementation.

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

1. [ ] Validate each acceptance criterion in this story explicitly and record pass/fail evidence in Implementation notes.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`, `playwright-report/*`
2. [ ] Execute manual stop-race scenario: click Stop before inflight id is known and confirm no command retries/steps start afterward.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
3. [ ] Execute manual chat-cancel mismatch scenario: cancel with stale/invalid `inflightId` and confirm chat still returns deterministic `INFLIGHT_NOT_FOUND` failure signaling.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
4. [ ] Execute manual MCP reingest completed scenario for both surfaces (classic + v2) and confirm terminal contract parity.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
5. [ ] Execute manual MCP reingest cancelled scenario (cancel from GUI while MCP waits) for both surfaces and confirm terminal contract parity.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
6. [ ] Execute manual MCP reingest error scenario for both surfaces and confirm terminal contract parity.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
7. [ ] Execute manual ingest-list visibility scenario in UI: active run remains visible with `status=ingesting` and valid `phase`.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
8. [ ] Execute manual ingest-list visibility scenario in MCP classic listing: active run remains visible with `status=ingesting` and valid `phase`.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
9. [ ] Save manual verification artifacts/screenshots into `test-results/screenshots` with story/task-prefixed filenames.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `test-results/screenshots/*`
10. [ ] Ensure final docs (`design.md`, `projectStructure.md`, and this story file) reflect the implemented behavior with no contradictions.
   - Starter snippet (adapt names to exact existing symbols): `Record AC-by-AC evidence with command output references and screenshot/log artifact names.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC1-AC28 final gate evidence.
   - Files to read/edit: `design.md`, `projectStructure.md`, `planning/0000038-agent-ux-stop-and-ingest-status.md`
11. [ ] Execute manual pre-run validation boundary scenario for both MCP surfaces and confirm JSON-RPC protocol errors are preserved.
   - Starter snippet (adapt names to exact existing symbols): `Call reingest_repository with invalid sourceId and assert protocol error envelope, not terminal payload.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC24 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`
12. [ ] Execute manual no-change and mixed-delta reingest scenarios and confirm successful terminal `completed` semantics.
   - Starter snippet (adapt names to exact existing symbols): `Run no-change reingest then mixed-delta reingest and assert terminal status completed for both MCP surfaces.`
   - Verification command after this subtask: `npm run e2e`
   - Dependency note: this subtask must still satisfy the docs and AC bullets below even if executed in isolation.
   - Docs: https://docs.docker.com/compose/ | https://playwright.dev/docs/intro | https://modelcontextprotocol.io/specification/2025-11-25/server/tools/
   - Acceptance criteria focus: AC16, AC17 final gate evidence.
   - Files to read/edit: `planning/0000038-agent-ux-stop-and-ingest-status.md`, `test-results/screenshots/*`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:up`
7. [ ] `npm run e2e`
8. [ ] `npm run compose:down`

#### Implementation notes

- Pending implementation.
