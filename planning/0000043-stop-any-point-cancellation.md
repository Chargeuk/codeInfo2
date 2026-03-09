# Story 0000043 – Reliable Stop At Any Point For Chat, Agents, And Flows

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Users expect Stop to mean one thing everywhere in the product: once they press it, the current run should stop as soon as possible and the same conversation should be immediately safe to use again. Today that is not reliably true.

From a user point of view, the failure is confusing because the UI can look stopped even when the server is still running work in the background. A user can click Stop and see a local stopped message, but if they try again they can receive a conflict message saying the conversation still has a run in progress in another tab or window. This makes Stop feel broken and makes it hard to trust whether the application has actually stopped spending time, tokens, or command retries.

The issue affects more than one run type:

- a normal chat or agent instruction can be started and then stopped before the GUI has received the active inflight identifier;
- an agent command list can be started and then stopped before the first command step has fully surfaced its inflight identity to the GUI;
- flow runs use the same general stop pattern and can hit the same race, especially because they are websocket-driven and can keep working after the client has already switched to a local stopped state.

The expected user-visible outcome of this story is simple:

- if the user presses Stop at any point after starting a chat, agent instruction, command run, or flow run, the current run is treated as cancelled by the system even if the UI has not yet learned the inflight id;
- the GUI does not claim the run is fully stopped until the server has acknowledged that terminal state;
- after a successful stop, the same conversation can be used again without receiving a stale `RUN_IN_PROGRESS` conflict from the previous run.

For this story, the words below have precise meanings:

- active run: the single interactive run that currently owns the conversation lock for a given `conversationId`; this repository already allows only one such run at a time, regardless of whether it started from Chat, Agents, command execution, or Flows;
- startup race: the short period after a run has started server-side but before the browser has learned the run `inflightId`;
- conversation-only stop: a `cancel_inflight` request that contains `conversationId` but no `inflightId`;
- terminal stopped confirmation: the matching `turn_final` event for that run with `status: 'stopped'`.

Run lifecycle boundaries for this story:

- active ownership begins when the conversation lock is acquired and a runtime run token is assigned to that active run;
- precise server-side run identity exists once the server has either created the inflight entry or bound the stop request to that active run token;
- precise client-side run identity exists once the browser has received and stored the `inflightId`;
- the startup race is the period after active ownership has begun but before the browser has usable `inflightId` state.

Surface identity timing for this story:

- chat start, normal agent instruction start, and flow start already return `inflightId` in their `202 started` responses, but the user can still press Stop before the browser has processed and stored that response;
- agent command-list start returns `conversationId` but not `inflightId`, so conversation-only stop is the expected early-stop path for that surface.

Research-backed scoping constraints for this story:

- the repository currently uses a simple per-conversation lock, not a queue; a second run either becomes the active run or fails immediately with `RUN_IN_PROGRESS`, so this story only needs to handle cancellation of work that actually became active;
- Node.js cancellation is cooperative; aborting a signal does not preempt arbitrary synchronous code in the middle of execution, so this story must promise cancellation at the next abort-aware async boundary or explicit cancellation checkpoint, not instant interruption of every line of work;
- when a child process or provider runtime supports abort signals, the story should use that support, but it must not promise full recursive teardown of unrelated descendant processes unless the existing runtime already guarantees it.

This story is intentionally about stop correctness and run ownership, not about redesigning the transcript UI. The key requirement is that Stop becomes authoritative across the full client-server lifecycle, including the race where a run exists server-side before the client has enough local state to identify it precisely.

### Acceptance Criteria

- Stop works for all supported interactive run surfaces in this repository:
  - Chat page send runs
  - Agents page normal instruction runs
  - Agents page command-list/json command runs
  - Flows page runs
- If the user clicks Stop after a run has been started but before the client has received an `inflightId`, the system still cancels the active run for that conversation instead of only updating local UI state.
- The definition of active run is fixed for this story:
  - it is the run that currently holds the conversation lock for that `conversationId`;
  - there is at most one active interactive run per conversation;
  - Stop must never cancel a later replacement run that started after the original stop request was issued.
- If the user clicks Stop after the client already knows the `inflightId`, the stop path continues to cancel the correct active run and does not regress existing inflight-targeted behavior.
- The websocket stop request remains `cancel_inflight`:
  - when `inflightId` is known, the client sends both `conversationId` and `inflightId`;
  - when `inflightId` is not yet known, the client still sends `cancel_inflight` with `conversationId` only.
- The story does not introduce queued-stop behavior:
  - if a second run never became active because the conversation lock rejected it with `RUN_IN_PROGRESS`, this story does not add cancellation semantics for that rejected start attempt;
  - stop behavior only applies to the run that actually became active for the conversation.
- After Stop is requested, no further agent command step may start and no retry may be scheduled for that cancelled run.
- After Stop is requested, no further flow step may continue executing for the cancelled run.
- Cancellation checkpoints are explicit:
  - command execution must check cancellation before starting each next step and before scheduling a retry;
  - flow execution must check cancellation before starting each next step or loop iteration that would continue work for the cancelled run.
- Cancellation timing is defined realistically:
  - when the current operation already supports `AbortSignal`, the stop path must trigger that abort signal immediately;
  - when the current operation is custom logic that does not support signal-based interruption, the stop path must complete at the next explicit cancellation check;
  - this story does not require arbitrary synchronous work to stop in the middle of a single uninterrupted CPU-bound section.
- After Stop is requested and the server confirms termination, the same conversation may be used again without returning `409 RUN_IN_PROGRESS` from the cancelled prior run.
- Confirmation is explicit:
  - for an active cancelled run, confirmation means the matching `turn_final` with `status: 'stopped'` has been published and the associated active run ownership has been cleaned up;
  - for a conversation-only no-op because no active run exists, confirmation means the UI has left `stopping` and returned to its normal ready state without a terminal stopped or failed bubble.
- The stop contract is server-authoritative:
  - the client may show a transient stopping state immediately;
  - the client must not render a terminal “stopped” success state until the server publishes or returns the matching `turn_final` event for that run with `status: 'stopped'`;
  - until that event arrives, the UI remains in a non-terminal `stopping` state;
  - the exception is the documented conversation-only no-active-run path, where the UI must leave `stopping` without inventing a terminal event.
- Conversation-only cancellation semantics are explicit and supported where needed:
  - if `conversationId` is known but `inflightId` is not yet known, the stop request still targets the currently active run for that conversation;
  - if no active run exists for that conversation when the server processes the request, the request is treated as a no-op and must not publish a failed `turn_final`;
  - this does not allow a stale stop request for an older run to incorrectly cancel a newer run started later in the same conversation;
  - when the no-active-run no-op path happens, the page must clear its stopping state and re-enable controls instead of staying stuck waiting for a terminal websocket event that will never arrive.
- A stop request issued during the startup race is consumed exactly once by the run that was active when Stop was pressed.
- Startup-race ownership is explicit:
  - the stop request binds to the same active run token that owned the conversation lock when the stop request was accepted;
  - once that bound run consumes the stop request, later runs in the same conversation must not observe or inherit it.
- Duplicate stop requests are safe:
  - the first successful stop request wins;
  - later duplicate stop requests for the same run may be ignored or treated as no-op success, but must not convert the run into `failed`, must not emit a second terminal bubble, and must not move the UI back out of its current stop-related state.
- Existing late-event protections remain non-destructive:
  - stale websocket events from a cancelled or earlier run must not re-activate a stopped UI state or corrupt a newer run in the same conversation;
  - client and server matching must continue to use the run `inflightId` when it is available so that late events from an older run are ignored instead of rebinding the UI.
- Existing UI affordances remain consistent:
  - Stop remains visible while a stop is pending;
  - send/execute controls remain disabled only for the currently active or stopping run, not permanently after the stop finishes;
  - once the matching `turn_final` with `status: 'stopped'` arrives, the conversation is immediately usable again from the same tab without refresh;
  - for the documented conversation-only no-active-run path, the conversation remains usable and the controls re-enable as soon as the page clears `stopping`.
- Automated coverage is added or updated for:
  - agent command stop before `inflightId` is known;
  - normal agent instruction stop before `inflightId` is known;
  - chat stop before `inflightId` is known;
  - flow stop before `inflightId` is known;
  - server-side cancellation behavior for conversation-only stop requests;
  - conversation-only stop with no active run behaves as a no-op and does not emit `INFLIGHT_NOT_FOUND`;
  - no new command retry/step starts after cancellation;
  - no new flow step/loop iteration starts after cancellation;
  - for active cancellation paths, the UI remains `stopping` until the matching `turn_final` reports `status: 'stopped'`;
  - for the documented no-active-run no-op path, the UI clears `stopping` without waiting for a terminal websocket event;
  - no stale `RUN_IN_PROGRESS` conflict after a confirmed stop.

### Out Of Scope

- Redesigning transcript layouts, bubble styling, or page structure beyond what is required to represent stopping vs stopped correctly.
- Introducing a full general-purpose run queue or multi-run-per-conversation scheduler.
- Changing MCP cancellation protocols for unrelated tools outside the interactive chat/agent/flow stop paths.
- Reworking unrelated websocket event schemas unless a minimal contract addition is required for correct stop ownership.
- Fixing unrelated transcript rendering, hydration, or sidebar selection bugs that are not necessary to make Stop reliable.
- Supporting multiple simultaneous interactive runs for one conversation.
- Adding cancellation semantics for run attempts that never became active because they were rejected up front with `RUN_IN_PROGRESS`.
- Guaranteeing forced recursive teardown of every descendant OS process beyond the abort behavior already exposed by the current provider or runtime integrations.

### Questions

None. Repository and external research are sufficient to task this story.

## Contracts And Storage Shapes

- External websocket message contract:
  - do not add a new stop message type for this story;
  - continue using the existing `cancel_inflight` client message with `conversationId` required and `inflightId` optional;
  - continue using the existing `turn_final` server event as the terminal result contract for stop outcomes;
  - add one non-terminal websocket acknowledgment event for stop requests:
    - recommended name: `cancel_ack`
    - required fields:
      - `requestId: string`
      - `conversationId: string`
      - `result: 'accepted' | 'noop'`
      - `inflightId?: string`
    - purpose:
      - `accepted` confirms the server has bound the stop request to the targeted active run;
      - `noop` confirms the documented conversation-only no-active-run path so the client can leave `stopping` without inventing a fake terminal bubble;
  - successful cancellation of an active run continues to be represented by `turn_final.status === 'stopped'`.

- Existing client-visible contract that should remain unchanged:
  - explicit `{ conversationId, inflightId }` stop requests continue to target one known run and may still use the existing invalid-target failure behavior when the inflight id does not match an active run;
  - conversation-only `{ conversationId }` stop requests continue to be valid and must remain available because some surfaces, especially agent command runs, do not always give the client a usable `inflightId` before Stop can be pressed;
  - if a conversation-only stop arrives when there is no active run, keep the current no-op behavior rather than inventing a new failure terminal contract for this story, but emit the new non-terminal `cancel_ack` result so the client can recover deterministically.

- REST response contract:
  - do not add a new REST response shape for this story just to carry stop metadata;
  - chat, agent, and flow start routes may continue returning their current response bodies;
  - agent command run start may continue returning `conversationId` without `inflightId`, which is one of the reasons conversation-only stop must remain first-class.

- New internal runtime storage shape required for this story:
  - extend the current in-memory active-run ownership model from simple set membership to lightweight ownership metadata per conversation;
  - recommended shape:
    - `ActiveRunOwnership`
    - `runToken: string`
    - `startedAt: string`
  - this remains runtime-only and is not exposed over websocket or persisted to Mongo;
  - `runToken` is created when active ownership begins, which is the point that a startup-race stop request must bind against.

- New internal pending-cancel storage shape required for this story:
  - add a conversation-scoped pending cancel registry so Stop can be remembered before an `inflightId` exists;
  - recommended shape:
    - `PendingConversationCancel`
    - `runToken: string`
    - `requestedAt: string`
    - `boundInflightId?: string`
  - meaning:
    - `runToken` ties the stop request to the active run instance that owned the conversation when Stop was pressed;
    - `requestedAt` is for cleanup, logging, and deterministic ordering;
    - `boundInflightId` is filled once the run's inflight id becomes known so later matching and cleanup can stay precise.

- Internal storage rules for the new runtime shapes:
  - keep both ownership and pending-cancel state in memory only;
  - clear pending-cancel state once it has been consumed by the matching run and that run reaches its terminal finalization path;
  - clear ownership state in the same cleanup path that releases the conversation lock;
  - if a conversation-only stop finds no active run, do not create or retain pending-cancel state for that conversation;
  - do not allow a stale pending cancel to survive long enough to bind to a newer replacement run in the same conversation.

- Persistent storage schema:
  - no Mongo schema or document-shape change is required for this story;
  - `Turn.status` already supports `'stopped'`, which is sufficient for the persistent terminal state;
  - do not persist transient pending-cancel or active-run ownership data unless the story scope later expands to require restart-safe cancellation semantics.

## Cancellation Targeting

- Stop targeting follows one deterministic order for this story:
  - if `cancel_inflight` includes both `conversationId` and `inflightId`, treat it as an explicit target request for that one run;
  - if `cancel_inflight` includes only `conversationId`, treat it as a conversation-only request for the run token that currently owns that conversation;
  - if there is no active run token for that conversation, the request is a no-op.

- Explicit-target behavior:
  - if the provided `inflightId` matches the active run for that conversation, cancel that run;
  - if the provided `inflightId` does not match the active run for that conversation, keep the existing invalid-target failure behavior rather than silently converting it into a conversation-only cancel.

- Conversation-only behavior:
  - if a run is active, bind the stop request to that run token and later to its `inflightId` when available;
  - if no run is active, do not create pending-cancel state and do not emit a terminal websocket event.

- Replacement-run protection:
  - a stop request may only affect the run token that owned the conversation when the request was accepted;
  - it must never fall through and cancel a later replacement run that started after the earlier stop request.

## Event Outcomes

- Explicit target matches active run:
  - one `cancel_ack` with `result: 'accepted'` may be published immediately for the initiating client message;
  - exactly one terminal `turn_final` is published for that run;
  - the terminal status is `stopped`.

- Explicit target does not match an active run:
  - keep the existing explicit-target invalid behavior;
  - the client receives one failed terminal outcome rather than a silent no-op.

- Conversation-only stop with active run:
  - the client enters `stopping`;
  - the server binds the request to the active run token;
  - the server emits one `cancel_ack` with `result: 'accepted'`;
  - exactly one terminal `turn_final` with `status: 'stopped'` is eventually published for that run.

- Conversation-only stop with no active run:
  - no terminal websocket event is published;
  - one `cancel_ack` with `result: 'noop'` is published for the initiating client request;
  - no local stopped or failed bubble is invented;
  - the page clears `stopping` and returns to ready state.

## UI State Contract

- UI states for this story are:
  - `idle`: no active run and no stop pending;
  - `active`: a run is in progress;
  - `stopping`: the user has pressed Stop and the page is waiting for the stop outcome for that targeted run;
  - terminal states remain the existing run result states driven by `turn_final`.

- Transition rules:
  - `active -> stopping` happens immediately when the user presses Stop;
  - `stopping -> terminal stopped` happens only when the matching `turn_final` with `status: 'stopped'` arrives for the targeted active run;
  - `stopping -> idle` is allowed only for the documented conversation-only no-active-run path;
  - the UI must not transition directly from `active` to a terminal stopped state based only on the user click.

- UI rendering rules:
  - while in `stopping`, show that cancellation is in progress and keep duplicate stop actions from starting independent stop attempts;
  - if the no-op path is reached, clear `stopping` only after the matching `cancel_ack.result === 'noop'` is received, and re-enable controls without rendering a fake stopped or failed terminal bubble;
  - if an explicit invalid target is sent, preserve the current explicit-target error behavior rather than presenting it as a successful stop.

## Edge Cases and Failure Modes

- Cancel arrives just before the run is registered:
  - expected handling: bind the stop request to the active run token and consume it at the first possible boundary;
  - failure to avoid: losing the stop request and allowing the run to continue as if Stop had never been pressed.

- Conversation-only cancel arrives when no active run exists:
  - expected handling: strict no-op, no terminal websocket event, no fake stopped or failed bubble;
  - failure to avoid: leaving the UI stuck in `stopping` or emitting a misleading terminal state.

- Explicit `inflightId` is stale, wrong, or already cleaned up:
  - expected handling: preserve the existing explicit-target invalid behavior;
  - failure to avoid: silently converting the request into a conversation-only cancel or accidentally canceling a different active run.

- Duplicate stop requests arrive for the same run:
  - expected handling: idempotent behavior after the first request wins;
  - failure to avoid: duplicate abort work, duplicate terminal events, duplicate bubbles, or UI state flipping backwards.

- Stop arrives during startup race before first real work checkpoint:
  - expected handling: the request stays bound to the same active run token and is checked before the first step or provider call that can continue work;
  - failure to avoid: the stop request being accepted but the first command or flow step still starting.

- Stop arrives during command retry or backoff:
  - expected handling: retry logic re-checks cancellation before every retry attempt and before any backoff boundary resumes work;
  - failure to avoid: the current attempt stops but a scheduled retry starts anyway.

- Stop arrives during flow loops or multi-step flows:
  - expected handling: cancellation is checked before each step, before each loop iteration, and before any tool or agent handoff that would continue the flow;
  - failure to avoid: long-running flow sequences continue through extra steps after stop has already been requested.

- Stop or abort happens after completion has effectively finished but before cleanup has completed:
  - expected handling: finalization remains single-path and cleanup stays idempotent;
  - failure to avoid: mixed terminal states, duplicate `turn_final`, or leaked active-run ownership state.

- Inflight or ownership runtime state is missing or inconsistent:
  - expected handling: explicit-target requests prefer safe explicit failure, while conversation-only requests prefer safe no-op when the target cannot be resolved confidently;
  - failure to avoid: canceling the wrong run because registry state is stale or partially cleaned up.

- Cleanup work throws after stop has been requested:
  - expected handling: cleanup failures are logged, but ownership and pending-cancel state are still released in a guaranteed fallback path;
  - failure to avoid: orphaned lock state, orphaned pending-cancel state, or a page that can never leave `stopping`.

- Multi-tab or multi-window use on the same conversation:
  - expected handling: explicit `inflightId` stays deterministic, while conversation-only stop resolves through the active run token for that conversation;
  - failure to avoid: one tab accidentally stopping a later replacement run started by another tab.

- Reconnect or late subscriber after stop was requested elsewhere:
  - expected handling: reconciled UI state comes from the active run, `cancel_ack`, or final event state for that conversation, not stale local assumptions;
  - failure to avoid: a page showing phantom running or phantom stopping state after reconnect.

- User changes page or conversation while stop is pending:
  - expected handling: stop remains conversation-scoped and can still finalize correctly even if the initiating page is no longer foregrounded;
  - failure to avoid: local state being dropped so the stop completes server-side but the UI never reconciles.

- Late provider, tool, or websocket events arrive after the run has already terminalized:
  - expected handling: late events are ignored for UI reactivation and do not reopen a finished run;
  - failure to avoid: cancelled runs appearing active again or corrupting a newer run in the same conversation.

- Underlying async operation ignores abort immediately:
  - expected handling: the story still succeeds at the next explicit cancellation checkpoint;
  - failure to avoid: promising instant preemption where the runtime only offers cooperative abort semantics.

- Malformed or invalid cancel payload reaches the websocket boundary:
  - expected handling: existing strict validation rejects it without side effects on active run state;
  - failure to avoid: undefined partial cancellation behavior from bad payloads.

## Research Findings

- Repository behavior today:
  - interactive runs are guarded by a simple per-conversation lock, so there is one active run at most and no built-in queued runner to cancel later;
  - websocket tests already prove that conversation-only `cancel_inflight` is accepted and currently behaves as a no-op when there is no active run, rather than emitting `INFLIGHT_NOT_FOUND`.

- External behavior that constrains this story:
  - `AbortSignal.any(...)` in Node.js combines cancellation sources, but cancellation remains cooperative and must be observed by the code or API doing the work;
  - `abortSignal.throwIfAborted()` is available for explicit checkpoints, which makes it suitable for command and flow step boundaries;
  - Node.js child-process abort support behaves like sending a kill signal to the child process, but platform/runtime behavior does not guarantee recursive teardown of every descendant process tree by default.

- Version validation for this repository:
  - client dependencies in scope are React `19.2.0`, MUI Material `6.4.1`, and TypeScript `5.9.3`;
  - server dependencies in scope are Node `>=22`, `ws` `8.18.3`, Mongoose `9.0.1`, and TypeScript `5.6.3`;
  - these versions already support the planned primitives for this story:
    - React `useState` and `useRef` are sufficient for the shared `stopping` state and ref-backed inflight tracking with no compatibility workaround;
    - MUI `Chip` and `CircularProgress` already support the current status-chip pattern, so the story should extend the existing chip rendering instead of replacing components;
    - `ws` supports the current `WebSocketServer({ noServer: true })` pattern and transport of additional JSON event variants, so the story should extend the existing message union instead of changing transport libraries;
    - Mongoose already persists `Turn.status` with enum support for `'ok' | 'stopped' | 'failed'`, so no schema migration or persistence-shape change is required;
    - Node `>=22` already supports `AbortSignal.any(...)` and `abortSignal.throwIfAborted()`, so no abort polyfill or version guard is required.

- Remaining unknowns after research:
  - none that block tasking or implementation for this story, provided the implementation stays within the scoped guarantees above.

## Implementation Ideas

- Reuse-first rule for this story:
  - do not add parallel websocket contract infrastructure, duplicate lock infrastructure, or separate cancellation state modules if the existing helpers can be extended safely;
  - prefer extending the current websocket type unions, `parseClientMessage`, `publish*` helpers, `tryAcquireConversationLock` / `releaseConversationLock`, `createInflight` / `getInflight` / `markInflightFinal` / `cleanupInflight`, and the shared `useChatWs` / `useChatStream` flow before creating new abstractions;
  - when a task adds new behavior, it should name the existing helper or test it is extending instead of describing the work as brand-new infrastructure.

- Version-appropriate implementation guardrails:
  - do not add Node compatibility fallbacks for `AbortSignal.any(...)` or `abortSignal.throwIfAborted()` because the repository already requires Node `>=22`;
  - do not plan a Mongo or Mongoose schema migration for `Turn.status` because the current schema already supports `'stopped'`;
  - do not replace the current MUI `Chip` / `CircularProgress` status UI with a new component family because the installed MUI version already supports the needed props and color variants;
  - do not change websocket libraries or add an RPC wrapper because the installed `ws` version already supports the current `noServer` upgrade flow and custom JSON event payloads.

- Shape the implementation around the existing websocket contract, not a new transport:
  - keep `cancel_inflight` as the stop message and keep `turn_final` as the terminal result event;
  - use `status: 'stopped'` as the successful cancellation outcome for the run that was actually cancelled;
  - keep explicit invalid-target behavior for bad `{ conversationId, inflightId }` pairs, but preserve the current conversation-only no-active-run path as a non-failing no-op unless implementation proves that contract is insufficient.

- Start with the server-side cancellation contract in `server/src/ws/server.ts` and `server/src/ws/types.ts`:
  - normalize how conversation-only stop and inflight-targeted stop are handled so every branch is deterministic;
  - keep the current payload validation rules, but make the runtime behavior explicit for active cancel, duplicate cancel, no active run, and invalid explicit inflight id;
  - use the existing websocket `requestId` to correlate a new `cancel_ack` server event back to the initiating client message for accepted and no-op outcomes;
  - keep stop authority on the server so the UI can wait for the server result instead of inventing a terminal local state.

- Add conversation-scoped pending-cancel tracking in `server/src/chat/inflightRegistry.ts`:
  - extend the inflight layer so a stop request can be recorded before an inflight id exists;
  - key that pending intent by `conversationId`, but bind it to the run that was active when Stop was pressed so it cannot cancel a later run;
  - expose helper functions that let run entrypoints check, consume, clear, and finalize pending cancellation in one place rather than re-implementing the same logic in chat, agents, and flows.

- Wire that shared cancellation behavior through the chat run entrypoints:
  - update `server/src/routes/chat.ts` and the chat stream path so stop is checked before expensive work starts, immediately after inflight creation, and during stream finalization;
  - keep chat cleanup in one `finally` path so lock release, inflight cleanup, and terminal `turn_final` publication stay aligned;
  - preserve the existing late-event protections in the chat stream bridge so late deltas after cancellation do not re-open a completed run.

- Wire the same contract through agent instruction and command execution:
  - `server/src/agents/service.ts` should observe pending cancel before normal instruction runs do meaningful work and should align its final status mapping with chat and flows;
  - `server/src/agents/commandsRunner.ts` should continue using conversation-based abort, but it also needs pending-cancel checks before the first step, before each later step, and before retry scheduling;
  - repeated stop calls for the same command run should remain idempotent, and all abort-controller or conversation-map cleanup should stay in `finally` so retries cannot leak a stale running state.

- Wire the same contract through flow execution in `server/src/flows/service.ts`:
  - check cancellation before the first flow step, before each subsequent step or loop iteration, and at any boundary where a tool or agent call can continue work for the cancelled run;
  - keep the terminal status mapping consistent with the rest of the product so a successful stop becomes `turn_final.status === 'stopped'`, not a generic failure;
  - keep the current inflight and turn cleanup paths aligned so late flow events cannot re-bind the UI after a stop has already terminalized.

- Use cooperative abort properly instead of assuming preemptive cancellation:
  - where existing APIs already accept `AbortSignal`, pass the combined signal through instead of relying only on outer loop checks;
  - between async calls and at step boundaries, use explicit `signal.aborted` or `throwIfAborted()` checks so command and flow loops stop before starting more work;
  - do not promise to interrupt arbitrary synchronous code in the middle of a CPU-bound block, because the runtime does not provide that guarantee.

- Keep the lock model simple and aligned with the current repository behavior:
  - the repository uses a single per-conversation lock rather than a queue, so this story should only cancel work that actually became active;
  - implementation can keep that one-active-run model while upgrading the lock state from bare membership to lightweight ownership metadata as defined above;
  - if a new run is rejected up front with `RUN_IN_PROGRESS`, this story should not invent special stop behavior for that rejected start attempt;
  - stop implementation should therefore focus on active run ownership, cleanup, and unlock timing rather than queue management.

- Update the client stop flow without changing the overall page architecture:
  - `client/src/hooks/useChatWs.ts` already supports `cancelInflight(conversationId, inflightId?)`; keep that API but make sure pages always send `conversationId` and include `inflightId` when known, and expose the new `cancel_ack` event to subscribers;
  - `client/src/hooks/useChatStream.ts` should remain the place that guards against stale or mismatched late events, including duplicate `turn_final` replays, and it must preserve `stopped` as a distinct terminal message status rather than collapsing it into `complete`;
  - `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx` should all switch from immediate local stopped state to an immediate local `stopping` state that only becomes final when the matching `turn_final` arrives, except for the documented no-active-run no-op path, which returns to ready state without a terminal bubble.

- Keep the user-facing stop behavior identical across Chat, Agents, and Flows:
  - Stop should remain visible while the stop request is pending, but duplicate clicks should not create multiple independent stop attempts;
  - send or execute controls should stay disabled only while the run is active or stopping, then recover immediately after the matching stopped final event or the documented no-active-run no-op recovery;
  - no page should claim success locally before the server has confirmed the stop result for the same run, and no page should invent a fake terminal success event for the no-op path.

- Expand automated coverage around the existing high-risk tests instead of inventing a brand-new test strategy:
  - server coverage should primarily extend `server/src/test/unit/ws-server.test.ts`, `server/src/test/unit/ws-chat-stream.test.ts`, `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`, `server/src/test/integration/agents-run-ws-cancel.test.ts`, and the flow integration suites under `server/src/test/integration/flows.run.*.test.ts`;
  - client coverage should extend `client/src/test/useChatWs.test.ts`, `client/src/test/chatPage.stop.test.tsx`, `client/src/test/agentsPage.commandsRun.abort.test.tsx`, `client/src/test/flowsPage.stop.test.tsx`, and the existing inflight-mismatch or late-event tests in `client/src/test/useChatStream.inflightMismatch.test.tsx`;
  - the main cases to prove are startup-race stop before inflight id, duplicate stop idempotence, no new command retry or flow step after cancellation, conversation reusability after confirmed stop, and stale late-event suppression after a cancelled run.

# Tasks

### 1. Normalize WebSocket Cancel Targeting Contract

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update the websocket cancel handler so it follows the story’s targeting and outcome rules exactly. This task is only about the `cancel_inflight` message contract, the new non-terminal `cancel_ack` response, and the immediate server-side results; it must not yet introduce the deeper runtime ownership or frontend behavior changes.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `server/src/ws/types.ts`
- `server/src/ws/server.ts`
- `server/src/test/unit/ws-server.test.ts`
- `server/src/test/unit/ws-chat-stream.test.ts`
- `client/src/hooks/useChatWs.ts`
- Node.js AbortController notes in this plan’s `Research Findings` section

#### Subtasks

1. [ ] Read the story sections `Contracts And Storage Shapes`, `Cancellation Targeting`, `Event Outcomes`, `UI State Contract`, and `Edge Cases and Failure Modes` before changing any code.
2. [ ] Extend the existing websocket unions in `server/src/ws/types.ts` so the contract continues to accept `cancel_inflight` with optional `inflightId`, `parseClientMessage` stays the parser entrypoint, and the new non-terminal `cancel_ack` server event is keyed by the existing `requestId`.
3. [ ] Update the `cancel_inflight` branch in `server/src/ws/server.ts` so explicit `{ conversationId, inflightId }` requests and conversation-only `{ conversationId }` requests follow the documented targeting rules without silently converting one path into the other, and emit `cancel_ack` through the existing websocket publish flow for accepted and no-op outcomes.
4. [ ] Keep the existing explicit invalid-target behavior for stale or wrong `inflightId` requests and keep the documented conversation-only no-op behavior when no active run exists, but make the no-op path observable via `cancel_ack.result === 'noop'` rather than a terminal event.
5. [ ] Add or update focused tests in `server/src/test/unit/ws-server.test.ts` and `server/src/test/unit/ws-chat-stream.test.ts` that prove explicit-target mismatch, conversation-only no-op, accepted/no-op `cancel_ack` correlation by `requestId`, duplicate websocket stop requests, and malformed cancel payload rejection behave as documented.
6. [ ] Update this plan file’s `Implementation notes` for Task 1 after the implementation and tests are complete.
7. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/unit/ws-server.test.ts`
6. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/unit/ws-chat-stream.test.ts`

#### Implementation notes

- No implementation notes yet.

---

### 2. Add Active Run Ownership And Pending-Cancel Runtime State

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Introduce the runtime-only ownership and pending-cancel state the story now depends on by extending the existing conversation lock and inflight registry. This task is only about the in-memory model and its invariants; it must not yet wire chat, agents, flows, or page UX to use that state.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `server/src/agents/runLock.ts`
- `server/src/chat/inflightRegistry.ts`
- `server/src/test/unit/ws-chat-stream.test.ts`
- `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`
- `server/src/routes/chat.ts`
- `server/src/agents/service.ts`
- `server/src/flows/service.ts`

#### Subtasks

1. [ ] Read the story sections `Run lifecycle boundaries`, `Contracts And Storage Shapes`, `Cancellation Targeting`, and `Edge Cases and Failure Modes`.
2. [ ] Extend the existing `tryAcquireConversationLock` and `releaseConversationLock` flow in `server/src/agents/runLock.ts` with lightweight ownership metadata instead of introducing a separate lock manager.
3. [ ] Extend `server/src/chat/inflightRegistry.ts` with the pending-cancel runtime shape and helper functions so they live beside `createInflight`, `getInflight`, `markInflightFinal`, and `cleanupInflight` rather than in a new registry module.
4. [ ] Ensure the extended lock and inflight helpers are idempotent and cannot let a stale pending cancel bind to a later replacement run.
5. [ ] Add or update focused tests that prove ownership tokens are created, pending-cancel is consumed once, no pending-cancel state is retained for the documented no-active-run path, and cleanup fallback still releases runtime state when the primary cleanup path throws.
6. [ ] Update this plan file’s `Implementation notes` for Task 2 after the implementation and tests are complete.
7. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/unit/ws-chat-stream.test.ts`
6. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/unit/agent-commands-runner-abort-retry.test.ts`

#### Implementation notes

- No implementation notes yet.

---

### 3. Integrate Stop Ownership Into Chat Runs

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the extended cancellation ownership model into chat runs only. This task should make chat honor conversation-only startup-race stop, emit the correct terminal outcome, and release runtime state safely without touching agent or flow execution yet.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `server/src/routes/chat.ts`
- `server/src/chat/chatStreamBridge.ts`
- `server/src/chat/interfaces/ChatInterface.ts`
- `server/src/test/unit/ws-chat-stream.test.ts`
- `server/src/test/integration/chat-tools-wire.test.ts`

#### Subtasks

1. [ ] Read the story sections `Event Outcomes`, `UI State Contract`, `Edge Cases and Failure Modes`, and the chat-specific notes in `Implementation Ideas`.
2. [ ] Update `server/src/routes/chat.ts` so chat runs check for pending cancel before meaningful work starts, immediately after inflight creation, and in the finalization path.
3. [ ] Update `server/src/chat/chatStreamBridge.ts` or `server/src/chat/interfaces/ChatInterface.ts` only where necessary to keep cancelled chat runs emitting one terminal `turn_final.status === 'stopped'`, propagating `AbortSignal` through provider APIs that already support it, and reusing `markInflightFinal`, `isInflightFinalized`, and `publishFinalOnce` for late-event protection.
4. [ ] Ensure chat cleanup reuses `cleanupInflight` and `releaseConversationLock` so inflight state, active ownership, and pending-cancel state are released in one safe path even when stop happens near finalization or the primary cleanup path throws.
5. [ ] Add or update chat-focused tests that prove startup-race stop works, the final event is emitted once, late provider events do not reopen a cancelled run, and the same conversation can be reused without a stale `RUN_IN_PROGRESS` conflict after confirmed stop.
6. [ ] Update this plan file’s `Implementation notes` for Task 3 after the implementation and tests are complete.
7. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/unit/ws-chat-stream.test.ts`
6. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/integration/chat-tools-wire.test.ts`

#### Implementation notes

- No implementation notes yet.

---

### 4. Integrate Stop Ownership Into Agent Instruction Runs

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the new cancellation ownership model into normal agent instruction runs only. This task should make normal agent runs honor early stop, publish the correct terminal state, and clean up without touching command-list execution yet.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `server/src/agents/service.ts`
- `server/src/routes/agentsRun.ts`
- `server/src/test/integration/agents-run-ws-cancel.test.ts`
- `server/src/test/unit/mcp-agents-router-run.test.ts`

#### Subtasks

1. [ ] Read the story sections `Cancellation Targeting`, `Event Outcomes`, and `Edge Cases and Failure Modes`.
2. [ ] Update `server/src/agents/service.ts` so normal agent runs observe pending cancel before useful work starts, propagate `AbortSignal` through provider or runtime APIs that already support it, and reuse the shared inflight finalization and cleanup helpers when publishing the correct final stopped outcome.
3. [ ] Keep `server/src/routes/agentsRun.ts` aligned with the documented response and conflict behavior so the route remains stable while the runtime logic changes underneath it.
4. [ ] Ensure active ownership and pending-cancel cleanup happen in the same finalization path used by normal agent runs.
5. [ ] Add or update focused tests for normal agent instruction stop before `inflightId`, correct final `turn_final`, and no stale `RUN_IN_PROGRESS` after a confirmed stop.
6. [ ] Update this plan file’s `Implementation notes` for Task 4 after the implementation and tests are complete.
7. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/integration/agents-run-ws-cancel.test.ts`
6. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/unit/mcp-agents-router-run.test.ts`

#### Implementation notes

- No implementation notes yet.

---

### 5. Integrate Stop Ownership Into Agent Command Runs

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the new cancellation ownership model into agent command-list execution only. This task should make command runs stop safely before the first step, before each next step, and before any retry can continue.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `server/src/agents/commandsRunner.ts`
- `server/src/routes/agentsCommands.ts`
- `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`
- `server/src/test/unit/agent-commands-runner-retry.test.ts`

#### Subtasks

1. [ ] Read the story sections `Surface identity timing`, `Edge Cases and Failure Modes`, and the agent-command bullets in `Implementation Ideas`.
2. [ ] Update `server/src/agents/commandsRunner.ts` so pending cancel is checked before the first step, before each later step, before each retry/backoff boundary, and any existing abort-capable command execution path receives the combined `AbortSignal` through the current abort-chain helpers rather than a new stop mechanism.
3. [ ] Keep `server/src/routes/agentsCommands.ts` aligned with the documented response contract where `conversationId` may exist before any client-visible `inflightId`.
4. [ ] Ensure duplicate stop requests remain idempotent for command runs and do not restart steps or leave stale command abort state behind.
5. [ ] Add or update focused tests for startup-race cancel, duplicate stop idempotence, and retry suppression after stop.
6. [ ] Update this plan file’s `Implementation notes` for Task 5 after the implementation and tests are complete.
7. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/unit/agent-commands-runner-abort-retry.test.ts`
6. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/unit/agent-commands-runner-retry.test.ts`

#### Implementation notes

- No implementation notes yet.

---

### 6. Integrate Stop Ownership Into Flow Runs

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the new cancellation ownership model into flow execution only. This task should ensure flows check for cancellation at the documented boundaries and cannot continue through extra steps after stop has been requested.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `server/src/flows/service.ts`
- `server/src/routes/flowsRun.ts`
- `server/src/test/integration/flows.run.loop.test.ts`
- `server/src/test/integration/flows.run.command.test.ts`

#### Subtasks

1. [ ] Read the story sections `Cancellation checkpoints are explicit`, `Edge Cases and Failure Modes`, and the flow bullets in `Implementation Ideas`.
2. [ ] Update `server/src/flows/service.ts` so flow runs check cancellation before the first step, before each next step or loop iteration, before any nested tool or agent handoff that would continue the cancelled flow, and pass `AbortSignal` into any existing abort-capable downstream call sites using the current flow abort and finalization path.
3. [ ] Keep `server/src/routes/flowsRun.ts` aligned with the documented route contract and conflict behavior while the internal stop behavior changes.
4. [ ] Ensure flow finalization still emits the correct single terminal stopped outcome and ignores late flow events after finalization.
5. [ ] Add or update focused tests for flow startup-race cancel, flow-loop cancel boundaries, nested handoff cancellation, and no stale flow continuation after stop.
6. [ ] Update this plan file’s `Implementation notes` for Task 6 after the implementation and tests are complete.
7. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/integration/flows.run.loop.test.ts`
6. [ ] Run `npm run test:summary:server:unit -- --file=server/src/test/integration/flows.run.command.test.ts`

#### Implementation notes

- No implementation notes yet.

---

### 7. Add Shared Client Stop State And Reconciliation Logic

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update the shared client stop state machine so the frontend can represent `stopping`, consume the new `cancel_ack` plus the existing terminal event correctly, preserve `stopped` as a distinct terminal state, and recover from the documented no-op path or reconnect scenarios without inventing incorrect local terminal states.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `client/src/hooks/useChatWs.ts`
- `client/src/hooks/useChatStream.ts`
- `client/src/hooks/useConversationTurns.ts`
- `client/src/test/useChatWs.test.ts`
- `client/src/test/useChatStream.inflightMismatch.test.tsx`
- `client/src/test/support/mockChatWs.ts`

#### Subtasks

1. [ ] Read the story sections `UI State Contract`, `Event Outcomes`, and `Edge Cases and Failure Modes`.
2. [ ] Update `client/src/hooks/useChatWs.ts` so shared cancel sending remains consistent with the documented contract, can support conversation-only stop when `inflightId` is not known, and exposes the new `cancel_ack` event shape through the existing websocket event union and subscriber flow.
3. [ ] Update `client/src/hooks/useChatStream.ts` so the shared state machine distinguishes `stopping`, `stopped`, no-op recovery, and stale or duplicate late events by extending the existing `finalizedInflightIdsRef`, replay suppression, and `streamStatus` handling instead of adding a parallel stop-state manager.
4. [ ] Ensure reconnect or stale-subscriber reconciliation uses shared stream state rather than leaving phantom running or phantom stopping UI behind, including when stop was requested from another tab or window for the same conversation and the only immediate server response is `cancel_ack`.
5. [ ] Add or update shared-hook tests for stopping state, explicit stopped status preservation, no-op recovery via `cancel_ack`, explicit invalid-target handling, duplicate terminal events, late-event suppression, and stop reconciliation after an external-tab stop request by extending the existing `useChatWs` and `useChatStream.inflightMismatch` test harnesses.
6. [ ] Update this plan file’s `Implementation notes` for Task 7 after the implementation and tests are complete.
7. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:client -- --file=useChatWs.test.ts`
6. [ ] Run `npm run test:summary:client -- --file=useChatStream.inflightMismatch.test.tsx`

#### Implementation notes

- No implementation notes yet.

---

### 8. Align Chat, Agents, And Flows Stop UX With The Shared State Contract

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update the page-level stop controls and local UX so Chat, Agents, and Flows all use the shared stopping contract consistently. This task is only about page behavior, persisted-turn mapping, and page tests after the shared server and hook work is already in place.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `client/src/pages/ChatPage.tsx`
- `client/src/pages/AgentsPage.tsx`
- `client/src/pages/FlowsPage.tsx`
- `client/src/hooks/useConversationTurns.ts`
- `client/src/test/chatPage.stop.test.tsx`
- `client/src/test/agentsPage.commandsRun.abort.test.tsx`
- `client/src/test/flowsPage.stop.test.tsx`

#### Subtasks

1. [ ] Read the story sections `Surface identity timing`, `UI State Contract`, and `Edge Cases and Failure Modes`.
2. [ ] Update `client/src/pages/ChatPage.tsx` so Chat uses `stopping` instead of an immediate local terminal stopped state and sends conversation-only stop when `inflightId` is not yet available.
3. [ ] Update `client/src/pages/AgentsPage.tsx` so normal agent runs and command-list runs both use the documented stopping behavior, including the no-op recovery path.
4. [ ] Update `client/src/pages/FlowsPage.tsx` so flow stop controls stay aligned with the same stopping and recovery rules.
5. [ ] Update page-level stored-turn mapping and assistant status chips so persisted `Turn.status === 'stopped'` remains visibly `Stopped` after reload instead of being collapsed to `Complete`, reusing the existing `StoredTurn.status` union and each page’s current `StoredTurn -> ChatMessage` adapter rather than introducing a separate persisted status model.
6. [ ] Add or update page-level tests that prove the visible stop UX, button disablement, no-op recovery via `cancel_ack`, final stopped synchronization for each surface, persisted stopped rendering after reload, and conversation reuse without stale conflict after a confirmed stop by extending the existing stop and status-chip test files rather than creating a separate test suite.
7. [ ] Update this plan file’s `Implementation notes` for Task 8 after the implementation and tests are complete.
8. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:client -- --file=chatPage.stop.test.tsx`
6. [ ] Run `npm run test:summary:client -- --file=agentsPage.commandsRun.abort.test.tsx`
7. [ ] Run `npm run test:summary:client -- --file=flowsPage.stop.test.tsx`

#### Implementation notes

- No implementation notes yet.

---

### 9. Final Verification, Documentation, And Acceptance Check

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

The final task must verify the full story end-to-end against the acceptance criteria. It must prove the server and client builds work, the Docker build and Compose startup work, the relevant automated tests pass, the stop UX works visually, and the repository documentation is current.

#### Documentation Locations

- `planning/0000043-stop-any-point-cancellation.md`
- `README.md`
- `design.md`
- `projectStructure.md`
- Docker/Compose wrapper commands in the repository root `package.json`
- Playwright documentation and the local `e2e/` test suite

#### Subtasks

1. [ ] Re-read the full story plan and confirm each acceptance criterion has a corresponding implemented change and automated proof.
2. [ ] Ensure `README.md` is updated with any stop-behavior or command changes introduced by this story.
3. [ ] Ensure `design.md` is updated with any architecture or state-flow changes introduced by this story.
4. [ ] Ensure `projectStructure.md` is updated with any files or folders added, removed, or materially repurposed by this story.
5. [ ] Save visual proof screenshots for the final manual verification into `./test-results/screenshots/` using filenames that begin with the plan number and task number.
6. [ ] Manually verify that after a confirmed stop the same conversation can be started again immediately without a stale `RUN_IN_PROGRESS` conflict on Chat, Agents, command runs, and Flows.
7. [ ] Manually verify that the conversation-only no-active-run path clears `stopping` only after the matching `cancel_ack.result === 'noop'` and does not render a fake terminal bubble.
8. [ ] Manually verify the documented multi-tab or multi-window behavior by stopping from one browser context and confirming a later replacement run in another context is not cancelled incorrectly.
9. [ ] Write a pull request comment summarizing all changes made by this story across every completed task.
10. [ ] Update this plan file’s `Implementation notes` for Task 9 after the implementation and tests are complete.
11. [ ] Run `npm run lint` and `npm run format:check`, then fix any issues before considering the task complete.

#### Testing

1. [ ] Run `npm run build:summary:server`
2. [ ] Run `npm run build:summary:client`
3. [ ] Run `npm run compose:build:summary`
4. [ ] Run `npm run compose:up`
5. [ ] Run `npm run test:summary:server:unit`
6. [ ] Run `npm run test:summary:server:cucumber`
7. [ ] Run `npm run test:summary:client`
8. [ ] Run `npm run test:summary:e2e`
9. [ ] Use Playwright MCP tools to manually verify the stop UX for Chat, Agents, and Flows, including same-conversation reuse after stop and the multi-tab stop scenario, and save screenshots to `./test-results/screenshots/`

#### Implementation notes

- No implementation notes yet.
