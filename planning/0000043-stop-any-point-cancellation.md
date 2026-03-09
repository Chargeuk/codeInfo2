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
  - successful cancellation of an active run continues to be represented by `turn_final.status === 'stopped'`.

- Existing client-visible contract that should remain unchanged:
  - explicit `{ conversationId, inflightId }` stop requests continue to target one known run and may still use the existing invalid-target failure behavior when the inflight id does not match an active run;
  - conversation-only `{ conversationId }` stop requests continue to be valid and must remain available because some surfaces, especially agent command runs, do not always give the client a usable `inflightId` before Stop can be pressed;
  - if a conversation-only stop arrives when there is no active run, keep the current no-op behavior rather than inventing a new failure contract for this story.

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

## Research Findings

- Repository behavior today:
  - interactive runs are guarded by a simple per-conversation lock, so there is one active run at most and no built-in queued runner to cancel later;
  - websocket tests already prove that conversation-only `cancel_inflight` is accepted and currently behaves as a no-op when there is no active run, rather than emitting `INFLIGHT_NOT_FOUND`.

- External behavior that constrains this story:
  - `AbortSignal.any(...)` in Node.js combines cancellation sources, but cancellation remains cooperative and must be observed by the code or API doing the work;
  - `abortSignal.throwIfAborted()` is available for explicit checkpoints, which makes it suitable for command and flow step boundaries;
  - Node.js child-process abort support behaves like sending a kill signal to the child process, but platform/runtime behavior does not guarantee recursive teardown of every descendant process tree by default.

- Remaining unknowns after research:
  - none that block tasking or implementation for this story, provided the implementation stays within the scoped guarantees above.

## Implementation Ideas

- Shape the implementation around the existing websocket contract, not a new transport:
  - keep `cancel_inflight` as the stop message and keep `turn_final` as the terminal result event;
  - use `status: 'stopped'` as the successful cancellation outcome for the run that was actually cancelled;
  - keep explicit invalid-target behavior for bad `{ conversationId, inflightId }` pairs, but preserve the current conversation-only no-active-run path as a non-failing no-op unless implementation proves that contract is insufficient.

- Start with the server-side cancellation contract in `server/src/ws/server.ts` and `server/src/ws/types.ts`:
  - normalize how conversation-only stop and inflight-targeted stop are handled so every branch is deterministic;
  - keep the current payload validation rules, but make the runtime behavior explicit for active cancel, duplicate cancel, no active run, and invalid explicit inflight id;
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
  - `client/src/hooks/useChatWs.ts` already supports `cancelInflight(conversationId, inflightId?)`; keep that API but make sure pages always send `conversationId` and include `inflightId` when known;
  - `client/src/hooks/useChatStream.ts` should remain the place that guards against stale or mismatched late events, including duplicate `turn_final` replays;
  - `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx` should all switch from immediate local stopped state to an immediate local `stopping` state that only becomes final when the matching `turn_final` arrives, except for the documented no-active-run no-op path, which returns to ready state without a terminal bubble.

- Keep the user-facing stop behavior identical across Chat, Agents, and Flows:
  - Stop should remain visible while the stop request is pending, but duplicate clicks should not create multiple independent stop attempts;
  - send or execute controls should stay disabled only while the run is active or stopping, then recover immediately after the matching stopped final event or the documented no-active-run no-op recovery;
  - no page should claim success locally before the server has confirmed the stop result for the same run, and no page should invent a fake terminal success event for the no-op path.

- Expand automated coverage around the existing high-risk tests instead of inventing a brand-new test strategy:
  - server coverage should primarily extend `server/src/test/unit/ws-server.test.ts`, `server/src/test/unit/ws-chat-stream.test.ts`, `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`, `server/src/test/integration/agents-run-ws-cancel.test.ts`, and the flow integration suites under `server/src/test/integration/flows.run.*.test.ts`;
  - client coverage should extend `client/src/test/useChatWs.test.ts`, `client/src/test/chatPage.stop.test.tsx`, `client/src/test/agentsPage.commandsRun.abort.test.tsx`, `client/src/test/flowsPage.stop.test.tsx`, and the existing inflight-mismatch or late-event tests in `client/src/test/useChatStream.inflightMismatch.test.tsx`;
  - the main cases to prove are startup-race stop before inflight id, duplicate stop idempotence, no new command retry or flow step after cancellation, conversation reusability after confirmed stop, and stale late-event suppression after a cancelled run.
