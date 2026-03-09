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
      - `result: 'noop'`
    - purpose:
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
  - exactly one terminal `turn_final` is published for that run;
  - the terminal status is `stopped`.

- Explicit target does not match an active run:
  - keep the existing explicit-target invalid behavior;
  - the client receives one failed terminal outcome rather than a silent no-op.

- Conversation-only stop with active run:
  - the client enters `stopping`;
  - the server binds the request to the active run token;
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
  - expected handling: reconciled UI state comes from the active run or final event state for that conversation, while `cancel_ack` remains limited to the documented no-op path that needs it;
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
  - use the existing websocket `requestId` to correlate a new `cancel_ack` server event back to the initiating client message for the no-op outcome only;
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

- Task Status: `__completed__`
- Git Commits: `77860571 - DEV-[0000043] - Normalize websocket cancel targeting contract`

#### Overview

Update the websocket cancel handler so it follows the story’s targeting and outcome rules exactly. This task is only about the `cancel_inflight` message contract, the new non-terminal `cancel_ack` response, and the immediate server-side results; it must not yet introduce the deeper runtime ownership or frontend behavior changes.

#### Must Not Miss

- Keep the existing client request message name `cancel_inflight`; this task must not invent a new stop request message or a REST fallback.
- `cancel_ack` is only for the conversation-only no-active-run path; real cancellations still finish through one `turn_final` with `status: 'stopped'`.
- If `{ conversationId, inflightId }` points at the wrong run, keep the existing explicit invalid-target failure behavior instead of silently converting it into a conversation-only no-op.
- Do not remove the existing `abortAgentCommandRun(conversationId)` call in `server/src/ws/server.ts` during this task unless Task 6’s replacement command-run cancellation path is implemented in the same change, because command runs currently start without a REST `inflightId`.
- Reuse the existing websocket test support in `server/src/test/support/wsClient.js` and the existing `server/src/test/unit/ws-server.test.ts` coverage shape instead of creating new websocket test infrastructure for this task.

#### Documentation Locations

- `ws` server documentation: DeepWiki `websockets/ws` — use this to confirm that extending the existing JSON message protocol with one extra server event is normal `ws` usage and does not require a transport redesign.
- Node.js `AbortController` and `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller — use this to confirm how abort signals behave when the stop request reaches an active run.
- TypeScript discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions — use this to keep websocket event typing safe when adding `cancel_ack`.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when updating `design.md` for the websocket cancel contract.
- Mermaid sequence diagram syntax: https://mermaid.js.org/syntax/sequenceDiagram.html — use this to keep the websocket cancel flow diagram parse-safe and aligned with Mermaid’s current sequence diagram rules.

#### Subtasks

1. [x] Read the story sections `Contracts And Storage Shapes`, `Cancellation Targeting`, `Event Outcomes`, `UI State Contract`, and `Edge Cases and Failure Modes` before changing any code.
2. [x] Extend the existing websocket unions in `server/src/ws/types.ts`. Files (read/edit): `server/src/ws/types.ts`. Keep `cancel_inflight` accepting optional `inflightId`, keep `parseClientMessage` as the parser entrypoint, and add the new non-terminal `cancel_ack` server event keyed by the existing `requestId`. Docs to use while doing this subtask: DeepWiki `websockets/ws`, TypeScript discriminated unions docs, and Mermaid docs if the contract diagram in this task changes.
3. [x] Update the `cancel_inflight` branch in `server/src/ws/server.ts`. Files (read/edit): `server/src/ws/server.ts`, `server/src/agents/commandsRunner.ts` only if needed to preserve the existing command abort hook. Make explicit `{ conversationId, inflightId }` requests and conversation-only `{ conversationId }` requests follow the documented targeting rules without silently converting one path into the other, and emit `cancel_ack` only for the documented conversation-only no-active-run path. Docs to use while doing this subtask: DeepWiki `websockets/ws` and Node.js `AbortController` docs.
4. [x] Keep the existing explicit invalid-target behavior for stale or wrong `inflightId` requests and keep the documented conversation-only no-op behavior when no active run exists, but make the no-op path observable via `cancel_ack.result === 'noop'` rather than a terminal event. Files (read/edit): `server/src/ws/server.ts`, `server/src/ws/types.ts`. Docs to use while doing this subtask: DeepWiki `websockets/ws` and TypeScript discriminated unions docs.
5. [x] Add or update a server unit test in `server/src/test/unit/ws-server.test.ts` that sends `{ conversationId, inflightId }` for the wrong active run and proves the server emits the existing explicit invalid-target failure outcome. Purpose: cover the explicit-target error path.
6. [x] Add or update a server unit test in `server/src/test/unit/ws-server.test.ts` that sends conversation-only `cancel_inflight` when no active run exists and proves the server emits one `cancel_ack` with `result: 'noop'` and no `turn_final`. Purpose: cover the documented no-op path.
7. [x] Add or update a server unit test in `server/src/test/unit/ws-server.test.ts` that proves `cancel_ack.requestId` matches the initiating conversation-only no-op request. Purpose: cover request correlation for the no-op ack path.
8. [x] Add or update a server unit test in `server/src/test/unit/ws-server.test.ts` that sends a malformed `cancel_inflight` payload and proves validation rejects it without stop side effects. Purpose: cover malformed websocket input.
9. [x] Add or update a server unit test in `server/src/test/unit/ws-chat-stream.test.ts` that sends duplicate websocket stop requests for the same run and proves the terminal outcome is emitted once. Purpose: cover websocket-level stop idempotence.
10. [x] Add or update a server unit test in `server/src/test/unit/ws-server.test.ts` that sends conversation-only `cancel_inflight` while an agent command run is active and proves the command-run abort path still fires without emitting an invalid-target terminal failure. Purpose: cover command-run compatibility for conversation-only stop before Task 6 replaces the runtime path.
11. [x] Update `design.md`. Files (read/edit): `design.md`. Add a short websocket stop-contract section and a Mermaid `sequenceDiagram` that shows `cancel_inflight` with and without `inflightId`, the explicit invalid-target path, the conversation-only no-active-run `cancel_ack.result === 'noop'` path, and the successful active-run path ending in `turn_final.status === 'stopped'`.
12. [x] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
13. [x] Update this plan file’s `Implementation notes` for Task 1 after the implementation and tests are complete.
14. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server websocket contract code. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server node:test websocket behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because websocket cancel behavior is already covered by server Cucumber chat cancellation coverage. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read the Task 1 contract sections before editing so the implementation preserves explicit invalid-target failures, limits `cancel_ack` to the conversation-only no-active-run path, and does not pull later ownership-state work into this task.
- Subtasks 2-4: Added `WsCancelAckEvent`, kept `parseClientMessage` as the parser entrypoint, and split the WS cancel handler into explicit-target failure handling, conversation-only active cancellation, and request-correlated no-op acknowledgements without changing the client message name.
- Subtasks 5-10: Added unit coverage for wrong-target failures, no-op `cancel_ack`, request correlation, malformed payload rejection without stop side effects, duplicate stop idempotence, and the legacy command-run conversation-only abort path.
- Subtasks 11-12: Documented the Task 1 websocket stop contract and sequence flow in `design.md`; no files were added or removed, so `projectStructure.md` did not need changes.
- Testing step 1: `npm run build:summary:server` passed cleanly with `agent_action: skip_log`, so no build-log inspection was required.
- Testing step 2: `npm run test:summary:server:unit` passed on rerun after updating one unrelated brittle MCP validation assertion that was blocking the full suite; the final wrapper result was `failed: 0` with `agent_action: skip_log`.
- Testing step 3: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 68`, `failed: 0`, and `agent_action: skip_log`.
- Subtasks 13-14: Updated the Task 1 notes after all implementation and wrapper checks completed; `format:check` initially failed on `server/src/chat/inflightRegistry.ts`, so I ran Prettier on the touched files and reran lint and format checks successfully. Lint still reports pre-existing import-order warnings elsewhere in the repo, but it exits cleanly.

---

### 2. Add Active Run Ownership Runtime State

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Introduce the runtime-only active-run ownership state the story depends on by extending the existing conversation lock. This task is only about the in-memory ownership model and its invariants; it must not yet wire pending cancel, chat, agents, flows, or page UX to use that state.

#### Must Not Miss

- Extend `server/src/agents/runLock.ts`; do not create a second ownership manager elsewhere in the server.
- The ownership token must identify the one active run that currently owns a conversation lock, because later stop logic will bind to that token during the startup race.
- This task does not add pending-cancel behavior yet; keep the scope limited to ownership state and its tests.

#### Documentation Locations

- Node.js `crypto.randomUUID()`: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions — use this to create stable per-run ownership tokens without inventing a custom ID format.
- TypeScript object and type alias guidance: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html — use this to model the ownership metadata shape cleanly inside the existing lock module.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting the active-run ownership lifecycle in `design.md`.
- Mermaid flowchart syntax: https://mermaid.js.org/syntax/flowchart.html — use this to keep the ownership lifecycle diagram parse-safe and aligned with Mermaid’s current flowchart rules.

#### Subtasks

1. [ ] Read the story sections `Run lifecycle boundaries`, `Contracts And Storage Shapes`, `Cancellation Targeting`, and `Edge Cases and Failure Modes`.
2. [ ] Extend the existing `tryAcquireConversationLock` and `releaseConversationLock` flow in `server/src/agents/runLock.ts` with lightweight ownership metadata instead of introducing a separate lock manager. Files (read/edit): `server/src/agents/runLock.ts`. Docs to use while doing this subtask: Node.js `crypto.randomUUID()` docs and TypeScript everyday-types docs.
3. [ ] Ensure the ownership metadata is exposed through the smallest helper surface needed by chat, agent, and flow start paths and does not require duplicated ownership tracking in feature-specific files. Files (read/edit): `server/src/agents/runLock.ts`; files to read for call sites: `server/src/routes/chat.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`. Docs to use while doing this subtask: TypeScript everyday-types docs.
4. [ ] Add or update a server unit test in `server/src/test/unit/ws-chat-stream.test.ts` that proves an ownership token is created when a conversation lock is acquired and cleared when the lock is released. Purpose: cover the active-run ownership happy path.
5. [ ] Add or update a server unit test in `server/src/test/unit/ws-chat-stream.test.ts` that proves a later replacement run gets a fresh ownership token and never inherits stale ownership. Purpose: cover replacement-run protection at the ownership layer.
6. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a short section describing active-run ownership in the conversation lock and a Mermaid `flowchart` that shows lock acquisition, `runToken` creation, active ownership during execution, and guaranteed ownership release during cleanup.
7. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
8. [ ] Update this plan file’s `Implementation notes` for Task 2 after the implementation and tests are complete.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:server` - Use because this task changes server runtime lock behavior. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes server node:test runtime ownership behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because server stop behavior must still pass the existing Cucumber suite after runtime lock changes. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- No implementation notes yet.

---

### 3. Add Pending-Cancel Runtime State

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Introduce the runtime-only pending-cancel state the story depends on by extending the existing inflight registry. This task is only about the in-memory pending-cancel model and its invariants; it must not yet wire chat, agents, flows, or page UX to consume that state.

#### Must Not Miss

- Extend `server/src/chat/inflightRegistry.ts`; do not create a parallel pending-cancel registry module.
- The pending-cancel entry must bind to the active run token and must never survive long enough to cancel a later replacement run.
- If a conversation-only stop arrives when no active run exists, keep the path as a no-op and do not retain pending-cancel state.

#### Documentation Locations

- JavaScript `Map` reference: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map — use this because the pending-cancel state is in-memory runtime state and should stay lightweight.
- TypeScript object and type alias guidance: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html — use this to model pending-cancel entries beside the existing inflight types without creating a second registry abstraction.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting pending-cancel state in `design.md`.
- Mermaid flowchart syntax: https://mermaid.js.org/syntax/flowchart.html — use this to keep the pending-cancel lifecycle diagram parse-safe and aligned with Mermaid’s current flowchart rules.

#### Subtasks

1. [ ] Read the story sections `Run lifecycle boundaries`, `Contracts And Storage Shapes`, `Cancellation Targeting`, and `Edge Cases and Failure Modes`.
2. [ ] Extend `server/src/chat/inflightRegistry.ts` with the pending-cancel runtime shape and helper functions so they live beside `createInflight`, `getInflight`, `markInflightFinal`, and `cleanupInflight` rather than in a new registry module. Files (read/edit): `server/src/chat/inflightRegistry.ts`. Docs to use while doing this subtask: MDN `Map` docs and TypeScript everyday-types docs.
3. [ ] Ensure the pending-cancel helpers are idempotent, consumed once, and cannot bind a stale cancel to a later replacement run. Files (read/edit): `server/src/chat/inflightRegistry.ts`; files to read for consumers: `server/src/routes/chat.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`. Docs to use while doing this subtask: MDN `Map` docs.
4. [ ] Add or update a server unit test in `server/src/test/unit/ws-chat-stream.test.ts` that proves one pending cancel is consumed once and cannot be applied twice. Purpose: cover idempotent pending-cancel consumption.
5. [ ] Add or update a server unit test in `server/src/test/unit/ws-chat-stream.test.ts` that proves the documented no-active-run path leaves no pending-cancel state behind. Purpose: cover pending-cancel no-op behavior.
6. [ ] Add or update a server unit test in `server/src/test/unit/agent-commands-runner-abort-retry.test.ts` that forces the primary cleanup path to throw and proves runtime state is still released. Purpose: cover cleanup fallback in shared runtime state.
7. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a short section describing how pending-cancel binds to the active `runToken`, is consumed once, and is cleared on no-op or cleanup, plus a Mermaid `flowchart` that shows those state transitions.
8. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
9. [ ] Update this plan file’s `Implementation notes` for Task 3 after the implementation and tests are complete.
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:server` - Use because this task changes shared server inflight runtime state. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes server node:test inflight and pending-cancel behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because shared stop behavior must still satisfy the existing server Cucumber coverage after pending-cancel changes. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- No implementation notes yet.

---

### 4. Integrate Stop Ownership Into Chat Runs

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the extended cancellation ownership model into chat runs only. This task should make chat honor conversation-only startup-race stop, emit the correct terminal outcome, and release runtime state safely without touching agent or flow execution yet.

#### Must Not Miss

- This task is chat-only; do not change agent instruction, command-list, or flow execution here.
- Chat must not claim stop success locally; the authoritative successful stop result is still one terminal `turn_final.status === 'stopped'`.
- Reuse `markInflightFinal`, `isInflightFinalized`, `publishFinalOnce`, `cleanupInflight`, and `releaseConversationLock` instead of inventing chat-only finalization flags.

#### Documentation Locations

- Node.js `AbortController` and `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller — use this to confirm the abort semantics chat runs can rely on.
- OpenAI JavaScript/Node library docs: https://platform.openai.com/docs/libraries/javascript — use this to verify server-side SDK expectations when a provider call is given an abortable request path.
- `ws` event transport reference: DeepWiki `websockets/ws` — use this to confirm the final `turn_final` event remains a normal custom JSON event over the existing socket.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting the chat stop lifecycle in `design.md`.
- Mermaid sequence diagram syntax: https://mermaid.js.org/syntax/sequenceDiagram.html — use this to keep the chat stop flow diagram parse-safe and aligned with Mermaid’s current sequence diagram rules.

#### Subtasks

1. [ ] Read the story sections `Event Outcomes`, `UI State Contract`, `Edge Cases and Failure Modes`, and the chat-specific notes in `Implementation Ideas`.
2. [ ] Update `server/src/routes/chat.ts` so chat runs check for pending cancel before meaningful work starts, immediately after inflight creation, and in the finalization path. Files (read/edit): `server/src/routes/chat.ts`; files to read: `server/src/chat/inflightRegistry.ts`, `server/src/agents/runLock.ts`. Docs to use while doing this subtask: Node.js `AbortController` docs.
3. [ ] Update `server/src/chat/chatStreamBridge.ts` or `server/src/chat/interfaces/ChatInterface.ts` only where necessary to keep cancelled chat runs emitting one terminal `turn_final.status === 'stopped'`, propagating `AbortSignal` through provider APIs that already support it, and reusing `markInflightFinal`, `isInflightFinalized`, and `publishFinalOnce` for late-event protection. Files (read/edit): `server/src/chat/chatStreamBridge.ts`, `server/src/chat/interfaces/ChatInterface.ts`; files to read: `server/src/ws/server.ts`, `server/src/chat/inflightRegistry.ts`. Docs to use while doing this subtask: OpenAI JavaScript/Node library docs, Node.js `AbortController` docs, DeepWiki `websockets/ws`.
4. [ ] Ensure chat cleanup reuses `cleanupInflight` and `releaseConversationLock` so inflight state, active ownership, and pending-cancel state are released in one safe path even when stop happens near finalization or the primary cleanup path throws. Files (read/edit): `server/src/routes/chat.ts`, `server/src/chat/interfaces/ChatInterface.ts`. Docs to use while doing this subtask: Node.js `AbortController` docs.
5. [ ] Add or update a server unit test in `server/src/test/unit/ws-chat-stream.test.ts` that stops a chat run during the startup race before the client-visible `inflightId` is usable and proves the run still finishes as `stopped`. Purpose: cover the early-stop happy path for chat.
6. [ ] Add or update a server integration test in `server/src/test/integration/chat-tools-wire.test.ts` that sends duplicate stop requests for the same chat run and proves the final event is emitted once. Purpose: cover chat stop idempotence.
7. [ ] Add or update a server integration test in `server/src/test/integration/chat-tools-wire.test.ts` that forces cleanup failure during chat stop finalization and proves inflight state, ownership, and pending-cancel state are still released. Purpose: cover chat cleanup fallback.
8. [ ] Add or update a server unit test in `server/src/test/unit/ws-chat-stream.test.ts` that delivers late provider events after chat has already terminalized and proves the run does not reopen. Purpose: cover chat late-event suppression.
9. [ ] Add or update a server integration test in `server/src/test/integration/chat-tools-wire.test.ts` that starts a new chat run on the same conversation after confirmed stop and proves there is no stale `RUN_IN_PROGRESS` conflict. Purpose: cover chat conversation reuse.
10. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a chat stop-lifecycle section and a Mermaid `sequenceDiagram` that shows chat run start, startup-race stop, pending-cancel consumption, provider abort propagation, single `turn_final.status === 'stopped'`, and cleanup plus same-conversation reuse.
11. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
12. [ ] Update this plan file’s `Implementation notes` for Task 4 after the implementation and tests are complete.
13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:server` - Use because this task changes server chat execution code. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes server node:test chat stop behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because chat cancellation is already covered by server Cucumber scenarios and must still pass after this task. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- No implementation notes yet.

---

### 5. Integrate Stop Ownership Into Agent Instruction Runs

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the new cancellation ownership model into normal agent instruction runs only. This task should make normal agent runs honor early stop, publish the correct terminal state, and clean up without touching command-list execution yet.

#### Must Not Miss

- This task is for normal agent instruction runs only; do not mix in command-list execution changes here.
- Preserve the current route response and conflict behavior in `server/src/routes/agentsRun.ts`; the runtime logic changes underneath that contract.
- Reuse the shared inflight finalization and cleanup helpers so stop behavior matches chat rather than becoming a new agent-only path.

#### Documentation Locations

- Node.js `AbortController` and `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller — use this to confirm the cancellation behavior agent instruction runs can rely on.
- OpenAI JavaScript/Node library docs: https://platform.openai.com/docs/libraries/javascript — use this to verify the server-side SDK assumptions for normal agent instruction execution.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting the normal agent stop lifecycle in `design.md`.
- Mermaid sequence diagram syntax: https://mermaid.js.org/syntax/sequenceDiagram.html — use this to keep the normal agent stop flow diagram parse-safe and aligned with Mermaid’s current sequence diagram rules.

#### Subtasks

1. [ ] Read the story sections `Cancellation Targeting`, `Event Outcomes`, and `Edge Cases and Failure Modes`.
2. [ ] Update `server/src/agents/service.ts` so normal agent runs observe pending cancel before useful work starts, propagate `AbortSignal` through provider or runtime APIs that already support it, and reuse the shared inflight finalization and cleanup helpers when publishing the correct final stopped outcome. Files (read/edit): `server/src/agents/service.ts`; files to read: `server/src/chat/inflightRegistry.ts`, `server/src/agents/runLock.ts`. Docs to use while doing this subtask: Node.js `AbortController` docs and OpenAI JavaScript/Node library docs.
3. [ ] Keep `server/src/routes/agentsRun.ts` aligned with the documented response and conflict behavior so the route remains stable while the runtime logic changes underneath it. Files (read/edit): `server/src/routes/agentsRun.ts`; files to read: `server/src/agents/service.ts`. Docs to use while doing this subtask: OpenAI JavaScript/Node library docs where relevant to preserved runtime assumptions.
4. [ ] Ensure active ownership and pending-cancel cleanup happen in the same finalization path used by normal agent runs. Files (read/edit): `server/src/agents/service.ts`, `server/src/chat/inflightRegistry.ts`, `server/src/agents/runLock.ts`.
5. [ ] Add or update an integration test in `server/src/test/integration/agents-run-ws-cancel.test.ts` that stops a normal agent instruction run before the client has a usable `inflightId` and proves the final outcome is `stopped`. Purpose: cover the early-stop happy path for normal agent runs.
6. [ ] Add or update an integration test in `server/src/test/integration/agents-run-ws-cancel.test.ts` that sends duplicate stop requests for the same normal agent run and proves the final event is emitted once. Purpose: cover normal-agent stop idempotence.
7. [ ] Add or update a unit or integration test in `server/src/test/unit/mcp-agents-router-run.test.ts` or `server/src/test/integration/agents-run-ws-cancel.test.ts` that forces cleanup failure during stop finalization and proves runtime state is still released. Purpose: cover cleanup fallback for normal agent runs.
8. [ ] Add or update an integration test in `server/src/test/integration/agents-run-ws-cancel.test.ts` that starts a new normal agent run on the same conversation after confirmed stop and proves there is no stale `RUN_IN_PROGRESS` conflict. Purpose: cover conversation reuse for normal agent runs.
9. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a normal agent stop-lifecycle section and a Mermaid `sequenceDiagram` that shows route start, runtime ownership, startup-race stop, abort propagation into agent execution, terminal stopped publication, and cleanup before same-conversation reuse.
10. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
11. [ ] Update this plan file’s `Implementation notes` for Task 5 after the implementation and tests are complete.
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:server` - Use because this task changes server agent execution code. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes server node:test agent stop behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because server Cucumber coverage must still pass after agent stop behavior changes. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- No implementation notes yet.

---

### 6. Integrate Stop Ownership Into Agent Command Runs

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the new cancellation ownership model into agent command-list execution only. This task should make command runs stop safely before the first step, before each next step, and before any retry can continue.

#### Must Not Miss

- This task is for command-list execution only; do not alter normal agent instruction flow here.
- The critical requirement is to stop before the first step, before later steps, and before retry or backoff resumes work.
- Preserve the existing route contract where the client may only have `conversationId` and not `inflightId` when stop is pressed.
- `client/src/api/agents.ts` command starts currently return no `inflightId`, so this task must preserve a working conversation-only stop path for command runs while the runtime ownership model is introduced underneath it.

#### Documentation Locations

- Node.js `AbortSignal.any()` and `throwIfAborted()`: https://nodejs.org/api/globals.html#class-abortcontroller — use this to confirm the combined-signal and checkpoint pattern for command retries and backoff.
- Node.js timers/promises abort behavior: https://nodejs.org/api/timers.html — use this to verify how retry/backoff delays should stop once cancellation is requested.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting the command-run cancellation checkpoints in `design.md`.
- Mermaid flowchart syntax: https://mermaid.js.org/syntax/flowchart.html — use this to keep the command-run cancellation diagram parse-safe and aligned with Mermaid’s current flowchart rules.

#### Subtasks

1. [ ] Read the story sections `Surface identity timing`, `Edge Cases and Failure Modes`, and the agent-command bullets in `Implementation Ideas`.
2. [ ] Update `server/src/agents/commandsRunner.ts` so pending cancel is checked before the first step, before each later step, before each retry/backoff boundary, and any existing abort-capable command execution path receives the combined `AbortSignal` through the current abort-chain helpers rather than a new stop mechanism. Files (read/edit): `server/src/agents/commandsRunner.ts`; files to read: `server/src/agents/service.ts`, `server/src/chat/inflightRegistry.ts`, `server/src/agents/runLock.ts`. Docs to use while doing this subtask: Node.js `AbortSignal.any()` and `throwIfAborted()` docs, Node.js timers/promises docs.
3. [ ] Keep `server/src/routes/agentsCommands.ts` aligned with the documented response contract where `conversationId` may exist before any client-visible `inflightId`. Files (read/edit): `server/src/routes/agentsCommands.ts`; files to read: `client/src/api/agents.ts`, `client/src/pages/AgentsPage.tsx`.
4. [ ] Ensure duplicate stop requests remain idempotent for command runs and do not restart steps or leave stale command abort state behind. Files (read/edit): `server/src/agents/commandsRunner.ts`.
5. [ ] Add or update a server unit test in `server/src/test/unit/agent-commands-runner-abort-retry.test.ts` that cancels an agent command run before the first step begins and proves the run does not continue into step execution. Purpose: cover the startup-race happy path for command runs.
6. [ ] Add or update a server unit test in `server/src/test/unit/agent-commands-runner-abort-retry.test.ts` that sends duplicate stop requests for the same command run and proves the stop path remains idempotent. Purpose: cover duplicate-stop handling for command runs.
7. [ ] Add or update a server unit test in `server/src/test/unit/agent-commands-runner-abort-retry.test.ts` that forces cleanup failure during command-run stop finalization and proves runtime state is still released. Purpose: cover cleanup fallback for command runs.
8. [ ] Add or update a server unit test in `server/src/test/unit/agent-commands-runner-retry.test.ts` that requests stop while retry or backoff is pending and proves no later retry starts. Purpose: cover retry suppression after stop.
9. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a command-run stop section and a Mermaid `flowchart` that shows stop checks before the first step, before later steps, during retry or backoff wait, and during cleanup so the cancellation boundaries are documented exactly.
10. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
11. [ ] Update this plan file’s `Implementation notes` for Task 6 after the implementation and tests are complete.
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:server` - Use because this task changes server command-run logic. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes server node:test command-run stop behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because server Cucumber coverage must still pass after command-run stop changes. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- No implementation notes yet.

---

### 7. Integrate Stop Ownership Into Flow Runs

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the new cancellation ownership model into flow execution only. This task should ensure flows check for cancellation at the documented boundaries and cannot continue through extra steps after stop has been requested.

#### Must Not Miss

- This task is flow-only; do not blend in chat or agents page UX work here.
- The required checkpoints are before the first step, before each later step or loop iteration, and before nested handoffs that would continue cancelled work.
- Preserve the existing route contract in `server/src/routes/flowsRun.ts`; change internal flow stop behavior, not the route shape.
- Flows already reuse `createInflight`, `cleanupInflight`, and the conversation lock inside `server/src/flows/service.ts`; extend that local flow finalization path instead of importing chat-route-only stop helpers.

#### Documentation Locations

- Node.js `AbortController` and `AbortSignal`: https://nodejs.org/api/globals.html#class-abortcontroller — use this to confirm the cooperative abort behavior flow execution can rely on.
- OpenAI JavaScript/Node library docs: https://platform.openai.com/docs/libraries/javascript — use this to verify the server-side SDK assumptions for flow steps that call model-backed work.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting the flow stop lifecycle in `design.md`.
- Mermaid flowchart syntax: https://mermaid.js.org/syntax/flowchart.html — use this to keep the flow cancellation diagram parse-safe and aligned with Mermaid’s current flowchart rules.

#### Subtasks

1. [ ] Read the story sections `Cancellation checkpoints are explicit`, `Edge Cases and Failure Modes`, and the flow bullets in `Implementation Ideas`.
2. [ ] Update `server/src/flows/service.ts` so flow runs check cancellation before the first step, before each next step or loop iteration, before any nested tool or agent handoff that would continue the cancelled flow, and pass `AbortSignal` into any existing abort-capable downstream call sites using the current flow abort and finalization path. Files (read/edit): `server/src/flows/service.ts`; files to read: `server/src/chat/inflightRegistry.ts`, `server/src/agents/runLock.ts`. Docs to use while doing this subtask: Node.js `AbortController` docs and OpenAI JavaScript/Node library docs.
3. [ ] Keep `server/src/routes/flowsRun.ts` aligned with the documented route contract and conflict behavior while the internal stop behavior changes. Files (read/edit): `server/src/routes/flowsRun.ts`; files to read: `server/src/flows/service.ts`.
4. [ ] Ensure flow finalization still emits the correct single terminal stopped outcome and ignores late flow events after finalization. Files (read/edit): `server/src/flows/service.ts`; files to read: `server/src/ws/server.ts`, `server/src/chat/inflightRegistry.ts`.
5. [ ] Add or update an integration test in `server/src/test/integration/flows.run.loop.test.ts` that cancels a flow during the startup race and proves the run still terminalizes as stopped. Purpose: cover the early-stop happy path for flows.
6. [ ] Add or update an integration test in `server/src/test/integration/flows.run.loop.test.ts` that sends duplicate stop requests for the same flow run and proves the final event is emitted once. Purpose: cover flow stop idempotence.
7. [ ] Add or update an integration test in `server/src/test/integration/flows.run.loop.test.ts` that forces cleanup failure during flow stop finalization and proves runtime state is still released. Purpose: cover flow cleanup fallback.
8. [ ] Add or update an integration test in `server/src/test/integration/flows.run.loop.test.ts` that requests stop during a looped or multi-step flow and proves later iterations do not continue. Purpose: cover flow loop boundary cancellation.
9. [ ] Add or update an integration test in `server/src/test/integration/flows.run.command.test.ts` that requests stop before a nested tool or agent handoff and proves the handoff does not start. Purpose: cover nested handoff cancellation.
10. [ ] Add or update an integration test in `server/src/test/integration/flows.run.command.test.ts` that proves no stale flow continuation resumes after confirmed stop. Purpose: cover post-stop continuation suppression.
11. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a flow stop section and a Mermaid `flowchart` that shows flow start, active ownership, stop checks before the first step, before each later step or loop iteration, before nested handoffs, and final stopped cleanup so the flow cancellation boundaries are explicit.
12. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
13. [ ] Update this plan file’s `Implementation notes` for Task 7 after the implementation and tests are complete.
14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:server` - Use because this task changes server flow execution code. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run test:summary:server:unit` - Use because this task changes server node:test flow stop behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use because server Cucumber coverage must still pass after flow stop changes. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- No implementation notes yet.

---

### 8. Add Shared Client WebSocket Stop Acknowledgement Handling

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Extend the shared websocket client layer so it can send conversation-only stop requests and receive the new `cancel_ack` event. This task is only about websocket event typing, parsing, subscription flow, and websocket-focused tests; it must not yet change the shared stop state machine or page-level UX.

#### Must Not Miss

- Keep using the shared `useChatWs` hook; do not add a second websocket hook or a page-local websocket protocol.
- `cancel_ack` only exists for the no-op recovery path, so this task must not invent a broader acknowledgement protocol.
- The sender still uses `cancelInflight(conversationId, inflightId?)`; support the missing-`inflightId` case instead of adding a new client API.
- Add stable browser `console.info` lines with the exact prefixes documented in this task so the Manual Playwright-MCP check can prove the websocket stop events fired as expected.

#### Documentation Locations

- React docs on custom hooks: Context7 `/reactjs/react.dev` — use this to confirm the shared websocket hook continues to be the correct abstraction point.
- Jest docs: Context7 `/jestjs/jest` — use this because the planned client hook tests in this task run through the existing Jest-based client test harness.
- TypeScript discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions — use this when extending the websocket event union with `cancel_ack`.
- Browser WebSocket event model: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket — use this to verify the browser-side send/receive event behavior that `useChatWs` wraps.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting the client websocket stop contract in `design.md`.
- Mermaid sequence diagram syntax: https://mermaid.js.org/syntax/sequenceDiagram.html — use this to keep the shared websocket client flow diagram parse-safe and aligned with Mermaid’s current sequence diagram rules.

#### Subtasks

1. [ ] Read the story sections `Contracts And Storage Shapes`, `Event Outcomes`, and `UI State Contract`.
2. [ ] Update `client/src/hooks/useChatWs.ts` so shared cancel sending remains consistent with the documented contract, can support conversation-only stop when `inflightId` is not known, and exposes the new `cancel_ack` event shape through the existing websocket event union and subscriber flow. Files (read/edit): `client/src/hooks/useChatWs.ts`; files to read: `server/src/ws/types.ts`, `server/src/ws/server.ts`. Docs to use while doing this subtask: React custom hooks docs, TypeScript discriminated unions docs, Browser WebSocket docs, and Jest docs because this hook is covered in Jest.
3. [ ] In `client/src/hooks/useChatWs.ts`, add browser-visible `console.info` lines for the shared websocket stop path using these exact prefixes and payload expectations so the browser check can assert them reliably: `[stop-debug][ws-send] cancel_inflight` with `{ conversationId, inflightId, requestId }` when the client sends stop, and `[stop-debug][ws-event] cancel_ack` with `{ conversationId, requestId, result }` when the no-op acknowledgement is received. Do not use `console.error` for these expected-path diagnostics. Files (read/edit): `client/src/hooks/useChatWs.ts`; files to read: `client/src/hooks/useChatStream.ts`, `client/src/test/support/mockChatWs.ts`. Docs to use while doing this subtask: Browser WebSocket docs and React custom hooks docs.
4. [ ] Update the websocket test support in `client/src/test/support/mockChatWs.ts` so tests can emit and assert `cancel_ack` alongside existing transcript events. Files (read/edit): `client/src/test/support/mockChatWs.ts`; files to read: `client/src/test/useChatWs.test.ts`, `client/src/hooks/useChatWs.ts`. Docs to use while doing this subtask: Jest docs and Browser WebSocket docs.
5. [ ] Add or update a client hook test in `client/src/test/useChatWs.test.ts` that sends conversation-only stop with no `inflightId` and proves the websocket payload is still emitted correctly. Purpose: cover the browser happy path for startup-race stop.
6. [ ] Add or update a client hook test in `client/src/test/useChatWs.test.ts` that receives `cancel_ack` and proves the event is parsed through the existing websocket event union. Purpose: cover the new client-side event contract.
7. [ ] Add or update a client hook test in `client/src/test/useChatWs.test.ts` that proves `cancel_ack.requestId` can be correlated to the originating no-op stop request. Purpose: cover no-op recovery correlation.
8. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a shared websocket client section and a Mermaid `sequenceDiagram` that shows page code calling `cancelInflight(conversationId, inflightId?)`, `useChatWs` sending the request, and the client receiving either `cancel_ack.result === 'noop'` or later `turn_final.status === 'stopped'`.
9. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
10. [ ] Update this plan file’s `Implementation notes` for Task 8 after the implementation and tests are complete.
11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes client websocket hook code. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-client-latest.log`.
2. [ ] `npm run test:summary:client` - Use because this task changes Jest-covered client websocket behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end through the dockerized app. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log`.
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm shared websocket stop behavior works in the browser. In the browser console, assert that clicking Stop during the startup-race path logs `[stop-debug][ws-send] cancel_inflight` exactly once with the expected `conversationId`, an omitted or `undefined` `inflightId`, and a non-empty `requestId`. For the no-active-run path, assert the console later logs `[stop-debug][ws-event] cancel_ack` with the same `conversationId`, the same `requestId`, and `result: 'noop'`. Take a screenshot that shows the visible browser state for the exercised stop path and store it in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`; the agent must review that screenshot to confirm the GUI still matches the expected stopping or recovered-ready state with no stray terminal bubble. Expected outcome: both log lines appear with matching request correlation, the screenshot shows the expected UI state, and there are no unexpected browser-console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- No implementation notes yet.

---

### 9. Add Shared Client Stop State And Reconciliation Logic

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update the shared client stop state machine so the frontend can represent `stopping`, consume the new `cancel_ack` plus the existing terminal event correctly, preserve `stopped` as a distinct terminal state, and recover from the documented no-op path or reconnect scenarios without inventing incorrect local terminal states.

#### Must Not Miss

- Extend `client/src/hooks/useChatStream.ts`; do not add a second stop-state manager outside the shared stream hook.
- `stopped` must remain distinct from `complete` in shared message state, because the server and persistence layers already distinguish `'stopped'`.
- Keep `cancel_ack` handling limited to no-op recovery; successful real stops still complete through `turn_final.status === 'stopped'`.
- Add stable browser `console.info` lines with the exact prefixes documented in this task so the Manual Playwright-MCP check can prove the shared stop-state transitions occurred in the right order.

#### Documentation Locations

- React docs on `useState`, `useRef`, and state updates: Context7 `/reactjs/react.dev` — use this to confirm the shared stop-state and ref-backed inflight tracking model in `useChatStream`.
- Jest docs: Context7 `/jestjs/jest` — use this because the shared hook coverage in this task is implemented in the existing Jest client test suite.
- TypeScript discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions — use this when preserving `stopped` as a distinct terminal status in shared client types.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting shared stop-state transitions in `design.md`.
- Mermaid flowchart syntax: https://mermaid.js.org/syntax/flowchart.html — use this to keep the shared stop-state diagram parse-safe and aligned with Mermaid’s current flowchart rules.

#### Subtasks

1. [ ] Read the story sections `UI State Contract`, `Event Outcomes`, and `Edge Cases and Failure Modes`.
2. [ ] Update `client/src/hooks/useChatStream.ts` so the shared state machine distinguishes `stopping`, `stopped`, no-op recovery, and stale or duplicate late events by extending the existing `finalizedInflightIdsRef`, replay suppression, and `streamStatus` handling instead of adding a parallel stop-state manager. Files (read/edit): `client/src/hooks/useChatStream.ts`; files to read: `client/src/hooks/useChatWs.ts`, `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/pages/FlowsPage.tsx`. Docs to use while doing this subtask: React `useState`/`useRef` docs, TypeScript discriminated unions docs, and Jest docs.
3. [ ] Update the shared `stop()` behavior in `client/src/hooks/useChatStream.ts` so it no longer appends the immediate local `Generation stopped` status bubble or resets the stream to an authoritative stopped state before the server has answered; the shared hook must leave final stop confirmation to `turn_final.status === 'stopped'` and only use `cancel_ack.result === 'noop'` for the documented no-op recovery path. Files (read/edit): `client/src/hooks/useChatStream.ts`; files to read: `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/pages/FlowsPage.tsx`. Docs to use while doing this subtask: React `useState`/`useRef` docs and Jest docs.
4. [ ] Ensure reconnect or stale-subscriber reconciliation uses shared stream state rather than leaving phantom running or phantom stopping UI behind, while keeping `cancel_ack` handling limited to the documented no-op recovery path. Files (read/edit): `client/src/hooks/useChatStream.ts`; files to read: `client/src/hooks/useChatWs.ts`. Docs to use while doing this subtask: React `useRef` docs and Jest docs.
5. [ ] In `client/src/hooks/useChatStream.ts`, add browser-visible `console.info` lines for the shared stop-state machine using these exact prefixes and payload expectations so the browser check can assert them reliably: `[stop-debug][stream-state] stopping` with `{ conversationId, inflightId }` when shared state enters `stopping`, `[stop-debug][stream-state] stopped` with `{ conversationId, inflightId, turnId }` when the matching terminal stopped event is applied, and `[stop-debug][stream-state] noop-recovered` with `{ conversationId, requestId }` when `cancel_ack.result === 'noop'` clears `stopping`. Do not emit these lines for stale acks or duplicate final events. Files (read/edit): `client/src/hooks/useChatStream.ts`; files to read: `client/src/hooks/useChatWs.ts`, `client/src/pages/ChatPage.tsx`. Docs to use while doing this subtask: React `useRef` docs and Jest docs.
6. [ ] Add or update a client hook test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that proves shared stream state enters `stopping` and preserves a distinct `stopped` terminal status when the matching final event arrives. Purpose: cover the shared stream happy path.
7. [ ] Add or update a client hook test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that proves `cancel_ack.result === 'noop'` clears `stopping` without inventing a terminal bubble. Purpose: cover shared no-op recovery.
8. [ ] Add or update a client hook test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that proves explicit invalid-target failure and duplicate terminal events do not regress stream state. Purpose: cover shared error handling and idempotence.
9. [ ] Add or update a client hook test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that proves a stale `cancel_ack` with a non-matching `requestId` does not clear the current `stopping` state. Purpose: cover no-op ack correlation and stale-event protection.
10. [ ] Add or update a client hook test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that proves calling the shared stop path no longer appends the immediate local `Generation stopped` status bubble before a terminal server event arrives. Purpose: cover removal of the fake local stopped path.
11. [ ] Add or update a client hook test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that proves unmounts, remounts, or reconnects while `stopping` is pending reconcile correctly when late events arrive. Purpose: cover shared navigation and reconnect corner cases.
12. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a shared stop-state section and a Mermaid `flowchart` that shows `running -> stopping -> stopped`, the conversation-only no-op recovery path back to ready after `cancel_ack.result === 'noop'`, and the stale-event or invalid-target paths that must not invent a terminal state.
13. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
14. [ ] Update this plan file’s `Implementation notes` for Task 9 after the implementation and tests are complete.
15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes shared client stream-state logic. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-client-latest.log`.
2. [ ] `npm run test:summary:client` - Use because this task changes Jest-covered shared client stop-state behavior. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end through the dockerized app. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log`.
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm shared `stopping` and `stopped` behavior. In the browser console, assert `[stop-debug][stream-state] stopping` appears when Stop is clicked, then either `[stop-debug][stream-state] stopped` appears with the same `conversationId` and active `inflightId` after a real stop, or `[stop-debug][stream-state] noop-recovered` appears with the matching `conversationId` and `requestId` after a no-op path. Take a screenshot that shows the resulting GUI state and store it in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`; the agent must review that screenshot to confirm the screen visibly shows `Stopping`, a final `Stopped` state, or ready-state recovery exactly as required by the exercised path. Expected outcome: exactly one matching transition line is emitted for the path taken, no stale-ack transition line appears, the screenshot shows the expected visible state, and there are no unexpected browser-console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- No implementation notes yet.

---

### 10. Align Chat Stop UX With The Shared State Contract

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update Chat page stop controls and local UX so Chat uses the shared stopping contract correctly. This task is only about Chat page behavior, persisted-turn mapping, and Chat page tests after the shared server and hook work is already in place.

#### Must Not Miss

- This task is Chat page only; do not update Agents or Flows here.
- Chat must send conversation-only stop when `inflightId` is unknown, and it must stop using the immediate local “Generation stopped” success path.
- Persisted `Turn.status === 'stopped'` must render as visibly stopped after reload instead of being collapsed into complete.
- Add stable browser `console.info` lines with the exact prefixes documented in this task so the Manual Playwright-MCP check can prove the Chat page stop controls and rendered states changed as expected.

#### Documentation Locations

- React docs on event handlers and state updates: Context7 `/reactjs/react.dev` — use this to keep the Chat page stop handler aligned with React state update rules.
- Jest docs: Context7 `/jestjs/jest` — use this because Chat page tests in this task are implemented in the existing Jest client test suite.
- MUI `Chip` API: use MUI MCP tool with `@mui/material` 6.x `chip.md` — use this because Chat renders terminal stop state through the existing chip component rather than a new UI primitive.
- MUI `CircularProgress` API: use MUI MCP tool with `@mui/material` 6.x `circular-progress.md` — use this because Chat already uses the spinner path for in-progress status rendering.

#### Subtasks

1. [ ] Read the story sections `Surface identity timing`, `UI State Contract`, and `Edge Cases and Failure Modes`.
2. [ ] Update `client/src/pages/ChatPage.tsx` so Chat uses `stopping` instead of an immediate local terminal stopped state and removes the current `if (activeConversationId && currentInflightId)` gate so Stop still sends `cancelInflight(conversationId, undefined)` when `inflightId` is not yet available. Files (read/edit): `client/src/pages/ChatPage.tsx`; files to read: `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`. Docs to use while doing this subtask: React event-handler docs, Jest docs, MUI `Chip` docs, and MUI `CircularProgress` docs.
3. [ ] Update Chat page stored-turn mapping and assistant status chips so persisted `Turn.status === 'stopped'` remains visibly `Stopped` after reload instead of being collapsed to `Complete`. Files (read/edit): `client/src/pages/ChatPage.tsx`; files to read: `server/src/mongo/turn.ts`, `server/src/routes/conversations.ts`. Docs to use while doing this subtask: MUI `Chip` docs and Jest docs.
4. [ ] In `client/src/pages/ChatPage.tsx`, add browser-visible `console.info` lines for Chat stop UX using these exact prefixes and payload expectations so the browser check can assert them reliably: `[stop-debug][chat-ui] stop-clicked` with `{ conversationId, inflightId }` when the user clicks Stop, `[stop-debug][chat-ui] stopping-visible` with `{ conversationId }` when the Chat page renders the stopping state, and `[stop-debug][chat-ui] stopped-visible` with `{ conversationId, turnId }` when the Chat page renders a persisted or live stopped state. Do not log `stopped-visible` for the no-op recovery path. Files (read/edit): `client/src/pages/ChatPage.tsx`; files to read: `client/src/hooks/useChatStream.ts`, `client/src/test/chatPage.stop.test.tsx`. Docs to use while doing this subtask: React event-handler docs, MUI `Chip` docs, and Jest docs.
5. [ ] Replace the current `client/src/test/chatPage.stop.test.tsx` coverage that expects an immediate `Generation stopped` success bubble with a page test that proves Chat shows the visible stopping UX and disables duplicate stop actions while cancellation is pending. Purpose: remove contradictory legacy Chat stop coverage and cover the Chat page happy path.
6. [ ] Add or update a page test in `client/src/test/chatPage.stop.test.tsx` that proves `cancel_ack.result === 'noop'` returns Chat to ready state without a fake terminal bubble. Purpose: cover the Chat page no-op path.
7. [ ] Add or update a page test in `client/src/test/chatPage.stop.test.tsx` that proves Chat sends `cancel_inflight` with `conversationId` and no `inflightId` when Stop is clicked before the page has stored the active `inflightId`. Purpose: cover the Chat startup-race conversation-only stop path.
8. [ ] Add or update a page test in `client/src/test/chatPage.stop.test.tsx` that proves Chat waits for terminal stopped synchronization and allows same-conversation reuse after confirmed stop. Purpose: cover the Chat page finalization path.
9. [ ] Add or update a page test in `client/src/test/chatPage.stop.test.tsx` that proves persisted `Turn.status === 'stopped'` renders visibly stopped after reload. Purpose: cover Chat stopped hydration.
10. [ ] Add or update a page test in `client/src/test/chatPage.stop.test.tsx` that proves Chat recovers correctly if the page unmounts or the active conversation changes while `stopping` is still pending. Purpose: cover Chat navigation corner cases.
11. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
12. [ ] Update this plan file’s `Implementation notes` for Task 10 after the implementation and tests are complete.
13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes Chat page front-end behavior. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-client-latest.log`.
2. [ ] `npm run test:summary:client` - Use because this task changes Jest-covered Chat page stop UX. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end through the dockerized app. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log`.
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm Chat stop UX. In the browser console, assert `[stop-debug][chat-ui] stop-clicked` appears with the active `conversationId` and the current `inflightId` or an omitted `inflightId` during the startup-race path, then `[stop-debug][chat-ui] stopping-visible` appears for the same conversation. Take a screenshot that shows the Chat stop UI being validated and store it in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`; the agent must review that screenshot to confirm the Stop button, visible status chip or spinner, assistant bubble state, and final stopped or recovered-ready rendering all match the exercised path. Expected outcome: for a real stop, `[stop-debug][chat-ui] stopped-visible` appears once with the same `conversationId` and a non-empty `turnId`; for a no-op recovery path, `[stop-debug][chat-ui] stopped-visible` must not appear. The screenshot must show the expected Chat GUI state, and there must be no unexpected browser-console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- No implementation notes yet.

---

### 11. Align Agents Stop UX With The Shared State Contract

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update Agents page stop controls and local UX so both normal runs and command runs use the shared stopping contract correctly. This task is only about Agents page behavior, persisted-turn mapping, and Agents page tests after the shared server and hook work is already in place.

#### Must Not Miss

- This task is Agents page only; do not change Chat or Flows here.
- Cover both normal agent runs and command-list runs, because command runs are the main surface where the client may not yet know `inflightId`.
- Persisted `Turn.status === 'stopped'` must render as visibly stopped after reload instead of being collapsed into complete.
- Add stable browser `console.info` lines with the exact prefixes documented in this task so the Manual Playwright-MCP check can prove the Agents page stop controls and rendered states changed as expected for both run types.

#### Documentation Locations

- React docs on event handlers and state updates: Context7 `/reactjs/react.dev` — use this to keep the Agents page stop handlers aligned with React state update rules.
- Jest docs: Context7 `/jestjs/jest` — use this because Agents page tests in this task are implemented in the existing Jest client test suite.
- MUI `Chip` API: use MUI MCP tool with `@mui/material` 6.x `chip.md` — use this because Agents renders terminal stop state through the existing chip component rather than a new UI primitive.
- MUI `CircularProgress` API: use MUI MCP tool with `@mui/material` 6.x `circular-progress.md` — use this because Agents already uses the spinner path for in-progress status rendering.

#### Subtasks

1. [ ] Read the story sections `Surface identity timing`, `UI State Contract`, and `Edge Cases and Failure Modes`.
2. [ ] Update `client/src/pages/AgentsPage.tsx` so normal agent runs and command-list runs both use the documented stopping behavior, including the no-op recovery path, and remove the current `if (activeConversationId && inflightId)` gate so Stop still sends conversation-only cancel when either run type has started server-side but the page has not yet stored a client-visible `inflightId`. Files (read/edit): `client/src/pages/AgentsPage.tsx`; files to read: `client/src/api/agents.ts`, `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`. Docs to use while doing this subtask: React event-handler docs, Jest docs, MUI `Chip` docs, and MUI `CircularProgress` docs.
3. [ ] Update Agents page stored-turn mapping and assistant status chips so persisted `Turn.status === 'stopped'` remains visibly `Stopped` after reload instead of being collapsed to `Complete`. Files (read/edit): `client/src/pages/AgentsPage.tsx`; files to read: `server/src/mongo/turn.ts`, `server/src/routes/conversations.ts`. Docs to use while doing this subtask: MUI `Chip` docs and Jest docs.
4. [ ] In `client/src/pages/AgentsPage.tsx`, add browser-visible `console.info` lines for Agents stop UX using these exact prefixes and payload expectations so the browser check can assert them reliably: `[stop-debug][agents-ui] stop-clicked` with `{ conversationId, inflightId, runKind }` when the user clicks Stop, `[stop-debug][agents-ui] stopping-visible` with `{ conversationId, runKind }` when the Agents page renders the stopping state, and `[stop-debug][agents-ui] stopped-visible` with `{ conversationId, turnId, runKind }` when the Agents page renders a persisted or live stopped state. Use `runKind: 'instruction'` for normal runs and `runKind: 'command'` for command-list runs. Do not log `stopped-visible` for the no-op recovery path. Files (read/edit): `client/src/pages/AgentsPage.tsx`; files to read: `client/src/hooks/useChatStream.ts`, `client/src/test/agentsPage.commandsRun.abort.test.tsx`, `client/src/test/agentsPage.statusChip.test.tsx`. Docs to use while doing this subtask: React event-handler docs, MUI `Chip` docs, and Jest docs.
5. [ ] Add or update a page test in `client/src/test/agentsPage.commandsRun.abort.test.tsx` that proves Agents shows the visible stopping UX and disables duplicate stop actions while cancellation is pending. Purpose: cover the Agents page happy path.
6. [ ] Add or update a page test in `client/src/test/agentsPage.commandsRun.abort.test.tsx` that proves `cancel_ack.result === 'noop'` returns Agents to ready state without a fake terminal bubble. Purpose: cover the Agents page no-op path.
7. [ ] Replace the existing `client/src/test/agentsPage.commandsRun.abort.test.tsx` coverage named `Stop before inflight id is known does not send cancel_inflight until an inflight id exists` with a page test that proves Agents sends `cancel_inflight` with `conversationId` and no `inflightId` when Stop is clicked for a command run before the page has stored a client-visible `inflightId`. Purpose: remove contradictory legacy command-run coverage and cover the Agents command-run startup-race conversation-only stop path.
8. [ ] Add or update a page test in `client/src/test/agentsPage.commandsRun.abort.test.tsx` or the nearest existing Agents run page test that proves Agents sends `cancel_inflight` with `conversationId` and no `inflightId` when Stop is clicked for a normal instruction run before the page has stored a client-visible `inflightId`. Purpose: cover the Agents normal-run startup-race conversation-only stop path.
9. [ ] Add or update a page test in `client/src/test/agentsPage.commandsRun.abort.test.tsx` that proves Agents waits for terminal stopped synchronization and allows same-conversation reuse after confirmed stop. Purpose: cover the Agents page finalization path.
10. [ ] Add or update a page test in `client/src/test/agentsPage.statusChip.test.tsx` that proves persisted `Turn.status === 'stopped'` renders visibly stopped after reload. Purpose: cover Agents stopped hydration.
11. [ ] Add or update a page test in `client/src/test/agentsPage.commandsRun.abort.test.tsx` that proves Agents recovers correctly if the page unmounts or the active conversation changes while `stopping` is still pending. Purpose: cover Agents navigation corner cases.
12. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
13. [ ] Update this plan file’s `Implementation notes` for Task 11 after the implementation and tests are complete.
14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes Agents page front-end behavior. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-client-latest.log`.
2. [ ] `npm run test:summary:client` - Use because this task changes Jest-covered Agents page stop UX. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end through the dockerized app. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log`.
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm Agents stop UX for both normal runs and command runs. In the browser console, assert `[stop-debug][agents-ui] stop-clicked` appears with the active `conversationId`, the current or omitted `inflightId`, and the correct `runKind`, then `[stop-debug][agents-ui] stopping-visible` appears for the same conversation and run kind. Take screenshots for both the normal-run path and the command-run path and store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`; the agent must review those screenshots to confirm the Agents page shows the expected Stop control state, visible status chip or spinner, and final stopped or recovered-ready rendering for each run kind. Expected outcome: for real stops, `[stop-debug][agents-ui] stopped-visible` appears once with the same `conversationId`, a non-empty `turnId`, and the matching `runKind`; for no-op recovery, `[stop-debug][agents-ui] stopped-visible` must not appear. The screenshots must show the expected Agents GUI state for both run types, and there must be no unexpected browser-console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- No implementation notes yet.

---

### 12. Align Flows Stop UX With The Shared State Contract

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update Flows page stop controls and local UX so flow runs use the shared stopping contract correctly. This task is only about Flows page behavior, persisted-turn mapping, and Flows page tests after the shared server and hook work is already in place.

#### Must Not Miss

- This task is Flows page only; do not change Chat or Agents here.
- Flow stop UX must follow the same shared stopping rules as the other surfaces, but it still runs through the flow-specific page and tests.
- Persisted `Turn.status === 'stopped'` must render as visibly stopped after reload instead of being collapsed into complete.
- Add stable browser `console.info` lines with the exact prefixes documented in this task so the Manual Playwright-MCP check can prove the Flows page stop controls and rendered states changed as expected.

#### Documentation Locations

- React docs on event handlers and state updates: Context7 `/reactjs/react.dev` — use this to keep the Flows page stop handler aligned with React state update rules.
- Jest docs: Context7 `/jestjs/jest` — use this because Flows page tests in this task are implemented in the existing Jest client test suite.
- MUI `Chip` API: use MUI MCP tool with `@mui/material` 6.x `chip.md` — use this because Flows renders terminal stop state through the existing chip component rather than a new UI primitive.
- MUI `CircularProgress` API: use MUI MCP tool with `@mui/material` 6.x `circular-progress.md` — use this because Flows already uses the spinner path for in-progress status rendering.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when documenting the Flows page stop UX in `design.md`.
- Mermaid flowchart syntax: https://mermaid.js.org/syntax/flowchart.html — use this to keep the Flows page stop UX diagram parse-safe and aligned with Mermaid’s current flowchart rules.

#### Subtasks

1. [ ] Read the story sections `Surface identity timing`, `UI State Contract`, and `Edge Cases and Failure Modes`.
2. [ ] Update `client/src/pages/FlowsPage.tsx` so flow stop controls stay aligned with the same stopping and recovery rules and remove the current `if (conversationId && inflightId)` gate so Stop still sends conversation-only cancel when the flow run exists server-side but the page has not yet stored the `inflightId`. Files (read/edit): `client/src/pages/FlowsPage.tsx`; files to read: `client/src/api/flows.ts`, `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`. Docs to use while doing this subtask: React event-handler docs, Jest docs, MUI `Chip` docs, and MUI `CircularProgress` docs.
3. [ ] Update Flows page stored-turn mapping and assistant status chips so persisted `Turn.status === 'stopped'` remains visibly `Stopped` after reload instead of being collapsed to `Complete`. Files (read/edit): `client/src/pages/FlowsPage.tsx`; files to read: `server/src/mongo/turn.ts`, `server/src/routes/conversations.ts`. Docs to use while doing this subtask: MUI `Chip` docs and Jest docs.
4. [ ] In `client/src/pages/FlowsPage.tsx`, add browser-visible `console.info` lines for Flows stop UX using these exact prefixes and payload expectations so the browser check can assert them reliably: `[stop-debug][flows-ui] stop-clicked` with `{ conversationId, inflightId }` when the user clicks Stop, `[stop-debug][flows-ui] stopping-visible` with `{ conversationId }` when the Flows page renders the stopping state, and `[stop-debug][flows-ui] stopped-visible` with `{ conversationId, turnId }` when the Flows page renders a persisted or live stopped state. Do not log `stopped-visible` for the no-op recovery path. Files (read/edit): `client/src/pages/FlowsPage.tsx`; files to read: `client/src/hooks/useChatStream.ts`, `client/src/test/flowsPage.stop.test.tsx`. Docs to use while doing this subtask: React event-handler docs, MUI `Chip` docs, and Jest docs.
5. [ ] Add or update a page test in `client/src/test/flowsPage.stop.test.tsx` that proves Flows shows the visible stopping UX and disables duplicate stop actions while cancellation is pending. Purpose: cover the Flows page happy path.
6. [ ] Add or update a page test in `client/src/test/flowsPage.stop.test.tsx` that proves `cancel_ack.result === 'noop'` returns Flows to ready state without a fake terminal bubble. Purpose: cover the Flows page no-op path.
7. [ ] Add or update a page test in `client/src/test/flowsPage.stop.test.tsx` that proves Flows sends `cancel_inflight` with `conversationId` and no `inflightId` when Stop is clicked before the page has stored the active flow `inflightId`. Purpose: cover the Flows startup-race conversation-only stop path.
8. [ ] Add or update a page test in `client/src/test/flowsPage.stop.test.tsx` that proves Flows waits for terminal stopped synchronization and allows same-conversation reuse after confirmed stop. Purpose: cover the Flows page finalization path.
9. [ ] Add or update a page test in `client/src/test/flowsPage.stop.test.tsx` that proves persisted `Turn.status === 'stopped'` renders visibly stopped after reload. Purpose: cover Flows stopped hydration.
10. [ ] Add or update a page test in `client/src/test/flowsPage.stop.test.tsx` that proves Flows recovers correctly if the page unmounts or the active conversation changes while `stopping` is still pending. Purpose: cover Flows navigation corner cases.
11. [ ] Update `design.md`. Files (read/edit): `design.md`. Add a Flows page stop UX section and a Mermaid `flowchart` that shows user stop action, shared `stopping` UI, no-op recovery after `cancel_ack.result === 'noop'`, terminal `Stopped` rendering after `turn_final.status === 'stopped'`, and same-conversation reuse after confirmation.
12. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
13. [ ] Update this plan file’s `Implementation notes` for Task 12 after the implementation and tests are complete.
14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes Flows page front-end behavior. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-client-latest.log`.
2. [ ] `npm run test:summary:client` - Use because this task changes Jest-covered Flows page stop UX. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end through the dockerized app. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log`.
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm Flows stop UX. In the browser console, assert `[stop-debug][flows-ui] stop-clicked` appears with the active `conversationId` and the current or omitted `inflightId`, then `[stop-debug][flows-ui] stopping-visible` appears for the same conversation. Take a screenshot that shows the Flows stop UI being validated and store it in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`; the agent must review that screenshot to confirm the flow run visibly shows the expected Stop control state, status chip or spinner, and final stopped or recovered-ready rendering. Expected outcome: for real stops, `[stop-debug][flows-ui] stopped-visible` appears once with the same `conversationId` and a non-empty `turnId`; for no-op recovery, `[stop-debug][flows-ui] stopped-visible` must not appear. The screenshot must show the expected Flows GUI state, and there must be no unexpected browser-console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- No implementation notes yet.

---

### 13. Update Documentation And PR Summary

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update the repository documentation to match the implemented stop behavior and prepare the final change summary. This task is only about repository documentation and the pull request summary after implementation is complete.

#### Must Not Miss

- Only document behavior that actually shipped; do not describe future cleanup or speculative follow-up work here.
- Update the three repo docs listed in this task, because a junior developer working only on this task should not need to infer which docs matter from the rest of the story.
- The PR summary must cover every completed task in this story, not just the task the developer personally worked on.

#### Documentation Locations

- Markdown reference: https://www.markdownguide.org/basic-syntax/ — use this to keep README, design, and projectStructure updates consistently formatted.
- GitHub pull request documentation: https://docs.github.com/en/pull-requests — use this to shape the requested PR summary in a format reviewers can follow.
- Mermaid docs: Context7 `/mermaid-js/mermaid` — use this as the authoritative Mermaid syntax reference when consolidating final `design.md` diagrams for this story.
- Mermaid flowchart syntax: https://mermaid.js.org/syntax/flowchart.html — use this to validate any final flowchart updates in `design.md`.
- Mermaid sequence diagram syntax: https://mermaid.js.org/syntax/sequenceDiagram.html — use this to validate any final sequence diagram updates in `design.md`.

#### Subtasks

1. [ ] Update markdown document `README.md`. Document name: `README.md`. Location: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md`. Description: document the shipped stop behavior, including conversation-only stop during the startup race, the no-op `cancel_ack.result === 'noop'` path, and the rule that successful real stop is confirmed by `turn_final.status === 'stopped'`. Purpose: keep the top-level product behavior and operator-facing usage notes aligned with the implemented stop contract.
2. [ ] Update markdown document `design.md`. Document name: `design.md`. Location: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md`. Description: consolidate the architecture and state-flow changes from this story, including the Mermaid diagrams added by the architecture and flow tasks so the documented stop lifecycle matches the final implementation end to end. Purpose: keep the architecture reference accurate for future implementation and debugging work.
3. [ ] Update markdown document `projectStructure.md`. Document name: `projectStructure.md`. Location: `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md`. Description: record any files or folders added, removed, or materially repurposed by this story, including any new tests, helpers, or documentation files created while implementing the stop lifecycle changes. Purpose: keep the repository structure map synchronized with the final file layout delivered by the story.
4. [ ] Write a pull request comment summarizing all changes made by this story across every completed task. Files (read/edit): the PR summary artifact or markdown file used by the team for PR descriptions, plus this plan file’s implementation notes if the repo keeps the summary inline. Docs to use while doing this subtask: GitHub pull request docs and Markdown syntax docs.
5. [ ] Update this plan file’s `Implementation notes` for Task 13 after the implementation and documentation updates are complete.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] No wrapper-based testing is required for this documentation-only task because it does not change executable code.

#### Implementation notes

- No implementation notes yet.

---

### 14. Final Verification And Acceptance Check

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Verify the full story end-to-end against the acceptance criteria. This task must prove the server and client builds work, the Docker build and Compose startup work, the relevant automated tests pass, and the stop UX works visually across the documented scenarios.

#### Must Not Miss

- This task is the acceptance gate for the whole story; it must check the actual acceptance criteria listed earlier in this plan, not a reduced subset.
- Manual verification must include same-conversation reuse after stop, the no-op `cancel_ack` recovery path, and the multi-tab replacement-run protection scenario.
- Do not skip the screenshots requirement, because this task is the final visual proof for the story.
- Reuse the existing cucumber coverage in `server/src/test/features/chat_cancellation.feature` and `server/src/test/steps/chat_cancellation.steps.ts` if the stop contract changes require server BDD updates; do not create a parallel cucumber scaffold for the same chat-cancellation behavior.
- The final manual verification must explicitly inspect the browser console for every exact `[stop-debug]...` line introduced by Tasks 8 to 12 and confirm the expected line appears once for the exercised path.

#### Documentation Locations

- Playwright screenshots and assertions: https://playwright.dev/docs/screenshots — use this because the task requires saved visual proof for the stop UX.
- Docker Compose overview and file reference: https://docs.docker.com/compose/ — use this for the build and startup verification steps that rely on the existing Compose wrappers.
- Cucumber guides: https://cucumber.io/docs/guides/ — use this because the task explicitly runs the server cucumber suite as part of the acceptance gate and any related BDD updates should follow the current Cucumber guides entrypoints.

#### Subtasks

1. [ ] Re-read the full story plan and confirm each acceptance criterion has a corresponding implemented change and automated proof. Files to read: this plan file, the implementation notes for completed tasks, and any updated README/design/projectStructure entries produced by the story.
2. [ ] Save visual proof screenshots for the final manual verification into `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using filenames that begin with the plan number and task number. Files (read/write): `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`. Docs to use while doing this subtask: Playwright screenshots docs. Review each saved screenshot as part of the acceptance check so the GUI evidence is explicitly checked, not just captured.
3. [ ] Add or update one automated Playwright or equivalent e2e test that opens two browser contexts on the same `conversationId` and proves a stale stop request from one context does not cancel a later replacement run in the other context. Files (read/edit): the existing e2e Playwright stop test file for this story or the nearest existing stop e2e file in the repo; files to read: current Playwright config and stop-related page tests. Docs to use while doing this subtask: Playwright screenshot/assertion docs and Cucumber guides if the acceptance coverage also needs aligned BDD notes.
4. [ ] Manually verify that after a confirmed stop the same conversation can be started again immediately without a stale `RUN_IN_PROGRESS` conflict on Chat, Agents, command runs, and Flows.
5. [ ] Manually verify that the conversation-only no-active-run path clears `stopping` only after the matching `cancel_ack.result === 'noop'` and does not render a fake terminal bubble.
6. [ ] Manually verify the documented multi-tab or multi-window behavior by stopping from one browser context and confirming a later replacement run in another context is not cancelled incorrectly.
7. [ ] During final manual verification, inspect the browser console and confirm the exact debug lines from Tasks 8 to 12 appear with the documented payloads and outcomes: `[stop-debug][ws-send] cancel_inflight`, `[stop-debug][ws-event] cancel_ack`, `[stop-debug][stream-state] stopping`, `[stop-debug][stream-state] stopped`, `[stop-debug][stream-state] noop-recovered`, `[stop-debug][chat-ui] stop-clicked`, `[stop-debug][chat-ui] stopping-visible`, `[stop-debug][chat-ui] stopped-visible`, `[stop-debug][agents-ui] stop-clicked`, `[stop-debug][agents-ui] stopping-visible`, `[stop-debug][agents-ui] stopped-visible`, `[stop-debug][flows-ui] stop-clicked`, `[stop-debug][flows-ui] stopping-visible`, and `[stop-debug][flows-ui] stopped-visible`. Expected outcome: each exercised surface emits the correct line once for the path taken, no no-op path emits a `stopped-visible` line, and no stale-request path emits a transition line.
8. [ ] If this task adds or removes any files, update `projectStructure.md` after those file changes are complete and before marking the task done, and ensure that task’s `projectStructure.md` entry lists every file added and every file removed by this task.
9. [ ] Update this plan file’s `Implementation notes` for Task 14 after the verification work is complete.
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run builds or tests directly; use the summary wrappers only. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [ ] `npm run build:summary:server` - Mandatory because the final regression check must validate all server and common changes. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [ ] `npm run build:summary:client` - Mandatory because the final regression check must validate all client and common changes. If status is `failed` or warnings are unexpected or non-zero, inspect `logs/test-summaries/build-client-latest.log`.
3. [ ] `npm run test:summary:server:unit` - Mandatory because the final regression check must validate full server node:test coverage. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Mandatory because the final regression check must validate full server Cucumber coverage. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Mandatory because the final regression check must validate full client coverage. If `failed > 0`, inspect the exact log path printed by the wrapper, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` - Allow up to 7 minutes. If `failed > 0` or setup or teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted wrapper reruns if needed, then rerun full `npm run test:summary:e2e`.
7. [ ] `npm run compose:build:summary` - Use because the final regression check includes dockerized front-end validation. If status is `failed`, inspect `logs/test-summaries/compose-build-latest.log`.
8. [ ] `npm run compose:up`
9. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001` to confirm Chat, Agents, and Flows stop behavior, same-conversation reuse, multi-tab replacement-run protection, and the exact browser-console lines from Tasks 8 to 12. Take screenshots for every GUI state used to confirm acceptance and store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`, then inspect those screenshots to confirm the visible Chat, Agents, and Flows states match the acceptance criteria for stopping, stopped, no-op recovery, and same-conversation reuse. Expected outcome: each exercised path emits the documented `[stop-debug]` line set with matching identifiers, no no-op path emits any `stopped-visible` line, the screenshots show the expected GUI states, and there are no unexpected browser-console errors.
10. [ ] `npm run compose:down`

#### Implementation notes

- No implementation notes yet.
