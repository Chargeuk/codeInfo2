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
- The stop contract is server-authoritative:
  - the client may show a transient stopping state immediately;
  - the client must not render a terminal “stopped” success state until the server publishes or returns the matching `turn_final` event for that run with `status: 'stopped'`;
  - until that event arrives, the UI remains in a non-terminal `stopping` state.
- Conversation-only cancellation semantics are explicit and supported where needed:
  - if `conversationId` is known but `inflightId` is not yet known, the stop request still targets the currently active run for that conversation;
  - if no active run exists for that conversation when the server processes the request, the request is treated as a no-op and must not publish a failed `turn_final`;
  - this does not allow a stale stop request for an older run to incorrectly cancel a newer run started later in the same conversation.
- A stop request issued during the startup race is consumed exactly once by the run that was active when Stop was pressed.
- Duplicate stop requests are safe:
  - the first successful stop request wins;
  - later duplicate stop requests for the same run may be ignored or treated as no-op success, but must not convert the run into `failed` and must not emit misleading duplicate stopped UI state.
- Existing late-event protections remain non-destructive:
  - stale websocket events from a cancelled or earlier run must not re-activate a stopped UI state or corrupt a newer run in the same conversation;
  - client and server matching must continue to use the run `inflightId` when it is available so that late events from an older run are ignored instead of rebinding the UI.
- Existing UI affordances remain consistent:
  - Stop remains visible while a stop is pending;
  - send/execute controls remain disabled only for the currently active or stopping run, not permanently after the stop finishes;
  - once the matching `turn_final` with `status: 'stopped'` arrives, the conversation is immediately usable again from the same tab without refresh.
- Automated coverage is added or updated for:
  - agent command stop before `inflightId` is known;
  - normal agent instruction stop before `inflightId` is known;
  - chat stop before `inflightId` is known;
  - flow stop before `inflightId` is known;
  - server-side cancellation behavior for conversation-only stop requests;
  - conversation-only stop with no active run behaves as a no-op and does not emit `INFLIGHT_NOT_FOUND`;
  - no new command retry/step starts after cancellation;
  - no new flow step/loop iteration starts after cancellation;
  - the UI remains `stopping` until the matching `turn_final` reports `status: 'stopped'`;
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

- Define the stop contract first:
  - Stop should be conversation-authoritative from the moment the user clicks it.
  - `inflightId` should still be used when available for precise matching, but it must not be required for correctness.
  - do not introduce a new websocket message type for this story unless the existing `cancel_inflight` contract proves impossible to adapt.

- Client-side changes are likely needed in:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/pages/FlowsPage.tsx`
  - `client/src/hooks/useChatStream.ts`
  - `client/src/hooks/useChatWs.ts`

- Current client stop handlers only send `cancel_inflight` when `inflightId` is already known, then immediately switch the UI to a local stopped state. That behavior should be split into:
  - immediate local `stopping` intent;
  - unconditional stop message by conversation id;
  - terminal stopped UI only after the matching `turn_final` reports `status: 'stopped'`.

- Server-side changes are likely needed in:
  - `server/src/ws/server.ts`
  - `server/src/chat/inflightRegistry.ts`
  - `server/src/agents/service.ts`
  - `server/src/agents/commandsRunner.ts`
  - `server/src/chat` run entrypoints
  - `server/src/flows/service.ts`

- The likely robust design is a shared pending-cancel registry keyed to the active conversation run:
  - when Stop arrives before `inflightId` is known, store a cancel intent for the currently active run on that conversation;
  - if the inflight already exists, abort immediately;
  - if the inflight is created shortly after, consume the pending cancel immediately and finalize as stopped;
  - if no active run exists when the cancel request is processed, do nothing and do not publish `INFLIGHT_NOT_FOUND`;
  - clear that pending cancel deterministically when the associated run reaches a terminal state so a later run is not cancelled by stale intent.

- Command runs need special care because they span multiple steps and retries:
  - the command runner must check cancellation before starting each next step;
  - retry scheduling must stop once cancellation is requested;
  - a command start request cancelled during the pre-inflight race must not proceed to later steps just because the first step has not surfaced yet.
  - repeated stop requests for the same command run must remain harmless and must not turn the final status into `failed`.
  - where command execution uses APIs that accept `AbortSignal`, the existing combined signal should be passed through rather than relying only on outer loop checks.

- Flow runs need equivalent handling:
  - cancellation must stop the currently active flow run even if the UI has not yet received the step inflight id;
  - flow step transitions and late websocket events from a cancelled flow must not re-bind the UI to that stopped run;
  - cancellation should be checked before each next step or loop iteration so work does not continue after stop has been requested;
  - long-running custom flow logic should use explicit `signal.aborted` or `throwIfAborted()` checks at step boundaries because abort is cooperative, not preemptive.

- Protocol scope for this story is intentionally narrow:
  - keep the existing start payloads and the existing `cancel_inflight` websocket message;
  - keep the existing `turn_final` terminal event shape and use `status: 'stopped'` as the success signal for cancellation;
  - only add a new transport field if implementation proves the current contract cannot identify the run that owned the stop request.

- Recommended UI semantics for this story:
  - after the user presses Stop, move the active run into a non-terminal `stopping` state immediately rather than rendering a final stopped status bubble at once;
  - keep the Stop control visible but disabled while the stop is pending so the user can see that cancellation is in progress without repeatedly resubmitting it;
  - only render the final stopped state after the server publishes or returns the matching `turn_final` event with `status: 'stopped'`;
  - keep send and execute controls disabled during `stopping` so the client does not race ahead of a conversation lock that the server has not yet released.

- Testing should cover both the client symptom and the server authority model:
  - existing Agents command stop tests already prove the pre-`inflightId` client gap;
  - add integration coverage that the server consumes conversation-only stop correctly for instruction, command, chat, and flow startup races;
  - add UI tests that Stop shows a non-terminal stopping state until the terminal event arrives.
