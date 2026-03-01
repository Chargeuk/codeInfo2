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

### Acceptance Criteria

- Agents page allows instruction text entry while a run is active (user can prepare next message), but send/execute submission remains disabled until run completion.
- Agents conversation sidebar remains interactive during active run so users can switch conversations while work is in progress.
- Stop behavior for command-list/json command runs is deterministic: pressing Stop halts further retries and prevents additional command steps from executing.
- Stop behavior remains deterministic even if inflight identifiers are not yet available at the exact click moment.
- MCP `reingest_repository` is blocking by default and by contract (no optional wait flags).
- Blocking re-embed behavior is implemented consistently across both MCP surfaces exposed by this app (classic MCP and MCP v2 routes).
- Existing MCP keep-alive behavior is used so long-running blocking tool calls keep the connection alive until final completion response.
- Blocking MCP re-embed final response includes terminal outcome semantics (success or terminal failure) and does not return `started` while work is still in progress.
- Blocking MCP re-embed response payload contains final summary data only (no per-phase progress stream/snapshot payload in the final result contract).
- MCP blocking re-embed does not support cancellation via MCP request parameters or MCP cancel contract extensions in this story.
- Users can still observe active ingest/re-embed progress in the web GUI and can cancel from the existing web ingest controls while MCP callers continue waiting for terminal completion response.
- During ingest/re-embed, repositories remain visible in Ingest page embedded folder list with an explicit in-progress status value.
- During ingest/re-embed, repositories remain visible in MCP repository listing with explicit in-progress status value.
- MCP repository listing for active ingest/re-embed includes last completed ingest metadata plus active-run overlay fields.
- MCP ListIngestedRepositories schema/contracts are updated to include repository status field(s) required for in-progress visibility.
- Canonical status model across UI, REST, and MCP uses coarse + detailed fields for active ingestion:
  - coarse top-level status `ingesting` for all in-progress runs;
  - detailed phase field exposing current phase (`queued`, `scanning`, `embedding`).
- Any successful ingest/re-ingest request is reported as `completed` regardless of internal path taken (full embed, no-change early return, deletion-only delta path, or mixed delta path).
- Re-embed flow performs file-change delta decision early; when no files changed, the run exits early and performs no embedding and no AST parsing/upsert/delete work.
- UI and server tests are added/updated for all above behaviors, including MCP classic + MCP v2 parity coverage.
- Documentation updates (README/design/projectStructure as needed) reflect new stop semantics, blocking MCP re-embed behavior, repository status visibility, and no-change early return behavior.

### Out Of Scope

- Introducing user-selectable MCP options for blocking vs non-blocking re-embed.
- Adding new ingest transport protocols beyond current HTTP + WebSocket + MCP behavior.
- Redesigning overall Agents or Ingest page layouts beyond changes required to support interaction and status behavior.
- Refactoring unrelated ingestion pipeline components not required for early no-change return.
- Changing model-lock policy or embedding provider selection rules beyond what is required for this story.

### Questions

- If a user cancels ingest/re-embed from the web GUI while a blocking MCP `reingest_repository` call is waiting, should MCP return an error contract (for example a `CANCELLED`-type error) or a normal terminal result payload with `status: cancelled`?
- Confirm canonical active-ingest field names across UI, REST, and MCP payloads: `status` (coarse) and `phase` (detailed).
- Should final blocking MCP summary include a compact nested `summary` object (counts, duration, message) or only top-level terminal fields?

## Implementation Ideas

- Agents UX unblocking:
  - Decouple input/sidebar interactivity from run submission gating. Keep submit buttons disabled while allowing text input and conversation selection.
  - Reuse chat page interaction model as baseline parity behavior.

- Reliable stop for command-list runs:
  - Ensure server-side command runner abort path is triggered even when inflight registry state is transient/missing.
  - Consider direct command-run abort fallback by conversation id when cancel request arrives, not only when inflight abort returns `ok`.
  - Add regression coverage for stop timing race: stop clicked before inflight id is known.

- Blocking MCP re-embed on both MCP surfaces:
  - Change reingest tool service contract from `started` to “wait-until-terminal”.
  - Keep keep-alive enabled during tool execution and finalize with one JSON-RPC response at terminal state.
  - Unify shared blocking implementation consumed by both `server/src/mcp/server.ts` and `server/src/mcp2/*` tool wiring.
  - Keep final tool response contract summary-only (terminal outcome + final metadata), without per-phase progress payload sections.
  - Do not add MCP-side cancel request fields or JSON-RPC cancel extensions for this story; cancellation remains a web GUI concern.

- Repository visibility while ingesting:
  - Merge active ingest job state with persisted roots metadata in both ingest roots route and MCP list-ingested repositories tool.
  - Add repository status fields to tool payload schema and route payloads using coarse + detailed model (`status: ingesting`, `phase: queued|scanning|embedding` while active).
  - For active runs, preserve last completed ingest metadata and apply active-run overlay fields rather than replacing metadata entirely.
  - Ensure in-progress entries are present even when roots metadata was removed/replaced during re-embed.

- No-change early return and status semantics:
  - Move delta no-op decision to earliest safe point after file discovery/hash comparison.
  - Short-circuit before AST parse loop and embedding loop when no changed/added/deleted work exists.
  - Standardize terminal success semantics so successful runs always emit `completed` (including no-change and deletion-only outcomes), with concise summary text in final response payloads.

- Testing:
  - Client RTL tests for Agents input/sidebar behavior during run.
  - Server unit/integration tests for stop-abort race handling and command retry halt.
  - MCP classic and MCP v2 tests verifying blocking semantics and final response contracts.
  - Ingest route/tool tests for in-progress repository visibility and status fields.
  - Ingest pipeline tests for no-change early return skipping AST + embedding work.
