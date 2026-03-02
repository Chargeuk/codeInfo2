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

Repository visibility during ingest is also incomplete. Repositories being ingested/re-embedded can disappear from both the Ingest page list and MCP repository listing while processing, which leads users and AIs to believe the repository does not exist. The desired behavior is to always include such repositories with a visible ingest status (for example `ingesting`) in both UI and MCP responses.

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
12. During an active ingest/re-embed run, the repository remains visible in MCP repository listing with coarse status `ingesting`.
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
20. MCP classic and MCP v2 return the same field names and status semantics for the same terminal outcome.
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

## Message Contracts And Storage Shapes

Validated from current code contracts and persisted metadata usage on 2026-03-02 via `code_info`, `deepwiki`, and `context7`.

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

2. Repository listing payloads (`/ingest/roots` and MCP `ListIngestedRepositories`):
   - Introduce explicit external run-state fields for both surfaces:
     - `status: "ingesting" | "completed" | "cancelled" | "error"`
     - `phase?: "queued" | "scanning" | "embedding"` (present only when `status="ingesting"`)
   - Active overlay fields come from runtime status (`status`, `phase`, live counters, active `runId`) while last completed metadata remains from persisted roots metadata.
   - Internal terminal `skipped` is not emitted externally; map it to external `status: "completed"`.
   - `phase` is omitted (not null/empty) for terminal statuses.

3. Schema version signaling:
   - Bump ingest listing `schemaVersion` (shared constant used by `/ingest/roots` and MCP `ListIngestedRepositories`) to represent status/phase contract expansion.

### Contracts That Stay Unchanged

- WS ingest event envelope remains unchanged:
  - `ingest_snapshot` / `ingest_update` with `status: IngestJobStatus | null`.
- MCP keep-alive transport behavior remains unchanged (heartbeat during long-running `tools/call`).
- `reingest_repository` input shape remains unchanged (`sourceId` only).

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

Validated using repository analysis (`code_info`) plus protocol cross-checks (`deepwiki`, `context7`) on 2026-03-02.

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
   - Primary files: `server/src/lmstudio/toolService.ts`, `server/src/routes/ingestRoots.ts`, `server/src/ingest/ingestJob.ts`.
   - Add one shared status mapper/overlay path used by both listing surfaces:
     - internal `queued|scanning|embedding` -> external `status: ingesting` + `phase`;
     - internal `completed|cancelled|error` -> same external `status`, no `phase`;
     - internal `skipped` -> external `completed`.
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
- Keep-alive and terminal payload semantics must remain aligned with MCP transport behavior (long wait with heartbeats, single terminal tool result).

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
    - https://modelcontextprotocol.io/specification/2025-06-18/server/tools/
    - https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress/
    - https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation/
    - https://www.jsonrpc.org/specification
